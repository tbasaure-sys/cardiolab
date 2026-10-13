// Direct links (links.mjs): what is written in the URL comes back the same, and junk is ignored.
import test from 'node:test';import assert from 'node:assert/strict';
import {parseLink,formatLink,numParam} from '../links.mjs';

test('links round-trip',()=>{
 for(const l of [{route:'fisica',id:'ciclo',params:{fc:'140'}},{route:'estudio',id:'vsdpm',params:{tam:'0.6',rvp:'normal',paciente:'neonate'}},{route:'vista',id:'a4c',params:{}},{route:'leccion',id:'barrido-psax',params:{modo:'demostracion'}}])
  assert.deepEqual(parseLink(formatLink(l)),l);
 assert.equal(formatLink({route:'fisica',id:'doppler',params:{f:null,fc:''}}),'#/fisica/doppler');
});
test('unknown places and empty fragments are not links; a bare patient is',()=>{
 assert.equal(parseLink(''),null);assert.equal(parseLink('#'),null);assert.equal(parseLink('#/admin/x'),null);
 assert.deepEqual(parseLink('#/?paciente=teen'),{route:null,id:null,params:{paciente:'teen'}});
});
test('numbers from links are range-checked',()=>{
 assert.equal(numParam('140',50,160),140);assert.equal(numParam('0,6',0,1),.6);assert.equal(numParam('999',50,160),null);assert.equal(numParam('x',0,1),null);assert.equal(numParam(undefined,0,1),null);
});
