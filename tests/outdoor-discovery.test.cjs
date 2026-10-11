'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const D = require('../assets/outdoorDiscovery');
const { createPopulationService } = require('../retort/roomPopulation');
const floor = Object.freeze({ tile: 'floor', floorHeight: 0, ceilHeight: 8 });
const cells = {};
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) cells[`${x},${y}`] = floor;
Object.freeze(cells);
const sheet = name => `${name}\nFemale\nHuman\nScout\nLevel: 1\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Neutral`;
function fixture() {
  const d = { geoKey: '1,0,0', classification: { indoor: false }, layout: { width: 256, height: 256 },
    start: { x: 128, y: 128 }, _geometryStamp: 'saved', cells, sceneStructures: [],
    sceneObjects: [{ id: 'sword', name: 'loose sword', type: 'weapon', x: 4, y: 4 }, { id: 'seal', name: 'boss seal', type: 'key', x: 5, y: 4 }] };
  const p = I.createPopulation(d.geoKey, [{ name: 'Pilgrim', allegiance: 'Neutral', routine: 'wander', encounterId: 'pilgrims' },
    { name: 'Trader', allegiance: 'Neutral', routine: 'wander', encounterId: 'pilgrims' },
    { name: 'Hunter', allegiance: 'Hostile', routine: 'patrol', encounterId: 'hunters' }], { indoor: false });
  p.groups.forEach((g, n) => { g.site = { x: 20 + n * 5, y: 20 }; g.members.forEach((name, i) => p.actors[name].position = p.actors[name].home = { x: 20 + n * 5 + i, y: 20 }); });
  D.setup(d, p, { fresh: true });
  const roster = Object.values(p.actors).map(a => ({ name: a.name, type: 'monster', hp: 20, mazeX: a.position.x, mazeY: a.position.y, mazeRoomKey: d.geoKey }));
  I.attach(roster, p);
  const text = 'Coordinates: X: 1, Y: 0, Z: 0\nObjects in Room: loose sword, boss seal\nNPCs in Party: None\nMonsters in Room:\n' +
    roster.map(a => sheet(a.name)).join('\n') + '\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 2';
  let now = 1000;
  const tick = player => D.tick(d, p, roster, player, { now: now += 3000, consoleText: text });
  return { d, p, roster, text, tick, setNow: value => { now = value; } };
}
function walk(f, dx = 1, dy = 0) {
  let event, player;
  for (let n = 0; n < 30 && !event; n++) {
    player = { x: 128.5 + n * 4 * dx, y: 128.5 + n * 4 * dy };
    event = f.tick(player).discoveries[0];
  }
  return { event, player };
}
for (const [label, dx, dy] of [['east', 1, 0], ['west', -1, 0], ['north', 0, -1], ['south', 0, 1]]) test(`outdoor discoveries follow ${label} travel without any model calls or geometry changes`, () => {
  const f = fixture(), before = JSON.stringify(f.d), { event, player } = walk(f, dx, dy);
  assert.ok(event); assert.equal(event.kind, 'people');
  const range = Math.hypot(event.x + .5 - player.x, event.y + .5 - player.y);
  assert.ok(range >= D.SPAWN_MIN && range <= D.SPAWN_MAX);
  assert.ok(I.lineClear(f.d, player, { x: event.x + .5, y: event.y + .5 }));
  assert.ok((event.x + .5 - player.x) * dx + (event.y + .5 - player.y) * dy > 0);
  const group = f.p.groups.find(g => g.discoveryState === 'placed');
  assert.ok(group.members.length <= 4);
  assert.equal(new Set(group.members.map(name => `${f.p.actors[name].position.x},${f.p.actors[name].position.y}`)).size, group.members.length);
  assert.ok(group.members.every(name => I.walkable(f.d, f.p.actors[name].position.x, f.p.actors[name].position.y)));
  assert.equal(JSON.stringify(f.d), before);
});
test('standing still and time spent away from polling never advance the travel clock', () => {
  const f = fixture(); f.tick({ x: 128.5, y: 128.5 });
  for (let n = 0; n < 100; n++) assert.equal(f.tick({ x: 128.5, y: 128.5 }).discoveries.length, 0);
  assert.equal(f.p.travelDiscovery.movingMs, 0); assert.equal(f.p.travelDiscovery.distance, 0);
  f.setNow(1000000); f.tick({ x: 132.5, y: 128.5 });
  assert.equal(f.p.travelDiscovery.movingMs, 0);
});
test('pacing back and forth does not farm discoveries and teleports get no travel credit', () => {
  const f = fixture();
  for (let n = 0; n < 100; n++) assert.equal(f.tick({ x: 128.5 + (n % 2) * 4, y: 128.5 }).discoveries.length, 0);
  assert.ok(f.p.travelDiscovery.distance < 12);
  const before = f.p.travelDiscovery.distance; f.tick({ x: 230.5, y: 230.5 });
  assert.equal(f.p.travelDiscovery.distance, before);
  assert.ok(f.p.travelDiscovery.explored.length <= 4096);
});
test('people and ordinary items alternate, placed entities stay fixed and collected loot cannot return', () => {
  const f = fixture(), first = walk(f), group = f.p.groups.find(g => g.discoveryState === 'placed');
  group.status = 'discovered'; D.release(f.p, group.id);
  const saved = JSON.stringify(group.members.map(name => f.p.actors[name].position));
  let event;
  for (let n = 1; n < 40 && !event; n++) event = f.tick({ x: first.player.x - n * 3, y: first.player.y + n * 2 }).discoveries[0];
  assert.ok(event); assert.equal(event.kind, 'object');
  assert.equal(JSON.stringify(group.members.map(name => f.p.actors[name].position)), saved);
  const shown = D.objects(f.d.sceneObjects, f.p), sword = shown.find(a => a.id === 'sword');
  assert.equal(sword.x, event.x); assert.equal(shown.find(a => a.id === 'seal').x, 5);
  D.tick(f.d, f.p, f.roster, { x: event.x + .5, y: event.y + .5 }, { now: 1000000,
    consoleText: 'Objects in Room: boss seal' });
  assert.equal(f.p.travelDiscovery.objects['loose sword'].status, 'exhausted');
  assert.ok(!D.objects(f.d.sceneObjects, JSON.parse(JSON.stringify(f.p))).some(a => a.id === 'sword'));
});
test('indoor/small outdoor rooms and quest-bound actors, keys and artifacts retain fixed sites', () => {
  for (const patch of [{ classification: { indoor: true } }, { layout: { width: 64, height: 64 } }]) {
    const f = fixture(); delete f.p.travelDiscovery; Object.assign(f.d, patch);
    assert.equal(D.setup(f.d, f.p, { fresh: true }), false); assert.equal(f.p.travelDiscovery, undefined);
  }
  const f = fixture(); D.setup(f.d, f.p, { protectedNames: ['Pilgrim'], fresh: true });
  assert.equal(f.p.actors.Pilgrim.discoveryState, 'fixed');
  assert.equal(f.p.travelDiscovery.objects['boss seal'].status, 'fixed');
});
test('no arrival is created on isolated floors or inside a nearby hostile encounter', () => {
  const f = fixture();
  f.d.cells = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`${128 + n},128`, floor]));
  f.p.travelDiscovery.distance = 1000; f.p.travelDiscovery.movingMs = 100000;
  f.tick({ x: 128.5, y: 128.5 }); assert.equal(f.tick({ x: 132.5, y: 128.5 }).discoveries.length, 0);
  const g = fixture(), hunter = g.roster.find(a => a.name === 'Hunter');
  hunter.discoveryState = 'fixed'; hunter.mazeX = 130; hunter.mazeY = 128;
  g.p.travelDiscovery.distance = 1000; g.p.travelDiscovery.movingMs = 100000;
  g.tick({ x: 128.5, y: 128.5 }); assert.equal(g.tick({ x: 132.5, y: 128.5 }).discoveries.length, 0);
});

