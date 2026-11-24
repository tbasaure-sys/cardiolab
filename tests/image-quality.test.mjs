// Image-quality scoring (image-quality.mjs): measured on the image against the same plane with reference settings.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';import {createBMode} from '../bmode.mjs';
import {gridPoints,imageMetrics,scoreImage,TOLERANCE} from '../image-quality.mjs';import {KNOBS} from '../drills.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const views=buildViews(tissue.landmarks,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),engine=createBMode(),T50=Array(8).fill(50);
function measure(view,o={}){const t=views[view],pose={origin:t.origin,u:t.u,d:t.d,n:t.n,depth:o.depth??t.depth,sector:80},g=gridPoints(pose),labels=g.points.map(p=>tissue.tissueAt(...p));
 const f=engine.render(tissue,{pose,lines:96,freq:4,gain:o.gain??1,tgc:o.tgc||T50,focus:o.focus??.55,bodyScale:1,seed:1});return {metrics:imageMetrics(f,labels,g),depth:pose.depth,focus:o.focus??.55}}
const VIEWS=['plax','psaxPM','a4c','sc4c'],ref=Object.fromEntries(VIEWS.map(v=>[v,measure(v)]));

test('the reference image passes every criterion, and so does a small change of gain',()=>{
 for(const v of VIEWS){const s=scoreImage(ref[v],ref[v]);assert.ok(s.ok&&s.total>=4,`${v}: ${s.passed}/${s.total}`);
  for(const g of [.85,1.2]){const r=scoreImage(measure(v,{gain:g}),ref[v]);assert.ok(r.ok,`${v} gain ${g}: ${r.criteria.filter(c=>!c.ok).map(c=>c.id)}`)}}
});
test('in a normal image the cavities are dark and the myocardium is brighter',()=>{
 for(const v of VIEWS){const m=ref[v].metrics;assert.ok(m.cavity<12,`${v} cavity ${m.cavity}`);assert.ok(m.tissue>m.cavity+15,`${v} tissue ${m.tissue}`);assert.ok(m.cells.cavity>100&&m.cells.tissue>20)}
});
test('every mis-set image of the drills fails, on the criterion that names the problem',()=>{
 const expect={gainLow:['tissue'],gainHigh:['tissue','cavity'],deep:['depth'],shallow:['depth'],farDark:['tissue','balance'],nearBright:['balance']};
 for(const v of VIEWS)for(const k of KNOBS){const t=views[v],cur=measure(v,{gain:k.params?.gain,tgc:k.params?.tgc,depth:k.depth?k.depth(t.depth):undefined}),s=scoreImage(cur,ref[v]),bad=s.criteria.filter(c=>!c.ok);
  assert.ok(!s.ok,`${v} ${k.id} passes`);assert.ok(bad.some(c=>expect[k.id].includes(c.id)),`${v} ${k.id}: failed ${bad.map(c=>c.id)}`);for(const c of bad)assert.ok(c.advice.length>20)}
});
test('gain too high fills the cavities with echoes; a focus far from the heart is flagged',()=>{
 const hi=measure('plax',{gain:2.3});assert.ok(hi.metrics.cavity>ref.plax.metrics.cavity+TOLERANCE.cavity);
 const f=scoreImage(measure('psaxPM',{focus:.2}),ref.psaxPM);assert.equal(f.criteria.find(c=>c.id==='focus').ok,false);
});
test('the grid covers the fan: points inside the sector and within the depth',()=>{
 const t=views.plax,pose={origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:80},g=gridPoints(pose,{lines:10,samples:8});assert.equal(g.points.length,80);
 for(const p of g.points){const q=p.map((x,i)=>x-pose.origin[i]),x=q[0]*pose.u[0]+q[1]*pose.u[1]+q[2]*pose.u[2],y=q[0]*pose.d[0]+q[1]*pose.d[1]+q[2]*pose.d[2];assert.ok(y>0&&Math.hypot(x,y)<pose.depth&&Math.abs(Math.atan2(x,y))<40*Math.PI/180)}
});
