// Calculations of an echo study, each with its formula. Pure functions: what goes in is what the reader measured.
// Sourced: simplified Bernoulli ΔP = 4v² and flow = VTI × area (Quiñones 2002); minor-axis shortening fraction (Lopez 2010).
// Teaching, not clinical: nothing here validates the inputs or replaces the judgement of when a formula applies.
export const CALC_SOURCES=['quinones2002','lopez2010'];
const ok=(...v)=>v.every(x=>Number.isFinite(x));
// pressure gradient (mmHg) from a velocity (m/s)
export function bernoulli(v){return ok(v)?4*v*v:null}
// RV systolic pressure from the tricuspid regurgitation jet and an assumed right atrial pressure (mmHg)
export function rvspFromTR(vTR,rap=5){return ok(vTR,rap)&&vTR>=0?4*vTR*vTR+rap:null}
// RV systolic pressure from a VSD jet: systolic blood pressure minus the LV–RV gradient (no outflow obstruction on either side)
export function rvspFromVSD(sbp,vVSD){return ok(sbp,vVSD)?sbp-4*vVSD*vVSD:null}
export function shortening(dd,ds){return ok(dd,ds)&&dd>0&&ds>=0&&ds<=dd?(dd-ds)/dd:null}
// stroke volume (mL) from the VTI (cm) and the diameter (mm) of the same outflow: VTI × π·(d/2)²
export function strokeVolume(vtiCm,dMM){return ok(vtiCm,dMM)&&vtiCm>0&&dMM>0?vtiCm*Math.PI*(dMM/20)**2:null}
// cardiac output (L/min) and index (L/min/m²)
export function cardiacOutput(svML,hr){return ok(svML,hr)&&svML>0&&hr>0?svML*hr/1000:null}
export function cardiacIndex(co,bsa){return ok(co,bsa)&&bsa>0?co/bsa:null}
// Qp/Qs from both outflows: (VTI × d²) pulmonary / (VTI × d²) systemic — the heart rate and π/4 cancel
export function qpqs(vtiP,dP,vtiS,dS){return ok(vtiP,dP,vtiS,dS)&&vtiP>0&&dP>0&&vtiS>0&&dS>0?(vtiP*dP*dP)/(vtiS*dS*dS):null}
// the list the sheet shows: inputs (id, label, unit), the formula in words and the function
export const SHEET=[
 {id:'bernoulli',name:'Gradiente por velocidad',formula:'ΔP = 4 · v²',source:['quinones2002'],inputs:[['v','Velocidad','m/s']],unit:'mmHg',digits:0,run:i=>bernoulli(i.v)},
 {id:'rvspTR',name:'Presión sistólica del VD por insuficiencia tricuspídea',formula:'PSVD = 4 · v² + PAD',source:['quinones2002'],inputs:[['v','Velocidad de la IT','m/s'],['rap','Presión de AD supuesta','mmHg',5]],unit:'mmHg',digits:0,run:i=>rvspFromTR(i.v,i.rap),note:'La presión de la aurícula derecha es un supuesto; sin estenosis pulmonar, PSVD = presión sistólica pulmonar.'},
 {id:'rvspVSD',name:'Presión sistólica del VD por el chorro de una CIV',formula:'PSVD = PAS − 4 · v²',source:['quinones2002'],inputs:[['sbp','Presión arterial sistólica','mmHg'],['v','Velocidad del chorro','m/s']],unit:'mmHg',digits:0,run:i=>rvspFromVSD(i.sbp,i.v),note:'Válido sin obstrucción del tracto de salida izquierdo.'},
 {id:'fs',name:'Fracción de acortamiento',formula:'FA = (DdVI − DsVI) / DdVI',source:['lopez2010'],inputs:[['dd','DdVI','mm'],['ds','DsVI','mm']],unit:'%',digits:0,scale:100,run:i=>shortening(i.dd,i.ds)},
 {id:'sv',name:'Volumen sistólico y gasto',formula:'VS = VTI · π · (d/2)²  ·  GC = VS · FC',source:['quinones2002'],inputs:[['vti','VTI','cm'],['d','Diámetro del tracto de salida','mm'],['hr','Frecuencia cardíaca','lpm']],unit:'mL',digits:1,run:i=>strokeVolume(i.vti,i.d),extra:i=>{const co=cardiacOutput(strokeVolume(i.vti,i.d),i.hr);return co==null?'':`gasto ${co.toFixed(2).replace('.',',')} L/min`}},
 {id:'qpqs',name:'Qp/Qs por los tractos de salida',formula:'Qp/Qs = (VTI · d²) pulmonar / (VTI · d²) sistémico',source:['quinones2002'],inputs:[['vtiP','VTI pulmonar','cm'],['dP','Diámetro pulmonar','mm'],['vtiS','VTI aórtico','cm'],['dS','Diámetro aórtico','mm']],unit:'',digits:2,run:i=>qpqs(i.vtiP,i.dP,i.vtiS,i.dS),
  note:'En el simulador el flujo de cada válvula semilunar es velocidad × área de su anillo: mide el VTI con el volumen de muestra en la válvula y el haz alineado con el flujo (pulmonar desde la subcostal de salida del VD; aórtico desde la supraesternal o la apical 5C, que aquí queda ~35° fuera de eje y lo subestima) y el diámetro del anillo en la misma válvula. En el ductus el cociente se invierte: la válvula aórtica lleva el Qp y la pulmonar el Qs. El trazo sigue el borde exterior del espectro en ambas válvulas, así que el cociente se conserva.'}
];
