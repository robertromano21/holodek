'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Tactical = require('../assets/combatTacticalUi');
const fs = require('node:fs'), vm = require('node:vm');

test('expanded combat window uses the available width from a one-inch left margin to the right controls', () => {
  for (const width of [540, 1024, 1680, 2546]) for (const zoom of [1, 1.3125, 1.75, 2]) {
    const edge = width - Math.min(320, width * .3), left = width < 900 ? 12 : 96;
    const d = Tactical.dimensions(width, 950, zoom, edge, left);
    assert.ok(Math.abs(d.left * zoom - left) < 1e-8 && d.top >= 0);
    assert.ok((d.left + d.width) * zoom <= edge - 11);
    assert.ok(Math.abs(d.width * zoom - (edge - left - 12)) < 1e-8);
    assert.equal(d.stacked, d.width < 480);
  }
});

test('desktop combat uses the full free center, beside every party avatar and above lower shortcuts', () => {
  for (const zoom of [1, 1.3125, 1.75, 2]) for (const partyTop of [700, 350]) {
    const rects = { party: { left: 8, right: 330, top: partyTop, bottom: 1160 },
      console: { left: 2060, right: 2540 }, log: { left: 1940, right: 2540 },
      command: { left: 560, right: 1700, top: 1100 },
      shortcuts: [{ left: 1740, right: 1810, top: 1010, bottom: 1080 }] };
    const d = Tactical.combatBounds(2544, 1248, zoom, rects);
    assert.equal(d.compact, false); assert.equal(d.stacked, false);
    assert.ok(Math.abs(d.left * zoom - 342) < 1e-8); assert.ok(Math.abs(d.top * zoom - 31.2) < 1e-8);
    assert.ok(Math.abs((d.left + d.width) * zoom - 1928) < 1e-8, 'Icons below the map do not steal its right-hand space');
    assert.ok(Math.abs((d.top + d.height) * zoom - 998) < 1e-8);
  }
});

test('small screens stack the map above the complete party controls', () => {
  const d = Tactical.combatBounds(540, 950, 1.75, { party: { left: 8, right: 280, top: 650 }, command: { left: 10, right: 530, top: 820 } });
  assert.equal(d.compact, true); assert.equal(d.stacked, true);
  assert.equal(d.left * 1.75, 12); assert.equal((d.top + d.height) * 1.75, 638);
});

test('ledger summarizes authoritative outcomes, orders initiative and keeps raw rolling out', () => {
  const f = fixture(), data = { initiative: [{ name: 'Mortacia', roll: 15 }, { name: 'Dantuea', roll: 19 }], entries: [
    { kind: 'hit', actor: 'Dantuea', target: 'Mortacia', damage: 15, hp: 108 },
    { kind: 'miss', actor: 'Mortacia', target: 'Dantuea' } ] };
  const state = { active: { kind: 'combat', ledger: data }, results: [{ actor: 'Dantuea', label: 'Damage', natural: 3, modifier: 12, total: 15 }] };
  const content = f.ui.ledgerContent(state);
  assert.equal(content.initiative, 'Initiative: Dantuea (19), Mortacia (15)');
  assert.deepEqual(Array.from(content.entries), ['Dantuea hits Mortacia for 15 damage.\nMortacia has 108 HP left.', 'Mortacia misses Dantuea.']);
  assert.ok(!JSON.stringify(content).includes('3 + 12'));
  f.ui.receive(state); f.ui.receiveLog('Wrong hits Nobody for 500 damage.');
  assert.equal(f.ui.ledgerContent(state).entries.length, 2, 'Legacy logs cannot duplicate structured outcomes');
});

test('older running servers get an outcome-only fallback without changing the full game log', () => {
  const f = fixture(), log = 'Dantuea: d20 12 + 10 = 22..\nDantuea hits Mortacia for 15 damage. Mortacia has 108 HP left..\nMortacia misses Dantuea..';
  f.ui.receiveLog(log); f.ui.receiveLog(log);
  const content = f.ui.ledgerContent(f.state);
  assert.deepEqual(Array.from(content.entries), ['Dantuea hits Mortacia for 15 damage.\nMortacia has 108 HP left.', 'Mortacia misses Dantuea.']);
});

