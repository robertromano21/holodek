'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

test('party controls retain dice arithmetic, enemy totals, clickable pending die and bounded history', () => {
  let now = 1000;
  class Clock extends Date { static now() { return now; } }
  function el(tag) {
    return { tag, children: [], style: {}, attrs: {}, textContent: '', classList: { toggle() {} },
      appendChild(child) { this.children.push(child); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} };
  }
  const slot = el('div'), dock = el('div'); dock.querySelector = () => slot;
  const window = {}, document = { createElement: el, querySelector() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/actionDiceUi'), 'utf8'), { window, document, Date: Clock, setTimeout() {}, Map, Set });
  const result = (actor, label, natural, modifier, i) => ({ actor, label, natural, modifier, total: natural + modifier, sides: 20, id: actor + i });
  window.receiveDiceState({ type: 'dice_state', revision: 1, epoch: 'e', active: { kind: 'combat' }, results: [
    result('Mortacia', 'Initiative', 15, 0, 1), result('Mortacia', 'Attack', 18, 3, 2), result('Mortacia', 'Damage', 4, -1, 3),
    ...Array.from({ length: 5 }, (_, i) => result('Dantuea', 'Attack', 11, 10, i))],
    pending: { actor: 'Mortacia', label: 'Attack', sides: 20, target: 'Dantuea', id: 'pending', difficulty: 22 } });
  now += 1100; window.renderPartyDice(dock, [{ label: 'Mortacia' }]);
  const wrap = slot.children[0], history = wrap.children[1].textContent;
  assert.equal(wrap.children[0].disabled, false); assert.equal(wrap.children[0].textContent, 'Roll\nattack');
  assert.equal(history, 'Attack: d20 18 + 3 = 21\nDamage: d20 4 - 1 = 3');
  const enemy = dock.children.find(c => c.className?.includes('party-enemy-rolls'));
  assert.equal(enemy.textContent.split('\n').length, 4);
  assert.match(enemy.textContent, /Dantuea: Attack d20 11 \+ 10 = 21/);
  assert.match(dock.children[0].textContent, /AC 22.*Click Roll/);
});

test('downed avatars show their condition instead of initiative or attack dice, retaining survival saves', () => {
  for (const condition of ['Unconscious', 'Dying', 'Dead']) {
    let now = 1000;
    const el = () => ({ children: [], style: {}, classList: { toggle() {} }, appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener() {} });
    const slot = el(), dock = el(); dock.querySelector = () => slot;
    const window = {}, document = { createElement: el };
    vm.runInNewContext(fs.readFileSync(require.resolve('../assets/actionDiceUi'), 'utf8'), { window, document, Date: { now: () => now }, setTimeout() {} });
    window.receiveDiceState({ type: 'dice_state', revision: 1, active: { kind: 'combat' }, results: [
      { id: 'initiative', actor: 'Orro', label: 'Initiative', natural: 17, modifier: 0, total: 17 },
      { id: 'survival', actor: 'Orro', label: 'Survival Save', natural: 19, modifier: 0, total: 19 } ] });
    now += 1100;
    window.renderPartyDice(dock, [{ label: 'Orro', source: { hp: 0, state: condition } }]);
    const wrap = slot.children[0];
    assert.equal(wrap.children[0].textContent, condition + '\nNo initiative or actions');
    assert.match(wrap.children[1].textContent, /Survival Save: d20 19 \+ 0 = 19/);
    assert.equal(wrap.children.some(c => c.className?.includes('party-d20')), false);
    slot.children = []; window.renderPartyDice(dock, [{ label: 'Orro', source: { hp: 1, state: 'Friendly' } }]);
    assert.ok(slot.children[0].children[0].className.includes('party-d20'), 'Normal dice return only after recovery');
  }
});

test('the current turn visibly prompts for target selection instead of claiming actions are resolving', () => {
  let highlighted = false;
  const el = () => ({ children: [], style: {}, classList: { toggle: (_k, value) => highlighted = value }, appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener() {} });
  const slot = el(), dock = el(); dock.querySelector = () => slot;
  const window = {}, document = { createElement: el };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/actionDiceUi'), 'utf8'), { window, document, setTimeout() {} });
  window.receiveDiceState({ type: 'dice_state', revision: 1, results: [], active: { kind: 'combat', turn: { combatant: 'Mortacia', turnId: 'turn', allowRetreat: true } } });
  window.renderPartyDice(dock, [{ label: 'Mortacia' }]);
  assert.equal(highlighted, true); assert.match(dock.children[0].textContent, /Mortacia: Your turn.*use Attack/);
  assert.ok(dock.children[0].className.includes('awaiting-action'));
});
