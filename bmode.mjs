// Ray-based B-mode simulation over the tissue volume.
// Per scan line: attenuation, specular reflection at impedance changes (angle dependent),
// coherent speckle from a position-locked random scatterer field, rib/lung shadowing,
// lung reverberation (A-lines), then axial/lateral point-spread, envelope, TGC and log compression.
import {LABEL,PROPS} from './tissue.mjs';

// deterministic hash → gaussian pair, locked to world position (speckle follows anatomy)
function hash3(x,y,z){let h=(x*374761393+y*668265263+z*2147483647)|0;h=(h^(h>>>13))*1274126177|0;h^=h>>>16;return (h>>>0)/4294967296}
const TWO_PI=Math.PI*2;
// complex gaussian table (speckle) indexed by a position hash
const GN=8192,GRE=new Float32Array(GN),GIM=new Float32Array(GN),HET=new Float32Array(GN);
for(let i=0;i<GN;i++){const u1=hash3(i,3,9)+1e-9,u2=hash3(i,7,1),m=Math.sqrt(-2*Math.log(u1));GRE[i]=m*Math.cos(TWO_PI*u2);GIM[i]=m*Math.sin(TWO_PI*u2);HET[i]=.65+.7*hash3(i,11,5)}
// periodic 32³ smooth noise (3 channels) → organic, non-mesh-like tissue boundaries and trabeculae
const NW=32,NWM=NW-1,WARP=new Float32Array(NW*NW*NW*3);for(let i=0;i<WARP.length;i++)WARP[i]=hash3(i,21,4)*2-1;
function smoothWarp(){const t=new Float32Array(WARP.length);for(let pass=0;pass<2;pass++){for(let z=0;z<NW;z++)for(let y=0;y<NW;y++)for(let x=0;x<NW;x++)for(let c=0;c<3;c++){let s=0;for(let d=-1;d<=1;d++){s+=WARP[((((z+d)&NWM)*NW+y)*NW+x)*3+c]+WARP[(((z*NW+((y+d)&NWM))*NW+x)*3+c)]+WARP[(((z*NW+y)*NW+((x+d)&NWM))*3+c)]}t[((z*NW+y)*NW+x)*3+c]=s/9}WARP.set(t)}let m=0;for(const v of WARP)m=Math.max(m,Math.abs(v));for(let i=0;i<WARP.length;i++)WARP[i]/=m}
smoothWarp();
function warpAt(x,y,z,scale,out){const fx=x*scale,fy=y*scale,fz=z*scale,ix=Math.floor(fx),iy=Math.floor(fy),iz=Math.floor(fz),tx=fx-ix,ty=fy-iy,tz=fz-iz;
 out[0]=out[1]=out[2]=0;for(let c=0;c<8;c++){const dx=c&1,dy=(c>>1)&1,dz=c>>2,w=(dx?tx:1-tx)*(dy?ty:1-ty)*(dz?tz:1-tz),b=((((iz+dz)&NWM)*NW+((iy+dy)&NWM))*NW+((ix+dx)&NWM))*3;out[0]+=w*WARP[b];out[1]+=w*WARP[b+1];out[2]+=w*WARP[b+2]}}
