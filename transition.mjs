// Transitional circulation: the first hours and weeks of life as a time axis for the teaching shunt model (shunt-model.mjs).
// At birth the pulmonary vascular resistance is high (fetal-like) and falls; the physiological ductus constricts and closes,
// the foramen ovale shunt fades. A shunt lesion therefore changes character with age: a ductus is bidirectional at first and
// left-to-right later; a large VSD is quiet at birth and loud weeks later. Worker-safe, no DOM.
//
// What is sourced and what is a model assumption:
// - Sourced (Shiraishi & Yanagisawa 1991, 25 normal term newborns, serial Doppler colour flow): ductal flow was bidirectional
//   at the first exam (2–7 h) in 19 of 25 and became continuous left-to-right; bidirectional flow could persist up to 24 h;
//   functional closure was earliest at 8 h, 44 % at 24 h, 88 % at 48 h and 100 % at 72 h. → DUCT_CLOSED below, exactly.
// - Sourced, qualitative (Hiraishi et al. 1991): in normal newborns the ductus closes before the foramen ovale; interatrial
//   shunting is predominantly left-to-right and still seen in 47 % on day 4–5.
// - Sourced, qualitative (Lister et al. 1982): the postnatal fall in haematocrit contributes to the fall of pulmonary
//   vascular resistance; large VSD shunts are clinically silent at birth.
// - Model assumption (NOT sourced): the numeric time course of the pulmonary vascular resistance index (WU·m²). It starts at
//   15 (in the model, pulmonary and aortic pressures about equal, as in the fetus: shunts small or bidirectional at birth) and
//   falls in a fast phase (hours) plus a slow one (weeks) to the normal 3.5, chosen so that the model's ductal flow reproduces
//   the sourced timeline above (bidirectional for the first hours, then left-to-right). Teaching values, not reference ranges.
// - Known mismatch: Hiraishi et al. found the atrial shunt already predominantly left-to-right within the first hour; the
//   model's atrial shunt is about zero at hour 0 and left-to-right from the first hours on.
export const TRANSITION_SOURCES=['shiraishi1991','hiraishi1991','lister1982'];
export const HOURS=[0,3,6,12,24,36,48,72,120,168,336,672,1008]; // the steps of the control: birth … 6 weeks
const PVR0=15,PVR_FLOOR=3.5,FAST=8,SLOW=PVR0-PVR_FLOOR-FAST,TAU_FAST=12,TAU_SLOW=300; // hours
export function pvrIndexAt(hours){const h=Math.max(0,hours);return PVR_FLOOR+FAST*Math.exp(-h/TAU_FAST)+SLOW*Math.exp(-h/TAU_SLOW)}
// share of normal term newborns whose ductus is functionally closed by h hours (Shiraishi & Yanagisawa 1991)
export const DUCT_CLOSED=[[0,0],[8,0],[24,.44],[48,.88],[72,1]];
export function ductClosedShare(hours){const t=DUCT_CLOSED;if(hours<=t[0][0])return 0;for(let i=1;i<t.length;i++)if(hours<=t[i][0])return t[i-1][1]+(t[i][1]-t[i-1][1])*(hours-t[i-1][0])/(t[i][0]-t[i-1][0]);return 1}
// the hour at which a newborn at quantile q of the population (0 = earliest, 1 = latest) has its ductus closed
export function ductClosureHour(q=.5){const t=DUCT_CLOSED;q=Math.max(0,Math.min(1,q));for(let i=1;i<t.length;i++)if(q<=t[i][1]){const [h0,f0]=t[i-1],[h1,f1]=t[i];return f1>f0?h0+(h1-h0)*(q-f0)/(f1-f0):h0}return t.at(-1)[0]}
const smooth=x=>x<=0?0:x>=1?1:x*x*(3-2*x);
// fraction of the birth diameter still open at `hours` for an individual that closes at ductClosureHour(q): constriction
// starts a few hours after birth (model assumption) and is complete at the closure hour
export function ductOpenFraction(hours,q=.5){const tc=ductClosureHour(q),t0=Math.min(4,tc*.5);return 1-smooth((hours-t0)/(tc-t0))}
// human text for a number of hours
export function hoursLabel(h){if(h<48)return `${h} h`;if(h<24*14)return `${Math.round(h/24)} días`;return `${Math.round(h/168)} semanas`}
