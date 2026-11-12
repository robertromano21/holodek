'use strict';
// Living world: universal participation in the region's history, selective active planning.
//   Persistent history  every named character who has meaningfully interacted or appears in a verified event: identity,
//                       witnessed events, promises (accepted work), recruitment, injuries, relationships.
//   Regional involvement characters touched by a regional event: their knowledge (beliefs), dialogue context, work or
//                       circumstances can change.
//   Active goals        a bounded cast near the player (LIMITS.activeCast within LIMITS.activeRadius open-exit steps)
//                       pursues supported plans and produces playable opportunities at meaningful moments.
//   Background life     everyone else: atmosphere only; promoted when a meaningful interaction warrants it.
// World history is the region ledger. Only outcomes another engine system already committed enter it (quest gates and
// journal, jobs and favors, combat defeats and survivals, item transfers, dice-adjudicated interactions, exploration,
// party changes). Narration and dialogue never become facts. The world layer never stores a second copy of anyone's
// location, inventory or tasks: it reads the room, party and mission records, and keeps only history and knowledge.
const Ledger = require('./livingRegionLedger');
const Topology = require('./livingRegionTopology');
const I = () => require('../assets/dungeonInhabitants');
const VERSION = 1;
const LIMITS = { activeCast: 4, activeRadius: 3, ingestPerTurn: 16, worldFacts: 1000, propagatePerActivation: 12, personEvents: 24,
  adoptions: 3, adoptImportance: 3, hearsayDelay: 2, nearbyRange: 3, followUpTurns: 8, seenIds: 600, initiativesPerTurn: 2, partyNews: 6 };
const VERIFIED_MEMORY = new Set(['committed-game-state', 'verified-quest-gate', 'selected-dice-outcome']);
const JOB_SOURCES = new Set(['engine-resident-favor-v1', 'engine-local-contract-v1']);
const lower = s => String(s ?? '').trim().toLowerCase();
const excerpt = (s, n = 220) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const parse = k => String(k || '').split(',').map(Number);
const cheb = (a, b) => { const p = parse(a), q = parse(b); return p.length === 3 && q.length === 3 && p[2] === q[2] ? Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) : Infinity; };

function init(region) {
  region.world ||= {};
  const w = region.world;
  w.version = VERSION; w.people ||= {}; w.pending ||= []; w.reputation ||= {}; w.active ||= []; w.guards ||= []; w.adoptions ||= []; w.told ||= [];
  w.cursor ||= { at: 0, ids: [] }; w.seen ||= { missions: {}, defeats: 0, survivals: {}, journal: 0, visited: [], party: null, dialogue: {} };
  w.cost ||= { modelCalls: {}, modelJobs: {}, ingested: 0, skipped: 0, activations: 0, steps: 0, worldFacts: 0 };
  w.initiative ||= {}; w.companions ||= {};
  return w;
}
// Background model jobs started (each is one authoring call plus its review); authoring counts the setup calls.
function count(region, kind) { const c = (init(region).cost.modelJobs ||= {}); c[kind] = (c[kind] || 0) + 1; }
function guard(region, rule, subject, reason) {
  const w = init(region); const id = rule + ':' + subject;
  if (!w.guards.some(g => g.id === id)) { w.guards.push({ id, rule, subject, reason, at: Date.now() }); if (w.guards.length > 200) w.guards.shift(); }
  return false;
}

// ---------- Authoritative records (read, never copied) ----------
// One pass over the rooms: where each named character is recorded, and any identity recorded twice.
function index(db) {
  const where = new Map(), duplicates = [];
  for (const [key, room] of Object.entries(db || {})) for (const [name, a] of Object.entries(room?.inhabitants?.actors || {})) {
    if (!a || ['recruited', 'departed'].includes(a.status)) continue;
    const k = lower(name), prior = where.get(k);
    if (prior && prior.status !== 'dead' && a.status !== 'dead') duplicates.push({ name, rooms: [prior.roomKey, key] });
    if (!prior || prior.status === 'dead') where.set(k, { name, roomKey: key, status: a.status || 'present', record: a });
  }
  return { where, duplicates };
}
function partyOf(state, consoleText = state.getUpdatedGameConsole?.() || '') {
  const In = I(); let roster = [];
  try { roster = JSON.parse(state.getCombatCharactersString?.() || '[]'); } catch {}
  const pc = In.parseSheets(consoleText, 'PC').map(a => a.name), npc = In.parseSheets(consoleText, 'NPCs in Party').map(a => a.name);
  const fromRoster = roster.filter(a => a?.type === 'pc' || a?.type === 'npc').map(a => a.name);
  return { pc: pc[0] || roster.find(a => a?.type === 'pc')?.name || null, members: [...new Set([...pc, ...npc, ...fromRoster].filter(Boolean))], companions: [...new Set([...npc, ...roster.filter(a => a?.type === 'npc').map(a => a.name)])] };
}
function communityAt(region, key) {
  if (!key) return null;
  for (const c of region.communities) if (c.anchor.key === key) return c.id;
  for (const r of region.routes.filter(r => r.status !== 'abandoned')) if (r.footprint?.rooms?.includes(key) || r.cells.includes(key)) return r.communityId;
  return null;
}
// The community whose people would plausibly hear of something here: its own rooms, else the nearest anchor in range.
function nearbyCommunity(region, key) {
  const own = communityAt(region, key); if (own) return own;
  let best = null, d = Infinity;
  for (const c of region.communities) if (c.anchor.key) { const x = cheb(c.anchor.key, key); if (x <= LIMITS.nearbyRange && x < d) { d = x; best = c.id; } }
  return best;
}
// Members: authored and adopted residents of the community, plus anyone recorded in its rooms.
function members(region, cid, idx) {
  const out = new Set(region.residents.filter(r => r.homeCommunityId === cid && !r.goal?.endedBy).map(r => r.name));
  const rooms = new Set(region.routes.filter(r => r.communityId === cid && r.status !== 'abandoned').flatMap(r => [r.anchor]));
  if (idx) for (const p of idx.where.values()) if (rooms.has(p.roomKey) && p.status !== 'dead') out.add(p.name);
  return [...out];
}

