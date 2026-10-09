(function(root) {
  'use strict';
  const masonry = typeof module !== 'undefined' && module.exports ? require('./masonryPatterns') : root.MasonryPatterns;
  function tintPalette(materialPalette = {}, roomPalette = {}, material, overrides = {}) {
    const t = /wood|metal|gold|rust/.test(material || '') ? 0.25 : 0.85;
    const result = { ...materialPalette };
    for (const key of ['primary', 'secondary', 'highlight', 'shadow']) {
      if (!/^#[0-9a-f]{6}$/i.test(roomPalette[key] || '')) continue;
      const a = /^#[0-9a-f]{6}$/i.test(result[key] || '') ? result[key] : roomPalette[key];
      result[key] = '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) +
        parseInt(roomPalette[key].slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
    }
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const hex = values => '#' + values.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const luminance = values => (values[0] * .2126 + values[1] * .7152 + values[2] * .0722) / 255;
    const lift = (color, target) => {
      const values = rgb(color), l = luminance(values), amount = l < target ? (target - l) / (1 - l) : 0;
      return hex(values.map(v => v + (255 - v) * amount));
    };
    if (/^#[0-9a-f]{6}$/i.test(result.primary || '')) {
      // Keep room hue, but separate pale masonry bodies from darker colored trim.
      const target = /obsidian/.test(material || '') ? .20 : /wood|metal|rust|ash/.test(material || '') ? .40 :
        /marble|bone/.test(material || '') ? .72 : .65;
      result.primary = lift(result.primary, target);
      const body = luminance(rgb(result.primary));
      result.highlight = lift(/^#[0-9a-f]{6}$/i.test(result.highlight || '') ? result.highlight : result.primary, Math.min(.95, body + .16));
      const trim = rgb(/^#[0-9a-f]{6}$/i.test(result.secondary || '') ? result.secondary : result.primary), trimL = luminance(trim);
      result.secondary = hex(trim.map(v => v * Math.min(1, body * .65 / Math.max(.001, trimL))));
      const shadow = rgb(/^#[0-9a-f]{6}$/i.test(result.shadow || '') ? result.shadow : result.secondary), shadowL = luminance(shadow);
      result.shadow = hex(shadow.map(v => v * Math.min(1, body * .35 / Math.max(.001, shadowL))));
    }
    for (const [key, value] of Object.entries(overrides)) if (/^#[0-9a-f]{6}$/i.test(value || '')) result[key] = value;
    return result;
  }
  function kind(shape, material, type = '') {
    const bond = masonry.names.indexOf(material);
    if (bond >= 0) return 8 + bond;
    const s = `${shape || ''} ${material || ''} ${type}`.toLowerCase();
    if (/ash|charred/.test(s)) return 7;
    if (/tree|oak|pine|willow|cypress|roots|stump/.test(s)) return /bone/.test(s) ? 0 : 1;
    if (/wood|chest|barrel|crate|bookshelf/.test(s)) return 1;
    if (/metal|gold|rust|brazier|gate|portcullis|chain/.test(s)) return 3;
    if (/crystal|ice/.test(s)) return 6;
    if (/ash|charred/.test(s)) return 7;
    if (/tomb|altar|statue|obelisk/.test(s)) return 5;
    return 0;
  }
  function buildAtlas() {
    const size = 32, count = 8 + masonry.names.length, width = size * count, data = new Uint8Array(width * size * 4);
    const noise = (x, y) => ((Math.imul(x + 11, 374761393) ^ Math.imul(y + 7, 668265263)) >>> 0) % 43;
    for (let k = 0; k < count; k++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 178 + noise(x, y);
      if (k === 0) { // staggered masonry joints and pitting
        if (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 8) % 16 === 0) v = 85;
      } else if (k === 1) { // bark grain, wrapped at tile edges
        if ((x + Math.round(2 * Math.sin(y * Math.PI / 16))) % 7 === 0) v = 78;
        if ((x * 3 + y) % 29 === 0) v = 236;
      } else if (k === 2) { // end grain
        v = Math.floor(Math.hypot(x - 16, y - 16)) % 4 === 0 ? 105 : 209;
      } else if (k === 3) { // plates, rivets and scratches
        if (x % 16 === 0 || y % 16 === 0) v = 110;
        if (x % 16 === 2 && y % 16 === 2) v = 250;
        if ((x + y * 3) % 41 === 0) v = 138;
      } else if (k === 4) {
        v = (Math.floor(x / 3) + Math.floor(y / 4)) % 3 === 0 ? 135 : 218;
      } else if (k === 5) { // carved channels rather than text baked into a billboard
        if (x % 12 === 3 && y % 16 > 3 && y % 16 < 12 || y % 16 === 5 && x % 12 > 3 && x % 12 < 9) v = 83;
      } else if (k === 6) {
        v = (x + y) % 11 < 2 ? 247 : 175 + noise(x, y);
      } else if (k === 7) v = 95 + noise(x, y) * 2;
      else if (k >= 8) v = [85, 155, 207, 239][masonry.sample(masonry.names[k - 8], x, y)];
      const i = (y * width + k * size + x) * 4;
      data.set([v, v, v, 255], i);
    }
    return { width, height: size, data };
  }
  const api = { kind, buildAtlas, tintPalette };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoxelMaterials = api;
})(typeof window === 'undefined' ? globalThis : window);
