'use strict';
const { ensureContinuation, coordinates, keyOf, exitEntries, resolveExit, coordinateKeys, indexDatabase, indoor } = require('../assets/outdoorRoutes');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const normalize = raw => [...new Set(exitEntries(raw).map(entry => entry.direction).filter(Boolean))].slice(0, 10);

function cloneMetadata(value, budget = { remaining: 16000, nodes: 1024 }, depth = 0, seen = new Set()) {
  if (budget.remaining < 4 || budget.nodes-- <= 0 || depth > 7) return null;
  if (typeof value === 'string') {
    let copy = value.slice(0, 1500);
    while (JSON.stringify(copy).length > budget.remaining) copy = copy.slice(0, Math.floor(copy.length / 2));
    budget.remaining -= JSON.stringify(copy).length;
    return copy;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) {
    const size = JSON.stringify(value).length;
    if (size > budget.remaining) return null;
    budget.remaining -= size;
    return value;
  }
  if (!record(value) && !Array.isArray(value) || seen.has(value)) return null;
  seen.add(value);
  budget.remaining -= 2;
  const copy = Array.isArray(value) ? [] : {};
  const priority = ['type', 'status', 'actionKind', 'index', 'tasks', 'elements', 'requiredElements', 'hardRequirements', 'actionRequirements'];
  const keys = Array.isArray(value) ? Array.from({ length: Math.min(value.length, 8) }, (_, i) => i) :
    [...new Set([...priority.filter(key => Object.hasOwn(value, key)), ...Object.keys(value).slice(0, 32)])].slice(0, 32);
  for (const key of keys) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || String(key).length > 80) continue;
    const size = Array.isArray(value) ? 1 : JSON.stringify(key).length + 2;
    if (budget.remaining < size + 4 || budget.nodes <= 0) break;
    budget.remaining -= size;
    copy[key] = cloneMetadata(value[key], budget, depth + 1, seen);
  }
  seen.delete(value);
  return copy;
}

function boundedTasks(tasks, taskIndex) {
  if (!Array.isArray(tasks)) return [];
  const mapped = tasks.slice(0, 8).findIndex(task => record(task) && task.index === taskIndex);
  const priority = [...new Set([mapped >= 0 ? mapped : taskIndex, ...Array.from({ length: Math.min(tasks.length, 8) }, (_, i) => i)])];
  const budget = { remaining: 6000, nodes: 1024 }, selected = [];
  for (const index of priority) {
    if (selected.length === 8 || !record(tasks[index])) continue;
    const copy = cloneMetadata(tasks[index], budget);
    if (!record(copy)) continue;
    const original = Number.isSafeInteger(tasks[index].index) && tasks[index].index >= 0 ? tasks[index].index : index;
    selected.push({ position: index, index: original, copy });
  }
  if (taskIndex < 8) selected.sort((a, b) => a.position - b.position);
  return selected.map((entry, position) => {
    // Compacted snapshots need original indices, not their new array positions.
    if (entry.index !== position) entry.copy.index = entry.index;
    return entry.copy;
  });
}

function cloneQuest(quest) {
  if (!record(quest)) return null;
  const taskIndex = Number.isSafeInteger(quest.taskIndex) && quest.taskIndex >= 0 ? quest.taskIndex : 0;
  return cloneMetadata({ ...quest, ...(Array.isArray(quest.tasks) ? { tasks: boundedTasks(quest.tasks, taskIndex) } : {}) });
}

function consoleLine(consoleText, label) {
  const matches = [...text(consoleText).matchAll(new RegExp(`^[ \\t]*${label}:[ \\t]*([^\\r\\n]*)`, 'gmi'))];
  return matches.length === 1 ? matches[0][1].trim() : '';
}

function propagateComplexIdentity(database, coords) {
  coords = coordinates(coords);
  if (!coords) return;
  const { rooms } = indexDatabase(database), key = keyOf(coords), room = rooms.get(key);
  if (indoor(room) !== true) return;
  room.complexId ||= key === '0,0,0' ? 'ruined-temple' : `site:${key}`;
  for (const direction of normalize(room.exits)) {
    const target = rooms.get(resolveExit(coords, direction, room.exits).targetKey);
    if (indoor(target) === true && !target.complexId) target.complexId = room.complexId;
  }
}

function snapshotQuestContext(state = {}, consoleText = '') {
  const read = (method, fallback) => typeof state?.[method] === 'function' ? state[method]() : fallback;
  const rawIndex = read('getCurrentTaskIndex', 0);
  const taskIndex = Number.isSafeInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
  return { currentQuest: (text(read('getCurrentQuest', '')) || consoleLine(consoleText, 'Current Quest')).slice(0, 1500),
    taskIndex, tasks: boundedTasks(read('getCurrentTasks', []), taskIndex),
    nextBoss: consoleLine(consoleText, 'Next Boss').slice(0, 250),
    nextBossRoom: consoleLine(consoleText, 'Next Boss Room').slice(0, 250),
    bossCoordinates: consoleLine(consoleText, 'Boss Room Coordinates').slice(0, 150),
    nextArtifact: consoleLine(consoleText, 'Next Artifact').slice(0, 250) };
}

