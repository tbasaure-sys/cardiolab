// Is the image well set? Measured on the image itself, against the same plane with the machine's reference settings:
// how dark the cavities are, how bright the myocardium is, whether near and far field are balanced, and whether depth and
// focus suit the heart in view. Worker-safe, no DOM. The tolerances are teaching choices of this simulator (declared), the
// quantities are measured: nothing here is a clinical image-quality standard.
import {LABEL} from './tissue.mjs';

const BLOOD=new Set([LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD]),WALL=new Set([LABEL.LV_MYO,LABEL.RV_MYO]);
// world points at the centres of a coarse grid over the fan of `pose` (for the tissue labels under the image)
export function gridPoints(pose,{lines=56,samples=44}={}){
 const pts=[],sec=pose.sector*Math.PI/180,o=pose.origin,d=pose.d,u=pose.u;
 for(let j=0;j<lines;j++){const th=-sec/2+sec*(j+.5)/lines,c=Math.cos(th),s=Math.sin(th);for(let k=0;k<samples;k++){const r=(k+.5)/samples*pose.depth;pts.push([o[0]+(c*d[0]+s*u[0])*r,o[1]+(c*d[1]+s*u[1])*r,o[2]+(c*d[2]+s*u[2])*r])}}
 return {points:pts,lines,samples};
}
// frame: {lines,samples,data} (static, diastolic); labels: tissue label of each grid point (same order as gridPoints)
export function imageMetrics(frame,labels,grid){
 const {lines:L,samples:S}=grid,at=(j,k)=>labels[j*S+k];
 // grey level of a grid cell: mean of the frame over the cell
 const grey=(j,k)=>{const j0=Math.floor(j/L*frame.lines),j1=Math.max(j0+1,Math.floor((j+1)/L*frame.lines)),k0=Math.floor(k/S*frame.samples),k1=Math.max(k0+1,Math.floor((k+1)/S*frame.samples));let s=0,n=0;for(let a=j0;a<j1;a++)for(let b=k0;b<k1;b++){s+=frame.data[a*frame.samples+b];n++}return s/n};
 // only cells surrounded by the same kind count (walls bleed into the cavity edge by the width of the beam)
 const inner=(j,k,set)=>j>0&&j<L-1&&k>0&&k<S-1&&set.has(at(j,k))&&set.has(at(j-1,k))&&set.has(at(j+1,k))&&set.has(at(j,k-1))&&set.has(at(j,k+1));
 const acc={cavity:[0,0],tissue:[0,0],near:[0,0],far:[0,0]};let deepest=0,heartCells=0;
 for(let j=0;j<L;j++)for(let k=0;k<S;k++){const l=at(j,k),f=(k+.5)/S;
  if(BLOOD.has(l)||WALL.has(l)){heartCells++;if(f>deepest)deepest=f}
  if(inner(j,k,BLOOD)){acc.cavity[0]+=grey(j,k);acc.cavity[1]++}
  else if(WALL.has(l)&&WALL.has(at(j,Math.max(0,k-1)))&&WALL.has(at(j,Math.min(S-1,k+1)))){acc.tissue[0]+=grey(j,k);acc.tissue[1]++}
  // near and far field: every solid tissue (not blood, lung or air) in the first third and beyond 60 % of the depth
  if(!BLOOD.has(l)&&l!==LABEL.AIR&&l!==LABEL.LUNG&&(f<.33||f>.6)){const h=f<.33?acc.near:acc.far;h[0]+=grey(j,k);h[1]++}}
 const mean=a=>a[1]?a[0]/a[1]:null;
 return {cavity:mean(acc.cavity),tissue:mean(acc.tissue),near:acc.near[1]>=12?mean(acc.near):null,far:acc.far[1]>=12?mean(acc.far):null,deepest,heartShare:heartCells/(L*S),cells:{cavity:acc.cavity[1],tissue:acc.tissue[1]}};
}
export const TOLERANCE={cavity:14,tissueLow:.72,tissueHigh:1.3,balance:.4,depth:[.85,1.22],focus:[.6,1.5]};
// cur, ref: {metrics, depth (physical m), focus (fraction of depth)}. Each criterion: measured value, what it is compared with, advice.
export function scoreImage(cur,ref,tol=TOLERANCE){
 const M=cur.metrics,R=ref.metrics,out=[],f0=v=>v==null?'—':v.toFixed(0);
 if(M.cavity!=null&&R.cavity!=null){const ok=M.cavity<=R.cavity+tol.cavity;out.push({id:'cavity',label:'Cavidades negras',ok,value:`gris medio ${f0(M.cavity)}`,target:`≤ ${f0(R.cavity+tol.cavity)} (referencia ${f0(R.cavity)})`,advice:ok?'':'Las cavidades tienen ecos: sobra ganancia (o TGC) donde están.'})}
 let tissueOk=true;
 if(M.tissue!=null&&R.tissue!=null){const r=M.tissue/R.tissue,ok=(r>=tol.tissueLow&&r<=tol.tissueHigh)||Math.abs(M.tissue-R.tissue)<=tol.cavity;tissueOk=ok;out.push({id:'tissue',label:'Miocardio con brillo suficiente',ok,value:`gris medio ${f0(M.tissue)}`,target:`cerca de ${f0(R.tissue)} (referencia)`,advice:ok?'':r<tol.tissueLow?'El miocardio se ve oscuro: falta ganancia (o TGC) a su profundidad.':'El miocardio está saturado: baja la ganancia.'})}
 // the balance between near and far field is judged once the overall brightness is right (a wrong gain bends it too)
 if(tissueOk&&M.near!=null&&M.far!=null&&R.near!=null&&R.far!=null&&M.far>0&&R.far>0){const b=Math.log2((M.near/M.far)/(R.near/R.far)),ok=Math.abs(b)<=tol.balance;out.push({id:'balance',label:'Brillo parejo de cerca a lejos',ok,value:`cerca/lejos ${(M.near/M.far).toFixed(2)}`,target:`referencia ${(R.near/R.far).toFixed(2)}`,advice:ok?'':b>0?'El campo lejano queda oscuro respecto al cercano: sube el TGC de las bandas lejanas (o baja las cercanas).':'El campo cercano queda oscuro respecto al lejano: sube el TGC cercano (o baja el lejano).'})}
 {const r=cur.depth/ref.depth,ok=r>=tol.depth[0]&&r<=tol.depth[1];out.push({id:'depth',label:'Profundidad ajustada al corazón',ok,value:`${(cur.depth*100).toFixed(1)} cm`,target:`${(ref.depth*tol.depth[0]*100).toFixed(1)}–${(ref.depth*tol.depth[1]*100).toFixed(1)} cm`,advice:ok?'':r<tol.depth[0]?'El sector corta estructuras profundas: aumenta la profundidad.':'Sobra campo vacío bajo el corazón: reduce la profundidad (ganas tamaño y cuadros por segundo).'})}
 {const fc=cur.focus*cur.depth,fr=ref.focus*ref.depth,r=fc/fr,ok=r>=tol.focus[0]&&r<=tol.focus[1];out.push({id:'focus',label:'Foco a la altura del corazón',ok,value:`${(fc*100).toFixed(1)} cm`,target:`${(fr*tol.focus[0]*100).toFixed(1)}–${(fr*tol.focus[1]*100).toFixed(1)} cm`,advice:ok?'':'Lleva el foco a la profundidad de lo que estudias: ahí el haz es más estrecho.'})}
 const passed=out.filter(c=>c.ok).length;return {criteria:out,passed,total:out.length,ok:passed===out.length};
}
