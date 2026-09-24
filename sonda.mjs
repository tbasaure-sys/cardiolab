// Phone page: the phone becomes the probe of a CardioLab session open on a computer. It sends its orientation
// (deviceorientation), slides from the touch pad, window choices, calibration and freeze over a WebRTC data channel.
// Two transports are tried at once: the direct WebRTC link and the relay (public MQTT brokers over secure WebSockets).
// The phone reports "connected" only when the computer answers; the direct link is preferred when it opens.
import {relayGroup,ICE_SERVERS} from './relay.mjs';
const $=id=>document.getElementById(id),PREFIX='cardiolab-';
const clean=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,6);
let peer=null,conn=null,relay=null,acked=false,via=null,code='',last=0,got=false,wake=null,helloTimer=0,giveUp=0,lastDown=0,watch=0;
$('code').value=clean(location.hash.slice(1));
const status=t=>$('status').textContent=t;
const send=m=>{if(conn?.open)conn.send(m);else if(acked)relay?.send(m)};

async function sensorPermission(){ // iOS asks once, from a tap
 const D=globalThis.DeviceOrientationEvent;if(!D)throw Error('Este navegador no da acceso a la orientación del teléfono.');
 if(typeof D.requestPermission==='function'&&await D.requestPermission()!=='granted')throw Error('Sin permiso para usar los sensores de orientación.');
}
function fromComputer(m){lastDown=performance.now();if(m?.t==='info')$('info').textContent=m.text}
function connected(kind){
 if(via==='webrtc'&&kind==='relay')return;const first=!via;via=kind;clearTimeout(giveUp);clearInterval(helloTimer);lastDown=performance.now();
 $('via').textContent=kind==='webrtc'?'Conexión directa':'Conexión por relé · tu red no permite la conexión directa; puede ir con algo de retraso';
 if(!first)return;$('pair').hidden=true;$('probe').hidden=false;send({t:'hello'});navigator.wakeLock?.request('screen').then(w=>wake=w).catch(()=>{});
 setTimeout(()=>{if(!got)$('info').textContent='El teléfono no envía orientación. Prueba con Chrome o Safari y revisa los permisos de movimiento.'},2000);
 clearInterval(watch);watch=setInterval(()=>{if(via&&performance.now()-lastDown>6000)$('info').textContent='Sin respuesta del ordenador. ¿Sigue abierta la ventana «Sonda: teléfono»?'},2000);
}
function stop(){clearInterval(helloTimer);clearTimeout(giveUp);clearInterval(watch);try{conn?.close()}catch{}try{peer?.destroy()}catch{}relay?.close();conn=peer=relay=null;acked=false;via=null;wake?.release?.()}
function fail(){stop();$('connect').textContent='Reintentar';
 status(`No se encontró el ordenador con el código «${code}». Comprueba que en el ordenador esté abierta la ventana «Sonda: teléfono» con ese mismo código y que ambos dispositivos tengan internet. Si estás en una red de hospital o universidad, prueba con los datos móviles del teléfono.`)}
$('connect').onclick=async()=>{
 code=clean($('code').value);if(code.length!==6){status('El código tiene 6 caracteres.');return}
 if(!window.isSecureContext){status('Abre esta página con https:// para usar los sensores.');return}
 try{await sensorPermission()}catch(e){status(e.message);return}
 stop();status('Buscando el ordenador…');
 relay=relayGroup({code,role:'phone',onMessage:m=>{if(m?.t==='ack'){acked=true;connected('relay')}else fromComputer(m)}});
 helloTimer=setInterval(()=>{if(!acked)relay?.send({t:'hello'})},1000);
 if(window.peerjs){peer=new peerjs.Peer({config:{iceServers:ICE_SERVERS}});
  peer.on('open',()=>{const c=peer.connect(PREFIX+code,{serialization:'json'});conn=c;
   c.on('open',()=>connected('webrtc'));c.on('data',fromComputer);
   const lost=()=>{if(conn!==c)return;conn=null;if(via==='webrtc'){if(acked){via='relay';$('via').textContent='Conexión por relé'}else{$('probe').hidden=true;$('pair').hidden=false;via=null;status('Conexión cerrada. Vuelve a conectar.')}}};
   c.on('error',lost);c.on('close',lost)});
  peer.on('error',()=>{}); // the relay may still connect; failure is reported by the timeout
 }
 giveUp=setTimeout(()=>{if(!via)fail()},15000);
};
addEventListener('deviceorientation',e=>{
 if(e.alpha==null&&e.beta==null)return;got=true;const now=performance.now();
 if(now-last>=(via==='webrtc'?33:66)){last=now;send({t:'o',a:e.alpha,b:e.beta,g:e.gamma})}
 $('angles').textContent=`α ${Math.round(e.alpha)}° · β ${Math.round(e.beta)}° · γ ${Math.round(e.gamma)}°`;
});
$('calibrate').onclick=()=>{send({t:'cal'});navigator.vibrate?.(30)};
document.querySelectorAll('[data-win]').forEach(b=>b.onclick=()=>{send({t:'win',preset:b.dataset.win});navigator.vibrate?.(20)});
$('freeze').onclick=()=>send({t:'freeze'});
$('disconnect').onclick=()=>{stop();$('probe').hidden=true;$('pair').hidden=false;status('Desconectado.')};
// slide pad: 4 px per millimetre; up = toward the head, right = toward the patient's left
{const pad=$('pad');let p=null,acc=[0,0],timer=0;const flush=()=>{timer=0;if(acc[0]||acc[1]){send({t:'slide',dx:acc[0]*.00025,dz:-acc[1]*.00025});acc=[0,0]}};
 pad.onpointerdown=e=>{p=[e.clientX,e.clientY];pad.setPointerCapture(e.pointerId);pad.classList.add('active')};
 pad.onpointermove=e=>{if(!p)return;acc[0]+=e.clientX-p[0];acc[1]+=e.clientY-p[1];p=[e.clientX,e.clientY];if(!timer)timer=setTimeout(flush,50)};
 for(const n of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(n,()=>{p=null;pad.classList.remove('active')});}
