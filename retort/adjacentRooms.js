'use strict';
// Background pre-generation of descriptions for named-but-undescribed neighbor rooms.
// Website jobs use the selected game model. Results are held in memory and
// consumed by generateMissingRoomDetails when the player actually walks there; the full on-entry
// pipeline (objects, monsters, blueprint, palette) still runs then. Failures are logged and swallowed.
const RoomDescription = require('./roomDescription');

const clean = u => String(u).trim().replace(/\/+$/, '').replace(/\/v1$/, '');
// Legacy endpoints require explicit operator configuration; never publish a personal server address.
const URLS = () => (process.env.HOLODEK_BG_OLLAMA_URLS || process.env.HOLODEK_ADJACENT_OLLAMA_URL || '')
  .split(',').map(clean).filter(Boolean);
const URL_BASE = () => URLS()[0];
const MODEL = () => process.env.HOLODEK_BG_MODEL || process.env.HOLODEK_ADJACENT_MODEL || 'gpt-oss:20b';
const PER_ENDPOINT = () => Math.max(1, Math.min(4, Number(process.env.HOLODEK_BG_PER_ENDPOINT) || 1));
const HEALTH_TTL = () => Number(process.env.HOLODEK_BG_HEALTH_TTL_MS) || 30000;
const isLocal = u => /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(u);
const health = new Map(), busy = new Map();
let foregroundLocal = 0;
// Foreground calls to the PC's own Ollama mark it busy so background work there yields to player turns.
function foreground(run) { foregroundLocal++; const started = epoch; let done = false; const end = () => { if (!done) { done = true; if (started === epoch) foregroundLocal--; } };
  try { const r = run(); if (r && typeof r.then === 'function') return r.finally(end); end(); return r; } catch (e) { end(); throw e; } }
async function healthy(url, fetchImpl) {
  const h = health.get(url); if (h && Date.now() - h.at < HEALTH_TTL()) return h.up;
  let up = false;
  try { const r = await fetchImpl(url + '/api/tags', { signal: AbortSignal.timeout(3000) }); const j = await r.json();
    up = r.ok && (j.models || []).some(m => [m.name, m.model].some(n => n === MODEL() || n === MODEL() + ':latest')); } catch {}
  if (!h || h.up !== up) console.info('[AdjacentRooms]', JSON.stringify({ phase: 'health', url, up }));
  health.set(url, { up, at: Date.now() }); return up;
}
const markDown = url => health.set(url, { up: false, at: Date.now() });
// Least-busy healthy endpoint with a free slot; local endpoint is skipped while a foreground local call is running.
async function pick(fetchImpl) {
  const free = [];
  for (const url of URLS()) {
    if ((busy.get(url) || 0) >= PER_ENDPOINT()) continue;
    if (isLocal(url) && foregroundLocal > 0) continue;
    if (await healthy(url, fetchImpl)) free.push(url);
  }
  free.sort((a, b) => (busy.get(a) || 0) - (busy.get(b) || 0));
  return free[0] || null;
}
async function anyUp(fetchImpl) { for (const url of URLS()) if (await healthy(url, fetchImpl)) return true; return false; }
const TIMEOUT_MS = () => Number(process.env.HOLODEK_ADJACENT_TIMEOUT_MS) || 180000;
const OFFSETS = { north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1],
  northeast: [1, 1, 0], northwest: [-1, 1, 0], southeast: [1, -1, 0], southwest: [-1, -1, 0] };

const ready = new Map(), inFlight = new Set(), queue = [];
let active = 0;
let epoch = 0;
const MAX_READY = 64, MAX_QUEUE = 32, TTL = 15 * 60 * 1000;
const signature = room => JSON.stringify([room?.name, room?.classification?.indoor, room?.classification?.biome,
  room?.classification?.features, room?.environmentIntent, room?.campaignSetting, room?.planarRealm]);
const website = deps => deps.website || require('./websiteAi').service();
const blank = v => typeof v !== 'string' || !v.trim() || /^(none|null|undefined|empty)$/i.test(v.trim());
const cacheKey = (runId, key) => `${runId || ''}|${key}`;
const parseKey = k => { const m = String(k || '').match(/(-?\d+)\D+(-?\d+)\D+(-?\d+)/); return m ? `${+m[1]},${+m[2]},${+m[3]}` : null; };

