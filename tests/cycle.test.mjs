// Beat timing at the patient's heart rate (cycle.mjs): the AV-closed period follows the paediatric regression, diastole
// absorbs the rest (long diastasis at low rates, E/A fusion at high rates); without a heart rate the canonical beat is kept.
import test from 'node:test';import assert from 'node:assert/strict';
import {setHeartRate,cycleTiming,systolicMs,ventricularContraction,valveOpening,waves,modelPhase} from '../cycle.mjs';

const N=4000,ts=[...Array(N).keys()].map(i=>(i+.5)/N);
test('without a heart rate the canonical valve timing is unchanged',()=>{
 setHeartRate(null);
 const oldAV=t=>{const r=(a,b,c,d)=>t<a||t>d?0:t<b?(t-a)/(b-a):t<c?1:(d-t)/(d-c);return Math.max(r(.38,.44,.52,.64),r(.58,.66,.76,.8)*.45,r(.8,.85,.9,.97)*.8)};
 for(const t of ts)assert.ok(Math.abs(valveOpening(t,'av')-oldAV(t))<1e-9,`t=${t}`);
});
test('the LV changes volume only while a valve is open (isovolumic contraction and relaxation)',()=>{
 for(const hr of [null,70,140]){setHeartRate(hr);let prev=ventricularContraction(ts[0]),still=0,n=0;
  for(const t of ts){const s=ventricularContraction(t),closed=valveOpening(t,'av')===0&&valveOpening(t,'semilunar')===0;if(closed&&t<.6){n++;if(Math.abs(s-prev)<1e-3)still++}prev=s}
  assert.ok(still/n>.97,`${hr} lpm: ${(still/n*100).toFixed(0)}% of the closed-valve samples keep the volume`)}
 setHeartRate(null);
});
test('AV-closed period (isovolumic contraction + ejection + relaxation) follows Sarnari 2009',()=>{
 for(const hr of [60,95,140]){setHeartRate(hr);const rr=60000/hr;let closed=0;for(const t of ts)if(valveOpening(t,'av')<1e-9)closed++;
  const ms=closed/N*rr,want=systolicMs(hr);assert.ok(Math.abs(ms-want)/want<.03,`${hr} lpm: ${ms.toFixed(0)} vs ${want.toFixed(0)} ms`)}
 setHeartRate(null);
});
test('systole takes a larger share of the beat as the rate rises',()=>{
 const f=[60,95,140].map(hr=>cycleTiming(hr).systole/cycleTiming(hr).rr);assert.ok(f[0]<f[1]&&f[1]<f[2],f.join(' '));
 assert.ok(f[2]>.5&&f[0]<.42,f.join(' '));
});
test('diastasis at low rates, E/A fusion at high rates',()=>{
 const inflow=hr=>{setHeartRate(hr);return ts.map(t=>waves.E(t)+waves.A(t))};
 const gapMs=(v,hr)=>{let best=0,run=0;const i0=v.indexOf(Math.max(...v.slice(0,N*.8)));for(let i=i0;i<N;i++){if(v[i]<.02){run++;best=Math.max(best,run)}else run=0}return best/N*60000/hr};
 assert.ok(gapMs(inflow(60),60)>150,'diastasis at 60 lpm');
 setHeartRate(150);const E=ts.map(waves.E),A=ts.map(waves.A),v=inflow(150),eI=E.indexOf(Math.max(...E)),aI=A.indexOf(Math.max(...A)),valley=Math.min(...v.slice(eI,aI));
 assert.ok(cycleTiming(150).fused&&valley>.15,`valley ${valley.toFixed(2)} between E and A at 150 lpm`);
 setHeartRate(null);
});
test('the canonical phase never goes back within a beat',()=>{
 for(const hr of [50,70,100,140,160]){setHeartRate(hr);let prev=-1;for(const t of ts){const m=modelPhase(t);assert.ok(m>=prev-1e-12,`${hr} lpm at ${t}`);prev=m}}
 setHeartRate(null);
});
