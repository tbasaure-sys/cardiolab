// Acoustic tissue model: label volumes built by build_tissue_volume.py plus procedural layers.
// Works in the browser, in workers and in Node (tests).

export const LABEL={AIR:0,SOFT:1,LUNG:2,BONE:3,LIVER:4,FAT:5,CARTILAGE:6,LV_MYO:10,RV_MYO:11,LA_WALL:12,RA_WALL:13,PAPILLARY:14,
 LV_BLOOD:20,RV_BLOOD:21,LA_BLOOD:22,RA_BLOOD:23,AO_BLOOD:24,PA_BLOOD:25,CAVA_BLOOD:26,PV_BLOOD:27,CORONARY:28,CS_BLOOD:29,
 VESSEL_WALL:30,MITRAL:40,TRICUSPID:41,AORTIC_VALVE:42,PULMONARY_VALVE:43,
 // runtime-only labels (never in the source volume)
 PERICARDIUM:60,EFFUSION:61,SKIN:62,SUBCUT:63,MUSCLE:64,THROMBUS:65,MEDIASTINUM:66};

// [backscatter amplitude, impedance (MRayl), attenuation (dB/cm/MHz)]
const P=[];const set=(ids,v)=>{for(const id of [].concat(ids))P[id]=v};
set(LABEL.AIR,[0,.0004,40]);
set(LABEL.SOFT,[.0032,1.63,.55]);
set(LABEL.LUNG,[.0008,.0004,40]);
set(LABEL.BONE,[.02,7.8,22]);
set(LABEL.CARTILAGE,[.0045,1.8,.7]); // paediatric sternum: cartilage with small ossification centres
set(LABEL.LIVER,[.0047,1.65,.5]); // a little brighter than myocardium, as in harmonic imaging
set(LABEL.FAT,[.012,1.38,.6]);
set([LABEL.LV_MYO,LABEL.RV_MYO],[.0042,1.70,.55]);
set([LABEL.LA_WALL,LABEL.RA_WALL],[.0045,1.70,.55]);
set(LABEL.PAPILLARY,[.0048,1.71,.55]);
set([LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD,LABEL.CAVA_BLOOD,LABEL.PV_BLOOD,LABEL.CORONARY,LABEL.CS_BLOOD],[.00008,1.61,.16]);
set(LABEL.VESSEL_WALL,[.008,1.74,.6]);
// voxelised valves are replaced by the moving leaflet overlay; here they behave as blood
set([LABEL.MITRAL,LABEL.TRICUSPID,LABEL.AORTIC_VALVE,LABEL.PULMONARY_VALVE],[.00008,1.61,.16]);
set(LABEL.PERICARDIUM,[.018,1.95,.7]);
// deep soft tissue the atlas leaves between the rib cage and the heart (in patients the heart lies against the chest
// wall there): rendered faint so that it does not fill the near field; same impedance as soft tissue (no false edge)
set(LABEL.MEDIASTINUM,[.0009,1.63,.5]);
set(LABEL.EFFUSION,[.00012,1.52,.05]);
set(LABEL.SKIN,[.014,1.75,.7]);
set(LABEL.SUBCUT,[.0022,1.42,.6]);
set(LABEL.MUSCLE,[.0038,1.65,.9]);
set(LABEL.THROMBUS,[.006,1.66,.3]);
export const PROPS=new Float32Array(256*3);for(let i=0;i<256;i++){const v=P[i]||P[LABEL.SOFT];PROPS.set(v,i*3)}

