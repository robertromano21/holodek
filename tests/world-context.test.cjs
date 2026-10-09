'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoomWorldContext, snapshotQuestContext, propagateComplexIdentity,
  supplementOutdoorRoutes, attachSceneWorldContext } = require('../retort/worldContext');
const { chooseEnvironmentIntents } = require('../retort/environmentIntents');
const DungeonExits = require('../assets/dungeonExits');

const OFFSETS = { north: [0, 1, 0], northeast: [1, 1, 0], east: [1, 0, 0], southeast: [1, -1, 0],
  south: [0, -1, 0], southwest: [-1, -1, 0], west: [-1, 0, 0], northwest: [-1, 1, 0],
  up: [0, 0, 1], down: [0, 0, -1] };
const keyOf = c => `${c.x},${c.y},${c.z}`;
const step = (c, direction) => {
  const [x, y, z] = OFFSETS[direction];
  return { x: c.x + x, y: c.y + y, z: c.z + z };
};
const link = (targetCoordinates, status = 'open') => ({ targetCoordinates, status, key: null });
const clone = value => JSON.parse(JSON.stringify(value));

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function stateFor(tasks = [], taskIndex = 0, currentQuest = 'Recover the bound relic, preserving the old oath.') {
  const data = { tasks, taskIndex, currentQuest }, calls = {};
  const read = key => { calls[key] = (calls[key] || 0) + 1; return data[key]; };
  const deny = () => { throw new Error('Construction must not mutate quest state'); };
  return { data, calls, state: { getCurrentTasks: () => read('tasks'), getCurrentTaskIndex: () => read('taskIndex'),
    getCurrentQuest: () => read('currentQuest'), setCurrentTasks: deny, setCurrentTaskIndex: deny,
    setCurrentQuest: deny, appendQuestLog: deny, setQuestSeeded: deny } };
}

function consoleFor(overrides = {}) {
  const lines = { 'Current Quest': 'Console quest fallback', 'Next Boss': 'The Ash Regent',
    'Next Boss Room': 'Sanctuary of Unbroken Oaths', 'Boss Room Coordinates': 'X: 9, Y: 9, Z: 2',
    'Next Artifact': 'Sepulchra', Exits: 'west', 'Adjacent Rooms': 'west: Earlier Reach',
    Inventory: 'Oath Key', XP: '200', 'Quest Status': 'Pending', ...overrides };
  return Object.entries(lines).map(([key, value]) => `${key}: ${value}`).join('\r\n');
}

function specAt(coords, exits = []) {
  return { coords: { ...coords }, indoor: false, exits, source: { roomName: 'Existing Reach', description: 'Existing description' } };
}

function nonRouteLines(text) {
  return text.split(/\r?\n/).filter(line => !/^(Exits|Adjacent Rooms):/.test(line));
}

test('root complex identity propagates only to known indoor neighbors and preserves established sites', () => {
  const coords = { x: 0, y: 0, z: 0 };
  const db = { '0,0,0': { indoor: true, name: 'Ruined Temple Entrance', exits: { north: {}, east: {}, south: {}, west: {}, up: {} } },
    '0,1,0': { classification: { indoor: true }, name: 'Temple Nave' },
    '1,0,0': { indoor: false, classification: { indoor: true }, name: 'Outside Wastes' },
    '0,-1,0': { indoor: true, complexId: 'established-villa', name: 'Independent Villa' },
    '-1,0,0': { name: 'Unknown Skeleton' } };
  const before = clone(db);
  propagateComplexIdentity(db, coords);
  assert.equal(db['0,0,0'].complexId, 'ruined-temple');
  assert.equal(db['0,1,0'].complexId, 'ruined-temple');
  assert.equal(db['0,-1,0'].complexId, 'established-villa');
  assert.equal(db['1,0,0'].complexId, undefined);
  assert.equal(db['-1,0,0'].complexId, undefined);
  assert.equal(db['0,0,1'], undefined, 'No new rooms are constructed');
  const after = clone(db);
  delete after['0,0,0'].complexId;
  delete after['0,1,0'].complexId;
  assert.deepEqual(after, before);
  const stamp = JSON.stringify(db);
  propagateComplexIdentity(db, coords);
  assert.equal(JSON.stringify(db), stamp);
});

test('non-root sites get coordinate identities, while existing source identity and explicit links take precedence', () => {
  for (const explicit of ['20,-4,1', { x: 20, y: -4, z: 1 }]) {
    const coords = { x: -3, y: 4, z: 1 };
    const db = { '-3,4,1': { classification: { indoor: true }, exits: { north: link(explicit) } },
      '20,-4,1': { indoor: true }, '-3,5,1': { indoor: true } };
    propagateComplexIdentity(db, coords);
    assert.equal(db['-3,4,1'].complexId, 'site:-3,4,1');
    assert.equal(db['20,-4,1'].complexId, 'site:-3,4,1');
    assert.equal(db['-3,5,1'].complexId, undefined);
  }
  const db = { '4,5,2': { indoor: true, complexId: 'known-citadel', exits: { east: {} } }, '5,5,2': { indoor: true } };
  propagateComplexIdentity(db, { x: 4, y: 5, z: 2 });
  assert.equal(db['5,5,2'].complexId, 'known-citadel');
});

