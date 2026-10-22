'use strict';
// Runs before any OpenAI client is created (required first by retort/worldFlags.js, which server.js loads at line 4).
// Backward compatibility with older Grok launches:  OPENAI_BASE_URL=https://api.x.ai/v1 OPENAI_API_KEY=<xai key> pm2 start server.js
//  - a base URL ending in /chat/completions is normalized to .../v1
//  - if it points at api.x.ai, OPENAI_API_KEY is treated as the xAI key (XAI_API_KEY), and the OpenAI base URL/key are cleared
//    so the xAI key is never sent to OpenAI. OpenAI models then need their own key (keys/openai.key or the in-game entry).
// Keys are never printed.
function normalizeBase(url) { return String(url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/+$/, ''); }
function apply(env = process.env, { readSavedOpenAI = () => { try { return require('node:fs').readFileSync(require('node:path').join(env.HOLODEK_KEY_DIR || require('node:path').join(process.cwd(), 'keys'), 'openai.key'), 'utf8').trim(); } catch { return ''; } } } = {}) {
  const base = normalizeBase(env.OPENAI_BASE_URL); let legacy = false;
  if (base) env.OPENAI_BASE_URL = /\/v1$/.test(base) ? base : base + (/api\.x\.ai$/.test(base) ? '/v1' : '');
  if (/^https?:\/\/api\.x\.ai(\/|$)/i.test(base)) {
    legacy = true;
    if (!env.XAI_API_KEY && env.OPENAI_API_KEY) env.XAI_API_KEY = env.OPENAI_API_KEY;
    if (!env.HOLODEK_XAI_URL) env.HOLODEK_XAI_URL = 'https://api.x.ai/v1';
    delete env.OPENAI_BASE_URL;
    // OpenAI SDK clients need a non-empty key to construct; use a saved OpenAI key if present, else an inert placeholder.
    env.OPENAI_API_KEY = readSavedOpenAI() || 'sk-none-legacy-xai-launch';
    env.HOLODEK_OPENAI_KEY_PLACEHOLDER = env.OPENAI_API_KEY.startsWith('sk-none-') ? '1' : '';
    console.info('[ProviderEnv] OPENAI_BASE_URL pointed at api.x.ai: using that key for xAI models; OpenAI models need their own key.');
  }
  return { legacy, base: env.OPENAI_BASE_URL || null };
}
module.exports = { apply, normalizeBase };
if (!global.__holodekProviderEnv) { global.__holodekProviderEnv = true; apply(); }