export const BLOOD=new Set([LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD,LABEL.CAVA_BLOOD,LABEL.PV_BLOOD,LABEL.CS_BLOOD,LABEL.CORONARY,LABEL.MITRAL,LABEL.TRICUSPID,LABEL.AORTIC_VALVE,LABEL.PULMONARY_VALVE]);
export const MYOCARDIUM=new Set([LABEL.LV_MYO,LABEL.RV_MYO,LABEL.LA_WALL,LABEL.RA_WALL,LABEL.PAPILLARY]);
export const LABEL_NAMES={[LABEL.LV_BLOOD]:'Cavidad VI',[LABEL.RV_BLOOD]:'Cavidad VD',[LABEL.LA_BLOOD]:'Cavidad AI',[LABEL.RA_BLOOD]:'Cavidad AD',[LABEL.AO_BLOOD]:'Aorta',[LABEL.PA_BLOOD]:'Arteria pulmonar',[LABEL.CAVA_BLOOD]:'Vena cava',[LABEL.PV_BLOOD]:'Vena pulmonar',[LABEL.CS_BLOOD]:'Seno coronario',[LABEL.LV_MYO]:'Miocardio VI',[LABEL.RV_MYO]:'Pared VD',[LABEL.LA_WALL]:'Pared AI',[LABEL.RA_WALL]:'Pared AD',[LABEL.PAPILLARY]:'Músculo papilar',[LABEL.LUNG]:'Pulmón',[LABEL.BONE]:'Costilla / esternón',[LABEL.LIVER]:'Hígado',[LABEL.SOFT]:'Pared torácica / mediastino',[LABEL.FAT]:'Grasa epicárdica',[LABEL.VESSEL_WALL]:'Pared vascular',[LABEL.PERICARDIUM]:'Pericardio',[LABEL.EFFUSION]:'Derrame pericárdico'};

export function parseTissue(meta,fineBytes,coarseBytes){
 const fine={...meta.fine,data:new Uint8Array(fineBytes)},coarse={...meta.coarse,data:new Uint8Array(coarseBytes)};
 if(fine.data.length!==fine.dims[0]*fine.dims[1]*fine.dims[2]*2)throw Error('Volumen de tejido incompleto');
 if(coarse.data.length!==coarse.dims[0]*coarse.dims[1]*coarse.dims[2])throw Error('Volumen torácico incompleto');
 return new Tissue(meta,fine,coarse);
}
async function gunzip(buffer){const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).arrayBuffer()}
export async function loadTissue(base='assets/'){
 const meta=await (await fetch(base+'tissue.json')).json();
 const [f,c]=await Promise.all([meta.fine.file,meta.coarse.file].map(async file=>{const r=await fetch(base+file);if(!r.ok)throw Error('No se pudo cargar '+file);return gunzip(await r.arrayBuffer())}));
 return parseTissue(meta,f,c);
}

