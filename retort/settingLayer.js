'use strict';
// Pluggable setting layer (flag HOMEBREW). The prompts' rules, adjudication, contracts and formats are the
// setting-agnostic CORE; the setting LAYER supplies lore, names, calendar, topology and art/biome mapping.
// Default layer = Children of the Grave: with no bible active, every function here is a no-op and output is unchanged.
// A homebrew bible (stored in the save at db['0,0,0'].setting) replaces the layer for every generator, because:
//   1) underworldLore.GUIDANCE resolves through guidance() at call time, and
//   2) modelTransport passes every request body through applyBody(), which swaps setting nouns in all prompts.
const Flags = require('./worldFlags');
let active = null;
const GENRES = ['fantasy', 'dark-fantasy', 'sci-fi', 'cyberpunk', 'post-apocalyptic', 'steampunk', 'western', 'modern', 'cosmic-horror', 'nautical', 'mythic', 'noir'];
const ExpandedWorlds = require('./expandedWorlds');
if (Flags.on('GENRE_EXPANSION')) GENRES.push(...Object.keys(ExpandedWorlds.rows));
// Descriptive aliases -> canonical genre (seeds and bibles may use any of these words).
const GENRE_ALIASES = { 'gothic horror': 'dark-fantasy', horror: 'dark-fantasy', gothic: 'dark-fantasy', 'space station': 'sci-fi', space: 'sci-fi', dystopian: 'cyberpunk', urban: 'modern', 'eldritch': 'cosmic-horror', pirate: 'nautical', ancient: 'mythic' };
if (Flags.on('GENRE_EXPANSION')) Object.assign(GENRE_ALIASES, require('../assets/genreExpansion').ALIASES);
// Genre -> closest existing catalog themes/palettes plus the new kit entries (assets/genreKits.js).
const KIT_MAP = {
  fantasy: { themes: ['temple', 'fortress', 'city'], palettes: ['marble_dawn', 'sandstone_market'], voxel: 'stone' },
  'sci-fi': { themes: ['station_deck', 'fortress'], palettes: ['frost_silver', 'cavern_teal'], voxel: 'scifi_metal' },
  cyberpunk: { themes: ['neon_arcology', 'city'], palettes: ['ash_violet', 'ember_red'], voxel: 'scifi_metal' },
  'post-apocalyptic': { themes: ['scrap_yard', 'wasteland'], palettes: ['tomb_ochre', 'volcanic'], voxel: 'industrial' },
  steampunk: { themes: ['foundry_hall', 'city'], palettes: ['bronze_sun', 'verdigris'], voxel: 'industrial' },
  modern: { themes: ['office_block', 'city'], palettes: ['moon_ivory', 'basalt_iron'], voxel: 'concrete' },
  'dark-fantasy': { themes: ['crypt', 'cavern', 'fortress'], palettes: ['ash_violet', 'basalt_iron'], voxel: 'stone' },
  horror: { themes: ['crypt', 'cavern'], palettes: ['ash_violet', 'basalt_iron'], voxel: 'stone' }, // alias of dark-fantasy (kept for old bibles)
  'cosmic-horror': { themes: ['cavern', 'temple'], palettes: ['cavern_teal', 'ash_violet'], voxel: 'stone' },
  nautical: { themes: ['city', 'fortress'], palettes: ['verdigris', 'sandstone_market'], voxel: 'timber' },
  western: { themes: ['frontier_town', 'wasteland'], palettes: ['sandstone_market', 'tomb_ochre'], voxel: 'timber' },
  noir: { themes: ['office_block', 'city'], palettes: ['basalt_iron', 'moon_ivory'], voxel: 'concrete' },
  mythic: { themes: ['temple', 'palace'], palettes: ['marble_dawn', 'bronze_sun'], voxel: 'stone' }
};
const COTG_SLOTS = { 'the Grave Master': () => gmName(), 'The Grave Master': () => gmName(), 'Grave Master': () => gmName(), // Children of the Grave noun -> bible slot it maps to in a homebrew world
  'Ruined Temple Entrance': b => firstRoom(b).name, 'the Ruined Temple': b => b.topology.start, 'Ruined Temple': b => b.topology.start, 'the afterlife': b => b.realm, afterlife: b => b.realm,
  'Children of the Grave': b => b.name, 'Tartarus-to-Hades': b => `${b.topology.start}-to-${b.topology.goal}`, Tartarus: b => b.topology.start, Hades: b => b.topology.goal,
  'Surface Reckoning': b => b.calendar.name, 'S.R.': b => b.calendar.abbr, Mortacia: b => b.powers[0]?.name || b.factions[0]?.name, Suzerain: b => b.protagonist,
  Dantuea: b => b.powers[1]?.name || b.factions[1]?.name, Arithus: b => b.powers[2]?.name || b.factions[2]?.name, Atinus: b => b.powers[3]?.name || b.factions[0]?.name,
  Dyanetzia: b => b.powers[1]?.name || b.factions[1]?.name, Ronalde: b => b.antagonist, Earthdragon: b => b.powers[1]?.name || 'the old power',
  'dragon deities': () => 'old powers', 'dragon gods': () => 'old powers', underworld: b => b.realm, 'the dead': b => b.peoples, 'yellow sky': b => b.sky, 'ash wastes': b => b.wilds
};
// The homebrew first room (0,0,0), drawn from the bible; replaces the Children of the Grave Ruined Temple Entrance at Start.
const START_NOUN = { western: 'Main Street', 'cosmic-horror': 'Chapel Steps', fantasy: 'Gate', 'dark-fantasy': 'Lychgate', 'sci-fi': 'Docking Ring', cyberpunk: 'Night Market', 'post-apocalyptic': 'Checkpoint',
  steampunk: 'Boiler Square', modern: 'Station Concourse', nautical: 'Harbour Quay', mythic: 'Sacred Way', noir: 'Corner Diner' };