test('missing, unknown and outdoor sources neither receive nor propagate complex identity', () => {
  for (const source of [undefined, {}, { indoor: false }, { classification: { indoor: false } }]) {
    const db = freeze({ '4,5,2': source, '4,6,2': { indoor: true } }), before = JSON.stringify(db);
    propagateComplexIdentity(db, { x: 4, y: 5, z: 2 });
    assert.equal(JSON.stringify(db), before);
  }
});

test('world neighbors use all ten GEO offsets with north +y and never create destination records', () => {
  const coords = { x: -3, y: 4, z: 2 };
  const db = freeze({ '-3,4,2': { indoor: false, exits: Object.fromEntries(Object.keys(OFFSETS).map(d => [d, {}])) } });
  const before = JSON.stringify(db), context = buildRoomWorldContext(db, coords);
  assert.equal(context.version, 1);
  assert.equal(context.coordinates, '-3,4,2');
  assert.equal(context.neighbors.length, 10);
  for (const neighbor of context.neighbors) {
    assert.equal(neighbor.coordinates, keyOf(step(coords, neighbor.direction)));
    assert.equal(neighbor.name, '');
    assert.equal(neighbor.indoor, null);
    assert.equal(neighbor.connection, 'unclassified');
    assert.equal(neighbor.status, 'open');
  }
  assert.equal(JSON.stringify(db), before);
});

test('GEO north +y is intentionally opposite to north-facing room-grid marker -y', () => {
  const size = 25, start = { x: 12, y: 12 }, cells = {};
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells[`${x},${y}`] = {
    tile: x && y && x < size - 1 && y < size - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3
  };
  const dungeon = { layout: { width: size, height: size }, start, cells };
  const marker = DungeonExits.install(dungeon, ['north']).markers[0];
  assert.ok(marker && marker.y < start.y, 'Grid north must be above the spawn');
  const context = buildRoomWorldContext({ '4,5,2': { indoor: false, exits: { north: {} } } }, { x: 4, y: 5, z: 2 });
  assert.equal(context.neighbors[0].coordinates, '4,6,2', 'World north increases y');
});

test('known neighbors retain exact explicit targets, names, locks, classifications and complex identity', () => {
  for (const target of ['9,9,2', { x: 9, y: 9, z: 2 }]) {
    const db = freeze({ '4,5,2': { indoor: false, regionId: 'tartarus-reach', outdoorRegionDepth: 6,
      exits: { north: link(target, 'locked'), east: {} } },
      '9,9,2': { name: 'Sanctuary of Unbroken Oaths', classification: { indoor: true }, complexId: 'boss-site', description: 'Bound lore' },
      '5,5,2': { name: 'Known outdoor trail', indoor: false } });
    const before = JSON.stringify(db), context = buildRoomWorldContext(db, { x: 4, y: 5, z: 2 });
    assert.deepEqual(context.neighbors[0], { direction: 'north', coordinates: '9,9,2', name: 'Sanctuary of Unbroken Oaths',
      indoor: true, complexId: 'boss-site', connection: 'building-entrance', status: 'locked' });
    assert.equal(context.neighbors[1].connection, 'outdoor-trail');
    assert.equal(context.regionId, 'tartarus-reach');
    assert.equal(context.outdoorDepth, 6);
    assert.equal(JSON.stringify(db), before);
  }
});

test('indoor/outdoor connection types are conditional on authoritative boolean evidence', () => {
  for (const [sourceInside, targetInside, expected] of [[true, true, 'interior-passage'], [true, false, 'exterior-gateway'],
    [false, true, 'building-entrance'], [false, false, 'outdoor-trail'], [null, true, 'unclassified']]) {
    const db = { '2,0,0': { indoor: sourceInside, exits: { north: {} } }, '2,1,0': { classification: { indoor: targetInside } } };
    assert.equal(buildRoomWorldContext(db, { x: 2, y: 0, z: 0 }).neighbors[0].connection, expected);
  }
});

test('caller exits filter context without replacing canonical stored links or mutating the database', () => {
  const db = freeze({ '0,0,0': { indoor: true, exits: { north: link('7,8,9', 'sealed'), east: {} } },
    '7,8,9': { name: 'Known Vault', indoor: true } });
  const context = buildRoomWorldContext(db, { x: 0, y: 0, z: 0 }, { exits: 'n, north; invalid' });
  assert.equal(context.complexId, 'ruined-temple');
  assert.equal(context.neighbors.length, 1);
  assert.equal(context.neighbors[0].coordinates, '7,8,9');
  assert.equal(context.neighbors[0].status, 'sealed');
  assert.deepEqual(buildRoomWorldContext(db, { x: 0, y: 0, z: 0 }, { exits: [] }).neighbors, []);
});

