'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Sync = require('../assets/sceneObjectSync');
const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
const itemConsole = objects => `Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: ${objects}\nObjects in Room Properties: None`;

test('real 2D/3D item bridge uses the current local console after Take/Drop and persists only item changes', () => {
  const dungeon = { geoKey: '0,0,0', start: { x: 2, y: 2 }, cells: {}, sceneObjects: [], _geometryStamp: 'unchanged' };
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  const originalCells = JSON.stringify(dungeon.cells);
  let persists = 0;
  const context = { currentDungeon: dungeon, playerPosX: 2.5, playerPosY: 2.5,
    window: { SceneObjectSync: Sync, lastServerGameConsole: itemConsole('Bronze Key') },
    scheduleLodCachePersist: () => { persists++; }, console: { info() {} } };
  const begin = source.indexOf('function getVisibleSceneObjects()'), end = source.indexOf('window.getVisibleSceneObjects =', begin);
  vm.runInNewContext(source.slice(begin, end), context);
  assert.equal(context.getVisibleSceneObjects().length, 1, 'New cached-room item must reach both renderer consumers');
  assert.equal(persists, 1);
  context.window.dungeonItemConsole = itemConsole('None');
  assert.equal(context.getVisibleSceneObjects().length, 0, 'Local Take must beat the older server console');
  assert.equal(persists, 2);
  context.window.dungeonItemConsole = itemConsole('Bronze Key');
  assert.equal(context.getVisibleSceneObjects().length, 1, 'Local Drop must add the item without room construction');
  assert.equal(persists, 3);
  context.getVisibleSceneObjects();
  assert.equal(persists, 3, 'Rendering a stable item list must not repeatedly save the room');
  assert.equal(JSON.stringify(dungeon.cells), originalCells);
  assert.equal(dungeon._geometryStamp, 'unchanged');
});

test('real item bridge never removes cached items when a response belongs to another room', () => {
  const item = { name: 'Bronze Key', id: 'key', x: 3, y: 3 };
  const dungeon = { geoKey: '0,0,0', sceneObjects: [item] };
  const context = { currentDungeon: dungeon, playerPosX: 2, playerPosY: 2,
    window: { SceneObjectSync: Sync, lastServerGameConsole: itemConsole('None').replace('X: 0', 'X: 1') },
    scheduleLodCachePersist: () => { throw Error('A mismatched console must not save the room'); }, console: { info() {} } };
  const begin = source.indexOf('function getVisibleSceneObjects()'), end = source.indexOf('window.getVisibleSceneObjects =', begin);
  vm.runInNewContext(source.slice(begin, end), context);
  assert.equal(context.getVisibleSceneObjects()[0], item);
});

test('original locked-exit travel still hints the exact key and never unlocks just because it is in inventory', () => {
  const room = { exits: { east: { status: 'locked', key: 'Oath Seal Key' } } };
  const context = { coordinatesToString: () => '0,0,0', roomNameDatabase: new Map([['0,0,0', room]]), inventory: ['Oath Seal Key'] };
  const begin = source.indexOf('function isExitTraversable('), end = source.indexOf('// Function to calculate new coordinates', begin);
  vm.runInNewContext(source.slice(begin, end), context);
  assert.equal(context.isExitTraversable({}, 'east').traversable, false);
  assert.match(context.isExitTraversable({}, 'east').message, /Oath Seal Key is required/);
  assert.equal(room.exits.east.status, 'locked');
  room.exits.east.status = 'open';
  assert.equal(context.isExitTraversable({}, 'east').traversable, true);
  assert.equal(context.isExitTraversable({}, 'north').traversable, false);
  assert.match(source, /<p>Go \$\{exitDirection\}\?<\/p>\s*\$\{requiredKeyHint\}/);
});

test('item sync loads before game, and current console exposes quest progress without changing popup styles', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.ok(html.indexOf('/assets/renderSceneItems.js') < html.indexOf('/assets/sceneObjectSync.js'));
  assert.ok(html.indexOf('/assets/sceneObjectSync.js') < html.indexOf('/assets/game.js'));
  assert.match(source, /Quest Progress: \$\{escapedText\(questProgress\)\}/);
  assert.match(source, /Requires: \$\{escapedText\(exitData\.key\)\}/);
  assert.match(source, /window\.dungeonItemConsole = consoleCoordNumbers\?\.length === 3/);
});

test('empty party UI shows no placeholder text and still displays character sheets when available', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.doesNotMatch(html, /No party data|Party members will appear here|party-popup-empty/);
  const elements = { 'party-popup-name': { textContent: 'Old member' },
    'party-popup-sheet': { innerHTML: 'Old sheet' }, 'party-popup-preview-canvas': {} };
  let entries = [], renders = 0;
  const context = { window: {}, document: { getElementById: id => elements[id] },
    getPartyInfoEntries: () => entries, renderPartyIconDock: () => { renders++; },
    formatPartySheetHtml: entry => entry.sheet, drawPartySpriteCanvas() {} };
  const begin = html.indexOf('function renderPartyInfoPopup('), end = html.indexOf('function updateDungeonTestingButton(', begin);
  vm.runInNewContext(html.slice(begin, end), context);
  context.renderPartyInfoPopup();
  assert.equal(elements['party-popup-name'].textContent, '');
  assert.equal(elements['party-popup-sheet'].innerHTML, '');
  entries = [{ label: 'Mortacia', sheet: 'HP: 134' }];
  context.renderPartyInfoPopup();
  assert.equal(elements['party-popup-name'].textContent, 'Mortacia');
  assert.equal(elements['party-popup-sheet'].innerHTML, 'HP: 134');
  assert.equal(renders, 2);
});
