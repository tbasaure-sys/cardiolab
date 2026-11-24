// M-mode: one scan line followed through the beat. Each column of the strip is that line of the simulated B-mode at one
// instant of the cycle (same ray tracing, same moving heart and leaflets as the 2D image), so walls and valves draw their
// motion against time and can be measured with depth and time calipers. Worker-safe (renderMMode), DOM-free.
//
// Sourced: the minor-axis dimensions and the shortening fraction FS = (LVIDd − LVIDs)/LVIDd, and where the line goes
// (short axis at the papillary muscles or long axis at the leaflet tips, perpendicular to the septum and posterior wall),
// follow the pediatric quantification recommendations (Lopez 2010). The motion itself is the teaching model's.
import {ventricularContraction,LABEL} from './tissue.mjs';
import {sliceValves} from './valves.mjs';

export const MMODE_SOURCES=['lopez2010'];
const BEAMS=5,LINES_2D=168;
// the pose of a narrow fan centred on the M-line (theta degrees from the image axis, toward the marker when positive)
export function linePose(pose,theta){
 const t=theta*Math.PI/180,c=Math.cos(t),s=Math.sin(t),d=pose.d,u=pose.u;
 return {origin:pose.origin,d:[c*d[0]+s*u[0],c*d[1]+s*u[1],c*d[2]+s*u[2]],u:[c*u[0]-s*d[0],c*u[1]-s*d[1],c*u[2]-s*d[2]],n:pose.n,depth:pose.depth,sector:pose.sector/LINES_2D*BEAMS};
}
// spec: {pose, theta, cols, freq, gain, tgc, dynamicRange, focus, harmonic, bodyScale}; one beat in `cols` columns.
// data[c*samples+k]: grey level of column c (time) at sample k (depth)
export function renderMMode(engine,tissue,valves,motion,spec){
 const {pose,theta=0,cols=160}=spec,lp=linePose(pose,theta),mid=BEAMS>>1;let data=null,samples=0;
 for(let c=0;c<cols;c++){
  const phase=(c+.5)/cols,s=ventricularContraction(phase),leaflets=[];
  for(const v of sliceValves(valves,lp,phase,motion,s,tissue.remodel))leaflets.push({segments:v.segments,t:v.t,strength:.012});
  const f=engine.render(tissue,{seed:c*31+7,elevation:false,pose:lp,lines:BEAMS,samples:spec.samples,bodyScale:spec.bodyScale,freq:spec.freq,gain:spec.gain,tgc:spec.tgc,dynamicRange:spec.dynamicRange,focus:spec.focus,harmonic:spec.harmonic,motion,contraction:s,overlays:leaflets});
  if(!data){samples=f.samples;data=new Uint8Array(cols*samples)}
  data.set(f.data.subarray(mid*samples,(mid+1)*samples),c*samples);
 }
 // A real beam is ~1 mm wide and averages many scatterers; the renderer samples one per ray, so the speckle of moving
 // tissue would flicker from column to column. A short average along time (≈ ±2 columns, a few ms) stands for that beam
 // width: still tissue keeps its streaks, moving walls blur by less than the axial resolution.
 const out=new Uint8Array(cols*samples),W=[.12,.22,.32,.22,.12];
 for(let c=0;c<cols;c++)for(let k=0;k<samples;k++){let v=0;for(let t=-2;t<=2;t++)v+=W[t+2]*data[((c+t+cols)%cols)*samples+k];out[c*samples+k]=v+.5|0}
 return {cols,samples,depth:pose.depth,theta,data:out,cavity:cavityTrack(tissue,motion,lp,{cols:Math.min(cols,80)})};
}
// label along the line at one instant (the same position chain as the renderer: remodelling, then the heart's motion)
function labelsAlong(tissue,motion,lp,s,n,out){
 const p=[0,0,0],q=[0,0,0],o=lp.origin,d=lp.d,dr=lp.depth/n,remodel=tissue.remodel||null;
 for(let k=0;k<n;k++){const r=(k+.5)*dr;p[0]=o[0]+d[0]*r;p[1]=o[1]+d[1]*r;p[2]=o[2]+d[2]*r;if(remodel)remodel.inverse(p,p);let x=p[0],y=p[1],z=p[2];
  if(motion&&s){tissue.lookup(x,y,z);const dd=tissue.lastDistance,fall=dd<=.002?1:dd>=.014?0:1-(dd-.002)/.012;if(fall>0){motion.inverse(p,s,q,fall);x=q[0];y=q[1];z=q[2]}}
  out[k]=tissue.tissueAt(x,y,z)}
 return out;
}
// the exact answer for a measurement on this line: the left-ventricular cavity along it at each instant, from the first to
// the last blood sample (papillary muscle and thin trabeculae inside count as cavity, as when measuring wall to wall).
// Atlas metres; × 1000 × body scale = mm.
export function cavityTrack(tissue,motion,lp,{cols=80,n=600,label=LABEL.LV_BLOOD,bridge=.004}={}){
 const lab=new Uint8Array(n),dr=lp.depth/n,gap=Math.round(bridge/dr),len=new Float32Array(cols),near=new Float32Array(cols),far=new Float32Array(cols);
 for(let c=0;c<cols;c++){labelsAlong(tissue,motion,lp,ventricularContraction((c+.5)/cols),n,lab);
  // runs of blood, joined across papillary muscle and across gaps shorter than `bridge`
  let best=0,b0=0,start=-1,end=-1,miss=0;const close=()=>{if(start>=0&&end-start+1>best){best=end-start+1;b0=start}start=-1;miss=0};
  for(let k=0;k<n;k++){if(lab[k]===label){if(start<0)start=k;end=k;miss=0}else if(start>=0){if(lab[k]!==LABEL.PAPILLARY)miss++;if(miss>gap)close()}}close();
  len[c]=best*dr;near[c]=b0*dr;far[c]=(b0+best)*dr}
 let iMax=0,iMin=0;for(let c=1;c<cols;c++){if(len[c]>len[iMax])iMax=c;if(len[c]<len[iMin])iMin=c}
 const dMax=len[iMax],dMin=len[iMin];
 return {cols,len,near,far,diastole:{length:dMax,phase:(iMax+.5)/cols,near:near[iMax],far:far[iMax]},systole:{length:dMin,phase:(iMin+.5)/cols,near:near[iMin],far:far[iMin]},fs:dMax>0?(dMax-dMin)/dMax:null};
}
// shortening fraction from the two minor-axis dimensions (same units)
export function shorteningFraction(dd,ds){return dd>0&&ds>=0&&ds<=dd?(dd-ds)/dd:null}
