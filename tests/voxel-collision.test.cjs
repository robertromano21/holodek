const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Collision = require('../assets/voxelCollision');

function fixture(shape, width = 1, height = 3.5) {
  const d = { tiles: { custom_test: { spriteSpec: { voxelShape: shape, baseWidth: width, heightRatio: 1, collisionRadius: 0.05 } } }, cells: {} };
  for (let y = -1; y < 3; y++) for (let x = -1; x < 3; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3.5 };
  d.cells['0,0'] = { tile: 'custom_test', floorHeight: 0, ceilHeight: height, structureHeight: height };
  return d;
}

test('arches have a traversable central opening but solid posts, including the real game collision path', () => {
  const d = fixture('arch');
  for (const y of [-0.2, 0, 0.25, 0.5, 0.75, 1, 1.2]) assert.equal(Collision.testCell(d, 0, 0, 0.5, y).blocked, false);
  assert.equal(Collision.testCell(d, 0, 0, 0.1, 0.5).blocked, true);
  assert.equal(Collision.testCell(d, 0, 0, 0.9, 0.5).blocked, true);
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const start = source.indexOf('function isObstacleAtPos('), end = source.indexOf('function getVisibleSceneObjects()', start);
  assert.ok(start >= 0 && end > start, 'Real collision function boundaries must remain available');
  const detailStart = source.indexOf('function getObstacleAtPosDetail('), detailEnd = source.indexOf('\nfunction ', detailStart + 1);
  const context = { window: { VoxelCollision: Collision }, currentDungeon: d, PLAYER_RADIUS: 0.2, PLAYER_EYE_HEIGHT: 0.65, MAX_STEP: 1.5,
    getDungeonSurfaceAt: (x, y) => Collision.surfaceAt(d, x, y),
    isObstacleTile: tile => tile.startsWith('custom_'), getObstacleRadiusForTile: () => 0.05 };
  vm.runInNewContext(source.slice(start, end) + source.slice(detailStart, detailEnd), context);
  assert.equal(context.isObstacleAtPos(0.5, 0.5), false);
  assert.equal(context.getObstacleAtPosDetail(0.5, 0.5), null);
  assert.equal(context.isObstacleAtPos(0.1, 0.5), true);
  assert.equal(context.getObstacleAtPosDetail(0.1, 0.5).mode, 'voxel-cross-section');
});

test('wide props cannot be walked through just because their legacy radius was tiny', () => {
  for (const shape of ['altar', 'tomb', 'sarcophagus', 'palisade', 'timber_gate']) {
    const d = fixture(shape);
    assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5).blocked, true, shape);
    assert.equal(Collision.testCell(d, 0, 0, 1.4, 1.4).blocked, false, shape);
  }
});

test('new columns and timber posts preserve real gaps instead of blocking whole capitals', () => {
  for (const shape of ['doric_column', 'ionic_column', 'corinthian_column', 'timber_post']) {
    const d = fixture(shape, 0.85);
    d.cells['1,0'] = { ...d.cells['0,0'] };
    assert.equal(Collision.testCell(d, 0, 0, 1, 0.5).blocked, false, shape);
    assert.equal(Collision.testCell(d, 1, 0, 1, 0.5).blocked, false, shape);
    assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5).blocked, true, shape);
  }
});

test('Doric column at the reported 9,12 gap uses forgiving legacy pillar clearance', () => {
  const d = fixture('doric_column', 0.85, 4.1);
  d.cells['9,12'] = d.cells['0,0'];
  d.cells['9,13'] = { tile: 'floor', floorHeight: 0, ceilHeight: 3.5 };
  const result = Collision.testCell(d, 9, 12, 9.1, 12.6);
  assert.equal(result.blocked, false);
  assert.equal(result.mode, 'column-clearance');
  assert.equal(Collision.testCell(d, 9, 12, 9.5, 12.5).blocked, true);
  const broad = fixture('doric_column', 2, 8);
  assert.equal(Collision.testCell(broad, 0, 0, 1.1, 0.5).blocked, true, 'Do not enter a broad shaft');
});

