'use strict';
const I = require('../assets/dungeonInhabitants');
const Reach = require('./dungeonReach');
const { randomUUID } = require('node:crypto');
const norm = value => String(value || '').trim().toLowerCase();
function companionTarget(text, input) {
  const name = /^\s*attack\s+(.+?)\s*$/i.exec(String(input))?.[1];
  if (!name) return false;
  const actors = [...I.parseSheets(text, 'NPCs in Party'), ...I.parseSheets(text)];
  const exact = actors.filter(a => norm(a.name) === norm(name));
  const matches = exact.length ? exact : actors.filter(a => norm(a.name).startsWith(norm(name)));
  return matches.length === 1 && matches[0].type === 'npc';
}
function prepare(state, populations, input) {
  const name = /^\s*attack\s+(.+?)\s*$/i.exec(String(input))?.[1];
  if (!name) return null;
  let text = state.getUpdatedGameConsole() || '';
  const roster = JSON.parse(state.getCombatCharactersString() || '[]');
  const coords = state.getLastCoords(), geoKey = I.roomKey(coords && `${coords.x},${coords.y},${coords.z}`);
  const dungeon = coords && state.getRoomDungeon(coords), pc = roster.find(a => a.type === 'pc');
  const candidates = roster.filter(a => a.type !== 'pc' && a.discoveryState !== 'pending' && I.canAct(a));
  const exact = candidates.filter(a => norm(a.name) === norm(name));
  const matches = exact.length ? exact : candidates.filter(a => norm(a.name).startsWith(norm(name)));
  if (matches.length !== 1) return null;
  const target = matches[0], space = dungeon && Reach.createCombatSpace(dungeon, roster, geoKey);
  if (!space || !pc || !I.canAct(pc) || !space.point(target) || !space.point(pc) || state.getGamePaused?.()) return null;
  const population = populations.get(geoKey, text, dungeon);
  if (target.type !== 'npc' && population.actors[target.name]?.discoveryState === 'pending') return null;
  if (!(space.canAttack(pc, target) || space.distance(pc, target) <= (population.indoor ? 8 : 12)) ||
      !I.lineClear(dungeon, space.point(pc), space.point(target))) return null;
  const formerCompanion = target.type === 'npc';
  let record = population.actors[target.name];
  if (!formerCompanion && (record?.allegiance || I.allegiance(target)) === 'Hostile') return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (formerCompanion) {
    const sheets = I.parseSheets(text, 'NPCs in Party'), sheet = sheets.find(a => norm(a.name) === norm(target.name));
    if (!sheet) return null;
    const hostileSheet = sheet.sheet.replace(/^([ \t]*State:)[^\r\n]*/m, '$1 Hostile');
    const block = /^State:/m.test(hostileSheet) ? hostileSheet : hostileSheet + '\nState: Hostile';
    text = text.replace(I.sectionPattern('NPCs in Party'), (_, header) => header + eol +
      (sheets.filter(a => a !== sheet).map(a => a.rawSheet || a.sheet).join(eol) || 'None') + eol);
    const monsters = I.parseSheets(text);
    text = text.replace(I.sectionPattern('Monsters in Room'), (_, header) => header + eol +
      [...monsters.filter(a => norm(a.name) !== norm(target.name)).map(a => a.rawSheet || a.sheet), block].join(eol) + eol);
    const equipped = new Set(Object.values(I.parseEquipment(sheet.lines[9])).map(norm));
    const partyGear = I.parseEquipmentProperties(text.match(/^Party Equipped Properties:[^\r\n]*/m)?.[0]);
    const moved = partyGear.filter(p => norm(p.owner) === norm(target.name) || !p.owner && equipped.has(norm(p.name)));
    const residentGear = I.parseEquipmentProperties(text.match(/^Monsters Equipped Properties:[^\r\n]*/m)?.[0]);
    if (moved.length) {
      text = text.replace(/^Monsters Equipped Properties:[^\r\n]*/m, () => 'Monsters Equipped Properties: ' +
        [...residentGear, ...moved.map(p => ({ ...p, owner: target.name }))].map(p => JSON.stringify(p)).join(', '));
      text = text.replace(/^Party Equipped Properties:[^\r\n]*/m, () => 'Party Equipped Properties: ' +
        (partyGear.filter(p => norm(p.owner) !== norm(target.name)).map(p => JSON.stringify(p)).join(', ') || 'None'));
    }
    const companion = population.companions?.[target.name];
    if (!record) {
      const extra = I.createPopulation(geoKey, [{ ...target, ...sheet, allegiance: 'Hostile',
        encounterId: `provoked-${I.hash(target.name)}`, profile: target.originProfile || companion?.profile }]);
      record = population.actors[target.name] = extra.actors[target.name]; population.groups.push(...extra.groups);
    }
    Object.assign(record, { status: 'present', hp: target.hp ?? sheet.hp, sheet: block, position: { x: target.mazeX, y: target.mazeY },
      home: { x: target.mazeX, y: target.mazeY }, formerCompanion: true, discoveryState: 'placed', encounteredAt: Date.now() });
    if (companion?.memory) record.memory = companion.memory;
    if (population.companions) delete population.companions[target.name];
    const group = population.groups.find(g => g.id === record.encounterId);
    if (group) { group.status = 'discovered'; group.site ||= { x: target.mazeX, y: target.mazeY }; }
    target.type = 'monster';
  }
  if (!record || record.status !== 'present') return null;
  Object.assign(record, { allegiance: 'Hostile', state: 'Hostile', provokedBy: pc.name });
  Object.assign(target, { allegiance: 'Hostile', state: 'Hostile', storedState: 'Hostile', encounterId: record.encounterId });
  population.revision++;
  state.setUpdatedGameConsole(I.withStates(text, population));
  state.setCombatCharactersString(JSON.stringify(roster));
  populations.save(population);
  return { type: 'realtime_combat_result', passive: true, eventId: randomUUID(), runId: state.getDungeonRunId(), geoKey,
    content: `${target.name} becomes hostile after your attack${formerCompanion ? ' and leaves the party' : ''}.`,
    updatedGameConsole: state.getUpdatedGameConsole(), combatCharactersString: state.getCombatCharactersString(), population };
}
module.exports = { prepare, companionTarget };
