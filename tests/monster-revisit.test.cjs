const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');

const game = fs.readFileSync(path.join(__dirname, '../assets/game.js'), 'utf8').replace(/\r\n/g, '\n');
const renderer = fs.readFileSync(path.join(__dirname, '../assets/rendererWebGL.js'), 'utf8');
const key = '-1,-1,0', formattedKey = 'X: -1, Y: -1, Z: 0';
const sheet = (name, state, hp = 20) => `${name}\nFemale\nWraith\nSentinel\nLevel: 2\nAC: 10\nXP: 2000\nHP: ${hp}\nMaxHP: 20\nEquipped: None\nAttack: 1\nDamage: 2\nArmor: 0\nMagic: 3\nState: ${state}`;
const dead = [['Vexathar', 0], ['Varokth', 0], ['Zerathis', -3], ['Lathira', -3]];
const alive = [['Pilgrim', 'Friendly'], ['Mason', 'Neutral'], ['Guard', 'Hostile']];
const monsterSheets = [...dead.map(([name, hp]) => sheet(name, 'Dead', hp)), ...alive.map(([name, state]) => sheet(name, state))].join('\n');
const canonical = `Room Name: The Shifting Cairns\nCoordinates: ${formattedKey}\nPC:\n${sheet('PC', 'Alive')}\nNPCs in Party:\n${sheet('Companion', 'Friendly')}\n${sheet('Fallen Companion', 'Dead', 0)}\nMonsters in Room:\n${monsterSheets}\nMonsters Equipped Properties: None\nMonsters State: Dead\nRooms Visited: 11`;
const actor = (name, state = 'Hostile', hp = 20, type = 'monster') => ({ name, state, hp, type,
  x: 4, y: 4, mazeX: 4, mazeY: 4, mazeRoomKey: formattedKey, sprite: { dataUrl: 'data:' + name, spec: { kind: 'procedural' } } });
const fullRoster = () => [actor('PC', 'Alive', 20, 'pc'), actor('Companion', 'Friendly', 20, 'npc'),
  actor('Fallen Companion', 'Dead', 0, 'npc'), ...dead.map(([name, hp]) => actor(name, 'Dead', hp)),
  ...alive.map(([name, state]) => actor(name, state))];

function extract(first, last) {
  const start = game.indexOf(first), end = game.indexOf(last, start);
  assert.ok(start >= 0 && end > start, first);
  return game.slice(start, end);
}
function fixture(population = null) {
  const created = [], destroyed = [];
  const visual = name => ({ visible: true, setVisible(value) { this.visible = value; }, setOrigin() {}, destroy() { destroyed.push(name); } });
  const root = { DungeonInhabitants: I, currentCoordinates: formattedKey, combatCharacters: [],
    DungeonLife: { population: () => population } };
  const context = { window: root, Phaser: { Scene: class {} }, COMBAT_GRID_CENTER: 15,
    console: { log() {}, warn() {}, info() {}, error() {} }, performance,
    cloneSpritePayload: value => value, ensurePCSpriteInCombatList() {}, ensureKnownSpritesInCombatList() {},
    syncPartyMazeToCombatPositions() {}, applyCombatVisualFrame() {}, moveCombatVisualTo() {}, refreshCombatVisualIfStale() {},
    createCombatVisual: (_scene, entry) => { created.push(entry.name); return visual(entry.name); } };
  vm.runInNewContext(extract('function copyCombatPersistentFields(', 'function seedPartyCombatRoster(') +
    extract('function setCombatVisualOverlayVisible(', 'function syncCombatActorOverlayFromMaze(') +
    extract('class CombatScene extends Phaser.Scene', 'const gameConfig =') + '\nwindow.TestCombatScene = CombatScene;', context);
  const scene = new root.TestCombatScene();
  scene.sys = { game: { loop: { wake() {}, sleep() {} } } };
  scene.time = { delayedCall: () => ({ remove() {} }) };
  scene.add = { text: (_x, _y, name) => visual(name + ':label') };
  scene.characters = {};
  return { root, context, scene, created, destroyed };
}

test('individual presence never uses the room summary and saved absence cannot create living ghosts', () => {
  const population = I.createPopulation(key, alive.map(([name, allegiance]) => ({ name, allegiance })));
  const before = JSON.stringify(population);
  assert.ok(alive.every(([name, state]) => I.isPresent(actor(name, state), population)));
  assert.ok(dead.every(([name, hp]) => !I.isPresent(actor(name, 'Hostile', hp), population)));
  assert.equal(I.isPresent(actor('Dead by state', 'Dead', 20), population), false);
  assert.equal(JSON.stringify(population), before);
  for (const status of ['dead', 'recruited', 'departed']) {
    population.actors.Guard.status = status;
    assert.equal(I.isPresent(actor('Guard'), population), false);
  }
  assert.equal(I.isPresent(actor('Guard', 'Friendly', 20, 'npc'), population), true, 'A recruited companion uses its party sheet');
});

