'use strict';
// world1 per-room recurring cast. A "level" is one room (Flags.levelKey). Generated lazily on first entry,
// inside the SAME inhabitant request (no extra model call), fresh for every game, saved with the room so it
// recurs on every revisit of that room. Arcs become real minor missions that point to nearby rooms.
const Flags = require('./worldFlags');
const Memory = require('./crossGameMemory');
const Pantheon = require('../assets/pantheonCharacters');
const MAX_MEMBERS = 3, MAX_ARCS = 2, STAGES_MIN = 3, STAGES_MAX = 5;
const REVISIT_GAP_MS = 60000;
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function enabled() { return Flags.on('LEVEL_CAST'); }
// Seeded deity choices so each room's people care about different gods; Mortacia dominates only near the temple.
function patrons(runId, geoKey) {
  const c = String(geoKey).split(',').map(Number), distance = Math.max(Math.abs(c[0] || 0), Math.abs(c[1] || 0));
  const pool = Pantheon.names.filter(n => n !== 'Nameless Drake');
  const picks = [];
  if (distance <= 1) picks.push('Mortacia');
  for (let i = 0; picks.length < 3 && i < 40; i++) { const n = pool[hash(`${runId}:${geoKey}:patron:${i}`) % pool.length]; if (!picks.includes(n)) picks.push(n); }
  return picks;
}
function promptBlock({ runId, geoKey, nearbyRooms = [] }) {
  if (!enabled()) return '';
  const gods = patrons(runId, geoKey).map(n => { const c = Pantheon.canon(n); return `${n} (${c?.obligation?.[0] || c?.domain || ''})`; });
  const avoidNames = Memory.avoid(runId, 'names', 40), avoidPremises = Memory.avoid(runId, 'premises', 30);
  return `RECURRING ROOM CAST (new for this game): choose 1-${MAX_MEMBERS} non-hostile residents as recurring people. They live or work in THIS room and will be met again on every return visit, so give each 2-3 distinct interests (trade, faith, family, scholarship, craft, rivalry, debt, art, food, ritual...), different from each other.
Also write 1-${MAX_ARCS} arcs: small multi-visit quests owned by a recurring person (giver = exact name). Each arc has ${STAGES_MIN}-${STAGES_MAX} short stage lines in order (meeting, request, complication, return, resolution) and a destinationHint naming ONE nearby room from: ${nearbyRooms.slice(0, 8).map(r => r.name).join('; ') || 'any neighbouring room'}.
${localBlock()}Their faiths and worries draw on these deities: ${gods.join('; ')}.
Do not reuse these names from earlier games: ${avoidNames.join(', ') || 'none'}. Do not reuse these quest premises: ${avoidPremises.join(' | ') || 'none'}.`;
}
// QUEST_LOCAL: arcs begin inside the giver's own room; QUEST_REVEALS: the giver marks what they would plausibly know on the level map.
const REVEAL_KINDS = ['objective', 'landmark', 'route', 'passage', 'shrine', 'cache', 'danger'];
const ROLE_REVEALS = [[/priest|cleric|acolyte|oracle|monk|nun|templar|devot/i, 'shrine', 'a shrine they tend'], [/smuggl|thief|rogue|fence|bandit/i, 'passage', 'a hidden passage they use'],
  [/guard|soldier|warden|captain|sentry|knight/i, 'danger', 'a watch post and the danger it watches'], [/merchant|trader|vendor|peddler|shop/i, 'route', 'the trade route they walk'],
  [/scholar|sage|scribe|mage|wizard|archiv/i, 'landmark', 'an inscribed landmark they studied'], [/hunter|ranger|scout|guide/i, 'route', 'a safe trail']];
