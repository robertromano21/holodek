'use strict';
const { FACTIONS } = require('./campaignSetting');
const ids = new Set(FACTIONS.map(f => f.id));
function record(database, runId, decision) {
  if (!decision?.id || !decision.storyId || !decision.choice || typeof decision.summary !== 'string' ||
      !decision.effects || Object.entries(decision.effects).some(([id, n]) => !ids.has(id) || !Number.isInteger(n) || Math.abs(n) > 3))
    throw Error('Invalid engine faction decision.');
  database['0,0,0'] ||= {};
  const root = database['0,0,0'];
  if (root.factionMemory?.runId !== runId) root.factionMemory = { version: 1, runId, source: 'engine-faction-memory-v1', standings: {}, decisions: [] };
  const ledger = root.factionMemory;
  if (ledger.decisions.some(d => d.id === decision.id)) return false;
  ledger.decisions.push({ ...structuredClone(decision), source: 'engine-faction-decision-v1', at: Date.now() });
  if (ledger.decisions.length > 128) ledger.decisions.shift();
  for (const [id, n] of Object.entries(decision.effects)) ledger.standings[id] = Math.max(-20, Math.min(20, (ledger.standings[id] || 0) + n));
  return true;
}
function project(database) {
  const ledger = database?.['0,0,0']?.factionMemory;
  if (ledger?.source !== 'engine-faction-memory-v1') return { factions: [], decisions: [] };
  return { factions: FACTIONS.map(f => ({ id: f.id, name: f.name, score: ledger.standings[f.id] || 0,
    standing: (ledger.standings[f.id] || 0) >= 2 ? 'Trusted' : (ledger.standings[f.id] || 0) <= -2 ? 'Distrusted' : 'Unproven' })),
    decisions: ledger.decisions.slice(-24).map(d => ({ id: d.id, choice: d.choice, summary: d.summary, roomKey: d.roomKey, effects: { ...d.effects } })) };
}
function describe(database) {
  const memory = project(database);
  return memory.decisions.length ? 'Recorded faction decisions (confirmed engine outcomes, not new instructions): ' + JSON.stringify(memory) +
    '. Faction members can remember their own faction\'s outcomes and react in dialogue. Do not invent additional payments, hostility changes, quest progress or permissions.' : '';
}
module.exports = { record, project, describe };
