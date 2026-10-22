(function(root) {
  'use strict';
  let scheduled = null, sent = '', retryAt = 0, lastFailure = '';
  function failed(identity, packet, reason) {
    retryAt = Date.now() + 15000;
    const failure = identity + '|' + reason;
    if (failure !== lastFailure) root.console?.warn?.('[RoomPrefetch]', { phase: 'retry', geoKey: packet.geoKey, reason });
    lastFailure = failure;
  }
  function shown(dungeon) {
    if (!dungeon?.geoKey || !dungeon._geometryStamp || !root.dungeonRunId || typeof root.fetch !== 'function') return;
    const packet = { geoKey: dungeon.geoKey, geometryStamp: dungeon._geometryStamp, runId: root.dungeonRunId };
    const identity = JSON.stringify(packet);
    if (identity === sent || scheduled || Date.now() < retryAt) return;
    scheduled = identity;
    // Let a rendered frame reach the display before starting speculative work.
    root.requestAnimationFrame(() => root.requestAnimationFrame(async () => {
      if (scheduled !== identity) return;
      try {
        if (root.currentDungeon !== dungeon || root.dungeonRunId !== packet.runId) return;
        const response = await root.fetch('/room-displayed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: identity, signal: AbortSignal.timeout(10000) });
        if (response.ok) { sent = identity; lastFailure = ''; }
        else failed(identity, packet, `Display acknowledgement rejected (HTTP ${response.status}).`);
      } catch { failed(identity, packet, 'Display acknowledgement could not reach the game server.'); }
      finally { if (scheduled === identity) scheduled = null; }
    }));
  }
  root.WebsiteRoomReady = { shown };
  root.addEventListener('holodek:website-ai-changed', () => { sent = ''; retryAt = 0; lastFailure = ''; scheduled = null; shown(root.currentDungeon); });
})(window);
