'use strict';

const { random } = require('./dungeonGeneration');
const VERSION = 1;
// Spatial briefs, not room plots. Each may serve many occupations and stories.
const PROFILES = {
  fantasy: ['bridge_keep|ring|layered stone keeps and covered bridges', 'canopy_hall|terraces|timber galleries around living trees', 'sunken_archive|spine|recessed reading courts and carved lintels'],
  'dark-fantasy': ['mourning_precinct|terraces|stepped masonry and narrow memorial courts', 'chain_gallery|ring|iron-braced galleries around a deep central hall', 'buried_sanctuary|spine|heavy piers and lowered side chambers'],
  mythic: ['hilltop_stoa|terraces|marble terraces and shaded stoas', 'ceremonial_precinct|ring|processional courts and monumental thresholds', 'assembly_hall|spine|coffered civic halls and painted friezes'],
  'sci-fi': ['reactor_annulus|ring|pressure ribs and radial service galleries', 'split_deck_freight|spine|loading bays and elevated control platforms', 'cultivation_cascade|terraces|stepped growing beds and inspection decks'],
  cyberpunk: ['stacked_exchange|terraces|layered shop fronts and cable galleries', 'data_courtyard|ring|screen-lined service loops and security thresholds', 'rail_concourse|spine|transit platforms and neon mezzanines'],
  'post-apocalyptic': ['salvage_bowl|ring|patched retaining walls and scrap overlooks', 'broken_avenue|terraces|reused road decks and inhabited embankments', 'shelter_spine|spine|reinforced passages and improvised work bays'],
  steampunk: ['flywheel_hall|ring|riveted trusses and maintenance galleries', 'pump_cascade|terraces|brass pipe runs and stepped machinery bays', 'mooring_terminal|spine|iron-framed concourses and boarding platforms'],
  western: ['assay_workings|spine|timber shoring and descending work galleries', 'rail_roundhouse|ring|radial workshops and covered timber walks', 'mesa_settlement|terraces|adobe retaining walls and shaded boardwalks'],
  modern: ['civic_atrium|ring|concrete balconies and daylight courts', 'transit_interchange|spine|wayfinding bands and separated platform bays', 'floodworks|terraces|service terraces and recessed pump courts'],
  noir: ['theatre_balconies|ring|deco railings and curtained side galleries', 'press_hall|spine|clerestory workrooms and elevated offices', 'hillside_tenements|terraces|rain-dark landings and stepped brick fronts'],
  nautical: ['drydock_rim|ring|timbered dock walls and gangway galleries', 'split_quarterdeck|terraces|deck stairs and rope-railed platforms', 'tide_warehouse|spine|cargo aisles and elevated counting rooms'],
  'cosmic-horror': ['offset_observatory|ring|misaligned radial bays and black-stone ribs', 'descending_listening_hall|spine|crooked galleries around a continuous dry route', 'drowned_causeways|terraces|tidal retaining walls and raised sheltered paths'],
  'gothic-horror': ['buttressed_hall|spine|rib vaults and deep window recesses', 'wintergarden_steps|terraces|iron tracery and terraced conservatories', 'choir_ambulatory|ring|pointed arcades and elevated choir walks'],
  solarpunk: ['canopy_exchange|ring|trellised galleries and communal garden courts', 'algae_cascade|terraces|planted retaining walls and shaded water channels', 'community_atrium|spine|laminated timber and broad accessible ramps'],
  dieselpunk: ['hangar_loop|ring|armored trusses and maintenance balconies', 'wind_channel|spine|baffled concrete halls and inspection bays', 'powerhouse_steps|terraces|riveted equipment decks and massive piers'],
  underwater: ['pressure_ring|ring|sealed radial chambers and observation ribs', 'reef_terraces|terraces|pressure-rated viewing bays and sampling shelves', 'bathysphere_terminal|spine|reinforced docks and enclosed service galleries'],
  prehistoric: ['cliff_shelters|terraces|rock ledges and lashed shelter frames', 'gathering_hearths|ring|stone hearth courts and hide canopies', 'ridge_workings|spine|worked rock passages and timber staging'],
  'desert-fantasy': ['windcatcher_courts|ring|pierced screens and shaded wind towers', 'cistern_galleries|spine|cool covered passages and ceramic channels', 'caravan_terraces|terraces|sandstone retaining walls and woven awnings']
};
const hash = value => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function select(genre, { seed = '', geoKey = '', name = '' } = {}) {
  const rows = PROFILES[genre];
  if (!rows) return null;
  const stamp = `${seed}|${geoKey}|${name}|${genre}`, index = hash(stamp) % rows.length;
  const [id, topology, style] = rows[index].split('|');
  return { version: VERSION, id: `${genre}:${id}`, genre, topology, style, seed: stamp };
}

