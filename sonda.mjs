// Phone page: the phone becomes the probe of a CardioLab session open on a computer. It sends its orientation
// (deviceorientation), slides from the touch pad, window choices, calibration and freeze over a WebRTC data channel.
const $=id=>document.getElementById(id),PREFIX='cardiolab-';
const clean=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,6);
let peer=null,conn=null,last=0,got=false,wake=null;
$('code').value=clean(location.hash.slice(1));
const status=t=>$('status').textContent=t;
const send=m=>{if(conn?.open)conn.send(m)};

async function sensorPermission(){ // iOS asks once, from a tap
 const D=globalThis.DeviceOrientationEvent;if(!D)throw Error('Este navegador no da acceso a la orientación del teléfono.');
 if(typeof D.requestPermission==='function'&&await D.requestPermission()!=='granted')throw Error('Sin permiso para usar los sensores de orientación.');
}
$('connect').onclick=async()=>{
 const code=clean($('code').value);if(code.length!==6){status('El código tiene 6 caracteres.');return}
 if(!window.isSecureContext){status('Abre esta página con https:// para usar los sensores.');return}
 try{await sensorPermission()}catch(e){status(e.message);return}
 if(!window.peerjs){status('No se pudo cargar la conexión (PeerJS).');return}
 status('Conectando…');peer?.destroy();peer=new peerjs.Peer();
 peer.on('open',()=>{conn=peer.connect(PREFIX+code,{serialization:'json'});
  conn.on('open',async()=>{$('pair').hidden=true;$('probe').hidden=false;send({t:'hello'});try{wake=await navigator.wakeLock?.request('screen')}catch{}
   setTimeout(()=>{if(!got)$('info').textContent='El teléfono no envía orientación. Prueba con Chrome o Safari y revisa los permisos de movimiento.'},2000)});
  conn.on('data',m=>{if(m?.t==='info')$('info').textContent=m.text});
  conn.on('close',()=>{$('probe').hidden=true;$('pair').hidden=false;status('Conexión cerrada. Vuelve a conectar.');wake?.release?.()})});
 peer.on('error',e=>status(e.type==='peer-unavailable'?'No hay ninguna sesión con ese código. Revisa el código en el ordenador.':e.type==='network'||e.type==='server-error'?'No se pudo contactar el servidor de emparejamiento.':'Error de conexión: '+(e.type||e.message)));
};
addEventListener('deviceorientation',e=>{
 if(e.alpha==null&&e.beta==null)return;got=true;const now=performance.now();
 if(now-last>=33){last=now;send({t:'o',a:e.alpha,b:e.beta,g:e.gamma})}
 $('angles').textContent=`α ${Math.round(e.alpha)}° · β ${Math.round(e.beta)}° · γ ${Math.round(e.gamma)}°`;
});
$('calibrate').onclick=()=>{send({t:'cal'});navigator.vibrate?.(30)};
document.querySelectorAll('[data-win]').forEach(b=>b.onclick=()=>{send({t:'win',preset:b.dataset.win});navigator.vibrate?.(20)});
$('freeze').onclick=()=>send({t:'freeze'});
$('disconnect').onclick=()=>{conn?.close();peer?.destroy()};
// slide pad: 4 px per millimetre; up = toward the head, right = toward the patient's left
{const pad=$('pad');let p=null,acc=[0,0],timer=0;const flush=()=>{timer=0;if(acc[0]||acc[1]){send({t:'slide',dx:acc[0]*.00025,dz:-acc[1]*.00025});acc=[0,0]}};
 pad.onpointerdown=e=>{p=[e.clientX,e.clientY];pad.setPointerCapture(e.pointerId);pad.classList.add('active')};
 pad.onpointermove=e=>{if(!p)return;acc[0]+=e.clientX-p[0];acc[1]+=e.clientY-p[1];p=[e.clientX,e.clientY];if(!timer)timer=setTimeout(flush,50)};
 for(const n of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(n,()=>{p=null;pad.classList.remove('active')});}
