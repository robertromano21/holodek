// Environmental hazards on the client: walking in triggers them (no click, no menu). The server decides whether a die
// roll is needed; only that roll pauses play. Clicking is optional and only for deliberate actions (inspect, test, seal, dispel).
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RoomHazardsUi = api; api.start(); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const FALL_MS = 900, PULSE_MS = 700, PUFF_CYCLE = 2400, ROLL_MS = 1100;
  // First-person fall: accelerating drop, landing thud, then the climb back to the rim.
  const DROP_MS = 1250, LAND_MS = 450, RISE_MS = 700, EYE = .65;
  const timelines = new WeakMap(), lastTiles = new Map(), rolls = new Map();
  let pending = false, timer = null, roomScope = null, held = null, fall = null, overlay = null;
  const clock = () => Date.now();
  const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  const pcName = () => (root.combatCharacters || []).find(a => a.type === 'pc')?.name;
  // The automatic roll spins on that character's portrait slot with the shared dice animation, then shows its result.
  function showDice(dice) {
    if (!dice?.id || !dice.actor || typeof root.receiveDiceState !== 'function') return 0;
    if (!rolls.has(dice.id)) {
      const state = root.actionDiceState || {};
      if (state.active) return 0;
      rolls.set(dice.id, clock()); if (rolls.size > 32) rolls.delete(rolls.keys().next().value);
      root.receiveDiceState({ ...state, type: 'dice_state', results: [...(state.results || []).filter(r => r.id !== dice.id).slice(-7), dice] });
    }
    return Math.max(0, rolls.get(dice.id) + ROLL_MS - clock());
  }
  // Hold a hazard's world change until its die has finished rolling; a newer world change flushes it first.
  function hold(dungeon, data) {
    if (!dungeon || data?._hazardReleased || !data?.hazardEvent?.dice) return false;
    flush(); const left = showDice(data.hazardEvent.dice);
    if (!left) return false;
    held = { data, timer: setTimeout(flush, left) };
    return true;
  }
  function flush() {
    if (!held) return; const { data, timer: t } = held; held = null; clearTimeout(t);
    data._hazardReleased = true; root.applyLivingEnvironmentDelta?.(data);
  }
  function shade(color, alpha) {
    const doc = root.document; if (!doc?.body) return;
    if (!overlay) {
      overlay = doc.createElement('div'); overlay.className = 'hazard-fall-shade'; overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '40', opacity: '0', transition: 'opacity 120ms linear' });
      (doc.getElementById('dungeon-container') || doc.body).appendChild(overlay);
    }
    overlay.style.background = color || '#000'; overlay.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  }
  function startFall(dungeon, effect) {
    const h = (dungeon.roomHazards?.hazards || []).find(z => (z.keys || []).includes(effect.key) || (z.gap || []).includes(effect.key));
    const p = parse(effect.key), cells = dungeon.cells || {};
    // Tumble off the side of the span into the open chasm beside it.
    const sides = h?.axis === 'y' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    const side = sides.find(([dx, dy]) => cells[key(p.x + dx, p.y + dy)]?.hazardGap) || sides[0];
    const fromZ = Number.isFinite(root.playerZ) ? root.playerZ : (cells[effect.key]?.floorHeight || 0) + EYE;
    const landing = Number.isFinite(effect.landing) ? effect.landing : fromZ - EYE - (effect.depth || 6);
    fall = { at: clock(), side, fromZ, landZ: landing + 1, fog: effect.fog || '#050506', relocate: null, landed: false, seed: p.x * 31 + p.y };
    root.clearDungeonMoveKeys?.();
  }
  function finishFall() {
    const relocate = fall?.relocate; fall = null;
    if (relocate) root.applyHazardRelocate?.(relocate);
    shade(null, 0); root.renderDungeonView?.();
  }
  // Renderer hook: eye height, a sideways tumble and pitch while falling; null otherwise.
  function camera(t = clock()) {
    if (!fall) return null;
    const age = t - fall.at, sfx = root.HolodekSfx;
    if (age < DROP_MS) {
      const q = age / DROP_MS, out = Math.min(1, q * 3) * .9;
      shade(fall.fog, .15 + .7 * q);
      return { eyeZ: fall.fromZ - (fall.fromZ - fall.landZ) * q * q, dx: fall.side[0] * out, dy: fall.side[1] * out,
        shift: -.06 - .1 * q + .04 * Math.sin(age / 65) * q, falling: true };
    }
    if (!fall.landed) { fall.landed = true; try { sfx?.play?.('crit', { rate: .55 }); setTimeout(() => sfx?.play?.('hurt'), 90); } catch {} }
    const u = age - DROP_MS, jolt = Math.max(0, 1 - u / LAND_MS), j = n => Math.sin(age / 23 + n + fall.seed) * .14 * jolt;
    if (u < LAND_MS) { shade(fall.fog, .85); return { eyeZ: fall.landZ - .3 * jolt, dx: fall.side[0] * .9 + j(1), dy: fall.side[1] * .9 + j(2), shift: .05 * jolt + j(3) * .3, falling: true }; }
    const r = (u - LAND_MS) / RISE_MS;
    if (r < 1) { shade('#000', .85 + .15 * r); return { eyeZ: fall.landZ, dx: fall.side[0] * .9, dy: fall.side[1] * .9, shift: -.15 * r, falling: true }; }
    finishFall(); return null;
  }
  // The crosser's own move back to the rim waits until the fall has played; party NPCs move at once.
  function relocateNow(dungeon, data) {
    const all = data?.hazardEvent?.relocate || {}, pc = pcName();
    if (!fall || !pc || !all[pc]) return all;
    fall.relocate = { [pc]: all[pc] }; const rest = { ...all }; delete rest[pc]; return rest;
  }
  const now = () => root.DungeonLife?.time?.() ?? Date.now();
  const live = h => h && !['collapsed', 'sealed', 'dormant', 'broken', 'cleared'].includes(h.state);
  const key = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  const parse = k => { const [x, y] = k.split(',').map(Number); return { x, y }; };
  function zoneHazards(dungeon, k) { return (dungeon?.roomHazards?.hazards || []).filter(h => live(h) && h.zone.includes(k)); }
  // Who just stepped into a hazard zone? Pure so it can be tested without a browser.
  function entries(dungeon, movers, memory = lastTiles) {
    const out = [];
    for (const m of movers) {
      if (!m?.name || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
      const k = key(m.x, m.y), prev = memory.get(m.name);
      memory.set(m.name, k);
      if (prev === k) continue;
      for (const h of zoneHazards(dungeon, k)) if (!prev || !h.zone.includes(prev)) out.push({ hazardId: h.id, actor: m.name, from: prev ? parse(prev) : null, to: parse(k) });
    }
    return out;
  }
  function movers(context) {
    const roomKey = context.dungeon?.geoKey, list = [];
    const actors = context.actors || [];
    const pc = actors.find(a => a.type === 'pc');
    if (pc && context.player) list.push({ name: pc.name, x: context.player.x, y: context.player.y });
    for (const a of actors) if (a.type === 'npc' && Number.isFinite(a.mazeX) && (!a.mazeRoomKey || a.mazeRoomKey === roomKey) && (a.hp ?? 1) > 0)
      list.push({ name: a.name, x: (a.mazePoint?.x ?? a.mazeX + .5), y: (a.mazePoint?.y ?? a.mazeY + .5) });
    return list;
  }
  async function tick() {
    // Exploration only: hazards are ignored while combat is active.
    if (pending || root.gamePaused || root._gameOver || root.actionDiceState?.active || root._combatCommandPending || root._combatRoundActiveUntil > Date.now() || root.isCombatModeActive?.()) return;
    const context = root.getDungeonLifeContext?.();
    if (!context?.dungeon?.roomHazards?.hazards?.length || context.busy) return;
    const scope=String(root.dungeonRunId)+':'+context.dungeon.geoKey;
    if(roomScope!==scope){lastTiles.clear();roomScope=scope;}
    const hits = entries(context.dungeon, movers(context));
    if (!hits.length) return;
    pending = true;
    try {
      for (const hit of hits) {
        const response = await fetch('/room-hazards/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: root.dungeonRunId, geoKey: context.dungeon.geoKey, ...hit, player: context.player,
            actors: (context.actors || []).map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })) }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { if (response.status !== 409) console.warn('[RoomHazards]', result.error); lastTiles.delete(hit.actor); continue; }
        if (result.dice) await wait(showDice(result.dice));
        if (result.updatedGameConsole) await root.applyRealtimeCombatResult?.(result);
      }
    } catch (error) { for(const hit of hits)lastTiles.delete(hit.actor);console.warn('[RoomHazards]', error.message); }
    finally { pending = false; }
  }
  // "Pause on hazard rolls" lives in the Help & controls panel beside the controller option. Off by default.
  const SETTING = 'holodek-hazard-rolls';
  let pauseRolls = false; try { pauseRolls = JSON.parse(root.localStorage?.getItem(SETTING) || '{}').pause === true; } catch {}
  function setPauseRolls(on) {
    pauseRolls = !!on; try { root.localStorage?.setItem(SETTING, JSON.stringify({ pause: pauseRolls })); } catch {}
    if (root.dungeonRunId && typeof root.fetch === 'function') root.fetch('/room-hazards/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: root.dungeonRunId, pauseRolls }) }).catch(() => {});
    return pauseRolls;
  }
  let optionAdded = false, syncedRun = null;
  function addOption() {
    const panel = root.document?.getElementById('player-help'); if (!panel || optionAdded) return;
    const anchor = panel.querySelector('.enable-controller')?.closest('label'); if (!anchor) return;
    const label = root.document.createElement('label'); label.innerHTML = '<input type="checkbox" class="hazard-pause-rolls"> Pause on hazard rolls';
    const box = label.querySelector('input'); box.checked = pauseRolls; box.onchange = () => setPauseRolls(box.checked);
    anchor.before(label, root.document.createElement('br')); optionAdded = true;
  }
  function start() {
    if (!timer && typeof root.setInterval === 'function') timer = root.setInterval(() => {
      addOption();
      if (root.dungeonRunId && syncedRun !== root.dungeonRunId) { syncedRun = root.dungeonRunId; setPauseRolls(pauseRolls); }
      tick();
    }, 120);
  }
  // Called before a cell delta is applied, so falling pieces keep the old voxel tile.
  function begin(dungeon, data) {
    const event = data?.hazardEvent; if (!dungeon || !event) return;
    const list = timelines.get(dungeon) || [];
    for (const e of event.effects || []) {
      if (e.type === 'creak') for (const k of e.keys) {
        // A loose board tumbles out from under the planks; the walkable bridge cell itself stays.
        const c = dungeon.cells[k]; if (c) list.push({ type: 'plank', key: k, tile: c.tile, at: now(), floor: c.floorHeight || 0 });
      } else if (e.type === 'collapse') for (const k of e.keys) {
        const c = dungeon.cells[k]; if (!c) continue;
        // A kept span loses planks that tumble the whole way down the rift.
        const deep = (event.effects || []).find(f => f.type === 'fall' && f.key === k)?.depth;
        list.push({ type: e.keep ? 'plank' : 'fall', key: k, tile: c.tile, at: now(), floor: c.floorHeight || 0, ...(e.keep && deep ? { deep } : {}) });
      } else if (e.type === 'fall' && e.actor && e.actor === pcName() && Number.isFinite(e.depth) && e.depth >= 6) startFall(dungeon, e); else if (['pulse', 'gas'].includes(e.type) && e.keys?.length) list.push({ type: e.type, keys: e.keys, at: now() });
    }
    timelines.set(dungeon, list);
    const sfx = root.HolodekSfx; if (!sfx?.play) return;
    const types = new Set((event.effects || []).map(e => e.type));
    if (types.has('collapse')) sfx.play('crit');
    else if (types.has('creak')) sfx.play('step2', { rate: .6 });
    if (types.has('fall')) setTimeout(() => sfx.play('hurt'), 350);
    if (types.has('gas') && Object.keys(event.damage || {}).length) sfx.play('vox_hiss');
    if (types.has('pulse')) sfx.play('spell');
    if (types.has('sealed') || types.has('dispelled')) sfx.play('door');
  }
  function parts(dungeon, t = now()) {
    const out = [], list = timelines.get(dungeon) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], age = t - e.at;
      if (e.type === 'plank') {
        const span = e.deep ? DROP_MS : FALL_MS; if (age > span) { list.splice(i, 1); continue; }
        const p = parse(e.key), q = age / span;
        out.push({ tile: e.tile, key: e.key, position: { x: p.x + .4, y: p.y + .3, z: e.floor - .05 - (e.deep || 3.2) * q * q }, size: { x: e.deep ? .9 : .2, y: .45, z: .12 } });
      } else if (e.type === 'fall') {
        if (age > FALL_MS) { list.splice(i, 1); continue; }
        const p = parse(e.key), q = age / FALL_MS, drop = 3.2 * q * q, tilt = .15 * q;
        out.push({ tile: e.tile, key: e.key, position: { x: p.x + tilt, y: p.y, z: e.floor - drop }, size: { x: 1, y: 1, z: .4 } });
      } else if (e.type === 'pulse' || e.type === 'gas') {
        if (age > PULSE_MS * 2) { list.splice(i, 1); continue; }
        const p = parse(e.keys[0]), r = .4 + 2.2 * age / (PULSE_MS * 2);
        const c = dungeon.cells[e.keys[0]], z = (c?.floorHeight || 0) + (e.type === 'gas' ? .2 + age / 900 : 1.1);
        out.push({ tile: 'custom_hazard_gas_puff', key: e.keys[0], position: { x: p.x + .5 - r / 2, y: p.y + .5 - r / 2, z }, size: { x: r, y: r, z: r * .5 } });
      } else list.splice(i, 1);
    }
    // Armed vents keep emitting voxel puffs that rise and fade out of the cell.
    for (const h of dungeon?.roomHazards?.hazards || []) {
      if (h.kind !== 'gas_vent' || !live(h) || !dungeon.tiles?.custom_hazard_gas_puff) continue;
      const p = parse(h.keys[0]), c = dungeon.cells[h.keys[0]], base = c?.floorHeight || 0;
      for (let n = 0; n < 3; n++) {
        const q = ((t / PUFF_CYCLE) + n / 3 + (p.x * 7 + p.y * 3) % 10 / 10) % 1, s = .22 + .5 * q;
        out.push({ tile: 'custom_hazard_gas_puff', key: h.keys[0], position: { x: p.x + .5 - s / 2 + .12 * Math.sin(q * 6 + n), y: p.y + .5 - s / 2, z: base + .15 + 1.6 * q }, size: { x: s, y: s, z: s } });
      }
    }
    return out;
  }
  function active(dungeon) { return !!fall || !!held || (timelines.get(dungeon) || []).length > 0 || (dungeon?.roomHazards?.hazards || []).some(h => h.kind === 'gas_vent' && live(h)); }
  // Optional click targets for WorldInteractionUi. One deliberate command each; never required to move.
  function candidates(dungeon, player) {
    const out = [];
    for (const h of dungeon?.roomHazards?.hazards || []) {
      const k = h.keys[0] || h.gap?.[0]; if (!k) continue;
      const p = parse(k), d = Math.min(...[...h.keys, ...h.zone].map(z => { const q = parse(z); return Math.hypot(q.x + .5 - player.x, q.y + .5 - player.y); }));
      if (d > 18) continue;
      const c = dungeon.cells[k] || {}, label = h.label.replace(/^./, s => s.toUpperCase());
      const command = !live(h) ? `inspect the ${h.label}` : h.commands?.disarm || h.commands?.careful || (h.kind === 'ward_stone' ? `dispel the ${h.label}` : h.kind === 'gas_vent' ? `seal the ${h.label}` :
        h.kind === 'unstable_floor' ? `test the ${h.label}` : `cross the ${h.label} carefully`);
      out.push({ type: 'hazard', hazard: h, key: k, x: p.x + .5, y: p.y + .5, width: h.kind === 'ward_stone' ? .7 : 1,
        height: Math.max(.25, c.structureHeight || .3), label: `${label}${live(h) ? '' : ' (' + h.state + ')'}`, command, enabled: d <= 3,
        detail: d <= 3 ? h.description || '' : '', hint: d <= 3 ? '' : 'Walk closer to act on it' });
    }
    return out;
  }
  return { pauseRolls: () => pauseRolls, setPauseRolls, entries, movers, tick, start, begin, parts, active, candidates, FALL_MS,
    showDice, hold, flush, camera, relocateNow, falling: () => !!fall, DROP_MS, LAND_MS, RISE_MS };
});
