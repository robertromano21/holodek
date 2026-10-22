'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { createCanvas } = require('canvas');
const Retro = require('../assets/retroGraphics');
const source = fs.readFileSync(require.resolve('../assets/retroGraphics'), 'utf8');

function frame(width, height, colorAt) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...colorAt(x, y), 255], (y * width + x) * 4);
  return rgba;
}
test('glazed conversion keeps sixteen colors, exact palette pixels and reusable frame buffers', () => {
  const converter = Retro.createConverter('c64_glazed'), { width, height } = converter;
  assert.equal(width, 320); assert.equal(height, 200);
  const input = frame(width, height, (x, y) => Retro.palette[(x + y) % 16]), before = Buffer.from(input);
  const result = converter.convert(input), oldData = result.data, oldIndices = result.indices;
  assert.deepEqual(result.data, input);
  assert.equal(new Set(result.indices).size, 16);
  assert.equal(converter.convert(input), result);
  assert.equal(result.data, oldData); assert.equal(result.indices, oldIndices);
  assert.deepEqual(Buffer.from(input), before);
  assert.throws(() => converter.convert(input.subarray(4)), /frame size/);
});
test('invalid modes are rejected instead of silently changing the requested look', () => {
  assert.throws(() => Retro.createConverter('modern'), /Unknown C64/);
  assert.throws(() => Retro.createConverter('__proto__'), /Unknown C64/);
  assert.throws(() => Retro.setMode('__proto__'), /Unknown graphics/);
  for (const removed of ['c64_multicolor', 'c64_hires']) {
    assert.throws(() => Retro.createConverter(removed), /Unknown C64/);
    assert.throws(() => Retro.setMode(removed), /Unknown graphics/);
  }
});

test('final glazing leaves gray floors and armor neutral rather than tinting the finished frame', () => {
  const converter = Retro.createConverter('c64_glazed'), { width, height } = converter;
  assert.equal(width, 320); assert.equal(height, 200);
  const input = frame(width, height, (x, y) => x < 80 ? [128, 128, 128] : Retro.palette[(y % 16)]);
  const before = Buffer.from(input), result = converter.convert(input), bytes = Buffer.from(result.data);
  const allowed = new Set(Retro.palette.map(c => c.join(',')));
  for (let i = 0; i < result.data.length; i += 4) assert.ok(allowed.has(Array.from(result.data.subarray(i, i + 3)).join(',')));
  assert.deepEqual(Array.from(result.data.subarray(0, 3)), Retro.palette[12], 'Untargeted gray floor stays gray');
  converter.convert(input); assert.deepEqual(Buffer.from(result.data), bytes, 'Glazes have no time-driven randomness');
  converter.convert(input, { preserveColors: new Set([(128 << 16) | (128 << 8) | 128]) });
  assert.deepEqual(Array.from(result.data.subarray(0, 3)), Retro.palette[12], 'Known sprite armor remains gray rather than being painted like the architecture');
  assert.deepEqual(Buffer.from(input), before);
});

