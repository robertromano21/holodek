'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Rewards = require('../retort/puzzleRewards');
const Metadata = require('../retort/adjudicationMetadata');
const { applyAdditionalOutcomes, selectCommandedNpcs } = require('../retort/adjudicationState');
const { parseSheets } = require('../assets/partyRoster');
const { evaluateTaskRequirements } = require('../retort/questProgress');
const { buildInitialWorldConsole, buildInitialGameConsole } = require('../retort/initialGameState');
const { ActionDice } = require('../retort/actionDice');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
const planner = source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate'));
const generator = source.slice(source.indexOf('async function generateOutcomes('), source.indexOf('async function generateAdditionalOutcomes('));
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const text = () => buildInitialGameConsole(buildInitialWorldConsole().console,
  { Name: 'Benedict', HP: 30, MaxHP: 30, XP: 100 }, [{ Name: 'Mortacia', HP: 30, MaxHP: 30, XP: 750000 }, { Name: 'Fallen Ally', HP: 0, XP: 0 }])
  .replace('Puzzle in Room: None', 'Puzzle in Room: Two brass dials seal an ancient passage.')
  .replace('Puzzle Solution: None', 'Puzzle Solution: Align both dials to the sun and speak the oath.')
  .replace('Exits: north, down', 'Exits: south');
function selected({ action = 'PuzzleSolving', result = 'success', contributors = ['Benedict'], exit = false, object = false } = {}) {
  const ranges = [{ low: 1, high: 20, outcome: result === 'partial' ? 'Turns only the first dial.' :
    action === 'Search' ? 'Finds a clue toward the cavern, without performing the mechanism.' : 'Aligns both dials and speaks the oath; the mechanism opens.' }];
  const initial = { Action: action, 'Selected Characters': contributors, 'Dice Rolls': contributors.map(character => ({ character, roll: 17 })),
    'Outcome Ranges': contributors.map(() => ranges), Outcomes: contributors.map(character => ({ character, outcome: ranges[0].outcome })) };
  initial.metadata = Metadata.select(contributors.map(actor => ({ actor, low: 1, high: 20, activity: action, result,
    questAttempted: false, puzzleSteps: action === 'PuzzleSolving' ? [result === 'partial' ? 'turn first dial' : 'align both dials and speak oath'] : [],
    puzzleRequiresExit: exit, puzzleRequiresObject: object, evidenceIds: [] })), initial);
  return initial;
}
function harness({ exhausted = false, completed = false, consoleText = text() } = {}) {
  const room = { name: 'Temple', exhaustionLimit: 4, attemptedSearches: exhausted ? 4 : 0, exits: {}, objects: [], blueprint: { seed: 'unchanged' } };
  if (completed) room.puzzleCompletions = { [Rewards.identity(consoleText)]: { completedAt: 1000, contributors: ['Benedict'], xp: { Benedict: 250 } } };
  let database = JSON.stringify({ '0,0,0': room });
  const prompts = [], requests = [], responses = [];
  const context = { PuzzleRewards: Rewards, AdjudicationMetadata: Metadata, parseSheets, evaluateTaskRequirements, GeneratedNames: require('../retort/generatedNames'),
    console: quiet, Math: Object.assign(Object.create(Math), { random: () => .99 }),
    generateObjectModifiers: async () => ({ attack_modifier: 0, damage_modifier: 0, ac: 1, magic: 0 }),
    sharedState: { getRoomNameDatabase: () => database, setRoomNameDatabase: value => database = value, setUpdatedGameConsole() {} } };
  vm.runInNewContext(planner, context);
  const agent = { user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); }, assistant: { generation: async options => {
    requests.push(options); assert.ok(responses.length, 'Unexpected generation: ' + prompts.at(-1));
    return { content: responses.shift() };
  } } };
  return { prompts, requests, agent, context, db: () => JSON.parse(database),
    plan: async (initial = selected(), rows = [], task = null) => {
      responses.push(...rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)));
      const result = await context.generateAdditionalOutcomes(agent, initial, consoleText, 'align both dials and speak the oath', task);
      assert.equal(responses.length, 0); return result;
    }, commit: result => {
      const applied = applyAdditionalOutcomes(result, consoleText, JSON.parse(database));
      database = JSON.stringify(applied.database); return applied;
    } };
}

for (const exhausted of [false, true]) test(`first genuine puzzle completion awards XP ${exhausted ? 'even after search exhaustion' : 'before its own exhaustion blocks rewards'}`, async () => {
  const h = harness({ exhausted }), result = await h.plan(selected(), [{ Benedict: 400 }]);
  assert.equal(result.exhausted, true); assert.equal(result.xp_awarded.Benedict, 400); assert.ok(result.puzzle_completed);
  assert.equal(Rewards.completed(h.db()['0,0,0'], Rewards.identity(text())), false, 'Planning does not claim the reward.');
  const applied = h.commit(result);
  assert.match(applied.console, /XP: 500/); assert.equal(applied.database['0,0,0'].puzzleCompletions[Rewards.identity(text())].xp.Benedict, 400);
  assert.deepEqual(applied.database['0,0,0'].blueprint, { seed: 'unchanged' }); assert.equal(h.requests.length, 1);
});

