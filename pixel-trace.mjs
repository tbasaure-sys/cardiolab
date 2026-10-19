// «Pregúntale al píxel»: turns the trace of one scan line (bmode.mjs render, opts.trace={j}) into an explanation of one pixel
// of the echo image: which tissue is there, how much energy reached it and what was lost on the way (attenuation by
// tissue, reflections at interfaces, bone and lung shadows) and where its brightness comes from (speckle, specular
// reflection, near-field haze, reverberation, valve leaflet, side lobes, receiver noise). Pure, no DOM: the panel, the
// tests and the lessons share it. Everything is read from what the renderer computed for that very frame.
import {LABEL,LABEL_NAMES,BLOOD} from './tissue.mjs';

const NAMES={...LABEL_NAMES,[LABEL.AIR]:'Gel o aire',[LABEL.SKIN]:'Piel',[LABEL.SUBCUT]:'Grasa subcutánea',[LABEL.MUSCLE]:'Músculo de la pared torácica',[LABEL.MEDIASTINUM]:'Mediastino',[LABEL.LUNG]:'Pulmón',[LABEL.BONE]:'Costilla o esternón',[LABEL.SOFT]:'Tejido blando',[LABEL.CARTILAGE]:'Cartílago',[LABEL.LIVER]:'Hígado',[LABEL.FAT]:'Grasa',[LABEL.MITRAL]:'Válvula mitral',[LABEL.TRICUSPID]:'Válvula tricúspide',[LABEL.AORTIC_VALVE]:'Válvula aórtica',[LABEL.PULMONARY_VALVE]:'Válvula pulmonar'};
export const labelName=l=>NAMES[l]||'Tejido';
const f0=v=>Math.round(v).toString(),f1=v=>v.toFixed(1).replace('.',',');
export const SOURCES={
 speckle:{label:'Textura propia del tejido (speckle)',note:'El patrón de puntos no es anatomía: cambia con la frecuencia, el ángulo y el movimiento.'},
 especular:{label:'Reflexión en una superficie (especular)',note:'Brilla más cuanto más perpendicular llega el haz a la superficie.'},
 cercano:{label:'Neblina y ruido del campo cercano',note:'Eco de la pared torácica y de la cara de la sonda, más fuerte cerca de ella.'},
 reverberacion:{label:'Eco repetido (reverberación)',note:'Un eco rebota entre la sonda y la pared torácica y vuelve al doble de profundidad: una copia fantasma.'},
 valva:{label:'Velo valvular',note:'Un velo fino y móvil, dibujado aparte de la textura del tejido.'},
 pulmon:{label:'Reverberación del pulmón (líneas A)',note:'Ecos repetidos entre la sonda y la pleura: no son estructuras.'},
 lobulos:{label:'Lóbulos laterales',note:'Halo débil alrededor de paredes muy brillantes, que rellena las cavidades vecinas.'},
 ruido:{label:'Ruido del receptor',note:'Cambia en cada cuadro; solo se ve con ganancia alta o lejos de la sonda.'}
};
const CAT={pDiff:'speckle',pSpec:'especular',pClut:'cercano',pRing:'cercano',pRev:'reverberacion',pLeaf:'valva',pLung:'pulmon'};

