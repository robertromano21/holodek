'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {score,evaluate}=require('../tools/score-sid-voices.cjs'),{page}=require('../tools/audition-sid-voices.cjs');
test('external transcripts measure word edits without claiming naturalness or guessing missing recognition',()=>{
  assert.equal(score('The gods know grief.','The gods know grief.').wer,0);
  const r=score('The gods know grief.','The dogs know grief.',['gods','grief']);assert.equal(r.errors,1);assert.equal(r.wer,.25);assert.deepEqual(r.targetHits,{gods:false,grief:true});
  const m={text:'The gods know grief.',characters:[{name:'Mortacia',variants:{detail:{file:'d.wav'},legacy:{file:'l.wav'}}}]};
  const partial=evaluate(m,{'d.wav':'The gods know grief.'});assert.equal(partial.complete,false);assert.deepEqual(partial.missing,['l.wav']);assert.deepEqual(partial.summary,{});
  const full=evaluate(m,{'d.wav':'The gods know grief.','l.wav':'The dogs know grief.'});assert.equal(full.complete,true);assert.equal(full.summary.legacy.wer,.25);
});
test('audition references are explicitly labeled, with no hybrid implication',()=>{
  const html=page({text:'Test',characters:[{name:'Test',guide:'lj',profile:{f0:205,fs:1},variants:{reference:{file:'r.wav'},detail:{file:'d.wav'}}}]});
  assert.match(html,/NOT SID, audition only/);assert.match(html,/never mixed/);
});

test('word edits expose substitutions, insertions and deletions without accepting partial target phrases',()=>{
  const s=score('The brass key opens the gate.','The key opens a gate now.',['brass key','gate','']);
  assert.equal(s.edits.length,s.errors);
  assert.ok(s.edits.some(e=>e.type==='deletion'&&e.expected==='brass'));
  assert.ok(s.edits.some(e=>e.type==='substitution'&&e.expected==='the'&&e.heard==='a'));
  assert.ok(s.edits.some(e=>e.type==='insertion'&&e.heard==='now'));
  assert.deepEqual(s.targetHits,{'brass key':false,gate:true,'':false});
  assert.equal(score('brass key','brass key',['brass key']).targetHits['brass key'],true);
});
