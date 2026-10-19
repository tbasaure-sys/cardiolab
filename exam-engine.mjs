// Structured study with an exact ground truth. A seed makes a case (patient, lesion, size, resistance or age); the simulator
// holds the exact answer, so the report can be graded to the millimetre and the protocol can be graded on what was actually
// imaged, not on what the reader says they did. Worker-safe, no DOM, nothing here is a patient: every case is synthetic.
//
// What is sourced and what is a teaching choice:
// - The views of a pediatric study (parasternal, apical, subcostal) and colour Doppler interrogation of the septa and the
//   ductus come from the ASE pediatric guideline (Lopez 2024); that a velocity depends on cos θ, from Quiñones 2002.
// - NOT sourced (teaching choices, declared): the tolerances of each measurement, the points of the score, the case mix.
import {rng,anchorStatus} from './lesson-engine.mjs';
import {shuntState,LESIONS} from './shunt-model.mjs';
import {HOURS} from './transition.mjs';
import {PATIENT_BY_ID} from './patient.mjs';
import {nearestView,VIEW_INFO} from './views.mjs';
import {chordAtOffset} from './attribute.mjs';

export const EXAM_VERSION=1;
export const EXAM_SOURCES=['ase2024','quinones2002','docencia'];
export const TOLERANCE_NOTE='Tolerancias y puntos: criterio docente del simulador, no umbral clínico.';
const POOL=['neonate','infant','toddler','child','preteen'];
const KINDS=['normal','asd2','vsdpm','vsdm','pda'];
const NEONATE_HOURS=[3,6,12,24,48,72,168,336];
export const LESION_OPTIONS=[{id:'normal',name:'Sin defecto'},...Object.entries(LESIONS).map(([id,v])=>({id,name:v.name}))];
export const DIRECTIONS=['sin cortocircuito','izquierda → derecha','derecha → izquierda','bidireccional'];
export const SEVERITIES=[{key:'none',label:'Sin defecto'},{key:'small',label:'Sin sobrecarga de volumen apreciable'},{key:'moderate',label:'Sobrecarga moderada'},{key:'large',label:'Sobrecarga importante'},{key:'reverse',label:'Cortocircuito invertido o bidireccional'}];
// the structure each lesion is read at: landmark (atlas), and where the flow can be measured
export const SITES={asd2:{id:'asd2',landmark:'asdSecundum',name:'Tabique interauricular'},vsdpm:{id:'vsdpm',landmark:'vsdPerimembranous',name:'Septo membranoso'},
 vsdm:{id:'vsdm',landmark:'vsdMuscular',name:'Septo muscular'},pda:{id:'pda',landmark:'ductMid',jet:'ductJet',name:'Ductus arterioso'}};
export const SITE_IDS=Object.keys(SITES);

// ---------------------------------------------------------------- the case
export function makeCase(seed){
 seed=Math.max(1,Math.floor(Number(seed)||1));const r=rng(Math.imul(seed,2654435761)^0x9e3779b9);r();r();
 const lesion=KINDS[Math.floor(r()*KINDS.length)],patientId=POOL[Math.floor(r()*POOL.length)],patient=PATIENT_BY_ID[patientId];
 const size=lesion==='normal'?0:Math.round((.25+.75*r())*20)/20;
 let pvr='normal',hours=null,closing=false;
 if(patientId==='neonate'){hours=NEONATE_HOURS[Math.floor(r()*NEONATE_HOURS.length)];closing=lesion==='pda'&&r()<.5}
 else if(lesion!=='normal'&&size>=.6){const u=r();pvr=u<.72?'normal':u<.9?'elevada':'suprasistemica'}
 const state=shuntState({lesion:lesion==='normal'?'asd2':lesion,size,pvr,patient,hours,closing});
 return {seed,version:EXAM_VERSION,lesion,patientId,size,pvr:hours==null?pvr:null,hours,closing,state,truth:truthOf(lesion,state)};
}
export function truthOf(lesion,state){
 const none=lesion==='normal'||!state.size;
 return {lesion:none?'normal':lesion,diameterMM:none?0:state.defect.diameterMM,velocity:none?0:Math.max(Math.abs(state.jet.sys),Math.abs(state.jet.dia)),
  direction:none?'sin cortocircuito':state.flows.direction,severity:none?'none':state.grade.key,qpqs:none?1:state.flows.qpqs,
  // the exact geometry the plane offset is measured against (atlas metres)
  radiusAtlas:none?0:state.defect.atlasRadiusM,k:state.patient.k};
}
export function describeCase(c){const p=PATIENT_BY_ID[c.patientId];return {seed:c.seed,patient:p.name,age:p.age,weightKg:p.weight,heightCm:p.height,hr:p.hr,sbp:Math.round(c.state.patient.sbp),dbp:Math.round(c.state.patient.dbp),hours:c.hours}}

