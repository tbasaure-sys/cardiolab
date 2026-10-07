// Lesson engine: turns a versioned lesson specification (JSON, schema cardiolab.lesson/1) into an executable lesson —
// question → anatomy → starting landmark → probe maneuver → plane change → expected image → confirmation →
// optimisation → rescue → evidence — that feeds the guided demonstration, practice, exam and the exported micro-lesson.
// Pure (no DOM): the browser panel, the tests and the exporter share it. Deterministic: same spec, seed and time give
// the same state (seek). No branch is specific to a diagnosis: lessons are data.
import {poseFromState,defaultState,PRESETS,physical,dot,sub,rad} from './geometry.mjs';
import {VIEW_INFO,VIEW_CARD,planeAgreement,solveState,markerClock} from './views.mjs';

export const SCHEMA='cardiolab.lesson/1';
export const STAGES=['orientar','mover','confirmar','optimizar','rescatar','evidencia'];
export const MODES=['demostracion','practica','examen'];
export const LAYERS={fundamentos:'Fundamentos',adquisicion:'Adquisición sistemática',calidad:'Calidad y medición',problemas:'Problemas y anatomías'};
const PRESET_OF={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'};
const KEYS=['x','z','tilt','rock','rotation','depth','sector'];

// ---------------------------------------------------------------- probe maneuvers
// Each verb is defined by the physical change of the transducer and the coordinate system it uses. Directions are
// patient-referenced (cranial/caudal, patient's left/right, anterior/posterior) or marker-referenced, never screen-
// referenced: changing the image presentation (apex up/down) does not change the acquired plane.
export const VERBS={
 deslizar:{name:'Deslizar',physical:'La cara de la sonda se traslada sobre la piel sin cambiar su orientación: el plano se desplaza paralelo a sí mismo.',
  directions:{craneal:['z',1],caudal:['z',-1],'izquierda del paciente':['x',1],'derecha del paciente':['x',-1]},unit:'mm'},
 rotar:{name:'Rotar',physical:'La sonda gira sobre su eje (el haz central) sin moverse sobre la piel: el marcador cambia de hora y el plano gira alrededor del haz central. Sentido visto desde el mango.',
  directions:{horario:['rotation',1],antihorario:['rotation',-1]},unit:'°'},
 inclinar:{name:'Inclinar (tilt)',physical:'Con el punto de contacto fijo, el mango se inclina perpendicular al plano de imagen: el haz y el plano barren fuera del corte, como un abanico que se abre hacia un lado.',
  directions:{craneal:'beam',caudal:'beam',anterior:'beam',posterior:'beam','izquierda del paciente':'beam','derecha del paciente':'beam'},key:'tilt',unit:'°'},
 bascular:{name:'Bascular (rock)',physical:'Con el punto de contacto fijo, el mango se inclina dentro del plano de imagen: el haz se desplaza hacia un lado de la imagen sin cambiar el plano.',
  directions:{'hacia el marcador':'marker','lejos del marcador':'marker'},key:'rock',unit:'°'},
 barrer:{name:'Barrer',physical:'Inclinación (tilt) lenta de ida y vuelta para recorrer estructuras que entran y salen del plano, volviendo al plano de partida.',
  directions:{'ida y vuelta':'sweep'},key:'tilt',unit:'°'}
};
const AXIS={craneal:[0,0,1],caudal:[0,0,-1],'izquierda del paciente':[1,0,0],'derecha del paciente':[-1,0,0],anterior:[0,-1,0],posterior:[0,1,0]};
// state after one maneuver (amount in mm for slides, degrees otherwise); barrer returns the same state (it oscillates)
export function applyManeuver(state,m){
 const v=VERBS[m.verb];if(!v)throw Error(`Maniobra desconocida: ${m.verb}`);const dir=v.directions[m.direction];if(dir==null)throw Error(`Dirección «${m.direction}» no válida para ${m.verb}`);
 const s={...state};if(m.verb==='barrer')return s;
 if(Array.isArray(dir)){const [k,sg]=dir;s[k]+=sg*(k==='x'||k==='z'?m.amount/1000:m.amount);return s}
 const k=v.key,p0=poseFromState(state);let best=null;
 for(const sg of [1,-1]){const t={...state,[k]:state[k]+sg*m.amount},p1=poseFromState(t),dd=sub(p1.d,p0.d);
  const score=dir==='beam'?dot(dd,AXIS[m.direction]):(m.direction==='hacia el marcador'?1:-1)*dot(dd,p0.u);if(!best||score>best.score)best={score,t}}
 return best.t;
}
// The physical change between two probe states, in the maneuver's own terms: signed rotation of the marker about the
// initial beam (+ = clockwise seen from the handle), skin slide (mm, patient axes), beam change projected on patient axes.
export function physicalDelta(a,b){
 const p0=poseFromState(a),p1=poseFromState(b),cr=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
 const u1=sub(p1.u,p0.d.map(v=>v*dot(p1.u,p0.d))),rotation=Math.atan2(dot(cr(p0.u,u1),p0.d),dot(p0.u,u1))*180/Math.PI;
 const dd=sub(p1.d,p0.d),beam=Object.fromEntries(Object.entries(AXIS).map(([k,v])=>[k,dot(dd,v)]));
 return {rotation,slide:{x:(b.x-a.x)*1000,z:(b.z-a.z)*1000},beam,beamDeg:Math.acos(Math.max(-1,Math.min(1,dot(p0.d,p1.d))))*180/Math.PI,rockToMarker:dot(dd,p0.u)};
}
// Does the stated maneuver describe the change from→to? Sign always; magnitude within a factor of two.
export function maneuverAgrees(m,a,b){
 const d=physicalDelta(a,b),v=VERBS[m.verb],dir=v?.directions[m.direction];let got=0;
 if(m.verb==='rotar')got=d.rotation*(dir[1]);
 else if(m.verb==='deslizar')got=(dir[0]==='x'?d.slide.x:d.slide.z)*dir[1];
 else if(m.verb==='inclinar')got=d.beam[m.direction]>0?d.beamDeg:-d.beamDeg;
 else if(m.verb==='bascular')got=(m.direction==='hacia el marcador'?1:-1)*Math.sign(d.rockToMarker)*d.beamDeg;
 else return {ok:true,got:0};
 return {ok:got>0&&got>=m.amount/2&&got<=m.amount*2,got:+got.toFixed(1),delta:d};
}
export function describeStep(m){const v=VERBS[m.verb];if(!v)return '';const amt=m.verb==='barrer'?`±${m.amount}°`:`${m.amount} ${v.unit}`;
 return `${v.name} ${m.verb==='barrer'?'':m.direction} (~${amt}). ${v.physical}`}

// ---------------------------------------------------------------- probe states
// A state reference: {view:'a4c'} (the solved reference view), {preset:'apical'} (window starting point), optionally with
// {offset:{z:.018,tilt:-6,…}} (atlas metres for x/z, degrees otherwise) and {maneuvers:[…]} applied in order.
const solved=new Map();
export function resolveState(ref,ctx,prev=null){
 if(!ref)return prev?{...prev}:null;let s;
 if(ref.view){const t=ctx.views[ref.view];if(!t)throw Error(`Vista desconocida: ${ref.view}`);const key=ref.view+'@'+(ctx.cacheKey||'');
  if(!solved.has(key))solved.set(key,solveState(t,PRESET_OF[VIEW_INFO[ref.view]?.window]||'plax').state);s={...solved.get(key),depth:physical(t.depth),sector:90,preset:PRESET_OF[VIEW_INFO[ref.view]?.window]||'plax'}}
 else if(ref.plane){const key='plane:'+JSON.stringify(ref.plane)+'@'+(ctx.cacheKey||'');if(!solved.has(key)){const t=planeThrough(ref.plane,ctx);solved.set(key,{...solveState(t,ref.plane.window).state,depth:physical(t.depth),sector:90,preset:ref.plane.window})}s={...solved.get(key)}}
 else if(ref.preset)s={...defaultState(ref.preset)};else if(ref.state)s={...ref.state};else s={...prev};
 if(ref.offset)for(const [k,v] of Object.entries(ref.offset))s[k]=(s[k]||0)+v;
 for(const m of ref.maneuvers||[])s=applyManeuver(s,m);
 return s;
}
export function clearSolveCache(){solved.clear()}
// The context every lesson runs against: the reference views and the atlas landmarks of the loaded heart.
export function lessonContext(landmarks,views,cacheKey=''){return {landmarks,views,cacheKey}}
// A plane defined by the landmarks it must contain, seen from a window (the probe stays on that window's contact point,
// e.g. the «ductal» cut: from the parasternal short-axis contact, through the pulmonary valve and the ductus).
export function planeThrough(def,ctx){
 const from=ctx.views[def.contact],[a,b]=def.through.map(k=>ctx.landmarks[k]);if(!from||!a||!b)throw Error('Plano: contacto o reparos desconocidos');
 const o=from.origin,tgt=a.map((v,i)=>v+(b[i]-v)*(def.aim??.5)),u3=x=>{const l=Math.hypot(...x);return x.map(v=>v/l)},cr=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
 const d=u3(sub(tgt,o)),n=u3(cr(d,sub(b,a)));let u=u3(cr(d,n));if(dot(u,from.u)<0)u=u.map(v=>-v);
 return {origin:o,d,u,n:u3(cr(u,d)),depth:def.depth??from.depth,sector:80,meta:{center:tgt,landmarks:Object.fromEntries(def.through.map(k=>[k,ctx.landmarks[k]]))}};
}

// ---------------------------------------------------------------- goals (what counts as having the plane)
// view: plane agreement with a reference view (marker side included); anchors: atlas landmarks that must lie in the
// plane (≤ tol) and inside the sector; avoid: landmarks that must NOT be in the plane; structures: atlas structures that
// must be cut (runtime list). Route-agnostic: any probe path that satisfies the goal passes.
export function anchorStatus(pose,point,tol=.007){const q=sub(point,pose.origin),x=dot(q,pose.u),y=dot(q,pose.d),z=dot(q,pose.n);
 const inSector=y>0&&Math.hypot(x,y)<=pose.depth&&Math.abs(Math.atan2(x,y))<=rad(pose.sector/2);return {off:Math.abs(z),inSector,ok:inSector&&Math.abs(z)<=tol}}
export function evaluateGoal(goal,pose,ctx,structures=null){
 if(!goal)return {met:true,parts:[]};const parts=[];
 if(goal.view){const a=planeAgreement(pose,ctx.views[goal.view]);parts.push({kind:'view',id:goal.view,ok:a.score>=(goal.min??70)&&!a.flipped,score:a.score,flipped:a.flipped})}
 for(const k of goal.anchors||[]){const st=anchorStatus(pose,ctx.landmarks[k],goal.tol??.007);parts.push({kind:'anchor',id:k,ok:st.ok,offMM:+(st.off*1000).toFixed(1),inSector:st.inSector})}
 for(const k of goal.avoid||[]){const st=anchorStatus(pose,ctx.landmarks[k],goal.tol??.007);parts.push({kind:'avoid',id:k,ok:!st.ok})}
 if(structures)for(const n of goal.structures||[])parts.push({kind:'structure',id:n,ok:structures.includes(n)});
 return {met:parts.every(p=>p.ok),parts};
}

// ---------------------------------------------------------------- validation
export function validateLesson(spec,{sources=null}={}){
 const e=[],ids=new Set();
 if(spec?.schema!==SCHEMA)e.push(`schema debe ser ${SCHEMA}`);
 for(const f of ['id','title','question','level','layer'])if(!spec?.[f])e.push(`falta ${f}`);
 if(spec?.layer&&!LAYERS[spec.layer])e.push(`capa desconocida: ${spec.layer}`);
 if(!spec?.provenance?.anatomy)e.push('falta provenance.anatomy (atlas, simulación, volumen adquirido o anotación experta)');
 if(!Array.isArray(spec?.steps)||!spec.steps.length)e.push('sin pasos');
 for(const st of spec?.steps||[]){
  if(!st.id)e.push('paso sin id');else if(ids.has(st.id))e.push(`id repetido: ${st.id}`);ids.add(st.id);
  if(!STAGES.includes(st.stage))e.push(`${st.id}: etapa desconocida ${st.stage}`);
  if(Array.isArray(st.maneuver))e.push(`${st.id}: una maniobra dominante por paso`);
  if(st.maneuver){const v=VERBS[st.maneuver.verb];if(!v)e.push(`${st.id}: verbo desconocido ${st.maneuver.verb}`);else if(v.directions[st.maneuver.direction]==null)e.push(`${st.id}: dirección «${st.maneuver.direction}» no definida para ${st.maneuver.verb}`);if(!(st.maneuver.amount>0))e.push(`${st.id}: cantidad de la maniobra`)}
  for(const ref of [st.from,st.to]){if(ref?.view&&!VIEW_INFO[ref.view])e.push(`${st.id}: vista desconocida ${ref.view}`);if(ref?.plane&&(!VIEW_INFO[ref.plane.contact]||ref.plane.through?.length!==2))e.push(`${st.id}: plano por reparos mal definido`)}
  if(st.goal?.view&&!VIEW_INFO[st.goal.view])e.push(`${st.id}: vista objetivo desconocida`);
  for(const q of [st.predict,st.confirm])if(q){if(!q.options?.includes(q.answer))e.push(`${st.id}: la respuesta no está entre las opciones`);if(q.options?.length<3)e.push(`${st.id}: al menos dos distractores`)}
  if(!st.caption)e.push(`${st.id}: falta caption (demostración y subtítulos)`);
 }
 for(const c of spec?.sufficiency?.criteria||[]){if(c.step&&!ids.has(c.step))e.push(`criterio ${c.id}: paso inexistente ${c.step}`);if(!c.label)e.push(`criterio ${c.id}: falta label`)}
 if(!spec?.sufficiency?.criteria?.length)e.push('sin criterios de suficiencia');
 for(const c of spec?.cases||[]){if(!c.id||!c.variant?.id)e.push('caso sin id o sin variante');
  for(const [sid,o] of Object.entries(c.overrides||{})){const st=spec.steps?.find(x=>x.id===sid);if(!st){e.push(`caso ${c.id}: paso inexistente ${sid}`);continue}
   for(const [f,v] of Object.entries(o)){const q=st[f];if(v?.answer!=null&&!q?.options?.includes(v.answer))e.push(`caso ${c.id}: la respuesta de ${sid}.${f} no está entre las opciones`)}}}
 if(sources)for(const id of spec?.provenance?.sources||[])if(!sources[id])e.push(`fuente desconocida: ${id}`);
 return e;
}

// ---------------------------------------------------------------- deterministic helpers
export function rng(seed){let a=(seed>>>0)||1;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
export function shuffled(list,seed){const r=rng(seed),a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
export function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}

// Cases: the same lesson on different anatomy (e.g. intact septum or ASD). A case sets the variant and overrides the
// expected answers of some steps; picking it from the seed lets the exam vary without a branch per diagnosis.
export function withCase(spec,caseId){
 const c=(spec.cases||[]).find(x=>x.id===caseId);if(!c)return spec;
 const steps=spec.steps.map(st=>{const o=c.overrides?.[st.id];if(!o)return st;const n={...st};for(const [f,v] of Object.entries(o))n[f]=typeof v==='object'&&!Array.isArray(v)?{...st[f],...v}:v;return n});
 return {...spec,variant:c.variant,caseId:c.id,caseLabel:c.label,steps};
}
export function pickCase(spec,seed){const cs=spec.cases||[];return cs.length?cs[Math.floor(rng(hashString(spec.id)^seed)()*cs.length)].id:null}

// ---------------------------------------------------------------- compile → scenes → timeline
// Scene timing (staged reveal): caption → prediction question (before the probe moves) → maneuver → the answer, shown
// with the new image → identity check (question, then answer) → hold on the expected image. Durations follow reading
// time, so the same spec always gives the same timeline.
const readTime=t=>Math.max(2.4,Math.min(7,String(t||'').length/16));
export function compileLesson(spec,ctx,{seed=1}={}){
 let cur=null,t=0;const scenes=[];
 for(const st of spec.steps){
  const from=st.from?resolveState(st.from,ctx,cur):cur||resolveState({view:spec.start?.view||'plax'},ctx);
  let to=st.to?resolveState(st.to,ctx,from):st.maneuver?applyManeuver(from,st.maneuver):{...from};
  const moves=KEYS.some(k=>Math.abs((to[k]??0)-(from[k]??0))>1e-6)||st.maneuver?.verb==='barrer';
  const pre=st.predict||(moves?null:st.explain),post=st.confirm||(moves?st.explain:null);
  const intro=readTime(st.caption),ask=pre?readTime(pre.prompt)+1.5:0,move=moves?(st.maneuver?.verb==='barrer'?4:3):0,
   reveal=pre?readTime(pre.answer)+.8:0,check=post?readTime(post.prompt)+1.2+readTime(post.answer):0,hold=st.stage==='evidencia'?3:1.6;
  const tAsk0=t+intro,tMove0=tAsk0+ask,tMove1=tMove0+move,tCheck0=tMove1+reveal,tCheck1=tCheck0+check,t1=tCheck1+hold;
  const overlays=[];
  if(pre){overlays.push({kind:'predict',t0:tAsk0,t1:tMove0,prompt:pre.prompt,options:shuffled(pre.options,hashString(st.id)^seed)});overlays.push({kind:'answer',t0:tMove1,t1:tCheck0,text:pre.answer,why:pre.why||''})}
  if(post){const half=tCheck0+readTime(post.prompt)+1.2;overlays.push({kind:'confirm',t0:tCheck0,t1:half,prompt:post.prompt,options:shuffled(post.options,hashString(st.id+'c')^seed)});overlays.push({kind:'answer',t0:half,t1:tCheck1,text:post.answer,why:post.why||''})}
  scenes.push({id:`${spec.id}:${st.id}`,step:st.id,stage:st.stage,title:st.title||'',caption:st.caption,t0:t,tMove0,tMove1,t1,from,to,sweep:st.maneuver?.verb==='barrer'?st.maneuver.amount:0,overlays,
   reveal:st.reveal||{},maneuver:st.maneuver||null,goal:st.goal||null,variant:st.variant??spec.variant??null,color:st.color||null,doppler:st.doppler||null,evidence:st.evidence||null});
  t=t1;cur=to;
 }
 return {schema:SCHEMA,lesson:spec.id,version:spec.version||1,caseId:spec.caseId||null,seed,duration:+t.toFixed(3),hr:spec.timing?.hr||95,scenes};
}
const ease=k=>k<.5?2*k*k:1-(-2*k+2)**2/2,wrap=d=>((d+540)%360)-180;
export function seek(compiled,time){
 const t=Math.max(0,Math.min(compiled.duration,time));const sc=compiled.scenes;let i=sc.findIndex(s=>t<s.t1);if(i<0)i=sc.length-1;const s=sc[i];
 const k=s.tMove1>s.tMove0?ease(Math.max(0,Math.min(1,(t-s.tMove0)/(s.tMove1-s.tMove0)))):(t>=s.tMove0?1:0);const state={...s.to};
 for(const key of KEYS){const a=s.from[key],b=s.to[key];if(a==null||b==null)continue;state[key]=key==='rotation'?a+wrap(b-a)*k:a+(b-a)*k}
 if(s.sweep&&t>=s.tMove0&&t<=s.tMove1)state.tilt=s.from.tilt+s.sweep*Math.sin(2*Math.PI*(t-s.tMove0)/(s.tMove1-s.tMove0));
 // cardiac phase from time and heart rate only (no clock): the beat is reproducible frame by frame
 const phase=((t*compiled.hr/60)%1+1)%1;
 const overlay=s.overlays.find(o=>t>=o.t0&&t<o.t1)||null;
 // staged reveal: the structure labels appear only once the probe has reached the plane
 const labels=!(s.reveal.structuresAfter==='move'&&t<s.tMove1)&&!(overlay?.kind==='predict');
 return {t,scene:i,step:s.step,stage:s.stage,caption:s.caption,title:s.title,state,phase,variant:s.variant,color:s.color,doppler:s.doppler,moving:t>=s.tMove0&&t<s.tMove1,overlay,labels,maneuver:s.maneuver};
}

// ---------------------------------------------------------------- evidence and assessment
// record: {goals:{step:true}, answers:{step:{predict:bool,confirm:bool,explain:bool}}, evidence:[{kind:'clip'|'frame',step}],
//          hints:{step:n}, showMe:{step:bool}, measures:{dopplerAngle, colorOn, …}, errors:[{step,competency}], ms}
export function evaluateSufficiency(spec,record){
 const met=[],missing=[];
 for(const c of spec.sufficiency.criteria){let ok=false;
  if(c.kind==='goal')ok=!!record.goals?.[c.step];
  else if(c.kind==='answer')ok=!!record.answers?.[c.step]?.[c.field||'confirm'];
  else if(c.kind==='evidence')ok=(record.evidence||[]).some(e=>(!c.step||e.step===c.step)&&(!c.evidence||e.kind===c.evidence));
  else if(c.kind==='measure'){const v=record.measures?.[c.measure];ok=v!=null&&(c.max==null||v<=c.max)&&(c.min==null||v>=c.min)&&(c.equals==null||v===c.equals)}
  (ok?met:missing).push({id:c.id,label:c.label,why:c.why||''})}
 return {sufficient:!missing.length,met,missing,message:missing.length?(spec.sufficiency.insufficient||'Falta evidencia para responder la pregunta.'):null};
}
export const DOMAINS={adquisicion:'Calidad de adquisición',reconocimiento:'Reconocimiento',razonamiento:'Razonamiento',ayudas:'Uso de ayudas'};
export function scoreAttempt(spec,record){
 const steps=spec.steps,goalSteps=steps.filter(s=>s.goal),conf=steps.filter(s=>s.confirm),pred=steps.filter(s=>s.predict||s.explain);
 const unaided=goalSteps.filter(s=>record.goals?.[s.id]&&!record.showMe?.[s.id]).length;
 const frac=(a,b)=>b?Math.round(100*a/b):null;
 const hints=Object.values(record.hints||{}).reduce((a,b)=>a+b,0),showMe=Object.values(record.showMe||{}).filter(Boolean).length;
 return {
  adquisicion:{score:frac(unaided,goalSteps.length),detail:`${unaided}/${goalSteps.length} planos conseguidos sin «Muéstrame»`},
  reconocimiento:{score:frac(conf.filter(s=>record.answers?.[s.id]?.confirm).length,conf.length),detail:`${conf.filter(s=>record.answers?.[s.id]?.confirm).length}/${conf.length} identificaciones correctas al primer intento`},
  razonamiento:{score:frac(pred.filter(s=>record.answers?.[s.id]?.predict||record.answers?.[s.id]?.explain).length,pred.length),detail:`${pred.filter(s=>record.answers?.[s.id]?.predict||record.answers?.[s.id]?.explain).length}/${pred.length} predicciones o explicaciones correctas`},
  ayudas:{score:null,detail:`${hints} pista(s) · ${showMe} «Muéstrame»`,hints,showMe},
  timeS:record.ms?Math.round(record.ms/1000):null,
  note:'Medidas docentes de este ejercicio; no acreditan competencia clínica.'
 };
}
// competency map: errors → a corrective exercise, then a different one that checks transfer
export function recommend(record,competencies,{exclude=[]}={}){
 const counts={};for(const e of record.errors||[])counts[e.competency]=(counts[e.competency]||0)+1;
 return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([id,n])=>{const c=competencies[id];if(!c)return null;
  const corr=(c.corrective||[]).find(x=>!exclude.includes(x))||c.corrective?.[0]||null,transfer=(c.transfer||[]).find(x=>x!==corr&&!exclude.includes(x))||null;
  return {competency:id,name:c.name,errors:n,corrective:corr,transfer}}).filter(Boolean);
}

// ---------------------------------------------------------------- a lesson for any standard view («no consigo esta vista»)
// Generated from the view data (window, marker clock, landmarks, checks): the same engine, no hand-written branch.
export function lessonForView(id,{coverage=null}={}){
 const info=VIEW_INFO[id],card=VIEW_CARD[id];if(!info)throw Error(`Vista desconocida: ${id}`);
 const others=Object.entries(VIEW_INFO).filter(([k,v])=>k!==id&&v.window!==info.window);
 const distract=others.map(([,v])=>v.checks?.[0]).filter(Boolean).slice(0,6);
 const pick=(arr,n,seed)=>shuffled(arr,seed).slice(0,n);
 const alt=(coverage?.windows||[]).filter(w=>w.forViews?.includes(id));
 return {schema:SCHEMA,id:`vista-${id}`,version:1,title:`Conseguir: ${info.name}`,layer:'adquisicion',level:'basico',
  question:`¿Cómo obtengo ${info.name.toLowerCase()} y cómo compruebo que es esa vista?`,generated:true,
  provenance:{anatomy:'atlas',image:'simulación',sources:['ase2024'],teaching:'Lección generada a partir de los datos de la vista (ventana, hora del marcador, reparos y comprobaciones)'},
  entry:{problems:[id]},start:{preset:PRESET_OF[info.window]},
  steps:[
   {id:'ventana',stage:'orientar',title:'Ventana y marcador',caption:card?.probe||`Ventana ${info.window}; marcador a las ${info.clock} h.`,from:{preset:PRESET_OF[info.window]},competencies:['orientacion']},
   {id:'plano',stage:'mover',title:'Llegar al plano',caption:`Busca ${info.name.toLowerCase()}: ${info.goal}`,to:{view:id},goal:{view:id,min:70},
    predict:{prompt:`Antes de mover: ¿qué debería aparecer cuando llegues a ${info.short}?`,options:shuffled([info.checks?.[0]||info.goal,...pick(distract,2,hashString(id))],hashString(id+'p')),answer:info.checks?.[0]||info.goal,why:info.goal},
    hints:['Vuelve a la ventana y comprueba la hora del marcador.','Haz una sola maniobra cada vez y mira qué entra o sale del plano.','Usa la pista de maniobra en vivo: dice qué control corregir primero.'],competencies:['adquisicion','orientacion']},
   {id:'confirmar',stage:'confirmar',title:'Comprobar la identidad',caption:`Confirma ${info.short} por sus relaciones, no solo por la forma.`,
    confirm:{prompt:`¿Qué comprueba que estás en ${info.short}?`,options:shuffled([info.checks?.[1]||info.checks?.[0]||info.goal,...pick(distract,2,hashString(id)+7)],hashString(id+'c')),answer:info.checks?.[1]||info.checks?.[0]||info.goal,why:info.pitfall||''},competencies:['reconocimiento']},
   ...(alt.length?[{id:'rescate',stage:'rescatar',title:'Si la ventana no da imagen',caption:`Ruta alternativa: ${alt.map(w=>`${w.name} (${w.status})`).join('; ')}.`,competencies:['adquisicion']}]:[]),
   {id:'guardar',stage:'evidencia',title:'Guardar la evidencia',caption:'Guarda un cuadro de la vista con su orientación.',evidence:{kind:'frame'},competencies:['integracion']}
  ],
  sufficiency:{criteria:[{id:'plano',kind:'goal',step:'plano',label:`${info.short} conseguida (marcador del lado correcto)`},{id:'identidad',kind:'answer',step:'confirmar',label:'Identidad comprobada por relaciones'},{id:'cuadro',kind:'evidence',step:'guardar',evidence:'frame',label:'Cuadro guardado'}],insufficient:'Sin el plano y su comprobación, la vista no está documentada.'}};
}

// ---------------------------------------------------------------- export artefacts (text)
const vttTime=s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=(s%60).toFixed(3).padStart(6,'0');return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${x}`};
export function toWebVTT(compiled){return 'WEBVTT\n\n'+compiled.scenes.map((s,i)=>`${i+1}\n${vttTime(s.t0)} --> ${vttTime(s.t1)}\n${s.caption}\n`).join('\n')}
export function checklist(spec){return {lesson:spec.id,title:spec.title,question:spec.question,items:[...spec.steps.filter(s=>s.stage!=='orientar').map(s=>({step:s.id,stage:s.stage,check:s.title||s.caption})),...spec.sufficiency.criteria.map(c=>({criterion:c.id,check:c.label}))]}}
export function sourcesFor(spec,catalog){return {lesson:spec.id,provenance:spec.provenance,limits:spec.limits||[],sources:(spec.provenance?.sources||[]).map(id=>({id,...catalog[id]}))}}
// scene keyframes for the scene sheet: the moment each scene shows its expected image
export function keyframes(compiled){return compiled.scenes.map(s=>({scene:s.id,step:s.step,stage:s.stage,title:s.title,t:+(s.t1-.4*(s.t1-Math.max(s.tMove1,...s.overlays.map(o=>o.t1)))).toFixed(3)}))}
