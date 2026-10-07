// Micro-lesson export: from a lesson specification and a seed, render the deterministic timeline (lesson-engine seek)
// frame by frame — never from the wall clock — and package video (WebM, captions burned in), WebVTT subtitles, scene
// sheet (PNG), checklist, sources and timeline (JSON) in one ZIP. The same spec, seed and time give the same frame; the
// export checks it by rendering one keyframe twice and comparing hashes. The layout is recomposed per format (16:9, 9:16).
import {compileLesson,seek,keyframes,toWebVTT,checklist,sourcesFor} from './lesson-engine.mjs';
import {CINE_PHASES} from './sim-engine.mjs';

const FPS=10;
const STAGE_NAMES={orientar:'Orientar',mover:'Mover',confirmar:'Confirmar',optimizar:'Optimizar',rescatar:'Rescatar',evidencia:'Evidencia'};
const LAYOUTS={
 '16:9':{w:1280,h:720,title:[32,46,26],echo:[24,72,800,474],plane:[848,72,408,230],probe:[848,316,408,230],caption:[24,558,1232,150,20]},
 '9:16':{w:720,h:1280,title:[28,58,30],echo:[16,90,688,600],plane:[16,708,340,250],probe:[364,708,340,250],caption:[16,976,688,280,27]}
};
function wrap(g,text,maxW){const out=[];let line='';for(const word of String(text).split(/\s+/)){const t=line?line+' '+word:word;if(g.measureText(t).width>maxW&&line){out.push(line);line=word}else line=t}if(line)out.push(line);return out}
function fit(g,src,[x,y,w,h]){const s=Math.min(w/src.width,h/src.height),dw=src.width*s,dh=src.height*s;g.drawImage(src,x+(w-dw)/2,y+(h-dh)/2,dw,dh)}
const quantPhase=p=>(Math.floor((((p%1)+1)%1)*CINE_PHASES)+.5)/CINE_PHASES;

// ---------------------------------------------------------------- one frame of the lesson at time t
export function createRenderer({api,spec,compiled,format}){
 const L=LAYOUTS[format],canvas=document.createElement('canvas');canvas.width=L.w;canvas.height=L.h;const g=canvas.getContext('2d');
 const echoCache=new Map(),views={plane:document.createElement('canvas'),probe:document.createElement('canvas')};let viewsKey=null,variantKey=null,colorKey=null;
 async function frame(t){
  const s=seek(compiled,t),stKey=JSON.stringify(s.state);
  const vk=JSON.stringify(s.variant||{id:'normal'});if(vk!==variantKey){variantKey=vk;await api.setVariant(s.variant||{id:'normal'});echoCache.clear()}
  if(stKey!==viewsKey){viewsKey=stKey;api.apply(s.state);await api.waitApplied();const [probe,plane]=api.renderViews(L.plane[2],L.plane[3]),c={probe,plane};for(const k of ['plane','probe']){views[k].width=c[k].width;views[k].height=c[k].height;views[k].getContext('2d').drawImage(c[k],0,0)}colorKey=null}
  // the colour box is placed around its landmark in the current plane, so it follows the probe state
  const ck=stKey+JSON.stringify(s.color||null);if(ck!==colorKey){colorKey=ck;api.color(s.color);for(const k of [...echoCache.keys()])if(k.startsWith(stKey))echoCache.delete(k)}
  const ph=quantPhase(s.phase),ek=stKey+'|'+ph;let echo=echoCache.get(ek);
  if(!echo){echo=await api.renderEcho(s.state,ph,L.echo[2],L.echo[3]);if(echoCache.size>CINE_PHASES*3)echoCache.clear();echoCache.set(ek,echo)}
  g.fillStyle='#0a1118';g.fillRect(0,0,L.w,L.h);
  g.fillStyle='#dcf3ee';g.font=`600 ${L.title[2]}px Segoe UI, sans-serif`;g.textAlign='left';g.fillText(wrap(g,spec.title,L.w-2*L.title[0])[0],L.title[0],L.title[1]);
  g.fillStyle='#05080b';g.fillRect(...L.echo);g.drawImage(echo,L.echo[0],L.echo[1]);
  g.fillStyle='#8fa3b0';g.font='13px Segoe UI, sans-serif';g.fillText(`${STAGE_NAMES[s.stage]} · ${s.title}`,L.echo[0]+10,L.echo[1]+L.echo[3]-12);
  g.fillText('ECO SIMULADO · ATLAS · NO DIAGNÓSTICO',L.echo[0]+10,L.echo[1]+18);
  for(const k of ['plane','probe']){g.fillStyle='#0f171e';g.fillRect(...L[k]);if(views[k].width)fit(g,views[k],L[k]);g.fillStyle='#b0c2cc';g.font='13px Segoe UI, sans-serif';g.fillText(k==='plane'?'Plano en el corazón':'Sonda y marcador',L[k][0]+8,L[k][1]+18)}
  if(s.maneuver&&s.moving){g.fillStyle='#ffd166';g.font='600 16px Segoe UI, sans-serif';g.fillText(`${s.maneuver.verb[0].toUpperCase()+s.maneuver.verb.slice(1)} ${s.maneuver.direction} ~${s.maneuver.amount}${s.maneuver.verb==='deslizar'?' mm':'°'}`,L.probe[0]+8,L.probe[1]+L.probe[3]-12)}
  // caption / staged question and answer
  const [cx,cy,cw,chh,fs]=L.caption,o=s.overlay;g.fillStyle='rgba(13,22,29,.96)';g.fillRect(cx,cy,cw,chh);g.font=`${fs}px Segoe UI, sans-serif`;
  let lines;if(o?.kind==='predict'||o?.kind==='confirm'){g.fillStyle='#ffd166';lines=[(o.kind==='predict'?'Predice: ':'Confirma: ')+o.prompt,...o.options.map((x,i)=>`${'abc'[i]||'·'}) ${x}`)]}
  else if(o?.kind==='answer'){g.fillStyle='#63ddc8';lines=['→ '+o.text]}else{g.fillStyle='#eaf6f3';lines=[s.caption]}
  const maxLines=Math.max(1,Math.floor((chh-8)/(fs*1.25)));const wrapped=lines.flatMap(l=>wrap(g,l,cw-24)).slice(0,maxLines);wrapped.forEach((l,i)=>g.fillText(l,cx+12,cy+fs*1.1+i*fs*1.25));
  return {canvas,state:s};
 }
 return {frame,canvas,layout:L};
}

