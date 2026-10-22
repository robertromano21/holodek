'use strict';
// world1 expansion tests. Every feature is behind a flag in retort/worldFlags.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Flags = require('../retort/worldFlags');
const Surprise = require('../retort/surprise');
const RoomCast = require('../retort/roomCast');
const Memory = require('../retort/crossGameMemory');
const Myth = require('../retort/mythSelector');
const SurfaceArt = require('../assets/surfaceArt');
const Sculptures = require('../assets/sculptureForms');
const Icons = require('../assets/shrineIconography');
const Market = require('../retort/market');
const CampaignMap = require('../retort/campaignMap');
const Intents = require('../retort/environmentIntents');
const Temple = require('../retort/templeComplex');
const DungeonGeneration = require('../retort/dungeonGeneration');

test('a level is one room key and is easy to redefine', () => {
  assert.equal(Flags.levelKey('0,1,0'), '0,1,0');
  assert.equal(Flags.levelKey({ x: 2, y: -1, z: -3 }), '2,-1,-3');
  assert.equal(Flags.levelKey('bad'), null);
});

test('surprise: 60% base, hostiles act first, never at the start room', () => {
  assert.equal(Surprise.BASE, 0.6);
  assert.equal(Surprise.chance({}), 0.6);
  assert.ok(Surprise.chance({ settlement: true }) < 0.6);
  assert.equal(Surprise.roll({ starting: true }), null);
  assert.equal(Surprise.roll({}, () => 0.59).party, true);
  assert.equal(Surprise.roll({}, () => 0.61).party, false);
  let wins = 0; for (let i = 0; i < 1000; i++) wins += Surprise.roll({}, () => i / 1000).party ? 1 : 0;
  assert.equal(wins, 600, 'more likely than not');
  const order = Surprise.order([{ n: 'pc' }, { n: 'orc', h: 1 }, { n: 'ally' }, { n: 'imp', h: 1 }], a => a.h);
  assert.deepEqual(order.map(a => a.n), ['orc', 'imp', 'pc', 'ally']);
  Surprise.arm('1,2,0', { party: true, roll: 10, chance: 60 });
  assert.equal(Surprise.consume('1,2,0').roll, 10);
  assert.equal(Surprise.consume('1,2,0'), null, 'one ambush per arming');
  process.env.HOLODEK_SURPRISE = '0';
  assert.equal(Surprise.roll({}, () => 0), null);
  delete process.env.HOLODEK_SURPRISE;
});

test('room cast: 1-3 recurring people, arcs become missions to nearby rooms, revisits advance the arc', () => {
  process.env.HOLODEK_QUEST_LOCAL = '0'; // the original revisit-driven arc; QUEST_LOCAL is covered below
  const residents = [{ name: 'Ilsa Vane', allegiance: 'Neutral' }, { name: 'Oro', allegiance: 'Friendly' }, { name: 'Gnash', allegiance: 'Hostile' }];
  const cast = RoomCast.accept({ members: [{ name: 'ilsa vane', interests: ['debts', 'lamps'] }, { name: 'Gnash' }],
    arcs: [{ title: 'The Lamp Debt', premise: 'Ilsa owes oil to the ferry wardens.', giver: 'Ilsa Vane', stages: ['meet', 'ask', 'complication', 'resolution'], destinationHint: 'Ash Wharf' }] },
    residents, { runId: 'run-a' });
  assert.deepEqual(cast.members.map(m => m.name), ['Ilsa Vane'], 'hostiles and unknown names never become recurring');
  assert.equal(cast.arcs.length, 1);
  const db = { '0,1,0': { name: 'Dust Court' }, '0,2,0': { name: 'Ash Wharf' }, '5,5,0': { name: 'Far Ruin' } };
  const population = { actors: { 'Ilsa Vane': { name: 'Ilsa Vane', status: 'present', dialogue: ['hello'] } }, roomCast: cast };
  RoomCast.install(db, '0,1,0', population, 'run-a');
  const mission = Object.values(db['0,1,0'].minorMissions)[0];
  assert.equal(mission.sourceRoomKey, '0,2,0', 'quest points to a nearby room');
  assert.ok(db['0,2,0'].objects.some(o => o.minor_mission_id === mission.id));
  assert.equal(population.actors['Ilsa Vane'].recurring, true);
  assert.equal(RoomCast.revisit(db, '0,1,0', population, 1000), false, 'first sighting is not a revisit');
  assert.equal(RoomCast.revisit(db, '0,1,0', population, 2000), false);
  assert.equal(RoomCast.revisit(db, '0,1,0', population, 2000 + 61000), true);
  assert.equal(cast.arcs[0].stage, 1);
  assert.equal(population.actors['Ilsa Vane'].dialogue[0], 'ask');
  assert.ok(db['0,1,0'].localHistory.entries.length >= 2);
  mission.status = 'completed';
  RoomCast.revisit(db, '0,1,0', population, 2000 + 200000);
  assert.equal(cast.arcs[0].stage, 3, 'completed mission resolves the arc');
  delete process.env.HOLODEK_QUEST_LOCAL;
});

test('cross-game memory avoids names and premises from other runs only', () => {
  Memory.record('run-1', 'names', ['Corvo Brann']);
  Memory.record('run-1', 'premises', ['Corvo hides salt from the tide clerks.']);
  assert.ok(Memory.avoid('run-2', 'names').includes('corvo brann'));
  assert.ok(!Memory.avoid('run-1', 'names').includes('corvo brann'));
  assert.equal(Memory.collides('run-2', 'premises', 'CORVO hides salt from the tide clerks'), true);
  const cast = RoomCast.accept({ members: [{ name: 'Oro' }], arcs: [{ title: 't', premise: 'Corvo hides salt from the tide clerks.', giver: 'Oro', stages: ['a', 'b', 'c'] }] },
    [{ name: 'Oro', allegiance: 'Neutral' }], { runId: 'run-2' });
  assert.equal(cast.arcs.length, 0, 'a premise from an earlier game is rejected');
});

