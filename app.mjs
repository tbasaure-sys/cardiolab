import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PRESETS,defaultState,poseFromState,toWorld,toPlane,inSector,surface,chestRadius,chestDepth,rad,sub,norm} from './geometry.mjs';
import {scanYSign,screenToPlane,CHEST_Y,CHEST_X,placeAtlasPositions,BODY,setBodyScale,physical,tightenSkin} from './geometry.mjs';
import {PATIENTS,PATIENT_BY_ID,bsaHaycock,bodyScale,describePatient} from './patient.mjs';
import {PHN,PHN_SOURCE,zScore,formatZ} from './zscores.mjs';
import {mountTutor} from './tutor.mjs';
import {mountVideoImage} from './video-image.mjs';
import {mountReferenceClips} from './reference-clips.mjs';
import {createVideoRecorder,recordingExtension} from './recording-format.mjs';
import {initialDisplay,mountInstrument,applyDisplayTone,boundedCursor,distanceMM} from './instrument.mjs';
import {createSimEngine,CINE_PHASES} from './sim-engine.mjs';
import {scanConvert,COLOR_MAP} from './bmode.mjs';
import {VIEW_INFO,markerClock,describeManeuver} from './views.mjs';
import {mountCoach} from './coach.mjs';
import {mountCHD} from './chd-panel.mjs';
import {mountDrills} from './drills.mjs';
import {mountPhoneProbe} from './phone-probe.mjs';
import {VARIANT_BY_ID} from './chd-data.mjs';
import {roiAround} from './flow.mjs';
import {HeartMotion} from './tissue.mjs';
import {mountBeamMap} from './beam-map.mjs';
import {mountCabina} from './cabina.mjs';
import {buildValves} from './valves.mjs';

// patient size first: every default depth below is scaled to it
const PATIENT_KEY='cardiolab.patient.v1';let patient=(()=>{try{return PATIENT_BY_ID[localStorage.getItem(PATIENT_KEY)]}catch{return null}})()||PATIENT_BY_ID.child;setBodyScale(bodyScale(patient));
const $=id=>document.getElementById(id),state={...defaultState(),mode:'echo'},scan=$('scan'),ctx=scan.getContext('2d',{willReadFrequently:true});
let beam=null,manifest,meshes=[],byId=new Map(),views=[],worker,ready=false,busy=false,pending=null,revision=0,active=null,selected=null,crosshair=null;
let frozen=false,sweeping=false,sweepStart=0,sweepBase=0,recording=null,dragging=false,latestRequestedAt=0,frameCount=0;
let tutor=null,pediatricDisplay=true,instrument=null,references=null,videoImage=null,echoSource='sim',resumeAfterFreeze=false,imageOnly=false;const display=initialDisplay();
// simulated B-mode: engine, cardiac phase, cine cache of scan-converted images
const engine=createSimEngine();engine.set({bodyScale:BODY.k});display.freq=patient.freq;let phase=0,beatSpeed=1,heartRate=patient.hr,lastTick=performance.now(),lastPoseChange=0,simQuick=false,simViews=null,coach=null,chd=null,targetPose=null,lesion=null,overlayContours=false;
const scanCache=new WeakMap();let scanCacheKey='';
const latencies=[],poseLog=[],controls=[];let lastInputAt=0;let projection={cx:0,cy:30,scale:1},scanWidth=600,scanHeight=400;
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// depth marks every 1, 2 or 5 physical cm, returned as [atlas depth, label]
function depthTicks(atlasDepth){const d=physical(atlasDepth),step=d<=.07?.01:d<=.13?.02:.05,out=[];for(let v=step;v<=d+1e-9;v+=step)out.push([v/BODY.k,(v*100).toFixed(0)]);return out}
const cmText=atlasDepth=>{const d=physical(atlasDepth)*100;return `${d<10?d.toFixed(1).replace('.',','):d.toFixed(0)} cm`};
function realEcho(){return state.mode==='echo'&&echoSource==='real'}
function simEcho(){return state.mode==='echo'&&echoSource==='sim'}
function colorFor(m){return new THREE.Color(...m.color).getStyle()}
function makeControl(container,key,label,min,max,step,unit,factor=1,help=''){
  const div=document.createElement('div');div.className='slider';
  const row=document.createElement('label');row.htmlFor=`control-${key}`;const text=document.createElement('span');text.textContent=label;
  const number=document.createElement('input');number.type='number';number.min=min;number.max=max;number.step=step;number.setAttribute('aria-label',label+' valor');number.id=`number-${key}`;
  row.append(text,number);const range=document.createElement('input');range.type='range';range.id=`control-${key}`;range.min=min;range.max=max;range.step=step;range.setAttribute('aria-label',label);
  const desc=document.createElement('small');desc.textContent=help||unit;div.append(row,range,desc);$(container).append(div);
  const change=e=>{lastInputAt=performance.now();if(!ready||(frozen&&!(realEcho()&&key==='gain'))||(realEcho()&&['depth','sector'].includes(key)))return;const v=Number(e.target.value);if(!Number.isFinite(v))return;const before=state[key];state[key]=clamp(v,min,max)/factor;noteManeuver(key,before,state[key]);if(['tilt','rock','rotation','x','z'].includes(key))stopSweep();syncControls();if(realEcho()&&key==='gain')renderScan();else requestSlice()};
  range.addEventListener('input',change);number.addEventListener('change',change);
  controls.push({key,range,number,factor});
}
makeControl('pose-controls','x','Desplazar lateral',-110,110,1,'mm',1000,'− derecha / + izquierda del atlas');
makeControl('pose-controls','z','Desplazar vertical',-155,200,1,'mm',1000,'− caudal / + craneal');
makeControl('pose-controls','rotation','Rotar',-180,180,1,'°',1,'− antihorario / + horario (visto desde el mango)');
makeControl('pose-controls','tilt','Inclinar · tilt',-60,60,1,'°',1,'Barre el plano fuera del corte (la imagen muestra hacia dónde va el haz)');
makeControl('pose-controls','rock','Bascular · rock',-50,50,1,'°',1,'− lejos del marcador (izquierda de la imagen) / + hacia el marcador (derecha)');
makeControl('image-controls','depth','Profundidad',30,240,5,'mm',1000);
makeControl('image-controls','sector','Sector',45,110,1,'°');
makeControl('image-controls','gain','Ganancia',.3,2.5,.1,'ajuste visual de la imagen eco');
function syncControls(){for(const c of controls){const value=Number((state[c.key]*c.factor).toFixed(2));c.range.value=c.number.value=value;c.range.disabled=c.number.disabled=!ready||(frozen&&!(realEcho()&&c.key==='gain'))||(realEcho()&&['depth','sector'].includes(c.key))}document.querySelectorAll('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset===state.preset);b.disabled=frozen||!ready});$('goal').textContent=PRESETS[state.preset].goal;$('reset-pose').disabled=frozen||!ready;$('sweep').disabled=frozen||!ready;instrument?.update();references?.update({...teachingSnapshot(),frozen});videoImage?.update()}

function makeView(id,isPatient){
  const host=$(id),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0x0a1016);renderer.localClippingEnabled=true;host.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(isPatient?33:32,1,.001,5);camera.up.set(0,0,1);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.dampingFactor=.12;orbit.minDistance=isPatient?.30:.12;orbit.maxDistance=isPatient?1.7:.8;orbit.target.set(-.013,0,.015);
  if(isPatient){orbit.mouseButtons.LEFT=-1;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.touches.ONE=-1}
  scene.add(new THREE.HemisphereLight(0xd7ecfa,0x2b333d,2.3));for(const [pos,power] of [[[.3,-.4,.5],2.8],[[-.4,.1,.1],1.6]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(...pos);scene.add(light)}
  const group=new THREE.Group();scene.add(group);const anatomical=[];
  for(const m of meshes){if(!isPatient&&m.kind==='bone')continue;const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:.57,metalness:0,side:THREE.DoubleSide,transparent:true,opacity:m.kind==='bone'?.20:(isPatient?.8:.74),depthWrite:false});
    const mesh=new THREE.Mesh(m.geometry,mat);mesh.userData.id=m.id;group.add(mesh);anatomical.push(mesh)}
  const fanGeometry=new THREE.BufferGeometry(),fan=new THREE.Mesh(fanGeometry,new THREE.MeshBasicMaterial({color:0x64e8cd,side:THREE.DoubleSide,transparent:true,opacity:.11,depthWrite:false}));scene.add(fan);
  const border=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x63ddc8,transparent:true,opacity:.7}));scene.add(border);
  const ray=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0xb3fff0,dashSize:.004,gapSize:.003,transparent:true,opacity:.65}));scene.add(ray);
  const probe=new THREE.Group(),white=new THREE.MeshStandardMaterial({color:0xe2e5dd,roughness:.32});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.010,.006,.036,20),white);body.position.y=.023;probe.add(body);
  const tip=new THREE.Mesh(new THREE.BoxGeometry(.016,.006,.009),new THREE.MeshStandardMaterial({color:0x35444e}));tip.position.y=.003;probe.add(tip);
  const mark=new THREE.Mesh(new THREE.SphereGeometry(.0022,12,8),new THREE.MeshBasicMaterial({color:0x63ddc8}));mark.position.set(.009,.010,0);probe.add(mark);
  const cable=new THREE.Mesh(new THREE.CylinderGeometry(.0016,.0016,.04,8),new THREE.MeshStandardMaterial({color:0x6c7c86}));cable.position.y=.06;probe.add(cable);scene.add(probe);
  const point=new THREE.Mesh(new THREE.SphereGeometry(.0018,12,8),new THREE.MeshBasicMaterial({color:0xffe98c}));point.visible=false;scene.add(point);
  const targetFan=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0xffb454,dashSize:.004,gapSize:.003,transparent:true,opacity:.95}));targetFan.visible=false;scene.add(targetFan);
  const lesionMark=new THREE.Mesh(new THREE.SphereGeometry(.0045,18,12),new THREE.MeshBasicMaterial({color:0xff5d6c,transparent:true,opacity:.9,depthTest:false}));lesionMark.visible=false;lesionMark.renderOrder=5;scene.add(lesionMark);
  let torso=null;
  if(isPatient){
    const positions=[],indices=[],rings=48,sides=72;
    for(let r=0;r<=rings;r++){const z=-.205+r*.49/rings;for(let i=0;i<sides;i++){const angle=2*Math.PI*i/sides,p=[CHEST_X+chestRadius(z)*Math.cos(angle),CHEST_Y+chestDepth(z)*Math.sin(angle),z];
      // the front of the chest follows the tightened skin the probe sits on (blended out toward the flanks)
      const w=Math.max(0,Math.min(1,-Math.sin(angle)*3)),q=w?tightenSkin(p):p;positions.push(...p.map((v,k)=>v+(q[k]-v)*w))}}
    for(let r=0;r<rings;r++)for(let i=0;i<sides;i++){const a=r*sides+i,b=r*sides+(i+1)%sides,c=a+sides,d=b+sides;indices.push(a,b,d,a,d,c)}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    torso=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0xb4c3ce,transparent:true,opacity:.14,depthWrite:false,side:THREE.DoubleSide,roughness:.7}));scene.add(torso);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geo,16),new THREE.LineBasicMaterial({color:0x6a7c88,transparent:true,opacity:.28}));scene.add(outline);
    const sternumLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(CHEST_X,CHEST_Y-.129,-.14),new THREE.Vector3(CHEST_X,CHEST_Y-.129,.16)]),new THREE.LineDashedMaterial({color:0x607988,dashSize:.005,gapSize:.005,transparent:true,opacity:.4}));sternumLine.computeLineDistances();scene.add(sternumLine);
  }
  const view={host,renderer,scene,camera,orbit,fan,border,ray,probe,point,anatomical,torso,isPatient,targetFan,lesionMark};resetCamera(view);
  new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}).observe(host);
  return view;
}
function setTargetPose(pose){targetPose=pose;for(const v of views){if(!pose){v.targetFan.visible=false;continue}const edge=[...pose.origin];for(let i=0;i<=48;i++){const a=rad(-pose.sector/2+pose.sector*i/48);edge.push(...toWorld(pose,pose.depth*Math.sin(a),pose.depth*Math.cos(a)))}edge.push(...pose.origin);replaceGeometry(v.targetFan,edge);v.targetFan.computeLineDistances();v.targetFan.visible=true}}
function setLesionMarker(pos){lesion=pos;for(const v of views){v.lesionMark.visible=!!pos&&!imageOnly;if(pos)v.lesionMark.position.set(...pos)}}
function resetCamera(v){v.camera.up.set(0,0,1);v.camera.position.set(...(v.isPatient?[.27,-.95,.19]:[.18,-.33,.11]));v.orbit.target.set(-.012,0,.012);v.orbit.update()}
function replaceGeometry(object,points,triangles=false){object.geometry.dispose();object.geometry=new THREE.BufferGeometry();object.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));if(triangles)object.geometry.computeVertexNormals()}
function updateView(v,pose){
  const edge=[...pose.origin],tri=[];let previous=null;
  for(let i=0;i<=64;i++){const angle=rad(-pose.sector/2+pose.sector*i/64),point=toWorld(pose,pose.depth*Math.sin(angle),pose.depth*Math.cos(angle));edge.push(...point);if(previous)tri.push(...pose.origin,...previous,...point);previous=point}edge.push(...pose.origin);
  replaceGeometry(v.fan,tri,true);replaceGeometry(v.border,edge);replaceGeometry(v.ray,[...pose.origin,...toWorld(pose,0,pose.depth)]);v.ray.computeLineDistances();
  v.probe.position.set(...pose.origin);const matrix=new THREE.Matrix4().makeBasis(new THREE.Vector3(...pose.u),new THREE.Vector3(...pose.d).negate(),new THREE.Vector3(...pose.n).negate());v.probe.quaternion.setFromRotationMatrix(matrix);v.probe.scale.setScalar(1/BODY.k); // same probe, smaller patient
  // clipping keeps the half of the heart behind the plane as seen from the camera (the cut face looks at you)
  const nrm=new THREE.Vector3(...pose.n),o3=new THREE.Vector3(...pose.origin);const camPos=(!v.isPatient&&beam?.follow&&beam.goalPosition)?beam.goalPosition:v.camera.position;if(camPos.clone().sub(o3).dot(nrm)>0)nrm.negate();
  const plane=new THREE.Plane(nrm,-nrm.dot(o3)),clip=!v.isPatient&&($('expose').checked||!!beam?.follow);
  for(const mesh of v.anatomical){const m=byId.get(mesh.userData.id),chosen=selected===m.id;mesh.material.opacity=m.kind==='bone'?.20:(!selected?(v.isPatient?.8:.74):(chosen?1:.15));mesh.material.emissive.set(chosen?0x263b31:0x000000);mesh.material.clippingPlanes=clip?[plane]:[]}
  v.point.visible=!!crosshair;if(crosshair)v.point.position.set(...crosshair);
  if(!v.isPatient&&beam?.enabled)beam.style(selected);
}
function bindProbeDrag(view){
  const canvas=view.renderer.domElement,raycaster=new THREE.Raycaster();
  function move(event){if(!dragging||frozen||!ready)return;const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),view.camera);
    const hits=raycaster.intersectObject(view.torso).filter(h=>h.point.y<0);if(!hits.length)return;const point=hits[0].point;const bx=state.x,bz=state.z;state.x=clamp(point.x,-.110,.110);state.z=clamp(point.z,-.155,.2);if(Math.abs(state.x-bx)>Math.abs(state.z-bz))noteManeuver('x',bx,state.x);else noteManeuver('z',bz,state.z);stopSweep();syncControls();requestSlice()}
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||frozen)return;dragging=true;canvas.setPointerCapture(event.pointerId);move(event)});
  canvas.addEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>dragging=false);
}

