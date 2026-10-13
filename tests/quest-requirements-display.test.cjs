'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Q = require('../retort/questProgress');
const I = require('../assets/dungeonInhabitants');
const P = require('../assets/physicalPuzzles');

const db = { '0,0,0': { name: 'Ruined Temple Entrance' }, '-1,1,0': { name: 'Hall of Eternal Echoes' },
  '0,1,0': { name: 'Hall of Quiet Descent' } };
const items = [{ type: 'object', name: 'chronicle of ruined temple entrance', placement: '0,0,0' },
  { type: 'armor', name: 'shroud of eternal echoes', placement: '-1,1,0' }];
const retrieval = () => ({ type: 'Fetch', actionKind: 'take_item', status: 'In Progress',
  desc: 'Find the shroud in the northern hall.', metrics: 'Whatever the narrator says.', requiredElements: structuredClone(items),
  hardRequirements: [{ check: 'at_coords', value: '0,0,0' }, ...items.map(e => ({ check: 'inventory_contains', value: e.name }))],
  actionRequirements: [] });

test('retrieval requirements show every exact item and bound source, not abbreviated narrative or similar loot', () => {
  const text = Q.describeQuestRequirements(retrieval(), db);
  assert.ok(text.includes('Be in Ruined Temple Entrance (0,0,0).'));
  assert.ok(text.includes('Have "chronicle of ruined temple entrance" in your inventory. Item source: Ruined Temple Entrance (0,0,0).'));
  assert.ok(text.includes('Have "shroud of eternal echoes" in your inventory. Item source: Hall of Eternal Echoes (-1,1,0).'));
  assert.doesNotMatch(text, /northern hall|soulshroud|Whatever|not yet fully bound/);
});

test('delivery requirements name exact items, recipient, destination and handoff action without a retain-item gate', () => {
  const task = Q.normalizeDeliveryTask({ ...retrieval(), actionKind: 'deliver_item', desc: 'Give both to Grelma.',
    requiredElements: [...items, { type: 'monster', name: 'Grelma Voss', placement: '0,1,0' }] });
  const text = Q.describeQuestRequirements(task, db);
  for (const e of items) assert.ok(text.includes(`Give "${e.name}" to Grelma Voss in Hall of Quiet Descent (0,1,0).`));
  assert.match(text, /Item source: Hall of Eternal Echoes/);
  assert.match(text, /Dropping it or mentioning it does not count/);
  assert.doesNotMatch(text, /Have .* in your inventory|puzzle|not yet fully bound/);
});

test('the display exposes real puzzle, kill and exit gates even when prose omits them, without spoiling solutions', () => {
  const puzzle = P.fallback('display-test', 'Quiet Descent');
  const database = { ...db, '0,1,0': { ...db['0,1,0'], puzzleMechanism: puzzle } };
  const task = { ...retrieval(), type: 'Puzzle', actionKind: 'solve_puzzle',
    requiredElements: [...items, { type: 'monster', name: 'Bastion Guardian', placement: '0,1,0' }],
    actionRequirements: [{ check: 'puzzle_solved', value: '0,1,0', mechanismId: puzzle.id },
      { check: 'monster_hp_zero', value: 'Bastion Guardian' }, { check: 'exit_open', coords: '0,1,0', direction: 'west' }] };
  const text = Q.describeQuestRequirements(task, database);
  assert.ok(text.includes(`Solve the physical puzzle "${puzzle.title}" in Hall of Quiet Descent (0,1,0).`));
  assert.ok(text.includes('Defeat Bastion Guardian in Hall of Quiet Descent (0,1,0) (HP must be 0 or below).'));
  assert.ok(text.includes('Open the west exit in Hall of Quiet Descent (0,1,0) (it must be unlocked).'));
  assert.doesNotMatch(text, /goal|solution|diagram|mechanismId/);
});

test('requirements follow updated immutable task bindings instead of cached progress checks', () => {
  const task = retrieval();
  task.progress = { checks: [{ requirement: { check: 'inventory_contains', value: 'obsolete shroud' } }] };
  task.hardRequirements[2].value = 'shroud of silent stars';
  task.requiredElements[1].name = 'shroud of silent stars';
  const text = Q.describeQuestRequirements(task, db);
  assert.match(text, /Have "shroud of silent stars"/);
  assert.doesNotMatch(text, /obsolete shroud|shroud of eternal echoes/);
});

