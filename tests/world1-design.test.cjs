'use strict';
// world1: ornament fields, moldings, pyramids, themes, room-picture catalog/pixel finish, and lore books.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('../assets/designCatalog'), Carvings = require('../assets/stoneCarvings');
const { createCanvas } = require('canvas');

test('ornament styles, borders and roles are APPENDED; every original option is still valid', () => {
  for (const s of ['acanthus', 'guilloche', 'egg_dart', 'fluted_reeds', 'ogee_tracery']) assert.ok(Carvings.styles.includes(s), s);
  assert.equal(Carvings.styles.length, 22, 'exported original list unchanged');
  for (const s of C.ORNAMENTS) assert.ok(Carvings.toolbox().carvingStyle.includes(s), s);
  assert.deepEqual(Carvings.toolbox().carvingStyle.slice(0, 22), Carvings.styles, 'appended after every original option');
  assert.ok(C.ORNAMENTS.length >= 30);
  for (const t of ['greek', 'roman', 'gothic', 'egyptian', 'mesoamerican', 'andean', 'near_eastern', 'south_asian', 'east_asian']) assert.ok(Object.values(C.TRADITION).includes(t), t);
  assert.deepEqual(Carvings.toolbox().stoneworkRole.slice(0, 3), ['skirting', 'dado', 'cornice']);
  assert.ok(Carvings.toolbox().stoneworkRole.includes('baseboard') && Carvings.toolbox().stoneworkRole.includes('surround'));
  assert.deepEqual(Carvings.validate({ carvingStyle: 'acanthus', carvingBorder: 'meander' }), { carvingStyle: 'acanthus', carvingBorder: 'meander' }, 'old rows unchanged');
});

test('interlocking fields are world-continuous: adjacent modules join exactly at the seam', () => {
  for (const style of ['meander_field', 'girih_stars', 'step_fret', 'rinceau_scroll', 'lotus_scroll']) {
    const paint = (m, w) => { const c = createCanvas(96, 64), g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 96, 64);
      C.paintBand(g, { carvingStyle: style, ornamentSecond: 'assyrian_rosettes', ornamentWeave: 'strapwork', axis: 'y', size: { x: w, y: .02, z: .6 }, position: { x: m, y: 0, z: 0 } }, {}); return g.getImageData(0, 0, 96, 64).data; };
    const a = paint(0, 1), b = paint(1, 1), px = (d, x, y) => d[(y * 96 + x) * 4];
    let seam = 0, inner = 0;
    for (let y = 0; y < 64; y++) { seam += px(a, 95, y) === px(b, 0, y) ? 1 : 0; inner += px(a, 47, y) === px(a, 48, y) ? 1 : 0; }
    assert.ok(seam >= inner * .8, `${style}: the seam is as continuous as the interior (${seam} vs ${inner})`);
    const shifted = paint(0, 1); assert.notDeepEqual(Buffer.from(b), Buffer.from(shifted), 'module 1 continues the field rather than repeating module 0');
  }
  const weaves = C.WEAVES.map(w => { let n = 0; for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) n += C.field('meander_field', x, y, 16, 'girih_stars', w) ? 1 : 0; return n; });
  assert.equal(new Set(weaves).size, 4, 'each weave composes differently');
});

test('off-catalog optional picks fall back safely instead of failing the room', () => {
  assert.deepEqual(Carvings.validate({ carvingStyle: 'meander_field', ornamentSecond: 'laser_graffiti', ornamentWeave: 'braid9' }), { carvingStyle: 'meander_field' });
  assert.deepEqual(Carvings.validate({ carvingStyle: 'girih_stars', ornamentSecond: 'step_fret', ornamentWeave: 'nested' }), { carvingStyle: 'girih_stars', ornamentSecond: 'step_fret', ornamentWeave: 'nested' });
});

