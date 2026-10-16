'use strict';
const Contracts = require('./generationContracts');
const Diagnostics = require('./generationDiagnostics');
const I = require('../assets/dungeonInhabitants');
const Pantheon = require('../assets/pantheonCharacters');
const { coordinates, keyOf, indoor } = require('../assets/outdoorRoutes');
const Underground = require('./undergroundEnvironments');
const Fortified = require('./fortifiedSites');
const Lore = require('./underworldLore');

const REGIONS = [
  { id: 'tartarus', name: 'Tartarus Frontier', ecology: 'Ash dunes, basalt uplands and rare spring-fed oases; sheltered gardens depend on maintained cisterns.',
    livelihoods: ['cistern keeping', 'grave masonry', 'caravan salvage'], pressure: 'water rights and burial debts' },
  { id: 'pilgrim-roads', name: 'Pilgrim Marches', ecology: 'Gravel roads follow seasonal washes between fortified wells, reed beds and burial gardens.',
    livelihoods: ['caravan trade', 'reed weaving', 'pilgrim lodging'], pressure: 'road tolls and missing travelers' },
  { id: 'riverlands', name: 'Lower Riverlands', ecology: 'Shallow channels support irrigated gardens, ferries and damp reed meadows beyond the sand wastes.',
    livelihoods: ['ferrying', 'gardening', 'river transport'], pressure: 'crossing rights and contested riverbanks' },
  { id: 'hades-marches', name: 'Hades Marches', ecology: 'Terraced settlements and stone roads supply the outer citadels of Hades; gardens occupy protected courtyards.',
    livelihoods: ['stone cutting', 'smithing', 'citadel provisioning'], pressure: 'occupation levies and disputed authority' }
];
const FACTIONS = [
  { id: 'wellkeepers', name: 'Cistern Compact', purpose: 'Maintain shared wells and gardens; oppose the privatization of water.', rival: 'tollwardens' },
  { id: 'tollwardens', name: 'Ledger Wardens', purpose: 'Register crossings, regulate roads and collect disputed passage tolls.', rival: 'wellkeepers' },
  { id: 'masons', name: 'Guild of the Last Stone', purpose: 'Repair tombs, houses and bridges; insist that even the forgotten receive burial.', rival: 'salvagers' },
  { id: 'salvagers', name: 'Ashroad Fellowship', purpose: 'Guide caravans and recover abandoned goods; contest ownership claimed by old authorities.', rival: 'masons' }
];
const FAITH = { wellkeepers: { patron: 'Dyanetzia', allegiance: 'Neutral' }, tollwardens: { patron: 'Arithus', allegiance: 'Hostile' },
  masons: { patron: 'Mordicar', allegiance: 'Neutral' }, salvagers: { patron: 'Poena', allegiance: 'Neutral' } };
const EVIL_PATRONS = ['Arithus', 'Dantuea', 'Sharlynn', 'Nameless Drake'];
function hostileTemple(setting, roomName = '') {
  return !!setting?.religion?.patron && Pantheon.canon(setting.religion.patron)?.allegiance === 'Hostile' &&
    (['roman_temple', 'byzantine_basilica', 'deity_temple'].includes(setting.siteKind) || /temple|basilica|sanctuary|shrine|chapel/i.test(roomName));
}
const BUILDINGS = new Set(['inn', 'house', 'guildhall', 'roman_temple', 'byzantine_basilica', 'castle', 'gatehouse', 'wizard_citadel', 'villa', ...Lore.BUILDINGS.map(row => row[0]), ...Fortified.TYPES]);
const COMMUNITIES = new Set(['oasis', 'hamlet', 'market', 'village', 'cavern_village', ...BUILDINGS]);
const AUTHORITY = ['elected wellkeepers', 'a council of household elders', 'a guild charter and rotating magistrate', 'a castellans court constrained by an old civic oath'];
const PREFIXES = ['Amber', 'Reed', 'Flint', 'Laurel', 'Copper', 'Juniper', 'Cinder', 'Willow'];
const SUFFIXES = ['Well', 'Crossing', 'Rest', 'Reach', 'Ford', 'Hearth', 'Gate', 'Haven'];
const SITES = { oasis: 'Spring Gardens', graveyard: 'Burial Grounds', hamlet: 'Commons', market: 'Exchange',
  inn: 'Wayfarers Inn', house: 'Courtyard House', guildhall: 'Guild Hall', roman_temple: 'Temple', byzantine_basilica: 'Basilica', castle: 'Fort', wizard_citadel: 'Citadel' };

