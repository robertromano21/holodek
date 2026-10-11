const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { createPopulationService } = require('../retort/roomPopulation');
const { planUnplacedRecovery, recoverCurrentRoom, recoverRoomInhabitants } = require('../retort/inhabitantRecovery');
const sheet = (name, state = 'Hostile', hp = 20) => `${name}\n      Female\n      Wraith\n      Sentinel\n      Level: 2\n      AC: 12\n      XP: 2000\n      HP: ${hp}\n      MaxHP: 20\n      Equipped: Weapon: ward blade, Armor: None, Shield: None, Other: None\n      Attack: 3\n      Damage: 4\n      Armor: 2\n      Magic: 1\n      State: ${state}`;
const consoleText = body => `Room Name: Test Sanctum\nCoordinates: X: 1, Y: 0, Z: 0\nObjects in Room: key\nInventory: cloak\nCurrent Quest: Preserve this quest\nPC:\n${sheet('PC', 'Alive')}\nNPCs in Party:\n${sheet('Companion', 'Friendly')}\nMonsters in Room:\n${body || 'None'}\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 4`;
function fixture() {
  const d = { geoKey: '1,0,0', _geometryStamp: 'untouched', classification: { indoor: true },
    start: { x: 4, y: 4 }, layout: { width: 64, height: 64 }, cells: {} };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = { tile: x === 0 || y === 0 || x === 63 || y === 63 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 6 };
  const p = I.createPopulation(d.geoKey, [{ name: 'Mason', allegiance: 'Neutral' }, { name: 'Guard', allegiance: 'Hostile' }]);
  p.initialSheets = sheet('Mason', 'Neutral') + '\n' + sheet('Guard');
  let text = consoleText(), db = JSON.stringify({ [d.geoKey]: { name: 'Test Sanctum', objects: { inRoom: 'key' }, inhabitants: p } });
  let roster = JSON.stringify([{ name: 'PC', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: d.geoKey },
    { name: 'Companion', type: 'npc', hp: 7, mazeX: 3, mazeY: 4, mazeRoomKey: d.geoKey }]);
  const populations = new Map([[d.geoKey, p]]), events = [];
  const state = { getDungeonRunId: () => 'run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getGamePaused: () => false,
    getRoomDungeonForSimulation: () => d, getRoomPopulation: key => populations.get(key), setRoomPopulation: (key, value) => populations.set(key, value),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: value => text = value,
    getRoomNameDatabase: () => db, setRoomNameDatabase: value => db = value,
    getCombatCharactersString: () => roster, setCombatCharactersString: value => roster = value };
  return { d, p, state, events, service: createPopulationService(state) };
}

test('empty or nearby-only console snapshots never exhaust unseen or distant encounters', () => {
  const f = fixture(); I.place(f.p, f.d);
  const before = JSON.stringify(f.p);
  for (let i = 0; i < 10; i++) I.sync(f.p, []);
  assert.equal(JSON.stringify(f.p), before);
  I.sync(f.p, I.parseBlocks(sheet('Mason', 'Neutral', 15)));
  assert.equal(f.p.actors.Mason.hp, 15); assert.equal(f.p.actors.Guard.status, 'present');
  assert.ok(f.p.groups.every(group => group.status === 'unseen'));
});

test('freshly generated casts can be placed and hydrated while the console lists None', () => {
  const f = fixture();
  const p = f.service.prepare(f.state.getUpdatedGameConsole(), f.d);
  assert.ok(Object.values(p.actors).every(a => a.status === 'present' && a.position));
  const roster = JSON.parse(f.state.getCombatCharactersString());
  assert.deepEqual(roster.map(a => a.name), ['PC', 'Companion', 'Mason', 'Guard']);
  assert.ok(roster.filter(a => a.type === 'monster').every(a => Number.isFinite(a.mazeX) && a.hp === 20));
  assert.equal(roster[1].hp, 20, 'Normal prepare observes the unchanged party sheet, not a monster seed');
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole()).length, 2);
});

