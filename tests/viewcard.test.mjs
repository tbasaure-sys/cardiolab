// The view card names the standard view the probe is on: every view has its card text, and from each reference pose
// the nearest view is that same view (the card never names a neighbour, e.g. A5C for A4C or PSAX-VM for PSAX-PM).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildViews,VIEW_INFO,VIEW_CARD,nearestView} from '../views.mjs';

const lm=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url))).landmarks,views=buildViews(lm);

test('every standard view has a card: where the probe goes and what it shows',()=>{
 for(const id of Object.keys(VIEW_INFO)){const c=VIEW_CARD[id];assert.ok(c&&c.probe.length>20&&c.shows.length>=2,id)}
});

test('from each reference pose the card names that view',()=>{
 for(const [id,t] of Object.entries(views)){const n=nearestView(t,views);assert.equal(n?.id,id);assert.ok(n.score>=75,`${id} ${n.score}`)} // scSAX scores 78: the atlas IVC lies just off its plane
});

test('far from every standard plane the card says nothing',()=>{
 const t=views.plax,off={...t,origin:t.origin.map((v,i)=>v+t.n[i]*.04)};assert.equal(nearestView(off,{plax:t}),null);
});
