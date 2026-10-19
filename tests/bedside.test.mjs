// Bedside instruments of the virtual patient (bedside.mjs): murmur, sounds, saturations and ECG all come from the same state,
// and follow the qualitative findings of the sources (Spicer 2014 for the VSD, Muta 2003 for the ASD, Tsao 2023 for the screen).
import test from 'node:test';import assert from 'node:assert/strict';
import {shuntState} from '../shunt-model.mjs';import {PATIENT_BY_ID} from '../patient.mjs';
import {auscultation,synthPhonocardiogram,rmsBetween,saturations,ecgLeads,bedside,SCREEN} from '../bedside.mjs';
const child=PATIENT_BY_ID.child,neo=PATIENT_BY_ID.neonate,S=(o,p=child)=>shuntState({patient:p,...o});

test('no defect: normal sounds, no murmur, normal saturations, no overload on the ECG',()=>{
 const s=S({lesion:'vsdpm',size:0}),b=bedside(s,95);assert.equal(b.auscultation.murmur.grade,0);assert.equal(b.auscultation.murmur.kind,'ninguno');
 assert.equal(b.auscultation.single,false);assert.equal(b.auscultation.fixed,false);assert.equal(b.saturation.positive,false);assert.equal(b.ecg.findings[0].id,'normal');
});
test('VSD, large defect with low resistance: harsh holosystolic murmur, mitral rumble, both components of S2',()=>{
 const a=auscultation(S({lesion:'vsdpm',size:1,pvr:'normal'}),95),kinds=a.murmur.components.map(c=>c.kind);
 assert.ok(kinds.includes('holosistólico'),kinds.join());assert.ok(kinds.includes('retumbo diastólico mitral'),kinds.join());assert.ok(a.murmur.grade>=3,`grade ${a.murmur.grade}`);
 assert.equal(a.single,false);assert.ok(a.sounds.some(x=>x.id==='P2'));
});
test('VSD with raised pulmonary resistance: loud single S2 and no murmur (Spicer 2014)',()=>{
 const a=auscultation(S({lesion:'vsdpm',size:1,pvr:'suprasistemica'}),95);assert.equal(a.single,true);assert.ok(a.murmur.grade<=1,`grade ${a.murmur.grade}`);
 assert.ok(a.sounds.find(x=>x.id==='A2').amp>1,'one loud component');
});
test('a small restrictive VSD has a louder, higher-pitched murmur than the large one',()=>{
 const small=auscultation(S({lesion:'vsdpm',size:.3}),95),large=auscultation(S({lesion:'vsdpm',size:1}),95);
 assert.ok(small.murmur.grade>=large.murmur.grade-0,`${small.murmur.grade} vs ${large.murmur.grade}`);assert.ok(small.murmur.pitch>large.murmur.pitch,`${small.murmur.pitch} vs ${large.murmur.pitch}`);
 assert.ok(small.murmur.components.some(c=>c.kind==='holosistólico'));
});
test('ASD: ejection murmur from flow, fixed wide split S2, incomplete RBBB (Muta 2003)',()=>{
 const s=S({lesion:'asd2',size:.9}),a=auscultation(s,95),e=ecgLeads(s,95);
 assert.ok(a.murmur.components.some(c=>c.kind.startsWith('eyectivo')),JSON.stringify(a.murmur.components));assert.equal(a.fixed,true);assert.ok(a.split>40);
 assert.ok(!a.murmur.components.some(c=>c.kind==='holosistólico'));assert.ok(e.findings.some(f=>f.id==='rsr'),JSON.stringify(e.findings.map(f=>f.id)));
});
test('PDA: continuous murmur; bidirectional flow: soft and systolic; right-to-left all the cycle: none',()=>{
 const a=auscultation(S({lesion:'pda',size:.6}),95),rr=a.rr,wave=synthPhonocardiogram(a);
 assert.equal(a.murmur.kind,'continuo');const sys=rmsBetween(wave,rr,150,rr*.35),dia=rmsBetween(wave,rr,rr*.55,rr*.85);assert.ok(dia>.35*sys,`diastolic ${dia.toFixed(3)} vs systolic ${sys.toFixed(3)}`);
 const early=auscultation(S({lesion:'pda',size:.35,hours:3},neo),140);assert.equal(early.murmur.kind,'sistólico suave');assert.ok(early.murmur.grade<=1,`grade ${early.murmur.grade}`);
 const ppHn=auscultation(S({lesion:'pda',size:1,pvr:'suprasistemica'},neo),140);assert.ok(ppHn.murmur.grade<=1,`grade ${ppHn.murmur.grade}`);assert.notEqual(ppHn.murmur.kind,'continuo');
 const late=auscultation(S({lesion:'pda',size:.35,hours:48},neo),140);assert.equal(late.murmur.kind,'continuo','left-to-right all the cycle once the resistance has fallen');
});
test('the murmur synthesised from the envelope sits where the envelope is',()=>{
 const a=auscultation(S({lesion:'vsdpm',size:.4}),95),w=synthPhonocardiogram(a),rr=a.rr,T=a.sounds;
 const sys=rmsBetween(w,rr,T[0].t+60,T[1].t-30),dia=rmsBetween(w,rr,rr*.62,rr*.9);assert.ok(sys>3*dia,`systole ${sys.toFixed(3)} vs diastole ${dia.toFixed(3)}`);
 assert.deepEqual(Array.from(w.slice(0,200)),Array.from(synthPhonocardiogram(a).slice(0,200)),'deterministic');
});
test('saturations: left-to-right lesions are normal; ductal right-to-left lowers only the foot; intracardiac lowers both',()=>{
 const ltr=saturations(S({lesion:'vsdpm',size:.7}));assert.equal(ltr.pre,ltr.post);assert.equal(ltr.positive,false);
 const duct=saturations(S({lesion:'pda',size:1,pvr:'suprasistemica'},neo));assert.ok(duct.diff>SCREEN.diffPct,`diff ${duct.diff.toFixed(1)}`);assert.equal(duct.pre,98);assert.equal(duct.positive,true);assert.equal(duct.site,'ductal');
 const eis=saturations(S({lesion:'vsdpm',size:1,pvr:'suprasistemica'}));assert.ok(Math.abs(eis.pre-eis.post)<1e-9);assert.ok(eis.pre<98,`${eis.pre}`);assert.equal(eis.site,'intracardiaco');
});
test('saturations follow the hours of life: a persistent ductus is bidirectional early and screens negative from the first day',()=>{
 const at=h=>saturations(S({lesion:'pda',size:.8,hours:h},neo));assert.ok(at(0).diff>=at(24).diff);assert.equal(at(24).positive,false);assert.ok(at(24).diff<.5);
});
test('ECG: right pressure load, right volume load and left volume load leave their marks',()=>{
 const rvh=ecgLeads(S({lesion:'vsdpm',size:1,pvr:'suprasistemica'}),95);assert.ok(rvh.findings.some(f=>f.id==='rvh'));
 const lvh=ecgLeads(S({lesion:'vsdpm',size:1,pvr:'normal'}),95);assert.ok(lvh.findings.some(f=>f.id==='lvh'));
 const norm=ecgLeads(S({lesion:'vsdpm',size:0}),95),rmax=a=>Math.max(...a);
 assert.ok(rmax(lvh.V6)>1.3*rmax(norm.V6),'taller R in V6');assert.ok(rmax(rvh.V1)>1.5*rmax(norm.V1),'taller R in V1');
 const asd=ecgLeads(S({lesion:'asd2',size:1}),95);const v=asd.V1,iS=v.indexOf(Math.min(...v.slice(0,60))),rp=Math.max(...v.slice(iS+5,iS+60)),r0=Math.max(...v.slice(0,iS));assert.ok(rp>.35&&rp>r0,`rsR′: r ${r0.toFixed(2)}, R′ ${rp.toFixed(2)} after the S wave`);
 const n0=ecgLeads(S({lesion:'asd2',size:0}),95),nv=n0.V1,nS=nv.indexOf(Math.min(...nv.slice(0,60)));assert.ok(Math.max(...nv.slice(nS+5,nS+60))<.15,'no R′ in a normal heart');
});
test('one state, one patient: the bedside follows the heart rate (sounds move with the cycle)',()=>{
 const s=S({lesion:'vsdpm',size:.5}),slow=auscultation(s,60),fast=auscultation(s,150);assert.ok(slow.rr>fast.rr);
 assert.ok(slow.sounds[1].t>fast.sounds[1].t,'S2 comes earlier in absolute time at a high rate');assert.ok(fast.sounds[1].t/fast.rr>slow.sounds[1].t/slow.rr,'but later as a share of the beat');
});