// ---------------------------------------------------------------- WebM (Matroska) muxer for WebCodecs chunks
const enc=new TextEncoder();
function vint(n,len){const b=new Uint8Array(len);for(let i=len-1;i>=0;i--){b[i]=n&255;n=Math.floor(n/256)}b[0]|=1<<(8-len);return b}
function uint(n){const a=[];do{a.unshift(n&255);n=Math.floor(n/256)}while(n>0);return new Uint8Array(a)}
function el(id,data){const parts=Array.isArray(data)?data:[data];const size=parts.reduce((a,p)=>a+p.length,0);const idb=new Uint8Array(id.length/2).map((_,i)=>parseInt(id.substr(i*2,2),16));return concat([idb,vint(size,8),...parts])}
function f64(x){const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,x);return b}
function concat(arr){const n=arr.reduce((a,p)=>a+p.length,0),o=new Uint8Array(n);let k=0;for(const p of arr){o.set(p,k);k+=p.length}return o}
export function muxWebM(chunks,{width,height,codec,durationMs}){
 const header=el('1A45DFA3',[el('4286',uint(1)),el('42F7',uint(1)),el('42F2',uint(4)),el('42F3',uint(8)),el('4282',enc.encode('webm')),el('4287',uint(2)),el('4285',uint(2))]);
 const info=el('1549A966',[el('2AD7B1',uint(1e6)),el('4489',f64(durationMs)),el('4D80',enc.encode('CardioLab')),el('5741',enc.encode('CardioLab lesson-export'))]);
 const tracks=el('1654AE6B',el('AE',[el('D7',uint(1)),el('73C5',uint(1)),el('83',uint(1)),el('86',enc.encode(codec)),el('E0',[el('B0',uint(width)),el('BA',uint(height))])]));
 const clusters=[];let i=0;while(i<chunks.length){const t0=chunks[i].ms;const blocks=[];while(i<chunks.length&&chunks[i].ms-t0<4000&&(blocks.length===0||!chunks[i].key)){const c=chunks[i];const rel=c.ms-t0;blocks.push(el('A3',[new Uint8Array([0x81,(rel>>8)&255,rel&255,c.key?0x80:0]),c.data]));i++}
  clusters.push(el('1F43B675',[el('E7',uint(t0)),...blocks]))}
 return new Blob([header,el('18538067',[info,tracks,...clusters])],{type:'video/webm'});
}
async function encodeVideo(renderer,compiled,status){
 if(!window.VideoEncoder)return {blob:null,reason:'Este navegador no tiene WebCodecs (VideoEncoder): usa Chrome o Edge actualizados para el vídeo; el resto del paquete se exporta igual.'};
 const {w,h}=renderer.layout;let config=null,codec=null;
 for(const [c,mk] of [['vp8','V_VP8'],['vp09.00.10.08','V_VP9']]){const cfg={codec:c,width:w,height:h,bitrate:2_500_000,framerate:FPS};try{if((await VideoEncoder.isConfigSupported(cfg)).supported){config=cfg;codec=mk;break}}catch{}}
 if(!config)return {blob:null,reason:'El codificador VP8/VP9 no está disponible en este navegador.'};
 const chunks=[];let err=null;const encoder=new VideoEncoder({output:c=>{const d=new Uint8Array(c.byteLength);c.copyTo(d);chunks.push({ms:Math.round(c.timestamp/1000),key:c.type==='key',data:d})},error:e=>{err=e}});encoder.configure(config);
 const n=Math.ceil(compiled.duration*FPS);
 for(let k=0;k<n;k++){const t=k/FPS;const {canvas}=await renderer.frame(t);const vf=new VideoFrame(canvas,{timestamp:Math.round(t*1e6),duration:Math.round(1e6/FPS)});encoder.encode(vf,{keyFrame:k%(FPS*2)===0});vf.close();
  if(err)throw err;if(k%10===0)status(`Vídeo: cuadro ${k+1} / ${n}`);while(encoder.encodeQueueSize>4)await new Promise(r=>setTimeout(r,5))}
 await encoder.flush();encoder.close();if(err)throw err;
 return {blob:muxWebM(chunks,{width:w,height:h,codec,durationMs:compiled.duration*1000}),frames:n,codec};
}

