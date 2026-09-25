// Blood-flow model for colour Doppler. Worker-safe.
// Each blood compartment gets two geodesic distance fields (1 mm grid): from its inflow and from its outflow.
// Flow follows +∇(distance from inflow) while filling and −∇(distance to outflow) while emptying, with
// phase-dependent amplitudes (E/A waves, ejection). Congenital lesions add shunt / stenosis jets.
import {LABEL} from './tissue.mjs';

const asym=(t,a,p,b)=>{t=((t%1)+1)%1;if(t<=a||t>=b)return 0;return t<p?Math.sin(Math.PI/2*(t-a)/(p-a))**2:Math.cos(Math.PI/2*(t-p)/(b-p))**1.6};
export const waves={
 // asymmetric, like real flow: fast acceleration, slower deceleration (E deceleration time ≈ 140 ms at 90 lpm)
 E:t=>asym(t,.395,.465,.635),A:t=>asym(t,.82,.885,.97),S:t=>asym(t,.06,.15,.34)
};
const unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)};

// compartments: labels (voxels that carry this compartment's field), inflow/outflow seed rules
function compartments(lm){
 return [
  {id:'LV',labels:[LABEL.LV_BLOOD,LABEL.MITRAL],inAdj:[LABEL.LA_BLOOD],inNear:[lm.mitralValve,.022],outAdj:[LABEL.AO_BLOOD,LABEL.AORTIC_VALVE],outNear:[lm.aorticValve,.02]},
  {id:'RV',labels:[LABEL.RV_BLOOD,LABEL.TRICUSPID],inAdj:[LABEL.RA_BLOOD],inNear:[lm.tricuspidValve,.025],outAdj:[LABEL.PA_BLOOD,LABEL.PULMONARY_VALVE],outNear:[lm.pulmonaryValve,.022]},
  {id:'LA',labels:[LABEL.LA_BLOOD],inAdj:[LABEL.PV_BLOOD],outAdj:[LABEL.LV_BLOOD,LABEL.MITRAL],outNear:[lm.mitralValve,.022]},
  {id:'RA',labels:[LABEL.RA_BLOOD],inAdj:[LABEL.CAVA_BLOOD,LABEL.CS_BLOOD],outAdj:[LABEL.RV_BLOOD,LABEL.TRICUSPID],outNear:[lm.tricuspidValve,.025]},
  {id:'AO',labels:[LABEL.AO_BLOOD,LABEL.AORTIC_VALVE],inAdj:[LABEL.LV_BLOOD],inNear:[lm.aorticValve,.02]},
  {id:'PA',labels:[LABEL.PA_BLOOD,LABEL.PULMONARY_VALVE],inAdj:[LABEL.RV_BLOOD],inNear:[lm.pulmonaryValve,.022]},
  {id:'CAVA',labels:[LABEL.CAVA_BLOOD,LABEL.CS_BLOOD],outAdj:[LABEL.RA_BLOOD]},
  {id:'PV',labels:[LABEL.PV_BLOOD],outAdj:[LABEL.LA_BLOOD]}
 ];
}

