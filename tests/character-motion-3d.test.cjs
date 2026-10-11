const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/characterMotion3d');

const input = overrides => ({ scope: 'run|0,0,0', x: 0, y: 0, camX: 5, camY: 0, now: 0, ...overrides });
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('idle holds the original first pose while subtle breathing remains bounded', () => {
  const c = M.createController();
  let low = 1, high = 1;
  for (let now = 0; now <= 10000; now += 20) {
    const p = c.sample('Mason', input({ now }));
    assert.equal(p.frame, 0); assert.equal(p.moving, false);
    assert.equal(p.view, 'front'); assert.equal(p.facing, 1); assert.equal(p.upperShift, 0);
    low = Math.min(low, p.heightScale); high = Math.max(high, p.heightScale);
  }
  assert.ok(low >= .997 && high <= 1.003 && high - low > .005);
});

test('travel animates existing poses with continuous bounded motion, then settles to idle', () => {
  const c = M.createController(), frames = new Set(), heights = new Set();
  for (let now = 0; now <= 4000; now += 20) {
    const p = c.sample('Guard', input({ now, x: now / 1000 * 1.6 }));
    frames.add(p.frame); heights.add(p.heightScale);
    assert.ok(p.heightScale >= .985 && p.heightScale <= 1.015);
    assert.ok(Math.abs(p.upperShift) <= .03);
  }
  assert.equal(frames.size, 4); assert.ok(heights.size > 100);
  const p = c.sample('Guard', input({ now: 6000, x: 6.4 }));
  assert.equal(p.moving, false); assert.equal(p.frame, 0); assert.equal(p.upperShift, 0);
});

test('camera-only movement cannot advance the walk cycle', () => {
  const c = M.createController();
  for (let now = 0; now <= 5000; now += 20) {
    const angle = now / 1000;
    const p = c.sample('Watcher', input({ now, camX: Math.cos(angle) * 5, camY: Math.sin(angle) * 5 }));
    assert.equal(p.frame, 0); assert.equal(p.moving, false); assert.equal(p.upperShift, 0);
  }
});

test('facing and body motion are time-based rather than render-frame based', () => {
  function run(fps) {
    const c = M.createController();
    c.sample('Scout', input());
    let p;
    for (let i = 1; i <= fps * 2; i++) {
      const now = i * 1000 / fps;
      p = c.sample('Scout', input({ now, x: now / 1000 * .8, y: now / 1000 * .6 }));
    }
    return p;
  }
  const a = run(30), b = run(120);
  assert.equal(a.view, b.view); assert.equal(a.facing, b.facing); assert.equal(a.frame, b.frame);
  close(a.heightScale, b.heightScale, .00001); close(a.upperShift, b.upperShift, .00001);
});

test('view boundaries and front-axis weapon handedness resist camera jitter', () => {
  const c = M.createController();
  for (let now = 0; now <= 1000; now += 20) c.sample('Guard', input({ x: now / 1000, now }));
  const boundary = Math.PI * .22;
  for (let now = 1020; now <= 1400; now += 20) {
    const x = now / 1000, angle = boundary + (now % 40 ? .035 : -.035);
    const p = c.sample('Guard', input({ x, now, camX: x + 5 * Math.cos(angle), camY: -5 * Math.sin(angle) }));
    assert.equal(p.view, 'front');
  }
  const changed = c.sample('Guard', input({ x: 1.42, now: 1420,
    camX: 1.42 + 5 * Math.cos(boundary + .15), camY: -5 * Math.sin(boundary + .15) }));
  assert.equal(changed.view, 'threeQuarter');
  const hand = changed.facing;
  for (let now = 1440; now <= 1800; now += 20) {
    const x = now / 1000, angle = now % 40 ? .03 : -.03;
    const p = c.sample('Guard', input({ x, now, camX: x + 5 * Math.cos(angle), camY: 5 * Math.sin(angle) }));
    assert.equal(p.facing, hand);
  }
});

test('back views use existing supported art and unsupported back art falls back safely', () => {
  for (const supportsBack of [true, false]) {
    const c = M.createController(); let p;
    for (let now = 0; now <= 1000; now += 20) p = c.sample('Guard', input({ now, x: now / 1000, camX: -5, supportsBack }));
    assert.equal(p.view, supportsBack ? 'back' : 'front');
  }
});

test('pause freezes poses and resumes without advancing by paused wall-clock time', () => {
  const c = M.createController();
  c.sample('Guide', input());
  const moving = c.sample('Guide', input({ now: 100, x: .3 }));
  for (let now = 120; now <= 20120; now += 20) assert.equal(c.sample('Guide', input({ now, x: .3, paused: true })), moving);
  const next = c.sample('Guide', input({ now: 20140, x: .31 }));
  assert.ok(next.moving); assert.equal(next.frame, moving.frame);
  close(next.heightScale, moving.heightScale, .01);
});

