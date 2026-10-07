const fs = require('node:fs');
const path = require('node:path');
const { gzip } = require('node:zlib');

function summarizeDungeon(dungeon) {
  const counts = {};
  let floorMin = Infinity, floorMax = -Infinity, ceilMin = Infinity, ceilMax = -Infinity;
  const invalidHeights = [];
  let cellCount = 0;
  for (const [key, cell] of Object.entries(dungeon.cells || {})) {
    cellCount++;
    const tile = cell.tile || 'floor';
    counts[tile] = (counts[tile] || 0) + 1;
    const floor = Number.isFinite(cell.floorHeight) ? cell.floorHeight : 0;
    const ceil = Number.isFinite(cell.ceilHeight) ? cell.ceilHeight : floor + 2;
    floorMin = Math.min(floorMin, floor); floorMax = Math.max(floorMax, floor);
    ceilMin = Math.min(ceilMin, ceil); ceilMax = Math.max(ceilMax, ceil);
    if (ceil <= floor && invalidHeights.length < 20) invalidHeights.push({ key, tile, floor, ceil });
  }
  return {
    geoKey: dungeon.geoKey,
    geometryStamp: dungeon._geometryStamp || null,
    finalizedAt: dungeon._meta?.finalizedAt || null,
    layout: dungeon.layout,
    start: dungeon.start,
    classification: dungeon.classification,
    scene: dungeon.sceneSpec ? {
      biome: dungeon.sceneSpec.biome,
      indoor: dungeon.sceneSpec.indoor,
      walls: dungeon.sceneSpec.wallStyleMaterial,
      floor: dungeon.sceneSpec.floorStyleMaterial,
      lighting: dungeon.sceneSpec.lighting,
      requestedLandmarks: dungeon.sceneSpec.landmarks,
      proseCheck: dungeon.sceneCheck
    } : null,
    cellCount,
    counts,
    heights: cellCount ? { floorMin, floorMax, ceilMin, ceilMax } : null,
    invalidHeights
  };
}

function logDungeonConstruction(stage, dungeon) {
  console.info('[DungeonBuild]', JSON.stringify({ stage, ...summarizeDungeon(dungeon) }));
}

// Diagnostic artifacts are never loaded as room data by the game.
async function saveDungeonDiagnostic(dungeon, directory = path.join(__dirname, 'logs', 'dungeons')) {
  const filename = `${String(dungeon.geoKey || 'unknown').replace(/[^0-9a-z,-]/gi, '_')}-${process.pid}-${Date.now()}.json.gz`;
  const file = path.join(directory, filename);
  const data = JSON.stringify(dungeon, (key, value) =>
    key === '_lodCache' || key === '_minFloor' ? undefined : value);
  const summary = summarizeDungeon(dungeon);
  await fs.promises.mkdir(directory, { recursive: true });
  const compressed = await new Promise((resolve, reject) =>
    gzip(data, (error, result) => error ? reject(error) : resolve(result)));
  await fs.promises.writeFile(file, compressed);
  console.info('[DungeonSnapshot]', JSON.stringify({ ...summary, file }));
  return file;
}

module.exports = { summarizeDungeon, logDungeonConstruction, saveDungeonDiagnostic };
