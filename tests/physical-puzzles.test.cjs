'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../assets/physicalPuzzles'), V = require('../assets/scenePropVoxels');
const { prepare, bindTask } = require('../retort/physicalPuzzleActions');
const { generateDesign, designPrompt } = require('../retort/physicalPuzzleDesign');
const { applyAdditionalOutcomes } = require('../retort/adjudicationState');
const { evaluateTaskRequirements } = require('../retort/questProgress');
const { buildInitialGameConsole, buildInitialWorldConsole } = require('../retort/initialGameState');
const UI = require('../assets/worldInteractionUi');
const clone = a => JSON.parse(JSON.stringify(a));
function definition(kind = 'alignment') {
  return P.compile({ kind, title: 'The Survey Archive', context: 'A brass survey instrument records the old routes.',
    lore: 'The survey records an old stair beneath the temple, not a newly created exit.',
    controls: ['West', 'Middle', 'East'].map((s, i) => ({ id: s.toLowerCase(), label: `${s} ${P.toolbox().mechanics[kind].suffix}`,
      mark: ['Crown', 'Eye', 'Star'][i], options: ['Sun', 'Moon', 'Wave'], initial: 0, goal: ['channels','interlock'].includes(kind) ? (i + 1) % 2 : i })),
    ...(kind==='interlock'?{couplings:[['west'],['middle'],['east']]}:{}),
    order: ['east', 'west', 'middle'], exhaustionLimit: 4 });
}
function room(size = 32) {
  const d = { geoKey: '0,0,0', layout: { width: size, height: size }, start: { x: 16, y: 16 },
    classification: { indoor: true }, tiles: {}, cells: {}, sceneObjects: [{ name: 'old sword', x: 20, y: 16 }] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] =
    { tile: !x || !y || x === size - 1 || y === size - 1 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  d.cells['18,16'].navigationReserved = true; d.cells['18,16'].exit = 'east';
  return d;
}
function fixture(kind = 'alignment', size = 32) {
  const p = definition(kind), d = room(size); P.install(d, { puzzleMechanism: p });
  const text = P.prose(p), consoleText = buildInitialGameConsole(buildInitialWorldConsole().console,
    { Name: 'Benedict', HP: 30, MaxHP: 30, XP: 100 }, [])
    .replace('Puzzle in Room: None', `Puzzle in Room: ${text.description}`).replace('Puzzle Solution: None', `Puzzle Solution: ${text.solution}`);
  let db = { '0,0,0': { name: 'Archive', objects: [], exits: {}, attemptedSearches: 6, exhaustionLimit: 4, puzzleMechanism: { ...p, state: P.initialState(p) } } }, current = consoleText;
  function act(id, value) {
    const f = d.physicalPuzzle.fixtures.find(f => f.id === id), [x, y] = f.key.split(',').map(Number);
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => d.cells[`${x + dx},${y + dy}`]?.tile === 'floor');
    const actor = { name: 'Benedict', type: 'pc', hp: 30, mazeRoomKey: d.geoKey, mazeX: x + adjacent[0], mazeY: y + adjacent[1] };
    const input = value === undefined ? P.command(p, f) : `set ${f.label} to ${p.controls.find(c => c.id === id).options[value]}`;
    const plan = prepare({ input, dungeon: d, actor, consoleText: current, room: db[d.geoKey] });
    if (plan.outcomes) {
      const committed = applyAdditionalOutcomes(plan.outcomes, current, db); db = committed.database; current = committed.console;
      Object.assign(d.cells, plan.delta.cells); d.physicalPuzzle = plan.delta.physicalPuzzle;
    }
    return plan;
  }
  return { p, d, act, db: () => db, console: () => current };
}
for (const kind of P.KINDS) test(`${kind}: matching description, solution, controls and reachable construction`, () => {
  const f = fixture(kind), e = f.d.physicalPuzzle;
  assert.equal(P.compile(f.p).id, f.p.id); assert.equal(P.verify(f.d).valid, true); assert.equal(e.fixtures.length, 5);
  assert.equal(f.d.cells['18,16'].exit, 'east'); assert.equal(f.d.cells['20,16'].tile, 'floor');
  for (const c of f.p.controls) { assert.ok(P.prose(f.p).description.includes(c.label)); assert.ok(P.prose(f.p).solution.includes(c.label)); }
  assert.doesNotMatch(P.prose(f.p).description, /Crown: Sun|East button, then/);
  for (const t of Object.values(f.d.tiles)) {
    const grid = V.build(t.spriteSpec.voxelShape); assert.ok(grid?.some(v => v > 0), t.spriteSpec.voxelShape);
    assert.match(t.url, /^data:image\/svg\+xml,/);
  }
  assert.equal(P.install(f.d, { puzzleMechanism: f.p }).status, 'existing');
});
for (const kind of P.KINDS) test(`${kind}: correct manipulations commit XP once, even after search exhaustion, and preserve locks`, () => {
  const f = fixture(kind); let result;
  if (['sequence','harmonics'].includes(kind)) for (const id of f.p.order) result = f.act(id);
  else for (const c of f.p.controls) if (c.initial !== c.goal) result = f.act(c.id, c.goal);
  assert.equal(result.metadata.source, 'verified-physical-mechanism'); assert.equal(result.metadata.result, 'success');
  assert.equal(f.db()['0,0,0'].puzzleMechanism.state.status, 'complete'); assert.match(f.console(), /XP: 350/);
  assert.equal(Object.keys(f.db()['0,0,0'].puzzleCompletions).length, 1);
  assert.ok(result.message.includes(f.p.lore));
  assert.equal(f.d.cells[f.d.physicalPuzzle.fixtures.find(f => f.id === 'receiver').key].tile.endsWith('_1'), true);
  const before = clone(f.db()), again = f.act(f.p.controls[0].id);
  assert.equal(again.allowed, false); assert.deepEqual(f.db(), before); assert.match(f.console(), /XP: 350/);
});
test('wrong sequences are resettable and do not use search attempts or damage the party', () => {
  const f = fixture('sequence');
  for (let i = 0; i < 20; i++) {
    const result = f.act('middle'); assert.equal(result.metadata.result, 'partial'); assert.equal(result.nextState.progress.length, 0);
    assert.equal(f.db()['0,0,0'].attemptedSearches, 6); assert.match(f.console(), /HP: 30/); assert.match(f.console(), /XP: 100/);
  }
  for (const id of f.p.order) f.act(id);
  assert.equal(f.db()['0,0,0'].puzzleMechanism.state.status, 'complete');
});
test('saved state survives JSON caching and reconstruction with matching visual variants', () => {
  const f = fixture(); f.act('east');
  const restored = clone(f.d); assert.equal(P.verify(restored).valid, true);
  const fresh = room(); P.install(fresh, { puzzleMechanism: clone(f.db()['0,0,0'].puzzleMechanism) });
  assert.deepEqual(fresh.physicalPuzzle.state, f.d.physicalPuzzle.state);
  assert.equal(P.verify(fresh).valid, true);
});
test('remote, dead, behind-wall, different-height and stale actors cannot manipulate controls', () => {
  const f = fixture(), control = f.d.physicalPuzzle.fixtures[0], [x, y] = control.key.split(',').map(Number);
  const actor = { name: 'Benedict', hp: 30, type: 'pc', mazeX: x + 1, mazeY: y, mazeRoomKey: '0,0,0' };
  const args = { input: `turn ${control.label}`, dungeon: f.d, actor, consoleText: f.console(), room: f.db()['0,0,0'] };
  assert.equal(prepare(args).allowed, true);
  for (const change of [{ hp: 0 }, { mazeRoomKey: '0,1,0' }, { mazeX: 30 }]) assert.equal(prepare({ ...args, actor: { ...actor, ...change } }).allowed, false);
  f.d.cells[`${x + 1},${y}`].floorHeight = 3; assert.equal(prepare(args).allowed, false);
  f.d.cells[`${x + 1},${y}`].floorHeight = 0; f.d.cells[`${x + 1},${y}`].tile = 'wall'; assert.equal(prepare(args).allowed, false);
  f.d.cells[`${x + 1},${y}`].tile = 'floor';
  const saved = clone(args.room); saved.puzzleMechanism.state.revision++;
  assert.equal(prepare({ ...args, room: saved }).allowed, false);
});
test('reading clues requires reach and cannot claim a reward; ordinary dialogue is not manipulation', () => {
  const f = fixture(); const plan = f.act('plaque');
  assert.equal(plan.inspect, true); assert.equal(plan.outcomes, undefined); assert.match(plan.message, /relief/);
  for (const input of ['how do I turn West dial?', 'say "turn West dial"', 'do not turn West dial', 'I solved the puzzle']) assert.equal(P.intent(input, f.p), null);
  assert.equal(P.intent('set West dial to nonsense', f.p).invalid, true);
});
test('adjudication refuses invented transitions and narrative-only physical puzzle completions atomically', () => {
  const f = fixture(), roomBefore = clone(f.db());
  assert.throws(() => applyAdditionalOutcomes({ puzzle_completed: { id: require('../retort/puzzleRewards').identity(f.console()), contributors: ['Benedict'] }, xp_awarded: { Benedict: 500 } }, f.console(), f.db()), /verified control/);
  assert.throws(() => applyAdditionalOutcomes({ puzzle_action: { mechanismId: f.p.id, expectedRevision: 0, controlId: 'west', nextState: { status: 'complete' } } }, f.console(), f.db()), /transition/);
  assert.deepEqual(f.db(), roomBefore);
});
test('quest puzzle gates bind exact room/design and do not waive inventory requirements', () => {
  const f = fixture(), task = { type: 'Puzzle', actionKind: 'solve_puzzle', hardRequirements: [{ check: 'inventory_contains', value: 'bound quest key' }] };
  bindTask(task, f.db(), '0,0,0'); bindTask(task, f.db(), '0,0,0');
  assert.equal(task.actionRequirements.length, 1);
  let result = evaluateTaskRequirements(task, { roomKey: '0,0,0', consoleText: f.console(), database: f.db() });
  assert.equal(result.actionFails.length, 1);
  for (const c of f.p.controls) if (c.initial !== c.goal) f.act(c.id, c.goal);
  result = evaluateTaskRequirements(task, { roomKey: '0,0,0', consoleText: f.console(), database: f.db() });
  assert.equal(result.actionFails.length, 0); assert.equal(result.hardFails.length, 1); assert.equal(task.physicalPuzzleRoom, '0,0,0');
});
test('missing physical components are exposed in construction diagnostics, not declared complete', () => {
  const f = fixture(), receiver = f.d.physicalPuzzle.fixtures.find(f => f.id === 'receiver');
  f.d.cells[receiver.key].tile = 'floor';
  assert.equal(P.verify(f.d).valid, false); assert.ok(P.verify(f.d).errors.includes('missing:receiver'));
});
test('tight indoor corridors get a small physical workshop recess without moving the spawn or exits', () => {
  const d = room();
  for (const c of Object.values(d.cells)) { c.tile = 'wall'; delete c.exit; delete c.navigationReserved; }
  for (let x = 2; x < 30; x++) d.cells[`${x},16`].tile = 'floor';
  d.sceneObjects = []; d.cells['29,16'].exit = 'east'; d.cells['29,16'].navigationReserved = true;
  assert.equal(P.install(d, { puzzleMechanism: definition() }).valid, true);
  assert.ok(d.puzzleAlcove); assert.equal(d.cells['16,16'].tile, 'floor'); assert.equal(d.cells['29,16'].exit, 'east');
});
for (const patch of [{ controls: [] }, { order: ['absent'] }, { kind: 'riddle' }, { controls: [{ id: 'plaque' }] }])
  test(`invalid design cannot become an invisible puzzle: ${JSON.stringify(patch)}`, () => assert.throws(() => P.compile({ ...definition('sequence'), ...patch })));
