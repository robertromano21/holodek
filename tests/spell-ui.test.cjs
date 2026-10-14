'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const R = require('../assets/spellRules'), Inventory = require('../assets/inventoryUi');
function fixture() {
  const nodes = [], requests = [], applied = [], notices = [], scroll = { ...R.scroll('missile', 'test'), magic: 3 };
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.dataset = {}; this.children = []; this.listeners = {}; this.isConnected = true; nodes.push(this); }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll()]).filter(c => c.tag === 'button'); }
    querySelector(selector) { return selector === '[data-scribe-action]' ? this.children.find(c => c.dataset.scribeAction) : null; }
    remove() { this.isConnected = false; }
    click() { return this.listeners.click?.(); }
  }
  const body = new Element('body'), document = { body, createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }), addEventListener() {} };
  const dungeon = { geoKey: '1,0,0' }, window = { dungeonRunId: 'run', currentDungeon: dungeon, SpellRules: R, InventoryUi: Inventory, confirm: () => true,
    latestUpdatedData: { inventoryProperties: JSON.stringify(scroll) }, getDungeonLifeContext: () => ({ dungeon, player: { x: 2.5, y: 2.5 }, actors: [] }),
    prepareEconomyState: async () => {}, GameCommandGate: { busy: () => false, end() {} },
    applyRealtimeCombatResult: async e => applied.push(e), DungeonActionNotices: { receive: n => notices.push(n) } };
  const choice = { caster: 'PC', itemId: 'book', spellId: 'missile', target: 'Enemy', name: 'Magic Missile', itemName: 'Book', effect: 'damage', revision: 4, magic: 5, cost: 3 };
  const data = { revision: 4, scrolls: [scroll], casters: [{ name: 'PC', choices: [choice], items: [{ name: 'Book', id: 'book', magic: 5, capacity: 6,
    classSource: true, className: 'Wizard', tradition: 'Wizard', castingLevel: 3, slots: 3, bookRequired: true, bookPresent: true, known: ['missile'], prepared: ['missile'], restSafe: true, scribeTurns: 3,
    rechargeEvery: 6, rechargeAmount: 1, learnable: [{ ...R.classSpell('missile', 3), cost: 3, available: true }],
    spells: [{ id: 'missile', name: 'Magic Missile', cost: 3, description: '2d4+2 damage.', range: 8 }] }] }] };
  let hook;
  const fetch = async (path, options) => {
    const request = { path, body: JSON.parse(options.body) }; requests.push(request);
    if (hook) return hook(request);
    return { ok: true, json: async () => path === '/spells/view' ? data : { type: 'spell_result', eventId: 'result' } };
  };
  vm.runInNewContext(fs.readFileSync('assets/spellUi.js', 'utf8'), { window, document, fetch, console });
  return { window, data, nodes, body, requests, applied, notices, hook: fn => hook = fn, button: label => nodes.find(n => n.tag === 'button' && n.textContent === label) };
}
test('Spells menu sends exact IDs, not client-created effects or costs, and shows level-scaled descriptions', async () => {
  const f = fixture(); assert.equal(await f.window.SpellUi.open(), true);
  assert.ok(f.nodes.some(n => /2d4\+2 damage/.test(n.textContent)));
  await f.button('Cast on Enemy').click();
  await new Promise(resolve => setImmediate(resolve));
  const cast = f.requests.find(r => r.path === '/spells/cast');
  assert.equal(cast.body.itemId, 'book'); assert.equal(cast.body.spellId, 'missile'); assert.equal(cast.body.target, 'Enemy');
  assert.equal(cast.body.cost, undefined); assert.equal(cast.body.effect, undefined); assert.equal(cast.body.magic, undefined); assert.ok(cast.body.nonce);
  assert.equal(f.applied.length, 1);
});
test('Scribe is offered only for real spell scrolls and explains the rest and exact learned cost', async () => {
  const f = fixture(); f.data.casters[0].items[0].known = []; f.data.casters[0].items[0].learnable = [];
  assert.ok(f.window.SpellUi.addItemAction(f.body, 'scroll of magic missile test')); assert.equal(f.window.SpellUi.addItemAction(f.body, 'ordinary book'), undefined);
  assert.ok(f.button('Scribe (Wizard)'));
  await f.window.SpellUi.open(null, 'scroll of magic missile test');
  const button = f.button('Scribe scroll of magic missile test for PC (3-turn rest; 3 Magic to cast)'); assert.ok(button);
  await button.click(); await new Promise(resolve => setImmediate(resolve));
  const request = f.requests.find(r => r.path === '/spells/prepare');
  assert.equal(request.body.kind, 'scribe'); assert.equal(request.body.item, 'scroll of magic missile test'); assert.equal(request.body.caster, 'PC');
  assert.equal(request.body.turns, undefined); assert.equal(request.body.magic, undefined);
});
test('paused and active combat views cannot open an out-of-turn spell menu', async () => {
  const f = fixture(); f.window.gamePaused = true; assert.equal(await f.window.SpellUi.open(), false);
  f.window.gamePaused = false; f.window.actionDiceState = { active: { kind: 'combat' } }; assert.equal(await f.window.SpellUi.open(), false); assert.equal(f.requests.length, 0);
});
test('the Spells menu distinguishes diminished Mortacia divine level from recovered casting level', async () => {
  const f = fixture(); Object.assign(f.data.casters[0].items[0], { diminished: true, divineLevel: 50, castingLevel: 1, capacity: 5, slots: 2 });
  await f.window.SpellUi.open();
  assert.ok(f.nodes.some(n => /divine level 50, recovered casting level 1/.test(n.textContent)));
  assert.ok(f.nodes.some(n => /2 prepared spell slots/.test(n.textContent)));
});
test('a stale spell menu cannot cast into a different room', async () => {
  const f = fixture(); await f.window.SpellUi.open(); f.window.currentDungeon = { geoKey: '2,0,0' };
  await f.button('Cast on Enemy').click(); assert.equal(f.requests.filter(r => r.path.endsWith('cast')).length, 0); assert.match(f.notices[0].message, /another room/);
});
test('spell modules and menu load before game; inventory and console expose the same scroll actions', () => {
  const html = fs.readFileSync('assets/index.html', 'utf8'), game = fs.readFileSync('assets/game.js', 'utf8');
  for (const name of ['spellRules', 'spellUi']) assert.ok(html.indexOf('/assets/' + name + '.js') < html.indexOf('/assets/game.js'));
  assert.match(html, /id="open-spells-button"/); assert.match(game, /SpellUi\?\.addItemAction/);
  assert.match(fs.readFileSync('assets/inventoryUi.js', 'utf8'), /SpellUi\?\.addItemAction/); assert.match(game, /acknowledgement\.spellResult/);
});

