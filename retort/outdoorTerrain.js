'use strict';

const { random } = require('./dungeonGeneration');
const VERSION = 2;
const KINDS = new Set(['hill', 'ridge', 'mountain', 'mesa', 'butte', 'hoodoo', 'terraces', 'basin', 'cliff', 'canyon', 'thermal_basin', 'caldera']);
const DEPRESSIONS = new Set(['basin', 'canyon', 'thermal_basin']);
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const terrace = value => {
  const level = Math.max(0, Math.min(1, value)) * 6;
  return (Math.floor(level) + smooth(((level % 1) - .65) / .35)) / 6;
};

function relief(f, rx, ry) {
  const r = Math.hypot(rx, ry);
  if (f.kind === 'mesa' || f.kind === 'butte') {
    const edge = Math.pow(Math.abs(rx) ** 4 + Math.abs(ry) ** 4, .25);
    const shoulder = f.kind === 'mesa' ? .68 : .38;
    // A talus apron below a steep, flat-topped cap, not another rounded hill.
    return .3 * smooth((1 - r) / .6) + .7 * smooth((shoulder - edge) / .1);
  }
  if (f.kind === 'hoodoo') return .22 * smooth((1 - r) / .65) + .78 * smooth((.28 - r) / .08);
  if (f.kind === 'terraces') return terrace(smooth(1 - r));
  if (f.kind === 'cliff') return smooth((1 - Math.abs(ry)) / .2) * smooth((1 - Math.abs(rx)) / .2) * smooth((rx + .15) / .07);
  if (f.kind === 'canyon') {
    const channel = Math.abs(rx - .16 * Math.sin(ry * 4 + (f.phase || 0)));
    return terrace(smooth((1 - channel) / .75)) * smooth((1 - Math.abs(ry)) / .25);
  }
  if (f.kind === 'thermal_basin') {
    const bowl = terrace(smooth((.8 - r) / .6));
    const rim = .18 * smooth(1 - Math.abs(r - .85) / .15);
    return bowl - rim;
  }
  if (f.kind === 'caldera') return smooth(1 - r) * (1 - .85 * smooth((.45 - r) / .2));
  return smooth(1 - r);
}

