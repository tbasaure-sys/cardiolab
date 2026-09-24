// Congenital and acquired variants applied to the tissue volume. Worker-safe (no DOM).
// Each lesion is a reversible label edit on the atlas; sizes are in metres.
import {LABEL} from './tissue.mjs';

const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const norm=a=>Math.hypot(...a),unit=a=>mul(a,1/(norm(a)||1)),mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const WALLS=new Set([LABEL.LA_WALL,LABEL.RA_WALL,LABEL.LV_MYO,LABEL.RV_MYO,LABEL.FAT,LABEL.SOFT,LABEL.PERICARDIUM]);
const ATRIAL=new Set([LABEL.LA_WALL,LABEL.RA_WALL]);
const VENTRICULAR=new Set([LABEL.LV_MYO,LABEL.RV_MYO]);
const OUTSIDE=new Set([LABEL.SOFT,LABEL.FAT,LABEL.LUNG,LABEL.VESSEL_WALL]);

export const VARIANTS=[
 {id:'normal',name:'Corazón estructuralmente normal',short:'Normal',group:'Referencia',
  views:['plax','psaxPM','a4c','sc4c'],look:['Septos íntegros','Cavidades proporcionadas','Pericardio fino y brillante'],
  doppler:'Llenado en diástole (rojo hacia el transductor en apical) y eyección en sístole (azul hacia la aorta). Sin jets entre cavidades.',teach:'Antes de buscar lesiones, entrena el ojo en la anatomía normal: cada vista tiene relaciones que se repiten.'},
 {id:'asd2',name:'CIA tipo ostium secundum',short:'CIA OS',group:'Cortocircuitos',params:{radius:.0095},
  views:['sc4c','psaxAV','a5c'],look:['Defecto en la zona media del septo interauricular (fosa oval)','Bordes nítidos en subcostal','Con el tiempo: AD y VD dilatados'],
  pitfall:'En apical 4C el haz corre paralelo al septo interauricular y puede aparecer un falso hueco por caída de señal. Confírmalo en subcostal, donde el septo queda perpendicular al haz.',
  doppler:'Flujo continuo de izquierda a derecha, de baja velocidad (~1 m/s), de la AI a la AD: en subcostal cruza el septo hacia el transductor (rojo). Baja la escala para verlo mejor.',teach:'Es la CIA más frecuente. La vista clave es la subcostal cuatro cámaras.'},
 {id:'asd1',name:'CIA tipo ostium primum',short:'CIA OP',group:'Cortocircuitos',params:{radius:.0085},
  views:['a4c','a5c','psaxAV'],look:['Defecto en la porción baja del septo interauricular, junto a las válvulas AV','Ambas válvulas AV insertas al mismo nivel (se pierde el desplazamiento apical de la tricúspide)'],
  pitfall:'Suele asociarse a hendidura (cleft) de la mitral: en un estudio real, busca insuficiencia mitral (no simulada aquí).',doppler:'Cortocircuito de AI a AD en la porción baja del septo, junto a las válvulas AV.',teach:'Forma parte del espectro del defecto del septo auriculoventricular.'},
 {id:'vsdpm',name:'CIV perimembranosa',short:'CIV pm',group:'Cortocircuitos',params:{radius:.0065},
  views:['plax','a5c','a3c'],look:['Defecto justo por debajo de la válvula aórtica, en el septo que continúa con la pared anterior de la aorta','En un estudio real, el eje corto a nivel aórtico lo muestra entre las 9 y las 12 del reloj, junto a la tricúspide'],
  pitfall:'Los defectos pequeños se ven mejor con Doppler color; en 2D un defecto de 3 mm puede pasar inadvertido.',doppler:'Jet sistólico de alta velocidad del VI al VD, justo bajo la aorta. Con la escala habitual aparece en mosaico (aliasing + turbulencia): un defecto pequeño y restrictivo tiene más velocidad.',teach:'Es la CIV más frecuente que llega a la consulta.'},
 {id:'vsdm',name:'CIV muscular',short:'CIV musc',group:'Cortocircuitos',params:{radius:.0055},
  views:['a4c','psaxPM','a3c'],look:['Defecto rodeado completamente de músculo en el septo trabecular','Barrer el eje corto desde la base hasta el ápex'],
  pitfall:'Pueden ser múltiples y pequeñas: un solo corte no basta.',doppler:'Jet sistólico a través del septo trabecular. Barre el septo con la caja de color: los defectos musculares pequeños a veces solo se ven con color.',teach:'Muchas cierran espontáneamente en los primeros años.'},
 {id:'avsd',name:'Defecto septal auriculoventricular completo',short:'Canal AV',group:'Cortocircuitos',params:{radius:.009},
  views:['a4c','a5c','sc4c'],look:['Gran defecto central («cruz» del corazón ausente)','Componente auricular (ostium primum) y ventricular de entrada','Válvulas AV al mismo nivel'],
  pitfall:'En esta simulación los velos siguen siendo los normales: fíjate en los septos.',doppler:'Dos componentes: flujo auricular de izquierda a derecha y jet ventricular en la zona de entrada. En un estudio real, busca también insuficiencia de la válvula AV común.',teach:'Muy asociado a síndrome de Down. La apical 4C muestra la ausencia de la cruz.'},
 {id:'pda',name:'Ductus arterioso persistente',short:'DAP',group:'Cortocircuitos',params:{radius:.0035},
  views:['ssn','psaxAV'],look:['Conducto entre el istmo aórtico y el origen de la rama pulmonar izquierda','Mejor en supraesternal y en paraesternal alto («vista ductal»)'],
  pitfall:'En 2D el ductus puede confundirse con la rama pulmonar izquierda: sigue su trayecto hasta la aorta.',doppler:'Flujo continuo (sístole y diástole) de la aorta a la pulmonar. Al entrar en el tronco pulmonar el jet vuelve hacia la válvula pulmonar por su pared lateral: en el eje corto inclinado hacia la bifurcación va hacia la sonda (rojo). Con CW, un gradiente alto y continuo indica presión pulmonar baja.',teach:'Clave en prematuros y en cardiopatías ductus-dependientes.'},
 {id:'coarct',name:'Coartación de aorta',short:'CoA',group:'Obstrucciones',params:{lumen:.0028},
  views:['ssn'],look:['Estrechamiento en el istmo, distal a la subclavia izquierda','Repisa posterior (shelf)'],
  pitfall:'Sin ventana supraesternal no se puede descartar. El Doppler (patrón en «diente de sierra») complementa el 2D.',doppler:'Aceleración con aliasing distal al istmo y cola diastólica: la «prolongación diastólica» es un signo de coartación significativa.',teach:'Palpar pulsos femorales y medir presión en las 4 extremidades sigue siendo clave.'},
 {id:'effusion',name:'Derrame pericárdico moderado',short:'Derrame',group:'Pericardio',params:{mm:9},
  views:['plax','sc4c','a4c'],look:['Espacio anecoico entre el epicardio y el pericardio parietal','En PLAX: el derrame pasa por delante de la aorta descendente (el pleural, por detrás)'],
  pitfall:'La grasa epicárdica anterior puede simular derrame: el derrame es anecoico y rodea el corazón.',doppler:'Sin flujo en el espacio del derrame: el color ayuda a distinguirlo de una cavidad vascular.',teach:'Busca signos de taponamiento: colapso diastólico de AD y VD.'},
 {id:'lvh',name:'Hipertrofia septal asimétrica',short:'HVI septal',group:'Miocardio',params:{mm:9},
  views:['plax','psaxPM','a4c'],look:['Septo interventricular engrosado respecto de la pared posterior','Tracto de salida del VI más estrecho'],
  pitfall:'Mide el grosor en telediástole y perpendicular al septo: un corte oblicuo lo sobreestima.',doppler:'Aceleración en el tracto de salida del VI en sístole (mosaico), que sugiere obstrucción dinámica.',teach:'En pediatría, piensa en miocardiopatía hipertrófica, hijo de madre diabética o síndromes (Noonan).'},
 {id:'rvh',name:'Sobrecarga de presión del VD',short:'HVD',group:'Miocardio',params:{mm:4},
  views:['psaxPM','a4c','sc4c'],look:['Pared libre del VD engrosada','Trabeculación prominente'],
  pitfall:'En el recién nacido la pared del VD es normalmente más gruesa que en el niño mayor.',doppler:'Sin jets propios: el Doppler se usa para estimar la presión del VD (insuficiencia tricuspídea, no simulada).',teach:'Piensa en estenosis pulmonar, hipertensión pulmonar o tetralogía de Fallot.'}
];
export const VARIANT_BY_ID=Object.fromEntries(VARIANTS.map(v=>[v.id,v]));

