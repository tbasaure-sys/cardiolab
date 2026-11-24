// Breathing (breath.mjs): the heart and great vessels shift together under a still probe; the warp is the identity in
// apnoea, invertible while breathing, and leaves the chest wall where it is.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {createBreath,breathAt,breathOfFrame,BREATH_SHIFT,BREATH_BEATS,MARGIN} from '../breath.mjs';import {FIT_DATA} from '../thorax-fit-data.mjs';
import {createFit,envelopeRadius} from '../thorax-fit.mjs';import {surface,setBodyFit} from '../geometry.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,C=lm.heartCenter,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const rnd=(()=>{let s=11;return ()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff}})();

test('the breath: out at 0, deepest at 40 % of the cycle, back to 0; one breath every four beats',()=>{
 assert.equal(breathAt(0),0);assert.ok(Math.abs(breathAt(.4)-1)<1e-12);assert.ok(breathAt(.999)<.01);assert.ok(breathAt(.2)>.4&&breathAt(.2)<.6);
 for(let t=0;t<.39;t+=.01)assert.ok(breathAt(t+.01)>breathAt(t));for(let t=.41;t<.98;t+=.01)assert.ok(breathAt(t+.01)<breathAt(t));
 assert.equal(BREATH_BEATS,4);assert.equal(breathOfFrame(0,0),0);assert.ok(Math.abs(breathOfFrame(1,.6)-1)<1e-9,'deepest in the second beat');
});
test('apnoea is the identity; breathing moves the whole heart by the same shift and nothing beyond the margin',()=>{
 tissue.setFit(createFit(.826));const b=createBreath(tissue);for(const k of ['lvApex','aorticValve','archTop','ductAortic'])assert.deepEqual(b.forward(lm[k]),lm[k]);
 b.r=1;for(const k of ['lvApex','aorticValve','mitralValve','tricuspidValve','pulmonaryValve','asdSecundum']){const q=b.forward(lm[k]);assert.ok(dist(q,lm[k].map((v,i)=>v+BREATH_SHIFT[i]))<1e-4,k)}
 // heart voxels: all shifted alike (rigid), so nothing inside the heart deforms
 const d=tissue.fine.data,[nx,ny,nz]=tissue.fine.dims,h=tissue.fh,o=tissue.fo;let n=0,off=0;
 for(let k=0;k<nz;k+=4)for(let j=0;j<ny;j+=4)for(let i=0;i<nx;i+=4){const idx=((k*ny+j)*nx+i)*2;if(d[idx+1]!==0||d[idx]<10||d[idx]>23)continue;n++;const p=[o[0]+i*h,o[1]+j*h,o[2]+k*h],q=b.forward(p);if(dist(q,p.map((v,a)=>v+BREATH_SHIFT[a]))>2e-4)off++}
 assert.ok(n>8000&&off===0,`${off} of ${n} voxels of the chambers and their walls are not carried rigidly`);
 // the skin under the probe hardly moves (the margin reaches it where the heart lies against the wall: about a millimetre at most)
 for(const age of [.826,1]){setBodyFit(age);tissue.setFit(createFit(age));for(const [x,z] of [[.02,.03],[.07,-.05],[-.02,-.09],[-.02,.12],[.004,.012]]){const s=surface(x,z),m=dist(b.forward(s),s);assert.ok(m<.0012,`skin at ${x}, ${z} (fit ${age}) moves ${(m*1000).toFixed(2)} mm`)}}setBodyFit(null);
 const far=[C[0]+.14,C[1],C[2]];assert.deepEqual(b.forward(far),far);tissue.setFit(null);
});
test('the warp is invertible at every depth of inspiration, with and without the thorax fit, and never folds',()=>{
 for(const age of [null,1,.826]){tissue.setFit(age==null?null:createFit(age));const b=createBreath(tissue);
  for(const r of [.3,.7,1]){b.r=r;let worst=0;for(let i=0;i<500;i++){const p=[C[0]+(rnd()-.5)*.3,C[1]+(rnd()-.5)*.26,C[2]+(rnd()-.5)*.34];worst=Math.max(worst,dist(b.inverse(b.forward(p)),p))}
   assert.ok(worst<5e-5,`fit ${age}, r ${r}: worst round trip ${(worst*1000).toFixed(3)} mm`)}
  // monotone along lines through the margin (below the heart, in front of it, to the left)
  b.r=1;for(const dir of [[0,0,-1],[0,-1,0],[1,0,0],[.6,-.6,-.5]]){const l=Math.hypot(...dir),u=dir.map(v=>v/l);let prev=-1;for(let t=.02;t<.14;t+=.0005){const p=C.map((v,i)=>v+u[i]*t),q=b.forward(p),s=(q[0]-C[0])*u[0]+(q[1]-C[1])*u[1]+(q[2]-C[2])*u[2];assert.ok(s>prev,`fit ${age}: order kept along ${dir}`);prev=s}}}
 const cmin=Math.min(...FIT_DATA.capPermil)/1000*.826;assert.ok(Math.hypot(...BREATH_SHIFT)*1.5/(MARGIN*cmin)<1,'the shift changes slowly enough across the compressed margin');
 tissue.setFit(null);
});
test('in the tissue chain: lesion, thorax fit and breath compose; consumers see one warp',()=>{
 tissue.setFit(createFit(.826));const b=createBreath(tissue);tissue.setBreath(b);const w=tissue.remodel;
 b.r=0;const p=[C[0]+.05,C[1]-.04,C[2]-.07];assert.ok(dist(w.forward(p),tissue.fit.forward(p))<1e-12,'apnoea: only the fit');
 b.r=1;for(let i=0;i<200;i++){const q=[C[0]+(rnd()-.5)*.3,C[1]+(rnd()-.5)*.24,C[2]+(rnd()-.5)*.3];assert.ok(dist(w.inverse(w.forward(q)),q)<2e-5)}
 // the tissue the beam finds at the apex in inspiration is what was BREATH_SHIFT above it in expiration
 const a=lm.lvApexCavity;assert.equal(tissue.tissueAt(...w.inverse(a.map((v,i)=>v+BREATH_SHIFT[i]))),LABEL.LV_BLOOD);
 tissue.setBreath(null);tissue.setFit(null);assert.equal(tissue.remodel,null);
});
