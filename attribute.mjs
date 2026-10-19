// Where a measurement error comes from. A measurement is compared with the exact value of the simulated heart and the
// difference is split into additive terms by counterfactuals — "what would you have read if only this had been right?" —
// so the terms add up to the error exactly (a telescoping sum, no unexplained remainder). Worker-safe, no DOM.
//
// Doppler velocity: reported − truth = cursor + scale + angle + gate + simulator
//   cursor     where the reader put the cursor (and what was written down) against the highest velocity the display could show
//   scale      the display could not show it (aliasing wrap in PW; scale too small cuts the envelope)
//   angle      the beam was not aligned with the jet: the Doppler shift carries v·cos θ (Quiñones 2002)
//   gate       the sample volume was not on the jet (PW; CW sweeps the line, so ~0)
//   simulator  what remains with the best aim on the jet: finite resolution and jet profile of the model, not the reader
// Defect size: truth − measured = plane + caliper
//   plane      the cut does not pass through the middle of the defect: a plane at distance d from the centre of a sphere of
//              radius r shows a chord 2·√(r² − d²), shorter than the diameter
//   caliper    placement of the calipers on the image (edges, blur) — everything else
export const ATTRIBUTION_SOURCES=['quinones2002','docencia'];
export const VELOCITY_TERMS=[
 {id:'cursor',label:'Lectura del cursor',hint:'Marca la cresta de la envolvente, ni por encima (el ensanchamiento del espectro engaña) ni por dentro, y copia el número tal cual.'},
 {id:'scale',label:'Escala y aliasing',hint:'Sube la escala o baja la línea base hasta que el espectro no se corte ni se envuelva; en un chorro rápido usa Doppler continuo.'},
 {id:'angle',label:'Ángulo con el chorro',hint:'Alinea el cursor con el chorro (el color ayuda): la velocidad medida es v·cos θ.'},
 {id:'gate',label:'Posición del volumen de muestra',hint:'Coloca el volumen de muestra sobre el chorro, en su parte más estrecha.'},
 {id:'simulator',label:'Límite del simulador',hint:'Con el mejor ángulo y sobre el chorro queda el perfil del chorro y la resolución espectral del modelo.'}
];
export const SIZE_TERMS=[
 {id:'plane',label:'Plano fuera del centro del defecto',hint:'Barre hasta ver el diámetro máximo del defecto: el plano debe pasar por su centro.'},
 {id:'caliper',label:'Colocación de los calibradores',hint:'Mide de borde a borde del defecto, en el instante de mayor apertura.'}
];

// chord of a sphere (radius r) cut by a plane at distance d from its centre; same units
export function chordAtOffset(r,d){const x=r*r-d*d;return x>0?2*Math.sqrt(x):0}

// velocities in m/s (magnitudes). reported: what the reader wrote down; truth: the model's jet peak; peakStudent: highest
// beam velocity in the reader's own spectrum; peakAimed: same gate, best aim; peakGated: gate on the jet, best aim;
// ceiling: the highest velocity the display could show on the side of the flow
export function attributeVelocity({truth,reported,peakStudent,peakAimed,peakGated,ceiling=Infinity}){
 const t=Math.abs(truth),r=Math.abs(reported),pS=Math.abs(peakStudent),pA=Math.max(pS,Math.abs(peakAimed)),pG=Math.max(pA,Math.abs(peakGated));
 const readable=Math.min(pS,ceiling);
 const terms={cursor:r-readable,scale:readable-pS,angle:pS-pA,gate:pA-pG,simulator:pG-t};
 return finish(terms,r-t,VELOCITY_TERMS,'m/s',2);
}
// sizes in mm. truthMM: diameter of the defect; chordMM: what a plane at this offset can show; measuredMM: the reader's caliper
export function attributeSize({truthMM,chordMM,measuredMM}){
 const terms={plane:chordMM-truthMM,caliper:measuredMM-chordMM};
 return finish(terms,measuredMM-truthMM,SIZE_TERMS,'mm',1);
}
// signed terms (positive = the reader's number is too high because of it), sorted by size, with the main cause
function finish(terms,error,defs,unit,digits){
 const rows=defs.map(d=>({id:d.id,label:d.label,hint:d.hint,value:terms[d.id]}));
 const sum=rows.reduce((a,x)=>a+x.value,0);
 const main=[...rows].filter(x=>x.id!=='simulator').sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
 const total=Math.abs(error);
 return {unit,error,digits,rows,sum,exact:Math.abs(sum-error)<1e-9,main:main&&Math.abs(main.value)>=Math.max(unit==='mm'?.3:.03,.1*total)?main.id:null};
}