function centreOf(tissue,label,near,radius){return tissue.centroid([label],near,radius)||near}

export function applyVariant(tissue,spec){
 const v=VARIANT_BY_ID[spec?.id]||VARIANT_BY_ID.normal,lm=tissue.landmarks,p={...(v.params||{}),...(spec?.params||{})};let changed=0;
 const long=unit(sub(lm.mitralValve,lm.lvApexCavity));
 switch(v.id){
  case 'asd2':changed=tissue.sphere(lm.asdSecundum,p.radius,LABEL.LA_BLOOD,ATRIAL);break;
  case 'asd1':changed=tissue.sphere(lm.asdPrimum,p.radius,LABEL.LA_BLOOD,ATRIAL);break;
  case 'vsdpm':changed=tissue.sphere(lm.vsdPerimembranous,p.radius,LABEL.LV_BLOOD,VENTRICULAR);break;
  case 'vsdm':changed=tissue.sphere(lm.vsdMuscular,p.radius,LABEL.LV_BLOOD,VENTRICULAR);break;
  case 'avsd':{
   changed+=tissue.sphere(lm.asdPrimum,p.radius,LABEL.LA_BLOOD,ATRIAL);
   const crux=add(mid(lm.mitralValve,lm.tricuspidValve),mul(long,-.006));
   changed+=tissue.capsule(lm.asdPrimum,crux,p.radius*.9,LABEL.LV_BLOOD,new Set([...ATRIAL,...VENTRICULAR]));
   changed+=tissue.sphere(add(crux,mul(long,-.006)),p.radius*.8,LABEL.LV_BLOOD,VENTRICULAR);break;}
  case 'pda':{
   const a=lm.ductAortic,b=lm.ductPulmonary;
   changed+=tissue.capsule(a,b,p.radius+.0012,LABEL.VESSEL_WALL,OUTSIDE);
   changed+=tissue.capsule(a,b,p.radius,LABEL.AO_BLOOD,new Set([...OUTSIDE,LABEL.VESSEL_WALL]));break;}
  case 'coarct':{
   // posterior shelf at the isthmus: aortic lumen outside a small central channel becomes wall
   const isth=lm.ductAortic,c=centreOf(tissue,LABEL.AO_BLOOD,isth,.012),dir=unit(sub(c,lm.archTop)),r2=p.lumen*p.lumen;
   changed=tissue.paint((x,y,z)=>{const q=[x-c[0],y-c[1],z-c[2]],t=q[0]*dir[0]+q[1]*dir[1]+q[2]*dir[2];if(Math.abs(t)>.0028)return false;const perp=[q[0]-t*dir[0],q[1]-t*dir[1],q[2]-t*dir[2]];return perp[0]**2+perp[1]**2+perp[2]**2>r2},[c.map(v=>v-.016),c.map(v=>v+.016)],LABEL.VESSEL_WALL,new Set([LABEL.AO_BLOOD]));break;}
  case 'effusion':tissue.effusionMM=p.mm;changed=1;break;
  case 'lvh':{
   // thicken the septum into the LV cavity along the whole septum
   const a=lm.vsdPerimembranous,b=add(lm.vsdMuscular,mul(sub(lm.vsdMuscular,lm.vsdPerimembranous),.6)),mm=p.mm/1000;
   const segDist=(x,y,z)=>{const ab=sub(b,a),t=Math.max(0,Math.min(1,((x-a[0])*ab[0]+(y-a[1])*ab[1]+(z-a[2])*ab[2])/(ab[0]**2+ab[1]**2+ab[2]**2)));return Math.hypot(x-a[0]-t*ab[0],y-a[1]-t*ab[1],z-a[2]-t*ab[2])};
   changed=tissue.paint((x,y,z)=>segDist(x,y,z)<mm+.004,[[0,1,2].map(i=>Math.min(a[i],b[i])-.02),[0,1,2].map(i=>Math.max(a[i],b[i])+.02)],LABEL.LV_MYO,new Set([LABEL.LV_BLOOD]));break;}
  case 'rvh':{
   // RV free wall grows inward: RV blood within mm of RV myocardium becomes myocardium (in two passes to follow the wall)
   const mm=p.mm/1000,d=tissue.fine.data,h=tissue.fh,nx=tissue.fnx,ny=tissue.fny,nz=tissue.fnz,steps=Math.round(mm/h),changes=[];
   for(let s=0;s<steps;s++){const mark=[];for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++)for(let i=1;i<nx-1;i++){const idx=((k*ny+j)*nx+i)*2;if(d[idx]!==LABEL.RV_BLOOD)continue;
     for(const o of [2,-2,nx*2,-nx*2,nx*ny*2,-nx*ny*2])if(d[idx+o]===LABEL.RV_MYO){mark.push(idx);break}}
    for(const idx of mark){changes.push(idx,d[idx]);d[idx]=LABEL.RV_MYO}}
   tissue.edits.push(changes);changed=changes.length/2;break;}
 }
 return {id:v.id,changed};
}
