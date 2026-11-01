'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createCanvas } = require('canvas');
const api = require('../assets/dungeonPerformance'), Quest = require('../assets/questMap');
const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
const questSource = fs.readFileSync(require.resolve('../assets/questMap'), 'utf8');
const rendererSource = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');
function extract(start, end) { const a = game.indexOf(start); assert.ok(a >= 0); const b = game.indexOf(end, a); assert.ok(b > a); return game.slice(a, b).trim(); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function city(size = 25) {
  const dungeon = { geoKey: '0,0,30', _geometryStamp: 'a', cityBlocks: {}, layout: { width: size, height: size }, start: { x: 12, y: 12 }, cells: {}, tiles: {} };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  return dungeon;
}
function searches() {
  const root = { isBlockedDungeonCell: cell => !cell || cell.blocked || cell.obstacle || ['wall', 'torch'].includes(cell.tile) || cell.tile === 'door' && !cell.door?.isOpen,
    isObstacleTile: tile => tile === 'pillar' || tile?.startsWith('custom_') };
  root.window = root; root.DungeonPerformance = api.create(root);
  vm.createContext(root);
  vm.runInContext('const MAX_STEP = 1.5;\n' + extract('function isSpawnBlockedCell(cell) {', 'function canEnterTile(') + '\n' +
    extract('function findNearestUnblockedTile(dungeon, start, maxRadius = 25) {', 'function canOccupyPos(') + '\n' +
    extract('function collectNearbyWalkableTiles(dungeon, origin, maxRadius = 18) {', '// Combat rounds drive positions from the server'), root);
  vm.runInContext(questSource, root);
  return root;
}
function scan(dungeon, x, y, radius) {
  const result = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
    const wx = x + dx, wy = y + dy, cell = dungeon.cells[`${wx},${wy}`], tile = cell?.tile;
    if (tile === 'torch' || tile === 'pillar' || tile?.startsWith('custom_') || dungeon.tiles[tile]?.spriteSpec) result.push([wx, wy, cell]);
  }
  return result;
}
test('native sparse collection preserves candidates, the full 64-tile radius and stable light tie order', () => {
  const d = city(150), counts = {}, cache = api.spatialIndex(key => counts[key] = (counts[key] || 0) + 1);
  Object.assign(d.cells['0,0'], { tile: 'torch' }); Object.assign(d.cells['128,128'], { tile: 'custom_tree' });
  Object.assign(d.cells['128,0'], { tile: 'pillar' }); Object.assign(d.cells['0,128'], { tile: 'special' }); d.tiles.special = { spriteSpec: {} };
  Object.assign(d.cells['129,64'], { tile: 'custom_outside' });
  assert.deepEqual(cache.query(d, 64, 64, 64), scan(d, 64, 64, 64));
  assert.equal(cache.query(d, 64, 64, 64).length, 4); assert.equal(counts.collectionBuilds, 1); assert.equal(counts.collectionHits, 1);
  cache.query(d, 65, 64, 64); assert.equal(counts.collectionBuilds, 1);
  d._geometryStamp = 'b'; cache.query(d, 64, 64, 64); assert.equal(counts.collectionBuilds, 2);
  d.cells = { ...d.cells }; cache.query(d, 64, 64, 64); assert.equal(counts.collectionBuilds, 3);
  d.tiles.floor = { spriteSpec: {} }; assert.deepEqual(cache.query(d, 64, 64, 64), scan(d, 64, 64, 64)); assert.equal(counts.collectionBuilds, 4);
  delete d._geometryStamp; assert.equal(cache.query(d, 64, 64, 64), null);
});
test('native collection query windows stay bounded and never become serialized dungeon data', () => {
  const d = city(), counts = {}, cache = api.spatialIndex(key => counts[key] = (counts[key] || 0) + 1), before = JSON.stringify(d);
  for (let x = 0; x < 40; x++) cache.query(d, x, 0, 64);
  cache.query(d, 0, 0, 64); assert.equal(counts.collectionQueries, 41); assert.equal(JSON.stringify(d), before);
});
test('the real renderer collection helper uses the native index and retains an unstamped legacy path', () => {
  const a = rendererSource.indexOf('function* nearbyRenderableCells('), b = rendererSource.indexOf('  function formatShaderSource(', a);
  const root = { window: { DungeonPerformance: api.create({}) } }; vm.createContext(root); vm.runInContext(rendererSource.slice(a, b), root);
  const d = city(); d.cells['5,7'].tile = 'torch';
  assert.deepEqual(plain([...root.nearbyRenderableCells(d, 4, 4, 4)]), scan(d, 4, 4, 4));
  delete d._geometryStamp; assert.equal([...root.nearbyRenderableCells(d, 4, 4, 4)].length, 81);
});
test('native quest candidates retain every seeded position, landmark choice and fresh return value', () => {
  const root = searches(), d = city(), before = JSON.stringify(d);
  for (let i = 0; i < 120; i++) assert.deepEqual(plain(root.QuestMap.localPoint(d, `seed:${i}`, '')), Quest.localPoint(d, `seed:${i}`, ''));
  const landmarks = [{ id: 'rotunda', x: 4.8, y: 7.1, label: 'Marble rotunda', kind: 'rotunda' }];
  assert.deepEqual(plain(root.QuestMap.localPoint(d, 'another', 'rotunda', landmarks)), Quest.localPoint(d, 'another', 'rotunda', landmarks));
  root.QuestMap.localPoint(d, 'seed:0', '').x = -900;
  assert.deepEqual(plain(root.QuestMap.localPoint(d, 'seed:0', '')), Quest.localPoint(d, 'seed:0', ''));
  const counts = root.DungeonPerformance.diagnostics().counts; assert.equal(counts.questFloorBuilds, 1); assert.equal(counts.questFloorHits, 121);
  assert.equal(JSON.stringify(d), before);
});
test('native quest candidates read 65,025 large-city cells once instead of once per objective per frame', () => {
  const root = searches(), d = city(512), cells = d.cells; let reads = 0;
  d.cells = new Proxy(cells, { get(target, key) { reads++; return target[key]; } });
  root.QuestMap.localPoint(d, 'large', ''); assert.equal(reads, 65025);
  for (let i = 0; i < 60; i++) root.QuestMap.localPoint(d, 'large:' + i, ''); assert.equal(reads, 65025);
});
test('native quest candidates invalidate for geometry, exits, floor context, dimensions and start', () => {
  const root = searches(), d = city(), p = root.DungeonPerformance;
  const compare = () => assert.deepEqual(plain(root.QuestMap.localPoint(d, 'same', '')), Quest.localPoint(d, 'same', ''));
  compare();
  for (const change of [() => { d.cells['1,1'].tile = 'wall'; d._geometryStamp = 'b'; }, () => { d.cells = { ...d.cells }; },
    () => { d.layout.width = 23; }, () => { d.start.x = 4; },
    () => { d.roomExits = { markers: [{ direction: 'north', x: 7, y: 1, key: '7,1' }] }; d.cells['7,1'].exitMarker = true; },
    () => { d.cityFloorContext = { buildingId: 'inn', level: 1 }; }]) {
    const n = p.diagnostics().counts.questFloorBuilds; change(); compare(); compare(); assert.equal(p.diagnostics().counts.questFloorBuilds, n + 1);
  }
  delete d._geometryStamp; const n = p.diagnostics().counts.questFloorBuilds; compare(); compare(); assert.equal(p.diagnostics().counts.questFloorBuilds, n + 2);
});
test('native quest markers and reveals follow live mission changes and do not cache authored content', () => {
  const root = searches(), d = city(), mission = { id: 'm1', status: 'active', objective: { roomKey: d.geoKey, local: true, name: 'An authored name', step: 'An authored step', spot: 'dome' } };
  d.roomExits = { markers: [{ direction: 'north', x: 12, y: 1 }] };
  const room = { minorMissions: { m1: mission }, mapReveals: { m1: { revealed: true, items: [{ kind: 'objective', label: 'dome' }, { kind: 'route', towardKey: '0,1,30' }] } } }, db = { [d.geoKey]: room }, options = { landmarks: [] };
  const compare = () => {
    assert.deepEqual(plain(root.QuestMap.mapMarkers(d, db, options)), plain(Quest.mapMarkers(d, db, options)));
    assert.deepEqual(plain(root.QuestMap.revealCells(d, room, options)), plain(Quest.revealCells(d, room, options)));
  };
  compare(); mission.objective.step = 'A changed step'; compare();
  options.landmarks.push({ id: 'new', kind: 'dome', x: 8, y: 8 }); compare();
  assert.equal(root.QuestMap.mapMarkers(d, db, options).markers[0].landmarkId, 'new');
  mission.status = 'completed'; compare(); assert.equal(root.QuestMap.mapMarkers(d, db, options).markers.length, 0);
  room.minorMissions.m2 = { ...mission, id: 'm2', status: 'active' }; compare();
  options.flags = { QUEST_LOCAL: false, QUEST_REVEALS: false }; compare();
});
test('native party cache preserves BFS order and handles unstamped door, blocker, height and missing-cell changes', () => {
  const root = searches(), d = city(), origin = { x: 12, y: 12 }, run = () => root.collectNearbyWalkableTiles(d, origin, 4);
  const compare = () => assert.deepEqual(plain(run()), plain(root.collectNearbyWalkableTilesUncached(d, origin, 4)));
  const before = JSON.stringify(d); compare(); compare(); assert.equal(JSON.stringify(d), before);
  assert.equal(root.DungeonPerformance.diagnostics().counts.partyTileHits, 1);
  for (const change of [() => { d.cells['13,12'] = { tile: 'door', door: { isOpen: false } }; }, () => { d.cells['13,12'].door.isOpen = true; },
    () => { d.cells['12,13'].blocked = true; }, () => { d.cells['12,11'].obstacle = true; }, () => { d.cells['11,12'].floorHeight = 5; },
    () => { d.cells['11,12'].floorHeight = 0; }, () => { d.cells['12,13'] = { tile: 'custom_pedestal' }; },
    () => { delete d.cells['13,13']; }, () => { d.cells['13,13'] = { tile: 'floor' }; }]) {
    const n = root.DungeonPerformance.diagnostics().counts.partyTileBuilds; change(); compare(); compare(); assert.equal(root.DungeonPerformance.diagnostics().counts.partyTileBuilds, n + 1);
  }
  const result = run(); result[0].x = -900; result.splice(1); compare();
});
test('party search invalidates nearest-start dependencies and bounds origins/radii without changing the live cell grid', () => {
  const root = searches(), d = city(), cells = d.cells, run = (origin = { x: 12, y: 12 }, radius = 4) => root.collectNearbyWalkableTiles(d, origin, radius);
  d.cells['12,12'].tile = 'wall'; run(); run(); d.cells['12,12'].tile = 'floor';
  assert.deepEqual(plain(run()), plain(root.collectNearbyWalkableTilesUncached(d, { x: 12, y: 12 }, 4)));
  assert.equal(root.DungeonPerformance.diagnostics().counts.partyTileBuilds, 2);
  for (let x = 1; x < 19; x++) run({ x, y: 10 }, 2);
  const n = root.DungeonPerformance.diagnostics().counts.partyTileBuilds; run(); run({ x: 12, y: 12 }, 3);
  assert.equal(root.DungeonPerformance.diagnostics().counts.partyTileBuilds, n + 2); assert.equal(d.cells, cells);
  d._geometryStamp = 'changed'; run(); assert.equal(root.DungeonPerformance.diagnostics().counts.partyTileBuilds, n + 3);
});
function frames() {
  const d = city(), raf = new Map(), calls = []; let ticket = 0;
  const root = { currentDungeon: d, dungeonRunId: 'run', webglDungeonRenderer: { gl: {} }, document: { visibilityState: 'visible' },
    requestAnimationFrame(fn) { raf.set(++ticket, fn); return ticket; }, cancelAnimationFrame(id) { raf.delete(id); } };
  const cache = api.create(root), scene = { redrawCombatRT() { if (cache.deferMap(root.currentDungeon, scene, scene.redrawCombatRT)) return; calls.push('map'); } };
  root.combatGame = { scene: { getScene: () => scene } };
  function world() { if (cache.deferWorld(root.currentDungeon, world)) return; calls.push('world'); scene.redrawCombatRT(); }
  const tick = () => { const fns = [...raf.values()]; raf.clear(); for (const fn of fns) fn(); };
  return { root, cache, scene, world, calls, raf, tick, d };
}
test('native coalescing draws the latest world once, followed by one live map redraw', () => {
  const h = frames(); h.world(); h.world(); h.scene.redrawCombatRT(); h.scene.redrawCombatRT();
  assert.equal(h.raf.size, 1); assert.deepEqual(h.calls, []); h.tick(); assert.deepEqual(h.calls, ['world', 'map']); assert.equal(h.raf.size, 0);
});
test('combat, death, hidden tabs, non-city scenes and software rendering bypass deferral immediately', () => {
  for (const change of [h => { h.root.actionDiceState = { active: {} }; }, h => { h.root.CombatTacticalUi = { active: () => true }; },
    h => { h.root.isCombatRoundActive = () => true; }, h => { h.root._deathSceneActive = true; }, h => { h.root._gameOver = true; },
    h => { h.root.document.visibilityState = 'hidden'; }, h => { delete h.d.cityBlocks; }, h => { h.root.forceCanvasDungeon = true; }]) {
    const h = frames(); h.world(); change(h); h.world(); h.tick(); assert.deepEqual(h.calls, ['world', 'map']); assert.equal(h.raf.size, 0);
  }
});
test('pending renders cannot replay an old room, floor, run, renderer or destroyed tactical scene', () => {
  for (const change of [h => { h.root.currentDungeon = city(); }, h => { h.d.cityFloorContext = { level: 1 }; },
    h => { h.root.dungeonRunId = 'new'; }, h => { h.root.webglDungeonRenderer = { gl: {} }; }]) {
    const h = frames(); h.world(); h.scene.redrawCombatRT(); change(h); h.tick(); assert.deepEqual(h.calls, []);
    h.world(); h.tick(); assert.deepEqual(h.calls, ['world', 'map']);
  }
  const h = frames(); h.scene.redrawCombatRT(); h.root.combatGame.scene.getScene = () => ({}); h.tick(); assert.deepEqual(h.calls, []);
});
test('a combat state arriving between request and flush draws current combat rather than stale exploration', () => {
  const h = frames(); h.world(); h.scene.redrawCombatRT(); h.root.actionDiceState = { active: {} }; h.tick();
  assert.deepEqual(h.calls, ['world', 'map']); assert.equal(h.raf.size, 0);
});
test('clear cancels pending work and cached state never adds fields to rooms or saves', () => {
  const h = frames(), before = JSON.stringify(h.d); h.world(); h.cache.clear(); h.tick();
  assert.deepEqual(h.calls, []); assert.equal(JSON.stringify(h.d), before); assert.equal(h.cache.diagnostics().savedStateCached, false);
});
test('raw frame queue keeps latest arguments and defers requests made during map drawing to the next frame', () => {
  const raf = new Map(), calls = []; let ticket = 0, queue;
  const root = { requestAnimationFrame: fn => { raf.set(++ticket, fn); return ticket; }, cancelAnimationFrame: id => raf.delete(id) };
  queue = api.frameQueue(root, (...args) => { calls.push(['world', ...args]); queue.requestMap(null, ['inside']); },
    (...args) => { calls.push(['map', ...args]); if (calls.length === 2) queue.requestMap(null, ['next']); });
  queue.requestWorld(null, ['old']); queue.requestWorld(null, ['latest']); queue.requestMap(null, ['outside']);
  const tick = () => { const pending = [...raf.values()]; raf.clear(); for (const fn of pending) fn(); };
  tick(); assert.deepEqual(calls, [['world', 'latest'], ['map', 'inside']]); assert.equal(raf.size, 1);
  tick(); assert.deepEqual(calls[2], ['map', 'next']); assert.equal(raf.size, 0);
});
function mapHarness(canvasMode = false) {
  let allocated = 0, destroyed = 0;
  class Texture {
    constructor(_scene, _x, _y, width, height) { this.width = width; this.height = height; this.draws = []; this.texture = { setFilter() {} }; allocated++; if (canvasMode) this.texture.canvas = createCanvas(width, height); }
    setOrigin() { return this; }
    clear() { this.draws = []; this.texture.canvas?.getContext('2d').clearRect(0, 0, this.width, this.height); return this; }
    draw(object, ...args) {
      if (object instanceof Texture) this.draws.push(...structuredClone(object.draws));
      else this.draws.push([object?.ops ? structuredClone(object.ops) : object?.name || object, ...args]);
      if (canvasMode) {
        const ctx = this.texture.canvas.getContext('2d');
        if (object instanceof Texture) ctx.drawImage(object.texture.canvas, ...args);
        else if (object?.ops) { ctx.save(); for (const [type, ...p] of object.ops) { if (type === 'fillStyle') { ctx.fillStyle = '#' + p[0].toString(16).padStart(6, '0'); ctx.globalAlpha = p[1] ?? 1; } if (type === 'fillRect') ctx.fillRect(...p); } ctx.restore(); }
      }
      return this;
    }
    destroy() { destroyed++; }
    snapshotPixel(x, y, callback) {
      let out = [0, 0, 0, 0];
      for (const [ops] of this.draws) if (Array.isArray(ops)) {
        let color = 0, alpha = 1;
        for (const [type, ...p] of ops) {
          if (type === 'fillStyle') [color, alpha = 1] = p;
          if (type === 'fillRect' && x >= p[0] && x < p[0] + p[2] && y >= p[1] && y < p[1] + p[3]) {
            const a = alpha + out[3] * (1 - alpha), rgb = [color >> 16 & 255, color >> 8 & 255, color & 255];
            out = [...rgb.map((v, i) => (v * alpha + out[i] * out[3] * (1 - alpha)) / a), a];
          }
        }
      }
      callback({ red: out[0], green: out[1], blue: out[2], alpha: out[3] * 255 });
    }
  }
  function graphics() {
    const g = { ops: [], destroy() {} };
    for (const key of ['fillStyle', 'fillRect', 'lineStyle', 'strokeRect', 'setPosition', 'setRotation', 'moveTo', 'lineTo', 'strokePath']) g[key] = (...args) => { g.ops.push([key, ...args]); return g; };
    return g;
  }
  const dungeon = city(7); dungeon.start = { x: 0, y: 0 }; dungeon.secretDoors = { doors: [] };
  dungeon.cells['1,0'] = { tile: 'door', door: { isOpen: false } }; dungeon.cells['0,1'] = { tile: 'pillar' }; dungeon.tiles.pillar = { spriteSpec: { profile: 'cylinder' } };
  const objects = [{ name: 'coin', x: 0, y: 0 }], hooks = {}, root = {
    Phaser: { GameObjects: { RenderTexture: Texture, Graphics: function() { return graphics(); } }, Textures: { FilterMode: { NEAREST: 0 } } },
    console: { warn() {} }, RetroGraphics: { fullbright: () => false },
    CombatTacticalUi: { angle: a => a, cellScale: () => 1, actorPoint: (_a, p) => ({ x: p.x + .5, y: p.y + .5 }), draw: s => s.renderRT.draw('tactics'), drawOverlay: s => s.actorRT.draw('overlay') },
    SceneItems: { normName: n => n }, ObjectDiscovery: { hasDiscovered: () => true }, dungeonTextures: {}, currentDungeon: dungeon,
    combatCharacters: [{ type: 'pc', name: 'hero' }, { type: 'monster', name: 'resident', mazeX: 1, mazeY: 1 }],
    playerPosX: .5, playerPosY: .5, playerAngle: 0, getPlayerPosForMap: () => ({ x: root.playerPosX, y: root.playerPosY }), getCombatMapRotationAngle: () => root.playerAngle,
    getVisibleSceneObjects: () => objects, syncCombatActorOverlayFromMaze() {},
    isObstacleTile: tile => tile === 'pillar' || tile.startsWith('custom_'),
    isBlockedDungeonCell: c => !c || c.blocked || c.obstacle || ['wall', 'torch'].includes(c.tile) || c.tile === 'door' && !c.door?.isOpen,
    isDungeonCliffEdge: (a, b) => !!(a && b && !root.isBlockedDungeonCell(a) && !root.isBlockedDungeonCell(b) && Math.abs((a.floorHeight || 0) - (b.floorHeight || 0)) > .5),
    drawDungeonExitMapMarkers: s => s.renderRT.draw('exits'), isDungeonActorPresent: () => true, ensureMonsterSpriteData() {},
    ensureCombatTextureForCharacter: (_s, actor) => actor.name, getCombatFrameName: actor => 'frame' + (actor.walkFrame || 0), combatMapActorSize: () => 8,
    setCombatPlayerTokenOwner() {}, drawCombatTextureOnRT: (s, key, frame, x, y, size) => { s.actorRT.draw(key, frame, x, y, size); return true; }
  };
  const scene = { gridSize: 5, RT_CELL: 10, PIXEL_SCALE: 2, cellSize: 20, make: { graphics }, characters: {}, forcePlayerToCenter() {},
    textures: { exists: () => true, get: () => ({ has: () => true }) }, events: { once: (key, fn) => { hooks[key] = fn; } } };
  scene.renderRT = new Texture(scene, 0, 0, 50, 50); scene.actorRT = new Texture(scene, 0, 0, 100, 100);
  root.window = root; vm.createContext(root); vm.runInContext('let currentDungeon = window.currentDungeon; let dungeonTextures = window.dungeonTextures;', root);
  scene.redrawCombatRT = vm.runInContext('({' + extract('redrawCombatRT() {', '\n  drawDungeonOverlayInto(gfx) {') + '}).redrawCombatRT', root);
  const cache = api.create(root);
  const frame = enabled => { root.DungeonPerformance = enabled ? cache : null; scene.redrawCombatRT(); return structuredClone([scene.renderRT.draws, scene.actorRT.draws]); };
  return { root, scene, dungeon, objects, hooks, Texture, cache, frame, allocated: () => allocated, destroyed: () => destroyed };
}
test('native map terrain/grid caching preserves exact draw order and keeps actors, items and overlays live', () => {
  const h = mapHarness(); assert.deepEqual(h.frame(true), h.frame(false)); assert.deepEqual(h.frame(true), h.frame(false));
  assert.equal(h.cache.diagnostics().counts.terrainHits, 2);
  h.root.combatCharacters[1].mazeX = -1; h.root.combatCharacters[0].walkFrame = 2; h.objects.length = 0;
  assert.deepEqual(h.frame(true), h.frame(false)); assert.equal(h.cache.diagnostics().counts.terrainHits, 4);
});
test('native map invalidation includes doors, cliff neighbors, secrets, texture arrival, palette, geometry, camera and size', () => {
  const h = mapHarness(); h.frame(true);
  for (const change of [() => { h.dungeon.cells['1,0'].door.isOpen = true; }, () => { h.dungeon.cells['3,0'].floorHeight = 3; },
    () => { h.dungeon.cells['0,0'].floorSurface = 'city_road_surface'; }, () => { h.dungeon.secretDoors.doors.push({ id: 's', discovered: true, open: false }); },
    () => { h.root.dungeonTextures.pillar = { complete: true, naturalWidth: 8, naturalHeight: 8, name: 'column art' }; },
    () => { h.root.RetroGraphics.fullbright = () => true; }, () => { h.dungeon._geometryStamp = 'b'; },
    () => { h.root.playerAngle = .2; }, () => { h.root.playerPosX = .6; }, () => { h.scene.renderRT.width = 60; }]) {
    const n = h.cache.diagnostics().counts.terrainBuilds; change(); assert.deepEqual(h.frame(true), h.frame(false)); assert.equal(h.cache.diagnostics().counts.terrainBuilds, n + 2);
  }
});
test('native Canvas pixel preflight compares real asymmetric alpha pixels and releases temporary resources', () => {
  const h = mapHarness(true), result = api.verifyBlit(h.root, h.scene);
  assert.equal(result.backend, 'canvas'); assert.equal(result.pixelsChecked, 4); assert.ok(result.maxChannelDifference <= 2); assert.equal(h.destroyed(), 3);
});
test('incompatible map compositing fails closed to the unchanged live drawing path', () => {
  const h = mapHarness(); h.Texture.prototype.snapshotPixel = (_x, _y, callback) => callback({ red: 0, green: 0, blue: 0, alpha: 0 });
  assert.deepEqual(h.frame(true), h.frame(false)); assert.deepEqual(h.frame(true), h.frame(false));
  assert.equal(h.cache.diagnostics().counts.terrainBuilds, undefined); assert.equal(h.destroyed(), 3);
});
test('map shutdown/destroy releases its cached RenderTextures and cache state never mutates saves', () => {
  const h = mapHarness(), before = JSON.stringify([h.dungeon, h.root.combatCharacters]); h.frame(true); h.frame(true);
  assert.equal(JSON.stringify([h.dungeon, h.root.combatCharacters]), before); h.hooks.shutdown();
  assert.equal(h.destroyed(), h.allocated() - 2); h.hooks.destroy(); assert.equal(h.destroyed(), h.allocated() - 2);
});
test('the real game dispatcher and map coalesce together without replacing renderer methods or skipping live UI updates', () => {
  const h = mapHarness(), root = h.root, raf = new Map(); let ticket = 0, renders = 0, navigation = 0;
  Object.assign(root, { requestAnimationFrame: fn => { raf.set(++ticket, fn); return ticket; }, cancelAnimationFrame: id => raf.delete(id),
    webglDungeonRenderer: { gl: {}, renderScene() { renders++; } }, combatGame: { scene: { getScene: () => h.scene } },
    playerDungeonX: 0, playerDungeonY: 0, playerZ: 1, PLAYER_EYE_HEIGHT: 1.5, dungeonTexturesMeta: {},
    document: { visibilityState: 'visible', getElementById: () => ({}) },
    syncDungeonExitNavigation() { navigation++; }, scheduleDungeonRenderingDiagnostic() {}, logDungeonCombatSync() {} });
  root.RetroGraphics.presentRenderer = () => {};
  vm.runInContext(extract('function renderDungeonView() {', '// --- Poller for the dedicated character generation task'), root);
  root.DungeonPerformance = h.cache;
  const original = root.webglDungeonRenderer.renderScene;
  root.renderDungeonView(); root.renderDungeonView(); h.scene.redrawCombatRT(); h.scene.redrawCombatRT();
  assert.equal(raf.size, 1); assert.equal(renders, 0); assert.equal(navigation, 0);
  const pending = [...raf.values()]; raf.clear(); for (const fn of pending) fn();
  assert.equal(renders, 1); assert.equal(navigation, 1); assert.equal(h.cache.diagnostics().counts.mapDraws, 1);
  assert.equal(root.webglDungeonRenderer.renderScene, original); assert.equal(raf.size, 0);
  root.actionDiceState = { active: {} }; root.renderDungeonView(); assert.equal(renders, 2); assert.equal(navigation, 2);
  assert.ok(h.scene.renderRT.draws.some(draw => draw[0] === 'tactics'));
});
test('production loads the native cache before quest/game/render scripts without loading any diagnostic trial', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8'), cache = html.indexOf('/assets/dungeonPerformance.js?');
  for (const file of ['questMap', 'game', 'rendererWebGL']) assert.ok(cache > 0 && cache < html.indexOf('/assets/' + file + '.js?'));
  assert.doesNotMatch(html, /city-(?:frame|render)-trial|city-collection-core/);
});
