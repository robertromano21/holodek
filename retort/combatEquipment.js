'use strict';
const I = require('../assets/dungeonInhabitants'), E = require('./economy'), Spells = require('./spellSystem');
const key = value => String(value || '').trim().toLowerCase();
function attach({ dice, state, service, actor, turn, targets, roster, space, live, update, committed }) {
  const action = dice.active;
  if (!action || !['pc', 'npc'].includes(actor.type)) return { close() {} };
  turn.equipment = { allowed: true, actor: actor.name };
  const change = input => {
    const coords = state.getLastCoords();
    if (!live() || dice.active !== action || action.turn !== turn || dice.paused || state.getGamePaused?.() || dice.pending ||
        turn.movement?.busy || !I.canAct(actor) || input.runId !== state.getDungeonRunId() || input.geoKey !== action.geoKey ||
        I.roomKey(`${coords.x},${coords.y},${coords.z}`) !== action.geoKey || input.actionId !== action.id || input.turnId !== turn.turnId ||
        input.combatant !== actor.name || !['equip', 'unequip'].includes(input.kind) ||
        input.target && key(input.target) !== key(actor.name)) throw Error('Equipment can change only on this character\'s turn before attacking or rolling.');
    const result = E.action(state, service, { ...input, target: actor.name, revision: E.project(state).revision });
    if (result.error) throw Error(result.error);
    Spells.synchronize(state);
    const sheet = [...I.parseSheets(state.getUpdatedGameConsole(), 'PC'), ...I.parseSheets(state.getUpdatedGameConsole(), 'NPCs in Party')].find(a => a.name === actor.name);
    const fields = { equipped: I.parseEquipment(sheet.lines[9]) };
    for (const stat of ['attack', 'damage', 'armor', 'ac', 'magic']) fields[stat] = sheet[stat];
    for (const entry of new Set([actor, ...(roster || []), ...(space?.roster || [])])) if (entry.name === actor.name) Object.assign(entry, fields);
    const wire = JSON.parse(state.getCombatCharactersString() || '[]');
    for (const entry of wire) if (entry.name === actor.name) Object.assign(entry, fields);
    state.setCombatCharactersString(JSON.stringify(wire));
    committed?.();
    turn.spells = Spells.choices(state, actor.name, targets.map(a => a.name));
    if (update) update(); else dice.publish();
    if (!result.duplicate) dice.recordCombat?.({ kind: 'notice', text: result.content });
    return { ...result, turn };
  };
  dice.changeEquipment = change;
  return { close() { if (dice.changeEquipment === change) delete dice.changeEquipment; delete turn.equipment; } };
}
module.exports = { attach };
