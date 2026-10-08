// The lesson engine and the lesson specifications: schema, physical meaning of each maneuver, reachable goals, deterministic
// timeline, alternative routes, cases, sufficiency and the competency map. Uses the reference heart (atlas landmarks).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildViews,VIEW_INFO,solveState} from '../views.mjs';import {poseFromState,defaultState} from '../geometry.mjs';
import {validateLesson,resolveState,compileLesson,seek,maneuverAgrees,evaluateGoal,applyManeuver,physicalDelta,evaluateSufficiency,scoreAttempt,recommend,
 lessonForView,withCase,pickCase,toWebVTT,keyframes,checklist,sourcesFor,lessonContext} from '../lesson-engine.mjs';

const read=f=>JSON.parse(fs.readFileSync(new URL(`../lessons/${f}`,import.meta.url)));
const lm=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url))).landmarks,ctx=lessonContext(lm,buildViews(lm));
const index=read('index.json'),sources=read('sources.json').sources,coverage=read('coverage.json');
const lessons=Object.fromEntries(index.lessons.map(id=>[id,read(`${id}.json`)]));
// walk a lesson as the compiler does: the probe state before and after each step
function walk(spec){let cur=null;return spec.steps.map(st=>{const from=st.from?resolveState(st.from,ctx,cur):cur||resolveState({view:'plax'},ctx);
 const to=st.to?resolveState(st.to,ctx,from):st.maneuver?applyManeuver(from,st.maneuver):from;cur=to;return {st,from,to}})}

test('every lesson validates against the schema and cites known sources',()=>{
 for(const [id,spec] of Object.entries(lessons)){assert.equal(spec.id,id);assert.deepEqual(validateLesson(spec,{sources}),[],id)}
 for(const id of Object.keys(VIEW_INFO))assert.deepEqual(validateLesson(lessonForView(id,{coverage}),{sources}),[],`vista-${id}`);
});

test('each stated maneuver matches the physical change of the probe (sign and size)',()=>{
 let n=0;for(const spec of Object.values(lessons))for(const {st,from,to} of walk(spec))if(st.maneuver){n++;const r=maneuverAgrees(st.maneuver,from,to);assert.ok(r.ok,`${spec.id}/${st.id}: ${st.maneuver.verb} ${st.maneuver.direction} ${st.maneuver.amount} → ${r.got}`)}
 assert.ok(n>=7);
});

test('rotation convention: clockwise seen from the handle takes PLAX to PSAX, counter-clockwise A4C to A2C',()=>{
 assert.ok(physicalDelta(resolveState({view:'plax'},ctx),resolveState({view:'psaxAV'},ctx)).rotation>60);
 assert.ok(physicalDelta(resolveState({view:'a4c'},ctx),resolveState({view:'a2c'},ctx)).rotation<-40);
 const s=defaultState('apical');assert.ok(physicalDelta(s,applyManeuver(s,{verb:'deslizar',direction:'caudal',amount:10})).slide.z<0);
 const t=applyManeuver(s,{verb:'inclinar',direction:'craneal',amount:10});assert.ok(physicalDelta(s,t).beam.craneal>0);
});

test('every goal is met at the state the lesson leads to',()=>{
 for(const spec of Object.values(lessons))for(const {st,to} of walk(spec))if(st.goal){const g=evaluateGoal(st.goal,poseFromState(to),ctx);assert.ok(g.met,`${spec.id}/${st.id}: ${JSON.stringify(g.parts)}`)}
});

test('the shortened apical start really misses the apex and the slide corrects it',()=>{
 const spec=lessons['calidad-apical-acortada'],w=walk(spec),start=w[0].from,goal=spec.steps.find(s=>s.id==='corregir').goal;
 assert.equal(evaluateGoal(goal,poseFromState(start),ctx).met,false);
});