// scatterer clustering: log-normal amplitude at ~1.2 mm with occasional bright sparkles (as in real tissue)
// (moderate: strong clustering made myocardium look like cotton wool with salt; harmonic images are finer)
const CLU=new Float32Array(GN);for(let i=0;i<GN;i++){const g=Math.sqrt(-2*Math.log(hash3(i,41,2)+1e-9))*Math.cos(TWO_PI*hash3(i,43,6));CLU[i]=Math.exp(.36*g-.065)*(hash3(i,47,8)<.012?1.8:1)}
// gentle tissue heterogeneity at ~1.5 mm (HET, wider, is also used for noise and colour dropout)
const HETT=new Float32Array(GN);for(let i=0;i<GN;i++)HETT[i]=.82+.36*hash3(i,61,9);
// large-scale patchiness (~5 mm): real tissue brightness is never uniform
const PATCH=new Float32Array(GN);for(let i=0;i<GN;i++){const g=Math.sqrt(-2*Math.log(hash3(i,53,3)+1e-9))*Math.cos(TWO_PI*hash3(i,59,7));PATCH[i]=Math.exp(.3*g-.045)}
function hidx(x,y,z){let h=(x*374761393+y*668265263+z*1274126177)|0;h=(h^(h>>>13))*1103515245|0;return (h^(h>>>16))&(GN-1)}
// smooth value noise over a hashed lattice (smoothstep between the 8 corners): tissue modulations vary continuously;
// constant-per-cube values, cut by an oblique plane, showed as a polygonal mosaic («honeycomb» myocardium)
function smoothField(T,fx,fy,fz){const ix=Math.floor(fx),iy=Math.floor(fy),iz=Math.floor(fz);let tx=fx-ix,ty=fy-iy,tz=fz-iz;
 tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty);tz=tz*tz*(3-2*tz);
 const a=T[hidx(ix,iy,iz)]*(1-tx)+T[hidx(ix+1,iy,iz)]*tx,b=T[hidx(ix,iy+1,iz)]*(1-tx)+T[hidx(ix+1,iy+1,iz)]*tx,
  c=T[hidx(ix,iy,iz+1)]*(1-tx)+T[hidx(ix+1,iy,iz+1)]*tx,d=T[hidx(ix,iy+1,iz+1)]*(1-tx)+T[hidx(ix+1,iy+1,iz+1)]*tx;
 return (a*(1-ty)+b*ty)*(1-tz)+(c*(1-ty)+d*ty)*tz}

export function tgcAmplitude(tgc,f){const x=Math.max(0,Math.min(1,f))*(tgc.length-1),i=Math.floor(x),v=tgc[i]+(tgc[Math.min(i+1,tgc.length-1)]-tgc[i])*(x-i);return 2**((v-50)/25)}

