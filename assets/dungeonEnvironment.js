(function(root) {
  const FEATURES = {
    furnace: { kind: 'heat', text: 'Heat rolls from the furnace mouth; sparks rise through the haze.' },
    brazier: { kind: 'heat', text: 'The brazier crackles nearby, scattering sparks into the air.' },
    campfire: { kind: 'heat', text: 'A low fire stirs; a breath of hot air carries embers past you.' },
    dead_tree: { kind: 'dust', text: 'Dry bark flakes from the dead tree as its bare branches creak.' },
    tomb: { kind: 'dust', text: 'Dust trails across the gravestone, briefly catching in its worn carving.' },
    sarcophagus: { kind: 'dust', text: 'A thread of dust slips from the sarcophagus lid into the still air.' },
    pool: { kind: 'ripple', text: 'Small ripples spread over the nearby pool.' },
    fountain: { kind: 'ripple', text: 'Water glints and ripples in the fountain basin.' },
    crystal_cluster: { kind: 'glimmer', text: 'Faint light flickers between the facets of the nearby crystals.' }
  };

  function buildEnvironment(dungeon) {
    const cues = [];
    const sx = dungeon.start?.x || 0, sy = dungeon.start?.y || 0;
    const candidates = [];
    for (const [key, cell] of Object.entries(dungeon.cells || {})) {
      const landmark = dungeon.tiles?.[cell.tile]?.landmark;
      if (!landmark) continue;
      const type = Object.keys(FEATURES).find(t => String(landmark.drawer || landmark.type).includes(t));
      if (!type) continue;
      const [x, y] = key.split(',').map(Number);
      candidates.push({ id: `environment:${type}:${key}`, sourceKey: key, sourceTile: cell.tile,
        x: x + 0.5, y: y + 0.5, z: (cell.floorHeight || 0) + (type === 'pool' ? 0.05 : 0.7), ...FEATURES[type] });
    }
    candidates.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy));
    cues.push(...candidates.slice(0, 24));
    const description = dungeon.sceneSpec?.source?.description || '';
    if (/\b(drips?|dripping|trickles?)\b/i.test(description) && dungeon.sceneSpec?.indoor !== false) {
      // A drip needs an actual ceiling and a floor, never the open sky.
      for (let dy = -6; dy <= 6 && cues.length < 27; dy += 3) {
        for (let dx = -6; dx <= 6 && cues.length < 27; dx += 3) {
          const key = `${sx + dx},${sy + dy}`, cell = dungeon.cells?.[key];
          if (cell?.tile !== 'floor' || !Number.isFinite(cell.ceilHeight) || cell.ceilHeight - (cell.floorHeight || 0) > 5) continue;
          cues.push({ id: `environment:drip:${key}`, sourceKey: key, sourceTile: cell.tile,
            x: sx + dx + 0.5, y: sy + dy + 0.5, z: cell.ceilHeight - 0.1, floor: cell.floorHeight || 0,
            kind: 'drip', text: 'Water beads on the ceiling and falls in slow, glinting drops.' });
          if (cues.filter(c => c.kind === 'drip').length >= 3) break;
        }
        if (cues.filter(c => c.kind === 'drip').length >= 3) break;
      }
    }
    return { version: 1, cues };
  }

  function visible(dungeon, cue, player) {
    if (dungeon.cells?.[cue.sourceKey]?.tile !== cue.sourceTile) return false;
    const dx = cue.x - player.x, dy = cue.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > 6 || d < 0.2) return false;
    const forward = dx * Math.cos(player.angle) + dy * Math.sin(player.angle);
    const right = -dx * Math.sin(player.angle) + dy * Math.cos(player.angle);
    if (forward <= 0.1 || Math.abs(right / forward) > Math.tan(Math.PI / 6)) return false;
    const steps = Math.ceil(d * 8);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const key = `${Math.floor(player.x + dx * t)},${Math.floor(player.y + dy * t)}`;
      if (key === cue.sourceKey) continue;
      const c = dungeon.cells?.[key];
      const z = player.z + (cue.z - player.z) * t;
      if (!c || !['floor', 'door'].includes(c.tile) || (c.tile === 'door' && !c.door?.isOpen) ||
          z < (c.floorHeight || 0) || z >= (c.ceilHeight ?? Infinity)) return false;
    }
    return true;
  }

  function observe(dungeon, player, now, lastNotice = -Infinity) {
    const active = (dungeon.environment?.cues || []).filter(c => visible(dungeon, c, player)).slice(0, 3);
    const notice = now - lastNotice >= 18000 ? active.find(c => !dungeon.environmentSeen?.[c.id]) || null : null;
    return { active, notice };
  }

  const api = { buildEnvironment, visible, observe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonEnvironment = api;
})(typeof window === 'undefined' ? globalThis : window);
