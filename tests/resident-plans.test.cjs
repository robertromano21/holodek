'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../retort/residentPlans'),W=require('../retort/livingWorld'),L=require('../retort/livingRegionLedger'),I=require('../assets/dungeonInhabitants');
const {formatStartingCharacterSheet:sheet}=require('../retort/initialGameState');
const row=name=>sheet({Name:name,Sex:'Female',Race:'Human',Class:'Fighter',Level:2,HP:15,MaxHP:15,AC:12});
function fixture(){
  const A='1,0,0',B='2,0,0',pop=(k,names)=>{const p=I.createPopulation(k,names.map(name=>({name,allegiance:'Neutral'})));
    for(const [n,r]of Object.entries(p.actors))Object.assign(r,{hp:15,sheet:row(n),position:{x:n==='Actor'?3:6,y:3},inventory:[],encounteredAt:1});return p;};
  let db={[A]:{name:'First Place',populationComplete:true,exits:{east:{status:'open',targetCoordinates:B}},inhabitants:pop(A,['Actor','Receiver'])},
    [B]:{name:'Second Place',populationComplete:true,exits:{west:{status:'open',targetCoordinates:A}},inhabitants:pop(B,[])}};
  const region={runId:'plans',communities:[{id:'c1',anchor:{key:A},standing:0},{id:'c2',anchor:{key:B},standing:0}],routes:[],residents:[],quests:[],companionThreads:[],ledger:L.create('plans')};
  db['0,0,0']={livingRegion:region};W.init(region).active=[{name:'Actor',distance:0}];W.person(region,'Actor');
  const grid=(k,dir,x)=>({geoKey:k,layout:{width:10,height:10},start:{x:2,y:2},roomExits:{markers:[{direction:dir,x,y:3}]},
    cells:Object.fromEntries(Array.from({length:100},(_,i)=>[`${i%10},${Math.floor(i/10)}`,{tile:i%10&&i%10<9&&i>=10&&i<90?'floor':'wall',floorHeight:0,ceilHeight:6}]))});
  const grids={[A]:grid(A,'east',7),[B]:grid(B,'west',2)},cached={};
  let text=`Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party: None\nMonsters in Room:\n${row('Actor')}\n${row('Receiver')}\nMonsters Equipped Properties: None\nMonsters State: Neutral`,wire=JSON.stringify([{name:'Hero',type:'pc',hp:20,mazeX:2,mazeY:6,mazeRoomKey:A},
    {name:'Actor',type:'monster',hp:15,mazeX:3,mazeY:3,mazeRoomKey:A},{name:'Receiver',type:'monster',hp:15,mazeX:6,mazeY:3,mazeRoomKey:A}]),tasks=[];
  const state={getDungeonRunId:()=> 'plans',getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:v=>{db=JSON.parse(v);},
    getRoomDungeonForSimulation:c=>grids[`${c.x},${c.y},${c.z}`],getRoomPopulation:k=>cached[k],setRoomPopulation:(k,p)=>{cached[k]=p;},
    getUpdatedGameConsole:()=>text,setUpdatedGameConsole:v=>text=v,getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,
    getCurrentTasks:()=>tasks,setTasks:v=>tasks=v};
  const entry=()=>W.index(db).where.get('actor'),actor=()=>entry().record;
  const install=kind=>{const request={source:P.SOURCE,id:'rp:test',options:P.options(state,db,region,entry())};request.options=request.options.filter(o=>o.kind===kind);
    assert.ok(request.options.length,kind);actor().residentPlanRequest=request;
    P.install(actor(),request,{choice:request.options[0].id,intent:'An authored personal intention.',activity:'An authored activity.',beginReply:'I have work to do.',mayWait:true,waitReply:'I can wait.',resumeReply:'I will continue.'},0);
  };
  const tick=t=>P.tick(state,db,region,{turn:t,key:A,touched:new Set(),notices:[]});
  return{state,region,entry,actor,install,tick,grids,A,B,db:()=>db};
}
test('a resident carries out a real route without a player quest and retains one authoritative identity',()=>{
  const f=fixture(),before=f.actor().sheet;f.install('travel');f.tick(1);
  const positions=[];for(let t=2;t<12;t++){f.tick(t);positions.push({...f.actor().position});if(f.actor().residentPlan.status==='completed')break;}
  assert.equal(f.entry().roomKey,f.B);assert.equal(f.db()[f.A].inhabitants.actors.Actor,undefined);
  assert.equal(f.actor().sheet,before);assert.equal(f.actor().hp,15);assert.equal(f.actor().residentPlan.receipts.length,1);
  assert.ok(positions.some(p=>p.x===7&&p.y===3),'the actor reached the actual source threshold');
  assert.equal(f.actor().residentPlan.receipts[0].from,f.A);assert.equal(f.actor().residentPlan.receipts[0].to,f.B);
  assert.equal(f.region.ledger.facts.length,1);assert.ok(!/authored personal intention/.test(f.region.ledger.facts[0].text),'intent prose is not made into fact');
  assert.ok(f.region.world.people.actor.events.length);assert.ok(L.verify(f.region.ledger).ok);
  f.tick(20);assert.equal(f.actor().residentPlan.receipts.length,1);
});
test('closed paths, dead or recruited actors, accepted work, unbuilt rooms and combat block autonomous travel',()=>{
  for(const mode of ['door','dead','recruited','accepted','unbuilt','combat']){
    const f=fixture();f.install('travel');f.tick(1);
    if(mode==='door')f.db()[f.A].exits.east.status='locked';if(mode==='dead')f.actor().hp=0;if(mode==='recruited')f.actor().status='recruited';
    if(mode==='accepted')f.db()[f.A].minorMissions={m:{id:'m',status:'accepted',recipient:'Actor'}};
    if(mode==='unbuilt')f.db()[f.B].populationComplete=false;if(mode==='combat')f.db()[f.A].inhabitants.groups[0].status='engaged';
    f.tick(2);assert.ok(f.db()[f.A].inhabitants.actors.Actor,mode);assert.equal(f.db()[f.B].inhabitants.actors.Actor,undefined,mode);
    assert.equal(f.region.ledger.facts.length,0,mode);
  }
});
test('movement respects geometry and actors instead of walking through walls',()=>{
  const f=fixture();f.install('travel');f.tick(1);for(let y=1;y<9;y++)f.grids[f.A].cells['4,'+y].tile='wall';
  f.tick(2);assert.equal(f.actor().position.x,3);assert.equal(f.actor().residentPlan.status,'blocked');assert.equal(f.region.ledger.facts.length,0);
});
test('autonomous handoffs conserve exact owned metadata, cannot give equipped or quest items, and need a real recipient',()=>{
  const f=fixture(),item={name:'owned supply',type:'other',quantity:3,magic:0,description:'Existing authored object.'};
  f.actor().inventory=[structuredClone(item),{name:'bound item',minor_mission_id:'m1'},{name:'worn item',slot:'Armor'}];f.install('deliver-item');
  f.tick(1);for(let t=2;t<12&&f.actor().residentPlan.status!=='completed';t++)f.tick(t);
  assert.deepEqual(f.db()[f.A].inhabitants.actors.Receiver.inventory,[item]);assert.equal(f.actor().inventory.length,2);
  assert.equal(f.actor().residentPlan.receipts[0].quantity,3);assert.equal(f.actor().residentPlan.status,'completed');
  assert.equal(P.looseItems(f.actor(),P.protectedNames(f.state,f.db(),f.region)).length,0);
});
test('resource loss or recipient refusal blocks a handoff without minting an item',()=>{
  for(const mode of ['missing-item','dead-recipient','hostile-recipient']){
    const f=fixture();f.actor().inventory=[{name:'owned supply',type:'other'}];f.install('deliver-item');f.tick(1);
    if(mode==='missing-item')f.actor().inventory=[];else if(mode==='dead-recipient')f.db()[f.A].inhabitants.actors.Receiver.hp=0;else Object.assign(f.db()[f.A].inhabitants.actors.Receiver,{state:'Hostile',allegiance:'Hostile'});
    f.tick(2);assert.equal(f.actor().residentPlan.status,'blocked',mode);assert.equal(f.db()[f.A].inhabitants.actors.Receiver.inventory.length,0);
  }
});
test('the player can inspect, request a pause and resume; save/load keeps the unfinished plan',()=>{
  const f=fixture();f.install('travel');f.tick(1);
  assert.match(P.command(f.state,'resident plan status Actor').content,/An authored personal intention/);
  assert.equal(P.command(f.state,'resident plan pause Actor').dialogue[0].line,'I can wait.');
  const saved=JSON.parse(f.state.getRoomNameDatabase());assert.equal(saved[f.A].inhabitants.actors.Actor.residentPlan.status,'paused');
  P.command(f.state,'resident plan resume Actor');assert.equal(JSON.parse(f.state.getRoomNameDatabase())[f.A].inhabitants.actors.Actor.residentPlan.status,'active');
});
test('authoring offers only bound actions, is isolated, uses no scenario examples, and does not run on ordinary ticks',async()=>{
  const f=fixture();assert.ok(P.queue(f.state,f.db(),f.region,{turn:1,meaningful:true,key:f.A}));
  const request=f.actor().residentPlanRequest;let calls=0,prompt='';
  const $={model:'test',run:async(work,state,options)=>{assert.equal(state,null);assert.equal(options.shouldSaveToLog,false);return work({user:async t=>{prompt=t;}});}};
  const result=await P.author($,{setting:{kind:'original-world',genres:['western']}},f.entry(),request,async(agent,opts)=>{
    calls++;assert.equal(opts.delegated,true);assert.deepEqual(opts.parameters.choice.enum,['none',...request.options.map(o=>o.id)]);
    return{value:opts.validate({choice:request.options[0].id,intent:'A personal reason.',activity:'Heading onward.',beginReply:'I am going now.',mayWait:true,waitReply:'I can wait.',resumeReply:'I will continue.'})};
  });
  assert.equal(calls,1);assert.match(prompt,/western/);assert.doesNotMatch(prompt,/Tartarus|harp|refuge|sanctuary|market restoration/);
  P.install(f.actor(),request,result,1);f.tick(2);assert.equal(calls,1);
  assert.equal(P.queue(f.state,f.db(),f.region,{turn:2,meaningful:false,key:f.A}),null);
});
test('main-quest and accepted-work people are never reassigned by a plan',()=>{
  const f=fixture();f.state.setTasks([{requiredElements:[{type:'monster',name:'Actor',placement:f.A}]}]);
  assert.deepEqual(P.options(f.state,f.db(),f.region,f.entry()),[]);
  assert.equal(P.queue(f.state,f.db(),f.region,{turn:1,meaningful:true,key:f.A}),null);
});

