'use strict';
// Read-only reference audit. Does not render or replace any room assets.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Theory = require('../retort/sidMusicTheory');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function waveStats(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('Not a RIFF WAV.');
  let format, start, length;
  for (let p = 12; p + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', p, p + 4), n = bytes.readUInt32LE(p + 4), body = p + 8;
    if (body + n > bytes.length) throw Error('Truncated WAV chunk.');
    if (tag === 'fmt ') format = { encoding: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2),
      sampleRate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) };
    if (tag === 'data') { start = body; length = n; }
    p = body + n + (n & 1);
  }
  if (!format || format.encoding !== 1 || format.bits !== 16 || start === undefined) throw Error('Requires 16-bit PCM WAV.');
  const samples = length / 2; let sum = 0, squares = 0, peak = 0, clipped = 0, active = 0;
  for (let p = start; p < start + length; p += 2) {
    const n = bytes.readInt16LE(p) / 32768;
    sum += n; squares += n * n; peak = Math.max(peak, Math.abs(n));
    if (Math.abs(n) >= 32767 / 32768) clipped++;
    if (Math.abs(n) > .001) active++;
  }
  return { ...format, seconds: samples / format.channels / format.sampleRate,
    rms: Math.sqrt(squares / samples), peak, dc: sum / samples, clippedSamples: clipped, activeFraction: active / samples };
}

function assemblyStats(text) {
  const rows = new Map([...text.matchAll(/^(\w+):\s*\.byte\s+([^\r\n]+)/gm)].map(m => [m[1], m[2]]));
  const bytes = row => [...row.matchAll(/\$([0-9a-f]{2})/gi)].map(m => parseInt(m[1], 16));
  const patterns = new Map();
  for (const [label, row] of rows) if (/^pat\d+$/.test(label)) {
    const data = bytes(row), events = [];
    for (let p = 0; p < data.length;) {
      const op = data[p]; if (op === 254) break;
      if (p + 3 >= data.length) throw Error('Incomplete tracker event: ' + label);
      events.push(op === 253 ? { cmd: 'inst' } : op === 252 ? { cmd: 'filter' } :
        { ticks: data[p + 1], rest: op === 255, chord: data[p + 2] !== 0, noise: data[p + 3] === 128 });
      p += 4;
    }
    patterns.set(label, events);
  }
  const voices = [0, 1, 2].map(i => {
    const order = bytes(rows.get(`v${i}_order`) || '').filter(n => n !== 255);
    const table = [...(rows.get(`v${i}_pat_lo`) || '').matchAll(/<pat(\d+)/g)].map(m => 'pat' + m[1]);
    if (!order.length || !table.length) throw Error('Missing SID order/table for voice ' + i);
    const events = order.flatMap(n => { const e = patterns.get(table[n]); if (!e) throw Error('Bad pattern pointer.'); return e; });
    const timed = events.filter(e => !e.cmd), ticks = [...new Set(timed.map(e => e.ticks))].sort((a,b) => a-b);
    return { uniquePatterns: table.length, orderEntries: order.length, totalTicks: timed.reduce((s,e) => s+e.ticks,0),
      ticks, notes: timed.filter(e => !e.rest).length, rests: timed.filter(e => e.rest).length,
      chordEvents: timed.filter(e => e.chord).length, noiseEvents: timed.filter(e => e.noise).length,
      instrumentCommands: events.filter(e => e.cmd === 'inst').length };
  });
  return { patterns: patterns.size, voices, synchronized: new Set(voices.map(v => v.totalTicks)).size === 1 };
}

function audit({ wav, asm, json }) {
  const wb = fs.readFileSync(wav), ab = fs.readFileSync(asm), jb = fs.readFileSync(json), song = JSON.parse(jb);
  const assembly = assemblyStats(ab.toString('utf8')), wave = waveStats(wb);
  const t16 = Math.max(2, Math.round(Math.round(3000 / song.bpm) / 4));
  return { files: Object.fromEntries([[wav,wb],[asm,ab],[json,jb]].map(([file,bytes]) => [path.resolve(file), { bytes: bytes.length, sha256: sha(bytes) }])),
    title: song.title, key: song.key, scale: song.scale, bpm: song.bpm, plan: song.plan, analysis: Theory.analyze(song),
    patches: song.voices.map(v => ({ role: v.role, waveform: v.waveform, adsr: v.adsr, pulseWidth: v.pulseWidth, pwmSpeed: v.pwmSpeed, vibrato: v.vibrato })),
    wave, assembly, timing: { sixteenthFrames: t16, nativeBpm: 750 / t16,
      nativeSeconds: assembly.voices[0].totalTicks / 50,
      wavSecondsAtNominalTempo: Theory.expandVoice(song.voices[0]).filter(s=>!s.cmd).reduce((n,s)=>n+240/song.bpm/s.duration,0),
      jsonMatchesAssemblyTiming: assembly.voices.every((v,i)=>v.totalTicks === Theory.analyze(song).voiceLengths16ths[i] * t16) },
    limitation: 'PCM/score audit, not an auditory judgment or listening comparison.' };
}
if (require.main === module) console.log(JSON.stringify(audit({ wav: process.argv[2] || 'sid/room_A.wav',
  asm: process.argv[3] || 'sid/room_A.asm', json: process.argv[4] || 'retort/current_room.json' }), null, 2));
module.exports = { audit, waveStats, assemblyStats };
