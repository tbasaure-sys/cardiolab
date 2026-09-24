import * as THREE from 'three';
import {scanLayout} from './volume-geometry.mjs';
const vertex=`in vec3 position; in vec2 uv; out vec2 coords; void main(){coords=uv;gl_Position=vec4(position,1.0);}`;
const fragment=`precision highp float;
precision highp sampler3D;
in vec2 coords; out vec4 pixel;
uniform sampler3D volume;
uniform vec3 dimensions, spacing, sourceOrigin, probeOrigin, axisU, axisD;
uniform vec2 viewport, anchor;
uniform float scale, depth, halfSector, gain, contrast;
uniform float tgc[8];
void main(){
 vec2 screen=vec2(coords.x*viewport.x,(1.0-coords.y)*viewport.y);
 vec2 plane=(screen-anchor)/scale;
 float radius=length(plane);
 if(plane.y<0.0||radius>depth||abs(atan(plane.x,plane.y))>halfSector){pixel=vec4(0.0);return;}
 vec3 world=probeOrigin+axisU*plane.x+axisD*plane.y;
 vec3 voxel=(world-sourceOrigin)/spacing;
 if(any(lessThan(voxel,vec3(0.0)))||any(greaterThan(voxel,dimensions-1.0))){pixel=vec4(0.0);return;}
 float raw=texture(volume,(voxel+.5)/dimensions).r;
 float f=clamp(radius/depth,0.0,1.0)*7.0;int i=int(f);
 float band=mix(tgc[i],tgc[min(7,i+1)],fract(f));
 float value=clamp(pow(raw,contrast)*gain*exp2((band-50.0)/25.0),0.0,1.0);
 pixel=vec4(vec3(value),1.0);
}`;
export function createVolumeScan(host,manifest){
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;host.append(renderer.domElement);
 const uniforms={volume:{value:null},dimensions:{value:new THREE.Vector3(...manifest.dimensions)},spacing:{value:new THREE.Vector3(...manifest.spacingMM)},sourceOrigin:{value:new THREE.Vector3(...manifest.originRAS)},probeOrigin:{value:new THREE.Vector3()},axisU:{value:new THREE.Vector3()},axisD:{value:new THREE.Vector3()},viewport:{value:new THREE.Vector2()},anchor:{value:new THREE.Vector2()},scale:{value:1},depth:{value:160},halfSector:{value:1},gain:{value:1},contrast:{value:1},tgc:{value:Array(8).fill(50)}};
 const scene=new THREE.Scene(),camera=new THREE.Camera();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false})));
 let texture=null,layout=null,draws=0;
 function setFrame(data){if(!texture){texture=new THREE.Data3DTexture(data,...manifest.dimensions);texture.format=THREE.RedFormat;texture.type=THREE.UnsignedByteType;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.unpackAlignment=1;uniforms.volume.value=texture}else texture.image.data=data;texture.needsUpdate=true}
 function draw(state,pose){
  if(!texture)return;const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
  if(renderer.domElement.clientWidth!==w||renderer.domElement.width!==Math.floor(w*renderer.getPixelRatio())||renderer.domElement.height!==Math.floor(h*renderer.getPixelRatio()))renderer.setSize(w,h,false);
  layout=scanLayout(w,h,state);uniforms.viewport.value.set(w,h);uniforms.anchor.value.set(layout.cx,layout.cy);uniforms.scale.value=layout.scale;
  uniforms.probeOrigin.value.set(...pose.origin);uniforms.axisU.value.set(...pose.u);uniforms.axisD.value.set(...pose.d);
  uniforms.depth.value=state.depth;uniforms.halfSector.value=state.sector*Math.PI/360;uniforms.gain.value=state.gain;uniforms.contrast.value=state.contrast;uniforms.tgc.value=state.tgc;
  renderer.render(scene,camera);draws++;
 }
 return {renderer,canvas:renderer.domElement,setFrame,draw,layout:()=>layout,draws:()=>draws};
}
