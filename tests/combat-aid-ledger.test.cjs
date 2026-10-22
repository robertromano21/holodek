'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const I = require(path.join(root, 'assets/dungeonInhabitants'));

function fixture() {
  const nodes = [], posts = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attrs = {}; this.listeners = {}; this.scrollTop = 0; this.clientHeight = 100; this.className = ''; this.ownText = ''; this.classList = { add() {}, remove() {}, toggle() {} }; nodes.push(this); }
    get textContent() { return this.ownText + this.children.map(n => n.textContent).join(''); }
    set textContent(value) { this.ownText = value; this.children = []; }
    get scrollHeight() { return this.children.reduce((n, c) => n + 25 + Math.ceil(c.textContent.length / 30) * 14, 0); }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
    replaceChildren() { for (const c of [...this.children]) c.remove(); this.ownText = ''; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
    click() { if (!this.disabled) this.listeners.click?.(); }
  }
  const document = { body: new Element('body'), createElement: tag => new Element(tag), addEventListener() {},
    getElementById: id => nodes.find(n => n.id === id && n.parent) || null,
    querySelectorAll: selector => nodes.filter(n => n.parent && selector.split(',').some(s => n.className.split(' ').includes(s.trim().slice(1)))) };
  const box = new Element('section'); box.id = 'combat-popup'; document.body.appendChild(box);
  const sheet = new Element('section'); sheet.id = 'party-popup'; document.body.appendChild(sheet);
  const actors = [{ name: 'Hero', type: 'pc', hp: 20, mazeX: 1, mazeY: 1 },
    { name: 'Tallow', type: 'npc', hp: 0, state: 'Dying', mazeX: 2, mazeY: 2, mazeRoomKey: '1,1,0' },
    { name: 'Stable', type: 'npc', hp: 0, state: 'Unconscious', mazeX: 3, mazeY: 2, mazeRoomKey: '1,1,0' },
    { name: 'Dead', type: 'npc', hp: 0, state: 'Dead', mazeX: 4, mazeY: 2 }];
  const turn = { actionId: 'battle', turnId: 'turn-1', round: 1, combatant: 'Hero', tactical: true, targets: ['Enemy'], attackTargets: [],
    movement: { remaining: 6, total: 6, tiles: [] }, care: [{ kind: 'bandage', target: 'Tallow', label: 'Bandage Tallow' }],
    spells: ['Tallow', 'Stable'].map(target => ({ target, spellId: 'mend', itemId: 'book', itemName: 'Spellbook', name: 'Grave Mending', effect: 'heal', cost: 1, magic: 3 })) };
  const window = { innerWidth: 1200, innerHeight: 900, combatCharacters: actors, DungeonInhabitants: I,
    CombatFootprint: require(path.join(root, 'assets/combatFootprint')), renderPartyIconDock() {},
    getComputedStyle: () => ({ zoom: '1' }), isDungeonActorPresent: a => a.present !== false && I.isAlive(a) };
  const context = { window, document, getPartyInfoEntries: () => [{ label: 'Hero' }, { label: 'Tallow' }],
    fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; } };
  for (const file of ['combatCharacterUi', 'combatTurnUi', 'combatTacticalUi']) vm.runInNewContext(read('assets/' + file + '.js'), context);
  const html = read('assets/index.html');
  vm.runInNewContext(html.slice(html.indexOf('    function openPartySheet('), html.indexOf('    function openCombatCharacterSheet(')), context);
  const entries = Array.from({ length: 10 }, (_, n) => ({ kind: 'miss', actor: 'Hero ' + n, target: 'Enemy' }));
  const state = { active: { id: 'battle', kind: 'combat', turn, ledger: { initiative: [{ name: 'Hero', roll: 17 }], entries } } };
  window.actionDiceState = state; window.CombatTurnUi.receive(turn); window.CombatTacticalUi.receive(state);
  const draw = { dungeon: { geoKey: '1,1,0', cells: { '1,1': {}, '2,2': {}, '3,2': {}, '4,2': {} } }, pos: { x: 1.5, y: 1.5 }, cs: 10, centerX: 100, centerY: 100, combatAngle: 0 };
  const popup = () => document.querySelectorAll('.combat-target-actions').at(-1);
  return { window, document, context, turn, state, draw, actors, posts, popup, box };
}

test('downed living allies remain selectable by their combat tiles without movement or an attack', () => {
  const f = fixture(), before = JSON.stringify(f.actors), ui = f.window.CombatTacticalUi;
  assert.deepEqual(Array.from(ui.occupants(f.draw), a => a.name), ['Hero', 'Tallow', 'Stable']);
  assert.equal(ui.click(null, f.draw, 110, 110, 1), true);
  assert.ok(f.popup().children.some(n => n.textContent === 'Bandage Tallow (one turn)'));
  assert.ok(f.popup().children.some(n => /^Grave Mending/.test(n.textContent)));
  assert.equal(f.posts.length, 0); assert.equal(JSON.stringify(f.actors), before);
  f.window.DungeonInhabitants = null;
  assert.deepEqual(Array.from(ui.occupants(f.draw), a => a.name), ['Hero', 'Tallow', 'Stable'], 'Fallback still distinguishes dying from dead');
});

