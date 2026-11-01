(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityCrowdCache = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const STAMPED = new Set(['cells', 'customTiles', 'tiles', 'sceneSpec', 'sceneStructures', 'sceneLandmarks', 'cityBlocks',
    'cityCirculation', 'cityBuildingEntrances', 'cityInteriorLayers', 'cityFloors']);
  const OMIT = new Set(['cityCrowd', '_lodCache', 'inhabitants']);
  function guard(dungeon) {
    const fields = Object.entries(dungeon).filter(([key]) => !OMIT.has(key));
    return { fields, mutable: JSON.stringify(fields.filter(([key, value]) => value && typeof value === 'object' && !STAMPED.has(key))) };
  }
  function same(a, b) {
    return !!a && !!b && a.mutable === b.mutable && a.fields.length === b.fields.length &&
      a.fields.every(([key, value], i) => key === b.fields[i][0] && Object.is(value, b.fields[i][1]));
  }
  function patch(database, data) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rooms', 'readwrite'), store = tx.objectStore('rooms'), request = store.get(data.key);
      let result = { status: 'conflict' };
      request.onsuccess = () => {
        const record = request.result;
        if (!record) { result = { status: 'missing' }; return; }
        if (typeof data.run !== 'string' || !data.run || data.key !== data.run + ':' + data.geoKey ||
          record.geoKey !== data.geoKey || record._geometryStamp !== data.stamp || record.cityFloorContext ||
          record.classification?.indoor !== false || record._meta?.runId && record._meta.runId !== data.run) return;
        let crowd; try { crowd = JSON.parse(data.crowd); } catch { return; }
        if (!crowd || !Number.isSafeInteger(crowd.revision) || crowd.revision < 0) return;
        const current = JSON.stringify(record.cityCrowd);
        if ((record.cityCrowd?.revision || 0) > crowd.revision) { result = { status: 'superseded', crowd: current }; return; }
        if (current === data.crowd) { result = { status: 'unchanged' }; return; }
        if (current !== data.expectedCrowd) return;
        // Mutate only the crowd inside the same read/write transaction; never replace cached geometry with a client snapshot.
        record.cityCrowd = crowd; store.put(record, data.key); result = { status: 'patched' };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Crowd cache transaction aborted.'));
    });
  }
  function seed(database, context, current, snapshot) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rooms', 'readwrite'), store = tx.objectStore('rooms'), request = store.get(context.key);
      let result = { status: 'conflict' };
      request.onsuccess = () => {
        if (request.result) return;
        if (!current()) { result = { status: 'skipped' }; return; }
        snapshot(); store.put(context.dungeon, context.key); result = { status: 'seeded' };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Crowd cache seed aborted.'));
    });
  }
  function bridge(root, url) {
    const worker = new root.Worker(url), pending = new Map(); let next = 0, closed = false;
    function close(message = 'Crowd cache worker closed.') {
      if (closed) return; closed = true;
      for (const value of pending.values()) { root.clearTimeout(value.timer); value.reject(Error(message)); }
      pending.clear(); worker.terminate();
    }
    worker.onerror = event => { event.preventDefault?.(); close(event.message || 'Crowd cache worker failed.'); };
    worker.onmessageerror = () => close('Crowd cache worker message failed.');
    worker.onmessage = event => {
      const value = pending.get(event.data?.id); if (!value) return;
      pending.delete(event.data.id); root.clearTimeout(value.timer);
      if (event.data.error) value.reject(Error(event.data.error)); else value.resolve(event.data.result);
    };
    return { call(data) {
      if (closed) return Promise.reject(Error('Crowd cache worker is unavailable.'));
      return new Promise((resolve, reject) => {
        const id = ++next, timer = root.setTimeout(() => close('Crowd cache worker timed out.'), 15000);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, type: 'patch', ...data }); }
        catch (error) { pending.delete(id); root.clearTimeout(timer); reject(error); }
      });
    }, close };
  }
  function create({ root, openDatabase, writeFull, current = () => root.currentDungeon,
    workerUrl = '/assets/cityCrowdCacheWorker.js?v=city-cache-1', transportFactory = () => bridge(root, workerUrl) }) {
    const queues = new Map(), saved = new WeakMap(); let sequence = 0, transport = null, failedWorker = false, disposed = false;
    const counts = { requests: 0, workerPatches: 0, mainThreadPatches: 0, fullSaves: 0, crowdFullFallbacks: 0,
      seeded: 0, conflicts: 0, superseded: 0, skipped: 0, workerFailures: 0, saveFailures: 0 };
    function capture(geoKey, dungeon) {
      const run = dungeon?._meta?.runId || root.dungeonRunId;
      if (!run || !dungeon || !geoKey) return null;
      return { dungeon, geoKey, run, key: run + ':' + (root.CityFloorScope?.cacheKey(geoKey, dungeon) || geoKey), token: root.CityFloorScope?.token?.() };
    }
    function isCurrent(context) {
      return current() === context.dungeon && context.dungeon.geoKey === context.geoKey && root.dungeonRunId === context.run && root.CityFloorScope?.token?.() === context.token &&
        capture(context.geoKey, context.dungeon)?.key === context.key;
    }
    function queue(key) {
      let row = queues.get(key);
      if (!row) { row = { key, epoch: 0, pending: 0, tail: Promise.resolve() }; queues.set(key, row); }
      return row;
    }
    function enqueue(row, operation) {
      row.pending++;
      const pending = row.tail.then(operation).catch(error => { counts.saveFailures++; throw error; });
      row.tail = pending.then(() => {}, () => {}).finally(() => {
        row.pending--;
        if (queues.size > 64) for (const [key, item] of queues) if (!item.pending && item !== row) {
          queues.delete(key); if (queues.size <= 64) break;
        }
      });
      return pending;
    }
    function snapshot(dungeon) { return { guard: guard(dungeon), crowd: JSON.stringify(dungeon.cityCrowd) }; }
    function remember(context, row, epoch, value) {
      if (value) saved.set(context.dungeon, { ...value, row, epoch, blocked: false });
    }
    async function fullSave(context, row, epoch, validate) {
      let value;
      const result = await writeFull(context.dungeon, context.key, validate, () => { value = snapshot(context.dungeon); });
      if (result?.status === 'skipped') { counts.skipped++; return result; }
      counts.fullSaves++; remember(context, row, epoch, value); return { status: 'saved' };
    }
    function full(geoKey, dungeon) {
      const context = capture(geoKey, dungeon); if (!context) return Promise.resolve({ status: 'skipped' });
      // Announce the full save before enqueueing it, invalidating older crowd fallbacks immediately.
      const row = queue(context.key), epoch = row.epoch = ++sequence;
      return enqueue(row, () => {
        if (root.dungeonRunId !== context.run) { counts.skipped++; return { status: 'skipped' }; }
        return fullSave(context, row, epoch, () => root.dungeonRunId === context.run && capture(context.geoKey, dungeon)?.key === context.key);
      });
    }
    function conflict(context, state) {
      counts.conflicts++;
      if (!state.blocked) root.console?.warn?.('[CityCrowdCache] Newer/different cached room retained; waiting for a native room save:', context.geoKey);
      state.blocked = true; return { status: 'conflict' };
    }
    function persist(dungeon = current()) {
      counts.requests++;
      const context = capture(dungeon?.geoKey, dungeon); if (!context) return Promise.resolve({ status: 'skipped' });
      const row = queue(context.key), epoch = row.epoch, legacy = disposed;
      return enqueue(row, async () => {
        if (root.dungeonRunId !== context.run || dungeon.geoKey !== context.geoKey || row.epoch !== epoch || capture(context.geoKey, dungeon)?.key !== context.key) {
          counts.superseded++; return { status: 'superseded' };
        }
        const state = saved.get(dungeon), eligible = dungeon.classification?.indoor === false && !dungeon.cityFloorContext &&
          !!dungeon.cityCrowd && !!dungeon._geometryStamp && context.key === context.run + ':' + context.geoKey;
        const validate = () => isCurrent(context) && row.epoch === epoch;
        if (eligible && state?.blocked) return { status: 'conflict' };
        if (!eligible || legacy || typeof root.Worker !== 'function' || !state || state.row !== row || state.epoch !== epoch || !same(state.guard, guard(dungeon))) {
          if (!validate()) { counts.skipped++; return { status: 'skipped' }; }
          counts.crowdFullFallbacks++; return fullSave(context, row, epoch, validate);
        }
        if (state.blocked) return { status: 'conflict' };
        const value = snapshot(dungeon), data = { key: context.key, run: context.run, geoKey: context.geoKey, stamp: dungeon._geometryStamp,
          expectedCrowd: state.crowd, crowd: value.crowd };
        let result, onWorker = false;
        if (!failedWorker) {
          try { transport ||= transportFactory(); result = await transport.call(data); onWorker = true; }
          catch { counts.workerFailures++; failedWorker = true; transport?.close(); transport = null; }
        }
        if (!result) result = await patch(await openDatabase(), data);
        if (result.status === 'patched' || result.status === 'unchanged') {
          if (result.status === 'patched') counts[onWorker ? 'workerPatches' : 'mainThreadPatches']++;
          remember(context, row, epoch, value); return result;
        }
        if (result.status === 'superseded') {
          counts.superseded++; remember(context, row, epoch, { guard: value.guard, crowd: result.crowd }); return result;
        }
        if (result.status === 'missing') {
          let captured;
          result = await seed(await openDatabase(), context, validate, () => { captured = snapshot(dungeon); });
          if (result.status === 'seeded') { counts.seeded++; remember(context, row, epoch, captured); return result; }
          if (result.status === 'skipped') { counts.skipped++; return result; }
        }
        return conflict(context, state);
      });
    }
    return { full, persist, diagnostics: () => ({ ...counts, keys: queues.size, queued: [...queues.values()].reduce((n, row) => n + row.pending, 0), workerFailed: failedWorker }),
      async drain() { for (const row of queues.values()) await row.tail; },
      async dispose() { disposed = true; for (const row of queues.values()) await row.tail; transport?.close(); transport = null; } };
  }
  function installWorker(root) {
    let database = null, tail = Promise.resolve();
    function open() {
      if (database) return database;
      database = new Promise((resolve, reject) => {
        const request = root.indexedDB.open('cotg-dungeons', 2);
        request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Existing room cache required; worker schema changes are disabled.')); };
        request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Room cache is blocked.'));
        request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      }); return database;
    }
    root.onmessage = event => {
      const data = event.data;
      tail = tail.then(async () => {
        try {
          if (data?.type !== 'patch' || !Number.isSafeInteger(data.id)) throw Error('Invalid crowd cache request.');
          root.postMessage({ id: data.id, result: await patch(await open(), data) });
        } catch (error) { root.postMessage({ id: data?.id, error: error.message }); }
      });
    };
  }
  return { guard, same, patch, seed, bridge, create, installWorker };
});
