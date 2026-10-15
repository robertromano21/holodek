'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Theory = require('../retort/sidMusicTheory');
const Composition = require('../retort/sidComposition');
const source = fs.readFileSync('assets/sfx.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end);
}
function fixture(song) {
  const audio = { duration: 100, currentTime: 0, currentSrc: 'room.wav', paused: false, seeking: false, muted: false };
  const calls = { events: [], notes: [], resets: 0, ramps: [] };
  const param = () => ({ value: .8, cancelScheduledValues() {}, setValueAtTime() {},
    linearRampToValueAtTime(...args) { calls.ramps.push(args); } });
  const context = vm.createContext({ song, music: () => audio, AMB_TAGS: ['wind','sandstorm','drips','fire','howls','chant','rumble','water'],
    settings: { muted: false, music: .2, amb: .1, sfx: .8, voice: .85 }, sidPlayers:new Set(),
    ctx: { currentTime: 10 }, crossfading: false, ambLayers: [],
    rhythmMode: '', clkOff: null, schedTo: null, gridSig: '',
    resetAutomation() { calls.resets++; }, gridEvents(...args) { calls.events.push(args); },
    fireNote(...args) { calls.notes.push(args); } });
  vm.runInContext(section('function normalizeAmb(', '// --- key-aware pitched ambience ---') +
    section('const MODES =', 'let keyNow =') +
    section('function rhythmTick()', 'setInterval(() => { ambKeyTick(); rhythmTick(); }') +
    section('function movements(dur)', 'function currentMovement('), context);
  return { context, audio, calls, param, run: code => vm.runInContext(code, context) };
}
function structuredSong() {
  return { key: 'D', scale: 'dorian', plan: { compositionVersion: 3, bars: 20, seconds: 100,
    // Display text deliberately contains no legacy key/bar syntax.
    form: 'room: intro / A || reflective: B || return: A',
    themes: [{ role: 'room', startBar: 0, bars: 8, key: 'D', scale: 'dorian' },
      { role: 'reflective', startBar: 10, bars: 4, key: 'F', scale: 'lydian' },
      { role: 'return', startBar: 16, bars: 4, key: 'D', scale: 'dorian' }] } };
}

test('quiet and zero ambience gains survive normalization; invalid legacy levels remain safe', () => {
  const f = fixture(null);
  assert.deepEqual(clone(f.run("normalizeAmb([{tag:'wind',level:.1},{tag:'rumble',level:0},{tag:'water',level:1}])")),
    [{ tag: 'wind', level: .1 }, { tag: 'rumble', level: 0 }, { tag: 'water', level: 1 }]);
  assert.deepEqual(clone(f.run("normalizeAmb(['wind',{tag:'fire',level:'invalid'},{tag:'water'}])")),
    [{ tag: 'wind', level: .6 }, { tag: 'fire', level: .6 }, { tag: 'water', level: .6 }]);
  assert.deepEqual(clone(f.run("normalizeAmb([{tag:'unknown'},null,{tag:'wind',level:-1},{tag:'fire',level:5}])")),
    [{ tag: 'wind', level: 0 }, { tag: 'fire', level: 1 }]);
});

test('structured movements fill the whole loop and bridges prepare the incoming key', () => {
  const f = fixture(structuredSong()), segments = clone(f.run('keySegments(100)'));
  assert.deepEqual(segments.map(s => [s.start, s.end, s.role, s.pc, s.scale]),
    [[0,40,'room',2,'dorian'],[40,50,'transition',5,'lydian'],[50,70,'reflect',5,'lydian'],
      [70,80,'transition',2,'dorian'],[80,100,'room',2,'dorian']]);
  for (const [time, pc] of [[0,2],[39.9,2],[40,5],[65,5],[70,2],[99,2]]) {
    f.audio.currentTime = time; assert.equal(f.run('songKeyNow().pc'), pc);
  }
  assert.deepEqual(clone(f.run('movements(100)')), [
    { name: 'Room theme', start: 0 }, { name: 'Reflection', start: 50 }, { name: 'Room theme returns', start: 80 }]);
});

