'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function timers(website) {
  const source = fs.readFileSync(require.resolve('../retort/modelTransport'), 'utf8');
  const start = source.indexOf('function deadline('), end = source.indexOf('\nfunction verifyChoice', start), scheduled = [];
  const sandbox = { require: name => { assert.equal(name, './websiteAi'); return { service: () => ({ useForGameModels: () => website }) }; },
    AbortController, Promise, Error, setTimeout: (fn, ms) => { scheduled.push(ms); return 1; }, clearTimeout() {} };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nthis.clock = deadline; this.window = callTimeout;', sandbox);
  return { ...sandbox, scheduled };
}
test('polled website generation has no 120-second wall clock, while explicit deadlines and local-model bounds stay intact', async () => {
  const remote = timers(true);
  assert.equal(remote.window({}, undefined), null);
  const clock = remote.clock(remote.window({}, undefined));
  assert.equal(await clock.wait(Promise.resolve('processing until completion')), 'processing until completion');
  assert.deepEqual(remote.scheduled, []);
  clock.close(); assert.equal(clock.controller.signal.aborted, true);
  assert.equal(remote.window({}, 25), 25);
  remote.clock(remote.window({}, 25)).close(); assert.deepEqual(remote.scheduled, [25]);
  assert.equal(remote.window({ local: 'ollama' }, undefined), 600000);
  const direct = timers(false); assert.equal(direct.window({}, undefined), 120000);
});
test('room commands retain their existing 202/task-id/browser-poll path without a new client generation timeout', () => {
  const server = fs.readFileSync(require.resolve('../server'), 'utf8'), client = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  assert.match(server, /res\.status\(202\)\.json\(\{ taskId \}\)/);
  assert.match(server, /app\.get\('\/poll-task2\/:taskId'/);
  assert.match(client, /url: `\/poll-task2\/\$\{taskId\}`/);
  assert.match(client, /pollResponse\.status === 'processing'/);
});
