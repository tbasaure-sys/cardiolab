import {sliceMesh,joinContours} from './geometry.mjs';
let meshes=[];
self.onmessage=event=>{
  const msg=event.data;
  if(msg.type==='init') {meshes=msg.meshes;self.postMessage({type:'ready'});return}
  if(msg.type!=='slice')return;
  try{
    const start=performance.now();const cuts=[];
    for(const m of meshes){
      const segments=sliceMesh(m.positions,m.indices,msg.pose);
      if(segments.length)cuts.push({id:m.id,segments,loops:joinContours(segments)});
    }
    self.postMessage({type:'slice',id:msg.id,pose:msg.pose,state:msg.state,cuts,ms:performance.now()-start},cuts.map(c=>c.segments.buffer));
  }catch(error){self.postMessage({type:'error',id:msg.id,message:String(error)})}
};