test('moldings: rooms get scaled cornice and baseboard courses; gate surrounds carve only on request', () => {
  const Art = require('../assets/surfaceArt');
  const rows = Art.plan({ indoor: true, source: { roomName: 'Temple of the Vigil', description: 'Ancient stone architecture.' } });
  assert.equal(rows.filter(r => r.molding).length, 0, 'authored allowance untouched');
  const molds = Art.moldings(rows);
  assert.ok(molds.every(m => m.moldingStyle && !m.carvingStyle)); assert.deepEqual(molds.map(r => r.stoneworkRole).sort(), ['baseboard', 'cornice'].filter(r => rows.find(a => /stonework band/.test(a.label)).stoneworkRole !== r).sort());
  const band = rows.find(a => /stonework band/.test(a.label));
  assert.ok(molds.every(m => m.moldingStyle === band.carvingStyle), 'the same motif generator, scaled down');
  assert.ok(C.ORNAMENTS.includes(band.carvingStyle) && band.archTheme === 'temple', 'theme-driven interlocking band');
  assert.ok(C.MOLDINGS.baseboard.scale < C.MOLDINGS.dado.scale && C.MOLDINGS.cornice.scale < C.MOLDINGS.dado.scale);
  assert.equal(Carvings.resolveVoxelDescriptor({ voxelShape: 'exit_arch' }), null, 'frames stay plain unless asked');
  assert.deepEqual(Carvings.resolveVoxelDescriptor({ voxelShape: 'exit_arch', stoneCarving: { version: 1, region: 'panel', pattern: 'step_fret' } }), { version: 1, region: 'panel', pattern: 'step_fret' });
  globalThis.DesignCatalog = C; const Exits = require('../assets/dungeonExits');
  const cells = {}; for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) cells[`${x},${y}`] = { tile: x && y && x < 11 && y < 11 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3 };
  const d = { cells, layout: { width: 12, height: 12 }, start: { x: 6, y: 6 }, tiles: {}, exitFrames: true, moldings: true, classification: { indoor: true, biome: 'temple' }, sceneSpec: { roomName: 'Hall' } };
  Exits.install(d, ['north']);
  const frame = d.sceneStructures.find(p => p.role === 'journey-exit-frame');
  assert.equal(frame.shape, 'exit_arch'); assert.ok(C.VOXEL_PATTERNS.includes(d.tiles[frame.tile].spriteSpec.stoneCarving.pattern));
  const solid = require('../assets/scenePropVoxels').build('exit_arch', 32, 's'), carved = Carvings.carveVoxels(solid, 32, d.tiles[frame.tile].spriteSpec.stoneCarving, 'exit_arch');
  assert.ok(carved.reduce((a, v) => a + v, 0) < solid.reduce((a, v) => a + v, 0), 'surround is cut into the arch');
});

test('pyramids: decorative pass after wasteland generation; temple and generation rules untouched', () => {
  const P = require('../retort/wastelandPyramids'), V = require('../assets/scenePropVoxels');
  const cells = {}; for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  cells['15,1'].exitMarker = true;
  const mk = () => ({ cells: JSON.parse(JSON.stringify(cells)), layout: { width: 30, height: 30 }, start: { x: 15, y: 15 }, tiles: { wall: { url: 'w' } }, classification: { indoor: false, biome: 'wasteland' } });
  const spec = { roomName: 'Tartarus Wasteland', source: { description: 'A barren wasteland of yellow dust.' } };
  const d = mk(), before = JSON.stringify(d.cells), r = P.apply(d, spec, '0,2,0', { chance: 100 });
  assert.equal(r.status, 'built'); assert.equal(JSON.stringify(d.cells), before, 'cells, exits and routes unchanged');
  assert.ok(C.PYRAMIDS.includes(r.shape) && /\w/.test(r.lore)); assert.equal(d.pyramidFeature.lore, r.lore, 'underworld lore hook saved on the room');
  const s = d.sceneStructures[0]; assert.ok(Math.hypot(s.position.x - 15, s.position.y - 15) >= 6, 'kept clear of the arrival area');
  assert.equal(P.apply(mk(), spec, '0,0,0', { chance: 100 }).status, 'not-wasteland', 'temple is never touched');
  assert.equal(P.apply(d, spec, '0,2,0', { chance: 100 }).status, 'already-built');
  const geos = C.PYRAMIDS.map(n => Buffer.from(V.build(n, 24, 1)).toString('base64'));
  assert.equal(new Set(geos).size, 4, 'four distinct pyramid forms');
});

