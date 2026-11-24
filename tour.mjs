// First-visit tour: six stops that tie the probe to the image and to the study, one sentence each. It never blocks the page
// (the card sits in a corner and the stop is outlined), runs once per browser, and can be reopened from «Cómo usarlo».
const KEY='cardiolab.tour.v1';
export const STOPS=[
 {at:'nav.windows',title:'1 · Apoya la sonda',text:'Elige una ventana (paraesternal, apical, subcostal, supraesternal): es dónde pones la sonda sobre el tórax.'},
 {at:'.probe-controls',title:'2 · Mueve la sonda',text:'Deslizar, rotar, inclinar y bascular: las cuatro maniobras de la mano. Con el teclado: flechas, Q/E, W/S, A/D.'},
 {at:'.view.scan',title:'3 · Mira la imagen',text:'La imagen eco se calcula en directo sobre el mismo corazón que ves en 3D. Costillas y pulmón dan sombra, como en un paciente.'},
 {at:'#instrument',title:'4 · Ajusta el equipo',text:'Ganancia, profundidad, foco, TGC… y los modos: color, PW, CW y modo M. Cada perilla cambia la imagen por su razón física.'},
 {at:'.course-bar .panel-tabs',title:'5 · Aprende con guía',text:'Tutor y Entrenador enseñan las vistas paso a paso; «Leer la imagen» te pregunta y mide si dejaste la imagen bien ajustada.'},
 {at:'#tab-chd',title:'6 · Haz un estudio',text:'En Cardiopatías, «Estudio con informe» te da un paciente con el diagnóstico oculto: exploras, mides, informas y se corrige contra el corazón simulado.'}
];
export function seen(){try{return localStorage.getItem(KEY)==='1'}catch{return true}}
function mark(){try{localStorage.setItem(KEY,'1')}catch{}}
export function mountTour({auto=true}={}){
 let i=-1,card=null,ring=null;
 const clear=()=>{ring?.classList.remove('tour-ring');ring=null};
 function close(){clear();card?.remove();card=null;i=-1;mark()}
 function show(n){
  i=n;clear();const s=STOPS[n],el=document.querySelector(s.at);if(el){ring=el;el.classList.add('tour-ring');el.scrollIntoView({block:'nearest',behavior:'smooth'})}
  if(!card){card=document.createElement('aside');card.className='tour-card';card.setAttribute('role','dialog');card.setAttribute('aria-label','Recorrido de un minuto');document.body.append(card)}
  card.innerHTML=`<strong></strong><p></p><div class="tour-nav"><button data-t="skip">Saltar</button><span>${n+1} / ${STOPS.length}</span><button data-t="back"${n?'':' disabled'}>Atrás</button><button data-t="next" class="primary">${n===STOPS.length-1?'Empezar':'Siguiente'}</button></div>`;
  card.querySelector('strong').textContent=s.title;card.querySelector('p').textContent=s.text;
  card.querySelector('[data-t=skip]').onclick=close;card.querySelector('[data-t=back]').onclick=()=>show(Math.max(0,i-1));card.querySelector('[data-t=next]').onclick=()=>i===STOPS.length-1?close():show(i+1);
 }
 addEventListener('keydown',e=>{if(card&&e.key==='Escape')close()});
 if(auto&&!seen())show(0);
 return {start:()=>show(0),close,get open(){return !!card}};
}