function syncEngine(){engine.set({gain:state.gain,freq:display.freq,tgc:[...display.tgc],focus:display.focus,dynamicRange:display.dr,harmonic:display.thi})}
function requestSim(quick=false){if(!simEcho()||!ready)return;syncEngine();simQuick=quick;engine.show(poseFromState(state),phase,{quick})}
function requestSlice(){
  if(!ready)return;requestSpectrum();lastPoseChange=performance.now();requestSim(dragging||sweeping||(performance.now()-lastInputAt<180));revision++;latestRequestedAt=performance.now();pending={type:'slice',id:revision,state:{...state},pose:poseFromState(state),requestedAt:latestRequestedAt};status('Muestreando el plano…');dispatch();
}
function dispatch(){if(!busy&&pending){busy=true;const next=pending;pending=null;worker.postMessage(next)}}
function visibleCut(c,pose){const a=c.segments;for(let i=0;i<a.length;i+=4){if(inSector(a[i],a[i+1],pose)||inSector(a[i+2],a[i+3],pose)||inSector((a[i]+a[i+2])/2,(a[i+1]+a[i+3])/2,pose))return true}return false}
function accept(msg){
  busy=false;if(msg.type==='error'){status('No se pudo calcular el corte: '+msg.message,true);dispatch();return}
  if(msg.id===revision){if(active&&JSON.stringify(active.pose)!==JSON.stringify(msg.pose)){crosshair=null;display.points=[];}active=msg;active.visible=msg.cuts.filter(c=>visibleCut(c,msg.pose));active.elapsed=performance.now()-latestRequestedAt;latencies.push(active.elapsed);if(latencies.length>100)latencies.shift();
    if(selected&&!active.visible.some(c=>c.id===selected)){selected=null;crosshair=null}
    beam?.update(active,selected);beam?.track(msg.pose,scanYSign(msg.state.preset,pediatricDisplay));$('beam-path').textContent=beam?.enabled&&beam.path?'Línea central (cm): '+beam.path:'';
    for(const v of views)updateView(v,msg.pose);renderScan();renderStructures();$('latency').textContent=`${Math.round(active.elapsed)} ms`;
    status(frozen?'Plano congelado':(sweeping?'Barrido de sonda':'Vistas sincronizadas'));$('marker-clock').textContent=`Marcador ${Math.round(markerClock(msg.pose.u))||12} h`;coach?.update();$('depth-readout').textContent=realEcho()?'Vídeo':cmText(msg.pose.depth);
    tutor?.observe(teachingSnapshot());references?.update({...teachingSnapshot(),frozen});
    if(recording)poseLog.push({t:performance.now()-recording.start,pose:msg.pose,controls:msg.state,display:displaySnapshot()});
  }dispatch();
}
function renderStructures(){
  const host=$('structures');host.replaceChildren();
  for(const cut of active.visible){const m=byId.get(cut.id),button=document.createElement('button');button.textContent=m.name;button.style.setProperty('--structure-color',colorFor(m));button.classList.toggle('active',selected===m.id);button.onclick=()=>select(m.id,null);host.append(button)}
  $('empty-scan').hidden=realEcho()||simEcho()||active.visible.length>0;$('selection').textContent=selected?`${byId.get(selected).name} · resaltada en ambas vistas`:'Elige una estructura para resaltarla.';
}
function select(id,point){selected=selected===id&&!point?null:id;crosshair=point;for(const v of views)updateView(v,active.pose);renderScan();renderStructures();tutor?.observe(teachingSnapshot())}
const speckle=document.createElement('canvas');speckle.width=speckle.height=128;const noise=speckle.getContext('2d'),pixels=noise.createImageData(128,128);let seed=18273;
for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const a=(seed>>>24);pixels.data.set([a,a,a,120],i)}noise.putImageData(pixels,0,0);
function pathFor(c,scale,cx,cy,ySign){const p=new Path2D();for(const loop of c.loops){loop.forEach((v,i)=>{const x=cx+v[0]*scale,y=cy+ySign*v[1]*scale;i?p.lineTo(x,y):p.moveTo(x,y)});p.closePath()}return p}
function renderScan(){
  if(!active)return;const rect=$('scan-view').getBoundingClientRect(),w=rect.width,h=rect.height;if(!w||!h)return;scanWidth=w;scanHeight=h;
  const ratio=Math.min(devicePixelRatio,1.7);if(scan.width!==Math.round(w*ratio)||scan.height!==Math.round(h*ratio)){scan.width=Math.round(w*ratio);scan.height=Math.round(h*ratio)}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#05080b';ctx.fillRect(0,0,w,h);
  if(realEcho()){projection={source:'video'};videoImage?.paint(ctx,w,h,{...display,gain:state.gain});instrument?.update();return}
  if(simEcho()){drawSim();instrument?.update();return}
  $('depth-readout').textContent=cmText(active.pose.depth);
  const p=active.pose,s=active.state,ySign=scanYSign(s.preset,pediatricDisplay),cx=w/2,baseScale=Math.min((w-45)/(2*p.depth*Math.sin(rad(p.sector/2))),(h-65)/p.depth),scale=baseScale*display.zoom,cy=(ySign===1?28:h-32)+ySign*p.depth*.55*(baseScale-scale);projection={cx,cy,scale,ySign};
  $('orientation-note').textContent=ySign===-1?'Vértice abajo · presentación pediátrica':'Vértice arriba';
  const left=ySign*Math.PI/2-rad(p.sector/2),right=ySign*Math.PI/2+rad(p.sector/2),sector=new Path2D();sector.moveTo(cx,cy);sector.arc(cx,cy,p.depth*scale,left,right);sector.closePath();
  ctx.save();ctx.clip(sector);ctx.fillStyle=s.mode==='echo'?'#030405':'#0b141c';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#20313c';ctx.lineWidth=.5;ctx.setLineDash([2,5]);for(const [depth] of depthTicks(p.depth)){ctx.beginPath();ctx.arc(cx,cy,depth*scale,0,Math.PI*2);ctx.stroke()}ctx.setLineDash([]);
  for(const cut of active.cuts){const m=byId.get(cut.id),path=pathFor(cut,scale,cx,cy,ySign);ctx.save();
    if(s.mode==='anatomy'){ctx.globalAlpha=selected&&selected!==m.id?.13:.50;ctx.fillStyle=colorFor(m);ctx.fill(path,'evenodd');ctx.globalAlpha=selected&&selected!==m.id?.20:1;ctx.strokeStyle=selected===m.id?'#fbe499':colorFor(m);ctx.lineWidth=selected===m.id?2.5:1.1}
    else{ctx.globalAlpha=clamp(s.gain*.45,.1,.9);ctx.fillStyle=ctx.createPattern(speckle,'repeat');ctx.fill(path,'evenodd');ctx.globalAlpha=clamp(.52*s.gain,.1,1);ctx.strokeStyle=selected===m.id?'#fbe499':'#e2e6e9';ctx.lineWidth=selected===m.id?2.6:1.8;ctx.shadowColor='#b4c9d9';ctx.shadowBlur=2.5}
    ctx.beginPath();const a=cut.segments;for(let i=0;i<a.length;i+=4){ctx.moveTo(cx+a[i]*scale,cy+ySign*a[i+1]*scale);ctx.lineTo(cx+a[i+2]*scale,cy+ySign*a[i+3]*scale)}ctx.stroke();ctx.restore();
  }ctx.restore();
  if(s.mode==='echo'&&(display.contrast!==1||display.tgc.some(v=>v!==50))){const raster=ctx.getImageData(0,0,scan.width,scan.height);applyDisplayTone(raster,projection,ratio,p,display);ctx.putImageData(raster,0,0)}
  ctx.strokeStyle='#314753';ctx.lineWidth=1;ctx.stroke(sector);
  ctx.fillStyle='#63ddc8';ctx.beginPath();ctx.arc(cx+Math.sin(rad(p.sector/2))*20,cy+ySign*Math.cos(rad(p.sector/2))*20,3,0,Math.PI*2);ctx.fill();
  ctx.font='10px Segoe UI';ctx.fillStyle='#95a7b4';ctx.textAlign='right';ctx.fillText('MARCADOR →',w-10,16);ctx.textAlign='left';ctx.fillText(s.mode==='echo'?'ECO SINTÉTICO · SIN ACÚSTICA':'CORTE ANATÓMICO',10,16);
  for(const [depth,label] of depthTicks(p.depth)){const x=cx+depth*scale*Math.sin(rad(p.sector/2)),y=cy+ySign*depth*scale*Math.cos(rad(p.sector/2));ctx.textAlign='left';ctx.fillText(label,x+5,y)}
  ctx.textAlign='left';ctx.font='10px Consolas';ctx.fillStyle='#8aa1ae';ctx.fillText(`T ${s.tilt.toFixed(0)}°  R ${s.rock.toFixed(0)}°  ROT ${s.rotation.toFixed(0)}°  Z ${display.zoom.toFixed(1)}×`,12,h-10);
  if(crosshair){const q=toPlane(p,crosshair);if(Math.abs(q[2])<1e-5){const x=cx+q[0]*scale,y=cy+ySign*q[1]*scale;ctx.strokeStyle='#ffe98c';ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x+7,y);ctx.moveTo(x,y-7);ctx.lineTo(x,y+7);ctx.stroke()}}
  drawCalipers();instrument?.update();
}
new ResizeObserver(()=>renderScan()).observe($('scan-view'));
scan.addEventListener('click',e=>{
  if(!active||realEcho())return;
  if(simEcho()&&dop.mode&&dop.geom){const rr=scan.getBoundingClientRect(),py=e.clientY-rr.top;if(py>dop.geom.hImg){const g=dop.geom,sp=dop.spec;if(sp&&py>=g.y0&&py<=g.y0+g.H){dop.caliper=sp.top-(py-g.y0)/g.H*(sp.top-sp.bottom);renderScan()}return}}const r=scan.getBoundingClientRect(),[x,y]=screenToPlane(projection,e.clientX-r.left,e.clientY-r.top);if(!inSector(x,y,active.pose))return;
  if(display.measuring){addCaliper(x,y);return}
  if(simEcho()&&dop.mode){aimDoppler(x,y);return}
  if(simEcho()&&engine.params.color.on){moveColorBox(x,y);return}
  if(imageOnly)return; // naming what was clicked would give the answer away
  let best=7/projection.scale,found=null,point=null;
  for(const cut of active.visible){const a=cut.segments;for(let i=0;i<a.length;i+=4){const ax=a[i],ay=a[i+1],dx=a[i+2]-ax,dy=a[i+3]-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1),px=ax+t*dx,py=ay+t*dy,d=Math.hypot(x-px,y-py);if(d<best){best=d;found=cut.id;point=toWorld(active.pose,px,py)}}}
  if(found)select(found,point);
});
// ---------------------------------------------------------------- simulated B-mode display
function simProjection(w,h,p,ySign){const baseScale=Math.min((w-45)/(2*p.depth*Math.sin(rad(p.sector/2))),(h-72)/p.depth),scale=baseScale*display.zoom,cy=(ySign===1?28:h-44)+ySign*p.depth*.55*(baseScale-scale);return {cx:w/2,cy,scale,ySign}}
function ecgValue(t){const g=(c,w,a)=>{const d=((t-c+.5)%1+1)%1-.5;return a*Math.exp(-d*d/(2*w*w))};return g(.9,.022,.13)+g(-.014,.005,-.12)+g(0,.007,1)+g(.018,.007,-.28)+g(.3,.04,.26)}
function drawECG(x,y,w,h){ctx.save();ctx.strokeStyle='#2fe07a';ctx.lineWidth=1.2;ctx.beginPath();const span=2;for(let i=0;i<=w;i+=2){const t=phase-span+span*i/w,v=ecgValue(t);const yy=y+h*.72-v*h*.62;i?ctx.lineTo(x+i,yy):ctx.moveTo(x+i,yy)}ctx.stroke();
 ctx.fillStyle='#2fe07a';ctx.beginPath();ctx.arc(x+w,y+h*.72-ecgValue(phase)*h*.62,2.4,0,Math.PI*2);ctx.fill();ctx.font='10px Consolas';ctx.textAlign='right';ctx.fillText(`FC ${heartRate}${beatSpeed!==1?` · ${String(beatSpeed).replace('.',',')}×`:''}`,x+w,y+8);
 const sys=phase<.36;ctx.textAlign='left';ctx.fillStyle=sys?'#ffb454':'#7fb6ff';if(engine.params.beating)ctx.fillText(sys?'SÍSTOLE':'DIÁSTOLE',x,y+8);ctx.restore()}
