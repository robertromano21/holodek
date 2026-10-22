'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Models = require('../retort/gameModels');
const T = require('../retort/modelTransport');

function svc(chat) {
  const s = Models.createModelService({ clientFor: () => ({ models: { list: async () => ({ data: [{ id: 'gpt-6-luna' }] }) } }),
    localProbe: async () => Models.catalog.filter(r => r.local && !r.cotgOnly) }); // gm-grave-master: see grave-master-model-gate.test.cjs
  return { ...s, getLocalClient: () => ({ chat: { completions: { create: chat } } }) };
}

test('gpt-oss-20b (local) is listed beside Luna and Luna stays the default', async () => {
  const s = svc();
  assert.equal(Models.DEFAULT_MODEL, 'gpt-6-luna');
  assert.deepEqual((await s.view()).models.map(m => m.id), ['gpt-6-luna', 'gpt-oss-20b']);
  assert.equal(s.current().id, 'gpt-6-luna');
  const hidden = Models.createModelService({ clientFor: () => null, localProbe: async () => [] });
  assert.equal((await hidden.view()).models.length, 0);
});

test('local model: Ollama model name, low reasoning, Grave Master guide first, final answer only', async () => {
  let sent;
  const s = svc(async body => { sent = body; return { choices: [{ finish_reason: 'stop', message: { content: '<|channel|>analysis<|message|>thinking...<|end|><|start|>assistant<|channel|>final<|message|>You step into the cold nave.' } }] }; });
  await s.select('gpt-oss-20b', 0);
  const r = await s.withSnapshot(() => T.complete(null, { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'look' }] }, { models: s }));
  assert.equal(sent.model, 'gpt-oss:20b');
  assert.equal(sent.reasoning_effort, 'low');
  assert.match(sent.messages[0].content, /^# Grave Master guide/);
  assert.equal(r.choices[0].message.content, 'You step into the cold nave.');
});

test('local model streams the final channel only', async () => {
  const chunks = ['<|channel|>analysis<|message|>plan', '<|end|><|channel|>final<|message|>Rain ', 'falls.'].map(c => ({ choices: [{ delta: { content: c } }] }));
  chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  const s = svc(async () => ({ async *[Symbol.asyncIterator]() { yield* chunks; } }));
  await s.select('gpt-oss-20b', 0);
  let out = ''; await s.withSnapshot(async () => { for await (const p of T.stream({ model: 'gpt-4.1-mini' }, [{ role: 'user', content: 'x' }], { models: s })) out += p.contentDelta; });
  assert.equal(out, 'Rain falls.');
});

