// Shared by the display, cutting worker and tests. Distances are in metres.
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const mul=(a,k)=>a.map(v=>v*k);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>Math.sqrt(dot(a,a));
export const unit=a=>{const l=norm(a);if(l<1e-10)throw Error('Eje degenerado');return mul(a,1/l)};
export const rad=d=>d*Math.PI/180;
export const rotate=(v,axis,angle)=>add(add(mul(v,Math.cos(angle)),mul(cross(axis,v),Math.sin(angle))),mul(axis,dot(axis,v)*(1-Math.cos(angle))));
function profile(z,points){for(let i=1;i<points.length;i++)if(z<=points[i][0]){const [a,va]=points[i-1],[b,vb]=points[i],t=Math.max(0,(z-a)/(b-a)),smooth=t*t*(3-2*t);return va+(vb-va)*smooth}return points.at(-1)[1]}
export function chestRadius(z){return profile(z,[[-.205,.134],[-.12,.153],[.035,.185],[.15,.205],[.235,.072],[.285,.055]])}
export function chestDepth(z){return profile(z,[[-.205,.105],[-.08,.12],[.03,.119],[.07,.1],[.1,.083],[.118,.074],[.135,.062],[.17,.064],[.235,.062],[.285,.055]])} // skin ≈1 cm in front of the sternum; suprasternal notch just above the manubrium
// The procedural chest sits CHEST_Y behind the atlas origin so that the chest wall in front of the heart has a
// realistic thickness. The atlas bones stay registered with the atlas heart (moving them with the skin put the
// sternum and the first ribs inside the mediastinum, behind the aortic arch).
export const CHEST_Y=.03,CHEST_X=-.0227;
export function surface(x,z){const rx=chestRadius(z),a=(x-CHEST_X)/rx;return [x,CHEST_Y-chestDepth(z)*Math.sqrt(Math.max(.06,1-a*a)),z]}
// The atlas heart points its apex ~20° more anteriorly than a typical heart; a rigid rotation about the vertical
// axis restores the usual orientation so that parasternal short-axis planes are reachable. Applied at load time,
// the source meshes are unchanged.
export const HEART_PIVOT=[-.002,.004,.007],HEART_ROT_DEG=20;
const HR=HEART_ROT_DEG*Math.PI/180,HC=Math.cos(HR),HS=Math.sin(HR);
export function heartPoint(p){const x=p[0]-HEART_PIVOT[0],y=p[1]-HEART_PIVOT[1];return [HEART_PIVOT[0]+x*HC-y*HS,HEART_PIVOT[1]+x*HS+y*HC,p[2]]}
export function heartDir(v){return [v[0]*HC-v[1]*HS,v[0]*HS+v[1]*HC,v[2]]}
export function placeAtlasPositions(kind,source){
 const out=new Float32Array(source);
 if(kind==='heart'){for(let i=0;i<out.length;i+=3){const x=out[i]-HEART_PIVOT[0],y=out[i+1]-HEART_PIVOT[1];out[i]=HEART_PIVOT[0]+x*HC-y*HS;out[i+1]=HEART_PIVOT[1]+x*HS+y*HC}}
 return out;
}
const RAW_PRESETS={
  plax:{name:'Paraesternal · eje largo',x:.020,z:.027,target:[.004,.009,.013],up:[-.46,.1,.88],goal:'Buscar VI, tracto de salida, raíz aórtica y aurícula izquierda.'},
  psax:{name:'Paraesternal · eje corto',x:.020,z:.027,target:[.012,-.001,-.005],up:[.88,.05,.46],goal:'Buscar una sección transversal del VI y su relación con el VD.'},
  apical:{name:'Apical · cuatro cámaras',x:.069,z:-.071,target:[-.014,.006,.012],up:[1,.18,.23],goal:'Relacionar ambos ventrículos con las aurículas y el plano auriculoventricular.'},
  subcostal:{name:'Subcostal · exploración',x:-.019,z:-.133,target:[-.008,.008,.004],up:[1,0,0],goal:'Explorar cámaras y septos desde un acceso inferior ilustrativo.'}
};
export const PRESETS=Object.fromEntries(Object.entries(RAW_PRESETS).map(([k,p])=>[k,{...p,target:heartPoint(p.target),up:heartDir(p.up)}]));
// Suprasternal notch (defined directly in placed coordinates): beam down and back toward the aortic arch.
PRESETS.ssn={name:'Supraesternal · arco aórtico',x:CHEST_X,z:.13,target:[-.012,.024,.094],up:[.35,0,.94],goal:'Buscar el arco aórtico, los vasos del cuello y la aorta descendente.'};
export function defaultState(preset='plax') {const p=PRESETS[preset];return {preset,x:p.x,z:p.z,tilt:0,rock:0,rotation:0,depth:{apical:.17,subcostal:.19,ssn:.16,plax:.15,psax:.14}[preset]??.16,sector:90,gain:1,mode:'anatomy'}}
export function poseFromState(s){
  const p=PRESETS[s.preset],base=surface(p.x,p.z),origin=surface(s.x,s.z);
  let d=unit(sub(p.target,base)),u=unit(sub(p.up,mul(d,dot(p.up,d))));
  let n=unit(cross(u,d));
  // Tilt changes planes about the lateral axis; rock remains in the plane.
  d=rotate(d,u,rad(s.tilt));n=unit(cross(u,d));
  d=rotate(d,n,rad(s.rock));u=rotate(u,n,rad(s.rock));
  u=rotate(u,d,rad(s.rotation));u=unit(u);d=unit(d);n=unit(cross(u,d));
  return {origin,u,d,n,depth:s.depth,sector:s.sector};
}
export function toWorld(p,x,y){return add(p.origin,add(mul(p.u,x),mul(p.d,y)))}
export function toPlane(p,v){const q=sub(v,p.origin);return [dot(q,p.u),dot(q,p.d),dot(q,p.n)]}
export function inSector(x,y,p){return y>=0&&Math.hypot(x,y)<=p.depth+1e-8&&Math.abs(Math.atan2(x,y))<=rad(p.sector/2)+1e-8}

