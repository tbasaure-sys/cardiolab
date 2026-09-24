// "Cabina" layout: the probe maneuvers and a compact console sit together right under the three views, so the
// image, the probe and the knobs are on screen at the same time (no scrolling, no hiding the console).
// Also: keyboard shortcuts for the probe and the image, and the mouse wheel on the echo image.
const KEY='cardiolab.layout.v1';
const $=id=>document.getElementById(id);

export const SHORTCUTS=[
 ['Sonda',[['← →','Desplazar lateral'],['↑ ↓','Desplazar vertical'],['Q / E','Rotar (antihorario / horario)'],['W / S','Inclinar · tilt'],['A / D','Bascular · rock'],['Mayús + tecla','Paso fino'],['R','Restablecer ventana'],['B','Barrido']]],
 ['Imagen',[['Espacio','Congelar / descongelar'],['+ / −','Profundidad'],[', / .','Ganancia − / +'],['F','Frecuencia (2,5 → 12 MHz)'],['C','Doppler color'],['P / K','Doppler PW / CW'],['Rueda sobre la eco','Profundidad (con Mayús: ganancia)'],['?','Mostrar u ocultar esta ayuda']]]
];

export function mountCabina(api){
 // api: {nudge(key,delta), set(key,value), value(key), click(id), ready()}
 const main=document.querySelector('.practice-main'),workspace=document.querySelector('.workspace'),probe=document.querySelector('.probe-controls'),instrument=$('instrument');
 const deck=document.createElement('div');deck.id='deck';deck.className='deck';deck.setAttribute('aria-label','Sonda y consola');
 const probeHome=document.createComment('probe-controls'),instrumentHome=document.createComment('instrument');
 let on=false;
 // extra controls for the compact console: TGC popover, full console, shortcuts
 const tools=document.createElement('div');tools.className='deck-tools';
 tools.innerHTML='<button id="deck-reset" title="Vuelve la imagen a sus valores de partida">Restablecer imagen</button><button id="deck-tgc" aria-expanded="false" title="Compensación por profundidad">TGC ▴</button><button id="deck-keys" title="Atajos de teclado (?)">⌨ Atajos</button><button id="deck-full" aria-pressed="false" title="Muestra la consola completa (TGC, esfera, ayuda)">Consola completa</button>';
 const help=document.createElement('div');help.id='shortcut-help';help.className='shortcut-help';help.hidden=true;
 help.innerHTML=`<div class="shortcut-head"><strong>Atajos de teclado</strong><button id="shortcut-close" aria-label="Cerrar">×</button></div><div class="shortcut-cols">${SHORTCUTS.map(([t,rows])=>`<section><h3>${t}</h3><dl>${rows.map(([k,d])=>`<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`).join('')}</dl></section>`).join('')}</div><p>Los atajos no actúan mientras escribes en un campo.</p>`;
 document.body.append(help);
 const sweep=$('sweep');const sweepHome=document.createComment('sweep');

 // the three views take whatever height is left once the deck is on screen
 function fit(){if(!on)return;const top=workspace.getBoundingClientRect().top+scrollY;document.documentElement.style.setProperty('--ws-h',`${Math.max(320,Math.min(820,innerHeight-top-deck.offsetHeight-14))}px`)}
 function enable(v){
  if(v===on)return;on=v;document.body.classList.toggle('cabina',on);$('layout-toggle').textContent=on?'Diseño: cabina':'Diseño: clásico';$('layout-toggle').setAttribute('aria-pressed',String(on));
  if(on){probe.before(probeHome);instrument.before(instrumentHome);sweep.before(sweepHome);workspace.after(deck);deck.append(probe,instrument);instrument.append(tools);probe.querySelector('.section-heading').append(sweep);requestAnimationFrame(fit)}
  else{probeHome.replaceWith(probe);instrumentHome.replaceWith(instrument);sweepHome.replaceWith(sweep);tools.remove();deck.remove();instrument.classList.remove('full','tgc-open');document.documentElement.style.removeProperty('--ws-h')}
  try{localStorage.setItem(KEY,on?'cabina':'clasico')}catch{}
  dispatchEvent(new Event('resize'));
 }
 addEventListener('resize',fit);new ResizeObserver(fit).observe(deck);
 tools.querySelector('#deck-reset').onclick=()=>$('console-auto').click();
 tools.querySelector('#deck-tgc').onclick=e=>{const open=instrument.classList.toggle('tgc-open');e.currentTarget.setAttribute('aria-expanded',String(open))};
 tools.querySelector('#deck-full').onclick=e=>{const full=instrument.classList.toggle('full');e.currentTarget.setAttribute('aria-pressed',String(full));e.currentTarget.textContent=full?'Consola compacta':'Consola completa';fit()};
 const toggleHelp=()=>{help.hidden=!help.hidden};tools.querySelector('#deck-keys').onclick=toggleHelp;help.querySelector('#shortcut-close').onclick=()=>help.hidden=true;
 $('layout-toggle').onclick=()=>enable(!on);

 // keyboard: ignored while typing or while a knob/slider/trackball has the focus (they use the arrows themselves)
 addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||!api.ready())return;const t=e.target;
  if(t.closest?.('input,select,textarea,[role=slider],.trackball,dialog,[contenteditable]'))return;
  const fine=e.shiftKey,k=e.key.length===1?e.key.toLowerCase():e.key;let done=true;
  const mm=fine?.001:.003,deg=fine?1:4;
  switch(k){
   case 'ArrowLeft':api.nudge('x',-mm);break;case 'ArrowRight':api.nudge('x',mm);break;
   case 'ArrowUp':api.nudge('z',mm);break;case 'ArrowDown':api.nudge('z',-mm);break;
   case 'q':api.nudge('rotation',-deg*2);break;case 'e':api.nudge('rotation',deg*2);break;
   case 'w':api.nudge('tilt',deg);break;case 's':api.nudge('tilt',-deg);break;
   case 'a':api.nudge('rock',-deg);break;case 'd':api.nudge('rock',deg);break;
   case 'r':api.click('reset-pose');break;case 'b':api.click('sweep');break;
   case ' ':api.click('freeze');break;
   case '+':case '=':api.set('depth',api.value('depth')+(fine?.005:.01));break;case '-':case '_':api.set('depth',api.value('depth')-(fine?.005:.01));break;
   case ',':api.set('gain',api.value('gain')-.1);break;case '.':api.set('gain',api.value('gain')+.1);break;
   case 'f':{const F=[2.5,3,4,5,6,7,8,10,12],i=F.findIndex(f=>f>api.value('freq')+1e-6);api.set('freq',F[i<0?0:i]);break}
   case 'c':api.click('console-color');break;case 'p':api.click('console-pw');break;case 'k':api.click('console-cw');break;
   case '?':toggleHelp();break;case 'Escape':if(!help.hidden)help.hidden=true;else done=false;break;
   default:done=false}
  if(done){e.preventDefault();e.stopPropagation()}
 });
 // wheel on the echo image: depth (Shift: gain)
 $('scan').addEventListener('wheel',e=>{if(!api.ready())return;e.preventDefault();const s=e.deltaY<0?1:-1;if(e.shiftKey)api.set('gain',api.value('gain')+.1*s);else api.set('depth',api.value('depth')-.01*s)},{passive:false});

 let saved=null;try{saved=localStorage.getItem(KEY)}catch{}
 enable(saved?saved==='cabina':innerWidth>=1000);
 return {enable,get on(){return on},fit};
}
