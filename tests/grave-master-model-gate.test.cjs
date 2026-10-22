'use strict';
// holodek-1 (Grave Master fine-tune in Ollama) is opt-in and Children of the Grave play only.
const test = require('node:test'), assert = require('node:assert/strict');
const Models = require('../retort/gameModels');
const T = require('../retort/modelTransport');

function svc(cotg, chat) {
  const flag = { on: cotg };
  const s = Models.createModelService({ clientFor: () => ({ models: { list: async () => ({ data: [{ id: 'gpt-6-luna' }] }) } }),
    localProbe: async () => Models.catalog.filter(r => r.local), isCotG: () => flag.on });
  return Object.assign({ ...s, getLocalClient: () => ({ chat: { completions: { create: chat } } }) }, { flag });
}

test('catalog row: local Ollama holodek-1, listed right after gpt-oss-20b, never the default', () => {
  const ids = Models.catalog.map(r => r.id), row = Models.catalog.find(r => r.id === 'holodek-1');
  assert.equal(ids.indexOf('holodek-1'), ids.indexOf('gpt-oss-20b') + 1);
  assert.equal(row.apiModel, 'holodek-1'); assert.equal(row.local, 'ollama'); assert.equal(row.cotgOnly, true);
  assert.match(row.name, /Grave Master/);
  assert.notEqual(Models.DEFAULT_MODEL, 'holodek-1'); assert.notEqual(Models.LOCAL_DEFAULT, 'holodek-1');
});

test('outside CotG play it is hidden, marked CotG only, and cannot be selected', async () => {
  const s = svc(false), v = await s.view();
  assert.ok(!v.models.some(m => m.id === 'holodek-1'));
  assert.equal(v.all.find(m => m.id === 'holodek-1').status, 'CotG only');
  await assert.rejects(s.select('holodek-1', 0), e => e.status === 409);
  assert.equal(s.current().id, 'gpt-6-luna');
});

test('during CotG play it is offered and sends model holodek-1 to Ollama', async () => {
  let sent;
  const s = svc(true, async body => { sent = body; return { choices: [{ finish_reason: 'stop', message: { content: '{"attack_modifier":1,"damage_modifier":1,"ac":0,"magic":1}' } }] }; });
  const v = await s.view();
  assert.ok(v.models.some(m => m.id === 'holodek-1'));
  assert.equal(v.all.find(m => m.id === 'holodek-1').status, 'ready');
  await s.select('holodek-1', 0);
  await s.withSnapshot(() => T.complete(null, { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'rate' }] }, { models: s }));
  assert.equal(sent.model, 'holodek-1');
});

test('selected, then play leaves CotG (homebrew / genre kit / city gen): calls fall back to gpt-oss:20b', async () => {
  let sent;
  const s = svc(true, async body => { sent = body; return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }; });
  await s.select('holodek-1', 0);
  s.flag.on = false;
  assert.equal(s.profile('gpt-4.1-mini').id, 'gpt-oss-20b');
  await s.withSnapshot(() => T.complete(null, { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'x' }] }, { models: s }));
  assert.equal(sent.model, 'gpt-oss:20b');
});

test('not pulled into Ollama: refused even during CotG play', async () => {
  const s = Models.createModelService({ clientFor: () => null, localProbe: async () => Models.catalog.filter(r => r.id === 'gpt-oss-20b'), isCotG: () => true });
  await assert.rejects(s.select('holodek-1', 0), e => e.status === 409);
});

test('background workers never use it (adjacent-room prefetch model comes from HOLODEK_BG_MODEL / gpt-oss:20b)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'retort', 'adjacentRooms.js'), 'utf8');
  assert.ok(!src.includes('holodek-1'));
});
