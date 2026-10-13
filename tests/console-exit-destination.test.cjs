'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('assets/game.js', 'utf8');
const context = {};
const begin = source.indexOf('function consoleExitDestinationName('), direction = source.indexOf('function getCoordinatesForDirection(');
vm.runInNewContext(source.slice(begin, source.indexOf('\n}', direction) + 2), context);

test('exit names follow explicit links, canonical coordinates and legacy room names without revealing unknown destinations', () => {
  const rooms = new Map([['0,1,0', { name: 'Marble Hall' }], ['4,5,-1', { name: 'Hades' }], ['X: -1, Y: 0, Z: 0', 'Old Archive']]);
  const at = { x: 0, y: 0, z: 0 }, name = context.consoleExitDestinationName;
  assert.equal(name(rooms, at, 'north'), 'Marble Hall');
  assert.equal(name(rooms, at, 'west'), 'Old Archive');
  assert.equal(name(rooms, at, 'north', { targetCoordinates: 'X: 4, Y: 5, Z: -1' }), 'Hades');
  assert.equal(name(rooms, at, 'up', { targetCoordinates: { x: 4, y: 5, z: -1 } }), 'Hades');
  assert.equal(name(rooms, at, 'north', { targetCoordinates: '9,9,9' }), null);
  assert.equal(name(rooms, at, 'east'), null);
  assert.equal(name(rooms, at, 'north', { targetCoordinates: 'bad' }), null);
  assert.equal(rooms.size, 3);
});