function described(room) {
  return !!room && (room.populationComplete === true || room.visited === true ||
    [room.description, room.roomDescription, room.sceneSpec?.source?.description].some(v => !blank(v)));
}
function stripHarmony(text) {
  const s = String(text || ''), at = s.lastIndexOf('<|channel|>final<|message|>');
  return (at >= 0 ? s.slice(at + 27) : s).replace(/<\|(start|end|return|call|message|channel)\|>/g, '').trim();
}
// Which neighbor coordinates need a description: only directions with an exit from the current room.
function candidates(db, currentKey, exits) {
  const here = parseKey(currentKey); if (!here) return [];
  const [x, y, z] = here.split(',').map(Number), room = db[here] || {}, out = [];
  for (const dir of new Set((exits || []).map(e => String(e).trim().toLowerCase()))) {
    const explicit = parseKey(room.exits?.[dir]?.targetCoordinates);
    if (!Object.hasOwn(OFFSETS, dir) && !explicit) continue;
    const [dx, dy, dz] = OFFSETS[dir] || [0, 0, 0];
    const key = explicit || `${x + dx},${y + dy},${z + dz}`;
    if (key === here) continue;
    const target = db[key];
    if (!target || blank(target.name) || described(target)) continue; // unnamed rooms are named by the normal path first
    out.push({ key, direction: dir, room: target });
  }
  return out;
}
// Background bodies go through the same setting layer as foreground calls: CotG persona only in CotG play;
// homebrew/genre worlds get their own GM name and master prompt, never CotG lore.
function bgBody(prompt, profile = null) {
  const S = require('./settingLayer'), cotg = S.isCotGPlay(), gm = cotg ? 'Grave Master' : (S.gmName() || 'Holodek');
  const sys = cotg ? 'You are the Grave Master of a dark fantasy text adventure. Reasoning: low.' : `You are ${gm}, the game master of this world's text adventure. Reasoning: low.`;
  const user = cotg ? prompt : String(prompt).replace(/\b(?:[Tt]he )?Grave Master\b/g, gm);
  const input = { model: profile?.id || MODEL(), temperature: 1.0, stream: false,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] };
  return S.applyBody(profile ? require('./modelTransport').requestBody(input) : { ...input, reasoning_effort: 'low' });
}
async function callOllama(prompt, { fetchImpl = globalThis.fetch, url = URL_BASE() } = {}) {
  const res = await fetchImpl(url + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS()),
    body: JSON.stringify(bgBody(prompt)) });
  if (!res.ok) throw Error('HTTP ' + res.status);
  const json = await res.json();
  return stripHarmony(json.choices?.[0]?.message?.content);
}
async function job(item, runId, deps, url) {
  const t0 = Date.now();
  const model = item.packet?.body.model || MODEL(), started = epoch;
  console.info('[AdjacentRooms]', JSON.stringify({ phase: 'request', key: item.key, direction: item.direction, name: item.room.name, transport: url === 'website' ? 'ssh-worker' : 'configured-ollama', model }));
  const prompt = item.prompt;
  let raw;
  try {
    if (item.packet) raw = stripHarmony((await website(deps).generate(item.packet)).choices?.[0]?.message?.content);
    else raw = await (deps.call || callOllama)(prompt, { ...deps, url });
  } catch (e) { if (!item.packet && !/^HTTP 4/.test(e?.message)) markDown(url); throw e; }
  const text = RoomDescription.validate(raw);
  if (started !== epoch || item.packet && (website(deps).view().revision !== item.packet.expectedRevision || !website(deps).backgroundEnabled())) return;
  ready.set(cacheKey(runId, item.key), { name: item.room.name, signature: item.signature, description: text, model, at: Date.now() });
  while (ready.size > MAX_READY) ready.delete(ready.keys().next().value);
  console.info('[AdjacentRooms]', JSON.stringify({ phase: 'ready', key: item.key, name: item.room.name, chars: text.length, ms: Date.now() - t0 }));
}
let pumping = false, retryTimer = null;
async function pump(deps) {
  if (pumping) return; pumping = true;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  try {
    while (queue.length) {
      const first = queue[0], modern = !!first.item.packet;
      if (modern && (!website(deps).backgroundEnabled() || website(deps).view().revision !== first.item.packet.expectedRevision)) {
        queue.shift(); inFlight.delete(cacheKey(first.runId, first.item.key)); continue;
      }
      const limit = first.item.packet?.provider === 'ollama' ? 1 : 2;
      const url = modern ? (busy.get('website') || 0) < limit && !(first.item.packet.provider === 'ollama' && foregroundLocal) ? 'website' : null : await pick(fetchImpl);
      if (!url) {
        if (!modern && !(await anyUp(fetchImpl))) { // On-demand generation still works.
          const dropped = queue.splice(0); for (const q of dropped) inFlight.delete(cacheKey(q.runId, q.item.key));
          console.info('[AdjacentRooms]', JSON.stringify({ phase: 'skipped', reason: 'no endpoint up', dropped: dropped.length }));
        } else if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; pump(deps); }, 1500); // all busy / yielding to foreground
        break;
      }
      const { item, runId } = queue.shift(), started = epoch; active++; busy.set(url, (busy.get(url) || 0) + 1);
      job(item, runId, deps, url).catch(() => console.warn('[AdjacentRooms]', JSON.stringify({ phase: 'failed', key: item.key, reason: 'Background preparation unavailable; normal room entry remains authoritative.' })))
        .finally(() => { if (started !== epoch) return; active--; busy.set(url, busy.get(url) - 1); inFlight.delete(cacheKey(runId, item.key)); pump(deps); });
    }
  } catch (error) { console.warn('[AdjacentRooms]', 'pump failed', error?.message); } finally { pumping = false; }
}
// Fire-and-forget: never awaited by room entry.
function queueNeighbors({ db, currentKey, exits, runId = '', context = '', deps = {} } = {}) {
  const modern = website(deps).backgroundEnabled();
  if (!modern && !(/^(1|on|true|yes)$/i.test(process.env.HOLODEK_ADJACENT_ROOMS || '') && URLS().length)) return [];
  for (const [key, value] of ready) if (Date.now() - value.at > TTL) ready.delete(key);
  let list = [];
  try { list = candidates(db || {}, currentKey, exits); } catch (error) { console.warn('[AdjacentRooms]', 'candidate scan failed', error?.message); return []; }
  const queued = [];
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'below', down: 'above',
    northeast: 'southwest', northwest: 'southeast', southeast: 'northwest', southwest: 'northeast' };
  for (const item of list) {
    const k = cacheKey(runId, item.key);
    if (ready.has(k) || inFlight.has(k) || queue.length >= MAX_QUEUE) continue;
    const copy = { ...item, room: structuredClone(item.room), signature: signature(item.room) };
    copy.prompt = RoomDescription.creationPrompt({ name: copy.room.name, coordinates: copy.key, classification: copy.room.classification || {}, room: copy.room }) +
      (context ? `\nThe party is currently in the neighboring room to the ${opposite[item.direction] || 'linked entrance'}: ${String(context).slice(0, 600)}` : '');
    if (modern) {
      const profile = (deps.models || require('./gameModels')).profile('gpt-4.1-mini');
      copy.packet = { provider: profile.local ? 'ollama' : profile.provider || 'openai', body: bgBody(copy.prompt, profile),
        expectedRevision: website(deps).view().revision, background: true };
    }
    inFlight.add(k); queue.push({ item: copy, runId }); queued.push(item.key);
  }
  if (queued.length) console.info('[AdjacentRooms]', JSON.stringify({ phase: 'queued', from: parseKey(currentKey), keys: queued }));
  if (queued.length) setImmediate(() => pump(deps));
  return queued;
}
// Consume a pre-generated description for the room being entered (name must still match).
function take(key, name, runId = '', room = null) {
  const k = cacheKey(runId, parseKey(key)), hit = ready.get(k);
  if (!hit) return null;
  ready.delete(k);
  if (name && hit.name !== name || Date.now() - hit.at > TTL || room && (described(room) || hit.signature !== signature(room))) return null;
  console.info('[AdjacentRooms]', JSON.stringify({ phase: 'used', key: parseKey(key), name, model: hit.model }));
  return hit.description;
}
const _reset = () => { epoch++; ready.clear(); inFlight.clear(); queue.length = 0; active = 0; health.clear(); busy.clear(); foregroundLocal = 0; if (retryTimer) clearTimeout(retryTimer); retryTimer = null; };
module.exports = { queueNeighbors, take, candidates, described, stripHarmony, URL_BASE, URLS, MODEL, foreground, isLocal, _reset, _state: () => ({ ready: ready.size, inFlight: inFlight.size, queued: queue.length, active, foregroundLocal, busy: Object.fromEntries(busy) }) };
module.exports.bgBody = bgBody;