for (const response of ['broken JSON', {}, { Benedict: 0 }, { Benedict: -20 }, { Benedict: 'many' }, { Benedict: 99999 }])
  test(`verified solves retain a bounded positive award when the XP response is ${JSON.stringify(response)}`, async () => {
    const h = harness({ exhausted: true }), result = await h.plan(selected(), [response]);
    assert.ok(result.xp_awarded.Benedict > 0 && result.xp_awarded.Benedict <= 500);
    const applied = h.commit(result); assert.ok(applied.xp.Benedict > 0);
  });

test('only living acting contributors earn puzzle XP; observers, dead allies and fabricated names do not', async () => {
  const h = harness(), result = await h.plan(selected({ contributors: ['Benedict', 'Mortacia'] }), [{ Benedict: 300, Mortacia: 350, 'Fallen Ally': 400, Hades: 500 }]);
  assert.deepEqual(Object.keys(result.xp_awarded).sort(), ['Benedict', 'Mortacia']);
  const applied = h.commit(result); assert.equal(applied.xp.Benedict, 300); assert.equal(applied.xp.Mortacia, 350);
  assert.equal(applied.xp['Fallen Ally'], undefined); assert.equal(applied.xp.Hades, undefined);
});

test('retrying a completed reward cannot pay XP or reveal the same puzzle loot/exit twice', async () => {
  const h = harness(), result = await h.plan(selected(), [{ Benedict: 300 }]), first = h.commit(result);
  const replay = applyAdditionalOutcomes({ ...result, new_objects: ['forged relic'], object_modifiers: {}, new_exit: 'east' }, first.console, first.database);
  assert.equal(replay.console, first.console); assert.deepEqual(replay.xp, {}); assert.deepEqual(replay.discoveries, []); assert.equal(replay.exit, '');
  assert.deepEqual(replay.database['0,0,0'].puzzleCompletions, first.database['0,0,0'].puzzleCompletions);
});

for (const result of ['success', 'partial']) test(`a saved completed puzzle suppresses ${result} replay rewards even with a reset search counter`, async () => {
  const h = harness({ completed: true }), planned = await h.plan(selected({ result }));
  assert.deepEqual(Object.keys(planned.xp_awarded), []); assert.equal(planned.puzzle_completed, null); assert.equal(h.requests.length, 0);
});

test('an intermediate step remains partial, not completed, and does not claim the completion reward', async () => {
  const h = harness({ exhausted: true }), result = await h.plan(selected({ result: 'partial' }));
  assert.equal(result.questSucceeded, false); assert.equal(result.puzzle_completed, null);
  assert.deepEqual(Object.keys(result.xp_awarded), []); assert.equal(Rewards.completed(h.db()['0,0,0'], Rewards.identity(text())), false);
});

test('successful searching cannot complete an active puzzle quest, reproducing the Searing Expanse log', async () => {
  const h = harness({ exhausted: true }), initial = selected({ action: 'Search' }); initial.metadata[0].questAttempted = true;
  const task = { type: 'Hybrid', actionKind: 'solve_puzzle', desc: 'Find the talon, travel to the cavern and solve the puzzle.', hardRequirements: [] };
  const result = await h.plan(initial, [], task);
  assert.equal(result.questAttempted, true); assert.equal(result.prereqsMet, true); assert.equal(result.questSucceeded, false);
  assert.equal(result.puzzle_completed, null); assert.deepEqual(Object.keys(result.xp_awarded), []);
});

for (const type of ['exit', 'object']) test(`a puzzle-promised ${type} reaches the effect planner despite exhaustion`, async () => {
  const h = harness({ exhausted: true }), initial = selected({ exit: type === 'exit', object: type === 'object' });
  const responses = [{ Benedict: 100 }, ...(type === 'object' ? [{ count: 1 }, { name: 'sun relic' }, { type: 'other' }] : [{ name: 'sun chamber' }]), { Benedict: 250 }];
  const planned = await h.plan(initial, responses), applied = h.commit(planned);
  assert.equal(planned.xp_awarded.Benedict, 350);
  if (type === 'exit') { assert.equal(applied.exit, 'north'); assert.match(applied.console, /Exits: south, north/); }
  else { assert.deepEqual(applied.discoveries, ['sun relic']); assert.match(applied.console, /Objects in Room: sun relic/); }
});

