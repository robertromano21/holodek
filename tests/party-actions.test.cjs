'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const path = require('node:path'), source = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('a failed render cannot strand the movement RAF in its active state', () => {
  const game = source('assets/game.js'), errors = [], callbacks = [];
  let fail = true;
  const move = { active: false, velX: 2, velY: 3 }, window = {};
  const context = { DUNGEON_MOVE: move, window, performance: { now: () => 1 }, console: { error: (...args) => errors.push(args) },
    requestAnimationFrame: cb => { callbacks.push(cb); return callbacks.length; }, updateDungeonMovement: () => { if (fail) throw Error('interaction scan'); return false; } };
  vm.runInNewContext(game.slice(game.indexOf('function startDungeonMovementLoop()'), game.indexOf('let dungeonExitPromptKey')), context);
  context.startDungeonMovementLoop(); assert.equal(move.active, true);
  callbacks[0](10); assert.equal(move.active, false); assert.equal(move.raf, 0); assert.equal(move.velX, 0); assert.equal(move.velY, 0);
  assert.equal(errors.length, 1);
  fail = false; context.startDungeonMovementLoop(); assert.equal(callbacks.length, 2); callbacks[1](20);
  assert.equal(move.active, false);
});

test('portrait sheet renders healing controls before dense stats and follows the selected party member', () => {
  const html = source('assets/index.html'), nodes = new Map(), actions = [];
  const sheet = { innerHTML: '', firstChild: { kind: 'stats' }, insertBefore(node, before) { assert.equal(before, this.firstChild); this.firstChild = node; } };
  for (const id of ['party-popup-name', 'party-popup-preview-canvas']) nodes.set(id, {});
  nodes.set('party-popup-sheet', sheet);
  const entries = [{ label: 'Mortacia' }, { label: 'Sella' }];
  const window = { _partyPanelIndex: 1, SpellUi: { addTargetAction: (box, name) => actions.push(['magic', name]) },
    CombatLifeUi: { addAction: (box, name) => actions.push(['aid', name]) } };
  const document = { getElementById: id => nodes.get(id), createElement: () => ({}) };
  const context = { window, document, getPartyInfoEntries: () => entries, renderPartyIconDock() {}, formatPartySheetHtml: () => 'stats', drawPartySpriteCanvas() {} };
  vm.runInNewContext(html.slice(html.indexOf('    function renderPartyInfoPopup()'), html.indexOf('    function updateDungeonTestingButton(')), context);
  context.renderPartyInfoPopup(); assert.deepEqual(actions, [['magic', 'Sella'], ['aid', 'Sella']]);
  assert.equal(sheet.firstChild.className, 'party-sheet-actions');
  window._partyPanelIndex = 0; context.renderPartyInfoPopup(); assert.deepEqual(actions.at(-2), ['magic', 'Mortacia']);
  window.actionDiceState = { active: { kind: 'combat' } }; actions.length = 0;
  context.renderPartyInfoPopup(); assert.equal(actions.length, 0, 'Combat uses the initiative prompt, never exploration endpoints');
});

test('spellbook offers a separate Cast button without changing preparation on click', () => {
  const nodes = [], calls = [];
  const el = tag => {
    const node = { tag, style: {}, children: [], listeners: {}, setAttribute() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, addEventListener(name, fn) { this.listeners[name] = fn; } };
    nodes.push(node); return node;
  };
  const document = { createElement: el, getElementById() {}, addEventListener() {} };
  const window = { SpellUi: { openSpell: (...args) => calls.push(args) }, PartyRoster: { displaySheet: s => s }, getPartyInfoEntries: () => [] };
  const ui = source('assets/partySpellbookUi.js');
  vm.runInNewContext(ui.replace('root.PartySpellbookUi =', 'root.__render = render; root.PartySpellbookUi ='), { window, document });
  assert.equal(typeof window.__render, 'function');
  window.__render({ casters: [{ name: 'Mortacia', className: 'Necromancer', hp: 50, level: 1, castingLevel: 1,
    prepared: ['mend'], groups: [{ level: 1, spells: [{ id: 'mend', name: 'Grave Mending', casts: 7, status: 'Prepared', classSource: true, cost: 1, description: 'Heal.', range: 3 }] }] }] }, el('main'));
  const cast = nodes.find(n => n.textContent === 'Cast Grave Mending'); assert.ok(cast);
  const prepare = nodes.find(n => n.className === 'spellbook-prepare');
  assert.ok(prepare); assert.notEqual(prepare, cast);
  cast.listeners.click();
  assert.deepEqual(calls, [['Mortacia', 'mend']]);
});
