// Acquisition coach: reach standard pediatric views with live plane-agreement feedback and maneuver hints.
// Two modes: practice (heart visible, live meter, hints) and test (only the echo image; graded when the student
// submits, then the heart and the ideal plane are revealed).
import {VIEW_INFO,planeAgreement,suggestManeuver,solveState,markerClock} from './views.mjs';
import {poseFromState,defaultState} from './geometry.mjs';
import {scanConvert} from './bmode.mjs';

const KEY='cardiolab.echo.coach.v1';
const GROUPS=[['Paraesternal',['plax','psaxAV','psaxMV','psaxPM']],['Apical',['a4c','a5c','a2c','a3c']],['Subcostal',['sc4c','scSAX']],['Supraesternal',['ssn']]];
const PRESET_OF={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'};
const TEST='@test'; // suffix of best-result keys earned in test mode
const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function mountCoach(api){
 // api: {host, views, engine, state(), apply(partialState,{animate}), setTarget(pose|null), status(text), imageOnly(on), ySign(window)}
 const host=api.host;let best={};try{best=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch{best={}}
 let current=null,started=0,hints=0,exam=false,testMode=false,held=0,done=false,lastEval=null,timer=null,ghostFor=null,solving=false;
 host.innerHTML=`<span class="eyebrow">ENTRENADOR DE VISTAS</span>
 <h1>Encuentra la vista</h1>
 <p class="lead">Practica con el corazón visible y el medidor en vivo. Cuando te sientas preparado, ponte a prueba: el corazón se oculta y solo te guía la imagen eco, como en el ecógrafo.</p>
 <label class="field"><span>Vista objetivo</span><select id="coach-view">${GROUPS.map(([g,ids])=>`<optgroup label="${g}">${ids.map(id=>`<option value="${id}">${VIEW_INFO[id].name}</option>`).join('')}</optgroup>`).join('')}</select></label>
 <div class="seg" role="radiogroup" aria-label="Modo del reto"><button id="coach-mode-practice" class="active" role="radio" aria-checked="true">Practicar</button><button id="coach-mode-test" role="radio" aria-checked="false">Ponerme a prueba</button></div>
 <p id="coach-mode-note" class="micro"></p>
 <div class="coach-actions"><button id="coach-start" class="primary">Empezar reto</button></div>
 <section id="coach-card" class="coach-card" hidden>
  <div class="coach-meter"><div class="meter-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" class="track"/><circle cx="60" cy="60" r="50" id="coach-arc" class="arc"/></svg><strong id="coach-score">0</strong><small>/ 100</small></div>
   <div><p id="coach-verdict" class="verdict">Busca la ventana</p><p id="coach-time" class="micro">0:00</p><ul class="coach-metrics"><li>Plano <b id="coach-angle">—</b></li><li>Desplazamiento <b id="coach-offset">—</b></li><li>Marcador <b id="coach-marker">—</b></li></ul></div></div>
  <div class="coach-goal"><p id="coach-goal"></p><p class="micro" id="coach-clock"></p></div>
  <div id="coach-test" class="coach-test" hidden><p>Mueve la sonda hasta que la imagen muestre la vista. Cuando creas tenerla, evalúa: se revelarán el corazón y el plano ideal.</p><button id="coach-submit" class="primary">Evaluar mi vista</button></div>
  <div id="coach-result" class="coach-result" hidden></div>
  <ul id="coach-landmarks" class="coach-landmarks"></ul>
  <div class="coach-help"><button id="coach-hint">Pista</button><button id="coach-ghost">Ver vista ideal</button><button id="coach-solve">Mostrar solución</button></div>
  <p id="coach-hint-text" class="hint" aria-live="polite"></p>
  <figure id="coach-ghost-fig" hidden><canvas id="coach-ghost-canvas" width="260" height="200"></canvas><figcaption>Vista ideal simulada · compara las relaciones, no el brillo</figcaption></figure>
  <details class="coach-more"><summary>Qué comprobar en esta vista</summary><ul id="coach-checks"></ul><p id="coach-pitfall" class="pitfall"></p></details>
 </section>
 <section class="coach-board"><h2>Tus mejores resultados</h2><ol id="coach-best"></ol><p class="micro">Se guardan solo en este navegador.</p></section>`;
 const $=id=>host.querySelector('#'+id),card=$('coach-card');
 function renderBest(){const rows=Object.entries(best).sort((a,b)=>a[1].time-b[1].time);$('coach-best').innerHTML=rows.length?rows.map(([key,b])=>{const test=key.endsWith(TEST),id=test?key.slice(0,-TEST.length):key;return `<li><span>${esc(VIEW_INFO[id]?.short||id)}</span><b>${fmt(b.time)}</b><small>${test?`prueba · ${b.score} / 100`:b.hints?`${b.hints} pista${b.hints>1?'s':''}`:'sin pistas'}</small></li>`}).join(''):'<li class="empty">Aún no has completado ninguna vista.</li>'}
 renderBest();
 function setMode(test){testMode=test;$('coach-mode-practice').classList.toggle('active',!test);$('coach-mode-test').classList.toggle('active',test);$('coach-mode-practice').setAttribute('aria-checked',String(!test));$('coach-mode-test').setAttribute('aria-checked',String(test));
  $('coach-mode-note').textContent=test?'Corazón oculto, sin medidor ni pistas. Solo la imagen eco y la sonda.':'Corazón visible, plano objetivo en 3D, medidor en vivo y pistas.'}
 $('coach-mode-practice').onclick=()=>setMode(false);$('coach-mode-test').onclick=()=>setMode(true);setMode(false);
 function save(key,entry){best[key]=entry;try{localStorage.setItem(KEY,JSON.stringify(best))}catch{}renderBest()}
 function start(){
  const id=$('coach-view').value,info=VIEW_INFO[id];current={id,info,target:api.views[id]};hints=0;done=false;held=0;exam=testMode;started=performance.now();
  card.hidden=false;card.classList.toggle('testing',exam);$('coach-goal').textContent=info.goal;$('coach-clock').textContent=`Ventana: ${windowName(info.window)} · marcador hacia las ${info.clock} del reloj torácico`;
  $('coach-checks').innerHTML=info.checks.map(c=>`<li>${esc(c)}</li>`).join('');$('coach-pitfall').textContent=info.pitfall;
  $('coach-hint-text').textContent='';$('coach-ghost-fig').hidden=true;ghostFor=null;$('coach-result').hidden=true;$('coach-test').hidden=!exam;
  // start from the window preset with a random perturbation: the student must correct it
  const base=defaultState(PRESET_OF[info.window]||'plax'),rnd=(a)=>(Math.random()*2-1)*a;
  const same=['plax','a4c','sc4c','ssn','psaxPM'].includes(id);api.apply({...base,rotation:Math.round(rnd(same?38:22)),tilt:Math.round(rnd(same?16:10)),rock:Math.round(rnd(12)),x:base.x+rnd(.01),z:base.z+rnd(.01),depth:current.target.depth,mode:'echo'},{animate:false});
  api.imageOnly?.(exam);api.setTarget(exam?null:current.target);clearInterval(timer);timer=setInterval(tick,250);evaluate();
  $('coach-start').textContent='Reiniciar reto';
 }
 function windowName(w){return {plax:'paraesternal izquierda',psax:'paraesternal izquierda',apical:'apical',subcostal:'subcostal',ssn:'supraesternal'}[w]||w}
 function tick(){if(!current)return;const t=(performance.now()-started)/1000;if(!done){$('coach-time').textContent=fmt(t);evaluate()}}
 function showMeter(a,pose){
  $('coach-score').textContent=a.score;const arc=$('coach-arc'),L=2*Math.PI*50;arc.style.strokeDasharray=`${L*a.score/100} ${L}`;
  const tone=a.score>=85?'good':a.score>=60?'near':a.score>=30?'mid':'far';host.querySelector('.coach-meter').dataset.tone=tone;
  $('coach-angle').textContent=`${a.angle.toFixed(0)}°`;$('coach-offset').textContent=`${a.offset.toFixed(0)} mm`;$('coach-marker').textContent=a.flipped?'invertido':`${Math.round(markerClock(pose.u))||12} h`;
  $('coach-landmarks').innerHTML=a.visible.map(v=>`<li class="${v.ok?'ok':''}">${v.ok?'✓':'○'} ${esc(v.name)}${v.ok?'':v.inSector?` <small>${v.off.toFixed(0)} mm fuera del plano</small>`:' <small>fuera del sector</small>'}</li>`).join('');
 }
 function evaluate(){
  if(!current)return;const s=api.state(),pose=poseFromState(s),a=planeAgreement(pose,current.target);lastEval=a;
  // in a test nothing about the plane is shown until the student submits
  if(exam&&!done){$('coach-verdict').textContent='Guíate solo por la imagen';return}
  showMeter(a,pose);
  if(done)return;
  $('coach-verdict').textContent=a.flipped&&a.score<60?'Imagen en espejo: gira el marcador ~180°':a.score>=85?'¡Casi! Mantén la sonda quieta':a.score>=60?'Muy cerca: ajustes finos':a.score>=30?'Vas bien: corrige el plano':'Busca la ventana';
  if(a.score>=85){held+=1;if(held>=4)complete()}else held=0;
 }
 function complete(){
  done=true;const t=(performance.now()-started)/1000;$('coach-verdict').textContent=`¡Vista lograda! ${fmt(t)}${hints?` · ${hints} pista${hints>1?'s':''}`:' · sin pistas'}`;host.querySelector('.coach-meter').dataset.tone='done';
  const prev=best[current.id];if(!prev||hints<prev.hints||(hints===prev.hints&&t<prev.time))save(current.id,{time:t,hints,date:new Date().toISOString()});
  api.status(`${current.info.short} lograda en ${fmt(t)}`);
  $('coach-hint-text').innerHTML=`<b>Qué mirar ahora:</b> ${esc(current.info.checks.join(' · '))}. <span class="coach-next-row"><button id="coach-retest" class="primary">Ahora sin el corazón →</button><button id="coach-next">Siguiente vista →</button></span>`;
  $('coach-next').onclick=next;$('coach-retest').onclick=()=>{setMode(true);start()};
 }
 function next(){const opts=[...$('coach-view').options],i=opts.findIndex(o=>o.value===current.id);$('coach-view').value=opts[(i+1)%opts.length].value;start()}
 // test mode: grade the plane the student committed to, then reveal the heart and the ideal plane
 function submit(){
  if(!current||!exam||done)return;done=true;const t=(performance.now()-started)/1000,s=api.state(),pose=poseFromState(s),a=planeAgreement(pose,current.target);lastEval=a;
  api.imageOnly?.(false);api.setTarget(current.target);card.classList.remove('testing');$('coach-test').hidden=true;showMeter(a,pose);
  const ok=a.score>=85,near=a.score>=60;host.querySelector('.coach-meter').dataset.tone=ok?'done':near?'near':'far';
  $('coach-verdict').textContent=ok?`¡Vista lograda sin ver el corazón! ${fmt(t)}`:near?`Cerca · ${fmt(t)}`:`Todavía lejos · ${fmt(t)}`;
  const issues=[];if(a.flipped)issues.push('El marcador apunta al lado contrario: la imagen sale en espejo.');if(a.angle>=12)issues.push(`El plano está girado ${a.angle.toFixed(0)}° respecto del ideal: corrige rotación o inclinación.`);if(a.offset>=8)issues.push(`El plano pasa a ${a.offset.toFixed(0)} mm del centro de la vista: desliza o inclina hacia él.`);
  const missing=a.visible.filter(v=>!v.ok).map(v=>v.name);if(missing.length)issues.push(`No quedaron en el corte: ${missing.join(', ')}.`);
  $('coach-result').hidden=false;$('coach-result').innerHTML=`<p>${ok?'Reconociste la vista con la imagen sola.':'Compara ahora tu plano (verde) con el ideal (naranja discontinuo) en el corazón.'}</p>${issues.length?`<ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="coach-next-row"><button id="coach-retry" class="primary">Reintentar</button><button id="coach-show">Ver la solución</button><button id="coach-next2">Siguiente vista →</button></div>`;
  $('coach-retry').onclick=start;$('coach-next2').onclick=next;$('coach-show').onclick=()=>{api.apply({...solveState(current.target,s.preset,s).state,mode:'echo'},{animate:true})};
  if(ok){const key=current.id+TEST,prev=best[key];if(!prev||a.score>prev.score||(a.score===prev.score&&t<prev.time))save(key,{time:t,score:a.score,hints:0,date:new Date().toISOString()})}
  api.status(`${current.info.short} · prueba: ${a.score} / 100`);
 }
 $('coach-start').onclick=start;$('coach-submit').onclick=submit;
 $('coach-hint').onclick=()=>{if(!current||done||exam)return;hints++;const s=api.state(),h=suggestManeuver(s,current.target);$('coach-hint-text').textContent=h.text?`${h.text}.`:'Ningún ajuste aislado mejora el plano: vuelve a la ventana (Restablecer ventana) y empieza por la rotación.'};
 $('coach-ghost').onclick=async()=>{if(!current||exam)return;const fig=$('coach-ghost-fig');if(!fig.hidden&&ghostFor===current.id){fig.hidden=true;return}hints+=ghostFor===current.id?0:1;ghostFor=current.id;fig.hidden=false;
  const c=$('coach-ghost-canvas'),g=c.getContext('2d');g.fillStyle='#05080b';g.fillRect(0,0,c.width,c.height);g.fillStyle='#8aa1ae';g.font='11px Segoe UI';g.fillText('Simulando…',10,20);
  try{const frame=await api.engine.renderOnce(current.target,{beating:false});const img=g.createImageData(c.width,c.height);const p=current.target,ySign=api.ySign(current.info.window);const scale=Math.min((c.width-10)/(2*p.depth*Math.sin(p.sector*Math.PI/360)),(c.height-12)/p.depth);
   scanConvert(frame,img,{cx:c.width/2,cy:ySign===1?6:c.height-6,scale,ySign});g.putImageData(img,0,0)}catch(e){g.fillText('No disponible: '+e.message,10,36)}};
 $('coach-solve').onclick=async()=>{if(!current||solving||exam)return;solving=true;hints+=2;$('coach-hint-text').textContent='Calculando la maniobra…';
  await new Promise(r=>setTimeout(r,30));const s=api.state(),sol=solveState(current.target,s.preset,s);api.apply({...sol.state,mode:'echo'},{animate:true});
  $('coach-hint-text').textContent='Así se llega. Observa qué cambió en cada control y vuelve a intentarlo desde la ventana.';solving=false};
 return {update:evaluate,get active(){return !!current},stop(){clearInterval(timer);current=null;api.imageOnly?.(false);api.setTarget(null);card.hidden=true;$('coach-start').textContent='Empezar reto'},select(id){$('coach-view').value=id}};
}
