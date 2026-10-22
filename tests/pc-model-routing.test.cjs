'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Host = require('../retort/pcModelHost');
const root = path.resolve(__dirname, '..');
const messages = [{ role: 'user', content: 'Describe the hall.' }];
function load(name, stubs, processFake) {
  const file = path.join(root, 'retort', name + '.js'), nativeRequire = createRequire(file), module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,__dirname,process){\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })
    (id => Object.hasOwn(stubs, id) ? stubs[id] : nativeRequire(id), module, module.exports, path.dirname(file), processFake);
  return module.exports;
}
function fixture({ remote = true, engine = false, pc = ['holodek-1:latest'], web = ['gpt-oss:20b'], failPC = false, failWeb = false, pcClient } = {}) {
  const calls = [], sdk = [], env = { HOLODEK_OLLAMA_URL: 'http://localhost:11434/v1', ...(engine ? { HOLODEK_REMOTE_ENGINE: '1' } : {}) };
  const processFake = { env, cwd: () => root };
  const pcMarker = pcClient || { source: 'pc' }, webMarker = { source: 'website' };
  const website = { useForGameModels: () => remote, withSnapshot: work => work(), status: async () => {
    calls.push('website-status'); if (failWeb) throw Error('private website error'); return { worker: { models: web.map(name => ({ name })) } };
  } };
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(url, 'http://localhost:11434/api/tags'); assert.equal(options.redirect, 'error');
    if (failPC) throw Error('private PC error'); return { ok: true, json: async () => ({ models: pc.map(name => ({ name })) }) };
  };
  const models = load('gameModels', {
    './websiteAi': { service: () => website, modelClient: () => webMarker },
    './pcModelHost': { localOllamaURL: () => Host.localOllamaURL(env), modelClient: () => pcMarker },
    'node:fs': { readFileSync() { throw Error('No key files read in this fixture.'); } },
    openai: { OpenAI: class { constructor(options) { this.source = 'local-sdk'; this.options = options; sdk.push(this); } } }
  }, processFake);
  return { models, calls, sdk, env, processFake, pcMarker, webMarker, fetchImpl, probe: () => models.probeLocal(fetchImpl) };
}

test('exact profile or id sends holodek-1 to PC while stock gpt-oss keeps website routing', () => {
  const f = fixture();
  assert.equal(f.models.getLocalClient('holodek-1'), f.pcMarker);
  assert.equal(f.models.getLocalClient({ id: 'holodek-1', local: 'ollama' }), f.pcMarker);
  assert.equal(f.models.getLocalClient('gpt-oss-20b'), f.webMarker);
  assert.equal(f.models.current().id, 'gpt-6-luna'); assert.equal(f.sdk.length, 0);
});

test('REMOTE_ENGINE=1 always retains Website proxy, including holodek-1 with Website toggle off', () => {
  for (const remote of [true, false]) {
    const f = fixture({ remote, engine: true });
    assert.equal(f.models.getLocalClient('holodek-1'), f.webMarker); assert.equal(f.models.getLocalClient({ id: 'holodek-1' }), f.webMarker);
    assert.equal(f.sdk.length, 0);
  }
});

test('Website off keeps legacy stock local SDK; holodek-1 still uses bounded PC host', () => {
  const f = fixture({ remote: false });
  assert.equal(f.models.getLocalClient('holodek-1'), f.pcMarker);
  const client = f.models.getLocalClient('gpt-oss-20b'); assert.equal(client.source, 'local-sdk');
  assert.equal(client.options.baseURL, 'http://localhost:11434/v1'); assert.equal(f.models.getLocalClient('gpt-oss-20b'), client);
});

test('pinned action profile, not later menu selection, decides the no-argument local client', async () => {
  const f = fixture(); f.models.restore('holodek-1');
  await f.models.withSnapshot(async () => {
    f.models.restore('gpt-oss-20b'); await Promise.resolve();
    assert.equal(f.models.snapshot().id, 'holodek-1'); assert.equal(f.models.getLocalClient(), f.pcMarker);
  });
  assert.equal(f.models.getLocalClient(), f.webMarker);
});

test('Website discovery merges only PC holodek-1 and website stock gpt-oss, with no inference', async () => {
  const f = fixture({ pc: ['holodek-1:latest', 'gpt-oss:20b'], web: ['gpt-oss:20b', 'holodek-1:latest'] });
  assert.deepEqual((await f.probe()).map(row => row.id), ['holodek-1', 'gpt-oss-20b']);
  assert.deepEqual(f.calls.sort(), ['http://localhost:11434/api/tags', 'website-status'].sort()); assert.equal(f.sdk.length, 0);
  const webOnly = fixture({ pc: ['gpt-oss:20b'], web: ['holodek-1:latest'] });
  assert.deepEqual(await webOnly.probe(), []);
});

test('PC and website discovery failures are independent, and Website off discovers both on PC', async () => {
  for (const [options, expected] of [
    [{ failPC: true }, ['gpt-oss-20b']], [{ failWeb: true }, ['holodek-1']],
    [{ remote: false, pc: ['holodek-1', 'gpt-oss:20b'] }, ['holodek-1', 'gpt-oss-20b']]
  ]) {
    const f = fixture(options); assert.deepEqual((await f.probe()).map(row => row.id), expected);
    if (options.remote === false) assert.ok(!f.calls.includes('website-status'));
  }
});

