'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Q = require('./questProgress');

/** A successor delegates acceptance; the original task and earned receipts never change identity. */
function ensure(state, consoleText = state.getUpdatedGameConsole?.() || '') {
  const tasks = state.getCurrentTasks?.() || [], index = state.getCurrentTaskIndex?.() || 0;
  const task = Q.normalizeDeliveryTask(tasks[index]), bindings = Q.deliveryBindings(task);
  if (!bindings.length || task.status === 'Completed') return { changed: false, notices: [] };
  let database;
  try { database = JSON.parse(state.getRoomNameDatabase?.() || '{}'); } catch { return { changed: false, notices: [] }; }
  const identity = Q.taskBinding(task), activeKey = I.roomKey(consoleText.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
  const verified = Q.evaluateTaskRequirements(task, { roomKey: activeKey, consoleText, database }).checks;
  const notices = [];
  for (const original of [...new Map(bindings.map(b => [b.coords + ':' + b.recipient, b])).values()]) {
    const room = database[original.coords]; if (!room) continue;
    const pending = bindings.filter(b => b.recipient === original.recipient && b.coords === original.coords &&
      !verified.some(check => check.passed === true && check.requirement.check === 'item_delivered' &&
        check.requirement.item === b.item && check.requirement.recipient === b.recipient && I.roomKey(check.requirement.coords) === b.coords));
    if (!pending.length) continue;
    const population = state.getRoomPopulation?.(original.coords) || room.inhabitants;
    const delegated = Q.deliveryRecipient(task, database, original);
    const observed = activeKey === original.coords ? I.parseSheets(consoleText).find(a => a.name === delegated.name) : null;
    const sheets = I.parseBlocks(room.monsters?.inRoom).concat(I.parseBlocks(room.monsters?.consoleBlock));
    const record = population?.actors?.[delegated.name], prior = observed || I.parseBlocks(record?.sheet)[0] || sheets.find(a => a.name === delegated.name);
    // Missing, hidden, recruited or merely absent is not proof of death.
    if (!(record?.status === 'dead' || I.state(observed || record || prior) === 'Dead')) continue;
    const p = population || I.createPopulation(original.coords, sheets, { indoor: true });
    p.initialSheets ||= sheets.map(a => a.sheet).join('\n');
    // Stored console blocks can predate combat. Never heal existing residents from them.
    if (!population) I.sync(p, sheets);
    const deceased = p.actors[delegated.name];
    if (deceased) {
      deceased.hp = Math.min(0, Number.isFinite(deceased.hp) ? deceased.hp : 0,
        Number.isFinite(observed?.hp) ? observed.hp : 0);
      deceased.status = 'dead';
    }
    const dungeon = state.getRoomDungeonForSimulation?.(Object.fromEntries(['x', 'y', 'z'].map((k, n) => [k, Number(original.coords.split(',')[n])])));
    const center = record?.position || dungeon?.start || { x: 0, y: 0 };
    let site = null;
    if (dungeon) {
      const occupied = new Set(Object.values(p.actors).filter(a => a.status === 'present' && a.position).map(a => `${a.position.x},${a.position.y}`));
      if (activeKey === original.coords) for (const a of JSON.parse(state.getCombatCharactersString?.() || '[]')) {
        if (a.hp > 0 && a.type !== 'monster') occupied.add(`${a.mazeX},${a.mazeY}`);
      }
      site = I.reachable(dungeon).filter(t => !occupied.has(`${t.x},${t.y}`) && !dungeon.cells[`${t.x},${t.y}`]?.object &&
        !dungeon.cells[`${t.x},${t.y}`]?.exitMarker).sort((a, b) =>
        Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0];
      if (!site) continue;
    }
    const used = new Set(Object.values(database).flatMap(r => Object.keys(r.inhabitants?.actors || {})));
    for (const a of JSON.parse(state.getCombatCharactersString?.() || '[]')) used.add(a.name);
    let ordinal = 0, name;
    do { name = `Assistant${ordinal ? ' ' + String.fromCharCode(65 + Math.floor(ordinal / 26)) + String.fromCharCode(65 + ordinal % 26) : ''} of ${original.recipient}`.slice(0, 70); ordinal++; } while (used.has(name));
    const id = randomUUID(), hp = Math.max(10, Math.min(200, prior?.maxHp || 20));
    const sheet = [name, prior?.sex || record?.sex || 'Unknown', prior?.race || record?.race || 'Human',
      prior?.className || record?.className || 'Assistant', `Level: ${Math.max(1, Math.min(30, prior?.level || 1))}`,
      'AC: 10', 'XP: 0', `HP: ${hp}`, `MaxHP: ${hp}`, 'Equipped: Weapon: None, Armor: None, Shield: None, Other: None',
      'Attack: 0', 'Damage: 0', 'Armor: 0', 'Magic: 0', 'State: Neutral'].join('\n');
    const extra = I.createPopulation(original.coords, [{ name, race: prior?.race, className: prior?.className,
      allegiance: 'Neutral', encounterId: 'delivery-successor-' + id, routine: 'work',
      job: `assistant to ${original.recipient}`, activity: `taking over ${original.recipient}'s pending deliveries`,
      history: `Served as assistant to ${original.recipient}; now accepts the outstanding quest items.`,
      dialogue: [`I was ${original.recipient}'s assistant. I can accept the remaining items in their place.`] }], { indoor: p.indoor });
    const actor = extra.actors[name], group = extra.groups[0];
    Object.assign(actor, { sheet, hp, inventory: [], deliverySuccessorId: id, discoveryState: 'fixed',
      discoveryRevision: (p.revision || 0) + 1, home: site ? { x: site.x, y: site.y } : null, position: site ? { x: site.x, y: site.y } : null });
    group.site = actor.home; group.discoveryState = 'fixed';
    p.actors[name] = actor; p.groups.push(group); p.revision++;
    room.inhabitants = p; room.deliverySuccessors ||= [];
    room.deliverySuccessors.push({ id, source: 'engine-delivery-successor-v1', taskBinding: identity,
      recipient: original.recipient, replaces: delegated.name, name, roomKey: original.coords });
    room.monsters ||= {};
    const unknownLive = activeKey === original.coords ? I.parseSheets(consoleText).filter(a => !Object.hasOwn(p.actors, a.name)) : [];
    const residents = I.residentSheets(p, unknownLive), states = new Set(residents.map(a => I.state(a)));
    room.monsters.inRoom = residents.map(a => a.sheet).join('\n');
    room.monsters.consoleBlock = room.monsters.inRoom;
    room.monsters.state = states.size > 1 ? 'Mixed' : [...states][0] || 'None';
    state.setRoomPopulation?.(original.coords, p);
    if (activeKey === original.coords) {
      const roster = JSON.parse(state.getCombatCharactersString?.() || '[]'); I.attach(roster, p);
      state.setCombatCharactersString?.(JSON.stringify(roster));
      consoleText = consoleText.replace(I.sectionPattern('Monsters in Room'), (_, header) => `${header}\n${room.monsters.inRoom}\n`);
      consoleText = I.withStates(consoleText, p);
    }
    notices.push(`${delegated.name} has died. ${name} is taking over the handoff in ${room.name} (${original.coords}).`);
  }
  if (!notices.length) return { changed: false, notices };
  state.setRoomNameDatabase(JSON.stringify(database));
  consoleText = Q.writeQuestRequirements(consoleText, task, database); state.setUpdatedGameConsole?.(consoleText);
  state.setLastQuestUpdate?.(notices.join('\n'));
  console.info('[QuestDeliverySuccessor]', JSON.stringify({ taskIndex: index, notices }));
  return { changed: true, notices, consoleText };
}
module.exports = { ensure };