export function buildFlow(tissue){
 const nx=tissue.fnx,ny=tissue.fny,nz=tissue.fnz,N=nx*ny*nz,data=tissue.fine.data,h=tissue.fh,o=tissue.fo;
 const NONE=65535,dIn=new Uint16Array(N).fill(NONE),dOut=new Uint16Array(N).fill(NONE),comp=new Uint8Array(N); // distances in 0.1 voxel // comp: 1-based compartment id
 const lm=tissue.landmarks,defs=compartments(lm),labelComp=new Uint8Array(256);
 defs.forEach((c,i)=>{for(const l of c.labels)labelComp[l]=i+1});
 for(let v=0;v<N;v++)comp[v]=labelComp[data[v*2]];
 const steps=[1,-1,nx,-nx,nx*ny,-nx*ny];
 // 26-neighbour chamfer steps (1, √2, √3 voxels, ×10): distances close to Euclidean, so flow directions are not
 // quantised to the diagonals as a 6-neighbour (Manhattan) distance would make them
 const nb=[],nw=[],nbv=[],nw2=[];for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const k=Math.abs(dx)+Math.abs(dy)+Math.abs(dz);if(!k)continue;nb.push(dx+dy*nx+dz*nx*ny);nw.push(k===1?10:k===2?14:17);nbv.push([dx,dy,dz]);nw2.push(k)}
 const coord=v=>{const x=v%nx,y=((v/nx)|0)%ny,z=(v/(nx*ny))|0;return [o[0]+x*h,o[1]+y*h,o[2]+z*h]};
 function seedsNear(ci,[p,r]){const out=[];const r2=r*r,i0=Math.max(1,Math.floor((p[0]-r-o[0])/h)),i1=Math.min(nx-2,Math.ceil((p[0]+r-o[0])/h)),j0=Math.max(1,Math.floor((p[1]-r-o[1])/h)),j1=Math.min(ny-2,Math.ceil((p[1]+r-o[1])/h)),k0=Math.max(1,Math.floor((p[2]-r-o[2])/h)),k1=Math.min(nz-2,Math.ceil((p[2]+r-o[2])/h));
  for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const v=(k*ny+j)*nx+i;if(comp[v]!==ci)continue;const x=o[0]+i*h-p[0],y=o[1]+j*h-p[1],z=o[2]+k*h-p[2];if(x*x+y*y+z*z<=r2)out.push(v)}return out}
 // interface seeds: compartment voxels touching the neighbouring compartment (optionally only near a valve)
 function seedsAdj(ci,labels,near){const set=new Set(labels),out=[];const [p,r]=near||[null,0];for(let v=nx*ny;v<N-nx*ny;v++){if(comp[v]!==ci)continue;let hit=false;for(const s of steps)if(set.has(data[(v+s)*2])){hit=true;break}if(!hit)continue;
  if(p){const x=o[0]+(v%nx)*h-p[0],y=o[1]+(((v/nx)|0)%ny)*h-p[1],z=o[2]+((v/(nx*ny))|0)*h-p[2];if(x*x+y*y+z*z>r*r)continue}out.push(v)}
  // fall back to a small ball when the interface is not found (atlas gaps)
  if(!out.length&&p)return seedsNear(ci,[p,.006]);return out}
 function bfs(field,ci,seeds){ // Dial's bucket queue (small integer weights)
  const B=Array.from({length:18},()=>[]);let pending=0;for(const v of seeds){field[v]=0;B[0].push(v);pending++}
  for(let cur=0;pending>0&&cur<2550;cur++){const bucket=B[cur%18];while(bucket.length){const v=bucket.pop();pending--;if(field[v]!==cur)continue;
   for(let k=0;k<26;k++){const w=v+nb[k],d=cur+nw[k];if(w<0||w>=N||comp[w]!==ci||field[w]<=d)continue;field[w]=d;B[d%18].push(w);pending++}}}}
 defs.forEach((c,i)=>{const ci=i+1;
  const sIn=c.inAdj?seedsAdj(ci,c.inAdj,c.inNear):[];
  const sOut=c.outAdj?seedsAdj(ci,c.outAdj,c.outNear):[];
  if(sIn.length)bfs(dIn,ci,sIn);if(sOut.length)bfs(dOut,ci,sOut);c.hasIn=sIn.length>0;c.hasOut=sOut.length>0;
 });
 const axis={mitral:{c:lm.mitralValve,n:unit(lm.lvApexCavity.map((v,i)=>v-lm.mitralValve[i]))},tricuspid:{c:lm.tricuspidValve,n:unit(lm.rvApex.map((v,i)=>v-lm.tricuspidValve[i]))}};
 const flow={dIn,dOut,comp,defs,jets:[],nx,ny,nz};
 function grad(field,v,ci,out){
  // least-squares gradient over the 26 directions at 2 voxels (falls back to 1 voxel near walls): smooths the
  // facets of the chamfer distance so the flow direction varies continuously
  const f0=field[v];let g0=0,g1=0,g2=0;
  for(let k=0;k<26;k++){let w=v+2*nb[k],f=w>=0&&w<N&&comp[w]===ci?field[w]:NONE,sc=2;if(f===NONE){w=v+nb[k];f=w>=0&&w<N&&comp[w]===ci?field[w]:NONE;sc=1}if(f===NONE)continue;
   const e=nbv[k],q=(f-f0)/(sc*nw2[k]);g0+=q*e[0];g1+=q*e[1];g2+=q*e[2]}
  const l=Math.hypot(g0,g1,g2);if(l<1e-6){out[0]=out[1]=out[2]=0;return 0}out[0]=g0/l;out[1]=g1/l;out[2]=g2/l;return 1;
 }
 const gi=[0,0,0],go=[0,0,0];
 function axisFactor(ax,x,y,z,width){const q=[x-ax.c[0],y-ax.c[1],z-ax.c[2]],t=q[0]*ax.n[0]+q[1]*ax.n[1]+q[2]*ax.n[2],r2=(q[0]-t*ax.n[0])**2+(q[1]-t*ax.n[1])**2+(q[2]-t*ax.n[2])**2;return .15+.85*Math.exp(-r2/(width*width))}
 // bend a unit gradient g (used with sign sg) toward direction t, strongly within ~L of the target
 function steer(g,sg,t,L,dist){const lt=Math.hypot(...t)||1,d=dist??lt,w=.85*Math.exp(-d/L);if(w<.02)return;
  const x=g[0]*sg*(1-w)+t[0]/lt*w,y=g[1]*sg*(1-w)+t[1]/lt*w,z=g[2]*sg*(1-w)+t[2]/lt*w,l=Math.hypot(x,y,z)||1;g[0]=x/l*sg;g[1]=y/l*sg;g[2]=z/l*sg}
 // velocity (m/s, world axes) at reference point x,y,z for phase t; returns false when not in blood
 flow.velocity=(x,y,z,t,out)=>{
  out[0]=out[1]=out[2]=0;
  const ix=Math.round((x-o[0])/h),iy=Math.round((y-o[1])/h),iz=Math.round((z-o[2])/h);
  if(ix<1||iy<1||iz<1||ix>=nx-1||iy>=ny-1||iz>=nz-1)return false;
  const v=(iz*ny+iy)*nx+ix,ci=comp[v];let blood=ci>0;
  if(ci){
   const c=defs[ci-1],E=waves.E(t),A=waves.A(t),S=waves.S(t);let a=0,b=0;
   const hasI=c.hasIn&&dIn[v]<NONE&&grad(dIn,v,ci,gi),hasO=c.hasOut&&dOut[v]<NONE&&grad(dOut,v,ci,go);
   const near=(d,L)=>Math.exp(-d*.1/L); // d in 0.1 voxel (1 mm voxels)
   switch(c.id){
    case 'LV':if(hasI)a=(1.05*E+.6*A)*(.15+.85*near(dIn[v],30))*axisFactor(axis.mitral,x,y,z,.011);if(hasO)b=1.05*S*(.25+.75*near(dOut[v],20));break;
    case 'RV':if(hasI)a=(.65*E+.45*A)*(.15+.85*near(dIn[v],30))*axisFactor(axis.tricuspid,x,y,z,.013);if(hasO)b=.85*S*(.25+.75*near(dOut[v],22));break;
    case 'LA':if(hasO)b=(.05+.55*E+.35*A)*(.3+.7*near(dOut[v],18));if(hasI)a=.28*S*(.4+.6*near(dIn[v],15));break; // diastole: toward the mitral valve; systole: venous filling
    case 'RA':if(hasO)b=(.05+.45*E+.3*A)*(.3+.7*near(dOut[v],20));if(hasI)a=.25*S*(.4+.6*near(dIn[v],15));break;
    case 'AO':if(hasI)a=1.1*S*(.55+.45*near(dIn[v],40))-.06*E;break;
    case 'PA':if(hasI)a=.9*S*(.6+.4*near(dIn[v],35));break;
    case 'CAVA':case 'PV':if(hasO)b=.3+.25*S+.2*E;break;
   }
   // near the valves the stream converges on the orifice (outflow) or follows the inflow axis (AV valves)
   if(b&&(c.id==='LV'||c.id==='RV')){const vc=c.id==='LV'?lm.aorticValve:lm.pulmonaryValve;steer(go,-1,[vc[0]-x,vc[1]-y,vc[2]-z],.022)}
   if(a&&(c.id==='LV'||c.id==='RV')){const ax=c.id==='LV'?axis.mitral:axis.tricuspid;steer(gi,1,ax.n,.03,Math.hypot(x-ax.c[0],y-ax.c[1],z-ax.c[2]))}
   // inflow along +∇dIn, outflow along −∇dOut
   if(a){out[0]+=gi[0]*a;out[1]+=gi[1]*a;out[2]+=gi[2]*a}
   if(b){out[0]-=go[0]*b;out[1]-=go[1]*b;out[2]-=go[2]*b}
  }
  // lesion jets (shunts, stenoses) dominate where present
  for(const j of flow.jets){
   const q0=x-j.c[0],q1=y-j.c[1],q2=z-j.c[2],al=q0*j.d[0]+q1*j.d[1]+q2*j.d[2];if(al<-j.back||al>j.len)continue;
   const r2=(q0-al*j.d[0])**2+(q1-al*j.d[1])**2+(q2-al*j.d[2])**2,w=j.w0+j.spread*Math.max(0,al);if(r2>9*w*w)continue;
   const lab=data[v*2];if(!(ci||j.labels.has(lab)))continue;blood=true;
   const mag=j.peak*j.timing(t)*Math.exp(-r2/(w*w))*(al<0?Math.exp(al/(j.back*.5)):Math.exp(-al/j.decay));
   out[0]+=j.d[0]*mag;out[1]+=j.d[1]*mag;out[2]+=j.d[2]*mag;
  }
  return blood;
 };
 return flow;
}

