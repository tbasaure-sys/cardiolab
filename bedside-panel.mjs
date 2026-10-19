// «Cabecera del paciente»: the bedside figure of the virtual patient — phonocardiogram with the murmur and the heart sounds
// (and the audio), ECG V1 and V6, pre- and postductal saturation with the screening verdict, the chest radiograph with the
// cardiothoracic ratio, and the list of findings with where each one comes from. Everything is computed from the study's state
// (bedside.mjs, cxr.mjs); nothing here is a separate model.
import {bedside,synthPhonocardiogram,SCREEN} from './bedside.mjs';
import {cxrPixels} from './cxr.mjs';
import {tag} from './provenance.mjs';
import {listen,stopListening,isListening,audioAvailable} from './audio.mjs';

const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1=v=>v.toFixed(1).replace('.',','),f2=v=>v.toFixed(2).replace('.',','),f0=v=>Math.round(v).toString();
const SR=4000,C={bg:'#05080b',grid:'#1b2730',text:'#9fb2bd',hi:'#e6edf2',accent:'#63ddc8',warm:'#ffb454',cool:'#7fb6ff',red:'#ff6b6b',green:'#2fe07a'};

export function mountBedside(api){
 // api: {figure, engine, patient(), hr(), onClose(), copyLink()}
 const {figure}=api;let last=null,wave=null,cxr=null,seq=0;
 figure.innerHTML=`<div class="st-head"><b id="bd-title">Cabecera del paciente</b><span id="bd-sub" class="micro"></span><button id="bd-link" title="Copia un enlace que abre esta cabecera con estos ajustes">Copiar enlace</button><button id="bd-close" aria-label="Cerrar la cabecera">✕</button></div>
  <div class="bd-grid">
   <figure class="bd-wide"><figcaption id="bd-cap-pcg">Fonocardiograma y ECG</figcaption><canvas id="bd-pcg"></canvas>
    <div class="bd-tools"><button id="bd-listen" ${audioAvailable()?'':'disabled'}>🔊 Auscultar</button><span class="micro" id="bd-sound-note">Sonido sintetizado del modelo; mejor con auriculares. Es esquemático: enseña asociaciones, no sustituye la auscultación real.</span></div></figure>
   <figure><figcaption>Saturación de oxígeno (cribado)</figcaption><div id="bd-sat" class="bd-sat"></div></figure>
   <figure><figcaption id="bd-cap-cxr">Radiografía de tórax (AP)</figcaption><canvas id="bd-cxr"></canvas></figure>
   <figure class="bd-wide"><figcaption>Hallazgos de esta cabecera y de dónde sale cada uno</figcaption><ul id="bd-findings" class="bd-findings"></ul></figure>
  </div><p class="micro st-foot">Un solo estado hemodinámico mueve la eco, el soplo, las saturaciones, el ECG y la radiografía · modelo docente, no diagnóstico</p>`;
 const F=id=>figure.querySelector('#'+id);F('bd-close').onclick=()=>api.onClose?.();F('bd-link').onclick=()=>api.copyLink?.();
 F('bd-listen').onclick=()=>{if(isListening()){stopListening();sync()}else if(wave){try{listen(wave,SR)}catch(e){F('bd-sound-note').textContent=e.message}sync()}};
 const sync=()=>{F('bd-listen').textContent=isListening()?'■ Detener':'🔊 Auscultar'};
 function size(c){const r=c.getBoundingClientRect(),w=Math.max(220,Math.round(r.width)),h=Math.max(120,Math.round(r.height));if(c.width!==w||c.height!==h){c.width=w;c.height=h}return [w,h]}
 // ---------------------------------------------------------------- phonocardiogram + ECG over two beats
 function drawPCG(b,wv){const c=F('bd-pcg'),[W,H]=size(c),g=c.getContext('2d'),a=b.auscultation,rr=a.rr,e=b.ecg;g.fillStyle=C.bg;g.fillRect(0,0,W,H);
  const L=34,R=8,beats=2,X=ms=>L+(ms/(rr*beats))*(W-L-R),top=18,pcgH=(H-top)*.46,ecgH=(H-top)*.5,pcgMid=top+pcgH/2,e1=top+pcgH+ecgH*.5-ecgH*.2,e2=top+pcgH+ecgH-6;
  g.font='10px Consolas, monospace';g.textAlign='left';
  // systole band (from S1 to S2) of each beat
  for(let k=0;k<beats;k++){g.fillStyle='#0f1d24';g.fillRect(X(k*rr+a.sounds[0].t),top,X(k*rr+a.sounds[1].t)-X(k*rr+a.sounds[0].t),H-top)}
  g.fillStyle=C.text;g.fillText('sístole',X(a.sounds[0].t)+3,top+10);
  // the waveform
  g.strokeStyle=C.accent;g.lineWidth=1;g.beginPath();const n=wv.length;
  for(let k=0;k<beats;k++)for(let x=0;x<W-L-R;x++){const ms=x/(W-L-R)*rr*beats;if(Math.floor(ms/rr)!==k)continue;const i0=Math.floor(((ms-k*rr)/rr)*n),i1=Math.max(i0+1,Math.floor(((ms+rr*beats/(W-L-R)-k*rr)/rr)*n));let mx=-1,mn=1;for(let i=i0;i<Math.min(n,i1);i++){mx=Math.max(mx,wv[i]);mn=Math.min(mn,wv[i])}if(mx<mn){mx=mn=wv[Math.min(n-1,i0)]}
   g.moveTo(L+x,pcgMid-mx*pcgH*.45);g.lineTo(L+x,pcgMid-mn*pcgH*.45)}
  g.stroke();
  // labels of the sounds
  g.fillStyle=C.warm;for(let k=0;k<beats;k++)for(const s of a.sounds){g.fillRect(X(k*rr+s.t),top+pcgH-6,1.5,6);if(k===0){g.textAlign='center';g.fillText(s.id,X(s.t),top+pcgH+6)}}
  g.textAlign='left';g.fillStyle=C.hi;g.font='11px Segoe UI, sans-serif';g.fillText(a.murmur.grade?`Soplo ${a.murmur.kind} ${a.murmur.grade}/6`:'Sin soplo',L,12);
  // ECG
  const draw=(v,y,col,name)=>{g.strokeStyle=col;g.lineWidth=1.2;g.beginPath();for(let k=0;k<beats;k++)for(let i=0;i<v.length;i++){const x=X(k*rr+i/v.length*rr),yy=y-v[i]*ecgH*.2;(k===0&&i===0)?g.moveTo(x,yy):g.lineTo(x,yy)}g.stroke();g.fillStyle=col;g.font='10px Consolas, monospace';g.fillText(name,4,y)};
  draw(e.V1,e1,C.green,'V1');draw(e.V6,e2,C.cool,'V6');
  F('bd-cap-pcg').textContent=`Fonocardiograma y ECG · ${f0(60000/rr)} lpm`;
 }
 // ---------------------------------------------------------------- saturation monitor
 function drawSat(b){const s=b.saturation,col=s.positive?(s.urgent?C.red:C.warm):C.green;
  F('bd-sat').innerHTML=`<div class="bd-sats"><div><span class="micro">Mano derecha (preductal)</span><b style="color:${s.pre<SCREEN.belowPct?C.warm:C.green}">${f0(s.pre)} %</b></div><div><span class="micro">Pie (posductal)</span><b style="color:${s.post<SCREEN.belowPct?C.warm:C.green}">${f0(s.post)} %</b></div></div>
   <p class="bd-diff">Diferencia <b>${f1(s.diff)}</b> puntos ${tag('modelo')}</p><p class="bd-screen" style="color:${col}">${esc(s.screen)} ${tag({fuente:['tsao2023']})}</p>
   <p class="micro">${esc(s.note)} Positivo si &lt; ${SCREEN.belowPct} % en cualquier extremidad o diferencia &gt; ${SCREEN.diffPct} puntos; ≤ ${SCREEN.urgentPct} % se deriva de inmediato.</p>`}
 // ---------------------------------------------------------------- chest radiograph
 function drawCXR(state){const c=F('bd-cxr'),[W,H]=size(c),g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,W,H);
  if(!cxr){g.fillStyle=C.text;g.font='12px Segoe UI, sans-serif';g.textAlign='center';g.fillText('Calculando la silueta…',W/2,H/2);return}
  const P=cxr.variant,m=P.metrics,n=cxr.normal.metrics,vascular=Math.max(0,Math.min(1,(state.flows.qpqs-1)/1.2)),px=cxrPixels(P,{vascular,outline:true}),off=document.createElement('canvas');off.width=P.nx;off.height=P.nz;
  off.getContext('2d').putImageData(new ImageData(px,P.nx,P.nz),0,0);const s=Math.min(W/P.nx,H/P.nz),w=P.nx*s,h=P.nz*s,ox=(W-w)/2,oy=(H-h)/2;g.imageSmoothingEnabled=true;g.drawImage(off,ox,oy,w,h);
  const X=x=>ox+(x-P.x0)/(P.nx*P.dx)*w,Z=z=>oy+(P.z0+P.nz*P.dz-z)/(P.nz*P.dz)*h; // patient's right (x < 0) on the image left
  g.strokeStyle='#ffe398';g.fillStyle='#ffe398';g.lineWidth=1;g.setLineDash([4,3]);const yh=Z(m.heartZ[0]+(m.heartZ[1]-m.heartZ[0])*.35);
  g.beginPath();g.moveTo(X(m.heartX[0]),yh);g.lineTo(X(m.heartX[1]),yh);g.stroke();g.strokeStyle='#63ddc8';const yt=Z(m.heartZ[0]+(m.heartZ[1]-m.heartZ[0])*.1);g.beginPath();g.moveTo(X(m.thoraxX[0]),yt);g.lineTo(X(m.thoraxX[1]),yt);g.stroke();g.setLineDash([]);
  g.font='11px Segoe UI, sans-serif';g.textAlign='left';g.fillStyle='#ffe398';g.fillText(`Corazón ${f1(m.heartWidth*100*state.patient.k)} cm`,6,16);g.fillStyle='#63ddc8';g.fillText(`Tórax ${f1(m.thoraxWidth*100*state.patient.k)} cm`,6,30);g.fillStyle='#e6edf2';g.fillText(`ICT ${f2(m.ctr)}`,6,44);
  g.fillStyle='#9fb2bd';g.font='10px Consolas, monospace';g.textAlign='left';g.fillText('D',8,H/2);g.textAlign='right';g.fillText('I',W-8,H/2);
  F('bd-cap-cxr').textContent=`Radiografía de tórax (AP) · ICT ${f2(m.ctr)} (${m.ctr>=n.ctr?'+':'−'}${f2(Math.abs(m.ctr-n.ctr))} sobre el mismo tórax sin dilatación)`}
 // ---------------------------------------------------------------- findings with their provenance
 function findings(b,state){const a=b.auscultation,s=b.saturation,e=b.ecg,items=[];
  const spicer=state.lesion.startsWith('vsd'),muta=state.lesion==='asd2';
  items.push(['Auscultación',a.sentences.join(' '),['modelo',{fuente:spicer?['spicer2014']:muta?['muta2003']:['docencia']}]]);
  items.push(['ECG',e.findings.map(f=>f.text).join('. ')+'.',['modelo',{fuente:[...new Set(e.findings.flatMap(f=>f.sources))]}]]);
  items.push(['Saturación',`Mano derecha ${f0(s.pre)} %, pie ${f0(s.post)} % (${esc(s.screen.toLowerCase())}).`,['modelo',{fuente:['tsao2023']}]]);
  if(cxr){const m=cxr.variant.metrics,n=cxr.normal.metrics,d=m.ctr-n.ctr,pl=state.flows.qpqs>1.5;items.push(['Radiografía',`Índice cardiotorácico ${f2(m.ctr)}${d>.015?` (+${f2(d)} sobre el mismo tórax: cardiomegalia relativa)`:' (sin cardiomegalia relativa)'}${pl?'; plétora pulmonar (marcas vasculares aumentadas, esquemáticas)':''}.`,['medido',{fuente:state.lesion.startsWith('vsd')?['spicer2014']:['docencia']}]])}
  F('bd-findings').innerHTML=items.map(([k,t,tg])=>`<li><b>${k}</b> ${t} ${tag(tg)}</li>`).join('')}
 async function update(state,hr=api.hr?.()||95){
  const my=++seq;last={state,hr};const b=bedside(state,hr);wave=synthPhonocardiogram(b.auscultation,{sampleRate:SR});
  F('bd-sub').textContent=`${api.patient().name} · ${f0(hr)} lpm · Qp/Qs ${f2(state.flows.qpqs)} · ${state.grade.label}`;
  drawPCG(b,wave);drawSat(b);findings(b,state);drawCXR(state);if(isListening()){try{listen(wave,SR)}catch{}}
  try{const r=await api.engine.cxr();if(my!==seq)return;cxr=r;drawCXR(state);findings(b,state)}catch(e){console.warn('radiografía',e)}
 }
 return {update,redraw(){if(last)update(last.state,last.hr)},stop(){stopListening();sync()},get state(){return last}};
}
