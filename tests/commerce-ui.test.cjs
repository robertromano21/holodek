'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Rules = require('../assets/economyRules'), Inventory = require('../assets/inventoryUi');
function fixture() {
  const nodes = [], requests = [], applied = [], notices = [];
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.dataset = {}; this.children = []; this.listeners = {}; nodes.push(this); }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    after(c) { this.parent?.appendChild(c); }
    setAttribute(k, v) { this[k] = v; }
    addEventListener(k, cb) { this.listeners[k] = cb; }
    querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll()]).filter(c => c.tag === 'button'); }
    querySelector(selector) { return this.children.find(c => selector === '#equip-button' && c.id === 'equip-button') || null; }
    remove() { this.removed = true; }
    click() { return this.listeners.click?.(); }
  }
  const body = new Element('body'), input = new Element('textarea'); input.value = 'unfinished draft';
  const document = { body, createElement: tag => new Element(tag), addEventListener() {}, removeEventListener() {},
    getElementById: () => input, querySelectorAll: () => nodes.filter(n => n.className?.includes('popup-container') && !n.removed) };
  const dungeon = { geoKey: '1,0,0', sceneObjects: [] };
  const window = { dungeonRunId: 'run', currentDungeon: dungeon, EconomyRules: Rules, InventoryUi: Inventory,
    latestUpdatedData: { inventoryProperties: JSON.stringify(Rules.healingPotion(3)) },
    getDungeonLifeContext: () => ({ dungeon, player: { x: 4.5, y: 4.5 }, actors: [] }),
    prepareEconomyState: async () => {}, getPartyInfoEntries: () => [{ label: 'Benedict' }, { label: 'Ally' }],
    getEconomyResidentInfo: name => name === 'Keeper' ? { kind: 'temple' } : null,
    DungeonActionNotices: { receive: n => notices.push(n) }, applyRealtimeCombatResult: async event => applied.push(event) };
  let hook;
  const fetch = async (path, options) => {
    const request = { path, body: JSON.parse(options.body) }; requests.push(request);
    if (hook) return hook(request);
    const result = path.endsWith('view') ? { silver: 2, revision: 7, service: { name: 'Healing Shrine', kind: 'temple', stock: [
      { ...Rules.healingPotion(3), quantity: 2, price: 1 }] }, party: [{ name: 'Ally', hp: 0, maxHp: 20, resurrectPrice: 5 }], missions: [], saleItems: [] } :
      { type: 'economy_result', eventId: 'event', runId: 'run', geoKey: dungeon.geoKey, content: 'Consumed.' };
    return { ok: true, json: async () => result };
  };
  vm.runInNewContext(fs.readFileSync('assets/commerceUi.js', 'utf8'), { window, document, fetch, console });
  vm.runInNewContext(fs.readFileSync('assets/objectDiscovery.js', 'utf8'), { window, document });
  return { window, document, nodes, requests, applied, notices, input, body, hook: cb => hook = cb,
    button: label => nodes.find(n => n.tag === 'button' && n.textContent === label && !n.removed) };
}
test('Drink offers real party targets, sends no client healing amount, and preserves the command draft', async () => {
  const f = fixture(); assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), true);
  await f.button('Drink: Ally').click();
  const request = f.requests.find(r => r.path.endsWith('action')).body;
  assert.equal(request.kind, 'drink'); assert.equal(request.item, 'healing potion 3 hp'); assert.equal(request.target, 'Ally');
  assert.equal(request.revision, 7); assert.equal(request.magic, undefined); assert.equal(request.heal_hp, undefined);
  assert.equal(f.input.value, 'unfinished draft'); assert.equal(f.applied.length, 1);
});
test('inventory actions hide Equip and expose Drink only for supported healing potions', () => {
  const f = fixture(), box = new (f.body.constructor)('div'), equip = new (f.body.constructor)('button'); equip.id = 'equip-button'; box.appendChild(equip);
  assert.ok(f.window.CommerceUi.addDrinkAction(box, 'healing potion 3 hp')); assert.equal(equip.hidden, true); assert.equal(equip.disabled, true);
  assert.equal(f.window.CommerceUi.addDrinkAction(box, 'spellbook'), null);
  f.window.latestUpdatedData.inventoryProperties = JSON.stringify({ name: 'healing potion 3 hp', type: 'other', magic: 30 });
  assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), false);
});
test('temple menu uses actual stock, exact silver prices and real resurrection targets', async () => {
  const f = fixture(); assert.equal(await f.window.CommerceUi.open('Keeper'), true);
  assert.ok(f.button('Buy healing potion 3 hp (1 silver; 2 in stock)'));
  assert.ok(f.button('Resurrect Ally (5 silver; returns at 1 HP)'));
  assert.ok(f.nodes.some(n => n.textContent === 'Silver Pieces: 2'));
  assert.equal(f.window.CommerceUi.addAction(f.body, 'Ghost'), undefined); f.window.CommerceUi.addAction(f.body, 'Keeper');
  assert.ok(f.button('Temple Services'));
});

