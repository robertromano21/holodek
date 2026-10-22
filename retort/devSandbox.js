'use strict';
// Playtest-only room-edit queue. Mounted ONLY when HOLODEK_DEV_SANDBOX=1 and the port is not the live 3000; every route is localhost-only.
function enabled(port) { return process.env.HOLODEK_DEV_SANDBOX === '1' && Number(port) !== 3000; }
function install(app, express, port) {
  if (!enabled(port)) return false;
  const queue = [], results = new Map(); let n = 0;
  const local = (req, res, next) => (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ? next() : res.status(403).json({ error: 'localhost only' }));
  app.post('/dev/room', local, express.json({ limit: '64kb' }), async (req, res) => {
    const ops = Array.isArray(req.body) ? req.body : [req.body], ids = ops.map(op => { const id = ++n; queue.push({ id, op }); return id; });
    const until = Date.now() + 10000; while (Date.now() < until && !ids.every(id => results.has(id))) await new Promise(r => setTimeout(r, 200));
    res.json(ids.map(id => ({ id, result: results.get(id) ?? { pending: true } })));
  });
  app.get('/dev/room/next', local, (req, res) => res.json(queue.splice(0)));
  app.post('/dev/room/result', local, express.json({ limit: '64kb' }), (req, res) => { results.set(req.body?.id, req.body?.result); res.json({ ok: true }); });
  console.info('[DevSandbox] enabled on port', port);
  return true;
}
module.exports = { enabled, install };
