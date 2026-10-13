// «Estudio por gravedad»: one slider moves a shunt from absent to large (and the pulmonary resistance from normal to
// suprasystemic); the whole simulated study follows it: the lesion view with colour Doppler, the chambers (enlarged by
// the volume overload), the spectral Doppler of the jet and of both outflow tracts, and a strip of measurements with the
// model's bands. Every image is rendered by the simulator from the same heart that the live probe scans.
import {shuntState,variantSpec,LESIONS,PVR,SHUNT_SOURCES} from './shunt-model.mjs';
import {scanConvert} from './bmode.mjs';
import {roiAround} from './flow.mjs';
import {VIEW_INFO} from './views.mjs';
import {planeThrough,lessonContext} from './lesson-engine.mjs';
import {tag,sourcesReady} from './provenance.mjs';

const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1=v=>v.toFixed(1).replace('.',','),f2=v=>v.toFixed(2).replace('.',',');
const WINDOW_PRESET={plax:'plax',psax:'psax',apical:'apical',subcostal:'subcostal',ssn:'ssn'};
const CINE=8;
// what each lesion is studied with: lesion view + colour, chambers view, jet spectrum, outflow tracts
const PLAN={
 asd2:{lesion:{view:'sc4c',at:'asdSecundum',nyquist:.45,title:'Subcostal 4C · color en la fosa oval'},chambers:{view:'a4c',title:'Apical 4C · cavidades derechas'},
  jet:{view:'sc4c',at:'asdSecundum',mode:'pw',title:'PW · flujo a través de la CIA'}},
 vsdpm:{lesion:{view:'plax',at:'vsdPerimembranous',title:'Paraesternal largo · color bajo la aorta'},chambers:{view:'a4c',title:'Apical 4C · cavidades izquierdas'},
  jet:{view:'plax',at:'vsdPerimembranous',mode:'cw',title:'CW · chorro de la CIV'}},
 vsdm:{lesion:{view:'a4c',at:'vsdMuscular',title:'Apical 4C · color en el septo trabecular'},chambers:{view:'plax',title:'Paraesternal largo · cavidades izquierdas'},
  jet:{view:'a4c',at:'vsdMuscular',mode:'cw',title:'CW · chorro de la CIV'}},
 pda:{lesion:{plane:{window:'psax',contact:'psaxAV',through:['pulmonaryValve','ductPulmonary'],aim:.5},at:'ductPulmonary',title:'Corte ductal · color en la bifurcación'},chambers:{view:'a4c',title:'Apical 4C · cavidades izquierdas'},
  jet:{plane:{window:'psax',contact:'psaxAV',through:['pulmonaryValve','ductPulmonary'],aim:.5},at:'ductJet',mode:'cw',title:'CW · flujo ductal'}}
};