// ---------------------------------------------------------------- scene sheet
async function sceneSheet(renderer,compiled,spec,format){
 const kf=keyframes(compiled),cols=format==='9:16'?3:3,tw=format==='9:16'?240:400,th=Math.round(tw*renderer.layout.h/renderer.layout.w),rows=Math.ceil(kf.length/cols),pad=16,textH=format==='9:16'?110:96;
 const c=document.createElement('canvas');c.width=cols*(tw+pad)+pad;c.height=70+rows*(th+textH+pad);const g=c.getContext('2d');g.fillStyle='#f6f3ec';g.fillRect(0,0,c.width,c.height);
 g.fillStyle='#1b2a33';g.font='600 22px Segoe UI, sans-serif';g.fillText(`Lámina de escenas · ${spec.title}`,pad,34);g.font='13px Segoe UI, sans-serif';g.fillStyle='#4a5a64';g.fillText(`${spec.id} v${spec.version||1} · semilla ${compiled.seed} · ${compiled.duration.toFixed(1)} s`,pad,56);
 for(let i=0;i<kf.length;i++){const {canvas,state}=await renderer.frame(kf[i].t);const x=pad+(i%cols)*(tw+pad),y=70+Math.floor(i/cols)*(th+textH+pad);g.drawImage(canvas,x,y,tw,th);
  g.fillStyle='#1b2a33';g.font='600 13px Segoe UI, sans-serif';g.fillText(`${i+1}. ${STAGE_NAMES[kf[i].stage]} · ${kf[i].title}`.slice(0,60),x,y+th+18);g.font='11px Segoe UI, sans-serif';g.fillStyle='#4a5a64';
  wrap(g,state.caption,tw).slice(0,Math.floor((textH-30)/14)).forEach((l,j)=>g.fillText(l,x,y+th+34+j*14))}
 return new Promise(r=>c.toBlob(r,'image/png'));
}

