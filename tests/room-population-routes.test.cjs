const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I=require('../assets/dungeonInhabitants');
const {createPopulationService}=require('../retort/roomPopulation');
const {ActionDice}=require('../retort/actionDice');
const {formatStartingCharacterSheet}=require('../retort/initialGameState');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const routesCode=source.slice(source.indexOf('const NPC_AUTONOMY_TICK_MS'),source.indexOf("app.post('/processInput7'"));
const sheet=name=>formatStartingCharacterSheet({Name:name,Sex:'Female',Race:'Human',Class:'Fighter',Level:1,AC:10,HP:40,MaxHP:40});
function fixture() {
  const routes=new Map(),events=[],calls=[],map=new Map();let db='{}',paused=false;
  const dungeon={geoKey:'1,0,0',classification:{indoor:true},layout:{width:64,height:64},start:{x:4,y:4},cells:{}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const p=I.createPopulation(dungeon.geoKey,[{name:'Near Guard',allegiance:'Hostile',dialogue:['Keep back.']},
    {name:'Far Guard',allegiance:'Hostile'},{name:'Mason',allegiance:'Neutral'}]);
  // These route fixtures revisit an introduced cast; first meetings have separate narrative tests.
  for (const group of p.groups) group.introPlayed = true;
  for(const [name,x]of[['Near Guard',6],['Far Guard',25],['Mason',5]]){
    p.actors[name].position=p.actors[name].home={x,y:4};p.groups.find(g=>g.members.includes(name)).site={x,y:4};
  }
  map.set(dungeon.geoKey,p);
  let wire=JSON.stringify([{name:'PC',type:'pc',hp:40,mazeX:4,mazeY:4,mazeRoomKey:dungeon.geoKey},
    ...Object.values(p.actors).map(a=>({name:a.name,type:'monster',hp:40,mazeX:a.position.x,mazeY:a.position.y,mazeRoomKey:dungeon.geoKey}))]);
  let text=`Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party: None\nMonsters in Room:\n${['Near Guard','Far Guard','Mason'].map(sheet).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 1`;
  const state={getDungeonRunId:()=> 'run',getGamePaused:()=>paused,setGamePaused:v=>paused=v,getDungeonTestingMode:()=>false,
    getLastCoords:()=>({x:1,y:0,z:0}),getRoomDungeonForSimulation:()=>dungeon,getUpdatedGameConsole:()=>text,setUpdatedGameConsole:v=>text=v,
    getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,getCombatMode:()=> 'Combat Map-Based',
    getRoomPopulation:key=>map.get(key),setRoomPopulation:(key,value)=>map.set(key,value),getRoomNameDatabase:()=>db,
    setRoomNameDatabase:value=>db=value,setLiveWorldState:value=>calls.push({live:value})};
  const dice=new ActionDice({animationMs:0});
  const context={require,Inhabitants:I,RandomEncounters:require('../retort/randomEncounters'),sharedState:state,actionDice:dice,inputTaskInFlight:false,
    populationService:createPopulationService(state),DialogueTurns:require('../retort/dialogueTurns'),
    app:{post:(url,handler)=>routes.set(url,handler),use(){}},broadcast:event=>events.push(event),
    console:{warn(){},info(){}},retortWithUserInput:async(...args)=>{calls.push({combat:args});return{content:'One combat round.',combatCharactersString:wire,combatRoundOnly:true};},
    runNpcAutonomyTick:async()=>{calls.push({refresh:true});return{dialogue:[],summary:'',population:p,refreshed:true};}};
  vm.runInNewContext(routesCode,context);
  async function request(url,body) {
    const result={status:200};
    await routes.get(url)({body},{status(code){result.status=code;return this;},json(data){result.body=data;return this;}});
    return result;
  }
  return {request,state,context,events,calls,p,dice,dungeon,body:{runId:'run',geoKey:dungeon.geoKey,player:{x:4.5,y:4.5},actors:[]}};
}
test('pause validates the run and setting, then pauses both world simulation and pending dice',async()=>{
  const f=fixture();
  assert.equal((await f.request('/game/pause',{runId:'old',paused:true})).status,409);
  assert.equal((await f.request('/game/pause',{runId:'run',paused:'true'})).status,400);
  assert.equal((await f.request('/game/pause',{runId:'run',paused:true})).status,200);
  assert.ok(f.state.getGamePaused()&&f.dice.paused);
  assert.equal((await f.request('/room-population/visit',f.body)).status,409);
  assert.equal(f.events.at(-1).type,'game_pause');
});
test('discovery rejects stale rooms, busy actions and bad positions without generating a room or story',async()=>{
  const f=fixture(),before=JSON.stringify(f.dungeon);
  for(const body of [{...f.body,runId:'old'},{...f.body,geoKey:'2,0,0'}])assert.equal((await f.request('/room-population/visit',body)).status,409);
  assert.equal((await f.request('/room-population/visit',{...f.body,player:{x:NaN,y:4}})).status,400);
  f.context.inputTaskInFlight=true;assert.equal((await f.request('/room-population/visit',f.body)).status,409);f.context.inputTaskInFlight=false;
  const result=await f.request('/room-population/visit',{...f.body,actors:[null,{}, {name:'Invented',mazeX:5,mazeY:5}]});
  assert.equal(result.status,200);assert.equal(result.body.dialogue.length,1);assert.equal(f.p.actors.Invented,undefined);
  assert.equal(JSON.stringify(f.dungeon),before);assert.equal(f.calls.length,0);
});
test('only a close, visible hostile can start the original fast combat round',async()=>{
  const f=fixture();
  for(const target of ['Far Guard','Mason','Invented'])assert.equal((await f.request('/room-population/engage',{...f.body,target})).status,409);
  f.dungeon.cells['5,4'].tile='wall';assert.equal((await f.request('/room-population/engage',{...f.body,target:'Near Guard'})).status,409);
  f.dungeon.cells['5,4'].tile='floor';
  const result=await f.request('/room-population/engage',{...f.body,target:'Near Guard'});
  assert.equal(result.status,200);assert.equal(result.body.type,'realtime_combat_result');assert.ok(result.body.eventId);
  const calls=f.calls.filter(a=>a.combat);assert.equal(calls.length,1);assert.equal(calls[0].combat[0],'');
  assert.equal(calls[0].combat[3].realtimeEncounter,'Near Guard');assert.equal(f.context.inputTaskInFlight,false);
});
test('failed encounters release the lock, and the starting temple never auto-engages its residents',async()=>{
  const f=fixture();f.p.starting=true;
  assert.equal((await f.request('/room-population/engage',{...f.body,target:'Near Guard'})).status,409);
  f.p.starting=false;f.context.retortWithUserInput=async()=>{throw Error('Test failure');};
  assert.equal((await f.request('/room-population/engage',{...f.body,target:'Near Guard'})).status,503);
  assert.equal(f.context.inputTaskInFlight,false);assert.equal(f.dice.active,null);
});
test('five-minute refresh is throttled and reports updated caches, not a synthetic player turn',async()=>{
  const f=fixture(),body={...f.body,liveWorldState:{roomKey:f.body.geoKey,player:f.body.player,currentConversation:'Recent speech.'}};
  assert.equal((await f.request('/room-population/autonomy',body)).status,200);
  assert.equal((await f.request('/room-population/autonomy',body)).status,200);
  assert.equal(f.calls.filter(c=>c.refresh).length,1);assert.equal(f.calls.filter(c=>c.combat).length,0);
  assert.ok(f.events.some(e=>e.type==='room_population'));
  await f.request('/game/pause',{runId:'run',paused:true});
  assert.equal((await f.request('/room-population/autonomy',body)).status,409);
});
test('idle discovery polls do not reserialize the campaign database; newly discovered state persists immediately',async()=>{
  const f=fixture();let writes=0;
  const save=f.state.setRoomNameDatabase;f.state.setRoomNameDatabase=value=>{writes++;save(value);};
  await f.request('/room-population/visit',f.body);assert.equal(writes,1);
  await f.request('/room-population/visit',f.body);await f.request('/room-population/visit',f.body);
  assert.equal(writes,1);
  f.p.groups.find(g=>g.members.includes('Near Guard')).status='unseen';
  await f.request('/room-population/visit',f.body);assert.equal(writes,2);
});
