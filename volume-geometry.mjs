import {add,mul,sub,dot,cross,unit,rotate,rad} from './geometry.mjs';
// All coordinates in this module are millimetres in the source RAS frame.
export const initialVolumeState=()=>({x:0,y:0,z:0,tilt:0,rock:0,rotation:0,depth:160,sector:80,gain:1,contrast:1,zoom:1,tgc:Array(8).fill(50)});
export function volumePose(state,manifest){
 const target=manifest.targetRAS;
 // Virtual probe above the source volume. This is a teaching pose, not a measured acquisition pose.
 const origin=add([target[0],target[1],target[2]-85],[state.x,state.y,state.z]);
 let u=[1,0,0],d=[0,0,1],n=cross(u,d);
 d=rotate(d,u,rad(state.tilt));n=unit(cross(u,d));
 d=rotate(d,n,rad(state.rock));u=rotate(u,n,rad(state.rock));
 u=unit(rotate(u,d,rad(state.rotation)));d=unit(d);n=unit(cross(u,d));
 return {origin,u,d,n,depth:state.depth,sector:state.sector};
}
export const planePoint=(pose,x,y)=>add(pose.origin,add(mul(pose.u,x),mul(pose.d,y)));
export const planeCoordinates=(pose,point)=>{const q=sub(point,pose.origin);return [dot(q,pose.u),dot(q,pose.d),dot(q,pose.n)]};
export function voxelPoint(point,manifest){return point.map((v,i)=>(v-manifest.originRAS[i])/manifest.spacingMM[i])}
export function sampleTrilinear(data,dims,q){
 if(q.some((v,i)=>v<0||v>dims[i]-1))return null;
 const lo=q.map(Math.floor),hi=lo.map((v,i)=>Math.min(v+1,dims[i]-1)),f=q.map((v,i)=>v-lo[i]);
 let sum=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const ix=x?hi[0]:lo[0],iy=y?hi[1]:lo[1],iz=z?hi[2]:lo[2];
  sum+=data[ix+dims[0]*(iy+dims[1]*iz)]*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);
 }
 return sum;
}
export function frameAtTime(time,times){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<=time)lo=mid+1;else hi=mid}return Math.max(0,lo-1)}
export function scanLayout(width,height,state){const scale=Math.min((width-36)/(2*state.depth*Math.sin(rad(state.sector/2))),(height-46)/state.depth)*state.zoom;return {cx:width/2,cy:23+(height-46)*(1-state.zoom)*.5,scale}}
