// «Paciente virtual»: the bedside instruments of the same patient the echo scans — heart sounds and murmur, pre- and
// postductal saturation, ECG leads — all derived from ONE haemodynamic state (shuntState, shunt-model.mjs) and the beat timing at
// the patient's heart rate (cycle.mjs). Change the defect, the resistance or the hours of life and the murmur, the saturations,
// the ECG and the picture on the screen change together. Pure, no DOM; the panel (bedside-panel.mjs), the audio and the tests
// share it.
//
// What is sourced and what is a model assumption:
// - Sourced, qualitative (Spicer et al. 2014, full text reviewed): VSD — a large defect with low pulmonary resistance gives a
//   harsh holosystolic murmur, a loud second sound with both components and a mitral diastolic rumble; with raised resistance the
//   second sound is loud and single and a murmur may not be audible; a restrictive defect gives a loud murmur that depends on its
//   size. ECG: left, right or biventricular hypertrophy.
// - Sourced, qualitative (Muta et al. 2003, 33 children): ASD — ejection systolic murmur (94 %), fixed split second sound (90 %),
//   mid-diastolic murmur (30 %), incomplete right bundle branch block (79 %), right axis deviation (55 %).
// - Sourced (Tsao et al. 2023): a pulse-oximetry screen is positive with a saturation < 95 % in either limb or a pre-/postductal
//   difference > 3 %; ≤ 90 % is an immediate referral.
// - Model assumptions (NOT sourced): murmur loudness scale (grades 1–6), pitch, the oxygen saturations of pulmonary-venous and
//   mixed-venous blood, the share of systemic flow that goes to the lower body, ECG voltages. The ductus murmur is continuous
//   (textbook teaching, no verified source here). Everything is schematic: it teaches associations, it does not measure.
import {cycleTiming} from './cycle.mjs';

export const BEDSIDE_SOURCES=['spicer2014','muta2003','tsao2023','docencia'];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const SAT={pulmonaryVenous:98,mixedVenous:70,lowerBodyShare:.5}; // model assumptions (% and fraction of systemic flow)
export const SCREEN={belowPct:95,diffPct:3,urgentPct:90}; // Tsao 2023

