(function(root) { 'use strict';
const cache = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const normalize = s => s.replace(/\r\n/g, '\n').trim();
  const round = n => Math.round(n * 100) / 100;
  function sources(game) {
    game = normalize(game);
    const take = (start, end) => {
      if (game.split(start).length !== 2 || game.split(end).length !== 2) throw Error('Crowd-cache source boundaries changed.');
      return game.slice(game.indexOf(start), game.indexOf(end, game.indexOf(start) + start.length)).trim();
    };
    return { get: take('async function idbGetDungeon(', '\nasync function idbSetDungeon('),
      open: take('function openDungeonDB()', '\nasync function idbGetDungeon(') };
  }
  function scope(root, dungeon = root.currentDungeon) {
    const run = dungeon?._meta?.runId || root.dungeonRunId;
    if (!run || run !== root.dungeonRunId || !dungeon?.geoKey || !dungeon._geometryStamp || !dungeon.cityCrowd ||
      dungeon.classification?.indoor !== false || dungeon.cityFloorContext) throw Error('Use the outdoor host city with a stamped crowd.');
    const key = run + ':' + (root.CityFloorScope?.cacheKey(dungeon.geoKey, dungeon) || dungeon.geoKey);
    return { dungeon, run, key, geoKey: dungeon.geoKey, stamp: dungeon._geometryStamp, floor: root.CityFloorScope?.token?.() };
  }
  function guard(dungeon) {
    return { fields: Object.entries(dungeon).filter(([key]) => key !== 'cityCrowd' && key !== '_lodCache'),
      mutable: JSON.stringify(['sceneObjects', 'physicalPuzzle', 'secretDoors', 'actionAttempts', 'livingEncounter', 'start', '_world1Start', '_meta']
        .map(key => [key, dungeon[key]])) };
  }
  function same(a, b) {
    return !!a && a.mutable === b.mutable && a.fields.length === b.fields.length &&
      a.fields.every(([key, value], i) => key === b.fields[i][0] && Object.is(value, b.fields[i][1]));
  }
  function staticText(record) {
    // The normal reader overlays inhabitants from its existing population store.
    return JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'cityCrowd' && key !== 'inhabitants')));
  }
  async function digest(root, text) {
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(text))))
      .map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function fullWrite(root, context) {
    return root.openDungeonDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('rooms', 'readwrite');
      // Freeze the original run/floor key rather than consulting a potentially changed active floor later.
      tx.objectStore('rooms').put(context.dungeon, context.key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Full cache save aborted.'));
    }));
  }
  function bridge(root, workerSource) {
    const url = root.URL.createObjectURL(new root.Blob([workerSource], { type: 'application/javascript' }));
    let worker; try { worker = new root.Worker(url); } finally { root.URL.revokeObjectURL(url); }
    let sequence = 0, closed = false; const pending = new Map();
    const rejectAll = error => { for (const p of pending.values()) { root.clearTimeout(p.timer); p.reject(error); } pending.clear(); };
    worker.onerror = event => { event.preventDefault?.(); closed = true; rejectAll(Error(event.message || 'Crowd-cache worker failed.')); worker.terminate(); };
    worker.onmessage = event => {
      const p = pending.get(event.data?.id); if (!p) return;
      pending.delete(event.data.id); root.clearTimeout(p.timer);
      if (event.data.error) p.reject(Error(event.data.error)); else p.resolve(event.data.result);
    };
    return { call(type, payload) {
      if (closed) return Promise.reject(Error('Crowd-cache worker is closed.'));
      return new Promise((resolve, reject) => {
        const id = ++sequence, timer = root.setTimeout(() => { pending.delete(id); reject(Error('Crowd-cache worker timed out.')); }, 15000);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, type, ...payload }); } catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error); }
      });
    }, close() { closed = true; rejectAll(Error('Crowd-cache worker closed.')); worker.terminate(); } };
  }
  function manager(root, context, transport, initialGuard) {
    let known = initialGuard, expectedCrowd = JSON.stringify(context.dungeon.cityCrowd), tail = Promise.resolve(), stopped = false, lastResult = null, durabilityFailure = null;
    const newCounts = () => ({ requests: 0, patchAttempts: 0, patchesCommitted: 0, superseded: 0, fullFallbacks: 0, failures: 0,
      payloadCharacters: 0, largestPayloadCharacters: 0, workerPutMs: 0, mainDispatchMs: 0, inFlightFromWarmup: 0 });
    let counts = newCounts(), inFlight = 0;
    function invalidate() { known = null; }
    function write() {
      if (stopped) return fullWrite(root, context);
      const stats = counts; stats.requests++;
      let text, capturedGuard;
      try { text = JSON.stringify(context.dungeon.cityCrowd); capturedGuard = guard(context.dungeon); }
      catch (error) { stats.failures++; durabilityFailure = error.message; return Promise.reject(error); }
      const run = async () => {
        if (same(known, capturedGuard) && same(capturedGuard, guard(context.dungeon))) {
          try {
            const payload = { key: context.key, run: context.run, geoKey: context.geoKey, stamp: context.dungeon._geometryStamp,
              expectedCrowd, crowd: text };
            stats.patchAttempts++; stats.payloadCharacters += text.length; stats.largestPayloadCharacters = Math.max(stats.largestPayloadCharacters, text.length);
            const at = root.performance.now(), pending = transport.call('patch', payload);
            stats.mainDispatchMs += root.performance.now() - at;
            const result = await pending;
            if (result.status === 'patched' || result.status === 'superseded') {
              expectedCrowd = result.crowd; lastResult = result;
              stats.workerPutMs += result.workerPutMs || 0;
              if (result.status === 'patched') stats.patchesCommitted++; else stats.superseded++;
              durabilityFailure = null;
              return;
            }
          } catch { stats.failures++; }
        }
        stats.fullFallbacks++;
        const before = guard(context.dungeon);
        try { await fullWrite(root, context); }
        catch (error) { stats.failures++; durabilityFailure = error.message; throw error; }
        known = same(before, guard(context.dungeon)) ? before : null;
        expectedCrowd = JSON.stringify(context.dungeon.cityCrowd); lastResult = null; durabilityFailure = null;
      };
      inFlight++;
      const pending = tail.then(run).then(value => { inFlight--; return value; }, error => { inFlight--; throw error; });
      tail = pending.catch(() => {}); return pending;
    }
    return { write, invalidate, drain: () => tail, stop() { stopped = true; },
      reset() { counts = newCounts(); counts.inFlightFromWarmup = inFlight; },
      diagnostics: () => ({ ...counts, workerPutMs: round(counts.workerPutMs), mainDispatchMs: round(counts.mainDispatchMs) }),
      async verify() {
        await tail;
        if (durabilityFailure) return { checked: false, valid: false, reason: 'An accepted cache write failed: ' + durabilityFailure };
        if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor)
          return { checked: false, reason: 'Active run/room/floor changed; legacy reader verification skipped.' };
        const authoritative = await transport.call('inspect', { key: context.key });
        const loaded = await root.idbGetDungeon(context.geoKey);
        if (!loaded) return { checked: true, valid: false, reason: 'The original cache reader returned no room.' };
        const hash = await digest(root, staticText(loaded)), crowd = JSON.stringify(loaded.cityCrowd);
        const matchesLastPatch = !lastResult?.staticHash || lastResult.staticHash === authoritative.staticHash;
        const valid = hash === authoritative.staticHash && crowd === authoritative.crowd && matchesLastPatch;
        return { checked: true, valid, originalReaderUsed: true, staticRoomPreserved: hash === authoritative.staticHash && matchesLastPatch,
          crowdPreserved: crowd === authoritative.crowd, matchesLastPatch, patchesCommitted: counts.patchesCommitted,
          lastPatchStaticHash: lastResult?.staticHash || null, reloadStaticHash: hash,
          reason: valid ? null : 'The cache changed between reads or reload data differed; this result is not verified.' };
      } };
  }
  function preflight(root, expected) {
    for (const [key, name] of [['persistCityCrowd', 'persist'], ['idbSetDungeon', 'idb'], ['idbGetDungeon', 'get'], ['openDungeonDB', 'open']])
      if (typeof root[key] !== 'function' || normalize(root[key].toString()) !== expected[name]) throw Error('Running cache method differs from verified source: ' + key);
    if (typeof root.Worker !== 'function' || !root.crypto?.subtle || !root.TextEncoder) throw Error('Worker and cryptographic reload verification are required. No unsafe fallback installation.');
  }
  async function prepare(root, expected) {
    preflight(root, expected);
    const context = scope(root), before = guard(context.dungeon);
    await root.idbSetDungeon(context.geoKey, context.dungeon);
    if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor ||
      !same(before, guard(context.dungeon))) throw Error('City changed during cache setup. Click the capture again.');
    return { context, initialGuard: before };
  }
  if (typeof module === 'object' && module.exports) module.exports = { sources, scope, guard, same, staticText, digest, fullWrite, bridge, manager, preflight, prepare };
})();