test('scroll-specific menus explain incompatible traditions instead of offering a cross-class scribe action', async () => {
  const f = fixture(), source = f.data.casters[0].items[0]; source.known = [];
  Object.assign(source, { className: 'Witch', tradition: 'Witch' });
  await f.window.SpellUi.open(null, f.data.scrolls[0].name);
  assert.equal(f.nodes.some(n => n.tag === 'button' && /^Scribe scroll/.test(n.textContent)), false);
  assert.ok(f.nodes.some(n => /Wizard formula, not Witch/.test(n.textContent)));
  assert.ok(f.nodes.some(n => /strongest lasting attack hexes/.test(n.textContent)));
});

test('weave menus expose higher-level choices but disable them and show exact unlocking levels', async () => {
  const f = fixture(), source = f.data.casters[0].items[0];
  Object.assign(source, { className: 'Warlock', tradition: 'Warlock', bookRequired: false, castingLevel: 1,
    learnable: [{ ...R.classSpell('cinder_bolt', 1), available: true }, { ...R.classSpell('ruin_brand', 1), available: false, unavailableReason: 'Requires casting level 9' }] });
  await f.window.SpellUi.open();
  assert.ok(f.nodes.find(n => n.tag === 'input' && n.value === 'ruin_brand').disabled);
  assert.ok(f.nodes.some(n => /Ruin Brand.*Requires casting level 9/.test(n.textContent)));
  assert.ok(f.nodes.some(n => /no class healing/.test(n.textContent)));
});

test('spellbook, weave and scroll choices explain actual mechanics, costs and ranges before committing', async () => {
  const f = fixture(); f.data.casters[0].items[0].known = [];
  f.window.SpellUi.addItemAction(f.body, f.data.scrolls[0].name);
  assert.ok(f.nodes.some(n => /Magic Missile at its unlock level: 3 Magic.*1d4\+1.*Range: 8 tiles/.test(n.textContent)));
  await f.window.SpellUi.open(null, f.data.scrolls[0].name);
  assert.ok(f.nodes.some(n => /3 Magic per cast.*2d4\+2.*Range: 8 tiles/.test(n.textContent)));
  assert.ok(f.nodes.some(n => /Damage: 2d4\+2.*without an attack roll/.test(n.textContent)));
  const g = fixture(); Object.assign(g.data.casters[0].items[0], { className: 'Warlock', tradition: 'Warlock', bookRequired: false,
    learnable: [{ ...R.classSpell('pact_veil', 1), available: true }] });
  await g.window.SpellUi.open();
  assert.ok(g.nodes.some(n => /Absorb 3 damage for 3 rounds.*Range: 1 tile/.test(n.textContent)));
});
