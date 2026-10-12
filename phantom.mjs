// Resolution phantom for the physics chapters: a block of tissue-mimicking material (myocardium-like scattering,
// 0.55 dB/cm/MHz) with nylon-like wires running across the slice and anechoic cysts, like a quality-control phantom.
// The B-mode renderer scans it exactly as it scans the heart (same beam, pulse, attenuation and processing), so the
// widths measured here are those of the simulator's own point-spread function. Physical metres; probe at the origin,
// beam along +y, lateral +x, slice normal +z. Worker-safe, no DOM.
import {LABEL} from './tissue.mjs';

const mm=v=>v/1000;
// targets: wires (point targets in the image plane, running across the slice) and cysts (cylinders across the slice)
export const PHANTOM={
 depth:mm(120),sector:50,
 column:[10,20,30,40,50,60,70,80,90,100,110].map(d=>({x:0,y:mm(d)})), // depth ruler, one wire per centimetre
 // axial pairs (one above the other) and lateral pairs (side by side), separation in mm, at 5 and 9 cm
 axial:[[2,-9],[1,-14],[.5,-19]].flatMap(([s,x])=>[50,90].map(d=>({sep:s,depth:d,a:{x:mm(x),y:mm(d)},b:{x:mm(x),y:mm(d+s)}}))),
 lateral:[[3,7],[2,13],[1,18]].flatMap(([s,x])=>[50,90].map(d=>({sep:s,depth:d,a:{x:mm(x),y:mm(d)},b:{x:mm(x+s),y:mm(d)}}))),
 cysts:[[2,-14],[4,-7],[6,8]].map(([dia,x])=>({dia,x:mm(x),y:mm(70),r:mm(dia/2)}))
};
export const WIRES=[...PHANTOM.column,...PHANTOM.axial.flatMap(p=>[p.a,p.b]),...PHANTOM.lateral.flatMap(p=>[p.a,p.b])];
// tissue interface used by bmode.render (lookup/tissueAt/lastDistance): background and cysts; lastDistance far from any
// «heart» so the renderer adds no organic boundary warp
export function createPhantom(){
 const cy=PHANTOM.cysts;
 const at=(x,y)=>{if(y<-.002)return LABEL.AIR;for(const c of cy){const dx=x-c.x,dy=y-c.y;if(dx*dx+dy*dy<c.r*c.r)return LABEL.LV_BLOOD}return LABEL.LV_MYO};
 return {lastDistance:1,phantom:true,tissueAt:(x,y)=>at(x,y),lookup(x,y){this.lastDistance=1;return at(x,y)}};
}
// the wires as ideal point reflectors written into the echo field before the pulse and beam blur it (bmode overlays):
// what the image shows of them is the simulator's point-spread function. Tiny segments across the beam.
export function wireOverlay(strength=.35){const seg=[];for(const w of WIRES){const r=Math.hypot(w.x,w.y),ux=w.y/r,uy=-w.x/r,e=2e-5;seg.push(w.x-ux*e,w.y-uy*e,w.x+ux*e,w.y+uy*e)}
 return {segments:new Float32Array(seg),points:true,strength}}
export const PHANTOM_POSE={origin:[0,0,0],u:[1,0,0],d:[0,1,0],n:[0,0,1],depth:PHANTOM.depth,sector:PHANTOM.sector};