return module.exports; })();
const travel = (() => { const module = { exports: {} };
(function() {
  'use strict';
  function location(root, dungeon = root.currentDungeon) {
    const run = dungeon?._meta?.runId || root.dungeonRunId;
    if (!run || run !== root.dungeonRunId || !dungeon?.geoKey || !dungeon.cells || !dungeon.layout) return null;
    const localKey = root.CityFloorScope.cacheKey(dungeon.geoKey, dungeon);
    if (dungeon === root.currentDungeon && localKey !== root.CityFloorScope.cacheKey(dungeon.geoKey)) return null;
    const ref = dungeon.cityFloorContext;
    return { dungeon, run, geoKey: dungeon.geoKey, localKey, key: run + ':' + localKey,
      floor: ref ? { hostKey: ref.hostKey, buildingId: ref.buildingId, floor: ref.floor } : null,
      token: root.CityFloorScope.token(), city: !ref && dungeon.classification?.indoor === false && !!dungeon.cityCrowd && !!dungeon._geometryStamp };
  }
  function current(root, context) {
    const active = location(root);
    return !!active && active.key === context.key && active.dungeon === context.dungeon && active.token === context.token;
  }
  function frozenReader(root, source, context) {
    // Run the source-identical loader with captured bindings, without changing the live run or floor.
    const window = { dungeonRunId: context.run, CityFloorScope: { cacheKey(key) {
      if (key !== context.geoKey) throw Error('Unexpected captured-reader coordinates.');
      return context.localKey;
    } } };
    return Function('window', 'openDungeonDB', 'DUNGEON_STORE', 'DUNGEON_INHABITANTS_STORE',
      '"use strict"; return (' + source + ');')(window, root.openDungeonDB.bind(root), 'rooms', 'inhabitants');
  }
  function coverage(events, initialKey) {
    const result = { floorEntry: false, floorUp: false, floorDown: false, streetReturn: false, roomDeparture: false, roomReturn: false };
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1], b = events[i];
      if (a.geoKey !== b.geoKey) result.roomDeparture = true;
      if (result.roomDeparture && b.key === initialKey) result.roomReturn = true;
      if (!a.floor && b.floor && a.geoKey === b.floor.hostKey) result.floorEntry = true;
      if (a.floor && !b.floor && b.geoKey === a.floor.hostKey) result.streetReturn = true;
      if (a.floor && b.floor && a.floor.hostKey === b.floor.hostKey && a.floor.buildingId === b.floor.buildingId) {
        if (b.floor.floor > a.floor.floor) result.floorUp = true;
        if (b.floor.floor < a.floor.floor) result.floorDown = true;
      }
    }
    return result;
  }
  function start(root, cache, expected, transport, notify = () => {}) {
    cache.preflight(root, expected);
    if (!root.CityFloorScope?.cacheKey || !root.CityFloorScope?.token || typeof root.IDBObjectStore?.prototype?.put !== 'function')
      throw Error('Floor-aware cache and IndexedDB hooks are required.');
    for (const name of ['cacheKey', 'token']) if (root.CityFloorScope[name].toString() !== expected.floor[name])
      throw Error('Running floor cache method differs from verified source: ' + name);
    const initial = location(root);
    if (!initial?.city) throw Error('Start outdoors in a city, before entering a building.');
    const original = root.persistCityCrowd, proto = root.IDBObjectStore.prototype, nativePut = proto.put;
    const entries = new Map(), states = new Set(), nativePending = new Set(), events = [], errors = [];
    let active = true, closed = null, last = null, timer = null, pending = 0, boundaryPending = 0, fullPuts = 0, nativeRequests = 0;
    function error(message) { if (errors.length < 12 && !errors.includes(message)) errors.push(message); }
    function entry(context) {
      let value = entries.get(context.key);
      if (!value) {
        if (entries.size >= 24) throw Error('Transition test reached its 24-location limit. Finish and verify.');
        value = { context, epoch: 0, visits: 0, fullPuts: 0, lastPatch: null, state: null };
        entries.set(context.key, value);
      }
      return value;
    }
    function observe() {
      if (!active) return null;
      if (root.dungeonRunId !== initial.run) { error('Run changed during the transition test.'); return null; }
      const context = location(root); if (!context) return null;
      const value = entry(context);
      if (!last || last.key !== context.key || last.dungeon !== context.dungeon || last.token !== context.token) {
        if (!last || last.key !== context.key) {
          if (events.length >= 48) throw Error('Transition test reached its 48-transition limit. Finish and verify.');
          if (last && pending) boundaryPending++;
          events.push({ key: context.key, geoKey: context.geoKey, floor: context.floor, pending }); value.visits++;
        }
        if (value.state?.context.dungeon !== context.dungeon || value.state?.context.token !== context.token) {
          value.state?.manager.invalidate(); value.state = null;
        }
        last = context; notify();
      }
      return { context, value };
    }
    function makeState(context, value) {
      let state;
      // Full-save fallback is permitted only while this exact room/floor is still active.
      const safeRoot = { performance: root.performance, openDungeonDB: async () => {
        const db = await root.openDungeonDB();
        return { transaction(...args) {
          if (!current(root, context)) throw Error('Stale full-save fallback blocked after a room/floor change.');
          if (state.foreignWrite) throw Error('Stale full-save fallback blocked after a different room snapshot was saved.');
          return db.transaction(...args);
        } };
      } };
      const channel = { async call(type, data) {
        const epoch = value.epoch;
        const result = await transport.call(type, data);
        if (type === 'patch' && result.status === 'patched') value.lastPatch = { epoch, staticHash: result.staticHash, crowd: result.crowd };
        return result;
      } };
      state = { context, foreignWrite: false, manager: cache.manager(safeRoot, context, channel, null) };
      states.add(state); value.state = state; return state;
    }
    const put = function(...args) {
      const [dungeon, key] = args;
      try { if (this.name === 'rooms' && dungeon?.geoKey && dungeon.cells && dungeon.layout && typeof key === 'string' && key.startsWith(initial.run + ':')) {
        const localKey = root.CityFloorScope.cacheKey(dungeon.geoKey, dungeon);
        if (key !== initial.run + ':' + localKey || dungeon._meta?.runId && dungeon._meta.runId !== initial.run)
          error('Native room write used a mismatched run/floor key.');
        const value = entry({ dungeon, key, localKey, run: initial.run, geoKey: dungeon.geoKey,
          floor: dungeon.cityFloorContext ? { ...dungeon.cityFloorContext } : null, token: null });
        value.epoch++; value.fullPuts++; fullPuts++;
        // Invalidate every old pointer for this key, not just the most recently visited one.
        for (const state of states) if (state.context.key === key) {
          state.manager.invalidate();
          if (dungeon !== state.context.dungeon) state.foreignWrite = true;
        }
      } } catch (e) { error('Native-write observation failed: ' + e.message); }
      return nativePut.apply(this, args);
    };
    const persist = function(...args) {
      if (!active || args.length) return original.apply(this, args);
      let found;
      try { found = observe(); } catch (e) { error(e.message); return original.apply(this, args); }
      if (!found?.context.city) {
        nativeRequests++;
        const result = original.apply(this, args), pending = Promise.resolve(result);
        nativePending.add(pending);
        pending.then(() => nativePending.delete(pending), e => { nativePending.delete(pending); error(e.message); });
        return result;
      }
      const { context, value } = found, state = value.state || makeState(context, value);
      pending++;
      return state.manager.write().catch(e => { error(e.message); root.console.warn('[CityCacheTransitionTrial]', e.message); })
        .finally(() => { pending--; });
    };
    function stats() {
      const totals = { requests: 0, patchesCommitted: 0, fullFallbacks: 0, failures: 0, superseded: 0 };
      for (const state of states) { const counts = state.manager.diagnostics(); for (const key of Object.keys(totals)) totals[key] += counts[key]; }
      return { ...totals, pending, boundaryPending, fullPuts, nativeRequests, locations: entries.size,
        coverage: coverage(events, initial.key), errors: [...errors] };
    }
    async function audit(value) {
      const context = value.context;
      const epoch = value.epoch, before = await transport.call('inspect', { key: context.key });
      const activeContext = location(root), useActive = activeContext?.key === context.key;
      const read = useActive ? root.idbGetDungeon.bind(root) : frozenReader(root, expected.get, context);
      const loaded = await read(context.geoKey);
      const after = await transport.call('inspect', { key: context.key });
      if (!loaded) return { key: context.key, valid: false, reason: 'Original cache reader returned no room.' };
      const stable = epoch === value.epoch && before.staticHash === after.staticHash && before.crowd === after.crowd;
      const hash = await cache.digest(root, cache.staticText(loaded));
      const staticMatches = hash === after.staticHash, crowdMatches = JSON.stringify(loaded.cityCrowd) === after.crowd;
      const floor = loaded.cityFloorContext || null, expectedFloor = context.floor;
      const identityMatches = loaded.geoKey === context.geoKey && (!loaded._meta?.runId || loaded._meta.runId === context.run) &&
        (expectedFloor ? floor?.hostKey === expectedFloor.hostKey && floor?.buildingId === expectedFloor.buildingId && floor?.floor === expectedFloor.floor : !floor);
      const checkLastPatch = !!value.lastPatch && value.lastPatch.epoch === epoch;
      const lastPatchMatches = !checkLastPatch || value.lastPatch.staticHash === hash && value.lastPatch.crowd === after.crowd;
      return { key: context.key, valid: stable && staticMatches && crowdMatches && identityMatches && lastPatchMatches,
        stable, identityMatches, staticMatches, crowdMatches, lastPatchChecked: checkLastPatch, lastPatchMatches,
        nativeActiveReader: useActive, capturedReaderSameSource: !useActive, visits: value.visits, nativeFullPuts: value.fullPuts,
        staticHash: hash, reason: stable ? (lastPatchMatches ? null : 'Cache changed since the last patch without an observed full save.') : 'Cache changed during verification; not verified.' };
    }
    function stop(reason = 'finished') {
      if (closed) return closed;
      try { observe(); } catch (e) { error(e.message); }
      if (root.persistCityCrowd !== persist || proto.put !== put) error('A test hook was replaced during travel.');
      active = false; root.clearInterval(timer);
      if (root.persistCityCrowd === persist) root.persistCityCrowd = original;
      // Keep observing native puts through the final reads so concurrent writes cannot produce a false pass.
      for (const state of states) state.manager.stop();
      closed = (async () => {
        const audits = [];
        try {
          for (const state of states) await state.manager.drain();
          await Promise.allSettled([...nativePending]);
          for (const value of entries.values()) {
            try { audits.push(await audit(value)); }
            catch (e) { audits.push({ key: value.context.key, valid: false, reason: e.message }); }
          }
          const counts = stats(), exercised = counts.patchesCommitted > 0;
          const complete = Object.values(counts.coverage).every(Boolean);
          return { kind: 'city-cache-transition', version: 1, reason, ...counts, events, audits, optimizedPathExercised: exercised,
            valid: errors.length === 0 && counts.failures === 0 && audits.length > 0 && audits.every(a => a.valid),
            complete, queueBoundaryObserved: boundaryPending > 0,
            policy: 'Outdoor city crowd patches only. Floor and non-city writes retain the native path. All cache keys are captured; no schema changes, movement, forced encounters, content requests or hard reloads. Reader checks occur after accepted writes drain. This is not an FPS benchmark.' };
        } finally { if (proto.put === put) proto.put = nativePut; transport.close(); }
      })();
      return closed;
    }
    try {
      root.persistCityCrowd = persist; proto.put = put;
      if (root.persistCityCrowd !== persist || proto.put !== put) throw Error('Cache hooks are not writable.');
      observe();
      timer = root.setInterval(() => {
        try { observe(); if (root.dungeonRunId !== initial.run) notify('Run changed. Finish verification; do not start another world during a test.'); }
        catch (e) { error(e.message); notify(e.message); }
      }, 150);
    } catch (e) {
      active = false; if (root.persistCityCrowd === persist) root.persistCityCrowd = original;
      if (proto.put === put) proto.put = nativePut; transport.close(); throw e;
    }
    return { stop, stats, active: () => active };
  }
  if (typeof module === 'object' && module.exports) module.exports = { location, current, frozenReader, coverage, start };
})();