function plan(spec = {}, width = 512, height = width) {
  const seed = spec.generation?.seed;
  if (spec.indoor !== false || !seed) return null;
  const text = `${spec.biome || ''} ${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  const flat = /\b(flat|level) (?:\w+ )?(plains?|wastes?|terrain|ground)|salt flat|frozen lake/.test(text);
  const wetland = /swamp|bog|marsh|mire|wetland|lake/.test(text);
  const urban = /city|street|town|village|forum|amphitheater|theater|circus|harbou?r/.test(text);
  const garden = /\bgarden|orchard/.test(text) && !/mountain|crag|cliff/.test(text);
  const rnd = random(`${seed}:outdoor-terrain`), span = Math.min(width, height);
  const profile = flat ? 'flat' : wetland ? 'wetland' : urban ? 'urban' : garden ? 'garden' :
    /thermal|geyser|hot spring|sulph?ur|mineral terrace/.test(text) ? 'geothermal' : /volcan|lava|cinder/.test(text) ? 'volcanic' :
    /canyon|ravine|gorge/.test(text) ? 'badlands' : /glacier|snow|icy|frozen|\bice\b/.test(text) ? 'glacial' :
    /\b(forest|woodland|grove)\b/.test(text) ? 'forest' : 'wasteland';
  const choices = profile === 'badlands' ? ['mesa', 'butte', 'canyon', 'hoodoo', 'cliff', 'terraces'] :
    profile === 'geothermal' ? ['thermal_basin', 'terraces', 'cliff'] :
    profile === 'volcanic' ? ['caldera', 'mountain', 'ridge', 'cliff'] : profile === 'glacial' ? ['mountain', 'ridge', 'cliff'] :
    profile === 'forest' ? ['hill', 'ridge', 'terraces'] : ['ridge', 'mountain', 'mesa', 'butte', 'terraces'];
  const named = [['canyon', /canyon|ravine|gorge/], ['thermal_basin', /thermal|geyser|hot spring|sulph?ur/],
    ['caldera', /volcano|caldera|crater/],
    ['mesa', /\bmesas?\b/], ['butte', /\bbuttes?\b/], ['hoodoo', /hoodoo|rock spire/], ['terraces', /mineral terrace/], ['cliff', /\bcliffs?\b/]]
    .find(([, pattern]) => pattern.test(text))?.[0];
  const features = [];
  if (!flat && !wetland && !urban && !garden) {
    const count = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const angle = rnd() * Math.PI, radius = span * (0.08 + rnd() * 0.09);
      const kind = i < 2 ? 'basin' : i < 4 ? 'hill' : i === 4 && named ? named : choices[Math.floor(rnd() * choices.length)];
      const narrow = ['butte', 'hoodoo'].includes(kind) ? .45 : 1;
      features.push({ kind, x: width * (0.08 + rnd() * 0.84),
        y: height * (0.08 + rnd() * 0.84), radiusX: radius, radiusY: radius * (1.1 + rnd() * 1.7),
        cos: Math.cos(angle), sin: Math.sin(angle), rise: DEPRESSIONS.has(kind) ? -(7 + rnd() * (kind === 'canyon' ? 25 : 9)) :
          kind === 'hill' ? 12 + rnd() * 18 : 18 + rnd() * 30, phase: rnd() * Math.PI * 2 });
      const feature = features[features.length - 1];
      feature.radiusX *= narrow;
      feature.radiusY *= kind === 'canyon' ? 1.5 : kind === 'hill' ? .75 : narrow;
    }
  }
  return { version: VERSION, seed, profile, features, spawn: { x: Math.floor(width / 2), y: height - Math.floor(height / 4) },
    safeRadius: Math.min(48, Math.max(24, span * 0.1)), phaseX: rnd() * Math.PI * 2,
    phaseY: rnd() * Math.PI * 2, angle: rnd() * Math.PI, roll: flat || urban || garden ? 0.15 : wetland ? 0.4 : 1.4 + rnd() * 1.2,
    wave: span * (0.04 + rnd() * 0.035),
    detail: { amplitude: flat || wetland || urban || garden ? .3 : 1.8, scale: .18 },
    surfaceModel: 'shared-floor-heightfield' };
}

function heightAt(plan, x, y) {
  const nx = (x * Math.cos(plan.angle) - y * Math.sin(plan.angle)) / plan.wave;
  const ny = (x * Math.sin(plan.angle) + y * Math.cos(plan.angle)) / plan.wave;
  let height = plan.roll * (Math.sin(nx + plan.phaseX) + Math.cos(ny * 0.8 + plan.phaseY) +
    0.35 * Math.sin(nx * 1.8 + ny * 0.7 + plan.phaseY));
  if (plan.detail) {
    const a = x * plan.detail.scale + plan.phaseX, b = y * plan.detail.scale + plan.phaseY;
    height += (Math.sin(a) + Math.sin(b) + Math.sin(a + b * 1.3)) / 3 * plan.detail.amplitude;
  }
  for (const f of plan.features) {
    const dx = x - f.x, dy = y - f.y;
    const rx = (dx * f.cos - dy * f.sin) / f.radiusX, ry = (dx * f.sin + dy * f.cos) / f.radiusY;
    height += f.rise * relief(f, rx, ry);
  }
  const t = Math.min(1, Math.hypot(x - plan.spawn.x, y - plan.spawn.y) / plan.safeRadius);
  return Number((height * t * t * (3 - 2 * t)).toFixed(3));
}

function design(base, blueprint = {}, width = 512, height = width) {
  if (!base) return null;
  const requests = Array.isArray(blueprint.landforms) ? blueprint.landforms : [];
  if (!requests.length) return base;
  const authored = [], rejected = [];
  for (const f of requests.slice(0, 8)) {
    if (!f || !KINDS.has(f.kind) ||
        ![f.x, f.y, f.radiusX, f.radiusY, f.rise].every(Number.isFinite) || f.radiusX <= 0 || f.radiusY <= 0) {
      rejected.push({ kind: f?.kind || null, reason: 'invalid-landform' }); continue;
    }
    const angle = (Number.isFinite(f.angle) ? f.angle : 0) * Math.PI / 180;
    const negative = DEPRESSIONS.has(f.kind);
    const rise = Math.max(2, Math.min(negative ? 48 : 80, Math.abs(f.rise)));
    authored.push({ kind: f.kind, source: 'llm-blueprint', x: Math.max(0, Math.min(1, f.x)) * (width - 1),
      y: Math.max(0, Math.min(1, f.y)) * (height - 1),
      radiusX: Math.max(8, Math.min(width * 0.3, f.radiusX * width)),
      radiusY: Math.max(8, Math.min(height * 0.4, f.radiusY * height)),
      rise: negative ? -rise : rise, cos: Math.cos(angle), sin: Math.sin(angle),
      phase: random(`${base.seed}:landform:${authored.length}`)() * Math.PI * 2 });
  }
  // Designed relief is part of the initial heightfield; seeded backing terrain and
  // the later local trail/cliff/vegetation passes remain intact.
  return { ...base, features: [...base.features, ...authored],
    design: { source: authored.length ? 'llm-blueprint-plus-seeded-terrain' : 'seeded-terrain',
      authored: authored.length, rejected } };
}

function decorate(dungeon, classification = {}) {
  if (dungeon.outdoorDressing) return dungeon.outdoorDressing;
  const { width, height } = dungeon.layout;
  const rng = random(`${dungeon.generation?.seed}:legacy-outdoor-dressing`);
  const shapes = new Set(['boulder', 'rock_face', 'tomb', 'obelisk', 'crystal', 'rubble', 'fallen_arch', 'broken_masonry',
    'dead_tree', 'stump', 'roots', 'thorn_bush', 'bramble_patch']);
  const props = Object.entries(dungeon.tiles || {}).filter(([key, tile]) => key.startsWith('custom_') && shapes.has(tile.spriteSpec?.voxelShape)).map(([key]) => key);
  const budget = Math.min(80, Math.max(8, Math.floor(width * height / 4096)));
  const placed = [];
  for (let attempt = 0; attempt < budget * 8 && placed.length < budget; attempt++) {
    const near = placed.length < budget * .65, angle = rng() * Math.PI * 2;
    const distance = near ? 12 + rng() * Math.min(70, width * .25) : 70 + rng() * Math.min(width, height) * .35;
    const x = Math.round(dungeon.start.x + Math.cos(angle) * distance), y = Math.round(dungeon.start.y + Math.sin(angle) * distance);
    if (x < 5 || y < 5 || x >= width - 5 || y >= height - 5 || placed.some(p => Math.hypot(x - p.x, y - p.y) < 6)) continue;
    let safe = true;
    let low = Infinity, high = -Infinity;
    // An open local walking ring ensures a short ruin fragment cannot sever a route.
    for (let dy = -4; dy <= 4 && safe; dy++) for (let dx = -4; dx <= 4; dx++) {
      const c = dungeon.cells[`${x + dx},${y + dy}`];
      if (c?.tile !== 'floor' || c.feature || c.exit || c.door || c.interactable || c.navigationReserved || c.architectureRole || c.outdoorFoundation) { safe = false; break; }
      low = Math.min(low, c.floorHeight || 0); high = Math.max(high, c.floorHeight || 0);
    }
    if (!safe || high - low > 1) continue;
    const wall = !props.length || rng() < .4;
    const length = wall ? 2 + Math.floor(rng() * 3) : 1;
    const horizontal = rng() < .5;
    const tile = wall ? 'wall' : props[Math.floor(rng() * props.length)];
    for (let i = 0; i < length; i++) {
      const key = `${x + (horizontal ? i : 0)},${y + (horizontal ? 0 : i)}`, c = dungeon.cells[key];
      c.tile = tile; c.feature = wall ? null : tile;
      c.ceilHeight = (c.floorHeight || 0) + (wall ? 1.2 + rng() * 1.6 : 2.5);
      c.outdoorDetail = wall ? 'ruin-fragment' : 'scattered-prop';
    }
    placed.push({ x, y, tile, length });
  }
  return (dungeon.outdoorDressing = { version: 1, source: 'legacy-scatter-plus-designer', budget, placed: placed.length,
    walls: placed.filter(p => p.tile === 'wall').length, props: placed.filter(p => p.tile !== 'wall').length, sites: placed });
}

module.exports = { plan, design, heightAt, decorate, VERSION };
