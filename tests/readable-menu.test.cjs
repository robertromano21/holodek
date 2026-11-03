'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const ReadableItems = require('../assets/readableItems');
function fixture() {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const lookup = source.slice(source.indexOf('window.getReadableItemMetadata ='), source.indexOf('window.getInventoryGiveItems ='));
  const database = new Map([['0,0,0', { readables: [
    { name: 'chronicle of the pale court', kind: 'book', chapters: [{ text: 'The old court preserved its history.' }] },
    { name: 'keeper scroll', kind: 'scroll', chapters: [{ text: 'A keeper recorded the route.' }] },
    { name: 'blank scroll', kind: 'scroll', backstory: 'An old scroll.', chapters: [{ text: ' \n ' }] }
  ] }]]);
  const context = { window: { ReadableItems, currentDungeon: { geoKey: '1,0,0', readables: [] } },
    roomNameDatabase: database, document: { readyState: 'loading', addEventListener() {} } };
  vm.runInNewContext(lookup + fs.readFileSync(require.resolve('../assets/worldInteractionUi'), 'utf8'), context);
  return context;
}
test('readable menus find actual stored chapters after pickup and travel, independent of item type or cover words', () => {
  const { window } = fixture(), ui = window.WorldInteractionUi;
  assert.equal(ui.hasReadableContent('CHRONICLE OF THE PALE COURT'), true);
  assert.equal(ui.hasReadableContent('keeper scroll'), true);
  for (const name of ['blank scroll', 'ancient book', 'scroll of invented spells', 'iron sword']) assert.equal(ui.hasReadableContent(name), false);
  window.currentDungeon.readables.push({ name: 'field notes', chapters: [{ text: 'These notes have content despite the unusual name.' }] });
  assert.equal(ui.hasReadableContent('field notes'), true);
});

test('library flags, book-like names, covers and unwritten chapter plans never qualify as readable contents', async () => {
  const context = fixture(), { window } = context, ui = window.WorldInteractionUi;
  window.HolodekFlags = { LIBRARY_BOOKS: true };
  window.LibraryBooks = { isBookName: () => true };
  window.currentDungeon.readables.push({ name: 'pending ledger', kind: 'book', backstory: 'A cover description.',
    bookLore: { pending: true }, chapters: [{ title: 'First Chapter', text: ' \n ' }] });
  const input = { value: '' }; let calls = 0;
  context.document.getElementById = () => input;
  window.chatbotprocessinput = async () => { calls++; };
  for (const name of ['rain ledger key', 'ancient book', 'blank scroll', 'pending ledger']) {
    assert.equal(ui.hasReadableContent(name), false, name);
    assert.equal(ui.addReadAction({}, name), null, name);
    assert.equal(await ui.requestRead(name), false, name);
  }
  assert.equal(input.value, ''); assert.equal(calls, 0);
  assert.equal(ui.hasReadableContent('keeper scroll'), true);
});

function popupFixture() {
  const context = fixture(), { window, document } = context, popups = [], commands = [];
  const input = { value: '' };
  Object.assign(document, { hidden: false, activeElement: { tagName: 'BUTTON' }, querySelectorAll: () => popups,
    getElementById: id => id === 'chatuserinput' ? input : null,
    createElement: () => ({ addEventListener(type, handler) { this[type] = handler; } }) });
  window.document = document;
  window.chatbotprocessinput = async () => { commands.push(input.value); input.value = ''; };
  const popup = { querySelector: () => null, getClientRects: () => [{}], insertBefore(button) { this.button = button; },
    remove() { this.removed = true; popups.splice(popups.indexOf(this), 1); } };
  popups.push(popup);
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/playerControls'), 'utf8'), context);
  const read = window.WorldInteractionUi.addReadAction(popup, 'keeper scroll');
  const click = () => read.click({ preventDefault() {}, stopPropagation() {} });
  return { window, document, input, popup, popups, commands, click };
}

test('a real Read button ignores only its own modal and submits one reading action', async () => {
  const f = popupFixture();
  assert.equal(f.window.PlayerControls.blocked(), true, 'The popup must still block movement and unrelated actions.');
  f.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.popup.removed, true);
  assert.deepEqual(f.commands, ['read keeper scroll']);
});

test('reading from a popup still respects other modals, pause, combat, loading, hidden pages and unsent drafts', async () => {
  const blockers = [f => f.popups.push({ getClientRects: () => [{}] }), f => { f.window.gamePaused = true; },
    f => { f.window.actionDiceState = { active: { kind: 'combat' } }; }, f => { f.window.GameCommandGate = { busy: () => true }; },
    f => { f.document.hidden = true; }, f => { f.input.value = 'my unfinished reply'; }];
  for (const block of blockers) {
    const f = popupFixture(); block(f); const before = f.input.value;
    f.click(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.commands, []); assert.equal(f.popup.removed, undefined); assert.equal(f.input.value, before);
  }
});

test('stored quest notices and inscriptions remain readable without a portable book record', () => {
  const { window } = fixture();
  window.currentDungeon.inscriptions = [{ name: 'civic notice', chapters: [{ text: 'An existing public notice.' }] }];
  window.currentDungeon.questWritings = [{ inscription: { name: 'route message', chapters: [{ text: 'An existing quest message.' }] } }];
  assert.equal(window.WorldInteractionUi.hasReadableContent('civic notice'), true);
  assert.equal(window.WorldInteractionUi.hasReadableContent('route message'), true);
});

test('an uncatalogued shelf volume offers inspection, not reading nonexistent contents', () => {
  const { window, roomNameDatabase } = fixture();
  window.HolodekFlags = { LIBRARY_BOOKS: true };
  const book = { id: 'shelf1_book1', name: 'tome 1 of shelf 1', position: { x: 1.5, y: .45, z: 0 }, size: { x: .1, y: .1, z: 1 } };
  window.LibraryBooks = { books: () => [book] };
  const dungeon = { cells: {} }; for (let x = 0; x < 4; x++) dungeon.cells[`${x},0`] = { tile: 'floor' };
  const camera = { x: .5, y: .5, eyeZ: .5, dirX: 1, dirY: 0, planeScale: 1, verticalScale: 1 };
  const pick = () => window.WorldInteractionUi.pick(dungeon, camera, camera, .5, .5);
  assert.equal(pick().command, 'inspect volume');
  roomNameDatabase.get('0,0,0').readables.push({ name: book.name, chapters: [{ text: 'An existing chapter.' }] });
  assert.equal(pick().command, 'read ' + book.name);
});
