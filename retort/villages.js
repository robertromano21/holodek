'use strict';
const Routes = require('../assets/outdoorRoutes');
const Contracts = require('./generationContracts');
const Fortified = require('./fortifiedSites');
const Lore = require('./underworldLore');

const BUILDINGS = ['inn', 'house', 'guildhall', 'roman_temple', 'byzantine_basilica', 'wizard_citadel',
  ...Lore.BUILDINGS.map(row => row[0])];
const OFFSETS = { north: [0, 1], northeast: [1, 1], east: [1, 0], southeast: [1, -1],
  south: [0, -1], southwest: [-1, -1], west: [-1, 0], northwest: [-1, 1] };
const REVERSE = { north: 'south', northeast: 'southwest', east: 'west', southeast: 'northwest',
  south: 'north', southwest: 'northeast', west: 'east', northwest: 'southeast' };
const text = (s, max) => typeof s === 'string' && s.trim() && s.length <= max && !/[<>\r\n|`]/.test(s);
const fresh = r => r && !r.description && !r.roomDescription && !r.sceneSpec && !r.dungeon && !r.visited &&
  !r.populationComplete && !r.regionalSite && !r.fortifiedFloor && !r.villageBuilding && !r.bossGate &&
  !r.questStories && !r.questScenes && !r.objects?.length && !r.inscriptions?.length &&
  !Object.keys(r.inhabitants?.actors || {}).length && (!r.monsters?.inRoom || /^(none|empty)$/i.test(r.monsters.inRoom.trim()));

function candidates(database, sourceKey, input = {}) {
  const source = database[sourceKey], c = Routes.coordinates(sourceKey);
  if (!c || sourceKey === '0,0,0' || !fresh(source) || source.villagePlan || source.villageScan) return null;
  const inside = Routes.indoor(source), template = source.environmentIntent?.template;
  const cavern = inside === true && (template === 'cavern_village' || source.classification?.biome === 'cave') &&
    (template === 'cavern_village' || Number(source.classification?.size) >= 128);
  if (inside !== false && !cavern) return null;
  const protectedSet = Fortified.protectedKeys(database, input);
  if (protectedSet.has(sourceKey)) return null;
  const sites = Object.entries(OFFSETS).flatMap(([direction, [dx, dy]]) => {
    const targetKey = Routes.keyOf({ x: c.x + dx, y: c.y + dy, z: c.z });
    return source.exits?.[direction] || input.reservedDirections?.includes(direction) || database[targetKey] || protectedSet.has(targetKey) ? [] : [{ direction, targetKey }];
  });
  return sites.length >= 2 ? { sourceKey, cavern, sites } : null;
}

function validate(raw, planned, database) {
  if (typeof raw?.village !== 'boolean') throw Error('village must be true or false.');
  if (!raw.village) return { village: false };
  for (const [field, max] of [['name', 80], ['history', 400], ['sustenance', 240], ['pressure', 240], ['population', 400]])
    if (!text(raw[field], max)) throw Error(`${field}: required single-line text <=${max} characters.`);
  if (!Array.isArray(raw.buildings) || raw.buildings.length < 2 || raw.buildings.length > 4)
    throw Error('Choose two to four buildings on different available directions.');
  const directions = new Set(), names = new Set(Object.values(database).map(r => r?.name?.toLowerCase()).filter(Boolean));
  for (const row of raw.buildings) {
    if (!planned.sites.some(s => s.direction === row?.direction) || directions.has(row.direction) || !BUILDINGS.includes(row.template) ||
        !text(row.name, 80) || names.has(row.name.toLowerCase()) || !text(row.purpose, 240))
      throw Error('Each building needs an unused allowed direction, catalog template, unique name and concrete purpose.');
    directions.add(row.direction); names.add(row.name.toLowerCase());
  }
  return { village: true, ...Object.fromEntries(['name', 'history', 'sustenance', 'pressure', 'population'].map(k => [k, raw[k].trim()])),
    buildings: raw.buildings.map(r => ({ direction: r.direction, template: r.template, name: r.name.trim(), purpose: r.purpose.trim() })) };
}

function install(database, planned, raw, input = {}) {
  if (!planned || !raw?.village || !Array.isArray(raw.buildings)) return false;
  const live = candidates(database, planned.sourceKey, input);
  if (!live || live.cavern !== planned.cavern || raw.buildings.some(row =>
    !live.sites.some(s => s.direction === row.direction && s.targetKey === planned.sites.find(p => p.direction === row.direction)?.targetKey))) return false;
  const accepted = validate(raw, live, database), source = database[planned.sourceKey];
  const Campaign = require('./campaignSetting'), catalog = require('./environmentIntents').CATALOG;
  const id = `village:${input.seed || 'campaign'}:${planned.sourceKey}`;
  const settings = source.campaignSetting || Campaign.plan({ ...input, database, targetKey: planned.sourceKey,
    template: planned.cavern ? 'cavern_village' : 'village' });
  const plan = { version: 1, id, ...accepted, container: planned.cavern ? 'vast-cavern' : 'outdoor',
    buildings: accepted.buildings.map(row => ({ ...row, entryKey: live.sites.find(s => s.direction === row.direction).targetKey })) };
  const rooms = {};
  for (const row of plan.buildings) {
    const canonical = catalog[row.template];
    rooms[row.entryKey] = { name: row.name, indoor: true, isIndoor: true, isOutdoor: false,
      complexId: `building:${row.entryKey}`, classification: { indoor: true, size: 64, biome: canonical.biome, architecture: canonical.architecture, features: [] },
      exits: { [REVERSE[row.direction]]: { status: 'open', targetCoordinates: planned.sourceKey } }, objects: [],
      monsters: { inRoom: 'None', state: 'None', equippedProperties: 'None' },
      environmentIntent: { ...canonical, targetKey: row.entryKey, narrativeHint: row.purpose },
      villageBuilding: { version: 1, villageId: id, hubKey: planned.sourceKey, purpose: row.purpose },
      campaignSetting: { ...structuredClone(settings), inhabited: true, community: plan.name, communityId: id,
        siteKind: row.template, building: true, subterranean: planned.cavern, suggestedName: row.name,
        village: { id, name: plan.name, pressure: plan.pressure, population: plan.population, venue: row.purpose } } };
  }
  // Validate everything before publishing any rooms or links. Existing routes are never repurposed.
  Object.assign(database, rooms);
  source.exits ||= {};
  for (const row of plan.buildings) source.exits[row.direction] = { status: 'open', targetCoordinates: row.entryKey };
  source.villagePlan = plan; source.villageScan = 1;
  source.campaignSetting = { ...settings, inhabited: true, building: false, community: plan.name, communityId: id,
    village: { id, name: plan.name, pressure: plan.pressure, population: plan.population, venue: 'commons', directions: plan.buildings.map(row => row.direction) } };
  if (planned.cavern) { source.classification ||= {}; source.classification.size = 192; }
  return true;
}

async function prepare($, database, sourceKey, input = {}) {
  const planned = candidates(database, sourceKey, input);
  if (!planned || typeof $?.assistant?.generation !== 'function') return { status: 'skipped' };
  const source = database[sourceKey], snapshot = JSON.stringify(source);
  await $.user`${Lore.GUIDANCE}
Decide whether a VILLAGE belongs in this new location because of the story, regional needs, geography or prior choices. Most wilderness remains wilderness: village:false is a valid creative choice, never add a village merely to fill slots. A named village/hamlet intent calls for a settlement when space permits.
Context (data): ${JSON.stringify({ name: source.name, region: source.campaignSetting, intent: source.environmentIntent,
    quest: input.currentQuest, tasks: input.tasks, recalled: input.recalled, cavern: planned.cavern, availableSites: planned.sites })}.
If village:true, choose a community name (not a rename of this location), history <=400, sustenance <=240, pressure <=240 and population <=400 characters. Choose TWO to FOUR walk-in buildings from ${BUILDINGS.join(', ')} and their directions from availableSites. Each needs a distinct name <=80 and purpose <=240 characters. You choose which buildings, who uses them and where, not a fixed settlement recipe. Consider inns, temples and citadels alongside shade refuges, soul registries, watch houses and cinder forges. Do not include every kind. Prefer concentrations of neutral residents with optional hostile watch guards, collaborators, dissidents or threats; choose species and loyalties, not a mandatory demon guard or quota of races. Fear, coercion and survival suit this besieged afterlife, but not everyone is hostile.
${planned.cavern ? 'This is a VAST enclosed cavern, much larger than any building: a 192-cell chamber with high solid rock ceiling, settlement streets below it, no sky or surface courtyard. Buildings must fit below the cave roof.' : 'This is an outdoor insert within the actual terrain, with open lanes and continuing wilderness routes, not a single indoor hall.'}
Only supplied unused directions can become building entrances. Preserve all existing routes, names, locks, quest targets and actors. No new quests, items, money, gods, rewards or completed siege events. Return the requested structured fields. For village:false use empty text fields and buildings:[].`;
  const result = await Contracts.request($, { component: 'village-plan', context: { geoKey: sourceKey }, maxTokens: 1800,
    parameters: { village: Boolean, name: { type: String, maxLength: 80 }, history: { type: String, maxLength: 400 },
      sustenance: { type: String, maxLength: 240 }, pressure: { type: String, maxLength: 240 }, population: { type: String, maxLength: 400 },
      buildings: Contracts.list({ direction: Contracts.choice(planned.sites.map(s => s.direction)), template: Contracts.choice(BUILDINGS),
        name: Contracts.text(80), purpose: Contracts.text(240) }) }, validate: raw => validate(raw, planned, database) });
  if (!result.value) throw Error(`Village planning failed: ${result.error?.message || 'invalid plan'}`);
  if (JSON.stringify(database[sourceKey]) !== snapshot) return { status: 'skipped', reason: 'world-changed' };
  if (!result.value.village) { source.villageScan = 1; return { status: 'declined' }; }
  return install(database, planned, result.value, input) ? { status: 'installed', buildings: source.villagePlan.buildings.length } :
    { status: 'skipped', reason: 'occupied-or-protected-sites' };
}

function describe(room) {
  if (!room?.villagePlan && !room?.villageBuilding) return '';
  return `[VILLAGE] Saved physical plan (data): ${JSON.stringify(room.villagePlan || room.villageBuilding)}.
Describe the existing community's structures and customs, not an invented list of residents or new exits. Each building entrance has a real neighboring indoor room. ${room.villagePlan?.container === 'vast-cavern' ? 'The cavern encloses the entire village beneath a high continuous rock ceiling; it is much larger than a building.' : ''} Saved population intentions guide later inhabitant generation, not proof that a named actor exists. [/VILLAGE]`;
}
module.exports = { BUILDINGS, candidates, validate, install, prepare, describe };