function applyContrast(img,c){const lut=new Uint8Array(256);for(let v=0;v<256;v++)lut[v]=255*(v/255)**c;const a=img.data;for(let i=0;i<a.length;i+=4){a[i]=lut[a[i]];a[i+1]=lut[a[i+1]];a[i+2]=lut[a[i+2]]}}
// ---------------------------------------------------------------- machine display: frame rate, persistence, overlay, maneuver HUD
// acquisition frame rate: every scan line waits for the echo from the full depth (2·depth / c); 2 lines per
// transmit (multi-line acquisition); colour adds an ensemble of ~10 pulses per colour line inside the box
function frameRate(){const d=state.depth,c=1540,lines=Math.round(state.sector/.55)/2;let t=lines*2*d/c;const col=engine.params.color;if(simEcho()&&col.on)t+=Math.round(2*col.roi.half/1.5)*10*2*d*col.roi.r1/c;return Math.min(120,1/t)}
const PERSIST_NEW=[1,.5,.32,.2]; // weight of a new frame in the running average
const frameBuf=document.createElement('canvas'),persistBuf=document.createElement('canvas');let persistKey='',lastBlended=null;
let gesture=null,hud=null;
const HUD_GLYPH={rotation:d=>d>0?'↻':'↺',rock:d=>d>0?'▶':'◀',tilt:()=>'⤢',x:d=>d>0?'⇥':'⇤',z:d=>d>0?'⇡':'⇣'};
// say what a probe input did, in the same words as the hints, while the student moves (keys, sliders, drag, phone)
function noteManeuver(key,before,after){if(!HUD_GLYPH[key]||before===after)return;const now=performance.now();
 if(!gesture||gesture.key!==key||now-gesture.t>900)gesture={key,start:before,base:{...state,[key]:before}};gesture.t=now;
 const delta=key==='rotation'?((after-gesture.start+540)%360)-180:after-gesture.start;if(Math.abs(delta)<1e-6)return;
 const text=describeManeuver(gesture.base,key,delta);hud={text:`${HUD_GLYPH[key](delta)}  ${text[0].toUpperCase()}${text.slice(1)}`,t:now}}
// visible for 1.6 s and at least a few drawn frames (slow machines draw few frames per second)
function drawHud(w,y){if(!hud)return;const age=performance.now()-hud.t;hud.frames=(hud.frames||0)+1;if(age>1600&&hud.frames>4){hud=null;return}ctx.save();ctx.globalAlpha=age<1100||hud.frames<=3?1:Math.max(.15,1-(age-1100)/500);ctx.font='12px Segoe UI';const tw=ctx.measureText(hud.text).width+20;ctx.fillStyle='rgba(8,20,24,.82)';ctx.strokeStyle='#3f8f84';ctx.beginPath();ctx.roundRect((w-tw)/2,y,tw,22,11);ctx.fill();ctx.stroke();ctx.fillStyle='#bafcef';ctx.textAlign='center';ctx.fillText(hud.text,w/2,y+15);ctx.restore()}
const probeName=f=>f>=7?'S12-4':f>=4.5?'S8-3':'S5-1';
// depth ruler on the right edge: a dot per cm, labels, and the transmit focus as a triangle
function drawRuler(p,cy,scale,ySign,w){const dPhys=physical(p.depth),x=w-12;ctx.save();ctx.fillStyle='#7f939f';ctx.font='10px Consolas';ctx.textAlign='right';
 const label=dPhys<=.07?1:dPhys<=.13?2:5;for(let c=0;c<=dPhys*100+1e-6;c++){const y=cy+ySign*(c/100/BODY.k)*scale;ctx.fillRect(x-1,y-1,c%label?2:4,2);if(c&&c%label===0)ctx.fillText(String(c),x-5,y+3)}
 const fy=cy+ySign*display.focus*p.depth*scale;ctx.fillStyle='#ffd166';ctx.beginPath();ctx.moveTo(x+6,fy-5);ctx.lineTo(x+1,fy);ctx.lineTo(x+6,fy+5);ctx.closePath();ctx.fill();ctx.restore()}
function drawSim(){
 const w=scanWidth,h=scanHeight,ratio=Math.min(devicePixelRatio,1.7);if(!w||!h)return;const p=poseFromState(state),ySign=scanYSign(state.preset,pediatricDisplay);
 const hImg=dop.mode?Math.round(h*.55):h; // spectral Doppler shares the screen with the 2D image (top)
 projection=simProjection(w,hImg,p,ySign);const {cx,cy,scale}=projection;
 ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#05080b';ctx.fillRect(0,0,scan.width,scan.height);
 // the screen only shows the frames the machine acquired: at a low frame rate motion gets choppy
 const fr=frameRate(),perBeat=fr*60/heartRate,shown=engine.params.beating&&!frozen?Math.floor(phase*perBeat)/perBeat:phase;
 const frame=engine.frameFor(shown);
 if(frame){const key=`${scan.width}x${scan.height}|${cx.toFixed(2)}|${cy.toFixed(2)}|${scale.toFixed(3)}|${ySign}|${display.contrast}`;let e=scanCache.get(frame);
  if(!e||e.key!==key){const img=ctx.createImageData(scan.width,scan.height);scanConvert(frame,img,projection,ratio);if(display.contrast!==1)applyContrast(img,display.contrast);e={key,img};scanCache.set(frame,e)}
  if(!display.persistence||frozen)ctx.putImageData(e.img,0,0);
  else{if(frameBuf.width!==scan.width||frameBuf.height!==scan.height){frameBuf.width=persistBuf.width=scan.width;frameBuf.height=persistBuf.height=scan.height;persistKey=''}
   const pc=persistBuf.getContext('2d');if(persistKey!==e.key){persistKey=e.key;pc.putImageData(e.img,0,0);lastBlended=frame}
   else if(lastBlended!==frame){frameBuf.getContext('2d').putImageData(e.img,0,0);pc.globalAlpha=PERSIST_NEW[display.persistence];pc.drawImage(frameBuf,0,0);pc.globalAlpha=1;lastBlended=frame}
   ctx.drawImage(persistBuf,0,0)}}
 ctx.setTransform(ratio,0,0,ratio,0,0);
 const left=ySign*Math.PI/2-rad(p.sector/2),right=ySign*Math.PI/2+rad(p.sector/2),sector=new Path2D();sector.moveTo(cx,cy);sector.arc(cx,cy,p.depth*scale,left,right);sector.closePath();
 if(overlayContours&&active){ctx.save();ctx.clip(sector);for(const cut of active.cuts){const m=byId.get(cut.id);ctx.strokeStyle=selected===m.id?'#fbe499':colorFor(m);ctx.globalAlpha=selected===m.id?.95:.55;ctx.lineWidth=selected===m.id?2:1;ctx.beginPath();const a=cut.segments;for(let i=0;i<a.length;i+=4){ctx.moveTo(cx+a[i]*scale,cy+ySign*a[i+1]*scale);ctx.lineTo(cx+a[i+2]*scale,cy+ySign*a[i+3]*scale)}ctx.stroke()}ctx.restore()}
 ctx.strokeStyle='#263842';ctx.lineWidth=1;ctx.stroke(sector);
 ctx.fillStyle='#63ddc8';ctx.beginPath();ctx.arc(cx+Math.sin(rad(p.sector/2))*20,cy+ySign*Math.cos(rad(p.sector/2))*20,3,0,Math.PI*2);ctx.fill();
 // machine-style annotations: probe and preset, mode and frequency, frame rate, gain / dynamic range / persistence
 const fmt1=v=>v.toFixed(1).replace('.',','),gDB=Math.round(20*Math.log10(state.gain)*1.6);
 ctx.font='10px Consolas';ctx.textAlign='left';ctx.fillStyle='#b9c7cf';ctx.fillText(`${probeName(display.freq)} · ${patient.id==='adult'?'CARD ADULTO':'CARD PED'}`,10,14);
 ctx.fillStyle='#95a7b4';ctx.fillText(`${display.thi?'THI':'FUND'} ${fmt1(display.freq)} MHz · FR ${Math.round(fr)} Hz`,10,27);ctx.fillText(`G ${gDB>=0?'+':''}${gDB} dB · DR ${display.dr} · P ${['off','baja','media','alta'][display.persistence]}`,10,40);
 ctx.textAlign='right';ctx.fillText(`${patient.name} · SC ${fmt1(bsaHaycock(patient.weight,patient.height))} m²`,w-10,14);ctx.fillStyle='#5f7482';ctx.fillText('ECO SIMULADO · NO DIAGNÓSTICO',w-10,27);
 drawRuler(p,cy,scale,ySign,w);
 ctx.textAlign='left';ctx.fillStyle='#8aa1ae';ctx.fillText(`T ${state.tilt.toFixed(0)}°  R ${state.rock.toFixed(0)}°  ROT ${state.rotation.toFixed(0)}°  Z ${display.zoom.toFixed(1)}×`,12,dop.mode?hImg-8:h-48);
 if(frozen&&engine.params.beating){ctx.textAlign='right';ctx.fillStyle='#ffd166';ctx.fillText(`CONGELADO · cine ${Math.floor(phase*CINE_PHASES)+1}/${CINE_PHASES} (← →)`,w-24,dop.mode?hImg-8:h-48)}
 drawHud(w,48);
 if(!frame){ctx.fillStyle='#8aa1ae';ctx.font='12px Segoe UI';ctx.textAlign='center';ctx.fillText(engine.failed?'Simulador no disponible: '+engine.failed:'Simulando la imagen…',w/2,h/2)}
 if(crosshair&&active){const q=toPlane(p,crosshair);if(Math.abs(q[2])<1e-4){const x=cx+q[0]*scale,y=cy+ySign*q[1]*scale;ctx.strokeStyle='#ffe98c';ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x+7,y);ctx.moveTo(x,y-7);ctx.lineTo(x,y+7);ctx.stroke()}}
 drawColorBox(p,cx,cy,scale,ySign);drawDopplerCursor(p,cx,cy,scale,ySign);drawCalipers();if(dop.mode)drawSpectrum(w,h,hImg);else drawECG(12,h-34,w-24,28);
}
// ---------------------------------------------------------------- spectral Doppler (PW / CW)
const dop={mode:null,theta:0,depth:.55,baseline:.5,scale:null,spec:null,key:'',pending:false,caliper:null,beat:0};
let specCanvas=null;
function dopSpec(){const p=poseFromState(state);return {pose:p,theta:dop.theta,gateDepth:dop.depth*p.depth,gateLen:.003,mode:dop.mode,freq:display.freq,scale:dop.mode==='cw'?(dop.scale||4):dop.scale,baseline:dop.baseline,gain:1,bodyScale:BODY.k}}
let dopTimer=0;
const specKey=spec=>JSON.stringify([spec.pose.origin,spec.pose.u,spec.pose.d,spec.theta,spec.gateDepth,spec.mode,spec.freq,spec.scale,spec.baseline,spec.bodyScale,chdVariantKey]);
function requestSpectrum(){if(!dop.mode||!ready)return;clearTimeout(dopTimer);dopTimer=setTimeout(async()=>{const spec=dopSpec(),key=specKey(spec);if(key===dop.key)return;dop.key=key;
 if(dop.optimize){dop.optimize=false;spec.optimize={range:10,step:1}}
 const sp=await engine.spectrum(spec);if(dop.key!==key)return;
 if(spec.optimize)dop.optimized=(dop.optimized||0)+1;
 if(sp.theta!==spec.theta){dop.theta=sp.theta;dop.key=specKey({...spec,theta:sp.theta});renderScan()} // the worker refined the cursor angle
 dop.spec=sp;updateDopReadout()},160)}