// ---------- People (persistent tier and above) ----------
function person(region, name, { reason, turn = null, roomKey = null } = {}) {
  const w = init(region), k = lower(name); if (!k) return null;
  if (!w.people[k]) w.people[k] = { id: 'lwp:' + k, name, tier: 'persistent', since: { reason: reason || 'event', turn, roomKey }, events: [], witnessed: [], promises: [],
    injuries: [], recruitment: null, relationships: [], regionalRole: null, importance: 0, interactions: 0 };
  return w.people[k];
}
const TIER = { persistent: 1, regional: 2, active: 3 };
function raise(p, tier) { if (p && (TIER[tier] || 0) > (TIER[p.tier] || 0) && tier !== 'active') p.tier = tier; return p; }
function note(list, id, max = LIMITS.personEvents) { if (!list.includes(id)) { list.push(id); while (list.length > max) list.shift(); } }

// ---------- World events from verified records ----------
function record(region, ev, notices) {
  const w = init(region);
  if (w.cost.worldFacts >= LIMITS.worldFacts || !Ledger.room(region.ledger, { facts: 1 })) { w.cost.skipped++; guard(region, 'history-full', 'ledger', 'world history reached its bound; later events update people only'); return null; }
  const f = Ledger.append(region.ledger, { kind: ev.kind || 'world-event', writer: ev.writer || 'verified-record', key: ev.key, text: excerpt(ev.text, 300), communityId: ev.communityId || null,
    roomKey: ev.roomKey || null, actors: ev.actors.slice(0, 12), turn: ev.turn, evidence: [{ source: ev.source, id: ev.id, category: ev.category, witnesses: (ev.witnesses || []).slice(0, 16),
      ...(ev.status ? { status: ev.status } : {}), ...(ev.extra || {}) }] });
  if (!f) return null;
  w.cost.worldFacts++; w.cost.ingested++;
  if (ev.notice) notices.push(ev.notice);
  return f;
}
function collect(db, state, region, { turn, party, idx }) {
  const w = init(region), out = [], memberSet = new Set(party.members.map(lower)), named = n => n && idx.where.has(lower(n)) && !memberSet.has(lower(n));
  // 1. Campaign memory: committed state, verified quest gates and dice-adjudicated actions. Narration ('reported') and
  //    speech ('statement') are skipped; dialogue only counts as interaction toward promotion.
  const records = state.getCampaignMemory?.()?.records || [];
  const seenIds = new Set(w.cursor.ids), recorded = new Set(region.ledger.facts.map(f => f.key));
  const full = () => out.length >= LIMITS.ingestPerTurn;
  let high = w.cursor.at;
  for (const r of records) {
    if (full()) break;
    if (!r?.id || seenIds.has(r.id) || recorded.has('mem:' + r.id)) continue;
    seenIds.add(r.id); w.cursor.ids.push(r.id); high = Math.max(high, r.at || 0);
    if (r.kind === 'dialogue' && r.speaker && named(r.speaker) && (r.witnesses || []).some(x => memberSet.has(lower(x)))) {
      const d = w.seen.dialogue[lower(r.speaker)] ||= []; if (!d.includes(r.turn)) { d.push(r.turn); if (d.length > 8) d.shift(); }
      continue;
    }
    if (r.authority !== 'state' && r.authority !== 'adjudicated' || !VERIFIED_MEMORY.has(r.source)) continue;
    const target = (String(r.text).match(/target: ([^;\]]+)/) || [])[1]?.trim();
    const others = [...new Set([...(r.actors || []), ...(r.witnesses || [])].filter(named))];
    let category = null;
    if (r.source === 'verified-quest-gate' || r.kind === 'quest') category = 'main-quest';
    else if (String(r.id).startsWith('transfer:')) category = 'exchange';
    else if (r.kind === 'puzzle' && /\bsolved|complete/i.test(r.text)) category = 'exploration';
    else if (r.source === 'selected-dice-outcome' && named(target)) category = 'interaction';
    if (!category) { w.cost.skipped++; continue; }
    out.push({ key: 'mem:' + r.id, source: 'campaign-memory', id: r.id, category, text: r.text, roomKey: r.roomKey || null, turn: r.turn ?? turn,
      actors: [...new Set([...(r.actors || []), ...(named(target) ? [target] : [])])], witnesses: r.witnesses || [], focus: category === 'interaction' ? [target] : others });
  }
  w.cursor.at = high; if (w.cursor.ids.length > LIMITS.seenIds) w.cursor.ids = w.cursor.ids.slice(-LIMITS.seenIds);
  // 2. Jobs and favors: status changes of the engine's own mission records.
  for (const [key, room] of Object.entries(db)) for (const m of Object.values(room?.minorMissions || {})) {
    if (full()) return out;
    if (!m?.id || !JOB_SOURCES.has(m.source)) continue;
    const before = w.seen.missions[m.id]; if (before === m.status) continue;
    w.seen.missions[m.id] = m.status;
    if (!['accepted', 'completed', 'failed', 'withdrawn'].includes(m.status) || before === undefined && m.status === 'withdrawn') continue;
    const who = m.recipient || m.patron, title = m.title || m.description || 'a task';
    const verb = m.status === 'accepted' ? 'took on' : m.status === 'completed' ? 'completed' : before === 'accepted' ? 'abandoned' : null;
    if (!verb) continue;
    out.push({ key: `job:${m.id}:${m.status}`, source: m.source, id: m.id, category: m.source === 'engine-resident-favor-v1' ? 'favor' : 'job', status: m.status,
      text: `The party ${verb} ${who ? who + "'s request" : 'a job'}: ${excerpt(title, 140)}.`, roomKey: m.roomKey || key, turn, actors: [who].filter(Boolean),
      witnesses: [who, ...party.members].filter(Boolean), focus: [who].filter(Boolean), mission: { id: m.id, title: excerpt(title, 120), status: m.status, recipient: who } });
  }
  // 3. Combat: engine defeat records and survival saves (injuries). The world layer never decides a death.
  const life = db['0,0,0']?.combatLife;
  if (life?.source === 'engine-combat-life-v1') {
    const defeats = Array.isArray(life.defeats) ? life.defeats : [];
    for (const d of defeats.slice(w.seen.defeats)) {
      if (full()) return out;
      const here = [...idx.where.values()].filter(p => p.roomKey === d.roomKey && p.status !== 'dead').map(p => p.name);
      out.push({ key: `defeat:${d.roomKey}:${lower(d.name)}`, source: d.source, id: `${d.roomKey}:${d.name}`, category: 'combat', text: `${d.name} was defeated in ${db[d.roomKey]?.name || 'a room'}.`,
        roomKey: d.roomKey, turn, actors: [d.name], witnesses: [...new Set([...party.members, ...here])], focus: [d.name], defeated: d.name });
      w.seen.defeats++;
    }
    w.seen.defeats = defeats.length;
    for (const [k, a] of Object.entries(life.actors || {})) {
      if (full()) return out;
      if (!a?.save || a.type === 'monster' || w.seen.survivals[k] === a.at || a.save.passed !== true) continue;
      w.seen.survivals[k] = a.at;
      out.push({ key: `survived:${k}:${a.at}`, source: life.source, id: k, category: 'injury', text: `${a.name} was struck down and survived.`, roomKey: a.geoKey || null, turn,
        actors: [a.name], witnesses: party.members, focus: [a.name], injured: a.name });
    }
  }
  // 4. Main quest: the adventure journal's archived, evaluator-completed tasks.
  const journal = (db['0,0,0']?.adventureJournal || []).filter(r => r?.source === 'engine-journal-v1');
  for (const j of journal.slice(w.seen.journal)) {
    if (full()) return out;
    out.push({ key: 'journal:' + j.id, source: j.source, id: j.id, category: 'main-quest',
    text: `The party completed a main quest step: ${excerpt(j.title || j.description, 160)}.`, roomKey: j.facts?.at?.(-1)?.roomKey || null, turn, actors: party.members, witnesses: party.members, focus: [] });
    w.seen.journal++;
  }
  w.seen.journal = journal.length;
  // 5. Exploration: the first committed visit to a room where named people live.
  for (const [key, room] of Object.entries(db)) {
    if (full()) return out;
    if (key === '0,0,0' || room?.visited !== true || w.seen.visited.includes(key)) continue;
    w.seen.visited.push(key); if (w.seen.visited.length > 1024) w.seen.visited.shift();
    const here = [...idx.where.values()].filter(p => p.roomKey === key && p.status !== 'dead').map(p => p.name);
    if (!here.length && !communityAt(region, key)) continue;
    out.push({ key: 'visit:' + key, source: 'room-record', id: key, category: 'exploration', text: `The party came to ${room.name || 'a new place'}.`, roomKey: key, turn,
      actors: party.members, witnesses: [...party.members, ...here], focus: [] });
  }
  // 6. Companions: party membership changes (joined through the recruitment system; left).
  const now = party.companions.map(lower).sort(), before = w.seen.party;
  if (before && party.companions.filter(n => !before.includes(lower(n))).length + before.filter(n => !now.includes(n)).length > LIMITS.ingestPerTurn - out.length) return out;
  if (before) {
    for (const n of party.companions) if (!before.includes(lower(n))) out.push({ key: `joined:${lower(n)}:${turn}`, source: 'party-roster', id: n, category: 'companion', text: `${n} joined the party.`, roomKey: null, turn, actors: [n], witnesses: party.members, focus: [n], joined: n });
    for (const k of before) if (!now.includes(k)) { const n = w.people[k]?.name || k; out.push({ key: `left:${k}:${turn}`, source: 'party-roster', id: n, category: 'companion', text: `${n} left the party.`, roomKey: null, turn, actors: [n], witnesses: party.members, focus: [n], left: n }); }
  }
  w.seen.party = now;
  return out;
}
// Applies verified events: history, the people involved, who saw it, and where word of it may travel.
function ingest(db, state, region, { turn = 0, party, idx, notices = [] } = {}) {
  const events = collect(db, state, region, { turn, party, idx }), facts = [];
  for (const ev of events) {
    ev.communityId = nearbyCommunity(region, ev.roomKey);
    const f = record(region, ev, notices);
    if (!f) continue;
    for (const n of ev.focus || []) {
      const p = person(region, n, { reason: ev.category, turn, roomKey: ev.roomKey }); if (!p) continue;
      if (f) note(p.events, f.id); p.importance += ev.category === 'favor' || ev.category === 'job' ? 2 : 1;
      if (ev.mission) { const prior = p.promises.find(x => x.missionId === ev.mission.id); if (prior) prior.status = ev.mission.status; else p.promises.push({ missionId: ev.mission.id, title: ev.mission.title, status: ev.mission.status }); }
      if (ev.injured && lower(ev.injured) === lower(n)) p.injuries.push({ turn, text: ev.text });
      if (ev.defeated && lower(ev.defeated) === lower(n)) p.fallen = { turn, roomKey: ev.roomKey };
      if (ev.joined && lower(ev.joined) === lower(n)) p.recruitment = { status: 'joined', turn };
      if (ev.left && lower(ev.left) === lower(n)) p.recruitment = { status: 'left', turn };
      if (ev.communityId) raise(p, 'regional');
    }
    // Witnesses keep what they saw; background figures stay unregistered, but their sight is kept on the fact.
    if (f) for (const n of ev.witnesses || []) { const p = init(region).people[lower(n)]; if (p) note(p.witnessed, f.id); }
    if (f && ev.communityId) enqueue(region, f, ev.communityId, ev.witnesses?.find(x => members(region, ev.communityId).includes(x)) || null, turn);
    if (f) facts.push({ fact: f, ev });
    // Accepted work tied to someone who fell is reported, never silently dropped.
    if (ev.defeated) for (const m of Object.values(db).flatMap(r => Object.values(r?.minorMissions || {}))) {
      if (m && JOB_SOURCES.has(m.source) && m.status === 'accepted' && lower(m.recipient) === lower(ev.defeated) && !init(region).told.includes('fallen-contact:' + m.id)) {
        init(region).told.push('fallen-contact:' + m.id);
        notices.push(`World record: ${ev.defeated} has fallen. The work you accepted for them (${excerpt(m.title || m.description, 100)}) can no longer be handed to them.`);
      }
    }
  }
  return facts;
}
// Party members and recurring conversation partners are persistent; regional residents are regional.
function promote(db, region, { party, idx, turn }) {
  const w = init(region);
  for (const n of party.members) { const p = person(region, n, { reason: 'party', turn }); p.party = true; }
  for (const p of Object.values(w.people)) if (!party.members.some(n => lower(n) === lower(p.name))) p.party = false;
  for (const [k, turns] of Object.entries(w.seen.dialogue)) if (turns.length >= 3 && idx.where.has(k)) {
    const p = person(region, idx.where.get(k).name, { reason: 'conversation', turn }); p.interactions = turns.length;
  }
  for (const r of region.residents) {
    const p = person(region, r.name, { reason: r.adopted ? 'adopted' : 'authored-resident', turn });
    raise(p, 'regional'); p.regionalRole = { residentId: r.id, communityId: r.homeCommunityId, via: r.adopted ? 'adopted' : 'authored' };
    p.relationships = (r.relationships || []).map(x => ({ with: region.residents.find(o => o.id === x.target)?.name || x.target, kind: x.kind, source: x.source }));
  }
  // Party members travel with the player: they stay persistent (with party status), never a community's regional figure.
  for (const p of Object.values(w.people)) {
    if (p.party) continue;
    const at = idx.where.get(lower(p.name)); if (at && communityAt(region, at.roomKey)) raise(p, 'regional');
    if (p.tier === 'persistent' && Ledger.beliefsOf(region.ledger, p.name).some(b => region.ledger.facts[Number(b.factId.split(':')[1]) - 1]?.communityId)) raise(p, 'regional');
  }
}

