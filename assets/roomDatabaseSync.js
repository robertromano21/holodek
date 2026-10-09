(function(root) {
  'use strict';
  function entries(json) {
    const value = JSON.parse(json || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid room database.');
    return new Map(Object.entries(value).map(([key, room]) => [key, JSON.stringify(room)]));
  }
  function createClient() {
    let token = null, baseline = null;
    return {
      prepare(json) {
        const next = entries(json);
        if (!baseline || !token) return { roomNameDatabaseString: json, roomDatabaseSync: { mode: 'full' } };
        const updates = {}, removed = [];
        for (const [key, room] of next) if (baseline.get(key) !== room) updates[key] = JSON.parse(room);
        for (const key of baseline.keys()) if (!next.has(key)) removed.push(key);
        return { roomDatabaseSync: { mode: 'patch', token, updates, removed } };
      },
      acknowledge(json, nextToken) {
        baseline = nextToken ? entries(json) : null;
        token = nextToken || null;
      },
      reset() { baseline = null; token = null; }
    };
  }
  const api = { createClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomDatabaseSync = api;
})(typeof window === 'undefined' ? globalThis : window);
