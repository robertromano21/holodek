'use strict';
const { Chip, CLK } = require('./sidVoice/jsid');
const VERSION = 2;
const PROFILES = {
  reed_resonance: { ratio: 2, center: 850, width: 180, level: 30 },
  spectral_choir: { ratio: 1, center: 620, width: 140, level: 34 },
  glass_halo: { ratio: 3, center: 1900, width: 100, level: 26 },
  ember_air: { ratio: 2, center: 1100, width: 240, level: 24 }
};
const MOTION = ['still', 'breath', 'phrase'];
const DEPTHS = [.15, .25, .4];
const TRANSIENTS = ['off', 'soft', 'crisp'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function validate(p) {
  if (!p || !Object.hasOwn(PROFILES, p.profile) || !MOTION.includes(p.motion) ||
      !DEPTHS.includes(p.depth) || !TRANSIENTS.includes(p.transients)) throw Error('extensions: choose a supported profile, motion, depth and transients enum.');
  return p;
}
function paletteFor(song) {
  const selected = song.composition?.acceptedPlan?.extensions || song.extensions;
  if (selected) return { ...validate(selected), source: 'llm-plan' };
  const patch = song.composition?.acceptedPlan?.leadPatch || '', mood = song.plan?.mood || '';
  return { profile: /bell|glass|chime/.test(patch) ? 'glass_halo' : /sacred/.test(mood) ? 'spectral_choir' :
    /saw/.test(patch) ? 'ember_air' : 'reed_resonance', motion: 'phrase', depth: .25,
    transients: song.composition?.acceptedPlan?.percussion === 'none' ? 'off' : 'soft', source: 'legacy-patch-translation' };
}
// Return a companion layer only: the proven dry three-voice arrangement is untouched.
class Layer {
  constructor(sampleRate, mult, palette, trace = []) {
    this.chip = new Chip(sampleRate, { model: '10582', clk: CLK * mult, cut: mult, aa: true });
    this.palette = validate(palette); this.preset = PROFILES[palette.profile]; this.trace = trace; this.used = new Set();
    this.clock = CLK * mult; this.gain = 0; this.last = new Map(); this.previousBurst = false;
    this.dcX = 0; this.dcY = 0; this.dcR = Math.exp(-2*Math.PI*20/sampleRate);
    this.write(24, 15, 0); this.write(25, 0, 0); this.write(26, 0, 0); this.write(27, 0, 0);
    this.write(28, 7, 0); this.write(4, 0x21, 0); this.write(18, 0x80, 0);
    this.write(14, 0, 0); this.write(15, 24, 0); this.write(29, 0x42, 0);
  }
  write(reg, value, time, strobe = false) {
    value = clamp(Math.round(value), 0, 255);
    if (!strobe && this.last.get(reg) === value) return;
    this.last.set(reg, value); this.chip.write(reg, value); this.used.add(reg);
    if (this.trace.length < 2000) this.trace.push([+time.toFixed(4), reg, value]);
  }
  frame({ time, frequency = 0, gate = false, envelope = 0, noise = false, bar = 0 }) {
    const p = this.palette, q = this.preset;
    const motion = p.motion === 'breath' ? .5 + .5 * Math.sin(time * .7) : p.motion === 'phrase' ? .5 - .5 * Math.cos(bar * Math.PI / 4) : .5;
    const target = gate ? clamp(envelope, 0, 1) : 0;
    this.gain += (target - this.gain) * (target > this.gain ? .3 : .12);
    const f = clamp(Math.round(frequency * 16777216 / this.clock), 0, 65535);
    this.write(0, f & 255, time); this.write(1, f >> 8, time);
    const center = clamp(frequency * q.ratio + q.center * (.75 + .5 * motion), 150, 7000);
    this.write(31, 1 | (p.profile === 'ember_air' ? 4 : 0), time);
    this.write(32, Math.round(center) & 255, time); this.write(33, Math.round(center) >> 8, time);
    this.write(34, q.width / 4, time); this.write(35, q.level * this.gain, time);
    // This notch shapes only the companion, never the traditional dry signal.
    const notch = Math.round(center * 1.8);
    this.write(36, 1, time); this.write(37, notch & 255, time); this.write(38, notch >> 8, time);
    this.write(39, 180, time); this.write(40, 0, time); this.write(41, 180, time);
    const burst = noise && p.transients !== 'off';
    this.write(28, burst ? 3 : 7, time); this.write(27, burst ? (p.transients === 'crisp' ? 36 : 18) : 0, time);
    const trigger = burst && !this.previousBurst;
    this.write(30, burst ? 4 | (trigger ? 64 : 0) : 0, time, trigger);
    this.previousBurst = burst;
  }
  render(out) {
    this.chip.render(out, out.length, this.palette.depth);
    for(let i=0;i<out.length;i++){
      const x=out[i], y=x-this.dcX+this.dcR*this.dcY;
      this.dcX=x;this.dcY=y;out[i]=y;
    }
  }
  report() { return { version: VERSION, model: '10582', architecture: 'additive-register-layer', palette: this.palette,
    registers: [...this.used].sort((a,b) => a-b), tracePreview: this.trace, traceTruncated: this.trace.length === 2000 }; }
}
module.exports = { VERSION, PROFILES, MOTION, DEPTHS, TRANSIENTS, validate, paletteFor, Layer };
