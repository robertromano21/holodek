'use strict';
const I = require('../assets/dungeonInhabitants');
const key = s => String(s || '').trim().toLowerCase();
function timing(spell) {
  if (Number.isInteger(spell.castingRounds)) return Math.max(0, Math.min(5, spell.castingRounds));
  if (spell.instant === true) return 0;
  return spell.effect === 'blast' || spell.cost >= 4 ? 2 : ['ward', 'curse', 'turn'].includes(spell.effect) ? 1 : 0;
}
function current(db, runId) {
  const pool = db['0,0,0']?.spellSystem;
  return pool?.runId === runId ? pool.casting : null;
}
function beginRound(state) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), pool = db['0,0,0']?.spellSystem;
  if (!pool || pool.runId !== state.getDungeonRunId()) return;
  pool.casting ||= { round: 0, pending: {}, blocked: {} };
  pool.casting.round++; pool.casting.blocked = {};
  state.setRoomNameDatabase(JSON.stringify(db));
}
function damage(db, runId, actor, amount) {
  const casting = current(db, runId); if (!casting || !(amount > 0)) return;
  casting.blocked[key(actor.name)] = casting.round;
  const pending = casting.pending[key(actor.name)]; if (pending) pending.disrupted = true;
}
function status(state, actor) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), c = current(db, state.getDungeonRunId());
  return c && { pending: c.pending[key(actor.name)], blocked: c.blocked[key(actor.name)] === c.round, round: c.round };
}
function prepare(state, input, options) {
  const S = require('./spellSystem'), c = S.context(state, input, options), casting = current(c.db, state.getDungeonRunId());
  if (!casting) return null;
  if (!/^[\w:-]{8,100}$/.test(input.nonce || '') || input.revision !== c.pool.revision) throw Error('That spell choice is stale. Choose again.');
  casting.receipts ||= [];
  const signature = JSON.stringify([input.caster,input.itemId,input.spellId,input.target,input.geoKey]);
  const previous = casting.receipts.find(r => r.nonce === input.nonce);
  if (previous) {
    if (previous.signature !== signature) throw Error('That casting transaction was already used.');
    return `${input.caster}'s casting attempt has already been recorded.`;
  }
  if (casting.blocked[key(input.caster)] === casting.round) throw Error(`${input.caster} cannot cast this round after taking damage.`);
  const duration = timing(c.spell); if (!duration) return null;
  casting.pending[key(input.caster)] = { input: { ...input }, spell: c.spell.name, cost: c.spell.cost,
    readyAt: casting.round + duration, geoKey: input.geoKey };
  casting.receipts.push({ nonce: input.nonce, signature }); if (casting.receipts.length > 512) casting.receipts.shift();
  state.setRoomNameDatabase(JSON.stringify(c.db));
  return `${input.caster} begins casting ${c.spell.name}; ${duration} round${duration === 1 ? '' : 's'} to complete. Damage will disrupt the spell and lose ${c.spell.cost} Magic.`;
}
function take(state, actor) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), c = current(db, state.getDungeonRunId()), pending = c?.pending[key(actor.name)];
  if (!pending) return null;
  if (pending.geoKey !== I.roomKey(state.getUpdatedGameConsole().match(/^Coordinates:[ \t]*([^\r\n]*)/m)?.[1])) {
    delete c.pending[key(actor.name)]; state.setRoomNameDatabase(JSON.stringify(db)); return null;
  }
  if (c.round < pending.readyAt) return { waiting: `${actor.name} continues casting ${pending.spell}; ${pending.readyAt - c.round} round(s) remain.` };
  delete c.pending[key(actor.name)]; state.setRoomNameDatabase(JSON.stringify(db));
  return { choice: { ...pending.input, revision: db['0,0,0'].spellSystem.revision, continuing: true } };
}
function commit(state, db, text) {
  const c = current(db, state.getDungeonRunId()), notices = []; if (!c) return { text, notices };
  for (const [name, pending] of Object.entries(c.pending)) if (pending.disrupted) {
    const S = require('./spellSystem');
    text = S.forfeit(db, text, pending.input.caster, pending.input.itemId, pending.cost);
    delete c.pending[name];
    notices.push({ kind: 'spell-interrupted', title: pending.input.caster, subject: pending.input.caster, activity: 'Casting Interrupted', result: 'failure',
      message: `${pending.input.caster}'s ${pending.spell} is disrupted by damage. The spell is lost; ${pending.cost} Magic spent.` });
  }
  return { text, notices };
}
function end(state) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), c = current(db, state.getDungeonRunId());
  if (c) { c.pending = {}; c.blocked = {}; state.setRoomNameDatabase(JSON.stringify(db)); }
}
module.exports = { timing, beginRound, damage, status, prepare, take, commit, end };