export class Tissue{
 constructor(meta,fine,coarse){
  this.meta=meta;this.fine=fine;this.coarse=coarse;this.landmarks=meta.landmarks;this.edits=[];this.effusionMM=0;
  const [nx,ny,nz]=fine.dims;this.fnx=nx;this.fny=ny;this.fnz=nz;this.fo=fine.origin;this.fh=fine.spacing;this.fi=1/fine.spacing;
  const [cx,cy,cz]=coarse.dims;this.cnx=cx;this.cny=cy;this.cnz=cz;this.co=coarse.origin;this.ci=1/coarse.spacing;
 }
 // nearest-voxel lookup → label (and distance outside the heart envelope, metres; Infinity when unknown)
 lookup(x,y,z){
  const fx=(x-this.fo[0])*this.fi,fy=(y-this.fo[1])*this.fi,fz=(z-this.fo[2])*this.fi;
  const ix=Math.round(fx),iy=Math.round(fy),iz=Math.round(fz);
  if(ix>=0&&iy>=0&&iz>=0&&ix<this.fnx&&iy<this.fny&&iz<this.fnz){const i=((iz*this.fny+iy)*this.fnx+ix)*2;this._dist=this.fine.data[i+1]*.00025;return this.fine.data[i]}
  this._dist=Infinity;
  const cx=Math.round((x-this.co[0])*this.ci),cy=Math.round((y-this.co[1])*this.ci),cz=Math.round((z-this.co[2])*this.ci);
  if(cx<0||cy<0||cz<0||cx>=this.cnx||cy>=this.cny||cz>=this.cnz)return LABEL.AIR;
  return this.coarse.data[(cz*this.cny+cy)*this.cnx+cx];
 }
 get lastDistance(){return this._dist}
 // Label at a world point after runtime layers (pericardium, effusion). Skin layers depend on the ray and are added by the renderer.
 tissueAt(x,y,z){
  const lab=this.lookup(x,y,z),d=this._dist;
  if(d<.02&&(lab===LABEL.SOFT||lab===LABEL.FAT||lab===LABEL.LUNG||lab===LABEL.LIVER)&&d>0){
   const e=this.effusionMM*.001,peri=.0006+e;
   if(e>0&&d<=e)return LABEL.EFFUSION;
   if(d>peri-.0002&&d<=peri+.0024)return LABEL.PERICARDIUM;
   if(e>0&&lab===LABEL.LUNG&&d<=peri+.006)return LABEL.SOFT;
  }
  return lab;
 }
 fineIndex(x,y,z){const ix=Math.round((x-this.fo[0])*this.fi),iy=Math.round((y-this.fo[1])*this.fi),iz=Math.round((z-this.fo[2])*this.fi);if(ix<0||iy<0||iz<0||ix>=this.fnx||iy>=this.fny||iz>=this.fnz)return -1;return ((iz*this.fny+iy)*this.fnx+ix)*2}
 // --- editable anatomy (congenital variants). Every edit is reversible.
 paint(test,box,to,from=null){
  const [lo,hi]=box,changes=[];const d=this.fine.data;
  const i0=Math.max(0,Math.floor((lo[0]-this.fo[0])*this.fi)),i1=Math.min(this.fnx-1,Math.ceil((hi[0]-this.fo[0])*this.fi));
  const j0=Math.max(0,Math.floor((lo[1]-this.fo[1])*this.fi)),j1=Math.min(this.fny-1,Math.ceil((hi[1]-this.fo[1])*this.fi));
  const k0=Math.max(0,Math.floor((lo[2]-this.fo[2])*this.fi)),k1=Math.min(this.fnz-1,Math.ceil((hi[2]-this.fo[2])*this.fi));
  for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
   const x=this.fo[0]+i*this.fh,y=this.fo[1]+j*this.fh,z=this.fo[2]+k*this.fh,idx=((k*this.fny+j)*this.fnx+i)*2,cur=d[idx];
   if(from&&!from.has(cur))continue;const target=typeof to==='function'?to(cur,x,y,z):to;if(target==null||target===cur||!test(x,y,z,cur))continue;
   changes.push(idx,cur);d[idx]=target;
  }
  this.edits.push(changes);return changes.length/2;
 }
 // centroid of voxels carrying any of `labels` within radius r of p (null when none)
 centroid(labels,p,r){const set=labels instanceof Set?labels:new Set(labels),d=this.fine.data,s=[0,0,0];let n=0;
  const i0=Math.max(0,Math.floor((p[0]-r-this.fo[0])*this.fi)),i1=Math.min(this.fnx-1,Math.ceil((p[0]+r-this.fo[0])*this.fi)),j0=Math.max(0,Math.floor((p[1]-r-this.fo[1])*this.fi)),j1=Math.min(this.fny-1,Math.ceil((p[1]+r-this.fo[1])*this.fi)),k0=Math.max(0,Math.floor((p[2]-r-this.fo[2])*this.fi)),k1=Math.min(this.fnz-1,Math.ceil((p[2]+r-this.fo[2])*this.fi));
  for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){if(!set.has(d[((k*this.fny+j)*this.fnx+i)*2]))continue;const x=this.fo[0]+i*this.fh,y=this.fo[1]+j*this.fh,z=this.fo[2]+k*this.fh;if((x-p[0])**2+(y-p[1])**2+(z-p[2])**2>r*r)continue;s[0]+=x;s[1]+=y;s[2]+=z;n++}
  return n?s.map(v=>v/n):null}
 sphere(center,radius,to,from){const [cx,cy,cz]=center,r2=radius*radius;return this.paint((x,y,z)=>(x-cx)**2+(y-cy)**2+(z-cz)**2<=r2,[center.map(v=>v-radius),center.map(v=>v+radius)],to,from)}
 capsule(a,b,radius,to,from){
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],L2=ab[0]**2+ab[1]**2+ab[2]**2,r2=radius*radius;
  const lo=[0,1,2].map(i=>Math.min(a[i],b[i])-radius),hi=[0,1,2].map(i=>Math.max(a[i],b[i])+radius);
  return this.paint((x,y,z)=>{const t=Math.max(0,Math.min(1,((x-a[0])*ab[0]+(y-a[1])*ab[1]+(z-a[2])*ab[2])/L2));return (x-a[0]-t*ab[0])**2+(y-a[1]-t*ab[1])**2+(z-a[2]-t*ab[2])**2<=r2},[lo,hi],to,from);
 }
 reset(){const d=this.fine.data;while(this.edits.length){const c=this.edits.pop();for(let i=c.length-2;i>=0;i-=2)d[c[i]]=c[i+1]}this.effusionMM=0}
}

