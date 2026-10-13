// Simulated B-mode worker: owns a copy of the tissue volume, the valve leaflets and the current congenital variant.
import {loadTissue,HeartMotion,ventricularContraction,LABEL,gunzip} from './tissue.mjs';
import {buildViews,fanObstruction} from './views.mjs';
import {createBMode} from './bmode.mjs';
import {buildValves,sliceValves,setValveVariant} from './valves.mjs';
import {placeAtlasPositions} from './geometry.mjs';
import {applyVariant,valveVariant} from './chd-data.mjs';
import {buildFlow,lesionJets} from './flow.mjs';
import {renderSpectrum,optimizeAim} from './spectral.mjs';
import {setHeartRate} from './cycle.mjs';
import {createPhantom,wireOverlay} from './phantom.mjs';
import {lvVolumeCurve} from './physio.mjs';
const phantom=createPhantom();

let tissue=null,flow=null,valves=[],motion=null,engine=createBMode(),variant={id:'normal'},initDone=null;
async function loadAnatomy(){
 const manifest=await (await fetch('assets/anatomy.json')).json(),buffer=await gunzip(await (await fetch('assets/anatomy.bin.gz')).arrayBuffer());const byName={};
 for(const o of manifest.objects){if(o.kind!=='heart')continue;byName[o.sourceName]={sourceName:o.sourceName,positions:placeAtlasPositions(o.kind,new Float32Array(buffer,o.positionOffset,o.positionCount)),indices:new Uint32Array(buffer,o.indexOffset,o.indexCount)}}
 return byName;
}
self.onmessage=async e=>{
 const m=e.data;
 try{
  if(m.type==='init'){
   initDone=Promise.all([loadTissue('assets/'),loadAnatomy()]).then(([t,byName])=>{tissue=t;valves=buildValves(byName,t.landmarks);motion=new HeartMotion(t.landmarks);flow=buildFlow(t)});
   await initDone;self.postMessage({type:'ready',landmarks:tissue.landmarks,labels:tissue.meta.labels});return;
  }
  // messages that arrive while the volume is still loading wait for it (never dropped)
  if(!tissue){if(!initDone)throw Error('Simulador sin inicializar');await initDone}
  if(m.type==='variant'){tissue.reset();variant=m.spec||{id:'normal'};const info=applyVariant(tissue,variant);setValveVariant(valves,tissue,valveVariant(variant));flow.jets=lesionJets(tissue,variant);flow.scale=variant.params?.hemo?.flowScale||null;info.jets=flow.jets.length;self.postMessage({type:'variant',id:m.id,info});return}
  if(m.type==='render'){
   setHeartRate(m.params.hr||null); // beat timing at the patient's heart rate (cycle.mjs)
   const t0=performance.now(),p=m.params,phase=p.phase??0,s=p.beating?ventricularContraction(phase):0;
   // resolution phantom (physics chapters): same renderer, a block of tissue-mimicking material with wires and cysts
   if(p.phantom){const frame=engine.render(phantom,{seed:p.seed??1,pose:m.pose,lines:p.lines,samples:p.samples,bodyScale:1,freq:p.freq,gain:p.gain,tgc:p.tgc,dynamicRange:p.dynamicRange,focus:p.focus,harmonic:p.harmonic,elevation:p.elevation,overlays:[wireOverlay(1)],envelope:true});
    const data=frame.data.slice(),env=frame.envelope;self.postMessage({type:'frame',id:m.id,key:m.key,phaseIndex:m.phaseIndex,frame:{lines:frame.lines,samples:frame.samples,depth:frame.depth,sector:frame.sector,data,envelope:env},ms:performance.now()-t0},[data.buffer,env.buffer]);return}
   // leaflets cut across the slice thickness too (as the tissue): the central cut and two ±1.1 mm (physical, at 6 MHz; thinner at higher frequency) away, weaker
   const leaflets=[];if(p.valves!==false){const po=m.pose,e=.0011*(6/(p.freq||6))/(p.bodyScale||1);
    for(const [k,w] of [[0,1],[-1,.6],[1,.6]]){const pose=k?{...po,origin:po.origin.map((v,i)=>v+po.n[i]*e*k)}:po;
     for(const v of sliceValves(valves,pose,p.beating?phase:0,motion,s,tissue.remodel))leaflets.push({segments:v.segments,t:v.t,strength:.012*w})}}
   const frame=engine.render(tissue,{seed:p.seed??Math.round((p.phase||0)*997),elevation:p.elevation,envelope:!!p.envelope,pose:m.pose,lines:p.lines,samples:p.samples,bodyScale:p.bodyScale,freq:p.freq,gain:p.gain,tgc:p.tgc,dynamicRange:p.dynamicRange,focus:p.focus,harmonic:p.harmonic,motion,contraction:s,overlays:leaflets,color:p.color&&p.color.on?{flow,phase,roi:p.color.roi,nyquist:p.color.nyquist}:null});
   const data=frame.data.slice(),color=frame.color;
   self.postMessage({type:'frame',id:m.id,key:m.key,phaseIndex:m.phaseIndex,frame:{lines:frame.lines,samples:frame.samples,depth:frame.depth,sector:frame.sector,data,color,envelope:frame.envelope},ms:performance.now()-t0},[data.buffer,...(color?[color.buffer]:[]),...(frame.envelope?[frame.envelope.buffer]:[])]);
   return;
  }
  if(m.type==='spectrum'){const spec={...m.spec};setHeartRate(spec.hr||null);if(spec.optimize){spec.theta=optimizeAim(tissue,flow,motion,spec,spec.optimize);delete spec.optimize}const sp=renderSpectrum(tissue,flow,motion,spec);self.postMessage({type:'spectrum',id:m.id,spectrum:sp},[sp.data.buffer]);return}
  if(m.type==='lvVolume'){setHeartRate(m.hr||null);self.postMessage({type:'lvVolume',id:m.id,curve:lvVolumeCurve(tissue,motion,{phases:m.phases||40,k:m.k||1})});return}
  if(m.type==='views'){const views=buildViews(tissue.landmarks,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE));self.postMessage({type:'views',id:m.id,views});return}
  if(m.type==='warp'){self.postMessage({type:'warp',id:m.id,points:m.points.map(p=>tissue.remodel?tissue.remodel.forward(p):p)});return} // reference landmark → where it is in the remodelled heart
  if(m.type==='probe'){ // label under one or several points (for teaching: "what am I looking at?")
   const at=p=>{const q=tissue.remodel?tissue.remodel.inverse(p):p;return tissue.tissueAt(q[0],q[1],q[2])};
   if(m.points){self.postMessage({type:'probe',id:m.id,labels:m.points.map(at)});return}
   const l=at(m.point);self.postMessage({type:'probe',id:m.id,label:l});return;
  }
 }catch(error){self.postMessage({type:'error',id:m.id,message:String(error&&error.message||error)})}
};
