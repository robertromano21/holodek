'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const UI=require('../assets/combatCharacterUi'),game=fs.readFileSync(require.resolve('../assets/game'),'utf8');
test('map picking follows actual token footprints, respects transparent pixels, mirrors and topmost actors',()=>{
  const pc={name:'Mortacia',type:'pc'},npc={name:'Ally',type:'npc'};
  const targets=[{character:npc,x:10,y:20,size:43.75},{character:pc,x:10,y:20,size:43.75,flipped:true}];
  assert.equal(UI.pick(targets,31.875,41.875),pc);
  assert.equal(UI.pick(targets,31.875,41.875,t=>t.character===pc?0:255),npc);
  let sample;UI.pick(targets,10,20,(_t,u,v)=>{sample=[u,v];return 255;});assert.deepEqual(sample,[1,0]);
  assert.equal(UI.pick(targets,54,20),null);assert.equal(UI.pick(targets,NaN,20),null);
});
test('PC controls and autonomous movement use screen-relative facing at every cardinal camera heading',()=>{
  const c={angle:0};vm.runInNewContext(game.slice(game.indexOf('function deriveFacingFromDelta('),game.indexOf('function advanceWalkFrame(')),c);
  vm.runInNewContext(game.slice(game.indexOf('function getCombatFacingFlip('),game.indexOf('function applyCombatVisualFrame(')),c);
  c.getCombatMapRotationAngle=()=>c.angle;
  for(const angle of[0,Math.PI/2,Math.PI,Math.PI*1.5]){
    c.angle=angle;
    for(const [key,want]of[['right','right'],['backward','right'],['strafeRight','right'],['left','left'],['forward','left'],['strafeLeft','left']]){
      assert.equal(c.combatFacingFromControls({[key]:true},'opposite'),want);
      assert.equal(c.getCombatFacingFlip({name:'Mortacia',type:'pc',facing:want}),want==='right');
      assert.equal(c.getCombatFacingFlip({name:'Benedict',type:'pc',facing:want}),want==='left','Catalog sprites start facing right');
    }
    for(const type of['npc','monster'])for(const [dx,dy,want]of[[1,0,'right'],[-1,0,'left'],[0,1,'right'],[0,-1,'left']]){
      const actor={name:'Mortacia',type};
      c.rememberCombatMovementFacing(actor,dx*Math.cos(angle)+dy*Math.sin(angle),-dx*Math.sin(angle)+dy*Math.cos(angle));
      assert.equal(c.getCombatFacingFlip(actor),want==='right');
    }
  }
  assert.equal(c.combatFacingFromControls({},'right'),'right');
});
