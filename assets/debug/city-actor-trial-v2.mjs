(function(root) {
'use strict';
const profiler = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const round = n => Number(n.toFixed(2));
  function percentile(values, p) {
    values = values.filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? round(values[Math.min(values.length - 1, Math.floor(values.length * p))]) : null;
  }
  function summarize(frames, elapsed) {
    const intervals = frames.map(f => f.interval), samples = frames.flatMap(f => f.samples);
    const timing = key => ({ medianMs: percentile(samples.map(s => s[key]), .5), p95Ms: percentile(samples.map(s => s[key]), .95),
      maxMs: percentile(samples.map(s => s[key]), 1) });
    return { seconds: round(elapsed / 1000), observedFrames: frames.length,
      rafFPS: elapsed > 0 ? round(frames.length * 1000 / elapsed) : null,
      renderedRafFPS: elapsed > 0 ? round(frames.filter(f => f.samples.length).length * 1000 / elapsed) : null,
      renderCallsPerSecond: elapsed > 0 ? round(samples.length * 1000 / elapsed) : null,
      rafP95Ms: percentile(intervals, .95), gapsOver50Ms: intervals.filter(n => n > 50).length,
      gapsOver100Ms: intervals.filter(n => n > 100).length,
      renderer: { inclusive: timing('inclusiveMs'), cpu: timing('cpuMs'), resources: timing('resourcesMs'), collection: timing('collectionMs'), voxelSubmit: timing('voxelSubmitMs') },
      first: samples[0] || null, last: samples.at(-1) || null };
  }
  function createTrace(root, native, renderer) {
    const limit = 60000, hooks = [], missing = [], groups = new Map(), stack = [], segments = [];
    let active = false, started = 0, truncated = false, serializeCalls = 0, serializeCharacters = 0, largestSerialization = 0;
    function segment(frame, end) {
      if (!frame || end <= frame.since) return;
      frame.self += end - frame.since;
      if (segments.length < limit) segments.push([frame.name, frame.since, end]); else truncated = true;
    }
    function measure(name, fn, self, args) {
      if (!active) return fn.apply(self, args);
      const begin = root.performance.now(), parent = stack.at(-1);
      segment(parent, begin);
      const frame = { name, begin, since: begin, self: 0 }; stack.push(frame);
      try { return fn.apply(self, args); }
      finally {
        const end = root.performance.now(); segment(frame, end); stack.pop(); if (parent) parent.since = end;
        let group = groups.get(name);
        if (!group) { group = { calls: 0, inclusive: 0, self: 0, max: 0, times: [] }; groups.set(name, group); }
        const duration = end - begin; group.calls++; group.inclusive += duration; group.self += frame.self; group.max = Math.max(group.max, duration);
        if (group.times.length < 16000) group.times.push(duration);
      }
    }
    function hook(owner, key, name, make) {
      const original = owner?.[key];
      if (typeof original !== 'function') { missing.push(name); return; }
      const wrapper = make ? make(original) : function(...args) { return measure(name, original, this, args); };
      try { owner[key] = wrapper; } catch { missing.push(name); return; }
      if (owner[key] !== wrapper) { missing.push(name); return; }
      hooks.push({ owner, key, original, wrapper, name });
    }
    function deferred(key, fnIndex, name) {
      hook(native, key, name, original => {
        const draws = new WeakMap();
        return function(...args) {
          const draw = args[fnIndex];
          if (typeof draw !== 'function') return original.apply(this, args);
          let observed = draws.get(draw);
          if (!observed) {
            observed = function(...drawArgs) {
              // Pending native callbacks retain their draw-identity permit even after profiling stops.
              if (!active && native[key] === original) {
                const bridge = function(...next) { if (next[fnIndex] === draw) next[fnIndex] = observed; return original.apply(this, next); };
                native[key] = bridge;
                try { return draw.apply(this, drawArgs); } finally { if (native[key] === bridge) native[key] = original; }
              }
              return measure(name, draw, this, drawArgs);
            };
            draws.set(draw, observed);
          }
          args[fnIndex] = observed; return original.apply(this, args);
        };
      });
    }
    function start(at) {
      started = at; active = true;
      for (const [key, name] of [['updateDungeonMovement', 'movement'], ['updatePartyMazeLocomotion', 'partyLocomotion'],
        ['refreshPartyCombatProjection', 'partyProjection'], ['syncPartyMazeToCombatPositions', 'partyRosterSync'],
        ['ensurePartyMazeAnchors', 'partyAnchors'], ['collectNearbyWalkableTiles', 'partyTileSearch'],
        ['canOccupyPos', 'playerCollision'], ['syncCombatActorOverlayFromMaze', 'mapActorSync'],
        ['syncDungeonExitNavigation', 'navigation'], ['getVisibleSceneObjects', 'items'], ['createTraitSpriteCanvas', 'spriteCompile']]) hook(root, key, name);
      hook(root.CityCrowdUi, 'onFrame', 'crowdTick'); hook(root.CityCrowdUi, 'actors', 'crowdActors');
      hook(root.DungeonExplorationMap, 'update', 'explorationMap'); hook(root.RoomEntry, 'onFrame', 'roomEntry');
      hook(renderer, '_getCharacterBillboard', 'billboardPrep');
      deferred('deferWorld', 1, 'worldView'); deferred('deferMap', 2, 'tacticalMap');
      hook(native, 'mapLayers', 'mapLayerKey', original => function(...args) {
        const draw = measure('mapLayerKey', original, this, args);
        return typeof draw === 'function' ? function(...layerArgs) {
          return measure(layerArgs[0] === 'grid' ? 'mapGrid' : 'mapTerrain', draw, this, layerArgs);
        } : draw;
      });
      hook(root.JSON, 'stringify', 'partySerialize', original => function(...args) {
        if (!active || !Array.isArray(root.combatCharacters) || args[0] !== root.combatCharacters) return original.apply(this, args);
        const value = measure('partySerialize', original, this, args), length = typeof value === 'string' ? value.length : 0;
        serializeCalls++; serializeCharacters += length; largestSerialization = Math.max(largestSerialization, length); return value;
      });
    }
    function stop() {
      active = false;
      for (const h of hooks.toReversed()) if (h.owner[h.key] === h.wrapper) h.owner[h.key] = h.original;
    }
    function attribution(begin, end) {
      const bySection = new Map(); let covered = 0;
      for (const [name, left, right] of segments) {
        const overlap = Math.min(end, right) - Math.max(begin, left);
        if (overlap > 0) { covered += overlap; bySection.set(name, (bySection.get(name) || 0) + overlap); }
      }
      return { trackedExclusiveMs: round(covered), unattributedMs: round(Math.max(0, end - begin - covered)),
        sections: [...bySection].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, ms]) => ({ name, exclusiveMs: round(ms) })) };
    }
    function report(longTasks, frames) {
      return { sections: [...groups].map(([name, g]) => ({ name, calls: g.calls, inclusiveMs: round(g.inclusive), exclusiveMs: round(g.self),
        medianMs: percentile(g.times, .5), p95Ms: percentile(g.times, .95), maxMs: round(g.max), timingSamples: g.times.length,
        samplesTruncated: g.times.length < g.calls })).sort((a, b) => b.exclusiveMs - a.exclusiveMs),
        partySerialization: { calls: serializeCalls, totalOutputCharacters: serializeCharacters, largestOutputCharacters: largestSerialization, contentsRecorded: false },
        hooks: hooks.map(h => h.name), unavailableHooks: missing, exclusiveSegments: segments.length, segmentsTruncated: truncated,
        longTasks: longTasks.map(t => ({ ...t, ...attribution(started + t.startMs, started + t.startMs + t.durationMs) })),
        worstFrameGaps: [...frames].sort((a, b) => b.interval - a.interval).slice(0, 10)
          .map(f => ({ startMs: round(f.begin - started), durationMs: round(f.interval), ...attribution(f.begin, f.end) })),
        note: 'Inclusive times overlap. Exclusive sections partition tracked execution only. Unattributed frame gaps can include idle/vsync, uninstrumented work or pauses; they are not CPU or GC measurements. Synchronous timings can include GC and waits. Profiling adds overhead.' };
    }
    return { start, stop, report, measure, intact: () => hooks.every(h => h.owner[h.key] === h.wrapper) };
  }
  function install(root, options = {}) {
    if (!['localhost', '127.0.0.1'].includes(root.location.hostname) || root.location.port !== '3000' || root.location.pathname !== '/assets/index.html')
      throw Error('Run this only in the localhost:3000 game tab.');
    if (root.CityNativeProfile?.active?.()) throw Error('Use the existing Capture Native Walk button, or CityNativeProfile.undo() first.');
    if (root.CityFrameTrial?.active?.() || root.CityRenderTrial?.active?.()) throw Error('Hard-refresh first to remove the old optimization trial.');
    const presenter = root.webglDungeonRenderer, renderer = presenter?.legacyRenderer || presenter, dungeon = root.currentDungeon, native = root.DungeonPerformance;
    if (!renderer?.gl || typeof presenter.renderScene !== 'function' || typeof native?.diagnostics !== 'function' || !dungeon?._geometryStamp ||
      !dungeon.cells || (!dungeon.cityBlocks && !dungeon.sceneSpec?.city)) throw Error('Open the city with the native optimizations first. Hard-refresh if needed.');
    if (presenter !== renderer && (root.webgpuDungeonRenderer !== presenter || root.webglDungeonRendererLegacy !== renderer)) throw Error('Unrecognized renderer adapter. Nothing installed.');
    const blocked = () => root.actionDiceState?.active || root.CombatTacticalUi?.active?.() || root._combatCommandPending || root._deathSceneActive || root._gameOver;
    if (blocked()) throw Error('Finish combat or the death screen first.');
    const original = presenter.renderScene, runId = root.dungeonRunId, floor = JSON.stringify(dungeon.cityFloorContext), results = [];
    let disposed = false, busy = false, cancelWait = null, raf = 0, warmTimer = 0, watchdog = 0, samples = null;
    const panel = root.document.createElement('section'); panel.id = 'city-native-profile';
    panel.style.cssText = 'position:fixed;z-index:999999;top:12px;left:330px;max-width:480px;padding:12px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace';
    const status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'Deep native city walking profile\nTimes party, serialization, map, crowd and sprite work.\nNo optimization or graphics changes.\nUnpause, close DevTools, then capture a 20-second walk.';
    const capture = root.document.createElement('button'); capture.textContent = 'Capture Native Walk (20s)';
    const undo = root.document.createElement('button'); undo.textContent = 'Close / Undo'; panel.append(status, capture, undo);
    const position = () => ({ x: root.playerPosX, y: root.playerPosY, angle: root.playerAngle });
    const settings = () => JSON.stringify([renderer.canvas?.width, renderer.canvas?.height, presenter.canvas?.width, presenter.canvas?.height,
      presenter.mode, root.WEBGPU_NATIVE_WORLD, root.forceCanvasDungeon, root.RetroGraphics?.fullbright?.()]);
    let trace = null;
    const valid = () => !disposed && !blocked() && root.currentDungeon === dungeon && root.dungeonRunId === runId && root.DungeonPerformance === native &&
      JSON.stringify(dungeon.cityFloorContext) === floor && root.webglDungeonRenderer === presenter && (presenter.legacyRenderer || presenter) === renderer;
    function measuredRender(...args) {
      const before = renderer.lastFrameStats, started = root.performance.now();
      try {
        const result = trace ? trace.measure('worldRenderer', original, this, args) : original.apply(this, args), stats = renderer.lastFrameStats;
        // A successful new world submission replaces lastFrameStats; cached presentations are not new world frames.
        if (samples && stats && stats !== before) samples.push({ inclusiveMs: round(root.performance.now() - started),
          cpuMs: stats.cpuMs, resourcesMs: stats.resourcesMs, collectionMs: stats.collectionMs, voxelSubmitMs: stats.voxelSubmitMs,
          geometryStamp: stats.geometryStamp, voxelInstances: stats.voxelInstances, drawCalls: stats.voxelDrawCalls,
          nearbyLights: stats.nearbyTorches, skylineWindows: stats.citySkyline?.windows, skylineDraws: stats.citySkyline?.batchedDraws });
        return result;
      } catch (error) { cancelWait?.(Error('Renderer failed during measurement: ' + error.message)); throw error; }
    }
    function restoreHook() { if (presenter.renderScene === measuredRender) presenter.renderScene = original; samples = null; }
    function close() {
      if (disposed) return;
      disposed = true; cancelWait?.(Error('Native walking capture cancelled.')); cancelWait = null;
      root.cancelAnimationFrame(raf); root.clearTimeout(warmTimer); root.clearTimeout(watchdog); root.clearTimeout(expiration);
      restoreHook(); trace?.stop(); panel.remove();
    }
    async function run() {
      if (busy || disposed) return;
      if (root.gamePaused) { status.textContent = 'Unpause the game first, then click Capture Native Walk (20s).'; return; }
      if (!valid() || presenter.renderScene !== original) { status.textContent = 'The room, encounter or renderer changed. Reload this profiler.'; return; }
      busy = true; capture.disabled = true;
      const expectedSettings = settings(), frames = [], longTasks = [], stamps = new Set([dungeon._geometryStamp]);
      const startPosition = position(); let initialCounts = native.diagnostics().counts;
      trace = createTrace(root, native, renderer);
      let start = null, elapsed = 0, distance = 0, movingMs = 0, turningMs = 0, observer = null, abortReason = null, longTaskAvailable = false;
      try {
        status.textContent = 'Warming for 2 seconds. Then walk and turn normally for 20 seconds.';
        options.onProgress?.({ phase: 'warming', seconds: 2 });
        await new Promise((resolve, reject) => {
          cancelWait = reject; warmTimer = root.setTimeout(() => { cancelWait = null; resolve(); }, 2000);
        });
        if (!valid() || presenter.renderScene !== original) throw Error('Room, encounter or renderer changed before measurement.');
        if (options.validate && !options.validate()) throw Error('Trial methods changed before measurement.');
        if (root.gamePaused || root.document.visibilityState !== 'visible') throw Error('Keep the game unpaused and its tab visible.');
        if (settings() !== expectedSettings) throw Error('Graphics settings changed before measurement.');
        options.onStart?.();
        initialCounts = native.diagnostics().counts;
        start = root.performance.now(); samples = []; presenter.renderScene = measuredRender; trace.start(start);
        if (typeof root.PerformanceObserver === 'function') try {
          observer = new root.PerformanceObserver(list => {
            for (const e of list.getEntries()) if (e.startTime >= start && longTasks.length < 1000)
              longTasks.push({ startMs: Math.round(e.startTime - start), durationMs: round(e.duration) });
          });
          observer.observe({ type: 'longtask', buffered: false }); longTaskAvailable = true;
        } catch { observer?.disconnect(); observer = null; }
        let previous = position(), last = start, lastStatus = -1;
        await new Promise((resolve, reject) => {
          cancelWait = reject; watchdog = root.setTimeout(() => reject(Error('Measurement timed out; keep the game tab visible.')), 26000);
          function tick() {
            try {
              // rAF's shared frame timestamp can predate startup within the same frame; use one monotonic clock throughout.
              const now = root.performance.now();
              if (!valid() || root.document.visibilityState !== 'visible') throw Error('Room, encounter, level or visible tab changed. Capture stopped.');
              if (options.validate && !options.validate()) throw Error('Trial methods changed. Capture stopped.');
              if (root.gamePaused) throw Error('The game was paused. Capture stopped.');
              if (presenter.renderScene !== measuredRender) throw Error('The renderer method changed. Capture stopped.');
              if (!trace.intact()) throw Error('A profiled method changed. Capture stopped.');
              if (settings() !== expectedSettings) throw Error('Graphics settings changed. Capture stopped.');
              const current = position(), interval = now - last, step = Math.hypot(current.x - previous.x, current.y - previous.y);
              if (![current.x, current.y, current.angle, step].every(Number.isFinite)) throw Error('Player position unavailable.');
              if (!Number.isFinite(interval) || interval < 0) throw Error('Monotonic profiler clock or frame timing unavailable.');
              const moving = step > .002, turning = Math.abs(Math.atan2(Math.sin(current.angle - previous.angle), Math.cos(current.angle - previous.angle))) > .002;
              distance += step; if (moving) movingMs += interval; if (turning) turningMs += interval;
              stamps.add(dungeon._geometryStamp); frames.push({ interval, moving, turning, samples, begin: last, end: now }); samples = [];
              elapsed = now - start; last = now; previous = current;
              const seconds = Math.floor(elapsed / 1000);
              if (seconds !== lastStatus) {
                lastStatus = seconds;
                status.textContent = 'Native walking capture: ' + Math.max(0, 20 - seconds) + ' seconds left. Keep walking/turning.';
                options.onProgress?.({ phase: 'capturing', seconds: Math.max(0, 20 - seconds) });
              }
              if (elapsed >= 20000) { cancelWait = null; resolve(); return; }
              raf = root.requestAnimationFrame(tick);
            } catch (error) { cancelWait = null; reject(error); }
          }
          raf = root.requestAnimationFrame(tick);
        });
      } catch (error) { abortReason = error.message; }
      finally {
        if (observer) {
          for (const e of observer.takeRecords()) if (start !== null && e.startTime >= start && longTasks.length < 1000)
            longTasks.push({ startMs: Math.round(e.startTime - start), durationMs: round(e.duration) });
          observer.disconnect();
        }
        root.cancelAnimationFrame(raf); root.clearTimeout(warmTimer); root.clearTimeout(watchdog); cancelWait = null;
        restoreHook(); trace.stop(); busy = false; capture.disabled = false;
      }
      const moving = frames.filter(f => f.moving || f.turning), movingElapsed = moving.reduce((sum, f) => sum + f.interval, 0);
      const endCounts = native.diagnostics().counts, cacheCounts = Object.fromEntries([...new Set([...Object.keys(initialCounts), ...Object.keys(endCounts)])]
        .map(key => [key, (endCounts[key] || 0) - (initialCounts[key] || 0)]));
      const overall = summarize(frames, elapsed);
      const validCapture = !abortReason && elapsed >= 20000 && distance >= 2 && movingMs >= 1000 && frames.some(f => f.samples.length);
      const report = { kind: 'native-walking-profile', version: 3, valid: validCapture,
        reason: abortReason || (validCapture ? null : 'Not enough walking or rendered world frames. Unpause and walk for the capture.'),
        optimizationChanges: typeof options.optimizationChanges === 'function' && options.optimizationChanges(), settingsChanges: false, startPosition, endPosition: position(), distanceTiles: round(distance),
        movingSeconds: round(movingMs / 1000), turningSeconds: round(turningMs / 1000), geometryRevisions: stamps.size, cacheCounts,
        overall, whileMoving: moving.length ? summarize(moving, movingElapsed) : null,
        longTaskObservationAvailable: longTaskAvailable, longTasks, breakdown: trace.report(longTasks, frames),
        timingClock: 'performance.now() at capture start and callback entry',
        timingNote: 'Rendered FPS counts rAF intervals with a new world submission. CPU timings include waits/submission, not GPU execution. Different routes are not a controlled A/B comparison.' };
      results.push(report);
      if (!disposed) status.textContent = validCapture ? 'Native walk logged: ' + overall.renderedRafFPS + ' rendered FPS; ' + round(distance) +
        ' tiles; p95 gap ' + overall.rafP95Ms + 'ms.\nRenderer measurement hook removed. No settings changed.' : report.reason + '\nPartial diagnostic logged; try Capture Native Walk again.';
      root.console.info('Native city walking capture:', report);
      try {
        if (typeof options.onReport === 'function') await options.onReport(report);
        else {
        const sent = root.navigator?.sendBeacon?.('/debug/dungeon-rendering', new Blob([JSON.stringify({ reason: 'city-native-walk', geoKey: dungeon.geoKey,
          geometryStamp: dungeon._geometryStamp, backend: presenter === renderer ? 'webgl' : presenter.mode, samples: [], trial: report })], { type: 'application/json' }));
        if (!sent) root.console.warn('Automatic log delivery unavailable. Results remain in CityNativeProfile.results.');
        }
      } catch (error) { root.console.warn('Results remain in CityNativeProfile.results:', error.message); }
      return report;
    }
    capture.addEventListener('click', run); undo.addEventListener('click', close);
    const expiration = root.setTimeout(close, 10 * 60 * 1000);
    root.CityNativeProfile = { capture: run, results, undo: close, active: () => !disposed };
    root.document.body.appendChild(panel); root.console.info('Native city profiler ready. Close DevTools, unpause and use Capture Native Walk (20s).');
    return root.CityNativeProfile;
  }
  if (typeof module === 'object' && module.exports) module.exports = { summarize, createTrace, install };
  else try { install(window); } catch (error) { console.error('Native city profiler not installed:', error.message); }
})();