export function createBMode(){
 let re,im,trans,env,ovb,cvb,cap=0;
 function ensure(n){if(n>cap){cap=n;re=new Float32Array(n);im=new Float32Array(n);trans=new Float32Array(n);env=new Float32Array(n)}}
 // opts: {pose, lines, samples, freq (MHz), gain, tgc[8], dynamicRange (dB), focus (0..1 of depth), motion, contraction, overlays:[{segments,strength}], clutter, bodyScale, harmonic}
 // harmonic (THI, default): the image is formed at 2f, so less chest-wall clutter and side-lobe haze, a narrower
 // beam and weak signal close to the probe (the harmonic builds up with depth), at the cost of penetration.
 // Positions along the ray (r, dr) are in atlas units, like the anatomy; bodyScale (K) converts them to physical
 // metres for everything acoustic (attenuation, wavelength, speckle size, beam width, reverberations).
 function render(tissue,opts){
  const {pose,lines=176,freq=4,gain=1,tgc=[50,50,50,50,50,50,50,50],dynamicRange=52,focus=.55,motion=null,contraction=0,overlays=[],color=null}=opts,K=opts.bodyScale||1,H=opts.harmonic!==false;
  const depth=pose.depth,samples=opts.samples||Math.min(960,Math.round(depth*K/.00025)),dr=depth/samples,drp=dr*K,N=lines*samples;ensure(N);re.fill(0,0,N);im.fill(0,0,N);trans.fill(0,0,N);
  const sector=pose.sector*Math.PI/180,o=pose.origin,u=pose.u,d=pose.d;
  // slice thickness (elevation): the image integrates a few millimetres on both sides of the plane, thinnest at the
  // elevation focus of the probe lens — oblique walls blur, thin out-of-plane structures show partially and
  // shadows have soft edges. Three sub-rays across the slice, weighted like the elevation beam profile.
  const nv=pose.n||[u[1]*d[2]-u[2]*d[1],u[2]*d[0]-u[0]*d[2],u[0]*d[1]-u[1]*d[0]],ELEV=opts.elevation===false?[[0,1]]:[[-1,.45],[0,.77],[1,.45]],
   EW=ELEV.reduce((t,e)=>t+e[1],0); // sub-ray echoes have independent speckle phases, so they add in power: Σw² = 1 keeps
   // uniform tissue as bright as with a thin plane (only partial volume lowers it); the transmitted energy averages (÷Σw)
  // slice ≈2.5 mm at the elevation focus for a 6 MHz probe, thinner for higher-frequency (neonatal) probes (∝ wavelength);
  // the lens focuses about the heart's centre for the patient the probe is chosen for (6 cm × body scale)
  const eF=.06*K,eW=.0025*(6/freq),elevAt=r=>.45*eW*(H?.85:1)*Math.sqrt(1+((r*K-eF)/(.58*eF))**2)/K; // sub-ray offset (atlas units)
  const alphaNp=(db)=>db*freq*.1151*100; // per metre (one-way), from dB/cm/MHz
  const cell=.00016*(4/freq)/K*(H?1:1.25); // speckle cell ~ scales with wavelength (physical), expressed in atlas units
  const p=[0,0,0],q=[0,0,0],wv=[0,0,0];let meanLungDepth=0,lungHits=0;
  // colour Doppler box (angles in degrees relative to the beam axis, radii as fractions of depth)
  let cj0=1,cj1=0,ck0=1,ck1=0,cv=null;const vel=[0,0,0];
  if(color&&color.flow){const r=color.roi;cj0=Math.max(0,Math.floor(((r.center-r.half)*Math.PI/180+sector/2)/sector*lines));cj1=Math.min(lines-1,Math.ceil(((r.center+r.half)*Math.PI/180+sector/2)/sector*lines));
   ck0=Math.max(0,Math.floor(r.r0*samples));ck1=Math.min(samples-1,Math.ceil(r.r1*samples));if(!cvb||cvb.length<N)cvb=new Float32Array(N);cv=cvb;cv.fill(NaN,0,N)}
  const stepAtt=new Float32Array(256);for(let l=0;l<256;l++)stepAtt[l]=Math.exp(-2*alphaNp(PROPS[l*3+2])*drp*(H?1.12:1));
  const icell=1/cell,JIT=new Float32Array(1024);for(let i=0;i<1024;i++)JIT[i]=(hash3(i,5,7)-.5)*.0008;
  for(let j=0;j<lines;j++){
   const th=-sector/2+sector*(j+.5)/lines,s=Math.sin(th),c=Math.cos(th);
   const bx=c*d[0]+s*u[0],by=c*d[1]+s*u[1],bz=c*d[2]+s*u[2];
   let I=1,prevZ=1.63,prevLab=-1,inLung=false,lungAt=0,base=j*samples,entered=false;
   const directivity=Math.cos(th)**1.6*(.8+.2*Math.cos(th*2));
   for(const [eo,ew] of ELEV){I=1;prevZ=1.63;prevLab=-1;inLung=false;lungAt=0;entered=false;
   for(let k=0;k<samples;k++){
    const r=(k+.5)*dr,e=eo?eo*elevAt(r):0;p[0]=o[0]+bx*r+nv[0]*e;p[1]=o[1]+by*r+nv[1]*e;p[2]=o[2]+bz*r+nv[2]*e;
    let x=p[0],y=p[1],z=p[2];
    if(motion&&contraction){
     // only the heart moves: fade the deformation out over ~12 mm outside the cardiac envelope
     tissue.lookup(x,y,z);const dd=tissue.lastDistance,fall=dd<=.002?1:dd>=.014?0:1-(dd-.002)/.012;
     if(fall>0){motion.inverse(p,contraction,q,fall);x=q[0];y=q[1];z=q[2]}
    }
    // organic boundaries: warp the lookup position with smooth noise (≈1 mm, finer and stronger inside the heart)
    {const dd=tissue.lookup(x,y,z)>=0?tissue.lastDistance:1;if(dd<.02){warpAt(x,y,z,160,wv);const amp=.0011*(dd<.004?1:(.02-dd)/.016);x+=wv[0]*amp;y+=wv[1]*amp;z+=wv[2]*amp;warpAt(x+.3,y,z,420,wv);x+=wv[0]*.0005;y+=wv[1]*.0005;z+=wv[2]*.0005}}
    // dither by ±0.4 voxel to hide the 1 mm staircase
    const jit=JIT[(j*131+k)&1023];
    let lab=tissue.tissueAt(x+jit,y-jit,z+jit*.5);
    // coupling gel: until the beam enters the body, air is ignored
    if(lab===LABEL.AIR&&!entered){trans[base+k]+=ew/EW;continue}entered=true;
    // skin and chest-wall layers along the ray (the probe sits on the skin)
    if(lab===LABEL.SOFT||lab===LABEL.LIVER){if(r<.0018)lab=LABEL.SKIN;else if(r<.0055)lab=LABEL.SUBCUT;else if(r<.014&&lab===LABEL.SOFT)lab=LABEL.MUSCLE;else if(lab===LABEL.SOFT&&r>.02&&tissue.lastDistance>.003&&tissue.lastDistance<.05)lab=LABEL.MEDIASTINUM}
    const pi=lab*3,scat=PROPS[pi],Z=PROPS[pi+1];
    let a=0,b=0;
    if(lab!==prevLab&&prevLab>=0){
     const rc=(Z-prevZ)/(Z+prevZ);
     if(Math.abs(rc)>.004){
      // surface normal from the label field (central differences of impedance)
      const h=.001,zx=PROPS[tissue.tissueAt(x+h,y,z)*3+1]-PROPS[tissue.tissueAt(x-h,y,z)*3+1],zy=PROPS[tissue.tissueAt(x,y+h,z)*3+1]-PROPS[tissue.tissueAt(x,y-h,z)*3+1],zz=PROPS[tissue.tissueAt(x,y,z+h)*3+1]-PROPS[tissue.tissueAt(x,y,z-h)*3+1];
      const gl=Math.hypot(zx,zy,zz),cosi=gl>1e-6?Math.abs(zx*bx+zy*by+zz*bz)/gl:.5;
      const arc=Math.abs(rc),specular=arc*(arc>.05?1:.22)*(cosi**6*.85+.15*cosi)*I;
      const ph=hash3(Math.round(x/cell),Math.round(y/cell),Math.round(z/cell))*TWO_PI;a+=specular*Math.cos(ph)*.6;b+=specular*Math.sin(ph)*.6;a+=specular*.5;
      I*=Math.max(0,1-rc*rc);
      if(lab===LABEL.LUNG&&!inLung){inLung=true;lungAt=r;if(!eo){meanLungDepth+=r;lungHits++}I*=.02}
      if(lab===LABEL.BONE)I*=.35;
     }
    }
    prevZ=Z;prevLab=lab;
    // diffuse scattering: complex gaussian scatterers locked to position
    if(scat>0&&I>1e-7){
     const gx=Math.floor(x*icell),gy=Math.floor(y*icell),gz=Math.floor(z*icell),g=hidx(gx,gy,gz);
     // gentle tissue heterogeneity (fibres, trabeculae) at ~1.5 mm
     const fx=x*icell,fy=y*icell,fz=z*icell,mod=smoothField(HETT,fx/8,fy/8,fz/8)*smoothField(CLU,fx/4,fy/4,fz/4)*smoothField(PATCH,fx/32,fy/32,fz/32);
     const w=I*scat*mod*directivity;
     a+=w*GRE[g];b+=w*GIM[g];
    }
    // near-field clutter / reverberation haze from the chest wall (first ~2 cm)
    // (in atlas units: reverberations come from the chest wall, whose thickness scales with the patient)
    if(H){const bu=1-.3*Math.exp(-r*K/.01);a*=bu;b*=bu}
    if(r<.03){const g=hidx(j,k,31),f=.0016*(H?1:2.6)*Math.exp(-r/.009)*directivity;a+=f*GRE[g];b+=f*GIM[g]}
    re[base+k]+=a*directivity*ew;im[base+k]+=b*directivity*ew;trans[base+k]+=I*ew/EW;
    if(cv&&!eo&&j>=cj0&&j<=cj1&&k>=ck0&&k<=ck1&&I>2e-4&&color.flow.velocity(x,y,z,color.phase,vel))cv[base+k]=-(vel[0]*bx+vel[1]*by+vel[2]*bz);
    I*=stepAtt[lab];
   }
   // lung: pleural reverberations (A-lines) at multiples of the pleural depth
   if(inLung){for(let m=2;m<=4;m++){const kk=Math.round(lungAt*m/dr);if(kk<samples){const amp=.03*ew*.5**(m-1)*Math.exp(-2*alphaNp(.5)*lungAt*K*m);for(let t=-1;t<=1;t++){const idx=base+Math.min(samples-1,Math.max(0,kk+t));re[idx]+=amp*(1-Math.abs(t)*.5)}}}
    for(let k=Math.round(lungAt/dr)+2;k<samples;k++){const g=hash3(j,k,3);re[base+k]+=.0012*ew*(g-.5)*Math.exp(-(k*dr-lungAt)*K/.03)*Math.exp(-2*alphaNp(.5)*k*drp)}}
   }
   // near field: ring-down of the probe face and lens, horizontal bands in the first few millimetres (weaker in THI)
   for(let k=0;k<samples;k++){const rp=(k+.5)*drp;if(rp>.01)break;re[base+k]+=(H?.0011:.0026)*Math.exp(-rp/.0025)*(.55+.45*Math.cos(TWO_PI*rp/.0017))*directivity}
  }
  // moving leaflets and other thin reflectors, rasterised into the RF field (max, not sum: an obliquely cut sheet
  // yields many overlapping segments that must not pile up into a blob)
  if(overlays.length){
   if(!ovb||ovb.length<N)ovb=new Float32Array(N);ovb.fill(0,0,N);
   for(const ov of overlays){
    const segs=ov.segments,str=ov.strength??.02,tt=ov.t;
    for(let i=0;i<segs.length;i+=4){
     // leaflets are not uniform sheets: the body is thin and less bright, the free edge (coaptation zone, chordal
     // insertions) thicker and brighter; plus irregular brighter spots
     const tl=tt?tt[i>>2]:.5,mod=(.5+.65*hash3(i,77,3))*(.62+.75*tl*tl),thick=tl>.72;
     const x0=segs[i],y0=segs[i+1],x1=segs[i+2],y1=segs[i+3],len=Math.hypot(x1-x0,y1-y0),n=Math.max(1,Math.ceil(len/.00012));
     const tx=(x1-x0)/(len||1),ty=(y1-y0)/(len||1);
     for(let t=0;t<=n;t++){
      const x=x0+(x1-x0)*t/n,y=y0+(y1-y0)*t/n,r=Math.hypot(x,y);if(y<=0||r>=depth)continue;
      const th=Math.atan2(x,y),jf=(th+sector/2)/sector*lines-.5;if(jf<-.5||jf>lines-.5)continue;
      const j=Math.round(jf),k=Math.round(r/dr-.5);if(k<0||k>=samples)continue;
      const perp=Math.abs(tx*(y/r)-ty*(x/r)),idx=j*samples+k,amp=str*mod*(.25+.75*perp*perp)*trans[idx];
      if(amp>ovb[idx])ovb[idx]=amp;if(k+1<samples&&amp*.5>ovb[idx+1])ovb[idx+1]=amp*.5;if(k>0&&amp*.5>ovb[idx-1])ovb[idx-1]=amp*.5;
      if(thick){const h=amp*.45;if(j>0&&h>ovb[idx-samples])ovb[idx-samples]=h;if(j<lines-1&&h>ovb[idx+samples])ovb[idx+samples]=h;if(k+2<samples&&h>ovb[idx+2])ovb[idx+2]=h}
     }
    }
   }
   // partially developed speckle: fibrous leaflets are strong, fairly coherent reflectors but not smooth tubes
   for(let i=0;i<N;i++){const a=ovb[i];if(a>0){const g=hidx(i,17,3);re[i]+=a*(.55+.45*GRE[g]);im[i]+=a*.45*GIM[g]}}
  }
  // near-field reverberation: echoes from the chest wall and anterior pericardium bounce between the probe face and those
  // layers and return again at twice their depth (a faint ghost of the anterior wall inside the RV); weaker in THI
  {const lim=Math.min(samples>>1,Math.round(.03/drp)),g=H?.035:.07;
   for(let j=0;j<lines;j++){const b=j*samples;for(let k=4;k<lim;k++){const k2=2*k+1;re[b+k2]+=g*re[b+k];im[b+k2]+=g*im[b+k]}}}
  // point spread: axial (pulse length) and lateral (beam width, focused)
  const lambda=.00154/freq,sigA=Math.max(.8,(1.15*lambda)/drp),focusR=focus*depth*K;
  convolveAxial(re,lines,samples,sigA);convolveAxial(im,lines,samples,sigA);
  const dth=sector/lines,apert=.012;
  const sigL=new Float32Array(samples);for(let k=0;k<samples;k++){const r=(k+.5)*drp,w0=Math.max(.0004,lambda*focusR/apert*.55),zr=Math.PI*w0*w0/lambda*2.2,w=w0*Math.sqrt(1+((r-focusR)/zr)**2)+.00025;sigL[k]=Math.max(.35,.5*w*(H?1:1.3)/(Math.max(r,.004)*dth))}
  // steered beams are wider (effective aperture ∝ cos θ): the image blurs laterally toward the sector edges
  const steer=new Float32Array(lines);for(let j=0;j<lines;j++)steer[j]=1/Math.cos(-sector/2+sector*(j+.5)/lines);
  convolveLateral(re,lines,samples,sigL,env,steer);convolveLateral(im,lines,samples,sigL,env,steer);
  // envelope, noise, compression
  const out=new Uint8Array(N),gainDB=20*Math.log10(Math.max(.05,gain))*1.6,floorDB=-dynamicRange;
  // machine depth gain (before the user's TGC): a cardiac preset assumes ~0.32 dB/cm/MHz, not the 0.48 of solid tissue,
  // because the beam crosses mostly blood; the gain is unchanged at the heart's centre (6 cm × body scale), only the slope differs, so
  // deep walls behind the cavities are not over-compensated (a mild posterior enhancement remains, as in patients)
  const alphaSoft=.32*freq*.1151*100*(H?1.06:1),PIV=Math.exp(2*(.48-.32)*freq*.1151*100*(H?1.06:1)*.06*K),COMP=new Float32Array(samples),LUT=new Uint8Array(1024),REF=1/.025;
  for(let k=0;k<samples;k++){const r=(k+.5)*drp;COMP[k]=Math.min(1e4,Math.exp(2*alphaSoft*r)*PIV)*tgcAmplitude(tgc,r/depth)*(1+.3*Math.exp(-(((r-focusR)/(.22*depth*K))**2)))} // transmit focus: a slightly brighter focal zone
  // grey map: reject the lowest levels, then a gentle S curve (harmonic-imaging look: black cavities, crisp tissue)
  for(let i=0;i<1024;i++){const x=Math.max(0,(i/1023-.075)/.925),y=x<.5?.5*(2*x)**1.55:1-.5*(2-2*x)**1.1;LUT[i]=Math.round(255*Math.min(1,y))}
  // side lobes: a faint, wide lateral copy of the envelope (fills cavities next to bright walls with haze)
  const E=env;for(let i=0;i<N;i++)E[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i]);
  // speckle reduction (as consoles do with compounding/persistence): blend with a small local mean, about as long
  // (±0.25 mm) as it is wide (3 lines), so the grain keeps its lateral elongation instead of being smeared along the beam
  {const T=new Float32Array(N),ka=Math.max(1,Math.round(.00025/drp));for(let j=0;j<lines;j++){const b=j*samples;let acc=0,n=0;for(let k=0;k<Math.min(samples,ka);k++){acc+=E[b+k];n++}
    for(let k=0;k<samples;k++){const ad=k+ka,rm=k-ka-1;if(ad<samples){acc+=E[b+ad];n++}if(rm>=0){acc-=E[b+rm];n--}T[b+k]=acc/n}}
   for(let j=0;j<lines;j++)for(let k=0;k<samples;k++){const i=j*samples+k,l=j>0?T[i-samples]:T[i],r=j<lines-1?T[i+samples]:T[i];E[i]=.42*E[i]+.58*(l+2*T[i]+r)*.25}}
  const SL=new Float32Array(N),hw=Math.max(3,Math.round(lines*.045));
  for(let k=0;k<samples;k++){let acc=0,n=0;for(let j=0;j<Math.min(lines,hw);j++){acc+=E[j*samples+k];n++}
   for(let j=0;j<lines;j++){const add=j+hw,rem=j-hw-1;if(add<lines){acc+=E[add*samples+k];n++}if(rem>=0){acc-=E[rem*samples+k];n--}SL[j*samples+k]=acc/n}}
  for(let j=0;j<lines;j++)for(let k=0;k<samples;k++){
   const i=j*samples+k;
   // machine default: compensate soft-tissue attenuation, then user TGC; receiver noise is amplified too
   const e=(E[i]+(H?.045:.11)*SL[i]+3e-9*HET[(i*7)&(GN-1)])*COMP[k]+4e-6*HET[(i*13+5)&(GN-1)];
   const db=8.685889638*Math.log(e*REF)+gainDB,v=(db-floorDB)/dynamicRange;
   // soft knee: very strong echoes (pericardium, specular walls) approach white without clipping into flat blobs
   const vv=v>.82?.82+.18*(1-Math.exp(-(v-.82)/.18)):v;out[i]=vv<=0?0:LUT[(Math.min(.999,vv)*1023)|0];
  }
  let colorOut=null;
  if(cv){
   // spatial smoothing (the colour ensemble is coarser than B-mode), wall filter, aliasing and turbulence mosaic
   colorOut=new Int8Array(N).fill(-128);const nyq=color.nyquist||.7,thr=.11*nyq/(color.gain||1);
   for(let j=cj0;j<=cj1;j++)for(let k=ck0;k<=ck1;k++){
    let s=0,n=0,tot=0;for(let dj=-1;dj<=1;dj++){const jj=j+dj;if(jj<cj0||jj>cj1)continue;for(let dk=-3;dk<=3;dk++){const kk=k+dk;if(kk<ck0||kk>ck1)continue;tot++;const v=cv[jj*samples+kk];if(v===v){s+=v;n++}}}
    if(n<tot*.55)continue;let v=s/n;const hz=HET[(j*131+k*7)&(GN-1)];if(Math.abs(v)<thr*(.8+.4*hz)||HET[(j*17+k*29+5)&(GN-1)]<.69)continue; // wall filter with ensemble noise, sparse dropout
    let w=v/nyq+(hz-1)*.12;if(Math.abs(v)>1.45*nyq)w+=(HET[(j*97+k*13)&(GN-1)]-1)*1.6; // disturbed flow: variance → mosaic
    w=((w+1)%2+2)%2-1;colorOut[j*samples+k]=Math.max(-127,Math.min(127,Math.round(w*127)));
   }
  }
  return {lines,samples,depth,sector:pose.sector,data:out,lungLines:lungHits,color:colorOut,colorRoi:cv?{j0:cj0,j1:cj1,k0:ck0,k1:ck1}:null};
 }
 return {render};
}

