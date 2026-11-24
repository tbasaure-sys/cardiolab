// Right ventricle of the model against published adult normal values (Sawada 2023, WASE subanalysis: 2D measurements in
// the RV-focused apical four-chamber view). The atlas is an adult: its RV has a normal size; its systolic function was
// almost absent and is now set by two motion parameters (tissue.HeartMotion: tapse, rvIn).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL,HeartMotion} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';
import {rvFocused,RV_SOURCES} from '../physio.mjs';import {setBodyFit} from '../geometry.mjs';import {createFit} from '../thorax-fit.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
setBodyFit(1);tissue.setFit(createFit(1));
const lm=tissue.landmarks,motion=new HeartMotion(lm),view=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)).a4cRV,rv=rvFocused(tissue,motion,view,lm);
const sources=JSON.parse(fs.readFileSync(new URL('../lessons/sources.json',import.meta.url))).sources;
// Sawada 2023, table 4, American men (the atlas adult is 172 cm, 70 kg): mean, SD
const N={base:[38.6,4.8],mid:[32.4,5.8],length:[80.2,6.8],area:[21.6,4.5]},within=(v,[m,sd],k)=>Math.abs(v-m)<=k*sd;
// Sawada 2023, table 2, all Japanese subjects (function did not differ by sex; American men: TAPSE 23.7 ± 4.1, FAC 43.0 ± 4.0)
const TAPSE=[22.5,3.7],FAC=[42.9,4.2];

test('the source is in the catalogue',()=>{for(const id of RV_SOURCES)assert.ok(sources[id]?.doi,id)});
test('size: the RV of the adult atlas is within two standard deviations of the adult normal values',()=>{
 assert.ok(within(rv.base*1000,N.base,2),`base ${(rv.base*1000).toFixed(1)} mm`);assert.ok(within(rv.mid*1000,N.mid,2),`mid ${(rv.mid*1000).toFixed(1)} mm`);
 assert.ok(within(rv.length*1000,N.length,2),`length ${(rv.length*1000).toFixed(1)} mm`);assert.ok(within(rv.areaED*1e4,N.area,2),`end-diastolic area ${(rv.areaED*1e4).toFixed(1)} cm²`);
});
test('function: the tricuspid annulus descends a normal distance, about twice the mitral annulus',()=>{
 assert.ok(within(rv.tapse*1000,TAPSE,1),`TAPSE ${(rv.tapse*1000).toFixed(1)} mm (normal ${TAPSE[0]} ± ${TAPSE[1]})`);
 const mv=lm.mitralValve,out=[0,1,2].map(i=>mv[i]-lm.tricuspidValve[i]),l=Math.hypot(...out),p=mv.map((v,i)=>v+out[i]/l*.014),q=motion.forward(p,1),a=[0,1,2].map(i=>lm.lvApex[i]-p[i]),al=Math.hypot(...a);
 const mapse=((q[0]-p[0])*a[0]+(q[1]-p[1])*a[1]+(q[2]-p[2])*a[2])/al;assert.ok(rv.tapse>1.6*mapse&&rv.tapse<2.6*mapse,`TAPSE ${(rv.tapse*1000).toFixed(1)} mm, lateral mitral annulus ${(mapse*1000).toFixed(1)} mm`);
});
test('function: the cavity shrinks in systole — fractional area change still below the normal range (declared limit)',()=>{
 assert.ok(rv.areaES<rv.areaED);assert.ok(rv.fac>.15,`RV FAC ${(rv.fac*100).toFixed(0)} %`);
 // the day the model reaches the normal range this line fails: update the README and the coverage file
 assert.ok(rv.fac<(FAC[0]-2*FAC[1])/100,`RV FAC ${(rv.fac*100).toFixed(0)} % is now within two SD of normal (${FAC[0]} ± ${FAC[1]} %): the limit is no longer true`);
});
test('the motion stays a proper map: reference → systole → reference returns to the start in and around the RV',()=>{
 const rvc=lm.rvCentre,t=[0,0,0];let worst=0,s=5;const rnd=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff};
 for(let i=0;i<300;i++){const p=[rvc[0]+(rnd()-.5)*.08,rvc[1]+(rnd()-.5)*.08,rvc[2]+(rnd()-.5)*.09],q=motion.forward(p,1);motion.inverse(q,1,t);worst=Math.max(worst,Math.hypot(t[0]-p[0],t[1]-p[1],t[2]-p[2]))}
 assert.ok(worst<.0003,`worst round-trip error ${(worst*1000).toFixed(2)} mm`);
});
