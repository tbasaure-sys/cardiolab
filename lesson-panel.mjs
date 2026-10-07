// «Tutor» panel: runs the lesson specifications (lessons/*.json) on the live simulator with lesson-engine.mjs.
// Entries: tours, «quiero ver esta estructura», «quiero responder esta pregunta», «no consigo esta vista».
// Modes: demonstration (deterministic timeline, seek), practice with tiered hints, exam without aids (seeded start,
// case and failed window). Results separate acquisition, recognition, reasoning and aid use; the usage log stays in
// this browser (no personal data) and can be exported as JSON.
import {SCHEMA,STAGES,LAYERS,DOMAINS,VERBS,compileLesson,seek,resolveState,evaluateGoal,evaluateSufficiency,scoreAttempt,recommend,
 lessonForView,withCase,pickCase,shuffled,rng,hashString,lessonContext,validateLesson} from './lesson-engine.mjs';
import {VIEW_INFO,suggestManeuver} from './views.mjs';
import {poseFromState} from './geometry.mjs';

const LOG_KEY='cardiolab.tutor.log.v1',PREF_KEY='cardiolab.tutor.prefs.v1';
const STAGE_NAMES={orientar:'Orientar',mover:'Mover',confirmar:'Confirmar',optimizar:'Optimizar',rescatar:'Rescatar',evidencia:'Evidencia'};
const MODE_NAMES={demostracion:'Demostración',practica:'Práctica con pistas',examen:'Examen sin ayudas'};
const ANCHOR_NAMES={aorticValve:'válvula aórtica',pulmonaryValve:'válvula pulmonar',mitralValve:'válvula mitral',tricuspidValve:'válvula tricúspide',lvApex:'ápex del VI',lvApexCavity:'ápex real del VI',rvApex:'ápex del VD',
 archTop:'arco aórtico',vsdPerimembranous:'septo bajo la aorta',vsdMuscular:'septo trabecular',asdSecundum:'fosa oval',asdPrimum:'septo auricular bajo',ivcJunction:'desembocadura de la VCI',ivcLow:'vena cava inferior',
 ductAortic:'istmo aórtico (extremo aórtico del ductus)',ductPulmonary:'bifurcación pulmonar (extremo pulmonar del ductus)'};