// ---------------------------------------------------------------- ZIP (stored) and hashing
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
export function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
export async function zip(files){const parts=[],central=[];let off=0;
 for(const f of files){const data=new Uint8Array(await f.blob.arrayBuffer()),name=enc.encode(f.name),crc=crc32(data);
  const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint32(14,crc,true);lh.setUint32(18,data.length,true);lh.setUint32(22,data.length,true);lh.setUint16(26,name.length,true);
  parts.push(new Uint8Array(lh.buffer),name,data);
  const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint32(16,crc,true);ch.setUint32(20,data.length,true);ch.setUint32(24,data.length,true);ch.setUint16(28,name.length,true);ch.setUint32(42,off,true);
  central.push(new Uint8Array(ch.buffer),name);off+=30+name.length+data.length}
 const cs=central.reduce((a,p)=>a+p.length,0),end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,cs,true);end.setUint32(16,off,true);
 return new Blob([...parts,...central,new Uint8Array(end.buffer)],{type:'application/zip'})}
async function hashCanvas(c){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const h=await crypto.subtle.digest('SHA-256',d);return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}

// ---------------------------------------------------------------- entry point
export async function exportMicroLesson({api,spec,ctx,seed,format='16:9',sources,status=()=>{}}){
 const compiled=compileLesson(spec,ctx,{seed}),renderer=createRenderer({api,spec,compiled,format});
 const warnings=[];if(compiled.scenes.some(x=>x.doppler))warnings.push('El vídeo muestra el 2D y el color; el espectro Doppler pulsado/continuo todavía no se incrusta en la exportación (sí en la demostración interactiva).');if(compiled.duration<60||compiled.duration>90)warnings.push(`Duración ${compiled.duration.toFixed(1)} s, fuera del rango 60–90 s de una microlección.`);
 api.lockPhase(0);api.setCaption(null);api.resetCameras?.(); // 3D views from their default cameras: the frame does not depend on how the user left them
 try{
  // repeatability: the same time gives the same frame, also after rendering other times in between
  status('Comprobando la repetibilidad de los cuadros…');const kf=keyframes(compiled),probeT=kf[Math.min(1,kf.length-1)].t;
  const h1=await hashCanvas((await renderer.frame(probeT)).canvas);await renderer.frame(kf.at(-1).t);await renderer.frame(0);const h2=await hashCanvas((await renderer.frame(probeT)).canvas);
  const repeat={t:probeT,hashA:h1,hashB:h2,identical:h1===h2};if(!repeat.identical)warnings.push('Dos renders del mismo instante no fueron idénticos.');
  status('Lámina de escenas…');const sheet=await sceneSheet(renderer,compiled,spec,format);
  status('Vídeo…');const video=await encodeVideo(renderer,compiled,status);if(!video.blob)warnings.push(video.reason);
  const base=`CardioLab_${spec.id}_s${seed}_${format.replace(':','x')}`;
  const timeline={schema:'cardiolab.lesson-timeline/1',lesson:spec.id,version:spec.version||1,caseId:compiled.caseId,seed,format,fps:FPS,duration:compiled.duration,cinePhases:CINE_PHASES,
   generator:'lesson-export.mjs (seek determinista, sin reloj)',repeatability:repeat,video:video.blob?{file:`${base}.webm`,codec:video.codec,frames:video.frames}:null,warnings,
   scenes:compiled.scenes.map(s=>({id:s.id,step:s.step,stage:s.stage,title:s.title,t0:s.t0,tMove0:s.tMove0,tMove1:s.tMove1,t1:s.t1,from:s.from,to:s.to,maneuver:s.maneuver,variant:s.variant,color:s.color,doppler:s.doppler,overlays:s.overlays}))};
  const files=[...(video.blob?[{name:`${base}.webm`,blob:video.blob}]:[]),{name:`${base}.vtt`,blob:new Blob([toWebVTT(compiled)],{type:'text/vtt'})},{name:`${base}_lamina.png`,blob:sheet},
   {name:`${base}_checklist.json`,blob:new Blob([JSON.stringify(checklist(spec),null,1)],{type:'application/json'})},{name:`${base}_fuentes.json`,blob:new Blob([JSON.stringify(sourcesFor(spec,sources),null,1)],{type:'application/json'})},
   {name:`${base}_timeline.json`,blob:new Blob([JSON.stringify(timeline,null,1)],{type:'application/json'})}];
  status('Empaquetando…');const z=await zip(files);api.download(z,`${base}.zip`);
  status(`Listo: ${files.length} archivos (${(z.size/1e6).toFixed(1)} MB)${warnings.length?' · '+warnings.join(' '):''}`);
  return {timeline,files:files.map(f=>({name:f.name,size:f.blob.size})),zipSize:z.size};
 }finally{api.lockPhase(null)}
}