test('room pictures: new set pieces/palettes/lighting appended, validated with safe fallback, crisp dithered pixel finish', () => {
  const Art = require('../assets/roomIllustration');
  for (const k of ['ridge', 'portico', 'stars']) assert.ok(Art.kinds.includes(k));
  assert.equal(Art.kinds.length, 33, 'original kinds list unchanged');
  for (const k of C.ILLUSTRATION_KINDS) assert.ok(Art.allKinds.includes(k), k);
  const L = (kind, x) => ({ kind, x, y: 60, w: 60, h: 80, color: '#a89878', shade: '#5a4a38', detail: '#e8d8a0', count: 3, pattern: 'stone' });
  const raw = { view: 'landscape', horizon: 110, vanishing: 160, sky: '#f2d34a', ground: '#d8a63a', shadow: '#3f2a16', stone: '#9b6a2a', accent: '#7a3d22', light: '#ffef9a', groundPattern: 'sand',
    palette: 'tartarus_noon', lighting: 'not_a_light', composition: 'central_axis', motif: 'step_fret',
    layers: [L('pyramid_stepped', 10), L('pyramid_smooth', 80), L('sphinx_like', 150), L('dragon_skull', 220), L('colonnade', 20), L('frieze_band', 40), L('hover_tank', 60)] };
  assert.throws(() => Art.validate(raw), 'unknown component kinds are still rejected (existing retry path)');
  raw.layers.pop(); const plan2 = Art.validate(raw); assert.equal(plan2.layers.length, 6); assert.equal(plan2.lighting, undefined, 'unknown lighting dropped'); assert.equal(plan2.palette, 'tartarus_noon');
  const old = { ...raw, layers: raw.layers.slice(0, 6).map(l => ({ ...l, kind: 'wall' })) }; delete old.palette; delete old.lighting; delete old.composition; delete old.motif;
  assert.deepEqual(Object.keys(Art.validate(old)).sort(), ['groundPattern', 'horizon', 'layers', 'view', 'vanishing', 'sky', 'ground', 'shadow', 'stone', 'accent', 'light'].sort(), 'old plans unchanged');
  const c = createCanvas(320, 200), g = c.getContext('2d'); Art.paint(g, { ...raw, lighting: 'golden_hour' }, 'seed');
  const d = g.getImageData(0, 0, 320, 200).data, colors = new Set(); let blocky = true;
  for (let y = 0; y < 200; y += 2) for (let x = 0; x < 320; x += 2) { const k = (y * 320 + x) * 4; colors.add(d[k] << 16 | d[k + 1] << 8 | d[k + 2]);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) { const q = ((y + dy) * 320 + x + dx) * 4; if (d[q] !== d[k] || d[q + 1] !== d[k + 1] || d[q + 2] !== d[k + 2]) blocky = false; } }
  assert.ok(blocky, '2x2 nearest-neighbour blocks (lower internal resolution, crisp)'); assert.ok(colors.size <= 25, `limited palette (${colors.size})`);
  const R = require('../retort/roomIllustration');
  assert.deepEqual(Object.keys(R.catalogFields()).sort(), ['composition', 'lighting', 'motif', 'palette']);
  assert.match(R.catalogPrompt({ name: 'Tartarus Wasteland', description: 'dunes', biome: '' }), /pyramid_stepped/);
});

test('room-construction prompt exposes the larger catalog in compact form and stays under 35k', () => {
  const p = require('../retort/physicalPuzzleDesign').designPrompt({ roomName: 'Library', description: 'A hall of Eredine.', seed: 'test' });
  assert.ok(p.length < 35000, p.length);
  for (const id of ['meander_field', 'girih_stars', 'step_fret', 'cloud_scroll', 'baseboard', 'strapwork']) assert.ok(p.includes(id), id);
  assert.doesNotMatch(p, /\bMyst\b|\bUltima\b/, 'no game titles');
});