test('glaze allows all sixteen colors in a small region without discarding vivid details', () => {
  const c = Retro.createConverter('c64_glazed'), input = frame(c.width, c.height, (x, y) => Retro.palette[(x + y * 4) % 16]);
  const preserveColors = new Set(Retro.palette.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const result = c.convert(input, { preserveColors });
  assert.deepEqual(result.data, input, 'The glaze can restore the sixteen-color details over a restricted underpainting');
});

function mount(stored, activate = stored === 'c64_glazed') {
  const elements = new Map(), events = {}, settings = new Map(stored ? [['holodek.retroGraphics', stored]] : []);
  let created = 0, renders = 0, warnings = 0;
  for (const id of ['retro-graphics-toggle', 'retro-graphics-status']) elements.set(id, { textContent: '', events: {}, attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, handler) { this.events[name] = handler; } });
  function canvas() {
    created++;
    const value = createCanvas(640, 480); value.style = {}; value.attrs = {};
    value.setAttribute = (name, data) => { value.attrs[name] = data; };
    return value;
  }
  const document = { documentElement: { dataset: {} }, readyState: 'loading', getElementById: id => elements.get(id),
    createElement: canvas, addEventListener: (name, handler) => { events[name] = handler; } };
  const window = { document, performance, console: { warn() { warnings++; } }, currentDungeon: { name: 'Saved room', cells: { '1,1': { tile: 'floor' } } },
    renderDungeonView() { renders++; }, localStorage: { getItem: key => settings.get(key), setItem: (key, value) => settings.set(key, value) } };
  vm.runInNewContext(source, { document, window }); events.DOMContentLoaded();
  const container = () => ({ children: [], appendChild(child) {
    if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(c => c !== child);
    child.parentNode = this; this.children.push(child);
  } });
  const scene = createCanvas(640, 480), ctx = scene.getContext('2d'); ctx.fillStyle = '#da5f66'; ctx.fillRect(0, 0, 640, 480);
  if (activate) window.RetroGraphics.setMode('c64_glazed');
  return { api: window.RetroGraphics, window, document, elements, scene, container, settings,
    counts: () => ({ created, renders, warnings }) };
}
test('one-click toggle starts off, never restores a saved mode and repaints paused scenes', () => {
  const h = mount(), before = JSON.stringify(h.window.currentDungeon), host = h.container();
  assert.equal(h.api.status().mode, 'modern');
  assert.equal(h.document.documentElement.dataset.gameGraphics, 'modern');
  for (let i = 0; i < 20; i++) assert.equal(h.api.present(h.scene, host), false);
  assert.equal(h.counts().created, 0);
  const toggle = h.elements.get('retro-graphics-toggle');
  toggle.events.click();
  assert.equal(toggle.textContent, 'Retro Mode: ON'); assert.equal(toggle.attrs['aria-pressed'], 'true');
  assert.equal(h.document.documentElement.dataset.gameGraphics, 'retro');
  assert.equal(h.counts().renders, 1);
  assert.equal(h.api.present(h.scene, host), true); assert.equal(host.children.length, 1);
  const output = host.children[0];
  assert.equal(output.width, 320); assert.equal(output.height, 200); assert.equal(output.attrs['aria-hidden'], 'true');
  assert.match(output.style.cssText, /pointer-events:none/);
  assert.equal(h.scene.width, 640); assert.equal(h.scene.height, 480);
  for (let i = 0; i < 5; i++) h.api.present(h.scene, host);
  assert.equal(h.counts().created, 2, 'Only small sample/output canvases, never one per frame');
  assert.equal(host.children.length, 1);
  const replacement = h.container(); assert.equal(h.api.present(h.scene, replacement), true);
  assert.equal(host.children.length, 0); assert.equal(replacement.children[0], output);
  toggle.events.click(); assert.equal(output.hidden, true); assert.equal(toggle.textContent, 'Retro Mode: OFF');
  assert.equal(h.document.documentElement.dataset.gameGraphics, 'modern');
  assert.equal(JSON.stringify(h.window.currentDungeon), before);
  assert.equal(h.counts().warnings, 0);
  for (const old of ['c64_hires', 'c64_multicolor', 'c64_glazed']) assert.equal(mount(old, false).api.status().mode, 'modern');
  assert.deepEqual(Object.keys(Retro.modes), ['modern', 'c64_glazed']);
  assert.equal(mount('unknown').api.status().mode, 'modern');
});
test('WebGPU presentation, legacy WebGL and direct Canvas all use their correct completed source', () => {
  const h = mount('c64_glazed'), host = h.container(), gpu = createCanvas(160, 120), gl = h.scene;
  gpu.getContext('2d').fillStyle = '#5bd6ce'; gpu.getContext('2d').fillRect(0, 0, 160, 120);
  const renderer = { mode: 'webgpu', _presentedAtLeastOnce: true, canvas: gpu, legacyRenderer: { canvas: gl } };
  assert.equal(h.api.presentRenderer(renderer, host), true);
  const pixel = () => [...host.children[0].getContext('2d').getImageData(0, 0, 1, 1).data];
  assert.deepEqual(pixel(), [91, 214, 206, 255]);
  renderer.mode = 'legacy'; assert.equal(h.api.presentRenderer(renderer, host), true);
  assert.deepEqual(pixel(), [218, 95, 102, 255]);
  assert.equal(h.api.presentRenderer({ canvas: gpu }, host), true);
  assert.deepEqual(pixel(), [91, 214, 206, 255]);
  assert.equal(h.api.present(gpu, host), true);
});
test('an unreadable source stays visible and reports once rather than flooding the console every frame', () => {
  const h = mount('c64_glazed'), host = h.container(), broken = { width: 640, height: 480 };
  for (let n = 0; n < 30; n++) assert.equal(h.api.present(broken, host), false);
  assert.equal(h.counts().warnings, 1); assert.equal(h.api.status().active, false);
  assert.ok(h.api.status().error); assert.match(h.elements.get('retro-graphics-status').textContent, /unavailable/);
  assert.equal(h.api.present(h.scene, host), true); assert.equal(h.api.status().error, '');
  assert.equal(h.api.present(broken, host), false);
  assert.equal(h.counts().warnings, 1); assert.equal(h.api.status().active, false, 'A failed backend cannot leave a stale frame covering the new view');
  assert.ok(h.api.status().error);
});

