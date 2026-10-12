// Chamber remodelling: a smooth, reversible warp that enlarges cardiac chambers (volume overload from a shunt) without
// editing the label volume. Each chamber is an ellipsoid fitted to its blood voxels (principal axes); points are moved
// radially in the ellipsoid's normalised coordinates: the cavity scales by (1+g), its wall is carried out by the same
// amount (wall thickness kept) and the displacement fades to zero in the surrounding tissue, which is compressed (the
// septum shifts toward the other ventricle, as in volume overload). Worker-safe, no DOM.
// Use: renderer sample p (world, after the heart's own motion) → inverse(p) → reference anatomy; leaflets: forward().
import {LABEL} from './tissue.mjs';

// principal axes of a chamber's blood (fitted once on the reference anatomy)
export function chamberShape(tissue,label){
 const d=tissue.fine.data,[nx,ny,nz]=tissue.fine.dims,h=tissue.fh,o=tissue.fo;let n=0;const m=[0,0,0],S=[0,0,0,0,0,0];
 for(let k=0;k<nz;k+=2)for(let j=0;j<ny;j+=2)for(let i=0;i<nx;i+=2){if(d[((k*ny+j)*nx+i)*2]!==label)continue;const x=o[0]+i*h,y=o[1]+j*h,z=o[2]+k*h;n++;
  m[0]+=x;m[1]+=y;m[2]+=z;S[0]+=x*x;S[1]+=y*y;S[2]+=z*z;S[3]+=x*y;S[4]+=x*z;S[5]+=y*z}
 if(!n)return null;const c=m.map(v=>v/n);
 const C=[[S[0]/n-c[0]*c[0],S[3]/n-c[0]*c[1],S[4]/n-c[0]*c[2]],[0,S[1]/n-c[1]*c[1],S[5]/n-c[1]*c[2]],[0,0,S[2]/n-c[2]*c[2]]];C[1][0]=C[0][1];C[2][0]=C[0][2];C[2][1]=C[1][2];
 const {values,vectors}=eigSym(C);
 // uniform solid ellipsoid: variance along an axis = a²/5
 return {label,centre:c,axes:vectors,radii:values.map(v=>Math.sqrt(5*Math.max(v,1e-8))),voxels:n*8,volumeML:n*8*h*h*h*1e6};
}
// Jacobi eigen-decomposition of a symmetric 3×3 matrix; vectors as rows (unit)
function eigSym(A){
 const a=A.map(r=>[...r]),V=[[1,0,0],[0,1,0],[0,0,1]];
 for(let sweep=0;sweep<50;sweep++){let off=Math.abs(a[0][1])+Math.abs(a[0][2])+Math.abs(a[1][2]);if(off<1e-14)break;
  for(const [p,q] of [[0,1],[0,2],[1,2]]){if(Math.abs(a[p][q])<1e-18)continue;const th=(a[q][q]-a[p][p])/(2*a[p][q]),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
   for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq}
   for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk}
   for(let k=0;k<3;k++){const vkp=V[k][p],vkq=V[k][q];V[k][p]=c*vkp-s*vkq;V[k][q]=s*vkp+c*vkq}}}
 return {values:[a[0][0],a[1][1],a[2][2]],vectors:[0,1,2].map(i=>[V[0][i],V[1][i],V[2][i]])};
}

export const CHAMBER_LABEL={RA:LABEL.RA_BLOOD,RV:LABEL.RV_BLOOD,LA:LABEL.LA_BLOOD,LV:LABEL.LV_BLOOD,PA:LABEL.PA_BLOOD};
const WALL=.28,smooth=x=>x<=0?1:x>=1?0:1-x*x*(3-2*x);

// gains: {RV:.15,…} linear enlargement of each chamber (0 = unchanged). Returns null when nothing changes.
export function createRemodel(shapes,gains){
 const items=[];
 for(const [k,g] of Object.entries(gains||{})){const s=shapes[k];if(!s||!(g>1e-4))continue;
  const fade=Math.max(.9,2.2*g); // monotone warp: the outward shift g decays over `fade` (no folding while g/fade < 2/3)
  items.push({k,g,c:s.centre,ax:s.axes,r:s.radii,fade,reach:1+WALL+fade,rmax:Math.max(...s.radii)})}
 if(!items.length)return null;
 // one chamber's displacement at x (into u); chambers are applied one after the other (a composition of invertible
 // warps stays invertible; a sum of overlapping ones can fold where two enlarged chambers meet, e.g. LA and LV)
 function disp(it,x,y,z,u){u[0]=u[1]=u[2]=0;
  const qx=x-it.c[0],qy=y-it.c[1],qz=z-it.c[2];if(qx*qx+qy*qy+qz*qz>(it.reach*it.rmax)**2)return u;
  const a=it.ax,r=it.r,y0=(qx*a[0][0]+qy*a[0][1]+qz*a[0][2])/r[0],y1=(qx*a[1][0]+qy*a[1][1]+qz*a[1][2])/r[1],y2=(qx*a[2][0]+qy*a[2][1]+qz*a[2][2])/r[2];
  const rho=Math.hypot(y0,y1,y2);if(rho>=it.reach||rho<1e-9)return u;
  // inside the cavity the shift grows with radius (uniform scaling), the wall moves out as a block, then it fades
  const dr=it.g*Math.min(rho,1)*smooth((rho-1-WALL)/it.fade),f=dr/rho;
  const e0=y0*f*r[0],e1=y1*f*r[1],e2=y2*f*r[2];
  u[0]=e0*a[0][0]+e1*a[1][0]+e2*a[2][0];u[1]=e0*a[0][1]+e1*a[1][1]+e2*a[2][1];u[2]=e0*a[0][2]+e1*a[1][2]+e2*a[2][2];return u}
 const u=[0,0,0];
 return {gains:Object.fromEntries(items.map(i=>[i.k,i.g])),
  forward(p,out=[0,0,0]){let x=p[0],y=p[1],z=p[2];for(const it of items){disp(it,x,y,z,u);x+=u[0];y+=u[1];z+=u[2]}out[0]=x;out[1]=y;out[2]=z;return out},
  // reference point whose image is p: undo the chambers in reverse order, each by fixed-point iteration x0 = p − u(x0)
  inverse(p,out=[0,0,0]){let px=p[0],py=p[1],pz=p[2];
   for(let k=items.length-1;k>=0;k--){const it=items[k];let x=px,y=py,z=pz;
    for(let i=0;i<12;i++){disp(it,x,y,z,u);const nx=px-u[0],ny=py-u[1],nz=pz-u[2],dd=Math.abs(nx-x)+Math.abs(ny-y)+Math.abs(nz-z);x=nx;y=ny;z=nz;if(dd<1e-6)break}
    px=x;py=y;pz=z}
   out[0]=px;out[1]=py;out[2]=pz;return out}};
}
// cached reference shapes of the chambers a remodel can enlarge
export function referenceShapes(tissue){
 if(!tissue._shapes){tissue._shapes={};for(const [k,l] of Object.entries(CHAMBER_LABEL))tissue._shapes[k]=chamberShape(tissue,l)}
 return tissue._shapes;
}
