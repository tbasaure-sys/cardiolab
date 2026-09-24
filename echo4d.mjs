import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VolumeData} from './volume-data.mjs';
import {createVolumeScan} from './volume-scan.mjs';
import {initialVolumeState,volumePose,planePoint,planeCoordinates,voxelPoint,sampleTrilinear,frameAtTime} from './volume-geometry.mjs';
import {createVideoRecorder,recordingExtension} from './recording-format.mjs';

const $=id=>document.getElementById(id),state=initialVolumeState(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let manifest,loader,scan,scene,cloud,leaflets,probe,fan,border,marker,views=[],pose,raw=null,frame=6,requestedFrame=6,requestId=0,ready=false,loading=false,playing=false,playEpoch=0,speed=.5,picked=null,recording=null,urls=[],drawMS=0,failed=false;
const controls=[],frameHistory=[];
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error)};
const poseDefs=[['x','Desplazar X',-130,130,1,'mm'],['y','Desplazar Y',-130,130,1,'mm'],['z','Desplazar Z',-130,130,1,'mm'],['tilt','Inclinar · tilt',-75,75,1,'°'],['rock','Bascular · rock',-75,75,1,'°'],['rotation','Rotar',-180,180,1,'°']];
const imageDefs=[['depth','Profundidad visible',60,240,5,'mm'],['sector','Apertura del sector',30,110,1,'°'],['gain','Ganancia',.3,2.5,.1,'×'],['contrast','Contraste',.5,2,.1,'×'],['zoom','Zoom',1,2.5,.1,'×']];
function makeControls(host,defs){for(const [key,label,min,max,step,unit] of defs){
 const wrap=document.createElement('div');wrap.className='slider';wrap.innerHTML=`<label for="v-${key}"><span>${label}</span><input id="n-${key}" type="number" aria-label="${label} valor" min="${min}" max="${max}" step="${step}" disabled></label><input id="v-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" disabled><small>${unit}</small>`;$(host).append(wrap);
 const number=$('n-'+key),range=$('v-'+key);function change(e){if(!ready)return;const value=Number(e.target.value);if(!Number.isFinite(value))return;state[key]=clamp(value,min,max);if(poseDefs.some(d=>d[0]===key))picked=null;syncControls();refresh()}
 range.oninput=change;number.onchange=change;controls.push({key,range,number});
}}
makeControls('volume-pose-controls',poseDefs);makeControls('volume-image-controls',imageDefs);
for(let i=0;i<8;i++){const label=document.createElement('label');label.textContent=`${i+1} · ${i===0?'cerca':i===7?'lejos':'banda'}`;const input=document.createElement('input');input.id=`tgc-${i}`;input.type='range';input.min=0;input.max=100;input.value=50;input.disabled=true;input.setAttribute('aria-label',`TGC banda ${i+1}`);input.oninput=()=>{state.tgc[i]=Number(input.value);refresh()};label.append(input);$('volume-tgc').append(label)}
function syncControls(){for(const {key,range,number} of controls){range.value=state[key];if(document.activeElement!==number)number.value=state[key];range.disabled=number.disabled=!ready}for(let i=0;i<8;i++){$('tgc-'+i).disabled=!ready;$('tgc-'+i).value=state.tgc[i]}for(const id of ['play','prev','next','phase','reference-phase','reset-pose','reset-image','capture','record'])$(id).disabled=!ready;updateTime()}
function updateTime(){if(!manifest)return;$('play').textContent=playing?'Ⅱ Pausar latido':'▶ Reproducir latido';$('play').classList.toggle('active',playing);$('phase').value=frame;$('phase-label').textContent=`${frame+1} / ${manifest.frames.length} · ${manifest.timesSeconds[frame].toFixed(3)} s`;$('show-leaflets').disabled=frame!==manifest.leafletFrameIndex;$('annotation-note').textContent=frame===manifest.leafletFrameIndex?'Valvas f06 · anotación original en curso, una sola fase.':'Tejidos del volumen actual · valvas coloreadas solo en f06.';if(leaflets)leaflets.visible=frame===manifest.leafletFrameIndex&&$('show-leaflets').checked}
function stop(){playing=false;if(loading){requestId++;loading=false;requestedFrame=frame}updateTime()}
async function chooseFrame(index){
 index=clamp(index,0,manifest.frames.length-1);requestedFrame=index;const ticket=++requestId;loading=true;failed=false;status(`Cargando fase ${index+1}…`);
 try{const data=await loader.frame(index);if(ticket!==requestId)return;raw=data;frame=index;loading=false;scan.setFrame(data);updateCloud(data);ready=true;syncControls();refresh();status(playing?'Latido en reproducción':'Latido pausado · explora el plano');for(const next of [(index+1)%35,(index+2)%35])loader.frame(next).catch(()=>{});
 }catch(error){if(ticket!==requestId)return;loading=false;failed=true;stop();status(error.message,true)}
}
function basicGeometry(positions){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));return g}
function replaceGeometry(object,positions,uvs=null){object.geometry.dispose();object.geometry=basicGeometry(positions);if(uvs)object.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))}
function buildScene(){
 scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xe9f6ff,0x263440,2));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(150,-150,-200);scene.add(light);
 const size=manifest.dimensions.map((n,i)=>(n-1)*manifest.spacingMM[i]);const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineBasicMaterial({color:0x4a6a79,transparent:true,opacity:.6}));box.position.set(...size.map((n,i)=>manifest.originRAS[i]+n/2));scene.add(box);
 cloud=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:1.6,vertexColors:true,transparent:true,opacity:.3,depthWrite:false}));scene.add(cloud);
 leaflets=new THREE.Group();scene.add(leaflets);
 const scanTexture=new THREE.CanvasTexture(scan.canvas);scanTexture.colorSpace=THREE.LinearSRGBColorSpace;scanTexture.minFilter=THREE.LinearFilter;scanTexture.generateMipmaps=false;
 fan=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({map:scanTexture,side:THREE.DoubleSide,transparent:true,opacity:.92,depthWrite:false}));scene.add(fan);
 border=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x63ddc8,depthTest:false}));border.renderOrder=5;scene.add(border);
 probe=new THREE.Group();const body=new THREE.Mesh(new THREE.CylinderGeometry(6,4,23,20),new THREE.MeshStandardMaterial({color:0xe7e5d9,roughness:.45}));body.position.y=-15;probe.add(body);const tip=new THREE.Mesh(new THREE.BoxGeometry(12,5,7),new THREE.MeshStandardMaterial({color:0x425864}));tip.position.y=-2;probe.add(tip);const dot=new THREE.Mesh(new THREE.SphereGeometry(1.5,10,6),new THREE.MeshBasicMaterial({color:0x63ddc8}));dot.position.set(7,-7,0);probe.add(dot);const cable=new THREE.Mesh(new THREE.CylinderGeometry(1,1,26,8),new THREE.MeshStandardMaterial({color:0x738b98}));cable.position.y=-40;probe.add(cable);scene.add(probe);
 marker=new THREE.Mesh(new THREE.SphereGeometry(1.8,12,10),new THREE.MeshBasicMaterial({color:0xffdc78,depthTest:false}));marker.visible=false;marker.renderOrder=10;scene.add(marker);
 for(const [id,offset] of [['probe-view',[190,-280,-165]],['tissue-view',[65,-125,-95]]]){
  const host=$(id),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x081016);host.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(35,1,1,1600);camera.up.set(0,0,-1);camera.position.set(...manifest.targetRAS.map((v,i)=>v+offset[i]));const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(...manifest.targetRAS);orbit.enableDamping=true;orbit.minDistance=35;orbit.maxDistance=750;if(id==='probe-view'){orbit.mouseButtons.LEFT=-1;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.touches.ONE=-1}orbit.update();
  const view={host,renderer,camera,orbit,offset,id};views.push(view);new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}}).observe(host);
 }
 bindProbeDrag(views[0]);
}
function updateCloud(data){
 const [nx,ny,nz]=manifest.dimensions,positions=[],colors=[];
 for(let z=0;z<nz;z+=3)for(let y=0;y<ny;y+=3)for(let x=0;x<nx;x+=3){const v=data[x+nx*(y+ny*z)];if(v<75)continue;positions.push(manifest.originRAS[0]+x*manifest.spacingMM[0],manifest.originRAS[1]+y*manifest.spacingMM[1],manifest.originRAS[2]+z*manifest.spacingMM[2]);const b=v/255;colors.push(b*.92,b*.96,b)}
 cloud.geometry.dispose();cloud.geometry=basicGeometry(positions);cloud.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}