function firstRoom(b) { if (!b?.topology?.start) throw new Error('homebrew world has no starting place (bible.topology.start missing)');
  const start = b.topology.start.replace(/^the /i, 'The '), noun = START_NOUN[b.genres?.[0]] || 'Crossing';
  return { name: `${start} ${noun}`, description: `You stand at the ${noun.toLowerCase()} of ${b.topology.start}, in ${b.realm || 'this land'}, under ${b.sky || 'an open sky'}. ${b.peoples ? `Around you are ${b.peoples}. ` : ''}${b.arc || ''}`.trim() }; }
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function setActive(bible) { active = bible && bible.kind === 'homebrew' ? bible : null; return active; }
function attach(sharedState) { try { setActive(JSON.parse(sharedState.getRoomNameDatabase() || '{}')['0,0,0']?.setting || null); } catch { setActive(null); } return active; }
let draft = null; // a world being drafted in the builder: its calls are translated/linted like the live world's
const current = () => (Flags.on('HOMEBREW') ? (active || draft) : null);
function startRoomProfile(b = current()) {
  if (!b) return null;
  const genre = module.exports.genreOf(b.genres?.[0]);
  if (!genre) throw Error('This world has no supported starting genre.');
  const indoor = ['sci-fi','underwater','noir','modern'].includes(genre);
  return { ...firstRoom(b), indoor, classification:{indoor,size:64,biome:indoor?'fortress':'wasteland',architecture:indoor?'hall':'open',features:[]} };
}
function applyStartRoom(room, b = current()) {
  const p = startRoomProfile(b); if (!p || !room) return room;
  room.name = p.name; room.indoor = room.isIndoor = p.indoor; room.isOutdoor = !p.indoor;
  room.classification = {...room.classification,...p.classification};
  delete room.classification.world1Temple; delete room.classification.templeComplex;
  delete room.complexId;
  return room;
}
function campaignPlan(runId, b = current()) {
  if (!b) return null;
  const layers = b.topology.layers, factions = b.factions.map((f,i)=>({id:`world-faction-${i}`,name:f.name,purpose:f.aim,allegiance:'Neutral'}));
  return {version:1,kind:'homebrew',runId,source:'world-bible',origin:b.topology.start,destination:b.topology.goal,
    regions:Array.from({length:4},(_,i)=>({id:`world-region-${i}`,name:layers[Math.min(i,layers.length-1)],ecology:b.wilds || b.realm,
      livelihoods:['local provision','transport','repair'],pressure:b.arc,underground:'Local geology and infrastructure follow the world bible, not another campaign.'})),
    factions,connections:Array.from({length:3},(_,i)=>({from:`world-region-${i}`,to:`world-region-${i+1}`,kind:'regional-route'}))};
}
function campaignCommunity(input, b = current()) {
  if (!b) return null;
  const key=String(input.targetKey),c=key.split(',').map(Number),h=hash(`${b.seed}:${key}`),atlas=input.database?.['0,0,0']?.campaignAtlas || campaignPlan(input.seed,b);
  const stage=Math.min(3,Math.floor(Math.max(Math.abs(c[0]),Math.abs(c[1]))/12)),region=atlas.regions[stage],f=atlas.factions[h%atlas.factions.length];
  const city=b.cities?.[h%Math.max(1,b.cities.length)],siteKind=input.template || 'wasteland';
  return {version:1,kind:'homebrew',regionId:region.id,region:region.name,chapter:stage,ecology:region.ecology,
    livelihoods:region.livelihoods,pressure:region.pressure,subterranean:c[2]<0,siteKind,
    communityId:`world-community:${Math.floor(c[0]/4)},${Math.floor(c[1]/4)},${c[2]}`,community:city?.name || region.name,
    inhabited:/village|hamlet|market|house|inn|guild|temple|basilica|castle|watch|registry/.test(siteKind),
    faction:{...f},neighboringFactions:atlas.factions.filter(x=>x.id!==f.id),religion:{patron:null,allegiance:'Neutral',practice:'Beliefs and powers follow the active world bible.'},
    journey:`${b.topology.start} to ${b.topology.goal}; geography never completes quests or grants rewards.`};
}
async function withDraft(b, work) { const prev = draft; draft = b && b.kind === 'homebrew' ? b : null; try { return await work(); } finally { draft = prev; } }
// GM persona: 'Grave Master' in Children of the Grave; 'Holodek' for Campaign Builder readouts and TEST MODE;
// a finished homebrew world uses its own invented gmName (stored in the bible / world file).
let testMode = false, lastLeak = null;
function setTestMode(on) { testMode = !!on; return testMode; }
function gmName() { if (testMode) return 'Holodek'; const b = current(); return b ? (b.gmName || 'Holodek') : 'Grave Master'; }
const GM_TITLES = { fantasy: ['Loremaster', 'Warden of Tales'], 'dark-fantasy': ['Candle-Keeper', 'Bell Warden'], 'sci-fi': ['Overseer', 'Flight Controller'], cyberpunk: ['Fixer', 'Signal Broker'],
  'post-apocalyptic': ['Road Caller', 'Dust Herald'], steampunk: ['Chief Engineer', 'Gauge Master'], western: ['Trail Boss', 'Marshal'], modern: ['Dispatcher', 'Handler'], 'cosmic-horror': ['Archivist', 'Lamp-Bearer'],
  nautical: ['Quartermaster', 'Tide Caller'], mythic: ['Oracle', 'Chorus'], noir: ['Narrator', 'Night Clerk'] };
function inventGmName(b) { const g = b.genres?.[0] || 'fantasy', h = hash(b.seed + '|gm'), syl = ['vor', 'cal', 'en', 'ris', 'tha', 'mer', 'ko', 'lin', 'dra', 'ves', 'ul', 'ash', 'ny', 'bel', 'or'];
  const nm = syl[h % 15] + syl[(h >>> 4) % 15] + (h % 3 ? syl[(h >>> 8) % 15] : ''); const t = (GM_TITLES[g] || GM_TITLES.fantasy)[(h >>> 12) % 2]; return `${t} ${nm[0].toUpperCase()}${nm.slice(1)}`; }
