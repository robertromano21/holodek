'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet } = require('./initialGameState');
function itemDestroyed(state, name, reason = 'Required item exhausted and destroyed') {
  const tasks = state.getCurrentTasks?.() || [], index = state.getCurrentTaskIndex?.() || 0, task = tasks[index];
  if (task && task.status !== 'Completed' && task.requiredElements?.some(e => e.type !== 'monster' && e.name.toLowerCase() === name.toLowerCase())) {
    task.status = 'Failed'; task.failure = { source: 'engine-item-depletion-v1', item: name, reason, replacementPending: true };
    state.setCurrentTasks(tasks); state.setLastQuestUpdate?.(`Task failed: ${name}. ${reason}. A harder alternative is needed; the boss gate remains locked.`);
    state.setUpdatedGameConsole(require('./spellSystem').write(state.getUpdatedGameConsole(), 'Quest Progress', `Step ${index + 1}/3: Failed; ${name}: ${reason}. A harder alternative will be staged next turn.`));
  }
  const db = JSON.parse(state.getRoomNameDatabase() || '{}');
  for (const room of Object.values(db)) for (const mission of Object.values(room?.minorMissions || {})) if (mission.status !== 'completed' &&
      mission.item?.toLowerCase() === name.toLowerCase()) { mission.status = 'failed'; mission.failureReason = 'Requested item was exhausted and destroyed'; }
  state.setRoomNameDatabase(JSON.stringify(db));
}
function recover(state, currentKey) {
  const Q = require('./questProgress'), S = require('./questScenes');
  const tasks = state.getCurrentTasks?.() || [], index = state.getCurrentTaskIndex?.() || 0, failed = tasks[index];
  if (failed?.status !== 'Failed' || !failed.failure?.replacementPending) return null;
  const db = JSON.parse(state.getRoomNameDatabase() || '{}');
  const sourceKey = db[currentKey]?.name && !db[currentKey].bossGate ? currentKey : Object.keys(db).find(k => db[k]?.name && !db[k].bossGate);
  if (!sourceKey) return null;
  const room = db[sourceKey], attempt = (failed.recoveryAttempt || 0) + 1, count = Math.min(3, attempt);
  const original = failed.requiredElements.find(e => e.type !== 'monster' && e.name.toLowerCase() === failed.failure.item.toLowerCase());
  const name = `${failed.failure.item.slice(0, 65)} replacement ${attempt} ${randomUUID().slice(0, 8)}`;
  const oldItem = Object.values(db).flatMap(r => r?.objects || []).find(o => o.name === failed.failure.item) || original?.properties ||
    Object.values(db['0,0,0']?.spellSystem?.items || {}).find(i => i.name === failed.failure.item)?.properties || {};
  const item = { ...oldItem, name, type: ['weapon', 'armor', 'shield', 'other'].includes(original?.type) ? original.type : 'other',
    magic: Math.max(1, Number(oldItem.magic) || 1), recovery_task: true };
  room.objects ||= []; room.objects.push(item);
  const population = state.getRoomPopulation?.(sourceKey) || room.inhabitants || I.createPopulation(sourceKey, [], { indoor: room.indoor !== false });
  const guards = Array.from({ length: count }, (_, n) => ({ name: `Recovery Warden ${attempt}-${n + 1} ${randomUUID().slice(0, 6)}`,
    allegiance: 'Hostile', routine: 'guard', encounterId: 'recovery:' + name,
    job: 'guardian of confiscated equipment', dialogue: ['Each broken obligation carries a greater price.'] }));
  const extra = I.createPopulation(sourceKey, guards, { indoor: population.indoor });
  for (const guard of Object.values(extra.actors)) {
    guard.hp = guard.maxHp = 12 + attempt * 10; guard.recruitable = false;
    guard.sheet = formatStartingCharacterSheet({ Name: guard.name, Race: 'Shade', Class: 'Fighter', Sex: 'Unknown',
      Level: 2 + attempt, HP: guard.hp, MaxHP: guard.hp, AC: 10 + Math.min(8, attempt), Attack: 2 + attempt, Damage: 1 + attempt }, 6, 'npc').replace('State: Friendly', 'State: Hostile');
  }
  Object.assign(population.actors, extra.actors); population.groups.push(...extra.groups); delete population.placementStamp;
  population.initialSheets = [population.initialSheets, ...Object.values(extra.actors).map(a => a.sheet)].filter(Boolean).join('\n');
  room.inhabitants = population; room.monsters ||= {};
  room.monsters.inRoom = room.monsters.consoleBlock = [room.monsters.inRoom && room.monsters.inRoom !== 'None' ? room.monsters.inRoom : '',
    ...Object.values(extra.actors).map(a => a.sheet)].filter(Boolean).join('\n');
  let replacement = Q.compileGeneratedTask({ id: 'recovery:' + randomUUID(), type: 'Fetch', actionKind: 'take_item',
    requiredElements: [{ type: item.type, name: item.name, placement: sourceKey, minimumMagic: 1 }] }, db, sourceKey);
  if (!replacement) return null;
  replacement.recoveryAttempt = attempt;
  replacement.guardElements = guards.map(g => ({ type: 'monster', name: g.name, placement: sourceKey, allegiance: 'Hostile' }));
  replacement.hardRequirements.push(...guards.map(g => ({ check: 'monster_hp_zero', value: g.name })));
  const binding = Q.deliveryBindings(failed)[0];
  if (binding && db[binding.coords]?.name) {
    replacement.type = 'Deliver'; replacement.actionKind = 'deliver_item';
    replacement.requiredElements.push({ type: 'monster', name: binding.recipient, placement: binding.coords, allegiance: 'Neutral' });
    replacement.delivery = { item: name, recipient: binding.recipient, coords: binding.coords, minimumMagic: 1 };
    replacement.hardRequirements = [{ check: 'at_coords', value: binding.coords }, ...guards.map(g => ({ check: 'monster_hp_zero', value: g.name }))];
    replacement.actionRequirements = [{ check: 'item_delivered', ...replacement.delivery }];
  }
  replacement.desc = `Recovery attempt ${attempt}: defeat ${guards.map(g => g.name).join(', ')} in ${room.name}, then recover ${name} with Magic remaining` +
    (binding ? ` and give it to ${binding.recipient} in ${db[binding.coords].name}.` : '.');
  replacement = S.compile(replacement, db, sourceKey);
  db['0,0,0'] ||= {}; db['0,0,0'].questFailures ||= [];
  db['0,0,0'].questFailures.push({ source: 'engine-quest-recovery-v1', failedTaskId: failed.id, failure: failed.failure,
    replacementTaskId: replacement.id, attempt, bossRoomKey: Object.keys(db).find(k => db[k]?.bossGate?.quest === state.getCurrentQuest?.()) || null });
  tasks[index] = replacement;
  state.setCurrentTasks(tasks); state.setRoomNameDatabase(JSON.stringify(db)); state.setRoomPopulation?.(sourceKey, population);
  let text = state.getUpdatedGameConsole();
  if (sourceKey === currentKey) text = I.withStates(require('./economy').syncGround(text, room), population);
  text = Q.writeQuestRequirements(text, replacement, db);
  text = require('./spellSystem').write(text, 'Quest Progress', `Step ${index + 1}/3: Pending; harder recovery attempt ${attempt}. ${replacement.desc}`);
  state.setUpdatedGameConsole(text); state.setLastQuestUpdate?.(replacement.desc);
  return replacement;
}
module.exports = { itemDestroyed, recover };
