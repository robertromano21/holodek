'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { repair } = require('../tools/repair-save-room-description.cjs');
const bad = 'I can\u2019t establish or describe \u201cThe Spring of Unburied Green\u201d as the current room: the verified location is X: 1, Y: 1, Z: 0, an uninhabited stretch of open ashland. ';
const good = 'Beneath Tartarus\u2019s yellow sky, green seepage stains the basalt.';

function fixture() {
  return { roomKey: '1,1,0', savedAt: '2026-10-15T17:00:00Z', turns: 30, server: {
    updatedGameConsole: 'Room Description: ' + bad + good + '\nTurns: 30',
    roomNameDatabaseString: JSON.stringify({ '1,1,0': { sceneSpec: { source: { description: bad + good } } } }),
    roomDungeonDatabase: { '1,1,0': { cells: { '1,1': { tile: 'floor' } }, sceneSpec: { source: { description: bad + good } } } },
    roomMusicDatabase: { '1,1,0': { composition: { seed: bad + good }, notes: [1, 2, 3] } },
    currentTasks: [{ status: 'In Progress' }], questLog: [{ description: 'Find the keeper.' }], combatCharactersString: '[{"name":"Mortacia","hp":138}]',
    campaignMemory: { records: [{ text: 'The room: ' + bad + good }] }
  }, browser: { position: { x: 1.5, y: 1.5, angle: 0 }, conversation: { rows: [{ response: bad + good }] },
    data: { inventory: ['verdant graveplate'], latestUpdatedData: { roomDescription: bad + good } } } };
}

test('surgery removes exactly the refusal sentence from matching prose copies, not songs or gameplay', () => {
  const original = fixture(), snapshot = structuredClone(original), result = repair(original), p = result.payload;
  assert.equal(result.description, good); assert.equal(p.browser.data.latestUpdatedData.roomDescription, good);
  assert.equal(p.browser.conversation.rows[0].response, good);
  assert.equal(p.server.campaignMemory.records[0].text, 'The room: ' + good);
  assert.equal(p.server.roomDungeonDatabase['1,1,0'].sceneSpec.source.description, good);
  assert.equal(JSON.parse(p.server.roomNameDatabaseString)['1,1,0'].sceneSpec.source.description, good);
  assert.deepEqual(p.server.roomMusicDatabase, original.server.roomMusicDatabase);
  assert.deepEqual(p.server.roomDungeonDatabase['1,1,0'].cells, original.server.roomDungeonDatabase['1,1,0'].cells);
  assert.equal(result.changes.length, 6); assert.deepEqual(original, snapshot);
});

test('healthy or empty descriptions cannot be silently rewritten by the repair', () => {
  const p = fixture(); p.server.updatedGameConsole = 'Room Description: ' + good;
  assert.throws(() => repair(p), /Nothing changed/);
  p.server.updatedGameConsole = 'Room Description: ' + bad;
  assert.throws(() => repair(p), /No description was committed/);
});
