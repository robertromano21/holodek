'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const os = require('node:os'), crypto = require('node:crypto');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const Build = require(path.join(root, 'retort/roomBuildState')), Queue = require(path.join(root, 'retort/roomBuildQueue'));
const Topology = require(path.join(root, 'retort/roomBuildTopology'));
const wait = async fn => { for (let n = 0; n < 100 && !fn(); n++) await new Promise(r => setTimeout(r, 5)); assert.ok(fn()); };
const logger = { info() {} };
function setup() {
  let db = { '0,0,0': { name: 'Hall', visited: true, description: 'A roofed hall.', exits: { north: { targetCoordinates: '0,1,0' }, east: { targetCoordinates: '1,0,0' } } },
    '0,1,0': { name: 'Road', exits: { south: { targetCoordinates: '0,0,0' }, east: { targetCoordinates: '1,0,0' }, north: { targetCoordinates: '0,2,0' } } },
    '1,0,0': { name: 'Court' }, '0,2,0': { name: 'Far Road' } };
  let run = 'run', quest = 'Find the witness', here = { x: 0, y: 0, z: 0 };
  const dungeons = { '0,0,0': { cells: {}, layout: {}, _geometryStamp: 'hall' } }, music = {}, populations = {};
  const state = { getDungeonRunId: () => run, getCurrentQuest: () => quest, getCurrentTaskIndex: () => 0, getCurrentTasks: () => [],
    getLastCoords: () => here, getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: value => { db = JSON.parse(Build.protectDatabase(JSON.stringify(db), value, run)); },
    setRoomDungeon: (c, d) => dungeons[`${c.x},${c.y},${c.z}`] = d,
    setRoomPopulation: (k, p) => populations[k] = p, setRoomMusic: (c, m) => music[`${c.x},${c.y},${c.z}`] = m,
    exportSaveState: () => ({ roomNameDatabaseString: JSON.stringify(db), roomDungeonDatabase: structuredClone(dungeons), lastCoords: { ...here } }) };
  const model = { id: 'gpt-6-luna', revision: 1 }, web = { revision: 1, enabled: true };
  const deps = { models: { current: () => model }, website: { view: () => web, backgroundEnabled: () => web.enabled }, logger };
  const workers = [], spawned = [];
  deps.spawn = (job, snapshot) => { const worker = new EventEmitter(); worker.terminate = async () => {}; workers.push(worker); spawned.push({ job, snapshot }); return worker; };
  deps.commit = (s, j, a, options) => Build.commit(s, j, a, { ...options, adoptMusic() {} });
  const service = Queue.createService(state, deps);
  return { state, service, workers, spawned, model, web, db: () => db, dungeons, music, populations,
    move: c => { here = c; }, changeQuest: () => { quest = 'A changed quest'; }, newRun: () => { run = 'next'; } };
}
function artifact(job, base, stage = 'complete') {
  const rooms = structuredClone(base), room = rooms[job.key];
  Object.assign(room, { populationComplete: true, description: 'A long road winds through the cold ash.', inhabitants: { actors: {}, groups: [] },
    illustration: { plan: { layers: [] } } });
  return { jobId: job.id, leaseId: job.assignment?.leaseId, runId: job.runId, key: job.key, stage, rooms,
    dungeon: stage === 'population' ? null : { geoKey: job.key, layout: { width: 16, height: 16 }, cells: { '1,1': { tile: 'floor' } },
      _geometryStamp: 'ready-' + job.key, sceneSpec: { source: { roomName: room.name, description: room.description } } },
    music: ['music','complete'].includes(stage) ? { voices: [{},{},{}], archive: { id: 'accepted-score' } } : null };
}