// ---------------------------------------------------------------- auscultation
const N_ENV=240;
const diamond=(x)=>x<=0||x>=1?0:Math.sin(Math.PI*x)**1.3;               // crescendo–decrescendo (ejection)
const plateau=(x)=>x<=0||x>=1?0:Math.min(1,x/.1,(1-x)/.1)**.6;          // holosystolic: starts at S1, ends at S2
// state: shuntState(); hr: beats/min. Returns the sounds (ms after the QRS) and one beat of murmur envelope.
export function auscultation(state,hr){
 const T=cycleTiming(hr),rr=T.rr,ev=T.events,L=state.lesion,f=state.flows,pr=state.pressures,jet=state.jet,present=state.size>0&&state.defect.diameterMM>0;
 const qpqs=f.qpqs,vSys=jet.sys,vDia=jet.dia,bidirectional=present&&vSys*vDia<0,reverse=present&&(f.direction==='derecha → izquierda');
 // second sound: the pulmonary component grows with the pulmonary diastolic pressure; single when it nearly equals the systemic one
 const p2=.55+1.6*clamp((pr.paDia-12)/22),single=pr.rvRatio>.78,fixed=L==='asd2'&&present&&qpqs>1.25&&!reverse;
 const split=single?0:fixed?55:30;
 const s=[{id:'S1',t:ev.avClose+12,amp:1},{id:'A2',t:ev.slClose,amp:1},...(single?[]:[{id:'P2',t:ev.slClose+split,amp:p2*.55}])];
 if(single)s[1].amp=1+.4*p2; // one loud component
 // murmur: a list of components {kind, a (0…1), shape over the beat}; loudness from jet speed and from flow (model scale)
 const aV=v=>clamp((Math.abs(v)-.3)/3.7)**1.2,comps=[];
 const sysWin=[ev.avClose,ev.slClose],ejWin=[ev.slOpen,ev.slClose];
 if(present&&(L==='vsdpm'||L==='vsdm')){
  const left=vSys>0,flow=clamp((qpqs-1)/3)*.55,a=left?Math.max(aV(vSys),flow):aV(vSys)*.3;
  if(a>.03)comps.push({kind:'holosistólico',a,win:sysWin,shape:plateau,pitch:110+90*Math.abs(vSys)});
  const rumble=clamp((qpqs-1.8)/1.6)*.45;if(left&&rumble>.03)comps.push({kind:'retumbo diastólico mitral',a:rumble,win:[ev.avOpen,Math.min(ev.eEnd+60,rr*.97)],shape:diamond,pitch:70});
 }else if(present&&L==='asd2'){
  const a=reverse?0:clamp((qpqs-1)/1.5)*.55;if(a>.03)comps.push({kind:'eyectivo pulmonar (flujo)',a,win:ejWin,shape:diamond,pitch:150});
  const rumble=clamp((qpqs-1.9)/1.3)*.4;if(!reverse&&rumble>.03)comps.push({kind:'retumbo diastólico tricuspídeo',a:rumble,win:[ev.avOpen,Math.min(ev.eEnd+60,rr*.97)],shape:diamond,pitch:70});
 }else if(present&&L==='pda'){
  // continuous: the envelope follows the aorto-pulmonary velocity through the beat; none if flow is right-to-left all cycle (suprasystemic pulmonary pressure)
  const k=bidirectional?.3:1,aS=aV(vSys)*k,aD=aV(vDia)*k,a=reverse&&!bidirectional?0:Math.max(aS,aD);
  if(a>.03)comps.push({kind:bidirectional?'sistólico suave':'continuo',a,continuous:true,aS:bidirectional?(vSys>0?aS:0):aS,aD:bidirectional?(vDia>0?aD:0):aD,pitch:120+60*Math.max(Math.abs(vSys),Math.abs(vDia))});
 }
 // one beat of envelope (0…1) sampled over the R–R interval
 const env=new Float32Array(N_ENV);
 for(const c of comps){for(let i=0;i<N_ENV;i++){const ms=(i+.5)/N_ENV*rr;let v;
  if(c.continuous){const ph=T.early(ms/rr),S=ph>.06&&ph<.34?Math.sin(Math.PI*(ph-.06)/.28)**2:0;v=(c.aD+(c.aS-c.aD)*S)*(.85+.15*Math.cos(2*Math.PI*ms/rr)) }
  else{const [a,b]=c.win;v=c.a*c.shape((ms-a)/(b-a))}
  env[i]=Math.max(env[i],v)}}
 const peak=comps.length?Math.max(...comps.map(c=>c.continuous?Math.max(c.aS,c.aD):c.a)):0,main=[...comps].sort((a,b)=>b.a-a.a)[0]||null;
 const grade=peak>.03?clamp(1+Math.floor(peak*5.99),1,6):0;
 const sentences=[];
 sentences.push(single?'Segundo ruido único y fuerte (la presión pulmonar iguala a la sistémica).':fixed?'Segundo ruido desdoblado de forma fija y amplia.':p2>1.6?'Componente pulmonar del segundo ruido reforzado (presión pulmonar elevada).':'Segundo ruido con desdoblamiento normal.');
 if(comps.length){for(const c of comps)sentences.push(`Soplo ${c.kind}${c===main&&grade?`, grado ${grade}/6`:''}.`);if(grade>=4)sentences.push('Con frémito.')}else sentences.push(present?'Sin soplo audible (en el modelo, velocidad y flujo del defecto demasiado bajos).':'Sin soplos.');
 return {hr,rr,sounds:s,split,fixed,single,p2,murmur:{kind:main?.kind||'ninguno',grade,peak,components:comps.map(c=>({kind:c.kind,a:c.continuous?Math.max(c.aS,c.aD):c.a,pitch:c.pitch})),pitch:main?.pitch||0,env},sentences};
}
// A one-beat phonocardiogram (S1, S2 with A2 and P2, murmur as band-limited noise shaped by the envelope). Deterministic.
export function synthPhonocardiogram(a,{sampleRate=4000,seed=7}={}){
 const n=Math.round(a.rr/1000*sampleRate),out=new Float32Array(n);let r=seed>>>0||1;const rnd=()=>{r=(Math.imul(r,1664525)+1013904223)>>>0;return r/4294967296*2-1};
 const burst=(t0,f1,f2,amp,tau)=>{const i0=Math.round(t0/1000*sampleRate),len=Math.round(tau*6/1000*sampleRate);for(let i=0;i<len&&i0+i<n;i++){const t=i/sampleRate;out[i0+i]+=amp*Math.exp(-t/(tau/1000))*(Math.sin(2*Math.PI*f1*t)+.6*Math.sin(2*Math.PI*f2*t))*.5}};
 for(const s of a.sounds){const first=s.id==='S1';burst(s.t,first?55:75,first?110:140,.7*s.amp,first?28:22)}
 // murmur: noise through a resonator at the murmur's pitch, amplitude from the envelope
 const m=a.murmur;if(m.peak>.03){const f0=m.pitch||150,w=2*Math.PI*f0/sampleRate,rho=.96,b1=2*rho*Math.cos(w),b2=-rho*rho,g=1-rho;let y1=0,y2=0;
  for(let i=0;i<n;i++){const e=m.env[Math.min(N_ENV-1,Math.floor(i/n*N_ENV))],x=rnd()*e,y=g*x+b1*y1+b2*y2;y2=y1;y1=y;out[i]+=y*5.5}}
 let mx=0;for(const v of out)mx=Math.max(mx,Math.abs(v));if(mx>1)for(let i=0;i<n;i++)out[i]/=mx;
 return out;
}
// the sound's energy (RMS) in a window of the beat, ms after the QRS
export function rmsBetween(wave,rr,a,b){const n=wave.length,i0=Math.max(0,Math.floor(a/rr*n)),i1=Math.min(n,Math.ceil(b/rr*n));let s=0;for(let i=i0;i<i1;i++)s+=wave[i]*wave[i];return Math.sqrt(s/Math.max(1,i1-i0))}

