'use strict';
const Pantheon = require('../../assets/pantheonCharacters');
// A stable identity contract, separate from per-line mood and cadence.
const VERSION = 2;
const hash32 = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const keyOf = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const bound = (value, fallback, min, max) => {
  const n = value === '' || value == null ? NaN : Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
};
const OVERRIDES = { mortacia: { f0: 205, fs: 1.04, alpha: 1, breath: 0.06, rasp: 0, range: 3, rate: 4.6, conf: 0.85,
  warm: 0.22, bright: 1.08, vibAmt: 0.2, vibRate: 5.2, pause: 0.95, pull: 0, accent: 1.6, decl: 1.7 } };
function normalize(P = {}) {
  P = { ...P, ...Pantheon.canon(P.name)?.voiceProfile };
  const name = String(P.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const base = { v: VERSION, name, kind: ['humanoid', 'regal', 'undead', 'beast'].includes(P.kind) ? P.kind : 'humanoid',
    f0: bound(P.f0, 130, 60, 320), fs: bound(P.fs, 1, 0.7, 1.35),
    // Retain the existing noise safety limits; distinctness must not come from more hiss.
    rasp: bound(P.rasp, 0, 0, 1) * 0.35, breath: bound(P.breath, 0, 0, 0.75) * 0.6,
    range: bound(P.range, 3.2, 1.2, 6), rate: bound(P.rate, 4.8, 2.4, 7),
    pause: bound(P.pauses ?? P.pause, 1, 0.65, 1.5), warm: bound(P.warm, 0, 0, 0.5),
    bright: bound(P.bright, 1, 0.75, 1.3), vibAmt: bound(P.vibAmt ?? (P.vib == null ? undefined : P.vib / 6), 1, 0, 2),
    vibRate: bound(P.vibRate, 5.2, 3, 9), fineKeep: bound(P.fineKeep, 0.8, 0.5, 1),
    scaleIdx: hash32(name + '#scale') % 5, pull: 0,
    accent: bound(P.accentStrength, 1.4 * bound(P.range, 3.2, 1.2, 6) / 3.2, 0.5, 2.8), decl: bound(P.decl, 2, 0.5, 3.5) };
  if (P.conf != null) base.conf = bound(P.conf, 0.1, -1, 1);
  if (typeof P.accent === 'string') base.accent_ = P.accent.slice(0, 30);
  if (typeof P.race === 'string') base.race = P.race.slice(0, 60);
  // Browser identities already include anatomy/kind. Do not lower them a second time here.
  return Object.assign(base, OVERRIDES[keyOf(name).split(' ')[0]] || {});
}
function fallback(name) {
  const r = i => (hash32(keyOf(name) + '#' + i) % 1000) / 1000;
  return normalize({ name, f0: 105 + r(1) * 110, fs: 0.94 + r(2) * 0.12,
    breath: 0.08 + r(5) * 0.1, rasp: r(6) * 0.2, range: 3.2, rate: 4.6 + r(9) });
}
module.exports = { VERSION, normalize, fallback, keyOf };
