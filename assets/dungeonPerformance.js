(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonPerformance = api.create(root);
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  function spatialIndex(count = () => {}) {
    const rooms = new WeakMap(), chunkSize = 16;
    function query(dungeon, x, y, radius) {
      const stamp = dungeon?._geometryStamp || dungeon?._meta?.geometryStamp;
      if (!stamp || !dungeon.cells || ![x, y, radius].every(Number.isInteger) || radius < 0) return null;
      const tiles = dungeon.tiles || {}, kinds = Object.keys(tiles).filter(key => !!tiles[key]?.spriteSpec).sort().join('|');
      let index = rooms.get(dungeon);
      if (!index || index.stamp !== stamp || index.cells !== dungeon.cells || index.kinds !== kinds) {
        const buckets = new Map();
        for (const [key, cell] of Object.entries(dungeon.cells)) {
          const tile = cell?.tile;
          if (tile !== 'torch' && tile !== 'pillar' && !(typeof tile === 'string' && tile.startsWith('custom_')) && !tiles[tile]?.spriteSpec) continue;
          const coords = key.split(',').map(Number);
          if (coords.length !== 2 || !coords.every(Number.isInteger)) continue;
          const [cx, cy] = coords, bucketKey = `${Math.floor(cx / chunkSize)},${Math.floor(cy / chunkSize)}`;
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
          buckets.get(bucketKey).push([cx, cy, cell]);
        }
        index = { stamp, cells: dungeon.cells, kinds, buckets, queries: new Map() }; rooms.set(dungeon, index); count('collectionBuilds');
      }
      const key = `${x},${y},${radius}`;
      if (index.queries.has(key)) { count('collectionHits'); return index.queries.get(key); }
      const result = [];
      for (let cx = Math.floor((x - radius) / chunkSize); cx <= Math.floor((x + radius) / chunkSize); cx++) {
        for (let cy = Math.floor((y - radius) / chunkSize); cy <= Math.floor((y + radius) / chunkSize); cy++) {
          for (const row of index.buckets.get(`${cx},${cy}`) || []) {
            if (Math.abs(row[0] - x) <= radius && Math.abs(row[1] - y) <= radius) result.push(row);
          }
        }
      }
      // Preserve x-major order, including equal-distance light ties and the full visibility radius.
      result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (index.queries.size >= 32) index.queries.delete(index.queries.keys().next().value);
      index.queries.set(key, result); count('collectionQueries'); return result;
    }
    return { query };
  }
  function motionCaches(count = () => {}) {
    let rooms = new WeakMap();
    function room(dungeon) {
      if (!dungeon?.cells || !dungeon._geometryStamp) return null;
      let entry = rooms.get(dungeon);
      if (!entry || entry.cells !== dungeon.cells || entry.stamp !== dungeon._geometryStamp) {
        entry = { cells: dungeon.cells, stamp: dungeon._geometryStamp, nearby: new Map(), floors: null }; rooms.set(dungeon, entry);
      }
      return entry;
    }
    function questFloors(dungeon, w, h, start) {
      const entry = room(dungeon), signature = JSON.stringify([w, h, start.x, start.y, dungeon?.cityFloorContext,
        dungeon?.roomExits?.markers?.map(m => [m.key, m.x, m.y, m.direction])]);
      if (entry?.floors?.signature === signature) { count('questFloorHits'); return entry.floors.values; }
      const values = [];
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        const cell = dungeon.cells?.[`${x},${y}`];
        if (cell?.tile === 'floor' && !cell.exitMarker && Math.hypot(x - start.x, y - start.y) >= Math.min(w, h) / 4) values.push({ x, y });
      }
      count('questFloorBuilds'); if (entry) entry.floors = { signature, values }; return values;
    }
    const fingerprint = cell => [!!cell, cell?.tile, cell?.blocked, cell?.obstacle, cell?.door?.isOpen, cell?.floorHeight];
    function nearby(dungeon, origin, radius, build) {
      const entry = room(dungeon);
      if (!entry || !Number.isInteger(origin?.x) || !Number.isInteger(origin?.y) || !Number.isInteger(radius) || radius < 0 || radius > 64)
        return build(dungeon);
      const key = JSON.stringify([origin.x, origin.y, radius, dungeon.start?.x, dungeon.start?.y]);
      let memo = entry.nearby.get(key);
      if (memo) for (const [key, previous] of memo.dependencies) {
        const current = fingerprint(dungeon.cells[key]);
        if (current.some((value, i) => !Object.is(value, previous[i]))) { memo = null; break; }
      }
      if (!memo) {
        const dependencies = new Map();
        // Record only the pure search's cell reads; doors and elevation can change without a geometry stamp.
        const cells = new Proxy(dungeon.cells, { get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof key === 'string' && /^-?\d+,-?\d+$/.test(key)) dependencies.set(key, fingerprint(value));
          return value;
        }, set() { throw Error('Walkable-tile search must not change geometry.'); } });
        const values = build({ ...dungeon, cells });
        memo = { dependencies, values: values.map(tile => ({ ...tile })) }; entry.nearby.set(key, memo); count('partyTileBuilds');
        if (entry.nearby.size > 16) entry.nearby.delete(entry.nearby.keys().next().value);
      } else count('partyTileHits');
      return memo.values.map(tile => ({ ...tile }));
    }
    return { questFloors, nearby, clear() { rooms = new WeakMap(); } };
  }
  function terrainCache(root, count = () => {}) {
    const scenes = new Map(), ids = new WeakMap(); let sequence = 0;
    const id = value => {
      if (!value || typeof value !== 'object') return value;
      if (!ids.has(value)) ids.set(value, ++sequence);
      return ids.get(value);
    };
    function key(scene, dungeon, textures, pos, angle, cs, half, centerX, centerY) {
      const cells = [], kinds = new Set();
      for (let dy = -half; dy <= half + 1; dy++) for (let dx = -half; dx <= half + 1; dx++) {
        const cell = dungeon.cells[`${Math.floor(pos.x + dx)},${Math.floor(pos.y + dy)}`];
        if (cell) kinds.add(cell.tile);
        cells.push(cell ? [cell.tile, cell.floorSurface, cell.floorHeight, cell.blocked, cell.obstacle, cell.door?.isOpen, cell.secretDoorId] : null);
      }
      const images = [...new Set([...kinds, 'wall', 'pillar', 'column'])].map(tile => {
        const image = textures[tile], spec = dungeon.tiles?.[tile]?.spriteSpec;
        return [tile, id(image), image?.complete, image?.naturalWidth, image?.naturalHeight, image?.currentSrc || image?.src,
          !!spec, spec?.type, spec?.profile];
      });
      return JSON.stringify([id(dungeon), id(dungeon.cells), dungeon._geometryStamp, dungeon.cityFloorContext,
        id(scene.renderRT), scene.renderRT.width, scene.renderRT.height, scene.gridSize, scene.RT_CELL,
        pos.x, pos.y, angle, cs, half, centerX, centerY, root.RetroGraphics?.fullbright?.(),
        dungeon.secretDoors?.doors.map(door => [door.id, door.discovered, door.open]), cells, images]);
    }
    function layer(scene, name, signature, build) {
      let cache = scenes.get(scene);
      if (!cache) { cache = new Map(); scenes.set(scene, cache); }
      let entry = cache.get(name);
      const target = scene.renderRT;
      if (!entry || entry.key !== signature) {
        if (!entry || entry.texture.width !== target.width || entry.texture.height !== target.height) {
          entry?.texture.destroy();
          const texture = new root.Phaser.GameObjects.RenderTexture(scene, 0, 0, target.width, target.height);
          texture.setOrigin(0); texture.texture.setFilter(root.Phaser.Textures.FilterMode.NEAREST);
          entry = { texture, key: null }; cache.set(name, entry);
        }
        entry.texture.clear(); build(entry.texture); entry.key = signature; count('terrainBuilds');
      } else count('terrainHits');
      target.draw(entry.texture, 0, 0);
    }
    function release(scene) {
      for (const entry of scenes.get(scene)?.values() || []) entry.texture.destroy();
      scenes.delete(scene);
    }
    function clear() { for (const scene of scenes.keys()) release(scene); }
    return { key, layer, clear, release };
  }
  function verifyBlit(root, scene) {
    const textures = [], graphics = [];
    try {
      const create = () => {
        const rt = new root.Phaser.GameObjects.RenderTexture(scene, 0, 0, 32, 32);
        textures.push(rt); rt.setOrigin(0); rt.texture.setFilter(root.Phaser.Textures.FilterMode.NEAREST); rt.clear(); return rt;
      };
      const shape = (color, alpha, x, y, w, h) => {
        const g = new root.Phaser.GameObjects.Graphics(scene); graphics.push(g);
        g.fillStyle(color, alpha); g.fillRect(x, y, w, h); return g;
      };
      const direct = create(), cached = create(), output = create();
      const background = shape(0x287755, .95, 0, 0, 32, 32);
      const red = shape(0xdd4433, .6, 2, 2, 12, 10), blue = shape(0x2255dd, 1, 19, 17, 10, 12);
      direct.draw(background); direct.draw(red); direct.draw(blue);
      cached.draw(red); cached.draw(blue); output.draw(background); output.draw(cached, 0, 0);
      const sample = (rt, x, y) => {
        let result;
        const canvas = rt.texture?.canvas;
        if (canvas) {
          const context = canvas.getContext('2d');
          result = context && Array.from(context.getImageData(x, y, 1, 1).data);
        } else rt.snapshotPixel(x, y, color => { result = color && [color.red, color.green, color.blue, color.alpha]; });
        if (result?.length !== 4 || !result.every(Number.isFinite)) throw Error('Map cache pixel verification unavailable.');
        return result;
      };
      const samples = [[3, 3], [21, 20], [3, 25], [25, 3]].map(([x, y]) => ({ direct: sample(direct, x, y), cached: sample(output, x, y) }));
      const difference = Math.max(...samples.flatMap(s => s.direct.map((value, i) => Math.abs(value - s.cached[i]))));
      if (difference > 2 || new Set(samples.map(s => s.direct.join(','))).size < 3) throw Error('Map cache pixel orientation/compositing mismatch.');
      return { maxChannelDifference: difference, pixelsChecked: samples.length, backend: direct.texture?.canvas ? 'canvas' : 'webgl' };
    } finally { for (const g of graphics) g.destroy(); for (const rt of textures) rt.destroy(); }
  }
  function frameQueue(root, world, map) {
    let ticket = 0, worldCall = null, mapCall = null, flushing = false;
    function schedule() { if (!ticket && !flushing) ticket = root.requestAnimationFrame(flush); }
    function requestWorld(self, args) { worldCall = [self, args]; schedule(); }
    function requestMap(self, args) { mapCall = [self, args]; schedule(); }
    function flush() {
      if (ticket) root.cancelAnimationFrame(ticket);
      ticket = 0; flushing = true;
      try {
        const call = worldCall; worldCall = null;
        if (call) world.apply(call[0], call[1]);
        const next = mapCall; mapCall = null;
        if (next) map.apply(next[0], next[1]);
      } finally { flushing = false; if (worldCall || mapCall) schedule(); }
    }
    function cancel() { if (ticket) root.cancelAnimationFrame(ticket); ticket = 0; worldCall = mapCall = null; }
    return { requestWorld, requestMap, flush, cancel };
  }
  function create(root) {
    const counts = {}, count = key => { counts[key] = (counts[key] || 0) + 1; };
    const spatial = spatialIndex(count), motion = motionCaches(count), terrain = terrainCache(root, count);
    const checkedMaps = new WeakMap(), sceneHooks = new WeakSet();
    let scope = null, worldPermit = null, mapPermit = null;
    const combat = () => root.actionDiceState?.active || root.CombatTacticalUi?.active?.() || root._combatCommandPending ||
      root.isCombatRoundActive?.() || root._deathSceneActive || root._gameOver;
    const eligible = dungeon => !!(dungeon?.cells && dungeon._geometryStamp && (dungeon.cityBlocks || dungeon.sceneSpec?.city) &&
      root.requestAnimationFrame && root.cancelAnimationFrame && root.webglDungeonRenderer?.gl && !root.forceCanvasDungeon &&
      root.document?.visibilityState !== 'hidden' && !combat());
    function sameScope(dungeon) {
      return scope?.dungeon === dungeon && scope.run === root.dungeonRunId && scope.floor === JSON.stringify(dungeon.cityFloorContext) &&
        scope.renderer === root.webglDungeonRenderer;
    }
    const queue = frameQueue(root, function(dungeon, draw) {
      if (!sameScope(dungeon) || root.currentDungeon !== dungeon) return;
      worldPermit = draw;
      try { count('worldDraws'); draw(); } finally { worldPermit = null; }
    }, function(dungeon, scene, draw) {
      if (!sameScope(dungeon) || root.currentDungeon !== dungeon || root.combatGame?.scene?.getScene('CombatScene') !== scene) return;
      mapPermit = [scene, draw];
      try { count('mapDraws'); draw.call(scene); } finally { mapPermit = null; }
    });
    function clear() { queue.cancel(); terrain.clear(); motion.clear(); scope = null; }
    function enter(dungeon) {
      if (!sameScope(dungeon)) {
        clear(); scope = { dungeon, run: root.dungeonRunId, floor: JSON.stringify(dungeon.cityFloorContext), renderer: root.webglDungeonRenderer };
      }
    }
    function deferWorld(dungeon, draw) {
      if (worldPermit === draw) { worldPermit = null; return false; }
      if (!eligible(dungeon)) { if (scope) clear(); return false; }
      enter(dungeon); count('worldRequests'); queue.requestWorld(null, [dungeon, draw]); return true;
    }
    function deferMap(dungeon, scene, draw) {
      if (mapPermit?.[0] === scene && mapPermit[1] === draw) { mapPermit = null; return false; }
      if (!eligible(dungeon)) { if (scope) clear(); return false; }
      enter(dungeon); count('mapRequests'); queue.requestMap(null, [dungeon, scene, draw]); return true;
    }
    function mapLayers(scene, dungeon, ...args) {
      if (!dungeon?.cells || !dungeon._geometryStamp || !scene.renderRT) return null;
      if (!sceneHooks.has(scene)) {
        sceneHooks.add(scene);
        for (const event of ['shutdown', 'destroy']) scene.events?.once(event, () => { terrain.release(scene); checkedMaps.delete(scene); queue.cancel(); });
      }
      let check = checkedMaps.get(scene);
      if (check?.target !== scene.renderRT) {
        try { check = { target: scene.renderRT, result: verifyBlit(root, scene) }; }
        catch (error) { check = { target: scene.renderRT, error: error.message }; root.console?.warn('Map layer cache disabled:', error.message); }
        checkedMaps.set(scene, check);
      }
      if (check.error) return null;
      const signature = terrain.key(scene, dungeon, ...args);
      return (name, build) => terrain.layer(scene, name, signature, build);
    }
    return { query: spatial.query, questFloors: motion.questFloors, nearby: motion.nearby, mapLayers, deferWorld, deferMap, clear,
      diagnostics: () => ({ counts: { ...counts }, frameCoalescing: !!scope, savedStateCached: false }) };
  }
  return { create, spatialIndex, motionCaches, terrainCache, verifyBlit, frameQueue };
});
