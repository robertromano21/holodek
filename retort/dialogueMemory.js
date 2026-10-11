'use strict';
const trim = (value, limit = 220) => String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, limit);
const Profiles = require('../assets/characterProfiles');
function entryFor(state, name, population) {
  const ledger = state.getDialogueMemory(), record = population?.actors?.[name] || population?.companions?.[name];
  const saved = Object.hasOwn(ledger.characters, name) ? ledger.characters[name] : record?.memory;
  const list = (values, count, limit) => (Array.isArray(values) ? values : []).slice(-count).map(value => trim(value, limit)).filter(Boolean);
  const entry = { first: trim(saved?.first, 320), recent: list(saved?.recent, 3, 320),
    notes: list(saved?.notes, 3, 180), player: list(saved?.player, 2, 280),
    ...(record?.profile || saved?.profile ? { profile: record?.profile || saved.profile } : {}) };
  delete ledger.characters[name];
  Object.defineProperty(ledger.characters, name, { value: entry, enumerable: true, configurable: true, writable: true });
  const names = Object.keys(ledger.characters);
  for (const old of names.slice(0, Math.max(0, names.length - 64))) delete ledger.characters[old];
  if (record) record.memory = entry;
  return entry;
}
function rememberDialogue(state, population, rows, kind = 'ambient') {
  const ledger = state.getDialogueMemory();
  for (const row of rows || []) {
    if (!row?.speaker || !row.line) continue;
    const entry = entryFor(state, row.speaker, population);
    const line = trim(row.line, 320);
    if (!entry.first) entry.first = line;
    entry.recent = [...entry.recent.filter(s => s !== line), line].slice(-3);
    if (row.remember) entry.notes = [...entry.notes.filter(s => s !== trim(row.remember, 180)), trim(row.remember, 180)].slice(-3);
    const record = population?.actors?.[row.speaker] || population?.companions?.[row.speaker];
    if (record) record.memory = entry;
    ledger.recent = [...ledger.recent, { speaker: row.speaker, line: trim(line), kind }].slice(-6);
  }
}
function rememberPlayerInput(state, input, names, population) {
  const value = trim(input, 280);
  if (!value) return;
  for (const name of names) {
    const entry = entryFor(state, name, population);
    entry.player = [...entry.player.filter(s => s !== value), value].slice(-2);
  }
}
function memoryContext(state, names, population, maxChars = 3600) {
  const ledger = state.getDialogueMemory(), result = [];
  for (const name of [...new Set(names)].slice(0, 8)) {
    const record = population?.actors?.[name] || population?.companions?.[name];
    const memory = Object.hasOwn(ledger.characters, name) ? ledger.characters[name] : record?.memory;
    if (!memory) continue;
    const row = { name, recollection: { first: memory.first, recent: memory.recent, notes: memory.notes, player: memory.player,
      ...(memory.profile || record?.profile ? { profile: Profiles.compact(memory.profile || record.profile) } : {}) } };
    if (JSON.stringify([...result,row]).length > maxChars) break;
    result.push(row);
  }
  return result;
}
module.exports = { rememberDialogue, rememberPlayerInput, memoryContext };