// ------------------------------------------------------------------ cardiac motion (approximate)
// Phase 0 = end-diastole (QRS). Systole ≈ 0–0.36, rapid filling 0.40–0.55, diastasis, atrial kick 0.82–0.95.
export function ventricularContraction(t){
 t=((t%1)+1)%1;const s=t<.36?Math.sin(Math.PI*t/.72)**2:t<.55?Math.cos(Math.PI*(t-.36)/.38)**2*(t<.55?1:0):0;
 const kick=t>.8&&t<.97?-.12*Math.sin(Math.PI*(t-.8)/.17):0;return Math.max(-.15,s+kick);
}
export function valveOpening(t,kind){
 t=((t%1)+1)%1;const ramp=(a,b,c,d)=>t<a||t>d?0:t<b?(t-a)/(b-a):t<c?1:(d-t)/(d-c);
 if(kind==='semilunar')return ramp(.05,.09,.30,.35);
 // AV valves: E wave, partial closure in diastasis, A wave
 return Math.max(ramp(.38,.44,.52,.64)*1,ramp(.58,.66,.76,.8)*.45,ramp(.8,.85,.9,.97)*.8);
}
export class HeartMotion{
 constructor(landmarks){
  const A=landmarks.lvApex,mv=landmarks.mitralValve,tv=landmarks.tricuspidValve,base=[0,1,2].map(i=>(mv[i]+tv[i])/2);
  const ax=[0,1,2].map(i=>base[i]-A[i]),L=Math.hypot(...ax);this.A=A;this.a=ax.map(v=>v/L);this.L=L;this.base=base;this.atrial=.055;
  this.longitudinal=.13;this.radial=.16;
 }
 // current (deformed) position → reference position. s = contraction (0 diastole … 1 end-systole)
 inverse(p,s,out,falloff=1){
  const q=[p[0]-this.A[0],p[1]-this.A[1],p[2]-this.A[2]],l=q[0]*this.a[0]+q[1]*this.a[1]+q[2]*this.a[2];
  const r=[q[0]-l*this.a[0],q[1]-l*this.a[1],q[2]-l*this.a[2]];
  const shift=this.longitudinal*this.L*s*falloff;let l0,rs;
  const baseCur=this.L-shift;
  if(l<=baseCur){l0=l*this.L/Math.max(1e-6,baseCur);const w=Math.sin(Math.PI*Math.max(0,Math.min(1,l0/this.L))*.5+.3);rs=1/(1-this.radial*s*falloff*w)}
  else{const above=l-baseCur,f=Math.max(0,1-above/this.atrial);l0=l+shift*f;rs=1+.05*s*falloff*f}
  out[0]=this.A[0]+l0*this.a[0]+r[0]*rs;out[1]=this.A[1]+l0*this.a[1]+r[1]*rs;out[2]=this.A[2]+l0*this.a[2]+r[2]*rs;return out;
 }
 // reference → current (for leaflet vertices); small iterations of the inverse
 forward(p0,s,out=[0,0,0]){let c=[...p0],t=[0,0,0];for(let i=0;i<6;i++){this.inverse(c,s,t);c=[c[0]+(p0[0]-t[0]),c[1]+(p0[1]-t[1]),c[2]+(p0[2]-t[2])]}out[0]=c[0];out[1]=c[1];out[2]=c[2];return out}
}
