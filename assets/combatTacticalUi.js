(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CombatTacticalUi = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  let active = false, saved = null, savedScroll = null, turn = null, moving = false, angle = null;
  let roomKey = null, specialFloor = false, floorEpoch = 0;
  let mapZoom = 1.75;
  let savedCameraZoom = null;
  let ledgerState = null, legacyEntries = [], legacyBlock = '';
  function cellScale() { return active ? 1.25 : 1; }
  function actorPoint(actor, at) {
    if (!active) return { x: at.x + .5, y: at.y + .5 };
    const origin = actor?.type === 'pc' ? { x: Math.floor(at.x), y: Math.floor(at.y) } : at;
    return root.CombatFootprint?.center(actor, origin) || { x: origin.x + .5, y: origin.y + .5 };
  }
  function applyMapZoom(s = scene()) {
    const camera = s?.cameras?.main;
    if (!camera) return;
    if (active) {
      if (savedCameraZoom === null) savedCameraZoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
      camera.setZoom(mapZoom);
    } else if (savedCameraZoom !== null) {
      camera.setZoom(savedCameraZoom); savedCameraZoom = null;
    }
  }
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
      s._lastDungeonDraw = null; s.combatHoverPoint = null; s.combatHoverActor = null; s.combatActorHitTargets = []; s._userScrolledCombatMap = false;
      s.renderRT?.clear(); s.actorRT?.clear();
      if (s.domContainer) { s.domContainer.scrollLeft = 0; s.domContainer.scrollTop = 0; }
    }
    redraw();
  }
  function tileAt(draw, x, y, scale = 1) {
    if (!draw || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dx = x / scale - draw.centerX, dy = y / scale - draw.centerY, c = Math.cos(draw.combatAngle), s = Math.sin(draw.combatAngle);
    return { x: Math.floor(draw.pos.x + (dx * c + dy * s) / draw.cs),
      y: Math.floor(draw.pos.y + (-dx * s + dy * c) / draw.cs) };
  }
  function dimensions(width, height, zoom = 1, rightEdge = width, leftEdge = 0) {
    const edge = Math.min(width, rightEdge), left = Math.max(0, Math.min(leftEdge, edge - 25));
    const w = Math.max(1, edge - left - 12), h = Math.min(1000, height * .86, height - 24);
    return { width: w / zoom, height: h / zoom, left: left / zoom, top: (height - h) / zoom / 2,
      stacked: w / zoom < 480 };
  }
  function combatBounds(width, height, zoom, rects = {}) {
    const panels = [rects.console, rects.log].filter(Boolean), shortcuts = rects.shortcuts || [];
    const right = Math.min(width - 12, ...panels.filter(r => r.left > width / 2).map(r => r.left - 12));
    const left = Math.max(96, rects.party ? rects.party.right + 12 : 0), top = Math.max(24, height * .025);
    const commands = [rects.command, rects.references].filter(Boolean);
    const bottom = Math.min(height - 12, ...commands.filter(r => r.right > left && r.left < right).map(r => r.top - 12));
    let candidates = [{ left, right, top, bottom }];
    for (const obstacle of shortcuts) candidates = candidates.flatMap(b => {
      if (b.right <= obstacle.left - 12 || b.left >= obstacle.right + 12 || b.bottom <= obstacle.top - 12 || b.top >= obstacle.bottom + 12) return [b];
      return [{ ...b, right: obstacle.left - 12 }, { ...b, bottom: obstacle.top - 12 }];
    });
    const best = candidates.filter(b => (b.right - b.left) / zoom >= 480 && (b.bottom - b.top) / zoom >= 160)
      .sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0];
    if (width >= 900 && best) return { left: best.left / zoom, top: best.top / zoom,
      width: (best.right - best.left) / zoom, height: (best.bottom - best.top) / zoom, stacked: false, compact: false };
    const lower = [rects.party, ...commands, ...shortcuts].filter(r => r?.top > 48);
    const availableBottom = Math.min(height - 12, ...lower.map(r => r.top - 12));
    return { left: 12 / zoom, top: 12 / zoom, width: Math.max(1, width - 24) / zoom,
      height: Math.max(1, availableBottom - 12) / zoom, stacked: (width - 24) / zoom < 480, compact: true };
  }
  function ledgerContent(state) {
    const active = state?.active, data = active?.ledger;
    const order = data?.initiative?.length ? data.initiative : active?.turn?.initiative?.length ? active.turn.initiative :
      (state?.results || []).filter(r => r.label === 'Initiative').map(r => ({ name: r.actor, roll: r.total }));
    const initiative = [...order].filter(a => {
      const actor = (root.combatCharacters || []).find(c => c.name === a.name);
      return !actor || (root.DungeonInhabitants?.canAct ? root.DungeonInhabitants.canAct(actor) :
        (actor.hp ?? actor.HP ?? 1) > 0 && !/^(Unconscious|Dying|Dead)$/i.test(actor.state || actor.State || ''));
    }).sort((a, b) => b.roll - a.roll).map(a => `${a.name} (${a.roll})`).join(', ');
    const entries = (data?.entries || legacyEntries).map(e => e.kind === 'hit' ?
      `${e.actor} hits ${e.target} for ${e.damage} damage.\n${e.target} has ${Math.max(0, e.hp)} HP left.` :
      e.kind === 'miss' ? `${e.actor} misses ${e.target}.` : String(e.text || '').trim()).filter(Boolean);
    return { initiative: initiative ? 'Initiative: ' + initiative : 'Initiative: rolling...', entries,
      pending: state?.pending ? `${state.pending.actor}: roll ${state.pending.label.toLowerCase()} at the party controls.` : '' };
  }
  function receiveLog(log) {
    if (!active || ledgerState?.active?.ledger || typeof log !== 'string' || log === legacyBlock) return;
    legacyBlock = log;
    for (const line of log.split(/\r?\n/)) if (/\b(?:hits .+ for \d+ damage|misses .+|has -?\d+ HP left)\b/.test(line))
      legacyEntries.push({ kind: 'notice', text: line.replace(/\.{2,}/g, '.').replace(/\. (?=.+ has -?\d+ HP left)/, '.\n') });
    legacyEntries = legacyEntries.slice(-60); ledger();
  }
  function scene() { return root.combatGame?.scene?.getScene('CombatScene'); }
  function redraw() { const s = scene(); s?.sys?.game?.loop?.wake(); s?.redrawCombatRT?.(); }
  function ledger(state) {
    if (state) ledgerState = state;
    const box = document.getElementById('combat-popup'); if (!box) return;
    let panel = document.getElementById('combat-ledger');
    const created = !panel;
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'combat-ledger'; panel.setAttribute('aria-label', 'Combat ledger');
      const heading = document.createElement('h2'); heading.textContent = 'Combat Ledger'; panel.appendChild(heading);
      const initiative = document.createElement('p'); initiative.id = 'combat-ledger-initiative'; panel.appendChild(initiative);
      const entries = document.createElement('div'); entries.id = 'combat-ledger-entries'; entries.setAttribute('role', 'log'); entries.setAttribute('aria-live', 'polite'); panel.appendChild(entries);
      const pending = document.createElement('small'); pending.id = 'combat-ledger-pending'; panel.appendChild(pending);
      box.appendChild(panel);
    }
    const turnPanel = document.getElementById('combat-turn-popup'); if (turnPanel) panel.appendChild(turnPanel);
    const follow = created || panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 24;
    const content = ledgerContent(ledgerState), entries = document.getElementById('combat-ledger-entries');
    const text = content.entries.join('\n\n');
    if (entries && entries.textContent !== text) entries.textContent = text;
    const initiative = document.getElementById('combat-ledger-initiative'), pending = document.getElementById('combat-ledger-pending');
    if (initiative) initiative.textContent = content.initiative;
    if (pending) pending.textContent = content.pending;
    if (follow) panel.scrollTop = panel.scrollHeight;
  }
  function layout(animate = false) {
    const box = document.getElementById('combat-popup'); if (!box || !active) return;
    box.style.display = 'block';
    const before = box.getBoundingClientRect();
    const zoom = box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
    const rect = id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r?.width > 0 && r.height > 0 ? r : null; };
    const d = combatBounds(root.innerWidth, root.innerHeight, zoom, { console: rect('phaser-popup'), log: rect('game-log-popup'),
      party: rect('party-icon-dock'), command: rect('chatbotcontainer'), references: rect('command-library-menu'),
      shortcuts: ['dungeon-map-shortcut', 'dungeon-journal-shortcut', 'dungeon-inventory-shortcut', 'dungeon-spellbook-shortcut'].map(rect).filter(Boolean) });
    const compact = d.compact;
    document.body?.classList.toggle('combat-compact-map', compact);
    document.body?.classList.add('combat-map-active');
    box.classList.add('combat-expanded'); box.classList.toggle('combat-stacked', d.stacked);
    Object.assign(box.style, { display: 'block', position: 'fixed', left: d.left + 'px', top: d.top + 'px', width: d.width + 'px', height: d.height + 'px', maxWidth: 'none', maxHeight: 'none', resize: 'none', zIndex: '15000' });
    ledger();
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
      legacyEntries = []; legacyBlock = ''; ledgerState = state;
      const box = document.getElementById('combat-popup'), s = scene();
      if (box) saved = box.style.cssText;
      savedScroll = s ? { manual: s._userScrolledCombatMap, left: s.domContainer?.scrollLeft, top: s.domContainer?.scrollTop } : null;
      active = true; angle = null; mapZoom = 1.75; applyMapZoom(s); setMapZoom(mapZoom); layout(true);
    } else if (!next && active) {
      active = false; turn = null; moving = false; angle = null;
      const box = document.getElementById('combat-popup');
      if (box) { box.classList.remove('combat-expanded', 'combat-stacked'); box.style.cssText = saved || ''; }
      const panel = document.getElementById('combat-ledger'), turnPanel = document.getElementById('combat-turn-popup');
      if (box && turnPanel) box.appendChild(turnPanel);
      panel?.remove();
      document.querySelectorAll?.('.combat-target-actions').forEach(p => p.remove());
      document.body?.classList.remove('combat-compact-map', 'combat-map-active');
      const s = scene(); applyMapZoom(s);
      if (s && savedScroll) { s._userScrolledCombatMap = savedScroll.manual;
        if (s.domContainer) { s.domContainer.scrollLeft = savedScroll.left; s.domContainer.scrollTop = savedScroll.top; } }
      saved = null; redraw();
    } else if (next) redraw();
    if (next) ledger(state);
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
  function keyMove(event) {
    const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const direction = directions[event.key], s = scene(), draw = s?._lastDungeonDraw;
    if (!direction || !active || !turn?.tactical || !draw || event.ctrlKey || event.metaKey || event.altKey ||
        event.target?.closest?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"], #game-menu') ||
        document.querySelector?.('.combat-target-actions') || document.getElementById('combat-popup')?.style.display === 'none') return false;
    event.preventDefault(); event.stopImmediatePropagation?.();
    if (moving || turn.movement?.busy || root.gamePaused || root.actionDiceState?.paused) return true;
    const at = turn.movement?.position;
    if (!at) return true;
    const heading = Math.round((Math.atan2(direction[1], direction[0]) - draw.combatAngle) / (Math.PI / 4)) * Math.PI / 4;
    const tile = { x: Math.floor(at.x) + Math.round(Math.cos(heading)), y: Math.floor(at.y) + Math.round(Math.sin(heading)) };
    const actor = occupants(draw).find(a => a.name !== turn.combatant && a.cells.some(c => c.x === tile.x && c.y === tile.y));
    if (actor) root.CombatCharacterUi?.open(actor);
    else if (turn.movement.tiles.some(t => t.x === tile.x && t.y === tile.y)) move(tile);
    else root.CombatTurnUi?.notice('That square is not available: it is blocked, occupied, or beyond your remaining movement.');
    return true;
  }
  function click(actor, draw, x, y, scale) {
    if (!active || !turn?.tactical) return false;
    if (actor) { root.CombatCharacterUi?.open(actor); return true; }
    const tile = tileAt(draw, x, y, scale);
    const occupant = occupants(draw).find(a => a.cells.some(c => c.x === tile?.x && c.y === tile?.y));
    if (occupant) {
      root.CombatCharacterUi?.open(occupant);
      return true;
    }
    if (tile && turn.movement?.tiles.some(t => t.x === tile.x && t.y === tile.y)) { move(tile); return true; }
    if (tile) { root.CombatTurnUi?.notice('That square is not available: it is blocked, occupied, or beyond your remaining movement.'); return true; }
    return false;
  }
  function occupants(draw, actors = root.combatCharacters || []) {
    if (!draw?.dungeon) return [];
    // Downed allies cannot act, but their occupied tiles still select them for aid.
    const alive = a => root.DungeonInhabitants?.isAlive ? root.DungeonInhabitants.isAlive(a) :
      !/^dead$/i.test(a.state || a.State || a.status || '') &&
      ((a.hp ?? a.HP ?? 1) > 0 || /^(Dying|Unconscious)$/i.test(a.state || a.State || ''));
    return actors.filter(a => a && a.discoveryState !== 'pending' && alive(a) &&
      (!root.isDungeonActorPresent || root.isDungeonActorPresent(a)) &&
      (!a.mazeRoomKey || a.mazeRoomKey.replace(/\s/g, '') === draw.dungeon.geoKey?.replace(/\s/g, '')))
      .map(a => {
        const point = { x: Math.floor(a.type === 'pc' ? draw.pos.x : a.mazeX), y: Math.floor(a.type === 'pc' ? draw.pos.y : a.mazeY) };
        return { name: a.name, type: a.type,
        hostile: turn?.targets?.includes(a.name) || root.DungeonInhabitants?.state(a) === 'Hostile',
        ...point, cells: root.CombatFootprint?.cells(a, point) || [point] }; })
      .filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && draw.dungeon.cells[`${a.x},${a.y}`]);
  }
  function cellRect(gfx, draw, tile, fill, stroke, alpha = .12) {
    const x = (tile.x + .5 - draw.pos.x) * draw.cs, y = (tile.y + .5 - draw.pos.y) * draw.cs;
    if (fill !== null) { gfx.fillStyle(fill, alpha); gfx.fillRect(x - draw.cs / 2 + 1, y - draw.cs / 2 + 1, draw.cs - 2, draw.cs - 2); }
    if (stroke !== null) {
      gfx.lineStyle(1, 0x000000, 1); gfx.strokeRect(x - draw.cs / 2, y - draw.cs / 2, draw.cs, draw.cs);
      gfx.lineStyle(1, stroke, 1); gfx.strokeRect(x - draw.cs / 2 + 1, y - draw.cs / 2 + 1, draw.cs - 2, draw.cs - 2);
    }
  }
  function draw(scene, draw) {
    // Movement remains selectable; do not tint the floor with reachable-square fills.
  }
  function drawOverlay(scene, draw) {
    if (!draw || !scene?.make?.graphics) return;
    const gfx = scene.make.graphics({ add: false }), actors = occupants(draw);
    for (const a of actors) for (const cell of a.cells) cellRect(gfx, draw, cell, a.hostile ? 0xef766c : 0x67d5ef, a.hostile ? 0xef766c : 0x67d5ef, .08);
    const p = scene.combatHoverPoint, tile = p && tileAt(draw, p.x, p.y, scene.PIXEL_SCALE || 1);
    const valid = tile && draw.dungeon.cells[`${tile.x},${tile.y}`];
    const occupant = actors.find(a => a.name === scene.combatHoverActor?.name) ||
      valid && actors.find(a => a.cells.some(c => c.x === tile.x && c.y === tile.y));
    if (valid || occupant) for (const cell of occupant?.cells || [tile]) cellRect(gfx, draw, cell, 0xffffff, 0xffffff, .13);
    // Keep all ground-cell ink beneath the full-resolution avatar layer.
    gfx.setPosition(draw.centerX, draw.centerY); gfx.setRotation(draw.combatAngle);
    scene.renderRT.draw(gfx); gfx.destroy();
    const status = typeof document === 'object' && document.getElementById('combat-map-status');
    if (status) {
      const a = occupant;
      const move = valid && active && turn?.movement?.tiles.find(t => t.x === tile.x && t.y === tile.y);
      const approach = a && active && turn?.approachTargets?.find(t => t.name === a.name);
      status.hidden = !valid && !a;
      const prefix = a && !a.cells.some(c => c.x === tile?.x && c.y === tile?.y) ? 'Character: ' : `Square ${tile?.x}, ${tile?.y}: `;
      status.textContent = valid || a ? prefix + (a ? a.name + (active && turn?.targets?.includes(a.name) ?
        (turn.attackTargets?.includes(a.name) ? ' (attack available)' : approach ? ` (move ${approach.cost} tiles + attack)` : ' (out of range/sight)') : ' (occupied)') :
        move ? `Move (${move.cost} tiles)` : 'Not a movement destination') + (a?.cells.length > 1 ? ` | ${a.cells.length} occupied squares` : '') :
        '';
    }
    const canvas = scene.sys?.game?.canvas;
    if (canvas) { canvas.style.cursor = occupant ? 'pointer' : ''; canvas.title = occupant ? `${occupant.name}: click for actions` : ''; }
  }
  function setMapZoom(value) {
    if (![1.25, 1.5, 1.75].includes(value)) return;
    mapZoom = value;
    applyMapZoom();
    if (typeof document === 'object') document.querySelectorAll?.('[data-combat-zoom]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.combatZoom) === mapZoom)));
    redraw();
  }
  function bind(s) {
    const canvas = s.sys?.game?.canvas, container = document.getElementById('combat-container'), header = document.getElementById('combat-header');
    if (!canvas || !container) return;
    canvas.tabIndex = 0; canvas.setAttribute?.('aria-label', 'Combat map. Arrow keys move; select a character for actions.');
    if (header && !header.querySelector('.combat-map-zoom')) {
      const controls = document.createElement('span'); controls.className = 'combat-map-zoom'; controls.setAttribute('aria-label', 'Map zoom');
      for (const value of [1.25, 1.5, 1.75]) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.combatZoom = value;
        button.textContent = `${value * 100}%`; button.title = value === 1.25 ? 'Modest map zoom' : value === 1.5 ? 'Close map zoom' : 'Extra-close map zoom';
        button.addEventListener('click', () => setMapZoom(value)); controls.appendChild(button);
      }
      header.insertBefore(controls, header.lastElementChild);
    }
    if (!document.getElementById('combat-map-status')) {
      const status = document.createElement('div'); status.id = 'combat-map-status'; status.hidden = true; container.parentNode.appendChild(status);
    }
    const movePointer = event => {
      const rect = canvas.getBoundingClientRect();
      const point = s.cameras.main.getWorldPoint((event.clientX - rect.left) * s.scale.width / rect.width,
        (event.clientY - rect.top) * s.scale.height / rect.height);
      const before = s.combatHoverPoint && tileAt(s._lastDungeonDraw, s.combatHoverPoint.x, s.combatHoverPoint.y, s.PIXEL_SCALE);
      const after = tileAt(s._lastDungeonDraw, point.x, point.y, s.PIXEL_SCALE);
      const oldActor = s.combatHoverActor;
      s.combatHoverActor = root.CombatCharacterUi?.pickScene?.(s,point.x,point.y) || null;
      s.combatHoverPoint = point;
      if (before?.x !== after?.x || before?.y !== after?.y || oldActor?.name !== s.combatHoverActor?.name) redraw();
    };
    const clear = () => { canvas.style.cursor = ''; canvas.title = ''; if (s.combatHoverPoint || s.combatHoverActor) { s.combatHoverPoint = null; s.combatHoverActor = null; redraw(); } };
    canvas.addEventListener('pointermove', movePointer); canvas.addEventListener('pointerleave', clear); container.addEventListener('scroll', clear);
    s.events?.once('shutdown', () => {
      canvas.removeEventListener('pointermove', movePointer); canvas.removeEventListener('pointerleave', clear); container.removeEventListener('scroll', clear);
    });
    applyMapZoom(s);
    setMapZoom(mapZoom);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
    const dock = document.getElementById('party-icon-dock'); if (dock) observer?.observe(dock);
    s.events?.once('shutdown', () => observer?.disconnect());
  }
  root.addEventListener?.('resize', () => layout());
  root.addEventListener?.('keydown', keyMove, true);
  return { receive, receiveLog, ledgerContent, combatBounds, changeFloor, layout, move, keyMove, click, draw, drawOverlay, bind, occupants, tileAt, dimensions, setMapZoom, cellScale, actorPoint, active: () => active,
    refreshHealth() { if (active) ledger(); },
    angle(value) { if (!active) return value; if (angle === null) angle = value; return angle; } };
});
