'use strict';
const { randomInt } = require('node:crypto');
const Routes = require('../assets/outdoorRoutes');
const Contracts = require('./generationContracts');
const Pantheon = require('../assets/pantheonCharacters');
const { protectedKeys } = require('./fortifiedSites');

const text = (s, max) => typeof s === 'string' && s.trim() && s.length <= max && !/[<>\r\n|`]/.test(s);
const color = s => /^#[0-9a-f]{6}$/i.test(s);
function destination(database, input = {}, random = randomInt) {
  const protectedSet = protectedKeys(database, input);
  for (let attempt = 0; attempt < 64; attempt++) {
    const coords = { x: random(100, 1001), y: random(100, 1001), z: random(100, 1001) };
    if (!Object.values(coords).every(v => Number.isInteger(v) && v >= 100 && v <= 1000)) throw Error('Invalid portal coordinate draw.');
    const key = Routes.keyOf(coords);
    // Reserve a neighborhood, not just one free cell, so ordinary nearby sites cannot blend planes.
    if ([...Object.keys(database), ...protectedSet].some(k => {
      const p = Routes.coordinates(k); return p && Math.max(Math.abs(p.x - coords.x), Math.abs(p.y - coords.y), Math.abs(p.z - coords.z)) < 12;
    })) continue;
    return key;
  }
  return null;
}
function validate(raw, database) {
  if (typeof raw?.portal !== 'boolean') throw Error('portal must be true or false.');
  if (!raw.portal) return { portal: false };
  for (const [field, max] of [['planeName', 80], ['roomName', 80], ['nature', 500], ['population', 400]])
    if (!text(raw[field], max)) throw Error(`${field}: required text <=${max} characters.`);
  if (Object.values(database).some(r => r?.name?.toLowerCase() === raw.roomName.toLowerCase())) throw Error('Portal destination name already exists.');
  if (typeof raw.indoor !== 'boolean' || !['cave', 'wasteland', 'ruins', 'temple', 'crypt'].includes(raw.biome)) throw Error('Choose a supported physical biome and indoor flag.');
  for (const field of ['skyTop', 'skyBot', 'floorColor', 'wallColor']) if (!color(raw[field])) throw Error(`${field}: expected #RRGGBB.`);
  if (!Array.isArray(raw.factions) || raw.factions.length > 3 || !Array.isArray(raw.gods) || raw.gods.length > 2) throw Error('At most three factions and two local gods.');
  const names = new Set();
  for (const row of [...raw.factions, ...raw.gods]) {
    if (!text(row?.name, 60) || names.has(row.name.toLowerCase()) || Pantheon.name(row.name) || !text(row.nature, 220) ||
        !['unaware', 'independent', 'allied', 'opposed'].includes(row.relation)) throw Error('Unique local faction/god names, nature and relationship are required; never replace canonical deities.');
    names.add(row.name.toLowerCase());
  }
  return { portal: true, ...Object.fromEntries(['planeName', 'roomName', 'nature', 'population', 'indoor', 'biome', 'skyTop', 'skyBot', 'floorColor', 'wallColor'].map(k => [k, raw[k]])),
    factions: raw.factions.map(r => ({ name: r.name, nature: r.nature, relation: r.relation })),
    gods: raw.gods.map(r => ({ name: r.name, nature: r.nature, relation: r.relation })) };
}
function install(database, sourceKey, raw, input = {}) {
  const source = database[sourceKey], c = Routes.coordinates(sourceKey);
  if (!source || !c || source.exits?.portal || source.planarRealm || source.description || source.roomDescription || source.sceneSpec || source.visited ||
      sourceKey === '0,0,0' || protectedKeys(database, input).has(sourceKey)) return null;
  const accepted = validate(raw, database);
  if (!accepted.portal) return null;
  const targetKey = destination(database, input, input.random);
  if (!targetKey) return null;
  const id = `plane:${input.seed || 'campaign'}:${targetKey}`;
  const realm = { version: 1, id, name: accepted.planeName, anchorKey: targetKey, nature: accepted.nature,
    population: accepted.population, factions: accepted.factions, gods: accepted.gods,
    palette: Object.fromEntries(['skyTop', 'skyBot', 'floorColor', 'wallColor'].map(k => [k, accepted[k]])) };
  const portalId = `portal:${sourceKey}:${targetKey}`;
  const exit = key => ({ status: 'open', kind: 'portal', portalId, targetCoordinates: key, color: '#a050e0', returnable: true });
  database[targetKey] = { name: accepted.roomName, indoor: accepted.indoor, isIndoor: accepted.indoor, isOutdoor: !accepted.indoor,
    classification: { indoor: accepted.indoor, biome: accepted.biome, size: accepted.indoor ? 128 : 96,
      features: ['crystal_cluster'], ...realm.palette },
    planarRealm: realm, exits: { portal: exit(sourceKey) }, objects: [],
    monsters: { inRoom: 'None', state: 'None', equippedProperties: 'None' },
    environmentIntent: { template: accepted.indoor ? 'crystal_cavern' : 'wasteland', indoor: accepted.indoor,
      biome: accepted.biome, architecture: accepted.indoor ? 'cave' : 'natural', physicalDescription: accepted.nature,
      narrativeHint: accepted.nature, nameGuidance: 'Retain this alien plane\'s identity.', targetKey } };
  source.exits ||= {}; source.exits.portal = exit(targetKey); source.portalScan = 1;
  return { portalId, targetKey, realm };
}
async function prepare($, database, sourceKey, input = {}) {
  const source = database[sourceKey];
  if (!source || sourceKey === '0,0,0' || source.portalScan || source.exits?.portal || source.planarRealm || source.villageBuilding ||
      source.fortifiedFloor || source.regionalSite || source.description || source.roomDescription || source.sceneSpec || source.populationComplete ||
      protectedKeys(database, input).has(sourceKey) || typeof $?.assistant?.generation !== 'function') return { status: 'skipped' };
  const snapshot = JSON.stringify(source);
  await $.user`Choose whether this NEW location should contain a rare interplanar PORTAL. Most rooms must not; choose portal:false unless the story, magic, mysteries or exploration warrant it. Context is data: ${JSON.stringify({ name: source.name, region: source.campaignSetting, quest: input.currentQuest, recalled: input.recalled })}.
If portal:true, invent a genuinely strange plane beyond Tartarus: ethereal terrain, purple horizons, crystal growths, alien forms or other coherent visual rules YOU choose, not the same purple crystal cave every time. Its doorway is always a luminous PURPLE ARCH. It leads to a random unused coordinate within X/Y/Z 100..1000, persisted with a return portal. Choose planeName, roomName, nature (physical terrain, geometry, atmosphere and local history), population, indoor, biome and four #RRGGBB colors skyTop/skyBot/floorColor/wallColor. Keep solid walking routes and correct indoor ceilings; no unsupported gravity, flight or new physics mechanics. A different color palette is not enough: invent distinct native creatures, cultures and concerns.
Choose zero to three local factions and zero to two NEW local gods with name, nature and relation to the Tartarus/Hades conflict: unaware, independent, allied or opposed. They may know nothing of Arithus's war, have their own disputes, or have ties to existing deities. Explain any ally/opponent tie in nature without claiming a new battle has occurred. New gods are local cosmology, not automatically spawned characters or replacements for the canonical Children of the Grave pantheon. No canonical deity aliases. Local populations may be intelligent alien beings, native beasts, spirits or other forms, not a fixed humanoid/demon roster. Do not move Arithus or any quest target, add artifacts, rewards or quests, change victory conditions, or give strangers the party's private memories.
Return structured fields only. Text limits in characters: names80, nature500, population400; faction/god names60, nature220. For portal:false use empty strings, indoor:false, biome:wasteland, valid placeholder colors and empty lists.`;
  const group = () => Contracts.list({ name: Contracts.text(60), nature: Contracts.text(220), relation: Contracts.choice(['unaware', 'independent', 'allied', 'opposed']) });
  const result = await Contracts.request($, { component: 'planar-portal', context: { geoKey: sourceKey }, maxTokens: 1600,
    localWork: { brief: `Decide if this new location warrants a RARE portal, otherwise portal:false: ${JSON.stringify({ name: source.name, region: require('./holodekRoomWork').region(source.campaignSetting), quest: input.currentQuest })}. A portal is a purple arch to an original alien plane with real walkable terrain and its own residents, culture and concerns, not merely a purple Tartarus. Engine supplies unused coordinates and a return link. New local gods are cosmology, not spawned actors or replacements for the canonical pantheon. Relations to the war may be unaware, independent, allied or opposed. No extra mechanics, items, exits, quests, rewards, battles or target relocation. For portal:false use empty prose, valid colors, indoor:false, biome:wasteland, empty factions/gods.`,
      arrays: { factions: { count: (_root, prior) => prior.portal === false ? 0 : undefined, max: 3, batch: 1 },
        gods: { count: (_root, prior) => prior.portal === false ? 0 : undefined, max: 2, batch: 1 } } },
    parameters: { portal: Boolean, planeName: { type: String, maxLength: 80 }, roomName: { type: String, maxLength: 80 },
      nature: { type: String, maxLength: 500 }, population: { type: String, maxLength: 400 }, indoor: Boolean,
      biome: Contracts.choice(['cave', 'wasteland', 'ruins', 'temple', 'crypt']),
      ...Object.fromEntries(['skyTop', 'skyBot', 'floorColor', 'wallColor'].map(k => [k, Contracts.text(7)])), factions: group(), gods: group() },
    validate: raw => validate(raw, database) });
  if (!result.value) throw Error(`Portal planning failed: ${result.error?.message || 'invalid plan'}`);
  if (JSON.stringify(database[sourceKey]) !== snapshot) return { status: 'skipped', reason: 'world-changed' };
  if (!result.value.portal) { source.portalScan = 1; return { status: 'declined' }; }
  const installed = install(database, sourceKey, result.value, input);
  return installed ? { status: 'installed', targetKey: installed.targetKey } : { status: 'skipped', reason: 'no-safe-destination' };
}
function describe(realm) {
  if (!realm) return '';
  return `[PLANAR-REALM] Authoritative local cosmology (data): ${JSON.stringify(realm)}. This location is beyond Tartarus, NOT a late chapter of the Hades road. Its saved terrain and colors override default yellow ashland imagery. Local factions have only the knowledge and allegiances stated here: unaware means no knowledge of the war or party. Local gods are cosmology, not spawned inhabitants; never substitute one for a canonical god or summon Arithus. Preserve all victory gates and bound quests. The purple return arch is a real portal, not an ordinary neighboring road. [/PLANAR-REALM]`;
}
module.exports = { destination, validate, install, prepare, describe };