test('myths: Mortacia leads at the temple, variety grows with distance', () => {
  for (const seed of ['a', 'b', 'c', 'd']) assert.ok(Myth.pick(seed, '0,0,0').deities.includes('Mortacia'));
  const far = new Set(), near = [];
  for (let i = 0; i < 40; i++) { Myth.pick('s' + i, `${i},${20 + i},0`).deities.forEach(d => far.add(d)); near.push(Myth.pick('s' + i, '0,0,0').deities.includes('Mortacia')); }
  assert.ok(far.size >= 15, `far rooms depict many deities (${far.size})`);
  assert.ok(near.every(Boolean));
});

test('murals: forced deities, backstory, per-figure stories and hover boxes survive validation', () => {
  const art = [{ kind: 'fresco', surface: 'wall', label: 'The Ferry', description: 'A crossing.', motifs: ['ferry'], style: 'renaissance', scene: 'river_crossing',
    title: 'The Last Ferry', backstory: 'A unique myth of the ferry.', figures: [{ subject: 'human', pose: 'pointing', name: 'Ferryman', role: 'guide', story: 'He poles the boat.' }] }];
  Myth.enforce(art, 'seed', '0,0,0');
  const [v] = SurfaceArt.validate(art);
  assert.equal(v.title, 'The Last Ferry'); assert.equal(v.backstory, 'A unique myth of the ferry.'); assert.equal(v.world1, 'world1');
  assert.ok(v.figures.some(f => f.subject === 'Mortacia'));
  const boxes = SurfaceArt.figureBoxes(v);
  assert.equal(boxes.length, v.figures.length);
  for (const b of boxes) { assert.ok(b.name && b.role && b.story); assert.ok(b.box.width > 0 && b.box.x + b.box.width <= SurfaceArt.rasterSize(v).width + 1); }
  const legacy = SurfaceArt.validate([{ kind: 'fresco', surface: 'wall', label: 'Old', description: 'Old art.', motifs: ['x'] }])[0];
  assert.equal(legacy.title, undefined, 'old murals are untouched');
});

test('statues: every dragon deity has a distinct variety; human-form avatars exist', () => {
  const dragons = Object.keys(Icons.pantheon).filter(n => Icons.pantheon[n].form === 'dragon');
  const seen = new Set(dragons.map(d => JSON.stringify(Sculptures.dragonVariety(d))));
  assert.equal(seen.size, dragons.length, 'no two dragon deities share a carved variety');
  const spec = Sculptures.visualSpec({ label: 'Wardrake', deity: 'Atinus', form: 'dragon', pose: Sculptures.poses[0], head: 'bare', robe: 'pleated', attribute: Sculptures.attributes[0], world1Variety: true });
  const [dragon] = Sculptures.validate([spec]);
  assert.equal(dragon.form, 'dragon'); assert.ok(dragon.dragonVariety);
  assert.equal(Sculptures.build(32, 'ab', dragon).length, 32 ** 3);
  const [avatar] = Sculptures.validate([{ label: 'Avatar of Neptar', deity: 'Neptar', aspect: 'avatar', pose: Sculptures.poses[0], head: 'helmet', robe: 'toga', attribute: Sculptures.attributes[0] }]);
  assert.equal(avatar.form, 'human');
  const [old] = Sculptures.validate([{ label: 'Wardrake', deity: 'Atinus', pose: Sculptures.poses[0], head: 'bare', robe: 'pleated', attribute: Sculptures.attributes[0] }]);
  assert.equal(old.dragonVariety, undefined); assert.equal(old.form, 'dragon');
});

test('market: supply and demand move prices; old saves keep fixed prices', () => {
  const room = { classification: { biome: 'cave' } };
  Market.seed(room, '0,0,-1', 'run');
  const potion = { name: 'healing potion', consumable_kind: 'healing' }, sword = { name: 'sword', type: 'weapon' };
  assert.ok(Market.price(room, potion, 10) > 10, 'caves consume potions');
  assert.ok(Market.price(room, sword, 10) < 10, 'caves produce weapons');
  const before = Market.price(room, potion, 10); for (let i = 0; i < 5; i++) Market.trade(room, 'buy', potion);
  assert.ok(Market.price(room, potion, 10) > before, 'buying makes it scarcer');
  assert.ok(room.market.jobs.length >= 1);
  const old = {}; assert.equal(Market.price(old, potion, 10), 10); assert.equal(Market.salePrice(old, potion, 10), 5);
});

async function intents(db, coords, directions, sourceIndoor) {
  return (await Intents.chooseEnvironmentIntents(null, { coords, database: db, directions, seed: 'world1-test', sourceIndoor })).intents;
}
const CITY_FIXTURE = [{ bearing: 'north', distance: 3, underground: true, template: 'cavern_village' }, { bearing: 'east', distance: 9, underground: false, template: 'market' },
  { bearing: 'northeast', distance: 16, underground: false, template: 'village' }, { bearing: 'north', distance: 30, underground: false, template: 'village' }];
function startDb(withMap) {
  const db = { '0,0,0': { name: 'Ruined Temple Entrance', exits: { north: '0,1,0', east: '1,0,0', west: '-1,0,0' },
    campaignAtlas: { runId: 'r', regions: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] } } };
  // Fixed fixture: the model's city placement for this test game (north, 3 rooms, beneath the surface).
  if (withMap) db['0,0,0'].campaignAtlas.map = CampaignMap.placeCities(CampaignMap.compose('r', db['0,0,0'].campaignAtlas), 'r', CITY_FIXTURE, Intents.CATALOG);
  return db;
}

