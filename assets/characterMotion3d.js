(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterMotion3D = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const TAU = Math.PI * 2, STRIDE = 1.6, MAX_ACTORS = 64;
  const limits = [Math.PI * .22, Math.PI * .48, Math.PI * .78];
  const views = ['front', 'threeQuarter', 'side', 'back'];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
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
          sector: 0, facing: 1, viewAt: -Infinity, facingAt: -Infinity, frame: 0, frameAt: now,
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
      const rel = wrap(m.face - Math.atan2(camY - y, camX - x)), angle = Math.abs(rel);
      let sector = limits.findIndex(limit => angle < limit);
      if (sector < 0) sector = 3;
      const margin = .1;
      const outside = angle < (m.sector ? limits[m.sector - 1] - margin : 0) ||
        angle > (m.sector < 3 ? limits[m.sector] + margin : Math.PI);
      if (sector !== m.sector && outside && now - m.viewAt >= 180) { m.sector = sector; m.viewAt = now; }
      // Preserve the sprite's weapon hand; small front/back-axis jitter must
      // not keep replacing left/right art at every camera update.
      const side = Math.sin(rel), facing = side < 0 ? -1 : 1;
      if (Math.abs(side) > .16 && facing !== m.facing && now - m.facingAt >= 240) {
        m.facing = facing; m.facingAt = now;
      }
      const moving = m.blend > .08;
      const desiredFrame = moving ? Math.floor(m.phase / TAU * 4) % 4 : 0;
      if (desiredFrame !== m.frame && (!moving || now - m.frameAt >= 160)) {
        m.frame = desiredFrame; m.frameAt = now;
      }
      m.activeSeconds += dt;
      const breath = Math.sin(m.activeSeconds * 1.6 + m.salt) * .003;
      const gait = Math.sin(m.phase);
      m.pose = { view: m.sector === 3 && input.supportsBack === false ? 'front' : views[m.sector],
        facing: m.facing, frame: m.frame, moving,
        heightScale: 1 + breath * (1 - m.blend) + .012 * Math.sin(m.phase * 2) * m.blend,
        upperShift: m.blend ? (.018 * side + .012 * gait) * m.blend : 0 };
      m.x = x; m.y = y; m.lastAt = now;
      return m.pose;
    }
    return { sample, reset() { actors.clear(); scope = null; }, size: () => actors.size };
  }
  return { createController, STRIDE, MAX_ACTORS };
});
