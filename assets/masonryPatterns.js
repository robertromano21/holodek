(function(root) {
  'use strict';
  // Stylized, tileable bonds. Indices: mortar, dark, body, edge.
  const names = ['ashlar', 'roman_brick', 'reticulatum', 'mixed_masonry', 'herringbone', 'rubble_masonry'];
  const mod = (v, n) => ((v % n) + n) % n;
  function sample(name, x, y) {
    x = mod(Math.floor(x), 32); y = mod(Math.floor(y), 32);
    if (name === 'reticulatum') {
      const a = mod(x + y, 8), b = mod(x - y, 8);
      return a === 0 || b === 0 ? 0 : a === 1 || b === 1 ? 3 : 2;
    }
    if (name === 'mixed_masonry') return y < 8 ? sample('roman_brick', x, y) : sample('reticulatum', x, y);
    if (name === 'herringbone') {
      const a = x + y, b = x - y, band = mod(Math.floor(a / 4), 4);
      return mod(a, 4) === 0 || mod(b + band * 4, 16) < 2 ? 0 : mod(a, 4) === 1 ? 3 : 2;
    }
    if (name === 'rubble_masonry') {
      const row = Math.floor(y / 8), seam = mod(x + row * 7, 16);
      const wobble = [0, 1, 1, 0, 0, -1, -1, 0][x % 8];
      return mod(y + wobble, 8) === 0 || seam < 2 ? 0 : (x * 3 + y * 5) % 13 === 0 ? 1 : 2;
    }
    const h = name === 'roman_brick' ? 4 : 8, w = 16;
    const seam = mod(x + (Math.floor(y / h) % 2) * (w / 2), w);
    return y % h === 0 || seam === 0 ? 0 : y % h === 1 ? 3 : (x + y) % 17 === 0 ? 1 : 2;
  }
  function fromDescription(text = '') {
    const s = String(text).toLowerCase();
    for (const [name, re] of [
      ['mixed_masonry', /opus mixtum|mixed masonry|brick[- ]banded/],
      ['reticulatum', /reticulat|diamond[- ]pattern(?:ed)? (?:stone|masonry)/],
      ['herringbone', /herringbone/], ['roman_brick', /roman brick|thin[- ]brick|opus latericium/],
      ['ashlar', /ashlar|dressed[- ]stone/], ['rubble_masonry', /rubble masonry|rough[- ]stone masonry/]
    ]) if (re.test(s)) return name;
    return null;
  }
  const api = { names, sample, fromDescription };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MasonryPatterns = api;
})(typeof window === 'undefined' ? globalThis : window);
