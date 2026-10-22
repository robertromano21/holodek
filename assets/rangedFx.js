(function(root) {
  'use strict';
  // world1 RANGED_COMBAT client: pixel tracer/projectile + muzzle and impact flash over the 3D view, a SID effect per
  // weapon family (HolodekSfx.play, server-compiled rg_* designs), and the separate ammo readout line.
  if (!root.HolodekFlags?.RANGED_COMBAT) return;
  const COLORS = { arrow: '#c99a62', bolt: '#9aa1a8', stone: '#8a7354', spin: '#d8d2c0', spear: '#c9b48e', tracer: '#ffef9a', spread: '#ffd070', smoke: '#d8d4c0', beam: '#90d0ff', arc: '#c0f0e8', bolt_magic: '#e8823a', ring: '#b49ac8', pillar: '#ffffff' };
  let layer = null;
  function canvasOf() { return [...document.querySelectorAll('canvas')].filter(c => c.offsetWidth > 300).sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0]; }
  function project(p, cv) { // bearing relative to the player's facing -> screen x; FOV ~66 degrees like the raycaster
    const px = root.playerPosX ?? 0, py = root.playerPosY ?? 0, a = root.playerAngle ?? -Math.PI / 2, dx = p.x - px, dy = p.y - py;
    let rel = Math.atan2(dy, dx) - a; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); const d = Math.max(.6, Math.hypot(dx, dy));
    return { x: cv.width * (.5 + rel / 1.15), y: cv.height * (.5 + .35 / d), d }; }
  function show(e) {
    root.HolodekSfx?.play?.('rg_' + (e.sid || 'bang'), { at: e.actor });
    const cv = canvasOf(); if (!cv || !e.from || !e.to) return;
    if (!layer) { layer = document.createElement('canvas'); layer.id = 'ranged-fx-layer'; layer.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;z-index:50'; document.body.append(layer); }
    const r = cv.getBoundingClientRect(); Object.assign(layer.style, { left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px' });
    layer.width = Math.round(r.width / 3); layer.height = Math.round(r.height / 3); // chunky 3px pixels
    const g = layer.getContext('2d'), A = project(e.from, layer), B = project(e.to, layer), col = COLORS[e.fx] || '#fff', t0 = performance.now(), dur = /beam|pillar|arc/.test(e.fx) ? 260 : 380;
    const step = now => { const k = Math.min(1, (now - t0) / dur); g.clearRect(0, 0, layer.width, layer.height); g.fillStyle = col;
      if (/beam|arc|pillar/.test(e.fx)) { for (let i = 0; i <= 24; i++) { const u = i / 24; g.fillRect(Math.round(A.x + (B.x - A.x) * u + (e.fx === 'arc' ? (Math.random() - .5) * 4 : 0)), Math.round(A.y + (B.y - A.y) * u), 1, 1); } }
      else { const u = k, x = Math.round(A.x + (B.x - A.x) * u), y = Math.round(A.y + (B.y - A.y) * u - Math.sin(u * Math.PI) * (/arrow|stone|spear|spin/.test(e.fx) ? 6 : 0)); g.fillRect(x, y, 2, 1); g.fillRect(x - Math.sign(B.x - A.x), y, 1, 1); }
      if (k < .25) { g.fillStyle = '#fff'; g.fillRect(Math.round(A.x) - 1, Math.round(A.y) - 1, 3, 3); }  // muzzle / release flash
      if (k > .8) { g.fillStyle = col; const s = Math.round(4 * (k - .8) / .2) + 1; g.fillRect(Math.round(B.x) - s, Math.round(B.y), s * 2 + 1, 1); g.fillRect(Math.round(B.x), Math.round(B.y) - s, 1, s * 2 + 1); } // impact
      if (k < 1) requestAnimationFrame(step); else setTimeout(() => g.clearRect(0, 0, layer.width, layer.height), 120); };
    requestAnimationFrame(step);
    if (e.readout) readout(e.actor, e.readout);
  }
  // Separate AMMO line (never the Magic/Tech/Luck stat): small pixel-style readout near the party HUD.
  function readout(name, text) { let el = document.getElementById('ammo-readout'); if (!el) { el = document.createElement('div'); el.id = 'ammo-readout';
      el.style.cssText = 'position:fixed;left:12px;bottom:96px;background:#000;color:#ffef9a;border:1px solid #888;padding:2px 6px;font:12px monospace;z-index:60'; document.body.append(el); }
    el.textContent = `${name}: ${text}`; el.animate?.([{ transform: 'translateY(-3px)' }, { transform: 'none' }], { duration: 160, easing: 'steps(3)' }); }
  root.RangedFx = { show, readout, project };
})(typeof window === 'object' ? window : globalThis);
