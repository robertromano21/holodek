(function(root) {
  'use strict';
  if (!root.DungeonCartography) return;
  let dbPromise, panel, canvas, caption, current, bitmap, bitmapRoom, bitmapRevision = -1;
  let open = false, range = 96, lastPaint = 0, timer = null;
  let viewCenter = null, drag = null;
  let encounterSelect, encounterSignature = '', selectedEncounter = '';
  let mapProjection = null;
  const portraits = new Map();
  function encounterMarkers(dungeon) {
    return [...root.DungeonCartography.landmarks(dungeon, current?.state),
      ...root.DungeonCartography.knownEncounters(dungeon, current?.state, root.DungeonLife?.population(), root.getDungeonLifeContext?.()?.actors || [])];
  }
  function encounterPortrait(marker) {
    const actor = root.getDungeonLifeContext?.()?.actors?.find(a => a.name === marker.name);
    const src = actor?.sprite?.dataUrl || root.resolveKnownCharacterSprite?.(marker.name)?.dataUrl;
    if (!src) return null;
    const previous = portraits.get(marker.name);
    if (previous?.src === src) return previous.image.complete && previous.image.naturalWidth ? previous.image : null;
    const image = new Image(); portraits.set(marker.name, { src, image });
    if (portraits.size > 32) portraits.delete(portraits.keys().next().value);
    image.onload = () => paint(true); image.src = src;
    return null;
  }
  function updateEncounterChoices(markers, key) {
    if (!encounterSelect) return;
    const signature = key + ':' + JSON.stringify(markers.map(m => [m.id, m.label, m.glyph]));
    if (signature === encounterSignature) return;
    encounterSignature = signature;
    encounterSelect.replaceChildren();
    const overview = document.createElement('option'); overview.value = '';
    overview.textContent = `${markers.some(m => m.kind === 'encounter') ? 'Landmarks & Encounters' : 'Landmarks'} (${markers.length})`;
    encounterSelect.appendChild(overview);
    for (const marker of markers) {
      const option = document.createElement('option'); option.value = marker.id;
      option.textContent = `${marker.glyph} ${marker.label}`; encounterSelect.appendChild(option);
    }
    if (selectedEncounter && !markers.some(m => m.id === selectedEncounter)) { selectedEncounter = ''; viewCenter = null; }
    encounterSelect.value = selectedEncounter;
  }
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open('cotg-exploration', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('rooms');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function load(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction('rooms', 'readonly').objectStore('rooms').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function save(key, value) {
    if (!key.startsWith(`${root.dungeonRunId}:`)) return;
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rooms', 'readwrite');
      transaction.objectStore('rooms').put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Map save aborted'));
    });
  }
  async function discardOldRuns(runId) {
    if (!runId) return;
    const database = await db();
    if (runId !== root.dungeonRunId) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rooms', 'readwrite');
      const request = transaction.objectStore('rooms').openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!String(cursor.key).startsWith(`${runId}:`)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
  let warned = false;
  const atlas = root.DungeonCartography.createAtlas({ load, save,
    onLoad(state) { if (current?.state === state) { bitmapRevision = -1; paint(true); } },
    onError(error) { if (!warned) { console.warn('[ExplorationMap] Browser storage unavailable; mapping continues in memory:', error); warned = true; } } });
  function scheduleSave() {
    if (timer) return;
    timer = root.setTimeout(() => { timer = null; atlas.flushAll(); }, 2000);
  }
  function color(cell) {
    const tile = cell.tile || 'floor';
    if (tile === 'door') return '#c8a467';
    if (tile === 'torch') return '#b58249';
    if (tile !== 'floor') return cell.feature === 'pillar' || tile.includes('column') ? '#b5a18b' : '#75564b';
    const height = Number.isFinite(cell.floorHeight) ? cell.floorHeight : 0;
    const light = Math.max(24, Math.min(120, Math.round(60 + height * 2)));
    return cell.roof ? `rgb(${light - 12},${light + 8},${light + 16})` : `rgb(${light + 8},${light + 4},${light - 8})`;
  }
  function paint(force = false) {
    if (!open || !canvas) return;
    const now = Date.now();
    if (!force && now - lastPaint < 120) return;
    lastPaint = now;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!current?.state) { caption.textContent = 'Explore a dungeon to begin mapping.'; return; }
    const { dungeon: d, player, angle, state } = current;
    const encounters = encounterMarkers(d);
    updateEncounterChoices(encounters, state.key);
    if (bitmapRoom !== d || bitmapRevision !== state.revision) {
      bitmap ||= document.createElement('canvas');
      bitmap.width = state.width; bitmap.height = state.height;
      const bc = bitmap.getContext('2d');
      bc.fillStyle = '#080808'; bc.fillRect(0, 0, state.width, state.height);
      for (let byte = 0; byte < state.bits.length; byte++) {
        if (!state.bits[byte]) continue;
        for (let bit = 0; bit < 8; bit++) {
          const i = byte * 8 + bit;
          if (!(state.bits[byte] & (1 << bit)) || i >= state.width * state.height) continue;
          const x = i % state.width, y = Math.floor(i / state.width), cell = d.cells[`${x},${y}`];
          if (cell) { bc.fillStyle = color(cell); bc.fillRect(x, y, 1, 1); }
        }
      }
      bitmapRoom = d; bitmapRevision = state.revision;
    }
    const extent = Math.min(range, Math.max(state.width, state.height)), scale = canvas.width / extent;
    const center = viewCenter || player;
    const left = Math.max(0, Math.min(state.width - extent, center.x - extent / 2));
    const top = Math.max(0, Math.min(state.height - extent, center.y - extent / 2));
    mapProjection = { left, top, scale, markers: encounters };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, -left * scale, -top * scale, state.width * scale, state.height * scale);
    for (const marker of encounters) {
      const x = (marker.x - left) * scale, y = (marker.y - top) * scale;
      if (x < 8 || y < 8 || x > canvas.width - 8 || y > canvas.height - 8) continue;
      ctx.fillStyle = marker.color; ctx.strokeStyle = '#16120d'; ctx.lineWidth = 2;
      if (marker.kind === 'encounter') {
        ctx.fillRect(x - 10, y - 10, 20, 20); ctx.strokeRect(x - 10, y - 10, 20, 20);
        const image = encounterPortrait(marker);
        if (image) ctx.drawImage(image, x - 9, y - 9, 18, 18);
        else { ctx.fillStyle = '#16120d'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText(marker.glyph, x, y + 4); }
        continue;
      }
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.fillStyle = '#16120d'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(marker.glyph, x, y + 4);
    }
    for (const marker of d.roomExits?.markers || []) {
      const x = (marker.x + 0.5 - left) * scale, y = (marker.y + 0.5 - top) * scale;
      if (x < 4 || y < 4 || x > canvas.width - 4 || y > canvas.height - 4) continue;
      ctx.fillStyle = '#a8dbb5'; ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(marker.label, x, y - 7);
      ctx.fillText(marker.label, x, y - 7);
    }
    const x = (player.x - left) * scale, y = (player.y - top) * scale;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = '#fff6d8'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    const target = encounters.find(m => m.id === selectedEncounter);
    const bearing = target ? ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][(Math.round(Math.atan2(target.y - player.y, target.x - player.x) / (Math.PI / 4)) + 8) % 8] : '';
    const targetText = target ? ` | ${target.label}: ${Math.round(Math.hypot(target.x - player.x, target.y - player.y))} tiles ${bearing}${target.kind === 'encounter' ? ' (last seen)' : ''}` :
      ` | ${encounters.filter(m => m.kind !== 'encounter').length} known landmarks, ${encounters.filter(m => m.kind === 'encounter').length} encounters`;
    caption.textContent = `${d.sceneSpec?.source?.roomName || d.geoKey} | N is up | ${Math.round(state.count / (state.width * state.height) * 100)}% mapped${targetText}`;
  }
  function fit() {
    if (!panel || !open) return;
    const bounds = panel.getBoundingClientRect(), zoom = panel.offsetWidth ? bounds.width / panel.offsetWidth : 1;
    const viewportWidth = root.innerWidth / zoom, viewportHeight = root.innerHeight / zoom;
    const width = Math.max(1, Math.min(390, viewportWidth - 16));
    panel.style.width = width + 'px';
    panel.style.left = (viewportWidth - width) / 2 + 'px';
    paint(true);
    const menu = document.getElementById('game-menu-toggle')?.getBoundingClientRect();
    const command = document.getElementById('chatbotcontainer')?.getBoundingClientRect();
    const top = menu ? menu.bottom / zoom + 6 : 42;
    const bottom = command?.height ? Math.min(viewportHeight - 8, command.top / zoom - 8) : viewportHeight - 8;
    const available = Math.max(1, bottom - top);
    // Measure the controls before clipping the panel so the full map fits above input.
    panel.style.maxHeight = 'none';
    canvas.style.maxHeight = 'none';
    const chromeHeight = panel.offsetHeight - canvas.offsetHeight;
    panel.style.maxHeight = available + 'px';
    panel.style.overflowY = 'auto';
    canvas.style.maxHeight = Math.max(0, Math.min(370, available - chromeHeight - 2)) + 'px';
    panel.style.top = (top + Math.max(0, available - panel.offsetHeight) / 2) + 'px';
    paint(true);
  }
  function init() {
    panel = document.getElementById('exploration-map-popup');
    canvas = document.getElementById('exploration-map-canvas');
    caption = document.getElementById('exploration-map-caption');
    if (!panel || !canvas || !caption) return;
    encounterSelect = document.createElement('select'); encounterSelect.id = 'exploration-map-landmarks';
    encounterSelect.setAttribute('aria-label', 'Find a known landmark or encounter');
    panel.querySelector('.exploration-map-tools').appendChild(encounterSelect);
    encounterSelect.addEventListener('change', () => {
      selectedEncounter = encounterSelect.value;
      const marker = current && encounterMarkers(current.dungeon).find(m => m.id === selectedEncounter);
      range = marker ? 96 : 512; viewCenter = marker ? { x: marker.x, y: marker.y } : null; paint(true); fit();
    });
    document.getElementById('exploration-map-close').addEventListener('click', () => toggle(false));
    document.getElementById('exploration-map-zoom-in').addEventListener('click', () => { range = Math.max(24, range / 2); paint(true); });
    document.getElementById('exploration-map-zoom-out').addEventListener('click', () => { range = Math.min(512, range * 2); paint(true); });
    document.getElementById('exploration-map-whole').addEventListener('click', () => { range = 512; viewCenter = null; selectedEncounter = ''; if (encounterSelect) encounterSelect.value = ''; paint(true); });
    document.getElementById('exploration-map-follow').addEventListener('click', () => { range = current?.dungeon.classification?.indoor === false ? 96 : 64; viewCenter = null; selectedEncounter = ''; if (encounterSelect) encounterSelect.value = ''; paint(true); });
    canvas.addEventListener('pointerdown', event => {
      if (!current || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, center: { ...(viewCenter || current.player) } };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || !current) {
        if (mapProjection) {
          const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) * canvas.width / bounds.width,
            y = (event.clientY - bounds.top) * canvas.height / bounds.height;
          const marker = mapProjection.markers.find(m => Math.hypot((m.x - mapProjection.left) * mapProjection.scale - x,
            (m.y - mapProjection.top) * mapProjection.scale - y) <= 12);
          if (marker) root.DungeonAreaTitles?.preview(marker);
        }
        return;
      }
      const extent = Math.min(range, Math.max(current.state.width, current.state.height)), bounds = canvas.getBoundingClientRect();
      viewCenter = { x: Math.max(0, Math.min(current.state.width, drag.center.x - (event.clientX - drag.x) / bounds.width * extent)),
        y: Math.max(0, Math.min(current.state.height, drag.center.y - (event.clientY - drag.y) / bounds.height * extent)) };
      paint(true);
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    root.addEventListener('resize', fit);
    root.addEventListener('pagehide', () => atlas.flushAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) atlas.flushAll(); });
    document.addEventListener('keydown', event => { if (open && event.key === 'Escape') toggle(false); });
  }
  function toggle(value) {
    if (!panel) return;
    open = typeof value === 'boolean' ? value : !open;
    panel.style.display = open ? 'block' : 'none';
    document.getElementById('open-exploration-map-button')?.setAttribute('aria-expanded', String(open));
    const shortcut = document.getElementById('dungeon-map-shortcut');
    shortcut?.setAttribute('aria-expanded', String(open));
    shortcut?.setAttribute('aria-label', open ? 'Close exploration map' : 'Open exploration map');
    if (open) { root.InventoryUi?.toggle(false); fit(); }
    else document.getElementById('game-menu-toggle')?.focus();
  }
  function update(dungeon, player, angle, runId) {
    const state = atlas.get(dungeon, runId);
    if (!state) {
      if (current) { current = null; bitmapRoom = null; bitmapRevision = -1; paint(true); }
      return;
    }
    if (current?.state !== state) {
      if (current) atlas.flush(current.state);
      bitmapRevision = -1;
      viewCenter = null;
      selectedEncounter = ''; encounterSignature = '';
    }
    current = { dungeon, player, angle, state };
    const changed = atlas.reveal(state, dungeon, player, dungeon.classification?.indoor === false ? 8 : 6);
    if (changed.length && bitmapRoom === dungeon && bitmapRevision >= 0) {
      const bc = bitmap.getContext('2d');
      for (const i of changed) {
        const x = i % state.width, y = Math.floor(i / state.width);
        bc.fillStyle = color(dungeon.cells[`${x},${y}`]); bc.fillRect(x, y, 1, 1);
      }
      bitmapRevision = state.revision;
    }
    if (changed.length) scheduleSave();
    paint();
  }
  function reset() {
    atlas.flushAll(); current = null; atlas.clear(); bitmap = null; bitmapRoom = null; bitmapRevision = -1;
    portraits.clear();
    discardOldRuns(root.dungeonRunId).catch(() => {});
    paint(true);
  }
  root.DungeonExplorationMap = { update, toggle, reset, refresh() { paint(true); if (open) fit(); },
    ready: geoKey => !!current?.state?.loaded && (!geoKey || current.dungeon.geoKey === geoKey),
    wasAnnounced: id => !!current?.state?.announcedLandmarks.includes(id),
    observeResident(actor) {
      if (!current?.state?.loaded) return { fresh: false, changed: false };
      const result = root.DungeonCartography.observeResident(current.state, current.dungeon, actor, current.player);
      if (result.changed) { scheduleSave(); paint(true); }
      return result;
    },
    markLandmark(id, announced = false) {
      if (!current?.state || !root.LandmarkCatalog?.catalog(current.dungeon).some(m => m.id === id)) return;
      const state = current.state;
      if (!state.knownLandmarks.includes(id)) state.knownLandmarks.push(id);
      if (announced && !state.announcedLandmarks.includes(id)) state.announcedLandmarks.push(id);
      state.revision++; scheduleSave(); paint(true);
    } };
  document.addEventListener('DOMContentLoaded', init);
})(window);
