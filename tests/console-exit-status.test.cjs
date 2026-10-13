'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('assets/game.js', 'utf8');
const context = { window: { DungeonInhabitants: require('../assets/dungeonInhabitants') } };
vm.runInNewContext(source.slice(source.indexOf('function consoleAdjacentRooms('), source.indexOf('function refreshConsoleExitStatus(')), context);
test('adjacent-room labels reflect actual exit state instead of stale lock annotations', () => {
  const exit = { status: 'locked', targetCoordinates: '-2,0,0' };
  const db = new Map([['-1,-1,0', { exits: { northwest: exit } }], ['-2,0,0', { name: "The Sentinel's Bastion" }]]);
  const previous = "northwest: The Sentinel's Bastion (locked)";
  assert.equal(context.consoleAdjacentRooms(db, 'X: -1, Y: -1, Z: 0', previous), previous);
  exit.status = 'open';
  assert.equal(context.consoleAdjacentRooms(db, '-1,-1,0', previous), "northwest: The Sentinel's Bastion");
  exit.status = 'sealed';
  assert.equal(context.consoleAdjacentRooms(db, '-1,-1,0', previous), "northwest: The Sentinel's Bastion (sealed)");
  assert.equal(context.consoleAdjacentRooms({}, '-1,-1,0', previous), previous);
});
