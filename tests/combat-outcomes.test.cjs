'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ActionDice } = require('../retort/actionDice');

test('combat outcomes survive reconnect snapshots without exposing mutable ledger entries', () => {
  const dice = new ActionDice(), events = [];
  dice.begin('combat', '1,1,0', e => events.push(e)); dice.active.round = 2;
  dice.recordCombat({ kind: 'initiative', order: [{ name: 'Mortacia', roll: 15 }, { name: 'Dantuea', roll: 19 }] });
  dice.recordCombat({ kind: 'hit', actor: 'Dantuea', target: 'Mortacia', damage: 15, hp: 108 });
  dice.recordCombat({ kind: 'miss', actor: 'Mortacia', target: 'Dantuea' });
  const saved = dice.snapshot().active.ledger;
  assert.equal(saved.round, 2); assert.equal(saved.initiative[0].name, 'Dantuea');
  assert.equal(saved.entries[0].hp, 108); assert.equal(saved.entries[0].round, 2);
  saved.initiative[0].roll = 0; saved.entries[0].hp = 0;
  assert.equal(dice.snapshot().active.ledger.initiative[0].roll, 19);
  assert.equal(events.at(-1).active.ledger.entries[0].hp, 108);
  dice.end(); dice.begin('combat', '1,1,0');
  assert.deepEqual(dice.snapshot().active.ledger.entries, []); dice.end();
});

test('outcome feed is bounded and rejects invalid records without publishing', () => {
  const dice = new ActionDice();
  assert.equal(dice.recordCombat({ kind: 'miss', actor: 'A', target: 'B' }), false);
  dice.begin('combat', '1,1,0'); const revision = dice.revision;
  for (const entry of [null, {}, { kind: 'initiative', order: [null] }, { kind: 'hit', actor: 'A', target: 'B', damage: -1, hp: 0 },
    { kind: 'hit', actor: 'A', target: 'B', damage: 3, hp: NaN }, { kind: 'miss' }, { kind: 'notice', text: '' }])
    assert.equal(dice.recordCombat(entry), false);
  assert.equal(dice.revision, revision);
  for (let i = 0; i < 100; i++) dice.recordCombat({ kind: 'notice', text: 'Event ' + i });
  assert.equal(dice.snapshot().active.ledger.entries.length, 60);
  assert.equal(dice.snapshot().active.ledger.entries[0].text, 'Event 40'); dice.end();
});
