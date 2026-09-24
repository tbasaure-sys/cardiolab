export class VolumeData {
 constructor(manifest,base='assets/mitral4d/'){this.manifest=manifest;this.base=base;this.compressed=new Map();this.decoded=new Map();this.pending=new Map();this.verified=new Set()}
 async frame(index){
  if(this.decoded.has(index)){const v=this.decoded.get(index);this.decoded.delete(index);this.decoded.set(index,v);return v}
  if(this.pending.has(index))return this.pending.get(index);
  const task=this.load(index).finally(()=>this.pending.delete(index));this.pending.set(index,task);return task;
 }
 async load(index){
  const info=this.manifest.frames[index];if(!info)throw Error('Fase fuera de la secuencia');
  if(!this.compressed.has(index)){const r=await fetch(this.base+info.file);if(!r.ok)throw Error(`No se pudo cargar la fase ${index+1}`);this.compressed.set(index,await r.arrayBuffer())}
  const stream=new Blob([this.compressed.get(index)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer=await new Response(stream).arrayBuffer();if(buffer.byteLength!==info.bytes)throw Error('Volumen incompleto');
  if(!this.verified.has(index)){
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
   if(hash!==info.sha256)throw Error('La fase no coincide con la fuente verificada');this.verified.add(index);
  }
  const data=new Uint8Array(buffer);this.decoded.set(index,data);while(this.decoded.size>5)this.decoded.delete(this.decoded.keys().next().value);return data;
 }
}
