(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.HolodekSessionPalette) root.HolodekSessionPalette.install(root).catch(error => console.error('[SessionMusicPalette]', error.message));
  else {
    root.HolodekSessionPalette = api;
    api.install(root).catch(error => console.error('[SessionMusicPalette]', error.message));
  }
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  let controller = null, installing = null;
  function validatePair(pair) {
    if (!pair || typeof pair.runId !== 'string' || !pair.runId || typeof pair.scoreSignature !== 'string' || !pair.scoreSignature ||
        !/^-?\d+,-?\d+,-?\d+$/.test(pair.coords) || !['1x','2x','4x'].includes(pair.clock)) throw Error('Invalid session music manifest.');
    for (const chip of ['8580','10582']) if (typeof pair.variants?.[chip] !== 'string' ||
        !new RegExp('^/sid/palettes/[a-f0-9]{40}-' + chip + '\\.wav$').test(pair.variants[chip])) throw Error('Invalid comparison WAV path.');
    return pair;
  }
  function assertSession(pair, live, room, clock) {
    if (live.runId !== pair.runId || room !== pair.coords || live.music?.composition?.scoreSignature !== pair.scoreSignature)
      throw Error('This comparison belongs to a different room, song or adventure.');
    if (clock !== pair.clock) throw Error('This comparison was rendered at ' + pair.clock + '. Restore that SID clock to compare it.');
  }
  function activeAudio(root, sound) {
    const id = sound.state?.().active;
    return (id && root.document.getElementById(id)) ||
      ['room-music','room-audio'].map(name => root.document.getElementById(name)).find(a => a && !a.paused && a.getAttribute('src')) ||
      root.document.getElementById('room-music');
  }
  function ready(root, audio) {
    return new Promise((resolve, reject) => {
      const clean = () => { root.clearTimeout(timer); audio.removeEventListener('canplay', ok); audio.removeEventListener('error', failed); };
      const ok = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(Error('Comparison audio could not be loaded.')); };
      const timer = root.setTimeout(failed, 30000);
      audio.addEventListener('canplay', ok, { once:true }); audio.addEventListener('error', failed, { once:true });
      audio.load();
    });
  }
  function install(root) {
    if (!installing) installing = installOnce(root).finally(() => { installing = null; });
    return installing;
  }
  async function installOnce(root) {
    if (controller) { controller.open(); return controller; }
    const sound = root.HolodekSfx, panel = root.document.getElementById('holodek-audio-panel'), menu = panel?.querySelector('div');
    if (!sound || !menu) throw Error('Open the running game before loading the music comparison.');
    if (panel.querySelector('[data-k="compositionChip"]')) {
      menu.hidden = false; panel.querySelector('[data-k="compositionChip"]').focus();
      return { native:true }; // the full new panel is already installed
    }
    const response = await root.fetch('/sid/current-audition-pair.json?live=' + Date.now(), { cache:'no-store' });
    if (!response.ok) throw Error('The current comparison manifest is unavailable.');
    const pair = validatePair(await response.json());
    const room = () => root.getDungeonLifeContext?.()?.dungeon?.geoKey || root.currentDungeon?.geoKey || '';
    const clock = () => ({stock:'1x',enhanced:'2x'})[sound.settings.sidMode] || sound.settings.sidMode || '2x';
    async function check() {
      const r = await root.fetch('/get-room-music?coords=' + encodeURIComponent(pair.coords), { cache:'no-store' });
      if (!r.ok) throw Error('Unable to verify the current adventure.');
      assertSession(pair, await r.json(), room(), clock());
    }
    await check();
    const label = root.document.createElement('label'), select = root.document.createElement('select'), status = root.document.createElement('div');
    label.id = 'session-music-palette'; label.appendChild(root.document.createTextNode('Current room music '));
    select.setAttribute('aria-label','Current room music chip');
    for (const [value,text] of [['8580','8580: traditional SID'],['10582','10582: extended registers']]) {
      const option = root.document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
    }
    label.appendChild(select); menu.appendChild(label); menu.appendChild(status);
    status.setAttribute('role','status'); status.style.cssText = 'max-width:260px;white-space:normal;font:11px Georgia,serif;margin-top:4px';
    status.textContent = 'Ready. Current-room music only; ambience and effects are unchanged.';
    const urls = new Map(); let chip = '8580', busy = false, disposed = false;
    const originalRoomShown = sound.roomShown;
    function onRoomShown(key) {
      const result = originalRoomShown?.call(sound, key);
      select.disabled = busy || key !== pair.coords;
      if (key !== pair.coords) status.textContent = 'Comparison available only in its original room.';
      return result;
    }
    sound.roomShown = onRoomShown;
    async function switchTo(want) {
      if (!['8580','10582'].includes(want)) throw Error('Choose 8580 or 10582.');
      if (busy || disposed) throw Error('Music comparison is busy or closed.');
      busy = true; select.disabled = true;
      let audio, previous, changed = false;
      try {
        await check();
        status.textContent = 'Preparing ' + want + '; current audio keeps playing...';
        if (!urls.has(want)) {
          const r = await root.fetch(pair.variants[want]);
          if (!r.ok) throw Error('Comparison WAV unavailable (' + r.status + ').');
          urls.set(want, root.URL.createObjectURL(await r.blob()));
        }
        await check(); // a long download must not switch a different room/run
        if (disposed) throw Error('Music comparison was closed.');
        audio = activeAudio(root, sound);
        if (!audio) throw Error('No current music player found.');
        previous = { src:audio.getAttribute('src'), time:audio.currentTime || 0, paused:audio.paused || !!sound.settings.userPaused };
        audio.autoplay = false; audio.src = urls.get(want); changed = true;
        await ready(root, audio);
        await check();
        if (disposed) throw Error('Music comparison was closed.');
        if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = previous.time % audio.duration;
        if (previous.paused || sound.settings.userPaused) audio.pause(); else await audio.play();
        sound.applyVolumes(); chip = want; select.value = want;
        status.textContent = want + ' music playing at the same song position. Ambience/effects unchanged.';
        return { chip, seconds:audio.currentTime, paused:audio.paused };
      } catch (error) {
        // Never reload the page, restart the sound engine or touch RPG state.
        if (changed && previous?.src && room() === pair.coords && !disposed) {
          try {
            audio.src = previous.src; await ready(root, audio); audio.currentTime = previous.time;
            if (!previous.paused && !sound.settings.userPaused) await audio.play(); else audio.pause();
          } catch {}
        }
        select.value = chip; status.textContent = error.message; throw error;
      } finally { busy = false; select.disabled = disposed || room() !== pair.coords; }
    }
    select.addEventListener('change', () => switchTo(select.value).catch(error => console.warn('[SessionMusicPalette]',error.message)));
    controller = {
      switchTo, open() { menu.hidden = false; select.focus(); },
      state:() => ({ chip, busy, room:pair.coords, runId:pair.runId, scope:'current-room-music-only' }),
      dispose() {
        if (busy) throw Error('Wait for the music switch to finish before removing its control.');
        disposed = true;
        if (sound.roomShown === onRoomShown) sound.roomShown = originalRoomShown;
        label.remove(); status.remove();
        const current = activeAudio(root,sound)?.getAttribute('src');
        for (const url of urls.values()) if (url !== current) root.URL.revokeObjectURL(url);
        controller = null;
      }
    };
    controller.open();
    return controller;
  }
  return { install, validatePair, assertSession, activeAudio,
    open:() => controller?.open(), switchTo:chip => { if (!controller) throw Error('Music comparison is not installed.'); return controller.switchTo(chip); },
    state:() => controller?.state(), dispose:() => controller?.dispose() };
});