test('saving a visibility-only snapshot preserves the full canonical room cast and live HP', () => {
  const f = fixture(); I.sync(f.p, I.parseBlocks(f.p.initialSheets)); I.place(f.p, f.d);
  f.p.actors.Guard.hp = 6;
  f.state.setUpdatedGameConsole(consoleText(sheet('Mason', 'Neutral', 12)));
  f.service.get(f.d.geoKey); f.service.save(f.p);
  const saved = JSON.parse(f.state.getRoomNameDatabase())[f.d.geoKey];
  assert.deepEqual(I.parseBlocks(saved.monsters.inRoom).map(a => [a.name, a.hp]), [['Mason', 12], ['Guard', 6]]);
  assert.equal(saved.monsters.consoleBlock, saved.monsters.inRoom);
  assert.equal(saved.objects.inRoom, 'key');
  assert.match(saved.inhabitants.actors.Mason.sheet, /HP: 12/);
});

test('other-room console snapshots cannot import that room cast or change current residents', () => {
  const f = fixture();
  f.service.get(f.d.geoKey, consoleText(sheet('Foreign Guard')).replace('X: 1, Y: 0, Z: 0', 'X: 2, Y: 0, Z: 0'), f.d);
  assert.deepEqual(Object.keys(f.p.actors), ['Mason', 'Guard']);
  assert.ok(Object.values(f.p.actors).every(a => a.status === 'present' && a.position));
});

test('explicit HP death and recruitment persist while unrelated hidden residents remain alive', () => {
  const f = fixture(); I.sync(f.p, I.parseBlocks(f.p.initialSheets));
  I.sync(f.p, I.parseBlocks(sheet('Guard', 'Dead', 0)), [{ name: 'Mason' }]);
  I.sync(f.p, []);
  assert.equal(f.p.actors.Guard.status, 'dead'); assert.equal(f.p.actors.Mason.status, 'recruited');
  assert.ok(f.p.groups.every(g => g.status === 'exhausted'));
  const full = I.withStates(consoleText(), f.p);
  assert.deepEqual(I.parseSheets(full).map(a => [a.name, a.hp, a.state]), [['Guard', 0, 'Dead']]);
  const roster = []; I.attach(roster, f.p); assert.deepEqual(roster, []);
});

test('canonical merging never revives a just-defeated monster or discards a newly observed arrival', () => {
  const f = fixture(); I.sync(f.p, I.parseBlocks(f.p.initialSheets));
  const value = I.withStates(consoleText(sheet('Guard', 'Dead', 0) + '\n' + sheet('New Arrival', 'Neutral')), f.p);
  assert.deepEqual(I.parseSheets(value).map(a => [a.name, a.hp]), [['Mason', 20], ['Guard', 0], ['New Arrival', 20]]);
  I.sync(f.p, I.parseSheets(value));
  assert.equal(f.p.actors.Guard.status, 'dead');
  I.sync(f.p, I.parseBlocks(sheet('Guard', 'Hostile', 20)));
  assert.equal(f.p.actors.Guard.hp, 0); assert.equal(I.residentSheets(f.p).find(a => a.name === 'Guard').hp, 0);
});

test('merging residents preserves character field order, indentation, equipment, LF and CRLF', () => {
  for (const eol of ['\n', '\r\n']) {
    const f = fixture(); f.p.initialSheets = f.p.initialSheets.replace(/\n/g, eol);
    const text = consoleText().replace(/\n/g, eol), full = I.withStates(text, f.p);
    assert.ok(full.includes(f.p.initialSheets));
    assert.equal(I.parseSheets(full).length, 2);
    assert.equal(full.replace(I.sectionPattern('Monsters in Room'), '$1')
      .replace(/^Monsters State:[^\r\n]*/m, 'Monsters State: Mixed'),
      text.replace(I.sectionPattern('Monsters in Room'), '$1'));
  }
});

test('unplaced recovery stages separate reachable sites without changing saved geometry or the original population', () => {
  const f = fixture();
  for (const actor of Object.values(f.p.actors)) actor.status = 'departed';
  for (const group of f.p.groups) group.status = 'exhausted';
  const before = JSON.stringify(f.p), geometry = JSON.stringify(f.d);
  const plan = planUnplacedRecovery(f.p, f.d);
  assert.deepEqual(plan.names, ['Mason', 'Guard']);
  assert.ok(plan.population.groups.every(g => g.site && g.status === 'unseen'));
  assert.ok(Object.values(plan.population.actors).every(a => a.position && a.hp === 20));
  assert.equal(JSON.stringify(f.p), before); assert.equal(JSON.stringify(f.d), geometry);
});