test('goals are route-agnostic: a different probe path to the same plane also passes',()=>{
 const goal=lessons['recorrido-basico'].steps.find(s=>s.id==='a2c').goal;
 // route B: the solver starting from a different probe state (the apical window default, not the A4C reference)
 const routeB=solveState(ctx.views.a2c,'apical',{...resolveState({preset:'apical'},ctx),rotation:-90,tilt:10}).state,direct=resolveState({view:'a2c'},ctx);
 assert.ok(evaluateGoal(goal,poseFromState(direct),ctx).met);assert.ok(evaluateGoal(goal,poseFromState({...direct,...routeB,depth:direct.depth}),ctx).met,'second route');
 // rotating about the central beam keeps only what lies on that beam: an off-centre apex leaves the plane (teaching hint)
 const rotOnly=applyManeuver(resolveState({view:'a4c'},ctx),{verb:'rotar',direction:'antihorario',amount:60});
 assert.equal(evaluateGoal({anchors:['lvApexCavity']},poseFromState(rotOnly),ctx).met,false);
 const ductal=lessons.ductus.steps.find(s=>s.id==='ductal');
 assert.ok(evaluateGoal(ductal.goal,poseFromState(resolveState(ductal.to,ctx)),ctx).met);
});

test('the image presentation does not change the acquired plane',()=>{
 const s=resolveState({view:'a4c'},ctx),a=poseFromState(s),b=poseFromState({...s,orientation:'apex-down',flipUD:true});
 for(const k of ['origin','d','u','n'])assert.deepEqual(a[k],b[k]);
});

test('timeline is deterministic: same spec, seed and time give the same state; seeking back returns the saved state',()=>{
 for(const spec of Object.values(lessons)){const c1=compileLesson(spec,ctx,{seed:7}),c2=compileLesson(JSON.parse(JSON.stringify(spec)),ctx,{seed:7});
  assert.deepEqual(c1,c2);for(const t of [0,1.234,c1.duration/2,c1.duration])assert.deepEqual(seek(c1,t),seek(c2,t));
  const k=keyframes(c1);const mid=seek(c1,k[1].t);seek(c1,k.at(-1).t);assert.deepEqual(seek(c1,k[1].t),mid);
  for(const kf of k){const s=seek(c1,kf.t);assert.equal(s.step,kf.step);assert.equal(s.moving,false)}
 }
});

test('the basic tour and the micro-lessons fit their formats',()=>{
 for(const id of ['calidad-apical-acortada','calidad-dropout-septal','calidad-doppler-alineacion']){const d=compileLesson(lessons[id],ctx).duration;assert.ok(d>=30&&d<=95,`${id} ${d}s`)}
 const vtt=toWebVTT(compileLesson(lessons['recorrido-basico'],ctx));assert.match(vtt,/^WEBVTT\n\n1\n00:00:00\.000 --> /);
 const cl=checklist(lessons.cia);assert.ok(cl.items.length>=5);const so=sourcesFor(lessons.cia,sources);assert.ok(so.sources.every(s=>s.citation));
});

test('cases change the anatomy and the expected answer, not the steps',()=>{
 const spec=lessons['calidad-dropout-septal'],a=withCase(spec,'normal'),b=withCase(spec,'cia');
 assert.equal(a.variant.id,'normal');assert.equal(b.variant.id,'asd2');assert.notEqual(a.steps.find(s=>s.id==='decidir').confirm.answer,b.steps.find(s=>s.id==='decidir').confirm.answer);
 assert.deepEqual(a.steps.map(s=>s.id),b.steps.map(s=>s.id));
 const picks=new Set([1,2,3,4,5,6,7,8].map(s=>pickCase(spec,s)));assert.equal(picks.size,2);assert.equal(pickCase(spec,3),pickCase(spec,3));
 assert.equal(compileLesson(b,ctx).scenes[0].variant.id,'asd2');
});

test('sufficiency reports what is missing instead of passing an incomplete study',()=>{
 const spec=lessons.cia;const empty=evaluateSufficiency(spec,{});assert.equal(empty.sufficient,false);assert.equal(empty.missing.length,spec.sufficiency.criteria.length);assert.ok(empty.message);
 const full={goals:{sc4c:true,scsax:true},answers:{color:{confirm:true}},measures:{colorOn:true},evidence:[{kind:'clip',step:'guardar'}]};
 assert.equal(evaluateSufficiency(spec,full).sufficient,true);
 assert.equal(evaluateSufficiency(spec,{...full,evidence:[{kind:'frame',step:'guardar'}]}).sufficient,false);
 const dop=lessons['calidad-doppler-alineacion'];assert.equal(evaluateSufficiency(dop,{goals:{apical:true},answers:{plax:{predict:true}},evidence:[{kind:'frame',step:'guardar'}],measures:{dopplerAngle:35}}).sufficient,false);
});