function convolveAxial(a,lines,samples,sigma){
 const R=Math.ceil(sigma*2.5),w=[];let sum=0;for(let t=-R;t<=R;t++){const v=Math.exp(-t*t/(2*sigma*sigma));w.push(v);sum+=v}for(let t=0;t<w.length;t++)w[t]/=sum;
 const tmp=new Float32Array(samples);
 for(let j=0;j<lines;j++){const b=j*samples;for(let k=0;k<samples;k++){let s=0;for(let t=-R;t<=R;t++){const kk=k+t;if(kk>=0&&kk<samples)s+=a[b+kk]*w[t+R]}tmp[k]=s}a.set(tmp,b)}
}
function convolveLateral(a,lines,samples,sig,tmp,steer=null){
 const w=new Float32Array(64);
 for(let k=0;k<samples;k++){
  for(let j=0;j<lines;j++){
   // kernel per line only when steering widens it (quantised to 0.1 so neighbouring lines share weights)
   if(j===0||(steer&&Math.abs(steer[j]-steer[j-1])>1e-9&&Math.round(steer[j]*10)!==Math.round(steer[j-1]*10))){const sigma=sig[k]*(steer?Math.round(steer[j]*10)/10:1),R=Math.min(20,Math.ceil(sigma*2.2));w.R=R;for(let t=0;t<=R;t++)w[t]=Math.exp(-t*t/(2*sigma*sigma))}
   const R=w.R;let s=a[j*samples+k],ws=1;const lo=Math.max(-R,-j),hi=Math.min(R,lines-1-j);for(let t=lo;t<=hi;t++){if(!t)continue;const wt=w[t<0?-t:t];s+=a[(j+t)*samples+k]*wt;ws+=wt}tmp[j*samples+k]=s/ws}
 }
 a.set(tmp.subarray(0,lines*samples));
}

