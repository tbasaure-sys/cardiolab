// Chest radiograph (AP) of the virtual patient: the tissue volume projected along the antero-posterior axis with the chambers'
// enlargement applied (remodel.mjs), the cardiothoracic ratio measured on that projection, and a film-like picture.
// The silhouette is the real geometry of the simulated heart (the same volume the echo scans); the pulmonary vascular markings
// are schematic (model) and grow with the pulmonary flow. Worker-safe (projectChest) and DOM-free (cxrPixels).
import {LABEL} from './tissue.mjs';

// X-ray attenuation per mm of path (relative units, model): air 0, aerated lung low, soft tissue and fat below blood and muscle, bone high
const MU=new Float32Array(256).fill(.9);
MU[LABEL.AIR]=0;MU[LABEL.LUNG]=.12;MU[LABEL.SOFT]=.42;MU[LABEL.FAT]=.38;MU[LABEL.LIVER]=1;MU[LABEL.BONE]=2.8;MU[LABEL.CARTILAGE]=1.2;
for(const l of [LABEL.LV_MYO,LABEL.RV_MYO,LABEL.LA_WALL,LABEL.RA_WALL,LABEL.PAPILLARY,LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD,LABEL.AO_BLOOD,LABEL.PA_BLOOD,LABEL.CAVA_BLOOD,LABEL.PV_BLOOD,LABEL.VESSEL_WALL])MU[l]=1.05;
const CHAMBER=new Set([LABEL.LV_MYO,LABEL.RV_MYO,LABEL.LA_WALL,LABEL.RA_WALL,LABEL.PAPILLARY,LABEL.LV_BLOOD,LABEL.RV_BLOOD,LABEL.LA_BLOOD,LABEL.RA_BLOOD]);

// opts.remodel: chamber enlargement (null = the reference heart). Atlas metres; x > 0 is the patient's left, z > 0 cranial.
export function projectChest(tissue,{remodel=null,dx=.0025,dz=.0025,step=.003,box={x:[-.175,.135],z:[-.12,.17],y:[-.14,.13]}}={}){
 const nx=Math.round((box.x[1]-box.x[0])/dx),nz=Math.round((box.z[1]-box.z[0])/dz),dens=new Float32Array(nx*nz),heart=new Uint8Array(nx*nz),lung=new Uint8Array(nx*nz),p=[0,0,0],q=[0,0,0];
 for(let iz=0;iz<nz;iz++){const z=box.z[0]+(iz+.5)*dz;
  for(let ix=0;ix<nx;ix++){const x=box.x[0]+(ix+.5)*dx;let sum=0,h=0,lg=0;
   for(let y=box.y[0];y<box.y[1];y+=step){p[0]=x;p[1]=y;p[2]=z;const r=remodel?remodel.inverse(p,q):p,l=tissue.tissueAt(r[0],r[1],r[2]);sum+=MU[l]*step*1000;if(CHAMBER.has(l))h=1;else if(l===LABEL.LUNG)lg=1}
   const i=iz*nx+ix;dens[i]=sum;heart[i]=h;lung[i]=lg}}
 return {nx,nz,x0:box.x[0],z0:box.z[0],dx,dz,density:dens,heart,lung,metrics:cardiothoracic({nx,nz,x0:box.x[0],z0:box.z[0],dx,dz,heart,lung})};
}
// widest heart (chambers) from the right to the left border; internal thoracic width = widest lung field around that level
export function cardiothoracic(P){
 const {nx,nz,heart,lung,dx,dz}=P;let hx=[nx,-1],hz=[nz,-1];
 for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++)if(heart[iz*nx+ix]){hx[0]=Math.min(hx[0],ix);hx[1]=Math.max(hx[1],ix);hz[0]=Math.min(hz[0],iz);hz[1]=Math.max(hz[1],iz)}
 if(hx[1]<0)return {ctr:null,heartWidth:0,thoraxWidth:0,heartHeight:0,heartX:null,thoraxX:null};
 let tx=[nx,-1];const lo=Math.max(0,hz[0]-8),hi=Math.min(nz-1,hz[1]+8);
 for(let iz=lo;iz<=hi;iz++){let a=-1,b=-1;for(let ix=0;ix<nx;ix++)if(lung[iz*nx+ix]){if(a<0)a=ix;b=ix}if(a>=0&&b-a>tx[1]-tx[0]){tx=[a,b]}}
 const hw=(hx[1]-hx[0]+1)*dx,tw=(tx[1]-tx[0]+1)*dx;
 return {ctr:hw/tw,heartWidth:hw,thoraxWidth:tw,heartHeight:(hz[1]-hz[0]+1)*dz,heartX:[P.x0+hx[0]*dx,P.x0+(hx[1]+1)*dx],thoraxX:[P.x0+tx[0]*dx,P.x0+(tx[1]+1)*dx],heartZ:[P.z0+hz[0]*dz,P.z0+(hz[1]+1)*dz]};
}
// a film-like picture (RGBA, nx × nz, cranial at the top, patient's right on the image left as in a radiograph: atlas x grows to the right): bright = dense.
// vascular: 0…1 schematic pulmonary markings in the lung fields (grows with the pulmonary flow)
export function cxrPixels(P,{vascular=0,outline=false}={}){
 const {nx,nz,density,lung}=P,out=new Uint8ClampedArray(nx*nz*4),hil={x:nx*.5,z:nz*.52};
 for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
  const i=iz*nx+ix,o=((nz-1-iz)*nx+ix)*4; // flip vertically: cranial up; x > 0 is the patient's left, so it lands on the image right as on a radiograph
  let v=1-Math.exp(-density[i]*.0165);
  if(lung[i]&&!P.heart[i]){const a=Math.atan2(iz-hil.z,ix-hil.x),d=Math.hypot(ix-hil.x,iz-hil.z)/nx,m=Math.max(0,Math.sin(a*9+Math.sin(d*17)*2.2)),f=Math.max(0,1-d*1.5);v+=vascular*.2*m*f+.02*vascular}
  const g=Math.max(0,Math.min(255,Math.round(255*Math.pow(v,.9))));out[o]=out[o+1]=out[o+2]=g;out[o+3]=255;
  if(outline&&P.heart[i]){const e=ix===0||ix===nx-1||iz===0||iz===nz-1||!P.heart[i-1]||!P.heart[i+1]||!P.heart[i-nx]||!P.heart[i+nx];if(e){out[o]=255;out[o+1]=227;out[o+2]=152}}}
 return out;
}
