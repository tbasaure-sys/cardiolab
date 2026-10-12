// Shunt study: the chamber-remodelling warp and the teaching haemodynamic model (shunt-model.mjs), on the reference heart.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {referenceShapes,createRemodel} from '../remodel.mjs';
import {shuntState,variantSpec,LESIONS,PVR,AORTIC_ROOT_ATLAS_MM} from '../shunt-model.mjs';import {applyVariant} from '../chd-data.mjs';
import {buildViews} from '../views.mjs';import {PATIENT_BY_ID,PATIENTS} from '../patient.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const shapes=referenceShapes(tissue),child=PATIENT_BY_ID.child;

test('chamber ellipsoids: unit orthogonal axes, plausible radii',()=>{
 for(const k of ['RA','RV','LA','LV']){const s=shapes[k];assert.ok(s&&s.voxels>1000,k);
  for(let i=0;i<3;i++){assert.ok(Math.abs(Math.hypot(...s.axes[i])-1)<1e-6);for(let j=i+1;j<3;j++)assert.ok(Math.abs(s.axes[i].reduce((a,v,n)=>a+v*s.axes[j][n],0))<1e-6)}
  for(const r of s.radii)assert.ok(r>.01&&r<.07,`${k} ${r}`)}
});

test('the warp is reversible, does not fold, and enlarges the cavity by 1 + g',()=>{
 assert.equal(createRemodel(shapes,{}),null);const rm=createRemodel(shapes,{RV:.2,RA:.15}),s=shapes.RV;
 let worst=0,fold=0;for(let i=0;i<1500;i++){const p=s.centre.map(v=>v+(Math.sin(i*12.9898+v)*43758.5453%1)*.12-.06);const b=rm.inverse(rm.forward(p));worst=Math.max(worst,Math.hypot(...b.map((v,k)=>v-p[k])))}
 assert.ok(worst<2e-4,`${(worst*1000).toFixed(3)} mm`);
 for(let i=0;i<60;i++){const dir=[Math.cos(i),Math.sin(i*1.7),Math.cos(i*.3)],l=Math.hypot(...dir);let prev=-1;for(let r=0;r<.1;r+=.001){const f=rm.forward(s.centre.map((v,k)=>v+dir[k]/l*r)),pr=f.reduce((a,v,k)=>a+(v-s.centre[k])*dir[k]/l,0);if(pr<prev-1e-7)fold++;prev=pr}}
 assert.equal(fold,0);
 const two=createRemodel(shapes,{LA:.3,LV:.3});let worst2=0;for(let i=0;i<1500;i++){const c=shapes.LV.centre.map((v,k)=>(v+shapes.LA.centre[k])/2),p=c.map((v,k)=>v+(Math.sin(i*7.1+k*3.3)*43758.5453%1)*.1-.05);const b=two.inverse(two.forward(p));worst2=Math.max(worst2,Math.hypot(...b.map((v,k)=>v-p[k])))}
 assert.ok(worst2<3e-4,`LA+LV ${(worst2*1000).toFixed(3)} mm`);
 const ext=w=>{let n=0;for(let r=-.08;r<=.08;r+=.0005){const p=s.centre.map((v,k)=>v+s.axes[0][k]*r);if(tissue.tissueAt(...(w?rm.inverse(p):p))===LABEL.RV_BLOOD)n++}return n};
 const ratio=ext(true)/ext(false);assert.ok(ratio>1.12&&ratio<1.26,`${ratio}`);
});