test('a steep cliff cannot be crossed to place a discovery ahead, and entry residents remain visible', () => {
  const f = fixture();
  f.d.cells = Object.fromEntries(Object.entries(cells).map(([key, cell]) => [key,
    Number(key.split(',')[0]) >= 140 ? { ...cell, floorHeight: 20 } : cell]));
  f.p.travelDiscovery.distance = 1000; f.p.travelDiscovery.movingMs = 100000;
  f.tick({ x: 128.5, y: 128.5 }); assert.equal(f.tick({ x: 132.5, y: 128.5 }).discoveries.length, 0);
  const g = fixture(); delete g.p.groups[0].discoveryState;
  g.p.actors.Pilgrim.position = { x: 130, y: 128 };
  D.setup(g.d, g.p, { fresh: true });
  assert.equal(g.p.actors.Pilgrim.discoveryState, 'fixed');
});
test('a pending group is excluded from perception, speech and combat before its travel opportunity', () => {
  const f = fixture(); f.roster.forEach(a => { a.mazeX = 128; a.mazeY = 128; });
  const pc = { name: 'PC', type: 'pc', hp: 20, mazeX: 128, mazeY: 128, mazeRoomKey: f.d.geoKey };
  assert.deepEqual(I.nearbyMonsterNames(f.d, f.roster, f.p, { x: 128.5, y: 128.5 }), []);
  assert.equal(I.perceive(f.d, [pc, ...f.roster], f.p).nearby.length, 0);
  assert.ok(f.roster.every(actor => !I.dialogueReach(f.d, actor, { x: 128.5, y: 128.5 }).canSpeak));
});
test('server placement revisions reject stale client positions, then accept acknowledged local movement', () => {
  const f = fixture(), { event, player } = walk(f), name = f.p.groups.find(g => g.discoveryState === 'placed').members[0];
  let wire = JSON.stringify([{ name: 'PC', type: 'pc', hp: 20, mazeX: Math.floor(player.x), mazeY: Math.floor(player.y), mazeRoomKey: f.d.geoKey }, ...f.roster]), db = '{}';
  const state = { getDungeonRunId: () => 'run', getGamePaused: () => false, getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getUpdatedGameConsole: () => f.text, getRoomPopulation: () => f.p, setRoomPopulation() {}, getRoomDungeonForSimulation: () => f.d,
    getRoomNameDatabase: () => db, setRoomNameDatabase: value => { db = value; },
    getCombatCharactersString: () => wire, setCombatCharactersString: value => { wire = value; } };
  const service = createPopulationService(state), before = { ...f.p.actors[name].position };
  service.visit({ runId: 'run', geoKey: f.d.geoKey, player, actors: [{ name, mazeX: 10, mazeY: 10 }] });
  assert.deepEqual(f.p.actors[name].position, before);
  service.visit({ runId: 'run', geoKey: f.d.geoKey, player, actors: [{ name, mazeX: before.x + 1, mazeY: before.y,
    discoveryRevision: f.p.actors[name].discoveryRevision }] });
  assert.equal(f.p.actors[name].position.x, before.x + 1);
  assert.ok(event);
});

