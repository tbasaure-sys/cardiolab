// Main-thread scheduler for the simulated B-mode workers: renders the current view first, then fills a cine
// loop (one frame per cardiac phase) while the probe is still. Stale work is dropped when the view changes.
export const CINE_PHASES=20;

export function createSimEngine({workers=Math.max(1,Math.min(3,(navigator.hardwareConcurrency||2)-1))}={}){
 const pool=[],queue=[],listeners=new Set(),pending=new Map();let isReady=false,seq=0,key='',frames=new Map(),ready,landmarks=null,variantSeq=0,lastFrame=null,failed=null;
 const params={bodyScale:1,freq:4,gain:1,tgc:Array(8).fill(50),dynamicRange:52,focus:.55,beating:true,valves:true,color:{on:false,nyquist:.7,roi:{center:0,half:20,r0:.25,r1:.8}}};
 ready=new Promise((resolve,reject)=>{let n=0;
  for(let i=0;i<workers;i++){const w=new Worker('bmode-worker.mjs',{type:'module'});w.busy=false;
   w.onmessage=e=>onMessage(w,e.data,()=>{if(++n===workers){isReady=true;resolve(landmarks);pump()}});w.onerror=e=>{failed=e.message||'Error del simulador';reject(Error(failed))};w.postMessage({type:'init'});pool.push(w)}
 });
 function onMessage(w,m,onReady){
  if(m.type==='ready'){landmarks=m.landmarks;onReady();return}
  if(m.type==='error'){w.busy=false;const p=pending.get(m.id);if(p){pending.delete(m.id);p.reject?.(Error(m.message))}pump();return}
  if(m.type==='spectrum'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.spectrum)}return}
  if(m.type==='views'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.views)}return}
  if(m.type==='probe'){const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m.labels??m.label)}return}
  if(m.type==='variant'){const p=pending.get(m.id);if(p&&--p.left===0){pending.delete(m.id);p.resolve(m.info)}return}
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
 function viewKey(pose,p){return JSON.stringify([pose.origin,pose.u,pose.d,pose.depth,pose.sector,p.bodyScale,p.freq,p.gain,p.tgc,p.dynamicRange,p.focus,p.beating,p.valves,p.color.on?p.color:0,variantSeq])}
 // Show `pose`. `phase` = current cardiac phase (0..1); `quick` = lower resolution while dragging.
 function show(pose,phase=0,{quick=false}={}){
  const p={...params,lines:quick?112:168,samples:quick?Math.round(pose.depth*params.bodyScale/.00036):undefined};
  const k=viewKey(pose,p)+(quick?'q':'');
  const idx=p.beating?Math.floor(((phase%1)+1)%1*CINE_PHASES):0;
  if(k!==key){key=k;frames=new Map();queue.length=0}
  const want=p.beating?[...Array(CINE_PHASES).keys()].map(i=>(idx+1+i)%CINE_PHASES):[0];
  const queued=new Set(queue.map(j=>j.phaseIndex));
  for(const i of want){if(frames.has(i)||queued.has(i))continue;if(quick&&i!==idx&&p.beating)continue;queue.push({key:k,phaseIndex:i,pose,params:{...p,phase:(i+.5)/CINE_PHASES}})}
  // current phase first
  queue.sort((a,b)=>((a.phaseIndex-idx+CINE_PHASES)%CINE_PHASES)-((b.phaseIndex-idx+CINE_PHASES)%CINE_PHASES));
  pump();
 }
 function frameFor(phase){if(!frames.size)return lastFrame;if(!params.beating)return frames.get(0)||lastFrame;const idx=Math.floor(((phase%1)+1)%1*CINE_PHASES);
  for(let d=0;d<CINE_PHASES;d++){const f=frames.get((idx-d+CINE_PHASES)%CINE_PHASES);if(f)return f}return lastFrame}
 function renderOnce(pose,extra={}){return ready.then(()=>new Promise((resolve,reject)=>{queue.unshift({pose,params:{...params,lines:128,...extra,phase:extra.phase??.05},resolve,reject});pump()}))}
 function setVariant(spec){variantSeq++;key='';frames=new Map();queue.length=0;const id=++seq;return new Promise(resolve=>{pending.set(id,{left:pool.length,resolve});for(const w of pool)w.postMessage({type:'variant',id,spec})})}
 function set(values){Object.assign(params,values)}
 // spectral Doppler: one cardiac cycle of spectral lines, computed on the last worker (never blocks the cine queue for long)
 function spectrum(spec){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[pool.length-1].postMessage({type:'spectrum',id,spec})}))}
 // tissue label (tissue.mjs LABEL) at each world point of the reference (diastolic) anatomy, current variant included
 function probe(points){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[0].postMessage({type:'probe',id,points})}))}
 function getViews(){return ready.then(()=>new Promise(resolve=>{const id=++seq;pending.set(id,{resolve});pool[0].postMessage({type:'views',id})}))}
 return {debug:()=>({queue:queue.length,pending:pending.size,busy:pool.map(w=>w.busy),key:key.slice(-40),frames:frames.size}),ready,show,frameFor,renderOnce,setVariant,set,getViews,spectrum,probe,params,onFrame:f=>listeners.add(f),get landmarks(){return landmarks},get cached(){return frames.size},get failed(){return failed}};
}
