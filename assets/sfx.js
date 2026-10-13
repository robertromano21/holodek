// Holodek-1 SID sound effects and room ambience (see CHANGES-SFX.txt).
// Effects are real SID recordings (frame-by-frame register dumps played through reSIDfp on the build box) shipped as
// small OGG files in /assets/sfx/. They play through WebAudio as an overlay: the room music keeps playing and is only
// ducked a little while an effect sounds. Ambience is 1-3 looping SID noise layers per room, chosen by the music LLM
// (arrangement.ambience) or, for older cached rooms, by keywords in the room description.
(function () {
  'use strict';
  const SFX_DIRS = { '1x': '/assets/sfx/', '2x': '/assets/sfx-enh/', '4x': '/assets/sfx-4x/' }; // Enhanced SID set: same designs rendered at 2x SID clock
  // Per-layer trim that brings each loop to about -28 dBFS mean (the music sits near -26), measured from the OGG files.
  const AMB_TRIM = { wind: 1.0, sandstorm: 1.0, drips: 2.4, fire: 1.7, howls: 1.8, chant: 0.9, rumble: 0.8, water: 0.9 };
  const AMB_TAGS = ['wind', 'sandstorm', 'drips', 'fire', 'howls', 'chant', 'rumble', 'water'];
  const KEY = 'holodekAudioSettings';
  // Defaults = the owner's tuned ♫ panel (Oct 2026): Music 0.20, Effects 0.80, Voices 0.85, Ambience 0.10, Stereo width 1.0, Swap off, SID 2x, Mute off.
  const DEF = { muted: false, sfx: 0.8, amb: 0.1, music: 0.2, width: 1, swapLR: false, voice: 0.85, sidMode: '2x' };
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
  const settings = Object.assign({}, DEF, saved || {}, saved ? {} : { v: 4, touched: {} });
  if (saved) {
    // v2: ambience was ~20 dB under the music; values saved with the old quiet default are reset.
    if ((settings.v || 1) < 2) { if (!(Number(settings.amb) > 1)) settings.amb = 1; settings.v = 2; }
    // v3: separate Voices volume (SID speech + combat cries); older saves get the old 1.0 default
    if (settings.v < 3) { settings.voice = 1; settings.v = 3; }
    // v4: new defaults for players who never moved these sliders (still at the old defaults); customised values are kept
    if (settings.v < 4) { const OLD = { music: 1, amb: 1, voice: 1, sfx: 0.8, width: 1 }; settings.touched = settings.touched || {};
      for (const k in OLD) if (!settings.touched[k] && Number(settings[k]) === OLD[k]) settings[k] = DEF[k];
      settings.v = 4; }
  }
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };
  const sidMode = () => { const m = settings.sidMode; return m === '1x' || m === 'stock' ? '1x' : m === '4x' ? '4x' : '2x'; }; // default 2x (best voice mode) unless a saved choice says otherwise
  // tell the server (voices + music renders) which SID clock this player chose; persisted on both sides
  const postSidMode = () => fetch('/sid-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: sidMode() }) })
    .then(r => r.json()).then(j => console.info('[SidMode]', j)).catch(e => console.warn('[SidMode] server switch failed', e && e.message));
  postSidMode();

  let ctx = null, sfxBus = null, ambBus = null, voiceBus = null, master = null, swapG = null;
  const buffers = new Map(), loading = new Map(), lastPlayed = new Map();
  let voices = 0;
  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    sfxBus = ctx.createGain(); ambBus = ctx.createGain();
    // ambience runs through a limiter so the louder levels (slider up to 2x) never clip
    const ambLimit = ctx.createDynamicsCompressor();
    ambLimit.threshold.value = -4; ambLimit.knee.value = 2; ambLimit.ratio.value = 20; ambLimit.attack.value = 0.003; ambLimit.release.value = 0.25;
    // stereo master: everything -> master -> 2x2 matrix (width fold-down to mono, L/R swap) -> destination
    master = ctx.createGain(); master.channelCount = 2; master.channelCountMode = 'explicit'; master.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    swapG = { LL: ctx.createGain(), LR: ctx.createGain(), RL: ctx.createGain(), RR: ctx.createGain() }; // XY: input X -> output Y
    master.connect(split); split.connect(swapG.LL, 0); split.connect(swapG.LR, 0); split.connect(swapG.RL, 1); split.connect(swapG.RR, 1);
    swapG.LL.connect(merge, 0, 0); swapG.RL.connect(merge, 0, 0); swapG.LR.connect(merge, 0, 1); swapG.RR.connect(merge, 0, 1);
    merge.connect(ctx.destination);
    sfxBus.connect(master); ambBus.connect(ambLimit); ambLimit.connect(master);
    // voices (SID speech + character cries) have their own bus; a soft limiter keeps the 1.5x setting from clipping
    voiceBus = ctx.createGain(); const voiceLimit = ctx.createDynamicsCompressor();
    voiceLimit.threshold.value = -3; voiceLimit.knee.value = 3; voiceLimit.ratio.value = 12; voiceLimit.attack.value = 0.003; voiceLimit.release.value = 0.2;
    voiceBus.connect(voiceLimit); voiceLimit.connect(master);
    applyVolumes();
    return ctx;
  }
  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (loading.has(name)) return loading.get(name);
    const p = fetch(SFX_DIRS[sidMode()] + name + '.ogg').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => new Promise((res, rej) => audio().decodeAudioData(b, res, rej)))
      .then(buf => { buffers.set(name, buf); loading.delete(name); return buf; })
      .catch(e => { loading.delete(name); console.warn('[sfx] load failed', name, e && e.message); return null; });
    loading.set(name, p); return p;
  }
  // --- music ducking: lower the <audio id="room-audio"> volume while effects sound, never pause it ---
  let duckUntil = 0, duckLevel = 1, duckTimer = null;
  // The live page has TWO music elements: index.html's autoplaying <audio id="room-music" src="/sid/current_room.wav">
  // and game.js's #room-audio (created on demand, src replaced per room). Control every media element on the page.
  function musicEls() { return Array.from(document.querySelectorAll('audio, video')); }
  function setMusicVolume() {
    const v = settings.muted ? 0 : Math.max(0, Math.min(1, settings.music * duckLevel));
    for (const a of musicEls()) {
      const fv = v * (a.__fade ?? 1); // per-element crossfade multiplier
      if (Math.abs(a.volume - fv) > 0.005) a.volume = fv;
      if (a.muted !== !!settings.muted) a.muted = !!settings.muted;
    }
  }
  function duck(seconds, depth = 0.7) {
    duckUntil = Math.max(duckUntil, performance.now() + seconds * 1000);
    if (duckTimer) return;
    duckTimer = setInterval(() => {
      const target = performance.now() < duckUntil ? depth : 1;
      duckLevel += (target - duckLevel) * 0.35; // ~150 ms glide in and out
      if (target === 1 && duckLevel > 0.995) { duckLevel = 1; clearInterval(duckTimer); duckTimer = null; }
      setMusicVolume();
    }, 40);
  }
  const SPEC = { // name: [volume, min gap ms, duck]
    step1: [0.55, 150, false], step2: [0.55, 150, false], notice: [0.5, 300, false], dice: [0.7, 120, false],
    hit: [0.8, 70, true], crit: [0.9, 100, true], miss: [0.7, 70, true], hurt: [0.8, 120, true],
    monster_death: [0.85, 250, true], death: [0.9, 2000, true], levelup: [0.85, 2000, true], combat_start: [0.85, 3000, true],
    door: [0.8, 600, true], pickup: [0.75, 200, true], coins: [0.75, 200, true], spell: [0.8, 300, true],
    fireball: [0.85, 300, true], heal: [0.8, 400, true], quest: [0.8, 1500, true], room_enter: [0.6, 1200, false] };
  async function play(name, opts = {}) {
    if (settings.muted || settings.sfx <= 0) return;
    const spec = SPEC[name] || [0.7, 100, true], now = performance.now();
    if (now - (lastPlayed.get(name) || 0) < spec[1] || voices >= 8) return;
    lastPlayed.set(name, now);
    if (!audio() || ctx.state !== 'running') return; // before the first click browsers keep audio locked
    const buf = await load(name); if (!buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = opts.rate || 1;
    g.gain.value = spec[0] * (opts.vol ?? 1);
    const sp = spatialOut(opts.at, opts.pan, buf.duration / (opts.rate || 1) + (opts.delay || 0) + 0.2);
    src.connect(g); g.connect(sp.node);
    voices++; src.onended = () => { voices--; g.disconnect(); sp.done(); };
    src.start(ctx.currentTime + (opts.delay || 0));
    if (spec[2]) duck(buf.duration / (opts.rate || 1) + (opts.delay || 0), name === 'death' || name === 'levelup' ? 0.45 : 0.7);
  }
  function sequence(names, gap = 0.22) { names.slice(0, 4).forEach((n, i) => setTimeout(() => Array.isArray(n) ? play(n[0], n[1] || {}) : play(n), i * gap * 1000)); }

  // --- stereo: Pink-Floyd-style placement around the player's 3D view ---
  // Listener = game.js top-level globals playerPosX/playerPosY/playerAngle (forward = (cos a, sin a), right = a + 90deg).
  // Actors (getDungeonLifeContext().actors) sit at mazeX/mazeY + 0.5 in the same space. Unknown position -> centre.
  const W = () => Math.max(0, Math.min(1.5, Number(settings.width ?? 1)));
  function listener() {
    let x, y, a; try { x = playerPosX; y = playerPosY; a = playerAngle; } catch { x = window.playerPosX; y = window.playerPosY; a = window.playerAngle; }
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(a) ? { x, y, a } : null;
  }
  function actorPos(who) {
    const a = typeof who === 'object' && who ? who : actorByName(who); if (!a) return null;
    const x = Number.isFinite(a.renderMazeX) ? a.renderMazeX : a.mazeX, y = Number.isFinite(a.renderMazeY) ? a.renderMazeY : a.mazeY;
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x + 0.5, y: y + 0.5 } : null;
  }
  function placeOf(at) { // at: actor name | actor | {x,y} | {angle} (world bearing, distant)
    if (!at) return null; if (typeof at === 'object' && Number.isFinite(at.x) && Number.isFinite(at.y) && !('name' in at)) return at;
    return actorPos(at);
  }
  function spatial(at) { // -> { pan -1..1 before width, gain, az (rad, 0 = ahead, + = right), d }
    const L = listener(), p = placeOf(at); if (!L || !p) return { pan: 0, gain: 1, known: false };
    const dx = p.x - L.x, dy = p.y - L.y, d = Math.hypot(dx, dy); if (d < 0.25) return { pan: 0, gain: 1, known: true, az: 0, d };
    const fwd = dx * Math.cos(L.a) + dy * Math.sin(L.a), right = dx * Math.cos(L.a + Math.PI / 2) + dy * Math.sin(L.a + Math.PI / 2);
    const az = Math.atan2(right, fwd), near = Math.min(1, d / 1.2); // very close sources collapse gently toward centre
    let gain = Math.max(0.35, 1 / (1 + Math.max(0, d - 1) / 6)); if (fwd < 0) gain *= 0.88; // behind: slightly duller/quieter
    return { pan: Math.sin(az) * near, gain, known: true, az, d };
  }
  const panVal = p => Math.max(-1, Math.min(1, p * Math.max(1, W())));
  const live = new Set(); // moving sources: re-panned every 50 ms while they sound
  function spatialOut(at, fixedPan, dur, bus) {
    bus = bus || sfxBus;
    if (!ctx || !ctx.createStereoPanner) return { node: bus, done() {} };
    const sp = ctx.createStereoPanner(), g = ctx.createGain(); sp.connect(g); g.connect(bus);
    const s = at ? spatial(at) : { pan: fixedPan || 0, gain: 1 };
    sp.pan.value = panVal(s.pan); g.gain.value = s.gain;
    const rec = { sp, g, at, label: typeof at === 'string' ? at : (at && at.name) || null, pan: s.pan, gain: s.gain, until: ctx.currentTime + (dur || 3) };
    if (at) live.add(rec);
    rec.done = () => { live.delete(rec); setTimeout(() => { try { g.disconnect(); } catch {} }, 300); };
    if (dur) setTimeout(() => rec.done(), (dur + 0.6) * 1000);
    rec.node = sp; return rec;
  }
  // ambience: each layer gets a stable world bearing (per room); turning rotates the image. Subtle (max ~0.6 pan).
  const AMB_PLACE = { wind: [225, 0.6], drip: [80, 0.55], water: [110, 0.45], fire: [320, 0.4], howl: [20, 0.6, 'drift'], wolves: [20, 0.6, 'drift'],
    chant: [0, 0, 'wide'], rumble: [180, 0.15, 'wide'], sand: [270, 0.3, 'wide'], crowd: [0, 0.2, 'wide'], insects: [140, 0.5], birds: [60, 0.5] };
  function ambPlace(tag) { const k = Object.keys(AMB_PLACE).find(k => String(tag).includes(k)); return AMB_PLACE[k] || [hash(String(tag)) % 360, 0.4]; }
  function makeWide(input, dest) { // mid/side: L = M + S, R = M - S, S = HP(delay(M)). L+R = 2M exactly -> mono-safe, no comb
    const merge = ctx.createChannelMerger(2), mid = ctx.createGain(), dl = ctx.createDelay(0.05), hp = ctx.createBiquadFilter(), side = ctx.createGain(), neg = ctx.createGain();
    mid.channelCount = 1; mid.channelCountMode = 'explicit'; dl.delayTime.value = 0.0137; hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.5;
    neg.gain.value = -1; side.gain.value = 0;
    input.connect(mid); mid.connect(merge, 0, 0); mid.connect(merge, 0, 1); mid.connect(dl); dl.connect(hp); hp.connect(side);
    side.connect(merge, 0, 0); side.connect(neg); neg.connect(merge, 0, 1); merge.connect(dest);
    return side;
  }
  function ambOut(tag, roomKey) {
    const pl = ambPlace(tag), sp = ctx.createStereoPanner(); sp.connect(ambBus);
    const base = (pl[0] + (hash(roomKey + tag) % 50) - 25) * Math.PI / 180; // world bearing, varies a little per room
    const wideIn = ctx.createGain(); let side = null; if (pl[2] === 'wide') { side = makeWide(wideIn, sp); } else wideIn.connect(sp);
    return { node: wideIn, place: { sp, side, base, depth: pl[1], drift: pl[2] === 'drift', wide: pl[2] === 'wide', phase: Math.random() * 6 } };
  }
  function ambPanOf(pl, L, t) {
    let b = pl.base; if (pl.drift) b += Math.sin(t * 0.07 + pl.phase) * 1.1; // howls wander slowly in the distance
    return L ? Math.sin(b - L.a) * pl.depth : Math.sin(b) * pl.depth * 0.5;
  }
  const musicWide = new Map(); // element -> side gain
  function attachMusic() {
    if (!ctx || ctx.state !== 'running' || !master) return;
    for (const el of musicEls()) {
      if (el.__hxSrc) continue;
      try { const src = ctx.createMediaElementSource(el); el.__hxSrc = src; musicWide.set(el, makeWide(src, master)); } catch (e) { el.__hxSrc = 'failed'; }
    }
  }
  let lastStereo = 0;
  function stereoTick() {
    if (!ctx || !master) return; const t = ctx.currentTime, L = listener(), w = W();
    attachMusic();
    for (const r of live) { if (t > r.until) { live.delete(r); continue; } const s = spatial(r.at); r.pan = s.pan; r.gain = s.gain;
      r.sp.pan.setTargetAtTime(panVal(s.pan), t, 0.06); r.g.gain.setTargetAtTime(s.gain, t, 0.08); }
    for (const l of ambLayers) { const pl = l.place; if (!pl || l.dead) continue;
      l.pan = ambPanOf(pl, L, t); pl.sp.pan.setTargetAtTime(panVal(l.pan), t, 0.25);
      if (pl.side) pl.side.gain.setTargetAtTime(0.45 * Math.min(1, w), t, 0.2); }
    for (const [el, side] of musicWide) { if (!el.isConnected) { musicWide.delete(el); continue; } side.gain.setTargetAtTime(0.28 * w, t, 0.2); }
    if (swapG) { const m = Math.min(1, w), a = (1 + m) / 2, b = (1 - m) / 2, sw = !!settings.swapLR;
      swapG.LL.gain.setTargetAtTime(sw ? b : a, t, 0.05); swapG.RR.gain.setTargetAtTime(sw ? b : a, t, 0.05);
      swapG.LR.gain.setTargetAtTime(sw ? a : b, t, 0.05); swapG.RL.gain.setTargetAtTime(sw ? a : b, t, 0.05); }
    lastStereo = t;
  }
  setInterval(stereoTick, 50);
  function stereoInfo() {
    return { listener: listener(), width: W(), swapLR: !!settings.swapLR, live: [...live].map(r => ({ who: r.label, pan: +panVal(r.pan).toFixed(3), gain: +r.gain.toFixed(3) })),
      amb: ambLayers.filter(l => l.place).map(l => ({ tag: l.tag, pan: +panVal(l.pan || 0).toFixed(3), wide: l.place.wide })), music: [...musicWide.keys()].map(e => e.id || e.src),
      matrix: swapG && { LL: +swapG.LL.gain.value.toFixed(3), LR: +swapG.LR.gain.value.toFixed(3) } };
  }

  // --- ambience ---
  let ambLayers = [], ambKey = '';
  const ambByRoom = new Map();
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function keywordAmbience(text) {
    const t = String(text || '').toLowerCase(), out = [];
    const add = (tag, level) => { if (!out.some(o => o.tag === tag)) out.push({ tag, level }); };
    if (/sandstorm|sand|dust|desert|wasteland|tartarus/.test(t)) add('sandstorm', 0.6);
    if (/wind|gust|mountain|cliff|ledge|open sky|peak|howling/.test(t)) add('wind', 0.6);
    if (/torch|fire|flame|brazier|hearth|forge|lava|ember|burning/.test(t)) add('fire', 0.6);
    if (/chant|choir|prayer|temple|shrine|altar|monk|ritual|chapel/.test(t)) add('chant', 0.5);
    if (/drip|cave|cavern|damp|wet|well|grotto|sewer/.test(t)) add('drips', 0.7);
    if (/river|stream|water|fountain|waterfall|lake|pool|styx/.test(t)) add('water', 0.6);
    if (/wolf|wolves|hound|howl|beast|wild|forest|undead|ghoul|banshee/.test(t)) add('howls', 0.5);
    if (/rumble|tremor|deep|abyss|chasm|lava|volcan|throne|hades|crypt|tomb/.test(t)) add('rumble', 0.55);
    if (!out.length) add('rumble', 0.4), add('drips', 0.4);
    return out.slice(0, 3);
  }
  function normalizeAmb(list) {
    return (Array.isArray(list) ? list : []).map(x => typeof x === 'string' ? { tag: x, level: 0.6 } : x)
      .filter(x => x && AMB_TAGS.includes(x.tag)).slice(0, 3)
      .map(x => ({ tag: x.tag, level: Math.max(0.15, Math.min(1, Number(x.level) || 0.6)) }));
  }
  // --- key-aware pitched ambience ---
  // With the room's song JSON known, the pitched layers follow the music: chant becomes a tonic+fifth drone (amb_drone_A)
  // and drips/howls become single notes (amb_drip_A, amb_howl_A) picked from the song's scale. All stems are in A and are
  // transposed with playbackRate by at most +-6 semitones; key changes between movements glide smoothly. The key is read
  // from plan.form ("Name [F minor, ..." and "transition -> G minor") synced to the playing music's currentTime, so
  // rewind/fast-forward/pause follow. Without song data the original pitched loops play.
  const MODES = { major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const KEYED = { chant: 'amb_drone_A', drips: 'amb_drip_A', howls: 'amb_howl_A' };
  const pcOf = k => { const m = String(k || '').match(/^([A-G])([#b]?)/); return m ? (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : null; };
  const wrap = n => { n = ((n % 12) + 12) % 12; return n > 5 ? n - 12 : n; }; // -6..+5 semitones from A
  function keySegments(dur) {
    const form = song && song.plan && song.plan.form, bars = song && song.plan && song.plan.bars;
    if (!form || !bars || !dur) return [];
    let bar = 0; const out = [];
    for (const seg of String(form).split('||').map(x => x.trim())) {
      const t = seg.match(/^transition\s*->\s*([A-G][#b]?)\s+(\w+)/i), m = seg.match(/^.*?\[\s*([A-G][#b]?)\s+(\w+)[^\]]*?(\d+)\s*bars/);
      const n = t ? 2 : m ? Number(m[3]) : 0; if (!n) continue;
      const k = t || m, name = t ? 'transition' : seg.split('[')[0];
      const role = t ? 'transition' : /danger/i.test(name) ? 'danger' : /reflect/i.test(name) ? 'reflect' : /mortacia/i.test(name) ? 'mortacia' : 'room';
      out.push({ start: bar / bars * dur, end: (bar + n) / bars * dur, startBar: bar, endBar: bar + n, role, pc: pcOf(k[1]), scale: MODES[k[2].toLowerCase()] ? k[2].toLowerCase() : 'minor' });
      bar += n;
    }
    return out.filter(x => x.pc !== null);
  }
  function songKeyNow() {
    const a = music(); if (!song) return null;
    const dur = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : song.plan && song.plan.seconds;
    const segs = keySegments(dur); if (!segs.length) { const pc = pcOf(song.key); return pc === null ? null : { pc, scale: MODES[song.scale] ? song.scale : 'minor' }; }
    const t = a ? a.currentTime : 0;
    return segs.find(x => t >= x.start && t < x.end) || segs[0];
  }
  let keyNow = null, lastMusicT = 0;
  function ambKeyTick() {
    if (!ctx || !ambLayers.some(l => l.keyed)) return;
    const k = songKeyNow(); if (!k) return;
    const a = music(), t = a ? a.currentTime : 0, jumped = Math.abs(t - lastMusicT) > 2; lastMusicT = t;
    if (!keyNow || keyNow.pc !== k.pc) {
      const rate = Math.pow(2, wrap(k.pc - 9) / 12), now = ctx.currentTime, glide = !keyNow || jumped ? 0.6 : 4; // movement change: slow glide
      for (const l of ambLayers) if (l.keyed === 'drone' && l.src) {
        const p = l.src.playbackRate; p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(rate, now + glide);
      }
    }
    keyNow = k;
  }
  const pendingNotes = []; // notes scheduled ahead; cancelled on seek / mode switch so nothing lands off-grid
  function fireNote(l, k, when, deg, gain) {
    const scale = MODES[k && k.scale] || MODES.minor, semis = wrap((k ? k.pc : 9) + scale[deg % 7] - 9);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = l.buf; src.playbackRate.value = Math.pow(2, semis / 12); g.gain.value = gain * l.level;
    src.connect(g); g.connect(l.g); const at = Math.max(when, ctx.currentTime); src.start(at);
    const rec = { src, at }; pendingNotes.push(rec); src.onended = () => { g.disconnect(); const i = pendingNotes.indexOf(rec); if (i >= 0) pendingNotes.splice(i, 1); };
  }

  // --- ambience rhythm ---
  // While the music plays (and the song JSON is known), ambience follows the song's grid. One bar = audio duration /
  // plan.bars, in 16 sixteenths, synced to the music element's currentTime through a smoothed audio-clock offset.
  // Events are scheduled 0.7 s ahead on the WebAudio clock:
  //   drips:    offbeat/syncopated sixteenth patterns per movement (dense in Danger, sparse in Reflection);
  //   howls:    on the downbeat of each phrase (8 bars, 4 in Danger);
  //   chant:    a swell on every bar (one chord per bar in these progressions);
  //   noise layers: gain + low-pass swells shaped to the phrase (rise over 3 bars, hold, recede over the last 2),
  //             with intensity by movement (Danger strong, Reflection gentle).
  // When the music is paused, or there is no song data, a free-running formula plays instead: random gusts and
  // random event timing.
  const DRIP_PATTERNS = { room: [[2, 6, 10, 14], [2, 7, 10, 14], [6, 14], [2, 6, 11, 14]],
    danger: [[2, 3, 6, 7, 10, 11, 14], [2, 6, 7, 10, 14, 15], [1, 2, 6, 10, 11, 14], [2, 5, 6, 10, 13, 14]],
    reflect: [[6], [14], [], [10]], mortacia: [[6, 14], [2, 14], [6, 11], [14]], transition: [[2, 6, 10, 14]] };
  const INTENSITY = { danger: 1.35, room: 1, mortacia: 0.9, reflect: 0.6, transition: 0.8 };
  const phraseEnv = x => x < 0.375 ? 0.35 + 0.65 * x / 0.375 : x < 0.75 ? 1 : 1 - 0.65 * (x - 0.75) / 0.25;
  let clkOff = null, schedTo = null, rhythmMode = '', gridSig = '', dripCount = 0;
  const evLog = [];
  function rampTo(param, v0, v1, t0, t1) { param.linearRampToValueAtTime(v1, t1); } // consecutive ramps are continuous (v1 of one bar = v0 of next), so no setValueAtTime: after a mode switch/seek the first ramp glides from the held value, no jump
  function resetAutomation(now) {
    for (const r of pendingNotes.slice()) if (r.at > now + 0.005) { try { r.src.stop(); } catch {} }
    for (let i = evLog.length - 1; i >= 0 && evLog[i].when > now + 0.005; i--) evLog[i].cancelled = true;
    for (const l of ambLayers) for (const p of [l.mod && l.mod.gain, l.filt && l.filt.frequency]) if (p) { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
  }
  function gridEvents(n, when, segs, spb, k) {
    const bar = Math.floor(n / 16), pos = n % 16, seg = segs.find(x => bar >= x.startBar && bar < x.endBar) || segs[0];
    const rel = bar - seg.startBar, role = seg.role, phraseLen = role === 'danger' ? 4 : 8;
    for (const l of ambLayers) {
      if (l.dead) continue;
      if (l.tag === 'drips' && l.keyed === 'note') {
        const pats = DRIP_PATTERNS[role] || DRIP_PATTERNS.room, pat = pats[rel % pats.length];
        if (pat.includes(pos)) { fireNote(l, seg, when, [4, 2, 0, 2, 4, 6, 4, 2][dripCount++ % 8], pos % 4 === 2 ? 0.55 : 0.4); evLog.push({ kind: 'drip', when, n }); }
      } else if (l.tag === 'howls' && l.keyed === 'note' && pos === 0 && rel % phraseLen === 0) {
        fireNote(l, seg, when, [0, 4, 0, 2][(rel / phraseLen) % 4], 0.75); evLog.push({ kind: 'howl', when, n });
      } else if (l.keyed === 'drone' && l.mod && pos === 0) {
        const p = l.mod.gain; p.linearRampToValueAtTime(0.6, when); p.linearRampToValueAtTime(1, when + spb * 0.35); p.linearRampToValueAtTime(0.6, when + spb * 0.95);
        evLog.push({ kind: 'swell', when, n });
      } else if (l.cont && pos === 0) {
        const I = INTENSITY[role] || 1, x0 = (rel % phraseLen) / phraseLen, x1 = (rel % phraseLen + 1) / phraseLen;
        const e0 = phraseEnv(x0) * I, e1 = phraseEnv(x1) * I;
        rampTo(l.mod.gain, e0, e1, when, when + spb);
        rampTo(l.filt.frequency, 500 + 3000 * Math.min(1, e0), 500 + 3000 * Math.min(1, e1), when, when + spb);
        if (l === ambLayers.find(x => x.cont)) evLog.push({ kind: 'phrase', when, n, x0: +x0.toFixed(3), e0: +e0.toFixed(2) });
      }
    }
    if (evLog.length > 400) evLog.splice(0, evLog.length - 300);
  }
  function rhythmTick() {
    if (!ctx || !ambLayers.length) return;
    const a = music(), now = ctx.currentTime, k = songKeyNow();
    const dur = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    const segs = song && dur ? keySegments(dur) : [], bars = song && song.plan && song.plan.bars;
    const audible = !settings.muted && Number(settings.music) > 0.02 && a && !a.muted; // muted/silent music -> ambience runs its own free rhythm
    const playing = audible && !a.paused && !a.seeking && segs.length && bars && !crossfading;
    const mode = playing ? 'grid' : 'free';
    if (mode !== rhythmMode) { resetAutomation(now); rhythmMode = mode; schedTo = null; clkOff = null; }
    if (playing) {
      const spb = dur / bars, step = spb / 16, tm = a.currentTime, off = now - tm, sig = (a.currentSrc || '') + '|' + dur;
      if (clkOff === null || Math.abs(off - clkOff) > 0.08) clkOff = off; else clkOff += (off - clkOff) * 0.2; // smoothed music->audio clock
      if (sig !== gridSig || schedTo === null || schedTo < tm - 0.15 || schedTo > tm + 1) { // new song, seek, rewind, FF
        if (schedTo !== null) resetAutomation(now);
        gridSig = sig; schedTo = tm;
      }
      const to = tm + 0.7;
      const emit = (t0, t1, add) => { for (let n = Math.floor(t0 / step + 1e-6) + 1; n * step <= t1 + 1e-9; n++) {
        const when = clkOff + n * step + add; if (when >= now - 0.01) gridEvents(n, when, segs, spb, k); } };
      if (to > dur) { emit(schedTo, dur, 0); emit(-step, to - dur, dur); schedTo = to - dur; } // loop wrap
      else { emit(schedTo, to, 0); schedTo = to; }
      return;
    }
    // free-running: organic gusts and random events (paused music or no song data)
    for (const l of ambLayers) {
      if (l.dead) continue;
      if (l.cont && now >= (l.gustAt || 0)) {
        const v = 0.35 + Math.random() * 0.9, d = 2 + Math.random() * 4;
        l.mod.gain.cancelScheduledValues(now); l.mod.gain.setValueAtTime(l.mod.gain.value, now); l.mod.gain.linearRampToValueAtTime(v, now + d);
        l.filt.frequency.cancelScheduledValues(now); l.filt.frequency.setValueAtTime(l.filt.frequency.value, now); l.filt.frequency.linearRampToValueAtTime(500 + 2800 * Math.min(1, v), now + d);
        l.gustAt = now + d + Math.random() * 3;
      } else if (l.keyed === 'drone' && l.mod && now >= (l.gustAt || 0)) {
        const d = 3 + Math.random() * 4; l.mod.gain.setValueAtTime(l.mod.gain.value, now); l.mod.gain.linearRampToValueAtTime(0.6 + Math.random() * 0.4, now + d); l.gustAt = now + d;
      } else if (l.keyed === 'note' && now >= (l.nextAt || 0)) {
        fireNote(l, k, now, l.tag === 'howls' ? [0, 4, 0, 2][Math.floor(Math.random() * 4)] : Math.floor(Math.random() * 7), l.tag === 'howls' ? 0.75 : 0.55 * (0.5 + Math.random() * 0.5));
        l.nextAt = now + (l.tag === 'howls' ? 7 + Math.random() * 9 : 0.8 + Math.random() * 2.7);
      }
    }
  }
  setInterval(() => { ambKeyTick(); rhythmTick(); }, 100);

  async function setAmbience(list, roomKey) {
    const keyed = !!songKeyNow();
    const layers = normalizeAmb(list), sig = roomKey + '|' + layers.map(l => l.tag + l.level).join(',') + '|' + (keyed ? 'k:' + (song.title || '') : '');
    if (sig === ambKey) return; ambKey = sig;
    if (!audio()) return;
    const t = ctx.currentTime, old = ambLayers; ambLayers = [];
    old.forEach(l => { l.dead = true; try { l.g.gain.cancelScheduledValues(t); l.g.gain.setValueAtTime(l.g.gain.value, t); l.g.gain.linearRampToValueAtTime(0, t + 2.5); if (l.src) l.src.stop(t + 2.6); setTimeout(() => { try { l.g.disconnect(); } catch {} }, 3000); } catch {} });
    keyNow = null;
    const h = hash(roomKey);
    for (const [i, l] of layers.entries()) {
      if (keyed && KEYED[l.tag]) {
        const kb = await load(KEYED[l.tag]); if (!kb || ambKey !== sig) continue;
        const g = ctx.createGain(), mod = ctx.createGain(), ao = ambOut(l.tag, roomKey); g.gain.value = 0; g.connect(mod); mod.connect(ao.node);
        g.gain.linearRampToValueAtTime((l.tag === 'chant' ? AMB_TRIM.chant : 1) * l.level, ctx.currentTime + 3);
        if (l.tag === 'chant') {
          const k = songKeyNow(), src = ctx.createBufferSource(); src.buffer = kb; src.loop = true;
          src.playbackRate.value = k ? Math.pow(2, wrap(k.pc - 9) / 12) : 1; src.connect(g); src.start(ctx.currentTime, ((h >>> 3) % 997) / 997 * kb.duration);
          mod.gain.value = 0.8; ambLayers.push({ src, g, mod, keyed: 'drone', tag: l.tag, place: ao.place });
        } else ambLayers.push({ g, mod, keyed: 'note', tag: l.tag, place: ao.place, buf: kb, level: l.level, nextAt: ctx.currentTime + 0.5 + Math.random() * 2 });
        continue;
      }
      const buf = await load('amb_' + l.tag); if (!buf || ambKey !== sig) continue;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = 0.9 + ((h >> (i * 5)) & 31) / 155; // each room gets its own pitch/speed of the layer (0.9-1.1)
      // continuous layer: src -> g (fade/level) -> mod (phrase swells / gusts) -> low-pass (brightens with the swell)
      const mod = ctx.createGain(), filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2500; filt.Q.value = 0.7; mod.gain.value = 0.8;
      const ao = ambOut(l.tag, roomKey); g.gain.value = 0; src.connect(g); g.connect(mod); mod.connect(filt); filt.connect(ao.node);
      src.start(ctx.currentTime, ((h >>> 3) % 997) / 997 * buf.duration); // >>> keeps the offset positive
      g.gain.linearRampToValueAtTime((AMB_TRIM[l.tag] || 1) * l.level, ctx.currentTime + 3);
      ambLayers.push({ src, g, mod, filt, cont: true, tag: l.tag, place: ao.place });
    }
  }
  function roomText() { return window.lastServerGameConsole || window.latestUpdatedData?.roomDescription || ''; }
  function applyRoomAmbience(roomKey) {
    const tags = ambByRoom.get(roomKey) || keywordAmbience(roomText());
    setAmbience(tags, roomKey);
  }

  function setBus(bus, v) {
    if (!bus || !ctx) return;
    const t = ctx.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(v, t); bus.gain.value = v;
  }
  function applyVolumes() {
    setBus(sfxBus, settings.muted ? 0 : Number(settings.sfx) || 0);
    setBus(ambBus, settings.muted ? 0 : Number(settings.amb) || 0);
    setBus(voiceBus, settings.muted ? 0 : Number(settings.voice ?? 1));
    setMusicVolume();
  }

  // --- text classification (combat log lines and narrative) ---
  const recentLines = new Map();
  function fresh(line) {
    const now = Date.now(); for (const [k, t] of recentLines) if (now - t > 5000) recentLines.delete(k);
    if (recentLines.has(line)) return false; recentLines.set(line, now); return true;
  }
  function combatSounds(text) {
    const out = [];
    for (const raw of String(text || '').split(/\n|<br\s*\/?>/i)) {
      const line = raw.replace(/<[^>]+>/g, '').trim(); if (!line || !fresh(line)) continue;
      try { combatVoices(line); } catch (e) {}
      const who = namesIn(line), tgt = /is killed by|is slain|dies\b|falls before|is destroyed|has been defeated|takes \d+ damage/i.test(line) ? who[0] : (who[1] || who[0]);
      const n0 = out.length;
      if (/is killed by|is slain|dies\b|falls before|is destroyed|has been defeated/i.test(line)) out.push('monster_death');
      else if (/critical/i.test(line)) out.push('crit');
      else if (/\bhits\b.*\bfor \d+|takes \d+ damage/i.test(line)) out.push(/fire|flame|burn|lightning/i.test(line) ? 'fireball' : 'hit');
      else if (/\bmisses\b|\bdodges\b|\bparries\b/i.test(line)) out.push('miss');
      else if (/\bcasts?\b|\bspell\b|\bmagic missile\b/i.test(line)) out.push(/fire|flame|burn|lightning|blast/i.test(line) ? 'fireball' : 'spell');
      else if (/\bheal(s|ed)?\b|\bcure[sd]?\b|\brestores?\b/i.test(line)) out.push('heal');
      else if (/all monsters have been defeated|victory/i.test(line)) out.push('quest');
      if (out.length > n0 && tgt && out[n0] !== 'quest') out[n0] = [out[n0], { at: tgt }];
    }
    if (out.length) sequence(out);
  }
  function narrativeSounds(text) {
    const t = String(text || '').slice(-1500);
    if (/\b(door|gate|portcullis|hatch|lid)\b[^.]{0,40}\b(open|opens|opened|creaks|swings|unlock)|\b(open|opens|opened|unlock|unlocks|unlocked|push|pushes)\b[^.]{0,30}\b(door|gate|portcullis|hatch|chest|lid)\b/i.test(t)) play('door', { pan: (Math.random() - 0.5) * 0.3 });
    if (/\b(gold|coins?|gems?|jewels?|treasure)\b/i.test(t) && /\b(take|takes|took|pick|picks|picked|pocket|collect|loot|find|found)\b/i.test(t)) play('coins', { pan: (Math.random() - 0.5) * 0.3 });
    else if (/\b(you|she|he|mortacia)\b[^.]{0,20}\b(pick(s|ed)? up|take(s)?|took|grab(s|bed)?|pocket(s|ed)?|obtain(s|ed)?)\b/i.test(t)) play('pickup', { pan: (Math.random() - 0.5) * 0.3 });
    if (/\b(cast|casts|incantation|spell|arcane|conjure|summon)/i.test(t)) play(/fire|flame|burn|lightning/i.test(t) ? 'fireball' : 'spell');
    if (/\b(heal|healed|heals|healing|restored|cured)\b/i.test(t)) play('heal');
    if (/\b(level up|levels up|gains? a level|reached level)\b/i.test(t)) play('levelup');
  }
  let chatLen = 0, chatTimer = null;
  function watchChat() {
    const el = document.getElementById('chatlog'); if (!el) return setTimeout(watchChat, 1000);
    chatLen = el.textContent.length;
    new MutationObserver(() => { clearTimeout(chatTimer); chatTimer = setTimeout(() => {
      const txt = el.textContent; if (txt.length <= chatLen) { chatLen = txt.length; return; }
      const added = txt.slice(chatLen); chatLen = txt.length;
      if (added.length < 4000) { narrativeSounds(added); chatVoices(added); } // ignore wholesale log restores
    }, 120); }).observe(el, { childList: true, subtree: true, characterData: true });
  }

  // --- character voices v2: per-character SID-style voice synthesis (WebAudio) ---
  // Each character gets a voice "suite" derived from their data (getDungeonLifeContext().actors: sprite.spec race/class/sex/
  // level/traits, personality/voice/history/motivation/job). One continuous SID-like voice per utterance (pulse/saw/tri
  // oscillators sharing one pitch control, sub-octave rasp AM, noise breath, two resonant formant band-passes, small room
  // tail). Every gain/pitch/formant move is a setTargetAtTime glide, so there are no clicks. Doom-style sets per character:
  // sight, pain, death, attack, plus signature sounds (laugh, sigh, grunt, hiss); every play is pitch-varied.
  const VOWELS = { a: [730, 1090], e: [530, 1840], i: [300, 2200], o: [570, 840], u: [330, 870], ae: [660, 1720], uh: [520, 1190] };
  const actorByName = name => (window.getDungeonLifeContext?.()?.actors || []).find(x => x && x.name === name);
  function voiceProfile(nameOrActor) {
    const a = typeof nameOrActor === 'object' && nameOrActor ? nameOrActor : (actorByName(nameOrActor) || { name: nameOrActor });
    const name = String(a.name || ''), sp = a.sprite?.spec || {}, tr = sp.traits || {};
    const race = sp.race || a.race || '', cls = sp.class || a.class || '', sex = sp.sex || a.sex || '';
    const desc = [name, race, cls, a.job, a.activity].filter(Boolean).join(' '), pers = [a.personality, a.voice, a.motivation, a.history].filter(Boolean).join(' ');
    const all = desc + ' ' + pers, hr = i => (hash(name + '#' + i) % 1000) / 1000, has = rx => rx.test(all);
    let kind = 'humanoid';
    if (/mortacia|suzerain|\bking\b|\bqueen\b|\blord\b|emperor|empress|overlord|archon|goddess|\bgod\b|monarch|tyrant/i.test(desc) || (sp.level || 0) >= 18) kind = 'regal';
    else if (/wraith|ghost|spirit|spectr|shade|lich|skelet|zombie|revenant|banshee|undead|vampir|ghoul|wight|phantom|bonecaller|necro|mummy/i.test(desc) || tr.bodyPlan === 'spectral' || (tr.translucency || 0) >= 0.35) kind = 'undead';
    else if (/wolf|bear|beast|hound|jackal|drake|dragon|wyrm|serpent|spider|scorpion|\brat\b|boar|lion|hyena|vulture|\bbat\b|worm|basilisk|hydra|chimera|manticore/i.test(desc) && (a.type === 'monster' || sp.isMonster || tr.head === 'beast')) kind = 'beast';
    const fem = /^f/i.test(sex), male = /^m/i.test(sex);
    const size = { tiny: 1.45, small: 1.2, medium: 1, large: 0.78, huge: 0.62, giant: 0.55 }[tr.size] || 1;
    const build = /heavy|stocky|massive|bulky/i.test(tr.build || '') ? 0.92 : /slender|thin|wiry/i.test(tr.build || '') ? 1.06 : 1;
    let f0 = (fem ? 200 : male ? 112 : 145) * size * build * (0.88 + hr(1) * 0.24) * (kind === 'regal' ? 0.8 : kind === 'beast' ? 0.62 : 1);
    if (has(/\b(old|elder|ancient|aged)\b/i)) f0 *= 0.93;
    const fs = (fem ? 1.12 : 1) * Math.sqrt(size) * (0.94 + hr(2) * 0.12) * (kind === 'beast' ? 0.8 : 1);
    const mix = kind === 'regal' ? { pulse: 0.45, saw: 0.55, tri: 0.35 } : kind === 'undead' ? { pulse: 0.12, saw: 0.05, tri: 0.35 }
      : kind === 'beast' ? { pulse: 0.3, saw: 0.8, tri: 0.2 } : { pulse: 0.7, saw: 0.15 + hr(3) * 0.3, tri: 0.25 };
    const breath = Math.min(1, (kind === 'undead' ? 0.75 : 0.06 + hr(5) * 0.12) + (has(/\b(old|elder|weary|frail|tired|wounded|dying)\b/i) ? 0.15 : 0) + (tr.translucency || 0) * 0.4);
    const rasp = Math.min(0.9, (kind === 'beast' ? 0.65 : 0) + (tr.fangs || tr.tusks ? 0.2 : 0) + hr(6) * 0.08
      + (has(/\b(orc|ogre|troll|goblin|gnoll|dwarf|brute|barbarian|gruff|harsh|growl|rough|gravel|smok)/i) ? 0.25 : 0) + (kind === 'regal' ? 0.08 : 0));
    const nervous = has(/nervous|anxious|skittish|jittery|frighten|timid/i);
    const vib = (kind === 'regal' ? 14 : 4 + hr(7) * 6) + (has(/\b(old|elder|ancient|frail)\b/i) ? 10 : 0) + (nervous ? 6 : 0); // cents
    let rate = kind === 'regal' ? 3.3 : kind === 'undead' ? 3.8 : kind === 'beast' ? 3.6 : 4.6 + hr(9) * 1.1;
    if (has(/clipped|practical|terse|curt|brisk|quick|eager|excit|chatter/i) || nervous) rate += 0.9;
    if (has(/slow|deliberate|calm|weary|grave|ponderous|measured|solemn/i)) rate -= 0.8;
    const range = Math.max(1.2, 3.2 + (has(/cheer|playful|warm|generous|jovial|excit|curious|bright|merry/i) ? 2 : 0) - (has(/cold|bleak|stern|grim|flat|weary|monoton|aloof/i) ? 1.2 : 0) + (kind === 'regal' ? -0.6 : 0));
    const pauses = has(/clipped|terse|curt|brisk/i) ? 0.75 : has(/deliberate|measured|solemn|grave|ponderous/i) ? 1.4 : 1;
    const vset = kind === 'regal' ? ['o', 'a', 'uh', 'u'] : kind === 'undead' ? ['e', 'i', 'uh'] : kind === 'beast' ? ['a', 'uh', 'o']
      : [['a', 'e', 'o', 'uh'], ['i', 'e', 'a', 'ae'], ['o', 'u', 'a', 'uh'], ['ae', 'e', 'i', 'o'], ['a', 'o', 'e', 'i']][hash(name) % 5];
    const sig = [];
    if (has(/humor|jest|laugh|cheer|playful|jovial|bard|merry|wit\b/i)) sig.push('laugh');
    if (has(/regret|weary|sorrow|bleak|melanch|grief|loss|mourn|tired/i)) sig.push('sigh');
    if (kind === 'beast' || has(/warrior|fighter|guard|brute|soldier|barbarian|knight/i)) sig.push('grunt');
    if (kind === 'undead' || has(/serpent|snake|naga|lizard|viper/i)) sig.push('hiss');
    return { name, kind, f0, fs, mix, pw: 0.15 + hr(4) * 0.35, breath, rasp, vib, vibRate: 4.5 + hr(8) * 2 + (nervous ? 2 : 0), rate, range, pauses, vset, sig: sig.slice(0, 2) };
  }
  // text -> syllable events {t, dur, semis, semis2, v, v2, amp | br (breath only)}. Long lines: each sentence voices its
  // first ~8-11 words then trails off softly; breaths/pauses at commas and sentence ends; ? rises, ! stresses, . falls.
  function planSpeech(P, text, maxSec = 14) {
    const ev = [], sents = String(text).replace(/["\u201c\u201d]/g, '').match(/[^.!?\u2026;:]+[.!?\u2026;:]*/g) || [];
    let t = 0.05, r = hash(P.name + '|' + text) || 1; const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822519) ^ 0x9e3779b9) >>> 0) / 4294967296;
    const syl = 1 / P.rate, cap = 8 + (hash(P.name) % 4);
    for (const s of sents) {
      if (t > maxSec) break;
      const words = s.trim().split(/\s+/).filter(Boolean); if (!words.length) continue;
      const end = (s.trim().match(/[.!?\u2026;:]+$/) || [''])[0], q = end.includes('?'), ex = end.includes('!');
      const nVoiced = Math.min(words.length, cap), trunc = words.length > cap;
      const sylls = []; words.slice(0, nVoiced).forEach(w => { const n = Math.max(1, Math.min(3, (w.toLowerCase().match(/[aeiouy]+/g) || []).length));
        for (let k = 0; k < n; k++) sylls.push({ last: k === n - 1, comma: k === n - 1 && /[,\u2014-]$/.test(w) }); });
      if (trunc) sylls.push({ last: true, trail: 1 }, { last: true, trail: 2 }); // trail-off murmur
      const N = sylls.length, stress = ex ? Math.floor(rnd() * Math.min(3, N)) : -1;
      sylls.forEach((x, i) => {
        const pos = i / Math.max(1, N - 1); let semis = P.range * (0.45 - 0.7 * pos) + (rnd() - 0.5) * P.range * 0.5, amp = 0.55 + rnd() * 0.25;
        if (q && i >= N - 3) semis += P.range * (0.5 + (i - (N - 3)) * 0.45);
        if (!q && i === N - 1) semis -= P.range * 0.5;
        if (i === stress) { semis += P.range * 0.7; amp = 1; }
        if (x.trail) amp *= x.trail === 1 ? 0.45 : 0.25; else if (trunc && pos > 0.7) amp *= 1 - (pos - 0.7);
        const d = syl * (0.75 + rnd() * 0.5) * (x.trail ? 1.3 : 1) * (i === N - 1 ? 1.5 : 1);
        const v = P.vset[Math.floor(rnd() * P.vset.length)], v2 = P.vset[Math.floor(rnd() * P.vset.length)];
        ev.push({ t, dur: d, semis, semis2: semis + (i === N - 1 ? (q ? 1.5 : -1.5) : (rnd() - 0.5)), v, v2, amp });
        t += d + (x.last ? 0.035 * P.pauses : 0.005);
        if (x.comma) { if (rnd() < 0.5 + P.breath) ev.push({ t: t + 0.04, dur: 0.18, br: 0.45, v: 'uh' }); t += 0.24 * P.pauses; }
      });
      t += (0.38 + rnd() * 0.15) * P.pauses * (trunc ? 1.2 : 1);
      if (rnd() < 0.35 + P.breath) ev.push({ t: t - 0.3 * P.pauses, dur: 0.24, br: 0.6, v: 'uh' });
    }
    return ev;
  }
  const SOUNDSETS = { // Doom-style per-character sets; semis relative to the speaker's f0, varied per play
    sight: [{ t: 0, dur: 0.75, semis: -3, semis2: 4, v: 'a', v2: 'o', amp: 1, att: 0.06 }],
    pain: [{ t: 0, dur: 0.32, semis: 8, semis2: 1, v: 'ae', v2: 'uh', amp: 1, att: 0.012, rasp: 0.3 }, { t: 0.3, dur: 0.18, br: 0.5, v: 'uh' }],
    death: [{ t: 0, dur: 0.5, semis: 6, semis2: 2, v: 'a', v2: 'o', amp: 1, att: 0.02, rasp: 0.25 }, { t: 0.45, dur: 1.1, semis: 2, semis2: -12, v: 'o', v2: 'u', amp: 0.75, rasp: 0.4 }, { t: 1.4, dur: 0.6, br: 0.4, v: 'u' }],
    attack: [{ t: 0, dur: 0.26, semis: -2, semis2: -5, v: 'uh', v2: 'a', amp: 0.95, att: 0.015, rasp: 0.35 }],
    laugh: [0, 1, 2, 3].map(i => ({ t: i * 0.17, dur: 0.12, semis: 5 - i * 1.2, semis2: 4 - i * 1.2, v: 'a', v2: 'a', amp: 0.8 - i * 0.12, breathy: 0.4 })),
    sigh: [{ t: 0, dur: 0.95, br: 0.85, v: 'a', v2: 'u' }, { t: 0.15, dur: 0.6, semis: 0, semis2: -4, v: 'uh', v2: 'u', amp: 0.25 }],
    grunt: [{ t: 0, dur: 0.22, semis: -5, semis2: -7, v: 'u', v2: 'uh', amp: 0.9, att: 0.015, rasp: 0.3 }],
    hiss: [{ t: 0, dur: 0.8, br: 1, v: 'i', v2: 'e', hiss: true }],
  };
  const evLen = ev => ev.reduce((m, e) => Math.max(m, e.t + e.dur), 0);
  const vAssets = new WeakMap();
  function voiceAssets(ac) {
    let A = vAssets.get(ac); if (A) return A;
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.7), ac.sampleRate), q = ir.getChannelData(0);
    for (let i = 0; i < q.length; i++) { const x = i / ac.sampleRate; q[i] = (Math.random() * 2 - 1) * Math.exp(-x * 7) * Math.min(1, x / 0.004) * 0.5; }
    A = { nb, ir }; vAssets.set(ac, A); return A;
  }
  function pulseWave(ac, pw) { const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * pw); return ac.createPeriodicWave(re, im); }
  // render one utterance (event list) for profile P into dest at t0
  function synthVoice(ac, dest, P, ev, t0, o = {}) {
    const { nb, ir } = voiceAssets(ac), vary = o.vary || 0, k = o.keySnap || null;
    const endT = t0 + evLen(ev) + 0.15;
    const out = ac.createGain(); out.gain.value = 0; out.gain.setTargetAtTime(o.vol ?? 0.7, t0, 0.01); out.gain.setTargetAtTime(0, endT, 0.05);
    const wet = ac.createConvolver(); wet.buffer = ir; const wg = ac.createGain(); wg.gain.value = 0.22; out.connect(dest); out.connect(wet); wet.connect(wg); wg.connect(dest);
    const pitch = ac.createConstantSource(); pitch.offset.value = 0; const oscs = [];
    const lfo = ac.createOscillator(); lfo.frequency.value = P.vibRate; const lg = ac.createGain(); lg.gain.value = P.vib; lfo.connect(lg);
    const mk = (type, g, mult = 1) => { if (g <= 0) return null; const os = ac.createOscillator(); if (type === 'pulse') os.setPeriodicWave(pulseWave(ac, P.pw)); else os.type = type === 'saw' ? 'sawtooth' : 'triangle';
      os.frequency.value = P.f0 * mult; pitch.connect(os.detune); lg.connect(os.detune); const gg = ac.createGain(); gg.gain.value = g; os.connect(gg); oscs.push(os); return gg; };
    const bus = ac.createGain(); [mk('pulse', P.mix.pulse), mk('saw', P.mix.saw), mk('tri', P.mix.tri)].forEach(g => g && g.connect(bus));
    const am = ac.createGain(); am.gain.value = 1 - P.rasp * 0.5; bus.connect(am); // rasp: sub-octave amplitude modulation (growl)
    const sub = mk('pulse', 1, 0.5), subAmt = ac.createGain(); subAmt.gain.value = P.rasp * 0.5; sub.connect(subAmt); subAmt.connect(am.gain);
    const F1 = ac.createBiquadFilter(), F2 = ac.createBiquadFilter(), lp = ac.createBiquadFilter(); F1.type = F2.type = 'bandpass'; F1.Q.value = 5; F2.Q.value = 8; lp.type = 'lowpass'; lp.frequency.value = 900 * P.fs; lp.Q.value = 0.5;
    const g1 = ac.createGain(), g2 = ac.createGain(), g3 = ac.createGain(); g1.gain.value = 1.6; g2.gain.value = 1.1; g3.gain.value = 0.25;
    am.connect(F1); am.connect(F2); am.connect(lp); F1.connect(g1); F2.connect(g2); lp.connect(g3);
    const vAmp = ac.createGain(); vAmp.gain.value = 0; [g1, g2, g3].forEach(g => g.connect(vAmp)); vAmp.connect(out);
    const nz = ac.createBufferSource(); nz.buffer = nb; nz.loop = true; const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.value = 2000 * P.fs;
    const bAmp = ac.createGain(); bAmp.gain.value = 0; nz.connect(nf); nf.connect(bAmp); bAmp.connect(out);
    const a0 = 12 * Math.log2(P.f0 / 220);
    const snap = s => { if (!k) return s; const sc = MODES[k.scale] || MODES.minor; let best = s, bd = 99;
      for (let oc = -3; oc <= 2; oc++) for (const d of sc) { const n = k.pc - 9 + d + oc * 12 - a0, dd = Math.abs(n - s); if (dd < bd) { bd = dd; best = n; } } return best; };
    for (const e of ev) {
      const t = t0 + e.t, v1 = VOWELS[e.v] || VOWELS.a, v2 = VOWELS[e.v2 || e.v] || v1, att = e.att || 0.025;
      if (e.br) { // breath / hiss: noise only
        nf.frequency.setTargetAtTime((e.hiss ? 4200 : v1[1] * 1.3) * P.fs, t, 0.03); nf.frequency.setTargetAtTime((e.hiss ? 3600 : v2[1]) * P.fs, t + e.dur * 0.5, e.dur * 0.3);
        bAmp.gain.setTargetAtTime(e.br * (0.25 + P.breath * 0.35), t, e.dur * 0.18); bAmp.gain.setTargetAtTime(0, t + e.dur * 0.55, e.dur * 0.2);
      }
      if (e.semis === undefined) continue;
      const s1 = snap(e.semis + vary), s2 = k ? snap((e.semis2 ?? e.semis) + vary) : (e.semis2 ?? e.semis) + vary;
      pitch.offset.setTargetAtTime(s1 * 100, Math.max(t0, t - 0.01), 0.025); pitch.offset.setTargetAtTime(s2 * 100, t + e.dur * 0.35, e.dur * 0.35);
      F1.frequency.setTargetAtTime(v1[0] * P.fs, t, 0.025); F2.frequency.setTargetAtTime(v1[1] * P.fs, t, 0.025);
      F1.frequency.setTargetAtTime(v2[0] * P.fs, t + e.dur * 0.4, e.dur * 0.25); F2.frequency.setTargetAtTime(v2[1] * P.fs, t + e.dur * 0.4, e.dur * 0.25);
      const amp = e.amp * (1 - P.breath * 0.5);
      vAmp.gain.setTargetAtTime(amp, t, att); vAmp.gain.setTargetAtTime(amp * 0.8, t + att * 3, e.dur * 0.3); vAmp.gain.setTargetAtTime(0, t + e.dur * 0.72, e.dur * 0.13);
      const br = (P.breath + (e.breathy || 0)) * e.amp * 0.3; if (br > 0.01) { bAmp.gain.setTargetAtTime(br, t, att); bAmp.gain.setTargetAtTime(0, t + e.dur * 0.7, e.dur * 0.15); }
      if (e.rasp) { subAmt.gain.setTargetAtTime(Math.min(0.5, (P.rasp + e.rasp) * 0.5), t, 0.02); subAmt.gain.setTargetAtTime(P.rasp * 0.5, t + e.dur, 0.05); }
    }
    const stopAt = endT + 0.9; for (const n of [pitch, nz, lfo, ...oscs]) { n.start(t0); n.stop(stopAt); }
    return { end: endT, stop: at => { out.gain.cancelScheduledValues(at); out.gain.setTargetAtTime(0, at, 0.03); } };
  }
  const voiceLog = [], speaking = new Map(); let lastSubtitle = '', lastSubtitleAt = 0;
  const voiceOk = () => !(settings.muted || Number(settings.voice ?? 1) <= 0) && audio() && ctx.state === 'running';
  const keyForVoice = P => rhythmMode === 'grid' && P.kind !== 'undead' && P.kind !== 'beast' ? songKeyNow() : null; // key-snap only while music is audible
  function utterance(P, line) { // speech plus an occasional signature sound (laugh/sigh/grunt/hiss)
    const ev = planSpeech(P, line), sig = P.sig.length && hash(line) % 4 === 0 ? P.sig[hash(line + 's') % P.sig.length] : null;
    return { ev: sig ? ev.concat(SOUNDSETS[sig].map(e => ({ ...e, t: e.t + evLen(ev) + 0.25 }))) : ev, sig, syl: ev.filter(e => e.semis !== undefined).length };
  }
  function speakVoice(name, line, opts = {}) {
    if (!name || !line || !voiceOk()) return null;
    const P = voiceProfile(name), U = utterance(P, line), now = ctx.currentTime;
    const prev = speaking.get(P.name); if (prev) prev.stop(now);
    if (speaking.size >= 2 && !prev) return null; // never more than two talkers at once
    const r = synthVoice(ctx, spatialOut(name, 0, evLen(U.ev) + 2.5, voiceBus).node, P, U.ev, now + 0.03, { keySnap: keyForVoice(P), vol: 0.7 * (opts.vol ?? 1) });
    speaking.set(P.name, r); setTimeout(() => { if (speaking.get(P.name) === r) speaking.delete(P.name); }, (r.end - now + 0.2) * 1000);
    duck(r.end - now, 0.8);
    const info = { speaker: P.name, kind: P.kind, f0: +P.f0.toFixed(1), syllables: U.syl, sig: U.sig, len: +(r.end - now).toFixed(2) };
    voiceLog.push(info); if (voiceLog.length > 30) voiceLog.shift(); return info;
  }
  const lastCry = new Map();
  function voiceSound(name, what) { // Doom-style per-character cries: sight | pain | death | attack | laugh | sigh | grunt | hiss
    if (!name || !SOUNDSETS[what] || !voiceOk()) return null;
    const now = ctx.currentTime, key = name + what; if (now - (lastCry.get(key) || 0) < (what === 'pain' ? 0.6 : 1.2)) return null; lastCry.set(key, now);
    const P = voiceProfile(name), r = synthVoice(ctx, spatialOut(name, 0, evLen(SOUNDSETS[what]) + 2.5, voiceBus).node, P, SOUNDSETS[what], now + 0.02, { vary: (Math.random() - 0.5) * 3, vol: what === 'death' ? 0.8 : 0.7 });
    if (what === 'death' || what === 'sight') duck(r.end - now, 0.75);
    voiceLog.push({ speaker: P.name, kind: P.kind, cry: what }); if (voiceLog.length > 30) voiceLog.shift(); return r.end - now;
  }
  const namesIn = line => (window.getDungeonLifeContext?.()?.actors || []).filter(a => a && a.name && line.includes(a.name)).sort((x, y) => line.indexOf(x.name) - line.indexOf(y.name)).map(a => a.name);
  function combatVoices(line) { // hooks on the existing combat log lines: "<A> hits <B> for N", "<B> is killed by <A>", misses
    const who = namesIn(line); if (!who.length) return;
    if (/is killed by|is slain|dies\b|falls before|is destroyed|has been defeated/i.test(line)) return voiceSound(who[0], 'death');
    if (/\bhits\b.*\bfor \d+|takes \d+ damage|critical/i.test(line)) { if (/takes \d+ damage/i.test(line) && who.length === 1) return voiceSound(who[0], 'pain');
      voiceSound(who[0], 'attack'); if (who[1]) setTimeout(() => voiceSound(who[1], 'pain'), 180); return; }
    if (/\bmisses\b|\battacks\b|\bswings\b|\blunges\b/i.test(line)) voiceSound(who[0], 'attack');
  }
  function sightVoices() { // combat starts: visible hostile monsters call out (max two, staggered)
    const hostile = (window.getDungeonLifeContext?.()?.actors || []).filter(a => a && a.type === 'monster' && (a.hp ?? 1) > 0 && /hostile/i.test(a.allegiance || a.state || ''));
    hostile.slice(0, 2).forEach((a, i) => setTimeout(() => voiceSound(a.name, 'sight'), 150 + i * 450));
  }
  function watchVoices() {
    const w = document.getElementById('dungeon-dialogue-words'), c = document.getElementById('dungeon-dialogue-caption');
    if (!w || !c) return setTimeout(watchVoices, 1500);
    const fire = () => { const line = w.textContent.trim(), who = c.textContent.trim(), key = who + '|' + line;
      if (!line || w.closest('[hidden]') || key === lastSubtitle) return;
      lastSubtitle = key; lastSubtitleAt = performance.now(); }; // dialogue speech is driven by dungeonLifeUi -> speakLine (SID voices)
    new MutationObserver(() => setTimeout(fire, 30)).observe(w, { childList: true, characterData: true, subtree: true });
  }
  function chatVoices(text) {
    return; // only lines shown in the dialogue panel are voiced (SID speech); chat-log quotes stay silent
    if (performance.now() - lastSubtitleAt < 1500) return;
    const actors = (window.getDungeonLifeContext?.()?.actors || []).filter(a => a && a.name && a.type !== 'pc');
    const re = /["\u201c]([^"\u201c\u201d]{3,600})["\u201d]/g; let m;
    while ((m = re.exec(text))) {
      const around = text.slice(Math.max(0, m.index - 80), m.index) + ' ' + text.slice(re.lastIndex, re.lastIndex + 80);
      const who = actors.find(a => around.includes(a.name) || around.includes(String(a.name).split(/\s+/)[0]));
      if (who) { speakVoice(who.name, m[1]); break; }
    }
  }
  // --- SID speech (server: Piper analysis -> 64-SID vocoder WAV per sentence; see retort/sidVoice) ---
  const speechBufs = new Map(); let speechNow = null, profileSig = '';
  function speechKey(who, text) { return sidMode() + '|' + who + '|' + text; }
  function fetchSpeech(who, text) {
    const k = speechKey(who, text); if (speechBufs.has(k)) return speechBufs.get(k);
    const t0 = performance.now();
    const p = fetch('/voice/line.wav?speaker=' + encodeURIComponent(who) + '&text=' + encodeURIComponent(text) + '&clock=' + sidMode())
      .then(r => { if (!r.ok) throw new Error('voice ' + r.status); return r.arrayBuffer(); })
      .then(b => new Promise((res, rej) => audio().decodeAudioData(b, res, rej)))
      .then(buf => { speechLog.push({ who, text: text.slice(0, 50), fetchMs: Math.round(performance.now() - t0), dur: +buf.duration.toFixed(2) }); if (speechLog.length > 30) speechLog.shift(); return buf; });
    p.catch(() => speechBufs.delete(k)); speechBufs.set(k, p);
    while (speechBufs.size > 40) speechBufs.delete(speechBufs.keys().next().value);
    return p;
  }
  const speechLog = [];
  const cleanSpeech = t => String(t || '').replace(/([^.!?,;:\s])\s*\n+/g, '$1.\n').replace(/(\w)\s+["\u201c](?=\w)/g, '$1, ').replace(/(\w)["\u201d]\s+(?=\w)/g, '$1, ').replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
  const sentencesOf = t => cleanSpeech(t).split(/(?<=[.!?]['\u2019)\]]*)\s+(?=\S)/).map(cleanSpeech).filter(Boolean); // same splitter as retort/sidVoice
  function voicePrefetch(who, chunks) { if (!audio()) return; let n = 0; for (const c of chunks || []) for (const s of sentencesOf(c)) if (n++ < 12) fetchSpeech(who, s).catch(() => {}); }
  function stopSpeech() { if (!speechNow) return; const cur = speechNow, t = ctx.currentTime; speechNow = null; cur.cancelled = true;
    for (const { src, g } of cur.parts) try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.08); src.stop(t + 0.1); } catch {} }
  // Speaks one subtitle chunk sentence by sentence (gapless: sentence n+1 is fetched/pre-synthesized while n plays).
  // Resolves { dur } when the first sentence starts; opts.onSchedule(remainingMs, more) reports how long the scheduled audio
  // still runs and whether sentences are still coming, so the subtitle can hold exactly as long as the voice.
  // Rejects if audio is locked or the first sentence fails, so the caller keeps its text timing.
  async function speakLine(who, text, opts = {}) {
    const sents = sentencesOf(text); if (!who || !sents.length) throw new Error('empty');
    if (!audio() || ctx.state !== 'running') throw new Error('audio locked');
    const bufs = sents.map(s => fetchSpeech(who, s)), first = await bufs[0];
    if (opts.stillWanted && !opts.stillWanted()) throw new Error('stale');
    stopSpeech();
    const cur = { who, parts: [] }; speechNow = cur;
    const silent = settings.muted || Number(settings.voice ?? 1) <= 0; let end = ctx.currentTime + 0.03;
    const sched = buf => { if (!silent) { const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = 0.95 * (opts.vol ?? 1);
        const sp = spatialOut(who, 0, end - ctx.currentTime + buf.duration + 0.5, voiceBus); src.connect(g); g.connect(sp.node);
        src.onended = () => { try { g.disconnect(); } catch {} sp.done(); }; src.start(end); cur.parts.push({ src, g }); duck(end - ctx.currentTime + buf.duration, 0.72); }
      end += buf.duration; };
    sched(first); opts.onSchedule?.((end - ctx.currentTime) * 1000, sents.length > 1);
    (async () => { for (let i = 1; i < bufs.length; i++) { let b; try { b = await bufs[i]; } catch { break; }
        if (cur.cancelled) return; end = Math.max(end + 0.12, ctx.currentTime + 0.03); sched(b); opts.onSchedule?.((end - ctx.currentTime) * 1000, i + 1 < bufs.length); }
      if (!cur.cancelled) opts.onSchedule?.(Math.max(0, end - ctx.currentTime) * 1000, false); })();
    return { dur: first.duration, sentences: sents.length };
  }
  function postProfiles() { // room entered / roster changed: send voice mappings so the server can pre-synthesize in character
    const actors = (window.getDungeonLifeContext?.()?.actors || []).filter(a => a && a.name && a.type !== 'pc');
    const sig = currentRoomKey() + '|' + actors.map(a => a.name).sort().join(','); if (!actors.length || sig === profileSig) return; profileSig = sig;
    const profiles = actors.map(a => { const P = voiceProfile(a); return { name: P.name, kind: P.kind, f0: P.f0, fs: P.fs, breath: P.breath, rasp: P.rasp, range: P.range, rate: P.rate }; });
    fetch('/voice/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profiles }) }).catch(() => {});
  }
  setInterval(() => { try { postProfiles(); } catch {} }, 1000);

  // offline render (demos/tests) using exactly the in-game path (utterance + synthVoice): items [{actor, line?, cries?}]
  async function renderVoiceDemo(items, sr = 22050) {
    const plan = []; let t = 0.3;
    for (const it of items) { const P = voiceProfile(it.actor);
      if (it.line) { const U = utterance(P, it.line); plan.push({ P, ev: U.ev, t, what: 'line', sig: U.sig }); t += evLen(U.ev) + 1.2; }
      for (const c of it.cries || []) { plan.push({ P, ev: SOUNDSETS[c], t, vary: (Math.random() - 0.5) * 3, what: c }); t += evLen(SOUNDSETS[c]) + 1.0; }
      t += 1.0; }
    const oc = new OfflineAudioContext(1, Math.ceil((t + 1.5) * sr), sr);
    for (const p of plan) synthVoice(oc, oc.destination, p.P, p.ev, p.t, { vary: p.vary || 0 });
    const buf = await oc.startRendering();
    return { data: Array.from(buf.getChannelData(0)), sr, marks: plan.map(p => ({ who: p.P.name, kind: p.P.kind, what: p.what, sig: p.sig || null, t: +p.t.toFixed(2), len: +(evLen(p.ev) + 0.15).toFixed(2) })),
      profiles: items.map(it => { const P = voiceProfile(it.actor); return { name: P.name, kind: P.kind, f0: +P.f0.toFixed(0), rate: +P.rate.toFixed(1), rasp: +P.rasp.toFixed(2), breath: +P.breath.toFixed(2), vib: +P.vib.toFixed(0), range: +P.range.toFixed(1), vowels: P.vset.join('/'), sig: P.sig }; }) };
  }

  // --- server events (called from the existing SSE handler in game.js; no extra connection) ---
  let lastDiceActive = '', seenRolls = new Set();
  function onServerEvent(d) {
    if (!d || typeof d !== 'object') return;
    try {
      switch (d.type) {
        case 'roomMusicUpdated':
        case 'roomMusicReady':
          songRoom = ''; // the room's song JSON may be new; refetch it for movement names
          if (d.wav) queueRoomMusic(d);
          else if (d.type === 'roomMusicUpdated' && d.isNew) queueRoomMusic({ wav: '/sid/current_room.wav?ts=' + Date.now(), coords: d.coords }); // pre-slot server
          if (d.coords && d.ambience) { ambByRoom.set(d.coords, d.ambience); if (d.coords === currentRoomKey()) applyRoomAmbience(d.coords); }
          break;
        case 'combat_log': combatSounds(d.log); break;
        case 'realtime_combat_result': combatSounds(d.content || d.combatLog); break;
        case 'dice_state': {
          const id = d.active?.id || '';
          if (id && id !== lastDiceActive && d.active.kind === 'combat') { play('combat_start'); sightVoices(); }
          lastDiceActive = id;
          for (const r of d.results || []) if (r && r.id && !seenRolls.has(r.id)) { seenRolls.add(r.id); play('dice'); }
          if (seenRolls.size > 200) seenRolls = new Set([...seenRolls].slice(-50));
          break;
        }
        case 'action_notice': noticeSound(d); break;
      }
    } catch (e) { console.warn('[sfx]', e.message); }
  }
  function noticeSound(n) {
    const words = `${n.activity || ''} ${n.title || ''} ${n.message || ''}`;
    if (n.kind === 'defeat') return play('monster_death');
    if (n.kind === 'puzzle-complete') return play('quest');
    if (n.kind === 'item-taken') return play(/gold|coin|gem|jewel/i.test(words) ? 'coins' : 'pickup');
    if (n.kind === 'object-discovered') return play('quest', { vol: 0.6 });
    if (n.kind === 'pursuit') return play('combat_start');
    if (/door|gate|lever|unlock|portcullis|chest/i.test(words)) return play('door', { pan: (Math.random() - 0.5) * 0.3 });
    if (/cast|spell|magic|arcane/i.test(words)) return play(/fire|flame|lightning/i.test(words) ? 'fireball' : 'spell');
    if (/heal|cure|restor/i.test(words)) return play('heal');
    if (n.result === 'failure' || n.result === 'blocked') return play('miss', { vol: 0.6 });
    play('notice');
  }

  // --- state watchers: room change, footsteps, PC hit points and level ---
  function currentRoomKey() { try { return (typeof currentDungeon !== 'undefined' && currentDungeon && currentDungeon.geoKey) || ''; } catch { return ''; } }
  let lastRoom = '', lastX = null, lastY = null, walked = 0, stepAlt = false, pcHp = null, pcLevel = null, pcName = '';
  function tick() {
    const room = currentRoomKey();
    if (room && room !== lastRoom) { if (lastRoom) play('room_enter'); lastRoom = room; lastX = null; applyRoomAmbience(room); }
    let x, y; try { x = playerPosX; y = playerPosY; } catch { x = window.playerPosX; y = window.playerPosY; }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (lastX !== null) { const d = Math.hypot(x - lastX, y - lastY); if (d < 3) walked += d; }
      lastX = x; lastY = y;
      if (walked >= 0.85) { walked = 0; stepAlt = !stepAlt; play(stepAlt ? 'step1' : 'step2', { rate: 0.94 + Math.random() * 0.12, pan: (stepAlt ? -0.06 : 0.06) }); }
    }
    const pc = Array.isArray(window.combatCharacters) ? window.combatCharacters.find(c => c && c.type === 'pc') : null;
    if (pc) {
      const hp = Number(pc.hp ?? pc.HP), lvl = Number(pc.level ?? pc.Level);
      if (pc.name !== pcName) { pcName = pc.name; pcHp = hp; pcLevel = lvl; }
      if (Number.isFinite(hp) && Number.isFinite(pcHp)) {
        if (hp <= 0 && pcHp > 0) play('death'); else if (hp < pcHp) play('hurt'); else if (hp > pcHp + 2 && pcHp > 0) play('heal', { vol: 0.6 });
      }
      if (Number.isFinite(lvl) && Number.isFinite(pcLevel) && lvl > pcLevel) play('levelup');
      if (Number.isFinite(hp)) pcHp = hp; if (Number.isFinite(lvl)) pcLevel = lvl;
    }
  }

  // --- room music transport: play/pause, rewind, fast-forward, time and movement ---
  // Music plays through <audio id="room-music"> (index.html, reloaded per room) and sometimes game.js's #room-audio.
  // The element that started most recently is "the" music; any other one that is playing is paused, so only one plays.
  let activeMusic = null, internalPlay = false, song = null, songRoom = '', lastRew = 0, lastFf = 0;
  function playable(a) { return a && (a.currentSrc || a.getAttribute('src')); }
  function music() {
    if (activeMusic && document.contains(activeMusic) && playable(activeMusic)) return activeMusic;
    const els = musicEls().filter(playable);
    return els.find(a => !a.paused) || els.find(a => a.id === 'room-music') || els[0] || null;
  }
  function onMediaPlay(e) {
    const a = e.target; if (!a || !/^(AUDIO|VIDEO)$/.test(a.tagName)) return;
    if (settings.userPaused && !internalPlay) { a.pause(); return; } // user pause survives room changes
    if (crossfading) return;
    activeMusic = a;
    for (const o of musicEls()) if (o !== a && !o.paused) o.pause();
  }
  function musicPlay() {
    settings.userPaused = false; save();
    const a = music(); if (!a) return;
    internalPlay = true; a.loop = true;
    const p = a.play(); (p && p.finally ? p.finally(() => { internalPlay = false; }) : (internalPlay = false));
    if (p && p.catch) p.catch(() => {});
  }
  function musicPause() { settings.userPaused = true; save(); for (const a of musicEls()) if (!a.paused) a.pause(); }
  // Movement boundaries come from the room's song JSON: plan.form lists "Name [..., N bars: ...]" segments and
  // 2-bar "transition -> key" segments joined by '||'; plan.bars is the loop length. Scaled to the real audio length.
  function movements(dur) {
    const form = song && song.plan && song.plan.form, bars = song && song.plan && song.plan.bars;
    if (!form || !bars || !dur) return [];
    let bar = 0; const out = [];
    for (const seg of String(form).split('||').map(x => x.trim())) {
      if (!seg || /^\(loop\)$/.test(seg)) continue;
      const t = seg.match(/^transition/i), m = seg.match(/^(.*?)\s*\[[^\]]*?(\d+)\s*bars/);
      const n = t ? 2 : m ? Number(m[2]) : 0; if (!n) continue;
      if (!t) out.push({ name: m[1].trim(), start: bar / bars * dur });
      bar += n;
    }
    return out;
  }
  function currentMovement(a) {
    const mv = movements(a.duration); let i = -1;
    mv.forEach((m, k) => { if (a.currentTime >= m.start - 0.05) i = k; });
    return { mv, i };
  }
  function seek(a, t) { const d = a.duration; if (!Number.isFinite(d) || d <= 0) return; a.currentTime = ((t % d) + d) % d; }
  function rewind() {
    const a = music(); if (!a) return; const now = performance.now(), dbl = now - lastRew < 1200; lastRew = now;
    const { mv, i } = currentMovement(a);
    if (mv.length && (dbl || (i >= 0 && a.currentTime - mv[i].start < 3))) {
      const into = i >= 0 ? a.currentTime - mv[i].start : 0;
      const target = into < 3 || dbl ? (i - 1 + mv.length) % mv.length : i; // near the start: previous movement
      return seek(a, mv[target].start);
    }
    seek(a, a.currentTime - 10);
  }
  function fastForward() {
    const a = music(); if (!a) return; const now = performance.now(), dbl = now - lastFf < 1200; lastFf = now;
    const { mv, i } = currentMovement(a);
    if (dbl && mv.length) return seek(a, mv[(i + 1) % mv.length].start); // wraps to the first movement at the loop
    seek(a, a.currentTime + 10);
  }
  function loadSong(room) {
    if (!room || room === songRoom) return; songRoom = room; song = null;
    fetch('/get-room-music?coords=' + encodeURIComponent(room)).then(r => r.ok ? r.json() : null)
      .then(j => { if (songRoom === room) { song = j && j.music; if (song && lastRoom) applyRoomAmbience(lastRoom); } }).catch(() => {}); // re-key ambience
  }
  const fmt = s => !Number.isFinite(s) ? '0:00' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function transportUi(box) {
    const q = sel => box.querySelector(sel), pp = q('[data-t=play]'), time = q('.hx-time'), mvt = q('.hx-mvt');
    pp.onclick = () => { const a = music(); (a && !a.paused) ? musicPause() : musicPlay(); render(); };
    q('[data-t=rew]').onclick = () => { rewind(); render(); };
    q('[data-t=ff]').onclick = () => { fastForward(); render(); };
    const render = () => {
      const a = music(), playing = a && !a.paused;
      pp.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;'; pp.title = playing ? 'Pause room music' : 'Play room music';
      time.textContent = a ? fmt(a.currentTime) + ' / ' + fmt(a.duration) : '-:-- / -:--';
      const { mv, i } = a ? currentMovement(a) : { mv: [] };
      const title = song && song.title ? song.title : '';
      mvt.textContent = mv.length && i >= 0 ? `${i + 1}/${mv.length} ${mv[i].name}${title ? ' - ' + title : ''}` : (title || (settings.userPaused ? 'Paused' : '\u00a0'));
    };
    setInterval(() => { const r = currentRoomKey(); if (r) loadSong(r); if (!box.querySelector('div').hidden) render(); }, 250);
    render();
  }

  // --- room song queue (two-slot files sid/room_A.wav / room_B.wav, see retort/musicSlots.js) ---
  // The server renders the next room's song into the slot we are not playing and announces it (roomMusicUpdated /
  // roomMusicReady). We hold it until game.js reports the new room spawned and drawn (roomShown), then crossfade.
  // Only the latest announced song is kept; a render that finishes after the room appeared switches immediately.
  let crossfading = false, pendingSong = null, shownRoom = '', playingUrl = '';
  const slotOf = url => (String(url).match(/room_([AB])\.wav/) || [])[1] || null;
  function reportSlot(url) {
    const slot = slotOf(url); if (!slot) return;
    fetch('/music/now-playing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot }) }).catch(() => {});
  }
  function queueRoomMusic(d) {
    if (!d || !d.wav) return;
    const url = d.wav;
    if (url === playingUrl || (pendingSong && pendingSong.url === url)) return;
    pendingSong = { url, coords: d.coords || '' };
    if (!pendingSong.coords || pendingSong.coords === shownRoom) startPending(); // the room is already on screen
  }
  function roomShown(geoKey) {
    shownRoom = geoKey || '';
    if (pendingSong && pendingSong.coords === shownRoom) startPending();
  }
  function musicPlayer(id) {
    let a = document.getElementById(id);
    if (!a) { a = document.createElement('audio'); a.id = id; a.preload = 'auto'; document.body.appendChild(a); }
    return a;
  }
  function startPending() {
    if (crossfading) return; // finish() starts the newest pending song when this fade ends
    const song = pendingSong; pendingSong = null; if (!song) return;
    const old = music(), next = old && old.id === 'room-music' ? musicPlayer('room-audio') : musicPlayer('room-music');
    playingUrl = song.url; songRoom = ''; // refetch the movement map for the new song
    next.loop = true; next.__fade = 0; next.src = song.url;
    const finish = () => {
      if (old && old !== next) { old.pause(); old.__fade = 1; old.removeAttribute('src'); try { old.load(); } catch {} } // release the old slot file
      next.__fade = 1; crossfading = false; activeMusic = next; setMusicVolume();
      if (pendingSong && (!pendingSong.coords || pendingSong.coords === shownRoom)) startPending(); // rapid room changes: newest wins
    };
    reportSlot(song.url); // tell the server now, so the next render never targets the slot we are fading into
    if (settings.userPaused || !old || old.paused) { // nothing audible to fade from (or the user paused)
      activeMusic = next; finish();
      if (!settings.userPaused) { internalPlay = true; const p = next.play(); if (p && p.finally) p.finally(() => { internalPlay = false; }).catch(() => {}); else internalPlay = false; }
      return;
    }
    crossfading = true; internalPlay = true;
    const p = next.play(); if (p && p.finally) p.finally(() => { internalPlay = false; }).catch(() => {}); else internalPlay = false;
    const t0 = performance.now(), dur = 1500;
    const step = () => {
      const x = Math.min(1, (performance.now() - t0) / dur);
      next.__fade = x; old.__fade = 1 - x; setMusicVolume();
      if (x < 1) setTimeout(step, 50); else finish();
    };
    step();
  }
  function loadLatestSong() { // page load: start the newest rendered song (index.html no longer autoplays a fixed file)
    fetch('/music/latest').then(r => r.ok ? r.json() : { url: '/sid/current_room.wav' }).then(j => {
      if (!j || !j.url || playingUrl || pendingSong) return;
      const a = musicPlayer('room-music'); playingUrl = j.url; a.loop = true; a.src = j.url; activeMusic = a; reportSlot(j.url);
      if (!settings.userPaused) { internalPlay = true; const p = a.play(); if (p && p.finally) p.finally(() => { internalPlay = false; }).catch(() => {}); else internalPlay = false; }
    }).catch(() => {});
  }

  // --- tiny volume / mute panel ---
  function panel() {
    const box = document.createElement('div'); box.id = 'holodek-audio-panel';
    box.innerHTML = '<button type="button" title="Sound settings" aria-label="Sound settings">&#9835;</button>' +
      '<div hidden><div class="hx-transport">' +
      '<button type="button" data-t="rew" title="Back 10 s (press twice, or near a movement start: previous movement)">&#9664;&#9664;</button>' +
      '<button type="button" data-t="play" title="Play / pause room music">&#9654;</button>' +
      '<button type="button" data-t="ff" title="Ahead 10 s (press twice: next movement)">&#9654;&#9654;</button>' +
      '<span class="hx-time">0:00 / 0:00</span></div><div class="hx-mvt">&nbsp;</div>' +
      '<label>Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>' +
      '<label>Effects <input type="range" min="0" max="1" step="0.05" data-k="sfx"></label>' +
      '<label>Voices <input type="range" min="0" max="1.5" step="0.05" data-k="voice"></label>' +
      '<label>Ambience <input type="range" min="0" max="2" step="0.05" data-k="amb"></label>' +
      '<label>Stereo width <input type="range" min="0" max="1.5" step="0.05" data-k="width"></label>' +
      '<label><input type="checkbox" data-k="swapLR"> Swap L/R</label>' +
      '<label>SID chip <select data-k="sidMode" title="Stock = real C64 SID clock; 2x/4x = same SID clocked 2x/4x (oscillators to ~7.8/15.6 kHz) for voices, music, ambience and effects"><option value="1x">1x (1 MHz stock)</option><option value="2x">2x (2 MHz)</option><option value="4x">4x (4 MHz)</option></select></label>' +
      '<label><input type="checkbox" data-k="muted"> Mute all</label></div>';
    const st = document.createElement('style');
    st.textContent = '#holodek-audio-panel{position:fixed;left:8px;bottom:8px;z-index:1300;pointer-events:auto;font:12px Georgia,serif;color:#ead29d}#holodek-audio-panel>button{width:30px;height:30px;border-radius:15px;border:1px solid #a48d62;background:#141210e6;color:#ead29d;cursor:pointer;font-size:15px}#holodek-audio-panel>div{margin-bottom:4px;padding:8px 10px;background:#141210f2;border:1px solid #a48d62;border-radius:6px;position:absolute;bottom:34px;left:0;white-space:nowrap}#holodek-audio-panel>div[hidden]{display:none}#holodek-audio-panel label{display:block;margin:3px 0}#holodek-audio-panel input[type=range]{width:110px;vertical-align:middle;margin-left:6px}' +
      '#holodek-audio-panel .hx-transport{display:flex;align-items:center;gap:4px;margin:0 0 4px;padding:4px;background:#40318d;border:2px solid #7869c4;font:bold 12px/1 \'Courier New\',monospace;color:#a59bff}' +
      '#holodek-audio-panel .hx-transport button{min-width:30px;height:22px;padding:0 4px;background:#352879;color:#a59bff;border:2px solid #7869c4;border-radius:0;font:bold 11px/1 \'Courier New\',monospace;cursor:pointer}' +
      '#holodek-audio-panel .hx-transport button:hover{background:#7869c4;color:#fff}#holodek-audio-panel .hx-time{margin-left:4px;min-width:92px;text-align:right}' +
      '#holodek-audio-panel .hx-mvt{font:11px \'Courier New\',monospace;color:#a59bff;margin:0 0 6px;max-width:250px;overflow:hidden;text-overflow:ellipsis}';
    document.head.appendChild(st); document.body.appendChild(box);
    const menu = box.querySelector('div'), btn = box.querySelector('button');
    // keep game key/mouse handlers (movement keys, drag, canvas focus) from eating slider input
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'wheel', 'keydown', 'keyup'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation()));
    const paint = () => { btn.style.opacity = settings.muted ? 0.45 : 1; };
    transportUi(box);
    btn.onclick = () => { menu.hidden = !menu.hidden; };
    box.querySelectorAll('input').forEach(inp => {
      const k = inp.dataset.k;
      if (inp.type === 'checkbox') inp.checked = !!settings[k]; else inp.value = settings[k] ?? 1;
      const onChange = () => {
        settings[k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value); (settings.touched = settings.touched || {})[k] = true; save();
        unlock(); applyVolumes(); stereoTick(); paint();
        if (k === 'sfx') play('notice');
      };
      inp.addEventListener('input', onChange); inp.addEventListener('change', onChange);
    });
    box.querySelectorAll('select[data-k="sidMode"]').forEach(sel => { sel.value = sidMode();
      sel.addEventListener('change', () => { settings.sidMode = ['1x', '2x', '4x'].includes(sel.value) ? sel.value : '1x'; save();
        buffers.clear(); loading.clear(); speechBufs.clear(); postSidMode(); unlock(); play('notice'); }); });
    paint();
    // Anchor the button just right of the compass and above the command prompt; reposition on any layout change.
    const place = () => {
      const comp = document.getElementById('dungeon-compass'), cmd = document.getElementById('chatbotcontainer');
      const c = comp && comp.getBoundingClientRect(), p = cmd && cmd.getBoundingClientRect();
      const b = btn.getBoundingClientRect(), scale = btn.offsetWidth ? b.width / btn.offsetWidth : 1, H = window.innerHeight, Wd = window.innerWidth;
      if (c && c.width > 0) {
        let topPx = c.bottom - b.height;                            // bottom-aligned with the compass...
        if (p && p.height > 0 && c.right + 6 + b.width > p.left && c.right + 6 < p.right) topPx = Math.min(topPx, p.top - 6 - b.height); // ...but never over the prompt
        const leftPx = Math.min(Wd - b.width - 4, c.right + 6);
        box.style.left = Math.max(4, leftPx) / scale + 'px';
        box.style.bottom = Math.max(4, H - topPx - b.height) / scale + 'px';
      } else { box.style.left = '8px'; box.style.bottom = '8px'; }
      if (!menu.hidden) fitMenu();
    };
    // Open the slider panel upward from the button, shifted so it stays fully on screen.
    const fitMenu = () => {
      menu.style.left = '0px'; menu.style.right = 'auto'; menu.style.bottom = '34px'; menu.style.top = 'auto';
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 4) menu.style.left = (window.innerWidth - 4 - r.right) + 'px';
      if (r.left < 4) menu.style.left = (4 - r.left) + 'px';
      if (r.top < 4) { menu.style.bottom = 'auto'; menu.style.top = '34px'; }
      // still too tall for the window either way (small screens): pin to the top edge and scroll inside
      menu.style.maxHeight = ''; menu.style.overflowY = '';
      const r2 = menu.getBoundingClientRect(), bb = box.getBoundingClientRect(), k = (bb.height / (box.offsetHeight || bb.height)) || 1; // page zoom/scale
      if (r2.bottom > window.innerHeight - 4 || r2.top < 4) { menu.style.bottom = 'auto'; menu.style.top = (4 - bb.top) / k + 'px';
        menu.style.maxHeight = (window.innerHeight - 8) / k - 20 + 'px'; menu.style.overflowY = 'auto'; }
    };
    btn.addEventListener('click', () => { if (!menu.hidden) fitMenu(); });
    document.addEventListener('pointerdown', e => { if (!menu.hidden && !box.contains(e.target)) menu.hidden = true; });
    window.addEventListener('resize', place);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(place);
      const watch = () => ['dungeon-compass', 'chatbotcontainer'].forEach(id => { const el = document.getElementById(id); if (el && !el.__sfxWatched) { el.__sfxWatched = true; ro.observe(el); } });
      watch(); setTimeout(watch, 1500);
    }
    setInterval(place, 1000); // the compass re-positions itself on its own observers; follow it
    place();
  }

  function unlock() {
    if (!audio()) return;
    applyVolumes();
    if (ctx.state !== 'running') ctx.resume().then(() => { ambKey = ''; if (lastRoom) applyRoomAmbience(lastRoom); }).catch(() => {});
    ['step1', 'step2', 'hit', 'miss', 'dice', 'door', 'pickup', 'room_enter'].forEach(load);
  }
  function init() {
    try { panel(); } catch (e) { console.warn('[sfx] panel', e.message); }
    watchChat();
    watchVoices();
    setInterval(tick, 100);
    setInterval(setMusicVolume, 250); // music elements are created/replaced per room; keep their volume in line
    // apply the saved volume the moment any music element starts or reloads (media events don't bubble: use capture)
    ['play', 'playing', 'loadstart', 'loadedmetadata'].forEach(ev => document.addEventListener(ev, setMusicVolume, true));
    document.addEventListener('play', onMediaPlay, true);
    document.addEventListener('playing', onMediaPlay, true);
    if (settings.userPaused) setTimeout(() => musicEls().forEach(a => a.pause()), 0); // autoplay on load respects the pause
    loadLatestSong();
    setInterval(() => { if (playingUrl) reportSlot(playingUrl); }, 10000); // re-tell the server after restarts/reconnects
    new MutationObserver(setMusicVolume).observe(document.documentElement, { childList: true, subtree: true });
    setMusicVolume();
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
    if (window.DungeonActionNotices?.observeItems && !window.DungeonActionNotices.__sfx) {
      const orig = window.DungeonActionNotices.observeItems; window.DungeonActionNotices.__sfx = true;
      // local pickups go through observeItems and its private receive(); sound them here
      window.DungeonActionNotices.observeItems = function (...a) { const taken = orig.apply(this, a); if (taken?.length) play(taken.some(i => /gold|coin|gem|jewel/i.test(i.name || '')) ? 'coins' : 'pickup'); return taken; };
    }
  }
  const state = () => ({ pending: pendingSong && pendingSong.url, playingUrl, shownRoom, crossfading, userPaused: !!settings.userPaused, active: music() && music().id, ctx: ctx && ctx.state, sfxGain: sfxBus && sfxBus.gain.value, ambGain: ambBus && ambBus.gain.value, ambLayers: ambLayers.length,
    music: musicEls().map(a => ({ id: a.id, volume: +a.volume.toFixed(2), muted: a.muted, paused: a.paused })) });
  window.HolodekSfx = { speakLine, stopSpeech, voicePrefetch, speechLog: () => speechLog.slice(), stereo: stereoInfo, listener, ctxNow: () => ctx && ctx.currentTime, speakVoice, voiceSound, voiceProfile, renderVoiceDemo, voices: () => voiceLog.slice(), play, onServerEvent, setAmbience, keywordAmbience, settings, applyVolumes, state, musicPlay, musicPause, rewind, fastForward, queueRoomMusic, roomShown, songKeyNow, rhythm: () => ({ mode: rhythmMode, clkOff, evLog: evLog.slice(-200) }), ambLayersInfo: () => ambLayers.map(l => ({ tag: l.tag, keyed: l.keyed || null, rate: l.src ? +l.src.playbackRate.value.toFixed(4) : null })) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
