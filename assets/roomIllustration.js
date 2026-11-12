(function(root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./designCatalog') : root.DesignCatalog,
    name => node ? require('../retort/worldFlags').on(name) : root.HolodekFlags?.[name] === true,
    node ? require('./genreExpansion') : root.GenreExpansion,
    node ? require('./sceneryGrammar') : root.SceneryGrammar);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomIllustration = api;
})(typeof window === 'object' ? window : globalThis, function(Catalog, flagFn, Expansion, Grammar) {
  'use strict';
  if (!Grammar) throw Error('Scenery grammar must load before room illustrations.');
  const flag = flagFn || (() => false);
  const width = 320, height = 200;
  const palette = ['#000000', '#ffffff', '#883932', '#67b6bd', '#8b3f96', '#55a049', '#40318d', '#d6cf6a',
    '#a86432', '#68451d', '#bf6c78', '#424242', '#777777', '#a0cf83', '#7869c4', '#aaaaaa'];
  const kinds = ['ridge', 'wall', 'pillar', 'arch', 'portico', 'stairs', 'door', 'building', 'bridge',
    'tree', 'roots', 'pool', 'river', 'crystal', 'stalactite', 'statue', 'grave', 'obelisk', 'brazier',
    'fresco', 'mosaic', 'rubble', 'grass', 'mist', 'sun', 'moon', 'cloud', 'mountain', 'dunes', 'tower', 'citadel', 'road', 'stars'];
  const patterns = ['plain', 'stone', 'sand', 'tiles', 'cracked', 'ripples', 'stipple'];
  // world1 ART_CATALOG: APPEND set pieces; existing kinds keep their exact painters. ROOM_PIXEL: crisp low-res dithered finish.
  const catalogOn = !!Catalog && flag('ART_CATALOG'), pixelOn = !!Catalog && flag('ROOM_PIXEL');
  const catalogKinds = catalogOn ? Catalog.ILLUSTRATION_KINDS.filter(k => !kinds.includes(k)) : [], allKinds = [...kinds, ...catalogKinds,
    ...(Expansion && flag('ARCHITECTURE_EXPANSION') ? Object.keys(Expansion.SHAPES) : [])];
  const color = c => /^#[0-9a-f]{6}$/i.test(c) || Number.isInteger(c) && c >= 0 && c < palette.length;
  const materialNames = ['stone', 'masonry', 'cloth', 'metal', 'crystal', 'water', 'sky', 'sand', 'wood', 'foliage', 'earth'];
  const detailLevels = ['sparse', 'moderate', 'rich'];
  const rampSteps = ['highlight', 'light', 'mid', 'shade', 'shadow', 'deepShadow'];
  const accentUsages = ['sky', 'ground', 'crystal', 'masonry', 'glow', 'water', 'vegetation', 'metal', 'light'];
  const depthBands = ['far', 'mid', 'foreground'];
  const stampTypes = ['crack', 'carving', 'tuft', 'silhouette', 'gravel', 'moss', 'ripples', 'tiles'];
  const variantNames = ['fluting', 'cracks', 'weathering', 'base', 'capital', 'ridges', 'snowcap', 'scree', 'pinnacle', 'jagged', 'stones', 'moss', 'erosion', 'dense', 'wisp'];
  const colorRoles = ['sky', 'ground', 'shadow', 'stone', 'accent', 'light'];
  const MATERIAL_PRESETS = {
    stone: { contrast: 1, lift: 0.02, tint: [2, 1, 0] }, masonry: { contrast: 1.08, lift: 0, tint: [4, 2, 0] },
    cloth: { contrast: 0.68, lift: 0.08, tint: [6, -2, 4] }, metal: { contrast: 1.48, lift: 0.04, tint: [-2, -2, 2] },
    crystal: { contrast: 1.28, lift: 0.12, tint: [4, 8, 16] }, water: { contrast: 1.12, lift: 0.06, tint: [-6, 4, 12] },
    sky: { contrast: 0.62, lift: 0.1, tint: [2, 4, 12] }, sand: { contrast: 0.85, lift: 0.08, tint: [12, 4, -6] },
    wood: { contrast: 0.95, lift: 0.02, tint: [8, 2, -6] }, foliage: { contrast: 0.9, lift: 0.04, tint: [-6, 10, -4] },
    earth: { contrast: 0.9, lift: 0, tint: [6, 2, -2] }
  };
  const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const STAMPS8 = {
    crack: ['........','...#....','..#.....','..##....','.#..#...','.#......','#..#....','........'],
    carving: ['...++...','..+##+..','.+#..#+.','+#....#+','+#....#+','.+#..#+.','..+##+..','...++...'],
    tuft: ['...#....','..#.#...','.#.#.#..','...#....','..#.#...','.#..#.#.','...#....','....#...'],
    silhouette: ['...##...','..#..#..','..#..#..','...##...','..#..#..','..#..#..','.##..#..','##....#.'],
    gravel: ['.#...#..','...#..#.','#.#....#','..#.#...','.#...#.#','...#....','#..#.#..','.#....#.'],
    moss: ['..#.#...','.#.###..','..###.#.','.###.#..','#.#..#..','.###.#..','..#.#.#.','...#....'],
    ripples: ['........','..+++...','......+.','++++....','......+.','...+++..','.+......','........'],
    tiles: ['#######.','#.....#.','#.....#.','#.....#.','#.....#.','#.....#.','#######.','........']
  };
  const STAMPS16 = {
    crack: ['................','......#.........','.....#..........','....##..........','...#..#.........','...#....#.......','..#......#......','..#.#...........','.#...#..........','.#..............','#.....#.........','......#.........','.....#..........','....#...........','...#............','................'],
    carving: ['.......++.......','......+##+......','....++#..#++....','...+#......#+...','..+#........#+..','.+#..........#+.','+#....####....#+','+#...#....#...#+','+#...#....#...#+','+#....####....#+','.+#..........#+.','..+#........#+..','...+#......#+...','....++#..#++....','......+##+......','.......++.......']
  };
  function hexOf(c) { return typeof c === 'number' ? palette[c] : c; }
  function rgbOf(c) { c = hexOf(c); return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); }
  function hexFromRgb(rgb) { return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function mixHex(a, b, t) { const A = rgbOf(a), B = rgbOf(b); return hexFromRgb(A.map((v, i) => v * (1 - t) + B[i] * t)); }
  function shadeRamp(pigment, preset) {
    const contrast = Math.max(1.15, preset?.contrast ?? 1.2), lift = Math.min(preset?.lift ?? 0, 0.04), tint = (preset?.tint ?? [0, 0, 0]).map(v => v * 0.35);
    const base = rgbOf(pigment);
    const luma = base[0] * .3 + base[1] * .59 + base[2] * .11;
    const chroma = base.map(v => v - luma);
    const tone = (lumaTarget) => {
      const l = Math.max(0, Math.min(255, luma + (lumaTarget - luma) * contrast + lift * 255));
      return hexFromRgb(chroma.map((c, i) => l + c * 1.08 + tint[i]));
    };
    const mid = hexFromRgb(base.map((v, i) => v + tint[i]));
    return { highlight: tone(Math.min(245, luma + 78)), light: tone(Math.min(230, luma + 44)), mid,
      shade: tone(Math.max(18, luma - 32)), shadow: tone(Math.max(12, luma - 68)), deepShadow: tone(Math.max(8, luma - 104)) };
  }
  function rampFromCustom(colors) {
    if (colors.length === 6) return Object.fromEntries(rampSteps.map((s, i) => [s, colors[i]]));
    const out = {};
    for (let i = 0; i < rampSteps.length; i++) {
      const f = i / (rampSteps.length - 1) * (colors.length - 1), lo = Math.floor(f), hi = Math.min(colors.length - 1, lo + 1);
      out[rampSteps[i]] = lo === hi ? colors[lo] : mixHex(colors[lo], colors[hi], f - lo);
    }
    return out;
  }
  function parseMaterialSpec(value) {
    if (value === 'none' || value == null) return null;
    if (typeof value === 'string') {
      if (!materialNames.includes(value)) throw Error('Invalid material name.');
      return { name: value };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid material specification.');
    const out = {};
    const n = value.name || value.material;
    if (n !== undefined && n !== 'none') {
      if (!materialNames.includes(n)) throw Error('Invalid material name.');
      out.name = n;
    }
    if (value.steps !== undefined) {
      if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 6 || value.steps.some(s => !rampSteps.includes(s))) throw Error('Invalid material steps.');
      out.steps = [...value.steps];
    }
    if (value.ramp !== undefined && value.ramp !== "none" && value.ramp !== "") {
      const ramp = Array.isArray(value.ramp) ? value.ramp : String(value.ramp).split(',').map(s => s.trim()).filter(Boolean);
      if (ramp.length < 2 || ramp.length > 8 || ramp.some(c => typeof c !== 'string' || !color(c))) throw Error('Invalid custom material ramp.');
      out.ramp = [...ramp];
    }
    if (!out.name && !out.ramp) throw Error('Material needs a name or custom ramp.');
    return out;
  }
  function validateMaterials(raw) {
    const map = {}, targets = new Set([...colorRoles, ...allKinds]);
    const add = (kind, spec) => { if (!targets.has(kind)) throw Error('Invalid materials kind ' + kind + '.'); if (spec) map[kind] = spec.name && !spec.ramp && !spec.steps ? spec.name : spec; };
    if (Array.isArray(raw)) {
      if (raw.length > 40) throw Error('Invalid materials list.');
      for (const item of raw) {
        if (!item || typeof item !== 'object') throw Error('Invalid materials entry.');
        add(item.kind, parseMaterialSpec(item.ramp || item.steps || (item.material && item.material !== 'none') || item.name ? item : item.material));
      }
    } else if (raw && typeof raw === 'object') {
      for (const [kind, value] of Object.entries(raw)) add(kind, parseMaterialSpec(value));
    } else throw Error('Invalid materials.');
    return map;
  }
  function validateAccents(raw) {
    if (raw.length > 2) throw Error('Room art allows at most two accent pigments.');
    return raw.map((a, i) => {
      if (!a || !color(a.color) || !accentUsages.includes(a.usage)) throw Error('Invalid accent ' + i + '.');
      return { color: a.color, usage: a.usage };
    });
  }
  function validateDetails(raw) {
    if (raw.length > 48) throw Error('Invalid details list.');
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    return raw.map((d, i) => {
      const x = d?.x ?? d?.position?.x, y = d?.y ?? d?.position?.y;
      if (!d || !stampTypes.includes(d.type) || !integer(x, -80, 319) || !integer(y, -60, 199)) throw Error('Invalid detail stamp ' + i + '.');
      const out = { type: d.type, x, y };
      if (d.variant !== undefined) {
        if (typeof d.variant !== 'string' || !d.variant || d.variant.length > 24) throw Error('Invalid detail variant ' + i + '.');
        if (d.variant !== 'none' && d.variant !== 'plain') out.variant = d.variant;
      }
      if (d.w !== undefined) { if (!integer(d.w, 8, 32)) throw Error('Invalid detail size ' + i + '.'); out.w = d.w; }
      if (d.h !== undefined) { if (!integer(d.h, 8, 32)) throw Error('Invalid detail size ' + i + '.'); out.h = d.h; }
      if (d.depth !== undefined) {
        if (!depthBands.includes(d.depth)) throw Error('Invalid detail depth ' + i + '.');
        if (d.depth !== 'mid') out.depth = d.depth;
      }
      return out;
    });
  }
  function validateDither(raw) {
    if (raw === false || raw === 'off') return null;
    if (raw === 'sky' || raw === 'water' || raw === 'both' || raw === 'sky-water')
      return { pattern: 'bayer', bits: 1, targets: raw === 'both' || raw === 'sky-water' ? ['sky', 'water'] : [raw] };
    if (raw && typeof raw === 'object') {
      const pattern = raw.pattern === undefined ? 'bayer' : raw.pattern;
      if (pattern !== 'bayer') throw Error('Invalid dither pattern.');
      const bits = raw.bits === undefined ? 1 : raw.bits;
      if (bits !== 1 && bits !== 2) throw Error('Invalid dither bits.');
      const targets = raw.targets === undefined ? ['sky'] : raw.targets;
      if (!Array.isArray(targets) || !targets.length || targets.some(t => t !== 'sky' && t !== 'water')) throw Error('Invalid dither targets.');
      return { pattern, bits, targets: [...new Set(targets)] };
    }
    throw Error('Invalid dither setting.');
  }
  function optionalPlan(raw) {
    const extra = {};
    if (raw.detailLevel !== undefined) {
      if (!detailLevels.includes(raw.detailLevel)) throw Error('Invalid detailLevel.');
      extra.detailLevel = raw.detailLevel;
    }
    if (raw.materials !== undefined) {
      const m = validateMaterials(raw.materials);
      if (Object.keys(m).length) extra.materials = m;
    }
    if (raw.accents !== undefined) {
      if (!Array.isArray(raw.accents)) throw Error('Invalid accents.');
      if (raw.accents.length) extra.accents = validateAccents(raw.accents);
    }
    if (raw.details !== undefined) {
      if (!Array.isArray(raw.details)) throw Error('Invalid details.');
      if (raw.details.length) extra.details = validateDetails(raw.details);
    }
    if (raw.dither !== undefined) {
      const d = validateDither(raw.dither);
      if (d) extra.dither = d;
    }
    if (raw.layout !== undefined) {
      if (raw.layout === 'auto' || raw.layout === 'manual') extra.layout = raw.layout;
      else if (raw.layout && typeof raw.layout === 'object') {
        const mode = raw.layout.mode === 'manual' ? 'manual' : 'auto';
        const out = { mode };
        if (raw.layout.symmetry === 'center' || raw.layout.symmetry === 'mirror' || raw.layout.symmetry === 'none') out.symmetry = raw.layout.symmetry;
        if (typeof raw.layout.hero === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(raw.layout.hero)) out.hero = raw.layout.hero;
        if (typeof raw.layout.heroScale === 'number' && raw.layout.heroScale >= 0.3 && raw.layout.heroScale <= 0.6) out.heroScale = raw.layout.heroScale;
        extra.layout = out;
      } else throw Error('Invalid layout.');
    }
    return extra;
  }
  function layerFields(p) {
    const layer = Object.fromEntries(['kind', 'x', 'y', 'w', 'h', 'color', 'shade', 'detail', 'count', 'pattern'].map(k => [k, p[k]]));
    if (p.material !== undefined && p.material !== 'none') {
      const spec = parseMaterialSpec(p.material);
      if (spec) layer.material = spec.name && !spec.ramp && !spec.steps ? spec.name : spec;
    }
    if (p.variant !== undefined) {
      const list = Array.isArray(p.variant) ? p.variant : [p.variant];
      if (!list.length || list.length > 6 || list.some(v => v !== 'none' && !variantNames.includes(v))) throw Error('Invalid component variant.');
      const clean = list.filter(v => v && v !== 'none');
      if (clean.length) layer.variant = clean.length === 1 ? clean[0] : clean;
    }
    if (p.depth !== undefined) {
      if (!depthBands.includes(p.depth) && p.depth !== 'none') throw Error('Invalid component depth.');
      if (p.depth === 'far' || p.depth === 'foreground') layer.depth = p.depth;
    }
    if (p.steps !== undefined) {
      if (!Array.isArray(p.steps) || !p.steps.length || p.steps.length > 6 || p.steps.some(s => !rampSteps.includes(s))) throw Error('Invalid component ramp steps.');
      layer.steps = [...p.steps];
    }
    if (p.parts !== undefined) {
      const parts = Grammar.validateParts(p.parts);
      if (parts) layer.parts = parts;
    }
    if (p.role !== undefined) {
      const roles = ['hero', 'framing', 'backdrop', 'skyline', 'prop', 'ground', 'sky'];
      if (!roles.includes(p.role)) throw Error('Invalid component role.');
      if (p.role !== 'prop') layer.role = p.role;
    }
    if (p.assembly !== undefined) {
      const assembly = Grammar.validateAssembly(p.assembly);
      if (assembly) layer.assembly = assembly;
    }
    return layer;
  }
  function orderLayers(layers) {
    if (!layers.some(p => p.depth)) return layers;
    const rank = { far: 0, mid: 1, foreground: 2 };
    return layers.map((p, i) => ({ p, i })).sort((a, b) => (rank[a.p.depth || 'mid'] - rank[b.p.depth || 'mid']) || (a.i - b.i)).map(x => x.p);
  }
  function accentKind(usage, kind) {
    return usage === 'crystal' && kind === 'crystal' || usage === 'water' && (kind === 'pool' || kind === 'river')
      || usage === 'masonry' && ['wall', 'pillar', 'arch', 'portico', 'tower', 'citadel', 'building', 'door', 'bridge', 'stairs', 'rubble'].includes(kind)
      || usage === 'glow' && ['brazier', 'sun', 'crystal', 'stars', 'lantern'].includes(kind)
      || usage === 'vegetation' && ['grass', 'tree', 'roots'].includes(kind)
      || usage === 'metal' && ['obelisk', 'door', 'gate'].includes(kind)
      || usage === 'light' && ['brazier', 'sun', 'moon', 'stars', 'lantern'].includes(kind);
  }
  function resolveRamp(spec, base) {
    if (spec.ramp) return rampFromCustom(spec.ramp);
    return shadeRamp(base, MATERIAL_PRESETS[spec.name] || MATERIAL_PRESETS.stone);
  }
  function description(room, fallback = '') {
    return [room?.description, room?.roomDescription, room?.sceneSpec?.source?.description, fallback].find(value =>
      typeof value === 'string' && value.trim().length >= 20 && !/^(?:none|undefined|null)$|^A newly discovered room to the\b/i.test(value.trim()))?.trim() || '';
  }
  function validate(raw) {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    if (!raw || !['interior', 'landscape', 'cavern', 'courtyard'].includes(raw.view) ||
        !integer(raw.horizon, 45, 150) || !integer(raw.vanishing, 40, 280) ||
        !patterns.includes(raw.groundPattern)) throw Error('Invalid room illustration perspective or ground pattern.');
    const colors = ['sky', 'ground', 'shadow', 'stone', 'accent', 'light'];
    for (const c of colors) if (!color(raw[c])) throw Error(`Invalid ${c} color (expected #RRGGBB).`);
    if (raw.ground === raw.shadow || raw.stone === raw.shadow || raw.light === raw.shadow) throw Error('Room art needs distinct material, light and shadow colors.');
    if (!Array.isArray(raw.layers) || raw.layers.length < 6 || raw.layers.length > 36) throw Error('Room art needs 6..36 component layers.');
    const layers = raw.layers.map((p, i) => {
      if (!p || typeof p.kind !== 'string' || (!allKinds.includes(p.kind) && !Grammar.isKindName(p.kind)) || !integer(p.x, -80, 319) || !integer(p.y, -60, 199) ||
          !integer(p.w, 3, 400) || !integer(p.h, 3, 260) || p.x + p.w <= 0 || p.y + p.h <= 0 ||
          !color(p.color) || !color(p.shade) || !color(p.detail) ||
          !integer(p.count, 1, 10) || !patterns.includes(p.pattern)) throw Error(`Invalid room art component ${i}.`);
      const layer = layerFields(p);
      if (!allKinds.includes(p.kind) && !Grammar.isLibraryKind(p.kind) && !layer.parts && !layer.assembly)
        throw Error(`Invalid room art component ${i}: unknown kind needs a drawing recipe.`);
      return layer;
    });
    const picks = catalogOn ? Object.fromEntries([['palette', Object.keys(Catalog.PALETTES)], ['lighting', Catalog.LIGHTING], ['composition', Catalog.COMPOSITIONS], ['motif', Catalog.ORNAMENTS]]
      .map(([k, list]) => [k, Catalog.sanitizeChoice(raw[k], list)]).filter(([, v]) => v)) : {};
    return { view: raw.view, horizon: raw.horizon, vanishing: raw.vanishing,
      ...Object.fromEntries(colors.map(k => [k, raw[k]])), groundPattern: raw.groundPattern, layers, ...picks, ...optionalPlan(raw) };
  }
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function paint(ctx, raw, seed = 1) {
    const plan = Grammar.applyLayout(validate(raw));
    let state = hash(seed);
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const rect = (x, y, w, h, c) => {
      const l = Math.max(0, Math.round(x)), t = Math.max(0, Math.round(y));
      const r = Math.min(width, Math.round(x + w)), b = Math.min(height, Math.round(y + h));
      if (r > l && b > t) { ctx.fillStyle = typeof c === 'number' ? palette[c] : c; ctx.fillRect(l, t, r - l, b - t); }
    };
    const line = (x0, y0, x1, y1, c) => {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) { rect(x0, y0, 1, 1, c); if (x0 === x1 && y0 === y1) break;
        const e = err * 2; if (e >= dy) { err += dy; x0 += sx; } if (e <= dx) { err += dx; y0 += sy; }
      }
    };
    const poly = (points, c, outline) => {
      const lo = Math.max(0, Math.floor(Math.min(...points.map(p => p[1]))));
      const hi = Math.min(height - 1, Math.ceil(Math.max(...points.map(p => p[1]))));
      for (let y = lo; y <= hi; y++) {
        const crossings = [];
        for (let j = 0; j < points.length; j++) { const a = points[j], b = points[(j + 1) % points.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let j = 0; j + 1 < crossings.length; j += 2) rect(Math.ceil(crossings[j]), y, Math.floor(crossings[j + 1]) - Math.ceil(crossings[j]) + 1, 1, c);
      }
      if (outline !== undefined) for (let j = 0; j < points.length; j++) line(...points[j], ...points[(j + 1) % points.length], outline);
    };
    const ellipse = (x, y, w, h, c) => {
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(height, y + h); yy++) {
        const v = (yy + .5 - y - h / 2) / (h / 2), span = Math.sqrt(Math.max(0, 1 - v * v)) * w / 2;
        rect(x + w / 2 - span, yy, span * 2, 1, c);
      }
    };
    const mix = (a, b, t) => {
      a = typeof a === 'number' ? palette[a] : a; b = typeof b === 'number' ? palette[b] : b;
      return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
    };
    function texture(x, y, w, h, pattern, c, d) {
      if (pattern === 'plain') return;
      if (pattern === 'stone' || pattern === 'tiles') {
        const bh = Math.max(4, Math.min(9, h / 7)), bw = bh * 2.5;
        for (let row = 1; row * bh < h; row++) {
          line(x, y + row * bh, x + w - 1, y + row * bh, c);
          for (let col = 0; col * bw < w; col++) {
            const xx = x + col * bw + (row % 2 ? bw / 2 : 0);
            if (xx < x + w) line(xx, y + (row - 1) * bh, xx, y + row * bh, c);
          }
        }
      } else for (let i = 0, n = Math.min(1500, w * h / (pattern === 'stipple' ? 8 : 22)); i < n; i++) {
        const xx = x + random() * w, yy = y + random() * h;
        rect(xx, yy, pattern === 'ripples' ? 2 + random() * 8 : 1 + random() * 3, 1, i % 4 ? c : d);
        if (pattern === 'cracked') line(xx, yy, xx + 2, yy + 3, c);
      }
    }
    function column(x, y, w, h, c, s, d) {
      rect(x, y, w, h, 0); rect(x + 2, y + 3, w - 4, h - 6, c);
      rect(x + 2, y + 4, Math.max(1, w * .22), h - 8, d);
      rect(x + w * .7, y + 3, Math.max(1, w * .2), h - 5, s);
      for (let f = x + 5; f < x + w - 3; f += 4) line(f, y + 6, f, y + h - 5, s);
      rect(x - 2, y, w + 4, 3, s); rect(x - 2, y + 1, w + 3, 1, d);
      rect(x - 2, y + h - 3, w + 4, 3, s); rect(x - 2, y + h - 3, w + 3, 1, d);
    }
    function arch(x, y, w, h, c, s, d) {
      const thick = Math.max(2, w * .12), top = Math.min(h * .45, w * .5);
      const outline = [[x, y + h], [x, y + top], [x + w * .12, y + top * .35], [x + w * .35, y],
        [x + w * .65, y], [x + w * .88, y + top * .35], [x + w, y + top], [x + w, y + h],
        [x + w - thick, y + h], [x + w - thick, y + top + 1], [x + w * .7, y + thick],
        [x + w * .3, y + thick], [x + thick, y + top + 1], [x + thick, y + h]];
      poly(outline, c, s);
      for (let f = 1; f <= 5; f++) {
        const a = Math.PI + f * Math.PI / 6;
        line(x + w / 2 + Math.cos(a) * w / 2, y + top + Math.sin(a) * top,
          x + w / 2 + Math.cos(a) * (w / 2 - thick), y + top + Math.sin(a) * Math.max(1, top - thick), s);
      }
      line(x + 1, y + top, x + 1, y + h - 1, d);
    }
    function tower(x, y, w, h, c, s, d, count) {
      rect(x, y + 3, w, h - 3, 0); rect(x + 1, y + 3, w - 2, h - 4, c);
      rect(x + w * .68, y + 3, w * .3, h - 4, s);
      texture(x + 2, y + 5, w * .64, h - 8, 'stone', mix(c, s, .28), d);
      for (let i = 0; i < count + 2; i++) rect(x + i * w / (count + 2), y, Math.max(1, w / (count + 2) * .55), 5, c);
      line(x + 1, y + 5, x + 1, y + h - 2, d);
      for (let floor = y + 12; floor < y + h - 8; floor += Math.max(8, h / (count + 1))) {
        line(x, floor + 5, x + w - 1, floor + 5, s);
        for (let xx = x + 4; xx < x + w - 3; xx += Math.max(5, w / 4)) {
          rect(xx, floor, 3, 5, s); rect(xx, floor + 1, 2, 3, 0); rect(xx - 1, floor + 5, 5, 1, d);
        }
      }
      rect(x - 1, y + h - 4, w + 2, 4, s); line(x - 1, y + h - 4, x + w, y + h - 4, d);
    }
    ctx.imageSmoothingEnabled = false;
    if ((plan.dither && plan.dither.targets || []).includes('sky')) {
      const skySpec = plan.materials && plan.materials.sky, skyAccent = (plan.accents || []).find(a => a.usage === 'sky');
      const skyRamp = skySpec && skySpec.ramp ? rampFromCustom(skySpec.ramp) : shadeRamp(plan.sky, MATERIAL_PRESETS[(skySpec && skySpec.name) || 'sky']);
      const bits = plan.dither.bits || 1;
      const cols = bits === 2 ? [skyRamp.highlight, skyRamp.light, skyRamp.mid, skyRamp.shade] : [skyRamp.mid, skyAccent ? skyAccent.color : skyRamp.light];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const t = BAYER4[y & 3][x & 3];
        rect(x, y, 1, 1, cols[bits === 2 ? (t >> 2) : (t >= 8 ? 1 : 0)]);
      }
    } else rect(0, 0, width, height, plan.sky);
    rect(0, plan.horizon, width, height - plan.horizon, plan.ground);
    if (plan.groundPattern !== 'tiles') texture(0, plan.horizon, width, height - plan.horizon, plan.groundPattern, plan.shadow, plan.stone);
    if (plan.groundPattern === 'tiles') {
      for (let x = -320; x <= 640; x += 40) line(plan.vanishing, plan.horizon, x, 199, plan.shadow);
      for (let y = plan.horizon + 3, step = 3; y < 200; step *= 1.45, y += step) line(0, y, 319, y, plan.shadow);
    }
    if (plan.view === 'interior') {
      poly([[0, 0], [320, 0], [260, plan.horizon], [60, plan.horizon]], plan.stone);
      poly([[0, 0], [60, plan.horizon], [0, 170]], plan.shadow);
      poly([[320, 0], [260, plan.horizon], [320, 170]], plan.shadow);
    }
    // ---- world1 ART_CATALOG painters (built from the same primitives) ----
    const band = (x, y, w, h, motif, c, s, d) => { rect(x, y, w, h, s); if (!Catalog) return;
      const m = Catalog.ORNAMENTS.includes(motif) ? motif : plan.motif || 'meander_field';
      for (let yy = 1; yy < h - 1; yy++) for (let xx = 0; xx < w; xx++) { const v = Catalog.field(m, xx, yy * 64 / h, 12); if (v) rect(x + xx, y + yy, 1, 1, v === 2 ? d : c); }
      line(x, y, x + w - 1, y, d); line(x, y + h - 1, x + w - 1, y + h - 1, 0); };
    function extraKind(p) {
      const { x, y, w, h, color: c, shade: s, detail: d, count, pattern } = p, cx = x + w / 2;
      switch (p.kind) {
        case 'pyramid_stepped': case 'ziggurat': { const n = Math.max(3, count + 2);
          for (let i = 0; i < n; i++) { const f = 1 - i / n, ww = w * f, hh = h / n; rect(cx - ww / 2, y + h - (i + 1) * hh, ww, hh + 1, i % 2 ? c : s);
            rect(cx + ww * .1, y + h - (i + 1) * hh, ww * .4, hh, s); line(cx - ww / 2, y + h - (i + 1) * hh, cx + ww / 2, y + h - (i + 1) * hh, d); }
          rect(cx - w * .05, y + h * .12, w * .1, h * .88, d); for (let yy = y + h * .14; yy < y + h; yy += 3) line(cx - w * .05, yy, cx + w * .05, yy, s);
          if (p.kind === 'ziggurat') rect(cx - w * .08, y, w * .16, h / n, c); break; }
        case 'pyramid_smooth': poly([[x, y + h], [cx, y], [x + w, y + h]], c, 0); poly([[cx, y], [x + w, y + h], [cx + w * .1, y + h]], s);
          for (let i = 1; i < 10; i++) { const f = i / 10; line(cx - w / 2 * f, y + h * f, cx + w * .1 * f, y + h * f, s); }
          rect(cx - 3, y + h * .62, 6, 8, 0); line(cx - 1, y, cx + 1, y + 3, d); break;
        case 'colonnade': for (let i = 0; i < Math.max(3, count + 2); i++) column(x + i * (w - 8) / Math.max(2, count + 1), y + 6, 8, h - 6, c, s, d); rect(x - 2, y, w + 4, 6, s); line(x - 2, y, x + w + 2, y, d); break;
        case 'cornice_band': case 'dado_band': case 'frieze_band': band(x, y, w, Math.max(4, h), plan.motif, c, s, d); break;
        case 'coffered_ceiling': for (let j = 0; j < 3; j++) for (let i = 0; i < Math.max(3, count + 2); i++) { const cw = w / Math.max(3, count + 2), ch = h / 3;
          rect(x + i * cw, y + j * ch, cw - 1, ch - 1, s); rect(x + i * cw + 2, y + j * ch + 2, cw - 5, ch - 5, c); rect(x + i * cw + cw / 2 - 1, y + j * ch + ch / 2 - 1, 2, 2, d); } break;
        case 'vault': case 'dome': for (let i = 0; i < 6; i++) ellipse(x + i * 2, y + i * 2, w - i * 4, h * 2 - i * 4, i % 2 ? c : s); rect(x, y + h, w, h, plan.sky === undefined ? s : 0); rect(x - 1, y + h - 2, w + 2, 3, d); break;
        case 'tracery_window': arch(x, y, w, h, c, s, d); rect(x + w * .15, y + h * .45, w * .7, h * .5, plan.light); line(cx, y + h * .2, cx, y + h, s);
          for (const [a, b] of [[.35, .3], [.65, .3], [.5, .18]]) ellipse(x + w * a - 3, y + h * b, 6, 6, plan.light); break;
        case 'lattice_screen': rect(x, y, w, h, s); for (let i = 0; i < w; i += 5) line(x + i, y, x + i, y + h - 1, c); for (let j = 0; j < h; j += 5) line(x, y + j, x + w - 1, y + j, c);
          for (let i = 0; i < w; i += 10) line(x + i, y, x + i + 10, y + h, d); break;
        case 'tiered_roof': for (let i = 0; i < Math.max(2, count); i++) { const f = 1 - i * .22, yy = y + h - (i + 1) * h / Math.max(2, count);
          poly([[cx - w / 2 * f - 4, yy + 6], [cx, yy - 4], [cx + w / 2 * f + 4, yy + 6], [cx + w / 2 * f, yy + 10], [cx - w / 2 * f, yy + 10]], c, s); rect(cx - w * f * .35, yy + 10, w * f * .7, h / Math.max(2, count) - 10, s); } break;
        case 'terrace_steps': for (let i = 0; i < count + 3; i++) { const yy = y + i * h / (count + 3); rect(x + i * 3, yy, w - i * 6, h / (count + 3) + 1, i % 2 ? c : s); line(x + i * 3, yy, x + w - i * 3, yy, d); } break;
        case 'aqueduct': for (let i = 0; i < Math.max(2, count); i++) arch(x + i * w / Math.max(2, count), y + h * .2, w / Math.max(2, count) + 1, h * .8, c, s, d); rect(x, y, w, h * .2, s); line(x, y + 2, x + w, y + 2, plan.accent); break;
        case 'guardian_beast': case 'sphinx_like': rect(x, y + h * .75, w, h * .25, s); poly([[x + w * .1, y + h * .75], [x + w * .2, y + h * .4], [x + w * .7, y + h * .4], [x + w * .9, y + h * .75]], c, s);
          poly([[x + w * .6, y + h * .45], [x + w * .65, y], [x + w * .9, y + h * .1], [x + w * .88, y + h * .45]], c, s); rect(x + w * .72, y + h * .12, 2, 2, d); break;
        case 'banner': rect(x, y, 2, h, s); poly([[x + 2, y + 2], [x + w, y + 2], [x + w, y + h * .8], [x + w / 2 + 1, y + h * .65], [x + 2, y + h * .8]], c, s); rect(x + w * .4, y + h * .25, w * .3, h * .2, d); break;
        case 'lantern': for (let i = 0; i < 14; i++) rect(cx - w + random() * w * 2, y + random() * h * 1.2, 1, 1, plan.light); line(cx, y, cx, y + h * .3, s); rect(x, y + h * .3, w, h * .6, s); rect(x + 1, y + h * .35, w - 2, h * .5, plan.light); break;
        case 'bookshelf': rect(x, y, w, h, s); for (let j = 0; j < Math.max(3, count); j++) { const yy = y + 2 + j * (h - 4) / Math.max(3, count), sh = (h - 4) / Math.max(3, count) - 2;
          for (let xx = x + 2; xx < x + w - 2; xx += 3) rect(xx, yy + (hash(xx + ':' + j) % 3), 2, sh - (hash(xx + ':' + j) % 3), [c, d, plan.accent][hash(j + ':' + xx) % 3]); line(x, yy + sh, x + w, yy + sh, 0); } break;
        case 'sarcophagus': case 'altar': rect(x, y + h * .3, w, h * .7, c); rect(x - 2, y + h * .2, w + 4, h * .15, s); band(x + 3, y + h * .45, w - 6, h * .3, plan.motif, s, c, d); break;
        case 'fountain': case 'well': ellipse(x, y + h * .6, w, h * .4, s); ellipse(x + 3, y + h * .62, w - 6, h * .28, plan.accent); rect(cx - 2, y + h * .1, 4, h * .55, c);
          if (p.kind === 'fountain') for (let i = 0; i < 12; i++) rect(cx - w * .3 + random() * w * .6, y + random() * h * .6, 1, 2, plan.light); else rect(x + 2, y, w - 4, 3, s); break;
        case 'gate': rect(x, y, w * .18, h, c); rect(x + w * .82, y, w * .18, h, c); rect(x, y, w, h * .15, s); for (let i = x + w * .2; i < x + w * .8; i += 4) line(i, y + h * .15, i, y + h, s); break;
        case 'canopy': case 'tent': poly([[x, y + h * .5], [cx, y], [x + w, y + h * .5]], c, s); for (let i = 0; i < 4; i++) line(x + i * w / 3, y + h * .5, x + i * w / 3, y + h, s); break;
        case 'dragon_skull': ellipse(x, y, w * .6, h * .6, c); poly([[x + w * .5, y + h * .2], [x + w, y + h * .45], [x + w * .5, y + h * .6]], c, s); rect(x + w * .2, y + h * .2, w * .12, h * .12, 0);
          for (let i = 0; i < 5; i++) line(x + w * (.55 + i * .08), y + h * .5, x + w * (.55 + i * .08), y + h * .62, d); line(x + w * .2, y, x - w * .1, y - h * .3, s); break;
        case 'bones': for (let i = 0; i < count * 3; i++) { const xx = x + random() * w, yy = y + random() * h; line(xx, yy, xx + 4 + random() * 6, yy + (random() - .5) * 4, i % 2 ? c : d); } break;
        case 'sandstorm': case 'fog_bank': for (let i = 0; i < 40 + count * 20; i++) { const yy = y + random() * h; rect(x + random() * w, yy, 4 + random() * 22, 1, i % 3 ? c : d); } break;
        case 'light_rays': for (let i = 0; i < count + 3; i++) { const xx = x + i * w / (count + 3); for (let yy = 0; yy < h; yy += 2) rect(xx + yy * .35, y + yy, 2, 1, i % 2 ? c : d); } break;
        case 'chasm': poly([[x, y], [x + w, y], [x + w * .8, y + h], [x + w * .2, y + h]], 0, s); for (let i = 0; i < 6; i++) line(x + w * .1 + i * w * .14, y, x + w * .25 + i * w * .1, y + h, s); break;
        case 'lava': rect(x, y, w, h, s); for (let i = 0; i < w * h / 12; i++) rect(x + random() * w, y + random() * h, 3, 1, i % 3 ? c : d); break;
        case 'waterfall': rect(x, y, w, h, s); for (let i = 0; i < w; i += 2) line(x + i, y, x + i, y + h, i % 4 ? c : d); ellipse(x - 4, y + h - 4, w + 8, 8, d); break;
        case 'palm': line(cx, y + h, cx + w * .1, y + h * .2, s); line(cx + 1, y + h, cx + w * .1 + 1, y + h * .2, s); for (let i = 0; i < 6; i++) { const a = Math.PI + i * Math.PI / 5; line(cx + w * .1, y + h * .2, cx + w * .1 + Math.cos(a) * w * .5, y + h * .2 + Math.sin(a) * -h * .15 + h * .1, c); } break;
        case 'cypress': ellipse(x, y, w, h, s); ellipse(x + 2, y + 2, w - 5, h - 4, c); line(cx, y + h * .2, cx, y + h, d); break;
        case 'balustrade': rect(x, y, w, 3, s); rect(x, y + h - 3, w, 3, s); for (let i = x + 2; i < x + w - 2; i += 5) { ellipse(i, y + 3, 4, h - 6, c); } break;
        case 'throne': rect(x + w * .1, y, w * .8, h * .6, s); rect(x, y + h * .5, w, h * .2, c); rect(x + w * .1, y + h * .7, w * .2, h * .3, c); rect(x + w * .7, y + h * .7, w * .2, h * .3, c); rect(cx - 3, y + h * .15, 6, 6, plan.accent); break;
        case 'scaffold': for (let i = 0; i <= count; i++) line(x + i * w / Math.max(1, count), y, x + i * w / Math.max(1, count), y + h, c); for (let j = 0; j < 4; j++) line(x, y + j * h / 4, x + w, y + j * h / 4, s); line(x, y, x + w, y + h, d); break;
        case 'campfire': for (let i = 0; i < 4; i++) line(x + i * w / 4, y + h, x + w - i * w / 4, y + h - 3, s); for (let i = 0; i < count + 4; i++) poly([[cx - w * .25 + random() * w * .5, y + h - 2], [cx + (random() - .5) * w * .3, y + random() * h * .6], [cx + w * .1, y + h - 2]], i % 2 ? c : d); break;
      }
    }
    const ditherTargetsOn = plan.dither && plan.dither.targets || [];
    const ditherBits = plan.dither && plan.dither.bits || 1;
    function lumaOf(col) { const [r, g, b] = rgbOf(col); return r * .3 + g * .59 + b * .11; }
    function lockHue(src, ref) {
      const A = rgbOf(src), B = rgbOf(ref);
      const lA = A[0] * .3 + A[1] * .59 + A[2] * .11;
      const lB = B[0] * .3 + B[1] * .59 + B[2] * .11;
      return hexFromRgb(B.map(v => lA + (v - lB)));
    }
    function punchHex(hex, sat, lift) {
      const rgb = rgbOf(hex), l = rgb[0] * .3 + rgb[1] * .59 + rgb[2] * .11;
      let r = (l + (rgb[0] - l) * sat) * lift, g = (l + (rgb[1] - l) * sat) * lift, b = (l + (rgb[2] - l) * sat) * lift;
      const mx = Math.max(r, g, b);
      if (mx > 255) { const k = 255 / mx; r *= k; g *= k; b *= k; }
      return hexFromRgb([r, g, b]);
    }
    function layerColors(p) {
      let c = p.color, s = p.shade, d = p.detail;
      const raw = p.material || plan.materials && plan.materials[p.kind], spec = raw ? parseMaterialSpec(raw) : null;
      let ramp = null;
      if (spec) {
        ramp = resolveRamp(spec, c);
        const steps = p.steps || spec.steps;
        if (steps && steps.length) {
          d = ramp[steps[0]] || d;
          c = ramp[steps[Math.floor((steps.length - 1) / 2)]] || c;
          s = ramp[steps[steps.length - 1]] || s;
        } else { d = ramp.highlight; c = ramp.mid; s = ramp.shadow; }
        if (lumaOf(c) < lumaOf(p.color)) c = p.color;
        if (lumaOf(d) < lumaOf(p.detail)) d = p.detail;
      }
      const hit = (plan.accents || []).find(a => accentKind(a.usage, p.kind));
      if (hit) d = punchHex(typeof hit.color === 'number' ? palette[hit.color] : hit.color, 1.4, 1.18);
      const depth = p.depth || 'mid';
      if (depth === 'far') {
        const haze = plan.sky;
        c = mixHex(c, haze, .12); s = mixHex(s, haze, .08); d = mixHex(d, plan.light, .06);
      } else if (depth === 'foreground') {
        d = punchHex(d, 1.06, 1.06); s = lumaOf(s) > 40 ? mixHex(s, '#000000', .1) : s;
      }
      if (['dunes', 'road', 'sandstorm'].includes(p.kind) || raw === 'sand') {
        c = lockHue(c, p.color); s = lockHue(s, p.shade); d = lockHue(d, p.detail);
      }
      return { c, s, d, ramp };
    }
    function drawStamp(type, x, y, c, s, large) {
      const cells = large && STAMPS16[type] || STAMPS8[type];
      if (!cells) return;
      for (let j = 0; j < cells.length; j++) for (let i = 0; i < cells[j].length; i++) {
        const ch = cells[j][i];
        if (ch !== '.') rect(x + i, y + j, 1, 1, ch === '+' ? s : c);
      }
    }
    function ditherWaterLayer(p, c, s, d) {
      const bits = ditherBits, cols = bits === 2 ? [d, c, mixHex(c, s, .4), s] : [c, d];
      const inside = (px, py) => {
        if (p.kind === 'pool') {
          const cx = p.x + p.w / 2, cy = p.y + p.h / 2, dx = (px + .5 - cx) / (p.w / 2), dy = (py + .5 - cy) / (p.h / 2);
          return dx * dx + dy * dy <= 1;
        }
        const f = (py - p.y) / Math.max(1, p.h), cx = p.x + p.w * (.5 + f * .05), half = p.w * (.08 + f * .42);
        return py >= p.y && py < p.y + p.h && Math.abs(px - cx) <= half;
      };
      const x0 = Math.max(0, p.x | 0), y0 = Math.max(0, p.y | 0), x1 = Math.min(width, (p.x + p.w) | 0), y1 = Math.min(height, (p.y + p.h) | 0);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        if (!inside(xx, yy)) continue;
        const t = BAYER4[yy & 3][xx & 3];
        rect(xx, yy, 1, 1, cols[bits === 2 ? (t >> 2) : (t >= 8 ? 1 : 0)]);
      }
    }
    let snapshot = null;
    const outlineAt = (x, y) => {
      if (!snapshot || x < 0 || y < 0 || x >= width || y >= height) return false;
      const k = (Math.round(y) * width + Math.round(x)) * 4, d = snapshot.data;
      return d[k] + d[k + 1] + d[k + 2] <= 24;
    };
    const safeRect = (x, y, w, h, c) => {
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(width, Math.round(x + w)), y1 = Math.min(height, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (!outlineAt(xx, yy)) rect(xx, yy, 1, 1, c);
    };
    const prevDrawStamp = drawStamp;
    drawStamp = (type, x, y, c, s, large) => {
      const cells = large && STAMPS16[type] || STAMPS8[type];
      if (!cells) return;
      for (let j = 0; j < cells.length; j++) for (let i = 0; i < cells[j].length; i++) {
        const ch = cells[j][i];
        if (ch !== '.' && !outlineAt(x + i, y + j)) rect(x + i, y + j, 1, 1, ch === '+' ? s : c);
      }
    };
    function applyDetails(band) {
      if (!plan.detailLevel && !plan.details && !plan.layers.some(p => p.variant)) return;
      snapshot = ctx.getImageData ? ctx.getImageData(0, 0, width, height) : null;
      const density = plan.detailLevel ? ({ sparse: .4, moderate: .75, rich: 1 }[plan.detailLevel]) : 1;
      const inBand = depth => !band || (depth || 'mid') === band;
      const rnd = key => { let state = hash('detail:' + key + ':' + seed) >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; };
      if (plan.details) {
        const cap = plan.detailLevel === 'sparse' ? 4 : plan.detailLevel === 'moderate' ? 8 : 12;
        const list = plan.details.filter(d => inBand(d.depth));
        const n = list.length ? Math.min(cap, Math.max(1, Math.round(list.length * density))) : 0;
        for (const item of list.slice(0, n)) drawStamp(item.type, item.x, item.y, plan.stone, plan.shadow, (item.w || 8) >= 12 || item.variant === 'large');
      }
      for (const p of plan.layers) {
        if (!inBand(p.depth)) continue;
        const auto = [];
        if (plan.detailLevel) {
          if (['wall', 'pillar', 'portico', 'tower', 'citadel', 'building', 'arch'].includes(p.kind) && plan.detailLevel === 'rich') auto.push('cracks');
          if ((p.kind === 'mountain' || p.kind === 'ridge') && plan.detailLevel !== 'sparse') auto.push('ridges');
        }
        const used = [...new Set([].concat(p.variant || [], auto))];
        if (!used.length) continue;
        const { c, s, d, ramp } = layerColors(p);
        const r = rnd(p.kind + ':' + p.x + ',' + p.y), deep = ramp && ramp.deepShadow || s, hi = ramp && ramp.highlight || d, mid = ramp && ramp.shade || mixHex(c, s, .4);
        for (const v of used) {
          if (v === 'cracks' || v === 'erosion') {
            const count = v === 'erosion' ? (plan.detailLevel === 'rich' ? 3 : 2) : (plan.detailLevel === 'rich' ? 3 : 1);
            for (let i = 0; i < count; i++) drawStamp('crack', p.x + Math.floor(r() * Math.max(1, p.w - 8)), p.y + Math.floor(r() * Math.max(1, p.h - 8)), s, deep, plan.detailLevel === 'rich' && r() > .8);
          }
          if (v === 'weathering') {
            for (let i = 0, n = plan.detailLevel === 'rich' ? 8 : 4; i < n; i++) {
              const xx = p.x + 2 + r() * Math.max(1, p.w - 4), yy = p.y + 2 + r() * Math.max(1, p.h - 4);
              if (!outlineAt(xx, yy)) safeRect(xx, yy, 1, 1, r() > .5 ? s : mid);
            }
          }
          if (v === 'base' && (p.kind === 'pillar' || p.kind === 'portico')) { rect(p.x - 3, p.y + p.h - 6, p.w + 6, 6, s); rect(p.x - 2, p.y + p.h - 5, p.w + 4, 1, hi); }
          if (v === 'capital' && (p.kind === 'pillar' || p.kind === 'portico')) { rect(p.x - 3, p.y, p.w + 6, 5, s); rect(p.x - 2, p.y + 1, p.w + 4, 1, hi); rect(p.x + 1, p.y + 5, p.w - 2, 2, c); }
          if (v === 'fluting' && p.kind === 'pillar') for (let f = p.x + 6; f < p.x + p.w - 3; f += 4) line(f + 2, p.y + 7, f + 2, p.y + p.h - 6, mid);
          if (v === 'snowcap' && !richerDraw && (p.kind === 'mountain' || p.kind === 'ridge')) {
            const peakX = p.x + p.w * .5, peakY = p.y + p.h * .08;
            poly([[peakX - p.w * .12, p.y + p.h * .32], [peakX, peakY], [peakX + p.w * .1, p.y + p.h * .3]], hi);
            poly([[peakX - p.w * .06, p.y + p.h * .28], [peakX, peakY + 2], [peakX + p.w * .08, p.y + p.h * .26]], d);
          }
          if ((v === 'scree' || v === 'ridges' || v === 'jagged' || v === 'pinnacle') && (p.kind === 'mountain' || p.kind === 'ridge')) {
            if (v === 'scree') for (let i = 0, n = plan.detailLevel === 'rich' ? 8 : 4; i < n; i++) { const xx = p.x + r() * p.w, yy = p.y + p.h * (.7 + r() * .28); if (!outlineAt(xx, yy)) safeRect(xx, yy, 1 + r() * 3, 1, r() > .5 ? s : mid); }
            if (v === 'ridges' || v === 'jagged') for (let i = 1; i <= 2; i++) line(p.x + p.w * (0.3 + i * 0.15), p.y + p.h * .2, p.x + p.w * (.35 + i * .15), p.y + p.h, deep);
            if (v === 'pinnacle') line(p.x + p.w / 2, p.y, p.x + p.w / 2 + 1, p.y + p.h * .45, deep);
          }
          if ((v === 'stones' || v === 'moss') && ['wall', 'building', 'tower', 'citadel'].includes(p.kind)) {
            if (v === 'stones') {
              for (let i = 0, n = plan.detailLevel === 'rich' ? 6 : 3; i < n; i++) {
                const xx = p.x + 2 + r() * Math.max(1, p.w - 10), yy = p.y + 2 + r() * Math.max(1, p.h - 6);
                if (!outlineAt(xx, yy)) safeRect(xx, yy, 6, 3, r() > .5 ? mid : s);
              }
            }
            if (v === 'moss') {
              const mossC = (plan.accents || []).find(a => a.usage === 'vegetation')?.color || plan.accent;
              for (let i = 0, n = plan.detailLevel === 'rich' ? 6 : 3; i < n; i++) {
                const xx = p.x + r() * p.w, yy = p.y + p.h * (.72 + r() * .25);
                if (!outlineAt(xx, yy)) safeRect(xx, yy, 2, 1, mossC);
              }
            }
          }
          if ((v === 'dense' || v === 'wisp') && p.kind === 'cloud') {
            const n = v === 'dense' ? 10 : 5;
            for (let i = 0; i < n; i++) if (!outlineAt(p.x + r() * p.w, p.y + r() * p.h)) safeRect(p.x + r() * p.w, p.y + r() * p.h, 2, 1, v === 'dense' ? d : hi);
          }
        }
      }
      if (plan.detailLevel === 'rich' && inBand('mid')) {
        const r = rnd('ground');
        for (let i = 0; i < 2; i++) drawStamp('gravel', 8 + Math.floor(r() * 40) + i * 250, plan.horizon + 16 + Math.floor(r() * 20), plan.shadow, plan.stone, false);
      }
    }
    const richerDraw = !!(plan.detailLevel || plan.materials || plan.accents || plan.details || plan.dither
      || plan.layout || plan.layers.some(q => q.material || q.variant || q.depth || q.steps || q.parts || q.role || q.assembly || Grammar.isLibraryKind(q.kind)));
    const sunLayer = plan.layers.find(q => q.kind === 'sun' || q.kind === 'moon');
    const lightAt = sunLayer
      ? { x: sunLayer.x + sunLayer.w / 2, y: sunLayer.y + sunLayer.h / 2 }
      : ({ golden_hour: [300, plan.horizon], moonlit: [60, 20], shaft_from_above: [160, 8], chandelier_glow: [160, 24],
          candle_pools: [80, 150], twin_braziers: [60, 140], torch_flicker: [50, 100], lamp_reading: [120, 110],
          crystal_glow: [160, 140], backlit_silhouette: [160, plan.horizon] }[plan.lighting] || [90, 28]);
    if (Array.isArray(lightAt)) { lightAt.x = lightAt[0]; lightAt.y = lightAt[1]; }
    const litLeft = cx => lightAt.x <= cx;
    function columnRich(x, y, w, h, c, s, d) {
      const litL = litLeft(x + w / 2);
      const capH = Math.max(3, Math.round(Math.min(8, h * .08 + w * .25)));
      const baseH = Math.max(3, Math.round(Math.min(8, h * .07 + w * .22)));
      const shaftY = y + capH, shaftH = Math.max(4, h - capH - baseH);
      rect(x - 3, y, w + 6, capH, 0);
      rect(x - 2, y + 1, w + 4, capH - 2, c);
      rect(litL ? x - 2 : x + w, y + 1, Math.max(2, Math.round(w * .28)), capH - 2, d);
      rect(litL ? x + w - 1 : x - 2, y + 1, Math.max(2, Math.round(w * .2)), capH - 2, s);
      line(x - 3, y, x + w + 2, y, d);
      rect(x - 1, y + capH - 2, w + 2, 2, mixHex(c, d, .35));
      for (let i = 0; i < shaftH; i++) {
        const t = i / Math.max(1, shaftH - 1), mid = .62;
        const wf = t < mid ? .86 + .14 * (t / mid) : 1 - .08 * ((t - mid) / (1 - mid));
        const ww = Math.max(3, Math.round(w * wf)), xx = Math.round(x + (w - ww) / 2), yy = shaftY + i;
        rect(xx, yy, 1, 1, 0); rect(xx + ww - 1, yy, 1, 1, 0);
        rect(xx + 1, yy, ww - 2, 1, c);
        const edge = Math.max(1, Math.round(ww * .22));
        if (litL) { rect(xx + 1, yy, edge, 1, d); rect(xx + ww - 1 - edge, yy, edge, 1, s); }
        else { rect(xx + ww - 1 - edge, yy, edge, 1, d); rect(xx + 1, yy, edge, 1, s); }
      }
      if (w > 7) for (let f = x + 4; f < x + w - 3; f += 4) line(f, shaftY + 2, f, shaftY + shaftH - 2, s);
      rect(x - 3, y + h - baseH, w + 6, baseH, 0);
      rect(x - 2, y + h - baseH + 1, w + 4, baseH - 2, c);
      rect(litL ? x - 2 : x + w, y + h - baseH + 1, Math.max(2, Math.round(w * .28)), baseH - 2, d);
      line(x - 3, y + h - 1, x + w + 2, y + h - 1, s);
    }
    function mountainRich(x, y, w, h, c, s, d, count, variants) {
      const n = Math.max(1, Math.min(count || 1, 6));
      const litL = litLeft(x + w / 2);
      const vars = [].concat(variants || []);
      const snow = vars.includes('snowcap');
      const ridges = vars.includes('ridges');
      const pyramid = h / Math.max(1, w) <= 0.62 && n <= 4;
      for (let i = 0; i < n; i++) {
        const span = w / Math.max(1, n) * (pyramid ? 1.22 : 1.65);
        const xx = x + (i - (pyramid ? 0.06 : 0.25)) * w / n;
        const peakT = pyramid ? 0.46 + (hash('pt' + i + x) % 9) / 100 : 0.35 + (hash('pt' + i + x) % 30) / 100;
        const peak = xx + span * peakT;
        const drop = (hash('pk' + i + x) % (pyramid ? 10 : 25)) / 100;
        const edge = Math.abs(i - (n - 1) / 2) / Math.max(1, n / 2);
        const yy = y + h * (drop + edge * (pyramid ? 0.05 : 0.12));
        const baseY = y + h;
        const body = Grammar.midShadow(c, s, mixHex, lumaOf);
        poly([[xx, baseY], [peak, yy], [xx + span, baseY]], body, mixHex(s, '#000000', .4));
        const litW = Math.max(3, span * (pyramid ? 0.28 : 0.16));
        if (litL) poly([[peak - litW, baseY], [peak, yy], [peak + 1, baseY]], c);
        else poly([[peak - 1, baseY], [peak, yy], [peak + litW, baseY]], c);
        const dir = litL ? -1 : 1;
        if (pyramid) line(peak, yy, peak + dir * 2, yy + h * 0.3, d);
        else poly([[peak, yy], [peak + dir * span * .15, yy + h * .32], [peak + dir * span * .03, yy + h * .25], [peak - dir * span * .05, yy + h * .44], [peak - dir * span * .12, yy + h * .22]], d);
        if (ridges) {
          for (let k = 1; k <= 2; k++) {
            const t = 0.28 * k, fy = yy + (baseY - yy) * t;
            line(peak + (xx - peak) * t + 1, fy, peak + (xx + span - peak) * t - 1, fy, mixHex(c, s, .45));
          }
        }
        const hatches = Math.min(pyramid ? 8 : 14, Math.floor(span * h / (pyramid ? 120 : 80)));
        for (let j = 0; j < hatches; j++) {
          const f = 0.2 + (hash('h' + i + j + x) % 65) / 100;
          const px = Math.round(peak + dir * (2 + (hash('hx' + i + j) % 8)));
          const py = yy + f * (baseY - yy);
          line(px, py, px + 2, Math.min(baseY - 1, py + 3), j % 3 ? mixHex(c, s, .4) : d);
        }
        if (snow) {
          const sh = h * (pyramid ? 0.07 : 0.14);
          poly([[peak - span * .06, yy + sh], [peak, yy], [peak + span * .05, yy + sh * .85]], d);
        }
      }
    }
    function buildingRich(x, y, w, h, c, s, d, count, light) {
      const litL = litLeft(x + w / 2), eaves = y + h * .32, peakX = x + w * .45, bodyH = y + h - eaves;
      poly([[x - 3, eaves], [peakX, y], [x + w + 3, eaves]], s, 0);
      if (litL) poly([[x - 3, eaves], [peakX, y], [peakX, eaves]], mixHex(c, d, .55));
      else poly([[peakX, y], [x + w + 3, eaves], [peakX, eaves]], mixHex(c, d, .55));
      line(x - 3, eaves, peakX, y, 0); line(peakX, y, x + w + 3, eaves, 0);
      rect(x, eaves, w, bodyH, 0);
      rect(x + 1, eaves + 1, w - 2, bodyH - 2, c);
      const band = Math.max(2, Math.round(w * .18));
      rect(litL ? x + 1 : x + w - 1 - band, eaves + 1, band, bodyH - 2, mixHex(c, d, .4));
      rect(litL ? x + w - 1 - band : x + 1, eaves + 1, band, bodyH - 2, s);
      const dw = Math.max(3, Math.round(w * .2)), dh = Math.max(7, Math.round(h * .34));
      const dx = Math.round(x + w / 2 - dw / 2), dy = y + h - dh;
      rect(dx, dy, dw, dh, 0); rect(dx + 1, dy + 1, dw - 2, dh - 2, s);
      const nw = Math.min(3, Math.max(1, count));
      for (let i = 1; i <= nw; i++) {
        const wx = Math.round(x + i * w / (nw + 1) - 2), wy = Math.round(eaves + bodyH * .16);
        if (wx + 4 > dx && wx < dx + dw) continue;
        rect(wx, wy, 4, 5, 0); rect(wx + 1, wy + 1, 2, 3, d);
      }
      line(x, y + h - 1, x + w, y + h - 1, 0);
    }
    function roadRich(x, y, w, h, c, s, d) {
      const farL = x + w * .46, farR = x + w * .54;
      poly([[farL, y], [farR, y], [x + w, y + h], [x, y + h]], c, s);
      for (let i = 0; i < 3; i++) {
        const f = .78 + i * .06;
        rect(x + w / 2 + (i % 2 ? 1 : -1) * w * .16 * f, y + f * h, 2 + f * 2, 1, s);
      }
    }
    function ridgeRich(x, y, w, h, c, s, d, count, hang) {
      const n = (count || 1) + 2, litL = litLeft(x + w / 2);
      const pts = [[x, y + h]];
      for (let i = 0; i <= n; i++) pts.push([x + i * w / n, hang ? y + h - random() * h * .6 : y + random() * h * .6]);
      pts.push([x + w, y + h]);
      poly(pts, c, s);
      for (let i = 1; i + 1 < pts.length; i++) {
        const face = (pts[i][0] < x + w / 2) === litL ? d : s;
        line(...pts[i], pts[i][0] + w * .06, hang ? y : y + h, i % 2 ? s : face);
      }
    }
    function obeliskRich(x, y, w, h, c, s, d) {
      const litL = litLeft(x + w / 2), mid = x + w / 2;
      poly([[x, y + h], [x + w * .2, y + h * .14], [mid, y], [x + w * .8, y + h * .14], [x + w, y + h]], c, 0);
      if (litL) {
        poly([[x, y + h], [x + w * .2, y + h * .14], [mid, y], [mid, y + h]], mixHex(c, d, .45));
        poly([[mid, y], [x + w * .8, y + h * .14], [x + w, y + h], [mid, y + h]], s);
      } else {
        poly([[mid, y], [x + w * .8, y + h * .14], [x + w, y + h], [mid, y + h]], mixHex(c, d, .45));
        poly([[x, y + h], [x + w * .2, y + h * .14], [mid, y], [mid, y + h]], s);
      }
      line(mid, y, mid, y + h, 0);
      for (let i = 1; i <= 3; i++) rect(x + w * .35, y + h * i / 5, 2, 2, d);
    }
    function porticoRich(x, y, w, h, c, s, d, count) {
      const top = h * .27, litL = litLeft(x + w / 2), cw = Math.max(5, w / (Math.max(2, count) * 3));
      poly([[x - 2, y + top], [x + w / 2, y], [x + w + 2, y + top]], litL ? c : s, 0);
      poly([[x + w / 2, y], [x + w + 2, y + top], [x + w / 2, y + top]], litL ? s : c);
      line(x - 2, y + top, x + w / 2, y, 0); line(x + w / 2, y, x + w + 2, y + top, 0);
      line(x + 5, y + top - 2, x + w - 5, y + top - 2, d);
      rect(x, y + top, w, 5, s); rect(x, y + top, w, 1, d);
      const n = Math.max(2, count);
      for (let i = 0; i < n; i++) columnRich(x + i * (w - cw) / (n - 1), y + top + 5, cw, h - top - 9, c, s, d);
      rect(x - 3, y + h - 4, w + 6, 4, s); rect(x - 3, y + h - 4, w + 6, 1, d);
    }
    function paintLayer(p) {
      const { x, y, w, h, count, pattern } = p;
      const { c, s, d } = layerColors(p);
      if (richerDraw && Grammar.shouldPaint(p, richerDraw, allKinds)) {
        Grammar.paintScenery(p, { c, s, d, accent: plan.accent, light: plan.light, foliage: ((plan.accents || []).find(a => a.usage === 'vegetation') || {}).color || mixHex(plan.accent || d, '#3a7a38', .45), lighting: plan.lighting }, { rect, line, poly, ellipse, mixHex, lumaOf, hash, litLeft, ctx, width, height });
        return;
      }
      if (richerDraw) {
        if (p.kind === 'pillar') { columnRich(x, y, w, h, c, s, d); return; }
        if (p.kind === 'mountain') {
          for (let i = 0; i < count; i++) {
            const span = w / Math.max(1, count) * 1.65;
            random(); random();
            for (let j = 0; j < span * h / 20; j++) { random(); random(); random(); }
          }
          mountainRich(x, y, w, h, c, s, d, count, p.variant); return;
        }
        if (p.kind === 'building') { buildingRich(x, y, w, h, c, s, d, count); return; }
        if (p.kind === 'road') {
          for (let i = 0; i < count * 8; i++) { random(); random(); }
          roadRich(x, y, w, h, c, s, d); return;
        }
        if (p.kind === 'ridge' || p.kind === 'stalactite') { ridgeRich(x, y, w, h, c, s, d, count, p.kind === 'stalactite'); return; }
        if (p.kind === 'obelisk') { obeliskRich(x, y, w, h, c, s, d); return; }
        if (p.kind === 'portico') { porticoRich(x, y, w, h, c, s, d, count); return; }
      }
      if (flag('ARCHITECTURE_EXPANSION') && Expansion?.has(p.kind)) {
        Expansion.paint(ctx,p.kind,x,y,w,h,[typeof c==='number'?palette[c]:c,typeof s==='number'?palette[s]:s,typeof d==='number'?palette[d]:d]);
        return;
      }
      switch (p.kind) {
        case 'cloud': {
          const lobes = [];
          for (let i = 0; i < count + 3; i++) lobes.push({ x: x + i * w / (count + 3) - w / (count + 3),
            y: y + h * (.15 + random() * .35), w: w / (count + 3) * (1.8 + random()), h: h * (.5 + random() * .35) });
          for (const l of lobes) {
            ellipse(l.x, l.y, l.w, l.h, s);
            ellipse(l.x, l.y, l.w * .84, l.h * .76, c);
            ellipse(l.x + l.w * .08, l.y + 1, l.w * .55, l.h * .39, mix(c, d, .5));
            for (let i = 0; i < l.w * l.h / 18; i++) {
              const xx = random(), yy = random(), dx = (xx - .5) * 2, dy = (yy - .5) * 2;
              if (dx * dx + dy * dy < 1 && yy > .45) rect(l.x + xx * l.w, l.y + yy * l.h, 1, 1, random() > yy ? c : mix(c, s, .55));
            }
          } break;
        }
        case 'mountain': {
          for (let i = 0; i < count; i++) {
            const span = w / Math.max(1, count) * 1.65, xx = x + (i - .25) * w / count, peak = xx + span * (.35 + random() * .3), yy = y + random() * h * .25;
            poly([[xx, y + h], [peak, yy], [xx + span, y + h]], s, 0);
            poly([[xx, y + h], [peak, yy], [peak + span * .04, y + h]], c);
            poly([[peak, yy], [peak - span * .15, yy + h * .32], [peak - span * .03, yy + h * .25], [peak + span * .05, yy + h * .44], [peak + span * .12, yy + h * .22]], d);
            for (let j = 0; j < span * h / 20; j++) {
              const f = .15 + random() * .82, left = peak + (xx - peak) * f, right = peak + span * .04;
              const px = left + random() * Math.max(1, right - left), py = yy + f * (y + h - yy);
              line(px, py, px + 2, Math.min(y + h, py + 3 + random() * 6), j % 4 ? mix(c, s, .4) : d);
            }
          } break;
        }
        case 'dunes': {
          for (let band = 0; band < count + 2; band++) {
            const yy = y + band * h / (count + 2), amp = 2 + band * 1.5, phase = random() * Math.PI * 2;
            const points = [[x, y + h]];
            for (let xx = 0; xx <= w; xx += 3) points.push([x + xx, yy + Math.sin(xx / Math.max(12, w / 5) + phase) * amp]);
            points.push([x + w, y + h]); poly(points, band % 2 ? c : mix(c, s, .22));
            for (let xx = 0; xx < w; xx++) { const ridge = yy + Math.sin(xx / Math.max(12, w / 5) + phase) * amp;
              rect(x + xx, ridge, 1, 1, d);
              if (xx % 3 === 0) rect(x + xx, ridge + 2 + random() * (band + 2), 1, 1, mix(c, s, .5));
            }
          } break;
        }
        case 'tower': tower(x, y, w, h, c, s, d, count); break;
        case 'citadel': {
          for (let i = 0; i < Math.max(3, count); i++) {
            const n = Math.max(3, count), ww = w / (n + 1), xx = x + i * (w - ww) / (n - 1), hh = h * (.6 + .35 * (1 - Math.abs(i - (n - 1) / 2) / (n / 2)));
            tower(xx, y + h - hh, ww, hh, c, s, d, 4);
          }
          rect(x - 3, y + h * .73, w + 6, h * .27, s);
          for (let i = 0; i < Math.max(3, count); i++) arch(x + i * w / Math.max(3, count) + 2, y + h * .76, w / Math.max(3, count) - 4, h * .21, c, 0, d);
          line(x - 3, y + h * .73, x + w + 2, y + h * .73, d); break;
        }
        case 'road':
          poly([[x + w * .46, y], [x + w * .54, y], [x + w, y + h], [x, y + h]], c, s);
          for (let i = 0; i < count * 8; i++) { const f = random(); rect(x + w / 2 + (random() - .5) * w * f, y + f * h, 1 + f * 5, 1, i % 2 ? s : d); } break;
        case 'stars':
          for (let i = 0; i < count * 8; i++) { const xx = x + random() * w, yy = y + random() * h; rect(xx, yy, 1, 1, i % 3 ? c : d); if (i % 17 === 0) { line(xx - 2, yy, xx + 2, yy, d); line(xx, yy - 2, xx, yy + 2, d); } } break;
        case 'wall':
          rect(x, y, w, h, 0); rect(x + 1, y + 1, w - 2, h - 2, c);
          texture(x + 2, y + 2, w - 4, h - 4, pattern, s, d);
          line(x, y, x + w - 1, y, d); line(x, y + h - 1, x + w - 1, y + h - 1, s); break;
        case 'pillar': column(x, y, w, h, c, s, d); break;
        case 'arch': arch(x, y, w, h, c, s, d); break;
        case 'portico': {
          const top = h * .27, cw = Math.max(4, w / (Math.max(2, count) * 3));
          poly([[x - 2, y + top], [x + w / 2, y], [x + w + 2, y + top]], c, 0);
          poly([[x + 5, y + top - 3], [x + w / 2, y + 6], [x + w - 5, y + top - 3]], s);
          line(x + 5, y + top - 2, x + w - 5, y + top - 2, d);
          rect(x, y + top, w, 5, s); rect(x, y + top, w, 1, d);
          for (let i = 0; i < Math.max(2, count); i++) column(x + i * (w - cw) / (Math.max(2, count) - 1), y + top + 5, cw, h - top - 9, c, s, d);
          rect(x - 3, y + h - 4, w + 6, 4, s); rect(x - 3, y + h - 4, w + 6, 1, d); break;
        }
        case 'door':
          rect(x, y, w, h, s); arch(x - 2, y - 3, w + 4, h + 3, c, 0, d);
          for (let i = 3; i < w - 2; i += 4) line(x + i, y + 4, x + i, y + h - 1, c);
          rect(x + w * .72, y + h * .6, 2, 2, d); break;
        case 'building':
          rect(x, y + h * .32, w, h * .68, c);
          texture(x + 1, y + h * .34, w - 2, h * .64, pattern, s, d);
          poly([[x - 2, y + h * .35], [x + w * .4, y], [x + w + 2, y + h * .35]], s, 0);
          rect(x + w * .4, y + h * .6, w * .2, h * .4, 0);
          for (let i = 1; i <= Math.min(4, count); i++) { const xx = x + i * w / (Math.min(4, count) + 1); rect(xx - 1, y + h * .43, 4, 6, 0); rect(xx, y + h * .44, 2, 3, d); }
          line(x, y + h - 1, x + w, y + h - 1, 0); break;
        case 'bridge':
          for (let i = 0; i < count; i++) arch(x + i * w / count, y + h * .25, w / count + 1, h * .75, c, s, d);
          rect(x, y, w, h * .23, c); texture(x, y, w, h * .22, pattern, s, d); line(x, y, x + w, y, d); break;
        case 'stairs':
          for (let i = 0; i < count + 2; i++) { const f = (i + 1) / (count + 2); rect(x + w * (1 - f) / 2, y + h * i / (count + 2), w * f, h / (count + 2) + 1, i % 2 ? c : s); line(x + w * (1 - f) / 2, y + h * i / (count + 2), x + w * (1 + f) / 2, y + h * i / (count + 2), d); } break;
        case 'ridge':
        case 'stalactite': {
          const pts = [[x, y + h]];
          for (let i = 0; i <= count + 2; i++) pts.push([x + i * w / (count + 2), y + random() * h * .6]);
          pts.push([x + w, y + h]);
          if (p.kind === 'stalactite') for (const pt of pts) pt[1] = y + h - (pt[1] - y);
          poly(pts, c, s);
          for (let i = 1; i + 1 < pts.length; i++) line(...pts[i], pts[i][0] + w * .06, p.kind === 'ridge' ? y + h : y, i % 2 ? s : d); break;
        }
        case 'tree':
        case 'roots': {
          const cx = x + w / 2;
          poly([[cx - w * .1, y + h], [cx - w * .05, y + h * .25], [cx + w * .08, y + h * .2], [cx + w * .12, y + h]], s, 0);
          line(cx, y + h * .3, cx + 1, y + h, d);
          for (let i = 0; i < count + 2; i++) { const f = i / (count + 2), xx = x + (i % 2 ? .8 : .15) * w, yy = y + h * (.1 + f * .65);
            line(cx, y + h * (.55 + f * .25), xx, yy, s);
            if (p.kind === 'tree') { ellipse(xx - w * .19, yy - h * .09, w * .4, h * .28, c); texture(xx - w * .13, yy, w * .23, h * .12, 'stipple', s, d); }
          } break;
        }
        case 'pool':
          ellipse(x - 2, y - 1, w + 4, h + 3, 0); ellipse(x, y, w, h, s); ellipse(x + 2, y + 1, w - 4, h - 3, c);
          for (let i = 0; i < 18; i++) { const yy = y + h * (.25 + random() * .5); rect(x + w * .22 + random() * w * .45, yy, 2 + random() * w * .1, 1, d); } break;
        case 'river':
          poly([[x + w * .45, y], [x + w * .55, y], [x + w * .65, y + h * .45], [x + w, y + h], [x, y + h], [x + w * .35, y + h * .5]], c, s);
          for (let i = 0; i < 20; i++) { const f = random(); rect(x + w / 2 + (random() - .5) * w * f, y + f * h, 2 + f * 8, 1, d); } break;
        case 'crystal':
          for (let i = 0; i < count; i++) { const ww = w / Math.max(2, count), xx = x + i * (w - ww) / Math.max(1, count - 1), hh = h * (.6 + random() * .4);
            poly([[xx, y + h], [xx + 1, y + h - hh + 5], [xx + ww * .5, y + h - hh], [xx + ww, y + h - hh + 6], [xx + ww, y + h]], c, 0);
            poly([[xx + ww * .5, y + h - hh], [xx + ww, y + h - hh + 6], [xx + ww, y + h], [xx + ww * .5, y + h]], s);
            line(xx + 2, y + h - hh + 6, xx + ww * .5, y + h - hh + 2, d);
          } break;
        case 'statue':
          rect(x + w * .1, y + h * .86, w * .8, h * .14, s); line(x + w * .1, y + h * .86, x + w * .9, y + h * .86, d);
          ellipse(x + w * .35, y, w * .3, h * .19, c);
          poly([[x + w * .35, y + h * .18], [x + w * .63, y + h * .18], [x + w * .85, y + h * .83], [x + w * .15, y + h * .83]], c, s);
          for (let i = 2; i < 7; i++) line(x + w * .5, y + h * .3, x + w * i / 8, y + h * .8, s);
          line(x + w * .4, y + h * .22, x + w * .3, y + h * .8, d); break;
        case 'grave':
          rect(x, y + h * .86, w, h * .14, s); rect(x + w * .2, y + h * .2, w * .6, h * .7, c);
          ellipse(x + w * .2, y, w * .6, h * .4, c);
          for (let i = 0; i < 3; i++) rect(x + w * .32, y + h * (.4 + i * .1), w * .35, 1, s); break;
        case 'obelisk':
          poly([[x, y + h], [x + w * .2, y + h * .14], [x + w / 2, y], [x + w * .8, y + h * .14], [x + w, y + h]], c, 0);
          poly([[x + w / 2, y], [x + w * .8, y + h * .14], [x + w, y + h], [x + w / 2, y + h]], s);
          for (let i = 1; i <= count + 2; i++) rect(x + w * .35, y + h * i / (count + 4), 2, 2, d); break;
        case 'brazier':
          rect(x + w * .4, y + h * .5, w * .2, h * .5, s);
          poly([[x, y + h * .4], [x + w, y + h * .4], [x + w * .7, y + h * .65], [x + w * .3, y + h * .65]], s, 0);
          for (let i = 0; i < count + 2; i++) { const xx = x + w * (.1 + random() * .65); poly([[xx, y + h * .45], [xx + 2, y + random() * h * .3], [xx + w * .2, y + h * .45]], c); }
          rect(x + w * .4, y + h * .25, w * .2, h * .2, d); break;
        case 'fresco':
        case 'mosaic':
          rect(x, y, w, h, s); rect(x + 2, y + 2, w - 4, h - 4, c);
          for (let i = 1; i <= count; i++) { const xx = x + i * w / (count + 1); ellipse(xx - 2, y + h * .22, 4, 4, d); poly([[xx - 2, y + h * .4], [xx + 2, y + h * .4], [xx + 5, y + h * .8], [xx - 5, y + h * .8]], d, s); }
          if (p.kind === 'mosaic') for (let xx = x + 2; xx < x + w - 2; xx += 3) for (let yy = y + 2; yy < y + h - 2; yy += 3) rect(xx, yy, 1, 1, s); break;
        case 'sun': case 'moon': ellipse(x, y, w, h, c); if (p.kind === 'moon') ellipse(x + w * .3, y - 1, w, h, s); break;
        case 'mist':
          for (let i = 0; i < count + 3; i++) rect(x + random() * w * .25, y + random() * h, w * (.5 + random() * .5), 1, i % 2 ? c : d); break;
        case 'grass':
          for (let i = 0; i < count * 8; i++) { const xx = x + random() * w, yy = y + random() * h; line(xx, yy, xx + (random() - .5) * 5, yy - 2 - random() * 4, i % 3 ? c : d); } break;
        case 'rubble':
          for (let i = 0; i < count * 3; i++) { const xx = x + random() * w, yy = y + random() * h, ww = 2 + random() * Math.min(10, w / 3); poly([[xx, yy], [xx + ww, yy - 2], [xx + ww + 2, yy + 3], [xx - 1, yy + 3]], i % 2 ? c : s, 0); rect(xx + 1, yy, ww - 1, 1, d); } break;
        default: if (catalogOn) extraKind(p); break;
      }
      if (ditherTargetsOn.includes('water') && (p.kind === 'pool' || p.kind === 'river')) ditherWaterLayer(p, c, s, d);
    }
    const ordered = orderLayers(plan.layers);
    const banded = ordered.some(p => p.depth) || (plan.details || []).some(d => d.depth);
    if (!banded) { for (const p of ordered) paintLayer(p); applyDetails(null); }
    else for (const band of depthBands) {
      for (const p of ordered) if ((p.depth || 'mid') === band) paintLayer(p);
      applyDetails(band);
    }
    const richer = !!(plan.detailLevel || plan.materials || plan.accents || plan.details || plan.dither
      || plan.layers.some(p => p.material || p.variant || p.depth || p.steps));
    const preLight = richer && ctx.getImageData ? ctx.getImageData(0, 0, width, height) : null;
    if (catalogOn && plan.lighting) lightingPass(ctx, plan);
    if (richer && preLight && ctx.getImageData) {
      const post = ctx.getImageData(0, 0, width, height), A = preLight.data, B = post.data, lit = new Uint8ClampedArray(B);
      let sumA = 0, sumB = 0, n = width * height;
      for (let i = 0; i < A.length; i += 4) { sumA += A[i] * .3 + A[i + 1] * .59 + A[i + 2] * .11; sumB += B[i] * .3 + B[i + 1] * .59 + B[i + 2] * .11; }
      const preMean = sumA / n, litMean = sumB / n;
      const gain = Math.min(1.08, 1 + 0.4 * Math.max(0, preMean / Math.max(1, litMean) - 1));
      for (let i = 0; i < B.length; i += 4) {
        const preL = A[i] * .3 + A[i + 1] * .59 + A[i + 2] * .11, postL = B[i] * .3 + B[i + 1] * .59 + B[i + 2] * .11;
        let g = gain;
        if (preL > 170 && postL < preL * .92) g = Math.max(g, Math.min(1.18, preL / Math.max(1, postL)));
        if (g > 1) {
          let rr = B[i] * g, gg = B[i + 1] * g, bb = B[i + 2] * g;
          const mx = Math.max(rr, gg, bb);
          if (mx > 250) { const k = 250 / mx; rr *= k; gg *= k; bb *= k; }
          B[i] = rr; B[i + 1] = gg; B[i + 2] = bb;
        }
      }
      let sumC = 0;
      for (let i = 0; i < B.length; i += 4) sumC += B[i] * .3 + B[i + 1] * .59 + B[i + 2] * .11;
      const nowMean = sumC / n, headroom = plan.view === 'interior' ? 3 : 10;
      let capMean = litMean + headroom;
      if (plan.view === 'interior' && nowMean > 82) capMean = Math.min(capMean, 82);
      if (nowMean > capMean) {
        let midSum = 0, midN = 0;
        const Lof = (arr, i) => arr[i] * .3 + arr[i + 1] * .59 + arr[i + 2] * .11;
        for (let i = 0; i < B.length; i += 4) { const L = Lof(B, i); if (L < 170 && Lof(A, i) <= 170) { midSum += L; midN++; } }
        const need = nowMean - capMean;
        const midMean = midN ? midSum / midN : 0;
        const drop = midN && midMean > 8 ? Math.min(0.22, need / (midMean * (midN / n))) : 0;
        if (drop > 0) {
          for (let i = 0; i < B.length; i += 4) {
            if (Lof(B, i) >= 170 || Lof(A, i) > 170) continue;
            B[i] = B[i] * (1 - drop) + lit[i] * drop;
            B[i + 1] = B[i + 1] * (1 - drop) + lit[i + 1] * drop;
            B[i + 2] = B[i + 2] * (1 - drop) + lit[i + 2] * drop;
          }
        }
      }
      if (plan.view === 'interior') {
        const Lof2 = (arr, i) => arr[i] * .3 + arr[i + 1] * .59 + arr[i + 2] * .11;
        let sumF = 0;
        for (let i = 0; i < B.length; i += 4) sumF += Lof2(B, i);
        const target = 82;
        if (sumF / n > target + 0.2) {
          let midSum = 0, hiSum = 0;
          for (let i = 0; i < B.length; i += 4) {
            const L = Lof2(B, i);
            if (L >= 170 || Lof2(A, i) > 170) hiSum += L; else midSum += L;
          }
          if (midSum > 0) {
            const k = Math.max(0.75, Math.min(1, (target * n - hiSum) / midSum));
            for (let i = 0; i < B.length; i += 4) {
              if (Lof2(B, i) >= 170 || Lof2(A, i) > 170) continue;
              B[i] *= k; B[i + 1] *= k; B[i + 2] *= k;
            }
          }
        }
      }
      ctx.putImageData(post, 0, 0);
    }
    if (pixelOn && plan.palette && ctx.getImageData) {
      const img = ctx.getImageData(0, 0, width, height);
      const base = Catalog.PALETTES[plan.palette] || [plan.sky, plan.ground, plan.stone, plan.shadow, plan.light, plan.accent];
      if (richer) {
        const extra = [];
        for (const a of plan.accents || []) if (a && a.color) extra.push(punchHex(typeof a.color === 'number' ? palette[a.color] : a.color, 1.45, 1.22));
        for (const c of [plan.accent, plan.light]) if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) extra.push(punchHex(c, 1.2, 1.12));
        for (const p of plan.layers) if (['dunes', 'road', 'sandstorm'].includes(p.kind) && typeof p.color === 'string') extra.push(p.color, p.shade, p.detail);
        pixelateRich(img.data, width, height, extra.concat(base), 2);
      } else {
        Catalog.pixelate(img.data, width, height, base, 2);
      }
      ctx.putImageData(img, 0, 0);
    }
    return ctx.canvas;
  }
  const BAYER16 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function rampPaletteRich(colors) {
    const out = [[0, 0, 0]], seen = new Set(['0,0,0']);
    const push = rgb => {
      const row = rgb.map(v => Math.max(0, Math.min(255, Math.round(v)))), key = row.join(',');
      if (!seen.has(key)) { seen.add(key); out.push(row); }
    };
    const tones = (hex, ks) => {
      const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      for (const k of ks) push(rgb.map(v => k > 1 ? v + (255 - v) * (k - 1) : v * k));
    };
    const list = colors.filter(Boolean).map(c => typeof c === 'number' ? palette[c] : c);
    // Accents first so their hues and bright highlights are never sliced off.
    for (const hex of list.slice(0, 4)) tones(hex, [0.7, 1, 1.28, 1.5]);
    for (const hex of list.slice(4, 12)) tones(hex, [0.5, 1, 1.28]);
    return out.slice(0, 28);
  }
  function pixelateRich(data, w, h, colors, factor = 2) {
    const pal = rampPaletteRich(colors), lw = Math.floor(w / factor), lh = Math.floor(h / factor), low = new Uint8ClampedArray(lw * lh * 3);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) { const k = ((y * factor + j) * w + x * factor + i) * 4; r += data[k]; g += data[k + 1]; b += data[k + 2]; n++; }
      const t = (BAYER16[(y % 4) * 4 + x % 4] / 16 - .5) * 22;
      const want = [r / n + t, g / n + t, b / n + t];
      let best = pal[0], bd = Infinity;
      for (const p of pal) { const d = (p[0] - want[0]) ** 2 * .3 + (p[1] - want[1]) ** 2 * .59 + (p[2] - want[2]) ** 2 * .11; if (d < bd) { bd = d; best = p; } }
      low.set(best, (y * lw + x) * 3);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (Math.min(lh - 1, Math.floor(y / factor)) * lw + Math.min(lw - 1, Math.floor(x / factor))) * 3, k = (y * w + x) * 4;
      data[k] = low[s]; data[k + 1] = low[s + 1]; data[k + 2] = low[s + 2]; data[k + 3] = 255;
    }
  }
  function lightingPass(ctx, plan) {
    const img = ctx.getImageData(0, 0, width, height), d = img.data, L = plan.lighting;
    const source = { shaft_from_above: [160, 0], golden_hour: [300, plan.horizon], moonlit: [60, 20], backlit_silhouette: [160, plan.horizon], lava_underglow: [160, 200],
      crystal_glow: [160, 150], candle_pools: [80, 160], twin_braziers: [60, 150], torch_flicker: [40, 110], chandelier_glow: [160, 30], lamp_reading: [120, 120] }[L] || [160, 90];
    const tint = { golden_hour: [1.12, 1, .82], moonlit: [.8, .88, 1.15], lava_underglow: [1.2, .85, .7], crystal_glow: [.85, 1.05, 1.15], sandstorm_haze: [1.08, 1, .8],
      storm_flash: [.9, .95, 1.1], aurora_veil: [.85, 1.1, 1.05], dappled_canopy: [.92, 1.08, .88], fog_bank: [.95, .97, 1] }[L] || [1.06, 1, .92];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4, dist = Math.hypot(x - source[0], (y - source[1]) * 1.3) / 260;
      let f = Math.max(.55, 1.25 - dist);
      if (L === 'dappled_canopy') f *= (hash(`${x >> 3},${y >> 3}`) % 5) ? 1 : .8;
      if (L === 'twin_braziers') f = Math.max(f, 1.25 - Math.hypot(x - 260, (y - 150) * 1.3) / 260);
      if (L === 'fog_bank' || L === 'sandstorm_haze') { const m = Math.min(.45, (y - plan.horizon + 40) / 220); if (m > 0) for (let i = 0; i < 3; i++) d[k + i] = d[k + i] * (1 - m) + 200 * m; }
      for (let i = 0; i < 3; i++) d[k + i] = Math.min(255, d[k + i] * f * tint[i]);
    }
    ctx.putImageData(img, 0, 0);
  }
  return { width, height, palette, kinds, catalogKinds, allKinds, patterns, materialNames, detailLevels, rampSteps, accentUsages, depthBands, stampTypes, variantNames, shadeRamp, validate, hash, paint, description, grammar: Grammar };
});
