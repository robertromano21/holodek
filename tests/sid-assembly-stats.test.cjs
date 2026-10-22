'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { assemblyStats } = require('../tools/analyze-room-music.cjs');
function fixture(chunked) {
  const lines = [], bytes = (label, values) => {
    if (!chunked) return lines.push(label + ': .byte ' + values.join(','));
    for (let i = 0; i < values.length; i += 16) {
      lines.push((i ? '  .byte ' : label + ': .byte ') + values.slice(i, i + 16).join(',') + ' ; chunk');
      if (i) lines.push('', '; comments do not terminate a table');
    }
  };
  for (const voice of [0, 1, 2]) {
    bytes(`v${voice}_order`, [...Array.from({ length: 67 }, (_, index) => '$' + (index % 17).toString(16).padStart(2, '0')), '$ff']);
    bytes(`v${voice}_pat_lo`, Array.from({ length: 17 }, (_, index) => '<pat' + index));
  }
  for (let pattern = 0; pattern < 17; pattern++) {
    const data = [0xfd, 1, 2, 0x10, 0xfc, 4, 5, 6];
    for (let event = 0; event < 8; event++) data.push(event % 3 ? pattern : 255, 7, event % 2 ? 3 : 0, event % 2 ? 128 : 0);
    bytes('pat' + pattern, [...data, 0xfe].map(value => '$' + value.toString(16).padStart(2, '0')));
  }
  return lines.join(chunked ? '\r\n' : '\n');
}
test('assemblyStats includes continuation lines for long orders, pointer tables and complete tracker patterns', () => {
  const actual = assemblyStats(fixture(true));
  assert.deepEqual(actual, assemblyStats(fixture(false))); assert.equal(actual.patterns, 17); assert.equal(actual.synchronized, true);
  for (const voice of actual.voices) {
    assert.equal(voice.orderEntries, 67); assert.equal(voice.uniquePatterns, 17); assert.equal(voice.totalTicks, 67 * 8 * 7);
    assert.equal(voice.instrumentCommands, 67); assert.equal(voice.notes, 67 * 5); assert.equal(voice.rests, 67 * 3);
    assert.equal(voice.chordEvents, 67 * 4); assert.equal(voice.noiseEvents, 67 * 4);
  }
});