test('service providers and starter-room residents retain their roles',()=>{
  const f=fixture();f.db()[f.A].inhabitants.serviceProviders=['Actor'];
  assert.deepEqual(P.options(f.state,f.db(),f.region,f.entry()),[]);
  assert.equal(P.eligible(f.state,f.db(),f.region,{...f.entry(),roomKey:'0,0,0'}),false);
});

test('travel carries complete equipment metadata and clears the source console snapshot',()=>{
  const f=fixture(),gear={name:'existing weapon',type:'weapon',attack_modifier:2,damage_modifier:3,ac:0,magic:0,range_tiles:7,damage_dice:'2d8',custom:{authored:true}};
  f.actor().sheet=f.actor().sheet.replace('Weapon: None','Weapon: existing weapon');
  f.db()[f.A].inhabitants.equipmentProperties=JSON.stringify(gear);f.install('travel');
  for(let t=1;t<15&&f.actor().residentPlan.status!=='completed';t++)f.tick(t);
  assert.deepEqual(JSON.parse('['+f.db()[f.B].inhabitants.equipmentProperties+']'),[gear]);
  assert.doesNotMatch(f.db()[f.A].monsters.consoleBlock,/^Actor$/m);
  assert.match(f.db()[f.B].monsters.consoleBlock,/^Actor$/m);
});

