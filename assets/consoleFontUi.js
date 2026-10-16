(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ConsoleFontUi = api; api.restore();
    document.addEventListener('DOMContentLoaded', api.bind, { once: true });
  }
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  const key = 'holodek.consoleFont';
  let mode = 'retro';
  function set(value, persist = true) {
    mode = value === 'classic' ? 'classic' : 'retro';
    root.document.documentElement.dataset.consoleFont = mode;
    const button = root.document.getElementById('console-font-toggle');
    if (button) {
      button.textContent = 'Console / Log Font: ' + (mode === 'retro' ? 'Retro' : 'Classic');
      button.setAttribute('aria-pressed', String(mode === 'classic'));
    }
    if (persist) try { root.localStorage.setItem(key, mode); } catch { /* Session setting still works without storage. */ }
    return mode;
  }
  function restore() { let value; try { value = root.localStorage.getItem(key); } catch {} return set(value, false); }
  function bind() { set(mode, false); root.document.getElementById('console-font-toggle')?.addEventListener('click', () => set(mode === 'retro' ? 'classic' : 'retro')); }
  return { set, restore, bind };
});
