(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItemInteractionUi = api;
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  function reachable(dungeon, player, item, radius) {
    if (!player || !item || !Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return false;
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
  function nearby(dungeon, items, player, radius = 0.75) {
    return (items || []).filter(item => item?.name && (!(item.geoKey ?? item.roomKey) || (item.geoKey ?? item.roomKey) === dungeon.geoKey) && reachable(dungeon, player, item, radius))
      .sort((a, b) => Math.hypot(a.x + 0.5 - player.x, a.y + 0.5 - player.y) - Math.hypot(b.x + 0.5 - player.x, b.y + 0.5 - player.y))[0] || null;
  }
  let room = null, prompted = null;
  function update(dungeon, items, player) {
    if (!dungeon) return;
    if (room !== dungeon) {
      room = dungeon; prompted = null;
      document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove();
    }
    if (prompted && !(items || []).some(item => item === prompted && reachable(dungeon, player, item, 1.5))) {
      prompted = null; document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove();
    }
    if (document.hidden || root.InventoryUi?.isOpen() || root._characterStartupPending || root._combatCommandPending || root.actionDiceState?.active ||
        root._combatRoundActiveUntil > Date.now() || document.activeElement?.id === 'chatuserinput' || document.querySelector('.popup-container')) return;
    const near = nearby(dungeon, items, player);
    if (!near || near === prompted) return;
    const link = [...document.querySelectorAll('#phaser-container .clickable-object')]
      .find(link => String(link.getAttribute('data-object')).trim().toLowerCase() === near.name.trim().toLowerCase());
    if (!link) return;
    link.click();
    const popup = document.querySelector('.popup-container[data-dungeon-item]');
    if (popup) { popup.dataset.dungeonItemProximity = 'true'; prompted = near; }
  }
  function reset() { room = prompted = null; if (typeof document !== 'undefined') document.querySelector('.popup-container[data-dungeon-item-proximity]')?.remove(); }
  return { nearby, reachable, update, reset };
});