test('a divine audience shows real gifts and sends handoff choices to the custodian, while raids have no Give button', async () => {
  const f = fixture(), given = [];
  f.window.ItemGiveUi = { open: name => given.push(name) };
  f.window.getEconomyResidentInfo = () => ({ kind: 'divine' });
  f.hook(async () => ({ ok: true, json: async () => ({ silver: 0, revision: 1,
    divine: { name: 'Atinus', domain: 'Duty', interest: 'Protect the wounded', visits: 2, possessions: [{ name: 'copper tablet' }] },
    missions: [{ id: 'delivery', status: 'accepted', recipient: 'Custodian', item: 'muster record', description: 'Give the record to Custodian.' },
      { id: 'raid', type: 'raid', status: 'accepted', recipient: 'Custodian', description: 'Defeat the named temple defenders.' }] }) }));
  assert.equal(await f.window.CommerceUi.open('Atinus'), true);
  assert.ok(f.button('Receive copper tablet')); assert.ok(f.nodes.some(n => n.textContent === 'Divine Audience: Atinus'));
  assert.equal(f.nodes.filter(n => n.textContent === 'Give Requested Item to Custodian').length, 1);
  await f.button('Give Requested Item to Custodian').click(); assert.deepEqual(given, ['Custodian']);
  f.window.CommerceUi.addAction(f.body, 'Atinus'); assert.ok(f.button('Divine Audience'));
});
test('busy games cannot transact and potion equip commands do not fall through to legacy equipment code', async () => {
  const f = fixture(); assert.equal(await f.window.CommerceUi.handleCommand('equip healing potion 3 hp to Ally'), true);
  assert.equal(f.requests.length, 0); assert.match(f.notices[0].message, /cannot be equipped/);
  f.window.gamePaused = true; assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), false);
  assert.equal(await f.window.CommerceUi.open('Keeper'), false);
});

test('typed and popup-style equipment commands use verified transactions without browser-side item removal', async () => {
  for (const [command, kind, item, target] of [
    ['equip shadowbone spear', 'equip', 'shadowbone spear', undefined],
    ['equip veilbreaker aegis to Ally', 'equip', 'veilbreaker aegis', 'Ally'],
    ['unequip veilbreaker aegis from Ally', 'unequip', 'veilbreaker aegis', 'Ally']]) {
    const f = fixture(), before = JSON.stringify(f.window.latestUpdatedData);
    assert.equal(await f.window.CommerceUi.handleCommand(command), true);
    const request = f.requests.find(r => r.path === '/economy/action').body;
    assert.equal(request.kind, kind); assert.equal(request.item, item); assert.equal(request.target, target);
    assert.equal(request.revision, 7); assert.equal(request.magic, undefined);
    assert.equal(JSON.stringify(f.window.latestUpdatedData), before, 'Only the acknowledged server result changes the inventory');
    assert.equal(f.applied.length, 1);
  }
});

test('rejected equipment commands keep the visible inventory and report the server error', async () => {
  const f = fixture(), before = JSON.stringify(f.window.latestUpdatedData);
  f.hook(async request => ({ ok: request.path.endsWith('view'), json: async () => request.path.endsWith('view') ? { revision: 7 } : { error: 'Unequip the current weapon first.' } }));
  assert.equal(await f.window.CommerceUi.handleCommand('equip shadowbone spear'), true);
  assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(f.window.latestUpdatedData), before);
  assert.match(f.notices.at(-1).message, /Unequip the current weapon/);
});
test('a stale room response cannot apply a purchase to a newly entered room', async () => {
  const f = fixture(); let resolve;
  f.hook(() => new Promise(done => resolve = done));
  const result = f.window.CommerceUi.open('Keeper'); await new Promise(done => setImmediate(done));
  f.window.currentDungeon = { geoKey: '2,0,0' };
  resolve({ ok: true, json: async () => ({ service: { name: 'Old Shop' } }) });
  assert.equal(await result, false); assert.equal(f.applied.length, 0); assert.ok(!f.nodes.some(n => n.textContent === 'Old Shop'));
});
test('a menu left open from another room cannot send a transaction there', async () => {
  const f = fixture(); await f.window.CommerceUi.open('Keeper');
  f.window.currentDungeon = { geoKey: '2,0,0' };
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 0);
  assert.match(f.notices[0].message, /another room or game/);
});
test('the page loads economy modules before game and displays silver separately from item properties', () => {
  const html = fs.readFileSync('assets/index.html', 'utf8'), game = fs.readFileSync('assets/game.js', 'utf8');
  for (const name of ['economyRules', 'commerceUi']) assert.ok(html.indexOf(`/assets/${name}.js`) < html.indexOf('/assets/game.js'));
  assert.match(html, /id="inventory-silver"/); assert.match(game, /Silver Pieces: \$\{silverPieces\}/);
});

