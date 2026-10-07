(function(root) {
  'use strict';
  const VERSION = 1;
  const THEMES = {
    forge: { name: 'Furnace Court', props: ['furnace', 'brazier', 'rubble'],
      description: 'Three marked pressure seals surround the furnace court.',
      clue: 'The maker\'s inscription reads: ASH cools EMBER; only then may BONE endure.',
      complete: 'The pressure seals settle into balance. The furnace court is safely vented.' },
    graves: { name: 'Grave Shrine', props: ['tomb', 'altar', 'dead_tree'],
      description: 'Three grave seals stand beside a weathered offering stone.',
      clue: 'An epitaph reads: First ASH, then EMBER, and at last BONE. Let the dead rest.',
      complete: 'The three grave seals shine. The restless shrine falls quiet.' },
    grove: { name: 'Dead Grove', props: ['dead_tree', 'roots', 'tomb'],
      description: 'Three carved seals mark a clearing between calcified roots and dead trees.',
      clue: 'A carving in the bark reads: ASH feeds EMBER; BONE remembers what remains.',
      complete: 'The grove seals glow together. The whispering branches become still.' }
  };
  function chooseTheme(spec = {}) {
    const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''} ${spec.source?.puzzle || ''}`.toLowerCase();
    if (/furnace|foundry|forge|kiln|smelter/.test(text)) return 'forge';
    if (/mire|swamp|forest|grove|calcified roots|dead trees|withered trees/.test(text)) return 'grove';
    if (/temple|grave|crypt|catacomb|burial|ossuary|ruin/.test(text)) return 'graves';
    return null;
  }
  function enrichSceneSpec(spec) {
    const theme = chooseTheme(spec);
    if (!theme) return null;
    spec.livingTheme = theme;
    spec.landmarks = spec.landmarks || [];
    for (const type of THEMES[theme].props) {
      if (!spec.landmarks.some(l => l.type === type)) spec.landmarks.push({
        type, label: type.replace(/_/g, ' '), count: type === 'dead_tree' ? 3 : 1,
        condition: [], placement: 'scattered', fromLivingEnvironment: true
      });
    }
    return theme;
  }
  const walkable = c => c && (c.tile === 'floor' || (c.tile === 'door' && !c.door?.isLocked));
  function reachable(dungeon, blocked = new Set()) {
    const { width: w, height: h } = dungeon.layout;
    const seen = new Uint8Array(w * h), q = new Int32Array(w * h);
    let head = 0, count = 0;
    const first = dungeon.start.x + dungeon.start.y * w;
    if (!walkable(dungeon.cells[`${dungeon.start.x},${dungeon.start.y}`])) return { seen, count };
    seen[first] = 1; q[count++] = first;
    while (head < count) {
      const i = q[head++], x = i % w, y = Math.floor(i / w);
      const floor = dungeon.cells[`${x},${y}`].floorHeight || 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`, j = nx + ny * w;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || blocked.has(key)) continue;
        const c = dungeon.cells[key];
        if (!walkable(c) || Math.abs((c.floorHeight || 0) - floor) > 1.5) continue;
        seen[j] = 1; q[count++] = j;
      }
    }
    return { seen, count };
  }
  function install(dungeon, spec) {
    if (dungeon.livingEncounter) return { status: 'existing', encounter: dungeon.livingEncounter };
    const theme = spec.livingTheme || chooseTheme(spec);
    if (!theme) return { status: 'skipped', reason: 'no-matching-theme' };
    const { width: w, height: h } = dungeon.layout || {};
    if (!(w > 6 && h > 6 && w <= 512 && h <= 512) || !dungeon.start) return { status: 'skipped', reason: 'invalid-layout' };
    const before = reachable(dungeon);
    const candidates = [];
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const x = dungeon.start.x + dx, y = dungeon.start.y + dy;
      const distance = Math.hypot(dx, dy);
      if (distance < 4 || distance > 12 || x < 2 || y < 2 || x >= w - 4 || y >= h - 4) continue;
      const keys = [`${x},${y}`, `${x + 2},${y}`, `${x},${y + 2}`];
      if (keys.some(k => { const c = dungeon.cells[k]; return c?.tile !== 'floor' || c.navigationReserved || c.feature || c.exit || c.door; })) continue;
      let clear = true;
      for (let yy = y - 1; yy <= y + 3; yy++) for (let xx = x - 1; xx <= x + 3; xx++) {
        const c = dungeon.cells[`${xx},${yy}`];
        if (c?.tile !== 'floor' || !before.seen[xx + yy * w] ||
            Math.abs((c.floorHeight || 0) - (dungeon.cells[keys[0]].floorHeight || 0)) > 0.4) clear = false;
      }
      if (clear) candidates.push({ x, y, keys, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates.slice(0, 8).find(c => reachable(dungeon, new Set(c.keys)).count === before.count - 3);
    if (!chosen) return { status: 'skipped', reason: 'no-safe-nearby-clearing', theme };
    const template = Object.values(dungeon.tiles || {}).find(t => t.spriteSpec?.voxelShape === 'tomb');
    const labels = ['Ash', 'Bone', 'Ember'];
    const fixtures = chosen.keys.map((key, i) => {
      const tile = `custom_journey_seal_${i}`, onTile = `custom_journey_seal_lit_${i}`;
      const meta = { ...(template || {}), spriteSpec: { ...(template?.spriteSpec || {}),
        voxelShape: 'tomb', profile: 'slab', baseWidth: 0.8, gridWidth: 0.8, heightRatio: 0.55, material: 'stone',
        detail: { bandCount: i + 1, noise: 0.15 } }, landmark: { type: 'tomb', drawer: 'tomb', label: `${labels[i]} seal` } };
      dungeon.tiles[tile] = meta;
      dungeon.tiles[onTile] = { ...meta, spriteSpec: { ...meta.spriteSpec, material: 'gold' } };
      dungeon.cells[key] = { ...dungeon.cells[key], tile, feature: tile };
      return { id: labels[i].toLowerCase(), label: `${labels[i]} seal`, key, tile, onTile };
    });
    dungeon.livingEncounter = { version: VERSION, id: `seals:${dungeon.geoKey || 'room'}:${chosen.keys[0]}`,
      theme, name: THEMES[theme].name, description: THEMES[theme].description, clue: THEMES[theme].clue,
      status: 'ready', revision: 0, progress: [], order: ['ash', 'ember', 'bone'], fixtures };
    return { status: 'built', theme, fixtures: fixtures.map(f => ({ key: f.key, label: f.label })),
      reachableBefore: before.count, reachableAfter: before.count - 3 };
  }
  function inReach(dungeon, actor, fixture) {
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return false;
    const [x, y] = fixture.key.split(',').map(Number);
    const dx = x + 0.5 - actor.x, dy = y + 0.5 - actor.y, d = Math.hypot(dx, dy);
    if (d > 2 || d < 0.1) return false;
    const fromFloor = dungeon.cells[`${Math.floor(actor.x)},${Math.floor(actor.y)}`]?.floorHeight || 0;
    if (Math.abs(fromFloor - (dungeon.cells[fixture.key]?.floorHeight || 0)) > 1.5) return false;
    for (let i = 0; i < Math.ceil(d * 10); i++) {
      const t = i / Math.ceil(d * 10), k = `${Math.floor(actor.x + dx * t)},${Math.floor(actor.y + dy * t)}`;
      if (k === fixture.key) continue;
      const c = dungeon.cells[k];
      if (!c || c.tile !== 'floor' && !(c.tile === 'door' && c.door?.isOpen) || c.blocked || c.obstacle) return false;
    }
    return true;
  }
  function interact(dungeon, { fixtureId, actor, expectedRevision }) {
    const e = dungeon.livingEncounter;
    if (!e || expectedRevision !== e.revision) return { ok: false, message: 'The shrine changed; inspect it again.' };
    const fixture = e.fixtures.find(f => f.id === fixtureId);
    if (!fixture || !inReach(dungeon, actor, fixture)) return { ok: false, message: 'Move within two tiles of that seal with a clear path.' };
    if (e.status === 'complete') return { ok: false, message: 'This encounter is already complete. Its seals remain lit.' };
    const correct = fixtureId === e.order[e.progress.length];
    const progress = correct ? [...e.progress, fixtureId] : [];
    const complete = progress.length === e.order.length;
    const encounter = { ...e, progress, status: complete ? 'complete' : 'ready', revision: e.revision + 1 };
    const cells = {};
    for (const f of e.fixtures) {
      const tile = progress.includes(f.id) ? f.onTile : f.tile;
      cells[f.key] = { ...dungeon.cells[f.key], tile, feature: tile };
    }
    return { ok: true, cells, encounter, message: complete ? THEMES[e.theme].complete :
      correct ? `${fixture.label} lights gold. ${progress.length}/3 seals aligned.` : 'The seals darken. Read the inscription and try another order.' };
  }
  const api = { VERSION, THEMES, chooseTheme, enrichSceneSpec, install, inReach, interact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LivingEnvironments = api;
})(typeof window === 'undefined' ? globalThis : window);
