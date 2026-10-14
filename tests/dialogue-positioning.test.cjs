'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const source = fs.readFileSync('assets/game.js', 'utf8');
const actors = () => [{ name: 'Hero', type: 'pc', hp: 20, mazeX: 10, mazeY: 10, mazeRoomKey: '1,0,0' },
  { name: 'Ilyra', type: 'monster', hp: 20, mazeX: 1, mazeY: 1, mazeRoomKey: '1,0,0' },
  { name: 'Pellin Reed', type: 'npc', hp: 20, mazeX: 20, mazeY: 20, mazeRoomKey: '1,0,0' }];

test('listener selection distinguishes addressing someone from merely mentioning them', () => {
  const cast = actors();
  assert.equal(I.dialogueRecipient({ speaker: 'Ilyra', line: 'Pellin, will you check the carving?' }, cast), 'Pellin Reed');
  assert.equal(I.dialogueRecipient({ speaker: 'Ilyra', line: 'Pellin repaired this carving.' }, cast), 'PC');
  assert.equal(I.dialogueRecipient({ speaker: 'Ilyra', line: 'Will you check?', recipient: 'Pellin Reed' }, cast), 'Pellin Reed');
  assert.equal(I.dialogueRecipient({ speaker: 'Ilyra', recipient: 'Invented Stranger' }, cast), 'PC');
});

for (const recipient of ['PC', 'Pellin Reed']) test(`a distant monster receives a walkable conversation goal toward ${recipient}, without teleporting`, () => {
  const cast = actors(), d = { geoKey: '1,0,0', cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const context = { window: { combatCharacters: cast, DungeonInhabitants: I }, currentDungeon: d,
    playerPosX: 10.5, playerPosY: 10.5, playerDungeonX: 10, playerDungeonY: 10, playerAngle: 0,
    Date: { now: () => 1000 }, isCombatRoundActive: () => false, rememberCombatMovementFacing() {},
    collectNearbyWalkableTiles: (d, p) => [{ x: p.x + 3, y: p.y, dist: 3 }, { x: p.x + 2, y: p.y, dist: 2 }],
    preferPartyViewingTiles: tiles => tiles };
  const start = source.indexOf('window.focusDungeonSpeaker ='), end = source.indexOf('window.beginEncounterCombat =', start);
  vm.runInNewContext(source.slice(start, end), context);
  context.window.focusDungeonSpeaker('Ilyra', 5000, recipient);
  const actor = cast[1];
  assert.equal(actor.mazeX, 1); assert.equal(actor.mazeY, 1);
  assert.ok(actor._conversationGoal.x >= (recipient === 'PC' ? 12 : 22));
  assert.equal(actor._conversationRecipient, recipient);
  assert.equal(actor._nextWanderAt, 0);
});

test('monster conversation walking takes one normal step instead of idling or applying the home leash', () => {
  const actor = actors()[1]; Object.assign(actor, { _nextWanderAt: 0, _conversationUntil: 5000, _conversationGoal: { x: 10, y: 1 } });
  const context = { window: { DungeonInhabitants: I }, currentDungeon: { geoKey: '1,0,0', cells: {} },
    Date: { now: () => 1000 }, isCombatRoundActive: () => false, getCurrentCombatRoomKey: () => '1,0,0',
    resetWalkFrame() {}, getMonsterHomeAnchor: () => ({ x: 1, y: 1 }), hashCharacterName: () => 0,
    isMonsterHostile: () => false, MONSTER_WANDER_MIN_MS: 500, MONSTER_WANDER_MAX_MS: 1500,
    MONSTER_MOVE_TWEEN_MS: 250, MONSTER_WALK_FRAME_MS: 100,
    chooseMonsterWanderStep() { throw Error('Conversation must not wander.'); },
    findNextPartyMazeStep: from => ({ x: from.x + 1, y: from.y }), rememberCombatMovementFacing() {}, advanceWalkFrame() {} };
  const start = source.indexOf('function updateMonsterWandering('), end = source.indexOf('window.updateMonsterWandering =', start);
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(context.updateMonsterWandering([actor], new Set(), 1000), true);
  assert.equal(actor.mazeX, 2); assert.equal(actor.mazeY, 1);
  context.isCombatRoundActive = () => true;
  assert.equal(context.updateMonsterWandering([actor], new Set(), 2000), false);
  assert.equal(actor.mazeX, 2);
});
