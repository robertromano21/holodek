const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installServerLogger } = require('../serverLogger');

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
