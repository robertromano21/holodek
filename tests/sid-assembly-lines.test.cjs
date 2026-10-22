'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Assembler = require('../retort/sidAssembler');
const Theory = require('../retort/sidMusicTheory'), Composition = require('../retort/sidComposition');
const renderer = path.resolve(__dirname, '../assets/renderSid_poke.js');
const rendererRequire = createRequire(renderer), notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function compile(t, song) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-sid-lines-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'suite.json'), output = path.join(directory, 'suite.asm');
  const original = JSON.stringify(song), probes = [], messages = [];
  fs.writeFileSync(input, original);
  const context = vm.createContext({
    require: id => id === 'child_process' ? { spawnSync: (command, args) => {
      probes.push({ command, args });
      assert.ok(['where.exe', 'sh'].includes(command), 'Only an offline xa availability probe is allowed.');
      return { status: 1 };
    } } : rendererRequire(id),
    process: { argv: ['node', renderer, input, output], platform: process.platform,
      exit: code => { throw Error('Unexpected SID renderer exit: ' + code); } },
    console: { log: message => messages.push(message), warn() {}, error() {} }, Buffer, __dirname: path.dirname(renderer)
  });
  // Execute the real emitter, but never start xa, a shell, audio rendering or a provider.
  vm.runInContext(fs.readFileSync(renderer, 'utf8'), context, { filename: renderer, timeout: 10000 });
  assert.equal(probes.length, 1);
  assert.ok(messages.some(message => message.includes('bundled 6502 subset assembler')));
  assert.equal(fs.readFileSync(input, 'utf8'), original);
  assert.equal(JSON.stringify(song), original);
  return { asm: fs.readFileSync(output, 'utf8'), sidAsm: fs.readFileSync(path.join(directory, 'suite_sid.asm'), 'utf8'),
    sid: fs.readFileSync(path.join(directory, 'suite.sid')) };
}

function byteTables(source) {
  const tables = {}; let current;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.split(';')[0].trim();
    if (!line) continue;
    const match = line.match(/^(?:(\w+):?\s+)?\.byte\s+(.+)$/i);
    if (!match) { current = undefined; continue; }
    if (match[1]) { current = match[1]; assert.ok(!Object.hasOwn(tables, current)); tables[current] = []; }
    assert.ok(current, 'Continuation must follow a labeled byte table.');
    const values = match[2].split(',').map(value => value.trim());
    assert.ok(values.every(Boolean), 'No missing values or trailing commas.');
    tables[current].push(...values);
  }
  return tables;
}

function unchunk(source) {
  const lines = [];
  for (const line of source.split(/\r?\n/)) {
    const continuation = line.match(/^\s+\.byte\s+(.+)$/);
    if (continuation && /\.byte\s/.test(lines.at(-1) || '')) lines[lines.length - 1] += ',' + continuation[1];
    else lines.push(line);
  }
  return lines.join('\n');
}

function patternBytes(pattern, voice, bpm) {
  const data = [], wave = value => ({ TRI: 0x10, SAW: 0x20, PULSE: 0x40, NOISE: 0x80 })[value];
  const t16 = Math.max(2, Math.round(Math.round(3000 / bpm) / 4));
  for (const event of pattern) {
    if (event.cmd === 'inst') {
      const a = event.adsr;
      data.push(0xfd, a.attack * 16 + a.decay, a.sustain * 16 + a.release, wave(event.waveform));
    } else if (event.cmd === 'filter') {
      const route = (event.route || []).reduce((bits, item) => bits | (1 << (item & 3)), 0) & 7;
      data.push(0xfc, Math.max(0, Math.min(255, (event.cutoff | 0) >> 3)),
        Math.max(-16, Math.min(16, event.sweep | 0)) & 255, Math.max(0, Math.min(15, event.resonance | 0)) * 16 + route);
    } else {
      assert.ok(!event.chord, 'These fixtures intentionally use no frame arpeggios.');
      const rest = event.note === 'REST', pitch = rest ? 255 : (event.octave - 2) * 12 + notes.indexOf(event.note);
      data.push(pitch, Math.min(255, t16 * 16 / event.duration), 0,
        voice === 2 && !rest && event.wave === 'NOISE' ? 0x80 : 0);
    }
  }
  return Buffer.from([...data, 0xfe]);
}