test('unfinished physical progress resumes after JSON save/load without reauthoring',()=>{
  const f=fixture();f.install('travel');f.tick(1);f.tick(2);
  const restored=JSON.parse(JSON.stringify(f.db())),region=restored['0,0,0'].livingRegion;
  const before=restored[f.A].inhabitants.actors.Actor.position;
  assert.deepEqual(before,{x:4,y:3});
  for(let t=3;t<15;t++)P.tick(f.state,restored,region,{turn:t,key:f.A});
  const actor=restored[f.B].inhabitants.actors.Actor;
  assert.equal(actor.residentPlan.status,'completed');assert.equal(actor.residentPlan.receipts.length,1);
  assert.equal(region.ledger.facts.length,1);assert.ok(L.verify(region.ledger).ok);
});

test('the background engine queues, authors, merges and persists plans without holding a turn open',async()=>{
  const LR=require('../retort/livingRegion'),f=fixture();await LR.jobs.settle();LR.jobs.clear();
  Object.assign(f.region,LR.compile({communities:[],residents:[]},{runId:'plans',setting:{kind:'children-of-the-grave'}}));
  f.region.social.status='authored';W.init(f.region).active=[{name:'Actor'}];W.person(f.region,'Actor');
  P.queue(f.state,f.db(),f.region,{turn:1,meaningful:true,key:f.A});
  let calls=0;
  const agent={model:'test',run:async work=>work({user:async()=>{}})};
  const request=async(a,o)=>{calls++;return{value:o.validate({choice:'action0',intent:'A personal destination.',activity:'Walking onward.',
    beginReply:'I have somewhere to go.',mayWait:true,waitReply:'I can wait.',resumeReply:'Onward.'})};};
  await LR.ensure(agent,f.state,{request});await LR.jobs.settle();assert.equal(calls,1);
  const db=JSON.parse(f.state.getRoomNameDatabase()),region=db['0,0,0'].livingRegion;
  assert.equal(f.state.getRoomPopulation(f.A).actors.Actor.residentPlanRequest.status,'running');
  LR.mergeJobs(db,region,f.state,[],new Set());
  assert.equal(db[f.A].inhabitants.actors.Actor.residentPlan.status,'ready');
  f.state.setRoomNameDatabase(JSON.stringify(db));
  for(let t=2;t<15;t++)LR.turn(f.state,{geoKey:f.A,consoleText:f.state.getUpdatedGameConsole()+'\nTurns: '+t});
  const saved=JSON.parse(f.state.getRoomNameDatabase());
  assert.ok(saved[f.B].inhabitants.actors.Actor);assert.doesNotMatch(saved[f.A].monsters.consoleBlock,/^Actor$/m);
  assert.equal(saved['0,0,0'].livingRegion.ledger.facts.filter(e=>e.evidence?.[0]?.category==='resident-action').length,1);
  assert.equal(calls,1);LR.jobs.clear();
});

