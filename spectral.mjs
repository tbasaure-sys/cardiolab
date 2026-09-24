// Spectral Doppler (PW / CW) from the blood-flow model. Worker-safe.
// One cardiac cycle is computed as `cols` spectral lines; the display sweeps it in time.
import {ventricularContraction} from './tissue.mjs';

const C=1540,CW_LAT=[-.006,-.003,0,.003,.006],CW_ELE=[-.004,-.002,0,.002,.004],CW_LANES=25;
function hash(i,j){let h=(i*374761393+j*668265263)|0;h=(h^(h>>>13))*1274126177|0;return ((h^(h>>>16))>>>0)/4294967296}
// highest measurable velocity for PW at a given gate depth (PRF limited by the round trip)
export function pwNyquist(depth,freqMHz){const f0=Math.max(1.5,freqMHz*.6)*1e6;return C*C/(8*f0*Math.max(.02,depth))}

// Geometry (pose, gateDepth) is in atlas units; bodyScale (K) converts to physical metres for the acoustics
// (PRF/Nyquist, gate length, beam and aperture sizes).
export function renderSpectrum(tissue,flow,motion,{pose,theta=0,gateDepth=.08,gateLen=.003,mode='pw',freq=4,cols=240,bins=180,scale=null,baseline=.5,gain=1,fast=false,bodyScale=1}){
 const K=bodyScale;
 const th=theta*Math.PI/180,d=pose.d,u=pose.u,n=pose.n,o=pose.origin;
 const b=[Math.cos(th)*d[0]+Math.sin(th)*u[0],Math.cos(th)*d[1]+Math.sin(th)*u[1],Math.cos(th)*d[2]+Math.sin(th)*u[2]];
 const lat=[Math.cos(th)*u[0]-Math.sin(th)*d[0],Math.cos(th)*u[1]-Math.sin(th)*d[1],Math.cos(th)*u[2]-Math.sin(th)*d[2]];
 const nyq=pwNyquist(gateDepth*K,freq);
 const half=mode==='pw'?(scale||nyq):(scale||4);      // displayed half-range (m/s)
 const top=(1-baseline)*2*half,bottom=-baseline*2*half,span=top-bottom;
 // sample points: PW = gate × beam width; CW = the whole line
 const pts=[];const beam=.0012/K,gl=gateLen/K;
 if(mode==='pw'){for(let r=gateDepth-gl/2;r<=gateDepth+gl/2+1e-9;r+=.0005/K)for(const a of [-beam,0,beam])for(const e of [-beam,0,beam])pts.push([o[0]+b[0]*r+lat[0]*a+n[0]*e,o[1]+b[1]*r+lat[1]*a+n[1]*e,o[2]+b[2]*r+lat[2]*a+n[2]*e])}
 // CW: lanes leave a ~12 mm aperture and converge on the focus (the cursor depth), ≈8 mm tall in elevation.
 // A rib over part of the aperture only removes some lanes, as with a real probe.
 else{const fd=Math.max(.03/K,Math.min(pose.depth*.9,gateDepth));
  for(let r=.006/K;r<pose.depth;r+=(fast?.002:.001)/K)for(const a0 of CW_LAT)for(const e0 of CW_ELE){const a=a0/K,e=e0/K;const k=1-r/fd,off=a*k+a*.2*(1-k)*.25;
   pts.push([o[0]+b[0]*r+lat[0]*off+n[0]*e,o[1]+b[1]*r+lat[1]*off+n[1]*e,o[2]+b[2]*r+lat[2]*off+n[2]*e])}}
 // attenuation / shadowing along the line: points behind bone or lung contribute nothing
 const reach=pts.map(p=>{const l=tissue.tissueAt(p[0],p[1],p[2]);return l});
 let pwLoss=0;const alive=new Uint8Array(pts.length);
 if(mode==='cw'){const bl=new Set();for(let i=0;i<pts.length;i++){const lane=i%CW_LANES;if(reach[i]===3||reach[i]===2)bl.add(lane);alive[i]=bl.has(lane)?0:1}}
 else{// PW: transmission to the gate averaged over the aperture (~12 mm converging on the gate). Thin cartilage
  // dims the signal; a rib or aerated lung blocks it.
  const gate=[o[0]+b[0]*gateDepth,o[1]+b[1]*gateDepth,o[2]+b[2]*gateDepth];let T=0;
  for(const a0 of [-.006,-.003,0,.003,.006]){const a=a0/K,s0=[o[0]+lat[0]*a,o[1]+lat[1]*a,o[2]+lat[2]*a],dv=[gate[0]-s0[0],gate[1]-s0[1],gate[2]-s0[2]],L=Math.hypot(...dv);let t=1;
   for(let r=.004/K;r<L-.003/K&&t>.001;r+=.002/K){const f=r/L,l=tissue.tissueAt(s0[0]+dv[0]*f,s0[1]+dv[1]*f,s0[2]+dv[2]*f);if(l===3)t*=.6;else if(l===2)t*=.12}T+=t/5}
  pwLoss=1-T;alive.fill(T<.08?0:1)}
 const hist=new Float32Array(cols*bins),q=[0,0,0],v=[0,0,0];let vPeak=0,angle=null,peakAbs=0;
 for(let c=0;c<cols;c++){
  const t=(c+.5)/cols,s=ventricularContraction(t);
  for(let i=0;i<pts.length;i++){
   if(!alive[i])continue;let p=pts[i];
   if(motion&&s){tissue.lookup(p[0],p[1],p[2]);const dd=tissue.lastDistance;const fall=dd<=.002?1:dd>=.014?0:1-(dd-.002)/.012;if(fall>0){motion.inverse(p,s,q,fall);p=q}}
   if(!flow.velocity(p[0],p[1],p[2],t,v))continue;
   const vr=-(v[0]*b[0]+v[1]*b[1]+v[2]*b[2]),mag=Math.hypot(v[0],v[1],v[2]);
   if(Math.abs(vr)<.06)continue; // wall filter
   if(Math.abs(vr)>peakAbs){peakAbs=Math.abs(vr);vPeak=vr;if(mode==='pw'&&mag>.05)angle=Math.acos(Math.min(1,Math.abs(vr)/mag))*180/Math.PI}
   // spectral broadening: finite gate/transit time, and much more for disturbed (high-velocity) flow
   const sig=.03+.045*Math.abs(vr)+(Math.abs(vr)>2?.18:0);
   let vv=vr;if(mode==='pw'){vv=((vr-bottom)%span+span)%span+bottom} // aliasing wraps around
   const center=(top-vv)/span*bins,sw=sig/span*bins,r0=Math.max(0,Math.floor(center-3*sw)),r1=Math.min(bins-1,Math.ceil(center+3*sw));
   // jets: the high-velocity core is small but coherent and dominates the display once the gain is set on it
   const av=Math.abs(vr),wt=1+7*Math.min(1,Math.max(0,(av-1.2)/1.3));
   for(let k=r0;k<=r1;k++){const z=(k-center)/sw;hist[k*cols+c]+=wt*Math.exp(-.5*z*z)/sw}
   // CW: clipping at the display edge (no wrap, the envelope is cut)
  }
 }
 // log compression with speckle-like texture and a faint noise floor
 // gain reference: a high percentile of the occupied bins (not the maximum), so that a jet envelope is not
 // crushed by the bright low-velocity flow near the baseline
 const occ=[];for(const x of hist)if(x>0)occ.push(x);occ.sort((a,b)=>a-b);const ref=occ.length?occ[Math.floor(occ.length*.93)]:1;
 const data=new Uint8Array(cols*bins),G=40/(ref||1)*(1-pwLoss*.8);
 for(let k=0;k<bins;k++)for(let c=0;c<cols;c++){const i=k*cols+c,h=hist[i],tex=.55+.9*hash(c,k);let val=Math.log1p(G*h*tex*gain)/Math.log1p(40);val+=.05*hash(k*3+1,c*7+2)*gain;data[i]=Math.max(0,Math.min(255,Math.round(255*Math.pow(Math.min(1,val),.8))))}
 return {cols,bins,data,top,bottom,nyquist:nyq,mode,vPeak,angle,theta,gateDepth,blocked:mode==='pw'?!alive[0]:false};
}

// Fine-tune the cursor angle the way a sonographer does: sweep a few degrees around the aim and keep the
// direction with the highest velocity envelope (the best alignment with the jet).
export function optimizeAim(tissue,flow,motion,spec,{range=8,step=1}={}){
 const t0=spec.theta||0;let best=t0,bv=-1;
 for(let th=t0-range;th<=t0+range+1e-9;th+=step){const sp=renderSpectrum(tissue,flow,motion,{...spec,theta:th,cols:40,bins:16,fast:true});const v=Math.abs(sp.vPeak)-.004*Math.abs(th-t0);if(v>bv){bv=v;best=th}}
 return best;
}