// ---------------- Lore books ----------------
const Library = require('../assets/libraryBooks'), Books = require('../retort/bookLore'), Memory = require('../retort/crossGameMemory');
function libraryRoom() {
  const cells = {}; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cells[`${x},${y}`] = { tile: x && y && x < 7 && y < 7 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 3 };
  cells['3,1'] = { tile: 'custom_bookshelf', floorHeight: 0, structureHeight: 2 }; cells['5,1'] = { tile: 'custom_bookshelf', floorHeight: 0, structureHeight: 2 };
  return { cells, tiles: { custom_bookshelf: { landmark: { type: 'bookshelf', label: 'bookshelf' }, spriteSpec: { voxelShape: 'bookshelf' } } }, layout: { width: 8, height: 8 } };
}
function fakeState(db, dungeon, consoleText = '') {
  let s = JSON.stringify(db);
  return { getLastCoords: () => ({ x: 0, y: 3, z: 0 }), getRoomNameDatabase: () => s, setRoomNameDatabase: v => { s = v; }, getRoomDungeon: () => dungeon, getDungeonRunId: () => 'run-books', db: () => JSON.parse(s), consoleText };
}
test('shelf books are individually clickable with distinct, non-overlapping hit boxes', () => {
  const list = Library.books(libraryRoom());
  assert.equal(list.length, 2 * Library.SHELVES * Library.PER_SHELF); assert.equal(new Set(list.map(b => b.name)).size, list.length);
  for (const a of list) for (const b of list) if (a !== b) {
    const overlap = ['x', 'y', 'z'].every(k => a.position[k] < b.position[k] + b.size[k] - 1e-9 && b.position[k] < a.position[k] + a.size[k] - 1e-9);
    assert.ok(!overlap, `${a.id} vs ${b.id}`);
  }
  assert.ok(list.every(b => b.axis === 'y' && b.position.y > 1.5), 'books face the open floor');
  const src = fs.readFileSync(path.join(__dirname, '../assets/worldInteractionUi.js'), 'utf8');
  assert.match(src, /type: 'book'[\s\S]*box:/); assert.match(src, /BookReaderUi\?\.open/);
});
test('first open generates the cover only (one call); a chapter is one more call; both cached in the save; mini retrieval feeds canon', async () => {
  Memory.reset();
  const db = { '0,0,0': { name: 'Ruined Temple Entrance', description: 'Mortacia judged the dead beneath the cracked dome.' },
    '0,3,0': { name: 'Archive of Ash', description: 'Shelves of scorched chronicles about the city of Prakis.', inhabitants: [{ name: 'Orren Vale' }] } };
  const dungeon = libraryRoom(), state = fakeState(db, dungeon);
  const calls = [], prompts = [];
  const run = async work => { const $ = { user: async t => prompts.push(String(t)), assistant: { generation: async req => { calls.push(req); return { content: JSON.stringify(replies.shift()) }; } } }; return work($); };
  const replies = [{ title: 'The Ash Concordance', author: 'Orren Vale', publishedSR: 612, backstory: 'Copied by the archive keepers.', contents: ['The Burning Shelves', 'Prakis Before the Fire', 'A Vigil for Mortacia', 'The Sealed Stair'], newFacts: ['The sealed stair under the archive leads toward the river of souls.'] },
    { text: 'The keepers wrote by lamplight. '.repeat(40), newFacts: ['Orren Vale hid a key in the Burning Shelves.'] }];
  const mini = { chat: { completions: { create: async req => { calls.push({ mini: req.model }); assert.match(req.messages[1].content, /Prakis/); return { choices: [{ message: { content: JSON.stringify({ facts: ['Prakis stands where Valana once was.'] }) } }] }; } } } };
  const r1 = await Books.ensure(state, 'read tome 3 of shelf 1', '', { run, client: mini });
  assert.equal(r1.kind, 'cover'); assert.equal(r1.retrieval, 'mini-model');
  assert.equal(calls.filter(c => c.mini).length, 1); assert.equal(calls.filter(c => !c.mini).length, 1, 'exactly one generation call');
  assert.match(prompts[0], /Prakis stands where Valana/, 'retrieved canon passed into generation');
  let rec = state.db()['0,3,0'].readables[0];
  assert.equal(rec.title, 'The Ash Concordance'); assert.equal(rec.author, 'Orren Vale', 'known in-world author kept'); assert.equal(rec.published, '612 S.R.');
  assert.deepEqual(rec.chapters.map(c => c.text), ['', '', '', ''], 'chapters not generated yet');
  assert.equal(state.db()['0,0,0'].bookFacts.length, 1, 'new fact saved for later lookups');
  assert.deepEqual(Memory.avoid('another-run', 'bookTitles'), [Memory.norm('The Ash Concordance')], 'anti-repeat memory records the title');
  const again = await Books.ensure(state, 'read tome 3 of shelf 1', '', { run, client: mini }); assert.equal(again.status, 'cached');
  const r2 = await Books.ensure(state, 'I want to read chapter 2 in tome 3 of shelf 1', '', { run, client: { chat: { completions: { create: async () => { throw Error('offline'); } } } } });
  assert.equal(r2.kind, 'chapter'); assert.equal(r2.retrieval, 'keyword', 'falls back to keyword search');
  rec = state.db()['0,3,0'].readables[0]; assert.ok(rec.chapters[1].text.length >= Books.CAP.chapterMin && !rec.chapters[0].text);
  assert.equal((await Books.ensure(state, 'read chapter 2 of tome 3 of shelf 1', '', { run })).status, 'cached', 'chapter cached');
  assert.equal(state.db()['0,0,0'].bookFacts.length, 2);
  // The normal adjudication path then reads it.
  const prepare = require('../retort/readableActions').prepare;
  const plan = prepare({ input: 'read chapter 2 of tome 3 of shelf 1', consoleText: 'Coordinates: 0,3,0\n', database: state.db(), dungeon, actor: { name: 'Ilka', hp: 5, type: 'pc', mazeRoomKey: '0,3,0', mazeX: 3, mazeY: 2 }, geoKey: '0,3,0' });
  assert.equal(plan.allowed, true, plan.message); assert.match(plan.message, /Chapter 2: Prakis Before the Fire\nThe keepers wrote/);
  const cover = prepare({ input: 'read tome 3 of shelf 1', consoleText: '', database: state.db(), dungeon, actor: { name: 'Ilka', hp: 5, type: 'pc', mazeRoomKey: '0,3,0', mazeX: 3, mazeY: 2 }, geoKey: '0,3,0' });
  assert.match(cover.message, /Contents: Chapter 1: The Burning Shelves/);
  const far = prepare({ input: 'read chapter 2 of tome 3 of shelf 1', consoleText: '', database: state.db(), dungeon, actor: { name: 'Ilka', hp: 5, type: 'pc', mazeRoomKey: '0,3,0', mazeX: 3, mazeY: 6 }, geoKey: '0,3,0' });
  assert.equal(far.allowed, false, 'shelf books need reach like any document');
});
test('unknown authors become Anonymous; inventory books (no shelf) are found by name; retrieved context is capped', async () => {
  Memory.reset();
  const db = { '0,3,0': { name: 'Camp' } }, state = fakeState(db, { cells: {} });
  const run = async work => work({ user: async () => {}, assistant: { generation: async () => ({ content: JSON.stringify({ title: 'Ledger of the Dry Well', author: 'A Famous Novelist', publishedSR: 700, backstory: 'x', contents: ['One', 'Two', 'Three', 'Four'], newFacts: [] }) }) } });
  const r = await Books.ensure(state, 'read the travel journal', 'Inventory: travel journal, torch\n', { run, client: null });
  assert.equal(r.kind, 'cover'); assert.equal(state.db()['0,3,0'].readables[0].author, 'Anonymous');
  assert.equal((await Books.ensure(state, 'read the torch', 'Inventory: travel journal, torch\n', { run, client: null })).status, 'not-a-book');
  const big = {}; for (let i = 0; i < 400; i++) big[`${i},0,0`] = { name: 'Prakis hall ' + i, description: 'Prakis chronicle '.repeat(20) };
  const k = await Books.retrieve(big, 'Prakis chronicle', { client: null });
  assert.ok(k.facts.join('').length <= Books.CAP.contextChars);
});
test('no shipped world1 design/book text names real artists, authors or game titles', () => {
  const banned = /\b(michelangelo|raphael|botticelli|donatello|leonardo|bernini|caravaggio|titian|tolkien|lovecraft|shakespeare|homer|tolstoy|dickens|zelda|ultima|diablo|skyrim|baldur|myst)\b/i;
  for (const f of ['assets/designCatalog.js', 'assets/libraryBooks.js', 'assets/bookReaderUi.js', 'retort/bookLore.js', 'retort/wastelandPyramids.js', 'tools/render-ornament-preview.cjs', 'tools/render-room-picture-preview.cjs'])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), banned, f);
});
