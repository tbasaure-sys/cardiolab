// Physiology measured on the simulated heart (physics & physiology chapters). Worker-safe, no DOM.
// LV volume through the beat: the cavity is sampled on a grid around the reference LV blood and every point is taken back
// through the heart's motion (and any chamber remodelling) to the reference anatomy, exactly as the B-mode renderer
// does, so the curve is the volume of the cavity the images show — not a separate model.
import {LABEL,ventricularContraction} from './tissue.mjs';

// candidate points: reference LV blood (and mitral orifice) dilated by `margin`, on a `step` grid (atlas metres)
function lvCandidates(tissue,step,margin){
 const d=tissue.fine.data,[nx,ny,nz]=tissue.fine.dims,h=tissue.fh,o=tissue.fo,inLV=l=>l===LABEL.LV_BLOOD||l===LABEL.MITRAL;
 let lo=[1,1,1],hi=[-1,-1,-1];
 for(let k=0;k<nz;k+=2)for(let j=0;j<ny;j+=2)for(let i=0;i<nx;i+=2){if(!inLV(d[((k*ny+j)*nx+i)*2]))continue;const p=[o[0]+i*h,o[1]+j*h,o[2]+k*h];for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],p[a]);hi[a]=Math.max(hi[a],p[a])}}
 const pts=[];const m=Math.ceil(margin/step);
 for(let z=lo[2]-margin;z<=hi[2]+margin;z+=step)for(let y=lo[1]-margin;y<=hi[1]+margin;y+=step)for(let x=lo[0]-margin;x<=hi[0]+margin;x+=step){
  // keep points within `margin` of LV blood (coarse test on the axes)
  let near=false;for(let a=-m;a<=m&&!near;a++)for(const ax of [0,1,2]){const q=[x,y,z];q[ax]+=a*step;if(inLV(tissue.tissueAt(q[0],q[1],q[2]))){near=true;break}}
  if(near)pts.push(x,y,z)}
 return new Float32Array(pts);
}
// volume (mL, physical, for body scale k) at `phases` fractions of the R–R interval
export function lvVolumeCurve(tissue,motion,{phases=40,step=.002,margin=.006,k=1}={}){
 const pts=tissue._lvPts||(tissue._lvPts=lvCandidates(tissue,step,margin)),q=[0,0,0],p=[0,0,0],r=[0,0,0],remodel=tissue.remodel||null,inLV=l=>l===LABEL.LV_BLOOD||l===LABEL.MITRAL;
 // with remodelling the cavity is bigger: candidates are moved with the chambers
 const cand=remodel?pts.map((v,i)=>v):pts;if(remodel)for(let i=0;i<cand.length;i+=3){remodel.forward([cand[i],cand[i+1],cand[i+2]],r);cand[i]=r[0];cand[i+1]=r[1];cand[i+2]=r[2]}
 const out=[],cell=step**3*k**3*1e6;
 for(let f=0;f<phases;f++){const t=f/phases,s=ventricularContraction(t);let n=0;
  for(let i=0;i<cand.length;i+=3){p[0]=cand[i];p[1]=cand[i+1];p[2]=cand[i+2];let x=p;if(remodel){remodel.inverse(p,r);x=r}
   if(s){tissue.lookup(x[0],x[1],x[2]);const dd=tissue.lastDistance,fall=dd<=.002?1:dd>=.014?0:1-(dd-.002)/.012;if(fall>0){motion.inverse(x,s,q,fall);x=q}}
   if(inLV(tissue.tissueAt(x[0],x[1],x[2])))n++}
  out.push({t,ml:n*cell})}
 return out;
}
