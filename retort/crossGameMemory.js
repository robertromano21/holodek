'use strict';
// world1 cross-game no-repeat memory. It travels with the save: db['0,0,0'].crossGameHistory holds the last 20 games.
// A process-level copy carries it from the save a player loaded (or the game they just played) into the next new game.
const KEY = 'crossGameHistory', KEEP_RUNS = 20, KEEP_VALUES = 400;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
let cache = { version: 2, runs: [] }, source = null;
function bounded(data) { data.runs = data.runs.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-KEEP_RUNS); return data; }
// Merge a save's history into the working copy (union per run; newest 20 games kept).
function load(db) {
  const saved = db?.['0,0,0']?.[KEY];
  if (!saved || !Array.isArray(saved.runs)) return cache;
  for (const r of saved.runs) {
    if (!r?.runId) continue;
    let run = cache.runs.find(x => x.runId === r.runId);
    if (!run) { run = { runId: r.runId, at: r.at || 0 }; cache.runs.push(run); }
    for (const [kind, values] of Object.entries(r)) if (Array.isArray(values)) run[kind] = [...new Set([...(run[kind] || []), ...values.map(norm).filter(Boolean)])].slice(-KEEP_VALUES);
  }
  return bounded(cache);
}
// Write the working copy into a room database (the save) and return it.
function persist(db) {
  if (!db || typeof db !== 'object') return db;
  db['0,0,0'] ||= {};
  db['0,0,0'][KEY] = JSON.parse(JSON.stringify(bounded(cache)));
  return db;
}
// Optional live source: the current save in sharedState, read before every lookup.
function attach(state) { source = state; return api; }
function refresh() { try { if (source?.getRoomNameDatabase) load(JSON.parse(source.getRoomNameDatabase() || '{}')); } catch { /* unreadable save: keep working copy */ } }
function persistState(state = source) {
  try { const db = JSON.parse(state.getRoomNameDatabase() || '{}'); load(db); state.setRoomNameDatabase(JSON.stringify(persist(db))); } catch { /* optional */ }
}
// kind: 'names' | 'premises' | 'murals' | 'cities'
function record(runId, kind, values) {
  if (!runId || !values?.length) return;
  refresh();
  let run = cache.runs.find(r => r.runId === runId);
  if (!run) { run = { runId, at: Date.now() }; cache.runs.push(run); }
  run[kind] = [...new Set([...(run[kind] || []), ...values.map(norm).filter(Boolean)])].slice(-KEEP_VALUES);
  bounded(cache);
}
// Values used by OTHER games, newest first, for "avoid" prompt lists and validator collisions.
function avoid(runId, kind, limit = 60) {
  refresh();
  const out = [];
  for (const run of cache.runs.slice().reverse()) if (run.runId !== runId) for (const v of run[kind] || []) if (!out.includes(v)) out.push(v);
  return out.slice(0, limit);
}
function collides(runId, kind, value) { const v = norm(value); return !!v && avoid(runId, kind, 10000).includes(v); }
function reset() { cache = { version: 2, runs: [] }; source = null; }
const api = { KEY, KEEP_RUNS, record, avoid, collides, norm, load, persist, attach, persistState, reset, snapshot: () => JSON.parse(JSON.stringify(cache)) };
module.exports = api;
