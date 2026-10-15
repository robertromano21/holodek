'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Profile = require('../retort/sidVoice/profile'), Mood = require('../retort/sidVoice/mood');
const source = fs.readFileSync(require.resolve('../assets/sfx.js'), 'utf8');
function browser() {
  const window = { _partyCharacterRegistry: {}, getDungeonLifeContext: () => ({ actors: [] }) };
  const context = { window, hash: s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  const VOWELS ='), source.indexOf('  // text -> syllable events')) +
    '\nthis.api = { voiceSpecOf, voiceProfile, voiceWireProfile };', context);
  return { ...context.api, window };
}
test('anatomy and expressive controls survive the browser/server identity contract', () => {
  const b = browser(), actor = { name: 'Vessa Reedwake', race: 'Elf', sex: 'Female', personality: 'deliberate and measured' };
  actor.voiceSpec = b.voiceSpecOf(actor);
  const wire = b.voiceWireProfile(actor), P = Profile.normalize(wire);
  assert.equal(actor.voiceSpec.v, 2);
  assert.ok(wire.fs > 1.05); assert.equal(P.fs, wire.fs);
  for (const key of ['warm', 'bright', 'vibAmt', 'vibRate', 'fineKeep', 'decl']) assert.equal(P[key], wire[key], key);
  assert.equal(P.pause, 1.4); assert.equal(P.race, 'Elf');
  assert.equal(P.accent_, 'elf');
});
test('saved identities remain stable after recruitment and room changes', () => {
  const b = browser(), actor = { name: 'Orro Flintcup', race: 'Dwarf', sex: 'Male', personality: 'brisk' };
  actor.voiceSpec = b.voiceSpecOf(actor);
  const before = JSON.stringify(b.voiceWireProfile(actor));
  b.window._partyCharacterRegistry[actor.name] = { voiceSpec: actor.voiceSpec };
  assert.equal(JSON.stringify(b.voiceWireProfile({ name: actor.name, type: 'npc', activity: 'resting' })), before);
});
test('legacy saved voice specs keep their identity and gain deterministic detail controls', () => {
  const b = browser(), voiceSpec = { v: 1, kind: 'undead', f0: 110, fs: 0.82, range: 2, rate: 3.5, breath: 0, rasp: 0, accent: 'shade' };
  const a = b.voiceWireProfile({ name: 'Tarn Vell', voiceSpec }), c = b.voiceWireProfile({ name: 'Tarn Vell', voiceSpec });
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  assert.equal(a.f0, 110); assert.equal(a.fs, 0.82); assert.equal(a.breath, 0);
  const normalized = Profile.normalize(a); assert.equal(normalized.f0, 110); assert.equal(normalized.range, 2);
});
test('invalid values are bounded; Mortacia keeps her named voice', () => {
  const p = Profile.normalize({ name: 'Test', f0: Infinity, fs: -100, range: NaN, rate: 1e9, breath: 9, rasp: -9, warm: NaN, vibAmt: 0 });
  assert.equal(p.f0, 130); assert.equal(p.fs, 0.7); assert.equal(p.rate, 7); assert.equal(p.vibAmt, 0);
  assert.ok(Object.values(p).every(v => typeof v !== 'number' || Number.isFinite(v)));
  assert.equal(Profile.normalize({ name: '  MORTACIA ', f0: 75 }).f0, 182);
  assert.equal(Profile.keyOf('  Vessa   Reedwake '), 'vessa reedwake');
});
test('mood modulates, rather than replaces, character brightness and pauses', () => {
  const a = Mood.applyMood({ rate: 4.8, bright: 0.8, pause: 0.75 }, 'calm', 'stmt');
  const b = Mood.applyMood({ rate: 4.8, bright: 1.2, pause: 1.4 }, 'calm', 'stmt');
  assert.ok(b.bright > a.bright); assert.ok(b.pause > a.pause);
});

test('profile uploads include the PC, detect changed settings and retry failed uploads', async () => {
  const b = browser(), actors = [{ name: 'The Chosen', type: 'pc', voiceSpec: { f0: 180 } }], requests = [];
  b.window.getDungeonLifeContext = () => ({ actors });
  let succeeds = false;
  const ctx = { window: b.window, voiceWireProfile: b.voiceWireProfile, currentRoomKey: () => '0,0,0',
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: succeeds }; } };
  vm.createContext(ctx);
  const start = source.indexOf('  function postProfiles()'), end = source.indexOf('  setInterval', start);
  vm.runInContext("let profileSig = '', profilePending = null;\n" + source.slice(start, end) + '\nthis.post = postProfiles;', ctx);
  const upload = async () => { ctx.post(); await new Promise(setImmediate); };
  await upload(); assert.equal(requests.length, 1); assert.equal(requests[0].profiles[0].name, 'The Chosen');
  succeeds = true; await upload(); assert.equal(requests.length, 2);
  await upload(); assert.equal(requests.length, 2);
  actors[0].voiceSpec.f0 = 190; await upload(); assert.equal(requests.length, 3);
});

test('speech fetch carries the profile atomically and separates the articulation caches', async () => {
  const b = browser(), actor = { name: 'Vessa Reedwake', voiceSpec: { f0: 180 } }, requests = [];
  const context = { window: b.window, settings: { voiceDetail: true }, actorByName: () => actor, voiceWireProfile: b.voiceWireProfile,
    sidMode: () => '2x', voiceChip: () => '10582', voiceNotch: () => false, performance,
    audio: () => ({ decodeAudioData: (data, resolve) => resolve({ duration: 1 }) }),
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(2) }; } };
  vm.createContext(context);
  const start = source.indexOf('  const speechBufs ='), end = source.indexOf('  const cleanSpeech =', start);
  vm.runInContext(source.slice(start, end) + '\nthis.get = fetchSpeech;', context);
  await context.get(actor.name, 'The gods remember.'); await context.get(actor.name, 'The gods remember.');
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/voice/line.wav');
  assert.equal(requests[0].body.profile.f0, 180);
  context.settings.voiceDetail = false; await context.get(actor.name, 'The gods remember.');
  actor.voiceSpec.f0 = 190; await context.get(actor.name, 'The gods remember.');
  assert.equal(requests.length, 3); assert.equal(requests[1].body.detail, false); assert.equal(requests[2].body.profile.f0, 190);
});
