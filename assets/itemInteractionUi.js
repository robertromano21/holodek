(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItemInteractionUi = api;
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const TAKE_RANGE = 2.5;
  const PROXIMITY_RANGE = 1.25;
  const itemKey = item => [item.id || String(item.name || '').trim().toLowerCase(), item.x, item.y].join('|');
  function reachable(dungeon, player, item, radius = TAKE_RANGE) {
    if (!dungeon || !player || !item || !Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
        (item.geoKey ?? item.roomKey) && (item.geoKey ?? item.roomKey) !== dungeon.geoKey) return false;
    const dx = item.x + 0.5 - player.x, dy = item.y + 0.5 - player.y, distance = Math.hypot(dx, dy);
    if (distance > radius) return false;
    const floor = dungeon.cells?.[`${Math.floor(player.x)},${Math.floor(player.y)}`]?.floorHeight || 0;
    const steps = Math.max(1, Math.ceil(distance * 8));
    for (let i = 0; i <= steps; i++) {
      const cell = dungeon.cells?.[`${Math.floor(player.x + dx * i / steps)},${Math.floor(player.y + dy * i / steps)}`];
      if (!cell || cell.blocked || cell.obstacle || cell.walkable === false || cell.tile !== 'floor' && !(cell.tile === 'door' && cell.door?.isOpen) ||
          Math.abs((cell.floorHeight || 0) - floor) > 0.75) return false;
    }
    return true;
  }
  function nearby(dungeon, items, player, radius = PROXIMITY_RANGE) {
    return (items || []).filter(item => item?.name && (!(item.geoKey ?? item.roomKey) || (item.geoKey ?? item.roomKey) === dungeon.geoKey) && reachable(dungeon, player, item, radius))
      .sort((a, b) => Math.hypot(a.x + 0.5 - player.x, a.y + 0.5 - player.y) - Math.hypot(b.x + 0.5 - player.x, b.y + 0.5 - player.y))[0] || null;
  }
  let room = null, prompted = null, pending = false;
  async function take(name) {
    if (pending || !root.CommerceUi?.handleCommand) return false;
    pending = true;
    try { return await root.CommerceUi.handleCommand('take ' + name); }
    finally { pending = false; }
  }
  function prompt(name) {
    if (root.ObjectDiscovery && !root.ObjectDiscovery.isVisible(root.currentDungeon || room, name)) return false;
    const link = [...document.querySelectorAll('#phaser-container .clickable-object')]
      .find(link => String(link.getAttribute('data-object')).trim().toLowerCase() === name.trim().toLowerCase());
    if (link) { link.click(); return true; }
    if (!root.CommerceUi?.handleCommand) return false;
    document.querySelector('.popup-container[data-dungeon-item]')?.remove();
    const popup = document.createElement('div'); popup.className = 'popup-container'; popup.dataset.dungeonItem = name;
    popup.setAttribute('role','dialog'); popup.setAttribute('aria-label','Take ' + name);
    const text = document.createElement('p'); text.textContent = 'Take ' + name + '?'; popup.appendChild(text);
    for (const label of ['Take','Cancel']) {
      const button = document.createElement('button'); button.type = 'button'; button.className='popup-button'; button.textContent=label;
      button.addEventListener('click',()=>{popup.remove();if(label==='Take')take(name);}); popup.appendChild(button);
    }
    root.WorldInteractionUi?.addReadAction(popup,name); document.body.appendChild(popup); return true;
  }
  function update(dungeon, items, player) {
    if (!dungeon) return;
    const allItems = items || [];
    if (room !== dungeon) {
      room = dungeon; prompted = null;
      document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove();
    }
    // Outdoor placement returns fresh projections each frame; object identity is not loot identity.
    if (prompted && !allItems.some(item => itemKey(item) === prompted && reachable(dungeon, player, item, 1.5))) {
      prompted = null; document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove();
    }
    if(root.ObjectDiscovery)items=allItems.filter(item=>root.ObjectDiscovery.isVisible(dungeon,item.name));
    if (pending || root.PlayerControls?.blocked?.() || root.gamePaused || root._gameOver || document.hidden || root.GameCommandGate?.busy() || root.InventoryUi?.isOpen() || root._characterStartupPending || root._combatCommandPending || root.actionDiceState?.active ||
        root._combatRoundActiveUntil > Date.now() || document.activeElement?.id === 'chatuserinput' || document.querySelector('.popup-container')) return;
    const automatic = root.PlayerControls?.autoTake() === true;
    const near = nearby(dungeon, items, player, PROXIMITY_RANGE);
    if (!near || itemKey(near) === prompted) return;
    if (automatic) { prompted = itemKey(near); take(near.name); return; }
    if (!prompt(near.name)) return;
    const popup = document.querySelector('.popup-container[data-dungeon-item]');
    if (popup) { popup.dataset.dungeonItemProximity = 'true'; prompted = itemKey(near); }
  }
  function reset() { room = prompted = null; if (typeof document !== 'undefined') document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove(); }
  return { isTaking: () => pending, TAKE_RANGE, PROXIMITY_RANGE, nearby, reachable, update, reset, take, prompt };
});
