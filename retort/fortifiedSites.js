'use strict';
const Routes = require('../assets/outdoorRoutes');
const Contracts = require('./generationContracts');
const { hash } = require('../assets/dungeonInhabitants');
const Pantheon = require('../assets/pantheonCharacters');
const OFFSETS = { north: [0, 1, 0], northeast: [1, 1, 0], east: [1, 0, 0], southeast: [1, -1, 0],
  south: [0, -1, 0], southwest: [-1, -1, 0], west: [-1, 0, 0], northwest: [-1, 1, 0] };
const REVERSE = { north: 'south', northeast: 'southwest', east: 'west', southeast: 'northwest',
  south: 'north', southwest: 'northeast', west: 'east', northwest: 'southeast' };
const canonicalType = type => ({ castle: 'medieval_castle', wizard_citadel: 'fantastic_citadel',
  roman_temple: 'deity_temple', byzantine_basilica: 'deity_temple' })[type] || type;

const TYPES = ['medieval_castle', 'fortress', 'fantastic_citadel', 'wizard_tower', 'deity_temple'];
const TEMPLATES = [
  ['medieval_castle', true, 'fortress', 'castle', 'An intact medieval castle entered from an outdoor approach, with a defended gatehouse, a great hall, service rooms, private upper chambers, cellars and battlements connected by stairs.', 'Name a constructed castle, not a ruin or temple.'],
  ['fortress', true, 'fortress', 'castle', 'An intact medieval fortress entered from outside, with gate defences, barracks, an armoury, stores, a command hall and upper wall walks connected by stairs.', 'Name a working fortress or stronghold, not a ruined courtyard.'],
  ['fantastic_citadel', true, 'fortress', 'castle', 'A complete fantastic medieval citadel approached outdoors, with curtain walls, soaring towers, vaulted civic halls, private upper chambers and stair-linked battlements.', 'Name a citadel with a recognizable medieval fortified silhouette.'],
  ['wizard_tower', true, 'fortress', 'castle', 'An intact medieval wizard tower entered from outside, with a gate vestibule, library, workshops, private studies and an upper observatory reached by stairs.', 'Retain wizard tower in its name; not a floating platform or ruined temple.'],
  ['deity_temple', true, 'temple', 'temple', 'An intact deity-aligned temple entered from an outdoor forecourt, with a patron-specific entrance, sanctuary, lower burial vaults and stair-linked priestly and upper ceremonial chambers.', 'Name a temple or sanctuary, with patron-specific rather than generic ruined imagery.']
];
const FUNCTIONS = {
  medieval_castle: ['Cellars, cistern and dungeon cells', 'Gatehouse, guardrooms, kitchens and great hall', 'Solar, private chambers and chapel', 'Battlements, wall walks and watch chambers'],
  fortress: ['Cistern, stores and prison cells', 'Gatehouse, barracks, mess hall and armoury', 'Command hall, officers quarters and map room', 'Battlements, signal posts and watch chambers'],
  fantastic_citadel: ['Undercroft, cistern and treasuries', 'Defended gatehouse, audience hall and service courts', 'Council hall, private chambers and archives', 'High tower chambers and fortified parapets'],
  wizard_tower: ['Cellars and material workshops', 'Guarded vestibule, receiving hall and kitchen', 'Library, scriptorium and private study', 'Laboratories and protected ritual chambers', 'Observatory and upper tower chamber'],
  deity_temple: ['Burial crypt, memorial vaults and stores', 'Entrance, patron-specific sanctuary and ceremonial hall', 'Priestly chambers, library and reliquary gallery', 'Upper ceremonial chamber and sacred tower']
};
const isType = value => TYPES.includes(canonicalType(value));
const isFloor = room => room?.fortifiedFloor?.version === 1;
const singleLine = (s, max) => typeof s === 'string' && s.trim() && s.length <= max && !/[<>\r\n|`]/.test(s);
const key = Routes.keyOf;
function protectedKeys(database, input = {}) {
  const keys = Routes.coordinateKeys([input.bossCoordinates, ...(input.protectedKeys || [])]);
  for (const [roomKey, room] of Object.entries(database)) {
    if (room?.bossGate) { keys.add(roomKey); for (const k of Routes.coordinateKeys([room.bossGate.targetKey, room.bossGate.targetCoordinates])) keys.add(k); }
  }
  for (const task of input.tasks || []) {
    for (const e of [...(task.elements || []), ...(task.requiredElements || [])]) {
      const c = Routes.coordinates(e?.placement); if (c) keys.add(key(c));
    }
    for (const r of [...(task.hardRequirements || []), ...(task.actionRequirements || [])]) {
      const c = Routes.coordinates(r?.coords || (r?.check === 'at_coords' ? r.value : null)); if (c) keys.add(key(c));
    }
  }
  return keys;
}
function route(database, sourceKey, direction, template, input = {}, allowNew = false) {
  template = canonicalType(template);
  const source = database[sourceKey], c = Routes.coordinates(sourceKey), offset = OFFSETS[direction];
  if (!c || Routes.indoor(source) !== false || c.z < 0 || !isType(template) || !offset || offset[2]) return null;
  const resolved = source.exits?.[direction] && Routes.resolveExit(c, direction, source.exits);
  const entryKey = resolved?.targetKey || key({ x: c.x + offset[0], y: c.y + offset[1], z: c.z });
  if (!allowNew && !resolved) return null;
  const entry = database[entryKey], at = Routes.coordinates(entryKey);
  if (!at || at.z !== c.z || entryKey === '0,0,0' || isFloor(entry) || entry?.description || entry?.roomDescription || entry?.sceneSpec ||
      entry?.visited || entry?.populationComplete || entry?.objects?.length || entry?.regionalSite || entry?.bossGate ||
      entry?.questStories || entry?.questScenes || entry?.inscriptions?.length ||
      entry?.monsters?.inRoom && !/^(none|empty)$/i.test(entry.monsters.inRoom.trim()) ||
      Object.keys(entry?.inhabitants?.actors || {}).length || Object.keys(entry?.exits || {}).some(d => d !== REVERSE[direction])) return null;
  if (allowNew && entry) return null;
  const protectedSet = protectedKeys(database, input);
  const floors = FUNCTIONS[template].map((purpose, i) => ({ level: i - 1, purpose,
    key: key({ ...at, z: at.z + i - 1 }) }));
  if (floors.some(f => protectedSet.has(f.key) || f.key !== entryKey && database[f.key])) return null;
  return { sourceKey, direction, entryKey, template, floors,
    expectedPatron: template === 'deity_temple' ? require('../assets/shrineIconography').find(entry?.name || '') : null,
    sourceExit: structuredClone(source.exits?.[direction] || null) };
}
function validate(raw, planned) {
  for (const [field, max] of [['history', 500], ['purpose', 250], ['heraldry', 120]])
    if (!singleLine(raw?.[field], max)) throw Error(`${field}: required single-line text <=${max} characters.`);
  if (planned.template === 'deity_temple' && !Pantheon.canon(raw.patron)) throw Error('patron: choose a canonical deity.');
  if (planned.expectedPatron && raw.patron !== planned.expectedPatron) throw Error(`patron must remain ${planned.expectedPatron}, as named in this temple.`);
  if (!singleLine(raw.name, 80)) throw Error('name: required unique site name <=80 characters.');
  if (!Array.isArray(raw.floors) || raw.floors.length !== planned.floors.length) throw Error(`floors: expected ${planned.floors.length} ordered storeys, beginning with the cellar.`);
  const labels = new Set();
  for (const f of raw.floors) {
    if (!singleLine(f?.label, 65) || !singleLine(f?.flavor, 400)) throw Error('Each floor needs label <=65 and flavor <=400 characters.');
    const label = f.label.trim().toLowerCase(); if (labels.has(label)) throw Error('Floor labels must be distinct.'); labels.add(label);
  }
  return raw;
}
function compile(database, planned, raw, runId) {
  validate(raw, planned);
  const Campaign = require('./campaignSetting'), catalog = require('./environmentIntents').CATALOG;
  const entry = database[planned.entryKey], title = entry?.name || raw.name.trim();
  const temple = planned.template === 'deity_temple', patron = temple ? Pantheon.name(raw.patron) : null;
  const id = `fortified:${runId}:${planned.entryKey}`, back = REVERSE[planned.direction];
  const site = { version: 1, id, template: planned.template, name: title, approachKey: planned.sourceKey,
    entryKey: planned.entryKey, history: raw.history.trim(), purpose: raw.purpose.trim(), heraldry: raw.heraldry.trim(),
    rooms: planned.floors.map(f => f.key), levels: planned.floors.length, patron, style: temple ? 'intact-deity-temple' : 'intact-medieval',
    surfaceModel: 'separate-world-xyz-storeys', bossCandidates: planned.floors.filter(f => f.level >= 1).map(f => f.key) };
  const rooms = {};
  for (const [i, f] of planned.floors.entries()) {
    const name = f.key === planned.entryKey ? title : `${title} ${raw.floors[i].label.trim()}`;
    if (Object.entries(database).some(([k, r]) => k !== f.key && r?.name?.toLowerCase() === name.toLowerCase())) throw Error('A storey name duplicates an existing room.');
    const setting = Campaign.plan({ database, sourceKey: planned.sourceKey, targetKey: f.key, template: planned.template, seed: runId });
    setting.subterranean = f.level < 0; setting.building = true;
    if (temple) {
      const canon = Pantheon.canon(patron);
      setting.religion = { patron, allegiance: canon.allegiance, concern: canon.domain,
        practice: canon.allegiance === 'Hostile' ? 'This defended hostile temple attacks intruders; it is not a neutral shop.' : 'Custodians maintain this patron\'s sanctuary and records.' };
      if (canon.allegiance === 'Hostile') { setting.hostilePatron = patron; setting.faction = { ...Campaign.FACTIONS[1], patron, allegiance: 'Hostile' }; }
    }
    const exits = { ...(i > 0 ? { down: { status: 'open', targetCoordinates: planned.floors[i - 1].key } } : {}),
      ...(i + 1 < planned.floors.length ? { up: { status: 'open', targetCoordinates: planned.floors[i + 1].key } } : {}),
      ...(f.level === 0 ? { [back]: { status: 'open', targetCoordinates: planned.sourceKey } } : {}) };
    rooms[f.key] = { ...(f.key === planned.entryKey ? entry : {}), name, indoor: true, isIndoor: true, isOutdoor: false,
      complexId: id, classification: { indoor: true, biome: temple ? 'temple' : 'fortress', size: 64, features: [] }, exits,
      objects: [], monsters: { inRoom: 'None', equippedProperties: 'None', state: 'None' },
      environmentIntent: { ...catalog[planned.template], targetKey: f.key }, campaignSetting: setting,
      fortifiedFloor: { version: 1, siteId: id, template: planned.template, entryKey: planned.entryKey,
        approachKey: planned.sourceKey, level: f.level, purpose: f.purpose, flavor: raw.floors[i].flavor.trim(),
        history: site.history, heraldry: site.heraldry, patron, stairs: Object.keys(exits).filter(d => d === 'up' || d === 'down'),
        bossEligible: site.bossCandidates.includes(f.key) }, ...(f.level === 0 ? { fortifiedSite: site } : {}) };
  }
  const floorNames = Object.values(rooms).map(r => r.name.toLowerCase());
  if (new Set(floorNames).size !== floorNames.length) throw Error('Storey names must be distinct.');
  return { site, rooms };
}
async function seed($, database, planned, input = {}) {
  const snapshot = JSON.stringify([database[planned.sourceKey], ...planned.floors.map(f => database[f.key])]);
  await $.assistant`Design an intact ${planned.template === 'deity_temple' ? 'deity-aligned temple' : 'medieval ' + planned.template.replace(/_/g, ' ')} for this outdoor approach in Children of the Grave.
Use this saved campaign context: ${JSON.stringify({ approach: database[planned.sourceKey]?.name, region: database[planned.sourceKey]?.campaignSetting,
    atlas: database['0,0,0']?.campaignAtlas, existingName: database[planned.entryKey]?.name, floors: planned.floors })}.
Return name (unique site name <=80 characters; preserve existingName when supplied), history (<=500 characters), purpose (<=250), heraldry (<=120), floors [{label <=65, flavor <=400}] in exactly the supplied order.
Patron: ${planned.template === 'deity_temple' ? 'Choose ' + (planned.expectedPatron || 'a canonical deity consistent with the region: ' + Pantheon.names.join(', ')) + '. Use that deity\'s canonical symbols, domains and appearance. Evil temples are hostile. No god is physically spawned, and Arithus himself remains exclusive to the final throne room.' : 'Set patron to none.'}
The building is COMPLETE and maintained, not a ruin. Castles, fortresses and towers are medieval: include gate defences, arrow slits, portcullises, battlements, banners, guard quarters, kitchens, stores and appropriate roofed halls. Temples instead use appropriate classical, Gothic or Byzantine sacred architecture and this deity's exact symbols, altar, effigies and reliefs. Wizard towers add libraries, studies, laboratories and observatories; citadels can have fantastic spires grounded in real masonry. Spread these features across the floor purposes, not identical halls. State who maintains the place and how it relates to regional factions, resources and the underworld campaign. A guard post, dungeon cell or treasury does not automatically contain a spawned actor or portable treasure.
Each floor is its own room at the supplied XYZ coordinate; stairs connect adjacent storeys. Lower ceilings are the underside of the floor above. No floating floors, elevators or unsupported stacked surfaces inside one map. The approach is OUTSIDE; all these rooms are INSIDE. Do not invent exits, keys, quests, characters, rewards or boss assignments. Upper rooms may later host a quest boss, but the existing quest engine alone owns boss placement and locks. Flavor is physical planning guidance, not a replacement Room Description. Use the requested Retort fields, single-line values only.`;
  const generated = await Contracts.request($, { component: 'fortified-site', context: { geoKey: planned.entryKey }, maxTokens: 1800,
    parameters: { name: Contracts.text(80), history: Contracts.text(500), purpose: Contracts.text(250), heraldry: Contracts.text(120), patron: Contracts.choice(planned.template === 'deity_temple' ? planned.expectedPatron ? [planned.expectedPatron] : Pantheon.names : ['none']),
      floors: Contracts.list({ label: Contracts.text(65), flavor: Contracts.text(400) }) }, validate: value => {
        compile(database, planned, value, input.seed || 'campaign'); return value;
      } });
  if (!generated.value) throw Error(`Fortified site generation failed: ${generated.error?.message || 'invalid structured plan'}`);
  const fresh = route(database, planned.sourceKey, planned.direction, planned.template, input, !database[planned.entryKey]);
  if (!fresh || JSON.stringify([database[planned.sourceKey], ...planned.floors.map(f => database[f.key])]) !== snapshot) return { status: 'skipped', reason: 'world-changed' };
  const compiled = compile(database, fresh, generated.value, input.seed || 'campaign');
  Object.assign(database, compiled.rooms);
  const source = database[planned.sourceKey]; source.exits ||= {};
  source.exits[planned.direction] ||= { status: 'open', targetCoordinates: planned.entryKey };
  source.fortifiedApproaches ||= [];
  source.fortifiedApproaches.push({ siteId: compiled.site.id, entryKey: planned.entryKey, direction: planned.direction });
  return { status: 'installed', siteId: compiled.site.id, rooms: compiled.site.rooms };
}
async function extend($, database, sourceKey, input = {}) {
  const source = database[sourceKey], c = Routes.coordinates(sourceKey);
  if (!source || source.villagePlan || source.villageBuilding || Routes.indoor(source) !== false || !c || c.z < 0 || source.fortifiedSiteScan === 1) return [];
  const results = [];
  for (const [direction, exit] of Object.entries(source.exits || {})) {
    const target = Routes.resolveExit(c, direction, source.exits).targetKey, room = database[target];
    const template = room?.environmentIntent?.template;
    if (isType(template) && !isFloor(room)) {
      const p = route(database, sourceKey, direction, template, input);
      if (p) results.push(await seed($, database, p, input));
    }
  }
  const vast = /\b(vast|expanse|expanses|sprawling|immense)\b/i.test(`${source.name || ''} ${source.description || input.description || ''}`);
  const roll = hash(`${input.seed || ''}:fortified:${sourceKey}`);
  const desired = vast ? 1 + roll % 2 : roll % 10 === 0 ? 1 : 0;
  const visibleBuildings = () => Object.entries(source.exits || {}).filter(([d]) => {
    const target = database[Routes.resolveExit(c, d, source.exits).targetKey]; return Routes.indoor(target) === true;
  }).length;
  for (const direction of Object.keys(OFFSETS).sort((a, b) => hash(sourceKey + a) - hash(sourceKey + b))) {
    if (source.exits?.[direction] || (source.fortifiedApproaches?.length || 0) >= desired || visibleBuildings() >= 2) continue;
    const template = TYPES[hash(`${input.seed || ''}:${sourceKey}:${direction}`) % TYPES.length];
    const p = route(database, sourceKey, direction, template, input, true);
    if (p) results.push(await seed($, database, p, input));
  }
  source.fortifiedSiteScan = 1;
  return results;
}
function describe(room) {
  if (!isFloor(room)) return '';
  return `[FORTIFIED-FLOOR] Authoritative building plan: ${JSON.stringify(room.fortifiedFloor)}. This is an intact ${room.fortifiedFloor.patron ? 'temple of ' + room.fortifiedFloor.patron : 'medieval'} interior, with a solid roof/floor above unless an explicitly named top-floor wall walk. Describe this storey's practical purpose and maintained trappings. Stair exits are real links between world XYZ rooms, not portals or arbitrary caves. Preserve the exact existing name, exits, actors, items and quest bindings. Never turn it into a ruined temple, mint keys, complete missions or assign a boss. [/FORTIFIED-FLOOR]`;
}
function bossCandidates(database, input = {}) {
  const protectedSet = protectedKeys(database, input);
  return Object.entries(database).filter(([k, r]) => !protectedSet.has(k) && isFloor(r) && r.fortifiedFloor.bossEligible &&
    !r.visited && !r.description && !r.roomDescription && !r.sceneSpec && !r.populationComplete && !r.bossGate && !r.objects?.length &&
    !r.questStories && !r.questScenes && !r.inscriptions?.length && (!r.monsters?.inRoom || /^(none|empty)$/i.test(r.monsters.inRoom.trim())) &&
    !Object.keys(r.inhabitants?.actors || {}).length)
    .slice(0, 12).map(([coordinates, r]) => ({ coordinates, name: r.name, siteId: r.complexId, purpose: r.fortifiedFloor.purpose }));
}
module.exports = { TYPES, TEMPLATES, FUNCTIONS, isType, isFloor, protectedKeys, route, validate, compile, seed, extend, describe, bossCandidates };
