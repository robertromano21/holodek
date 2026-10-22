(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.GameUiPixels = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.init, { once: true });
    else api.init();
  }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const palette = ['080808', '201b15', '453726', '705335', 'a1743d', 'c3954d', 'e7bb64', 'ffe7a0',
    'fff6d5', 'f4f2e7', 'adac9c', '636b60', '425946', '78a87a', '9c4938', '5b7a88']
    .map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
  function pixels(data) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 96) { data[i + 3] = 0; continue; }
      let best = palette[0], distance = Infinity;
      for (const color of palette) {
        const d = 2 * (data[i] - color[0]) ** 2 + 3 * (data[i + 1] - color[1]) ** 2 + (data[i + 2] - color[2]) ** 2;
        if (d < distance) { distance = d; best = color; }
      }
      data.set(best, i); data[i + 3] = 255;
    }
    return data;
  }
  function icon(button) {
    const img = button?.querySelector('img');
    if (!img || button.querySelector('.ui-pixel-icon')) return;
    if (!img.complete || !img.naturalWidth) { img.addEventListener('load', () => icon(button), { once: true }); return; }
    try {
      const canvas = root.document.createElement('canvas'); canvas.width = canvas.height = 24;
      canvas.className = 'ui-pixel-icon'; canvas.setAttribute('aria-hidden', 'true');
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, 24, 24);
      const image = ctx.getImageData(0, 0, 24, 24); pixels(image.data); ctx.putImageData(image, 0, 0);
      button.appendChild(canvas); button.classList.add('ui-pixel-icon-ready');
    } catch (error) {
      root.console?.warn?.('[GameUiPixels] Original icon retained:', error.message);
    }
  }
  function init() {
    for (const id of ['dungeon-map-shortcut', 'dungeon-inventory-shortcut', 'dungeon-journal-shortcut', 'dungeon-spellbook-shortcut'])
      icon(root.document.getElementById(id));
  }
  return { pixels, icon, init };
});