function updatePlane(){
 const layout=scan.layout();if(!layout)return;const w=scan.canvas.clientWidth,h=scan.canvas.clientHeight;
 const vertices=[],uvs=[],edge=[...pose.origin];const uv=(x,y)=>[(layout.cx+x*layout.scale)/w,1-(layout.cy+y*layout.scale)/h];let previous=null;
 for(let i=0;i<=64;i++){const angle=(-state.sector/2+state.sector*i/64)*Math.PI/180,x=state.depth*Math.sin(angle),y=state.depth*Math.cos(angle),point=planePoint(pose,x,y);edge.push(...point);if(previous){vertices.push(...pose.origin,...previous.point,...point);uvs.push(...uv(0,0),...uv(previous.x,previous.y),...uv(x,y))}previous={point,x,y}}edge.push(...pose.origin);replaceGeometry(fan,vertices,uvs);replaceGeometry(border,edge);fan.material.map.needsUpdate=true;
 probe.position.set(...pose.origin);probe.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...pose.u),new THREE.Vector3(...pose.d),new THREE.Vector3(...pose.n)));
 let valid=0,total=0;for(let y=0;y<=state.depth;y+=state.depth/20)for(let x=-state.depth;x<=state.depth;x+=state.depth/20){if(Math.hypot(x,y)>state.depth||Math.abs(Math.atan2(x,y))>state.sector*Math.PI/360)continue;total++;const q=voxelPoint(planePoint(pose,x,y),manifest);if(q.every((v,i)=>v>=0&&v<=manifest.dimensions[i]-1))valid++}
 $('scan-empty').hidden=valid>0;updateMarker();
}
function refresh(){if(!ready||!raw)return;const start=performance.now();pose=volumePose(state,manifest);scan.draw(state,pose);updatePlane();drawMS=performance.now()-start;$('render-time').textContent=`${Math.round(drawMS)} ms`}
function updateMarker(){marker.visible=!!picked;$('scan-marker').hidden=!picked;if(!picked){$('voxel-readout').textContent='Pulsa la imagen para localizar el mismo punto en 3D.';return}marker.position.set(...picked.world);const q=planeCoordinates(pose,picked.world),layout=scan.layout();if(Math.abs(q[2])>.01){picked=null;updateMarker();return}$('scan-marker').style.left=layout.cx+q[0]*layout.scale+'px';$('scan-marker').style.top=layout.cy+q[1]*layout.scale+'px';const value=sampleTrilinear(raw,manifest.dimensions,voxelPoint(picked.world,manifest));picked.value=value;$('voxel-readout').textContent=`Fuente ${value?.toFixed(1)??'—'} / 255 · (${picked.world.map(v=>v.toFixed(1)).join(', ')}) mm`}
function bindProbeDrag(view){
 const ray=new THREE.Raycaster(),canvas=view.renderer.domElement;let drag=null;
 function hit(e,z){const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height),view.camera);return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-z),new THREE.Vector3())}
 canvas.onpointerdown=e=>{if(e.button!==0||!ready)return;const p=hit(e,pose.origin[2]);if(!p)return;drag={point:p,x:state.x,y:state.y,z:pose.origin[2]};canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!drag)return;const p=hit(e,drag.z);if(!p)return;state.x=clamp(drag.x+p.x-drag.point.x,-130,130);state.y=clamp(drag.y+p.y-drag.point.y,-130,130);picked=null;syncControls();refresh()};for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
}
$('play').onclick=()=>{if(!ready)return;if(playing){stop();status('Latido pausado · explora el plano')}else{playing=true;playEpoch=performance.now()-manifest.timesSeconds[frame]*1000/speed;status('Latido en reproducción');updateTime()}};
function step(delta){const index=clamp(requestedFrame+delta,0,manifest.frames.length-1);stop();chooseFrame(index)}
$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('phase').oninput=e=>{const index=Number(e.target.value);stop();chooseFrame(index)};
$('speed').onchange=e=>{speed=Number(e.target.value);if(playing)playEpoch=performance.now()-manifest.timesSeconds[frame]*1000/speed};
$('reference-phase').onclick=()=>{stop();$('show-leaflets').checked=true;chooseFrame(manifest.leafletFrameIndex)};
$('show-leaflets').onchange=updateTime;
$('reset-pose').onclick=()=>{for(const [key] of poseDefs)state[key]=0;picked=null;syncControls();refresh()};
$('reset-image').onclick=()=>{const initial=initialVolumeState();for(const [key] of imageDefs)state[key]=initial[key];state.tgc=initial.tgc;syncControls();refresh()};
$('reset-camera').onclick=()=>views.forEach(v=>{v.camera.position.set(...manifest.targetRAS.map((x,i)=>x+v.offset[i]));v.orbit.target.set(...manifest.targetRAS);v.orbit.update()});
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
function metadata(){return {application:'CardioLab Echo 4D',created:new Date().toISOString(),source:manifest.source,sourceFiles:manifest.sourceFiles,frameIndex:frame,timeSeconds:manifest.timesSeconds[frame],frameSHA256:manifest.frames[frame].sha256,dimensions:manifest.dimensions,spacingMM:manifest.spacingMM,space:'source RAS, millimetres',pose,controls:structuredClone(state),picked,leaflets:{sourceFrameIndex:manifest.leafletFrameIndex,visible:leaflets.visible,sourceStatus:'inprogress'},clinicalValidation:false,torsoRegistration:false,acousticResimulation:false,interpolation:'GPU trilinear sampling of original uint8 voxels'}}
const composite=document.createElement('canvas');composite.width=1440;composite.height=650;const cc=composite.getContext('2d');
function renderViews(){if(!ready)return;for(const v of views){v.orbit.update();cloud.material.opacity=v.id==='probe-view'?.035:.12;probe.visible=v.id==='probe-view';fan.material.opacity=v.id==='probe-view'?.98:.42;v.renderer.render(scene,v.camera)}}
function compose(){renderViews();cc.fillStyle='#081016';cc.fillRect(0,0,1440,650);cc.fillStyle='#d9eee8';cc.font='21px Segoe UI';cc.fillText('CARDIOLAB / ECO 4D REAL · MITRAL',24,34);for(const [i,canvas] of [...views.map(v=>v.renderer.domElement),scan.canvas].entries()){const factor=Math.min(450/canvas.width,490/canvas.height);cc.drawImage(canvas,24+480*i+(450-canvas.width*factor)/2,65+(490-canvas.height*factor)/2,canvas.width*factor,canvas.height*factor);cc.font='13px Segoe UI';cc.fillStyle='#b7d3ca';cc.fillText(['Sonda virtual y volumen','Tejidos del mismo estudio','Corte ecográfico del plano'][i],24+480*i,575)}cc.font='12px Consolas';cc.fillStyle='#9aacba';cc.fillText(`Fase ${frame+1}/35 · ${manifest.timesSeconds[frame].toFixed(3)} s · Tilt ${state.tilt}° · Rock ${state.rock}° · Rotación ${state.rotation}°`,24,607);cc.fillText('SlicerHeart · corte de volumen adquirido · sin registro al tórax · no es una nueva adquisición acústica',24,634)}
function exportResult(blob,kind,meta){for(const url of urls)URL.revokeObjectURL(url);urls=[];const link=$(kind==='image'?'download-image':'download-video'),url=URL.createObjectURL(blob),json=URL.createObjectURL(new Blob([JSON.stringify(meta,null,2)],{type:'application/json'}));urls.push(url,json);$('download-image').hidden=kind!=='image';$('download-video').hidden=kind!=='video';link.href=url;link.download=`CardioLab_Mitral_4D.${kind==='image'?'png':recordingExtension(blob.type)}`;if(kind==='video')link.textContent=`Descargar ${recordingExtension(blob.type).toUpperCase()}`;$('download-metadata').href=json;$('download-metadata').download='CardioLab_Mitral_4D_sesion.json';$('exports').hidden=false;$('export-status').textContent='Listo para descargar. La sesión incluye la fase y la posición del plano.'}
$('capture').onclick=()=>{if(!ready)return;compose();const meta=metadata();composite.toBlob(blob=>exportResult(blob,'image',meta))};
$('record').onclick=()=>{
 if(recording){recording.recorder.stop();return}if(!ready)return;compose();const stream=composite.captureStream(20);let recorder;try{recorder=createVideoRecorder(stream)}catch(error){stream.getTracks().forEach(t=>t.stop());status(error.message,true);return}
 const chunks=[],start=performance.now(),session={recorder,stream,start,last:0,failed:false};recording=session;frameHistory.length=0;
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 const cleanup=()=>{stream.getTracks().forEach(t=>t.stop());recording=null;$('record').textContent='● Grabar 10 s'};
 recorder.onerror=()=>{session.failed=true;cleanup();status('No se pudo completar la grabación',true)};
 recorder.onstop=()=>{const meta={...metadata(),recording:{mimeType:recorder.mimeType,frames:[...frameHistory]}};cleanup();if(session.failed)return;const blob=new Blob(chunks,{type:recorder.mimeType});if(blob.size)exportResult(blob,'video',meta)};
 try{recorder.start()}catch(error){cleanup();status(error.message,true)};
};
let lastView=0;
function animate(now){requestAnimationFrame(animate);if(!ready)return;
 if(playing&&!loading){const times=manifest.timesSeconds,period=times.at(-1)+(times.at(-1)-times.at(-2));const t=((now-playEpoch)*speed/1000)%period,index=frameAtTime(t,times);if(index!==frame)chooseFrame(index)}
 if(now-lastView>30){renderViews();lastView=now}
 if(recording){if(now-recording.last>=50){compose();frameHistory.push({elapsedMS:now-recording.start,frameIndex:frame,timeSeconds:manifest.timesSeconds[frame],pose:structuredClone(pose),controls:structuredClone(state)});recording.last=now}$('record').textContent=`■ ${Math.min(10,(now-recording.start)/1000).toFixed(1)} / 10 s`;if(now-recording.start>=10000&&recording.recorder.state==='recording')recording.recorder.stop()}
}
async function boot(){
 const r=await fetch('assets/mitral4d/manifest.json');if(!r.ok)throw Error('No se encontró el volumen mitral preparado');manifest=await r.json();loader=new VolumeData(manifest);scan=createVolumeScan($('volume-scan'),manifest);buildScene();
 const labels=await (await fetch('assets/mitral4d/'+manifest.leaflets)).json();for(const label of labels.labels){const points=new THREE.Points(basicGeometry(label.positions),new THREE.PointsMaterial({color:new THREE.Color(...label.color),size:.65,transparent:true,opacity:.95}));leaflets.add(points)}
 new ResizeObserver(()=>refresh()).observe($('volume-scan'));
 scan.canvas.addEventListener('click',e=>{if(!ready)return;const r=scan.canvas.getBoundingClientRect(),layout=scan.layout(),x=(e.clientX-r.left-layout.cx)/layout.scale,y=(e.clientY-r.top-layout.cy)/layout.scale;if(y<0||Math.hypot(x,y)>state.depth||Math.abs(Math.atan2(x,y))>state.sector*Math.PI/360)return;const world=planePoint(pose,x,y),value=sampleTrilinear(raw,manifest.dimensions,voxelPoint(world,manifest));picked=value===null?null:{world,value};updateMarker()});
 window.echo4D={snapshot:()=>({ready,loading,failed,playing,frameIndex:frame,requestedFrame,timeSeconds:manifest.timesSeconds[frame],state:structuredClone(state),pose:structuredClone(pose),picked:structuredClone(picked),leafletsVisible:leaflets.visible,leafletFrameIndex:manifest.leafletFrameIndex,dimensions:manifest.dimensions,drawMS,draws:scan.draws(),recording:!!recording,loadedFrames:loader.verified.size,cloudPoints:cloud.geometry.attributes.position?.count??0}),layout:()=>scan.layout(),sample:world=>sampleTrilinear(raw,manifest.dimensions,voxelPoint(world,manifest)),metadata};
 await chooseFrame(6);requestAnimationFrame(animate);
}
boot().catch(error=>{failed=true;console.error(error);status(error.message,true)});
