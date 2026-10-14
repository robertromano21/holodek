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
  constructor(sr, opt = {}) { this.dc = opt.model === '6581' ? 0.8 : opt.model === '8580' ? 0.03 : 0; this.aa = !!opt.aa; this.clk = opt.clk || CLK; this.cut = opt.cut || 1; this.sr = sr; this.x = opt.model === '10582'; this.r = new Uint8Array(this.x ? 64 : 32); if (this.x) { this.r[25] = this.r[26] = this.r[27] = 255; this.fe = [0, 0, 0]; this.fph = [0, 0, 0]; this.fy1 = 0; this.fy2 = 0; this.fdc = 0; this.nm = 0; this.nz = [0, 0, 0, 0]; } this.v = [0, 1, 2].map(() => ({ acc: 0, lfsr: 0x7ffff8, env: 0, st: 0, gate: 0, prevBit: 0, hold: 2048, lastO: 2048 })); this.sched = []; this.holdTau = opt.model === '6581' ? 0.05 : 0.8; // waveform-0 floating-DAC hold decay (s)
    this.lp = 0; this.bp = 0; this.inc = this.clk / sr; }
  write(a, x) { if (a >= 25 && !this.x) return; /* stock SID: $19-$1C are read-only, nothing above $1C */ const old = this.r[a]; this.r[a] = x;
    if (this.x && a === 30) { for (let i = 0; i < 3; i++) if (x >> (4 + i) & 1) this.fph[i] = 1; this.r[30] = x & 0x0f; } /* 10582: FENV trigger strobes self-clear */ if (a % 7 === 4 && a < 21) { const v = this.v[(a / 7) | 0], g = x & 1; if (x & 8) v.acc = 0; /* TEST bit: oscillator reset & held */ if (g && !(old & 1)) v.st = 1; if (!g && (old & 1)) v.st = 3; } }
  // cycle-exact write inside the next render call: applied when the chip clock reaches `cyc` cycles after the call starts
  writeAt(a, x, cyc) { this.sched.push({ a, x, cyc }); }
  render(out, n, gain) {
    const r = this.r, sr = this.sr, vol = (r[24] & 15) / 15, mode = r[24] >> 4, route = r[23] & 7, res = r[23] >> 4, v3off = mode & 8;
    if (vol === 0) { // still advance oscillators/envelopes cheaply
      for (let i = 0; i < 3; i++) { const v = this.v[i]; v.acc = (v.acc + (r[i * 7] | r[i * 7 + 1] << 8) * this.inc * n) % 16777216; this.envStep(v, i, n / sr); } this.lp *= 0.9; this.bp *= 0.9; return; }
    const creg = r[21] & 7 | r[22] << 3, fc = Math.min(sr * (this.cut >= 4 ? 0.3 : 0.22), cutHz(creg) * (1 + (this.cut - 1) * creg / 2047)), /* enhanced: low cutoffs as stock, top of range opens x cut */ w = 2 * Math.sin(Math.PI * fc / sr / 2), q = 1 / (0.707 + res / 15); // 2x oversampled SVF
    const fr = [], pw = [], wf = [], env = [];
    for (let i = 0; i < 3; i++) { fr.push((r[i * 7] | r[i * 7 + 1] << 8) * this.inc); pw.push((r[i * 7 + 2] | (r[i * 7 + 3] & 15) << 8)); wf.push(r[i * 7 + 4] >> 4); }
    for (const v of this.v) v.acc0 = v.acc;
    let lp = this.lp, bp = this.bp;
    const X = this.x, LV = X ? [r[25] / 255, r[26] / 255, r[27] / 255] : null, MU = X ? r[28] : 0, FEN = X ? r[30] & 7 : 0, fA = X ? 1 / (((r[29] & 15) + 1) * 0.0005 * sr) : 0, fD = X ? Math.exp(-1 / (((r[29] >> 4) + 1) * 0.002 * sr / 2.3)) : 0;
    const FM = X && (r[31] & 1) && !(MU & 8) && r[35] > 0, fHz = X ? r[32] | r[33] << 8 : 0, fbw = X ? Math.max(20, r[34] * 4) : 0, fRt = FM ? Math.exp(-Math.PI * fbw / sr) : 0, fW = FM ? 2 * Math.PI * Math.min(fHz, sr * 0.45) / sr : 0, fC1 = 2 * fRt * Math.cos(fW), fC2 = -fRt * fRt, fB0 = Math.sin(fW) || 1e-3, fL = X ? r[35] / 255 : 0, fSrc = X ? (r[31] >> 1) & 3 : 0, fDiv = X ? ((r[31] >> 5) & 3) + 1 : 1, fFilt = X && (r[31] & 16);
    let fy1 = X ? this.fy1 : 0, fy2 = X ? this.fy2 : 0;
    const NE = X && (r[36] & 1), NA = X && (NE || this.nm > 0); let nb0 = 0, nb1 = 0, nb2 = 0, na1 = 0, na2 = 0, nm = X ? this.nm : 0; const nst = 1 / (0.001 * sr), nz = X ? this.nz : null; /* 10582 output notch ($24-$29): peaking biquad on the chip's final sum, gain at center = depth; 1 ms wet/dry ramp */
    if (NA) { const nf = Math.max(50, Math.min(sr * 0.45, r[37] | r[38] << 8)), nwd = Math.max(20, r[39] | r[40] << 8), dp = Math.max(1e-3, r[41] / 255), A = Math.sqrt(dp), w0 = 2 * Math.PI * nf / sr, al = Math.sin(w0) / (2 * nf / nwd), cs = Math.cos(w0), a0 = 1 + al / A; nb0 = (1 + al * A) / a0; nb1 = -2 * cs / a0; nb2 = (1 - al * A) / a0; na1 = nb1; na2 = (1 - al / A) / a0; }
    for (let s = 0; s < n; s++) {
      let fin = 0, dir = 0;
      if (s === 0) for (let i = 0; i < 3; i++) this.envStep(this.v[i], i, n / sr); // envelope counts first (also while a scheduled write later drops GATE)
      if (this.sched.length) { const cEnd = (s + 1) * this.inc; for (let q = 0; q < this.sched.length; q++) { const w0 = this.sched[q]; if (w0.cyc > cEnd) continue;
          const vi = (w0.a / 7) | 0, v = this.v[vi]; if (w0.a % 7 === 4 && w0.a < 21) { // exact accumulator at the write cycle
            const F = r[vi * 7] | r[vi * 7 + 1] << 8; if (!(r[w0.a] & 8)) v.acc = (v.acc0 + F * w0.cyc) % 16777216; const a = (v.acc & 0x800000) ? ~v.acc & 0x7fffff : v.acc & 0x7fffff; v.hold = a >> 11; v.held = 1; }
          this.write(w0.a, w0.x); wf[vi] = r[vi * 7 + 4] >> 4; fr[vi] = (r[vi * 7] | r[vi * 7 + 1] << 8) * this.inc; this.sched.splice(q--, 1); } }
      for (let i = 0; i < 3; i++) { const u = this.v[i]; u.wrapped = u.acc + fr[i] >= 16777216; }
      for (let i = 0; i < 3; i++) {
        const v = this.v[i], ctl = r[i * 7 + 4], mod = this.v[(i + 2) % 3]; const e = v.env;
        if (wf[i] === 0) { if (e > 0.0001 && v.held) { v.hold = 2048 + (v.hold - 2048) * Math.exp(-1 / (sr * this.holdTau)); const x = (v.hold - 2048) / 2048 * e; if (route >> i & 1) fin += x; else if (!(i === 2 && v3off)) dir += x; } continue; } // no waveform selected: DAC holds last level if (e <= 0.0001) { v.acc = (v.acc + fr[i]) % 16777216; continue; }
        const prev = v.acc; v.acc = (ctl & 8) ? 0 : (v.acc + fr[i]) % 16777216; let o;
        if ((ctl & 2) && mod.wrapped) v.acc = 0; // hard sync: reset when the modulating voice's accumulator wraps
        if (wf[i] & 8) { if (((prev >> 19) & 1) === 0 && ((v.acc >> 19) & 1) === 1) { const b = ((v.lfsr >> 22) ^ (v.lfsr >> 17)) & 1; v.lfsr = ((v.lfsr << 1) | b) & 0x7fffff; }
          const L = v.lfsr; o = ((L >> 22 & 1) << 11 | (L >> 20 & 1) << 10 | (L >> 16 & 1) << 9 | (L >> 13 & 1) << 8 | (L >> 11 & 1) << 7 | (L >> 7 & 1) << 6 | (L >> 4 & 1) << 5 | (L >> 2 & 1) << 4); }
        else if (wf[i] & 4) { if (this.aa && !(ctl & 8)) { // box-filtered pulse: fraction of this sample's accumulator sweep spent above the PW threshold (needed for PWM digi)
            const T = pw[i] * 4096, a0 = prev, a1 = prev + fr[i]; let hi = 0; if (a1 <= 16777216) hi = Math.max(0, a1 - Math.max(a0, T)); else hi = Math.max(0, 16777216 - Math.max(a0, T)) + Math.max(0, a1 - 16777216 - T);
            o = 4095 * Math.min(1, hi / Math.max(1, fr[i])); } else o = (v.acc >> 12) >= pw[i] ? 4095 : 0; }
        else if (wf[i] & 2) o = v.acc >> 12;
        else { const msb = (v.acc ^ ((ctl & 4) ? mod.acc : 0)) & 0x800000; const a = msb ? ~v.acc & 0x7fffff : v.acc & 0x7fffff; o = a >> 11; } // ring mod: MSB xor modulator MSB
        let x = (o - 2048) / 2048 * e;
        if (X) { if (FEN >> i & 1) { const p = this.fph[i]; if (p === 1) { this.fe[i] += fA; if (this.fe[i] >= 1) { this.fe[i] = 1; this.fph[i] = 2; } } else if (p === 2) { this.fe[i] *= fD; if (this.fe[i] < 1e-4) { this.fe[i] = 0; this.fph[i] = 0; } } x = (o - 2048) / 2048 * this.fe[i]; } // fast noise/burst envelope replaces ADSR
          x *= (MU >> i & 1) ? 0 : LV[i]; } // 8-bit level, hard mute (instant, held; ADSR keeps counting underneath)
        if (route >> i & 1) fin += x; else if (!(i === 2 && v3off)) dir += x;
      }
      if (FM) { let ex = 0; if ((fSrc === 0 || fSrc === 2) && this.v[0].wrapped && ++this.fdc >= fDiv) { this.fdc = 0; ex += 1; } if (fSrc >= 1) ex += (((this.v[2].lfsr >> 22) & 1) - 0.5) * 0.25; // excitation: glottal pulse on voice-1 wrap (/divider) and/or noise
        const fy = fC1 * fy1 + fC2 * fy2 + fB0 * ex; fy2 = fy1; fy1 = fy; const fo = fy * fL; if (fFilt) fin += fo; else dir += fo; } // formant voice: 2-pole resonator, direct Hz + bandwidth
      let y = 0; for (let k = 0; k < 2; k++) { const hp = fin - lp - q * bp; bp += w * hp; lp += w * bp; if (k) y = (mode & 1 ? lp : 0) + (mode & 2 ? bp : 0) + (mode & 4 ? hp : 0); }
      if (NA) { const t = (y + dir + this.dc) * vol; if (nm === 0) { nz[0] = nz[1] = nz[2] = nz[3] = t; } const yo = nb0 * t + nb1 * nz[0] + nb2 * nz[1] - na1 * nz[2] - na2 * nz[3]; nz[1] = nz[0]; nz[0] = t; nz[3] = nz[2]; nz[2] = yo; nm = NE ? Math.min(1, nm + nst) : Math.max(0, nm - nst); out[s] += (t + (yo - t) * nm) * gain; continue; } /* notch path; off => original line below, bit-identical */
      out[s] += (y + dir + this.dc) * vol * gain; // dc: 6581 mixer bias (what $D418 volume digis modulate); 8580 has almost none
    }
    this.lp = lp; this.bp = bp; if (X) { if (FM) { this.fy1 = fy1; this.fy2 = fy2; } else { this.fy1 *= 0.5; this.fy2 *= 0.5; } this.nm = nm; }
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
  write(c, a, x, cyc) { if (cyc > 0) this.chips[c].writeAt(a, x, cyc); else this.chips[c].write(a, x); }
  // ticks: function(n) -> [[chip, reg, val], ...]; hz: register update rate
  render(nTicks, hz, ticks, exact) { // exact: tick n starts at sample round(n*sr/hz) (true hz update rate); default: round(sr/hz) samples per tick (legacy)
    const per = Math.round(this.sr / hz), at = n => exact ? Math.round(n * this.sr / hz) : n * per, out = new Float32Array(at(nTicks)), g = 0.5 / Math.sqrt(this.chips.length);
    for (let n = 0; n < nTicks; n++) { for (const [c, a, x, cyc] of ticks(n)) this.write(c, a, x, cyc);
      const s0 = at(n), s1 = at(n + 1), buf = out.subarray(s0, s1); for (const ch of this.chips) ch.render(buf, s1 - s0, g); }
    return out;
  }
}
module.exports = { MultiSid, Chip, cutHz, CLK };
