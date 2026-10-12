// «Física y fisiología»: chapters whose figures are computed by the same engine as the live probe (ray-traced B-mode,
// spectral Doppler, the moving heart) and whose numbers are measured on those images: resolution and penetration on a
// phantom scanned by the simulator, cavity haze, shadows, aliasing, the beat at the patient's heart rate.
import {scanConvert} from './bmode.mjs';
import {PHANTOM,PHANTOM_POSE,spotWidth,penetration,cystContrast} from './phantom.mjs';
import {cycleTiming,CYCLE_SOURCES,withHeartRate,ecgValue,valveOpening} from './cycle.mjs';
import {pwNyquist} from './spectral.mjs';
import {PATIENTS,PATIENT_BY_ID,bodyScale} from './patient.mjs';
import {poseFromState,defaultState,toPlane} from './geometry.mjs';
import {LABEL} from './tissue.mjs';

const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fx=(v,d=1)=>v==null||!isFinite(v)?'—':v.toFixed(d).replace('.',',');
const MHz=f=>`${fx(f,f%1?1:0)} MHz`;
const unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
const C={bg:'#05080b',grid:'#1b2730',text:'#9fb2bd',hi:'#e6edf2',accent:'#63ddc8',warm:'#ffb454',cool:'#7fb6ff',red:'#ff6b6b',green:'#2fe07a',muted:'#6d8290'};

export const CHAPTERS=[
 {id:'frecuencia',group:'Física',title:'Frecuencia: detalle contra profundidad',
  key:'Más frecuencia acorta el pulso (más detalle) pero se atenúa antes (menos profundidad). Mira hasta dónde llega la imagen y cuánto se separan los hilos.',
  sources:['docencia']},
 {id:'resolucion',group:'Física',title:'Resolución y foco',
  key:'El foco estrecha el haz solo alrededor de su profundidad: ponlo a la altura de lo que mides. El detalle a lo largo del haz (axial) depende del pulso, no del foco.',
  sources:['docencia']},
 {id:'armonicos',group:'Física',title:'Imagen armónica',
  key:'La armónica usa el eco a doble frecuencia que nace dentro del tejido: menos ruido cerca de la sonda y menos lóbulos laterales, cavidades más limpias, a cambio de algo de penetración.',
  sources:['docencia']},
 {id:'artefactos',group:'Física',title:'Artefactos: lo que no está',
  key:'Una sombra no es una pared, las líneas paralelas del pulmón no son estructuras, y un septo paralelo al haz se ve más débil y puede perderse sin que haya defecto. Cambia la ventana antes de concluir.',
  sources:['ase2024','silvestry2015','docencia']},
 {id:'doppler',group:'Física',title:'Doppler: ángulo, Nyquist y aliasing',
  key:'El Doppler mide solo la componente de la velocidad a lo largo del haz (× cos θ). El PW tiene un límite (Nyquist) que baja con la profundidad: por encima, la señal se «enrolla». El CW no tiene límite pero no localiza.',
  sources:['quinones2002','docencia']},
 {id:'ciclo',group:'Fisiología',title:'Ciclo cardíaco a frecuencias pediátricas',
  key:'Al subir la frecuencia cardíaca la sístole se acorta poco y la diástole mucho: primero desaparece la diástasis y luego las ondas E y A se fusionan.',
  sources:CYCLE_SOURCES}
];
const BY_ID=Object.fromEntries(CHAPTERS.map(c=>[c.id,c]));