test('Retro Mode requests bright stable lighting and preserves neutral gray source pixels', () => {
  const h = mount(); assert.equal(h.api.fullbright(), false);
  const host = h.container(), ctx = h.scene.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 640, 480);
  h.api.setMode('c64_glazed'); assert.equal(h.api.fullbright(), true);
  h.api.present(h.scene, host);
  assert.deepEqual([...host.children[0].getContext('2d').getImageData(0, 0, 1, 1).data], [120, 120, 120, 255]);
  h.api.setMode('modern'); assert.equal(h.api.fullbright(), false);
  assert.equal(JSON.stringify(h.window.currentDungeon), JSON.stringify({ name: 'Saved room', cells: { '1,1': { tile: 'floor' } } }));
});
test('game hooks filter synchronously after all three presentation paths and never change action prompts', () => {
  const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const render = game.slice(game.indexOf('\nfunction renderDungeonView()'), game.indexOf('// --- Poller for the dedicated character generation'));
  assert.match(render, /renderScene\(\);\s*window\.RetroGraphics\?\.presentRenderer/);
  assert.match(render, /\.render\(rasterCanvas\);\s*window\.RetroGraphics\?\.presentRenderer/);
  assert.match(render, /renderDungeonViewCanvas\(false\);\s*window\.RetroGraphics\?\.present/);
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  const menu = html.slice(html.indexOf('<div id="game-menu"'), html.indexOf('<dialog id="game-model-popup"'));
  assert.match(menu, /id="retro-graphics-toggle"[^>]*aria-pressed="false"[^>]*>Retro Mode: OFF/);
  assert.doesNotMatch(menu, /retro-graphics-select|c64_multicolor|c64_hires/);
  assert.match(html, /#retro-graphics-canvas\[hidden\]\s*\{\s*display: none/);
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval|setTimeout|fetch\(/);
});

test('asset layers preserve source colors, transparent cutouts and sparse black contours without modifying originals', () => {
  const h = mount('c64_glazed'), art = createCanvas(32, 64), ctx = art.getContext('2d');
  ctx.fillStyle = '#69bdf0'; ctx.fillRect(6, 2, 20, 60);
  ctx.clearRect(12, 34, 8, 30);
  const original = Buffer.from(ctx.getImageData(0, 0, 32, 64).data);
  const painted = h.api.prepareImage(art, 'prop');
  assert.equal(h.api.prepareImage(art, 'prop'), painted, 'Warm cache reuses the converted billboard');
  const result = painted.getContext('2d').getImageData(0, 0, 32, 64).data;
  assert.deepEqual([...result.slice((2 * 32 + 6) * 4, (2 * 32 + 6) * 4 + 4)], [0, 0, 0, 255]);
  assert.equal(result[(50 * 32 + 16) * 4 + 3], 0, 'An archway stays open');
  const allowed = new Set(h.api.palette.map(p => p.join(',')));
  for (let i = 0; i < result.length; i += 4) if (result[i + 3]) assert.ok(allowed.has([...result.slice(i, i + 3)].join(',')));
  assert.deepEqual(Buffer.from(ctx.getImageData(0, 0, 32, 64).data), original);
  art._revision = 1; assert.notEqual(h.api.prepareImage(art, 'prop'), painted);
  h.api.setMode('modern'); assert.equal(h.api.prepareImage(art, 'prop'), art);
});

test('glaze never repaints existing C64 artwork or black outlines', () => {
  const input = frame(320, 200, (x, y) => Retro.palette[(x + y) % 16]);
  assert.deepEqual(Buffer.from(Retro.createConverter('c64_glazed').convert(input).data), Buffer.from(input));
});

test('missing wall and floor images receive cached masonry surfaces in the palette', () => {
  const h = mount('c64_glazed'), colors = { primary: '#c79f82', highlight: '#ede4b8' }, before = JSON.stringify(colors);
  const wall = h.api.makeSurface('wall', colors), floor = h.api.makeSurface('floor', colors);
  assert.equal(h.api.makeSurface('wall', colors), wall); assert.notEqual(wall, floor);
  assert.equal(JSON.stringify(colors), before);
  const data = wall.getContext('2d').getImageData(0, 0, 32, 32).data;
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 0, 255]);
  const allowed = new Set(h.api.palette.map(p => p.join(',')));
  for (let i = 0; i < data.length; i += 4) assert.ok(allowed.has([...data.slice(i, i + 3)].join(',')));
});