// ---------------------------------------------------------------- pulse oximetry (right hand = preductal, foot = postductal)
export function saturations(state){
 const f=state.flows,present=state.size>0&&state.defect.diameterMM>0,Qs=f.Qs,rl=present&&f.Qsh<0?-f.Qsh:0,sv=SAT.mixedVenous,sa=SAT.pulmonaryVenous;
 let pre=sa,post=sa,qrl=0,site='ninguno';
 if(state.lesion==='pda'&&present){
  // ductal right-to-left flow enters the descending aorta: it lowers the postductal saturation only
  const areaM2=state.defect.areaMM2*1e-6,vs=Math.abs(state.jet.sys),bid=state.jet.sys*state.jet.dia<0&&state.jet.sys<0;
  qrl=f.Qsh<0?-f.Qsh:bid?.7*areaM2*vs*.25*60000:0; // L/min (bidirectional: right-to-left only in the systolic share of the beat)
  const lower=SAT.lowerBodyShare*Qs,frac=qrl/(lower+qrl);post=sa-frac*(sa-sv);site='ductal';
 }else if(rl>0){
  // atrial or ventricular right-to-left shunt: venous blood reaches the whole systemic circulation, both limbs equally
  const frac=rl/Qs;pre=post=sa-frac*(sa-sv);qrl=rl;site='intracardiaco';
 }
 const diff=pre-post,positive=pre<SCREEN.belowPct||post<SCREEN.belowPct||diff>SCREEN.diffPct,urgent=Math.min(pre,post)<=SCREEN.urgentPct;
 return {pre,post,diff,positive,urgent,qrl,site,screen:positive?(urgent?'Cribado positivo: derivación inmediata (saturación ≤ 90 %)':'Cribado positivo'):'Cribado negativo',
  note:site==='ductal'&&diff>SCREEN.diffPct?'Diferencia pre-posductal: sangre venosa que pasa por el ductus a la aorta descendente.':site==='intracardiaco'?'Desaturación en ambas extremidades por el cortocircuito derecha-izquierda.':'Sin cortocircuito derecha-izquierda significativo.'};
}

// ---------------------------------------------------------------- ECG, leads V1 and V6 (schematic, relative to this patient's normal)
const g=(x,c,w,a)=>a*Math.exp(-((x-c)**2)/(2*w*w));
export function ecgLeads(state,hr,{n=400}={}){
 const T=cycleTiming(hr),rr=T.rr,gn=state.gains||{},present=state.size>0&&state.defect.diameterMM>0;
 const rvLoad=present?clamp((state.pressures.rvRatio-.45)/.4):0,rvVol=present?(gn.RV||0):0,lvVol=present?(gn.LV||0):0;
 const pAt=rr-clamp(130-.2*(hr-60),70,130),tAt=T.events.slClose-35;
 const wave=(ms,{p,q,r,s,rp,t})=>{const x=ms>rr-200?ms-rr:ms; // the QRS of the next beat is at ms = rr ≡ 0
  return g(ms,pAt,18,p)+g(x,-14,5,q)+g(x,0,7,r)+g(x,16,7,s)+g(x,55,9,rp)+g(ms,tAt,48,t)};
 const v1={p:.08,q:0,r:.30+rvLoad*1.6+rvVol*.5,s:-(.85-.45*rvLoad+lvVol*3),rp:rvVol*3.2,t:-.04+rvLoad*.45},
  v6={p:.10,q:-(.14+lvVol*2.2),r:1+lvVol*5.5,s:-.12,rp:0,t:.30+lvVol*1.8};
 const A=new Float32Array(n),B=new Float32Array(n);
 for(let i=0;i<n;i++){const ms=i/n*rr;A[i]=wave(ms,v1);B[i]=wave(ms,v6)}
 const findings=[];
 if(rvLoad>.15)findings.push({id:'rvh',text:'R alta en V1 y onda T positiva en V1: carga de presión del ventrículo derecho (en las primeras semanas de vida la R alta en V1 es normal: aquí el esquema se lee respecto a la edad)',sources:['spicer2014']});
 if(rvVol>.03)findings.push({id:'rsr',text:'Patrón rsR′ en V1 (bloqueo incompleto de rama derecha): sobrecarga de volumen del ventrículo derecho',sources:['muta2003']});
 if(lvVol>.03)findings.push({id:'lvh',text:'R alta y Q profunda en V6: sobrecarga de volumen del ventrículo izquierdo',sources:['spicer2014']});
 if(!findings.length)findings.push({id:'normal',text:'Sin signos de sobrecarga ventricular en este modelo',sources:['docencia']});
 return {rr,V1:A,V6:B,findings,params:{rvLoad,rvVol,lvVol}};
}

// ---------------------------------------------------------------- everything at the bedside for one state
export function bedside(state,hr){
 return {auscultation:auscultation(state,hr),saturation:saturations(state),ecg:ecgLeads(state,hr)};
}
