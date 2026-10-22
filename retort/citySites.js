'use strict';
// world1 CITY_SITES (phase 1): a full city of 30-60 connected rooms laid out from one placed campaign-map city.
// Deterministic per (seed, city id, anchor key, genre). The plan supplies STRUCTURE only: districts, a street graph,
// enterable buildings (each with a return exit to its street), names, templates and genre zone tiles.
// Descriptions are still written by the model when each room is first entered (rooms are installed as named,
// undescribed skeletons, exactly like villages.install / fortifiedSites).
// Coordinates: the anchor (the placed city room, e.g. the test city at 0,3,0) stays where it is and becomes the
// city gate. Street rooms live on a private layer z = anchor.z + STREET_DZ at x/y offsets from the anchor, and
// building interiors on z = anchor.z + BUILDING_DZ, so nothing collides with lazily generated dungeon/wilderness
// rooms on the anchor's own layer. Every link is an explicit exit with targetCoordinates (as fortified floors do).
const Flags = require('./worldFlags');
const STREET_DZ = 30, BUILDING_DZ = 31, UNDER_DZ = 29, VERSION = 'world1-city-sites-1';
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => { let a = hash(seed); return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const CARD = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] };
const REVERSE = { north: 'south', south: 'north', east: 'west', west: 'east', northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest', up: 'down', down: 'up' };
const BUILDING_DIRS = ['northeast', 'northwest', 'southeast', 'southwest', 'north', 'east', 'west'];
const DISTRICTS = ['gate', 'market', 'temple', 'residential', 'guild', 'harbor', 'undercity'];
// Genre vocabulary: district names, street nouns and building kinds -> [label, catalog template, genre zone].
const VOCAB = {
  fantasy: { street: ['Street', 'Lane', 'Way', 'Row'], districts: { gate: 'Gate Ward', market: 'Forum', temple: 'Temple Quarter', residential: 'Tenements', guild: 'Guild Quarter', harbor: 'Harbor Ward', undercity: 'Cistern Steps' },
    buildings: { gate: [['Watch House', 'watch_house'], ['Gatehouse', 'gatehouse']], market: [['Inn', 'inn'], ['Counting House', 'guildhall'], ['Wine Shop', 'house']], temple: [['Temple', 'roman_temple'], ['Basilica', 'byzantine_basilica'], ['Shrine House', 'deity_temple']],
      residential: [['Insula', 'house'], ['Townhouse', 'house'], ['Domus', 'villa']], guild: [['Guildhall', 'guildhall'], ['Forge', 'cinder_forge'], ['Workshop', 'house']], harbor: [['Warehouse', 'soul_registry'], ['Ferry House', 'inn'], ['Customs House', 'guildhall']], undercity: [['Cistern', 'cavern'], ['Mine Adit', 'mine']] } },
  western: { street: ['Street', 'Row', 'Alley', 'Trail'], districts: { gate: 'Stage Stop', market: 'Main Street', temple: 'Church Hill', residential: 'Boarding Row', guild: 'Smithy Row', harbor: 'Rail Depot', undercity: 'Silver Mine' },
    buildings: { gate: [['Sheriff Office', 'watch_house'], ['Livery', 'house']], market: [['Saloon', 'inn'], ['General Store', 'guildhall'], ['Bank', 'guildhall']], temple: [['Church', 'roman_temple'], ['Parsonage', 'house']],
      residential: [['Boarding House', 'house'], ['Cabin', 'house']], guild: [['Blacksmith', 'cinder_forge'], ['Assay Office', 'guildhall']], harbor: [['Depot', 'soul_registry'], ['Freight House', 'guildhall']], undercity: [['Mine Shaft', 'mine'], ['Ore Gallery', 'mine']] } },
  'sci-fi': { street: ['Corridor', 'Concourse', 'Spoke', 'Ring'], districts: { gate: 'Airlock Gate', market: 'Trade Concourse', temple: 'Chapel Deck', residential: 'Hab Ring', guild: 'Fabrication Bay', harbor: 'Docking Ring', undercity: 'Maintenance Underdeck' },
    buildings: { gate: [['Security Post', 'watch_house'], ['Customs Lock', 'gatehouse']], market: [['Canteen', 'inn'], ['Exchange', 'guildhall']], temple: [['Chapel Module', 'deity_temple'], ['Memorial Hall', 'roman_temple']],
      residential: [['Hab Unit', 'house'], ['Crew Quarters', 'house']], guild: [['Fab Shop', 'cinder_forge'], ['Lab', 'wizard_tower']], harbor: [['Cargo Hold', 'soul_registry'], ['Hangar Office', 'guildhall']], undercity: [['Reactor Access', 'mine'], ['Service Crawlway', 'cavern']] } },
  cyberpunk: { street: ['Alley', 'Strip', 'Overpass', 'Arcade'], districts: { gate: 'Checkpoint', market: 'Night Market', temple: 'Neon Chapel', residential: 'Stack Blocks', guild: 'Chop District', harbor: 'Freight Port', undercity: 'Undercity' },
    buildings: { gate: [['Checkpoint Booth', 'watch_house']], market: [['Noodle Bar', 'inn'], ['Data Broker', 'guildhall'], ['Pawn Shop', 'house']], temple: [['Neon Chapel', 'deity_temple']],
      residential: [['Capsule Stack', 'house'], ['Squat', 'house']], guild: [['Ripperdoc Clinic', 'guildhall'], ['Chop Shop', 'cinder_forge']], harbor: [['Container Yard Office', 'soul_registry']], undercity: [['Drainage Tunnel', 'cavern'], ['Old Metro', 'mine']] } }
};
VOCAB['dark-fantasy'] = VOCAB.mythic = VOCAB.fantasy;
const ZONE_OF = { gate: 'street', market: 'street', temple: 'church', residential: 'house', guild: 'interior', harbor: 'street', undercity: 'mine' };
function vocab(genre) { return VOCAB[genre] || (Flags.on('CITY_COMPLETE') && require('./cityCompletion').vocab(genre)) || VOCAB.fantasy; }
const parseKey = k => { const c = String(k).split(',').map(Number); return c.length === 3 && c.every(Number.isFinite) ? { x: c[0], y: c[1], z: c[2] } : null; };
const keyOf = (x, y, z) => `${x},${y},${z}`;
// Genre zone tiles (wall/floor/door/window/trim/street) from genreArchitecture; null = keep the current (Ruined Temple / cityKit) look.
function zoneTiles(genre, zone) {
  let A; try { A = require('../assets/genreArchitecture'); } catch { return null; }
  const S = A.STYLES[genre]; if (!S || S.keep) return null;
  const Z = S.zones?.[zone] || {};
  const pick = f => Z[f] !== undefined ? Z[f] : S[f];
  return { wall: pick('wall'), floor: pick('floor'), door: pick('door'), window: pick('window'), trim: pick('trim'), street: S.street || null, shape: Z.shape || S.shapes?.[0] || 'hall' };
}
function streetRuleOf(genre) { try { return require('../assets/genreArchitecture').STYLES[genre]?.street || 'winding_lanes'; } catch { return 'winding_lanes'; } }
// ---- the plan ----
function plan({ seed = '', city = {}, anchorKey = '0,3,0', genre = 'fantasy', underground = false, layerOffset = 0 } = {}) {
  const anchor = parseKey(anchorKey) || { x: 0, y: 3, z: 0 }, cityId = city.id || 'city', r = rng(`${seed}|${cityId}|${anchorKey}|${genre}|citysites`);
  if(Flags.on('CITY_COMPLETE')){anchor.x=Math.max(-970,Math.min(970,anchor.x));anchor.y=Math.max(-970,Math.min(950,anchor.y));if(anchor.z>900)layerOffset-=60;}
  const V = vocab(genre), streetRule = streetRuleOf(genre), axis = { main_street: 'single', harbor_quay: 'single', ring_corridor: 'ring', shanty_ring: 'ring', agora_grid: 'grid', alley_grid: 'grid', canal_grid: 'grid', block_grid: 'grid' }[streetRule] || 'organic';
  const target = 16 + Math.floor(r() * 6); // 16-21 streets
  // 1) street graph by growth from the gate street (0,0); never below y=0 so the gate's south side stays free for the anchor link.
  const cells = new Map([['0,0', { gx: 0, gy: 0 }]]), edges = new Set(), ek = (a, b) => [a, b].sort().join('|');
  const ok = (gx, gy) => gy >= 0 && Math.abs(gx) <= 5 && gy <= 8 && !cells.has(`${gx},${gy}`);
  let guard = 0;
  while (cells.size < target && guard++ < 5000) {
    const list = [...cells.values()], from = axis === 'single' && r() < .7 ? list[list.length - 1] : list[Math.floor(r() * list.length)];
    let dirs = Object.keys(CARD);
    if (axis === 'single') dirs = r() < .75 ? ['north'] : ['east', 'west'];
    if (axis === 'ring') dirs = r() < .5 ? ['north', 'east'] : ['south', 'west', 'north', 'east'];
    const d = dirs[Math.floor(r() * dirs.length)], [dx, dy] = CARD[d], gx = from.gx + dx, gy = from.gy + dy;
    if (!ok(gx, gy)) continue;
    cells.set(`${gx},${gy}`, { gx, gy }); edges.add(ek(`${from.gx},${from.gy}`, `${gx},${gy}`));
  }
  // loops: grid/ring styles join most touching streets, organic a few.
  const loopP = axis === 'grid' ? .8 : axis === 'ring' ? .5 : .2;
  for (const c of cells.values()) for (const d of ['north', 'east']) { const [dx, dy] = CARD[d], n = `${c.gx + dx},${c.gy + dy}`; if (cells.has(n) && r() < loopP) edges.add(ek(`${c.gx},${c.gy}`, n)); }
  // 2) districts by BFS distance from the gate, in DISTRICTS order (each gets >=1 street).
  const adj = new Map([...cells.keys()].map(k => [k, []]));
  for (const e of edges) { const [a, b] = e.split('|'); adj.get(a).push(b); adj.get(b).push(a); }
  const dist = new Map([['0,0', 0]]), order = ['0,0'];
  for (let i = 0; i < order.length; i++) for (const n of adj.get(order[i]).slice().sort()) if (!dist.has(n)) { dist.set(n, dist.get(order[i]) + 1); order.push(n); }
  const rest = order.slice(1), per = Math.max(1, Math.floor(rest.length / (DISTRICTS.length - 1)));
  const districtOf = new Map([['0,0', 'gate']]);
  rest.forEach((k, i) => districtOf.set(k, DISTRICTS[Math.min(DISTRICTS.length - 1, 1 + Math.floor(i / per))]));
  const used = { gate: 0 }, rooms = [], streetKey = k => { const c = cells.get(k); return keyOf(anchor.x + c.gx, anchor.y + c.gy, anchor.z + STREET_DZ + layerOffset); };
  // 3) street rooms + exits
  const names = new Set();
  const uniq = base => { let n = base, i = 2; while (names.has(n)) n = `${base} ${['II', 'III', 'IV', 'V', 'VI'][i++ - 2] || i}`; names.add(n); return n; };
  const cityName = city.name || 'the City';
  for (const k of order) {
    const c = cells.get(k), district = districtOf.get(k), z = ZONE_OF[district];
    const noun = V.street[hash(`${seed}|${k}|noun`) % V.street.length], dn = V.districts[district];
    const name = uniq(k === '0,0' ? `${dn} ${noun}` : `${dn} ${noun}`);
    const exits = {};
    for (const [d, [dx, dy]] of Object.entries(CARD)) { const n = `${c.gx + dx},${c.gy + dy}`; if (edges.has(ek(k, n))) exits[d] = { status: 'open', targetCoordinates: streetKey(n) }; }
    if (k === '0,0') exits.south = { status: 'open', targetCoordinates: anchorKey };
    rooms.push({ key: streetKey(k), kind: 'street', district, districtName: dn, name, grid: [c.gx, c.gy], exits, template: underground ? 'cavern_village' : district === 'market' ? 'market' : 'village', tiles: zoneTiles(genre, 'street') });
  }
  // 4) buildings: 1-3 per street (2-4 on market/guild), each an interior room with a return exit to its street.
  let bIndex = 0;
  for (const s of rooms.slice()) {
    if (s.kind !== 'street') continue;
    const kinds = V.buildings[s.district] || V.buildings.market, n = Math.min((['market', 'guild', 'residential'].includes(s.district) ? 2 : 1) + Math.floor(r() * 2), 3);
    const free = BUILDING_DIRS.filter(d => !s.exits[d]);
    for (let i = 0; i < n && i < free.length && rooms.length < 59; i++) {
      const [label, template] = kinds[(hash(`${seed}|${s.key}|b${i}`) + i) % kinds.length], d = free[i];
      const key = keyOf(anchor.x + s.grid[0] * 4 + (i % 4), anchor.y + s.grid[1] * 4, anchor.z + BUILDING_DZ + layerOffset);
      const name = uniq(`${label} on ${s.name}`.length <= 80 ? `${label}, ${s.name}` : label);
      s.exits[d] = { status: 'open', targetCoordinates: key };
      rooms.push({ key, kind: 'building', district: s.district, districtName: s.districtName, name, label, template, streetKey: s.key, exits: { [REVERSE[d]]: { status: 'open', targetCoordinates: s.key } }, tiles: zoneTiles(genre, ZONE_OF[s.district] === 'street' ? 'interior' : ZONE_OF[s.district]) });
      bIndex++;
    }
  }
  // 5) undercity / mine entrance: the last undercity street gets a 'down' to an underground room (counts as a building).
  const under = rooms.filter(x => x.kind === 'street' && x.district === 'undercity').pop() || rooms.filter(x => x.kind === 'street').pop();
  if (under && !under.exits.down) {
    const [label, template] = (V.buildings.undercity || [])[0] || ['Undercity Entrance', 'cavern'];
    const key = keyOf(anchor.x + under.grid[0], anchor.y + under.grid[1], anchor.z + UNDER_DZ + layerOffset);
    under.exits.down = { status: 'open', targetCoordinates: key };
    rooms.push({ key, kind: 'building', entrance: 'undercity', district: 'undercity', districtName: V.districts.undercity, name: uniq(`${label} beneath ${cityName}`.slice(0, 80)), label, template, streetKey: under.key, exits: { up: { status: 'open', targetCoordinates: under.key } }, tiles: zoneTiles(genre, 'mine') });
  }
  const anchorDir = 'north';
  const stats = { rooms: rooms.length, streets: rooms.filter(x => x.kind === 'street').length, buildings: rooms.filter(x => x.kind === 'building').length,
    districts: [...new Set(rooms.map(x => x.district))].length, edges: edges.size };
  return { version: VERSION, cityId, cityName, genre, streetRule, axis, anchorKey, gateKey: rooms[0].key, anchorDir, rooms, stats };
}
// ---- checks (used by tests and before install) ----
function validate(p) {
  const byKey = new Map(p.rooms.map(x => [x.key, x])), errors = [];
  if (p.rooms.length < 30 || p.rooms.length > 60) errors.push(`size ${p.rooms.length}`);
  if (byKey.size !== p.rooms.length) errors.push('duplicate keys');
  for (const x of p.rooms) for (const [d, e] of Object.entries(x.exits)) {
    if (e.targetCoordinates === p.anchorKey) continue;
    const t = byKey.get(e.targetCoordinates); if (!t) { errors.push(`${x.key} ${d} -> missing`); continue; }
    if (!Object.values(t.exits).some(b => b.targetCoordinates === x.key)) errors.push(`${x.key} ${d} not reciprocal`);
  }
  const seen = new Set([p.gateKey]), q = [p.gateKey];
  while (q.length) for (const e of Object.values(byKey.get(q.shift()).exits)) if (byKey.has(e.targetCoordinates) && !seen.has(e.targetCoordinates)) { seen.add(e.targetCoordinates); q.push(e.targetCoordinates); }
  if (seen.size !== p.rooms.length) errors.push(`unreachable ${p.rooms.length - seen.size}`);
  return errors;
}
// ---- install into the room database (skeletons; idempotent; never overwrites an existing room) ----
function genreFor(anchorRoom) { try {
  if(Flags.on('CITY_COMPLETE'))return require('../assets/genreKits').resolve(anchorRoom,require('./genreLayer').activeSetting()).genre;
  return require('./genreLayer').archFor(anchorRoom || {})?.genre || 'fantasy';
} catch { return 'fantasy'; } }
function install(database, anchorKey, { seed = '' } = {}) {
  if (!Flags.on('CITY_SITES') || !database) return { status: 'skipped' };
  if(!parseKey(anchorKey))return {status:'skipped',reason:'invalid-anchor'};
  const anchorRoom = database[anchorKey], site = anchorRoom?.environmentIntent?.citySite;
  if (anchorRoom?.cityRoom) {
    const upgraded=require('./cityCompletion').enrich(database,anchorRoom.cityRoom.anchorKey);
    return {status:upgraded?'upgraded':'already-installed',reason:'city-member'};
  }
  if (!site) return { status: 'skipped', reason: 'not-a-city' };
  if (anchorRoom.citySites?.version) {
    const upgraded=require('./cityCompletion').enrich(database,anchorKey);
    return { status: upgraded?'upgraded':'already-installed', rooms: anchorRoom.citySites.rooms };
  }
  const underground = anchorRoom.environmentIntent?.template === 'cavern_village' || !!site.site?.underground;
  let p = plan({ seed, city: site, anchorKey, genre: genreFor({ ...anchorRoom, roomKey: anchorKey }), underground });
  if (Flags.on('CITY_COMPLETE')) {
    let shift=0;
    while(p.rooms.some(r=>database[r.key])&&shift<20){shift++;p=plan({seed,city:site,anchorKey,genre:p.genre,underground,layerOffset:shift*3*(parseKey(anchorKey).z>900?-1:1)});}
    if(p.rooms.some(r=>database[r.key]))return {status:'skipped',reason:'city-space-occupied'};
  }
  const errors = validate(p); if (errors.length) return { status: 'invalid', errors: errors.slice(0, 5) };
  // gate link: first free direction on the anchor (north preferred), reverse is the gate street's 'south'.
  const dir = ['north', 'northeast', 'northwest', 'east', 'west', 'up', 'southeast', 'southwest', 'south'].find(d => !anchorRoom.exits?.[d]);
  if (!dir) return { status: 'skipped', reason: 'no-free-anchor-exit' };
  const catalog = require('./environmentIntents').CATALOG;
  let installed = 0, kept = 0;
  for (const x of p.rooms) {
    if (database[x.key]) { kept++; continue; }
    const canonical = catalog[x.template] || catalog.village, building = x.kind === 'building';
    database[x.key] = { name: x.name, indoor: building || underground, isIndoor: building || underground, isOutdoor: !(building || underground),
      ...(building ? { complexId: `city-building:${x.key}` } : {}),
      classification: { indoor: building || underground, size: building ? 64 : 128, biome: canonical.biome, architecture: canonical.architecture, features: [] },
      exits: structuredClone(x.exits), objects: [], monsters: { inRoom: 'None', state: 'None', equippedProperties: 'None' },
      environmentIntent: { ...canonical, targetKey: x.key, mapRole: `city:${site.id}`, narrativeHint: hintFor(p, x), ...(building ? {} : { citySite: site }) },
      cityRoom: { version: VERSION, cityId: p.cityId, cityName: p.cityName, anchorKey, kind: x.kind, district: x.district, districtName: x.districtName, genre: p.genre, tiles: x.tiles, ...(x.streetKey ? { streetKey: x.streetKey } : {}), ...(x.entrance ? { entrance: x.entrance } : {}) } };
    installed++;
  }
  anchorRoom.exits ||= {}; anchorRoom.exits[dir] = { status: 'open', targetCoordinates: p.gateKey };
  const gate = database[p.gateKey]; if (gate?.exits) gate.exits.south = { status: 'open', targetCoordinates: anchorKey };
  anchorRoom.villageScan = 1; // the full city replaces the 2-4 building village insert on the anchor
  anchorRoom.citySites = { version: VERSION, genre: p.genre, gateKey: p.gateKey, gateDirection: dir, rooms: p.rooms.length, stats: p.stats };
  require('./cityCompletion').enrich(database,anchorKey);
  return { status: 'installed', direction: dir, installed, kept, stats: p.stats, genre: p.genre };
}
function hintFor(p, x) {
  const t = x.kind === 'street' ? `A ${x.districtName} street of ${p.cityName}; ${p.genre} city, ${p.streetRule.replace(/_/g, ' ')} layout, buildings open off it.` :
    `Inside the ${x.label} in the ${x.districtName} of ${p.cityName}; a single walk-in building whose door leads back to the street.`;
  return t.slice(0, 240);
}
// Prompt guidance for a city room (structure is fixed; model writes the prose).
function describe(room) {
  if (!Flags.on('CITY_SITES') || !room?.cityRoom) return '';
  const c = room.cityRoom;
  return `[CITY] Saved city structure (data): ${JSON.stringify({ city: c.cityName, district: c.districtName, kind: c.kind, genre: c.genre })}. This room is part of a large, populous city: describe a ${c.kind === 'street' ? 'street with facades, signs and traffic' : 'single building interior'} in that district. Exits are fixed by the city plan; do not add or remove exits. [/CITY]`;
}
// sceneSpec room kind for renderers ('city' biome kind; existing biome keyword scoring is left unchanged).
function sceneKind(room, database = {}) {
  if(!room?.cityRoom)return null;
  return {biome:'city',roomKind:`city-${room.cityRoom.kind}`,district:room.cityRoom.district,genre:room.cityRoom.genre,
    tiles:room.cityRoom.tiles || null,routes:Object.entries(room.exits||{}).flatMap(([direction,e])=>{
      const target=database[e?.targetCoordinates];
      return target?.cityRoom?.kind==='building'?[{direction,targetCoordinates:e.targetCoordinates,name:target.name,kind:'building'}]:[];
    })};
}
module.exports = { plan, validate, install, describe, sceneKind, zoneTiles, VERSION, STREET_DZ, BUILDING_DZ, UNDER_DZ, DISTRICTS, VOCAB };
