(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RoomArtUi = api; document.addEventListener('click', event => api.click(event)); }
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  const cache = new Map(), pending = new Map(), failures = new Map();
  let current = null, serial = 0;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = coordinates => {
    const parts = String(coordinates || '').match(/-?\d+/g);
    return parts?.length === 3 ? parts.map(Number).join(',') : null;
  };
  function idOf(room) { return `${room.runId}:${room.geoKey}:${root.RoomIllustration.hash(room.name + '\n' + room.description)}`; }
  function markup({ coordinates, name, description, runId = root.dungeonRunId }) {
    const geoKey = key(coordinates);
    if (!geoKey || !runId || !name || !description) return '';
    const id = idOf({ geoKey, name, description, runId });
    return `<figure class="room-art" data-room-art="${esc(id)}"><button type="button" class="room-art-open" aria-label="View ${esc(name)} artwork"><span>Grave Master is painting ${esc(name)}...</span></button></figure>`;
  }
  function raster(record) {
    const c = document.createElement('canvas'); c.width = root.RoomIllustration.width; c.height = root.RoomIllustration.height;
    root.RoomIllustration.paint(c.getContext('2d'), record.plan, record.source);
    return { src: root.ArtViewerUi.source(c, false), retroSrc: root.ArtViewerUi.source(c, true) };
  }
  function refresh(id, value, error) {
    let transcriptChanged = false;
    for (const figure of document.querySelectorAll('[data-room-art]')) {
      if (figure.dataset.roomArt !== id) continue;
      const button = figure.querySelector('button');
      if (!button) continue;
      if (value) {
        const src = root.RetroGraphics?.fullbright?.() ? value.retroSrc : value.src;
        if (button.querySelector('img')?.getAttribute('src') === src) continue;
        button.replaceChildren();
        const image = document.createElement('img'); image.src = src; image.alt = value.name; image.loading = 'lazy';
        image.dataset.artModern = value.src; image.dataset.artRetro = value.retroSrc;
        image.width = 320; image.height = 200; button.appendChild(image);
        button.title = 'Click to appreciate the artwork'; button.dataset.artTitle = value.name; button.dataset.artDescription = value.description;
      } else if (error) { button.textContent = 'Room illustration unavailable. Click to retry.'; button.title = error; }
      else continue;
      if (figure.closest('#chatlog')) transcriptChanged = true;
    }
    // The hidden transcript is the save source; keep its visible mirrors consistent.
    if (transcriptChanged) { root.syncGameLogTranscript?.(); root.syncBackgroundChatLog?.(); }
  }
  async function request(room) {
    const id = idOf(room);
    if (pending.has(id)) return pending.get(id);
    if ((failures.get(id) || 0) > Date.now()) return;
    const work = (async () => {
      try {
        const response = await root.fetch('/room-illustration', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: room.runId, geoKey: room.geoKey }) });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'Room illustration unavailable.');
        if (data.runId !== room.runId || data.geoKey !== room.geoKey || root.dungeonRunId !== room.runId ||
            !data.illustration || !/^[a-f0-9]{64}$/.test(data.illustration.source)) return;
        const value = { ...raster(data.illustration), name: room.name, description: room.description, record: data.illustration, verified: true };
        cache.set(id, value); room.onSave?.(data.illustration);
        refresh(id, value);
      } catch (error) {
        failures.set(id, Date.now() + 30000);
        refresh(id, cache.get(id), error.message);
        console.warn('[RoomArt]', error.message);
      } finally { pending.delete(id); }
    })();
    pending.set(id, work);
    return work;
  }
  function visit(options) {
    const room = { ...options, geoKey: key(options.coordinates), runId: root.dungeonRunId };
    if (!room.geoKey || !room.runId || !room.name || !room.description || room.description.length < 20) return;
    const id = idOf(room), entry = !current || current.runId !== room.runId || current.geoKey !== room.geoKey;
    current = room;
    const slot = document.getElementById('room-art-slot');
    if (slot && slot.querySelector('[data-room-art]')?.dataset.roomArt !== id) slot.innerHTML = markup(room);
    if (entry) {
      serial++;
      root.updateChatLog?.(`<br><figure class="room-art" data-room-art="${esc(id)}" data-room-entry="${serial}"><figcaption>${esc(room.name)}</figcaption><button type="button" class="room-art-open" aria-label="View ${esc(room.name)} artwork"><span>Grave Master is painting this room...</span></button></figure><br>`);
    }
    if (!cache.has(id) && room.illustration) {
      try { cache.set(id, { ...raster(room.illustration), name: room.name, description: room.description }); } catch { /* Invalid old art is repaired by the server. */ }
    }
    if (cache.has(id)) {
      const value = cache.get(id);
      if (value.record) room.onSave?.(value.record);
      refresh(id, value);
    }
    else if ((failures.get(id) || 0) > Date.now()) refresh(id, null, 'Try again after the 30-second retry cooldown.');
    if (!cache.get(id)?.verified) void request(room);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    if (failures.size > 128) failures.delete(failures.keys().next().value);
  }
  function click(event) {
    const button = event.target.closest?.('.room-art-open');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const image = button.querySelector('img');
    if (image) root.ArtViewerUi?.open({ src: image.src, title: button.dataset.artTitle || image.alt, description: button.dataset.artDescription || '' });
    else if (current && button.closest('[data-room-art]')?.dataset.roomArt === idOf(current)) void request(current);
  }
  function recolor() {
    const retro = root.RetroGraphics?.fullbright?.(); let changed = false;
    for (const image of document.querySelectorAll('.room-art img[data-art-modern]')) {
      const src = retro ? image.dataset.artRetro : image.dataset.artModern;
      if (src && src !== image.getAttribute('src')) { image.src = src; changed = true; }
    }
    if (changed) { root.syncGameLogTranscript?.(); root.syncBackgroundChatLog?.(); }
  }
  return { key, markup, visit, click, recolor };
});
