'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1'; process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createCanvas } = require('canvas'), Assets = require('../retort/roomVisualAssets');
const Setting = require('../retort/settingLayer'), Layer = require('../retort/genreLayer');

test('authored scenery labels produce bounded safe filenames without slug collisions', () => {
  const inputs = ['1,-1,0_custom_salt stalls_0', '1,-1,0_custom_market awnings_1',
    '1,-1,0_custom_salt_stalls_0', '1,-1,0_custom_fa\u00e7ade_2', '../outside',
    'folder\\outside', 'asset..name', 'x'.repeat(300), 'asset:\"<>|?*'];
  const names = inputs.map(input => Assets.spriteName(input));
  assert.equal(new Set(names).size, inputs.length);
  for (let i = 0; i < names.length; i++) {
    assert.match(names[i], /^[a-z0-9_,.-]+$/i);
    assert.ok(!names[i].includes('..')); assert.ok(names[i].length <= 180);
    assert.equal(Assets.spriteName(inputs[i]), names[i]);
  }
  assert.equal(Assets.spriteName('0,0,0_custom_rock_face_2'), '0,0,0_custom_rock_face_2');
});

for (const [index, label] of ['dungeon testing construction', 'foreground/helper room construction'].entries()) {
  test(label + ' renders the logged second-room scenery without rewriting its identities', () => {
    const vm = require('node:vm'), source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
    const loops = [...source.matchAll(/customTiles\.forEach\(\(tile, i\) => \{[\s\S]*?\n\s*\}\);/g)];
    assert.equal(loops.length, 2);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-authored-sprite-'));
    const random = Math.random;
    try {
      const render = require('../assets/renderSprite_poke').generateSpriteFromStyle;
      const customTiles = ['salt stalls', 'market awnings', 'elevated avenue', 'sensor poles', 'fa\u00e7ade', '../market']
        .map(type => ({ type, label: type, procedure: {}, spriteSpec: { profile: 'flat' } }));
      const before = JSON.stringify(customTiles), dungeon = { tiles: {} };
      vm.runInNewContext(loops[index][0], { customTiles, dungeon, geoKey: '1,-1,0', visualStyle: {},
        require: id => { assert.equal(id, './roomVisualAssets'); return Assets; },
        generateSpriteFromStyle: (style, type, name) => render(style, type, name, { directory: root }) });
      assert.equal(JSON.stringify(customTiles.map(({ name, ...tile }) => tile)), before);
      for (const [i, tile] of customTiles.entries()) {
        assert.equal(tile.name, `custom_${tile.type}_${i}`);
        assert.ok(Assets.spriteFile(dungeon.tiles[tile.name].url, root));
      }
      assert.equal(Assets.inline(dungeon, root).inlined, customTiles.length);
      assert.throws(() => render({}, 'floor', '../escape', { directory: root }), /Invalid sprite name/);
      assert.throws(() => render({}, 'floor', 'unsafe label', { directory: root }), /Invalid sprite name/);
    } finally { Math.random = random; fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('remote geometry embeds its actual PNG bytes and leaves collision/layout untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-texture-'));
  try {
    const bytes = createCanvas(8, 8).toBuffer('image/png'); fs.writeFileSync(path.join(root, 'scene_floor.png'), bytes);
    const d = { cells: { '1,1': { tile: 'floor', floorHeight: 2 } }, layout: { width: 4, height: 4 },
      tiles: { floor: { url: '/sid/sprites/scene_floor.png?cb=1' }, wall: { url: 'data:image/png;base64,existing' } } };
    const before = JSON.stringify({ cells: d.cells, layout: d.layout });
    assert.equal(Assets.inline(d, root).inlined, 1);
    assert.deepEqual(Buffer.from(d.tiles.floor.url.split(',')[1], 'base64'), bytes);
    assert.equal(JSON.stringify({ cells: d.cells, layout: d.layout }), before);
    assert.deepEqual(Assets.missing(d, root), []);
    const replay = require('../tools/website-worker/roomWire.cjs').unpack(require('../tools/website-worker/roomWire.cjs').pack(d));
    assert.equal(replay.tiles.floor.url, d.tiles.floor.url);
    assert.equal(Assets.inline(d, root).inlined, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a missing or invalid remote texture cannot silently become a broken local URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-texture-'));
  try {
    fs.writeFileSync(path.join(root, 'bad.png'), 'not a png');
    assert.throws(() => Assets.inline({ tiles: { wall: { url: '/sid/sprites/missing.png' } } }, root), /missing before transfer/);
    assert.throws(() => Assets.inline({ tiles: { wall: { url: '/sid/sprites/bad.png' } } }, root), /Invalid or oversized/);
    assert.equal(Assets.spriteFile('/sid/sprites/../secret.png', root), null);
    assert.equal(Assets.spriteFile('/sid/sprites/%2e%2e%2fsecret.png', root), null);
    assert.equal(Assets.spriteFile('https://example.com/secret.png', root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const genre of ['sci-fi', 'western', 'noir', 'nautical', 'steampunk']) {
  test('wall fixtures match ' + genre + ' without changing the solid wall cell', () => {
    const world = Setting.validateBible(Setting.localBible('Original world', [genre]));
    const d = { cells: { '1,1': { tile: 'torch', blocked: true, floorHeight: 0, ceilHeight: 4 } },
      tiles: { torch: { url: '/sid/sprites/old_torch.png' } } };
    const before = JSON.stringify(d.cells);
    const result = Layer.fixtures(d, {}, { setting: world });
    assert.equal(result.changed, 1); assert.ok(require('../assets/genreLights').TYPES[d.tiles.torch.lightType].genres.includes(genre));
    assert.equal(d.tiles.torch.flame, false); assert.match(d.tiles.torch.url, /^data:image\/png;base64,/);
    assert.equal(JSON.stringify(d.cells), before);
    assert.equal(Layer.fixtures(d, {}, { setting: world }).changed, 0);
  });
}

test('canonical fantasy keeps its torch image and lighting', () => {
  const d = { tiles: { torch: { url: '/sid/sprites/torch.png' } } };
  const before = JSON.stringify(d);
  assert.equal(Layer.fixtures(d, {}, { setting: null }).changed, 0);
  assert.equal(JSON.stringify(d), before);
});

test('visual asset revisions invalidate preloaded images without altering geometry identity', async () => {
  const manager = require('../assets/roomEntry').create({ loadResources: async d => ({ url: d.tiles.floor.url }) });
  const d = { geoKey: '1,0,0', _geometryStamp: 'same-walkable-layout', tiles: { floor: { url: 'first' } } };
  Assets.stamp(d); const first = await manager.remember('run', d);
  d.tiles.floor.url = 'second'; Assets.stamp(d);
  assert.equal(manager.resources('run', d), null);
  const second = await manager.remember('run', d);
  assert.equal(first.url, 'first'); assert.equal(second.url, 'second');
  assert.equal(d._geometryStamp, 'same-walkable-layout');
});

test('electrical art lamps have a stable glow panel, not animated brass flames', () => {
  const Art = require('../assets/artPresentation'), lamp = { electric: true, position: { x: 1, y: 2, z: 3 }, size: { x: .2, y: .2, z: .4 } };
  assert.deepEqual(Art.flamePose(lamp, .2), Art.flamePose(lamp, 1.2));
  const glow = Art.mesh(true, 'y', -1, 'wall', true), flame = Art.mesh(true);
  assert.notDeepEqual([...glow.vertices], [...flame.vertices]);
  for (const file of ['assets/game.js', 'assets/rendererWebGL.js']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /type: isTorch && ![\w.?]+(?:\.lightType)? \? 'torch' : 'custom'/);
  }
});
