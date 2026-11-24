// Envelope trace of the spectral Doppler (VTI, gradients) and the calculation sheet (calc.mjs).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL,HeartMotion,ventricularContraction} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {buildFlow,lesionJets} from '../flow.mjs';import {renderSpectrum,traceVTI,spectralEnvelope} from '../spectral.mjs';
import {shuntState,variantSpec} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';import {applyVariant} from '../chd-data.mjs';
import {bernoulli,rvspFromTR,rvspFromVSD,shortening,strokeVolume,cardiacOutput,cardiacIndex,qpqs,SHEET} from '../calc.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),motion=new HeartMotion(lm),flow=buildFlow(tissue);
const unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
function specAt(view,pt,extra){const t=views[view],pose={origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:80},q=pt.map((v,i)=>v-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2];return {pose,theta:Math.atan2(x,y)*180/Math.PI,gateDepth:Math.hypot(x,y),freq:3.5,bodyScale:1,...extra}}
const lvot=lm.aorticValve.map((v,i)=>v+unit(lm.lvApexCavity.map((x,j)=>x-lm.aorticValve[j]))[i]*.006),HR=70;
const normal=()=>{tissue.reset();flow.jets=[];flow.scale=null};
const lvotSpec=o=>renderSpectrum(tissue,flow,motion,specAt('a5c',lvot,{mode:'pw',scale:1.5,baseline:.8,...o}));

test('LVOT from the apex: the trace follows the ejection away from the probe and its VTI is the flow\'s, within the envelope\'s margin',()=>{
 normal();const sp=lvotSpec({}),t=traceVTI(sp,HR);assert.equal(t.side,-1);assert.ok(!t.clipped&&!t.noise);
 assert.ok(Math.abs(t.vMax-Math.abs(sp.vPeak))/Math.abs(sp.vPeak)<.25,`${t.vMax} vs ${sp.vPeak}`);
 // what the flow field itself gives at the gate along the beam (the gate stays, the heart moves under it)
 const s=specAt('a5c',lvot,{}),th=s.theta*Math.PI/180,b=s.pose.d.map((v,i)=>Math.cos(th)*v+Math.sin(th)*s.pose.u[i]),v=[0,0,0],q=[0,0,0];let sum=0;const n=400;
 for(let i=0;i<n;i++){const ph=(i+.5)/n,c=ventricularContraction(ph);let p=lvot;if(c){motion.inverse(lvot,c,q,1);p=q}if(flow.velocity(p[0],p[1],p[2],ph,v)){const vr=-(v[0]*b[0]+v[1]*b[1]+v[2]*b[2]);if(vr<0)sum-=vr}}
 const truth=sum/n*60/HR;assert.ok(t.vti>truth*.9&&t.vti<truth*1.45,`VTI ${(t.vti*100).toFixed(1)} cm vs flow ${(truth*100).toFixed(1)} cm`);
 assert.ok(t.duration>.05&&t.duration<.4*60/HR);assert.ok(Math.abs(t.vMean-t.vti/t.duration)<1e-9);assert.ok(t.meanGradient<t.peakGradient);
});
test('the trace follows the display, so the settings matter: gain, scale and aliasing',()=>{
 normal();const ok=traceVTI(lvotSpec({}),HR),low=traceVTI(lvotSpec({gain:.3}),HR),high=traceVTI(lvotSpec({gain:2.5}),HR);
 assert.ok(low.vti<ok.vti*.85,`low gain under-traces: ${low.vti} vs ${ok.vti}`);assert.ok(high.noise,'high gain: the noise floor is traced');
 // the positive flow after ejection does not fit above a baseline at 80 %: it wraps to the far edge and is not traced as ejection
 assert.equal(ok.wrapped,true);assert.ok(ok.vMax<1.4);
 const small=traceVTI(lvotSpec({scale:.5,baseline:.5}),HR);assert.ok(small.clipped||small.wrapped,'scale below the velocity');assert.ok(small.vti<ok.vti*.5);
});
test('CW through a restrictive VSD: peak gradient of the jet, mean gradient lower, only systole traced',()=>{
 const st=shuntState({lesion:'vsdpm',size:.5,patient:PATIENT_BY_ID.child}),spec=variantSpec(st);tissue.reset();applyVariant(tissue,spec);flow.jets=lesionJets(tissue,spec);flow.scale=spec.params.hemo.flowScale;
 const sp=renderSpectrum(tissue,flow,motion,specAt('plax',lm.vsdPerimembranous,{mode:'cw',scale:5,baseline:.15,bodyScale:st.patient.k})),t=traceVTI(sp,95);
 assert.equal(t.side,1);assert.ok(Math.abs(t.vMax-st.jet.sys)/st.jet.sys<.15,`${t.vMax} vs ${st.jet.sys}`);assert.ok(t.meanGradient>.3*t.peakGradient&&t.meanGradient<.75*t.peakGradient);
 assert.ok(t.duration<.5*60/95,'the diastolic floor is not part of the lobe');assert.ok(!t.clipped&&!t.wrapped&&!t.noise);
 const cut=traceVTI(renderSpectrum(tissue,flow,motion,specAt('plax',lm.vsdPerimembranous,{mode:'cw',scale:2,baseline:.15,bodyScale:st.patient.k})),95);assert.equal(cut.clipped,true);
 normal();
});
test('no signal, no trace; the envelope is zero where the display is dark',()=>{
 const sp={cols:8,bins:10,data:new Uint8Array(80),top:1,bottom:-1,vPeak:0,mode:'cw',nyquist:1};assert.equal(traceVTI(sp,60),null);assert.ok([...spectralEnvelope(sp).v].every(x=>x===0));
});
test('the calculation sheet: each formula, and nothing from inputs that make no sense',()=>{
 assert.equal(bernoulli(3),36);assert.equal(rvspFromTR(3,5),41);assert.equal(rvspFromVSD(100,4),36);assert.equal(shortening(40,26),.35);
 assert.ok(Math.abs(strokeVolume(20,20)-20*Math.PI)<1e-9);assert.ok(Math.abs(cardiacOutput(60,100)-6)<1e-12);assert.equal(cardiacIndex(6,2),3);
 assert.equal(qpqs(20,20,20,20),1);assert.equal(qpqs(30,20,20,20),1.5);assert.equal(qpqs(20,28.284271247461902,20,20).toFixed(6),'2.000000');
 for(const bad of [bernoulli(NaN),rvspFromTR(-1),shortening(20,30),strokeVolume(0,20),qpqs(1,0,1,1),cardiacIndex(3,0)])assert.equal(bad,null);
 for(const c of SHEET){assert.ok(c.name&&c.formula&&c.source.length&&c.inputs.length);const empty=Object.fromEntries(c.inputs.map(i=>[i[0],NaN]));assert.equal(c.run(empty),null,c.id)}
 assert.ok(SHEET.find(c=>c.id==='qpqs').note.includes('no reproduce'),'the limit of the simulator is stated where it applies');
});