test('warm masonry and gold ceiling colors are assigned before presentation while floor pixels stay neutral', () => {
  const h = mount('c64_glazed'), source = createCanvas(32, 32), ctx = source.getContext('2d');
  ctx.fillStyle = '#a0a0a0'; ctx.fillRect(0, 0, 32, 32);
  const before = Buffer.from(ctx.getImageData(0, 0, 32, 32).data);
  const colors = image => new Set([...image.getContext('2d').getImageData(0, 0, 32, 32).data].filter((_, i) => i % 4 === 0));
  assert.ok(colors(h.api.prepareImage(source, 'wall')).has(h.api.palette[9][0]));
  assert.ok(colors(h.api.prepareImage(source, 'ceiling')).has(h.api.palette[7][0]));
  const floor = h.api.prepareImage(source, 'surface').getContext('2d').getImageData(0, 0, 32, 32).data;
  assert.ok(floor.every((v, i) => i % 4 === 3 || v === floor[i - i % 4]));
  assert.deepEqual(Buffer.from(ctx.getImageData(0, 0, 32, 32).data), before);
});

test('wasteland pigment is outdoor-only and red patches are anchored to world coordinates', () => {
  assert.equal(Retro.environment({ classification: { indoor: true, biome: 'wasteland' } }).wasteland, false);
  assert.equal(Retro.environment({ classification: { indoor: false, biome: 'wasteland' } }).wasteland, true);
  assert.equal(Retro.environment({ sceneSpec: { indoor: false, biome: 'ashland' } }).wasteland, true);
  assert.equal(Retro.environment({ classification: { indoor: false, biome: 'forest' } }).wasteland, false);
  assert.equal(Retro.environment({ name: 'Tartarus Temple' }).wasteland, false);
  const input = frame(32, 32, (x, y) => [x * 7, y * 5, 25]), before = Buffer.from(input);
  const ground = Retro.palettePixels(input, 32, 32, { material: 'wasteland' });
  for (let i = 0; i < ground.length; i += 4) assert.equal(ground[i], ground[i + 1]);
  let red = 0, gray = 0;
  for (let y = -30; y < 30; y++) for (let x = -30; x < 30; x++) {
    const patch = Retro.groundPatch(x, y);
    assert.equal(patch, Retro.groundPatch(x, y));
    patch ? red++ : gray++;
  }
  assert.ok(red > 100 && gray > red);
  assert.deepEqual(Buffer.from(input), before);
});

test('outdoor red is sparse grit mixed into existing gray texture, not a solid patch', () => {
  let eligible = 0, red = 0, patches = 0;
  for (let y = -128; y < 128; y++) for (let x = -128; x < 128; x++) {
    const wx = x / 32, wy = y / 32;
    if (Retro.groundPatch(wx, wy)) patches++;
    const fleck = Retro.groundFleck(wx, wy, 120);
    if (fleck) { red++; assert.equal(Retro.groundPatch(wx, wy), true); }
    assert.equal(fleck, Retro.groundFleck(wx, wy, 120));
    for (const light of [0, 174, 255]) assert.equal(Retro.groundFleck(wx, wy, light), false, 'Black and light highlights are untouched');
    if (Retro.groundPatch(wx, wy)) eligible++;
  }
  assert.ok(red > 100 && red < patches * .06 && red > eligible * .03);
});

test('walls use steady sparse stippling instead of gray or time-driven noise', () => {
  const input = frame(32, 32, () => [145, 145, 145]);
  const result = Retro.palettePixels(input, 32, 32, { material: 'wall' });
  let speckles = 0;
  for (let i = 0; i < result.length; i += 4) if (result[i] === Retro.palette[8][0]) speckles++;
  assert.ok(speckles >= 150 && speckles < 250);
  assert.deepEqual(Retro.palettePixels(input, 32, 32, { material: 'wall' }), result);
});

