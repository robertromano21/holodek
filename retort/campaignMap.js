'use strict';
// world1 campaign map: composed once at campaign creation, from Tartarus (the Ruined Temple, 0,0,0) to Hades.
// Cities sit along the journey (one test city just past the first wasteland, waypoint cities in the middle
// regions, and Hades itself as the last city). Rooms are still generated lazily; this module only steers the
// environment-intent template of NEW neighbours, using existing catalog templates. It never touches the
// first exit of 0,0,0 (root-first-wasteland stays exactly as before).
const Flags = require('./worldFlags');
const MAP_VERSION = 'world1-map-1';
// Region band = max(|x|,|y|)/12, as campaignSetting.plan() uses for stages.
const BAND = 12;
const UNDERGROUND_ROUTE = ['cavern', 'lava_tube', 'underground_river', 'crystal_cavern', 'fungal_cavern', 'mine'];
const TEMPLE_SECTIONS = ['roman_temple', 'deity_temple', 'catacomb', 'crypt', 'byzantine_basilica'];
const PREFER = ['north', 'down', 'northeast', 'northwest', 'east', 'west', 'southeast', 'southwest', 'south', 'up'];
const CATALOG_INDOOR = candidate => !['up'].includes(candidate.direction);
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const coords = key => { const c = String(key).split(',').map(Number); return c.length === 3 && c.every(Number.isFinite) ? { x: c[0], y: c[1], z: c[2] } : null; };
const band = key => { const c = coords(key); return c ? Math.floor(Math.max(Math.abs(c.x), Math.abs(c.y)) / BAND) : 0; };
function citySpec(seed, id, role, region, i) {
  const n = hash(`${seed}:city:${id}`);
  const guilds = ['masons', 'scribes', 'ferrymen', 'smiths', 'weavers', 'lamplighters', 'grave keepers', 'brewers', 'glassblowers', 'water wardens'];
  const pick = k => Array.from({ length: k }, (_, j) => guilds[(n >>> (j * 3)) % guilds.length]).filter((g, j, a) => a.indexOf(g) === j);
  const harbor = role === 'hades' || n % 2 === 0;
  return { id, role, stage: i, region: region?.name || `Region ${i + 1}`,
    name: role === 'hades' ? 'Hades' : `${['High', 'Old', 'Lower', 'Ember', 'Ash', 'Salt'][n % 6]} ${['Aqueduct', 'Harbor', 'Forum', 'Cistern', 'Gate', 'Terrace'][(n >>> 4) % 6]} City`,
    utilities: ['aqueduct', 'cistern', 'public fountains', ...(harbor ? ['harbor'] : []), ...(n % 3 === 0 ? ['bathhouse'] : [])],
    guilds: pick(role === 'hades' ? 5 : 3), districts: ['forum', 'guild quarter', harbor ? 'harbor ward' : 'market ward', 'tenements'],
    population: role === 'hades' ? 40000 + n % 20000 : 3000 + n % 9000,
    ...(role === 'hades' ? { ruler: 'Arithus', allegiance: 'Hostile' } : { allegiance: 'Neutral' }) };
}
function compose(seed, atlas) {
  if (!Flags.on('CAMPAIGN_MAP')) return null;
  if(atlas?.kind==='homebrew'){
    const b=require('./settingLayer').current(),genre=b.genres[0],profile=require('../assets/genreExpansion').PROFILES[genre];
    return {version:MAP_VERSION,kind:'homebrew',origin:atlas.origin,destination:atlas.destination,
      cities:(b.cities?.length?b.cities:atlas.regions).slice(0,6).map((city,i)=>({id:`world-city-${i}`,role:'waypoint',stage:i,
        name:city.name,region:atlas.regions[Math.min(3,i)].name,allegiance:'Neutral',genre,population:3000+hash(`${seed}:${i}`)%9000,
        utilities:['water supply','transport','storage'],guilds:['provisioners','builders','transporters'],districts:[...profile.names]})),
      route:{description:`Regional routes from ${atlas.origin} toward ${atlas.destination}; no mandatory detour.`},topology:'World-authored geography; cities do not relocate quests.'};
  }
  const regions = atlas?.regions || [];
  const cities = [citySpec(seed, 'test-city', 'test', regions[0], 0)];
  for (let i = 1; i < Math.max(3, regions.length - 1); i++) cities.push(citySpec(seed, `city-${i}`, 'waypoint', regions[i], i));
  cities.push(citySpec(seed, 'hades', 'hades', regions[regions.length - 1], Math.max(3, regions.length - 1)));
  return { version: MAP_VERSION, origin: 'Tartarus (Ruined Temple, 0,0,0)', destination: 'Hades', cities,
    route: { test: 'Ruined Temple first exit -> first wasteland -> adjacent subterranean biome -> test city' },
    topology: 'Temple side exits usually open into further Ruined Temple sections; each wasteland may have an adjacent underground biome; cities lie in later region bands.' };
}
// ---- CITY_PLACEMENT: the AI places cities when it builds the map; the engine validates reachability and plausibility.
const BEARINGS = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0], northeast: [1, 1], northwest: [-1, 1], southeast: [1, -1], southwest: [-1, -1] };
const CITY_TEMPLATES = { surface: ['village', 'oasis', 'market', 'hamlet'], underground: ['cavern_village'] };
const NEAR = { min: 2, max: 5 };
function keyOf(c) { return `${c.x},${c.y},${c.z}`; }
// Is one proposed site acceptable? Returns a cleaned site or null.
function validSite(site, i, taken, catalog) {
  const v = BEARINGS[String(site?.bearing || '').toLowerCase()], dist = Math.round(Number(site?.distance));
  if (!v || !Number.isFinite(dist)) return null;
  const near = i === 0, lo = near ? NEAR.min : 4 + 6 * (i - 1), hi = near ? NEAR.max : 60;
  if (dist < lo || dist > hi) return null;                                   // the near city must be close to the temple
  const underground = !!site.underground, z = 0; // caverns sit on the same grid layer so ordinary exits always reach them
  const c = { x: v[0] * dist, y: v[1] * dist, z }, key = keyOf(c);
  if (['0,0,0', '0,1,0'].includes(`${c.x},${c.y},0`) || taken.has(key)) return null; // never the temple or the first wasteland
  const pool = underground ? CITY_TEMPLATES.underground : CITY_TEMPLATES.surface;
  const template = pool.includes(site.template) ? site.template : pool[0];
  if (catalog && !Object.hasOwn(catalog, template)) return null;               // existing biome templates only
  return { key, coords: c, bearing: String(site.bearing).toLowerCase(), distance: dist, underground, template };
}
// Every site must be reachable by ordinary exits from 0,0,0 (grid neighbours, one z step down for caverns).
function reachable(site) { return Math.max(Math.abs(site.coords.x), Math.abs(site.coords.y)) >= 1 && site.coords.z >= -2 && site.coords.z <= 0; }
function seededProposal(seed, count) {
  const dirs = Object.keys(BEARINGS);
  return Array.from({ length: count }, (_, i) => { const n = hash(`${seed}:site:${i}`);
    return { bearing: dirs[n % dirs.length], distance: i === 0 ? NEAR.min + n % (NEAR.max - NEAR.min + 1) : 4 + 6 * (i - 1) + n % 6, underground: i === 0 ? n % 2 === 0 : n % 4 === 0,
      template: null }; });
}
// Attach validated sites to the composed cities. proposal: the AI's [{bearing, distance, underground, template}] in city order.
function placeCities(map, seed, proposal, catalog) {
  if (!map || !Flags.on('CITY_PLACEMENT')) return map;
  const fallback = seededProposal(seed, map.cities.length), taken = new Set(), notes = [];
  map.cities.forEach((city, i) => {
    let site = validSite(proposal?.[i], i, taken, catalog);
    if (!site || !reachable(site)) { if (proposal?.[i]) notes.push(`${city.id}: rejected ${JSON.stringify(proposal[i]).slice(0, 120)}`); site = validSite(fallback[i], i, taken, catalog) || validSite({ bearing: 'east', distance: i === 0 ? 3 : 10 + 6 * i }, i, taken, catalog); }
    if (site) { taken.add(site.key); city.site = site; }
  });
  map.placement = { version: 'world1-city-1', source: proposal ? 'ai' : 'seeded', rejected: notes };
  return map;
}
const PLACEMENT_PROMPT = cities => `Place these cities on the Tartarus-to-Hades campaign grid. The Ruined Temple is at 0,0,0; north is +y. The first exit north is a wasteland at 0,1,0 and is never a city. For each city in order give {bearing: north|south|east|west|northeast|northwest|southeast|southwest, distance: rooms from the temple, underground: true if it lies in a cavern beneath the surface, template: village|oasis|market|hamlet|cavern_village}. The first city must be near the temple (distance 2-5); later cities get farther (each at least 6 more), Hades last and farthest. Vary the layout; make it plausible for the regions: ${cities.map(c => `${c.name} (${c.region})`).join('; ')}.`;
function roomsWith(db, role) { return Object.entries(db || {}).filter(([, r]) => r?.environmentIntent?.mapRole === role || r?.mapRole === role).map(([k]) => k); }
function hintFor(city) {
  return `${city.name}: a sprawling city with ${city.utilities.join(', ')}; guilds of ${city.guilds.join(', ')}; about ${city.population} people in ${city.districts.join(', ')}.`.slice(0, 240);
}
// Choose a steered template for one candidate, or null to keep the original choice.
function steer({ database, sourceKey, candidate, seed, firstWastelandKey }) {
  if (!Flags.on('CAMPAIGN_MAP') || !candidate || candidate.constraint === 'root-first-wasteland') return null;
  const map = database?.['0,0,0']?.campaignAtlas?.map;
  if (!map || map.version !== MAP_VERSION) return null;
  const source = database[sourceKey] || {}, n = hash(`${seed}:steer:${candidate.targetKey}`);
  if(map.kind==='homebrew'){
    const city=map.cities.find(c=>c.site?.key===candidate.targetKey&&!roomsWith(database,`city:${c.id}`).length);
    return city?{template:city.site.template,mapRole:`city:${city.id}`,citySite:city,hint:hintFor(city)}:null;
  }
  // 1) Temple side exits: usually (3 in 4) another section of the Ruined Temple complex.
  if (candidate.constraint === 'root-other-indoor' || source.environmentIntent?.mapRole === 'temple-section' && CATALOG_INDOOR(candidate) && n % 3 === 0) {
    if (candidate.constraint === 'root-other-indoor' && n % 4 === 3) return null;
    return { template: TEMPLE_SECTIONS[n % TEMPLE_SECTIONS.length], mapRole: 'temple-section', complexId: 'ruined-temple',
      hint: 'Another hall of the vast Ruined Temple complex: sanctums, side chapels and colonnaded passages behind the entrance.' };
  }
  // 2) First wasteland: one adjacent subterranean biome (existing template) on the preferred side.
  const wasteland = firstWastelandKey || roomsWith(database, 'route-wasteland')[0];
  if (sourceKey === wasteland && !roomsWith(database, 'route-underground').length && candidate.preferred)
    return { template: UNDERGROUND_ROUTE[n % 3], mapRole: 'route-underground',
      hint: 'A descent beneath the wasteland into a living underground passage; travellers say a city lies beyond it.' };
  // 3) That underground biome leads on to the test city (cavern_village is the existing underground settlement template).
  const sited = Flags.on('CITY_PLACEMENT') && map.cities.find(c => c.site?.key === candidate.targetKey && !roomsWith(database, `city:${c.id}`).length);
  if (sited) return { template: sited.site.template, mapRole: `city:${sited.id}`, citySite: sited, hint: hintFor(sited) };
  const under = roomsWith(database, 'route-underground')[0], test = map.cities.find(c => c.role === 'test');
  if (!map.placement && sourceKey === under && test && !roomsWith(database, 'city:test-city').length && candidate.preferred)
    return { template: 'cavern_village', mapRole: 'city:test-city', citySite: test, hint: hintFor(test) };
  // 4) Waypoint cities and Hades: once a region band is reached, an outdoor neighbour may become that city (1 in 3).
  const b = band(candidate.targetKey), c = coords(candidate.targetKey);
  const city = !map.placement && map.cities.find(x => x.role !== 'test' && x.stage === b && !roomsWith(database, `city:${x.id}`).length);
  if (city && c && c.z >= 0 && b > 0 && n % 3 === 0)
    return { template: 'village', mapRole: `city:${city.id}`, citySite: city, hint: hintFor(city) };
  return null;
}
function preferredDirection(directions) { return PREFER.find(d => directions.includes(d)) || directions[0]; }
// Nearest planned or placed city to a room, for quests that should point to a nearby city.
function nearestCity(database, geoKey) {
  const c = coords(geoKey); if (!c) return null;
  const placed = Object.entries(database || {}).filter(([, r]) => r?.environmentIntent?.citySite).map(([k, r]) => ({ key: k, city: r.environmentIntent.citySite, c: coords(k) }));
  placed.sort((a, b) => Math.hypot(a.c.x - c.x, a.c.y - c.y) - Math.hypot(b.c.x - c.x, b.c.y - c.y));
  if (placed[0]) return { ...placed[0].city, roomKey: placed[0].key };
  const map = database?.['0,0,0']?.campaignAtlas?.map;
  const sited = (map?.cities || []).filter(x => x.site).sort((a, b) => Math.hypot(a.site.coords.x - c.x, a.site.coords.y - c.y) - Math.hypot(b.site.coords.x - c.x, b.site.coords.y - c.y));
  if (sited[0]) return { ...sited[0], roomKey: sited[0].site.key };
  return map?.cities?.find(x => x.stage >= band(geoKey)) || null;
}
module.exports = { placeCities, validSite, seededProposal, PLACEMENT_PROMPT, CITY_TEMPLATES, BEARINGS, compose, steer, preferredDirection, nearestCity, band, MAP_VERSION, UNDERGROUND_ROUTE, TEMPLE_SECTIONS };
