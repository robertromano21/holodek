'use strict';
// CotG lore / Grave Master persona must reach model prompts only during actual Children of the Grave play.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const S = require('../retort/settingLayer'), A = require('../retort/adjacentRooms'), RD = require('../retort/roomDescription');
const { COTG_TERMS } = require('../retort/campaignBuilder');
const BAD = [...COTG_TERMS.filter(t => !t.startsWith('\\')), 'Grave Master'];
const bible = { kind: 'homebrew', name: 'Dust Line', gmName: 'Trail Boss Vorcal', genres: ['western'], seed: 'weird west', masterPrompt: 'You run Dust Line, a frontier of rail towns and salt flats. No other setting exists.',
  topology: { start: 'Salt Junction', goal: 'the Far Mesa', layers: ['flats'] }, factions: [], powers: [], calendar: { name: 'by rail', abbr: 'RY', now: 12 }, history: 'Rails came.', naming: 'plain', peoples: 'drovers', arc: 'Reach the mesa.' };
const leaks = txt => BAD.filter(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(txt));
const roomPrompt = () => RD.creationPrompt({ name: 'Depot', coordinates: '0,1,0', classification: {}, room: {} });
test('isCotGPlay: true with no homebrew world, false while a homebrew world is active', () => {
  S.setActive(null); S.setTestMode(false); assert.strictEqual(S.isCotGPlay(), true);
  S.setActive(bible); assert.strictEqual(S.isCotGPlay(), false); S.setActive(null);
});
test('homebrew room-gen prompt + background job body carry no CotG lore or persona', () => {
  S.setActive(bible);
  try {
    const body = A.bgBody(roomPrompt()), txt = body.messages.map(m => m.content).join('\n');
    assert.deepStrictEqual(leaks(txt), [], txt.slice(0, 400));
    assert.match(txt, /Trail Boss Vorcal|Dust Line/);
  } finally { S.setActive(null); }
});
test('CotG play keeps the Grave Master persona in background jobs', () => {
  S.setActive(null); S.setTestMode(false);
  assert.match(A.bgBody(roomPrompt()).messages[0].content, /Grave Master/);
});
test('city generation source has no CotG lore or persona strings', () => {
  const f = path.join(__dirname, '../retort/citySites.js'); if (!fs.existsSync(f)) return;
  assert.deepStrictEqual(leaks(fs.readFileSync(f, 'utf8')), []);
});