test('walking past a wholly unseen opportunity returns the same living group to the pool, not an exhausted fixed coordinate', () => {
  const f = fixture(), first = walk(f), group = f.p.groups.find(g => g.discoveryState === 'placed');
  const before = group.members.map(name => ({ name, hp: f.p.actors[name].hp, dialogue: [...f.p.actors[name].dialogue] }));
  for (let n = 1; n <= 12 && group.discoveryState !== 'pending'; n++) f.tick({ x: first.player.x - n * 4, y: first.player.y });
  assert.equal(group.discoveryState, 'pending'); assert.equal(group.status, 'unseen'); assert.equal(group.site, null);
  for (const row of before) {
    const resident = f.p.actors[row.name];
    assert.equal(resident.position, null); assert.equal(resident.hp, row.hp); assert.deepEqual(resident.dialogue, row.dialogue);
  }
  assert.equal(f.p.travelDiscovery.active, undefined); assert.equal(Object.keys(f.p.actors).length, 3);
});

test('legacy abandoned outdoor groups are eligible again without moving known, speaking, recruited or quest-bound residents', () => {
  for (const protectedCase of ['none', 'discovered', 'spoke', 'recruited', 'quest']) {
    const f = fixture(), group = f.p.groups[0], resident = f.p.actors[group.members[0]];
    group.discoveryState = 'placed'; group.members.forEach(name => { f.p.actors[name].discoveryState = 'placed'; });
    if (protectedCase === 'discovered') group.status = 'discovered';
    if (protectedCase === 'spoke') resident.encounteredAt = 1;
    if (protectedCase === 'recruited') resident.status = 'recruited';
    if (protectedCase === 'quest') f.p.questIntroduction = { speaker: resident.name };
    const original = JSON.stringify(group.site);
    f.tick({ x: 128.5, y: 128.5 }); f.tick({ x: 132.5, y: 128.5 });
    assert.equal(group.discoveryState, protectedCase === 'none' ? 'pending' : 'placed', protectedCase);
    if (protectedCase !== 'none') assert.equal(JSON.stringify(group.site), original);
  }
});

