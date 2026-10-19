// «Estudio con informe»: a synthetic patient with a hidden diagnosis. The reader scans with the live probe, saves what they
// image and measure, writes a report, and is graded against the exact state of the simulated heart: the report fields, the
// protocol (which windows, which sites with colour — graded on what was actually imaged), and where each measurement error
// came from (attribute.mjs). Nothing is a patient: every case is generated from a seed and the report is kept only in this browser.
import {makeCase,describeCase,gradeExam,LESION_OPTIONS,DIRECTIONS,SEVERITIES,SITES,chordFor,EXAM_SOURCES,TOLERANCE_NOTE} from './exam-engine.mjs';
import {attributeVelocity,attributeSize,ATTRIBUTION_SOURCES} from './attribute.mjs';
import {variantSpec} from './shunt-model.mjs';
import {nearestView,VIEW_INFO} from './views.mjs';
import {hoursLabel} from './transition.mjs';
import {tag} from './provenance.mjs';

const KEY='cardiolab.exam.v1';
const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1=v=>v.toFixed(1).replace('.',','),f2=v=>v.toFixed(2).replace('.',',');
const num=s=>{const n=Number(String(s).replace(',','.').trim());return String(s).trim()!==''&&Number.isFinite(n)?n:null};
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const lessonName=id=>LESION_OPTIONS.find(o=>o.id===id)?.name||id;
const sevLabel=k=>SEVERITIES.find(s=>s.key===k)?.label||k;

