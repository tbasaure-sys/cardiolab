// Beam map for the "Plano en el corazón" view: which structures the ultrasound plane is crossing right now.
// Structures in the beam light up with their section drawn on the plane and a label; the rest become ghosts.
// When a structure enters or leaves the beam (sweeping, tilting) it flashes and a transient label says so.
// The central scan line lists what it crosses in depth order. Valves come from the same parametric annuli used by
// the simulated image, so "the mitral left the beam" in 3D matches what the echo shows.
import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {toWorld,inSector} from './geometry.mjs';

// short labels (paediatric cardiology usage in Spanish); the full name stays in the tooltip
const SHORT={'Aurícula derecha':'AD','Aurícula izquierda':'AI','Ventrículo derecho':'VD','Ventrículo izquierdo':'VI','Aorta ascendente':'Ao ascendente','Arco aórtico':'Arco aórtico','Aorta torácica':'Ao descendente','Tronco braquiocefálico':'T. braquiocefálico','Arteria carótida común izquierda':'Carótida izq.','Arteria subclavia izquierda':'Subclavia izq.','Tronco pulmonar':'Tronco pulmonar','Bifurcación pulmonar':'Bifurcación AP','Arteria pulmonar derecha':'APD','Arteria pulmonar izquierda':'API','Vena cava superior':'VCS','Vena cava inferior · porción torácica':'VCI','Vena pulmonar superior derecha':'VP sup. der.','Vena pulmonar inferior derecha':'VP inf. der.','Vena pulmonar superior izquierda':'VP sup. izq.','Vena pulmonar inferior izquierda':'VP inf. izq.','Músculo papilar inferior · VD':'Papilar VD','Músculo papilar anterior · VD':'Papilar VD','Músculo papilar septal · VD':'Papilar VD','Músculo papilar inferior · VI':'Papilar VI','Arteria coronaria derecha':'CD','Arteria coronaria izquierda':'TCI','Arteria interventricular anterior':'DA','Arteria circunfleja':'Cx','Seno coronario':'Seno coronario'};
const VALVE_OF=name=>name.startsWith('Valva mitral')?'mitral':name.startsWith('Valva tricúspide')?'tricuspid':name.startsWith('Valva aórtica')?'aortic':name.startsWith('Valva pulmonar')?'pulmonary':null;
const VALVE={mitral:{name:'Válvula mitral',color:0xfff1a8},tricuspid:{name:'Válvula tricúspide',color:0xffe0a0},aortic:{name:'Válvula aórtica',color:0xffffff},pulmonary:{name:'Válvula pulmonar',color:0xe8f4ff}};
// label priority: chambers and valves first, small vessels last
function priority(name){if(/^(Ventr|Aur)/.test(name))return 0;if(/^Válvula/.test(name))return 1;if(/Aorta|aórtico|Tronco pulmonar|Vena cava/.test(name))return 2;if(/pulmonar|Papilar|Músculo/.test(name))return 3;return 4}

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export function mountBeamMap({view,byId,colorFor,onSelect}){
 const host=view.host,layer=document.createElement('div');layer.className='beam-labels';host.append(layer);
 const material=new LineMaterial({linewidth:3.2,vertexColors:true,transparent:true,depthTest:false,worldUnits:false});
 const lines=new LineSegments2(new LineSegmentsGeometry(),material);lines.renderOrder=8;lines.frustumCulled=false;view.scene.add(lines);
 let prevPose=null,enabled=true,valves=[],inBeam=new Map(),ghosts=[],flashes=new Map(),pathText='',pose=null;
 const labels=new Map(); // key → element

 function setValves(list){valves=list||[]}
 // chord where the imaging plane cuts a valve apparatus (annulus plus leaflet length), as two world points
 function valveChord(v,p){
  const a=dot(v.e1,p.n),b=dot(v.e2,p.n),s=Math.hypot(a,b),R=v.R*1.05;let best=null;
  for(let t=0;t<=1.0001;t+=.1){const depth=(v.kind==='semilunar'?.6:1.1)*v.R*t,C=[0,1,2].map(i=>v.C[i]+v.nv[i]*depth),h=dot(sub(C,p.origin),p.n);
   if(s<.2){ // plane almost parallel to the annulus (short axis): the whole ring is in view
    if(Math.abs(h)<.004){const ring=[];for(let k=0;k<=24;k++){const f=2*Math.PI*k/24;ring.push(C.map((c,i)=>c+R*(Math.cos(f)*v.e1[i]+Math.sin(f)*v.e2[i])))}return {ring,center:C}}continue}
   const q=-h/(R*s);if(Math.abs(q)>1)continue;const phi0=Math.atan2(b,a),dphi=Math.acos(q),len=2*R*Math.sin(dphi);
   if(!best||len>best.len){const P=f=>C.map((c,i)=>c+R*(Math.cos(f)*v.e1[i]+Math.sin(f)*v.e2[i]));best={len,A:P(phi0+dphi),B:P(phi0-dphi)}}
  }
  return best&&best.len>.003?{A:best.A,B:best.B,center:best.A.map((x,i)=>(x+best.B[i])/2)}:null;
 }
 const planeXY=(p,w)=>{const q=sub(w,p.origin);return [dot(q,p.u),dot(q,p.d)]};

 function update(active,selected){
  if(!active)return;pose=active.pose;const p=pose,positions=[],colors=[],next=new Map(),col=new THREE.Color();
  const push=(A,B,c)=>{positions.push(...A,...B);col.set(c);colors.push(col.r,col.g,col.b,col.r,col.g,col.b)};
  // mesh sections inside the sector
  for(const cut of active.visible){const m=byId.get(cut.id);if(!m||m.kind!=='heart')continue;const valve=VALVE_OF(m.name),key=valve?'valve:'+valve:'mesh:'+m.id,name=valve?VALVE[valve].name:m.name;
   const s=cut.segments;let sx=0,sy=0,n=0;const pts=[];
   for(let i=0;i<s.length;i+=4){const mx=(s[i]+s[i+2])/2,my=(s[i+1]+s[i+3])/2;if(!inSector(mx,my,p))continue;push(toWorld(p,s[i],s[i+1]),toWorld(p,s[i+2],s[i+3]),valve?VALVE[valve].color:new THREE.Color(...m.color).offsetHSL(0,.1,.18));sx+=mx;sy+=my;n++;pts.push([mx,my])}
   if(!n)continue;const cx=sx/n,cy=sy/n;let anchor=pts[0],bd=1e9;for(const q of pts){const d=(q[0]-cx)**2+(q[1]-cy)**2;if(d<bd){bd=d;anchor=q}}
   const prev=next.get(key);if(prev){prev.ids.push(m.id);continue}
   next.set(key,{key,name,short:valve?name:(SHORT[m.name]||m.name),ids:[m.id],anchorXY:anchor,anchor:toWorld(p,anchor[0],anchor[1]),color:valve?'#'+new THREE.Color(VALVE[valve].color).getHexString():colorFor(m),prio:priority(name),pts})}
  // parametric valves (the atlas lacks the anterior mitral leaflet and one tricuspid leaflet)
  for(const v of valves){const c=valveChord(v,p);if(!c)continue;const key='valve:'+v.id,info=VALVE[v.id];let seg=[];
   if(c.ring){for(let k=0;k<c.ring.length-1;k++)seg.push([c.ring[k],c.ring[k+1]])}else seg=[[c.A,c.B]];
   const inside=seg.filter(([A,B])=>{const a=planeXY(p,A),b=planeXY(p,B);return inSector((a[0]+b[0])/2,(a[1]+b[1])/2,p)});if(!inside.length)continue;
   for(const [A,B] of inside)push(A,B,info.color);
   const mid=inside[Math.floor(inside.length/2)],anchor=mid[0].map((x,i)=>(x+mid[1][i])/2),xy=planeXY(p,anchor);
   const pts=inside.map(([A,B])=>{const a=planeXY(p,A),b=planeXY(p,B);return [(a[0]+b[0])/2,(a[1]+b[1])/2]});
   const e=next.get(key);if(e){e.pts.push(...pts);continue}
   next.set(key,{key,name:info.name+(c.ring?' · anillo en eje corto':''),short:info.name.replace('Válvula ','V. '),ids:[],anchorXY:xy,anchor,color:'#'+new THREE.Color(info.color).getHexString(),prio:1,pts})}
  const geo=new LineSegmentsGeometry();if(positions.length){geo.setPositions(positions);geo.setColors(colors)}lines.geometry.dispose();lines.geometry=geo;
  // entries and exits (a window jump changes everything at once: no fanfare then)
  const now=performance.now(),entered=[...next.keys()].filter(k=>!inBeam.has(k)),left=[...inBeam.keys()].filter(k=>!next.has(k));
  // a window jump (preset, solution) changes everything at once: no fanfare then; a maneuver, however fast, gets it
  const jump=!prevPose||Math.hypot(...sub(p.origin,prevPose.origin))>.015||Math.abs(dot(p.n,prevPose.n))<Math.cos(30*Math.PI/180)||Math.abs(dot(p.u,prevPose.u))<Math.cos(40*Math.PI/180);prevPose=p;
  if(inBeam.size&&!jump){
   for(const k of entered){const e=next.get(k);for(const id of e.ids)flashes.set(id,{t0:now,kind:'in'});e.enteredAt=now}
   for(const k of left){const e=inBeam.get(k);for(const id of e.ids)flashes.set(id,{t0:now,kind:'out'});ghosts.push({...e,t0:now})}
   ghosts=ghosts.sort((a,b)=>a.prio-b.prio).slice(0,6)
  }
  for(const [k,e] of next){const old=inBeam.get(k);if(old?.enteredAt&&!e.enteredAt)e.enteredAt=old.enteredAt}
  inBeam=next;ghosts=ghosts.filter(g=>now-g.t0<2600&&!inBeam.has(g.key));
  pathText=centralPath(p);
  lines.visible=enabled;
 }
 // what the central scan line crosses, in depth order
 function centralPath(p){const hits=[];
  for(const e of inBeam.values()){let best=null;for(const [x,y] of e.pts)if(Math.abs(x)<.0025&&(best==null||y<best))best=y;if(best!=null)hits.push([best,e.short])}
  hits.sort((a,b)=>a[0]-b[0]);return hits.map(([y,s])=>`${s} ${(y*100).toFixed(1).replace('.',',')}`).join(' → ')}

 function meshIdsInBeam(){const s=new Set();for(const e of inBeam.values())for(const id of e.ids)s.add(id);return s}
 // material state of the heart view: structures in the beam solid, the rest ghosted
 function style(selected){if(!enabled)return;const ids=meshIdsInBeam();
  for(const mesh of view.anatomical){const id=mesh.userData.id,chosen=selected===id,on=ids.has(id);mesh.material.opacity=chosen?1:on?(selected?.55:.9):(selected?.06:.1);mesh.material.depthWrite=false;mesh.userData.beamOn=on}}

 function frame(now,selected){
  stepCamera(now);
  if(!enabled){layer.hidden=true;return}layer.hidden=false;
  const w=view.renderer.domElement.clientWidth,h=view.renderer.domElement.clientHeight;material.resolution.set(w,h);
  // flashes: entering = bright glow, leaving = warm pulse that fades into the ghost
  for(const mesh of view.anatomical){const f=flashes.get(mesh.userData.id),mat=mesh.material;if(!f)continue;
   const k=(now-f.t0)/(f.kind==='in'?1100:1500);if(k>=1){flashes.delete(mesh.userData.id);mat.emissive.set(selected===mesh.userData.id?0x263b31:0);style(selected);continue}
   const a=Math.pow(1-k,1.5);if(f.kind==='in'){mat.emissive.setRGB(.55*a,.95*a,.8*a)}else{mat.emissive.setRGB(.9*a,.35*a,.2*a);mat.opacity=Math.max(mat.opacity,.1+.55*a)}}
  // labels: project, then place by priority avoiding overlaps
  const cam=view.camera,v=new THREE.Vector3(),placed=[],seen=new Set();
  const list=[...inBeam.values()].sort((a,b)=>a.prio-b.prio||a.anchorXY[1]-b.anchorXY[1]);
  const put=(e,cls,text)=>{let el=labels.get(cls+e.key);if(!el){el=document.createElement('button');el.className='beam-label '+cls;el.onclick=()=>{if(e.ids[0]!=null)onSelect(e.ids[0])};layer.append(el);labels.set(cls+e.key,el)}
   seen.add(cls+e.key);if(el.textContent!==text)el.textContent=text;el.title=e.name;el.style.setProperty('--c',e.color);
   v.set(...e.anchor).project(cam);if(v.z>1){el.hidden=true;return}const x=(v.x*.5+.5)*w,y=(-v.y*.5+.5)*h;
   const bw=el.offsetWidth||60,bh=el.offsetHeight||16;let ok=null;
   for(const [dx,dy] of [[8,-bh-6],[8,6],[-bw-8,-bh-6],[-bw-8,6],[8,-bh*2-8],[-bw-8,-bh*2-8]]){const r=[x+dx,y+dy,bw,bh];if(r[0]<2||r[1]<2||r[0]+bw>w-2||r[1]+bh>h-2)continue;if(!placed.some(q=>r[0]<q[0]+q[2]+3&&r[0]+bw+3>q[0]&&r[1]<q[1]+q[3]+2&&r[1]+bh+2>q[1])){ok=r;break}}
   if(!ok&&(cls!=='in-beam'||e.prio<=1)){for(const [dx,dy] of [[8,-bh-6],[-bw-8,6],[8,6],[-bw-8,-bh-6]]){const r=[x+dx,y+dy,bw,bh];if(r[0]>=2&&r[1]>=2&&r[0]+bw<=w-2&&r[1]+bh<=h-2){ok=r;break}}}
   if(!ok){el.hidden=true;return}placed.push(ok);el.hidden=false;el.style.transform=`translate(${ok[0]}px,${ok[1]}px)`;el.style.setProperty('--ax',`${x-ok[0]}px`);el.style.setProperty('--ay',`${y-ok[1]}px`);
   el.classList.toggle('selected',e.ids.includes(selected));el.classList.toggle('new',!!e.enteredAt&&now-e.enteredAt<1600)};
  for(const g of ghosts){if(now-g.t0<2600)put(g,'left-beam','− '+g.short)}
  let shown=0;for(const e of list){if(shown>=11&&e.prio>=3&&!e.ids.includes(selected)){const el=labels.get('in-beam'+e.key);if(el)el.hidden=true;seen.add('in-beam'+e.key);continue}put(e,'in-beam',(e.enteredAt&&now-e.enteredAt<1600?'+ ':'')+e.short);shown++}
  for(const [k,el] of labels)if(!seen.has(k)){el.remove();labels.delete(k)}
  ghosts=ghosts.filter(g=>now-g.t0<2600);
 }
 // camera "como la imagen": the section seen face-on, marker to the right and the probe where the echo shows it
 let follow=false,goal=null,onFollow=()=>{};
 function aim(p,ySign){const center=[0,1,2].map(i=>p.origin[i]+p.d[i]*p.depth*.5),n=[p.u[1]*p.d[2]-p.u[2]*p.d[1],p.u[2]*p.d[0]-p.u[0]*p.d[2],p.u[0]*p.d[1]-p.u[1]*p.d[0]],dist=p.depth*2.3;
  goal={target:new THREE.Vector3(...center),pos:new THREE.Vector3(...center.map((c,i)=>c-ySign*n[i]*dist)),up:new THREE.Vector3(...p.d.map(v=>-ySign*v))}}
 view.orbit.addEventListener('start',()=>{if(follow&&!aligning){follow=false;goal=null;onFollow(false)}});let aligning=false;
 function setFollow(on,p,ySign){follow=on;if(on&&p)aim(p,ySign);else goal=null;onFollow(on)}
 function track(p,ySign){if(follow)aim(p,ySign)}
 let lastStep=0;
 function stepCamera(now){const dt=Math.min(.25,(now-(lastStep||now))/1000);lastStep=now;if(!goal)return;const cam=view.camera,o=view.orbit,k=1-Math.exp(-dt/.22);aligning=true;
  cam.position.lerp(goal.pos,k);o.target.lerp(goal.target,k);cam.up.lerp(goal.up,k).normalize();cam.lookAt(o.target);
  if(cam.position.distanceTo(goal.pos)<1e-4&&cam.up.distanceTo(goal.up)<1e-3){cam.position.copy(goal.pos);cam.up.copy(goal.up);if(!follow)goal=null}aligning=false}
 function setEnabled(on){enabled=on;lines.visible=on;layer.hidden=!on;if(!on){for(const mesh of view.anatomical)mesh.material.emissive.setRGB(0,0,0);flashes.clear()}}
 return {update,style,frame,setEnabled,setValves,setFollow,track,set onFollow(f){onFollow=f},get follow(){return follow},get goalPosition(){return goal?.pos||null},get enabled(){return enabled},get path(){return pathText},snapshot:()=>({inBeam:[...inBeam.values()].map(e=>e.name),path:pathText,ghosts:ghosts.map(g=>g.name)})};
}