// ---------- Knowledge: facts are truth; individual knowledge is witnessing or a belief received through a channel ----------
function knows(region, name, factId) {
  const f = region.ledger.facts[Number(String(factId).split(':')[1]) - 1]; if (!f) return false;
  const n = lower(name);
  return f.actors.some(a => lower(a) === n) || (f.evidence?.[0]?.witnesses || []).some(a => lower(a) === n) || region.ledger.beliefs.some(b => b.factId === f.id && lower(b.holder) === n);
}
function knownBy(region, names, { limit = 4, communityId = undefined } = {}) {
  const set = new Set(names.map(lower)), believed = new Set(region.ledger.beliefs.filter(b => set.has(lower(b.holder))).map(b => b.factId));
  return region.ledger.facts.filter(f => (communityId === undefined || f.communityId === communityId || f.communityId === null) &&
    (believed.has(f.id) || f.actors.some(a => set.has(lower(a))) || (f.evidence?.[0]?.witnesses || []).some(a => set.has(lower(a))))).slice(-limit);
}
// Word travels later, along plausible channels, and only reaches a community when the player is near it again.
function enqueue(region, fact, communityId, from, turn, channel = 'community', delay = LIMITS.hearsayDelay) {
  const w = init(region);
  if (w.pending.some(p => p.factId === fact.id && p.communityId === communityId)) return;
  w.pending.push({ factId: fact.id, communityId, from, channel, dueTurn: (turn || 0) + delay });
  if (w.pending.length > 400) w.pending.shift();
}
function connected(region, cid) {
  const out = new Set();
  for (const r of region.routes.filter(r => r.status !== 'abandoned')) {
    if (r.communityId === cid && r.chainedFrom) out.add(r.chainedFrom);
    if (r.chainedFrom === cid) out.add(r.communityId);
    if (r.communityId === cid && r.gate?.status === 'open') for (const o of region.routes) if (o !== r && o.footprint?.rooms?.includes(r.gate.key)) out.add(o.communityId);
  }
  for (const res of region.residents) for (const t of res.travels || []) if (t.from === cid) out.add(t.to); else if (t.to === cid) out.add(t.from);
  out.delete(cid); return [...out];
}
function hearingAudience(db, region, state, speaker, roomKey, idx = index(db)) {
  const roster = JSON.parse(state?.getCombatCharactersString?.() || '[]');
  const resident = idx.where.get(lower(speaker));
  const companion = roster.find(a => a.name === speaker && ['pc', 'npc'].includes(a.type) && I().canAct(a) && I().roomKey(a.mazeRoomKey) === roomKey);
  const source = resident?.roomKey === roomKey && I().canAct(resident.record) ? resident.record.position :
    companion && { x: companion.mazeX, y: companion.mazeY };
  const coords = Object.fromEntries(roomKey.split(',').map((v, n) => [['x', 'y', 'z'][n], Number(v)]));
  const dungeon = state?.getRoomDungeonForSimulation?.(coords) || state?.getRoomDungeon?.(coords);
  if (!dungeon?.cells || !source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) return [];
  const point = p => ({ x: p.x + .5, y: p.y + .5 });
  return [...idx.where.values()].filter(p => p.roomKey === roomKey && p.name !== speaker && init(region).people[lower(p.name)] &&
    I().canAct(p.record) && p.record.position && Math.hypot(p.record.position.x - source.x, p.record.position.y - source.y) <= 8 &&
    I().hearingClear(dungeon, point(source), point(p.record.position), 8)).map(p => p.name);
}
function share(db, region, state, fact, speaker, roomKey, { turn, idx, limit }) {
  if (!knows(region, speaker, fact.id) || !Ledger.room(region.ledger, { facts: 1 })) return [];
  const audience = hearingAudience(db, region, state, speaker, roomKey, idx).filter(n => !knows(region, n, fact.id)).slice(0, limit);
  if (!audience.length || !Ledger.room(region.ledger, { beliefs: audience.length })) return [];
  const announcement = Ledger.append(region.ledger, { kind: 'initiative', writer: 'initiative',
    key: `news:${fact.id}:${speaker}:${region.ledger.beliefs.length}`, text: `${speaker} shares news: ${fact.text}`, roomKey, communityId: communityAt(region, roomKey),
    actors: [speaker], turn, evidence: [{ source: 'engine-public-news-v1', originFactId: fact.id, witnesses: audience }] });
  if (!announcement) return [];
  for (const holder of audience) Ledger.believe(region.ledger, { factId: fact.id, holder, account: fact.text, channel: 'hearsay', heardFrom: speaker, matchesTruth: true });
  return audience;
}
function activate(db, region, cid, { turn = 0, idx, state } = {}) {
  const w = init(region); w.cost.activations++;
  idx ||= index(db);
  const people = members(region, cid, idx).filter(n => w.people[lower(n)] && idx.where.get(lower(n))?.status === 'present'); let delivered = 0;
  for (const p of w.pending.filter(p => p.communityId === cid && p.dueTurn <= turn)) {
    if (delivered >= LIMITS.propagatePerActivation) break;
    const f = region.ledger.facts[Number(p.factId.split(':')[1]) - 1];
    if (!f) { w.pending.splice(w.pending.indexOf(p), 1); continue; }
    const speaker = people.find(n => knows(region, n, f.id));
    if (!speaker) continue; // A route alone is not evidence that anyone carried the news.
    const at = idx.where.get(lower(speaker));
    delivered += share(db, region, state, f, speaker, at.roomKey, { turn, idx, limit: LIMITS.propagatePerActivation - delivered }).length;
    if (people.some(n => !knows(region, n, f.id))) continue;
    w.pending.splice(w.pending.indexOf(p), 1);
    // Then onward to connected communities, later still.
    if (p.channel === 'community') for (const o of connected(region, cid)) enqueue(region, f, o, people[0] || null, turn, 'connection', LIMITS.hearsayDelay * 2);
  }
  reputation(region, cid, idx);
  return delivered;
}
// Reputation is what a community's own people know about the party, not the whole record.
function reputation(region, cid, idx) {
  const w = init(region), c = region.communities.find(x => x.id === cid); if (!c) return 0;
  // Knowledge comes from living members; what it is about includes anyone of this community, fallen too.
  const folk = members(region, cid, idx), set = new Set([...folk, ...region.residents.filter(r => r.homeCommunityId === cid).map(r => r.name)].map(lower));
  const completed = (region.quests || []).filter(q => q.receipt && region.residents.find(r => r.id === q.residentId)?.homeCommunityId === cid);
  // A trust award, its mission receipt and its consequence are one accomplishment, not three.
  let score = (c.standing || 0) - completed.filter(q => q.consequence?.kind === 'standing').length;
  const credits = new Map();
  const accomplishment = f => {
    const e = f.evidence?.[0] || {}, q = (region.quests || []).find(q => (e.missionId || e.id) && q.missionId === (e.missionId || e.id) ||
      e.goalId && q.goalId === e.goalId || ['fixture:', 'access:', 'standing:'].some(prefix => f.key === prefix + q.id));
    return q ? 'mission:' + (q.missionId || q.goalId) : e.missionId ? 'mission:' + e.missionId :
      ['favor', 'job'].includes(e.category) ? 'mission:' + e.id : f.id;
  };
  for (const f of knownBy(region, folk, { limit: 400 })) {
    const cat = f.evidence?.[0]?.category, about = f.actors.some(a => set.has(lower(a)));
    let d = 0;
    if (f.kind === 'quest-completed' && about) d = 2;
    // Standing facts are already in c.standing; count only the visible changes (landmark restored, passage reopened).
    else if ((f.kind === 'transformation' || (f.kind === 'consequence' && !/^standing:/.test(f.key || ''))) && f.communityId === cid) d = 1;
    else if (cat === 'combat' && about) d = -3;
    else if ((cat === 'favor' || cat === 'job') && about && f.evidence[0].status === 'completed') d = 1;
    else if ((cat === 'favor' || cat === 'job') && about && f.evidence[0].status !== 'accepted' && /abandoned/.test(f.text)) d = -1;
    if (d) {
      const id = accomplishment(f), prior = credits.get(id);
      if (!prior || d > 0 && prior.delta > 0 && d > prior.delta) credits.set(id, { factId: f.id, accomplishment: id, delta: d });
    }
  }
  const basis = [...credits.values()]; score += basis.reduce((total, row) => total + row.delta, 0);
  w.reputation[cid] = { score, basis: basis.slice(-12), closed: score <= -2, trusted: score >= 3 };
  return score;
}
function closedTo(region, cid) { return !!region.world?.reputation?.[cid]?.closed; }

