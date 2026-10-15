'use strict';
// Short-window analysis supplies spectral controls for SID noise/resonators.
// No source samples or reconstructed PCM are mixed into the output.
const HZ = 400, STOP = /^[ptkbdg\u0261]$/, FRIC = /^[szfvh\u0283\u0292\u03b8\u00f0]$/;
function plan(frames, phones) {
  const n = frames.length, mix = new Float32Array(n), bursts = [];
  let peak = 1e-9; for (const f of frames) peak = Math.max(peak, f.rms);
  const at = t => Math.max(0, Math.min(n, Math.round(t * HZ)));
  const mark = (a, b) => { for (let i = a; i < b; i++) {
    const edge = Math.min(1, (i - a + 1) / 2, (b - i) / 2);
    const audible = Math.min(1, Math.max(0, frames[i].rms / (peak * 0.012) - 0.5));
    mix[i] = Math.max(mix[i], edge * audible);
  } };
  for (const p of phones || []) {
    if (!(p.t1 > p.t0) || p.c === ' ') continue;
    if (FRIC.test(p.c)) { mark(at(p.t0), at(p.t1)); continue; }
    if (!STOP.test(p.c)) continue;
    const a = at(p.t0), b = at(p.t1 + 0.005); if (b <= a) continue;
    let best = -Infinity, release = -1;
    for (let i = Math.max(1, a); i < b; i++) {
      if (frames[i].rms < peak * 0.008) continue;
      const rise = Math.log(frames[i].high + 1e-12) - Math.log(frames[i - 1].high + 1e-12);
      if (rise > best) { best = rise; release = i; }
    }
    // Do not invent a burst in silence or a steady vowel when no release was measured.
    if (release < 0 || best < 0.25) continue;
    const end = Math.min(n, release + 8, at(p.t1 + 0.015));
    mark(release, end); bursts.push([release, end]);
  }
  return { mix, bursts };
}
function frameAt(frames, control, x, harmonic) {
  const i = Math.min(frames.length - 1, Math.max(0, Math.floor(x))), j = Math.min(frames.length - 1, i + 1), u = Math.max(0, Math.min(1, x - i));
  const weight = control.mix[i] * (1 - u) + control.mix[j] * u;
  if (!(weight > 0) || x >= frames.length) return harmonic;
  const a = frames[i].env, b = frames[j].env;
  const env = harmonic[1].map((v, k) => v + weight * (a[k] * (1 - u) + b[k] * u - v));
  return [harmonic[0], env, harmonic[2]];
}
module.exports = { plan, frameAt };