test('a stopped Ollama gives a clear error (no fallback)', async () => {
  let calls = 0;
  const s = svc(async () => { calls++; throw Object.assign(new Error('Connection error.'), { cause: { code: 'ECONNREFUSED' } }); });
  await s.select('gpt-oss-20b', 0);
  await assert.rejects(s.withSnapshot(() => T.complete(null, { model: 'x', messages: [] }, { models: s })), error => {
    assert.match(error.message, /local model.*unavailable.*configured Ollama connection/);
    assert.doesNotMatch(error.message, /https?:\/\//); return true;
  });
  assert.equal(calls, 1);
});

test('startup default: local gpt-oss when Ollama has it, else Luna; HOLODEK_DEFAULT_MODEL overrides', async () => {
  const quiet = () => {};
  const a = Models.createModelService({ clientFor: () => null });
  assert.equal((await Models.chooseStartupDefault(a, { env: {}, probe: async () => Models.catalog.filter(r => r.local), log: quiet })).id, 'gpt-oss-20b');
  const b = Models.createModelService({ clientFor: () => null });
  assert.equal((await Models.chooseStartupDefault(b, { env: {}, probe: async () => [], log: quiet })).id, 'gpt-6-luna');
  const c = Models.createModelService({ clientFor: () => null });
  assert.equal((await Models.chooseStartupDefault(c, { env: { HOLODEK_DEFAULT_MODEL: 'gpt-6-luna' }, probe: async () => Models.catalog.filter(r => r.local), log: quiet })).id, 'gpt-6-luna');
});

test('xAI Grok non-reasoning appears only with XAI_API_KEY and uses the xAI client', async () => {
  const prev = process.env.XAI_API_KEY;
  try {
    delete process.env.XAI_API_KEY;
    const none = Models.createModelService({ clientFor: () => null, localProbe: async () => [] });
    assert.ok(!(await none.view()).models.some(m => m.provider === 'xai'));
    process.env.XAI_API_KEY = 'xai-test-not-real';
    const s = Models.createModelService({ clientFor: () => null, localProbe: async () => [] });
    const v = await s.view();
    const g = v.models.find(m => m.id === 'grok-4.20-0309-non-reasoning');
    assert.ok(g && g.provider === 'xai' && /Paid/.test(g.note));
    assert.doesNotMatch(JSON.stringify(v), /xai-test-not-real/);
    let sent; const svc = { ...s, getXaiClient: () => ({ chat: { completions: { create: async b => { sent = b; return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }; } } } }) };
    await s.select('grok-4.20-0309-non-reasoning', 0);
    await s.withSnapshot(() => T.complete(null, { model: 'gpt-4.1-mini', messages: [] }, { models: svc }));
    assert.equal(sent.model, 'grok-4.20-0309-non-reasoning'); assert.equal(sent.reasoning_effort, undefined);
  } finally { if (prev === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = prev; }
});

test('provider keys: env key wins and blocks in-game entry; otherwise a typed key is saved to the key file', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')), prev = { d: process.env.HOLODEK_KEY_DIR, x: process.env.XAI_API_KEY };
  try {
    process.env.HOLODEK_KEY_DIR = dir; delete process.env.XAI_API_KEY;
    Models.loadSavedKeys(); assert.equal(Models.keys().xai, 'none');
    Models.saveKey('xai', 'xai-' + 'a'.repeat(40));
    assert.equal(Models.keys().xai, 'file'); assert.equal(fs.readFileSync(path.join(dir, 'xai.key'), 'utf8').trim().length, 44);
    process.env.XAI_API_KEY = 'xai-from-env-' + 'b'.repeat(30); Models.loadSavedKeys();
    assert.equal(Models.keys().xai, 'env'); assert.equal(process.env.XAI_API_KEY.startsWith('xai-from-env'), true);
    assert.throws(() => Models.saveKey('xai', 'xai-' + 'c'.repeat(40)), /environment/);
  } finally { process.env.HOLODEK_KEY_DIR = prev.d ?? ''; if (!prev.d) delete process.env.HOLODEK_KEY_DIR; if (prev.x === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = prev.x; Models.loadSavedKeys(); fs.rmSync(dir, { recursive: true }); }
});

test('every model is always listed with a status; Grok without a key needs a key; a stopped Ollama shows not running', async () => {
  const prev = process.env.XAI_API_KEY; delete process.env.XAI_API_KEY;
  try {
    const s = Models.createModelService({ clientFor: () => ({ models: { list: async () => ({ data: [{ id: 'gpt-6-luna' }] }) } }), localProbe: async () => [] });
    const v = await s.view(), st = id => v.all.find(m => m.id === id)?.status;
    assert.equal(v.all.length, Models.catalog.length);
    assert.equal(st('gpt-oss-20b'), 'not running');
    assert.equal(st('grok-4.20-0309-non-reasoning'), 'needs key');
    await assert.rejects(s.select('grok-4.20-0309-non-reasoning', 0), e => e.status === 428);
    assert.equal((await s.select('gpt-oss-20b', 0)).id, 'gpt-oss-20b'); // selectable; calls report Ollama is not running
  } finally { if (prev !== undefined) process.env.XAI_API_KEY = prev; }
});