test('quest snapshot is a deep detached read-only view with exact boss bindings and getter-only access', () => {
  const tasks = freeze([{ type: 'Fetch', desc: 'Recover Sepulchra', status: 'Pending', metrics: 'Sepulchra in inventory',
    elements: [{ type: 'object', name: 'Sepulchra', placement: { x: 4, y: 5, z: 2 } }],
    hardRequirements: [{ check: 'inventory_contains', value: 'Sepulchra' }], rewards: { xp: 500 } }]);
  const fixture = stateFor(tasks, 2), before = JSON.stringify(fixture.data), text = consoleFor();
  const snapshot = snapshotQuestContext(fixture.state, text);
  assert.equal(snapshot.currentQuest, fixture.data.currentQuest);
  assert.equal(snapshot.taskIndex, 2);
  assert.deepEqual(snapshot.tasks, tasks);
  assert.notEqual(snapshot.tasks, tasks);
  assert.notEqual(snapshot.tasks[0].elements[0], tasks[0].elements[0]);
  assert.equal(snapshot.nextBoss, 'The Ash Regent');
  assert.equal(snapshot.nextBossRoom, 'Sanctuary of Unbroken Oaths');
  assert.equal(snapshot.bossCoordinates, 'X: 9, Y: 9, Z: 2');
  assert.equal(snapshot.nextArtifact, 'Sepulchra');
  snapshot.tasks[0].elements[0].placement.x = 100;
  snapshot.tasks[0].rewards.xp = 0;
  assert.equal(JSON.stringify(fixture.data), before);
  assert.deepEqual(fixture.calls, { currentQuest: 1, taskIndex: 1, tasks: 1 });
});

test('quest snapshot uses console fallback and bounds task count without changing source tasks', () => {
  const fixture = stateFor(Array.from({ length: 12 }, (_, index) => ({ type: 'Fetch', desc: `Task ${index}` })), 0, '');
  const before = JSON.stringify(fixture.data), snapshot = snapshotQuestContext(fixture.state, consoleFor());
  assert.equal(snapshot.currentQuest, 'Console quest fallback');
  assert.equal(snapshot.tasks.length, 8);
  assert.equal(JSON.stringify(fixture.data), before);
  assert.deepEqual(snapshotQuestContext({}), { currentQuest: '', taskIndex: 0, tasks: [],
    nextBoss: '', nextBossRoom: '', bossCoordinates: '', nextArtifact: '' });
});

test('scene construction tasks include only explicit matching element, requirement and action placements', () => {
  const coords = { x: 4, y: 5, z: 2 };
  const tasks = freeze([
    { type: 'Fetch', desc: 'Fetch Sepulchra', status: 'Pending', elements: [{ type: 'object', name: 'Sepulchra', placement: '4,5,2' }] },
    { type: 'Defeat', desc: 'Defeat known guardian', requiredElements: [{ type: 'monster', name: 'Known Guardian', placement: coords }] },
    { type: 'Ritual', desc: 'Perform the known ritual', hardRequirements: [{ check: 'at_coords', value: 'X: 4, Y: 5, Z: 2' }] },
    { type: 'Unlock', desc: 'Use the Oath Key', requiredElements: [{ type: 'key', name: 'Oath Key', placement: '8,8,2' }],
      actionRequirements: [{ check: 'exit_open', coords: ' 4, 5, 2 ', direction: 'north' }] },
    { type: 'Deliver', desc: 'Deliver elsewhere', elements: [{ type: 'npc', name: 'Known Keeper', placement: '6,6,2' }],
      hardRequirements: [{ check: 'at_coords', value: '6,6,2' }] },
    { type: 'Fetch', desc: 'Inventory evidence is not a room placement', hardRequirements: [{ check: 'inventory_contains', value: '4,5,2' }] },
    { type: 'Investigate', desc: 'No bound construction location', elements: [] }
  ]);
  const fixture = stateFor(tasks, 3), db = freeze({ '4,5,2': { indoor: false, name: 'Existing Reach',
    environmentIntent: { template: 'ruined_courtyard', narrativeHint: 'The existing oath is remembered here.' } } });
  const before = JSON.stringify({ db, data: fixture.data }), spec = specAt(coords);
  const attached = attachSceneWorldContext(spec, db, fixture.state, consoleFor());
  assert.equal(attached, spec);
  assert.deepEqual(spec.source.questContext.constructionTasks, tasks.slice(0, 4));
  assert.deepEqual(spec.worldContext.quest.tasks, tasks.slice(0, 4));
  assert.equal(spec.source.questContext.taskIndex, 3);
  assert.ok(spec.source.questContext.completionOwner.includes('construction cannot complete tasks'));
  assert.deepEqual(spec.source.environmentIntent, db['4,5,2'].environmentIntent);
  assert.equal(spec.worldContext.quest.nextBossRoom, 'Sanctuary of Unbroken Oaths');
  assert.equal(spec.worldContext.quest.bossCoordinates, 'X: 9, Y: 9, Z: 2');
  assert.equal(spec.source.roomName, 'Existing Reach');
  assert.equal(spec.source.description, 'Existing description');
  assert.equal(JSON.stringify({ db, data: fixture.data }), before);
  spec.source.questContext.constructionTasks[0].desc = 'Changed detached view';
  assert.equal(tasks[0].desc, 'Fetch Sepulchra');
  assert.equal(spec.completed, undefined);
  assert.equal(spec.rewards, undefined);
});

