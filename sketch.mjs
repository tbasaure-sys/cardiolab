// «Lámina»: the anatomical cut drawn like a textbook pencil illustration — paper, ink outlines of the walls with
// hatching, open cavities, valve leaflets as ink strokes and handwritten labels with leader lines. A first-exposure
// view, before the echo image: what the plane cuts, named, without the acoustics.
// Walls and cavities come from the tissue volume (engine.probe, reference anatomy); labels from the atlas mesh cuts.
import {LABEL} from './tissue.mjs';

const WALL=new Set([LABEL.LV_MYO,LABEL.RV_MYO,LABEL.LA_WALL,LABEL.RA_WALL,LABEL.FOSSA,LABEL.PAPILLARY,LABEL.VESSEL_WALL]);
const LIVER=LABEL.LIVER,BONE=LABEL.BONE;
const INK='#34322d',PAPER='#ebe9e2';
// labels: chambers and great vessels only (valves, coronaries and papillary muscles would crowd the sheet)
const SKIP=/Valva|coronaria|circunfleja|interventricular anterior|Seno coronario|Músculo papilar|Bifurcación/;

export function createSketch(){
 let grid=null,key='',pending=null;
 // tissue classes on a regular grid over the sector (plane coordinates, atlas units)
 async function load(engine,pose,k){
  const n=180,half=pose.sector*Math.PI/360,xmax=pose.depth*Math.sin(half),step=pose.depth/n,nx=Math.ceil(2*xmax/step)+1,ny=n+1,points=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=-xmax+i*step,y=j*step;points.push([0,1,2].map(a=>pose.origin[a]+pose.u[a]*x+pose.d[a]*y))}
  const labels=await engine.probe(points),cls=new Uint8Array(nx*ny);
  for(let i=0;i<labels.length;i++){const l=labels[i];cls[i]=WALL.has(l)?2:l===LIVER?3:l===BONE?4:0}
  // septa: wall with LV blood on one side and RV (or LA/RA) blood on the other within 7 mm
  return {k,nx,ny,step,xmax,cls,labels}
 }
 function request(engine,pose,variantKey,redraw){const k=JSON.stringify([pose.origin,pose.u,pose.d,pose.depth,pose.sector,variantKey]);
  if(k===key||pending===k)return;pending=k;load(engine,pose,k).then(g=>{if(pending!==k)return;pending=null;grid=g;key=k;redraw()}).catch(()=>{pending=null})}
 // marching squares on the smoothed wall mask → ink segments (plane coordinates)
 function contours(g){const {nx,ny,cls}=g,f=new Float32Array(nx*ny),out=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){let s=0,c=0;for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++){const I=i+a,J=j+b;if(I<0||J<0||I>=nx||J>=ny)continue;s+=cls[J*nx+I]===2?1:0;c++}f[j*nx+i]=s/c}
  const P=(i,j)=>[-g.xmax+i*g.step,j*g.step],lerp=(a,b,va,vb)=>{const t=(.5-va)/(vb-va||1e-6);return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]};
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const v=[f[j*nx+i],f[j*nx+i+1],f[(j+1)*nx+i+1],f[(j+1)*nx+i]],c=[P(i,j),P(i+1,j),P(i+1,j+1),P(i,j+1)];
   const e=[];for(let k=0;k<4;k++){const a=v[k],b=v[(k+1)%4];if((a>=.5)!==(b>=.5))e.push(lerp(c[k],c[(k+1)%4],a,b))}
   if(e.length===2)out.push(e[0][0],e[0][1],e[1][0],e[1][1]);else if(e.length===4)out.push(e[0][0],e[0][1],e[1][0],e[1][1],e[2][0],e[2][1],e[3][0],e[3][1])}
  return out}
 let inkCache=null;
 function draw(ctx,{w,h,projection,pose,cuts,byId,leaflets,engine,variantKey,redraw}){
  const {cx,cy,scale,ySign}=projection,half=pose.sector*Math.PI/360,toS=(x,y)=>[cx+x*scale,cy+ySign*y*scale];
  request(engine,pose,variantKey,redraw);
  // paper with a faint grain
  ctx.fillStyle=PAPER;ctx.fillRect(0,0,w,h);
  ctx.save();ctx.globalAlpha=.05;for(let i=0;i<900;i++){const x=(i*97.31%1)*w,y=(i*57.17%1)*h;ctx.fillStyle=i%2?'#000':'#fff';ctx.fillRect((x*13.7)%w,(y*7.3)%h,1,1)}ctx.restore();
  // the probe drawn at the apex of the sector, as on a teaching sheet
  ctx.save();ctx.strokeStyle=INK;ctx.lineWidth=1.3;ctx.lineJoin='round';const pw=26,ph=40,py=ySign===1?cy-6:cy+6,dir=-ySign;
  ctx.beginPath();ctx.moveTo(cx-pw/2,py);ctx.lineTo(cx-pw/2,py+dir*ph*.8);ctx.quadraticCurveTo(cx-pw/2,py+dir*ph,cx-pw/4,py+dir*ph);ctx.lineTo(cx+pw/4,py+dir*ph);ctx.quadraticCurveTo(cx+pw/2,py+dir*ph,cx+pw/2,py+dir*ph*.8);ctx.lineTo(cx+pw/2,py);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-pw/2+4,py+dir*3);ctx.lineTo(cx+pw/2-4,py+dir*3);ctx.stroke();ctx.restore();
  // the sector as a light pencil outline
  const sector=new Path2D(),a0=ySign*Math.PI/2-half,a1=ySign*Math.PI/2+half;sector.moveTo(cx,cy);sector.arc(cx,cy,pose.depth*scale,a0,a1);sector.closePath();
  ctx.save();ctx.setLineDash([3,4]);ctx.strokeStyle='#9a978e';ctx.lineWidth=.8;ctx.stroke(sector);ctx.restore();
  ctx.save();ctx.clip(sector);
  const g=grid&&grid.k===key?grid:null;
  if(g){
   // hatched walls (diagonal pencil lines inside the wall mask) and stippled liver/bone
   if(!inkCache||inkCache.g!==g)inkCache={g,lines:contours(g)};
   const mask=document.createElement('canvas');mask.width=g.nx;mask.height=g.ny;const mc=mask.getContext('2d'),img=mc.createImageData(g.nx,g.ny);
   for(let i=0;i<g.cls.length;i++){const c=g.cls[i];img.data[i*4+3]=c===2?255:c===3?90:c===4?150:0}mc.putImageData(img,0,0);
   const tmp=document.createElement('canvas');tmp.width=ctx.canvas.width;tmp.height=ctx.canvas.height;const tc=tmp.getContext('2d'),ratio=ctx.canvas.width/w;
   tc.setTransform(ratio*scale,0,0,ratio*scale*ySign,ratio*cx,ratio*cy);tc.imageSmoothingEnabled=true;tc.drawImage(mask,-g.xmax-g.step/2,-g.step/2,g.nx*g.step,g.ny*g.step);
   tc.setTransform(1,0,0,1,0,0);tc.globalCompositeOperation='source-in';tc.strokeStyle='#5d5a52';tc.lineWidth=ratio*.75;tc.beginPath();
   for(let d=-tmp.height;d<tmp.width;d+=ratio*4.2){tc.moveTo(d,0);tc.lineTo(d+tmp.height,tmp.height)}tc.stroke();
   ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=.55;ctx.drawImage(tmp,0,0);ctx.restore();
   // ink outlines, twice with a slight offset (pencil)
   const L=inkCache.lines;for(const [off,alpha,lw] of [[0,.95,1.25],[.45,.35,.8]]){ctx.strokeStyle=INK;ctx.globalAlpha=alpha;ctx.lineWidth=lw;ctx.beginPath();
    for(let i=0;i<L.length;i+=4){const [x0,y0]=toS(L[i],L[i+1]),[x1,y1]=toS(L[i+2],L[i+3]);ctx.moveTo(x0+off,y0+off);ctx.lineTo(x1+off,y1+off)}ctx.stroke()}
   ctx.globalAlpha=1;
  }else{
   // until the tissue arrives: the atlas outlines in ink
   ctx.strokeStyle=INK;ctx.lineWidth=1;ctx.beginPath();for(const cut of cuts){const a=cut.segments;for(let i=0;i<a.length;i+=4){const [x0,y0]=toS(a[i],a[i+1]),[x1,y1]=toS(a[i+2],a[i+3]);ctx.moveTo(x0,y0);ctx.lineTo(x1,y1)}}ctx.stroke()}
  // valve leaflets: firm ink strokes
  if(leaflets){ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.lineCap='round';ctx.beginPath();for(const l of leaflets){const a=l.segments;for(let i=0;i<a.length;i+=4){const [x0,y0]=toS(a[i],a[i+1]),[x1,y1]=toS(a[i+2],a[i+3]);ctx.moveTo(x0,y0);ctx.lineTo(x1,y1)}}ctx.stroke()}
  ctx.restore();
  // handwritten labels at the margins with leader lines to each structure (chambers and great vessels)
  const anchors=[];for(const cut of cuts){const m=byId.get(cut.id);if(!m||m.kind!=='heart'||SKIP.test(m.name))continue;let sx=0,sy=0,n=0;const a=cut.segments;for(let i=0;i<a.length;i+=2){sx+=a[i];sy+=a[i+1];n++}if(n<12)continue;
   const x=sx/n,y=sy/n;if(y<=0||Math.hypot(x,y)>pose.depth*.98||Math.abs(Math.atan2(x,y))>half)continue;anchors.push({name:shortName(m.name),x,y})}
  const font="italic 12px 'Segoe Print','Bradley Hand','Comic Sans MS',cursive";ctx.font=font;
  for(const side of [-1,1]){const list=anchors.filter(a=>Math.sign(a.x||1e-9)===side).map(a=>({...a,s:toS(a.x,a.y)})).sort((p,q)=>p.s[1]-q.s[1]);let last=-1e9;
   const edgeX=side<0?Math.max(8,cx-pose.depth*scale*Math.sin(half)-6):Math.min(w-8,cx+pose.depth*scale*Math.sin(half)+6);
   // in the margin beside the sector when it fits, otherwise as far out as the panel allows (never off the canvas)
   for(const a of list){const ty=Math.min(h-8,Math.max(a.s[1],last+16));last=ty;const tw=ctx.measureText(a.name).width,tx=side<0?Math.max(6,Math.min(edgeX-tw,a.s[0]-40-tw)):Math.min(w-6-tw,Math.max(edgeX,a.s[0]+40));
    ctx.strokeStyle='#4a473f';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(side<0?tx+tw+3:tx-3,ty-4);ctx.lineTo(a.s[0],a.s[1]);ctx.stroke();
    ctx.fillStyle=INK;ctx.beginPath();ctx.arc(a.s[0],a.s[1],1.8,0,Math.PI*2);ctx.fill();ctx.textAlign='left';ctx.fillText(a.name,tx,ty)}}
 }
 return {draw,get ready(){return !!grid}};
}
function shortName(n){return n.replace('Vena cava inferior · porción torácica','Vena cava inferior').replace(/Vena pulmonar (superior|inferior) (derecha|izquierda)/,'Vena pulmonar')}