// ---------------------------------------------------------------- measurements on a rendered (polar) frame
// polar position of a physical point: line j and sample k (fractional)
function polar(frame,x,y){const sec=frame.sector*Math.PI/180,th=Math.atan2(x,y),r=Math.hypot(x,y);return {j:(th+sec/2)/sec*frame.lines-.5,k:r/frame.depth*frame.samples-.5,r,th}}
const sampleOf=(arr,f,j,k)=>{j=Math.round(j);k=Math.round(k);if(j<0||k<0||j>=f.lines||k>=f.samples)return 0;return arr[j*f.samples+k]};
const greyAt=(f,j,k)=>sampleOf(f.data,f,j,k);
// resolution of a wire: width of its echo at −6 dB (half the peak amplitude of the linear envelope) along the beam
// (axial) and across it (lateral), in mm; null when the echo does not stand out of the speckle (< 12 dB)
export function spotWidth(frame,p){
 const env=frame.envelope;if(!env)throw Error('spotWidth necesita la envolvente (render con envelope:true)');
 const {j,k,r}=polar(frame,p.x,p.y),dr=frame.depth/frame.samples*1000,dth=frame.sector*Math.PI/180/frame.lines;
 // the strongest sample near the target (the pulse peak may sit a fraction of a millimetre off)
 let bj=Math.round(j),bk=Math.round(k),best=-1;const wj=Math.max(1,Math.round(.0012/(r*dth))),wk=Math.round(.5/dr);
 for(let a=-wj;a<=wj;a++)for(let b=-wk;b<=wk;b++){const v=sampleOf(env,frame,j+a,k+b);if(v>best){best=v;bj=Math.round(j+a);bk=Math.round(k+b)}}
 const LW=Math.max(4,Math.round(.0045/(r*dth))),AW=Math.round(2.5/dr),lat=[],ax=[];
 for(let a=-LW;a<=LW;a++)lat.push(sampleOf(env,frame,bj+a,bk));for(let b=-AW;b<=AW;b++)ax.push(sampleOf(env,frame,bj,bk+b));
 const width=prof=>{const n=prof.length,c=(n-1)/2,pk=prof[c],ends=[...prof.slice(0,2),...prof.slice(-2)].sort((x,y)=>x-y),bg=ends[1];
  if(!(pk>0)||pk<4*bg)return null;const h=pk/2;let lo=c,hi=c;while(lo>0&&prof[lo-1]>=h)lo--;while(hi<n-1&&prof[hi+1]>=h)hi++;
  const fl=lo>0?(prof[lo]-h)/Math.max(1e-12,prof[lo]-prof[lo-1]):0,fh=hi<n-1?(prof[hi]-h)/Math.max(1e-12,prof[hi]-prof[hi+1]):0;return hi-lo+fl+fh};
 const wl=width(lat),wa=width(ax);
 return {lateral:wl==null?null:wl*dth*r*1000,axial:wa==null?null:wa*dr};
}
// two wires: resolved when the echo between them dips at least 3 dB below the weaker of the two
export function pairResolved(frame,pair){
 const env=frame.envelope||frame.data,A=polar(frame,pair.a.x,pair.a.y),B=polar(frame,pair.b.x,pair.b.y),n=32;let pa=0,pb=0,mid=Infinity;
 for(let i=0;i<=n;i++){const t=i/n,v=sampleOf(env,frame,A.j+(B.j-A.j)*t,A.k+(B.k-A.k)*t);if(t<=.15)pa=Math.max(pa,v);else if(t>=.85)pb=Math.max(pb,v);else mid=Math.min(mid,v)}
 const pk=Math.min(pa,pb);return {resolved:pk>0&&mid<pk*.71,dip:pk?Math.max(0,1-mid/pk):0}
}
// cyst contrast: mean grey inside vs the ring around it (0 = invisible, 1 = black hole in bright tissue)
export function cystContrast(frame,c){
 const at=(th,f)=>{const P=polar(frame,c.x+Math.cos(th)*c.r*f,c.y+Math.sin(th)*c.r*f);return greyAt(frame,P.j,P.k)};
 let si=0,ni=0,so=0,no=0;for(let a=0;a<48;a++){const th=a/48*Math.PI*2;for(const f of [.15,.35,.55]){si+=at(th,f);ni++}
  for(const f of [1.6,2]){so+=at(th,f);no++}}
 const inn=si/ni,out=so/no;return out<4?0:Math.max(0,Math.min(1,1-inn/out));
}
// mean grey along depth (for penetration): bands of `band` m over the central lines
export function depthProfile(frame,band=.005,lines=.5){
 const nb=Math.floor(frame.depth/band),out=[],j0=Math.floor(frame.lines*(1-lines)/2),j1=Math.ceil(frame.lines*(1+lines)/2);
 for(let b=0;b<nb;b++){const k0=Math.floor(b*band/frame.depth*frame.samples),k1=Math.floor((b+1)*band/frame.depth*frame.samples);let s=0,n=0;for(let j=j0;j<j1;j++)for(let k=k0;k<k1;k++){s+=frame.data[j*frame.samples+k];n++}out.push({depth:(b+.5)*band,grey:n?s/n:0})}
 return out;
}
// penetration: tissue speckle is fixed while the receiver noise changes from frame to frame, so the correlation of two
// frames (different noise seeds) per depth band is ≈1 where echoes dominate and falls toward 0 where noise does
export function penetration(fa,fb,band=.005,lines=.6){
 const nb=Math.floor(fa.depth/band),j0=Math.floor(fa.lines*(1-lines)/2),j1=Math.ceil(fa.lines*(1+lines)/2),bands=[];
 for(let b=0;b<nb;b++){const k0=Math.floor(b*band/fa.depth*fa.samples),k1=Math.floor((b+1)*band/fa.depth*fa.samples);let sa=0,sb=0,saa=0,sbb=0,sab=0,n=0;
  for(let j=j0;j<j1;j++)for(let k=k0;k<k1;k++){const i=j*fa.samples+k,x=fa.data[i],y=fb.data[i];sa+=x;sb+=y;saa+=x*x;sbb+=y*y;sab+=x*y;n++}
  const ma=sa/n,mb=sb/n,va=saa/n-ma*ma,vb=sbb/n-mb*mb,c=va>1&&vb>1?(sab/n-ma*mb)/Math.sqrt(va*vb):(ma<3&&mb<3?0:1);bands.push({depth:(b+.5)*band,corr:c,grey:(ma+mb)/2})}
 // useful depth: the end of the last run of bands that are mostly echo (corr ≥ 0.5) starting from the surface
 let limit=0;for(const b of bands){if(b.corr>=.5)limit=b.depth+band/2;else if(b.depth>limit+2*band)break}
 return {bands,limit};
}
