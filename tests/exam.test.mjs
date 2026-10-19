// Structured study (exam-engine.mjs) and error attribution (attribute.mjs): the case is exact, the grading follows the truth,
// the protocol is graded on what was imaged, and every error splits into terms that add up to it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {parseTissue,LABEL} from '../tissue.mjs';import {buildViews,fanObstruction} from '../views.mjs';import {roiAround} from '../flow.mjs';
import {makeCase,gradeExam,siteCoverage,windowsCovered,inColorBox,chordFor,POINTS,SITES,TOL,describeCase,LESION_OPTIONS} from '../exam-engine.mjs';
import {attributeVelocity,attributeSize,chordAtOffset,VELOCITY_TERMS,SIZE_TERMS} from '../attribute.mjs';
import {shuntState} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';import {rng} from '../lesson-engine.mjs';

const meta=JSON.parse(fs.readFileSync(new URL('../assets/tissue.json',import.meta.url)));
const tissue=parseTissue(meta,zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.fine.file}`,import.meta.url))),zlib.gunzipSync(fs.readFileSync(new URL(`../assets/${meta.coarse.file}`,import.meta.url))));
const lm=tissue.landmarks,views=buildViews(lm,fanObstruction(tissue,LABEL.LUNG,LABEL.BONE));
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const sites={asd2:{point:lm.asdSecundum},vsdpm:{point:lm.vsdPerimembranous},vsdm:{point:lm.vsdMuscular},pda:{point:mid(lm.ductAortic,lm.ductPulmonary)}};
const poseOf=t=>({origin:t.origin,u:t.u,d:t.d,n:t.n,depth:t.depth,sector:t.sector||80});
const perfect=c=>({lesion:c.truth.lesion,diameterMM:c.truth.diameterMM,velocity:c.truth.velocity,direction:c.truth.direction,severity:c.truth.severity});

test('a seed makes the same case every time, and the mix covers every lesion, sizes and ages',()=>{
 const a=makeCase(1234),b=makeCase(1234);assert.deepEqual(a.truth,b.truth);assert.equal(a.lesion,b.lesion);
 const seen={},sizes=new Set(),hours=new Set(),pvrs=new Set();
 for(let s=1;s<=400;s++){const c=makeCase(s);seen[c.lesion]=(seen[c.lesion]||0)+1;if(c.lesion!=='normal')sizes.add(c.size);if(c.hours!=null)hours.add(c.hours);if(c.pvr)pvrs.add(c.pvr)}
 for(const k of ['normal','asd2','vsdpm','vsdm','pda'])assert.ok(seen[k]>40,`${k} ${seen[k]}`);
 assert.ok(sizes.size>8);assert.ok(hours.size>=6,`hours ${[...hours]}`);assert.ok(pvrs.has('elevada')&&pvrs.has('suprasistemica'));
 assert.notDeepEqual(makeCase(1).truth,makeCase(2).truth);
});
test('the truth is the model state, not a copy that can drift: size, velocity, direction and severity',()=>{
 for(let s=1;s<=60;s++){const c=makeCase(s),T=c.truth;
  if(c.lesion==='normal'){assert.equal(T.diameterMM,0);assert.equal(T.velocity,0);assert.equal(T.direction,'sin cortocircuito');assert.equal(T.severity,'none');continue}
  const st=shuntState({lesion:c.lesion,size:c.size,pvr:c.pvr||'normal',patient:PATIENT_BY_ID[c.patientId],hours:c.hours,closing:c.closing});
  assert.equal(T.diameterMM,st.defect.diameterMM);assert.equal(T.direction,st.flows.direction);assert.equal(T.severity,st.grade.key);assert.ok(Math.abs(T.velocity-Math.max(Math.abs(st.jet.sys),Math.abs(st.jet.dia)))<1e-12);
  if(c.patientId==='neonate')assert.ok(c.hours!=null&&c.pvr==null);else assert.equal(c.hours,null)}
});
test('the description of a case shows the patient and vitals but not the diagnosis',()=>{
 const d=describeCase(makeCase(7));assert.ok(d.patient&&d.weightKg>0&&d.hr>0&&d.sbp>d.dbp);assert.ok(!('lesion' in d)&&!('truth' in d)&&!('size' in d));
 assert.ok(LESION_OPTIONS.some(o=>o.id==='normal'));
});
test('a perfect report on a good study scores everything; each wrong answer costs exactly its points',()=>{
 // a case with a defect and a study that images all four sites with colour
 const c=[...Array(200).keys()].map(i=>makeCase(i+1)).find(x=>x.lesion==='vsdpm'&&x.truth.severity!=='reverse');
 const roiFor=(pose,p)=>roiAround(pose,p);
 const acqs=[];for(const [vid,id] of [['plax','vsdpm'],['a4c','vsdm'],['sc4c','asd2'],['psaxAV','pda']]){const pose=poseOf(views[vid]);acqs.push({kind:'image',pose,color:{on:true,roi:roiFor(pose,sites[id].point)}})}
 const full=gradeExam(c,perfect(c),acqs,sites,views);
 assert.equal(full.items.find(i=>i.id==='lesion').pts,POINTS.lesion);for(const k of ['size','velocity','direction','severity'])assert.equal(full.items.find(i=>i.id===k).pts,POINTS[k],k);
 assert.equal(full.items.find(i=>i.id==='windows').pts,POINTS.windows);
 const wrong=gradeExam(c,{...perfect(c),lesion:'asd2'},acqs,sites,views);assert.ok(wrong.total<full.total);assert.equal(wrong.items.find(i=>i.id==='lesion').pts,0);
 const near=gradeExam(c,{...perfect(c),lesion:'vsdm'},acqs,sites,views);assert.equal(near.items.find(i=>i.id==='lesion').pts,POINTS.lesion*.4,'same level, other defect');
 const none=gradeExam(c,{lesion:'normal'},[],sites,views);assert.ok(none.percent<15,`${none.percent}`);
});
test('numeric answers are graded in bands of their tolerance',()=>{
 const c=[...Array(200).keys()].map(i=>makeCase(i+1)).find(x=>x.lesion==='asd2');const T=c.truth,tol=TOL.size(T.diameterMM);
 const pts=d=>gradeExam(c,{...perfect(c),diameterMM:T.diameterMM+d},[],sites,views).items.find(i=>i.id==='size').pts;
 assert.equal(pts(tol*.99),POINTS.size);assert.equal(pts(-tol*.99),POINTS.size);assert.equal(pts(tol*1.5),POINTS.size/2);assert.equal(pts(tol*2.5),0);
 assert.equal(gradeExam(c,{lesion:c.truth.lesion},[],sites,views).items.find(i=>i.id==='size').pts,0,'no answer, no points');
});
test('a normal heart: the diagnosis is the whole report, and inventing a size or a direction costs points',()=>{
 const c=[...Array(200).keys()].map(i=>makeCase(i+1)).find(x=>x.lesion==='normal');
 const ok=gradeExam(c,{lesion:'normal'},[],sites,views),inv=gradeExam(c,{lesion:'normal',diameterMM:6,direction:'izquierda → derecha'},[],sites,views);
 assert.equal(ok.items.find(i=>i.id==='lesion').pts,POINTS.lesion);assert.ok(inv.total<ok.total);
 assert.equal(gradeExam(c,{lesion:'vsdpm',diameterMM:5},[],sites,views).items.find(i=>i.id==='lesion').pts,0);
});
test('the protocol is graded on what was imaged: the plane has to pass through the site and the colour box has to cover it',()=>{
 const p=poseOf(views.sc4c),point=sites.asd2.point,roi=roiAround(p,point);
 assert.ok(inColorBox(p,point,roi));assert.ok(!inColorBox(p,point,{...roi,center:roi.center+40}));assert.ok(!inColorBox(p,point,null));
 const cov=a=>siteCoverage(a,sites).find(s=>s.id==='asd2');
 assert.equal(cov([{kind:'image',pose:p,color:{on:true,roi}}]).ok,true);
 const noColor=cov([{kind:'image',pose:p,color:{on:false,roi}}]);assert.equal(noColor.ok,false);assert.equal(noColor.inPlane,true);assert.equal(noColor.colour,false);
 const off={...p,origin:p.origin.map((v,i)=>v+p.n[i]*.02)};assert.equal(cov([{kind:'image',pose:off,color:{on:true,roi}}]).ok,false);
 assert.equal(cov([]).ok,false);
 assert.deepEqual(windowsCovered([{kind:'image',pose:p}],views).windows,['subcostal']);
 const w=windowsCovered([plaxPose(),{kind:'image',pose:poseOf(views.a4c)},{kind:'image',pose:p},{kind:'doppler',pose:p}],views);assert.equal(w.windows.length,3);
 function plaxPose(){return {kind:'image',pose:poseOf(views.plax)}}
});
test('chord of a plane through the defect: the full diameter at the centre, shorter off it, zero past the edge',()=>{
 const c=[...Array(200).keys()].map(i=>makeCase(i+1)).find(x=>x.lesion==='asd2'&&x.size>=.5);const T=c.truth,p=poseOf(views.sc4c);
 const centre=lm.asdSecundum;
 const onPlane={...p,origin:centre.map((v,i)=>v-(p.u[i]*0+p.n[i]*0))},shifted=(d)=>({...onPlane,origin:onPlane.origin.map((v,i)=>v+onPlane.n[i]*d)});
 assert.ok(Math.abs(chordFor(c,onPlane,centre).chordMM-T.diameterMM)<1e-6);
 const half=chordFor(c,shifted(T.radiusAtlas*.6),centre);assert.ok(half.chordMM<T.diameterMM&&Math.abs(half.chordMM-T.diameterMM*.8)<1e-6,`${half.chordMM}`);assert.ok(Math.abs(half.offMM-T.radiusAtlas*.6*1000*T.k)<.2);
 assert.equal(chordFor(c,shifted(T.radiusAtlas*1.2),centre).chordMM,0);
 assert.equal(chordAtOffset(5,0),10);assert.equal(chordAtOffset(5,3),8);assert.equal(chordAtOffset(5,6),0);
});

// ---------------------------------------------------------------- attribution
test('velocity error: the terms add up to the error exactly, whatever the numbers',()=>{
 const r=rng(99);for(let i=0;i<500;i++){
  const truth=1+4*r(),pG=truth*(.9+.1*r()),pA=pG*(.9+.1*r()),pS=pA*(.4+.6*r()),ceiling=pS*(.5+1.5*r()),reported=pS*(.6+.6*r());
  const a=attributeVelocity({truth,reported,peakStudent:pS,peakAimed:pA,peakGated:pG,ceiling});
  assert.ok(a.exact,`sum ${a.sum} error ${a.error}`);assert.ok(Math.abs(a.error-(reported-truth))<1e-12);assert.deepEqual(a.rows.map(x=>x.id),VELOCITY_TERMS.map(x=>x.id));
  const by=Object.fromEntries(a.rows.map(x=>[x.id,x.value]));assert.ok(by.angle<=1e-12,'a bad angle only ever lowers the velocity');assert.ok(by.scale<=1e-12);assert.ok(by.gate<=1e-12)}
});
test('velocity error: each cause shows up in its own term',()=>{
 const base={truth:3,reported:3,peakStudent:3,peakAimed:3,peakGated:3,ceiling:6};const t=a=>Object.fromEntries(attributeVelocity(a).rows.map(x=>[x.id,x.value]));
 assert.deepEqual(Object.values(t(base)).map(v=>Math.abs(v)<1e-12),[true,true,true,true,true]);
 // beam 40° off the jet: cos 40° = .766 of 3 m/s, found again by aiming
 const ang=t({...base,peakStudent:3*Math.cos(40*Math.PI/180),reported:3*Math.cos(40*Math.PI/180)});assert.ok(Math.abs(ang.angle+3*(1-Math.cos(40*Math.PI/180)))<1e-9);assert.ok(Math.abs(ang.cursor)<1e-12&&Math.abs(ang.scale)<1e-12&&Math.abs(ang.gate)<1e-12);
 // PW at Nyquist 1.2 m/s on a 3 m/s jet
 const al=attributeVelocity({...base,reported:1.2,ceiling:1.2});assert.equal(al.rows.find(x=>x.id==='scale').value,-1.8);assert.equal(al.main,'scale');
 // sample volume off the jet
 const g=attributeVelocity({...base,peakStudent:1,peakAimed:1.2,reported:1});assert.equal(g.rows.find(x=>x.id==='gate').value,1.2-3);
 const cur=attributeVelocity({...base,reported:2.4});assert.equal(cur.main,'cursor');
 assert.equal(attributeVelocity(base).main,null);
});
test('size error: plane and caliper add up to the error; a plane through the centre has no plane term',()=>{
 const a=attributeSize({truthMM:8,chordMM:6.4,measuredMM:7.3});assert.ok(a.exact);assert.ok(Math.abs(a.rows[0].value+1.6)<1e-12&&Math.abs(a.rows[1].value-.9)<1e-12);assert.equal(a.main,'plane');
 const b=attributeSize({truthMM:8,chordMM:8,measuredMM:6});assert.equal(b.rows[0].value,0);assert.equal(b.main,'caliper');assert.deepEqual(b.rows.map(x=>x.id),SIZE_TERMS.map(x=>x.id));
 assert.equal(attributeSize({truthMM:8,chordMM:8,measuredMM:8}).main,null);
 for(const t of [...VELOCITY_TERMS,...SIZE_TERMS])assert.ok(t.hint.length>20&&t.label);
});
test('the sites are the four places a pediatric study interrogates',()=>{assert.deepEqual(Object.keys(SITES).sort(),['asd2','pda','vsdm','vsdpm'])});
