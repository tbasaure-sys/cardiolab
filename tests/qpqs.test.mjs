// Qp/Qs measured on the simulator: velocity–time integral × annulus area at each semilunar valve reproduces the model's
// flows (flow.mjs: continuity between the outflows, valve throat, outflowScale). With a duct the ratio is inverted.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL,HeartMotion} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {buildFlow,lesionJets,outflowScale,orificeArea} from '../flow.mjs';import {renderSpectrum,traceVTI} from '../spectral.mjs';
import {shuntState,variantSpec} from '../shunt-model.mjs';import {applyVariant} from '../chd-data.mjs';import {PATIENT_BY_ID,bodyScale} from '../patient.mjs';
import {setBodyFit} from '../geometry.mjs';import {createFit} from '../thorax-fit.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
setBodyFit(1);tissue.setFit(createFit(1));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),motion=new HeartMotion(lm),flow=buildFlow(tissue),pat=PATIENT_BY_ID.child,k=bodyScale(pat);
const A0={ao:orificeArea(lm.valveHinges.aortic),pv:orificeArea(lm.valveHinges.pulmonary)};
function apply(lesion,size){tissue.reset();if(!lesion){flow.jets=[];flow.scale=null;return {qpqs:1,g:{aortic:1,pulmonary:1}}}
 const st=shuntState({lesion,size,patient:pat}),spec=variantSpec(st);applyVariant(tissue,spec);flow.jets=lesionJets(tissue,spec);flow.scale=outflowScale(tissue,spec.params.hemo.flowScale);return {qpqs:st.flows.qpqs,g:flow.scale.annulus}}
// forward flow per beat through a valve as the field has it: mean axial velocity over the beat × annulus area
const through=(T,area)=>{let s=0;const v=[0,0,0],n=200;for(let i=0;i<n;i++)if(flow.velocity(T.c[0],T.c[1],T.c[2],(i+.5)/n,v))s+=Math.max(0,v[0]*T.n[0]+v[1]*T.n[1]+v[2]*T.n[2])/n;return s*area};
// the learner's measurement: PW (or CW when it would alias) with the sample at the valve, traced VTI × annulus area
function traced(viewId,c,area,cw){const v=views[viewId],w=tissue.remodel.forward(c),q=w.map((x,i)=>x-v.origin[i]),x=q[0]*v.u[0]+q[1]*v.u[1]+q[2]*v.u[2],y=q[0]*v.d[0]+q[1]*v.d[1]+q[2]*v.d[2];
 const sp=renderSpectrum(tissue,flow,motion,{pose:{origin:v.origin,u:v.u,d:v.d,n:v.n,depth:v.depth,sector:80},theta:Math.atan2(x,y)*180/Math.PI,gateDepth:Math.hypot(x,y),gateLen:.003,mode:cw?'cw':'pw',freq:3,scale:cw?5:2.4,baseline:.5,bodyScale:k,hr:pat.hr});
 const tr=traceVTI(sp,pat.hr);assert.ok(tr&&!tr.wrapped,`${viewId}: a clean trace`);return tr.vti*area}

test('normal heart: the same flow leaves through both semilunar valves',()=>{
 apply(null);assert.ok(Math.abs(flow.pulmonaryToAortic-A0.ao/A0.pv)<1e-9,'pulmonary valve velocity = aortic × (aortic area / pulmonary area)');
 const r=through(flow.throat.pulmonary,A0.pv)/through(flow.throat.aortic,A0.ao);assert.ok(Math.abs(r-1)<.02,`Qp/Qs of the field ${r.toFixed(3)}`);
 // the plug at the valve reads the valve velocity: aortic about 1 m/s, pulmonary lower by the area ratio
 const v=[0,0,0];let pk=0;for(let i=0;i<100;i++){flow.velocity(...lm.aorticValve,(i+.5)/100,v);pk=Math.max(pk,Math.hypot(...v))}assert.ok(pk>.9&&pk<1.15,`aortic valve peak ${pk.toFixed(2)} m/s`);
});
test('with a shunt the valve flows are the model\'s: ASD and VSD load the pulmonary valve, a duct the aortic one',()=>{
 for(const [lesion,size] of [['asd2',.6],['asd2',1],['vsdpm',.6]]){const {qpqs,g}=apply(lesion,size),r=through(flow.throat.pulmonary,A0.pv*g.pulmonary)/through(flow.throat.aortic,A0.ao*g.aortic);
  assert.ok(Math.abs(r/qpqs-1)<.03,`${lesion} ${size}: field ${r.toFixed(2)} vs model ${qpqs.toFixed(2)}`)}
 for(const size of [.6,1]){const {qpqs,g}=apply('pda',size),r=through(flow.throat.aortic,A0.ao*g.aortic)/through(flow.throat.pulmonary,A0.pv*g.pulmonary);
  assert.ok(Math.abs(r/qpqs-1)<.08,`duct ${size}: aortic / pulmonary valve flow ${r.toFixed(2)} vs model ${qpqs.toFixed(2)}`)}
});
test('as a learner measures it — traced VTI × annulus, beam aligned — the ratio is the model\'s within 12 %',()=>{
 for(const [lesion,size] of [[null,0],['asd2',1],['vsdpm',.6]]){const {qpqs,g}=apply(lesion,size),cw=qpqs>2.2;
  const qp=traced('scRVOT',lm.pulmonaryValve,A0.pv*g.pulmonary,cw),qs=traced('ssn',lm.aorticValve,A0.ao*g.aortic,false),r=qp/qs;
  assert.ok(Math.abs(r/qpqs-1)<.12,`${lesion||'normal'}: measured ${r.toFixed(2)} vs model ${qpqs.toFixed(2)}`)}
 // from the apical five-chamber the aortic beam is ~35° off axis: the aortic flow is underestimated and the ratio comes out high
 const {g}=apply(null),r5=traced('scRVOT',lm.pulmonaryValve,A0.pv*g.pulmonary,false)/traced('a5c',lm.aorticValve,A0.ao*g.aortic,false);assert.ok(r5>1.08&&r5<1.4,`normal from the five-chamber ${r5.toFixed(2)}`);
 tissue.reset();flow.jets=[];flow.scale=null;
});