let chdVariantKey='normal';
function setDopMode(mode){if(!ready)return;if(mode&&(state.mode!=='echo'||echoSource!=='sim')){state.mode='echo';echoSource='sim';$('echo-source').value='sim';for(const m of ['anatomy','echo'])$(`mode-${m}`).classList.toggle('active',m==='echo');$('echo-tools').hidden=false;$('sim-tools').hidden=false;syncControls()}
 dop.mode=dop.mode===mode?null:mode;dop.spec=null;dop.key='';dop.caliper=null;dop.scale=null;$('dop-tools').hidden=!dop.mode;$('dop-scale').innerHTML=dop.mode==='cw'?[2,3,4,5,6].map(v=>`<option value="${v}"${v===4?' selected':''}>Escala ${v} m/s</option>`).join(''):'<option value="">Escala: Nyquist</option><option value="0.5">±0,5 m/s</option><option value="1">±1,0 m/s</option><option value="1.5">±1,5 m/s</option>';
 requestSpectrum();renderScan();instrument?.update();status(dop.mode?`Doppler ${dop.mode.toUpperCase()} · pulsa la imagen para colocar ${dop.mode==='pw'?'el volumen de muestra':'la línea'}`:'Doppler espectral apagado')}
function aimDoppler(x,y){dop.theta=Math.max(-45,Math.min(45,Math.atan2(x,y)*180/Math.PI));dop.depth=Math.max(.05,Math.min(.97,Math.hypot(x,y)/poseFromState(state).depth));dop.caliper=null;requestSpectrum();renderScan()}
function updateDopReadout(){const sp=dop.spec;if(!sp)return;
 // after 'Medir con Doppler continuo', move the baseline so the jet envelope has the whole screen
 if(dop.autoBase&&Math.abs(sp.vPeak)>.5){dop.autoBase=false;const b=sp.vPeak>0?.15:.85;if(b!==dop.baseline){dop.baseline=b;$('dop-baseline').value=String(b);requestSpectrum();return}}
 status(`${sp.mode==='pw'?'PW':'CW'} · Vmáx ${Math.abs(sp.vPeak).toFixed(2)} m/s (${sp.vPeak>=0?'hacia':'alejándose de'} la sonda) · ΔP ${(4*sp.vPeak*sp.vPeak).toFixed(0)} mmHg`)}
function drawDopplerCursor(p,cx,cy,scale,ySign){if(!dop.mode)return;const t=rad(dop.theta),R=p.depth*scale,ex=cx+Math.sin(t)*R,ey=cy+ySign*Math.cos(t)*R;ctx.save();ctx.strokeStyle='rgba(240,240,240,.8)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);
 if(dop.mode==='pw'){const r=dop.depth*p.depth*scale,g=.0015/BODY.k*scale+2,px=cx+Math.sin(t)*r,py=cy+ySign*Math.cos(t)*r,nx=Math.cos(t),ny=-ySign*Math.sin(t);ctx.lineWidth=2;for(const s of [-1,1]){const qx=px+Math.sin(t)*g*s,qy=py+ySign*Math.cos(t)*g*s;ctx.beginPath();ctx.moveTo(qx-nx*6,qy-ny*6);ctx.lineTo(qx+nx*6,qy+ny*6);ctx.stroke()}}
 ctx.restore()}
function drawSpectrum(w,h,hImg){
 const x0=44,y0=hImg+4,W=w-x0-12,H=h-hImg-44,sp=dop.spec;ctx.save();ctx.fillStyle='#000';ctx.fillRect(0,hImg,w,h-hImg);
 ctx.strokeStyle='#22313a';ctx.strokeRect(x0,y0,W,H);
 const windowBeats=2.4,beatNow=dop.beat;
 dop.geom={x0,y0,W,H,hImg};
 if(sp){const IW=Math.max(1,Math.round(W)),IH=Math.max(1,Math.round(H));if(!specCanvas||specCanvas.width!==IW||specCanvas.height!==IH){specCanvas=document.createElement('canvas');specCanvas.width=IW;specCanvas.height=IH}
  const sc=specCanvas.getContext('2d'),img=sc.createImageData(IW,IH),a=img.data;
  for(let x=0;x<IW;x++){const b=beatNow-windowBeats*(1-x/IW),c=Math.floor((((b%1)+1)%1)*sp.cols);for(let yy=0;yy<IH;yy++){const k=Math.min(sp.bins-1,Math.floor(yy/IH*sp.bins)),v=sp.data[k*sp.cols+c],i=(yy*IW+x)*4;a[i]=v*.96;a[i+1]=v;a[i+2]=v*1.04;a[i+3]=255}}
  sc.putImageData(img,0,0);ctx.drawImage(specCanvas,x0,y0,W,H);
  // velocity axis and baseline
  const vy=v=>y0+(sp.top-v)/(sp.top-sp.bottom)*H;ctx.font='10px Consolas';ctx.fillStyle='#9fb2bd';ctx.textAlign='right';const step=[.25,.5,1,2].find(v=>v*H/(sp.top-sp.bottom)>=15)||2;
  for(let v=Math.ceil(sp.bottom/step)*step;v<=sp.top+1e-9;v+=step){const y=vy(v);ctx.fillText(v.toFixed(step<.5?2:1),x0-4,y+3);ctx.strokeStyle='#1c2a32';ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x0+4,y);ctx.stroke()}
  ctx.strokeStyle='#7fb6ff';ctx.beginPath();ctx.moveTo(x0,vy(0));ctx.lineTo(x0+W,vy(0));ctx.stroke();ctx.fillText('m/s',x0-4,y0+H+12);
  ctx.textAlign='left';ctx.fillStyle='#e6edf2';ctx.fillText(sp.mode==='pw'?`PW · Nyquist ${sp.nyquist.toFixed(2)} m/s`:'CW',x0+6,y0+12);
  const vmax=Math.abs(sp.vPeak);ctx.fillStyle='#ffe398';ctx.fillText(`Vmáx ${vmax.toFixed(2)} m/s · ΔP máx ${(4*vmax*vmax).toFixed(0)} mmHg`,x0+6,y0+26);
  if(sp.mode==='pw'&&sp.angle!=null&&sp.angle>20){ctx.fillStyle='#ffb454';ctx.fillText(`Ángulo haz-flujo ≈ ${sp.angle.toFixed(0)}°: la velocidad se subestima (× cos θ)`,x0+6,y0+40)}
  if(sp.mode==='pw'&&sp.blocked){ctx.fillStyle='#ffb454';ctx.fillText('El trayecto hasta el volumen de muestra está bloqueado (costilla o pulmón)',x0+6,y0+40)}
  if(sp.mode==='pw'&&vmax>sp.nyquist*1.02){ctx.fillStyle='#ff9c8a';ctx.fillText('Aliasing: supera el límite de Nyquist → prueba CW o baja la línea base',x0+6,y0+54)}
  if(dop.caliper!=null){const y=vy(dop.caliper);ctx.strokeStyle='#ffe398';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x0+W,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffe398';ctx.textAlign='right';ctx.fillText(`${dop.caliper.toFixed(2)} m/s · ${(4*dop.caliper*dop.caliper).toFixed(0)} mmHg`,x0+W-4,y-4)}
 }else{ctx.fillStyle='#8aa1ae';ctx.font='12px Segoe UI';ctx.textAlign='center';ctx.fillText('Calculando el espectro…',x0+W/2,y0+H/2)}
 // ECG under the spectrum, same time axis
 ctx.strokeStyle='#2fe07a';ctx.lineWidth=1.2;ctx.beginPath();for(let x=0;x<=W;x+=2){const b=beatNow-windowBeats*(1-x/W),yy=h-20-ecgValue(((b%1)+1)%1)*20;x?ctx.lineTo(x0+x,yy):ctx.moveTo(x0+x,yy)}ctx.stroke();
 ctx.restore()}
// ---------------------------------------------------------------- colour Doppler controls
function setColor(values){engine.set({color:{...engine.params.color,...values}});$('color-tools').hidden=!engine.params.color.on;requestSim(false);instrument?.update()}
function colorToggle(){if(!ready)return;if(state.mode!=='echo'||echoSource!=='sim'){state.mode='echo';echoSource='sim';$('echo-source').value='sim';for(const m of ['anatomy','echo'])$(`mode-${m}`).classList.toggle('active',m==='echo');$('echo-tools').hidden=false;$('sim-tools').hidden=false;syncControls()}setColor({on:!engine.params.color.on});status(engine.params.color.on?'Doppler color activo · pulsa la imagen para mover la caja':'Doppler color apagado')}
function moveColorBox(x,y){const c=engine.params.color,p=poseFromState(state),span=(c.roi.r1-c.roi.r0)*p.depth,r=Math.hypot(x,y),lim=p.sector/2,half=c.roi.half;
 setColor({roi:{...c.roi,center:Math.max(-lim+half*.5,Math.min(lim-half*.5,Math.atan2(x,y)*180/Math.PI)),r0:Math.max(.02,(r-span/2)/p.depth),r1:Math.min(1,(r+span/2)/p.depth)}})}
