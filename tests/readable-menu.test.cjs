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