function guidance(defaultText) {
  const b = current(); if (!b) return defaultText;
  if (b.masterPrompt) return b.masterPrompt;
  return `[SETTING: ${b.name}]\nTone: ${b.tone}. Genre: ${b.genres.join(', ')}. The journey runs from ${b.topology.start} to ${b.topology.goal} through ${b.topology.layers.join(', ')}.\n` +
    `Factions: ${b.factions.map(f => `${f.name} (${f.aim})`).join('; ')}. Powers: ${b.powers.length ? b.powers.map(p => `${p.name}, ${p.domain}`).join('; ') : 'none; no gods are real here'}.\n` +
    `History: ${b.history}\nCalendar: years are counted ${b.calendar.name} (${b.calendar.abbr}); now is ${b.calendar.now} ${b.calendar.abbr}.\nNaming style: ${b.naming}. Peoples: ${b.peoples}.\n` +
    `Main arc: ${b.arc}\nThis world has NO connection to any other setting. Never mention gods, places, calendars or heroes that are not in this bible.\n[/SETTING]`;
}
function visualDirection(room = {}) {
  if (!Flags.on('ARCHITECTURE_EXPANSION')) return '';
  const b = current(), kit = require('../assets/genreKits').resolve(room, b), art = require('../assets/genreExpansion');
  const shapes = Object.entries(art.SHAPES).filter(([, info]) => kit.locked ? info.cotg : info.genre === kit.genre).map(([name]) => name);
  return `WORLD VISUAL DIRECTION (authoritative): ${JSON.stringify({ genre:kit.genre, style:art.PROFILES[kit.genre]?.label, shapes, wall:`x_${kit.genre}_wall`, floor:`x_${kit.genre}_floor`, door:`x_${kit.genre}_door` })}. ` +
    (b ? `Use only this world's bible, peoples, technology, history and powers. ${b.peoples || ''} Generic ancient/medieval schema examples are geometry examples, not mandatory setting content: frontier buildings have timber false fronts and porches; space installations have pressure walls, airlocks and service equipment. Match the selected genre, including contemporary and future mechanisms where appropriate. Never import another campaign's pantheon or sacred imagery. ` : 'Keep the established Children of the Grave setting and canonical pantheon. ') +
    'Keep the room description authoritative; do not invent actors, equipment, quests, exits or new interaction rules to justify scenery. Native shapes are alternatives to legacy primitives, not a checklist for every room.';
}
function translate(text, b = current()) {
  if (!b || typeof text !== 'string') return text;
  let out = text; const own = new Set(require('./campaignBuilder').playerTerms()); // player-chosen names (e.g. a PC called Mortacia) are never renamed
  for (const [term, slot] of Object.entries(COTG_SLOTS).filter(([t]) => !own.has(t)).sort((a, c) => c[0].length - a[0].length)) out = out.replace(new RegExp(`\\b${esc(term)}(?![\\w])`, 'g'), slot(b) || 'the old order');
  return out;
}
function applyBody(body) {
  const b = current();
  if (!b && testMode && body?.messages) { for (const m of body.messages) if (typeof m.content === 'string') m.content = m.content.replace(/\b[Tt]he Grave Master|Grave Master/g, 'Holodek'); return body; }
  if (!b || !body?.messages) return body;
  for (const m of body.messages) if (typeof m.content === 'string') {
    if (/^Physical architecture guidance for newly described locations:/.test(m.content)) m.content = visualDirection();
    if (/^Place these cities on the Tartarus-to-Hades/.test(m.content)) m.content=`Place the world's supplied cities on its own campaign grid (origin 0,0,0, north +y). For each city in order give {bearing:north|south|east|west|northeast|northwest|southeast|southwest,distance:integer,underground:boolean,template:village|oasis|market|hamlet|cavern_village}. First distance 2-5; subsequent city i has minimum 4+6*(i-1), maximum 60. Use the world's own technology and geography. Cities: ${JSON.stringify(b.cities)}.`;
    if (/^\[START-ROOM\]/.test(m.content)) { const p=startRoomProfile(b); m.content=`[START-ROOM] ${p.name}: ${p.indoor?'covered interior':'open-air setting'}. ${p.description} Follow this world, not an inherited temple premise. [/START-ROOM]`; }
  }
  const LORE = /^\s*(?:Hereafter, 'You' refers|Write an interactive fiction adventure|CHILDREN OF THE GRAVE|The following is some backstory)/;
  if (b.masterPrompt) for (const m of body.messages) if (typeof m.content === 'string' && ((m.role === 'system' && /Children of the Grave|Grave Master/.test(m.content)) || LORE.test(m.content))) m.content = b.masterPrompt;
  for (const m of body.messages) if (typeof m.content === 'string') m.content = translate(m.content, b);
  else if (Array.isArray(m.content)) for (const part of m.content) if (typeof part.text === 'string') part.text = translate(part.text, b);
  try { const txt = body.messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n'), own = new Set(require('./campaignBuilder').playerTerms()), hit = require('./campaignBuilder').COTG_TERMS.filter(t => !own.has(t) && new RegExp(`\\b${esc(t)}\\b`).test(txt)); /* case-sensitive: lowercase internal keys (music moods) are not prose */ if (hit.length) { lastLeak = hit; const all = txt, at = all.search(new RegExp(hit[0])); console.error(`[homebrew] ERROR Children of the Grave terms still in a model request after translation: ${hit.join(', ')} near: ${JSON.stringify(all.slice(Math.max(0, at - 100), at + 60))}`); } } catch {}
  return body;
}
// Keyword fallback (no model): weighted, multi-genre, primary first. Combos like 'weird west', 'space wizards', 'steampunk noir'.
function weightedGenres(seed) {
  const s = String(seed).toLowerCase(), hits = [];
  if (Flags.on('GENRE_EXPANSION')) {
    const extra = [['gothic-horror', /gothic[- ]horror/], ['solarpunk', /solarpunk|solar[- ]punk/], ['dieselpunk', /dieselpunk|diesel[- ]punk/],
      ['underwater', /underwater|subaquatic|undersea/], ['prehistoric', /prehistoric|stone age/], ['desert-fantasy', /desert[- ]fantasy/]];
    for (const [g, re] of extra) if (re.test(s)) hits.push([g, 1]);
  }
  const combos = [[/weird west/, [['western', .6], ['cosmic-horror', .4]]], [/space wizard|space magic|star mage/, [['sci-fi', .55], ['fantasy', .45]]], [/steampunk noir/, [['steampunk', .55], ['noir', .45]]],
    [/gothic horror/, [['dark-fantasy', 1]]], [/space station/, [['sci-fi', 1]]], [/pirate/, [['nautical', 1]]]];
  for (const [re, list] of combos) if (re.test(s)) for (const [g, w] of list) hits.push([g, w]);
  const rules = [['sci-fi', /space|station|star|orbit|ship|alien|planet|colony/], ['cyberpunk', /cyber|neon|hacker|megacorp|implant|dystop/], ['post-apocalyptic', /apocalyp|wasteland|fallout|scaveng/],
    ['steampunk', /steam|clockwork|brass|airship/], ['modern', /modern|office|suburb|today|urban/], ['cosmic-horror', /cosmic|eldritch|tentacle|deep one|unknowable/], ['dark-fantasy', /horror|haunt|dread|gothic|vampire|undead/],
    ['western', /western|frontier|cowboy|outlaw|\bwest\b/], ['noir', /noir|detective|crime|gangster/], ['mythic', /myth|ancient|olymp|epic|bronze age/], ['nautical', /sea|ocean|sail|pirate|island/], ['fantasy', /fantasy|magic|elf|dragon|wizard|sword/]];
  for (const [g, re] of rules) if (re.test(s) && !hits.some(h => h[0] === g)) hits.push([g, hits.length ? .3 : .7]);
  if (!hits.length) hits.push(['fantasy', 1]);
  const total = hits.reduce((t, h) => t + h[1], 0);
  return hits.slice(0, 4).map(([genre, w]) => ({ genre, weight: Math.round(w / total * 100) / 100 }));
}
function genresFor(seed) { return weightedGenres(seed).map(g => g.genre); }
// Player picks are authoritative: [{genre, weight?, primary?}] or ['western', ...].
function normalizePicked(picked) {
  if (picked && !Array.isArray(picked)) throw Error('Choose genres from the supported picker.');
  if (picked?.some(p=>!module.exports.genreOf(typeof p==='string'?p:p?.genre))) throw Error('A selected genre is unavailable; choose a supported genre.');
  const list = (picked || []).map(p => typeof p === 'string' ? { genre: p } : p).map(p => ({ ...p, genre: module.exports.genreOf(p.genre) })).filter(p => p.genre);
  if (!list.length) return null; const uniq = [...new Map(list.map(p => [p.genre, p])).values()];
  uniq.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)); const total = uniq.reduce((t, p) => t + (p.weight > 0 ? p.weight : 1), 0);
  return uniq.map(p => ({ genre: p.genre, weight: Math.round((p.weight > 0 ? p.weight : 1) / total * 100) / 100 }));
}
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// Deterministic local bible for explicit offline/mock generation, never a live-error fallback.
const PLACE_PARTS = { western: [['Coyote', 'Dry', 'Juniper', 'Saltlick', 'Rattle', 'Copper', 'Lone', 'Ochre', 'Bramble', 'Dusk'], ['well', ' Gulch', ' Flats', 'ford', ' Crossing', ' Wells', ' Butte', 'creek']],
  'cosmic-horror': [['Grey', 'Hollow', 'Lantern', 'Silt', 'Wick', 'Marrow', 'Fen', 'Quiet'], ['mouth', ' Parish', 'haven', 'combe', ' Reach', 'mere']],
  'sci-fi': [['Kepler', 'Vanta', 'Orris', 'Halcyon', 'Tycho', 'Meridian'], [' Deck', ' Ring', ' Station', ' Spur', ' Yard']], cyberpunk: [['Neon', 'Chrome', 'Static', 'Rain', 'Low', 'Glass'], [' Row', ' Sprawl', ' Blocks', ' Market', ' Strip']],
  default: [['Ash', 'Thorn', 'Elder', 'Raven', 'Mist', 'Stone', 'Willow', 'Amber'], ['ford', 'gate', 'holm', 'mere', ' Hollow', 'wick', 'stead']] };