function buildRoomWorldContext(database, coords, options = {}) {
  coords = coordinates(coords);
  options = record(options) ? options : {};
  const { rooms } = indexDatabase(database), key = coords ? keyOf(coords) : null;
  const room = rooms.get(key) || {}, sourceInside = indoor(room);
  const neighbors = coords ? normalize(options.exits ?? room.exits).map(direction => {
    const resolved = resolveExit(coords, direction, room.exits, options.exits);
    const target = rooms.get(resolved.targetKey) || {}, targetInside = indoor(target);
    return { direction, coordinates: resolved.targetKey, name: text(typeof target === 'string' ? target : target.name).slice(0, 100),
      indoor: targetInside, complexId: text(target.complexId) || null,
      connection: sourceInside === false && targetInside === true ? 'building-entrance' :
        sourceInside === false && targetInside === false ? 'outdoor-trail' :
          sourceInside === true && targetInside === false ? 'exterior-gateway' :
            sourceInside === true && targetInside === true ? 'interior-passage' : 'unclassified', status: resolved.status };
  }) : [];
  return { version: 1, coordinates: key, indoor: sourceInside, regionId: text(room.regionId) || null,
    complexId: text(room.complexId) || (key === '0,0,0' ? 'ruined-temple' : null),
    outdoorDepth: Number.isSafeInteger(room.outdoorRegionDepth) ? room.outdoorRegionDepth : null, neighbors,
    quest: cloneQuest(options.quest),
    environmentIntent: room.environmentIntent ? cloneMetadata(room.environmentIntent) : null,
    campaign: { origin: 'Ruined Temple Entrance in Tartarus', destination: 'Hades, the City of the Dead',
      finale: 'Throne Room of Hades: confrontation with Arithus', progression: 'Existing quests, artifacts and victory checks remain authoritative.' } };
}

function supplementOutdoorRoutes(database, coords, exits, consoleText, options = {}) {
  options = record(options) ? options : {};
  const view = indexDatabase(database), parsed = coordinates(coords);
  const visitedKeys = coordinateKeys(options.visitedKeys), protectedKeys = coordinateKeys(options.protectedKeys);
  for (const match of text(consoleText).matchAll(/^[ \t]*Boss Room Coordinates:[ \t]*([^\r\n]*)/gmi)) {
    const boss = coordinates(match[1]);
    if (boss) protectedKeys.add(keyOf(boss));
  }
  for (const [key, room] of view.rooms) {
    if (room?.sceneSpec || room?.visited || room?.description || room?.roomDescription) visitedKeys.add(key);
    if (record(room?.bossGate)) {
      const targets = coordinateKeys([room.bossGate.targetKey, room.bossGate.targetCoordinates, room.bossGate.bossCoordinates]);
      for (const target of targets) protectedKeys.add(target);
      if (!targets.size || targets.has(key)) protectedKeys.add(key);
    }
  }
  const report = ensureContinuation(view.rooms, parsed, exits, { ...options, visitedKeys, protectedKeys });
  if (report.added) {
    const rawKey = view.keys.get(report.targetKey) ?? report.targetKey, target = view.rooms.get(report.targetKey);
    if (view.isMap) view.database.set(rawKey, target);
    else view.database[rawKey] = target;
  }
  const directions = normalize(report.exits), room = view.rooms.get(parsed ? keyOf(parsed) : null) || {};
  let updatedConsole = consoleText;
  if (report.added || directions.join(',') !== normalize(exits).join(',')) {
    const adjacent = directions.map(direction => {
      const resolved = resolveExit(parsed, direction, room.exits, exits), target = view.rooms.get(resolved.targetKey);
      const name = text(typeof target === 'string' ? target : target?.name) || 'Unknown destination';
      return `${direction}: ${name}${resolved.status !== 'open' ? ` (${resolved.status})` : ''}`;
    }).join(', ');
    const update = (value, label, content) => {
      const pattern = new RegExp(`^${label}:[^\\r\\n]*`, 'mi');
      return pattern.test(value) ? value.replace(pattern, `${label}: ${content}`) : `${value}${value ? '\n' : ''}${label}: ${content}`;
    };
    updatedConsole = update(update(text(consoleText), 'Exits', directions.join(', ')), 'Adjacent Rooms', adjacent);
  }
  return { report, exits: directions, updatedConsole };
}

function attachSceneWorldContext(spec, database, state, consoleText) {
  const coords = coordinates(spec?.coords);
  if (!coords) return spec;
  const quest = snapshotQuestContext(state, consoleText), key = keyOf(coords);
  const constructionTasks = quest.tasks.filter(task => {
    if (!record(task)) return false;
    const elements = [...(Array.isArray(task.elements) ? task.elements : []), ...(Array.isArray(task.requiredElements) ? task.requiredElements : [])].filter(record);
    const hard = (Array.isArray(task.hardRequirements) ? task.hardRequirements : []).filter(record);
    const actions = (Array.isArray(task.actionRequirements) ? task.actionRequirements : []).filter(record);
    const placements = [...elements.map(element => element.placement),
      ...hard.filter(requirement => requirement.check === 'at_coords').map(requirement => requirement.value),
      ...actions.filter(requirement => requirement.check === 'exit_open' || requirement.check === 'at_coords')
        .map(requirement => requirement.coords ?? requirement.value)];
    return placements.some(value => { const parsed = coordinates(value); return parsed && keyOf(parsed) === key; });
  });
  spec.worldContext = buildRoomWorldContext(database, coords, { exits: spec.exits, quest: { ...quest, tasks: constructionTasks } });
  if (!record(spec.source)) spec.source = {};
  spec.source.environmentIntent = cloneMetadata(spec.worldContext.environmentIntent);
  spec.source.questContext = { currentQuest: quest.currentQuest, taskIndex: quest.taskIndex, constructionTasks,
    completionOwner: 'existing quest adjudication; construction cannot complete tasks' };
  return spec;
}

module.exports = { buildRoomWorldContext, snapshotQuestContext, propagateComplexIdentity, supplementOutdoorRoutes, attachSceneWorldContext };
