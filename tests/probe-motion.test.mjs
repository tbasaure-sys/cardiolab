import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceMatrix,quatFromMatrix,matrixFromQuat,slerp,relativeAxes,anglesFromAxes} from '../probe-motion.mjs';
import {defaultState,poseFromState,rotate,dot} from '../geometry.mjs';

const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const angDiff=(a,b)=>((a-b+540)%360)-180;
test('anglesFromAxes inverts poseFromState for every window',()=>{
 let seed=7;const rnd=(lo,hi)=>lo+(hi-lo)*((seed=(seed*16807)%2147483647)/2147483647);
 for(const preset of ['plax','psax','apical','subcostal','ssn'])for(let i=0;i<40;i++){
  const s={...defaultState(preset),tilt:rnd(-55,55),rock:rnd(-45,45),rotation:rnd(-179,179)},p=poseFromState(s),a=anglesFromAxes(preset,p.d,p.u);
  close(a.tilt,s.tilt,1e-6);close(a.rock,s.rock,1e-6);close(angDiff(a.rotation,s.rotation),0,1e-6);
 }
});
test('device matrix is a rotation and survives the quaternion round trip',()=>{
 const R=deviceMatrix(30,50,-20),q=quatFromMatrix(R),R2=matrixFromQuat(q);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(R[i][j],R2[i][j],1e-9);
 close(Math.hypot(...R[0]),1,1e-12);close(slerp(q,q,.3).reduce((s,v,i)=>s+v*q[i],0),1,1e-9);
});
test('holding the phone still keeps the calibrated pose; turning it about its long axis rotates the probe about the beam',()=>{
 const base=poseFromState(defaultState('apical')),R=deviceMatrix(10,70,5);
 const same=relativeAxes(R,R,base);for(let i=0;i<3;i++){close(same.u[i],base.u[i]);close(same.d[i],base.d[i])}
 // rotate the phone 20° about its own y axis (the long axis = the probe handle)
 const c=Math.cos(Math.PI/9),s=Math.sin(Math.PI/9),Ry=[[c,0,s],[0,1,0],[-s,0,c]],Rn=R.map(r=>[0,1,2].map(j=>r[0]*Ry[0][j]+r[1]*Ry[1][j]+r[2]*Ry[2][j]));
 const turned=relativeAxes(R,Rn,base);for(let i=0;i<3;i++)close(turned.d[i],base.d[i]);close(dot(turned.u,base.u),c);
 const a0=anglesFromAxes('apical',base.d,base.u),a1=anglesFromAxes('apical',turned.d,turned.u);close(Math.abs(angDiff(a1.rotation,a0.rotation)),20,1e-6);close(a1.tilt,a0.tilt);close(a1.rock,a0.rock);
});
test('turning the phone in its screen plane rocks the beam within the image plane',()=>{
 const base=poseFromState(defaultState('plax')),R=deviceMatrix(0,80,0),c=Math.cos(.2),s=Math.sin(.2),Rz=[[c,-s,0],[s,c,0],[0,0,1]];
 const Rn=R.map(r=>[0,1,2].map(j=>r[0]*Rz[0][j]+r[1]*Rz[1][j]+r[2]*Rz[2][j])),t=relativeAxes(R,Rn,base);
 close(dot(t.d,base.n),0,1e-9); // the beam stays in the image plane
 const a=anglesFromAxes('plax',t.d,t.u);close(Math.abs(a.rock),.2*180/Math.PI,1e-6);close(a.tilt,0,1e-6);
});
