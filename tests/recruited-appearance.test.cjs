'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const PC = require('../assets/renderCharacterProcedural');
const sheet = { name: 'Kaelthar Shadowsnout', race: 'Umbral Wraithhound', sex: 'Male', class: 'Voidbound Tracker',
  isMonster: true, role: 'monster', level: 7, equipped: { weapon: '', armor: '', shield: '', other: '' } };
const traits = { ...PC.deriveFallbackTraits(sheet), bodyPlan: 'beast' };
const entry = () => ({ name: sheet.name, sheet: structuredClone(sheet), sheetKey: 'umbral wraithhound|voidbound tracker|male',
  salt: 2085123582, variant: 0, source: 'llm', traits: structuredClone(traits) });
const key = sheet.name.toLowerCase();
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function serverFixture() {
  let modelCalls = 0;
  const saved = entry(), cached = { entries: { [key]: saved } };
  const fakeFs = { existsSync: () => true, readFileSync: () => JSON.stringify(cached), mkdirSync() {}, writeFileSync() {}, renameSync() {} };
  const context = { module: { exports: {} }, process: { env: { OPENAI_API_KEY: 'test-no-network' } },
    __dirname: path.join(__dirname, '..', 'retort'), console, setTimeout: () => ({ unref() {} }),
    require: name => name === 'fs' ? fakeFs : name === 'openai' ? { OpenAI: class {
      chat = { completions: { create: async () => { modelCalls++; return { choices: [{ message: { content: JSON.stringify(traits) } }] }; } } };
    } } : name.startsWith('.') ? require(path.join(__dirname, '..', 'retort', name)) : require(name) };
  vm.runInNewContext(read('retort/characterTraitSpec.js'), context);
  return { api: context.module.exports, modelCalls: () => modelCalls };
}

test('recruiting and adding mechanical class annotations reuse the approved server appearance without a model call', async () => {
  const f = serverFixture(), recruited = { ...sheet, isMonster: false, role: 'npc', class: sheet.class + ' [rules: Fighter]' };
  const first = await f.api.ensureTraitSpec(sheet), second = await f.api.ensureTraitSpec(recruited);
  assert.equal(second, first);
  assert.equal(second.traits.bodyPlan, 'beast');
  const batch = await f.api.requestTraitSpecs([recruited], { wait: true });
  assert.equal(batch[sheet.name].appearance.isMonster, true);
  assert.equal(batch[sheet.name].appearance.class, sheet.class);
  assert.equal(batch[sheet.name].salt, 2085123582);
  assert.equal(f.modelCalls(), 0);
});

test('automatic console scans preserve approved art, but an explicit player reroll is still honored', async () => {
  const f = serverFixture();
  const consoleText = `NPCs in Party:\n${sheet.name}\nMale\nUmbral Wraithhound\nVoidbound Tracker [rules: Fighter]\nLevel: 7\nHP: 30\nMaxHP: 30\nState: Friendly\n\nMonsters in Room: None`;
  assert.equal(PC.parseConsoleCharacterSheets(consoleText).all.length, 1);
  assert.equal(f.api.ensureTraitSpecsForConsole(consoleText), 0);
  assert.equal(f.modelCalls(), 0);
  await f.api.requestTraitSpecs([sheet], { reroll: true, wait: true });
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.api.getCachedTraitSpecs([sheet.name])[sheet.name].source, 'llm');
});

function clientFixture(appearance) {
  const source = read('assets/game.js'), timers = [];
  const root = { _characterTraitSpecs: { [key]: { ...entry(), appearance } }, _characterSheetIndex: { [key]: structuredClone(sheet) },
    _proceduralSpriteCache: {}, ProceduralCharacters: PC,
    createTraitSpriteCanvas: spec => ({ toDataURL: () => crypto.createHash('sha256').update(PC.renderProceduralPixels(spec, 0).data).digest('hex') }) };
  const context = { window: root, console, Map, setTimeout: fn => { timers.push(fn); return timers.length; },
    getPartyCharacterRegistry: () => ({}), hashCharacterName: PC.hashString,
    fetch: () => { throw Error('Approved characters must not request another appearance.'); } };
  vm.runInNewContext(source.slice(source.indexOf('const PRESET_SPRITE_NAMES'), source.indexOf('// Returns true when the entry\'s sprite changed.')), context);
  return { root, context, timers };
}

for (const legacy of [false, true]) test(`recruitment preserves rendered pixels and anatomy ${legacy ? 'with a legacy cached sprite' : 'with server-approved appearance'}`, () => {
  const f = clientFixture(legacy ? null : sheet), actor = { name: sheet.name, type: 'monster' };
  const before = f.context.getProceduralSpriteFor(actor); actor.sprite = before;
  actor.type = 'npc';
  f.root._characterSheetIndex[key] = { ...sheet, isMonster: false, role: 'npc', class: sheet.class + ' [rules: Fighter]' };
  delete f.root._proceduralSpriteCache[key];
  const after = f.context.getProceduralSpriteFor(actor);
  assert.equal(after.spec.traits.bodyPlan, 'beast');
  assert.equal(after.spec.isMonster, true);
  assert.equal(after.dataUrl, before.dataUrl);
  assert.equal(after.spec.key, before.spec.key);
  assert.equal(actor.type, 'npc', 'Appearance identity must not undo party membership.');
  assert.equal(f.timers.length, 0);
});

test('fresh party NPCs are not mistaken for monsters', () => {
  const f = clientFixture({ ...sheet, isMonster: false, role: 'npc' });
  assert.equal(f.context.getProceduralSpriteFor({ name: sheet.name, type: 'npc' }).spec.isMonster, false);
});
