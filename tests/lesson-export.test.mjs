// Packaging of the exported micro-lesson (pure parts, no browser): CRC-32, stored ZIP and the WebM container.
import test from 'node:test';import assert from 'node:assert/strict';
import {crc32,zip,muxWebM} from '../lesson-export.mjs';

test('CRC-32 matches the standard check value',()=>{assert.equal(crc32(new TextEncoder().encode('123456789')),0xCBF43926)});

test('the ZIP lists every file with its exact bytes',async()=>{
 const files=[{name:'a.vtt',blob:new Blob(['WEBVTT\n\n'])},{name:'lámina.json',blob:new Blob(['{"x":1}'])}];
 const b=new Uint8Array(await (await zip(files)).arrayBuffer()),dv=new DataView(b.buffer);
 const end=b.length-22;assert.equal(dv.getUint32(end,true),0x06054b50);assert.equal(dv.getUint16(end+10,true),2);
 assert.equal(dv.getUint32(0,true),0x04034b50);const n=dv.getUint16(26,true),size=dv.getUint32(18,true);
 assert.equal(new TextDecoder().decode(b.slice(30,30+n)),'a.vtt');assert.equal(new TextDecoder().decode(b.slice(30+n,30+n+size)),'WEBVTT\n\n');
});

test('the WebM has an EBML header, one track and a new cluster at each keyframe',async()=>{
 const chunks=[0,100,200,2000,2100].map((ms,i)=>({ms,key:i===0||i===3,data:new Uint8Array([i,i,i])}));
 const b=new Uint8Array(await muxWebM(chunks,{width:64,height:36,codec:'V_VP8',durationMs:2200}).arrayBuffer());
 assert.deepEqual([...b.slice(0,4)],[0x1A,0x45,0xDF,0xA3]);const hex=Buffer.from(b).toString('hex');
 assert.equal(hex.split('1f43b675').length-1,2);assert.equal(hex.split('a3').length>5,true);assert.ok(hex.includes(Buffer.from('V_VP8').toString('hex')));
});
