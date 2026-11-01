(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.WindowUi = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  const resizable = new Set(['phaser-popup', 'game-log-popup', 'combat-popup']);
  const menus = 'dialog, [role="dialog"], .popup-container, #character-sprite-review';
  const headers = ':scope > header, :scope > .window-menu-tab, :scope > .inventory-header, :scope > .exploration-map-header, :scope > .cb-top, :scope > .ms-head';
  const attached = new WeakSet();
  let gesture;
  function bounds(rect, width, height, edge, dx = 0, dy = 0) {
    const minW = Math.min(140, width), minH = Math.min(90, height);
    let left = rect.left, top = rect.top, right = left + rect.width, bottom = top + rect.height;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    if (edge.includes('w')) left = clamp(left + dx, 0, right - minW);
    if (edge.includes('e')) right = clamp(right + dx, left + minW, width);
    if (edge.includes('n')) top = clamp(top + dy, 0, bottom - minH);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + minH, height);
    return { left, top, width: right - left, height: bottom - top };
  }
  function begin(event, panel, edge) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = panel.getBoundingClientRect(), scale = rect.width / panel.offsetWidth || 1;
    gesture = { panel, edge, rect, scale, x: event.clientX, y: event.clientY, id: event.pointerId,
      right: panel.id !== 'combat-popup' && (!panel.style.left || panel.style.left === 'auto'),
      bottom: panel.id === 'game-log-popup' && (!panel.style.top || panel.style.top === 'auto') };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointers have no active capture. */ }
  }
  function attachResize(panel) {
    if (!panel || attached.has(panel)) return;
    attached.add(panel); panel.classList.add('window-edge-resizable');
    for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      const grip = document.createElement('div'); grip.className = 'window-resize-grip window-resize-' + edge;
      grip.setAttribute('aria-hidden', 'true'); grip.addEventListener('pointerdown', event => begin(event, panel, edge)); panel.appendChild(grip);
    }
  }
  function attachTab(panel) {
    if (panel.id === 'dungeon-popup' || resizable.has(panel.id) || panel.querySelector(headers)) return;
    const style = root.getComputedStyle(panel);
    if (panel.tagName !== 'DIALOG' && !['fixed', 'absolute'].includes(style.position)) return;
    const header = document.createElement('div'); header.className = 'window-menu-tab';
    const heading = panel.querySelector('h1, h2');
    const ownedHeading = heading && (heading.parentNode === panel ||
      heading.parentNode?.tagName === 'FORM' && heading.parentNode.parentNode === panel);
    const title = ownedHeading ? heading : document.createElement('span');
    if (!ownedHeading) title.textContent = panel.getAttribute('aria-label') || heading?.textContent || 'Game Menu';
    const close = panel.querySelector('.graphics-close') || document.createElement('button');
    close.type = 'button'; close.textContent = 'X'; close.setAttribute('aria-label', 'Close ' + title.textContent);
    close.addEventListener('click', event => {
      event?.preventDefault();
      // Let the owning UI perform its cleanup before a generic close hides it.
      if (!panel.dispatchEvent(new Event('cancel', { cancelable: true }))) return;
      if (panel.tagName === 'DIALOG') { if (panel.open) panel.close(); }
      else if (panel.classList.contains('popup-container')) panel.remove(); else panel.hidden = true;
    });
    for (const side of ['top', 'left', 'right']) header.style.setProperty('--menu-padding-' + side, style.getPropertyValue('padding-' + side) || '0px');
    header.append(title, close); panel.prepend(header);
  }
  function visit(node) {
    if (node.matches?.(menus)) attachTab(node);
    for (const panel of node.querySelectorAll?.(menus) || []) attachTab(panel);
    if (resizable.has(node.id)) attachResize(node);
    for (const id of resizable) attachResize(node.querySelector?.('#' + id));
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = [
      '.window-edge-resizable{resize:none!important}',
      '.window-resize-grip{position:absolute;z-index:12;touch-action:none}',
      '.window-resize-n,.window-resize-s{left:12px;right:12px;height:8px;cursor:ns-resize}',
      '.window-resize-n{top:0}.window-resize-s{bottom:0}',
      '.window-resize-e,.window-resize-w{top:12px;bottom:12px;width:8px;cursor:ew-resize}',
      '.window-resize-e{right:0}.window-resize-w{left:0}',
      '.window-resize-ne,.window-resize-se,.window-resize-sw,.window-resize-nw{width:12px;height:12px}',
      '.window-resize-ne{top:0;right:0;cursor:nesw-resize}.window-resize-se{bottom:0;right:0;cursor:nwse-resize}',
      '.window-resize-sw{bottom:0;left:0;cursor:nesw-resize}.window-resize-nw{top:0;left:0;cursor:nwse-resize}',
      '.window-menu-tab{position:sticky;top:calc(-1 * var(--menu-padding-top,0px));z-index:10;box-sizing:border-box;align-self:stretch;',
      'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;',
      'background:linear-gradient(#555,#333);color:#fff;border-bottom:1px solid #888;font:inherit;',
      'width:calc(100% + var(--menu-padding-left,0px) + var(--menu-padding-right,0px));',
      'margin:calc(-1 * var(--menu-padding-top,0px)) calc(-1 * var(--menu-padding-right,0px)) var(--menu-padding-top,0px) calc(-1 * var(--menu-padding-left,0px));',
      'min-width:0;overflow-wrap:anywhere;flex-shrink:0}',
      '.window-menu-tab button{flex-shrink:0;cursor:pointer}',
      '.window-menu-tab>h1,.window-menu-tab>h2{margin:0!important;padding:0!important;min-width:0;font:inherit!important}',
      '.window-menu-tab>.graphics-close{position:static!important;margin:0;float:none}'
    ].join('');
    document.head.appendChild(style);
    visit(document);
    document.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const g = gesture, r = bounds(g.rect, root.innerWidth, root.innerHeight, g.edge, event.clientX - g.x, event.clientY - g.y);
      event.preventDefault();
      // Only a user's resize gesture may write panel geometry; never observe or reapply it.
      Object.assign(g.panel.style, { position: 'fixed', boxSizing: 'border-box', maxWidth: 'none', maxHeight: 'none',
        width: r.width / g.scale + 'px', height: r.height / g.scale + 'px',
        left: g.right ? 'auto' : r.left / g.scale + 'px', right: g.right ? (root.innerWidth - r.left - r.width) / g.scale + 'px' : 'auto',
        top: g.bottom ? 'auto' : r.top / g.scale + 'px', bottom: g.bottom ? (root.innerHeight - r.top - r.height) / g.scale + 'px' : 'auto' });
      if (g.panel.id === 'combat-popup') root.CombatTacticalUi?.resized?.(r.width / g.scale);
    }, true);
    const end = event => { if (gesture?.id === event.pointerId) gesture = null; };
    document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
    // New menus get tabs, but style/resize mutations never trigger another layout pass.
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target.matches?.(menus)) attachTab(record.target);
        for (const node of record.addedNodes) visit(node);
      }
    }).observe(document.body, { subtree: true, childList: true });
  }
  return { init, bounds };
});
