'use strict';
if (process.argv.includes('--leaf')) {
  setInterval(() => {}, 1000);
} else if (process.argv.includes('--orphan-parent')) {
  const child = require('node:child_process').spawn(process.execPath, [__filename, '--leaf'], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.unref(); process.send({ orphan: child.pid }, () => process.exit(0));
} else {
  const ownership = require('../../gameProcessOwner').install();
  const { fork } = require('node:child_process'), http = require('node:http');
  const express = require('express'), app = express();
  const lifecycle = require('../../serverLifecycle').install(app, { port: 0, host: '127.0.0.1',
    autoQuitDelayMs: 40, timeoutMs: 200, state: { getDungeonRunId: () => 'owner-test', setGamePaused() {} },
    logger: { info() {}, error() {} } });
  const branch = fork(__filename, ['--orphan-parent'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
  branch.once('message', ({ orphan }) => {
    lifecycle.server.once('listening', () => process.send({ ownership, orphan, port: lifecycle.server.address().port }));
    lifecycle.listen();
  });
  if (process.argv.includes('--exit-unclean')) process.on('message', message => { if (message === 'exit-now') process.exit(1); });
}