return module.exports; })();
const core = (() => { const module = { exports: {} };
(function() {
  'use strict';
  function context(root, key) {
    const prefix = root.dungeonRunId + ':';
    if (typeof key !== 'string' || !key.startsWith(prefix)) throw Error('Saved route belongs to a different world.');
    const localKey = key.slice(prefix.length), match = /^(-?\d+,-?\d+,-?\d+)(?::building:(.+):floor:(-?\d+))?$/.exec(localKey);
    if (!match) throw Error('Saved route contains an invalid cache key.');
    const floor = match[2] ? { hostKey: match[1], buildingId: match[2], floor: Number(match[3]) } : null;
    if (!Number.isSafeInteger(floor?.floor ?? 0) || root.CityFloorScope.cacheKey(match[1], { cityFloorContext: floor }) !== localKey)
      throw Error('Saved route cache key does not match the native floor scope.');
    return { key, localKey, run: root.dungeonRunId, geoKey: match[1], floor };
  }
  function select(root, reference) {
    const saved = root.CityCacheTransitionTrial?.results?.findLast(r => r.complete && r.audits?.length &&
      r.audits.every(a => typeof a.key === 'string' && a.key.startsWith(root.dungeonRunId + ':')));
    const route = saved || reference;
    if (!saved && reference.run !== root.dungeonRunId) throw Error('The saved route is for another world. Keep the tested world open; no need to repeat its route.');
    if (!route.complete || !route.audits?.length || route.audits.length > 24) throw Error('No completed route is available to recheck.');
    const rows = route.audits.map(a => ({ ...context(root, a.key), previousValid: a.valid === true, previousStaticHash: a.staticHash || null }));
    if (new Set(rows.map(r => r.key)).size !== rows.length) throw Error('Saved route contains duplicate cache keys.');
    return { source: saved ? 'browser-completed-route' : 'packaged-server-log-reference', rows,
      historical: { complete: route.complete, requests: route.requests, patchesCommitted: route.patchesCommitted,
        fullFallbacks: route.fullFallbacks, failures: route.failures, errors: route.errors || [], queueBoundaryObserved: route.queueBoundaryObserved } };
  }
  function preflight(root, cache, expected) {
    cache.preflight(root, expected);
    for (const name of ['cacheKey', 'token']) if (root.CityFloorScope?.[name]?.toString() !== expected.floor[name])
      throw Error('Running floor cache method differs from verified source: ' + name);
    if (!root.gamePaused) throw Error('Pause with P before running the audit. It will not change your pause state.');
    const phase = root.CityCacheTransitionTrial?.status?.().phase;
    if (['waiting', 'running', 'verifying'].includes(phase)) throw Error('Finish or close the active travel test before running the audit-only check.');
  }
  async function run(root, cache, travel, expected, reference, transport, options = {}) {
    const sleep = options.sleep || (ms => new Promise(resolve => root.setTimeout(resolve, ms)));
    const quietMs = options.quietMs ?? 750, maxAttempts = options.maxAttempts ?? 4, report = options.progress || (() => {});
    try {
      preflight(root, cache, expected);
      const selected = select(root, reference), initial = travel.location(root);
      if (!initial) throw Error('Wait for the current room/floor to finish loading, then retry the audit.');
      const guard = () => {
        const current = travel.location(root);
        if (!root.gamePaused || root.dungeonRunId !== initial.run || current?.key !== initial.key || current?.token !== initial.token || current?.dungeon !== initial.dungeon)
          throw Error('Room, floor, world or pause state changed during the audit. No cache data was modified.');
      };
      const audits = [];
      for (const row of selected.rows) {
        let result;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          guard(); report({ location: audits.length + 1, total: selected.rows.length, attempt, maxAttempts });
          const before = await transport.call('inspect', { key: row.key });
          guard(); await sleep(quietMs); guard();
          const useActive = row.key === initial.key;
          const reader = useActive ? root.idbGetDungeon.bind(root) : travel.frozenReader(root, expected.get, row);
          const loaded = await reader(row.geoKey); guard();
          const after = await transport.call('inspect', { key: row.key }); guard();
          const stable = before.staticHash === after.staticHash && before.crowd === after.crowd;
          const hash = loaded ? await cache.digest(root, cache.staticText(loaded)) : null; guard();
          const floor = loaded?.cityFloorContext || null;
          const identityMatches = !!loaded && loaded.geoKey === row.geoKey && (!loaded._meta?.runId || loaded._meta.runId === row.run) &&
            (row.floor ? floor?.hostKey === row.floor.hostKey && floor?.buildingId === row.floor.buildingId && floor?.floor === row.floor.floor : !floor);
          const staticMatches = hash === after.staticHash, crowdMatches = !!loaded && JSON.stringify(loaded.cityCrowd) === after.crowd;
          result = { key: row.key, valid: stable && identityMatches && staticMatches && crowdMatches, attempts: attempt, stable,
            identityMatches, staticMatches, crowdMatches, staticHash: hash, previousValid: row.previousValid,
            sameStaticAsRoute: row.previousStaticHash ? row.previousStaticHash === hash : null,
            nativeActiveReader: useActive, capturedReaderSameSource: !useActive, quietMs,
            reason: !stable ? 'Cache contents changed across the read window.' : !loaded ? 'Native reader returned no room.' :
              !(identityMatches && staticMatches && crowdMatches) ? 'A stable identity or readback mismatch was found; it will not be retried.' : null };
          if (stable || attempt === maxAttempts) break;
        }
        audits.push(result);
      }
      return { kind: 'city-cache-reaudit', version: 1, valid: audits.every(a => a.valid), readOnly: true, referenceSource: selected.source,
        historicalRoute: selected.historical, audits, retriedLocations: audits.filter(a => a.attempts > 1).length,
        historicalStaticHashesUnchanged: audits.every(a => a.sameStaticAsRoute === true),
        policy: 'Existing cache reads only. No saves, schema changes, gameplay actions, movement or pause changes. Only overlapping-content reads retry. Stable mismatches remain failures. Historical route/save counts and queue-boundary coverage are not new measurements. Individually consistent cache snapshots are not a simultaneous multi-room snapshot or proof of unchanged historical data.' };
    } finally { transport.close(); }
  }
  if (typeof module === 'object' && module.exports) module.exports = { context, select, preflight, run };
})();

return module.exports; })();
const controller = (() => { const module = { exports: {} };
(function() {
  'use strict';
  async function install(root, core, cache, travel, expected, reference, workerSource) {
    if (root.CityCacheAudit?.running) throw Error('An audit-only check is already running. Wait for its result.');
    const panel = root.document.createElement('section'); panel.id = 'city-cache-reaudit';
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:460px;padding:14px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace;white-space:pre-wrap';
    const status = root.document.createElement('div'); panel.append(status); root.document.body.appendChild(panel);
    const api = { running: true, result: null, error: null, logConfirmed: false }; root.CityCacheAudit = api;
    let transport = null;
    try {
      core.preflight(root, cache, expected); core.select(root, reference);
      transport = cache.bridge(root, workerSource);
      const value = await core.run(root, cache, travel, expected, reference, transport, {
        progress({ location, total, attempt, maxAttempts }) { status.textContent = 'Read-only cache audit: location ' + location + '/' + total + ', attempt ' + attempt + '/' + maxAttempts + '.\nStay paused. No walking or new route needed.'; }
      });
      api.result = value; transport = null;
      for (let offset = 0; offset < value.audits.length; offset += 4) {
        const body = JSON.stringify({ reason: 'city-cache-reaudit', geoKey: root.currentDungeon?.geoKey, samples: [],
          trial: { ...value, auditPart: offset / 4 + 1, auditParts: Math.ceil(value.audits.length / 4), audits: value.audits.slice(offset, offset + 4) } });
        if (body.length > 12000) throw Error('Audit log exceeds the safe size. Results remain in CityCacheAudit.result.');
        const response = await root.fetch('/debug/dungeon-rendering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          signal: root.AbortSignal.timeout(5000) });
        if (!response.ok) throw Error('Audit log delivery failed: HTTP ' + response.status);
      }
      api.logConfirmed = true;
      status.textContent = (value.valid ? 'Stable cache readback VERIFIED.' : 'Cache readback NOT verified; report retained.') +
        '\nLocations: ' + value.audits.length + '; retried: ' + value.retriedLocations + '. Server log confirmed.' +
        '\n' + (value.historicalStaticHashesUnchanged ? 'Static data matches the route capture.' : 'Some static data differs from the earlier capture; this is recorded separately, not treated as unchanged historical data.') +
        '\nNo cache data was changed. You may resume normally.';
      root.console.log('[CityCacheAudit]', { valid: value.valid, locations: value.audits.length, retriedLocations: value.retriedLocations,
        historicalStaticHashesUnchanged: value.historicalStaticHashesUnchanged, logConfirmed: true });
      return value;
    } catch (e) {
      api.error = e.message; status.textContent = 'Audit-only check stopped: ' + e.message; root.console.warn('[CityCacheAudit]', e.message);
      return null;
    } finally {
      transport?.close(); api.running = false;
      const close = root.document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => panel.remove()); panel.append(close);
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = { install };
})();

return module.exports; })();
return controller.install(root, core, cache, travel, {"idb":"async function idbSetDungeon(coordsKey, dungeon) {\n  const runId = dungeon?._meta?.runId || window.dungeonRunId;\n  if (!runId) return;\n  const cacheKey = `${runId}:${window.CityFloorScope?.cacheKey(coordsKey,dungeon)||coordsKey}`;\n  const db = await openDungeonDB();\n  return new Promise((resolve, reject) => {\n    const tx = db.transaction(DUNGEON_STORE, 'readwrite');\n    tx.objectStore(DUNGEON_STORE).put(dungeon, cacheKey);\n    tx.oncomplete = () => resolve();\n    tx.onerror    = () => reject(tx.error);\n  });\n}","persist":"()=>currentDungeon&&idbSetDungeon(currentDungeon.geoKey,currentDungeon).catch(console.error)","realtime":"async event => {\n  if (event?.type === 'player_respawn') {\n    if (event.runId !== window.dungeonRunId || event.fromKey !== currentDungeon?.geoKey || !event.dungeon?.cells ||\n        event.dungeon.geoKey !== event.geoKey || realtimeCombatResultsSeen.has(event.eventId)) return;\n    ++dungeonSwitchRequest;\n    currentDungeon = event.dungeon;\n    const [x, y, z] = event.geoKey.split(',').map(Number); currentCoordinates = { x, y, z };\n    window.currentCoordinates = 'X: ' + x + ', Y: ' + y + ', Z: ' + z;\n    const start = findNearestWalkableStart(currentDungeon, currentDungeon.start);\n    playerDungeonX = start.x; playerDungeonY = start.y; playerPosX = start.x + .5; playerPosY = start.y + .5;\n    playerZInitialized = false; window.resetDungeonArrivalMomentum?.();\n    window.CombatTacticalUi?.changeFloor(event.geoKey); window.CombatTurnUi?.receive(null);\n    window.combatCharacters = JSON.parse(event.combatCharactersString);\n    preloadDungeonTextures(); updatePlayerHeightFromCell();\n    idbSetDungeon(event.geoKey, currentDungeon).catch(error => console.warn('[RespawnCache]', error.message));\n  }\n  if (!event || typeof event.eventId!=='string' || event.runId !== window.dungeonRunId || event.geoKey !== currentDungeon?.geoKey || realtimeCombatResultsSeen.has(event.eventId)) return;\n  const text = event.updatedGameConsole;\n  if (typeof text !== 'string' || window.DungeonInhabitants.roomKey(text.match(/^Coordinates:\\s*(.*)$/m)?.[1])!==event.geoKey) return;\n  let roster;\n  if (event.combatCharactersString) {\n    try {roster=JSON.parse(event.combatCharactersString);}catch{return;}\n    if(!Array.isArray(roster)||roster.some(actor=>!actor||typeof actor.name!=='string'))return;\n  }\n  realtimeCombatResultsSeen.add(event.eventId);\n  if(event.crowd)window.CityCrowdUi?.receive(event);\n  if (realtimeCombatResultsSeen.size > 32) realtimeCombatResultsSeen.delete(realtimeCombatResultsSeen.values().next().value);\n  if (!event.passive) { window._combatCommandPending = false; window._combatRoundActiveUntil = 0; }\n  if(['quest_scene_result', 'economy_result', 'spell_result', 'player_respawn'].includes(event.type)&&event.roomNameDatabaseString) {\n    const database=JSON.parse(event.roomNameDatabaseString);\n    roomNameDatabaseString=event.roomNameDatabaseString;roomNameDatabasePlainObject=database;roomNameDatabase.clear();\n    for(const [key,room] of Object.entries(database))roomNameDatabase.set(key,room);\n  }\n  if (event.type === 'economy_result' || event.type === 'spell_result') roomDatabaseSyncClient.reset();\n  if (Array.isArray(event.sceneObjects)) currentDungeon.sceneObjects = event.sceneObjects;\n  window.lastServerGameConsole = text;\n  updateCharacterSheetsFromConsole(text);\n  if (event.population) window.DungeonLife?.receivePopulation({ population: event.population, runId: event.runId });\n  if (roster) {\n    window.combatCharacters = roster;\n    ensureKnownSpritesInCombatList(window.combatCharacters);\n    syncPartyMazeToCombatPositions(false);\n  }\n  generateMonstersForRoom(event.geoKey, text);\n  updateGameConsole('', currentCoordinates, text, null, text);\n  window.latestUpdatedData = window.DungeonInhabitants.consoleView(text, window.latestUpdatedData);\n  window.SpellUi?.hydrate(text);\n  window.game?.scene?.getScene('MainScene')?.scene.restart(window.latestUpdatedData);\n  const entry = document.createElement('p'); entry.style.whiteSpace = 'pre-wrap'; entry.textContent = event.content;\n  document.getElementById('chatlog')?.appendChild(entry);\n  const conversationId = localStorage.getItem('conversationId');\n  if (conversationId) await addPromptAndResponse('[Encounter]', '', '', event.content, '', conversationId, text);\n  window.renderPartyIconDock?.(); renderDungeonView();\n}","get":"async function idbGetDungeon(coordsKey) {\n  if (!window.dungeonRunId) return null;\n  const cacheKey = `${window.dungeonRunId}:${window.CityFloorScope?.cacheKey(coordsKey)||coordsKey}`;\n  const db = await openDungeonDB();\n  return new Promise((resolve, reject) => {\n    const tx  = db.transaction([DUNGEON_STORE, DUNGEON_INHABITANTS_STORE], 'readonly');\n    const req = tx.objectStore(DUNGEON_STORE).get(cacheKey);\n    const population = tx.objectStore(DUNGEON_INHABITANTS_STORE).get(cacheKey);\n    tx.oncomplete = () => resolve(req.result ? { ...req.result, inhabitants: population.result || req.result.inhabitants } : null);\n    tx.onerror = () => reject(tx.error);\n    tx.onabort = () => reject(tx.error || new Error('Dungeon cache read was aborted.'));\n  });\n}","open":"function openDungeonDB() {\n  if (dungeonDBPromise) return dungeonDBPromise;\n\n  dungeonDBPromise = new Promise((resolve, reject) => {\n    const req = indexedDB.open(DUNGEON_DB_NAME, 2);\n\n    req.onupgradeneeded = (e) => {\n      const db = e.target.result;\n      if (!db.objectStoreNames.contains(DUNGEON_STORE)) {\n        db.createObjectStore(DUNGEON_STORE); // key = \"x,y,z\"\n      }\n      if (!db.objectStoreNames.contains(DUNGEON_INHABITANTS_STORE)) db.createObjectStore(DUNGEON_INHABITANTS_STORE);\n    };\n\n    req.onsuccess = () => {\n      const database = req.result;\n      database.onversionchange = () => { database.close(); dungeonDBPromise = null; };\n      resolve(database);\n    };\n    req.onerror   = () => reject(req.error);\n  });\n\n  return dungeonDBPromise;\n}","floor":{"cacheKey":"function cacheKey(key,dungeon){const ref=dungeon?dungeon.cityFloorContext:context;return ref?.hostKey===key?`${key}:building:${ref.buildingId}:floor:${ref.floor}`:key;}","token":"()=>token"}}, {"run":"90ef19d2-fef1-4eb3-8073-31dfc2f855ad","complete":true,"requests":55,"patchesCommitted":44,"fullFallbacks":11,"failures":0,"errors":[],"queueBoundaryObserved":false,"audits":[{"key":"90ef19d2-fef1-4eb3-8073-31dfc2f855ad:0,0,30","valid":false,"staticHash":"5bd3f9bab189a509ad06315cbae9b3e85eabcb9f0b4c2bab17642dda41c5193c"},{"key":"90ef19d2-fef1-4eb3-8073-31dfc2f855ad:0,0,30:building:world-city-0:0,0,30:parcel:3,-4:floor:1","valid":true,"staticHash":"e40d162d8eaa7231765e609ecc51780cc64e187490db9648efcd8a8c45ef3f8f"},{"key":"90ef19d2-fef1-4eb3-8073-31dfc2f855ad:0,0,30:building:world-city-0:0,0,30:parcel:3,-4:floor:2","valid":true,"staticHash":"800df2fe546944d7f3f919fbbafdd092b3713bf27aef0def2022cbadbffb9c2c"},{"key":"90ef19d2-fef1-4eb3-8073-31dfc2f855ad:0,0,31","valid":true,"staticHash":"43f5eea70ef685e2d9c4777ac9e238af445d95ed654b35c4dd403446d71d4300"}]}, "'use strict';\nconst cache = (() => { const module = { exports: {} };\n(function() {\n  'use strict';\n  const normalize = s => s.replace(/\\r\\n/g, '\\n').trim();\n  const round = n => Math.round(n * 100) / 100;\n  function sources(game) {\n    game = normalize(game);\n    const take = (start, end) => {\n      if (game.split(start).length !== 2 || game.split(end).length !== 2) throw Error('Crowd-cache source boundaries changed.');\n      return game.slice(game.indexOf(start), game.indexOf(end, game.indexOf(start) + start.length)).trim();\n    };\n    return { get: take('async function idbGetDungeon(', '\\nasync function idbSetDungeon('),\n      open: take('function openDungeonDB()', '\\nasync function idbGetDungeon(') };\n  }\n  function scope(root, dungeon = root.currentDungeon) {\n    const run = dungeon?._meta?.runId || root.dungeonRunId;\n    if (!run || run !== root.dungeonRunId || !dungeon?.geoKey || !dungeon._geometryStamp || !dungeon.cityCrowd ||\n      dungeon.classification?.indoor !== false || dungeon.cityFloorContext) throw Error('Use the outdoor host city with a stamped crowd.');\n    const key = run + ':' + (root.CityFloorScope?.cacheKey(dungeon.geoKey, dungeon) || dungeon.geoKey);\n    return { dungeon, run, key, geoKey: dungeon.geoKey, stamp: dungeon._geometryStamp, floor: root.CityFloorScope?.token?.() };\n  }\n  function guard(dungeon) {\n    return { fields: Object.entries(dungeon).filter(([key]) => key !== 'cityCrowd' && key !== '_lodCache'),\n      mutable: JSON.stringify(['sceneObjects', 'physicalPuzzle', 'secretDoors', 'actionAttempts', 'livingEncounter', 'start', '_world1Start', '_meta']\n        .map(key => [key, dungeon[key]])) };\n  }\n  function same(a, b) {\n    return !!a && a.mutable === b.mutable && a.fields.length === b.fields.length &&\n      a.fields.every(([key, value], i) => key === b.fields[i][0] && Object.is(value, b.fields[i][1]));\n  }\n  function staticText(record) {\n    // The normal reader overlays inhabitants from its existing population store.\n    return JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'cityCrowd' && key !== 'inhabitants')));\n  }\n  async function digest(root, text) {\n    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(text))))\n      .map(n => n.toString(16).padStart(2, '0')).join('');\n  }\n  function fullWrite(root, context) {\n    return root.openDungeonDB().then(db => new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readwrite');\n      // Freeze the original run/floor key rather than consulting a potentially changed active floor later.\n      tx.objectStore('rooms').put(context.dungeon, context.key);\n      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Full cache save aborted.'));\n    }));\n  }\n  function bridge(root, workerSource) {\n    const url = root.URL.createObjectURL(new root.Blob([workerSource], { type: 'application/javascript' }));\n    let worker; try { worker = new root.Worker(url); } finally { root.URL.revokeObjectURL(url); }\n    let sequence = 0, closed = false; const pending = new Map();\n    const rejectAll = error => { for (const p of pending.values()) { root.clearTimeout(p.timer); p.reject(error); } pending.clear(); };\n    worker.onerror = event => { event.preventDefault?.(); closed = true; rejectAll(Error(event.message || 'Crowd-cache worker failed.')); worker.terminate(); };\n    worker.onmessage = event => {\n      const p = pending.get(event.data?.id); if (!p) return;\n      pending.delete(event.data.id); root.clearTimeout(p.timer);\n      if (event.data.error) p.reject(Error(event.data.error)); else p.resolve(event.data.result);\n    };\n    return { call(type, payload) {\n      if (closed) return Promise.reject(Error('Crowd-cache worker is closed.'));\n      return new Promise((resolve, reject) => {\n        const id = ++sequence, timer = root.setTimeout(() => { pending.delete(id); reject(Error('Crowd-cache worker timed out.')); }, 15000);\n        pending.set(id, { resolve, reject, timer });\n        try { worker.postMessage({ id, type, ...payload }); } catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error); }\n      });\n    }, close() { closed = true; rejectAll(Error('Crowd-cache worker closed.')); worker.terminate(); } };\n  }\n  function manager(root, context, transport, initialGuard) {\n    let known = initialGuard, expectedCrowd = JSON.stringify(context.dungeon.cityCrowd), tail = Promise.resolve(), stopped = false, lastResult = null, durabilityFailure = null;\n    const newCounts = () => ({ requests: 0, patchAttempts: 0, patchesCommitted: 0, superseded: 0, fullFallbacks: 0, failures: 0,\n      payloadCharacters: 0, largestPayloadCharacters: 0, workerPutMs: 0, mainDispatchMs: 0, inFlightFromWarmup: 0 });\n    let counts = newCounts(), inFlight = 0;\n    function invalidate() { known = null; }\n    function write() {\n      if (stopped) return fullWrite(root, context);\n      const stats = counts; stats.requests++;\n      let text, capturedGuard;\n      try { text = JSON.stringify(context.dungeon.cityCrowd); capturedGuard = guard(context.dungeon); }\n      catch (error) { stats.failures++; durabilityFailure = error.message; return Promise.reject(error); }\n      const run = async () => {\n        if (same(known, capturedGuard) && same(capturedGuard, guard(context.dungeon))) {\n          try {\n            const payload = { key: context.key, run: context.run, geoKey: context.geoKey, stamp: context.dungeon._geometryStamp,\n              expectedCrowd, crowd: text };\n            stats.patchAttempts++; stats.payloadCharacters += text.length; stats.largestPayloadCharacters = Math.max(stats.largestPayloadCharacters, text.length);\n            const at = root.performance.now(), pending = transport.call('patch', payload);\n            stats.mainDispatchMs += root.performance.now() - at;\n            const result = await pending;\n            if (result.status === 'patched' || result.status === 'superseded') {\n              expectedCrowd = result.crowd; lastResult = result;\n              stats.workerPutMs += result.workerPutMs || 0;\n              if (result.status === 'patched') stats.patchesCommitted++; else stats.superseded++;\n              durabilityFailure = null;\n              return;\n            }\n          } catch { stats.failures++; }\n        }\n        stats.fullFallbacks++;\n        const before = guard(context.dungeon);\n        try { await fullWrite(root, context); }\n        catch (error) { stats.failures++; durabilityFailure = error.message; throw error; }\n        known = same(before, guard(context.dungeon)) ? before : null;\n        expectedCrowd = JSON.stringify(context.dungeon.cityCrowd); lastResult = null; durabilityFailure = null;\n      };\n      inFlight++;\n      const pending = tail.then(run).then(value => { inFlight--; return value; }, error => { inFlight--; throw error; });\n      tail = pending.catch(() => {}); return pending;\n    }\n    return { write, invalidate, drain: () => tail, stop() { stopped = true; },\n      reset() { counts = newCounts(); counts.inFlightFromWarmup = inFlight; },\n      diagnostics: () => ({ ...counts, workerPutMs: round(counts.workerPutMs), mainDispatchMs: round(counts.mainDispatchMs) }),\n      async verify() {\n        await tail;\n        if (durabilityFailure) return { checked: false, valid: false, reason: 'An accepted cache write failed: ' + durabilityFailure };\n        if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor)\n          return { checked: false, reason: 'Active run/room/floor changed; legacy reader verification skipped.' };\n        const authoritative = await transport.call('inspect', { key: context.key });\n        const loaded = await root.idbGetDungeon(context.geoKey);\n        if (!loaded) return { checked: true, valid: false, reason: 'The original cache reader returned no room.' };\n        const hash = await digest(root, staticText(loaded)), crowd = JSON.stringify(loaded.cityCrowd);\n        const matchesLastPatch = !lastResult?.staticHash || lastResult.staticHash === authoritative.staticHash;\n        const valid = hash === authoritative.staticHash && crowd === authoritative.crowd && matchesLastPatch;\n        return { checked: true, valid, originalReaderUsed: true, staticRoomPreserved: hash === authoritative.staticHash && matchesLastPatch,\n          crowdPreserved: crowd === authoritative.crowd, matchesLastPatch, patchesCommitted: counts.patchesCommitted,\n          lastPatchStaticHash: lastResult?.staticHash || null, reloadStaticHash: hash,\n          reason: valid ? null : 'The cache changed between reads or reload data differed; this result is not verified.' };\n      } };\n  }\n  function preflight(root, expected) {\n    for (const [key, name] of [['persistCityCrowd', 'persist'], ['idbSetDungeon', 'idb'], ['idbGetDungeon', 'get'], ['openDungeonDB', 'open']])\n      if (typeof root[key] !== 'function' || normalize(root[key].toString()) !== expected[name]) throw Error('Running cache method differs from verified source: ' + key);\n    if (typeof root.Worker !== 'function' || !root.crypto?.subtle || !root.TextEncoder) throw Error('Worker and cryptographic reload verification are required. No unsafe fallback installation.');\n  }\n  async function prepare(root, expected) {\n    preflight(root, expected);\n    const context = scope(root), before = guard(context.dungeon);\n    await root.idbSetDungeon(context.geoKey, context.dungeon);\n    if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor ||\n      !same(before, guard(context.dungeon))) throw Error('City changed during cache setup. Click the capture again.');\n    return { context, initialGuard: before };\n  }\n  if (typeof module === 'object' && module.exports) module.exports = { sources, scope, guard, same, staticText, digest, fullWrite, bridge, manager, preflight, prepare };\n})();\n\nreturn module.exports; })();\nconst worker = (() => { const module = { exports: {} };\n(function() {\n  'use strict';\n  function patch(db, data, now = () => performance.now()) {\n    return new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readwrite'), store = tx.objectStore('rooms'), get = store.get(data.key);\n      let result = { status: 'fallback' }, staticValue = null;\n      get.onsuccess = () => {\n        const record = get.result;\n        if (!record || record.geoKey !== data.geoKey || record._geometryStamp !== data.stamp ||\n          record._meta?.runId && record._meta.runId !== data.run || !data.key.startsWith(data.run + ':')) return;\n        let crowd; try { crowd = JSON.parse(data.crowd); } catch { return; }\n        const current = JSON.stringify(record.cityCrowd);\n        if ((record.cityCrowd?.revision || 0) > (crowd?.revision || 0)) {\n          result = { status: 'superseded', crowd: current, workerPutMs: 0 }; return;\n        }\n        if (current !== data.expectedCrowd) return;\n        staticValue = record;\n        record.cityCrowd = crowd;\n        const at = now(); store.put(record, data.key);\n        result = { status: 'patched', crowd: data.crowd, workerPutMs: now() - at };\n      };\n      tx.oncomplete = () => resolve({ ...result, staticValue });\n      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Crowd patch transaction aborted.'));\n    });\n  }\n  function read(db, key) {\n    return new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readonly'), request = tx.objectStore('rooms').get(key);\n      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Cache read aborted.'));\n    });\n  }\n  function install(root, core) {\n    let dbPromise = null, queue = Promise.resolve();\n    function database() {\n      if (dbPromise) return dbPromise;\n      dbPromise = new Promise((resolve, reject) => {\n        const request = root.indexedDB.open('cotg-dungeons', 2);\n        request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Existing version-2 cache required; no schema changes are allowed.')); };\n        request.onblocked = () => reject(Error('Crowd-cache database is blocked.'));\n        request.onerror = () => reject(request.error);\n        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };\n      }); return dbPromise;\n    }\n    root.onmessage = event => {\n      const data = event.data;\n      queue = queue.then(async () => {\n        try {\n          const db = await database(); let result;\n          if (data.type === 'patch') {\n            const { staticValue, ...info } = await patch(db, data);\n            result = { ...info, staticHash: staticValue ? await core.digest(root, core.staticText(staticValue)) : null };\n          } else if (data.type === 'inspect') {\n            const record = await read(db, data.key);\n            if (!record) throw Error('Cached room missing during reload verification.');\n            result = { staticHash: await core.digest(root, core.staticText(record)), crowd: JSON.stringify(record.cityCrowd) };\n          } else throw Error('Unknown crowd-cache worker operation.');\n          root.postMessage({ id: data.id, result });\n        } catch (error) { root.postMessage({ id: data.id, error: error.message }); }\n      });\n    };\n  }\n  if (typeof module === 'object' && module.exports) module.exports = { patch, read, install };\n})();\n\nreturn module.exports; })();\nworker.install(self, cache);\n");
})(window);