test('failed prerequisite checks prevent puzzle completion and its reward', async () => {
  const h = harness({ exhausted: true }), initial = selected(); initial.metadata[0].questAttempted = true;
  const result = await h.plan(initial, [], { type: 'Puzzle', actionKind: 'solve_puzzle', hardRequirements: [{ check: 'inventory_contains', value: 'Iron Sigil' }] });
  assert.equal(result.prereqsMet, false); assert.equal(result.questSucceeded, false); assert.equal(result.puzzle_completed, null);
});

test('legacy failed puzzle attempts retain one-time 1-7 damage traps without preventing a later solve', async () => {
  const h = harness(), failed = await h.plan(selected({ result: 'failure' }), [{}]);
  assert.equal(failed.puzzle_completed, null);
  assert.equal(failed.trap_damage.Benedict, 7); assert.equal(failed.trap_damage.Mortacia, 7);
  const applied = h.commit(failed);
  assert.equal(parseSheets(applied.console.match(/PC:([\s\S]*?)NPCs in Party:/)[1], 'pc')[0].hp, 23);
  assert.equal(h.db()['0,0,0'].trapTriggered, true);
  const retry = await h.plan(selected({ result: 'failure' }), [{}]);
  assert.deepEqual(Object.keys(retry.trap_damage), []);
  const solved = await h.plan(selected(), [{ Benedict: 250 }]);
  assert.ok(solved.puzzle_completed); assert.equal(solved.xp_awarded.Benedict, 250);
});

test('ordinary dialogue and inspection never trigger the legacy failed-attempt trap branch', async () => {
  const h = harness(), result = await h.plan(selected({ action: 'Dialogue', result: 'failure' }));
  assert.deepEqual(Object.keys(result.trap_damage), []); assert.equal(h.requests.length, 0);
});

test('bad puzzle identities, dead/fabricated recipients and invalid amounts cannot partially commit rewards', () => {
  const original = text(), database = { '0,0,0': { objects: [], exits: {} } }, id = Rewards.identity(original), before = JSON.stringify(database);
  for (const effect of [
    { id: 'wrong puzzle', contributors: ['Benedict'], xp: { Benedict: 250 } },
    { id, contributors: ['Fallen Ally'], xp: { 'Fallen Ally': 250 } },
    { id, contributors: ['Hades'], xp: { Hades: 250 } },
    { id, contributors: ['Benedict'], xp: { Benedict: -1 } }
  ]) {
    assert.throws(() => applyAdditionalOutcomes({ puzzle_completed: { id: effect.id, contributors: effect.contributors }, xp_awarded: effect.xp }, original, database));
    assert.equal(JSON.stringify(database), before);
  }
});

test('missing puzzles and placeholder solutions have no completion identity', () => {
  assert.equal(Rewards.identity(buildInitialWorldConsole().console), null);
  assert.equal(Rewards.identity(text().replace(/^Puzzle Solution:.*$/m, 'Puzzle Solution: None')), null);
});

test('the real action generator permits an unsolved puzzle after searches are exhausted, without changing the die or command path', async () => {
  const h = harness({ exhausted: true }), initial = selected(), prompts = []; let calls = 0;
  const dice = new ActionDice({ animationMs: 0, random: () => 17 }); dice.begin('exploration', '0,0,0', event => {
    if (event.pending) setImmediate(() => dice.submit(event.pending.id, event.pending.actionId, event.pending.geoKey));
  });
  const rows = [{ low: 1, high: 6, result: 'failure' }, { low: 7, high: 14, result: 'partial' }, { low: 15, high: 20, result: 'success' }]
    .map(row => ({ ...row, actor: 'Benedict', activity: 'PuzzleSolving', questAttempted: false,
      puzzleSteps: row.result === 'success' ? ['align both dials and speak oath'] : [], evidenceIds: [] }));
  const agent = { user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); },
    assistant: { generation: async () => ({ content: calls++ ? '- "Benedict":\n1. Dice roll range 1-6: Fails to turn the dials.\n2. Dice roll range 7-14: Turns only one dial.\n3. Dice roll range 15-20: Completes both dials and speaks the oath.\n' +
      '[[ACTION_METADATA]]' + JSON.stringify(rows) + '[[/ACTION_METADATA]]' : '{"action":"PuzzleSolving"}' }) } };
  const ctx = { ...h.context, actionDice: dice, selectCommandedNpcs };
  vm.runInNewContext(generator, ctx);
  const outcome = await ctx.generateOutcomes(agent, 'align both dials and speak the oath', text());
  assert.equal(outcome['Dice Rolls'][0].roll, 17); assert.equal(outcome.metadata[0].result, 'success');
  assert.ok(prompts.some(p => p.includes('The room is not exhausted'))); assert.equal(calls, 2); dice.end();
});
