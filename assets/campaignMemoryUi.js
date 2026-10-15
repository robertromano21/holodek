(function(root) {
  'use strict';
  const M = root.CampaignMemory;
  if (!M || !root.indexedDB) return;
  let opening, current = null, warned = false;
  const warning = error => { if (!warned) console.warn('[CampaignMemory]', error.message); warned = true; };
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = root.indexedDB.open('DungeonCampaignMemories', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('records', { keyPath: 'key' });
        store.createIndex('runId', 'runId');
        store.createIndex('room', ['runId', 'roomKey']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return opening;
  }
  function scan(db, storeName, index, scope, visit) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const request = tx.objectStore(storeName).index(index).openCursor(scope);
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        visit(cursor.value); cursor.continue();
      };
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || Error('Memory archive read failed.'));
    });
  }
  async function save(slot, records) {
    const db = await database();
    const valid = new Map();
    for (const row of records) {
      const record = M.normalize(row, slot.runId);
      if (record && M.canReplace(valid.get(record.id), record)) valid.set(record.id, record);
    }
    if (!valid.size) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['records'], 'readwrite'), store = tx.objectStore('records');
      const accepted = []; let added = 0;
      for (const record of valid.values()) {
        const key = `${slot.runId}:${record.id}`, request = store.get(key);
        request.onsuccess = () => {
          const previous = M.normalize(request.result, slot.runId);
          const chosen = M.canReplace(previous, record) ? record : previous;
          if (chosen === record) store.put({ ...record, key });
          if (!previous) added++;
          accepted.push(chosen);
        };
      }
      tx.oncomplete = () => { accepted.forEach(record => slot.index.add(record)); slot.count += added; resolve(); };
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Memory archive write failed.'));
    });
  }
  function begin(runId) {
    if (!runId || current?.runId === runId) return current;
    const slot = { runId, index: M.createIndex(runId), imported: false, count: 0, roomHeads: new Map() };
    current = slot;
    slot.ready = database().then(db => scan(db, 'records', 'runId', runId, record => {
      slot.index.add(record); slot.count++;
    })).catch(warning);
    return slot;
  }
  async function receive(event) {
    if (event.runId !== root.dungeonRunId) return;
    const slot = begin(event.runId);
    await slot.ready;
    if (current === slot && root.dungeonRunId === slot.runId) await save(slot, event.records || []);
  }
  async function rememberRoomTurn(row) {
    const runId = row.runId || root.dungeonRunId;
    if (runId !== root.dungeonRunId) return;
    const slot = begin(runId);
    if (!slot) return;
    await slot.ready;
    if (current !== slot || root.dungeonRunId !== runId) return;
    await save(slot, M.historyRecords(row, { runId, conversationId: row.conversationId, allowLegacy: false }));
  }
  async function importHistory(slot, source) {
    if (slot.imported || !source.db || !source.conversationId) return;
    // Old unscoped rows may be adopted by this one legacy run, never every new game.
    const legacyKey = `campaign-memory-legacy:${source.conversationId}`;
    const previousRun = root.localStorage.getItem(legacyKey);
    if (!previousRun) root.localStorage.setItem(legacyKey, slot.runId);
    const allowLegacy = !previousRun || previousRun === slot.runId;
    slot.allowLegacy = allowLegacy;
    let after = 0;
    while (current === slot) {
      const rows = await new Promise((resolve, reject) => {
        const tx = source.db.transaction(['conversation'], 'readonly'), rows = [];
        const request = tx.objectStore('conversation').index('conversationId').openCursor(source.conversationId);
        request.onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor || rows.length >= 64) return;
          if (cursor.primaryKey <= after) {
            cursor.continuePrimaryKey(source.conversationId, after + 1); return;
          }
          // Discard recursive transcript fields immediately instead of retaining 64 huge source rows.
          rows.push({ id: cursor.primaryKey, records: M.historyRecords({ ...cursor.value, id: cursor.primaryKey },
            { runId: slot.runId, conversationId: source.conversationId, allowLegacy }) }); cursor.continue();
        };
        tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(tx.error || Error('Room history import failed.'));
      });
      if (!rows.length) break;
      await save(slot, rows.flatMap(row => row.records));
      after = rows.at(-1).id;
      if (rows.length < 64) break;
    }
    slot.imported = current === slot;
  }
  async function searchArchive(slot, query, roomKey) {
    const options = { roomKey, limit: 6, maxChars: M.MAX_CONTEXT, maxText: 700 };
    if (slot.count <= M.MAX_RECORDS) return slot.index.search(query, options);
    // Search older pages too, keeping only top candidates in RAM when the campaign outgrows the hot index.
    const db = await database(), candidates = new Map(); let page = M.createIndex(slot.runId, [], 512);
    function finishPage() {
      for (const row of page.search(query, options)) candidates.set(row.id, page.get(row.id));
      if (candidates.size > 24) {
        const best = [...candidates.values()].sort((a, b) => b.score - a.score || b.turn - a.turn).slice(0, 24);
        candidates.clear(); best.forEach(row => candidates.set(row.id, row));
      }
      page = M.createIndex(slot.runId, [], 512);
    }
    await scan(db, 'records', 'runId', slot.runId, record => { page.add(record); if (page.size() >= 512) finishPage(); });
    finishPage();
    return M.createIndex(slot.runId, [...candidates.values()]).search(query, options);
  }
  async function prepare(query, source) {
    const slot = begin(root.dungeonRunId);
    if (!slot) return;
    await slot.ready; await importHistory(slot, source);
    // The room map remains the existing source of descriptions and complete per-room exchanges.
    for (const [geo, history] of Object.entries(source.roomHistories || {})) {
      const room = M.roomKey(geo);
      if (!room || !Array.isArray(history)) continue;
      const head = `${history.length}:${M.hash(M.clean(history.at(-1)?.response || history.at(-1)?.roomHistory, 24000))}`;
      if (slot.roomHeads.get(room) === head) continue;
      const rows = history.slice(-32).flatMap((row, i) => M.historyRecords({ ...row,
        id: `room:${room}:${i}:${M.hash(row.response || row.roomHistory || '')}`, geoKey: room },
      { runId: slot.runId, conversationId: source.conversationId, roomKey: room, allowLegacy: slot.allowLegacy === true }));
      await save(slot, rows);
      slot.roomHeads.set(room, head);
    }
    if (current !== slot || root.dungeonRunId !== slot.runId) return;
    const records = await searchArchive(slot, query, M.roomKey(source.roomKey));
    if (!records.length) return;
    const response = await fetch('/campaign-memory/recall', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: slot.runId, records }) });
    if (!response.ok && response.status !== 409) throw Error(`Recall unavailable: HTTP ${response.status}`);
  }
  root.DungeonCampaignMemory = { begin, receive: event => receive(event).catch(warning),
    rememberRoomTurn: row => rememberRoomTurn(row).catch(warning), prepare: (query, source) => prepare(query, source).catch(warning),
    search: async (query, roomKey) => { const slot = begin(root.dungeonRunId); if (!slot) return []; await slot.ready; return searchArchive(slot, query, roomKey); } };
})(typeof window === 'object' ? window : globalThis);
