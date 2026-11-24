// Breathing. With each breath the diaphragm carries the heart down and back; the probe rests on the chest, so on the screen
// the heart slides under a still fan. Here the heart and the great vessels shift together by S·r, r = 0 at end-expiration …
// 1 at end-inspiration; around them the shift fades with the distance to the heart (the tissue volume's own distance
// channel) and is gone MARGIN away, where the surrounding tissue stretches (lung and liver slide on the heart). A smooth,
// invertible warp like the others (world → inverse → reference).
// Teaching assumptions (no source): the excursion (BREATH_SHIFT, atlas metres, i.e. adult size; it scales with the patient),
// its direction (caudal, slightly anterior), one breath every BREATH_BEATS heartbeats and the shape of the breath.
// Not modelled: lung moving over the windows, respiratory variation of flows and of the inferior vena cava.
// Doppler, M-mode, measurements of record and the figures of the study are computed in apnoea (r = 0).

// MARGIN is a distance in the atlas (before the thorax fit). Where the fit compresses the chest wall onto the heart the
// margin is compressed with it and the shift still changes slowly enough for the warp to stay monotone:
// |S|·1.5 / (MARGIN · smallest fit factor) < 1. Where the heart lies against the wall the margin reaches the skin: the
// tissue under the probe moves by about a millimetre at most (atlas size).
export const BREATH_SHIFT=[0,-.001,-.005],BREATH_BEATS=4,MARGIN=.03,EDGE=.015;
// how far into inspiration, 0…1, at a position in the breath (0…1): inspiration takes 40 % of the breath
export function breathAt(t){const x=((t%1)+1)%1;return x<.4?.5*(1-Math.cos(Math.PI*x/.4)):.5*(1+Math.cos(Math.PI*(x-.4)/.6))}
// position in the breath of a cine frame: `beat` 0…BREATH_BEATS−1, cardiac phase 0…1
export const breathOfFrame=(beat,phase)=>breathAt((beat+phase)/BREATH_BEATS);
// A breath warp over a tissue volume; its depth of inspiration `r` is set per frame (0 = apnoea at end-expiration: the
// identity). It acts on the fitted thorax (after tissue.fit), so the distance is read at the atlas point behind each point.
export function createBreath(tissue,shift=BREATH_SHIFT){
 const S=shift,q=[0,0,0],lo=tissue.fo,hi=tissue.fo.map((v,i)=>v+(tissue.fine.dims[i]-1)*tissue.fh);const D=tissue.fine.data,[nx,ny,nz]=tissue.fine.dims,fi=1/tissue.fh;
 // 1 on the heart and great vessels, falling smoothly to 0 at MARGIN from them; also to 0 toward the faces of the detailed
 // volume, where vessels leave it (no tear where the aorta or the cava cross its boundary)
 function hold(x,y,z){const f=tissue.fit;if(f){q[0]=x;q[1]=y;q[2]=z;f.inverse(q,q);x=q[0];y=q[1];z=q[2]}
  const e=Math.min(x-lo[0],hi[0]-x,y-lo[1],hi[1]-y,z-lo[2],hi[2]-z);if(e<=0)return 0;
  // distance to the heart, interpolated between voxels (the stored channel is in steps of 0.25 mm on a 1 mm grid)
  const fx=(x-lo[0])*fi,fy=(y-lo[1])*fi,fz=(z-lo[2])*fi,ix=Math.min(nx-2,Math.floor(fx)),iy=Math.min(ny-2,Math.floor(fy)),iz=Math.min(nz-2,Math.floor(fz)),tx=fx-ix,ty=fy-iy,tz=fz-iz,i0=((iz*ny+iy)*nx+ix)*2+1,sx=2,sy=nx*2,sz=nx*ny*2;
  const d=.00025*(((D[i0]*(1-tx)+D[i0+sx]*tx)*(1-ty)+(D[i0+sy]*(1-tx)+D[i0+sy+sx]*tx)*ty)*(1-tz)+((D[i0+sz]*(1-tx)+D[i0+sz+sx]*tx)*(1-ty)+(D[i0+sz+sy]*(1-tx)+D[i0+sz+sy+sx]*tx)*ty)*tz);if(!(d<MARGIN))return 0;
  let u=1-d/MARGIN;u=u*u*(3-2*u);if(e<EDGE){const w=e/EDGE;u*=w*w*(3-2*w)}return u}
 const b={r:0,hold,
  forward(p,out=[0,0,0]){const k=b.r?b.r*hold(p[0],p[1],p[2]):0;out[0]=p[0]+S[0]*k;out[1]=p[1]+S[1]*k;out[2]=p[2]+S[2]*k;return out},
  // the point that moved to p: p₀ = p − S·r·hold(p₀). Deep inside the heart or far from it the answer is immediate; in
  // the margin, fixed-point steps (they settle: the shift changes slowly across it)
  inverse(p,out=[0,0,0]){const px=p[0],py=p[1],pz=p[2];out[0]=px;out[1]=py;out[2]=pz;if(!b.r)return out;
   const k1=hold(px,py,pz),k0=hold(px-S[0]*b.r,py-S[1]*b.r,pz-S[2]*b.r);if(k1===0&&k0===0)return out;
   if(k1===1&&k0===1){out[0]=px-S[0]*b.r;out[1]=py-S[1]*b.r;out[2]=pz-S[2]*b.r;return out}
   let x=px-S[0]*b.r*k0,y=py-S[1]*b.r*k0,z=pz-S[2]*b.r*k0;
   for(let i=0;i<24;i++){const k=b.r*hold(x,y,z),nx=px-S[0]*k,ny=py-S[1]*k,nz=pz-S[2]*k,e=Math.abs(nx-x)+Math.abs(ny-y)+Math.abs(nz-z);x=.5*(x+nx);y=.5*(y+ny);z=.5*(z+nz);if(e<4e-6)break}
   out[0]=x;out[1]=y;out[2]=z;return out}};
 return b;
}