test('plinth footing follows the real voxel base, including neighboring tiles, without raising the room grid', () => {
  for (const shape of ['doric_column', 'ionic_column', 'corinthian_column', 'fluted_column']) {
    const d = fixture(shape, 0.85, 4.1), original = JSON.stringify(d);
    const foot = Collision.surfaceAt(d, 0.1, 0.6);
    assert.equal(foot.kind, 'column-plinth', shape);
    assert.ok(foot.height > 0 && foot.height < 1.5, shape);
    assert.equal(Collision.testCell(d, 0, 0, 0.1, 0.6).blocked, false, shape);
    assert.equal(Collision.surfaceAt(d, -0.4, 0.6).height, 0);
    assert.equal(JSON.stringify(d), original);
  }
  const broad = fixture('doric_column', 2, 4.1);
  assert.ok(Collision.surfaceAt(broad, -0.4, 0.5).height > 0, 'Plinth can project into a neighboring tile');
  broad.tiles.custom_test.spriteSpec.collisionBlocking = false;
  assert.equal(Collision.surfaceAt(broad, -0.4, 0.5).height, 0);
  const ordinary = fixture('altar');
  assert.equal(Collision.surfaceAt(ordinary, 0.1, 0.6).height, 0, 'Do not auto-climb arbitrary props');
});

test('real movement steps onto low plinths, changes eye height, and rejects oversized bases', () => {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const functions = ['getDungeonCellFloorHeight', 'getDungeonSurfaceAt', 'canOccupyPos', 'getOccupancyBlockReason', 'updatePlayerHeightFromCell']
    .map(name => {
      const start = source.indexOf(`function ${name}(`), end = source.indexOf('\nfunction ', start + 1);
      return source.slice(start, end);
    }).join('\n');
  const d = fixture('doric_column', 0.85, 4.1);
  const context = { window: { VoxelCollision: Collision }, currentDungeon: d,
    PLAYER_RADIUS: 0.2, PLAYER_EYE_HEIGHT: 0.65, MAX_STEP: 1.5,
    playerPosX: -0.4, playerPosY: 0.6, playerDungeonX: -1, playerDungeonY: 0,
    playerZ: 0.65, playerZTarget: 0.65, playerZInitialized: true,
    canEnterTile: () => true, isObstacleAtPos: (x, y) => Collision.testCell(d, 0, 0, x, y).blocked,
    getObstacleAtPosDetail: () => null };
  vm.runInNewContext(functions, context);
  assert.equal(context.canOccupyPos(0.1, 0.6), true);
  context.playerPosX = 0.1;
  context.updatePlayerHeightFromCell();
  assert.equal(context.playerZTarget, Collision.surfaceAt(d, 0.1, 0.6).height + 0.65);
  assert.equal(context.canOccupyPos(-0.4, 0.6), true, 'Can step back down');
  context.playerPosX = -0.4;
  d.cells['0,0'].structureHeight = 24;
  assert.equal(context.canOccupyPos(0.1, 0.6), false);
  assert.equal(context.getOccupancyBlockReason(0.1, 0.6).reason, 'plinth step too steep');
});

test('overhead voxel height, body elevation, nonblocking props and legacy fallback are respected', () => {
  const d = fixture('arch', 1, 0.8);
  assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5).blocked, true, 'A low arch does not have head clearance');
  d.tiles.custom_test.spriteSpec.collisionBlocking = false;
  assert.equal(Collision.testCell(d, 0, 0, 0.1, 0.5).blocked, false);
  delete d.tiles.custom_test.spriteSpec.collisionBlocking;
  d.cells['0,0'].tile = 'pillar'; d.tiles.pillar = d.tiles.custom_test;
  assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5), null);
  d.cells['0,0'].tile = 'custom_test'; d.tiles.custom_test.spriteSpec.voxelShape = 'not-a-shape';
  assert.equal(Collision.testCell(d, 0, 0, 0.5, 0.5), null);
});

test('voxel near-plane projection preserves signed depth and never teleports vertices to a screen corner', () => {
  const source = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
  const start = source.indexOf('const voxelVs = '), end = source.indexOf('const voxelFs', start);
  const shader = source.slice(start, end);
  assert.doesNotMatch(shader, /vec4\(2\.0, 2\.0, 2\.0, 1\.0\)/);
  assert.match(shader, /gl_Position = vec4\(transformX, clipY, transformY - 2\.0 \* nearPlane, transformY\)/);
  for (const depth of [-1, 0, 0.01, 0.02, 0.1, 10]) {
    const z = depth - 0.04, w = depth;
    assert.equal(z + w >= -1e-12, depth >= 0.02);
    assert.ok(Number.isFinite(z) && Number.isFinite(w));
  }
});

test('collision shape data loads before game.js and is also available in the isolated lab', () => {
  const main = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.ok(main.indexOf('/assets/scenePropVoxels.js') < main.indexOf('/assets/voxelCollision.js'));
  assert.ok(main.indexOf('/assets/voxelCollision.js') < main.indexOf('/assets/game.js'));
  assert.match(fs.readFileSync(require.resolve('../assets/environment-lab.html'), 'utf8'), /assets\/voxelCollision\.js/);
});
