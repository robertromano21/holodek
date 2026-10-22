// world1 CITY_PROPS: a voxel kit for cities in the ScenePropVoxels style (unit-cube shapes built from boxes, coloured by
// color(); they are lit and shadowed by the normal scene-prop path). Per-city palettes and seeded variation make cities differ.
// Placement plans are per district; identical (shape, palette, variant) props share one tile, so their mesh is built once
// and reused (instancing); small street detail carries an LOD/cull distance and every room is capped.
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CityKit = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rnd = seed => { let s = hash(seed) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; };
  // ---- palettes ---------------------------------------------------------------------------------------
  const PALETTES = {
    marble:    { body: '#e6e0d2', trim: '#c8bfab', dark: '#9b9486', roof: '#a9573a', accent: '#b08a3e', cloth: ['#8e2f2f', '#2f5e8e', '#c99b2e'] },
    sandstone: { body: '#d6b688', trim: '#b78f5c', dark: '#866642', roof: '#9b4f2c', accent: '#a8763a', cloth: ['#b4562d', '#3f7a5a', '#d8c27a'] },
    basalt:    { body: '#4c4945', trim: '#6c6761', dark: '#2c2a28', roof: '#3a3533', accent: '#c25a22', cloth: ['#7a1f1f', '#4a3a6a', '#c06a1a'] },
    bronze:    { body: '#cfc4ad', trim: '#a8763a', dark: '#6e5232', roof: '#5f7f6a', accent: '#b9853f', cloth: ['#6a3a7a', '#2f6a6a', '#c9a23e'] }
  };
  const COMMON = { wood: '#7a5434', woodDark: '#563a24', water: '#3d7fa6', waterLight: '#6fb2cf', iron: '#4a4d52', flame: '#ffcf6a', grain: '#c9a95c' };
  function paletteFor(city) {
    if (!city) return 'marble';
    if (city.role === 'hades' || /ember|ash|lava|basalt/i.test(city.name || '')) return 'basalt';
    return ['marble', 'sandstone', 'bronze', 'marble', 'sandstone'][hash(city.id || city.name) % 5];
  }
  // ---- shape catalogue ------------------------------------------------------------------------------
  // footprint: cells (x,y) and height in cells; detail: street furniture culled at distance; blocking: solid buildings.
  const S = {};
  const def = (name, group, footprint, height, extra = {}) => { S[name] = { name, group, footprint, height, ...extra }; };
  // buildings
  def('city_townhouse', 'building', [2, 2], 3, { blocking: true }); def('city_insula', 'building', [3, 3], 4, { blocking: true });
  def('market_stall', 'building', [1, 1], 1.4); def('guild_hall', 'building', [3, 2], 3, { blocking: true, signage: true });
  def('city_temple', 'building', [3, 4], 3.5, { blocking: true }); def('public_baths', 'building', [4, 3], 2.5, { blocking: true });
  def('city_wall', 'defence', [1, 1], 2.5, { blocking: true }); def('city_gate', 'defence', [3, 1], 3.5); def('city_tower', 'defence', [2, 2], 4.5, { blocking: true });
  def('watchtower', 'defence', [1, 1], 4, { blocking: true }); def('lighthouse', 'harbour', [2, 2], 7, { blocking: true, light: true });
  def('forum_portico', 'civic', [4, 1], 2.5); def('basilica', 'civic', [4, 3], 3.5, { blocking: true }); def('amphitheatre', 'civic', [5, 5], 2.5, { blocking: true });
  def('granary', 'storage', [2, 2], 2.5, { blocking: true }); def('warehouse', 'storage', [3, 2], 2.5, { blocking: true });
  // utilities and water
  def('aqueduct_arch', 'utility', [1, 1], 3.5); def('water_channel', 'utility', [1, 1], .5); def('cistern', 'utility', [2, 2], 1.2, { blocking: true });
  def('fountain_basin', 'fountain', [2, 2], 1); def('fountain_tiered', 'fountain', [2, 2], 2); def('fountain_obelisk', 'fountain', [2, 2], 2.6);
  def('fountain_wall', 'fountain', [1, 1], 1.6); def('fountain_nymph', 'fountain', [2, 2], 2.2);
  def('well', 'utility', [1, 1], 1.4); def('trough', 'utility', [1, 1], .5); def('sewer_grate', 'street', [1, 1], .08, { detail: true });
  def('dock', 'harbour', [3, 2], .5); def('pier_section', 'harbour', [1, 2], .5); def('moored_boat', 'harbour', [1, 2], 1.2); def('harbour_crane', 'harbour', [1, 1], 3.5);
  def('bridge', 'utility', [3, 1], 1.2); def('canal_wall', 'utility', [1, 1], .8);
  // street detail
  def('paving_slab', 'street', [1, 1], .06, { detail: true, ground: true }); def('city_steps', 'street', [1, 1], .5);
  def('colonnade', 'street', [1, 1], 2.5); def('awning', 'street', [1, 1], 1.5, { detail: true }); def('crate', 'street', [1, 1], .45, { detail: true });
  def('barrel', 'street', [1, 1], .55, { detail: true }); def('lantern', 'street', [1, 1], .6, { detail: true, light: true }); def('lamp_post', 'street', [1, 1], 1.8, { light: true });
  def('banner_pole', 'street', [1, 1], 2.2, { detail: true }); def('street_shrine', 'street', [1, 1], 1.3); def('milestone', 'street', [1, 1], .8);
  def('plaza_statue', 'civic', [1, 1], 2.2); def('guild_sign', 'street', [1, 1], 1.4, { detail: true, signage: true });
  const SHAPES = Object.keys(S);
  const has = shape => Object.hasOwn(S, String(shape).replace(/__v\d+$/, ''));
  const baseOf = shape => String(shape).replace(/__v\d+$/, '');
  const variantOf = shape => Number((String(shape).match(/__v(\d+)$/) || [])[1] || 0);
  // ---- voxel construction ---------------------------------------------------------------------------
  function build(shape, size = 16, seed = 0, appearance = {}) {
    const name = baseOf(shape);
    if (!S[name]) return null;
    const v = variantOf(shape) + (appearance.variant || 0), r = rnd(`${name}:${v}:${seed}`);
    const g = new Uint8Array(size ** 3);
    const set = (x, y, z, on) => { if (x >= 0 && y >= 0 && z >= 0 && x < size && y < size && z < size) g[x + y * size + z * size * size] = on; };
    const box = (x0, y0, z0, x1, y1, z1, on = 1) => { for (let z = Math.floor(z0 * size); z < Math.ceil(z1 * size); z++) for (let y = Math.floor(y0 * size); y < Math.ceil(y1 * size); y++) for (let x = Math.floor(x0 * size); x < Math.ceil(x1 * size); x++) set(x, y, z, on); };
    const cut = (...a) => box(...a, 0);
    const cyl = (cx, cy, rad, z0, z1, on = 1) => { for (let z = Math.floor(z0 * size); z < Math.ceil(z1 * size); z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.hypot((x + .5) / size - cx, (y + .5) / size - cy) <= rad) set(x, y, z, on); };
    const ring = (cx, cy, r0, r1, z0, z1) => { cyl(cx, cy, r1, z0, z1); cyl(cx, cy, r0, z0 + .02, z1 + .1, 0); };
    const archX = (x0, x1, y0, y1, spring, top) => { // carve a round arch opening along x
      const cx = (x0 + x1) / 2, rad = (x1 - x0) / 2; cut(x0, y0, 0, x1, y1, spring);
      for (let z = Math.floor(spring * size); z < Math.ceil(Math.min(top, spring + rad) * size); z++) for (let x = Math.floor(x0 * size); x < Math.ceil(x1 * size); x++)
        if (Math.hypot((x + .5) / size - cx, (z + .5) / size - spring) <= rad) for (let y = Math.floor(y0 * size); y < Math.ceil(y1 * size); y++) set(x, y, z, 0); };
    const roof = (x0, y0, x1, y1, z0, z1, alongX = true) => { const n = Math.max(1, Math.ceil((z1 - z0) * size));
      for (let i = 0; i < n; i++) { const t = i / n, inset = t * (alongX ? (y1 - y0) : (x1 - x0)) / 2;
        alongX ? box(x0, y0 + inset, z0 + (z1 - z0) * t, x1, y1 - inset, z0 + (z1 - z0) * (t + 1 / n)) : box(x0 + inset, y0, z0 + (z1 - z0) * t, x1 - inset, y1, z0 + (z1 - z0) * (t + 1 / n)); } };
    const columns = (count, y0, y1, z1, x0 = .06, x1 = .94, rad = .035) => { for (let i = 0; i < count; i++) { const x = x0 + (x1 - x0) * (count === 1 ? .5 : i / (count - 1)); cyl(x, (y0 + y1) / 2, rad, .04, z1); } };
    const windows = (rows, perRow, z0, z1) => { for (let k = 0; k < rows; k++) for (let i = 0; i < perRow; i++) { const x = .14 + i * (.72 / Math.max(1, perRow - 1)), z = z0 + (z1 - z0) * (k + .35) / rows; cut(x - .03, 0, z, x + .03, .05, z + .07); cut(x - .03, .95, z, x + .03, 1, z + .07); } };
    switch (name) {
      case 'city_townhouse': { const storeys = 2 + (v % 2); box(.04, .04, 0, .96, .96, .62 + .1 * storeys); windows(storeys, 3 + (v % 2), .1, .62 + .1 * storeys); cut(.42, 0, 0, .58, .06, .26); if (v % 3 !== 2) box(.0, .3, .3, .04, .7, .34); roof(.0, .0, 1, 1, .62 + .1 * storeys, .98, v % 2 === 0); break; }
      case 'city_insula': box(.03, .03, 0, .97, .97, .82); for (let x = .1; x < .9; x += .2) cut(x, 0, 0, x + .1, .05, .2); windows(4, 5, .22, .8); box(0, .0, .2, 1, .05, .23); roof(0, 0, 1, 1, .82, .98, v % 2 === 1); break;
      case 'market_stall': box(.1, .55, 0, .9, .9, .38); for (const [x, y] of [[.1, .1], [.86, .1], [.1, .86], [.86, .86]]) box(x, y, 0, x + .04, y + .04, .85); roof(.04, .04, .96, .96, .78, .98, v % 2 === 0); box(.15, .6, .38, .85, .85, .44); break;
      case 'guild_hall': box(.04, .2, 0, .96, .96, .7); columns(4 + (v % 3), .04, .14, .7); box(.02, .02, .7, .98, .98, .76); roof(.02, .02, .98, .98, .76, .98, true); box(.38, .0, .4, .62, .03, .62); cut(.42, .18, 0, .58, .24, .4); break;
      case 'city_temple': box(.02, .02, 0, .98, .98, .1); box(.02, .02, .1, .98, .14, .14); box(.18, .26, .1, .82, .92, .72); columns(6, .04, .2, .74, .06, .94, .04); for (let i = 0; i < 4; i++) cyl(.06 + .88 * (i % 2), .3 + (i >> 1) * .55, .04, .1, .74); box(.0, .0, .74, 1, 1, .8); roof(0, 0, 1, 1, .8, .98, false); break;
      case 'public_baths': box(.02, .02, 0, .98, .98, .55); for (let x = .1; x < .9; x += .2) archX(x, x + .12, 0, .06, .26, .36); cyl(.5, .55, .28, .55, .78); cyl(.5, .55, .2, .78, .9); box(.7, .7, .55, .82, .82, .82); break;
      case 'city_wall': box(0, .3, 0, 1, .7, .78); for (let x = 0; x < 1; x += .25) box(x, .28, .78, x + .14, .72, .95); break;
      case 'city_gate': box(0, .2, 0, .32, .8, .9); box(.68, .2, 0, 1, .8, .9); box(.32, .25, .55, .68, .75, .8); archX(.32, .68, .25, .75, .38, .55); for (const x of [0, .68]) for (let i = 0; i < 3; i++) box(x + i * .11, .18, .9, x + i * .11 + .07, .82, .98); break;
      case 'city_tower': if (v % 2) { cyl(.5, .5, .42, 0, .86); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; box(.5 + Math.cos(a) * .38 - .05, .5 + Math.sin(a) * .38 - .05, .86, .5 + Math.cos(a) * .38 + .05, .5 + Math.sin(a) * .38 + .05, .97); } } else { box(.08, .08, 0, .92, .92, .86); for (let x = .08; x < .9; x += .21) { box(x, .04, .86, x + .12, .14, .97); box(x, .86, .86, x + .12, .96, .97); } } cut(.45, 0, .5, .55, .1, .6); break;
      case 'watchtower': box(.3, .3, 0, .7, .7, .75); for (const [x, y] of [[.22, .22], [.72, .22], [.22, .72], [.72, .72]]) box(x, y, .0, x + .06, y + .06, .78); box(.15, .15, .75, .85, .85, .8); roof(.12, .12, .88, .88, .86, .99, v % 2 === 0); for (const [x, y] of [[.15, .15], [.8, .15], [.15, .8], [.8, .8]]) box(x, y, .8, x + .05, y + .05, .88); break;
      case 'lighthouse': { const tiers = 3; for (let t = 0; t < tiers; t++) { const w = .42 - t * .1; box(.5 - w, .5 - w, t * .28, .5 + w, .5 + w, (t + 1) * .28); } box(.36, .36, .84, .64, .64, .9); cyl(.5, .5, .1, .9, .97); for (let x = .38; x < .62; x += .08) box(x, .38, .9, x + .03, .41, .97); break; }
      case 'forum_portico': box(0, .5, 0, 1, 1, .06); columns(7 + (v % 3), .08, .22, .82); box(0, .04, .82, 1, .96, .9); box(0, .6, .06, 1, .96, .82); roof(0, .04, 1, .96, .9, .99, true); break;
      case 'basilica': box(.02, .02, 0, .98, .98, .7); for (let x = .08; x < .9; x += .14) archX(x, x + .08, 0, .05, .4, .5); box(.2, .2, .7, .8, .8, .86); roof(.02, .02, .98, .98, .7, .8, true); roof(.2, .2, .8, .8, .86, .98, true); cyl(.5, .97, .2, 0, .55); break;
      case 'amphitheatre': for (let k = 0; k < 4; k++) ring(.5, .5, .2 + k * .06, .48, k * .2, (k + 1) * .2 + .02); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, x = .5 + Math.cos(a) * .46, y = .5 + Math.sin(a) * .46; cut(x - .03, y - .03, 0, x + .03, y + .03, .25); } cyl(.5, .5, .18, 0, .02); break;
      case 'granary': if (v % 2) { box(.05, .05, .0, .95, .95, .12); for (const [x, y] of [[.3, .3], [.7, .3], [.3, .7], [.7, .7]]) { cyl(x, y, .18, .12, .72); cyl(x, y, .12, .72, .86); } } else { box(.05, .05, 0, .95, .95, .1); box(.08, .08, .1, .92, .92, .7); for (let x = .1; x < .9; x += .1) cut(x, 0, .2, x + .04, .09, .6); roof(.04, .04, .96, .96, .7, .96, true); } break;
      case 'warehouse': box(.02, .02, 0, .98, .98, .66); for (let x = .12; x < .9; x += .26) cut(x, 0, 0, x + .14, .05, .4); box(.0, .0, .4, 1, .12, .44); roof(0, 0, 1, 1, .66, .95, v % 2 === 0); break;
      case 'aqueduct_arch': box(0, .35, .78, 1, .65, .9); box(0, .35, .9, 1, .4, 1); box(0, .6, .9, 1, .65, 1); box(.0, .35, 0, .2, .65, .78); box(.8, .35, 0, 1, .65, .78); archX(.2, .8, .35, .65, .42, .78); if (v % 2) archX(.0, .2, .35, .65, .62, .72); break;
      case 'water_channel': box(0, .2, 0, 1, .8, .9); cut(0, .3, .35, 1, .7, 1); box(0, .3, .35, 1, .7, .55); break;
      case 'cistern': box(.04, .04, 0, .96, .96, .7); cut(.12, .12, .4, .88, .88, 1); box(.12, .12, .4, .88, .88, .58); for (const [x, y] of [[.02, .02], [.88, .02], [.02, .88], [.88, .88]]) box(x, y, .7, x + .1, y + .1, .9); break;
      case 'fountain_basin': ring(.5, .5, .38, .46, 0, .35); cyl(.5, .5, .38, 0, .22); cyl(.5, .5, .06, .22, .7); cyl(.5, .5, .12, .62, .68); break;
      case 'fountain_tiered': ring(.5, .5, .36, .46, 0, .26); cyl(.5, .5, .36, 0, .16); cyl(.5, .5, .06, .16, .9); ring(.5, .5, .2, .26, .44, .52); cyl(.5, .5, .2, .44, .48); ring(.5, .5, .1, .14, .7, .76); cyl(.5, .5, .04, .76, .96); break;
      case 'fountain_obelisk': ring(.5, .5, .36, .44, 0, .24); cyl(.5, .5, .36, 0, .14); for (let i = 0; i < 10; i++) { const w = .12 - i * .008; box(.5 - w, .5 - w, .14 + i * .08, .5 + w, .5 + w, .22 + i * .08); } box(.47, .47, .94, .53, .53, 1); break;
      case 'fountain_wall': box(0, .78, 0, 1, 1, .95); box(.2, .45, 0, .8, .78, .3); cut(.26, .5, .12, .74, .78, .3); box(.26, .5, .12, .74, .78, .2); cyl(.5, .82, .1, .5, .7); box(.46, .7, .54, .54, .8, .58); break;
      case 'fountain_nymph': ring(.5, .5, .36, .46, 0, .3); cyl(.5, .5, .36, 0, .18); box(.42, .42, .18, .58, .58, .36); cyl(.5, .5, .07, .36, .74); cyl(.5, .5, .055, .74, .84); box(.38, .46, .66, .62, .54, .7); break;
      case 'well': ring(.5, .5, .24, .36, 0, .38); cyl(.5, .5, .24, 0, .1); box(.12, .46, 0, .18, .54, .9); box(.82, .46, 0, .88, .54, .9); box(.12, .47, .82, .88, .53, .86); roof(.08, .3, .92, .7, .88, 1, true); break;
      case 'trough': box(.05, .2, 0, .95, .8, .9); cut(.12, .28, .25, .88, .72, 1); box(.12, .28, .25, .88, .72, .7); break;
      case 'sewer_grate': box(.15, .15, 0, .85, .85, 1); for (let x = .2; x < .8; x += .1) cut(x, .2, .0, x + .05, .8, 1); break;
      case 'dock': box(0, 0, .5, 1, 1, 1); for (let x = .05; x < 1; x += .3) for (const y of [.05, .85]) box(x, y, 0, x + .1, y + .1, .5); for (let x = 0; x < 1; x += .12) cut(x, 0, .97, x + .015, 1, 1); break;
      case 'pier_section': box(.2, 0, .5, .8, 1, .9); for (const y of [.1, .6]) for (const x of [.2, .7]) box(x, y, 0, x + .1, y + .1, .5); box(.2, 0, .9, .26, 1, 1); box(.74, 0, .9, .8, 1, 1); break;
      case 'moored_boat': for (let y = 0; y < 20; y++) { const t = y / 19, w = .3 * Math.sin(Math.PI * Math.min(1, .15 + t * .85)); box(.5 - w, t * .95, .05, .5 + w, t * .95 + .06, .32); } cut(.3, .15, .14, .7, .85, .4); if (v % 2) { box(.48, .45, .1, .52, .5, .98); box(.5, .3, .45, .52, .62, .9); } else for (const y of [.35, .6]) box(.2, y, .26, .8, y + .03, .3); break;
      case 'harbour_crane': box(.3, .3, 0, .7, .7, .1); box(.42, .42, .1, .58, .58, .9); box(.42, .1, .82, .58, .98, .9); box(.47, .08, .4, .53, .12, .82); box(.42, .9, .7, .58, .98, .82); cyl(.5, .5, .14, .2, .32); break;
      case 'bridge': box(0, .2, .55, 1, .8, .7); box(0, .2, .7, 1, .26, .82); box(0, .74, .7, 1, .8, .82); box(0, .25, 0, .12, .75, .55); box(.88, .25, 0, 1, .75, .55); archX(.12, .88, .25, .75, .15, .55); break;
      case 'canal_wall': box(0, .6, 0, 1, 1, 1); box(0, .55, .9, 1, .6, 1); for (let x = .1; x < 1; x += .33) cut(x, .6, .3, x + .04, .65, .36); break;
      case 'paving_slab': box(0, 0, 0, 1, 1, 1); for (let i = 1; i < 4; i++) { cut(i / 4 - .01, 0, .5, i / 4 + .01, 1, 1); cut(0, i / 4 - .01, .5, 1, i / 4 + .01, 1); } break;
      case 'city_steps': for (let i = 0; i < 4; i++) box(0, i * .25, 0, 1, 1, (i + 1) * .25); break;
      case 'colonnade': box(.1, .1, 0, .9, .9, .08); cyl(.5, .5, .2, .08, .86); box(.06, .06, .86, .94, .94, .94); box(0, 0, .94, 1, 1, 1); break;
      case 'awning': for (const [x, y] of [[.08, .08], [.86, .08]]) box(x, y, 0, x + .05, y + .05, .8); for (let i = 0; i < 6; i++) box(0, .08 + i * .14, .95 - i * .06, 1, .22 + i * .14, 1 - i * .06); break;
      case 'crate': box(.08, .08, 0, .92, .92, .9); cut(.14, .0, .14, .86, .09, .76); box(.14, .07, .14, .86, .09, .76); box(.45, .05, .1, .55, .09, .8); break;
      case 'barrel': cyl(.5, .5, .36, 0, .95); for (const z of [.15, .8]) ring(.5, .5, .36, .4, z, z + .07); break;
      case 'lantern': box(.4, .4, 0, .6, .6, .08); box(.47, .47, .08, .53, .53, .4); box(.36, .36, .4, .64, .64, .82); cut(.4, .36, .46, .6, .64, .76); cut(.36, .4, .46, .64, .6, .76); box(.44, .44, .5, .56, .56, .7); box(.42, .42, .82, .58, .58, .92); break;
      case 'lamp_post': box(.4, .4, 0, .6, .6, .06); box(.46, .46, .06, .54, .54, .82); box(.46, .46, .78, .86, .54, .82); box(.74, .44, .62, .9, .56, .78); box(.78, .46, .66, .86, .54, .74); break;
      case 'banner_pole': box(.45, .45, 0, .55, .55, 1); box(.55, .47, .55, .95, .53, .95); break;
      case 'street_shrine': box(.2, .4, 0, .8, .9, .5); box(.15, .35, .5, .85, .95, .56); box(.25, .5, .56, .75, .85, .88); cut(.3, .5, .6, .7, .62, .84); box(.38, .62, .6, .62, .74, .78); roof(.18, .4, .82, .95, .88, 1, true); box(.42, .3, .5, .58, .38, .56); break;
      case 'milestone': cyl(.5, .5, .2, 0, .82); cyl(.5, .5, .25, 0, .12); box(.4, .26, .4, .6, .3, .6); break;
      case 'plaza_statue': box(.25, .25, 0, .75, .75, .3); box(.3, .3, .3, .7, .7, .36); box(.42, .44, .36, .58, .56, .76); box(.4, .42, .58, .6, .58, .74); box(.36, .46, .62, .42, .52, .72); box(.58, .46, .62, .66, .52, .82); cyl(.5, .5, .06, .76, .88); if (v % 2) box(.6, .47, .82, .63, .5, 1); break;
      case 'guild_sign': box(.08, .45, 0, .16, .55, 1); box(.16, .46, .86, .7, .54, .9); box(.24, .48, .45, .86, .52, .82); break;
    }
    // Seeded secondary variation shared by all pieces: chimneys, balconies, plinths and wear.
    const grp = S[name].group;
    if (['building', 'civic', 'storage', 'defence'].includes(grp)) {
      if (v === 2) box(.72, .72, .88, .82, .82, 1);                         // chimney or roof finial
      if (v === 3) { box(.3, 0, 0, .7, .06, .05); cut(.9, .9, .9, 1, 1, 1); } // front step and weathered corner
      if (v === 1 && !/insula|townhouse/.test(name)) box(.2, 0, .45, .3, .04, .55); // wall plaque
    } else if (grp !== 'harbour' || name !== 'moored_boat') {
      if (v === 2) box(.02, .02, 0, .14, .14, .06);                          // kerb stone
      if (v === 3) box(.86, .86, 0, .98, .98, .06);
    }
    return g;
  }
  // Only geometrically distinct variants are registered (the scene-prop library forbids duplicate geometry).
  const variantMemo = {};
  function variants(name) {
    if (variantMemo[name]) return variantMemo[name];
    const seen = new Set(), out = [];
    for (let v = 0; v < 4; v++) { const g = build(`${name}__v${v}`, 16, 0), key = g.join(''); if (!seen.has(key)) { seen.add(key); out.push(v); } }
    return (variantMemo[name] = out);
  }
  // ---- colour (fed into the normal lit/shadowed scene-prop path) -----------------------------------------
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const GUILD_COLOURS = { masons: '#9b9486', scribes: '#2f4f8e', ferrymen: '#2f6a6a', smiths: '#5a5a62', weavers: '#8e2f6a', lamplighters: '#d9a23a',
    'grave keepers': '#3a3a3a', brewers: '#8a5a2a', glassblowers: '#3a9ab0', 'water wardens': '#2f7aa6' };
  function color(shape, x, y, z, normal, base, material, options = {}) {
    const ck = options.cityKit || {}; options = { ...options, palette: ck.palette || (typeof options.palette === 'string' ? options.palette : null), guild: ck.guild || options.guild, city: ck.city || options.city };
    const name = baseOf(shape), P = PALETTES[options.palette] || PALETTES[paletteFor(options.city)] || PALETTES.marble;
    const v = variantOf(shape), h = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719)), up = normal?.[2] > .5;
    let hex;
    const cloth = P.cloth[(v + hash(options.city?.id || '')) % P.cloth.length];
    const water = z < .6 && up;
    switch (S[name]?.group) {
      case 'building': case 'civic': case 'storage': case 'defence':
        hex = z > .8 && /townhouse|insula|guild|temple|warehouse|granary|watchtower|forum|basilica/.test(name) ? P.roof : z < .12 ? P.dark : h > .86 ? P.trim : P.body;
        if (name === 'market_stall') hex = z > .7 ? cloth : COMMON.wood;
        if (name === 'watchtower' && z < .8) hex = h > .5 ? COMMON.wood : COMMON.woodDark;
        if (name === 'guild_hall' && y < .04 && z > .4 && z < .62) hex = GUILD_COLOURS[options.guild] || P.accent;
        if (name === 'plaza_statue' && z > .36) hex = options.palette === 'bronze' || v % 2 ? '#8a6a3a' : P.body;
        break;
      case 'fountain': hex = water && z > .1 && z < .4 ? (h > .7 ? COMMON.waterLight : COMMON.water) : z < .1 ? P.dark : P.body; break;
      case 'harbour':
        hex = name === 'lighthouse' ? (z > .88 ? COMMON.flame : h > .9 ? P.trim : P.body) : name === 'moored_boat' ? (z > .4 ? cloth : h > .5 ? COMMON.wood : COMMON.woodDark) : name === 'harbour_crane' ? (z > .1 ? COMMON.wood : P.dark) : (h > .7 ? COMMON.woodDark : COMMON.wood); break;
      case 'utility':
        hex = /channel|cistern|trough/.test(name) && up && z > .3 && z < .75 ? COMMON.water : name === 'well' && z > .85 ? P.roof : name === 'well' && z > .4 ? COMMON.wood : name === 'bridge' && z > .7 ? P.trim : h > .88 ? P.trim : P.body; break;
      default:
        hex = { paving_slab: h > .5 ? P.trim : P.body, city_steps: P.trim, colonnade: z > .86 ? P.trim : P.body, awning: z > .5 ? cloth : COMMON.wood, crate: COMMON.wood,
          barrel: (z > .14 && z < .23) || (z > .79 && z < .88) ? COMMON.iron : COMMON.woodDark, lantern: z > .45 && z < .72 ? COMMON.flame : COMMON.iron,
          lamp_post: x > .76 && z > .64 && z < .76 ? COMMON.flame : COMMON.iron, banner_pole: x > .55 ? cloth : COMMON.wood, street_shrine: z > .88 ? P.roof : y > .6 && z > .6 && z < .78 ? P.accent : P.body,
          milestone: P.trim, sewer_grate: COMMON.iron, guild_sign: x > .22 && z < .84 ? GUILD_COLOURS[options.guild] || P.accent : COMMON.woodDark }[name];
    }
    if (!hex) return base;
    return rgb(hex).map(c => Math.max(0, Math.min(1, c * (0.86 + h * 0.14))));
  }
  // ---- district placement ---------------------------------------------------------------------------
  // Which kit pieces each district gets (weights), and per-road furniture.
  const DISTRICTS = {
    forum: { anchor: ['basilica', 'forum_portico'], landmark: ['plaza_statue', 'fountain_tiered', 'fountain_obelisk', 'fountain_nymph'], fill: ['colonnade', 'milestone', 'street_shrine', 'banner_pole'], large: ['amphitheatre'] },
    'market ward': { anchor: ['market_stall', 'market_stall'], landmark: ['fountain_basin', 'well'], fill: ['awning', 'crate', 'barrel', 'trough', 'lantern'] },
    'guild quarter': { anchor: ['guild_hall'], landmark: ['fountain_wall', 'plaza_statue'], fill: ['guild_sign', 'crate', 'banner_pole', 'warehouse'] },
    'harbor ward': { anchor: ['dock', 'pier_section', 'warehouse'], landmark: ['lighthouse', 'harbour_crane'], fill: ['moored_boat', 'barrel', 'crate', 'canal_wall', 'bridge'] },
    tenements: { anchor: ['city_insula', 'city_townhouse'], landmark: ['well', 'street_shrine'], fill: ['sewer_grate', 'trough', 'barrel', 'fountain_wall'] },
    temple: { anchor: ['city_temple'], landmark: ['plaza_statue', 'fountain_basin'], fill: ['street_shrine', 'colonnade'] },
    stores: { anchor: ['granary', 'warehouse'], landmark: ['cistern'], fill: ['crate', 'barrel'] }
  };
  const ROAD = { every: 4, furniture: 'lamp_post', end: 'milestone', grate: 'sewer_grate' };
  const CAPS = { total: 220, detail: 110, perShape: 14, linear: 48 };
  const LINEAR = new Set(['paving_slab', 'lamp_post', 'water_channel', 'aqueduct_arch', 'city_wall', 'sewer_grate']);
  const CULL = { detail: 22, building: 64 };
  // Plan placements for one city room. cells: {"x,y": {tile, floorHeight, navigationReserved, exitMarker}}; rect: walkable bounds.
  function planCity({ cells, width, height, city, seed = 'city', reserved = new Set() }) {
    const r = rnd(`${seed}:${city?.id || ''}`), palette = paletteFor(city), out = [], used = new Set(), counts = {};
    const free = (x, y, w = 1, d = 1) => { for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) { const k = `${x + i},${y + j}`, c = cells[k]; if (!c || c.tile !== 'floor' || c.navigationReserved || c.exitMarker || used.has(k) || reserved.has(k)) return false; } return true; };
    const claim = (x, y, w, d) => { for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used.add(`${x + i},${y + j}`); };
    const put = (shape, x, y, extra = {}) => {
      const s = S[shape]; if (!s || out.length >= CAPS.total || (counts[shape] || 0) >= (LINEAR.has(shape) ? CAPS.linear : CAPS.perShape)) return false;
      if (s.detail && out.filter(p => p.detail).length >= CAPS.detail) return false;
      const [w, d] = s.footprint; if (!free(x, y, w, d)) return false;
      claim(x, y, w, d); counts[shape] = (counts[shape] || 0) + 1;
      const pool = variants(shape), variant = pool[Math.floor(r() * pool.length)], tileShape = `${shape}__v${variant}`;
      out.push({ shape, tileShape, variant, palette, x, y, footprint: [w, d], height: s.height, group: s.group, detail: !!s.detail, blocking: !!s.blocking,
        cullDistance: s.detail ? CULL.detail : CULL.building, light: !!s.light, ...extra });
      return true;
    };
    // Districts: split the room into vertical bands, one per city district (+ temple/stores when the city has room).
    const districts = [...(city?.districts || ['forum', 'market ward', 'guild quarter', 'tenements'])];
    if ((city?.population || 0) > 6000 && !districts.includes('temple')) districts.push('temple');
    if (city?.utilities?.includes('cistern') && !districts.includes('stores')) districts.push('stores');
    const bandW = Math.max(6, Math.floor(width / districts.length));
    const roadY = Math.floor(height / 2);
    districts.forEach((district, i) => {
      const plan = DISTRICTS[district] || DISTRICTS.tenements, x0 = i * bandW, x1 = Math.min(width - 1, x0 + bandW - 1);
      const tryPut = (shape, tries = 30, extra) => { for (let t = 0; t < tries; t++) { const x = x0 + Math.floor(r() * Math.max(1, x1 - x0 - 2)), y = 1 + Math.floor(r() * (height - 4)); if (Math.abs(y - roadY) <= 1) continue; if (put(shape, x, y, { district, ...extra })) return true; } return false; };
      for (const a of plan.anchor) tryPut(a, 40, a === 'guild_hall' ? { guild: city?.guilds?.[i % (city.guilds.length || 1)] } : {});
      if (district === 'guild quarter') for (const guild of (city?.guilds || []).slice(0, 3)) { tryPut('guild_hall', 30, { guild }); tryPut('guild_sign', 20, { guild }); }
      tryPut(plan.landmark[Math.floor(r() * plan.landmark.length)], 40);
      if (plan.large && (city?.population || 0) > 8000) tryPut(plan.large[0], 60);
      for (let k = 0; k < 8; k++) tryPut(plan.fill[Math.floor(r() * plan.fill.length)], 12);
      // the main street through every district: paving, lamp posts every ROAD.every cells, a sewer grate now and then
      for (let x = x0; x <= x1; x++) {
        if (cells[`${x},${roadY}`]?.tile === 'floor') put('paving_slab', x, roadY, { district, ground: true });
        if ((x - x0) % ROAD.every === 0) put(ROAD.furniture, x, roadY - 1, { district });
        if ((x - x0) % 9 === 5) put(ROAD.grate, x, roadY + 1, { district });
      }
    });
    put(ROAD.end, 0, roadY - 1, { district: 'road' }); put(ROAD.end, width - 2, roadY - 1, { district: 'road' });
    // Utilities from the city plan: an aqueduct line with a channel, cistern, baths, harbour.
    const util = city?.utilities || [];
    if (util.includes('aqueduct')) { const ay = 1 + Math.floor(r() * 2); for (let x = 1; x < width - 1; x += 1) put(x % 2 ? 'water_channel' : 'aqueduct_arch', x, ay, { district: 'aqueduct' }); }
    if (util.includes('cistern')) for (let t = 0; t < 30 && !put('cistern', 2 + Math.floor(r() * (width - 5)), height - 4 - Math.floor(r() * 3), { district: 'utilities' }); t++);
    if (util.includes('bathhouse')) for (let t = 0; t < 40 && !put('public_baths', 2 + Math.floor(r() * (width - 7)), 3 + Math.floor(r() * (height - 7)), { district: 'baths' }); t++);
    if (util.includes('public fountains')) for (const f of ['fountain_basin', 'fountain_tiered', 'fountain_wall']) for (let t = 0; t < 20 && !put(f, 1 + Math.floor(r() * (width - 3)), 1 + Math.floor(r() * (height - 3)), { district: 'fountains' }); t++);
    if (util.includes('harbor')) { const hy = height - 3; for (let x = 1; x < width - 3; x += 3) put(x % 6 === 1 ? 'dock' : 'pier_section', x, hy, { district: 'harbor ward' }); put('moored_boat', 2, hy - 2, { district: 'harbor ward' }); put('harbour_crane', width - 3, hy - 1, { district: 'harbor ward' }); }
    // Defences at the room edge: wall segments, a gate on the road, towers and watchtowers at the corners.
    put('city_gate', 0, roadY - 1, { district: 'walls' });
    for (const [x, y] of [[0, 0], [width - 2, 0], [0, height - 2], [width - 2, height - 2]]) if (!put('city_tower', x, y, { district: 'walls' })) put('watchtower', x, y, { district: 'walls' });
    for (let x = 2; x < width - 2; x += 3) put('city_wall', x, 0, { district: 'walls' });
    return { version: 'world1-city-kit-1', palette, placements: out, counts, caps: CAPS, instancedTiles: new Set(out.map(p => `${p.tileShape}:${p.palette}`)).size };
  }
  return { variants, SHAPES, SPECS: S, PALETTES, DISTRICTS, CAPS, CULL, has, build, color, paletteFor, planCity, baseOf, variantOf, hash };
});
