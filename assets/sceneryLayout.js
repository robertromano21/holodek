'use strict';
// Auto-layout for richer plans when the LLM gives rough positions.
// Gated: recipes without plan.layout (or with layout:'manual') are untouched.

const SKY = new Set(['cloud', 'sun', 'moon', 'stars', 'mist', 'light_rays', 'aurora_band', 'nebula', 'lenticular', 'thunderhead', 'comet', 'ringed_planet']);
const GROUND = new Set(['dunes', 'grass', 'road', 'river', 'pool', 'mosaic', 'rubble', 'sandstorm', 'lava', 'chasm']);
const BACKDROP_KINDS = new Set(['wall', 'mountain', 'ridge', 'cliff', 'fresco', 'coffered_ceiling', 'vault']);
const FRAME_KINDS = new Set(['pillar', 'portico', 'arch', 'hanging_banner', 'wall_banner', 'tapestry', 'pine', 'tree', 'willow', 'broadleaf']);

function normalize(layout) {
  if (layout == null || layout === false || layout === 'manual') return null;
  if (layout === 'auto' || layout === true) return { mode: 'auto' };
  if (typeof layout === 'object') {
    if (layout.mode === 'manual') return null;
    return { mode: 'auto', symmetry: layout.symmetry, hero: layout.hero, heroScale: layout.heroScale };
  }
  return null;
}

function inferRole(p, plan, heroKind) {
  if (p.role) return p.role;
  if (SKY.has(p.kind)) return 'sky';
  if (GROUND.has(p.kind)) return 'ground';
  if (p.kind === 'wall' && (plan.view === 'interior' || plan.view === 'cavern')) return 'backdrop';
  if (BACKDROP_KINDS.has(p.kind) && (p.depth === 'far' || p.kind === 'mountain' || p.kind === 'ridge')) return 'backdrop';
  if (heroKind && p.kind === heroKind) return 'hero';
  if (FRAME_KINDS.has(p.kind) && (p.x < 36 || p.x + p.w > 284) && p.kind !== heroKind) return 'framing';
  if (p.depth === 'far') return 'skyline';
  if (p.depth === 'foreground') return 'prop';
  return 'prop';
}

function applyLayout(plan) {
  const layout = normalize(plan && plan.layout);
  if (!layout) return plan;
  const layers = plan.layers.map(p => Object.assign({}, p));
  const H = 200, W = 320;
  const horizon = plan.horizon || 110;
  const view = plan.view || 'landscape';
  const interior = view === 'interior' || view === 'cavern';
  const vanish = plan.vanishing || 160;
  const heroKind = layout.hero;
  const roles = layers.map(p => inferRole(p, plan, heroKind));

  let heroIdx = roles.findIndex(r => r === 'hero');
  if (heroIdx < 0 && heroKind) heroIdx = layers.findIndex(p => p.kind === heroKind);
  if (heroIdx < 0) {
    let best = -1, bestA = 0;
    layers.forEach((p, i) => {
      if (roles[i] === 'sky' || roles[i] === 'ground' || roles[i] === 'backdrop') return;
      const a = p.w * p.h;
      if (a > bestA) { bestA = a; best = i; }
    });
    heroIdx = best;
  }
  if (heroIdx >= 0) {
    const hero = layers[heroIdx];
    const aspect = hero.h > 0 ? hero.w / hero.h : 0.8;
    let h = Math.round(H * (layout.heroScale || (interior ? 0.44 : 0.46)));
    h = Math.max(Math.round(H * 0.3), Math.min(Math.round(H * 0.6), h));
    let w = Math.round(h * aspect);
    w = Math.max(14, Math.min(220, w));
    const cx = (layout.symmetry === 'center' || interior) ? vanish : Math.round(hero.x + hero.w / 2);
    hero.w = w;
    hero.h = h;
    hero.x = Math.round(cx - w / 2);
    const base = interior ? 188 : Math.min(192, horizon + Math.round(h * 0.38));
    hero.y = base - h;
    hero.depth = hero.depth || 'mid';
    roles[heroIdx] = 'hero';
  }

  layers.forEach((p, i) => {
    if (i === heroIdx) return;
    const role = roles[i];
    if (role === 'backdrop') {
      if (p.kind === 'wall' || p.kind === 'fresco' || p.kind === 'coffered_ceiling') {
        if (p.kind === 'coffered_ceiling') { p.x = 0; p.y = 0; p.w = W; p.h = Math.max(18, Math.min(p.h, 40)); }
        else { p.x = Math.min(p.x, 0); p.w = Math.max(p.w, W - p.x); p.y = Math.min(p.y, 0); p.h = Math.max(p.h, (interior ? 150 : horizon + 36) - p.y); }
        p.depth = p.depth || (p.kind === 'wall' ? undefined : 'far');
        if (p.kind === 'wall') delete p.depth; // keep behind unless ordered earlier
      } else {
        if (p.h < 48) p.h = Math.max(p.h, Math.round(horizon * 0.7));
        p.y = Math.max(-10, horizon - p.h + Math.round(p.h * 0.08));
        if (p.w < 90) p.w = Math.min(W, Math.max(100, p.w * 2));
        p.depth = 'far';
      }
    } else if (role === 'framing') {
      const left = (p.x + p.w / 2) < 160;
      p.h = Math.max(p.h, Math.round(H * (interior ? 0.7 : 0.55)));
      p.h = Math.min(190, p.h);
      p.y = interior ? Math.max(6, 188 - p.h) : Math.max(8, Math.min(horizon + 36, 196) - p.h);
      p.x = left ? Math.max(-8, 2) : Math.min(W - p.w - 2, W - p.w);
      p.depth = p.depth || 'foreground';
    } else if (role === 'skyline' || (p.depth === 'far' && role !== 'sky' && role !== 'ground' && role !== 'backdrop')) {
      const maxH = Math.round(H * 0.3);
      if (p.h > maxH) {
        const a = p.w / p.h;
        p.h = maxH;
        p.w = Math.max(8, Math.round(maxH * a));
      }
      p.y = Math.max(0, horizon - p.h + Math.round(p.h * 0.12));
    } else if (p.depth === 'foreground' && role !== 'ground') {
      const floor = 198;
      if (p.y + p.h < floor - 8) p.y = Math.min(p.y + 8, floor - p.h);
    }
  });

  // light spacing: nudge mid props that share a base and overlap heavily
  for (let i = 0; i < layers.length; i++) {
    if (i === heroIdx) continue;
    if (roles[i] !== 'prop') continue;
    for (let j = i + 1; j < layers.length; j++) {
      if (j === heroIdx || roles[j] !== 'prop') continue;
      const a = layers[i], b = layers[j];
      if (Math.abs((a.y + a.h) - (b.y + b.h)) > 10) continue;
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlap > Math.min(a.w, b.w) * 0.55) {
        const dir = (a.x + a.w / 2) <= (b.x + b.w / 2) ? -1 : 1;
        a.x += dir * 8;
        b.x -= dir * 8;
      }
    }
  }

  return Object.assign({}, plan, { layers });
}

module.exports = { applyLayout, normalize, inferRole };