function verify(song, result) {
  for (const source of [result.asm, result.sidAsm]) {
    const lines = source.split(/\r?\n/).filter(line => /\.byte\s/.test(line));
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(Buffer.byteLength(line) < 250, 'xa byte directive is too long: ' + line.length);
      assert.ok(line.split(/\.byte\s+/)[1].split(';')[0].split(',').length <= 16, 'Byte directives must contain at most 16 values.');
    }
  }
  const assembled = Assembler.assemble(result.sidAsm), flatSource = unchunk(result.sidAsm);
  const flat = Assembler.assemble(flatSource), tables = byteTables(result.sidAsm);
  assert.ok(flatSource.split('\n').some(line => line.length > 1000), 'Fixture must reproduce the formerly overlong source.');
  assert.deepEqual(assembled.data, flat.data, 'Chunking cannot insert or remove bytes.');
  assert.deepEqual(assembled.symbols, flat.symbols, 'Chunking cannot move pointer targets or entry points.');
  assert.equal(assembled.loadAddress, 0x1000); assert.equal(assembled.symbols.Play, 0x1003);
  assert.equal(result.sid.toString('ascii', 0, 4), 'PSID');
  assert.equal(result.sid.readUInt16BE(0x08), 0);
  assert.equal(result.sid.readUInt16BE(0x0a), 0x1000); assert.equal(result.sid.readUInt16BE(0x0c), 0x1003);
  const load = Buffer.alloc(2); load.writeUInt16LE(assembled.loadAddress);
  assert.deepEqual(result.sid.subarray(result.sid.readUInt16BE(0x06)), Buffer.concat([load, assembled.data]),
    'The emitted SID payload must equal the bundled assembler output plus its load address.');
  const bytesAt = (label, length) => assembled.data.subarray(assembled.symbols[label] - assembled.loadAddress,
    assembled.symbols[label] - assembled.loadAddress + length);
  song.voices.forEach((voice, vi) => {
    const expected = voice.patterns.map(pattern => patternBytes(pattern, vi, song.bpm));
    const seen = new Map(), used = [];
    const expectedOrder = voice.order.map(index => {
      const key = expected[index].toString('hex');
      if (!seen.has(key)) { seen.set(key, used.length); used.push(expected[index]); }
      return seen.get(key);
    });
    const order = `v${vi}_order`, lo = `v${vi}_pat_lo`, hi = `v${vi}_pat_hi`;
    assert.equal(tables[order].length, voice.order.length + 1);
    assert.deepEqual(bytesAt(order, tables[order].length), Buffer.from([...expectedOrder, 255]),
      'Every musical order entry and the loop sentinel must survive unchanged.');
    assert.equal(tables[lo].length, used.length); assert.equal(tables[hi].length, used.length);
    const low = bytesAt(lo, used.length), high = bytesAt(hi, used.length);
    used.forEach((expectedPattern, index) => {
      assert.match(tables[lo][index], /^<pat\d+$/);
      assert.equal(tables[hi][index], '>' + tables[lo][index].slice(1));
      const label = tables[lo][index].slice(1), address = low[index] + 256 * high[index];
      assert.equal(address, assembled.symbols[label]);
      assert.equal(tables[label].length, expectedPattern.length);
      assert.deepEqual(bytesAt(label, expectedPattern.length), expectedPattern,
        'Pointer tables must still select the original notes, durations, commands and pattern terminator.');
    });
  });
  return tables;
}

test('ten-minute suite emits xa-safe byte lines without changing SID payload, musical order or pointer targets', t => {
  const song = Theory.arrangeSuite(Composition.develop(require('./fixtures/sid-leaving-threshold.json')),
    'offline long SID suite', 'assembly-lines');
  assert.ok(song.plan.seconds >= 500);
  assert.ok(song.voices.every(voice => voice.order.length > 250));
  const tables = verify(song, compile(t, song));
  assert.ok(tables.v0_pat_lo.length > 16 && tables.v0_pat_hi.length > 16, 'Exercise both chunked pointer tables.');
});

test('4000-entry orders and 60-event patterns retain all bytes across sixteen-value directive boundaries', t => {
  const patterns = Array.from({ length: 65 }, (_, index) => Array.from({ length: 60 }, (_, step) => {
    const pitch = step === 0 ? index % 48 : step === 1 ? Math.floor(index / 48) : (step * 7 + index) % 48;
    return { note: step > 1 && step % 19 === 0 ? 'REST' : notes[pitch % 12], octave: 2 + Math.floor(pitch / 12),
      duration: [16, 8, 4, 2, 1][step % 5] };
  }));
  const song = { title: 'Offline maximum-order fixture', bpm: 104, key: 'C', scale: 'major',
    voices: ['LEAD', 'BASS', 'ARP_OR_DRUMS'].map((role, voice) => ({ role, waveform: 'TRI',
      adsr: { attack: 2, decay: 8, sustain: 11, release: 6 }, filter: { type: 'NONE', cutoff: 1024, resonance: 0 },
      patterns, order: Array.from({ length: 4000 }, (_, index) => (index * 17 + Math.floor(index / 65) + voice * 13) % 65) })) };
  const tables = verify(song, compile(t, song));
  for (const voice of [0, 1, 2]) {
    assert.equal(tables[`v${voice}_order`].length, 4001);
    assert.equal(tables[`v${voice}_pat_lo`].length, 65); assert.equal(tables[`v${voice}_pat_hi`].length, 65);
  }
  assert.equal(tables.pat0.length, 241, 'All sixty four-byte events and the end marker must remain.');
});
