const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const { createPopulationService } = require('../retort/roomPopulation');
const sheet = (name, state = 'Neutral', hp = 20) => `${name}\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: ${hp}\nMaxHP: 20\nEquipped: Weapon: spear, Armor: None, Shield: None, Other: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3${state ? '\nState: ' + state : ''}`;
const consoleText = () => `Room Name: Grave Market\nCoordinates: X: 1, Y: 0, Z: 0\nExits: north, east\nInventory: seal key\nPC:\n${sheet('PC', 'Alive')}\nNPCs in Party:\n${sheet('Companion', 'Friendly')}\nMonsters in Room:\n${sheet('Pilgrim', 'Friendly')}\n${sheet('Mason', 'Neutral')}\n${sheet('Guard', 'Hostile')}\n${sheet('Fallen', 'Dead', 0)}\nMonsters Equipped Properties: None\nMonsters State: Hostile\nRooms Visited: 2`;
function dungeon() {
  const d = { geoKey: '1,0,0', classification: { indoor: true }, layout: { width: 64, height: 64 }, start: { x: 4, y: 4 }, cells: {} };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  return d;
}

test('mixed legacy and stateful sheets retain their original fourteen fields with LF and CRLF', () => {
  for (const eol of ['\n', '\r\n']) {
    const input = [sheet('Legacy', null), sheet('Friendly', 'Friendly'), sheet('Neutral', 'Neutral'), sheet('Dead', 'Dead', 0)].join('\n\n').replace(/\n/g, eol);
    const rows = I.parseBlocks(input);
    assert.deepEqual(rows.map(a => a.name), ['Legacy', 'Friendly', 'Neutral', 'Dead']);
    assert.deepEqual(rows.map(a => a.state), [undefined, 'Friendly', 'Neutral', 'Dead']);
    assert.ok(rows.every(a => a.magic === 3 && a.damage === 2 && a.level === 2));
  }
});

test('states survive the plaintext console round trip; HP death wins and PC only has Alive or Dead', () => {
  const input = consoleText(), output = I.withStates(input);
  assert.equal(I.withStates(output), output);
  assert.deepEqual(I.parseSheets(output).map(a => a.state), ['Friendly', 'Neutral', 'Hostile', 'Dead']);
  assert.equal(I.parseSheets(output, 'PC')[0].state, 'Alive');
  assert.match(output, /Monsters State: Mixed/);
  assert.equal(I.state({ type: 'pc', HP: 0, State: 'Alive' }), 'Dead');
  assert.equal(I.state({ type: 'pc', HP: 10, State: 'Hostile' }), 'Alive');
  assert.equal(I.parseSheets(I.withStates(input.replace('HP: 20', 'HP: -3')), 'PC')[0].state, 'Dead');
  assert.match(output, /Inventory: seal key\n/);
});

test('old sheets are migrated without changing equipment or shifting any stat fields', () => {
  const old = consoleText().replace(/^State: .*\n/gm, '');
  const output = I.withStates(old);
  assert.equal(output.replace(/^\s*State: [^\n]*\n/gm, '').replace('Monsters State: Mixed', 'Monsters State: Hostile'), old);
  assert.ok(I.parseSheets(output).every(a => a.lines.length === 15));
});

test('population restores individual sheet states instead of inheriting a contradictory shared room flag', () => {
  let text = consoleText(), database = '{}', roster = JSON.stringify([{ name: 'PC', type: 'pc', hp: 20 }, { name: 'Companion', type: 'npc', hp: 99 }]);
  const map = new Map(), state = { getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v, getRoomPopulation: key => map.get(key),
    setRoomPopulation: (key, v) => map.set(key, v), getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v };
  const service = createPopulationService(state), p = service.prepare(text, dungeon());
  assert.deepEqual(['Pilgrim', 'Mason', 'Guard', 'Fallen'].map(name => p.actors[name].state), ['Friendly', 'Neutral', 'Hostile', 'Dead']);
  assert.equal(p.actors.Fallen.status, 'dead');
  assert.ok(p.groups.every(g => new Set(g.members.map(name => p.actors[name].allegiance)).size === 1));
  assert.match(JSON.parse(database)['1,0,0'].monsters.inRoom, /State: Neutral/);
  assert.equal(JSON.parse(roster).find(a => a.name === 'Companion').hp, 20);
  text = text.replace('Companion\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: 20', 'Companion\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: 0');
  service.prepare(text, dungeon());
  assert.equal(JSON.parse(roster).find(a => a.name === 'Companion').state, 'Dead');
  roster = JSON.stringify([...JSON.parse(roster), { name: 'Fallen', type: 'monster', hp: 20 }]);
  service.prepare(text, dungeon());
  assert.equal(JSON.parse(roster).find(a => a.name === 'Fallen').hp, 0);
  assert.equal(JSON.parse(database)['1,0,0'].monsters.consoleBlock, JSON.parse(database)['1,0,0'].monsters.inRoom);
});

