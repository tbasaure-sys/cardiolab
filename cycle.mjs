// Cardiac cycle timing at the patient's heart rate. Worker-safe, no DOM.
// The motion, valve and flow models are drawn on one canonical beat (phase 0 = QRS, AV valves closed from 0.97 to 0.38).
// A real beat does not scale uniformly with the rate: in children the AV-valve-closed period (isovolumic contraction +
// ejection + isovolumic relaxation) shortens only a little as the heart rate rises, systolic ms = 500.05 − 1.9228·FC
// (Sarnari et al. 2009, 179 children 50–156 lpm, Doppler of trivial tricuspid regurgitation), while diastole absorbs the
// rest (the abstract prints the slope without its sign; it is described as a linear decrease, r = −0.85, and only the
// negative slope reproduces the published range of 208–467 ms). So the canonical events after the QRS (systole, relaxation, early filling E) run on an «early» clock anchored to
// the QRS, and the atrial events (A wave, atrial kick, P wave) on a «late» clock anchored to the next QRS; both scaled so
// that the AV-closed period lasts what the regression gives. Diastasis is what is left between the two: at low rates it
// is long, at high rates it vanishes and E and A overlap (fusion), as in infants.
// Model assumption (not sourced): the filling events (early filling E from mitral opening, atrial contraction A) shorten less
// than systole — their durations scale with the square root of the systolic factor — so that at newborn rates E and A overlap
// visibly (≈35 ms at 160 lpm), at 95 lpm a short diastasis remains (≈35 ms) and at 60 lpm it is long (≈300 ms).
export const CYCLE_SOURCES=['sarnari2009'];
const R=60000/90,AVO=.38,AVC=.97; // the canonical beat was drawn at 90 lpm; AV valves closed from 0.97 to 1.38
const wrap=t=>((t%1)+1)%1;
export const HR_RANGE=[50,160];
export function systolicMs(hr){return 500.05-1.9228*hr} // Sarnari 2009 (regression; valid about 50–156 lpm)
export function cycleTiming(hr){
 const h=Math.max(HR_RANGE[0],Math.min(HR_RANGE[1],hr)),rr=60000/h,S=systolicMs(h);
 // systolic factor f (QRS → mitral opening) and filling factor √f (E after mitral opening, A before the QRS); the AV-closed
 // period (0.97 → 1.38) = (1 − AVC)·R·√f + AVO·R·f = S, solved for x = √f
 const a=AVO*R,b=(1-AVC)*R,x=(-b+Math.sqrt(b*b+4*a*S))/(2*a),f=x*x,fd=x,t1=AVO*R*f;
 // ms after the QRS → canonical phase: «early» (systole, relaxation, E), «late» (A, anchored to the next QRS)
 const earlyMs=ms=>ms<=t1?ms/(R*f):AVO+(ms-t1)/(R*fd),lateMs=ms=>1-(rr-ms)/(R*fd);
 const early=t=>earlyMs(t*rr),late=t=>lateMs(t*rr);
 const inv={early:m=>m<=AVO?m*R*f:t1+(m-AVO)*R*fd,late:m=>rr-(1-m)*R*fd}; // canonical phase → ms after the QRS
 const ev={avClose:0,slOpen:inv.early(.07),slClose:inv.early(.33),avOpen:inv.early(AVO),eEnd:inv.early(.635),aStart:inv.late(.82),aEnd:inv.late(AVC),
  ePeak:inv.early(.465),aPeak:inv.late(.885)};
 return {hr:h,rr,systole:S,diastole:rr-S,f,fd,early,late,events:ev,diastasis:ev.aStart-ev.eEnd,fused:ev.aStart<ev.eEnd};
}
let current=null;
// the clock the model functions below use (null = canonical beat, phase as given)
export function setHeartRate(hr){current=hr?cycleTiming(hr):null;return current}
export function currentTiming(){return current}
// run fn with the clock at another heart rate (figures of other rates on the main thread), then restore it
export function withHeartRate(hr,fn){const prev=current;current=hr?cycleTiming(hr):null;try{return fn()}finally{current=prev}}
export function earlyPhase(t){t=wrap(t);return current?current.early(t):t}
export function latePhase(t){t=wrap(t);return current?current.late(t):t}
// one canonical phase for events that are not E or A (systole, relaxation): early clock until early filling is over,
// then held during diastasis and continued on the late clock (never goes back)
export function modelPhase(t){t=wrap(t);if(!current)return t;const e=current.early(t);return e<.64?e:Math.max(.64,current.late(t))}

// canonical wave shapes (model phase): fast acceleration, slower deceleration (E deceleration ≈ 140 ms at 90 lpm)
const asym=(t,a,p,b)=>{if(t<=a||t>=b)return 0;return t<p?Math.sin(Math.PI/2*(t-a)/(p-a))**2:Math.cos(Math.PI/2*(t-p)/(b-p))**1.6};
export const shapes={E:t=>asym(t,.395,.465,.635),A:t=>asym(t,.82,.885,.97),S:t=>asym(t,.06,.15,.34)};
// waves at the current heart rate (t = fraction of the R–R interval)
export const waves={E:t=>shapes.E(earlyPhase(t)),A:t=>shapes.A(latePhase(t)),S:t=>shapes.S(earlyPhase(t))};

// LV contraction (0 at end-diastole, 1 at end-systole; slightly negative with the atrial kick). The cavity changes only
// while a valve is open: still during isovolumic contraction (QRS → aortic opening at 0.05–0.09) and isovolumic
// relaxation (aortic closure at 0.30–0.35 → mitral opening at 0.38–0.44); ejection from 0.07 to 0.33, then rapid filling.
export function ventricularContraction(t){
 const e=earlyPhase(t),l=latePhase(t);
 const s=e<.07?0:e<.34?Math.sin(Math.PI/2*(e-.07)/.27)**2:e<.40?1:e<.60?Math.cos(Math.PI/2*(e-.40)/.20)**2:0;
 const kick=l>.8&&l<.97?-.12*Math.sin(Math.PI*(l-.8)/.17):0;return Math.max(-.15,s+kick);
}
const ramp=(t,a,b,c,d)=>t<a||t>d?0:t<b?(t-a)/(b-a):t<c?1:(d-t)/(d-c),clamp=x=>Math.max(0,Math.min(1,x));
export function valveOpening(t,kind){
 const e=earlyPhase(t),l=latePhase(t);
 if(kind==='semilunar')return ramp(e,.05,.09,.30,.35);
 // AV valves: E wave, partial closure in diastasis, A wave
 return Math.max(ramp(e,.38,.44,.52,.64),.45*Math.min(clamp((e-.58)/.08),clamp((.8-l)/.04)),.8*ramp(l,.8,.85,.9,.97));
}
// ECG (arbitrary units): P on the late clock, QRS at the R–R boundary, T on the early clock
export function ecgValue(t){
 t=wrap(t);const e=earlyPhase(t),l=latePhase(t),q=t<.5?e:l-1,g=(x,c,w,a)=>{const d=x-c;return a*Math.exp(-d*d/(2*w*w))};
 return g(l,.9,.022,.13)+g(q,-.014,.005,-.12)+g(q,0,.007,1)+g(q,.018,.007,-.28)+g(e,.3,.04,.26);
}
