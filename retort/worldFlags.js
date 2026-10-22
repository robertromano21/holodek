'use strict';
require('./providerEnv');
// Preserve existing switches; the city/genre completion is opt-in, including on test servers.
const DEFAULTS = {
  SURPRISE:true, LEVEL_CAST:true, MURAL_STORIES:true, STATUE_VARIETY:true, MARKET_ECONOMY:true,
  CAMPAIGN_MAP:true, EXIT_FRAMES:true, TEMPLE_COMPLEX:true, INDOOR_EXTERIORS:true, FOOT_EXITS:true,
  QUEST_LOCAL:true, QUEST_REVEALS:true, ARRIVAL_EDGES:true, QUEST_REWARDS:true, CITY_PLACEMENT:true,
  CITY_PROPS:true, MOSAIC_HOVER:true, ORNAMENT_FIELDS:true, MOLDINGS:true, PYRAMIDS:true,
  ARCH_THEMES:true, ROOM_PIXEL:true, ART_CATALOG:true, LIBRARY_BOOKS:true, CAMPAIGN_BUILDER:true,
  HOMEBREW:true, GENRE_KITS:true, GENRE_LIGHTS:true, RANGED_COMBAT:true, GENRE_ARCH:true,
  CITY_SITES:false, GENRE_EXPANSION:false, ARCHITECTURE_EXPANSION:false, CITY_COMPLETE:false, TRADE_ROUTES:false
};
function on(name) {
  const raw = process.env['HOLODEK_' + name];
  if (raw === '0' || /^(false|off|no)$/i.test(raw || '')) return false;
  if (raw === '1' || /^(true|on|yes)$/i.test(raw || '')) return true;
  return !!DEFAULTS[name];
}
// A level is one room's database coordinate, shared by cast, arcs, encounters and art.
function levelKey(coords) {
  const c = typeof coords === 'string' ? coords.split(',').map(Number) : [coords?.x, coords?.y, coords?.z];
  return c.length === 3 && c.every(Number.isFinite) ? c.join(',') : null;
}
function snapshot() { return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, on(k)])); }
module.exports = { on, snapshot, levelKey, DEFAULTS, VERSION:'world1' };