function show(f, names) {
  const { dungeon, player } = f.window.getDungeonLifeContext();
  const camera = { ...player, eyeZ: .65, dirX: 1, dirY: 0, planeScale: .577, verticalScale: 1.73, aspect: 1.8, viewShift: 0 };
  f.window.ObjectDiscovery.update(dungeon, names.map(name => ({ type: 'item', label: name })), camera);
}
test('typed hidden objects, mixed lists and missing visibility support cannot invoke any pickup', async () => {
  const f = fixture(); show(f, ['shown sword']);
  for (const command of ['take hidden key', 'take shown sword, hidden key', 'collect hidden key', 'take']) {
    assert.equal(await f.window.CommerceUi.handleCommand(command), true);
    assert.equal(f.requests.length, 0);
  }
  f.window.ObjectDiscovery = undefined;
  assert.equal(await f.window.CommerceUi.handleCommand('take shown sword'), true);
  assert.equal(f.requests.length, 0);
});
test('Take All sends only currently visible names and includes the rendered camera snapshot', async () => {
  const f = fixture(); f.window.currentDungeon.sceneObjects = [{ name: 'shown sword' }, { name: 'hidden key' }];
  show(f, ['shown sword']);
  assert.equal(await f.window.CommerceUi.handleCommand(' TAKE ALL '), true);
  const actions = f.requests.filter(r => r.path.endsWith('action'));
  assert.equal(actions.length, 1); assert.equal(actions[0].body.item, 'shown sword');
  assert.deepEqual(actions[0].body.objectView.names, ['shown sword']);
  assert.equal(actions[0].body.objectView.camera.dirX, 1);
});
test('turning away during state preparation or balance lookup preserves the original valid pickup snapshot', async () => {
  for (const stage of ['prepare', 'view']) {
    const f = fixture(); show(f, ['shown sword']);
    if (stage === 'prepare') f.window.prepareEconomyState = async () => show(f, []);
    else f.hook(async () => { show(f, []); return { ok: true, json: async () => ({ revision: 7 }) }; });
    assert.equal(await f.window.CommerceUi.handleCommand('take shown sword'), true);
    assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 1);
    assert.deepEqual(f.requests.find(r => r.path.endsWith('action')).body.objectView.names, ['shown sword']);
  }
});

test('pickup reconciles authoritative corpse loot positions before taking a fresh camera snapshot', async () => {
  for (const stillVisible of [true, false]) {
    const f = fixture(), item = { name: 'shown sword', x: 8, y: 7 };
    show(f, [item.name]); f.window.currentDungeon.sceneObjects = [{ ...item, x: 5, y: 4 }];
    let renders = 0;
    f.window.renderDungeonView = () => { renders++; assert.equal(f.window.currentDungeon.sceneObjects[0].x, 8); show(f, stillVisible ? [item.name] : []); };
    f.hook(async request => ({ ok: true, json: async () => request.path.endsWith('view') ? { revision: 7, sceneObjects: [item] } : { eventId: 'taken' } }));
    await f.window.CommerceUi.handleCommand('take shown sword'); assert.equal(renders, 1);
    assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 0);
    assert.match(f.notices.at(-1).message, /object moved/);
  }
});

test('pickup retains its browser position when the player moves during persistence',async()=>{const f=fixture(),player={x:4.5,y:4.5};show(f,['shown sword']);f.window.getDungeonLifeContext=()=>({dungeon:f.window.currentDungeon,player,actors:[]});f.window.prepareEconomyState=async()=>{player.x=5.5;show(f,[]);};await f.window.CommerceUi.handleCommand('take shown sword');const action=f.requests.find(r=>r.path.endsWith('action'));assert.equal(action.body.player.x,4.5);assert.deepEqual(action.body.objectView.names,['shown sword']);});
