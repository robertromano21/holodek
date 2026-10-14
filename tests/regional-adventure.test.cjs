'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../retort/regionalAdventure'), S = require('../retort/questScenes'), Q = require('../retort/questProgress');
const I = require('../assets/dungeonInhabitants'), W = require('../assets/questWritings'), E = require('../retort/economy');
const Journal = require('../retort/adventureJournal'), Factions = require('../retort/factionMemory'), Boss = require('../retort/bossGate');
const Read = require('../retort/readableActions'), { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const actorSheet = (name, hp = 20) => sheet({ Name: name, Race: 'Human', Sex: 'Female', Class: 'Fighter', Level: 1, HP: hp, MaxHP: 20 }, 6, 'npc');
const authored = require('./fixtures/regional-adventure.cjs');
function base() {
  const p = I.createPopulation('1,0,0', [{ name: 'Edrin Farrows', hp: 20, allegiance: 'Neutral', encounterId: 'contact', sheet: actorSheet('Edrin Farrows') }]);
  p.actors['Edrin Farrows'].hp = 20;
  p.actors['Edrin Farrows'].sheet = actorSheet('Edrin Farrows');
  const db = { '0,0,0': { name: 'Ruined Temple Entrance', objects: [], exits: { east: { status: 'open' } } },
    '1,0,0': { name: 'Hall of Witnesses', exits: { west: { status: 'open' }, north: { status: 'open' }, east: { status: 'open' } }, objects: [],
      inhabitants: p, monsters: { inRoom: 'Edrin Farrows', consoleBlock: actorSheet('Edrin Farrows'), state: 'Neutral' } },
    '1,1,0': { name: 'Published Spring Trail', classification: { indoor: false }, objects: [], exits: {} },
    '2,0,0': { name: 'The Bound Sanctuary', objects: [], exits: {}, monsters: { inRoom: actorSheet('Ash Regent', 40), state: 'Hostile' } } };
  const text = `Room Name: Hall of Witnesses\nCoordinates: X: 1, Y: 0, Z: 0\nQuests Achieved: 0/21\nCurrent Quest: Recover Sepulchra\nQuest Progress: Pending\nInventory: Empty\nInventory Properties: None\nObjects in Room: hidden sword\nObjects in Room Properties: None\nNext Boss: Ash Regent\nNext Boss Room: The Bound Sanctuary\nBoss Room Coordinates: X: 2, Y: 0, Z: 0\nNext Artifact: Sepulchra\nPC:\n${actorSheet('Hero')}\nNPCs in Party: None\nMonsters in Room:\n${actorSheet('Edrin Farrows')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`;
  const gate = Boss.ensureBossGate(db, text).gate;
  return { db, text, gate };
}
function fixture() {
  const initial = base(), result = R.compile(authored(), initial.db, '1,0,0', initial.gate, initial.text, 'regional-run');
  assert.ok(result, 'The regional story must compile against actual world bindings');
  let database = JSON.stringify(result.database), text = initial.text, tasks = [result.task], index = 0, geoKey = '1,0,0', wire = '[]', paused = false;
  const dungeons = new Map(), populations = new Map();
  for (const [key, room] of Object.entries(result.database)) {
    const d = { geoKey: key, start: { x: 2, y: 2 }, layout: { width: 12, height: 12 }, cells: {}, tiles: {}, sceneObjects: [] };
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) d.cells[`${x},${y}`] = { tile: x===0||y===0||x===11||y===11 ? 'wall' : 'floor', floorHeight: .2, ceilHeight: 3 };
    W.apply(d, room); dungeons.set(key, d);
    if (room.regionalSite) {
      const birth = R.bindPopulation(room, { population: I.createPopulation(key, [], { indoor: room.indoor }), equipment: [], sheets: '' });
      room.inhabitants = birth.population; room.monsters.inRoom = birth.sheets; room.monsters.consoleBlock = birth.sheets;
      room.populationComplete = true;
    }
    if (room.inhabitants) {
      for (const [i, a] of Object.values(room.inhabitants.actors).entries()) a.position = a.home = { x: 3 + i, y: 2 };
      for (const g of room.inhabitants.groups) g.site = { x: 3, y: 2 };
      populations.set(key, room.inhabitants);
    }
  }
  database = JSON.stringify(result.database);
  const state = { getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getDungeonRunId: () => 'regional-run', getCurrentQuest: () => 'Recover Sepulchra', getCurrentTasks: () => tasks, setCurrentTasks: v => tasks = v,
    getCurrentTaskIndex: () => index, setCurrentTaskIndex: v => index = v, setQuestSeeded() {}, setLastQuestUpdate() {},
    getLastCoords: () => { const [x,y,z] = geoKey.split(',').map(Number); return {x,y,z}; },
    getGamePaused: () => paused, getRoomDungeon: () => dungeons.get(geoKey), getRoomDungeonForSimulation: () => dungeons.get(geoKey),
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: key => populations.get(key), setRoomPopulation: (key, value) => populations.set(key, value) };
  const service = createPopulationService(state);
  function travel(key) {
    const companions = I.parseSheets(text, 'NPCs in Party'); geoKey = key;
    const db = JSON.parse(database), p = db[key]?.inhabitants;
    if (p) populations.set(key, p);
    const residents = I.residentSheets(p), coords = state.getLastCoords();
    text = E.write(E.write(text, 'Coordinates', `X: ${coords.x}, Y: ${coords.y}, Z: ${coords.z}`), 'Room Name', db[key]?.name);
    text = text.replace(I.sectionPattern('Monsters in Room'), (_, head) => head + '\n' + (residents.map(a=>a.rawSheet).join('\n') || 'None') + '\n');
    wire = JSON.stringify([{name:'Hero',type:'pc',hp:20,mazeX:2,mazeY:2,mazeRoomKey:key},
      ...companions.map(a=>({name:a.name,type:'npc',hp:a.hp,mazeX:2,mazeY:2,mazeRoomKey:key})),
      ...residents.map(a=>({name:a.name,type:'monster',hp:a.hp,state:a.state,mazeX:p.actors[a.name].position.x,mazeY:2,mazeRoomKey:key}))]);
    S.refresh(state);
  }
  function choose(optionId) {
    const offered = S.view(state), scene = offered.scene; assert.ok(scene, offered.error || 'A real nearby scene must be available');
    return S.choose(state, service, { runId:'regional-run',geoKey,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId });
  }
  function read() {
    const stage = tasks[0].story.stages.find(s=>s.id===S.runtime(tasks[0], JSON.parse(database)).stage);
    const w = dungeons.get(geoKey).questWritings.find(w=>w.id===stage.readableId); assert.ok(w);
    const roster = JSON.parse(wire), pc = roster[0];
    pc.mazePoint = { x: w.position.x, y: w.position.y }; pc.mazeX = Math.floor(w.position.x); pc.mazeY = Math.floor(w.position.y); wire = JSON.stringify(roster);
    return choose('read');
  }
  function defeat(stageId) {
    const stage = tasks[0].story.stages.find(s=>s.id===stageId), db = JSON.parse(database), p = db[stage.roomKey].inhabitants;
    for (const name of stage.targets) { p.actors[name].hp = 0; p.actors[name].status = 'dead'; p.actors[name].sheet = p.actors[name].sheet.replace(/HP: \d+/, 'HP: 0'); }
    const sheets = I.residentSheets(p).map(a=>a.rawSheet).join('\n'); db[stage.roomKey].monsters.inRoom = sheets; db[stage.roomKey].monsters.consoleBlock = sheets;
    database = JSON.stringify(db); travel(stage.roomKey); S.refresh(state);
  }
  function reachRescue() { assert.equal(choose('accept').error, undefined); travel(result.route.rooms[1]); assert.equal(read().error, undefined);
    travel(result.route.rooms[2]); defeat('road'); travel(result.route.rooms[3]); defeat('temple'); }
  travel('1,0,0');
  return { state, service, result, travel, read, choose, defeat, reachRescue, db:()=>JSON.parse(database),
    runtime:()=>S.runtime(tasks[0], JSON.parse(database)), task:()=>tasks[0], pause:()=>paused=true };
}
test('LLM-authored region preserves published rooms, binds six mortal roles and never creates a boss key', () => {
  const f = fixture(), db = f.db();
  assert.equal(S.valid(f.task().story, f.result.database), true);
  assert.equal(db['1,1,0'].name, 'Published Spring Trail');
  assert.equal(db['2,0,0'].bossGate.keySeeded, false);
  assert.equal(db['1,0,0'].exits.east.status, 'locked');
  assert.equal(db[f.result.route.rooms[3]].classification.indoor, true);
  assert.equal(f.task().requiredElements.length, 6);
  assert.equal(Object.values(db).flatMap(r=>r.objects||[]).filter(o=>Boss.isReservedBossKeyName(db,o.name)).length, 0);
});
test('rescue requires actual reading, defender deaths, explicit recruitment and live escort arrival', () => {
  const f = fixture(); assert.equal(Q.verifiedTaskCompletion(f.task(), Q.evaluateTaskRequirements(f.task(), { database:f.db(),consoleText:f.state.getUpdatedGameConsole() })), false);
  assert.equal(f.choose('shared-wells').error, 'That choice is not available in this stage.');
  f.reachRescue(); assert.equal(f.runtime().stage, 'rescue');
  assert.equal(f.choose('escort').error, undefined); assert.equal(f.runtime().stage, 'escort');
  const prisoner = f.task().story.stages.find(s=>s.id==='rescue').actor;
  assert.ok(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').some(a=>a.name===prisoner));
  f.travel(f.result.route.rooms[0]); assert.equal(f.runtime().stage, 'resolution');
  const arrival = f.runtime().history.find(h=>h.from==='escort'); assert.ok(arrival.evidence.hp>0);
  assert.equal(arrival.evidence.source, 'engine-escort-arrival-v1');
  assert.equal(f.choose('shared-wells').error, undefined); assert.equal(f.state.getCurrentTaskIndex(), 1);
  assert.equal(S.isComplete(f.task(), f.db()), true);
  assert.equal(f.db()['0,0,0'].factionMemory.standings.wellkeepers, 2);
  assert.equal(f.db()['0,0,0'].adventureJournal.length, 1);
  assert.equal(f.db()['2,0,0'].bossGate.keySeeded, false, 'Only the existing next-step seeder may mint the key');
  assert.ok(S.choose(f.state,f.service,{optionId:'shared-wells'}).error);
});
test('testimony is a real alternate read-and-return path, not an invented rescue', () => {
  const f = fixture(); f.reachRescue(); assert.equal(f.choose('records').error, undefined);
  assert.equal(f.runtime().stage, 'testimony'); assert.ok(f.choose('caravan-stewards').error);
  assert.equal(f.read().error, undefined); f.travel(f.result.route.rooms[0]);
  assert.equal(f.choose('caravan-stewards').error, undefined);
  assert.equal(S.isComplete(f.task(),f.db()), true);
  assert.ok(!f.runtime().history.some(h=>h.evidence.source==='engine-escort-arrival-v1'));
  assert.equal(f.db()['0,0,0'].factionMemory.standings.salvagers, 2);
  assert.match(Journal.project(f.state).history[0].outcome,/rescue not completed/);
  assert.ok(Journal.project(f.state).facts.some(f=>/prison register/.test(f.text)));
});
test('a full party retains a verified testimony alternative instead of consuming a failed recruitment choice',()=>{
  const f=fixture();f.reachRescue();
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace(I.sectionPattern('NPCs in Party'),(_,head)=>head+'\n'+
    Array.from({length:12},(_,i)=>actorSheet('Companion '+i)).join('\n')+'\n'));
  const revision=f.runtime().revision;assert.match(f.choose('escort').error,/party is full/);
  assert.equal(f.runtime().revision,revision);assert.equal(f.choose('records').error,undefined);
  assert.equal(f.read().error,undefined);f.travel(f.result.route.rooms[0]);assert.equal(f.choose('shared-wells').error,undefined);
});
test('a dead rescue contact leaves physically readable testimony and cannot receive recruitment credit',()=>{
  const f=fixture();f.reachRescue();const db=f.db(),stage=f.task().story.stages.find(s=>s.id==='rescue'),p=db[stage.roomKey].inhabitants;
  p.actors[stage.actor].hp=0;p.actors[stage.actor].status='dead';p.actors[stage.actor].sheet=p.actors[stage.actor].sheet.replace(/HP: \d+/,'HP: 0');
  db[stage.roomKey].monsters.inRoom=I.residentSheets(p).map(a=>a.rawSheet).join('\n');f.state.setRoomNameDatabase(JSON.stringify(db));f.travel(stage.roomKey);
  const w=f.state.getRoomDungeon().questWritings.find(w=>w.id===stage.fallback.readableId),roster=JSON.parse(f.state.getCombatCharactersString());
  roster[0].mazePoint={x:w.position.x,y:w.position.y};f.state.setCombatCharactersString(JSON.stringify(roster));
  assert.ok(f.choose('escort').error);assert.equal(f.choose('records').error,undefined);assert.equal(f.read().error,undefined);
  f.travel(f.result.route.rooms[0]);assert.equal(f.choose('shared-wells').error,undefined);
});
test('JSON reload retains exact rescue receipts and fake cover inspection cannot advance investigation',()=>{
  const f=fixture();f.choose('accept');f.travel(f.result.route.rooms[1]);
  const stage=f.task().story.stages.find(s=>s.id==='investigation'),d=f.state.getRoomDungeon(),w=d.questWritings.find(w=>w.id===stage.readableId);
  const roster=JSON.parse(f.state.getCombatCharactersString());roster[0].mazePoint={x:w.position.x,y:w.position.y};
  const plan=Read.prepare({input:'examine '+stage.name,consoleText:f.state.getUpdatedGameConsole(),database:f.db(),dungeon:d,actor:roster[0],geoKey:stage.roomKey});
  assert.equal(plan.allowed,true);S.onRead(f.state,plan);assert.equal(f.runtime().stage,'investigation');
  f.state.setCurrentTasks(JSON.parse(JSON.stringify(f.state.getCurrentTasks())));assert.equal(f.read().error,undefined);
  f.defeat('road');f.defeat('temple');f.choose('escort');f.travel(f.result.route.rooms[0]);f.choose('shared-wells');
  f.state.setCurrentTasks(JSON.parse(JSON.stringify(f.state.getCurrentTasks())));assert.equal(S.isComplete(f.task(),f.db()),true);
  const db=f.db(),oldScore=db['0,0,0'].factionMemory.standings.wellkeepers;
  assert.equal(Factions.record(db,'regional-run',{id:f.task().story.id+':resolution',storyId:f.task().story.id,choice:'shared-wells',summary:'Replay',effects:{wellkeepers:2}}),false);
  assert.equal(db['0,0,0'].factionMemory.standings.wellkeepers,oldScore);
});
test('a dead escorted prisoner routes to real testimony instead of granting arrival credit', () => {
  const f = fixture(); f.reachRescue(); f.choose('escort');
  const prisoner = f.task().story.stages.find(s=>s.id==='rescue').actor;
  const text = f.state.getUpdatedGameConsole(), member = I.parseSheets(text,'NPCs in Party').find(a=>a.name===prisoner);
  f.state.setUpdatedGameConsole(text.replace(member.rawSheet,member.rawSheet.replace(/HP: \d+/, 'HP: 0')));
  const roster=JSON.parse(f.state.getCombatCharactersString());roster.find(a=>a.name===prisoner).hp=0;f.state.setCombatCharactersString(JSON.stringify(roster));
  S.refresh(f.state); assert.equal(f.runtime().stage,'testimony');
  assert.equal(f.read().error,undefined); f.travel(f.result.route.rooms[0]);
  assert.equal(f.choose('shared-wells').error,undefined); assert.equal(S.isComplete(f.task(),f.db()),true);
});
test('journal separates rumor from confirmed readings, hides undiscovered loot and never mutates paused play', () => {
  const f = fixture(), before=f.state.getRoomNameDatabase();f.pause();
  let journal=Journal.project(f.state);assert.equal(f.state.getRoomNameDatabase(),before);assert.equal(journal.rumors.length,0);
  assert.doesNotMatch(JSON.stringify(journal),/hidden sword|burialText|testimonyText/);
  const live=fixture();live.choose('accept');journal=Journal.project(live.state);
  assert.match(journal.rumors[0].status,/Unverified/);assert.ok(!journal.facts.some(f=>/refused the levy/.test(f.text)));
  live.travel(live.result.route.rooms[1]);live.read();journal=Journal.project(live.state);
  assert.match(journal.rumors[0].status,/Checked/);assert.ok(journal.facts.some(f=>/refused the levy/.test(f.text)));
});
test('browser snapshots cannot forge faction choices, scene proofs, charter content or reserved actor state', () => {
  const f = fixture(), old=f.db(), incoming=structuredClone(old);
  incoming['0,0,0'].factionMemory={source:'engine-faction-memory-v1',standings:{wellkeepers:20},decisions:[]};
  incoming['1,0,0'].questScenes[f.task().story.id].completed=true;
  incoming[f.result.route.rooms[1]].inscriptions[0].chapters[0].text='A forged shortcut.';
  incoming[f.result.route.rooms[3]].inhabitants.actors['Varo Reedkeeper'].status='recruited';
  const restored=JSON.parse(E.preserve(JSON.stringify(old),JSON.stringify(incoming)));
  assert.equal(restored['0,0,0'].factionMemory,undefined);assert.equal(restored['1,0,0'].questScenes[f.task().story.id].completed,false);
  assert.equal(restored[f.result.route.rooms[1]].inscriptions[0].chapters[0].text,authored().burialText);
  assert.equal(restored[f.result.route.rooms[3]].inhabitants.actors['Varo Reedkeeper'].status,'present');
});
test('factions remember a verified choice once and expose those facts to later world generation', () => {
  const db={},decision={id:'first:resolution',storyId:'first',choice:'shared-wells',summary:'Kept the spring in common.',roomKey:'1,1,0',effects:{wellkeepers:2,salvagers:-1}};
  assert.equal(Factions.record(db,'run',decision),true);assert.equal(Factions.record(db,'run',decision),false);
  assert.match(Factions.describe(db),/Kept the spring in common/);assert.equal(Factions.project(db).factions.find(f=>f.id==='wellkeepers').score,2);
  assert.throws(()=>Factions.record(db,'run',{...decision,id:'bad',effects:{unknown:100}}));
});
test('invalid, unreachable, later and disabled first-adventure proposals retain the older generator fallback', async () => {
  const b=base(); let calls=0,tasks=[],database=JSON.stringify(b.db),text=b.text;
  const state={getDungeonRunId:()=> 'run',getCurrentTasks:()=>tasks,getCurrentTaskIndex:()=>0,getCurrentQuest:()=> 'Recover Sepulchra',
    getRoomNameDatabase:()=>database,setRoomNameDatabase:v=>database=v};
  const assistant=Object.assign(async()=>{}, {generation:async()=>{calls++;return {content:'not JSON'};}}), $={assistant};
  assert.equal(await R.trySeed($,state,b.db,'1,0,0',b.gate,text),null);assert.equal(calls,1);
  assert.equal(await R.trySeed($,state,JSON.parse(database),'1,0,0',b.gate,text),null);assert.equal(calls,1);
  tasks=[{desc:'An existing active task'}];assert.equal(await R.trySeed($,state,base().db,'1,0,0',b.gate,text),null);assert.equal(calls,1);
  tasks=[];assert.equal(await R.trySeed($,state,base().db,'1,0,0',b.gate,text.replace('0/21','1/21')),null);assert.equal(calls,1);
  const old=process.env.REGIONAL_ADVENTURES;process.env.REGIONAL_ADVENTURES='off';
  try {assert.equal(await R.trySeed($,state,base().db,'1,0,0',b.gate,text),null);assert.equal(calls,1);}
  finally {if(old===undefined)delete process.env.REGIONAL_ADVENTURES;else process.env.REGIONAL_ADVENTURES=old;}
  const blocked=base();blocked.db['1,1,0'].visited=true;assert.equal(R.compile(authored(),blocked.db,'1,0,0',blocked.gate,text,'run'),null);
});
test('successful first-adventure LLM output is validated and committed only by the calling seeder', async () => {
  const b=base();let stored=JSON.stringify(b.db),calls=0;const prompts=[];
  const assistant=Object.assign(async(parts,...values)=>prompts.push(parts.reduce((s,p,i)=>s+p+(values[i]||''),'')),
    {generation:async()=>{calls++;return {content:JSON.stringify(authored())};}});
  const state={getDungeonRunId:()=> 'run',getCurrentTasks:()=>[],getCurrentTaskIndex:()=>0,getCurrentQuest:()=> 'Recover Sepulchra',setRoomNameDatabase:v=>stored=v};
  const result=await R.trySeed({assistant},state,b.db,'1,0,0',b.gate,b.text);
  assert.ok(result);assert.equal(calls,1);assert.match(prompts[0],/FIRST connected regional adventure/);
  assert.match(prompts[0],/escort them alive/);assert.equal(JSON.parse(stored)['0,0,0'].regionalAdventure,undefined);
  assert.equal(result.database['0,0,0'].regionalAdventureAttempt.status,'compiled');
});
test('reserved actor names, contradictory temple patrons and known character names fail validation',()=>{
  const b=base();
  for(const name of ['__proto__','constructor','prototype','Edrin Farrows','Mortacia']) {
    const raw=authored();raw.actors[0].name=name;
    assert.equal(R.compile(raw,b.db,'1,0,0',b.gate,b.text,'run'),null);
  }
  const raw=authored();raw.sites[3].name='Temple of Arithus';raw.templePatron='Dantuea';
  assert.equal(R.compile(raw,b.db,'1,0,0',b.gate,b.text,'run'),null);
  raw.templePatron='Arithus';const result=R.compile(raw,b.db,'1,0,0',b.gate,b.text,'run');
  assert.equal(result.database[result.route.rooms[3]].campaignSetting.religion.patron,'Arithus');
});
test('a diagonal existing route is usable and does not create another exit in the source room',()=>{
  const b=base();b.db['1,0,0'].exits={northeast:{status:'open',targetCoordinates:'2,1,0'}};
  const before=structuredClone(b.db['1,0,0'].exits),result=R.compile(authored(),b.db,'1,0,0',b.gate,b.text,'run');
  assert.equal(result.route.direction,'northeast');assert.deepEqual(result.database['1,0,0'].exits,before);
  assert.equal(result.database['2,1,0'].exits.southwest.targetCoordinates,'1,0,0');
});
test('repopulating a saved reserved site cannot resurrect its prisoner or reset its original sheet',()=>{
  const f=fixture(),key=f.result.route.rooms[3],room=f.db()[key],name='Varo Reedkeeper';
  room.inhabitants.actors[name].hp=0;room.inhabitants.actors[name].status='dead';
  const result=R.bindPopulation(room,{population:I.createPopulation(key,[],{indoor:true}),equipment:[],sheets:''});
  assert.equal(result.population.actors[name].hp,0);assert.equal(result.population.actors[name].status,'dead');
  assert.equal(I.parseBlocks(result.sheets).find(a=>a.name===name).hp,0);
});
test('later character dialogue receives remembered faction outcomes in its existing single model call',async()=>{
  const db={};Factions.record(db,'run',{id:'decision',storyId:'regional',choice:'shared-wells',summary:'Protected the shared spring.',effects:{wellkeepers:2}});
  const prompts=[];let calls=0;const tagged=(parts,...values)=>prompts.push(typeof parts==='string'?parts:String.raw({raw:parts},...values));
  const agent={user:tagged,system:tagged,assistant:{generation:async()=>{calls++;return{content:'{"spoken":[],"replies":[]}'};}}};
  await require('../retort/characterDialogue').generateCharacterDialogue(agent,{characters:[{name:'Mason',factionId:'wellkeepers'}],factionMemory:Factions.describe(db)});
  assert.equal(calls,1);assert.ok(prompts.some(p=>p.includes('Protected the shared spring.')));
});
