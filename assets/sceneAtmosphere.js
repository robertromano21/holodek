// sceneAtmosphere.js
// Level-spec atmosphere for the 3D view: drifting particles (dust, sand storm, snow, rain, spores, embers, ash, mist,
// bubbles) and an optional colour-grading tint, drawn on a pixelated 160x120 overlay canvas stacked on the dungeon
// canvas. Driven by currentDungeon.sceneSpec.atmosphere ({ particles, color, density, grade }).
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const W = 160, H = 120;
  let overlay = null, ctx = null, parts = [], lastKind = '', lastT = 0;
  function host() {
    const R = window.webglDungeonRendererLegacy || window.webglDungeonRenderer;
    return R && R.canvas && R.canvas.parentNode ? R.canvas : null;
  }
  function ensureOverlay(base) {
    if (overlay && overlay.parentNode === base.parentNode) return true;
    overlay = document.createElement('canvas');
    overlay.width = W; overlay.height = H;
    overlay.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;';
    base.parentNode.style.position = base.parentNode.style.position || 'relative';
    base.parentNode.appendChild(overlay);
    ctx = overlay.getContext('2d');
    return true;
  }
  function spawn(kind, n) {
    parts = [];
    for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), p: Math.random() * 6.28 });
    lastKind = kind;
  }
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016); lastT = t;
    const d = (typeof currentDungeon !== 'undefined' && currentDungeon) || window.currentDungeon || null;
    const a = d && d.sceneSpec && d.sceneSpec.atmosphere;
    const base = host();
    if (!base) return;
    ensureOverlay(base);
    overlay.style.left = base.offsetLeft + 'px'; overlay.style.top = base.offsetTop + 'px';
    overlay.style.width = base.clientWidth + 'px'; overlay.style.height = base.clientHeight + 'px';
    overlay.style.display = base.style.display === 'none' || base.offsetParent === null ? 'none' : '';
    ctx.clearRect(0, 0, W, H);
    if (!a || (!a.particles || a.particles === 'none') && !a.grade) return;
    const kind = a.particles || 'none';
    const n = Math.round(20 + 160 * Math.max(0, Math.min(1, a.density ?? 0.4)));
    if (kind !== lastKind || parts.length !== n) spawn(kind, kind === 'none' ? 0 : n);
    if (a.grade) { ctx.globalAlpha = 0.12; ctx.fillStyle = a.grade; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    const col = a.color || '#c8b890';
    const turn = typeof playerAngle === 'number' ? playerAngle : 0;
    const drift = (frame._turn === undefined ? 0 : (turn - frame._turn)) * 60; frame._turn = turn;
    for (const q of parts) {
      const sp = 0.4 + q.z;
      switch (kind) {
        case 'sand': q.x += (60 * sp) * dt; q.y += Math.sin(t / 300 + q.p) * 6 * dt + 4 * dt; break;
        case 'snow': case 'ash': q.y += 12 * sp * dt; q.x += Math.sin(t / 700 + q.p) * 8 * dt; break;
        case 'rain': q.y += 140 * sp * dt; q.x += 20 * dt; break;
        case 'embers': case 'bubbles': q.y -= 14 * sp * dt; q.x += Math.sin(t / 400 + q.p) * 6 * dt; break;
        case 'mist': q.x += 4 * sp * dt; break;
        default: q.x += Math.sin(t / 900 + q.p) * 3 * dt; q.y += Math.cos(t / 1100 + q.p) * 2 * dt + 1.5 * dt; // dust, spores
      }
      q.x -= drift * (0.5 + q.z);
      if (q.x > W) q.x -= W; if (q.x < 0) q.x += W; if (q.y > H) q.y -= H; if (q.y < 0) q.y += H;
      ctx.globalAlpha = kind === 'mist' ? 0.08 : (0.25 + 0.5 * q.z);
      ctx.fillStyle = kind === 'embers' && q.z > 0.6 ? '#ffd080' : col;
      if (kind === 'rain') ctx.fillRect(q.x | 0, q.y | 0, 1, 3);
      else if (kind === 'mist') ctx.fillRect((q.x | 0) - 6, q.y | 0, 14, 3);
      else ctx.fillRect(q.x | 0, q.y | 0, q.z > 0.8 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
})();
