const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('const environmentLabCache = new Map();');
  const end = source.indexOf('\n});', start) + 4;
  const builds = [];
  let handler;
  vm.runInNewContext(source.slice(start, end), { environmentLabKinds: { badlands: '' }, console: { error() {} },
    app: { get(route, fn) { assert.equal(route, '/environment-lab/:kind'); handler = fn; } },
    buildEnvironmentLab(kind, options) { const d = { kind, seed: options.seed, build: builds.length }; builds.push(d); return d; } });
  function request(seed, kind = 'badlands') {
    const result = { code: 200, headers: {} };
    handler({ params: { kind }, query: seed === undefined ? {} : { seed } }, {
      status(code) { result.code = code; return this; }, json(body) { result.body = body; return this; },
      setHeader(name, value) { result.headers[name] = value; }
    });
    return result;
  }
  return { request, builds };
}

test('lab seed requests use isolated cache keys and preserve exact replay without a live server', () => {
  const h = harness(), a = h.request('alpha'), b = h.request('beta'), replay = h.request('alpha');
  assert.equal(a.body.dungeon, replay.body.dungeon);
  assert.notEqual(a.body.dungeon, b.body.dungeon);
  assert.equal(a.body.dungeon.seed, 'alpha'); assert.equal(b.body.dungeon.seed, 'beta');
  assert.equal(h.builds.length, 2); assert.equal(a.headers['Cache-Control'], 'no-store');
  assert.equal(h.request().body.dungeon.seed, undefined, 'Legacy/default exhibit requests remain supported');
});

test('lab validates unknown exhibits and malformed or oversized seeds before building', () => {
  const h = harness();
  for (const seed of ['', 'x'.repeat(161), ['a', 'b'], {}, 1]) assert.equal(h.request(seed).code, 400);
  assert.equal(h.request('seed', 'constructor').code, 404);
  assert.equal(h.builds.length, 0);
  assert.equal(h.request('x'.repeat(160)).code, 200);
});

test('variant browsing retains at most twelve cached exhibits and refreshes recent entries', () => {
  const h = harness();
  for (let i = 0; i < 12; i++) h.request(`seed-${i}`);
  const old = h.request('seed-0').body.dungeon;
  h.request('seed-12');
  assert.equal(h.request('seed-0').body.dungeon, old);
  const count = h.builds.length;
  h.request('seed-1');
  assert.equal(h.builds.length, count + 1, 'The oldest untouched entry was evicted');
});
