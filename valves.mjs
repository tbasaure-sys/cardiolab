// Valve leaflets as parametric moving surfaces, anchored to atlas landmarks (valve centres, flow axes).
// The atlas has incomplete leaflets (no anterior mitral leaflet, two tricuspid leaflets), so every valve is
// rebuilt as hinged sheets: closed ↔ open by rotating each leaflet about its annular hinge. Closed AV leaflets meet
// at their coaptation (mitral line, tricuspid centre), so the valve seals in systole whatever the annulus shape.
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

// Leaflet: angular span [a0,a1] (deg, around the flow axis from reference direction) and open angle (deg, relative to the
// annulus plane, + = downstream). AV leaflets take their length from the coaptation geometry (mitral: len sets the
// anterior:posterior split of the orifice); semilunar cusps use len and closed as given.
const DEFS={
 // mitral: the anterior leaflet (toward the aortic root) spans a third of the annulus but is the longer one; open, the
 // tips leave an oval orifice (the «fish mouth» of the short axis), not leaflets flat on the walls
 mitral:{kind:'av',R:.0155,leaflets:[{name:'Velo anterior mitral',a0:-62,a1:62,len:1.42,open:72},{name:'Velo posterior mitral',a0:62,a1:298,len:.92,open:58}]},
 // tricuspid: reference direction = the septum; septal leaflet on it, anterior toward the outflow, posterior inferior
 // the tricuspid annulus is lower on the septum: its septal leaflet inserts closer to the apex than the mitral
 tricuspid:{kind:'av',R:.017,septalDrop:.006,leaflets:[{name:'Velo septal tricuspídeo',a0:-55,a1:55,open:60},{name:'Velo anterior tricuspídeo',a0:55,a1:180,open:66},{name:'Velo posterior tricuspídeo',a0:180,a1:305,open:62}]},
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
  const v={id,kind:def.kind,C,nv,e1,e2,R,hinge,leaflets,drop:def.septalDrop||0};
  if(def.kind==='av')coaptation(v);
  valves.push(v);
 }
 return valves;
}
// Where closed AV leaflets meet, in annulus-plane coordinates (x along e1, y along e2), coaptation hc below the annulus.
// Mitral: the «smile» — a curve through both commissures (the ends of the anterior leaflet, a third of the annulus)
// that bows back to split the orifice about 3:2 between the anterior and posterior leaflets, as their lengths.
// Tricuspid: the centre of its annulus (the three leaflets close as a «Y»).
function coaptation(v){
 let hm=0;for(let k=0;k<72;k++)hm+=hingeH(v,k*Math.PI/36)/72;v.hc=v.R*.36+hm;
 if(v.id==='mitral'){const [A,P]=v.leaflets,xa=hingeR(v,0),xp=-hingeR(v,Math.PI),pt=deg=>{const f=rad(deg),r=hingeR(v,f);return [r*Math.cos(f),r*Math.sin(f)]};
  v.coapt={xc:xa-(xa-xp)*A.len/(A.len+P.len),c1:pt(A.a1),c2:pt(A.a0)}}
 else{let x=0,y=0;for(let k=0;k<72;k++){const f=k*Math.PI/36,r=hingeR(v,f);x+=r*Math.cos(f)/72;y+=r*Math.sin(f)/72}v.coapt={K:[x,y]}}
}
function coaptTarget(v,hy){const c=v.coapt;if(c.K)return c.K;
 const [x1,y1]=hy>=0?c.c1:c.c2,y=Math.max(Math.min(hy,Math.max(c.c1[1],c.c2[1])),Math.min(c.c1[1],c.c2[1])),f=y1?y/y1:0;
 return [c.xc+(x1-c.xc)*f*f,y]}
// hinge radius at angle phi (radians from e1 toward e2)
function hingeR(v,phi){if(!v.hinge)return v.R;const n=v.hinge.length,f=((phi/(2*Math.PI)%1+1)%1)*n,i=Math.floor(f),t=f-i;return v.hinge[i%n]*(1-t)+v.hinge[(i+1)%n]*t}
// hinge height below the annulus plane (downstream), largest toward the reference direction (tricuspid: the septum)
function hingeH(v,phi){let h=v.drop?v.drop*((1+Math.cos(phi))/2)**1.5:0;
 // Ebstein: the septal leaflet displaced toward the apex most, the posterior one less, the anterior one in place
 if(v.displace)h+=v.displace*((1+Math.cos(phi+rad(30)))/2)**1.5;
 return h}
// Leaflet variants (congenital lesions of the valves), set per congenital variant. tricuspid: {displace: extra apical
// drop of the septal and posterior hinges (m), gap: fraction by which the leaflets fall short of coaptation}. The
// hinges at the new height are measured on the tissue; an empty spec restores the normal valves.
export function setValveVariant(valves,tissue,spec={}){
 for(const v of valves){if(v.kind!=='av')continue;const t=spec[v.id]||{};v.base??={hinge:v.hinge};
  v.displace=t.displace||0;v.gap=t.gap||0;
  v.hinge=v.displace&&tissue?Float32Array.from(computeHinges([v],tissue)[v.id]):v.base.hinge;coaptation(v)}
}
// Offline: distance from the valve centre, in its plane, to the first wall in 36 directions (metres).
const PASS={mitral:[20,22,40],tricuspid:[21,23,41],aortic:[24,20,42],pulmonary:[25,21,43]}; // blood pools and valve voxels a hinge search may cross
export function computeHinges(valves,tissue){const out={};
 for(const v of valves){const pass=new Set(PASS[v.id]),r=[];
  for(let k=0;k<36;k++){const phi=k*Math.PI/18,d=[0,1,2].map(a=>Math.cos(phi)*v.e1[a]+Math.sin(phi)*v.e2[a]),h=hingeH(v,phi);let hit=null;
   for(let x=.002;x<v.R*1.8;x+=.0005){if(!pass.has(tissue.tissueAt(...[0,1,2].map(a=>v.C[a]+d[a]*x+v.nv[a]*h)))){hit=x;break}}
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
 // each strip runs from its hinge toward the coaptation target and is exactly long enough to reach it closed
 // (hc below the annulus); opening swings it about the hinge toward the leaflet's open angle
 for(let i=0;i<=NI;i++){
  const phi=rad(L.a0+(L.a1-L.a0)*i/NI),Rp=hingeR(v,phi),hx=Rp*Math.cos(phi),hy=Rp*Math.sin(phi);
  const [tx,ty]=coaptTarget(v,hy),dx=tx-hx,dy=ty-hy,dist=Math.hypot(dx,dy)||1e-6,wx=dx/dist,wy=dy/dist;
  const h0=hingeH(v,phi),closed=Math.atan2(v.hc-h0,dist),theta=closed+(rad(L.open)-closed)*open,len=Math.hypot(dist,v.hc-h0)*(1-(v.gap||0));
  for(let j=0;j<=NJ;j++){
   const t=j/NJ,bend=Math.sin(Math.PI*t)*.08*len*(1-open*.7); // slight belly toward the atrium
   const inward=len*t*Math.cos(theta),x=hx+wx*inward,y=hy+wy*inward,axial=h0+len*t*Math.sin(theta)-bend;
   const k=(i*(NJ+1)+j)*3;for(let a=0;a<3;a++)P[k+a]=center[a]+v.e1[a]*x+v.e2[a]*y+v.nv[a]*axial;
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
