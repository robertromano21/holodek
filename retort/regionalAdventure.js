'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Pantheon = require('../assets/pantheonCharacters');
const Campaign = require('./campaignSetting');
const Contracts = require('./generationContracts');
const Diagnostics = require('./generationDiagnostics');
const { CATALOG } = require('./environmentIntents');
const { formatStartingCharacterSheet } = require('./initialGameState');
const Q = () => require('./questProgress');
const templates = ['oasis', 'graveyard', 'wasteland', 'roman_temple'];
const directions = [['north', 0, 1, 'south'], ['east', 1, 0, 'west'], ['south', 0, -1, 'north'], ['west', -1, 0, 'east'],
  ['northeast', 1, 1, 'southwest'], ['southeast', 1, -1, 'northwest'], ['southwest', -1, -1, 'northeast'], ['northwest', -1, 1, 'southeast']];
const clean = (s, max) => typeof s === 'string' && s.trim() && s.length <= max && !/[<>\r\n|`]/.test(s) ? s.trim() : null;
function contactAt(database, origin) {
  const room=database[origin];
  return I.parseBlocks(room?.monsters?.consoleBlock || room?.monsters?.inRoom || '').find(a=> {
    const record=room.inhabitants?.actors?.[a.name];
    return a.hp>0&&(record?.hp??a.hp)>0&&record?.status==='present'&&I.allegiance(record,room.monsters.state)!=='Hostile';
  });
}
function route(database, origin, bossKey) {
  const [x, y, z] = origin.split(',').map(Number), home = database[origin];
  if (!home || ![x, y, z].every(Number.isSafeInteger) || origin === bossKey) return null;
  for (const [direction, dx, dy, back] of directions) {
    const exit = home.exits?.[direction];
    if (!exit || (exit.status || exit) !== 'open') continue;
    const rooms = Array.from({ length: 4 }, (_, i) => `${x + dx * (i + 1)},${y + dy * (i + 1)},${z}`);
    if (exit.targetCoordinates && I.roomKey(exit.targetCoordinates) !== rooms[0]) continue;
    const first = database[rooms[0]];
    if (first && (first.description && !/^none$/i.test(first.description) || first.populationComplete || first.sceneSpec ||
        first.visited || first.indoor === true || first.classification?.indoor === true || first.objects?.length ||
        Object.keys(first.inhabitants?.actors || {}).length || Object.keys(first.exits || {}).some(d => d !== back))) continue;
    if (rooms.every((k, i) => (i === 0 || !database[k]) && k !== bossKey && k !== '0,0,0')) return { direction, back, rooms };
  }
  return null;
}
function prompt(context) {
  return `${require('./underworldLore').GUIDANCE}\nAuthor the FIRST connected regional adventure in Children of the Grave, supplementing the existing main quest.
Use the system prompt's underworld lore and these real bindings: ${JSON.stringify(context)}.
The engine owns mechanics: accept the hook; read burial records; defeat two road extortionists; defeat two hostile temple jailers;
recruit a neutral prisoner and escort them alive to the oasis, OR read the prison testimony when escort is impossible;
then explicitly choose shared water stewardship or caravan stewardship at the oasis. The next EXISTING quest step retrieves the bound boss key; the final step fights the bound boss. Never create a key, artifact, exit rule or completion metric.
Make a lived-in adventure with personal stakes, a misleading rumor that the burial record can check, a concrete revelation,
and two defensible faction choices. Write short dramatic dialogue, not an omniscient lore lecture.
The four sites, in order, are a fertile oasis/community, an outdoor graveyard, a dangerous outdoor road, and an INDOOR hostile temple of Arithus or Dantuea.
Use the existing firstSiteName when supplied; its open trail can contain a watered settlement. The existing contact alone speaks the hook; do not replace their identity. The engine binds all exact room names and directions after validation.
Name six non-divine inhabitants (souls, shades, native beings or humanoids as you choose): oasis representative, rescued prisoner, two road guards, two temple guards; no gods, bosses or party names. These are underworld people, not necessarily living mortals.
Return only JSON with title (<=70 chars), premise (<=220), hook (<=400), rumor (<=220), investigation (<=400), rescue (<=400), conclusion (<=400),
sites:[{name (<=80), flavor (<=240)}] (four entries),
actors:[{name (<=60), history (<=220), personality (<=160)}] (six entries in the order above),
templePatron:"Arithus|Dantuea" (must match the temple name),
burialText (<=700), testimonyText (<=700). Include concrete facts in the two writings that justify the revelation and resolution.
All limits are CHARACTERS, not words. Aim below them. Every value must be a single line: no paragraph breaks, HTML, pipes or backticks. Return the Retort fields, not a prose essay. The six NEW inhabitants must not reuse the existing contact or party names. Use the site and actor names you return consistently, with no alternative oasis aliases. Pick ONE templePatron, never "Arithus or Dantuea".
Do not mention nonexistent items or directions. The compiler supplies exact names, rooms and task requirements.`;
}
function validationIssues(raw) {
  if (!raw || typeof raw !== 'object') return ['Expected one regional adventure object.'];
  const errors = [], limits = { title: 70, premise: 220, hook: 400, rumor: 220, investigation: 400, rescue: 400, conclusion: 400, burialText: 700, testimonyText: 700 };
  for (const [field, max] of Object.entries(limits)) if (!clean(raw[field], max)) errors.push(`${field}: required single-line text <=${max} characters; received ${typeof raw[field] === 'string' ? raw[field].length : 'non-text'}.`);
  for (const [field, count, fields] of [['sites', 4, { name: 80, flavor: 240 }], ['actors', 6, { name: 60, history: 220, personality: 160 }]]) {
    if (!Array.isArray(raw[field]) || raw[field].length !== count) { errors.push(`${field}: expected exactly ${count} entries.`); continue; }
    for (const [i, row] of raw[field].entries()) for (const [key, max] of Object.entries(fields)) if (!clean(row?.[key], max)) errors.push(`${field}[${i}].${key}: required single-line text <=${max} characters.`);
  }
  return errors;
}
function validate(raw, database, partyNames, firstSiteName = null) {
  if (!raw || !Array.isArray(raw.sites) || raw.sites.length !== 4 || !Array.isArray(raw.actors) || raw.actors.length !== 6) return null;
  const limits = { title: 70, premise: 220, hook: 400, rumor: 220, investigation: 400, rescue: 400, conclusion: 400, burialText: 700, testimonyText: 700 };
  const out = {};
  for (const [name, limit] of Object.entries(limits)) { out[name] = clean(raw[name], limit); if (!out[name]) return null; }
  out.sites = raw.sites.map(s => ({ name: clean(s?.name, 80), flavor: clean(s?.flavor, 240) }));
  out.actors = raw.actors.map(a => ({ name: clean(a?.name, 60), history: clean(a?.history, 220), personality: clean(a?.personality, 160) }));
  if ([...out.sites, ...out.actors].some(o => Object.values(o).some(v => !v))) return null;
  const existing = new Set([...partyNames, ...Object.values(database).flatMap(r => [r?.name, ...Object.keys(r?.inhabitants?.actors || {}),
    ...I.parseBlocks(r?.monsters?.consoleBlock || r?.monsters?.inRoom || '').map(a=>a.name), ...(r?.regionalSite?.actors||[]).map(a=>a.name)])].filter(Boolean).map(s => s.toLowerCase()));
  const names = [...out.sites, ...out.actors].map(o => o.name.toLowerCase());
  if (new Set(names).size !== names.length || names.some((n, i) => ['__proto__','constructor','prototype'].includes(n) ||
      (existing.has(n) && !(i===0 && n===firstSiteName?.toLowerCase())) || /[,":{}]/.test(n)) || out.actors.some(a => Pantheon.canon(a.name))) return null;
  out.templePatron=raw.templePatron || (/arithus/i.test(out.sites[3].name)?'Arithus':'Dantuea');
  if(!['Arithus','Dantuea'].includes(out.templePatron)||Pantheon.names.some(n=>n!==out.templePatron&&out.sites[3].name.toLowerCase().includes(n.toLowerCase())))return null;
  return out;
}
function inscription(id, name, text, storyId) {
  return { id, questStoryId: storyId, mechanismId: storyId, kind: 'inscription', type: 'stone_tablet', name,
    title: name, role: 'lore', motif: 'Key', backstory: 'A preserved civic record, witnessed before the party arrived.',
    chapters: [{ title: 'The record', text }] };
}
function compile(raw, database, origin, gate, text, runId) {
  if (!gate?.targetKey || !database[gate.targetKey]?.name) return null;
  const planned = route(database, origin, gate.targetKey);
  const party = [...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')];
  const authored = validate(raw, database, party.map(a => a.name), planned && database[planned.rooms[0]]?.name);
  const contact = contactAt(database,origin);
  if (!planned || !authored || !contact) return null;
  const db = structuredClone(database), id = 'regional:' + randomUUID(), storyId = 'story:' + id;
  const [oasis, graveyard, road, temple] = planned.rooms;
  const [delegate, prisoner, ...guards] = authored.actors;
  const levels = party.filter(a => a.name !== 'Mortacia').map(a => a.level);
  const level = Math.max(1, Math.min(12, levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 1));
  for (const [i, roomKey] of planned.rooms.entries()) {
    const template = templates[i], setting = Campaign.plan({ database: db, sourceKey: origin, targetKey: roomKey, seed: runId, template });
    setting.faction = { ...Campaign.FACTIONS.find(f => f.id === (i === 3 ? 'tollwardens' : 'wellkeepers')), ...Campaign.FAITH[i === 3 ? 'tollwardens' : 'wellkeepers'] };
    const patron=i===3?authored.templePatron:'Dyanetzia';
    setting.religion = { ...setting.religion, patron, allegiance: i === 3 ? 'Hostile' : 'Neutral',
      concern:Pantheon.canon(patron).obligation[0],practice:i===3?'The cult imprisons dissenters and demands tribute.':'Households maintain the shared spring and its records.' };
    db[roomKey] = { ...db[roomKey], name: db[roomKey]?.name || authored.sites[i].name, objects: [], exits: { [planned.back]: { status: 'open', targetCoordinates: i ? planned.rooms[i-1] : origin },
      ...(i < 3 ? { [planned.direction]: { status: 'open', targetCoordinates: planned.rooms[i+1] } } : {}) },
      monsters: { inRoom: 'None', state: 'None', equippedProperties: 'None' },
      indoor: CATALOG[template].indoor, classification: { indoor: CATALOG[template].indoor, biome: CATALOG[template].biome, size: i === 3 ? 32 : 64 },
      environmentIntent: { ...CATALOG[template], targetKey: roomKey, campaignSetting: setting }, campaignSetting: setting,
      regionalSite: { source: 'engine-regional-site-v1', storyId, flavor: authored.sites[i].flavor,
        actors: (i === 0 ? [delegate] : i === 2 ? guards.slice(0, 2) : i === 3 ? [...guards.slice(2), prisoner] : [])
          .map(a => ({ ...a, level, role: a === prisoner ? 'prisoner' : a === delegate ? 'delegate' : 'guard',
            allegiance: guards.includes(a) ? 'Hostile' : 'Neutral', factionId: guards.includes(a) ? 'tollwardens' : 'wellkeepers' })) } };
  }
  const burial = inscription('burial:' + id, 'burial register ' + I.hash(id).toString(16), authored.burialText, storyId);
  const testimony = inscription('testimony:' + id, 'prison testimony ' + I.hash(id).toString(16), authored.testimonyText, storyId);
  const fallback = inscription('covenant:' + id, 'regional covenant ' + I.hash(id).toString(16), authored.premise, storyId);
  const oath = inscription('oasis:' + id, 'oasis charter ' + I.hash(id).toString(16), authored.conclusion, storyId);
  db[graveyard].inscriptions = [burial]; db[temple].inscriptions = [testimony]; db[oasis].inscriptions = [oath];
  db[origin].inscriptions = [...(db[origin].inscriptions || []), fallback];
  const stages = [
    { id: 'hook', kind: 'dialogue', roomKey: origin, actor: contact.name, text: authored.hook + '\nRumor (unverified): ' + authored.rumor,
      options: [{ id: 'accept', label: 'Investigate the missing traveler', action: 'continue', next: 'investigation' }] },
    { id: 'investigation', kind: 'read', roomKey: graveyard, name: burial.name, readableId: burial.id,
      text: authored.investigation, options: [{ id: 'read-record', label: 'Read the burial register', action: 'continue', next: 'road' }] },
    { id: 'road', kind: 'encounter', defeatOnly: true, roomKey: road, targets: guards.slice(0, 2).map(a => a.name), text: 'Defeat the named extortionists on the road.', next: 'temple' },
    { id: 'temple', kind: 'encounter', defeatOnly: true, roomKey: temple, targets: guards.slice(2).map(a => a.name), text: 'Defeat the named temple jailers before arranging the rescue.', next: 'rescue' },
    { id: 'rescue', kind: 'dialogue', roomKey: temple, actor: prisoner.name, fallback: { name: testimony.name, readableId: testimony.id }, text: authored.rescue,
      options: [{ id: 'escort', label: 'Invite ' + prisoner.name + '; escort them alive to ' + db[oasis].name, action: 'recruit', next: 'escort' },
        { id: 'records', label: 'Recover the prison testimony instead (no escort)', action: 'continue', next: 'testimony' }] },
    { id: 'escort', kind: 'escort', roomKey: oasis, actor: prisoner.name, recovery: 'testimony', recoveryRoom: temple,
      text: 'Bring ' + prisoner.name + ' alive, in the party, to ' + db[oasis].name + '.', next: 'objective' },
    { id: 'testimony', kind: 'read', roomKey: temple, name: testimony.name, readableId: testimony.id,
      text: 'Recover the recorded testimony; it is evidence, not a successful rescue.', options: [{ id: 'read-testimony', label: 'Read the prison testimony', action: 'continue', next: 'objective' }] },
    { id: 'objective', kind: 'objective', roomKey: oasis, text: 'Return to ' + db[oasis].name + ' to settle the regional obligation.', next: 'resolution' },
    { id: 'resolution', kind: 'dialogue', roomKey: oasis, actor: delegate.name, fallback: { name: oath.name, readableId: oath.id }, text: authored.conclusion,
      options: [{ id: 'shared-wells', label: 'Entrust the route to the Cistern Compact', action: 'finish', next: 'complete', factionEffects: { wellkeepers: 2, salvagers: -1 } },
        { id: 'caravan-stewards', label: 'Entrust the route to the Ashroad Fellowship', action: 'finish', next: 'complete', factionEffects: { salvagers: 2, wellkeepers: -1 } }] },
    { id: 'complete', kind: 'complete', roomKey: oasis, text: 'The regional obligation is settled. The existing boss-key task comes next.' }
  ];
  const story = { version: 1, family: 'regional-v1', id: storyId, title: authored.title,
    hook: { kind: 'npc', roomKey: origin, roomName: db[origin].name, actor: contact.name }, fallback: { name: fallback.name, readableId: fallback.id },
    rumor: { text: authored.rumor, source: contact.name, resolvedBy: 'investigation' }, stages };
  const task = { id, type: 'Regional', actionKind: 'resolve_regional_adventure', desc: authored.premise +
    ` Read "${burial.name}" in ${db[graveyard].name} (${graveyard}); defeat ${guards.map(a => a.name).join(', ')} in ${db[road].name} and ${db[temple].name}; escort ${prisoner.name} to ${db[oasis].name} (${oasis}), or read "${testimony.name}" in ${db[temple].name} (${temple}); settle with ${delegate.name} at the oasis. Then retrieve the existing boss key and face ${gate.bossName || 'the bound boss'} in ${db[gate.targetKey]?.name}.`,
    metrics: 'Recorded readings, bound encounter outcomes, live escort arrival or recovered testimony, and explicit faction resolution.',
    status: 'Pending', story, requiredElements: [...guards.map((a, i) => ({ type: 'monster', name: a.name, placement: i < 2 ? road : temple })),
      { type: 'monster', name: prisoner.name, placement: temple }, { type: 'monster', name: delegate.name, placement: oasis }],
    hardRequirements: [{ check: 'at_coords', value: oasis }, { check: 'quest_story_complete', value: storyId, coords: origin }], actionRequirements: [] };
  try { Q().taskBinding(task); } catch { return null; }
  if (!require('./questScenes').valid(story, db)) return null;
  db[origin].questStories ||= {}; db[origin].questStories[storyId] = story;
  db[origin].questScenes ||= {}; db[origin].questScenes[storyId] = { source: 'engine-quest-scene-v1', taskBinding: Q().taskBinding(task), stage: 'hook', revision: 0, history: [], completed: false };
  db['0,0,0'] ||= {}; db['0,0,0'].regionalAdventure = { source: 'engine-regional-adventure-v1', runId, storyId, origin, rooms: planned.rooms, direction: planned.direction };
  return { task, database: db, route: planned };
}
async function trySeed($, state, database, origin, gate, text) {
  if (process.env.REGIONAL_ADVENTURES === 'off' || process.env.QUEST_STORIES === 'off' || !gate ||
      state.getCurrentTasks()?.length || (state.getCurrentTaskIndex() || 0) !== 0 ||
      !/^0\//.test(text.match(/^Quests Achieved:[ \t]*(.*)$/m)?.[1] || '') || database['0,0,0']?.regionalAdventureAttempt) return null;
  database['0,0,0'] ||= {};
  database['0,0,0'].regionalAdventureAttempt = { runId: state.getDungeonRunId(), status: 'attempted', source: 'engine-regional-attempt-v1' };
  state.setRoomNameDatabase(JSON.stringify(database));
  const contact=contactAt(database,origin);
  const fallback = async reason => {
    Diagnostics.report('regional-adventure', { status: 'fallback', runId: state.getDungeonRunId(), geoKey: origin, reason, replacement: 'existing-quest-generator' });
    Object.assign(database['0,0,0'].regionalAdventureAttempt, { status: 'fallback', reason });
    state.setRoomNameDatabase(JSON.stringify(database));
    await require('./campaignPlanningLog').capture(state, 'first connected adventure fallback');
    return null;
  };
  if (!route(database, origin, gate.targetKey)||!contact) return fallback(!contact ? 'No living neutral opening contact.' : 'No safe connected regional route; existing quest generator retained.');
  try {
    await require('./campaignMemory').appendPlanning($, state, 'regional adventure: past choices, unresolved trouble, factions and relationships', { consoleText: text });
    await $.assistant`${prompt({ origin, room: database[origin]?.name, mainQuest: state.getCurrentQuest(), bossRoom: database[gate.targetKey]?.name,
      contact:{name:contact.name,history:database[origin].inhabitants.actors[contact.name].history},
      party: I.parseSheets(text, 'PC').concat(I.parseSheets(text, 'NPCs in Party')).map(a => a.name),
      firstSiteName: database[route(database,origin,gate.targetKey).rooms[0]]?.name, campaign: database['0,0,0'].campaignAtlas })}`;
    const limits = { title: 70, premise: 220, hook: 400, rumor: 220, investigation: 400, rescue: 400, conclusion: 400, burialText: 700, testimonyText: 700 };
    const generated = await Contracts.request($, { component: 'regional-adventure', context: { runId: state.getDungeonRunId(), geoKey: origin }, maxTokens: 3200,
      localWork: {
        brief: `Author one connected underworld adventure, supplementing the existing quest without replacing its boss/key. Existing contact: ${contact.name}; origin: ${database[origin]?.name}; main quest: ${state.getCurrentQuest()}; bound boss room: ${database[gate.targetKey]?.name}. Existing first site name: ${database[route(database, origin, gate.targetKey).rooms[0]]?.name || 'not named'}. Four sites IN ORDER: oasis/community, outdoor graveyard, dangerous road, indoor temple. Six NEW non-divine actors IN ORDER: oasis representative, prisoner, two road extortionists, two temple jailers. Never reuse contact/party names: ${JSON.stringify([contact.name, ...I.parseSheets(text, 'PC').concat(I.parseSheets(text, 'NPCs in Party')).map(a => a.name)])}. Preserve accepted exact names; use single-line complete sentences comfortably below limits. Engine stages: existing contact hook, check rumor in burial record, defeat road/temple guards, rescue prisoner OR read testimony, resolve a defensible choice between shared wells and caravan stewardship. No new keys, completion metrics or rewards.`,
        leading: ['templePatron', 'sites', 'actors', 'title', 'premise', 'rumor', 'burialText', 'testimonyText'],
        arrays: { sites: { count: 4, max: 4, batch: 1 }, actors: { count: 6, max: 6, batch: 1 } },
        specific: (part, prior) => part.includes('sites') ? 'Author only site #' + ((prior.nextIndex || 0) + 1) + '. The temple name must agree with templePatron.' :
          part.includes('actors') ? 'Author only actor #' + ((prior.nextIndex || 0) + 1) + ' with the assigned role. This is a new unique identity, not a site name.' :
          'Writings and dialogue must agree with the accepted rumor, revelation, locations and actor names. Historical testimony is evidence to investigate, not a completed quest.'
      },
      parameters: { ...Object.fromEntries(Object.entries(limits).map(([field, max]) => [field, { ...Contracts.text(max), pattern: '^[^<>\\r\\n|`]+$' }])),
        sites: Contracts.list({ name: Contracts.text(80), flavor: Contracts.text(240) }),
        actors: Contracts.list({ name: Contracts.text(60), history: Contracts.text(220), personality: Contracts.text(160) }),
        templePatron: Contracts.choice(['Arithus', 'Dantuea']) },
      validate(raw) {
        const issues = validationIssues(raw);
        if (issues.length) throw Error(issues.join(' '));
        if (!validate(raw, database, I.parseSheets(text, 'PC').concat(I.parseSheets(text, 'NPCs in Party')).map(a => a.name),
          database[route(database, origin, gate.targetKey)?.rooms[0]]?.name)) throw Error('Site/actor names must be unique and not duplicate existing residents; templePatron must match the temple.');
        const result = compile(raw, database, origin, gate, text, state.getDungeonRunId());
        if (!result) throw Error('Regional compile failed: check connected route, living contact, bound boss, task binding and staged-scene validity.');
        return result;
      } });
    if (!generated.value) return fallback(generated.error?.message || 'No validated regional adventure.');
    const result = generated.value;
    if (result) result.database['0,0,0'].regionalAdventureAttempt.status = 'compiled';
    return result || fallback('The generated regional adventure did not pass engine validation.');
  } catch (error) { console.warn('[RegionalAdventure] Existing generator fallback:', error.message); return fallback('Regional planner failed: ' + String(error.message).slice(0, 240)); }
}
function bindPopulation(room, result) {
  const site = room?.regionalSite;
  if (site?.source !== 'engine-regional-site-v1' || !site.actors.length) return result;
  const names = new Set(site.actors.map(a => a.name));
  const retained = new Set(Object.keys(result.population.actors).filter(n => !names.has(n)).slice(0, (result.population.indoor ? 10 : 20) - site.actors.length));
  result.population.actors = Object.fromEntries(Object.entries(result.population.actors).filter(([n]) => retained.has(n)));
  result.population.groups = result.population.groups.map(g => ({ ...g, members: g.members.filter(n => retained.has(n)) })).filter(g => g.members.length);
  for (const a of site.actors) {
    const old = room.inhabitants?.actors?.[a.name];
    const hp = old?.hp ?? 12 + a.level * 3;
    const sheet = old?.sheet || formatStartingCharacterSheet({ Name: a.name, Sex: 'Unknown', Race: 'Human', Class: a.role === 'guard' ? 'Oath Warden [rules: Fighter]' : 'Wayfarer [rules: Fighter]',
      Level: a.level, HP: hp, MaxHP: 12 + a.level * 3, AC: 10 + Math.ceil(a.level / 2), Attack: 1 + Math.floor(a.level / 2), Damage: 2,
      Armor: 0, Magic: 0 }, 6, 'npc').replace(/State: Friendly$/, 'State: ' + a.allegiance);
    const extra = I.createPopulation(result.population.geoKey, [{ ...a, hp, maxHp: 12 + a.level * 3, race: 'Human',
      className: a.role === 'guard' ? 'Oath Warden [rules: Fighter]' : 'Wayfarer [rules: Fighter]', combatRole: 'Warrior', combatArchetype: 'Fighter',
      sheet, job: a.role === 'guard' ? 'temple guard' : 'wayfarer', encounterId: 'regional-' + I.hash(a.name),
      dialogue: [a.role === 'prisoner' ? 'Get me back to the spring. I will not trust another escort on promises alone.' : a.role === 'delegate' ? 'The wells belong to people, not to their conquerors.' : 'The toll is owed. Stand aside or bleed.'] }], { indoor: result.population.indoor });
    Object.assign(extra.actors[a.name], { sheet, hp, maxHp: 12 + a.level * 3, level: a.level, factionId: a.factionId, regionalRole: a.role });
    if (old) Object.assign(extra.actors[a.name], structuredClone(old));
    extra.actors[a.name].regionalStoryId = site.storyId;
    Object.assign(result.population.actors, extra.actors); result.population.groups.push(...extra.groups);
  }
  result.sheets = I.residentSheets(result.population).map(a => a.rawSheet || a.sheet).join('\n');
  const equipped=new Set(I.parseBlocks(result.sheets).flatMap(a=>Object.values(I.parseEquipment(a.lines[9]))));
  result.equipment=(result.equipment||[]).filter(item=>equipped.has(item.name));
  return result;
}
module.exports = { route, prompt, validate, validationIssues, compile, trySeed, bindPopulation };