test('the retired ash/ember/bone design is rejected; seeded fallback varies its mechanism', () => {
  const p = definition('sequence'); p.controls.forEach((c, i) => { c.mark = ['Ash', 'Ember', 'Bone'][i]; }); assert.throws(() => P.compile(p), /retired/);
  assert.equal(new Set(Array.from({ length: 40 }, (_, i) => P.fallback(`seed-${i}`).kind)).size, 7);
});
test('one generated metadata response supplies both description and solution; malformed designs retry then fall back', async () => {
  let calls = 0; const prompts = [];
  const context = { roomName: 'Archive', seed: 'test', quest: 'Recover the existing artifact.' },expected=P.fallback(context.seed,context.roomName);
  const agent = { user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); }, assistant: { generation: async ({ maxTokens }) => {
    assert.equal(maxTokens, 4200); calls++; return { content: JSON.stringify(expected) };
  } } };
  const result=await generateDesign(agent, context);
  assert.equal(result.kind, expected.kind);assert.deepEqual(result.controls,expected.controls);assert.equal(result.readables.length,4);assert.equal(calls, 1);
  agent.assistant.generation = async () => { calls++; return { content: '{broken' }; };
  assert.ok((await generateDesign(agent, context)).id); assert.equal(calls, 5);
  assert.ok(prompts.some(s => /rejected|failed validation/.test(s)));
  assert.match(designPrompt(context), /retryable/); assert.match(P.HINT_POLICY, /Never volunteer the solution/);
});
test('mouse picking selects the actual reachable control, not sky, a remote apparatus or a prop behind a wall', () => {
  global.PhysicalPuzzles = P;
  const f = fixture(), control = f.d.physicalPuzzle.fixtures[0], [x, y] = control.key.split(',').map(Number);
  const player = { x: x + 1.5, y: y + .5 }, camera = { x: player.x, y: player.y, eyeZ: .65, dirX: -1, dirY: 0, planeScale: Math.tan(Math.PI / 6), verticalScale: 1.3, viewShift: 0 };
  assert.equal(UI.pick(f.d, camera, player, .5, .5).fixture.id, control.id);
  assert.equal(UI.pick(f.d, camera, player, .5, .01), null);
  const remote = UI.pick(f.d, { ...camera, x: x + 6.5 }, { ...player, x: x + 6.5 }, .5, .5);
  assert.equal(remote?.enabled ?? false, false);
  f.d.cells[`${x + 1},${y}`].tile = 'wall'; assert.equal(UI.pick(f.d, camera, player, .5, .5), null);
  delete global.PhysicalPuzzles;
});
test('normal narrative and quest processing remain after physical actions; no second simulation or popup puzzle path', () => {
  const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
  assert.match(source, /if \(physicalPuzzleResult\) currentSituation = physicalPuzzleResult/);
  assert.match(source, /physicalPuzzleResult \? \{ runSimulation: false \}/);
  assert.match(source, /seedAndManageQuest\(\$, updatedGameConsole, userInput, broadcast\)/);
  assert.doesNotMatch(fs.readFileSync('assets/index.html', 'utf8'), /livingEnvironmentUi\.js/);
  const interactions=fs.readFileSync('assets/worldInteractionUi.js','utf8');
  assert.doesNotMatch(interactions,/living-environment\/interact/);
  assert.equal((interactions.match(/createElement\('button'\)/g)||[]).length,1);
  assert.match(interactions,/read\.textContent='Read'/); // The only added button belongs to the existing item Take popup.
});