test('items get black inner outlines, gold and vivid jewel hues without changing alpha, bounds or source art', () => {
  for (const [rgb, index] of [[[210, 170, 45], 7], [[185, 35, 40], 2], [[40, 185, 45], 5], [[160, 30, 170], 4]]) {
    const data = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) data.set([...rgb, 255], (y * 9 + x) * 4);
    data[3] = 80;
    const pixels = { w: 9, h: 9, data, footInset: .1, glow: true }, before = Buffer.from(data);
    const result = Retro.treasurePixels(pixels);
    assert.equal(result.footInset, .1); assert.equal(result.glow, true);
    assert.ok(result.data.every((v, i) => i % 4 !== 3 || v === data[i]));
    assert.deepEqual([...result.data.slice((4 * 9 + 4) * 4, (4 * 9 + 4) * 4 + 3)], Retro.palette[index]);
    assert.deepEqual([...result.data.slice((1 * 9 + 4) * 4, (1 * 9 + 4) * 4 + 4)], [0, 0, 0, 255]);
    assert.deepEqual(Buffer.from(data), before);
  }
});

test('Mortacia map sheets retain all alpha and body metrics while skin is pink, hair yellow and metal gray', () => {
  const S = require('../assets/renderCharacterSprite'), h = mount('c64_glazed');
  const sheet = S.createCharacterSpriteSheetCanvas({ name: 'Mortacia' }, null, 4), original = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data;
  const result = h.api.characterSheet(sheet, { name: 'Mortacia' });
  assert.equal(result.width, sheet.width); assert.equal(result.height, sheet.height);
  assert.equal(result._combatBodyHeight, sheet._combatBodyHeight);
  const data = result.getContext('2d').getImageData(0, 0, result.width, result.height).data;
  assert.ok(data.every((v, i) => i % 4 !== 3 || v === original[i]));
  const seen = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) seen.add([...data.slice(i, i + 3)].join(','));
  for (const index of [7, 10, 15]) assert.ok(seen.has(h.api.palette[index].join(',')));
  assert.equal(h.api.characterSheet(sheet), result);
  assert.ok(sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data.every((v, i) => v === original[i]));
  h.api.setMode('modern'); assert.equal(h.api.characterSheet(sheet), sheet);
});

test('detailed world Mortacia gets pink skin and blonde hair with an identical silhouette and immutable source pixels', () => {
  const C = require('../assets/renderCharacterProcedural'), spec = C.getPresetProceduralSpec('Mortacia');
  for (const view of ['front', 'side', 'threeQuarter', 'back']) {
    const original = C.renderBillboardPixels(spec, { view, facing: -1, frame: 0 }), before = new Uint8ClampedArray(original.data);
    const result = Retro.worldCharacterPixels(original, { name: 'Mortacia' }, spec), seen = new Set();
    assert.equal(result.bounds, original.bounds); assert.equal(result.bodyHeight, original.bodyHeight);
    assert.ok(result.data.every((v, i) => i % 4 !== 3 || v === original.data[i]));
    for (let i = 0; i < result.data.length; i += 4) if (result.data[i + 3]) seen.add([...result.data.slice(i, i + 3)].join(','));
    if (view !== 'back') for (const index of [7, 10]) assert.ok(seen.has(Retro.palette[index].join(',')), view + ' retains skin and hair colors');
    assert.ok(original.data.every((v, i) => v === before[i]));
  }
});

