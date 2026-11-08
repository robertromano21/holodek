'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { EventEmitter } = require('node:events');
const Opening = require('../retort/openingQuestPreparation'), Build = require('../retort/roomBuildState');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  let run = 'opening-run', revision = 0, quest = 'None', tasks = [], index = 0, seeded = false;
  let text = 'Coordinates: X: 0, Y: 1, Z: 0\nCurrent Quest: None\nNext Artifact: None\nNext Boss: None\nNext Boss Room: None\nBoss Room Coordinates: None';
  let db = { '0,0,0': { name: 'Entrance', populationComplete: true, objects: [], exits: { north: { status: 'open', targetCoordinates: '0,1,0' } } },
    '0,1,0': { name: 'North Court', populationComplete: true, objects: [], exits: {} },
    '0,-1,0': { name: 'South Court', populationComplete: true, objects: [], exits: {} } };
  const dungeon = key => ({ geoKey: key, layout: { width: 12, height: 12 }, start: { x: 2, y: 2 },
    cells: Object.fromEntries(Array.from({ length: 144 }, (_, n) => [n % 12 + ',' + Math.floor(n / 12),
      { tile: n % 12 === 0 || n % 12 === 11 || n < 12 || n >= 132 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 5 }])),
    _geometryStamp: 'unchanged', sceneObjects: [], tiles: {} });
  const dungeons = Object.fromEntries(Object.keys(db).map(k => [k, dungeon(k)]));
  const state = { getDungeonRunId: () => run, getRestoreRevision: () => revision, getCurrentQuest: () => quest,
    setCurrentQuest: v => { quest = v; }, getCurrentTasks: () => tasks, setCurrentTasks: v => { tasks = v; },
    getCurrentTaskIndex: () => index, setCurrentTaskIndex: v => { index = v; }, setQuestSeeded: v => { seeded = v; },
    getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: v => { db = JSON.parse(v); },
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => { text = v; },
    getRoomDungeonForSimulation: c => dungeons[`${c.x},${c.y},${c.z}`], setRoomDungeon: (c, v) => { dungeons[`${c.x},${c.y},${c.z}`] = v; },
    exportSaveState: () => ({ roomNameDatabaseString: JSON.stringify(db), roomDungeonDatabase: structuredClone(dungeons) }) };
  const model = { id: 'gpt-6-luna', revision: 1 }, settings = { enabled: true, location: 'local', revision: 0 };
  const website = { helperSettings: () => settings, view: () => ({ revision: 1 }) }, workers = [], jobs = [];
  const service = Opening.service(state, { website, models: { current: () => model }, logger: { info() {} }, ...options,
    spawn(job, snapshot) { const worker = new EventEmitter(); worker.terminate = async () => {};
      workers.push(worker); jobs.push({ job, snapshot }); return worker; } });
  t.after(() => service.close());
  function artifact() {
    const job = jobs.at(-1).job, base = JSON.parse(jobs.at(-1).snapshot.roomNameDatabaseString), rooms = structuredClone(base);
    rooms['0,0,0'].objects.push({ name: 'ivory token', type: 'other', properties: { magic: 1 } });
    rooms[job.bossKey] = { name: 'Silent Vault', exits: {}, objects: [] };
    let task = require('../retort/questProgress').compileGeneratedTask({ id: 'task:opening', type: 'Fetch', actionKind: 'take_item',
      desc: 'Recover ivory token from Entrance.', metrics: 'The named token is carried.',
      requiredElements: [{ type: 'object', name: 'ivory token', placement: '0,0,0' }] }, rooms, '0,0,0');
    task = require('../retort/questScenes').compile(task, rooms, '0,0,0', { hookKind: 'writing' });
    return { stage: 'quest', jobId: job.id, runId: job.runId, base, rooms, task, quest: 'Recover the missing testimony.',
      fields: { 'Current Quest': 'Recover the missing testimony.', 'Next Artifact': 'Witness Crown', 'Next Boss': 'Silent Keeper',
        'Next Boss Room': 'Silent Vault', 'Boss Room Coordinates': 'X: 2, Y: 0, Z: 0' } };
  }
  return { state, service, settings, model, workers, jobs, dungeons, artifact, db: () => db,
    seeded: () => seeded, newRun: () => { run = 'other-run'; }, restore: () => revision++ };
}
test('private preparation starts once in room one without publishing quest, actors, objects or console changes', async t => {
  const s = fixture(t), before = s.state.exportSaveState(), text = s.state.getUpdatedGameConsole();
  const a = s.service.begin(); assert.equal(s.service.begin(), a); await tick();
  assert.equal(s.workers.length, 1); s.workers[0].emit('message', { type: 'checkpoint', artifact: s.artifact() }); await a.promise;
  assert.equal(s.service.status().phase, 'ready'); assert.equal(s.state.getCurrentQuest(), 'None');
  assert.deepEqual(s.state.exportSaveState(), before); assert.equal(s.state.getUpdatedGameConsole(), text);
  assert.equal(await s.service.activate('0,0,0'), false); assert.equal(s.seeded(), false);
});
for (const key of ['0,1,0', '0,-1,0']) test('the same prepared quest binds and physically installs before entering ' + key, async t => {
  const s = fixture(t), entry = s.service.begin(); await tick();
  const artifact = s.artifact(); s.workers[0].emit('message', { type: 'checkpoint', artifact }); await entry.promise;
  s.db()[key].playerDiscovery = 'must survive';
  assert.equal(await s.service.activate(key), true);
  assert.equal(s.state.getCurrentQuest(), artifact.quest); assert.equal(s.state.getCurrentTasks()[0].id, artifact.task.id);
  assert.equal(s.state.getCurrentTasks()[0].story.hook.roomKey, key); assert.equal(s.seeded(), true);
  assert.equal(s.db()[key].playerDiscovery, 'must survive');
  assert.ok(s.dungeons[key].questWritings.length); assert.equal(s.state.getCurrentTaskIndex(), 0);
  assert.equal(await s.service.activate(key), false); assert.equal(s.workers.length, 1);
});
test('early departure joins the existing author, never dispatches a second quest', async t => {
  const s = fixture(t); s.service.begin(); await tick(); let complete = false;
  const travel = s.service.activate('0,1,0').then(value => { complete = true; return value; }); await tick();
  assert.equal(complete, false); assert.equal(s.state.getCurrentQuest(), 'None');
  s.workers[0].emit('message', { type: 'checkpoint', artifact: s.artifact() });
  assert.equal(await travel, true); assert.equal(s.jobs.length, 1);
});