// k: sample index along the traced line. Returns a structured explanation (numbers) and Spanish sentences.
export function explainPixel(T,k){
 if(!T||k<0||k>=T.n)return null;const {drp,freq}=T.geo,w=Math.max(2,Math.round(2*(T.sigA||2)));
 const lab=T.lab[k],depthCm=(k+.5)*drp*100;
 // losses so far, in dB (round trip): attenuation by tissue, reflections at interfaces, bone and lung shadows
 const att=T.att[k],iface=T.iface[k],shadow=T.shadow[k],total=att+iface+shadow;
 const byTissue={};for(let m=0;m<k;m++){const l=T.lab[m];byTissue[l]=(byTissue[l]||0)+T.stepDB[l]}
 const tissues=Object.entries(byTissue).map(([l,dB])=>({label:+l,name:labelName(+l),dB})).filter(t=>t.dB>.05).sort((a,b)=>b.dB-a.dB);
 // interfaces and shadow casters before the pixel (and those within the pulse window around it)
 const events=T.events.filter(e=>e.k<=k+w).map(e=>e.kind==='iface'?{...e,depthCm:(e.k+.5)*drp*100,fromName:labelName(e.from),toName:labelName(e.to),lossDB:-20*Math.log10(Math.max(1e-9,1-e.rc*e.rc)),angleDeg:Math.acos(Math.min(1,e.cosi))*180/Math.PI}:{...e,depthCm:(e.k+.5)*drp*100});
 // shares of the local echo power over the pulse window (weighted by the machine's depth gain), then side lobes and noise
 const lo=Math.max(0,k-w),hi=Math.min(T.n-1,k+w),src={};let sum=0;
 for(const key of Object.keys(CAT)){let p=0;for(let m=lo;m<=hi;m++)p+=T[key][m]*T.comp[m]*T.comp[m];src[key]=p;sum+=p}
 const echoP=T.sig[k]*T.sig[k],sideP=T.side[k]*T.side[k],noiseP=T.noise[k]*T.noise[k],totalP=echoP+sideP+noiseP||1;
 const shares={};for(const id of Object.keys(SOURCES))shares[id]=0;
 for(const [key,id] of Object.entries(CAT))shares[id]+=sum>0?echoP*(src[key]/sum)/totalP:0;
 shares.lobulos=sideP/totalP;shares.ruido=noiseP/totalP;
 const ranked=Object.entries(shares).map(([id,v])=>({id,...SOURCES[id],pct:100*v})).filter(s=>s.pct>=1).sort((a,b)=>b.pct-a.pct);
 // verdict: the main reason this pixel looks as it does
 const pc=Object.fromEntries(Object.entries(shares).map(([id,v])=>[id,100*v])); // shares in percent (verdict thresholds)
 const caster=[...events].reverse().find(e=>(e.kind==='bone'||e.kind==='lung')&&e.k<k-1),blood=BLOOD.has(lab);
 const sinceCaster=caster?total-(T.att[caster.k]+T.iface[caster.k]+T.shadow[caster.k]):0;
 const near=events.filter(e=>e.kind==='iface'&&Math.abs(e.k-k)<=w).sort((a,b)=>Math.abs(b.rc)-Math.abs(a.rc))[0]||null;
 let verdict;
 if(lab===LABEL.AIR&&T.sig[k]===0)verdict={id:'gel',text:'Gel o aire delante de la sonda: aún no hay tejido.'};
 else if(caster&&(shadow>=12||sinceCaster>=14||T.grey[k]<20&&total>=18))verdict={id:'sombra',text:`Sombra: detrás de ${caster.kind==='bone'?'un hueso (costilla o esternón)':'pulmón con aire'}, a ${f1(caster.depthCm)} cm, casi no llega sonido. Que esté oscuro no significa que no haya nada.`};
 else if(blood&&(pc.especular+pc.valva)<25&&T.grey[k]<45)verdict={id:'cavidad',text:`Cavidad con sangre: la sangre apenas devuelve eco y se ve negra. Lo poco que hay (${f0(T.grey[k])} de 255) es ${ranked[0]?ranked[0].label.toLowerCase():'ruido'}, no tejido.`};
 else if(blood&&pc.speckle<30)verdict={id:'neblina',text:`Cavidad con sangre, pero con ${f0(T.grey[k])} de 255: lo que se ve no es tejido sino ${ranked[0]?ranked[0].label.toLowerCase():'ruido'}. Si te preocupa, baja la ganancia o activa la armónica.`};
 else if(pc.pulmon>=35)verdict={id:'pulmon',text:'Reverberación del pulmón: son ecos repetidos entre la sonda y la pleura, no estructuras.'};
 else if(pc.reverberacion>=25)verdict={id:'reverberacion',text:'Eco repetido: una copia fantasma de una estructura cercana a la sonda (reverberación), al doble de su profundidad.'};
 else if(pc.valva>=30)verdict={id:'valva',text:'Velo valvular: una estructura fina y móvil; su brillo depende del instante del latido.'};
 else if(pc.especular>=35||near&&Math.abs(near.rc)>.04&&near.angleDeg<30)verdict={id:'especular',text:`Superficie que refleja: ${near?`${near.fromName} → ${near.toName} a ${f1(near.depthCm)} cm, haz a ${f0(near.angleDeg)}° de la perpendicular`:'una interfaz bien alineada'}. Cuanto más oblicuo el haz, más débil el eco (caída de señal, «dropout»).`};
 else verdict={id:'speckle',text:`Tejido (${labelName(lab).toLowerCase()}): su brillo es la textura propia del tejido, con ${f0(T.grey[k])} de 255. Los puntos individuales no son anatomía.`};
 const sentences=[
  `A ${f1(depthCm)} cm de la sonda; tejido: ${labelName(lab)}.`,
  total>.5?`El pulso llega con ${f1(total)} dB menos que al salir (ida y vuelta): ${f1(att)} dB por atenuación${tissues.length?` (${tissues.slice(0,3).map(t=>`${t.name.toLowerCase()} ${f1(t.dB)}`).join(', ')})`:''}${iface>.05?`, ${f1(iface)} dB por reflexiones en interfaces`:''}${shadow>.05?`, ${f1(shadow)} dB por sombra de hueso o pulmón`:''}.`:'Casi no se ha perdido energía hasta aquí.',
  verdict.text];
 return {k,depthCm,label:lab,name:labelName(lab),grey:T.grey[k],db:T.db[k],loss:{total,att,iface,shadow},tissues,events,shares:ranked,verdict,sentences,freq,
  // the line as a profile for the panel: energy still travelling (dB below the start) and the echo level, by depth
  profile:{depthCm:Array.from({length:T.n},(_,m)=>(m+.5)*drp*100),lossDB:Array.from({length:T.n},(_,m)=>T.att[m]+T.iface[m]+T.shadow[m]),grey:Array.from(T.grey)}};
}
// the scan line and sample of a point of the image plane (x lateral, y depth, atlas units) for a frame geometry
export function pixelOf(frame,x,y){const sec=frame.sector*Math.PI/180,th=Math.atan2(x,y),r=Math.hypot(x,y);
 if(y<=0||r>=frame.depth||Math.abs(th)>sec/2)return null;return {j:Math.min(frame.lines-1,Math.max(0,Math.floor((th+sec/2)/sec*frame.lines))),k:Math.min(frame.samples-1,Math.floor(r/frame.depth*frame.samples))}}
