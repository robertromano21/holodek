'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/commandGate.js','utf8');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(){
  let now=1000,floor='street';const timers=[],notices=[],field={value:'north'};
  const root={dungeonRunId:'run',currentDungeon:{geoKey:'0,1,0'},CityFloorScope:{token:()=>floor},
    setTimeout:fn=>timers.push(fn),DungeonActionNotices:{receive:n=>notices.push(n)}};
  const document={addEventListener(){},getElementById:()=>field};
  vm.runInNewContext(source,{window:root,document,Date:{now:()=>now}});
  return{root,api:root.GameCommandGate,field,notices,floor:value=>floor=value,
    async tick(ms=75){now+=ms;timers.splice(0).forEach(fn=>fn());for(let i=0;i<8;i++)await Promise.resolve();}};
}
test('a world command captures fresh resident state only after the complete native interaction, exactly once',async()=>{
  const f=fixture(),network=deferred(),apply=deferred();let state='old',calls=0,snapshot;
  const native=f.api.trackNative(async()=>{await network.promise;await apply.promise;state='six authored residents';});
  const submit=f.api.wrap(async()=>{calls++;snapshot=state;});
  const command=submit();assert.equal(calls,0);assert.equal(f.field.value,'north');assert.equal(f.api.busy(),true);
  await submit();assert.equal(calls,0);
  network.resolve();await f.tick();assert.equal(calls,0,'Network completion alone is not a state handoff');
  apply.resolve();await native;await f.tick();await command;
  assert.equal(calls,1);assert.equal(snapshot,'six authored residents');assert.equal(f.api.busy(),false);
});
test('native interactions can nest service-menu work without deadlocking the queued command',async()=>{
  const f=fixture(),release=deferred();let menu=false,calls=0;
  const native=f.api.trackNative(async()=>{await release.promise;await f.api.trackNative(async()=>{menu=true;});});
  const command=f.api.wrap(async()=>calls++)();release.resolve();await native;await f.tick();await command;
  assert.equal(menu,true);assert.equal(calls,1);assert.equal(f.api.busy(),false);
});
for(const [name,change]of [
  ['run',f=>f.root.dungeonRunId='other'],['room',f=>f.root.currentDungeon={geoKey:'0,2,0'}],['floor',f=>f.floor('upper')],
  ['pause',f=>f.root.gamePaused=true],['combat',f=>f.root.actionDiceState={active:{kind:'combat'}}],
  ['death',f=>f.root._playerUnconscious=true],['draft',f=>f.field.value='south']
])test('queued commands cancel without changing input or sending state when '+name+' changes',async()=>{
  const f=fixture(),release=deferred();let calls=0;
  const native=f.api.trackNative(()=>release.promise),command=f.api.wrap(async()=>calls++)();
  change(f);release.resolve();await native;await f.tick();assert.equal(await command,false);
  assert.equal(calls,0);assert.equal(f.field.value,name==='draft'?'south':'north');assert.equal(f.notices.length,1);assert.equal(f.api.busy(),false);
});
test('a rejected native operation releases the wait and does not leave a command permanently blocked',async()=>{
  const f=fixture(),release=deferred();let calls=0;
  const native=f.api.trackNative(()=>release.promise),rejection=assert.rejects(native,/failed/),command=f.api.wrap(async()=>calls++)();
  release.reject(Error('failed'));await rejection;await f.tick();await command;
  assert.equal(calls,1);assert.equal(f.api.busy(),false);
});
test('waiting for a stuck interaction is bounded and never sends a stale snapshot',async()=>{
  const f=fixture(),release=deferred();let calls=0;
  const native=f.api.trackNative(()=>release.promise),command=f.api.wrap(async()=>calls++)();
  await f.tick(120001);assert.equal(await command,false);assert.equal(calls,0);assert.equal(f.api.busy(),false);
  assert.match(f.notices[0].message,/still loading/);release.resolve();await native;
});
test('a command can wait through a native state-sync lock, without bypassing a real world-turn lock',async()=>{
  const f=fixture(),release=deferred();let calls=0;
  const native=f.api.trackNative(async()=>{f.api.begin();await release.promise;f.api.end();});
  const command=f.api.wrap(async()=>calls++)();assert.equal(calls,0);release.resolve();await native;await f.tick();await command;
  assert.equal(calls,1);f.api.begin();await f.api.wrap(async()=>calls++)();assert.equal(calls,1);f.api.end();
});
test('speech alone never blocks a world command or an accepted service offer',async()=>{
  const f=fixture();f.root.DungeonLife={hasPendingSpeech:()=>true};f.root.speechSynthesis={speaking:true};
  await f.api.waitForIdle({includeCommands:true});let calls=0;await f.api.wrap(async()=>calls++)();assert.equal(calls,1);
});
test('resident materialization is tracked until state application completes, not just until HTTP returns',async()=>{
  const f=fixture(),response=deferred(),applied=deferred();let calls=0;
  const row={name:'Local',status:'ambient',occupation:{mode:'visit'}};
  f.root.currentDungeon.cityCrowd={actors:{one:row}};
  f.root.getDungeonLifeContext=()=>({dungeon:f.root.currentDungeon,player:{x:1,y:1}});
  f.root.fetch=async()=>({ok:true,json:()=>response.promise});
  f.root.applyRealtimeCombatResult=()=>applied.promise;
  vm.runInNewContext(fs.readFileSync('assets/cityCrowdUi.js','utf8'),{window:f.root,Date});
  const resident=f.root.CityCrowdUi.open({ambient:true,crowdId:'one',mazeRoomKey:'0,1,0',name:'Local'});
  const command=f.api.wrap(async()=>calls++)();response.resolve({actor:'Local',runId:'run',geoKey:'0,1,0'});
  await f.tick();assert.equal(calls,0);applied.resolve();assert.equal(await resident,true);
  await f.tick();await command;assert.equal(calls,1);
});
test('server state replacement keeps the action guard and exposes temporary-busy diagnostics',()=>{
  const server=fs.readFileSync('server.js','utf8'),start=server.indexOf("app.post('/updateState7'");
  const guard=server.slice(start,server.indexOf('const { personalNarrative',start));
  assert.match(guard,/inputTaskInFlight/);assert.match(guard,/actionDice.active/);
  assert.match(guard,/STATE_SYNC_ACTION_ACTIVE/);assert.match(guard,/STATE_SYNC_BUSY/);
  assert.match(guard,/StateSyncRejected/);assert.match(guard,/status\(409\)/);
});