test('proximity views hide remote and occluded monsters without modifying the saved roster', () => {
  const d = dungeon(), p = I.createPopulation(d.geoKey, [{ name: 'Mason', allegiance: 'Neutral' }, { name: 'Guard', allegiance: 'Hostile' }, { name: 'Pilgrim', allegiance: 'Friendly' }]);
  p.actors.Mason.position = { x: 6, y: 4 }; p.actors.Guard.position = { x: 54, y: 4 }; p.actors.Pilgrim.position = { x: 4, y: 8 };
  d.cells['4,7'].tile = 'wall';
  const original = consoleText(), metadata = JSON.stringify(p), names = I.nearbyMonsterNames(d, [], p, { x: 4.5, y: 4.5 });
  assert.deepEqual(names, ['Mason']);
  const view = I.perceivedConsole(original, names);
  assert.deepEqual(I.parseSheets(view).map(a => a.name), ['Mason']);
  assert.match(view, /State: Neutral/); assert.match(view, /Inventory: seal key/);
  assert.equal(JSON.stringify(p), metadata); assert.equal(I.parseSheets(original).length, 4);
  p.actors.Guard.position = { x: 7, y: 4 };
  assert.ok(I.nearbyMonsterNames(d, [], p, { x: 4.5, y: 4.5 }).includes('Guard'));
  assert.match(I.perceivedConsole(original, []), /Monsters in Room: None/);
});

test('repeated nearby console projections do not accumulate blank lines or shift sheet fields', () => {
  for (const eol of ['\n', '\r\n']) {
    const original = consoleText().replace(/\n/g, eol);
    for (const names of [[], ['Mason'], ['Pilgrim', 'Mason', 'Guard', 'Fallen']]) {
      const first = I.perceivedConsole(original, names);
      let text = first;
      for (let i = 0; i < 20; i++) text = I.perceivedConsole(text, names);
      assert.equal(text, first);
      const block = text.match(I.sectionPattern('Monsters in Room'))[2];
      assert.doesNotMatch(block, /\n[ \t]*\r?\n/);
      assert.deepEqual(I.parseSheets(text).map(actor => actor.name), names);
      for (const actor of I.parseSheets(text)) {
        assert.equal(actor.lines.length, 15);
        assert.match(actor.lines[7], /^HP:/);
        assert.match(actor.lines[9], /^Equipped:/);
        assert.equal(actor.lines[13], 'Magic: 3');
        assert.match(actor.lines[14], /^State:/);
      }
      assert.deepEqual(I.parseSheets(original).map(actor => actor.name), ['Pilgrim', 'Mason', 'Guard', 'Fallen']);
    }
  }
});

test('nearby corpses still expose Dead for testing, but cannot speak or fight', () => {
  const d = dungeon(), p = I.createPopulation(d.geoKey, [{ name: 'Fallen', allegiance: 'Hostile' }]);
  p.actors.Fallen.position = { x: 5, y: 4 }; I.sync(p, [{ name: 'Fallen', hp: 0 }]);
  assert.deepEqual(I.nearbyMonsterNames(d, [], p, { x: 4.5, y: 4.5 }), ['Fallen']);
  const roster = [{ name: 'PC', type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: d.geoKey },
    { name: 'Fallen', type: 'monster', hp: 0, mazeX: 5, mazeY: 4, mazeRoomKey: d.geoKey }];
  assert.equal(I.perceive(d, roster, p).nearby.length, 0);
  assert.equal(I.teams(roster, p, null, 'attack Fallen').hostiles.length, 0);
});

