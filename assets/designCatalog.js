(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignCatalog = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // world1 design catalog: original, procedural ornament, moldings, pyramids, themes and illustration options.
  // Names are descriptive only. Every entry is ADDED to an existing option list; nothing here replaces one.
  const TAU = Math.PI * 2, fr = v => v - Math.floor(v), near = (n, w) => Math.abs(n) < w;
  const mod = (v, n) => ((v % n) + n) % n;
  // Field functions take world-pixel coordinates (X runs continuously along a wall, Y down the band, 0..H)
  // and return 0 (ground), 1 (cut/shadow) or 2 (raised/highlight). Because X is world-continuous, adjacent
  // modules join; every motif is lattice-based so motifs meet and interlock at cell edges.
  function meanderCell(x, y, s) { // interlocking double key on an s-cell lattice
    const u = mod(x, s * 2) / s, v = mod(y, s) / s, k = Math.floor(x / (s * 2)) % 2;
    const w = .16;
    const path = near(v - .1, w / 2) && u < 1.8 || near(u - 1.8, w / 2) && v < .9 || near(v - .9, w / 2) && u > .4 && u < 1.8 ||
      near(u - .4, w / 2) && v > .35 && v < .9 || near(v - .35, w / 2) && u > .4 && u < 1.35 || near(u - 1.35, w / 2) && v > .35 && v < .62;
    return path ? (k ? 2 : 1) : 0;
  }
  const F = {
    meander_field: (x, y, s) => meanderCell(x, y, s) || meanderCell(x + s, y + s / 2, s) && 1,
    egg_dart_course: (x, y, s) => { const u = mod(x, s) / s - .5, v = y / s - .5; const e = u * u / .09 + v * v / .2; return near(e - 1, .25) ? 2 : near(u - .5, .04) && v > -.3 ? 1 : e < .6 ? 1 : 0; },
    dentil_course: (x, y, s) => (mod(x, s) < s * .6 && mod(y, s * 1.4) < s ? 2 : mod(x, s) < s * .66 ? 0 : 1),
    coffer_grid: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5, m = Math.max(Math.abs(u), Math.abs(v)); return near(m - .45, .05) || near(m - .3, .03) ? 2 : near(m - .38, .03) ? 1 : Math.hypot(u, v) < .1 ? 2 : 0; },
    rinceau_scroll: (x, y, s) => { const t = x / s * Math.PI, w = Math.sin(t) * .32; const v = mod(y, s) / s - .5; if (near(v - w, .05)) return 2;
      const cx = (Math.floor(x / s) + .5) * s, side = Math.floor(x / s) % 2 ? 1 : -1, r = Math.hypot(x - cx, (v + side * .22) * s) / s; return near(r - .18, .035) && (x - cx) * side > -s * .1 ? 1 : 0; },
    tracery_field: (x, y, s) => { const u = mod(x, s) / s, v = mod(y, s * 1.6) / s; const arch = Math.abs(Math.sin(u * Math.PI)) - (1.6 - v) * .7;
      const foil = [[.5, .45], [.32, .7], [.68, .7]].some(([a, b]) => near(Math.hypot(u - a, v - b) - .13, .03)); return near(arch, .06) || near(u, .04) || near(u - 1, .04) ? 2 : foil ? 1 : 0; },
    crocket_run: (x, y, s) => { const u = mod(x, s) / s, v = y / s; const hook = near(Math.hypot(u - .5, v - .35) - .22, .05) && v < .45; return near(v - .75, .07) ? 2 : hook ? 2 : near(u - .5, .05) && v > .4 && v < .75 ? 1 : 0; },
    lotus_papyrus: (x, y, s) => { const i = Math.floor(x / s), u = mod(x, s) / s - .5, v = y / s; const lotus = i % 2 === 0;
      const bloom = lotus ? near(Math.abs(u) * 2 - (1 - v) * .9, .09) && v < .7 : near(Math.abs(u) - (.45 - v * .6), .05) && v < .55;
      return bloom ? 2 : near(u, .05) && v > .5 ? 1 : near(v - .95, .05) ? 1 : 0; },
    cavetto_band: (x, y, s) => { const v = y / (s * 1.5); return v < .18 ? 2 : near(fr(x / (s * .5)) - .5, .12) && v < .8 ? 1 : v > .9 ? 2 : 0; },
    step_fret: (x, y, s) => { const u = mod(x, s * 2) / s, v = mod(y, s) / s, flip = u > 1 ? 1 : 0, uu = fr(u), vv = flip ? 1 - v : v;
      const stair = Math.floor(uu * 4) / 4 >= vv - .05 && Math.floor(uu * 4) / 4 <= vv + .2; const hook = uu > .7 && near(vv - .25, .08); return stair ? 2 : hook ? 1 : 0; },
    stepped_terrace: (x, y, s) => { const u = mod(x, s * 2) / (s * 2) - .5, v = mod(y, s) / s; const tier = Math.floor((1 - v) * 5); return near(Math.abs(u) - (.1 + tier * .08), .03) || near(fr((1 - v) * 5), .08) && Math.abs(u) < .1 + tier * .08 ? 2 : 0; },
    assyrian_rosettes: (x, y, s) => { const cx = (Math.floor(x / s) + .5) * s, cy = (Math.floor(y / s) + .5) * s, dx = (x - cx) / s, dy = (y - cy) / s, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      return near(r - .3 - .07 * Math.cos(a * 12), .04) ? 2 : r < .1 ? 2 : near(r - .45, .03) ? 1 : 0; },
    girih_stars: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5, a = Math.atan2(v, u), r = Math.hypot(u, v);
      const star = r - .32 * (1 - .35 * Math.abs(Math.cos(a * 5))) ; const strap = near(Math.abs(u) + Math.abs(v) - .5, .035) || near(u * .7 + v * .7, .03) || near(u * .7 - v * .7, .03);
      return near(star, .035) ? 2 : strap && r > .3 ? 1 : 0; },
    lotus_scroll: (x, y, s) => { const t = x / s * Math.PI; const v = mod(y, s) / s - .5; const stem = near(v - .28 * Math.sin(t), .04);
      const c = (Math.floor(x / s) + .5) * s, u = (x - c) / s, petals = near(Math.sin(Math.atan2(v + .1, u) * 5), .25) && Math.hypot(u, v + .1) < .2; return stem ? 2 : petals ? 1 : 0; },
    cloud_scroll: (x, y, s) => { const u = mod(x, s) / s, v = mod(y, s) / s; const c = [[.3, .5], [.6, .4], [.75, .62]];
      return c.some(([a, b], i) => near(Math.hypot(u - a, v - b) - .14 - i * .02, .03)) ? 2 : near(Math.hypot(u - .3, v - .5) - .06, .02) ? 1 : 0; },
    lattice_screen: (x, y, s) => { const u = mod(x, s) / s, v = mod(y, s) / s; return near(u - .5, .06) || near(v - .5, .06) || near(u - v, .05) && u > .5 === v > .5 ? 2 : near(u, .03) || near(v, .03) ? 1 : 0; },
    knot_lattice: (x, y, s) => { const a = Math.sin(x / s * Math.PI + y / s * Math.PI), b = Math.sin(x / s * Math.PI - y / s * Math.PI); const over = mod(Math.floor(x / s) + Math.floor(y / s), 2);
      return near(a, .18) ? (over ? 2 : 1) : near(b, .18) ? (over ? 1 : 2) : 0; },
    chevron_field: (x, y, s) => (near(fr((x + Math.abs(mod(y, s) - s / 2) * 1.6) / s) - .5, .15) ? 2 : 0),
    imbrication: (x, y, s) => { const row = Math.floor(y / (s * .5)), u = mod(x + row % 2 * s / 2, s) / s - .5, v = mod(y, s * .5) / s; return near(Math.hypot(u, v) - .5, .05) ? 2 : 0; },
    basketweave: (x, y, s) => { const cu = Math.floor(x / s), cv = Math.floor(y / s), u = mod(x, s) / s, v = mod(y, s) / s, horiz = (cu + cv) % 2 === 0;
      return near(fr((horiz ? v : u) * 3) - .5, .1) ? 1 : near(horiz ? u : v, .05) ? 2 : 0; },
    arabesque_vine: (x, y, s) => { const a = Math.sin(x / s * TAU) * .3, v = mod(y, s) / s - .5; const b = -a; return near(v - a, .04) || near(v - b, .04) ? 2 : near(Math.hypot(mod(x, s) / s - .5, v) - .12, .03) ? 1 : 0; },
    hex_star_tile: (x, y, s) => { const q = x / s, r = y / (s * .866), rr = Math.floor(r), qq = q - (rr % 2) * .5, u = fr(qq) - .5, v = fr(r) - .5, a = Math.atan2(v, u);
      return near(Math.hypot(u, v) - .3 * (1 - .3 * Math.abs(Math.cos(a * 3))), .04) ? 2 : near(Math.hypot(u, v) - .48, .03) ? 1 : 0; },
    running_spiral: (x, y, s) => { const u = mod(x, s) / s, v = y / s - .5, a = Math.atan2(v, u - .5), r = Math.hypot(u - .5, v);
      return near(fr(a / TAU + r * 3) - .5, .1) && r < .4 ? 2 : near(v + .45, .04) ? 1 : 0; },
    chain_links: (x, y, s) => { const u = mod(x, s) / s - .5, v = y / s - .5, alt = Math.floor(x / s) % 2; const e = alt ? u * u / .2 + v * v / .06 : u * u / .2 + v * v / .02;
      return near(e - 1, .3) ? (alt ? 2 : 1) : 0; },
    quatrefoil_field: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5; return [[0, -.17], [.17, 0], [0, .17], [-.17, 0]].some(([a, b]) => near(Math.hypot(u - a, v - b) - .17, .03)) ? 2 : near(Math.abs(u) + Math.abs(v) - .7, .03) ? 1 : 0; },
    sun_disc_rays: (x, y, s) => { const c = (Math.floor(x / (s * 2)) + .5) * s * 2, u = (x - c) / s, v = y / s - .5, r = Math.hypot(u, v), a = Math.atan2(v, u);
      return r < .25 ? 2 : r < .9 && near(Math.sin(a * 16), .2) ? 1 : 0; },
    diamond_lozenge: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5, d = Math.abs(u) + Math.abs(v); return near(d - .45, .04) ? 2 : near(d - .25, .04) ? 1 : 0; },
    pinwheel_tiles: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5, a = mod(Math.atan2(v, u) + Math.hypot(u, v) * 4, TAU / 4); return a < .5 && Math.hypot(u, v) < .48 ? 2 : 0; },
    fan_shells: (x, y, s) => { const u = mod(x, s) / s - .5, v = 1 - mod(y, s) / s, a = Math.atan2(u, v), r = Math.hypot(u, v); return r < .55 && near(Math.sin(a * 9), .25) ? 2 : near(r - .55, .04) ? 1 : 0; },
    dragon_coil: (x, y, s) => { const t = x / s * Math.PI, v = y / s - .5, b = .3 * Math.sin(t); return near(v - b, .08) ? 2 : near(v - b, .13) ? 1 : near(fr(x / (s * .25)) - .5, .1) && near(v - b, .07) ? 1 : 0; },
    bone_ossuary_grid: (x, y, s) => { const u = mod(x, s) / s - .5, v = mod(y, s) / s - .5; return near(u + v, .06) || near(u - v, .06) ? 2 : Math.hypot(Math.abs(u) - .5, Math.abs(v) - .5) < .12 ? 1 : 0; }
  };
  const ORNAMENTS = Object.keys(F);
  const TRADITION = { meander_field: 'greek', egg_dart_course: 'greek', dentil_course: 'greek', coffer_grid: 'roman', rinceau_scroll: 'roman',
    tracery_field: 'gothic', crocket_run: 'gothic', lotus_papyrus: 'egyptian', cavetto_band: 'egyptian', step_fret: 'mesoamerican', stepped_terrace: 'andean',
    assyrian_rosettes: 'near_eastern', girih_stars: 'near_eastern', lotus_scroll: 'south_asian', cloud_scroll: 'east_asian', lattice_screen: 'east_asian',
    knot_lattice: 'insular', chevron_field: 'romanesque', imbrication: 'roman', basketweave: 'byzantine', arabesque_vine: 'near_eastern', hex_star_tile: 'near_eastern',
    running_spiral: 'greek', chain_links: 'norse', quatrefoil_field: 'gothic', sun_disc_rays: 'egyptian', diamond_lozenge: 'byzantine', pinwheel_tiles: 'mesoamerican',
    fan_shells: 'renaissance', dragon_coil: 'tartarean', bone_ossuary_grid: 'tartarean' };
  const BORDERS = ['egg_dart', 'crocket', 'cavetto', 'step_fret', 'cloud', 'lattice', 'dentil_bold', 'chevron'];
  const WEAVES = ['single', 'overlay', 'strapwork', 'nested'];
  const ROLES = ['baseboard', 'surround'];
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  // Interlocking composition: two motifs share one lattice. strapwork joins cell centres with continuous diagonal straps;
  // nested sets the partner at half scale inside the primary's empty ground; overlay alternates by checker cell.
  function field(style, X, Y, s, second, weave) {
    const a = F[style] || F.meander_field, b = F[second] || null;
    const p = a(X, Y, s);
    if (!b || weave === 'single') return p;
    if (weave === 'overlay') return (mod(Math.floor(X / (s * 2)) + Math.floor(Y / (s * 2)), 2) ? b(X, Y, s) : p);
    if (weave === 'nested') return p || (b(X * 2, Y * 2, s) ? 1 : 0);
    const strap = near(fr((X + Y) / (s * 2)) - .5, .045) || near(fr((X - Y) / (s * 2)) - .5, .045);
    return p || (strap ? 2 : 0) || (b(X, Y, s * 2) === 2 ? 1 : 0);
  }
  function seedPick(seed, list) { return list[hash(seed) % list.length]; }
  // Paint a band in the 96x64 carving space. World continuity: offset is the module's along-wall start in pixels.
  function paintBand(c, art, pal = {}, opts = {}) {
    const light = pal.highlight || '#e4d7b6', dark = pal.shadow || '#55483a', trim = pal.secondary || '#b9a180';
    const W = opts.width || 96, H = opts.height || 64;
    const along = art.axis === 'x' ? 'y' : 'x', size = art.size?.[along] || 1, ppu = W / size;
    const offset = Number.isFinite(art.position?.[along]) ? art.position[along] * ppu : 0;
    const role = art.stoneworkRole || 'dado', molding = MOLDINGS[role] || MOLDINGS.dado;
    const style = ORNAMENTS.includes(art.carvingStyle) ? art.carvingStyle : seedPick(art.label || 'band', ORNAMENTS);
    const second = ORNAMENTS.includes(art.ornamentSecond) ? art.ornamentSecond : null, weave = WEAVES.includes(art.ornamentWeave) ? art.ornamentWeave : second ? 'strapwork' : 'single';
    const scale = (opts.scale || molding.scale) * H;
    // Profile: fillets and ovolo/cyma ramps from the molding definition, then the motif course in its field.
    let y = 0;
    for (const [kind, frac] of molding.profile) {
      const h = Math.max(1, Math.round(frac * H));
      if (kind === 'fillet') { c.fillStyle = trim; c.fillRect(0, y, W, h); c.fillStyle = light; c.fillRect(0, y, W, 1); c.fillStyle = dark; c.fillRect(0, y + h - 1, W, 1); }
      else if (kind === 'ovolo' || kind === 'cyma' || kind === 'cavetto') for (let i = 0; i < h; i++) { const t = i / Math.max(1, h - 1), k = kind === 'ovolo' ? Math.sin(t * Math.PI) : kind === 'cyma' ? (t < .5 ? t * 2 : 2 - t * 2) : 1 - t; c.fillStyle = k > .66 ? light : k > .33 ? trim : dark; c.fillRect(0, y + i, W, 1); }
      else if (kind === 'course') {
        for (let yy = 0; yy < h; yy++) for (let x = 0; x < W; x++) {
          const v = field(style, x + offset, yy * (64 / H), Math.max(3, scale * (64 / H)), second, weave);
          if (v) { c.fillStyle = v === 2 ? light : dark; c.fillRect(x, y + yy, 1, 1); }
        }
        c.fillStyle = dark; c.fillRect(0, y, W, 1); c.fillRect(0, y + h - 1, W, 1);
      }
      y += h;
    }
    return { style, second, weave, role };
  }
  const MOLDINGS = {
    cornice: { scale: .16, profile: [['fillet', .08], ['cyma', .14], ['course', .32], ['ovolo', .16], ['fillet', .06], ['course', .16], ['fillet', .08]] },
    dado: { scale: .28, profile: [['fillet', .07], ['ovolo', .08], ['course', .7], ['ovolo', .08], ['fillet', .07]] },
    skirting: { scale: .2, profile: [['fillet', .1], ['cyma', .16], ['course', .5], ['fillet', .24]] },
    baseboard: { scale: .18, profile: [['fillet', .08], ['ovolo', .12], ['course', .44], ['cavetto', .14], ['fillet', .22]] },
    surround: { scale: .14, profile: [['fillet', .12], ['course', .52], ['cyma', .2], ['fillet', .16]] }
  };
  // Voxel versions for frames and gate surrounds (shared with StoneCarvings.carveVoxels).
  const VOXEL_PATTERNS = ['meander_field', 'step_fret', 'lotus_papyrus', 'girih_stars', 'tracery_field', 'cloud_scroll'];
  function voxelInk(pattern, u, v) { return !!F[pattern]?.(u * 96, v * 64, 12); }
  // Pyramids: stepped (terraced) and smooth (true) forms with a stair or shaft entrance and capstone.
  const PYRAMIDS = ['pyramid_stepped', 'pyramid_smooth', 'pyramid_ruined', 'ziggurat_terraced'];
  function pyramidVoxels(shape, size, seed = 0) {
    const out = new Uint8Array(size ** 3), at = (x, y, z) => x + y * size + z * size * size, half = size / 2;
    const tiers = 4 + seed % 3, ruin = shape === 'pyramid_ruined';
    for (let z = 0; z < size; z++) {
      const t = z / size;
      let r = shape === 'pyramid_smooth' || ruin ? half * (1 - t) : half * (1 - Math.floor(t * tiers) / tiers) * (shape === 'ziggurat_terraced' ? .96 : 1);
      if (shape === 'ziggurat_terraced' && t > .82) r = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = Math.abs(x + .5 - half), dy = Math.abs(y + .5 - half);
        if (Math.max(dx, dy) > r) continue;
        if (ruin && (hash(`${x},${y},${z},${seed}`) % 100) < 6 + t * 40 && Math.max(dx, dy) > r - 2) continue;
        // Front stair or doorway on -y face.
        if ((shape === 'pyramid_stepped' || shape === 'ziggurat_terraced') && dx < size * .08 && y < half - r + 3 && z < size * .9) { if ((z + y) % 2) continue; }
        if (shape === 'pyramid_smooth' && dx < size * .06 && y < half - r + 2 && z > size * .08 && z < size * .2) continue;
        out[at(x, y, z)] = 1;
      }
    }
    return out;
  }
  const PYRAMID_LORE = [
    'Carved steps descend toward a sealed shaft said to reach the river of souls beneath Tartarus.',
    'Its capstone once held a lamp that guided the departed toward Mortacia\'s judgment.',
    'Wind-cut terraces bear rows of kneeling souls; the lowest course is warm to the touch.',
    'Pilgrims claim the shaft breathes at dusk, exhaling the dust of an older underworld.',
    'A ring of broken offering basins marks where tomb-builders bargained with the dead.',
    'The southern face is scored with dragon claws, as if something tried to climb out.'
  ];
  // Architectural themes per biome or city; they bias defaults only, every option stays selectable.
  const THEMES = {
    temple: { ornaments: ['meander_field', 'egg_dart_course', 'coffer_grid', 'rinceau_scroll'], roles: ['cornice', 'dado', 'baseboard'], palette: 'marble_dawn', lighting: 'shaft_from_above' },
    crypt: { ornaments: ['bone_ossuary_grid', 'dragon_coil', 'quatrefoil_field', 'chain_links'], roles: ['skirting', 'baseboard'], palette: 'tomb_ochre', lighting: 'candle_pools' },
    wasteland: { ornaments: ['step_fret', 'stepped_terrace', 'sun_disc_rays', 'cavetto_band'], roles: ['dado'], palette: 'tartarus_noon', lighting: 'sandstorm_haze' },
    palace: { ornaments: ['girih_stars', 'arabesque_vine', 'assyrian_rosettes', 'fan_shells'], roles: ['cornice', 'dado', 'baseboard'], palette: 'royal_lapis', lighting: 'chandelier_glow' },
    fortress: { ornaments: ['chevron_field', 'knot_lattice', 'dentil_course', 'chain_links'], roles: ['dado', 'baseboard'], palette: 'basalt_iron', lighting: 'torch_flicker' },
    cavern: { ornaments: ['imbrication', 'running_spiral', 'cloud_scroll'], roles: ['skirting'], palette: 'cavern_teal', lighting: 'crystal_glow' },
    garden: { ornaments: ['lotus_scroll', 'lotus_papyrus', 'lattice_screen', 'cloud_scroll'], roles: ['dado'], palette: 'garden_jade', lighting: 'dappled_canopy' },
    city: { ornaments: ['tracery_field', 'crocket_run', 'basketweave', 'diamond_lozenge'], roles: ['cornice', 'dado'], palette: 'sandstone_market', lighting: 'golden_hour' },
    library: { ornaments: ['lattice_screen', 'quatrefoil_field', 'coffer_grid'], roles: ['cornice', 'baseboard'], palette: 'vellum_brown', lighting: 'lamp_reading' }
  };
  function themeFor(text = '', biome = '') {
    const s = `${text} ${biome}`.toLowerCase();
    if (/library|archive|scriptor|study/.test(s)) return 'library';
    if (/crypt|tomb|ossuar|catacomb|grave/.test(s)) return 'crypt';
    if (/palace|throne|court|basilica/.test(s)) return 'palace';
    if (/fort|keep|castle|citadel|barrack/.test(s)) return 'fortress';
    if (/cavern|cave|grotto|mine/.test(s)) return 'cavern';
    if (/garden|grove|oasis|orchard/.test(s)) return 'garden';
    if (/wasteland|desert|dune|plain|badland/.test(s)) return 'wasteland';
    if (/market|village|city|hamlet|street|forum|harbor/.test(s)) return 'city';
    return 'temple';
  }
  // Illustration (room picture) catalog: compact IDs appended to the existing component lists.
  const ILLUSTRATION_KINDS = ['pyramid_stepped', 'pyramid_smooth', 'ziggurat', 'colonnade', 'cornice_band', 'dado_band', 'frieze_band', 'coffered_ceiling',
    'vault', 'tracery_window', 'lattice_screen', 'tiered_roof', 'terrace_steps', 'aqueduct', 'guardian_beast', 'banner', 'lantern', 'bookshelf', 'sarcophagus',
    'altar', 'fountain', 'well', 'gate', 'canopy', 'dragon_skull', 'bones', 'sandstorm', 'light_rays', 'chasm', 'lava', 'waterfall', 'palm', 'cypress',
    'dome', 'balustrade', 'sphinx_like', 'throne', 'scaffold', 'tent', 'campfire'];
  const PALETTES = {
    marble_dawn: ['#f1e7d0', '#c9b48e', '#8a7354', '#3d3024', '#e7b45a', '#7aa0c9'], tomb_ochre: ['#c79a52', '#8b6331', '#4b3219', '#1c130c', '#e0c37a', '#5c7a52'],
    tartarus_noon: ['#f2d34a', '#d8a63a', '#9b6a2a', '#3f2a16', '#ffef9a', '#7a3d22'], royal_lapis: ['#2a4ea0', '#e5c060', '#8a2e3a', '#141a33', '#f5e6b0', '#5aa0c8'],
    basalt_iron: ['#545a61', '#2e3236', '#9aa1a8', '#121416', '#c26a2a', '#d8d2c0'], cavern_teal: ['#2f7a78', '#1c4746', '#7fd3c6', '#0b1a1a', '#c0f0e8', '#6a4a8a'],
    garden_jade: ['#3f8a4e', '#a7c96a', '#24502e', '#10221a', '#f0d890', '#c96a8a'], sandstone_market: ['#d9a86a', '#a3703e', '#e7d2a8', '#3b2617', '#c04a2a', '#3a7aa0'],
    vellum_brown: ['#8a5a32', '#c99a62', '#4a2e18', '#1a100a', '#f0dca0', '#6a2a2a'], ash_violet: ['#6a4a7a', '#3a2a48', '#b49ac8', '#140c1c', '#e8c8f0', '#a04060'],
    ember_red: ['#a83a22', '#5e1c10', '#e8823a', '#1a0a06', '#ffd070', '#4a4a4a'], frost_silver: ['#b8c8d8', '#7890a8', '#e8f0f8', '#1a2430', '#90d0ff', '#5a6a7a'],
    bronze_sun: ['#b07a32', '#6a4418', '#e8c070', '#20140a', '#fff0a0', '#2a6a6a'], volcanic: ['#3a2a2a', '#1a1212', '#e0542a', '#0a0606', '#ffb040', '#6a5a5a'],
    moon_ivory: ['#d8d4c0', '#9a967e', '#5a5848', '#1c1c18', '#c8d8ff', '#7a6a9a'], verdigris: ['#5a9a88', '#2e5a4e', '#b8d8c0', '#122420', '#d8b060', '#8a5a3a']
  };
  const LIGHTING = ['shaft_from_above', 'candle_pools', 'sandstorm_haze', 'chandelier_glow', 'torch_flicker', 'crystal_glow', 'dappled_canopy', 'golden_hour',
    'lamp_reading', 'moonlit', 'lava_underglow', 'storm_flash', 'fog_bank', 'backlit_silhouette', 'twin_braziers', 'aurora_veil'];
  const COMPOSITIONS = ['central_axis', 'rule_of_thirds', 'diagonal_recession', 'framed_arch', 'low_angle_monument', 'high_vista', 'corridor_depth',
    'symmetrical_nave', 'off_center_landmark', 'layered_terraces', 'silhouette_skyline', 'close_detail'];
  function sanitizeChoice(value, list, fallback = null) { return list.includes(value) ? value : fallback; }
  // Ordered (Bayer 4x4) dithering to a limited palette at a lower internal resolution, then nearest-neighbour upscale.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function rampPalette(colors) {
    const out = [[0, 0, 0]];
    for (const c of colors.slice(0, 6)) { const [r, g, b] = rgb(c); for (const k of [.5, 1, 1.3]) out.push([r, g, b].map(v => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k))))); }
    return out.slice(0, 16); // black + 6 colours x 3 tones = 19 -> strictly 16
  }
  function pixelate(data, w, h, colors, factor = 2) {
    const pal = rampPalette(colors), lw = Math.floor(w / factor), lh = Math.floor(h / factor), low = new Uint8ClampedArray(lw * lh * 3);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) { const k = ((y * factor + j) * w + x * factor + i) * 4; r += data[k]; g += data[k + 1]; b += data[k + 2]; n++; }
      const t = (BAYER[(y % 4) * 4 + x % 4] / 16 - .5) * 22;
      const want = [r / n + t, g / n + t, b / n + t];
      let best = pal[0], bd = Infinity;
      for (const p of pal) { const d = (p[0] - want[0]) ** 2 * .3 + (p[1] - want[1]) ** 2 * .59 + (p[2] - want[2]) ** 2 * .11; if (d < bd) { bd = d; best = p; } }
      low.set(best, (y * lw + x) * 3);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (Math.min(lh - 1, Math.floor(y / factor)) * lw + Math.min(lw - 1, Math.floor(x / factor))) * 3, k = (y * w + x) * 4;
      data[k] = low[s]; data[k + 1] = low[s + 1]; data[k + 2] = low[s + 2]; data[k + 3] = 255;
    }
    return data;
  }
  // Compact catalog line for prompts (IDs only).
  function promptCatalog() {
    return `ornament:${ORNAMENTS.join('/')}; weave:${WEAVES.join('/')}; molding roles add:${ROLES.join('/')}; borders add:${BORDERS.join('/')}`;
  }
  function illustrationCatalog() {
    return `kinds add:${ILLUSTRATION_KINDS.join('/')}. Optional palette:${Object.keys(PALETTES).join('/')}; lighting:${LIGHTING.join('/')}; composition:${COMPOSITIONS.join('/')}; motif: an ornament id`;
  }
  return { ORNAMENTS, TRADITION, BORDERS, WEAVES, ROLES, MOLDINGS, F, field, paintBand, VOXEL_PATTERNS, voxelInk, PYRAMIDS, pyramidVoxels, PYRAMID_LORE,
    THEMES, themeFor, ILLUSTRATION_KINDS, PALETTES, LIGHTING, COMPOSITIONS, sanitizeChoice, pixelate, rampPalette, hash, promptCatalog, illustrationCatalog };
});