test('the first exit from 0,0,0 and its wasteland generation are unchanged', async () => {
  process.env.HOLODEK_CAMPAIGN_MAP = '0';
  const off = await intents(startDb(false), { x: 0, y: 0, z: 0 }, ['north', 'east', 'west'], true);
  delete process.env.HOLODEK_CAMPAIGN_MAP;
  const on = await intents(startDb(true), { x: 0, y: 0, z: 0 }, ['north', 'east', 'west'], true);
  const strip = i => { const { mapRole, ...rest } = i; return rest; };
  assert.equal(off.north.template, 'wasteland');
  assert.equal(off.north.evidence.constraint, 'root-first-wasteland');
  assert.deepEqual(strip(on.north), off.north, 'only an additive mapRole tag differs');
  assert.equal(on.north.mapRole, 'route-wasteland');
  assert.equal(off.north.mapRole, undefined);
});

test('map topology: temple sections, wasteland -> existing underground biome -> test city, Hades is a city', async () => {
  const db = startDb(true), map = db['0,0,0'].campaignAtlas.map;
  assert.equal(map.cities.at(-1).name, 'Hades'); assert.equal(map.cities[0].role, 'test');
  assert.ok(map.cities.filter(c => c.role === 'waypoint').length >= 2);
  const root = await intents(db, { x: 0, y: 0, z: 0 }, ['north', 'east', 'west'], true);
  for (const i of Object.values(root)) db[i.targetKey] = { name: i.template, environmentIntent: i };
  const sides = Object.values(root).filter(i => i.mapRole === 'temple-section');
  for (const s of sides) assert.ok(CampaignMap.TEMPLE_SECTIONS.includes(s.template) && Intents.CATALOG[s.template].indoor);
  let sectionCount = 0;
  for (let i = 0; i < 40; i++) {
    const r = await Intents.chooseEnvironmentIntents(null, { coords: { x: 0, y: 0, z: 0 }, database: startDb(true), directions: ['north', 'east', 'west'], seed: 'seed' + i, sourceIndoor: true });
    sectionCount += Object.values(r.intents).filter(x => x.mapRole === 'temple-section').length;
  }
  assert.ok(sectionCount > 40, `side exits usually lead to temple sections (${sectionCount}/80)`);
  const w = await intents(db, { x: 0, y: 1, z: 0 }, ['north', 'east'], false);
  assert.equal(w.north.mapRole, 'route-underground');
  assert.ok(CampaignMap.UNDERGROUND_ROUTE.includes(w.north.template) && Object.hasOwn(Intents.CATALOG, w.north.template), 'existing underground template');
  for (const i of Object.values(w)) db[i.targetKey] = { name: i.template, environmentIntent: i };
  const u = await intents(db, { x: 0, y: 2, z: 0 }, ['north', 'east'], true);
  assert.equal(u.north.template, 'cavern_village');
  assert.equal(u.north.mapRole, 'city:test-city');
  assert.equal(u.north.targetKey, '0,3,0', 'in this fixture the model placed the near city north, beyond the first wasteland');
  assert.ok(u.north.citySite.utilities.includes('aqueduct') && u.north.citySite.guilds.length && u.north.citySite.population > 0);
  db['0,3,0'] = { name: 'city', environmentIntent: u.north };
  assert.equal(CampaignMap.nearestCity(db, '0,1,0').roomKey, '0,3,0');
});

test('temple complex: only new games get the larger 0,0,0 maze with halls and sanctums', () => {
  const fresh = { coords: { x: 0, y: 0, z: 0 } }; DungeonGeneration.prepare(fresh, Temple.mark({ indoor: true, size: 64 }), 'r');
  assert.ok(fresh.generation.gridSize >= Temple.MIN_GRID); assert.equal(fresh.generation.templeComplex, true);
  const roles = Temple.augment({ rooms: [{ role: 'entrance' }] }, fresh.generation).rooms.map(r => r.role);
  for (const role of ['hall', 'sanctum', 'chapel', 'crypt']) assert.ok(roles.includes(role));
  const old = { coords: { x: 0, y: 0, z: 0 } }; DungeonGeneration.prepare(old, { indoor: true, size: 64 }, 'r');
  assert.equal(old.generation.gridSize, 64); assert.equal(old.generation.templeComplex, undefined);
  assert.deepEqual(Temple.augment({ rooms: [] }, old.generation), { rooms: [] });
});

test('exit frames sit at the matching edge in biome architecture', () => {
  const Exits = require('../assets/dungeonExits');
  const w = 40, h = 40, cells = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[`${x},${y}`] = { tile: x > 0 && y > 0 && x < w - 1 && y < h - 1 ? 'floor' : 'wall' };
  const make = biome => ({ cells: JSON.parse(JSON.stringify(cells)), layout: { width: w, height: h }, start: { x: 20, y: 30 }, classification: { biome, indoor: biome !== 'wasteland' }, exitFrames: true });
  const d = make('crypt'), r = Exits.install(d, ['north', 'east']);
  const north = r.markers.find(m => m.direction === 'north'), east = r.markers.find(m => m.direction === 'east');
  assert.ok(north.y <= 3, `north exit on the north edge (y=${north.y})`);
  assert.ok(east.x >= w - 4, `east exit on the east edge (x=${east.x})`);
  const frames = d.sceneStructures.filter(p => p.role === 'journey-exit-frame');
  assert.deepEqual(frames.map(f => f.shape).sort(), ['exit_grate', 'exit_grate_side']);
  assert.equal(make('fortress') && (() => { const f = make('fortress'); Exits.install(f, ['south']); return f.sceneStructures.find(p => p.role === 'journey-exit-frame').shape; })(), 'exit_portcullis');
  const legacy = make('crypt'); delete legacy.exitFrames; Exits.install(legacy, ['north']);
  assert.equal(legacy.sceneStructures.filter(p => p.role === 'journey-exit-frame').length, 0, 'flag off: no frames');
  const Voxels = require('../assets/scenePropVoxels');
  for (const shape of ['exit_gate', 'exit_portcullis', 'exit_grate', 'exit_arch', 'exit_arch_side']) assert.ok(Voxels.build(shape, 16, 's').some(Boolean), shape);
});

