// B-mode physics on a synthetic volume: the slice has a thickness (elevation), so a wall just outside the image plane
// still shows (partial volume), as in a real echo; an ideally thin plane would miss it.
import test from 'node:test';import assert from 'node:assert/strict';
import {createBMode} from '../bmode.mjs';import {LABEL} from '../tissue.mjs';

// blood everywhere, with a 0.8 mm myocardial sheet 0.8–1.6 mm off the plane (z), 30–40 mm deep
const tissue={lastDistance:0,
 tissueAt:(x,y,z)=>z>.0008&&z<.0016&&y>.03&&y<.04?LABEL.LV_MYO:LABEL.LV_BLOOD,
 lookup(x,y,z){this.lastDistance=0;return this.tissueAt(x,y,z)}};
const pose={origin:[0,0,0],u:[1,0,0],d:[0,1,0],n:[0,0,1],depth:.06,sector:30};
function meanIn(frame,r0,r1){let s=0,n=0;for(let j=0;j<frame.lines;j++)for(let k=Math.floor(r0/frame.depth*frame.samples);k<r1/frame.depth*frame.samples;k++){s+=frame.data[j*frame.samples+k];n++}return s/n}

test('slice thickness: a wall 1 mm outside the plane shows in the image',()=>{
 const bm=createBMode(),opts={pose,lines:48,freq:6,bodyScale:1,gain:1.4};
 const thin=meanIn(bm.render(tissue,{...opts,elevation:false}),.032,.038),thick=meanIn(bm.render(tissue,opts),.032,.038);
 assert.ok(thick>thin+25,`mean grey ${thin.toFixed(0)} → ${thick.toFixed(0)}`);
});

test('slice thickness keeps uniform tissue as bright as a thin plane (sub-ray echoes add in power)',()=>{
 const uni={lastDistance:0,tissueAt:()=>LABEL.LV_MYO,lookup(){return LABEL.LV_MYO}},bm=createBMode();
 const o={pose:{...pose,depth:.1},lines:64,freq:6,bodyScale:1,gain:1};
 const thin=meanIn(bm.render(uni,{...o,elevation:false}),.03,.05),thick=meanIn(bm.render(uni,o),.03,.05);
 assert.ok(Math.abs(thick-thin)<8,`mean grey ${thin.toFixed(0)} vs ${thick.toFixed(0)}`);
});

test('cardiac depth gain: a wall behind 4 cm of blood shows mild enhancement, not a white slab',()=>{
 // two 8 mm myocardial walls at 2 and 7 cm with blood between, like the septum and posterior wall across the LV
 const walls={lastDistance:0,tissueAt:(x,y,z)=>(y>.02&&y<.028)||(y>.07&&y<.078)?LABEL.LV_MYO:LABEL.LV_BLOOD,lookup(x,y,z){return this.tissueAt(x,y,z)}};
 const f=createBMode().render(walls,{pose:{...pose,depth:.1},lines:64,freq:6,bodyScale:1,gain:.8});
 const near=meanIn(f,.0215,.0265),far=meanIn(f,.0715,.0765);
 assert.ok(far>near&&far-near<90,`near ${near.toFixed(0)}, far ${far.toFixed(0)}`);
});

test('receiver noise: black at normal gain, a flickering grain deep in an empty field when the gain is pushed',()=>{
 const air={lastDistance:0,tissueAt:(x,y)=>y<.003?LABEL.SKIN:LABEL.AIR,lookup(x,y){return this.tissueAt(x,y)}},bm=createBMode();
 const o={pose:{...pose,depth:.12,sector:60},lines:64,freq:6,bodyScale:1};
 const far=f=>meanIn(f,.096,.12),r=(gain,seed)=>bm.render(air,{...o,gain,seed});
 assert.ok(far(r(1,0))<8,'normal gain');
 const a=r(2.5,0),b=r(2.5,1);assert.ok(far(a)>20,`high gain ${far(a).toFixed(0)}`);
 let d=0,n=0;for(let i=0;i<a.data.length;i++){if(i%a.samples<a.samples*.8)continue;d+=Math.abs(a.data[i]-b.data[i]);n++}
 assert.ok(d/n>8,`frame-to-frame change ${(d/n).toFixed(1)}`);
});
