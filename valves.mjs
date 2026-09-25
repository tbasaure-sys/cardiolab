// Valve leaflets as parametric moving surfaces, anchored to atlas landmarks (valve centres, flow axes).
// The atlas has incomplete leaflets (no anterior mitral leaflet, two tricuspid leaflets), so every valve is
// rebuilt as hinged sheets: closed ↔ open by rotating each leaflet about its annular hinge.
// The hinge is not a circle: landmarks.valveHinges gives, every 10° around the flow axis, how far the blood
// reaches before the first wall (lateral wall, septum, aortic root…), computed offline with computeHinges, so the
// leaflets grow out of the real walls (mitro-aortic continuity, septal tricuspid leaflet on the septum).
import {sliceMesh} from './geometry.mjs';
import {valveOpening} from './tissue.mjs';

const unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rad=d=>d*Math.PI/180;
function centroid(m){let s=[0,0,0],n=0;for(let i=0;i<m.positions.length;i+=3){s[0]+=m.positions[i];s[1]+=m.positions[i+1];s[2]+=m.positions[i+2];n++}return s.map(v=>v/n)}

// Leaflet: angular span [a0,a1] (deg, around the flow axis from reference direction), length factor,
// closed and open angles (deg) of the leaflet relative to the annulus plane (+ = downstream).
const DEFS={
 // mitral: the anterior leaflet (toward the aortic root) is long enough to approach the septum in diastole; open, the
 // tips leave an orifice of ~60% of the annulus (the «fish mouth» of the short axis), not leaflets flat on the walls
 mitral:{kind:'av',R:.0155,leaflets:[{name:'Velo anterior mitral',a0:-62,a1:62,len:1.42,closed:18,open:72},{name:'Velo posterior mitral',a0:62,a1:298,len:.78,closed:32,open:58}]},
 // tricuspid: reference direction = the septum; septal leaflet on it, anterior toward the outflow, posterior inferior
 tricuspid:{kind:'av',R:.017,leaflets:[{name:'Velo septal tricuspídeo',a0:-55,a1:55,len:.85,closed:22,open:60},{name:'Velo anterior tricuspídeo',a0:55,a1:180,len:1.1,closed:16,open:66},{name:'Velo posterior tricuspídeo',a0:180,a1:305,len:.8,closed:20,open:62}]},
 aortic:{kind:'semilunar',R:.0115,leaflets:[0,120,240].map((a,i)=>({name:['Velo coronario derecho','Velo coronario izquierdo','Velo no coronario'][i],a0:a+4,a1:a+116,len:1.04,closed:-14,open:82}))},
 pulmonary:{kind:'semilunar',R:.012,leaflets:[0,120,240].map((a,i)=>({name:'Velo pulmonar '+(i+1),a0:a+4,a1:a+116,len:1.04,closed:-14,open:82}))}
};
const NI=16,NJ=7;

export function buildValves(meshesByName,landmarks){
 const lm=landmarks,asc=meshesByName['Ascending aorta'],pt=meshesByName['Pulmonary trunk'];
 const axes={mitral:[lm.mitralValve,lm.lvApexCavity],tricuspid:[lm.tricuspidValve,lm.rvApex],aortic:[lm.aorticValve,asc?centroid(asc):null],pulmonary:[lm.pulmonaryValve,pt?centroid(pt):null]};
 const valves=[];
 for(const [id,def] of Object.entries(DEFS)){
  const [C,to]=axes[id];if(!C||!to)continue;const nv=unit(sub(to,C));
  // reference direction in the annulus plane: mitral/tricuspid toward the aortic valve (anterior leaflet faces the LVOT), semilunar toward the pulmonary/aortic valve
  const refPoint=id==='mitral'?lm.aorticValve:id==='tricuspid'?lm.mitralValve:id==='aortic'?lm.pulmonaryValve:lm.aorticValve;
  const r0=sub(refPoint,C),along=dot(r0,nv);const e1=unit(r0.map((v,i)=>v-along*nv[i]));let e2=unit(cross(nv,e1));
  if(id==='tricuspid'&&dot(e2,sub(lm.aorticValve,C))<0)e2=e2.map(v=>-v); // positive angles toward the outflow tract
  const hinge=lm.valveHinges?.[id]?Float32Array.from(lm.valveHinges[id]):null,R=hinge?hinge.reduce((a,b)=>a+b,0)/hinge.length:def.R;
  const leaflets=def.leaflets.map(L=>({...L,positions:new Float32Array((NI+1)*(NJ+1)*3),indices:indices()}));
  valves.push({id,kind:def.kind,C,nv,e1,e2,R,hinge,leaflets});
 }
 return valves;
}
// hinge radius at angle phi (radians from e1 toward e2)
function hingeR(v,phi){if(!v.hinge)return v.R;const n=v.hinge.length,f=((phi/(2*Math.PI)%1+1)%1)*n,i=Math.floor(f),t=f-i;return v.hinge[i%n]*(1-t)+v.hinge[(i+1)%n]*t}
// Offline: distance from the valve centre, in its plane, to the first wall in 36 directions (metres).
const PASS={mitral:[20,22,40],tricuspid:[21,23,41],aortic:[24,20,42],pulmonary:[25,21,43]}; // blood pools and valve voxels a hinge search may cross
export function computeHinges(valves,tissue){const out={};
 for(const v of valves){const pass=new Set(PASS[v.id]),r=[];
  for(let k=0;k<36;k++){const phi=k*Math.PI/18,d=[0,1,2].map(a=>Math.cos(phi)*v.e1[a]+Math.sin(phi)*v.e2[a]);let hit=null;
   for(let x=.002;x<v.R*1.8;x+=.0005){if(!pass.has(tissue.tissueAt(...[0,1,2].map(a=>v.C[a]+d[a]*x)))){hit=x;break}}
   r.push(Math.max(v.R*.6,Math.min(v.R*1.6,hit??v.R*1.6)))}
  const sm=r.map((_,k)=>[-2,-1,0,1,2].reduce((s,o)=>s+r[(k+o+36)%36],0)/5);out[v.id]=sm.map(x=>+x.toFixed(5))}
 return out}
