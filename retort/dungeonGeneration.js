'use strict';

const VERSION = 1;

function hash(value) {
  let seed = 2166136261;
  for (const char of String(value)) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function random(seed) {
  let state = hash(seed);
  return () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gridSize(classification = {}) {
  const requested = Number.isFinite(classification.size) ? Math.round(classification.size) : 64;
  if (classification.indoor === false) {
    return Math.min(Math.max(96, Math.min(requested, 192)) * 10, 512);
  }
  return Math.max(64, Math.min(requested, 192));
}

function prepare(spec, classification, runId) {
  const coords = spec.coords || {};
  const roomKey = `${coords.x ?? 0},${coords.y ?? 0},${coords.z ?? 0}`;
  // Text hashes describe the prose; campaign seeds describe this playthrough's geometry.
  spec.generation = { version: VERSION, runId: String(runId || ''), roomKey,
    seed: `dungeon-v${VERSION}:${runId || ''}:${roomKey}`,
    requestedSize: classification?.size ?? null, gridSize: gridSize(classification) };
  return spec.generation;
}

function seedBlueprint(blueprint, generation) {
  if (!blueprint || !generation?.seed) return blueprint;
  return { ...blueprint, seed: generation.seed, designerSeed: blueprint.seed || null };
}

function varyPalette(spec) {
  const generation = spec.generation;
  if (!generation?.seed || generation.materialTones) return spec.palette;
  const rnd = random(`${generation.seed}:materials`);
  const brightness = 0.90 + Math.floor(rnd() * 7) * 0.03;
  const warmth = Math.floor(rnd() * 9) - 4;
  generation.materialTones = { brightness, warmth };
  spec.palette = Object.fromEntries(Object.entries(spec.palette || {}).map(([key, color]) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return [key, color];
    const rgb = [1, 3, 5].map((offset, i) => {
      const value = parseInt(color.slice(offset, offset + 2), 16);
      return Math.max(0, Math.min(255, Math.round(value * brightness + (i === 0 ? warmth : i === 2 ? -warmth : 0))))
        .toString(16).padStart(2, '0');
    });
    return [key, '#' + rgb.join('')];
  }));
  return spec.palette;
}

module.exports = { gridSize, prepare, random, seedBlueprint, varyPalette, VERSION };