export function mountStudy(api){
 // api: {host, figure, engine, views, landmarks(), patient(), ySign(windowPreset), freq(), bodyScale(), onVariant(spec), status(text)}
 const {host,figure}=api;let lesion='asd2',size=.6,pvr='normal',gen=0,timer=0,raf=0,playing=false,cine={lesion:[],chambers:[]},spectra={},open=false;
 const ctxL=()=>lessonContext(api.landmarks(),api.views,'ref');
 host.innerHTML=`<p class="micro">Un control lleva el defecto de ausente a grande; la imagen, el color, los espectros y las medidas cambian juntos. Es la misma anatomía que exploras con la sonda.</p>
  <label class="field"><span>Defecto</span><select id="st-lesion">${Object.entries(LESIONS).map(([k,v])=>`<option value="${k}">${esc(v.name)}</option>`).join('')}</select></label>
  <div class="field"><span>Tamaño del defecto <output id="st-size-out"></output></span><input id="st-size" type="range" min="0" max="1" step="0.05" value="${size}"><div class="st-bands" id="st-bands"></div></div>
  <div class="field"><span>Resistencia vascular pulmonar</span><div class="seg" id="st-pvr">${Object.entries(PVR).map(([k,v])=>`<button data-pvr="${k}" class="${k===pvr?'active':''}">${esc(v.name)}</button>`).join('')}</div></div>
  <div class="st-actions"><button id="st-play" class="primary">▶ Recorrer de ausente a grande</button><button id="st-figure">Ver el estudio</button><button id="st-live">Explorar en vivo</button></div>
  <div id="st-grade" class="st-grade" aria-live="polite"></div><div id="st-strip" class="st-strip"></div>
  <details class="st-how"><summary>Cómo se calcula y qué es supuesto</summary><p>Modelo docente de circuito: el flujo sistémico sale del índice cardíaco; la presión pulmonar, de la resistencia pulmonar por el flujo pulmonar; el defecto es un orificio (Q = Cd·A·√(2ΔP/ρ)), así que un defecto grande deja de ser restrictivo porque las presiones se igualan. Las cavidades que reciben el volumen extra se agrandan con una deformación reversible del volumen acústico; con presión del VD alta, su pared se engruesa.</p>
  <p>Con fuente: el cortocircuito depende del tamaño del defecto y de la relación entre resistencias pulmonar y sistémica; una CIV pequeña es restrictiva (gradiente alto, presión del VD baja) y una grande no; la dilatación de AI y VI indica una CIV con cortocircuito grande; un defecto ≥ ½ de la raíz aórtica tiene repercusión (Spicer 2014). En el ductus, el gasto del VI lleva el flujo sistémico más el cortocircuito (van Laere 2018). ΔP = 4v².</p>
  <p>Supuestos del modelo, sin fuente clínica: índice cardíaco, presión arterial por edad, valores de resistencia pulmonar, coeficiente del orificio, gradiente interauricular, cuánto se dilata una cavidad por el flujo extra. Las bandas («sin sobrecarga», «moderada», «importante», «restrictivo») son del modelo, no umbrales clínicos. Los valores no sirven para interpretar estudios reales.</p></details>`;
 const $=id=>host.querySelector('#'+id);
 // ---------------------------------------------------------------- figure (four panels over the workspace)
 figure.innerHTML=`<div class="st-head"><b id="st-title"></b><span id="st-sub" class="micro"></span><button id="st-link" title="Copia un enlace que abre el estudio con esta lesión, tamaño y resistencia">Copiar enlace</button><button id="st-close" aria-label="Cerrar el estudio">✕</button></div>
  <div class="st-grid"><figure><figcaption id="st-cap-lesion"></figcaption><canvas id="st-c-lesion"></canvas></figure><figure><figcaption id="st-cap-chambers"></figcaption><canvas id="st-c-chambers"></canvas></figure>
  <figure><figcaption id="st-cap-jet"></figcaption><canvas id="st-c-jet"></canvas></figure><figure><figcaption>PW · flujo pulmonar y sistémico (Qp y Qs)</figcaption><canvas id="st-c-out"></canvas></figure></div>
  <p class="micro st-foot">Imágenes simuladas por el mismo motor que la sonda en vivo · modelo docente, no diagnóstico</p>`;
 const F=id=>figure.querySelector('#'+id);F('st-close').onclick=()=>showFigure(false);F('st-link').onclick=()=>api.copyLink?.();
 function showFigure(on){open=on;figure.hidden=!on;document.body.classList.toggle('study-open',on);if(on){refresh();loop()}else{cancelAnimationFrame(raf)}}
 // ---------------------------------------------------------------- state → model → UI
 const state=()=>shuntState({lesion,size,pvr,patient:api.patient()});
 function poseFor(p){const t=p.plane?planeThrough(p.plane,ctxL()):api.views[p.view];return {origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:p.plane?80:(t.sector||80)}}
 function point(at){const lm=api.landmarks();if(at==='ductJet')return lm.ductPulmonary.map((v,i)=>v+(lm.pulmonaryValve[i]-v)*.25);return lm[at]}
 function windowOf(p){return p.plane?'psax':VIEW_INFO[p.view].window}
 function renderStrip(s){
  const L=LESIONS[lesion],g=s.gains,ov=L.overload,maxG=Math.max(0,...ov.map(c=>g[c]||0));
  const bar=(v,min,max,bands,ticks=[])=>{const x=q=>Math.max(0,Math.min(100,(q-min)/(max-min)*100));return `<span class="st-bar">${bands.map(([a,b,c])=>`<i class="b-${c}" style="left:${x(a)}%;width:${x(b)-x(a)}%"></i>`).join('')}${ticks.map(([t,l])=>`<em style="left:${x(t)}%" title="${esc(l)}"></em>`).join('')}<b style="left:${x(v)}%"></b></span>`};
  const rows=[];
  rows.push(['Defecto',`${s.size?f1(s.defect.diameterMM)+' mm':'—'}`,s.defect.rootRatio!=null&&s.size?`${f2(s.defect.rootRatio)} de la raíz aórtica (${f1(s.defect.rootMM)} mm) ${tag({fuente:['spicer2014']})}${bar(s.defect.rootRatio,0,1,[[0,.5,'ok'],[.5,1,'hi']],[[.5,'½ raíz aórtica: repercusión (Spicer 2014)']])}`:'','modelo']);
  rows.push(['Dirección',esc(s.flows.direction),'','modelo']);
  rows.push(['Qp/Qs',f2(s.flows.qpqs),'= (VTI × área) pulmonar / (VTI × área) sistémica'+bar(s.flows.qpqs,.5,4.5,[[.5,1,'rev'],[1,1.15,'ok'],[1.15,1.8,'mid'],[1.8,4.5,'hi']])+'<small>bandas del modelo</small>','modelo']);
  if(s.size){const v=Math.abs(s.jet.sys),dp=4*v*v;rows.push([lesion==='pda'?'Velocidad ductal':'Velocidad del chorro',`${f2(v)} m/s${lesion==='pda'?` · diást. ${f2(Math.abs(s.jet.dia))}`:''}`,`ΔP = 4v² ≈ ${Math.round(dp)} mmHg${lesion.startsWith('vsd')&&s.jet.sys>0?` · PSVD ≈ PAS ${Math.round(s.patient.sbp)} − ${Math.round(dp)} = ${Math.round(s.patient.sbp-dp)} mmHg`:''} ${tag(['ecuacion',{fuente:['quinones2002']}],'ΔP = 4v²')}`,'modelo'])}
  rows.push(['Presión sistólica VD',`${Math.round(s.pressures.rvSys)} mmHg`,`${Math.round(s.pressures.rvRatio*100)} % de la sistémica`+bar(s.pressures.rvRatio,0,1.3,[[0,.45,'ok'],[.45,.75,'mid'],[.75,1.3,'hi']])+'<small>bandas del modelo</small>','modelo']);
  for(const c of ov)rows.push([{RA:'AD',RV:'VD',LA:'AI',LV:'VI'}[c],`+${Math.round((g[c]||0)*100)} % de diámetro`,`volumen × ${f2((1+(g[c]||0))**3)}`+bar(g[c]||0,0,.32,[[0,.04,'ok'],[.04,.12,'mid'],[.12,.32,'hi']])+'<small>sobre el normal de este paciente · bandas del modelo</small>','modelo']);
  if(s.rvWallMM>.3)rows.push(['Pared libre del VD',`+${f1(s.rvWallMM*s.patient.k)} mm`,'engrosada por la carga de presión','modelo']);
  $('st-strip').innerHTML=`<dl>${rows.map(([k,v,d,p])=>`<dt>${k}</dt><dd><b>${v}</b>${p?' '+tag(p):''}${d?`<div>${d}</div>`:''}</dd>`).join('')}</dl>`;
  $('st-grade').innerHTML=`<span class="st-chip k-${s.grade.key}">${esc(s.grade.label)}</span>`;
  $('st-size-out').textContent=s.size?`${f1(s.defect.diameterMM)} mm`:'sin defecto';
 }
 function bands(){const pts=[0,.2,.4,.6,.8,1].map(x=>({x,s:shuntState({lesion,size:x,pvr,patient:api.patient()})}));
  $('st-bands').innerHTML=pts.slice(1).map((p,i)=>`<i class="k-${p.s.grade.key}" style="left:${pts[i].x*100}%;width:${(p.x-pts[i].x)*100}%"></i>`).join('')}
 // ---------------------------------------------------------------- rendering
 async function refresh(){
  const my=++gen,s=state();renderStrip(s);bands();api.onRoute?.({route:'estudio',id:lesion,params:{tam:+size.toFixed(2),rvp:pvr}});
  const spec=variantSpec(s);api.status('Aplicando el defecto al corazón simulado…');await api.engine.setVariant(spec);api.onVariant(spec);if(my!==gen)return;
  api.status(`${LESIONS[lesion].name} · ${s.grade.label}`);
  if(!open)return;
  const P=PLAN[lesion];F('st-title').textContent=`${LESIONS[lesion].name} · ${s.size?f1(s.defect.diameterMM)+' mm':'sin defecto'} · RVP ${PVR[pvr].name.toLowerCase()}`;F('st-sub').textContent=`${api.patient().name} · Qp/Qs ${f2(s.flows.qpqs)} · ${s.grade.label}`;
  F('st-cap-lesion').textContent=P.lesion.title;F('st-cap-chambers').textContent=P.chambers.title;F('st-cap-jet').textContent=P.jet.title;
  cine={lesion:[],chambers:[]};spectra={};
  const views=[['lesion',P.lesion,true],['chambers',P.chambers,false]];
  // end-diastole first, then the rest of the cycle
  const order=[0,4,2,6,1,3,5,7];
  const spec2=[spectrum('jet',P.jet,s,my),spectrum('rvot',null,s,my),spectrum('lvot',null,s,my)];
  for(const i of order){for(const [k,p,color] of views){if(my!==gen)return;await renderView(k,p,color,i,my)}}
  await Promise.all(spec2);
 }
 async function renderView(key,p,color,i,my){
  const pose=poseFor(p),pt0=point(p.at),pt=color&&pt0?(await api.engine.warp([pt0]))[0]:pt0,col=color&&pt?{on:true,nyquist:p.nyquist||.7,roi:roiAround(pose,pt,{half:15,span:.05})}:{on:false};if(my!==gen)return;
  const frame=await api.engine.renderOnce(pose,{phase:(i+.5)/CINE,lines:144,beating:true,color:col,bodyScale:api.bodyScale(),freq:api.freq()});if(my!==gen)return;
  const c=F('st-c-'+key),r=c.getBoundingClientRect(),w=Math.max(200,Math.round(r.width)),h=Math.max(150,Math.round(r.height));if(c.width!==w||c.height!==h){c.width=w;c.height=h}
  const ySign=api.ySign(WINDOW_PRESET[windowOf(p)]),scale=Math.min((w-24)/(2*pose.depth*Math.sin(pose.sector*Math.PI/360)),(h-24)/pose.depth),cy=ySign===1?12:h-12;
  const off=document.createElement('canvas');off.width=w;off.height=h;const g=off.getContext('2d'),img=g.createImageData(w,h);scanConvert(frame,img,{cx:w/2,cy,scale,ySign},1);g.putImageData(img,0,0);
  cine[key][i]=off;
 }
 async function spectrum(key,p,s,my){
  const lm=api.landmarks(),unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};let pose,pt,mode='pw',title;
  if(key==='jet'){pose=poseFor(p);pt=point(p.at);mode=p.mode}
  // Qp/Qs gates: main PA just above the valve (in a ductus, the RVOT below it, away from the ductal jet); LVOT 6 mm below the aortic valve
  else if(key==='rvot'){pose=poseFor({view:'psaxAV'});pt=lesion==='pda'?lm.pulmonaryValve.map((v,i)=>v+unit(lm.rvApex.map((x,j)=>x-lm.pulmonaryValve[j]))[i]*.004):lm.pulmonaryValve.map((v,i)=>v+unit(lm.ductPulmonary.map((x,j)=>x-lm.pulmonaryValve[j]))[i]*.006)}
  else {pose=poseFor({view:'a5c'});pt=lm.aorticValve.map((v,i)=>v+unit(lm.lvApexCavity.map((x,j)=>x-lm.aorticValve[j]))[i]*.006)}
  // the landmark moved with the enlarged chambers: put the gate where it is now
  pt=(await api.engine.warp([pt]))[0];if(my!==gen)return;
  const q=pt.map((v,i)=>v-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2];
  const jetV=Math.max(Math.abs(s.jet.sys),Math.abs(s.jet.dia));
  // Doppler at a lower frequency than the image (higher Nyquist limit), baseline shifted toward the expected flow
  const base=key==='rvot'||key==='lvot'?.8:pvr!=='normal'?.5:lesion==='asd2'?.25:.3;
  const sp=await api.engine.spectrum({pose,theta:Math.atan2(x,y)*180/Math.PI,gateDepth:Math.hypot(x,y),gateLen:.003,mode,freq:3.5,scale:mode==='cw'?Math.max(2,Math.ceil(jetV+.6)):key==='rvot'||key==='lvot'?1.5:null,baseline:base,gain:1,bodyScale:api.bodyScale(),optimize:{range:6,step:1}});
  if(my!==gen)return;spectra[key]=sp;drawSpectra(s);
 }
 function paintSpectrum(g,sp,x0,y0,W,H,label,note){
  g.fillStyle='#000';g.fillRect(x0,y0,W,H);if(!sp){g.fillStyle='#8aa1ae';g.font='12px Segoe UI, sans-serif';g.fillText('Calculando el espectro…',x0+50,y0+H/2);return}
  const ax=36,iw=Math.max(1,Math.round(W-ax-6)),ih=Math.max(1,Math.round(H-28)),c=document.createElement('canvas');c.width=iw;c.height=ih;const sc=c.getContext('2d'),img=sc.createImageData(iw,ih),a=img.data;
  for(let x=0;x<iw;x++){const col=Math.floor(((x/iw*2)%1)*sp.cols);for(let y=0;y<ih;y++){const k=Math.min(sp.bins-1,Math.floor(y/ih*sp.bins)),v=sp.data[k*sp.cols+col],i=(y*iw+x)*4;a[i]=v*.96;a[i+1]=v;a[i+2]=v*1.04;a[i+3]=255}}
  sc.putImageData(img,0,0);g.drawImage(c,x0+ax,y0+20);
  const vy=v=>y0+20+(sp.top-v)/(sp.top-sp.bottom)*ih;g.strokeStyle='#7fb6ff';g.beginPath();g.moveTo(x0+ax,vy(0));g.lineTo(x0+ax+iw,vy(0));g.stroke();
  g.font='10px Consolas, monospace';g.fillStyle='#9fb2bd';g.textAlign='right';const step=[.25,.5,1,2].find(v=>v*ih/(sp.top-sp.bottom)>=16)||2;
  for(let v=Math.ceil(sp.bottom/step)*step;v<=sp.top+1e-9;v+=step)g.fillText(v.toFixed(step<.5?2:1),x0+ax-4,vy(v)+3);
  g.textAlign='left';g.fillStyle='#e6edf2';g.font='11px Segoe UI, sans-serif';g.fillText(label,x0+ax,y0+13);if(note){g.fillStyle='#ffe398';g.textAlign='right';g.fillText(note,x0+W-6,y0+13);g.textAlign='left'}
 }
 function drawSpectra(s){
  const hr=api.patient().hr;
  {const c=F('st-c-jet'),r=c.getBoundingClientRect(),w=Math.max(220,Math.round(r.width)),h=Math.max(150,Math.round(r.height));if(c.width!==w||c.height!==h){c.width=w;c.height=h}const g=c.getContext('2d');const sp=spectra.jet;
   paintSpectrum(g,sp,0,0,w,h,sp?`${sp.mode.toUpperCase()} · Vmáx ${f2(Math.abs(sp.vPeak))} m/s · ΔP ${Math.round(4*sp.vPeak*sp.vPeak)} mmHg`:'',s.size?'':'sin defecto')}
  {const c=F('st-c-out'),r=c.getBoundingClientRect(),w=Math.max(220,Math.round(r.width)),h=Math.max(150,Math.round(r.height));if(c.width!==w||c.height!==h){c.width=w;c.height=h}const g=c.getContext('2d');
   const rv=spectra.rvot,lv=spectra.lvot,pdaNote=lesion==='pda';
   paintSpectrum(g,rv,0,0,w,h/2-2,rv?`PW · ${pdaNote?'TSVD':'tronco pulmonar'} (psax) · Vmáx ${f2(Math.abs(rv.vPeak))} m/s`:'',pdaNote?'lleva Qs (proximal al ductus)':'lleva Qp');
   paintSpectrum(g,lv,0,h/2+2,w,h/2-2,lv?`PW · TSVI (apical 5C) · Vmáx ${f2(Math.abs(lv.vPeak))} m/s`:'',pdaNote?'lleva Qp (gasto del VI)':'lleva Qs')}
 }
 // cine at the patient's heart rate
 function loop(){cancelAnimationFrame(raf);const t0=performance.now();const draw=now=>{if(!open)return;raf=requestAnimationFrame(draw);const hr=api.patient().hr,i=Math.floor(((now-t0)/1000*hr/60%1)*CINE);
  for(const key of ['lesion','chambers']){const c=F('st-c-'+key),frames=cine[key];let f=frames[i];for(let d=1;!f&&d<CINE;d++)f=frames[(i-d+CINE)%CINE];if(!f)continue;if(c.width!==f.width||c.height!==f.height){c.width=f.width;c.height=f.height}c.getContext('2d').drawImage(f,0,0)}};raf=requestAnimationFrame(draw)}
 // ---------------------------------------------------------------- controls
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,250)};
 $('st-lesion').onchange=()=>{lesion=$('st-lesion').value;schedule()};
 $('st-size').oninput=()=>{size=Number($('st-size').value);renderStrip(state())};$('st-size').onchange=schedule;
 host.querySelectorAll('[data-pvr]').forEach(b=>b.onclick=()=>{pvr=b.dataset.pvr;host.querySelectorAll('[data-pvr]').forEach(x=>x.classList.toggle('active',x===b));schedule()});
 $('st-figure').onclick=()=>showFigure(true);
 $('st-live').onclick=()=>{showFigure(false);api.goLive?.(PLAN[lesion].lesion)};
 $('st-play').onclick=async()=>{if(playing){playing=false;$('st-play').textContent='▶ Recorrer de ausente a grande';return}playing=true;$('st-play').textContent='■ Detener';showFigure(true);
  for(const x of [0,.25,.5,.75,1]){if(!playing)break;size=x;$('st-size').value=String(x);await refresh();await new Promise(r=>setTimeout(r,2200))}playing=false;$('st-play').textContent='▶ Recorrer de ausente a grande'};
 renderStrip(state());bands();sourcesReady.then(()=>renderStrip(state())); // links to the sources once their catalog is loaded
 return {enter(){refresh()},leave(){playing=false;showFigure(false);gen++},get state(){return state()},show:showFigure,refresh,
  set(o){if(o.lesion){lesion=o.lesion;$('st-lesion').value=lesion}if(o.size!=null){size=o.size;$('st-size').value=String(size)}if(o.pvr){pvr=o.pvr;host.querySelectorAll('[data-pvr]').forEach(x=>x.classList.toggle('active',x.dataset.pvr===pvr))}return refresh()},
  sources:SHUNT_SOURCES};
}
