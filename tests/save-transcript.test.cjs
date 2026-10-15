'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Transcript = require('../assets/saveGameTranscript');
test('hidden log capture preserves BRs, block paragraphs, quotes and literal text without innerText', () => {
  const text = value => ({ nodeType: 3, textContent: value }), element = (name, ...children) => ({ nodeType: 1, nodeName: name, childNodes: children });
  const hidden = element('P', text('Keeper: "Welcome."'), element('BR'), element('BR'), text('Coordinates: X: 1, Y: 1, Z: 0'), element('P', text('You take the spear.')));
  assert.equal(Transcript.capture(hidden), '\nKeeper: "Welcome."\n\nCoordinates: X: 1, Y: 1, Z: 0\nYou take the spear.\n\n');
});
test('early collapsed saves recover story paragraphs and speaker quotes from full conversation rows', () => {
  const restored = Transcript.restore({ data: { gameLogText: 'allruntogether' }, conversation: { rows: [
    { prompt: '$.user `ask the keeper`', response: '$.assistant `The keeper looks up.\n\nKeeper: "Welcome."`' },
    { prompt: '$.user `[Encounter]`', response: '$.assistant `You take the spear.`' }
  ] } });
  assert.equal(restored, '> ask the keeper\n\nThe keeper looks up.\n\nKeeper: "Welcome."\n\nYou take the spear.');
  assert.doesNotMatch(restored, /\$\.assistant|\[Encounter\]/);
});
test('new snapshots keep their exact transcript, including ambient lines not stored as command turns', () => {
  const text = 'Keeper: "Stay safe."\n\nWind blows.\n\nA torch gutters.';
  assert.equal(Transcript.restore({ data: { gameLogText: text, gameLogFormat: 'text-v2' }, conversation: { rows: [] } }), text);
});