test('a key task is relevant at its pickup room and its guarded exit, but nowhere else', () => {
  const tasks = freeze([{ type: 'Unlock', actionKind: 'unlock_exit', status: 'Pending',
    requiredElements: [{ type: 'key', name: 'Oath Key', placement: '2,0,0', unlocks: { coordinates: '3,0,0', direction: 'north' } }],
    hardRequirements: [{ check: 'inventory_contains', value: 'Oath Key' }],
    actionRequirements: [{ check: 'exit_open', coords: { x: 3, y: 0, z: 0 }, direction: 'north' }] }]);
  const fixture = stateFor(tasks), db = freeze({ '2,0,0': { indoor: true, objects: [{ name: 'Oath Key', type: 'key' }] },
    '3,0,0': { indoor: true, exits: { north: { status: 'locked', key: 'Oath Key', targetCoordinates: '3,1,0' } } } });
  const before = JSON.stringify({ db, data: fixture.data });
  for (const [x, expected] of [[2, 1], [3, 1], [4, 0]]) {
    const spec = attachSceneWorldContext(specAt({ x, y: 0, z: 0 }), db, fixture.state, consoleFor());
    assert.equal(spec.source.questContext.constructionTasks.length, expected);
    if (expected) {
      assert.deepEqual(spec.source.questContext.constructionTasks[0], tasks[0]);
      assert.equal(spec.source.questContext.constructionTasks[0].status, 'Pending');
    }
  }
  assert.equal(JSON.stringify({ db, data: fixture.data }), before);
});

test('scene context accepts serialized/malformed databases, and scenes without coordinates are unchanged', () => {
  const fixture = stateFor(), coords = { x: 2, y: 0, z: 0 };
  const serialized = JSON.stringify({ '2,0,0': { indoor: true, complexId: 'known-temple' } });
  assert.equal(attachSceneWorldContext(specAt(coords), serialized, fixture.state, consoleFor()).worldContext.complexId, 'known-temple');
  assert.equal(attachSceneWorldContext(specAt(coords), '{broken', fixture.state, consoleFor()).worldContext.indoor, null);
  const missing = freeze({ source: { roomName: 'Unpositioned' } });
  assert.equal(attachSceneWorldContext(missing, {}, fixture.state, consoleFor()), missing);
});

test('world snapshot passed to environment planning preserves boss, quest, key-action coordinates and task state', async () => {
  const coords = { x: 2, y: 0, z: 0 }, bossCoordinates = { x: 2, y: 1, z: 0 };
  const tasks = freeze([{ type: 'Unlock', requiredElements: [{ type: 'key', name: 'Oath Key', placement: '3,0,0' }],
    actionRequirements: [{ check: 'exit_open', coords: '3,0,0', direction: 'east' }], status: 'Pending' }]);
  const fixture = stateFor(tasks), db = freeze({ '2,0,0': { indoor: false, exits: { north: link('2,1,0'), east: {} } } });
  const text = consoleFor({ 'Boss Room Coordinates': 'X: 2, Y: 1, Z: 0' }), before = JSON.stringify({ db, data: fixture.data });
  const quest = snapshotQuestContext(fixture.state, text);
  const plan = await chooseEnvironmentIntents(null, { ...quest, coords, directions: ['north', 'east'], database: db,
    bossCoordinates, sourceIndoor: false, seed: 'world-context' });
  assert.equal(plan.intents.north, undefined, 'Missing boss record must not be environment-planned');
  assert.equal(plan.protected.bossTargetKey, '2,1,0');
  assert.equal(plan.protected.nextBoss, quest.nextBoss);
  assert.equal(plan.protected.nextBossRoom, quest.nextBossRoom);
  assert.equal(plan.protected.currentQuest, quest.currentQuest);
  assert.deepEqual(plan.protected.tasks[0].actionRequirements, [{ ...tasks[0].actionRequirements[0], value: null }]);
  assert.equal(plan.intents.east.targetKey, '3,0,0');
  assert.equal(JSON.stringify({ db, data: fixture.data }), before);
});

test('supplementation is a no-op for unknown/indoor sources and leaves console and task/boss text untouched', () => {
  for (const room of [undefined, {}, { indoor: true }, { classification: { indoor: true } }]) {
    const db = freeze({ '2,0,0': room }), text = consoleFor(), before = JSON.stringify(db);
    const result = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, ['w'], text);
    assert.equal(result.report.added, false);
    assert.deepEqual(result.exits, ['west']);
    assert.equal(result.updatedConsole, text);
    assert.equal(JSON.stringify(db), before);
  }
});

