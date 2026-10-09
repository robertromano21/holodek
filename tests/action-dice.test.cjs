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

test('a hit prompts separately for the original damage die; duplicate clicks cannot reroll it', async () => {
  const sidesRolled = [];
  const dice = new ActionDice({ random: sides => { sidesRolled.push(sides); return sides; } });
  dice.begin('combat', '0,0,0');
  const attack = dice.roll({ actor: 'Mortacia', player: true, label: 'Attack', modifier: 2, difficulty: 15 });
  let pending = dice.snapshot().pending;
  assert.equal(pending.sides, 20);
  const attackResult = dice.submit(pending.id, pending.actionId, pending.geoKey);
  assert.equal((await attack).total, 22);
  const damage = dice.roll({ actor: 'Mortacia', player: true, label: 'Damage', sides: 8, modifier: 3 });
  pending = dice.snapshot().pending;
  assert.equal(pending.sides, 8);
  assert.notEqual(pending.id, attackResult.id);
  assert.equal(dice.submit(attackResult.id, attackResult.actionId, attackResult.geoKey), attackResult);
  assert.equal(dice.snapshot().pending.id, pending.id);
  const damageResult = dice.submit(pending.id, pending.actionId, pending.geoKey);
  assert.equal((await damage).total, 11);
  assert.equal(dice.submit(pending.id, pending.actionId, pending.geoKey), damageResult);
  assert.deepEqual(sidesRolled, [20, 8]);
  assert.deepEqual(dice.snapshot().results.map(r => r.label), ['Attack', 'Damage']);
  dice.end();
});

test('non-d20 NPC damage is published, and invalid die sizes are rejected', async () => {
  const dice = new ActionDice({ random: sides => sides });
  dice.begin('combat', '0,0,0');
  const damage = await dice.roll({ actor: 'Ally', label: 'Damage', sides: 6, modifier: 1 });
  assert.equal(damage.natural, 6);
  assert.equal(damage.total, 7);
  assert.equal(dice.snapshot().results[0].sides, 6);
  await assert.rejects(dice.roll({ actor: 'PC', sides: 0 }), /Invalid dice/);
  dice.end();
});
