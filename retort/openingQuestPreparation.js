'use strict';
const { randomUUID } = require('node:crypto');
const Build = require('./roomBuildState'), Helpers = require('./roomHelpers');
const labels = ['Current Quest', 'Next Artifact', 'Next Boss', 'Next Boss Room', 'Boss Room Coordinates'];
const coords = key => Object.fromEntries(key.split(',').map((v, i) => [['x', 'y', 'z'][i], Number(v)]));
const line = (text, label) => text.match(new RegExp('^' + label + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim();
const meaningful = value => typeof value === 'string' && value.trim() && !/^(none|null|undefined)$/i.test(value.trim());
function empty(state) { return !meaningful(state.getCurrentQuest?.()) && !(state.getCurrentTasks?.() || []).length && !(state.getCurrentTaskIndex?.() || 0); }
const entryPending = state => !(state.getCurrentTasks?.() || []).length && !(state.getCurrentTaskIndex?.() || 0);
function fingerprint(state, model) {
  return Build.hash([state.getDungeonRunId(), state.getRestoreRevision?.(), model,
    JSON.parse(state.getRoomNameDatabase() || '{}')['0,0,0']?.setting]);
}
function append(base = [], proposed = [], current = [], at) {
  const name = row => row?.id || row?.name || JSON.stringify(row);
  const old = new Map(base.map(row => [name(row), row])), out = structuredClone(current);
  for (const row of proposed) {
    const id = name(row), before = old.get(id);
    if (Build.equal(before, row)) continue;
    const index = out.findIndex(value => name(value) === id);
    if (index >= 0) out[index] = Build.merge(before, row, out[index], at + '.' + id);
    else if (before && at.endsWith('.objects')) continue; // A pickup during preparation is not permission to respawn the item.
    else if (before) throw Error('A prepared quest target was removed: ' + at + '.' + id);
    else out.push(structuredClone(row));
  }
  if (base.some(row => !proposed.some(value => name(value) === name(row)))) throw Error('Quest preparation cannot remove existing content.');
  return out;
}
function mergeRoom(base, proposed, current, at) {
  if (Build.equal(base, proposed)) return structuredClone(current);
  if (!base) {
    if (current && !Build.equal(current, proposed)) throw Error('Quest destination was claimed by another build: ' + at);
    return structuredClone(proposed);
  }
  const out = { ...current };
  for (const field of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
    if (Build.equal(base[field], proposed[field])) continue;
    if (['objects', 'inscriptions', 'readables'].includes(field)) out[field] = append(base[field], proposed[field], current?.[field], at + '.' + field);
    else {
      // A private author never owns exploration counters, prepared geometry receipts or appearance.
      if (['visited', 'preparedBuild', 'exhaustionLimit', 'attemptedSearches', 'trapTriggered', 'crossGameHistory'].includes(field)) continue;
      out[field] = Build.merge(base[field], proposed[field], current?.[field], at + '.' + field);
    }
  }
  return out;
}
function mergedRooms(artifact, current) {
  const next = structuredClone(current);
  for (const key of Object.keys(artifact.rooms)) {
    if (!Build.coordinate.test(key)) throw Error('Invalid quest destination.');
    if (!Build.equal(artifact.base[key], artifact.rooms[key])) next[key] = mergeRoom(artifact.base[key], artifact.rooms[key], current[key], key);
  }
  return next;
}
function bindIntroduction(task, db, targetKey) {
  if (!task.story) return task;
  const story = task.story, oldKey = story.hook.roomKey;
  const writing = db[oldKey]?.inscriptions?.find(row => row.id === story.fallback?.readableId);
  if (!writing) throw Error('Prepared quest has no accessible fallback introduction.');
  const room = db[targetKey]; room.inscriptions ||= [];
  if (!room.inscriptions.some(row => row.id === writing.id)) room.inscriptions.push(structuredClone(writing));
  story.hook = { kind: 'writing', roomKey: targetKey, roomName: room.name, name: writing.name, readableId: writing.id };
  const hook = story.stages.find(stage => stage.id === 'hook');
  Object.assign(hook, { kind: 'read', roomKey: targetKey, name: writing.name, readableId: writing.id, text: writing.chapters[0].text });
  delete hook.actor;
  task.hardRequirements = (task.hardRequirements || []).map(r => r.check === 'quest_story_complete' ? { ...r, coords: targetKey } : r);
  room.questStories ||= {}; room.questStories[story.id] = story;
  room.questScenes ||= {}; room.questScenes[story.id] = { source: 'engine-quest-scene-v1',
    taskBinding: require('./questProgress').taskBinding(task), stage: 'hook', revision: 0, history: [], completed: false };
  if (oldKey !== targetKey) { delete db[oldKey]?.questScenes?.[story.id]; delete db[oldKey]?.questStories?.[story.id]; }
  if (!require('./questScenes').valid(story, db)) throw Error('Prepared introduction does not fit the selected room.');
  return task;
}
async function authorIntroduction($, state, task) {
  if (!task.story) return;
  const C = require('./generationContracts'), db = JSON.parse(state.getRoomNameDatabase());
  const story = task.story, room = db[story.hook.roomKey];
  const writing = room?.inscriptions?.find(row => row.id === story.fallback?.readableId);
  if (!writing) throw Error('Opening quest writing is missing.');
  const { result } = await require('./holodekRoomWork').questReply($, 'quest-opening-introduction', {
    title: C.nonblankText(), name: C.nonblankText(), hook: C.nonblankText(), resolution: C.nonblankText(), completion: C.nonblankText(),
    acceptLabel: C.nonblankText(), finishLabel: C.nonblankText()
  }, { quest: state.getCurrentQuest(), task: { desc: task.desc, requiredElements: task.requiredElements },
    campaign: db['0,0,0']?.setting, excludedNames: Object.values(db).flatMap(r => (r.inscriptions || []).map(w => w.name)) },
  'Write the opening quest introduction and its eventual conclusion from this campaign, not a stock covenant or another campaign. The arrival room and speaker are not chosen yet: do not invent either, state a direction, or claim the player accepted or completed anything. Preserve the exact bound objective names and locations. Give the readable message a concrete lowercase name, not a repeated existing document name. There are no character-count or word-count limits on authored text. Author physical-fiction text and natural button labels only; no new conditions, rewards or mechanics.');
  const name = require('./holodekObjectName').validate({ name: result.name });
  if (Object.values(db).some(r => (r.inscriptions || []).some(w => w.name === name && w.id !== writing.id))) throw Error('Opening message duplicates an existing document.');
  const oldName = writing.name;
  Object.assign(writing, { name, title: result.title, backstory: result.hook, chapters: [{ title: result.title, text: result.hook }] });
  story.title = result.title; story.fallback.name = name;
  for (const stage of story.stages) {
    if (stage.name === oldName) stage.name = name;
    if (stage.fallback?.name === oldName) stage.fallback.name = name;
    if (stage.id === 'hook') { stage.text = result.hook; if (stage.options?.[0]) stage.options[0].label = result.acceptLabel; }
    if (stage.id === 'resolution') { stage.text = result.resolution; for (const option of stage.options || []) if (option.action === 'finish') option.label = result.finishLabel; }
    if (stage.id === 'complete') stage.text = result.completion;
  }
  for (const r of Object.values(db)) {
    if (r.questStories?.[story.id]) r.questStories[story.id] = story;
    if (r.questScenes?.[story.id]) r.questScenes[story.id].taskBinding = require('./questProgress').taskBinding(task);
    for (const actor of Object.values(r.inhabitants?.actors || {})) for (const hook of actor.questHooks || [])
      if (hook.storyId === story.id) hook.text = result.hook;
  }
  state.setRoomNameDatabase(JSON.stringify(db)); state.setCurrentTasks([task]);
}
function installPhysical(dungeon, room, task, key) {
  const next = structuredClone(dungeon), I = require('../assets/dungeonInhabitants');
  const present = new Set((next.sceneObjects || []).map(item => item.name));
  const missing = (room.objects || []).filter(item => !present.has(item.name));
  if (missing.length) {
    const existing = next.sceneObjects || [];
    const temporary = { ...next, sceneObjects: [] };
    const placed = require('./sceneRoomBuilder').placeSceneObjects(temporary, { generation: next.generation,
      textHash: key, indoor: room.indoor, props: missing.map(item => ({ id: 'quest-object:' + I.hash(item.name),
        name: item.name, declaredType: item.type, magic: item.properties?.magic || 0 })) });
    if (placed.length !== missing.length) throw Error('Quest objects have no reachable placement in ' + key);
    const occupied = new Set(existing.map(item => item.x + ',' + item.y));
    const available = I.reachable(next).filter(p => next.cells[p.x + ',' + p.y]?.tile === 'floor' &&
      !occupied.has(p.x + ',' + p.y) && (p.x !== next.start.x || p.y !== next.start.y));
    for (const item of placed) {
      if (occupied.has(item.x + ',' + item.y)) {
        const point = available.find(p => !occupied.has(p.x + ',' + p.y));
        if (!point) throw Error('Quest object would overlap saved scenery.'); Object.assign(item, point);
      }
      occupied.add(item.x + ',' + item.y);
    }
    next.sceneObjects = [...existing, ...placed];
  }
  require('../assets/questWritings').apply(next, room);
  if (task.story?.hook.roomKey === key && !next.questWritings?.some(row => row.id === task.story.fallback.readableId))
    throw Error('The opening quest introduction has no reachable placement.');
  for (const element of task.requiredElements || []) if (element.placement === key) {
    if (element.type === 'monster' && !room.inhabitants?.actors?.[element.name]) throw Error('A required quest resident is not ready.');
    if (['object', 'key'].includes(element.type) && room.objects?.some(item => item.name === element.name) &&
        !next.sceneObjects?.some(item => item.name === element.name)) throw Error('A required quest object is not ready.');
  }
  require('../assets/dungeonGeometryStamp').stamp(next, key);
  return next;
}
function createService(state, { website = require('./websiteAi').service(), models = require('./gameModels'),
  spawn, logger = console, timeoutMs = 20 * 60 * 1000 } = {}) {
  let entry = null, closed = false;
  const log = (phase, extra = {}) => logger.info('[OpeningQuestPreparation]', JSON.stringify({ phase, runId: entry?.job.runId, id: entry?.job.id, ...extra }));
  const valid = e => !closed && state.getDungeonRunId() === e.job.runId && fingerprint(state, e.job.model) === e.fingerprint &&
    models.current().id === e.job.model && models.current().revision === e.job.modelRevision &&
    Helpers.policy(website).enabled && Helpers.policy(website).revision === e.helperRevision &&
    (e.location !== 'website' || website.view().revision === e.websiteRevision);
  function begin() {
    if (closed || !state.exportSaveState || !empty(state) || state.getActiveCityFloor?.() || !Helpers.policy(website).enabled) return null;
    const here = state.getLastCoords(); if (here.x || here.y || here.z) return null;
    const previous = entry && valid(entry) ? entry : null;
    if (previous && (previous.phase !== 'failed' || previous.attempt >= 3)) return previous;
    entry?.cancel?.();
    const snapshot = state.exportSaveState(), model = models.current(), policy = Helpers.policy(website);
    const db = JSON.parse(snapshot.roomNameDatabaseString), origin = db['0,0,0']; if (!origin?.populationComplete) return null;
    const job = { id: randomUUID(), runId: state.getDungeonRunId(), key: '0,0,0', stage: 'quest', name: origin.name,
      coords: { x: 0, y: 0, z: 0 }, model: model.id, modelRevision: model.revision };
    // Reserve a boss coordinate before adjacent topology is dispatched, without exposing its identity.
    const registry = require('./roomBuildCoordination').registryFor(state); registry.assign(job);
    const claimed = new Set(registry.describe(job, new Map(), db).reservations.map(row => row.key));
    const bossKey = Array.from({ length: 5 }, (_, i) => `${i + 2},0,0`).find(key => !db[key] && !claimed.has(key));
    if (!bossKey) { registry.release(job.id); return null; }
    try { registry.reserve(job, [bossKey])(); } catch { registry.release(job.id); return null; }
    job.bossKey = bossKey;
    job.assignment = registry.describe(job, new Map(), db);
    const current = entry = { job, snapshot, registry, fingerprint: fingerprint(state, model.id),
      originalContext: { quest: state.getCurrentQuest?.(), index: state.getCurrentTaskIndex?.(), tasks: state.getCurrentTasks?.() },
      helperRevision: policy.revision, websiteRevision: website.view().revision, location: policy.location,
      attempt: (previous?.attempt || 0) + 1, phase: 'running', controller: new AbortController() };
    log('started', { location: current.location, attempt: current.attempt });
    current.promise = new Promise(resolve => {
      let timer, finished = false;
      const finish = (artifact, error) => {
        if (finished) return; finished = true; clearTimeout(timer);
        current.controller.abort(); Promise.resolve(current.worker?.terminate?.()).catch(() => {});
        if (!error && !valid(current)) error = Error('Adventure or helper selection changed.');
        if (!error) try {
          if (artifact?.stage !== 'quest' || artifact.jobId !== job.id || artifact.runId !== job.runId ||
              !meaningful(artifact.quest) || !artifact.task?.id) throw Error('Incomplete opening quest artifact.');
          if (labels.some(label => !meaningful(artifact.fields?.[label])) || artifact.fields['Current Quest'] !== artifact.quest ||
              require('../assets/dungeonInhabitants').roomKey(artifact.fields['Boss Room Coordinates']) !== job.bossKey)
            throw Error('Opening quest bindings are incomplete or changed.');
          mergedRooms(artifact, JSON.parse(state.getRoomNameDatabase() || '{}'));
        } catch (failure) { error = failure; }
        current.phase = error ? 'failed' : 'ready'; current.artifact = error ? null : artifact; current.reason = error?.message || null;
        if (error) { registry.release(job.id); log('failed', { reason: error.message }); }
        else log('ready');
        resolve(current.artifact);
      };
      current.cancel = () => {
        finish(null, Error('Opening quest preparation cancelled.'));
        current.controller.abort(); Promise.resolve(current.worker?.terminate?.()).catch(() => {}); registry.release(job.id);
      };
      timer = setTimeout(() => finish(null, Error('Opening quest preparation exceeded its bounded time limit.')), timeoutMs); timer.unref?.();
      setImmediate(async () => {
        try {
          if (finished) return;
          if (spawn || current.location === 'local') {
            current.worker = spawn ? spawn(job, snapshot) : Helpers.service().local(job, snapshot);
            current.worker.on('message', message => { if (message.type === 'checkpoint') finish(message.artifact);
              else if (message.type === 'failed') finish(null, Error(message.reason)); });
            current.worker.on('error', error => finish(null, error));
            current.worker.on('exit', code => { if (!finished) finish(null, Error('Opening quest worker exited (' + code + ').')); });
          } else {
            await website.runRoomStage(job, snapshot, { background: true, signal: current.controller.signal,
              onCheckpoint: message => { current.result = message.artifact; } });
            finish(current.result);
          }
        } catch (error) { finish(null, error); }
      });
    });
    return current;
  }
  async function activate(key, { input = '' } = {}) {
    if (key === '0,0,0' || !empty(state) || !entry || !valid(entry)) return false;
    const current = entry.phase === 'failed' ? begin() || entry : entry;
    const artifact = await current.promise;
    if (!artifact || !valid(current) || !empty(state)) return false;
    const db = mergedRooms(artifact, JSON.parse(state.getRoomNameDatabase() || '{}'));
    if (!db[key]?.populationComplete) throw Error('Opening quest activation requires a completely constructed destination.');
    const task = bindIntroduction(structuredClone(artifact.task), db, key), saved = state.getRoomDungeonForSimulation(coords(key));
    if (!saved?.cells) throw Error('Opening quest destination geometry is not ready.');
    const arrival = structuredClone(saved), previous = state.getLastCoords();
    require('./roomEntry').prepare(arrival, { geoKey: key, fromKey: `${previous.x},${previous.y},${previous.z}`, input });
    const dungeon = installPhysical(arrival, db[key], task, key);
    const physical = [[key, dungeon]];
    for (const [roomKey, room] of Object.entries(db)) {
      if (roomKey === key || Build.equal(artifact.base[roomKey], artifact.rooms[roomKey])) continue;
      const existing = state.getRoomDungeonForSimulation(coords(roomKey));
      if (existing?.cells && (!room.preparedBuild || room.preparedBuild.ready)) physical.push([roomKey, installPhysical(existing, room, task, roomKey)]);
      for (const item of room.objects || []) if (!(artifact.base[roomKey]?.objects || []).some(old => old.name === item.name)) item.openingQuestId = artifact.jobId;
    }
    let text = state.getUpdatedGameConsole();
    for (const label of labels) text = text.replace(new RegExp('^' + label + ':[^\\r\\n]*', 'm'), () => label + ': ' + artifact.fields[label]);
    db['0,0,0'].openingQuestActivation = { version: 1, runId: artifact.runId, id: artifact.jobId, roomKey: key };
    // No await after validation: publish the physical room and its bindings as one host-owned commit.
    state.setRoomNameDatabase(JSON.stringify(db));
    for (const [roomKey, geometry] of physical) state.setRoomDungeon(coords(roomKey), geometry, geometry.customTiles || []);
    state.setUpdatedGameConsole(text); state.setCurrentQuest(artifact.quest); state.setCurrentTasks([task]);
    state.setCurrentTaskIndex(0); state.setQuestSeeded(true);
    current.registry.release(current.job.id); current.phase = 'activated'; log('activated', { geoKey: key }); return true;
  }
  async function close() {
    closed = true; entry?.cancel?.(); entry?.controller?.abort(); await entry?.worker?.terminate?.(); entry?.registry?.release(entry.job.id);
  }
  function cancel() { entry?.cancel?.(); entry = null; }
  function constructionContext() {
    if (!entry || !valid(entry) || entry.phase === 'failed') return null;
    if (empty(state)) return entry.originalContext;
    return entry.artifact?.quest === state.getCurrentQuest() && (state.getCurrentTaskIndex?.() || 0) === 0 &&
      require('./questProgress').taskBinding(state.getCurrentTasks?.()[0]) === entry.activeBinding ? entry.originalContext : null;
  }
  return { begin, activate: async (key, options) => { const result = await activate(key, options);
    if (result) entry.activeBinding = require('./questProgress').taskBinding(state.getCurrentTasks()[0]); return result; },
    close, cancel, constructionContext, status: () => entry ? { phase: entry.phase, runId: entry.job.runId, location: entry.location,
      attempt: entry.attempt, reason: entry.reason || null } : null };
}
const services = new WeakMap();
const service = (state, options) => { if (!services.has(state)) services.set(state, createService(state, options)); return services.get(state); };
module.exports = { createService, service, mergedRooms, bindIntroduction, authorIntroduction, installPhysical, labels, line, needed: empty, entryPending,
  constructionContext: state => services.get(state)?.constructionContext(),
  cancel: state => services.get(state)?.cancel(),
  close: state => services.get(state)?.close() };
