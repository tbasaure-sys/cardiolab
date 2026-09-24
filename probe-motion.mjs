// Phone as probe: device orientation → probe pose. Pure math (no DOM): used by the simulator, the phone page and tests.
// The phone is held like a probe with its screen facing the examiner: the screen is the scan plane, the bottom edge
// is the transducer face (the beam leaves through it) and the right edge (portrait) carries the marker.
// Only rotations are sensed; sliding over the chest comes from a touch pad (phones cannot track position).
import {PRESETS,surface,unit,sub,mul,dot,cross} from './geometry.mjs';

const deg=r=>r*180/Math.PI,rad=d=>d*Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mat=(a,b)=>a.map(r=>[0,1,2].map(j=>r[0]*b[0][j]+r[1]*b[1][j]+r[2]*b[2][j]));
const transpose=m=>[0,1,2].map(i=>[0,1,2].map(j=>m[j][i]));
const col=(m,j)=>[m[0][j],m[1][j],m[2][j]];

// W3C deviceorientation (degrees): device frame → earth frame, R = Rz(alpha)·Rx(beta)·Ry(gamma)
export function deviceMatrix(alpha,beta,gamma){
 const [a,b,g]=[alpha||0,beta||0,gamma||0].map(rad),ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
 return mat(mat([[ca,-sa,0],[sa,ca,0],[0,0,1]],[[1,0,0],[0,cb,-sb],[0,sb,cb]]),[[cg,0,sg],[0,1,0],[-sg,0,cg]]);
}
// rotation matrix ⇄ unit quaternion [x,y,z,w], and slerp for smoothing sensor jitter
export function quatFromMatrix(m){const t=m[0][0]+m[1][1]+m[2][2];let x,y,z,w;
 if(t>0){const s=Math.sqrt(t+1)*2;w=s/4;x=(m[2][1]-m[1][2])/s;y=(m[0][2]-m[2][0])/s;z=(m[1][0]-m[0][1])/s}
 else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){const s=Math.sqrt(1+m[0][0]-m[1][1]-m[2][2])*2;w=(m[2][1]-m[1][2])/s;x=s/4;y=(m[0][1]+m[1][0])/s;z=(m[0][2]+m[2][0])/s}
 else if(m[1][1]>m[2][2]){const s=Math.sqrt(1+m[1][1]-m[0][0]-m[2][2])*2;w=(m[0][2]-m[2][0])/s;x=(m[0][1]+m[1][0])/s;y=s/4;z=(m[1][2]+m[2][1])/s}
 else{const s=Math.sqrt(1+m[2][2]-m[0][0]-m[1][1])*2;w=(m[1][0]-m[0][1])/s;x=(m[0][2]+m[2][0])/s;y=(m[1][2]+m[2][1])/s;z=s/4}
 const l=Math.hypot(x,y,z,w);return [x/l,y/l,z/l,w/l]}
export function matrixFromQuat([x,y,z,w]){return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]}
export function slerp(a,b,t){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];if(d<0){b=b.map(v=>-v);d=-d}
 if(d>.9995){const r=a.map((v,i)=>v+(b[i]-v)*t),l=Math.hypot(...r);return r.map(v=>v/l)}
 const th=Math.acos(d),s=Math.sin(th),wa=Math.sin((1-t)*th)/s,wb=Math.sin(t*th)/s;return a.map((v,i)=>v*wa+b[i]*wb)}

// Probe axes after the phone turned from its calibration attitude Rcal to Rnow. At calibration the device axes
// were: x → u (marker), y → −d (the beam leaves through the bottom edge), z → −n (n = u × d).
export function relativeAxes(Rcal,Rnow,base){
 const rel=mat(transpose(Rcal),Rnow),M=v=>[0,1,2].map(i=>base.u[i]*v[0]-base.d[i]*v[1]-base.n[i]*v[2]);
 const u=unit(M(col(rel,0))),d=unit(mul(M(col(rel,1)),-1));return {u,d}}

// Inverse of the angle part of geometry.poseFromState: tilt, rock and rotation (degrees) that give beam d and
// marker u from a window preset. (tilt about the preset's marker axis, rock toward the marker, rotation about the beam)
export const ANGLE_LIMITS={tilt:[-60,60],rock:[-50,50]};
export function anglesFromAxes(preset,d,u){
 const p=PRESETS[preset],base=surface(p.x,p.z);let d0=unit(sub(p.target,base)),u0=unit(sub(p.up,mul(d0,dot(p.up,d0)))),n0=unit(cross(u0,d0));
 const tilt=deg(Math.atan2(dot(d,n0),dot(d,d0))),r=Math.asin(clamp(dot(d,u0),-1,1)),rock=deg(r);
 const t=rad(tilt),d1=[0,1,2].map(i=>d0[i]*Math.cos(t)+n0[i]*Math.sin(t)),u2=[0,1,2].map(i=>u0[i]*Math.cos(r)-d1[i]*Math.sin(r)),d2=[0,1,2].map(i=>d1[i]*Math.cos(r)+u0[i]*Math.sin(r));
 const rotation=deg(Math.atan2(dot(u,cross(d2,u2)),dot(u,u2)));
 return {tilt:clamp(tilt,...ANGLE_LIMITS.tilt),rock:clamp(rock,...ANGLE_LIMITS.rock),rotation:((rotation+540)%360)-180};
}
