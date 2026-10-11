'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Journey = require('../retort/journeyMemory');

test('party synopsis reports verified partial progress and existing boss bindings, without completing tasks', () => {
  const tasks = [{ status: 'Completed', desc: 'Rescue the keeper.' }, { status: 'In Progress', desc: 'Recover the seal.',
    progress: { satisfied: 1, total: 3 } }];
  const text = 'Room Name: Ash Garden\nRooms Visited: 8\nQuests Achieved: 1\nArtifacts Found: 2\nNext Boss: Ash Regent\nNext Boss Room: Oath Tower\nBoss Room Coordinates: X: 3, Y: 2, Z: 1';
  const state = { getUpdatedGameConsole: () => text, getCurrentQuest: () => 'Lift the old curse.',
    getCurrentTasks: () => tasks, getCurrentTaskIndex: () => 1 };
  const before = JSON.stringify(tasks), synopsis = Journey.progressSynopsis(state);
  assert.equal(synopsis.boundBoss, 'Ash Regent');
  assert.equal(synopsis.bossCoordinates, 'X: 3, Y: 2, Z: 1');
  assert.deepEqual(synopsis.completedSteps, ['Rescue the keeper.']);
  assert.deepEqual(synopsis.activeStep, { number: 2, status: 'In Progress', goal: 'Recover the seal.', verified: '1/3' });
  assert.equal(JSON.stringify(tasks), before);
  assert.match(Journey.progressPrompt(state), /not new adjudication/);
});

test('synopsis size is bounded even when persisted story fields are unusually long', () => {
  const huge = 'word '.repeat(50000);
  const state = { getUpdatedGameConsole: () => `Room Name: ${huge}\nNext Boss: ${huge}`, getCurrentQuest: () => huge,
    getCurrentTasks: () => Array(100).fill({ status: 'Completed', desc: huge }), getCurrentTaskIndex: () => 100 };
  assert.ok(Journey.progressPrompt(state).length < 2500);
  assert.equal(Journey.progressSynopsis(state).activeStep, null);
});

test('the main response gets a progress synopsis and existing IndexedDB population storage retains it', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.match(source, /await \$\.user\(JourneyMemory\.progressPrompt\(sharedState\)\)/);
  assert.match(source, /population\.journey = JourneyMemory\.progressSynopsis\(sharedState\)/);
  const game = fs.readFileSync(require.resolve('../assets/game.js'), 'utf8');
  assert.match(game, /objectStore\(DUNGEON_INHABITANTS_STORE\)\.put\(population/);
});