function chapter(completed = 0, total = 21) {
  return Math.min(REGIONS.length - 1, Math.max(0, Math.floor(Math.max(0, completed) / Math.max(1, total) * REGIONS.length)));
}
function plan(input = {}) {
  const c = coordinates(input.targetKey); if (!c) return null;
  const realm = input.database?.[input.targetKey]?.planarRealm || input.database?.[input.sourceKey]?.planarRealm;
  if (realm) return { version: 1, regionId: realm.id, region: realm.name, communityId: realm.id, community: realm.name,
    siteKind: input.template || 'wasteland', building: BUILDINGS.has(input.template), inhabited: COMMUNITIES.has(input.template),
    subterranean: c.z < 0, ecology: realm.nature, livelihoods: [], pressure: 'Local affairs; knowledge of the Hades conflict depends on the authored faction.',
    faction: { id: realm.id, name: realm.factions[0]?.name || 'Independent natives', allegiance: 'Neutral' }, neighboringFactions: realm.factions,
    religion: { patron: null, allegiance: 'Neutral', practice: 'Local cosmology does not spawn deities or replace the canonical pantheon.' },
    planarRealm: structuredClone(realm), journey: 'Optional plane beyond Tartarus; geographic distance grants no quest progress or access to Hades.' };
  const source = input.database?.[input.sourceKey]?.campaignSetting;
  const zone = `${Math.floor(c.x / 4)},${Math.floor(c.y / 4)},${c.z}`;
  const stage = source?.zone === zone ? source.chapter : Math.min(REGIONS.length - 1,
    Math.max(chapter(input.completedQuests, input.totalQuests), Math.floor(Math.max(Math.abs(c.x), Math.abs(c.y)) / 12)));
  const atlas = input.database?.['0,0,0']?.campaignAtlas;
  const region = atlas?.regions?.[stage] || REGIONS[stage], h = I.hash(`${input.seed || ''}:region:${zone}`);
  const community = `${PREFIXES[h % PREFIXES.length]} ${SUFFIXES[Math.floor(h / 8) % SUFFIXES.length]}`;
  const baseFaction = (atlas?.factions || FACTIONS)[Math.floor(h / 64) % FACTIONS.length];
  const hostilePatron = EVIL_PATRONS[I.hash(zone + ':hostile-patron') % EVIL_PATRONS.length];
  const faction = { ...baseFaction, ...FAITH[baseFaction.id] };
  if (faction.allegiance === 'Hostile') faction.patron = hostilePatron;
  const template = input.template || 'wasteland';
  const patrons = Pantheon.names.filter(n => !['Mortacia', 'Arithus'].includes(n) && Pantheon.canon(n).allegiance === 'Neutral' && Pantheon.canon(n).interests.includes(template));
  const patron = faction.allegiance === 'Hostile' ? faction.patron :
    (patrons.length ? patrons : [faction.patron])[h % (patrons.length || 1)];
  return { version: 1, zone, chapter: stage, regionId: `${region.id}:${zone}`, region: region.name,
    ecology: region.ecology, livelihoods: region.livelihoods, pressure: region.pressure,
    underground: region.underground || Underground.REGIONAL_LAYERS[stage],
    subterranean: c.z < 0 || Underground.isUndergroundTemplate(template),
    communityId: `${region.id}:${zone}:settlement`, community, inhabited: COMMUNITIES.has(template),
    authority: AUTHORITY[Math.floor(h / 256) % AUTHORITY.length], faction: { ...faction },
    hostilePatron,
    neighboringFactions: (atlas?.factions || FACTIONS).filter(f => f.id !== faction.id).map(f => ({ ...f })),
    siteKind: template, building: BUILDINGS.has(template),
    religion: { patron, allegiance: Pantheon.canon(patron).allegiance, concern: Pantheon.canon(patron).obligation[0],
      practice: faction.allegiance === 'Hostile' ? 'The cult enforces tribute and its patron\'s authority; intruders at its temples are attacked.' : 'Local custodians preserve records and maintain shared shrines; devotion does not guarantee divine favor.' },
    suggestedName: SITES[template] ? `${community} ${SITES[template]}${['roman_temple', 'byzantine_basilica'].includes(template) ? ' of ' + patron : ''}` : null,
    journey: 'Tartarus to Hades; regional flavor follows stable geographic bands and verified quest progress. Flavor never grants access to Hades or completes quests.' };
}
function frontierTemplate(input = {}) {
  if (input.constraint || !coordinates(input.targetKey)) return input.template;
  const c = coordinates(input.targetKey);
  if (c.z < 0 || Underground.isUndergroundTemplate(input.template) || Fortified.TYPES.includes(input.template)) return input.template;
  const n = I.hash(`${input.seed || ''}:local-site:${input.targetKey}`) % 20;
  // Occasional inhabited sites, not a replacement for wilderness or existing complexes.
  if (input.sourceIndoor === true) return n === 0 ? 'inn' : n === 1 ? 'house' : n === 2 ? 'guildhall' : input.template;
  const special = ['oasis', 'graveyard', 'hamlet', 'market', 'inn', 'roman_temple', 'castle', 'house', 'wizard_citadel'];
  return c.z === 0 && n < special.length ? special[n] : input.template;
}
function install(database, roomKey, context) {
  const room = database?.[roomKey];
  if (!room || room.campaignSetting || !context) return false;
  room.campaignSetting = JSON.parse(JSON.stringify(context));
  room.regionId ||= context.regionId;
  if (context.building) room.complexId ||= `building:${roomKey}`;
  return true;
}
function describe(setting) {
  if (!setting) return '';
  if (setting.planarRealm) return require('./planarPortals').describe(setting.planarRealm);
  return `${Lore.GUIDANCE}\n[CAMPAIGN-SETTING] Read-only regional facts: ${JSON.stringify(setting)}.
${setting.subterranean ? 'This site is underground: use the saved underground ecology and existing entrances, with covered passages rather than a surface oasis or sky courtyard. Mines may have workers and crypts may have custodians; caves may instead have unaligned wildlife.' : 'The underground layer describes potential neighboring interiors, not a ceiling over this surface site.'}
Name actual physical places rather than interchangeable halls of sorrow. For a NEW inhabited site's name, use the saved community name and physical venue as the anchor; add a distinct local qualifier rather than repeating another room's name. Never rename an existing published destination. Describe water, shelter, work and daily community life, with one concrete local tension. A fertile oasis has real water and green vegetation, not dead trees with a poetic name. Graveyards have burial plots and caretaker paths. An inhabited place is not automatically hostile. Interiors use indoor plans; an outdoor approach may only mention entrances backed by real neighboring indoor rooms. Keep the published room name, routes, inhabitants, inventory and quest requirements authoritative. Faction aspirations are not completed events. Never mint silver, invent quests, award rewards, open boss gates or move named targets in prose. [/CAMPAIGN-SETTING]`;
}
function seedResidents(population, setting) {
  if (!setting || !population?.actors) return;
  if (setting.planarRealm) {
    for (const actor of Object.values(population.actors)) actor.communityId = setting.communityId;
    return;
  }
  Object.values(population.actors).forEach((actor, index) => {
    actor.communityId = setting.communityId;
    if (actor.regionalStoryId && FAITH[actor.factionId]) {
      actor.patron = actor.allegiance === 'Hostile' && setting.religion?.allegiance === 'Hostile' ? setting.religion.patron : FAITH[actor.factionId].patron;
      return;
    }
    actor.factionId = index % 4 === 3 ? setting.faction.rival : setting.faction.id;
    actor.patron = actor.allegiance === 'Hostile' ? hostileTemple(setting) ? setting.religion.patron : setting.hostilePatron || 'Arithus' : setting.religion?.patron || setting.faction.patron;
    if (actor.allegiance === 'Hostile') actor.factionId = setting.faction.allegiance === 'Hostile' ? setting.faction.id : 'tollwardens';
    if (actor.allegiance === 'Friendly' && setting.faction.allegiance === 'Hostile') { actor.factionId = setting.faction.rival; actor.patron = FAITH[actor.factionId]?.patron || 'Dyanetzia'; }
  });
}
function snapshot(room) {
  const s = room?.campaignSetting;
  return s ? { ...s, indoor: indoor(room) } : null;
}
function inferKind(room) {
  const planned = room?.environmentIntent?.template || room?.campaignSetting?.siteKind;
  if (Fortified.TYPES.includes(planned)) return planned;
  if (Underground.isUndergroundTemplate(planned)) return planned;
  const n = String(room?.name || '').toLowerCase();
  if (indoor(room) !== false) {
    if (/crypt|ossuary|tomb/.test(n)) return 'crypt';
    if (/catacomb/.test(n)) return 'catacomb';
    if (/lava tube|volcanic tube|basalt tunnel/.test(n)) return 'lava_tube';
    if (/\bmines?\b|mining gallery/.test(n)) return 'mine';
    if (/ice cave|frozen grotto/.test(n)) return 'ice_cave';
    if (/fungal|mushroom/.test(n) && /cave|cavern|grotto/.test(n)) return 'fungal_cavern';
    if (/crystal|geode/.test(n) && /cave|cavern|grotto/.test(n)) return 'crystal_cavern';
    if (/river cavern|underground river|subterranean watercourse/.test(n)) return 'underground_river';
    if (/cave|cavern|grotto/.test(n)) return 'cavern';
  }
  if (/oasis|spring gardens/.test(n)) return 'oasis';
  if (/graveyard|cemetery|burial grounds/.test(n)) return 'graveyard';
  if (/market|exchange|bazaar/.test(n)) return 'market';
  if (/village|hamlet|commons/.test(n)) return 'hamlet';
  if (/guild/.test(n)) return 'guildhall';
  if (/inn|lodging/.test(n)) return 'inn';
  if (/house|home|domus/.test(n)) return 'house';
  if (/citadel/.test(n)) return 'wizard_citadel';
  if (/fort|castle|keep/.test(n)) return 'castle';
  return indoor(room) === true ? 'catacomb' : 'wasteland';
}
const clean = (s, limit) => typeof s === 'string' ? s.replace(/[\x00-\x1f<>"`&\\{}]/g, ' ').trim().slice(0, limit) : '';
function validateAtlas(raw, runId) {
  if (!raw || !Array.isArray(raw.regions) || raw.regions.length !== REGIONS.length ||
      !Array.isArray(raw.factions) || raw.factions.length !== FACTIONS.length) return null;
  const regions = raw.regions.map((r, i) => ({ id: REGIONS[i].id, name: clean(r.name, 80), ecology: clean(r.ecology, 300),
    underground: r.underground === undefined ? Underground.REGIONAL_LAYERS[i] : clean(r.underground, 500),
    livelihoods: Array.isArray(r.livelihoods) ? r.livelihoods.slice(0, 3).map(s => clean(s, 60)) : [],
    pressure: clean(r.pressure, 160) }));
  const factions = raw.factions.map((f, i) => ({ id: FACTIONS[i].id, name: clean(f.name, 80),
    purpose: clean(f.purpose, 200), rival: FACTIONS[i].rival, ...FAITH[FACTIONS[i].id] }));
  if (regions.some(r => !r.name || !r.ecology || !r.underground || !r.pressure || r.livelihoods.length < 2 || r.livelihoods.some(s => !s)) ||
      factions.some(f => !f.name || !f.purpose) || new Set(factions.map(f => f.name.toLowerCase())).size !== factions.length) return null;
  return { version: 1, runId, source: 'validated-campaign-plan', origin: 'Tartarus', destination: 'Hades', regions, factions,
    connections: regions.slice(1).map((r, i) => ({ from: regions[i].id, to: r.id, kind: 'trade-and-pilgrim-route' })) };
}
async function prepareAtlas($, state) {
  const runId = state.getDungeonRunId(), db = JSON.parse(state.getRoomNameDatabase() || '{}');
  if (db['0,0,0']?.campaignAtlas?.runId === runId) return db['0,0,0'].campaignAtlas;
  let atlas = null, failure = 'Campaign planning disabled.';
  if (process.env.CAMPAIGN_SETTING !== 'off') try {
    $.model = 'gpt-4.1-mini'; $.temperature = .9;
    await $.user`${Lore.GUIDANCE}`;
    await require('./campaignMemory').appendPlanning($, state, 'campaign geography and faction planning');
    await $.user`Choose story-appropriate villages as clusters of real walk-in inns, homes, temples, citadels and other institutions, including shade refuges, soul registries, watch houses and cinder forges. Villages can stand within outdoor terrain or inside vast caverns far larger than a building. Choose which institutions and kinds of residents fit each district: concentrations of neutral shades and humanoids alongside stranger souls and optional coercive demon guards, refugees or dissidents. Siege pressure varies with geography and allegiance; do not impose one fixed cast, all-hostile settlements or a timetable of events.`;
    await $.user`Faction roles in array order are fixed: wellkeepers (Dyanetzia, neutral), coercive tollwardens (Arithus or another evil deity, hostile), burial masons (Mordicar, neutral), caravan salvagers (Poena, neutral). Evil temples are defended hostile sanctuaries, not public healing shops. Neutral healing temples are separate. Patronage is metadata; worship never spawns the actual god. Fit the four faction purposes to these roles.`;
    await $.user`${Underground.PLANNING_GUIDANCE} Each region MUST include an underground field (<=500 characters) explaining its geology, subterranean ecology, livelihoods and connections to the surface. This is broad planning, not new exits or quest placement.`;
    await $.user`Also plan intact castles, working fortresses, fantastic citadels, wizard towers and deity-aligned temples as occasional regional institutions. Explain their supply, governance, patronage and relation to nearby communities. They are approached outdoors and have stair-linked storeys with practical service spaces, upper halls and cellars. Some upper halls can later host quest bosses, but do not assign a boss, key or reward. Worship does not spawn a god. Arithus temples are hostile; Arithus himself appears only at the final throne room.`;
    await $.user`Plan broad campaign geography for a journey from Tartarus to the approaches of occupied Hades, ruled by Arithus. Return JSON only with four ordered regions [{name,ecology,livelihoods:[three trades],pressure}] and four factions [{name,purpose}]. Start in ash wastelands, then caravan marches, riverlands, and finally citadel approaches. Include occasional FERTILE spring oases, graveyards, inhabited settlements, wells, trade, neutral equipment shops and healing temples, guilds and competing governance. Explain what water or resource sustains each community and why travel routes connect it to the next region. These are broad districts, NOT specific rooms, exits, portable items, monsters, characters, quests, keys, rewards or events. Do not relocate quest targets or grant entry to Hades. Preserve the Ruined Temple starting point, Mortacia's lost Sepulchra and the existing campaign. Keep each ecology under 45 words and each pressure/purpose under 25 words. No commands or mechanics.`;
    const result = await Contracts.request($, { component: 'campaign-atlas', context: { runId }, maxTokens: 1900,
      parameters: { regions: Contracts.list({ name: Contracts.text(80), ecology: Contracts.text(300),
        underground: Contracts.text(500), livelihoods: [String], pressure: Contracts.text(160) }), factions: Contracts.list({ name: Contracts.text(80), purpose: Contracts.text(200) }) },
      validate(raw) {
        for (const [field, count] of [['regions', REGIONS.length], ['factions', FACTIONS.length]])
          if (!Array.isArray(raw?.[field]) || raw[field].length !== count) throw Error(`${field}: expected ${count} rows, in the supplied order.`);
        for (const [i, region] of raw.regions.entries()) {
          if (!Array.isArray(region?.livelihoods) || region.livelihoods.length < 2 || region.livelihoods.some(s => typeof s !== 'string' || !s.trim()))
            throw Error(`regions[${i}].livelihoods: expected two or three named trades.`);
        }
        const accepted = validateAtlas(raw, runId);
        if (!accepted) throw Error('Atlas fields must be nonempty within their character limits; faction names must be distinct.');
        return accepted;
      } });
    atlas = result.value; failure = result.error?.message || failure;
  } catch (error) { failure = error.message; Diagnostics.report('campaign-atlas', { status: 'rejected', runId, phase: 'prompt', reason: error }); }
  if (!atlas) Diagnostics.report('campaign-atlas', { status: 'fallback', runId, reason: failure, replacement: 'seeded-campaign-fallback' });
  atlas ||= { version: 1, runId, source: 'seeded-campaign-fallback', origin: 'Tartarus', destination: 'Hades',
    regions: REGIONS.map((r, i) => ({ ...r, underground: Underground.REGIONAL_LAYERS[i] })), factions: FACTIONS,
    connections: REGIONS.slice(1).map((r, i) => ({ from: REGIONS[i].id, to: r.id, kind: 'trade-and-pilgrim-route' })) };
  // Re-read after the optional request so other initialized room fields are retained.
  const latest = JSON.parse(state.getRoomNameDatabase() || '{}'); latest['0,0,0'] ||= {};
  if (latest['0,0,0'].campaignAtlas?.runId !== runId) latest['0,0,0'].campaignAtlas = atlas;
  state.setRoomNameDatabase(JSON.stringify(latest));
  await require('./campaignPlanningLog').capture(state, 'new-game campaign plan');
  return latest['0,0,0'].campaignAtlas;
}
module.exports = { REGIONS, FACTIONS, FAITH, EVIL_PATRONS, hostileTemple, chapter, plan, frontierTemplate, install, describe, seedResidents, snapshot, inferKind, validateAtlas, prepareAtlas };