test('teleports, long render gaps and new rooms do not spin the walking cycle', () => {
  const c = M.createController();
  c.sample('Guide', input());
  c.sample('Guide', input({ x: .3, now: 100 }));
  const jumped = c.sample('Guide', input({ x: 20, now: 120 }));
  assert.equal(jumped.frame, 0); assert.equal(jumped.moving, false);
  const late = c.sample('Guide', input({ x: 20.5, now: 3000 }));
  assert.equal(late.frame, 0); assert.equal(late.moving, false);
  c.sample('Other', input({ now: 3010 }));
  const room = c.sample('Guide', input({ x: 100, now: 3030, scope: 'run|1,0,0' }));
  assert.equal(room.frame, 0); assert.equal(room.heightScale, 1); assert.equal(c.size(), 1);
  c.reset(); assert.equal(c.size(), 0);
});

test('motion memory is bounded and does not mutate actor inputs', () => {
  const c = M.createController(), args = Object.freeze(input());
  c.sample('Immutable', args);
  for (let i = 0; i < 1000; i++) c.sample('Actor' + i, input());
  assert.equal(c.size(), M.MAX_ACTORS);
  assert.equal(c.sample('Invalid', input({ x: NaN })), null);
});

function rendererHarness() {
  let wallTime = 1700000000000, nextTex = 0;
  const calls = [], uploads = [], uniforms = [], deletes = [];
  const root = { CharacterMotion3D: M, currentDungeon: { geoKey: '0,0,0', _geometryStamp: 'v1' } };
  const context = { window: root, document: {}, console, Date: { now: () => wallTime }, performance: { now: () => 1000 } };
  vm.runInNewContext(fs.readFileSync('assets/rendererWebGL.js', 'utf8'), context);
  const renderer = root.webglDungeonRenderer;
  const gl = {
    createTexture: () => ({ id: ++nextTex }), bindTexture() {}, texParameteri() {}, pixelStorei() {}, generateMipmap() {},
    deleteTexture: tex => deletes.push(tex), texImage2D: (...args) => uploads.push(args),
    bufferData: (_kind, data) => { gl.vertices = Array.from(data); }, activeTexture() {}, drawArrays() {},
    uniform1i: (...args) => uniforms.push(args), uniform1f: (...args) => uniforms.push(args),
    uniform2f: (...args) => uniforms.push(args), uniform3f: (...args) => uniforms.push(args), uniform4f: (...args) => uniforms.push(args)
  };
  renderer.gl = gl;
  root.ProceduralCharacters = { supportsBackView: () => true, renderBillboardPixels: (spec, opts) => {
    calls.push({ spec, ...opts });
    const data = new Uint8ClampedArray(100 * 100 * 4).fill(123);
    return { w: 100, h: 100, data, bounds: { maxY: opts.frame === 0 ? 95 : 90 } };
  } };
  const actor = { name: 'Guide', walkFrame: 0, mazeX: 0, mazeY: 0,
    sprite: { spec: Object.freeze({ kind: 'procedural', key: 'unchanged-art', worldScale: 1 }) } };
  return { renderer, root, actor, gl, calls, uploads, uniforms, deletes, context, setWallTime: n => wallTime = n };
}

test('3D holds one idle texture regardless of 2D animation without mutating its artwork', () => {
  const f = rendererHarness(); let first;
  for (let now = 0; now <= 4000; now += 20) {
    f.actor.walkFrame = Math.floor(now / 180) % 4;
    const bb = f.renderer._getCharacterBillboard(f.actor, 0, 0, 5, 0, now);
    first ||= bb.tex; assert.equal(bb.tex, first); assert.equal(bb.motion.frame, 0);
  }
  assert.equal(f.calls.length, 1); assert.equal(f.uploads.length, 1);
  assert.equal(f.calls[0].spec, f.actor.sprite.spec);
  assert.ok(f.uploads[0][8].every(value => value === 123));
  assert.equal(f.actor.mazeX, 0); assert.equal(f.actor.mazeY, 0);
});

test('walking uses the same existing sprite poses with a stable sole inset and unchanged 2D clock', () => {
  const f = rendererHarness(); f.actor.walkFrame = 2;
  const frames = new Set(); let inset;
  for (let now = 0; now <= 3000; now += 20) {
    const bb = f.renderer._getCharacterBillboard(f.actor, now / 1000 * 1.6, 0, 10, 0, now);
    inset ??= bb.footInset; close(bb.footInset, inset); frames.add(bb.motion.frame);
  }
  assert.equal(frames.size, 4); assert.equal(f.uploads.length, 4); assert.equal(f.actor.walkFrame, 2);
  close(inset, .04);
});

