// Congenital heart disease mode: explore a lesion with guided views, or scan a blinded case and commit a diagnosis.
import {VARIANTS,VARIANT_BY_ID} from './chd-data.mjs';
import {VIEW_INFO,solveState} from './views.mjs';
import {physical} from './geometry.mjs';

const KEY='cardiolab.echo.cases.v1';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function mountCHD(api){
 // api: {host, views, engine, state(), apply(state,{animate}), status(text), onVariant(spec, reveal)}
 const host=api.host;let stats={seen:0,correct:0};try{stats={...stats,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{}
 let mode='explore',active=VARIANT_BY_ID.normal,caseVariant=null,caseScale=1,answered=false,busy=false,queued=null;
 const groups=[...new Set(VARIANTS.map(v=>v.group))];
 host.innerHTML=`<span class="eyebrow">CARDIOPATÍAS</span><h1>Lesiones en el mismo corazón</h1>
 <p class="lead">Las lesiones se modelan dentro del volumen acústico: aparecen en la imagen eco simulada, en el plano exacto donde estén. El atlas 3D sigue mostrando la anatomía normal.</p>
 <div class="seg" role="tablist"><button id="chd-mode-explore" class="active" role="tab">Explorar lesión</button><button id="chd-mode-case" role="tab">Caso incógnito</button></div>
 <section id="chd-explore"><label class="field"><span>Lesión</span><select id="chd-variant">${groups.map(g=>`<optgroup label="${g}">${VARIANTS.filter(v=>v.group===g).map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
  <div id="chd-size-row" class="field" hidden><span>Tamaño</span><input id="chd-size" type="range" min="0.6" max="1.6" step="0.1" value="1"><output id="chd-size-out">1,0×</output></div>
  <article id="chd-card" class="chd-card"></article></section>
 <section id="chd-case" hidden><p class="micro">Se carga una anatomía al azar (puede ser normal). Explora con las vistas que consideres y responde.</p>
  <button id="chd-new" class="primary">Nuevo caso</button><div id="chd-answer" hidden><label class="field"><span>Tu diagnóstico</span><select id="chd-guess">${VARIANTS.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label><button id="chd-submit">Responder</button></div>
  <div id="chd-feedback" aria-live="polite"></div><p class="micro" id="chd-stats"></p></section>`;
 const $=id=>host.querySelector('#'+id);
 function card(v){
  const sizeable=v.params&&('radius' in v.params||'mm' in v.params);
  return `<h2>${esc(v.name)}</h2><p>${esc(v.teach)}</p>${v.look?`<h3>Qué buscar</h3><ul>${v.look.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${v.pitfall?`<p class="pitfall">${esc(v.pitfall)}</p>`:''}
  <h3>Mejores vistas</h3><div class="chd-views">${v.views.map(id=>`<button data-go="${id}">${esc(VIEW_INFO[id]?.name||id)}</button>`).join('')}</div>${v.doppler?`<h3>Doppler color</h3><p>${esc(v.doppler)}</p>${v.id!=='normal'&&v.id!=='effusion'&&v.id!=='rvh'?`<button class="primary" data-color="${v.id}" data-view="${v.views[0]}">Ver la lesión con Doppler color</button>`:''}${['vsdpm','vsdm','pda','coarct','lvh','ebstein'].includes(v.id)?` <button data-cw="${v.id}" data-view="${v.views[0]}">Medir con Doppler continuo</button>`:''}`:''}`;
 }
 function bindGo(root){root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));root.querySelectorAll('[data-color]').forEach(b=>b.onclick=async()=>{await settle();await go(b.dataset.view);setTimeout(()=>api.colorOnLesion?.(b.dataset.color),1250)});root.querySelectorAll('[data-cw]').forEach(b=>b.onclick=async()=>{await settle();api.cwOnLesion?.(b.dataset.cw)})}
 async function settle(){while(busy)await busy}
 async function go(viewId){const target=api.views[viewId];if(!target)return;api.status('Llevando la sonda a '+VIEW_INFO[viewId].short+'…');await new Promise(r=>setTimeout(r,20));
  const s=api.state(),preset={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'}[VIEW_INFO[viewId].window];
  const sol=solveState(target,preset);api.apply({...sol.state,depth:physical(target.depth),mode:'echo'},{animate:true});}
 async function load(v,{reveal=true,scale=1}={}){
  // a request made while another variant is loading is kept (the latest wins), never dropped
  if(busy){queued=[v,{reveal,scale}];return busy}
  active=v;api.status('Aplicando anatomía…');
  const params={};if(v.params){for(const [k,val] of Object.entries(v.params))params[k]=typeof val==='number'&&k!=='lumen'?val*scale:val}
  busy=(async()=>{await api.engine.setVariant({id:v.id,params});api.onVariant({id:v.id,params},reveal);api.status(reveal?v.name:'Caso cargado · explora')})();
  await busy;busy=false;if(queued){const q=queued;queued=null;return load(...q)}
 }
 function showExplore(){const v=VARIANT_BY_ID[$('chd-variant').value];$('chd-card').innerHTML=card(v);bindGo($('chd-card'));$('chd-size-row').hidden=!(v.params&&('radius' in v.params||'mm' in v.params));}
 $('chd-variant').onchange=()=>{$('chd-size').value=1;$('chd-size-out').textContent='1,0×';showExplore();load(VARIANT_BY_ID[$('chd-variant').value])};
 $('chd-size').oninput=()=>{$('chd-size-out').textContent=`${Number($('chd-size').value).toFixed(1).replace('.',',')}×`};
 $('chd-size').onchange=()=>load(VARIANT_BY_ID[$('chd-variant').value],{scale:Number($('chd-size').value)});
 function setMode(m){mode=m;$('chd-mode-explore').classList.toggle('active',m==='explore');$('chd-mode-case').classList.toggle('active',m==='case');$('chd-explore').hidden=m!=='explore';$('chd-case').hidden=m!=='case';
  if(m==='explore'){caseVariant=null;load(VARIANT_BY_ID[$('chd-variant').value])}else{$('chd-feedback').innerHTML='';$('chd-answer').hidden=true;load(VARIANT_BY_ID.normal,{reveal:false})}}
 $('chd-mode-explore').onclick=()=>setMode('explore');$('chd-mode-case').onclick=()=>setMode('case');
 function updateStats(){$('chd-stats').textContent=stats.seen?`Aciertos: ${stats.correct} de ${stats.seen} casos`:''}
 $('chd-new').onclick=async()=>{const pool=VARIANTS.filter(v=>v.id!==caseVariant?.id);caseVariant=pool[Math.floor(Math.random()*pool.length)];answered=false;$('chd-feedback').innerHTML='';$('chd-answer').hidden=false;$('chd-guess').value='normal';
  caseScale=.85+Math.random()*.4;await load(caseVariant,{reveal:false,scale:caseScale});$('chd-feedback').innerHTML='<p class="micro">Caso listo. Recorre al menos una vista paraesternal, una apical y la subcostal antes de responder.</p>'};
 $('chd-submit').onclick=()=>{if(!caseVariant||answered)return;answered=true;const guess=$('chd-guess').value,ok=guess===caseVariant.id;stats.seen++;if(ok)stats.correct++;try{localStorage.setItem(KEY,JSON.stringify(stats))}catch{}updateStats();
  $('chd-feedback').innerHTML=`<div class="result ${ok?'ok':'bad'}"><b>${ok?'Correcto':'No era eso'}</b> · era <b>${esc(caseVariant.name)}</b>.</div>${card(caseVariant)}`;bindGo($('chd-feedback'));api.onVariant({id:caseVariant.id},true)};
 showExplore();updateStats();
 return {enter(){if(mode==='explore')load(VARIANT_BY_ID[$('chd-variant').value]);else if(caseVariant)load(caseVariant,{reveal:answered,scale:caseScale})},leave(){api.engine.setVariant({id:'normal'});api.onVariant({id:'normal'},false)}};
}