// ---------------------------------------------------------------- lesion jets
function centroidNear(tissue,labels,p,r){return tissue.centroid(labels,p,r)}
const BLOODISH=new Set([LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD]);
function jet(c,d,{peak,timing,len=.03,back=.004,w0=.003,spread=.12,decay=.02}){return {c,d:unit(d),peak,timing,len,back,w0,spread,decay,labels:BLOODISH}}
const cyc=t=>((t%1)+1)%1;
// restrictive VSD: holosystolic, from isovolumic contraction to isovolumic relaxation, rounded plateau
const holosystolic=t=>{t=cyc(t);if(t<.02||t>.4)return .05;const up=Math.min(1,(t-.02)/.06),down=Math.min(1,(.4-t)/.06);return .05+.95*Math.sin(Math.PI/2*up)*Math.sin(Math.PI/2*down)*(.88+.12*waves.S(t))};
// dynamic outflow obstruction: late-peaking "dagger"
const lateSystolic=t=>{t=cyc(t);if(t<.06||t>.36)return 0;const x=(t-.06)/.3;return x<.78?(x/.78)**2.2:Math.cos(Math.PI/2*(x-.78)/.22)};
const systolic=t=>waves.S(t)+.08,continuous=t=>.55+.35*waves.S(t)+.1*waves.E(t),atrial=t=>.35+.4*waves.E(t)+.35*waves.A(t)+.2*waves.S(t),coarct=t=>waves.S(t)+.25*Math.max(0,1-(((t-.34)%1+1)%1)/.4);