test('texture/foot caches remain bounded when many character designs have appeared', () => {
  const f = rendererHarness();
  for (let i = 0; i < 300; i++) {
    const a = { ...f.actor, name: 'Character' + i, sprite: { spec: { kind: 'procedural', key: 'art' + i } } };
    f.renderer._getCharacterBillboard(a, 0, 0, 5, 0, i * 20);
  }
  assert.equal(f.renderer._billboardTexCache.size, 256);
  assert.equal(f.renderer._billboardFootInsets.size, 256);
  assert.equal(f.deletes.length, 44);
});

test('renderer room changes reset poses and pause does not swap sprite textures', () => {
  const f = rendererHarness();
  f.renderer._getCharacterBillboard(f.actor, 0, 0, 5, 0, 0);
  const walking = f.renderer._getCharacterBillboard(f.actor, .4, 0, 5, 0, 200);
  f.root.gamePaused = true;
  const paused = f.renderer._getCharacterBillboard(f.actor, .4, 0, 5, 0, 10000);
  assert.equal(paused.tex, walking.tex); assert.equal(paused.motion, walking.motion);
  f.root.gamePaused = false; f.root.currentDungeon.geoKey = '1,0,0';
  const entered = f.renderer._getCharacterBillboard(f.actor, 50, 50, 5, 0, 10020);
  assert.equal(entered.motion.frame, 0); assert.equal(entered.motion.moving, false);
});

test('renderer uses the maze tween epoch instead of mixing performance and Date timestamps', () => {
  const f = rendererHarness(), source = fs.readFileSync('assets/game.js', 'utf8');
  const begin = source.indexOf('function getPartyEntryRenderMazePosition(');
  const end = source.indexOf('function collectNearbyWalkableTiles(', begin);
  f.context.NPC_MOVE_TWEEN_MS = 420;
  vm.runInNewContext(source.slice(begin, end), f.context);
  Object.assign(f.actor, { mazeX: 1, mazeY: 0, renderMazeX: 0, renderMazeY: 0,
    _renderFromMazeX: 0, _renderFromMazeY: 0, _renderTweenToX: 1, _renderTweenToY: 0,
    _renderTweenStartedAt: 1700000000000 });
  f.setWallTime(1700000000210);
  const halfway = f.renderer._getCharacterMazeRenderPosition(f.actor, 1234);
  close(halfway.x, .5); close(halfway.y, 0);
  assert.equal(f.actor.mazeX, 1);
  f.setWallTime(1700000000420);
  close(f.renderer._getCharacterMazeRenderPosition(f.actor, 1444).x, 1);
  f.root.gamePaused = true; f.actor.mazeX = 2;
  f.setWallTime(1700000000840);
  close(f.renderer._getCharacterMazeRenderPosition(f.actor, 1864).x, 1);
});

test('continuous leaning pivots at grounded soles and preserves sprite lighting/depth', () => {
  const f = rendererHarness(), r = f.renderer;
  r.spriteUniforms = Object.fromEntries(['tex', 'lightDir', 'lightElev', 'lightIntensity', 'profile', 'depthAmount',
    'spritePos', 'spriteHeight', 'spriteVFlip', 'depthShadeScale', 'alphaCut', 'tint'].map(n => [n, n]));
  const spr = { actorTex: {}, drawLeft: 20, drawRight: 60, drawStartY: 10, drawEndY: 90,
    depth: .3, lightX: 2, lightY: 3, baseZ: 0, worldHeight: 1.22, upperShift: 2 };
  r._drawCharacterBillboard(spr, 100, 100, { dirX: 1, dirY: 0, elevation: .6, intensity: .8 }, .7);
  const shifted = f.gl.vertices;
  r._drawCharacterBillboard({ ...spr, upperShift: 0 }, 100, 100, { dirX: 1, dirY: 0, elevation: .6, intensity: .8 }, .7);
  const straight = f.gl.vertices;
  assert.deepEqual(shifted.slice(0, 10), straight.slice(0, 10));
  close(shifted[10] - straight[10], .04); close(shifted[15] - straight[15], .04);
  assert.ok(f.uniforms.some(row => row[0] === 'profile' && row[1] === 1));
  assert.ok(f.uniforms.some(row => row[0] === 'depthAmount' && row[1] === .55));
  assert.ok(f.uniforms.some(row => row[0] === 'alphaCut' && row[1] === .5));
});

test('all renderer entry points load the motion helper before WebGL including the WebGPU delegate', () => {
  for (const file of ['assets/index.html', 'assets/environment-lab.html', 'tests/dungeon-gpu-probe.html']) {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.indexOf('characterMotion3d.js') >= 0 && html.indexOf('characterMotion3d.js') < html.indexOf('rendererWebGL.js'));
  }
  assert.match(fs.readFileSync('assets/rendererWebGPU.js', 'utf8'), /legacyRenderer\.renderScene\(/);
});
