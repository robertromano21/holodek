'use strict';
// Explicit, run/room-scoped repair of a live demo. Never restarts or regenerates the server.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const pid = Number(arg('--pid')), runId = arg('--run'), geoKey = arg('--room');
if (!Number.isInteger(pid) || pid < 1 || !/^[a-z0-9-]+$/i.test(runId || '') || !/^-?\d+,-?\d+,-?\d+$/.test(geoKey || '')) {
  throw Error('Supply --pid, --run and --room for the already-running demo.');
}
const apply = process.argv.includes('--apply');
const pacingOnly = process.argv.includes('--encounter-pacing');
const dialogueOnly = process.argv.includes('--dialogue-audience');
if (pacingOnly && dialogueOnly) throw Error('Choose just one narrowly scoped live update.');
function report(value) {
  console.log(JSON.stringify(value, null, 2));
  if (process.argv.includes('--report') || process.argv.includes('--report-path')) {
    const target = process.argv.includes('--report-path') ? path.resolve(root, arg('--report-path')) : path.join(root, 'logs', 'inhabitant-repair-report.json');
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The diagnostic report must stay inside this workspace.');
    fs.writeFileSync(target, JSON.stringify(value, null, 2));
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, startedInspector = false, nextId = 0, appObjectId;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(Error(`Inspector timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, returnByValue = true) {
  const result = await send('Runtime.evaluate', { expression, returnByValue, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return returnByValue ? result.result.value : result.result;
}
const modulePath = file => JSON.stringify(path.join(root, file));
const req = 'process.mainModule.require.bind(process.mainModule)';
async function serviceScopes(fn) {
  const details = await send('Runtime.getProperties', { objectId: fn.objectId });
  const scopes = details.internalProperties?.find(property => property.name === '[[Scopes]]')?.value;
  if (!scopes?.objectId) return [];
  const entries = await send('Runtime.getProperties', { objectId: scopes.objectId, ownProperties: true });
  const found = [];
  for (const entry of entries.result || []) if (/^\d+$/.test(entry.name) && entry.value?.objectId) {
    const variables = await send('Runtime.getProperties', { objectId: entry.value.objectId, ownProperties: true });
    if (variables.result?.some(variable => ['inputTaskInFlight', 'npcAutonomyTickInFlight'].includes(variable.name) && variable.value?.value === true)) {
      throw Error('A game action or dialogue refresh is in flight. Wait and retry. Nothing was changed.');
    }
    const service = variables.result?.find(variable => variable.name === 'populationService')?.value;
    if (service?.objectId) found.push(service.objectId);
    const app = variables.result?.find(variable => variable.name === 'app')?.value;
    if (app?.objectId) appObjectId = app.objectId;
  }
  return found;
}
async function main() {
  let targets;
  try { targets = await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(700) }).then(r => r.json()); } catch {}
  if (!targets?.length) {
    process._debugProcess(pid); startedInspector = true;
    for (let i = 0; i < 30 && !targets?.length; i++) {
      await pause(100);
      try { targets = await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(700) }).then(r => r.json()); } catch {}
    }
  }
  const url = targets?.[0]?.webSocketDebuggerUrl;
  if (!url?.startsWith('ws://127.0.0.1:9229/')) throw Error('The requested process has no local inspector. No game state was changed.');
  socket = new WebSocket(url);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(Error(message.error.message)); else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const checked = await evaluate(`(() => { const load = ${req};
    const state = load(${modulePath('sharedState.js')}); const coords = state.getLastCoords();
    return { pid: process.pid, cwd: process.cwd(), runId: state.getDungeonRunId(), geoKey: [coords.x,coords.y,coords.z].join(',') };
  })()`);
  if (checked.pid !== pid || path.resolve(checked.cwd).toLowerCase() !== root.toLowerCase() || checked.runId !== runId) {
    throw Error('The process, workspace or run does not match the requested demo. Nothing was changed.');
  }
  const serverFn = await evaluate(`${req}(${modulePath('server.js')}).broadcast`, false);
  const retortFn = await evaluate(`${req}(${modulePath('retort/retortWithUserInput.js')}).retortWithUserInput`, false);
  const services = [...new Set([...(await serviceScopes(serverFn)), ...(await serviceScopes(retortFn))])];
  if (services.length !== 2) throw Error('Could not verify both live population services. Nothing was changed.');
  if (dialogueOnly) {
    if (!appObjectId) {
      const app = await evaluate(`process._getActiveHandles().find(handle => handle.listening && handle.address?.()?.port === 3000)?._events?.request`, false);
      appObjectId = app?.type === 'function' ? app.objectId : undefined;
    }
    if (!appObjectId) throw Error('Could not verify the live command router. Nothing was changed.');
    const inspected = await send('Runtime.callFunctionOn', { objectId: appObjectId, returnByValue: true,
      functionDeclaration: `function() { return this._router?.stack.filter(layer => layer.route?.path === '/processInput7')
        .flatMap(layer => layer.route.stack.filter(handler => handler.method === 'post')).length; }` });
    if (inspected.exceptionDetails || inspected.result.value !== 1) throw Error('Could not verify exactly one live command handler. Nothing was changed.');
  }
  if (!apply) { report({ checked, services: services.length, dryRun: true }); return; }
  if (dialogueOnly) {
    await evaluate(`(() => { const load = ${req}; const state = load(${modulePath('sharedState.js')});
      const coords = state.getLastCoords();
      if (state.getDungeonRunId() !== ${JSON.stringify(runId)} || [coords.x,coords.y,coords.z].join(',') !== ${JSON.stringify(geoKey)} ||
          load(${modulePath('retort/actionDice.js')}).actionDice.active) throw Error('The active demo changed. Nothing was changed.');
      const id = ${modulePath('assets/dungeonInhabitants.js')}, cache = load('node:module')._cache;
      const original = load(id); delete cache[id];
      original.extractDialogue = load(id).extractDialogue; cache[id].exports = original;
      const turns = load(${modulePath('retort/dialogueTurns.js')});
      turns.install(state, original); turns.installLegacyPromptGuard();
      delete cache[${modulePath('retort/roomPopulation.js')}]; return true;
    })()`);
    const installed = await send('Runtime.callFunctionOn', { objectId: appObjectId, returnByValue: true,
      functionDeclaration: `function() {
        const load = ${req}, turns = load(${modulePath('retort/dialogueTurns.js')});
        const layer = this._router.stack.find(layer => layer.route?.path === '/processInput7').route.stack.find(layer => layer.method === 'post');
        if (!layer.handle._dialogueAudienceRouting) {
          const original = layer.handle;
          layer.handle = function(req, res, next) { return turns.run(req.body?.userInput, () => original(req, res, next)); };
          layer.handle._dialogueAudienceRouting = true;
        }
        return layer.handle._dialogueAudienceRouting === true;
      }` });
    if (installed.exceptionDetails || !installed.result.value) throw Error('The dialogue guard loaded, but command routing could not be activated.');
    for (const objectId of services) {
      const result = await send('Runtime.callFunctionOn', { objectId, returnByValue: true,
        functionDeclaration: `function() { const load = ${req}; this.visit = load(${modulePath('retort/roomPopulation.js')}).createPopulationService(load(${modulePath('sharedState.js')})).visit; return true; }` });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    }
    report({ checked, hotApplied: true, mode: 'dialogue-audience-only',
      message: 'Updated recipient prompts, speech filtering and ambient-chatter focus for future commands. The server was not restarted; room geometry, party, HP and inventory were not changed.' });
    return;
  }
  if (pacingOnly) {
    await evaluate(`(() => { const load = ${req}; const state = load(${modulePath('sharedState.js')});
      const coords = state.getLastCoords();
      if (state.getDungeonRunId() !== ${JSON.stringify(runId)} || [coords.x,coords.y,coords.z].join(',') !== ${JSON.stringify(geoKey)} ||
          load(${modulePath('retort/actionDice.js')}).actionDice.active) throw Error('The active demo changed. Nothing was changed.');
      const id = ${modulePath('assets/outdoorDiscovery.js')}, cache = load('node:module')._cache;
      const original = load(id); delete cache[id]; Object.assign(original, load(id)); cache[id].exports = original;
      delete cache[${modulePath('retort/roomPopulation.js')}]; return true;
    })()`);
    for (const objectId of services) {
      const result = await send('Runtime.callFunctionOn', { objectId, returnByValue: true,
        functionDeclaration: `function() { const load = ${req}; this.visit = load(${modulePath('retort/roomPopulation.js')}).createPopulationService(load(${modulePath('sharedState.js')})).visit; return true; }` });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    }
    report({ checked, hotApplied: true, mode: 'encounter-pacing-only',
      message: 'Updated future outdoor visits only. Existing room geometry, party, HP, inventory and discovered encounter positions were not changed.' });
    return;
  }
  await evaluate(`(() => { const load = ${req}; const id = load.resolve ? load.resolve(${modulePath('assets/dungeonInhabitants.js')}) : ${modulePath('assets/dungeonInhabitants.js')};
    const original = load(id); const cache = load('node:module')._cache; delete cache[id];
    const fresh = load(id); Object.assign(original, fresh); cache[id].exports = original;
    delete cache[${modulePath('retort/roomPopulation.js')}];
    return true;
  })()`);
  for (const objectId of services) {
    const result = await send('Runtime.callFunctionOn', { objectId, returnByValue: true,
      functionDeclaration: `function() { const load = ${req}; Object.assign(this, load(${modulePath('retort/roomPopulation.js')}).createPopulationService(load(${modulePath('sharedState.js')}))); return true; }` });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  }
  const repaired = await evaluate(`(() => { const load = ${req}; const state = load(${modulePath('sharedState.js')});
    const dice = load(${modulePath('retort/actionDice.js')}).actionDice;
    return load(${modulePath('retort/inhabitantRecovery.js')}).recoverRoomInhabitants(state, {
      runId: ${JSON.stringify(runId)}, geoKey: ${JSON.stringify(geoKey)}, busy: !!dice.active,
      broadcast: load(${modulePath('server.js')}).broadcast });
  })()`);
  report({ checked, targetRoom: geoKey, hotApplied: true, ...repaired });
}
main().catch(error => { report({ error: error.message }); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    if (startedInspector) {
      try { await evaluate(`${req}('node:timers').setTimeout(() => ${req}('node:inspector').close(), 100); true`); } catch {}
    }
    socket.close();
  }
});
