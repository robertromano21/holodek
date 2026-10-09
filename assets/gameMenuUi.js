(function(root) {
  'use strict';
  let menu, toggle, startedRun = null;
  function setOpen(open, focus = false) {
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close game menu' : 'Open game menu');
    if (focus) toggle.focus();
  }
  function fit() {
    if (!menu || !toggle) return;
    const bounds = toggle.getBoundingClientRect(), zoom = toggle.offsetWidth ? bounds.width / toggle.offsetWidth : 1;
    menu.style.width = Math.max(130, Math.min(210, root.innerWidth / zoom - 20)) + 'px';
    menu.style.top = bounds.bottom / zoom + 4 + 'px';
    menu.style.maxHeight = Math.max(80, root.innerHeight / zoom - parseFloat(menu.style.top) - 8) + 'px';
  }
  function init() {
    menu = document.getElementById('game-menu'); toggle = document.getElementById('game-menu-toggle');
    if (!menu || !toggle) return;
    for (const id of ['combat-mode-toggle', 'open-combat-button', 'open-dungeon-button', 'dungeon-test-button', 'play-music-btn']) {
      const control = document.getElementById(id);
      if (!control) continue;
      control.style.position = 'static';
      control.style.top = control.style.left = control.style.right = control.style.bottom = 'auto';
      menu.appendChild(control);
    }
    toggle.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', event => { if (event.target.closest('button')) setOpen(false); });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setOpen(false, true); });
    root.addEventListener('resize', fit);
    setOpen(false); fit();
  }
  function onDungeonReady(dungeon) {
    const runId = root.dungeonRunId;
    if (!runId || startedRun === runId || !dungeon?.cells || !dungeon.layout ||
        dungeon._meta?.runId && dungeon._meta.runId !== runId) return;
    const startCell = dungeon.cells[`${dungeon.start?.x},${dungeon.start?.y}`];
    if (!startCell || startCell.tile === 'wall' || startCell.tile === 'torch') return;
    const controls = [['phaser-popup', 'togglePopup'], ['game-log-popup', 'toggleGameLogPopup']];
    if (document.getElementById('combat-mode-select')?.value !== 'No Combat Map') controls.push(['combat-popup', 'toggleCombatPopup']);
    if (controls.some(([id, action]) => !document.getElementById(id) || typeof root[action] !== 'function')) return;
    startedRun = runId;
    for (const [id, action] of controls) if (document.getElementById(id).style.display !== 'block') root[action]();
  }
  root.GameMenuUi = { onDungeonReady, setOpen };
  document.addEventListener('DOMContentLoaded', init);
})(window);