test('encounter selection alternates toward a hostile group rather than requiring every neutral first', () => {
  const f = fixture(), first = walk(f), group = f.p.groups.find(g => g.discoveryState === 'placed');
  group.status = 'discovered'; D.release(f.p, group.id); f.p.travelDiscovery.nextKind = 'people';
  assert.equal(f.p.travelDiscovery.nextAllegiance, 'Hostile');
  let event;
  for (let n = 1; n < 30 && !event; n++) event = f.tick({ x: first.player.x - n * 3, y: first.player.y + n * 2 }).discoveries[0];
  assert.ok(event); assert.equal(f.p.actors[f.p.groups.find(g => g.id === event.groupId).members[0]].allegiance, 'Hostile');
  assert.equal(f.p.travelDiscovery.nextAllegiance, 'Neutral');
});

test('meaningful walking on previously explored ground gets a quiet-time opportunity, but standing does not', () => {
  const f = fixture(); f.p.travelDiscovery.explored = 'f'.repeat(4096);
  let event, elapsed = 0;
  for (let n = 0; n <= 20 && !event; n++) {
    event = f.tick({ x: 128.5 + n * 4, y: 128.5 }).discoveries[0]; elapsed = n * 3000;
  }
  assert.ok(event); assert.ok(elapsed <= D.QUIET_MOVING_MS + 3000);
});

test('visible travel sites never materialize residents on the far side of an occluding ruin wall', () => {
  const f = fixture();
  f.d.cells = { ...cells };
  for (let y = 115; y <= 140; y++) f.d.cells[`145,${y}`] = { ...floor, tile: 'wall' };
  f.p.travelDiscovery.distance = 1000; f.p.travelDiscovery.movingMs = 100000;
  f.tick({ x: 128.5, y: 128.5 });
  const result = f.tick({ x: 132.5, y: 128.5 });
  for (const event of result.discoveries) assert.ok(I.lineClear(f.d, { x: 132.5, y: 128.5 }, { x: event.x + .5, y: event.y + .5 }));
});

test('existing pacing is upgraded without regenerating rooms, resetting exploration, or changing exhausted groups', () => {
  const f = fixture(), explored = 'cafe', first = f.p.groups[0];
  f.p.travelDiscovery.nextDistance = 121; f.p.travelDiscovery.explored = explored;
  delete f.p.travelDiscovery.nextAllegiance;
  first.discoveryState = 'placed'; first.status = 'exhausted'; f.p.actors[first.members[0]].discoveryRevision = 4;
  const geometry = JSON.stringify(f.d);
  D.setup(f.d, f.p);
  assert.ok(f.p.travelDiscovery.nextDistance >= 48 && f.p.travelDiscovery.nextDistance <= 72);
  assert.equal(f.p.travelDiscovery.nextAllegiance, 'Hostile'); assert.equal(f.p.travelDiscovery.explored, explored);
  assert.equal(first.status, 'exhausted'); assert.equal(JSON.stringify(f.d), geometry);
});
