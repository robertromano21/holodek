'use strict';
const I = require('../assets/dungeonInhabitants');
const Inventory = require('../assets/inventoryUi');
const { randomUUID } = require('node:crypto');
const coords = key => Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, Number(key.split(',')[i])]));
function noteLevelSpawn(db, runId, key, dungeon) {
  if (!I.roomKey(key) || !db[key] || !dungeon?.start) return false;
  db['0,0,0'] ||= {};
  const life = require('./combatLife').ledger(db, runId), level = require('./worldFlags').levelKey(key);
  life.levelSpawns ||= {};
  if (life.levelSpawns[level]) return false;
  life.levelSpawns[level] = { key, start: { ...(dungeon._world1Start || dungeon.start) } };
  return true;
}
function destination(state, db, fromKey) {
  const level = require('./worldFlags').levelKey(fromKey), saved = db['0,0,0']?.combatLife?.levelSpawns?.[level];
  const key = fromKey;
  const dungeon = state.getRoomDungeon?.(coords(key)) || state.getRoomDungeonForSimulation?.(coords(key));
  if (db[key] && dungeon?.cells && dungeon.start)
    return { key, dungeon, start: dungeon.cityFloorContext ? dungeon._world1Start || dungeon.start : saved?.key === key ? saved.start : dungeon._world1Start || dungeon.start };
  throw Error('The current level has no saved spawn room.');
}
function complete(state) {
  let db = JSON.parse(state.getRoomNameDatabase() || '{}'), life = db['0,0,0']?.combatLife;
  if (!life?.respawn || life.runId !== state.getDungeonRunId() || life.gameOver) return null;
  require('./economy').playerDeathDrops(state, life.respawn.id);
  db = JSON.parse(state.getRoomNameDatabase() || '{}'); life = db['0,0,0'].combatLife;
  const pending = life.respawn, fromKey = pending.fromKey, target = destination(state, db, fromKey);
  let text = state.getUpdatedGameConsole();
  const party = I.parseSheets(text, 'NPCs in Party'), roster = JSON.parse(state.getCombatCharactersString() || '[]');
  const origin = db[fromKey];
  const population = state.getRoomPopulation?.(fromKey) || origin.inhabitants || I.createPopulation(fromKey, []);
  for (const companion of party) {
    const actor = roster.find(a => a.name === companion.name) || {};
    const old = population.actors[companion.name], memory = population.companions?.[companion.name];
    const profile = actor.originProfile || memory?.profile || old?.profile;
    const extra = I.createPopulation(fromKey, [{ ...actor, ...companion, allegiance: 'Friendly',
      encounterId: 'reunion-' + I.hash(companion.name), profile }]);
    const record = extra.actors[companion.name];
    Object.assign(record, old || {}, { name: companion.name, allegiance: 'Friendly', hp: companion.hp, maxHp: companion.maxHp,
      state: I.isDown(companion) ? companion.state : companion.hp > 0 ? 'Friendly' : 'Dead',
      sheet: companion.rawSheet || companion.sheet, status: companion.hp > 0 || I.isDown(companion) ? 'present' : 'dead',
      position: Number.isFinite(actor.mazeX) ? { x: actor.mazeX, y: actor.mazeY } : old?.position || null,
      formerCompanion: true, reunion: { recoveryId: pending.id, pc: life.pcName, pending: true },
      discoveryState: 'placed', encounteredAt: Date.now(), recruitable: true,
      memory: memory?.memory || old?.memory || { profile }, ...(profile ? { profile } : {}),
      ...(actor.sprite ? { sprite: actor.sprite } : {}) });
    record.dialogue = [`${life.pcName}? I saw you fall. What happened? I'm glad you're back.`, ...(old?.dialogue || memory?.dialogue || companion.dialogue || [])];
    record.dialogueIndex = 0;
    population.actors[companion.name] = record;
    if (!old) population.groups.push(...extra.groups);
    const group = population.groups.find(g => g.id === record.encounterId);
    if (group) { group.status = 'discovered'; group.introPlayed = true; group.site ||= record.position; }
    if (population.companions) delete population.companions[companion.name];
  }
  population.revision++;
  origin.inhabitants = population;
  text = text.replace(I.sectionPattern('NPCs in Party'), (_, header) => header + ' None\n');
  const E = require('./economy'), partyNames = new Set(party.map(a => a.name.toLowerCase()));
  const props = Inventory.parseProperties(E.field(text, 'Party Equipped Properties'));
  const retained = props.filter(item => partyNames.has(String(item.owner || '').toLowerCase()) || !item.owner &&
    party.some(a => Object.values(I.parseEquipment(a.lines[9])).some(name => name.toLowerCase() === item.name.toLowerCase())));
  const monsterProps = Inventory.parseProperties(E.field(text, 'Monsters Equipped Properties'));
  text = E.write(text, 'Party Equipped Properties', props.filter(item => !retained.includes(item)).map(item => JSON.stringify(item)).join(', ') || 'None');
  text = E.write(text, 'Monsters Equipped Properties', [...monsterProps, ...retained].map(item => JSON.stringify(item)).join(', ') || 'None');
  origin.monsters ||= {}; origin.monsters.equippedProperties = E.field(text, 'Monsters Equipped Properties');
  const start = require('../assets/roomArrival').safeStart(target.dungeon, target.start);
  const dungeon = { ...target.dungeon, start: { ...start }, entryPlacement: { version: 1, direction: null, fromKey, start: { ...start } } };
  const targetPopulation = target.key === fromKey ? population : state.getRoomPopulation?.(target.key) || db[target.key].inhabitants;
  let next = require('./roomBuildState').projectConsole(text, db[target.key], target.key, db);
  next = I.withStates(next, targetPopulation);
  const pc = roster.find(a => a.type === 'pc');
  if (!pc) throw Error('The returning player has no saved character.');
  Object.assign(pc, { mazeX: start.x, mazeY: start.y, mazeRoomKey: target.key, mazePoint: { x: start.x + .5, y: start.y + .5 } });
  const nextRoster = [pc]; I.attach(nextRoster, targetPopulation);
  delete life.respawn;
  life.lastRespawn = { ...pending, targetKey: target.key, start, companions: party.map(a => a.name) };
  life.message += ` You return alone to ${db[target.key].name || 'the level entrance'}. Your former companions remain where you fell; seek them out to reunite.`;
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(next);
  state.setRoomPopulation?.(fromKey, population);
  state.setLastCoords?.(coords(target.key)); state.setRoomDungeon?.(coords(target.key), dungeon, dungeon.customTiles || []);
  state.setCombatCharactersString(JSON.stringify(nextRoster));
  return { type: 'player_respawn', eventId: pending.id || randomUUID(), runId: state.getDungeonRunId(), fromKey,
    geoKey: target.key, dungeon, population: targetPopulation, content: life.message,
    updatedGameConsole: next, combatCharactersString: JSON.stringify(nextRoster), roomNameDatabaseString: state.getRoomNameDatabase() };
}
module.exports = { noteLevelSpawn, destination, complete };
