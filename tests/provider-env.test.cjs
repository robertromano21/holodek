'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../retort/providerEnv');
const quiet = fn => { const i = console.info; console.info = () => {}; try { return fn(); } finally { console.info = i; } };

test('legacy Grok launch: OPENAI_BASE_URL at api.x.ai makes OPENAI_API_KEY the xAI key and never sends it to OpenAI', () => {
  for (const url of ['https://api.x.ai/v1', 'https://api.x.ai/v1/chat/completions', 'https://api.x.ai/v1/chat/completions/', 'https://api.x.ai']) {
    const env = { OPENAI_BASE_URL: url, OPENAI_API_KEY: 'xai-legacy-key-' + 'z'.repeat(30) };
    const r = quiet(() => P.apply(env, { readSavedOpenAI: () => '' }));
    assert.equal(r.legacy, true, url);
    assert.ok(env.XAI_API_KEY.startsWith('xai-legacy-key-'));
    assert.equal(env.OPENAI_BASE_URL, undefined);
    assert.equal(env.HOLODEK_XAI_URL, 'https://api.x.ai/v1');
    assert.ok(!env.OPENAI_API_KEY.startsWith('xai-legacy'), 'xAI key is not left as the OpenAI key');
    assert.equal(env.HOLODEK_OPENAI_KEY_PLACEHOLDER, '1');
  }
});

test('a saved OpenAI key is used beside a legacy Grok launch; normal launches are unchanged', () => {
  const env = { OPENAI_BASE_URL: 'https://api.x.ai/v1', OPENAI_API_KEY: 'xai-k-' + 'q'.repeat(30) };
  quiet(() => P.apply(env, { readSavedOpenAI: () => 'sk-saved-openai-' + 'w'.repeat(30) }));
  assert.ok(env.OPENAI_API_KEY.startsWith('sk-saved-openai-')); assert.equal(env.HOLODEK_OPENAI_KEY_PLACEHOLDER, '');
  const plain = { OPENAI_API_KEY: 'sk-normal' };
  assert.equal(P.apply(plain).legacy, false); assert.deepEqual(plain, { OPENAI_API_KEY: 'sk-normal' });
  const other = { OPENAI_BASE_URL: 'https://proxy.example/v1/chat/completions' }; P.apply(other);
  assert.equal(other.OPENAI_BASE_URL, 'https://proxy.example/v1');
});