test('cloud/website model lists cannot falsely advertise PC holodek-1; error is PC-specific without changing Luna', async () => {
  const f = fixture({ pc: [], web: ['gpt-oss:20b', 'holodek-1:latest'] }); let completions = 0;
  const models = f.models.createModelService({ localProbe: f.probe, clientFor: () => ({
    models: { list: async () => ({ data: [{ id: 'gpt-6-luna' }, { id: 'holodek-1' }] }) },
    chat: { completions: { create() { completions++; assert.fail('Discovery must not infer.'); } } }
  }) });
  const view = await models.view(); assert.deepEqual(view.models.map(row => row.id), ['gpt-6-luna', 'gpt-oss-20b']);
  assert.equal(view.all.find(row => row.id === 'holodek-1').status, 'not running');
  await assert.rejects(models.select('holodek-1', 0), /PC Ollama.*No other model was substituted/);
  assert.equal(models.current().id, 'gpt-6-luna'); assert.equal(completions, 0);
  await f.models.chooseStartupDefault(models, { env: {}, log() {} }); assert.equal(models.current().id, 'gpt-6-luna');
});

function transportFixture(message, { remoteEngine = false } = {}) {
  const requests = [], routed = [], reports = [];
  const host = Host.createHost({ fetchImpl: async (_url, init) => {
    requests.push({ body: JSON.parse(init.body), signal: init.signal });
    return { ok: true, text: async () => JSON.stringify({ model: 'holodek-1:latest', usage: { total_tokens: 7 },
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } }] }) };
  } });
  const sdk = Host.modelClient({ complete: (body, options) => { routed.push(options); return host.complete(body, options); } });
  const f = fixture({ pcClient: sdk, engine: remoteEngine });
  f.models.restore('holodek-1');
  const profile = f.models.profile('gpt-4.1-mini'), models = { ...f.models,
    getLocalClient(value) { routed.push(value); return f.models.getLocalClient(value); } };
  const transport = load('modelTransport', { './gameModels': models, './settingLayer': { applyBody: body => body },
    './generationDiagnostics': { report: (...args) => reports.push(args) } }, f.processFake);
  return { ...f, models, profile, transport, requests, routed, reports };
}

test('transport forwards exact resolved profile and background flag for completion and stream', async () => {
  const f = transportFixture({ content: 'Final hall.', reasoning: 'private analysis' });
  const direct = await f.transport.complete(null, { model: 'gpt-4.1-mini', messages }, { models: f.models, background: true });
  assert.equal(direct.choices[0].message.content, 'Final hall.'); assert.equal(direct.choices[0].message.reasoning, 'private analysis');
  const chunks = []; for await (const chunk of f.transport.stream({ model: 'gpt-4.1-mini' }, messages, { models: f.models })) chunks.push(chunk);
  assert.equal(chunks.map(chunk => chunk.contentDelta).join(''), 'Final hall.');
  assert.equal(f.routed[0], f.profile); assert.equal(f.routed[1].background, true);
  assert.equal(f.routed[2], f.profile); assert.equal(f.routed[3].background, false);
  assert.ok(f.requests.every(request => request.body.model === 'holodek-1' && request.body.stream === false));
  assert.ok(f.routed.filter(value => value.signal).every(value => value.signal.aborted));
});

for (const field of ['reasoning', 'reasoning_content']) {
  test(field + '-only JSON passes actual structured stream extraction and schema validation', async () => {
    const f = transportFixture({ content: '', [field]: '{"name":"Stone Hall"}' });
    const settings = { model: 'gpt-4.1-mini', name: 'answer', parameters: { name: { type: String } } };
    const chunks = []; for await (const chunk of f.transport.stream(settings, messages, { models: f.models })) chunks.push(chunk);
    assert.deepEqual(JSON.parse(chunks.map(chunk => chunk.contentDelta).join('')), { name: 'Stone Hall' });
    assert.equal(f.requests[0].body.tools, undefined); assert.equal(f.reports.length, 0);
  });

  test(field + '-only prose is never a normal answer in complete or stream', async () => {
    const f = transportFixture({ content: '', [field]: 'Private reasoning that must not be displayed.' });
    await assert.rejects(f.transport.complete(null, { model: 'gpt-4.1-mini', messages }, { models: f.models }), /PC Ollama.*no final answer/);
    const chunks = [];
    await assert.rejects(async () => {
      for await (const chunk of f.transport.stream({ model: 'gpt-4.1-mini' }, messages, { models: f.models })) chunks.push(chunk);
    }, /PC Ollama.*no final answer/);
    assert.equal(chunks.map(chunk => chunk.contentDelta).join(''), ''); assert.equal(f.requests.length, 2);
  });
}

test('reasoning JSON still fails the actual structured schema if required name is missing', async () => {
  const f = transportFixture({ content: '', reasoning: '{"other":"Hall"}' });
  await assert.rejects(async () => {
    for await (const _ of f.transport.stream({ model: 'gpt-4.1-mini', parameters: { name: { type: String } } }, messages, { models: f.models })) {}
  }, /does not match.*name/);
});
