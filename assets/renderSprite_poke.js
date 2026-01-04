// retort/renderSprite_poke.js
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const BASE_SIZE = 32;
const UPSCALE  = 10; // 320x320

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePalette(p) {
  if (!p) p = {};
  return {
    primary:   p.primary   || "#553344",
    secondary: p.secondary || "#22111a",
    highlight: p.highlight || "#ff4040",
    shadow:    p.shadow    || "#050307"
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

function roughRect(ctx, x, y, w, h, jag = 6) {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ];
  ctx.beginPath();
  pts.forEach((p, i) => {
    const jx = randRange(-jag, jag);
    const jy = randRange(-jag, jag);
    const px = p.x + jx;
    const py = p.y + jy;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

function speckle(ctx, color, count, x0, y0, x1, y1, size = 2) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = randRange(x0, x1);
    const y = randRange(y0, y1);
    ctx.fillRect(x, y, size, size);
  }
}

// ===== CUSTOM TILE DRAWER (new underworld wasteland tiles) =====
// Enhanced CUSTOM TILE DRAWER: Interprets LLM procedure JSON as procedural canvas ops

function runSpriteProgram(ctx, palette, program) {
  const s = BASE_SIZE * UPSCALE;

  const getColor = (spec, fallback) => {
    if (!spec) return fallback;
    if (spec[0] === '#') return spec;
    return palette[spec] || fallback;
  };

  program.forEach(step => {
    if (!step || !step.op) return;
    const op = step.op;

    switch (op) {
      case 'shadow': {
        const radius = Math.max(0.1, Math.min(1, step.radius || 0.5));
        const intensity = Math.max(0, Math.min(1, step.intensity || 0.6));
        const rx = (s * radius);
        const ry = rx * 0.5;
        const cx = s * 0.5;
        const cy = s * 0.9;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        g.addColorStop(0, `rgba(0,0,0,${intensity})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'column': {
        const wRatio = Math.max(0.2, Math.min(0.6, step.width || 0.35));
        const hRatio = Math.max(0.5, Math.min(0.9, step.height || 0.8));
        const shaftW = s * wRatio;
        const shaftH = s * hRatio;
        const shaftX = (s - shaftW) / 2;
        const shaftY = s - shaftH - s * 0.08;

        // body
        ctx.fillStyle = getColor(step.bodyColor, palette.primary);
        ctx.fillRect(shaftX, shaftY, shaftW, shaftH);

        // subtle vertical shading
        const g = ctx.createLinearGradient(shaftX, 0, shaftX + shaftW, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.25)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
        g.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = g;
        ctx.fillRect(shaftX, shaftY, shaftW, shaftH);

        // cap
        if (step.top_cap !== false) {
          ctx.fillStyle = getColor(step.capColor, palette.highlight);
          const capH = s * 0.08;
          ctx.fillRect(shaftX - s * 0.06, shaftY - capH, shaftW + s * 0.12, capH);
        }
        break;
      }

      case 'mound': {
        const wRatio = Math.max(0.3, Math.min(0.9, step.width || 0.8));
        const hRatio = Math.max(0.15, Math.min(0.5, step.height || 0.3));
        const w = s * wRatio;
        const h = s * hRatio;
        const cx = s * 0.5;
        const cy = s * 0.9;

        ctx.fillStyle = getColor(step.color, palette.primary);
        ctx.beginPath();
        ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // highlight top
        const g = ctx.createRadialGradient(cx, cy - h * 0.4, 0, cx, cy, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.15)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'slabs': {
        const count = Math.max(1, Math.min(5, step.count || 3));
        const stagger = Math.max(0, Math.min(1, step.stagger || 0.5));
        const baseW = s * 0.6;
        const baseH = s * 0.15;
        const baseY = s * 0.6;
        ctx.fillStyle = getColor(step.color, palette.primary);

        for (let i = 0; i < count; i++) {
          const y = baseY + i * baseH * 0.6;
          const offset = (i - (count - 1) / 2) * baseW * 0.15 * stagger;
          const x = s * 0.5 - baseW / 2 + offset;
          ctx.fillRect(x, y, baseW, baseH);
        }
        break;
      }

      case 'branches': {
        const count = Math.max(1, Math.min(7, step.count || 4));
        const spread = (typeof step.spread === 'number') ? step.spread : 0.6;
        const lengthRatio = (typeof step.length === 'number') ? step.length : 0.35;
        const baseY = s * 0.45;
        const baseX = s * 0.5;
        ctx.strokeStyle = getColor(step.color, palette.highlight);
        ctx.lineWidth = s * 0.04;

        for (let i = 0; i < count; i++) {
          const t = count > 1 ? i / (count - 1) : 0.5;
          const angle = (-Math.PI / 3) + spread * t * Math.PI * 0.8;
          const len = s * lengthRatio;
          ctx.beginPath();
          ctx.moveTo(baseX, baseY + t * s * 0.25);
          ctx.lineTo(
            baseX + Math.cos(angle) * len,
            baseY + t * s * 0.25 + Math.sin(angle) * len
          );
          ctx.stroke();
        }
        break;
      }

      case 'cracks': {
        const density = Math.max(0, Math.min(1, step.density || 0.4));
        const lines = Math.round(12 * density);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < lines; i++) {
          const x1 = s * 0.25 + Math.random() * s * 0.5;
          const y1 = s * 0.35 + Math.random() * s * 0.45;
          const x2 = x1 + (Math.random() - 0.5) * s * 0.25;
          const y2 = y1 + (Math.random() - 0.5) * s * 0.25;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        break;
      }

      case 'halo': {
        const radius = Math.max(0.2, Math.min(1, step.radius || 0.7));
        const intensity = Math.max(0, Math.min(1, step.intensity || 0.35));
        const cx = s * 0.5;
        const cy = s * 0.55;
        const r = s * radius;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${intensity})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'block': {
        const wRatio = clamp(step.width || 0.6, 0.2, 0.95);
        const hRatio = clamp(step.height || 0.5, 0.2, 0.95);
        const x = s * 0.5 - (s * wRatio) / 2;
        const y = s * (step.y || (1 - hRatio - 0.08));
        const w = s * wRatio;
        const h = s * hRatio;
        ctx.fillStyle = getColor(step.color, palette.primary);
        roughRect(ctx, x, y, w, h, s * 0.02);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(x, y + h - s * 0.04, w, s * 0.04);
        break;
      }

      case 'archway': {
        const wRatio = clamp(step.width || 0.55, 0.3, 0.9);
        const hRatio = clamp(step.height || 0.7, 0.4, 0.95);
        const thickness = clamp(step.thickness || 0.18, 0.08, 0.3);
        const w = s * wRatio;
        const h = s * hRatio;
        const x = s * 0.5 - w / 2;
        const y = s * (1 - h - 0.05);
        ctx.fillStyle = getColor(step.color, palette.primary);
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(s * 0.5, y + h * 0.55, w * 0.35, Math.PI, 0);
        ctx.lineTo(s * 0.5 + w * 0.35, y + h);
        ctx.lineTo(s * 0.5 - w * 0.35, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = s * thickness * 0.2;
        ctx.strokeRect(x, y, w, h);
        break;
      }

      case 'spire': {
        const wRatio = clamp(step.width || 0.25, 0.08, 0.5);
        const hRatio = clamp(step.height || 0.85, 0.4, 0.98);
        const w = s * wRatio;
        const h = s * hRatio;
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.04;
        ctx.fillStyle = getColor(step.color, palette.primary);
        ctx.beginPath();
        ctx.moveTo(x, s);
        ctx.lineTo(x + w / 2, y);
        ctx.lineTo(x + w, s);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'ruin_wall': {
        const wRatio = clamp(step.width || 0.7, 0.3, 0.98);
        const hRatio = clamp(step.height || 0.5, 0.2, 0.8);
        const w = s * wRatio;
        const h = s * hRatio;
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.06;
        ctx.fillStyle = getColor(step.color, palette.primary);
        roughRect(ctx, x, y, w, h, s * 0.03);
        speckle(ctx, 'rgba(0,0,0,0.25)', 60, x, y, x + w, y + h, 2);
        break;
      }

      case 'rubble': {
        const count = clamp(step.count || 6, 2, 16);
        ctx.fillStyle = getColor(step.color, palette.primary);
        for (let i = 0; i < count; i++) {
          const w = s * randRange(0.08, 0.18);
          const h = s * randRange(0.04, 0.12);
          const x = randRange(s * 0.1, s * 0.8);
          const y = randRange(s * 0.65, s * 0.9);
          roughRect(ctx, x, y, w, h, s * 0.015);
        }
        break;
      }

      case 'stairs': {
        const steps = clamp(step.steps || 6, 3, 12);
        const w = s * clamp(step.width || 0.6, 0.3, 0.95);
        const h = s * clamp(step.height || 0.35, 0.2, 0.6);
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.05;
        ctx.fillStyle = getColor(step.color, palette.primary);
        for (let i = 0; i < steps; i++) {
          const sw = w * (1 - i / (steps * 1.3));
          const sh = h / steps;
          ctx.fillRect(x, y + i * sh, sw, sh);
        }
        break;
      }

      case 'crystal_cluster': {
        const count = clamp(step.count || 4, 2, 10);
        const baseY = s * 0.75;
        for (let i = 0; i < count; i++) {
          const h = s * randRange(0.2, 0.55);
          const w = h * randRange(0.2, 0.35);
          const x = s * 0.2 + randRange(0, s * 0.6);
          const y = baseY - h;
          ctx.fillStyle = getColor(step.color, palette.highlight);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + w / 2, y);
          ctx.lineTo(x + w, baseY);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'ribcage': {
        const ribs = clamp(step.count || 6, 3, 12);
        const span = s * clamp(step.span || 0.5, 0.3, 0.9);
        const baseY = s * 0.7;
        ctx.strokeStyle = getColor(step.color, palette.highlight);
        ctx.lineWidth = s * 0.03;
        for (let i = 0; i < ribs; i++) {
          const t = i / (ribs - 1);
          const r = span * (0.6 + 0.4 * (1 - t));
          const y = baseY - t * s * 0.35;
          ctx.beginPath();
          ctx.arc(s * 0.5, y, r * 0.5, Math.PI, 0);
          ctx.stroke();
        }
        break;
      }

      case 'totem': {
        const w = s * clamp(step.width || 0.25, 0.12, 0.45);
        const h = s * clamp(step.height || 0.7, 0.4, 0.9);
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.05;
        ctx.fillStyle = getColor(step.color, palette.primary);
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = getColor(step.accent, palette.shadow);
        ctx.fillRect(x, y + h * 0.2, w, s * 0.04);
        ctx.fillRect(x, y + h * 0.55, w, s * 0.04);
        break;
      }
    }
  });
}



function drawCustomTile(ctx, palette, customType, customStyle = {}) {
  const s = BASE_SIZE * UPSCALE;
  ctx.imageSmoothingEnabled = false;

  const proc = (customStyle && customStyle.procedure) || {};

  // --- material → local palette ---
  const material = proc.material || 'obsidian';
  let localPalette = { ...palette };
  switch (material) {
    case 'obsidian':
      localPalette = {
        primary: '#1a1a1a',
        secondary: '#050505',
        highlight: '#4a4a4a',
        shadow: '#000000'
      };
      break;
    case 'ash':
      localPalette = {
        primary: '#6a6350',
        secondary: '#322d22',
        highlight: '#938b6a',
        shadow: '#15130f'
      };
      break;
    case 'bone':
      localPalette = {
        primary: '#e1d6c4',
        secondary: '#b9aa92',
        highlight: '#fff5e3',
        shadow: '#8b7c62'
      };
      break;
    case 'rust':
      localPalette = {
        primary: '#c45a25',
        secondary: '#5a2312',
        highlight: '#ff7b3a',
        shadow: '#3a140b'
      };
      break;
    case 'crystal':
      localPalette = {
        primary: '#6363c7',
        secondary: '#242453',
        highlight: '#a4a4ff',
        shadow: '#151533'
      };
      break;
    default:
      localPalette = palette;
  }

  // --- If we have a high-level program, use it and bail ---
  if (Array.isArray(proc.program) && proc.program.length) {
    // program usually includes its own background + vignette
    runSpriteProgram(ctx, localPalette, proc.program);
    return;
  }

  // --- Otherwise fall back to the primitives logic OR fixed customs ---
  if (!proc.primitives || !proc.primitives.length) {
    return drawFixedCustomTile(ctx, localPalette, customType, customStyle);
  }

  const primitives = proc.primitives || [];
  const params = proc.params || {};
  const shape = params.shape || 'jagged';

  ctx.save();

  primitives.forEach(primitive => {
    switch (primitive) {
      case 'triangles': { // mountains/ruins (jagged peaks)
        const peaks = params.peaks || 3 + Math.floor(Math.random() * 3);
        const baseHeight = s * (params.height || 0.75);
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < peaks; i++) {
          const x = (i + 0.5) * s / peaks + (Math.random() - 0.5) * s * 0.1;
          let h = baseHeight * (0.7 + Math.random() * 0.3);
          if (shape === 'eroded') h *= 0.7;
          if (shape === 'piled') h *= 0.9;
          ctx.beginPath();
          ctx.moveTo(x - s * 0.08, s);
          ctx.lineTo(x, s - h);
          ctx.lineTo(x + s * 0.08, s);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'lines': { // trees/branches
        const branches = params.branches || 3 + Math.floor(Math.random() * 3);
        const trunkW = s * 0.08;
        const trunkH = s * 0.75;
        ctx.fillStyle = localPalette.shadow;
        ctx.fillRect(s/2 - trunkW/2, s - trunkH, trunkW, trunkH); // trunk
        ctx.strokeStyle = localPalette.shadow;
        ctx.lineWidth = trunkW * 0.6;
        for (let i = 0; i < branches; i++) {
          const base = params.angle || Math.PI * 0.3;
          const angle = base + (Math.random() - 0.5) * Math.PI * 1.4;
          const len = s * (params.length || 0.25 + Math.random() * 0.2);
          const yStart = s - trunkH + (branches > 1 ? (i / (branches - 1)) : 0.5) * trunkH * 0.7;
          ctx.beginPath();
          ctx.moveTo(s/2, yStart);
          ctx.lineTo(s/2 + Math.cos(angle) * len, yStart - Math.sin(angle) * len);
          ctx.stroke();
        }
        break;
      }

      case 'arcs': { // broken arches
        const radius = s * (params.radius || 0.35);
        const startAngle = (params.startAngle != null ? params.startAngle : Math.PI * 0.2);
        const endAngle   = (params.endAngle   != null ? params.endAngle   : Math.PI * 0.8);
        const thickness  = params.thickness || s * 0.15;
        ctx.beginPath();
        ctx.arc(s * 0.5, s * 0.45, radius, startAngle, endAngle);
        ctx.lineWidth = thickness;
        ctx.strokeStyle = localPalette.primary;
        ctx.stroke();
        break;
      }

      case 'rects': { // slabs / boulders
        const count = params.count || 4 + Math.floor(Math.random() * 4);
        const rectW = s * (params.width || 0.3);
        const rectH = s * (params.height || 0.2);
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < count; i++) {
          const x = Math.random() * (s - rectW);
          const y = s * 0.4 + Math.random() * (s * 0.6 - rectH);
          ctx.fillRect(x, y, rectW, rectH);
        }
        break;
      }

      case 'ellipse': { // ash piles / mounds
        const ellCount = params.count || 5 + Math.floor(Math.random() * 5);
        const rx = s * (params.radiusX || 0.2);
        const ry = s * (params.radiusY || 0.1);
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < ellCount; i++) {
          const x = s * 0.2 + Math.random() * s * 0.6;
          const y = s * 0.6 + Math.random() * s * 0.3;
          ctx.beginPath();
          ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'blocks': { // stacked blocks / monoliths
        const count = params.count || 3 + Math.floor(Math.random() * 4);
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < count; i++) {
          const w = s * (params.width || randRange(0.18, 0.35));
          const h = s * (params.height || randRange(0.25, 0.6));
          const x = randRange(s * 0.1, s * 0.8);
          const y = s - h - randRange(s * 0.05, s * 0.2);
          roughRect(ctx, x, y, w, h, s * 0.02);
        }
        break;
      }

      case 'archway': { // stone arch frame
        const wRatio = clamp(params.width || 0.5, 0.3, 0.9);
        const hRatio = clamp(params.height || 0.7, 0.4, 0.95);
        const w = s * wRatio;
        const h = s * hRatio;
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.08;
        ctx.fillStyle = localPalette.primary;
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(s * 0.5, y + h * 0.55, w * 0.35, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      case 'spire': { // tall spike
        const w = s * clamp(params.width || 0.22, 0.08, 0.4);
        const h = s * clamp(params.height || 0.85, 0.4, 0.98);
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.05;
        ctx.fillStyle = localPalette.primary;
        ctx.beginPath();
        ctx.moveTo(x, s);
        ctx.lineTo(x + w / 2, y);
        ctx.lineTo(x + w, s);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'ruin_wall': { // broken wall slab
        const wRatio = clamp(params.width || 0.7, 0.3, 0.98);
        const hRatio = clamp(params.height || 0.5, 0.2, 0.8);
        const w = s * wRatio;
        const h = s * hRatio;
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.06;
        ctx.fillStyle = localPalette.primary;
        roughRect(ctx, x, y, w, h, s * 0.03);
        speckle(ctx, 'rgba(0,0,0,0.25)', 60, x, y, x + w, y + h, 2);
        break;
      }

      case 'rubble': { // debris field
        const count = params.count || 8 + Math.floor(Math.random() * 6);
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < count; i++) {
          const w = s * randRange(0.05, 0.15);
          const h = s * randRange(0.03, 0.1);
          const x = randRange(s * 0.1, s * 0.85);
          const y = randRange(s * 0.65, s * 0.92);
          roughRect(ctx, x, y, w, h, s * 0.012);
        }
        break;
      }

      case 'crystal_cluster': { // tall crystals
        const count = params.count || 4 + Math.floor(Math.random() * 4);
        const baseY = s * 0.75;
        for (let i = 0; i < count; i++) {
          const h = s * randRange(0.2, 0.55);
          const w = h * randRange(0.2, 0.35);
          const x = s * 0.2 + randRange(0, s * 0.6);
          const y = baseY - h;
          ctx.fillStyle = localPalette.highlight;
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x + w / 2, y);
          ctx.lineTo(x + w, baseY);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'ribcage': { // bone arcs
        const ribs = params.count || 6 + Math.floor(Math.random() * 4);
        const span = s * clamp(params.span || 0.5, 0.3, 0.9);
        const baseY = s * 0.7;
        ctx.strokeStyle = localPalette.highlight;
        ctx.lineWidth = s * 0.03;
        for (let i = 0; i < ribs; i++) {
          const t = i / (ribs - 1);
          const r = span * (0.6 + 0.4 * (1 - t));
          const y = baseY - t * s * 0.35;
          ctx.beginPath();
          ctx.arc(s * 0.5, y, r * 0.5, Math.PI, 0);
          ctx.stroke();
        }
        break;
      }

      case 'totem': { // stacked totem/obelisk
        const w = s * clamp(params.width || 0.22, 0.1, 0.4);
        const h = s * clamp(params.height || 0.8, 0.4, 0.95);
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.05;
        ctx.fillStyle = localPalette.primary;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = localPalette.shadow;
        ctx.fillRect(x, y + h * 0.2, w, s * 0.04);
        ctx.fillRect(x, y + h * 0.55, w, s * 0.04);
        break;
      }

      case 'stairs': { // stepped platform
        const steps = clamp(params.steps || 6, 3, 12);
        const w = s * clamp(params.width || 0.6, 0.3, 0.95);
        const h = s * clamp(params.height || 0.35, 0.2, 0.6);
        const x = s * 0.5 - w / 2;
        const y = s - h - s * 0.05;
        ctx.fillStyle = localPalette.primary;
        for (let i = 0; i < steps; i++) {
          const sw = w * (1 - i / (steps * 1.3));
          const sh = h / steps;
          ctx.fillRect(x, y + i * sh, sw, sh);
        }
        break;
      }

      default:
        console.warn('Unknown primitive:', primitive);
    }
  });

  ctx.restore();

  // Procedural vignette (always, for depth)
  const vignette = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s*0.7);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.7, 'rgba(0,0,0,0.4)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, s, s);
}


// FALLBACK: Fixed drawer for legacy/no-procedure tiles (your original cases)
function drawFixedCustomTile(ctx, palette, customType, customStyle = {}) {
  const s = BASE_SIZE * UPSCALE;
  ctx.imageSmoothingEnabled = false;

  const localPalette = {
    primary:   customStyle.primary   || palette.primary   || "#553344",
    secondary: customStyle.secondary || palette.secondary || "#22111a",
    highlight: customStyle.highlight || palette.highlight || "#ff4040",
    shadow:    customStyle.shadow    || palette.shadow    || "#050307"
  };

  // Base dark fill
  ctx.fillStyle = localPalette.secondary;
  ctx.fillRect(0, 0, s, s);

  switch (customType) {
    case 'archway':
    case 'stone_arch':
    case 'gate':
      ctx.fillStyle = localPalette.primary;
      ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.7);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.55, s * 0.22, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;

    case 'mountain':
    case 'jagged_peak':
    case 'rock_spire':
      // Tall jagged mountain peaks
      const peaks = customStyle.peaks || 4 + Math.floor(Math.random() * 3);
      const baseHeight = s * (customStyle.height || 0.85);
      ctx.fillStyle = localPalette.primary;
      for (let i = 0; i < peaks; i++) {
        const x = (i + 0.5) * s / peaks + (Math.random() - 0.5) * s * 0.1;
        const h = baseHeight * (0.7 + Math.random() * 0.3);
        ctx.beginPath();
        ctx.moveTo(x - s * 0.08, s);
        ctx.lineTo(x, s - h);
        ctx.lineTo(x + s * 0.08, s);
        ctx.closePath();
        ctx.fill();
      }
      // Snow/ash caps on tallest peaks
      ctx.fillStyle = "#aaa29c";
      for (let i = 0; i < peaks; i++) {
        if (Math.random() > 0.5) {
          const x = (i + 0.5) * s / peaks;
          ctx.fillRect(x - s * 0.04, s - baseHeight * 0.9, s * 0.08, s * 0.05);
        }
      }
      break;

    case 'spire':
      ctx.fillStyle = localPalette.primary;
      ctx.beginPath();
      ctx.moveTo(s * 0.5 - s * 0.08, s);
      ctx.lineTo(s * 0.5, s * 0.1);
      ctx.lineTo(s * 0.5 + s * 0.08, s);
      ctx.closePath();
      ctx.fill();
      break;

    case 'dead_tree':
    case 'withered_tree':
      // Twisted dead tree
      const trunkW = s * 0.08;
      const trunkH = s * 0.75;
      ctx.fillStyle = localPalette.shadow;
      ctx.fillRect(s/2 - trunkW/2, s - trunkH, trunkW, trunkH);

      const branches = customStyle.branches || 3 + Math.floor(Math.random() * 3);
      ctx.strokeStyle = localPalette.shadow;
      ctx.lineWidth = trunkW * 0.6;
      for (let i = 0; i < branches; i++) {
        const angle = Math.PI * 0.3 + Math.random() * Math.PI * 1.4;
        const len = s * (0.25 + Math.random() * 0.2);
        const yStart = s - trunkH + (i / (branches - 1)) * trunkH * 0.7;
        ctx.beginPath();
        ctx.moveTo(s/2, yStart);
        ctx.lineTo(s/2 + Math.cos(angle) * len, yStart - Math.sin(angle) * len);
        ctx.stroke();
      }
      break;

    case 'ruin_wall':
    case 'ruin':
    case 'broken_arch':
    case 'collapsed_wall':
      // Broken stone arch or ruined wall segment
      ctx.fillStyle = localPalette.primary;
      ctx.fillRect(s * 0.1, s * 0.4, s * 0.8, s * 0.6); // Base rubble

      // Remaining arch pieces
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.45, s * 0.35, Math.PI * 0.2, Math.PI * 0.8);
      ctx.lineWidth = s * 0.15;
      ctx.strokeStyle = localPalette.primary;
      ctx.stroke();

      // Cracks and damage
      ctx.strokeStyle = localPalette.shadow;
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const x1 = Math.random() * s;
        const y1 = s * 0.4 + Math.random() * s * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + (Math.random() - 0.5) * 60, y1 + 40);
        ctx.stroke();
      }
      break;

    case 'rubble':
      ctx.fillStyle = localPalette.primary;
      for (let i = 0; i < 10; i++) {
        const w = s * randRange(0.05, 0.16);
        const h = s * randRange(0.03, 0.1);
        const x = randRange(s * 0.1, s * 0.85);
        const y = randRange(s * 0.7, s * 0.92);
        roughRect(ctx, x, y, w, h, s * 0.012);
      }
      break;

    case 'crystal_cluster':
    case 'boulder':
    case 'rock':
      // Large cracked boulder
      ctx.fillStyle = localPalette.primary;
      ctx.beginPath();
      ctx.arc(s/2, s/2 + s*0.1, s*0.38, 0, Math.PI*2);
      ctx.fill();

      // Crack lines
      ctx.strokeStyle = localPalette.shadow;
      ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const len = s * 0.3;
        ctx.beginPath();
        ctx.moveTo(s/2, s/2 + s*0.1);
        ctx.lineTo(s/2 + Math.cos(angle) * len, s/2 + s*0.1 + Math.sin(angle) * len);
        ctx.stroke();
      }
      break;

    case 'ribcage':
      ctx.strokeStyle = localPalette.highlight;
      ctx.lineWidth = s * 0.03;
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const r = s * 0.22 + (1 - t) * s * 0.18;
        const y = s * 0.7 - t * s * 0.35;
        ctx.beginPath();
        ctx.arc(s * 0.5, y, r, Math.PI, 0);
        ctx.stroke();
      }
      break;

    case 'totem':
      ctx.fillStyle = localPalette.primary;
      ctx.fillRect(s * 0.42, s * 0.15, s * 0.16, s * 0.75);
      ctx.fillStyle = localPalette.shadow;
      ctx.fillRect(s * 0.42, s * 0.35, s * 0.16, s * 0.04);
      ctx.fillRect(s * 0.42, s * 0.6, s * 0.16, s * 0.04);
      break;

    case 'ash_pile':
    case 'bone_pile':
      // Low mound of ash or bones
      ctx.fillStyle = customType === 'bone_pile' ? "#d4ccbf" : "#444033";
      ctx.beginPath();
      ctx.ellipse(s/2, s*0.85, s*0.45, s*0.25, 0, 0, Math.PI*2);
      ctx.fill();
      // Random bone sticks or ash wisps
      ctx.fillStyle = customType === 'bone_pile' ? "#ffffff" : "#222222";
      for (let i = 0; i < 8; i++) {
        const x = s*0.2 + Math.random() * s*0.6;
        const y = s*0.6 + Math.random() * s*0.3;
        ctx.fillRect(x, y, 4 + Math.random() * 8, 20 + Math.random() * 30);
      }
      break;

    default:
      // Ultimate fallback to basic wall
      drawWallFromStyle(ctx, localPalette, { brickSize: "large" });
  }

  // Universal dark vignette for underworld feel
  const vignette = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s*0.7);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.7, 'rgba(0,0,0,0.4)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, s, s);
}

// ===== Original Drawing primitives (unchanged) =====
function drawWallFromStyle(ctx, palette, wallStyle) {
  const s = BASE_SIZE * UPSCALE;
  ctx.fillStyle = palette.secondary;
  ctx.fillRect(0, 0, s, s);

  const brickSize  = wallStyle.brickSize  || "medium";
  const mortarCol  = wallStyle.mortarColor || palette.shadow;
  const accentCol  = wallStyle.accentColor || palette.highlight;
  const bakedLighting = wallStyle.bakedLighting === true;

  let rows, cols;
  if (brickSize === "small") {
    rows = 8; cols = 12;
  } else if (brickSize === "large") {
    rows = 4; cols = 6;
  } else {
    rows = 6; cols = 8;
  }

  const brickH = s / rows;
  const brickW = s / cols;

  ctx.fillStyle = mortarCol;
  ctx.fillRect(0, 0, s, s);

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (brickW / 2);
    for (let col = -1; col <= cols; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;

      ctx.fillStyle = palette.primary;
      ctx.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);

      if (bakedLighting) {
        ctx.fillStyle = palette.shadow;
        ctx.fillRect(x + 2, y + brickH - 6, brickW - 4, 4);
      }
    }
  }

  // occasional accent bricks
  const accentCount = Number.isFinite(wallStyle.accentCount)
    ? Math.max(0, Math.floor(wallStyle.accentCount))
    : (bakedLighting ? 5 : 0);
  for (let i = 0; i < accentCount; i++) {
    const row = Math.floor(Math.random() * rows);
    const col = Math.floor(Math.random() * cols);
    const offset = (row % 2) * (brickW / 2);
    const x = col * brickW + offset;
    const y = row * brickH;
    ctx.fillStyle = accentCol;
    ctx.fillRect(x + 3, y + 3, brickW - 6, brickH - 6);
  }

  // No vertical vignette here; it breaks seamless tiling for extended walls.
}

function drawFloorFromStyle(ctx, palette, floorStyle) {
  const s = BASE_SIZE * UPSCALE;
  ctx.fillStyle = palette.secondary;
  ctx.fillRect(0, 0, s, s);

  const pattern = floorStyle.pattern || "square_tiles";
  const variation = typeof floorStyle.variation === 'number' ? floorStyle.variation : 0.3;
  const cracks = typeof floorStyle.cracks === 'number' ? floorStyle.cracks : 0.2;

  if (pattern === "hex_tiles") {
    const tiles = 6;
    const size = s / tiles;
    ctx.fillStyle = palette.primary;
    for (let y = 0; y < tiles + 1; y++) {
      for (let x = 0; x < tiles + 1; x++) {
        const px = x * size + ((y % 2) ? size / 2 : 0);
        const py = y * size * 0.8;
        ctx.beginPath();
        ctx.moveTo(px + size * 0.5, py);
        ctx.lineTo(px + size, py + size * 0.25);
        ctx.lineTo(px + size, py + size * 0.75);
        ctx.lineTo(px + size * 0.5, py + size);
        ctx.lineTo(px, py + size * 0.75);
        ctx.lineTo(px, py + size * 0.25);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    const tiles = 6;
    const tileSize = s / tiles;
    ctx.fillStyle = palette.primary;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        const jitter = (Math.random() - 0.5) * variation * 6;
        ctx.fillStyle = palette.primary;
        ctx.fillRect(
          x * tileSize + 2 + jitter,
          y * tileSize + 2 + jitter,
          tileSize - 4,
          tileSize - 4
        );
      }
    }
    ctx.fillStyle = palette.shadow;
    for (let i = 0; i < cracks * 50; i++) {
      const x1 = Math.random() * s;
      const y1 = Math.random() * s;
      const x2 = x1 + (Math.random() - 0.5) * 40;
      const y2 = y1 + (Math.random() - 0.5) * 40;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  const grad = ctx.createRadialGradient(
    s / 2, s / 2, 0,
    s / 2, s / 2, s / 1.2
  );
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
 
  // --- SEAM FIX: force a 1px tiling-safe border ---
  // Pick a mid-tone between primary and shadow so it blends nicely.
  function lerpColorHex(c1, c2, t) {
    const h1 = parseInt(c1.slice(1), 16);
    const h2 = parseInt(c2.slice(1), 16);
    const r1 = (h1 >> 16) & 0xff, g1 = (h1 >> 8) & 0xff, b1 = h1 & 0xff;
    const r2 = (h2 >> 16) & 0xff, g2 = (h2 >> 8) & 0xff, b2 = h2 & 0xff;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }
  const borderColor = lerpColorHex(palette.primary, palette.shadow, 0.4);
  ctx.fillStyle = borderColor;
  // Top & bottom rows
  ctx.fillRect(0, 0, s, 1);
  ctx.fillRect(0, s - 1, s, 1);
  // Left & right columns
  ctx.fillRect(0, 0, 1, s);
  ctx.fillRect(s - 1, 0, 1, s);
}

function drawDoorFromStyle(ctx, palette, doorStyle) {
  const s = BASE_SIZE * UPSCALE;
  const material = doorStyle.material || "wood";
  let baseTop, baseBottom;
  if (material === "bone") {
    baseTop = "#f0e6d6";
    baseBottom = "#c9b49a";
  } else if (material === "metal" || material === "stone") {
    baseTop = "#777d86";
    baseBottom = "#3e444c";
  } else {
    // wood
    baseTop = "#4b2f1b";
    baseBottom = "#2e1b10";
  }
  const grad = ctx.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, baseTop);
  grad.addColorStop(1, baseBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const planks = 4;
  const plankW = s / planks;
  for (let i = 0; i < planks; i++) {
    const x = i * plankW;
    ctx.fillStyle = i % 2 ? baseBottom : baseTop;
    ctx.fillRect(x + 3, 3, plankW - 6, s - 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 5, s * 0.2);
    ctx.lineTo(x + plankW - 5, s * 0.2 + 12);
    ctx.stroke();
  }
  const bands = doorStyle.bands || "iron";
  if (bands !== "none") {
    ctx.fillStyle = bands === "bronze" ? "#b28434" : "#444";
    ctx.fillRect(0, s * 0.22, s, 10);
    ctx.fillRect(0, s * 0.78, s, 10);
  }
  ctx.fillStyle = "#c9aa3d";
  ctx.beginPath();
  ctx.arc(s * 0.7, s * 0.5, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function drawTorchWallFromStyle(ctx, palette, wallStyle, torchStyle, includeWall = true) {
  const s = BASE_SIZE * UPSCALE;
  if (includeWall) {
    // Base wall
    drawWallFromStyle(ctx, palette, wallStyle);
  } else {
    // Transparent background for torch sprite
    ctx.clearRect(0, 0, s, s);
  }
  // Torch sprite: draw only the wall sconce (no baked flame/halo).
  const cx = s / 2;
  const cy = s * 0.32;
  const metal = (torchStyle && torchStyle.metalColor) || "#2a2218";
  const metalAccent = (torchStyle && torchStyle.metalAccent) || "#3b3024";
  // Bracket / holder
  ctx.fillStyle = metal;
  ctx.fillRect(cx - s * 0.04, cy, s * 0.08, s * 0.34);
  ctx.fillRect(cx - s * 0.11, cy + s * 0.1, s * 0.22, s * 0.05);
  // Subtle accent for depth
  ctx.fillStyle = metalAccent;
  ctx.fillRect(cx - s * 0.04, cy + s * 0.02, s * 0.08, s * 0.02);
}

function drawPillar(ctx, palette) {
  const s = BASE_SIZE * UPSCALE;

  ctx.clearRect(0, 0, s, s);

  const baseY = Math.floor(s * 0.78);
  const baseH = Math.max(2, Math.floor(s * 0.22));
  const baseTopY = baseY + Math.max(1, Math.floor(s * 0.02));
  const baseTopH = Math.max(1, baseH - Math.max(2, Math.floor(s * 0.04)));

  // Base shadow + top (extend to bottom to avoid padding)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(s * 0.3, baseY, s * 0.4, baseH);
  ctx.fillStyle = palette.primary;
  ctx.fillRect(s * 0.32, baseTopY, s * 0.36, baseTopH);

  // Shaft
  const shaftW = s * 0.35;
  const shaftX = (s - shaftW) / 2;
  const shaftY = s * 0.2;
  const shaftH = Math.max(2, baseY - shaftY - Math.floor(s * 0.03));
  ctx.fillStyle = palette.secondary;
  ctx.fillRect(shaftX - 1, shaftY, shaftW + 2, shaftH);
  ctx.fillStyle = palette.primary;
  ctx.fillRect(shaftX, shaftY, shaftW, shaftH);

  // Flutes
  const flutes = 4;
  for (let i = 0; i < flutes; i++) {
    const fx = shaftX + (shaftW / (flutes + 1)) * (i + 1);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(fx, shaftY + 2, 2, shaftH - 4);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(fx + 2, shaftY + 2, 1, shaftH - 4);
  }

  // Capital
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(shaftX - s * 0.08, shaftY - s * 0.08, shaftW + s * 0.16, s * 0.1);
  ctx.fillStyle = palette.primary;
  ctx.fillRect(shaftX - s * 0.05, shaftY - s * 0.05, shaftW + s * 0.1, s * 0.06);
}

// ===== Main entry point (modified to support custom tiles) =====
function generateSpriteFromStyle(style, tileType, name = 'sprite') {
  const outDir = path.join(__dirname, '../sid/sprites');
  ensureDir(outDir);

  const canvas = createCanvas(BASE_SIZE * UPSCALE, BASE_SIZE * UPSCALE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const palette = normalizePalette(style && style.palette);
  const floorStyle = (style && style.floor) || {};
  const wallStyle  = (style && style.wall)  || {};
  const doorStyle  = (style && style.door)  || {};
  const torchStyle = (style && style.torch) || {};

  // NEW: Custom tile handling
  if (tileType.startsWith('custom_')) {
    const customType = tileType.slice(7); // remove "custom_"
    drawCustomTile(ctx, palette, customType, style); // style here is the tile-specific style object from LLM
  } else {
    // Original switch
    switch (tileType) {
      case 'floor':
        drawFloorFromStyle(ctx, palette, floorStyle);
        break;
      case 'door':
        drawDoorFromStyle(ctx, palette, doorStyle);
        break;
      case 'torch':
        drawTorchWallFromStyle(ctx, palette, wallStyle, torchStyle, false);
        break;
      case 'pillar':
        drawPillar(ctx, palette);
        break;
      case 'wall':
      default:
        drawWallFromStyle(ctx, palette, wallStyle);
        break;
    }
  }

  const filename = `${name}.png`;
  const fullpath = path.join(outDir, filename);
  fs.writeFileSync(fullpath, canvas.toBuffer());

  return `/sid/sprites/${filename}?cb=${Date.now()}`;
}

module.exports = { generateSpriteFromStyle };


