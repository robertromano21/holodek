'use strict';
const I = require('../assets/dungeonInhabitants');
const Intent = require('../assets/commandIntent');
const Exits = require('../assets/dungeonExits');
const coords = key => { const [x, y, z] = key.split(',').map(Number); return { x, y, z }; };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = a => a && { x: a.x + .5, y: a.y + .5 };
function protectedNames(state) {
  const names = new Set((state.getCurrentTasks?.() || []).flatMap(task => [
    ...(task?.requiredElements || []).map(e => e?.name),
    ...(task?.guardElements || []).map(e => e?.name),
    ...(task?.status==='Completed'?[]:task?.story?.stages||[]).flatMap(s=>[s.actor,...(s.targets||[])])
  ]).filter(Boolean));
  try {
    const db = JSON.parse(state.getRoomNameDatabase?.() || '{}');
    for (const room of Object.values(db)) for (const mission of Object.values(room?.minorMissions || {}))
      if (mission.status !== 'completed') for (const name of mission.targets || []) names.add(name);
  } catch {}
  return names;
}
function observe(population, dungeon, player, protectedActors = new Set(), now = Date.now()) {
  let changed = false;
  for (const record of Object.values(population.actors)) {
    if (!record.pursuit) { record.pursuit = I.pursuitPolicy(record, population.geoKey, population.starting); changed = true; }
    const p = record.pursuit;
    const allowed = p.willing && record.status === 'present' && I.state(record) === 'Hostile' &&
      record.discoveryState !== 'pending' && !protectedActors.has(record.name);
    const seen = allowed && record.position && distance(point(record.position), player) <= 8 && I.lineClear(dungeon, point(record.position), player);
    if (seen) {
      changed ||= !p.active || !p.target || distance(p.target, player) > .5;
      p.active = true; p.lastSeenAt = now; p.target = { ...player }; p.targetRoom = population.geoKey;
    } else if (p.active && (!allowed || now - (p.lastSeenAt || 0) > 15000)) { p.active = false; changed = true; }
  }
  return changed;
}
function pathWithin(dungeon, start, goal, limit) {
  const queue = [{ ...start, steps: 0 }], seen = new Set([`${start.x},${start.y}`]);
  for (let i = 0; i < queue.length && i < 256; i++) {
    const at = queue[i]; if (at.x === goal.x && at.y === goal.y) return true;
    if (at.steps >= limit) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: at.x + dx, y: at.y + dy, steps: at.steps + 1 }, key = `${next.x},${next.y}`;
      if (seen.has(key) || !I.canTraverse(dungeon, at, next)) continue;
      seen.add(key); queue.push(next);
    }
  }
  return false;
}
function plan(state, input, now = Date.now()) {
  const direction = Intent.travelDirection(input), previous = state.getLastCoords?.();
  if (!direction || !previous || state.getGamePaused?.()) return null;
  const from = `${previous.x},${previous.y},${previous.z}`, live = state.getLiveWorldState?.();
  const to = I.roomKey(state.getUpdatedGameConsole?.().match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
  if (!to || to === from || I.roomKey(live?.roomKey) !== from) return null;
  let db; try { db = JSON.parse(state.getRoomNameDatabase?.() || '{}'); } catch { return null; }
  const exit = db[from]?.exits?.[direction];
  if (!exit || String(exit.status).toLowerCase() !== 'open' || I.roomKey(exit.targetCoordinates) !== to) return null;
  const dungeon = state.getRoomDungeonForSimulation?.(previous), population = state.getRoomPopulation?.(from);
  const marker = dungeon && Exits.nearby(dungeon, live.player, 1.25);
  if (!population || marker?.direction !== direction) return null;
  const roster = JSON.parse(state.getCombatCharactersString?.() || '[]');
  if (!roster.some(a => a.type === 'pc' && (a.hp ?? 1) > 0)) return null;
  const protectedActors = protectedNames(state), candidates = [];
  for (const record of Object.values(population.actors)) {
    const p = record.pursuit;
    if (!p?.willing || !p.active || p.remainingRooms <= 0 || now - p.lastSeenAt > 15000 ||
        record.status !== 'present' || I.state(record) !== 'Hostile' || protectedActors.has(record.name)) continue;
    const observed = live.characters?.find(a => a.name === record.name && a.type === 'monster' && I.roomKey(a.roomKey) === from)?.maze;
    const position = observed && Number.isInteger(observed.x) && Number.isInteger(observed.y) && record.position &&
      distance(observed, record.position) <= 4 && I.walkable(dungeon, observed.x, observed.y) ? observed : record.position;
    if (!position || distance(point(position), live.player) > 3.5 || !pathWithin(dungeon, position, marker, 4)) continue;
    candidates.push({ name: record.name, position: { ...position } });
  }
  return candidates.length ? { runId: state.getDungeonRunId(), from, to, direction, candidates: candidates.slice(0, 2) } : null;
}
function transfer(ticket, state, service, destination, dungeon, now = Date.now()) {
  const current = state.getLastCoords();
  if (!ticket || ticket.runId !== state.getDungeonRunId() || dungeon?.geoKey !== ticket.to || destination?.geoKey !== ticket.to ||
      state.getGamePaused?.() || `${current.x},${current.y},${current.z}` !== ticket.to) return [];
  const source = state.getRoomPopulation(ticket.from); if (!source) return [];
  const occupied = new Set(Object.values(destination.actors).filter(a => a.status === 'present' && a.position).map(a => `${a.position.x},${a.position.y}`));
  const start = dungeon.start; if (!start) return [];
  const arrivals = [], protectedActors = protectedNames(state);
  const liveCount = Object.values(destination.actors).filter(a => a.status === 'present').length;
  const capacity = Math.max(0, (destination.indoor ? 10 : 20) - liveCount);
  for (const candidate of ticket.candidates.slice(0, capacity)) {
    const record = source.actors[candidate.name], existing = destination.actors[candidate.name];
    if (!record || record.status !== 'present' || I.state(record) !== 'Hostile' || protectedActors.has(record.name) ||
        !record.pursuit?.willing || record.pursuit.remainingRooms <= 0 ||
        existing && !(existing.status === 'departed' && existing.departedTo === ticket.from)) continue;
    const sheet = I.residentSheets(source).find(a => a.name === record.name)?.sheet; if (!sheet) continue;
    const tiles = [];
    for (let y = start.y - 5; y <= start.y + 5; y++) for (let x = start.x - 5; x <= start.x + 5; x++) {
      const dist = distance({ x, y }, start), key = `${x},${y}`;
      if (dist < 3 || dist > 5 || occupied.has(key) || !I.walkable(dungeon, x, y) || dungeon.cells[key].object ||
          !pathWithin(dungeon, start, { x, y }, 8)) continue;
      tiles.push({ x, y, dist });
    }
    tiles.sort((a, b) => a.dist - b.dist || a.y - b.y || a.x - b.x);
    const tile = tiles[0]; if (!tile) continue;
    const id = `pursuit-${I.hash(ticket.from + ':' + record.name + ':' + destination.revision)}`;
    const arrival = JSON.parse(JSON.stringify(record));
    Object.assign(arrival, { status: 'present', state: 'Hostile', sheet, encounterId: id, position: { x: tile.x, y: tile.y },
      home: { x: tile.x, y: tile.y }, discoveryState: 'placed', discoveryRevision: (destination.revision || 0) + 1 });
    delete arrival.departedTo;
    Object.assign(arrival.pursuit, { active: true, remainingRooms: record.pursuit.remainingRooms - 1,
      arrivedThrough: ticket.direction, lastSeenAt: now, target: point(start), targetRoom: ticket.to,
      noticeId: `pursuit:${ticket.to}:${I.hash(ticket.from + ':' + record.name + ':' + now)}` });
    destination.actors[arrival.name] = arrival;
    destination.groups.push({ id, members: [arrival.name], site: { ...arrival.position }, status: 'discovered', introPlayed: true, discoveryState: 'placed' });
    Object.assign(record, { status: 'departed', departedTo: ticket.to, position: candidate.position });
    record.pursuit.active = false;
    occupied.add(`${tile.x},${tile.y}`); arrivals.push(arrival.name);
  }
  if (!arrivals.length) return [];
  for (const group of source.groups) if (group.members.every(name => source.actors[name]?.status !== 'present')) group.status = 'exhausted';
  const arrivingGear = new Set(arrivals.flatMap(name => Object.values(I.parseEquipment(I.parseBlocks(destination.actors[name].sheet)[0]?.lines[9]))));
  const gear = I.parseEquipmentProperties(source.equipmentProperties || source.initialEquipmentProperties).filter(item => arrivingGear.has(item.name));
  destination.equipmentProperties = [destination.equipmentProperties || '', ...gear.map(item => JSON.stringify(item))].filter(Boolean).join(', ');
  service.save(source); service.save(destination);
  let db; try { db = JSON.parse(state.getRoomNameDatabase()); } catch { return arrivals; }
  const room = db[ticket.from];
  if (room) {
    const sheets = I.residentSheets(source), text = sheets.map(a => a.rawSheet || a.sheet).join('\n') || 'None';
    const states = new Set(sheets.map(a => a.state));
    room.monsters = { ...room.monsters, inRoom: text, consoleBlock: text, state: states.size > 1 ? 'Mixed' : [...states][0] || 'None' };
    state.setRoomNameDatabase(JSON.stringify(db));
  }
  return arrivals;
}
module.exports = { observe, plan, transfer, protectedNames, pathWithin };
