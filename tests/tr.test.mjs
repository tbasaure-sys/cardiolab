// Tricuspid regurgitation of the shunt study: a jet whose velocity carries the RV pressure, measured with CW from the apex
// as in practice (RV systolic pressure ≈ 4·v² + right atrial pressure).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL,HeartMotion} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {buildFlow,lesionJets} from '../flow.mjs';import {renderSpectrum,optimizeAim} from '../spectral.mjs';
import {shuntState,variantSpec} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';import {applyVariant} from '../chd-data.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),motion=new HeartMotion(lm),flow=buildFlow(tissue);
function measure(o){
 const st=shuntState({patient:PATIENT_BY_ID.child,...o}),spec=variantSpec(st);tissue.reset();applyVariant(tissue,spec);flow.jets=lesionJets(tissue,spec);flow.scale=spec.params.hemo.flowScale;
 const t=views.a4c,pose={origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:80},q=lm.tricuspidValve.map((v,i)=>v-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2];
 const sp={pose,theta:Math.atan2(x,y)*180/Math.PI,gateDepth:Math.hypot(x,y),mode:'cw',freq:3.5,scale:6,baseline:.85,bodyScale:st.patient.k};
 return {st,v:renderSpectrum(tissue,flow,motion,{...sp,theta:optimizeAim(tissue,flow,motion,sp,{range:8,step:1})}).vPeak};
}
test('the model gives the jet the velocity of the RV–RA gradient',()=>{
 for(const o of [{lesion:'vsdpm',size:.3},{lesion:'vsdpm',size:1,pvr:'elevada'},{lesion:'asd2',size:.8},{lesion:'pda',size:1}]){const s=shuntState({patient:PATIENT_BY_ID.child,...o});
  assert.ok(Math.abs(4*s.tr.v**2-(s.pressures.rvSys-s.pressures.raMean))<1e-9);assert.equal(variantSpec(s).params.hemo.tr,s.tr.v)}
});
test('CW from the apical four-chamber view reads it away from the probe, within the simulator\'s 15 %, and it rises with the RV pressure',()=>{
 const low=measure({lesion:'vsdpm',size:.3}),high=measure({lesion:'vsdpm',size:1,pvr:'elevada'});
 for(const m of [low,high]){assert.ok(m.v<0,'away from an apical probe');const r=Math.abs(m.v)/m.st.tr.v;assert.ok(r>.85&&r<=1.02,`measured/model ${r.toFixed(2)}`)}
 assert.ok(Math.abs(high.v)>Math.abs(low.v)+1);
 // the estimate a reader would write down
 const est=4*high.v**2+high.st.pressures.raMean;assert.ok(Math.abs(est-high.st.pressures.rvSys)/high.st.pressures.rvSys<.25,`RVSP ${est.toFixed(0)} vs ${high.st.pressures.rvSys.toFixed(0)}`);
});
test('no shunt model, no added jet: the normal heart and the plain lesions keep their flow',()=>{
 tissue.reset();assert.equal(lesionJets(tissue,{id:'normal'}).length,0);assert.equal(lesionJets(tissue,{id:'vsdpm',params:{radius:.005}}).length,1);
});
