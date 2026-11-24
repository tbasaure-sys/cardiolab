// M-mode (mmode.mjs): the strip is the simulated scan line through the beat; the cavity it crosses is the exact answer
// for the minor-axis measurements and the shortening fraction.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL,HeartMotion,ventricularContraction} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {createBMode} from '../bmode.mjs';import {buildValves} from '../valves.mjs';
import {renderMMode,linePose,cavityTrack,shorteningFraction} from '../mmode.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),motion=new HeartMotion(lm);
const stub={positions:new Float32Array([0,0,0])},valves=buildValves({'Ascending aorta':stub,'Pulmonary trunk':stub},lm),engine=createBMode();
const poseOf=t=>({origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:t.sector||80}),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const pm=poseOf(views.psaxPM);

test('the M-line stays in the image plane and turns by the cursor angle',()=>{
 for(const th of [-30,0,20]){const lp=linePose(pm,th);assert.ok(Math.abs(Math.hypot(...lp.d)-1)<1e-9&&Math.abs(Math.hypot(...lp.u)-1)<1e-9);assert.ok(Math.abs(dot(lp.d,lp.u))<1e-9);assert.ok(Math.abs(dot(lp.d,pm.n))<1e-9,'in plane');
  assert.ok(Math.abs(Math.acos(Math.min(1,dot(lp.d,pm.d)))*180/Math.PI-Math.abs(th))<1e-6);assert.equal(lp.depth,pm.depth);assert.ok(lp.sector<pm.sector/10)}
 assert.ok(dot(linePose(pm,20).d,pm.u)>0,'positive angle goes toward the marker');
});
test('short axis at the papillary muscles: the cavity is largest at end-diastole, smallest at end-systole, FS in a normal range',()=>{
 const c=cavityTrack(tissue,motion,linePose(pm,0));
 assert.ok(c.diastole.length>.03&&c.diastole.length<.06,`LVIDd ${(c.diastole.length*1000).toFixed(1)} mm (atlas adult)`);
 assert.ok(c.systole.length>.012&&c.systole.length<c.diastole.length);assert.ok(c.fs>.25&&c.fs<.5,`FS ${c.fs.toFixed(2)}`);
 // end-systole is where the contraction of the model peaks; end-diastole where it is zero
 assert.ok(ventricularContraction(c.systole.phase)>.9,`systole at ${c.systole.phase}`);assert.ok(ventricularContraction(c.diastole.phase)<.1,`diastole at ${c.diastole.phase}`);
 assert.ok(c.diastole.near<c.diastole.far&&c.systole.near>=c.diastole.near-1e-9&&c.systole.far<=c.diastole.far+1e-9,'the walls move inward');
});
test('the strip is the scan line through the beat: dark cavity between bright walls, and the walls move',()=>{
 const m=renderMMode(engine,tissue,valves,motion,{pose:pm,theta:0,cols:96,freq:4,bodyScale:1});
 assert.equal(m.data.length,m.cols*m.samples);assert.equal(m.depth,pm.depth);
 const col=ph=>Math.min(m.cols-1,Math.floor(ph*m.cols)),K=r=>Math.round(r/m.depth*m.samples),mean=(c,k0,k1)=>{let s=0;for(let k=k0;k<k1;k++)s+=m.data[c*m.samples+k];return s/Math.max(1,k1-k0)};
 const d=m.cavity.diastole,s=m.cavity.systole,cd=col(d.phase),cs=col(s.phase);
 const cavity=mean(cd,K(d.near+.006),K(d.far-.006)),wall=mean(cd,K(d.far+.002),K(d.far+.008));
 assert.ok(wall>cavity+25,`posterior wall ${wall.toFixed(0)} vs cavity ${cavity.toFixed(0)}`);
 // where the cavity was in diastole next to the posterior wall there is myocardium in systole
 const k0=K(s.far+.001),k1=K(d.far-.001);assert.ok(k1>k0+3,'the posterior wall moved by more than a millimetre');
 assert.ok(mean(cs,k0,k1)>mean(cd,k0,k1)+15,`systole ${mean(cs,k0,k1).toFixed(0)} vs diastole ${mean(cd,k0,k1).toFixed(0)}`);
 assert.ok(Math.abs(m.cavity.fs-cavityTrack(tissue,motion,linePose(pm,0)).fs)<.03);
});
test('a line that leaves the ventricle gives no shortening fraction to trust; FS from two diameters',()=>{
 assert.equal(shorteningFraction(40,26),.35);assert.equal(shorteningFraction(0,0),null);assert.equal(shorteningFraction(30,35),null);
 const off=cavityTrack(tissue,motion,linePose(pm,38));assert.ok(off.diastole.length<cavityTrack(tissue,motion,linePose(pm,0)).diastole.length);
});
