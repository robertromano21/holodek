'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../assets/physicalPuzzles'), I = require('../assets/dungeonInhabitants');
const Actions = require('../retort/physicalPuzzleActions'), Feedback = require('../assets/actionFeedback');
const State = require('../retort/adjudicationState'), Progress = require('../retort/questProgress');
const { parseSheets } = require('../assets/partyRoster');
const { buildInitialGameConsole, buildInitialWorldConsole } = require('../retort/initialGameState');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8').replace(/\r\n/g, '\n');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const helpers = slice('async function tryPhysicalPuzzleAction(', 'async function tryDungeonDoorAction(');
const readableHelpers=slice('async function tryReadableItemAction(', 'async function tryPhysicalPuzzleAction(');
const commit = slice('function processGameUpdate(', 'async function adjudicateActionWithCodeInterpreter(');
const dispatch = slice('  // Mechanical puzzle commands never enter a model session', "  let dialogueParts = personalNarrative.split");
const quiet = { log() {}, info() {}, warn() {}, error() {} };

function fixture(kind = 'alignment') {
  // A fixed alignment fixture makes the completion boundary easy to test.
  const p = P.compile({ kind, title: 'Archive', context: 'The instrument seals a cabinet.', lore: 'An old route is recorded within.',
    controls: ['West', 'East'].map((name, index) => ({ id: name.toLowerCase(), label: `${name} ${kind === 'alignment' ? 'dial' : 'button'}`,
      mark: ['Crown', 'Eye'][index], options: ['Sun', 'Moon', 'Wave'], initial: 0, goal: index + 1 })), order: ['west', 'east'] });
  const dungeon = { geoKey: '0,0,0', layout: { width: 32, height: 32 }, start: { x: 16, y: 16 },
    classification: { indoor: true }, tiles: {}, cells: {}, sceneObjects: [], _geometryStamp: 'initial' };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dungeon.cells[`${x},${y}`] =
    { tile: !x || !y || x === 31 || y === 31 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  P.install(dungeon, { puzzleMechanism: p });
  const prose = P.prose(p);
  const state = { dungeon, text: buildInitialGameConsole(buildInitialWorldConsole().console,
    { Name: 'Hero', HP: 30, MaxHP: 30, XP: 100 }, [])
    .replace('Puzzle in Room: None', `Puzzle in Room: ${prose.description}`).replace('Puzzle Solution: None', `Puzzle Solution: ${prose.solution}`),
    database: { '0,0,0': { objects: [], exits: {}, puzzleMechanism: { ...p, state: P.initialState(p) } } },
    roster: [{ name: 'Hero', type: 'pc', hp: 30, xp: 100, mazeRoomKey: '0,0,0' }], events: [], narrationCalls: 0 };
  const sharedState = { getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getDungeonRunId: () => 'run',
    getRoomDungeon: () => state.dungeon, setRoomDungeon: (_coords, d) => state.dungeon = d,
    getRoomNameDatabase: () => JSON.stringify(state.database), setRoomNameDatabase: value => state.database = JSON.parse(value),
    getCombatCharactersString: () => JSON.stringify(state.roster), setCombatCharactersString: value => state.roster = JSON.parse(value),
    getUpdatedGameConsole: () => state.text, setUpdatedGameConsole: value => state.text = value };
  const context = { sharedState, Inhabitants: I, PhysicalPuzzles: P, ActionFeedback: Feedback, preparePhysicalPuzzleAction: Actions.prepare,
    ReadableItems:require('../assets/readableItems'),prepareReadableAction:require('../retort/readableActions').prepare,
    bindPhysicalPuzzleTask: Actions.bindTask, ...Progress, applyAdditionalOutcomes: State.applyAdditionalOutcomes, parseSheets,
    console: quiet, broadcast: event => state.events.push(event),
    finalizeRoomDungeon: (_key, d) => ({ ...d, _geometryStamp: `revision-${d.physicalPuzzle.state.revision}` }) };
  const build = vm.compileFunction(`let updatedGameConsole = sharedState.getUpdatedGameConsole(); let roomNameDatabaseString = '';
    ${commit}\n${readableHelpers}\n${helpers}
    return async function(userInput, options = {}) { ${dispatch}
      state.narrationCalls++; return { newlyCompleted: physicalPuzzleResult }; };`, [...Object.keys(context), 'state']);
  const command = build(...Object.values(context), state);
  async function act(id, input) {
    const f = state.dungeon.physicalPuzzle.fixtures.find(f => f.id === id), [x, y] = f.key.split(',').map(Number);
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => state.dungeon.cells[`${x + dx},${y + dy}`]?.tile === 'floor');
    Object.assign(state.roster[0], { mazeX: x + dx, mazeY: y + dy });
    return command(input || P.command(p, f));
  }
  return { state, p, act, command };
}

test('the real physical command path returns reads turns invalid settings and repeat solves before any model session', async () => {
  const f = fixture();
  const read = await f.act('plaque'); assert.equal(read.actionOnly, true); assert.match(read.content, /relief/);
  const bad = await f.act('west', 'set West dial to nonsense'); assert.equal(bad.actionOnly, true); assert.match(bad.content, /not on this control/);
  assert.equal(f.state.database['0,0,0'].puzzleMechanism.state.revision, 0);
  const moved = await f.act('west', 'set West dial to Moon'); assert.equal(moved.actionOnly, true);
  assert.equal(f.state.database['0,0,0'].puzzleMechanism.state.revision, 1);
  assert.equal(f.state.narrationCalls, 0); assert.equal(f.state.roster[0].xp, 100);
  assert.ok(f.state.events.some(event => event.type === 'dungeonCellUpdate'));
  const solved = await f.act('east', 'set East dial to Wave');
  assert.equal(solved.newlyCompleted.completed, true); assert.equal(f.state.narrationCalls, 1);
  assert.equal(f.state.roster[0].xp, 350);
  assert.equal(f.state.database['0,0,0'].puzzleMechanism.state.status, 'complete');
  assert.equal(f.state.events.filter(event => event.kind === 'puzzle-complete').length, 1);
  const again = await f.act('east'); assert.equal(again.actionOnly, true); assert.match(again.content, /already solved/);
  await f.act('receiver'); assert.equal(f.state.narrationCalls, 1); assert.equal(f.state.roster[0].xp, 350);
});

test('mechanical dispatch occurs before both quest generation and the main Retort session', () => {
  assert.ok(source.indexOf('// Mechanical puzzle commands') < source.indexOf('    return await run(retort(async ($) => {'));
  assert.ok(source.indexOf('// Mechanical puzzle commands') < source.indexOf('await $.run($ => generateQuest($))'));
  assert.equal((source.match(/await tryPhysicalPuzzleAction\(userInput\)/g) || []).length, 1);
  assert.match(source, /if \(!physicalPuzzleResult && !roomDescriptionGenerated/);
});

test('completion narration failure returns the committed mechanical result rather than re-running or rolling back', async () => {
  const f = fixture(); await f.act('west', 'set West dial to Moon');
  const solved = await f.act('east', 'set East dial to Wave');
  const start = source.indexOf("    } catch (error) {\n      if (!physicalPuzzleResult?.completed) throw error;");
  const fallback = source.slice(start + '    } '.length, source.indexOf('//    await restartGameServer2();', start));
  const ctx = { physicalPuzzleResult: solved.newlyCompleted, console: quiet,
    physicalPuzzleResponse: result => ({ content: result.narrative, console: f.state.text }) };
  const response = await vm.runInNewContext(`(async()=>{try { throw Error('API unavailable'); } ${fallback}})()`, ctx);
  assert.match(response.content, /250 XP/); assert.match(response.console, /XP: 350/);
  assert.equal(f.state.database['0,0,0'].puzzleMechanism.state.status, 'complete');
});
