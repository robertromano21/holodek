'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Inventory = require('../assets/inventoryUi');
const Q = require('./questProgress');
const Successors = require('./questDeliverySuccessors');
const key = value => String(value || '').trim().toLowerCase();
const field = (text, label) => text.match(new RegExp('^' + label + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
const setField = (text, label, value) => text.replace(new RegExp('^' + label + ':[^\\r\\n]*', 'm'), () => label + ': ' + value);
function give(state, service, input) {
  const command = /^give\s+(.+)\s+to\s+(.+)$/i.exec(String(input).trim()); if (!command) return null;
  let text = state.getUpdatedGameConsole() || '';
  let questUpdate = '';
  let questCompleted = false;
  let successorNotice = '';
  const result = content => ({ content: [successorNotice, content].filter(Boolean).join('\n'), updatedGameConsole: text, roomNameDatabaseString: state.getRoomNameDatabase(),
    combatCharactersString: state.getCombatCharactersString(), actionOnly: true, questUpdate });
  if (state.getGamePaused?.()) return result('Resume the game before giving an item.');
  const geoKey = I.roomKey(field(text, 'Coordinates')), coords = state.getLastCoords();
  if (!geoKey || geoKey !== `${coords.x},${coords.y},${coords.z}`) return result('The current room is not ready for an item handoff.');
  successorNotice = Successors.ensure(state, text).notices.join('\n');
  text = state.getUpdatedGameConsole() || text;
  const dungeon = state.getRoomDungeonForSimulation?.(coords), population = state.getRoomPopulation?.(geoKey) || service.get(geoKey, text, dungeon);
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'); I.attach(roster, population);
  const matches = roster.filter(a => a.type === 'monster' && (key(a.name) === key(command[2]) || key(a.name).startsWith(key(command[2]) + ' ')));
  const recipient = matches.find(a => key(a.name) === key(command[2])) || (matches.length === 1 ? matches[0] : null);
  const pc = roster.find(a => a.type === 'pc' && (a.hp ?? 1) > 0), record = recipient && population.actors[recipient.name];
  const player = pc && (pc.mazePoint || { x: pc.mazeX + .5, y: pc.mazeY + .5 });
  if (!recipient || !record || !I.isPresent(recipient, population) || recipient.discoveryState === 'pending') return result('That recipient is not present in this room.');
  const reach = I.dialogueReach(dungeon, recipient, player);
  if (!pc || !reach.canSpeak || !reach.lineOfSight || reach.distance > 3) return result(`Move closer to ${recipient.name} for the handoff.`);
  if (I.allegiance(recipient) === 'Hostile') return result(`${recipient.name} is hostile and will not accept an ordinary handoff.`);
  const names = field(text, 'Inventory').split(/,\s*/).filter(name => name && !/^(none|empty)$/i.test(name));
  const index = names.findIndex(name => key(name) === key(command[1]));
  if (index < 0) return result(`The ${command[1]} is not in inventory. Unequip it first if a party member is using it.`);
  const name = names[index], properties = Inventory.parseProperties(field(text, 'Inventory Properties'));
  const metadata = properties.find(item => key(item.name) === key(name)) || { name, type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0 };
  let database; try { database = JSON.parse(state.getRoomNameDatabase() || '{}'); } catch { return result('The room records could not be verified. No item was transferred.'); }
  if (!database[geoKey]) return result('The room records could not be verified. No item was transferred.');
  if ((record.inventory?.length || 0) >= 100) return result(`${recipient.name} cannot carry any more items.`);
  const tasks = state.getCurrentTasks?.() || [], taskIndex = state.getCurrentTaskIndex?.() || 0;
  const task = Q.normalizeDeliveryTask(tasks[taskIndex]);
  const bindings = Q.deliveryBindings(task);
  const bound = bindings.find(b => key(b.item) === key(name) && b.coords === geoKey &&
    key(Q.deliveryRecipient(task, database, b).name) === key(recipient.name));
  const questHandoff = task?.status !== 'Completed' && !!bound;
  const magicFailure = questHandoff && bound.minimumMagic > 0 && Number(metadata.magic || 0) < bound.minimumMagic;
  const receipt = { id: randomUUID(), source: 'engine-give-item-v1', item: questHandoff ? bound.item : name,
    recipient: questHandoff ? bound.recipient : recipient.name, giver: pc.name, roomKey: geoKey,
    ...(questHandoff && bound.recipient !== recipient.name ? { acceptedBy: recipient.name, successorId: record.deliverySuccessorId } : {}),
    at: Date.now(), turn: Number(field(text, 'Turns')) || 0, witnesses: require('./campaignMemory').cast(state, text).witnesses,
    magic: Number(metadata.magic) || 0, taskBinding: questHandoff ? Q.taskBinding(task) : null };
  names.splice(index, 1);
  text = setField(text, 'Inventory', names.join(', ') || 'Empty');
  text = setField(text, 'Inventory Properties', properties.filter(item => names.some(n => key(n) === key(item.name))).map(item => JSON.stringify(item)).join(', ') || 'None');
  record.inventory ||= []; record.inventory.push(JSON.parse(JSON.stringify(metadata)));
  record.receivedItems ||= []; record.receivedItems.push(receipt);
  database[geoKey].itemTransfers ||= []; database[geoKey].itemTransfers.push(receipt);
  database[geoKey].inhabitants = population;
  state.setRoomNameDatabase(JSON.stringify(database)); state.setUpdatedGameConsole(text); service.save(population);
  require('./campaignMemory').rememberTransfer(state, receipt);
  if (magicFailure) {
    require('./questFailure').itemDestroyed(state, name, 'Delivered item has no required Magic remaining');
    text = state.getUpdatedGameConsole();
    return { ...result(`You give ${name} to ${recipient.name}, but the task fails: the requested Magic is gone. A harder alternative will be staged.`), population };
  }
  if (questHandoff) {
    const assessment = Q.evaluateTaskRequirements(task, { roomKey: geoKey, consoleText: text, database });
    task.progress = Q.mergeTaskProgress(task.progress, assessment);
    tasks[taskIndex] = task;
    if (Q.verifiedTaskCompletion(task, assessment)) {
      task.status = 'Completed'; questCompleted = true;
      state.setCurrentTaskIndex(taskIndex + 1); state.setQuestSeeded(false);
      questUpdate = `Task completed: ${task.desc}`;
      text = setField(text, 'Quest Progress', `Step ${taskIndex + 1}/3: Completed; verified handoff of ${name} to ${recipient.name}. The next step will be prepared on your next turn.`);
    } else {
      task.status = 'In Progress';
      const delivered = assessment.checks.filter(c => c.requirement?.check === 'item_delivered' && c.passed === true).length;
      questUpdate = `Delivery progress: ${delivered}/${bindings.length} required items handed to ${recipient.name}.`;
      text = setField(text, 'Quest Progress', `Step ${taskIndex + 1}/3: In Progress; ${task.progress.satisfied}/${task.progress.total} requirements verified. ${task.desc}`);
    }
    text = Q.writeQuestRequirements(text, task, database);
    state.setCurrentTasks(tasks); state.setUpdatedGameConsole(text);
    state.setLastQuestUpdate?.(questUpdate); state.appendQuestLog?.({ update: questUpdate, currentTaskIndex: state.getCurrentTaskIndex() });
  }
  console.info('[ItemTransfer]', JSON.stringify({ geoKey, item: name, recipient: recipient.name, questCompleted }));
  return { ...result(`You give the ${name} to ${recipient.name}.${questUpdate ? '\n' + questUpdate : ''}`), population };
}
module.exports = { give };