for(const status of ['recruited','dead','departed'])test('opening handoff preserves a '+status+' incidental contact without invalidating the prepared quest',async t=>{
  const s=fixture(t),name='Entrance Keeper',room=s.db()['0,0,0'];
  const sheet=`${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Friendly`;
  room.monsters={inRoom:sheet,consoleBlock:sheet,state:'Friendly'};room.inhabitants={actors:{[name]:{status:'present',hp:20}}};
  const entry=s.service.begin();await tick();const artifact=s.artifact();
  assert.equal(artifact.task.story.stages.find(stage=>stage.id==='objective').actor,name);
  assert.equal(artifact.task.story.stages.find(stage=>stage.id==='resolution').actor,name);
  s.workers[0].emit('message',{type:'checkpoint',artifact});await entry.promise;
  room.inhabitants.actors[name].status=status;room.monsters.inRoom='None';room.monsters.consoleBlock='None';
  if(status==='dead')room.inhabitants.actors[name].hp=0;
  assert.equal(await s.service.activate('0,1,0'),true);
  const task=s.state.getCurrentTasks()[0],resolution=task.story.stages.find(stage=>stage.id==='resolution');
  assert.equal(resolution.text,artifact.task.story.stages.find(stage=>stage.id==='resolution').text);
  assert.equal(resolution.actor,undefined);assert.equal(resolution.roomKey,'0,1,0');assert.equal(resolution.readableId,task.story.fallback.readableId);
  assert.ok(resolution.options.length);assert.ok(resolution.options.every(option=>!['recruit','receive'].includes(option.action)));
  assert.equal(task.story.stages.find(stage=>stage.id==='objective').actor,undefined);
  assert.deepEqual(task.requiredElements,artifact.task.requiredElements);assert.deepEqual(task.actionRequirements,artifact.task.actionRequirements);
  assert.equal(s.db()['0,0,0'].inhabitants.actors[name].status,status);assert.equal(s.db()['0,0,0'].monsters.inRoom,'None');
  assert.ok(require('../retort/questScenes').valid(task.story,s.db()));assert.equal(s.jobs.length,1);
});

