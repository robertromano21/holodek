'use strict';
// World-interaction SID effects (same DSL as effects.js): concealed doors, gear, puzzle mechanisms, quest stingers.
module.exports = ({ shot, midi, ad, sr, rng }) => {
  const off = { gate: 0 }, expl = (a, b, x) => a * Math.pow(b / a, Math.max(0, Math.min(1, x)));

  // concealed door: stone grinding rumble rising with the slab, ring-mod shimmer as the passage opens, settling thunk
  { const r = rng(23); let w = 0; shot('secret_door', 120, t => {
    w += (r() - 0.5) * 60; w *= 0.9; const grind = t < 90;
    return { v: [
      { hz: 520 + w, wave: 'noise', gate: grind, ad: ad(6, 9), sr: sr(11, 6) },
      { hz: expl(48, 72, t / 90) * (1 + Math.sin(t * 0.7) * 0.02), wave: 'pulse', pw: 600 + t * 20, gate: grind, ad: ad(7, 9), sr: sr(12, 6) },
      t < 100 ? { hz: midi(62 + [0, 3, 7, 10, 12, 15][Math.min(5, Math.max(0, (t - 40) >> 3))]), wave: 'tri', ring: true, gate: t > 40 && t < 96, ad: ad(4, 8), sr: sr(9, 9) }
              : { hz: expl(160, 40, (t - 100) / 12), wave: 'pulse', pw: 2048, gate: t < 104, ad: ad(0, 9), sr: sr(0, 9) }],
      f: { cut: grind ? 380 + Math.sin(t * 0.33) * 120 + t * 4 : 260, res: 10, route: 3, mode: 'lp', vol: 15 } }; }); }

  // concealed door noticed: soft falling-then-rising glass whisper
  { const n = [81, 77, 84, 88]; shot('secret_reveal', 30, t => ({ v: [
    { hz: midi(n[Math.min(3, t >> 3)]), wave: 'tri', ring: true, gate: t < 24, ad: ad(2, 7), sr: sr(7, 8) },
    { hz: midi(n[Math.min(3, t >> 3)] - 12) * 1.003, wave: 'tri', gate: t > 2 && t < 24, ad: ad(3, 7), sr: sr(5, 8) }, off] })); }

  // equip: blade/armour slides into place, bright metallic clink and a firm seat
  shot('equip', 18, t => ({ v: [
    { hz: expl(1800, 4200, t / 6), wave: 'noise', gate: t < 6, ad: ad(2, 5), sr: sr(4, 4) },
    { hz: 1250, wave: 'tri', ring: true, gate: t >= 6 && t < 9, ad: ad(0, 8), sr: sr(0, 8) },
    { hz: t < 6 ? 940 : expl(220, 90, (t - 6) / 6), wave: t < 6 ? 'tri' : 'pulse', pw: 1800, gate: t >= 6 && t < 9, ad: ad(0, 6), sr: sr(0, 6) }],
    f: { cut: t < 6 ? 1500 + t * 300 : 2600, res: 7, route: 1, mode: 'bp', vol: 15 } }));

  // unequip: the reverse, a falling unclasp and a lower, softer clink
  shot('unequip', 16, t => ({ v: [
    { hz: 830, wave: 'tri', ring: true, gate: t < 3, ad: ad(0, 7), sr: sr(0, 7) },
    { hz: expl(3600, 1200, t / 10), wave: 'noise', gate: t >= 2 && t < 10, ad: ad(3, 5), sr: sr(3, 4) },
    { hz: expl(330, 150, t / 10), wave: 'tri', gate: t < 4, ad: ad(0, 6), sr: sr(0, 6) }],
    f: { cut: expl(2400, 700, t / 12), res: 6, route: 2, mode: 'bp', vol: 14 } }));

  // drop: item hits the floor, dull thud with a small rattle bounce
  shot('drop', 16, t => ({ v: [
    { hz: expl(180, 55, t / 6), wave: 'tri', gate: t < 3, ad: ad(0, 7), sr: sr(0, 6) },
    { hz: 1400, wave: 'noise', gate: t < 1 || (t >= 6 && t < 7) || (t >= 10 && t < 11), ad: ad(0, 4), sr: sr(0, 3) }, off],
    f: { cut: 700, res: 5, route: 2, mode: 'lp', vol: 15 } }));

  // puzzle control moved: crisp mechanical click-clack
  shot('puzzle_click', 9, t => ({ v: [
    { hz: 2200, wave: 'pulse', pw: 300, gate: t < 1 || (t >= 3 && t < 4), ad: ad(0, 4), sr: sr(0, 3) },
    { hz: 1600, wave: 'noise', gate: t < 1 || (t >= 3 && t < 4), ad: ad(0, 4), sr: sr(0, 3) },
    { hz: expl(140, 90, t / 6), wave: 'pulse', pw: 2048, gate: t >= 3 && t < 5, ad: ad(0, 5), sr: sr(0, 4) }],
    f: { cut: 1900, res: 9, route: 3, mode: 'bp', vol: 14 } }));

  // ordered puzzle sequence broken: ratchet unwinding downward
  shot('puzzle_reset', 26, t => ({ v: [
    { hz: expl(1400, 300, t / 22), wave: 'pulse', pw: 500, gate: t % 3 === 0 && t < 22, ad: ad(0, 3), sr: sr(0, 2) },
    { hz: expl(260, 70, t / 24), wave: 'saw', gate: t < 20, ad: ad(2, 8), sr: sr(6, 7) }, off],
    f: { cut: expl(1800, 300, t / 24), res: 8, route: 3, mode: 'lp', vol: 14 } }));

  // puzzle solved: accelerating ratchet, a deep unlock clunk, then a radiant rising chord
  { const ch = [[57, 64, 69], [60, 67, 72], [64, 69, 76], [69, 76, 81]]; shot('puzzle_solve', 96, t => {
    if (t < 30) { const tick = [0, 6, 11, 15, 19, 22, 25, 27, 29].includes(t);
      return { v: [{ hz: 1700, wave: 'pulse', pw: 400, gate: tick, ad: ad(0, 3), sr: sr(0, 2) }, { hz: 900, wave: 'noise', gate: tick, ad: ad(0, 3), sr: sr(0, 2) }, off], f: { cut: 2000, res: 8, route: 3, mode: 'bp', vol: 15 } }; }
    if (t < 40) return { v: [{ hz: expl(140, 38, (t - 30) / 10), wave: 'pulse', pw: 2048, gate: t < 34, ad: ad(0, 9), sr: sr(0, 9) }, { hz: 600, wave: 'noise', gate: t < 33, ad: ad(0, 8), sr: sr(0, 8) }, off], f: { cut: 500, res: 6, route: 3, mode: 'lp', vol: 15 } };
    const c = ch[Math.min(3, (t - 40) >> 3)], g = t < 88;
    return { v: c.map((n, i) => ({ hz: midi(n) * (1 + i * 0.002), wave: i === 0 ? 'pulse' : 'tri', pw: 1400, gate: g, ad: ad(2, 8), sr: sr(10, 9) })) }; }); }

  // new quest: two solemn horn calls, rising a fourth
  shot('quest_accept', 48, t => { const n = t < 20 ? 55 : 60, g = (t < 16) || (t >= 20 && t < 42);
    return { v: [
      { hz: midi(n), wave: 'pulse', pw: 900 + Math.sin(t * 0.4) * 300, gate: g, ad: ad(4, 6), sr: sr(10, 7) },
      { hz: midi(n + 7) * 1.002, wave: 'saw', gate: g, ad: ad(5, 6), sr: sr(8, 7) },
      { hz: midi(n - 12), wave: 'tri', gate: g, ad: ad(3, 6), sr: sr(10, 7) }],
      f: { cut: 900 + Math.sin(t * 0.25) * 300, res: 5, route: 3, mode: 'lp', vol: 15 } }; });

  // quest fulfilled: triumphant rising fanfare that lands on a held major chord
  { const seq = [[55, 59, 62], [60, 64, 67], [62, 66, 69], [67, 71, 74]]; shot('quest_fanfare', 110, t => {
    const k = Math.min(3, Math.floor(t / 12)), c = seq[k], g = k < 3 ? (t % 12) < 9 : t < 100;
    return { v: c.map((n, i) => ({ hz: midi(n + (i === 2 && k === 3 ? 12 : 0)) * (1 + Math.sin(t * 0.6) * 0.003), wave: i === 0 ? 'pulse' : i === 1 ? 'saw' : 'tri', pw: 1100 + t * 8, gate: g, ad: ad(1, 7), sr: sr(11, 9) })),
      f: { cut: 700 + Math.min(1800, t * 22), res: 6, route: 7, mode: 'lp', vol: 15 } }; }); }

  // potion: cork pop and three gulps
  shot('potion', 34, t => ({ v: [
    { hz: 2600, wave: 'noise', gate: t < 1, ad: ad(0, 4), sr: sr(0, 3) },
    { hz: expl(320, 180, (t % 9) / 7) , wave: 'tri', gate: t > 4 && (t - 5) % 9 < 5 && t < 32, ad: ad(1, 5), sr: sr(4, 4) }, off],
    f: { cut: 900, res: 10, route: 2, mode: 'lp', vol: 14 } }));
};
