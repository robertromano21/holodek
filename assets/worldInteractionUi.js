(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.WorldInteractionUi = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.bind(), { once: true });
    else api.bind();
  }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  let frame = null, pointer = null, caption = null, busy = false, bound = false;
  let propCache = null, drag = null, dragPreview = null, suppressClickUntil = 0;
  const presentationCanvases = new WeakMap();
  let captionPosition = null;
  function ray(camera, u, v) {
    const side = (2 * u - 1) * camera.planeScale;
    return { x: camera.dirX - camera.dirY * side, y: camera.dirY + camera.dirX * side,
      z: (.5 + (camera.viewShift || 0) - v) * 2 / camera.verticalScale };
  }
  function intersect(origin, dir, box) {
    let lo = 0, hi = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      if (Math.abs(dir[axis]) < .000001) { if (origin[axis] < box[axis] || origin[axis] > box[axis] + box['s' + axis]) return null; continue; }
      const a = (box[axis] - origin[axis]) / dir[axis], b = (box[axis] + box['s' + axis] - origin[axis]) / dir[axis];
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (hi < lo) return null;
    }
    return lo > .03 ? lo : hi > .03 ? hi : null;
  }
  function visible(dungeon, camera, dir, t, target) {
    for (let i = 1; i < Math.ceil(t * 24); i++) {
      const d = i / 24, x = camera.x + dir.x * d, y = camera.y + dir.y * d, z = camera.eyeZ + dir.z * d;
      const key = `${Math.floor(x)},${Math.floor(y)}`, c = dungeon.cells[key];
      if (key === target.key) continue;
      if (!c) return false;
      const f = c.floorHeight || 0;
      if (z < f || c.roof && z >= c.roof.height) return false;
      const solid = c.tile === 'wall' || c.tile === 'torch' || c.tile === 'door' && !c.door?.isOpen || c.tile?.startsWith('custom_') || c.tile === 'pillar';
      const height = c.structureHeight ?? Math.max(.5, (c.ceilHeight ?? f + 2) - f);
      if (solid && z >= f && z <= f + height) return false;
    }
    return true;
  }
  function candidates(dungeon, player) {
    const result = [], e = dungeon.physicalPuzzle, P = root.PhysicalPuzzles;
    for (const f of e?.fixtures || []) {
      const [x, y] = f.key.split(',').map(Number), i = e.definition.controls.findIndex(c => c.id === f.id);
      if (Math.hypot(x + .5 - player.x, y + .5 - player.y) > 18) continue;
      const near = P?.inReach(dungeon, player, f);
      const c = e.definition.controls[i];
      const value = c ? c.options[e.state.values[i]] : '';
      const inspect = f.id === 'plaque' || f.id === 'receiver';
      result.push({ type: 'puzzle', fixture: f, key: f.key, x: x + .5, y: y + .5, width: f.width, height: f.height,
        label: c ? `${f.label} | ${c.mark}: ${value}` : f.label,
        command: P.command(e.definition, f), enabled: near && (inspect || e.state.status !== 'complete'),
        hint: !near ? 'Walk closer to interact' : !inspect && e.state.status === 'complete' ? 'Complete' : '',
        detail: near && f.id === 'plaque' ? P.clue(e.definition) : near && f.id === 'receiver' && e.state.status === 'complete' ? e.definition.lore : '' });
    }
    for (const item of root.getVisibleSceneObjects?.() || []) {
      if (Math.hypot(item.x + .5 - player.x, item.y + .5 - player.y) > 18) continue;
      const near = root.ItemInteractionUi?.reachable(dungeon, player, item);
      result.push({ type: 'item', item, key: `${item.x},${item.y}`, x: item.x + .5, y: item.y + .5,
        width: .55, height: .5, label: item.name, enabled: !!near, hint: near ? '' : 'Walk closer to take' });
    }
    const x = Math.floor(player.x), y = Math.floor(player.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`, c = dungeon.cells[key];
      if (c?.tile !== 'door' || c.exit || c.door?.isOpen || c.door?.puzzleId || c.door?.questLocked || c.door?.keyId || c.door?.requiresKey) continue;
      result.push({ type: 'door', key, x: x + dx + .5, y: y + dy + .5, width: 1,
        height: Math.max(1, (c.ceilHeight ?? 2) - (c.floorHeight || 0)), label: 'Door', enabled: true, command: `open door ${key}` });
    }
    const stamp = `${dungeon._geometryStamp}:${x},${y}`;
    if (propCache?.dungeon !== dungeon || propCache.stamp !== stamp) {
      const props = [];
      for (let dy = -18; dy <= 18; dy++) for (let dx = -18; dx <= 18; dx++) {
        const key = `${x + dx},${y + dy}`, cell = dungeon.cells[key];
        if (!cell || cell.puzzleFixture || !(cell.tile === 'pillar' || cell.tile?.startsWith('custom_'))) continue;
        const tile = dungeon.tiles?.[cell.tile], spec = tile?.spriteSpec || {};
        const placed = dungeon.sceneLandmarks?.find(p => p.x === x + dx && p.y === y + dy);
        const label = placed?.label || tile?.landmark?.label || placed?.type || tile?.landmark?.type || spec.voxelShape || (cell.tile === 'pillar' ? 'Pillar' : 'Stonework');
        props.push({ type: 'prop', key, x: x + dx + .5, y: y + dy + .5, width: spec.baseWidth || .7,
          height: cell.structureHeight ?? Math.max(.5, ((cell.ceilHeight ?? 2) - (cell.floorHeight || 0)) * (spec.heightRatio || 1)),
          label: String(label).replace(/_/g, ' '), enabled: false });
      }
      propCache = { dungeon, stamp, props };
    }
    result.push(...propCache.props);
    return result;
  }
  function pick(dungeon, camera, player, u, v) {
    if (![u, v, camera?.x, camera?.y, camera?.eyeZ, camera?.dirX, camera?.dirY, camera?.planeScale, camera?.verticalScale].every(Number.isFinite) ||
        u < 0 || u > 1 || v < 0 || v > 1) return null;
    const dir = ray(camera, u, v), hits = [];
    for (const target of candidates(dungeon, player)) {
      const z = dungeon.cells[target.key]?.floorHeight || 0;
      const distance = intersect({ x: camera.x, y: camera.y, z: camera.eyeZ }, dir,
        { x: target.x - target.width / 2, y: target.y - target.width / 2, z, sx: target.width, sy: target.width, sz: target.height });
      if (distance !== null && visible(dungeon, camera, dir, distance, target)) hits.push({ ...target, distance });
    }
    return hits.sort((a, b) => a.distance - b.distance)[0] || null;
  }
  function interactionBlocked() {
    return busy || root.GameCommandGate?.busy() || root.gamePaused || document.hidden || root._characterStartupPending || root._combatCommandPending ||
      root.actionDiceState?.active || root._combatRoundActiveUntil > Date.now() || document.querySelector('.popup-container') || root.InventoryUi?.isOpen();
  }
  function blocked() { return drag?.active || interactionBlocked(); }
  function pageZoom(element) {
    let zoom = 1;
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const value = parseFloat(root.getComputedStyle(node).zoom);
      if (Number.isFinite(value) && value > 0) zoom *= value;
    }
    return zoom;
  }
  function positionCaption(text) {
    if (captionPosition?.x === pointer.x && captionPosition.y === pointer.y && captionPosition.text === text &&
        captionPosition.width === innerWidth && captionPosition.height === innerHeight) return;
    // Pointer coordinates are viewport pixels; fixed-position CSS inherits the page's zoom.
    const zoom = pageZoom(caption);
    caption.style.maxWidth = `${Math.max(0, Math.min(280, (innerWidth - 16) / zoom))}px`;
    const bounds = caption.getBoundingClientRect();
    caption.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, pointer.x + 18)) / zoom}px`;
    caption.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, pointer.y + 18)) / zoom}px`;
    captionPosition = { x: pointer.x, y: pointer.y, text, width: innerWidth, height: innerHeight };
  }
  function hover() {
    if (!frame || !pointer || pointer.canvas !== frame.canvas || blocked()) { clear(); return null; }
    const rect = frame.canvas.getBoundingClientRect();
    const target = pick(frame.dungeon, frame.camera, frame.player, (pointer.x - rect.left) / rect.width, (pointer.y - rect.top) / rect.height);
    frame.canvas.style.cursor = target?.enabled ? 'pointer' : 'default';
    frame.canvas.draggable = false;
    if (caption) {
      caption.hidden = !target;
      const text = target ? `${target.label}${target.detail ? ' - ' + target.detail : target.enabled ? ' - Click to ' + (target.type === 'item' ? 'take' : target.command) : target.hint ? ' - ' + target.hint : ''}` : '';
      if (caption.textContent !== text) caption.textContent = text;
      if (target) positionCaption(text);
    }
    return target;
  }
  function clear() {
    if (frame?.canvas) frame.canvas.style.cursor = 'default';
    if (frame?.canvas) frame.canvas.draggable = false;
    if (caption) caption.hidden = true;
    captionPosition = null;
  }
  async function activate(target) {
    if (!target?.enabled || blocked()) return;
    if (target.type === 'item') {
      [...document.querySelectorAll('#phaser-container .clickable-object')].find(e =>
        e.getAttribute('data-object')?.trim().toLowerCase() === target.label.toLowerCase())?.click();
      return;
    }
    const input = document.getElementById('chatuserinput');
    if (!input || typeof root.chatbotprocessinput !== 'function' || input.value.trim()) return;
    busy = true; input.value = target.command; clear();
    try { await root.chatbotprocessinput(); }
    catch (error) { console.error('[WorldInteraction]', error); }
    finally { busy = false; }
  }
  function backpackAt(x, y) {
    return document.elementFromPoint(x, y)?.closest?.('#dungeon-inventory-shortcut') || null;
  }
  function cancelDrag() {
    const pending = drag; drag = null;
    if (pending?.active) suppressClickUntil = Date.now() + 400;
    dragPreview?.remove(); dragPreview = null;
    document.getElementById('dungeon-inventory-shortcut')?.classList.remove('world-item-drop-hover');
    if (pending?.canvas.hasPointerCapture?.(pending.pointerId)) pending.canvas.releasePointerCapture(pending.pointerId);
    clear();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return false;
    if (interactionBlocked() || frame?.canvas !== drag.canvas || frame.dungeon.geoKey !== drag.geoKey) { cancelDrag(); return true; }
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
      drag.active = true;
      dragPreview = document.createElement('div'); dragPreview.id = 'world-item-drag-preview';
      dragPreview.style.cssText = 'position:fixed;display:flex;align-items:center;gap:6px;pointer-events:none;z-index:12020;padding:5px 8px;border:1px solid #d3ad64;border-radius:5px;background:#121a20ef;color:#ffe5ac;font:13px Georgia,serif;max-width:240px';
      const sprite = root.SceneItems?.createItemCanvas(drag.item);
      if (sprite) {
        const image = document.createElement('img'); image.src = sprite.toDataURL(); image.alt = '';
        image.style.cssText = 'width:32px;height:32px;object-fit:contain;image-rendering:pixelated'; dragPreview.appendChild(image);
      }
      const name = document.createElement('span'); name.textContent = drag.name; dragPreview.appendChild(name);
      document.body.appendChild(dragPreview); clear();
    }
    if (drag.active) {
      event.preventDefault(); event.stopPropagation();
      const pack = document.getElementById('dungeon-inventory-shortcut'), overPack = backpackAt(event.clientX, event.clientY);
      pack?.classList.toggle('world-item-drop-hover', !!overPack);
      const zoom = pageZoom(dragPreview);
      const bounds = dragPreview.getBoundingClientRect();
      dragPreview.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, event.clientX + 14)) / zoom}px`;
      dragPreview.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, event.clientY + 14)) / zoom}px`;
      dragPreview.style.borderColor = overPack ? '#9be5aa' : '#d3ad64';
    }
    return true;
  }
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pending = drag, overPack = pending.active && backpackAt(event.clientX, event.clientY);
    if (pending.active) { event.preventDefault(); event.stopPropagation(); suppressClickUntil = Date.now() + 400; }
    cancelDrag(); pointer = null;
    if (!overPack || interactionBlocked() || frame?.dungeon.geoKey !== pending.geoKey || root.currentDungeon?.geoKey !== pending.geoKey) return;
    const target = candidates(frame.dungeon, frame.player).find(t => t.type === 'item' && t.key === pending.key && t.label === pending.name && t.enabled);
    if (target) activate(target);
  }
  function setPresentationCanvas(source, canvas) {
    if (!source || !canvas) return;
    if (source === canvas) presentationCanvases.delete(source);
    else presentationCanvases.set(source, canvas);
    if (frame?.sourceCanvas === source && frame.canvas !== canvas) {
      cancelDrag(); pointer = null; frame.canvas = canvas;
    }
  }
  function updateFrame(dungeon, camera, sourceCanvas, player) {
    if (!sourceCanvas || !dungeon) return;
    // The camera comes from the renderer, but events belong to its visible presentation canvas.
    const canvas = presentationCanvases.get(sourceCanvas) || sourceCanvas;
    if (frame?.canvas !== canvas || drag && frame?.dungeon.geoKey !== dungeon.geoKey) { cancelDrag(); pointer = null; }
    canvas.draggable = false; canvas.style.touchAction = 'none';
    frame = { dungeon, camera, sourceCanvas, canvas, player };
    if (pointer) hover();
  }
  function bind() {
    if (bound) return; bound = true;
    caption = document.createElement('div'); caption.id = 'world-interaction-caption'; caption.hidden = true;
    caption.style.cssText = 'position:fixed;box-sizing:border-box;max-width:280px;padding:6px 9px;pointer-events:none;z-index:10018;color:#ffe5ac;background:#121a20df;font:14px Georgia,serif;text-shadow:0 1px 2px #000;border-left:2px solid #d3ad64';
    document.body.appendChild(caption);
    const style = document.createElement('style');
    style.textContent = '#dungeon-inventory-shortcut.world-item-drop-hover{outline:2px solid #9be5aa;outline-offset:3px;background:#254c2c}';
    document.head.appendChild(style);
    document.addEventListener('pointerdown', event => {
      if (event.target !== frame?.canvas || event.button !== 0 || event.isPrimary === false || blocked()) return;
      pointer = { x: event.clientX, y: event.clientY, canvas: event.target };
      const target = hover();
      if (target?.type !== 'item' || !target.enabled) return;
      event.preventDefault(); event.stopPropagation();
      drag = { name: target.label, key: target.key, geoKey: frame.dungeon.geoKey, item: target.item,
        canvas: event.target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
      // Canvas-native drag uses a screenshot of the entire game. Track the item instead.
      try { event.target.setPointerCapture(event.pointerId); } catch { /* Synthetic events may not have an active pointer. */ }
    }, true);
    document.addEventListener('pointermove', event => {
      if (moveDrag(event)) return;
      if (event.target !== frame?.canvas) { pointer = null; clear(); return; }
      pointer = { x: event.clientX, y: event.clientY, canvas: event.target }; hover();
    }, true);
    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('pointercancel', event => { if (event.pointerId === drag?.pointerId) cancelDrag(); }, true);
    document.addEventListener('lostpointercapture', event => { if (event.pointerId === drag?.pointerId) cancelDrag(); }, true);
    document.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil && (event.target === frame?.canvas || event.target.closest?.('#dungeon-inventory-shortcut'))) {
        suppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.target !== frame?.canvas || event.button) return;
      pointer = { x: event.clientX, y: event.clientY, canvas: event.target };
      const target = hover();
      if (target?.enabled) { event.preventDefault(); activate(target); }
    }, true);
    document.addEventListener('dragstart', event => {
      if (event.target === frame?.canvas) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
    }, true);
    root.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { pointer = null; cancelDrag(); } });
  }
  return { ray, intersect, pick, updateFrame, setPresentationCanvas, activate, bind };
});
