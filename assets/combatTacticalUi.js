(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CombatTacticalUi = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  let active = false, saved = null, savedScroll = null, turn = null, moving = false, angle = null;
  let roomKey = null, specialFloor = false, floorEpoch = 0;
  function changeFloor(key, special = false) {
    const changed = roomKey !== key, reset = changed && (specialFloor || special);
    roomKey = key; specialFloor = special;
    if (!changed) return;
    floorEpoch++; moving = false;
    if (!reset) return;
    receive(null);
    root.CombatTurnUi?.receive(null);
    turn = null; angle = null;
    const s = scene();
    if (s) {
      s._lastDungeonDraw = null; s.combatActorHitTargets = []; s._userScrolledCombatMap = false;
      s.renderRT?.clear(); s.actorRT?.clear();
      if (s.domContainer) { s.domContainer.scrollLeft = 0; s.domContainer.scrollTop = 0; }
    }
    redraw();
  }
  function tileAt(draw, x, y, scale = 1) {
    if (!draw || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dx = x / scale - draw.centerX, dy = y / scale - draw.centerY, c = Math.cos(draw.combatAngle), s = Math.sin(draw.combatAngle);
    return { x: Math.floor(draw.pos.x + (dx * c + dy * s) / draw.cs - .5),
      y: Math.floor(draw.pos.y + (-dx * s + dy * c) / draw.cs - .5) };
  }
  function dimensions(width, height, zoom = 1) {
    const w = Math.min(1300, width - 24), h = Math.min(880, height * .82, height - 24);
    return { width: w / zoom, height: h / zoom, left: (width - w) / zoom / 2, top: (height - h) / zoom / 2,
      stacked: w / zoom < 640 };
  }
  function scene() { return root.combatGame?.scene?.getScene('CombatScene'); }
  function redraw() { const s = scene(); s?.sys?.game?.loop?.wake(); s?.redrawCombatRT?.(); }
  function layout(animate = false) {
    const box = document.getElementById('combat-popup'); if (!box || !active) return;
    box.style.display = 'block';
    const before = box.getBoundingClientRect();
    const zoom = box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
    const d = dimensions(root.innerWidth, root.innerHeight, zoom);
    const references = document.getElementById('command-library-menu')?.getBoundingClientRect();
    if (references?.top > root.innerHeight / 2) {
      d.height = Math.min(d.height, Math.max(120, 2 * (references.top - 12 - root.innerHeight / 2) / zoom));
      d.top = (root.innerHeight / zoom - d.height) / 2;
    }
    box.classList.add('combat-expanded'); box.classList.toggle('combat-stacked', d.stacked);
    Object.assign(box.style, { display: 'block', position: 'fixed', left: d.left + 'px', top: d.top + 'px', width: d.width + 'px', height: d.height + 'px', maxWidth: 'none', maxHeight: 'none', resize: 'none', zIndex: '15000' });
    const after = box.getBoundingClientRect();
    if (animate && before.width && before.height && !root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      box.animate?.([{ transformOrigin: '0 0', transform: `translate(${(before.left - after.left) / zoom}px,${(before.top - after.top) / zoom}px) scale(${before.width / after.width},${before.height / after.height})` },
        { transformOrigin: '0 0', transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    const s = scene();
    if (s) { s._userScrolledCombatMap = false; s.centerCameraOn?.(15, 15, true); }
    redraw();
  }
  function receive(state) {
    const incomingKey = state?.active?.turn?.geoKey || state?.active?.geoKey;
    if (incomingKey && roomKey && incomingKey !== roomKey) return;
    const next = state?.active?.kind === 'combat'; turn = state?.active?.turn || null;
    if (next && !active) {
      const box = document.getElementById('combat-popup'), s = scene();
      if (box) saved = box.style.cssText;
      savedScroll = s ? { manual: s._userScrolledCombatMap, left: s.domContainer?.scrollLeft, top: s.domContainer?.scrollTop } : null;
      active = true; angle = null; layout(true);
    } else if (!next && active) {
      active = false; turn = null; moving = false; angle = null;
      const box = document.getElementById('combat-popup');
      if (box) { box.classList.remove('combat-expanded', 'combat-stacked'); box.style.cssText = saved || ''; }
      const s = scene(); if (s && savedScroll) { s._userScrolledCombatMap = savedScroll.manual;
        if (s.domContainer) { s.domContainer.scrollLeft = savedScroll.left; s.domContainer.scrollTop = savedScroll.top; } }
      saved = null; redraw();
    } else if (next) redraw();
  }
  async function move(tile) {
    const current = turn;
    const epoch = floorEpoch;
    if (!active || !current?.tactical || moving || current.movement?.busy || root.gamePaused || root.actionDiceState?.paused) return false;
    if (!current.movement.tiles.some(t => t.x === tile?.x && t.y === tile?.y)) return false;
    moving = true;
    try {
      const response = await fetch('/combat/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        x: tile.x, y: tile.y, revision: current.movement.revision, runId: current.runId, geoKey: current.geoKey,
        actionId: current.actionId, turnId: current.turnId, combatant: current.combatant }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'Movement could not resolve.');
      if (epoch !== floorEpoch) return false;
      if (turn?.turnId === current.turnId && result.turn?.turnId === current.turnId && result.turn.movement.revision >= turn.movement.revision) {
        turn = result.turn; root.CombatTurnUi?.receive(turn);
      }
    } catch (error) { if (epoch === floorEpoch) root.CombatTurnUi?.notice(error.message); }
    finally { if (epoch === floorEpoch) { moving = false; redraw(); } }
    return true;
  }
  function click(actor, draw, x, y, scale) {
    if (!active || !turn?.tactical) return false;
    if (actor && turn.attackTargets?.includes(actor.name)) { root.CombatTurnUi?.submit('attack', actor.name); return true; }
    const tile = tileAt(draw, x, y, scale);
    if (tile && turn.movement?.tiles.some(t => t.x === tile.x && t.y === tile.y)) { move(tile); return true; }
    return false;
  }
  function draw(scene, draw) {
    if (!active || !turn?.tactical || !scene?.make?.graphics) return;
    const gfx = scene.make.graphics({ add: false });
    gfx.lineStyle(1, 0xe5bd72, .85); gfx.fillStyle(0x52896b, .22);
    for (const tile of turn.movement?.tiles || []) {
      const x = (tile.x + 1 - draw.pos.x) * draw.cs, y = (tile.y + 1 - draw.pos.y) * draw.cs;
      gfx.fillRect(x - draw.cs / 2 + 1, y - draw.cs / 2 + 1, draw.cs - 2, draw.cs - 2);
      gfx.strokeRect(x - draw.cs / 2 + 1, y - draw.cs / 2 + 1, draw.cs - 2, draw.cs - 2);
    }
    gfx.setPosition(draw.centerX, draw.centerY); gfx.setRotation(draw.combatAngle); scene.renderRT.draw(gfx); gfx.destroy();
  }
  root.addEventListener?.('resize', () => layout());
  return { receive, changeFloor, layout, move, click, draw, tileAt, dimensions, active: () => active,
    angle(value) { if (!active) return value; if (angle === null) angle = value; return angle; } };
});
