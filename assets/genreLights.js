(function(root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GenreLights = api; })(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // world1 GENRE_LIGHTS: light types beyond the torch, fed into the renderer's existing torch-light list (same falloff
  // shader, shadows and occlusion). The existing torchFlicker is untouched; 'torch' maps straight to it.
  const kelvin = k => { const t = k / 100; let r, g, b; // compact colour-temperature approximation
    r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332; g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * (t - 60) ** -0.0755; b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); };
  const s = Math.sin, frac = v => v - Math.floor(v);
  // curve(seed 0..1, t seconds) -> intensity multiplier ~0..1.2
  const TYPES = {
    torch: { label: 'Torch', curve: null, radius: 1, falloff: 'torch', kelvin: 1900, genres: ['fantasy', 'dark-fantasy', 'mythic'], prop: 'torch', cotg: true },
    candle: { label: 'Candle cluster', curve: (q, t) => .78 + .1 * s(t * 7.3 + q * 9) + .06 * s(t * 17.1 + q * 3), radius: .55, falloff: 'soft', kelvin: 1800, genres: ['fantasy', 'dark-fantasy', 'cosmic-horror', 'mythic', 'western'], prop: 'g_candle_stand', cotg: true },
    rune_glow: { label: 'Rune glow', curve: (q, t) => .7 + .25 * (.5 + .5 * s(t * .9 + q * 6)), radius: .7, falloff: 'soft', color: '#7fd3c6', genres: ['fantasy', 'dark-fantasy'], prop: 'g_rune_stone', cotg: true },
    crystal_glow: { label: 'Crystal glow', curve: (q, t) => .8 + .15 * s(t * .6 + q * 4) + .05 * s(t * 2.3 + q), radius: .8, falloff: 'soft', color: '#b49ac8', genres: ['fantasy', 'dark-fantasy'], prop: 'g_crystal_lamp', cotg: true },
    brazier_moon: { label: 'Moonlit brazier', curve: (q, t) => .82 + .08 * s(t * 3.1 + q * 7) + .05 * s(t * 8.7 + q * 2), radius: 1.1, falloff: 'torch', kelvin: 4100, genres: ['mythic', 'fantasy', 'dark-fantasy'], prop: 'g_moon_brazier', cotg: true },
    eldritch_fantasy: { label: 'Eldritch witch-fire', curve: (q, t) => .6 + .35 * (.5 + .5 * s(t * .45 + q * 5)) ** 2, radius: .9, falloff: 'soft', color: '#5a9a88', genres: ['dark-fantasy'], prop: 'g_eldritch_obelisk', cotg: true },
    eldritch_breath: { label: 'Eldritch breathing glow', curve: (q, t) => .35 + .7 * (.5 + .5 * s(t * .35 + q * 6)) ** 3, radius: 1.2, falloff: 'soft', color: '#6a4a8a', genres: ['cosmic-horror'], prop: 'g_eldritch_obelisk' },
    fluorescent: { label: 'Fluorescent tube', curve: (q, t) => frac(t * .37 + q * 11) > .985 ? .25 : .95 + .03 * s(t * 120), radius: 1.3, falloff: 'linear', kelvin: 6500, genres: ['modern', 'cyberpunk', 'sci-fi'], prop: 'g_hanging_bulb' },
    neon_buzz: { label: 'Neon buzz', curve: (q, t) => (frac(t * .23 + q * 7) > .97 && s(t * 90) > 0 ? .3 : 1) * (.92 + .05 * s(t * 60)), radius: 1, falloff: 'soft', color: '#e8c8f0', genres: ['cyberpunk', 'modern'], prop: 'g_neon_sign' },
    arc_spark: { label: 'Arc lamp', curve: (q, t) => .9 + (frac(s(Math.floor(t * 9 + q * 50)) * 43758) > .93 ? .5 : 0) + .04 * s(t * 50), radius: 1.2, falloff: 'linear', kelvin: 5600, genres: ['steampunk'], prop: 'g_arc_lamp', sparks: true },
    oil_lantern: { label: 'Oil lantern', curve: (q, t) => .75 + .12 * s(t * 2.2 + q * 8) + .06 * s(t * 5.9 + q * 3), radius: .85, falloff: 'torch', kelvin: 2200, genres: ['western', 'nautical', 'steampunk'], prop: 'lantern', sway: true },
    beacon_rotating: { label: 'Rotating beacon', curve: (q, t) => .2 + .9 * Math.max(0, s(t * 2.4 + q * 6)) ** 6, radius: 1.6, falloff: 'linear', color: '#e0542a', genres: ['sci-fi', 'nautical'], prop: 'g_beacon_post' },
    emergency_strobe: { label: 'Emergency strobe', curve: (q, t) => frac(t * 1.5 + q) < .08 ? 1.2 : .15, radius: 1.4, falloff: 'linear', color: '#e0542a', genres: ['sci-fi'], prop: 'g_beacon_post' },
    sodium_sick: { label: 'Failing sodium lamp', curve: (q, t) => .55 + .2 * s(t * .7 + q * 3) + (frac(t * .11 + q * 9) > .95 ? -.4 : 0), radius: 1.3, falloff: 'linear', kelvin: 2000, color: '#e0c37a', genres: ['post-apocalyptic'], prop: 'g_street_lamp' },
    dying_flashlight: { label: 'Dying flashlight', curve: (q, t) => Math.max(.1, .65 + .2 * s(t * 13 + q) - (frac(t * .19 + q * 5) > .9 ? .5 : 0)), radius: .9, falloff: 'linear', kelvin: 3200, genres: ['post-apocalyptic', 'cosmic-horror'], prop: 'flashlight' },
    blind_shafts: { label: 'Venetian-blind shafts', curve: () => 1, radius: 1.5, falloff: 'linear', kelvin: 5200, genres: ['noir'], prop: 'g_blind_window', shafts: 5 },
    bulb_sway: { label: 'Swaying bare bulb', curve: (q, t) => .85 + .05 * s(t * 8 + q), radius: 1.1, falloff: 'torch', kelvin: 2700, genres: ['noir'], prop: 'g_hanging_bulb', sway: true }
  };
  for (const t of Object.values(TYPES)) t.color ||= kelvin(t.kelvin);
  const FALLOFF = { torch: 1, soft: 1.15, linear: .9 };
  // Record for the renderer's torch list. base = renderer's TORCH_LIGHT_RADIUS_FLOOR; torchFlicker passed in so 'torch' is unchanged.
  function light(type, x, y, z, seed, nowMs, base, torchFlicker) {
    const T = TYPES[type] || TYPES.torch, t = nowMs / 1000;
    let ox = 0, oy = 0; if (T.sway) { ox = .08 * s(t * 1.3 + seed * 4); oy = .05 * s(t * 1.7 + seed * 2); }
    const k = T.curve ? T.curve(seed, t) : torchFlicker ? torchFlicker(seed, nowMs) : .8;
    return { x: x + ox, y: y + oy, z, radius: base * T.radius * FALLOFF[T.falloff], intensity: Math.max(.05, Math.min(1.25, k)), lightType: type, color: T.color };
  }
  const forGenre = g => Object.entries(TYPES).filter(([, t]) => t.genres.includes(g)).map(([k]) => k);
  const COTG_TAGS = Object.keys(TYPES).filter(k => TYPES[k].cotg);
  // Sample a curve for previews/tests.
  const sample = (type, seed = .3, seconds = 4, n = 80) => Array.from({ length: n }, (_, i) => light(type, 0, 0, 0, seed, i * seconds * 1000 / n, 1, null).intensity);
  return { TYPES, light, forGenre, sample, kelvin, COTG_TAGS };
});