test('recovery excludes deaths, recruited actors and any actual departure/discovery history', () => {
  for (const change of [{ status: 'dead', hp: 0 }, { status: 'recruited' }, { hp: 0 }, { state: 'Dead' },
    { home: { x: 10, y: 10 } }, { position: { x: 10, y: 10 } }, { encounteredAt: 1 }, { departedAt: 1 },
    { departureReason: 'story' }, { lastSpokeAt: 1 }, { dialogueIndex: 1 }]) {
    const f = fixture(); Object.assign(f.p.actors.Guard, { status: 'departed' }, change);
    f.p.groups[1].status = 'exhausted';
    assert.deepEqual(planUnplacedRecovery(f.p, f.d).names, [], JSON.stringify(change));
  }
  const f = fixture(); f.p.actors.Mason.status = 'departed'; f.p.groups[0].status = 'exhausted';
  assert.deepEqual(planUnplacedRecovery(f.p, f.d, [{ name: 'Mason' }]).names, []);
});

test('current-room recovery preserves party, items, quest, dungeon and HP and commits once through the existing transport', () => {
  const f = fixture();
  for (const actor of Object.values(f.p.actors)) actor.status = 'departed';
  for (const group of f.p.groups) group.status = 'exhausted';
  const geometry = JSON.stringify(f.d), party = JSON.parse(f.state.getCombatCharactersString()), text = f.state.getUpdatedGameConsole();
  const options = { runId: 'run', geoKey: f.d.geoKey, broadcast: event => f.events.push(event) };
  const result = recoverCurrentRoom(f.state, options);
  assert.deepEqual(result.restored, ['Mason', 'Guard']); assert.equal(f.events.length, 1);
  const after = f.state.getUpdatedGameConsole();
  for (const label of ['PC', 'NPCs in Party']) assert.equal(after.match(I.sectionPattern(label))[2], text.match(I.sectionPattern(label))[2]);
  assert.deepEqual(JSON.parse(f.state.getCombatCharactersString()).slice(0, 2), party);
  assert.match(after, /Objects in Room: key/); assert.match(after, /Inventory: cloak/); assert.match(after, /Current Quest: Preserve this quest/);
  assert.equal(JSON.stringify(f.d), geometry);
  assert.equal(f.events[0].type, 'realtime_combat_result');
  assert.deepEqual(recoverCurrentRoom(f.state, options).restored, []); assert.equal(f.events.length, 1);
});

test('recovery refuses busy actions, stale runs and wrong rooms without any writes', () => {
  for (const options of [{ runId: 'old', geoKey: '1,0,0' }, { runId: 'run', geoKey: '2,0,0' },
    { runId: 'run', geoKey: '1,0,0', busy: true }]) {
    const f = fixture(), before = [f.state.getUpdatedGameConsole(), f.state.getRoomNameDatabase(), f.state.getCombatCharactersString()];
    assert.throws(() => recoverCurrentRoom(f.state, options));
    assert.deepEqual([f.state.getUpdatedGameConsole(), f.state.getRoomNameDatabase(), f.state.getCombatCharactersString()], before);
  }
});

test('repairing the saved Sanctum after the demo leaves it cannot move monsters into the active room or change its console/party', () => {
  const f = fixture();
  for (const actor of Object.values(f.p.actors)) actor.status = 'departed';
  for (const group of f.p.groups) group.status = 'exhausted';
  f.state.getLastCoords = () => ({ x: 2, y: 0, z: 0 });
  const before = [f.state.getUpdatedGameConsole(), f.state.getCombatCharactersString(), JSON.stringify(f.d)];
  const result = recoverRoomInhabitants(f.state, { runId: 'run', geoKey: f.d.geoKey, broadcast: event => f.events.push(event) });
  assert.deepEqual(result.restored, ['Mason', 'Guard']); assert.equal(result.inactiveRoom, true);
  assert.deepEqual([f.state.getUpdatedGameConsole(), f.state.getCombatCharactersString(), JSON.stringify(f.d)], before);
  const saved = JSON.parse(f.state.getRoomNameDatabase())[f.d.geoKey];
  assert.equal(I.parseBlocks(saved.monsters.inRoom).length, 2);
  assert.equal(f.events[0].type, 'room_population'); assert.equal(f.events[0].population.geoKey, f.d.geoKey);
});
