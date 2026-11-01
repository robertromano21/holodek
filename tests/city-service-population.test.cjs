'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('increased city seed density remains bounded and does not eagerly author citizens or replace saved crowds',()=>{
  const file=require.resolve('./city-crowds.test.cjs'),source=fs.readFileSync(file,'utf8');
  const first=source.indexOf("test('");
  const f=vm.runInNewContext(source.slice(0,first)+'\nfixture();',{require:require('node:module').createRequire(file),process});
  const C=require('../retort/cityCrowds'),crowd=C.synchronize(f.state,f.request);
  assert.ok(Object.keys(crowd.actors).length<=2048);
  assert.ok(Object.values(crowd.actors).some(a=>a.occupation?.mode==='work'));
  for(const a of Object.values(crowd.actors)){assert.equal(a.dialogue,undefined);assert.equal(a.history,undefined);}
  const before=JSON.stringify(crowd);C.synchronize(f.state,{...f.request,crowdRevision:crowd.revision});
  assert.equal(JSON.stringify(f.stored.cityCrowd),before);
  const code=fs.readFileSync('retort/cityCrowds.js','utf8');
  assert.match(code,/Math\.max\(4,Math\.min\(15,/);assert.match(code,/%67===0/);
  assert.match(fs.readFileSync('assets/cityCrowdUi.js','utf8'),/rows\.length===24/,'Keep the existing visible actor cap');
});
