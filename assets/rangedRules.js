(function(root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.RangedRules = api; })(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // world1 RANGED_COMBAT. Extends EquipmentRules (range_tiles, clear sight via dungeonReach.lineClear, -4 when threatened):
  // adds distance falloff, cover, AMMO (item-held, separate from Magic/Tech), reload, heat, recovery, genre weapons,
  // and rare costType:'resource' items that spend the character's Magic:/Tech: stat instead of ammo.
  // Ammo is never a shared pool with Magic/Tech. Melee stays unlimited.
  const AMMO = { arrows: { label: 'Arrows', recover: .5, price: 1, per: 10 }, bolts: { label: 'Bolts', recover: .5, price: 1, per: 10 }, stones: { label: 'Sling stones', recover: .7, price: 0, per: 20 },
    throwing: { label: 'Throwing blades', recover: .8, price: 2, per: 3 }, javelins: { label: 'Javelins', recover: .6, price: 2, per: 3 }, shot: { label: 'Powder & shot', recover: 0, price: 1, per: 10 },
    bullets: { label: 'Bullets', recover: 0, price: 1, per: 12 }, rounds: { label: 'Rounds', recover: 0, price: 2, per: 20 }, shells: { label: 'Shells', recover: 0, price: 2, per: 8 },
    cells: { label: 'Power cells', recover: 0, price: 3, per: 20 }, pellets: { label: 'Air pellets', recover: 0, price: 1, per: 30 }, scrap: { label: 'Scrap rounds', recover: .2, price: 0, per: 10 },
    smart: { label: 'Smart rounds', recover: 0, price: 4, per: 20 }, harpoons: { label: 'Harpoons', recover: .6, price: 3, per: 2 } };
  const W = (name, genres, damage_dice, range, ammo, mag, reload, extra = {}) => ({ name, genres, damage_dice, range_tiles: range, ammo, magazine: mag, reload, costType: 'ammo', fx: extra.fx || 'arrow', sid: extra.sid || 'twang', price_silver: extra.price ?? 8, ...extra });
  const FANTASY = ['fantasy', 'dark-fantasy', 'mythic', 'cotg'];
  const WEAPONS = [
    W('shortbow', FANTASY, '1d6', 12, 'arrows', 0, 0, { price: 6 }), W('longbow', FANTASY, '1d8', 20, 'arrows', 0, 0, { price: 10 }),
    W('light crossbow', FANTASY, '1d8', 16, 'bolts', 1, 1, { fx: 'bolt', sid: 'clack', price: 8 }), W('sling', FANTASY, '1d4', 10, 'stones', 0, 0, { fx: 'stone', sid: 'whirr', price: 2 }),
    W('throwing axe', FANTASY, '1d6', 6, 'throwing', 0, 0, { fx: 'spin', sid: 'whoosh', price: 4 }), W('throwing knives', [...FANTASY, 'western', 'noir', 'cosmic-horror'], '1d4', 6, 'throwing', 0, 0, { fx: 'spin', sid: 'whoosh', price: 3 }),
    W('javelin', ['mythic', 'fantasy', 'cotg'], '1d6', 8, 'javelins', 0, 0, { fx: 'spear', sid: 'whoosh', price: 3 }),
    W('revolver', ['western', 'noir', 'cosmic-horror', 'modern'], '1d8', 10, 'bullets', 6, 1, { fx: 'tracer', sid: 'bang', price: 12, cheapAmmo: true }), W('lever rifle', ['western'], '1d10', 18, 'bullets', 8, 2, { fx: 'tracer', sid: 'crack', price: 18 }),
    W('shotgun', ['western', 'modern', 'post-apocalyptic'], '2d6', 6, 'shells', 2, 1, { fx: 'spread', sid: 'boom', price: 16, falloffSteep: true }),
    W('flintlock', ['nautical', 'steampunk'], '1d10', 8, 'shot', 1, 2, { fx: 'smoke', sid: 'boom', price: 12 }), W('harpoon gun', ['nautical'], '1d10', 8, 'harpoons', 1, 2, { fx: 'spear', sid: 'thunk', price: 14 }),
    W('blaster pistol', ['sci-fi'], '1d8', 12, 'cells', 10, 1, { fx: 'beam', sid: 'zap', price: 20, heat: { per: 2, limit: 8, cool: 3 } }), W('blaster rifle', ['sci-fi'], '1d10', 20, 'cells', 20, 1, { fx: 'beam', sid: 'zap', price: 30, heat: { per: 3, limit: 9, cool: 3 } }),
    W('smartgun', ['cyberpunk'], '1d10', 16, 'smart', 20, 1, { fx: 'tracer', sid: 'burst', price: 32, smart: 2 }), W('compact smg', ['cyberpunk', 'modern'], '1d6', 10, 'rounds', 20, 1, { fx: 'tracer', sid: 'burst', price: 18 }),
    W('pistol', ['modern', 'noir'], '1d8', 10, 'bullets', 12, 1, { fx: 'tracer', sid: 'bang', price: 12 }), W('rifle', ['modern'], '1d10', 20, 'rounds', 10, 1, { fx: 'tracer', sid: 'crack', price: 22 }),
    W('tommy gun', ['noir'], '1d8', 10, 'rounds', 20, 2, { fx: 'tracer', sid: 'burst', price: 26 }), W('air rifle', ['steampunk'], '1d8', 16, 'pellets', 10, 2, { fx: 'stone', sid: 'hiss', price: 16 }),
    W('arc pistol', ['steampunk'], '1d8', 8, 'cells', 6, 1, { fx: 'arc', sid: 'zap', price: 22, heat: { per: 3, limit: 9, cool: 3 } }), W('scrap rifle', ['post-apocalyptic'], '1d10', 14, 'scrap', 5, 2, { fx: 'tracer', sid: 'crack', price: 8, jam: .08 }),
    W('crossbow (scrap)', ['post-apocalyptic'], '1d8', 14, 'bolts', 1, 1, { fx: 'bolt', sid: 'clack', price: 6 }),
    // Rare, high-powered: spend the character's Magic:/Tech: stat, never ammo. Placed sparingly (loot weight .02, never in shop stock).
    W('wand of embers', FANTASY, '2d6', 10, null, 0, 0, { costType: 'resource', cost: 2, rare: true, fx: 'bolt_magic', sid: 'chime', price: 120 }),
    W('staff of the storm', FANTASY, '3d6', 12, null, 0, 0, { costType: 'resource', cost: 3, rare: true, fx: 'arc', sid: 'thunder', price: 200 }),
    W('plasma lance', ['sci-fi', 'cyberpunk'], '3d8', 14, null, 0, 0, { costType: 'resource', cost: 4, rare: true, fx: 'beam', sid: 'roar', price: 260 }),
    W('railgun overcharge', ['sci-fi', 'cyberpunk'], '4d6', 24, null, 0, 0, { costType: 'resource', cost: 5, rare: true, fx: 'beam', sid: 'crack', price: 300 }),
    W('emp burst', ['sci-fi', 'cyberpunk', 'modern'], '2d6', 6, null, 0, 0, { costType: 'resource', cost: 3, rare: true, fx: 'ring', sid: 'zap', price: 180, blast: 2 }),
    W('orbital beacon', ['sci-fi'], '5d6', 30, null, 0, 0, { costType: 'resource', cost: 6, rare: true, fx: 'pillar', sid: 'roar', price: 400, blast: 2 }),
    // Western Luck: heroic moves spend Luck (regenerates with rest); they still fire the equipped revolver's own ammo.
    W('quick draw', ['western'], '1d8', 10, null, 0, 0, { costType: 'resource', cost: 1, move: true, rare: false, firstStrike: true, fx: 'tracer', sid: 'bang', price: 0 }),
    W('fan the hammer', ['western'], '3d8', 8, null, 0, 0, { costType: 'resource', cost: 2, move: true, usesAmmo: 3, fx: 'tracer', sid: 'burst', price: 0 }),
    W('trick shot', ['western'], '1d10', 14, null, 0, 0, { costType: 'resource', cost: 2, move: true, ignoresCover: true, fx: 'tracer', sid: 'crack', price: 0 }),
    W('dead-eye shot', ['western'], '3d10', 20, null, 0, 0, { costType: 'resource', cost: 3, move: true, autoHit: true, fx: 'tracer', sid: 'crack', price: 0 }),
    W('lucky dodge', ['western'], null, 0, null, 0, 0, { costType: 'resource', cost: 1, move: true, ward: 6, fx: 'ring', sid: 'chime', price: 0 }),
    W('shrug it off', ['western'], null, 0, null, 0, 0, { costType: 'resource', cost: 2, move: true, heal: 6, fx: 'ring', sid: 'chime', price: 0 }),
    W('lucky silver revolver', ['western'], '2d8', 12, null, 0, 0, { costType: 'resource', cost: 2, rare: true, fx: 'tracer', sid: 'bang', price: 240 }),
    W('shield projector', ['sci-fi', 'steampunk'], null, 4, null, 0, 0, { costType: 'resource', cost: 3, rare: true, fx: 'ring', sid: 'hum', price: 220, ward: 10 })
  ];
  const BY = Object.fromEntries(WEAPONS.map(w => [w.name, w]));
  const TECH = ['sci-fi', 'cyberpunk', 'steampunk'];
  // The character stat (Magic:) keeps its rules everywhere; only its name changes by genre. Children of the Grave is always Magic.
  // The character stat keeps its rules everywhere; only its NAME changes by genre. Children of the Grave is always Magic;
  // a homebrew bible's resourceName overrides; anything unknown falls back to Luck.
  const RESOURCE_NAMES = { fantasy: 'Magic', 'dark-fantasy': 'Magic', mythic: 'Magic', 'cosmic-horror': 'Magic', 'sci-fi': 'Tech', cyberpunk: 'Tech', steampunk: 'Tech',
    western: 'Luck', modern: 'Luck', noir: 'Luck', 'post-apocalyptic': 'Luck', nautical: 'Luck' };
  const resourceLabel = (genre, setting) => genre === 'cotg' || (!genre && !setting) ? 'Magic' : setting?.resourceName || setting?.resourceLabel || RESOURCE_NAMES[genre] || 'Luck';
  const key = v => String(v?.name || v || '').trim().toLowerCase();
  function find(name) { const k = key(name); return BY[k] || WEAPONS.find(w => k.includes(w.name)) || null; }
  const forGenre = g => WEAPONS.filter(w => w.genres.includes(g || 'cotg'));
  // To-hit falloff: none inside half range, -2 to full range, -4 out to 1.5x (long shot); beyond that no shot.
  function falloff(w, distance) { const r = w.range_tiles; if (distance > r * 1.5) return null; const steep = w.falloffSteep ? 2 : 1;
    return distance <= r / 2 ? 0 : distance <= r ? -2 * steep : -4 * steep; }
  // Cover: blocking tiles adjacent to the target on the shooter's side. Half cover +2 AC, three-quarter +4.
  const BLOCK = new Set(['wall', 'pillar', 'statue', 'crate', 'barrel', 'boulder', 'rubble']);
  function cover(dungeon, from, to) { if (!dungeon?.cells || !from || !to) return 0; const dx = Math.sign(from.x - to.x), dy = Math.sign(from.y - to.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
    const cells = [...new Set([[dx, dy], [dx, 0], [0, dy]].filter(([a, b]) => a || b).map(([a, b]) => `${a},${b}`))].map(k => k.split(',').map(Number)).map(([a, b]) => dungeon.cells[`${tx + a},${ty + b}`]).filter(c => c && (BLOCK.has(c.tile) || c.tile?.startsWith('lm_') && c.collisionBlocking !== false || (c.structureHeight || 0) >= .5));
    return cells.length >= 2 ? 4 : cells.length ? 2 : 0; }
  // Ammo state lives on the item (per actor + weapon); never shared with Magic/Tech.
  function state(store, actor, w) { const id = `${key(actor)}|${w.name}`; store[id] ||= { weapon: w.name, ammo: w.ammo, reserve: w.ammo ? AMMO[w.ammo].per * (w.magazine ? 2 : 1) : 0, loaded: w.magazine || 0, heat: 0, spent: 0 }; return store[id]; }
  // Fire one shot. resource: { get(), spend(n) } for costType:'resource' items. Returns { ok, message, reload, empty, overheated }.
  function fire(store, actor, w, resource, rand = Math.random) {
    if (w.costType === 'resource') { const have = resource?.get() ?? 0, label = resource?.label || 'Magic';
      if (have < w.cost) return { ok: false, empty: true, message: `${actorName(actor)} is out of ${label} for the ${w.name} (needs ${w.cost}, has ${have}).` };
      resource.spend(w.cost); return { ok: true, spentResource: w.cost, message: `${actorName(actor)} channels ${w.cost} ${label} into the ${w.name}.` }; }
    const s = state(store, actor, w), A = AMMO[w.ammo];
    if (w.heat && s.heat >= w.heat.limit) return { ok: false, overheated: true, message: `${actorName(actor)}'s ${w.name} is overheated and must cool.` };
    if (w.magazine) { if (s.loaded <= 0) { if (s.reserve <= 0) return { ok: false, empty: true, message: `${actorName(actor)} is out of ${A.label.toLowerCase()}.` };
        const n = Math.min(w.magazine, s.reserve); s.reserve -= n; s.loaded = n; return { ok: false, reload: true, message: `${actorName(actor)} reloads the ${w.name} (${s.loaded}/${w.magazine}).` }; }
      if (w.jam && rand() < w.jam) return { ok: false, jammed: true, message: `${actorName(actor)}'s ${w.name} jams.` };
      s.loaded--; }
    else { if (s.reserve <= 0) return { ok: false, empty: true, message: `${actorName(actor)} is out of ${A.label.toLowerCase()}.` }; s.reserve--; }
    if (w.heat) s.heat += w.heat.per; s.spent++;
    return { ok: true, message: null };
  }
  function cool(store) { for (const s of Object.values(store)) { const w = BY[s.weapon]; if (w?.heat) s.heat = Math.max(0, s.heat - w.heat.cool); } }
  // After combat: recover a share of spent arrows/bolts/stones/blades.
  function recover(store, rand = Math.random) { const out = []; for (const s of Object.values(store)) { const A = AMMO[s.ammo]; if (!A?.recover || !s.spent) { s.spent = 0; continue; }
      let n = 0; for (let i = 0; i < s.spent; i++) if (rand() < A.recover) n++; s.reserve += n; s.spent = 0; if (n) out.push({ weapon: s.weapon, ammo: s.ammo, recovered: n }); } return out; }
  function refill(store, actor, w, count) { const s = state(store, actor, w); s.reserve += count; return s; }
  function readout(store, actor, w) { if (!w) return ''; if (w.costType === 'resource') return `${w.name}: ${w.cost} per use (rare)`;
    const s = state(store, actor, w), A = AMMO[w.ammo]; return w.magazine ? `${A.label}: ${s.loaded}/${w.magazine} (+${s.reserve})${w.heat ? ` Heat ${s.heat}/${w.heat.limit}` : ''}` : `${A.label}: ${s.reserve}`; }
  function tooltip(w) { if (!w) return ''; const base = `${w.damage_dice || 'no'} damage, range ${w.range_tiles} tiles (long shots to ${w.range_tiles * 1.5}, -2/-4 beyond half range). Requires clear sight; -4 when an enemy threatens you; cover gives targets +2/+4 AC.`;
    return w.costType === 'resource' ? `RARE, HIGH-POWERED. ${base} Spends ${w.cost} of your Magic/Tech stat per use; uses no ammo.` : `${base} Uses ${AMMO[w.ammo].label.toLowerCase()}${w.magazine ? `, ${w.magazine} per load, reload ${w.reload} action` : ''}${w.heat ? `; heats ${w.heat.per}/shot, overheats at ${w.heat.limit}` : ''}${AMMO[w.ammo].recover ? '; some can be recovered after combat' : ''}.`; }
  function actorName(a) { return a?.name || a?.Name || String(a || 'Someone'); }
  // Loot / shops: ammo-cost weapons and ammo bundles in stock; resource items only as rare loot.
  const stock = genre => [...forGenre(genre).filter(w => !w.rare && !w.move).map(w => ({ name: w.name, type: 'weapon', damage_dice: w.damage_dice, range_tiles: w.range_tiles, price_silver: w.price_silver, quantity: 1, description: tooltip(w) })),
    ...[...new Set(forGenre(genre).filter(w => w.ammo).map(w => w.ammo))].map(a => ({ name: `${AMMO[a].label.toLowerCase()} (${AMMO[a].per})`, type: 'ammo', ammo: a, count: AMMO[a].per, price_silver: Math.max(1, AMMO[a].price * 2), quantity: 4, description: `Ammunition: ${AMMO[a].per} ${AMMO[a].label.toLowerCase()} added to the separate Ammo: count (not Magic/Tech/Luck) for weapons that fire ${AMMO[a].label.toLowerCase()}.` }))];
  function lootRoll(genre, rand = Math.random) { const pool = forGenre(genre).filter(w => !w.move); if (!pool.length) return null; const rare = pool.filter(w => w.rare);
    if (rare.length && rand() < .02) return rare[Math.floor(rand() * rare.length)]; const ammo = pool.filter(w => w.ammo); const w = ammo[Math.floor(rand() * ammo.length)];
    return rand() < .7 ? { ammoBundle: w.ammo, count: Math.ceil(AMMO[w.ammo].per / 2) } : w; }
  // Party AI: ranged users keep distance (step back when an enemy is adjacent and there is room).
  const keepDistance = (w, nearestEnemy) => !!w && nearestEnemy <= 1.5 && w.range_tiles > 3;
  return { RESOURCE_NAMES, AMMO, WEAPONS, BY, TECH, resourceLabel, find, forGenre, falloff, cover, state, fire, cool, recover, refill, readout, tooltip, stock, lootRoll, keepDistance };
});
