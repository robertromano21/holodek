(function(root) {
  'use strict';
  function placement(command, buttonWidth, viewport, log, zoom = 1) {
    const gap = 8 * zoom, width = buttonWidth * zoom;
    const next = command.right + gap;
    const boundary = log && log.width > 0 ? log.left - gap : viewport.width - gap;
    if (next + width <= boundary) return { left: next / zoom, bottom: Math.max(2, (viewport.height - command.bottom) / zoom) };
    const top = log && log.width > 0 ? Math.min(command.top, log.top) : command.top;
    return { left: Math.max(8, (Math.min(command.right, viewport.width - gap) - width) / zoom),
      bottom: Math.max(8, (viewport.height - top) / zoom + 8) };
  }
  function init() {
    const button = document.getElementById('dungeon-map-shortcut'), command = document.getElementById('chatbotcontainer');
    if (!button || !command) return;
    const inventory = document.getElementById('dungeon-inventory-shortcut');
    const log = document.getElementById('game-log-popup');
    const position = () => {
      const bounds = button.getBoundingClientRect(), zoom = button.offsetWidth ? bounds.width / button.offsetWidth : 1;
      const p = placement(command.getBoundingClientRect(), button.offsetWidth, { width: root.innerWidth, height: root.innerHeight },
        log?.getBoundingClientRect(), zoom);
      if (inventory) p.bottom = Math.min(p.bottom, Math.max(2, root.innerHeight / zoom - button.offsetHeight - inventory.offsetHeight - 14));
      button.style.left = p.left + 'px'; button.style.bottom = p.bottom + 'px';
      if (inventory) {
        inventory.style.left = p.left + 'px'; inventory.style.bottom = (p.bottom + button.offsetHeight + 6) + 'px';
      }
    };
    button.addEventListener('click', () => root.DungeonExplorationMap?.toggle());
    position(); root.addEventListener('resize', position);
    if (root.ResizeObserver) {
      const observer = new root.ResizeObserver(position);
      for (const element of [command, button, log].filter(Boolean)) observer.observe(element);
    }
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(position);
      for (const element of [command, log].filter(Boolean)) observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { placement };
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window === 'undefined' ? globalThis : window);
