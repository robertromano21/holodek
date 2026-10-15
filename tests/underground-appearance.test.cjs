'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCanvas } = require('canvas');
const { drawSceneSurface, UNDERGROUND_PROFILES } = require('../assets/renderSceneTextures');
const Env = require('../retort/environmentIntents');
const U = require('../retort/undergroundEnvironments');
const { buildSceneSpec } = require('../retort/sceneSpec');
const { deriveLevelSpecFromText, applyLevelSpecToScene } = require('../retort/levelSpec');
const { prepareSceneBiomeProps: prepare, applySceneBiomeProps: apply } = require('../retort/sceneBiomeProps');
const { applySceneRoofs } = require('../retort/sceneRoofs');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const V = require('../assets/scenePropVoxels');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-underground-art-'));
process.env.HOLODEK_SPRITE_DIR = directory;
const { applySceneGraphics } = require('../retort/sceneRoomBuilder');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function spec(kind) {
  const entry = Env.CATALOG[kind];
  const s = buildSceneSpec({ roomName: kind.replace(/_/g, ' '), description: entry.physicalDescription,
    indoorHint: true });
  applyLevelSpecToScene(s, deriveLevelSpecFromText(s.source));
  s.source.environmentIntent = { template: kind };
  s.generation = { seed: 'underground-art' };
  prepare(s);
  return s;
}
function room() {
  const d = { layout: { width: 64, height: 64 }, start: { x: 32, y: 48 }, cells: {}, tiles: {},
    customTiles: [], generation: { seed: 'underground-art' }, classification: { indoor: true } };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < 63 && y < 63 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 5
  };
  return d;
}

test('underground floor/wall designs are opaque, deterministic and distinct even with the same material', () => {
  for (const kind of ['floor', 'wall']) {
    const patterns = new Set();
    for (const profile of UNDERGROUND_PROFILES) {
      const render = seed => {
        const canvas = createCanvas(64, 64);
        drawSceneSurface(canvas.getContext('2d'), createCanvas, kind, { material: 'stone', undergroundProfile: profile, seed });
        return canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
      };
      const a = render('a');
      assert.deepEqual(a, render('a'));
      assert.notEqual(digest(a), digest(render('b')), profile);
      for (let i = 3; i < a.length; i += 4) assert.equal(a[i], 255);
      assert.ok(!patterns.has(digest(a)), profile);
      patterns.add(digest(a));
    }
  }
});

for (const profile of UNDERGROUND_PROFILES) test(`${profile}: production graphics select matching surfaces and safe covered voxel clusters`, () => {
  const s = spec(profile), d = room();
  const lights = structuredClone(s.lighting);
  assert.equal(U.appearanceKind(s), profile);
  assert.equal(s.biomePropsPlan.enabled, true);
  assert.deepEqual(s.biomePropsPlan.profiles, [profile]);
  assert.ok(s.biomePropsPlan.shapes.length);
  for (const shape of s.biomePropsPlan.shapes) assert.ok(V.biomeProps[shape].biomes.includes(profile));
  applySceneRoofs(d, s);
  d.cells['15,15'].interactable = { id: 'quest-console' };
  d.cells['45,45'].navigationReserved = true;
  d.sceneObjects = [{ name: 'quest relic', x: 25, y: 25 }];
  const original = structuredClone(d.cells), structures = structuredClone(d.sceneStructures);
  const before = reachable(makeNavigation(d), d.start);
  const report = applySceneGraphics(d, s, { geoKey: 'test-underground', customTiles: d.customTiles });
  for (const tile of ['floor', 'wall']) assert.equal(report.textures.find(t => t.tile === tile)?.undergroundProfile, profile);
  if (profile === 'lava_tube') {
    const floor = report.textures.find(t => t.tile === 'floor');
    assert.equal(floor.material, 'obsidian');
    assert.ok(!floor.cover.includes('lava'));
  }
  const placed = apply(d, s);
  assert.equal(placed.status, 'built', JSON.stringify(placed));
  assert.ok(placed.placed > 0 && placed.placed <= 16);
  assert.equal(reachable(makeNavigation(d), d.start).count, before.count - placed.placed);
  for (const [key, c] of Object.entries(d.cells)) {
    assert.deepEqual(c.roof, original[key].roof);
    assert.equal(c.floorHeight, original[key].floorHeight);
    if (!c.biomePropRole) continue;
    const [x, y] = key.split(',').map(Number);
    for (const [px, py] of [[15, 15], [45, 45], [25, 25]]) assert.ok(Math.abs(x - px) > 2 || Math.abs(y - py) > 2);
    assert.ok(V.biomeProps[c.biomePropRole].biomes.includes(profile));
    assert.ok(c.structureHeight + .15 < Math.min(c.ceilHeight, c.roof?.height ?? Infinity) - c.floorHeight);
  }
  assert.deepEqual(d.sceneStructures, structures);
  assert.deepEqual(s.lighting, lights);
  const saved = structuredClone(d); saved.sceneSpec = s;
  const snapshot = JSON.stringify(saved);
  apply(saved, s);
  assert.equal(JSON.stringify(saved), snapshot);
});

test('underground appearance remains context-bound and preserves non-underground textures and vegetation exclusions', () => {
  assert.equal(U.appearanceKind({ indoor: false, biome: 'cave', architecture: 'cave' }), null);
  assert.equal(U.appearanceKind({ indoor: true, architecture: 'temple' }), null);
  const s = spec('fungal_cavern');
  s.source.description += ' No mushrooms.';
  prepare(s);
  assert.ok(!s.biomePropsPlan.shapes.includes('cave_mushrooms'));
  assert.ok(s.biomePropsPlan.shapes.includes('flowstone_cascade'));
  const render = undergroundProfile => {
    const c = createCanvas(32, 32);
    drawSceneSurface(c.getContext('2d'), createCanvas, 'wall', { material: 'stone', undergroundProfile, seed: 'old-room' });
    return c.toBuffer();
  };
  assert.deepEqual(render(null), render('not-a-profile'));
});

test('optional surface contact sheet uses the same production painters', () => {
  if (!process.env.HOLODEK_UNDERGROUND_PREVIEW) return;
  const canvas = createCanvas(1024, 352), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181a1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  UNDERGROUND_PROFILES.forEach((profile, i) => {
    const x = i % 4 * 256, y = Math.floor(i / 4) * 176;
    ctx.fillStyle = '#ebe4cf'; ctx.font = '15px Georgia'; ctx.fillText(profile.replace(/_/g, ' '), x + 8, y + 22);
    for (const [j, kind] of ['floor', 'wall'].entries()) {
      const tile = createCanvas(112, 112);
      const material = profile === 'ice_cave' ? 'ice' : profile === 'lava_tube' ? 'obsidian' : 'stone';
      drawSceneSurface(tile.getContext('2d'), createCanvas, kind, { material, undergroundProfile: profile, seed: 'preview' });
      ctx.drawImage(tile, x + 8 + j * 120, y + 32);
      ctx.fillText(kind, x + 8 + j * 120, y + 162);
    }
  });
  fs.writeFileSync(path.join(directory, 'underground-surfaces.png'), canvas.toBuffer());
  console.log('Underground surface preview: ' + path.join(directory, 'underground-surfaces.png'));
});