test('only actual visited coordinates can enqueue one hop; diagonal and portal coordinates deduplicate', () => {
  const s = setup();
  assert.deepEqual(s.service.queueNeighbors({ currentKey: '0,1,0', exits: ['north'] }), []);
  s.move({ x: 0, y: 1, z: 0 });
  assert.deepEqual(s.service.queueNeighbors({ currentKey: '0,1,0', exits: ['north'] }), []);
  const db = s.db(); db['0,0,0'].exits.portal = { targetCoordinates: '1,0,0' };
  assert.deepEqual(Queue.candidates(db, '0,0,0', ['east','portal']).map(r => r.key), ['1,0,0']);
  db['1,0,0'].visited = true; assert.deepEqual(Queue.candidates(db, '0,0,0', ['east','portal']), []);
  db['1,0,0'].visited = false; db['1,0,0'].preparedBuild = { ready: true };
  assert.deepEqual(Queue.candidates(db, '0,0,0', ['east']), []);
  s.service._reset();
});

test('one worker builds a complete neighbor, joins in flight and never spawns a recursive ring', async () => {
  const s = setup();
  assert.deepEqual(s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }), ['0,1,0']);
  assert.deepEqual(s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }), []);
  await wait(() => s.workers.length === 1);
  const { job } = s.spawned[0]; let joined = false;
  const joining = s.service.join(job.key).then(() => { joined = true; });
  await Promise.resolve(); assert.equal(joined, false);
  assert.ok(s.spawned[0].snapshot.roomDungeonDatabase['0,0,0'], 'Worker snapshot retains the current room required by save validation.');
  for (const stage of ['population','geometry','music','complete']) {
    const a = artifact(job, job.base, stage); s.workers[0].emit('message', { type: 'checkpoint', artifact: a });
    assert.equal(s.db()[job.key].preparedBuild.stage, stage);
    assert.equal(s.db()[job.key].preparedBuild.ready, stage === 'complete');
  }
  s.workers[0].emit('message', { type: 'done' }); await joining;
  assert.equal(s.service.status()[0].phase, 'complete'); assert.equal(s.db()[job.key].visited, false);
  assert.equal(s.db()['0,2,0'].populationComplete, undefined);
  assert.equal(s.workers.length, 1); assert.ok(s.music[job.key]); assert.ok(s.dungeons[job.key]);
  s.service._reset();
});

test('interconnected neighbors reuse the same coordinate job and a finished room across visits', async () => {
  const s = setup(); s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north','east'] });
  await wait(() => s.workers.length === 1);
  const first = s.spawned[0].job;
  s.workers[0].emit('message', { type: 'checkpoint', artifact: artifact(first, first.base) }); s.workers[0].emit('message', { type: 'done' });
  await wait(() => s.workers.length === 2);
  const db = s.db(); db['0,1,0'].visited = true; s.state.setRoomNameDatabase(JSON.stringify(db)); s.move({ x: 0, y: 1, z: 0 });
  assert.deepEqual(s.service.queueNeighbors({ currentKey: '0,1,0', exits: ['south','east','north'] }), ['0,2,0']);
  assert.equal(s.service.status().filter(j => j.key === '1,0,0').length, 1);
  assert.equal(s.db()['0,1,0'].inhabitants.actors.constructor, Object);
  s.service._reset();
});

test('quest, run and model changes discard stale results without touching active room or party data', async () => {
  for (const change of [s => s.changeQuest(), s => s.newRun(), s => s.model.revision++, s => s.web.revision++, s => { s.web.enabled = false; }]) {
    const s = setup(); s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await wait(() => s.workers.length === 1);
    const { job } = s.spawned[0], before = s.state.getRoomNameDatabase(); change(s);
    s.workers[0].emit('message', { type: 'checkpoint', artifact: artifact(job, job.base) });
    assert.equal(s.state.getRoomNameDatabase(), before); assert.equal(s.service.status()[0].phase, 'cancelled');
    s.service._reset();
  }
});

test('partial checkpoints survive failures and stale foreground database snapshots cannot erase them', async () => {
  const s = setup(), old = s.state.getRoomNameDatabase();
  s.service.queueNeighbors({ currentKey: '0,0,0', exits: ['north'] }); await wait(() => s.workers.length === 1);
  const { job } = s.spawned[0];
  s.workers[0].emit('message', { type: 'checkpoint', artifact: artifact(job, job.base, 'geometry') });
  s.workers[0].emit('message', { type: 'failed', reason: 'Provider unavailable.' });
  await s.service.join(job.key); assert.equal(s.service.status()[0].phase, 'failed');
  const stale = JSON.parse(old); stale['0,0,0'].discovered = 'a real player discovery';
  s.state.setRoomNameDatabase(JSON.stringify(stale));
  assert.equal(s.db()[job.key].populationComplete, true); assert.ok(s.dungeons[job.key]);
  assert.equal(s.db()['0,0,0'].discovered, 'a real player discovery');
  assert.equal(s.db()[job.key].preparedBuild.ready, false);
  s.service._reset();
});

