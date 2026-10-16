'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createCanvas } = require('canvas');
const Art = require('../assets/roomIllustration'), Service = require('../retort/roomIllustration');
const F = require('./fixtures/room-art.cjs');
function state() {
  let run = 'test-run', coords = { x: 0, y: 0, z: 0 }, db = { '0,0,0': { name: 'The Remembered Portico',
    description: 'A fluted stone portico frames a dark doorway, with red and blue frescoes on the masonry.',
    classification: { indoor: true, biome: 'temple' }, objects: [], exits: {}, hp: 10 } };
  return { getDungeonRunId: () => run, setRun: r => { run = r; }, getLastCoords: () => coords, setCoords: c => { coords = c; },
    getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: v => { db = JSON.parse(v); },
    getUpdatedGameConsole: () => 'Room Description: A second description must never override the saved prose.', db: () => db };
}
async function service(t, s, author) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'holodek-room-art-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, value: Service.createService(s, { cacheDirectory: dir, author, logger: { info() {}, warn() {} } }) };
}
function render(plan, seed = 'test') { const c = createCanvas(320, 200); Art.paint(c.getContext('2d'), plan, seed); return c; }
test('three room compositions are distinct, deterministic, opaque and strictly sixteen-color pixel art', () => {
  const allowed = new Set(Art.palette.map(c => [1, 3, 5].map(n => parseInt(c.slice(n, n + 2), 16)).join(',')));
  const images = new Set();
  for (const plan of [F.temple(), F.spring(), F.alien()]) {
    const c = render(plan), pixels = c.getContext('2d').getImageData(0, 0, 320, 200).data;
    assert.deepEqual(c.toBuffer(), render(plan).toBuffer());
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) { const color = [...pixels.slice(i, i + 3)].join(',');
      assert.equal(pixels[i + 3], 255); assert.ok(allowed.has(color), color); colors.add(color); }
    assert.ok(colors.size >= 7); images.add(c.toBuffer().toString('base64'));
  }
  assert.equal(images.size, 3);
  assert.notDeepEqual(render(F.spring(), 'one').toBuffer(), render(F.spring(), 'two').toBuffer());
});
test('every component renders within a bounded canvas; unknown commands, colors and excessive plans are rejected', () => {
  const plan = F.temple(); plan.layers = Art.kinds.map((kind, i) => F.layer(kind, (i % 8) * 40, Math.floor(i / 8) * 45, 40, 45));
  assert.ok(render(plan).toBuffer().length > 500);
  for (const change of [p => { p.layers[0].kind = '<script>'; }, p => { p.sky = 16; }, p => { p.layers[0].x = Infinity; },
    p => { p.layers[0].w = 100000; }, p => { p.layers[0].x = .5; }, p => { p.layers = Array(37).fill(p.layers[0]); },
    p => { p.light = p.shadow; }]) { const p = F.temple(); change(p); assert.throws(() => Art.validate(p)); }
  const clean = Art.validate({ ...F.temple(), code: 'bad', layers: F.temple().layers.map(p => ({ ...p, label: '<bad>' })) });
  assert.equal(clean.code, undefined); assert.equal(clean.layers[0].label, undefined);
});
test('Modern paintings use unrestricted colors and richer landscape tools; only Retro quantizes them', () => {
  const Retro = require('../assets/retroGraphics'), p = F.vista(), before = JSON.stringify(p), c = render(p);
  const pixels = c.getContext('2d').getImageData(0, 0, 320, 200).data;
  const colors = new Set(); for (let i = 0; i < pixels.length; i += 4) colors.add([...pixels.slice(i, i + 3)].join(','));
  assert.ok(colors.size > 16); assert.ok(colors.has('22,63,77')); assert.equal(JSON.stringify(p), before);
  const copy = new Uint8ClampedArray(pixels), retro = Retro.palettePixels(copy, 320, 200);
  const legal = new Set(Retro.palette.map(row => row.join(',')));
  for (let i = 0; i < retro.length; i += 4) assert.ok(legal.has([...retro.slice(i, i + 3)].join(',')));
  assert.deepEqual(copy, pixels); assert.deepEqual(render(p).toBuffer(), c.toBuffer());
  const prompt = Service.prompt(Service.context(state(), '0,0,0'));
  assert.ok(prompt.includes('unrestricted #RRGGBB') && prompt.includes('description carries the day'));
});
test('Grave Master receives saved identity, enum tools and physical constraints, never private puzzle/actor state', async () => {
  const s = state(); s.db()['0,0,0'].solution = 'hidden secret'; s.db()['0,0,0'].inhabitants = { actors: { unseen: 'spy' } };
  const target = Service.context(s, '0,0,0'), prompts = [];
  const $ = { user: text => { prompts.push(text); }, assistant: { generation: async options => {
    assert.equal(options.strictParameters, true); assert.deepEqual(options.parameters.layers[0].type.kind.enum, Art.kinds);
    return { content: JSON.stringify(F.temple()) };
  } } };
  assert.deepEqual(await Service.generate($, target), F.temple());
  const prompt = prompts.join(''); assert.ok(prompt.includes(target.name) && prompt.includes(target.description));
  assert.ok(prompt.includes('320x200') && prompt.includes('Room name AND saved description'));
  assert.ok(!prompt.includes('hidden secret') && !prompt.includes('spy') && !prompt.includes('second description'));
});
test('malformed structured plans are retried, never substituted with an unrelated procedural room', async () => {
  let calls = 0;
  const $ = { user() {}, assistant: { generation: async () => ({ content: JSON.stringify(++calls === 1 ? { view: 'bad' } : F.temple()) }) } };
  assert.deepEqual(await Service.generate($, Service.context(state(), '0,0,0')), F.temple()); assert.equal(calls, 2);
  $.assistant.generation = async () => ({ content: '{}' });
  await assert.rejects(Service.generate($, Service.context(state(), '0,0,0')), /not generated/);
});
test('generation is deduplicated, saved with its room, and persists through a missing local cache', async t => {
  const s = state(); let calls = 0, release;
  const { value } = await service(t, s, async target => { calls++; assert.equal(target.name, s.db()['0,0,0'].name); await new Promise(r => { release = r; }); return F.temple(); });
  const first = value.ensure('0,0,0', 'test-run'), second = value.ensure('0,0,0', 'test-run');
  while (!release) await new Promise(r => setImmediate(r));
  s.db()['0,0,0'].hp = 3; s.db()['0,0,0'].objects.push('new discovery'); release();
  const record = await first; assert.deepEqual(await second, record); assert.equal(calls, 1);
  assert.equal(s.db()['0,0,0'].hp, 3); assert.deepEqual(s.db()['0,0,0'].objects, ['new discovery']);
  assert.deepEqual(s.db()['0,0,0'].illustration, record);
  const restarted = (await service(t, s, () => { throw Error('Must not call model on revisit.'); })).value;
  assert.deepEqual(await restarted.ensure('0,0,0', 'test-run'), record);
  const loaded = state(); loaded.setRoomNameDatabase(s.getRoomNameDatabase());
  assert.deepEqual(await (await service(t, loaded, () => { throw Error('Must not repaint loaded save.'); })).value.ensure('0,0,0', 'test-run'), record);
});
test('disk recipes restore a room without an API call; changed descriptions invalidate art', async t => {
  const s = state(); let calls = 0;
  const { value, dir } = await service(t, s, async () => { calls++; return F.temple(); });
  const record = await value.ensure('0,0,0', 'test-run'); delete s.db()['0,0,0'].illustration;
  const restarted = Service.createService(s, { cacheDirectory: dir, author: () => { throw Error('No call'); } });
  assert.deepEqual(await restarted.ensure('0,0,0', 'test-run'), record);
  s.db()['0,0,0'].description += ' The roof is now broken.';
  assert.notEqual((await value.ensure('0,0,0', 'test-run')).source, record.source); assert.equal(calls, 2);
});
test('late work cannot overwrite a changed room or another campaign; failures back off', async t => {
  for (const change of [s => { s.db()['0,0,0'].name = 'A Different Room'; }, s => { s.setRun('other-run'); }]) {
    const s = state(); let release, calls = 0;
    const { value } = await service(t, s, async () => { calls++; await new Promise(r => { release = r; }); return F.temple(); });
    const work = value.ensure('0,0,0', 'test-run'); while (!release) await new Promise(r => setImmediate(r));
    change(s); release(); await assert.rejects(work, /changed/); assert.equal(s.db()['0,0,0'].illustration, undefined); assert.equal(calls, 1);
  }
  const s = state(); let calls = 0;
  const { value } = await service(t, s, async () => { calls++; throw Error('Provider unavailable'); });
  await assert.rejects(value.ensure('0,0,0', 'test-run'), /unavailable/);
  await assert.rejects(value.ensure('0,0,0', 'test-run'), /cooling down/); assert.equal(calls, 1);
  await assert.rejects(value.ensure('../outside', 'test-run'), /coordinates/);
});
test('room-art route rejects stale runs and undiscovered distant rooms', async () => {
  const s = state(), routes = {};
  Service.install({ post: (url, fn) => { routes[url] = fn; } }, s, { author: async () => F.temple() });
  for (const body of [{ runId: 'old', geoKey: '0,0,0' }, { runId: 'test-run', geoKey: '10,10,10' }]) {
    let code, result; const res = { status: n => { code = n; return res; }, json: v => { result = v; } };
    await routes['/room-illustration']({ body }, res); assert.equal(code, 409); assert.ok(result.error);
  }
});
test('older scene-based saves retain their actual room prose after leaving the room', () => {
  const s = state(), room = s.db()['0,0,0'], prose = room.description;
  room.sceneSpec = { source: { description: prose } }; room.description = 'A newly discovered room to the north.';
  s.setCoords({ x: 1, y: 0, z: 0 });
  assert.equal(Service.context(s, '0,0,0').description, prose);
  assert.equal(Art.description(room, 'Unrelated console description.'), prose);
});
test('room-image console and scenery clicks share the unlit viewer; disabled DALL-E work is removed', async () => {
  const game = await fs.readFile(path.join(__dirname, '../assets/game.js'), 'utf8');
  const world = await fs.readFile(path.join(__dirname, '../assets/worldInteractionUi.js'), 'utf8');
  const viewer = await fs.readFile(path.join(__dirname, '../assets/artViewerUi.js'), 'utf8');
  const retort = await fs.readFile(path.join(__dirname, '../retort/retortWithUserInput.js'), 'utf8');
  assert.ok(game.includes('RoomArtUi?.visit') && game.includes('room.illustration = illustration'));
  assert.ok(world.includes('ArtViewerUi?.surface(target.art)'));
  assert.ok(viewer.includes('SurfaceArt.paint') && !viewer.includes('rendererWebGL'));
  assert.ok(!retort.includes('sanitizeImage') && !retort.includes('images/generations'));
});
