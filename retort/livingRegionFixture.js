'use strict';
// The physical fixture of a living-region community: a voxel structure in the community room's saved geometry.
// "damaged" shows the fixture low and broken with rubble beside it; "restored" shows it whole with the rubble gone.
// Structures live in dungeon.sceneStructures (saved with the room geometry), so a change survives save/load.
// Placement never takes a protected cell (exits, doors, navigation reservations, hazards and their margins, secret
// chambers and their entries, puzzle alcoves, other structures' full footprints, objects, writings) and never cuts a
// walking route. When no safe site exists the fixture is NOT placed and callers must not claim a visible change.
// Genre-neutral shapes (current authoring) and the older named forms (saves made before v5 keep theirs).
// In an original world the active genre's own kit piece is used (genreAssetPolicy catalog), so a station never gets a
// classical column; with no genre catalog the neutral default shape is used.
const FORMS = { upright: 'obelisk', frame: 'timber_gate', slab: 'stone_tablet', column: 'doric_column',
  monument: 'obelisk', gate: 'timber_gate', marker: 'stone_tablet', tomb: 'sarcophagus', pillar: 'doric_column' };
const KIT_ROLE = { upright: 'support', column: 'support', frame: 'doorframe', slab: 'beam' };
function shapeFor(form) {
  const role = KIT_ROLE[form];
  if (role) try {
    const shapes = require('./genreAssetPolicy').catalog()?.shapes || [], one = r => { const s = shapes.filter(x => new RegExp(`^g_[a-z-]+_${r}$`).test(x)); return s.length === 1 ? s[0] : null; };
    const kit = one(role) || one('support'); if (kit) return kit;
  } catch {}
  return FORMS[form];
}
const STATES = ['damaged', 'restored'];
const PREFIX = 'living-fixture:';
const MAX_TRIES = 24;
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const K = (x, y) => `${x},${y}`;
const own = (s, id) => String(s?.id || '').startsWith(PREFIX + id);
// Every cell another system owns or depends on.
function protectedCells(dungeon, fixtureId) {
  const out = new Set(), ring = (x, y, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.add(K(x + dx, y + dy)); };
  const at = v => typeof v === 'string' ? v.split(',').map(Number) : v && Number.isFinite(v.x) ? [v.x, v.y] : null;
  for (const [k, c] of Object.entries(dungeon.cells || {})) {
    if (c?.livingFixture && c.livingFixture !== fixtureId) out.add(k);
    if (c && (c.exit || c.complexExit || c.door || c.navigationReserved && c.livingFixture !== fixtureId || c.interactable || c.feature || c.puzzleFixture ||
        c.secretChamber || c.secretDoorId || c.blocked || c.obstacle || c.architectureRole || c.exteriorRole)) out.add(k);
    if (c && (c.exit || c.door || c.complexExit)) { const [x, y] = k.split(',').map(Number); ring(x, y); }
  }
  for (const h of dungeon.roomHazards?.hazards || []) for (const k of [...(h.keys || []), ...(h.gap || []), ...(h.zone || []), ...(h.ends || [])]) { const p = at(k); if (p) ring(p[0], p[1]); }
  for (const d of dungeon.secretDoors?.doors || []) {
    for (const k of [d.key, ...(d.chamber || [])]) { const p = at(k); if (p) out.add(K(p[0], p[1])); }
    const e = at(d.entry); if (e) ring(e[0], e[1]);
  }
  const a = dungeon.puzzleAlcove; if (a) for (let y = a.y - 1; y <= a.y + a.height; y++) for (let x = a.x - 1; x <= a.x + a.width; x++) out.add(K(x, y));
  for (const s of dungeon.sceneStructures || []) {
    if (own(s, fixtureId) || !s?.position) continue;
    const sx = s.size?.x || 1, sy = s.size?.y || 1;
    for (let y = Math.floor(s.position.y); y < Math.ceil(s.position.y + sy); y++) for (let x = Math.floor(s.position.x); x < Math.ceil(s.position.x + sx); x++) out.add(K(x, y));
  }
  for (const o of dungeon.sceneObjects || []) if (Number.isFinite(o?.x)) out.add(K(Math.floor(o.x), Math.floor(o.y)));
  for (const w of dungeon.questWritings || []) if (w?.key) out.add(w.key);
  if (dungeon.start) ring(Math.floor(dungeon.start.x), Math.floor(dungeon.start.y));
  return out;
}
function reachSet(dungeon, cells = dungeon.cells) {
  const I = require('../assets/dungeonInhabitants');
  return new Set((I.reachable({ ...dungeon, cells }) || []).map(p => K(p.x, p.y)));
}
// Removing the two cells must leave every other reachable cell reachable.
function keepsRoutes(dungeon, base, keys) {
  const cells = { ...dungeon.cells }; for (const k of keys) cells[k] = { ...cells[k], tile: 'wall' };
  const after = reachSet(dungeon, cells);
  for (const k of base) if (!keys.includes(k) && !after.has(k)) return false;
  return true;
}
function siteFor(dungeon, fixtureId) {
  const prior = (dungeon.sceneStructures || []).find(s => s.id === PREFIX + fixtureId);
  if (prior?.site) return { site: prior.site };
  if (!dungeon?.cells || !dungeon.start) return { reason: 'room geometry has no start' };
  const blocked = protectedCells(dungeon, fixtureId), base = reachSet(dungeon);
  const z = k => dungeon.cells[k]?.floorHeight || 0;
  const ok = (x, y) => { const k = K(x, y), c = dungeon.cells[k]; return c?.tile === 'floor' && base.has(k) && !blocked.has(k); };
  // Both cells and their whole 8-neighbourhood must be open, level floor.
  const open = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = K(x + dx, y + dy); if (!ok(x + dx, y + dy) || Math.abs(z(k) - z(K(x, y))) > .25) return false; } return true; };
  const sites = [];
  for (const k of base) {
    const [x, y] = k.split(',').map(Number);
    if (!open(x, y)) continue;
    const r = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find(p => open(p.x, p.y));
    if (r) sites.push({ x, y, rubble: r });
  }
  if (!sites.length) return { reason: 'no open, unprotected floor area large enough for the fixture' };
  sites.sort((a, b) => hash(fixtureId + ':' + K(a.x, a.y)) - hash(fixtureId + ':' + K(b.x, b.y)));
  for (const s of sites.slice(0, MAX_TRIES)) if (keepsRoutes(dungeon, base, [K(s.x, s.y), K(s.rubble.x, s.rubble.y)])) return { site: s };
  return { reason: 'every open site would cut a walking route' };
}
function clear(dungeon, fixture) {
  const base = 'living_fixture_' + hash(fixture.id).toString(16);
  for (const t of Object.keys(dungeon.tiles || {})) if (t.startsWith(base)) delete dungeon.tiles[t];
  dungeon.sceneStructures = (dungeon.sceneStructures || []).filter(s => !own(s, fixture.id));
  for (const c of Object.values(dungeon.cells || {})) if (c?.livingFixture === fixture.id) { delete c.livingFixture; delete c.navigationReserved; }
  if (dungeon.livingRegionFixtures) delete dungeon.livingRegionFixtures[fixture.id];
  return base;
}
// Idempotent: rewrites only this fixture's own structures, tiles and cell marks. Returns placed:false when no safe site.
function apply(dungeon, fixture) {
  if (!dungeon || !fixture?.id || !FORMS[fixture.form] || !STATES.includes(fixture.state)) return { changed: false, placed: false, reason: 'no fixture' };
  const found = siteFor(dungeon, fixture.id); if (!found.site) return { changed: false, placed: false, reason: found.reason };
  const site = found.site, snap = () => JSON.stringify([(dungeon.sceneStructures || []).filter(s => own(s, fixture.id)),
    Object.entries(dungeon.tiles || {}).filter(([t]) => t.startsWith('living_fixture_' + hash(fixture.id).toString(16))),
    Object.entries(dungeon.cells || {}).filter(([, c]) => c?.livingFixture === fixture.id).map(([k]) => k)]);
  const before = snap();
  dungeon.sceneStructures ||= []; dungeon.tiles ||= {};
  const base = clear(dungeon, fixture), floor = n => dungeon.cells[K(n.x, n.y)]?.floorHeight || 0, restored = fixture.state === 'restored';
  const tile = `${base}_${fixture.state}`;
  dungeon.tiles[tile] = { spriteSpec: { voxelShape: shapeFor(fixture.form), material: 'stone', baseWidth: .8, heightRatio: restored ? 1 : .45,
    livingRegionFixture: { id: fixture.id, name: fixture.name, state: fixture.state } } };
  dungeon.sceneStructures.push({ id: PREFIX + fixture.id, role: 'living-region-fixture', tile, site: { x: site.x, y: site.y, rubble: site.rubble },
    position: { x: site.x + .1, y: site.y + .1, z: floor(site) }, size: { x: .8, y: .8, z: restored ? 1.6 : .7 }, state: fixture.state, name: fixture.name });
  Object.assign(dungeon.cells[K(site.x, site.y)], { livingFixture: fixture.id, navigationReserved: true });
  if (!restored) {
    dungeon.tiles[base + '_rubble'] = { spriteSpec: { voxelShape: 'boulder', material: 'stone', baseWidth: .9, heightRatio: .35 } };
    dungeon.sceneStructures.push({ id: PREFIX + fixture.id + ':rubble', role: 'living-region-fixture-rubble', tile: base + '_rubble',
      position: { x: site.rubble.x + .05, y: site.rubble.y + .05, z: floor(site.rubble) }, size: { x: .9, y: .9, z: .5 } });
    Object.assign(dungeon.cells[K(site.rubble.x, site.rubble.y)], { livingFixture: fixture.id, navigationReserved: true });
  }
  dungeon.livingRegionFixtures = { ...(dungeon.livingRegionFixtures || {}), [fixture.id]: { state: fixture.state, key: K(site.x, site.y) } };
  return { changed: before !== snap(), placed: true, site: K(site.x, site.y) };
}
function stamp(dungeon, geoKey) {
  const s = require('../assets/dungeonGeometryStamp').compute(dungeon, geoKey);
  dungeon._geometryStamp = s; dungeon._meta = { ...(dungeon._meta || {}), geometryStamp: s };
  return s;
}
const coordsOf = geoKey => { const [x, y, z] = geoKey.split(',').map(Number); return { x, y, z }; };
// Writes the change into the saved room geometry. stored:true only when the fixture is physically in the saved room.
function commit(state, geoKey, fixture) {
  if (typeof state?.getRoomDungeon !== 'function' || typeof state.setRoomDungeon !== 'function') return { stored: false, placed: false, reason: 'no geometry store' };
  const coords = coordsOf(geoKey), dungeon = state.getRoomDungeon(coords);
  if (!dungeon) return { stored: false, placed: false, reason: 'the room is not built yet' };
  const result = apply(dungeon, fixture);
  if (!result.placed) return { stored: false, placed: false, reason: result.reason };
  if (result.changed) { stamp(dungeon, geoKey); state.setRoomDungeon(coords, dungeon, dungeon.customTiles || []); }
  const saved = read(state.getRoomDungeon(coords), fixture.id);
  return saved?.state === fixture.state ? { stored: true, placed: true, changed: result.changed, site: result.site } : { stored: false, placed: false, reason: 'the saved room did not keep the change' };
}
// Takes the fixture out of a room (used when a community site is rejected).
function remove(state, geoKey, fixture) {
  if (typeof state?.getRoomDungeon !== 'function') return false;
  const coords = coordsOf(geoKey), dungeon = state.getRoomDungeon(coords);
  if (!dungeon || !read(dungeon, fixture.id)) return false;
  clear(dungeon, fixture); stamp(dungeon, geoKey); state.setRoomDungeon(coords, dungeon, dungeon.customTiles || []);
  return true;
}
function read(dungeon, fixtureId) { const s = (dungeon?.sceneStructures || []).find(p => p.id === PREFIX + fixtureId); return s ? { state: s.state, site: s.site, tile: s.tile, rubble: (dungeon.sceneStructures || []).some(p => p.id === PREFIX + fixtureId + ':rubble') } : null; }
module.exports = { FORMS, STATES, shapeFor, apply, commit, remove, read, stamp, protectedCells };