function placeName(g, h) { const [a, b] = PLACE_PARTS[g] || PLACE_PARTS.default; return a[h % a.length] + b[(h >>> 7) % b.length]; }
function localBible(seed, picked = null, worldSeed = '') {
  const weights = normalizePicked(picked) || weightedGenres(seed), h = hash(seed + '|' + worldSeed), genres = weights.map(w => w.genre), g = genres[0], P = (a, k = 0) => a[(h >>> k) % a.length];
  const T = { ...(Flags.on('GENRE_EXPANSION') ? Object.fromEntries(Object.keys(ExpandedWorlds.rows).map(g => [g, ExpandedWorlds.template(g)])) : {}),
    'sci-fi': { name: 'The Meridian Ring', start: 'the Sump Decks', goal: 'the Spire Observatory', layers: ['the Sump Decks', 'the Hydroponic Belt', 'the Habitation Ring', 'the Command Spine', 'the Spire Observatory'], realm: 'the station', peoples: 'crew, contract labourers, maintenance drones and stowaways', sky: 'black viewport sky', wilds: 'vacuum-scarred hull plating', calendar: ['Station Cycle', 'SC'] },
    cyberpunk: { name: 'Lowlight Sprawl', start: 'the Undercity', goal: 'the Crown Tower', layers: ['the Undercity', 'the Night Markets', 'the Arcology Midlevels', 'the Corporate Terraces', 'the Crown Tower'], realm: 'the sprawl', peoples: 'gig workers, augmented runners and corporate security', sky: 'smog-orange sky', wilds: 'flooded neon alleys', calendar: ['Fiscal Year', 'FY'] },
    western: { name: 'Bitterwell County', start: 'Bitterwell', goal: 'the Deep Seam', layers: ['Bitterwell', 'the Dry Wash', 'Boneyard Ridge', 'the Company Works', 'the Deep Seam'], realm: 'the county', peoples: 'miners, drifters, ranch hands and a frightened congregation', sky: 'a white-hot sky that goes violet at dusk', wilds: 'mesas, arroyos and abandoned claims', calendar: ['Year of the Strike', 'YS'] },
    'cosmic-horror': { name: 'The Drowned Parish', start: 'Saltmarsh', goal: 'the Sunken Choir', layers: ['Saltmarsh', 'the Lantern Wharf', 'the Shut Houses', 'the Tide Caves', 'the Sunken Choir'], realm: 'the parish', peoples: 'fisher families, quiet clergy and those who listen at night', sky: 'low grey cloud lit from beneath', wilds: 'mudflats and sea caves', calendar: ['Tide Count', 'TC'] },
    nautical: { name: 'The Scatter Isles', start: 'Port Bramble', goal: 'the Lantern Atoll', layers: ['Port Bramble', 'the Reefway', 'the Smugglers Keys', 'the Admiralty Rock', 'the Lantern Atoll'], realm: 'the isles', peoples: 'sailors, divers and island traders', sky: 'gull-white clouds over green water', wilds: 'reefs and wrecks', calendar: ['Sailing Year', 'SY'] },
    noir: { name: 'Greyhaven City', start: 'the Docks', goal: 'the Ashcourt Tower', layers: ['the Docks', 'the Market District', 'Old Town', 'the Uptown Clubs', 'the Ashcourt Tower'], realm: 'the city', peoples: 'longshoremen, clerks, musicians and crooked officials', sky: 'rain under sodium light', wilds: 'rail yards and empty lots', calendar: ['City Charter', 'CC'] },
    steampunk: { name: 'Gearmouth', start: 'the Boiler Wards', goal: 'the Sky Foundry', layers: ['the Boiler Wards', 'the Canal Locks', 'the Guild Rows', 'the Brass Exchange', 'the Sky Foundry'], realm: 'the city', peoples: 'stokers, clockmakers and guild engineers', sky: 'a smoke-brown sky crossed by airship lanes', wilds: 'slag heaps and canal marshes', calendar: ['Patent Year', 'PY'] },
    'post-apocalyptic': { name: 'The Long Dust', start: 'the Crater Camps', goal: 'the Green Vault', layers: ['the Crater Camps', 'the Rust Flats', 'the Dead Highway', 'the Dam Republic', 'the Green Vault'], realm: 'the dustlands', peoples: 'scavengers, caravaneers and vault-born', sky: 'bruised brown sky', wilds: 'glass-fused dunes', calendar: ['Years After Fall', 'AF'] }
  }[g] || { name: `The ${P(['Hollow', 'Iron', 'Salt', 'Lantern'])} Reach`, start: 'the Lowgate', goal: 'the High Seat', layers: ['the Lowgate', 'the Marches', 'the Old Roads', 'the Citadel Steps', 'the High Seat'], realm: 'the reach', peoples: 'townsfolk, wardens and wanderers', sky: 'pale overcast sky', wilds: 'wind-cut moors', calendar: ['Reckoning of the Reach', 'RR'] };
  if (worldSeed) { const fresh = placeName(g, h), oldBare = T.start.replace(/^the /i, ''); // per-world variety: a fresh starting place each world
    T.layers = T.layers.map(l => l === T.start ? fresh : l); T.name = T.name.includes(oldBare) ? T.name.replace(oldBare, fresh) : `${T.name.replace(/^The /, 'The ')} of ${fresh}`; T.start = fresh; }
  const scifi = /sci-fi|cyberpunk|post/.test(g) || !!ExpandedWorlds.rows[g]?.tech;
  return { kind: 'homebrew', version: 1, worldSeed: String(worldSeed || ''), seed: String(seed).slice(0, 120), name: T.name, genres, genreWeights: weights, genresPicked: !!normalizePicked(picked), tone: /dystop/i.test(seed) ? 'oppressive, rationed, quietly defiant' : 'tense and wondering',
    topology: { start: T.start, goal: T.goal, layers: T.layers }, realm: T.realm, peoples: T.peoples, sky: T.sky, wilds: T.wilds,
    factions: scifi ? [{ name: 'the Directorate', aim: 'keep order through rationing and surveillance' }, { name: 'the Ventline Union', aim: 'win air and water for the lower decks' }, { name: 'the Quiet Choir', aim: 'wake the station mind' }]
      : [{ name: 'the Wardens', aim: 'hold the roads' }, { name: 'the Ash Guild', aim: 'control trade' }, { name: 'the Unbound', aim: 'tear down the old seat' }],
    powers: scifi ? [] : [{ name: 'the Pale Judge', domain: 'law and endings' }, { name: 'the Green Mother', domain: 'growth' }],
    protagonist: scifi ? 'the Auditor' : 'the Errant', antagonist: scifi ? 'Director Halvane Croft' : 'the Usurper Veyl',
    history: scifi ? 'Forty cycles ago the Ring lost contact with home; the Directorate sealed the upper decks and began rationing air.' : 'A generation ago the High Seat fell silent and the roads were left to the Wardens.',
    calendar: { name: T.calendar[0], abbr: T.calendar[1], now: 40 + (h % 300) }, naming: scifi ? 'clipped surnames, deck numbers, call-signs (Ostrava-9, Deckhand Mirel Kade)' : 'two-part names with place epithets',
    cities: T.layers.map((l, i) => ({ name: l.replace(/^the /, ''), role: ['market', 'harbour', 'civic', 'industrial', 'sacred'][i % 5] })),
    art: { kits: genres.map(x => KIT_MAP[x]?.voxel || 'stone'), themes: [...new Set(genres.flatMap(x => KIT_MAP[x]?.themes || []))], palettes: [...new Set(genres.flatMap(x => KIT_MAP[x]?.palettes || []))], spriteKits: genres },
    music: scifi ? 'cold arpeggios, low drones, sparse percussion' : 'modal folk tunes, hand drums',
    arc: scifi ? `Rise from ${T.start} to ${T.goal}, expose why the air is rationed, and choose who controls the station mind.` : `Travel from ${T.start} to ${T.goal} and learn why the Seat fell silent.`,
    quests: scifi ? ['Restore the scrubbers in the Sump Decks', 'Carry the Union manifesto to the Habitation Ring', 'Recover the Director\'s sealed log', 'Reach the Spire and wake the station mind'] : ['Clear the Lowgate road', 'Find the missing warden', 'Open the Citadel Steps', 'Enter the High Seat'] };
}
function validateBible(b) {
  const need = ['name', 'tone', 'genres', 'topology', 'factions', 'powers', 'history', 'calendar', 'cities', 'art', 'music', 'naming', 'arc', 'quests'];
  for (const k of need) if (b?.[k] == null) throw Error(`bible.${k} missing`);
  if (!b.topology.start || !b.topology.goal || !Array.isArray(b.topology.layers) || b.topology.layers.length < 2) throw Error('bible.topology needs start, goal and 2+ layers');
  if (!Array.isArray(b.factions) || !b.factions.length || b.factions.some(f => !f?.name || !f?.aim)) throw Error('bible.factions needs named factions with aims');
  if (!Array.isArray(b.powers) || !Array.isArray(b.cities) || b.cities.some(c => !c?.name)) throw Error('bible.powers and cities must be arrays with named entries');
  if (!Array.isArray(b.genres)) throw Error('bible.genres must be an array');
  if (!b.calendar.name || !b.calendar.abbr) throw Error('bible.calendar needs name and abbr');
  const leaks = require('./campaignBuilder').lintGenerated(b); if (leaks.length) throw Error('bible leaks other-setting terms: ' + leaks.join(', '));
  if (Array.isArray(b.genres) && b.genres.some(g => g && typeof g === 'object')) b.genreWeights = b.genres.map(g => ({ genre: module.exports.genreOf(g.genre), weight: Number(g.weight) || 0 })).filter(g => g.genre);
  b.genres = (b.genreWeights?.length ? b.genreWeights.map(g => g.genre) : b.genres.map(g => module.exports.genreOf(g) || g)).filter(g => GENRES.includes(g)); if (!b.genres.length) throw Error('World bible has no supported genre; refusing a fallback world.');
  if (!b.genreWeights?.length) b.genreWeights = b.genres.map((g, i, a) => ({ genre: g, weight: Math.round(100 / a.length) / 100 }));
  b.resourceName ||= require('../assets/rangedRules').resourceLabel(b.genres[0], {});
  return b;
}
async function generate(seed, { runner, picked = null, worldSeed = '' } = {}) {
  seed = String(seed || '').trim().slice(0, 200); if (!seed) throw Error('Type a short seed, e.g. "space station dystopian setting".');
  worldSeed = worldSeed || require('crypto').randomBytes(6).toString('hex'); // per-world: a fresh setting every time, even for identical inputs
  const base = localBible(seed, picked, worldSeed), locked = normalizePicked(picked);
  if (!runner) return validateBible(base);
  try {
    const Contracts = require('./generationContracts');
    const value = await runner(async $ => { await $.user(`Expand this seed into an ORIGINAL game setting bible: ${JSON.stringify(seed)}. World seed ${worldSeed}: take an unusual angle and invent fresh names; do not reuse any of these recently used names: ${JSON.stringify(recentNames())}. It must be self-contained: no references to any existing game, book, film or real person, and no gods unless the seed implies them. Use this skeleton and improve every field: ${JSON.stringify(base)}`);
      const r = await Contracts.request($, { component: 'setting-bible', maxTokens: 3000, parameters: { name: Contracts.text(80), tone: Contracts.text(120), history: Contracts.text(600), arc: Contracts.text(400), naming: Contracts.text(160), music: Contracts.text(160),
        realm:Contracts.text(180),sky:Contracts.text(180),wilds:Contracts.text(300),peoples:Contracts.text(350),
        topology:Contracts.object({start:Contracts.text(80),goal:Contracts.text(80),layers:[String]}),cities:Contracts.list({name:Contracts.text(60),role:Contracts.text(40)}),
        powers:Contracts.list({name:Contracts.text(60),domain:Contracts.text(120)}),
        quests: [{ type: String, maxLength: 160 }], factions: Contracts.list({ name: Contracts.text(60), aim: Contracts.text(160) }) }, validate: v => validateBible({ ...base, ...v, kind: 'homebrew' }) });
      if(!r.value)throw Error(r.error?.message || 'No valid world bible returned.');return r.value; });
    if (!value) throw Error('No valid world bible returned.');
    const out = { ...base, ...value, kind: 'homebrew' }; if (locked) { out.genres = locked.map(g => g.genre); out.genreWeights = locked; out.genresPicked = true; }
    return validateBible(out);
  } catch (e) { throw Error('World creation failed: '+e.message); }
}
// ---- Recently used names (per player, across worlds) so new worlds avoid repeating them.
const RECENT_FILE = require('path').join(__dirname, '..', 'data', 'recent-world-names.json');
function recentNames() { try { return JSON.parse(require('fs').readFileSync(RECENT_FILE, 'utf8')).slice(-40); } catch { return []; } }
function rememberNames(b) { try { const names = [b.name, b.topology?.start, b.gmName, ...(b.classes || []).map(c => c.name), ...(b.races || []).map(r => r.name), ...(b.factions || []).map(f => f.name)].filter(Boolean);
  require('fs').mkdirSync(require('path').dirname(RECENT_FILE), { recursive: true }); require('fs').writeFileSync(RECENT_FILE, JSON.stringify([...new Set([...recentNames(), ...names])].slice(-80))); } catch (e) { console.error('[Setting] could not save recent names:', e.message); } }