return module.exports; })();
const actor = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const normalize = value => value.replace(/\r\n/g, '\n').trim();
  const assignment = 'window.combatCharactersString = JSON.stringify(window.combatCharacters);';
  function sources(game) {
    game = normalize(game);
    function between(start, end) {
      if (game.split(start).length !== 2 || game.split(end).length !== 2) throw Error('Trial source boundaries changed. Nothing installed.');
      const left = game.indexOf(start), right = game.indexOf(end, left + start.length);
      if (right < 0) throw Error('Trial source order changed. Nothing installed.');
      return game.slice(left, right).trim();
    }
    return {
      sync: between('function syncPartyMazeToCombatPositions(forceReset = false) {', '\nlet _partyMazeStepAt = 0;'),
      sprite: between('function getProceduralSpriteFor(entry) {', '\n// Returns true when the entry\'s sprite changed.'),
      positions: between('updatePositions(characters) {', '\n    centerCameraOn(')
    };
  }
  function patch(source) {
    if (source.split(assignment).length !== 2) throw Error('Trial serialization site changed. Nothing installed.');
    return source.replace(assignment, 'window.CityActorTrial.deferRosterWrite();');
  }
  function spriteCache(root, original, enabled = () => true, limits = {}) {
    const entries = new Map(), maxEntries = limits.entries ?? 128, maxCharacters = limits.characters ?? 2 * 1024 * 1024;
    let characters = 0, renderer = root.createTraitSpriteCanvas;
    const counts = { hits: 0, misses: 0, bypasses: 0, evictions: 0 };
    function clear() { entries.clear(); characters = 0; }
    function draw(entry, ...rest) {
      const sprite = entry?.sprite;
      if (!enabled() || entry?.ambient || rest.length || !sprite?.appearanceLocked || sprite.spec?.kind !== 'procedural' || sprite.dataUrl) {
        counts.bypasses++; return original.call(this, entry, ...rest);
      }
      if (renderer !== root.createTraitSpriteCanvas) { clear(); renderer = root.createTraitSpriteCanvas; }
      // Cache the generated image string, never a mutable shared canvas or a character's identity/stats.
      let key;
      try { key = JSON.stringify(sprite.spec); } catch { counts.bypasses++; return original.call(this, entry); }
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key); entries.set(key, cached); counts.hits++;
        entry.sprite = { ...sprite, dataUrl: cached }; return entry.sprite;
      }
      counts.misses++;
      const result = original.call(this, entry), data = result?.dataUrl;
      if (typeof data === 'string' && data && data.length + key.length <= maxCharacters) {
        entries.set(key, data); characters += key.length + data.length;
        while (entries.size > maxEntries || characters > maxCharacters) {
          const [oldKey, value] = entries.entries().next().value;
          entries.delete(oldKey); characters -= oldKey.length + value.length; counts.evictions++;
        }
      }
      return result;
    }
    return { draw, clear, reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
      diagnostics: () => ({ ...counts, entries: entries.size, retainedCharacters: characters }) };
  }
  function lazyRoster(root) {
    const descriptor = Object.getOwnPropertyDescriptor(root, 'combatCharactersString');
    if (!descriptor?.configurable || !descriptor.writable || !Object.hasOwn(descriptor, 'value'))
      throw Error('The roster-string property cannot be safely restored. Nothing installed.');
    let dirty = false, value = descriptor.value, active = true;
    const counts = { deferredWrites: 0, materializations: 0, reads: 0, externalWrites: 0 };
    const get = function() {
      counts.reads++;
      if (dirty) { value = root.JSON.stringify(root.combatCharacters); dirty = false; counts.materializations++; }
      return value;
    };
    const set = function(next) { value = next; dirty = false; counts.externalWrites++; };
    Object.defineProperty(root, 'combatCharactersString', { configurable: true, enumerable: descriptor.enumerable, get, set });
    return {
      dirty() { dirty = true; counts.deferredWrites++; },
      reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
      diagnostics: () => ({ ...counts, dirty }),
      intact: () => Object.getOwnPropertyDescriptor(root, 'combatCharactersString')?.get === get,
      restore() {
        if (!active) return; active = false;
        if (Object.getOwnPropertyDescriptor(root, 'combatCharactersString')?.get === get) {
          const latest = get(); Object.defineProperty(root, 'combatCharactersString', { ...descriptor, value: latest });
        }
      }
    };
  }
  function compact(report, mode, counts) {
    const copy = JSON.parse(JSON.stringify(report));
    copy.kind = 'city-actor-optimization-trial'; copy.mode = mode; copy.optimizationChanges = mode !== 'baseline'; copy.actorOptimization = counts;
    copy.longTaskCount = copy.longTasks.length;
    copy.longTaskMaxMs = copy.longTasks.length ? Math.max(...copy.longTasks.map(t => t.durationMs)) : 0;
    delete copy.longTasks;
    copy.breakdown.longTasks = copy.breakdown.longTasks.sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
    copy.breakdown.worstFrameGaps = copy.breakdown.worstFrameGaps.slice(0, 3);
    copy.breakdown.sections = copy.breakdown.sections.map(({ name, calls, inclusiveMs, exclusiveMs, medianMs, p95Ms, maxMs, samplesTruncated }) =>
      ({ name, calls, inclusiveMs, exclusiveMs, medianMs, p95Ms, maxMs, ...(samplesTruncated ? { samplesTruncated } : {}) }));
    delete copy.overall.first; delete copy.overall.last;
    if (copy.whileMoving) { delete copy.whileMoving.first; delete copy.whileMoving.last; }
    copy.note = 'Same profiler in each mode; walk comparable routes. This is not an identical-input replay. Original functions restore after each capture.';
    return copy;
  }
  function prepare(root, expected) {
    const scene = root.combatGame?.scene?.getScene('CombatScene');
    const originals = { sync: root.syncPartyMazeToCombatPositions, sprite: root.getProceduralSpriteFor, positions: scene?.updatePositions };
    for (const name of Object.keys(originals)) if (typeof originals[name] !== 'function' || normalize(originals[name].toString()) !== expected[name])
      throw Error('Running ' + name + ' method does not match verified source. Nothing installed.');
    const sync = root.eval('(' + patch(expected.sync) + ')');
    const positions = root.eval('({' + patch(expected.positions) + '}).updatePositions');
    return { scene, originals, sync, positions };
  }
  function install(root, profiler, expected) {
    if (root.CityActorTrial?.active?.()) throw Error('An actor trial is already installed. Use its buttons or Undo first.');
    let prepared = prepare(root, expected), scene = prepared.scene, originals = prepared.originals;
    let dungeon = root.currentDungeon, runId = root.dungeonRunId, floor = JSON.stringify(dungeon?.cityFloorContext);
    let presenter = root.webglDungeonRenderer;
    let disposed = false, busy = false, mode = 'baseline', cache = null, roster = null, measurement = null, delivery = null, captured = null;
    const results = [];
    const sameContext = () => !disposed && root.currentDungeon === dungeon && root.dungeonRunId === runId &&
      JSON.stringify(dungeon.cityFloorContext) === floor && root.webglDungeonRenderer === presenter &&
      !root.isCombatRoundActive?.() && !root.actionDiceState?.active && !root.CombatTacticalUi?.active?.() &&
      !root._combatCommandPending && !root._deathSceneActive && !root._gameOver;
    function restore() {
      if (cache && root.getProceduralSpriteFor === cache.draw) root.getProceduralSpriteFor = originals.sprite;
      if (root.syncPartyMazeToCombatPositions === prepared.sync) root.syncPartyMazeToCombatPositions = originals.sync;
      if (scene.updatePositions === prepared.positions) scene.updatePositions = originals.positions;
      roster?.restore();
    }
    const counts = () => ({ sprite: cache?.diagnostics() || null, roster: roster?.diagnostics() || null });
    const reset = () => { cache?.reset(); roster?.reset(); };
    function bindCurrentContext() {
      measurement?.undo(); restore();
      if (root.actionDiceState?.active) throw Error('An action is active. Finish it, then click the capture again.');
      if (root.isCombatRoundActive?.() || root.CombatTacticalUi?.active?.() || root._combatCommandPending)
        throw Error('Combat is active or still finishing. Wait for exploration, then click again.');
      if (root._deathSceneActive || root._gameOver) throw Error('Finish the death/revival screen before capturing.');
      prepared = prepare(root, expected); scene = prepared.scene; originals = prepared.originals;
      dungeon = root.currentDungeon; runId = root.dungeonRunId; floor = JSON.stringify(dungeon?.cityFloorContext);
      presenter = root.webglDungeonRenderer;
    }
    function activate(next) {
      if (!['baseline', 'sprites', 'sprites-json'].includes(next)) throw Error('Unknown trial mode.');
      if (!sameContext() || root.getProceduralSpriteFor !== originals.sprite || root.syncPartyMazeToCombatPositions !== originals.sync ||
        scene.updatePositions !== originals.positions) throw Error('Room, combat or methods changed. Reload the trial.');
      mode = next; cache = null; roster = null;
      try {
        if (next !== 'baseline') { cache = spriteCache(root, originals.sprite, sameContext); root.getProceduralSpriteFor = cache.draw; }
        if (next === 'sprites-json') {
          roster = lazyRoster(root); root.syncPartyMazeToCombatPositions = prepared.sync; scene.updatePositions = prepared.positions;
        }
      } catch (error) { restore(); throw error; }
    }
    const panel = root.document.createElement('section'); panel.id = 'city-actor-trial';
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:min(510px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;pointer-events:auto;padding:12px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace';
    const status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'Actor optimization trial. No engine changes.\nUnpause and close DevTools. Use comparable outdoor routes.\nBaseline, then sprites, then sprites + JSON. Each walk lasts 20 seconds.';
    const buttons = [];
    const api = { results, active: () => !disposed, deferRosterWrite() {
      if (roster && sameContext()) roster.dirty();
      else root.combatCharactersString = root.JSON.stringify(root.combatCharacters);
    }, undo() {
      if (disposed) return;
      measurement?.undo(); restore(); disposed = true; root.clearTimeout(expiration); panel.remove();
    }, async capture(next = 'baseline') {
      if (busy || disposed) return;
      if (root.gamePaused) { status.textContent = 'Unpause first, then click the desired 20-second capture.'; return; }
      busy = true; delivery = null; captured = null; buttons.forEach(b => { b.disabled = true; });
      try {
        status.textContent = next + ': checking the current city...';
        bindCurrentContext();
        activate(next);
        measurement = createMeasurement();
        const report = await measurement.capture();
        if (!report) { status.textContent = 'Capture did not start. Unpause and finish any active action, then click again.'; return; }
        const value = captured || compact(report, mode, counts()); results.push(value);
        status.textContent = (value.valid ? next + ': ' + value.overall.renderedRafFPS + ' FPS; p95 gap ' + value.overall.rafP95Ms + 'ms.' : value.reason) +
          '\n' + (delivery === true ? 'Server log confirmed.' : 'Log delivery failed; results remain in CityActorTrial.results.') + '\nOriginal methods restored. Ready for the next mode.';
        return value;
      } catch (error) { status.textContent = error.message; root.console.error('Actor trial:', error.message); }
      finally { restore(); cache?.clear(); busy = false; buttons.forEach(b => { b.disabled = false; }); }
    } };
    function createMeasurement() {
      root.CityNativeProfile?.undo();
      const instance = profiler.install(root, { onStart: reset, optimizationChanges: () => mode !== 'baseline',
      onProgress({ phase, seconds }) {
        if (!disposed) status.textContent = mode + (phase === 'warming' ? ': starting in ' + seconds + ' seconds.' : ': CAPTURING - ' + seconds + ' seconds left.') +
          '\nWalk and turn in the city. Avoid buildings and combat.';
      },
      validate: () => root.getProceduralSpriteFor === (cache?.draw || originals.sprite) &&
        root.combatGame?.scene?.getScene('CombatScene') === scene &&
        scene.updatePositions === (roster ? prepared.positions : originals.positions) && (!roster || roster.intact()),
      async onReport(report) {
      const value = compact(report, mode, counts()); captured = value;
      // Restore before network delivery, including on failed/aborted captures.
      restore(); cache?.clear();
      const body = JSON.stringify({ reason: 'city-actor-trial', geoKey: dungeon.geoKey, geometryStamp: dungeon._geometryStamp,
        backend: presenter.mode || 'webgl', samples: [], trial: value });
      if (body.length > 12000) throw Error('Compact diagnostic exceeded the safe log size; result retained locally.');
      let timeout;
      const response = await Promise.race([
        root.fetch('/debug/dungeon-rendering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        new Promise((_, reject) => { timeout = root.setTimeout(() => reject(Error('Diagnostic delivery timed out; result retained locally.')), 5000); })
      ]).finally(() => root.clearTimeout(timeout));
      delivery = response.ok;
      if (!response.ok) throw Error('Diagnostic delivery failed: HTTP ' + response.status);
      } });
      const inner = root.document.getElementById('city-native-profile');
      if (inner) inner.style.display = 'none';
      return instance;
    }
    root.CityNativeProfile?.undo();
    panel.append(status);
    for (const [label, next] of [['Baseline (20s)', 'baseline'], ['Sprites (20s)', 'sprites'], ['Sprites + JSON (20s)', 'sprites-json']]) {
      const button = root.document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.style.cssText = 'margin:4px 2px;padding:5px 8px;cursor:pointer';
      button.addEventListener('click', () => api.capture(next));
      buttons.push(button); panel.append(button);
    }
    const undo = root.document.createElement('button'); undo.textContent = 'Close / Undo'; undo.addEventListener('click', api.undo); panel.append(undo);
    const expiration = root.setTimeout(api.undo, 10 * 60 * 1000);
    root.CityActorTrial = api; root.document.body.appendChild(panel);
    return api;
  }
  if (typeof module === 'object' && module.exports) module.exports = { sources, patch, spriteCache, lazyRoster, compact, prepare, install };
})();