test('an open known deeper outdoor neighbor prevents supplementation and unnecessary console rewrites', () => {
  const db = freeze({ '2,0,0': { indoor: false, exits: { north: link('2,1,0') } }, '2,1,0': { indoor: false, name: 'Known Reach' } });
  const text = consoleFor({ Exits: 'n', 'Adjacent Rooms': 'n: Known Reach' }), before = JSON.stringify(db);
  const result = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, ['n'], text);
  assert.equal(result.report.reason, 'existing-deeper-outdoor-exit');
  assert.equal(result.report.added, false);
  assert.equal(result.updatedConsole, text);
  assert.equal(JSON.stringify(db), before);
});

test('restoring a stored deeper exit refreshes only exit/adjacent console lines, without new construction', () => {
  const db = freeze({ '2,0,0': { indoor: false, exits: { north: link('2,1,0'), west: link('1,0,0', 'locked') } },
    '2,1,0': { indoor: false, name: 'Known Reach' }, '1,0,0': { name: 'Earlier Reach', indoor: true } });
  const text = consoleFor(), before = JSON.stringify(db), exits = ['west'];
  const result = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, exits, text);
  assert.equal(result.report.added, false);
  assert.deepEqual(result.exits, ['west', 'north']);
  assert.ok(result.updatedConsole.includes('Exits: west, north'));
  assert.ok(result.updatedConsole.includes('west: Earlier Reach (locked), north: Known Reach'));
  assert.deepEqual(nonRouteLines(result.updatedConsole), nonRouteLines(text));
  assert.deepEqual(exits, ['west']);
  assert.equal(JSON.stringify(db), before);
});

test('conditional supplementation adds a GEO outward skeleton without changing known rooms or boss gates', () => {
  const db = { '2,0,0': { indoor: false, name: 'Existing Reach', outdoorContinuation: 'north',
    description: 'Existing description', objects: [{ name: 'Oath Key', type: 'key' }],
    exits: { west: link('1,0,0'), east: { ...link('3,0,0', 'locked'), key: 'Boss Seal', bossGateId: 'existing-gate' } } },
    '1,0,0': { name: 'Earlier Reach', indoor: true },
    '3,0,0': { name: 'Sanctuary of Unbroken Oaths', indoor: true, description: 'EXACT bound boss lore',
      bossGate: { id: 'existing-gate', bossName: 'The Ash Regent' }, monsters: { inRoom: 'The Ash Regent' } } };
  const known = clone(db), text = consoleFor({ 'Boss Room Coordinates': 'X: 3, Y: 0, Z: 0',
    Exits: 'west, east', 'Adjacent Rooms': 'west: Earlier Reach, east: Sanctuary of Unbroken Oaths (locked)' });
  const exits = ['west', 'east'], result = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, exits, text);
  assert.equal(result.report.added, true);
  assert.equal(result.report.direction, 'north');
  assert.equal(result.report.targetKey, '2,1,0');
  assert.equal(db['2,1,0'].indoor, false);
  assert.deepEqual(db['2,1,0'].exits.south, { ...link('2,0,0'), outdoorContinuation: true });
  assert.equal(db['2,1,0'].objects, undefined);
  assert.equal(db['2,1,0'].monsters, undefined);
  assert.equal(db['2,1,0'].dungeon, undefined);
  assert.deepEqual(db['1,0,0'], known['1,0,0']);
  assert.deepEqual(db['3,0,0'], known['3,0,0']);
  assert.deepEqual(db['2,0,0'].objects, known['2,0,0'].objects);
  assert.equal(db['2,0,0'].description, known['2,0,0'].description);
  assert.deepEqual(db['2,0,0'].exits.east, known['2,0,0'].exits.east);
  assert.deepEqual(exits, ['west', 'east']);
  assert.deepEqual(nonRouteLines(result.updatedConsole), nonRouteLines(text));
  const after = JSON.stringify(db);
  const repeated = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, result.exits, result.updatedConsole);
  assert.equal(repeated.report.added, false);
  assert.equal(repeated.updatedConsole, result.updatedConsole);
  assert.equal(JSON.stringify(db), after);
});

test('visited destination evidence causes a new continuation rather than reusing the visited room', () => {
  for (const evidence of [{ visited: true }, { sceneSpec: {} }, { description: 'Previously described' }, { roomDescription: 'Previously described' }]) {
    const db = { '2,0,0': { indoor: false, exits: { north: link('2,1,0') } },
      '2,1,0': { indoor: false, name: 'Already visited reach', ...evidence } };
    const previous = clone(db['2,1,0']);
    const result = supplementOutdoorRoutes(db, { x: 2, y: 0, z: 0 }, ['north'], consoleFor({ Exits: 'north' }));
    assert.equal(result.report.added, true);
    assert.notEqual(result.report.targetKey, '2,1,0');
    assert.deepEqual(db['2,1,0'], previous);
  }
});

