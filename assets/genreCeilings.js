(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenreCeilings = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const rows = {
    fantasy: ['wood', 'coffers', '#67503a', '#30251c', '#a18258'],
    'dark-fantasy': ['bone', 'ribs', '#555052', '#242329', '#8b8175'],
    mythic: ['stone', 'coffers', '#a79978', '#5b574d', '#cbbd88'],
    'sci-fi': ['metal', 'service', '#424d5a', '#192735', '#8ed9f0'],
    cyberpunk: ['metal', 'cables', '#302b3c', '#131c2b', '#da5b9c'],
    'post-apocalyptic': ['metal', 'patches', '#645f4b', '#302f2a', '#a68f59'],
    steampunk: ['metal', 'pipes', '#715535', '#302c2b', '#bd9953'],
    western: ['wood', 'rafters', '#846240', '#3c2b20', '#b09265'],
    modern: ['stone', 'acoustic', '#8e9694', '#4d585d', '#d3ddd8'],
    noir: ['stone', 'deco', '#66665f', '#303737', '#b7a779'],
    nautical: ['wood', 'hull', '#66534a', '#292e31', '#a68d65'],
    'cosmic-horror': ['obsidian', 'fractures', '#414752', '#161f2e', '#729d92'],
    'gothic-horror': ['stone', 'ribs', '#57556a', '#222431', '#9291aa'],
    solarpunk: ['wood', 'greenhouse', '#59776b', '#263f3b', '#b6e2cb'],
    dieselpunk: ['metal', 'trusses', '#4b5951', '#252e2b', '#b7a56a'],
    underwater: ['metal', 'pressure', '#3f6976', '#173441', '#91d6dc'],
    prehistoric: ['wood', 'hide', '#826c4e', '#40372b', '#b6a27d'],
    'desert-fantasy': ['stone', 'lattice', '#aa8a62', '#5a493a', '#dcc38b']
  };
  const PROFILES = Object.fromEntries(Object.entries(rows).map(([genre, [material, pattern, base, dark, accent]]) =>
    [genre, { material, pattern, base, dark, accent }]));
  function paint(ctx, genre, seed = '') {
    const p = PROFILES[genre]; if (!p) return false;
    let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    ctx.save(); ctx.scale(ctx.canvas.width / 32, ctx.canvas.height / 32); ctx.imageSmoothingEnabled = false;
    const rect = (x, y, w, z, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, z); };
    rect(0, 0, 32, 32, p.base);
    const vertical = ['rafters', 'hull', 'hide', 'pipes', 'cables'].includes(p.pattern);
    for (let i = 0; i < 32; i += vertical ? 8 : 16) {
      rect(i, 0, 1, 32, p.dark); rect(0, i, 32, 1, p.dark);
      if (['service', 'pressure', 'acoustic', 'patches'].includes(p.pattern)) {
        rect(i + 2, 2, 11, 11, p.dark); rect(i + 3, 3, 9, 9, p.base);
        rect(i + 3, 18, 10, 1, p.accent);
      }
    }
    if (['service', 'pressure', 'pipes', 'cables'].includes(p.pattern)) {
      for (const x of [5, 24]) { rect(x, 0, 3, 32, p.dark); rect(x + 1, 0, 1, 32, p.accent); }
      for (let y = 2; y < 32; y += 7) rect(12, y, 7, 2, p.accent);
    } else if (['coffers', 'deco', 'lattice'].includes(p.pattern)) {
      for (let y = 2; y < 32; y += 8) for (let x = 2; x < 32; x += 8) {
        rect(x, y, 5, 5, p.dark); rect(x + 1, y + 1, 3, 3, p.accent);
      }
    } else if (['ribs', 'trusses', 'fractures', 'greenhouse'].includes(p.pattern)) {
      for (let i = 0; i < 32; i++) {
        rect(i, i, 2, 2, p.dark); rect(31 - i, i, 1, 2, p.accent);
        if (p.pattern === 'greenhouse' && i % 4 === 0) rect(i, (i * 7) % 32, 3, 2, '#6f9b64');
      }
    } else {
      for (let y = 0; y < 32; y += 6) rect(0, y, 32, 2, p.dark);
      if (p.pattern === 'hide') for (let i = 0; i < 32; i += 3) rect(i, 15, 1, 3, p.accent);
    }
    for (let i = 0; i < 24; i++) { h = Math.imul(h ^ (h >>> 13), 1597334677); rect((h >>> 3) % 32, (h >>> 11) % 32, 1, 1, p.dark); }
    ctx.restore(); return true;
  }
  return { PROFILES, paint };
});
