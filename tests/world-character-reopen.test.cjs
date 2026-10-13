'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync('assets/index.html', 'utf8');
const toggle = html.slice(html.indexOf('    function togglePartyPopup()'), html.indexOf('    function centerPartySheet()'));

function fixture(type = 'monster') {
  const nodes = [], commands = [];
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.style = {}; this.children = []; this.className = ''; this.listeners = {}; this.connected = true; nodes.push(this); }
    appendChild(node) { node.parent = this; this.children.push(node); return node; }
    remove() { this.connected = false; if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { this.listeners.click?.(); }
    getClientRects() {
      for (let n = this; n; n = n.parent) if (!n.connected || n.hidden || n.style.display === 'none') return [];
      return [{ width: 100, height: 50 }];
    }
  }
  const modal = new Element(); modal.id = 'party-popup'; modal.style.display = 'none';
  const input = new Element('input'); input.id = 'chatuserinput'; input.value = '';
  const selectors = selector => nodes.filter(n => n.connected && n.className.split(' ').includes(selector.slice(1)));
  const document = { readyState: 'loading', hidden: false, addEventListener() {}, createElement: tag => new Element(tag),
    querySelectorAll: selectors, querySelector: selector => selectors(selector)[0] || null,
    getElementById: id => nodes.find(n => n.connected && n.id === id) || null };
  const actor = { name: type === 'pc' ? 'Mortacia' : type === 'npc' ? 'Companion' : 'Visible Elf', type, hp: 20 };
  const window = { combatCharacters: [actor], addEventListener() {},
    getComputedStyle: n => ({ display: n.style.display || 'block', visibility: n.style.visibility || 'visible' }),
    openCombatCharacterSheet: a => { modal.selected = a.name; modal.style.display = 'block'; },
    centerPartySheet() {}, chatbotprocessinput: () => commands.push(input.value) };
  const context = { window, document, getComputedStyle: window.getComputedStyle,
    renderPartyInfoPopup() {}, centerPartySheet: window.centerPartySheet, console };
  vm.runInNewContext(fs.readFileSync('assets/worldInteractionUi.js', 'utf8') +
    fs.readFileSync('assets/combatCharacterUi.js', 'utf8') + toggle, context);
  const target = { type: 'character', character: actor, label: actor.name, enabled: true };
  return { window, document, context, actor, target, modal, input, commands, Element,
    open: () => window.WorldInteractionUi.activate(target), close: () => context.togglePartyPopup() };
}

for (const type of ['monster', 'npc', 'pc']) test(`3D ${type} sheets reopen repeatedly after X without requiring Cancel first`, async () => {
  const f = fixture(type);
  for (let i = 0; i < 4; i++) {
    await f.open();
    assert.equal(f.modal.style.display, 'block', `Click ${i + 1} opens the sheet`);
    assert.equal(f.modal.selected, f.actor.name);
    const actions = f.document.querySelectorAll('.combat-character-actions');
    assert.equal(actions.length, type === 'pc' ? 0 : 1);
    if (actions[0]) assert.ok(actions[0].children.some(n => n.textContent === (type === 'npc' ? 'Remove' : 'Attack')));
    f.close();
    assert.equal(f.modal.style.display, 'none');
    assert.equal(f.document.querySelectorAll('.combat-character-actions').length, 0, 'Closing the sheet clears its transient action popup');
  }
  assert.deepEqual(f.commands, [], 'Inspecting characters never sends a game command');
});

test('hidden stale action popups cannot lock the 3D view while visible action popups still block clicks', async () => {
  const f = fixture(), stale = new f.Element();
  stale.className = 'popup-container combat-character-actions'; f.modal.appendChild(stale);
  await f.open();
  assert.equal(f.modal.style.display, 'block');
  f.close();
  const hidden = new f.Element(); hidden.className = 'popup-container'; hidden.hidden = true;
  await f.open(); assert.equal(f.modal.style.display, 'block'); f.close();
  const visible = new f.Element(); visible.className = 'popup-container';
  await f.open(); assert.equal(f.modal.style.display, 'none');
  visible.remove(); await f.open(); assert.equal(f.modal.style.display, 'block');
});

test('Cancel, pause, command locks and inventory keep their existing interaction rules', async () => {
  const f = fixture(); await f.open();
  f.document.querySelector('.combat-character-actions').children.find(n => n.textContent === 'Cancel').click();
  assert.equal(f.document.querySelector('.combat-character-actions'), null);
  f.close();
  for (const lock of ['pause', 'command', 'combat', 'inventory']) {
    f.window.gamePaused = lock === 'pause';
    f.window.GameCommandGate = { busy: () => lock === 'command' };
    f.window.actionDiceState = { active: lock === 'combat' ? {} : null };
    f.window.InventoryUi = { isOpen: () => lock === 'inventory' };
    await f.open(); assert.equal(f.modal.style.display, 'none', lock);
  }
  f.window.InventoryUi = { isOpen: () => false };
  await f.open(); assert.equal(f.modal.style.display, 'block');
});