function fixture({ active = true, zoom = 1 } = {}) {
  const strokes = [], fills = [], submitted = [], opened = [], requests = [], notices = [], zooms = [];
  const actors = [{ name: 'PC', type: 'pc', mazeX: 4, mazeY: 4 },
    { name: 'Giant', type: 'monster', mazeX: 5, mazeY: 4, sprite: { spec: { stature: { scale: 3 } } } },
    { name: 'Ally', type: 'npc', mazeX: 4, mazeY: 5 },
    { name: 'Undiscovered', type: 'monster', mazeX: 6, mazeY: 4, discoveryState: 'pending' },
    { name: 'Elsewhere', type: 'npc', mazeX: 3, mazeY: 4, mazeRoomKey: '9,9,0' }];
  const draw = { centerX: 100, centerY: 100, pos: { x: 4.5, y: 4.5 }, combatAngle: .7, cs: 12.5,
    dungeon: { geoKey: '1,0,0', cells: {} } };
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) draw.dungeon.cells[`${x},${y}`] = { tile: 'floor' };
  let stroke, fill;
  const gfx = { lineStyle(_w, color) { stroke = color; }, fillStyle(color) { fill = color; },
    strokeRect(...args) { strokes.push({ color: stroke, args }); }, fillRect(...args) { fills.push({ color: fill, args }); },
    setPosition() {}, setRotation() {}, setScale() {}, destroy() {} };
  const scene = { PIXEL_SCALE: 2, _lastDungeonDraw: draw, sys: { game: { canvas: { style: {} }, loop: { wake() {} } } },
    cameras: { main: { zoom, setZoom(value) { this.zoom = value; zooms.push(value); } } },
    make: { graphics: () => gfx }, renderRT: { draw() {}, clear() {} }, actorRT: { draw() {}, clear() {} } };
  const nodes = new Map();
  const element = () => ({ style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); }, remove() { nodes.delete(this.id); } });
  const box = { ...element(), getBoundingClientRect: () => ({ width: 0 }), classList: { add() {}, toggle() {}, remove() {} } };
  const status = {};
  const root = { combatCharacters: actors, innerWidth: 1680, innerHeight: 950,
    CombatTurnUi: { receive() {}, submit(...args) { submitted.push(args); }, notice(s) { notices.push(s); } },
    CombatCharacterUi: { open(actor) { opened.push(actor.name); } },
    CombatFootprint: require('../assets/combatFootprint'),
    combatGame: { scene: { getScene: () => scene } } };
  const document = { getElementById: id => id === 'combat-popup' ? box : id === 'combat-map-status' ? status : nodes.get(id),
    createElement: element, querySelectorAll: () => [] };
  const context = { window: root, document, fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) };
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/combatTacticalUi'), 'utf8'), context);
  const ui = root.CombatTacticalUi;
  const state = { active: { kind: 'combat', turn: { tactical: true, targets: ['Giant'], attackTargets: ['Giant'],
    movement: { revision: 0, tiles: [{ x: 3, y: 4, cost: 1 }, { x: 5, y: 4, cost: 1 }] } } } };
  if (active) ui.receive(state);
  const project = (x, y) => {
    const dx = (x + .5 - draw.pos.x) * draw.cs, dy = (y + .5 - draw.pos.y) * draw.cs;
    return { x: 2 * (draw.centerX + dx * Math.cos(draw.combatAngle) - dy * Math.sin(draw.combatAngle)),
      y: 2 * (draw.centerY + dx * Math.sin(draw.combatAngle) + dy * Math.cos(draw.combatAngle)) };
  };
  return { ui, actors, draw, scene, status, project, strokes, fills, submitted, opened, requests, notices, zooms, state };
}

test('combat-only grid spacing grows without changing sprite zoom or world coordinates', () => {
  const f = fixture({ active: false }), original = JSON.stringify(f.actors);
  assert.equal(f.ui.cellScale(), 1);
  f.ui.receive(f.state); assert.equal(f.ui.cellScale(), 1.25);
  assert.deepEqual(JSON.parse(JSON.stringify(f.ui.actorPoint({ type: 'pc' }, { x: 4.2, y: 7.8 }))), { x: 4.5, y: 7.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.ui.actorPoint({ type: 'monster', combatFootprint: { width: 2, height: 3 } }, { x: 4, y: 7 }))), { x: 5, y: 8.5 });
  assert.equal(JSON.stringify(f.actors), original);
  f.ui.receive({ active: null }); assert.equal(f.ui.cellScale(), 1);
});

