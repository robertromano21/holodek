const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');
const { applySceneSpecToClassification, applySceneSpecToVisualStyle } = require('../retort/sceneSpec');
const V = require('../assets/scenePropVoxels');
const M = require('../assets/voxelMaterials');
const { drawSceneSurface, drawRoofSurface } = require('../assets/renderSceneTextures');

const red = { primary: '#993344', secondary: '#551122', highlight: '#dd8888', shadow: '#220011' };
const blue = { primary: '#335599', secondary: '#113355', highlight: '#88bbdd', shadow: '#001122' };
function pixels(kind, opts) {
  const canvas = createCanvas(32, 32), ctx = canvas.getContext('2d');
  if (kind === 'roof') drawRoofSurface(ctx, createCanvas, opts);
  else drawSceneSurface(ctx, createCanvas, kind, opts);
  return Buffer.from(ctx.getImageData(0, 0, 32, 32).data);
}

test('semantic material defaults no longer overwrite description-generated classifier and visual colors', () => {
  const spec = { wallMaterial: 'marble', wallStyleMaterial: 'marble', floorStyleMaterial: 'marble',
    palette: { primary: '#ddddbb', secondary: '#aaaa99', highlight: '#ffffff', shadow: '#333333' } };
  const style = { palette: red, floor: { pattern: 'hex_tiles' }, wall: { brickSize: 'large' } };
  const result = applySceneSpecToVisualStyle(spec, style);
  assert.deepEqual(result.palette, red);
  assert.equal(result.floorPalette.primary, red.primary);
  assert.equal(result.floor.pattern, 'hex_tiles');
  assert.equal(result.wall.brickSize, 'large');
  assert.equal(result.wall.material, 'marble', 'Material remains faithful to prose');
  assert.deepEqual(style.palette, red, 'No mutation');
  const c = applySceneSpecToClassification(spec, { floorColor: '#224466', wallColor: '#994422' });
  assert.equal(c.floorColor, '#224466'); assert.equal(c.wallColor, '#994422');
  assert.deepEqual(applySceneSpecToVisualStyle(spec, null).palette, spec.palette);
});

test('explicitly disabling textures retains flat room colors and unchanged geometry', () => {
  const material = { primary: '#ddddbb', secondary: '#aaaa99' };
  const a = M.tintPalette(material, red, 'marble'), b = M.tintPalette(material, blue, 'marble');
  assert.notEqual(a.primary, b.primary);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  for (const shape of ['doric_column', 'ionic_column', 'pediment', 'dome_shell', 'barrel_vault_shell', 'arch', 'altar', 'sarcophagus', 'rubble']) {
    const geometry = V.build(shape);
    const c1 = V.color(shape, .2, .3, .5, [1, 0, 0], rgb(a.primary), 'marble', { textures: false });
    const c2 = V.color(shape, .7, .6, .8, [1, 0, 0], rgb(a.primary), 'marble', { textures: false });
    assert.deepEqual(c1, c2, 'No speckle, stripes or baked-in marble skin: ' + shape);
    assert.notDeepEqual(c1, V.color(shape, .2, .3, .5, [1, 0, 0], rgb(b.primary), 'marble', { textures: false }));
    assert.deepEqual(geometry, V.build(shape));
  }
  assert.equal(M.tintPalette(material, red, 'marble', { primary: '#ffcc00' }).primary, '#ffcc00', 'Explicit prop color wins');
  assert.equal(material.primary, '#ddddbb');
});

test('voxel textures are restored by default without losing vegetation and flame identity', () => {
  assert.notDeepEqual(V.color('doric_column', .2, .3, .05, [1, 0, 0], [.8, .2, .2], 'marble'), [.8, .2, .2]);
  assert.notDeepEqual(V.color('pale_hollow_tree', .5, .5, .5, [1, 0, 0], [.8, .2, .2], 'wood'), [.8, .2, .2]);
  assert.notDeepEqual(V.color('brazier', .5, .5, .6, [0, 0, 1], [.2, .2, .2], 'metal'), [.2, .2, .2]);
});

test('architectural surfaces have pale room-tinted bodies, contrasting trim and room-colored texture detail', () => {
  const room = { primary: '#8B7A52', secondary: '#A3966B', highlight: '#C1B88A', shadow: '#4E3D2B' };
  const p = M.tintPalette(room, room, 'earth');
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const palette = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, rgb(v)]));
  const luma = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  assert.ok(luma(palette.primary) >= .64);
  assert.ok(luma(palette.primary) - luma(palette.secondary) > .18, 'Trim is not another indistinguishable mud tone');
  assert.ok(luma(palette.highlight) > luma(palette.primary));
  for (const shape of ['doric_column', 'entablature', 'pediment', 'dome_shell', 'barrel_vault_shell']) {
    const colors = new Set();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) colors.add(V.color(shape, x / 16, .5, z / 16, [0, 1, 0],
      palette.primary, 'earth', { palette }).map(v => v.toFixed(3)).join(','));
    assert.ok(colors.size > 1, shape);
    const blueP = M.tintPalette(room, blue, 'earth');
    const bluePalette = Object.fromEntries(Object.entries(blueP).map(([k, v]) => [k, rgb(v)]));
    assert.notDeepEqual(V.color(shape, .4, .5, .5, [0, 1, 0], palette.primary, 'earth', { palette }),
      V.color(shape, .4, .5, .5, [0, 1, 0], bluePalette.primary, 'earth', { palette: bluePalette }));
  }
});

test('floor patterns and wall brick sizes remain distinct and use stable per-room seeds', () => {
  const variants = ['square_tiles', 'hex_tiles', 'rough_plates', 'organic', 'planks'].map(pattern => pixels('floor', {
    material: 'stone', palette: red, seed: 'room-a', style: { pattern } }));
  assert.equal(new Set(variants.map(b => b.toString('base64'))).size, 5);
  for (const pattern of ['square_tiles', 'hex_tiles', 'rough_plates']) {
    const opts = { material: 'stone', palette: red, seed: 'room-a', style: { pattern } };
    assert.deepEqual(pixels('floor', opts), pixels('floor', opts));
    assert.notDeepEqual(pixels('floor', opts), pixels('floor', { ...opts, seed: 'room-b' }));
  }
  const walls = ['small', 'medium', 'large'].map(brickSize => pixels('wall', {
    material: 'stone', palette: red, seed: 'room-a', style: { brickSize } }).toString('base64'));
  assert.equal(new Set(walls).size, 3);
});

test('roof undersides retain subdued shading but reflect room colors and generation seed', () => {
  const opts = { material: 'stone', palette: red, seed: 'room-a', style: 'coffered' };
  assert.deepEqual(pixels('roof', opts), pixels('roof', opts));
  assert.notDeepEqual(pixels('roof', opts), pixels('roof', { ...opts, palette: blue }));
  assert.notDeepEqual(pixels('roof', opts), pixels('roof', { ...opts, seed: 'room-b' }));
});
