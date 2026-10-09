const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const DungeonExits = require('../assets/dungeonExits');
const { prepareDoorAction, applyDoorAction, doorIntent } = require('../retort/dungeonActions');

const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {} };
function harness() {
  const calls = { roofs: 0, exits: 0, diagnostics: [], stages: [] };
  const context = {
    console: quiet, JSON,
    applySceneRoofs(dungeon, spec) { calls.roofs++; return applySceneRoofs(dungeon, spec); },
    DungeonExits: { install(dungeon) { calls.exits++; return DungeonExits.install(dungeon); } },
    buildEnvironment: () => ({ version: 1 }),
    sharedState: { getDungeonRunId: () => 'test-run' },
    logDungeonConstruction: (stage, dungeon) => calls.stages.push({ stage, dungeon }),
    saveDungeonDiagnostic: dungeon => { calls.diagnostics.push(dungeon); return Promise.resolve(); }
  };
  const begin = source.indexOf('function computeDungeonGeometryStamp(');
  const end = source.indexOf('// Helper to attach a generated sprite', begin);
  assert.ok(begin >= 0 && end > begin);
  vm.runInNewContext(source.slice(begin, end), context);
  return { context, calls, finalize: dungeon => context.finalizeRoomDungeon('0,0,0', dungeon, dungeon.customTiles) };
}

function room() {
  const dungeon = { layout: { width: 32, height: 32 }, start: { x: 16, y: 26 }, cells: {},
    tiles: {}, customTiles: [], classification: { indoor: true },
    sceneSpec: { indoor: true, source: { roomName: 'Hall', description: 'A barrel-vaulted indoor hall.' }, exits: ['north'] } };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    dungeon.cells[`${x},${y}`] = { tile: x && y && x < 31 && y < 31 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3 };
  }
  dungeon.cells['16,25'] = { tile: 'door', floorHeight: 0, ceilHeight: 3, door: { isOpen: false } };
  return dungeon;
}

function cachedRoom(version) {
  const dungeon = room();
  if (version !== undefined) dungeon.sceneRoof = { version, status: 'built', style: 'stone' };
  dungeon.cells['10,10'].roof = { version: version ?? 1, style: 'stone', height: 5, slopeX: 0, slopeY: 0 };
  dungeon.sceneStructures = [{ tile: 'legacy-roof', shape: 'coffered_slab',
    position: { x: 2, y: 2, z: 5 }, size: { x: 10, y: 10, z: 0.2 } }];
  dungeon._geometryStamp = 'cached-geometry';
  dungeon._meta = { geometryStamp: dungeon._geometryStamp, finalizedAt: 1, runId: 'test-run' };
  return dungeon;
}

for (const version of [undefined, 0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`cached roof version ${version ?? 'absent'} stays unchanged through a real door patch and finalization`, () => {
    const { context, calls, finalize } = harness();
    const dungeon = cachedRoom(version), before = structuredClone(dungeon);
    const next = applyDoorAction(dungeon, { allowed: true, key: '16,25', kind: 'open', check: false }, true);
    const finalized = finalize(next);
    assert.equal(calls.roofs, 0);
    assert.equal(calls.exits, 0);
    assert.deepEqual(dungeon, before, 'Finalization must not mutate shared cell objects in the original snapshot');
    assert.deepEqual(finalized.cells, { ...before.cells, '16,25': next.cells['16,25'] });
    assert.deepEqual(finalized.sceneStructures, before.sceneStructures);
    assert.deepEqual(finalized.sceneRoof, before.sceneRoof);
    assert.equal(finalized._geometryStamp, context.computeDungeonGeometryStamp(finalized, '0,0,0'));
    assert.notEqual(finalized._geometryStamp, before._geometryStamp);
    assert.equal(calls.diagnostics.length, 1);
    assert.equal(calls.diagnostics[0], finalized);
    assert.equal(calls.stages[0].stage, 'finalized');
    assert.equal(finalized._meta.runId, 'test-run');
  });
}