// Presentation is separate from the physical probe basis; picking uses its exact inverse.
export const scanYSign=(preset,pediatric)=>pediatric&&['apical','subcostal'].includes(preset)?-1:1;
export const projectToScreen=(p,x,y)=>[p.cx+x*p.scale,p.cy+y*p.scale*(p.ySign??1)];
export const screenToPlane=(p,x,y)=>[(x-p.cx)/p.scale,(y-p.cy)/(p.scale*(p.ySign??1))];

// Exact triangle-plane intersections, prior to display clipping. No template images.
export function sliceMesh(positions,indices,pose){
  const n=pose.n,o=pose.origin,u=pose.u,d=pose.d,offset=dot(n,o),out=[];
  const distances=new Float64Array(positions.length/3);
  for(let i=0,j=0;i<positions.length;i+=3,j++)distances[j]=positions[i]*n[0]+positions[i+1]*n[1]+positions[i+2]*n[2]-offset;
  for(let t=0;t<indices.length;t+=3){
    const ids=[indices[t],indices[t+1],indices[t+2]],ds=ids.map(i=>distances[i]);
    if(ds.every(v=>v>1e-9)||ds.every(v=>v< -1e-9)||ds.every(v=>Math.abs(v)<1e-9))continue;
    const hits=[];
    for(let e=0;e<3;e++){
      const a=ids[e],b=ids[(e+1)%3],da=ds[e],db=ds[(e+1)%3];
      if((da<0&&db<0)||(da>0&&db>0)||Math.abs(da-db)<1e-12)continue;
      const f=da/(da-db);if(f<0||f>1)continue;
      const point=[0,1,2].map(k=>positions[a*3+k]+f*(positions[b*3+k]-positions[a*3+k])-o[k]);
      const hit=[dot(point,u),dot(point,d)];
      if(!hits.some(h=>Math.hypot(h[0]-hit[0],h[1]-hit[1])<1e-8))hits.push(hit);
    }
    if(hits.length===2)out.push(...hits[0],...hits[1]);
  }
  return new Float32Array(out);
}

// Only closed chains are filled. Open atlas surfaces remain contours, never invented tissue.
export function joinContours(segments){
  const nodes=new Map(),edges=[],key=(x,y)=>`${Math.round(x*1e6)},${Math.round(y*1e6)}`;
  for(let i=0;i<segments.length;i+=4){
    const a=key(segments[i],segments[i+1]),b=key(segments[i+2],segments[i+3]);if(a===b)continue;
    const e={a,b,used:false};edges.push(e);
    for(const [k,x,y] of [[a,segments[i],segments[i+1]],[b,segments[i+2],segments[i+3]]]){
      if(!nodes.has(k))nodes.set(k,{xy:[x,y],edges:[]});nodes.get(k).edges.push(e);
    }
  }
  const loops=[];
  for(const e of edges){
    if(e.used)continue;let start=e.a,current=start,edge=e,points=[],closed=false;
    for(let i=0;i<=edges.length;i++){
      points.push(nodes.get(current).xy);edge.used=true;current=edge.a===current?edge.b:edge.a;
      if(current===start){closed=true;break}
      const node=nodes.get(current);if(node.edges.length!==2)break;
      edge=node.edges.find(v=>!v.used);if(!edge)break;
    }
    if(closed&&points.length>=3)loops.push(points);
  }
  return loops;
}