function focusColorOn(point){if(!point)return;setColor({on:true,roi:roiAround(poseFromState(state),point,{half:engine.params.color.roi.half,span:.05})})}
$('dop-scale').onchange=()=>{const v=$('dop-scale').value;dop.scale=v?Number(v):null;dop.caliper=null;requestSpectrum()};
$('dop-baseline').onchange=()=>{dop.baseline=Number($('dop-baseline').value);dop.caliper=null;requestSpectrum()};
// CW line through a lesion at its systolic position (the heart moves under a fixed line). Each lesion is measured
// from the window that best aligns the beam with its jet, as in practice.
const CW_PLAN={ebstein:{view:'a4c',why:'apical 4 cámaras: el jet de insuficiencia tricuspídea va alineado con el haz'},vsdpm:{view:'plax',why:'paraesternal largo: el jet de la CIV va hacia la sonda'},vsdm:{view:'plax',why:'paraesternal largo: jet hacia la sonda'},coarct:{view:'ssn',why:'supraesternal: el haz sigue la aorta descendente'},lvh:{view:'a3c',why:'apical 3 cámaras: el tracto de salida alineado con el haz'},pda:{view:'psaxAV',why:'eje corto inclinado hacia la bifurcación pulmonar: el jet ductal vuelve por el tronco hacia la sonda'}};
function cwTarget(id){const plan=CW_PLAN[id],t=simViews?.[plan.view];if(!t)return null;if(id!=='pda')return t;
 const lm=engine.landmarks,pv=lm.pulmonaryValve,dp=lm.ductPulmonary,tgt=pv.map((v,i)=>v+(dp[i]-v)*.6),o=t.origin,unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)},cr=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const d=unit(sub(tgt,o)),n=unit(cr(d,sub(dp,pv)));let u=unit(cr(d,n));if(u[0]+u[2]<0)u=u.map(v=>-v);return {origin:o,d,u,n:unit(cr(u,d)),depth:.15,sector:80,meta:{center:tgt,landmarks:{}}}}
async function cwOnLesion(id){const plan=CW_PLAN[id];let pt=lesionPosition(id);if(!plan||!pt||!ready)return;
 if(id==='pda'){const lm=engine.landmarks;pt=lm.ductPulmonary.map((v,i)=>v+(lm.pulmonaryValve[i]-v)*.25)}
 const target=cwTarget(id);if(target){const {solveState}=await import('./views.mjs');const sol=solveState(target,PRESET_OF_WINDOW[VIEW_INFO[plan.view].window]);applyState({...sol.state,depth:physical(target.depth),mode:'echo'})}
 const m=new HeartMotion(engine.landmarks),cur=m.forward(pt,.8),p=poseFromState(state),q=cur.map((v,i)=>v-p.origin[i]),x=q[0]*p.u[0]+q[1]*p.u[1]+q[2]*p.u[2],y=q[0]*p.d[0]+q[1]*p.d[1]+q[2]*p.d[2];
 if(dop.mode!=='cw')setDopMode('cw');dop.autoBase=true;dop.optimize=true;dop.scale=5;$('dop-scale').value='5';aimDoppler(x,y);status(`CW desde ${plan.why}. Ajustando el ángulo…`)}
$('color-scale').onchange=()=>setColor({nyquist:Number($('color-scale').value)});
$('color-size').onchange=()=>setColor({roi:{...engine.params.color.roi,half:Number($('color-size').value)}});
function drawColorBox(p,cx,cy,scale,ySign){const c=engine.params.color;if(!c.on)return;const r=c.roi,a0=ySign*Math.PI/2-rad(r.center+r.half)*ySign,a1=ySign*Math.PI/2-rad(r.center-r.half)*ySign;
 // angles on canvas: a beam at angle θ (toward +u, image right) is drawn at canvas angle π/2−θ (ySign=1)
 const t0=rad(r.center-r.half),t1=rad(r.center+r.half),R0=r.r0*p.depth*scale,R1=r.r1*p.depth*scale,pt=(t,R)=>[cx+Math.sin(t)*R,cy+ySign*Math.cos(t)*R];
 ctx.save();ctx.strokeStyle='rgba(230,236,240,.75)';ctx.lineWidth=1;ctx.beginPath();let q=pt(t0,R0);ctx.moveTo(...q);for(let i=0;i<=24;i++)ctx.lineTo(...pt(t0+(t1-t0)*i/24,R0));for(let i=0;i<=24;i++)ctx.lineTo(...pt(t1-(t1-t0)*i/24,R1));ctx.closePath();ctx.stroke();
 // colour bar
 const bx=14,by=36,bh=90;for(let i=0;i<bh;i++){const w=1-2*i/bh,v=Math.round(w*127)+128;ctx.fillStyle=`rgb(${COLOR_MAP[v*3]},${COLOR_MAP[v*3+1]},${COLOR_MAP[v*3+2]})`;ctx.fillRect(bx,by+i,9,1)}
 ctx.font='10px Consolas';ctx.fillStyle='#cfd8de';ctx.textAlign='left';ctx.fillText(`+${c.nyquist.toFixed(1)}`,bx+12,by+8);ctx.fillText(`−${c.nyquist.toFixed(1)}`,bx+12,by+bh);ctx.fillText('m/s',bx+12,by+bh/2+3);ctx.restore()}
function stopSweep(){sweeping=false;$('sweep').textContent='▶ Barrido';$('sweep').classList.remove('active');if(active&&active.id===revision)status(frozen?'Plano congelado':'Vistas sincronizadas')}
function preset(key){if(frozen||!ready)return;stopSweep();Object.assign(state,defaultState(key),{mode:state.mode,gain:state.gain});selected=null;crosshair=null;syncControls();requestSlice()}
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>preset(b.dataset.preset));
$('reset-pose').onclick=()=>preset(state.preset);$('reset-camera').onclick=()=>{beam?.setFollow(false);views.forEach(resetCamera)};
$('expose').onchange=()=>{if(active)views.forEach(v=>updateView(v,active.pose))};
for(const mode of ['anatomy','echo'])$(`mode-${mode}`).onclick=()=>{if(frozen||(imageOnly&&mode==='anatomy'))return;state.mode=mode;$('echo-tools').hidden=mode!=='echo';for(const m of ['anatomy','echo'])$(`mode-${m}`).classList.toggle('active',m===mode);if(!realEcho())references?.video.pause();syncControls();requestSlice()};
$('echo-source').onchange=()=>{if($('echo-source').value==='volume'){location.href='echo4d.html';return}echoSource=$('echo-source').value;$('sim-tools').hidden=echoSource!=='sim';requestSim(false);display.measuring=false;display.points=[];crosshair=null;if(active)views.forEach(v=>updateView(v,active.pose));if(!realEcho())references?.video.pause();syncControls();renderScan();renderStructures()};
$('freeze').onclick=()=>{if(!ready)return;frozen=!frozen;if(realEcho()){if(frozen){resumeAfterFreeze=!references.video.paused;references.video.pause()}else if(resumeAfterFreeze){resumeAfterFreeze=false;references.video.play().catch(()=>{})}}stopSweep();$('freeze').textContent=frozen?'Reanudar':'Congelar';$('freeze').classList.toggle('active',frozen);syncControls();status(frozen?'Plano congelado':'Vistas sincronizadas')};
$('sweep').onclick=()=>{if(!ready||frozen)return;if(sweeping){stopSweep();return}sweeping=true;sweepStart=performance.now();sweepBase=state.tilt;$('sweep').textContent='■ Detener barrido';$('sweep').classList.add('active')};

$('display-orientation').onchange=()=>{pediatricDisplay=$('display-orientation').value==='pediatric';renderScan();tutor?.observe(teachingSnapshot())};

