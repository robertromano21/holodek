const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function fixture() {
  const nodes = new Map(), posts = [];
  function el(tag) {
    return { tag, style: {}, children: [], attrs: {}, listeners: {}, hidden: false, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.listeners[k] = fn; },
      appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); }, replaceChildren() { this.children = []; },
      remove() {}, click() { if (!this.disabled) this.listeners.click?.(); } };
  }
  const body = el('body'), ledger = el('aside'), dock = el('div'); nodes.set('combat-ledger', ledger);
  const window = { actionDiceState: { active: { kind: 'combat' } }, renderPartyIconDock() {} };
  const document = { body, getElementById: id => nodes.get(id), createElement: el, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/combatTurnUi'), 'utf8'), { window, document,
    fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; } });
  const turn = { turnId: 'turn-1', actionId: 'combat-1', combatant: 'Hero', round: 1, targets: ['Dragon'], attackTargets: ['Dragon'],
    tactical: true, allowRetreat: true, initiative: [], movement: { remaining: 6, total: 6 },
    care: [{ label: 'Heal Hero', target: 'Hero' }], spells: [{ name: 'Bolt', target: 'Dragon', itemName: 'Wand', cost: 1, magic: 3 }] };
  const ui = window.CombatTurnUi; ui.receive(turn);
  return { ui, turn, nodes, ledger, dock, el, posts, window };
}

test('ledger contains no action buttons and Hold Position is rendered at the party dock', async () => {
  const f = fixture(), panel = f.nodes.get('combat-turn-popup');
  assert.equal(panel.children.some(c => c.tag === 'button'), false);
  assert.equal(panel.hidden, true); assert.equal(panel.children.length, 0, 'No repeated round heading or movement instructions');
  f.ui.renderDockControls(f.dock);
  assert.equal(f.nodes.get('combat-hold-position').textContent, 'Hold Position');
  assert.equal(f.nodes.get('combat-retreat-button').textContent, 'Retreat Party');
  f.nodes.get('combat-hold-position').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.posts[0].body.action, 'hold'); assert.equal(f.posts[0].body.cancelled, true);
});

test('removing the ledger footer does not suppress unavailable-square errors', () => {
  const f = fixture(); f.ui.notice('That square is not available.');
  const panel = f.nodes.get('combat-turn-popup');
  assert.equal(panel.hidden, false); assert.equal(panel.children.length, 1);
  assert.equal(panel.children[0].textContent, 'That square is not available.');
});

test('selecting an obscured ally exposes only their published bandaging choice, never an attack', async () => {
  const f = fixture(); f.ui.receive({ ...f.turn, care: [{ kind: 'bandage', target: 'Iven', label: 'Bandage Iven' }] });
  const popup = f.el('div'); f.ui.addCharacterActions(popup, { name: 'Iven', type: 'npc', hp: 0, state: 'Dying' });
  assert.equal(popup.children.length, 1); assert.equal(popup.children[0].textContent, 'Bandage Iven (one turn)');
  assert.equal(f.posts.length, 0); popup.children[0].click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.posts[0].body, { combatant: 'Hero', actionId: 'combat-1', turnId: 'turn-1', action: 'care', target: 'Iven', cancelled: false, kind: 'bandage' });
});

test('lower-left Retreat Party submits the same turn-scoped retreat action', async () => {
  const f = fixture(); f.ui.renderDockControls(f.dock); f.nodes.get('combat-retreat-button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.posts[0].body.action, 'retreat'); assert.equal(f.posts[0].body.turnId, 'turn-1');
});

test('character popup has turn-scoped attacks and spells, without submitting on open, and rejects stale actions', async () => {
  const f = fixture(), popup = f.el('div');
  assert.equal(f.ui.addCharacterActions(popup, { name: 'Dragon', type: 'monster' }), true);
  assert.equal(f.posts.length, 0); assert.equal(popup.children.length, 2);
  f.ui.receive({ ...f.turn, turnId: 'turn-2' }); popup.children[0].click();
  assert.equal(f.posts.length, 0);
  const fresh = f.el('div'); f.ui.addCharacterActions(fresh, { name: 'Dragon', type: 'monster' }); fresh.children[0].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.posts[0].body.action, 'attack'); assert.equal(f.posts[0].body.target, 'Dragon'); assert.equal(f.posts[0].body.turnId, 'turn-2');
});

test('paused and out-of-range character actions cannot submit', () => {
  const f = fixture(); f.window.gamePaused = true;
  const popup = f.el('div'); f.ui.addCharacterActions(popup, { name: 'Dragon', type: 'monster' }); popup.children[0].click();
  assert.equal(f.posts.length, 0);
  f.window.gamePaused = false; f.ui.receive({ ...f.turn, attackTargets: [] });
  const far = f.el('div'); f.ui.addCharacterActions(far, { name: 'Dragon', type: 'monster' });
  assert.equal(far.children[0].disabled, true); far.children[0].click(); assert.equal(f.posts.length, 0);
});

test('lower-left Attack chooses a target then offers valid ranged spells when the weapon cannot reach', async () => {
  const f = fixture(), opened = [];
  f.window.CombatCharacterUi = { open: a => opened.push(a.name) };
  f.ui.receive({ ...f.turn, attackTargets: [], spells: [{ name: 'Bolt', target: 'Dragon', itemId: 'wand-1', spellId: 'bolt', itemName: 'Wand', cost: 1, magic: 3 }] });
  f.ui.renderDockControls(f.dock); f.nodes.get('combat-attack-button').click(); f.ui.renderDockControls(f.el('div'));
  const select = f.nodes.get('combat-attack-select'); select.value = 'Dragon'; select.listeners.change();
  assert.equal(select.children[0].disabled, false); assert.match(select.children[0].textContent, /spell available/);
  f.nodes.get('combat-attack-confirm').click(); assert.deepEqual(opened, ['Dragon']); assert.equal(f.posts.length, 0);
  const popup = f.el('div'); f.ui.addCharacterActions(popup, { name: 'Dragon', type: 'monster' });
  assert.equal(popup.children[0].disabled, true, 'Weapon attack remains out of range');
  assert.equal(popup.children[1].disabled, false); popup.children[1].click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.posts[0].body.action, 'cast'); assert.equal(f.posts[0].body.target, 'Dragon');
  assert.equal(f.posts[0].body.itemId, 'wand-1'); assert.equal(f.posts[0].body.spellId, 'bolt');
});

test('Attack selector rejects stale turns and cannot open while paused', () => {
  const f = fixture(), opened = []; f.window.CombatCharacterUi = { open: a => opened.push(a.name) };
  f.ui.renderDockControls(f.dock); f.nodes.get('combat-attack-button').click(); f.ui.renderDockControls(f.el('div'));
  const select = f.nodes.get('combat-attack-select'); select.value = 'Dragon'; select.listeners.change();
  const old = f.nodes.get('combat-attack-confirm'); f.ui.receive({ ...f.turn, turnId: 'next-turn' }); old.click();
  assert.deepEqual(opened, []); assert.equal(f.posts.length, 0);
  f.window.gamePaused = true; f.ui.renderDockControls(f.el('div'));
  assert.equal(f.nodes.get('combat-attack-button').disabled, true);
});
