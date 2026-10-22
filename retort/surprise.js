'use strict';
const Flags = require('./worldFlags');
const BASE = 0.6;
const armed = new Map();
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// Chance that hostile monsters surprise the party. 60% base, confirmed by the user.
function chance({ pc, settlement } = {}) {
  let p = BASE;
  if (/\b(ranger|rogue|thief|scout|assassin|monk)\b/i.test(String(pc?.className || pc?.class || ''))) p -= 0.1;
  if (Number(pc?.dexterity || pc?.dex) >= 16 || Number(pc?.wisdom || pc?.wis) >= 16) p -= 0.05;
  if (settlement) p -= 0.15;
  return Math.max(0.1, Math.min(0.9, p));
}
function roll(input = {}, random = Math.random) {
  if (!Flags.on('SURPRISE') || input.starting) return null;
  const p = chance(input), r = random();
  return { version: Flags.VERSION, chance: Math.round(p * 100), roll: Math.floor(r * 100) + 1, party: r < p };
}
function arm(geoKey, info) { if (geoKey && info?.party) armed.set(geoKey, info); }
function consume(geoKey) { const v = armed.get(geoKey); armed.delete(geoKey); return v || null; }
// Hostiles who surprised the party act first, before anyone who rolled initiative.
// Surprise grants only the first turn: in the ambush round the surprising hostiles act first (each once, in their own
// initiative order), then everyone else in normal initiative order. No extra round; consume() is one-shot, so the next
// round rolls normal initiative.
function order(initiativeOrder, isHostile) {
  return [...initiativeOrder.filter(isHostile), ...initiativeOrder.filter(a => !isHostile(a))];
}
module.exports = { BASE, chance, roll, arm, consume, order, hash };
