'use strict';
// Only the displayed, authoritative room can unlock background preparation.
function install(app, sharedState, { adjacent = null, models = require('./gameModels'),
  website = require('./websiteAi').service() } = {}) {
  const full = !adjacent;
  adjacent ||= require('./roomBuildQueue').service(sharedState);
  require('./adjacentRoomSnapshots').install(app, sharedState, { models, adjacent });
  if (app.get) app.get('/room-build-status', (_req, res) => res.json({ runId: sharedState.getDungeonRunId(), rooms: adjacent.status?.() || [] }));
  const seen = new Set(), rejected = new Set(); let run = null;
  app.post('/room-displayed', (req, res) => {
    const body = req.body || {}, activeRun = sharedState.getDungeonRunId();
    if (body.runId !== activeRun || !activeRun) return res.status(409).json({ error: 'That game is no longer active.' });
    if (run !== activeRun) { seen.clear(); rejected.clear(); adjacent._reset(); run = activeRun; }
    const coordinates = sharedState.getLastCoords(), key = `${coordinates.x},${coordinates.y},${coordinates.z}`;
    const dungeon = sharedState.getRoomDungeonForSimulation ? sharedState.getRoomDungeonForSimulation(coordinates) : sharedState.getRoomDungeon(coordinates);
    if (body.geoKey !== key || !body.geometryStamp || body.geometryStamp !== dungeon?._geometryStamp) {
      const reason = body.geoKey !== key ? 'wrong-room' : 'geometry-stamp-mismatch';
      const identity = JSON.stringify([key, String(body.geometryStamp).slice(0, 100), reason]);
      if (!rejected.has(identity)) {
        rejected.add(identity); while (rejected.size > 32) rejected.delete(rejected.values().next().value);
        console.warn('[RoomPrefetch]', JSON.stringify({ phase: 'rejected', reason, geoKey: key,
          clientStamp: String(body.geometryStamp || '').slice(0, 100), serverStamp: dungeon?._geometryStamp || null }));
      }
      return res.status(409).json({ error: 'That room is not the active constructed room.' });
    }
    if (!website.backgroundEnabled()) return res.json({ queued: [], enabled: false });
    const identity = `${key}|${body.geometryStamp}|${website.view().revision}`;
    if (seen.has(identity)) return res.json({ queued: [], duplicate: true });
    try {
      const db = JSON.parse(sharedState.getRoomNameDatabase() || '{}'), room = db[key];
      if (!room || !room.description && !room.roomDescription && !room.sceneSpec?.source?.description)
        return res.status(409).json({ error: 'The current room is not ready.' });
      if (full && room.visited !== true) {
        room.visited = true;
        sharedState.setRoomNameDatabase(JSON.stringify(db));
      }
      const queued = models.withSnapshot(() => adjacent.queueNeighbors({ db, currentKey: key, exits: Object.keys(room.exits || {}),
        runId: activeRun, context: room.description || room.roomDescription || room.sceneSpec?.source?.description || '' }));
      seen.add(identity); while (seen.size > 64) seen.delete(seen.values().next().value);
      console.info('[RoomPrefetch]', JSON.stringify({ phase: 'accepted', geoKey: key, runId: activeRun,
        model: models.current?.().id || null, queued, preparation: full ? 'complete-rooms' : 'descriptions' }));
      res.json({ queued, enabled: true, preparation: full ? 'complete-rooms' : 'descriptions' });
    } catch { res.status(503).json({ error: 'Background preparation unavailable; room entry remains available.' }); }
  });
}
module.exports = { install };
