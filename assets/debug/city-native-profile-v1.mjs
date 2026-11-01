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
  function install(root) {
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
    status.textContent = 'Native city walking measurement\nNo optimization or graphics changes.\nUnpause, close DevTools, then click Capture Native Walk.\nWalk and turn for 20 seconds; avoid buildings/combat.';
    const capture = root.document.createElement('button'); capture.textContent = 'Capture Native Walk (20s)';
    const undo = root.document.createElement('button'); undo.textContent = 'Close / Undo'; panel.append(status, capture, undo);
    const position = () => ({ x: root.playerPosX, y: root.playerPosY, angle: root.playerAngle });
    const settings = () => JSON.stringify([renderer.canvas?.width, renderer.canvas?.height, presenter.canvas?.width, presenter.canvas?.height,
      presenter.mode, root.WEBGPU_NATIVE_WORLD, root.forceCanvasDungeon, root.RetroGraphics?.fullbright?.()]);
    const valid = () => !disposed && !blocked() && root.currentDungeon === dungeon && root.dungeonRunId === runId && root.DungeonPerformance === native &&
      JSON.stringify(dungeon.cityFloorContext) === floor && root.webglDungeonRenderer === presenter && (presenter.legacyRenderer || presenter) === renderer;
    function measuredRender(...args) {
      const before = renderer.lastFrameStats, started = root.performance.now();
      try {
        const result = original.apply(this, args), stats = renderer.lastFrameStats;
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
      restoreHook(); panel.remove();
    }
    async function run() {
      if (busy || disposed) return;
      if (root.gamePaused) { status.textContent = 'Unpause the game first, then click Capture Native Walk (20s).'; return; }
      if (!valid() || presenter.renderScene !== original) { status.textContent = 'The room, encounter or renderer changed. Reload this profiler.'; return; }
      busy = true; capture.disabled = true;
      const expectedSettings = settings(), frames = [], longTasks = [], stamps = new Set([dungeon._geometryStamp]);
      const startPosition = position(); let initialCounts = native.diagnostics().counts;
      let start = null, elapsed = 0, distance = 0, movingMs = 0, turningMs = 0, observer = null, abortReason = null, longTaskAvailable = false;
      try {
        status.textContent = 'Warming for 2 seconds. Then walk and turn normally for 20 seconds.';
        await new Promise((resolve, reject) => {
          cancelWait = reject; warmTimer = root.setTimeout(() => { cancelWait = null; resolve(); }, 2000);
        });
        if (!valid() || presenter.renderScene !== original) throw Error('Room, encounter or renderer changed before measurement.');
        if (root.gamePaused || root.document.visibilityState !== 'visible') throw Error('Keep the game unpaused and its tab visible.');
        if (settings() !== expectedSettings) throw Error('Graphics settings changed before measurement.');
        initialCounts = native.diagnostics().counts;
        start = root.performance.now(); samples = []; presenter.renderScene = measuredRender;
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
          function tick(now) {
            try {
              if (!valid() || root.document.visibilityState !== 'visible') throw Error('Room, encounter, level or visible tab changed. Capture stopped.');
              if (root.gamePaused) throw Error('The game was paused. Capture stopped.');
              if (presenter.renderScene !== measuredRender) throw Error('The renderer method changed. Capture stopped.');
              if (settings() !== expectedSettings) throw Error('Graphics settings changed. Capture stopped.');
              const current = position(), interval = now - last, step = Math.hypot(current.x - previous.x, current.y - previous.y);
              if (![current.x, current.y, current.angle, interval, step].every(Number.isFinite) || interval < 0) throw Error('Player position or frame timing unavailable.');
              const moving = step > .002, turning = Math.abs(Math.atan2(Math.sin(current.angle - previous.angle), Math.cos(current.angle - previous.angle))) > .002;
              distance += step; if (moving) movingMs += interval; if (turning) turningMs += interval;
              stamps.add(dungeon._geometryStamp); frames.push({ interval, moving, turning, samples }); samples = [];
              elapsed = now - start; last = now; previous = current;
              const seconds = Math.floor(elapsed / 1000);
              if (seconds !== lastStatus) { lastStatus = seconds; status.textContent = 'Native walking capture: ' + Math.max(0, 20 - seconds) + ' seconds left. Keep walking/turning.'; }
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
        restoreHook(); busy = false; capture.disabled = false;
      }
      const moving = frames.filter(f => f.moving || f.turning), movingElapsed = moving.reduce((sum, f) => sum + f.interval, 0);
      const endCounts = native.diagnostics().counts, cacheCounts = Object.fromEntries([...new Set([...Object.keys(initialCounts), ...Object.keys(endCounts)])]
        .map(key => [key, (endCounts[key] || 0) - (initialCounts[key] || 0)]));
      const overall = summarize(frames, elapsed);
      const validCapture = !abortReason && elapsed >= 20000 && distance >= 2 && movingMs >= 1000 && frames.some(f => f.samples.length);
      const report = { kind: 'native-walking-profile', version: 1, valid: validCapture,
        reason: abortReason || (validCapture ? null : 'Not enough walking or rendered world frames. Unpause and walk for the capture.'),
        optimizationChanges: false, settingsChanges: false, startPosition, endPosition: position(), distanceTiles: round(distance),
        movingSeconds: round(movingMs / 1000), turningSeconds: round(turningMs / 1000), geometryRevisions: stamps.size, cacheCounts,
        overall, whileMoving: moving.length ? summarize(moving, movingElapsed) : null,
        longTaskObservationAvailable: longTaskAvailable, longTasks,
        timingNote: 'Rendered FPS counts rAF intervals with a new world submission. CPU timings include waits/submission, not GPU execution. Different routes are not a controlled A/B comparison.' };
      results.push(report);
      if (!disposed) status.textContent = validCapture ? 'Native walk logged: ' + overall.renderedRafFPS + ' rendered FPS; ' + round(distance) +
        ' tiles; p95 gap ' + overall.rafP95Ms + 'ms.\nRenderer measurement hook removed. No settings changed.' : report.reason + '\nPartial diagnostic logged; try Capture Native Walk again.';
      root.console.info('Native city walking capture:', report);
      try {
        const sent = root.navigator?.sendBeacon?.('/debug/dungeon-rendering', new Blob([JSON.stringify({ reason: 'city-native-walk', geoKey: dungeon.geoKey,
          geometryStamp: dungeon._geometryStamp, backend: presenter === renderer ? 'webgl' : presenter.mode, samples: [], trial: report })], { type: 'application/json' }));
        if (!sent) root.console.warn('Automatic log delivery unavailable. Results remain in CityNativeProfile.results.');
      } catch (error) { root.console.warn('Results remain in CityNativeProfile.results:', error.message); }
      return report;
    }
    capture.addEventListener('click', run); undo.addEventListener('click', close);
    const expiration = root.setTimeout(close, 10 * 60 * 1000);
    root.CityNativeProfile = { capture: run, results, undo: close, active: () => !disposed };
    root.document.body.appendChild(panel); root.console.info('Native city profiler ready. Close DevTools, unpause and use Capture Native Walk (20s).');
    return root.CityNativeProfile;
  }
  if (typeof module === 'object' && module.exports) module.exports = { summarize, install };
  else try { install(window); } catch (error) { console.error('Native city profiler not installed:', error.message); }
})();
