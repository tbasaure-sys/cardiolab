// Extended pediatric views (22): built from atlas and volume-derived landmarks; each is its own nearest view, its
// window is open (no lung or bone across the fan), and the guided sweeps describe the real probe motion.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction,VIEW_INFO,VIEW_CARD,SWEEPS,nearestView,planeAgreement,markerClock} from '../views.mjs';
import {lessonContext,lessonForSweep,lessonForView,validateLesson,resolveState,maneuverAgrees,planeThrough} from '../lesson-engine.mjs';
import {poseFromState} from '../geometry.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE)),ctx=lessonContext(lm,views);
const sources=JSON.parse(fs.readFileSync(new URL('../lessons/sources.json',import.meta.url))).sources;

test('landmarks derived from the volume: venae cavae, pulmonary veins, coronary sinus, branch PAs, aorta',()=>{
 for(const k of ['svc','svcJunction','pvRight','pvLeft','coronarySinus','rpa','rpaProximal','lpa','paBifurcation','descendingAorta','ascendingAorta','raCentre','laCentre','rvCentre','lvCentre'])assert.ok(lm[k]?.length===3,k);
 assert.ok(lm.svc[2]>lm.raCentre[2]+.03,'SVC above the RA');assert.ok(lm.pvRight[0]<lm.pvLeft[0],'right veins on the right');assert.ok(lm.rpa[0]<lm.paBifurcation[0],'RPA to the right of the bifurcation');
 assert.ok(lm.descendingAorta[1]>lm.laCentre[1],'descending aorta behind the LA');
});

test('22 standard views, each with its card and its own nearest view',()=>{
 assert.equal(Object.keys(views).length,22);
 for(const [id,t] of Object.entries(views)){assert.ok(VIEW_INFO[id]&&VIEW_CARD[id],id);const n=nearestView(t,views);assert.equal(n?.id,id,id);assert.ok(n.score>=75,`${id} ${n.score}`)}
});

test('every view looks through an open window (not across lung or bone)',()=>{
 const blocked=p=>{let n=0;const sec=p.sector*Math.PI/180;for(let j=0;j<41;j++){const th=-sec/2+sec*(j+.5)/41,b=[0,1,2].map(i=>Math.cos(th)*p.d[i]+Math.sin(th)*p.u[i]);for(let r=.003;r<p.depth*.7;r+=.001){const l=tissue.tissueAt(...[0,1,2].map(i=>p.origin[i]+b[i]*r));if(l===LABEL.LUNG||l===LABEL.BONE){n++;break}}}return n/41};
 for(const [id,t] of Object.entries(views))assert.ok(blocked(t)<=.7,`${id} ${blocked(t).toFixed(2)}`);
});

test('marker positions follow the window conventions',()=>{
 const c=id=>markerClock(views[id].u),near=(h,a,b)=>a<=b?h>=a&&h<=b:h>=a||h<=b;
 assert.ok(near(c('plaxRVIn'),9.5,11.5)&&near(c('plaxRVOut'),9.5,11.5),'parasternal long-axis sweep keeps the PLAX marker');
 assert.ok(near(c('ductal'),10.5,12.5),'ductal view: marker toward the head');assert.ok(near(c('ssnSAX'),2.5,3.5),'suprasternal short axis: marker to the left');
 assert.ok(near(c('scLVOT'),2.5,3.5),'subcostal coronal sweep keeps 3 o’clock');
});

test('the ductal view is the cut used by the ductus lesson',()=>{
 const lessonPlane=planeThrough({window:'psax',contact:'psaxAV',through:['pulmonaryValve','ductPulmonary'],aim:.5},ctx);
 assert.ok(planeAgreement(lessonPlane,views.ductal).score>=85);
});

test('guided sweeps: valid lessons whose maneuvers match the probe motion between views',()=>{
 for(const sw of SWEEPS){const spec=lessonForSweep(sw.id,ctx);assert.deepEqual(validateLesson(spec,{sources}),[],sw.id);
  let prev=null;for(const st of spec.steps){const from=st.from?resolveState(st.from,ctx):prev,to=st.to?resolveState(st.to,ctx,from):from;
   if(st.maneuver){const r=maneuverAgrees(st.maneuver,from,to);assert.ok(r.ok,`${sw.id}/${st.id}: ${st.maneuver.verb} ${st.maneuver.direction} ${st.maneuver.amount} → ${r.got}`)}prev=to}}
 for(const id of Object.keys(VIEW_INFO))assert.deepEqual(validateLesson(lessonForView(id),{sources}),[],id);
});
