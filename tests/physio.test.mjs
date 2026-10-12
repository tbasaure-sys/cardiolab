// LV volume measured on the moving heart (physio.mjs): a normal ejection fraction, and the cavity keeps its volume while
// all four valves are closed (isovolumic contraction and relaxation), at a child's and at a newborn's heart rate.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,HeartMotion} from '../tissue.mjs';import {lvVolumeCurve} from '../physio.mjs';import {setHeartRate,valveOpening} from '../cycle.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const motion=new HeartMotion(tissue.landmarks);

for(const hr of [95,140])test(`LV volume through the beat at ${hr} lpm`,()=>{
 setHeartRate(hr);const c=lvVolumeCurve(tissue,motion,{phases:60});
 const ed=Math.max(...c.map(x=>x.ml)),es=Math.min(...c.map(x=>x.ml)),ef=(ed-es)/ed;
 assert.ok(ef>.5&&ef<.7,`EF ${(ef*100).toFixed(0)}%`);
 // isovolumic: all valves closed (between AV closure and aortic opening, and between aortic closure and mitral opening)
 const closed=c.filter(x=>x.t<.6&&valveOpening(x.t,'av')===0&&valveOpening(x.t,'semilunar')===0);assert.ok(closed.length>=3);
 for(const x of closed){const near=c.filter(y=>Math.abs(y.t-x.t)<1.5/60);const span=Math.max(...near.map(y=>y.ml))-Math.min(...near.map(y=>y.ml));assert.ok(span<.03*(ed-es),`volume changes ${span.toFixed(1)} mL at ${x.t.toFixed(3)} with the valves closed`)}
 setHeartRate(null);
});
