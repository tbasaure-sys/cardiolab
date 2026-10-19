// Transitional circulation (transition.mjs + shunt-model.mjs): the model, driven only by the hours of life, must reproduce the
// sourced timeline of the ductus (Shiraishi & Yanagisawa 1991) and the qualitative course of the other shunts.
import test from 'node:test';import assert from 'node:assert/strict';
import {shuntState,PVR} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';
import {pvrIndexAt,ductClosedShare,ductClosureHour,ductOpenFraction,DUCT_CLOSED,HOURS,hoursLabel} from '../transition.mjs';
const neonate=PATIENT_BY_ID.neonate,st=(o)=>shuntState({patient:neonate,...o});

test('the three named resistances give exactly the same state as their numeric index',()=>{
 for(const lesion of ['asd2','vsdpm','vsdm','pda'])for(const [key,v] of Object.entries(PVR))for(const size of [.3,.8]){
  const a=st({lesion,size,pvr:key}),b=st({lesion,size,pvr:v.index});assert.deepEqual({...a,pvr:0},{...b,pvr:0},`${lesion} ${key} ${size}`)}
});
test('resistance falls monotonically from the fetal-like start to the normal value',()=>{
 let prev=Infinity;for(const h of [0,1,3,6,12,24,48,72,168,336,672,1008,5000]){const v=pvrIndexAt(h);assert.ok(v<prev,`${h} h`);prev=v}
 assert.equal(pvrIndexAt(0),15);assert.ok(pvrIndexAt(1008)<3.8&&pvrIndexAt(1008)>3.5);
});
test('the ductus closure curve is the published one',()=>{
 assert.equal(ductClosedShare(24),.44);assert.equal(ductClosedShare(48),.88);assert.equal(ductClosedShare(72),1);assert.equal(ductClosedShare(4),0);
 for(const [h,f] of DUCT_CLOSED)assert.ok(Math.abs(ductClosedShare(h)-f)<1e-12);
 assert.ok(Math.abs(ductClosureHour(.44)-24)<1e-9&&Math.abs(ductClosureHour(.88)-48)<1e-9&&ductClosureHour(1)===72);
 assert.ok(ductClosureHour(.5)>24&&ductClosureHour(.5)<30);
});
test('a ductus that closes itself: open at birth, closed at its closure hour, never reopens',()=>{
 for(const q of [.1,.5,.95]){const tc=ductClosureHour(q);assert.equal(ductOpenFraction(0,q),1);assert.equal(ductOpenFraction(tc,q),0);assert.equal(ductOpenFraction(tc+50,q),0);
  let prev=1;for(let h=0;h<=80;h+=2){const o=ductOpenFraction(h,q);assert.ok(o<=prev+1e-12);prev=o}}
 const open=h=>st({lesion:'pda',size:.35,hours:h,closing:true}).defect.diameterMM;assert.ok(open(0)>1&&open(48)===0);
});
test('a persistent ductus: bidirectional the first hours, left-to-right from the first day',()=>{
 const dir=h=>st({lesion:'pda',size:.35,hours:h}).flows.direction;
 for(const h of [0,3,6])assert.equal(dir(h),'bidireccional',`${h} h`);
 for(const h of [24,48,168,1008])assert.equal(dir(h),'izquierda → derecha',`${h} h`);
});
test('shunts grow as the resistance falls: a VSD is quiet at birth and significant weeks later',()=>{
 const q=h=>st({lesion:'vsdpm',size:.5,hours:h});
 assert.ok(q(0).flows.qpqs<1.05,'no significant left-to-right shunt at birth');assert.ok((q(0).gains.LA||0)<.01,'no left atrial enlargement at birth');
 assert.ok(q(1008).flows.qpqs>1.5);assert.ok((q(1008).gains.LA||0)>(q(24).gains.LA||0)&&(q(24).gains.LA||0)>(q(0).gains.LA||0));
 let prev=0;for(const h of HOURS){const v=q(h).flows.qpqs;assert.ok(v>=prev-1e-9,`${h} h`);prev=v}
 assert.ok(q(1008).jet.sys>q(24).jet.sys,'the jet speeds up as the right-sided pressure falls');
});
test('hours override the resistance key, and are reported',()=>{
 const a=st({lesion:'asd2',size:.5,pvr:'suprasistemica',hours:72}),b=st({lesion:'asd2',size:.5,hours:72});assert.deepEqual(a,b);
 assert.equal(a.transition.hours,72);assert.equal(a.pvr,null);assert.ok(Math.abs(a.pvrIndex-pvrIndexAt(72))<1e-12);assert.equal(st({lesion:'asd2',size:.5}).transition,null);
 assert.equal(hoursLabel(12),'12 h');assert.equal(hoursLabel(72),'3 días');assert.equal(hoursLabel(672),'4 semanas');
});
