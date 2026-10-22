'use strict';
const http = require('node:http');

function localRequest(req) {
  const address = req.socket.remoteAddress;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname);
}
function install(app, { state, dice, isBusy = () => false, beforeClose = () => {}, flush = () => {},
  port = 3000, host, processRef = process, timeoutMs = 3000, autoQuitDelayMs = 10000, logger = console } = {}) {
  const server = http.createServer(app), sockets = new Set();
  const windows = new Set();
  let stopping = false, shutdownPromise, windowCloseTimer = null, disposed = false;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  function shutdown(reason = 'shutdown', code = 0) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    if (windowCloseTimer) clearTimeout(windowCloseTimer);
    windowCloseTimer = null;
    logger.info('[ServerShutdown]', JSON.stringify({ reason, pid: processRef.pid, port }));
    shutdownPromise = new Promise(resolve => {
      let finished = false, flushing = false;
      const deadline = setTimeout(() => finish(), timeoutMs);
      function finish() {
        if (finished) return; finished = true; clearTimeout(deadline);
        for (const socket of sockets) socket.destroy();
        resolve(); processRef.exit(code);
      }
      function drain() {
        if (flushing || finished) return; flushing = true;
        for (const socket of sockets) socket.destroy();
        // Keep the deadline armed even if a logging worker never flushes.
        Promise.resolve().then(flush).catch(error => logger.error('[ServerShutdown]', error.message)).finally(finish);
      }
      // Stop accepting requests before draining streams. SSE and workers must
      // not keep a Windows/PM2 child alive after its owner requested shutdown.
      server.close(drain);
      try { state?.setGamePaused(true); dice?.setPaused(true); beforeClose(); }
      catch (error) { logger.error('[ServerShutdown]', error.message); }
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
    return shutdownPromise;
  }
  const onSignal = signal => shutdown(signal);
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => onSignal(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) processRef.on(signal, handler);
  const onMessage = message => { if (message === 'shutdown') shutdown('pm2-shutdown'); };
  processRef.on('message', onMessage);
  function dispose() {
    disposed = true;
    if (windowCloseTimer) clearTimeout(windowCloseTimer);
    for (const [signal, handler] of Object.entries(handlers)) processRef.removeListener(signal, handler);
    processRef.removeListener('message', onMessage);
  }
  app.get('/game/lifecycle', (req, res) => res.json({ running: !stopping, pid: processRef.pid, port,
    canQuit: localRequest(req), connectedWindows: windows.size, closeGraceMs: autoQuitDelayMs }));
  let firstConnectAt = 0;
  app.get('/game/lifecycle/presence', (req, res) => {
    if (!localRequest(req)) return res.status(403).end();
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get('host')) throw Error(); }
      catch { return res.status(403).end(); }
    }
    if (stopping || disposed) return res.status(503).end();
    if (windowCloseTimer) clearTimeout(windowCloseTimer);
    windowCloseTimer = null;
    windows.add(res); firstConnectAt ||= Date.now();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('retry: 1000\n: game window connected\n\n');
    const heartbeat = setInterval(() => res.write(': game window alive\n\n'), 15000);
    heartbeat.unref?.();
    res.once('close', () => {
      clearInterval(heartbeat); windows.delete(res);
      if (stopping || disposed || windows.size || windowCloseTimer) return;
      // Start-up grace (opt-in, HOLODEK_STARTUP_GRACE_MS; test servers only): page reloads/reconnects soon after the first window connects never shut the server down.
      if (Date.now() - firstConnectAt < Number(process.env.HOLODEK_STARTUP_GRACE_MS || 0)) return;
      logger.info('[GameWindows]', JSON.stringify({ connected: 0, shutdownInMs: autoQuitDelayMs }));
      windowCloseTimer = setTimeout(() => {
        windowCloseTimer = null;
        if (!windows.size && !stopping && !disposed) shutdown('last-game-window-closed');
      }, autoQuitDelayMs);
      windowCloseTimer.unref?.();
    });
  });
  app.post('/game/quit', require('express').json({ limit: '1kb' }), (req, res) => {
    if (!localRequest(req)) return res.status(403).json({ error: 'Only the local game window can stop this server.' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get('host')) throw Error(); }
      catch { return res.status(403).json({ error: 'Quit from the game window.' }); }
    }
    if (req.body?.confirm !== true || req.body?.runId !== state?.getDungeonRunId()) return res.status(409).json({ error: 'The adventure changed. Reopen Quit Game.' });
    if (stopping) return res.status(409).json({ error: 'The server is already stopping.' });
    if (isBusy() || dice?.active || state?.isCharacterGenerationInProgress?.()) return res.status(409).json({ error: 'Finish the current command, character creation or combat round before quitting.' });
    // Send confirmation before closing its connection. Pausing immediately
    // prevents a new gameplay action racing this response and the close.
    state?.setGamePaused(true); dice?.setPaused(true);
    res.once('finish', () => setImmediate(() => shutdown('quit-button')));
    res.json({ quitting: true });
  });
  function listen() {
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`[ServerStartup] Port ${port} is already owned by another process. This duplicate server will stop; it will not kill the existing game.`);
        shutdown('port-in-use', 73);
      } else { logger.error('[ServerStartup]', error); shutdown('listen-error', 1); }
    });
    server.listen(port, host, () => {
      logger.info(`Server running on port ${server.address().port} (pid ${processRef.pid})`);
      if (typeof processRef.send === 'function') processRef.send('ready');
    });
    return server;
  }
  return { server, listen, shutdown, dispose, isStopping: () => stopping };
}
module.exports = { install, localRequest };