test('arrow keys use rotated tactical tile movement and opening a blocked enemy does not attack', async () => {
  const f = fixture(); f.draw.combatAngle = 0;
  f.state.active.turn.combatant = 'PC'; f.state.active.turn.movement.position = { x: 4.5, y: 4.5 };
  let prevented = 0;
  const key = (key, target = {}) => f.ui.keyMove({ key, target, preventDefault() { prevented++; } });
  assert.equal(key('ArrowRight'), true); assert.deepEqual(f.opened, ['Giant']); assert.equal(f.requests.length, 0);
  assert.equal(key('ArrowLeft'), true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.x, 3); assert.equal(f.requests[0].body.y, 4);
  f.draw.combatAngle = Math.PI / 2; key('ArrowUp'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.at(-1).body.x, 3); assert.equal(f.requests.at(-1).body.y, 4);
  assert.equal(key('ArrowDown', { closest: () => ({ tagName: 'TEXTAREA' }) }), false);
  assert.equal(prevented, 3); assert.equal(f.submitted.length, 0);
  f.ui.receive({ active: null }); assert.equal(key('ArrowLeft'), false);
});

test('unavailable keyboard destinations explain the restriction and paused combat cannot move', () => {
  const f = fixture(); f.draw.combatAngle = 0; f.state.active.turn.movement.position = { x: 1.5, y: 1.5 };
  const event = { key: 'ArrowUp', preventDefault() {} };
  f.ui.keyMove(event); assert.match(f.notices[0], /square is not available/); assert.equal(f.requests.length, 0);
  f.state.active.turn.movement.busy = true; f.ui.keyMove(event);
  assert.equal(f.notices.length, 1); assert.equal(f.requests.length, 0);
});

test('current initiative display drops unconscious actors without erasing their earlier outcomes', () => {
  const f = fixture(); f.actors[1].hp = 0; f.actors[1].state = 'Unconscious';
  const content = f.ui.ledgerContent({ active: { ledger: { initiative: [{ name: 'Giant', roll: 20 }, { name: 'PC', roll: 10 }],
    entries: [{ kind: 'miss', actor: 'Giant', target: 'PC' }] } } });
  assert.equal(content.initiative, 'Initiative: PC (10)'); assert.deepEqual(Array.from(content.entries), ['Giant misses PC.']);
});

test('175% zoom applies only during combat and restores the previous exploration zoom each time', () => {
  for (const zoom of [1, 1.1]) {
    const f = fixture({ active: false, zoom }), camera = f.scene.cameras.main;
    f.ui.setMapZoom(1.5); assert.equal(camera.zoom, zoom, 'Exploration is never enlarged');
    for (let i = 0; i < 2; i++) {
      f.ui.receive(f.state); assert.equal(camera.zoom, 1.75, 'Each battle starts at 175%');
      f.ui.setMapZoom(1.25); f.ui.receive(f.state);
      assert.equal(camera.zoom, 1.25, 'Combat updates preserve an in-battle zoom choice');
      f.ui.receive({ active: null }); assert.equal(camera.zoom, zoom, 'Victory/retreat restores exploration');
      f.ui.receive(null); assert.equal(camera.zoom, zoom, 'Repeated combat-end messages are harmless');
    }
  }
});

test('special-floor combat reset also restores the normal zoom', () => {
  const f = fixture({ active: false });
  f.ui.changeFloor('1,0,0', true); f.ui.receive(f.state);
  assert.equal(f.scene.cameras.main.zoom, 1.75);
  f.ui.changeFloor('1,0,1', true);
  assert.equal(f.ui.active(), false); assert.equal(f.scene.cameras.main.zoom, 1);
});

test('logical occupied cells do not grow with sprite size or reveal undiscovered/other-room actors', () => {
  const f = fixture(), before = JSON.stringify(f.actors);
  assert.deepEqual(JSON.parse(JSON.stringify(f.ui.occupants(f.draw))).map(a => [a.name, a.x, a.y]),
    [['PC', 4, 4], ['Giant', 5, 4], ['Ally', 4, 5]]);
  f.ui.draw(f.scene, f.draw); assert.equal(f.fills.length, 0, 'Reachable floor is not shaded green');
  f.ui.drawOverlay(f.scene, f.draw);
  assert.equal(f.strokes.filter(s => s.color === 0xef766c).length, 1, 'Only the actual enemy cell is red');
  assert.equal(f.strokes.filter(s => s.color === 0x67d5ef).length, 2);
  assert.equal(JSON.stringify(f.actors), before);
});

