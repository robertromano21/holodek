'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), Stock = require('../retort/merchantStock');
function fixture() {
  let run = 'stock-run', db = { '0,0,0': { name: 'Market', services: { stall: { id: 'stall', kind: 'shop', operator: 'Keeper',
    till: 37, revision: 1, ...Stock.pending() } } } };
  return { getDungeonRunId: () => run, getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: text => { db = JSON.parse(text); },
    newRun: () => { run = 'another-run'; }, db: () => db };
}
const goods = () => [{ name: 'woven vest', type: 'armor', ac: 1, attack_modifier: 0, damage_modifier: 0, magic: 0,
  description: 'Layers of tightly woven cloth.', item_source: 'authored-room-object-v1' }];
test('shop inventory is authored once and later views do not restock sold quantities or reset the till', async () => {
  const state = fixture(); let calls = 0;
  const author = async () => { calls++; return goods(); };
  await Stock.prepare({}, state, '0,0,0', { author }); const service = state.db()['0,0,0'].services.stall;
  service.stock[0].quantity = 0; service.till = 51;
  await Stock.prepare({}, state, '0,0,0', { author });
  assert.equal(calls, 1); assert.equal(state.db()['0,0,0'].services.stall.stock[0].quantity, 0);
  assert.equal(state.db()['0,0,0'].services.stall.till, 51);
});
test('concurrent shop views join one authoring request', async () => {
  const state = fixture(); let release, calls = 0; const gate = new Promise(resolve => { release = resolve; });
  const author = async () => { calls++; await gate; return goods(); };
  const first = Stock.prepare({}, state, '0,0,0', { author }), second = Stock.prepare({}, state, '0,0,0', { author });
  release(); await Promise.all([first, second]); assert.equal(calls, 1);
});
test('a failed stock author never silently installs a prefab catalog', async () => {
  const state = fixture(); await assert.rejects(Stock.prepare({}, state, '0,0,0', { author: async () => { throw Error('author unavailable'); } }), /unavailable/);
  assert.deepEqual(state.db()['0,0,0'].services.stall.stock, []);
  assert.equal(state.db()['0,0,0'].services.stall.stockAuthorship.status, 'pending');
});
test('a late inventory response cannot alter a new campaign', async () => {
  const state = fixture(); await assert.rejects(Stock.prepare({}, state, '0,0,0', { author: async () => { state.newRun(); return goods(); } }), /campaign/);
  assert.deepEqual(state.db()['0,0,0'].services.stall.stock, []);
});
