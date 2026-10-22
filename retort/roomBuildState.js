'use strict';
const crypto = require('node:crypto');
const coordinate = /^-?\d+,-?\d+,-?\d+$/;
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = v => v === undefined ? undefined : structuredClone(v);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const description = room => room?.description || room?.roomDescription || room?.sceneSpec?.source?.description || '';
const stages = ['population', 'geometry', 'music', 'art', 'complete'];
const conflict = (at, retryable = true) => Object.assign(Error('Concurrent room change: ' + at + '; retry from a fresh snapshot.'), { code: 'ROOM_BUILD_CONFLICT', retryable });
function changedPaths(before, after, path = '', result = []) {
  if (equal(before, after) || result.length >= 24) return result;
  if (plain(before) && plain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) changedPaths(before[key], after[key], path ? path + '.' + key : key, result);
  } else result.push(path);
  return result;
}
function scopeArtifact(job, artifact, base) {
  const scoped = clone(artifact), normalized = [];
  scoped.jobId = job.id; scoped.leaseId = job.assignment?.leaseId;
  if (job.assignment && (job.assignment.authority !== 'pc-game-server' || job.assignment.runId !== job.runId ||
      job.assignment.leaseId !== job.id || job.assignment.destination !== job.key)) throw Error('Invalid PC room assignment.');
  for (const [key, original] of Object.entries(base || {})) {
    if (key === job.key || !plain(original) || !plain(scoped.rooms[key])) continue;
    const generated = scoped.rooms[key];
    const restore = field => {
      if (equal(original[field], generated[field])) return;
      normalized.push(key + '.' + field);
      if (Object.hasOwn(original, field)) generated[field] = clone(original[field]); else delete generated[field];
    };
    const indoor = typeof original.indoor === 'boolean' ? original.indoor : original.classification?.indoor;
    if (typeof indoor === 'boolean') {
      for (const field of ['indoor', 'isIndoor', 'isOutdoor']) if (generated[field] === (field === 'isOutdoor' ? !indoor : indoor)) restore(field);
    }
    if (!Array.isArray(original.objects) && Array.isArray(generated.objects) && generated.objects.length === 0) restore('objects');
    if (key === '0,0,0' && !equal(original.crossGameHistory, generated.crossGameHistory) && generated.crossGameHistory) {
      scoped.sharedHistory = [{ base: clone(original.crossGameHistory), generated: clone(generated.crossGameHistory) }];
      restore('crossGameHistory');
    }
  }
  if (normalized.length) scoped.readOnlyNormalizations = normalized;
  return scoped;
}
function mergeHistory(base, generated, current, runId) {
  const valid = value => value && [1, 2].includes(value.version) && Array.isArray(value.runs) && value.runs.length <= 20;
  if (!valid(generated) || generated.version !== 2 || base && !valid(base) || current && !valid(current)) throw conflict('crossGameHistory format');
  const out = clone(current || { version: 2, runs: [] });
  out.version = 2;
  const normalize = require('./crossGameMemory').norm;
  for (const row of generated.runs) {
    const before = base?.runs.find(value => value.runId === row.runId);
    if (equal(before, row)) continue;
    if (row.runId !== runId || !Number.isFinite(row.at) || Object.keys(row).some(key => !['runId', 'at', 'names', 'premises', 'murals', 'cities'].includes(key))) throw conflict('crossGameHistory foreign run');
    let target = out.runs.find(value => value.runId === runId);
    if (!target) { target = { runId, at: row.at }; out.runs.push(target); }
    for (const kind of ['names', 'premises', 'murals', 'cities']) if (row[kind] !== undefined) {
      if (!Array.isArray(row[kind]) || row[kind].length > 400 || row[kind].some(value => typeof value !== 'string') ||
          (before?.[kind] || []).some(value => !row[kind].map(normalize).includes(normalize(value)))) throw conflict('crossGameHistory non-additive proposal');
      target[kind] = [...new Set([...(target[kind] || []), ...row[kind]].map(normalize).filter(Boolean))].slice(-400);
    }
  }
  out.runs.sort((a, b) => a.at - b.at); out.runs = out.runs.slice(-20); return out;
}
function context(state, model) {
  return hash([state.getDungeonRunId(), state.getRestoreRevision?.(), model, state.getCurrentQuest?.(), state.getCurrentTaskIndex?.(), state.getCurrentTasks?.(),
    JSON.parse(state.getRoomNameDatabase() || '{}')['0,0,0']?.setting]);
}
function merge(base, generated, current, at = 'room') {
  if (equal(base, generated)) return clone(current);
  if (equal(base, current) || equal(generated, current)) return clone(generated);
  if (!plain(base) || !plain(generated) || !plain(current)) throw conflict(at);
  const out = { ...current };
  for (const key of new Set([...Object.keys(base), ...Object.keys(generated)])) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Invalid room field.');
    const value = merge(base[key], generated[key], current[key], at + '.' + key);
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  return out;
}
function protectDatabase(currentJson, nextJson, runId) {
  if (!currentJson || !currentJson.includes('"preparedBuild"')) return nextJson;
  const current = JSON.parse(currentJson), next = JSON.parse(nextJson || '{}'); let changed = false;
  for (const [key, room] of Object.entries(current)) {
    const receipt = room?.preparedBuild, incoming = next[key]?.preparedBuild;
    const forward = incoming && receipt && incoming.runId === runId && incoming.previousId === receipt.id &&
      incoming.revision > (receipt?.revision || 0);
    const older = incoming && receipt && incoming.id === receipt.id && ((incoming.revision || 0) < (receipt.revision || 0) ||
      ((incoming.revision || 0) === (receipt.revision || 0) && receipt.ready === true && incoming.ready !== true));
    if (receipt?.runId === runId && (incoming?.id !== receipt.id && !forward || older) &&
        (!next[key] || next[key].name === room.name)) {
      next[key] = room; changed = true;
    }
  }
  return changed ? JSON.stringify(next) : nextJson;
}
function validateArtifact(artifact, job, complete = true) {
  if (artifact?.runId !== job.runId || artifact.key !== job.key || !coordinate.test(job.key) ||
      artifact.jobId !== undefined && artifact.jobId !== job.id) throw Error('Room artifact identity mismatch.');
  if (!stages.includes(artifact.stage) || complete !== (artifact.stage === 'complete')) throw Error('Invalid room checkpoint stage.');
  const room = artifact.rooms?.[job.key], dungeon = artifact.dungeon;
  if (room?.name !== job.name || room.populationComplete !== true || description(room).trim().length < 20) throw Error('Incomplete room population.');
  if (!complete && !dungeon) return room;
  if (
      !dungeon?.cells || !Object.keys(dungeon.cells).length || !dungeon.layout || !dungeon._geometryStamp || dungeon.geoKey !== job.key ||
      ![dungeon.layout.width, dungeon.layout.height].every(n => Number.isInteger(n) && n > 0 && n <= 1024)) throw Error('Incomplete room artifact.');
  const source = dungeon.sceneSpec?.source;
  if (source?.roomName !== room.name || source?.description?.trim() !== description(room).trim()) throw Error('Room scenery disagrees with its description.');
  if (!room.inhabitants?.actors) throw Error('Room population is incomplete.');
  if (complete && (!room.illustration?.plan || !artifact.music?.voices?.length || !artifact.music?.archive?.id)) throw Error('Room art or archived music is incomplete.');
  return room;
}
function commit(state, job, artifact, { complete = true, protectedKeys = new Set(), reserveWrites, adoptMusic = (song, id) => require('./sidArchive').adopt(song, id) } = {}) {
  validateArtifact(artifact, job, complete);
  if ((job.assignment || artifact.leaseId !== undefined) && artifact.leaseId !== job.id) throw Error('Room artifact lease mismatch.');
  if (state.getDungeonRunId() !== job.runId || context(state, job.model) !== job.context) throw Error('Adventure or quest changed during room build.');
  const latest = JSON.parse(state.getRoomNameDatabase() || '{}'), target = latest[job.key];
  if (!target || target.name !== job.name || target.visited && !job.entering || target.populationComplete && target.preparedBuild?.id !== job.id && !equal(target, job.base[job.key])) throw Error('Room was already entered or completed.');
  const checkpointHash = hash(artifact);
  if (job.checkpoint) {
    if ((job.checkpoint.stage === 'complete' && artifact.stage !== 'complete') || (artifact.stage === 'population' && job.checkpoint.stage !== 'population'))
      throw conflict('stale checkpoint stage');
    const prior = job.checkpoints?.[artifact.stage];
    if (prior === checkpointHash) return target;
    if (prior) throw conflict('conflicting checkpoint replay');
  }
  if (artifact.dungeon && state.getRoomDungeonForSimulation && Object.hasOwn(job, 'dungeonBase') &&
      !equal(job.dungeonBase, state.getRoomDungeonForSimulation(job.coords) || null)) throw conflict(job.key + '.dungeon');
  const rooms = structuredClone(artifact.rooms); rooms[job.key].visited = target.visited === true;
  // Receipts are host-owned; a worker can only return the receipt in its snapshot.
  rooms[job.key].preparedBuild = clone(job.base[job.key]?.preparedBuild);
  if (rooms[job.key].preparedBuild === undefined) delete rooms[job.key].preparedBuild;
  const merged = { ...latest };
  const writes = [];
  for (const key of new Set([...Object.keys(job.base), ...Object.keys(rooms)])) {
    if (!coordinate.test(key)) throw Error('Invalid generated room coordinate.');
    if (!Object.hasOwn(rooms, key)) throw Error('A background build cannot remove a room.');
    if (equal(job.base[key], rooms[key])) continue;
    const current = latest[key], generated = rooms[key];
    if (current?.name && generated?.name !== current.name) throw conflict(key + '.name');
    if ((current?.cityRoom && (!equal(current.cityRoom.anchorKey, generated?.cityRoom?.anchorKey) ||
        !equal(current.cityRoom.cityId, generated?.cityRoom?.cityId))) || (current && !current.cityRoom && generated?.cityRoom))
      throw conflict(key + '.cityRoom namespace');
    if (current?.citySites && current.citySites.gateKey !== generated?.citySites?.gateKey) throw conflict(key + '.citySites namespace');
    if (key !== job.key && !equal(generated, current) && (protectedKeys.has(key) || current?.preparedBuild || current?.populationComplete || current?.visited || current?.builder?.mode === 'hand'))
      throw Object.assign(conflict(key + ' is owned by another room build', false), {
        responseEvidence: { destination: job.key, leaseOwner: job.id, writeSet: job.assignment?.writeSet || [job.key],
          changedPaths: changedPaths(job.base[key], generated, key) } });
    if (key !== job.key && !equal(job.base[key]?.preparedBuild, generated?.preparedBuild)) throw conflict(key + '.preparedBuild');
    merged[key] = merge(job.base[key], generated, current, key);
    writes.push(key);
  }
  if (artifact.sharedHistory !== undefined && (!Array.isArray(artifact.sharedHistory) || artifact.sharedHistory.length > 4)) throw Error('Invalid shared history proposals.');
  for (const proposal of artifact.sharedHistory || []) {
    if (!merged['0,0,0']) throw Error('Missing campaign history owner.');
    merged['0,0,0'] = { ...merged['0,0,0'], crossGameHistory: mergeHistory(proposal.base, proposal.generated, merged['0,0,0'].crossGameHistory, job.runId) };
  }
  for (const [direction, exit] of Object.entries(merged[job.key].exits || {})) {
    const other = merged[exit.targetCoordinates];
    if (exit.kind === 'portal' || direction === 'portal' || job.base[job.key]?.exits?.[direction]?.targetCoordinates === exit.targetCoordinates) continue;
    if ((protectedKeys.has(exit.targetCoordinates) || other?.preparedBuild || other?.populationComplete || other?.visited || other?.builder?.mode === 'hand') &&
        !Object.values(other?.exits || {}).some(back => back.targetCoordinates === job.key)) throw conflict(job.key + '.exits.' + direction + ' lacks a reserved return');
  }
  const previous = target.preparedBuild;
  const publishReservations = reserveWrites?.(writes);
  merged[job.key].preparedBuild = { version: 1, id: job.id, runId: job.runId, model: job.model, ready: complete, stage: artifact.stage,
    revision: (previous?.revision || 0) + 1, previousId: previous?.id === job.id ? previous.previousId : previous?.id, at: Date.now() };
  if (artifact.music) adoptMusic(artifact.music, job.id);
  // No player console, turn, inventory, roster, active quest or live position is imported.
  const coords = Object.fromEntries(['x', 'y', 'z'].map((k, i) => [k, Number(job.key.split(',')[i])]));
  if (artifact.dungeon) state.setRoomDungeon(coords, clone(artifact.dungeon), clone(artifact.dungeon.customTiles || []));
  if (merged[job.key].inhabitants) state.setRoomPopulation(job.key, clone(merged[job.key].inhabitants));
  if (artifact.music) state.setRoomMusic(coords, clone(artifact.music));
  // Publish readiness only after all required caches/assets have been installed.
  state.setRoomNameDatabase(JSON.stringify(merged));
  publishReservations?.();
  if (state.getRoomDungeonForSimulation) job.dungeonBase = clone(state.getRoomDungeonForSimulation(coords) || null);
  job.base = clone(artifact.rooms);
  // Parallel geometry/music/art branches arrive in any order; only population and complete are barriers.
  job.checkpoints ||= {};
  job.checkpoints[artifact.stage] = checkpointHash;
  job.checkpoint = { stage: artifact.stage };
  return merged[job.key];
}
function field(text, label, value) {
  const expression = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[^\\r\\n]*', 'm');
  return expression.test(text) ? text.replace(expression, () => label + ': ' + value) : text + '\n' + label + ': ' + value;
}
function projectConsole(text, room, key, database, { pending = false } = {}) {
  const [x, y, z] = key.split(',').map(Number);
  const exits = Object.keys(room.exits || {});
  for (const [name, value] of Object.entries({ 'Room Name': room.name, 'Room Description': pending ? 'None' : description(room),
    Coordinates: `X: ${x}, Y: ${y}, Z: ${z}`, Exits: exits.join(', ') || 'None',
    'Adjacent Rooms': exits.map(d => `${d}: ${database[room.exits[d]?.targetCoordinates]?.name || 'None'}`).join(', ') || 'None',
    'Puzzle in Room': pending ? 'None' : room.sceneSpec?.source?.puzzleDescription || room.puzzleDescription || 'None',
    'Puzzle Solution': pending ? 'None' : room.sceneSpec?.source?.puzzleSolution || room.puzzleSolution || 'None' })) text = field(text, name, value);
  const sheets = pending ? 'None' : room.monsters?.consoleBlock || room.monsters?.inRoom || 'None';
  text = text.replace(/^Monsters in Room:[\s\S]*?(?=^Monsters Equipped Properties:)/m, () => `Monsters in Room: \n${sheets}\n`);
  text = field(text, 'Monsters Equipped Properties', pending ? 'None' : room.monsters?.equippedProperties || 'None');
  text = field(text, 'Monsters State', pending ? 'None' : room.monsters?.state || 'Mixed');
  if (pending) { text = field(text, 'Objects in Room', 'None'); text = field(text, 'Objects in Room Properties', 'None'); }
  else text = require('./economy').syncGround(text, room);
  return text;
}
module.exports = { coordinate, equal, hash, description, context, merge, protectDatabase, validateArtifact, commit, field, projectConsole, scopeArtifact, mergeHistory, changedPaths };
