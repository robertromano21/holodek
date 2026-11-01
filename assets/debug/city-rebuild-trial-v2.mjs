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
  function install(root, profiler, expected, options = {}) {
    if (root.CityActorTrial?.active?.()) throw Error('An actor trial is already installed. Use its buttons or Undo first.');
    let prepared = prepare(root, expected), scene = prepared.scene, originals = prepared.originals;
    let dungeon = root.currentDungeon, runId = root.dungeonRunId, floor = JSON.stringify(dungeon?.cityFloorContext);
    let presenter = root.webglDungeonRenderer;
    let disposed = false, busy = false, mode = 'baseline', cache = null, roster = null, extension = null, measurement = null, delivery = null, captured = null;
    const modes = options.modes || [{ id: 'baseline', label: 'Baseline (20s)' }, { id: 'sprites', label: 'Sprites (20s)' }, { id: 'sprites-json', label: 'Sprites + JSON (20s)' }];
    const results = [];
    const sameContext = () => !disposed && root.currentDungeon === dungeon && root.dungeonRunId === runId &&
      JSON.stringify(dungeon.cityFloorContext) === floor && root.webglDungeonRenderer === presenter &&
      !root.isCombatRoundActive?.() && !root.actionDiceState?.active && !root.CombatTacticalUi?.active?.() &&
      !root._combatCommandPending && !root._deathSceneActive && !root._gameOver;
    function restore() {
      extension?.restore();
      if (cache && root.getProceduralSpriteFor === cache.draw) root.getProceduralSpriteFor = originals.sprite;
      if (root.syncPartyMazeToCombatPositions === prepared.sync) root.syncPartyMazeToCombatPositions = originals.sync;
      if (scene.updatePositions === prepared.positions) scene.updatePositions = originals.positions;
      roster?.restore();
    }
    const counts = () => ({ sprite: cache?.diagnostics() || null, roster: roster?.diagnostics() || null,
      ...(options.activate ? { rebuild: extension?.diagnostics() || null } : {}) });
    const reset = () => { cache?.reset(); roster?.reset(); extension?.reset(); };
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
      const selected = modes.find(m => m.id === next);
      if (!selected) throw Error('Unknown trial mode.');
      const base = selected.base || next;
      if (!['baseline', 'sprites', 'sprites-json'].includes(base)) throw Error('Unknown base trial mode.');
      if (!sameContext() || root.getProceduralSpriteFor !== originals.sprite || root.syncPartyMazeToCombatPositions !== originals.sync ||
        scene.updatePositions !== originals.positions) throw Error('Room, combat or methods changed. Reload the trial.');
      mode = next; cache = null; roster = null; extension = null;
      try {
        if (base !== 'baseline') { cache = spriteCache(root, originals.sprite, sameContext); root.getProceduralSpriteFor = cache.draw; }
        if (base === 'sprites-json') {
          roster = lazyRoster(root); root.syncPartyMazeToCombatPositions = prepared.sync; scene.updatePositions = prepared.positions;
        }
        extension = options.activate?.(next, { dungeon, presenter, scene });
      } catch (error) { restore(); throw error; }
    }
    const panel = root.document.createElement('section'); panel.id = 'city-actor-trial';
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:min(510px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;pointer-events:auto;padding:12px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace';
    const status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = options.instructions || 'Actor optimization trial. No engine changes.\nUnpause and close DevTools. Use comparable outdoor routes.\nBaseline, then sprites, then sprites + JSON. Each walk lasts 20 seconds.';
    const buttons = [];
    const api = { results, active: () => !disposed, deferRosterWrite() {
      if (roster && sameContext()) roster.dirty();
      else root.combatCharactersString = root.JSON.stringify(root.combatCharacters);
    }, undo() {
      if (disposed) return;
      measurement?.undo(); restore(); disposed = true; root.clearTimeout(expiration); panel.remove();
    }, async capture(next = modes[0].id) {
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
        scene.updatePositions === (roster ? prepared.positions : originals.positions) && (!roster || roster.intact()) && (!extension || extension.intact()),
      async onReport(report) {
      const value = compact(report, mode, counts()); captured = value;
      // Restore before network delivery, including on failed/aborted captures.
      restore(); cache?.clear();
      const body = JSON.stringify({ reason: options.logReason || 'city-actor-trial', geoKey: dungeon.geoKey, geometryStamp: dungeon._geometryStamp,
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
    for (const { label, id: next } of modes) {
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
const rebuild = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const normalize = source => source.replace(/\r\n/g, '\n').trim();
  function replace(source, before, after, count = 1) {
    if (source.split(before).length !== count + 1) throw Error('Navigation source changed. Nothing installed: ' + before);
    return source.replaceAll(before, after);
  }
  function installSource(source) {
    source = normalize(source);
    const start = source.indexOf('function install(dungeon,'), end = source.indexOf('\n  function frameKind(', start);
    if (start < 0 || end < 0) throw Error('Navigation source boundaries changed.');
    return source.slice(start, end).trim();
  }
  function deltaSource(source) {
    source = normalize(source);
    const marker = 'window.applyLivingEnvironmentDelta = ', start = source.indexOf(marker), end = source.indexOf('\n// SSE handler', start);
    if (start < 0 || end < 0 || source.split(marker).length !== 2) throw Error('Delta source boundaries changed.');
    return source.slice(start + marker.length, end).trim().replace(/;$/, '');
  }
  function patchExits(source) {
    source = replace(source, 'const first = sx + sy * w;', 'const denseCells = __denseLookup(dungeon);\n    const first = sx + sy * w;');
    source = replace(source, 'passable(dungeon.cells[`${sx},${sy}`])', 'passable(denseCells[first])');
    source = replace(source, 'dungeon.cells[`${x},${y}`].floorHeight', 'denseCells[i].floorHeight');
    source = replace(source, 'c = dungeon.cells[`${nx},${ny}`]', 'c = denseCells[j]');
    source = replace(source, 'c = dungeon.cells[`${x},${y}`]', 'c = denseCells[i]', 3);
    source = replace(source, 'const markers = [], missing = [];', `// Keep BFS order; distant unplanned cells fail every direction's existing radius test.
    const candidates = [];
    for (let n = 0; n < count; n++) {
      const i = q[n], c = denseCells[i];
      if (c.tile === 'floor' && !c.feature && !c.interactable &&
        (Math.hypot(i % w - sx, Math.floor(i / w) - sy) <= 80 || c.complexExit || c.exit)) candidates.push(i);
    }
    const markers = [], missing = [];`);
    source = replace(source, 'for (let n = 0; !bound && n < count; n++) {\n        const i = q[n]',
      'for (let n = 0; !bound && n < candidates.length; n++) {\n        const i = candidates[n]');
    return source;
  }
  function gridCache(count = () => {}) {
    let entry = null;
    function get(dungeon) {
      const w = dungeon.layout?.width, h = dungeon.layout?.height;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 512 || h > 512) throw Error('Unsupported navigation grid.');
      if (!entry || entry.dungeon !== dungeon || entry.cells !== dungeon.cells || entry.w !== w || entry.h !== h || entry.stamp !== dungeon._geometryStamp) {
        const values = new Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[x + y * w] = dungeon.cells[`${x},${y}`];
        entry = { dungeon, cells: dungeon.cells, stamp: dungeon._geometryStamp, w, h, values }; count('denseBuilds');
      }
      return entry.values;
    }
    function delta(dungeon, previousStamp, data) {
      if (!entry || entry.dungeon !== dungeon) return;
      if (entry.cells !== dungeon.cells || entry.stamp !== previousStamp || data.cityStream?.snapshot ||
        entry.w !== dungeon.layout?.width || entry.h !== dungeon.layout?.height) { entry = null; count('denseInvalidations'); return; }
      for (const key of Object.keys(data.cells || {})) {
        const [x, y] = key.split(',').map(Number);
        if (Number.isInteger(x) && Number.isInteger(y) && `${x},${y}` === key && x >= 0 && y >= 0 && x < entry.w && y < entry.h) {
          entry.values[x + y * entry.w] = dungeon.cells[key]; count('densePatchedCells');
        }
      }
      entry.stamp = dungeon._geometryStamp; count('densePatches');
    }
    return { get, delta, clear() { entry = null; } };
  }
  function chunkIndex(count = () => {}) {
    let entry = null;
    const kinds = dungeon => Object.keys(dungeon.tiles || {}).filter(k => !!dungeon.tiles[k]?.spriteSpec).sort().join('|');
    function query(dungeon, x, y, radius) {
      const stamp = dungeon?._geometryStamp || dungeon?._meta?.geometryStamp;
      if (!stamp || !dungeon.cells || ![x, y, radius].every(Number.isInteger) || radius < 0) return null;
      const signature = kinds(dungeon);
      if (!entry || entry.dungeon !== dungeon || entry.cells !== dungeon.cells || entry.stamp !== stamp || entry.kinds !== signature) {
        entry = { dungeon, cells: dungeon.cells, stamp, kinds: signature, chunks: new Map(), queries: new Map() }; count('visibleIndexResets');
      }
      const key = `${x},${y},${radius}`;
      if (entry.queries.has(key)) { count('visibleQueryHits'); return entry.queries.get(key); }
      const result = [], tiles = dungeon.tiles || {};
      for (let cx = Math.floor((x - radius) / 16); cx <= Math.floor((x + radius) / 16); cx++) {
        for (let cy = Math.floor((y - radius) / 16); cy <= Math.floor((y + radius) / 16); cy++) {
          const chunkKey = `${cx},${cy}`; let rows = entry.chunks.get(chunkKey);
          if (!rows) {
            rows = [];
            for (let dx = 0; dx < 16; dx++) for (let dy = 0; dy < 16; dy++) {
              const wx = cx * 16 + dx, wy = cy * 16 + dy, cell = dungeon.cells[`${wx},${wy}`], tile = cell?.tile;
              if (tile === 'torch' || tile === 'pillar' || typeof tile === 'string' && tile.startsWith('custom_') || tiles[tile]?.spriteSpec) rows.push([wx, wy, cell]);
            }
            if (entry.chunks.size >= 256) entry.chunks.delete(entry.chunks.keys().next().value);
            entry.chunks.set(chunkKey, rows); count('visibleChunkBuilds');
          }
          for (const row of rows) if (Math.abs(row[0] - x) <= radius && Math.abs(row[1] - y) <= radius) result.push(row);
        }
      }
      result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (entry.queries.size >= 32) entry.queries.delete(entry.queries.keys().next().value);
      entry.queries.set(key, result); count('visibleQueries'); return result;
    }
    function delta(dungeon, previousStamp, data) {
      if (!entry || entry.dungeon !== dungeon) return;
      if (entry.cells !== dungeon.cells || entry.stamp !== previousStamp || data.cityStream?.snapshot || entry.kinds !== kinds(dungeon)) {
        entry = null; count('visibleDeltaInvalidations'); return;
      }
      for (const key of Object.keys(data.cells || {})) {
        const [x, y] = key.split(',').map(Number);
        if (Number.isInteger(x) && Number.isInteger(y) && `${x},${y}` === key) entry.chunks.delete(`${Math.floor(x / 16)},${Math.floor(y / 16)}`);
      }
      entry.queries.clear(); entry.stamp = dungeon._geometryStamp; count('visibleDeltaPatches');
    }
    return { query, delta, clear() { entry = null; } };
  }
  function questCache(grid, count = () => {}) {
    let entry = null;
    function floors(dungeon, w, h, start) {
      if (w !== dungeon.layout?.width || h !== dungeon.layout?.height) return null;
      const signature = JSON.stringify([w, h, start.x, start.y, dungeon.cityFloorContext,
        dungeon.roomExits?.markers?.map(m => [m.key, m.x, m.y, m.direction])]);
      if (entry?.dungeon === dungeon && entry.cells === dungeon.cells && entry.stamp === dungeon._geometryStamp && entry.signature === signature) {
        count('denseQuestHits'); return entry.values;
      }
      const cells = grid.get(dungeon), values = [];
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        const cell = cells[x + y * w];
        if (cell?.tile === 'floor' && !cell.exitMarker && Math.hypot(x - start.x, y - start.y) >= Math.min(w, h) / 4) values.push({ x, y });
      }
      entry = { dungeon, cells: dungeon.cells, stamp: dungeon._geometryStamp, signature, values }; count('denseQuestBuilds'); return values;
    }
    return { floors, clear() { entry = null; } };
  }
  function activate(root, context, exitsSource, expected = null) {
    const dungeon = context.dungeon, native = root.DungeonPerformance, exits = root.DungeonExits;
    const decorator = root.SceneExteriorDetails?.forRendering;
    if (normalize(exits.install.toString()) !== installSource(exitsSource)) throw Error('Running exit navigation differs from tested source. Nothing installed.');
    for (const [name, method] of [['query', native.query], ['questFloors', native.questFloors], ['delta', root.applyLivingEnvironmentDelta]]) {
      if (typeof method !== 'function' || expected && normalize(method.toString()) !== expected[name])
        throw Error('Running ' + name + ' differs from tested source. Nothing installed.');
    }
    if (expected && Object.hasOwn(expected, 'renderView') &&
      (typeof decorator !== 'function' || normalize(decorator.toString()) !== expected.renderView))
      throw Error('Running render-view decorator differs from tested source. Nothing installed.');
    const counts = {}, count = name => { counts[name] = (counts[name] || 0) + 1; };
    const grid = gridCache(count), spatial = chunkIndex(count), quest = questCache(grid, count);
    const fast = root.Function('window', 'module', '__denseLookup', patchExits(exitsSource) + '\nreturn module.exports;')(root, { exports: {} }, grid.get);
    const hooks = [];
    function hook(owner, key, wrapper) { const original = owner[key]; owner[key] = wrapper(original); hooks.push({ owner, key, original, wrapper: owner[key] }); }
    try {
      grid.get(dungeon);
      hook(exits, 'install', original => function(d, ...args) {
        if (d !== dungeon || d.layout?.width > 512 || d.layout?.height > 512) return original.call(this, d, ...args);
        const at = root.performance.now();
        try { return fast.install(d, ...args); }
        finally { count('navigationCalls'); counts.navigationMs = (counts.navigationMs || 0) + root.performance.now() - at; }
      });
      hook(native, 'query', original => function(d, ...args) {
        // Render the authoritative decorator's cells, including its added lights, not the saved-room substitute.
        const current = root.currentDungeon === dungeon;
        const decorated = current && typeof decorator === 'function' && root.SceneExteriorDetails?.forRendering === decorator &&
          d === root.SceneExteriorDetails.forRendering(dungeon);
        if (current && (d === dungeon || decorated)) {
          count('renderQueryCalls'); if (d !== dungeon) count('decoratedRenderQueries');
          return spatial.query(d, ...args);
        }
        count('renderQueryFallbacks'); return original.call(this, d, ...args);
      });
      hook(native, 'questFloors', original => function(d, ...args) { return d === dungeon ? quest.floors(d, ...args) ?? original.call(this, d, ...args) : original.call(this, d, ...args); });
      hook(root, 'applyLivingEnvironmentDelta', original => function(data, ...args) {
        const previousStamp = dungeon._geometryStamp, beforeCells = dungeon.cells;
        const result = original.call(this, data, ...args);
        if (root.currentDungeon === dungeon && dungeon.geoKey === data.geoKey && dungeon._geometryStamp === data.geometryStamp &&
          (dungeon._geometryStamp !== previousStamp || dungeon.cells !== beforeCells)) {
          grid.delta(dungeon, previousStamp, data); spatial.delta(dungeon, previousStamp, data); count('geometryDeltas');
        }
        return result;
      });
    } catch (error) { for (const h of hooks.toReversed()) if (h.owner[h.key] === h.wrapper) h.owner[h.key] = h.original; throw error; }
    return { reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
      diagnostics: () => ({ ...counts, renderPathExercised: (counts.renderQueryCalls || 0) > 0 }),
      intact: () => hooks.every(h => h.owner[h.key] === h.wrapper) && root.SceneExteriorDetails?.forRendering === decorator,
      restore() { for (const h of hooks.toReversed()) if (h.owner[h.key] === h.wrapper) h.owner[h.key] = h.original; grid.clear(); spatial.clear(); quest.clear(); } };
  }
  if (typeof module === 'object' && module.exports) module.exports = { patchExits, installSource, deltaSource, gridCache, chunkIndex, questCache, activate };
})();

return module.exports; })();
try { root.CityActorTrial?.undo(); root.CityRebuildTrial = actor.install(root, profiler, {"sync":"function syncPartyMazeToCombatPositions(forceReset = false) {\n  if (!shouldUsePartyMazeAnchors()) return;\n  if (forceReset || !isCombatRoundActive()) ensurePartyMazeAnchors(forceReset);\n  const roomKey = getCurrentCombatRoomKey();\n\n  window.combatCharacters.forEach(entry => {\n    if (!entry) return;\n    if (entry.type === 'pc') {\n      entry.x = COMBAT_GRID_CENTER;\n      entry.y = COMBAT_GRID_CENTER;\n      entry.mazeX = playerDungeonX;\n      entry.mazeY = playerDungeonY;\n      entry.mazePoint={x:playerPosX,y:playerPosY};\n      entry.mazeRoomKey = roomKey;\n    } else if ((entry.type === 'npc' || entry.type === 'monster') && Number.isFinite(entry.mazeX) && Number.isFinite(entry.mazeY)) {\n      const projected = projectMazePointToCombatGrid(entry.mazeX + 0.5, entry.mazeY + 0.5);\n      entry.x = projected.x;\n      entry.y = projected.y;\n    }\n  });\n\n  window.combatCharactersString = JSON.stringify(window.combatCharacters);\n}","sprite":"function getProceduralSpriteFor(entry) {\n  if(entry?.ambient)return entry.sprite;\n  if(entry?.sprite?.appearanceLocked&&entry.sprite.spec?.kind==='procedural'){\n    if(!entry.sprite.dataUrl){\n      const canvas=window.createTraitSpriteCanvas?.(entry.sprite.spec,0);\n      const dataUrl=canvas?.toDataURL?.('image/png');if(dataUrl)entry.sprite={...entry.sprite,dataUrl};\n    }\n    return entry.sprite;\n  }\n  const api = getProceduralCharactersApi();\n  if (!api || !entry || !entry.name) return null;\n  const key = proceduralNameKey(entry.name);\n  const sheet = buildProceduralSheetForEntry(entry);\n  requestCharacterTraitSpecs([sheet]);\n  const server = window._characterTraitSpecs[key] || null;\n  const ready = !!(server && server.source === 'llm' && server.traits);\n  const sig = (ready ? [server.salt, server.variant, sheet.level,\n    hashCharacterName(JSON.stringify([server.traits,server.stature,proceduralSheetSignature(sheet),sheet.isMonster,sheet.role])).toString(36)].join(':') : 'placeholder');\n  const cached = window._proceduralSpriteCache[key];\n  if (cached && cached.sig === sig) return cached.sprite;\n  let sprite;\n  if (!ready) {\n    sprite = createSpritePlaceholder(entry);\n  } else {\n    try {\n      const spec = api.buildProceduralSpriteSpec(sheet, server.traits, { salt: server.salt >>> 0, variant: server.variant | 0, source: 'llm', stature:server.stature });\n      const canvas = window.createTraitSpriteCanvas(spec, 0);\n      const dataUrl = canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : '';\n      if (!dataUrl) return null;\n      sprite = { dataUrl, spec, generated: true, clientOnly: true, procedural: true, source: 'llm', monster: entry.type === 'monster' };\n    } catch (e) {\n      console.warn('[Sprite] trait sprite failed', entry.name, e);\n      sprite = createSpritePlaceholder(entry);\n    }\n  }\n  window._proceduralSpriteCache[key] = { sprite, sig };\n  return sprite;\n}","positions":"updatePositions(characters) {\n        characters = characters.filter(isDungeonActorPresent);\n    // console.log(\"Updating CombatScene positions with:\", characters);\n        if (this.sys && this.sys.game && this.sys.game.loop) {\n            this.sys.game.loop.wake();\n        }\n        ensurePCSpriteInCombatList(characters);\n        window.combatCharacters = Array.isArray(window.combatCharacters) ? window.combatCharacters : [];\n        characters.forEach(character => {\n            const existingChar = window.combatCharacters.find(c => c.name === character.name);\n            copyCombatPersistentFields(character, existingChar);\n        });\n        characters = characters.filter(isDungeonActorPresent);\n        characters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (charData) {\n                charData.x = character.x;\n                charData.y = character.y;\n                charData.type = character.type;\n                if (!character.sprite || !character.sprite.dataUrl) ensureKnownSpritesInCombatList([character]);\n                refreshCombatVisualIfStale(this, charData, character);\n                applyCombatVisualFrame(charData.sprite, character);\n                moveCombatVisualTo(this, charData, character, false);\n            } else {\n                // Add new character if not present\n                let sprite;\n                if (character.type === 'pc') this.pcName = character.name;\n                sprite = createCombatVisual(this, character);\n                sprite.setOrigin(0.5, 0.5);\n                const pcFontSize = (character.type === 'pc') ? '10px' : '11px';\n                let label = this.add.text(character.x * 25 + 12.5, character.y * 25 + 29, '', {\n                    fontSize: pcFontSize,\n                    color: '#ffffff',\n                    align: 'center'\n                });\n                label.setOrigin(0.5, 0.5);\n                label.setVisible(false);\n                this.characters[character.name] = { sprite, label, x: character.x, y: character.y, type: character.type, texKey: sprite._holodekTexKey || null };\n                applyCombatVisualFrame(sprite, character);\n            }\n            // Update window.combatCharacters with the latest position\n            const charInGlobal = window.combatCharacters.find(c => c.name === character.name);\n            if (charInGlobal) {\n                charInGlobal.x = character.x;\n                charInGlobal.y = character.y;\n                if (Number.isFinite(character.mazeX)) charInGlobal.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) charInGlobal.mazeY = character.mazeY;\n                if (character.mazeRoomKey) charInGlobal.mazeRoomKey = character.mazeRoomKey;\n                if (!charInGlobal.sprite && character.sprite) charInGlobal.sprite = character.sprite;\n                if (Number.isFinite(character.walkFrame)) charInGlobal.walkFrame = character.walkFrame;\n                if (character.facing) charInGlobal.facing = character.facing;\n                for (const field of ['hp', 'state', 'allegiance']) {\n                    if (character[field] !== undefined) charInGlobal[field] = character[field];\n                }\n            } else {\n                const entry = { name: character.name, type: character.type, x: character.x, y: character.y };\n                if (character.sprite) entry.sprite = character.sprite;\n                if (Number.isFinite(character.mazeX)) entry.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) entry.mazeY = character.mazeY;\n                if (character.mazeRoomKey) entry.mazeRoomKey = character.mazeRoomKey;\n                if (Number.isFinite(character.walkFrame)) entry.walkFrame = character.walkFrame;\n                if (character.facing) entry.facing = character.facing;\n                copyCombatPersistentFields(entry, character);\n                window.combatCharacters.push(entry);\n            }\n        });\n        // Remove characters no longer present from window.combatCharacters\n        window.combatCharacters = window.combatCharacters.filter(c => characters.some(ch => ch.name === c.name));\n        syncPartyMazeToCombatPositions(false);\n        window.combatCharacters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (!charData) return;\n            charData.x = character.x;\n            charData.y = character.y;\n            applyCombatVisualFrame(charData.sprite, character);\n            moveCombatVisualTo(this, charData, character, false);\n            setCombatVisualOverlayVisible(charData, character.discoveryState !== 'pending');\n        });\n        setCombatPlayerTokenOwner(this,this._pcTokenComposited);\n        ensurePCSpriteInCombatList(window.combatCharacters);\n        // Update combatCharactersString globally\n        window.combatCharactersString = JSON.stringify(window.combatCharacters);\n    // console.log(\"Updated window.combatCharactersString in updatePositions:\", window.combatCharactersString);\n        // Remove characters no longer present\n        Object.keys(this.characters).forEach(name => {\n            if (!characters.some(c => c.name === name)) {\n                const charData = this.characters[name];\n                charData.sprite.destroy();\n                charData.label.destroy();\n                delete this.characters[name];\n            }\n        });\n        // Initiative can arrive before the roster. Repaint the ground ink after\n        // merging actors, not just their sprites, while retaining map positions.\n        this.redrawCombatRT();\n        if (this._movementSleepTimer) {\n            this._movementSleepTimer.remove(false);\n            this._movementSleepTimer = null;\n        }\n        this._movementSleepTimer = this.time.delayedCall(260, () => {\n            this.sys.game.loop.sleep();\n            this._movementSleepTimer = null;\n        });\n    }"}, {
      logReason: 'city-rebuild-trial',
      instructions: "City rebuild trial. No production changes. Both modes use sprite + JSON optimizations.\nClose DevTools and unpause. Walk comparable outdoor routes for 20 seconds in each mode.\nActors only first, then Actors + rebuild. Real geometry refreshes are counted, not forced.",
      modes: [{ id: 'actors', base: 'sprites-json', label: 'Actors only (20s)' }, { id: 'actors-rebuild', base: 'sprites-json', label: 'Actors + rebuild (20s)' }],
      activate(mode, context) { return mode === 'actors-rebuild' ? rebuild.activate(root, context, "(function(root) {\n  'use strict';\n  const COMPASS = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],\n    south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] };\n  const LABELS = { north: 'N', northeast: 'NE', east: 'E', southeast: 'SE', south: 'S', southwest: 'SW', west: 'W', northwest: 'NW', up: 'UP', down: 'DN', portal: 'PORTAL' };\n  const cache = new WeakMap();\n  const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];\n  function normalize(raw) {\n    const aliases = { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south', sw: 'southwest', w: 'west', nw: 'northwest', u: 'up', d: 'down' };\n    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]+/) : Object.keys(raw || {});\n    return [...new Set(list.map(v => String(v?.direction || v).toLowerCase().replace(/[\\s-]/g, '')).map(v => aliases[v] || v)\n      .filter(v => LABELS[v]))];\n  }\n  const passable = c => !!c && !c.blocked && !c.obstacle && (c.tile === 'floor' || c.tile === 'door' && !c.door?.isLocked && !c.door?.locked);\n  function install(dungeon, raw = dungeon?.sceneSpec?.exits ?? dungeon?.sceneSpec?.source?.exits ?? []) {\n    if (!dungeon?.cells || !dungeon.layout || !dungeon.start) return { status: 'skipped', markers: [] };\n    const directions = normalize(raw), signature = directions.slice().sort().join(','), stamp = dungeon._geometryStamp;\n    const previous = cache.get(dungeon);\n    const bindingSignature=JSON.stringify(dungeon.cityBuildingEntrances||[]);\n    if (dungeon.roomExits && previous?.signature === signature && previous.stamp === stamp && previous.bindingSignature===bindingSignature) return dungeon.roomExits;\n    // world1 ARRIVAL_EDGES moves the party's start to the arrival gate; exits stay laid out from the room's own origin.\n    const { width: w, height: h } = dungeon.layout, { x: sx, y: sy } = dungeon._world1Start || dungeon.start;\n    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 512 && h <= 512)) return { status: 'skipped', markers: [] };\n    const seen = new Uint8Array(w * h), parents = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);\n    const first = sx + sy * w;\n    let count = 0, head = 0;\n    if (passable(dungeon.cells[`${sx},${sy}`])) { seen[first] = 1; q[count++] = first; }\n    while (head < count) {\n      const i = q[head++], x = i % w, y = Math.floor(i / w), floor = dungeon.cells[`${x},${y}`].floorHeight || 0;\n      for (const [dx, dy] of STEPS) {\n        const nx = x + dx, ny = y + dy, j = nx + ny * w, c = dungeon.cells[`${nx},${ny}`];\n        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || !passable(c) || Math.abs((c.floorHeight || 0) - floor) > 1.5) continue;\n        seen[j] = 1; parents[j] = i; q[count++] = j;\n      }\n    }\n    const markers = [], missing = [];\n    for (const direction of directions) {\n      let best = null, score = -Infinity;\n      const entrance=dungeon.cityBuildingEntrances?.find(e=>e.direction===direction);\n      const bound=entrance&&Number.isInteger(entrance.x)&&Number.isInteger(entrance.y)&&\n        entrance.x>=0&&entrance.y>=0&&entrance.x<w&&entrance.y<h&&seen[entrance.x+entrance.y*w];\n      if(bound)best={...entrance,direction,label:LABELS[direction],floor:dungeon.cells[entrance.key]?.floorHeight||0,\n        kind:'building-threshold',i:entrance.x+entrance.y*w};\n      const v = COMPASS[direction];\n      for (let n = 0; !bound && n < count; n++) {\n        const i = q[n], x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];\n        const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy);\n        if (d < 4 || c.tile !== 'floor' || c.feature || c.interactable || markers.some(m => Math.hypot(x - m.x, y - m.y) < 3)) continue;\n        const planned = c.complexExit === direction || c.exit === direction || c.exit?.direction === direction;\n        const dot = v ? (dx * v[0] + dy * v[1]) / Math.hypot(...v) : 0;\n        if (!planned && (d > 80 || v && dot < d * 0.75)) continue;\n        // world1 EXIT_FRAMES: favour the far edge in the exit's direction so moving through reads as moving forward.\n        const edge = (dungeon.exitFrames ?? root.HolodekFlags?.EXIT_FRAMES) && v ? dot * 2 : 0;\n        const s = planned ? 10000 - d : v ? dot + edge - Math.abs(dx * v[1] - dy * v[0]) * 1.5 : -Math.abs(d - 15);\n        if (s > score) { score = s; best = { direction, label: LABELS[direction], key: `${x},${y}`, x, y,\n          floor: c.floorHeight || 0, kind: planned ? 'architectural-exit' : v ? 'directional-route' : 'portal-landing', i }; }\n      }\n      // A narrow or curved complex may not have a floor tile in that compass sector.\n      if (!best) for (let n = count - 1; n >= 0; n--) {\n        const i = q[n], x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];\n        if (c.tile !== 'floor' || c.feature || c.interactable || Math.hypot(x - sx, y - sy) < 3 || markers.some(m => m.key === `${x},${y}`)) continue;\n        best = { direction, label: LABELS[direction], key: `${x},${y}`, x, y, floor: c.floorHeight || 0, kind: 'portal-landing', i }; break;\n      }\n      if (!best) { missing.push(direction); continue; }\n      // Reserve the existing route. Never carve a shortcut through a wall or change its elevation.\n      let i = best.i;\n      while (i >= 0) {\n        const x = i % w, y = Math.floor(i / w), c = dungeon.cells[`${x},${y}`];\n        if (c) c.navigationReserved = true;\n        i = parents[i];\n      }\n      delete best.i;\n      markers.push(best);\n    }\n    dungeon.tiles ||= {};\n    dungeon.tiles.journey_exit_marker = { spriteSpec: { voxelShape: 'exit_marker', material: 'wood', collisionBlocking: false },\n      landmark: { type: 'exit_marker', label: 'Journey threshold' } };\n    dungeon.sceneStructures = (dungeon.sceneStructures || []).filter(p => p.role !== 'journey-exit-marker' && p.role !== 'journey-exit-frame' && p.role !== 'planar-portal-arch');\n    for (const marker of markers) dungeon.sceneStructures.push({ role: 'journey-exit-marker', shape: 'exit_marker', tile: 'journey_exit_marker',\n      direction: marker.direction, position: { x: marker.x + 0.05, y: marker.y + 0.05, z: marker.floor + 0.05 }, size: { x: 0.9, y: 0.9, z: 0.4 } });\n    // world1 EXIT_FRAMES: frame each compass exit in biome-fitting architecture, facing its direction.\n    // Data-only flag: dungeon.exitFrames is set server-side when HOLODEK_EXIT_FRAMES is on.\n    if (dungeon.exitFrames ?? root.HolodekFlags?.EXIT_FRAMES) for (const marker of markers.filter(m => COMPASS[m.direction] || m.direction === 'up' || m.direction === 'down')) {\n      const kind = frameKind(dungeon, marker.direction), side = ['east', 'west'].includes(marker.direction) ? '_side' : '';\n      const shape = `exit_${kind}${side}`, tile = `journey_exit_${kind}${side}`, c = dungeon.cells[marker.key];\n      const available = dungeon.classification?.indoor === false ? 2.6 : Math.max(1.5, (c?.ceilHeight || marker.floor + 3) - marker.floor - .1);\n      // world1 MOLDINGS: stone arch frames get a carved gate surround from the room's theme (wood/metal frames stay plain).\n      const C = root.DesignCatalog, surround = kind === 'arch' && C && (dungeon.moldings ?? root.HolodekFlags?.MOLDINGS) ?\n        { version: 1, region: 'panel', pattern: C.VOXEL_PATTERNS[C.hash(`${dungeon.sceneSpec?.roomName || ''}:${marker.direction}`) % C.VOXEL_PATTERNS.length] } : null;\n      dungeon.tiles[tile] = { spriteSpec: { voxelShape: shape, material: kind === 'gate' ? 'wood' : kind === 'grate' ? 'metal' : 'stone', collisionBlocking: false, ...(surround ? { stoneCarving: surround } : {}) },\n        landmark: { type: 'exit_frame', label: `${LABELS[marker.direction]} ${kind}` } };\n      dungeon.sceneStructures.push({ role: 'journey-exit-frame', shape, tile, direction: marker.direction,\n        position: { x: marker.x - .05, y: marker.y - .05, z: marker.floor }, size: { x: 1.1, y: 1.1, z: Math.min(2.6, available) } });\n      marker.frame = kind;\n    }\n    for (const marker of markers.filter(m => m.direction === 'portal')) {\n      const c = dungeon.cells[marker.key], available = dungeon.classification?.indoor === false ? 3 : Math.max(1.5, (c.ceilHeight || marker.floor + 3) - marker.floor - .1);\n      dungeon.tiles.planar_portal_arch = { spriteSpec: { voxelShape: 'portal_arch', material: 'crystal', collisionBlocking: false,\n        palette: { primary: '#9537c9', secondary: '#63278b', highlight: '#edb3ff', shadow: '#351444' } }, landmark: { type: 'portal', label: 'Planar portal' } };\n      dungeon.sceneStructures.push({ role: 'planar-portal-arch', shape: 'portal_arch', tile: 'planar_portal_arch', direction: 'portal',\n        position: { x: marker.x + .02, y: marker.y + .02, z: marker.floor }, size: { x: .96, y: .96, z: Math.min(3, available) } });\n      marker.kind = 'planar-portal';\n    }\n    dungeon.roomExits = { version: 1, signature, status: missing.length ? 'partial' : 'built', markers, missing, reachable: count };\n    cache.set(dungeon, { signature, stamp, bindingSignature });\n    return dungeon.roomExits;\n  }\n  function frameKind(dungeon, direction) {\n    const biome = dungeon.classification?.biome || '', text = `${dungeon.sceneSpec?.roomName || ''} ${dungeon.classification?.architecture || ''}`.toLowerCase();\n    if (direction === 'down' || biome === 'crypt' || /crypt|catacomb|tomb|dungeon|sewer|cistern/.test(text)) return 'grate';\n    if (biome === 'fortress' || /castle|fort|gatehouse|citadel|keep/.test(text)) return 'portcullis';\n    if (dungeon.classification?.indoor === false || /wasteland|grove|village|hamlet|oasis|market/.test(text)) return 'gate';\n    return 'arch';\n  }\n  function nearby(dungeon, player, radius = 1) {\n    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;\n    const current = dungeon.cells?.[`${Math.floor(player.x)},${Math.floor(player.y)}`];\n    const floor = current?.floorHeight || 0;\n    return (dungeon.roomExits?.markers || []).filter(m => {\n      const dx = m.x + 0.5 - player.x, dy = m.y + 0.5 - player.y, d = Math.hypot(dx, dy);\n      if (d > radius || Math.abs(m.floor - floor) > 0.75) return false;\n      const steps = Math.max(1, Math.ceil(d * 8));\n      for (let i = 0; i <= steps; i++) {\n        const c = dungeon.cells?.[`${Math.floor(player.x + dx * i / steps)},${Math.floor(player.y + dy * i / steps)}`];\n        if (!passable(c) || c.tile === 'door' && !c.door?.isOpen || Math.abs((c.floorHeight || 0) - floor) > 1.5) return false;\n      }\n      return true;\n    }).sort((a, b) => Math.hypot(a.x + 0.5 - player.x, a.y + 0.5 - player.y) - Math.hypot(b.x + 0.5 - player.x, b.y + 0.5 - player.y))[0] || null;\n  }\n  const api = { install, normalize, nearby, LABELS };\n  if (typeof module !== 'undefined' && module.exports) module.exports = api;\n  else root.DungeonExits = api;\n})(typeof window === 'undefined' ? globalThis : window);\n", {"query":"function query(dungeon, x, y, radius) {\n      const stamp = dungeon?._geometryStamp || dungeon?._meta?.geometryStamp;\n      if (!stamp || !dungeon.cells || ![x, y, radius].every(Number.isInteger) || radius < 0) return null;\n      const tiles = dungeon.tiles || {}, kinds = Object.keys(tiles).filter(key => !!tiles[key]?.spriteSpec).sort().join('|');\n      let index = rooms.get(dungeon);\n      if (!index || index.stamp !== stamp || index.cells !== dungeon.cells || index.kinds !== kinds) {\n        const buckets = new Map();\n        for (const [key, cell] of Object.entries(dungeon.cells)) {\n          const tile = cell?.tile;\n          if (tile !== 'torch' && tile !== 'pillar' && !(typeof tile === 'string' && tile.startsWith('custom_')) && !tiles[tile]?.spriteSpec) continue;\n          const coords = key.split(',').map(Number);\n          if (coords.length !== 2 || !coords.every(Number.isInteger)) continue;\n          const [cx, cy] = coords, bucketKey = `${Math.floor(cx / chunkSize)},${Math.floor(cy / chunkSize)}`;\n          if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);\n          buckets.get(bucketKey).push([cx, cy, cell]);\n        }\n        index = { stamp, cells: dungeon.cells, kinds, buckets, queries: new Map() }; rooms.set(dungeon, index); count('collectionBuilds');\n      }\n      const key = `${x},${y},${radius}`;\n      if (index.queries.has(key)) { count('collectionHits'); return index.queries.get(key); }\n      const result = [];\n      for (let cx = Math.floor((x - radius) / chunkSize); cx <= Math.floor((x + radius) / chunkSize); cx++) {\n        for (let cy = Math.floor((y - radius) / chunkSize); cy <= Math.floor((y + radius) / chunkSize); cy++) {\n          for (const row of index.buckets.get(`${cx},${cy}`) || []) {\n            if (Math.abs(row[0] - x) <= radius && Math.abs(row[1] - y) <= radius) result.push(row);\n          }\n        }\n      }\n      // Preserve x-major order, including equal-distance light ties and the full visibility radius.\n      result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);\n      if (index.queries.size >= 32) index.queries.delete(index.queries.keys().next().value);\n      index.queries.set(key, result); count('collectionQueries'); return result;\n    }","questFloors":"function questFloors(dungeon, w, h, start) {\n      const entry = room(dungeon), signature = JSON.stringify([w, h, start.x, start.y, dungeon?.cityFloorContext,\n        dungeon?.roomExits?.markers?.map(m => [m.key, m.x, m.y, m.direction])]);\n      if (entry?.floors?.signature === signature) { count('questFloorHits'); return entry.floors.values; }\n      const values = [];\n      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {\n        const cell = dungeon.cells?.[`${x},${y}`];\n        if (cell?.tile === 'floor' && !cell.exitMarker && Math.hypot(x - start.x, y - start.y) >= Math.min(w, h) / 4) values.push({ x, y });\n      }\n      count('questFloorBuilds'); if (entry) entry.floors = { signature, values }; return values;\n    }","delta":"function(data) {\n  if (!currentDungeon || currentDungeon.geoKey !== data.geoKey) return;\n  if(data.runId&&data.runId!==window.dungeonRunId)return;\n  if(data.cityStream&&currentDungeon._geometryStamp===data.geometryStamp)return;\n  if (currentDungeon._geometryStamp !== data.previousStamp && currentDungeon._geometryStamp !== data.geometryStamp) {\n    console.error('[DungeonAction] Geometry revision mismatch; ignoring stale update.', data);\n    return;\n  }\n  if (data.physicalPuzzle) window.PhysicalPuzzles?.beginMotion(currentDungeon, currentDungeon.physicalPuzzle, data.physicalPuzzle);\n  if (data.secretDoors) window.SecretDoorsUi?.begin(currentDungeon, data.secretDoors);\n  Object.assign(currentDungeon.cells, data.cells);\n  if(data.cityStream?.snapshot){\n    const snapshot=data.cityStream.snapshot;\n    for(const key of ['cells','tiles','sceneStructures','genreLights','cityBlocks','secretDoors','sceneObjects','cityBuildingEntrances','cityArchitecture','cityCirculation'])if(snapshot[key]!==undefined)currentDungeon[key]=snapshot[key];\n  }else if(data.cityStream){\n    Object.assign(currentDungeon.tiles,data.cityStream.tiles);\n    (currentDungeon.sceneStructures||=[]).push(...data.cityStream.structures);\n    (currentDungeon.genreLights||=[]).push(...data.cityStream.lights);\n    currentDungeon.cityBlocks=data.cityStream.blocks;\n    if(data.cityStream.circulation)currentDungeon.cityCirculation=data.cityStream.circulation;\n    if(data.cityStream.entrances)currentDungeon.cityBuildingEntrances=data.cityStream.entrances;\n  }\n  if(data.cityStream)for(const [name,cfg]of Object.entries(data.cityStream.snapshot?.tiles||data.cityStream.tiles||{})){\n    if(cfg.spriteSpec)dungeonTexturesMeta[name]=cfg.spriteSpec;\n    if(cfg.url&&!isTextureReady(dungeonTextures[name])){\n      const img=new Image();img.onload=()=>renderDungeonView();img.src=cfg.url;dungeonTextures[name]=img;\n    }\n  }\n  if (data.actionAttempts) currentDungeon.actionAttempts = data.actionAttempts;\n  if (data.livingEncounter) currentDungeon.livingEncounter = data.livingEncounter;\n  if (data.physicalPuzzle) currentDungeon.physicalPuzzle = data.physicalPuzzle;\n  if (data.secretDoors) currentDungeon.secretDoors = data.secretDoors;\n  currentDungeon._geometryStamp = data.geometryStamp;\n  currentDungeon._meta = { ...currentDungeon._meta, geometryStamp: data.geometryStamp };\n  delete currentDungeon._lodCache;\n  idbSetDungeon(data.geoKey, currentDungeon).catch(console.error);\n  renderDungeonView();\n  window.combatGame?.scene?.getScene('CombatScene')?.redrawCombatRT?.();\n}","renderView":"function forRendering(dungeon) {\n    if (!dungeon?.sceneExteriors?.buildings?.length || dungeon.classification?.indoor === true ||\n        dungeon.sceneSpec?.indoor === true || !dungeon.cells || !dungeon.tiles) return dungeon;\n    const stamp = dungeon._geometryStamp || dungeon._meta?.geometryStamp;\n    const cached = views.get(dungeon);\n    if (cached && cached.stamp === stamp) return cached.view;\n    let cells, tiles, structures;\n    for (const b of dungeon.sceneExteriors.buildings.slice(0, 2)) {\n      const door = b.doorway, f = directions[b.direction];\n      if (b.entrance !== 'closed-gate' || !f || !door || ![door.x, door.y, door.floor, b.wallHeight,\n          b.transverse, b.depth].every(Number.isFinite) || b.wallHeight <= 0 || b.wallHeight > 64 ||\n          b.transverse < 3 || b.transverse > 41 || b.depth < 3 || b.depth > 41) continue;\n      const cross = [-f[1], f[0]], half = Math.floor(b.transverse / 2);\n      const at = (u, v) => ({ x: door.x + cross[0] * u + f[0] * v, y: door.y + cross[1] * u + f[1] * v });\n      const gateCells = [-1, 0, 1].map(u => at(u, 1));\n      const sealed = gateCells.every(p => {\n        const c = dungeon.cells[`${p.x},${p.y}`];\n        return c?.exteriorRole === 'closed-gate' && c.exteriorDestination === b.targetKey && c.blocked;\n      });\n      if (sealed && !(dungeon.sceneStructures || []).some(p => p.role === 'exterior-closed-gate' &&\n          p.exteriorDestination === b.targetKey && /^grand_gate(?:_side)?$/.test(p.shape))) {\n        const shape = f[1] ? 'grand_gate' : 'grand_gate_side';\n        const palette = b.palette || { primary: '#81988c', secondary: '#496656', highlight: '#eadfc6', shadow: '#30352f' };\n        const identity = String(b.targetKey).replace(/[^a-z0-9_-]/gi, '_');\n        const colors = Object.values(palette).join('').replace(/[^a-z0-9]/gi, '');\n        const tile = `custom_exterior_gate_v${VERSION}_${identity}_${shape}_${colors}`;\n        tiles ||= { ...dungeon.tiles };\n        tiles[tile] = { url: dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: 'metal', palette,\n          profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };\n        structures ||= (dungeon.sceneStructures || []).slice();\n        structures = structures.filter(p => p.role !== 'exterior-closed-gate' || p.exteriorDestination !== b.targetKey);\n        structures.push({ tile, shape, role: 'exterior-closed-gate', skyline: true, exteriorDestination: b.targetKey,\n          position: { x: Math.min(...gateCells.map(p => p.x)), y: Math.min(...gateCells.map(p => p.y)), z: door.floor },\n          size: { x: f[1] ? 3 : 1, y: f[0] ? 3 : 1, z: b.wallHeight } });\n      }\n      for (let v = 0; v < b.depth; v++) for (let u = -half; u <= half; u++) {\n        if (!torchAt(u, v, half, b.depth)) continue;\n        const p = at(u, v), key = `${p.x},${p.y}`, c = dungeon.cells[key];\n        if (!c || !['wall', 'torch'].includes(c.tile) || c.exteriorDestination !== b.targetKey ||\n            !['shell-wall', 'tower'].includes(c.exteriorRole) || c.feature && c.feature !== 'torch' || c.door || c.exit) continue;\n        const height = c.ceilHeight - c.floorHeight;\n        if (!Number.isFinite(height) || height < .5) continue;\n        const torchMountHeight = mountHeight(height);\n        if (c.tile === 'torch' && c.feature === 'torch' && c.torchMountHeight === torchMountHeight) continue;\n        cells ||= { ...dungeon.cells };\n        cells[key] = { ...c, tile: 'torch', feature: 'torch', torchMountHeight };\n      }\n    }\n    // The saved room stays authoritative; this cached view only supplies visible dressing.\n    const view = cells || tiles || structures ? { ...dungeon, cells: cells || dungeon.cells, tiles: tiles || dungeon.tiles,\n      sceneStructures: structures || dungeon.sceneStructures, _geometryStamp: `${stamp || 'unstamped'}:exterior-details:${VERSION}` } : dungeon;\n    views.set(dungeon, { stamp, view });\n    return view;\n  }"}) : null; }
    }); } catch(error) { root.console.error('City rebuild trial not installed:', error.message); }
})(window);