test('hover outlines exactly one rotated square, including after zoom; leaving clears it', () => {
  const f = fixture();
  for (const value of [1.25, 1.5, 1.75]) {
    f.ui.setMapZoom(value); assert.equal(f.zooms.at(-1), value);
    f.scene.combatHoverPoint = f.project(5, 4); f.strokes.length = 0;
    f.ui.drawOverlay(f.scene, f.draw);
    assert.equal(f.strokes.filter(s => s.color === 0xffffff).length, 1);
    assert.match(f.status.textContent, /Square 5, 4: Giant \(attack available\)/);
  }
  f.scene.combatHoverPoint = null; f.strokes.length = 0; f.ui.drawOverlay(f.scene, f.draw);
  assert.equal(f.strokes.filter(s => s.color === 0xffffff).length, 0);
  assert.equal(f.status.hidden, true); assert.equal(f.status.textContent, '', 'No permanent map legend');
  f.scene.combatHoverPoint = f.project(3, 4); f.ui.drawOverlay(f.scene, f.draw);
  assert.equal(f.status.hidden, false); assert.match(f.status.textContent, /Square 3, 4: Move \(1 tiles\)/);
});

test('cell clicks open character actions without attacking, move on legal floors and explain unavailable squares', async () => {
  const f = fixture(), click = (x, y, actor = null) => {
    const p = f.project(x, y); return f.ui.click(actor, f.draw, p.x, p.y, 2);
  };
  assert.equal(click(5, 4, null), true); assert.deepEqual(f.opened, ['Giant']); assert.deepEqual(f.submitted, []);
  assert.equal(click(3, 4), true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.x, 3); assert.equal(f.requests[0].body.y, 4);
  assert.equal(f.submitted.length, 0);
  click(4, 5); assert.equal(f.opened.at(-1), 'Ally'); assert.equal(f.requests.length, 1);
  click(1, 1, null); assert.match(f.notices.at(-1), /square is not available/); assert.equal(f.requests.length, 1);
  click(3, 4, f.actors[1]); assert.equal(f.opened.at(-1), 'Giant', 'Opaque artwork opens its popup rather than moving behind it');
  assert.equal(f.requests.length, 1);
});

test('hovering any occupied cell of a large enemy outlines its full footprint and shows its name and pointer', () => {
  const f = fixture(); f.actors[1].sprite.spec.stature.category = 'large';
  f.scene.combatHoverPoint = f.project(6, 5); f.ui.drawOverlay(f.scene, f.draw);
  assert.equal(f.strokes.filter(s => s.color === 0xef766c).length, 4);
  assert.equal(f.strokes.filter(s => s.color === 0xffffff).length, 4);
  assert.match(f.status.textContent, /Giant/);
  assert.equal(f.scene.sys.game.canvas.style.cursor, 'pointer');
  const p = f.project(6, 5); f.ui.click(null, f.draw, p.x, p.y, 2);
  assert.deepEqual(f.opened, ['Giant']); assert.equal(f.requests.length, 0);
  f.scene.combatHoverPoint = f.project(5, 2); f.scene.combatHoverActor = f.actors[1]; f.strokes.length = 0;
  f.ui.drawOverlay(f.scene, f.draw);
  assert.equal(f.strokes.filter(s => s.color === 0xffffff).length, 4, 'Hovering the artwork still outlines the real footprint');
  assert.match(f.status.textContent, /Character: Giant.*4 occupied squares/);
});

test('tile picking covers the whole square, not just its center, at every angle and pixel scale', () => {
  for (const combatAngle of [0, .7, Math.PI / 2, -2.3]) for (const scale of [1, 2, 2.5]) {
    const d = { centerX: 100, centerY: 100, pos: { x: 4.27, y: 4.62 }, combatAngle, cs: 12.5 };
    for (const fx of [.01, .5, .99]) for (const fy of [.01, .5, .99]) {
      const dx = (5 + fx - d.pos.x) * d.cs, dy = (3 + fy - d.pos.y) * d.cs;
      const x = scale * (d.centerX + dx * Math.cos(combatAngle) - dy * Math.sin(combatAngle));
      const y = scale * (d.centerY + dx * Math.sin(combatAngle) + dy * Math.cos(combatAngle));
      assert.deepEqual(Tactical.tileAt(d, x, y, scale), { x: 5, y: 3 });
    }
  }
});

test('layout does not change combat-map projection or tile hit testing', () => {
  const draw = { centerX: 100, centerY: 100, pos: { x: 4.5, y: 4.5 }, combatAngle: Math.PI / 3, cs: 25 };
  const before = JSON.stringify(draw), tile = Tactical.tileAt(draw, 125, 100);
  Tactical.dimensions(1680, 950, 1.3125, 1200);
  assert.deepEqual(Tactical.tileAt(draw, 125, 100), tile);
  assert.equal(JSON.stringify(draw), before);
});