test('recruited and departed residents cannot reappear through a stale monster roster', () => {
  const d = dungeon(), p = I.createPopulation(d.geoKey, [{ name: 'Guard', allegiance: 'Hostile' }]);
  p.actors.Guard.position = { x: 5, y: 4 };
  const roster = [{ name: 'Guard', type: 'monster', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: d.geoKey }];
  for (const status of ['recruited', 'departed']) {
    p.actors.Guard.status = status;
    assert.deepEqual(I.nearbyMonsterNames(d, roster, p, { x: 4.5, y: 4.5 }), []);
  }
  const companion = { name: 'Guard', type: 'npc', hp: 20 };
  p.actors.Guard.status = 'dead';
  I.attach([companion], p);
  assert.equal(companion.state, 'Friendly');
  assert.deepEqual(I.nearbyMonsterNames(d, [], { ...p, geoKey: '9,9,9' }, { x: 4.5, y: 4.5 }), []);
});

test('optional party recovery restores only party HP and keeps legacy sheet formatting and resident state intact', () => {
  const { restorePartyHealth } = require('../assets/partyRecovery');
  for (const modern of [true, false]) {
    const input = consoleText().replace('HP: 20', 'HP: -9').replace('Companion\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: 20',
      'Companion\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: 0').replace('State: Alive', 'State: Dead');
    const original = modern ? input : input.replace(/^State: .*\n/gm, '');
    const output = restorePartyHealth(original);
    assert.deepEqual(output.restored.map(a => [a.name, a.hp]), [['PC', 20], ['Companion', 20]]);
    assert.equal(I.parseSheets(output.consoleText, 'PC')[0].hp, 20);
    assert.equal(I.parseSheets(output.consoleText, 'NPCs in Party')[0].hp, 20);
    assert.deepEqual(I.parseSheets(output.consoleText), I.parseSheets(original));
    assert.equal(I.parseSheets(output.consoleText, 'PC')[0].lines.length, modern ? 15 : 14);
  }
});

test('opening the actual combat popup retains monsters, states, sprites and positions', () => {
  const source = fs.readFileSync('assets/index.html', 'utf8');
  const start = source.indexOf('function toggleCombatPopup()');
  const end = source.indexOf('\n    function ', start + 10);
  const roster = [{ name: 'PC', type: 'pc', hp: 20, x: 15, y: 15 }, { name: 'Guard', type: 'monster', state: 'Hostile', mazeX: 50, mazeY: 42, sprite: { dataUrl: 'guard' } }];
  const popup = { style: { display: 'none' } }, scene = { _combatMapInitialCentered: true, redrawCombatRT() {} };
  const root = { combatCharacters: roster, combatGame: { scene: { getScene: () => scene } }, updateCombatScene: incoming => assert.equal(incoming, roster) };
  const context = { window: root, document: { getElementById: () => popup }, getCombatRosterForUi: () => roster.filter(a => a.type === 'pc') };
  vm.runInNewContext(source.slice(start, end), context);
  context.toggleCombatPopup(); assert.equal(root.combatCharacters.length, 2); assert.equal(root.combatCharacters[1].mazeX, 50);
  context.toggleCombatPopup(); context.toggleCombatPopup(); assert.equal(root.combatCharacters.length, 2);
});

test('adjudication sends only perceived monsters to action narration while committing the full canonical console', async () => {
  const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
  const first = source.indexOf('async function resolveActionWithSimulation(');
  const body = source.slice(first, source.indexOf('async function adjudicateActionWithPythonSimulation(', first));
  const full = consoleText(), perceived = I.perceivedConsole(full, ['Mason']);
  let committed;
  const context = { console: { log() {}, warn() {}, error() {} },
    sharedState: { getCurrentTasks: () => [], getCurrentTaskIndex: () => 0 },
    generateOutcomes: async (_agent, _input, text) => {
      assert.equal(text, perceived);
      assert.deepEqual(I.parseSheets(text).map(a => a.name), ['Mason']);
      return { Outcomes: [] };
    },
    generateAdditionalOutcomes: async (_agent, _outcomes, text) => { assert.equal(text, full); return {}; },
    processGameUpdate: (_outcomes, text) => { committed = text; return text; },
    generateNarrative: () => 'The nearby mason nods.' };
  vm.runInNewContext(body, context);
  const result = await context.resolveActionWithSimulation({}, 'speak to the mason', full, null, 1, 0, perceived);
  assert.equal(committed, full);
  assert.equal(result.updatedGameConsole, full);
  assert.equal(I.parseSheets(result.updatedGameConsole).length, 4);
});

