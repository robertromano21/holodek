'use strict';

const { random } = require('./dungeonGeneration');
const Terrain = require('./outdoorTerrain');
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BUILDINGS = new Set(['temple', 'basilica', 'castle', 'rotunda', 'bathhouse', 'catacomb', 'ruins',
  'amphitheater', 'theater', 'circus', 'forum', 'domus', 'villa', 'insula', 'warehouse', 'infrastructure']);

// Supplement omissions only. Authored placements and saved campaign blueprints win.
function enrich(blueprint, { classification = {}, size = 512, generation, sceneSpec, description = '' } = {}) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint) || blueprint.designContract || !Number.isFinite(size) || size < 32) return blueprint;
  const seed = generation?.seed || blueprint.seed || sceneSpec?.textHash || 'blueprint';
  const rng = random(`${seed}:design-contract`);
  const text = `${description} ${sceneSpec?.source?.roomName || ''} ${sceneSpec?.architecture || ''}`.toLowerCase();
  const result = { ...blueprint }, added = [], rejected = [];
  if (classification.indoor === true) {
    const plan = blueprint.indoorPlan, rooms = Array.isArray(plan?.rooms) ? plan.rooms : [];
    const modules = Array.isArray(plan?.modules) ? plan.modules : [];
    if (!modules.length && !rooms.some(r => ['shrine', 'sanctum', 'rotunda'].includes(r?.role))) {
      const types = /crypt|catacomb|cave|sewer/.test(text) ? ['vaulted_bay', 'staircase', 'switchback_stair'] :
        /castle|keep|fort/.test(text) ? ['staircase', 'raised_gallery', 'vaulted_bay', 'split_raised_gallery'] :
        ['portico', 'rotunda_section', 'colonnade', 'sanctuary', 'cloister', 'apsidal_chapel'];
      const choices = rooms.flatMap((r, room) => {
        if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0 || r.w > 1 || r.h > 1 || r.role === 'courtyard') return [];
        if (.5 >= r.x && .5 < r.x + r.w && .75 >= r.y && .75 < r.y + r.h) return [];
        return types.flatMap(type => {
          const [w, h] = { rotunda_section: [9, 9], staircase: [3, 16], switchback_stair: [9, 11],
            cloister: [11, 13], apsidal_chapel: [11, 13], split_raised_gallery: [13, 13] }[type] || [5, 6];
          return r.w * size >= w + 2 && r.h * size >= h + 2 ? [{ type, room, width: w, height: h, rank: rng() }] : [];
        });
      }).sort((a, b) => a.rank - b.rank);
      if (choices.length) {
        const { rank, ...module } = choices[0];
        const chosen = { ...module, x: .2 + rng() * .6, y: .2 + rng() * .6 };
        if (/cave|sewer|crypt|catacomb/.test(text)) chosen.roofStyle = 'barrel';
        result.indoorPlan = { ...plan, modules: [chosen] };
        added.push({ kind: 'indoor-section', ...chosen });
      }
    }
  } else if (classification.indoor === false && size >= 64) {
    const buildings = Array.isArray(blueprint.buildings) ? blueprint.buildings : [];
    const hasBuilding = buildings.some(b => b && BUILDINGS.has(b.type) && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w * size >= 21 && b.h * size >= 25);
    const natureOnly = /\b(no buildings|no ruins|untouched|unspoiled)\b/.test(text);
    const relevant = /ruin|temple|fort|keep|castle|watchtower/.test(text) || /wasteland|ruins/.test(classification.biome || '');
    if (!hasBuilding && buildings.length < 4 && relevant && !natureOnly) {
      const options = /temple/.test(text) ? [{ type: 'temple' }, { type: 'rotunda' }, { type: 'ruins' }] :
        [{ type: 'ruins' }, { type: 'castle', variant: 'watchtower' }, { type: 'castle', variant: 'stone-keep' }, { type: 'castle', variant: 'gatehouse' }];
      const choice = options[Math.floor(rng() * options.length)];
      const angle = rng() * Math.PI * 2;
      const terrainSpec = { ...sceneSpec, indoor: false, biome: classification.biome,
        generation: { seed }, source: { ...sceneSpec?.source, description } };
      const terrain = Terrain.design(sceneSpec?.outdoorTerrain || Terrain.plan(terrainSpec, size, size), blueprint, size, size);
      for (let i = 0; i < 96; i++) {
        const compact = i >= 48, w = compact ? 21 : 28, h = compact ? 25 : 32;
        const a = angle + i * GOLDEN_ANGLE, radius = Math.min(size * .45, i < 24 ? 32 + rng() * 24 : 56 + rng() * 90);
        const x = Math.round(Math.max(2, Math.min(size - w - 2, size * .5 + Math.cos(a) * radius - w / 2)));
        const y = Math.round(Math.max(2, Math.min(size - h - 2, size * .75 + Math.sin(a) * radius - h / 2)));
        if (size * .5 >= x - 5 && size * .5 <= x + w + 5 && size * .75 >= y - 5 && size * .75 <= y + h + 5) continue;
        const elevation = Terrain.heightAt(terrain, x + Math.floor(w / 2), y + Math.floor(h / 2));
        const approachLength = Math.max(Math.max(x - size * .5, size * .5 - x - w, 0),
          Math.max(y - size * .75, size * .75 - y - h, 0));
        // Only omit-design fallbacks are moved: short approaches cannot serve a
        // high mesa top, and foundations should not bulldoze a whole cliff face.
        if (Math.abs(elevation) > Math.max(1, approachLength) * .65) continue;
        let low = Infinity, high = -Infinity;
        for (const sx of [x, x + w / 2, x + w - 1]) for (const sy of [y, y + h / 2, y + h - 1]) {
          const z = Terrain.heightAt(terrain, sx, sy); low = Math.min(low, z); high = Math.max(high, z);
        }
        if (high - low > 5) continue;
        const building = { ...choice, x: x / size, y: y / size, w: w / size, h: h / size, ruined: true };
        result.buildings = [...buildings, building];
        result.paths = [...(Array.isArray(blueprint.paths) ? blueprint.paths : []), {
          from: [.5, .75], to: [(x + w / 2) / size, (y + h - 3) / size], widthTiles: 3, ramp: true
        }];
        added.push({ kind: 'outdoor-building', ...building });
        break;
      }
      if (!added.length) rejected.push({ kind: 'outdoor-building', reason: 'no-safe-terrain-site', candidates: 96 });
    }
  }
  result.designContract = { version: 1, source: 'designer-plus-bounded-supplement', added, rejected };
  return result;
}

module.exports = { enrich, GOLDEN_ANGLE };