// ---------------------------------------------------------------- what was imaged
// pose: {origin,u,d,n,depth,sector} (atlas); roi: colour box {center,half,r0,r1} (degrees, fractions of depth) or null
export function inColorBox(pose,point,roi){
 if(!roi)return false;const q=[0,1,2].map(i=>point[i]-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2];
 if(y<=0)return false;const ang=Math.atan2(x,y)*180/Math.PI,r=Math.hypot(x,y)/pose.depth;return Math.abs(ang-roi.center)<=roi.half&&r>=roi.r0&&r<=roi.r1;
}
// sites: {asd2:{point,jetPoint?}, …} in the (possibly remodelled) heart; acq: saved acquisitions
export function siteCoverage(acqs,sites,{tol=.005}={}){
 return SITE_IDS.map(id=>{const s=sites[id];let best=null;
  for(const a of acqs){if(a.kind!=='image'||!a.pose)continue;const st=anchorStatus(a.pose,s.point,tol);const colour=!!a.color?.on&&inColorBox(a.pose,s.point,a.color.roi);
   const cand={ok:st.ok&&colour,inPlane:st.ok,colour,offMM:+(st.off*1000).toFixed(1)};if(!best||(cand.ok&&!best.ok)||(cand.ok===best.ok&&cand.inPlane&&!best.inPlane)||(cand.ok===best.ok&&cand.inPlane===best.inPlane&&cand.offMM<best.offMM))best=cand}
  return {id,name:SITES[id].name,...(best||{ok:false,inPlane:false,colour:false,offMM:null})}});
}
export function windowsCovered(acqs,views,{min=70}={}){
 const set=new Set(),list=[];for(const a of acqs){if(a.kind!=='image'||!a.pose)continue;const n=nearestView(a.pose,views);if(n&&n.score>=min&&VIEW_INFO[n.id]){set.add(VIEW_INFO[n.id].window);list.push({view:n.id,window:VIEW_INFO[n.id].window,score:n.score})}}
 return {windows:[...set],list};
}

// ---------------------------------------------------------------- grading
const ORDER=['small','moderate','large'];
// how far a numeric answer is, in units of its tolerance
const band=(err,tol)=>Math.abs(err)<=tol?1:Math.abs(err)<=2*tol?.5:0;
export const TOL={size:t=>Math.max(1.5,.2*t),velocity:t=>Math.max(.25,.12*t),qpqs:()=>.35};
export const POINTS={lesion:25,size:10,velocity:10,direction:10,severity:10,windows:10,sites:20,documentation:5};

