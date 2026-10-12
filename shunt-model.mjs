// Teaching hemodynamic model of a simple left-to-right shunt (ASD, VSD, PDA) in a child. Worker-safe, no DOM.
// It turns a defect size, the pulmonary vascular resistance and the patient's size into flows, pressures, jet velocities
// and chamber enlargement, so that the simulated study (image, colour, spectral Doppler) changes as a whole.
//
// What is sourced and what is a model assumption:
// - Relationships (sourced): the shunt depends on the size of the defect and on the relation between pulmonary and
//   systemic resistances; a small VSD is restrictive (high gradient, low RV pressure), a large one is not (pressures
//   equalise, pulmonary hypertension); LA and LV dilation imply a large VSD shunt; a defect ≥ ½ of the aortic root has
//   significant haemodynamic effects (Spicer et al. 2014, full text reviewed). In a ductus the shunt is set by its size and
//   by the pressures at both ends, and the LV output carries the systemic flow plus the shunt (van Laere et al. 2018,
//   full text reviewed). Simplified Bernoulli ΔP = 4v² (Quiñones et al. 2002, metadata only).
// - Model assumptions (NOT sourced, chosen to be plausible and documented here): cardiac index, blood pressure by age,
//   pulmonary resistance values, discharge coefficient, interatrial driving pressure, how much a chamber enlarges for a
//   given extra flow. The categories shown («sin sobrecarga», «moderada», «importante», «restrictivo»…) are bands of
//   this model, not clinical thresholds.
import {bsaHaycock,bodyScale} from './patient.mjs';

export const MODEL_VERSION=1;
export const LESIONS={
 asd2:{name:'CIA ostium secundum',level:'auricular',maxAtlasMM:26,overload:['RA','RV']},
 vsdpm:{name:'CIV perimembranosa',level:'ventricular',maxAtlasMM:22,overload:['LA','LV']},
 vsdm:{name:'CIV muscular',level:'ventricular',maxAtlasMM:16,overload:['LA','LV']},
 pda:{name:'Ductus arterioso persistente',level:'arterial',maxAtlasMM:10,overload:['LA','LV']}
};
export const PVR={normal:{name:'Normal',index:3.5},elevada:{name:'Elevada',index:10},suprasistemica:{name:'Suprasistémica',index:26}};
export const AORTIC_ROOT_ATLAS_MM=29; // measured on the atlas volume at the sinuses (tests/shunt.test.mjs)
// model assumptions (documented, not sourced)
const ASSUME={cardiacIndex:3.5,laMean:6,raMean:4,cd:.7,rho:1060,mmHg:133.32,
 paPulse:{sys:1.5,dia:.7},recruit:.6,vsdDuty:.42,asdDrive:{normal:4,elevada:.6,suprasistemica:-1.2},asdCompliance:.9,
 systolicByAge:[[0,70],[.08,85],[1,95],[4,100],[9,105],[14,115],[18,120]]};
const lerpTable=(t,x)=>{if(x<=t[0][0])return t[0][1];for(let i=1;i<t.length;i++)if(x<=t[i][0]){const [a,b]=[t[i-1],t[i]];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])}return t.at(-1)[1]};
const ageYears=p=>{const a=String(p.age||'');const n=parseFloat(a);if(/día/.test(a))return n/365;if(/mes/.test(a))return n/12;if(/adulto/.test(a))return 30;return n||6};
// flow through an orifice (L/min) for a pressure difference (mmHg), signed
function orifice(areaM2,dP,duty=1){const v=Math.sqrt(2*Math.abs(dP)*ASSUME.mmHg/ASSUME.rho);return Math.sign(dP)*ASSUME.cd*areaM2*v*duty*60000}
// solve Q = g(Q) for a decreasing g by bisection on [lo,hi]
function solve(g,lo,hi){for(let i=0;i<80;i++){const m=(lo+hi)/2;if(g(m)-m>0)lo=m;else hi=m}return (lo+hi)/2}

