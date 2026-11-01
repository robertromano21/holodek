(function () {
  'use strict';
  const normalize = source => source.replace(/\r\n/g, '\n').trim();
  function between(source, start, end) {
    source = normalize(source);
    if (source.split(start).length !== 2 || source.split(end).length !== 2) throw Error('Game source differs from the tested version. Nothing installed.');
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (b < 0) throw Error('Game source boundaries changed. Nothing installed.');
    return source.slice(a, b).trim();
  }
  function mapMethod(source) { return between(source, 'redrawCombatRT() {', '\n  drawDungeonOverlayInto(gfx) {'); }
  function viewMethod(source) { return between(source, 'function renderDungeonView() {', '\n// --- Poller for the dedicated character generation task'); }
  function patchMap(method) {
    method = normalize(method);
    const start = '        // Base floor squares + reddish wall blocks';
    const end = '        // Objects in Room: pickable items';
    const gridStart = '        // Draw the thick rotating grid lines';
    const gridEnd = '        window.CombatTacticalUi?.draw(this, this._lastDungeonDraw);';
    const terrain = between(method, start, end), grid = between(method, gridStart, gridEnd);
    const retro = "        const retroMap = !!window.RetroGraphics?.fullbright?.();";
    if (method.split(retro).length !== 2) throw Error('Map palette declaration changed. Nothing installed.');
    const key = `        const retroMap = !!window.RetroGraphics?.fullbright?.();
        const cityMapKey = cityFrameProbe.key(this, currentDungeon, dungeonTextures, pos, combatAngle, cs, viewRadius, centerX, centerY);`;
    const layer = (id, block) => `        cityFrameProbe.layer(this, '${id}', cityMapKey, target => {\n${block.replaceAll('this.renderRT.draw(', 'target.draw(')}\n        });`;
    return method.replace(terrain, key + '\n' + layer('terrain', terrain.replace(retro, ''))).replace(grid, layer('grid', grid));
  }
  function terrainCache(root, count = () => {}, measure = (_name, build) => build()) {
    const scenes = new Map(), ids = new WeakMap(); let sequence = 0;
    const id = value => {
      if (!value || typeof value !== 'object') return value;
      if (!ids.has(value)) ids.set(value, ++sequence);
      return ids.get(value);
    };
    function key(scene, dungeon, textures, pos, angle, cs, half, centerX, centerY) { return measure('mapKeyMs', () => {
      const cells = [], kinds = new Set();
      // Include cliff-edge neighbors and live doors, which can change without replacing the room.
      for (let dy = -half; dy <= half + 1; dy++) for (let dx = -half; dx <= half + 1; dx++) {
        const cell = dungeon.cells[`${Math.floor(pos.x + dx)},${Math.floor(pos.y + dy)}`];
        if (cell) kinds.add(cell.tile);
        cells.push(cell ? [cell.tile, cell.floorSurface, cell.floorHeight, cell.blocked, cell.obstacle, cell.door?.isOpen, cell.secretDoorId] : null);
      }
      const images = [...new Set([...kinds, 'wall', 'pillar', 'column'])].map(tile => {
        const image = textures[tile], spec = dungeon.tiles?.[tile]?.spriteSpec;
        return [tile, id(image), image?.complete, image?.naturalWidth, image?.naturalHeight, image?.currentSrc || image?.src,
          !!spec, spec?.type, spec?.profile];
      });
      return JSON.stringify([id(dungeon), id(dungeon.cells), dungeon._geometryStamp, dungeon.cityFloorContext,
        id(scene.renderRT), scene.renderRT.width, scene.renderRT.height, scene.gridSize, scene.RT_CELL,
        pos.x, pos.y, angle, cs, half, centerX, centerY, root.RetroGraphics?.fullbright?.(),
        dungeon.secretDoors?.doors.map(door => [door.id, door.discovered, door.open]), cells, images]);
    }); }
    function layer(scene, name, signature, build) {
      let cache = scenes.get(scene);
      if (!cache) { cache = new Map(); scenes.set(scene, cache); }
      let entry = cache.get(name);
      const target = scene.renderRT;
      if (!entry || entry.key !== signature) {
        if (!entry || entry.texture.width !== target.width || entry.texture.height !== target.height) {
          entry?.texture.destroy();
          const texture = new root.Phaser.GameObjects.RenderTexture(scene, 0, 0, target.width, target.height);
          texture.setOrigin(0); texture.texture.setFilter(root.Phaser.Textures.FilterMode.NEAREST);
          entry = { texture, key: null }; cache.set(name, entry);
        }
        measure('terrainBuildMs', () => { entry.texture.clear(); build(entry.texture); });
        entry.key = signature; count('terrainBuilds');
      } else count('terrainHits');
      measure('terrainBlitMs', () => target.draw(entry.texture, 0, 0));
    }
    function clear() {
      for (const cache of scenes.values()) for (const entry of cache.values()) entry.texture.destroy();
      scenes.clear();
    }
    return { key, layer, clear };
  }
  function verifyBlit(root, scene) {
    const textures = [], graphics = [];
    try {
      const create = () => {
        const rt = new root.Phaser.GameObjects.RenderTexture(scene, 0, 0, 32, 32);
        textures.push(rt); rt.setOrigin(0); rt.texture.setFilter(root.Phaser.Textures.FilterMode.NEAREST); rt.clear(); return rt;
      };
      const shape = (color, alpha, x, y, w, h) => {
        const g = new root.Phaser.GameObjects.Graphics(scene); graphics.push(g);
        g.fillStyle(color, alpha); g.fillRect(x, y, w, h); return g;
      };
      const direct = create(), cached = create(), output = create();
      const background = shape(0x287755, .95, 0, 0, 32, 32);
      const red = shape(0xdd4433, .6, 2, 2, 12, 10), blue = shape(0x2255dd, 1, 19, 17, 10, 12);
      direct.draw(background); direct.draw(red); direct.draw(blue);
      cached.draw(red); cached.draw(blue); output.draw(background); output.draw(cached, 0, 0);
      const sample = (rt, x, y) => {
        let result;
        const canvas = rt.texture?.canvas;
        if (canvas) {
          // Phaser's Canvas snapshotPixel follows the asynchronous Image path, not the WebGL Color path.
          const context = canvas.getContext('2d');
          result = context && Array.from(context.getImageData(x, y, 1, 1).data);
        } else rt.snapshotPixel(x, y, color => { result = color && [color.red, color.green, color.blue, color.alpha]; });
        if (result?.length !== 4 || !result.every(Number.isFinite)) throw Error('Map cache pixel verification was unavailable. Nothing installed.');
        return result;
      };
      const samples = [[3, 3], [21, 20], [3, 25], [25, 3]].map(([x, y]) => ({ direct: sample(direct, x, y), cached: sample(output, x, y) }));
      const maxDifference = Math.max(...samples.flatMap(s => s.direct.map((value, i) => Math.abs(value - s.cached[i]))));
      if (maxDifference > 2 || new Set(samples.map(s => s.direct.join(','))).size < 3)
        throw Error('Map cache pixel orientation/compositing did not match. Nothing installed.');
      return { maxChannelDifference: maxDifference, pixelsChecked: samples.length, backend: direct.texture?.canvas ? 'canvas' : 'webgl' };
    } finally { for (const g of graphics) g.destroy(); for (const rt of textures) rt.destroy(); }
  }
  function frameQueue(root, world, map) {
    let ticket = 0, worldCall = null, mapCall = null, flushing = false;
    function schedule() { if (!ticket && !flushing) ticket = root.requestAnimationFrame(flush); }
    function requestWorld(self, args) { worldCall = [self, args]; schedule(); }
    function requestMap(self, args) { mapCall = [self, args]; schedule(); }
    function flush() {
      if (ticket) root.cancelAnimationFrame(ticket);
      ticket = 0; flushing = true;
      try {
        const call = worldCall; worldCall = null;
        if (call) world.apply(call[0], call[1]);
        const next = mapCall; mapCall = null;
        if (next) map.apply(next[0], next[1]);
      } finally { flushing = false; if (worldCall || mapCall) schedule(); }
    }
    function cancel() { if (ticket) root.cancelAnimationFrame(ticket); ticket = 0; worldCall = mapCall = null; }
    return { requestWorld, requestMap, flush, cancel };
  }
  const percentile = (values, p) => {
    values = values.filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? Number(values[Math.min(values.length - 1, Math.floor(values.length * p))].toFixed(2)) : null;
  };
  function summarize(data, elapsed) {
    const timing = key => ({ medianMs: percentile(data.frames.map(f => f[key] || 0), .5), p95Ms: percentile(data.frames.map(f => f[key] || 0), .95),
      totalMs: Number(data.frames.reduce((sum, f) => sum + (f[key] || 0), 0).toFixed(2)) });
    const intervals = data.frames.map(f => f.interval).filter(Number.isFinite);
    const perRender = key => ({ medianMs: percentile(data.scenery.map(s => s[key]), .5), p95Ms: percentile(data.scenery.map(s => s[key]), .95),
      maxMs: percentile(data.scenery.map(s => s[key]), 1) });
    const other = { frames: data.frames.map(f => ({ ...f, otherMs: Math.max(0, (f.workMs || 0) - (f.sceneMs || f.collectorMs || 0) - (f.mapMs || 0)) })) };
    const otherValues = other.frames.map(f => f.otherMs);
    return { seconds: Number((elapsed / 1000).toFixed(2)), observedFrames: intervals.length,
      rafFPS: intervals.length ? Number((1000 * intervals.length / intervals.reduce((a, b) => a + b, 0)).toFixed(1)) : null,
      rafP95Ms: percentile(intervals, .95),
      renderedRafFPS: Number((data.frames.filter(f => f.rendered).length * 1000 / elapsed).toFixed(1)),
      renderCallsPerSecond: Number(((data.counts.collectorDraws || 0) * 1000 / elapsed).toFixed(1)),
      trackedWork: timing('workMs'), view: timing('viewMs'),
      scene: timing('sceneMs'), collector: timing('collectorMs'), presentationSubmit: timing('presentMs'), map: timing('mapMs'),
      movementInclusive: timing('movementMs'), navigationInclusive: timing('navigationMs'), itemsInclusive: timing('itemsMs'),
      explorationMap: timing('explorationMapMs'), crowdInclusive: timing('crowdMs'), exits: timing('exitsMs'),
      mapKey: timing('mapKeyMs'), terrainBuild: timing('terrainBuildMs'), terrainBlit: timing('terrainBlitMs'),
      otherTrackedWork: { medianMs: percentile(otherValues, .5), p95Ms: percentile(otherValues, .95), totalMs: Number(otherValues.reduce((a, b) => a + b, 0).toFixed(2)) },
      gapsOver50Ms: intervals.filter(ms => ms > 50).length, gapsOver100Ms: intervals.filter(ms => ms > 100).length,
      renderer: { cpu: perRender('cpuMs'), resources: perRender('resourcesMs'), collection: perRender('collectionMs'), voxelSubmit: perRender('voxelSubmitMs') },
      counts: data.counts, first: data.scenery[0] || null, last: data.scenery.at(-1) || null };
  }
  async function install(root, core) {
    if (root.location.hostname !== 'localhost' || root.location.port !== '3000' || root.location.pathname !== '/assets/index.html')
      throw Error('Run this only in the localhost:3000 game tab.');
    if (root.CityFrameTrial?.active?.()) throw Error('Use CityFrameTrial.undo() before loading another frame trial.');
    const presenter = root.webglDungeonRenderer, renderer = presenter?.legacyRenderer || presenter;
    const scene = root.combatGame?.scene?.getScene('CombatScene'), dungeon = root.currentDungeon;
    const blocked = () => root.actionDiceState?.active || root.CombatTacticalUi?.active?.() || root._deathSceneActive || root._gameOver;
    if (blocked()) throw Error('Finish combat or the death screen first.');
    if (!renderer?.gl || !scene?.renderRT || !scene?.actorRT || !dungeon?._geometryStamp || !dungeon.cells ||
        (!dungeon.cityBlocks && !dungeon.sceneSpec?.city)) throw Error('Open the city with its tactical map first.');
    if (presenter !== renderer && (root.webgpuDungeonRenderer !== presenter || root.webglDungeonRendererLegacy !== renderer))
      throw Error('Unrecognized renderer adapter. Nothing installed.');
    const url = name => {
      const value = [...root.document.scripts].map(script => script.src).find(src => new RegExp('/assets/' + name + '\\.js(?:\\?|$)').test(src));
      if (!value || new URL(value).origin !== root.location.origin) throw Error('Loaded game scripts not found.');
      return value;
    };
    const read = async name => { const result = await root.fetch(url(name), { cache: 'no-store' }); if (!result.ok) throw Error('Could not read ' + name); return result.text(); };
    const gameSource = await read('game'), rendererSource = await read('rendererWebGL');
    const servedMap = mapMethod(gameSource), servedView = viewMethod(gameSource);
    if (normalize(scene.redrawCombatRT.toString()) !== servedMap || normalize(root.renderDungeonView.toString()) !== servedView)
      throw Error('Running map or view differs from its served source. Nothing installed.');
    const blitCheck = verifyBlit(root, scene);
    // Retire the previous reversible collector experiment instead of stacking method wrappers.
    if (root.CityRenderTrial?.active?.()) root.CityRenderTrial.undo();
    const original = { world: root.renderDungeonView, movement: root.updateDungeonMovement, map: scene.redrawCombatRT, collector: renderer.renderScene,
      scene: presenter.renderScene, present: presenter._presentSourceToWebGPU };
    const servedCollector = between(rendererSource, 'renderScene() {', '\n  };');
    if (normalize(original.collector.toString()) !== servedCollector) throw Error('Running collector differs from its served source. Nothing installed.');
    let candidate;
    new Function('capture', 'cityProbe', core.patchSource(rendererSource))(value => { candidate = value; }, core.spatialIndex());
    const expectedCollector = between(core.patchSource(rendererSource), 'renderScene() {', '\n  };');
    if (!candidate || normalize(candidate.renderScene.toString()) !== expectedCollector) throw Error('Collector source verification failed.');
    let mode = 'original', active = false, undone = false, busy = false, data = null, frameData = {}, depth = 0, movementDepth = 0, measureRAF = 0, cancelWait = null;
    const count = name => { if (data) {
      data.counts[name] = (data.counts[name] || 0) + 1;
      frameData.counts ||= {}; frameData.counts[name] = (frameData.counts[name] || 0) + 1;
    } };
    const cache = terrainCache(root, count, (name, build) => timed(name, build, null, [])), instrumentation = [];
    const mapCandidate = new Function('cityFrameProbe', 'return ({' + patchMap(servedMap) + '}).redrawCombatRT;')(cache);
    const queue = frameQueue(root, executeWorld, executeMap), results = [];
    const panel = root.document.createElement('section'); panel.id = 'city-frame-trial';
    panel.style.cssText = 'position:fixed;z-index:999999;top:12px;left:330px;max-width:490px;padding:12px;background:#101418f5;color:#f2dfac;border:2px solid #9b8150;font:14px/1.4 monospace';
    const status = root.document.createElement('div'); status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'City frame and walking trial\nCapture Walk: 20 seconds in the selected mode (Optimized by default).\nClose DevTools, then walk/turn normally without entering buildings.\nA/B/A still compares both modes while stationary.\nNo optimization active until you choose a test.';
    const run = root.document.createElement('button'); run.textContent = 'Run A/B/A';
    const toggle = root.document.createElement('button'); toggle.textContent = 'Try Optimized';
    const walk = root.document.createElement('button'); walk.textContent = 'Capture Walk (20s)';
    const undo = root.document.createElement('button'); undo.textContent = 'Undo'; panel.append(status, run, toggle, walk, undo);
    function timed(name, fn, self, args) {
      const start = root.performance.now();
      try { return fn.apply(self, args); }
      finally { if (data) frameData[name] = (frameData[name] || 0) + root.performance.now() - start; }
    }
    function valid() {
      return !undone && !blocked() && root.currentDungeon === dungeon && root.webglDungeonRenderer === presenter &&
        (presenter.legacyRenderer || presenter) === renderer && root.combatGame?.scene?.getScene('CombatScene') === scene;
    }
    function movement(...args) {
      const start = root.performance.now(); movementDepth++; count('movementUpdates');
      try { return timed('movementMs', original.movement, this, args); }
      finally { movementDepth--; if (data) frameData.workMs = (frameData.workMs || 0) + root.performance.now() - start; }
    }
    function requestWorld(...args) {
      count('viewRequests');
      if (!valid()) { restore(); return original.world.apply(this, args); }
      if (mode === 'optimized') return queue.requestWorld(this, args);
      return executeWorld.apply(this, args);
    }
    function requestMap(...args) {
      count('mapRequests');
      if (!valid()) { restore(); return original.map.apply(this, args); }
      if (mode === 'optimized') return queue.requestMap(this, args);
      return executeMap.apply(this, args);
    }
    function executeWorld(...args) {
      if (!valid()) { restore(); return original.world.apply(this, args); }
      const start = root.performance.now(); depth++; count('viewDraws');
      try { return timed('viewMs', original.world, this, args); }
      catch (error) { restore(); root.console.error('City frame trial restored:', error); throw error; }
      finally { depth--; if (data && !movementDepth) frameData.workMs = (frameData.workMs || 0) + root.performance.now() - start; }
    }
    function executeMap(...args) {
      if (!valid()) { restore(); return original.map.apply(this, args); }
      const start = root.performance.now(); count('mapDraws');
      try { return timed('mapMs', mode === 'optimized' ? mapCandidate : original.map, this, args); }
      catch (error) { restore(); root.console.error('Map trial restored:', error); return original.map.apply(this, args); }
      finally { if (data && !depth && !movementDepth) frameData.workMs = (frameData.workMs || 0) + root.performance.now() - start; }
    }
    function collect(...args) {
      const result = timed('collectorMs', candidate.renderScene, this, args);
      if (data) { frameData.rendered = true; const s = this.lastFrameStats; if (s) data.scenery.push({ voxelInstances: s.voxelInstances, drawCalls: s.voxelDrawCalls,
        nearbyLights: s.nearbyTorches, skylineWindows: s.citySkyline?.windows, skylineDraws: s.citySkyline?.batchedDraws,
        cpuMs: s.cpuMs, resourcesMs: s.resourcesMs, collectionMs: s.collectionMs, voxelSubmitMs: s.voxelSubmitMs }); }
      count('collectorDraws'); return result;
    }
    function presentScene(...args) { return timed('sceneMs', original.scene, this, args); }
    function present(...args) { return timed('presentMs', original.present, this, args); }
    function activate() {
      if (active) return;
      if (!valid() || root.renderDungeonView !== original.world || scene.redrawCombatRT !== original.map || renderer.renderScene !== original.collector ||
          (presenter !== renderer && presenter.renderScene !== original.scene)) throw Error('The active view changed. Reload this trial.');
      active = true; root.renderDungeonView = requestWorld; scene.redrawCombatRT = requestMap; renderer.renderScene = collect;
      if (presenter !== renderer) { presenter.renderScene = presentScene; if (typeof original.present === 'function') presenter._presentSourceToWebGPU = present; }
      if (typeof original.movement === 'function') root.updateDungeonMovement = movement;
      for (const [owner, key, metric] of [[root, 'syncDungeonExitNavigation', 'navigationMs'], [root, 'getVisibleSceneObjects', 'itemsMs'],
        [root.DungeonExplorationMap, 'update', 'explorationMapMs'], [root.CityCrowdUi, 'onFrame', 'crowdMs'],
        [root.CityCrowdUi, 'actors', 'crowdMs'], [root.DungeonExits, 'install', 'exitsMs']]) {
        if (typeof owner?.[key] !== 'function') continue;
        const original = owner[key], wrapper = function (...args) { return timed(metric, original, this, args); };
        owner[key] = wrapper; instrumentation.push({ owner, key, original, wrapper });
      }
    }
    function setMode(next) { activate(); queue.flush(); mode = next; cache.clear(); toggle.textContent = next === 'optimized' ? 'Use Collection Only' : 'Try Optimized'; }
    const view = () => [root.dungeonRunId, dungeon._geometryStamp, root.playerPosX, root.playerPosY, root.playerDungeonX, root.playerDungeonY,
      root.playerAngle, root.playerZ, root.dungeonViewShift, renderer.canvas?.width, renderer.canvas?.height,
      presenter.canvas?.width, presenter.canvas?.height, presenter.mode, root.WEBGPU_NATIVE_WORLD, root.RetroGraphics?.fullbright?.()];
    let expected;
    function checkView() {
      if (!valid() || root.document.visibilityState !== 'visible') throw Error('The room, renderer, combat state or visible tab changed. Test stopped.');
      if (JSON.stringify(view()) !== expected) throw Error('Camera, geometry or graphics settings changed. Stay still and run again.');
    }
    async function phase(label, selected) {
      checkView(); setMode(selected); status.textContent = label + ': warming caches. Stay still.';
      await new Promise(resolve => root.setTimeout(resolve, 1500)); checkView();
      data = { counts: {}, frames: [], scenery: [] }; frameData = {};
      const start = root.performance.now(); let last = start;
      status.textContent = label + ': measuring for 6 seconds. Stay still.';
      await new Promise((resolve, reject) => {
        cancelWait = () => reject(Error('Trial cancelled.'));
        function tick(now) {
          try {
            checkView(); data.frames.push({ ...frameData, interval: now - last }); frameData = {}; last = now;
            if (now - start >= 6000) { cancelWait = null; resolve(); return; }
            measureRAF = root.requestAnimationFrame(tick);
          } catch (error) { cancelWait = null; reject(error); }
        }
        measureRAF = root.requestAnimationFrame(tick);
      });
      const row = { phase: label, mode: selected, ...summarize(data, root.performance.now() - start) }; data = null;
      if (row.observedFrames < 10 || !row.counts.collectorDraws || !row.counts.mapDraws) throw Error('Not enough view/map frames for a valid comparison.');
      results.push(row); return row;
    }
    async function benchmark() {
      if (busy || undone) return;
      busy = true; run.disabled = toggle.disabled = walk.disabled = true; results.length = 0; expected = JSON.stringify(view());
      try {
        for (const [label, selected] of [['A1 collection only', 'collection'], ['B frame + terrain', 'optimized'], ['A2 collection only', 'collection']]) await phase(label, selected);
        setMode('collection');
        status.textContent = results.map(row => `${row.phase}: rAF ${row.rafFPS} FPS; renders ${row.renderCallsPerSecond}/s; tracked work ${row.trackedWork.medianMs}ms; map ${row.map.medianMs}ms; draws ${row.counts.mapDraws}/${row.counts.mapRequests}`).join('\n') +
          '\nCollection-only restored. Try Optimized to walk-test, or Undo.\nCPU timings include submission/waits, NOT GPU execution time.';
        root.console.table(results);
        root.navigator?.sendBeacon?.('/debug/dungeon-rendering', new Blob([JSON.stringify({ reason: 'city-frame-trial', geoKey: dungeon.geoKey,
          geometryStamp: dungeon._geometryStamp, backend: presenter === renderer ? 'webgl' : presenter.mode,
          samples: [], trial: { kind: 'frame-coalescing-and-static-map', collectionCacheInBothPhases: true, blitCheck, results } })], { type: 'application/json' }));
      } catch (error) {
        data = null;
        if (!undone) { setMode('collection'); status.textContent = error.message + '\nNo valid comparison. Collection-only renderer active.'; }
        root.console.warn(error.message);
      } finally { busy = false; run.disabled = toggle.disabled = walk.disabled = false; }
    }
    const walking = [];
    function cameraSettings() { return [renderer.canvas?.width, renderer.canvas?.height, presenter.canvas?.width, presenter.canvas?.height,
      presenter.mode, root.WEBGPU_NATIVE_WORLD, root.RetroGraphics?.fullbright?.()]; }
    function position() { return { x: root.playerPosX, y: root.playerPosY, angle: root.playerAngle }; }
    async function captureWalk() {
      if (busy || undone) return;
      busy = true; run.disabled = toggle.disabled = walk.disabled = true;
      const selected = mode === 'collection' ? 'collection' : 'optimized', settings = JSON.stringify(cameraSettings()), initialStamp = dungeon._geometryStamp;
      const session = { counts: {}, frames: [], scenery: [] }, startPosition = position(), stamps = new Set([initialStamp]);
      let start = null, elapsed = 0, distance = 0, movingMs = 0, turningMs = 0, observer = null, abortReason = null;
      const longTasks = [];
      try {
        setMode(selected); status.textContent = 'Warming up for 2 seconds. Then walk and turn normally for 20 seconds.';
        await new Promise(resolve => root.setTimeout(resolve, 2000));
        if (!valid()) throw Error('Room or combat state changed before capture.');
        start = root.performance.now(); data = session; frameData = {};
        if (typeof root.PerformanceObserver === 'function') try {
          observer = new root.PerformanceObserver(list => { for (const entry of list.getEntries())
            if (entry.startTime >= start) longTasks.push({ startMs: Math.round(entry.startTime - start), durationMs: Math.round(entry.duration) }); });
          observer.observe({ type: 'longtask', buffered: false });
        } catch { observer = null; }
        let last = start, previous = position(), lastStatus = -1;
        await new Promise((resolve, reject) => {
          cancelWait = () => reject(Error('Walking capture cancelled.'));
          function tick(now) {
            try {
              if (!valid() || root.document.visibilityState !== 'visible') throw Error('Room, combat state or visible tab changed. Capture stopped.');
              if (JSON.stringify(cameraSettings()) !== settings) throw Error('Graphics settings changed. Capture stopped.');
              const current = position(), interval = now - last, step = Math.hypot(current.x - previous.x, current.y - previous.y);
              if (![current.x, current.y, current.angle, interval, step].every(Number.isFinite)) throw Error('Player position was unavailable.');
              const moving = step > .002, turning = Math.abs(Math.atan2(Math.sin(current.angle - previous.angle), Math.cos(current.angle - previous.angle))) > .002;
              distance += step; if (moving) movingMs += interval; if (turning) turningMs += interval;
              stamps.add(dungeon._geometryStamp); session.frames.push({ ...frameData, interval, moving, turning }); frameData = {};
              elapsed = now - start; last = now; previous = current;
              const seconds = Math.floor(elapsed / 1000);
              if (seconds !== lastStatus) { lastStatus = seconds; status.textContent = 'Walking capture: ' + Math.max(0, 20 - seconds) + ' seconds left. Keep walking/turning in this city.'; }
              if (elapsed >= 20000) { cancelWait = null; resolve(); return; }
              measureRAF = root.requestAnimationFrame(tick);
            } catch (error) { cancelWait = null; reject(error); }
          }
          measureRAF = root.requestAnimationFrame(tick);
        });
      } catch (error) { abortReason = error.message; }
      finally {
        if (observer) { for (const entry of observer.takeRecords()) if (start !== null && entry.startTime >= start)
          longTasks.push({ startMs: Math.round(entry.startTime - start), durationMs: Math.round(entry.duration) }); observer.disconnect(); }
        data = null; root.cancelAnimationFrame(measureRAF); cancelWait = null;
        busy = false; run.disabled = toggle.disabled = walk.disabled = false;
      }
      const moved = session.frames.filter(frame => frame.moving || frame.turning), movingElapsed = moved.reduce((sum, frame) => sum + frame.interval, 0);
      const movingCounts = {};
      for (const frame of moved) for (const [key, value] of Object.entries(frame.counts || {})) movingCounts[key] = (movingCounts[key] || 0) + value;
      const validCapture = !abortReason && elapsed >= 20000 && distance >= 2 && movingMs >= 1000 && !!session.counts.collectorDraws;
      const report = { kind: 'walking-profile', mode: selected, valid: validCapture,
        reason: abortReason || (validCapture ? null : 'Not enough walking was recorded. Walk rather than standing still or only turning.'),
        startPosition, endPosition: position(), distanceTiles: Number(distance.toFixed(2)), movingSeconds: Number((movingMs / 1000).toFixed(2)),
        turningSeconds: Number((turningMs / 1000).toFixed(2)), geometryRevisions: stamps.size, longTaskObservationAvailable: !!observer,
        longTasks, blitCheck, timingNote: 'CPU timings include submission and waits, not GPU execution. Inclusive sections overlap.',
        overall: summarize(session, Math.max(1, elapsed)),
        whileMoving: moved.length ? summarize({ frames: moved, scenery: [], counts: movingCounts }, movingElapsed) : null };
      walking.push(report);
      if (!undone) status.textContent = validCapture ?
        'Walking capture logged: ' + report.overall.renderedRafFPS + ' rendered rAF frames/s; ' + report.distanceTiles + ' tiles; p95 gap ' + report.overall.rafP95Ms + 'ms.\n' + selected + ' remains active. Undo restores everything.' : report.reason + '\nPartial diagnostic logged; try Capture Walk again.';
      root.console.info('City walking capture:', report);
      try { root.navigator?.sendBeacon?.('/debug/dungeon-rendering', new Blob([JSON.stringify({ reason: 'city-walk-trial', geoKey: dungeon.geoKey,
        geometryStamp: dungeon._geometryStamp, backend: presenter === renderer ? 'webgl' : presenter.mode, samples: [], trial: report })], { type: 'application/json' })); }
      catch (error) { root.console.warn('Walking results remain in CityFrameTrial.walking:', error.message); }
      return report;
    }
    function restore() {
      if (undone) return;
      undone = true; data = null; queue.cancel(); cancelWait?.(); cancelWait = null; root.cancelAnimationFrame(measureRAF);
      if (active) {
        if (root.renderDungeonView === requestWorld) root.renderDungeonView = original.world;
        if (root.updateDungeonMovement === movement) root.updateDungeonMovement = original.movement;
        if (scene.redrawCombatRT === requestMap) scene.redrawCombatRT = original.map;
        if (renderer.renderScene === collect) renderer.renderScene = original.collector;
        if (presenter !== renderer && presenter.renderScene === presentScene) presenter.renderScene = original.scene;
        if (presenter._presentSourceToWebGPU === present) presenter._presentSourceToWebGPU = original.present;
      }
      for (const { owner, key, original, wrapper } of instrumentation) if (owner[key] === wrapper) owner[key] = original;
      cache.clear(); root.clearTimeout(expiration); panel.remove();
      root.console.info('Original view, map and renderer restored. No saves or production source changed.');
    }
    run.addEventListener('click', benchmark);
    walk.addEventListener('click', captureWalk);
    toggle.addEventListener('click', () => { if (!busy && !undone) {
      try { setMode(mode === 'optimized' ? 'collection' : 'optimized'); status.textContent = mode + ': walk normally. Room changes/combat stop the trial; Undo restores everything.'; }
      catch (error) { restore(); root.console.error('City frame trial restored:', error); }
    } });
    undo.addEventListener('click', restore);
    const expiration = root.setTimeout(restore, 10 * 60 * 1000);
    root.CityFrameTrial = { results, walking, run: benchmark, captureWalk, undo: restore, active: () => !undone, mode: () => mode };
    root.document.body.appendChild(panel); root.console.info('City walking trial ready. Close DevTools and use Capture Walk (20s).');
    return root.CityFrameTrial;
  }
  if (typeof module === 'object' && module.exports) module.exports = { between, mapMethod, viewMethod, patchMap, terrainCache, verifyBlit, frameQueue, summarize, install };
  else import('/assets/debug/city-collection-core-v3.mjs').then(core => install(window, core)).catch(error => console.error('City frame trial not installed:', error.message));
})();