const composite=document.createElement('canvas');composite.width=1440;composite.height=720;const cc=composite.getContext('2d');
function compositeFrame(){
  cc.fillStyle='#0a1118';cc.fillRect(0,0,1440,720);cc.fillStyle='#dcf3ee';cc.font='23px Segoe UI';cc.fillText('CARDIOLAB / ECO INTERACTIVO',24,35);
  const names=['Sonda en el tórax','Plano anatómico',realEcho()?'Clip real procesado · sin registro 3D':'Imagen 2D del mismo plano'];[...views.map(v=>v.renderer.domElement),scan].forEach((canvas,i)=>{cc.fillStyle='#b0c2cc';cc.font='16px Segoe UI';cc.fillText(names[i],24+480*i,75);const scale=Math.min(450/canvas.width,530/canvas.height),w=canvas.width*scale,h=canvas.height*scale;cc.drawImage(canvas,24+480*i+(450-w)/2,100+(530-h)/2,w,h)});
  cc.fillStyle='#8fa3b0';cc.font='13px Segoe UI';cc.fillText(realEcho()?'Atlas estático + clip real independiente · ajustes digitales · sin registro espacial ni validación clínica':`Atlas estático · corte sintético · presentación ${pediatricDisplay?'pediátrica':'vértice arriba'} · no validado clínicamente`,24,662);
  if(active)cc.fillText(`${PRESETS[active.state.preset].name}  |  Tilt ${active.state.tilt.toFixed(1)}° · Rock ${active.state.rock.toFixed(1)}° · Rotación ${active.state.rotation.toFixed(1)}°`,24,691);
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function exportMetadata(poses=[]){return {application:'CardioLab Echo 0.1',created:new Date().toISOString(),source:manifest.source,license:manifest.license,geometrySHA256:manifest.geometrySHA256,anatomy:'Adult reference atlas; procedural torso',image:realEcho()?'Processed frames of acquired echocardiography video; no spatial registration to atlas':'mesh-plane section; synthetic display, no acoustic propagation',video:realEcho()?videoImage.metadata():null,clipLicense:realEcho()?'User supplied; not covered by atlas license; no public distribution authorization established':null,clinicalValidation:false,cardiacMotion:false,patient:{...patient,bsa:bsaHaycock(patient.weight,patient.height),bodyScale:BODY.k,note:'Adult atlas scaled linearly by bodyScale; lengths in this file are atlas units unless stated'},recordedCardiacMotion:realEcho(),processing:realEcho()?{gain:state.gain,...displaySnapshot()}:null,console:displaySnapshot(),presentation:{videoNativeOrientation:realEcho(),atlasPediatric:pediatricDisplay,pediatric:pediatricDisplay,ySign:active?scanYSign(active.state.preset,pediatricDisplay):1},pose:active?.pose,controls:active?.state,poses}}
$('capture').onclick=()=>{if(!active||active.id!==revision)return;compositeFrame();composite.toBlob(blob=>download(blob,'CardioLab_Eco_captura.png'));download(new Blob([JSON.stringify(exportMetadata(),null,2)],{type:'application/json'}),'CardioLab_Eco_posicion.json')};
let lastRecordingUrls=[];
function presentRecording(blob,metadata){
  for(const url of lastRecordingUrls)URL.revokeObjectURL(url);
  const videoUrl=URL.createObjectURL(blob),metadataUrl=URL.createObjectURL(new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'}));lastRecordingUrls=[videoUrl,metadataUrl];
  const ext=recordingExtension(blob.type),link=$('download-video');link.href=videoUrl;link.download=`CardioLab_Eco_barrido.${ext}`;link.textContent=`Descargar ${ext.toUpperCase()}`;
  $('download-positions').href=metadataUrl;$('download-positions').download='CardioLab_Eco_barrido_posiciones.json';
  $('recording-result').hidden=false;$('recording-message').textContent=ext==='mp4'?'MP4 listo. Pulsa Descargar MP4 para guardarlo.':'Este navegador solo pudo grabar WebM. Puedes guardarlo aquí; para grabar MP4, abre el simulador en Edge actualizado.';
  $('recording-result').dataset.format=ext;
  $('recording-result').scrollIntoView({block:'nearest',behavior:'smooth'});
}
$('record').onclick=()=>{
  if(recording){if(recording.recorder.state==='recording')recording.recorder.stop();return}if(!active)return;
  if(!window.MediaRecorder||!composite.captureStream){status('Este navegador no permite grabar; usa Capturar.',true);return}
  compositeFrame();const stream=composite.captureStream(20),chunks=[];let recorder;
  try{recorder=createVideoRecorder(stream)}catch(e){stream.getTracks().forEach(t=>t.stop());status(e.message,true);return}
  poseLog.length=0;poseLog.push({t:0,pose:active.pose,controls:active.state,display:displaySnapshot()});const session={recorder,start:performance.now(),stream,lastFrame:0,failed:false};recording=session;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const cleanup=()=>{stream.getTracks().forEach(t=>t.stop());if(recording===session)recording=null;$('record').textContent='● Grabar 10 s';$('record').disabled=false;$('record').classList.remove('active');instrument?.update()};
  recorder.onerror=()=>{session.failed=true;cleanup();status('No se pudo grabar el clip. Reintenta en Edge actualizado.',true)};
  recorder.onstop=()=>{
    const metadata=exportMetadata([...poseLog]),blob=new Blob(chunks,{type:recorder.mimeType});cleanup();
    if(session.failed)return;
    if(!blob.size){status('El clip quedó vacío. Graba durante al menos un segundo.',true);return}
    metadata.recording={mimeType:recorder.mimeType,extension:recordingExtension(recorder.mimeType),sizeBytes:blob.size};presentRecording(blob,metadata);
  };
  try{recorder.start()}catch(e){cleanup();status('No se pudo iniciar la grabación: '+e.message,true);return}
  $('record').classList.add('active');$('record').disabled=true;setTimeout(()=>{if(recording===session){$('record').disabled=false;instrument?.update()}},300);instrument?.update();
};
function openInfo(title,html){$('info-title').textContent=title;$('info-body').innerHTML=html;$('info').showModal()}
$('close-info').onclick=()=>$('info').close();$('help').onclick=()=>openInfo('Cómo usarlo',`<ol><li><b>Elige una ventana</b> arriba (paraesternal, apical, subcostal o supraesternal). Es un punto de partida aproximado, como apoyar la sonda en el sitio correcto.</li><li><b>Mueve la sonda</b>: arrastra sobre el tórax para deslizarla y usa <b>Rotar</b>, <b>Inclinar (tilt)</b> y <b>Bascular (rock)</b>. El marcador de la sonda corresponde al lado derecho de la imagen; arriba a la derecha verás hacia qué hora del reloj torácico apunta.</li><li><b>Tu teléfono como sonda</b> (arriba, «Sonda: teléfono»): escanea el QR, sujeta el teléfono con la pantalla hacia ti, el borde inferior sobre el tórax de un muñeco o una almohada y el borde derecho como marcador. Elige la ventana, pulsa Calibrar y gira, inclina y bascula: la sonda virtual sigue al teléfono. El deslizamiento se hace con el panel táctil del teléfono.</li><li><b>Elige el paciente</b> (arriba, junto a Presentación): de recién nacido a adolescente. Cambian el tamaño del corazón y del tórax, la frecuencia cardíaca, la profundidad de partida y la frecuencia de la sonda; en un niño pequeño usa poca profundidad y más MHz.</li><li><b>Mira la imagen eco simulada</b>: se calcula en tiempo real atravesando un modelo acústico del tórax (costillas, pulmón, hígado, miocardio, sangre, pericardio). Las costillas y el pulmón dan sombra: si la imagen se oscurece, cambia de espacio intercostal o de ángulo.</li><li><b>Ajusta como en un ecógrafo</b>: ganancia, TGC, profundidad, sector, frecuencia (más MHz = más detalle y menos penetración), foco (triángulo en la escala de profundidad), rango dinámico, armónico (THI), persistencia y zoom. Arriba a la izquierda de la imagen ves sonda, modo, frecuencia de cuadros (FR) y ajustes, como en un equipo real: más profundidad, más sector o el color bajan la FR.</li><li><b>Cada maniobra se anuncia sobre la imagen</b> con las mismas palabras que las pistas (por ejemplo «bascula hacia el marcador»). El marcador está a la derecha de la imagen: D o + en «Bascular» dirige el haz hacia él. Congelado, ← → recorren el cine.</li><li><b>Entrenador de vistas</b>: elige una vista estándar y corrige la sonda hasta que el medidor llegue a verde. Pide pistas, mira la vista ideal o la solución. Cuando la domines, elige <b>Ponerme a prueba</b>: el corazón se oculta y solo te guía la imagen eco; al evaluar se revela tu plano frente al ideal.</li><li><b>Leer la imagen</b>: preguntas que genera el propio simulador (qué vista es, qué estructura marca la cruz, qué maniobra o qué ajuste corrige la imagen). Solo ves la eco; después puedes abrir ese plano en el simulador con el corazón visible. Lo que fallas vuelve a salir antes. Teclas 1–4 para responder.</li><li><b>Doppler color</b>: tecla Color de la consola. Pulsa la imagen para mover la caja y cambia la escala para ver el aliasing.</li><li><b>Diseño cabina</b> (arriba a la derecha): la sonda y una consola compacta quedan juntas bajo las imágenes, sin tener que desplazarte. TGC, «Consola completa» y los atajos están en la esquina de la consola. Teclado: flechas deslizan la sonda, Q/E rotan, W/S inclinan, A/D basculan (Mayús = paso fino), Espacio congela, +/− profundidad, coma/punto ganancia, C color, P/K Doppler PW/CW; la rueda sobre la eco cambia la profundidad. Pulsa <kbd>?</kbd> para ver todos.</li><li><b>Mapa del haz</b> (vista 02): las estructuras que cruza el plano se ven sólidas, con su corte dibujado y su nombre; el resto queda en transparencia. Cuando algo entra al haz parpadea con «+», y cuando sale queda un rótulo «−» unos segundos: si pierdes la mitral al inclinar, lo ves en 3D. Abajo, la línea central lista lo que atraviesa en orden de profundidad. «Como la imagen» pone el corte de frente, orientado como la eco (marcador a la derecha, sonda donde la muestra la pantalla) y lo sigue mientras mueves la sonda; arrastra la vista para salir.</li><li><b>Doppler espectral</b>: teclas PW y CW. Pulsa la imagen para colocar el volumen de muestra (PW) o la línea (CW); pulsa el espectro para medir una velocidad y su gradiente (4v²). Cambia la escala y la línea base para resolver el aliasing. En Cardiopatías, «Medir con Doppler continuo» lleva la sonda a la ventana que alinea el haz con el jet.</li><li><b>Cardiopatías</b>: carga una lesión (CIA, CIV, canal AV, ductus, coartación, derrame, hipertrofias) y búscala; o resuelve un caso incógnito.</li></ol><p>Ratón derecho: girar el tórax · ratón izquierdo sobre el corazón: girar la anatomía · rueda: acercar.</p>`);
const SOURCES=`<p><b>Qué es y qué no es.</b> CardioLab es una herramienta docente para aprender orientación, adquisición e interpretación básica de ecocardiografía pediátrica. No es un ecógrafo, no está validada clínicamente y no acredita competencia: complementa, no sustituye, la práctica supervisada.</p>
<p><b>Anatomía.</b> <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0), derivado de BodyParts3D / DBCLS (CC BY-SA 2.1 Japan): 38 estructuras cardíacas y la caja torácica. Es un corazón adulto de referencia, sin variantes. Para acercar el eje del ventrículo izquierdo a la orientación habitual se aplica al cargarlo una rotación rígida de 20° sobre el eje vertical; el tórax es una superficie ilustrativa. <a href="assets/LICENSE-anatomy.txt" target="_blank">Licencia y atribuciones</a>.</p>
<p><b>Tamaño del paciente.</b> El atlas es un corazón adulto. Para cada paciente (de recién nacido a adolescente) se escala toda la anatomía, tórax incluido, por un factor lineal √(SC / SC del adulto del atlas), con la superficie corporal (SC) de Haycock: las dimensiones cardíacas lineales crecen aproximadamente con SC<sup>0,5</sup>. La física acústica (atenuación, longitud de onda, anchura del haz, PRF del Doppler) no se escala: por eso en un niño pequeño se usan menos profundidad y más frecuencia. La proporción entre corazón y tórax y la orientación del corazón del lactante no se modelan; la frecuencia cardíaca y la frecuencia de sonda de partida son valores típicos por edad.</p>
<p><b>Puntuaciones Z.</b> El cáliper puede nombrar la medida y calcular su puntuación Z con las ecuaciones del <a href="https://doi.org/10.1161/CIRCIMAGING.117.006979" target="_blank" rel="noopener">Pediatric Heart Network (Lopez 2017)</a>: Z = (medida / SC<sup>α</sup> − media) / DE. Por ahora solo se incluyen los coeficientes verificados con el texto publicado (anillo mitral). Al escalar la anatomía con √SC, un corazón normal conserva su puntuación Z en todos los tamaños.</p>
<p><b>Imagen eco simulada.</b> Las mallas se convierten en un volumen de tejidos de 1 mm (miocardio, cavidades, válvulas, grandes vasos, pericardio, costillas) y un volumen torácico de 2,5 mm. Pulmón, hígado, diafragma y la vena cava inferior abdominal con las venas suprahepáticas son aproximaciones propias, porque el atlas no los incluye. El esternón y el xifoides se tratan como cartílago con núcleos de osificación, como en el niño: atenúan pero no bloquean. Las costillas quedan registradas con el corazón del atlas. La piel se ajusta al tórax: queda a pocos milímetros de la parrilla costal y a ~1,5 cm del corazón en las ventanas paraesternales (medidas del adulto, escaladas al paciente). El atlas dejaba además un espacio de 3–4 cm entre la parrilla costal y el ápex que en el paciente no existe: el corazón se ha desplazado 2 cm hacia la izquierda y adelante (en horizontal), con el tejido de alrededor adaptándose de forma suave y sin mover cuello, escotadura supraesternal ni manubrio; el volumen acústico, las mallas 3D y los puntos de referencia comparten exactamente esa deformación. El tejido profundo que aún queda entre costillas y corazón se muestra tenue. La textura del miocardio, el brillo del pericardio (sin saturar), el grosor irregular de los velos y la reverberación del campo cercano imitan el aspecto de una imagen armónica. Cada línea del sector se traza con atenuación dependiente de la frecuencia, reflexión especular según el ángulo, speckle fijado a la anatomía, sombra de costillas y pulmón, reverberaciones pleurales y la resolución del haz. Para acercarla a un equipo real se añaden heterogeneidad del tejido (agrupación del speckle y bordes irregulares), directividad del elemento, un velo de lóbulos laterales, ruido de campo cercano, reducción de speckle y un mapa de grises con rechazo. El modo armónico (THI, por defecto) se aproxima con sus efectos visibles: menos ruido cercano y lóbulos laterales, haz más estrecho, señal débil junto a la sonda y algo menos de penetración; no se simula la propagación no lineal. El foco de transmisión estrecha el haz a su profundidad. La frecuencia de cuadros se calcula con la profundidad, el sector y la caja de color, y la pantalla solo muestra los cuadros adquiridos. Es una simulación simplificada, sin valores medibles con significado clínico.</p>
<p><b>Doppler color.</b> Cada compartimento sanguíneo tiene un campo de dirección calculado por distancia geodésica entre su entrada y su salida (1 mm). Encima se aplican ondas E y A, la eyección y los retornos venosos, y las lesiones agregan jets (cortocircuitos, coartación, obstrucción del tracto de salida). La velocidad radial se muestra con límite de Nyquist, aliasing, filtro de pared y mosaico por turbulencia. Las velocidades son docentes, no mediciones, y no hay insuficiencias valvulares.</p>
<p><b>Doppler espectral.</b> PW promedia el flujo dentro de un volumen de muestra de 3 mm; su límite de Nyquist baja con la profundidad (PRF limitada por el trayecto de ida y vuelta) y las velocidades mayores se repliegan. CW suma todo el haz, que sale de una apertura de ~12 mm y converge en el foco, sin aliasing. Ambos incluyen filtro de pared, ensanchamiento espectral (mayor en flujo turbulento) y bloqueo por costilla o pulmón. El gradiente se estima con Bernoulli simplificada (ΔP = 4v²). Las curvas siguen el mismo campo de flujo docente: la CIV restrictiva es holosistólica, el ductus continuo, la coartación con cola diastólica y la obstrucción dinámica del tracto de salida con pico telesistólico. No sustituyen mediciones reales.</p>
<p><b>Latido.</b> Movimiento esquemático: contracción radial y descenso de la base de los ventrículos, apertura de válvulas AV (ondas E y A) y semilunares. El velo anterior mitral no existe en el atlas y se genera; los tiempos no corresponden a un paciente.</p>
<p><b>Vistas del entrenador.</b> Se calculan a partir de reparos anatómicos del atlas (ápex, válvulas, septos, arco aórtico), buscando una ventana libre de costillas y pulmón. Son vistas de referencia del modelo, no posiciones universales en pacientes.</p>
<p><b>Cardiopatías.</b> Cada lesión es una edición reversible del volumen acústico (por ejemplo, un defecto esférico en el septo o un derrame de 9 mm). Muestran dónde buscar y qué vista usar; no reproducen la morfología completa ni la hemodinámica.</p>
<p><b>Clips reales.</b> Vídeos aportados por el usuario, sin registro al atlas. No publicar sin anonimización y autorización.</p>
<p><b>Código.</b> Código abierto bajo <a href="LICENSE" target="_blank">licencia MIT</a>. La licencia MIT no cubre los datos anatómicos (CC BY-SA) ni el volumen 4D, que conservan sus licencias.</p>
<p><b>Curso.</b> Actividades originales con referencias a la <a href="https://www.asecho.org/wp-content/uploads/2024/02/2024-Peds-TTE_PIIS0894731723006223.pdf" target="_blank" rel="noopener">guía ASE de ecocardiografía pediátrica 2024</a>; terminología de maniobras según <a href="https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf" target="_blank" rel="noopener">ASE 2019</a>. Las guías no validan esta herramienta.</p>`;
$('sources').onclick=()=>openInfo('Alcance y fuentes',SOURCES);
// public build (no user clips): hide the real-clip entry points
if(window.CARDIOLAB_PUBLIC){document.querySelector('#echo-source option[value=real]')?.remove();$('reference-toggle').hidden=true}

let lastSweepRequest=0;
function animate(now){requestAnimationFrame(animate);frameCount++;videoImage?.tick();
  const dt=Math.min(.1,(now-lastTick)/1000);lastTick=now;if(!frozen&&engine.params.beating&&beatSpeed>0){phase=(phase+dt*heartRate/60*beatSpeed)%1;dop.beat+=dt*heartRate/60*beatSpeed}
  if(simEcho()&&ready&&active){if(simQuick&&!dragging&&!sweeping&&now-lastPoseChange>260)requestSim(false);drawSim()}if(sweeping&&ready&&!frozen&&now-lastSweepRequest>65){state.tilt=clamp(sweepBase+12*Math.sin((now-sweepStart)/1500),-60,60);syncControls();requestSlice();lastSweepRequest=now}beam?.frame(now,selected);for(const v of views){v.orbit.update();v.renderer.render(v.scene,v.camera)}if(recording){if(now-recording.lastFrame>50){compositeFrame();poseLog.push({t:now-recording.start,imageSource:realEcho()?'real-video':'atlas',video:realEcho()?videoImage.metadata():null,display:displaySnapshot(),gain:state.gain});recording.lastFrame=now}$('record').textContent=`■ ${Math.min(10,(now-recording.start)/1000).toFixed(1)} / 10 s`;if(now-recording.start>=10000&&recording.recorder.state==='recording')recording.recorder.stop()}}
async function boot(){
  manifest=await (await fetch('assets/anatomy.json')).json();const buffer=await (await fetch('assets/anatomy.bin')).arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==manifest.geometrySHA256)throw Error('La geometría no coincide con su manifiesto');
  meshes=manifest.objects.map(m=>{const positions=placeAtlasPositions(m.kind,new Float32Array(buffer,m.positionOffset,m.positionCount)),indices=new Uint32Array(buffer,m.indexOffset,m.indexCount);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();const item={...m,positions,indices,geometry};byId.set(m.id,item);return item});
  views=[makeView('patient-view',true),makeView('heart-view',false)];bindProbeDrag(views[0]);
  beam=mountBeamMap({view:views[1],byId,colorFor,onSelect:id=>{if(active)select(id,null)}});
  beam.onFollow=on=>{$('beam-align').classList.toggle('active',on);$('beam-align').setAttribute('aria-pressed',String(on));if(active)views.forEach(v=>updateView(v,active.pose))};
  $('beam-align').onclick=()=>{const p=active?.pose;if(!p)return;beam.setFollow(!beam.follow,p,scanYSign(state.preset,pediatricDisplay))};
  $('beam-map').onchange=()=>{beam.setEnabled($('beam-map').checked);$('beam-path').textContent=beam.enabled&&beam.path?'Línea central (cm): '+beam.path:'';if(active)views.forEach(v=>updateView(v,active.pose))};
  worker=new Worker('slice-worker.mjs',{type:'module'});worker.onmessage=event=>{if(event.data.type==='ready'){ready=true;$('course-toggle').disabled=false;syncControls();requestSlice()}else accept(event.data)};worker.onerror=e=>{status('Error del motor de corte: '+e.message,true);busy=false};worker.postMessage({type:'init',meshes:meshes.filter(m=>m.kind==='heart').map(m=>({id:m.id,positions:m.positions,indices:m.indices}))});
  requestAnimationFrame(animate);
  window.echoLab={engine,beam:()=>beam?.snapshot(),doppler:()=>({mode:dop.mode,optimized:dop.optimized||0,theta:dop.theta,depth:dop.depth,baseline:dop.baseline,scale:dop.scale,vPeak:dop.spec?.vPeak,nyquist:dop.spec?.nyquist,blocked:dop.spec?.blocked,variant:chdVariantKey,state:{...state}}),cwOnLesion:id=>cwOnLesion(id),aimDopplerAt:point=>{const p=poseFromState(state),q=point.map((v,i)=>v-p.origin[i]);aimDoppler(q[0]*p.u[0]+q[1]*p.u[1]+q[2]*p.u[2],q[0]*p.d[0]+q[1]*p.d[1]+q[2]*p.d[2])},landmarks:()=>engine.landmarks,sim:()=>({cached:engine.cached,failed:engine.failed,views:!!simViews,phase,source:echoSource,mode:state.mode}),apply:(n,o)=>applyState(n,o),showPanel:n=>showPanel(n),snapshot:()=>({...teachingSnapshot(),ready,revision,appliedRevision:active?.id,frozen,sweeping,recording:!!recording,state:{...state},active:active?.state,pose:active?.pose,selected,crosshair,intersections:active?.visible.map(c=>byId.get(c.id).sourceName),latencies:[...latencies],frameCount,geometrySHA256:manifest.geometrySHA256,sourceObjectCount:meshes.length,display:displaySnapshot(),reference:references?.snapshot(),videoImage:videoImage?.snapshot()}),cuts:()=>active?.cuts.map(c=>({id:c.id,segments:Array.from(c.segments),closedLoops:c.loops.length})),projection:()=>({...projection}),hud:()=>hud?.text||null,setPhase:p=>{phase=((p%1)+1)%1;dop.beat=phase},phone:{receive:m=>phone.receive(m),get calibrated(){return phone.calibrated}},views:()=>views.map(v=>({width:v.renderer.domElement.width,height:v.renderer.domElement.height,triangles:v.renderer.info.render.triangles}))};
}
function teachingSnapshot(){return {ready,revision,appliedRevision:active?.id,active:active?.state,pediatricDisplay,selectedName:selected?byId.get(selected)?.sourceName:null,intersections:active?.visible.map(c=>byId.get(c.id).sourceName)}}
function displaySnapshot(){return {...display,tgc:[...display.tgc],points:display.points.map(p=>[...p])}}
function logDisplay(){if(recording&&active)poseLog.push({t:performance.now()-recording.start,pose:active.pose,controls:active.state,display:displaySnapshot()})}
function setEchoMode(){if(frozen||state.mode==='echo')return false;state.mode='echo';$('mode-anatomy').classList.remove('active');$('mode-echo').classList.add('active');return true}
function setConsoleValue(key,value){if(!ready)return;if(['focus','dr','thi','persistence'].includes(key)){display[key]=value;if(key!=='persistence')requestSim(false);renderScan();logDisplay();return}if(key==='freq'){display.freq=value;requestSim(false);renderScan();logDisplay();return}if(realEcho()&&['depth','sector'].includes(key))return;if(realEcho()&&key==='gain'){state.gain=value;syncControls();renderScan();logDisplay();return}if(['gain','depth','sector'].includes(key)){if(frozen)return;if(key==='gain')setEchoMode();state[key]=value;syncControls();requestSlice()}else{display[key]=value;if(key==='contrast'&&setEchoMode()){syncControls();requestSlice()}else renderScan()}logDisplay()}
function addCaliper(x,y){if(realEcho()||!active||active.id!==revision||!inSector(x,y,active.pose))return;if(display.points.length===2)display.points=[];display.points.push([x,y]);crosshair=toWorld(active.pose,x,y);views.forEach(v=>updateView(v,active.pose));renderScan();logDisplay()}
// caliper distance in physical mm; with a named measurement, its PHN Z-score for this patient's BSA
function caliperText(){const mm=distanceMM(...display.points)*BODY.k,k=display.measureKind,z=k?zScore(k,mm/10,bsaHaycock(patient.weight,patient.height)):null;return `${mm.toFixed(1).replace('.',',')} mm${z!=null?` · ${PHN[k].name} ${formatZ(z)} (${PHN_SOURCE.label})`:''}`}
function setPatient(id){const p=PATIENT_BY_ID[id];if(!p)return;patient=p;try{localStorage.setItem(PATIENT_KEY,id)}catch{}
 setBodyScale(bodyScale(p));engine.set({bodyScale:BODY.k});heartRate=p.hr;display.freq=p.freq;display.points=[];crosshair=null;updatePatientUI();
 if(ready&&!frozen){stopSweep();state.depth=defaultState(state.preset).depth;syncControls();requestSlice()}else renderScan();
 dop.key='';requestSpectrum();instrument?.update();status(`Paciente: ${describePatient(p)}`)}
function updatePatientUI(){$('patient').value=patient.id;$('patient-info').textContent=`${patient.age} · SC ${bsaHaycock(patient.weight,patient.height).toFixed(2).replace('.',',')} m² · FC ${patient.hr}`;$('patient').title=describePatient(patient)}
$('patient').replaceChildren(...PATIENTS.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=`${p.name} · ${String(p.weight).replace('.',',')} kg`;return o}));$('patient').onchange=()=>setPatient($('patient').value);updatePatientUI();
function drawCalipers(){if(!active||!display.points.length)return;const {cx,cy,scale,ySign}=projection;ctx.save();ctx.strokeStyle='#ffe398';ctx.fillStyle='#ffe398';ctx.lineWidth=1.5;const points=display.points.map(p=>[cx+p[0]*scale,cy+p[1]*scale*ySign]);for(const [x,y] of points){ctx.beginPath();ctx.moveTo(x-5,y-5);ctx.lineTo(x+5,y+5);ctx.moveTo(x-5,y+5);ctx.lineTo(x+5,y-5);ctx.stroke()}if(points.length===2){ctx.beginPath();ctx.moveTo(...points[0]);ctx.lineTo(...points[1]);ctx.stroke();ctx.font='11px Consolas';ctx.textAlign='left';ctx.fillText(`${caliperText()}`,12,34)}ctx.restore()}
function moveCursor(dx,dy){if(realEcho()||!active||active.id!==revision)return;const q=crosshair?toPlane(active.pose,crosshair):[0,active.pose.depth*.55,0];const [x,y]=boundedCursor(q[0]+dx/projection.scale,q[1]+dy/(projection.scale*projection.ySign),active.pose);crosshair=toWorld(active.pose,x,y);views.forEach(v=>updateView(v,active.pose));renderScan()}
function explainConsole(mode){const texts={M:'Modo M registra la posición a lo largo de una línea frente al tiempo. Todavía no está implementado en el simulador; úsalo como concepto.',controls:'Arrastra las perillas hacia arriba o abajo; también aceptan rueda, flechas y un valor numérico. TGC modifica la intensidad por profundidad en el corte sintético y por bandas de imagen en el vídeo. Sobre un clip exportado los ajustes son digitales; no recuperan señal cruda, tejido fuera del encuadre ni información perdida. La orientación del vídeo se conserva. Zoom y contraste son ajustes de presentación. La esfera mueve un cursor sobre el plano 2D y su punto en 3D. Cáliper permite fijar dos puntos del corte: mide distancia geométrica del atlas, no una medida clínica calibrada. Congelar detiene la sonda y pausa el clip si está en Eco; se mantienen disponibles los ajustes de presentación. Restablecer imagen recupera valores docentes, no aplica optimización clínica.'};openInfo(mode==='controls'?'Consola: controles y perillas':`${mode} · concepto`, `<p>${texts[mode]}</p><p>Consola docente: no reproduce el software ni la calibración de un equipo comercial.</p>`)}
// cockpit layout and keyboard: probe nudges go through the same state as the sliders
const LIMITS={x:[-.11,.11],z:[-.155,.2],tilt:[-60,60],rock:[-50,50],depth:[.03,.24],gain:[.3,2.5],freq:[2,12],focus:[.1,.95]};
function nudgeProbe(key,delta){if(!ready||frozen)return;stopSweep();let v=state[key]+delta;if(key==='rotation')v=((v+540)%360)-180;else v=clamp(v,...LIMITS[key]);noteManeuver(key,state[key],v);state[key]=v;syncControls();requestSlice()}
// frozen: step through the cine loop (the frames of one beat), as with the trackball on a machine
function cineStep(d){if(!frozen||!simEcho())return;phase=(((Math.floor(phase*CINE_PHASES)+d)%CINE_PHASES+CINE_PHASES)%CINE_PHASES+.5)/CINE_PHASES;drawSim()}
function consoleValue(key){return ['freq','focus'].includes(key)?display[key]:state[key]}
function setFromKeys(key,value){const [lo,hi]=LIMITS[key];setConsoleValue(key,Number(clamp(value,lo,hi).toFixed(4)));instrument?.update()}
instrument=mountInstrument({snapshot:()=>({ready:ready&&!!active,state,display,frozen,imageOnly,realEcho:realEcho(),sim:simEcho(),color:simEcho()&&engine.params.color.on,dop:dop.mode,recording:!!recording}),colorToggle:()=>colorToggle(),dopplerMode:m=>setDopMode(m),set:setConsoleValue,tgc:(i,v)=>{if(!ready)return;display.tgc[i]=v;requestSim(false);if(setEchoMode()){syncControls();requestSlice()}else renderScan();logDisplay()},mode:mode=>$(`mode-${mode}`).click(),cursor:moveCursor,measure:on=>{if(realEcho())return;display.measuring=on;display.points=[];renderScan()},fixPoint:()=>{if(!active||!display.measuring)return;moveCursor(0,0);if(crosshair){const [x,y]=toPlane(active.pose,crosshair);addCaliper(x,y)}},clear:()=>{display.points=[];crosshair=null;if(active)views.forEach(v=>updateView(v,active.pose));renderScan()},reset:()=>{if(!ready||frozen)return;Object.assign(display,initialDisplay(),{freq:patient.freq});state.gain=1;state.depth=defaultState(state.preset).depth;state.sector=90;setEchoMode();syncControls();requestSlice();logDisplay()},explain:explainConsole,caliperText:()=>display.points.length===2?caliperText():null,measureKinds:Object.entries(PHN).map(([k,v])=>[k,v.name]),measureKind:k=>{display.measureKind=k;renderScan();logDisplay()}});
// phone as probe: orientation → tilt/rock/rotation, touch pad → slide (same state path as keys and sliders)
let phoneSliceAt=0,phoneSliceTimer=0;
function phoneAngles(a){if(!ready||frozen)return;stopSweep();let best=null;
 for(const k of ['tilt','rock','rotation']){const before=state[k],after=Number(a[k].toFixed(1)),d=Math.abs(k==='rotation'?((after-before+540)%360)-180:after-before);if(!best||d>best.d)best={k,before,after,d};state[k]=after}
 if(best&&best.d>.4)noteManeuver(best.k,best.before,best.after);lastInputAt=performance.now();syncControls();
 const now=performance.now();if(now-phoneSliceAt>60){phoneSliceAt=now;requestSlice()}else if(!phoneSliceTimer)phoneSliceTimer=setTimeout(()=>{phoneSliceTimer=0;phoneSliceAt=performance.now();requestSlice()},60)}
