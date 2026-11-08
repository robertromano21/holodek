(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterMotion3D = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const TAU = Math.PI * 2, STRIDE = 1.6, MAX_ACTORS = 64;
  // Classic raycaster-style directional sprites: eight equal 45-degree sectors around the actor, centred on
  // front, front-3/4, side, back-3/4 and back (left/right variants come from the sign of the angle).
  const SECTOR = Math.PI / 4, HYSTERESIS = .1;
  const views = ['front', 'threeQuarter', 'side', 'backQuarter', 'back'];
  const DIRECTIONS = ['front', 'frontQuarterRight', 'sideRight', 'backQuarterRight', 'back', 'backQuarterLeft', 'sideLeft', 'frontQuarterLeft'];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  // rel = actor-to-camera bearing minus actor heading (0 = facing the camera; positive = screen-right).
  function directionIndex(rel) { return ((Math.round(wrap(rel) / SECTOR) % 8) + 8) % 8; }
  function directionView(index) {
    const i = ((Math.round(index) % 8) + 8) % 8, sector = Math.min(i, 8 - i);
    return { index: i, name: DIRECTIONS[i], view: views[sector], facing: i > 0 && i < 4 ? 1 : i > 4 ? -1 : 0, yaw: wrap(i * SECTOR) };
  }
  function salt(key) {
    let h = 2166136261;
    for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967296 * TAU;
  }
  function createController() {
    const actors = new Map();
    let scope = null;
    function sample(key, input) {
      if (scope !== input.scope) { actors.clear(); scope = input.scope; }
      const { x, y, camX, camY, now } = input;
      if (![x, y, camX, camY, now].every(Number.isFinite)) return null;
      let m = actors.get(key);
      if (!m) {
        m = { x, y, lastAt: now, activeSeconds: 0, phase: 0, speed: 0, blend: 0,
          face: Math.atan2(camY - y, camX - x), movedAt: -Infinity,
          sector: 0, dir: 0, facing: 1, viewAt: -Infinity, facingAt: -Infinity, frame: 0, frameAt: now,
          salt: salt(key), pose: { view: 'front', facing: 1, frame: 0, heightScale: 1, upperShift: 0, moving: false } };
        actors.set(key, m);
        if (actors.size > MAX_ACTORS) actors.delete(actors.keys().next().value);
      }
      if (input.paused) { m.lastAt = now; return m.pose; }
      const elapsed = now - m.lastAt;
      if (elapsed <= 0) return m.pose;
      const dt = Math.min(elapsed / 1000, .1), dx = x - m.x, dy = y - m.y;
      const distance = Math.hypot(dx, dy);
      // A room switch, long render gap or teleport is not a walking stride.
      const discontinuity = elapsed > 750 || distance > 2;
      const travelling = !discontinuity && distance > .00005;
      const speed = travelling ? Math.min(6, distance / dt) : 0;
      m.speed += (speed - m.speed) * (1 - Math.exp(-dt * 10));
      m.blend += ((m.speed > .12 ? Math.min(1, m.speed / .7) : 0) - m.blend) * (1 - Math.exp(-dt * 12));
      if (travelling) {
        m.phase = (m.phase + distance / STRIDE * TAU) % TAU;
        m.face = wrap(m.face + wrap(Math.atan2(dy, dx) - m.face) * (1 - Math.exp(-dt * 10)));
        m.movedAt = now;
      } else if (now - m.movedAt > 1100) {
        const want = Math.atan2(camY - y, camX - x);
        m.face = wrap(m.face + wrap(want - m.face) * (1 - Math.exp(-dt * 2.5)));
      }
      if (discontinuity) { m.speed = 0; m.blend = 0; m.phase = 0; }
      // Camera right is (-sin(camera heading), cos(camera heading)); positive relative yaw must project right.
      const rel = wrap(Math.atan2(camY - y, camX - x) - m.face);
      // Stay on the current direction until the camera is clearly inside another sector, so views never flicker.
      const wantDir = directionIndex(rel), offCentre = Math.abs(wrap(rel - m.dir * SECTOR));
      if (wantDir !== m.dir && offCentre > SECTOR / 2 + HYSTERESIS && now - m.viewAt >= 180) { m.dir = wantDir; m.viewAt = now; }
      m.sector = Math.min(m.dir, 8 - m.dir);
      // Preserve the sprite's weapon hand; small front/back-axis jitter must
      // not keep replacing left/right art at every camera update.
      const side = Math.sin(rel), facing = side < 0 ? -1 : 1;
      if (Math.abs(side) > .16 && facing !== m.facing && now - m.facingAt >= 240) {
        m.facing = facing; m.facingAt = now;
      }
      // Turned views are drawn for one side; the chosen direction decides which side, not camera jitter.
      const dirFacing = directionView(m.dir).facing;
      if (dirFacing && dirFacing !== m.facing) { m.facing = dirFacing; m.facingAt = now; }
      const moving = m.blend > .08;
      const desiredFrame = moving ? Math.floor(m.phase / TAU * 4) % 4 : 0;
      if (desiredFrame !== m.frame && (!moving || now - m.frameAt >= 160)) {
        m.frame = desiredFrame; m.frameAt = now;
      }
      m.activeSeconds += dt;
      const breath = Math.sin(m.activeSeconds * 1.6 + m.salt) * .003;
      const gait = Math.sin(m.phase);
      const baseView = views[m.sector], noBack = input.supportsBack === false;
      m.pose = { view: noBack && baseView === 'back' ? 'front' : noBack && baseView === 'backQuarter' ? 'threeQuarter' : baseView,
        direction: m.dir, directionName: DIRECTIONS[m.dir],
        facing: m.facing, frame: m.frame, moving,
        heightScale: 1 + breath * (1 - m.blend) + .012 * Math.sin(m.phase * 2) * m.blend,
        upperShift: m.blend ? (.018 * side + .012 * gait) * m.blend : 0 };
      m.x = x; m.y = y; m.lastAt = now;
      return m.pose;
    }
    return { sample, reset() { actors.clear(); scope = null; }, size: () => actors.size };
  }
  // Action cues (attack / pain / death) noted from combat events, played back as timed key poses:
  // attack = wind-up (held), strike (fast), follow-through, settle; pain = quick flinch, recoil, slower recover;
  // death = slow buckle, fast fall, hit the ground, lie (held). Per-frame durations in ms.
  const ACTION_TIMING = { attack: [230, 70, 150, 190], pain: [80, 130, 190], death: [260, 110, 90, Infinity] };
  const EVEN_TIMING = { attack: [140, 140, 140, 140], pain: [150, 150], death: [180, 180, 180, Infinity] };
  // a bad timing table never breaks playback: fall back to even frames
  function timingFor(kind) {
    const t = ACTION_TIMING[kind];
    const ok = Array.isArray(t) && t.length > 0 && t.length <= 4 && t.every((d, i) => (typeof d === 'number' && d > 0) && (Number.isFinite(d) || (kind === 'death' && i === t.length - 1)));
    return ok ? t : EVEN_TIMING[kind];
  }
  const cues = new Map();
  function cueAction(name, kind, now) {
    if (!name || !ACTION_TIMING[kind]) return;
    const at = Number.isFinite(now) ? now : Date.now();
    const prev = cues.get(name);
    if (prev && prev.kind === 'death' && kind !== 'death') return; // the dead do not flinch
    cues.set(name, { kind, at });
    if (cues.size > MAX_ACTORS * 2) cues.delete(cues.keys().next().value);
  }
  // Same combat log grammar the sound layer reads: "<A> hits <B> for N", "<B> takes N damage", "<B> is killed by <A>", misses.
  function cueFromCombatLine(line, names, now) {
    const who = (names || []).filter(Boolean); if (!who.length || !line) return null;
    if (/is killed by|is slain|dies\b|falls before|is destroyed|has been defeated/i.test(line)) { cueAction(who[0], 'death', now); if (who[1]) cueAction(who[1], 'attack', now); return 'death'; }
    if (/takes \d+ damage/i.test(line) && who.length === 1) { cueAction(who[0], 'pain', now); return 'pain'; }
    if (/\bhits\b.*\bfor \d+|critical/i.test(line)) { cueAction(who[0], 'attack', now); if (who[1]) cueAction(who[1], 'pain', (Number.isFinite(now) ? now : Date.now()) + 180); return 'attack'; }
    if (/\bmisses\b|\battacks\b|\bswings\b|\blunges\b/i.test(line)) { cueAction(who[0], 'attack', now); return 'attack'; }
    return null;
  }
  // {action, frame} for an actor right now; falls back to walk (moving) or idle (still, slow breathing frames).
  function actionFor(name, now, state) {
    const st = state || {}, t = Number.isFinite(now) ? now : Date.now();
    const cue = name ? cues.get(name) : null;
    if (cue) {
      const steps = timingFor(cue.kind), dt = t - cue.at;
      if (dt >= 0) {
        let acc = 0;
        for (let i = 0; i < steps.length; i++) { acc += steps[i]; if (dt < acc) return { action: cue.kind, frame: cue.kind === 'pain' ? i : i }; }
        if (cue.kind !== 'death') cues.delete(name);
      }
    }
    if (st.down) return { action: 'death', frame: 3 };
    if (st.moving) return { action: 'walk', frame: null };
    return { action: 'idle', frame: Math.floor((t + (name ? salt(name) * 400 : 0)) / 900) % 4 };
  }
  function clearActions(name) { if (name) cues.delete(name); else cues.clear(); }
  return { createController, directionIndex, directionView, DIRECTIONS, VIEWS: views, SECTOR, STRIDE, MAX_ACTORS, cueAction, cueFromCombatLine, actionFor, clearActions, ACTION_TIMING, EVEN_TIMING, timingFor };
});
