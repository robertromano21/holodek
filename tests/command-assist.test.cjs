'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const Assist = require('../assets/commandAssist');
const ServerAssist = require('../retort/commandAssist');

test('uiAssistHint gates like invitationHint: positive UI cues only, never decides intent', () => {
  assert.equal(Assist.uiAssistHint('put on armor'), true);
  assert.equal(Assist.uiAssistHint('cast a spell'), true);
  assert.equal(Assist.uiAssistHint('read book'), true);
  assert.equal(Assist.uiAssistHint('wear something warmer'), true);
  assert.equal(Assist.uiAssistHint('search the room'), false);
  assert.equal(Assist.uiAssistHint('attack goblin'), false);
  assert.equal(Assist.uiAssistHint('say hello'), false);
  assert.equal(Assist.uiAssistHint('north'), false);
  assert.equal(Assist.uiAssistHint('go west'), false);
  assert.equal(Assist.uiAssistHint('equip iron sword to Mortacia'), false, 'complete legacy forms skip the assist LLM');
  assert.equal(Assist.uiAssistHint("don't equip anything"), false);
});

test('legacy complete forms are marked complete for pass-through without LLM', () => {
  assert.equal(Assist.legacyComplete('equip iron sword to Mortacia'), 'equip');
  assert.equal(Assist.legacyComplete('read chronicle of ashes'), 'read');
  assert.equal(Assist.legacyComplete('put on armor'), null);
  assert.equal(Assist.legacyComplete('cast spell'), null);
});

test('classify skips the model when the hint gate is closed, and defaults to none on LLM failure', async () => {
  const calls = [];
  const previous = global.fetch;
  global.fetch = async (...args) => { calls.push(args); throw new Error('network down'); };
  try {
    const skipped = await Assist.classify('search the room');
    assert.equal(skipped.intent, 'none');
    assert.equal(skipped.source, 'gate');
    assert.equal(calls.length, 0);

    const failed = await Assist.classify('put on armor');
    assert.equal(failed.intent, 'none');
    assert.equal(failed.source, 'llm-fallback');
    assert.equal(calls.length, 1, 'hinted UI lines call the model; failure does not synonym-parse');
  } finally {
    global.fetch = previous;
  }
});

test('popup options still come only from real inventory state after an LLM classification', () => {
  const root = globalThis;
  const previous = {
    latestUpdatedData: root.latestUpdatedData,
    InventoryUi: root.InventoryUi,
    WorldInteractionUi: root.WorldInteractionUi,
    getPartyInfoEntries: root.getPartyInfoEntries,
    getInventoryGiveItems: root.getInventoryGiveItems
  };
  try {
    root.latestUpdatedData = {
      inventory: 'leather armor, iron sword, pale chronicle, ash ledger, healing potion 5 hp',
      inventoryProperties: [
        { name: 'leather armor', type: 'armor' },
        { name: 'iron sword', type: 'weapon' },
        { name: 'pale chronicle', type: 'other' },
        { name: 'ash ledger', type: 'other' },
        { name: 'healing potion 5 hp', type: 'other', consumable_kind: 'healing', magic: 5 }
      ]
    };
    root.InventoryUi = { inventoryItems: require('../assets/inventoryUi').inventoryItems };
    root.WorldInteractionUi = { hasReadableContent: name => /chronicle|ledger/i.test(name) };
    root.getPartyInfoEntries = () => [{ label: 'Mortacia' }, { label: 'Suzerain' }];
    root.getInventoryGiveItems = () => root.InventoryUi.inventoryItems(root.latestUpdatedData.inventory, root.latestUpdatedData.inventoryProperties);

    const equip = Assist.optionsFor({ intent: 'equip', slotHint: 'armor', itemHint: null, targetHint: null });
    assert.equal(equip.mode, 'equip-item');
    assert.deepEqual(equip.options.map(o => o.value), ['leather armor']);

    const read = Assist.optionsFor({ intent: 'read', slotHint: 'book', itemHint: null, targetHint: null });
    assert.equal(read.mode, 'read-item');
    assert.deepEqual(read.options.map(o => o.value).sort(), ['ash ledger', 'pale chronicle']);

    const cast = Assist.optionsFor({ intent: 'cast', slotHint: 'any', itemHint: null, targetHint: null });
    assert.equal(cast.mode, 'spells');

    const none = Assist.optionsFor({ intent: 'none' });
    assert.equal(none.mode, 'passthrough');
  } finally {
    Object.assign(root, previous);
  }
});

test('server sanitize never invents intents outside the fixed enum (gate-style safe default)', () => {
  assert.deepEqual(ServerAssist.sanitize({ intent: 'explode', itemHint: 'bomb', targetHint: 'town', slotHint: 'nuke' }),
    { intent: 'none', itemHint: '', targetHint: '', slotHint: 'any' });
  assert.deepEqual(ServerAssist.sanitize({ intent: 'equip', itemHint: 'leather armor', targetHint: 'Mortacia', slotHint: 'armor' }),
    { intent: 'equip', itemHint: 'leather armor', targetHint: 'Mortacia', slotHint: 'armor' });
});

test('production client loads commandAssist before game.js and intercepts after commerce/spell handlers', () => {
  const index = fs.readFileSync('assets/index.html', 'utf8');
  assert.ok(index.indexOf('/assets/commandAssist.js') > index.indexOf('/assets/commandIntent.js'));
  assert.ok(index.indexOf('/assets/commandAssist.js') < index.indexOf('/assets/game.js'));
  const game = fs.readFileSync('assets/game.js', 'utf8');
  const commerce = game.indexOf('window.CommerceUi?.handleCommand(userInput)');
  const spell = game.indexOf('window.SpellUi?.handleCommand(userInput)');
  const assist = game.indexOf('window.CommandAssist?.intercept(userInput)');
  assert.ok(commerce > 0 && spell > commerce && assist > spell);
  assert.match(fs.readFileSync('server.js', 'utf8'), /require\('\.\/retort\/commandAssist'\)\.install\(app\)/);
  assert.match(fs.readFileSync('assets/commandAssist.js', 'utf8'), /uiAssistHint/);
  assert.match(fs.readFileSync('assets/commandAssist.js', 'utf8'), /llm-fallback/);
  assert.doesNotMatch(fs.readFileSync('assets/commandAssist.js', 'utf8'), /classifyDeterministic/);
});
