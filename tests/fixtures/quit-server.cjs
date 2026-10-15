'use strict';
const express = require('express');
const app = express(); app.use(express.json());
const streams = new Set();
app.get('/events', (req, res) => {
  streams.add(res); res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
  res.on('close', () => streams.delete(res));
});
const lifecycle = require('../../serverLifecycle').install(app, { port: 0, host: '127.0.0.1',
  state: { getDungeonRunId: () => 'test-run', setGamePaused() {} }, timeoutMs: 80,
  beforeClose: () => { for (const stream of streams) stream.end(); },
  flush: process.argv.includes('--stuck-flush') ? () => new Promise(() => {}) : () => {},
  logger: { info() {}, error() {} } });
lifecycle.listen().once('listening', () => process.send({ port: lifecycle.server.address().port, pid: process.pid }));
setInterval(() => {}, 1000);