test('no available outward route causes no mutation or console rewrite', () => {
  const coords = { x: 2, y: 0, z: 0 }, exits = Object.keys(OFFSETS);
  const db = { '2,0,0': { indoor: false, exits: Object.fromEntries(exits.map(d => [d, link(keyOf(step(coords, d)), 'sealed')])) } };
  for (const direction of exits) db[keyOf(step(coords, direction))] = { indoor: true, name: `Known ${direction} room` };
  freeze(db);
  const text = consoleFor({ Exits: exits.join(', ') }), before = JSON.stringify(db);
  const result = supplementOutdoorRoutes(db, coords, exits, text);
  assert.equal(result.report.added, false);
  assert.equal(result.report.reason, 'no-available-outward-route');
  assert.equal(result.updatedConsole, text);
  assert.equal(JSON.stringify(db), before);
});

test('alias-key exit metadata must retain an explicit boss target and lock', () => {
  const db = { '4,5,2': { indoor: false, exits: { N: link('9,9,2', 'locked') } },
    '9,9,2': { indoor: true, name: 'Sanctuary of Unbroken Oaths' } };
  const neighbor = buildRoomWorldContext(db, { x: 4, y: 5, z: 2 }).neighbors[0];
  assert.equal(neighbor.coordinates, '9,9,2');
  assert.equal(neighbor.status, 'locked');
});

test('array exit metadata must retain explicit targets for context and complex propagation', () => {
  const db = { '4,5,2': { indoor: true, exits: [{ direction: 'north', ...link('9,9,2', 'sealed') }] },
    '9,9,2': { indoor: true }, '4,6,2': { indoor: true } };
  const neighbor = buildRoomWorldContext(db, { x: 4, y: 5, z: 2 }).neighbors[0];
  propagateComplexIdentity(db, { x: 4, y: 5, z: 2 });
  assert.deepEqual({ coordinates: neighbor.coordinates, status: neighbor.status, target: db['9,9,2'].complexId,
    unrelated: db['4,6,2'].complexId }, { coordinates: '9,9,2', status: 'sealed', target: 'site:4,5,2', unrelated: undefined });
});

for (const [format, exits] of [['alias-key', { N: link('9,9,2', 'locked') }],
  ['array', [{ direction: 'north', ...link('9,9,2', 'locked') }]]]) {
  test(`environment planner must protect an ${format} explicit boss link instead of planning a geometric neighbor`, async () => {
    const db = freeze({ '4,5,2': { indoor: false, exits }, '9,9,2': { indoor: true, name: 'Bound boss sanctuary' } });
    const plan = await chooseEnvironmentIntents(null, { coords: { x: 4, y: 5, z: 2 }, directions: ['north'], database: db,
      bossCoordinates: { x: 9, y: 9, z: 2 }, nextBossRoom: 'Bound boss sanctuary', sourceIndoor: false });
    assert.equal(plan.intents.north, undefined);
    assert.equal(plan.status, 'skipped');
  });
}

test('empty console fields must not consume the next quest/boss field', () => {
  const text = consoleFor({ 'Current Quest': '', 'Next Boss': '', 'Next Boss Room': '' });
  const snapshot = snapshotQuestContext({}, text);
  assert.deepEqual([snapshot.currentQuest, snapshot.nextBoss, snapshot.nextBossRoom], ['', '', '']);
  assert.equal(snapshot.bossCoordinates, 'X: 9, Y: 9, Z: 2');
});

test('bounded quest snapshots must retain an active task beyond the first eight', () => {
  const tasks = Array.from({ length: 10 }, (_, i) => ({ type: 'Fetch', desc: `Task ${i}`,
    elements: [{ type: 'object', name: `Bound Item ${i}`, placement: `${i},0,0` }] }));
  const fixture = stateFor(tasks, 9);
  const spec = attachSceneWorldContext(specAt({ x: 9, y: 0, z: 0 }), {}, fixture.state, consoleFor());
  assert.equal(spec.source.questContext.taskIndex, 9);
  assert.equal(spec.source.questContext.constructionTasks.length, 1);
  assert.equal(spec.source.questContext.constructionTasks[0].elements[0].name, 'Bound Item 9');
});

test('construction context metadata must be detached from authoritative quest and room metadata', () => {
  const db = { '2,0,0': { indoor: false, environmentIntent: { template: 'wasteland', narrativeHint: 'Bound atmosphere' } } };
  const quest = { currentQuest: 'Bound quest', tasks: [] };
  const world = buildRoomWorldContext(db, { x: 2, y: 0, z: 0 }, { quest });
  world.environmentIntent.narrativeHint = 'Changed consumer copy';
  world.quest.currentQuest = 'Changed consumer copy';
  assert.equal(db['2,0,0'].environmentIntent.narrativeHint, 'Bound atmosphere');
  assert.equal(quest.currentQuest, 'Bound quest');
});