test('display formatting never mutates task identity, receipts, progress or database records', () => {
  const task = retrieval(), database = structuredClone(db);
  const before = JSON.stringify({ task, database }), binding = Q.taskBinding(task);
  Object.freeze(task); Object.freeze(database);
  for (let i = 0; i < 3; i++) {
    const text = Q.describeQuestRequirements(task, database);
    assert.equal(Q.taskBinding(task), binding);
    assert.equal(Q.describeQuestRequirements(JSON.parse(JSON.stringify(task)), database), text);
  }
  assert.equal(JSON.stringify({ task, database }), before);
});

test('missing or conflicting room records use bound coordinates rather than inventing a northern hall', () => {
  const task = retrieval();
  const text = Q.describeQuestRequirements(task, { ...db, 'X: -1, Y: 1, Z: 0': { name: 'Wrong Hall' } });
  assert.match(text, /Item source: Room \(-1,1,0\)/);
  assert.doesNotMatch(text, /Wrong Hall|Hall of Eternal Echoes|northern hall/);
  assert.match(Q.describeQuestRequirements(task, {}), /Room \(0,0,0\)/);
});

test('unimplemented and malformed gates are disclosed and missing item bindings remain visible', () => {
  const text = Q.describeQuestRequirements({ ...retrieval(), type: 'Investigate', actionKind: 'investigate',
    hardRequirements: [null], actionRequirements: [{ check: 'invented_handoff' }] }, db);
  assert.match(text, /Unverified requirement: hardRequirements is invalid/);
  assert.match(text, /Unverified requirement: invented_handoff/);
  assert.match(text, /Task item: "shroud of eternal echoes"/);
  assert.match(text, /not yet fully bound to engine-verifiable actions/);
  assert.throws(() => Q.describeQuestRequirements({ hardRequirements: Array(65).fill(null) }, db), /64/);
});

test('console writer replaces duplicate or stale fields and clears old objectives after step completion', () => {
  const original = 'Current Quest: Keep this narrative.\r\nQuest Progress: 1/3\r\nQuest Requirements: stale\r\nInventory: soulshroud\r\nQuest Requirements: duplicate\r\n';
  const text = Q.writeQuestRequirements(original, retrieval(), db);
  assert.equal(text.match(/^Quest Requirements:/gm).length, 1);
  assert.ok(text.includes('Current Quest: Keep this narrative.'));
  assert.ok(text.includes('Inventory: soulshroud'));
  assert.doesNotMatch(text, /stale|duplicate/);
  assert.equal(Q.writeQuestRequirements(text, retrieval(), db), text);
  assert.match(Q.writeQuestRequirements(text, { ...retrieval(), status: 'Completed' }, db), /^Quest Requirements: Step completed\./m);
  const waiting = Q.writeQuestRequirements(text, null, db);
  assert.match(waiting, /^Quest Requirements: Awaiting the next step/m);
  assert.doesNotMatch(waiting.match(/^Quest Requirements:.*$/m)[0], /shroud/);
});

test('streamed console views preserve requirements, clear stale fields, and leave monster sheets intact', () => {
  const text = Q.writeQuestRequirements('Current Quest: Recover the records.\nQuest Progress: 1/3\nMonsters in Room: None\nMonsters Equipped Properties: None', retrieval(), db);
  const view = I.consoleView(text);
  assert.equal(view.questRequirements, Q.describeQuestRequirements(retrieval(), db));
  assert.equal(view.monsters, 'None');
  assert.equal(I.consoleView('Current Quest: None', view).questRequirements, '');
});

const game = fs.readFileSync('assets/game.js', 'utf8');
const declarations = game.slice(game.indexOf('        const currentQuest = data?.currentQuest'), game.indexOf('        const nextArtifact = data?.nextArtifact'));
const section = game.slice(game.indexOf('Current Quest: ${currentQuest}'), game.indexOf('\nNext Artifact: ${nextArtifact}'));
const render = new Function('data', 'window', declarations + '\nreturn `' + section + '`;');

test('the actual console template escapes full requirement names and preserves them through local inventory redraws', () => {
  const window = {}, text = 'Have "the <shroud> & emerald" in your inventory.';
  const first = render({ currentQuest: 'Retrieve the shroud', questRequirements: text }, window);
  assert.match(first, /Quest Requirements: Have &quot;the &lt;shroud&gt; &amp; emerald&quot;/);
  assert.equal(window.questRequirementsText, text);
  assert.ok(render({ currentQuest: 'Retrieve the shroud' }, window).includes('the &lt;shroud&gt;'));
  assert.doesNotMatch(render({ currentQuest: 'None', questRequirements: '' }, window), /Quest Requirements:/);
  assert.equal(window.questRequirementsText, '');
  assert.ok(game.includes("Quest Requirements: ${window.questRequirementsText || 'None'}"));
});
