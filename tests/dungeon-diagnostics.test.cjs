const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { summarizeDungeon, saveDungeonDiagnostic } = require('../dungeonDiagnostics');

test('final snapshots preserve exact cells and scene specs independently of later mutation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-dungeon-test-'));
  const dungeon = {
    geoKey: '0,0,1', layout: { width: 3, height: 4 },
    sceneSpec: { biome: 'temple', landmarks: [{ type: 'pillar', count: 3 }] },
    cells: {
      '1,0': { tile: 'torch', floorHeight: 0, ceilHeight: 2.5 },
      '1,1': { tile: 'floor', floorHeight: -0.5, ceilHeight: 2 },
      '1,2': { tile: 'wall', floorHeight: 1, ceilHeight: 0.5 }
    },
    _lodCache: { temporary: true }
  };
  let file;
  try {
    const pending = saveDungeonDiagnostic(dungeon, directory);
    dungeon.cells['1,0'].tile = 'floor';
    file = await pending;
    const snapshot = JSON.parse(gunzipSync(fs.readFileSync(file)));
    assert.equal(snapshot.cells['1,0'].tile, 'torch');
    assert.deepEqual(snapshot.sceneSpec, dungeon.sceneSpec);
    assert.equal(snapshot._lodCache, undefined);
    const summary = summarizeDungeon(snapshot);
    assert.equal(summary.counts.torch, 1);
    assert.equal(summary.heights.floorMin, -0.5);
    assert.equal(summary.invalidHeights[0].key, '1,2');
  } finally {
    if (file) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