test('artifact commits merge independent discoveries, reject conflicting geometry and never import player state', () => {
  const s = setup(), base = structuredClone(s.db());
  const job = { key: '0,1,0', name: 'Road', runId: 'run', id: 'job', model: 'gpt-6-luna', base };
  job.context = Build.context(s.state, job.model);
  const db = s.db(); db['0,0,0'].playerNote = 'Keep this.'; s.state.setRoomNameDatabase(JSON.stringify(db));
  const a = artifact(job, base); a.updatedGameConsole = 'Forged player HP'; a.inventory = ['unearned treasure'];
  Build.commit(s.state, job, a, { adoptMusic() {} });
  assert.equal(s.db()['0,0,0'].playerNote, 'Keep this.'); assert.equal(s.db()[job.key].inventory, undefined);
  const conflict = artifact(job, job.base); conflict.rooms[job.key].description = 'A different generated description.';
  conflict.dungeon.sceneSpec.source.description = conflict.rooms[job.key].description;
  const edited = s.db(); edited[job.key].description = 'A real intervening edit.'; s.state.setRoomNameDatabase(JSON.stringify(edited));
  assert.throws(() => Build.commit(s.state, job, conflict, { adoptMusic() {} }), /Concurrent room change/);
  assert.equal(s.db()[job.key].description, 'A real intervening edit.'); s.service._reset();
});