const phone=mountPhoneProbe({state:()=>state,ready:()=>ready,preset:key=>preset(key),applyAngles:phoneAngles,slide:(dx,dz)=>{if(dx)nudgeProbe('x',dx);if(dz)nudgeProbe('z',dz)},freeze:()=>$('freeze').click(),status:t=>status(t),
 info:()=>active?`${PRESETS[state.preset].name} · marcador ${Math.round(markerClock(active.pose.u))||12} h · T ${state.tilt.toFixed(0)}° R ${state.rock.toFixed(0)}° ROT ${state.rotation.toFixed(0)}°${frozen?' · CONGELADO':''}`:'Preparando…'});
$('phone-probe').onclick=()=>phone.open();
const cabina=mountCabina({nudge:nudgeProbe,set:setFromKeys,value:consoleValue,click:id=>$(id)?.click(),ready:()=>ready,frozen:()=>frozen,cine:cineStep});
references=mountReferenceClips({snapshot:()=>({...teachingSnapshot(),state,frozen}),preset,usingVideo:realEcho});
videoImage=mountVideoImage({references,snapshot:()=>({real:realEcho(),sim:simEcho(),mode:state.mode}),redraw:renderScan,resume:()=>{if(frozen){resumeAfterFreeze=false;$('freeze').click()}}});
references.video.addEventListener('play',()=>{if(realEcho()&&frozen)references.video.pause()});
tutor=mountTutor({snapshot:teachingSnapshot,prepare:key=>{if(frozen){frozen=false;$('freeze').textContent='Congelar';$('freeze').classList.remove('active');syncControls()}preset(key)}});
// ---------------------------------------------------------------- coach, congenital mode and side panels
function applyState(next,{animate=false}={}){
 if(!ready)return;stopSweep();if(frozen){frozen=false;$('freeze').textContent='Congelar';$('freeze').classList.remove('active')}
 if(next.mode&&next.mode!==state.mode){state.mode=next.mode;for(const m of ['anatomy','echo'])$(`mode-${m}`).classList.toggle('active',m===state.mode);$('echo-tools').hidden=state.mode!=='echo'}
 if(state.mode==='echo'&&echoSource!=='sim'){echoSource='sim';$('echo-source').value='sim';$('sim-tools').hidden=false}
 const keys=['x','z','tilt','rock','rotation','depth','sector'];
 if(!animate||(next.preset&&next.preset!==state.preset)){Object.assign(state,next);selected=null;crosshair=null;syncControls();requestSlice();return}
 const from={...state},t0=performance.now(),dur=1100;const wrap=d=>((d+540)%360)-180;
 const step=now=>{const k=Math.min(1,(now-t0)/dur),e=k<.5?2*k*k:1-(-2*k+2)**2/2;for(const key of keys){if(next[key]==null)continue;state[key]=key==='rotation'?from[key]+wrap(next[key]-from[key])*e:from[key]+(next[key]-from[key])*e}syncControls();requestSlice();if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step);
}
// image-only practice: the heart is hidden (3D heart, structure names, contours); only the echo image guides the probe
function setImageOnly(on){on=!!on;if(on===imageOnly)return;imageOnly=on;document.body.classList.toggle('image-only',on);
 if(on){overlayContours=false;$('sim-overlay').checked=false;selected=null;crosshair=null;display.measuring=false;display.points=[];beam?.setFollow(false);
  if(state.mode!=='echo'||(echoSource!=='sim'&&!engine.failed)){state.mode='echo';if(!engine.failed){echoSource='sim';$('echo-source').value='sim'}$('echo-tools').hidden=false;$('sim-tools').hidden=echoSource!=='sim';for(const m of ['anatomy','echo'])$(`mode-${m}`).classList.toggle('active',m==='echo');syncControls();requestSlice()}}
 for(const id of ['mode-anatomy','echo-source','sim-overlay'])$(id).disabled=on;
 if(views[0])for(const mesh of views[0].anatomical)mesh.visible=!on||byId.get(mesh.userData.id).kind!=='heart';
 for(const v of views)v.lesionMark.visible=!on&&!!lesion;
 if(active){views.forEach(v=>updateView(v,active.pose));renderStructures();renderScan()}instrument?.update()}