function forRoom(room = {}, { setting = require('./settingLayer').current(), seed = '' } = {}) {
  const Flags = require('./worldFlags');
  if (!setting || !Flags.on('GENRE_ARCH') || !Flags.on('ARCHITECTURE_EXPANSION')) return null;
  const kit = require('../assets/genreKits').resolve(room, setting);
  if (!kit.homebrew) return null;
  return select(kit.genre, { seed: seed || room.generation?.seed || room.seed || setting.worldSeed,
    geoKey: room.geoKey || room.roomKey || room.generation?.roomKey || '', name: room.source?.roomName || room.roomName || room.name || '' });
}

function plan(profile, { roof = 'panel', covered = true } = {}) {
  if (!profile || !PROFILES[profile.genre]) return null;
  const rng = random(profile.seed), mirror = rng() < .5, rise = .75 + Math.floor(rng() * 4) * .25;
  const clearance = 4 + Math.floor(rng() * 3);
  const space = (x, y, w, h, floor, role = 'chamber', shape = 'hall') => ({ x, y, w, h,
    floor: floor * rise, role, shape, clearance: role === 'hall' ? clearance + 2 : clearance, roofStyle: roof });
  let rooms, links;
  if (profile.topology === 'ring') {
    rooms = [space(.38,.77,.24,.14,0,'entrance'), space(.08,.63,.20,.20,.5,'gallery'),
      space(.08,.18,.22,.24,1.5), space(.38,.05,.24,.20,2,'hall'), space(.70,.18,.22,.24,1.5),
      space(.72,.63,.20,.20,.5,'gallery'), space(.38,.38,.24,.22,-.5,'hall','round')];
    links = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6]];
  } else if (profile.topology === 'spine') {
    rooms = [space(.40,.78,.20,.14,0,'entrance'), space(.40,.27,.20,.39,.5,'hall'),
      space(.06,.55,.24,.20,-.5), space(.70,.55,.24,.20,1), space(.06,.11,.24,.23,1.5,'gallery'),
      space(.70,.11,.24,.23,2,'gallery'), space(.40,.05,.20,.13,1.5)];
    links = [[0,1],[1,2],[1,3],[1,4],[1,5],[1,6],[2,4]];
  } else if (profile.topology === 'terraces') {
    rooms = [space(.37,.79,.26,.13,0,'entrance'), space(.10,.56,.80,.14,.5,'hall'),
      space(.10,.30,.26,.17,1,'gallery'), space(.64,.30,.26,.17,1.5,'gallery'),
      space(.10,.08,.80,.13,2,'hall'), space(.40,.30,.20,.17,-.5)];
    links = [[0,1],[1,2],[1,3],[2,4],[3,4],[1,5]];
  } else return null;
  const inset = (rng() - .5) * .025;
  for (const r of rooms) {
    r.x = (mirror ? 1 - r.x - r.w : r.x) + inset;
    if (!covered && r.role === 'hall') r.role = 'courtyard';
  }
  return { rooms, roomCount: rooms.length, heightLevels: [...new Set(rooms.map(r => r.floor))],
    corridors: links.map(([fromRoom, toRoom], i) => ({ fromRoom, toRoom, width: i === 0 ? 4 : 3,
      style: i % 2 ? 'H' : 'V', ramp: true })), designProfile: profile.id };
}

function directive(profile) {
  if (!profile) return '';
  return `LEVEL DESIGN ${profile.id}: ${profile.style}. Spatial composition: ${profile.topology}. ` +
    'Use a recognizable entrance, a visible destination, branching side spaces and a reconnecting alternate route. ' +
    'Vary chamber proportions, two or more connected floor elevations, near/mid/far silhouettes and ceiling heights; use supported ramps/stairs, not isolated floating slabs. ' +
    'Keep one walkable surface per XY cell. Balconies overlook adjacent lower spaces, never a second floor stacked at the same XY. ' +
    'Covered interiors, upper storeys and underwater spaces retain sealed ceilings. Outdoors use landforms and bounded buildings, not an indoor maze. ' +
    'Adapt to saved room facts and available approved assets; this is architectural direction, not a compulsory room story or new quest.';
}

module.exports = { VERSION, PROFILES, select, forRoom, plan, directive };