test('pending outdoor residents stay in the canonical roster but never appear in combat-map visuals', () => {
  const f = fixture(), roster = fullRoster();
  roster.find(a => a.name === 'Guard').discoveryState = 'pending';
  f.scene.updateCharacters(roster);
  assert.ok(f.root.combatCharacters.some(a => a.name === 'Guard'));
  assert.equal(f.scene.characters.Guard.sprite.visible, false);
  assert.equal(f.scene.characters.Guard.label.visible, false);
  f.scene.updatePositions(roster);
  assert.equal(f.scene.characters.Guard.sprite.visible, false);
  const population = I.createPopulation(key, [{ name: 'Guard', allegiance: 'Hostile' }]);
  Object.assign(population.actors.Guard, { discoveryState: 'placed', discoveryRevision: 1, position: { x: 20, y: 20 } });
  I.attach(f.root.combatCharacters, population);
  f.scene.updatePositions(f.root.combatCharacters);
  assert.equal(f.scene.characters.Guard.sprite.visible, true);
  assert.equal(f.scene.characters.Guard.label.visible, true);
});

test('actual room-console roster construction skips dead sheets without removing their saved evidence', () => {
  const start = game.indexOf('        let characters = [];', game.indexOf('class MainScene extends Phaser.Scene'));
  const body = game.slice(start, game.indexOf('        const initialCoords =', start));
  const root = { DungeonInhabitants: I, combatCharacters: [] };
  const context = { window: root, pc: sheet('PC', 'Alive'), npcs: I.parseSheets(canonical, 'NPCs in Party').map(a => a.sheet).join('\n'),
    monsters: monsterSheets, monstersState: 'Dead', characterState: (a, type, fallback) => I.state({ ...a, type }, fallback),
    resolveKnownCharacterSprite: () => null };
  vm.runInNewContext(body + '\nwindow.restoredRoster = characters;', context);
  assert.deepEqual(Array.from(root.restoredRoster, a => a.name), ['PC', 'Companion', 'Pilgrim', 'Mason', 'Guard']);
  assert.equal(I.parseSheets(canonical).length, 7);
  assert.deepEqual(I.parseSheets(canonical).slice(0, 4).map(a => a.hp), [0, 0, -3, -3]);
});

test('combat-map revisits and updates cannot recreate dead sprites or remove surviving mixed-state inhabitants', () => {
  const f = fixture(), names = ['PC', 'Companion', 'Pilgrim', 'Mason', 'Guard'];
  for (let revisit = 0; revisit < 2; revisit++) {
    f.scene.updateCharacters(fullRoster());
    assert.deepEqual(Object.keys(f.scene.characters), names);
    assert.deepEqual(Array.from(f.root.combatCharacters, a => a.name), names);
  }
  assert.ok(f.created.every(name => names.includes(name)));
  const ghost = actor('Vexathar', 'Dead', 0);
  f.root.combatCharacters.push(ghost);
  f.scene.characters.Vexathar = { sprite: { destroy() { f.destroyed.push('ghost sprite'); } },
    label: { destroy() { f.destroyed.push('ghost label'); } } };
  f.scene.updatePositions(fullRoster());
  assert.deepEqual(Object.keys(f.scene.characters), names);
  assert.ok(f.destroyed.includes('ghost sprite') && f.destroyed.includes('ghost label'));
});

test('legacy name-only updates recheck presence after copying saved HP and state', () => {
  for (const method of ['updateCharacters', 'updatePositions']) {
    const f = fixture();
    f.root.combatCharacters = fullRoster();
    const namesOnly = fullRoster().map(({ name, type, x, y }) => ({ name, type, x, y }));
    f.scene[method](namesOnly);
    assert.ok(!f.created.some(name => dead.some(([deadName]) => name === deadName)));
    assert.deepEqual(Object.keys(f.scene.characters), ['PC', 'Companion', 'Pilgrim', 'Mason', 'Guard']);
  }
});

test('3D actor selection excludes each dead actor before preparing sprites, retaining all living allegiances', () => {
  for (const sharedHelper of [true, false]) {
    const f = fixture();
    if (!sharedHelper) { delete f.root.isDungeonActorPresent; delete f.root.DungeonInhabitants; }
    f.root.combatCharacters = fullRoster();
    const prepared = [];
    f.root.ensureKnownSpritesInCombatList = list => prepared.push(...list.map(a => a.name));
    vm.runInNewContext(renderer, f.context);
    const view = f.root.webglDungeonRenderer;
    view._getActorWorldSpec = () => ({ kind: 'procedural' });
    assert.deepEqual(Array.from(view._getVisibleCharacterVoxelActors(), a => a.name), ['Companion', 'Pilgrim', 'Mason', 'Guard']);
    assert.ok(!prepared.some(name => dead.some(([deadName]) => name === deadName)));
    assert.equal(f.root.combatCharacters.length, fullRoster().length, 'Rendering does not edit canonical roster data');
  }
});

test('presence metadata from another room cannot hide a living same-name actor in this room', () => {
  const population = I.createPopulation('8,8,0', [{ name: 'Guard', allegiance: 'Hostile' }]);
  population.actors.Guard.status = 'dead';
  const f = fixture(population);
  assert.equal(f.root.isDungeonActorPresent(actor('Guard')), true);
});
