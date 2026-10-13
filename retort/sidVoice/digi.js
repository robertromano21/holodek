'use strict';
// SID "digi" playback, emulated at register level on one jsid chip (see docs/SID-VOICE-RESEARCH.md, "Digi layer").
// The sample stream is written at an exact integer divisor of the output rate (fixed-rate, zero-jitter: what a cycle-exact
// NMI/CIA-timer player achieves; no badline jitter). Two techniques:
//  'd418' : 4-bit master-volume DAC. Each sample writes $D418 = 8 + round(7*s) (mid-range +8 offset: symmetric swing around
//           the 6581 mixer bias, avoids clipping at 0/15). 6581: the mixer DC bias is what the volume register modulates.
//           8580: almost no bias, so a 'digifix' voice (voice 3: pulse, PW 0 = constant high, gate on) provides it.
//  'pwm8' : pseudo-8-bit PCM on a voice: per sample the TEST bit resets the pulse oscillator (frequency $FFFF), and PW is set
//           so the pulse is high for a sample-proportional part of the sample period (PWM, carrier = sample rate). 8-bit
//           samples -> ~10-11 bit duty resolution, far less grain than 4-bit volume.
//  'tri'  : triangle + TEST-bit PCM on a voice (preferred; no $D418 cross-modulation). Per sample, cycle-exact:
//           $D400/01 = F (ramp speed), $D404 = TEST|TRI|GATE (oscillator reset), $D404 = TRI|GATE (triangle ramps),
//           then exactly Cw cycles later $D404 = 0: no waveform selected, so the waveform DAC holds the reached level
//           (sample-and-hold; floating-DAC hold decays slowly on 8580, faster on 6581). Level = F*Cw/2048 (12-bit DAC).
//           Envelope: AD=$00, SR=$FF (writing 0 also drops GATE; release $F keeps the level, re-gate restores it).
//           Rate = output rate, so the per-sample reset/ramp glitch is identical every sample (folds to DC, not a whine):
//           1x 22.05 kHz = 44.7 cycles/sample, Cw 32 -> 1024 levels (at the edge of what a real NMI loop sustains);
//           2x 44.1 kHz = 44.7 cycles, 1024 levels; 4x 44.1 kHz = 89 cycles, Cw 64 -> 2048 levels (above 8-bit source).
// Clean signal path: no Pin-26 hum, no injected buzz.
const { MultiSid } = require('./jsid');
function digi(audio22, M, opt = {}) {
  const kind = opt.kind || 'pwm8', model = opt.model || '6581', sr = M.sr, up = sr / 22050, Fs = opt.fs || (kind === 'd418' ? sr / 2 : sr), per = sr / Fs
  if (Math.abs(per - Math.round(per)) > 1e-9) throw new Error('digi rate must divide output rate');
  const w = opt.weight, n22 = audio22.length, nT = Math.ceil(n22 * Fs / 22050);
  let pk = 1e-9; for (let k = 0; k < n22; k++) pk = Math.max(pk, Math.abs(audio22[k]));
  const norm = (opt.norm || 0.97) / pk, at = t => { const x = t * 22050 / Fs, i = Math.floor(x), u = x - i, a = audio22[i] || 0, b = audio22[i + 1] || 0; let s = (a + (b - a) * u) * norm; if (w) s *= (w[i] || 0); return Math.max(-1, Math.min(1, s)); };
  const ms = new MultiSid(1, sr, { clk: M.clk, model: kind === 'd418' ? model : (opt.model || '8580'), aa: true }), S = 65535 * (M.clk / Fs) / 4096; // PW span swept per sample
  const init = [[0, 5, 0], [0, 6, 0xf0], [0, 12, 0], [0, 13, 0xf0], [0, 19, 0], [0, 20, 0xf0], [0, 23, 0], [0, 24, 0x0f]];
  if (kind === 'pwm8') init.push([0, 0, 0xff], [0, 1, 0xff], [0, 4, 0x41]); else if (kind === 'tri') init.push([0, 5, 0x00], [0, 6, 0xff], [0, 4, 0x11]);
  else if (model === '8580') init.push([0, 16, 0], [0, 17, 0], [0, 15, 0], [0, 14, 0], [0, 18, 0x41]); // digifix voice
  const cps = M.clk / Fs, Cw = Math.floor(cps * 0.72), Lmax = Math.min(4095, Math.floor(65535 * Cw / 2048)), bits = opt.bits || 8; // cycles per sample, ramp wait, top level
  const d = ms.render(nT, Fs, n => { const wr = n === 0 ? init.slice() : [];
    if (kind === 'tri') { const s = at(n), q = Math.round((s + 1) * ((1 << bits) - 1) / 2), L = Math.round(q / ((1 << bits) - 1) * Lmax), F = Math.min(65535, Math.round(L * 2048 / Cw));
      wr.push([0, 0, F & 255], [0, 1, F >> 8], [0, 4, 0x19], [0, 4, 0x11], [0, 4, 0x00, Cw]); return wr; }
    const s = at(n);
    if (kind === 'd418') wr.push([0, 24, Math.max(0, Math.min(15, 8 + Math.round(7 * s)))]);
    else { const q = Math.round((s + 1) * 127.5), pw = Math.max(0, Math.min(4095, Math.round((1 - q / 255) * S))); // 8-bit sample -> duty
      wr.push([0, 4, 0x49], [0, 4, 0x41], [0, 2, pw & 255], [0, 3, pw >> 8]); }
    return wr; });
  const settle = Math.round(sr * 0.004); let px = d[settle] || 0, py = 0; for (let k = 0; k < d.length; k++) { if (k < settle) { d[k] = 0; continue; } const y = d[k] - px + 0.995 * py; px = d[k]; py = y; d[k] = y; } // DC block; first 4 ms (bias/envelope settling) muted -> no start thump
  d.unit = kind === 'd418' ? 0.5 * (model === '6581' ? 0.8 + 0 : 1.03) * 7 / 15 : kind === 'tri' ? 0.5 * Lmax / 4096 : 0.5; d.norm = norm; // output per unit input
  return d;
}
module.exports = { digi };
