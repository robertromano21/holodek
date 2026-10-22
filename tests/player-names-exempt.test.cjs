const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../retort/settingLayer');
const B = require('../retort/campaignBuilder');

test('a player can name their character Mortacia in a homebrew world', () => {
  const b = Setting.localBible('a frontier mining town on a red moon');
  Setting.setActive(b);
  try {
    // player-provided main character text is not rejected by bible validation
    assert.doesNotThrow(() => Setting.validateBible({ ...b, mainCharacter: 'Mortacia, a wandering prospector' }));
    assert.deepEqual(B.lintGenerated({ ...b, mainCharacter: 'Mortacia', party: ['Suzerain'] }), []);
    // the typed name survives translation of model requests and does not count as a leak
    B.setPlayerText('party', ['Mortacia']);
    const body = { messages: [{ role: 'user', content: 'My character is Mortacia. We go to Tartarus.' }] };
    Setting.applyBody(body);
    assert.match(body.messages[0].content, /Mortacia/);
    assert.doesNotMatch(body.messages[0].content, /Tartarus/, 'AI/lore terms are still translated');
    assert.ok(!(Setting.leaks() || []).includes('Mortacia'));
  } finally { B.setPlayerText('party', null); Setting.setActive(null); }
});

test('the denylist still applies to AI-generated homebrew content', () => {
  const b = Setting.localBible('a frontier mining town on a red moon');
  assert.throws(() => Setting.validateBible({ ...b, history: 'Founded when Mortacia fell.' }), /leaks/);
  assert.deepEqual(B.lintGenerated({ factions: [{ name: 'The Arithus Pact' }] }), ['Arithus']);
  const body = { messages: [{ role: 'system', content: 'Mortacia watches.' }] };
  Setting.setActive(b); try { Setting.applyBody(body); } finally { Setting.setActive(null); }
  assert.doesNotMatch(body.messages[0].content, /Mortacia/, 'with no player using the name, it is renamed');
});
