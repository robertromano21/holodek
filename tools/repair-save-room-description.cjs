'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Saves = require('../saveGames');
const RoomDescription = require('../retort/roomDescription');

function repair(payload) {
  const next = structuredClone(payload), key = next.roomKey;
  const consoleDescription = next.server.updatedGameConsole.match(/^Room Description:\s*([^\r\n]*)/m)?.[1];
  const prefix = consoleDescription?.match(/^I can(?:not|'t|\u2019t) establish or describe [^\r\n]*?[.!?](?:\s+|$)/)?.[0];
  if (!prefix) throw Error('The current saved description has no recognized refusal sentence. Nothing changed.');
  const description = RoomDescription.validate(consoleDescription.slice(prefix.length));
  const changes = [];
  function clean(value, path) {
    // Composition seeds are identities, not display prose: changing one would
    // change the reconstructed song. Never rewrite music or graphical seeds.
    if (path.startsWith('server.roomMusicDatabase.') || /(?:^|\.)seed$/i.test(path)) return value;
    if (typeof value === 'string') {
      if (!value.includes(prefix)) return value;
      changes.push(path); return value.split(prefix).join('');
    }
    if (value && typeof value === 'object') for (const name of Object.keys(value)) value[name] = clean(value[name], path ? path + '.' + name : name);
    return value;
  }
  const database = JSON.parse(next.server.roomNameDatabaseString);
  if (!database[key]) throw Error('The saved room is missing from its database. Nothing changed.');
  clean(database[key], `roomDatabase.${key}`);
  next.server.roomNameDatabaseString = JSON.stringify(database);
  clean(next, '');
  for (const field of ['currentTasks', 'currentTaskIndex', 'questLog', 'currentQuest', 'combatCharactersString',
    'currentPC', 'roomPopulations', 'roomMusicDatabase', 'lastCoords', 'dungeonRunId']) {
    assert.deepEqual(next.server[field], payload.server[field], `Repair changed protected state: ${field}`);
  }
  assert.deepEqual(next.browser.position, payload.browser.position);
  assert.deepEqual(next.browser.data.inventory, payload.browser.data.inventory);
  assert.equal(next.savedAt, payload.savedAt); assert.equal(next.turns, payload.turns);
  assert.ok(next.server.updatedGameConsole.includes('Room Description: ' + description));
  return { payload: next, description, changes };
}

function main(args) {
  const slot = Saves.slotNumber(args[0] || 1), store = Saves.createStore(), envelope = store.read(slot);
  const result = repair(envelope.payload);
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ dryRun: true, slot, expectedChecksum: envelope.checksum, description: result.description, changes: result.changes }, null, 2)); return;
  }
  const expected = args[args.indexOf('--expected-checksum') + 1];
  if (!args.includes('--expected-checksum') || expected !== envelope.checksum) throw Error('Confirm the current checksum from a dry run before modifying a save.');
  const backup = store.file(slot).replace(/\.json\.gz$/, `.before-description-${Date.now()}.json.gz`);
  fs.copyFileSync(store.file(slot), backup, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(store.file(slot) + '.bak')) fs.copyFileSync(store.file(slot) + '.bak', backup + '.prior-bak', fs.constants.COPYFILE_EXCL);
  const metadata = store.write(slot, result.payload, { overwrite: true, expectedChecksum: expected });
  assert.deepEqual(store.read(slot).payload, result.payload);
  console.log(JSON.stringify({ repaired: true, slot, checksum: metadata.checksum, backup,
    description: result.description, changedFields: result.changes.length, turns: metadata.turns, gameplayPreserved: true }, null, 2));
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { repair };
