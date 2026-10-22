'use strict';
function assertCompatible(connection, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '') || connection?.engineHash !== expected || connection?.roomWorkers !== 3 ||
      !Array.isArray(connection?.pool) || connection.pool.length !== 3 || connection.pool.some(node => node.engineHash !== expected))
    throw Object.assign(Error('Room helper engine does not match this PC release. Reconnect Website AI after the coordinated worker update; no room request was dispatched.'),
      { code: 'ROOM_ENGINE_MISMATCH', recoverable: false });
  return true;
}
module.exports = { assertCompatible };
