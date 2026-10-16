(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomIllustration = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const width = 320, height = 200;
  const palette = ['#000000', '#ffffff', '#883932', '#67b6bd', '#8b3f96', '#55a049', '#40318d', '#d6cf6a',
    '#a86432', '#68451d', '#bf6c78', '#424242', '#777777', '#a0cf83', '#7869c4', '#aaaaaa'];
  const kinds = ['ridge', 'wall', 'pillar', 'arch', 'portico', 'stairs', 'door', 'building', 'bridge',
    'tree', 'roots', 'pool', 'river', 'crystal', 'stalactite', 'statue', 'grave', 'obelisk', 'brazier',
    'fresco', 'mosaic', 'rubble', 'grass', 'mist', 'sun', 'moon', 'cloud', 'mountain', 'dunes', 'tower', 'citadel', 'road', 'stars'];
  const patterns = ['plain', 'stone', 'sand', 'tiles', 'cracked', 'ripples', 'stipple'];
  const color = c => /^#[0-9a-f]{6}$/i.test(c) || Number.isInteger(c) && c >= 0 && c < palette.length;
  function description(room, fallback = '') {
    return [room?.description, room?.roomDescription, room?.sceneSpec?.source?.description, fallback].find(value =>
      typeof value === 'string' && value.trim().length >= 20 && !/^(?:none|undefined|null)$|^A newly discovered room to the\b/i.test(value.trim()))?.trim() || '';
  }
  function validate(raw) {
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    if (!raw || !['interior', 'landscape', 'cavern', 'courtyard'].includes(raw.view) ||
        !integer(raw.horizon, 45, 150) || !integer(raw.vanishing, 40, 280) ||
        !patterns.includes(raw.groundPattern)) throw Error('Invalid room illustration perspective or ground pattern.');
    const colors = ['sky', 'ground', 'shadow', 'stone', 'accent', 'light'];
    for (const c of colors) if (!color(raw[c])) throw Error(`Invalid ${c} color (expected #RRGGBB).`);
    if (raw.ground === raw.shadow || raw.stone === raw.shadow || raw.light === raw.shadow) throw Error('Room art needs distinct material, light and shadow colors.');
    if (!Array.isArray(raw.layers) || raw.layers.length < 6 || raw.layers.length > 36) throw Error('Room art needs 6..36 component layers.');
    const layers = raw.layers.map((p, i) => {
      if (!p || !kinds.includes(p.kind) || !integer(p.x, -80, 319) || !integer(p.y, -60, 199) ||
          !integer(p.w, 3, 400) || !integer(p.h, 3, 260) || p.x + p.w <= 0 || p.y + p.h <= 0 ||
          !color(p.color) || !color(p.shade) || !color(p.detail) ||
          !integer(p.count, 1, 10) || !patterns.includes(p.pattern)) throw Error(`Invalid room art component ${i}.`);
      return Object.fromEntries(['kind', 'x', 'y', 'w', 'h', 'color', 'shade', 'detail', 'count', 'pattern'].map(k => [k, p[k]]));
    });
    return { view: raw.view, horizon: raw.horizon, vanishing: raw.vanishing,
      ...Object.fromEntries(colors.map(k => [k, raw[k]])), groundPattern: raw.groundPattern, layers };
  }
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function paint(ctx, raw, seed = 1) {
    const plan = validate(raw);
    let state = hash(seed);
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const rect = (x, y, w, h, c) => {
      const l = Math.max(0, Math.round(x)), t = Math.max(0, Math.round(y));
      const r = Math.min(width, Math.round(x + w)), b = Math.min(height, Math.round(y + h));
      if (r > l && b > t) { ctx.fillStyle = typeof c === 'number' ? palette[c] : c; ctx.fillRect(l, t, r - l, b - t); }
    };
    const line = (x0, y0, x1, y1, c) => {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) { rect(x0, y0, 1, 1, c); if (x0 === x1 && y0 === y1) break;
        const e = err * 2; if (e >= dy) { err += dy; x0 += sx; } if (e <= dx) { err += dx; y0 += sy; }
      }
    };
    const poly = (points, c, outline) => {
      const lo = Math.max(0, Math.floor(Math.min(...points.map(p => p[1]))));
      const hi = Math.min(height - 1, Math.ceil(Math.max(...points.map(p => p[1]))));
      for (let y = lo; y <= hi; y++) {
        const crossings = [];
        for (let j = 0; j < points.length; j++) { const a = points[j], b = points[(j + 1) % points.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let j = 0; j + 1 < crossings.length; j += 2) rect(Math.ceil(crossings[j]), y, Math.floor(crossings[j + 1]) - Math.ceil(crossings[j]) + 1, 1, c);
      }
      if (outline !== undefined) for (let j = 0; j < points.length; j++) line(...points[j], ...points[(j + 1) % points.length], outline);
    };
    const ellipse = (x, y, w, h, c) => {
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(height, y + h); yy++) {
        const v = (yy + .5 - y - h / 2) / (h / 2), span = Math.sqrt(Math.max(0, 1 - v * v)) * w / 2;
        rect(x + w / 2 - span, yy, span * 2, 1, c);
      }
    };
    const mix = (a, b, t) => {
      a = typeof a === 'number' ? palette[a] : a; b = typeof b === 'number' ? palette[b] : b;
      return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
    };
    function texture(x, y, w, h, pattern, c, d) {
      if (pattern === 'plain') return;
      if (pattern === 'stone' || pattern === 'tiles') {
        const bh = Math.max(4, Math.min(9, h / 7)), bw = bh * 2.5;
        for (let row = 1; row * bh < h; row++) {
          line(x, y + row * bh, x + w - 1, y + row * bh, c);
          for (let col = 0; col * bw < w; col++) {
            const xx = x + col * bw + (row % 2 ? bw / 2 : 0);
            if (xx < x + w) line(xx, y + (row - 1) * bh, xx, y + row * bh, c);
          }
        }
      } else for (let i = 0, n = Math.min(1500, w * h / (pattern === 'stipple' ? 8 : 22)); i < n; i++) {
        const xx = x + random() * w, yy = y + random() * h;
        rect(xx, yy, pattern === 'ripples' ? 2 + random() * 8 : 1 + random() * 3, 1, i % 4 ? c : d);
        if (pattern === 'cracked') line(xx, yy, xx + 2, yy + 3, c);
      }
    }
    function column(x, y, w, h, c, s, d) {
      rect(x, y, w, h, 0); rect(x + 2, y + 3, w - 4, h - 6, c);
      rect(x + 2, y + 4, Math.max(1, w * .22), h - 8, d);
      rect(x + w * .7, y + 3, Math.max(1, w * .2), h - 5, s);
      for (let f = x + 5; f < x + w - 3; f += 4) line(f, y + 6, f, y + h - 5, s);
      rect(x - 2, y, w + 4, 3, s); rect(x - 2, y + 1, w + 3, 1, d);
      rect(x - 2, y + h - 3, w + 4, 3, s); rect(x - 2, y + h - 3, w + 3, 1, d);
    }
    function arch(x, y, w, h, c, s, d) {
      const thick = Math.max(2, w * .12), top = Math.min(h * .45, w * .5);
      const outline = [[x, y + h], [x, y + top], [x + w * .12, y + top * .35], [x + w * .35, y],
        [x + w * .65, y], [x + w * .88, y + top * .35], [x + w, y + top], [x + w, y + h],
        [x + w - thick, y + h], [x + w - thick, y + top + 1], [x + w * .7, y + thick],
        [x + w * .3, y + thick], [x + thick, y + top + 1], [x + thick, y + h]];
      poly(outline, c, s);
      for (let f = 1; f <= 5; f++) {
        const a = Math.PI + f * Math.PI / 6;
        line(x + w / 2 + Math.cos(a) * w / 2, y + top + Math.sin(a) * top,
          x + w / 2 + Math.cos(a) * (w / 2 - thick), y + top + Math.sin(a) * Math.max(1, top - thick), s);
      }
      line(x + 1, y + top, x + 1, y + h - 1, d);
    }
    function tower(x, y, w, h, c, s, d, count) {
      rect(x, y + 3, w, h - 3, 0); rect(x + 1, y + 3, w - 2, h - 4, c);
      rect(x + w * .68, y + 3, w * .3, h - 4, s);
      texture(x + 2, y + 5, w * .64, h - 8, 'stone', mix(c, s, .28), d);
      for (let i = 0; i < count + 2; i++) rect(x + i * w / (count + 2), y, Math.max(1, w / (count + 2) * .55), 5, c);
      line(x + 1, y + 5, x + 1, y + h - 2, d);
      for (let floor = y + 12; floor < y + h - 8; floor += Math.max(8, h / (count + 1))) {
        line(x, floor + 5, x + w - 1, floor + 5, s);
        for (let xx = x + 4; xx < x + w - 3; xx += Math.max(5, w / 4)) {
          rect(xx, floor, 3, 5, s); rect(xx, floor + 1, 2, 3, 0); rect(xx - 1, floor + 5, 5, 1, d);
        }
      }
      rect(x - 1, y + h - 4, w + 2, 4, s); line(x - 1, y + h - 4, x + w, y + h - 4, d);
    }
    ctx.imageSmoothingEnabled = false;
    rect(0, 0, width, height, plan.sky);
    rect(0, plan.horizon, width, height - plan.horizon, plan.ground);
    if (plan.groundPattern !== 'tiles') texture(0, plan.horizon, width, height - plan.horizon, plan.groundPattern, plan.shadow, plan.stone);
    if (plan.groundPattern === 'tiles') {
      for (let x = -320; x <= 640; x += 40) line(plan.vanishing, plan.horizon, x, 199, plan.shadow);
      for (let y = plan.horizon + 3, step = 3; y < 200; step *= 1.45, y += step) line(0, y, 319, y, plan.shadow);
    }
    if (plan.view === 'interior') {
      poly([[0, 0], [320, 0], [260, plan.horizon], [60, plan.horizon]], plan.stone);
      poly([[0, 0], [60, plan.horizon], [0, 170]], plan.shadow);
      poly([[320, 0], [260, plan.horizon], [320, 170]], plan.shadow);
    }
    for (const p of plan.layers) {
      const { x, y, w, h, color: c, shade: s, detail: d, count, pattern } = p;
      switch (p.kind) {
        case 'cloud': {
          const lobes = [];
          for (let i = 0; i < count + 3; i++) lobes.push({ x: x + i * w / (count + 3) - w / (count + 3),
            y: y + h * (.15 + random() * .35), w: w / (count + 3) * (1.8 + random()), h: h * (.5 + random() * .35) });
          for (const l of lobes) {
            ellipse(l.x, l.y, l.w, l.h, s);
            ellipse(l.x, l.y, l.w * .84, l.h * .76, c);
            ellipse(l.x + l.w * .08, l.y + 1, l.w * .55, l.h * .39, mix(c, d, .5));
            for (let i = 0; i < l.w * l.h / 18; i++) {
              const xx = random(), yy = random(), dx = (xx - .5) * 2, dy = (yy - .5) * 2;
              if (dx * dx + dy * dy < 1 && yy > .45) rect(l.x + xx * l.w, l.y + yy * l.h, 1, 1, random() > yy ? c : mix(c, s, .55));
            }
          } break;
        }
        case 'mountain': {
          for (let i = 0; i < count; i++) {
            const span = w / Math.max(1, count) * 1.65, xx = x + (i - .25) * w / count, peak = xx + span * (.35 + random() * .3), yy = y + random() * h * .25;
            poly([[xx, y + h], [peak, yy], [xx + span, y + h]], s, 0);
            poly([[xx, y + h], [peak, yy], [peak + span * .04, y + h]], c);
            poly([[peak, yy], [peak - span * .15, yy + h * .32], [peak - span * .03, yy + h * .25], [peak + span * .05, yy + h * .44], [peak + span * .12, yy + h * .22]], d);
            for (let j = 0; j < span * h / 20; j++) {
              const f = .15 + random() * .82, left = peak + (xx - peak) * f, right = peak + span * .04;
              const px = left + random() * Math.max(1, right - left), py = yy + f * (y + h - yy);
              line(px, py, px + 2, Math.min(y + h, py + 3 + random() * 6), j % 4 ? mix(c, s, .4) : d);
            }
          } break;
        }
        case 'dunes': {
          for (let band = 0; band < count + 2; band++) {
            const yy = y + band * h / (count + 2), amp = 2 + band * 1.5, phase = random() * Math.PI * 2;
            const points = [[x, y + h]];
            for (let xx = 0; xx <= w; xx += 3) points.push([x + xx, yy + Math.sin(xx / Math.max(12, w / 5) + phase) * amp]);
            points.push([x + w, y + h]); poly(points, band % 2 ? c : mix(c, s, .22));
            for (let xx = 0; xx < w; xx++) { const ridge = yy + Math.sin(xx / Math.max(12, w / 5) + phase) * amp;
              rect(x + xx, ridge, 1, 1, d);
              if (xx % 3 === 0) rect(x + xx, ridge + 2 + random() * (band + 2), 1, 1, mix(c, s, .5));
            }
          } break;
        }
        case 'tower': tower(x, y, w, h, c, s, d, count); break;
        case 'citadel': {
          for (let i = 0; i < Math.max(3, count); i++) {
            const n = Math.max(3, count), ww = w / (n + 1), xx = x + i * (w - ww) / (n - 1), hh = h * (.6 + .35 * (1 - Math.abs(i - (n - 1) / 2) / (n / 2)));
            tower(xx, y + h - hh, ww, hh, c, s, d, 4);
          }
          rect(x - 3, y + h * .73, w + 6, h * .27, s);
          for (let i = 0; i < Math.max(3, count); i++) arch(x + i * w / Math.max(3, count) + 2, y + h * .76, w / Math.max(3, count) - 4, h * .21, c, 0, d);
          line(x - 3, y + h * .73, x + w + 2, y + h * .73, d); break;
        }
        case 'road':
          poly([[x + w * .46, y], [x + w * .54, y], [x + w, y + h], [x, y + h]], c, s);
          for (let i = 0; i < count * 8; i++) { const f = random(); rect(x + w / 2 + (random() - .5) * w * f, y + f * h, 1 + f * 5, 1, i % 2 ? s : d); } break;
        case 'stars':
          for (let i = 0; i < count * 8; i++) { const xx = x + random() * w, yy = y + random() * h; rect(xx, yy, 1, 1, i % 3 ? c : d); if (i % 17 === 0) { line(xx - 2, yy, xx + 2, yy, d); line(xx, yy - 2, xx, yy + 2, d); } } break;
        case 'wall':
          rect(x, y, w, h, 0); rect(x + 1, y + 1, w - 2, h - 2, c);
          texture(x + 2, y + 2, w - 4, h - 4, pattern, s, d);
          line(x, y, x + w - 1, y, d); line(x, y + h - 1, x + w - 1, y + h - 1, s); break;
        case 'pillar': column(x, y, w, h, c, s, d); break;
        case 'arch': arch(x, y, w, h, c, s, d); break;
        case 'portico': {
          const top = h * .27, cw = Math.max(4, w / (Math.max(2, count) * 3));
          poly([[x - 2, y + top], [x + w / 2, y], [x + w + 2, y + top]], c, 0);
          poly([[x + 5, y + top - 3], [x + w / 2, y + 6], [x + w - 5, y + top - 3]], s);
          line(x + 5, y + top - 2, x + w - 5, y + top - 2, d);
          rect(x, y + top, w, 5, s); rect(x, y + top, w, 1, d);
          for (let i = 0; i < Math.max(2, count); i++) column(x + i * (w - cw) / (Math.max(2, count) - 1), y + top + 5, cw, h - top - 9, c, s, d);
          rect(x - 3, y + h - 4, w + 6, 4, s); rect(x - 3, y + h - 4, w + 6, 1, d); break;
        }
        case 'door':
          rect(x, y, w, h, s); arch(x - 2, y - 3, w + 4, h + 3, c, 0, d);
          for (let i = 3; i < w - 2; i += 4) line(x + i, y + 4, x + i, y + h - 1, c);
          rect(x + w * .72, y + h * .6, 2, 2, d); break;
        case 'building':
          rect(x, y + h * .32, w, h * .68, c);
          texture(x + 1, y + h * .34, w - 2, h * .64, pattern, s, d);
          poly([[x - 2, y + h * .35], [x + w * .4, y], [x + w + 2, y + h * .35]], s, 0);
          rect(x + w * .4, y + h * .6, w * .2, h * .4, 0);
          for (let i = 1; i <= Math.min(4, count); i++) { const xx = x + i * w / (Math.min(4, count) + 1); rect(xx - 1, y + h * .43, 4, 6, 0); rect(xx, y + h * .44, 2, 3, d); }
          line(x, y + h - 1, x + w, y + h - 1, 0); break;
        case 'bridge':
          for (let i = 0; i < count; i++) arch(x + i * w / count, y + h * .25, w / count + 1, h * .75, c, s, d);
          rect(x, y, w, h * .23, c); texture(x, y, w, h * .22, pattern, s, d); line(x, y, x + w, y, d); break;
        case 'stairs':
          for (let i = 0; i < count + 2; i++) { const f = (i + 1) / (count + 2); rect(x + w * (1 - f) / 2, y + h * i / (count + 2), w * f, h / (count + 2) + 1, i % 2 ? c : s); line(x + w * (1 - f) / 2, y + h * i / (count + 2), x + w * (1 + f) / 2, y + h * i / (count + 2), d); } break;
        case 'ridge':
        case 'stalactite': {
          const pts = [[x, y + h]];
          for (let i = 0; i <= count + 2; i++) pts.push([x + i * w / (count + 2), y + random() * h * .6]);
          pts.push([x + w, y + h]);
          if (p.kind === 'stalactite') for (const pt of pts) pt[1] = y + h - (pt[1] - y);
          poly(pts, c, s);
          for (let i = 1; i + 1 < pts.length; i++) line(...pts[i], pts[i][0] + w * .06, p.kind === 'ridge' ? y + h : y, i % 2 ? s : d); break;
        }
        case 'tree':
        case 'roots': {
          const cx = x + w / 2;
          poly([[cx - w * .1, y + h], [cx - w * .05, y + h * .25], [cx + w * .08, y + h * .2], [cx + w * .12, y + h]], s, 0);
          line(cx, y + h * .3, cx + 1, y + h, d);
          for (let i = 0; i < count + 2; i++) { const f = i / (count + 2), xx = x + (i % 2 ? .8 : .15) * w, yy = y + h * (.1 + f * .65);
            line(cx, y + h * (.55 + f * .25), xx, yy, s);
            if (p.kind === 'tree') { ellipse(xx - w * .19, yy - h * .09, w * .4, h * .28, c); texture(xx - w * .13, yy, w * .23, h * .12, 'stipple', s, d); }
          } break;
        }
        case 'pool':
          ellipse(x - 2, y - 1, w + 4, h + 3, 0); ellipse(x, y, w, h, s); ellipse(x + 2, y + 1, w - 4, h - 3, c);
          for (let i = 0; i < 18; i++) { const yy = y + h * (.25 + random() * .5); rect(x + w * .22 + random() * w * .45, yy, 2 + random() * w * .1, 1, d); } break;
        case 'river':
          poly([[x + w * .45, y], [x + w * .55, y], [x + w * .65, y + h * .45], [x + w, y + h], [x, y + h], [x + w * .35, y + h * .5]], c, s);
          for (let i = 0; i < 20; i++) { const f = random(); rect(x + w / 2 + (random() - .5) * w * f, y + f * h, 2 + f * 8, 1, d); } break;
        case 'crystal':
          for (let i = 0; i < count; i++) { const ww = w / Math.max(2, count), xx = x + i * (w - ww) / Math.max(1, count - 1), hh = h * (.6 + random() * .4);
            poly([[xx, y + h], [xx + 1, y + h - hh + 5], [xx + ww * .5, y + h - hh], [xx + ww, y + h - hh + 6], [xx + ww, y + h]], c, 0);
            poly([[xx + ww * .5, y + h - hh], [xx + ww, y + h - hh + 6], [xx + ww, y + h], [xx + ww * .5, y + h]], s);
            line(xx + 2, y + h - hh + 6, xx + ww * .5, y + h - hh + 2, d);
          } break;
        case 'statue':
          rect(x + w * .1, y + h * .86, w * .8, h * .14, s); line(x + w * .1, y + h * .86, x + w * .9, y + h * .86, d);
          ellipse(x + w * .35, y, w * .3, h * .19, c);
          poly([[x + w * .35, y + h * .18], [x + w * .63, y + h * .18], [x + w * .85, y + h * .83], [x + w * .15, y + h * .83]], c, s);
          for (let i = 2; i < 7; i++) line(x + w * .5, y + h * .3, x + w * i / 8, y + h * .8, s);
          line(x + w * .4, y + h * .22, x + w * .3, y + h * .8, d); break;
        case 'grave':
          rect(x, y + h * .86, w, h * .14, s); rect(x + w * .2, y + h * .2, w * .6, h * .7, c);
          ellipse(x + w * .2, y, w * .6, h * .4, c);
          for (let i = 0; i < 3; i++) rect(x + w * .32, y + h * (.4 + i * .1), w * .35, 1, s); break;
        case 'obelisk':
          poly([[x, y + h], [x + w * .2, y + h * .14], [x + w / 2, y], [x + w * .8, y + h * .14], [x + w, y + h]], c, 0);
          poly([[x + w / 2, y], [x + w * .8, y + h * .14], [x + w, y + h], [x + w / 2, y + h]], s);
          for (let i = 1; i <= count + 2; i++) rect(x + w * .35, y + h * i / (count + 4), 2, 2, d); break;
        case 'brazier':
          rect(x + w * .4, y + h * .5, w * .2, h * .5, s);
          poly([[x, y + h * .4], [x + w, y + h * .4], [x + w * .7, y + h * .65], [x + w * .3, y + h * .65]], s, 0);
          for (let i = 0; i < count + 2; i++) { const xx = x + w * (.1 + random() * .65); poly([[xx, y + h * .45], [xx + 2, y + random() * h * .3], [xx + w * .2, y + h * .45]], c); }
          rect(x + w * .4, y + h * .25, w * .2, h * .2, d); break;
        case 'fresco':
        case 'mosaic':
          rect(x, y, w, h, s); rect(x + 2, y + 2, w - 4, h - 4, c);
          for (let i = 1; i <= count; i++) { const xx = x + i * w / (count + 1); ellipse(xx - 2, y + h * .22, 4, 4, d); poly([[xx - 2, y + h * .4], [xx + 2, y + h * .4], [xx + 5, y + h * .8], [xx - 5, y + h * .8]], d, s); }
          if (p.kind === 'mosaic') for (let xx = x + 2; xx < x + w - 2; xx += 3) for (let yy = y + 2; yy < y + h - 2; yy += 3) rect(xx, yy, 1, 1, s); break;
        case 'sun': case 'moon': ellipse(x, y, w, h, c); if (p.kind === 'moon') ellipse(x + w * .3, y - 1, w, h, s); break;
        case 'mist':
          for (let i = 0; i < count + 3; i++) rect(x + random() * w * .25, y + random() * h, w * (.5 + random() * .5), 1, i % 2 ? c : d); break;
        case 'grass':
          for (let i = 0; i < count * 8; i++) { const xx = x + random() * w, yy = y + random() * h; line(xx, yy, xx + (random() - .5) * 5, yy - 2 - random() * 4, i % 3 ? c : d); } break;
        case 'rubble':
          for (let i = 0; i < count * 3; i++) { const xx = x + random() * w, yy = y + random() * h, ww = 2 + random() * Math.min(10, w / 3); poly([[xx, yy], [xx + ww, yy - 2], [xx + ww + 2, yy + 3], [xx - 1, yy + 3]], i % 2 ? c : s, 0); rect(xx + 1, yy, ww - 1, 1, d); } break;
      }
    }
    return ctx.canvas;
  }
  return { width, height, palette, kinds, patterns, validate, hash, paint, description };
});
