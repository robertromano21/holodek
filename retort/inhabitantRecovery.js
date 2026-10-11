'use strict';
const I = require('../assets/dungeonInhabitants');
const { createPopulationService } = require('./roomPopulation');

function planUnplacedRecovery(population, dungeon, party = []) {
  if (!population || !dungeon || population.geoKey !== dungeon.geoKey) throw Error('A matching saved population and dungeon are required.');
  const copy = JSON.parse(JSON.stringify(population)), names = [];
  const allies = new Set(party.map(actor => String(actor.name || actor.Name).toLowerCase()));
  const initial = new Map(I.parseBlocks(copy.initialSheets).map(actor => [actor.name, actor]));
  for (const record of Object.values(copy.actors || {})) {
    const sheet = initial.get(record.name), group = copy.groups.find(g => g.members.includes(record.name));
    // This migration repairs only the old pre-placement sync bug, not deaths or actual departures.
    if (record.status !== 'departed' || record.home || record.position || record.encounteredAt || record.departedAt ||
        record.departureReason || record.lastSpokeAt || record.dialogueIndex || record.recoveredAt ||
        allies.has(record.name.toLowerCase()) || !group || group.site || group.introPlayed ||
        !sheet || sheet.hp <= 0 || I.state(sheet) === 'Dead' || record.hp <= 0 || record.state === 'Dead') continue;
    record.status = 'present'; record.hp = Number.isFinite(record.hp) ? record.hp : sheet.hp;
    record.sheet ||= sheet.rawSheet || sheet.sheet;
    record.state = record.allegiance; record.recoveredAt = Date.now();
    group.status = 'unseen'; names.push(record.name);
  }
  if (names.length) {
    delete copy.placementStamp;
    I.place(copy, dungeon);
    if (names.some(name => !copy.actors[name].position)) throw Error('Recovery could not find safe separate encounter sites. Nothing was changed.');
  }
  return { population: copy, names };
}

function recoverCurrentRoom(state, { runId, geoKey, broadcast, busy = false }) {
  if (busy) throw Error('Finish the current action before repairing inhabitants.');
  const coords = state.getLastCoords();
  if (runId !== state.getDungeonRunId() || geoKey !== `${coords.x},${coords.y},${coords.z}`) throw Error('The demo has changed rooms or runs. Nothing was changed.');
  const dungeon = state.getRoomDungeonForSimulation(coords), text = state.getUpdatedGameConsole();
  if (I.roomKey(text.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]) !== geoKey) throw Error('The current console belongs to another room.');
  const roster = JSON.parse(state.getCombatCharactersString() || '[]');
  const party = [...roster.filter(a => a.type === 'pc' || a.type === 'npc'), ...I.parseSheets(text, 'NPCs in Party')];
  const plan = planUnplacedRecovery(state.getRoomPopulation(geoKey), dungeon, party);
  if (!plan.names.length) return { restored: [], groups: [] };
  let repairedConsole = I.withStates(text, plan.population);
  for (const label of ['PC', 'NPCs in Party']) {
    const block = text.match(I.sectionPattern(label));
    if (block) repairedConsole = repairedConsole.replace(I.sectionPattern(label), () => block[0]);
  }
  const originalParty = new Map(roster.filter(actor => actor.type === 'pc' || actor.type === 'npc').map(actor => [actor.name, { ...actor }]));
  I.attach(roster, plan.population);
  for (let i = 0; i < roster.length; i++) if (originalParty.has(roster[i].name)) roster[i] = originalParty.get(roster[i].name);
  const service = createPopulationService(state);
  state.setRoomPopulation(geoKey, plan.population);
  state.setUpdatedGameConsole(repairedConsole);
  state.setCombatCharactersString(JSON.stringify(roster));
  service.save(plan.population);
  if (broadcast) {
    // Reuse the established console/roster/IndexedDB update path without running a turn or combat.
    broadcast({ type: 'realtime_combat_result', eventId: `population-repair:${runId}:${geoKey}:${plan.population.revision}`,
      runId, geoKey, content: 'The missing room inhabitants have been restored at their encounter sites.',
      updatedGameConsole: repairedConsole, combatCharactersString: JSON.stringify(roster), population: plan.population });
  }
  const groups = plan.population.groups.filter(group => group.members.some(name => plan.names.includes(name)))
    .map(group => ({ id: group.id, site: group.site, members: group.members }));
  console.info('[InhabitantRecovery]', JSON.stringify({ runId, geoKey, restored: plan.names, groups }));
  return { restored: plan.names, groups };
}

function recoverRoomInhabitants(state, options) {
  const { runId, geoKey, broadcast, busy = false } = options;
  if (busy || runId !== state.getDungeonRunId() || !/^-?\d+,-?\d+,-?\d+$/.test(geoKey || '')) {
    throw Error('The repair is busy, stale or has invalid room coordinates. Nothing was changed.');
  }
  const current = state.getLastCoords();
  if (geoKey === `${current.x},${current.y},${current.z}`) return recoverCurrentRoom(state, options);
  const [x, y, z] = geoKey.split(',').map(Number), dungeon = state.getRoomDungeonForSimulation({ x, y, z });
  const text = state.getUpdatedGameConsole(), roster = JSON.parse(state.getCombatCharactersString() || '[]');
  const party = [...roster.filter(a => a.type === 'pc' || a.type === 'npc'), ...I.parseSheets(text, 'NPCs in Party')];
  const plan = planUnplacedRecovery(state.getRoomPopulation(geoKey), dungeon, party);
  if (!plan.names.length) return { restored: [], groups: [], inactiveRoom: true };
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[geoKey];
  if (!room) throw Error('The saved room is missing. Nothing was changed.');
  const sheets = I.residentSheets(plan.population), states = new Set(sheets.map(actor => I.state(actor)));
  room.inhabitants = plan.population;
  room.monsters = { ...room.monsters, inRoom: sheets.map(actor => actor.rawSheet || actor.sheet).join('\n') || 'None',
    state: states.size > 1 ? 'Mixed' : [...states][0] || 'None' };
  room.monsters.consoleBlock = room.monsters.inRoom;
  if (plan.population.initialEquipmentProperties) room.monsters.equippedProperties = plan.population.initialEquipmentProperties;
  state.setRoomPopulation(geoKey, plan.population);
  state.setRoomNameDatabase(JSON.stringify(db));
  broadcast?.({ type: 'room_population', runId, population: plan.population });
  const groups = plan.population.groups.filter(group => group.members.some(name => plan.names.includes(name)))
    .map(group => ({ id: group.id, site: group.site, members: group.members }));
  console.info('[InhabitantRecovery]', JSON.stringify({ runId, geoKey, restored: plan.names, groups, inactiveRoom: true }));
  return { restored: plan.names, groups, inactiveRoom: true };
}

module.exports = { planUnplacedRecovery, recoverCurrentRoom, recoverRoomInhabitants };
