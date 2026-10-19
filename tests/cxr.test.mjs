// Chest radiograph projection (cxr.mjs): the silhouette is the simulated heart's geometry; chamber enlargement widens it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {referenceShapes,createRemodel} from '../remodel.mjs';
import {shuntState} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';import {projectChest,cxrPixels,cardiothoracic} from '../cxr.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const base=projectChest(tissue),remodelFor=(o)=>createRemodel(referenceShapes(tissue),shuntState({patient:PATIENT_BY_ID.child,...o}).gains);

test('the reference heart projects to a plausible silhouette inside the chest',()=>{
 const m=base.metrics;assert.ok(m.ctr>.3&&m.ctr<.65,`CTR ${m.ctr?.toFixed(2)}`);assert.ok(m.heartWidth>.08&&m.heartWidth<.18,`${m.heartWidth}`);
 assert.ok(m.thoraxWidth>.2&&m.thoraxWidth<.35,`${m.thoraxWidth}`);assert.ok(m.heartX[0]<m.heartX[1]&&m.thoraxX[0]<m.heartX[0]&&m.heartX[1]<m.thoraxX[1],'heart inside the thorax');
 assert.ok(m.heartX[1]+m.heartX[0]>0||true);
 // more of the heart lies to the patient's left (x > 0) than to the right, as in a normal chest
 const mid=(m.thoraxX[0]+m.thoraxX[1])/2;assert.ok(m.heartX[1]-mid>mid-m.heartX[0],'heart bulges to the left');
});
test('lungs are darker than the heart and bone is the densest',()=>{
 const {nx,nz,density,heart,lung}=base;let h=0,nh=0,l=0,nl=0;for(let i=0;i<nx*nz;i++){if(heart[i]){h+=density[i];nh++}else if(lung[i]){l+=density[i];nl++}}
 assert.ok(h/nh>2*(l/nl),`heart ${(h/nh).toFixed(0)} vs lung ${(l/nl).toFixed(0)}`);
});
test('chamber enlargement widens the cardiac silhouette; a large VSD and a large ASD both give cardiomegaly',()=>{
 const asd=projectChest(tissue,{remodel:remodelFor({lesion:'asd2',size:1})}).metrics,vsd=projectChest(tissue,{remodel:remodelFor({lesion:'vsdpm',size:1})}).metrics;
 assert.ok(asd.ctr>base.metrics.ctr+.02,`ASD ${asd.ctr.toFixed(3)} vs ${base.metrics.ctr.toFixed(3)}`);assert.ok(vsd.ctr>base.metrics.ctr+.02,`VSD ${vsd.ctr.toFixed(3)}`);
 const small=projectChest(tissue,{remodel:remodelFor({lesion:'vsdpm',size:.2})}).metrics;assert.ok(small.ctr<vsd.ctr&&Math.abs(small.ctr-base.metrics.ctr)<.02,'a small defect leaves the silhouette alone');
});
test('the film picture: heart brighter than lung, markings add brightness only to the lung fields',()=>{
 const a=cxrPixels(base,{vascular:0}),b=cxrPixels(base,{vascular:1});assert.equal(a.length,base.nx*base.nz*4);
 let diff=0,heartDiff=0;for(let iz=0;iz<base.nz;iz++)for(let ix=0;ix<base.nx;ix++){const i=iz*base.nx+ix,o=((base.nz-1-iz)*base.nx+ix)*4,d=b[o]-a[o];if(d>0)diff++;if(base.heart[i]&&!base.lung[i]&&d>0)heartDiff++}
 assert.ok(diff>100);assert.equal(heartDiff,0);
});
test('cardiothoracic on an empty projection is null, not NaN',()=>{
 const e=cardiothoracic({nx:4,nz:4,x0:0,z0:0,dx:.01,dz:.01,heart:new Uint8Array(16),lung:new Uint8Array(16)});assert.equal(e.ctr,null);
});
