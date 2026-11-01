'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const R = require('../assets/resourceLabelUi');
test('a station displays Tech for sheet fields and internal JSON magic keys without renaming item names', () => {
  const source = 'Magic: 4\nInventory Properties: {"name":"magic gem","magic":0,"attack":1}, {"Name":"Report","Magic":2}';
  const result = R.relabelText(source, 'Tech');
  assert.match(result, /^Tech: 4/); assert.match(result, /"Tech":0/); assert.match(result, /"Tech":2/);
  assert.match(result, /"name":"magic gem"/); assert.match(source, /"magic":0/);
  assert.equal(R.relabelText(source, 'Magic'), source);
  assert.match(R.relabelText(source, 'Luck'), /^Luck: 4/);
});
test('display relabeling restores the original fields when switching between Tech, Luck and Magic', async () => {
  const nodes = [{ nodeValue: 'Magic: 4 {"magic":2}', parentElement: { closest: () => false } }];
  let nextLabel = 'Tech';
  const document = { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [{}],
    createTreeWalker: () => { let i=0; return { nextNode: () => nodes[i++] }; } };
  const window = { document, NodeFilter: { SHOW_TEXT: 4 }, HolodekFlags: { HOMEBREW: true, RESOURCE_NAME: 'Tech' },
    fetch: async () => ({ json: async () => ({ RESOURCE_NAME: nextLabel }) }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/resourceLabelUi'), 'utf8'), { window });
  window.ResourceLabelUi.relabel({}); assert.equal(nodes[0].nodeValue, 'Tech: 4 {"Tech":2}');
  nextLabel = 'Luck'; await window.ResourceLabelUi.refresh(); assert.equal(nodes[0].nodeValue, 'Luck: 4 {"Luck":2}');
  nextLabel = 'Magic'; await window.ResourceLabelUi.refresh(); assert.equal(nodes[0].nodeValue, 'Magic: 4 {"magic":2}');
  nodes[0].nodeValue = 'Magic: 9 {"magic":5}'; nextLabel = 'Tech'; await window.ResourceLabelUi.refresh();
  assert.equal(nodes[0].nodeValue, 'Tech: 9 {"Tech":5}');
});

test('the actual console and character review are observed and relabeled at render time', () => {
  const source = fs.readFileSync('assets/resourceLabelUi.js', 'utf8');
  const targets = source.match(/const selector = '([^']+)'/)[1];
  for (const selector of ['#phaser-container', '#review-character-details', '#party-popup', '.popup-container'])
    assert.ok(targets.split(', ').includes(selector), selector);
  const game = fs.readFileSync('assets/game.js', 'utf8'), html = fs.readFileSync('assets/index.html', 'utf8');
  assert.match(game, /contentDiv.innerHTML = fullText;\s*window.ResourceLabelUi\?\.relabel\(contentDiv\)/);
  assert.match(html, /detailsEl.textContent = stats;\s*window.ResourceLabelUi\?\.relabel\(detailsEl\)/);
  const sheet = 'Pilot\nFemale\nHuman\nEngineer\nLevel: 1\nAC: 10\nXP: 0\nHP: 5\nMaxHP: 5\nEquipped: None\nAttack: 1\nDamage: 1\nArmor: 0\nMagic: 3';
  const display = R.relabelText(sheet, 'Tech');
  assert.match(display, /Tech: 3$/);
  assert.equal(require('../assets/partyRoster').parseSheets(sheet, 'pc')[0].magic, 3,
    'The canonical source is still parsed as Magic; only the presentation changes');
});