function indices(){const idx=[];for(let i=0;i<NI;i++)for(let j=0;j<NJ;j++){const p=i*(NJ+1)+j,q=p+NJ+1;idx.push(p,q,q+1,p,q+1,p+1)}return new Uint32Array(idx)}

function shapeLeaflet(v,L,open,center){
 const P=L.positions;
 if(v.kind==='semilunar'){
  // cusp as a sagging pocket between two commissures: free edges run radially to the centre (the closed «Y»),
  // the belly sags upstream; opening swings the cusp against the arterial wall
  for(let i=0;i<=NI;i++){
   const u=i/NI,phi=rad(L.a0+(L.a1-L.a0)*u),c=Math.cos(phi),s=Math.sin(phi),Rp=hingeR(v,phi);
   const r=[c*v.e1[0]+s*v.e2[0],c*v.e1[1]+s*v.e2[1],c*v.e1[2]+s*v.e2[2]];
   for(let j=0;j<=NJ;j++){
    const t=j/NJ,radial=Rp*(1-t*(1-.86*open)),axial=-.5*v.R*Math.sin(Math.PI*u)*Math.sin(Math.PI*t*.9)*(1-open)+open*t*v.R*1.05;
    const k=(i*(NJ+1)+j)*3;for(let a=0;a<3;a++)P[k+a]=center[a]+r[a]*Math.max(.0004,radial)+v.nv[a]*axial;
   }
  }
  return;
 }
 const theta=rad(L.closed+(L.open-L.closed)*open),len=v.R*L.len;
 for(let i=0;i<=NI;i++){
  const phi=rad(L.a0+(L.a1-L.a0)*i/NI),c=Math.cos(phi),s=Math.sin(phi),Rp=hingeR(v,phi);
  const r=[c*v.e1[0]+s*v.e2[0],c*v.e1[1]+s*v.e2[1],c*v.e1[2]+s*v.e2[2]];
  // free edge scalloped between commissures (shorter near them)
  const edge=Math.sin(Math.PI*i/NI)**.6*.35+.65;
  for(let j=0;j<=NJ;j++){
   const t=j/NJ*edge,bend=Math.sin(Math.PI*t)*.12*len; // slight belly
   const radial=Rp-len*t*Math.cos(theta),axial=len*t*Math.sin(theta)+bend*(1-open*.7);
   const k=(i*(NJ+1)+j)*3;for(let a=0;a<3;a++)P[k+a]=center[a]+r[a]*Math.max(.0006,radial)+v.nv[a]*axial;
  }
 }
}

// Deform leaflets for a phase and slice them with the probe plane. Returns [{valve, segments}] in plane coordinates.
export function sliceValves(valves,pose,phase,motion,s){
 const out=[],tmp=[0,0,0];
 for(const v of valves){
  const open=phase==null?0:valveOpening(phase,v.kind==='av'?'av':'semilunar');
  let center=v.C;if(motion&&s){const back=motion.inverse(v.C,s,tmp,v.kind==='av'?1:.5);center=[2*v.C[0]-back[0],2*v.C[1]-back[1],2*v.C[2]-back[2]]}
  for(const L of v.leaflets){shapeLeaflet(v,L,open,center);const seg=sliceMesh(L.positions,L.indices,pose);if(seg.length)out.push({valve:v.id,leaflet:L.name,segments:seg})}
 }
 return out;
}
