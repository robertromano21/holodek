const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(blocked = false) {
  const source = fs.readFileSync('assets/index.html', 'utf8');
  const begin = source.indexOf('function playRoomMusic()'), end = source.indexOf('// SSE listener for room music updates', begin);
  const nodes = new Map(), button = { style: {} };
  let loads = 0, plays = 0;
  nodes.set('room-music', { load() { loads++; }, play() {
    plays++; return blocked ? Promise.reject(new Error('Autoplay blocked')) : Promise.resolve();
  } });
  nodes.set('play-music-btn', button);
  const context = { console: { warn() {} }, document: {
    getElementById: id => nodes.get(id), createElement: () => ({ style: {}, textContent: '' }),
    body: { appendChild: node => nodes.set(node.id, node) }
  } };
  vm.runInNewContext(source.slice(begin, end), context);
  return { play: context.playRoomMusic, nodes, button, counts: () => ({ loads, plays }) };
}

test('successful room music plays normally without a persistent on-screen playback message', async () => {
  const f = fixture();
  for (let room = 0; room < 2; room++) {
    f.play(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.nodes.get('music-status').textContent, '');
  }
  assert.deepEqual(f.counts(), { loads: 2, plays: 2 });
});

test('blocked autoplay still offers the existing manual Play Music control', async () => {
  const f = fixture(true); f.play(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.get('music-status').textContent, 'Click "Play Music" to start audio');
  assert.equal(f.button.style.display, 'block');
});
