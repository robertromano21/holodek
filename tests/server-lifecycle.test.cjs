'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { EventEmitter, once } = require('node:events');
const express = require('express');
const { fork } = require('node:child_process');
const Lifecycle = require('../serverLifecycle');

async function fixture(t, options = {}) {
  const processRef = new EventEmitter(), exits = [], state = { getDungeonRunId: () => 'run',
    setGamePaused(value) { this.paused = value; }, isCharacterGenerationInProgress: () => false };
  processRef.pid = 123; processRef.exit = code => { exits.push(code); processRef.emit('exited', code); };
  const app = express(); app.use(express.json());
  const lifecycle = Lifecycle.install(app, { port: 0, host: '127.0.0.1', state, processRef,
    logger: { info() {}, error() {} }, timeoutMs: 200, ...options });
  lifecycle.listen(); await once(lifecycle.server, 'listening');
  const port = lifecycle.server.address().port, url = `http://127.0.0.1:${port}`;
  t.after(() => { lifecycle.dispose(); lifecycle.server.closeAllConnections(); lifecycle.server.close(); });
  return { lifecycle, processRef, state, exits, port, url,
    post: (body, headers = {}) => fetch(url + '/game/quit', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}

async function reusable(t, port) {
  const server = http.createServer(); t.after(() => server.close());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  assert.equal(server.address().port, port);
}

test('Quit confirms shutdown, closes open connections and frees the actual listening port', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await fetch(f.url + '/game/lifecycle')).json(),
    { running: true, pid: 123, port: 0, canQuit: true, connectedWindows: 0, closeGraceMs: 10000 });
  const exited = once(f.processRef, 'exited');
  assert.deepEqual(await (await f.post({ runId: 'run', confirm: true })).json(), { quitting: true });
  await exited; assert.deepEqual(f.exits, [0]); assert.equal(f.state.paused, true);
  await reusable(t, f.port);
});

test('a stuck flush cannot cancel the hard shutdown deadline or leave the port occupied', async t => {
  let flushStarted = false;
  const f = await fixture(t, { timeoutMs: 40, flush: () => { flushStarted = true; return new Promise(() => {}); } });
  await f.lifecycle.shutdown('test'); assert.equal(flushStarted, true); assert.deepEqual(f.exits, [0]);
  await reusable(t, f.port);
});

test('stale adventures, missing confirmation and foreign origins cannot stop the server', async t => {
  const f = await fixture(t);
  for (const [body, headers, status] of [[{ runId: 'old', confirm: true }, {}, 409],
    [{ runId: 'run' }, {}, 409], [{ runId: 'run', confirm: true }, { Origin: 'https://unrelated.example' }, 403]]) {
    const response = await f.post(body, headers); assert.equal(response.status, status); await response.json();
  }
  assert.equal(f.lifecycle.isStopping(), false); assert.deepEqual(f.exits, []);
});

test('in-flight commands and character generation block shutdown without losing the session', async t => {
  const f = await fixture(t, { isBusy: () => true });
  const response = await f.post({ runId: 'run', confirm: true }); assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Finish/); assert.deepEqual(f.exits, []);
});

test('PM2 shutdown messages are handled once and ordinary exit does not restart through the ecosystem config', async t => {
  const f = await fixture(t), exited = once(f.processRef, 'exited');
  f.processRef.emit('message', 'shutdown'); f.processRef.emit('SIGTERM'); await exited;
  assert.deepEqual(f.exits, [0]);
  const [app] = require('../ecosystem.config.cjs').apps;
  assert.ok(app.stop_exit_codes.includes(0)); assert.ok(app.stop_exit_codes.includes(73)); assert.equal(app.shutdown_with_message, true);
});

test('port conflicts stop the duplicate without shutting down the existing server', async t => {
  const owner = await fixture(t), processRef = new EventEmitter(), exits = [];
  processRef.exit = code => { exits.push(code); processRef.emit('exited'); };
  const duplicate = Lifecycle.install(express(), { port: owner.port, host: '127.0.0.1', processRef,
    logger: { info() {}, error() {} } });
  t.after(() => duplicate.dispose()); const exited = once(processRef, 'exited');
  duplicate.listen(); await exited; assert.deepEqual(exits, [73]);
  assert.equal((await (await fetch(owner.url + '/game/lifecycle')).json()).running, true);
});

for (const stuck of [false, true]) test(`a real game process exits and frees its port with an open event stream${stuck ? ' and a stuck flush' : ''}`, { timeout: 5000 }, async t => {
  const child = fork(require.resolve('./fixtures/quit-server.cjs'), stuck ? ['--stuck-flush'] : [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const { port } = await new Promise((resolve, reject) => {
    child.on('message', value => { if (Number.isInteger(value?.port)) resolve(value); }); child.once('error', reject);
  }), exited = once(child, 'exit');
  const stream = http.get(`http://127.0.0.1:${port}/events`); stream.on('error', () => {});
  const [response] = await once(stream, 'response'); response.on('error', () => {});
  const quit = await fetch(`http://127.0.0.1:${port}/game/quit`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'test-run', confirm: true }) });
  assert.deepEqual(await quit.json(), { quitting: true });
  assert.equal((await exited)[0], 0); stream.destroy();
  await reusable(t, port);
});

async function windowConnection(f) {
  const stream = http.get(f.url + '/game/lifecycle/presence'); stream.on('error', () => {});
  const [response] = await once(stream, 'response'); response.on('error', () => {});
  response.resume(); assert.equal(response.statusCode, 200); return stream;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('closing the last game window shuts down after the refresh grace period and releases the port', async t => {
  const f = await fixture(t, { autoQuitDelayMs: 40 }), window = await windowConnection(f);
  assert.equal((await (await fetch(f.url + '/game/lifecycle')).json()).connectedWindows, 1);
  const exited = once(f.processRef, 'exited'); window.destroy(); await exited;
  assert.deepEqual(f.exits, [0]); await reusable(t, f.port);
});

test('refreshing or restoring from the back-forward cache cancels pending last-window shutdown', async t => {
  const f = await fixture(t, { autoQuitDelayMs: 100 }), first = await windowConnection(f);
  first.destroy(); await sleep(15);
  const replacement = await windowConnection(f); t.after(() => replacement.destroy());
  await sleep(130); assert.deepEqual(f.exits, []);
  assert.equal((await (await fetch(f.url + '/game/lifecycle')).json()).connectedWindows, 1);
});

test('closing one tab keeps the game running while another game tab is connected', async t => {
  const f = await fixture(t, { autoQuitDelayMs: 35 }), first = await windowConnection(f), second = await windowConnection(f);
  t.after(() => second.destroy()); first.destroy(); await sleep(70); assert.deepEqual(f.exits, []);
  assert.equal((await (await fetch(f.url + '/game/lifecycle')).json()).connectedWindows, 1);
});

test('cross-origin presence requests cannot create a game window or schedule shutdown', async t => {
  const f = await fixture(t, { autoQuitDelayMs: 20 });
  const response = await fetch(f.url + '/game/lifecycle/presence', { headers: { Origin: 'https://unrelated.example' } });
  assert.equal(response.status, 403); await response.text(); await sleep(35);
  assert.deepEqual(f.exits, []);
});
