// Patient presets: body size, heart rate and a typical starting probe frequency. The atlas heart (an adult) is
// scaled linearly with √(BSA / BSA of the atlas adult): linear cardiac dimensions grow roughly with BSA^0.5.
export const ATLAS_ADULT={weight:70,height:172};
export const PATIENTS=[
 {id:'neonate',name:'Recién nacido',age:'3 días',weight:3.4,height:50,hr:140,freq:10},
 {id:'infant',name:'Lactante',age:'6 meses',weight:7.5,height:66,hr:125,freq:8},
 {id:'toddler',name:'Preescolar',age:'2 años',weight:12.5,height:87,hr:110,freq:7},
 {id:'child',name:'Escolar',age:'6 años',weight:21,height:116,hr:95,freq:6},
 {id:'preteen',name:'Escolar mayor',age:'10 años',weight:32,height:139,hr:85,freq:5},
 {id:'teen',name:'Adolescente',age:'15 años',weight:55,height:168,hr:75,freq:4},
 {id:'adult',name:'Adulto (atlas)',age:'adulto',weight:70,height:172,hr:70,freq:3}
];
export const PATIENT_BY_ID=Object.fromEntries(PATIENTS.map(p=>[p.id,p]));
// Haycock formula (m²), weight in kg and height in cm
export function bsaHaycock(weight,height){return .024265*weight**.5378*height**.3964}
export function bodyScale(p){return Math.sqrt(bsaHaycock(p.weight,p.height)/bsaHaycock(ATLAS_ADULT.weight,ATLAS_ADULT.height))}
export function describePatient(p){return `${p.name} · ${p.age} · ${String(p.weight).replace('.',',')} kg · ${p.height} cm · SC ${bsaHaycock(p.weight,p.height).toFixed(2).replace('.',',')} m²`}