test('retiring the separate seal puzzle retains existing environmental prop dressing', () => {
  const Living = require('../assets/livingEnvironments');
  const spec = { source: { roomName: 'Ruined Temple', description: 'A temple courtyard stands here.' }, landmarks: [] };
  Living.enrichSceneSpec(spec);
  assert.deepEqual(spec.landmarks.map(l => l.type), ['tomb', 'altar', 'dead_tree']);
  assert.equal(spec.puzzleMechanism, undefined); assert.equal(Living.install(room(), spec).status, 'skipped');
});

test('the working mechanism owns its controls; scenery cannot create misleading dummy dials or cabinets', () => {
  const Living = require('../assets/livingEnvironments');
  const scenery = [
    { type: 'celestial_surveying_instrument_with_two_', label: 'celestial surveying instrument with two dials' },
    { type: 'closed_reading_cabinet', label: 'closed reading cabinet' },
    { type: 'instruction_plaque', label: 'instruction plaque' },
    { type: 'shattered_statues', label: 'shattered sculptures' },
    { type: 'ancient_inscription_plaque', label: 'ancient inscription plaque' },
    { type: 'arch', label: 'fractured stone arches' }
  ];
  const level = { structures: scenery.map(l => ({ type: l.type, name: l.label })), layoutFeatures: ['surveying instrument with two dials', 'raised workshop alcove'] };
  const original = clone(level), spec = { source: { roomName: 'Ruined Temple' }, landmarks: clone(scenery), level, puzzleMechanism: definition() };
  Living.enrichSceneSpec(spec);
  assert.deepEqual(spec.puzzleRenderContract.omittedScenery, scenery.slice(0, 3).map(l => l.label));
  assert.deepEqual(spec.level.structures.map(s => s.name), scenery.slice(3).map(l => l.label));
  assert.deepEqual(spec.level.layoutFeatures, ['raised workshop alcove']); assert.deepEqual(level, original);
  assert.ok(spec.landmarks.some(l => l.type === 'ancient_inscription_plaque')); assert.ok(spec.landmarks.some(l => l.type === 'dead_tree'));
  for (const l of scenery.slice(0, 3)) assert.equal(P.isReservedScenery(spec.puzzleMechanism, l), true);
  assert.equal(P.isReservedScenery(null, scenery[0]), false);
  const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
  assert.equal((source.match(/customTiles = customTiles.filter\(tile => !LivingEnvironments.isReservedScenery/g) || []).length, 2);
  assert.match(source, /Do NOT create decorative copies/);
  assert.match(fs.readFileSync('retort/levelSpec.js', 'utf8'), /never list decorative copies as structures/);
});

test('saved puzzle appearances derive exact marks and options without changing positions, state or room data', () => {
  const f = fixture(), saved = clone(f.d), control = saved.physicalPuzzle.fixtures[0];
  delete control.axis;
  for (const tile of Object.values(saved.tiles)) delete tile.spriteSpec.puzzleFace;
  const before = JSON.stringify(saved);
  const visuals = control.tiles.map(t => P.visualSpec(saved, t));
  assert.deepEqual(visuals.map(s => s.puzzleFace.option), ['Sun','Moon','Wave']);
  assert.ok(visuals.every(s => s.puzzleFace.mark === 'Crown' && ['x','y'].includes(s.puzzleFace.axis)));
  assert.equal(JSON.stringify(saved), before);
  assert.equal(P.visualSpec(saved, 'floor'), undefined);
});

test('new apparatus parts are grouped locally and present their faces toward accessible operating space', () => {
  const { d } = fixture(), fs = d.physicalPuzzle.fixtures, [x,y] = fs[0].key.split(',').map(Number);
  assert.ok(fs.every(f => { const [xx,yy] = f.key.split(',').map(Number); return Math.hypot(xx-x,yy-y) <= 6; }));
  assert.ok(fs.every(f => f.height >= .95 && f.height <= 1.15 && ['x','y'].includes(f.axis)));
});

test('dial faces are circular and upright, with physically distinct pointer states rather than generic storage blocks', () => {
  const grids = [0,1,2].map(v => V.build(`puzzle_dial_${v}`));
  assert.equal(new Set(grids.map(g => Buffer.from(g).toString('base64'))).size, 3);
  const at = (g,x,y,z) => g[x+y*16+z*256];
  assert.equal(at(grids[0],8,8,13), 1);
  assert.equal(at(grids[0],8,2,14), 0); assert.equal(at(grids[0],8,13,14), 0);
  assert.ok(grids.every(g => g.reduce((n,v) => n+v, 0) < g.length*.4));
  const rotated = V.build('puzzle_dial_0',16,0,{axis:'y'});
  for (let z=0;z<16;z++) for (let y=0;y<16;y++) for (let x=0;x<16;x++)
    assert.equal(rotated[15-y+x*16+z*256], at(grids[0],x,y,z));
});

test('buttons depress, levers hinge and cabinet doors open as different specific voxel silhouettes', () => {
  const count = shape => V.build(shape).reduce((n,v) => n+v,0);
  assert.ok(count('puzzle_button_0') > count('puzzle_button_1'));
  assert.ok(count('puzzle_cabinet_closed') > count('puzzle_cabinet_open'));
  assert.notDeepEqual(V.build('puzzle_lever_0'), V.build('puzzle_lever_1'));
  const shapes = ['puzzle_dial_0','puzzle_button_0','puzzle_lever_0','puzzle_plaque','puzzle_cabinet_closed'];
  assert.equal(new Set(shapes.map(s => Buffer.from(V.build(s)).toString('base64'))).size, shapes.length);
});

test('dial symbols follow their actual metadata and remain distinct without material texture noise', () => {
  assert.notDeepEqual(V.puzzleGlyph('Sun'),V.puzzleGlyph('Moon')); assert.notDeepEqual(V.puzzleGlyph('Crown'),V.puzzleGlyph('Eye'));
  assert.deepEqual(V.puzzleGlyph('Unknown relic'),V.puzzleGlyph('Unknown relic'));
  const optionColors = label => {
    const colors = [];
    for (let z=7;z<14;z++) for (let y=4;y<12;y++) colors.push(V.color('puzzle_dial_0',.35,y/16,z/16,[-1,0,0],[.3,.3,.3],'metal',{textures:false,puzzleFace:{option:label}}));
    return colors;
  };
  assert.equal(new Set(['Sun','Moon','Wave'].map(s => JSON.stringify(optionColors(s)))).size,3);
});

test('construction proof refuses generic scenery substituted for a working control', () => {
  const { d } = fixture(), f = d.physicalPuzzle.fixtures[0];
  d.tiles[f.tiles[0]].spriteSpec.voxelShape='altar';
  const proof=P.verify(d); assert.equal(proof.valid,false); assert.ok(proof.errors.includes('missing:'+f.id));
});

test('a 512-tile wilderness gets a bounded, nearby, complete apparatus rather than a prop farm', () => {
  const d = room(512); d.classification.indoor = false;
  const report = P.install(d, { puzzleMechanism: definition('channels') });
  assert.equal(report.valid, true); assert.equal(d.physicalPuzzle.fixtures.length, 5);
  assert.ok(d.physicalPuzzle.fixtures.every(f => {
    const [x, y] = f.key.split(',').map(Number); return Math.hypot(x - d.start.x, y - d.start.y) < 18;
  }));
  assert.equal(d.puzzleAlcove, undefined); assert.equal(Object.keys(d.tiles).length, 9);
});
