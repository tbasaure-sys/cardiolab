// «Pregúntale al píxel»: the explanation of a pixel must agree with the physics the renderer applied, on volumes whose
// answer is known (a bone slab, a blood cavity in myocardium, a soft-tissue interface at a given angle).
import test from 'node:test';import assert from 'node:assert/strict';
import {createBMode} from '../bmode.mjs';import {LABEL,PROPS} from '../tissue.mjs';import {explainPixel,pixelOf} from '../pixel-trace.mjs';

const pose={origin:[0,0,0],u:[1,0,0],d:[0,1,0],n:[0,0,1],depth:.1,sector:30};
const vol=f=>({lastDistance:1,tissueAt:f,lookup(x,y,z){this.lastDistance=1;return f(x,y,z)}});
const bm=createBMode(),base={pose,lines:64,samples:800,freq:4,bodyScale:1,gain:1,harmonic:true,elevation:false,seed:1};
const centre=64>>1;
const at=(frame,cm)=>Math.min(frame.samples-1,Math.floor(cm/100/frame.depth*frame.samples));

// myocardium with a blood cavity 30–60 mm and a bone slab 75–80 mm (the bone casts a shadow behind it)
const world=vol((x,y)=>y<.003?LABEL.SKIN:y>.03&&y<.06?LABEL.LV_BLOOD:y>.075&&y<.08?LABEL.BONE:LABEL.LV_MYO);
const frame=bm.render(world,{...base,trace:{j:centre}});
const T=frame.trace;

test('the trace does not change the image',()=>{
 const plain=bm.render(world,base);assert.deepEqual(Array.from(plain.data),Array.from(frame.data));assert.equal(plain.trace,null);
});
test('the traced line has the tissue of each depth and the grey the image shows',()=>{
 const k=at(frame,4.5),e=explainPixel(T,k);assert.equal(e.label,LABEL.LV_BLOOD);assert.equal(e.name,'Cavidad VI');
 assert.equal(e.grey,frame.data[centre*frame.samples+k]);
});
test('attenuation matches the tissue: dB/cm/MHz × frequency × round trip',()=>{
 // between 10 and 20 mm the beam crosses only myocardium (0.55 dB/cm/MHz): 2 × 0.55 × 4 MHz × 1 cm × 1.12 (harmonic) = 4.9 dB
 const a=explainPixel(T,at(frame,1)),b=explainPixel(T,at(frame,2)),d=b.loss.att-a.loss.att,want=2*PROPS[LABEL.LV_MYO*3+2]*4*1.12;
 assert.ok(Math.abs(d-want)<.5,`${d.toFixed(2)} dB vs ${want.toFixed(2)} dB per cm`);
});
test('an interface reports its impedance step, angle and loss',()=>{
 const e=explainPixel(T,at(frame,3.2)),i=e.events.find(x=>x.kind==='iface'&&Math.abs(x.depthCm-3)<.3);assert.ok(i,'interface at 3 cm');
 const z0=PROPS[LABEL.LV_MYO*3+1],z1=PROPS[LABEL.LV_BLOOD*3+1];assert.ok(Math.abs(Math.abs(i.rc)-Math.abs((z1-z0)/(z1+z0)))<1e-6);
 assert.ok(i.angleDeg<15,`beam almost perpendicular to a flat interface: ${i.angleDeg.toFixed(0)}°`);assert.ok(i.lossDB>0);
});
test('behind the bone the verdict is shadow and the loss is large',()=>{
 const e=explainPixel(T,at(frame,9));assert.equal(e.verdict.id,'sombra',e.verdict.text);assert.ok(e.loss.shadow>=9,`${e.loss.shadow}`);assert.ok(e.loss.total>explainPixel(T,at(frame,7)).loss.total+10);
 assert.match(e.verdict.text,/hueso/);
});
test('inside the blood cavity the pixel is black and it says why',()=>{
 const e=explainPixel(T,at(frame,4.5));assert.ok(['cavidad','neblina'].includes(e.verdict.id),e.verdict.id);assert.ok(e.grey<60,`${e.grey}`);
 assert.equal(e.shares[0].id!=='speckle',true,'blood does not produce speckle');
});
test('in plain myocardium the main source is speckle',()=>{
 const e=explainPixel(T,at(frame,2));assert.equal(e.verdict.id,'speckle',e.verdict.text);assert.equal(e.shares[0].id,'speckle');
 const total=e.shares.reduce((s,x)=>s+x.pct,0);assert.ok(total>95&&total<=100.5,`shares add to ${total.toFixed(1)}%`);
});
test('a tilted interface is weaker than a perpendicular one (specular dependence on the angle)',()=>{
 const tilt=Math.tan(25*Math.PI/180),wall=vol((x,y)=>y<.003?LABEL.SKIN:(y-.04)-tilt*x>0?LABEL.LV_BLOOD:LABEL.LV_MYO);
 const fl=bm.render(wall,{...base,seed:1,trace:{j:centre}}),fp=bm.render(vol((x,y)=>y<.003?LABEL.SKIN:y>.04?LABEL.LV_BLOOD:LABEL.LV_MYO),{...base,trace:{j:centre}});
 const sp=r=>{const e=explainPixel(r.trace,at(r,4.0)),i=e.events.find(x=>x.kind==='iface'&&Math.abs(x.depthCm-4)<.4);return i?i.specular:0};
 assert.ok(sp(fl)<sp(fp)*.5,`${sp(fl).toExponential(2)} (25°) vs ${sp(fp).toExponential(2)} (0°)`);
});
test('pixelOf maps an image point to its scan line and sample',()=>{
 const p=pixelOf(frame,0,.05);assert.equal(p.j,Math.floor(frame.lines/2));assert.equal(p.k,at(frame,5));assert.equal(pixelOf(frame,0,-.01),null);assert.equal(pixelOf(frame,.2,.01),null);
});

test('a bright specular interface is explained as a surface, not as tissue texture',()=>{
 // a strong interface (bone-like impedance step in soft tissue) at 4 cm: the pixel at the interface is specular-dominated
 const w=vol((x,y)=>y<.003?LABEL.SKIN:y>.04&&y<.043?LABEL.BONE:LABEL.LV_MYO),fr=bm.render(w,{...base,trace:{j:centre}}),e=explainPixel(fr.trace,at(fr,4.0));
 assert.equal(e.shares[0].id,'especular',JSON.stringify(e.shares.slice(0,3)));assert.ok(['especular','sombra'].includes(e.verdict.id),e.verdict.id);
});
test('the verdict wording is grammatical',()=>{
 const lung=vol((x,y)=>y<.003?LABEL.SKIN:y>.02?LABEL.LUNG:LABEL.LV_MYO),fr=bm.render(lung,{...base,trace:{j:centre}}),e=explainPixel(fr.trace,at(fr,6));
 assert.equal(e.verdict.id,'sombra');assert.doesNotMatch(e.verdict.text,/de el /);
});
