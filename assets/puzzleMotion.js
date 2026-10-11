(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuzzleMotion = api;
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const timelines = new WeakMap(), DURATION = 650, STEPS = 18;
  const time = () => root.DungeonLife?.time?.() ?? Date.now();
  function pose(dungeon, id, value, now = time()) {
    const motion = timelines.get(dungeon)?.get(id);
    if (!motion || now >= motion.at + DURATION) return value;
    const t = Math.max(0, Math.min(1, (now - motion.at) / DURATION)), eased = t * t * (3 - 2 * t);
    return Math.round((motion.from + (motion.to - motion.from) * eased) * STEPS) / STEPS;
  }
  function begin(dungeon, before, after, now = time()) {
    if (!before || !after || before.definition.id !== after.definition.id || after.state.revision <= before.state.revision) return false;
    const map = new Map();
    for (const c of before.definition.controls) {
      const old = before.state.values[c.index], value = after.state.values[c.index];
      if (old === value) continue;
      const from = pose(dungeon, c.id, old, now);
      const rotary = ['alignment'].includes(before.definition.kind);
      const to = rotary && old === c.options.length - 1 && value === 0 ? c.options.length : value;
      map.set(c.id, { from, to, at: now });
    }
    if (before.state.status !== after.state.status) map.set('receiver', { from: before.state.status === 'complete' ? 1 : 0, to: after.state.status === 'complete' ? 1 : 0, at: now });
    timelines.set(dungeon, map); return map.size > 0;
  }
  function active(dungeon, now = time()) { return [...(timelines.get(dungeon)?.values() || [])].some(row => now < row.at + DURATION); }
  return { begin, pose, active, DURATION, STEPS };
});