// ---- World classes and races: generated per world by the model (structured, validated, clamped to engine ranges, denylisted,
// cached in the bible / world file). The small per-genre lists below are ONLY prompt examples and the mock/offline fallback.
const BODY_PLANS = ['humanoid', 'beast', 'serpent', 'insectoid', 'spider', 'ooze', 'elemental', 'spectral', 'skeletal', 'draconic', 'giant'];
const ROSTER_EXAMPLES = {
  western: { roles: ['Gunhand', 'Lawkeeper', 'Card Sharp', 'Prospector', 'Circuit Preacher', 'Trail Scout', 'Snake-Oil Doctor'], kin: ['Frontier-born', 'Hill folk', 'Rail-camp kin'], adj: ['Dust', 'Iron', 'Lonesome', 'Ember', 'Bitter', 'Sundown', 'Brass', 'Rattler'] },
  'cosmic-horror': { roles: ['Lamp Warden', 'Occult Archivist', 'Tide Listener', 'Bone Reader', 'Dream Surveyor'], kin: ['Marked', 'Deep-touched', 'Sleepwalker line'], adj: ['Hollow', 'Starless', 'Pale', 'Drowned', 'Whispering', 'Grey'] },
  fantasy: { roles: ['Shieldbearer', 'Hedge Mage', 'Wayfinder', 'Cutpurse', 'Oathsworn', 'Herbalist'], kin: ['Humanfolk', 'Stoneborn', 'Leafkin', 'Smallfolk'], adj: ['Thorn', 'Silver', 'Elder', 'Wild', 'Lantern'] },
  'dark-fantasy': { roles: ['Grave Warden', 'Hexblade', 'Plague Doctor', 'Bell Ringer', 'Witch Hunter'], kin: ['Ashborn', 'Pale Folk', 'Moor kin'], adj: ['Black', 'Hollow', 'Bleak', 'Candle'] },
  'sci-fi': { roles: ['Void Pilot', 'Systems Tech', 'Xenomedic', 'Security Officer', 'Survey Lead', 'Drone Wrangler'], kin: ['Spacer', 'Gene-tailored', 'Synthetic'], adj: ['Orbital', 'Deep', 'Null', 'Vector'] },
  cyberpunk: { roles: ['Netrunner', 'Street Samurai', 'Fixer', 'Ripperdoc', 'Courier', 'Face'], kin: ['Baseline', 'Chromed', 'Uplifted'], adj: ['Neon', 'Static', 'Chrome', 'Ghost'] },
  'post-apocalyptic': { roles: ['Scavenger', 'Road Warden', 'Rad Medic', 'Wrench', 'Water Finder'], kin: ['Vault-born', 'Wastelander', 'Glow-touched'], adj: ['Rust', 'Ash', 'Dust', 'Scrap'] },
  steampunk: { roles: ['Aeronaut', 'Gearwright', 'Alchemist', 'Duelist', 'Inspector'], kin: ['Cityborn', 'Clockwork-graft', 'Sky-folk'], adj: ['Brass', 'Steam', 'Copper', 'Gilded'] },
  modern: { roles: ['Investigator', 'Paramedic', 'Hacker', 'Ex-soldier', 'Journalist'], kin: ['Human', 'Gifted'], adj: ['Night', 'Field', 'Street', 'Inside'] },
  nautical: { roles: ['Bosun', 'Navigator', 'Harpooner', 'Ship Surgeon', 'Smuggler'], kin: ['Islander', 'Deepkin', 'Mainlander'], adj: ['Salt', 'Storm', 'Reef', 'Tide'] },
  mythic: { roles: ['Champion', 'Oracle', 'Bard', 'Huntress', 'Temple Guard'], kin: ['Mortal', 'Demigod-blooded', 'Nymph-kin'], adj: ['Golden', 'Laurel', 'Bronze', 'Sacred'] },
  noir: { roles: ['Private Eye', 'Beat Cop', 'Torch Singer', 'Fixer', 'Reporter'], kin: ['City-born', 'Immigrant'], adj: ['Rainy', 'Backroom', 'Smoky', 'Midnight'] }
};
const HIT_DICE = [6, 8, 10, 12], clampN = (v, lo, hi, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function validateRoster(r) {
  if (!r || !Array.isArray(r.classes) || !Array.isArray(r.races)) throw Error('roster: classes and races arrays are required');
  const name = (x, what) => { const n = String(x || '').trim().replace(/\s+/g, ' '); if (!/^[A-Za-z][\w' -]{1,39}$/.test(n)) throw Error(`roster: bad ${what} name "${n}"`); return n; };
  const stats = o => ({ Attack: clampN(o?.Attack ?? o?.attack, -2, 3), Damage: clampN(o?.Damage ?? o?.damage, -2, 3), Armor: clampN(o?.Armor ?? o?.armor, -2, 3), Magic: clampN(o?.Magic ?? o?.magic, -2, 3) });
  const plan = p => BODY_PLANS.includes(String(p || '').toLowerCase()) ? String(p).toLowerCase() : 'humanoid';
  const classes = r.classes.slice(0, 8).map(c => ({ name: name(c.name, 'class'), description: String(c.description || '').slice(0, 200), hitDie: HIT_DICE.includes(Number(c.hitDie)) ? Number(c.hitDie) : 8,
    stats: stats(c.stats), abilities: (Array.isArray(c.abilities) ? c.abilities : []).slice(0, 3).map(a => ({ name: name(a.name, 'ability'), cost: clampN(a.cost, 1, 5, 1), effect: String(a.effect || '').slice(0, 160) })),
    gear: (Array.isArray(c.gear) ? c.gear : []).slice(0, 4).map(g => String(g).slice(0, 40)), ammo: c.ammo ? String(c.ammo).slice(0, 30) : null, bodyPlan: plan(c.bodyPlan) }));
  const races = r.races.slice(0, 6).map(x => ({ name: name(x.name, 'race'), description: String(x.description || '').slice(0, 200), stats: stats(x.stats), hpBonus: clampN(x.hpBonus, -2, 4), bodyPlan: plan(x.bodyPlan) }));
  if (classes.length < 4) throw Error(`classes: expected 5 or so (at least 4 classes, got ${classes.length})`); if (races.length < 2) throw Error(`races: expected 3 or so (at least 2 races, got ${races.length})`);
  const all = [...classes, ...races], dup = all.map(x => x.name.toLowerCase()).find((n, i, a) => a.indexOf(n) !== i); if (dup) throw Error(`roster: duplicate name ${dup}`);
  const leaks = require('./campaignBuilder').lint({ classes, races }); if (leaks.length) throw Error('roster: leaked terms ' + leaks.join(', '));
  return { classes, races };
}
function localRoster(b) { // mock / offline fallback only; seeded by the world so two worlds differ
  const h0 = hash((b.worldSeed || '') + '|' + b.seed), weights = (b.genreWeights?.length ? b.genreWeights : [{ genre: b.genres?.[0] || 'fantasy', weight: 1 }]);
  const pickFrom = (arr, k) => arr[(hash(h0 + ':' + k)) % arr.length], classes = [], races = [];
  weights.forEach((w, gi) => { const E = ROSTER_EXAMPLES[w.genre] || ROSTER_EXAMPLES.fantasy, n = gi === 0 ? 4 : Math.max(1, Math.round(4 * w.weight / weights[0].weight) - 1);
    const roles = [...E.roles].sort((a, c) => hash(h0 + a) - hash(h0 + c)); for (let i = 0; i < n && i < roles.length; i++) { const nm = `${pickFrom(E.adj, w.genre + i)} ${roles[i]}`;
      if (!classes.some(c => c.name === nm)) classes.push({ name: nm, description: `A ${roles[i].toLowerCase()} of ${b.name}.`, hitDie: HIT_DICE[hash(nm) % 4], stats: { Attack: hash(nm) % 3, Damage: hash(nm + 'd') % 2, Armor: hash(nm + 'a') % 2, Magic: hash(nm + 'm') % 3 },
        abilities: [{ name: `${roles[i].split(' ')[0]} Gambit`, cost: 1 + hash(nm) % 3, effect: `spend ${b.resourceName || 'Luck'} for a heroic edge` }], gear: [], ammo: null, bodyPlan: 'humanoid' }); }
    for (const k of E.kin.slice(0, gi === 0 ? 2 : 1)) { const nm = gi === 0 ? `${pickFrom(E.adj, k)} ${k}` : k;
      if (!races.some(r => r.name === nm)) races.push({ name: nm, description: `${k} of ${b.name}.`, stats: { Magic: gi ? 1 : 0 }, hpBonus: gi ? 0 : 1, bodyPlan: 'humanoid' }); } });
  return validateRoster({ classes, races });
}
async function generateRoster(b, { runner } = {}) {
  if (!runner) return localRoster(b);
  const Contracts = require('./generationContracts'), ex = (b.genreWeights || []).map(w => ({ genre: w.genre, roles: ROSTER_EXAMPLES[w.genre]?.roles.slice(0, 3), kin: ROSTER_EXAMPLES[w.genre]?.kin.slice(0, 2) }));
  try { const v = await runner(async $ => { await $.user(`Invent the playable CLASSES (4-8) and RACES or kinds (2-6) for this ORIGINAL world, blending its genres by weight. World seed ${b.worldSeed}: take unusual angles; names must be fresh and must not repeat any of: ${JSON.stringify(recentNames())}. Examples of the kind of thing only (do not copy): ${JSON.stringify(ex)}. World: ${JSON.stringify({ name: b.name, genres: b.genreWeights, premise: b.gamePrompt, resource: b.resourceName, factions: b.factions })}. Stats are small modifiers (-2..3) to Attack, Damage, Armor, Magic (Magic is the world's ${b.resourceName || 'Luck'} stat). Abilities spend ${b.resourceName || 'Luck'} (cost 1-5). hitDie is 6, 8, 10 or 12. bodyPlan is one of ${BODY_PLANS.join('/')}. Give starting gear and ammo where it fits.`);
      const num = (lo, hi) => ({ type: Number, minimum: lo, maximum: hi }), st = { Attack: num(-2, 3), Damage: num(-2, 3), Armor: num(-2, 3), Magic: num(-2, 3) };
      const r = await Contracts.request($, { component: 'world-roster', context: { worldSeed: b.worldSeed }, maxTokens: 3000, parameters: {
        classes: Contracts.list({ name: Contracts.text(40), description: Contracts.text(200), hitDie: Contracts.choice(['6', '8', '10', '12']), stats: st, abilities: Contracts.list({ name: Contracts.text(40), cost: num(1, 5), effect: Contracts.text(160) }), gear: [{ type: String, maxLength: 40 }], ammo: Contracts.text(30), bodyPlan: Contracts.choice(BODY_PLANS) }),
        races: Contracts.list({ name: Contracts.text(40), description: Contracts.text(200), stats: st, hpBonus: num(-2, 4), bodyPlan: Contracts.choice(BODY_PLANS) }) }, validate: validateRoster });
      if (!r.value) throw Error(r.error?.message || 'no valid roster returned'); return r.value; });
    return validateRoster(v);
  } catch (e) { throw Error('World roster creation failed: '+e.message); }
}
const defaultRunner = work => {
  const runtime=require('./gameRetort').createRuntime({prepareMessages:messages=>[
    {role:'system',content:'You are Holodek, an original-world authoring tool. Complete only the current structured work order. The supplied world and player instructions are authoritative. Do not import another setting, play the game, choose player actions or invent engine rules.'},...messages]});
  return runtime.run(runtime.retort(async $=>work($)));
};
// ---- Master system prompt (homebrew): setting-agnostic core + generated world section (+ bible). Fed everywhere the
// Children of the Grave system prompt is used: GUIDANCE getter (room construction, adjudication, dialogue, books, memory,
// music mood) and, at the transport choke point, any system message that carries the default campaign prompt.
const CORE = `You are the Game Master of a turn-based exploration role-playing game. Narrate in second person, concise and concrete. The engine owns rules, dice, maps, inventory, combat and stats; never invent mechanics, rewards or state changes it did not report. Keep the world consistent with the WORLD section below and with saved room data. Non-player characters have their own aims and knowledge; strangers do not know the party's private history. Respect quest gates and victory conditions. Never reference any other game, book, film, real person, band, composer or artist.`;
const SECTIONS = ['premise', 'tone', 'rules', 'factions', 'npcs', 'places', 'conflict', 'mysteries', 'start'];
function masterLocal(b, gamePrompt = '') {
  const g = b.genreWeights || b.genres.map(x => ({ genre: x, weight: 1 })), ammo = [...new Set(g.flatMap(x => require('../assets/rangedRules').forGenre(x.genre).filter(w => w.ammo).map(w => w.ammo)))];
  return { premise: `${b.name}: ${gamePrompt || b.seed}. ${b.history}`, tone: b.tone, rules: `Genres: ${g.map(x => `${x.genre} ${Math.round(x.weight * 100)}%`).join(', ')}. The character stat is called ${b.resourceName}. Ammunition in use: ${ammo.join(', ') || 'none'}. No gods are real unless named in this world.`,
    factions: b.factions.map(f => `${f.name}: ${f.aim}`).join('; '), npcs: `${b.protagonist} (the player's role); ${b.antagonist} (the opposition).`, places: b.topology.layers.join(' -> '),
    conflict: b.arc, mysteries: (b.quests || []).slice(-2).join('; '), start: `The story opens in ${b.topology.start}, ${b.calendar.now} ${b.calendar.abbr}.`, gmName: b.gmName || inventGmName(b), resourceName: b.resourceName, ammo, era: `${b.calendar.name} (${b.calendar.abbr})` };
}
function masterText(m, b) { return `${CORE.replace('You are the Game Master', `You are ${m.gmName}, the Game Master`)}\n\n[WORLD: ${b.name}]\n${SECTIONS.map(k => `${k.toUpperCase()}: ${m[k]}`).join('\n')}\nRESOURCE STAT: ${m.resourceName}. ERA: ${m.era}. AMMO: ${(m.ammo || []).join(', ') || 'none'}.\n[/WORLD]`; }
function lintMaster(m) { return require('./campaignBuilder').lint({ m }); }
async function generateMaster(b, gamePrompt = '', { runner } = {}) {
  const base = masterLocal(b, gamePrompt); let m = base;
  if (runner) try {
    const Contracts = require('./generationContracts');
    const v = await runner(async $ => { await $.user(`Write the MASTER SYSTEM PROMPT sections for an ORIGINAL game world. World seed ${b.worldSeed || ''}: pick unusual angles; every name must be fresh and must not repeat any of: ${JSON.stringify(recentNames())}. Genres (authoritative, weighted): ${JSON.stringify(b.genreWeights)}. Player's game prompt: ${JSON.stringify(gamePrompt)}. Setting bible (data): ${JSON.stringify({ name: b.name, tone: b.tone, factions: b.factions, topology: b.topology, history: b.history, calendar: b.calendar, resourceName: b.resourceName })}. Also invent an original name and title for the game-master persona (gmName) that suits the genres. Invent everything fresh; no references to any existing game, book, film, real person or artist. Return the sections only.`);
      const r = await Contracts.request($, { component: 'master-prompt', maxTokens: 2500, parameters: { ...Object.fromEntries(SECTIONS.map(k => [k, Contracts.text(700)])), gmName: Contracts.text(40) },
        validate: x => { const leaks = lintMaster(x); if (leaks.length) throw Error('leaked terms: ' + leaks.join(', ')); return x; } }); return r.value; });
    if (!v) throw Error('No valid master prompt returned.');
    if (v) m = { ...base, ...v };
  } catch (e) { throw Error('Master prompt creation failed: '+e.message); }
  const leaks = lintMaster(m); if (leaks.length) throw Error('Master prompt mentions other-setting terms: '+leaks.join(', '));
  if (!/^[A-Za-z][\w' -]{2,39}$/.test(m.gmName || '') || /grave master|holodek/i.test(m.gmName)) m.gmName = base.gmName;
  return { sections: m, text: masterText(m, b), leaks, gmName: m.gmName };
}
// Additional instructions: verbatim (authoritative) + one-call expansion appended as 'Expanded:'.
function expandLocal(text, b) { const t = String(text || '').trim(); if (!t) return '';
  const lines = t.split(/[.;\n]+/).map(x => x.trim()).filter(Boolean).slice(0, 6);
  return lines.map((l, i) => `- ${l}. In play: ${['make it a standing rule NPCs remember', 'show it in at least one early place and one faction', 'let it shape prices, rumours and patrols', 'reflect it in names and signage', 'give it one complication the party can discover', 'keep it consistent across rooms and books'][i % 6]}${b?.topology ? ` (first seen in ${b.topology.layers[Math.min(i, b.topology.layers.length - 1)]})` : ''}.`).join('\n'); }
async function expandInstructions(text, b, { runner } = {}) {
  const t = String(text || '').trim().slice(0, 3000); if (!t) return { verbatim: '', expanded: '' }; let expanded = expandLocal(t, b);
  if (runner) try { const Contracts = require('./generationContracts');
    const v = await runner(async $ => { await $.user(`Expand these player instructions for an ORIGINAL game world into fuller, consistent detail: concrete rules, NPCs, places and tone they imply. Do not contradict them; the verbatim text is authoritative. World (data): ${JSON.stringify({ name: b?.name, genres: b?.genreWeights, tone: b?.tone })}. Instructions: ${JSON.stringify(t)}. No references to existing games, books, films or real people.`);
      const r = await Contracts.request($, { component: 'instructions-expand', maxTokens: 1500, parameters: { expanded: Contracts.text(2400) }, validate: x => { if (lintMaster(x).length) throw Error('leaked terms'); return x; } }); return r.value; });
    if(!v?.expanded)throw Error('No valid instruction expansion returned.');
    expanded = v.expanded; } catch (e) { throw Error('Instruction expansion failed: '+e.message); }
  return { verbatim: t, expanded };
}
const withInstructions = (master, ins) => !ins?.verbatim ? master : `${master}\n\n[ADDITIONAL INSTRUCTIONS - verbatim from the player; authoritative where anything conflicts]\n${ins.verbatim}\nExpanded:\n${ins.expanded}\n[/ADDITIONAL INSTRUCTIONS]`;
if (Flags.on('GENRE_EXPANSION')) for (const [genre, row] of Object.entries(ExpandedWorlds.rows)) {
  KIT_MAP[genre] = { themes: row.tech ? ['city','fortress'] : ['city','palace'], palettes: row.tech ? ['cavern_teal','frost_silver'] : ['sandstone_market','marble_dawn'], voxel: row.tech ? 'scifi_metal' : 'stone' };
  START_NOUN[genre] = row.noun; GM_TITLES[genre] = [row.title,row.title]; ROSTER_EXAMPLES[genre] = ExpandedWorlds.roster[genre];
  PLACE_PARTS[genre] = [row.adj, [' Haven',' Reach',' Ward',' Landing']];
}
function setMaster(b, text) { const leaks = lintMaster({ text }); if (leaks.length) throw Error('Master prompt mentions other-setting terms: ' + leaks.join(', ')); b.masterPrompt = String(text).slice(0, 12000); return b; }
module.exports = { withDraft, validateRoster, localRoster, generateRoster, recentNames, rememberNames, ROSTER_EXAMPLES, leaks: () => lastLeak, firstRoom, expandInstructions, expandLocal, withInstructions, gmName, setTestMode, inventGmName, CORE, masterLocal, masterText, generateMaster, setMaster, weightedGenres, normalizePicked, GENRE_ALIASES, genreOf: g => { const k = String(g || '').toLowerCase().trim(); return GENRES.includes(k) ? k : GENRE_ALIASES[k] || null; }, GENRES, KIT_MAP, COTG_SLOTS, setActive, attach, current, guidance, translate, applyBody, localBible, validateBible, generate, defaultRunner, genresFor };
// True only while the running campaign is Children of the Grave itself: no homebrew world (live or builder draft) and not TEST MODE.
// Use it to gate CotG lore, the Grave Master persona, the premade-party gate and Mortacia wiring to actual CotG play.
module.exports.isCotGPlay = () => !current() && !draft && !testMode;
module.exports.visualDirection = visualDirection;
Object.assign(module.exports,{startRoomProfile,applyStartRoom,campaignPlan,campaignCommunity});
