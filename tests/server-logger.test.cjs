const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installServerLogger, compactLogMessage, MAX_MESSAGE_LENGTH } = require('../serverLogger');

test('normal logging omits media payloads and bounds giant state dumps without hiding error context', () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(300000);
  assert.equal(compactLogMessage('sprite: ' + image), 'sprite: [media payload omitted]');
  const raw = 'Task completed: ' + 'state '.repeat(30000) + '\nError: broken pickup\n    at take (economy.js:450)';
  const compact = compactLogMessage(raw);
  assert.ok(compact.length <= MAX_MESSAGE_LENGTH);
  assert.match(compact, /^Task completed:/); assert.match(compact, /Log truncated/);
  assert.match(compact, /Error: broken pickup/); assert.match(compact, /economy.js:450/);
  assert.equal(compactLogMessage(raw, true), raw);
});

test('routine parser noise is opt-in while warnings and errors remain in both console and file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-quiet-log-'));
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error }, terminal = [];
  const prior = process.env.HOLODEK_VERBOSE_LOGS; delete process.env.HOLODEK_VERBOSE_LOGS;
  for (const method of Object.keys(originals)) console[method] = (...args) => terminal.push(args);
  let logger;
  try {
    logger = installServerLogger(directory);
    console.log('Processing part:', 'routine parser trace'); console.log('Task 12345 still processing');
    console.warn('Processing part: actual warning'); console.error(new Error('Pickup rejected'));
    console.log('Sprite:', 'data:image/png;base64,' + 'A'.repeat(30000));
    console.log(Object.create(null));
    await logger.close(); logger = null;
    const output = fs.readFileSync(path.join(directory, 'server.log'), 'utf8');
    assert.doesNotMatch(output, /routine parser trace|still processing|data:image/);
    assert.match(output, /actual warning/); assert.match(output, /Pickup rejected/); assert.match(output, /media payload omitted/);
    assert.ok(!terminal.some(args => typeof args[0] === 'string' && args[0].includes('data:image')));
  } finally {
    if (logger) await logger.close(); Object.assign(console, originals);
    if (prior === undefined) delete process.env.HOLODEK_VERBOSE_LOGS; else process.env.HOLODEK_VERBOSE_LOGS = prior;
    fs.unlinkSync(path.join(directory, 'server.log')); fs.rmdirSync(directory);
  }
});

test('live logging keeps console output and appends formatted specs across sessions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-log-test-'));
  const terminal = [];
  const originals = { log: console.log, info: console.info, error: console.error };
  console.log = (...args) => terminal.push(args);
  console.info = (...args) => terminal.push(args);
  console.error = (...args) => terminal.push(args);
  let logger;
  try {
    logger = installServerLogger(directory);
    console.log('[SceneSpec] %s %j', '0,0,1', { layout: 'outdoor', width: 512 });
    console.error(new Error('diagnostic test error'));
    await logger.close();
    logger = installServerLogger(directory);
    console.log('[SceneGfx] second session');
    await logger.close();
    logger = null;
    const log = fs.readFileSync(path.join(directory, 'server.log'), 'utf8');
    assert.match(log, /\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[log\] \[SceneSpec\] 0,0,1 {"layout":"outdoor","width":512}/);
    assert.match(log, /Error: diagnostic test error/);
    assert.match(log, /\[SceneGfx\] second session/);
    assert.equal((log.match(/Session started/g) || []).length, 2);
    assert.ok(terminal.some(args => args[0] === '[SceneSpec] %s %j'));
  } finally {
    if (logger) await logger.close();
    Object.assign(console, originals);
    fs.unlinkSync(path.join(directory, 'server.log'));
    fs.rmdirSync(directory);
  }
});