// ---------- Active cast and initiative ----------
function activeCast(db, region, { key, idx, party, open }) {
  const w = init(region), reach = key ? Topology.search(db, key) : new Map(), dist = k => k === key ? 0 : reach.get(k)?.depth ?? Infinity;
  const candidates = [];
  for (const r of region.residents) {
    if (!open(r)) continue;
    const at = r.materialized?.roomKey || region.communities.find(c => c.id === r.communityId)?.anchor.key; const d = at ? dist(at) : Infinity;
    if (d <= LIMITS.activeRadius) candidates.push({ name: r.name, d, importance: (w.people[lower(r.name)]?.importance || 0) + 2, plan: r.goal.id });
  }
  for (const p of Object.values(w.people)) {
    if (p.party || p.regionalRole || p.fallen) continue;
    const at = idx.where.get(lower(p.name)); const d = at ? dist(at.roomKey) : Infinity;
    if (d <= LIMITS.activeRadius && p.importance >= LIMITS.adoptImportance) candidates.push({ name: p.name, d, importance: p.importance, plan: null });
  }
  candidates.sort((a, b) => a.d - b.d || b.importance - a.importance || a.name.localeCompare(b.name));
  w.active = candidates.slice(0, LIMITS.activeCast).map(c => ({ name: c.name, distance: c.d, plan: c.plan }));
  return w.active;
}
// A character who has become important through verified play can take on a regional request of their own. The
// engine fixes the obstacle (an existing built mechanism) and consequence (trust); one model call authors the object.
function adoptionCandidates(db, region, state, { idx, party, key }) {
  const w = init(region); if (w.adoptions.filter(a => a.status !== 'failed').length >= LIMITS.adoptions || region.residents.length >= 10) return [];
  const tasks = JSON.stringify(state.getCurrentTasks?.() || []).toLowerCase();
  const out = [];
  for (const a of w.active) {
    const p = w.people[lower(a.name)]; if (!p || p.regionalRole || p.party || p.fallen || a.plan) continue;
    if (w.adoptions.some(x => lower(x.name) === lower(p.name))) continue;
    const at = idx.where.get(lower(p.name)); if (!at || at.status === 'dead' || at.roomKey === '0,0,0') continue;
    if (require('./residentPlans').active(at.record.residentPlan) || ['queued','running'].includes(at.record.residentPlanRequest?.status)) continue;
    if (p.importance < LIMITS.adoptImportance) continue;
    // Guards: never reassign main-quest people, never stack on accepted work, never a party member.
    if (tasks.includes(lower(p.name))) { guard(region, 'main-quest-person', p.name, 'named in the main quest; keeps that role only'); continue; }
    if (p.promises.some(x => x.status === 'accepted')) { guard(region, 'accepted-work', p.name, 'has accepted work in progress; a new request waits'); continue; }
    if (region.communities.every(c => !c.anchor.key)) continue;
    out.push({ person: p, roomKey: at.roomKey, record: at.record });
  }
  return out.slice(0, 1);
}
function queueAdoption(db, region, { person: p, roomKey, record }, { turn }) {
  const w = init(region), cid = nearbyCommunity(region, roomKey) || region.communities.filter(c => c.anchor.key).sort((a, b) => cheb(a.anchor.key, roomKey) - cheb(b.anchor.key, roomKey))[0]?.id;
  const community = region.communities.find(c => c.id === cid);
  const facts = p.events.map(id => region.ledger.facts[Number(id.split(':')[1]) - 1]?.text).filter(Boolean).slice(-4);
  const a = { id: 'a' + (w.adoptions.length + 1), name: p.name, roomKey, communityId: cid, status: 'queued', tries: 0, queuedAt: Date.now(), turn,
    input: { resident: { name: p.name, history: excerpt(record?.history || record?.profile?.history || record?.motivation || '', 300) }, community: { name: community?.name || 'the region', fixtureName: community?.fixture?.name || 'the landmark' },
      slot: { obstacle: 'mechanism', effect: 'earn-trust' }, facts: facts.length ? facts : [`${p.name} has dealt with the party before.`], previous: 'none yet',
      usedItems: region.residents.flatMap(r => [r.goal.item, ...r.pastGoals.map(g => g.item)]) } };
  w.adoptions.push(a);
  console.info('[LivingWorld]', JSON.stringify({ phase: 'adoption-queued', name: p.name, roomKey, community: community?.name, importance: p.importance }));
  return a;
}
function initiative(db, region, state, { key, turn, notices, moment, lr }) {
  const w = init(region); let used = 0;
  const tell = (id, text, actors, communityId) => {
    if (used >= LIMITS.initiativesPerTurn || w.told.includes(id)) return false;
    w.told.push(id); used++;
    const f = Ledger.append(region.ledger, { kind: 'initiative', writer: 'initiative', key: id, text, communityId: communityId || null, roomKey: key, actors, turn,
      evidence: [{ source: 'living-world', category: 'initiative', witnesses: partyOf(state).members }] });
    if (f) notices.push(text);
    return true;
  };
  for (const a of w.active) {
    const r = region.residents.find(x => x.name === a.name); if (!r || !a.plan) continue;
    const q = region.quests.find(x => x.goalId === r.goal.id);
    const here = r.materialized?.roomKey === key, placed = ['sealed', 'bound', 'released'].includes(r.goal.objective?.status);
    // Seeks the party out: placed request, party in their room on a later visit, not yet taken on.
    const waiting = q && q.channel !== 'delivery' && db[q.roomKey]?.minorMissions?.[q.missionId]?.status === 'offered';
    if (here && placed && moment && waiting && (w.initiative[r.id]?.visits || 0) >= 1)
      tell('approach:' + r.goal.id, `${r.name} seeks you out: ${r.goal.text}`, [r.name], r.homeCommunityId);
    if (here && moment) (w.initiative[r.id] ||= { visits: 0 }).visits++;
    // Follows up on accepted work that has waited a long time (no penalty).
    const accepted = q && db[q.roomKey]?.minorMissions?.[q.missionId]?.status === 'accepted';
    if (accepted) { const s = w.initiative['q:' + q.id] ||= { since: turn }; if (turn - s.since >= LIMITS.followUpTurns && moment) tell('follow-up:' + q.id, `${r.name} sends word asking after ${r.goal.item}; the request still stands.`, [r.name], r.homeCommunityId); }
  }
  // A trusted community points the party to another community it is connected with.
  for (const c of region.communities) {
    if (!w.reputation[c.id]?.trusted || !moment || communityAt(region, key) !== c.id) continue;
    for (const o of region.communities.filter(o => o.id !== c.id && !region.ledger.facts.some(f => f.key === 'discovery:' + o.id))) {
      const path = o.anchor.key && Topology.directions(db, o.anchor.key, key);
      const speaker = region.residents.find(r => r.homeCommunityId === c.id && !r.goal.endedBy)?.name || c.name;
      if (tell('vouch:' + c.id + ':' + o.id, path ? `${speaker} tells you how to reach ${o.name}: go ${path.map(p => p.dir).join(', then ')}.` :
        `${speaker} tells you of ${o.name}, beyond the ways you have opened so far; its need: ${excerpt(o.need, 120)}.`, [speaker], c.id)) {
        for (const n of partyOf(state).members) { const f = region.ledger.facts.at(-1); if (f && !knows(region, n, f.id)) Ledger.believe(region.ledger, { factId: f.id, holder: n, account: f.text, channel: 'hearsay', heardFrom: speaker, matchesTruth: true }); }
      }
      break;
    }
  }
}
// Companions act on their own stakes when the party brings them to that community, and carry news when the party rests.
function companions(db, region, state, { key, turn, notices, moments, party, arrivedAt = null }) {
  const w = init(region), here = communityAt(region, key);
  for (const t of region.companionThreads.filter(t => t.status === 'open')) {
    if (!party.companions.some(n => lower(n) === lower(t.companion)) || t.communityId !== here || (arrivedAt !== here && !moments.some(m => m.communityId === here))) continue;
    const c = region.communities.find(x => x.id === here), positive = ['relative', 'promise', 'debt'].includes(t.kind);
    t.status = 'acted'; t.actedAt = turn;
    if (positive) c.standing = (c.standing || 0) + 1;
    const f = Ledger.append(region.ledger, { kind: 'companion', writer: 'companion', key: 'companion:' + t.id, text: `${t.companion} came to ${c.name} with the party (${t.kind}): ${excerpt(t.stake, 160)}`,
      communityId: c.id, roomKey: key, actors: [t.companion], turn, evidence: [{ source: 'party-roster', category: 'companion', witnesses: party.members }] });
    if (f) notices.push(`${t.companion} acts on a personal stake in ${c.name} (${t.kind}).${positive ? ` ${c.name} warms to the party because ${t.companion} is with you.` : ''}`);
    // The companion learns the community's own history.
    for (const h of region.ledger.facts.filter(x => x.kind === 'history' && x.communityId === c.id))
      if (!knows(region, t.companion, h.id) && Ledger.room(region.ledger, { beliefs: 1 })) Ledger.believe(region.ledger, { factId: h.id, holder: t.companion, account: h.text, channel: 'hearsay', heardFrom: c.name, matchesTruth: true });
  }
  // Resting in a community: the party's companions tell what they witnessed that concerns the region.
  if (here && moments.some(m => m.kind === 'rest' && m.communityId === here)) {
    const idx = index(db), teller = party.companions[0];
    if (!teller) return;
    let told = 0;
    for (const f of knownBy(region, party.companions, { limit: 60 }).reverse()) {
      if (told >= LIMITS.partyNews) break;
      if (f.communityId && f.communityId !== here && !connected(region, here).includes(f.communityId) && f.evidence?.[0]?.category !== 'main-quest') continue;
      const speaker = party.companions.find(n => knows(region, n, f.id));
      if (speaker) told += share(db, region, state, f, speaker, key, { turn, idx, limit: LIMITS.partyNews - told }).length;
    }
    if (told) (w.companions[teller] ||= { toldNews: 0 }).toldNews += told;
  }
}