test('handoff never silently replaces an unavailable recipient that is part of the actual delivery objective',async t=>{
  const s=fixture(t),name='Bound Recipient',room=s.db()['0,0,0'];
  const sheet=`${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Friendly`;
  room.monsters={inRoom:sheet,consoleBlock:sheet,state:'Friendly'};room.inhabitants={actors:{[name]:{status:'present',hp:20}}};
  const entry=s.service.begin();await tick();const artifact=s.artifact();
  const Q=require('../retort/questProgress'),Scenes=require('../retort/questScenes');
  artifact.task=Scenes.compile(Q.compileGeneratedTask({id:'task:delivery',type:'Deliver',actionKind:'deliver_item',
    desc:'Deliver ivory token to '+name+'.',requiredElements:[{type:'object',name:'ivory token',placement:'0,0,0'},
      {type:'monster',name,placement:'0,0,0'}]},artifact.rooms,'0,0,0'),artifact.rooms,'0,0,0',{hookKind:'writing'});
  assert.ok(artifact.task.story);assert.equal(Q.deliveryBindings(artifact.task)[0].recipient,name);
  s.workers[0].emit('message',{type:'checkpoint',artifact});await entry.promise;
  room.inhabitants.actors[name].status='departed';room.monsters.inRoom='None';room.monsters.consoleBlock='None';
  const before=s.state.getRoomNameDatabase();
  await assert.rejects(s.service.activate('0,1,0'),/does not fit/);
  assert.equal(s.state.getRoomNameDatabase(),before);assert.equal(s.seeded(),false);assert.equal(s.state.getCurrentQuest(),'None');
});

test('a failed opening helper is retried privately and its successful result is handed off once',async t=>{
  const s=fixture(t),first=s.service.begin();await tick();
  s.workers[0].emit('message',{type:'failed',reason:'Temporary authoring failure'});await first.promise;
  assert.equal(s.service.status().phase,'failed');assert.equal(s.state.getCurrentQuest(),'None');
  const second=s.service.begin();assert.notEqual(second,first);assert.equal(s.service.begin(),second);await tick();
  assert.equal(s.jobs.length,2);assert.equal(s.service.status().attempt,2);
  s.workers[1].emit('message',{type:'checkpoint',artifact:s.artifact()});await second.promise;
  assert.equal(await s.service.activate('0,1,0'),true);assert.equal(await s.service.activate('0,1,0'),false);
  assert.equal(s.jobs.length,2);
});

test('travel can join a replacement helper instead of immediately regenerating the quest in the foreground',async t=>{
  const s=fixture(t),first=s.service.begin();await tick();
  s.workers[0].emit('message',{type:'failed',reason:'Temporary authoring failure'});await first.promise;
  let finished=false;const travel=s.service.activate('0,1,0').then(v=>{finished=true;return v});await tick();
  assert.equal(s.jobs.length,2);assert.equal(finished,false);assert.equal(s.state.getCurrentQuest(),'None');
  s.workers[1].emit('message',{type:'checkpoint',artifact:s.artifact()});assert.equal(await travel,true);
});

test('helper restarts stop after three attempts per unchanged adventure context',async t=>{
  const s=fixture(t);let entry;
  for(let n=0;n<3;n++){
    entry=s.service.begin();await tick();s.workers[n].emit('message',{type:'failed',reason:'Persistent failure'});await entry.promise;
  }
  assert.equal(s.service.begin(),entry);assert.equal(s.jobs.length,3);assert.equal(s.service.status().attempt,3);
  s.restore();const fresh=s.service.begin();assert.notEqual(fresh,entry);await tick();assert.equal(s.service.status().attempt,1);
});

test('opening introductions keep authored names and text beyond the former field ceilings',async t=>{
  const s=fixture(t);s.service.begin();await tick();const artifact=s.artifact();s.state.setRoomNameDatabase(JSON.stringify(artifact.rooms));
  const passage='The witness explains the obligation through its saved campaign history. '.repeat(20).trim();
  const name='the memorial message of the distant witnesses beneath the mountain';
  const value={title:passage,name,hook:passage,resolution:passage,completion:passage,acceptLabel:passage,finishLabel:passage};
  const requests=[],$={model:'gpt-6-luna',run:async fn=>fn($),user:async()=>{},assistant:{generation:async options=>{requests.push(options);return{content:JSON.stringify(value)}}}};
  await Opening.authorIntroduction($,s.state,artifact.task);
  const task=s.state.getCurrentTasks()[0],writing=s.db()['0,0,0'].inscriptions.find(r=>r.id===task.story.fallback.readableId);
  assert.equal(task.story.title,passage);assert.equal(writing.name,name);assert.equal(writing.chapters[0].text,passage);
  assert.equal(task.story.stages.find(r=>r.id==='complete').text,passage);assert.equal(requests.length,1);
  assert.ok(Object.values(requests[0].parameters).every(p=>p.maxLength===undefined));
});

