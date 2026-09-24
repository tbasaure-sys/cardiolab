import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePackets,relayTopics,BROKERS,ICE_SERVERS} from '../relay.mjs';

test('MQTT packets: complete ones are parsed, a partial one is kept for the next frame',()=>{
 const pub=[0x30,5,0,1,0x61,0x7b,0x7d],ping=[0xd0,0];
 let [p,rest]=parsePackets(new Uint8Array([...pub,...ping.slice(0,1)]));assert.equal(p.length,1);assert.equal(rest.length,1);
 [p,rest]=parsePackets(new Uint8Array([...rest,...ping.slice(1)]));assert.equal(p.length,1);assert.equal(p[0].first,0xd0);assert.equal(rest.length,0);
});
test('multi-byte remaining length (payload > 127 bytes)',()=>{const body=new Array(200).fill(7),bytes=new Uint8Array([0x30,200%128|128,1,...body]);const [p,rest]=parsePackets(bytes);assert.equal(p.length,1);assert.equal(p[0].body.length,200);assert.equal(rest.length,0)});
test('topics are per code and per direction; secure public brokers; STUN and TURN servers',()=>{
 assert.deepEqual(relayTopics('abc123'),{up:'cardiolab/v1/abc123/up',down:'cardiolab/v1/abc123/down'});
 assert.ok(BROKERS.length>=2&&BROKERS.every(u=>u.startsWith('wss://')));assert.ok(ICE_SERVERS.some(s=>String(s.urls).includes('turn:')));
});