test('the shunt model behaves as the cited relationships say',()=>{
 for(const lesion of Object.keys(LESIONS)){let prev=0;for(const size of [0,.2,.4,.6,.8,1]){const q=shuntState({lesion,size,patient:child}).flows.qpqs;assert.ok(q>=prev-1e-9,`${lesion} ${size}`);prev=q}assert.ok(prev>1.8,`${lesion} large Qp/Qs ${prev}`)}
 // VSD: small = restrictive (high velocity, low RV pressure); large = less restrictive (lower velocity, RV pressure up)
 const small=shuntState({lesion:'vsdpm',size:.2,patient:child}),large=shuntState({lesion:'vsdpm',size:1,patient:child});
 assert.ok(small.jet.sys>3.5&&large.jet.sys<small.jet.sys-.8);assert.ok(large.pressures.rvSys>small.pressures.rvSys+25);
 assert.ok(large.gains.LV>small.gains.LV&&large.gains.LA>.1); // LA and LV dilation imply a large VSD shunt (Spicer 2014)
 assert.ok(large.defect.rootRatio>=.5&&small.defect.rootRatio<.5);
 // pulmonary resistance: the shunt falls, the RV pressure rises; suprasystemic reverses it
 for(const lesion of ['asd2','vsdpm','pda']){const n=shuntState({lesion,size:.75,patient:child}),e=shuntState({lesion,size:.75,pvr:'elevada',patient:child}),x=shuntState({lesion,size:.75,pvr:'suprasistemica',patient:child});
  assert.ok(e.flows.qpqs<n.flows.qpqs&&e.pressures.rvSys>n.pressures.rvSys,lesion);assert.ok(x.flows.qpqs<1&&x.grade.key==='reverse',lesion)}
 // ASD: right heart overload with normal pulmonary pressure; PDA and VSD: left heart
 const asd=shuntState({lesion:'asd2',size:1,patient:child});assert.ok(asd.gains.RV>.1&&!asd.gains.LV&&asd.pressures.rvRatio<.45);
 // PDA: the LV output carries systemic flow + shunt (van Laere 2018); the proximal main PA carries the systemic flow
 const pda=shuntState({lesion:'pda',size:1,patient:child});assert.ok(Math.abs(pda.flowScale.AO-pda.flows.qpqs)<1e-9&&pda.flowScale.PA===1);
 const vsd=large;assert.equal(vsd.flowScale.AO,1);assert.ok(Math.abs(vsd.flowScale.PA-Math.sqrt(vsd.flows.qpqs))<1e-9);
 assert.deepEqual(variantSpec(shuntState({lesion:'asd2',size:0,patient:child})),{id:'normal'});
});

test('patient size scales the defect, not the physiology bands',()=>{
 const d=PATIENTS.map(patient=>shuntState({lesion:'asd2',size:.5,patient}).defect.diameterMM);for(let i=1;i<d.length;i++)assert.ok(d[i]>d[i-1]);
 for(const patient of PATIENTS)assert.ok(Math.abs(shuntState({lesion:'asd2',size:.5,patient}).flows.qpqs-shuntState({lesion:'asd2',size:.5,patient:child}).flows.qpqs)<.05);
});

test('in the simulator the overloaded chambers grow in the four-chamber plane and the other side is pushed back',()=>{
 const v=buildViews(tissue.landmarks).a4c,count=()=>{const c={};for(let a=-.09;a<=.09;a+=.002)for(let r=0;r<=v.depth;r+=.002){const p=v.origin.map((o,i)=>o+v.u[i]*a+v.d[i]*r),l=tissue.tissueAt(...(tissue.remodel?tissue.remodel.inverse(p):p));c[l]=(c[l]||0)+1}return c};
 tissue.reset();const base=count();
 applyVariant(tissue,variantSpec(shuntState({lesion:'asd2',size:1,patient:child})));const asd=count();tissue.reset();
 applyVariant(tissue,variantSpec(shuntState({lesion:'vsdpm',size:1,patient:child})));const vsd=count();tissue.reset();
 assert.ok(asd[LABEL.RV_BLOOD]>base[LABEL.RV_BLOOD]*1.2&&asd[LABEL.LV_BLOOD]<base[LABEL.LV_BLOOD]);
 assert.ok(vsd[LABEL.LV_BLOOD]>base[LABEL.LV_BLOOD]*1.3&&vsd[LABEL.LA_BLOOD]>base[LABEL.LA_BLOOD]);
 assert.equal(tissue.remodel,null);
});

test('the atlas aortic root used for the VSD ratio is the measured one',()=>{
 const lm=tissue.landmarks,a=lm.aorticValve.map((v,i)=>v-lm.lvApexCavity[i]),l=Math.hypot(...a),n=a.map(v=>v/l),c=lm.aorticValve.map((v,i)=>v+n[i]*.004);
 const e1=[n[1],-n[0],0].map(v=>v/Math.hypot(n[0],n[1])),e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];let k=0;
 for(let u=-.03;u<=.03;u+=.0005)for(let w=-.03;w<=.03;w+=.0005){const L=tissue.tissueAt(...c.map((x,i)=>x+e1[i]*u+e2[i]*w));if(L===LABEL.AO_BLOOD||L===LABEL.AORTIC_VALVE)k++}
 assert.ok(Math.abs(2*Math.sqrt(k*.25/Math.PI)-AORTIC_ROOT_ATLAS_MM)<1.5);
});
