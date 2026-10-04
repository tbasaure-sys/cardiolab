// Plane map: every standard view drawn at once on the 3D heart as a translucent fan with its short name, coloured by
// window (paraesternal, apical, subcostal, supraesternal). Shows how the views relate to each other; clicking a name
// goes to that view. The view the probe is closest to is highlighted.
import * as THREE from './node_modules/three/build/three.module.js';

export const WINDOW_COLORS={plax:'#5aa9ff',psax:'#3fd18b',apical:'#ffae42',subcostal:'#c58bff',ssn:'#ff6b7a'};

export function mountPlaneMap({view,targets,info,onGo}){
 const group=new THREE.Group();group.visible=false;view.scene.add(group);
 const layer=document.createElement('div');layer.className='plane-labels';layer.hidden=true;view.host.append(layer);
 const items=[],v3=new THREE.Vector3();let enabled=false,current=null,sized=false;
 for(const [id,t] of Object.entries(targets)){const meta=info[id];if(!meta||!t?.meta)continue;
  const color=new THREE.Color(WINDOW_COLORS[meta.window]||'#9fb3c1'),c=t.meta.center;
  // the fan reaches a little past the view's centre (the part of the plane that crosses the heart)
  const reach=Math.hypot(c[0]-t.origin[0],c[1]-t.origin[1],c[2]-t.origin[2])*1.45,half=(t.sector||80)/2*Math.PI/180,tri=[],edge=[];
  const at=(a,r)=>[0,1,2].map(i=>t.origin[i]+(t.d[i]*Math.cos(a)+t.u[i]*Math.sin(a))*r);let prev=null;
  for(let k=0;k<=32;k++){const a=-half+2*half*k/32,p=at(a,reach);edge.push(...p);if(prev)tri.push(...t.origin,...prev,...p);prev=p}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(tri,3));
  const fan=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.10,side:THREE.DoubleSide,depthWrite:false}));fan.renderOrder=2;
  const eg=new THREE.BufferGeometry();eg.setAttribute('position',new THREE.Float32BufferAttribute([...t.origin,...edge,...t.origin],3));
  const line=new THREE.Line(eg,new THREE.LineBasicMaterial({color,transparent:true,opacity:.45}));group.add(fan,line);
  const label=document.createElement('button');label.className='plane-label';label.textContent=meta.short;label.style.setProperty('--c',WINDOW_COLORS[meta.window]||'#9fb3c1');
  label.title=`${meta.name} · clic: ir a esta vista`;label.onclick=()=>onGo(id);layer.append(label);
  // the name sits on the fan's outer rim, along its central beam: around the heart rather than piled on its centre
  items.push({id,fan,line,label,anchor:at(0,reach*.97)})}
 function frame(){
  if(!enabled)return;const cam=view.camera,w=view.host.clientWidth,h=view.host.clientHeight,placed=[];
  // labels on each plane's rim, nudged down when they would overlap a label already placed
  // label sizes are measured once (reading them every frame after moving labels would force a layout per label)
  if(!sized){for(const it of items){it.bw=it.label.offsetWidth||40;it.bh=it.label.offsetHeight||16}sized=items[0]?.bw>0}
  const moves=[];
  for(const it of items){v3.set(...it.anchor).project(cam);if(v3.z>1){moves.push([it,null]);continue}
   let x=(v3.x*.5+.5)*w,y=(-v3.y*.5+.5)*h;const bw=it.bw,bh=it.bh;
   for(let k=0;k<6;k++){const hit=placed.find(p=>Math.abs(p[0]-x)<(bw+p[2])/2&&Math.abs(p[1]-y)<bh);if(!hit)break;y=hit[1]+bh+1}
   placed.push([x,y,bw]);moves.push([it,`translate(${Math.round(x-bw/2)}px,${Math.round(y-bh/2)}px)`])}
  for(const [it,t] of moves){if(!t){it.label.hidden=true;continue}it.label.hidden=false;if(it.t!==t){it.t=t;it.label.style.transform=t}}
 }
 function setCurrent(id){if(id===current)return;current=id;for(const it of items){const on=it.id===id;it.fan.material.opacity=on?.24:.10;it.line.material.opacity=on?.95:.45;it.label.classList.toggle('current',on)}}
 // while the map is on, the beam map's structure names step back (the structures stay highlighted)
 function setEnabled(on){enabled=!!on;sized=false;group.visible=enabled;layer.hidden=!enabled;view.host.classList.toggle('planes-on',enabled)}
 return {frame,setEnabled,setCurrent,get enabled(){return enabled}};
}
