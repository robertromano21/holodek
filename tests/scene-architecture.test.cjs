const assert = require('node:assert/strict');
const test = require('node:test');
const { applySceneArchitecture, chooseArchitecture } = require('../retort/sceneArchitecture');
const { checkSceneAgainstDungeon } = require('../retort/sceneSpec');
const { placeSceneLandmarks } = require('../retort/sceneRoomBuilder');

function room(width = 32, height = 32) {
  const dungeon = { layout: { width, height }, start: { x: Math.floor(width / 2), y: Math.floor(height * 0.75) }, cells: {}, customTiles: [] };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    dungeon.cells[`${x},${y}`] = { tile: x && y && x < width - 1 && y < height - 1 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 2.5 };
  }
  return dungeon;
}

function reachable(dungeon) {
  const seen = new Set(), queue = [dungeon.start];
  seen.add(`${dungeon.start.x},${dungeon.start.y}`);
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i], from = dungeon.cells[`${x},${y}`];
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const key = `${x + dx},${y + dy}`, to = dungeon.cells[key];
      if (seen.has(key) || !to || !['floor', 'door'].includes(to.tile) || Math.abs(to.floorHeight - from.floorHeight) > 1.5) continue;
      seen.add(key); queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

for (const [name, family] of [['Castle Gatehouse', 'castle'], ['Roman Bathhouse', 'bathhouse'], ['Ruined Temple Entrance', 'temple'], ['Forgotten Catacombs', 'catacomb'], ['Broken Ruins', 'ruins']]) {
  test(`${family} builds connected spaces and survives landmark placement and serialization`, () => {
    const dungeon = room();
    const spec = { source: { roomName: name }, textHash: 'fixed', landmarks: [{ type: 'pillar', count: 12 }] };
    const result = applySceneArchitecture(dungeon, spec);
    assert.equal(result.status, 'built', JSON.stringify(result));
    assert.equal(result.family, family);
    assert.ok(result.zones.length);
    const protectedCells = Object.entries(dungeon.cells).filter(([, c]) => c.navigationReserved).map(([key]) => key);
    placeSceneLandmarks(dungeon, spec);
    for (const key of protectedCells) assert.equal(dungeon.cells[key].tile, 'floor', key);
    const seen = reachable(dungeon);
    for (const anchor of result.anchors) assert.ok(seen.has(`${anchor.approach.x},${anchor.approach.y}`), anchor.role);
    for (const [key, cell] of Object.entries(dungeon.cells)) {
      if (cell.tile === 'floor') assert.ok(seen.has(key), key);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(dungeon)).cells, dungeon.cells);
    assert.equal(applySceneArchitecture(dungeon, spec), result, 'applying twice does not rebuild the room');
  });
}

test('outdoor architecture is bounded and preserves existing features', () => {
  const dungeon = room(512, 512);
  const door = { tile: 'door', floorHeight: 0, ceilHeight: 2.5, door: { isOpen: true }, exit: 'north' };
  const torch = { tile: 'torch', floorHeight: 0, ceilHeight: 2.5, feature: 'torch' };
  dungeon.cells['253,372'] = door;
  dungeon.cells['258,372'] = torch;
  const distant = dungeon.cells['30,30'];
  const result = applySceneArchitecture(dungeon, { source: { roomName: 'Ruined Temple' }, indoor: false });
  assert.equal(result.status, 'built', JSON.stringify(result));
  assert.ok(result.changedCells < 600);
  assert.equal(dungeon.cells['253,372'], door);
  assert.equal(dungeon.cells['258,372'], torch);
  assert.equal(dungeon.cells['30,30'], distant);
});

test('unsupported metaphors and disabled construction leave cells untouched', () => {
  assert.equal(chooseArchitecture({ indoor: false, architecture: 'temple', source: { roomName: 'Sunscorch Expanse', description: "A strange sanctum of regret, beyond Mortacia's distant temple." } }), null);
  const dungeon = room(), original = JSON.stringify(dungeon.cells);
  assert.equal(applySceneArchitecture(dungeon, { source: { roomName: 'Temple' } }, { enabled: false }).reason, 'disabled');
  assert.equal(JSON.stringify(dungeon.cells), original);
  assert.equal(applySceneArchitecture(room(12, 12), { source: { roomName: 'Catacombs' } }).status, 'skipped');
});

test('unsafe terrain rejects the complete patch without altering cells', () => {
  const dungeon = room();
  for (let x = 1; x < 31; x++) dungeon.cells[`${x},15`].floorHeight = 100;
  const original = JSON.stringify(dungeon.cells);
  const result = applySceneArchitecture(dungeon, { source: { roomName: 'Temple' } });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'would-disconnect-walkable-space');
  assert.equal(JSON.stringify(dungeon.cells), original);
});

test('prose checks inspect sceneObjects with legacy fallback and report absent items', () => {
  const spec = { props: [{ id: 'key-1', name: 'bronze key' }] };
  assert.equal(checkSceneAgainstDungeon(spec, { sceneObjects: [{ id: 'key-1', name: 'bronze key' }] }).ok, true);
  assert.equal(checkSceneAgainstDungeon(spec, { props: [{ id: 'key-1', name: 'bronze key' }] }).ok, true);
  assert.equal(checkSceneAgainstDungeon(spec, { sceneObjects: [] }).ok, false);
});

test('landmark placement chooses the exact rock face tile before a boulder sharing its sprite drawer', () => {
  for (const types of [['boulder', 'rock_face'], ['rock_face', 'boulder']]) {
    const d = room();
    d.customTiles = types.map(type => ({ type }));
    const result = placeSceneLandmarks(d, { indoor: false, textHash: 'rock-face-regression', landmarks: [
      { type: 'boulder', count: 3 }, { type: 'rock_face', count: 2 }
    ] });
    assert.deepEqual(result.missing, []);
    for (const lm of result.placed) assert.equal(lm.tile, `custom_${lm.type}_${types.indexOf(lm.type)}`);
    assert.equal(result.placed.filter(lm => lm.type === 'boulder').length, 3);
    assert.equal(result.placed.filter(lm => lm.type === 'rock_face').length, 2);
  }
  const d = room();
  d.customTiles = [{ type: 'boulder' }];
  const result = placeSceneLandmarks(d, { landmarks: [{ type: 'rock_face', count: 1 }], textHash: 'missing-rock-face' });
  assert.equal(result.placed.length, 0, 'Do not downgrade a missing canonical voxel to another shape');
  assert.deepEqual(result.missing, ['rock_face']);
});