test('portrait and console clicks open the same dying-ally aid menu and only explicit aid submits', async () => {
  const f = fixture(); f.context.openPartySheet(1);
  assert.equal(f.document.getElementById('party-popup').style.display, 'none');
  assert.ok(f.popup().children.some(n => n.textContent === 'Bandage Tallow (one turn)'));
  const link = { getAttribute: key => key === 'data-npc' ? 'Tallow' : null };
  assert.equal(f.window.CombatCharacterUi.openConsoleTarget({ closest: () => link }), true);
  const popup = f.popup(); assert.equal(f.posts.length, 0);
  assert.equal(popup.children.some(n => /^Attack/.test(n.textContent)), false);
  popup.children.find(n => n.textContent === 'Bandage Tallow (one turn)').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].url, '/submit-target2');
  assert.equal(f.posts[0].body.action, 'care'); assert.equal(f.posts[0].body.kind, 'bandage');
  assert.equal(f.posts[0].body.target, 'Tallow'); assert.equal(f.posts[0].body.turnId, 'turn-1');
});

test('unconscious allies offer published healing spells, while out-of-range and stale aid cannot be fabricated', async () => {
  const f = fixture(); f.window.CombatCharacterUi.open({ name: 'Stable' });
  assert.ok(f.popup().children.some(n => /^Grave Mending/.test(n.textContent)));
  assert.equal(f.popup().children.some(n => /^Bandage/.test(n.textContent)), false);
  f.window.CombatTurnUi.receive({ ...f.turn, care: [], spells: [] });
  f.window.CombatCharacterUi.open({ name: 'Tallow' });
  assert.match(f.popup().textContent, /First aid requires an adjacent living ally/);
  f.window.CombatTurnUi.receive(f.turn); f.window.CombatCharacterUi.open({ name: 'Tallow' });
  const old = f.popup().children.find(n => /^Bandage/.test(n.textContent));
  f.window.CombatTurnUi.receive({ ...f.turn, turnId: 'turn-2' }); old.click();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.posts.length, 0);
});

test('prone sprite alpha picking reverses rotation before horizontal mirroring', () => {
  const f = fixture(), actor = f.actors[1];
  for (const flipped of [false, true]) {
    const target = { character: actor, x: 10, y: 20, size: 100, rotation: Math.PI / 2, flipped };
    const alpha = (_t, u, v) => Math.abs(u - (flipped ? .8 : .2)) < .01 && Math.abs(v - .3) < .01 ? 255 : 0;
    assert.equal(f.window.CombatCharacterUi.pick([target], 80, 40, alpha), actor);
    assert.equal(f.window.CombatCharacterUi.pick([target], 30, 50, alpha), null);
  }
  const game = read('assets/game.js');
  assert.match(game, /combatActorHitTargets\.push\(\{character,texKey,frameName,flipped,rotation:down\?Math\.PI\/2:0/);
});

test('ledger has one scrolling surface and follows chronological results until the reader scrolls back', () => {
  const f = fixture(), panel = f.document.getElementById('combat-ledger'), entries = f.document.getElementById('combat-ledger-entries');
  assert.equal(panel.scrollTop, panel.scrollHeight, 'Initial snapshot opens at the latest action');
  assert.ok(entries.textContent.indexOf('Hero 0 misses') < entries.textContent.indexOf('Hero 9 misses'));
  panel.scrollTop = panel.scrollHeight - panel.clientHeight;
  f.state.active.ledger.entries.push({ kind: 'hit', actor: 'Hero', target: 'Enemy', damage: 4, hp: 3 });
  f.window.CombatTacticalUi.receive(f.state);
  assert.equal(panel.scrollTop, panel.scrollHeight); assert.match(entries.textContent, /Enemy has 3 HP left\.$/);
  panel.scrollTop = 0;
  f.state.active.ledger.entries.push({ kind: 'miss', actor: 'Enemy', target: 'Hero' });
  f.window.CombatTacticalUi.receive(f.state); assert.equal(panel.scrollTop, 0, 'Reading older entries is respected');
  assert.match(entries.textContent, /Enemy misses Hero\.$/);
  const css = read('assets/index.html'), rule = css.match(/#combat-ledger-entries\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(rule, /overflow|min-height|flex:/);
  assert.match(css.match(/#combat-ledger\s*\{([^}]+)\}/)[1], /display: block; overflow: auto/);
});