function setTgcAll(values){if(!ready)return;display.tgc=[...values];requestSim(false);renderScan();instrument?.update();logDisplay()}
const PRESET_OF_WINDOW={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'};
const LESION_AT={asd2:'asdSecundum',asd1:'asdPrimum',vsdpm:'vsdPerimembranous',vsdm:'vsdMuscular',avsd:'asdPrimum',pda:['ductAortic','ductPulmonary'],coarct:'ductAortic'};
function lesionPosition(id){const lm=engine.landmarks,k=LESION_AT[id];if(lm&&id==='lvh')return lm.aorticValve.map((v,i)=>v+(lm.mitralValve[i]-v)*.35); // subaortic outflow, where the septal bulge narrows it
 if(lm&&id==='ebstein'){const tv=lm.tricuspidValve,ax=lm.rvApex.map((v,i)=>v-tv[i]),l=Math.hypot(...ax);return tv.map((v,i)=>v+ax[i]/l*.019)} // displaced tricuspid coaptation
 if(!lm||!k)return null;if(Array.isArray(k))return k.map(n=>lm[n]).reduce((a,b)=>a.map((v,i)=>(v+b[i])/2));return lm[k]}
const panels={coach:$('coach'),drills:$('drills'),chd:$('chd')};let drills=null;let openPanel=null;
function showPanel(name){
 if(name!=='course'&&!$('tutor').hidden)$('course-toggle').click();
 for(const [k,el] of Object.entries(panels)){const on=k===name&&openPanel!==name;el.hidden=!on;$('tab-'+k).classList.toggle('active',on);$('tab-'+k).setAttribute('aria-expanded',String(on))}
 const leaving=openPanel;openPanel=name==='course'||openPanel===name?null:name;
 if(leaving==='coach'&&openPanel!=='coach')coach?.stop();if(leaving==='drills'&&openPanel!=='drills')drills?.stop();if(leaving==='chd'&&openPanel!=='chd')chd?.leave();if(openPanel==='chd')chd?.enter();
 $('practice-shell').classList.toggle('with-tutor',!!openPanel||!$('tutor').hidden);$('practice-shell').classList.toggle('with-drills',openPanel==='drills');
}
for(const k of Object.keys(panels))$('tab-'+k).onclick=()=>{if(!coach||!chd||!drills){status('Preparando el simulador…');return}showPanel(k)};
$('course-toggle').addEventListener('click',()=>{if(openPanel){for(const el of Object.values(panels))el.hidden=true;for(const k of Object.keys(panels))$('tab-'+k).classList.remove('active');if(openPanel==='coach')coach?.stop();if(openPanel==='drills')drills?.stop();if(openPanel==='chd')chd?.leave();$('practice-shell').classList.remove('with-drills');openPanel=null}},true);
$('sim-overlay').onchange=()=>{overlayContours=$('sim-overlay').checked};
$('beat-speed').onchange=()=>{const v=$('beat-speed').value;if(v==='off'){engine.set({beating:false});beatSpeed=0}else{engine.set({beating:true});beatSpeed=Number(v)}requestSim(false)};
$('sources-top').onclick=()=>$('sources').click();
$('echo-tools').hidden=state.mode!=='echo';
engine.ready.then(async()=>{
 simViews=await engine.getViews();
 try{const byName={};for(const m of meshes)if(m.kind==='heart')byName[m.sourceName]={sourceName:m.sourceName,positions:m.positions,indices:m.indices};beam?.setValves(buildValves(byName,engine.landmarks));if(active){beam.update(active,selected);views.forEach(v=>updateView(v,active.pose))}}catch(e){console.warn('valvas del mapa del haz',e)}
 // window presets start exactly on the reference views computed from the anatomy
 const BASE={plax:'plax',psax:'psaxPM',apical:'a4c',subcostal:'sc4c',ssn:'ssn'};
 for(const [k,v] of Object.entries(BASE)){const t=simViews[v];if(t)Object.assign(PRESETS[k],{x:t.origin[0],z:t.origin[2],target:t.origin.map((o,i)=>o+t.d[i]*.08),up:[...t.u]})}
 if(ready&&!frozen&&state.tilt===0&&state.rock===0&&state.rotation===0)preset(state.preset);
 const common={views:simViews,engine,state:()=>({...state}),apply:applyState,status:text=>status(text)};
 const ySign=w=>scanYSign(PRESET_OF_WINDOW[w]||'plax',pediatricDisplay);
 coach=mountCoach({...common,host:$('coach'),setTarget:setTargetPose,ySign,imageOnly:setImageOnly});
 drills=mountDrills({...common,host:$('drills'),ySign,setTgc:setTgcAll,visible:()=>openPanel==='drills'});
 chd=mountCHD({...common,host:$('chd'),onVariant:(spec,reveal)=>{chdVariantKey=spec.id+JSON.stringify(spec.params||{});setLesionMarker(reveal?lesionPosition(spec.id):null);requestSim(false);requestSpectrum()},colorOnLesion:id=>focusColorOn(lesionPosition(id)),cwOnLesion:id=>cwOnLesion(id)});
 if(ready)requestSim(false);
}).catch(e=>{console.error(e);status('Simulador eco no disponible: '+e.message,true);echoSource='synthetic';$('echo-source').value='synthetic'});
syncControls();boot().catch(e=>{console.error(e);status('No se pudo iniciar: '+e.message,true)});

