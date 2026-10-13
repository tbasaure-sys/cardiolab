// Where each number on screen comes from: measured on the simulated image or spectrum, computed with a physical
// equation, an assumption or band of the teaching model, or a published source (lessons/sources.json, linked by DOI).
// tag('medido'), tag('ecuacion','v = c²/(8·f₀·d)'), tag('modelo'), tag({fuente:['sarnari2009']}), or several: tag(['medido',{fuente:[…]}])
const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let catalog=null;
export const sourcesReady=(typeof fetch==='function'?fetch('lessons/sources.json').then(r=>r.json()).then(j=>{catalog=j.sources;return catalog}).catch(()=>null):Promise.resolve(null));
const KIND={
 medido:{label:'medido',title:'Medido sobre la imagen o el espectro que calcula el simulador'},
 ecuacion:{label:'ecuación',title:'Calculado con una ecuación física'},
 modelo:{label:'modelo',title:'Supuesto o banda del modelo docente, sin fuente clínica'}
};
// «Sarnari 2009» from the id sarnari2009
export function shortName(id){if(id==='docencia')return 'diseño docente';const m=/^([a-z]+?)(\d{4})$/.exec(id);return m?m[1][0].toUpperCase()+m[1].slice(1)+' '+m[2]:id}
export function tag(spec,detail=''){
 const parts=Array.isArray(spec)?spec:[spec];
 return parts.map(p=>{
  if(typeof p==='string'){const k=KIND[p];if(!k)return '';return `<span class="prov prov-${p}" title="${esc(k.title+(detail?': '+detail:''))}">${k.label}</span>`}
  return (p.fuente||[]).map(id=>{const s=catalog?.[id],title=s?s.citation+(s.supports?' — '+s.supports:''):id;
   return s?.doi?`<a class="prov prov-fuente" href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(shortName(id))}</a>`:`<span class="prov prov-fuente" title="${esc(title)}">${esc(shortName(id))}</span>`}).join('')}).join('');
}
