// Contraction model: in systole the LV wall thickens (incompressible myocardium) while the cavity shrinks, as in a
// real heart; a uniform radial scaling would thin it.
import test from 'node:test';import assert from 'node:assert/strict';
import {HeartMotion} from '../tissue.mjs';

// a cylindrical LV along z (cavity radius 20 mm, wall 8 mm) between z = 0 and 80 mm
const NL=24,NA=36,lvEndo={from:[0,0,0],to:[0,0,.08],e1:[1,0,0],levels:NL,angles:NA,centre:Array(NL*2).fill(0),ri:Array(NL*NA).fill(.02),re:Array(NL*NA).fill(.028)};
const lm={lvApex:[0,0,-.005],mitralValve:[0,0,.08],tricuspidValve:[.0001,0,.08],lvEndo};
const radiusNow=(m,r0,s)=>{const p=m.forward([r0,0,.04],s);return Math.hypot(p[0],p[1])};

test('systole: the cavity shortens 25–40% and the wall thickens 25–60%',()=>{
 const m=new HeartMotion(lm),endo=radiusNow(m,.02,1),epi=radiusNow(m,.028,1);
 const shortening=1-endo/.02,thickening=(epi-endo)/.008-1;
 assert.ok(shortening>.25&&shortening<.4,`endocardial shortening ${(shortening*100).toFixed(0)}%`);
 assert.ok(thickening>.25&&thickening<.6,`wall thickening ${(thickening*100).toFixed(0)}%`);
});

test('diastole is the reference anatomy, and tissue well outside the heart does not follow the LV wall',()=>{
 const m=new HeartMotion(lm);assert.ok(Math.abs(radiusNow(m,.02,0)-.02)<1e-6);
 const far=radiusNow(m,.06,1);assert.ok(far>.06*.94,`far point moved to ${(far*1000).toFixed(1)} mm`);
});
