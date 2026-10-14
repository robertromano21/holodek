'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
const start = game.indexOf('// Add event listener to clickable objects inside contentDiv');
const handlers = game.slice(start, game.indexOf('// ---- Exit click handler', start));

test('restarting the console fifty times leaves one handler per action and one pickup prompt per click', () => {
  const active = new Set(), buttons = new Map(), logs = [], commands = [];
  let popup = null, created = 0;
  const input = { value: '' }, contentDiv = { addEventListener: (_type, fn) => active.add(fn), removeEventListener: (_type, fn) => active.delete(fn) };
  const document = { querySelector: () => popup, getElementById: id => id === 'chatuserinput' ? input : buttons.get(id),
    createElement: () => ({ dataset: {}, classList: { add() {} }, remove() { if (popup === this) popup = null; },
      set innerHTML(value) { for (const [, id] of value.matchAll(/id="([^"]+)"/g)) buttons.set(id, { addEventListener: (_type, fn) => buttons.get(id).click = fn }); } }),
    body: { appendChild: node => { popup = node; created++; } } };
  const ctx = { document, contentDiv, currentDungeon: { geoKey: 'room' }, pc: 'Hero', npcs: 'None',
    window: { ObjectDiscovery: { isVisible: () => true } }, console: { log: (...args) => logs.push(args) },
    chatbotprocessinput: () => commands.push(input.value) };
  for (let i = 0; i < 50; i++) vm.runInNewContext('(function(){' + handlers + '})()', ctx);
  assert.equal(active.size, 5);
  const target = { classList: { contains: name => name === 'clickable-object' }, getAttribute: () => 'recorder of broken oaths' };
  for (const handler of active) handler({ target });
  assert.equal(created, 1); assert.equal(logs.length, 1);
  buttons.get('take-button').click();
  assert.deepEqual(commands, ['take recorder of broken oaths']); assert.equal(popup, null);
});

function proximityFixture() {
  let popup = null, clicks = 0, visible = true;
  const dungeon = { geoKey: '1,0,0', cells: {} }, item = { id: 'recorder', name: 'recorder of broken oaths', x: 1, y: 2 };
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  const link = { getAttribute: () => item.name, click: () => { clicks++; popup = { dataset: {}, remove() { popup = null; } }; } };
  const ctx = { window: { ObjectDiscovery: { isVisible: () => visible } }, document: { hidden: false,
    querySelector: () => popup, querySelectorAll: () => [link] } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/itemInteractionUi'), 'utf8'), ctx);
  return { api: ctx.window.ItemInteractionUi, dungeon, item, player: { x: 1.5, y: 1.5 }, clicks: () => clicks,
    cancel: () => popup = null, visibility: value => visible = value };
}

test('standing over outdoor loot for hundreds of projected frames prompts only once, including after Cancel', () => {
  const f = proximityFixture();
  for (let i = 0; i < 200; i++) f.api.update(f.dungeon, [{ ...f.item }], f.player);
  assert.equal(f.clicks(), 1);
  f.cancel();
  for (let i = 0; i < 200; i++) f.api.update(f.dungeon, [{ ...f.item }], f.player);
  assert.equal(f.clicks(), 1);
  f.api.update(f.dungeon, [{ ...f.item }], { x: 8, y: 8 });
  f.api.update(f.dungeon, [{ ...f.item }], f.player);
  assert.equal(f.clicks(), 2, 'Walking away and returning may prompt again.');
});

test('nearby visibility flicker does not rearm the proximity popup every frame', () => {
  const f = proximityFixture(); f.api.update(f.dungeon, [{ ...f.item }], f.player); f.cancel();
  for (let i = 0; i < 100; i++) { f.visibility(i % 2 === 0); f.api.update(f.dungeon, [{ ...f.item }], f.player); }
  assert.equal(f.clicks(), 1);
});
