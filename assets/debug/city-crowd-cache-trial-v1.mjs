(function(root) { 'use strict';
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
const response = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const normalize = text => text.replace(/\r\n/g, '\n').trim();
  const round = n => Math.round(n * 100) / 100;
  function gameSources(game) {
    game = normalize(game);
    if (game.split('window.persistCityCrowd=').length !== 2) throw Error('Crowd persistence source boundary changed.');
    const take = (start, end, strip = false) => {
      if (game.split(start).length !== 2 || game.split(end).length !== 2) throw Error('Response diagnostic source boundaries changed: ' + start);
      const left = game.indexOf(start), right = game.indexOf(end, left + start.length);
      if (right < left) throw Error('Response source order changed.');
      const text = game.slice(left + (strip ? start.length : 0), right).trim();
      return strip ? text.replace(/;$/, '') : text;
    };
    return { idb: take('async function idbSetDungeon(', '\nasync function idbSetPopulation('),
      persist: game.slice(game.indexOf('window.persistCityCrowd=') + 'window.persistCityCrowd='.length).split('\n')[0].trim().replace(/;$/, ''),
      realtime: take('window.applyRealtimeCombatResult = ', '\nwindow.appendDungeonEncounterLog = ', true) };
  }
  function coalescer(root, original) {
    if (typeof root.queueMicrotask !== 'function') throw Error('queueMicrotask is required for same-turn-only coalescing.');
    let entry = null, active = true;
    const counts = { requests: 0, writesStarted: 0, sameTurnDuplicates: 0 };
    const state = () => {
      const dungeon = root.currentDungeon;
      return { dungeon, run: root.dungeonRunId, floor: root.CityFloorScope?.token?.(),
        // A shallow guard is cheap and prevents coalescing across replaced geometry or other room fields.
        fields: dungeon ? Object.entries(dungeon) : [] };
    };
    const same = (a, b) => a.dungeon && a.dungeon === b.dungeon && a.run === b.run && a.floor === b.floor &&
      a.fields.length === b.fields.length && a.fields.every(([key, value], i) => key === b.fields[i][0] && Object.is(value, b.fields[i][1]));
    function call(...args) {
      if (!active || args.length) return original.apply(this, args);
      counts.requests++;
      let current;
      try { current = state(); } catch { return original.apply(this, args); }
      if (entry && same(entry.state, current)) { counts.sameTurnDuplicates++; return entry.value; }
      // Start the original save immediately. It keeps its own full-room snapshot, key, transaction and error handling.
      const value = original.apply(this, args), next = { state: current, value };
      counts.writesStarted++; entry = next;
      root.queueMicrotask(() => { if (entry === next) entry = null; });
      return value;
    }
    return { call, reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
      diagnostics: () => ({ ...counts, policy: 'Same JS turn only. First complete-room save starts immediately; no delayed/dropped population, dialogue or future-task writes.' }),
      stop() { active = false; entry = null; } };
  }
  function trace(root) {
    let active = false;
    const groups = new Map(), stack = [], hooks = [], unavailable = [];
    function measure(name, fn, receiver, args) {
      if (!active) return fn.apply(receiver, args);
      const at = root.performance.now(), frame = { child: 0 }; stack.push(frame);
      try { return fn.apply(receiver, args); }
      finally {
        const duration = root.performance.now() - at; stack.pop();
        if (stack.length) stack.at(-1).child += duration;
        let g = groups.get(name);
        if (!g) { g = { calls: 0, total: 0, self: 0, max: 0, times: [] }; groups.set(name, g); }
        g.calls++; g.total += duration; g.self += Math.max(0, duration - frame.child); g.max = Math.max(g.max, duration);
        if (g.times.length < 2048) g.times.push(duration);
      }
    }
    function hook(owner, key, name, make, required = false) {
      const original = owner?.[key];
      if (typeof original !== 'function') { if (required) throw Error('Required response hook unavailable: ' + name); unavailable.push(name); return; }
      const wrapped = make ? make(original) : function(...args) { return measure(name, original, this, args); };
      try { owner[key] = wrapped; } catch {}
      if (owner[key] !== wrapped) { if (required) throw Error('Response hook is not writable: ' + name); unavailable.push(name); return; }
      hooks.push({ owner, key, original, wrapped });
    }
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]) : null;
    };
    return { hook, measure,
      start() { groups.clear(); active = true; },
      stop() { active = false; for (const h of hooks.toReversed()) if (h.owner[h.key] === h.wrapped) h.owner[h.key] = h.original; },
      intact: () => hooks.every(h => h.owner[h.key] === h.wrapped),
      report: () => ({ sections: [...groups].map(([name, g]) => ({ name, calls: g.calls, inclusiveMs: round(g.total), exclusiveMs: round(g.self),
        medianMs: percentile(g.times, .5), p95Ms: percentile(g.times, .95), maxMs: round(g.max), samplesTruncated: g.calls > g.times.length }))
        .sort((a, b) => b.exclusiveMs - a.exclusiveMs), unavailable,
        timing: 'Synchronous call portions only; asynchronous waits/transaction completion are not CPU measurements. IndexedDB put timing includes synchronous call work, not disk-commit latency.' }) };
  }
  function activate(root, context, mode, expected, makeLoaf, onResult) {
    if (!['response-base', 'response-coalesced'].includes(mode)) throw Error('Unknown response diagnostic mode.');
    for (const [name, fn] of [['persist', root.persistCityCrowd], ['idb', root.idbSetDungeon], ['realtime', root.applyRealtimeCombatResult],
      ['crowdReceive', root.CityCrowdUi?.receive], ['populationReceive', root.DungeonLife?.receivePopulation]])
      if (typeof fn !== 'function' || normalize(fn.toString()) !== expected[name]) throw Error('Running response method differs from verified source: ' + name);
    if (!root.IDBObjectStore?.prototype || typeof root.IDBObjectStore.prototype.put !== 'function') throw Error('IndexedDB put measurement is unavailable. Nothing installed.');
    const t = trace(root), loaf = makeLoaf(root);
    let merge = null, stopped = false, reported = false, putCalls = 0, cityPuts = 0, populationPuts = 0;
    try {
      t.hook(root, 'persistCityCrowd', 'crowdPersistRequest', original => {
        const measured = function(...args) { return t.measure('crowdPersistRequest', original, this, args); };
        if (mode === 'response-coalesced') { merge = coalescer(root, measured); return merge.call; }
        return measured;
      }, true);
      t.hook(root.IDBObjectStore.prototype, 'put', 'indexedDBPut', original => function(...args) {
        const value = args[0], city = this.name === 'rooms' && !!value?.cells && !!value?.layout;
        const name = city ? 'indexedDB.put:full-city' : this.name === 'inhabitants' ? 'indexedDB.put:population' : 'indexedDB.put:other';
        putCalls++; if (city) cityPuts++; if (this.name === 'inhabitants') populationPuts++;
        return t.measure(name, original, this, args);
      }, true);
      for (const [key, label] of [['idbSetDungeon', 'saveDungeon:sync-prefix'], ['persistDungeonPopulation', 'savePopulation:sync-prefix'],
        ['applyRealtimeCombatResult', 'applyRealtime:sync-prefix'], ['applyOutdoorDiscoveries', 'outdoorDiscoveries'],
        ['refreshDungeonConsoleStates', 'consoleStates'], ['updateCharacterSheetsFromConsole', 'characterSheets'],
        ['updateGameConsole', 'gameConsole'], ['generateMonstersForRoom', 'roomRoster'],
        ['ensureKnownSpritesInCombatList', 'knownSprites'], ['renderPartyIconDock', 'partyDock']]) t.hook(root, key, label);
      for (const [owner, key, label] of [[root.CityCrowdUi, 'receive', 'crowdReceive'], [root.CityCrowdMotion, 'reconcile', 'crowdReconcile'],
        [root.DungeonLife, 'receivePopulation', 'populationReceive'], [root.DungeonInhabitants, 'attach', 'populationAttach'],
        [root.DungeonExplorationMap, 'refresh', 'explorationRefresh'], [root.SpellUi, 'hydrate', 'spellHydrate']]) t.hook(owner, key, label);
      t.hook(root.game?.scene?.getScene('MainScene')?.scene, 'restart', 'mainSceneRestart');
    } catch (error) { t.stop(); merge?.stop(); throw error; }
    return { reset() { putCalls = cityPuts = populationPuts = 0; merge?.reset(); t.start(); loaf.start(); },
      diagnostics() { reported = true; return { mode, putCalls, fullCityPuts: cityPuts, populationPuts, coalescing: merge?.diagnostics() || null,
        scriptAttributionSupported: loaf.report().supported }; },
      intact: () => t.intact(),
      restore() {
        if (stopped) return; stopped = true; t.stop(); loaf.stop(); merge?.stop();
        if (reported) onResult({ kind: 'city-response-detail', version: 1, mode, geometryStamp: context.dungeon._geometryStamp,
          ...t.report(), putCalls, fullCityPuts: cityPuts, populationPuts, coalescing: merge?.diagnostics() || null, browser: loaf.report(),
          note: 'Both walking modes retain sprite/JSON optimizations. Different response events/routes are not an identical-input A/B. No worker or deferred full-room persistence is used.' });
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { gameSources, coalescer, trace, activate };
})();

return module.exports; })();
const refresh = (() => { const module = { exports: {} };
(function() {
  'use strict';
  const geometryKeys = ['cells', 'tiles', 'layout', 'start', '_world1Start', 'geoKey', '_geometryStamp', '_meta',
    'classification', 'sceneSpec', 'sceneExteriors', 'sceneStructures', 'exitFrames', 'moldings', 'cityBuildingEntrances', 'cityFloorContext'];
  const snapshotKeys = ['cells', 'tiles', 'sceneStructures', 'genreLights', 'cityBlocks', 'secretDoors', 'sceneObjects',
    'cityBuildingEntrances', 'cityArchitecture', 'cityCirculation'];
  const round = n => Math.round(n * 10) / 10;
  function project(dungeon) {
    const w = dungeon?.layout?.width, h = dungeon?.layout?.height;
    if (!dungeon?.cells || !dungeon._geometryStamp || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 512 || h > 512)
      throw Error('A stamped city no larger than 512 x 512 is required.');
    if (dungeon.classification?.indoor !== false || dungeon.cityFloorContext)
      throw Error('Capture outdoors in the host city, not on a building floor.');
    return Object.fromEntries(geometryKeys.filter(key => dungeon[key] !== undefined).map(key => [key, dungeon[key]]));
  }
  function deltaData(data) {
    return Object.fromEntries(['geoKey', 'runId', 'previousStamp', 'geometryStamp', 'cells', 'cityStream', 'actionAttempts',
      'livingEncounter', 'physicalPuzzle', 'secretDoors'].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  }
  function applyGeometry(dungeon, data) {
    if (data.geoKey !== dungeon.geoKey || data.previousStamp !== dungeon._geometryStamp || !data.geometryStamp || data.geometryStamp === data.previousStamp)
      throw Error('Captured refresh is not the next revision of the seeded city.');
    Object.assign(dungeon.cells, data.cells);
    if (data.cityStream?.snapshot) {
      for (const key of snapshotKeys) if (data.cityStream.snapshot[key] !== undefined) dungeon[key] = data.cityStream.snapshot[key];
    } else if (data.cityStream) {
      Object.assign(dungeon.tiles, data.cityStream.tiles);
      (dungeon.sceneStructures ||= []).push(...data.cityStream.structures);
      (dungeon.genreLights ||= []).push(...data.cityStream.lights);
      dungeon.cityBlocks = data.cityStream.blocks;
      if (data.cityStream.circulation) dungeon.cityCirculation = data.cityStream.circulation;
      if (data.cityStream.entrances) dungeon.cityBuildingEntrances = data.cityStream.entrances;
    }
    for (const key of ['actionAttempts', 'livingEncounter', 'physicalPuzzle', 'secretDoors']) if (data[key]) dungeon[key] = data[key];
    dungeon._geometryStamp = data.geometryStamp;
    dungeon._meta = { ...dungeon._meta, geometryStamp: data.geometryStamp };
    delete dungeon._lodCache;
  }
  function directions(root, dungeon) {
    return root.dungeonConsoleExits?.geoKey === dungeon.geoKey ? root.dungeonConsoleExits.exits :
      dungeon.sceneSpec?.exits ?? dungeon.sceneSpec?.source?.exits ?? [];
  }
  function loaf(root) {
    let observer, start = 0, count = 0, retained = [], supported = false;
    const consume = list => {
      for (const entry of list) {
        if (!Number.isFinite(entry.startTime) || entry.startTime < start) continue;
        count++;
        const scripts = Array.from(entry.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 3).map(s => {
          let source = '';
          try { if (s.sourceURL) { const url = new URL(s.sourceURL, root.location?.href); source = url.origin === root.location?.origin ? url.pathname.slice(0, 160) : '[other origin]'; } } catch {}
          return { durationMs: round(s.duration || 0), invoker: String(s.invoker || s.name || '').slice(0, 120),
            invokerType: String(s.invokerType || '').slice(0, 32), source, function: String(s.sourceFunctionName || '').slice(0, 96),
            sourceCharPosition: Number.isFinite(s.sourceCharPosition) ? s.sourceCharPosition : -1,
            forcedLayoutMs: round(s.forcedStyleAndLayoutDuration || 0), pauseMs: round(s.pauseDuration || 0) };
        });
        retained.push({ startMs: round(entry.startTime - start), durationMs: round(entry.duration),
          blockingMs: round(entry.blockingDuration || 0), renderStartMs: round((entry.renderStart || entry.startTime) - start), scripts });
        retained.sort((a, b) => b.durationMs - a.durationMs); retained.length = Math.min(retained.length, 3);
      }
    };
    function stop() { if (observer) { consume(observer.takeRecords()); observer.disconnect(); observer = null; } }
    return { start() {
      stop(); count = 0; retained = []; start = root.performance.now();
      supported = !!root.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame');
      if (supported) try {
        observer = new root.PerformanceObserver(list => consume(list.getEntries()));
        observer.observe({ type: 'long-animation-frame', buffered: false });
      } catch { supported = false; observer?.disconnect(); observer = null; }
    }, stop, report: () => ({ supported, count, longest: retained,
      attribution: 'Browser callback attribution, not complete stacks or a GC measurement. Missing attribution remains unknown.' }) };
  }
  async function replay(seed, captured, factories, rebuild, hash, now = () => performance.now()) {
    if (!captured || captured.data.previousStamp !== seed.dungeon._geometryStamp) throw Error('No matching real refresh was captured.');
    const sourceFingerprint = await hash(JSON.stringify({ seed, captured }));
    const samples = [], outputs = [];
    for (const mode of ['baseline', 'optimized', 'optimized', 'baseline']) {
      const setupAt = now(), dungeon = structuredClone(seed.dungeon), data = structuredClone(captured.data);
      const root = { HolodekFlags: seed.flags, DesignCatalog: seed.catalogPresent ? factories.catalog() : undefined };
      const grid = rebuild.gridCache(), chunks = rebuild.chunkIndex(), native = factories.native(), decor = factories.decorator(root);
      const exits = factories.exits(root, mode === 'optimized' ? grid.get : null);
      const position = captured.position;
      if (![position.x, position.y].every(Number.isInteger)) throw Error('Captured renderer query position is unavailable.');
      const index = mode === 'optimized' ? chunks : native.spatialIndex();
      // Prime the pre-update caches. All input copying, compilation and priming stay outside the measured refresh.
      exits.install(dungeon, captured.exits);
      index.query(decor.forRendering(dungeon), position.x, position.y, 64);
      const setupMs = now() - setupAt, timed = {}, measure = (name, fn) => { const at = now(); const value = fn(); timed[name] = now() - at; return value; };
      measure('applyMs', () => applyGeometry(dungeon, data));
      measure('cacheUpdateMs', () => { if (mode === 'optimized') { grid.delta(dungeon, data.previousStamp, data); chunks.delta(dungeon, data.previousStamp, data); } });
      measure('navigationMs', () => exits.install(dungeon, captured.exits));
      const view = measure('decorationMs', () => decor.forRendering(dungeon));
      const rows = measure('collectionMs', () => index.query(view, position.x, position.y, 64));
      if (!rows) throw Error('Renderer collection unexpectedly declined the captured query.');
      const output = JSON.stringify({ markers: dungeon.roomExits, structures: view.sceneStructures, tiles: view.tiles,
        reserved: Object.keys(dungeon.cells).filter(key => dungeon.cells[key]?.navigationReserved).sort(), rows });
      outputs.push(await hash(output));
      samples.push({ mode, setupMs: round(setupMs), ...Object.fromEntries(Object.entries(timed).map(([key, value]) => [key, round(value)])),
        totalRefreshCpuMs: round(Object.values(timed).reduce((a, b) => a + b, 0)), visibleCells: rows.length,
        decorated: view !== dungeon, revision: dungeon._geometryStamp });
    }
    const equivalent = outputs.every(value => value === outputs[0]);
    const average = mode => Object.fromEntries(['navigationMs', 'decorationMs', 'collectionMs', 'cacheUpdateMs', 'applyMs', 'totalRefreshCpuMs']
      .map(key => [key, round(samples.filter(s => s.mode === mode).reduce((sum, s) => sum + s[key], 0) / 2)]));
    return { kind: 'city-refresh-replay', version: 1, valid: equivalent, input: 'One real accepted refresh; identical seed, delta, exits, query position and radius in A/B/B/A order.',
      sourceFingerprint, outputFingerprint: outputs[0], equivalent, samples, averages: { baseline: average('baseline'), optimized: average('optimized') },
      previousStamp: seed.dungeon._geometryStamp, geometryStamp: captured.data.geometryStamp, changedCells: Object.keys(captured.data.cells || {}).length,
      snapshot: !!captured.data.cityStream?.snapshot, radius: 64,
      scope: 'Detached worker CPU navigation, render-view decoration and cell collection only. No GPU/resource rebuilding, UI, persistence, FPS or model calls. Setup excluded and reported separately.' };
  }
  if (typeof module === 'object' && module.exports) module.exports = { project, deltaData, applyGeometry, directions, loaf, replay };
})();

return module.exports; })();
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
const controller = (() => { const module = { exports: {} };
(function() {
  'use strict';
  function install(root, actor, profiler, response, refresh, cache, expected, workerSource) {
    actor.prepare(root, expected.actor); cache.preflight(root, expected.cache); cache.scope(root);
    let prepared = null, preparing = false, cleaning = false, cleanup = Promise.resolve(), cancelled = false;
    const results = [], status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'Cache setup and original-reader reload verification happen outside the timed walk.';
    async function record(value, dungeon) {
      results.push(value);
      const body = JSON.stringify({ reason: 'city-crowd-cache-detail', geoKey: dungeon.geoKey, geometryStamp: dungeon._geometryStamp, samples: [], trial: value });
      if (body.length > 12000) throw Error('Cache detail too large; retained in CityCrowdCacheTrial.cacheResults.');
      let timeout;
      const reply = await Promise.race([root.fetch('/debug/dungeon-rendering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        new Promise((_, reject) => { timeout = root.setTimeout(() => reject(Error('Cache detail log timed out.')), 5000); })]).finally(() => root.clearTimeout(timeout));
      if (!reply.ok) throw Error('Cache detail log failed: HTTP ' + reply.status);
    }
    const trial = actor.install(root, profiler, expected.actor, {
      logReason: 'city-crowd-cache-walk',
      instructions: 'Crowd-persistence test: original room-cache format, no schema changes.\nClose DevTools, unpause, run Full-save baseline then Worker crowd patch. Each walk lasts 20 seconds.\nSetup may pause briefly before the timer. Wait for reload verification and log confirmation before the next mode.',
      modes: [{ id: 'cache-base', base: 'sprites-json', label: 'Full-save baseline (20s)' },
        { id: 'cache-worker', base: 'sprites-json', label: 'Worker crowd patch (20s)' }],
      activate(mode, { dungeon }) {
        cache.preflight(root, expected.cache);
        if (!prepared || prepared.context.dungeon !== dungeon || !cache.same(prepared.initialGuard, cache.guard(dungeon))) throw Error('City changed after setup. Click capture again.');
        const context = prepared.context, t = response.trace(root), loaf = refresh.loaf(root), original = root.persistCityCrowd;
        let transport = null, manager = null, active = true, stopped = false, reported = false, fullCityPuts = 0, populationPuts = 0, persistRequests = 0;
        try {
          if (mode === 'cache-worker') { transport = cache.bridge(root, workerSource); manager = cache.manager(root, context, transport, prepared.initialGuard); }
          t.hook(root, 'persistCityCrowd', 'crowdPersistRequest', () => function(...args) {
            if (!active || args.length || root.currentDungeon !== dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor)
              return original.apply(this, args);
            persistRequests++;
            return t.measure('crowdPersistRequest', manager ? () => manager.write().catch(root.console.error) : original, this, args);
          }, true);
          t.hook(root.IDBObjectStore?.prototype, 'put', 'indexedDBPut', native => function(...args) {
            const full = this.name === 'rooms' && !!args[0]?.cells && !!args[0]?.layout;
            if (full) { fullCityPuts++; if (args[1] === context.key) manager?.invalidate(); }
            if (this.name === 'inhabitants') populationPuts++;
            return t.measure(full ? 'indexedDB.put:full-city' : this.name === 'inhabitants' ? 'indexedDB.put:population' : 'indexedDB.put:other', native, this, args);
          }, true);
        } catch (error) { t.stop(); transport?.close(); throw error; }
        return { reset() { fullCityPuts = populationPuts = persistRequests = 0; manager?.reset(); t.start(); loaf.start(); },
          diagnostics() { reported = true; return { mode, persistRequests, mainThreadFullCityPuts: fullCityPuts, populationPuts, worker: manager?.diagnostics() || null }; },
          intact: () => t.intact(),
          restore() {
            if (stopped) return; stopped = true; active = false; t.stop(); loaf.stop(); manager?.stop();
            const measured = { ...t.report(), browser: loaf.report(), persistRequests, mainThreadFullCityPuts: fullCityPuts, populationPuts };
            cleaning = true;
            cleanup = (async () => {
              let reload = { checked: false, reason: 'Baseline uses the original full-room cache writer.' };
              try {
                if (manager) { status.textContent = 'Walk finished. Draining accepted writes and testing the original cache reader...'; reload = await manager.verify(); }
                if (reported) {
                  const value = { kind: 'city-crowd-cache-detail', version: 1, mode, ...measured, worker: manager?.diagnostics() || null,
                    optimizedPathExercised: (manager?.diagnostics().patchesCommitted || 0) > 0, reload,
                    policy: 'Only small crowd JSON crosses to the worker. The worker still reads/writes the complete compatible room record atomically. Other room data is unchanged; missing/mismatched cache state uses a full-save fallback. This is not an on-disk split-cache migration.',
                    timing: 'Setup, worker CPU and final reload checks are outside the walking FPS measurement. Different routes/events are not an identical-input comparison.' };
                  await record(value, dungeon);
                  if (!cancelled) status.textContent = mode + ': log confirmed. ' + (manager ?
                    (reload.valid ? 'Original-reader reload verified. Worker patches: ' + value.worker.patchesCommitted + '; full-save fallbacks: ' + value.worker.fullFallbacks + '.' : 'Reload not verified: ' + (reload.reason || 'unknown')) : 'Baseline complete. Ready for Worker crowd patch.');
                }
              } catch (error) { if (!cancelled) status.textContent = error.message + ' Results remain in CityCrowdCacheTrial.cacheResults.'; root.console.warn('[CityCrowdCacheTrial]', error.message); }
              finally { transport?.close(); cleaning = false; }
            })();
          } };
      }
    });
    const originalCapture = trial.capture, originalUndo = trial.undo;
    trial.capture = async function(mode) {
      if (preparing || cleaning) { status.textContent = 'Wait for cache setup/reload verification to finish.'; return; }
      if (cancelled || !trial.active()) return;
      if (root.gamePaused || root.isCombatRoundActive?.() || root.actionDiceState?.active || root._deathSceneActive || root._gameOver) return originalCapture(mode);
      preparing = true; status.textContent = 'Preparing a compatible room snapshot before the timed walk...';
      try {
        prepared = await cache.prepare(root, expected.cache);
        if (cancelled) return;
        return await originalCapture(mode);
      } catch (error) { status.textContent = error.message; root.console.warn('[CityCrowdCacheTrial]', error.message); }
      finally { preparing = false; }
    };
    trial.undo = function() { cancelled = true; originalUndo(); return cleanup; };
    trial.cacheResults = results; trial.idle = () => cleanup;
    root.document.getElementById('city-actor-trial').append(status); root.CityCrowdCacheTrial = trial;
    return trial;
  }
  if (typeof module === 'object' && module.exports) module.exports = { install };
})();

return module.exports; })();
try { controller.install(root, actor, profiler, response, refresh, cache, {"actor":{"sync":"function syncPartyMazeToCombatPositions(forceReset = false) {\n  if (!shouldUsePartyMazeAnchors()) return;\n  if (forceReset || !isCombatRoundActive()) ensurePartyMazeAnchors(forceReset);\n  const roomKey = getCurrentCombatRoomKey();\n\n  window.combatCharacters.forEach(entry => {\n    if (!entry) return;\n    if (entry.type === 'pc') {\n      entry.x = COMBAT_GRID_CENTER;\n      entry.y = COMBAT_GRID_CENTER;\n      entry.mazeX = playerDungeonX;\n      entry.mazeY = playerDungeonY;\n      entry.mazePoint={x:playerPosX,y:playerPosY};\n      entry.mazeRoomKey = roomKey;\n    } else if ((entry.type === 'npc' || entry.type === 'monster') && Number.isFinite(entry.mazeX) && Number.isFinite(entry.mazeY)) {\n      const projected = projectMazePointToCombatGrid(entry.mazeX + 0.5, entry.mazeY + 0.5);\n      entry.x = projected.x;\n      entry.y = projected.y;\n    }\n  });\n\n  window.combatCharactersString = JSON.stringify(window.combatCharacters);\n}","sprite":"function getProceduralSpriteFor(entry) {\n  if(entry?.ambient)return entry.sprite;\n  if(entry?.sprite?.appearanceLocked&&entry.sprite.spec?.kind==='procedural'){\n    if(!entry.sprite.dataUrl){\n      const canvas=window.createTraitSpriteCanvas?.(entry.sprite.spec,0);\n      const dataUrl=canvas?.toDataURL?.('image/png');if(dataUrl)entry.sprite={...entry.sprite,dataUrl};\n    }\n    return entry.sprite;\n  }\n  const api = getProceduralCharactersApi();\n  if (!api || !entry || !entry.name) return null;\n  const key = proceduralNameKey(entry.name);\n  const sheet = buildProceduralSheetForEntry(entry);\n  requestCharacterTraitSpecs([sheet]);\n  const server = window._characterTraitSpecs[key] || null;\n  const ready = !!(server && server.source === 'llm' && server.traits);\n  const sig = (ready ? [server.salt, server.variant, sheet.level,\n    hashCharacterName(JSON.stringify([server.traits,server.stature,proceduralSheetSignature(sheet),sheet.isMonster,sheet.role])).toString(36)].join(':') : 'placeholder');\n  const cached = window._proceduralSpriteCache[key];\n  if (cached && cached.sig === sig) return cached.sprite;\n  let sprite;\n  if (!ready) {\n    sprite = createSpritePlaceholder(entry);\n  } else {\n    try {\n      const spec = api.buildProceduralSpriteSpec(sheet, server.traits, { salt: server.salt >>> 0, variant: server.variant | 0, source: 'llm', stature:server.stature });\n      const canvas = window.createTraitSpriteCanvas(spec, 0);\n      const dataUrl = canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : '';\n      if (!dataUrl) return null;\n      sprite = { dataUrl, spec, generated: true, clientOnly: true, procedural: true, source: 'llm', monster: entry.type === 'monster' };\n    } catch (e) {\n      console.warn('[Sprite] trait sprite failed', entry.name, e);\n      sprite = createSpritePlaceholder(entry);\n    }\n  }\n  window._proceduralSpriteCache[key] = { sprite, sig };\n  return sprite;\n}","positions":"updatePositions(characters) {\n        characters = characters.filter(isDungeonActorPresent);\n    // console.log(\"Updating CombatScene positions with:\", characters);\n        if (this.sys && this.sys.game && this.sys.game.loop) {\n            this.sys.game.loop.wake();\n        }\n        ensurePCSpriteInCombatList(characters);\n        window.combatCharacters = Array.isArray(window.combatCharacters) ? window.combatCharacters : [];\n        characters.forEach(character => {\n            const existingChar = window.combatCharacters.find(c => c.name === character.name);\n            copyCombatPersistentFields(character, existingChar);\n        });\n        characters = characters.filter(isDungeonActorPresent);\n        characters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (charData) {\n                charData.x = character.x;\n                charData.y = character.y;\n                charData.type = character.type;\n                if (!character.sprite || !character.sprite.dataUrl) ensureKnownSpritesInCombatList([character]);\n                refreshCombatVisualIfStale(this, charData, character);\n                applyCombatVisualFrame(charData.sprite, character);\n                moveCombatVisualTo(this, charData, character, false);\n            } else {\n                // Add new character if not present\n                let sprite;\n                if (character.type === 'pc') this.pcName = character.name;\n                sprite = createCombatVisual(this, character);\n                sprite.setOrigin(0.5, 0.5);\n                const pcFontSize = (character.type === 'pc') ? '10px' : '11px';\n                let label = this.add.text(character.x * 25 + 12.5, character.y * 25 + 29, '', {\n                    fontSize: pcFontSize,\n                    color: '#ffffff',\n                    align: 'center'\n                });\n                label.setOrigin(0.5, 0.5);\n                label.setVisible(false);\n                this.characters[character.name] = { sprite, label, x: character.x, y: character.y, type: character.type, texKey: sprite._holodekTexKey || null };\n                applyCombatVisualFrame(sprite, character);\n            }\n            // Update window.combatCharacters with the latest position\n            const charInGlobal = window.combatCharacters.find(c => c.name === character.name);\n            if (charInGlobal) {\n                charInGlobal.x = character.x;\n                charInGlobal.y = character.y;\n                if (Number.isFinite(character.mazeX)) charInGlobal.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) charInGlobal.mazeY = character.mazeY;\n                if (character.mazeRoomKey) charInGlobal.mazeRoomKey = character.mazeRoomKey;\n                if (!charInGlobal.sprite && character.sprite) charInGlobal.sprite = character.sprite;\n                if (Number.isFinite(character.walkFrame)) charInGlobal.walkFrame = character.walkFrame;\n                if (character.facing) charInGlobal.facing = character.facing;\n                for (const field of ['hp', 'state', 'allegiance']) {\n                    if (character[field] !== undefined) charInGlobal[field] = character[field];\n                }\n            } else {\n                const entry = { name: character.name, type: character.type, x: character.x, y: character.y };\n                if (character.sprite) entry.sprite = character.sprite;\n                if (Number.isFinite(character.mazeX)) entry.mazeX = character.mazeX;\n                if (Number.isFinite(character.mazeY)) entry.mazeY = character.mazeY;\n                if (character.mazeRoomKey) entry.mazeRoomKey = character.mazeRoomKey;\n                if (Number.isFinite(character.walkFrame)) entry.walkFrame = character.walkFrame;\n                if (character.facing) entry.facing = character.facing;\n                copyCombatPersistentFields(entry, character);\n                window.combatCharacters.push(entry);\n            }\n        });\n        // Remove characters no longer present from window.combatCharacters\n        window.combatCharacters = window.combatCharacters.filter(c => characters.some(ch => ch.name === c.name));\n        syncPartyMazeToCombatPositions(false);\n        window.combatCharacters.forEach(character => {\n            const charData = this.characters[character.name];\n            if (!charData) return;\n            charData.x = character.x;\n            charData.y = character.y;\n            applyCombatVisualFrame(charData.sprite, character);\n            moveCombatVisualTo(this, charData, character, false);\n            setCombatVisualOverlayVisible(charData, character.discoveryState !== 'pending');\n        });\n        setCombatPlayerTokenOwner(this,this._pcTokenComposited);\n        ensurePCSpriteInCombatList(window.combatCharacters);\n        // Update combatCharactersString globally\n        window.combatCharactersString = JSON.stringify(window.combatCharacters);\n    // console.log(\"Updated window.combatCharactersString in updatePositions:\", window.combatCharactersString);\n        // Remove characters no longer present\n        Object.keys(this.characters).forEach(name => {\n            if (!characters.some(c => c.name === name)) {\n                const charData = this.characters[name];\n                charData.sprite.destroy();\n                charData.label.destroy();\n                delete this.characters[name];\n            }\n        });\n        // Initiative can arrive before the roster. Repaint the ground ink after\n        // merging actors, not just their sprites, while retaining map positions.\n        this.redrawCombatRT();\n        if (this._movementSleepTimer) {\n            this._movementSleepTimer.remove(false);\n            this._movementSleepTimer = null;\n        }\n        this._movementSleepTimer = this.time.delayedCall(260, () => {\n            this.sys.game.loop.sleep();\n            this._movementSleepTimer = null;\n        });\n    }"},"cache":{"idb":"async function idbSetDungeon(coordsKey, dungeon) {\n  const runId = dungeon?._meta?.runId || window.dungeonRunId;\n  if (!runId) return;\n  const cacheKey = `${runId}:${window.CityFloorScope?.cacheKey(coordsKey,dungeon)||coordsKey}`;\n  const db = await openDungeonDB();\n  return new Promise((resolve, reject) => {\n    const tx = db.transaction(DUNGEON_STORE, 'readwrite');\n    tx.objectStore(DUNGEON_STORE).put(dungeon, cacheKey);\n    tx.oncomplete = () => resolve();\n    tx.onerror    = () => reject(tx.error);\n  });\n}","persist":"()=>currentDungeon&&idbSetDungeon(currentDungeon.geoKey,currentDungeon).catch(console.error)","realtime":"async event => {\n  if (event?.type === 'player_respawn') {\n    if (event.runId !== window.dungeonRunId || event.fromKey !== currentDungeon?.geoKey || !event.dungeon?.cells ||\n        event.dungeon.geoKey !== event.geoKey || realtimeCombatResultsSeen.has(event.eventId)) return;\n    ++dungeonSwitchRequest;\n    currentDungeon = event.dungeon;\n    const [x, y, z] = event.geoKey.split(',').map(Number); currentCoordinates = { x, y, z };\n    window.currentCoordinates = 'X: ' + x + ', Y: ' + y + ', Z: ' + z;\n    const start = findNearestWalkableStart(currentDungeon, currentDungeon.start);\n    playerDungeonX = start.x; playerDungeonY = start.y; playerPosX = start.x + .5; playerPosY = start.y + .5;\n    playerZInitialized = false; window.resetDungeonArrivalMomentum?.();\n    window.CombatTacticalUi?.changeFloor(event.geoKey); window.CombatTurnUi?.receive(null);\n    window.combatCharacters = JSON.parse(event.combatCharactersString);\n    preloadDungeonTextures(); updatePlayerHeightFromCell();\n    idbSetDungeon(event.geoKey, currentDungeon).catch(error => console.warn('[RespawnCache]', error.message));\n  }\n  if (!event || typeof event.eventId!=='string' || event.runId !== window.dungeonRunId || event.geoKey !== currentDungeon?.geoKey || realtimeCombatResultsSeen.has(event.eventId)) return;\n  const text = event.updatedGameConsole;\n  if (typeof text !== 'string' || window.DungeonInhabitants.roomKey(text.match(/^Coordinates:\\s*(.*)$/m)?.[1])!==event.geoKey) return;\n  let roster;\n  if (event.combatCharactersString) {\n    try {roster=JSON.parse(event.combatCharactersString);}catch{return;}\n    if(!Array.isArray(roster)||roster.some(actor=>!actor||typeof actor.name!=='string'))return;\n  }\n  realtimeCombatResultsSeen.add(event.eventId);\n  if(event.crowd)window.CityCrowdUi?.receive(event);\n  if (realtimeCombatResultsSeen.size > 32) realtimeCombatResultsSeen.delete(realtimeCombatResultsSeen.values().next().value);\n  if (!event.passive) { window._combatCommandPending = false; window._combatRoundActiveUntil = 0; }\n  if(['quest_scene_result', 'economy_result', 'spell_result', 'player_respawn'].includes(event.type)&&event.roomNameDatabaseString) {\n    const database=JSON.parse(event.roomNameDatabaseString);\n    roomNameDatabaseString=event.roomNameDatabaseString;roomNameDatabasePlainObject=database;roomNameDatabase.clear();\n    for(const [key,room] of Object.entries(database))roomNameDatabase.set(key,room);\n  }\n  if (event.type === 'economy_result' || event.type === 'spell_result') roomDatabaseSyncClient.reset();\n  if (Array.isArray(event.sceneObjects)) currentDungeon.sceneObjects = event.sceneObjects;\n  window.lastServerGameConsole = text;\n  updateCharacterSheetsFromConsole(text);\n  if (event.population) window.DungeonLife?.receivePopulation({ population: event.population, runId: event.runId });\n  if (roster) {\n    window.combatCharacters = roster;\n    ensureKnownSpritesInCombatList(window.combatCharacters);\n    syncPartyMazeToCombatPositions(false);\n  }\n  generateMonstersForRoom(event.geoKey, text);\n  updateGameConsole('', currentCoordinates, text, null, text);\n  window.latestUpdatedData = window.DungeonInhabitants.consoleView(text, window.latestUpdatedData);\n  window.SpellUi?.hydrate(text);\n  window.game?.scene?.getScene('MainScene')?.scene.restart(window.latestUpdatedData);\n  const entry = document.createElement('p'); entry.style.whiteSpace = 'pre-wrap'; entry.textContent = event.content;\n  document.getElementById('chatlog')?.appendChild(entry);\n  const conversationId = localStorage.getItem('conversationId');\n  if (conversationId) await addPromptAndResponse('[Encounter]', '', '', event.content, '', conversationId, text);\n  window.renderPartyIconDock?.(); renderDungeonView();\n}","get":"async function idbGetDungeon(coordsKey) {\n  if (!window.dungeonRunId) return null;\n  const cacheKey = `${window.dungeonRunId}:${window.CityFloorScope?.cacheKey(coordsKey)||coordsKey}`;\n  const db = await openDungeonDB();\n  return new Promise((resolve, reject) => {\n    const tx  = db.transaction([DUNGEON_STORE, DUNGEON_INHABITANTS_STORE], 'readonly');\n    const req = tx.objectStore(DUNGEON_STORE).get(cacheKey);\n    const population = tx.objectStore(DUNGEON_INHABITANTS_STORE).get(cacheKey);\n    tx.oncomplete = () => resolve(req.result ? { ...req.result, inhabitants: population.result || req.result.inhabitants } : null);\n    tx.onerror = () => reject(tx.error);\n    tx.onabort = () => reject(tx.error || new Error('Dungeon cache read was aborted.'));\n  });\n}","open":"function openDungeonDB() {\n  if (dungeonDBPromise) return dungeonDBPromise;\n\n  dungeonDBPromise = new Promise((resolve, reject) => {\n    const req = indexedDB.open(DUNGEON_DB_NAME, 2);\n\n    req.onupgradeneeded = (e) => {\n      const db = e.target.result;\n      if (!db.objectStoreNames.contains(DUNGEON_STORE)) {\n        db.createObjectStore(DUNGEON_STORE); // key = \"x,y,z\"\n      }\n      if (!db.objectStoreNames.contains(DUNGEON_INHABITANTS_STORE)) db.createObjectStore(DUNGEON_INHABITANTS_STORE);\n    };\n\n    req.onsuccess = () => {\n      const database = req.result;\n      database.onversionchange = () => { database.close(); dungeonDBPromise = null; };\n      resolve(database);\n    };\n    req.onerror   = () => reject(req.error);\n  });\n\n  return dungeonDBPromise;\n}"}}, "'use strict';\nconst cache = (() => { const module = { exports: {} };\n(function() {\n  'use strict';\n  const normalize = s => s.replace(/\\r\\n/g, '\\n').trim();\n  const round = n => Math.round(n * 100) / 100;\n  function sources(game) {\n    game = normalize(game);\n    const take = (start, end) => {\n      if (game.split(start).length !== 2 || game.split(end).length !== 2) throw Error('Crowd-cache source boundaries changed.');\n      return game.slice(game.indexOf(start), game.indexOf(end, game.indexOf(start) + start.length)).trim();\n    };\n    return { get: take('async function idbGetDungeon(', '\\nasync function idbSetDungeon('),\n      open: take('function openDungeonDB()', '\\nasync function idbGetDungeon(') };\n  }\n  function scope(root, dungeon = root.currentDungeon) {\n    const run = dungeon?._meta?.runId || root.dungeonRunId;\n    if (!run || run !== root.dungeonRunId || !dungeon?.geoKey || !dungeon._geometryStamp || !dungeon.cityCrowd ||\n      dungeon.classification?.indoor !== false || dungeon.cityFloorContext) throw Error('Use the outdoor host city with a stamped crowd.');\n    const key = run + ':' + (root.CityFloorScope?.cacheKey(dungeon.geoKey, dungeon) || dungeon.geoKey);\n    return { dungeon, run, key, geoKey: dungeon.geoKey, stamp: dungeon._geometryStamp, floor: root.CityFloorScope?.token?.() };\n  }\n  function guard(dungeon) {\n    return { fields: Object.entries(dungeon).filter(([key]) => key !== 'cityCrowd' && key !== '_lodCache'),\n      mutable: JSON.stringify(['sceneObjects', 'physicalPuzzle', 'secretDoors', 'actionAttempts', 'livingEncounter', 'start', '_world1Start', '_meta']\n        .map(key => [key, dungeon[key]])) };\n  }\n  function same(a, b) {\n    return !!a && a.mutable === b.mutable && a.fields.length === b.fields.length &&\n      a.fields.every(([key, value], i) => key === b.fields[i][0] && Object.is(value, b.fields[i][1]));\n  }\n  function staticText(record) {\n    // The normal reader overlays inhabitants from its existing population store.\n    return JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'cityCrowd' && key !== 'inhabitants')));\n  }\n  async function digest(root, text) {\n    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(text))))\n      .map(n => n.toString(16).padStart(2, '0')).join('');\n  }\n  function fullWrite(root, context) {\n    return root.openDungeonDB().then(db => new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readwrite');\n      // Freeze the original run/floor key rather than consulting a potentially changed active floor later.\n      tx.objectStore('rooms').put(context.dungeon, context.key);\n      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Full cache save aborted.'));\n    }));\n  }\n  function bridge(root, workerSource) {\n    const url = root.URL.createObjectURL(new root.Blob([workerSource], { type: 'application/javascript' }));\n    let worker; try { worker = new root.Worker(url); } finally { root.URL.revokeObjectURL(url); }\n    let sequence = 0, closed = false; const pending = new Map();\n    const rejectAll = error => { for (const p of pending.values()) { root.clearTimeout(p.timer); p.reject(error); } pending.clear(); };\n    worker.onerror = event => { event.preventDefault?.(); closed = true; rejectAll(Error(event.message || 'Crowd-cache worker failed.')); worker.terminate(); };\n    worker.onmessage = event => {\n      const p = pending.get(event.data?.id); if (!p) return;\n      pending.delete(event.data.id); root.clearTimeout(p.timer);\n      if (event.data.error) p.reject(Error(event.data.error)); else p.resolve(event.data.result);\n    };\n    return { call(type, payload) {\n      if (closed) return Promise.reject(Error('Crowd-cache worker is closed.'));\n      return new Promise((resolve, reject) => {\n        const id = ++sequence, timer = root.setTimeout(() => { pending.delete(id); reject(Error('Crowd-cache worker timed out.')); }, 15000);\n        pending.set(id, { resolve, reject, timer });\n        try { worker.postMessage({ id, type, ...payload }); } catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error); }\n      });\n    }, close() { closed = true; rejectAll(Error('Crowd-cache worker closed.')); worker.terminate(); } };\n  }\n  function manager(root, context, transport, initialGuard) {\n    let known = initialGuard, expectedCrowd = JSON.stringify(context.dungeon.cityCrowd), tail = Promise.resolve(), stopped = false, lastResult = null, durabilityFailure = null;\n    const newCounts = () => ({ requests: 0, patchAttempts: 0, patchesCommitted: 0, superseded: 0, fullFallbacks: 0, failures: 0,\n      payloadCharacters: 0, largestPayloadCharacters: 0, workerPutMs: 0, mainDispatchMs: 0, inFlightFromWarmup: 0 });\n    let counts = newCounts(), inFlight = 0;\n    function invalidate() { known = null; }\n    function write() {\n      if (stopped) return fullWrite(root, context);\n      const stats = counts; stats.requests++;\n      let text, capturedGuard;\n      try { text = JSON.stringify(context.dungeon.cityCrowd); capturedGuard = guard(context.dungeon); }\n      catch (error) { stats.failures++; durabilityFailure = error.message; return Promise.reject(error); }\n      const run = async () => {\n        if (same(known, capturedGuard) && same(capturedGuard, guard(context.dungeon))) {\n          try {\n            const payload = { key: context.key, run: context.run, geoKey: context.geoKey, stamp: context.dungeon._geometryStamp,\n              expectedCrowd, crowd: text };\n            stats.patchAttempts++; stats.payloadCharacters += text.length; stats.largestPayloadCharacters = Math.max(stats.largestPayloadCharacters, text.length);\n            const at = root.performance.now(), pending = transport.call('patch', payload);\n            stats.mainDispatchMs += root.performance.now() - at;\n            const result = await pending;\n            if (result.status === 'patched' || result.status === 'superseded') {\n              expectedCrowd = result.crowd; lastResult = result;\n              stats.workerPutMs += result.workerPutMs || 0;\n              if (result.status === 'patched') stats.patchesCommitted++; else stats.superseded++;\n              durabilityFailure = null;\n              return;\n            }\n          } catch { stats.failures++; }\n        }\n        stats.fullFallbacks++;\n        const before = guard(context.dungeon);\n        try { await fullWrite(root, context); }\n        catch (error) { stats.failures++; durabilityFailure = error.message; throw error; }\n        known = same(before, guard(context.dungeon)) ? before : null;\n        expectedCrowd = JSON.stringify(context.dungeon.cityCrowd); lastResult = null; durabilityFailure = null;\n      };\n      inFlight++;\n      const pending = tail.then(run).then(value => { inFlight--; return value; }, error => { inFlight--; throw error; });\n      tail = pending.catch(() => {}); return pending;\n    }\n    return { write, invalidate, drain: () => tail, stop() { stopped = true; },\n      reset() { counts = newCounts(); counts.inFlightFromWarmup = inFlight; },\n      diagnostics: () => ({ ...counts, workerPutMs: round(counts.workerPutMs), mainDispatchMs: round(counts.mainDispatchMs) }),\n      async verify() {\n        await tail;\n        if (durabilityFailure) return { checked: false, valid: false, reason: 'An accepted cache write failed: ' + durabilityFailure };\n        if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor)\n          return { checked: false, reason: 'Active run/room/floor changed; legacy reader verification skipped.' };\n        const authoritative = await transport.call('inspect', { key: context.key });\n        const loaded = await root.idbGetDungeon(context.geoKey);\n        if (!loaded) return { checked: true, valid: false, reason: 'The original cache reader returned no room.' };\n        const hash = await digest(root, staticText(loaded)), crowd = JSON.stringify(loaded.cityCrowd);\n        const matchesLastPatch = !lastResult?.staticHash || lastResult.staticHash === authoritative.staticHash;\n        const valid = hash === authoritative.staticHash && crowd === authoritative.crowd && matchesLastPatch;\n        return { checked: true, valid, originalReaderUsed: true, staticRoomPreserved: hash === authoritative.staticHash && matchesLastPatch,\n          crowdPreserved: crowd === authoritative.crowd, matchesLastPatch, patchesCommitted: counts.patchesCommitted,\n          lastPatchStaticHash: lastResult?.staticHash || null, reloadStaticHash: hash,\n          reason: valid ? null : 'The cache changed between reads or reload data differed; this result is not verified.' };\n      } };\n  }\n  function preflight(root, expected) {\n    for (const [key, name] of [['persistCityCrowd', 'persist'], ['idbSetDungeon', 'idb'], ['idbGetDungeon', 'get'], ['openDungeonDB', 'open']])\n      if (typeof root[key] !== 'function' || normalize(root[key].toString()) !== expected[name]) throw Error('Running cache method differs from verified source: ' + key);\n    if (typeof root.Worker !== 'function' || !root.crypto?.subtle || !root.TextEncoder) throw Error('Worker and cryptographic reload verification are required. No unsafe fallback installation.');\n  }\n  async function prepare(root, expected) {\n    preflight(root, expected);\n    const context = scope(root), before = guard(context.dungeon);\n    await root.idbSetDungeon(context.geoKey, context.dungeon);\n    if (root.currentDungeon !== context.dungeon || root.dungeonRunId !== context.run || root.CityFloorScope?.token?.() !== context.floor ||\n      !same(before, guard(context.dungeon))) throw Error('City changed during cache setup. Click the capture again.');\n    return { context, initialGuard: before };\n  }\n  if (typeof module === 'object' && module.exports) module.exports = { sources, scope, guard, same, staticText, digest, fullWrite, bridge, manager, preflight, prepare };\n})();\n\nreturn module.exports; })();\nconst worker = (() => { const module = { exports: {} };\n(function() {\n  'use strict';\n  function patch(db, data, now = () => performance.now()) {\n    return new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readwrite'), store = tx.objectStore('rooms'), get = store.get(data.key);\n      let result = { status: 'fallback' }, staticValue = null;\n      get.onsuccess = () => {\n        const record = get.result;\n        if (!record || record.geoKey !== data.geoKey || record._geometryStamp !== data.stamp ||\n          record._meta?.runId && record._meta.runId !== data.run || !data.key.startsWith(data.run + ':')) return;\n        let crowd; try { crowd = JSON.parse(data.crowd); } catch { return; }\n        const current = JSON.stringify(record.cityCrowd);\n        if ((record.cityCrowd?.revision || 0) > (crowd?.revision || 0)) {\n          result = { status: 'superseded', crowd: current, workerPutMs: 0 }; return;\n        }\n        if (current !== data.expectedCrowd) return;\n        staticValue = record;\n        record.cityCrowd = crowd;\n        const at = now(); store.put(record, data.key);\n        result = { status: 'patched', crowd: data.crowd, workerPutMs: now() - at };\n      };\n      tx.oncomplete = () => resolve({ ...result, staticValue });\n      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Crowd patch transaction aborted.'));\n    });\n  }\n  function read(db, key) {\n    return new Promise((resolve, reject) => {\n      const tx = db.transaction('rooms', 'readonly'), request = tx.objectStore('rooms').get(key);\n      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Cache read aborted.'));\n    });\n  }\n  function install(root, core) {\n    let dbPromise = null, queue = Promise.resolve();\n    function database() {\n      if (dbPromise) return dbPromise;\n      dbPromise = new Promise((resolve, reject) => {\n        const request = root.indexedDB.open('cotg-dungeons', 2);\n        request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Existing version-2 cache required; no schema changes are allowed.')); };\n        request.onblocked = () => reject(Error('Crowd-cache database is blocked.'));\n        request.onerror = () => reject(request.error);\n        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };\n      }); return dbPromise;\n    }\n    root.onmessage = event => {\n      const data = event.data;\n      queue = queue.then(async () => {\n        try {\n          const db = await database(); let result;\n          if (data.type === 'patch') {\n            const { staticValue, ...info } = await patch(db, data);\n            result = { ...info, staticHash: staticValue ? await core.digest(root, core.staticText(staticValue)) : null };\n          } else if (data.type === 'inspect') {\n            const record = await read(db, data.key);\n            if (!record) throw Error('Cached room missing during reload verification.');\n            result = { staticHash: await core.digest(root, core.staticText(record)), crowd: JSON.stringify(record.cityCrowd) };\n          } else throw Error('Unknown crowd-cache worker operation.');\n          root.postMessage({ id: data.id, result });\n        } catch (error) { root.postMessage({ id: data.id, error: error.message }); }\n      });\n    };\n  }\n  if (typeof module === 'object' && module.exports) module.exports = { patch, read, install };\n})();\n\nreturn module.exports; })();\nworker.install(self, cache);\n"); }
    catch(error) { root.console.error('City crowd-cache trial not installed:', error.message); }
})(window);