export function lesionJets(tissue,spec,size=1){
 const lm=tissue.landmarks,id=spec?.id;const L=LABEL;const jets=[];
 const across=(p,from,to,r=.016)=>{const a=centroidNear(tissue,from,p,r),b=centroidNear(tissue,to,p,r);return a&&b?b.map((v,i)=>v-a[i]):null};
 const radius=spec?.params?.radius||.005;
 if(id==='vsdpm'||id==='vsdm'){const p=id==='vsdpm'?lm.vsdPerimembranous:lm.vsdMuscular,d=across(p,[L.LV_BLOOD],[L.RV_BLOOD]);
  // small, restrictive defects: high velocity (mosaic); large ones lower velocity
  if(d)jets.push(jet(p,d,{peak:Math.max(1.8,Math.min(4.8,4.8-(radius-.004)*520)),timing:holosystolic,w0:Math.max(.0015,radius*.45),len:.035}))}
 if(id==='asd2'||id==='asd1'){const p=id==='asd2'?lm.asdSecundum:lm.asdPrimum,d=across(p,[L.LA_BLOOD],[L.RA_BLOOD]);if(d)jets.push(jet(p,d,{peak:1.05,timing:atrial,w0:Math.max(.002,radius*.55),len:.03,spread:.2}))}
 if(id==='avsd'){const d1=across(lm.asdPrimum,[L.LA_BLOOD],[L.RA_BLOOD]);if(d1)jets.push(jet(lm.asdPrimum,d1,{peak:1.0,timing:atrial,w0:.004,len:.028,spread:.2}));
  const mv=lm.mitralValve,tv=lm.tricuspidValve,crux=mv.map((v,i)=>(v+tv[i])/2),d2=across(crux,[L.LV_BLOOD],[L.RV_BLOOD],.02);if(d2)jets.push(jet(crux,d2,{peak:2.2,timing:systolic,w0:.004,len:.03}))}
 if(id==='pda'){const a=lm.ductAortic,b=lm.ductPulmonary,d=b.map((v,i)=>v-a[i]);jets.push(jet(a,d,{peak:3.2,timing:continuous,w0:.0022,len:Math.hypot(...d)+.006,spread:.15,decay:.035}));
  // on entering the pulmonary artery the ductal jet runs back along the main PA toward the pulmonary valve (red in PSAX)
  jets.push(jet(b,lm.pulmonaryValve.map((v,i)=>v-b[i]),{peak:3.0,timing:continuous,w0:.003,len:.04,back:.002,spread:.14,decay:.045}))}
 if(id==='coarct'){const c=centroidNear(tissue,[L.AO_BLOOD,L.VESSEL_WALL],lm.ductAortic,.012)||lm.ductAortic,d=c.map((v,i)=>v-lm.archTop[i]);jets.push(jet(c,d,{peak:3.0,timing:coarct,w0:.0025,len:.035,back:.006,spread:.1,decay:.03}))}
 if(id==='ebstein'){
  // tricuspid regurgitation from the displaced coaptation, inside the RV, back toward the right atrium; low velocity
  const tv=lm.tricuspidValve,ax=lm.rvApex.map((v,i)=>v-tv[i]),l=Math.hypot(...ax),n=ax.map(v=>v/l),mm=(spec.params?.mm??18)/1000,p=tv.map((v,i)=>v+n[i]*(mm*.6+.008));
  jets.push(jet(p,n.map(v=>-v),{peak:2.1,timing:holosystolic,w0:.005,len:.045,spread:.22}))}
 if(id==='lvh'){const p=lm.aorticValve.map((v,i)=>v+(lm.mitralValve[i]-v)*.35),d=lm.aorticValve.map((v,i)=>v-lm.lvApexCavity[i]);jets.push(jet(p,d,{peak:2.4,timing:lateSystolic,w0:.004,len:.03,back:.012,spread:.08}))}
 return jets;
}

// Colour box (angles in degrees, radii as fractions of depth) centred on a world point seen from `pose`.
export function roiAround(pose,point,{half=17,span=.045}={}){
 const q=[0,1,2].map(i=>point[i]-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2],r=Math.hypot(x,y);
 const lim=pose.sector/2;const center=Math.max(-lim+half*.5,Math.min(lim-half*.5,Math.atan2(x,y)*180/Math.PI));
 return {center,half,r0:Math.max(.02,(r-span/2)/pose.depth),r1:Math.min(1,(r+span/2)/pose.depth)};
}
