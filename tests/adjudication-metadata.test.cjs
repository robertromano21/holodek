'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../retort/adjudicationMetadata');
const { ActionDice } = require('../retort/actionDice');
const { parseSheets } = require('../assets/partyRoster');
const { selectCommandedNpcs } = require('../retort/adjudicationState');
const { evaluateTaskRequirements } = require('../retort/questProgress');
const { buildInitialWorldConsole, buildInitialGameConsole } = require('../retort/initialGameState');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8').replace(/\r\n/g, '\n');
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const sheet = () => buildInitialGameConsole(buildInitialWorldConsole().console, { Name: 'Mortacia', HP: 20, MaxHP: 20 });
function initial(result = 'partial') {
  const ranges = [{ low: 1, high: 6, outcome: 'Fails to turn the dial.' }, { low: 7, high: 14, outcome: 'Turns the first dial.' }, { low: 15, high: 20, outcome: 'Aligns both dials.' }];
  const value = { Action: 'PuzzleSolving', 'Selected Characters': ['Mortacia'], 'Dice Rolls': [{ character: 'Mortacia', roll: 10 }],
    'Outcome Ranges': [ranges], Outcomes: [{ character: 'Mortacia', outcome: ranges[1].outcome }] };
  const candidates = ranges.map(range => ({ actor: 'Mortacia', low: range.low, high: range.high, activity: 'PuzzleSolving',
    target: 'dials', result: range.low === 7 ? result : range.low === 1 ? 'failure' : 'success', questAttempted: true,
    puzzleSteps: range.low === 7 ? ['turn first dial'] : [], evidenceIds: ['real-clue', 'fabricated-clue'] }));
  value.metadata = A.select(candidates, value, ['real-clue']);
  return { value, candidates };
}
test('invisible outcome metadata is separated from the original narrative range table', () => {
  const { candidates } = initial(), table = '- "Mortacia":\n1. Dice roll range 1-6: Fails.';
  const result = A.extract(`${table}\n[[ACTION_METADATA]]${JSON.stringify(candidates)}[[/ACTION_METADATA]]`);
  assert.equal(result.content, table); assert.equal(result.candidates.length, 3);
  assert.deepEqual(A.extract(`${table}\n[[ACTION_METADATA]]broken`), { content: table, candidates: [] });
});
test('only metadata from the actual selected roll survives, with allowlisted evidence IDs', () => {
  const { value } = initial();
  assert.equal(value.metadata.length, 1); assert.equal(value.metadata[0].result, 'partial');
  assert.deepEqual(value.metadata[0].puzzleSteps, ['turn first dial']);
  assert.deepEqual(value.metadata[0].evidenceIds, ['real-clue']);
  assert.equal(A.flags(value).searchSuccessful, false);
  assert.equal(A.flags(value).searchAttempted, true);
});
test('malformed, duplicate, unselected or forged metadata falls back rather than granting success', () => {
  for (const alter of [v => v.metadata[0].roll = 20, v => v.metadata[0].actor = 'Hades', v => v.metadata[0].result = 'Completed',
    v => v.metadata[0].questAttempted = 'true', v => v.metadata[0].puzzleSteps = 'all', v => v.metadata = []]) {
    const { value } = initial(); alter(value); assert.equal(A.flags(value), null);
  }
  const { value, candidates } = initial();
  assert.deepEqual(A.select([...candidates, candidates[1]], value), []);
  assert.deepEqual(A.select([null, { actor: 'Hades' }], value), []);
});
test('the real generator uses the existing call and die, and keeps plain-text outcomes unchanged', async () => {
  const fn = source.slice(source.indexOf('async function generateOutcomes('), source.indexOf('async function generateAdditionalOutcomes('));
  const dice = new ActionDice({ animationMs: 0, random: () => 10 });
  dice.begin('exploration', '0,0,0', event => {
    if (event.type === 'dice_state' && event.pending) setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
  });
  const { candidates } = initial(), table = '- "Mortacia":\n1. Dice roll range 1-6: Fails to turn the dial.\n2. Dice roll range 7-14: Turns the first dial.\n3. Dice roll range 15-20: Aligns both dials.';
  let calls = 0;
  const agent = { user() {}, assistant: { generation: async () => ({ content: calls++ ? `${table}\n[[ACTION_METADATA]]${JSON.stringify(candidates)}[[/ACTION_METADATA]]` : '{"action":"PuzzleSolving"}' }) } };
  const context = { AdjudicationMetadata: A, parseSheets, selectCommandedNpcs, actionDice: dice, console: quiet,
    sharedState: { getRoomNameDatabase: () => '{}' } };
  vm.runInNewContext(fn, context);
  const result = await context.generateOutcomes(agent, 'turn the first dial', sheet());
  assert.equal(result.Outcomes[0].outcome, 'Turns the first dial.');
  assert.equal(result.metadata[0].result, 'partial'); assert.equal(calls, 2);
  assert.equal(dice.snapshot().results.length, 1); dice.end();
});
test('the existing puzzle planner reuses selected metadata without two redundant interpretation calls or premature completion', async () => {
  const fn = source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate'));
  let database = JSON.stringify({ '0,0,0': { name: 'Temple', attemptedSearches: 4, exhaustionLimit: 4, objects: [], exits: {} } });
  const context = { AdjudicationMetadata: A, parseSheets, evaluateTaskRequirements, console: quiet,
    sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => database = value } };
  vm.runInNewContext(fn, context);
  const agent = { user() {}, assistant: { generation() { throw Error('Complete metadata needs no reinterpretation request.'); } } };
  const { value } = initial();
  const task = { type: 'Puzzle', actionKind: 'solve_puzzle', hardRequirements: [], requiredElements: [] };
  const result = await context.generateAdditionalOutcomes(agent, value, sheet(), 'turn first dial', task);
  assert.equal(result.questAttempted, true); assert.equal(result.questSucceeded, false);
  assert.deepEqual(Array.from(result.new_objects), []); assert.equal(result.new_exit, '');
});
test('cancelled rolls and invalid tables never retain hypothetical metadata', async () => {
  const fn = source.slice(source.indexOf('async function generateOutcomes('), source.indexOf('async function generateAdditionalOutcomes('));
  const { candidates } = initial(); let calls = 0;
  const agent = { user() {}, assistant: { generation: async () => ({ content: calls++ ? `No table. [[ACTION_METADATA]]${JSON.stringify(candidates)}[[/ACTION_METADATA]]` : '{"action":"PuzzleSolving"}' }) } };
  const context = { AdjudicationMetadata: A, parseSheets, selectCommandedNpcs, console: quiet,
    actionDice: { roll: async () => ({ natural: 10 }) }, sharedState: { getRoomNameDatabase: () => '{}' } };
  vm.runInNewContext(fn, context);
  const fallback = await context.generateOutcomes(agent, 'turn dial', sheet());
  assert.equal(fallback.metadata.length, 0);
  context.actionDice.roll = async () => null; calls = 0;
  const cancelled = await context.generateOutcomes(agent, 'turn dial', sheet());
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.metadata, undefined);
});

test('success metadata cannot bypass the existing inventory prerequisite for a quest', async () => {
  const fn = source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate'));
  let database = JSON.stringify({ '0,0,0': { name: 'Temple', attemptedSearches: 4, exhaustionLimit: 4, objects: [], exits: {} } });
  const context = { AdjudicationMetadata: A, parseSheets, evaluateTaskRequirements, console: quiet,
    sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => database = value } };
  vm.runInNewContext(fn, context);
  const agent = { user() {}, assistant: { generation() { throw Error('Selected metadata does not require another interpretation.'); } } };
  const { value } = initial('success');
  const task = { type: 'Puzzle', actionKind: 'solve_puzzle', hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] };
  const result = await context.generateAdditionalOutcomes(agent, value, sheet(), 'align the dials', task);
  assert.equal(result.questAttempted, true); assert.equal(result.questSucceeded, false); assert.equal(result.prereqsMet, false);
  assert.deepEqual(Array.from(result.new_objects), []); assert.equal(result.new_exit, '');
});
