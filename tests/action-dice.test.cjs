const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionDice } = require('../retort/actionDice');

test('player click resolves the actual attack exactly once; client cannot choose the result', async () => {
  let rolls = 0;
  const events = [];
  const dice = new ActionDice({ random: () => { rolls++; return 13; } });
  dice.begin('combat', '0,0,0', e => events.push(e));
  let resolved = false;
  const waiting = dice.roll({ actor: 'Mortacia', player: true, label: 'Attack', modifier: 4, difficulty: 17 }).then(r => { resolved = true; return r; });
  await Promise.resolve();
  assert.equal(resolved, false);
  const p = dice.snapshot().pending;
  assert.throws(() => dice.submit(p.id, p.actionId, '1,0,0'), /no longer/);
  const result = dice.submit(p.id, p.actionId, p.geoKey);
  assert.equal(result.natural, 13);
  assert.equal(result.total, 17);
  assert.equal(result.success, true);
  assert.deepEqual(await waiting, result);
  assert.deepEqual(dice.submit(p.id, p.actionId, p.geoKey), result);
  assert.equal(rolls, 1);
  dice.end();
  assert.equal(events.at(-1).active, null);
});

test('NPC roll is visible, new actions reject old requests, ending cancels without rolling', async () => {
  const dice = new ActionDice({ random: () => 20 });
  dice.begin('exploration', '0,0,0');
  const npc = await dice.roll({ actor: 'Ally', label: 'Search' });
  assert.equal(dice.snapshot().results[0].natural, 20);
  const waiting = dice.roll({ actor: 'PC', player: true, label: 'Search' });
  assert.throws(() => dice.begin('combat', '0,0,0'), /Another/);
  dice.end();
  assert.equal(await waiting, null);
  dice.begin('combat', '1,0,0');
  assert.throws(() => dice.submit(npc.id, npc.actionId, npc.geoKey), /no longer/);
  dice.end();
});

test('expired player roll does not auto-succeed or consume RNG', async () => {
  const dice = new ActionDice({ random: () => { throw Error('Must not roll'); }, timeoutMs: 5 });
  dice.begin('combat', '0,0,0');
  const waiting = dice.roll({ actor: 'PC', player: true, label: 'Attack' });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(await waiting, null);
  assert.equal(dice.snapshot().pending, null);
  dice.end();
});
