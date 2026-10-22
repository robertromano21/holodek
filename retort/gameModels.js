'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');

// Capability allowlist checked against official model pages on 2026-10-14.
// Account discovery supplies availability, never guesses reasoning/tool support.
const catalog = Object.freeze([
  ['gpt-6-luna', 'GPT-6 Luna', 'Efficient, high-volume model', true],
  ['gpt-6-sol', 'GPT-6 Sol', 'Higher-capability GPT-6 alternative', true],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', 'Cost-sensitive GPT-5.6 model', true],
  ['gpt-5.6-terra', 'GPT-5.6 Terra', 'Balanced GPT-5.6 model', true],
  ['gpt-5.6-sol', 'GPT-5.6 Sol', 'Flagship GPT-5.6 model', true],
  ['gpt-5.5', 'GPT-5.5', 'Flagship professional model', true],
  ['gpt-4.1', 'GPT-4.1', 'Legacy non-reasoning model', false, '2027-01-14'],
  ['gpt-4.1-mini', 'GPT-4.1 Mini', 'Original primary game model', false, '2027-01-14'],
  ['gpt-4.1-nano', 'GPT-4.1 Nano', 'Small legacy non-reasoning model', false],
  ['gpt-4o', 'GPT-4o', 'Legacy general-purpose model', false, '2027-01-14'],
  ['gpt-4o-mini', 'GPT-4o Mini', 'Original lightweight game model', false, '2027-01-14'],
  // holodek-1: Grave Master fine-tune of gpt-oss-20b (run5 LoRA merged, GGUF in Ollama). Manual opt-in, usable everywhere.
  // Recommended Ollama Modelfile: PARAMETER num_gpu 99 + PARAMETER num_ctx 4096 (100% GPU on the RTX 5070 Laptop, ~12 GB loaded).
  // A per-model num_ctx overrides the OLLAMA_CONTEXT_LENGTH=32768 user env var, which only gave ~37% GPU.
  ['holodek-1', 'holodek-1 (Grave Master fine-tune)', 'Local Grave Master fine-tune of gpt-oss-20b via Ollama; manual opt-in', false, null,
    { local: 'ollama', provider: 'local', apiModel: 'holodek-1', reasoningEffort: 'low', guide: 'grave-master-local-holodek1.md', recommended: { num_gpu: 99, num_ctx: 4096 }, documentation: 'https://ollama.com/library/gpt-oss', note: 'Free, offline, 100% GPU with num_gpu 99 / num_ctx 4096; optional local model' }],
  // Local model served by Ollama on this PC (OpenAI-compatible endpoint, no API key). Reasoning is kept low and only the final answer is used.
  ['gpt-oss-20b', 'gpt-oss-20b (local)', 'Local open-weight model via Ollama; free, runs on this PC', false, null,
    { local: 'ollama', provider: 'local', apiModel: 'gpt-oss:20b', reasoningEffort: 'low', guide: 'grave-master-local.md', documentation: 'https://ollama.com/library/gpt-oss', note: 'Free, offline, runs on this PC' }],
  ['groq-gpt-oss-120b', 'GPT-OSS 120B (Groq)', 'Groq-hosted base model; separate from the local holodek-1 fine-tune', false, null,
    { provider:'groq', apiModel:'openai/gpt-oss-120b', reasoningEffort:'low', documentation:'https://console.groq.com/docs/model/openai/gpt-oss-120b', note:'Paid Groq inference; 131,072-token context; needs GROQ_API_KEY' }],
  // xAI non-reasoning model (docs.x.ai/docs/models, checked 2026-10-20: $1.25 in / $2.50 out per 1M tokens under 200k prompt tokens).
  ['grok-4.20-0309-non-reasoning', 'Grok 4.20 (non-reasoning)', 'xAI non-reasoning model', false, null,
    { provider: 'xai', documentation: 'https://docs.x.ai/docs/models', note: 'Paid (xAI): $1.25 in / $2.50 out per 1M tokens; needs XAI_API_KEY' }]
].map(([id, name, description, reasoningNone, shutdownDate, extra = {}]) => Object.freeze({
  id, name, description, reasoningNone, shutdownDate: shutdownDate || null,
  documentation: 'https://developers.openai.com/api/docs/models/' + id, ...extra
})));
const OLLAMA_URL = () => (process.env.HOLODEK_OLLAMA_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
let localClient, xaiClient, groqClient;
// Provider keys: an environment key (e.g. `$env:OPENAI_API_KEY=...; pm2 start server.js`) always wins. A key typed in the game is
// saved to <HOLODEK_KEY_DIR or ./keys>/<provider>.key only when no env key exists, and is never logged or returned.
const KEY_ENV = { openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY', groq: 'GROQ_API_KEY' }, keySource = {};
const keyDir = () => process.env.HOLODEK_KEY_DIR || require('node:path').join(process.cwd(), 'keys');
const keyPath = p => require('node:path').join(keyDir(), p + '.key');
function loadSavedKeys(env = process.env) { const fs = require('node:fs');
  for (const [p, name] of Object.entries(KEY_ENV)) { if (env[name] && !(p === 'openai' && env.HOLODEK_OPENAI_KEY_PLACEHOLDER === '1')) { keySource[p] = 'env'; continue; }
    try { const k = fs.readFileSync(keyPath(p), 'utf8').trim(); if (k) { env[name] = k; keySource[p] = 'file'; continue; } } catch {} keySource[p] = 'none'; } }
loadSavedKeys();
function saveKey(provider, key, { persistOnly = false } = {}) {
  const name = KEY_ENV[provider]; if (!name) throw problem('Unknown provider.');
  const environmentWins = keySource[provider] === 'env';
  if (environmentWins && !persistOnly) throw problem('This key is set by the server environment; change it there.', 409);
  const k = String(key || '').trim(); if (!/^[\x21-\x7e]{20,300}$/.test(k)) throw problem('That does not look like an API key.');
  const fs = require('node:fs'); fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  if (fs.lstatSync(keyDir()).isSymbolicLink() || fs.existsSync(keyPath(provider)) && fs.lstatSync(keyPath(provider)).isSymbolicLink()) throw problem('Unsafe local key storage.', 409);
  const temporary = keyPath(provider) + '.' + require('node:crypto').randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, k + '\n', { mode: 0o600, flag:'wx' }); fs.renameSync(temporary,keyPath(provider)); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  if (environmentWins) return keys();
  process.env[name] = k; keySource[provider] = 'file'; if (provider === 'openai') process.env.HOLODEK_OPENAI_KEY_PLACEHOLDER = ''; if (provider === 'xai') xaiClient = null; if (provider === 'groq') groqClient = null; if (provider === 'openai') client = null;
  return keys();
}
const keys = () => Object.fromEntries(Object.keys(KEY_ENV).map(p => [p, keySource[p] || 'none']));
const storedKeys = () => Object.fromEntries(Object.keys(KEY_ENV).map(p => { try { const stat=require('node:fs').lstatSync(keyPath(p)); return [p,stat.isFile() && !stat.isSymbolicLink() && stat.size>0]; } catch { return [p,false]; } }));
function getXaiClient() { // key from the environment only; never logged
  if (!process.env.XAI_API_KEY) return null;
  const website = require('./websiteAi');
  if (website.service().useForGameModels()) return website.modelClient(website.service(), 'xai');
  return xaiClient ||= new (require('openai').OpenAI)({ apiKey: process.env.XAI_API_KEY, baseURL: process.env.HOLODEK_XAI_URL || 'https://api.x.ai/v1', timeout: 60000, maxRetries: 0 });
}
function getGroqClient(){
  if(!process.env.GROQ_API_KEY)return null;
  const website=require('./websiteAi');if(website.service().useForGameModels())return website.modelClient(website.service(),'groq');
  return groqClient ||= new (require('openai').OpenAI)({apiKey:process.env.GROQ_API_KEY,baseURL:'https://api.groq.com/openai/v1',timeout:60000,maxRetries:0});
}
const groqRows=(env=process.env)=>env.GROQ_API_KEY?catalog.filter(row=>row.provider==='groq'):[];
const xaiRows = (env = process.env) => env.XAI_API_KEY ? catalog.filter(row => row.provider === 'xai') : [];
const providerOf = row => row.provider || 'openai';
function getLocalClient(profileOrId) { // Remote engines proxy back through Website AI; holodek-1 inference stays on the PC.
  const id = typeof profileOrId === 'string' ? profileOrId : profileOrId?.id || service.snapshot().id;
  if (id === 'holodek-1' && process.env.HOLODEK_REMOTE_ENGINE !== '1') return require('./pcModelHost').modelClient();
  const website = require('./websiteAi');
  if (process.env.HOLODEK_REMOTE_ENGINE === '1' || website.service().useForGameModels()) return website.modelClient();
  return localClient ||= new (require('openai').OpenAI)({ apiKey: 'ollama-local', baseURL: OLLAMA_URL(), timeout: 600000, maxRetries: 0 });
}
async function probeLocal(fetchImpl = globalThis.fetch) { // which local catalog models Ollama has pulled; [] if Ollama is not running
  const website = require('./websiteAi').service(), remote = website.useForGameModels();
  const tags = value => new Set((value?.models || []).map(model => model.name || model.model));
  const pc = async () => {
    try {
      const url = require('./pcModelHost').localOllamaURL();
      const response = await fetchImpl(url.replace(/\/v1$/, '') + '/api/tags', { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) return new Set();
      return tags(await response.json());
    } catch { return new Set(); }
  };
  const web = async () => { try { return tags((await website.status()).worker); } catch { return new Set(); } };
  const [onPC, onWebsite] = await Promise.all([pc(), remote ? web() : Promise.resolve(null)]);
  return catalog.filter(row => {
    if (!row.local) return false;
    const have = row.id === 'holodek-1' || !remote ? onPC : onWebsite;
    return have.has(row.apiModel) || have.has(row.apiModel + ':latest');
  });
}
const DEFAULT_MODEL = 'gpt-6-luna';
let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY || process.env.HOLODEK_OPENAI_KEY_PLACEHOLDER === '1') return null;
  client ||= new (require('openai').OpenAI)({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
  const website = require('./websiteAi');
  if (website.service().useForGameModels()) return { ...website.modelClient(website.service(), 'openai'), models: client.models };
  return client;
}
// Optional CotG-only rows (cotgOnly: true) are usable only during Children of the Grave play. No row uses it now; holodek-1 is unrestricted.
const cotgPlay = () => { try { return require('./settingLayer').isCotGPlay() === true; } catch { return false; } };
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
function createModelService({ clientFor = getClient, now = Date.now, initial = DEFAULT_MODEL, localProbe = probeLocal, isCotG = cotgPlay } = {}) {
  const context = new AsyncLocalStorage();
  let selected = initial, revision = 0, cached = null, pending = null, availabilityRevision = 0;
  if (initial !== 'original' && !catalog.some(row => row.id === initial)) throw problem('Unsupported initial game model.');
  const current = () => ({ id: selected, revision, name: catalog.find(row => row.id === selected)?.name || 'Original settings' });
  const snapshot = () => context.getStore() || current();
  const withSnapshot = callback => require('./websiteAi').service().withSnapshot(() =>
    context.getStore() ? callback() : context.run(Object.freeze(current()), callback));
  function profile(requested) {
    const id = snapshot().id === 'original' ? requested : snapshot().id;
    let found = catalog.find(row => row.id === id);
    if (found?.cotgOnly && !isCotG()) found = catalog.find(row => row.id === found.fallback); // outside CotG play: default local model
    if (!found) throw problem('This game model has no verified non-reasoning configuration. Choose a supported model in Menu > Game Model.');
    return found;
  }
  async function available(refresh = false) {
    if (cached && (!refresh || now() - cached.at < 10000) && now() - cached.at < 120000) return cached;
    if (pending) return pending;
    const discoveryRevision = availabilityRevision;
    const work = pending = (async () => {
      let local = [];
      try {
        const c = clientFor(); local = (await localProbe()).concat(xaiRows(),groqRows());
        const localWarning = local.some(r => r.local) ? null : 'Local models are unavailable. holodek-1 requires PC Ollama; gpt-oss-20b uses the selected PC/website Ollama.';
        if (!c) return { at: now(), models: local, warning: local.length ? null : 'The server needs an OpenAI API key to check model availability.' };
        const result = await c.models.list({ timeout: 15000, maxRetries: 0 });
        if (!Array.isArray(result.data)) throw problem('Invalid model list.');
        const listed = new Map(result.data.map(row => [row.id, row]));
        return { at: now(), models: catalog.filter(row => {
          const model = listed.get(row.id), shutdown = model?.shutdown_date || row.shutdownDate;
          return !row.local && providerOf(row) === 'openai' && model && (!shutdown || shutdown > new Date(now()).toISOString().slice(0, 10));
        }).map(row => ({ ...row, shutdownDate: listed.get(row.id).shutdown_date || row.shutdownDate })).concat(local), warning: null, localWarning };
      } catch {
        return { at: now(), models: local, warning: 'Could not verify OpenAI model access. Your current setting is unchanged. Try refreshing the list.' };
      }
    })();
    try { const result = await work; if (discoveryRevision === availabilityRevision) cached = result; return result; }
    finally { if (pending === work) pending = null; }
  }
  // Every catalog model, with why it can or cannot run right now (both menus list them all).
  function statusOf(row, list) {
    const p = providerOf(row), has = id => list.models.some(m => m.id === id);
    if (row.local) return has(row.id) ? 'ready' : 'not running';
    if (p === 'groq') return process.env.GROQ_API_KEY ? 'ready' : 'needs key';
    if (p === 'xai') return process.env.XAI_API_KEY ? 'ready' : 'needs key';
    if (!process.env.OPENAI_API_KEY || process.env.HOLODEK_OPENAI_KEY_PLACEHOLDER === '1') return 'needs key';
    return has(row.id) ? 'ready' : 'not verified';
  }
  const noteOf = row => row.note || (row.shutdownDate ? 'Paid (OpenAI); retiring ' + row.shutdownDate : 'Paid (OpenAI API)');
  async function view(refresh = false) {
    const list = await available(refresh);
    return { current: current(), all: catalog.map(row => ({ ...row, provider: providerOf(row), note: noteOf(row), status: statusOf(row, list) })), models: list.models.map(row => ({ ...row, provider: providerOf(row), note: row.note || (row.shutdownDate ? 'Paid (OpenAI); retiring ' + row.shutdownDate : 'Paid (OpenAI API)') })), warning: list.warning, localWarning: list.localWarning || null, startupNote, keys: keys(), storedKeys: storedKeys(), checkedAt: new Date(list.at).toISOString(),
      reasoning: 'off', scope: 'shared-game', applies: 'next-action' };
  }
  async function select(id, expectedRevision) {
    if (typeof id !== 'string' || id !== 'original' && !catalog.some(row => row.id === id)) throw problem('Choose a supported non-reasoning game model.');
    if (!Number.isInteger(expectedRevision)) throw problem('Refresh model settings before changing the model.');
    const list = id === 'original' ? null : await available();
    if (expectedRevision !== revision) throw problem('The game model changed in another window. Refresh this panel before choosing again.', 409);
    const row = catalog.find(r => r.id === id);
    if (row?.id === 'holodek-1' && !list.models.some(r => r.id === id))
      throw problem('holodek-1 is not installed or available in PC Ollama. Check the PC loopback HOLODEK_OLLAMA_URL. No other model was substituted.', 409);
    if (row?.local && row.id !== 'holodek-1' && require('./websiteAi').service().useForGameModels() && !list.models.some(r => r.id === id))
      throw problem(row.id + ' is not installed in website Ollama. No other model was substituted.', 409);
    if (row?.provider === 'groq' && !process.env.GROQ_API_KEY) throw problem('Groq needs an API key. Enter it to use this model.',428);
    if (row?.provider === 'xai' && !process.env.XAI_API_KEY) throw problem('Grok needs an xAI API key. Enter it to use this model.', 428);
    if (list && !row?.local && !['xai','groq'].includes(row?.provider) && !list.models.some(r => r.id === id)) throw problem('That model is not currently verified as available to the server API key.', 409);
    if (selected !== id) { selected = id; revision++; }
    return current();
  }
  function restore(id) {
    if (id !== 'original' && !catalog.some(row => row.id === id)) throw problem('Unsupported saved game model.');
    selected = id; revision++; return current();
  }
  const invalidate = () => { availabilityRevision++; cached = null; pending = null; };
  return { current, snapshot, withSnapshot, profile, view, select, restore, invalidate, getClient: clientFor };
}
const service = createModelService();
// Startup default: Luna, unless explicitly configured. Local model availability never changes this choice.
// Only chooses the starting model; it is never a per-call fallback.
const LOCAL_DEFAULT = 'gpt-oss-20b';
let startupNote = null;
async function chooseStartupDefault(models = service, { env = process.env, log = console.info } = {}) {
  const wanted = String(env.HOLODEK_DEFAULT_MODEL || '').trim();
  if (wanted) { try { models.restore(wanted); startupNote = 'Default model from HOLODEK_DEFAULT_MODEL: ' + models.current().name; }
    catch { startupNote = 'HOLODEK_DEFAULT_MODEL=' + wanted + ' is not a supported model; using ' + models.current().name + '.'; } log('[GameModel]', startupNote); return models.current(); }
  if (models.current().revision !== 0) return models.current(); // a player already chose a model
  if (models.current().id !== DEFAULT_MODEL) models.restore(DEFAULT_MODEL);
  startupNote = 'Default model: GPT-6 Luna. Local models are available by explicit selection.';
  log('[GameModel]', startupNote); return models.current();
}
function install(app, models = service) {
  if (models === service) chooseStartupDefault(models).catch(() => {});
  app.get('/game-models', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await models.view(req.query?.refresh === '1'));
  });
  app.post('/provider-key', (req, res) => { res.setHeader('Cache-Control', 'no-store');
    if (!require('./websiteAi').localRequest(req)) return res.status(403).json({error:'Enter provider keys from the local game window.'});
    try { const k = saveKey(String(req.body?.provider || ''), req.body?.key, { persistOnly:req.body?.persistOnly===true }); console.info('[GameModel] key saved for', req.body.provider); res.json({ keys: k, storedKeys:storedKeys() }); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not save the key.' }); } });
  app.post('/game-models', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const current = await models.select(req.body?.id, req.body?.revision);
      console.info('[GameModel]', JSON.stringify({ ...current, reasoning: 'off', applies: 'next-action' }));
      res.json({ current, reasoning: 'off', applies: 'next-action' });
    } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to change the game model.' }); }
  });
  // Express continuations and their background work inherit this action's model.
  app.use(['/processInput7', '/startGameWithCharacter', '/beginCharacterGeneration', '/rerollCharacterSprite',
    '/character-traits', '/spells/cast', '/room-population/engage', '/room-population/autonomy'],
  (_req, _res, next) => models.withSnapshot(next));
}
module.exports = { ...service, DEFAULT_MODEL, catalog, createModelService, install, getLocalClient, getXaiClient, getGroqClient, providerOf, probeLocal, OLLAMA_URL, chooseStartupDefault, LOCAL_DEFAULT, saveKey, keys, storedKeys, loadSavedKeys };
