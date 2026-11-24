// Main-thread scheduler for the simulated B-mode workers: renders the current view first, then fills a cine
// loop (one frame per cardiac phase) while the probe is still. Stale work is dropped when the view changes.
export const CINE_PHASES=20;
import {BREATH_BEATS,breathOfFrame} from './breath.mjs';

export function createSimEngine({workers=Math.max(1,Math.min(3,(navigator.hardwareConcurrency||2)-1))}={}){
 const pool=[],queue=[],listeners=new Set(),pending=new Map();let isReady=false,seq=0,key='',frames=new Map(),ready,landmarks=null,variantSeq=0,lastFrame=null,failed=null;
 const params={hr:null,breathing:false,bodyScale:1,harmonic:true,freq:4,gain:1,tgc:Array(8).fill(50),dynamicRange:52,focus:.55,beating:true,valves:true,color:{on:false,nyquist:.7,roi:{center:0,half:20,r0:.25,r1:.8}}};
 ready=new Promise((resolve,reject)=>{let n=0;
  for(let i=0;i<workers;i++){const w=new Worker('bmode-worker.mjs',{type:'module'});w.busy=false;
   w.onmessage=e=>onMessage(w,e.data,()=>{if(++n===workers){isReady=true;resolve(landmarks);pump()}});w.onerror=e=>{failed=e.message||'Error del simulador';reject(Error(failed))};w.postMessage({type:'init'});pool.push(w)}
 });
 function onMessage(w,m,onReady){
  if(m.type==='ready'){landmarks=m.landmarks;onReady();return}
  if(m.type==='error'){w.busy=false;const p=pending.get(m.id);if(p){pending.delete(m.id);p.reject?.(Error(m.message))}pump();return}
  if(m.type==='spectrum'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.spectrum)}return}
  if(m.type==='mmode'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.mmode)}return}
  if(m.type==='cxr'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve({variant:m.variant,normal:m.normal})}return}
  if(m.type==='lvVolume'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.curve)}return}
  if(m.type==='views'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.views)}return}
  if(m.type==='warp'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.points)}return}
  if(m.type==='probe'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.labels??m.label)}return}
  if(m.type==='variant'||m.type==='fit'){const p=pending.get(m.id);if(p&&--p.left===0){pending.delete(m.id);p.resolve(m.info)}return}
  if(m.type==='frame'){w.busy=false;const p=pending.get(m.id);pending.delete(m.id);
   if(p?.resolve)p.resolve(m.frame);
   else if(m.key===key){frames.set(m.phaseIndex,m.frame);lastFrame={...m.frame,phaseIndex:m.phaseIndex,ms:m.ms};for(const f of listeners)f(lastFrame)}
   pump();}
 }
 function pump(){
  if(!isReady)return;
  for(const w of pool){if(w.busy||!queue.length)continue;const job=queue.shift();if(job.key&&job.key!==key){continue}
   w.busy=true;const id=++seq;if(job.resolve)pending.set(id,job);else pending.set(id,{});
   w.postMessage({type:'render',id,key:job.key,phaseIndex:job.phaseIndex,pose:job.pose,params:job.params});}
 }
 function viewKey(pose,p){return JSON.stringify([pose.origin,pose.u,pose.d,pose.depth,pose.sector,p.bodyScale,p.hr,p.freq,p.gain,p.tgc,p.dynamicRange,p.focus,p.harmonic,p.beating,p.valves,p.color.on?p.color:0,variantSeq,p.breathing&&p.beating?1:0])}
 // The cine loop: one beat (CINE_PHASES frames), or one breath of BREATH_BEATS beats when the patient breathes. `phase` is the
 // position in the loop counted in beats: the cardiac phase 0..1, plus the beat within the breath (0..BREATH_BEATS−1).
 const loopBeats=()=>params.breathing&&params.beating?BREATH_BEATS:1,loopIndex=(phase,B)=>{const N=CINE_PHASES*B;return Math.floor((((phase%B)+B)%B)*CINE_PHASES)%N};
 // Show `pose`. `phase` = position in the loop (see above); `quick` = lower resolution while dragging.
 function show(pose,phase=0,{quick=false}={}){
  const p={...params,lines:quick?112:168,samples:quick?Math.round(pose.depth*params.bodyScale/.00036):undefined};
  const k=viewKey(pose,p)+(quick?'q':''),B=loopBeats(),N=CINE_PHASES*B;
  const idx=p.beating?loopIndex(phase,B):0;
  if(k!==key){key=k;frames=new Map();queue.length=0}
  const want=p.beating?[...Array(N).keys()].map(i=>(idx+1+i)%N):[0];
  const queued=new Set(queue.map(j=>j.phaseIndex));
  for(const i of want){if(frames.has(i)||queued.has(i))continue;if(quick&&i!==idx&&p.beating)continue;const ph=(i%CINE_PHASES+.5)/CINE_PHASES;
   queue.push({key:k,phaseIndex:i,pose,params:{...p,phase:ph,breath:B>1?breathOfFrame(Math.floor(i/CINE_PHASES),ph):0}})}
  // current frame first
  queue.sort((a,b)=>((a.phaseIndex-idx+N)%N)-((b.phaseIndex-idx+N)%N));
  pump();
 }
 // the frame to show now: the exact one, else the same cardiac phase of another breath position (the heartbeat stays smooth
 // while the loop fills), else the nearest earlier frame
 function frameFor(phase){if(!frames.size)return lastFrame;if(!params.beating)return frames.get(0)||lastFrame;const B=loopBeats(),N=CINE_PHASES*B,idx=loopIndex(phase,B);
  const f=frames.get(idx);if(f)return f;
  for(let b=1;b<B;b++){const g=frames.get((idx+b*CINE_PHASES)%N);if(g)return g}
  for(let d=1;d<N;d++){const g=frames.get((idx-d+N)%N);if(g)return g}return lastFrame}
 function renderOnce(pose,extra={}){return ready.then(()=>new Promise((resolve,reject)=>{queue.unshift({pose,params:{...params,lines:128,...extra,phase:extra.phase??.05},resolve,reject});pump()}))}
 function setVariant(spec){variantSeq++;key='';frames=new Map();queue.length=0;const id=++seq;return new Promise(resolve=>{pending.set(id,{left:pool.length,resolve});for(const w of pool)w.postMessage({type:'variant',id,spec})})}
 // the patient's body by age (thorax-fit.bodyFor: thorax fit and thymus) in every worker; cached frames belong to the previous body
 function setBody(body){variantSeq++;key='';frames=new Map();queue.length=0;const id=++seq;return new Promise(resolve=>{pending.set(id,{left:pool.length,resolve});for(const w of pool)w.postMessage({type:'fit',id,body})})}
 function set(values){Object.assign(params,values)}
 // spectral Doppler: one cardiac cycle of spectral lines, computed on the last worker (never blocks the cine queue for long)
 function spectrum(spec){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[pool.length-1].postMessage({type:'spectrum',id,spec:{hr:params.hr,...spec}})}))}
 // M-mode: one scan line through one beat (mmode.mjs), with the image settings in use
 function mmode(spec){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[pool.length-1].postMessage({type:'mmode',id,spec:{hr:params.hr,bodyScale:params.bodyScale,freq:params.freq,gain:params.gain,tgc:params.tgc,dynamicRange:params.dynamicRange,focus:params.focus,harmonic:params.harmonic,...spec}})}))}
 // tissue label (tissue.mjs LABEL) at each world point of the reference (diastolic) anatomy, current variant included
 function probe(points){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[0].postMessage({type:'probe',id,points})}))}
 function warp(points){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[0].postMessage({type:'warp',id,points})}))}
 // LV volume through one beat (mL) at a heart rate, measured on the moving model (physio.mjs)
 function lvVolume({hr=params.hr,phases=40,k=params.bodyScale}={}){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[pool.length-1].postMessage({type:'lvVolume',id,hr,phases,k})}))}
 // AP chest projection of the current variant (cxr.mjs): silhouette, cardiothoracic ratio and the reference ratio
 function cxr(){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[pool.length-1].postMessage({type:'cxr',id})}))}
 function getViews(){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[0].postMessage({type:'views',id})}))}
 return {warp,lvVolume,cxr,mmode,debug:()=>({queue:queue.length,pending:pending.size,busy:pool.map(w=>w.busy),key:key.slice(-40),frames:frames.size}),ready,show,frameFor,renderOnce,setVariant,setBody,set,getViews,spectrum,probe,params,onFrame:f=>listeners.add(f),get landmarks(){return landmarks},get cached(){return frames.size},get failed(){return failed}};
}
