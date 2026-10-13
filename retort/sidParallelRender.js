#!/usr/bin/env node
// Renders a multi-subtune .sid in parallel: each movement (PSID subtune 2..N starts at a movement boundary)
// is recorded by its own sidplayfp process, then the WAVs are joined sample-exactly into one file.
// Usage: node sidParallelRender.js <job.json>   job = { sid, out, freq, chunks:[{track, seconds}] }
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const freq = job.freq || 44100;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidpar-'));
const maxPar = Math.max(1, Math.min(job.chunks.length, (os.cpus()?.length || 2) - 1));

function findWav(base) {
  for (const p of [`${base}.wav`, `${base}.wav.wav`, `${base}.WAV`, base]) if (fs.existsSync(p)) return p;
  return null;
}
function readPcm(file) {
  const b = fs.readFileSync(file);
  let off = 12, fmt = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') return { fmt, data: b.subarray(off + 8, off + 8 + Math.min(size, b.length - off - 8)) };
    off += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}
function renderOne(chunk, idx) {
  return new Promise((resolve, reject) => {
    const base = path.join(tmpDir, `part${idx}`);
    const args = [`-f${freq}`, `-o${chunk.track}`, `-t${chunk.seconds.toFixed(3)}`, `-w${base}`, job.sid];
    const p = spawn('sidplayfp', args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', code => {
      const f = findWav(base);
      if (code !== 0 || !f) return reject(new Error(`sidplayfp track ${chunk.track} failed (${code})`));
      resolve(f);
    });
  });
}
(async () => {
  const files = new Array(job.chunks.length);
  let next = 0;
  async function worker() { while (next < job.chunks.length) { const i = next++; files[i] = await renderOne(job.chunks[i], i); } }
  await Promise.all(Array.from({ length: maxPar }, worker));
  const parts = []; let fmt = null;
  job.chunks.forEach((c, i) => {
    const { fmt: f, data } = readPcm(files[i]); fmt = fmt || f;
    const frameBytes = f.ch * (f.bits / 8);
    const want = Math.round(c.seconds * f.rate) * frameBytes;           // trim/pad to the exact chunk length
    parts.push(data.length >= want ? data.subarray(0, want) : Buffer.concat([data, Buffer.alloc(want - data.length)]));
  });
  const pcm = Buffer.concat(parts);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(fmt.ch, 22);
  h.writeUInt32LE(fmt.rate, 24); h.writeUInt32LE(fmt.rate * fmt.ch * fmt.bits / 8, 28); h.writeUInt16LE(fmt.ch * fmt.bits / 8, 32); h.writeUInt16LE(fmt.bits, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(job.out, Buffer.concat([h, pcm]));
  fs.rmSync(tmpDir, { recursive: true, force: true });
})().catch(e => { console.error(e.message); try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} process.exit(1); });