// ---------- Per turn ----------
// Cheap: one scan of authoritative records; model calls are never made here (adoption is only queued).
function step(db, region, state, { key, turn = 0, notices = [], moments = [], arrivedAt = null, consoleText, touched = new Set(), lr }) {
  const w = init(region); w.cost.steps++;
  const party = partyOf(state, consoleText); let idx = index(db);
  if (idx.duplicates.length && !w.told.includes('dup:' + idx.duplicates.map(d => d.name).join('|'))) {
    w.told.push('dup:' + idx.duplicates.map(d => d.name).join('|'));
    console.warn('[LivingWorld]', JSON.stringify({ phase: 'identity-conflict', duplicates: idx.duplicates }));
  }
  w.audit = { duplicates: idx.duplicates.slice(0, 8), at: turn };
  const facts = ingest(db, state, region, { turn, party, idx, notices });
  const Plans = require('./residentPlans'), actions = Plans.tick(state, db, region, { turn, key, touched, notices, publishChanges:false });
  if (actions.length) idx = index(db);
  promote(db, region, { party, idx, turn });
  activeCast(db, region, { key, idx, party, open: r => lr.open(region, r) });
  // Distant communities stay as they were; only those near the player are brought up to date.
  const near = new Set([communityAt(region, key), ...w.active.map(a => region.residents.find(r => r.name === a.name)?.homeCommunityId)].filter(Boolean));
  for (const cid of near) activate(db, region, cid, { turn, idx, state });
  // Meaningful moments: travel, rest, quest completion, arriving in a community, or a newly verified event.
  const meaningful = moments.length > 0 || facts.length > 0 || !!arrivedAt;
  initiative(db, region, state, { key, turn, notices, moment: meaningful, lr });
  companions(db, region, state, { key, turn, notices, moments, party, arrivedAt });
  const planned = Plans.queue(state, db, region, { turn, meaningful, key });
  if (planned) touched.add(planned.roomKey);
  const queued = meaningful ? adoptionCandidates(db, region, state, { idx, party, key }).map(c => queueAdoption(db, region, c, { turn })) : [];
  return { facts: facts.length, active: w.active, queued: queued.map(a => a.name), actions, planQueued: planned?.name || null };
}
function promptFor(db, region, state, key) {
  const w = region.world; if (!w) return null;
  const idx = index(db), here = [...idx.where.values()].filter(p => p.roomKey === key && p.status !== 'dead').map(p => p.name);
  const cid = communityAt(region, key);
  const known = here.slice(0, 4).map(n => ({ name: n, knows: knownBy(region, [n], { limit: 3 }).map(f => excerpt(f.text, 160)) })).filter(x => x.knows.length);
  return { active: w.active.map(a => ({ name: a.name, pursuing: region.residents.find(r => r.name === a.name && r.goal?.id === a.plan)?.goal.text || null })).filter(a => a.pursuing),
    residentActivities: [...idx.where.values()].filter(a => a.roomKey === key && a.record.residentPlan && a.record.encounteredAt > 0).slice(0,4)
      .map(a => ({ name:a.name, activity:a.record.residentPlan.activity, status:a.record.residentPlan.status })),
    ...(cid ? { reputation: w.reputation[cid] ? { score: w.reputation[cid].score, closed: w.reputation[cid].closed, trusted: w.reputation[cid].trusted } : null } : {}),
    knowledge: known, rule: 'Each person knows only what is listed for them (seen or heard); others have not heard. Do not make anyone know more, and do not turn rumours into new facts.' };
}
function summary(region) {
  const w = region.world; if (!w) return null;
  const tiers = { persistent: 0, regional: 0 }; for (const p of Object.values(w.people)) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
  return { people: Object.keys(w.people).length, tiers, active: w.active, pending: w.pending.length, reputation: w.reputation, adoptions: w.adoptions.map(a => ({ name: a.name, status: a.status })),
    guards: w.guards.slice(-8), cost: w.cost, duplicates: w.audit?.duplicates || [] };
}
module.exports = { VERSION, LIMITS, init, index, partyOf, communityAt, nearbyCommunity, members, person, collect, ingest, promote, knows, knownBy, enqueue, connected, hearingAudience, share,
  activate, reputation, closedTo, activeCast, adoptionCandidates, queueAdoption, initiative, companions, step, promptFor, summary, count, guard };