test('only spirits receive sparse fixed purple/cyan dots; outlines, alpha and every other pixel stay as before', () => {
  const data = frame(192, 192, (x, y) => x < 4 || y < 4 ? [0, 0, 0] : x > 160 ? [150, 40, 46] : [174, 174, 174]);
  for (let y = 100; y < 140; y++) for (let x = 100; x < 140; x++) data[(y * 192 + x) * 4 + 3] = (x + y) % 3 ? 120 : 0;
  const pix = { w: 192, h: 192, data, bounds: { minX: 0, minY: 0, maxX: 191, maxY: 191 }, bodyHeight: 180 }, before = Buffer.from(data);
  const baseline = Retro.worldCharacterPixels(pix, null, { race: 'Human' });
  for (const race of ['Spirit', 'Wraith', 'Ghost', 'Spectre']) {
    const spec = { race, name: 'Quiet Witness' }, result = Retro.worldCharacterPixels(pix, null, spec);
    const seen = new Set(); let changed = 0;
    for (let i = 0; i < data.length; i += 4) {
      assert.equal(result.data[i + 3], data[i + 3]);
      if (result.data[i] === baseline.data[i] && result.data[i + 1] === baseline.data[i + 1] && result.data[i + 2] === baseline.data[i + 2]) continue;
      const rgb = [...result.data.slice(i, i + 3)].join(','); seen.add(rgb); changed++;
      assert.ok([3, 4].some(index => rgb === Retro.palette[index].join(',')));
      assert.ok(data[i + 3] > 0 && data[i] === 174, 'Only visible neutral fill receives dots');
    }
    assert.ok(changed > 100 && changed < 192 * 192 * .06, 'Most of the figure keeps its previous colors');
    for (const index of [3, 4]) assert.ok(seen.has(Retro.palette[index].join(',')));
    assert.equal(result.bounds, pix.bounds); assert.equal(result.bodyHeight, pix.bodyHeight);
    assert.deepEqual(result.data, Retro.worldCharacterPixels(pix, null, spec).data, 'No flicker or random regeneration');
  }
  for (const race of ['Skeleton', 'Human', 'Elf', 'Goddess']) {
    const unchanged = Retro.worldCharacterPixels(pix, { name: 'Ghost Story' }, { race });
    assert.deepEqual(unchanged.data, baseline.data, 'Non-spirit characters are unchanged, even with a ghostly name');
  }
  assert.deepEqual(Buffer.from(data), before);
});

test('an unreadable combat canvas warns once, keeps normal drawing and can retry on mode selection', () => {
  const h = mount('c64_glazed'), game = { canvas: { width: 10, height: 10 }, renderer: {
    gameContext: { getImageData() { throw new Error('Tainted canvas'); } } } };
  for (let i = 0; i < 20; i++) assert.equal(h.api.presentCombat(game), false);
  assert.equal(h.counts().warnings, 1);
  h.api.setMode('c64_glazed'); h.api.presentCombat(game); assert.equal(h.counts().warnings, 2);
});

test('combat map converts only colors after Phaser draws, preserving dimensions, alpha and sleeping-loop behavior', () => {
  const { EventEmitter } = require('node:events'), h = mount();
  const canvas = createCanvas(775, 775), ctx = canvas.getContext('2d');
  let redraws = 0;
  const paint = () => { ctx.clearRect(0, 0, 775, 775); ctx.fillStyle = '#89a877'; ctx.fillRect(0, 0, 775, 775); ctx.clearRect(0, 0, 1, 1); };
  paint();
  const game = { events: new EventEmitter(), canvas, renderer: { gameContext: ctx },
    loop: { running: false, wake() { this.running = true; }, sleep() { this.running = false; } },
    scene: { getScene: () => ({ redrawCombatRT() { redraws++; paint(); } }) } };
  h.api.bindCombat(game); h.api.bindCombat(game);
  assert.equal(game.events.listenerCount('postrender'), 1);
  const before = Buffer.from(ctx.getImageData(0, 0, 775, 775).data);
  game.events.emit('postrender'); assert.equal(h.api.status().combatFrames, 0);
  assert.deepEqual(Buffer.from(ctx.getImageData(0, 0, 775, 775).data), before);
  h.api.setMode('c64_glazed'); assert.equal(redraws, 1); assert.equal(game.loop.running, true);
  game.events.emit('postrender'); assert.equal(game.loop.running, false);
  assert.equal(h.api.status().combatFrames, 1); assert.equal(canvas.width, 775); assert.equal(canvas.height, 775);
  const output = ctx.getImageData(0, 0, 775, 775).data, allowed = new Set(h.api.palette.map(p => p.join(',')));
  assert.equal(output[3], 0);
  for (let i = 4; i < output.length; i += 4) assert.ok(allowed.has([...output.slice(i, i + 3)].join(',')));
  h.api.setMode('modern'); game.events.emit('postrender');
  assert.deepEqual(Buffer.from(ctx.getImageData(0, 0, 775, 775).data), before);
  game.events.emit('destroy'); assert.equal(game.events.listenerCount('postrender'), 0);
  assert.equal(game.events.listenerCount('destroy'), 0);
});
