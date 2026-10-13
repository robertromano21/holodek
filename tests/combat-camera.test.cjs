'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const source = fs.readFileSync('assets/game.js', 'utf8');
function fixture() {
  let renders = 0;
  const context = { window: { DungeonInhabitants: I, combatCharacters: [
    { name: 'Thalra Grimstone', type: 'monster', hp: 20, mazeX: 6, mazeY: 2, mazeRoomKey: '0,0,0' },
    { name: 'Thalra Guard', type: 'monster', hp: 20, mazeX: 8, mazeY: 4, mazeRoomKey: '0,0,0' },
    { name: 'Foreign', type: 'monster', hp: 20, mazeX: 3, mazeY: 4, mazeRoomKey: '1,0,0' },
    { name: 'Dead', type: 'monster', hp: 0, mazeX: 3, mazeY: 4, mazeRoomKey: '0,0,0' }
  ] }, currentDungeon: { geoKey: '0,0,0' }, playerPosX: 3.5, playerPosY: 4.5, playerAngle: 0,
    isDungeonActorPresent: actor => actor.hp > 0, getPartyEntryRenderMazePosition: () => null,
    renderDungeonView: () => renders++ };
  vm.runInNewContext(source.slice(source.indexOf('window.faceDungeonCombatTarget ='), source.indexOf('function isCombatRoundActive(')), context);
  return { context, renders: () => renders };
}
test('a named attack immediately faces the actual target without moving the PC or changing combat distance', () => {
  const f = fixture(), c = f.context;
  assert.equal(c.window.faceDungeonCombatTarget('Thalra Grimstone'), true);
  assert.equal(c.playerAngle, Math.atan2(-2, 3));
  assert.equal(c.window.playerAngle, c.playerAngle);
  assert.equal(c.window._combatCameraTarget, 'Thalra Grimstone');
  assert.equal(c.playerPosX, 3.5); assert.equal(c.playerPosY, 4.5);
  assert.equal(f.renders(), 1);
});
test('camera targeting never chooses an ambiguous, dead, absent or foreign-room monster', () => {
  const f = fixture();
  for (const name of ['Thalra', 'Foreign', 'Dead', 'Missing', '']) assert.equal(f.context.window.faceDungeonCombatTarget(name), false);
  assert.equal(f.renders(), 0); assert.equal(f.context.playerAngle, 0);
});
