'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
const index = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
const renderer = fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8');

test('early GPU render callbacks cannot open the empty dungeon over the opening screen', () => {
  const popup = { style: { display: 'none' } }; let queries = 0, fullscreen = 0;
  const context = { window: { currentDungeon: null, dungeonTextures: {}, setDungeonFullscreenUiState() { fullscreen++; } },
    document: { getElementById() { queries++; return popup; } }, performance, console };
  vm.runInNewContext(renderer, context);
  context.window.webglDungeonRenderer.renderScene();
  assert.equal(popup.style.display, 'none'); assert.equal(fullscreen, 0); assert.equal(queries, 0);
  context.window.currentDungeon = { cells: {} }; context.window.dungeonTextures = null;
  context.window.webglDungeonRenderer.renderScene();
  assert.equal(popup.style.display, 'none'); assert.equal(queries, 0);
});

test('the main render dispatcher does not initialize a GPU or canvas viewport before a room exists', () => {
  let renders = 0, queries = 0;
  const context = { currentDungeon: null, window: { useWebGLRenderer: true, webglDungeonRenderer: {
    init() { renders++; }, renderScene() { renders++; } } }, syncDungeonExitNavigation() {},
    getVisibleSceneObjects: () => [], playerPosX: 0, playerPosY: 0, playerAngle: 0, playerZ: 0,
    playerDungeonX: 0, playerDungeonY: 0, PLAYER_EYE_HEIGHT: .65, dungeonTextures: {}, dungeonTexturesMeta: {},
    document: { getElementById() { queries++; return {}; } } };
  vm.runInNewContext(game.slice(game.indexOf('function renderDungeonView() {'), game.indexOf('// --- Poller for the dedicated character generation task')), context);
  context.renderDungeonView(); assert.equal(renders, 0); assert.equal(queries, 0);
  assert.equal(context.window.currentDungeon, null);
});

test('the dungeon toggle stays closed before startup and remains reversible once a room exists', () => {
  const popup = { style: { display: 'none' } }, changes = []; let renders = 0;
  const context = { window: {}, document: { getElementById: () => popup },
    setDungeonFullscreenUiState: value => changes.push(value), renderDungeonView() { renders++; } };
  vm.runInNewContext(index.slice(index.indexOf('function toggleDungeonPopup()'), index.indexOf('function toggleGameLogPopup()')), context);
  context.toggleDungeonPopup(); assert.equal(popup.style.display, 'none'); assert.equal(renders, 0);
  context.window.currentDungeon = { cells: {} };
  context.toggleDungeonPopup(); assert.equal(popup.style.display, 'block'); assert.equal(renders, 1);
  context.closeDungeonPopup(); assert.equal(popup.style.display, 'none'); assert.deepEqual(changes, [true, false]);
});

test('a real room can still open the GPU viewport normally', () => {
  const popup = { style: { display: 'none' } }, changes = [];
  const context = { window: { currentDungeon: { cells: {} }, dungeonTextures: {},
    setDungeonFullscreenUiState: value => changes.push(value) },
    document: { getElementById: () => popup }, performance, console };
  vm.runInNewContext(renderer, context);
  context.window.webglDungeonRenderer.init = () => false;
  context.window.webglDungeonRenderer.renderScene();
  assert.equal(popup.style.display, 'block'); assert.deepEqual(changes, [true]);
});