return module.exports; })();
try { actor.install(root, profiler, {"sync":"function syncPartyMazeToCombatPositions(forceReset = false) {\n  if (!shouldUsePartyMazeAnchors()) return;\n  if (forceReset || !isCombatRoundActive()) ensurePartyMazeAnchors(forceReset);\n  const roomKey = getCurrentCombatRoomKey();\n\n  window.combatCharacters.forEach(entry => {\n    if (!entry) return;\n    if (entry.type === 'pc') {\n      entry.x = COMBAT_GRID_CENTER;\n      entry.y = COMBAT_GRID_CENTER;\n      entry.mazeX = playerDungeonX;\n      entry.mazeY = playerDungeonY;\n      entry.mazePoint={x:playerPosX,y:playerPosY};\n      entry.mazeRoomKey = roomKey;\n    } else if ((entry.type === 'npc' || entry.type === 'monster') && Number.isFinite(entry.mazeX) && Number.isFinite(entry.mazeY)) {\n      const projected = projectMazePointToCombatGrid(entry.mazeX + 0.5, entry.mazeY + 0.5);\n      entry.x = projected.x;\n      entry.y = projected.y;\n    }\n  });\n\n  window.combatCharactersString = JSON.stringify(window.combatCharacters);\n}","sprite":"function getProceduralSpriteFor(entry) {\n  if(entry?.ambient)return entry.sprite;\n  if(entry?.sprite?.appearanceLocked&&entry.sprite.spec?.kind==='procedural'){\n    if(!entry.sprite.dataUrl){\n      const canvas=window.createTraitSpriteCanvas?.(entry.sprite.spec,0);\n      const dataUrl=canvas?.toDataURL?.('image/png');if(dataUrl)entry.sprite={...entry.sprite,dataUrl};\n    }\n    return entry.sprite;\n  }\n  const api = getProceduralCharactersApi();\n  if (!api || !entry || !entry.name) return null;\n  const key = proceduralNameKey(entry.name);\n  const sheet = buildProceduralSheetForEntry(entry);\n  requestCharacterTraitSpecs([sheet]);\n  const server = window._characterTraitSpecs[key] || null;\n  const ready = !!(server && server.source === 'llm' && server.traits);\n  const sig = (ready ? [server.salt, server.variant, sheet.level,\n    hashCharacterName(JSON.stringify([server.traits,server.stature,proceduralSheetSignature(sheet),sheet.isMonster,sheet.role])).toString(36)].join(':') : 'placeholder');\n  const cached = window._proceduralSpriteCache[key];\n  if (cached && cached.sig === sig) return cached.sprite;\n  let sprite;\n  if (!ready) {\n    sprite = createSpritePlaceholder(entry);\n  } else {\n    try {\n      const spec = api.buildProceduralSpriteSpec(sheet, server.traits, { salt: server.salt >>> 0, variant: server.variant | 0, source: 'llm', stature:server.stature });\n      const canvas = window.createTraitSpriteCanvas(spec, 0);\n      const dataUrl = canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : '';\n      if (!dataUrl) return null;\n      sprite = { dataUrl, spec, generated: true, clientOnly: true, procedural: true, source: 'llm', monster: entry.type === 'monster' };\n    } catch (e) {\n      console.warn('[Sprite] trait sprite failed', entry.name, e);\n      sprite = createSpritePlaceholder(entry);\n    }\n  }\n  window._proceduralSpriteCache[key] = { sprite, sig };\n  return sprite;\n}","positions":"updatePositions(characters) {\n        characters = characters.filter(isDungeonActorPresent);\n    // console.log(\"Updating CombatScene positions with:\", characters);\n        if (this.sys && this.sys.game && this.sys.game.loop) {\n            this.sys.game.loop.wake();\n        }\n        ensurePCSpriteInCombatList(characters);\n        window.combatCharacters = Array.isArray(window.combatCharacters) ? window.combatCharacters : [];\n        characters.forEach(character => {\n            const existingChar = window.combatCharacters.find(c => c.name === character.name);\n            copyCombatPersistentFields(character, existingChar);\n        });\n        characters = characters.filter(isDungeonActorPresent);\n        characters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (charData) {\n                charData.x = character.x;\n                charData.y = character.y;\n                charData.type = character.type;\n                if (!character.sprite || !character.sprite.dataUrl) ensureKnownSpritesInCombatList([character]);\n                refreshCombatVisualIfStale(this, charData, character);\n                applyCombatVisualFrame(charData.sprite, character);\n                moveCombatVisualTo(this, charData, character, false);\n            } else {\n                // Add new character if not present\n                let sprite;\n                if (character.type === 'pc') this.pcName = character.name;\n                sprite = createCombatVisual(this, character);\n                sprite.setOrigin(0.5, 0.5);\n                const pcFontSize = (character.type === 'pc') ? '10px' : '11px';\n                let label = this.add.text(character.x * 25 + 12.5, character.y * 25 + 29, '', {\n                    fontSize: pcFontSize,\n                    color: '#ffffff',\n                    align: 'center'\n                });\n                label.setOrigin(0.5, 0.5);\n                label.setVisible(false);\n                this.characters[character.name] = { sprite, label, x: character.x, y: character.y, type: character.type, texKey: sprite._holodekTexKey || null };\n                applyCombatVisualFrame(sprite, character);\n            }\n            // Update window.combatCharacters with the latest position\n            const charInGlobal = window.combatCharacters.find(c => c.name === character.name);\n            if (charInGlobal) {\n                charInGlobal.x = character.x;\n                charInGlobal.y = character.y;\n                if (Number.isFinite(character.mazeX)) charInGlobal.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) charInGlobal.mazeY = character.mazeY;\n                if (character.mazeRoomKey) charInGlobal.mazeRoomKey = character.mazeRoomKey;\n                if (!charInGlobal.sprite && character.sprite) charInGlobal.sprite = character.sprite;\n                if (Number.isFinite(character.walkFrame)) charInGlobal.walkFrame = character.walkFrame;\n                if (character.facing) charInGlobal.facing = character.facing;\n                for (const field of ['hp', 'state', 'allegiance']) {\n                    if (character[field] !== undefined) charInGlobal[field] = character[field];\n                }\n            } else {\n                const entry = { name: character.name, type: character.type, x: character.x, y: character.y };\n                if (character.sprite) entry.sprite = character.sprite;\n                if (Number.isFinite(character.mazeX)) entry.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) entry.mazeY = character.mazeY;\n                if (character.mazeRoomKey) entry.mazeRoomKey = character.mazeRoomKey;\n                if (Number.isFinite(character.walkFrame)) entry.walkFrame = character.walkFrame;\n                if (character.facing) entry.facing = character.facing;\n                copyCombatPersistentFields(entry, character);\n                window.combatCharacters.push(entry);\n            }\n        });\n        // Remove characters no longer present from window.combatCharacters\n        window.combatCharacters = window.combatCharacters.filter(c => characters.some(ch => ch.name === c.name));\n        syncPartyMazeToCombatPositions(false);\n        window.combatCharacters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (!charData) return;\n            charData.x = character.x;\n            charData.y = character.y;\n            applyCombatVisualFrame(charData.sprite, character);\n            moveCombatVisualTo(this, charData, character, false);\n            setCombatVisualOverlayVisible(charData, character.discoveryState !== 'pending');\n        });\n        setCombatPlayerTokenOwner(this,this._pcTokenComposited);\n        ensurePCSpriteInCombatList(window.combatCharacters);\n        // Update combatCharactersString globally\n        window.combatCharactersString = JSON.stringify(window.combatCharacters);\n    // console.log(\"Updated window.combatCharactersString in updatePositions:\", window.combatCharactersString);\n        // Remove characters no longer present\n        Object.keys(this.characters).forEach(name => {\n            if (!characters.some(c => c.name === name)) {\n                const charData = this.characters[name];\n                charData.sprite.destroy();\n                charData.label.destroy();\n                delete this.characters[name];\n            }\n        });\n        // Initiative can arrive before the roster. Repaint the ground ink after\n        // merging actors, not just their sprites, while retaining map positions.\n        this.redrawCombatRT();\n        if (this._movementSleepTimer) {\n            this._movementSleepTimer.remove(false);\n            this._movementSleepTimer = null;\n        }\n        this._movementSleepTimer = this.time.delayedCall(260, () => {\n            this.sys.game.loop.sleep();\n            this._movementSleepTimer = null;\n        });\n    }"}); } catch(error) { root.console.error('City actor trial not installed:', error.message); }
})(window);
