'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const I = require('../assets/dungeonInhabitants'), Flow = require('../retort/combatTurnFlow');
function popupFixture() {
  const nodes = new Map(), saved = new Map();
  const element = tag => ({ tag, style: {}, attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    append(...children) { for (const c of children) this.appendChild(c); },
    appendChild(c) { this.children.push(c); if (c.id) nodes.set(c.id, c); },
    remove() { nodes.delete(this.id); }, querySelector() { return null; } });
  const document = { body: element('body'), createElement: element, getElementById: id => nodes.get(id) };
  const window = { dungeonRunId: 'run', sessionStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) } };
  const load = () => vm.runInNewContext(fs.readFileSync('assets/combatLifeUi.js', 'utf8'), { window, document });
  load(); return { window, document, nodes, load };
}
test('recovery explains the full story above combat and stays until acknowledged, including reconnects', () => {
  const f = popupFixture(), data = { runId: 'run', messageRevision: 4, rescuesUsed: 1, recoveryTitle: 'Twin Buoys',
    message: 'The relay wakes. '.repeat(70) + 'The first buoy is spent. Restored to 4 HP.' };
  f.window.CombatLifeUi.receive(data);
  const popup = f.nodes.get('revival-popup');
  assert.equal(popup.attrs.role, 'dialog'); assert.match(popup.style.cssText, /z-index:24000/);
  assert.equal(popup.children[1].textContent, data.message);
  assert.match(popup.children[2].textContent, /Remaining recoveries: 1/);
  f.window.CombatLifeUi.receive(data); assert.equal(f.nodes.get('revival-popup'), popup);
  popup.children.at(-1).listeners.click(); assert.equal(f.nodes.has('revival-popup'), false);
  f.load(); f.window.CombatLifeUi.receive(data); assert.equal(f.nodes.has('revival-popup'), false);
  f.window.CombatLifeUi.receive({ ...data, messageRevision: 7, rescuesUsed: 2 });
  assert.match(f.nodes.get('revival-popup').children[2].textContent, /Remaining recoveries: 0/);
});
test('foreign adventures cannot display a recovery popup', () => {
  const f = popupFixture(); f.window.CombatLifeUi.receive({ runId: 'old', messageRevision: 1, message: 'Old life.' });
  assert.equal(f.nodes.has('revival-popup'), false);
});
function tacticalFixture() {
  const posts = [], dungeon = { geoKey: '1,0,0', cells: { '3,4': {}, '3,3': {}, '20,20': {} } };
  const pc = { name: 'PC', type: 'pc', hp: 10, mazeX: 3, mazeY: 4, mazeRoomKey: dungeon.geoKey };
  const ally = { name: 'Ally', type: 'npc', hp: 0, state: 'Dying', mazeX: 20, mazeY: 20, mazeRoomKey: dungeon.geoKey };
  const scene = { _lastDungeonDraw: { dungeon, pos: { x: 3.5, y: 4.5 }, combatAngle: 0 } };
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: { classList: { remove() {} } } };
  const window = { combatCharacters: [pc, ally], DungeonInhabitants: I, combatGame: { scene: { getScene: () => scene } }, addEventListener() {} };
  const turn = { tactical: true, combatant: 'PC', geoKey: dungeon.geoKey, runId: 'run', turnId: 't', actionId: 'a',
    movement: { position: { x: 3.5, y: 4.5 }, revision: 0, tiles: [{ x: 3, y: 3 }] } };
  vm.runInNewContext(fs.readFileSync('assets/combatTacticalUi.js', 'utf8'), { window, document,
    fetch: async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ turn }) }; } });
  const ui = window.CombatTacticalUi; ui.changeFloor(dungeon.geoKey); ui.receive({ active: { kind: 'combat', turn } });
  return { ui, window, pc, ally, posts, scene };
}
test('WASD and arrow movement coexist with click movement even after a combat button has focus', async () => {
  const f = tacticalFixture();
  for (const event of [{ key: 'w', code: 'KeyW' }, { key: 'ArrowUp', code: 'ArrowUp' }]) {
    assert.equal(f.ui.keyMove({ ...event, target: { closest: selector => selector.includes('button') }, preventDefault() {} }), true);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(f.posts.length, 2); assert.ok(f.posts.every(p => p.x === 3 && p.y === 3));
  await f.ui.move({ x: 3, y: 3 }); assert.equal(f.posts.length, 3);
  assert.equal(f.ui.keyMove({ key: 'w', code: 'KeyW', target: { closest: () => true } }), false, 'Typing in an input stays safe');
});
test('finding a dying companion pans only the map, retains PC coordinates and ends on a floor change', () => {
  const f = tacticalFixture(); f.ui.locate('Ally');
  assert.equal(JSON.stringify(f.ui.mapCenter({ x: 3.5, y: 4.5 })), JSON.stringify({ x: 20.5, y: 20.5 }));
  const player = f.ui.occupants({ ...f.scene._lastDungeonDraw, pos: { x: 20.5, y: 20.5 } }).find(a => a.name === 'PC');
  assert.equal(player.x, 3); assert.equal(player.y, 4); assert.equal(f.ally.state, 'Dying');
  f.ui.changeFloor('1,0,1'); assert.equal(f.ui.active(), false);
});
test('retreat never offers opportunity attacks against zero-HP allies', () => {
  const hostile = { name: 'Guard', hp: 10, type: 'monster', state: 'Hostile', x: 1, y: 1 };
  const party = ['Dying', 'Unconscious', 'Dead'].map(state => ({ name: state, type: 'npc', state, hp: 0, x: 1, y: 2 }));
  assert.deepEqual(Flow.opportunityTargets(hostile, party, null), []);
  const standing = { name: 'Standing', type: 'pc', hp: 1, x: 1, y: 2 };
  assert.deepEqual(Flow.opportunityTargets(hostile, [...party, standing], null), [standing]);
});

test('the separate death scene names the reviver and offers a deliberate return to play', () => {
  const f = popupFixture();
  f.window.CombatLifeUi.receive({ runId: 'run', messageRevision: 8, rescuesUsed: 1, message: 'Restored at half maximum HP.',
    deathScene: { reviver: 'Anchor Custodian', description: 'A quiet relay vestibule emerges from darkness.', words: 'I used the first charge to return you. One chance remains.' } });
  const box = f.nodes.get('revival-popup');
  assert.equal(f.window._deathSceneActive, true); assert.match(box.style.cssText, /inset:0/);
  assert.equal(box.children[0].textContent, 'Anchor Custodian');
  assert.match(box.children[1].textContent, /vestibule/); assert.match(box.children[2].textContent, /first charge/);
  assert.equal(box.children.at(-1).textContent, 'Return to the level entrance');
  box.children.at(-1).listeners.click(); assert.equal(f.window._deathSceneActive, false);
});