// report: {lesion, diameterMM, velocity, direction, severity, qpqs}; acqs and sites as above; views: reference views by id
export function gradeExam(c,report,acqs,sites,views){
 const T=c.truth,items=[],none=T.lesion==='normal';
 const add=(id,label,truth,answer,error,tol,frac,max,note=null)=>items.push({id,label,truth,answer,error,tol,frac,pts:+(frac*max).toFixed(1),max,note});
 const level=l=>l==='asd2'?'auricular':l==='pda'?'arterial':l==='normal'?'ninguno':'ventricular';
 {const ok=report.lesion===T.lesion,partial=!ok&&report.lesion&&level(report.lesion)===level(T.lesion)&&T.lesion!=='normal';
  add('lesion','Diagnóstico',T.lesion,report.lesion||null,null,null,ok?1:partial?.4:0,POINTS.lesion,partial?'Acertaste el nivel (auricular, ventricular o arterial), no el defecto':null)}
 if(!none){
  {const a=report.diameterMM,has=Number.isFinite(a);const tol=TOL.size(T.diameterMM);add('size','Diámetro del defecto (mm)',T.diameterMM,has?a:null,has?a-T.diameterMM:null,tol,has?band(a-T.diameterMM,tol):0,POINTS.size)}
  {const a=report.velocity,has=Number.isFinite(a);const tol=TOL.velocity(T.velocity);add('velocity','Velocidad máxima del chorro (m/s)',T.velocity,has?a:null,has?a-T.velocity:null,tol,has?band(a-T.velocity,tol):0,POINTS.velocity)}
  add('direction','Dirección del cortocircuito',T.direction,report.direction||null,null,null,report.direction===T.direction?1:0,POINTS.direction);
  {const a=report.severity,t=T.severity,ia=ORDER.indexOf(a),it=ORDER.indexOf(t);add('severity','Repercusión (bandas del modelo)',t,a||null,null,null,a===t?1:ia>=0&&it>=0&&Math.abs(ia-it)===1?.5:0,POINTS.severity)}
  if(Number.isFinite(report.qpqs))add('qpqs','Qp/Qs (opcional)',T.qpqs,report.qpqs,report.qpqs-T.qpqs,TOL.qpqs(),band(report.qpqs-T.qpqs,TOL.qpqs()),0,'No suma puntos: es una estimación voluntaria')
 }else{
  // nothing to size: reporting a defect where there is none costs the diagnosis, and the numbers are not scored
  for(const [id,label] of [['size','Diámetro del defecto (mm)'],['velocity','Velocidad máxima del chorro (m/s)'],['direction','Dirección del cortocircuito'],['severity','Repercusión (bandas del modelo)']]){
   const pts=POINTS[id],said=id==='size'?report.diameterMM:id==='velocity'?report.velocity:id==='direction'?report.direction:report.severity;
   const clean=said==null||said===''||said===0||said==='sin cortocircuito'||said==='none';add(id,label,id==='direction'?'sin cortocircuito':id==='severity'?'none':0,clean?(id==='size'||id==='velocity'?0:said||null):said,null,null,report.lesion==='normal'&&clean?1:0,pts,'No hay defecto: no hay nada que medir')}
 }
 const win=windowsCovered(acqs,views),cov=siteCoverage(acqs,sites),nSites=cov.filter(s=>s.ok).length;
 add('windows','Ventanas exploradas',3,win.windows.length,null,null,win.windows.length>=3?1:win.windows.length===2?.5:0,POINTS.windows,`Ventanas con vista reconocible: ${win.windows.join(', ')||'ninguna'}`);
 add('sites','Zonas interrogadas con color',4,nSites,null,null,nSites/4,POINTS.sites,cov.map(s=>`${s.name}: ${s.ok?'sí':s.inPlane?'plano sí, sin color en la zona':'no'}`).join(' · '));
 {const doc=none?nSites>=3:(()=>{const s=cov.find(x=>x.id===T.lesion);return !!s?.ok})();add('documentation',none?'Documentaste la ausencia de defecto':'Documentaste el defecto con color',1,doc?1:0,null,null,doc?1:0,POINTS.documentation,none?'Se necesitan al menos 3 de las 4 zonas interrogadas':null)}
 const total=+items.reduce((a,x)=>a+x.pts,0).toFixed(1),max=items.reduce((a,x)=>a+x.max,0);
 return {items,total,max,percent:Math.round(total/max*100),coverage:cov,windows:win.windows,tolerance:TOLERANCE_NOTE};
}

// ---------------------------------------------------------------- what the measurements have to be compared with
// offset of the plane from the centre of the defect (atlas metres) and the longest chord it can show (physical mm)
export function chordFor(c,pose,centre){
 const T=c.truth;if(!T.radiusAtlas)return {offMM:null,chordMM:0};const st=anchorStatus(pose,centre,1);
 return {offMM:+(st.off*1000*T.k).toFixed(1),chordMM:chordAtOffset(T.radiusAtlas,st.off)*1000*T.k};
}
