import {tgcGain} from './instrument.mjs';
import {frameIndex} from './reference-clips.mjs';

// Digital processing of an exported image, not raw ultrasound/RF reconstruction.
// TGC bands follow image height from the original vertex side, not calibrated cm.
export function applyVideoTone(image,{gain=1,contrast=1,tgc=Array(8).fill(50),vertexBelow=false}){
 if(gain===1&&contrast===1&&tgc.every(v=>v===50))return image;
 const curve=Array.from({length:256},(_,v)=>255*(v/255)**contrast),a=image.data;
 for(let y=0;y<image.height;y++){
  const fraction=y/Math.max(1,image.height-1),g=gain*tgcGain(tgc,vertexBelow?1-fraction:fraction);
  for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4;for(let c=0;c<3;c++)a[i+c]=Math.min(255,curve[a[i+c]]*g)}
 }
 return image;
}

export function mountVideoImage(api){
 const $=id=>document.getElementById(id),video=api.references.video,buffer=document.createElement('canvas'),bc=buffer.getContext('2d',{willReadFrequently:true});
 let mediaTime=0,paintedFrames=0,shown=null,lastUI='',lastTime=-1;
 const clip=()=>api.references.clip();
 const index=()=>clip()?frameIndex(mediaTime,clip()):0;
 function update(){
  const s=api.snapshot(),c=clip(),loaded=video.readyState>=2&&!video.seeking;
  $('video-controls').hidden=!s.real;
  $('echo-source').hidden=s.mode!=='echo';
  const list=api.references.clips();if($('echo-clip').options.length!==list.length)$('echo-clip').replaceChildren(...list.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.label;return o}));
  if(c){$('echo-clip').value=c.id;$('echo-frame').max=c.frames-1;$('echo-frame').value=index()}
  for(const id of ['echo-play','echo-prev','echo-next','echo-frame','echo-speed'])$(id).disabled=!loaded;
  $('echo-clip').disabled=!list.length;
  $('echo-play').textContent=video.paused?'▶ Reproducir':'Ⅱ Pausar';$('echo-speed').value=String(video.playbackRate);
  $('echo-time').textContent=c?`${index()+1} / ${c.frames} cuadros · ${mediaTime.toFixed(2)} s`: 'Cargando clips…';
  $('scan-title').textContent=s.real?'Eco real · imagen ajustable':s.sim?'Eco simulado del mismo plano':'Imagen del mismo plano';
  $('scan-foot').textContent=s.real?'Clip real con ajustes digitales · no está registrado al atlas.':s.sim?'Pulsa la imagen para localizar el punto en 3D · activa «Contornos» para ver qué estructura es':'Pulsa un contorno: identifica la estructura en 2D y 3D';
  if(s.real){$('empty-scan').hidden=true;$('depth-readout').textContent='Vídeo';$('orientation-note').textContent='Vídeo: orientación original';}
 }
 function changed(){mediaTime=video.currentTime;update();if(api.snapshot().real)api.redraw()}
 for(const e of ['loadeddata','seeked','pause','play','ratechange','emptied','error'])video.addEventListener(e,changed);
 if(video.requestVideoFrameCallback){const frame=(_,metadata)=>{mediaTime=metadata.mediaTime;update();if(api.snapshot().real)api.redraw();video.requestVideoFrameCallback(frame)};video.requestVideoFrameCallback(frame)}
 $('echo-clip').onchange=e=>api.references.choose(e.target.value);
 $('echo-prev').onclick=()=>api.references.seek(index()-1);$('echo-next').onclick=()=>api.references.seek(index()+1);
 $('echo-frame').oninput=e=>api.references.seek(Number(e.target.value));
 $('echo-play').onclick=()=>{if(video.paused){api.resume();video.play().catch(()=>{$('echo-time').textContent='No se pudo reproducir el clip.'})}else video.pause()};
 $('echo-speed').onchange=e=>{video.playbackRate=Number(e.target.value);$('reference-speed').value=e.target.value};
 function tick(){const key=JSON.stringify([api.snapshot(),clip()?.id,video.readyState,video.seeking]);if(key!==lastUI){lastUI=key;update();if(api.snapshot().real)api.redraw()}if(!video.requestVideoFrameCallback&&video.currentTime!==lastTime){lastTime=video.currentTime;changed()}}
 function paint(ctx,w,h,settings){
  const c=clip();shown=null;
  ctx.save();ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
  if(!c||video.readyState<2||video.seeking){ctx.fillStyle='#a9b9c3';ctx.font='12px Segoe UI';ctx.fillText(video.error?'No se pudo abrir el clip. Elige otro.':'Preparando fotograma…',12,h/2);ctx.restore();return}
  const fit=Math.min(w/video.videoWidth,(h-40)/video.videoHeight),bw=Math.max(1,Math.round(video.videoWidth*fit)),bh=Math.max(1,Math.round(video.videoHeight*fit));
  // Process a fitted frame; the unmodified HTMLVideoElement remains the comparator.
  if(buffer.width!==bw||buffer.height!==bh){buffer.width=bw;buffer.height=bh}
  bc.drawImage(video,0,0,bw,bh);
  const raster=bc.getImageData(0,0,bw,bh);applyVideoTone(raster,{...settings,vertexBelow:['apical','subcostal'].includes(c.preset)});bc.putImageData(raster,0,0);
  const dw=bw*settings.zoom,dh=bh*settings.zoom;
  ctx.save();ctx.beginPath();ctx.rect(0,23,w,h-43);ctx.clip();ctx.drawImage(buffer,(w-dw)/2,(h-dh)/2,dw,dh);ctx.restore();
  ctx.fillStyle='#b7d9d1';ctx.font='10px Segoe UI';ctx.fillText('CLIP REAL · AJUSTES DIGITALES',10,15);
  ctx.fillStyle='#9fb2c0';ctx.font='10px Consolas';ctx.fillText(`Cuadro ${index()+1}/${c.frames} · G ${settings.gain.toFixed(1)}× · Z ${settings.zoom.toFixed(1)}×`,10,h-8);
  shown={clipId:c.id,frame:index(),mediaTime,sourceSHA256:c.sha256};paintedFrames++;ctx.restore();
 }
 return {update,tick,paint,snapshot:()=>({source:api.snapshot().real?'real-video':'atlas',shown,paintedFrames}),metadata:()=>({clipId:clip()?.id,sourceSHA256:clip()?.sha256,playbackSHA256:clip()?.playbackSHA256,timeline:'Playback timestamps rebuilt from exported frame rate; decoded source frames unchanged',currentTime:mediaTime,frame:index(),patientRegistration:false,processing:'Digital gain, contrast, image-height TGC and display zoom; native orientation; no reacquisition',tgcDepth:'Approximate image-height bands from original vertex side; not calibrated physical depth',shown})};
}