const PRESET_OF={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'};
const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtT=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const load=async f=>(await fetch(new URL(`lessons/${f}`,import.meta.url))).json();

export function mountLessons(api){
 const host=api.host,ctx=lessonContext(api.landmarks(),api.views,'ref');
 let catalog=null,run=null,timer=null,raf=0;
 let prefs={mode:'practica'};try{prefs={...prefs,...JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}}catch{}
 const savePrefs=()=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}catch{}};
 const readLog=()=>{try{return JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch{return []}};
 const writeLog=l=>{try{localStorage.setItem(LOG_KEY,JSON.stringify(l.slice(-300)))}catch{}};
 const $=id=>host.querySelector('#'+id);
 host.innerHTML='<span class="eyebrow">TUTOR</span><h1>Aprender por preguntas</h1><p class="micro">Cargando lecciones…</p>';
 const ready=(async()=>{
  const [index,sources,coverage]=await Promise.all([load('index.json'),load('sources.json'),load('coverage.json')]);
  const lessons=Object.fromEntries(await Promise.all(index.lessons.map(async id=>[id,await load(`${id}.json`)])));
  for(const [id,l] of Object.entries(lessons)){const e=validateLesson(l,{sources:sources.sources});if(e.length)console.warn('Lección',id,e)}
  catalog={index,sources:sources.sources,coverage,lessons};home();
 })().catch(e=>{host.innerHTML=`<span class="eyebrow">TUTOR</span><p class="pitfall">No se pudieron cargar las lecciones: ${esc(e.message)}</p>`});
 const getLesson=id=>id.startsWith('vista-')?lessonForView(id.slice(6),{coverage:catalog.coverage}):catalog.lessons[id];

 // ---------------------------------------------------------------- home: entry points
 function home(){
  stop();const {index,lessons,coverage}=catalog;const all=Object.values(lessons);
  const structures=[...new Set(all.flatMap(l=>l.entry?.structures||[]))].sort((a,b)=>a.localeCompare(b,'es'));
  const questions=all.flatMap(l=>(l.entry?.questions||[]).map(q=>[q,l.id]));
  const item=l=>`<button class="lesson-item" data-open="${l.id}"><b>${esc(l.title)}</b><span>${esc(LAYERS[l.layer])} · ${esc(l.level)}</span></button>`;
  const log=readLog();
  host.innerHTML=`<span class="eyebrow">TUTOR</span><h1>Aprender por preguntas</h1>
  <p class="lead">Cada lección parte de una pregunta: qué anatomía importa, desde qué reparo empiezas, qué maniobra haces, qué imagen esperas, cómo confirmas, optimizas y guardas la evidencia.</p>
  <div class="seg" role="radiogroup" aria-label="Modo">${Object.entries(MODE_NAMES).map(([k,v])=>`<button data-mode="${k}" class="${prefs.mode===k?'active':''}" role="radio" aria-checked="${prefs.mode===k}">${v.split(' ')[0]}</button>`).join('')}</div>
  <p class="micro" id="ls-mode-note">${modeNote(prefs.mode)}</p>
  <h2>Recorridos</h2>${index.tours.map(t=>`<details class="tour"><summary>${esc(t.title)} <span class="micro">${t.lessons.length} lecciones</span></summary>${t.lessons.map(id=>item(lessons[id])).join('')}</details>`).join('')}
  <label class="field"><span>Quiero ver esta estructura</span><select id="ls-structure"><option value="">Elige una estructura…</option>${structures.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label><div id="ls-structure-out"></div>
  <label class="field"><span>Quiero responder esta pregunta</span><select id="ls-question"><option value="">Elige una pregunta…</option>${questions.map(([q,id],i)=>`<option value="${i}">${esc(q)}</option>`).join('')}</select></label>
  <label class="field"><span>No consigo esta vista</span><select id="ls-view"><option value="">Elige la vista…</option>${Object.entries(VIEW_INFO).map(([k,v])=>`<option value="${k}">${esc(v.name)}</option>`).join('')}</select></label><div id="ls-view-out"></div>
  <details><summary>Por capas</summary>${Object.entries(LAYERS).map(([k,n])=>{const ls=all.filter(l=>l.layer===k);return `<h3>${esc(n)}</h3>${ls.length?ls.map(item).join(''):`<p class="micro">${k==='fundamentos'?'Por ahora se apoya en el «Curso guiado» (marcador, ejes, presentación, Doppler básico).':'Sin lecciones todavía.'}</p>`}`}).join('')}</details>
  <details><summary>Cobertura y límites del atlas</summary><p class="micro">${esc(coverage.note)}</p>${['anatomy','windows','measurements'].map(k=>`<ul class="coverage">${coverage[k].map(c=>`<li><span class="st st-${esc(c.status)}">${esc(c.status)}</span> <b>${esc(c.name||c.id)}</b> — ${esc(c.detail)}</li>`).join('')}</ul>`).join('')}</details>
  <details><summary>Registro de uso (${log.length})</summary><p class="micro">Se guarda solo en este navegador: lección, modo, semilla, tiempos, pistas y errores por competencia. Sin datos personales. Sirve para priorizar los próximos módulos, no acredita competencia clínica.</p><button id="ls-log-export">Descargar registro JSON</button> <button id="ls-log-clear">Borrar registro</button></details>`;
  host.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{prefs.mode=b.dataset.mode;savePrefs();home()});
  bindOpen(host);
  $('ls-structure').onchange=()=>{const s=$('ls-structure').value;$('ls-structure-out').innerHTML=s?all.filter(l=>l.entry?.structures?.includes(s)).map(item).join(''):'';bindOpen($('ls-structure-out'))};
  $('ls-question').onchange=()=>{const q=questions[Number($('ls-question').value)];if(q)open(q[1])};
  $('ls-view').onchange=()=>{const v=$('ls-view').value;if(!v){$('ls-view-out').innerHTML='';return}const rel=all.filter(l=>l.entry?.problems?.includes(v));
   $('ls-view-out').innerHTML=`<button class="lesson-item primary-item" data-open="vista-${v}"><b>Conseguir ${esc(VIEW_INFO[v].short)} paso a paso</b><span>Lección generada desde los datos de la vista</span></button>${rel.map(item).join('')}`;bindOpen($('ls-view-out'))};
  $('ls-log-export').onclick=()=>api.download(new Blob([JSON.stringify({schema:'cardiolab.tutor-log/1',exported:new Date().toISOString(),attempts:readLog()},null,1)],{type:'application/json'}),'CardioLab_tutor_registro.json');
  $('ls-log-clear').onclick=()=>{writeLog([]);home()};
 }
 const modeNote=m=>({demostracion:'Mira la lección completa: la sonda se mueve sola, primero se pregunta y luego se muestra. Puedes pausar y saltar a cualquier momento; también exportarla.',practica:'Tú mueves la sonda. Predice antes de mover; tienes pistas escalonadas y «Muéstrame» (se registran como ayuda).',examen:'Sin pistas ni guías: el punto de partida, el caso y alguna ventana fallida cambian con la semilla.'}[m]);
 function bindOpen(root){root.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>open(b.dataset.open))}

 // ---------------------------------------------------------------- open a lesson in the chosen mode
 function open(id,{seed=null,mode=prefs.mode}={}){
  stop();let spec=getLesson(id);if(!spec)return;seed=seed??(Math.floor(Math.random()*1e6)+1);
  const caseId=spec.cases?.length?(mode==='examen'?pickCase(spec,seed):spec.cases.find(c=>c.variant?.id!=='normal')?.id||spec.cases[0].id):null;
  if(caseId)spec=withCase(spec,caseId);
  run={spec,id,mode,seed,caseId,step:0,record:{goals:{},answers:{},evidence:[],hints:{},showMe:{},measures:{},errors:[],rescued:{},stepMs:{},ms:0},t0:performance.now(),stepT0:performance.now(),hintIx:0,stable:0,blocked:null,files:[]};
  if(mode==='demostracion')return demo();
  enterStep();
 }
 function header(){const {spec,mode}=run;return `<button class="link" id="ls-home">← Lecciones</button><span class="eyebrow">${esc(LAYERS[spec.layer])} · ${esc(MODE_NAMES[mode])}</span><h1>${esc(spec.title)}</h1>
  <p class="question">${esc(spec.question)}</p>${run.caseId&&mode!=='examen'?`<p class="micro">Caso: ${esc(spec.caseLabel)}</p>`:''}
  <p class="micro prov">Anatomía: ${esc(spec.provenance.anatomy)} · imagen: ${esc(spec.provenance.image)}${spec.generated?' · lección generada':''}</p>`}
 function bindHeader(){$('ls-home').onclick=()=>{leaveRun();home()}}

 // ---------------------------------------------------------------- demonstration: seek-driven, deterministic
 function demo(){
  const compiled=compileLesson(run.spec,ctx,{seed:run.seed});run.compiled=compiled;run.t=0;run.playing=true;run.last=null;
  host.innerHTML=`${header()}<div class="demo"><div class="demo-bar"><button id="ls-play" class="primary">Pausa</button><input id="ls-seek" type="range" min="0" max="${compiled.duration}" step="0.1" value="0" aria-label="Tiempo de la lección"><output id="ls-time">0:00 / ${fmtT(compiled.duration)}</output></div>
   <ol class="scenes">${compiled.scenes.map((s,i)=>`<li data-scene="${i}"><span class="chip st-${s.stage}">${STAGE_NAMES[s.stage]}</span> ${esc(s.title)}</li>`).join('')}</ol>
   <div id="ls-caption" class="caption" aria-live="polite"></div><div id="ls-overlay" class="overlay"></div>
   <details><summary>Exportar microlección</summary><p class="micro">Vídeo con subtítulos incrustados, subtítulos WebVTT, lámina de escenas, lista de comprobación, fuentes y línea de tiempo (JSON), todo generado desde la especificación y la semilla ${run.seed}.</p>
   <div class="seg"><button data-fmt="16:9" class="active">16:9</button><button data-fmt="9:16">9:16</button></div><button id="ls-export" class="primary">Exportar</button><p class="micro" id="ls-export-status"></p></details>
   ${limitsHtml()}</div>`;
  bindHeader();let fmt='16:9';host.querySelectorAll('[data-fmt]').forEach(b=>b.onclick=()=>{fmt=b.dataset.fmt;host.querySelectorAll('[data-fmt]').forEach(x=>x.classList.toggle('active',x===b))});
  $('ls-play').onclick=()=>{run.playing=!run.playing;if(run.playing&&run.t>=compiled.duration)run.t=0;$('ls-play').textContent=run.playing?'Pausa':'Reproducir'};
  $('ls-seek').oninput=()=>{run.t=Number($('ls-seek').value);run.playing=false;$('ls-play').textContent='Reproducir'};
  host.querySelectorAll('[data-scene]').forEach(li=>li.onclick=()=>{run.t=compiled.scenes[Number(li.dataset.scene)].t0;});
  $('ls-export').onclick=async()=>{run.playing=false;$('ls-play').textContent='Reproducir';const b=$('ls-export');b.disabled=true;run.exporting=true;
   try{const {exportMicroLesson}=await import('./lesson-export.mjs');await exportMicroLesson({api,spec:run.spec,ctx,seed:run.seed,format:fmt,sources:catalog.sources,status:t=>{$('ls-export-status').textContent=t}})}
   catch(e){console.error(e);$('ls-export-status').textContent='No se pudo exportar: '+e.message}finally{b.disabled=false;if(run)run.exporting=false}};
  let last=performance.now(),lastApply=0,busyVariant=false;
  const frame=async now=>{if(!run||run.mode!=='demostracion')return;raf=requestAnimationFrame(frame);if(run.exporting){last=now;return}const dt=Math.min(.1,(now-last)/1000);last=now;
   if(run.playing&&!busyVariant){run.t=Math.min(compiled.duration,run.t+dt);if(run.t>=compiled.duration){run.playing=false;$('ls-play').textContent='Repetir'}}
   const s=seek(compiled,run.t);$('ls-seek').value=String(run.t.toFixed(1));$('ls-time').textContent=`${fmtT(run.t)} / ${fmtT(compiled.duration)}`;
   const prev=run.last;run.last=s;
   if(!prev||prev.scene!==s.scene){host.querySelectorAll('[data-scene]').forEach(li=>li.classList.toggle('active',Number(li.dataset.scene)===s.scene));$('ls-caption').innerHTML=`<b>${esc(s.title)}</b> ${esc(s.caption)}`;
    const vk=JSON.stringify(s.variant||{id:'normal'});if(vk!==run.variantKey){run.variantKey=vk;busyVariant=true;api.setVariant(s.variant||{id:'normal'}).finally(()=>busyVariant=false)}
    api.color(s.color);api.doppler(s.doppler)}
   if(prev?.overlay!==s.overlay)$('ls-overlay').innerHTML=overlayHtml(s.overlay);
   api.lockPhase(s.phase);api.setCaption(s.overlay?.kind==='predict'||s.overlay?.kind==='confirm'?s.overlay.prompt:s.overlay?.kind==='answer'?'→ '+s.overlay.text:s.caption);
   if(now-lastApply>90&&(!prev||JSON.stringify(prev.state)!==JSON.stringify(s.state))){lastApply=now;api.apply(s.state)}
   if(s.doppler&&prev&&prev.moving&&!s.moving)api.doppler(s.doppler);if(s.color&&prev&&prev.moving&&!s.moving)api.color(s.color);
  };raf=requestAnimationFrame(frame);
 }
 const overlayHtml=o=>!o?'':o.kind==='answer'?`<div class="answer"><b>${esc(o.text)}</b>${o.why?`<p>${esc(o.why)}</p>`:''}</div>`:`<div class="ask"><span class="chip">${o.kind==='predict'?'Predice antes de mover':'Confirma'}</span><p>${esc(o.prompt)}</p><ol type="a">${o.options.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div>`;
 const limitsHtml=()=>{const l=run.spec.limits||[];return l.length?`<details class="limits"><summary>Límites de esta lección</summary><ul>${l.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''};

 // ---------------------------------------------------------------- practice and exam: one step at a time
 const cur=()=>run.spec.steps[run.step];
 function goalTargetView(st){return st.goal?.view||st.to?.view||null}
 function startStateFor(st){ // exam: start from another available window (transfer); practice: from the step's own window
  const view=goalTargetView(st),own=view?PRESET_OF[VIEW_INFO[view].window]:null;
  const avail=(run.spec.windows?.available||[]).map(w=>PRESET_OF[w]).filter(Boolean);
  if(run.mode==='examen'&&avail.length>1){const others=avail.filter(w=>w!==own);return {preset:shuffled(others,run.seed^hashString(st.id))[0]}}
  return own?{preset:own}:null}
 async function enterStep(){
  const st=cur();run.stepT0=performance.now();run.hintIx=0;run.stable=0;run.answered={};run.aidText='';run.blocked=null;api.setTarget(null);api.setCaption(null);api.lockPhase(null);
  await api.setVariant(st.variant||run.spec.variant||{id:'normal'});
  if(st.from&&!st.goal)api.apply(resolveState(st.from,ctx),{animate:true}); // the scenario of this step (e.g. the shortened apical)
  else if(st.goal&&st.from&&run.step===0||st.goal&&st.from&&st.stage==='orientar'){const s0=startStateFor(st);if(s0)api.apply(resolveState(s0,ctx),{animate:false})}
  if(run.mode==='examen'&&st.rescue?.length&&goalTargetView(st)&&rng(run.seed^hashString(st.id+'w'))()<.5){run.blocked=PRESET_OF[VIEW_INFO[goalTargetView(st)].window];api.blockWindows([run.blocked])}else api.blockWindows(null);
  api.imageOnly(run.mode==='examen');
  if(!st.color&&!st.doppler&&run.step>0){const p=run.spec.steps[run.step-1];if(p.doppler)api.doppler(null)}
  renderStep();clearInterval(timer);timer=setInterval(tick,300);
 }
 function goalNames(goal){const p=[];if(goal.view)p.push(VIEW_INFO[goal.view].name);for(const a of goal.anchors||[])p.push(`${ANCHOR_NAMES[a]||a} en el plano`);return p.join(' · ')}
 function question(kind,q,st){if(!q)return '';const opts=shuffled(q.options,run.seed^hashString(st.id+kind));const label={predict:'Predice antes de mover',confirm:'Confirma',explain:'Explica'}[kind];
  return `<div class="q" data-q="${kind}"><span class="chip">${label}</span><p>${esc(q.prompt)}</p><div class="opts">${opts.map(o=>`<button data-a="${esc(o)}">${esc(o)}</button>`).join('')}</div><p class="fb" aria-live="polite"></p></div>`}
 function renderStep(){
  const st=cur(),exam=run.mode==='examen',n=run.spec.steps.length,v=VERBS[st.maneuver?.verb];
  const needsMove=!!st.goal;const preFirst=!!st.predict;
  host.innerHTML=`${header()}<ol class="dots">${run.spec.steps.map((s,i)=>`<li class="${i<run.step?'done':i===run.step?'now':''}" title="${esc(s.title)}">${STAGE_NAMES[s.stage][0]}</li>`).join('')}</ol>
  <div class="step"><span class="chip st-${st.stage}">${STAGE_NAMES[st.stage]} · ${run.step+1}/${n}</span><h2>${esc(st.title)}</h2>
  ${exam?(st.goal?`<p>Objetivo: ${esc(goalNames(st.goal))}.</p>`:`<p>${esc(st.caption)}</p>`):`<p>${esc(st.caption)}</p>`}
  ${!exam&&st.maneuver?`<p class="maneuver"><b>Maniobra dominante: ${esc(v.name)} ${st.maneuver.verb==='barrer'?'':esc(st.maneuver.direction)} ~${st.maneuver.amount} ${v.unit}</b>${st.maneuver.keeps?` · conserva: ${esc(st.maneuver.keeps)}`:''}<br><span class="micro">${esc(v.physical)}</span></p>`:''}
  ${question('predict',st.predict,st)}
  ${needsMove?`<div id="ls-goal" class="goal"${preFirst?' hidden':''}></div>`:''}
  ${st.color?`<div class="task" id="ls-color"><p>Doppler color${st.color.at?` sobre ${esc(ANCHOR_NAMES[st.color.at]||st.color.at)}`:''}${st.color.nyquist?` · escala baja (≈${String(st.color.nyquist).replace('.',',')} m/s)`:''}.</p>${exam?'':'<button id="ls-color-aid">Colocarlo por mí</button>'}<span class="ok-mark"></span></div>`:''}
  ${st.doppler?`<div class="task" id="ls-dop"><p>Doppler ${st.doppler.mode.toUpperCase()}${st.doppler.at?` en ${esc(ANCHOR_NAMES[st.doppler.at]||st.doppler.at)}`:''}: ${st.doppler.mode==='pw'?'pulsa la imagen para colocar el volumen de muestra':'pulsa la imagen para orientar la línea'}.</p>${exam?'':'<button id="ls-dop-aid">Colocarlo por mí</button>'}<output id="ls-angle"></output></div>`:''}
  <div id="ls-after"${needsMove||preFirst?' hidden':''}>${question('confirm',st.confirm,st)}${question('explain',st.explain,st)}</div>
  ${st.evidence?`<div class="task" id="ls-evidence"><button class="primary" id="ls-save">${st.evidence.kind==='clip'?`● Grabar clip ${st.evidence.seconds||3} s`:'Guardar cuadro'}</button><span class="micro" id="ls-saved"></span></div>`:''}
  ${!exam?`<div class="aids">${st.goal?'<button id="ls-hint">Pista</button><button id="ls-show">Muéstrame</button>':''}<p id="ls-hint-text" class="micro"></p></div>`:''}
  ${st.rescue?.length?`<details class="rescue"><summary>No consigo esta ventana</summary>${st.rescue.map((r,i)=>`<p><b>${esc(r.when)}.</b> ${esc(r.say)}</p>${r.to?`<button data-rescue="${i}">Ir a la alternativa</button>`:''}`).join('')}</details>`:''}
  <div class="nav"><button id="ls-skip">Saltar paso</button><button id="ls-next" class="primary" disabled>${run.step===n-1?'Terminar':'Siguiente'}</button></div></div>${limitsHtml()}`;
  bindHeader();
  host.querySelectorAll('.q').forEach(qe=>qe.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>answer(qe.dataset.q,b.dataset.a,qe)));
  $('ls-hint')&&($('ls-hint').onclick=hint);$('ls-show')&&($('ls-show').onclick=showMe);
  $('ls-color-aid')&&($('ls-color-aid').onclick=()=>{api.color(st.color);aid('color')});
  $('ls-dop-aid')&&($('ls-dop-aid').onclick=()=>{api.doppler(st.doppler);aid('doppler')});
  $('ls-save')&&($('ls-save').onclick=saveEvidence);
  host.querySelectorAll('[data-rescue]').forEach(b=>b.onclick=()=>{const r=st.rescue[Number(b.dataset.rescue)];run.record.rescued[st.id]=true;api.blockWindows(null);api.apply(resolveState(r.to,ctx),{animate:true});$('ls-hint-text')&&($('ls-hint-text').textContent='Ruta alternativa: la pregunta sigue siendo la misma; al final verás si la evidencia basta.');refreshNext()});
  $('ls-skip').onclick=()=>{for(const c of (st.goal&&!run.record.goals[st.id]?['adquisicion']:[]))run.record.errors.push({step:st.id,competency:c,kind:'saltado'});next()};
  $('ls-next').onclick=next;tick();refreshNext();
 }
 function aid(kind){const st=cur();run.record.hints[st.id]=(run.record.hints[st.id]||0)+1;run.record.errors.push({step:st.id,competency:'optimizacion',kind:'ayuda-'+kind})}
 function answer(kind,a,qe){const st=cur(),q=st[kind],ok=a===q.answer;
  if(!run.answered[kind]){run.answered[kind]=true;(run.record.answers[st.id]??={})[kind]=ok;if(!ok)run.record.errors.push({step:st.id,competency:kind==='predict'||kind==='explain'?(st.competencies?.find(c=>c!=='adquisicion')||'integracion'):(st.competencies?.includes('reconocimiento')?'reconocimiento':st.competencies?.[0]||'reconocimiento'),kind})}
  qe.querySelectorAll('[data-a]').forEach(b=>{b.classList.toggle('right',b.dataset.a===q.answer&&(ok||run.mode!=='examen'));b.classList.toggle('wrong',b.dataset.a===a&&!ok)});
  qe.querySelector('.fb').textContent=run.mode==='examen'?'Respuesta registrada.':`${ok?'Correcto.':'No.'} ${q.why||''}`;
  if(kind==='predict'){$('ls-goal')&&($('ls-goal').hidden=false);if(!st.goal)$('ls-after').hidden=false}
  refreshNext()}
 function hint(){const st=cur(),h=st.hints||[];run.record.hints[st.id]=(run.record.hints[st.id]||0)+1;let text;
  if(run.hintIx<h.length)text=h[run.hintIx];else{const tv=goalTargetView(st),t=tv?api.views[tv]:null;const sg=t?suggestManeuver(api.state(),t):null;text=sg?.text?`Ajuste que más mejora ahora: ${sg.text}.`:'Vuelve al reparo de partida y haz una sola maniobra cada vez.'}
  run.hintIx++;$('ls-hint-text').textContent=text}
 function showMe(){const st=cur();run.record.showMe[st.id]=true;const ref=st.to||(st.goal?.view?{view:st.goal.view}:st.from);if(!ref)return;const s=resolveState(ref,ctx,api.state());api.blockWindows(null);api.apply(s,{animate:true});api.setTarget(poseFromState(s));$('ls-hint-text').textContent='La sonda va al plano esperado (cuenta como ayuda). Observa qué maniobra hizo.'}
 async function saveEvidence(){const st=cur(),b=$('ls-save');b.disabled=true;try{
   const blob=st.evidence.kind==='clip'?(b.textContent='Grabando…',await api.recordClip(st.evidence.seconds||3)):await api.captureFrame();
   const pose=api.pose(),tv=goalTargetView(st);const near=tv?evaluateGoal({view:tv},pose,ctx).parts[0]:null;
   run.record.evidence.push({kind:st.evidence.kind,step:st.id,view:near?.id||null,agreement:near?.score??null,measures:api.measures()});
   const ext=st.evidence.kind==='clip'?(blob.type.includes('mp4')?'mp4':'webm'):'png';const name=`CardioLab_${run.spec.id}_${st.id}.${ext}`;run.files.push({name,blob});
   $('ls-saved').innerHTML=`Guardado en esta sesión · <a href="#" id="ls-dl">descargar</a>`;$('ls-dl').onclick=e=>{e.preventDefault();api.download(blob,name)};
  }catch(e){$('ls-saved').textContent='No se pudo guardar: '+e.message}finally{b.disabled=false;b.textContent=st.evidence.kind==='clip'?`● Grabar clip ${st.evidence.seconds||3} s`:'Guardar cuadro'}refreshNext()}
 function tick(){if(!run||run.mode==='demostracion')return;const st=cur();if(!st)return;const m=api.measures();
  for(const [k,v] of Object.entries(m))if(v!=null)run.record.measures[k]=v;
  if(st.color){const ok=m.colorOn;$('ls-color')?.classList.toggle('ok',ok)}
  if(st.doppler){const el=$('ls-angle');if(el)el.textContent=m.dopplerMode?(m.dopplerAngle!=null?`Ángulo haz–flujo ≈ ${m.dopplerAngle}°`:'Ángulo: coloca el volumen de muestra sobre el flujo'):'Doppler apagado';$('ls-dop')?.classList.toggle('ok',m.dopplerMode===st.doppler.mode)}
  if(st.goal){const g=evaluateGoal(st.goal,api.pose(),ctx,api.structures()),blocked=run.blocked&&m.window===run.blocked;
   run.stable=g.met&&!blocked?run.stable+1:0;if(run.stable>=2&&!run.record.goals[st.id]){run.record.goals[st.id]=true;run.record.stepMs[st.id]=performance.now()-run.stepT0;const a=$('ls-after');if(a&&!(st.predict&&!run.answered.predict))a.hidden=false}
   const el=$('ls-goal');if(el){if(run.mode==='examen')el.innerHTML=run.record.goals[st.id]?'<p class="ok">Plano conseguido.</p>':'<p class="micro">Consigue el plano; el tutor lo detecta solo.</p>';
    else el.innerHTML=`<ul class="checks">${g.parts.map(p=>`<li class="${p.ok?'ok':''}">${p.ok?'✓':'○'} ${p.kind==='view'?`${esc(VIEW_INFO[p.id].short)} · coincidencia ${p.score} %${p.flipped?' · marcador invertido':''}`:p.kind==='anchor'?`${esc(ANCHOR_NAMES[p.id]||p.id)} ${p.ok?'en el plano':`a ${p.offMM} mm del plano`}`:esc(p.id)}</li>`).join('')}${blocked?'<li>Esta ventana no da imagen en este caso</li>':''}</ul>${run.record.goals[st.id]?'<p class="ok">Plano conseguido.</p>':''}`}}
  refreshNext()}
 function refreshNext(){const st=cur(),b=$('ls-next');if(!b)return;const r=run.record;
  const goalOk=!st.goal||r.goals[st.id]||r.rescued[st.id];const qs=['predict','confirm','explain'].filter(k=>st[k]).every(k=>run.answered?.[k]);
  const ev=!st.evidence||r.evidence.some(e=>e.step===st.id);b.disabled=!(goalOk&&qs&&ev)}
 function next(){const st=cur();run.record.stepMs[st.id]??=performance.now()-run.stepT0;if(run.step<run.spec.steps.length-1){run.step++;enterStep()}else finish()}
 function finish(){
  clearInterval(timer);api.setTarget(null);api.blockWindows(null);api.imageOnly(false);api.setCaption(null);
  const {spec,record}=run;record.ms=performance.now()-run.t0;const suff=evaluateSufficiency(spec,record),score=scoreAttempt(spec,record);
  const recs=recommend(record,catalog.index.competencies,{exclude:[spec.id]});
  const log=readLog();log.push({schema:'cardiolab.tutor-attempt/1',lesson:spec.id,version:spec.version||1,mode:run.mode,seed:run.seed,caseId:run.caseId,at:new Date().toISOString().slice(0,10),ms:Math.round(record.ms),stepMs:Object.fromEntries(Object.entries(record.stepMs).map(([k,v])=>[k,Math.round(v)])),hints:record.hints,showMe:record.showMe,rescued:record.rescued,errors:record.errors,sufficient:suff.sufficient,missing:suff.missing.map(m=>m.id)});writeLog(log);
  const bar=v=>v==null?'—':`<span class="bar"><i style="width:${v}%"></i></span> ${v} %`;
  host.innerHTML=`${header()}<div class="results"><h2>${suff.sufficient?'La evidencia responde la pregunta':'Evidencia insuficiente'}</h2>${suff.message?`<p class="pitfall">${esc(suff.message)}</p>`:''}
  <ul class="checks">${suff.met.map(m=>`<li class="ok">✓ ${esc(m.label)}</li>`).join('')}${suff.missing.map(m=>`<li>○ ${esc(m.label)}${m.why?` <span class="micro">(${esc(m.why)})</span>`:''}</li>`).join('')}</ul>
  ${run.caseId&&run.mode==='examen'?`<p class="micro">Caso: ${esc(spec.caseLabel)}</p>`:''}
  <h2>Por dominios</h2><dl class="domains">${['adquisicion','reconocimiento','razonamiento'].map(k=>`<dt>${DOMAINS[k]}</dt><dd>${bar(score[k].score)}<br><span class="micro">${esc(score[k].detail)}</span></dd>`).join('')}<dt>${DOMAINS.ayudas}</dt><dd>${esc(score.ayudas.detail)}</dd><dt>Tiempo</dt><dd>${fmtT(score.timeS||0)}</dd></dl>
  <p class="micro">${esc(score.note)}</p>
  ${recs.length?`<h2>Siguiente</h2>${recs.map(r=>`<p><b>${esc(r.name)}</b> (${r.errors} error${r.errors>1?'es':''}): primero <button class="link" data-open="${r.corrective}">${esc(getLesson(r.corrective)?.title||r.corrective)}</button>${r.transfer?`, después compruébalo en otra situación: <button class="link" data-open="${r.transfer}">${esc(getLesson(r.transfer)?.title||r.transfer)}</button>`:''}.</p>`).join('')}`:''}
  ${run.files.length?`<h2>Evidencia guardada</h2>${run.files.map((f,i)=>`<button data-file="${i}">${esc(f.name)}</button>`).join(' ')}`:''}
  <div class="nav"><button id="ls-again">Repetir (otra semilla)</button><button id="ls-exam" class="primary">${run.mode==='examen'?'Otro examen':'Hacer el examen'}</button></div>
  <details><summary>Fuentes</summary><ul>${spec.provenance.sources.map(id=>catalog.sources[id]).filter(Boolean).map(s=>`<li>${esc(s.citation)}${s.doi?` <a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">doi</a>`:''}<br><span class="micro">${esc(s.supports)}</span></li>`).join('')}</ul></details></div>`;
  bindHeader();bindOpen(host);host.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>{const f=run.files[Number(b.dataset.file)];api.download(f.blob,f.name)});
  $('ls-again').onclick=()=>open(run.id,{mode:run.mode});$('ls-exam').onclick=()=>open(run.id,{mode:'examen'});
 }
 function stop(){cancelAnimationFrame(raf);clearInterval(timer)}
 function leaveRun(){stop();if(!run)return;api.setTarget(null);api.blockWindows(null);api.imageOnly(false);api.setCaption(null);api.lockPhase(null);api.doppler(null);api.color(null);api.setVariant({id:'normal'});run=null}
 return {ready,open:(id,o)=>ready.then(()=>open(id,o)),leave(){leaveRun();if(catalog)home()},get run(){return run&&{id:run.id,mode:run.mode,step:run.step,seed:run.seed,caseId:run.caseId,record:run.record,t:run.t}},seekTo:t=>{if(run?.mode==='demostracion'){run.t=t;run.playing=false}}};
}