test('duplicate room-display receipts can restart the quest helper without rebuilding adjacent rooms',async t=>{
  const s=fixture(t),endpoints={},Module=require('node:module'),vm=require('node:vm');
  const file=require.resolve('../retort/roomPrefetchRoutes'),native=Module.createRequire(file);let queued=0;
  const adjacent={_reset(){},queueNeighbors(){queued++;return[]}};
  const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,setImmediate,console,
    require:id=>id==='./roomBuildQueue'?{service:()=>adjacent}:id==='./adjacentRoomSnapshots'?{install(){}}:native(id)});
  s.db()['0,0,0'].description='An authored entrance.';
  const website={helperSettings:()=>s.settings,view:()=>({revision:1})};
  module.exports.install({post:(url,fn)=>{endpoints[url]=fn}},s.state,{website,models:{withSnapshot:fn=>fn()}});
  const shown=()=>{let result;endpoints['/room-displayed']({body:{runId:'opening-run',geoKey:'0,0,0',geometryStamp:'unchanged'}},
    {status(){return this},json:v=>{result=v}});return result};
  shown();await tick();await tick();assert.equal(s.jobs.length,1);
  s.workers[0].emit('message',{type:'failed',reason:'Temporary failure'});await tick();
  assert.equal(shown().duplicate,true);await tick();await tick();assert.equal(s.jobs.length,2);assert.equal(queued,1);
});
test('activating a prepared quest preserves the context of already-running adjacent builds', async t => {
  const s = fixture(t), before = Build.context(s.state, s.model.id), entry = s.service.begin(); await tick();
  assert.equal(Build.context(s.state, s.model.id), before);
  s.workers[0].emit('message', { type: 'checkpoint', artifact: s.artifact() }); await entry.promise;
  assert.equal(Build.context(s.state, s.model.id), before); await s.service.activate('0,1,0');
  assert.equal(Build.context(s.state, s.model.id), before);
  s.state.setCurrentTaskIndex(1); assert.notEqual(Build.context(s.state, s.model.id), before);
});
for (const change of ['newRun', 'restore', 'model', 'helpers']) test('stale ' + change + ' cannot publish a private quest', async t => {
  const s = fixture(t), entry = s.service.begin(); await tick(); const artifact = s.artifact();
  if (change === 'model') s.model.revision++;
  else if (change === 'helpers') s.settings.revision++;
  else s[change]();
  s.workers[0].emit('message', { type: 'checkpoint', artifact }); await entry.promise;
  assert.equal(await s.service.activate('0,1,0'), false); assert.equal(s.state.getCurrentQuest(), 'None');
});
test('a room without a reachable quest-hook site stays closed without partially activating the quest', async t => {
  const s = fixture(t), entry = s.service.begin(); await tick();
  s.workers[0].emit('message', { type: 'checkpoint', artifact: s.artifact() }); await entry.promise;
  s.dungeons['0,1,0'].cells = {}; const before = s.state.getRoomNameDatabase();
  await assert.rejects(s.service.activate('0,1,0'), /reachable placement/);
  assert.equal(s.state.getCurrentQuest(), 'None'); assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.seeded(), false);
});
test('merging prepared quest additions preserves live pickups and new room construction', () => {
  const base = { '0,0,0': { name: 'Entrance', objects: [{ name: 'old coin' }] } };
  const rooms = structuredClone(base); rooms['0,0,0'].objects.push({ name: 'quest token' });
  const current = { '0,0,0': { name: 'Entrance', objects: [], preparedBuild: { ready: true }, description: 'Newly completed prose.' } };
  const next = Opening.mergedRooms({ base, rooms }, current);
  assert.deepEqual(next['0,0,0'].objects, [{ name: 'quest token' }]);
  assert.equal(next['0,0,0'].description, current['0,0,0'].description); assert.equal(next['0,0,0'].preparedBuild.ready, true);
});
test('replaced room identities are never overwritten by an old quest snapshot', () => {
  assert.throws(() => Opening.mergedRooms({ base: {}, rooms: { '1,1,0': { name: 'New Vault' } } },
    { '1,1,0': { name: 'Visited Market', visited: true } }), /claimed/);
});
test('entry activation is ordered before dungeon publication and the fallback generator', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  const start = source.indexOf('let openingQuestActivated =');
  assert.ok(start > 0); assert.ok(source.indexOf(".activate(preparedKey)", start) < source.indexOf("preparedRoomEntry').publish", start));
  assert.ok(source.indexOf("preparedRoomEntry').publish", start) < source.indexOf('generateQuest($)', start));
  assert.match(source, /openingQuestActivated \?[\s\S]*questJustSeeded: true/);
});
