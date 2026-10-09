const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function mount() {
  const elements = new Map(), events = {}, calls = [];
  for (const id of ['game-menu', 'game-menu-toggle', 'combat-mode-toggle', 'open-combat-button', 'open-dungeon-button',
    'dungeon-test-button', 'play-music-btn', 'phaser-popup', 'game-log-popup', 'combat-popup', 'combat-mode-select']) {
    elements.set(id, { id, style: {}, hidden: false, offsetWidth: 80, attrs: {}, events: {}, children: [],
      getBoundingClientRect: () => ({ width: 140, bottom: 56 }), focus() { this.focused = true; },
      setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, fn) { this.events[name] = fn; },
      appendChild(child) { this.children.push(child); }, contains(target) { return target === this || this.children.includes(target); } });
  }
  const document = { getElementById: id => elements.get(id), addEventListener: (name, fn) => { events[name] = fn; } };
  const window = { dungeonRunId: 'run-a', innerWidth: 1000, innerHeight: 800, addEventListener() {} };
  for (const [action, id] of [['togglePopup', 'phaser-popup'], ['toggleCombatPopup', 'combat-popup'], ['toggleGameLogPopup', 'game-log-popup']]) {
    window[action] = () => { calls.push(action); elements.get(id).style.display = 'block'; };
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/gameMenuUi'), 'utf8'), { document, window });
  events.DOMContentLoaded();
  return { window, elements, events, calls };
}
test('hamburger gathers existing controls without replacing handlers, and closes on action/outside/Escape', () => {
  const { elements, events } = mount(), menu = elements.get('game-menu'), toggle = elements.get('game-menu-toggle');
  assert.equal(menu.hidden, true); assert.equal(toggle.attrs['aria-expanded'], 'false');
  assert.equal(menu.children.length, 5);
  for (const child of menu.children) assert.equal(child.style.position, 'static');
  toggle.events.click(); assert.equal(menu.hidden, false);
  events.pointerdown({ target: menu.children[0] }); assert.equal(menu.hidden, false);
  events.pointerdown({ target: {} }); assert.equal(menu.hidden, true);
  toggle.events.click(); events.keydown({ key: 'Escape' }); assert.ok(menu.hidden && toggle.focused);
  toggle.events.click(); menu.events.click({ target: { closest: () => ({}) } }); assert.equal(menu.hidden, true);
});
test('first playable dungeon opens the three windows only once per run and honors No Combat Map', () => {
  const { window, elements, calls } = mount(), d = { layout: { width: 64, height: 64 }, start: { x: 32, y: 48 }, cells: { '32,48': { tile: 'floor' } }, _meta: { runId: 'run-a' } };
  window.GameMenuUi.onDungeonReady(null); assert.equal(calls.length, 0);
  window.GameMenuUi.onDungeonReady({ ...d, cells: {} }); assert.equal(calls.length, 0);
  window.GameMenuUi.onDungeonReady({ ...d, _meta: { runId: 'stale' } }); assert.equal(calls.length, 0);
  window.GameMenuUi.onDungeonReady(d); assert.equal(calls.length, 3);
  elements.get('game-log-popup').style.display = 'none';
  window.GameMenuUi.onDungeonReady(d); assert.equal(calls.length, 3); assert.equal(elements.get('game-log-popup').style.display, 'none');
  window.dungeonRunId = 'run-b'; elements.get('combat-mode-select').value = 'No Combat Map';
  elements.get('combat-popup').style.display = 'none';
  window.GameMenuUi.onDungeonReady({ ...d, _meta: { runId: 'run-b' } });
  assert.equal(calls.length, 4); assert.equal(elements.get('combat-popup').style.display, 'none');
});
test('real page retains handlers, has Map in the menu, and places log bottom-right/combat top-left', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.match(html, /id="game-menu" hidden/);
  assert.match(html, /id="open-exploration-map-button"/);
  assert.match(html, /combatPopup\.style\.top = '42px'/);
  assert.match(html, /combatPopup\.style\.left = '5px'/);
  const log = html.match(/function toggleGameLogPopup\(\) \{([\s\S]*?)\n    function togglePartyPopup/)[1];
  assert.match(log, /popup\.style\.right = '5px'/); assert.match(log, /popup\.style\.bottom = '5px'/);
  assert.match(log, /popup\.style\.left = 'auto'/); assert.match(log, /syncGameLogTranscript\(\)/);
});
