'use strict';
const Puzzles = require('../assets/physicalPuzzles');
const Rewards = require('./puzzleRewards');
const { position } = require('./dungeonReach');
function prepare({ input, dungeon, actor, consoleText, room }) {
  const e = dungeon?.physicalPuzzle;
  if (!e) return null;
  const action = Puzzles.intent(input, e.definition);
  if (!action) return null;
  const deny = message => ({ allowed: false, message });
  const f = e.fixtures.find(f => f.id === action.controlId), p = position(actor, dungeon.geoKey);
  if (!actor || !(actor.hp > 0) || !Puzzles.inReach(dungeon, p, f)) return deny('Walk up to that mechanism first; it must be within reach with a clear path.');
  if (!Puzzles.verify(dungeon).valid) return deny('This mechanism is missing a reachable component. Its construction needs repair; no attempt was consumed.');
  const stored = room?.puzzleMechanism;
  if (!stored || stored.id !== e.definition.id || JSON.stringify(stored.state) !== JSON.stringify(e.state)) return deny('The mechanism changed. Wait for the current room state and try again.');
  if (action.invalid) return deny('That setting is not on this control. Inspect its markings; the mechanism can be tried again.');
  if (action.inspect) {
    const c = e.definition.controls.find(c => c.id === f.id);
    return { allowed: true, inspect: true, message: f.id === 'plaque' ? Puzzles.clue(e.definition) : f.id === 'receiver' ?
      e.state.status === 'complete' ? e.definition.lore : `The ${Puzzles.receiverLabel(e.definition)} is dormant. Its linked controls respond to the adjacent reference diagram.` :
      `${c.label} bears the ${c.mark} crest and is set to ${c.options[e.state.values[c.index]]}. ${Puzzles.command(e.definition, f)} operates it.`, metadata: { mechanismId: stored.id, controlId: f.id, result: 'observed' } };
  }
  if (stored.state.status === 'complete') return deny('The mechanism is already solved. Its revealed record and reward have already been recorded.');
  const nextState = Puzzles.step(stored, stored.state, action.controlId, action.value);
  const complete = nextState.status === 'complete', puzzleId = Rewards.identity(consoleText);
  if (complete && !puzzleId) return deny('The mechanism has no matching console puzzle. No state or reward was changed.');
  return { allowed: true, nextState, message: Puzzles.feedback(stored, nextState, f.id),
    delta: Puzzles.applyVisualState(dungeon, nextState),
    outcomes: { puzzle_action: { mechanismId: stored.id, controlId: f.id, expectedRevision: stored.state.revision,
      ...(action.value !== undefined ? { value: action.value } : {}), nextState },
      ...(complete ? { puzzle_completed: { id: puzzleId, contributors: [actor.name] }, xp_awarded: Rewards.awards({}, [actor.name]) } : {}) },
    metadata: { activity: 'PuzzleSolving', source: 'verified-physical-mechanism', mechanismId: stored.id, controlId: f.id,
      result: complete ? 'success' : 'partial', revision: nextState.revision,
      puzzleSteps: [`${f.label}: ${nextState.values[stored.controls.findIndex(c => c.id === f.id)]}`] } };
}
function bindTask(task, database, currentKey) {
  if (!task || !(task.actionKind === 'solve_puzzle' || String(task.type).toLowerCase() === 'puzzle')) return;
  const target = task.physicalPuzzleRoom || task.hardRequirements?.find(r => r.check === 'at_coords')?.value || currentKey;
  const parts = typeof target === 'object' ? [target.x, target.y, target.z] : String(target).match(/-?\d+/g);
  if (!parts || parts.length !== 3 || parts.some(v => !Number.isSafeInteger(Number(v)))) return;
  const key = parts.map(Number).join(',');
  const mechanism = database[key]?.puzzleMechanism;
  if (!mechanism) return;
  task.physicalPuzzleRoom = key;
  task.actionRequirements ||= [];
  if (!task.actionRequirements.some(r => r.check === 'puzzle_solved' && r.value === key)) task.actionRequirements.push({ check: 'puzzle_solved', value: key, mechanismId: mechanism.id });
}
module.exports = { prepare, bindTask };
