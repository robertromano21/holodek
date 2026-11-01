(function () {
  'use strict';

  function spatialIndex() {
    const rooms = new WeakMap();
    const chunkSize = 16;
    function query(dungeon, x, y, radius) {
      if (![x, y, radius].every(Number.isInteger)) return [];
      const stamp = dungeon._geometryStamp || dungeon._meta?.geometryStamp;
      if (!stamp) throw Error('The test requires stamped room geometry.');
      const tiles = dungeon.tiles || {};
      const kinds = Object.keys(tiles).filter(key => !!tiles[key]?.spriteSpec).sort().join('|');
      let index = rooms.get(dungeon);
      if (!index || index.stamp !== stamp || index.cells !== dungeon.cells || index.kinds !== kinds) {
        const buckets = new Map();
        for (const [key, cell] of Object.entries(dungeon.cells || {})) {
          const tile = cell?.tile;
          if (tile !== 'torch' && tile !== 'pillar' && !(typeof tile === 'string' && tile.startsWith('custom_')) && !tiles[tile]?.spriteSpec) continue;
          const coords = key.split(',').map(Number);
          if (coords.length !== 2 || !coords.every(Number.isInteger)) continue;
          const [cx, cy] = coords, bucketKey = `${Math.floor(cx / chunkSize)},${Math.floor(cy / chunkSize)}`;
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
          buckets.get(bucketKey).push([cx, cy, cell]);
        }
        index = { stamp, cells: dungeon.cells, kinds, buckets, queries: new Map() };
        rooms.set(dungeon, index);
      }
      const key = `${x},${y},${radius}`;
      if (index.queries.has(key)) return index.queries.get(key);
      const result = [];
      for (let cx = Math.floor((x - radius) / chunkSize); cx <= Math.floor((x + radius) / chunkSize); cx++) {
        for (let cy = Math.floor((y - radius) / chunkSize); cy <= Math.floor((y + radius) / chunkSize); cy++) {
          for (const row of index.buckets.get(`${cx},${cy}`) || []) {
            if (Math.abs(row[0] - x) <= radius && Math.abs(row[1] - y) <= radius) result.push(row);
          }
        }
      }
      // Keep the original x-major/y-minor ordering, including equal-distance light ties.
      result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (index.queries.size >= 32) index.queries.delete(index.queries.keys().next().value);
      index.queries.set(key, result);
      return result;
    }
    return { query };
  }

  function patchSource(source) {
    function replaceOnce(before, after) {
      if (source.split(before).length !== 2) throw Error('Renderer version differs from the tested version. No patch applied.');
      source = source.replace(before, after);
    }
    source = source.replace(/\r\n/g, '\n');
    replaceOnce(`      for (let dx = -TORCH_VIS_RADIUS; dx <= TORCH_VIS_RADIUS; dx++) {
        for (let dy = -TORCH_VIS_RADIUS; dy <= TORCH_VIS_RADIUS; dy++) {
          const wx = playerX + dx;
          const wy = playerY + dy;
          const cell = dungeon.cells?.[\x60\x24{wx},\x24{wy}\x60];`,
    `      for (const [wx, wy, cell] of cityProbe.query(dungeon, playerX, playerY, TORCH_VIS_RADIUS)) {
        {`);
    replaceOnce(`      for (let dx = -VOXEL_VIS_RADIUS; dx <= VOXEL_VIS_RADIUS; dx++) {
        for (let dy = -VOXEL_VIS_RADIUS; dy <= VOXEL_VIS_RADIUS; dy++) {
          const wx = playerX + dx;
          const wy = playerY + dy;
          const cell = dungeon.cells?.[\x60\x24{wx},\x24{wy}\x60];`,
    `      for (const [wx, wy, cell] of cityProbe.query(dungeon, playerX, playerY, VOXEL_VIS_RADIUS)) {
        {`);
    replaceOnce(`  window.webglDungeonRenderer = renderer;
  window.debugDungeonPerformance = () => renderer.lastFrameStats || null;
  window.useWebGLRenderer = true;
  if (typeof window.renderDungeonView === 'function') {
    window.renderDungeonView();
  }`, '  capture(renderer);');
    return source;
  }

  function summarize(samples, intervals, elapsed) {
    const percentile = (values, p) => {
      values = values.filter(Number.isFinite).sort((a, b) => a - b);
      return values.length ? Number(values[Math.min(values.length - 1, Math.floor(values.length * p))].toFixed(2)) : null;
    };
    return { frames: samples.length, seconds: Number((elapsed / 1000).toFixed(2)),
      renderCallsPerSecond: Number((samples.length * 1000 / elapsed).toFixed(1)),
      rafFPS: intervals.length ? Number((intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0)).toFixed(1)) : null,
      cpuMedianMs: percentile(samples.map(s => s.cpuMs), .5), cpuP95Ms: percentile(samples.map(s => s.cpuMs), .95),
      collectionMedianMs: percentile(samples.map(s => s.collectionMs), .5),
      resourcesP95Ms: percentile(samples.map(s => s.resourcesMs), .95),
      rafP95Ms: percentile(intervals, .95), first: samples[0] || null, last: samples.at(-1) || null };
  }

  async function install(root) {
    if (root.location.hostname !== 'localhost' || root.location.port !== '3000' || root.location.pathname !== '/assets/index.html')
      throw Error('Run this only in the localhost:3000 game tab.');
    if (root.CityRenderTrial?.active?.()) throw Error('A trial is already loaded. Use CityRenderTrial.undo() first.');
    const presenter = root.webglDungeonRenderer, renderer = presenter?.legacyRenderer || presenter, dungeon = root.currentDungeon;
    if (presenter?.legacyRenderer && (root.webgpuDungeonRenderer !== presenter || root.webglDungeonRendererLegacy !== renderer))
      throw Error('The active renderer adapter is not recognized. No patch applied.');
    if (!renderer?.renderScene || !renderer.gl || !dungeon?.cells || !dungeon._geometryStamp)
      throw Error('Open the city in the WebGL renderer first.');
    if (!dungeon.cityBlocks && !dungeon.sceneSpec?.city) throw Error('This test is for a city room.');
    if (root.actionDiceState?.active || root._deathSceneActive || root._gameOver) throw Error('Finish the current encounter or death screen first.');
    const sourceURL = [...root.document.scripts].map(s => s.src).find(url => /\/assets\/rendererWebGL\.js(?:\?|$)/.test(url));
    if (!sourceURL || new URL(sourceURL).origin !== root.location.origin) throw Error('The loaded renderer script was not found.');
    const response = await root.fetch(sourceURL, { cache: 'no-store' });
    if (!response.ok) throw Error('Could not read the renderer for this test.');
    const source = await response.text(), probe = spatialIndex();
    const original = renderer.renderScene;
    // Recreate the renderer's lexical helpers, but do not replace its GPU context, buffers or caches.
    let candidate;
    new Function('capture', 'cityProbe', patchSource(source))(value => { candidate = value; }, probe);
    if (!candidate || candidate.renderScene.toString() !== patchMethod(original.toString()))
      throw Error('The running renderer differs from the served renderer. No patch applied.');
    function patchMethod(method) {
      const start = source.replace(/\r\n/g, '\n').indexOf('    renderScene() {');
      const tail = source.replace(/\r\n/g, '\n').lastIndexOf('\n  };');
      const served = source.replace(/\r\n/g, '\n').slice(start, tail).trim().replace(/,\s*$/, '');
      if (method.replace(/\r\n/g, '\n').trim() !== served) throw Error('Running renderer method does not match its source.');
      const patched = patchSource(source), a = patched.indexOf('    renderScene() {'), b = patched.lastIndexOf('\n  };');
      return patched.slice(a, b).trim().replace(/,\s*$/, '');
    }

    let mode = 'baseline', collecting = null, rafId = 0, undone = false, busy = false, cancelPhase = null;
    const results = [], sampleCount = 6000;
    const panel = root.document.createElement('section');
    panel.id = 'city-render-trial';
    panel.style.cssText = 'position:fixed;z-index:999999;top:12px;left:330px;max-width:440px;padding:12px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace';
    const status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'City collection-only trial\nClose DevTools, stay still, then run A/B/A.\nSame scenery, lights, resolution and range.\nAbout 23 seconds; Undo restores the renderer.\nTexture/geometry rebuilds are NOT optimized by this test.';
    const run = root.document.createElement('button'); run.textContent = 'Run A/B/A';
    const toggle = root.document.createElement('button'); toggle.textContent = 'Try Optimized';
    const undo = root.document.createElement('button'); undo.textContent = 'Undo';
    panel.append(status, run, toggle, undo);
    const stamp = () => root.currentDungeon?._geometryStamp;
    const view = () => [root.dungeonRunId, root.currentDungeon?.geoKey, stamp(), root.playerPosX, root.playerPosY,
      root.playerDungeonX, root.playerDungeonY, root.playerAngle, root.dungeonViewShift,
      renderer.canvas?.width, renderer.canvas?.height, presenter.canvas?.width, presenter.canvas?.height,
      presenter.mode, root.WEBGPU_NATIVE_WORLD, root.RetroGraphics?.fullbright?.()];
    let expected = null;
    function checkView() {
      if (undone) throw Error('Trial cancelled.');
      if (root.document.visibilityState !== 'visible' || root.webglDungeonRenderer !== presenter ||
          (presenter.legacyRenderer || presenter) !== renderer)
        throw Error('The game tab or renderer changed. Trial stopped.');
      if (JSON.stringify(view()) !== expected) throw Error('The camera, room, geometry or graphics mode changed. Stand still and run again.');
    }
    function setMode(next) {
      mode = next; toggle.textContent = next === 'baseline' ? 'Try Optimized' : 'Use Baseline';
      renderer.renderScene = next === 'baseline' ? baselineRender : optimizedRender;
    }
    function render(method, args) {
      const result = method.apply(this, args);
      if (collecting) {
        const s = this.lastFrameStats;
        if (s && root.performance.now() >= collecting.start) collecting.samples.push({
          cpuMs: s.cpuMs, collectionMs: s.collectionMs, resourcesMs: s.resourcesMs,
          voxelInstances: s.voxelInstances, drawCalls: s.voxelDrawCalls, nearbyLights: s.nearbyTorches,
          skylineWindows: s.citySkyline?.windows, skylineDraws: s.citySkyline?.batchedDraws });
      }
      return result;
    }
    function baselineRender(...args) { return render.call(this, original, args); }
    function optimizedRender(...args) {
      try { return render.call(this, candidate.renderScene, args); }
      catch (error) { restore(); root.console.error('City trial restored the original renderer:', error); return original.apply(this, args); }
    }
    async function phase(label, selected) {
      checkView(); setMode(selected);
      status.textContent = `${label}: warming caches. Stay still.`;
      await new Promise(resolve => root.setTimeout(resolve, 1500));
      checkView();
      collecting = { start: root.performance.now(), samples: [], intervals: [] };
      status.textContent = `${label}: measuring for 6 seconds. Stay still.`;
      let last = null;
      await new Promise((resolve, reject) => {
        cancelPhase = () => reject(Error('Trial cancelled.'));
        function tick(now) {
          try {
            if (undone) throw Error('Trial cancelled.');
            checkView();
            if (last !== null) collecting.intervals.push(now - last);
            last = now;
            if (now - collecting.start >= sampleCount) { cancelPhase = null; resolve(); return; }
            rafId = root.requestAnimationFrame(tick);
          } catch (error) { cancelPhase = null; reject(error); }
        }
        rafId = root.requestAnimationFrame(tick);
      });
      const row = { phase: label, mode: selected, ...summarize(collecting.samples, collecting.intervals, root.performance.now() - collecting.start) };
      collecting = null;
      if (row.frames < 10) throw Error('Too few renderer frames; no valid comparison.');
      results.push(row); return row;
    }
    async function benchmark() {
      if (busy || undone) return;
      busy = true; run.disabled = toggle.disabled = true; results.length = 0;
      expected = JSON.stringify(view());
      try {
        for (const [label, selected] of [['A1 baseline', 'baseline'], ['B optimized', 'optimized'], ['A2 baseline', 'baseline']]) await phase(label, selected);
        setMode('baseline');
        status.textContent = results.map(row => `${row.phase}: rAF ${row.rafFPS} FPS; CPU median ${row.cpuMedianMs}ms; collection ${row.collectionMedianMs}ms; p95 ${row.cpuP95Ms}ms`).join('\n') +
          '\nBaseline restored. Try Optimized to walk-test, or Undo.\nResults: CityRenderTrial.results';
        root.console.table(results.map(({ first, last, ...row }) => row));
        // Existing local diagnostics only: no gameplay, model, save or external requests.
        try {
          root.navigator?.sendBeacon?.('/debug/dungeon-rendering', new Blob([JSON.stringify({
            reason: 'city-render-trial', geoKey: root.currentDungeon.geoKey, geometryStamp: stamp(),
            backend: 'webgl', samples: [], trial: { kind: 'sparse-collection-only', results }
          })], { type: 'application/json' }));
        } catch (error) { root.console.warn('Results remain in CityRenderTrial.results:', error.message); }
      } catch (error) {
        collecting = null;
        if (!undone) { setMode('baseline'); status.textContent = error.message + '\nOriginal renderer active; no valid A/B comparison.'; }
        root.console.warn(error.message);
      } finally { busy = false; run.disabled = toggle.disabled = false; }
    }
    function restore() {
      if (undone) return;
      undone = true; collecting = null; cancelPhase?.(); cancelPhase = null; root.cancelAnimationFrame(rafId);
      renderer.renderScene = original; panel.remove();
      root.clearTimeout(expiration);
      root.console.info('Original city renderer restored. Project files and saves were not changed.');
    }
    run.addEventListener('click', benchmark);
    toggle.addEventListener('click', () => { if (!busy && !undone) {
      setMode(mode === 'baseline' ? 'optimized' : 'baseline');
      status.textContent = mode + ' renderer active. Walk normally to compare; Undo or reload removes this trial.';
    } });
    undo.addEventListener('click', restore);
    const expiration = root.setTimeout(restore, 10 * 60 * 1000);
    root.CityRenderTrial = { results, undo: restore, run: benchmark, mode: () => mode, active: () => !undone };
    root.document.body.appendChild(panel);
    root.console.info('City trial ready. Close DevTools and use the trial panel. Nothing is optimized until Run A/B/A or Try Optimized.');
    return root.CityRenderTrial;
  }

  if (typeof module === 'object' && module.exports) module.exports = { spatialIndex, patchSource, summarize };
  else install(window).catch(error => console.error('City trial not installed:', error.message));
})();
