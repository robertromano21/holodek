'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Notice=require('../retort/questSeedingNotice');
function fixture(){
  const tasks=[{id:'actual-task',desc:'Speak to the named keeper about the missing seal.',status:'Pending'}],events=[];
  const state={getCurrentTasks:()=>tasks,setCurrentTasks(v){assert.equal(v,tasks);},getCurrentTaskIndex:()=>0,getCurrentQuest:()=> 'The Saved Quest',
    getQuestSeeded:()=>true,getDungeonRunId:()=> 'run',getLastCoords:()=>({x:0,y:1,z:0})};return{tasks,state,events,broadcast:e=>events.push(e)};
}
test('a confirmed saved quest seeds one distinct notice, not a new model request or invented objective',()=>{
  const f=fixture(),binding=require('../retort/questProgress').taskBinding(f.tasks[0]);
  assert.equal(Notice.publish(f.state,f.tasks[0],f.broadcast),true);assert.equal(Notice.publish(f.state,f.tasks[0],f.broadcast),false);
  assert.equal(require('../retort/questProgress').taskBinding(f.tasks[0]),binding,'A UI receipt must not invalidate quest scene gates or delivery bindings');
  assert.equal(f.events.length,1);assert.equal(f.events[0].title,'New Quest');assert.equal(f.events[0].kind,'quest-seeded');
  assert.equal(f.events[0].geoKey,'0,1,0');assert.match(f.events[0].message,/The Saved Quest/);assert.ok(f.events[0].message.includes(f.tasks[0].desc));
  assert.equal(f.tasks[0].seedNoticeId,f.events[0].id);
  const clone=JSON.parse(JSON.stringify(f.tasks));f.state.getCurrentTasks=()=>clone;
  assert.equal(Notice.publish(f.state,clone[0],f.broadcast),false,'Save/reload must not replay the same seed notice');
});
test('failed, uncommitted and completed seeds never announce a quest; later steps are not mislabeled new quests',()=>{
  for(const change of [f=>f.state.getQuestSeeded=()=>false,f=>f.tasks[0].status='Completed',f=>f.state.getCurrentQuest=()=> 'None']){
    const f=fixture();change(f);assert.equal(Notice.publish(f.state,f.tasks[0],f.broadcast),false);assert.equal(f.events.length,0);
  }
  const f=fixture();assert.equal(Notice.publish(f.state,{...f.tasks[0]},f.broadcast),false);
  f.tasks.push({...f.tasks[0],id:'step-two'});f.state.getCurrentTaskIndex=()=>1;
  assert.equal(Notice.publish(f.state,f.tasks[1],f.broadcast),true);assert.equal(f.events[0].title,'New Quest Step');
});
function browser(){
  const file=require.resolve('./action-feedback.test.cjs'),source=fs.readFileSync(file,'utf8');
  return vm.runInNewContext(source.slice(0,source.indexOf("test('puzzle completion"))+
    source.slice(source.indexOf('function browserFixture()'),source.indexOf("test('death notices display"))+'\nbrowserFixture();',
    {require:require('node:module').createRequire(file),__dirname:require('node:path').dirname(file)});
}
test('the quest notice stays readable until dismissed, is deduplicated, and never enters the speech queue',()=>{
  const f=browser();
  let speech=0;f.root.DungeonLife.receiveDialogue=()=>speech++;
  const event={id:'seed',runId:'run',geoKey:'0,0,0',kind:'quest-seeded',title:'New Quest',message:'An actual saved objective.'};
  assert.equal(f.root.DungeonActionNotices.receive(event),true);assert.equal(f.root.DungeonActionNotices.receive(event),false);
  const panel=f.elements.get('dungeon-action-notice');assert.equal(panel.dataset.dismissal,'manual');
  f.advance(120000);assert.equal(panel.hidden,false);assert.match(panel.children[1].children[1].textContent,/Pay Attention/);
  f.root.DungeonActionNotices.dismiss();assert.equal(panel.hidden,true);assert.equal(speech,0);
  const pipeline=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  assert.doesNotMatch(pipeline,/if\(questJustSeeded\).*questSeedingNotice/,'Installing a quest is not encountering its giver');
  assert.match(pipeline,/QuestScenes\.onRead\(sharedState,plan,broadcast\)/);
  const server=fs.readFileSync('server.js','utf8');
  assert.match(server,/QuestScenes\.onDialogue\(sharedState,data,broadcast\)/);
  assert.match(server,/QuestScenes\.view\(sharedState,req.body.actor,broadcast\)/);
});
test('quest notices wait for their actual room and floor instead of getting lost during room loading',()=>{
  const f=browser(),event={id:'seed-delayed',runId:'run',geoKey:'0,1,0',floorToken:'first-floor',kind:'quest-seeded',title:'New Quest',message:'Saved objective.'};
  let floor='street';f.root.CityFloorScope={token:()=>floor};
  f.root.DungeonActionNotices.receive(event);const panel=f.elements.get('dungeon-action-notice');assert.equal(panel.hidden,true);
  f.ctx.dungeon.geoKey='0,1,0';f.root.DungeonActionNotices.tick();assert.equal(panel.hidden,true);
  floor='first-floor';f.root.DungeonActionNotices.tick();assert.equal(panel.hidden,false);assert.equal(panel.dataset.kind,'quest-seeded');
  f.root.DungeonActionNotices.dismiss();f.root.DungeonActionNotices.tick();assert.equal(panel.hidden,true);
});
test('a quest seed stands out immediately above an ordinary toast without discarding unread pages',()=>{
  const f=browser(),base={runId:'run',geoKey:'0,0,0',message:'Saved text.'};
  f.root.DungeonActionNotices.receive({...base,id:'ambient',kind:'object-discovered',title:'Object'});
  f.root.DungeonActionNotices.receive({...base,id:'seed-priority',kind:'quest-seeded',title:'New Quest'});
  const panel=f.elements.get('dungeon-action-notice');assert.equal(panel.dataset.kind,'quest-seeded');
  f.root.DungeonActionNotices.dismiss();f.root.DungeonActionNotices.tick();assert.equal(panel.dataset.kind,'object-discovered');
});
