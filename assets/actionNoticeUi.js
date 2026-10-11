(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DungeonActionNotices = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const queue = [], seen = new Set();
  let panel, portrait, title, status, message, active = null, room = '', itemSnapshot = null, serial = 0;
  const context = () => root.getDungeonLifeContext?.();
  const clock = () => root.DungeonLife?.time?.() ?? Date.now();
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const fallbackIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64"><path fill="#d8bc7a" d="M16 4h16v8h6v16h-6v8h8v8h4v16H4V44h4v-8h8v-8h-6V12h6z"/><path fill="#30251c" d="M18 16h12v8H18zM20 38h8v22h-8z"/></svg>');
  function sameRoom(event) { return event.runId === root.dungeonRunId && event.geoKey === context()?.dungeon?.geoKey; }
  function receive(event) {
    if (!sameRoom(event) || !clean(event.id) || !clean(event.title) || !clean(event.message) || seen.has(event.id)) return false;
    seen.add(event.id); if (seen.size > 128) seen.delete(seen.values().next().value);
    const row = { ...event, title: event.title.slice(0, 100), message: event.message.slice(0, 700) };
    if (event.kind === 'puzzle-complete') {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'puzzle-control') queue.splice(i, 1);
      if (active?.kind === 'puzzle-control') active = null;
      queue.unshift(row);
    } else queue.push(row);
    if (queue.length > 20) {
      const optional = queue.findIndex(row => !['puzzle-complete', 'defeat'].includes(row.kind));
      queue.splice(optional < 0 ? 0 : optional, 1);
    }
    tick();
    return true;
  }
  function iconFor(event) {
    const name = event.subject || event.actor;
    const actor = context()?.actors?.find(a => a.name === name);
    const icon = event.icon || actor?.sprite?.dataUrl || root.resolveKnownCharacterSprite?.(name)?.dataUrl;
    return /^data:image\//i.test(icon || '') ? icon : fallbackIcon;
  }
  function fit() {
    if (!panel) return;
    const input = document.getElementById('chatuserinput'), bounds = input?.getBoundingClientRect();
    const zoom = bounds && input.offsetWidth ? bounds.width / input.offsetWidth : 1;
    const width = Math.max(150, Math.min(440, root.innerWidth / zoom - 24, bounds?.width / zoom || 440));
    panel.style.width = width + 'px';
    panel.style.left = Math.max(12, Math.min(root.innerWidth / zoom - width - 12,
      (bounds ? bounds.left + bounds.width / 2 : root.innerWidth / 2) / zoom - width / 2)) + 'px';
    const dialogue = document.getElementById('dungeon-dialogue');
    const top = dialogue && !dialogue.hidden ? Math.min(bounds?.top ?? root.innerHeight, dialogue.getBoundingClientRect().top) : bounds?.top;
    panel.style.bottom = Math.max(12, (root.innerHeight - (top ?? root.innerHeight)) / zoom + 12) + 'px';
  }
  function tick() {
    const ctx = context(), key = `${root.dungeonRunId}:${ctx?.dungeon?.geoKey || ''}`;
    if (key !== room) {
      room = key; active = null; itemSnapshot = null;
      for (let i = queue.length - 1; i >= 0; i--) if (!sameRoom(queue[i])) queue.splice(i, 1);
      if (panel) panel.hidden = true;
    }
    if (!panel || root.gamePaused) return;
    if (active && clock() >= active.until) { active = null; panel.hidden = true; }
    if (!active && queue.length) {
      const row = queue.shift();
      if (!sameRoom(row)) return;
      active = { ...row, until: clock() + (row.kind === 'puzzle-complete' ? 7500 : Math.min(9000, Math.max(3500, row.message.length * 22))) };
      title.textContent = row.title;
      const labels = { success: 'Success', partial: 'Partial Progress', failure: 'Failed', blocked: 'Cannot Do That',
        observed: 'Examined', defeated: 'Defeated', resolved: 'Action Resolved' };
      status.textContent = row.kind === 'puzzle-complete' ? 'Puzzle Solved' : row.kind === 'item-taken' ? 'Item Taken' :
        [clean(row.activity).replace(/([a-z])([A-Z])/g, '$1 $2'), labels[row.result], Number.isFinite(row.roll) ? `d20 ${row.roll}` : ''].filter(Boolean).join(' / ');
      message.textContent = row.message;
      portrait.src = iconFor(row); panel.dataset.kind = row.kind; panel.hidden = false;
      console.info('[ActionNoticeDisplayed]', { id: row.id, geoKey: row.geoKey, kind: row.kind, title: row.title, message: row.message });
    }
    if (active) fit();
  }
  function observeItems(snapshot) {
    if (!snapshot?.geoKey || snapshot.geoKey !== context()?.dungeon?.geoKey || !root.InventoryUi) return [];
    tick();
    const objects = root.InventoryUi.inventoryItems(snapshot.objects, snapshot.objectsProperties);
    const inventory = root.InventoryUi.inventoryItems(snapshot.inventory, snapshot.inventoryProperties);
    const current = { runId: root.dungeonRunId, geoKey: snapshot.geoKey, objects, inventory };
    const previous = itemSnapshot; itemSnapshot = current;
    if (!previous || previous.runId !== current.runId || previous.geoKey !== current.geoKey) return [];
    const taken = previous.objects.filter(old => !objects.some(item => item.id === old.id) &&
      (inventory.find(item => item.id === old.id)?.quantity || 0) > (previous.inventory.find(item => item.id === old.id)?.quantity || 0));
    for (const item of taken) {
      const metadata = inventory.find(i => i.id === item.id) || item;
      const icon = root.SceneItems?.createItemCanvas?.(metadata)?.toDataURL?.('image/png');
      receive({ type: 'action_notice', runId: current.runId, geoKey: current.geoKey, id: `${current.runId}:pickup:${++serial}`,
        kind: 'item-taken', title: item.name, message: 'Added to your backpack.', icon });
    }
    return taken;
  }
  function reset() {
    queue.length = 0; seen.clear(); active = null; itemSnapshot = null; room = '';
    if (panel) panel.hidden = true;
  }
  function dismiss() {
    if (active) console.info('[ActionNoticeDismissed]', { id: active.id, geoKey: active.geoKey, reason: 'player-dismissed' });
    active = null;
    if (panel) panel.hidden = true;
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = '#dungeon-action-notice{position:fixed;z-index:2150;display:flex;gap:10px;align-items:center;box-sizing:border-box;padding:10px 13px;pointer-events:none;background:linear-gradient(135deg,rgba(32,28,21,.97),rgba(10,10,10,.94));border:1px solid #a48d62;border-radius:7px;color:#eee;font:15px/1.3 Georgia,serif;box-shadow:0 5px 22px #0008}#dungeon-action-notice[hidden]{display:none}#dungeon-action-notice img{width:42px;height:56px;object-fit:contain;image-rendering:pixelated;flex:none}#dungeon-action-notice strong{display:block;color:#ead29d;font-size:15px}#dungeon-action-notice small{display:block;color:#c5bba5;font-size:11px;margin:3px 0 5px}#dungeon-action-notice[data-kind=defeat]{border-color:#ad7768}#dungeon-action-notice[data-kind=puzzle-complete]{border-color:#a9bd79}';
    document.head.appendChild(style);
    const dismissStyle = document.createElement('style');
    dismissStyle.textContent = '#dungeon-action-notice{padding-right:44px}#dungeon-action-notice .dungeon-message-close{position:absolute;top:4px;right:4px;width:32px;height:32px;padding:0;margin:0;border:0;border-radius:4px;background:transparent;color:#ead29d;font:16px Georgia,serif;cursor:pointer;pointer-events:auto}#dungeon-action-notice .dungeon-message-close:hover{background:#ffffff1c}#dungeon-action-notice .dungeon-message-close:focus-visible{outline:1px solid #ead29d;outline-offset:1px}';
    document.head.appendChild(dismissStyle);
    panel = document.createElement('div'); panel.id = 'dungeon-action-notice'; panel.hidden = true;
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    portrait = document.createElement('img'); portrait.alt = '';
    const body = document.createElement('div'); title = document.createElement('strong');
    status = document.createElement('small'); message = document.createElement('div');
    body.append(title, status, message); panel.append(portrait, body); document.body.appendChild(panel);
    const close = document.createElement('button'); close.id = 'dungeon-action-notice-close'; close.type = 'button';
    close.className = 'dungeon-message-close'; close.textContent = 'X';
    close.setAttribute('aria-label', 'Dismiss action notice'); close.title = 'Dismiss this action notice';
    for (const type of ['pointerdown', 'pointerup', 'keydown']) close.addEventListener(type, event => {
      if (type !== 'keydown' || event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    close.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); dismiss(); close.blur(); });
    panel.appendChild(close);
    root.addEventListener('resize', fit); setInterval(tick, 200);
  }
  return { receive, observeItems, reset, tick, init, dismiss };
});
