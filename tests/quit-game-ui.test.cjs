'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/quitGameUi'), 'utf8');

function fixture({ legacy = false, quitStatus = 200, saveFails = false, hasRoom = false } = {}) {
  const nodes = new Map(), calls = [], navigation = [], saved = [];
  const element = () => ({ children: [], style: {}, disabled: false, value: '', textContent: '',
    set id(value) { nodes.set(value, this); }, setAttribute() {}, addEventListener() {},
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; }, showModal() { this.open = true; }, close() { this.open = false; } });
  nodes.set('game-menu', element());
  const root = { document: { readyState: 'complete', getElementById: id => nodes.get(id), createElement: element,
    body: element(), head: element() }, dungeonRunId: 'run', gamePaused: false, confirm: () => true,
    getDungeonLifeContext: () => ({ dungeon: hasRoom ? {} : null, busy: false }),
    DungeonLife: { setPaused: value => { root.gamePaused = value.paused; } },
    HolodekSaveGame: { save: async (...args) => { saved.push(args); if (saveFails) throw Error('Disk full.'); return { saved: true }; } },
    URL: { createObjectURL: () => 'blob:game-closed' }, location: { replace: url => navigation.push(url) },
    fetch: async (url, options = {}) => {
      calls.push({ url, body: options.body && JSON.parse(options.body) });
      const status = url === '/game/lifecycle' && legacy ? 404 : url === '/game/quit' ? quitStatus : 200;
      const data = url === '/game/lifecycle' ? { running: true, canQuit: true } : url === '/game-saves' ?
        { slots: [{ slot: 1, occupied: false }] } : url === '/game/quit' ? { quitting: true } : { paused: JSON.parse(options.body).paused };
      return { status, ok: status === 200, json: async () => status === 200 ? data : {} };
    } };
  vm.runInNewContext(source, { window: root, Blob });
  const panel = nodes.get('quit-game-dialog');
  return { root, calls, navigation, saved, panel, status: () => panel.children[1].textContent,
    save: () => panel.children[4].onclick(), quit: () => panel.children[5].onclick(), cancel: () => panel.children[6].onclick() };
}

test('an old server is identified before showing a working Quit action', async () => {
  const f = fixture({ legacy: true }); await f.root.GameQuitUi.open();
  assert.match(f.status(), /has not loaded Quit Game support/);
  assert.equal(f.panel.children[5].disabled, true); assert.equal(f.navigation.length, 0);
  assert.ok(!f.calls.some(call => call.url === '/game/quit'));
});

test('Quit Without Saving works on the opening screen and navigates off the running game document', async () => {
  const f = fixture(); await f.root.GameQuitUi.open(); await f.quit();
  assert.equal(f.saved.length, 0); assert.deepEqual(f.navigation, ['blob:game-closed']);
  assert.deepEqual(f.calls.find(call => call.url === '/game/quit').body, { runId: 'run', confirm: true });
});

test('Save and Quit waits for a verified checkpoint and never quits after a failed save', async () => {
  for (const saveFails of [true, false]) {
    const f = fixture({ hasRoom: true, saveFails }); await f.root.GameQuitUi.open(); await f.save();
    assert.equal(f.saved.length, 1); assert.equal(f.calls.some(call => call.url === '/game/quit'), !saveFails);
    assert.equal(f.navigation.length, saveFails ? 0 : 1);
    if (saveFails) assert.match(f.status(), /Disk full/);
  }
});

test('a missing shutdown route never claims that the game has closed', async () => {
  const f = fixture({ quitStatus: 404 }); await f.root.GameQuitUi.open(); await f.quit();
  assert.match(f.status(), /has not loaded Quit Game support/); assert.equal(f.navigation.length, 0);
  assert.equal(f.panel.children[5].disabled, false);
});

test('Cancel restores an unpaused adventure without any shutdown request', async () => {
  const f = fixture({ hasRoom: true }); await f.root.GameQuitUi.open(); assert.equal(f.root.gamePaused, true);
  await f.cancel(); assert.equal(f.root.gamePaused, false); assert.equal(f.panel.open, false);
  assert.ok(!f.calls.some(call => call.url === '/game/quit'));
});
