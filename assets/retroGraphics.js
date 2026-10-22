(function(root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RetroGraphics = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.bind, { once: true });
    else api.bind();
  }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  // Colodore VIC-II palette, matching VICE's data/C64/colodore.vpl.
  const palette = Object.freeze([
    [0, 0, 0], [255, 255, 255], [150, 40, 46], [91, 214, 206],
    [159, 45, 173], [65, 185, 54], [39, 36, 196], [239, 243, 71],
    [159, 72, 21], [94, 53, 0], [218, 95, 102], [71, 71, 71],
    [120, 120, 120], [145, 255, 132], [104, 100, 255], [174, 174, 174]
  ].map(color => Object.freeze(color)));
  const modes = Object.freeze({
    modern: Object.freeze({ label: 'Modern' }),
    c64_glazed: Object.freeze({ label: 'Retro Mode', width: 320, height: 200 })
  });
  const sizes=Object.freeze({cc65:[320,200],cc110:[640,400],cc220:[1280,800]});
  let resolution='cc65',colorCount=32;
  const displayPreset='32-at-320-v1';
  try{const saved=JSON.parse(root.localStorage?.getItem('holodek-retro-display')||'{}');if(saved.preset===displayPreset){if(Object.hasOwn(sizes,saved.resolution))resolution=saved.resolution;if([16,32,64].includes(saved.colors))colorCount=saved.colors;}else root.localStorage?.setItem('holodek-retro-display',JSON.stringify({resolution,colors:colorCount,preset:displayPreset}));}catch{}
  function setDisplay(options={}){
    const nextResolution=options.resolution??resolution,nextColors=options.colors??colorCount;
    if(!Object.hasOwn(sizes,nextResolution)||![16,32,64].includes(nextColors))throw new RangeError('Unsupported retro display setting');
    resolution=nextResolution;colorCount=nextColors;apiFrame=null;
    try{root.localStorage?.setItem('holodek-retro-display',JSON.stringify({resolution,colors:colorCount,preset:displayPreset}));}catch{}
    setMode(mode);return{resolution,colors:colorCount};
  }
  const Details = typeof module === 'object' && module.exports ? require('./retroDetails') : root.RetroDetails;
  const distance = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
  const luminance = rgb => (77 * rgb[0] + 150 * rgb[1] + 29 * rgb[2]) / 256;
  let lookup, coloredLookup;
  function colorLookup(chromatic = false) {
    let table = chromatic ? coloredLookup : lookup;
    if (table) return table;
    table = new Uint8Array(32768);
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
      const rgb = [r * 8 + 4, g * 8 + 4, b * 8 + 4];
      let best = Infinity, index = 0;
      for (let c = 0; c < 16; c++) {
        if (chromatic && (c === 0 || c === 1 || c === 11 || c === 12 || c === 15)) continue;
        const error = distance(rgb, palette[c]);
        if (error < best) { best = error; index = c; }
      }
      table[(r << 10) | (g << 5) | b] = index;
    }
    if (chromatic) coloredLookup = table; else lookup = table;
    return table;
  }
  function createConverter(mode) {
    const spec = modes[mode];
    if (!spec?.width) throw new RangeError('Unknown C64 graphics mode: ' + mode);
    const [width,height] = sizes[resolution], lut = colorLookup();
    const result = { width, height, data: new Uint8ClampedArray(width * height * 4),
      indices: new Uint8Array(width * height) };
    function convert(rgba) {
      if (rgba.length !== result.data.length) throw new RangeError('Incorrect C64 input frame size');
      for (let p = 0, i = 0; p < result.indices.length; p++, i += 4) {
        // Materials choose colors before drawing; never tint gray armor or floors globally.
        const index = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
        const rgb = palette[index]; result.indices[p] = index;
        result.data[i] = rgb[0]; result.data[i + 1] = rgb[1]; result.data[i + 2] = rgb[2]; result.data[i + 3] = 255;
      }
      return result;
    }
    return { width, height, convert };
  }

  let apiFrame = null;
  let mode = 'modern', canvas, sample, sampleCtx, outputCtx, outputImage, converter;
  let lastSource, lastContainer, failures = new WeakMap(), failure = '', frames = 0, lastFrameMs = 0, bound = false;
  const artCache = new WeakMap(), characterArtCache = new WeakMap(), surfaceCache = new Map(), combatBindings = new WeakSet(), combatGames = new Set();
  let combatFailures = new WeakSet();
  let artSerial = 0, combatFrames = 0, combatFrameMs = 0;
  function fullbright() { return mode !== 'modern'; }
  function environment(dungeon) {
    const outdoor = (dungeon?.classification?.indoor ?? dungeon?.sceneSpec?.indoor) === false;
    const biome = String(dungeon?.classification?.biome || dungeon?.sceneSpec?.biome || '');
    const planar = !!(dungeon?.planarRealm || dungeon?.sceneSpec?.worldContext?.planarRealm);
    return { outdoor, wasteland: !planar && outdoor && /wasteland|ashland|badland|desert|dune|barren|steppe/i.test(biome) };
  }
  function groundPatch(x, y) {
    // World coordinates, shared with the GL floor shader: patches never swim with the camera.
    return Math.sin(x * .42) + Math.sin(y * .31) + Math.sin((x + y) * .19) > 1.35;
  }
  function groundFleck(x, y, light) {
    const grain = Math.floor(x * 32) * 13 + Math.floor(y * 32) * 7;
    return light >= 30 && light < 150 && ((grain % 23 + 23) % 23) < 1 && groundPatch(x, y);
  }
  function palettePixels(rgba, width, height, { outline = false, details = false, material } = {}) {
    if (rgba.length !== width * height * 4) throw new RangeError('Incorrect palette image size');
    const data = new Uint8ClampedArray(rgba), lut = colorLookup();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) { data[i + 3] = 0; continue; }
      let ink = false;
      if (outline) {
        ink = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          [i - 4, i + 4, i - width * 4, i + width * 4].some(n => rgba[n + 3] < 128);
      }
      // Ink only pronounced existing joins, not every fleck of texture.
      if (!ink && details && x > 0 && y > 0) {
        const light = luminance(rgba.subarray(i, i + 3));
        ink = light < 100 && (luminance(rgba.subarray(i - 4, i - 1)) - light > 60 ||
          luminance(rgba.subarray(i - width * 4, i - width * 4 + 3)) - light > 60);
      }
      const light = luminance(rgba.subarray(i, i + 3));
      let index = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
      if (material === 'wall') {
        index = light < 30 ? 0 : light < 185 ? 9 : 8;
        // Sparse material-space stipple; no blanket screen-space checkerboard.
        if (light >= 30 && ((x * 13 + y * 7 + (x >> 2) * 3) % 11 < 2)) index = index === 9 ? 8 : 9;
      } else if (material === 'ceiling') {
        const seam = x % 16 < 1 || y % 16 < 1;
        index = seam ? 9 : x % 16 === 1 || y % 16 === 1 || light < 110 ? 8 : 7;
      } else if (material === 'wasteland') {
        index = light < 30 ? 0 : light < 95 ? 11 : light < 150 ? 12 : light < 220 ? 15 : 1;
      }
      const rgb = palette[ink ? 0 : index];
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
    return data;
  }
  function detailCanvas(base, kind, material) {
    if (!Details) return base;
    const scale = Math.max(1, Math.min(4, Math.floor(128 / Math.max(base.width, base.height))));
    const layer = root.document.createElement('canvas'); layer.width = base.width * scale; layer.height = base.height * scale;
    const ctx = layer.getContext('2d', { willReadFrequently:true }); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base,0,0,layer.width,layer.height);
    const pixels=ctx.getImageData(0,0,layer.width,layer.height);
    pixels.data.set(Details.paint(pixels.data,layer.width,layer.height,{kind,material}));ctx.putImageData(pixels,0,0);
    layer.complete=true;layer.naturalWidth=layer.width;layer.naturalHeight=layer.height;return layer;
  }
  function prepareImage(image, kind = 'surface', material = 'stone') {
    if (!fullbright() || !image || !root.document) return image;
    if (image._retroPrepared) return image;
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    if (!(w > 0 && h > 0) || image.complete === false) return image;
    const signature = [kind, material, w, h, image.currentSrc || image.src || '', image._revision || 0].join('|');
    let entries = artCache.get(image);
    if (!entries) { entries = new Map(); artCache.set(image, entries); }
    if (entries.has(signature)) return entries.get(signature);
    let c = root.document.createElement('canvas');
    const limit = kind === 'prop' ? 64 : 32, ratio = Math.min(1, limit / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * ratio)); c.height = Math.max(1, Math.round(h * ratio));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return image;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, c.width, c.height);
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    pixels.data.set(palettePixels(pixels.data, c.width, c.height, { outline: kind === 'prop', details: kind === 'wall', material: kind }));
    ctx.putImageData(pixels, 0, 0);
    c = detailCanvas(c, kind, material);
    c.complete = true; c.naturalWidth = c.width; c.naturalHeight = c.height;
    c._webglKey = 'c64-art-' + (++artSerial);
    c._retroPrepared = true;
    // Keep only the current revision of each use; original image and saved art stay intact.
    for (const key of entries.keys()) if (key.startsWith(kind + '|')) entries.delete(key);
    entries.set(signature, c);
    return c;
  }
  function characterSheet(sheet, character, spec) {
    if (!fullbright() || !sheet?.getContext) return sheet;
    if (characterArtCache.has(sheet)) return characterArtCache.get(sheet);
    const canvas = root.document.createElement('canvas'); canvas.width = sheet.width; canvas.height = sheet.height;
    const ctx = canvas.getContext('2d'), pixels = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height);
    const roles = sheet._retroColorRoles || {}, overrides = new Map();
    const indexForRole = { skin: 10, hair: 7, hairShadow: 8, metal: 15 };
    for (const [role, colors] of Object.entries(roles)) for (const hex of colors) {
      if (/^#[\da-f]{6}$/i.test(hex) && indexForRole[role] != null) overrides.set(parseInt(hex.slice(1), 16), indexForRole[role]);
    }
    const data = palettePixels(pixels.data, sheet.width, sheet.height), colored = colorLookup(true);
    for (let i = 0; i < data.length; i += 4) {
      // Keep the exact alpha coverage, including any antialiased source edges.
      data[i + 3] = pixels.data[i + 3];
      if (!data[i + 3]) continue;
      const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      let index = overrides.get((r << 16) | (g << 8) | b);
      if (index == null && Math.max(r, g, b) - Math.min(r, g, b) >= 28) index = colored[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      if (index != null) data.set(palette[index], i);
    }
    pixels.data.set(data); ctx.putImageData(pixels, 0, 0);
    canvas._combatBodyHeight = sheet._combatBodyHeight; canvas._combatNativeScale = sheet._combatNativeScale;
    canvas._retroPrepared = true; characterArtCache.set(sheet, canvas); return canvas;
  }
  function worldCharacterPixels(pixels, character, spec) {
    if (!pixels?.data) return pixels;
    const data = new Uint8ClampedArray(pixels.data), lut = colorLookup(), colored = colorLookup(true);
    const mortacia = /^mortacia\b/i.test(String(character?.name || spec?.name || '').replace(/^Name:\s*/i, '').trim());
    const spirit = spec?.traits?.bodyPlan === 'spectral' ||
      /\b(spirit|ghost|wraith|specter|spectre|phantom|banshee|wisp|apparition|poltergeist|geist|phantasm|shade|wraithkin)s?\b/i.test(String(spec?.race || character?.race || ''));
    let speckleSeed = 0;
    if (spirit) for (const c of String(spec?.name || character?.name || 'spirit')) speckleSeed = (Math.imul(speckleSeed, 31) + c.charCodeAt(0)) >>> 0;
    const width = pixels.w || pixels.width, dotSize = Math.max(1, Math.floor(width / 48));
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2], chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let index = chroma >= 28 ? colored[key] : lut[key];
      // Her detailed world preset uses neutral wings/metal, rose-toned skin and
      // golden hair. Shade variations retain those hue families, not nearest gray.
      if (mortacia && r > g * 1.05 && g > b * 1.04 && r > 60) index = (g - b) / (r - b) > .56 ? 7 : 10;
      if (Math.max(r, g, b) < 28) index = 0;
      if (spirit && width && index !== 0 && chroma < 56 && Math.max(r, g, b) >= 60) {
        // Sparse, fixed dots on the existing figure, not a new palette ramp or aura.
        const x = Math.floor((i / 4 % width) / dotSize), y = Math.floor(Math.floor(i / 4 / width) / dotSize);
        let h = (speckleSeed ^ Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        if (h % 41 < 2) index = h % 41 === 0 ? 4 : 3;
      }
      data.set(palette[index], i);
    }
    return { ...pixels, data };
  }
  function treasurePixels(pixels, { outline = true } = {}) {
    if (!pixels?.data) return pixels;
    const data = new Uint8ClampedArray(pixels.data), lut = colorLookup(), colored = colorLookup(true);
    const width = pixels.w || pixels.width, height = pixels.h || pixels.height;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2], light = luminance(data.subarray(i, i + 3));
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let index = Math.max(r, g, b) - Math.min(r, g, b) >= 28 ? colored[key] : lut[key];
      // Warm gold/brass highlights read as gold, while rubies, emeralds and amethysts
      // retain the item's authored hue. Neither the outline nor alpha is expanded.
      if (r > b * 1.3 && g > b * 1.35 && g > r * .65 && light > 95) index = light > 210 ? 1 : 7;
      if (Math.max(r, g, b) < 30) index = 0;
      if (outline && data[i + 3] >= 128 && width && height) {
        const p = i / 4, x = p % width, y = Math.floor(p / width);
        if (!x || !y || x === width - 1 || y === height - 1 ||
            [i - 4, i + 4, i - width * 4, i + width * 4].some(n => pixels.data[n + 3] < 128)) index = 0;
      }
      data.set(palette[index], i);
    }
    return { ...pixels, data };
  }
  function makeSurface(kind, colors = {}, material = 'stone') {
    const key = JSON.stringify([kind, colors, material]);
    if (surfaceCache.has(key)) return surfaceCache.get(key);
    let canvas = root.document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colors.primary || (kind === 'floor' ? '#787878' : '#aeaeae'); ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#000';
    const course = kind === 'floor' ? 16 : 8, plank = /wood|timber/.test(material);
    for (let y = 0; y < 32; y += course) {
      ctx.fillRect(0, y, 32, 1);
      for (let x = ((y / course) % 2) * 8; x < 32; x += 16) {
        ctx.fillRect(x, y, 1, course);
        ctx.fillStyle = colors.highlight || '#ffffff'; ctx.fillRect(x + 1, y + 1, 1, course - 2);
        ctx.fillStyle = '#000';
      }
      if (plank) ctx.fillRect(0, y + 3, 3, 1);
    }
    canvas.complete = true; canvas.naturalWidth = canvas.naturalHeight = 32;
    const pixels = ctx.getImageData(0, 0, 32, 32);
    pixels.data.set(palettePixels(pixels.data, 32, 32, { material: kind }));
    ctx.putImageData(pixels, 0, 0);
    canvas = detailCanvas(canvas, kind, material);
    canvas._webglKey = 'c64-art-' + (++artSerial);
    canvas._retroPrepared = true;
    const result = canvas;
    if (surfaceCache.size >= 64) surfaceCache.delete(surfaceCache.keys().next().value);
    surfaceCache.set(key, result); return result;
  }
  function presentCombat(game) {
    if (!fullbright() || combatFailures.has(game)) return false;
    const ctx = game?.renderer?.gameContext;
    if (!ctx?.getImageData || !game.canvas?.width || !game.canvas?.height) return false;
    try {
      const start = root.performance?.now() || 0, { width, height } = game.canvas;
      const pixels = ctx.getImageData(0, 0, width, height), lut = colorLookup();
      // Color only: preserve every map pixel, alpha, token size and hit-test coordinate.
      for (let i = 0; i < pixels.data.length; i += 4) {
        const rgb = palette[lut[((pixels.data[i] >> 3) << 10) | ((pixels.data[i + 1] >> 3) << 5) | (pixels.data[i + 2] >> 3)]];
        pixels.data[i] = rgb[0]; pixels.data[i + 1] = rgb[1]; pixels.data[i + 2] = rgb[2];
      }
      ctx.putImageData(pixels, 0, 0); combatFrames++; combatFrameMs = (root.performance?.now() || 0) - start;
      return true;
    } catch (error) {
      combatFailures.add(game);
      root.console?.warn?.('[RetroGraphics] Combat palette unavailable; original map remains visible:', String(error.message || error));
      return false;
    }
  }
  function bindCombat(game) {
    if (!game?.events || combatBindings.has(game)) return;
    combatBindings.add(game); combatGames.add(game);
    const draw = () => presentCombat(game);
    game.events.on('postrender', draw);
    game.events.once('destroy', () => { game.events.off('postrender', draw); combatGames.delete(game); combatBindings.delete(game); });
  }
  // Start in Modern on every page load; selecting Retro is an explicit one-click action.
  function syncControl() {
    if (root.document?.documentElement?.dataset) root.document.documentElement.dataset.gameGraphics = fullbright() ? 'retro' : 'modern';
    const toggle = root.document?.getElementById('retro-graphics-toggle');
    if (toggle) { toggle.textContent = 'Retro Mode: ' + (fullbright() ? 'ON' : 'OFF'); toggle.setAttribute('aria-pressed', String(fullbright())); }
    const status = root.document?.getElementById('retro-graphics-status');
    if (status) { status.hidden = !failure; status.textContent = failure ? 'Filter unavailable: ' + failure : ''; }
  }
  function hide() { if (canvas) canvas.hidden = true; }
  function setMode(value) {
    if (!Object.hasOwn(modes, value)) throw new RangeError('Unknown graphics mode: ' + value);
    mode = value; converter = null; failures = new WeakMap(); combatFailures = new WeakSet(); failure = ''; hide();
    syncControl();
    if(root.CustomEvent)root.document?.dispatchEvent?.(new root.CustomEvent('retro-display-change'));
    root.RoomArtUi?.recolor?.();
    for (const game of combatGames) {
      game.scene?.getScene('CombatScene')?.redrawCombatRT?.();
      if (game.loop?.running === false) game.events.once('postrender', () => game.loop?.sleep());
      game.loop?.wake();
    }
    // Repaint a paused scene too; copying a previously presented GPU buffer can yield black.
    if (root.currentDungeon && typeof root.renderDungeonView === 'function') root.renderDungeonView();
    else if (lastSource && lastContainer) present(lastSource, lastContainer);
    return mode;
  }
  function present(source, container) {
    if (mode === 'modern') { hide(); return false; }
    if (!source || !container || !source.width || !source.height) { hide(); return false; }
    lastSource = source; lastContainer = container;
    const knownFailure = failures.get(source);
    if (knownFailure) {
      hide();
      if (failure !== knownFailure) { failure = knownFailure; syncControl(); }
      return false;
    }
    const started = root.performance?.now() || 0;
    try {
      if (!canvas) {
        canvas = root.document.createElement('canvas'); canvas.id = 'retro-graphics-canvas'; canvas.hidden = true;
        canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('data-retro-output', 'true');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;image-rendering:pixelated';
        outputCtx = canvas.getContext('2d', { alpha: false });
        sample = root.document.createElement('canvas'); sampleCtx = sample.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!outputCtx || !sampleCtx) throw new Error('Canvas 2D unavailable');
      }
      if (!converter) {
        converter = createConverter(mode);
        canvas.width = sample.width = converter.width; canvas.height = sample.height = converter.height;
        sampleCtx.imageSmoothingEnabled = false;
        outputImage = outputCtx.createImageData(converter.width, converter.height);
      }
      sampleCtx.fillStyle = '#000'; sampleCtx.fillRect(0, 0, sample.width, sample.height);
      sampleCtx.drawImage(source, 0, 0, sample.width, sample.height);
      const sourcePixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
      const finalFrame = Details ? Details.enhanced(sourcePixels,converter.width,converter.height,colorCount) : converter.convert(sourcePixels);
      outputImage.data.set(finalFrame.data);
      // Retain only the latest bounded frame for a bounded frame; legacy exports are explicitly downconverted.
      if (Details) apiFrame = finalFrame;
      outputCtx.putImageData(outputImage, 0, 0);
      if (canvas.parentNode !== container) container.appendChild(canvas);
      // Fill the viewport; the Retro camera compensates for its display aspect.
      if(canvas.style.setProperty){canvas.style.setProperty('width','100%','important');canvas.style.setProperty('height','100%','important');}
      canvas.style.inset='0';canvas.style.left='0';canvas.style.top='0';canvas.style.transform='none';canvas.style.boxShadow='none';
      canvas.hidden = false;
      frames++; lastFrameMs = (root.performance?.now() || 0) - started;
      if (failure) { failure = ''; syncControl(); }
      return true;
    } catch (error) {
      hide(); failure = String(error.message || error); failures.set(source, failure);
      if (!outputCtx || !sampleCtx) { canvas?.remove?.(); canvas = sample = outputCtx = sampleCtx = null; }
      syncControl(); root.console?.warn?.('[RetroGraphics] Filter unavailable; original scene remains visible:', failure);
      return false;
    }
  }
  function presentRenderer(renderer, container, fallback) {
    if (mode === 'modern') { hide(); return false; }
    const source = renderer?.mode === 'webgpu' && renderer._presentedAtLeastOnce ? renderer.canvas :
      renderer?.legacyRenderer?.canvas || renderer?.canvas || fallback;
    return present(source, container);
  }
  function status() {
    return { mode, active: !!canvas && !canvas.hidden && !!canvas.parentNode, width: converter?.width || 0,
      height: converter?.height || 0, resolution, colors:colorCount, palette: resolution+' palette ('+colorCount+' colors)' , fullbright: fullbright(), frames, lastFrameMs,
      combatFrames, combatFrameMs, error: failure };
  }
  function bind() {
    if (bound) return; bound = true;
    root.document.getElementById('retro-graphics-toggle')?.addEventListener('click', () => setMode(fullbright() ? 'modern' : 'c64_glazed'));
    syncControl();
  }
  return { exportHires: () => apiFrame && Details ? Details.hiresPrg(Details.legacyFrame(apiFrame)) : null, exportKoala: () => null, palette, enhancedPalette: Details?.enhancedColors || palette, modes, createConverter, palettePixels, prepareImage, characterSheet, worldCharacterPixels, treasurePixels, environment, groundPatch, groundFleck, makeSurface, setDisplay, sizes, setMode, present, presentRenderer,
    presentCombat, bindCombat, fullbright, status, bind };
});
