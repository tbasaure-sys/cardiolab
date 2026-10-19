// Direct links to a place in CardioLab, kept in the URL fragment so they work on a static host:
//   #/fisica/ciclo?fc=140          a physics or physiology chapter (with its settings)
//   #/estudio/vsdpm?tam=0.6&rvp=normal   the shunt study at a lesion size and pulmonary resistance
//   #/estudio/examen?semilla=42    a structured study: the same seed is always the same synthetic patient
//   #/vista/a4c                    a standard view in the live simulator
//   #/leccion/ductus?modo=practica a tutor lesson
// Any link may add ?paciente=neonate (patient size). Worker-safe, no DOM.
export const ROUTES=['fisica','estudio','vista','leccion'];
export function parseLink(hash){
 const h=String(hash||'').replace(/^#\/?/,'');if(!h)return null;
 const qi=h.indexOf('?'),path=qi<0?h:h.slice(0,qi),query=qi<0?'':h.slice(qi+1);
 const [route,id]=path.split('/').map(s=>decodeURIComponent(s||''));const params=Object.fromEntries(new URLSearchParams(query));
 if(!ROUTES.includes(route))return Object.keys(params).length?{route:null,id:null,params}:null;
 return {route,id:id||null,params};
}
export function formatLink({route,id=null,params={}}){
 const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>[k,String(v)])).toString();
 return `#/${route}${id?'/'+encodeURIComponent(id):''}${q?'?'+q:''}`;
}
// a number within [lo, hi], or null
export function numParam(v,lo,hi){if(v==null||v==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)&&n>=lo&&n<=hi?n:null}
