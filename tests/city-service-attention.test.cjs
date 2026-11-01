'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants');
function fixture(){
  const file=require.resolve('./subtitle-diagnostics.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("test('Edran full"))+'\nfixture();',
    {require:require('node:module').createRequire(file)});
  const focused=[];f.root.focusDungeonSpeaker=(...args)=>{focused.push(args);f.actor._conversationGoal={x:7,y:4};};
  f.focused=focused;return f;
}
test('authored attention survives tagged prose and subtitle attribution without adding model calls',()=>{
  const raw='Keeper says, "[[SPEECH:"Keeper"]]May I show you the saved commission?[[/SPEECH]]"\n[[CHARACTER_DIALOGUE]]'+
    JSON.stringify({spoken:[{speaker:'Keeper',recipient:'PC',attention:'question'}],replies:[]})+'[[/CHARACTER_DIALOGUE]]';
  const row=I.extractDialogue(raw,['Keeper']).dialogue[0];assert.equal(row.attention,'question');assert.equal(row.recipient,'PC');
  assert.equal(I.mergeAttributedSpeech([row],[{speaker:'Keeper',line:row.line}])[0].attention,'question');
});
test('passing remarks keep walking, including explicitly authored rhetorical questions',()=>{
  for(const row of [{line:'Excuse me, I am keeping the pillars polished.',kind:'canned'},
    {line:'Excuse me, may I pass?',kind:'turn',attention:'passing'}]){
    const f=fixture();f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,...row}]});
    assert.equal(f.focused.length,0);assert.ok(!f.actor._conversationGoal);
    assert.equal(f.root.DungeonLife.isWaitingToSpeak(f.actor.name),false);
  }
});
test('directed speakers stay focused through long voice waits, then release after a completed remark',()=>{
  const f=fixture();f.root.HolodekSfx={speakLine:()=>new Promise(()=>{})};
  f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'The posted commission has a saved recipient.',attention:'addressing'}]});
  assert.equal(f.focused.length,1);f.advance(9000);f.root.DungeonLife.tick();assert.ok(f.actor._conversationUntil>10000);
  f.advance(3000);f.root.DungeonLife.tick();assert.equal(f.actor._conversationUntil,0);assert.equal(f.actor._conversationGoal,null);
});
test('a question stays in view and waits for an answer after the spoken line finishes',()=>{
  const f=fixture();f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'Would you like to hear about the existing job?',attention:'question'}]});
  f.advance(20000);f.root.DungeonLife.tick();assert.ok(f.actor._conversationUntil>20000);
  f.advance(120000);f.root.DungeonLife.tick();assert.ok(f.actor._conversationUntil>140000);
  assert.equal(f.root.DungeonLife.hasPendingSpeech(),true);
  f.root.DungeonLife.playerResponded();f.advance(3000);f.root.DungeonLife.tick();assert.ok(f.actor._conversationGoal,'Keep listening while the answer resolves');
  f.root.DungeonLife.receiveTurnDialogue('',{runId:'run',geoKey:f.ctx.dungeon.geoKey,dialogue:[]});
  assert.equal(f.actor._conversationGoal,null);assert.equal(f.root.DungeonLife.hasPendingSpeech(),false);
});
test('a new authored closing remark ends a question wait; stale replies cannot end it',()=>{
  const f=fixture();f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'Can you help?',attention:'question'}]});
  f.advance(20000);f.root.DungeonLife.tick();f.root.DungeonLife.playerResponded();
  f.root.DungeonLife.receiveTurnDialogue('',{runId:'old',geoKey:f.ctx.dungeon.geoKey,dialogue:[]});assert.ok(f.actor._conversationGoal);
  f.root.DungeonLife.receiveTurnDialogue('Vyrixa Shadowtide says, "Thank you. That concludes our business."',
    {...f.event,dialogue:[{speaker:f.actor.name,line:'Thank you. That concludes our business.',attention:'addressing'}],consoleText:''});
  f.advance(20000);f.root.DungeonLife.tick();assert.equal(f.actor._conversationGoal,null);
});
test('walking away, changing floors, combat and death release waiting speakers without following indefinitely',()=>{
  for(const change of [f=>f.ctx.player.x+=4,f=>f.root.CityFloorScope={cacheKey:()=> 'upper'},
    f=>f.root.actionDiceState={active:true},f=>f.actor.hp=0,f=>f.root._deathSceneActive=true]){
    const f=fixture();f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'Will you wait?',attention:'question'}]});
    change(f);f.root.DungeonLife.tick();assert.equal(f.actor._conversationGoal,null);
    f.advance(20000);f.root.DungeonLife.tick();
    assert.equal(f.root.DungeonLife.hasPendingSpeech(),false);
  }
});
test('turning in place reframes the speaker with a walkable goal, without moving the camera or actor directly',()=>{
  const f=fixture();f.ctx.heading=0;
  f.root.DungeonLife.receiveDialogue({...f.event,dialogue:[{speaker:f.actor.name,line:'Would you listen?',attention:'question'}]});
  const before={x:f.actor.mazeX,y:f.actor.mazeY};f.ctx.heading=Math.PI/2;f.root.DungeonLife.tick();
  assert.equal(f.focused.length,2);assert.equal(f.ctx.heading,Math.PI/2);assert.deepEqual({x:f.actor.mazeX,y:f.actor.mazeY},before);
  f.root.DungeonLife.reset();assert.equal(f.actor._conversationGoal,null);
});