test('no shipped world1 text names real composers, artists, bands, songs or game titles', () => {
  const files = ['retort/worldFlags.js', 'retort/surprise.js', 'retort/roomCast.js', 'retort/crossGameMemory.js', 'retort/mythSelector.js', 'retort/market.js',
    'retort/campaignMap.js', 'retort/templeComplex.js', 'assets/questMap.js'];
  const banned = /\b(michelangelo|raphael|botticelli|donatello|leonardo|bernini|caravaggio|titian|bach|mozart|beethoven|vivaldi|hubbard|galway|zelda|ultima|diablo|skyrim|baldur|beatles|metallica)\b/i;
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), banned, f);
});

const QuestMap = require('../assets/questMap');

test('exits must be found on foot first; old saves count existing exits as traversed', () => {
  const fresh = { '0,0,0': { footExitsTracked: 'run', exits: { north: '0,1,0' } } };
  assert.equal(QuestMap.exitLocked(fresh, '0,0,0', 'north', {}), true);
  fresh['0,0,0'].footExits = { north: true };
  assert.equal(QuestMap.exitLocked(fresh, '0,0,0', 'north', {}), false, 'after walking it, quick travel works');
  const old = new Map([['0,0,0', { exits: { north: '0,1,0' } }], ['0,1,0', { exits: { south: '0,0,0' } }]]);
  assert.equal(QuestMap.exitLocked(old, '0,1,0', 'south', {}), false, 'old save: no lock');
  assert.equal(QuestMap.exitLocked({ '0,0,0': { footExitsTracked: 'r' } }, '0,0,0', 'east', { FOOT_EXITS: false }), false, 'flag off');
  assert.match(QuestMap.LOCK_MESSAGE, /on foot/);
  const game = fs.readFileSync(path.join(__dirname, '../assets/game.js'), 'utf8');
  const lock = game.indexOf('world1 FOOT_EXITS'), calc = game.indexOf('// Calculate target coordinates', lock);
  assert.ok(lock > 0 && calc > lock && game.indexOf("const message = \"You can't go that way.\";") < lock, 'lock check sits right before the unchanged travel code');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /app\.post\('\/exits\/traversed'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../retort/campaignSetting.js'), 'utf8'), /footExitsTracked = runId/);
});

function localArcRoom(job = 'temple priest') {
  const residents = [{ name: 'Sister Hale', allegiance: 'Friendly', job }];
  const cast = RoomCast.accept({ members: [{ name: 'Sister Hale', interests: ['rites'] }], arcs: [{ title: 'The Cold Lamp', premise: `A lamp went cold ${Math.random()}`,
    giver: 'Sister Hale', stages: ['Relight the lamp at the cistern', 'Read the cistern carving', 'Fetch oil from the wharf', 'Return the oil'], destinationHint: 'Ash Wharf',
    localStages: 2, localSpot: 'the old cistern', reveals: [{ kind: 'route', label: 'the drain path', why: 'she walks it' }, { kind: 'bogus', label: 'x', why: 'y' }] }] }, residents, { runId: 'run-q' });
  const db = { '0,1,0': { name: 'Dust Court' }, '0,2,0': { name: 'Ash Wharf' } };
  const population = { actors: { 'Sister Hale': { name: 'Sister Hale', status: 'present', job } }, roomCast: cast };
  RoomCast.install(db, '0,1,0', population, 'run-q');
  return { db, cast, population, mission: Object.values(db['0,1,0'].minorMissions)[0] };
}

test('quest arcs start local, at a spot in the giver room, then travel', () => {
  const { db, cast, population, mission } = localArcRoom();
  assert.equal(cast.arcs[0].localStages, 2); assert.equal(cast.arcs[0].localSpot, 'the old cistern');
  assert.deepEqual({ room: mission.objective.roomKey, local: mission.objective.local, spot: mission.objective.spot }, { room: '0,1,0', local: true, spot: 'the old cistern' });
  assert.match(population.actors['Sister Hale'].dialogue[0], /starts here, at the old cistern/);
  RoomCast.revisit(db, '0,1,0', population, 1000); RoomCast.revisit(db, '0,1,0', population, 100000);
  assert.equal(mission.arc.stage, 0, 'revisits do not skip the local stages');
  assert.equal(RoomCast.reachObjective(db, '0,2,0', mission.id), null, 'only in the giver room');
  assert.equal(RoomCast.reachObjective(db, '0,1,0', mission.id).stage, 1);
  const o = RoomCast.reachObjective(db, '0,1,0', mission.id);
  assert.deepEqual({ room: o.roomKey, local: o.local, step: o.step }, { room: '0,2,0', local: false, step: 'Fetch oil from the wharf' }, 'later stages need travel');
  assert.equal(RoomCast.reachObjective(db, '0,1,0', mission.id), null);
  assert.ok(db['0,1,0'].localHistory.entries.some(e => /old cistern/.test(e.text)));
  assert.match(RoomCast.promptBlock({ runId: 'r', geoKey: '0,1,0' }), /STARTS LOCAL/);
});

test('givers reveal role-specific map marks only when the quest is given', () => {
  const priest = localArcRoom('temple priest'), smuggler = localArcRoom('river smuggler');
  const kinds = r => r.db['0,1,0'].mapReveals[r.mission.id].items.map(i => i.kind);
  assert.ok(kinds(priest).includes('shrine')); assert.ok(kinds(smuggler).includes('passage'));
  assert.ok(!kinds(priest).includes('bogus'));
  assert.ok(kinds(priest).includes('objective') && kinds(priest).includes('route'));
  const rv = priest.db['0,1,0'].mapReveals[priest.mission.id];
  assert.equal(rv.revealed, false);
  assert.match(RoomCast.onAccepted(priest.db, priest.mission), /Sister Hale marks your map/);
  assert.equal(rv.revealed, true); assert.equal(RoomCast.onAccepted(priest.db, priest.mission), '', 'once');
  assert.match(fs.readFileSync(path.join(__dirname, '../retort/economy.js'), 'utf8'), /roomCast'\)\.onAccepted/);
  assert.match(RoomCast.promptBlock({ runId: 'r', geoKey: '0,1,0' }), /marks map information|mark map information/);
});

test('level map: objective markers with quest name and step, exit labels, partial reveals', () => {
  const { db, mission } = localArcRoom();
  const w = 40, h = 40, cells = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[`${x},${y}`] = { tile: 'floor' };
  const dungeon = { geoKey: '0,1,0', cells, layout: { width: w, height: h }, start: { x: 20, y: 34 },
    roomExits: { markers: [{ direction: 'north', x: 20, y: 1 }, { direction: 'east', x: 38, y: 20 }] } };
  const local = QuestMap.mapMarkers(dungeon, db);
  assert.equal(local.markers.length, 1);
  assert.match(local.markers[0].label, /^The Cold Lamp: Relight the lamp/);
  const cistern = QuestMap.mapMarkers(dungeon, db, { landmarks: [{ id: 'lm-1', x: 5.5, y: 6.5, kind: 'spring', label: 'Old Cistern' }] });
  assert.deepEqual([cistern.markers[0].x, cistern.markers[0].y], [5.5, 6.5], 'uses the room geography when it matches');
  assert.equal(QuestMap.revealCells(dungeon, db['0,1,0']).cells.length, 0, 'nothing revealed before the quest is given');
  RoomCast.onAccepted(db, mission);
  const rv = QuestMap.revealCells(dungeon, db['0,1,0']);
  assert.ok(rv.cells.length > 20 && rv.cells.length < w * h / 4, `only a portion is revealed (${rv.cells.length})`);
  assert.ok(rv.cells.some(c => c.y <= 2 && c.x === 20), 'route toward the north exit');
  RoomCast.reachObjective(db, '0,1,0', mission.id); RoomCast.reachObjective(db, '0,1,0', mission.id);
  const remote = QuestMap.mapMarkers(dungeon, db);
  assert.equal(remote.markers.length, 0);
  assert.deepEqual(remote.exitLabels.north, ['The Cold Lamp: Fetch oil from the wharf'], 'objective elsewhere labels the exit leading there');
  assert.deepEqual(QuestMap.mapMarkers(dungeon, db, { flags: { QUEST_LOCAL: false } }).markers, []);
});

// ---- update 2: memory in the save, first-turn surprise, rewards, AI city placement, arrival edges, return exits,
// mosaic hover, city kit. Model calls use canned schema-valid responses through a mock transport.
const RoomArrival = require('../assets/roomArrival');
const CityKit = require('../assets/cityKit');
const CityScenery = require('../retort/cityScenery');
const Voxels = require('../assets/scenePropVoxels');
function mockTransport(replies) {
  const calls = [];
  return { calls, $: { model: null, temperature: null, user: async (...a) => { calls.push({ user: String.raw(...a).slice(0, 200) }); },
    assistant: { generation: async request => { calls.push({ request }); const next = replies.shift(); return { content: JSON.stringify(typeof next === 'function' ? next(request) : next) }; } } } };
}

test('no-repeat memory travels with the save (last 20 games) and a new game inherits it', () => {
  Memory.reset();
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../retort/crossGameMemory.js'), 'utf8'), /require\('node:fs'\)|retort-data/, 'nothing on the machine');
  for (let i = 0; i < 25; i++) Memory.record(`game-${i}`, 'names', [`Name ${i}`]);
  const save = Memory.persist({ '0,0,0': { name: 'Ruined Temple' } });
  assert.equal(save['0,0,0'].crossGameHistory.runs.length, 20, 'bounded to the last 20 games');
  assert.ok(!save['0,0,0'].crossGameHistory.runs.some(r => r.runId === 'game-0'));
  Memory.reset();
  assert.equal(Memory.avoid('new-game', 'names').length, 0);
  Memory.load(JSON.parse(JSON.stringify(save))); // the player loads that save, then starts a new game
  assert.ok(Memory.avoid('new-game', 'names').includes('name 24'));
  const fresh = Memory.persist({ '0,0,0': {} });   // campaignSetting writes it into the new game's save
  assert.equal(fresh['0,0,0'].crossGameHistory.runs.length, 20);
  assert.match(fs.readFileSync(path.join(__dirname, '../retort/campaignSetting.js'), 'utf8'), /crossGameMemory'\)\.persist\(latest\)/);
  // via the live save in sharedState
  let text = JSON.stringify({ '0,0,0': { crossGameHistory: { runs: [{ runId: 'old', at: 1, premises: ['the drowned bell'] }] } } });
  Memory.reset(); Memory.attach({ getRoomNameDatabase: () => text, setRoomNameDatabase: v => { text = v; } });
  assert.equal(Memory.collides('now', 'premises', 'The drowned bell!'), true);
  Memory.reset();
});

test('surprise gives only the first turn: ambushers act first once, then normal initiative', () => {
  const order = [{ n: 'pc', i: 18 }, { n: 'orc', i: 4, h: 1 }, { n: 'ally', i: 12 }, { n: 'imp', i: 9, h: 1 }];
  const round1 = Surprise.order(order, a => a.h);
  assert.deepEqual(round1.map(a => a.n), ['orc', 'imp', 'pc', 'ally']);
  assert.equal(new Set(round1).size, order.length, 'nobody acts twice; no extra round');
  Surprise.arm('9,9,0', { party: true, roll: 5, chance: 60 });
  assert.ok(Surprise.consume('9,9,0')); assert.equal(Surprise.consume('9,9,0'), null, 'round 2 rolls normal initiative');
  assert.match(fs.readFileSync(path.join(__dirname, '../retort/retortWithUserInput.js'), 'utf8'), /take the first turn, then normal initiative proceeds/);
});

test('quest rewards scale with difficulty, stages and distance, capped by the local economy', () => {
  const easy = RoomCast.reward({ difficulty: 'easy', stages: 3, distance: 1 }), deadly = RoomCast.reward({ difficulty: 'deadly', stages: 5, distance: 8 });
  assert.ok(easy >= 3 && easy < deadly, `${easy} < ${deadly}`);
  assert.ok(RoomCast.reward({ difficulty: 'hard', stages: 4, distance: 2 }) > RoomCast.reward({ difficulty: 'normal', stages: 4, distance: 2 }));
  assert.ok(RoomCast.reward({ difficulty: 'normal', stages: 3, distance: 9 }) > RoomCast.reward({ difficulty: 'normal', stages: 3, distance: 1 }));
  assert.equal(RoomCast.reward({ difficulty: 'deadly', stages: 5, distance: 200 }), RoomCast.rewardCap({}), 'capped');
  const rich = { market: { version: 'world1', demand: { weapon: 2.5, armor: 2.5, potion: 2.5, food: 2.5 } } };
  assert.ok(RoomCast.rewardCap(rich) > RoomCast.rewardCap({}) && RoomCast.rewardCap(rich) <= 48);
  process.env.HOLODEK_QUEST_REWARDS = '0'; assert.equal(RoomCast.reward({ difficulty: 'deadly', stages: 5, distance: 9 }), 3); delete process.env.HOLODEK_QUEST_REWARDS;
  const { mission } = localArcRoom();
  assert.equal(mission.rewardSilver, mission.escrowSilver); assert.ok(mission.rewardSilver >= 3);
  assert.match(mission.description, new RegExp(`Payment: ${mission.rewardSilver} silver`));
});

test('cities are placed by the model each game and validated (fixed fixtures)', async () => {
  const atlas = { regions: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] };
  const placed = CampaignMap.placeCities(CampaignMap.compose('g1', atlas), 'g1', CITY_FIXTURE, Intents.CATALOG);
  assert.equal(placed.cities[0].site.key, '0,3,0'); assert.equal(placed.cities[0].site.template, 'cavern_village'); assert.equal(placed.placement.source, 'ai');
  const bad = [{ bearing: 'north', distance: 1, underground: false, template: 'village' }, { bearing: 'up', distance: 9 }, { bearing: 'east', distance: 12, template: 'sky_castle' }];
  const fixed = CampaignMap.placeCities(CampaignMap.compose('g2', atlas), 'g2', bad, Intents.CATALOG);
  assert.equal(fixed.placement.rejected.length, 2, 'too-close and impossible sites are rejected');
  assert.equal(fixed.cities[2].site.template, 'village', 'unknown template falls back to an existing one');
  for (const c of fixed.cities) {
    assert.ok(c.site, c.id); assert.notEqual(c.site.key, '0,1,0'); assert.ok(Object.hasOwn(Intents.CATALOG, c.site.template));
    assert.equal(c.site.coords.z, 0, 'reachable on the ordinary room grid');
  }
  const d0 = c => Math.max(Math.abs(c.site.coords.x), Math.abs(c.site.coords.y));
  assert.ok(d0(fixed.cities[0]) >= 2 && d0(fixed.cities[0]) <= 5, 'near city stays near the temple');
  assert.ok(fixed.cities.slice(1).every((c, i) => d0(c) > d0(fixed.cities[i]) - 1), 'later cities lie farther out');
  const seeded = ['s1', 's2', 's3', 's4'].map(s => CampaignMap.placeCities(CampaignMap.compose(s, atlas), s, null, Intents.CATALOG).cities[0].site.key);
  assert.ok(new Set(seeded).size > 1, 'placement changes between games');
  // quests point to a nearby city
  const db = startDb(true);
  assert.equal(CampaignMap.nearestCity(db, '0,2,0').roomKey, '0,3,0');
  assert.ok(RoomCast.nearbyRooms({ ...db, '0,1,0': { name: 'Waste' } }, '0,1,0').some(r => r.city && r.key === '0,3,0'));
  // the model call, through a mock transport with a canned schema-valid answer
  const mock = mockTransport([{ cities: [{ bearing: 'west', distance: 4, underground: false, template: 'market' }, ...CITY_FIXTURE.slice(1)] }]);
  process.env.HOLODEK_CITY_PLACEMENT = '1';
  const viaModel = await require('../retort/campaignSetting').placeCitiesWithModel(mock.$, 'g3', CampaignMap.compose('g3', atlas));
  delete process.env.HOLODEK_CITY_PLACEMENT;
  assert.ok(mock.calls.some(c => c.request && c.request.parameters.cities), 'one bounded placement request');
  assert.equal(viaModel.cities[0].site.key, '-4,0,0'); assert.equal(viaModel.cities[0].site.template, 'market'); assert.equal(viaModel.placement.source, 'ai');
});

test('arrival edge: every direction lands at the facing gate (walking and console travel share it)', () => {
  const Exits = require('../assets/dungeonExits');
  const make = () => { const w = 48, h = 48, cells = {};
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[`${x},${y}`] = { tile: x && y && x < w - 1 && y < h - 1 ? 'floor' : 'wall' };
    return { geoKey: '5,5,0', cells, layout: { width: w, height: h }, start: { x: 24, y: 36 }, classification: { indoor: true }, exitFrames: true }; };
  const all = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down'];
  for (const travel of all) {
    const d = make(), facing = RoomArrival.OPPOSITE[travel];
    const p = RoomArrival.arrivalPoint(d, travel, all, Exits, {});
    assert.ok(p, travel); assert.equal(p.gate, facing);
    const gate = d.roomExits.markers.find(m => m.direction === facing);
    assert.ok(Math.hypot(p.x - gate.x, p.y - gate.y) <= 3.3, `${travel}: arrives beside the ${facing} gate`);
    assert.ok(Math.hypot(p.x - gate.x, p.y - gate.y) >= 1.9, `${travel}: not on the gate itself (no instant re-exit)`);
    const v = RoomArrival.GRID[facing];
    if (v) assert.ok((p.x - 24) * v[0] + (p.y - 24) * v[1] > 4, `${travel}: on the ${facing} side of the room`);
  }
  // east -> the west side, at its west gate; north -> south; west -> east; south -> north (explicit, as the user listed)
  for (const [travel, side] of [['east', p => p.x < 12], ['north', p => p.y > 36], ['west', p => p.x > 36], ['south', p => p.y < 12]]) {
    const d = make(); assert.ok(side(RoomArrival.arrivalPoint(d, travel, all, Exits, {})), travel);
  }
  // exits keep their layout from the room's own origin after the start moves
  const d = make(); RoomArrival.arrivalPoint(d, 'east', all, Exits, {}); const before = JSON.stringify(d.roomExits.markers);
  d.start = { x: 3, y: 24 }; d._geometryStamp = 'rebuilt'; Exits.install(d, all); assert.equal(JSON.stringify(d.roomExits.markers), before);
  assert.equal(RoomArrival.arrivalPoint(make(), 'east', all, Exits, { ARRIVAL_EDGES: false }), null, 'flag off: original start');
  const game = fs.readFileSync(path.join(__dirname, '../assets/game.js'), 'utf8');
  assert.equal((game.match(/world1ArrivalStart\(currentDungeon, geoKey\)/g) || []).length, 2, 'both room-entry paths (fresh and cached) use it');
  assert.ok(game.indexOf('window._world1Arrival = {') < game.indexOf('if (window.dungeonTestingMode) {\n    currentCoordinates'), 'recorded for every direction command, walked or typed');
});

test('walking through an exit unlocks the return exit in the next room', () => {
  const db = { '0,0,0': { footExitsTracked: 'r', exits: { north: '0,1,0' } } };
  const r = QuestMap.markTraversed(db, '0,0,0', 'north');
  assert.deepEqual(r, { target: '0,1,0', back: 'south' });
  db['0,1,0'] = { exits: { south: '0,0,0' } };
  assert.equal(QuestMap.exitLocked(db, '0,1,0', 'south', {}), false, 'pending return exit honoured once the room exists');
  assert.equal(QuestMap.exitLocked(db, '0,1,0', 'north', {}), true);
  QuestMap.markTraversed(db, '0,1,0', 'east'); db['1,1,0'] = {};
  assert.equal(QuestMap.exitLocked(db, '1,1,0', 'west', {}), false);
  QuestMap.markTraversed(db, '1,1,0', 'west');
  assert.equal(db['0,1,0'].footExits.east, true, 'existing next room marked directly');
  assert.match(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), /markTraversed\(db, geoKey, direction\)/);
});

test('mosaics expose figure hover boxes with stories like frescoes', () => {
  const art = { kind: 'mosaic', surface: 'wall', label: 'Court of Ash', description: 'A mosaic.', motifs: ['Mortacia', 'Atinus'], style: 'byzantine', mosaicPattern: 'apse_court',
    title: 'The Ash Court', backstory: 'A myth told in tesserae.', figures: [{ subject: 'Mortacia', pose: 'benediction', name: 'Mortacia', role: 'judge', story: 'She weighs the shades.' }] };
  const [v] = SurfaceArt.validate([art]);
  const boxes = SurfaceArt.figureBoxes(v);
  assert.ok(boxes.length >= 1, 'mosaic figure boxes');
  assert.equal(boxes[0].name, 'Mortacia'); assert.equal(boxes[0].story, 'She weighs the shades.');
  const size = SurfaceArt.rasterSize(v);
  for (const b of boxes) assert.ok(b.box.width > 0 && b.box.x >= 0 && b.box.x + b.box.width <= size.width + 1);
  assert.equal(v.title, 'The Ash Court');
});

test('city voxel kit: every piece builds through the scene-prop path, palettes and variants differ', () => {
  assert.ok(CityKit.SHAPES.length >= 45);
  for (const want of ['city_insula', 'market_stall', 'guild_hall', 'city_temple', 'public_baths', 'city_wall', 'city_gate', 'city_tower', 'watchtower', 'lighthouse', 'forum_portico', 'basilica',
    'amphitheatre', 'granary', 'warehouse', 'aqueduct_arch', 'water_channel', 'cistern', 'fountain_basin', 'fountain_tiered', 'fountain_obelisk', 'fountain_wall', 'fountain_nymph', 'well', 'trough',
    'sewer_grate', 'dock', 'pier_section', 'moored_boat', 'harbour_crane', 'bridge', 'canal_wall', 'paving_slab', 'city_steps', 'colonnade', 'awning', 'crate', 'barrel', 'lantern', 'lamp_post',
    'banner_pole', 'street_shrine', 'milestone', 'plaza_statue', 'guild_sign']) assert.ok(CityKit.SHAPES.includes(want), want);
  for (const s of CityKit.SHAPES) for (const v of CityKit.variants(s)) { const g = Voxels.build(`${s}__v${v}`, 16, "x"); assert.ok(g && g.some(Boolean), s + v); }
  assert.ok(CityKit.SHAPES.filter(s => CityKit.variants(s).length > 1).length >= 15, "many pieces have procedural variants");
  assert.notDeepEqual([...Voxels.build('city_townhouse__v0', 16, 'x')], [...Voxels.build('city_townhouse__v1', 16, 'x')], 'procedural variants');
  const c1 = Voxels.color('city_townhouse__v0', .5, .5, .3, [1, 0, 0], [.5, .5, .5], 'stone', { cityKit: { palette: 'marble' } });
  const c2 = Voxels.color('city_townhouse__v0', .5, .5, .3, [1, 0, 0], [.5, .5, .5], 'stone', { cityKit: { palette: 'basalt' } });
  assert.ok(c1[0] > c2[0] + .3, 'marble vs basalt');
  assert.equal(CityKit.paletteFor({ role: 'hades', name: 'Hades' }), 'basalt');
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => CityKit.paletteFor({ id }))).size >= 2, 'cities differ');
  const g1 = Voxels.color('guild_sign__v0', .5, .5, .6, [0, -1, 0], [.5, .5, .5], 'stone', { cityKit: { guild: 'smiths' } }), g2 = Voxels.color('guild_sign__v0', .5, .5, .6, [0, -1, 0], [.5, .5, .5], 'stone', { cityKit: { guild: 'weavers' } });
  assert.notDeepEqual(g1, g2, 'per-guild signage');
});

