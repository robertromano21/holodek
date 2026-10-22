'use strict';
// world1 GENRE_KITS / GENRE_LIGHTS server side: stamps each built room with its resolved genre and light set.
// Setting-aware: Children of the Grave (no active homebrew bible) stays fantasy-family, including portal rooms;
// homebrew and Campaign Builder worlds may use any genre, including through portals (realm.genre).
// Additive only: existing tiles, torches, portal palette/arch/crystal features are kept; genre data rides alongside.
const Flags = require('./worldFlags');
const Kits = require('../assets/genreKits');
const Lights = require('../assets/genreLights');
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function activeSetting() { try { return require('./settingLayer').current() || null; } catch { return null; } }
function decorate(dungeon, room = {}, { setting = activeSetting(), geoKey = '' } = {}) {
  if (!dungeon || !(Flags.on('GENRE_KITS') || Flags.on('GENRE_LIGHTS'))) return null;
  const r = Kits.resolve(room, setting);
  dungeon.genreKit = { genre: r.genre, locked: r.locked, homebrew: r.homebrew, palette: r.palette, voxel: r.voxel, textures: r.textures, base: r.base, props: r.props, building: r.building };
  // Lights: only where the base world would add them anyway (homebrew rooms, portal rooms); plain CotG rooms keep their torches as-is.
  if (Flags.on('GENRE_LIGHTS') && (r.homebrew || room.planarRealm) && !dungeon.genreLights?.length) {
    const types = r.lights.filter(t => Lights.TYPES[t] && (!r.locked || Lights.TYPES[t].cotg)), cells = Object.entries(dungeon.cells || {}).filter(([, c]) => c?.tile === 'floor');
    const n = Math.min(4, Math.max(2, Math.floor(cells.length / 60))), h = hash(geoKey || room.name || '');
    dungeon.genreLights = Array.from({ length: cells.length ? n : 0 }, (_, i) => { const [k] = cells[(h + i * 7919) % cells.length], [x, y] = k.split(',').map(Number); return { x: x + .5, y: y + .5, z: 1.4, type: types[(h + i) % types.length] }; });
  }
  return r;
}
// world1 GENRE_ARCH: the room's genre building style (walls/floor/ceiling/door/window/trim, room shape, street rule, props).
// Returns null for Children of the Grave / fantasy-family worlds / flag off, so the Ruined Temple stone kit stays untouched.
function archFor(room = {}, { setting = activeSetting() } = {}) {
  if (!Flags.on('GENRE_ARCH') || !Flags.on('GENRE_KITS')) return null;
  const r = Kits.resolve(room, setting);
  if (Flags.on('ARCHITECTURE_EXPANSION') && room.city?.tiles) {
    const style=require('../assets/genreArchitecture').STYLES[r.genre];
    return {...room.city.tiles,genre:r.genre,zone:room.city.district,ceiling:style?.ceiling || 'stone',taint:0};
  }
  if (!r.homebrew || r.locked) {
    if(!Flags.on('ARCHITECTURE_EXPANSION') || !/ossuary|mausoleum|sepulchr|colonnade|stoa|ziggurat|basilica/i.test(room.name||''))return null;
    const genre=/colonnade|stoa|basilica/i.test(room.name)?'mythic':'dark-fantasy';
    return {...require('../assets/genreExpansion').STYLES[genre],genre,zone:'interior',taint:0};
  }
  const z = Number(String(room.roomKey || '').split(',')[2]) || 0;
  return require('../assets/genreArchitecture').style(r.mix, { name: room.name || '', seed: room.seed || room.roomKey || '', z }) ||
    (Flags.on('ARCHITECTURE_EXPANSION') ? {...require('../assets/genreExpansion').STYLES[r.genre],genre:r.genre,zone:'interior',taint:0} : null);
}
module.exports = { decorate, activeSetting, archFor };
