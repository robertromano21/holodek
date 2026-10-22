'use strict';
const test = require('node:test'), assert = require('node:assert');
const A = require('../retort/adjacentRooms');
const W = 'http://worker.example.invalid:11434', L = 'http://127.0.0.1:11434';
test.beforeEach(() => { process.env.HOLODEK_ADJACENT_ROOMS = '1'; process.env.HOLODEK_BG_OLLAMA_URLS = W + ',' + L; });
test.afterEach(() => { A._reset(); delete process.env.HOLODEK_ADJACENT_ROOMS; delete process.env.HOLODEK_BG_OLLAMA_URLS; });
const db = { '0,0,0': { name: 'Hall', exits: { north: { targetCoordinates: '0,1,0' } } },
  '0,1,0': { name: 'Crypt' }, '1,0,0': { name: 'Done', description: 'Already here.' }, '0,0,1': { name: 'Loft' }, '-1,0,0': { name: 'Well' } };
const wait = ms => new Promise(r => setTimeout(r, ms));
function fake({ down = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const base = url.replace(/\/(api\/tags|v1\/chat\/completions)$/, '');
    if (down.includes(base)) throw Error('connect ECONNREFUSED');
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }) };
    calls.push({ base, body: JSON.parse(init.body) }); await wait(20);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Bones line the cold walls of this place.' } }] }) };
  };
  return { calls, fetchImpl };
}
test('candidates: only exit directions, skips described rooms', () => {
  A._reset();
  assert.deepStrictEqual(A.candidates(db, '0,0,0', ['north', 'east', 'south']).map(c => c.key), ['0,1,0']);
  assert.deepStrictEqual(A.candidates(db, '0,0,0', ['up']).map(c => c.key), ['0,0,1']);
});
test('explicit legacy pool, non-blocking, deduped, both endpoints used, take once', async () => {
  A._reset(); assert.deepStrictEqual(A.URLS(), [W, L]);
  const { calls, fetchImpl } = fake();
  const q1 = A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north', 'up', 'west'], runId: 'r', deps: { fetchImpl } });
  assert.deepStrictEqual(A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north'], runId: 'r', deps: { fetchImpl } }), []);
  assert.strictEqual(q1.length, 3); assert.strictEqual(calls.length, 0);
  await wait(1700 + 200);
  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(new Set(calls.slice(0, 2).map(c => c.base)), new Set([W, L]));
  for (const c of calls) { assert.strictEqual(c.body.model, 'gpt-oss:20b'); assert.strictEqual(c.body.reasoning_effort, 'low'); }
  assert.ok(A.take('0,1,0', 'Crypt', 'r')); assert.strictEqual(A.take('0,1,0', 'Crypt', 'r'), null);
});
test('background endpoints and jobs are off without explicit configuration', () => {
  delete process.env.HOLODEK_BG_OLLAMA_URLS; delete process.env.HOLODEK_ADJACENT_ROOMS;
  assert.deepStrictEqual(A.URLS(), []);
  assert.deepStrictEqual(A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north'] }), []);
});
test('one endpoint down: the other serves everything', async () => {
  A._reset(); const { calls, fetchImpl } = fake({ down: [W] });
  A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north', 'up'], runId: 'd', deps: { fetchImpl } });
  await wait(1900);
  assert.strictEqual(calls.length, 2); assert.ok(calls.every(c => c.base === L));
});
test('both down: skipped silently', async () => {
  A._reset(); const { calls, fetchImpl } = fake({ down: [W, L] });
  A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north'], runId: 'x', deps: { fetchImpl } });
  await wait(50);
  assert.strictEqual(calls.length, 0); assert.strictEqual(A._state().inFlight, 0); assert.strictEqual(A.take('0,1,0', 'Crypt', 'x'), null);
});
test('local endpoint yields to a foreground local call', async () => {
  A._reset(); const { calls, fetchImpl } = fake({ down: [W] }); let release;
  const fg = A.foreground(() => new Promise(r => { release = r; }));
  A.queueNeighbors({ db, currentKey: '0,0,0', exits: ['north'], runId: 'f', deps: { fetchImpl } });
  await wait(100); assert.strictEqual(calls.length, 0);
  release(); await fg; await wait(1700);
  assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].base, L);
});
test('env override', () => { process.env.HOLODEK_BG_OLLAMA_URLS = 'http://h:1/v1/, http://k:2'; process.env.HOLODEK_BG_MODEL = 'm';
  assert.deepStrictEqual(A.URLS(), ['http://h:1', 'http://k:2']); assert.strictEqual(A.MODEL(), 'm');
  delete process.env.HOLODEK_BG_OLLAMA_URLS; delete process.env.HOLODEK_BG_MODEL; A._reset(); });