export function mountPhysics(api){
 // api: {host, figure, engine, views, landmarks(), patient(), ySign(windowPreset), freq(), bodyScale(), status(text), normal()}
 const {host,figure}=api;let cur=null,gen=0,raf=0,open=false,state={};
 host.innerHTML=`<p class="micro">Cada figura la calcula el mismo motor que la sonda en vivo y los números se miden sobre esas imágenes.</p>
  <nav class="ph-chapters" aria-label="Capítulos">${['Física','Fisiología'].map(g=>`<span class="eyebrow">${g.toUpperCase()}</span><ol>${CHAPTERS.filter(c=>c.group===g).map(c=>`<li><button data-ch="${c.id}">${esc(c.title)}</button></li>`).join('')}</ol>`).join('')}</nav>
  <div id="ph-body" hidden><p id="ph-key" class="ph-key"></p><div id="ph-controls" class="ph-controls"></div><div id="ph-read" class="st-strip" aria-live="polite"></div>
  <details class="st-how"><summary>Cómo se mide y qué es supuesto</summary><div id="ph-how"></div></details></div>`;
 const $=id=>host.querySelector('#'+id);
 figure.innerHTML=`<div class="st-head"><button id="ph-prev" aria-label="Capítulo anterior">‹</button><b id="ph-title"></b><button id="ph-next" aria-label="Capítulo siguiente">›</button><span id="ph-sub" class="micro"></span><button id="ph-close" aria-label="Cerrar la figura">✕</button></div>
  <div id="ph-grid" class="ph-grid"></div><p class="micro st-foot">Imágenes y espectros calculados por el mismo motor que la sonda en vivo · docencia, no diagnóstico</p>`;
 const F=id=>figure.querySelector('#'+id);
 F('ph-close').onclick=()=>show(false);F('ph-prev').onclick=()=>step(-1);F('ph-next').onclick=()=>step(1);
 figure.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')step(-1);if(e.key==='ArrowRight')step(1)});figure.tabIndex=-1;
 host.querySelectorAll('[data-ch]').forEach(b=>b.onclick=()=>select(b.dataset.ch));
 function step(d){const i=CHAPTERS.findIndex(c=>c.id===cur);select(CHAPTERS[(i+d+CHAPTERS.length)%CHAPTERS.length].id)}
 function show(on){open=on;figure.hidden=!on;document.body.classList.toggle('physics-open',on);if(!on){cancelAnimationFrame(raf);gen++}}
 // ---------------------------------------------------------------- figure cells
 function layout(cells,cols=2){const g=F('ph-grid');g.style.setProperty('--cols',cols);
  g.innerHTML=cells.map(c=>`<figure class="${c.span?'span-'+c.span:''} ${c.tall?'tall':''}"><figcaption id="cap-${c.id}">${esc(c.caption||'')}</figcaption><canvas id="cv-${c.id}"></canvas></figure>`).join('')}
 const cell=id=>typeof id==='string'?F('cv-'+id):id,caption=(id,t)=>{const e=F('cap-'+id);if(e)e.textContent=t};
 function sizeCanvas(c){if(!c.isConnected)return [c.width,c.height];const r=c.getBoundingClientRect(),w=Math.max(160,Math.round(r.width)),h=Math.max(120,Math.round(r.height));if(c.width!==w||c.height!==h){c.width=w;c.height=h}return [w,h]}
 function busy(id,text='Calculando…'){const c=cell(id);if(!c)return;const [w,h]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle=C.bg;g.fillRect(0,0,w,h);g.fillStyle=C.text;g.font='12px Segoe UI, sans-serif';g.textAlign='center';g.fillText(text,w/2,h/2)}
 // a polar frame drawn into a cell; returns the projection (for overlays). depthScale: physical metres per atlas metre
 function drawFrame(id,frame,{ySign=1,depthScale=1,marks=[],label=''}={}){
  const c=cell(id);if(!c)return null;const [w,h]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle=C.bg;g.fillRect(0,0,w,h);
  const half=Math.sin(frame.sector*Math.PI/360),scale=Math.min((w-28)/(2*frame.depth*half),(h-20)/frame.depth),cy=ySign===1?10:h-10,P={cx:w/2,cy,scale,ySign};
  const img=g.createImageData(w,h);scanConvert(frame,img,P,1);g.putImageData(img,0,0);
  // depth marks every centimetre (physical), labelled every 2 or 5
  const cm=.01/depthScale,every=frame.depth*depthScale>.09?5:2;g.font='10px Consolas, monospace';g.textAlign='right';
  for(let i=1;i*cm<frame.depth;i++){const y=cy+i*cm*scale*ySign;g.fillStyle=i%every?'#2b3a44':'#6d8290';g.fillRect(w-12,y,6,1);if(i%every===0){g.fillText(`${i}`,w-14,y+3)}}
  for(const m of marks){const x=P.cx+m.x*scale,y=cy+m.y*scale*ySign;g.strokeStyle=m.color||C.warm;g.fillStyle=m.color||C.warm;g.lineWidth=1.2;
   if(m.kind==='focus'){g.beginPath();g.moveTo(w-4,y);g.lineTo(w-11,y-5);g.lineTo(w-11,y+5);g.closePath();g.fill();g.textAlign='right';g.fillText('foco',w-13,y-6)}
   else if(m.kind==='box'){g.strokeRect(x-m.w*scale/2,y-m.h*scale/2,m.w*scale,m.h*scale);if(m.text){g.textAlign='left';g.fillText(m.text,x+m.w*scale/2+3,y+3)}}
   else if(m.kind==='text'){g.textAlign=m.align||'left';g.fillText(m.text,x,y)}}
  if(label){g.textAlign='left';g.fillStyle=C.hi;g.font='11px Segoe UI, sans-serif';g.fillText(label,8,ySign===1?h-8:16)}
  return P;
 }
 // simple line / bar chart: series [{name,color,points:[[x,y]],dash,bars}]
 function chart(id,{series,xLabel,yLabel,xMax,yMax,xMin=0,yMin=0,vlines=[],bands=[],xTicks=null,yTicks=null,legend=true}){
  const c=cell(id);if(!c)return;const [w,h]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle=C.bg;g.fillRect(0,0,w,h);
  const L=42,R=10,T=legend?22:10,B=30,X=v=>L+(v-xMin)/(xMax-xMin)*(w-L-R),Y=v=>h-B-(v-yMin)/(yMax-yMin)*(h-T-B);
  for(const b of bands){g.fillStyle=b.color;g.fillRect(X(b.x0),T,X(b.x1)-X(b.x0),h-T-B);if(b.text){g.fillStyle=C.text;g.font='10px Segoe UI, sans-serif';g.textAlign='center';g.fillText(b.text,(X(b.x0)+X(b.x1))/2,T+11)}}
  g.strokeStyle=C.grid;g.lineWidth=1;g.font='10px Consolas, monospace';g.fillStyle=C.text;
  const xt=xTicks||niceTicks(xMin,xMax),yt=yTicks||niceTicks(yMin,yMax);
  g.textAlign='center';for(const t of xt){g.beginPath();g.moveTo(X(t),T);g.lineTo(X(t),h-B);g.stroke();g.fillText(fx(t,t%1?1:0),X(t),h-B+12)}
  g.textAlign='right';for(const t of yt){g.beginPath();g.moveTo(L,Y(t));g.lineTo(w-R,Y(t));g.stroke();g.fillText(fx(t,t%1?1:0),L-4,Y(t)+3)}
  g.fillStyle=C.muted;g.textAlign='center';g.fillText(xLabel||'',(L+w-R)/2,h-4);g.save();g.translate(10,(T+h-B)/2);g.rotate(-Math.PI/2);g.fillText(yLabel||'',0,0);g.restore();
  for(const v of vlines){g.strokeStyle=v.color||C.warm;g.setLineDash([4,3]);g.beginPath();g.moveTo(X(v.x),T);g.lineTo(X(v.x),h-B);g.stroke();g.setLineDash([]);if(v.text){g.fillStyle=v.color||C.warm;g.textAlign='left';g.fillText(v.text,X(v.x)+3,T+10)}}
  const nb=series.filter(s=>s.bars).length;let bi=0;
  for(const s of series){g.strokeStyle=s.color;g.fillStyle=s.color;g.lineWidth=s.width||1.8;g.setLineDash(s.dash||[]);
   if(s.bars){const bw=Math.max(6,(w-L-R)/(s.points.length*(nb+1.5)));for(const [x,y] of s.points){if(y==null)continue;const x0=X(x)+(bi-nb/2)*bw;g.fillRect(x0,Y(y),bw*.9,Y(yMin)-Y(y))}bi++}
   else{g.beginPath();let first=true;for(const [x,y] of s.points){if(y==null||!isFinite(y)){first=true;continue}first?g.moveTo(X(x),Y(y)):g.lineTo(X(x),Y(y));first=false}g.stroke()}
   if(s.dots)for(const [x,y] of s.points)if(y!=null){g.beginPath();g.arc(X(x),Y(y),2.6,0,7);g.fill()}}
  g.setLineDash([]);
  if(legend){let lx=L;g.font='11px Segoe UI, sans-serif';g.textAlign='left';for(const s of series){if(!s.name)continue;g.fillStyle=s.color;g.fillRect(lx,8,10,3);g.fillStyle=C.hi;g.fillText(s.name,lx+14,13);lx+=g.measureText(s.name).width+30}}
  return {X,Y};
 }
 function niceTicks(a,b){const span=b-a,step=[.1,.2,.25,.5,1,2,5,10,20,50,100,200,500].find(s=>span/s<=8)||1000;const out=[];for(let v=Math.ceil(a/step)*step;v<=b+1e-9;v+=step)out.push(+v.toFixed(6));return out}
 function paintSpectrum(id,sp,{label='',note='',beats=1}={}){
  const c=cell(id);if(!c)return;const [W,H]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,W,H);if(!sp){if(typeof id==='string')busy(id,'Calculando el espectro…');return}
  const ax=36,iw=Math.max(1,Math.round(W-ax-6)),ih=Math.max(1,Math.round(H-26)),o=document.createElement('canvas');o.width=iw;o.height=ih;const sc=o.getContext('2d'),img=sc.createImageData(iw,ih),a=img.data;
  for(let x=0;x<iw;x++){const col=Math.floor(((x/iw*beats)%1)*sp.cols);for(let y=0;y<ih;y++){const k=Math.min(sp.bins-1,Math.floor(y/ih*sp.bins)),v=sp.data[k*sp.cols+col],i=(y*iw+x)*4;a[i]=v*.96;a[i+1]=v;a[i+2]=v*1.04;a[i+3]=255}}
  sc.putImageData(img,0,0);g.drawImage(o,ax,20);
  const vy=v=>20+(sp.top-v)/(sp.top-sp.bottom)*ih;g.strokeStyle=C.cool;g.beginPath();g.moveTo(ax,vy(0));g.lineTo(ax+iw,vy(0));g.stroke();
  g.font='10px Consolas, monospace';g.fillStyle=C.text;g.textAlign='right';const st=[.25,.5,1,2].find(v=>v*ih/(sp.top-sp.bottom)>=16)||2;
  for(let v=Math.ceil(sp.bottom/st)*st;v<=sp.top+1e-9;v+=st)g.fillText(fx(v,st<.5?2:1),ax-4,vy(v)+3);
  g.textAlign='left';g.fillStyle=C.hi;g.font='11px Segoe UI, sans-serif';g.fillText(label,ax,13);if(note){g.fillStyle='#ffe398';g.textAlign='right';g.fillText(note,W-6,13)}
 }
 // ---------------------------------------------------------------- engine helpers
 const viewPose=(id,extra={})=>{const t=api.views[id];return {origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:t.sector||80,...extra}};
 const heart=(pose,o={})=>api.engine.renderOnce(pose,{lines:168,beating:false,phase:.02,color:{on:false},bodyScale:api.bodyScale(),freq:api.freq(),...o});
 const phantomFrame=(o={})=>api.engine.renderOnce(PHANTOM_POSE,{phantom:true,lines:168,samples:1200,gain:1,tgc:Array(8).fill(50),focus:.5,harmonic:true,seed:1,...o});
 const pointPlane=(pose,p)=>{const q=toPlane(pose,p);return {x:q[0],y:q[1],z:q[2]}};
 // mean grey of a frame over the samples whose reference tissue is `label` (cavity haze), away from its walls
 async function meanOverLabel(frame,pose,labels,{margin=.003,near=null,radius=.012,dense=false,peak=0}={}){
  const pts=[],idx=[],sec=frame.sector*Math.PI/180,q0=near?pointPlane(pose,near):null;
  for(let j=2;j<frame.lines-2;j+=dense?1:3)for(let k=4;k<frame.samples-4;k+=dense?1:5){if(q0){const th=-sec/2+sec*(j+.5)/frame.lines,r=(k+.5)/frame.samples*frame.depth;if(Math.hypot(Math.sin(th)*r-q0.x,Math.cos(th)*r-q0.y)>radius)continue}const th=-sec/2+sec*(j+.5)/frame.lines,r=(k+.5)/frame.samples*frame.depth,dir=[0,1,2].map(i=>Math.cos(th)*pose.d[i]+Math.sin(th)*pose.u[i]);
   for(const dr of [-margin,0,margin])pts.push(pose.origin.map((o,i)=>o+dir[i]*(r+dr)));idx.push(j*frame.samples+k)}
  const lab=await api.engine.probe(pts);let s=0,n=0;
  for(let i=0;i<idx.length;i++){if(labels.includes(lab[3*i])&&labels.includes(lab[3*i+1])&&labels.includes(lab[3*i+2])){
   // peak: the strongest echo within ±peak (m) along the line (a thin reflector's echo sits a fraction of a millimetre off)
   let v=frame.data[idx[i]];if(peak){const w=Math.round(peak/frame.depth*frame.samples),k0=idx[i]%frame.samples,b0=idx[i]-k0;for(let d=-w;d<=w;d++){const kk=k0+d;if(kk>=0&&kk<frame.samples)v=Math.max(v,frame.data[b0+kk])}}s+=v;n++}}
  return n?s/n:null;
 }
 async function gateSpectrum(pose,point,{mode='pw',freq=3.5,scale=null,baseline=.5,optimize=true,hr,theta=null}={}){
  const q=pointPlane(pose,point);
  return api.engine.spectrum({pose,theta:theta??Math.atan2(q.x,q.y)*180/Math.PI,gateDepth:Math.hypot(q.x,q.y),gateLen:.003,mode,freq,scale,baseline,gain:1,bodyScale:api.bodyScale(),...(hr?{hr}:{}),...(optimize?{optimize:{range:6,step:1}}:{})});
 }
 const lvot=()=>{const lm=api.landmarks();return lm.aorticValve.map((v,i)=>v+unit(lm.lvApexCavity.map((x,j)=>x-lm.aorticValve[j]))[i]*.006)};
 const mitralTips=()=>{const lm=api.landmarks();return lm.mitralValve.map((v,i)=>v+unit(lm.lvApexCavity.map((x,j)=>x-lm.mitralValve[j]))[i]*.008)};
 function readout(rows){$('ph-read').innerHTML=`<dl>${rows.map(([k,v,d])=>`<dt>${k}</dt><dd><b>${v}</b>${d?`<div>${d}</div>`:''}</dd>`).join('')}</dl>`}
 // sources of the chapter (lessons/sources.json), listed under «Cómo se mide»
 let catalog=null;fetch('lessons/sources.json').then(r=>r.json()).then(j=>{catalog=j.sources}).catch(()=>{});
 function how(html){const src=(BY_ID[cur]?.sources||[]).map(id=>catalog?.[id]).filter(Boolean);
  $('ph-how').innerHTML=html+(src.length?`<p class="micro">Fuentes: ${src.map(x=>x.doi?`<a href="https://doi.org/${esc(x.doi)}" target="_blank" rel="noopener">${esc(x.citation)}</a>`:esc(x.citation)).join(' · ')}</p>`:'')}
 // ---------------------------------------------------------------- chapters
 const RUN={
  async frecuencia(my){
   const pid=state.patient||api.patient().id,p=PATIENT_BY_ID[pid],k=bodyScale(p),freqs=[2.5,5,10];
   $('ph-controls').innerHTML=`<div class="field"><span>Corazón de</span><div class="seg">${['neonate','child','teen'].map(id=>`<button data-p="${id}" class="${id===pid?'active':''}">${esc(PATIENT_BY_ID[id].name)}</button>`).join('')}</div></div>`;
   $('ph-controls').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{state.patient=b.dataset.p;run()});
   layout([...freqs.map((f,i)=>({id:'ph'+i,caption:`Fantoma · ${MHz(f)}`})),...freqs.map((f,i)=>({id:'h'+i,caption:`${p.name} · apical 4C · ${MHz(f)}`}))],3);
   how(`<p>Fantoma: bloque que imita tejido (0,55 dB/cm/MHz) con hilos cada centímetro, escaneado por el mismo trazado de rayos que el corazón. <b>Profundidad útil</b>: hasta dónde el eco del tejido domina sobre el ruido del receptor, medida comparando dos cuadros (el speckle es fijo, el ruido cambia en cada cuadro). <b>Detalle axial</b>: anchura a −6 dB del eco de un hilo a 5 cm a lo largo del haz.</p><p>Las frecuencias por paciente (10 MHz recién nacido, 4 MHz adolescente) son las que el simulador propone por defecto, no una recomendación clínica.</p>`);
   freqs.forEach((f,i)=>{busy('ph'+i);busy('h'+i)});
   const res={};
   for(const [i,f] of freqs.entries()){const harmonic=f>=4;const [a,b]=await Promise.all([phantomFrame({freq:f,harmonic,seed:1}),phantomFrame({freq:f,harmonic,seed:2})]);if(my!==gen)return;
    const pen=penetration(a,b),w=spotWidth(a,PHANTOM.column[4]);res[f]={pen:pen.limit,axial:w.axial,lateral:w.lateral};
    drawFrame('ph'+i,a,{marks:pen.limit<PHANTOM.depth-.006?[{kind:'text',x:-PHANTOM.depth*.42,y:pen.limit,text:'— ruido',color:C.warm}]:[]});
    caption('ph'+i,`Fantoma · ${MHz(f)}${harmonic?' (armónica)':''} · útil ${pen.limit>=PHANTOM.depth-.006?'≥ 12':fx(pen.limit*100,0)} cm · axial ${fx(w.axial,1)} mm`)}
   const pose=viewPose('a4c');
   for(const [i,f] of freqs.entries()){const fr=await heart(pose,{freq:f,bodyScale:k,harmonic:f>=4});if(my!==gen)return;drawFrame('h'+i,fr,{ySign:api.ySign('apical'),depthScale:k})}
   readout(freqs.map(f=>[MHz(f),`útil ${res[f].pen>=PHANTOM.depth-.006?'≥ 12':fx(res[f].pen*100,0)} cm · axial ${fx(res[f].axial,2)} mm`,res[f].lateral==null?'lateral a 5 cm: el hilo no se distingue del speckle':`lateral a 5 cm ${fx(res[f].lateral,1)} mm`]).concat([[p.name,`apical 4C con ${fx(api.views.a4c.depth*k*100,0)} cm de profundidad`,'lo que la imagen necesita alcanzar en este paciente']]));
  },
  async resolucion(my){
   const f=state.freq??4,focusCm=state.focusCm??6;
   $('ph-controls').innerHTML=`<label class="field"><span>Frecuencia</span><select id="ph-f">${[2.5,4,7,10].map(v=>`<option value="${v}" ${v===f?'selected':''}>${MHz(v)}</option>`).join('')}</select></label>
    <div class="field"><span>Foco <output>${fx(focusCm,0)} cm</output></span><input id="ph-focus" type="range" min="2" max="11" step="1" value="${focusCm}"></div>`;
   $('ph-f').onchange=()=>{state.freq=Number($('ph-f').value);run()};$('ph-focus').onchange=()=>{state.focusCm=Number($('ph-focus').value);run()};
   $('ph-focus').oninput=()=>{$('ph-controls').querySelector('output').textContent=`${$('ph-focus').value} cm`};
   layout([{id:'img',caption:`Fantoma · ${MHz(f)} · foco a ${focusCm} cm`,tall:true},{id:'chart',caption:'Anchura del eco de cada hilo (−6 dB)',tall:true}],2);
   how(`<p>Cada hilo es un reflector puntual: lo que la imagen muestra de él es la respuesta del sistema (pulso × haz). Se mide su anchura a −6 dB (mitad de la amplitud) a lo largo del haz (<b>axial</b>) y a lo ancho (<b>lateral</b>). Un par de hilos se separa cuando su distancia supera esa anchura.</p><p>Pares del fantoma: axiales a 2, 1 y 0,5 mm; laterales a 3, 2 y 1 mm; a 5 y 9 cm. Quistes anecoicos de 2, 4 y 6 mm a 7 cm.</p>`);
   busy('img');busy('chart');
   const fr=await phantomFrame({freq:f,focus:focusCm/12,harmonic:f>=4});if(my!==gen)return;
   const w=PHANTOM.column.map(p=>({cm:p.y*100,...spotWidth(fr,p)}));
   const wAt=cm=>w.find(x=>Math.round(x.cm)===cm);
   const marks=[{kind:'focus',x:0,y:focusCm/100}];
   const verdict=(pairs,dir)=>pairs.map(p=>{const ww=wAt(p.depth/10)?.[dir];const ok=ww!=null&&p.sep>=ww;marks.push({kind:'box',x:(p.a.x+p.b.x)/2,y:(p.a.y+p.b.y)/2,w:Math.abs(p.b.x-p.a.x)+.003,h:Math.abs(p.b.y-p.a.y)+.003,color:ok?C.green:C.red});return {...p,ok,ww}});
   const ax=verdict(PHANTOM.axial,'axial'),lat=verdict(PHANTOM.lateral,'lateral');
   drawFrame('img',fr,{marks});
   chart('chart',{series:[{name:'Lateral',color:C.accent,dots:true,points:w.map(x=>[x.cm,x.lateral])},{name:'Axial',color:C.warm,dots:true,points:w.map(x=>[x.cm,x.axial])}],
    xLabel:'Profundidad (cm)',yLabel:'Anchura (mm)',xMin:0,xMax:12,yMax:Math.max(4,Math.ceil(Math.max(...w.map(x=>x.lateral||0))))+.5,vlines:[{x:focusCm,text:'foco'}]});
   const fw=wAt(focusCm),far=wAt(focusCm<=6?11:2);
   const list=(arr)=>[5,9].map(d=>`${d} cm: ${arr.filter(p=>p.depth===d*10).map(p=>`${fx(p.sep,p.sep<1?1:0)} mm ${p.ok?'✓':'✗'}`).join(' · ')}`).join('<br>');
   readout([['Lateral en el foco',`${fx(fw?.lateral,1)} mm a ${focusCm} cm`,`${fx(far?.lateral,1)} mm a ${fx(far?.cm,0)} cm`],['Axial',`${fx(wAt(5)?.axial,2)} mm`,'casi igual a cualquier profundidad: depende del pulso'],['Pares laterales',list(lat),'✓ separados · ✗ fundidos en uno'],['Pares axiales',list(ax),'']]);
  },
  async armonicos(my){
   const p=api.patient(),f=api.freq(),pose=viewPose('a4c');
   $('ph-controls').innerHTML=`<p class="micro">${esc(p.name)} · ${MHz(f)} · apical 4C y fantoma a la misma frecuencia</p>`;
   layout([{id:'fund',caption:`Fundamental · ${MHz(f)}`},{id:'harm',caption:`Armónica · emite ${MHz(f)}, recibe ${MHz(2*f)}`},{id:'pf',caption:`Fantoma · fundamental`},{id:'ph',caption:`Fantoma · armónica`}],2);
   how(`<p><b>Neblina en la cavidad</b>: gris medio de la imagen dentro de la cavidad del VI (lejos de sus paredes, según la anatomía de referencia). Una cavidad llena de sangre debería verse casi negra; lo que aparece es ruido cercano, lóbulos laterales y reverberación. <b>Anchura lateral</b> y <b>profundidad útil</b>: en el fantoma a la misma frecuencia.</p><p>En el simulador la armónica estrecha el haz, quita parte del ruido de la pared torácica y de los lóbulos laterales, y atenúa algo más; el eco muy cerca de la sonda es más débil porque la armónica se forma al propagarse.</p>`);
   ['fund','harm','pf','ph'].forEach(id=>busy(id));
   const out={};
   for(const harmonic of [false,true]){const fr=await heart(pose,{harmonic,freq:f});if(my!==gen)return;drawFrame(harmonic?'harm':'fund',fr,{ySign:api.ySign('apical'),depthScale:api.bodyScale()});
    const haze=await meanOverLabel(fr,pose,[LABEL.LV_BLOOD]);if(my!==gen)return;
    const [a,b]=await Promise.all([phantomFrame({freq:f,harmonic,seed:1}),phantomFrame({freq:f,harmonic,seed:2})]);if(my!==gen)return;
    const lat=spotWidth(a,PHANTOM.column[4]).lateral,pen=penetration(a,b).limit;out[harmonic?'h':'f']={haze,lat,pen};
    drawFrame(harmonic?'ph':'pf',a);caption(harmonic?'harm':'fund',`${harmonic?`Armónica · emite ${MHz(f)}, recibe ${MHz(2*f)}`:`Fundamental · ${MHz(f)}`} · neblina en el VI ${fx(haze,0)}`);
    caption(harmonic?'ph':'pf',`Fantoma · ${harmonic?'armónica':'fundamental'} · lateral a 5 cm ${fx(lat,1)} mm`)}
   readout([['Neblina en el VI',`${fx(out.f.haze,0)} → ${fx(out.h.haze,0)}`,'gris medio (0–255), fundamental → armónica'],['Lateral a 5 cm',`${fx(out.f.lat,1)} → ${fx(out.h.lat,1)} mm`,'fantoma'],['Profundidad útil',`${out.f.pen>=PHANTOM.depth-.006?'≥ 12':fx(out.f.pen*100,0)} → ${out.h.pen>=PHANTOM.depth-.006?'≥ 12':fx(out.h.pen*100,0)} cm`,'fantoma; 12 cm es todo el campo']]);
  },
  async artefactos(my){
   const k=api.bodyScale(),f=api.freq();
   $('ph-controls').innerHTML=`<p class="micro">${esc(api.patient().name)} · ${MHz(f)}</p>`;
   layout([{id:'rib0',caption:'Entre dos costillas'},{id:'rib1',caption:'Sobre una costilla'},{id:'lung0',caption:'Paraesternal largo'},{id:'lung1',caption:'Sobre el pulmón'},
    {id:'el0',caption:'Corte ideal sin grosor'},{id:'el1',caption:'Corte real con grosor'},{id:'ias0',caption:'Apical 4C: septo paralelo al haz'},{id:'ias1',caption:'Subcostal 4C: septo perpendicular'}],4);
   how(`<p>La sonda se coloca buscando en el tórax del simulador una posición con una costilla bajo el centro del haz y otra con pulmón; las imágenes son las del motor. <b>Sombra</b>: fracción del sector sin eco detrás de la costilla. <b>Líneas A</b>: ecos repetidos a múltiplos de la profundidad de la pleura. <b>Septo interauricular</b>: gris medio alrededor de la fosa oval en cada ventana. Las guías piden confirmar la ausencia de septo desde una ventana con el haz perpendicular antes de hablar de defecto (ASE 2024; Silvestry 2015). En este atlas adulto el haz subcostal cruza el septo a ≈56°, no casi perpendicular como en el lactante: la diferencia entre ventanas es menor que en la clínica.</p>`);
   ['rib0','rib1','lung0','lung1','el0','el1','ias0','ias1'].forEach(id=>busy(id));
   const base=viewPose('plax'),found=await findArtifactPoses();if(my!==gen)return;
   const ys=api.ySign('plax'),rows=[];
   const r0=await heart(base);if(my!==gen)return;drawFrame('rib0',r0,{ySign:ys,depthScale:k});drawFrame('lung0',r0,{ySign:ys,depthScale:k});
   if(found.rib){const fr=await heart(found.rib);if(my!==gen)return;drawFrame('rib1',fr,{ySign:ys,depthScale:k});const sh=shadowFraction(fr);caption('rib1',`Sobre una costilla · sombra en ${fx(sh*100,0)} % del sector`);rows.push(['Sombra acústica',`${fx(sh*100,0)} % del sector sin eco`,'no es una estructura: detrás del hueso no llega sonido'])}
   else busy('rib1','No se encontró una costilla en esta ventana');
   if(found.lung){const fr=await heart(found.lung);if(my!==gen)return;const pl=found.pleura*k*100;
    drawFrame('lung1',fr,{ySign:ys,depthScale:k,marks:[1,2,3].map(m=>({kind:'text',x:-found.lung.depth*.5,y:found.pleura*m,text:m===1?'pleura':`${m}×`,color:C.warm}))});caption('lung1',`Sobre el pulmón · pleura a ${fx(pl,1)} cm`);
    rows.push(['Pulmón',`pleura a ${fx(pl,1)} cm · líneas A a ${fx(2*pl,1)} y ${fx(3*pl,1)} cm`,'ecos repetidos entre la sonda y la pleura: no son estructuras'])}
   else busy('lung1','No se encontró pulmón en esta ventana');
   const a4=viewPose('a4c'),ya=api.ySign('apical');
   const [e0,e1]=[await heart(a4,{elevation:false}),await heart(a4)];if(my!==gen)return;drawFrame('el0',e0,{ySign:ya,depthScale:k});drawFrame('el1',e1,{ySign:ya,depthScale:k});
   rows.push(['Grosor de corte','paredes oblicuas y válvulas fuera del plano aparecen a medias','el haz integra unos milímetros a cada lado del plano']);
   const lm=api.landmarks(),fossa=lm.asdSecundum,sc=viewPose('sc4c');
   const i0=e1,i1=await heart(sc);if(my!==gen)return;
   // grey on the membrane itself: the image samples whose reference tissue is the fossa floor, around the landmark
   const [g0,g1]=[await meanOverLabel(i0,a4,[LABEL.FOSSA],{margin:0,near:fossa,radius:.012,dense:true,peak:.0015/k}),await meanOverLabel(i1,sc,[LABEL.FOSSA],{margin:0,near:fossa,radius:.012,dense:true,peak:.0015/k})];if(my!==gen)return;
   // the blood on both sides of the septum, as the reference «nothing there» grey
   const atria=[LABEL.LA_BLOOD,LABEL.RA_BLOOD],[b0,b1]=[await meanOverLabel(i0,a4,atria,{near:fossa,radius:.015}),await meanOverLabel(i1,sc,atria,{near:fossa,radius:.015})];if(my!==gen)return;
   drawFrame('ias0',i0,{ySign:ya,depthScale:k,marks:[{kind:'box',...xy(a4,fossa),w:.012,h:.012}]});drawFrame('ias1',i1,{ySign:api.ySign('subcostal'),depthScale:k,marks:[{kind:'box',...xy(sc,fossa),w:.012,h:.012}]});
   caption('ias0',`Apical 4C · fosa oval: gris ${fx(g0,0)}`);caption('ias1',`Subcostal 4C · fosa oval: gris ${fx(g1,0)}`);
   rows.push(['Fosa oval',`apical ${fx(g0,0)} · subcostal ${fx(g1,0)}`,`eco de la membrana (gris 0–255): más débil con el haz paralelo; la sangre vecina da ${fx(b0,0)} y ${fx(b1,0)}`]);
   readout(rows);
  },
  async doppler(my){
   const k=api.bodyScale(),pose=viewPose('a5c'),gate=lvot(),q=pointPlane(pose,gate),gateCm=Math.hypot(q.x,q.y)*k*100,fd=3.5;
   $('ph-controls').innerHTML=`<p class="micro">${esc(api.patient().name)} · Doppler a ${MHz(fd)} · puerta en el tracto de salida del VI a ${fx(gateCm,1)} cm</p>`;
   layout([{id:'ok',caption:'PW · escala adecuada'},{id:'alias',caption:'PW · escala baja: aliasing'},{id:'base',caption:'PW · misma escala, línea base desplazada'},{id:'cw',caption:'CW · sin límite de velocidad'},
    {id:'nyq',caption:'Límite de Nyquist del PW según la profundidad'},{id:'angle',caption:'Flujo mitral: alineado frente a oblicuo'}],3);
   how(`<p>Espectros calculados por el motor sobre el flujo simulado. <b>Nyquist</b> = PRF/2 = c²/(8·f₀·profundidad): cuanto más profunda la puerta, menor la PRF posible y menor la velocidad máxima medible. <b>Ángulo</b>: entre el haz en la puerta y el eje del llenado mitral (de la válvula mitral al ápex); la velocidad registrada es v·cos θ. Con θ < 20° el error es ≤ 6 % (cos 20° = 0,94); corregir ángulos grandes amplifica el error, por eso se busca alinear el haz (Quiñones 2002).</p>`);
   for(const id of ['ok','alias','base','cw','angle'])busy(id);
   const ok=await gateSpectrum(pose,gate,{freq:fd,scale:1.5,baseline:.8});if(my!==gen)return;
   const v=Math.abs(ok.vPeak);paintSpectrum('ok',ok,{label:`PW · Vmáx ${fx(v,2)} m/s · escala ±1,5`});
   const low=Math.max(.3,Math.round(v*.6*10)/10);
   const al=await gateSpectrum(pose,gate,{freq:fd,scale:low,baseline:.5,optimize:false,theta:ok.theta});if(my!==gen)return;paintSpectrum('alias',al,{label:`PW · escala ±${fx(low,1)} m/s`,note:'el pico se «enrolla» arriba'});
   const bs=await gateSpectrum(pose,gate,{freq:fd,scale:low,baseline:.95,optimize:false,theta:ok.theta});if(my!==gen)return;paintSpectrum('base',bs,{label:`PW · escala ±${fx(low,1)} · línea base arriba`,note:'cabe sin cambiar la PRF'});
   const cw=await gateSpectrum(pose,gate,{mode:'cw',freq:fd,scale:2,baseline:.8});if(my!==gen)return;paintSpectrum('cw',cw,{label:`CW · Vmáx ${fx(Math.abs(cw.vPeak),2)} m/s`,note:'toda la línea: no localiza'});
   const depths=[...Array(23).keys()].map(i=>1+i*.5);
   chart('nyq',{series:[2.5,3.5,5].map((f,i)=>({name:`${MHz(f)}`,color:[C.cool,C.accent,C.warm][i],points:depths.map(d=>[d,pwNyquist(d/100,f)])})).concat([{name:'',color:C.red,dash:[3,3],points:[[1,v],[12,v]]}]),
    xLabel:'Profundidad de la puerta (cm)',yLabel:'Velocidad máxima (m/s)',xMin:0,xMax:12,yMax:4,vlines:[{x:gateCm,text:'puerta TSVI',color:C.hi}]});
   // angle: mitral inflow from the apical window (aligned) and from the parasternal long axis (oblique)
   const tips=mitralTips(),apical=await gateSpectrum(viewPose('a4c'),tips,{freq:fd,scale:1.5,baseline:.2});if(my!==gen)return;
   const plaxPose=viewPose('plax'),para=await gateSpectrum(plaxPose,tips,{freq:fd,scale:1.5,baseline:.5});if(my!==gen)return;
   // angle between the beam at the gate and the axis of mitral inflow (mitral valve → LV apex)
   const lm=api.landmarks(),axis=unit(lm.lvApexCavity.map((x,j)=>x-lm.mitralValve[j])),angleOf=pose=>{const b=unit(tips.map((x,j)=>x-pose.origin[j]));return Math.acos(Math.min(1,Math.abs(b[0]*axis[0]+b[1]*axis[1]+b[2]*axis[2])))*180/Math.PI};
   apical.angle=angleOf(viewPose('a4c'));para.angle=angleOf(plaxPose);
   paintSpectrumPair('angle',apical,para);
   const n=pwNyquist(gateCm/100,fd);
   readout([['TSVI',`Vmáx ${fx(v,2)} m/s`,`Nyquist a ${fx(gateCm,1)} cm con ${MHz(fd)}: ${fx(n,2)} m/s`],['Escala ±'+fx(low,1),'aliasing','la línea base desplazada lo resuelve sin cambiar la PRF; si no basta: menos profundidad, menor frecuencia Doppler o CW'],
    ['Ángulo con el flujo mitral',`apical ${fx(apical.angle,0)}° → E ${fx(Math.abs(apical.vPeak),2)} m/s`,`paraesternal ${fx(para.angle,0)}° → ${fx(Math.abs(para.vPeak),2)} m/s: el mismo llenado medido un ${fx((1-Math.abs(para.vPeak)/Math.abs(apical.vPeak))*100,0)} % más bajo`]]);
  },
  async ciclo(my){
   const hr=state.hr??api.patient().hr,T=cycleTiming(hr),k=api.bodyScale();
   $('ph-controls').innerHTML=`<div class="field"><span>Frecuencia cardíaca <output>${hr} lpm</output></span><input id="ph-hr" type="range" min="50" max="160" step="5" value="${hr}"><div class="seg">${[60,95,140,160].map(v=>`<button data-hr="${v}" class="${v===hr?'active':''}">${v}</button>`).join('')}</div></div>`;
   $('ph-hr').oninput=()=>{$('ph-controls').querySelector('output').textContent=`${$('ph-hr').value} lpm`};$('ph-hr').onchange=()=>{state.hr=Number($('ph-hr').value);run()};
   $('ph-controls').querySelectorAll('[data-hr]').forEach(b=>b.onclick=()=>{state.hr=Number(b.dataset.hr);run()});
   layout([{id:'wig',span:2,tall:true,caption:`Un latido a ${hr} lpm (${fx(T.rr,0)} ms)`},{id:'cine',tall:true,caption:'Apical 4C al mismo ritmo'}],3);
   how(`<p><b>Volumen del VI</b>: medido sobre el corazón en movimiento del simulador (la cavidad que muestran las imágenes), contando su sangre en cada fase. <b>Duraciones</b>: el periodo con las válvulas AV cerradas (contracción isovolumétrica + eyección + relajación isovolumétrica) sigue la regresión de Sarnari et al. 2009 en 179 niños (500 − 1,92·FC ms); el resto es diástole. Supuesto del modelo: el llenado rápido y la contracción auricular se acortan en la misma proporción que la sístole, así que la diástasis absorbe el resto y, a frecuencias altas, E y A se solapan. Los espectros son los del motor a esa frecuencia.</p><p>El corazón es un atlas adulto escalado: la fracción de eyección del modelo es realista, los volúmenes absolutos no son pediátricos.</p>`);
   busy('wig');busy('cine');
   const [curve,mv,ao]=await Promise.all([api.engine.lvVolume({hr,phases:48,k}),gateSpectrum(viewPose('a4c'),mitralTips(),{freq:3.5,scale:1.2,baseline:.15,hr}),gateSpectrum(viewPose('a5c'),lvot(),{freq:3.5,scale:1.5,baseline:.85,hr})]);if(my!==gen)return;
   const ed=Math.max(...curve.map(c=>c.ml)),es=Math.min(...curve.map(c=>c.ml)),ef=(ed-es)/ed;
   drawWiggers('wig',T,curve,mv,ao);
   state.cine=[];state.cineHr=hr;const pose=viewPose('a4c'),N=12;
   startCine(my,T);
   for(let i=0;i<N;i++){const fr=await heart(pose,{beating:true,phase:(i+.5)/N,hr});if(my!==gen)return;state.cine[i]=frameCanvas('cine',fr,{ySign:api.ySign('apical'),depthScale:k})}
   readout([['Ciclo',`${fx(T.rr,0)} ms a ${hr} lpm`,''],['Válvulas AV cerradas',`${fx(T.systole,0)} ms · ${fx(T.systole/T.rr*100,0)} % del ciclo`,'contracción isovolumétrica + eyección + relajación (Sarnari 2009)'],
    ['Diástole',`${fx(T.diastole,0)} ms`,T.fused?`sin diástasis: E y A se solapan ${fx(-T.diastasis,0)} ms`:`diástasis ${fx(T.diastasis,0)} ms`],['VI (modelo)',`FE ${fx(ef*100,0)} %`,`VTD ${fx(ed,1)} mL · VTS ${fx(es,1)} mL · corazón adulto escalado`],['Llenado mitral',`E ${fx(Math.abs(mv.vPeak),2)} m/s`,'pico del espectro PW en las puntas mitrales']]);
  }
 };
 // ---------------------------------------------------------------- chapter-specific drawing
 function paintSpectrumPair(id,a,b){
  const c=cell(id);const [W,H]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,W,H);
  const one=(sp,x0,label)=>{const o=document.createElement('canvas');o.width=Math.floor(W/2)-4;o.height=H;paintSpectrum(o,sp,{label});g.drawImage(o,x0,0)};
  one(a,0,`Apical · θ ${fx(a.angle,0)}° · E ${fx(Math.abs(a.vPeak),2)} m/s`);one(b,Math.floor(W/2)+4,`Paraesternal · θ ${fx(b.angle,0)}° · ${fx(Math.abs(b.vPeak),2)} m/s`);
 }
 function drawWiggers(id,T,curve,mv,ao){
  const c=cell(id);const [w,h]=sizeCanvas(c),g=c.getContext('2d');g.fillStyle=C.bg;g.fillRect(0,0,w,h);
  const L=70,R=12,top=8,X=t=>L+t*(w-L-R),rows=[['ECG',.12],['Volumen VI',.26],['Válvulas',.1],['Flujo mitral',.24],['Flujo aórtico',.24]];
  let y=top;const lanes={};for(const [name,f] of rows){const hh=(h-top-18)*f;lanes[name]={y0:y,y1:y+hh};y+=hh}
  // phase bands
  const ev=T.events,rr=T.rr,bands=[[0,ev.slOpen,'#13222b','CIV'],[ev.slOpen,ev.slClose,'#0f1d24','eyección'],[ev.slClose,ev.avOpen,'#13222b','RIV'],[ev.avOpen,Math.min(ev.eEnd,ev.aStart),'#0d1a20','llenado rápido'],
   ...(T.fused?[[ev.aStart,ev.eEnd,'#2a2412','E+A']]:[[ev.eEnd,ev.aStart,'#0a1418','diástasis']]),[Math.max(ev.aStart,T.fused?ev.eEnd:ev.aStart),rr,'#13222b','aurícula']];
  g.font='10px Segoe UI, sans-serif';g.textAlign='center';
  for(const [a,b,col,txt] of bands){if(b<=a)continue;g.fillStyle=col;g.fillRect(X(a/rr),top,X(b/rr)-X(a/rr),h-top-18);g.fillStyle=C.muted;if(X(b/rr)-X(a/rr)>34)g.fillText(txt,(X(a/rr)+X(b/rr))/2,h-6)}
  g.textAlign='right';g.fillStyle=C.text;for(const [name] of rows){const l=lanes[name];g.fillText(name,L-6,(l.y0+l.y1)/2+3)}
  g.strokeStyle=C.grid;g.lineWidth=1;for(const [name] of rows.slice(1)){const yy=lanes[name].y0;g.beginPath();g.moveTo(L-60,yy);g.lineTo(w-R,yy);g.stroke()}
  // ECG
  const ecgAt=withHeartRate(T.hr,()=>[...Array(201).keys()].map(i=>ecgValue(i/200))),openAt=withHeartRate(T.hr,()=>({semilunar:[...Array(401).keys()].map(i=>valveOpening(i/400,'semilunar')),av:[...Array(401).keys()].map(i=>valveOpening(i/400,'av'))}));
  {const l=lanes.ECG;g.strokeStyle=C.green;g.lineWidth=1.2;g.beginPath();for(let i=0;i<=200;i++){const t=i/200,v=ecgAt[i];const yy=l.y1-4-(v+.3)/1.4*(l.y1-l.y0-6);i?g.lineTo(X(t),yy):g.moveTo(X(t),yy)}g.stroke()}
  // volume (measured)
  {const l=lanes['Volumen VI'],vmax=Math.max(...curve.map(c=>c.ml)),vmin=Math.min(...curve.map(c=>c.ml)),lo=vmin-(vmax-vmin)*.15,hi=vmax+(vmax-vmin)*.1,Y=v=>l.y1-(v-lo)/(hi-lo)*(l.y1-l.y0);
   g.strokeStyle=C.accent;g.lineWidth=2;g.beginPath();curve.concat([{t:1,ml:curve[0].ml}]).forEach((c,i)=>i?g.lineTo(X(c.t),Y(c.ml)):g.moveTo(X(c.t),Y(c.ml)));g.stroke();
   g.fillStyle=C.text;g.textAlign='left';g.fillText(`${fx(vmax,1)} mL`,L+2,Y(vmax)-3);g.fillText(`${fx(vmin,1)} mL`,X(curve.find(c=>c.ml===vmin).t)+4,Y(vmin)+11)}
  // valves (open bars)
  {const l=lanes['Válvulas'],hh=(l.y1-l.y0)/2-2;for(const [i,kind,name,col] of [[0,'semilunar','aórtica',C.warm],[1,'av','mitral',C.cool]]){g.fillStyle=col;let a=null;for(let s=0;s<=400;s++){const t=s/400,o=s<400&&openAt[kind][s]>0;if(o&&a==null)a=t;if((!o||s===400)&&a!=null){g.fillRect(X(a),l.y0+i*(hh+2),X(t)-X(a),hh);a=null}}g.fillStyle=C.hi;g.textAlign='left';g.fillText(name,L+2,l.y0+i*(hh+2)+hh-2)}}
  // spectra in their lanes
  for(const [name,sp] of [['Flujo mitral',mv],['Flujo aórtico',ao]]){const l=lanes[name];if(!sp)continue;const iw=Math.round(X(1)-X(0)),ih=Math.round(l.y1-l.y0-2),o=document.createElement('canvas');o.width=iw;o.height=ih;const sc=o.getContext('2d'),img=sc.createImageData(iw,ih),a=img.data;
   for(let x=0;x<iw;x++){const col=Math.floor(x/iw*sp.cols);for(let yy=0;yy<ih;yy++){const kk=Math.min(sp.bins-1,Math.floor(yy/ih*sp.bins)),v=sp.data[kk*sp.cols+col],i=(yy*iw+x)*4;a[i]=v*.96;a[i+1]=v;a[i+2]=v*1.04;a[i+3]=255}}
   sc.putImageData(img,0,0);g.drawImage(o,X(0),l.y0+1)}
  state.wig={X,top,bottom:h-18};
 }
 // cine at the chosen rate: a frame is drawn only when the phase index changes; the cursor on the beat diagram is a CSS
 // line moved with a transform (no canvas redraw per animation frame)
 function startCine(my,T){cancelAnimationFrame(raf);const t0=performance.now(),N=12,wc=cell('wig'),fig=wc?.parentElement;let last=-1,cursor=null;
  if(fig&&state.wig){cursor=fig.querySelector('.ph-cursor')||fig.appendChild(Object.assign(document.createElement('i'),{className:'ph-cursor'}));
   cursor.style.top=`${wc.offsetTop+state.wig.top}px`;cursor.style.height=`${state.wig.bottom-state.wig.top}px`}
  const draw=now=>{if(my!==gen||!open)return;raf=requestAnimationFrame(draw);const t=((now-t0)/T.rr)%1,i=Math.floor(t*N);
   if(cursor)cursor.style.transform=`translateX(${state.wig.X(t)}px)`;
   if(i===last)return;let fr=state.cine[i];for(let d=1;!fr&&d<N;d++)fr=state.cine[(i-d+N)%N];const c=cell('cine');if(fr&&c){const [w,h]=sizeCanvas(c);c.getContext('2d').drawImage(fr,0,0,w,h);last=i}};
  raf=requestAnimationFrame(draw)}
 // a frame scan-converted once into a canvas of the cell's size (cine)
 function frameCanvas(id,frame,o){const c=cell(id),[w,h]=sizeCanvas(c),off=document.createElement('canvas');off.width=w;off.height=h;drawFrame(off,frame,o);return off}
 // shadow: fraction of the lines whose image goes dark early (mean grey of the deep half below the mean of all lines × 0.25)
 function shadowFraction(fr){let dark=0;const k0=Math.floor(fr.samples*.25);const m=[];for(let j=0;j<fr.lines;j++){let s=0;for(let k=k0;k<fr.samples;k++)s+=fr.data[j*fr.samples+k];m.push(s/(fr.samples-k0))}const ref=[...m].sort((a,b)=>b-a)[Math.floor(m.length*.2)];for(const v of m)if(v<ref*.25)dark++;return dark/fr.lines}
 const xy=(pose,p)=>{const q=pointPlane(pose,p);return {x:q.x,y:q.y}};
 // probe positions near the parasternal window with a rib under the centre of the beam, and with lung under it
 async function findArtifactPoses(){
  if(state.artifactPoses)return state.artifactPoses;
  const base=defaultState('plax'),v=api.views.plax,cands=[],pts=[],R=[];for(let r=.003;r<=.06+1e-9;r+=.0025)R.push(r);
  for(let dx=-.04;dx<=.08;dx+=.005)for(let dz=-.04;dz<=.04;dz+=.005){const st={...base,x:base.x+dx,z:base.z+dz},p=poseFromState(st),pose={...p,depth:v.depth,sector:v.sector||80};cands.push(pose);
   for(const a of [-30,-15,-5,0,5,15,30]){const th=a*Math.PI/180,dir=[0,1,2].map(i=>Math.cos(th)*pose.d[i]+Math.sin(th)*pose.u[i]);for(const r of R)pts.push(pose.origin.map((o,i)=>o+dir[i]*r))}}
  const lab=await api.engine.probe(pts),n=R.length,per=7*n,first=(ci,ri)=>{for(let s=0;s<n;s++){const l=lab[ci*per+ri*n+s];if(l===LABEL.BONE||l===LABEL.LUNG||l===LABEL.CARTILAGE)return l;if(l>=10)return 'heart'}return null};
  let rib=null,ribScore=-1,lung=null,lungScore=-1,lungCi=-1;
  // lung under a ray: depth of its first lung sample and how much lung follows (aerated lung, not a thin edge)
  const lungRun=(ci,ri)=>{let a=-1,run=0;for(let s2=0;s2<n;s2++){const l=lab[ci*per+ri*n+s2];if(l===LABEL.LUNG){if(a<0)a=s2;run++}else if(a>=0)break;else if(l===LABEL.BONE)return {a:-1,run:0}}return {a,run}};
  cands.forEach((pose,ci)=>{const hits=[0,1,2,3,4,5,6].map(ri=>first(ci,ri)),centre=[2,3,4].map(i=>hits[i]),edge=[0,6].map(i=>hits[i]);
   const sRib=centre.filter(h=>h===LABEL.BONE).length*2-edge.filter(h=>h===LABEL.BONE).length*2-hits.filter(h=>h===LABEL.LUNG).length;if(sRib>ribScore&&centre[1]===LABEL.BONE){ribScore=sRib;rib=pose}
   const runs=[0,1,2,3,4,5,6].map(ri=>lungRun(ci,ri)),c=runs[3],sLung=runs.reduce((t,r)=>t+r.run,0)-hits.filter(h=>h===LABEL.BONE).length*4;
   if(c.a>=0&&c.run*.0025>=.01&&sLung>lungScore){lungScore=sLung;lung=pose;lungCi=ci}});
  // pleura: first lung sample along the central line of the chosen position
  let pleura=null;if(lung){const c=lungRun(lungCi,3);pleura=R[c.a]}
  return state.artifactPoses={rib,lung,pleura};
 }
 // ---------------------------------------------------------------- selection
 async function select(id){cur=id;const ch=BY_ID[id];host.querySelectorAll('[data-ch]').forEach(b=>b.classList.toggle('active',b.dataset.ch===id));$('ph-body').hidden=false;$('ph-key').textContent=ch.key;
  F('ph-title').textContent=ch.title;F('ph-sub').textContent=`${ch.group} · ${CHAPTERS.indexOf(ch)+1} de ${CHAPTERS.length}`;show(true);figure.focus({preventScroll:true});run()}
 async function run(){const my=++gen;cancelAnimationFrame(raf);const ch=BY_ID[cur];if(!ch)return;$('ph-read').innerHTML='';
  try{await api.normal?.();api.status(`Física · ${ch.title}`);await RUN[ch.id](my)}catch(e){console.error(e);if(my===gen)api.status('No se pudo calcular la figura: '+e.message)}}
 return {enter(){if(cur)select(cur)},leave(){show(false)},select,get chapter(){return cur},chapters:CHAPTERS};
}