test('supplementation must protect a bound boss coordinate even when its database record is missing', () => {
  const coords = { x: 2, y: 0, z: 0 }, db = { '2,0,0': { indoor: false, exits: {} } };
  for (const direction of Object.keys(OFFSETS).filter(d => d !== 'north')) {
    db[keyOf(step(coords, direction))] = { indoor: true, name: `Known ${direction} room` };
  }
  const text = consoleFor({ 'Boss Room Coordinates': 'X: 2, Y: 1, Z: 0', Exits: '', 'Adjacent Rooms': '' });
  const before = JSON.stringify(db), result = supplementOutdoorRoutes(db, coords, [], text);
  assert.equal(result.report.added, false);
  assert.equal(db['2,1,0'], undefined, 'No wasteland skeleton may occupy the bound boss target');
  assert.equal(result.updatedConsole, text);
  assert.equal(JSON.stringify(db), before);
});

test('world context resolves labeled/whitespace keys and object Map keys without guessing classifications', () => {
  for (const map of [false, true]) {
    const entries = [['X: 4, Y: 5, Z: 2', { classification: { indoor: true }, exits: [{ direction: 'N', ...link('X: 9, Y: 9, Z: 2', 'locked') }] }],
      [map ? { x: 9, y: 9, z: 2 } : ' 9,9,2 ', { isOutdoor: true, name: 'EXACT outside neighbor', classification: { biome: 'wasteland' } }]];
    const db = map ? new Map(entries) : Object.fromEntries(entries), before = JSON.stringify(entries);
    const world = buildRoomWorldContext(db, ' X: 4, Y: 5, Z: 2 ');
    assert.equal(world.coordinates, '4,5,2');
    assert.equal(world.indoor, true);
    assert.deepEqual(world.neighbors[0], { direction: 'north', coordinates: '9,9,2', name: 'EXACT outside neighbor',
      indoor: false, complexId: null, connection: 'exterior-gateway', status: 'locked' });
    assert.equal(JSON.stringify(entries), before);
  }
  assert.deepEqual(buildRoomWorldContext({}, 'not coords').neighbors, []);
  assert.equal(buildRoomWorldContext({ '4,5,2': { name: 'Outdoor metaphor', indoor: 'false' } }, '4,5,2').indoor, null);
});

test('complex propagation through Map coordinate aliases preserves original keys, classifications and site identity', () => {
  const source = { indoor: true, complexId: 'exact-source-site', exits: { N: link('X: 9, Y: 9, Z: 2') } };
  const target = { classification: { indoor: true, biome: 'temple' }, name: 'Exact target' };
  const db = new Map([[' X: 4, Y: 5, Z: 2 ', source], ['9, 9, 2', target]]), classification = clone(target.classification);
  propagateComplexIdentity(db, '4,5,2');
  assert.equal(target.complexId, 'exact-source-site');
  assert.equal(db.size, 2);
  assert.equal(db.get('9, 9, 2'), target);
  assert.deepEqual(target.classification, classification);
  assert.equal(target.name, 'Exact target');
});

test('ambiguous and malformed links fail closed rather than classifying or assigning identity to geometric neighbors', () => {
  for (const exits of [{ N: link(null) }, { N: link('9,9,2'), north: link('8,8,2') }]) {
    const db = { '4,5,2': { indoor: true, exits }, '4,6,2': { indoor: true } };
    const world = buildRoomWorldContext(db, '4,5,2');
    assert.equal(world.neighbors[0].coordinates, null);
    assert.equal(world.neighbors[0].indoor, null);
    assert.equal(world.neighbors[0].status, 'closed');
    propagateComplexIdentity(db, '4,5,2');
    assert.equal(db['4,6,2'].complexId, undefined);
  }
  const db = { '4,5,2': { indoor: true }, ' X: 4, Y: 5, Z: 2 ': { indoor: false } }, before = JSON.stringify(db);
  assert.equal(buildRoomWorldContext(db, '4,5,2').indoor, null);
  propagateComplexIdentity(db, '4,5,2');
  assert.equal(JSON.stringify(db), before);
});

test('large/cyclic task snapshots stay bounded and preserve active-task affordances without exposing state', () => {
  const active = { type: 'Unlock', status: 'Pending', desc: 'D'.repeat(50000),
    requiredElements: Array.from({ length: 30 }, (_, i) => ({ type: 'key', name: `Key ${i}`, placement: '2,0,0' })),
    actionRequirements: [{ check: 'exit_open', coords: '2,0,0', direction: 'north' }] };
  active.cycle = active;
  const tasks = Array.from({ length: 20 }, () => ({ type: 'Fetch', desc: 'F'.repeat(50000) }));
  tasks[19] = active;
  const fixture = stateFor(tasks, 19, 'Q'.repeat(50000)), snapshot = snapshotQuestContext(fixture.state, consoleFor());
  assert.equal(snapshot.taskIndex, 19);
  assert.equal(snapshot.tasks[0].index, 19);
  assert.equal(snapshot.tasks[0].requiredElements.length, 8);
  assert.deepEqual(snapshot.tasks[0].actionRequirements, active.actionRequirements);
  assert.ok(snapshot.tasks.length <= 8);
  assert.ok(snapshot.currentQuest.length <= 1500);
  assert.ok(JSON.stringify(snapshot.tasks).length < 6500);
  snapshot.tasks[0].requiredElements[0].name = 'Changed copy';
  assert.equal(active.requiredElements[0].name, 'Key 0');
  assert.equal(active.cycle, active);
});

