export function frameTime(frame,clip){const i=Math.max(0,Math.min(clip.frames-1,Math.round(frame)));if(!clip.frameTimes)return (i+.5)/clip.fps;const start=clip.frameTimes[i],end=clip.frameTimes[i+1]??clip.playbackDuration??clip.duration;return Math.max(start,(start+end)/2)}
export function frameIndex(time,clip){if(!clip.frameTimes)return Math.max(0,Math.min(clip.frames-1,Math.floor(time*clip.fps+1e-5)));let lo=0,hi=clip.frameTimes.length;while(lo<hi){const mid=(lo+hi)>>1;if(clip.frameTimes[mid]<=time+1e-6)lo=mid+1;else hi=mid}return Math.max(0,lo-1)}
export function mountReferenceClips(api){
 const $=id=>document.getElementById(id),video=$('reference-video');let clips=[],selected=null,opened=false,lastPreset=null,failed=false;
 function time(){if(!selected)return;const frame=frameIndex(video.currentTime,selected);$('reference-frame').value=frame;$('reference-time').textContent=`${frame+1} / ${selected.frames} · ${video.currentTime.toFixed(2)} / ${selected.duration.toFixed(2)} s`;}
 function seek(frame){if(!selected||video.readyState<1)return;video.pause();video.currentTime=frameTime(frame,selected);time()}
 function choose(id){const clip=clips.find(c=>c.id===id);if(!clip)return;selected=clip;failed=false;video.pause();video.src=clip.playbackFile||clip.file;video.load();$('reference-select').value=id;$('reference-frame').max=clip.frames-1;$('reference-frame').value=0;$('reference-label').textContent=clip.label;$('reference-meta').textContent=`${clip.width} × ${clip.height} · ${clip.fps.toFixed(1)} fps · ${clip.duration.toFixed(2)} s`;$('reference-download').href=clip.file;$('reference-download').download=clip.downloadName;$('reference-message').textContent='Cargando clip…';update(api.snapshot());time()}
 function update(s){if(!s)return;const preset=s.active?.preset||s.state?.preset;
  if(preset!==lastPreset){lastPreset=preset;if(clips.length&&$('reference-follow').checked){const match=clips.find(c=>c.preset===preset);if(match&&match.id!==selected?.id)choose(match.id)}}
  $('reference-compare').disabled=!s.ready||s.frozen||!selected;
  $('reference-link-note').textContent=selected&&selected.preset!==preset?'El clip y el atlas muestran ventanas distintas. Puedes llevar el atlas a la ventana aproximada del clip.':'Comparación por ventana · sin registro espacial ni sincronización del latido con el atlas.';
 }
 $('reference-toggle').onclick=()=>{opened=!opened;$('reference-panel').hidden=!opened;document.querySelector('.workspace').classList.toggle('with-reference',opened);$('reference-toggle').setAttribute('aria-expanded',String(opened));$('reference-toggle').textContent=opened?'Ocultar clips reales':`Clips reales · ${clips.length}`;if(!opened&&!api.usingVideo?.())video.pause();update(api.snapshot())};
 $('reference-select').onchange=e=>{$('reference-follow').checked=false;choose(e.target.value)};
 $('reference-follow').onchange=()=>{if($('reference-follow').checked){lastPreset=null;update(api.snapshot())}};
 $('reference-compare').onclick=()=>{if(selected)api.preset(selected.preset)};
 $('reference-speed').onchange=e=>video.playbackRate=Number(e.target.value);
 $('reference-frame').oninput=e=>seek(Number(e.target.value));$('reference-prev').onclick=()=>seek(frameIndex(video.currentTime,selected)-1);$('reference-next').onclick=()=>seek(frameIndex(video.currentTime,selected)+1);
 video.addEventListener('loadedmetadata',()=>{video.playbackRate=Number($('reference-speed').value);$('reference-message').textContent='Clip adquirido · controles independientes de la simulación';for(const id of ['reference-prev','reference-next','reference-frame','reference-speed'])$(id).disabled=false;time()});
 video.addEventListener('loadstart',()=>{for(const id of ['reference-prev','reference-next','reference-frame','reference-speed'])$(id).disabled=true});
 video.addEventListener('error',()=>{failed=true;$('reference-message').textContent='No se pudo abrir este clip. Elige otro o descarga el MP4.';for(const id of ['reference-prev','reference-next','reference-frame','reference-speed'])$(id).disabled=true});
 for(const event of ['timeupdate','seeked','pause'])video.addEventListener(event,time);
 (globalThis.CARDIOLAB_PUBLIC?Promise.reject(Error('public build: no clips')):fetch('assets/clips/manifest.json')).then(r=>{if(!r.ok)throw Error('manifest');return r.json()}).then(data=>{
  clips=data.clips;$('reference-select').replaceChildren(...clips.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.label;return o}));$('reference-toggle').disabled=false;$('reference-toggle').textContent=`Clips reales · ${clips.length}`;lastPreset=null;update(api.snapshot());if(!selected&&clips.length)choose(clips[0].id);
 }).catch(()=>{$('reference-toggle').textContent='Clips no disponibles';$('reference-toggle').disabled=true});
 return {update,video,clip:()=>selected,clips:()=>clips,seek,choose:id=>{$('reference-follow').checked=false;choose(id)},snapshot:()=>({opened,selected:selected?.id,preset:selected?.preset,loaded:video.readyState>=2,paused:video.paused,currentTime:video.currentTime,failed,count:clips.length})};
}