// size: 0…1 of the lesion's largest teaching size; pvr: key of PVR; patient: from patient.mjs
export function shuntState({lesion,size=0,pvr='normal',patient}){
 const L=LESIONS[lesion];if(!L)throw Error(`Lesión sin modelo: ${lesion}`);
 const bsa=bsaHaycock(patient.weight,patient.height),k=bodyScale(patient),age=ageYears(patient);
 const sbp=lerpTable(ASSUME.systolicByAge,age),dbp=Math.round(sbp*.6),map=(sbp+2*dbp)/3;
 const Qs=ASSUME.cardiacIndex*bsa,Rp=PVR[pvr].index/bsa;
 // pulmonary pressures for a pulmonary flow; with an atrial shunt the vascular bed accommodates the extra flow at low
 // pressure (recruitment, model assumption), with a post-tricuspid shunt the pressure is also transmitted by the defect
 const pa=Qp=>{const R=lesion==='asd2'&&pvr==='normal'?Rp/(1+ASSUME.recruit*Math.max(0,Qp/Qs-1)):Rp,m=ASSUME.laMean+R*Math.max(Qp,0);return {mean:m,sys:m*ASSUME.paPulse.sys,dia:m*ASSUME.paPulse.dia}};
 const atlasMM=size*L.maxAtlasMM,dMM=atlasMM*k,area=Math.PI*(dMM/2000)**2;
 let Qsh=0,jet={sys:0,dia:0},drive=null;
 if(area>0){
  if(lesion==='asd2'){
   // interatrial gradient: a few mmHg that fall as the defect lets the atria equalise; reversed when the RV is stiff
   const d0=ASSUME.asdDrive[pvr],dP=Q=>d0-ASSUME.asdCompliance*Q/bsa;
   Qsh=d0>=0?solve(Q=>orifice(area,Math.max(0,dP(Q))),0,Qs*6):-solve(Q=>orifice(area,Math.max(0,-d0-ASSUME.asdCompliance*Q/bsa)),0,Qs*.6);
   const g=Qsh>=0?dP(Qsh):d0+ASSUME.asdCompliance*Math.abs(Qsh)/bsa;jet={sys:Math.sign(Qsh)*Math.sqrt(Math.abs(g)/4),dia:Math.sign(Qsh)*Math.sqrt(Math.abs(g)/4)};drive=g;
  }else if(lesion==='pda'){
   // continuous: mean aorto-pulmonary gradient drives the flow
   const g=Q=>orifice(area,map-pa(Qs+Q).mean);Qsh=solve(g,-Qs*.6,Qs*6);
   const P=pa(Qs+Qsh);jet={sys:Math.sign(sbp-P.sys)*Math.sqrt(Math.abs(sbp-P.sys)/4),dia:Math.sign(dbp-P.dia)*Math.sqrt(Math.abs(dbp-P.dia)/4)};drive=map-P.mean;
  }else{
   // VSD: systolic LV–RV gradient over the ejection fraction of the cycle; RV systolic = PA systolic (no RVOT obstruction)
   const g=Q=>orifice(area,sbp-pa(Qs+Q).sys,ASSUME.vsdDuty);Qsh=solve(g,-Qs*.6,Qs*6);
   const P=pa(Qs+Qsh);jet={sys:Math.sign(sbp-P.sys)*Math.sqrt(Math.abs(sbp-P.sys)/4),dia:0};drive=sbp-P.sys;
  }
 }
 const Qp=Qs+Qsh,qpqs=Qp/Qs,P=pa(Qp),rvSys=lesion==='asd2'||lesion==='pda'||area===0?Math.max(P.sys,15):Math.max(P.sys,15);
 // chamber enlargement from the extra volume each overloaded chamber handles (model assumption: EDV × (1+0.6·(Qp/Qs−1)))
 const extra=Math.max(0,qpqs-1),gains={};for(const c of L.overload){const kappa=c.startsWith('L')?(c==='LA'?.55:.6):(c==='RA'?.5:.6);gains[c]=Math.cbrt(Math.min(2.2,1+kappa*extra))-1}
 // velocity multipliers per flow compartment and direction (flow / area; areas grow with the chamber). LV/RV: inflow;
 // LVout/RVout: ejection. ASD: right heart and PA carry Qp; VSD: LA, LV filling, RV outflow and PA carry Qp, the aorta Qs;
 // PDA: LA, LV and aorta carry Qp (LV output = systemic flow + shunt, van Laere 2018), the main PA proximal to the duct Qs
 const fs={LA:1,LV:1,LVout:1,RA:1,RV:1,RVout:1,AO:1,PA:1,PV:1},A=c=>(1+(gains[c]||0))**2,pos=Math.max(qpqs,.3),paV=Math.sqrt(pos); // the pulmonary trunk dilates with its flow (model): velocity ∝ √(Qp/Qs)
 if(area>0){
  if(lesion==='asd2')Object.assign(fs,{RA:pos/A('RA'),RV:pos/A('RV'),RVout:pos/A('RV'),PA:paV,PV:pos});
  else if(lesion==='pda')Object.assign(fs,{LA:pos/A('LA'),LV:pos/A('LV'),LVout:pos/A('LV'),AO:pos,PV:pos});
  else Object.assign(fs,{LA:pos/A('LA'),LV:pos/A('LV'),RVout:paV,PA:paV,PV:pos});
 }
 // RV pressure load → RV wall thickening (model): when the RV works at more than half the systemic pressure
 const rvRatio=rvSys/sbp,rvWallMM=rvRatio>.5?Math.min(4,(rvRatio-.5)*8)/k:0;
 const restr=lesion==='asd2'?null:area===0?null:drive/(lesion==='pda'?map:sbp);
 const rootMM=AORTIC_ROOT_ATLAS_MM*k;
 return {model:MODEL_VERSION,lesion,size,pvr,patient:{bsa,k,ageYears:age,sbp,dbp},
  defect:{diameterMM:dMM,atlasRadiusM:atlasMM/2000,areaMM2:area*1e6,rootMM,rootRatio:lesion.startsWith('vsd')?dMM/rootMM:null},
  flows:{Qs,Qp,Qsh,qpqs,direction:Math.abs(Qsh)<.02*Qs&&!(jet.sys*jet.dia<0)?'sin cortocircuito':jet.sys*jet.dia<0?'bidireccional':Qsh>0?'izquierda → derecha':'derecha → izquierda'},
  pressures:{paMean:P.mean,paSys:P.sys,paDia:P.dia,rvSys,rvRatio,drive},jet,restrictiveness:restr,gains,flowScale:fs,rvWallMM,
  grade:gradeOf(lesion,{gains,qpqs,restr,rvRatio,area,Qsh,jet})};
}
// bands of this model (qualitative), not clinical thresholds
export function gradeOf(lesion,{gains,qpqs,restr,rvRatio,area,Qsh,jet}){
 if(!area)return {key:'none',label:'Sin defecto'};
 if(jet&&jet.sys*jet.dia<0)return {key:'reverse',label:'Cortocircuito bidireccional: presión pulmonar suprasistémica en parte del ciclo'};
 if(Qsh<0)return {key:'reverse',label:'Cortocircuito invertido (derecha → izquierda)'};
 const g=Math.max(...Object.values(gains),0);
 const load=g<.04?'sin sobrecarga de volumen apreciable':g<.12?'sobrecarga de volumen moderada':'sobrecarga de volumen importante';
 const pres=rvRatio>.75?'presión pulmonar casi sistémica':rvRatio>.45?'presión pulmonar elevada':'presión pulmonar normal';
 const r=restr==null?'':restr>.6?'restrictivo · ':restr>.25?'moderadamente restrictivo · ':'no restrictivo · ';
 return {key:g<.04?'small':g<.12?'moderate':'large',label:`${r}${load} · ${pres}`};
}
// the variant spec the simulator applies (chd-data.applyVariant, flow.lesionJets, worker remodel)
export function variantSpec(state){
 const id=state.lesion;if(!state.size)return {id:'normal'};
 return {id,params:{radius:state.defect.atlasRadiusM,hemo:{gains:state.gains,flowScale:state.flowScale,jet:state.jet,rvWallMM:state.rvWallMM,qpqs:state.flows.qpqs}}};
}
export const SHUNT_SOURCES=['spicer2014','vanlaere2018','quinones2002','silvestry2015','docencia'];