test('scores separate acquisition, recognition, reasoning and aids; errors lead to a corrective then a different transfer lesson',()=>{
 const spec=lessons['recorrido-basico'];
 const s=scoreAttempt(spec,{goals:{scsax:true,psaxav:true,a2c:true},showMe:{a2c:true},hints:{scsax:2},answers:{scsax:{confirm:true,predict:true}}});
 assert.equal(s.adquisicion.score,Math.round(100*2/spec.steps.filter(x=>x.goal).length));assert.equal(s.ayudas.hints,2);assert.equal(s.ayudas.showMe,1);assert.ok(s.note);
 const r=recommend({errors:[{competency:'optimizacion'},{competency:'optimizacion'},{competency:'orientacion'}]},index.competencies);
 assert.equal(r[0].competency,'optimizacion');for(const x of r){assert.ok(x.corrective&&x.transfer);assert.notEqual(x.corrective,x.transfer)}
 for(const c of Object.values(index.competencies))for(const id of [...c.corrective,...c.transfer])assert.ok(lessons[id]||id.startsWith('vista-'),id);
});

test('coverage declares pending items and lessons declare their limits',()=>{
 assert.ok(coverage.anatomy.some(a=>a.status==='pendiente')&&coverage.windows.some(w=>w.status==='pendiente'));
 for(const spec of Object.values(lessons)){assert.ok(spec.limits?.length,spec.id);assert.ok(spec.provenance.sources.includes('docencia'),spec.id)}
 for(const s of Object.values(sources))assert.ok(s.supports);
});

test('no scene of any lesson sits on a window blocked by lung or bone (the image would be empty)',async()=>{
 const zlib=await import('node:zlib'),{parseTissue,LABEL}=await import('../tissue.mjs');const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
 const t=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
 const blocked=p=>{let n=0;const sec=p.sector*Math.PI/180;for(let j=0;j<41;j++){const th=-sec/2+sec*(j+.5)/41,b=[0,1,2].map(i=>Math.cos(th)*p.d[i]+Math.sin(th)*p.u[i]);
  for(let r=.003;r<p.depth*.7;r+=.001){const l=t.tissueAt(...[0,1,2].map(i=>p.origin[i]+b[i]*r));if(l===LABEL.LUNG||l===LABEL.BONE){n++;break}}}return n/41};
 for(const spec of Object.values(lessons))for(const s of compileLesson(spec,ctx).scenes){const f=blocked(poseFromState(s.to));assert.ok(f<=.7,`${spec.id}/${s.step}: ${Math.round(f*100)} % de las líneas tapadas`)}
});

test('ductus: the ductal cut, the simulated flow and the text agree with each other and with the cited review',async()=>{
 const {markerClock}=await import('../views.mjs'),{waves}=await import('../flow.mjs');const spec=lessons.ductus;
 // the ductal view is near-sagittal with the marker toward the head (high left parasternal ductal view, van Laere 2018)
 const p=poseFromState(resolveState(spec.steps.find(s=>s.id==='ductal').to,ctx)),h=markerClock(p.u);
 assert.ok(h>=10.5||h<=1.5,`marcador a las ${h.toFixed(1)} h`);assert.ok(Math.abs(p.n[0])>.8,'plano casi sagital');
 // the simulated shunt is aorta→pulmonary in the whole cycle and restrictive (max:min < 2), as the lesson states
 const prof=[...Array(200).keys()].map(i=>.55+.35*waves.S(i/200)+.1*waves.E(i/200)),min=Math.min(...prof),max=Math.max(...prof);
 assert.ok(min>0&&max/min<2,`Vmax:Vmin ${(max/min).toFixed(2)}`);assert.match(spec.provenance.topology,/restrictivo/);
 // the text claims no flow timing the simulator does not produce, and the lesson cannot be passed without the spectral
 // direction and without recognising what is missing before any closure decision
 const text=JSON.stringify(spec.steps);assert.doesNotMatch(text,/final de la sístole/);
 const ids=spec.sufficiency.criteria.map(c=>c.id);for(const id of ['direccion','limites'])assert.ok(ids.includes(id),id);
 assert.match(spec.sufficiency.insufficient,/no basta para valorar su repercusión/);
 assert.equal(sources.vanlaere2018?.fullTextReviewed,true);assert.ok(spec.provenance.sources.includes('vanlaere2018'));
});
