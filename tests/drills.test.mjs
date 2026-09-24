// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAnswer,weightedPick,itemWeight,viewOptions,maneuverQuestion,CONFUSED} from '../drills.mjs';
import {VIEW_INFO,describeManeuver} from '../views.mjs';
import {defaultState} from '../geometry.mjs';

test('a wrong answer sends the item back to the first box, a right one moves it up',()=>{
 const s={answered:0,correct:0,items:{}};
 recordAnswer(s,'view:a4c',true);recordAnswer(s,'view:a4c',true);assert.equal(s.items['view:a4c'].box,2);
 recordAnswer(s,'view:a4c',false);assert.equal(s.items['view:a4c'].box,0);
 assert.deepEqual([s.answered,s.correct,s.items['view:a4c'].seen],[3,2,3]);
});
test('unseen and missed items are picked more often than mastered ones',()=>{
 assert.ok(itemWeight(undefined)>itemWeight({box:4}));
 const items={a:{box:4},b:{box:0}},count={a:0,b:0};let seed=1;const rand=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<2000;i++)count[weightedPick(['a','b'],items,rand)]++;
 assert.ok(count.b>count.a*4,JSON.stringify(count));
});
test('view options: four distinct views, the answer included, confusable views as distractors',()=>{
 for(const id of Object.keys(VIEW_INFO)){const o=viewOptions(id);assert.equal(o.length,4);assert.equal(new Set(o).size,4);assert.ok(o.includes(id));for(const v of o)assert.ok(VIEW_INFO[v],v);for(const c of CONFUSED[id])assert.ok(o.includes(c))}
});
test('maneuver question: the answer undoes the misalignment and differs from the opposite move',()=>{
 const ideal={...defaultState('apical'),depth:.17};
 for(const m of [['rotation',[22,34]],['tilt',[10,15]],['rock',[10,15]],['z',[.018,.024]],['x',[.012,.018]]])for(const flip of [1,-1]){
  const q=maneuverQuestion(ideal,m,flip);assert.equal(q.options.length,4);assert.ok(q.options.includes(q.answer));
  assert.ok(Math.abs(q.wrong[m[0]]-ideal[m[0]])>0);
  const back=describeManeuver(q.wrong,m[0],-q.delta);assert.equal(q.answer.toLowerCase(),back.toLowerCase());
  assert.notEqual(q.answer.toLowerCase(),describeManeuver(q.wrong,m[0],q.delta).toLowerCase());
 }
});