export function mountExam(api){
 // api: {host, engine, views, landmarks(), patient(), setPatient(id), onVariant(spec,reveal), status(t), capture(), openTruth(c,{bedside}), onRoute(link), copyLink()}
 const host=api.host;let c=null,acqs=[],sites=null,revealed=false,busy=0,history=[];
 try{history=JSON.parse(localStorage.getItem(KEY)||'[]')}catch{}
 host.innerHTML=`<p class="micro">Un paciente sintético con un diagnóstico oculto. Explora con la sonda, guarda lo que ves y mides, escribe el informe y compáralo con el estado exacto del corazón simulado.</p>
  <div class="ex-case"><label>Caso nº <input id="ex-seed" type="number" min="1" max="999999" step="1" inputmode="numeric"></label><button id="ex-new" class="primary">Nuevo caso</button><button id="ex-link" title="Copia un enlace que abre este mismo caso">Copiar enlace</button></div>
  <div id="ex-patient" class="ex-patient"></div>
  <div id="ex-acquire"><h3>1 · Adquirir y medir</h3><p class="micro">Cada botón guarda lo que hay ahora en pantalla. La corrección usa el plano, el color y los espectros que guardes, no lo que digas haber hecho.</p>
   <div class="st-actions"><button id="ex-save-image" title="Guarda el plano y la caja de color actuales">Guardar imagen</button><button id="ex-save-caliper" title="Guarda la distancia entre los dos calibradores (botón Cáliper de la consola)">Guardar calibrador</button><button id="ex-save-doppler" title="Guarda la velocidad marcada en el espectro (Doppler PW o CW, pulsa el espectro)">Guardar velocidad</button></div>
   <ul id="ex-list" class="ex-list"></ul></div>
  <div id="ex-report"><h3>2 · Informe</h3>
   <label class="field"><span>Diagnóstico</span><select id="ex-lesion"><option value="">Elige…</option>${LESION_OPTIONS.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
   <div class="ex-two"><label class="field"><span>Diámetro del defecto (mm)</span><input id="ex-size" type="text" inputmode="decimal" placeholder="—"></label><label class="field"><span>Velocidad máxima del chorro (m/s)</span><input id="ex-vel" type="text" inputmode="decimal" placeholder="—"></label></div>
   <div class="ex-two"><label class="field"><span>Dirección del cortocircuito</span><select id="ex-dir"><option value="">Elige…</option>${DIRECTIONS.map(d=>`<option>${esc(d)}</option>`).join('')}</select></label><label class="field"><span>Repercusión (bandas del modelo)</span><select id="ex-sev"><option value="">Elige…</option>${SEVERITIES.map(s=>`<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select></label></div>
   <label class="field"><span>Qp/Qs estimado (opcional)</span><input id="ex-qpqs" type="text" inputmode="decimal" placeholder="—"></label>
   <button id="ex-submit" class="primary">Entregar informe</button></div>
  <div id="ex-result" aria-live="polite"></div><p class="micro" id="ex-hist"></p>`;
 const $=id=>host.querySelector('#'+id);
 const hide=(on)=>{$('ex-acquire').hidden=!on;$('ex-report').hidden=!on};
 // ---------------------------------------------------------------- the case
 // the case lives in the simulator as a variant: (re)apply the patient, the variant and the places the sites are now
 async function apply(my){
  if(api.patient().id!==c.patientId)api.setPatient(c.patientId);
  api.status('Preparando el caso…');
  const spec=c.state.size?variantSpec(c.state):{id:'normal'};await api.engine.setVariant(spec);if(my!==busy)return false;api.onVariant(spec,revealed);
  const lm=api.landmarks(),jet=lm.ductPulmonary.map((v,i)=>v+(lm.pulmonaryValve[i]-v)*.25);
  const [a,b,d,m,j]=await api.engine.warp([lm.asdSecundum,lm.vsdPerimembranous,lm.vsdMuscular,mid(lm.ductAortic,lm.ductPulmonary),jet]);if(my!==busy)return false;
  sites={asd2:{point:a,jetPoint:a},vsdpm:{point:b,jetPoint:b},vsdm:{point:d,jetPoint:d},pda:{point:m,jetPoint:j}};return true;
 }
 async function start(seed){
  const my=++busy;seed=Math.max(1,Math.floor(Number(seed)||1+Math.floor(Math.random()*99999)));
  c=makeCase(seed);acqs=[];revealed=false;sites=null;$('ex-seed').value=String(seed);$('ex-result').innerHTML='';$('ex-submit').disabled=false;hide(true);
  for(const id of ['ex-lesion','ex-size','ex-vel','ex-dir','ex-sev','ex-qpqs'])$(id).value='';
  if(!await apply(my))return;
  api.onRoute?.({route:'estudio',id:'examen',params:{semilla:seed}});renderPatient();renderList();api.status(`Caso ${seed} · explora y guarda tus imágenes y medidas`);
 }
 function renderPatient(){const d=describeCase(c);$('ex-patient').innerHTML=`<b>${esc(d.patient)}</b> · ${esc(d.age)} · ${f1(d.weightKg)} kg · ${d.heightCm} cm<br>FC ${d.hr} lpm · PA ${d.sbp}/${d.dbp} mmHg${d.hours!=null?` · <b>${hoursLabel(d.hours)} de vida</b>`:''}<div class="micro">Soplo en un control. No se dice qué tiene: la imagen y el Doppler lo dicen.</div>`}
 // ---------------------------------------------------------------- saving
 function describe(a){
  if(a.kind==='image'){const n=nearestView(a.pose,api.views);return `Imagen · ${n?`${esc(VIEW_INFO[n.id].short)} (${n.score} %)`:'plano libre'} · ${a.color?.on?'con color':'sin color'}`}
  if(a.kind==='caliper')return `Calibrador · ${f1(a.mm)} mm`;
  return `Doppler ${a.dop.mode.toUpperCase()} · ${f2(a.reading)} m/s · ángulo ${a.dop.theta.toFixed(0)}°`}
 function renderList(){$('ex-list').innerHTML=acqs.length?acqs.map((a,i)=>`<li>${describe(a)}${revealed?'':` <button data-rm="${i}" class="link" title="Quitar">quitar</button>`}</li>`).join(''):'<li class="micro">Aún no has guardado nada.</li>';
  $('ex-list').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{acqs.splice(Number(b.dataset.rm),1);renderList()})}
 function save(kind){
  if(!c||revealed)return;const s=api.capture();if(!s.ready){api.status('Pon la ecografía simulada en marcha para guardar.');return}
  if(kind==='image')acqs.push({kind,pose:s.pose,color:s.color});
  else if(kind==='caliper'){if(!s.caliper){api.status('Marca dos puntos con el calibrador (botón Cáliper de la consola).');return}acqs.push({kind,pose:s.pose,points:s.caliper.points,mm:s.caliper.mm});$('ex-size').value=f1(s.caliper.mm)}
  else{if(!s.dop||s.dop.reading==null||!s.dop.spec){api.status('Activa PW o CW, pulsa la imagen para colocar el cursor y pulsa el espectro para marcar la velocidad.');return}
   acqs.push({kind,pose:s.pose,dop:s.dop,reading:Math.abs(s.dop.reading),spec:s.dop.spec});$('ex-vel').value=f2(Math.abs(s.dop.reading))}
  renderList()}
 $('ex-save-image').onclick=()=>save('image');$('ex-save-caliper').onclick=()=>save('caliper');$('ex-save-doppler').onclick=()=>save('doppler');
 // ---------------------------------------------------------------- report and correction
 const readReport=()=>({lesion:$('ex-lesion').value||null,diameterMM:num($('ex-size').value),velocity:num($('ex-vel').value),direction:$('ex-dir').value||null,severity:$('ex-sev').value||null,qpqs:num($('ex-qpqs').value)});
 const last=kind=>[...acqs].reverse().find(a=>a.kind===kind);
 async function velocityCause(report){
  const a=last('doppler');if(!a||report.velocity==null)return null;const T=c.truth,jp=sites[T.lesion]?.jetPoint;if(!jp)return null;
  const spec={pose:a.pose,theta:a.dop.theta,gateDepth:a.dop.gateDepth,gateLen:.003,mode:a.dop.mode,freq:a.dop.freq,scale:a.dop.scale,baseline:a.dop.baseline,gain:1,bodyScale:a.dop.bodyScale};
  const aimed=await api.engine.spectrum({...spec,optimize:{range:30,step:1}});
  const q=jp.map((v,i)=>v-a.pose.origin[i]),x=q[0]*a.pose.u[0]+q[1]*a.pose.u[1]+q[2]*a.pose.u[2],y=q[0]*a.pose.d[0]+q[1]*a.pose.d[1]+q[2]*a.pose.d[2];
  const gated=await api.engine.spectrum({...spec,theta:Math.atan2(x,y)*180/Math.PI,gateDepth:Math.hypot(x,y),optimize:{range:10,step:1}});
  const sp=a.spec,ceiling=sp.vPeak>=0?sp.top:-sp.bottom;
  return attributeVelocity({truth:T.velocity,reported:report.velocity,peakStudent:sp.vPeak,peakAimed:aimed.vPeak,peakGated:gated.vPeak,ceiling});
 }
 function sizeCause(report){
  const a=last('caliper');if(!a||report.diameterMM==null)return null;const T=c.truth,s=sites[T.lesion];if(!s)return null;
  const ch=chordFor(c,a.pose,s.point);return {...attributeSize({truthMM:T.diameterMM,chordMM:ch.chordMM,measuredMM:report.diameterMM}),offMM:ch.offMM,chordMM:ch.chordMM};
 }
 async function submit(){
  if(!c||revealed)return;const report=readReport();if(!report.lesion){api.status('Elige un diagnóstico antes de entregar el informe.');return}
  revealed=true;$('ex-submit').disabled=true;renderList();api.status('Corrigiendo el estudio contra el corazón simulado…');
  const grade=gradeExam(c,report,acqs,sites,api.views);let vel=null,size=null;
  if(c.truth.lesion!=='normal'){try{vel=await velocityCause(report)}catch(e){console.warn('atribución de velocidad',e)}size=sizeCause(report)}
  history=[{seed:c.seed,percent:grade.percent,ok:report.lesion===c.truth.lesion},...history].slice(0,20);try{localStorage.setItem(KEY,JSON.stringify(history))}catch{}
  renderResult(report,grade,vel,size);api.onVariant(c.state.size?variantSpec(c.state):{id:'normal'},true);api.status(`Informe entregado · ${grade.percent} %`);
 }
 const bars=(a)=>{const mx=Math.max(1e-9,...a.rows.map(r=>Math.abs(r.value)));return `<div class="ex-bars">${a.rows.map(r=>{const w=Math.abs(r.value)/mx*50,neg=r.value<0;return `<div class="ex-bar${a.main===r.id?' main':''}"><span class="lab">${esc(r.label)}</span><span class="track"><i class="${neg?'neg':'pos'}" style="${neg?`right:50%`:`left:50%`};width:${w}%"></i></span><b>${r.value>0?'+':r.value<0?'−':''}${Math.abs(r.value).toFixed(a.digits).replace('.',',')} ${a.unit}</b></div>`}).join('')}</div>`};
 function causeBlock(title,a,truthTxt,saidTxt){
  if(!a)return `<div class="ex-cause"><h4>${title}</h4><p class="micro">Sin medida guardada con este tipo de herramienta: no hay plano ni espectro propios con los que repartir el error.</p></div>`;
  const main=a.rows.find(r=>r.id===a.main);
  return `<div class="ex-cause"><h4>${title}</h4><p class="micro">Verdad ${truthTxt} · tu informe ${saidTxt} · error ${a.error>0?'+':a.error<0?'−':''}${Math.abs(a.error).toFixed(a.digits).replace('.',',')} ${a.unit}. Las barras suman el error exactamente.</p>${bars(a)}${main?`<p class="ex-hint"><b>Lo que más pesó: ${esc(main.label.toLowerCase())}.</b> ${esc(main.hint)}</p>`:'<p class="ex-hint">Ninguna causa destaca: la medida es tan buena como permite el modelo.</p>'}</div>`}
 function renderResult(report,g,vel,size){
  const T=c.truth,row=i=>{const mark=i.frac>=1?'✓':i.frac>0?'½':'✗',cls=i.frac>=1?'ok':i.frac>0?'mid':'bad';
   const fmt=v=>v==null?'—':typeof v==='number'?(i.id==='velocity'||i.id==='qpqs'?f2(v):f1(v)):i.id==='lesion'?esc(lessonName(v)):i.id==='severity'?esc(sevLabel(v)):esc(v);
   return `<tr class="${cls}"><td>${esc(i.label)}${i.note?`<div class="micro">${esc(i.note)}</div>`:''}</td><td>${i.id==='windows'||i.id==='sites'||i.id==='documentation'?(i.id==='documentation'?(i.truth?'sí':''):i.truth):fmt(i.truth)}</td><td>${i.id==='windows'||i.id==='sites'?i.answer:i.id==='documentation'?(i.answer?'sí':'no'):fmt(i.answer)}${i.tol&&i.error!=null?`<div class="micro">error ${i.error>0?'+':'−'}${Math.abs(i.error).toFixed(i.id==='size'?1:2).replace('.',',')} (tolerancia ±${(i.id==='size'?f1:f2)(i.tol)})</div>`:''}</td><td><b>${mark}</b> ${i.pts}${i.max?` / ${i.max}`:''}</td></tr>`};
  const cov=g.coverage.map(s=>`<span class="ex-chip ${s.ok?'ok':s.inPlane?'mid':'bad'}" title="${esc(s.name)}${s.offMM!=null?` · plano a ${s.offMM} mm del centro`:''}">${esc(SITES[s.id].name)}</span>`).join('');
  const sevTag=tag(['modelo',{fuente:['spicer2014']}]);
  $('ex-result').innerHTML=`<h3>3 · Corrección</h3><div class="ex-score ${g.percent>=75?'ok':g.percent>=50?'mid':'bad'}"><b>${g.percent} %</b><span>${g.total} de ${g.max} puntos</span></div>
   <p>Era: <b>${esc(lessonName(T.lesion))}</b>${T.lesion!=='normal'?` de ${f1(T.diameterMM)} mm · ${esc(T.direction)} · Qp/Qs ${f2(T.qpqs)} · chorro ${f2(T.velocity)} m/s`:''} ${tag(['modelo',{fuente:EXAM_SOURCES}])}</p>
   <table class="ex-table"><thead><tr><th>Qué</th><th>Verdad</th><th>Tu respuesta</th><th>Puntos</th></tr></thead><tbody>${g.items.map(row).join('')}</tbody></table>
   <div class="ex-cov"><span class="micro">Zonas interrogadas con color en el plano:</span> ${cov}</div><p class="micro">${esc(TOLERANCE_NOTE)} ${sevTag}</p>
   ${T.lesion!=='normal'?`<h3>De dónde viene tu error</h3>${causeBlock('Velocidad del chorro',vel,`${f2(T.velocity)} m/s`,report.velocity==null?'—':`${f2(report.velocity)} m/s`)}${causeBlock('Tamaño del defecto',size,`${f1(T.diameterMM)} mm`,report.diameterMM==null?'—':`${f1(report.diameterMM)} mm`)}${size&&size.offMM!=null?`<p class="micro">Tu plano pasó a ${f1(size.offMM)} mm del centro del defecto y solo podía mostrar ${f1(size.chordMM)} mm de ${f1(T.diameterMM)}.</p>`:''}<p class="micro">La velocidad depende de cos θ (Quiñones 2002) ${tag(['ecuacion',{fuente:ATTRIBUTION_SOURCES}])}; el reparto se calcula repitiendo tu medida con el ángulo, la escala y la posición correctos.</p>`:''}
   <div class="st-actions"><button id="ex-truth">Ver la verdad en el estudio por gravedad</button><button id="ex-bedside">Ver la cabecera de este paciente</button><button id="ex-again" class="primary">Otro caso</button></div>`;
  $('ex-truth').onclick=()=>api.openTruth(c,{bedside:false});$('ex-bedside').onclick=()=>api.openTruth(c,{bedside:true});$('ex-again').onclick=()=>start();
  renderHist();
 }
 function renderHist(){const n=history.length;$('ex-hist').textContent=n?`Últimos ${n} informes: media ${Math.round(history.reduce((a,h)=>a+h.percent,0)/n)} % · diagnóstico acertado en ${history.filter(h=>h.ok).length} de ${n}`:''}
 $('ex-new').onclick=()=>start();$('ex-submit').onclick=submit;$('ex-link').onclick=()=>api.copyLink?.();
 $('ex-seed').onchange=()=>{const v=num($('ex-seed').value);if(v)start(v)};
 hide(false);renderHist();
 return {async enter(){if(!c){hide(false);return}const my=++busy;if(await apply(my)){api.onRoute?.({route:'estudio',id:'examen',params:{semilla:c.seed}});api.status(`Caso ${c.seed}`)}},leave(){busy++},start,get case(){return c},get revealed(){return revealed},get acquisitions(){return acqs},report:readReport,submit,sources:EXAM_SOURCES};
}
