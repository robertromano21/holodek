(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArtViewerUi = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  let panel, previousFocus;
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function source(c, retro = root.RetroGraphics?.fullbright?.() === true) {
    if (!retro || !root.RetroGraphics?.palettePixels) return c.toDataURL('image/png');
    const copy = canvas(c.width, c.height), ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    pixels.data.set(root.RetroGraphics.palettePixels(pixels.data, c.width, c.height)); ctx.putImageData(pixels, 0, 0);
    return copy.toDataURL('image/png');
  }
  function close() {
    if (!panel) return;
    panel.remove(); panel = null;
    previousFocus?.isConnected && previousFocus.focus?.();
  }
  function open({ src, title = 'Artwork', description = '' }) {
    if (typeof src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)) return false;
    const focus = panel ? previousFocus : document.activeElement;
    close(); previousFocus = focus;
    panel = document.createElement('dialog'); panel.id = 'art-viewer-popup'; panel.className = 'popup-container';
    panel.setAttribute('aria-label', title);
    const header = document.createElement('header'), name = document.createElement('strong'), dismiss = document.createElement('button');
    name.textContent = title; dismiss.type = 'button'; dismiss.textContent = 'X'; dismiss.setAttribute('aria-label', 'Close artwork');
    dismiss.addEventListener('click', close); header.append(name, dismiss);
    const image = document.createElement('img'); image.src = src; image.alt = title;
    const text = document.createElement('p'); text.textContent = description;
    panel.append(header, image, text);
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
    panel.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
    document.body.appendChild(panel); panel.showModal(); dismiss.focus();
    return true;
  }
  function surface(art) {
    if (!art || !root.SurfaceArt) return false;
    const size = root.SurfaceArt.rasterSize(art), c = canvas(size.width, size.height);
    // Render the saved pigment/geometry directly, without world lamps, fog or projection.
    root.SurfaceArt.paint(c.getContext('2d'), canvas, art, {}, [], { retro: root.RetroGraphics?.fullbright?.() === true });
    return open({ src: source(c), title: art.label, description: [art.description, art.text].filter(Boolean).join(' ') });
  }
  return { open, surface, close, source };
});
