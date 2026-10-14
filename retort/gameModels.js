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
  ['gpt-4o-mini', 'GPT-4o Mini', 'Original lightweight game model', false, '2027-01-14']
].map(([id, name, description, reasoningNone, shutdownDate]) => Object.freeze({
  id, name, description, reasoningNone, shutdownDate: shutdownDate || null,
  documentation: 'https://developers.openai.com/api/docs/models/' + id
})));
let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return client ||= new (require('openai').OpenAI)({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
}
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
function createModelService({ clientFor = getClient, now = Date.now, initial = 'original' } = {}) {
  const context = new AsyncLocalStorage();
  let selected = initial, revision = 0, cached = null, pending = null;
  if (initial !== 'original' && !catalog.some(row => row.id === initial)) throw problem('Unsupported initial game model.');
  const current = () => ({ id: selected, revision, name: catalog.find(row => row.id === selected)?.name || 'Original settings' });
  const snapshot = () => context.getStore() || current();
  const withSnapshot = callback => context.getStore() ? callback() : context.run(Object.freeze(current()), callback);
  function profile(requested) {
    const id = snapshot().id === 'original' ? requested : snapshot().id;
    const found = catalog.find(row => row.id === id);
    if (!found) throw problem('This game model has no verified non-reasoning configuration. Choose a supported model in Menu > Game Model.');
    return found;
  }
  async function available(refresh = false) {
    if (cached && (!refresh || now() - cached.at < 10000) && now() - cached.at < 120000) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const c = clientFor();
        if (!c) return { at: now(), models: [], warning: 'The server needs an OpenAI API key to check model availability.' };
        const result = await c.models.list({ timeout: 15000, maxRetries: 0 });
        if (!Array.isArray(result.data)) throw problem('Invalid model list.');
        const listed = new Map(result.data.map(row => [row.id, row]));
        return { at: now(), models: catalog.filter(row => {
          const model = listed.get(row.id), shutdown = model?.shutdown_date || row.shutdownDate;
          return model && (!shutdown || shutdown > new Date(now()).toISOString().slice(0, 10));
        }).map(row => ({ ...row, shutdownDate: listed.get(row.id).shutdown_date || row.shutdownDate })), warning: null };
      } catch {
        return { at: now(), models: [], warning: 'Could not verify OpenAI model access. Your current setting is unchanged. Try refreshing the list.' };
      }
    })();
    try { cached = await pending; return cached; } finally { pending = null; }
  }
  async function view(refresh = false) {
    const list = await available(refresh);
    return { current: current(), models: list.models, warning: list.warning, checkedAt: new Date(list.at).toISOString(),
      reasoning: 'off', scope: 'shared-game', applies: 'next-action' };
  }
  async function select(id, expectedRevision) {
    if (typeof id !== 'string' || id !== 'original' && !catalog.some(row => row.id === id)) throw problem('Choose a supported non-reasoning game model.');
    if (!Number.isInteger(expectedRevision)) throw problem('Refresh model settings before changing the model.');
    const list = id === 'original' ? null : await available();
    if (expectedRevision !== revision) throw problem('The game model changed in another window. Refresh this panel before choosing again.', 409);
    if (list && !list.models.some(row => row.id === id)) throw problem('That model is not currently verified as available to the server API key.', 409);
    if (selected !== id) { selected = id; revision++; }
    return current();
  }
  return { current, snapshot, withSnapshot, profile, view, select, getClient: clientFor };
}
const service = createModelService();
function install(app, models = service) {
  app.get('/game-models', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await models.view(req.query?.refresh === '1'));
  });
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
module.exports = { ...service, catalog, createModelService, install };
