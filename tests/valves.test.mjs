// Valve leaflet geometry on the real atlas landmarks: AV valves seal at their coaptation in systole, open in diastole,
// and the tricuspid septal leaflet inserts closer to the apex than the mitral (as in a normal heart).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import zlib from 'node:zlib';
import {buildValves,sliceValves,setValveVariant} from '../valves.mjs';
import {parseTissue} from '../tissue.mjs';
import {valveVariant} from '../chd-data.mjs';

const lm=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url))).landmarks;
const stub={positions:new Float32Array([0,0,0])},valves=buildValves({'Ascending aorta':stub,'Pulmonary trunk':stub},lm);
const pose={origin:[0,0,0],u:[1,0,0],d:[0,1,0],n:[0,0,1]},NJ=7,MID=8;
const tip=(L,i)=>{const k=(i*(NJ+1)+NJ)*3;return [L.positions[k],L.positions[k+1],L.positions[k+2]]};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const mitral=valves.find(v=>v.id==='mitral'),tricuspid=valves.find(v=>v.id==='tricuspid');

test('the mitral valve seals in systole: both leaflet tips meet at the coaptation line',()=>{
 sliceValves(valves,pose,.2); // mid-systole: AV valves closed
 const [A,P]=mitral.leaflets;assert.ok(dist(tip(A,MID),tip(P,MID))<.001,`gap ${(dist(tip(A,MID),tip(P,MID))*1000).toFixed(1)} mm`);
});

test('the mitral valve opens in diastole: the tips separate into an orifice',()=>{
 sliceValves(valves,pose,.47); // early filling: fully open
 const [A,P]=mitral.leaflets;assert.ok(dist(tip(A,MID),tip(P,MID))>.012);
});

test('the anterior mitral leaflet is the longer one and spans about a third of the annulus',()=>{
 sliceValves(valves,pose,.2);const [A,P]=mitral.leaflets,base=(L,i)=>[0,1,2].map(a=>L.positions[i*(NJ+1)*3+a]);
 assert.ok(dist(base(A,MID),tip(A,MID))>1.3*dist(base(P,MID),tip(P,MID)));
 assert.ok(A.a1-A.a0>=100&&A.a1-A.a0<=140);
});

// apical offset of the tricuspid septal insertion from the mitral one, along the LV axis (hinges closest to the other valve)
function septalOffset(){
 sliceValves(valves,pose,.2);const long=[0,1,2].map(a=>lm.mitralValve[a]-lm.lvApexCavity[a]),l=Math.hypot(...long),ax=long.map(v=>v/l);
 const hinges=v=>v.leaflets.flatMap(L=>Array.from({length:17},(_,i)=>[0,1,2].map(a=>L.positions[i*(NJ+1)*3+a])));
 const near=(v,o)=>hinges(v).reduce((b,p)=>dist(p,o.C)<dist(b,o.C)?p:b);
 const m=near(mitral,tricuspid),t=near(tricuspid,mitral);return [0,1,2].reduce((s,a)=>s+(m[a]-t[a])*ax[a],0);
}
test('the tricuspid septal insertion lies 4–9 mm (atlas) closer to the apex than the mitral one',()=>{
 const off=septalOffset();assert.ok(off>.004&&off<.009,`offset ${(off*1000).toFixed(1)} mm`);
});

test('Ebstein anomaly displaces the septal leaflet beyond 8 mm/m² even when mild; the normal valve comes back',()=>{
 const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url))),file=f=>zlib.gunzipSync(fs.readFileSync(new URL('../assets/'+f,import.meta.url)));
 const tissue=parseTissue(meta,file(meta.fine.file),file(meta.coarse.file)),normal=septalOffset();
 // school-age child: body scale 0.65, BSA 0.8 m²; the panel's size slider goes down to half the default displacement
 setValveVariant(valves,tissue,valveVariant({id:'ebstein',params:{mm:9}}));const mild=septalOffset();
 assert.ok(mild*1000*.65/.8>8,`mild Ebstein ${(mild*1000*.65/.8).toFixed(1)} mm/m²`);
 setValveVariant(valves,tissue,valveVariant({id:'normal'}));assert.ok(Math.abs(septalOffset()-normal)<1e-6);
});
