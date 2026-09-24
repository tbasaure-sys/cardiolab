import {LESSONS,GUIDE,COURSE_VERSION,REVIEW_ITEMS,WINDOW_GUIDANCE,practiceSteps,projectedVelocity} from './course-data.mjs';

const KEY='cardiolab.echo.learning.v1';
const emptyEvidence=()=>({selected:new Set(),orientations:new Set(),angles:new Set(),review:new Set(),move:0,rotation:0,tilt:0,rock:0,quality:false});
export function mountTutor(api){
 const $=id=>document.getElementById(id);
 let progress={},index=0,opened=false,evidence=emptyEvidence(),baseline=null,answer=null,waiting=false,saveFailed=false;
 try {const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw?.version===COURSE_VERSION&&raw.completed&&typeof raw.completed==='object')progress=Object.fromEntries(LESSONS.filter(l=>raw.completed[l.id]?.completedAt).map(l=>[l.id,raw.completed[l.id]]));}catch{}
 const panel=$('tutor'),lesson=()=>LESSONS[index];
 function save(){try{localStorage.setItem(KEY,JSON.stringify({version:COURSE_VERSION,completed:progress}));saveFailed=false}catch{saveFailed=true}updateProgress()}
 function updateProgress(){const n=Object.keys(progress).length;$('course-progress').textContent=`${n} / ${LESSONS.length} lecciones`;$('course-progress-bar').value=n;$('course-progress-bar').max=LESSONS.length;$('learning-storage').textContent=saveFailed?'No se pudo guardar en este navegador; descarga el progreso.':'Progreso guardado solo en este navegador · no acredita competencia clínica.';for(const o of $('lesson-picker').options)o.textContent=`${progress[LESSONS[Number(o.value)].id]?'✓ ':''}${Number(o.value)+1}. ${LESSONS[Number(o.value)].title}`}
 function resetEvidence(){evidence=emptyEvidence();baseline=null;answer=null;waiting=true}
 function enter(i){index=Math.max(0,Math.min(LESSONS.length-1,i));resetEvidence();render();api.prepare(lesson().preset);observe(api.snapshot());}
 function render(){
  const l=lesson();$('lesson-picker').value=index;$('lesson-count').textContent=`${l.group} · ${index+1} / ${LESSONS.length}`;$('lesson-title').textContent=l.title;$('lesson-intro').textContent=l.intro;
  $('lesson-points').replaceChildren(...l.points.map(text=>{const li=document.createElement('li');li.textContent=text;return li}));$('lesson-task').textContent=l.task;
  const source=$('lesson-source');source.textContent=`Consultar guía · ${l.section}`;source.href=`${GUIDE.url}#page=${l.page}`;
  const guidance=WINDOW_GUIDANCE[l.id];$('clinical-window').hidden=!guidance;$('clinical-window').open=false;
  $('window-guidance').replaceChildren(...(guidance?Object.values(guidance):[]).map(text=>{const p=document.createElement('p');p.textContent=text;return p}));
  $('quiz-question').textContent=l.quiz.prompt;$('quiz-options').replaceChildren(...l.quiz.options.map((text,i)=>{const b=document.createElement('button');b.textContent=text;b.dataset.answer=i;b.onclick=()=>{answer=i;for(const option of $('quiz-options').children)option.classList.toggle('active',Number(option.dataset.answer)===i);$('quiz-feedback').textContent=(i===l.quiz.answer?'Correcto. ':'Revisa tu respuesta. ')+l.quiz.explanation;$('quiz-feedback').classList.toggle('correct',i===l.quiz.answer);refresh()};return b}));$('quiz-feedback').textContent='';
  $('doppler-lab').hidden=l.rule!=='doppler';$('review-exercise').hidden=l.rule!=='review';$('review-exercise').replaceChildren(...REVIEW_ITEMS.map((text,i)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.onchange=()=>{input.checked?evidence.review.add(i):evidence.review.delete(i);refresh()};label.append(input,document.createTextNode(text));return label}));
  $('lesson-prev').disabled=index===0;$('lesson-next').disabled=index===LESSONS.length-1;$('lesson-complete').textContent=progress[l.id]?'Repetir y guardar':'Completar lección';$('lesson-completion').textContent=progress[l.id]?'Ya completaste esta lección; puedes repetirla.':'';
  $('doppler-angle').value=0;renderDoppler(0,false);refresh();updateProgress();
 }
 function refresh(){
  const steps=practiceSteps(lesson(),evidence);$('practice-checks').replaceChildren(...steps.map(([text,done])=>{const li=document.createElement('li');li.textContent=`${done?'✓':'○'} ${text}`;li.classList.toggle('done',!!done);return li}));
  $('lesson-complete').disabled=waiting||answer!==lesson().quiz.answer||!steps.every(s=>s[1]);
  $('practice-status').textContent=waiting?'Preparando el plano…':steps.length?`${steps.filter(s=>s[1]).length} / ${steps.length} acciones observadas · no evalúa calidad clínica`:'Lección conceptual · responde para comprobar tu comprensión';
 }
 function observe(s){
  if(!opened||!s?.ready||s.appliedRevision!==s.revision||s.active?.preset!==lesson().preset)return;
  if(waiting){baseline={...s.active};waiting=false;}
  evidence.orientations.add(s.pediatricDisplay);
  const a=s.active;evidence.move=Math.max(evidence.move,Math.hypot(a.x-baseline.x,a.z-baseline.z));for(const k of ['tilt','rock','rotation'])evidence[k]=Math.max(evidence[k],Math.abs(a[k]-baseline[k]));
  if(s.selectedName)evidence.selected.add(s.selectedName);
  if(a.sector<=70&&a.depth<=.160001&&s.intersections?.length)evidence.quality=true;
  refresh();
 }
 function renderDoppler(angle,record=true){
  const theta=angle*Math.PI/180,velocity=projectedVelocity(angle);$('doppler-value').textContent=`θ = ${angle}° · proyección = ${velocity.toFixed(2).replace('.',',')} m/s`;
  $('flow-vector').setAttribute('x2',String(145+95*Math.sin(theta)));$('flow-vector').setAttribute('y2',String(130-95*Math.cos(theta)));
  if(record){evidence.angles.add(angle);refresh()}
 }
 $('lesson-picker').replaceChildren(...LESSONS.map((l,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}. ${l.title}`;return o}));
 $('course-toggle').onclick=()=>{opened=!opened;panel.hidden=!opened;$('practice-shell').classList.toggle('with-tutor',opened);$('course-toggle').setAttribute('aria-expanded',String(opened));if(opened)enter(index)};
 $('lesson-picker').onchange=e=>enter(Number(e.target.value));$('lesson-prev').onclick=()=>enter(index-1);$('lesson-next').onclick=()=>enter(index+1);$('lesson-restart').onclick=()=>enter(index);
 $('lesson-complete').onclick=()=>{const checks=practiceSteps(lesson(),evidence);if(waiting||answer!==lesson().quiz.answer||!checks.every(s=>s[1]))return;progress[lesson().id]={completedAt:new Date().toISOString(),quizCorrect:true,practice:checks.map(s=>s[0]),kind:checks.length?'simulator-exercise':'concept-check'};save();$('lesson-completion').textContent=index===LESSONS.length-1?`Recorrido revisado: ${Object.keys(progress).length} / ${LESSONS.length} lecciones completadas. Continúa el aprendizaje con supervisión.`:'Lección completada. Pulsa Siguiente para continuar.';$('lesson-complete').disabled=true;};
 $('doppler-angle').oninput=e=>renderDoppler(Number(e.target.value));document.querySelectorAll('[data-angle]').forEach(b=>b.onclick=()=>{$('doppler-angle').value=b.dataset.angle;renderDoppler(Number(b.dataset.angle))});
 $('course-export').onclick=()=>{const data={application:'CardioLab Echo',courseVersion:COURSE_VERSION,createdAt:new Date().toISOString(),source:GUIDE,completed:progress,totalLessons:LESSONS.length,clinicalCompetency:false,patientStudy:false};const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download='CardioLab_aprendizaje.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('course-source').href=GUIDE.url;$('course-source').title=GUIDE.title;
 render();return {observe};
}
