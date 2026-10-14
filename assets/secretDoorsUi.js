(function(root) {
  'use strict';
  const timelines = new WeakMap(), DURATION = 700;
  let pending = false;
  const time = () => root.DungeonLife?.time?.() ?? Date.now();
  function begin(dungeon, after, now = time()) {
    const map = timelines.get(dungeon) || new Map();
    for (const d of after.doors || []) if (d.open && dungeon.secretDoors?.doors.some(old => old.id === d.id && !old.open)) map.set(d.id, { ...d, at: now });
    timelines.set(dungeon, map);
  }
  function parts(dungeon, now = time()) {
    const out = [];
    for (const [id, d] of timelines.get(dungeon) || []) {
      const t = Math.max(0, Math.min(1, (now - d.at) / DURATION));
      if (t >= 1) { timelines.get(dungeon).delete(id); continue; }
      const c = dungeon.cells[d.key], h = Math.max(.1, (c.ceilHeight || 3) - (c.floorHeight || 0));
      const lift = h * t * t * (3 - 2 * t);
      out.push({ tile: 'custom_secret_wall', key: d.key, position: { x: d.x, y: d.y, z: (c.floorHeight || 0) + lift }, size: { x: 1, y: 1, z: h - lift } });
    }
    return out;
  }
  const active = dungeon => parts(dungeon).length > 0;
  async function pushPanel(event) {
    if (event.code !== 'Space' || event.repeat || pending || event.defaultPrevented ||
        /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target?.tagName) || event.target?.isContentEditable ||
        root.gamePaused || root._gameOver || root.GameCommandGate?.busy() || root.actionDiceState?.active || root._combatCommandPending) return;
    const context = root.getDungeonLifeContext?.(); if (!context?.dungeon?.secretDoors || !context.player) return;
    const { player, dungeon } = context;
    const candidates = dungeon.secretDoors.doors.filter(d => !d.open &&
      Math.abs(Math.floor(player.x) - d.x) + Math.abs(Math.floor(player.y) - d.y) === 1);
    if (!candidates.length) return;
    candidates.sort((a, b) => {
      const score = d => (d.x + .5 - player.x) * Math.cos(player.angle || 0) + (d.y + .5 - player.y) * Math.sin(player.angle || 0);
      return score(b) - score(a);
    });
    event.preventDefault(); pending = true;
    try {
      await root.prepareEconomyState?.();
      if (dungeon.geoKey !== root.currentDungeon?.geoKey) return;
      const response = await fetch('/secret-doors/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: root.dungeonRunId, geoKey: dungeon.geoKey, kind: 'open', key: candidates[0].key,
          nonce: root.crypto?.randomUUID?.() || 'secret:' + Date.now(), player,
          actors: (context.actors || []).map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })) }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'That panel will not open.');
      await root.applyRealtimeCombatResult?.(result);
    } catch (error) {
      root.DungeonActionNotices?.receive({ id: 'secret:' + Date.now(), runId: root.dungeonRunId, geoKey: dungeon.geoKey,
        kind: 'door', title: 'Concealed Passage', message: error.message });
    } finally { pending = false; }
  }
  root.addEventListener('keydown', pushPanel);
  root.SecretDoorsUi = { begin, parts, active, DURATION, pushPanel };
})(window);