test('foreground and background share one geometry pass and entry cannot rebuild a valid saved dungeon', () => {
  const source = fs.readFileSync(path.join(root, 'retort/retortWithUserInput.js'), 'utf8');
  assert.equal((source.match(/async function buildGeneratedRoom\(/g) || []).length, 1);
  assert.equal((source.match(/await buildGeneratedRoom\(/g) || []).length, 2);
  assert.match(source, /isNewGeoRoom && !hasRoomDungeon && roomDescription/);
  assert.match(source, /await require\('\.\/roomBuildQueue'\).service\(sharedState\).join\(preparedKey\)/);
});

test('isolated production preparation executes every pass in order without a turn or recursive prefetch', async () => {
  const source = fs.readFileSync(path.join(root, 'retort/retortWithUserInput.js'), 'utf8');
  const a = source.indexOf('  if (options.prepareRoom) {'), b = source.indexOf('\n    if (options.realtimeEncounter)', a);
  assert.ok(a > 0 && b > a); const s = setup(), phases = [], job = { key: '0,1,0', name: 'Road', runId: 'run', coords: { x: 0, y: 1, z: 0 } };
  const state = { ...s.state, getRoomDungeonForSimulation: () => ({ geoKey: job.key }), getRoomMusic: () => ({ voices: [] }), setUpdatedGameConsole() {} };
  const run = fn => fn({ user: () => {}, run: fn => run(fn) });
  const sandbox = { sharedState: state, options: { prepareRoom: job, onBuildCheckpoint: a => phases.push(a.stage) },
    roomNameDatabaseString: state.getRoomNameDatabase(), updatedGameConsole: 'Room Description: A long road winds through cold ash.\nPuzzle in Room: None',
    require: id => id === 'node:worker_threads' ? { isMainThread: false } : id === './roomBuildState' ? Build :
      id === './sidArchive' ? { record: () => ({ id: 'offline-score-0123456789abcdef' }) } :
      id === './roomIllustration' ? { createService: () => ({ ensure: async () => phases.push('art-pass') }) } : id === './roomBuildTopology' ? Topology : null,
    GraveMasterProtocol: { runtimeFor: () => ({ run, retort: fn => fn }) }, StoryPrompts: { appendOriginal() {} },
    generateMissingRoomDetails: async () => { phases.push('population-pass'); },
    buildGeneratedRoom: async () => { phases.push('geometry-pass'); },
    populationService: { prepare: () => ({ actors: {} }) },
    getOrGenerateRoomMusic: async () => { phases.push('music-pass'); } };
  await vm.runInNewContext('(async()=>{' + source.slice(a,b) + '})()', sandbox);
  assert.deepEqual(phases, ['population-pass','population','geometry-pass','geometry','music-pass','music','art-pass','complete']);
  assert.equal(s.db()['0,2,0'].populationComplete, undefined); s.service._reset();
});

test('coordinate topology preserves return links, reuses interconnected records and does not create duplicate rooms', () => {
  const db = { '0,0,0':{name:'Hall',visited:true,exits:{north:{targetCoordinates:'0,1,0'}}},
    '0,1,0':{name:'Road',indoor:false,exits:{east:{targetCoordinates:'1,1,0',status:'locked',key:'bronze key'}}},
    '1,1,0':{name:'Existing Court',objects:[{name:'keep me'}]}, '0,2,0':{name:'Closed Hall',visited:true,exits:{}} };
  const keys=Object.keys(db), court=structuredClone(db['1,1,0']);
  const result=Topology.prepare(db,'0,1,0',{seed:'one'}), saved=JSON.stringify(result);
  assert.equal(result.exits.south.targetCoordinates,'0,0,0');
  assert.deepEqual(result.exits.east,{targetCoordinates:'1,1,0',status:'locked',key:'bronze key'});
  assert.equal(result.exits.north,undefined,'No new doorway into a visited room without an opening.');
  assert.equal(result.exits.up,undefined); assert.equal(result.exits.down,undefined);
  assert.deepEqual(Object.keys(db),keys); assert.deepEqual(db['1,1,0'],court);
  Topology.prepare(db,'0,1,0',{seed:'different'}); assert.equal(JSON.stringify(result),saved);
  const client=fs.readFileSync(path.join(root,'assets/game.js'),'utf8');
  assert.match(client,/if \(planned\?\.preparedBuild \|\| planned\?\.backgroundTopology\?\.version === 1\) return Object.keys\(planned.exits \|\| \{\}\)/);
});

test('real isolated Retort room preparation resumes cached population, geometry, music and art without live API calls', async t => {
  const worker = new Worker(`
    const {parentPort}=require('node:worker_threads'),path=require('node:path');
    process.env.OPENAI_API_KEY='offline-test-not-a-credential';
    const root=${JSON.stringify(root)};
    const state=require(path.join(root,'sharedState'));
    const Build=require(path.join(root,'retort/roomBuildState'));
    const transport=require(path.join(root,'retort/modelTransport'));
    transport.complete=async()=>({choices:[{message:{content:JSON.stringify({indoor:true,size:16,biome:'temple',features:[],skyTop:'#000000',skyBot:'#000000',floorColor:'#554433',wallColor:'#998877'})}}]});
    transport.stream=async function*(){throw Error('Unexpected uncached model generation.');};
    const archive=require(path.join(root,'retort/sidArchive'));
    archive.record=()=>({id:'cached-song',manifest:{seconds:600}});
    const run=state.getDungeonRunId(),classification={indoor:true,size:16,biome:'temple',features:[]};
    const db={'0,0,0':{name:'Hall',description:'A roofed hall of quiet stone.',classification,indoor:true,visited:true,exits:{}},
      '0,1,0':{name:'Road Chapel',description:'A roofed stone chamber stands beside the road.',classification,indoor:true,populationComplete:true,objects:[],exits:{},monsters:{inRoom:'None',state:'None',equippedProperties:'None'}}};
    state.setRoomNameDatabase(JSON.stringify(db));
    state.setCombatCharactersString('[]');
    const template=require(path.join(root,'retort/initialGameState')).buildInitialWorldConsole().console;
    state.setUpdatedGameConsole(Build.projectConsole(template,db['0,0,0'],'0,0,0',db));
    const Inhabitants=require(path.join(root,'assets/dungeonInhabitants'));
    const population=Inhabitants.createPopulation('0,1,0',[],{indoor:true});
    state.setRoomPopulation('0,1,0',population);db['0,1,0'].inhabitants=population;
    const dungeon={geoKey:'0,1,0',layout:{width:16,height:16},cells:{'8,8':{tile:'floor'}},start:{x:8,y:8},classification,
      _geometryStamp:'keep-exactly',sceneSpec:{indoor:true,source:{roomName:db['0,1,0'].name,description:db['0,1,0'].description}}};
    state.setRoomDungeon({x:0,y:1,z:0},dungeon,[]);
    state.setRoomMusic({x:0,y:1,z:0},{title:'Cached',voices:[{},{},{}],archive:{id:'cached-song'}});
    const Art=require(path.join(root,'retort/roomIllustration'));
    db['0,1,0'].illustration={version:1,source:Art.fingerprint(Art.context(state,'0,1,0')),plan:require(path.join(root,'tests/fixtures/room-art.cjs')).temple()};
    state.setRoomNameDatabase(JSON.stringify(db));
    const phases=[];
    require(path.join(root,'retort/retortWithUserInput')).retortWithUserInput('',()=>{},false,{
      prepareRoom:{key:'0,1,0',name:'Road Chapel',coords:{x:0,y:1,z:0},runId:run},
      onBuildCheckpoint:a=>phases.push({stage:a.stage,stamp:a.dungeon?._geometryStamp})
    }).then(()=>parentPort.postMessage({phases}),e=>parentPort.postMessage({error:e.stack}));
  `, { eval: true, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume(); t.after(() => worker.terminate());
  const result = await new Promise((resolve,reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    const timer = setTimeout(() => reject(Error('Isolated cached-room test timed out.')), 15000); timer.unref();
  });
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.phases.map(p => p.stage), ['population','geometry','music','complete']);
  assert.ok(result.phases.every(p => p.stamp === 'keep-exactly'));
});

test('background SID publication verifies checksums and merges the catalog only on the main thread', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-archive-adopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const module = { exports: {} }, source = fs.readFileSync(path.join(root,'retort/sidArchive.js'),'utf8');
  const archive = vm.runInNewContext('(function(require,module,__dirname){' + source + '\nreturn module.exports;})', {})
    (id => id.startsWith('./') ? require(path.join(root,'retort',id)) : require(id), module, path.join(dir,'retort'));
  const id = 'test-room-0123456789abcdef', build = crypto.randomUUID();
  const song = { title: 'Test Room', voices: [{},{},{}], archive: { id } };
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const from = path.join(dir,'.retort-data/room-build',build,'music-archive',id);
  fs.mkdirSync(from,{recursive:true});
  const bytes = Buffer.from('offline fake SID bytes');
  for (const name of ['8580.sid','10582.sid']) fs.writeFileSync(path.join(from,name),bytes);
  const manifest = { version:2,id,title:song.title,createdAt:'now',scoreHash:hash(JSON.stringify({title:song.title,voices:song.voices})),
    checksums:{'8580.sid':hash(bytes),'10582.sid':hash(bytes)} };
  fs.writeFileSync(path.join(from,'manifest.json'),JSON.stringify(manifest));
  const catalog = path.join(dir,'.retort-data/music-archive/catalog.json');
  fs.mkdirSync(path.dirname(catalog),{recursive:true}); fs.writeFileSync(catalog,JSON.stringify([{id:'keep-existing-song'}]));
  archive.adopt(song,build);
  assert.deepEqual(JSON.parse(fs.readFileSync(catalog,'utf8')).map(r=>r.id),[id,'keep-existing-song']);
  assert.ok(!fs.existsSync(from)); archive.adopt(song,build);
  assert.equal(JSON.parse(fs.readFileSync(catalog,'utf8')).length,2);
  fs.writeFileSync(path.join(dir,'.retort-data/music-archive',id,'8580.sid'),'corrupt');
  assert.throws(()=>archive.adopt(song,build),/SID checksum/);
  assert.throws(()=>archive.adopt(song,'../../outside'),/identity/);
});