test('legacy cache metadata alone protects roofs and marker geometry when the top-level stamp is absent', () => {
  for (const metadata of [{ geometryStamp: 'old-stamp' }, { finalizedAt: 1 }]) {
    const { calls, finalize } = harness();
    const dungeon = cachedRoom(1);
    delete dungeon._geometryStamp;
    dungeon._meta = metadata;
    const before = structuredClone(dungeon);
    const finalized = finalize(dungeon);
    assert.equal(calls.roofs, 0);
    assert.equal(calls.exits, 0);
    assert.deepEqual(finalized.cells, before.cells);
    assert.deepEqual(finalized.sceneStructures, before.sceneStructures);
  }
});

test('existing roof reports at any version are not rebuilt even without finalization metadata', () => {
  for (const version of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const { calls, finalize } = harness();
    const dungeon = cachedRoom(version);
    delete dungeon._geometryStamp;
    delete dungeon._meta;
    dungeon.roomExits = { version: 1, markers: [], status: 'built' };
    const before = structuredClone(dungeon);
    const finalized = finalize(dungeon);
    assert.equal(calls.roofs, 0);
    assert.equal(calls.exits, 0);
    assert.deepEqual(finalized.cells, before.cells);
    assert.deepEqual(finalized.sceneRoof, before.sceneRoof);
    assert.deepEqual(finalized.sceneStructures, before.sceneStructures);
  }
});

test('fresh construction still builds real roofs and exits once, computes a stamp, and retains diagnostics', () => {
  const { calls, finalize } = harness();
  const dungeon = room();
  const finalized = finalize(dungeon);
  assert.equal(calls.roofs, 1);
  assert.equal(calls.exits, 1);
  assert.equal(finalized.sceneRoof.status, 'built');
  assert.ok(Object.values(finalized.cells).some(cell => cell.roof));
  assert.ok(finalized.sceneStructures.some(part => part.role === 'roof-shell'));
  assert.ok(finalized.roomExits.markers.some(marker => marker.direction === 'north'));
  assert.equal(finalized.cells['16,26'].tile, 'floor');
  assert.equal(finalized.cells['16,26'].floorHeight, 0);
  assert.ok(finalized._geometryStamp);
  const before = structuredClone(finalized), again = finalize(finalized);
  assert.equal(calls.roofs, 1);
  assert.equal(calls.exits, 1);
  assert.deepEqual(again.cells, before.cells);
  assert.deepEqual(again.sceneStructures, before.sceneStructures);
  assert.equal(calls.diagnostics.length, 2);
});

test('the production door handler broadcasts a complete geometry delta without rebuilding an old saved roof', async () => {
  const { context, calls } = harness();
  let stored = cachedRoom(5);
  const before = structuredClone(stored), deltas = [];
  Object.assign(context.sharedState, {
    getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => structuredClone(stored),
    getCombatCharactersString: () => JSON.stringify([{ name: 'Mortacia', type: 'pc', mazeX: 16, mazeY: 26, mazeRoomKey: '0,0,0' }]),
    setRoomDungeon: (_, dungeon) => { stored = dungeon; }
  });
  Object.assign(context, { doorIntent, prepareDoorAction, applyDoorAction, updatedGameConsole: 'Inventory: Empty',
    broadcast: delta => deltas.push(delta),
    actionDice: { begin() {}, end() {}, roll() { throw new Error('Opening an ordinary door must not roll.'); } }
  });
  const begin = source.indexOf('async function tryDungeonDoorAction(');
  const end = source.indexOf('let combatSpace = null;', begin);
  vm.runInNewContext(source.slice(begin, end), context);
  const result = await context.tryDungeonDoorAction('open door');
  assert.equal(result.actionOnly, true);
  assert.match(result.content, /The door opens/);
  assert.equal(calls.roofs, 0);
  assert.equal(calls.exits, 0);
  assert.equal(deltas.length, 1);
  assert.deepEqual(Object.keys(deltas[0].cells), ['16,25']);
  assert.deepEqual(stored.cells, { ...before.cells, ...deltas[0].cells });
  assert.deepEqual(stored.sceneStructures, before.sceneStructures);
  assert.deepEqual(stored.sceneRoof, before.sceneRoof);
  assert.equal(deltas[0].previousStamp, before._geometryStamp);
  assert.equal(deltas[0].geometryStamp, stored._geometryStamp);
  assert.equal(calls.diagnostics.length, 1);
});
