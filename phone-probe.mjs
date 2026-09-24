// Phone as probe, simulator side: pairing dialog (QR + code, WebRTC via PeerJS), or this same device's sensors.
// Orientation is relative to a calibration: at "Calibrar" (or when a window is chosen) the current phone attitude
// is tied to the current probe pose; from then on every phone rotation turns the probe the same way.
import {deviceMatrix,quatFromMatrix,matrixFromQuat,slerp,relativeAxes,anglesFromAxes} from './probe-motion.mjs';
import {poseFromState} from './geometry.mjs';
import qrcode from './node_modules/qrcode-generator/dist/qrcode.mjs';

const PREFIX='cardiolab-',ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
const newCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>ALPHABET[b%ALPHABET.length]).join('');
function loadPeerJS(){if(window.peerjs)return Promise.resolve(window.peerjs);return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='node_modules/peerjs/dist/peerjs.min.js';s.onload=()=>resolve(window.peerjs);s.onerror=()=>reject(Error('No se pudo cargar PeerJS'));document.head.append(s)})}

export function mountPhoneProbe(api){
 // api: {state(), ready(), preset(key), applyAngles({tilt,rock,rotation}), slide(dx,dz), freeze(), status(text), info()}
 const dialog=document.createElement('dialog');dialog.id='phone-dialog';dialog.className='phone-dialog';
 dialog.innerHTML=`<div class="dialog-top"><strong>Tu teléfono como sonda</strong><button id="phone-close">Cerrar</button></div>
 <div class="phone-grid"><div id="phone-qr" class="phone-qr" aria-label="Código QR para abrir la sonda en el teléfono"></div>
 <div><ol class="phone-steps"><li>Escanea el QR con el teléfono (o abre <a id="phone-link" target="_blank" rel="noopener"></a> y escribe el código).</li><li>Pulsa <b>Conectar</b> y permite el acceso al movimiento.</li><li>Sujétalo como una sonda: pantalla hacia ti, borde inferior sobre el tórax (un muñeco o una almohada sirven), borde derecho = marcador. Elige la ventana y pulsa <b>Calibrar</b>.</li><li>Gira, inclina y bascula el teléfono; desliza con el panel táctil.</li></ol>
 <p class="phone-code">Código <b id="phone-code">······</b></p><p id="phone-status" class="micro" role="status">Preparando…</p>
 <div class="phone-actions"><button id="phone-new">Nuevo código</button><button id="phone-local" hidden>Usar este dispositivo como sonda</button><button id="phone-stop" hidden>Desconectar</button></div>
 <p class="micro">El teléfono solo envía su orientación y los toques del panel, directamente a este navegador (WebRTC). El servidor público de PeerJS solo presenta ambos dispositivos. El teléfono no sabe dónde está sobre el tórax: el deslizamiento se hace con el panel, las flechas o arrastrando en la vista 01.</p></div></div>`;
 document.body.append(dialog);
 const bar=document.createElement('div');bar.className='phone-bar';bar.hidden=true;bar.innerHTML='<span id="phone-bar-text">Sonda: teléfono</span><button id="phone-bar-cal">Calibrar</button><button id="phone-bar-stop">Detener</button>';document.body.append(bar);
 const $=id=>document.getElementById(id);
 let code=null,peer=null,conn=null,q=null,cal=null,local=false,infoTimer=0;
 const setStatus=t=>{$('phone-status').textContent=t};
 function showBar(text){bar.hidden=false;$('phone-bar-text').textContent=text}
 function calibrate(){if(!q){cal=null;return}cal={R:matrixFromQuat(q),base:poseFromState(api.state())};api.status('Sonda del teléfono calibrada: su posición actual es la del corte en pantalla')}
 // one message from the phone (or from this device's own sensors)
 function receive(m){if(!m||!api.ready())return;
  switch(m.t){
   case 'o':{const qn=quatFromMatrix(deviceMatrix(m.a,m.b,m.g));q=q?slerp(q,qn,.4):qn;if(!cal){calibrate();return}
    const ax=relativeAxes(cal.R,matrixFromQuat(q),cal.base);api.applyAngles(anglesFromAxes(api.state().preset,ax.d,ax.u));break}
   case 'cal':calibrate();break;
   case 'win':api.preset(m.preset);cal=null;break; // the phone's attitude at the next sample becomes the window's start
   case 'slide':api.slide(m.dx||0,m.dz||0);break;
   case 'freeze':api.freeze();break;
   case 'hello':setStatus('Teléfono conectado');break;
  }}
 function stopAll(){conn?.close();conn=null;stopLocal();bar.hidden=true;cal=null;q=null;clearInterval(infoTimer);$('phone-stop').hidden=true;document.getElementById('phone-probe')?.classList.remove('active')}
 async function startPeer(){
  code=newCode();$('phone-code').textContent=code;const url=new URL('sonda.html#'+code,location.href).href;$('phone-link').href=url;$('phone-link').textContent=new URL('sonda.html',location.href).href;
  const qr=qrcode(0,'M');qr.addData(url);qr.make();$('phone-qr').innerHTML=qr.createSvgTag({cellSize:5,margin:3,scalable:true});
  if(!/^https:|^http:\/\/localhost|^http:\/\/127\./.test(location.href))setStatus('Aviso: el teléfono necesita abrir la página por https:// para usar los sensores.');
  try{const P=await loadPeerJS();peer?.destroy();setStatus('Esperando al teléfono…');peer=new P.Peer(PREFIX+code);
   peer.on('connection',c=>{conn?.close();conn=c;c.on('open',()=>{setStatus('Teléfono conectado · calibra en la ventana');$('phone-stop').hidden=false;showBar('Sonda: teléfono conectado');document.getElementById('phone-probe')?.classList.add('active');clearInterval(infoTimer);infoTimer=setInterval(()=>{if(c.open)c.send({t:'info',text:api.info()})},700)});c.on('data',receive);c.on('close',()=>{if(conn===c){conn=null;setStatus('El teléfono se desconectó');bar.hidden=!local;clearInterval(infoTimer);document.getElementById('phone-probe')?.classList.remove('active')}})});
   peer.on('error',e=>{if(e.type==='unavailable-id'){startPeer();return}setStatus(e.type==='network'||e.type==='server-error'||e.type==='socket-error'?'No se pudo contactar el servidor de emparejamiento (PeerJS). Revisa la conexión a internet.':'Error de conexión: '+(e.type||e.message))});
  }catch(e){setStatus(e.message)}
 }
 // this device's own sensors (a phone or tablet running the simulator itself)
 const onLocal=e=>{if(e.alpha!=null||e.beta!=null)receive({t:'o',a:e.alpha,b:e.beta,g:e.gamma})};
 async function startLocal(){const D=globalThis.DeviceOrientationEvent;try{if(typeof D?.requestPermission==='function'&&await D.requestPermission()!=='granted')throw Error('Sin permiso para los sensores de movimiento')}catch(e){setStatus(e.message);return}
  local=true;cal=null;q=null;addEventListener('deviceorientation',onLocal);dialog.close();showBar('Sonda: este dispositivo');api.status('Mueve el dispositivo como una sonda; pulsa Calibrar para fijar la posición de partida')}
 function stopLocal(){if(!local)return;local=false;removeEventListener('deviceorientation',onLocal)}
 $('phone-close').onclick=()=>dialog.close();$('phone-new').onclick=startPeer;$('phone-local').onclick=startLocal;$('phone-stop').onclick=stopAll;
 $('phone-bar-cal').onclick=calibrate;$('phone-bar-stop').onclick=stopAll;
 $('phone-local').hidden=!('DeviceOrientationEvent' in window&&matchMedia('(pointer:coarse)').matches);
 function open(){dialog.showModal();if(!peer||peer.destroyed||peer.disconnected&&!conn)startPeer()}
 return {open,receive,get connected(){return !!conn?.open||local},get calibrated(){return !!cal}};
}