test('scene context tolerates malformed task members and detaches environment metadata from its database', () => {
  const tasks = [null, { type: 'Unlock', elements: [null], hardRequirements: [null],
    actionRequirements: [null, { check: 'exit_open', coords: 'X: 2, Y: 0, Z: 0', direction: 'north' }] }];
  const fixture = stateFor(tasks, 1), db = { '2,0,0': { indoor: false, environmentIntent: { template: 'wasteland', evidence: { source: 'model' } } } };
  const spec = attachSceneWorldContext(specAt({ x: 2, y: 0, z: 0 }), db, fixture.state, consoleFor());
  assert.equal(spec.source.questContext.constructionTasks.length, 1);
  spec.source.environmentIntent.evidence.source = 'Changed copy';
  spec.worldContext.environmentIntent.evidence.source = 'Changed other copy';
  assert.equal(db['2,0,0'].environmentIntent.evidence.source, 'model');
  assert.equal(tasks[1].actionRequirements[1].coords, 'X: 2, Y: 0, Z: 0');
});

test('supplementation merges console, option and pending gate protections for missing and known destinations', () => {
  for (const format of ['object', 'Map']) {
    const coords = { x: 2, y: 0, z: 0 };
    const source = { indoor: false, outdoorContinuation: 'north', exits: { N: link('X: 2, Y: 1, Z: 0') } };
    const entries = [['X: 2, Y: 0, Z: 0', source], ['99,99,2', { bossGate: { targetKey: '2,1,0', bossName: 'Bound Regent' } }]];
    const db = format === 'Map' ? new Map(entries) : Object.fromEntries(entries);
    for (const d of Object.keys(OFFSETS).filter(d => d !== 'north')) {
      const key = keyOf(step(coords, d)), room = { indoor: true, name: `Known ${d}`, classification: { indoor: true, biome: 'temple' } };
      if (db instanceof Map) db.set(key, room); else db[key] = room;
    }
    const before = JSON.stringify(db instanceof Map ? [...db] : db), text = consoleFor({ 'Boss Room Coordinates': 'X: 2, Y: 1, Z: 0' });
    const result = supplementOutdoorRoutes(db, '2,0,0', ['N'], text, { protectedKeys: new Set(['X: 2, Y: 1, Z: 0']) });
    assert.equal(result.report.added, false);
    assert.equal(result.updatedConsole, text);
    assert.equal(JSON.stringify(db instanceof Map ? [...db] : db), before);
  }
});

test('supplementation through a Map alias writes only the new destination and preserves all original records', () => {
  const source = { indoor: false, name: 'Exact source', classification: { indoor: false, biome: 'wasteland', size: 32 }, outdoorContinuation: 'north', exits: {} };
  const db = new Map([['X: 2, Y: 0, Z: 0', source]]), classification = clone(source.classification);
  const text = consoleFor({ 'Boss Room Coordinates': 'None' });
  const result = supplementOutdoorRoutes(db, '2,0,0', [], text);
  assert.equal(result.report.added, true);
  assert.equal(result.report.targetKey, '2,1,0');
  assert.equal(db.size, 2);
  assert.equal(db.get('X: 2, Y: 0, Z: 0'), source);
  assert.equal(db.has('2,0,0'), false);
  assert.deepEqual(source.classification, classification);
  assert.equal(source.name, 'Exact source');
  assert.equal(db.get('2,1,0').exits.south.targetCoordinates, '2,0,0');
});

test('sparse/malformed task compaction keeps original active indices through snapshots and world projections', async () => {
  const tasks = [null, { type: 'Unlock', desc: 'Active task', status: 'Pending',
    actionRequirements: [{ check: 'exit_open', coords: '5,5,2', direction: 'east' }] }];
  const fixture = stateFor(tasks, 1), snapshot = snapshotQuestContext(fixture.state);
  assert.equal(snapshot.tasks[0].index, 1);
  const world = buildRoomWorldContext({}, '4,5,2', { quest: snapshot });
  assert.equal(world.quest.tasks[0].index, 1);
  const plan = await chooseEnvironmentIntents(null, { coords: '4,5,2', directions: ['east'], tasks: world.quest.tasks, taskIndex: 1 });
  assert.equal(plan.protected.tasks[0].index, 1);
  assert.equal(plan.protected.tasks[0].desc, 'Active task');
});

test('direct world quest projection also caps task count and retains a late active task', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({ type: 'Fetch', desc: `Task ${index}` }));
  const quest = { currentQuest: 'Bound quest', taskIndex: 11, tasks };
  const world = buildRoomWorldContext({}, '4,5,2', { quest });
  assert.equal(world.quest.tasks.length, 8);
  assert.equal(world.quest.tasks[0].index, 11);
  assert.equal(world.quest.tasks[0].desc, 'Task 11');
  world.quest.tasks[0].desc = 'Changed copy';
  assert.equal(tasks[11].desc, 'Task 11');
});