test('an invalid author choice cannot install or execute a fabricated action',()=>{
  const f=fixture(),request={id:'rp:invalid',options:P.options(f.state,f.db(),f.region,f.entry())};
  f.actor().residentPlanRequest=request;
  assert.throws(()=>P.install(f.actor(),request,{choice:'invented-route'},0),/Unbound/);
  assert.equal(f.actor().residentPlan,undefined);assert.equal(f.region.ledger.facts.length,0);
});

test('a duplicate identity cannot be relocated or given a second inventory',()=>{
  const f=fixture();f.db()[f.B].inhabitants.actors.Actor=structuredClone(f.actor());
  assert.deepEqual(P.options(f.state,f.db(),f.region,f.entry()),[]);
  assert.equal(P.queue(f.state,f.db(),f.region,{turn:1,meaningful:true,key:f.A}),null);
});

test('the character sheet exposes normal activity and wait/resume actions through the command gate',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),nodes=[],input={value:''},sent=[];
  const element=()=>{const e={style:{},children:[],events:{},appendChild(c){this.children.push(c);},addEventListener(k,fn){this.events[k]=fn;},remove(){},setAttribute(){}};nodes.push(e);return e;};
  const sheet=element(),actor={name:'Actor',type:'monster',hp:15,state:'Neutral',residentPlan:{status:'active'}};
  const document={body:element(),querySelectorAll:()=>[],createElement:element,getElementById:id=>id==='party-popup'?sheet:id==='chatuserinput'?input:null};
  const window={combatCharacters:[actor],openCombatCharacterSheet(){},chatbotprocessinput(){sent.push(input.value);input.value='';}};
  vm.runInNewContext(fs.readFileSync('assets/combatCharacterUi.js','utf8'),{window,document});
  window.CombatCharacterUi.open(actor);nodes.find(n=>n.textContent==='Current Activity').events.click();
  nodes.find(n=>n.textContent==='Ask Them To Wait').events.click();
  actor.residentPlan.status='paused';window.CombatCharacterUi.open(actor);nodes.find(n=>n.textContent==='Let Them Continue').events.click();
  assert.deepEqual(sent,['resident plan status Actor','resident plan pause Actor','resident plan resume Actor']);
  window.GameCommandGate={busy:()=>true};nodes.find(n=>n.textContent==='Let Them Continue').events.click();assert.equal(sent.length,3);
});