function roleReveal(job) { const hit = ROLE_REVEALS.find(([re]) => re.test(String(job || ''))); return hit ? { kind: hit[1], label: hit[2] } : { kind: 'landmark', label: 'a landmark they know' }; }
function localBlock() {
  const parts = [];
  if (Flags.on('QUEST_REWARDS')) parts.push('Rate each arc difficulty: easy, normal, hard or deadly (danger and effort, not length).');
  if (Flags.on('QUEST_LOCAL')) parts.push('Each arc STARTS LOCAL: its first 1-2 stages (localStages) happen inside this same room, at a named spot of its wider geography (localSpot: a shrine, ledge, cistern, side hall, grove...). Only later stages travel to the destination.');
  if (Flags.on('QUEST_REVEALS')) parts.push("When the giver hands over the quest they mark map information on the hero's map: 1-3 reveals {kind: objective|landmark|route|passage|shrine|cache|danger, label, why} that reflect the giver's own role and knowledge (a priest marks a shrine, a smuggler a hidden passage). Never reveal the whole room.");
  return parts.length ? parts.join('\n') + '\n' : '';
}
function extraFields(Contracts) {
  return { ...(Flags.on('QUEST_REWARDS') ? { difficulty: Contracts.choice(['easy', 'normal', 'hard', 'deadly']) } : {}), ...(Flags.on('QUEST_LOCAL') ? { localStages: { type: Number, enum: [1, 2] }, localSpot: Contracts.nonblankText(80) } : {}),
    ...(Flags.on('QUEST_REVEALS') ? { reveals: { type: Contracts.list({ kind: Contracts.choice(REVEAL_KINDS), label: Contracts.nonblankText(80), why: Contracts.nonblankText(140) }), minItems: 1, maxItems: 3 } } : {}) };
}
// One small, separate request on first entry (cheap model, bounded tokens). Failure is non-fatal: the room simply has no cast.
async function generate($, { runId, geoKey, roomName, population, nearbyRooms = [] }) {
  if (!enabled() || !population?.actors || typeof $?.assistant?.generation !== 'function') return null;
  const Contracts = require('./generationContracts');
  const residents = Object.values(population.actors).filter(a => a.allegiance !== 'Hostile' && a.status !== 'gone').slice(0, 8);
  if (!residents.length) return null;
  const names = residents.map(actor => actor.name), destinations = [...new Set(nearbyRooms.slice(0, 8).map(room => room.name).filter(Boolean))];
  await $.user`${promptBlock({ runId, geoKey, nearbyRooms })}
Room: ${roomName}. Choose the recurring people ONLY from these existing residents (exact names): ${residents.map(a => `${a.name} (${a.race || ''} ${a.job || a.className || ''})`).join('; ')}.
Return JSON only: {"members":[{"name":"exact resident name","interests":["...","..."]}],"arcs":[{"title":"...","premise":"...","giver":"exact member name","stages":["...","...","..."],"destinationHint":"nearby room name"${Flags.on('QUEST_REWARDS') ? ',"difficulty":"easy|normal|hard|deadly"' : ''}${Flags.on('QUEST_LOCAL') ? ',"localStages":1,"localSpot":"spot in this room"' : ''}${Flags.on('QUEST_REVEALS') ? ',"reveals":[{"kind":"shrine","label":"...","why":"..."}]' : ''}}]}`;
  const result = await Contracts.request($, { component: 'room-cast', context: { geoKey }, maxTokens: 900,
    localWork: { brief: `${promptBlock({ runId, geoKey, nearbyRooms })} Room: ${roomName}, coordinates: ${geoKey}. Choose ONLY from existing non-hostile residents: ${JSON.stringify(residents.map(actor => ({ name: actor.name, race: actor.race, job: actor.job })))}. Preserve accepted members and their exact names when writing arcs. Each stage is a future possibility, not a completed event.`,
      arrays: { members: { min: 1, max: 3, batch: 1 }, arcs: { min: 1, max: 2, batch: 1 }, interests: { min: 2, max: 3 }, stages: { min: 3, max: 5 }, reveals: { min: 1, max: 3, batch: 1 } } },
    parameters: { members: { type: Contracts.list({ name: Contracts.choice(names), interests: { type: [Contracts.nonblankText(40)], minItems: 2, maxItems: 3 } }), minItems: 1, maxItems: Math.min(MAX_MEMBERS, residents.length) },
      arcs: { type: Contracts.list({ title: Contracts.nonblankText(70), premise: Contracts.nonblankText(220), giver: Contracts.choice(names),
        stages: { type: [Contracts.nonblankText(160)], minItems: STAGES_MIN, maxItems: STAGES_MAX },
        destinationHint: destinations.length ? Contracts.choice(destinations) : Contracts.nonblankText(90), ...extraFields(Contracts) }), minItems: 1, maxItems: MAX_ARCS } },
    validate: parsed => {
      const validText = value => typeof value === 'string' && !!value.trim();
      if (!Array.isArray(parsed?.members) || parsed.members.length < 1 || parsed.members.length > Math.min(MAX_MEMBERS, residents.length))
        throw Error('members: choose 1-3 distinct exact resident names.');
      const selected = new Set();
      for (const member of parsed.members) {
        if (!names.includes(member?.name) || selected.has(member.name)) throw Error('members: unknown or duplicate resident name.');
        selected.add(member.name);
        if (!Array.isArray(member.interests) || member.interests.length < 2 || member.interests.length > 3 || member.interests.some(value => !validText(value)))
          throw Error('interests: each member needs 2-3 nonblank interests.');
      }
      if (!Array.isArray(parsed.arcs) || parsed.arcs.length < 1 || parsed.arcs.length > MAX_ARCS) throw Error('arcs: author 1-2 arcs.');
      for (const arc of parsed.arcs) {
        if (!selected.has(arc?.giver)) throw Error('arcs.giver: choose an exact name from the selected members.');
        if (!Array.isArray(arc.stages) || arc.stages.length < STAGES_MIN || arc.stages.length > STAGES_MAX || arc.stages.some(value => !validText(value)))
          throw Error('arcs.stages: author 3-5 nonblank ordered stages.');
        if (destinations.length && !destinations.includes(arc.destinationHint)) throw Error('arcs.destinationHint: choose an exact supplied nearby room name.');
        if (Memory.collides(runId, 'premises', arc.premise)) throw Error('arcs.premise: author a new premise, not one from an earlier game.');
        if (Flags.on('QUEST_LOCAL') && (!Number.isInteger(arc.localStages) || arc.localStages < 1 || arc.localStages > Math.min(2, arc.stages.length - 2)))
          throw Error('arcs.localStages: choose 1-2 local stages, leaving at least two later stages.');
      }
      return accept(parsed, residents, { runId });
    } });
  if (result.value) population.roomCast = result.value;
  return result.value || null;
}
// Runs in its own short conversation so it never adds turns to the main Grave Master story.
async function generateIsolated(state, args) {
  if (!enabled() || process.env.NODE_TEST_CONTEXT && process.env.HOLODEK_LEVEL_CAST !== '1') return null;
  const runtime = require('./graveMasterProtocol').runtimeFor(state);
  return runtime.run(runtime.retort(async $ => { $.model = 'gpt-4.1-mini'; $.temperature = .9;
    await $.system`You plan recurring local characters for Children of the Grave, an underworld adventure in Tartarus. Answer through the requested JSON function only.`;
    return generate($, args); }));
}
// Bound and validate the model's choices; a bad arc is dropped rather than failing the room.
function accept(parsed, residents, { runId } = {}) {
  if (!enabled()) return null;
  const byName = new Map(residents.filter(a => a && a.allegiance !== 'Hostile' && a.status !== 'gone').map(a => [String(a.name).toLowerCase(), a]));
  const members = (Array.isArray(parsed?.members) ? parsed.members : []).filter(m => byName.has(String(m?.name || '').toLowerCase()))
    .slice(0, MAX_MEMBERS).map(m => ({ name: byName.get(String(m.name).toLowerCase()).name, interests: (m.interests || []).slice(0, 3).map(x => String(x).slice(0, 40)) }));
  if (!members.length) throw Error('members: choose 1-3 exact resident names.');
  const names = new Set(members.map(m => m.name.toLowerCase()));
  const arcs = (Array.isArray(parsed?.arcs) ? parsed.arcs : []).filter(a => a && names.has(String(a.giver || '').toLowerCase()) &&
    Array.isArray(a.stages) && a.stages.length >= STAGES_MIN && !Memory.collides(runId, 'premises', a.premise))
    .slice(0, MAX_ARCS).map((a, i) => ({ id: `arc-${i}`, title: String(a.title).slice(0, 70), premise: String(a.premise).slice(0, 220),
      giver: members.find(m => m.name.toLowerCase() === String(a.giver).toLowerCase()).name,
      stages: a.stages.slice(0, STAGES_MAX).map(x => String(x).slice(0, 160)), destinationHint: String(a.destinationHint || '').slice(0, 90), stage: 0, ...localFields(a, residents) }));
  return { version: Flags.VERSION, runId, members, arcs, visits: 1, history: [] };
}
function localFields(a, residents) {
  const out = {}, stages = Math.min(STAGES_MAX, a.stages.length);
  if (Flags.on('QUEST_REWARDS')) out.difficulty = DIFFICULTY[String(a.difficulty || '').toLowerCase()] ? String(a.difficulty).toLowerCase() : 'normal';
  if (Flags.on('QUEST_LOCAL')) { out.localStages = Math.max(1, Math.min(2, stages - 2, Math.round(Number(a.localStages)) || 1)); out.localSpot = String(a.localSpot || 'a quiet corner of this room').slice(0, 80); }
  if (Flags.on('QUEST_REVEALS')) {
    const giver = residents.find(r => String(r.name).toLowerCase() === String(a.giver).toLowerCase());
    const role = roleReveal(giver?.job || giver?.className || giver?.role), seen = new Set();
    out.reveals = [role, ...(Array.isArray(a.reveals) ? a.reveals : [])].filter(r => r && REVEAL_KINDS.includes(String(r.kind).toLowerCase()))
      .map(r => ({ kind: String(r.kind).toLowerCase(), label: String(r.label || r.kind).slice(0, 80), why: String(r.why || '').slice(0, 140) }))
      .filter(r => !seen.has(r.kind + r.label) && seen.add(r.kind + r.label)).slice(0, 3);
  }
  return out;
}
// QUEST_REWARDS: pay scales with difficulty, stage count and travel distance, capped against the local economy
// (12 healing potions' worth, adjusted by the giver room's market demand; 12-48 silver). Off: the original 3 silver.
const DIFFICULTY = { easy: 1, normal: 1.5, hard: 2.5, deadly: 4 };
function rewardCap(room) {
  const potion = require('../assets/economyRules').PRICES.potion, d = room?.market?.version === Flags.VERSION ? Object.values(room.market.demand || {}) : [];
  const factor = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 1;
  return Math.max(12, Math.min(48, Math.round(12 * potion * factor)));
}
function reward({ difficulty = 'normal', stages = 3, distance = 1, room } = {}) {
  if (!Flags.on('QUEST_REWARDS')) return 3;
  const raw = 3 * (DIFFICULTY[difficulty] || 1.5) + 2 * Math.max(0, stages - 3) + 1.5 * Math.max(0, distance);
  return Math.max(3, Math.min(rewardCap(room), Math.round(raw)));
}
function distanceBetween(a, b) { const p = String(a).split(',').map(Number), q = String(b).split(',').map(Number); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) + Math.abs(p[2] - q[2]); }
function nearest(db, geoKey, hint) {
  const c = geoKey.split(',').map(Number), h = String(hint || '').toLowerCase();
  const rooms = Object.entries(db).filter(([k, r]) => k !== geoKey && r?.name && k.split(',')[2] === String(c[2]))
    .map(([k, r]) => { const d = k.split(',').map(Number); return { key: k, room: r, d: Math.max(Math.abs(d[0] - c[0]), Math.abs(d[1] - c[1])) }; })
    .sort((a, b) => a.d - b.d);
  return rooms.find(r => h && r.room.name.toLowerCase().includes(h.split(/\s+/)[0])) || rooms[0] || null;
}
function nearbyRooms(db, geoKey) {
  const c = geoKey.split(',').map(Number);
  return Object.entries(db).filter(([k, r]) => k !== geoKey && r?.name).map(([k, r]) => { const d = k.split(',').map(Number);
    return { key: k, name: r.name, d: Math.abs(d[0] - c[0]) + Math.abs(d[1] - c[1]) + Math.abs(d[2] - c[2]) }; }).sort((a, b) => a.d - b.d).slice(0, 7)
    .concat((() => { const city = require('./campaignMap').nearestCity(db, geoKey); return city?.roomKey && city.roomKey !== geoKey ? [{ key: city.roomKey, name: city.name, d: 99, city: true }] : []; })());
}
// Install on first entry: tag actors, write room-local history, turn each arc into a minor mission.
function install(db, geoKey, population, runId) {
  const cast = population?.roomCast, room = db[geoKey];
  if (!cast || !room) return null;
  for (const m of cast.members) { const a = population.actors[m.name]; if (a) { a.recurring = true; a.castInterests = m.interests; } }
  room.localHistory = { version: Flags.VERSION, runId, entries: [{ at: Date.now(), text: `First visit: met ${cast.members.map(m => m.name).join(', ')}.` }] };
  room.minorMissions ||= {};
  for (const arc of cast.arcs) {
    const target = nearest(db, geoKey, arc.destinationHint), giver = population.actors[arc.giver];
    if (!target || !giver) continue;
    const pay = reward({ difficulty: arc.difficulty, stages: arc.stages.length, distance: distanceBetween(geoKey, target.key), room });
    const id = `arc:${geoKey}:${arc.id}`, item = `${arc.title.toLowerCase().replace(/[^a-z ]/g, '').slice(0, 40)} token ${hash(runId + id).toString(36).slice(0, 4)}`;
    target.room.objects ||= [];
    if (!target.room.objects.some(o => o.minor_mission_id === id)) target.room.objects.push({ name: item, type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0,
      minor_mission_id: id, description: `${arc.premise} Bring it to ${giver.name} in ${room.name}.` });
    room.minorMissions[id] = { id, source: 'world1-room-arc', status: 'offered', recipient: giver.name, originalRecipient: giver.name, item,
      sourceRoomKey: target.key, sourceRoomName: target.room.name, roomKey: geoKey, roomName: room.name, faction: arc.title,
      rewardSilver: pay, escrowSilver: pay, difficulty: arc.difficulty || 'normal', rewardItem: null, escrowItems: [], arcId: arc.id,
      description: `${arc.title}: recover ${item} from ${target.room.name} and give it to ${giver.name} in ${room.name}. Payment: ${pay} silver pieces.` };
    const local = Number.isInteger(arc.localStages) && Flags.on('QUEST_LOCAL');
    room.minorMissions[id].arc = { title: arc.title, giver: giver.name, stages: arc.stages, stage: arc.stage, localStages: local ? arc.localStages : 0,
      localSpot: local ? arc.localSpot : null, giverRoomKey: geoKey, targetKey: target.key, targetName: target.room.name };
    syncObjective(room.minorMissions[id]);
    if (Array.isArray(arc.reveals) && Flags.on('QUEST_REVEALS')) {
      room.mapReveals ||= {};
      room.mapReveals[id] = { version: Flags.VERSION, giver: giver.name, revealed: false, items: [
        ...(local ? [{ kind: 'objective', label: arc.localSpot, why: arc.title, roomKey: geoKey }] : []),
        ...arc.reveals.map(r => ({ ...r, roomKey: geoKey })), { kind: 'route', label: `Way to ${target.room.name}`, why: arc.title, roomKey: geoKey, towardKey: target.key }] };
    }
    arc.missionId = id; arc.targetKey = target.key;
    giver.minorMissionId ||= id;
    const firstLine = room.minorMissions[id].arc?.localStages ? `${arc.stages[0]} It starts here, at ${arc.localSpot}.` : arc.stages[0];
    giver.dialogue = [firstLine, ...(giver.dialogue || [])].slice(0, 6);
  }
  Memory.record(runId, 'names', cast.members.map(m => m.name));
  Memory.record(runId, 'premises', cast.arcs.map(a => a.premise));
  Memory.persist(db); // history travels with the save
  return cast;
}
// Revisit: advance each arc a stage (or to resolution when its mission is done) and remember the visit locally.
function revisit(db, geoKey, population, now = Date.now()) {
  const cast = population?.roomCast, room = db?.[geoKey];
  if (!cast || cast.version !== Flags.VERSION || !room) return false;
  if (cast.lastSeen && now - cast.lastSeen < REVISIT_GAP_MS) { cast.lastSeen = now; return false; }
  const first = !cast.lastSeen; cast.lastSeen = now;
  if (first) return false;
  cast.visits++;
  for (const arc of cast.arcs) {
    const mission = room.minorMissions?.[arc.missionId];
    if (mission?.arc) arc.stage = Math.max(arc.stage, mission.arc.stage);
    const done = mission?.status === 'completed';
    if (!done && mission?.arc?.localStages && arc.stage < mission.arc.localStages) continue; // local stages advance on foot, at the spot
    const next = done ? arc.stages.length - 1 : Math.min(arc.stages.length - 2, arc.stage + 1);
    if (next === arc.stage) continue;
    arc.stage = next; if (mission?.arc) { mission.arc.stage = next; syncObjective(mission); }
    const giver = population.actors[arc.giver];
    if (giver && giver.status === 'present') { giver.dialogue = [arc.stages[next], ...(giver.dialogue || []).filter(l => !arc.stages.includes(l))].slice(0, 6); giver.dialogueIndex = 0; }
  }
  room.localHistory ||= { version: Flags.VERSION, entries: [] };
  room.localHistory.entries.push({ at: now, text: `Visit ${cast.visits}: ${cast.arcs.map(a => `${a.title} - ${a.stages[a.stage]}`).join('; ') || 'the residents remember you.'}` });
  room.localHistory.entries = room.localHistory.entries.slice(-12);
  return true;
}
// Objective for the map: local stages point at the spot in the giver's room, later ones at the destination room.
function syncObjective(mission) {
  const a = mission?.arc; if (!a) return null;
  const local = a.stage < a.localStages;
  mission.objective = { name: a.title, step: a.stages[a.stage], roomKey: local ? a.giverRoomKey : a.stage >= a.stages.length - 1 ? a.giverRoomKey : a.targetKey,
    spot: local ? a.localSpot : null, local, stage: a.stage, of: a.stages.length };
  return mission.objective;
}
function findMission(db, missionId) { for (const [key, room] of Object.entries(db || {})) if (room?.minorMissions?.[missionId]) return { key, room, mission: room.minorMissions[missionId] }; return null; }
// The hero reached the local spot on foot: advance one local stage. Later stages still need travel.
function reachObjective(db, geoKey, missionId) {
  const hit = findMission(db, missionId), m = hit?.mission;
  if (!Flags.on('QUEST_LOCAL') || !m?.arc || m.status === 'completed' || m.arc.giverRoomKey !== geoKey || m.arc.stage >= m.arc.localStages) return null;
  m.arc.stage++; const objective = syncObjective(m);
  hit.room.localHistory ||= { version: Flags.VERSION, entries: [] };
  hit.room.localHistory.entries.push({ at: Date.now(), text: `${m.arc.title}: ${m.arc.stages[m.arc.stage - 1]} (done at ${m.arc.localSpot}).` });
  hit.room.localHistory.entries = hit.room.localHistory.entries.slice(-12);
  return objective;
}
// The giver hands over the quest: their map marks become visible. Returns the line the giver says.
function onAccepted(db, mission) {
  const hit = findMission(db, mission?.id), reveal = hit?.room?.mapReveals?.[mission?.id];
  if (!Flags.on('QUEST_REVEALS') || !reveal || reveal.revealed) return '';
  reveal.revealed = true; reveal.at = Date.now();
  return `${reveal.giver} marks your map: ${reveal.items.map(i => i.label).join('; ')}.`;
}
function describe(room) {
  const h = room?.localHistory?.entries; return h?.length ? `Local history of this room (this game): ${h.slice(-4).map(e => e.text).join(' ')}` : '';
}
module.exports = { reward, rewardCap, DIFFICULTY, reachObjective, onAccepted, syncObjective, roleReveal, enabled, patrons, promptBlock, generate, generateIsolated, accept, install, revisit, describe, nearbyRooms, MAX_MEMBERS, MAX_ARCS };
