'use strict';
// world1 CITY_SITES (phase 1): a full city of 30-60 connected rooms laid out from one placed campaign-map city.
// Deterministic per (seed, city id, anchor key, genre). The plan supplies STRUCTURE only: districts, a street graph,
// enterable buildings (each with a return exit to its street), names, templates and genre zone tiles.
// Descriptions are still written by the model when each room is first entered (rooms are installed as named,
// undescribed skeletons, exactly like villages.install / fortifiedSites).
// Completed city plans put streets on the anchor's world grid, behind an adjacent cardinal gate.
// Old private street layers remain readable; never relocate an installed city's saved contents.
// Building storage aliases remain separate from host-local floors and are not street destinations.
const Flags = require('./worldFlags');
const STREET_DZ = 30, BUILDING_DZ = 31, UNDER_DZ = 29, VERSION = 'world1-city-sites-2', LEGACY_VERSION = 'world1-city-sites-1';
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
function plan({ seed = '', city = {}, anchorKey = '0,3,0', genre = 'fantasy', underground = false, layerOffset = 0,
  coordinateMode = Flags.on('CITY_COMPLETE') ? 'world-grid' : 'legacy-layers', gateDirection = 'north' } = {}) {
  const anchor = parseKey(anchorKey) || { x: 0, y: 3, z: 0 }, cityId = city.id || 'city', r = rng(`${seed}|${cityId}|${anchorKey}|${genre}|citysites`);
  const worldGrid = coordinateMode === 'world-grid';
  if (!['world-grid', 'legacy-layers'].includes(coordinateMode) || !CARD[gateDirection]) throw Error('Invalid city coordinate mode or gate direction.');
  const storage = { ...anchor };
  if(Flags.on('CITY_COMPLETE')){storage.x=Math.max(-970,Math.min(970,storage.x));storage.y=Math.max(-970,Math.min(950,storage.y));if(anchor.z>900)layerOffset-=60;}
  if (!worldGrid) Object.assign(anchor, storage);
  const forward = CARD[gateDirection], right = [forward[1], -forward[0]];
  const worldDirection = direction => {
    if (!worldGrid) return direction;
    const [dx, dy] = CARD[direction], wx = right[0] * dx + forward[0] * dy, wy = right[1] * dx + forward[1] * dy;
    return Object.keys(CARD).find(d => CARD[d][0] === wx && CARD[d][1] === wy);
  };
  const V = vocab(genre), streetRule = streetRuleOf(genre), axis = { main_street: 'single', harbor_quay: 'single', ring_corridor: 'ring', shanty_ring: 'ring', agora_grid: 'grid', alley_grid: 'grid', canal_grid: 'grid', block_grid: 'grid' }[streetRule] || 'organic';
  const design=city.design?require('./cityAuthoring').validate(city.design):null;
  const districtNames=design?Object.fromEntries(DISTRICTS.map(id=>[id,design.districts[id].name])):V.districts;
  const Art=require('../assets/cityArchitectureStyles');
  const nativeTemplate=(type,id)=>Art.template(genre,type,`${seed}:${cityId}:${id}`,{tradition:Art.tradition(design||{},cityId)})||require('../assets/cityEstablishments').TEMPLATES[type];
  const buildingKinds=design?Object.fromEntries(DISTRICTS.map(id=>[id,design.districts[id].locales.map(l=>[l.name,nativeTemplate(l.type,l.name),l.type])])):V.buildings;
  const target = 16 + Math.floor(r() * 6); // 16-21 streets
  // 1) street graph by growth from the gate street (0,0); never below y=0 so the gate's south side stays free for the anchor link.
  const cells = new Map([['0,0', { gx: 0, gy: 0 }]]), edges = new Set(), ek = (a, b) => [a, b].sort().join('|');
  const ok = (gx, gy) => gy >= 0 && Math.abs(gx) <= 5 && gy <= 8 && !cells.has(`${gx},${gy}`);
  let guard = 0;
  while (cells.size < target && guard++ < 5000) {
    const list = [...cells.values()], from = axis === 'single' && r() < .7 ? list[list.length - 1] : list[Math.floor(r() * list.length)];
    let dirs = Object.keys(CARD);
    if ((design?.form||axis) === 'single') dirs = r() < .75 ? ['north'] : ['east', 'west'];
    if ((design?.form||axis) === 'ring') dirs = r() < .5 ? ['north', 'east'] : ['south', 'west', 'north', 'east'];
    const d = dirs[Math.floor(r() * dirs.length)], [dx, dy] = CARD[d], gx = from.gx + dx, gy = from.gy + dy;
    if (!ok(gx, gy)) continue;
    cells.set(`${gx},${gy}`, { gx, gy }); edges.add(ek(`${from.gx},${from.gy}`, `${gx},${gy}`));
  }
  // loops: grid/ring styles join most touching streets, organic a few.
  const loopP = (design?.form||axis) === 'grid' ? .8 : (design?.form||axis) === 'ring' ? .5 : .2;
  for (const c of cells.values()) for (const d of ['north', 'east']) { const [dx, dy] = CARD[d], n = `${c.gx + dx},${c.gy + dy}`; if (cells.has(n) && r() < loopP) edges.add(ek(`${c.gx},${c.gy}`, n)); }
  // 2) districts by BFS distance from the gate, in DISTRICTS order (each gets >=1 street).
  const adj = new Map([...cells.keys()].map(k => [k, []]));
  for (const e of edges) { const [a, b] = e.split('|'); adj.get(a).push(b); adj.get(b).push(a); }
  const dist = new Map([['0,0', 0]]), order = ['0,0'];
  for (let i = 0; i < order.length; i++) for (const n of adj.get(order[i]).slice().sort()) if (!dist.has(n)) { dist.set(n, dist.get(order[i]) + 1); order.push(n); }
  const rest = order.slice(1), per = Math.max(1, Math.floor(rest.length / (DISTRICTS.length - 1)));
  const districtOf = new Map([['0,0', 'gate']]);
  rest.forEach((k, i) => districtOf.set(k, DISTRICTS[Math.min(DISTRICTS.length - 1, 1 + Math.floor(i / per))]));
  const used = { gate: 0 }, rooms = [], streetKey = k => { const c = cells.get(k); return worldGrid ?
    keyOf(anchor.x + right[0] * c.gx + forward[0] * (c.gy + 1), anchor.y + right[1] * c.gx + forward[1] * (c.gy + 1), anchor.z) :
    keyOf(anchor.x + c.gx, anchor.y + c.gy, anchor.z + STREET_DZ + layerOffset); };
  // 3) street rooms + exits
  const names = new Set();
  const uniq = base => { let n = base, i = 2; while (names.has(n)) n = `${base} ${['II', 'III', 'IV', 'V', 'VI'][i++ - 2] || i}`; names.add(n); return n; };
  const cityName = city.name || 'the City';
  for (const k of order) {
    const c = cells.get(k), district = districtOf.get(k), z = ZONE_OF[district];
    const noun = V.street[hash(`${seed}|${k}|noun`) % V.street.length], dn = districtNames[district];
    const name = uniq(k === '0,0' ? `${dn} ${noun}` : `${dn} ${noun}`);
    const exits = {};
    for (const [d, [dx, dy]] of Object.entries(CARD)) { const n = `${c.gx + dx},${c.gy + dy}`; if (edges.has(ek(k, n))) exits[worldDirection(d)] = { status: 'open', targetCoordinates: streetKey(n) }; }
    if (k === '0,0') exits[worldGrid ? REVERSE[gateDirection] : 'south'] = { status: 'open', targetCoordinates: anchorKey };
    const fabric=design?require('../assets/cityEstablishments').descriptor({seed,cityId,streetKey:streetKey(k),genre,scale:require('../assets/urbanDesigns').scale(city,genre),district,mix:design.districts[district].mix}):null;
    rooms.push({ key: streetKey(k), kind: 'street', district, districtName: dn, name, grid: [c.gx, c.gy], exits, ...(fabric?{fabric,atmosphere:design.districts[district].atmosphere}:{}), template: underground ? 'cavern_village' : district === 'market' ? 'market' : 'village', tiles: zoneTiles(genre, 'street') });
  }
  // Install authored venues before filler, so a random draw cannot omit a city's named institutions.
  const E=require('../assets/cityEstablishments'),Life=require('./cityLife'),counts=new Map();
  const Vertical=require('./cityVerticality'),verticalReserve=Vertical.reserve(city,underground);
  const streets=rooms.slice();
  function addBuilding(s,kind,localeIndex=null){
    const i=counts.get(s.key)||0;if(i>=3||rooms.length>=59-verticalReserve)return false;
    const free = BUILDING_DIRS.filter(d => !s.exits[d]);
    if(!free.length)return false;
      const [label, template, establishmentType] = kind, d = free[0];
      const key = keyOf(storage.x + s.grid[0] * 4 + (i % 4), storage.y + s.grid[1] * 4, storage.z + BUILDING_DZ + layerOffset);
      const name = uniq(localeIndex!==null?label:`${label} on ${s.name}`.length <= 80 ? `${label}, ${s.name}` : label);
      s.exits[d] = { status: 'open', targetCoordinates: key };
      const venueId=localeIndex!==null?`${cityId}:locale:${s.district}:${localeIndex}`:`${cityId}:building:${key}`;
      rooms.push({ key, kind: 'building', district: s.district, districtName: s.districtName, name, label, template,
        ...(establishmentType?{establishmentType,venue:Life.venue(establishmentType,venueId,name),atmosphere:s.atmosphere}:{}),
        ...(localeIndex!==null?{authored:true,venueId}:{}),
        streetKey: s.key, exits: { [REVERSE[d]]: { status: 'open', targetCoordinates: s.key } }, tiles: zoneTiles(genre, ZONE_OF[s.district] === 'street' ? 'interior' : ZONE_OF[s.district]) });
      counts.set(s.key,i+1);return true;
  }
  if(design)for(const district of DISTRICTS)for(const [i,locale]of design.districts[district].locales.entries()){
    const s=streets.find(s=>s.district===district&&(counts.get(s.key)||0)<3&&BUILDING_DIRS.some(d=>!s.exits[d]));
    if(!s||!addBuilding(s,[locale.name,nativeTemplate(locale.type,locale.name),locale.type],i))throw Error('No reachable city slot for authored locale: '+locale.name);
  }
  for (const s of streets) {
    const kinds=design?design.districts[s.district].mix.map(type=>[E.name(type,genre),nativeTemplate(type,s.key+':'+type),type]):buildingKinds[s.district]||buildingKinds.market;
    const n=Math.min((['market','guild','residential'].includes(s.district)?2:1)+Math.floor(r()*2),3);
    while((counts.get(s.key)||0)<n){
      const i=counts.get(s.key)||0;
      if(!addBuilding(s,kinds[(hash(`${seed}|${s.key}|b${i}`)+i)%kinds.length]))break;
    }
  }
  Vertical.add(rooms,city,{underground});
  // 5) undercity / mine entrance: the last undercity street gets a 'down' to an underground room (counts as a building).
  const under = rooms.filter(x => x.kind === 'street' && x.district === 'undercity').pop() || rooms.filter(x => x.kind === 'street').pop();
  if (under && !under.exits.down && (!worldGrid || parseKey(under.key).z > -1000)) {
    const [label, template] = (V.buildings.undercity || [])[0] || ['Undercity Entrance', 'cavern'];
    const location = parseKey(under.key);
    const key = worldGrid ? keyOf(location.x, location.y, location.z - 1) : keyOf(anchor.x + under.grid[0], anchor.y + under.grid[1], anchor.z + UNDER_DZ + layerOffset);
    under.exits.down = { status: 'open', targetCoordinates: key };
    rooms.push({ key, kind: 'building', entrance: 'undercity', district: 'undercity', districtName: V.districts.undercity, name: uniq(`${label} beneath ${cityName}`.slice(0, 80)), label, template, streetKey: under.key, exits: { up: { status: 'open', targetCoordinates: under.key } }, tiles: zoneTiles(genre, 'mine') });
  }
  const anchorDir = worldGrid ? gateDirection : 'north';
  const stats = { rooms: rooms.length, streets: rooms.filter(x => x.kind === 'street').length, buildings: rooms.filter(x => x.kind === 'building').length,
    districts: [...new Set(rooms.map(x => x.district))].length, edges: edges.size, ...(design?{authoredLocales:rooms.filter(r=>r.authored).length,proceduralFrontages:rooms.reduce((n,r)=>n+(r.fabric?.count||0),0)}:{}),
    ...(verticalReserve?{towers:rooms.filter(r=>r.vertical?.floor===0).length,landmarkFloors:rooms.filter(r=>r.vertical?.floor>0).length,storeys:design.verticality.floors}:{}) };
  return { version: worldGrid ? VERSION : LEGACY_VERSION, coordinateMode, cityId, cityName, genre, enclosed:underground||genre==='underwater'||design?.enclosed===true,streetRule, axis:design?.form||axis, anchorKey, gateKey: rooms[0].key, anchorDir, rooms, stats };
}
// ---- checks (used by tests and before install) ----
function validate(p) {
  const byKey = new Map(p.rooms.map(x => [x.key, x])), errors = [];
  if (p.rooms.length < 30 || p.rooms.length > 60) errors.push(`size ${p.rooms.length}`);
  if (byKey.size !== p.rooms.length) errors.push('duplicate keys');
  if (p.coordinateMode === 'world-grid') {
    const routes = require('../assets/outdoorRoutes'), anchor = parseKey(p.anchorKey);
    if (!anchor || p.gateKey !== routes.resolveExit(anchor, p.anchorDir, {}).targetKey) errors.push('world-grid gate is not adjacent');
    for (const room of p.rooms) {
      const at = parseKey(room.key);
      if (!at || !Object.values(at).every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1000)) errors.push('world-grid coordinates out of bounds');
      if (room.kind !== 'street' || !at) continue;
      for (const [direction, exit] of Object.entries(room.exits)) if (exit.targetCoordinates === p.anchorKey || byKey.get(exit.targetCoordinates)?.kind === 'street') {
        if (exit.targetCoordinates !== routes.resolveExit(at, direction, {}).targetKey) errors.push(`${room.key} ${direction} world-grid street is not adjacent`);
      }
    }
  }
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
  const worldGrid = Flags.on('CITY_COMPLETE');
  const available = (worldGrid ? ['north', 'east', 'south', 'west'] : ['north', 'northeast', 'northwest', 'east', 'west', 'up', 'southeast', 'southwest', 'south']).filter(d => !anchorRoom.exits?.[d]);
  if (!available.length) return { status: 'skipped', reason: 'no-free-anchor-exit' };
  let p, dir;
  for (const candidate of available) {
    for (let shift = 0; shift <= (worldGrid ? 20 : 0); shift++) {
      const next = plan({ seed, city: site, anchorKey, genre: genreFor({ ...anchorRoom, roomKey: anchorKey }), underground,
        gateDirection: worldGrid ? candidate : 'north', layerOffset: shift * 3 * (parseKey(anchorKey).z > 900 ? -1 : 1) });
      // A street collision cannot be fixed by changing storage layers. Try a different adjacent gate.
      if (worldGrid && next.rooms.some(r => r.kind === 'street' && database[r.key])) break;
      if (worldGrid && next.rooms.some(r => database[r.key])) continue;
      if (validate(next).length) break;
      p = next; dir = candidate; break;
    }
    if (p) break;
  }
  if (!p) return { status: 'skipped', reason: 'city-space-occupied' };
  const errors = validate(p); if (errors.length) return { status: 'invalid', errors: errors.slice(0, 5) };
  // Link the chosen adjacent gate and its actual reverse direction.
  const catalog = require('./environmentIntents').CATALOG;
  let installed = 0, kept = 0;
  for (const x of p.rooms) {
    if (database[x.key]) { kept++; continue; }
    const canonical = catalog[x.template] || catalog.village, building = x.kind === 'building',indoor=p.enclosed||building&&!x.venue?.openAir;
    database[x.key] = { name: x.name, indoor, isIndoor: indoor, isOutdoor: !indoor,
      ...(!x.authored?{namePending:true}:{}),
      ...(building ? { complexId: `city-building:${x.key}` } : {}),
      classification: { indoor, size: building ? Flags.on('ARCHITECTURE_EXPANSION')?Math.max(x.venue?.width||32,x.venue?.depth||32):64 : 128, biome: canonical.biome, architecture: canonical.architecture, features: [] },
      exits: structuredClone(x.exits), objects: [], monsters: { inRoom: 'None', state: 'None', equippedProperties: 'None' },
      environmentIntent: { ...canonical,indoor,targetKey: x.key, mapRole: `city:${site.id}`, narrativeHint: hintFor(p, x), ...(building ? {} : { citySite: site }) },
      cityRoom: { version: p.version, coordinateMode: p.coordinateMode, cityId: p.cityId, cityName: p.cityName, anchorKey, kind: x.kind, district: x.district, districtName: x.districtName, genre: p.genre, tiles: x.tiles,
        ...(x.fabric?{fabric:x.fabric}:{}),...(x.establishmentType?{establishmentType:x.establishmentType}:{}),...(x.atmosphere?{atmosphere:x.atmosphere}:{}),
        ...(x.vertical?{vertical:x.vertical}:{}),
        ...(x.venue?{venue:x.venue}:{}),...(x.authored?{authored:true,venueId:x.venueId}:{}),
        ...(building&&Flags.on('ARCHITECTURE_EXPANSION')?{footprint:{width:x.venue?.width||32,depth:x.venue?.depth||32,metresPerCell:2.5}}:{}),
        ...(x.streetKey ? { streetKey: x.streetKey } : {}), ...(x.entrance ? { entrance: x.entrance } : {}) } };
    installed++;
  }
  anchorRoom.exits ||= {}; anchorRoom.exits[dir] = { status: 'open', targetCoordinates: p.gateKey };
  const gate = database[p.gateKey]; if (gate?.exits) gate.exits[worldGrid ? REVERSE[dir] : 'south'] = { status: 'open', targetCoordinates: anchorKey };
  anchorRoom.villageScan = 1; // the full city replaces the 2-4 building village insert on the anchor
  anchorRoom.citySites = { version: p.version, coordinateMode: p.coordinateMode, genre: p.genre, gateKey: p.gateKey, gateDirection: dir, rooms: p.rooms.length, stats: p.stats };
  if(Flags.on('ARCHITECTURE_EXPANSION'))require('./cityTowerFloors').install(database,anchorKey,{hostLocal:true});
  require('./cityArchitecture').installNamed(database,anchorKey);
  require('./cityCompletion').enrich(database,anchorKey);
  return { status: 'installed', direction: dir, installed, kept, stats: p.stats, genre: p.genre };
}
function hintFor(p, x) {
  if(x.vertical)return `Inside ${x.label} in ${p.cityName}; tower level ${x.vertical.floor} of ${x.vertical.storeys}, used for ${x.vertical.use}. Connected by ${x.vertical.transit}; only saved exits are usable.`.slice(0,240);
  const t = x.kind === 'street' ? `A ${x.districtName} street of ${p.cityName}; ${p.genre} city, ${p.streetRule.replace(/_/g, ' ')} layout, buildings open off it.` :
    `Inside the ${x.label} in the ${x.districtName} of ${p.cityName}; a single walk-in building whose door leads back to the street.`;
  return t.slice(0, 240);
}
// Prompt guidance for a city room (structure is fixed; model writes the prose).
function describe(room) {
  if (!Flags.on('CITY_SITES') || !room?.cityRoom) return '';
  const c = room.cityRoom;
  return `[CITY] Saved city structure (data): ${JSON.stringify({ city: c.cityName, district: c.districtName, kind: c.kind, genre: c.genre,atmosphere:c.atmosphere,establishmentType:c.establishmentType,vertical:c.vertical?{...c.vertical,directory:undefined}:undefined,footprint:c.footprint,fabric:c.fabric?{count:c.fabric.count,policy:'Seeded frontages may acquire persistent residents, interiors or side jobs through investigation and encounters; they are not all current service operators.'}:undefined })}. This room is part of a large, populous city: describe a ${c.kind === 'street' ? 'street with facades, signs and traffic' : c.venue?.openAir?'purpose-built public open space':'building interior'} in that district. ${require('./cityLife').guidance(c.venue)} ${c.vertical?'Preserve its actual tower level, function and height above the street. Crown access is enclosed; do not invent a walkable outdoor rooftop or unbuilt intermediate floor. Use only the saved stairs, ramps, lifts or covered skybridge routes. ':''}Exits are fixed by the city plan; do not add or remove exits. [/CITY]`;
}
// sceneSpec room kind for renderers ('city' biome kind; existing biome keyword scoring is left unchanged).
function sceneKind(room, database = {}) {
  if(!room?.cityRoom){
    const site=room?.environmentIntent?.citySite;
    if(!site||!room.citySites)return null;
    return {biome:'city',roomKind:'city-gateway',district:'gate',genre:site.genre||genreFor(room),tiles:zoneTiles(site.genre||genreFor(room),'street'),routes:[]};
  }
  return {biome:'city',roomKind:`city-${room.cityRoom.kind}`,district:room.cityRoom.district,genre:room.cityRoom.genre,
    ...(require('./cityArchitecture').forRoom(room,database)?{architecture:require('./cityArchitecture').forRoom(room,database)}:{}),
    tiles:room.cityRoom.tiles || null, ...(room.cityRoom.venue?{venue:room.cityRoom.venue}:{}), ...(room.cityRoom.floorProgram?{floorProgram:room.cityRoom.floorProgram}:{}), ...(room.cityRoom.vertical?{vertical:{...room.cityRoom.vertical,directory:undefined}}:{}), ...(room.cityRoom.fabric?{fabric:room.cityRoom.fabric}:{}),routes:Object.entries(room.exits||{}).flatMap(([direction,e])=>{
      const target=database[e?.targetCoordinates];
      return target?.cityRoom?.kind==='building'?[{direction,targetCoordinates:e.targetCoordinates,name:target.name,kind:'building',
        template:target.environmentIntent?.template,footprint:target.cityRoom.footprint,establishmentType:target.cityRoom.establishmentType,vertical:target.cityRoom.vertical}]:[];
    })};
}
module.exports = { plan, validate, install, describe, sceneKind, zoneTiles, VERSION, STREET_DZ, BUILDING_DZ, UNDER_DZ, DISTRICTS, VOCAB };
