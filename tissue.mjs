// Acoustic tissue model: label volumes built by build_tissue_volume.py plus procedural layers.
// Works in the browser, in workers and in Node (tests).
import {atlasSurface} from './geometry.mjs';

export const LABEL={AIR:0,SOFT:1,LUNG:2,BONE:3,LIVER:4,FAT:5,CARTILAGE:6,LV_MYO:10,RV_MYO:11,LA_WALL:12,RA_WALL:13,PAPILLARY:14,
 LV_BLOOD:20,RV_BLOOD:21,LA_BLOOD:22,RA_BLOOD:23,AO_BLOOD:24,PA_BLOOD:25,CAVA_BLOOD:26,PV_BLOOD:27,CORONARY:28,CS_BLOOD:29,
 VESSEL_WALL:30,MITRAL:40,TRICUSPID:41,AORTIC_VALVE:42,PULMONARY_VALVE:43,
 // runtime-only labels (never in the source volume)
 PERICARDIUM:60,EFFUSION:61,SKIN:62,SUBCUT:63,MUSCLE:64,THROMBUS:65,MEDIASTINUM:66,FOSSA:67,THYMUS:68};

// [backscatter amplitude, impedance (MRayl), attenuation (dB/cm/MHz)]
const P=[];const set=(ids,v)=>{for(const id of [].concat(ids))P[id]=v};
set(LABEL.AIR,[0,.0004,40]);
set(LABEL.SOFT,[.0032,1.63,.55]);
set(LABEL.LUNG,[.0008,.0004,40]);
set(LABEL.BONE,[.02,7.8,22]);
set(LABEL.CARTILAGE,[.0045,1.8,.7]); // paediatric sternum: cartilage with small ossification centres
set(LABEL.LIVER,[.0064,1.65,.5]); // brighter than myocardium: it has to read as mid-grey parenchyma in the near field of the subcostal views, under the abdominal wall
set(LABEL.FAT,[.012,1.38,.6]);
set([LABEL.LV_MYO,LABEL.RV_MYO],[.0042,1.70,.55]);
set([LABEL.LA_WALL,LABEL.RA_WALL],[.0045,1.70,.55]);
// floor of the fossa ovalis: a thin fibrous membrane, a weak diffuse scatterer whose echoes are mostly specular — bright
// when the beam meets it head-on (subcostal), lost when the beam runs along it (apical «dropout»)
set(LABEL.FOSSA,[.0005,1.80,.6]);
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
// thymus of the infant: a hypoechoic parenchyma (cortex) crossed by echogenic septa and foci (Han 2001); the foci are drawn
// by the renderer. Same impedance as soft tissue: no bright edge against the mediastinum.
set(LABEL.THYMUS,[.0030,1.63,.5]);
export const PROPS=new Float32Array(256*3);for(let i=0;i<256;i++){const v=P[i]||P[LABEL.SOFT];PROPS.set(v,i*3)}

export const BLOOD=new Set([LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD,LABEL.CAVA_BLOOD,LABEL.PV_BLOOD,LABEL.CS_BLOOD,LABEL.CORONARY,LABEL.MITRAL,LABEL.TRICUSPID,LABEL.AORTIC_VALVE,LABEL.PULMONARY_VALVE]);
export const MYOCARDIUM=new Set([LABEL.LV_MYO,LABEL.RV_MYO,LABEL.LA_WALL,LABEL.RA_WALL,LABEL.PAPILLARY,LABEL.FOSSA]);
export const LABEL_NAMES={[LABEL.LV_BLOOD]:'Cavidad VI',[LABEL.RV_BLOOD]:'Cavidad VD',[LABEL.LA_BLOOD]:'Cavidad AI',[LABEL.RA_BLOOD]:'Cavidad AD',[LABEL.AO_BLOOD]:'Aorta',[LABEL.PA_BLOOD]:'Arteria pulmonar',[LABEL.CAVA_BLOOD]:'Vena cava',[LABEL.PV_BLOOD]:'Vena pulmonar',[LABEL.CS_BLOOD]:'Seno coronario',[LABEL.LV_MYO]:'Miocardio VI',[LABEL.RV_MYO]:'Pared VD',[LABEL.LA_WALL]:'Pared AI',[LABEL.RA_WALL]:'Pared AD',[LABEL.PAPILLARY]:'Músculo papilar',[LABEL.LUNG]:'Pulmón',[LABEL.BONE]:'Costilla / esternón',[LABEL.LIVER]:'Hígado',[LABEL.SOFT]:'Pared torácica / mediastino',[LABEL.FAT]:'Grasa epicárdica',[LABEL.VESSEL_WALL]:'Pared vascular',[LABEL.PERICARDIUM]:'Pericardio',[LABEL.FOSSA]:'Fosa oval (membrana)',[LABEL.EFFUSION]:'Derrame pericárdico',[LABEL.THYMUS]:'Timo'};

