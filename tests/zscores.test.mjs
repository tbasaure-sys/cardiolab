import test from 'node:test';
import assert from 'node:assert/strict';
import {zScore,formatZ} from '../zscores.mjs';
import {bsaHaycock,bodyScale,PATIENTS,PATIENT_BY_ID} from '../patient.mjs';

test('PHN worked example: mitral annulus 11 mm at BSA 0.3 m² is Z −1.0',()=>{assert.equal(Number(zScore('mitral',1.1,.3).toFixed(1)),-1)});
test('unknown measurements have no Z-score',()=>{assert.equal(zScore('nope',2,1),null);assert.equal(formatZ(null),'')});
test('Haycock BSA and body scale',()=>{
 assert.ok(Math.abs(bsaHaycock(70,172)-1.83)<.02);assert.equal(Number(bodyScale(PATIENT_BY_ID.adult).toFixed(6)),1);
 const ks=PATIENTS.map(bodyScale);for(let i=1;i<ks.length;i++)assert.ok(ks[i]>ks[i-1]);assert.ok(ks[0]>.3&&ks[0]<.4);
});
test('with linear scaling ∝ √BSA the mitral Z-score does not change with patient size',()=>{
 const adultCm=3.1,zs=PATIENTS.map(p=>zScore('mitral',adultCm*bodyScale(p),bsaHaycock(p.weight,p.height)));
 for(const z of zs)assert.ok(Math.abs(z-zs[0])<1e-9);
});
