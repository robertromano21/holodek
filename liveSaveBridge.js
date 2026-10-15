'use strict';
// Temporary, save-only support for a pre-save-feature process. Read named closure
// bindings through Node's local inspector; never patch gameplay or reconstruct it.
const Inspector = require('node:inspector'), { randomUUID } = require('node:crypto');
const State = require('./saveGameState');
async function bindings(fn, names) {
  const session = new Inspector.Session(), token = '__holodekSave_' + randomUUID().replace(/-/g, '');
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  session.connect(); globalThis[token] = fn;
  try {
    const { result } = await post('Runtime.evaluate', { expression: `globalThis.${token}` });
    const props = await post('Runtime.getProperties', { objectId: result.objectId });
    const scopes = props.internalProperties?.find(p => p.name === '[[Scopes]]')?.value;
    if (!scopes?.objectId) throw Error('Cannot inspect the running state safely.');
    const list = await post('Runtime.getProperties', { objectId: scopes.objectId }), found = new Map();
    for (const scope of list.result.filter(p => /^\d+$/.test(p.name))) {
      const vars = await post('Runtime.getProperties', { objectId: scope.value.objectId });
      for (const item of vars.result) if (names.includes(item.name) && !found.has(item.name)) found.set(item.name, item.value);
    }
    if (names.some(name => !found.has(name))) throw Error('Cannot capture all live state bindings: ' + names.filter(n => !found.has(n)).join(', '));
    const args = names.map(name => { const v = found.get(name); return v.objectId ? { objectId: v.objectId } : Object.hasOwn(v, 'value') ? { value: v.value } : {}; });
    const called = await post('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration:
      `function(){ globalThis.${token} = Object.fromEntries(${JSON.stringify(names)}.map((name,i)=>[name,arguments[i]])); }`, arguments: args });
    if (called.exceptionDetails) throw Error('Live checkpoint capture failed: ' + called.exceptionDetails.text);
    return globalThis[token];
  } finally { delete globalThis[token]; session.disconnect(); }
}
async function install(app) {
  const state = require('./sharedState'), handler = app._router.stack.find(layer => layer.route?.path === '/processInput7')?.route.stack[0].handle;
  if (!handler) throw Error('Game server route not found.');
  // Probe first: failure must leave the old process and router unchanged.
  await bindings(handler, ['inputTaskInFlight', 'npcAutonomyTickInFlight']);
  State.validate(State.clone(await bindings(state.getDungeonRunId, State.FIELDS)));
  return require('./saveGames').install(app, {
    state, capture: async () => State.clone(await bindings(state.getDungeonRunId, State.FIELDS)),
    isBusy: async () => { const flags = await bindings(handler, ['inputTaskInFlight', 'npcAutonomyTickInFlight']);
      return flags.inputTaskInFlight || flags.npcAutonomyTickInFlight || !!require('./retort/actionDice').actionDice.active; },
    liveBridge: true
  });
}
module.exports = { bindings, install };