test('actual arranger movement metadata supports every suite and its return', () => {
  const p = require('./fixtures/sid-leaving-threshold.json');
  for (const [suiteForm, roles] of Object.entries(Theory.planPromptSpec().suiteForms)) {
    const themes = roles.map((role, i) => ({ ...p, role, keyShift: i + 2 }));
    const song = Composition.assertScore(Theory.arrangeSuite(Composition.develop({ ...p, suiteForm, themes }), '', suiteForm));
    const f = fixture(song), segments = clone(f.run(`keySegments(${song.plan.seconds})`));
    assert.equal(segments.length, song.plan.themes.length * 2 - 1);
    assert.equal(segments[0].start, 0);
    assert.equal(segments.at(-1).end, song.plan.seconds);
    assert.equal(f.run(`movements(${song.plan.seconds}).length`), song.plan.themes.length);
  }
});

test('malformed structured metadata cannot create overlapping or unbounded timing', () => {
  for (const patch of [{ startBar: -1 }, { startBar: 7 }, { bars: 40 }, { bars: NaN }, { key: '?' }, { scale: 'unknown' }]) {
    const song = structuredSong(); Object.assign(song.plan.themes[1], patch);
    assert.deepEqual(clone(fixture(song).run('keySegments(100)')), []);
  }
  const f = fixture(structuredSong());
  for (const dur of ['0','-1','NaN','Infinity']) assert.deepEqual(clone(f.run(`keySegments(${dur})`)), []);
});

test('legacy cached music retains its movement key and transport timing', () => {
  const f = fixture({ key: 'D', scale: 'minor', plan: { bars: 14,
    form: 'Room [D minor, 8 bars: A] || transition -> G dorian || Danger [G dorian, 4 bars: B] || (loop)' } });
  assert.deepEqual(clone(f.run('keySegments(140)')).map(s => [s.start,s.end,s.role,s.pc,s.scale]),
    [[0,80,'room',2,'minor'],[80,100,'transition',7,'dorian'],[100,140,'danger',7,'dorian']]);
  assert.deepEqual(clone(f.run('movements(140)')), [{ name: 'Room', start: 0 }, { name: 'Danger', start: 100 }]);
});

test('music on synchronizes ambience; pause, volume off and resume preserve independent ambience', () => {
  const f = fixture(structuredSong());
  f.context.ambLayers = [{ keyed: 'note', tag: 'drips', nextAt: 0 }];
  f.run('rhythmTick()'); assert.equal(f.run('rhythmMode'), 'grid'); assert.ok(f.calls.events.length);
  f.audio.paused = true;
  f.run('rhythmTick()'); assert.equal(f.run('rhythmMode'), 'free'); assert.equal(f.calls.notes.length, 1);
  assert.equal(f.context.settings.amb, .1);
  f.context.ctx.currentTime = 20; f.context.settings.music = 0; f.audio.paused = false;
  f.run('rhythmTick()'); assert.equal(f.run('rhythmMode'), 'free'); assert.equal(f.calls.notes.length, 2);
  f.context.settings.music = .2;
  f.run('rhythmTick()'); assert.equal(f.run('rhythmMode'), 'grid');
  assert.equal(f.context.ambLayers.length, 1); assert.ok(f.calls.resets >= 3);
});

test('ambience still runs without a composed song', () => {
  const f = fixture(null);
  f.context.ambLayers = [{ cont: true, tag: 'wind', mod: { gain: f.param() }, filt: { frequency: f.param() } }];
  f.run('rhythmTick()'); assert.equal(f.run('rhythmMode'), 'free'); assert.ok(f.calls.ramps.length >= 2);
});

test('independent volume controls and music-only pause do not mute the other layer', () => {
  const f = fixture(structuredSong()), levels = new Map();
  Object.assign(f.context, { sfxBus: 'sfx', ambBus: 'amb', voiceBus: 'voice', duckLevel: 1,
    setBus: (bus, level) => levels.set(bus, level), musicEls: () => [f.audio], save() {},
    onPause: () => { f.audio.paused = true; } });
  f.audio.volume = .2; f.audio.pause = () => f.context.onPause();
  vm.runInContext(section('function setMusicVolume()', 'function duck(') +
    section('function applyVolumes()', '// --- text classification') +
    section('function musicPause()', '// Movement boundaries'), f.context);
  f.context.settings.amb = 0; f.run('applyVolumes()');
  assert.equal(levels.get('amb'), 0); assert.equal(f.audio.volume, .2); assert.equal(f.audio.paused, false);
  f.context.settings.amb = .1; f.context.settings.music = 0; f.run('applyVolumes()');
  assert.equal(levels.get('amb'), .1); assert.equal(f.audio.volume, 0);
  f.context.settings.music = .2; f.run('applyVolumes(); musicPause()');
  assert.equal(f.audio.paused, true); assert.equal(levels.get('amb'), .1);
});