export function parseTissue(meta,fineBytes,coarseBytes){
 const fine={...meta.fine,data:new Uint8Array(fineBytes)},coarse={...meta.coarse,data:new Uint8Array(coarseBytes)};
 if(fine.data.length!==fine.dims[0]*fine.dims[1]*fine.dims[2]*2)throw Error('Volumen de tejido incompleto');
 if(coarse.data.length!==coarse.dims[0]*coarse.dims[1]*coarse.dims[2])throw Error('Volumen torácico incompleto');
 return new Tissue(meta,fine,coarse);
}
export async function gunzip(buffer){const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).arrayBuffer()}
export async function loadTissue(base='assets/'){
 const meta=await (await fetch(base+'tissue.json')).json();
 const [f,c]=await Promise.all([meta.fine.file,meta.coarse.file].map(async file=>{const r=await fetch(base+file);if(!r.ok)throw Error('No se pudo cargar '+file);return gunzip(await r.arrayBuffer())}));
 return parseTissue(meta,f,c);
}

// The atlas interatrial septum is ~6 mm thick across the fossa ovalis, whose floor is a thin membrane in patients (the
// thick limbus surrounds it). At load time the septum within FOSSA_R of the fossa centre is thinned to a ~1.5 mm
// membrane (label FOSSA) about its mid-plane; the rest becomes blood of the atrium on that side. The limbus is untouched.
// Not an edit (Tissue.reset keeps it): it is the reference anatomy. Returns what was done, for provenance.
const FOSSA_R=.0075,FOSSA_HALF=.0008;
function thinFossa(t){
 const c=t.landmarks.asdSecundum,d=t.fine.data,[nx,ny,nz]=t.fine.dims,h=t.fh,o=t.fo,L=LABEL;
 // septal normal: from the LA blood centroid to the RA blood centroid around the fossa
 const cen=lab=>{const s=[0,0,0];let n=0;for(let x=-.025;x<=.025;x+=.002)for(let y=-.025;y<=.025;y+=.002)for(let z=-.025;z<=.025;z+=.002){const p=[c[0]+x,c[1]+y,c[2]+z];if(t.tissueAt(...p)===lab){s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];n++}}return n?s.map(v=>v/n):null};
 const la=cen(L.LA_BLOOD),ra=cen(L.RA_BLOOD);if(!la||!ra)return null;
 const g=ra.map((v,i)=>v-la[i]),gl=Math.hypot(...g),u=g.map(v=>v/gl);
 // septal mid-plane along the normal through the fossa centre
 let s0=0,n0=0;for(let s=-.012;s<=.012;s+=.00025){const l=t.tissueAt(c[0]+u[0]*s,c[1]+u[1]*s,c[2]+u[2]*s);if(l===L.LA_WALL||l===L.RA_WALL){s0+=s;n0++}}if(!n0)return null;s0/=n0;
 const r=Math.ceil((FOSSA_R+.004)/h),ci=c.map((v,a)=>Math.round((v-o[a])/h));let membrane=0,opened=0;
 for(let k=ci[2]-r;k<=ci[2]+r;k++)for(let j=ci[1]-r;j<=ci[1]+r;j++)for(let i=ci[0]-r;i<=ci[0]+r;i++){
  if(i<0||j<0||k<0||i>=nx||j>=ny||k>=nz)continue;const idx=((k*ny+j)*nx+i)*2,l=d[idx];if(l!==L.LA_WALL&&l!==L.RA_WALL)continue;
  const p=[o[0]+i*h-c[0],o[1]+j*h-c[1],o[2]+k*h-c[2]],s=p[0]*u[0]+p[1]*u[1]+p[2]*u[2],rho=Math.hypot(p[0]-s*u[0],p[1]-s*u[1],p[2]-s*u[2]);
  if(rho>FOSSA_R||Math.abs(s-s0)>.006)continue;
  if(Math.abs(s-s0)<=FOSSA_HALF){d[idx]=L.FOSSA;membrane++}else{d[idx]=s<s0?L.LA_BLOOD:L.RA_BLOOD;opened++}}
 return {centre:c,normal:u.map(v=>+v.toFixed(4)),radiusM:FOSSA_R,membraneM:2*FOSSA_HALF,membraneVoxels:membrane,openedVoxels:opened};
}
// The procedural liver of the atlas has a flat top: it leaves a wedge of unlabelled soft tissue under the heart and behind
// the epigastric wall. In patients the dome of the liver lies against the diaphragm there — it is the acoustic window of
// every subcostal view. At load that wedge becomes liver: soft tissue lower than the heart's inferior surface (+12 mm),
// deeper than the abdominal wall (12 mm under the anterior skin), not further left than the left lobe reaches, in front of
// the spine. A teaching correction of the atlas (declared), part of the reference anatomy (Tissue.reset keeps it).
const DOME={above:.012,wall:.012,left:.035,back:.06,low:-.135};
function fillLiverDome(t){
 const L=LABEL,fd=t.fine.data,[nx,ny,nz]=t.fine.dims,h=t.fh,o=t.fo;let zBottom=Infinity;
 for(let k=0;k<nz&&zBottom===Infinity;k++)for(let j=0;j<ny&&zBottom===Infinity;j+=2)for(let i=0;i<nx;i+=2){const l=fd[((k*ny+j)*nx+i)*2];if(l>=10&&l<=23){zBottom=o[2]+k*h;break}}
 if(zBottom===Infinity)return null;const zTop=zBottom+DOME.above;let fine=0,coarse=0;
 const inWedge=(x,y,z)=>z<zTop&&z>DOME.low&&x<DOME.left&&y<DOME.back&&y-atlasSurface(x,z)[1]>DOME.wall;
 for(let k=0;k<nz;k++){const z=o[2]+k*h;if(z>=zTop)break;for(let j=0;j<ny;j++){const y=o[1]+j*h;for(let i=0;i<nx;i++){const idx=((k*ny+j)*nx+i)*2;if(fd[idx]===L.SOFT&&inWedge(o[0]+i*h,y,z)){fd[idx]=L.LIVER;fine++}}}}
 const cd=t.coarse.data,[cx,cy,cz]=t.coarse.dims,ch=t.coarse.spacing,co=t.co;
 for(let k=0;k<cz;k++){const z=co[2]+k*ch;if(z>=zTop)break;for(let j=0;j<cy;j++){const y=co[1]+j*ch;for(let i=0;i<cx;i++){const idx=(k*cy+j)*cx+i;if(cd[idx]===L.SOFT&&inWedge(co[0]+i*ch,y,z)){cd[idx]=L.LIVER;coarse++}}}}
 return {heartBottomZ:+zBottom.toFixed(4),topZ:+zTop.toFixed(4),fineVoxels:fine,coarseVoxels:coarse,rule:DOME};
}
// Thymus of the infant (runtime, by age): the gland fills the anterior-superior mediastinum in front of the great vessels
// and drapes over the top of the heart, where the atlas (an adult) has lung and loose tissue; it is why the high
// parasternal and suprasternal windows are open in infants. Its bed — a teaching shape, not a segmentation: in front of
// the axis of the great arteries, from just below the pulmonary valve to above the arch, within `reach` of the vessels
// and the heart, behind the chest wall (17 mm under the anterior skin), no wider than `half` on each side. `s` (0…1)
// scales reach and width with age.
function thymusBed(lm){
 if(!lm?.pulmonaryValve||!lm?.aorticValve||!lm?.archTop)return null;
 const asc=lm.ascendingAorta||[lm.aorticValve[0],lm.aorticValve[1],lm.aorticValve[2]+.03],pv=lm.pulmonaryValve;
 // the midline and the posterior limit follow the vessels: the axis of the ascending aorta low, the top of the arch high
 return {z0:pv[2]-.012,z1:lm.archTop[2]+.022,xa:(asc[0]+pv[0])/2,xb:lm.archTop[0],ya:Math.max(asc[1],pv[1]),za:asc[2],yb:lm.archTop[1]+.008,zb:lm.archTop[2],half:.036,reach:.03,wall:.017};
}
function inThymus(T,s,x,y,z,d){
 if(!T||z<T.z0||z>T.z1||d>T.reach*s)return false;
 const f=z<=T.za?0:z>=T.zb?1:(z-T.za)/(T.zb-T.za);if(y>T.ya+(T.yb-T.ya)*f)return false;
 const up=(z-T.z0)/(T.z1-T.z0),half=T.half*s*(1-.45*up),dx=(x-(T.xa+(T.xb-T.xa)*f))/half; // narrower toward the neck
 // a lens draped over the vessels: thickest on its midline, thinning to nothing at its lateral and upper and lower
 // edges (no flat faces: a flat face against lung would mirror the beam as a bright bar)
 const e=Math.min(1,Math.min(up,1-up)/.12),lim=T.reach*s*e*(1-dx*dx);
 return dx*dx<1&&d<=lim&&y-atlasSurface(x,z)[1]>T.wall;
}
// Landmarks derived from the label volume at load (the atlas file lists only the hand-placed ones): chamber centres,
// superior vena cava, pulmonary veins, coronary sinus, branch pulmonary arteries and their bifurcation, ascending and
// descending aorta at the level of the heart. Used to build the extra standard views (views.mjs). One pass over the volume.
export function deriveLandmarks(t){
 const d=t.fine.data,[nx,ny,nz]=t.fine.dims,h=t.fh,o=t.fo,lm=t.landmarks,L=LABEL,mv=lm.mitralValve,pv=lm.pulmonaryValve;
 const acc={},add=(k,x,y,z)=>{const a=acc[k]??=[0,0,0,0];a[0]+=x;a[1]+=y;a[2]+=z;a[3]++};
 for(let k=0;k<nz;k++){const z=o[2]+k*h;for(let j=0;j<ny;j++){const y=o[1]+j*h;for(let i=0;i<nx;i++){const l=d[((k*ny+j)*nx+i)*2];if(l<20||l>29)continue;const x=o[0]+i*h;
  switch(l){
   case L.RA_BLOOD:add('raCentre',x,y,z);break;case L.LA_BLOOD:add('laCentre',x,y,z);break;case L.RV_BLOOD:add('rvCentre',x,y,z);break;case L.LV_BLOOD:add('lvCentre',x,y,z);break;
   case L.CAVA_BLOOD:if(z>.03)add('svc',x,y,z);if(z>.03&&z<.055)add('svcJunction',x,y,z);if(z<-.04&&z>-.075)add('ivcHepatic',x,y,z);break;
   case L.PV_BLOOD:if(x<lm.asdSecundum[0]+.01)add('pvRight',x,y,z);else add('pvLeft',x,y,z);break;
   case L.CS_BLOOD:add('coronarySinus',x,y,z);break;
   case L.PA_BLOOD:if(x<-.025)add('rpa',x,y,z);else if(x<-.005)add('rpaProximal',x,y,z);if(x>.03&&y>.02)add('lpa',x,y,z);if(Math.abs(z-.05)<.005&&Math.abs(x-.009)<.012)add('paBifurcation',x,y,z);break;
   case L.AO_BLOOD:if(Math.abs(z-mv[2])<.015&&y>.03)add('descendingAorta',x,y,z);if(z>pv[2]+.008&&z<pv[2]+.04&&y<.02)add('ascendingAorta',x,y,z);break;
  }}}}
 const out={};for(const [k,a] of Object.entries(acc))if(a[3]>20)out[k]=[a[0]/a[3],a[1]/a[3],a[2]/a[3]];return out;
}
export class Tissue{
 constructor(meta,fine,coarse){
  this.meta=meta;this.fine=fine;this.coarse=coarse;this.landmarks=meta.landmarks;this.edits=[];this.effusionMM=0;this._lesion=null;this._fit=null;this._warp=null;
  const [nx,ny,nz]=fine.dims;this.fnx=nx;this.fny=ny;this.fnz=nz;this.fo=fine.origin;this.fh=fine.spacing;this.fi=1/fine.spacing;
  this._breath=null;const [cx,cy,cz]=coarse.dims;this.cnx=cx;this.cny=cy;this.cnz=cz;this.co=coarse.origin;this.ci=1/coarse.spacing;
  if(this.landmarks?.asdSecundum&&!meta.fossaThinned)this.fossa=thinFossa(this);
  if(!meta.liverDomeFilled)this.liverDome=fillLiverDome(this);
  if(this.landmarks?.pulmonaryValve&&!this.landmarks.svc)Object.assign(this.landmarks,deriveLandmarks(this));
  // The pericardium ends on the great arteries (its reflection); above it the vessels have their own wall only. Taken at
  // the level of the pulmonary bifurcation (a teaching approximation by height).
  this.reflectionZ=(this.landmarks?.paBifurcation?.[2]??this.landmarks?.pulmonaryValve?.[2]+.03)??Infinity;
  this.thymus=0;this._thy=thymusBed(this.landmarks);
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
 // Warps between the world the probe sees and this reference volume: the patient's thorax fit (thorax-fit.mjs, identity
 // inside the heart) and the chamber remodelling of a lesion (remodel.mjs). `remodel` is what every consumer applies:
 // world → inverse → reference; reference → forward → world. Setting it sets the lesion's part only.
 get remodel(){return this._warp}
 set remodel(r){this._lesion=r||null;this._compose()}
 // thymus of the infant, 0…1 (thorax-fit.thymusFor): how much of its bed in the anterior-superior mediastinum it fills
 setThymus(s){this.thymus=Math.max(0,Math.min(1,s||0))}
 get fit(){return this._fit}
 setFit(f){this._fit=f||null;this._compose()}
 // breathing (breath.mjs): the outermost warp, whose depth of inspiration changes from frame to frame
 setBreath(b){this._breath=b||null;this._compose()}
 get breath(){return this._breath}
 _compose(){const chain=[this._lesion,this._fit,this._breath].filter(Boolean);
  this._warp=!chain.length?null:chain.length===1?chain[0]:{gains:this._lesion?.gains,
   forward:(p,out=[0,0,0])=>{chain[0].forward(p,out);for(let i=1;i<chain.length;i++)chain[i].forward(out,out);return out},
   inverse:(p,out=[0,0,0])=>{chain[chain.length-1].inverse(p,out);for(let i=chain.length-2;i>=0;i--)chain[i].inverse(out,out);return out}}}
 // label at a point of the fitted body without any lesion (windows, obstruction): the thorax as the probe finds it
 bodyAt(x,y,z){if(!this._fit)return this.tissueAt(x,y,z);const q=this._fit.inverse([x,y,z]);return this.tissueAt(q[0],q[1],q[2])}
 // Label at a world point after runtime layers (pericardium, effusion). Skin layers depend on the ray and are added by the renderer.
 tissueAt(x,y,z){
  const lab=this.lookup(x,y,z),d=this._dist;
  if(this.thymus>0&&d>0&&(lab===LABEL.SOFT||lab===LABEL.LUNG||lab===LABEL.FAT)&&inThymus(this._thy,this.thymus,x,y,z,d)){
   // the gland lies on the pericardium below the reflection, directly on the great vessels above it
   return z<this.reflectionZ&&d>.0004&&d<=.003?LABEL.PERICARDIUM:LABEL.THYMUS}
  if(d<.02&&z<this.reflectionZ&&(lab===LABEL.SOFT||lab===LABEL.FAT||lab===LABEL.LUNG||lab===LABEL.LIVER)&&d>0){
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
 reset(){const d=this.fine.data;while(this.edits.length){const c=this.edits.pop();for(let i=c.length-2;i>=0;i-=2)d[c[i]]=c[i+1]}this.effusionMM=0;this.remodel=null}
}

// ------------------------------------------------------------------ cardiac motion (approximate)
// Phase = fraction of the R–R interval from the QRS; the timing at the patient's heart rate lives in cycle.mjs.
export {ventricularContraction,valveOpening} from './cycle.mjs';
export class HeartMotion{
 constructor(landmarks){
  const A=landmarks.lvApex,mv=landmarks.mitralValve,tv=landmarks.tricuspidValve,base=[0,1,2].map(i=>(mv[i]+tv[i])/2);
  const ax=[0,1,2].map(i=>base[i]-A[i]),L=Math.hypot(...ax);this.A=A;this.a=ax.map(v=>v/L);this.L=L;this.base=base;this.atrial=.055;
  this.longitudinal=.13;
  // LV wall: incompressible thickening around the cavity (landmarks.lvEndo: endocardial / epicardial radius per level and
  // angle around the cavity's centroid axis). The endocardium moves inward by `endo` of its radius at end-systole, the
  // myocardium keeps its volume (it also shortens along the axis), so the epicardium moves much less and the wall thickens; beyond the
  // epicardium the motion fades out over `fade`. A small global radial component moves the RV and atria.
  const T=landmarks.lvEndo;this.radial=T?.04:.16;
  if(T){const from=T.from,to=T.to,d=[0,1,2].map(i=>to[i]-from[i]),l=Math.hypot(...d),a=d.map(v=>v/l),e1=T.e1,e2=[a[1]*e1[2]-a[2]*e1[1],a[2]*e1[0]-a[0]*e1[2],a[0]*e1[1]-a[1]*e1[0]];
   this.lv={from,a,e1,e2,L:l,NL:T.levels,NA:T.angles,cen:Float32Array.from(T.centre),ri:Float32Array.from(T.ri),re:Float32Array.from(T.re),endo:.37,fade:.008}}
  // Right ventricle. Its systole is mostly longitudinal — the lateral tricuspid annulus descends about twice as far as the
  // mitral one — plus the free wall closing on the septum (bellows). Two teaching parameters, set so that the adult atlas
  // measures a normal tricuspid annular excursion and fractional area change in the RV-focused four-chamber view
  // (TAPSE 22.5 ± 3.7 mm, RV FAC 42.9 ± 4.2 %: Sawada 2023): `tapse` adds descent toward the RV side of the atrioventricular
  // plane, `rvIn` is the fraction by which the septum-to-free-wall distance shortens.
  {const side=[0,1,2].map(i=>tv[i]-mv[i]),k=side[0]*this.a[0]+side[1]*this.a[1]+side[2]*this.a[2],p=side.map((v,i)=>v-k*this.a[i]),n=Math.hypot(...p)||1;
   this.rvDir=p.map(v=>v/n);this.tapse=.8;this.rvIn=.22;this.rvR0=.035;
   if(this.lv){const T=this.lv,c=landmarks.rvCentre||tv,d=[0,1,2].map(i=>c[i]-T.from[i]),u=d[0]*T.e1[0]+d[1]*T.e1[1]+d[2]*T.e1[2],v=d[0]*T.e2[0]+d[1]*T.e2[1]+d[2]*T.e2[2],m=Math.hypot(u,v)||1;T.rvU=u/m;T.rvV=v/m}}
 }
 // RV free wall closing on the septum: current position → reference, in place on q. In the LV's cylindrical frame the RV
 // lies beyond the septal surface (the LV epicardial radius) on the RV side; distances from that surface were longer in
 // diastole by 1/(1 − κ), κ fading to nothing toward the septal insertions, the apex and above the base.
 _rv(q,s){const T=this.lv,f=T.from,x=q[0]-f[0],y=q[1]-f[1],z=q[2]-f[2],l=x*T.a[0]+y*T.a[1]+z*T.a[2];
  // full in the body of the ventricle, less toward the annulus (it narrows little), nothing at the apex tip or above the base
  const t=l<0?0:l<.7*T.L?Math.min(1,l/(.06*T.L)):l<=T.L?1-.65*(l-.7*T.L)/(.3*T.L):Math.max(0,.35*(1-(l-T.L)/.02));if(t<=0)return;
  const li=Math.max(0,Math.min(T.NL-1,Math.round(l/T.L*T.NL-.5))),cx=T.cen[li*2],cy=T.cen[li*2+1];
  const u=x*T.e1[0]+y*T.e1[1]+z*T.e1[2]-cx,v=x*T.e2[0]+y*T.e2[1]+z*T.e2[2]-cy,r=Math.hypot(u,v);if(r<1e-6)return;
  const cs=(u*T.rvU+v*T.rvV)/r;if(cs<=0)return;
  let k=Math.atan2(v,u)/(2*Math.PI)*T.NA;if(k<0)k+=T.NA;const k0=Math.floor(k)%T.NA,k1=(k0+1)%T.NA,w=k-Math.floor(k),e0=T.re[li*T.NA+k0],e1=T.re[li*T.NA+k1];if(!e0||!e1)return;
  const re=e0*(1-w)+e1*w;if(r<=re)return;
  // not the anterior wall: it lies against the sternum and stays there (y is posterior in the atlas); the free wall that
  // faces the lung closes in. Beyond the free wall (W from the septum) the displacement fades out over 40 mm.
  const ant=-(u*T.e1[1]+v*T.e2[1])/r,ax=Math.max(0,Math.min(1,(ant-.55)/.35)),wa=1-ax*ax*(3-2*ax);
  const kap=this.rvIn*s*t*Math.min(1,cs*3)*wa;if(kap<=0)return;
  const W=.05,rho=r-re,rc=W*(1-kap),m=(re+(rho<=rc?rho/(1-kap):rho+W*kap*Math.max(0,1-(rho-rc)/.04)))/r;
  q[0]=f[0]+l*T.a[0]+(cx+u*m)*T.e1[0]+(cy+v*m)*T.e2[0];q[1]=f[1]+l*T.a[1]+(cx+u*m)*T.e1[1]+(cy+v*m)*T.e2[1];q[2]=f[2]+l*T.a[2]+(cx+u*m)*T.e1[2]+(cy+v*m)*T.e2[2]}
 // LV wall thickening: current position (after the global motion is undone) → reference, in place on q
 _wall(q,s){const T=this.lv,f=T.from,x=q[0]-f[0],y=q[1]-f[1],z=q[2]-f[2],l=x*T.a[0]+y*T.a[1]+z*T.a[2];if(l<0||l>T.L)return;
  const lf=l/T.L*T.NL-.5,li=Math.max(0,Math.min(T.NL-1,Math.round(lf))),cx=T.cen[li*2],cy=T.cen[li*2+1];
  const u=x*T.e1[0]+y*T.e1[1]+z*T.e1[2]-cx,v=x*T.e2[0]+y*T.e2[1]+z*T.e2[2]-cy,r=Math.hypot(u,v);if(r<1e-6)return;
  let k=Math.atan2(v,u)/(2*Math.PI)*T.NA;if(k<0)k+=T.NA;const k0=Math.floor(k)%T.NA,k1=(k0+1)%T.NA,w=k-Math.floor(k);
  const a0=T.ri[li*T.NA+k0],a1=T.ri[li*T.NA+k1];if(!a0||!a1)return;const ri=a0*(1-w)+a1*w,re=T.re[li*T.NA+k0]*(1-w)+T.re[li*T.NA+k1]*w;
  // taper toward both ends of the cavity (apex tip, valve plane)
  const ends=Math.min(1,l/(.15*T.L),(T.L-l)/(.12*T.L)),e=T.endo*s*Math.max(0,ends),rc=ri*(1-e);if(e<=0)return;
  // the myocardium keeps its volume: it shortens along the axis (longitudinal × s), so its cross-section grows by F
  const F=1/(1-this.longitudinal*s),rec=Math.sqrt(rc*rc+F*(re*re-ri*ri));
  let r0;if(r<=rc)r0=r/(1-e);else if(r<=rec)r0=Math.sqrt(ri*ri+(r*r-rc*rc)/F);else r0=r+(re-rec)*Math.max(0,1-(r-rec)/T.fade);
  const m=r0/r;q[0]=f[0]+(l*T.a[0])+(cx+u*m)*T.e1[0]+(cy+v*m)*T.e2[0];q[1]=f[1]+(l*T.a[1])+(cx+u*m)*T.e1[1]+(cy+v*m)*T.e2[1];q[2]=f[2]+(l*T.a[2])+(cx+u*m)*T.e1[2]+(cy+v*m)*T.e2[2]}
 // current (deformed) position → reference position. s = contraction (0 diastole … 1 end-systole)
 inverse(p,s,out,falloff=1){
  const q=[p[0]-this.A[0],p[1]-this.A[1],p[2]-this.A[2]],l=q[0]*this.a[0]+q[1]*this.a[1]+q[2]*this.a[2];
  const r=[q[0]-l*this.a[0],q[1]-l*this.a[1],q[2]-l*this.a[2]];
  // the atrioventricular plane descends further on the RV side (tricuspid annulus)
  const rr=r[0]*this.rvDir[0]+r[1]*this.rvDir[1]+r[2]*this.rvDir[2],gx=rr<=0?0:Math.min(1,rr/this.rvR0),g=gx*gx*(3-2*gx);
  const shift=this.longitudinal*this.L*s*falloff*(1+this.tapse*g);let l0,rs;
  const baseCur=this.L-shift;
  if(l<=baseCur){l0=l*this.L/Math.max(1e-6,baseCur);const w=Math.sin(Math.PI*Math.max(0,Math.min(1,l0/this.L))*.5+.3);rs=1/(1-this.radial*s*falloff*w)}
  else{const above=l-baseCur,f=Math.max(0,1-above/this.atrial);l0=l+shift*f;rs=1+.05*s*falloff*f}
  out[0]=this.A[0]+l0*this.a[0]+r[0]*rs;out[1]=this.A[1]+l0*this.a[1]+r[1]*rs;out[2]=this.A[2]+l0*this.a[2]+r[2]*rs;
  if(this.lv&&s>0){if(this.rvIn>0)this._rv(out,s*falloff);this._wall(out,s*falloff)}return out;
 }
 // reference → current (for leaflet vertices); small iterations of the inverse
 // (damped: where the RV free wall closes in, the inverse stretches distances up to twofold and the plain iteration would not settle)
 forward(p0,s,out=[0,0,0]){let x=p0[0],y=p0[1],z=p0[2];const t=[0,0,0],c=[0,0,0];
  for(let i=0;i<14;i++){c[0]=x;c[1]=y;c[2]=z;this.inverse(c,s,t);const dx=p0[0]-t[0],dy=p0[1]-t[1],dz=p0[2]-t[2];x+=.7*dx;y+=.7*dy;z+=.7*dz;if(Math.abs(dx)+Math.abs(dy)+Math.abs(dz)<3e-5)break}
  out[0]=x;out[1]=y;out[2]=z;return out}
}
