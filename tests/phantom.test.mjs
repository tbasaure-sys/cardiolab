// Physics chapters measure the simulator's own resolution on a phantom: the numbers must follow the physics.
import test from 'node:test';import assert from 'node:assert/strict';
import {createBMode} from '../bmode.mjs';
import {createPhantom,wireOverlay,PHANTOM,PHANTOM_POSE,spotWidth,penetration,cystContrast} from '../phantom.mjs';

const bm=createBMode(),ph=createPhantom();
const scan=(o)=>bm.render(ph,{pose:PHANTOM_POSE,lines:168,samples:1200,gain:1,bodyScale:1,harmonic:true,focus:.5,overlays:[wireOverlay()],envelope:true,seed:1,...o});
const at=(f,cm)=>spotWidth(f,PHANTOM.column.find(p=>Math.round(p.y*100)===cm));

test('axial resolution improves with frequency (shorter pulse)',()=>{
 const lo=at(scan({freq:2.5,harmonic:false}),5).axial,hi=at(scan({freq:10}),5).axial;
 assert.ok(lo>2*hi,`2,5 MHz ${lo.toFixed(2)} mm vs 10 MHz ${hi.toFixed(2)} mm`);
});
test('lateral resolution is best at the transmit focus',()=>{
 for(const [focus,cm] of [[.25,3],[.75,9]]){const f=scan({freq:4,focus});const w=[2,3,4,5,6,7,8,9,10].map(c=>({c,w:at(f,c).lateral??99}));
  const best=w.reduce((a,b)=>b.w<a.w?b:a);assert.ok(Math.abs(best.c-cm)<=1,`focus at ${cm} cm: narrowest wire at ${best.c} cm (${w.map(x=>x.w.toFixed(1)).join(' ')})`)}
});
test('penetration falls at high frequency (attenuation ∝ frequency)',()=>{
 const p=freq=>penetration(scan({freq,seed:1}),scan({freq,seed:2})).limit;
 const p4=p(4),p10=p(10);assert.ok(p4>=.1&&p10<p4-.02,`4 MHz ${(p4*100).toFixed(0)} cm, 10 MHz ${(p10*100).toFixed(0)} cm`);
});
test('a large cyst is clearly anechoic at a low frequency',()=>{
 const f=scan({freq:4});assert.ok(cystContrast(f,PHANTOM.cysts[2])>.8);
});
