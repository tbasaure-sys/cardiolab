// Simulated B-mode worker: owns a copy of the tissue volume, the valve leaflets and the current congenital variant.
import {loadTissue,HeartMotion,ventricularContraction,LABEL} from './tissue.mjs';
import {buildViews,fanObstruction} from './views.mjs';
import {createBMode} from './bmode.mjs';
import {buildValves,sliceValves} from './valves.mjs';
import {placeAtlasPositions} from './geometry.mjs';
import {applyVariant} from './chd-data.mjs';
import {buildFlow,lesionJets} from './flow.mjs';
import {renderSpectrum,optimizeAim} from './spectral.mjs';

let tissue=null,flow=null,valves=[],motion=null,engine=createBMode(),variant={id:'normal'},initDone=null;
async function loadAnatomy(){
 const manifest=await (await fetch('assets/anatomy.json')).json(),buffer=await (await fetch('assets/anatomy.bin')).arrayBuffer();const byName={};
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
  if(m.type==='variant'){tissue.reset();variant=m.spec||{id:'normal'};const info=applyVariant(tissue,variant);flow.jets=lesionJets(tissue,variant);info.jets=flow.jets.length;self.postMessage({type:'variant',id:m.id,info});return}
  if(m.type==='render'){
   const t0=performance.now(),p=m.params,phase=p.phase??0,s=p.beating?ventricularContraction(phase):0;
   const leaflets=p.valves===false?[]:sliceValves(valves,m.pose,p.beating?phase:0,motion,s).map(v=>({segments:v.segments,strength:.012}));
   const frame=engine.render(tissue,{pose:m.pose,lines:p.lines,samples:p.samples,freq:p.freq,gain:p.gain,tgc:p.tgc,dynamicRange:p.dynamicRange,focus:p.focus,motion,contraction:s,overlays:leaflets,color:p.color&&p.color.on?{flow,phase,roi:p.color.roi,nyquist:p.color.nyquist}:null});
   const data=frame.data.slice(),color=frame.color;
   self.postMessage({type:'frame',id:m.id,key:m.key,phaseIndex:m.phaseIndex,frame:{lines:frame.lines,samples:frame.samples,depth:frame.depth,sector:frame.sector,data,color},ms:performance.now()-t0},color?[data.buffer,color.buffer]:[data.buffer]);
   return;
  }
  if(m.type==='spectrum'){const spec={...m.spec};if(spec.optimize){spec.theta=optimizeAim(tissue,flow,motion,spec,spec.optimize);delete spec.optimize}const sp=renderSpectrum(tissue,flow,motion,spec);self.postMessage({type:'spectrum',id:m.id,spectrum:sp},[sp.data.buffer]);return}
  if(m.type==='views'){const views=buildViews(tissue.landmarks,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE));self.postMessage({type:'views',id:m.id,views});return}
  if(m.type==='probe'){ // label under one or several points (for teaching: "what am I looking at?")
   if(m.points){self.postMessage({type:'probe',id:m.id,labels:m.points.map(p=>tissue.tissueAt(...p))});return}
   const l=tissue.tissueAt(...m.point);self.postMessage({type:'probe',id:m.id,label:l});return;
  }
 }catch(error){self.postMessage({type:'error',id:m.id,message:String(error&&error.message||error)})}
};
