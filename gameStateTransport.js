'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const STATE_JSON_LIMIT = '32mb';

function createGameJsonParser() {
  const stateParser = express.json({ limit: STATE_JSON_LIMIT });
  const ordinaryParser = express.json({ limit: '2mb' });
  return (req, res, next) => (['/updateState7', '/startGameWithCharacter'].includes(req.path) ? stateParser : ordinaryParser)(req, res, next);
}

function gameJsonErrorHandler(error, req, res, next) {
  if (error.type !== 'entity.too.large' && error.type !== 'entity.parse.failed') return next(error);
  const status = error.type === 'entity.too.large' ? 413 : 400;
  console.error('[StateSyncRejected]', JSON.stringify({
    path: req.path, status, bytes: error.length || Number(req.get('Content-Length')) || null,
    limit: error.limit || null
  }));
  res.status(status).json({ error: status === 413 ? 'Game state exceeds the request size limit.' : 'Invalid JSON game state.' });
}

function createRoomDatabaseReceiver() {
  let token = null;
  return {
    reset() { token = null; },
    apply(payload, currentJson) {
      const sync = payload.roomDatabaseSync;
      if (sync?.mode === 'patch') {
        if (!token || sync.token !== token) {
          const error = new Error('The server needs the browser room database again.');
          error.code = 'ROOM_DATABASE_SYNC_REQUIRED';
          throw error;
        }
        if (!sync.updates || typeof sync.updates !== 'object' || Array.isArray(sync.updates) || !Array.isArray(sync.removed)) throw new Error('Invalid room database patch.');
        const keys = [...Object.keys(sync.updates), ...sync.removed];
        if (keys.some(key => typeof key !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(key))) throw new Error('Invalid room coordinate in patch.');
        const next = { ...JSON.parse(currentJson || '{}') };
        for (const [key, room] of Object.entries(sync.updates)) next[key] = room;
        for (const key of sync.removed) delete next[key];
        return { json: JSON.stringify(next), token, mode: 'patch', changedRooms: keys.length };
      }
      if (payload.roomNameDatabaseString === undefined) return null;
      const next = JSON.parse(payload.roomNameDatabaseString || '{}');
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Invalid room database.');
      token = randomUUID();
      return { json: payload.roomNameDatabaseString, token, mode: 'full', changedRooms: Object.keys(next).length };
    }
  };
}

module.exports = { createGameJsonParser, gameJsonErrorHandler, createRoomDatabaseReceiver, STATE_JSON_LIMIT };
