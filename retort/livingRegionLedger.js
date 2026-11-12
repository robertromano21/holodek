'use strict';
// Living region event ledger: append-only and engine-owned.
// Facts are established truth. Uncertainty lives only in belief (witness) records that point at a fact.
const crypto = require('node:crypto');
const VERSION = 1;
const SOURCE = 'engine-living-region-ledger-v1';
const KINDS = ['history', 'discovery', 'travel', 'rest', 'favor-offered', 'favor-completed', 'quest-completed',
  'combat-outcome', 'development', 'consequence', 'transformation', 'world-event', 'initiative', 'companion', 'reputation'];
// Who may write a fact. The model only authors the pre-arrival history at region creation.
// 'verified-record' copies an outcome another engine system already committed (quest gate, job, favor, combat, transfer,
// exploration, party change); narration and dialogue are never a writer.
const WRITERS = ['authored-history', 'verified-quest', 'favor', 'combat-outcome', 'discovery', 'development', 'consequence', 'verified-record', 'initiative', 'companion'];
// How a holder came to know a fact: they saw it, were told it (hearsay through a named channel) or it was authored.
const CHANNELS = ['authored', 'witness', 'hearsay'];
const MAX_FACTS = 1500, MAX_BELIEFS = 3000;
// Integrity is checked in full once per ledger object, then incrementally for appended records.
const VERIFIED = new WeakMap();
// Prose is stored in full (whitespace normalized only). Identifiers are bounded and rejected, never shortened.
const line = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const ident = (value, max, label) => { const v = line(value); if (v.length > max) throw Error(`Ledger ${label} is too long.`); return v; };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const names = list => { const out = [...new Set((Array.isArray(list) ? list : []).map(n => ident(n, 200, 'actor name')).filter(Boolean))]; if (out.length > 24) throw Error('Too many ledger actors.'); return out; };
function create(runId) {
  if (!line(String(runId ?? ''))) throw Error('A living region ledger needs the campaign run id.');
  return { version: VERSION, source: SOURCE, runId, facts: [], beliefs: [], head: 'genesis', beliefHead: 'genesis' };
}
function factBody(f) {
  return JSON.stringify([f.id, f.seq, f.kind, f.writer, f.text, f.communityId, f.roomKey, f.actors, f.evidence, f.turn, f.prev]);
}
function beliefBody(b) {
  return JSON.stringify([b.id, b.seq, b.factId, b.holder, b.account, b.matchesTruth, b.channel, b.heardFrom, b.prev]);
}
function append(ledger, input) {
  if (ledger?.source !== SOURCE) throw Error('Not a living region ledger.');
  if (!verified(ledger)) throw Error('Living region ledger integrity check failed; refusing to append.');
  const kind = input?.kind, writer = input?.writer, text = line(input?.text);
  if (!KINDS.includes(kind)) throw Error('Unknown ledger fact kind: ' + kind);
  if (!WRITERS.includes(writer)) throw Error('Unknown ledger writer: ' + writer);
  if (!text) throw Error('A ledger fact needs text.');
  if (input.key && ledger.facts.some(f => f.key === input.key)) return null; // idempotent engine events
  if (ledger.facts.length >= MAX_FACTS) throw Error('Living region ledger is full.');
  const seq = ledger.facts.length + 1;
  const fact = { id: 'lrf:' + seq, seq, key: ident(input.key, 240, 'key') || null, kind, writer, text,
    communityId: ident(input.communityId, 60, 'community id') || null, roomKey: ident(input.roomKey, 60, 'room key') || null,
    actors: names(input.actors), evidence: (() => { const e = Array.isArray(input.evidence) ? input.evidence : []; if (e.length > 8) throw Error('Too much ledger evidence.'); return e.map(x => structuredClone(x)); })(),
    turn: Number.isSafeInteger(input.turn) ? input.turn : null, at: Number.isFinite(input.at) ? input.at : Date.now(), prev: ledger.head };
  fact.hash = sha(factBody(fact));
  ledger.facts.push(fact); ledger.head = fact.hash; remember(ledger);
  return structuredClone(fact);
}
function believe(ledger, input) {
  if (ledger?.source !== SOURCE) throw Error('Not a living region ledger.');
  if (!verified(ledger)) throw Error('Living region ledger integrity check failed; refusing to append.');
  const fact = ledger.facts.find(f => f.id === input?.factId);
  if (!fact) throw Error('A belief must reference an existing fact.');
  const holder = ident(input.holder, 200, 'belief holder'), account = line(input.account);
  if (!holder || !account) throw Error('A belief needs a holder and an account.');
  const channel = CHANNELS.includes(input.channel) ? input.channel : 'witness';
  if (ledger.beliefs.length >= MAX_BELIEFS) throw Error('Living region belief records are full.');
  const seq = ledger.beliefs.length + 1;
  const belief = { id: 'lrb:' + seq, seq, factId: fact.id, holder, account,
    // A belief never edits the fact; it only records whether this account agrees with it.
    matchesTruth: typeof input.matchesTruth === 'boolean' ? input.matchesTruth : null, channel, heardFrom: ident(input.heardFrom, 200, 'belief source') || null,
    at: Number.isFinite(input.at) ? input.at : Date.now(), prev: ledger.beliefHead };
  belief.hash = sha(beliefBody(belief));
  ledger.beliefs.push(belief); ledger.beliefHead = belief.hash; remember(ledger);
  return structuredClone(belief);
}
function remember(ledger) { VERIFIED.set(ledger, { facts: ledger.facts.length, beliefs: ledger.beliefs.length, head: ledger.head, beliefHead: ledger.beliefHead }); }
function verified(ledger) {
  const c = VERIFIED.get(ledger);
  if (c && c.facts === ledger.facts.length && c.beliefs === ledger.beliefs.length && c.head === ledger.head && c.beliefHead === ledger.beliefHead) return true;
  const ok = verify(ledger).ok; if (ok) remember(ledger); return ok;
}
function room(ledger, { facts = 0, beliefs = 0 } = {}) { return ledger.facts.length + facts <= MAX_FACTS && ledger.beliefs.length + beliefs <= MAX_BELIEFS; }
function verify(ledger) {
  if (ledger?.source !== SOURCE || !Array.isArray(ledger.facts) || !Array.isArray(ledger.beliefs)) return { ok: false, reason: 'shape' };
  let prev = 'genesis';
  for (const [i, f] of ledger.facts.entries()) {
    if (f.seq !== i + 1 || f.id !== 'lrf:' + (i + 1) || f.prev !== prev || sha(factBody(f)) !== f.hash) return { ok: false, reason: 'fact ' + (i + 1) };
    prev = f.hash;
  }
  if (prev !== ledger.head) return { ok: false, reason: 'head' };
  const ids = new Set(ledger.facts.map(f => f.id));
  prev = 'genesis';
  for (const [i, b] of ledger.beliefs.entries()) {
    if (b.seq !== i + 1 || b.prev !== prev || sha(beliefBody(b)) !== b.hash || !ids.has(b.factId)) return { ok: false, reason: 'belief ' + (i + 1) };
    prev = b.hash;
  }
  if (prev !== ledger.beliefHead) return { ok: false, reason: 'belief head' };
  return { ok: true };
}
const truth = (ledger, factId) => structuredClone(ledger.facts.find(f => f.id === factId) || null);
const beliefsAbout = (ledger, factId) => ledger.beliefs.filter(b => b.factId === factId).map(b => structuredClone(b));
const beliefsOf = (ledger, holder) => ledger.beliefs.filter(b => b.holder.toLowerCase() === String(holder || '').toLowerCase()).map(b => structuredClone(b));
function recent(ledger, { communityId = null, limit = 4 } = {}) {
  return ledger.facts.filter(f => !communityId || f.communityId === communityId || f.communityId === null).slice(-limit)
    .map(f => ({ id: f.id, kind: f.kind, text: f.text }));
}
// Campaign memory mirror: facts are engine state; beliefs are reported accounts witnessed by their holder.
function memoryRecords(ledger, { roomKeyFor = () => '0,0,0', roomNameFor = () => '' } = {}) {
  const records = [];
  for (const f of ledger.facts) {
    // A copy of a campaign-memory record is already in memory with its own witnesses.
    if (f.evidence?.[0]?.source === 'campaign-memory') continue;
    const witnesses = [...new Set([...f.actors, ...(f.evidence?.[0]?.witnesses || [])])];
    const roomKey = f.roomKey || roomKeyFor(f.communityId) || '0,0,0';
    records.push({ runId: ledger.runId, id: 'living-region:' + f.id, kind: f.kind === 'quest-completed' ? 'quest' : 'activity',
      authority: 'state', source: 'living-region-ledger', text: 'Regional fact (established): ' + f.text,
      roomKey, roomName: roomNameFor(roomKey), actors: f.actors, witnesses, turn: f.turn ?? 0, at: f.at });
  }
  const byId = new Map(ledger.facts.map(f => [f.id, f]));
  for (const b of ledger.beliefs) {
    const fact = byId.get(b.factId);
    const roomKey = fact?.roomKey || roomKeyFor(fact?.communityId) || '0,0,0';
    records.push({ runId: ledger.runId, id: 'living-region:' + b.id, kind: 'room-history', authority: 'reported',
      source: 'living-region-belief', text: `${b.holder} believes (${b.matchesTruth === true ? 'consistent with the record' : b.matchesTruth === false ? 'differs from the record' : 'unverified account'}): ${b.account}`,
      roomKey, roomName: roomNameFor(roomKey), actors: [b.holder], witnesses: [b.holder], speaker: b.holder, at: b.at });
  }
  return records;
}
module.exports = { VERSION, SOURCE, KINDS, WRITERS, CHANNELS, MAX_FACTS, MAX_BELIEFS, create, append, believe, verify, room, truth, beliefsAbout, beliefsOf, recent, memoryRecords };
