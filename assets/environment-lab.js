(function() {
  'use strict';
  const $ = id => document.getElementById(id), keys = new Set();
  let loadId = 0, previous = performance.now(), loaded = false, dirty = true;
  window.combatCharacters = [];
  window.WEBGL_EYE_BACK = 0;
  window.dungeonViewShift = 0;
  window.renderDungeonView = () => { dirty = true; };
  function place(x, y) {
    window.playerPosX = x; window.playerPosY = y;
    window.playerDungeonX = Math.floor(x); window.playerDungeonY = Math.floor(y);
    window.playerZ = window.VoxelCollision.surfaceAt(window.currentDungeon, x, y).height + 0.65;
    dirty = true;
  }
  async function load() {
    const id = ++loadId, kind = $('exhibit').value;
    loaded = false; keys.clear(); $('status').textContent = 'Building exhibit...';
    try {
      const seed = $('lab-seed').disabled ? '' : $('lab-seed').value.trim();
      const response = await fetch(`/environment-lab/${kind}${seed ? `?seed=${encodeURIComponent(seed)}` : ''}`);
      if (!response.ok) throw new Error(`Exhibit unavailable (HTTP ${response.status}). The current server may not have this builder loaded; no server changes were made.`);
      const { dungeon } = await response.json(), textures = {}, meta = {};
      await Promise.all(Object.entries(dungeon.tiles).map(async ([name, tile]) => {
        meta[name] = tile.spriteSpec || {};
        if (!tile.url) return;
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`Could not load ${tile.url}`)); img.src = tile.url; });
        textures[name] = img;
      }));
      if (id !== loadId) return;
      window.currentDungeon = dungeon; window.dungeonTextures = textures; window.dungeonTexturesMeta = meta;
      window.playerAngle = -Math.PI / 2;
      window.TerrainCamera?.reset(); window.dungeonViewShift = 0;
      place(dungeon.start.x + 0.5, dungeon.start.y + 0.5);
      loaded = true;
      $('description').textContent = dungeon.sceneSpec.source.description;
      const lab = dungeon.environmentLab;
      $('lab-seed').disabled = $('new-variant').disabled = !lab;
      if (lab) $('lab-seed').value = lab.seed;
      $('viewpoint').replaceChildren();
      for (const [index, point] of [{ label: 'Spawn', ...dungeon.start }, ...(lab?.viewpoints || [])].entries()) {
        const option = document.createElement('option'); option.value = String(index); option.textContent = point.label;
        $('viewpoint').append(option);
      }
      $('viewpoint').disabled = !lab;
      const floors = Object.values(dungeon.cells).map(c => c.floorHeight || 0);
      const range = `${Math.min(...floors).toFixed(1)} to ${Math.max(...floors).toFixed(1)}`;
      $('composition').textContent = lab ? `Seed: ${lab.seed}. ${dungeon.layout.width} x ${dungeon.layout.height} cells; relief ${range}; ${lab.props.length} voxel props. ${lab.routes.length ? `${lab.routes.length} graded routes.` : `${dungeon.sceneArchitecture.modules.filter(m => m.status === 'built').length} built modules; ${dungeon.sceneRoof.bays.length} supported roof bays.`}` : '';
      $('status').textContent = 'Ready. Select the viewport to move, or click a floor tile on the map.';
      draw();
    } catch (error) { if (id === loadId) $('status').textContent = error.message; }
  }
  function clear(x, y) {
    const d = window.currentDungeon;
    return Math.abs(window.VoxelCollision.surfaceAt(d, x, y).height -
      window.VoxelCollision.surfaceAt(d, window.playerPosX, window.playerPosY).height) <= 1.5 && canStand(x, y);
  }
  function canStand(x, y) {
    const d = window.currentDungeon;
    const standingHeight = window.VoxelCollision.surfaceAt(d, x, y).height;
    if (![-0.2, 0.2].every(dx => [-0.2, 0.2].every(dy => {
      const c = d.cells[`${Math.floor(x + dx)},${Math.floor(y + dy)}`];
      return c && !['wall', 'torch', 'door'].includes(c.tile) && !c.blocked && !c.obstacle &&
        (!c.roof || c.roof.height - standingHeight > 1) && Math.abs((c.floorHeight || 0) - standingHeight) <= 1.5;
    }))) return false;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tileX = cx + dx, tileY = cy + dy, c = d.cells[`${tileX},${tileY}`];
      if (!c || c.tile !== 'pillar' && !c.tile.startsWith('custom_')) continue;
      const voxel = window.VoxelCollision?.testCell(d, tileX, tileY, x, y, 0.2, 0.65, 1.5, standingHeight);
      if (voxel) { if (voxel.blocked) return false; else continue; }
      const spec = d.tiles[c.tile]?.spriteSpec || {};
      const width = spec.baseWidth ?? spec.gridWidth ?? 0.6;
      const column = /pillar|column/.test(c.tile) || spec.profile === 'cylinder';
      const radius = spec.collisionRadius ?? (column ? Math.max(0.08, Math.min(0.18, width * 0.18)) :
        Math.max(0.12, Math.min(0.48, width / 2 - 0.02)));
      if (Math.hypot(x - tileX - 0.5, y - tileY - 0.5) < radius + 0.2) return false;
    }
    return true;
  }
  function draw() {
    const d = window.currentDungeon, renderer = window.webglDungeonRenderer;
    renderer.renderScene();
    if (!renderer.gl || !renderer.program || !renderer.voxelProgram) throw new Error('WebGL2 shader initialization failed; inspect the browser console.');
    const ctx = $('map').getContext('2d'), scale = 280 / d.layout.width;
    ctx.clearRect(0, 0, 280, 280);
    for (const [key, c] of Object.entries(d.cells)) {
      const [x, y] = key.split(',').map(Number);
      const elevation = Math.max(18, Math.min(75, 36 + (c.floorHeight || 0)));
      ctx.fillStyle = c.tile === 'floor' ? (c.roof ? '#3d6170' : c.terrainRole === 'trail' ? '#c5c2a0' :
        d.environmentLab ? `hsl(40, 12%, ${elevation}%)` : '#363733') : c.tile === 'wall' ? '#763a30' : '#c7a34e';
      ctx.fillRect(x * scale, y * scale, Math.max(1, scale - .4), Math.max(1, scale - .4));
      if (c.stairRoute || c.complexExit) {
        ctx.fillStyle = c.complexExit ? '#c6dfb2' : '#ad9570';
        ctx.fillRect(x * scale + 1, y * scale + scale / 2, Math.max(1, scale - 3), 1);
      }
    }
    for (const marker of d.roomExits?.markers || []) {
      ctx.fillStyle = '#9ce3bc'; ctx.font = 'bold 10px Arial';
      ctx.fillText(marker.label, (marker.x + 0.5) * scale, (marker.y + 0.5) * scale);
    }
    const x = window.playerPosX * scale, y = window.playerPosY * scale;
    ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(window.playerAngle) * 10, y + Math.sin(window.playerAngle) * 10); ctx.stroke();
    const actor = { x: window.playerPosX, y: window.playerPosY }, e = d.livingEncounter;
    $('clue').textContent = e ? `${e.clue} (${e.progress.length}/3)` : 'No seal puzzle in this architecture exhibit.';
    $('seals').replaceChildren();
    for (const fixture of e?.fixtures || []) {
      const button = document.createElement('button'); button.textContent = fixture.label;
      button.disabled = e.status === 'complete' || !LivingEnvironments.inReach(d, actor, fixture);
      button.onclick = () => {
        const result = LivingEnvironments.interact(d, { fixtureId: fixture.id, actor, expectedRevision: e.revision });
        $('status').textContent = result.message;
        if (result.ok) { Object.assign(d.cells, result.cells); d.livingEncounter = result.encounter; d._geometryStamp += ':seal'; dirty = true; }
      };
      $('seals').append(button);
    }
    const cell = d.cells[`${window.playerDungeonX},${window.playerDungeonY}`];
    const surface = window.VoxelCollision.surfaceAt(d, window.playerPosX, window.playerPosY);
    $('inspection').textContent = `Tile ${window.playerDungeonX},${window.playerDungeonY}: floor ${surface.height.toFixed(2)}; ${cell?.roof ? `${cell.roof.style} roof at ${cell.roof.height.toFixed(2)}` : 'open sky'}.${cell?.complexExit ? ` ${cell.complexExit} exit marker (inspection only).` : ''}`;
    dirty = false;
  }
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
    if (loaded) {
      const oldX = window.playerPosX, oldY = window.playerPosY;
      const turn = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      if (turn) { window.playerAngle += turn * dt * 1.8; dirty = true; }
      const forward = Number(keys.has('w')) - Number(keys.has('s')), strafe = Number(keys.has('d')) - Number(keys.has('a'));
      if (forward || strafe) {
        const a = window.playerAngle, speed = dt * 2.5 / Math.max(1, Math.hypot(forward, strafe));
        const dx = (Math.cos(a) * forward - Math.sin(a) * strafe) * speed;
        const dy = (Math.sin(a) * forward + Math.cos(a) * strafe) * speed;
        if (clear(window.playerPosX + dx, window.playerPosY)) place(window.playerPosX + dx, window.playerPosY);
        if (clear(window.playerPosX, window.playerPosY + dy)) place(window.playerPosX, window.playerPosY + dy);
      }
      const shift = window.TerrainCamera?.update(window.currentDungeon, {
        x: window.playerPosX, y: window.playerPosY, angle: window.playerAngle,
        vx: dt > 0 ? (window.playerPosX - oldX) / dt : 0, vy: dt > 0 ? (window.playerPosY - oldY) / dt : 0
      }, dt, $('terrain-assist').checked) ?? 0;
      if (Math.abs(shift - window.dungeonViewShift) > .00001) { window.dungeonViewShift = shift; dirty = true; }
      if (dirty) try { draw(); } catch (error) { loaded = false; $('status').textContent = error.message; }
    }
    requestAnimationFrame(frame);
  }
  $('dungeon-container').addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight'].includes(k)) { e.preventDefault(); keys.add(k); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => keys.clear());
  $('dungeon-container').addEventListener('blur', () => keys.clear());
  $('map').onclick = event => {
    if (!loaded) return;
    const r = $('map').getBoundingClientRect(), d = window.currentDungeon;
    const x = Math.floor((event.clientX - r.left) / r.width * d.layout.width);
    const y = Math.floor((event.clientY - r.top) / r.height * d.layout.height);
    if (d.cells[`${x},${y}`]?.tile === 'floor' && canStand(x + 0.5, y + 0.5)) {
      window.TerrainCamera?.reset(); window.dungeonViewShift = 0;
      place(x + 0.5, y + 0.5);
    }
  };
  $('viewpoint').onchange = () => {
    if (!loaded) return;
    const d = window.currentDungeon, point = [d.start, ...(d.environmentLab?.viewpoints || [])][Number($('viewpoint').value)];
    if (!point || !canStand(point.x + .5, point.y + .5)) { $('status').textContent = 'This inspection point is obstructed.'; return; }
    window.playerAngle = point.angle ?? -Math.PI / 2;
    window.TerrainCamera?.reset(); window.dungeonViewShift = 0;
    place(point.x + .5, point.y + .5);
  };
  $('exhibit').onchange = load; $('reset').onclick = load;
  $('lab-seed').onchange = load;
  $('new-variant').onclick = () => {
    $('lab-seed').value = `variant-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
    load();
  };
  $('textures').onchange = () => { window.VOXEL_MATERIAL_TEXTURES = $('textures').checked; dirty = true; };
  load(); requestAnimationFrame(frame);
})();
