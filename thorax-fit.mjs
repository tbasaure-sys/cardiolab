// The thorax fitted to the heart. The atlas is an adult scanned supine in inspiration: its heart hangs in the middle of a
// wide chest, 4–5 cm behind the anterior wall at the apex, so every window looks at it from too far. Patients are examined
// lying on their left side (the heart falls against the chest wall), and a newborn's heart fills more of its chest than an
// adult's. Instead of moving the heart (valves, flow and motion are defined on it), the THORAX is moved: every point outside
// the heart's envelope slides along the ray from the heart's centre,
//     r' = R(dir) + (r − R(dir)) · c(dir),   c(dir) = cap(dir) · age
// so skin, ribs, lung and liver come closer and nothing inside the envelope changes. Exactly invertible, continuous.
//  · R(dir): the envelope of heart and great vessels seen from the heart's centre (thorax-fit-data.mjs, generated from the
//    tissue volume by tools/build-thorax-fit.mjs).
//  · cap(dir) ≤ 1 — a teaching choice of this simulator (no source): in front of the heart, between the costal margin and
//    the second space, the gap between heart and skin is brought down to the one the atlas already has at the left sternal
//    border (CAP_GAP), i.e. the heart lies against the anterior wall as in left lateral decubitus.
//  · age ≤ 1 — the whole thorax, so that the frontal cardiothoracic ratio is the published one for the age:
//    newborn, normal range 43.2–56.5 % on supine AP films (Edwards 1981) → its midpoint; the atlas itself measures 0.45
//    (cxr.mjs). Between one month and two years the target is interpolated (teaching model, no source).
// Worker-safe, no DOM, no imports from the anatomy (the tables are data).
import {FIT_DATA} from './thorax-fit-data.mjs';

export const FIT_SOURCES=['edwards1981'];
export const CAP_GAP=FIT_DATA.capGap; // metres (atlas): the heart-to-skin gap the cap allows in front of the heart
export const NEWBORN_CTR={low:.432,high:.565,mid:(.432+.565)/2}; // Edwards 1981, chest width at the inner margins of the eighth ribs
export const ATLAS_CTR=FIT_DATA.atlas.ctr;
// cardiothoracic ratio the model aims at, by age in years
export function ctrTarget(ageYears){
 const m=Math.max(1,ageYears*12),w=m<=1?1:m>=24?0:1-Math.log(m)/Math.log(24);
 return ATLAS_CTR+(NEWBORN_CTR.mid-ATLAS_CTR)*w;
}
// thorax factor that gives a cardiothoracic ratio: the heart keeps its width, the chest outside it shrinks by `age`
export function ageFactor(ctr){const {heartWidth:h,thoraxWidth:t}=FIT_DATA.atlas;return Math.max(.5,Math.min(1,(h/ctr-h)/(t-h)))}
export const fitAgeFor=ageYears=>+ageFactor(ctrTarget(ageYears)).toFixed(3);
// Thymus of the infant (tissue.mjs draws it): how much of its bed it fills. Full in the first year; from then to six
// years it shrinks to nothing IN THIS MODEL — a teaching choice (the gland persists through childhood, relatively smaller).
// Its echo pattern follows Han 2001; in small children it can lie against the anterior chest wall (Terboven 2019).
export const THYMUS_SOURCES=['han2001','terboven2019'];
export const thymusFor=ageYears=>ageYears<=1?1:ageYears>=6?0:+((6-ageYears)/5).toFixed(2);
// everything about the body that depends on the patient's age: {fit: thorax factor, thymus: 0…1, key}
export function bodyFor(ageYears){const fit=fitAgeFor(ageYears),thymus=thymusFor(ageYears);return {fit,thymus,key:`${fit}|${thymus}`}}

const NR=FIT_DATA.rows,NC=FIT_DATA.cols,C=FIT_DATA.centre,ENV=Float32Array.from(FIT_DATA.envelopeMM,v=>v/1000),CAP=Float32Array.from(FIT_DATA.capPermil,v=>v/1000);
// direction → table coordinates: polar angle from +x (patient's left), azimuth around x; bilinear, wrapped in azimuth
const S=[0,0,0,0,0,0];
function cell(x,y,z,r){
 const ft=Math.max(0,Math.min(NR-1,Math.acos(Math.max(-1,Math.min(1,x/r)))/Math.PI*NR-.5)),i0=Math.min(NR-2,Math.floor(ft)),tt=ft-i0;
 let fp=(Math.atan2(z,y)/(2*Math.PI)+.5)*NC-.5;if(fp<0)fp+=NC;const j0=Math.floor(fp)%NC,j1=(j0+1)%NC,tp=fp-Math.floor(fp);
 S[0]=i0*NC+j0;S[1]=i0*NC+j1;S[2]=(i0+1)*NC+j0;S[3]=(i0+1)*NC+j1;S[4]=tt;S[5]=tp;
}
const at=T=>(T[S[0]]*(1-S[5])+T[S[1]]*S[5])*(1-S[4])+(T[S[2]]*(1-S[5])+T[S[3]]*S[5])*S[4];
export function envelopeRadius(dir){const r=Math.hypot(dir[0],dir[1],dir[2]);cell(dir[0],dir[1],dir[2],r);return at(ENV)}
export function capFactor(dir){const r=Math.hypot(dir[0],dir[1],dir[2]);cell(dir[0],dir[1],dir[2],r);return at(CAP)}
// age: thorax factor (1 = adult atlas); cap: false leaves the anterior gap of the atlas untouched
export function createFit(age=1,{cap=true}={}){
 const A=Math.max(.5,Math.min(1,age));
 const map=(p,out,inv)=>{const x=p[0]-C[0],y=p[1]-C[1],z=p[2]-C[2],r=Math.hypot(x,y,z);
  if(r>1e-6){cell(x,y,z,r);const R=at(ENV);if(r>R){const c=(cap?at(CAP):1)*A,m=(R+(inv?(r-R)/c:(r-R)*c))/r;out[0]=C[0]+x*m;out[1]=C[1]+y*m;out[2]=C[2]+z*m;return out}}
  out[0]=p[0];out[1]=p[1];out[2]=p[2];return out};
 return {age:A,cap,centre:C,
  // reference (atlas) point → where it is in the fitted thorax
  forward:(p,out=[0,0,0])=>map(p,out,false),
  // point of the fitted thorax → the atlas point found there
  inverse:(p,out=[0,0,0])=>map(p,out,true)};
}
