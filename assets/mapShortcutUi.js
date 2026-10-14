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
    const journal = document.getElementById('dungeon-journal-shortcut');
    const spellbook = document.getElementById('dungeon-spellbook-shortcut');
    const log = document.getElementById('game-log-popup');
    const position = () => {
      const bounds = button.getBoundingClientRect(), zoom = button.offsetWidth ? bounds.width / button.offsetWidth : 1;
      const commandBounds = command.getBoundingClientRect(), logBounds = log?.getBoundingClientRect();
      const p = placement(commandBounds, button.offsetWidth, { width: root.innerWidth, height: root.innerHeight }, logBounds, zoom);
      const stack = [button, journal, inventory].filter(Boolean);
      if (spellbook && inventory && p.left * zoom > commandBounds.right) {
        const lowerHeight = button.offsetHeight + (journal?.offsetHeight || 0) + (journal ? 12 : 6);
        p.bottom = Math.max(2, (root.innerHeight - commandBounds.top) / zoom + 6 - lowerHeight);
      }
      p.bottom = Math.min(p.bottom, Math.max(2, root.innerHeight / zoom - stack.reduce((h, b) => h + b.offsetHeight, 0) - stack.length * 6 - 2));
      const stackLeft = Math.max(p.left, spellbook ? spellbook.offsetWidth + 14 : 8);
      button.style.left = stackLeft + 'px'; button.style.bottom = p.bottom + 'px';
      let bottom = p.bottom + button.offsetHeight + 6;
      for (const element of [journal, inventory].filter(Boolean)) {
        element.style.left = stackLeft + 'px'; element.style.bottom = bottom + 'px'; bottom += element.offsetHeight + 6;
      }
      if (spellbook) { spellbook.style.left = (stackLeft - spellbook.offsetWidth - 6) + 'px'; spellbook.style.bottom = (inventory ? parseFloat(inventory.style.bottom) : p.bottom) + 'px'; }
    };
    button.addEventListener('click', () => root.DungeonExplorationMap?.toggle());
    journal?.addEventListener('click', () => root.AdventureJournalUi?.toggle());
    spellbook?.addEventListener('click', () => root.PartySpellbookUi?.open());
    position(); root.addEventListener('resize', position);
    if (root.ResizeObserver) {
      const observer = new root.ResizeObserver(position);
      for (const element of [command, button, inventory, spellbook, log].filter(Boolean)) observer.observe(element);
    }
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(position);
      for (const element of [command, log].filter(Boolean)) observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { placement };
  else document.addEventListener('DOMContentLoaded', init);
})(typeof window === 'undefined' ? globalThis : window);
