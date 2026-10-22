(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BuilderPaint = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // Campaign Builder "mini photoshop" helpers. Every edit is a DATA OVERRIDE stored beside the generated room
  // (room.overrides); apply() layers it on a copy-on-write view and strip() returns the untouched original.
  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  // Palette lock: every picked colour snaps to the nearest entry of the game's pixel palette (redmean distance).
  function nearest(color, palette) { const c = rgb(color); if (!c || !palette?.length) return color; let best = palette[0], bd = Infinity;
    for (const p of palette) { const q = rgb(p); if (!q) continue; const r = (c[0] + q[0]) / 2, d = (2 + r / 256) * (c[0] - q[0]) ** 2 + 4 * (c[1] - q[1]) ** 2 + (2 + (255 - r) / 256) * (c[2] - q[2]) ** 2; if (d < bd) { bd = d; best = p; } }
    return best; }
  function gamePalette(catalog) { return [...new Set(Object.values(catalog?.PALETTES || {}).flat().filter(x => rgb(x)))]; }
  function toHsv([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx]; }
  function fromHsv([h, s, v]) { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
  // adjust: hue (deg), saturation/brightness (-1..1), contrast (-1..1); result optionally palette-locked.
  function adjust(color, { hue = 0, saturation = 0, brightness = 0, contrast = 0 } = {}, palette) {
    const c = rgb(color); if (!c) return color; let [h, s, v] = toHsv(c); h = (h + hue + 360) % 360; s = Math.max(0, Math.min(1, s * (1 + saturation)));
    let out = fromHsv([h, s, v]).map(x => x + brightness * 255); const k = (1 + contrast) / (1 - Math.min(contrast, 0.99)); out = out.map(x => (x - 128) * k + 128);
    const h2 = hex(out); return palette ? nearest(h2, palette) : h2; }
  const MATERIALS = ['stone', 'wood', 'metal', 'cloth'];
  // Non-destructive overrides: { palette:{key:#}, adjust:{...}, materials:{stone:#...}, lighting:{tint,intensity}, fog:{color,density},
  //   ornament, molding, props:{id:{scale,rotation}}, textures:{tileName:dataURL} }
  function apply(dungeon, ov, palette) {
    if (!dungeon || !ov) return dungeon;
    const d = { ...dungeon, _overridesApplied: true, _original: dungeon._original || dungeon };
    const pal = { ...(dungeon.visualStyle?.palette || {}) };
    for (const [k, v] of Object.entries(pal)) if (typeof v === 'string' && rgb(v) && ov.adjust) pal[k] = adjust(v, ov.adjust, palette);
    for (const [k, v] of Object.entries(ov.palette || {})) pal[k] = palette ? nearest(v, palette) : v;
    d.visualStyle = { ...(dungeon.visualStyle || {}), palette: pal, materials: { ...(dungeon.visualStyle?.materials || {}), ...Object.fromEntries(Object.entries(ov.materials || {}).filter(([m]) => MATERIALS.includes(m)).map(([m, c]) => [m, palette ? nearest(c, palette) : c])) } };
    if (ov.lighting) d.devLighting = { tint: palette ? nearest(ov.lighting.tint || '#ffffff', palette) : ov.lighting.tint, intensity: Math.max(0, Math.min(2, Number(ov.lighting.intensity ?? 1))) };
    if (ov.fog) d.fog = { color: ov.fog.color || '#888888', density: Math.max(0, Math.min(1, Number(ov.fog.density) || 0)) };
    if (ov.ornament || ov.molding) d.surfaceArt = (dungeon.surfaceArt || []).map(a => a.carvingStyle && ov.ornament ? { ...a, carvingStyle: ov.ornament } : a);
    if (ov.molding) d.moldingArt = (dungeon.moldingArt || []).map(m => ({ ...m, moldingStyle: ov.molding }));
    if (ov.props) d.sceneStructures = (dungeon.sceneStructures || []).map(p => { const o = ov.props[p.devId || p.tile]; if (!o) return p;
      const s = Number(o.scale) || 1; return { ...p, size: { x: p.size.x * s, y: p.size.y * s, z: p.size.z * s }, rotation: o.rotation ?? p.rotation }; });
    if (ov.textures) { d.tiles = { ...(dungeon.tiles || {}) }; for (const [t, url] of Object.entries(ov.textures)) if (d.tiles[t] && /^data:image\/png;base64,/.test(url)) d.tiles[t] = { ...d.tiles[t], url, _overrideOf: d.tiles[t].url }; }
    return d;
  }
  const strip = d => d?._original || d;
  // Pixel tools over ImageData-like {width,height,data}
  function setPixel(img, x, y, color) { const c = rgb(color); if (!c || x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; }
  function getPixel(img, x, y) { const i = (y * img.width + x) * 4; return hex([img.data[i], img.data[i + 1], img.data[i + 2]]); }
  function fill(img, x, y, color) { const target = getPixel(img, x, y); if (target.toLowerCase() === String(color).toLowerCase()) return 0; let n = 0; const stack = [[x, y]];
    while (stack.length) { const [px, py] = stack.pop(); if (px < 0 || py < 0 || px >= img.width || py >= img.height || getPixel(img, px, py) !== target) continue; setPixel(img, px, py, color); n++; stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]); }
    return n; }
  function history(limit = 60) { const past = [], future = []; return { push(s) { past.push(JSON.stringify(s)); if (past.length > limit) past.shift(); future.length = 0; },
    undo(cur) { if (!past.length) return cur; future.push(JSON.stringify(cur)); return JSON.parse(past.pop()); }, redo(cur) { if (!future.length) return cur; past.push(JSON.stringify(cur)); return JSON.parse(future.pop()); }, size: () => [past.length, future.length] }; }
  return { hex, rgb, nearest, gamePalette, adjust, MATERIALS, apply, strip, setPixel, getPixel, fill, history };
});