// BART colour map: toward the probe red→yellow, away blue→cyan (index = value+128)
export const COLOR_MAP=(()=>{const m=new Uint8Array(256*3);for(let i=0;i<256;i++){const w=(i-128)/127,a=Math.min(1,Math.abs(w));let r=0,g=0,b=0;
 if(w>0){r=35+220*a**.7;g=a>.65?235*((a-.65)/.35)**1.2:0}else{b=45+210*a**.7;g=a>.65?225*((a-.65)/.35)**1.1:25*a}m.set([r,g,b].map(v=>Math.round(Math.min(255,v))),i*3)}return m})();

// Scan conversion: polar image → canvas ImageData (grey), honouring presentation (ySign) and zoom.
export function scanConvert(frame,imageData,projection,ratio=1){
 const {lines,samples,depth,data}=frame,sector=frame.sector*Math.PI/180,W=imageData.width,H=imageData.height,px=imageData.data;
 const {cx,cy,scale,ySign}=projection;
 for(let py=0;py<H;py++){const y=((py+.5)/ratio-cy)/(scale*ySign);for(let pxx=0;pxx<W;pxx++){
  const i=(py*W+pxx)*4;if(y<=0){continue}
  const x=((pxx+.5)/ratio-cx)/scale,r=Math.hypot(x,y);if(r>=depth)continue;const th=Math.atan2(x,y);if(Math.abs(th)>sector/2)continue;
  const jf=(th+sector/2)/sector*lines-.5,kf=r/depth*samples-.5,j0=Math.max(0,Math.floor(jf)),k0=Math.max(0,Math.floor(kf)),j1=Math.min(lines-1,j0+1),k1=Math.min(samples-1,k0+1),fj=Math.min(1,Math.max(0,jf-j0)),fk=Math.min(1,Math.max(0,kf-k0));
  if(frame.color){const c=frame.color[Math.round(jf<0?0:jf>lines-1?lines-1:jf)*samples+Math.round(kf<0?0:kf>samples-1?samples-1:kf)];if(c!==-128){const m=COLOR_MAP,q=(c+128)*3;px[i]=m[q];px[i+1]=m[q+1];px[i+2]=m[q+2];px[i+3]=255;continue}}
  const v=(data[j0*samples+k0]*(1-fj)+data[j1*samples+k0]*fj)*(1-fk)+(data[j0*samples+k1]*(1-fj)+data[j1*samples+k1]*fj)*fk;
  // slightly warm grey map, like many consoles
  px[i]=Math.min(255,v*1.02);px[i+1]=Math.min(255,v*1.0);px[i+2]=Math.min(255,v*.95);px[i+3]=255;
 }}
}
