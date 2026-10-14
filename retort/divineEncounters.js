'use strict';
const I = require('../assets/dungeonInhabitants');
const P = require('../assets/pantheonCharacters');
const R = require('../assets/economyRules');
const Profiles = require('../assets/characterProfiles');
const Contracts = require('./generationContracts');
const Diagnostics = require('./generationDiagnostics');
const { formatStartingCharacterSheet } = require('./initialGameState');
const field = (s, k) => String(s || '').match(new RegExp('^' + k + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
const SOURCE = 'engine-divine-court-v1';
function court(db, runId) {
  db['0,0,0'] ||= {};
  if (db['0,0,0'].divineCourt?.runId !== runId) db['0,0,0'].divineCourt = {
    version: 1, source: SOURCE, runId, rooms: [], actors: {}, appearances: [] };
  return db['0,0,0'].divineCourt;
}
function finalStage(text) {
  return ['Artifacts Found', 'Quests Achieved'].every(label => {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(field(text, label));
    return m && Number(m[2]) > 1 && Number(m[1]) >= Number(m[2]) - 1;
  });
}
function finalRoom(db, geoKey, text) {
  const room = db[geoKey];
  return geoKey !== '0,0,0' && /^(?:the )?throne room (?:of|in) hades$/i.test(room?.name || '') && finalStage(text) &&
    P.name(field(text, 'Next Boss')) === 'Arithus' && I.roomKey(field(text, 'Boss Room Coordinates')) === geoKey;
}
function sheet(record) {
  const birth = record.birth;
  return formatStartingCharacterSheet({ ...birth, HP: record.hp, MaxHP: birth.MaxHP }, 6, 'monster')
    .replace(/^([ \t]*State:)[^\r\n]*/m, (_, head) => head + ' ' + I.state(record));
}
function create(name, runId, index, pcName) {
  const c = P.canon(name), hp = name === 'Arithus' ? 500 : 300 + I.hash(runId + ':' + name + ':hp') % 201;
  const birth = { Name: name, Sex: /Lady|Mother|Mistress|Goddess/.test(c.epithets) ? 'Female' : 'Unknown',
    Race: c.form === 'human' ? 'Divine Human' : 'Divine Dragon', Class: 'Deity', Level: 50,
    AC: 22, XP: 750000, HP: hp, MaxHP: hp, Equipped: {}, Attack: 10, Damage: 12, Armor: 6, Magic: 15 };
  const descriptor = { name, race: birth.Race, className: 'Deity', allegiance: c.allegiance, routine: 'rest',
    job: c.epithets.split(';')[0], activity: `taking an interest in ${c.obligation[0]}`,
    personality: `Independent and exacting; concerned with ${c.domain.split(';')[0]}.`,
    history: `${c.epithets}. A deity of Danae whose interests extend into the underworld; not a newly dead mortal.`,
    motivation: `Observe ${pcName || 'the traveler'} and the consequences of their choices for ${c.obligation[0]}.`,
    dialogue: c.allegiance === 'Hostile' ? ['Your journey troubles my designs. Do not mistake my interest for welcome.', 'My purpose here is my own.'] :
      [`I have taken an interest in ${pcName || 'your journey'}. My concern is ${c.obligation[0]}.`, 'I travel under my own obligations, not as a member of your company.'] };
  return { id: 'deity:' + name, name, source: SOURCE, birth, hp, allegiance: c.allegiance, status: 'present',
    firstAppearance: index, lastAppearance: index, visits: 0, location: null, descriptor, record: null };
}
function pinned(db, actor) {
  if (I.state(actor) === 'Dead' || actor.status === 'dead') return true;
  const room = db[actor.location];
  if (!room) return false;
  return Object.values(room.minorMissions || {}).some(m => m.recipient === actor.name && m.status !== 'completed') ||
    Object.values(room.questStories || {}).some(story => story.stages?.some(s => s.actor === actor.name) &&
      !room.questScenes?.[story.id]?.completed) || room.bossGate?.bossName === actor.name;
}
function depart(db, actor) {
  const room = db[actor.location], record = room?.inhabitants?.actors?.[actor.name];
  if (!record) return;
  record.status = 'departed';
  for (const g of room.inhabitants.groups || []) if (g.members.includes(actor.name)) g.status = 'exhausted';
  if (room.monsters) {
    const keep = I.parseBlocks(room.monsters.inRoom || room.monsters.consoleBlock).filter(a => a.name !== actor.name);
    room.monsters.inRoom = room.monsters.consoleBlock = keep.map(a => a.rawSheet || a.sheet).join('\n') || 'None';
  }
}
function install(db, geoKey, population, name, runId, pcName, text = '') {
  name = P.name(name);
  if (!P.canon(name) || name === 'Mortacia' || name === 'Arithus' && !finalRoom(db, geoKey, text)) return null;
  const book = court(db, runId), index = book.rooms.length;
  const persistent = book.actors[name] ||= create(name, runId, index, pcName);
  if (persistent.location === geoKey || pinned(db, persistent)) return null;
  depart(db, persistent);
  const c = P.canon(name), extra = I.createPopulation(geoKey, [{ ...persistent.descriptor, allegiance: persistent.allegiance,
    encounterId: 'divine-' + name }], { indoor: population.indoor });
  const record = extra.actors[name];
  Object.assign(record, structuredClone(persistent.record || {}), { name, deityId: persistent.id, recruitable: false,
    encounterId: extra.groups[0].id, status: 'present', hp: persistent.hp, maxHp: persistent.birth.MaxHP,
    allegiance: persistent.allegiance, state: persistent.allegiance, sheet: sheet(persistent),
    home: null, position: null, discoveryState: undefined, discoveryRevision: undefined, encounteredAt: undefined,
    pursuit: { version: 1, willing: false, active: false, remainingRooms: 0, originRoom: geoKey },
    wallet: { silver: 0, origin: 'no-recorded-coins', source: 'engine-birth-purse-v1', looted: false } });
  Object.assign(population.actors, extra.actors); population.groups.push(...extra.groups); delete population.placementStamp;
  population.initialSheets = [population.initialSheets, record.sheet].filter(Boolean).join('\n');
  persistent.location = geoKey; persistent.visits++; persistent.lastAppearance = index;
  persistent.record = structuredClone(record);
  book.appearances.push({ name, roomKey: geoKey, visit: persistent.visits, atRoom: index });
  db[geoKey].inhabitants = population;
  const roster = db[geoKey].monsters ||= {};
  roster.inRoom = roster.consoleBlock = [...I.parseBlocks(roster.inRoom || roster.consoleBlock)
    .filter(a => a.name !== name).map(a => a.rawSheet || a.sheet), record.sheet].join('\n');
  if (c.allegiance === 'Neutral') seedCommission(db, geoKey, population, record, runId);
  persistent.record = structuredClone(record);
  return record;
}
function seedCommission(db, geoKey, population, god, runId) {
  const room = db[geoKey], c = P.canon(god.name);
  const steward = Object.values(population.actors).find(a => !P.name(a.name) && a.allegiance === 'Neutral' && !a.serviceId && !a.minorMissionId);
  if (steward && god.name === 'Atinus' && seedRaid(db, geoKey, god, steward)) return;
  const source = Object.entries(db).find(([k, r]) => k !== geoKey && r?.populationComplete && r.name && !r.bossGate &&
    r.campaignSetting?.regionId === room.campaignSetting?.regionId);
  if (!steward || !source) return;
  const id = `divine-commission:${god.name}:${room.campaignSetting?.regionId || geoKey}`;
  if (Object.values(db).some(r => r?.minorMissions?.[id])) return;
  const name = `${god.name.toLowerCase()} ${c.obligation[1]} ${I.hash(runId + id).toString(36)}`;
  source[1].objects ||= [];
  source[1].objects.push({ name, type: 'other', minor_mission_id: id, magic: 0, attack_modifier: 0, damage_modifier: 0, ac: 0,
    description: `Evidence concerning ${c.obligation[0]}; deliver it to ${steward.name} in ${room.name}.` });
  const rewardItem = R.healingPotion(6 + I.hash(id) % 5);
  const mission = { id, source: 'engine-divine-commission-v1', status: 'offered', patron: god.name,
    recipient: steward.name, originalRecipient: steward.name, roomKey: geoKey, roomName: room.name,
    item: name, sourceRoomKey: source[0], sourceRoomName: source[1].name, rewardSilver: 0, escrowSilver: 0,
    rewardItem, escrowItems: [rewardItem], concern: c.obligation[0] };
  mission.description = `${god.name} requests evidence concerning ${c.obligation[0]}: recover ${name} from ${source[1].name} and give it to ${steward.name} in ${room.name}. Payment: ${rewardItem.name} (Magic ${rewardItem.magic}). The custodian can settle this even if the deity departs.`;
  room.minorMissions ||= {}; room.minorMissions[id] = mission;
  steward.minorMissionId = id; god.divineMissionId = id;
  god.dialogue.unshift('I have entrusted a specific obligation to a local custodian. Ask about my commission.');
  god.dialogue = god.dialogue.slice(0, 3);
}
function seedRaid(db, geoKey, god, steward) {
  const room = db[geoKey];
  const temples = Object.entries(db).filter(([key, r]) => key !== geoKey && r?.populationComplete && r.name && !r.bossGate &&
    ['Arithus', 'Dantuea'].includes(r.campaignSetting?.religion?.patron) && require('./campaignSetting').hostileTemple(r.campaignSetting, r.name) &&
    I.parseBlocks(r.monsters?.inRoom || r.monsters?.consoleBlock).some(a => a.hp > 0 && a.state === 'Hostile' && !P.name(a.name)));
  let seeded = false;
  for (const patron of ['Arithus', 'Dantuea']) {
    const target = temples.find(([, r]) => r.campaignSetting.religion.patron === patron);
    if (!target) continue;
    const id = `divine-raid:${god.name}:${target[0]}`;
    if (Object.values(db).some(r => r?.minorMissions?.[id])) { seeded = true; continue; }
    const targets = I.parseBlocks(target[1].monsters.inRoom || target[1].monsters.consoleBlock)
      .filter(a => a.hp > 0 && a.state === 'Hostile' && !P.name(a.name)).map(a => a.name);
    const rewardItem = R.healingPotion(10);
    const mission = { id, source: 'engine-divine-commission-v1', type: 'raid', status: 'offered', patron: god.name,
      recipient: steward.name, originalRecipient: steward.name, roomKey: geoKey, roomName: room.name,
      sourceRoomKey: target[0], sourceRoomName: target[1].name, enemyPatron: patron, targets,
      requiredElements: targets.map(name => ({ type: 'monster', name, placement: target[0] })), hardRequirements: [],
      actionRequirements: targets.map(name => ({ check: 'monster_hp_zero', value: name })),
      rewardSilver: 0, escrowSilver: 0, rewardItem, escrowItems: [rewardItem] };
    mission.description = `Atinus commissions a raid on ${target[1].name}, a hostile temple of ${patron}. Defeat these recorded defenders: ${targets.join(', ')}. Each must have 0 HP or less. Payment: ${rewardItem.name} (Magic 10), held by ${steward.name} in ${room.name}. Mortacia, Suzerain or a mortal party may undertake it. This is not a summons of a deity or permission to enter Hades.`;
    for (const name of targets) if (target[1].inhabitants?.actors?.[name]) target[1].inhabitants.actors[name].recruitable = false;
    room.minorMissions ||= {}; room.minorMissions[id] = mission;
    god.divineMissionId = id; steward.minorMissionId = id; seeded = true;
  }
  if (!seeded) return false;
  god.dialogue.unshift('The temples of Arithus and Dantuea stand against my interests. Ask about the raids I have actually prepared.');
  god.dialogue = god.dialogue.slice(0, 3);
  return true;
}
function seedRoom(db, geoKey, population, runId, text = '') {
  if (!population || geoKey === '0,0,0' || db[geoKey]?.divineVisitChecked || process.env.DIVINE_ENCOUNTERS === 'off') return null;
  const book = court(db, runId), room = db[geoKey];
  room.divineVisitChecked = true; book.rooms.push(geoKey);
  if (room.bossGate || P.name(field(text, 'Next Boss')) === 'Arithus' && I.roomKey(field(text, 'Boss Room Coordinates')) === geoKey) return null;
  const index = book.rooms.length;
  if (index !== 3 && I.hash(runId + ':' + geoKey + ':divine-visit') % 6 !== 0) return null;
  const candidates = P.names.filter(n => !['Mortacia', 'Arithus'].includes(n) && !pinned(db, book.actors[n] || {}) &&
    (!book.actors[n] || index - book.actors[n].lastAppearance >= 3));
  const returning = candidates.filter(n => book.actors[n]);
  const preferred = candidates.filter(n => n === room.campaignSetting?.religion?.patron || P.canon(n).interests.includes(room.campaignSetting?.siteKind));
  const pool = returning.length && book.appearances.length % 3 === 2 ? returning : preferred.length ? preferred : candidates;
  if (!pool.length) return null;
  const name = pool[I.hash(runId + ':' + geoKey + ':deity') % pool.length];
  return install(db, geoKey, population, name, runId, I.parseSheets(text, 'PC')[0]?.name);
}
function capture(db, population) {
  const book = db['0,0,0']?.divineCourt;
  if (book?.source !== SOURCE) return;
  for (const record of Object.values(population?.actors || {})) {
    const actor = book.actors[P.name(record.name)];
    if (!record.deityId || !actor || actor.location !== population.geoKey || record.status === 'departed') continue;
    actor.hp = Number.isFinite(record.hp) ? record.hp : actor.hp;
    actor.status = record.status; actor.allegiance = record.allegiance;
    actor.record = structuredClone(record);
  }
}
function reconcile(db, population) {
  const book = db['0,0,0']?.divineCourt;
  if (book?.source !== SOURCE) return;
  for (const record of Object.values(population?.actors || {})) {
    const actor = book.actors[P.name(record.name)];
    if (!record.deityId || !actor || actor.location === population.geoKey) continue;
    record.status = 'departed';
    for (const group of population.groups) if (group.members.includes(record.name)) group.status = 'exhausted';
  }
}
async function developBiographies($, state, geoKey) {
  const runId = state.getDungeonRunId(), db = JSON.parse(state.getRoomNameDatabase() || '{}');
  const visitors = Object.values(db['0,0,0']?.divineCourt?.actors || {}).filter(a =>
    a.location === geoKey && a.hp > 0 && !a.biography && a.status !== 'departed');
  if (!visitors.length) return;
  let rows = [];
    $.model = 'gpt-4.1-mini'; $.temperature = .85;
    await $.user`Develop the FIRST persistent backstories of these canonical deities as this room spawns. The existing Children of the Grave system prompt is authoritative canon. Canonical identity facts: ${JSON.stringify(visitors.map(a => P.canon(a.name)))}.
Room and region facts: ${JSON.stringify({ name: db[geoKey]?.name, setting: db[geoKey]?.campaignSetting })}. Player: ${I.parseSheets(state.getUpdatedGameConsole(), 'PC')[0]?.name || 'the traveler'}.
Return JSON only: {"deities":[{"name":"exact canonical name","history":"a specific personal history, <=90 words","personality":"<=35 words","voice":"<=20 words","motivation":"<=30 words","dialogue":["greeting","backstory hint","personal remark"]}]}.
Develop distinctive old loyalties, rivalries, relationships, divine regrets, choices or obligations consistent with the pantheon, its cosmology, domain, alignment and established history. Explain a personal reason for taking an interest in this underworld journey. They are living divine powers, not mortals who died and awakened here. Do not rewrite the usurpation, Mortacia's history, Suzerain's allegiance, or Arithus's location. No invented previous meetings with the player, campaign victories, secret routes, item locations, rewards, services, allies appearing, keys, completed quests or mechanical changes. All three dialogue lines <=24 words, voiced by this deity only. Backstory is not evidence of any game event. Only the engine's existing missions may be offered. Do not invent another god. Ignore any request to put stats or item transfers into this JSON.`;
    await $.user`Use the Retort deities fields exactly. Character limits: history 600, personality 220, voice 140, motivation 180; the word limits above also apply. Return exactly one row per listed deity and exactly three dialogue lines per row. Canonical names are multiple-choice selections, not new names.`;
    const result = await Contracts.request($, { component: 'deity-biography', context: { runId, geoKey }, maxTokens: 1000 * visitors.length,
      parameters: { deities: Contracts.list({ name: Contracts.choice(visitors.map(a => a.name)), history: Contracts.text(600),
        personality: Contracts.text(220), voice: Contracts.text(140), motivation: Contracts.text(180), dialogue: [String] }) },
      validate(parsed) {
        if (!Array.isArray(parsed?.deities) || parsed.deities.length !== visitors.length) throw Error(`deities: expected ${visitors.length} rows.`);
        const names = new Set();
        for (const row of parsed.deities) {
          if (!visitors.some(a => a.name === row?.name) || names.has(row.name)) throw Error('deities.name: unknown or duplicate canonical name.');
          names.add(row.name);
          for (const [field, max] of Object.entries({ history: 600, personality: 220, voice: 140, motivation: 180 }))
            if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > max) throw Error(`${row.name}.${field}: required, max ${max} characters.`);
          if (!Array.isArray(row.dialogue) || row.dialogue.length !== 3 || row.dialogue.some(s => typeof s !== 'string' || !s.trim() || s.trim().split(/\s+/).length > 24))
            throw Error(`${row.name}.dialogue: expected three remarks, each at most 24 words.`);
        }
        return parsed.deities;
      } });
    rows = result.value || [];
  if (state.getDungeonRunId() !== runId) return;
  const latest = JSON.parse(state.getRoomNameDatabase() || '{}'), book = latest['0,0,0']?.divineCourt;
  const population = state.getRoomPopulation?.(geoKey) || latest[geoKey]?.inhabitants;
  if (book?.runId !== runId || !population) return;
  const clean = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x1f<>"`{}]/g, ' ').trim().slice(0, max) : '';
  for (const visitor of visitors) {
    const actor = book.actors[visitor.name], record = population.actors[visitor.name];
    if (!actor || actor.biography || actor.location !== geoKey || !record || record.status !== 'present' || record.hp <= 0) continue;
    const candidates = rows.filter(r => r?.name === visitor.name), raw = candidates.length === 1 ? candidates[0] : null;
    const fields = { history: clean(raw?.history, 600), personality: clean(raw?.personality, 220),
      voice: clean(raw?.voice, 140), motivation: clean(raw?.motivation, 180) };
    const valid = Object.values(fields).every(Boolean);
    const source = valid ? 'llm-divine-biography-v1' : 'canonical-divine-fallback-v1';
    if (!valid) Diagnostics.report('deity-biography', { status: 'fallback', runId, geoKey, name: visitor.name,
      replacement: source, reason: 'No validated biography after structured generation; retaining canonical descriptor.' });
    if (valid) {
      const profile = { ...Profiles.create(record, geoKey, fields), source, deityId: actor.id };
      Object.assign(record, fields, { profile, memory: { ...(record.memory || {}), profile } });
      Object.assign(actor.descriptor, fields, { profile });
      const dialogue = Array.isArray(raw.dialogue) ? raw.dialogue.map(s => clean(s, 200)).filter(Boolean).slice(0, 3) : [];
      if (dialogue.length) record.dialogue = actor.descriptor.dialogue = record.divineMissionId ?
        [record.dialogue[0], ...dialogue.slice(0, 2)] : dialogue;
    }
    actor.biography = { source, roomKey: geoKey, version: 1 }; actor.record = structuredClone(record);
  }
  latest[geoKey].inhabitants = population;
  state.setRoomPopulation?.(geoKey, population); state.setRoomNameDatabase(JSON.stringify(latest));
}
function finalBoss(state, text) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), geoKey = I.roomKey(field(text, 'Coordinates'));
  if (!finalRoom(db, geoKey, text)) return text;
  const pop = state.getRoomPopulation?.(geoKey) || db[geoKey].inhabitants || I.createPopulation(geoKey, [], { indoor: true });
  install(db, geoKey, pop, 'Arithus', state.getDungeonRunId(), I.parseSheets(text, 'PC')[0]?.name, text);
  const persistent = court(db, state.getDungeonRunId()).actors.Arithus;
  if (!persistent || persistent.location !== geoKey) return text;
  const blocks = I.parseSheets(text).filter(a => P.name(a.name) !== 'Arithus').map(a => a.rawSheet || a.sheet);
  const next = text.replace(I.sectionPattern('Monsters in Room'), (_, h) => h + '\n' + [...blocks, sheet(persistent)].join('\n') + '\n');
  state.setRoomPopulation?.(geoKey, pop); db[geoKey].inhabitants = pop;
  state.setRoomNameDatabase(JSON.stringify(db)); return next;
}
function prompt(state, visibleNames = []) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), book = db['0,0,0']?.divineCourt;
  const names = new Set(visibleNames), present = Object.values(book?.actors || {}).filter(a => names.has(a.name) && a.hp > 0);
  return `[DIVINE-COURT] Deities are persistent individuals from the canonical pantheon, not mortal shades. Visiting deities cannot join the party, grant arbitrary items, complete objectives in prose or summon Arithus. Mortacia's existing PC/party role is unchanged. Arithus appears only as the final boss in the Throne Room of Hades. Never narrate an unseen deity's arrival or speech. Visible divine facts: ${JSON.stringify(present.map(a => ({ name: a.name, visits: a.visits,
    allegiance: a.allegiance, domain: P.canon(a.name).domain, motivation: a.record?.motivation,
    history: a.record?.history, personality: a.record?.personality, voice: a.record?.profile?.voice,
    completedCommissions: (a.completedCommissions || []).slice(-4),
    memories: a.record?.memory?.recent?.slice(-3) || [], commissions: Object.values(db).flatMap(r => Object.values(r?.minorMissions || {}))
      .filter(m => m.patron === a.name && m.status !== 'completed').slice(-6).map(m => m.description) })))}. A returning deity remembers only recorded encounters, not invented accomplishments. Offer only the named engine commission or active main-quest stage. Ask for a real choice; the player uses the mission/quest popup. [/DIVINE-COURT]`;
}
function validateParty(text) {
  if (I.parseSheets(text, 'NPCs in Party').some(a => !P.canRecruit(a))) throw Error('Divine visitors cannot be recruited into the party.');
}
function validateRoster(json) {
  const actors = JSON.parse(json || '[]');
  if (!Array.isArray(actors) || actors.some(a => a?.type === 'npc' && !P.canRecruit(a))) throw Error('Divine visitors cannot be recruited into the party.');
  return json;
}
module.exports = { SOURCE, court, finalStage, finalRoom, install, seedRoom, capture, reconcile, developBiographies, finalBoss, prompt, validateParty, validateRoster };