test('host-controlled and paused plans cannot be displaced by the browser idle random walk',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),game=fs.readFileSync('assets/game.js','utf8');
  const start=game.indexOf('function updateMonsterWandering('),end=game.indexOf('\nfunction ',start+1);
  const entries=['ready','active','paused'].map(status=>({name:status,residentPlan:{status}})),reset=[];
  const context={currentDungeon:{cells:{}},window:{},isCombatRoundActive:()=>false,getCurrentCombatRoomKey:()=> '1,0,0',resetWalkFrame:e=>reset.push(e.name)};
  vm.runInNewContext(game.slice(start,end),context);context.updateMonsterWandering(entries,new Set(),1000,true);
  assert.deepEqual(reset,['ready','active','paused']);
});

test('the actual server checkpoint codec preserves plans, receipts and population caches',()=>{
  const State=require('../sharedState'),Shape=require('../saveGameState'),f=fixture();f.install('travel');f.tick(1);f.tick(2);
  const snapshot={...State.exportSaveState(),dungeonRunId:'plans',lastCoords:{x:1,y:0,z:0},updatedGameConsole:f.state.getUpdatedGameConsole(),
    roomNameDatabaseString:JSON.stringify(f.db()),combatCharactersString:f.state.getCombatCharactersString(),
    roomDungeonDatabase:f.grids,roomPopulations:{[f.A]:f.db()[f.A].inhabitants,[f.B]:f.db()[f.B].inhabitants},
    campaignMemory:{version:1,runId:'plans',records:[],sequence:0},characterGenerationInProgress:false,activeCityFloor:null};
  const saved=Shape.clone(Shape.validate(snapshot));State.importSaveState(saved,{graphicsReady:[f.A,f.B]});
  assert.deepEqual(State.exportSaveState(),saved);
  assert.equal(State.getRoomPopulation(f.A).actors.Actor.residentPlan.status,'active');
  const db=JSON.parse(State.getRoomNameDatabase()),region=db['0,0,0'].livingRegion;
  for(let turn=3;turn<15;turn++)P.tick(State,db,region,{turn,key:f.A});
  State.setRoomNameDatabase(JSON.stringify(db));const completed=State.exportSaveState();State.importSaveState(completed,{graphicsReady:[f.A,f.B]});
  assert.equal(State.getRoomPopulation(f.A).actors.Actor,undefined);
  assert.equal(State.getRoomPopulation(f.B).actors.Actor.residentPlan.receipts.length,1);
  assert.equal(JSON.parse(State.getRoomNameDatabase())[f.B].inhabitants.actors.Actor.residentPlan.status,'completed');
});
