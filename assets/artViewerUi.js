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
  // world1 interactive murals: hover a figure for its part of the story, click it for its own portrait popup,
  // click elsewhere for the whole mural under the mural's own title.
  function imagePoint(image, event, w, h) {
    const r = image.getBoundingClientRect(), scale = Math.min(r.width / w, r.height / h);
    const ox = r.left + (r.width - w * scale) / 2, oy = r.top + (r.height - h * scale) / 2;
    return { x: (event.clientX - ox) / scale, y: (event.clientY - oy) / scale };
  }
  function hit(figures, p) {
    return figures.slice().reverse().find(f => p.x >= f.box.x && p.x <= f.box.x + f.box.width && p.y >= f.box.y && p.y <= f.box.y + f.box.height) || null;
  }
  function portrait(art, figure) {
    const painter = root.FrescoFigures;
    if (!painter?.paint) return false;
    const c = canvas(96, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1712'; ctx.fillRect(0, 0, 96, 128);
    ctx.save(); ctx.scale(2, 2);
    const palette = root.SurfaceArt.frescoPalette?.(art) || {};
    try { painter.paint(ctx, figure.row, palette, { x: 8, y: 4, width: 32, height: 56 }, art.style || 'renaissance', canvas); } catch { ctx.restore(); return false; }
    ctx.restore();
    const parent = panel, keep = { art };
    const ok = open({ src: source(c), title: figure.name, description: [figure.role && `Role: ${figure.role}.`, figure.story].filter(Boolean).join(' ') });
    if (ok && panel) {
      const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back to mural';
      back.addEventListener('click', () => surface(keep.art)); panel.querySelector('header')?.insertBefore(back, panel.querySelector('header button'));
    }
    return ok || !!parent;
  }
  function surface(art) {
    if (!art || !root.SurfaceArt) return false;
    const size = root.SurfaceArt.rasterSize(art), c = canvas(size.width, size.height);
    // Render the saved pigment/geometry directly, without world lamps, fog or projection.
    root.SurfaceArt.paint(c.getContext('2d'), canvas, art, {}, [], { retro: root.RetroGraphics?.fullbright?.() === true });
    const muralTitle = art.title || art.label, muralText = art.backstory || [art.description, art.text].filter(Boolean).join(' ');
    const shown = open({ src: source(c), title: muralTitle, description: muralText });
    const figures = shown && art.world1 ? (root.SurfaceArt.figureBoxes?.(art) || []).filter(f => f.name) : [];
    if (!figures.length) return shown;
    const image = panel.querySelector('img'), name = panel.querySelector('header strong'), text = panel.querySelector('p');
    const tip = document.createElement('div'); tip.className = 'art-figure-tip'; tip.hidden = true; panel.append(tip);
    image.style.cursor = 'help';
    image.addEventListener('mousemove', event => {
      const f = hit(figures, imagePoint(image, event, size.width, size.height));
      if (!f) { tip.hidden = true; name.textContent = muralTitle; image.title = muralTitle; return; }
      name.textContent = f.name; image.title = `${f.name}: ${f.role}`;
      tip.textContent = `${f.name}${f.role ? ' - ' + f.role : ''}. ${f.story}`; tip.hidden = false;
      tip.style.left = `${event.clientX - panel.getBoundingClientRect().left + 14}px`; tip.style.top = `${event.clientY - panel.getBoundingClientRect().top + 14}px`;
    });
    image.addEventListener('mouseleave', () => { tip.hidden = true; name.textContent = muralTitle; });
    image.addEventListener('click', event => {
      const f = hit(figures, imagePoint(image, event, size.width, size.height));
      if (f) { portrait(art, f); return; }
      tip.hidden = true; name.textContent = muralTitle; image.title = muralTitle; text.textContent = muralText;
    });
    return shown;
  }
  return { open, surface, close, source, hit, imagePoint };
});