test('city districts get their own infrastructure, within performance caps, off reserved routes', () => {
  const W = 40, H = 28, cells = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ...(x === 20 ? { navigationReserved: true } : {}) };
  const city = { id: 'c1', name: 'Salt Forum City', role: 'test', districts: ['forum', 'market ward', 'guild quarter', 'harbor ward', 'tenements'], guilds: ['smiths', 'scribes'],
    utilities: ['aqueduct', 'cistern', 'public fountains', 'harbor', 'bathhouse'], population: 9000 };
  const plan = CityKit.planCity({ cells, width: W, height: H, city, seed: 'fixed' });
  const by = d => plan.placements.filter(p => p.district === d).map(p => p.shape);
  assert.ok(by('forum').some(s => /basilica|forum_portico/.test(s)), 'forum and basilica');
  assert.ok(by('market ward').includes('market_stall'));
  assert.ok(by('guild quarter').includes('guild_hall') && plan.placements.some(p => p.shape === 'guild_hall' && p.guild));
  assert.ok(plan.placements.some(p => /dock|pier_section/.test(p.shape)) && plan.placements.some(p => p.shape === 'moored_boat'));
  assert.ok(by('aqueduct').includes('aqueduct_arch') && by('aqueduct').includes('water_channel'));
  assert.ok(plan.placements.some(p => p.shape === 'lamp_post') && plan.placements.some(p => p.shape === 'milestone'), 'lamp posts line the road; milestones');
  assert.ok(plan.placements.length <= CityKit.CAPS.total && plan.placements.filter(p => p.detail).length <= CityKit.CAPS.detail);
  assert.ok(plan.instancedTiles < plan.placements.length / 1.5, 'tiles shared (one mesh per tile)');
  assert.ok(plan.placements.filter(p => p.detail).every(p => p.cullDistance === CityKit.CULL.detail), 'street detail is LOD-culled');
  for (const p of plan.placements) for (let j = 0; j < p.footprint[1]; j++) for (let i = 0; i < p.footprint[0]; i++) assert.notEqual(p.x + i, 20, `${p.shape} on a reserved route`);
  const again = CityKit.planCity({ cells, width: W, height: H, city: { ...city, id: 'c2' }, seed: 'fixed' });
  assert.notDeepEqual(again.placements.map(p => [p.shape, p.x, p.y]), plan.placements.map(p => [p.shape, p.x, p.y]), 'cities differ');
  // scene integration and flag
  const dungeon = { geoKey: '0,3,0', cells: JSON.parse(JSON.stringify(cells)), layout: { width: W, height: H }, start: { x: 5, y: 14 }, tiles: { wall: { url: 'w' } } };
  const r = CityScenery.apply(dungeon, {}, city);
  assert.equal(r.status, 'built'); assert.ok(dungeon.sceneStructures.every(s => s.world1City && dungeon.tiles[s.tile].spriteSpec.collisionBlocking === false));
  assert.equal(CityScenery.apply(dungeon, {}, city).status, 'already-built');
  process.env.HOLODEK_CITY_PROPS = '0'; assert.equal(CityScenery.apply({ ...dungeon, cityScenery: null }, {}, city).status, 'skipped'); delete process.env.HOLODEK_CITY_PROPS;
  assert.match(fs.readFileSync(path.join(__dirname, '../assets/rendererWebGL.js'), 'utf8'), /part\.cullDistance/);
});

