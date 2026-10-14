'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const R = require('../assets/partyRoster'), Rules = require('../assets/spellRules'), I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

for (const rule of ['Fighter', 'Wizard', 'Witch', 'Sorcerer', 'Warlock', 'Necromancer', 'Cleric']) test(`visible ${rule} annotations disappear without altering mechanical class metadata`, () => {
  const title = 'Ashen Keeper [rules: ' + rule + ']';
  assert.equal(R.displaySheet(title), 'Ashen Keeper');
  assert.equal(R.displaySheet(title.replace('rules:', 'Rules:')), 'Ashen Keeper');
  assert.equal(R.displaySheet(title + '\r\nLevel: 4'), 'Ashen Keeper\r\nLevel: 4');
  assert.equal(R.displaySheet(title + '<br>Level: 4'), 'Ashen Keeper<br>Level: 4');
  assert.equal(Rules.resolveClass(title), rule);
});

test('the actual Game Console PC, companion and monster rendering hides annotations while preserving sheets', () => {
  const raw = formatStartingCharacterSheet({ Name: 'Keeper', Sex: 'Male', Race: 'Shade', Class: 'Ashen Keeper [rules: Wizard]',
    Level: 4, HP: 20, MaxHP: 20, Magic: 8, AC: 10 });
  const source = read('assets/game.js');
  const rendering = source.slice(source.indexOf('        let pcHtml = pc;'), source.indexOf('// Combine all data into a single string for display'));
  const ctx = { window: { PartyRoster: R, DungeonInhabitants: I }, pc: raw, npcs: raw, monsters: raw, monstersState: 'Neutral',
    escapedText: value => value, characterState: (a, type, fallback) => I.state({ ...a, type }, fallback) };
  const result = vm.runInNewContext(rendering + '\n({pcHtml,npcsHtml,monstersHtml})', ctx);
  for (const html of Object.values(result)) { assert.match(html, /Ashen Keeper/); assert.doesNotMatch(html, /\[rules:/i); }
  assert.equal(ctx.pc, raw); assert.equal(ctx.npcs, raw); assert.equal(ctx.monsters, raw);
  assert.equal(R.parseSheets(raw, 'npc')[0].Class, 'Ashen Keeper [rules: Wizard]');
});

test('the actual character-sheet formatter hides annotations without changing the source entry', () => {
  const source = read('assets/index.html');
  const formatter = source.slice(source.indexOf('    function formatPartySheetHtml('), source.indexOf('    function setPartyPanelIndex('));
  const ctx = { window: { PartyRoster: R } };
  vm.runInNewContext(formatter, ctx);
  const entry = { html: 'Keeper<br>Ashen Keeper [Rules: Wizard]<br>Magic: 8' };
  assert.equal(ctx.formatPartySheetHtml(entry), 'Keeper<br>Ashen Keeper<br>Magic: 8');
  assert.match(entry.html, /\[Rules: Wizard\]/);
  assert.equal(R.displaySheet('A plaque [rules: keep the peace]'), 'A plaque [rules: keep the peace]');
});
