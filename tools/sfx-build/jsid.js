'use strict';
// jsid: compact multi-SID emulation in JS (sample-rate, 8580-style), meant to run in an AudioWorklet in the browser.
// Per chip: 3 voices (24-bit phase accumulator, 12-bit saw/triangle/pulse, 23-bit LFSR noise clocked from accumulator
// bit 19, ADSR with SID rate table + exponential decay), one multimode state-variable filter (cutoff 11-bit, 4-bit
// resonance, LP/BP/HP, routing, voice-3-off), 4-bit master volume. Registers are written exactly like $D400-$D418.
const CLK = 985248;
const ATT = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000]; // ms (decay/release x3)
const CAL = [[0, 30], [60, 389], [100, 630], [150, 1015], [220, 1455], [300, 2200], [400, 2653], [550, 3541], [700, 5085], [900, 6181], [1100, 7877], [1400, 8999], [1700, 10627], [2047, 12000]];
function cutHz(r) { for (let i = 1; i < CAL.length; i++) if (r <= CAL[i][0]) { const [r0, f0] = CAL[i - 1], [r1, f1] = CAL[i]; return f0 + (f1 - f0) * (r - r0) / (r1 - r0); } return 12000; }
class Chip {
  constructor(sr, opt = {}) { this.clk = opt.clk || CLK; this.cut = opt.cut || 1; this.sr = sr; this.r = new Uint8Array(32); this.v = [0, 1, 2].map(() => ({ acc: 0, lfsr: 0x7ffff8, env: 0, st: 0, gate: 0, prevBit: 0 }));
    this.lp = 0; this.bp = 0; this.inc = this.clk / sr; }
  write(a, x) { const old = this.r[a]; this.r[a] = x; if (a % 7 === 4 && a < 21) { const v = this.v[(a / 7) | 0], g = x & 1; if (g && !(old & 1)) v.st = 1; if (!g && (old & 1)) v.st = 3; } }
  render(out, n, gain) {
    const r = this.r, sr = this.sr, vol = (r[24] & 15) / 15, mode = r[24] >> 4, route = r[23] & 7, res = r[23] >> 4, v3off = mode & 8;
    if (vol === 0) { // still advance oscillators/envelopes cheaply
      for (let i = 0; i < 3; i++) { const v = this.v[i]; v.acc = (v.acc + (r[i * 7] | r[i * 7 + 1] << 8) * this.inc * n) % 16777216; this.envStep(v, i, n / sr); } this.lp *= 0.9; this.bp *= 0.9; return; }
    const creg = r[21] & 7 | r[22] << 3, fc = Math.min(sr * (this.cut >= 4 ? 0.3 : 0.22), cutHz(creg) * (1 + (this.cut - 1) * creg / 2047)), /* enhanced: low cutoffs as stock, top of range opens x cut */ w = 2 * Math.sin(Math.PI * fc / sr / 2), q = 1 / (0.707 + res / 15); // 2x oversampled SVF
    const fr = [], pw = [], wf = [], env = [];
    for (let i = 0; i < 3; i++) { fr.push((r[i * 7] | r[i * 7 + 1] << 8) * this.inc); pw.push((r[i * 7 + 2] | (r[i * 7 + 3] & 15) << 8)); wf.push(r[i * 7 + 4] >> 4); }
    let lp = this.lp, bp = this.bp;
    for (let s = 0; s < n; s++) {
      let fin = 0, dir = 0;
      for (let i = 0; i < 3; i++) { const u = this.v[i]; u.wrapped = u.acc + fr[i] >= 16777216; }
      for (let i = 0; i < 3; i++) {
        const v = this.v[i], ctl = r[i * 7 + 4], mod = this.v[(i + 2) % 3]; if (wf[i] === 0) continue; if (s === 0) this.envStep(v, i, n / sr); const e = v.env; if (e <= 0.0001) { v.acc = (v.acc + fr[i]) % 16777216; continue; }
        const prev = v.acc; v.acc = (v.acc + fr[i]) % 16777216; let o;
        if ((ctl & 2) && mod.wrapped) v.acc = 0; // hard sync: reset when the modulating voice's accumulator wraps
        if (wf[i] & 8) { if (((prev >> 19) & 1) === 0 && ((v.acc >> 19) & 1) === 1) { const b = ((v.lfsr >> 22) ^ (v.lfsr >> 17)) & 1; v.lfsr = ((v.lfsr << 1) | b) & 0x7fffff; }
          const L = v.lfsr; o = ((L >> 22 & 1) << 11 | (L >> 20 & 1) << 10 | (L >> 16 & 1) << 9 | (L >> 13 & 1) << 8 | (L >> 11 & 1) << 7 | (L >> 7 & 1) << 6 | (L >> 4 & 1) << 5 | (L >> 2 & 1) << 4); }
        else if (wf[i] & 4) o = (v.acc >> 12) >= pw[i] ? 4095 : 0;
        else if (wf[i] & 2) o = v.acc >> 12;
        else { const msb = (v.acc ^ ((ctl & 4) ? mod.acc : 0)) & 0x800000; const a = msb ? ~v.acc & 0x7fffff : v.acc & 0x7fffff; o = a >> 11; } // ring mod: MSB xor modulator MSB
        const x = (o - 2048) / 2048 * e;
        if (route >> i & 1) fin += x; else if (!(i === 2 && v3off)) dir += x;
      }
      let y = 0; for (let k = 0; k < 2; k++) { const hp = fin - lp - q * bp; bp += w * hp; lp += w * bp; if (k) y = (mode & 1 ? lp : 0) + (mode & 2 ? bp : 0) + (mode & 4 ? hp : 0); }
      out[s] += (y + dir) * vol * gain;
    }
    this.lp = lp; this.bp = bp;
  }
  envStep(v, i, dt) { // SID ADSR: linear attack, exponential decay/release toward sustain/0
    const ad = this.r[i * 7 + 5], srr = this.r[i * 7 + 6], A = ATT[ad >> 4] / 1000, D = ATT[ad & 15] * 3 / 1000, S = (srr >> 4) / 15, R = ATT[srr & 15] * 3 / 1000;
    if (v.st === 1) { v.env += dt / A; if (v.env >= 1) { v.env = 1; v.st = 2; } }
    else if (v.st === 2) v.env = S + (v.env - S) * Math.exp(-dt * 4 / D);
    else if (v.st === 3) { v.env *= Math.exp(-dt * 4 / R); if (v.env < 0.0005) { v.env = 0; v.st = 0; } }
  }
}
class MultiSid {
  constructor(nChips, sr = 22050, opt = {}) { this.sr = sr; this.chips = Array.from({ length: nChips }, () => new Chip(sr, opt)); } // opt.clk: chip clock (stock PAL 985248); opt.cut: filter cutoff scale
  write(c, a, x) { this.chips[c].write(a, x); }
  // ticks: function(n) -> [[chip, reg, val], ...]; hz: register update rate
  render(nTicks, hz, ticks) {
    const per = Math.round(this.sr / hz), out = new Float32Array(nTicks * per), g = 0.5 / Math.sqrt(this.chips.length);
    for (let n = 0; n < nTicks; n++) { for (const [c, a, x] of ticks(n)) this.write(c, a, x);
      const buf = out.subarray(n * per, (n + 1) * per); for (const ch of this.chips) ch.render(buf, per, g); }
    return out;
  }
}
module.exports = { MultiSid, Chip, cutHz, CLK };