test('mock-transport chain: placed city -> room cast generation (schema) -> scaled quest -> reveal -> history in save', async () => {
  // canned, schema-valid model answer for the room-cast request (no network)
  const canned = { members: [{ name: 'Brother Ode', interests: ['rites', 'lamps'] }], arcs: [{ title: 'The Buried Bell', premise: `A bell lies under the nave ${Date.now()}`, giver: 'Brother Ode',
    stages: ['Find the bell rope', 'Ring it at the cistern', 'Take the clapper to the city', 'Return'], destinationHint: 'Cavern City', difficulty: 'hard', localStages: 2, localSpot: 'the nave cistern',
    reveals: [{ kind: 'shrine', label: 'the shrine of the bell', why: 'he tends it' }] }] };
  const mock = mockTransport([canned]);
  const db = startDb(true); db['0,1,0'] = { name: 'Ash Waste' }; db['0,3,0'] = { name: 'Cavern City', environmentIntent: { citySite: db['0,0,0'].campaignAtlas.map.cities[0] } };
  const population = { actors: { 'Brother Ode': { name: 'Brother Ode', allegiance: 'Friendly', status: 'present', job: 'priest' } } };
  const cast = await RoomCast.generate(mock.$, { runId: 'mock-run', geoKey: '0,1,0', roomName: 'Ash Waste', population, nearbyRooms: RoomCast.nearbyRooms(db, '0,1,0') });
  const schema = mock.calls.find(c => c.request).request.parameters.arcs;
  const arcKeys = Object.keys(schema.type[0].type).join(',');
  for (const k of ['difficulty', 'localStages', 'localSpot', 'reveals']) assert.match(arcKeys, new RegExp(k), `schema carries ${k}`);
  assert.equal(cast.arcs[0].difficulty, 'hard'); assert.ok(cast.arcs[0].reveals.some(r => r.kind === 'shrine'));
  RoomCast.install(db, '0,1,0', population, 'mock-run');
  const mission = Object.values(db['0,1,0'].minorMissions)[0];
  assert.ok(mission.rewardSilver > 3); assert.equal(mission.objective.local, true);
  assert.match(RoomCast.onAccepted(db, mission), /Brother Ode marks your map/);
  assert.ok(db['0,0,0'].crossGameHistory.runs.some(r => r.runId === 'mock-run'), 'history saved in the save');
});
