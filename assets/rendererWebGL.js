(function () {
  const seamPad = (typeof window !== 'undefined' && Number.isFinite(window.VOXEL_SEAM_PAD)) ? window.VOXEL_SEAM_PAD : 0.08;
  function formatShaderSource(source) {
    return String(source)
      .split('\n')
      .map((line, idx) => `${String(idx + 1).padStart(4, ' ')} | ${line}`)
      .join('\n');
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('WebGL shader compile error:', gl.getShaderInfoLog(shader));
      console.error('Shader source:\n' + formatShaderSource(source));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('WebGL program link error:', gl.getProgramInfoLog(program));
      console.error('Vertex shader source:\n' + formatShaderSource(vsSource));
      console.error('Fragment shader source:\n' + formatShaderSource(fsSource));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

(function () {
  function normalizeLight(light) {
    const fallback = {
      dirX: -0.7,
      dirY: -0.7,
      elevation: 0.6,
      intensity: 0.6,
      color: '#FFFFFF'
    };
    if (!light) return fallback;
    let dirX = null;
    let dirY = null;
    if (typeof light.dir === 'string') {
      const d = light.dir.trim().toUpperCase();
      const map = {
        N:  [0, -1],
        NE: [0.7, -0.7],
        E:  [1, 0],
        SE: [0.7, 0.7],
        S:  [0, 1],
        SW: [-0.7, 0.7],
        W:  [-1, 0],
        NW: [-0.7, -0.7]
      };
      if (map[d]) {
        dirX = map[d][0];
        dirY = map[d][1];
      }
    } else if (Number.isFinite(light.dirX) && Number.isFinite(light.dirY)) {
      dirX = light.dirX;
      dirY = light.dirY;
    } else if (Number.isFinite(light.x) && Number.isFinite(light.y)) {
      dirX = light.x;
      dirY = light.y;
    } else if (Number.isFinite(light.angle)) {
      const a = light.angle * (Math.PI / 180);
      dirX = Math.cos(a);
      dirY = Math.sin(a);
    }
    if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) {
      dirX = fallback.dirX;
      dirY = fallback.dirY;
    }
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    const elevation = Number.isFinite(light.elevation) ? Math.max(0.05, Math.min(0.95, light.elevation)) : fallback.elevation;
    const intensity = Number.isFinite(light.intensity) ? Math.max(0, Math.min(1, light.intensity)) : fallback.intensity;
    const color = /^#[0-9a-fA-F]{6}$/.test(light.color || '') ? String(light.color).toUpperCase() : fallback.color;
    return { dirX, dirY, elevation, intensity, color };
  }

  const MAX_TORCH_LIGHTS = 64;
      const TORCH_LIGHT_RADIUS_FLOOR = 6.0;
      const TORCH_LIGHT_RADIUS_VOXEL_SCALE = 6.0;
  const TORCH_LIGHT_FALLOFF = 0.6;
  const TORCH_LIGHT_COLOR = { r: 255, g: 190, b: 130 };

  function isTextureReady(img) {
    return !!(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
  }

  const TORCH_FLICKER_SPEED = 0.6;

  function torchFlicker(seed, timeMs) {
    const t = timeMs * 0.001 * TORCH_FLICKER_SPEED;
    const speedMod = 0.65
      + 0.25 * Math.sin(t * (0.35 + seed * 0.12) + seed * 5.1)
      + 0.1 * Math.sin(t * (0.07 + seed * 0.03) + seed * 17.3);
    const tt = t * speedMod;
    const base = 0.72 + 0.08 * Math.sin(tt * (1.1 + seed * 0.4) + seed * 9.7);
    const pulse = Math.pow(Math.max(0, Math.sin(tt * (3.6 + seed * 1.4) + seed * 13.3)), 2) * 0.22;
    const crackle = Math.pow(Math.max(0, Math.sin(tt * (9.5 + seed * 3.1) + seed * 27.1)), 3) * 0.12;
    const jitter = Math.sin(tt * (17.0 + seed * 5.7) + seed * 41.0) * 0.04;
    return base + pulse + crackle + jitter;
  }

  function buildAtlas(textures) {
    const keys = Object.keys(textures || {}).filter((name) => {
      if (name === 'floor') return false;
      if (name.startsWith('custom_')) return false;
      if (name === 'torch') return false;
      if (name === 'pillar') return false;
      const img = textures[name];
      return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    });
    if (!keys.length) return null;

    let maxW = 1;
    let maxH = 1;
    for (const name of keys) {
      const img = textures[name];
      maxW = Math.max(maxW, img.naturalWidth);
      maxH = Math.max(maxH, img.naturalHeight);
    }

    const cols = Math.ceil(Math.sqrt(keys.length));
    const rows = Math.ceil(keys.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * maxW;
    canvas.height = rows * maxH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const map = {};
    keys.forEach((name, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const img = textures[name];
      ctx.drawImage(img, col * maxW, row * maxH, maxW, maxH);
      map[name] = idx;
    });

    return { canvas, cols, rows, tileW: maxW, tileH: maxH, map };
  }

  const renderer = {
    gl: null,
    canvas: null,
    miniCanvas: null,
    miniCtx: null,
    program: null,
    posBuffer: null,
    uniformLocations: {},
    cellTex: null,
    wallAtlasTex: null,
    floorTex: null,
    atlasInfo: null,
    atlasKey: '',
    dungeonKey: null,
    heightMin: 0,
    heightRange: 1,
    gridW: 0,
    gridH: 0,
    atlasReady: false,
    floorTexReady: false,
    spriteProgram: null,
    spriteBuffer: null,
    spriteAttribs: {},
    spriteUniforms: {},
    spriteTexCache: {},
    voxelProgram: null,
    voxelAttribs: {},
    voxelUniforms: {},
    voxelMeshes: {},
    voxelPaletteKey: null,
    haloTex: null,
    flameTex: null,
    customPadCache: {},

    getCustomTypeFromName(name) {
      const match = /^custom_(.+)_\d+$/.exec(String(name || ''));
      return match ? match[1] : null;
    },

    getCustomTileMeta(tileName, dungeon) {
      if (!tileName || !dungeon || !Array.isArray(dungeon.customTiles)) return null;
      const type = this.getCustomTypeFromName(tileName);
      if (!type) return null;
      return dungeon.customTiles.find((t) => t && t.type === type) || null;
    },

    getMaterialPalette(material, basePalette) {
      if (!material) return basePalette || { primary: '#777777' };
      switch (material) {
        case 'stone':
          return basePalette || { primary: '#7a7a7a', secondary: '#4a4a4a', highlight: '#9c9c9c', shadow: '#2b2b2b' };
        case 'obsidian':
          return { primary: '#1a1a1a', secondary: '#050505', highlight: '#4a4a4a', shadow: '#000000' };
        case 'ash':
          return { primary: '#6a6350', secondary: '#322d22', highlight: '#938b6a', shadow: '#15130f' };
        case 'bone':
          return { primary: '#e1d6c4', secondary: '#b9aa92', highlight: '#fff5e3', shadow: '#8b7c62' };
        case 'rust':
          return { primary: '#c45a25', secondary: '#5a2312', highlight: '#ff7b3a', shadow: '#3a140b' };
        case 'crystal':
          return { primary: '#6363c7', secondary: '#242453', highlight: '#a4a4ff', shadow: '#151533' };
        case 'marble':
          return { primary: '#d8d2c8', secondary: '#a5a09a', highlight: '#f1ece4', shadow: '#7a756f' };
        case 'metal':
          return { primary: '#8a8f96', secondary: '#4e5257', highlight: '#c6cbd2', shadow: '#2c2f33' };
        case 'wood':
          return { primary: '#8a5b36', secondary: '#5a3a22', highlight: '#b07a4a', shadow: '#3a2416' };
        default:
          return basePalette || { primary: '#777777' };
      }
    },

    buildVoxelGrid(tileName, dungeon, size = 16) {
      const voxels = new Uint8Array(size * size * size);
      const setVoxel = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return;
        voxels[x + y * size + z * size * size] = 1;
      };
      const getVoxel = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0;
        return voxels[x + y * size + z * size * size];
      };

      const meta = dungeon.tiles?.[tileName]?.spriteSpec || {};
      const heightRatio = typeof meta.heightRatio === 'number' ? meta.heightRatio : 1.0;
      const gridWidth = typeof meta.gridWidth === 'number'
        ? meta.gridWidth
        : (typeof meta.baseWidth === 'number' ? meta.baseWidth : 0.6);
      const height = Math.min(size, Math.max(2, Math.floor(size * heightRatio)));
      const width = Math.min(size, Math.max(2, Math.floor(size * gridWidth)));
      const cx = (size - 1) / 2;
      const cy = (size - 1) / 2;
      const name = String(tileName || '');
      const typeHint = this.getCustomTypeFromName(name) || name;
      const type = tileName === 'pillar' ? 'pillar' : typeHint;
      const nameLower = name.toLowerCase();
      const typeLower = String(type || '').toLowerCase();
      const detail = meta.detail || {};
      const clamp = (value, min, max, fallback) => {
        const v = Number.isFinite(value) ? value : fallback;
        return Math.max(min, Math.min(max, v));
      };

      const fillBox = (x0, y0, z0, x1, y1, z1) => {
        for (let z = z0; z < z1; z++) {
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              setVoxel(x, y, z);
            }
          }
        }
      };

      const isColumnLike =
        tileName === 'pillar' ||
        nameLower.includes('pillar') ||
        nameLower.includes('column') ||
        typeLower.includes('pillar') ||
        typeLower.includes('column') ||
        meta.profile === 'cylinder';

      if (isColumnLike) {
        const radius = width / 2;
        const maxRadius = Math.max(1, (size - 2) / 2);
        const baseHeight = Math.max(1, Math.floor(height * clamp(detail.baseHeight, 0, 0.3, 0.18)));
        const capHeight = Math.max(1, Math.floor(height * clamp(detail.capHeight, 0, 0.3, 0.12)));
        const baseFlare = clamp(detail.baseFlare, 0, 0.3, 0.12);
        const capFlare = clamp(detail.capFlare, 0, 0.3, 0.1);
        const taper = clamp(detail.taper, 0, 0.3, 0.06);
        const globalCoreFill = Number.isFinite(window.PILLAR_CORE_FILL)
          ? window.PILLAR_CORE_FILL
          : 1.00;
        const coreFill = clamp(detail.coreFill, 0.4, 1.0, globalCoreFill);
        for (let z = 0; z < height; z++) {
          const t = height > 1 ? z / (height - 1) : 0;
          let radiusZ = radius * (1 - taper * t);
          if (z < baseHeight) radiusZ = radius * (1 + baseFlare);
          if (z >= height - capHeight) radiusZ = radius * (1 + capFlare);
          radiusZ = Math.max(1, Math.min(maxRadius, radiusZ));
          const fillRadius = Math.min(maxRadius, radiusZ + 0.35);
          const coreRadius = Math.max(1, Math.min(maxRadius, radiusZ * coreFill));
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const dx = x - cx;
              const dy = y - cy;
              if (dx * dx + dy * dy <= fillRadius * fillRadius) {
                setVoxel(x, y, z);
              }
            }
          }
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const dx = x - cx;
              const dy = y - cy;
              if (dx * dx + dy * dy <= coreRadius * coreRadius) {
                setVoxel(x, y, z);
              }
            }
          }
          // Close any remaining micro-gaps with a single dilation pass.
          for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
              if (getVoxel(x, y, z)) continue;
              const dx = x - cx;
              const dy = y - cy;
              if (dx * dx + dy * dy > fillRadius * fillRadius) continue;
              const neighbors =
                getVoxel(x - 1, y, z) +
                getVoxel(x + 1, y, z) +
                getVoxel(x, y - 1, z) +
                getVoxel(x, y + 1, z);
              if (neighbors >= 1) {
                setVoxel(x, y, z);
              }
            }
          }
          // Fill any interior gaps on this slice so pillars stay solid without a hard shape.
          for (let y = 0; y < size; y++) {
            let minX = -1;
            let maxX = -1;
            for (let x = 0; x < size; x++) {
              if (getVoxel(x, y, z)) {
                minX = x;
                break;
              }
            }
            for (let x = size - 1; x >= 0; x--) {
              if (getVoxel(x, y, z)) {
                maxX = x;
                break;
              }
            }
            if (minX >= 0 && maxX >= 0 && maxX > minX) {
              for (let x = minX; x <= maxX; x++) {
                setVoxel(x, y, z);
              }
            }
          }
          // Second pass: fill along columns to close corner gaps.
          for (let x = 0; x < size; x++) {
            let minY = -1;
            let maxY = -1;
            for (let y = 0; y < size; y++) {
              if (getVoxel(x, y, z)) {
                minY = y;
                break;
              }
            }
            for (let y = size - 1; y >= 0; y--) {
              if (getVoxel(x, y, z)) {
                maxY = y;
                break;
              }
            }
            if (minY >= 0 && maxY >= 0 && maxY > minY) {
              for (let y = minY; y <= maxY; y++) {
                setVoxel(x, y, z);
              }
            }
          }
          // Final pass: fill tiny interior slits without squaring the silhouette.
          for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
              if (getVoxel(x, y, z)) continue;
              const dx = x - cx;
              const dy = y - cy;
              if (dx * dx + dy * dy > radiusZ * radiusZ) continue;
              const neighbors =
                getVoxel(x - 1, y, z) +
                getVoxel(x + 1, y, z) +
                getVoxel(x, y - 1, z) +
                getVoxel(x, y + 1, z);
              if (neighbors >= 3) {
                setVoxel(x, y, z);
              }
            }
          }
          // Flood-fill any remaining enclosed voids inside the slice mask.
          const sliceVisited = new Uint8Array(size * size);
          const queueX = [];
          const queueY = [];
          const inside = (x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            return (dx * dx + dy * dy) <= fillRadius * fillRadius;
          };
          const pushIfOutside = (x, y) => {
            const idx = y * size + x;
            if (sliceVisited[idx]) return;
            if (!inside(x, y)) return;
            if (getVoxel(x, y, z)) return;
            sliceVisited[idx] = 1;
            queueX.push(x);
            queueY.push(y);
          };
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (!inside(x, y)) continue;
              if (getVoxel(x, y, z)) continue;
              const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
              const nearOutside =
                !inside(x - 1, y) ||
                !inside(x + 1, y) ||
                !inside(x, y - 1) ||
                !inside(x, y + 1);
              if (edge || nearOutside) {
                pushIfOutside(x, y);
              }
            }
          }
          while (queueX.length) {
            const x = queueX.pop();
            const y = queueY.pop();
            const nx = x - 1;
            const px = x + 1;
            const ny = y - 1;
            const py = y + 1;
            if (nx >= 0) pushIfOutside(nx, y);
            if (px < size) pushIfOutside(px, y);
            if (ny >= 0) pushIfOutside(x, ny);
            if (py < size) pushIfOutside(x, py);
          }
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (!inside(x, y)) continue;
              if (getVoxel(x, y, z)) continue;
              const idx = y * size + x;
              if (!sliceVisited[idx]) {
                setVoxel(x, y, z);
              }
            }
          }
        }
      } else if (type.includes('arch')) {
        const colW = Math.max(2, Math.floor(width * 0.3));
        const colH = Math.max(2, Math.floor(height * 0.8));
        const xLeft = Math.floor(cx - width / 2);
        const xRight = Math.floor(cx + width / 2) - colW;
        const y0 = Math.floor(cy - colW / 2);
        const y1 = y0 + colW;
        fillBox(xLeft, y0, 0, xLeft + colW, y1, colH);
        fillBox(xRight, y0, 0, xRight + colW, y1, colH);
        const beamH = Math.max(1, Math.floor(height * 0.2));
        fillBox(xLeft, y0, colH - beamH, xRight + colW, y1, colH);
      } else if (type.includes('altar')) {
        const baseH = Math.max(2, Math.floor(height * 0.35));
        const topH = Math.max(1, Math.floor(height * 0.2));
        const baseX = Math.floor(cx - width / 2);
        const baseY = Math.floor(cy - width / 2);
        fillBox(baseX, baseY, 0, baseX + width, baseY + width, baseH);
        const topW = Math.max(2, Math.floor(width * 0.6));
        const topX = Math.floor(cx - topW / 2);
        const topY = Math.floor(cy - topW / 2);
        fillBox(topX, topY, baseH, topX + topW, topY + topW, baseH + topH);
      } else {
        const x0 = Math.floor(cx - width / 2);
        const y0 = Math.floor(cy - width / 2);
        fillBox(x0, y0, 0, x0 + width, y0 + width, height);
      }

      return voxels;
    },

    meshVoxelsSimple(voxels, size, colorFn, opts = {}) {
      const vertices = [];
      const indices = [];
      let index = 0;

      const seamPad = Number.isFinite(opts.seamPad) ? opts.seamPad : 0;

      const get = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0;
        return voxels[x + y * size + z * size * size];
      };

      const pushQuad = (p0, p1, p2, p3, n, c) => {
        // optional pad in plane (helps cover tiny cracks)
        if (seamPad) {
          // expand in the two axes not aligned with the normal
          const ax = Math.abs(n[0]) > 0.5 ? 1 : 0;
          const ay = Math.abs(n[1]) > 0.5 ? 1 : 0;
          const az = Math.abs(n[2]) > 0.5 ? 1 : 0;

          const pad = (p) => {
            if (!ax) p[0] += (p[0] === Math.floor(p[0]) ? -seamPad : seamPad);
            if (!ay) p[1] += (p[1] === Math.floor(p[1]) ? -seamPad : seamPad);
            if (!az) p[2] += (p[2] === Math.floor(p[2]) ? -seamPad : seamPad);
            // clamp
            p[0] = Math.max(0, Math.min(size, p[0]));
            p[1] = Math.max(0, Math.min(size, p[1]));
            p[2] = Math.max(0, Math.min(size, p[2]));
            return p;
          };

          p0 = pad(p0); p1 = pad(p1); p2 = pad(p2); p3 = pad(p3);
        }

        const pushV = (p) => {
          vertices.push(
            p[0] / size, p[1] / size, p[2] / size,
            n[0], n[1], n[2],
            c[0], c[1], c[2]
          );
        };

        pushV(p0); pushV(p1); pushV(p2); pushV(p3);
        indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
        index += 4;
      };

      for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (!get(x, y, z)) continue;

            // +X
            if (!get(x + 1, y, z)) {
              const n = [1, 0, 0];
              const c = colorFn(x + 1, y + 0.5, z + 0.5, n);
              pushQuad([x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1], n, c);
            }
            // -X
            if (!get(x - 1, y, z)) {
              const n = [-1, 0, 0];
              const c = colorFn(x, y + 0.5, z + 0.5, n);
              pushQuad([x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z], [x, y, z], n, c);
            }

            // +Y
            if (!get(x, y + 1, z)) {
              const n = [0, 1, 0];
              const c = colorFn(x + 0.5, y + 1, z + 0.5, n);
              pushQuad([x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1], n, c);
            }
            // -Y
            if (!get(x, y - 1, z)) {
              const n = [0, -1, 0];
              const c = colorFn(x + 0.5, y, z + 0.5, n);
              pushQuad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z], n, c);
            }

            // +Z (top)
            if (!get(x, y, z + 1)) {
              const n = [0, 0, 1];
              const c = colorFn(x + 0.5, y + 0.5, z + 1, n);
              pushQuad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1], n, c);
            }
            // -Z (bottom)
            if (!get(x, y, z - 1)) {
              const n = [0, 0, -1];
              const c = colorFn(x + 0.5, y + 0.5, z, n);
              pushQuad([x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z], [x, y, z], n, c);
            }
          }
        }
      }

      return { vertices, indices };
    },

    greedyMesh(voxels, size, colorFn) {
      const vertices = [];
      const indices = [];
      let index = 0;
      const dims = [size, size, size];
      const get = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0;
        return voxels[x + y * size + z * size * size];
      };
      const defaultColor = Array.isArray(colorFn) ? colorFn : [1, 1, 1];
      for (let d = 0; d < 3; d++) {
        const u = (d + 1) % 3;
        const v = (d + 2) % 3;
        const q = [0, 0, 0];
        q[d] = 1;
        const mask = new Int8Array(dims[u] * dims[v]);
        const x = [0, 0, 0];
        for (x[d] = 0; x[d] <= dims[d]; x[d]++) {
          let n = 0;
          for (x[v] = 0; x[v] < dims[v]; x[v]++) {
            for (x[u] = 0; x[u] < dims[u]; x[u]++) {
              const a = (x[d] < dims[d]) ? get(x[0], x[1], x[2]) : 0;
              const b = (x[d] > 0) ? get(x[0] - q[0], x[1] - q[1], x[2] - q[2]) : 0;
              mask[n++] = a ? (b ? 0 : 1) : (b ? -1 : 0);
            }
          }
          n = 0;
          for (let j = 0; j < dims[v]; j++) {
            for (let i = 0; i < dims[u];) {
              const c = mask[n];
              if (!c) {
                i++;
                n++;
                continue;
              }
              let w = 1;
              while (i + w < dims[u] && mask[n + w] === c) w++;
              let h = 1;
              while (j + h < dims[v]) {
                let k = 0;
                while (k < w && mask[n + k + h * dims[u]] === c) k++;
                if (k < w) break;
                h++;
              }
              const x0 = [0, 0, 0];
              x0[u] = i;
              x0[v] = j;
              x0[d] = x[d];
              const du = [0, 0, 0];
              du[u] = w;
              const dv = [0, 0, 0];
              dv[v] = h;
              const normal = [0, 0, 0];
              normal[d] = c > 0 ? -1 : 1;
              if (c < 0) {
                x0[d] -= 1;
              }
              const cx = x0[0] + (du[0] + dv[0]) * 0.5;
              const cy = x0[1] + (du[1] + dv[1]) * 0.5;
              const cz = x0[2] + (du[2] + dv[2]) * 0.5;
              const faceColor = (typeof colorFn === 'function')
                ? colorFn(cx, cy, cz, normal)
                : defaultColor;
              const pushVert = (vx, vy, vz) => {
                vertices.push(
                  vx / size, vy / size, vz / size,
                  normal[0], normal[1], normal[2],
                  faceColor[0], faceColor[1], faceColor[2]
                );
              };
              pushVert(x0[0], x0[1], x0[2]);
              pushVert(x0[0] + du[0], x0[1] + du[1], x0[2] + du[2]);
              pushVert(x0[0] + du[0] + dv[0], x0[1] + du[1] + dv[1], x0[2] + du[2] + dv[2]);
              pushVert(x0[0] + dv[0], x0[1] + dv[1], x0[2] + dv[2]);
              indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
              index += 4;
              for (let y = 0; y < h; y++) {
                for (let xw = 0; xw < w; xw++) {
                  mask[n + xw + y * dims[u]] = 0;
                }
              }
              i += w;
              n += w;
            }
          }
        }
      }
      return { vertices, indices };
    },


    applyCylindricalNormals(mesh, opts) {
      if (!mesh || !mesh.vertices || mesh.vertices.length < 9) return;
      const verts = mesh.vertices;
      const strength = opts && Number.isFinite(opts.strength) ? opts.strength : 0.88;
      for (let i = 0; i < verts.length; i += 9) {
        const px = verts[i + 0];
        const py = verts[i + 1];
        const pz = verts[i + 2];
        const nx = verts[i + 3];
        const ny = verts[i + 4];
        const nz = verts[i + 5];

        // Only adjust side faces (avoid wrecking top/bottom lighting)
        if (Math.abs(nz) > 0.5) continue;

        const dx = px - 0.5;
        const dy = py - 0.5;
        const r2 = dx * dx + dy * dy;
        if (r2 < 1e-5) continue;

        const invR = 1.0 / Math.sqrt(r2);
        const rx = dx * invR;
        const ry = dy * invR;

        // Blend original axis normal toward a radial (cylindrical) normal
        let mx = nx * (1.0 - strength) + rx * strength;
        let my = ny * (1.0 - strength) + ry * strength;
        let mz = nz * (1.0 - strength); // keep near 0 for sides

        const mlen = Math.sqrt(mx * mx + my * my + mz * mz);
        if (mlen > 1e-6) {
          mx /= mlen; my /= mlen; mz /= mlen;
          verts[i + 3] = mx;
          verts[i + 4] = my;
          verts[i + 5] = mz;
        }
      }
    },

    getVoxelMesh(tileName, dungeon) {
      if (!dungeon || !dungeon.tiles || !tileName) return null;

      const hasSpec = !!dungeon.tiles[tileName]?.spriteSpec;
      if (!(hasSpec || tileName === 'pillar' || tileName.startsWith('custom_'))) return null;

      // IMPORTANT: voxel meshes are cached; rebuild when debug flags / revisions change.
      const debugSolid = (tileName === 'pillar' && !!window.DEBUG_SOLID_PILLAR);
      const meshRev = Number.isFinite(window.VOXEL_MESH_REV) ? window.VOXEL_MESH_REV : 0;
      const debugKey = `${meshRev}|solid:${debugSolid ? 1 : 0}`;

      const cached = this.voxelMeshes[tileName];
      if (cached && cached._debugKey === debugKey) return cached;

      // If debug key changed, drop the old cached mesh so we actually rebuild it.
      if (cached) delete this.voxelMeshes[tileName];

      const spec = dungeon.tiles[tileName]?.spriteSpec || {};
      const detail = spec.detail || {};
      const tileMeta = this.getCustomTileMeta(tileName, dungeon);
      const material = tileMeta?.procedure?.material || spec.material || null;
      const palette = dungeon.visualStyle?.palette || {};
      const matPalette = this.getMaterialPalette(material, palette);

      const hexToRgb = (hex) => {
        const m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/);
        if (!m) return [0.45, 0.45, 0.45];
        const v = parseInt(m[1], 16);
        return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
      };
      const mix = (a, b, t) => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
      ];
      const clampRange = (v, min, max, fallback) => {
        const n = Number.isFinite(v) ? v : fallback;
        return Math.max(min, Math.min(max, n));
      };
      const hash = (x, y, z) => {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return n - Math.floor(n);
      };

      const primary = hexToRgb(matPalette.primary || '#777777');
      const secondary = hexToRgb(matPalette.secondary || '#555555');
      const highlight = hexToRgb(matPalette.highlight || '#aaaaaa');
      const shadow = hexToRgb(matPalette.shadow || '#222222');
      const accentColor = detail.accentColor ? hexToRgb(detail.accentColor) : highlight;
      const accentStrength = clampRange(detail.accentStrength, 0, 1, detail.accentColor ? 0.3 : 0);
      const bandCount = Math.max(0, Math.round(clampRange(detail.bandCount, 0, 8, 0)));
      const wear = clampRange(detail.wear, 0, 1, 0.25);
      const chips = clampRange(detail.chips, 0, 1, 0.2);
      const cracks = clampRange(detail.cracks, 0, 1, 0.2);
      const noise = clampRange(detail.noise, 0, 1, 0.3);
      const skin = String(detail.skin || '').toLowerCase();
      const skinStrength = clampRange(detail.skinStrength, 0, 1, skin ? 0.35 : 0);

      const tileNameLower = String(tileName || '').toLowerCase();
      const metaTypeLower = tileMeta?.type ? String(tileMeta.type).toLowerCase() : '';
      const isColumn =
        tileName === 'pillar' ||
        tileNameLower.includes('pillar') ||
        tileNameLower.includes('column') ||
        metaTypeLower.includes('pillar') ||
        metaTypeLower.includes('column');

      // Columns look terrible with per-voxel speckle — tame it.
      let useNoise = noise;
      let useChips = chips;
      let useCracks = cracks;
      let useSkinStrength = skinStrength;

      if (isColumn) {
        useNoise = noise * 0.06;      // keep a *hint* of variation, not checkerboard
        useChips = 0.0;               // chips at voxel scale read like holes/tiles
        useCracks = 0.0;              // same deal
        useSkinStrength = 0.0;        // skins often create grid/patch patterns
      }

      const heightRatio = typeof spec.heightRatio === 'number' ? spec.heightRatio : 1.0;
      const height = Math.min(16, Math.max(2, Math.floor(16 * heightRatio)));
      const grooveCount = Math.max(0, Math.round(clampRange(detail.grooveCount, 0, 12, 6)));
      let grooveStrength = clampRange(detail.grooveDepth, 0, 1, 0.2) * 0.45;

      // Pillars/columns: grooves should read as carving, not voids.
      if (isColumn) {
        grooveStrength *= 0.18;
      }

      const baseFrac = clampRange(detail.baseHeight, 0, 0.3, 0.18);
      const capFrac = clampRange(detail.capHeight, 0, 0.3, 0.12);

      const colorFn = (x, y, z, normal) => {
        // Debug: prove the "slits" are lighting, not holes (shader will optionally bypass lighting too)
        if (debugSolid) return [1.0, 0.0, 1.0];

      const n = isColumn
        ? hash(0.0, 0.0, Math.floor(z / 2))     // vertical-only variation (no checkerboard)
        : hash(x * 1.7, y * 2.1, z * 3.3);

      let c = mix(primary, secondary, useNoise * n);

        if (bandCount > 0) {
          const band = Math.floor((z / Math.max(1, height)) * bandCount);
          if (band % 2 === 0) c = mix(c, accentColor, accentStrength);
        }

        if (grooveCount > 0) {
          const zFrac = z / Math.max(1, height);
          if (zFrac >= baseFrac && zFrac <= (1.0 - capFrac)) {
            const dx = x - 8;
            const dy = y - 8;
            const angle = Math.atan2(dy, dx);
            const groove = 0.5 + 0.5 * Math.sin(angle * grooveCount);
            c = mix(c, shadow, grooveStrength * groove);
          }
        }

        const carving = String(detail.carving || '').toLowerCase();
        if (carving) {
          let carveMask = 0.0;
          if (carving.includes('chevron')) {
            const t = Math.abs(((x + y) / 3) % 2 - 1);
            carveMask = t < 0.35 ? 1.0 : 0.0;
          } else if (carving.includes('spiral')) {
            const dx = x - 8;
            const dy = y - 8;
            const angle = Math.atan2(dy, dx);
            const radius = Math.sqrt(dx * dx + dy * dy);
            const t = Math.abs(Math.sin(angle * 2.0 + radius * 0.7));
            carveMask = t > 0.7 ? 1.0 : 0.0;
          } else if (carving.includes('rune') || carving.includes('glyph')) {
            carveMask = hash(x * 9.7, y * 6.1, z * 3.3) > 0.82 ? 1.0 : 0.0;
          } else if (carving.includes('vines')) {
            const t = Math.abs(Math.sin((x * 0.6) + (z * 0.35)));
            carveMask = t > 0.8 ? 1.0 : 0.0;
          }
          if (carveMask > 0.0) {
            c = mix(c, accentColor, Math.max(accentStrength, 0.35));
          }
        }

        if (skin && useSkinStrength > 0) {
          let skinMask = 0.0;
          if (skin.includes('mosaic') || skin.includes('tile')) {
            skinMask = ((Math.floor(x / 2) + Math.floor(y / 2) + Math.floor(z / 2)) % 2) ? 1.0 : 0.0;
          } else if (skin.includes('zigzag') || skin.includes('chevron')) {
            const t = Math.abs(((x * 0.5 + z * 0.35) % 2) - 1);
            skinMask = t < 0.35 ? 1.0 : 0.0;
          } else if (skin.includes('circuit')) {
            skinMask = (hash(x * 5.7, y * 2.3, z * 1.9) > 0.8) ? 1.0 : 0.0;
          } else if (skin.includes('marble')) {
            skinMask = Math.abs(Math.sin((x + y) * 0.6 + z * 0.4)) > 0.7 ? 1.0 : 0.0;
          } else if (skin.includes('plaid') || skin.includes('grid')) {
            skinMask = (x % 3 === 0 || y % 3 === 0) ? 1.0 : 0.0;
          } else if (skin.includes('band')) {
            skinMask = (Math.floor((z / Math.max(1, height)) * 6) % 2) ? 1.0 : 0.0;
          }
          if (skinMask > 0.0) c = mix(c, highlight, useSkinStrength);
        }

        if (cracks > 0 && hash(x * 7.1, y * 11.3, z * 13.7) < useCracks * 0.15) {
          c = mix(c, shadow, 0.7);
        }
        if (chips > 0 && hash(x * 9.2, y * 5.7, z * 4.1) < useChips * 0.1) {
          c = mix(c, highlight, 0.6);
        }

        // Mild material response by face orientation
        if (normal[2] > 0.5) {
          c = mix(c, highlight, wear * 0.4);
        } else if (normal[2] < -0.5) {
          c = mix(c, shadow, 0.25);
        } else if (normal[0] != 0.0 || normal[1] != 0.0) {
          c = mix(c, secondary, 0.08);
        }

        return c;
      };

      const voxels = this.buildVoxelGrid(tileName, dungeon, 16);

      if (window.DEBUG_VOXEL_SOLID) {
        this._voxelDebugged = this._voxelDebugged || {};
        if (!this._voxelDebugged[tileName]) {
          this._voxelDebugged[tileName] = true;
          try {
            let holeCount = 0;
            let minFill = 1;
            let maxFill = 0;
            let totalFill = 0;
            let slicesWithHoles = 0;
            for (let z = 0; z < 16; z++) {
              let filled = 0;
              let minX = -1;
              let maxX = -1;
              let minY = -1;
              let maxY = -1;
              for (let y = 0; y < 16; y++) {
                for (let x = 0; x < 16; x++) {
                  const v = voxels[x + y * 16 + z * 16 * 16];
                  if (!v) continue;
                  filled++;
                  if (minX === -1 || x < minX) minX = x;
                  if (maxX === -1 || x > maxX) maxX = x;
                  if (minY === -1 || y < minY) minY = y;
                  if (maxY === -1 || y > maxY) maxY = y;
                }
              }
              const fillRatio = filled / (16 * 16);
              minFill = Math.min(minFill, fillRatio);
              maxFill = Math.max(maxFill, fillRatio);
              totalFill += fillRatio;

              if (minX >= 0 && maxX >= 0 && minY >= 0 && maxY >= 0) {
                let maxR2 = 0;
                for (let y = minY; y <= maxY; y++) {
                  for (let x = minX; x <= maxX; x++) {
                    if (!voxels[x + y * 16 + z * 16 * 16]) continue;
                    const dx = x - 7.5;
                    const dy = y - 7.5;
                    const r2 = dx * dx + dy * dy;
                    if (r2 > maxR2) maxR2 = r2;
                  }
                }
                const insideR2 = maxR2 + 0.75;

                let sliceHoles = 0;
                for (let y = minY; y <= maxY; y++) {
                  for (let x = minX; x <= maxX; x++) {
                    const dx = x - 7.5;
                    const dy = y - 7.5;
                    if (dx * dx + dy * dy > insideR2) continue;
                    if (voxels[x + y * 16 + z * 16 * 16]) continue;
                    sliceHoles++;
                  }
                }

                if (sliceHoles > 0) {
                  slicesWithHoles++;
                  holeCount += sliceHoles;
                }
              }
            }

            console.log('[VoxelDebug]', {
              tileName,
              size: 16,
              minFill: Number(minFill.toFixed(3)),
              maxFill: Number(maxFill.toFixed(3)),
              avgFill: Number((totalFill / 16).toFixed(3)),
              slicesWithHoles,
              holeCount
            });
          } catch (err) {
            console.warn('[VoxelDebug] detailed stats failed', err);
          }
        }
        if (typeof window.debugVoxel === 'function') {
          window.debugVoxel(tileName, voxels, 16);
        }
      }

      const isColumnLike = isColumn;

      const gl = this.gl;
      const createGpuMesh = (mesh, hints) => {
        const vbo = gl.createBuffer();
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
        return {
          vbo,
          ibo,
          count: mesh.indices.length,
          toneShadow: shadow,
          toneMid: primary,
          toneHighlight: highlight,
          unlit: hints && Number.isFinite(hints.unlit) ? hints.unlit : 0,
          toonSteps: hints && Number.isFinite(hints.toonSteps) ? hints.toonSteps : 3,
          depthOnly: !!(hints && hints.depthOnly),
          depthTestOnly: !!(hints && hints.depthTestOnly),
          depthBias: hints && Number.isFinite(hints.depthBias) ? hints.depthBias : 0.0
        };
      };

      let record;
      if (isColumnLike) {
        const solidColor = mix(primary, secondary, 0.25);
        const solidColorFn = () => solidColor;
        const solidMesh = this.meshVoxelsSimple(voxels, 16, solidColorFn, { seamPad: 0.08 });
        const detailMesh = this.greedyMesh(voxels, 16, colorFn, { seamPad });

        // Critical fix: smooth normals on cylindrical shapes so voxel steps don't read as "see-through slits".
        this.applyCylindricalNormals(solidMesh, { strength: 0.92 });
        this.applyCylindricalNormals(detailMesh, { strength: 0.92 });

        record = {
          passes: [
            // Pass 1: depth-only seal for occlusion and solidity.
            createGpuMesh(solidMesh, { unlit: 1, toonSteps: 3, depthOnly: true }),
            // Pass 2: base color fill (no depth writes).
            createGpuMesh(solidMesh, { unlit: 0, toonSteps: 3, depthTestOnly: true }),
            // Pass 3: detail lighting on top (no depth writes).
            createGpuMesh(detailMesh, { unlit: debugSolid ? 1 : 0, toonSteps: 3, depthTestOnly: true, depthBias: -0.0006 })
          ],
          _debugKey: debugKey
        };
      } else {
        const mesh = this.greedyMesh(voxels, 16, colorFn, { seamPad });
        const gpu = createGpuMesh(mesh, {
          unlit: debugSolid ? 1 : 0,
          toonSteps: 3
        });
        record = {
          ...gpu,
          _debugKey: debugKey
        };
      }

      this.voxelMeshes[tileName] = record;
      return record;
    },

    getBottomPadRatio(img) {
      if (!img || !isTextureReady(img)) return 0;
      const key = img.src || `${img.naturalWidth}x${img.naturalHeight}`;
      if (this.customPadCache[key] !== undefined) return this.customPadCache[key];
      let ratio = 0;
      try {
        const temp = document.createElement('canvas');
        temp.width = img.naturalWidth;
        temp.height = img.naturalHeight;
        const tctx = temp.getContext('2d');
        tctx.drawImage(img, 0, 0);
        const data = tctx.getImageData(0, 0, temp.width, temp.height).data;
        const w = temp.width;
        const h = temp.height;
        if (h <= 0) return 0;
        let bottomOpaqueY = -1;
        for (let y = h - 1; y >= 0; y--) {
          let opaque = false;
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 10) {
              opaque = true;
              break;
            }
          }
          if (opaque) {
            bottomOpaqueY = y;
            break;
          }
        }
        const padRows = (bottomOpaqueY >= 0) ? h - bottomOpaqueY - 1 : h;
        ratio = padRows / h;
      } catch (e) {
        console.warn('Error computing pad ratio', e);
      }
      this.customPadCache[key] = ratio;
      return ratio;
    },

    init(container) {
      if (!container) return false;
      const displayW = 640;
      const displayH = 480;
      const pixelScale = 4;
      const lowResW = Math.max(1, Math.floor(displayW / pixelScale));
      const lowResH = Math.max(1, Math.floor(displayH / pixelScale));
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = lowResW;
        this.canvas.height = lowResH;
        this.canvas.style.width = `${displayW}px`;
        this.canvas.style.height = `${displayH}px`;
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.imageRendering = 'crisp-edges';
        container.innerHTML = '';
        container.appendChild(this.canvas);
      }

      const gl = this.canvas.getContext('webgl2', { alpha: false, depth: true });
      if (!gl) {
        console.warn('WebGL2 not available, falling back to canvas renderer.');
        return false;
      }
      this.gl = gl;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const vsSource = [
        '#version 300 es',
        'in vec2 a_pos;',
        'out vec2 v_uv;',
        'void main() {',
        '  v_uv = (a_pos + 1.0) * 0.5;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      const fsSource = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform vec2 u_camPos;
uniform vec2 u_camDir;
uniform vec2 u_plane;
uniform float u_focalLength;
uniform float u_eyeZ;
uniform float u_playerFloor;
uniform sampler2D u_cells;
uniform sampler2D u_wallAtlas;
uniform sampler2D u_floorTex;
uniform ivec2 u_gridSize;
uniform ivec2 u_playerTile;
uniform int u_skipBackCell;
uniform int u_flipY;
uniform float u_heightMin;
uniform float u_heightRange;
uniform float u_minFloor;
uniform float u_wallUScale;
uniform vec2 u_lightDir;
uniform float u_lightIntensity;
uniform int u_maxSteps;
uniform int u_atlasCols;
uniform int u_atlasRows;
uniform vec3 u_skyTop;
uniform vec3 u_skyBot;
uniform float u_depthFar;
uniform float u_depthFarDepth;
uniform float u_shadowStrength;
uniform int u_torchCount;
uniform vec3 u_torchPos[${MAX_TORCH_LIGHTS}];
uniform float u_torchRadius[${MAX_TORCH_LIGHTS}];
uniform float u_torchIntensity[${MAX_TORCH_LIGHTS}];

const int MAX_STEPS = 400;
const int MAX_TORCH = ${MAX_TORCH_LIGHTS};
const float TORCH_FALLOFF = 0.45;
const vec3 TORCH_COLOR = vec3(1.0, 190.0 / 255.0, 130.0 / 255.0);
// Per-surface torch tuning knobs (1.0 = default).
const float TORCH_WALL_BOOST = 1.3;
const float TORCH_SIDE_BOOST = 1.1;
const float TORCH_FLOOR_BOOST = 1.4;
const float TORCH_LIGHT_SCALE = 0.7;
const float TORCH_ONLY = 0.0;
const int SHADOW_TORCH_LIMIT = MAX_TORCH;
const int SHADOW_DDA_STEPS = 96;
const float OBSTACLE_SHADOW_RADIUS = 0.35;
const float OBSTACLE_SHADOW_SOFT = 0.22;
const float OBSTACLE_SHADOW_SPREAD = 0.12;
const float SHADOW_DARKEN = 0.75;
const float SHADOW_RADIUS_SCALE = 1.6;
const float STEP_SHADOW_EPS = 0.05;
const float TORCH_SHADOW_MIX = 0.7;

vec4 fetchCell(int x, int y) {
  int yy = u_flipY == 1 ? (u_gridSize.y - 1 - y) : y;
  if (x < 0 || yy < 0 || x >= u_gridSize.x || yy >= u_gridSize.y) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }
  return texelFetch(u_cells, ivec2(x, yy), 0);
}

bool inBounds(int x, int y) {
  return x >= 0 && y >= 0 && x < u_gridSize.x && y < u_gridSize.y;
}

bool isObstacleCell(vec4 cell) {
  return cell.a > 0.001 && cell.a < 0.999;
}

bool isCasterCell(vec4 cell) {
  return cell.a > 0.001;
}

float casterRadiusFromCell(vec4 cell) {
  return (cell.a >= 0.999) ? 0.5 : max(0.12, cell.a);
}

float floorHeightFromCell(vec4 cell) {
  return u_heightMin + cell.g * 255.0 * (u_heightRange / 255.0);
}

float shadowStrengthFromCaster(vec2 hitXY, vec2 casterCenter, float casterRadius, vec2 torchPos, float rad, float intensity) {
  vec2 toHit = hitXY - torchPos;
  float distHit = length(toHit);
  if (distHit < 0.05 || distHit > rad * 1.35) return 0.0;
  vec2 lightDir = normalize(casterCenter - torchPos);
  vec2 v = hitXY - casterCenter;
  float proj = dot(v, lightDir);
  if (proj <= 0.0) return 0.0;
  float len = clamp(rad * 1.1, 0.8, 12.0);
  float radius = casterRadius + proj * OBSTACLE_SHADOW_SPREAD;
  float perp = length(v - lightDir * proj);
  float core = smoothstep(radius, radius - OBSTACLE_SHADOW_SOFT, perp);
  float front = smoothstep(0.0, 0.12, proj);
  float back = 1.0 - smoothstep(len * 0.85, len, proj);
  float strength = core * front * back * intensity;
  return strength;
}

float shadowStrengthFromWallSlab(
  vec2 hitXY,
  vec2 casterCenter,
  vec2 torchPos,
  float rad,
  float intensity,
  vec2 faceNormal,
  bool infiniteAlongFace
) {
  vec2 toHit = hitXY - torchPos;
  float distHit = length(toHit);
  if (distHit < 0.05 || distHit > rad * 1.35) return 0.0;
  vec2 dir = toHit / max(distHit, 1e-4);

  vec2 toCaster = casterCenter - torchPos;
  bool useX;
  float faceSignX = 0.0;
  float faceSignY = 0.0;
  if (abs(faceNormal.x) > 0.5 || abs(faceNormal.y) > 0.5) {
    useX = abs(faceNormal.x) > 0.5;
    faceSignX = (faceNormal.x >= 0.0) ? 1.0 : -1.0;
    faceSignY = (faceNormal.y >= 0.0) ? 1.0 : -1.0;
  } else {
    useX = abs(toCaster.x) >= abs(toCaster.y);
    faceSignX = (toCaster.x >= 0.0) ? -1.0 : 1.0;
    faceSignY = (toCaster.y >= 0.0) ? -1.0 : 1.0;
  }
  float tPlane = 0.0;
  float perpDist = 0.0;

  if (useX) {
    float faceX = casterCenter.x + 0.5 * faceSignX;
    if (abs(dir.x) < 1e-4) return 0.0;
    tPlane = (faceX - torchPos.x) / dir.x;
    if (tPlane <= 0.0 || tPlane >= distHit) return 0.0;
    if (infiniteAlongFace) {
      perpDist = 0.0;
    } else {
      float hitY = hitXY.y;
      float clampedY = clamp(hitY, casterCenter.y - 0.5, casterCenter.y + 0.5);
      perpDist = abs(hitY - clampedY);
    }
  } else {
    float faceY = casterCenter.y + 0.5 * faceSignY;
    if (abs(dir.y) < 1e-4) return 0.0;
    tPlane = (faceY - torchPos.y) / dir.y;
    if (tPlane <= 0.0 || tPlane >= distHit) return 0.0;
    if (infiniteAlongFace) {
      perpDist = 0.0;
    } else {
      float hitX = hitXY.x;
      float clampedX = clamp(hitX, casterCenter.x - 0.5, casterCenter.x + 0.5);
      perpDist = abs(hitX - clampedX);
    }
  }

  float proj = distHit - tPlane;
  float len = clamp(rad * 1.35, 1.2, 12.0);
  float halfWidth = 0.5;
  float spread = halfWidth / max(tPlane, 0.2);
  float radius = halfWidth + proj * spread;
  radius = min(radius, halfWidth + rad);
  float soft = max(0.14, OBSTACLE_SHADOW_SOFT * 1.1);
  float core = smoothstep(radius, radius - soft, perpDist);
  float front = smoothstep(0.0, 0.18, proj);
  float back = 1.0 - smoothstep(len * 0.85, len, proj);
  float strength = core * front * back * intensity;
  return strength;
}

float computeShadowForTorch(
  vec2 hitXY,
  int targetX,
  int targetY,
  vec2 surfaceNormal2D,
  vec2 torchPos,
  float rad,
  float intensity
) {
  float obstacleShadow = 0.0;
  vec4 targetCell = fetchCell(targetX, targetY);
  bool targetIsWall = targetCell.a >= 0.999;
  bool surfaceIsFloor = (abs(surfaceNormal2D.x) < 0.1 && abs(surfaceNormal2D.y) < 0.1);
  bool allowTargetCaster = surfaceIsFloor && isObstacleCell(targetCell);

  vec2 toHit = hitXY - torchPos;
  float distHit = length(toHit);
  float shadowRad = rad * SHADOW_RADIUS_SCALE;
  float maxShadow = shadowRad * 1.15;
  if (distHit < 0.05 || distHit > maxShadow) return obstacleShadow;
  float distFade = 1.0 - smoothstep(shadowRad * 0.85, maxShadow, distHit);

  vec2 dir = toHit / max(distHit, 1e-4);

  vec2 casterCenter = vec2(0.0);
  float casterRadius = 0.0;
  vec2 casterFaceNormal = vec2(0.0);
  bool casterIsWall = false;
  bool casterIsTarget = false;
  bool foundCaster = false;

  int mapX = int(floor(torchPos.x));
  int mapY = int(floor(torchPos.y));
  int torchCellX = mapX;
  int torchCellY = mapY;
  int endX = int(floor(hitXY.x));
  int endY = int(floor(hitXY.y));
  float invDx = abs(dir.x) < 1e-4 ? 1e4 : abs(1.0 / dir.x);
  float invDy = abs(dir.y) < 1e-4 ? 1e4 : abs(1.0 / dir.y);
  int stepX = dir.x < 0.0 ? -1 : 1;
  int stepY = dir.y < 0.0 ? -1 : 1;
  float sideDistX = (stepX == -1 ? (torchPos.x - float(mapX)) : (float(mapX + 1) - torchPos.x)) * invDx;
  float sideDistY = (stepY == -1 ? (torchPos.y - float(mapY)) : (float(mapY + 1) - torchPos.y)) * invDy;

  for (int s = 0; s < SHADOW_DDA_STEPS; s++) {
    float nextT = min(sideDistX, sideDistY);
    if (nextT >= distHit - 0.02) break;
    int prevX = mapX;
    int prevY = mapY;
    bool steppedX = (sideDistX < sideDistY);
    if (steppedX) {
      sideDistX += invDx;
      mapX += stepX;
    } else {
      sideDistY += invDy;
      mapY += stepY;
    }
    if (!inBounds(mapX, mapY)) break;
    vec4 prevCell = fetchCell(prevX, prevY);
    vec4 currCell = fetchCell(mapX, mapY);
    if (prevCell.a < 0.5 && currCell.a < 0.5) {
      float prevH = floorHeightFromCell(prevCell);
      float currH = floorHeightFromCell(currCell);
      float dh = currH - prevH;
      if (abs(dh) > STEP_SHADOW_EPS) {
        bool currHigher = dh > 0.0;
        casterCenter = currHigher
          ? vec2(float(mapX) + 0.5, float(mapY) + 0.5)
          : vec2(float(prevX) + 0.5, float(prevY) + 0.5);
        casterRadius = 0.5;
        casterIsWall = true;
        casterFaceNormal = steppedX
          ? vec2(currHigher ? -float(stepX) : float(stepX), 0.0)
          : vec2(0.0, currHigher ? -float(stepY) : float(stepY));
        foundCaster = true;
        break;
      }
    }
    bool isTargetCell = (mapX == targetX && mapY == targetY);
    if (isTargetCell && !allowTargetCaster) break;
    if (mapX == torchCellX && mapY == torchCellY) {
      if (mapX == endX && mapY == endY) break;
      continue;
    }
    vec4 sCell = currCell;
    if (isCasterCell(sCell)) {
      casterCenter = vec2(float(mapX) + 0.5, float(mapY) + 0.5);
      casterRadius = casterRadiusFromCell(sCell);
      casterIsWall = sCell.a >= 0.999;
      casterIsTarget = isTargetCell;
      if (!casterIsWall) {
        vec2 toCenter = casterCenter - torchPos;
        float proj = dot(toCenter, dir);
        float perp = length(toCenter - dir * proj);
        if (perp > casterRadius + 0.05) {
          if (mapX == endX && mapY == endY) break;
          continue;
        }
      }
      casterFaceNormal = steppedX ? vec2(-float(stepX), 0.0) : vec2(0.0, -float(stepY));
      foundCaster = true;
      break;
    }
    if (isTargetCell) break;
    if (mapX == endX && mapY == endY) break;
  }

  if (!foundCaster && allowTargetCaster) {
    vec2 center = vec2(float(targetX) + 0.5, float(targetY) + 0.5);
    float targetRadius = casterRadiusFromCell(targetCell);
    vec2 toCenter = center - torchPos;
    float proj = dot(toCenter, dir);
    float perp = length(toCenter - dir * proj);
    float distCenter = length(toCenter);
    if (proj > 0.0 && distCenter < distHit + 0.02 && perp <= targetRadius + 0.05) {
      float strength = shadowStrengthFromCaster(hitXY, center, targetRadius, torchPos, shadowRad, intensity) * distFade;
      obstacleShadow = max(obstacleShadow, strength);
    }
  }

  if (!foundCaster) return obstacleShadow;
  float distCaster = length(casterCenter - torchPos);
  if (!casterIsTarget && distCaster >= distHit - 0.02) return obstacleShadow;
  if (casterIsWall) {
    float torchCasterDist = length(casterCenter - torchPos);
    if (torchCasterDist < 0.9) {
      return obstacleShadow;
    }
    if (targetIsWall && (abs(surfaceNormal2D.x) > 0.5 || abs(surfaceNormal2D.y) > 0.5)) {
      if (abs(surfaceNormal2D.x) > 0.5 && mapX == targetX) return obstacleShadow;
      if (abs(surfaceNormal2D.y) > 0.5 && mapY == targetY) return obstacleShadow;
    }
    float slabStrength = shadowStrengthFromWallSlab(
      hitXY,
      casterCenter,
      torchPos,
      shadowRad,
      intensity,
      casterFaceNormal,
      surfaceIsFloor
    ) * distFade;
    obstacleShadow = max(obstacleShadow, slabStrength);
    return obstacleShadow;
  }
  float strength = shadowStrengthFromCaster(hitXY, casterCenter, casterRadius, torchPos, shadowRad, intensity) * distFade;
  obstacleShadow = max(obstacleShadow, strength);
  return obstacleShadow;
}

// Normal-aware torch lighting (half-Lambert + ambient fill for multi-light look)
float accumulateTorchLit(
  vec3 worldPos,
  vec3 normal,
  int targetX,
  int targetY,
  vec2 surfaceNormal2D,
  out float shadowBlend,
  out vec2 primaryDir2D,
  out float primaryStrengthOut
) {
  float total = 0.0;
  shadowBlend = 0.0;
  float primaryStrength = -1.0;
  float primaryShadow = 0.0;
  float shadowStack = 1.0;
  float sumStrength = 0.0;
  vec2 dirSum2D = vec2(0.0);
  const float TORCH_AMBIENT = 0.5;
  primaryDir2D = vec2(0.0);
  primaryStrengthOut = 0.0;
  for (int i = 0; i < MAX_TORCH; i++) {
    if (i >= u_torchCount) break;
    vec3 toL = u_torchPos[i] - worldPos;
    toL.z *= 0.5;
    float dist = length(toL);
    if (dist >= u_torchRadius[i]) continue;
    vec3 L = normalize(toL);
    float ndotl_raw = dot(L, normal);
    if (ndotl_raw <= 0.0) continue;      // prevent torch light wrapping around backfaces
    float ndotl = ndotl_raw * 0.5 + 0.5; // half-Lambert
    float falloff = 1.0 - dist / u_torchRadius[i];
    float shadowFactor = computeShadowForTorch(worldPos.xy, targetX, targetY, surfaceNormal2D, u_torchPos[i].xy, u_torchRadius[i], u_torchIntensity[i]);
    float shadowMul = (shadowFactor > 0.98)
      ? 0.0
      : (1.0 - clamp(shadowFactor * SHADOW_DARKEN, 0.0, SHADOW_DARKEN));
    float rawStrength = falloff * falloff * u_torchIntensity[i];
    float atten = rawStrength * TORCH_FALLOFF * shadowMul;
    if (rawStrength > primaryStrength) {
      primaryStrength = rawStrength;
      primaryShadow = shadowFactor;
    }
    shadowStack *= (1.0 - shadowFactor);
    sumStrength += rawStrength;
    vec2 dir2d = u_torchPos[i].xy - worldPos.xy;
    float dirLen = length(dir2d);
    if (dirLen > 1e-4) {
      dirSum2D += (dir2d / dirLen) * rawStrength;
    }
    total += (TORCH_AMBIENT + ndotl * (1.0 - TORCH_AMBIENT)) * atten;
  }
  float combinedShadow = 1.0 - shadowStack;
  shadowBlend = max(primaryShadow, combinedShadow);
  if (sumStrength > 1e-4) {
    float dirLen = length(dirSum2D);
    primaryDir2D = (dirLen > 1e-4) ? (dirSum2D / dirLen) : normalize(u_lightDir);
    primaryStrengthOut = sumStrength;
  } else {
    primaryDir2D = normalize(u_lightDir);
    primaryStrengthOut = 0.0;
  }
  return total;
}

void main() {
  vec2 frag = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
  float cameraX = 2.0 * frag.x / u_resolution.x - 1.0;
  vec2 rayDir = u_camDir + u_plane * cameraX;

  if (abs(rayDir.x) < 1e-5 && abs(rayDir.y) < 1e-5) {
    outColor = vec4(0.0);
    return;
  }

  float horizon = u_resolution.y * 0.5;

  // Ray setup
  int mapX = int(floor(u_camPos.x));
  int mapY = int(floor(u_camPos.y));
  float deltaDistX = abs(1.0 / rayDir.x);
  float deltaDistY = abs(1.0 / rayDir.y);
  int stepX = rayDir.x < 0.0 ? -1 : 1;
  int stepY = rayDir.y < 0.0 ? -1 : 1;
  float sideDistX = (stepX == -1 ? (u_camPos.x - float(mapX)) : (float(mapX + 1) - u_camPos.x)) * deltaDistX;
  float sideDistY = (stepY == -1 ? (u_camPos.y - float(mapY)) : (float(mapY + 1) - u_camPos.y)) * deltaDistY;
  int side = 0; // 0 = x-side hit, 1 = y-side hit

  if (u_skipBackCell == 1 && (mapX != u_playerTile.x || mapY != u_playerTile.y)) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }
  }

  // Track surfaces
  float wallDist = u_depthFar;
  vec4 wallCol = vec4(0.0);
  bool wallHit = false;
  float lineTop = horizon;
  float lineBottom = horizon;
  float extendedBottom = horizon;

  float sideDistClosest = u_depthFar;
  vec3 sideColClosest = vec3(0.0);
  bool sideHit = false;

  float floorDist = u_depthFar;
  float floorH = u_playerFloor;
  bool floorHit = false;

  // Main DDA for walls and side faces
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= u_maxSteps) break;

    float nextDist = min(sideDistX, sideDistY);
    int nextMapX = mapX + (sideDistX < sideDistY ? stepX : 0);
    int nextMapY = mapY + (sideDistX < sideDistY ? 0 : stepY);

    if (!inBounds(mapX, mapY) || !inBounds(nextMapX, nextMapY)) break;

    vec4 currCell = fetchCell(mapX, mapY);
    vec4 nextCell = fetchCell(nextMapX, nextMapY);

    // Side face rendering
    if (currCell.a < 0.5 && nextCell.a < 0.5) {
      float currH = u_heightMin + currCell.g * 255.0 * (u_heightRange / 255.0);
      float nextH = u_heightMin + nextCell.g * 255.0 * (u_heightRange / 255.0);
      float dh = nextH - currH;

      if (abs(dh) > 0.001) {
        float bottomZ = min(currH, nextH);
        float topZ = max(currH, nextH);

        float lineTopR = horizon - (topZ - u_eyeZ) * u_focalLength / nextDist;
        float lineBottomR = horizon - (bottomZ - u_eyeZ) * u_focalLength / nextDist;

        if (frag.y >= min(lineTopR, lineBottomR) && frag.y <= max(lineTopR, lineBottomR)) {
          float v_frac = (frag.y - lineTopR) / max(1.0, lineBottomR - lineTopR);
          float world_v = v_frac * abs(dh);
          float fracV = fract(bottomZ + world_v);
          float wallX = sideDistX < sideDistY ? (u_camPos.y + nextDist * rayDir.y) : (u_camPos.x + nextDist * rayDir.x);
          float fracU = fract(wallX);

          vec4 tex = texture(u_floorTex, vec2(fracU, fracV));

          vec3 normal = sideDistX < sideDistY
            ? vec3(-float(stepX), 0.0, 0.0)
            : vec3(0.0, -float(stepY), 0.0);
          vec2 normal2D = sideDistX < sideDistY
            ? vec2(-float(stepX), 0.0)
            : vec2(0.0, -float(stepY));

          vec3 worldPos = vec3(u_camPos + rayDir * nextDist, bottomZ + world_v);
          float shadowBlend = 0.0;
          vec2 primaryDir2D = vec2(0.0);
          float primaryStrength = 0.0;
          float lit = clamp(
            accumulateTorchLit(
              worldPos,
              normal,
              int(floor(worldPos.x)),
              int(floor(worldPos.y)),
              normal2D,
              shadowBlend,
              primaryDir2D,
              primaryStrength
            ),
            0.0,
            1.0
          );
          float litSide = clamp(lit * TORCH_SIDE_BOOST, 0.0, 1.5);

          float shadowFloor = mix(0.3, 0.12, u_shadowStrength);
          float shade = max(shadowFloor, 1.0 - nextDist / 10.0);
          if (TORCH_ONLY > 0.5) shade = 1.0;
          float torchLight = litSide * TORCH_LIGHT_SCALE;
          float base = shade;
          float warmShift = 0.75 + 0.45 * torchLight;
          vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;
          float keyShadow = clamp(shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
          float lightPresence = clamp(primaryStrength, 0.0, 1.0);
          float shadowFade = smoothstep(0.08, 0.45, torchLight);
          keyShadow *= (1.0 - lightPresence * 0.75);
          keyShadow *= (1.0 - shadowFade);
          float baseShadowMul = 1.0 - keyShadow;
          vec3 col = tex.rgb * base * baseShadowMul + tex.rgb * torchLight + torchAdd;

          if (nextDist < sideDistClosest) {
            sideDistClosest = nextDist;
            sideColClosest = col;
            sideHit = true;
          }
        }
      }
    }

    // Advance DDA
    bool steppedX = (sideDistX < sideDistY);
    if (steppedX) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }

    if (!inBounds(mapX, mapY)) break;

    vec4 cell = fetchCell(mapX, mapY);
    if (cell.a > 0.5) {
      // Wall hit
      float perpDist = (side == 0)
        ? (float(mapX) - u_camPos.x + float(1 - stepX) * 0.5) / rayDir.x
        : (float(mapY) - u_camPos.y + float(1 - stepY) * 0.5) / rayDir.y;
      if (perpDist < 0.001) perpDist = 0.001;

      float floorH = u_heightMin + cell.g * 255.0 * (u_heightRange / 255.0);
      float ceilH = u_heightMin + cell.b * 255.0 * (u_heightRange / 255.0);

      lineTop = horizon - (ceilH - u_eyeZ) * u_focalLength / perpDist;
      lineBottom = horizon - (floorH - u_eyeZ) * u_focalLength / perpDist;
      extendedBottom = horizon - ((u_minFloor - u_eyeZ) * u_focalLength / perpDist);
      extendedBottom = max(lineBottom, extendedBottom);

      float wallX = (side == 0)
        ? (u_camPos.y + perpDist * rayDir.y)
        : (u_camPos.x + perpDist * rayDir.x);
      wallX = fract(wallX);
      float u = fract(wallX * u_wallUScale);

      float globalV = (frag.y - lineTop) / max(1.0, extendedBottom - lineTop);

      float worldZ = u_eyeZ + (horizon - frag.y) * (perpDist / u_focalLength);

      int tileId = int(cell.r * 255.0 + 0.5);
      vec2 atlasUV = (vec2(float(tileId % u_atlasCols), float(tileId / u_atlasCols)) + vec2(u, globalV)) /
                     vec2(float(u_atlasCols), float(u_atlasRows));

      vec4 tex = texture(u_wallAtlas, atlasUV);
      if (tex.a > 0.04 && frag.y >= lineTop && frag.y <= extendedBottom) {
        float shadowFloor = mix(0.3, 0.12, u_shadowStrength);
        float shade = max(shadowFloor, 1.0 - perpDist / 10.0);
        if (TORCH_ONLY > 0.5) shade = 1.0;
        float sideFactor = (side == 0) ? 1.0 : 0.85;
        vec2 normal2D = (side == 0) ? vec2(float(stepX), 0.0) : vec2(0.0, float(stepY));
        float grad = max(0.35, 1.0 - 0.18 * globalV);

        vec3 wallNormalTorch = vec3(-normal2D, 0.0);

        float planeCoord;
        float t;
        if (side == 0) {
          planeCoord = float(mapX) + (stepX > 0 ? 0.0 : 1.0);
          t = (planeCoord - u_camPos.x) / rayDir.x;
        } else {
          planeCoord = float(mapY) + (stepY > 0 ? 0.0 : 1.0);
          t = (planeCoord - u_camPos.y) / rayDir.y;
        }
        vec2 hitXY = u_camPos + rayDir * t;
        vec3 exactWorldPos = vec3(hitXY, worldZ);

        // Use exact position directly (no offset needed anymore)
        float shadowBlend = 0.0;
        vec2 primaryDir2D = vec2(0.0);
        float primaryStrength = 0.0;
        float lit = clamp(
          accumulateTorchLit(
            exactWorldPos,
            wallNormalTorch,
            mapX,
            mapY,
            normal2D,
            shadowBlend,
            primaryDir2D,
            primaryStrength
          ),
          0.0,
          1.0
        );
        float litWall = clamp(lit * TORCH_WALL_BOOST, 0.0, 1.5);

        vec2 keyDir2D = (primaryStrength > 0.0001) ? primaryDir2D : normalize(u_lightDir);
        float dotLight = dot(normal2D, keyDir2D);
        float lightFactor = 0.6 + 0.4 * dotLight;
        float keyStrength = clamp(primaryStrength, 0.0, 1.0);
        float litShade = shade * sideFactor * (1.0 - u_lightIntensity + u_lightIntensity * lightFactor * max(0.2, keyStrength));
        if (TORCH_ONLY > 0.5) litShade = shade * sideFactor;
        float rowShade = litShade * grad;

        // rest unchanged
        float torchLight = litWall * TORCH_LIGHT_SCALE;
        float base = rowShade;
        float warmShift = 0.75 + 0.45 * torchLight;
        vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;

        float keyShadow = clamp(shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
        float lightPresence = clamp(primaryStrength, 0.0, 1.0);
        float shadowFade = smoothstep(0.08, 0.45, torchLight);
        keyShadow *= (1.0 - lightPresence * 0.75);
        keyShadow *= (1.0 - shadowFade);
        float baseShadowMul = 1.0 - keyShadow;
        vec3 finalCol = tex.rgb * base * baseShadowMul + tex.rgb * torchLight + torchAdd;

        wallCol = vec4(finalCol, tex.a);
        wallDist = perpDist;
        wallHit = true;
      }
      break;
    }
  }

  // Horizontal floor casting
  float tanV = (frag.y - horizon) / u_focalLength;
  if (tanV > 0.0) {
    int fMapX = int(floor(u_camPos.x));
    int fMapY = int(floor(u_camPos.y));
    float fSideDistX = (rayDir.x < 0.0 ? (u_camPos.x - float(fMapX)) : (float(fMapX + 1) - u_camPos.x)) * deltaDistX;
    float fSideDistY = (rayDir.y < 0.0 ? (u_camPos.y - float(fMapY)) : (float(fMapY + 1) - u_camPos.y)) * deltaDistY;
    float fCurrDist = 0.0;

    if (u_skipBackCell == 1 && (fMapX != u_playerTile.x || fMapY != u_playerTile.y)) {
      float firstNext = min(fSideDistX, fSideDistY);
      fCurrDist = firstNext;
      if (fSideDistX < fSideDistY) {
        fSideDistX += deltaDistX;
        fMapX += stepX;
      } else {
        fSideDistY += deltaDistY;
        fMapY += stepY;
      }
    }

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= u_maxSteps) break;
      float fNextDist = min(fSideDistX, fSideDistY);

      if (inBounds(fMapX, fMapY)) {
        vec4 fCell = fetchCell(fMapX, fMapY);
        if (fCell.a < 0.5) {
          float h = u_heightMin + fCell.g * 255.0 * (u_heightRange / 255.0);
          if (h < u_eyeZ) {
            float dPlane = (u_eyeZ - h) / tanV;
            if (dPlane >= fCurrDist && dPlane < fNextDist && dPlane < wallDist && (!sideHit || dPlane < sideDistClosest)) {
              floorDist = dPlane;
              floorH = h;
              floorHit = true;
              break;
            }
          }
        }
      }

      fCurrDist = fNextDist;
      if (fSideDistX < fSideDistY) {
        fSideDistX += deltaDistX;
        fMapX += stepX;
      } else {
        fSideDistY += deltaDistY;
        fMapY += stepY;
      }

      if (!inBounds(fMapX, fMapY) || fetchCell(fMapX, fMapY).a >= 0.5) break;
    }
  }

  // Render in correct priority with proper occlusion
  bool wallOccludes = wallHit && frag.y >= lineTop && frag.y <= extendedBottom;
  bool sideOccludes = sideHit;
  if (floorHit &&
      (!sideOccludes || floorDist < sideDistClosest) &&
      (!wallOccludes || floorDist < wallDist)) {
    vec3 hitPos = vec3(u_camPos + rayDir * floorDist, floorH);
    vec2 frac = fract(hitPos.xy);
    vec4 tex = texture(u_floorTex, frac);

    vec3 normal = vec3(0.0, 0.0, 1.0);
    float shadowBlend = 0.0;
    vec2 primaryDir2D = vec2(0.0);
    float primaryStrength = 0.0;
    float lit = clamp(
      accumulateTorchLit(
        hitPos,
        normal,
        int(floor(hitPos.x)),
        int(floor(hitPos.y)),
        vec2(0.0, 0.0),
        shadowBlend,
        primaryDir2D,
        primaryStrength
      ),
      0.0,
      1.0
    );
    float litFloor = clamp(lit * TORCH_FLOOR_BOOST, 0.0, 1.5);

    float shadowFloor = mix(0.3, 0.12, u_shadowStrength);
    float shade = max(shadowFloor, 1.0 - floorDist / 10.0);
    if (TORCH_ONLY > 0.5) shade = 1.0;
    float torchLight = litFloor * TORCH_LIGHT_SCALE;
    float base = shade;
    float warmShift = 0.75 + 0.45 * torchLight;
    vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;
    float keyShadow = clamp(shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
    float lightPresence = clamp(primaryStrength, 0.0, 1.0);
    float shadowFade = smoothstep(0.08, 0.45, torchLight);
    keyShadow *= (1.0 - lightPresence * 0.75);
    keyShadow *= (1.0 - shadowFade);
    float baseShadowMul = 1.0 - keyShadow;
    vec3 floorCol = tex.rgb * base * baseShadowMul + tex.rgb * torchLight + torchAdd;
    outColor = vec4(floorCol, 1.0);
    gl_FragDepth = floorDist / u_depthFarDepth;
    return;
  }

  // Sky only when no surface occupies this pixel.
  if (frag.y < horizon && !wallHit && !sideHit) {
    float skyT = clamp((1.0 - v_uv.y) * 2.0, 0.0, 1.0);
    outColor = vec4(mix(u_skyTop, u_skyBot, skyT), 1.0);
    gl_FragDepth = 1.0;
    return;
  }

  float nearestDist = wallHit ? wallDist : u_depthFar;
  if (sideHit && sideDistClosest < nearestDist) {
    outColor = vec4(sideColClosest, 1.0);
    gl_FragDepth = sideDistClosest / u_depthFarDepth;
    return;
  }
  if (wallHit) {
    outColor = wallCol;
    gl_FragDepth = wallDist / u_depthFarDepth;
    return;
  }

  outColor = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragDepth = 1.0;
}`;

      this.program = createProgram(gl, vsSource, fsSource);
      if (!this.program) return false;

      this.uniformLocations = {
        resolution: gl.getUniformLocation(this.program, 'u_resolution'),
        camPos: gl.getUniformLocation(this.program, 'u_camPos'),
        camDir: gl.getUniformLocation(this.program, 'u_camDir'),
        plane: gl.getUniformLocation(this.program, 'u_plane'),
        focalLength: gl.getUniformLocation(this.program, 'u_focalLength'),
        eyeZ: gl.getUniformLocation(this.program, 'u_eyeZ'),
        playerFloor: gl.getUniformLocation(this.program, 'u_playerFloor'),
        cells: gl.getUniformLocation(this.program, 'u_cells'),
        wallAtlas: gl.getUniformLocation(this.program, 'u_wallAtlas'),
        floorTex: gl.getUniformLocation(this.program, 'u_floorTex'),
        gridSize: gl.getUniformLocation(this.program, 'u_gridSize'),
        playerTile: gl.getUniformLocation(this.program, 'u_playerTile'),
        skipBackCell: gl.getUniformLocation(this.program, 'u_skipBackCell'),
        flipY: gl.getUniformLocation(this.program, 'u_flipY'),
        heightMin: gl.getUniformLocation(this.program, 'u_heightMin'),
        heightRange: gl.getUniformLocation(this.program, 'u_heightRange'),
        minFloor: gl.getUniformLocation(this.program, 'u_minFloor'),
        wallUScale: gl.getUniformLocation(this.program, 'u_wallUScale'),
        lightDir: gl.getUniformLocation(this.program, 'u_lightDir'),
        lightIntensity: gl.getUniformLocation(this.program, 'u_lightIntensity'),
        maxSteps: gl.getUniformLocation(this.program, 'u_maxSteps'),
        atlasCols: gl.getUniformLocation(this.program, 'u_atlasCols'),
        atlasRows: gl.getUniformLocation(this.program, 'u_atlasRows'),
        skyTop: gl.getUniformLocation(this.program, 'u_skyTop'),
        skyBot: gl.getUniformLocation(this.program, 'u_skyBot'),
        depthFar: gl.getUniformLocation(this.program, 'u_depthFar'),
        depthFarDepth: gl.getUniformLocation(this.program, 'u_depthFarDepth'),
        shadowStrength: gl.getUniformLocation(this.program, 'u_shadowStrength'),
        torchCount: gl.getUniformLocation(this.program, 'u_torchCount'),
        torchPos: gl.getUniformLocation(this.program, 'u_torchPos[0]'),
        torchColor: gl.getUniformLocation(this.program, 'u_torchColor[0]'),
        torchRadius: gl.getUniformLocation(this.program, 'u_torchRadius[0]'),
        torchIntensity: gl.getUniformLocation(this.program, 'u_torchIntensity[0]')
      };

      this.posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
           1,  1
        ]),
        gl.STATIC_DRAW
      );

      this.cellTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.wallAtlasTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.wallAtlasTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.floorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

      const spriteVs = [
        '#version 300 es',
        'in vec2 a_pos;',
        'in vec2 a_uv;',
        'in float a_depth;',
        'out vec2 v_uv;',
        'out float v_depth;',
        'void main() {',
        '  v_uv = a_uv;',
        '  v_depth = a_depth;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      const spriteFs = [
        '#version 300 es',
        'precision highp float;',
        'in vec2 v_uv;',
        'in float v_depth;',
        'uniform sampler2D u_tex;',
        'uniform vec4 u_tint;',
        'uniform vec2 u_lightDir;',
        'uniform float u_lightElev;',
        'uniform float u_lightIntensity;',
        'uniform float u_profile;',
        'uniform float u_depthAmount;',
        'uniform vec3 u_spritePos;',
        'uniform float u_spriteHeight;',
        'uniform float u_spriteVFlip;',
        'uniform float u_depthShadeScale;',
        'uniform float u_shadowStrength;',
        'uniform int u_torchCount;',
        'uniform vec3 u_torchPos[' + MAX_TORCH_LIGHTS + '];',
        'uniform float u_torchRadius[' + MAX_TORCH_LIGHTS + '];',
        'uniform float u_torchIntensity[' + MAX_TORCH_LIGHTS + '];',
        'out vec4 outColor;',
        'void main() {',
        '  vec4 tex = texture(u_tex, v_uv);',
        '  if (tex.a < 0.01) discard;',
        '  vec3 normal = vec3(0.0, 0.0, 1.0);',
        '  if (u_profile > 0.5) {',
        '    float nx = (v_uv.x - 0.5) * 2.0;',
        '    float nz = sqrt(max(0.0, 1.0 - nx * nx));',
        '    normal = normalize(vec3(nx, 0.0, nz));',
        '  }',
        '  vec3 lightDir = normalize(vec3(u_lightDir, u_lightElev));',
        '  float ndotl = max(0.0, dot(normal, lightDir));',
        '  float dirShade = 0.6 + 0.4 * ndotl;',
        '  float shade = 1.0 - u_lightIntensity * u_depthAmount + u_lightIntensity * u_depthAmount * dirShade;',
        '  float contrast = mix(1.0, 1.25, u_shadowStrength);',
        '  shade = pow(max(1e-3, shade), contrast);',
        '  float vFrac = mix(v_uv.y, 1.0 - v_uv.y, u_spriteVFlip);',
        '  vec3 worldPos = vec3(u_spritePos.xy, u_spritePos.z + vFrac * u_spriteHeight);',
        '  const float TORCH_SPRITE_BOOST = 1.3;',
        '  float torchLit = 0.0;',
        '  for (int i = 0; i < ' + MAX_TORCH_LIGHTS + '; i++) {',
        '    if (i >= u_torchCount) break;',
        '    vec3 toL = u_torchPos[i] - worldPos;',
        '    float dist = length(toL);',
        '    if (dist >= u_torchRadius[i]) continue;',
        '    vec3 L = normalize(toL);',
        '    float ndotlTorch = max(0.0, dot(normal, L));',
        '    float falloff = 1.0 - dist / u_torchRadius[i];',
        '    float atten = falloff * falloff * u_torchIntensity[i];',
        '    const float TORCH_AMBIENT = 0.35;',
        '    torchLit += (TORCH_AMBIENT + ndotlTorch * (1.0 - TORCH_AMBIENT)) * atten;',
        '  }',
        '  torchLit *= TORCH_SPRITE_BOOST;',
        '  vec3 torchColor = vec3(1.0, 190.0/255.0, 130.0/255.0);',
        '  float distanceShade = max(0.3, 1.0 - v_depth * u_depthShadeScale);',
        '  float torchLight = torchLit * 0.6;',
        '  vec3 col = (tex.rgb * (shade + torchLight) + torchColor * torchLit * 0.35) * distanceShade;',
        '  outColor = vec4(col, tex.a) * u_tint;',
        '  gl_FragDepth = v_depth;',
        '}'
      ].join('\n');

      const voxelVs = [
        '#version 300 es',
        'in vec3 a_pos;',
        'in vec3 a_norm;',
        'in vec3 a_color;',
        'uniform vec2 u_resolution;',
        'uniform vec2 u_camPos;',
        'uniform vec2 u_camDir;',
        'uniform vec2 u_plane;',
        'uniform float u_focalLength;',
        'uniform float u_eyeZ;',
        'uniform float u_depthFarDepth;',
        'uniform float u_depthShadeScale;',
        'uniform float u_depthBias;',
        'uniform vec3 u_modelPos;',
        'uniform vec3 u_modelScale;',
        'out vec3 v_color;',
        'out vec3 v_normal;',
        'out vec3 v_worldPos;',
        'out float v_depth;',
        'void main() {',
        '  vec3 worldPos = u_modelPos + a_pos * u_modelScale;',
        '  v_worldPos = worldPos;',
        '  v_color = a_color;',
        '  v_normal = normalize(a_norm);',
        '  vec2 rel = worldPos.xy - u_camPos;',
        '  float invDet = 1.0 / (u_plane.x * u_camDir.y - u_camDir.x * u_plane.y);',
        '  float transformX = invDet * (u_camDir.y * rel.x - u_camDir.x * rel.y);',
        '  float transformY = invDet * (-u_plane.y * rel.x + u_plane.x * rel.y);',
        '  if (transformY <= 0.02) {',
        '    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
        '    v_depth = 1.0;',
        '    return;',
        '  }',
        '  float screenX = (u_resolution.x * 0.5) * (1.0 + transformX / transformY);',
        '  float screenY = (u_resolution.y * 0.5) + (u_eyeZ - worldPos.z) * u_focalLength / transformY;',
        '  float ndcX = (screenX / u_resolution.x) * 2.0 - 1.0;',
        '  float ndcY = 1.0 - (screenY / u_resolution.y) * 2.0;',
        '  float w = transformY;',
        '  gl_Position = vec4(ndcX * w, ndcY * w, 0.0, w);',
        '  v_depth = clamp(transformY / u_depthFarDepth - u_depthBias, 0.0, 1.0);',
        '}'
      ].join('\n');

      const voxelFs = `#version 300 es
precision highp float;
precision highp int;

in vec3 v_worldPos;
in vec3 v_normal;
in vec3 v_color;

out vec4 outColor;

uniform vec2 u_resolution;
uniform vec2 u_camPos;
uniform vec2 u_camDir;
uniform vec2 u_plane;
uniform float u_focalLength;
uniform float u_eyeZ;
uniform float u_depthFarDepth;

uniform vec2 u_lightDir;
uniform float u_lightElev;
uniform float u_lightIntensity;

uniform float u_depthShadeScale;
uniform float u_depthBias;
uniform float u_shadowStrength;
uniform float u_highlightBoost;
uniform float u_torchLightScale;

uniform vec3 u_toneShadow;
uniform vec3 u_toneMid;
uniform vec3 u_toneHighlight;

// 0.0 => normal lighting, 1.0 => output v_color (debug)
uniform float u_unlit;

// Controls how "posterized" the voxel lighting is. Higher = smoother.
uniform float u_toonSteps;

uniform int u_torchCount;
uniform vec3 u_torchPos[${MAX_TORCH_LIGHTS}];
uniform float u_torchRadius[${MAX_TORCH_LIGHTS}];
uniform float u_torchIntensity[${MAX_TORCH_LIGHTS}];
uniform float u_torchRadiusScale;
uniform sampler2D u_cells;
uniform ivec2 u_gridSize;
uniform int u_flipY;

const int MAX_TORCH = ${MAX_TORCH_LIGHTS};
const vec3 TORCH_COLOR = vec3(1.0, 190.0 / 255.0, 130.0 / 255.0);
const float TORCH_FALLOFF = 0.6;
const int SHADOW_DDA_STEPS = 64;
const float SHADOW_RADIUS_SCALE = 1.6;
const float SHADOW_DARKEN = 0.75;
const float TORCH_ONLY = 0.0;

float saturate(float x) { return clamp(x, 0.0, 1.0); }

vec4 fetchCell(int x, int y) {
  int yy = (u_flipY == 1) ? (u_gridSize.y - 1 - y) : y;
  if (x < 0 || yy < 0 || x >= u_gridSize.x || yy >= u_gridSize.y) {
    return vec4(0.0);
  }
  return texelFetch(u_cells, ivec2(x, yy), 0);
}

bool inBounds(int x, int y) {
  return x >= 0 && y >= 0 && x < u_gridSize.x && y < u_gridSize.y;
}

bool isCasterCell(vec4 cell) {
  return cell.a > 0.001;
}

float casterRadiusFromCell(vec4 cell) {
  return (cell.a >= 0.999) ? 0.5 : max(0.12, cell.a);
}

float shadowStrengthFromCaster(vec2 hitXY, vec2 casterCenter, float casterRadius, vec2 torchPos, float rad) {
  vec2 toHit = hitXY - torchPos;
  float distHit = length(toHit);
  if (distHit < 0.05 || distHit > rad) return 0.0;
  vec2 lightDir = normalize(casterCenter - torchPos);
  vec2 v = hitXY - casterCenter;
  float proj = dot(v, lightDir);
  if (proj <= 0.0) return 0.0;
  float len = clamp(rad * 1.1, 0.8, 12.0);
  float radius = casterRadius + proj * 0.12;
  float perp = length(v - lightDir * proj);
  float core = smoothstep(radius, radius - 0.22, perp);
  float front = smoothstep(0.0, 0.12, proj);
  float back = 1.0 - smoothstep(len * 0.85, len, proj);
  float strength = core * front * back;
  return strength;
}

float torchShadowFactor(vec2 hitXY, vec2 torchPos, float rad) {
  vec2 toHit = hitXY - torchPos;
  float distHit = length(toHit);
  float shadowRad = rad * SHADOW_RADIUS_SCALE;
  if (distHit < 0.05 || distHit > shadowRad) return 0.0;
  vec2 dir = toHit / max(distHit, 1e-4);

  int mapX = int(floor(torchPos.x));
  int mapY = int(floor(torchPos.y));
  int torchCellX = mapX;
  int torchCellY = mapY;
  int endX = int(floor(hitXY.x));
  int endY = int(floor(hitXY.y));
  float invDx = abs(dir.x) < 1e-4 ? 1e4 : abs(1.0 / dir.x);
  float invDy = abs(dir.y) < 1e-4 ? 1e4 : abs(1.0 / dir.y);
  int stepX = dir.x < 0.0 ? -1 : 1;
  int stepY = dir.y < 0.0 ? -1 : 1;
  float sideDistX = (stepX == -1 ? (torchPos.x - float(mapX)) : (float(mapX + 1) - torchPos.x)) * invDx;
  float sideDistY = (stepY == -1 ? (torchPos.y - float(mapY)) : (float(mapY + 1) - torchPos.y)) * invDy;

  for (int s = 0; s < SHADOW_DDA_STEPS; s++) {
    float nextT = min(sideDistX, sideDistY);
    if (nextT >= distHit - 0.02) break;
    if (sideDistX < sideDistY) {
      sideDistX += invDx;
      mapX += stepX;
    } else {
      sideDistY += invDy;
      mapY += stepY;
    }
    if (!inBounds(mapX, mapY)) break;
    if (mapX == torchCellX && mapY == torchCellY) continue;
    if (mapX == endX && mapY == endY) break;
    vec4 cell = fetchCell(mapX, mapY);
    if (!isCasterCell(cell)) continue;
    if (cell.a >= 0.999) return 1.0;
    vec2 center = vec2(float(mapX) + 0.5, float(mapY) + 0.5);
    float radius = casterRadiusFromCell(cell);
    vec2 toCenter = center - torchPos;
    float proj = dot(toCenter, dir);
    float perp = length(toCenter - dir * proj);
    if (perp > radius + 0.05) continue;
    return clamp(shadowStrengthFromCaster(hitXY, center, radius, torchPos, shadowRad), 0.0, 1.0);
  }
  return 0.0;
}

// Half-Lambert torch lighting so attached walls / sides still receive light
float accumulateTorchLit(vec3 worldPos, vec3 normal, out float dirWeight, out float dirStrength) {
  float total = 0.0;
  float ndotlSum = 0.0;
  float sumStrength = 0.0;
  const float TORCH_AMBIENT = 0.35;
  for (int i = 0; i < MAX_TORCH; i++) {
    if (i >= u_torchCount) break;
    vec3 toL = u_torchPos[i] - worldPos;
    float dist = length(toL);
    float rad = u_torchRadius[i] * u_torchRadiusScale;
    if (dist >= rad) continue;
    vec3 L = toL / max(dist, 1e-4);
    float ndotl_raw = dot(L, normal);
    float ndotl = ndotl_raw * 0.5 + 0.5;   // half-Lambert for fill
    ndotl = max(0.0, ndotl);
    float shadowFactor = torchShadowFactor(worldPos.xy, u_torchPos[i].xy, rad);
    float shadowMul = (shadowFactor > 0.98)
      ? 0.0
      : (1.0 - clamp(shadowFactor * SHADOW_DARKEN, 0.0, SHADOW_DARKEN));
    float rawStrength = pow(1.0 - dist / rad, TORCH_FALLOFF) * u_torchIntensity[i];
    float atten = rawStrength * shadowMul;
    total += (TORCH_AMBIENT + ndotl * (1.0 - TORCH_AMBIENT)) * atten;
    sumStrength += rawStrength;
    ndotlSum += max(0.0, ndotl_raw) * rawStrength;
  }
  dirStrength = sumStrength;
  dirWeight = (sumStrength > 1e-4) ? (ndotlSum / sumStrength) : 0.0;
  return total;
}

void main() {
  // Depth from world position (raycast depth buffer compatibility)
  float forward = dot(v_worldPos.xy - u_camPos, u_camDir);
  float depth = saturate((forward + u_depthBias) / max(u_depthFarDepth, 1e-3));
  gl_FragDepth = depth;

  // Debug: prove the "slits" are lighting (normal discontinuities) not holes.
  if (u_unlit > 0.5) {
    outColor = vec4(v_color, 1.0);
    return;
  }

  vec3 N = normalize(v_normal);

  // Torch contribution (kept separate so bright sides can still get a boost).
  float dirWeight = 0.0;
  float dirStrength = 0.0;
  float torch = accumulateTorchLit(v_worldPos, N, dirWeight, dirStrength);
  float torchLight = torch * u_torchLightScale;
  float ndotl = clamp(dirWeight, 0.0, 1.0);
  float baseLight = 0.15 + ndotl * u_lightIntensity * max(0.2, clamp(dirStrength, 0.0, 1.0));

  // Gradiated tone ramp (smoother than the posterized 3-tone look).
  float lit = baseLight + torchLight;
  float t = clamp(lit, 0.0, 2.0);
  float contrast = mix(1.0, 2.65, u_shadowStrength);
  t = pow(t / 2.0, contrast) * 2.0;
  t = t / (1.0 + 0.35 * t);
  float steps = mix(6.0, 3.0, u_shadowStrength);
  float tPoster = floor(t * steps) / steps;
  float tMix = mix(t, tPoster, u_shadowStrength);
  vec3 shadowCol = mix(u_toneShadow, u_toneShadow * 0.4, u_shadowStrength);
  vec3 ramp = mix(shadowCol, u_toneMid, smoothstep(0.0, 0.6, tMix));
  float highlightBoost = mix(1.0, 1.6, u_highlightBoost);
  float hi1 = saturate(smoothstep(0.35, 1.2, tMix) * highlightBoost);
  float hi2 = saturate(smoothstep(1.0, 2.0, tMix) * highlightBoost);
  ramp = mix(ramp, u_toneHighlight, hi1);
  ramp = mix(ramp, u_toneHighlight * TORCH_COLOR, hi2);

  /*
  // Posterize light gently (controls "banding" on low-poly cylinders)
  float steps = max(1.0, u_toonSteps);
  float t = saturate(light);
  t = floor(t * steps) / steps;

  // 3-tone ramp using the posterized 't' (keeps your stylized look without harsh seams)
  vec3 ramp;
  if (t < 0.45) {
    float k = saturate(t / 0.45);
    ramp = mix(u_toneShadow, u_toneMid, k);
  } else {
    float k = saturate((t - 0.45) / 0.55);
    ramp = mix(u_toneMid, u_toneHighlight, k);
  }
  */

  // Apply per-vertex color as albedo
  vec3 col = v_color * ramp;

  // Additive torch splash so it affects both shadowed and lit sides.
  vec3 torchTint = mix(v_color, vec3(1.0), 0.4) * TORCH_COLOR;
  float torchMix = saturate(torchLight * 0.5);
  col = mix(col, torchTint, torchMix);
  col += TORCH_COLOR * torchLight * 0.12;
  col = clamp(col, 0.0, 1.0);

  outColor = vec4(col, 1.0);
}`;

this.spriteProgram = createProgram(gl, spriteVs, spriteFs);
      if (!this.spriteProgram) return false;
      this.spriteAttribs = {
        pos: gl.getAttribLocation(this.spriteProgram, 'a_pos'),
        uv: gl.getAttribLocation(this.spriteProgram, 'a_uv'),
        depth: gl.getAttribLocation(this.spriteProgram, 'a_depth')
      };
      this.spriteUniforms = {
        tex: gl.getUniformLocation(this.spriteProgram, 'u_tex'),
        tint: gl.getUniformLocation(this.spriteProgram, 'u_tint'),
        lightDir: gl.getUniformLocation(this.spriteProgram, 'u_lightDir'),
        lightElev: gl.getUniformLocation(this.spriteProgram, 'u_lightElev'),
        lightIntensity: gl.getUniformLocation(this.spriteProgram, 'u_lightIntensity'),
        profile: gl.getUniformLocation(this.spriteProgram, 'u_profile'),
        depthAmount: gl.getUniformLocation(this.spriteProgram, 'u_depthAmount'),
        spritePos: gl.getUniformLocation(this.spriteProgram, 'u_spritePos'),
        spriteHeight: gl.getUniformLocation(this.spriteProgram, 'u_spriteHeight'),
        spriteVFlip: gl.getUniformLocation(this.spriteProgram, 'u_spriteVFlip'),
        depthShadeScale: gl.getUniformLocation(this.spriteProgram, 'u_depthShadeScale'),
        shadowStrength: gl.getUniformLocation(this.spriteProgram, 'u_shadowStrength'),
        torchCount: gl.getUniformLocation(this.spriteProgram, 'u_torchCount'),
        torchPos: gl.getUniformLocation(this.spriteProgram, 'u_torchPos[0]'),
        torchRadius: gl.getUniformLocation(this.spriteProgram, 'u_torchRadius[0]'),
        torchIntensity: gl.getUniformLocation(this.spriteProgram, 'u_torchIntensity[0]')
      };
      this.spriteBuffer = gl.createBuffer();

      this.voxelProgram = createProgram(gl, voxelVs, voxelFs);
      if (this.voxelProgram) {
        this.voxelAttribs = {
          pos: gl.getAttribLocation(this.voxelProgram, 'a_pos'),
          norm: gl.getAttribLocation(this.voxelProgram, 'a_norm'),
          color: gl.getAttribLocation(this.voxelProgram, 'a_color')
        };
        this.voxelUniforms = {
          resolution: gl.getUniformLocation(this.voxelProgram, 'u_resolution'),
          camPos: gl.getUniformLocation(this.voxelProgram, 'u_camPos'),
          camDir: gl.getUniformLocation(this.voxelProgram, 'u_camDir'),
          plane: gl.getUniformLocation(this.voxelProgram, 'u_plane'),
          focalLength: gl.getUniformLocation(this.voxelProgram, 'u_focalLength'),
          eyeZ: gl.getUniformLocation(this.voxelProgram, 'u_eyeZ'),
          depthFarDepth: gl.getUniformLocation(this.voxelProgram, 'u_depthFarDepth'),
          depthShadeScale: gl.getUniformLocation(this.voxelProgram, 'u_depthShadeScale'),
          depthBias: gl.getUniformLocation(this.voxelProgram, 'u_depthBias'),
          shadowStrength: gl.getUniformLocation(this.voxelProgram, 'u_shadowStrength'),
          highlightBoost: gl.getUniformLocation(this.voxelProgram, 'u_highlightBoost'),
          torchLightScale: gl.getUniformLocation(this.voxelProgram, 'u_torchLightScale'),
          cells: gl.getUniformLocation(this.voxelProgram, 'u_cells'),
          gridSize: gl.getUniformLocation(this.voxelProgram, 'u_gridSize'),
          flipY: gl.getUniformLocation(this.voxelProgram, 'u_flipY'),
          modelPos: gl.getUniformLocation(this.voxelProgram, 'u_modelPos'),
          modelScale: gl.getUniformLocation(this.voxelProgram, 'u_modelScale'),
          lightDir: gl.getUniformLocation(this.voxelProgram, 'u_lightDir'),
          lightElev: gl.getUniformLocation(this.voxelProgram, 'u_lightElev'),
          lightIntensity: gl.getUniformLocation(this.voxelProgram, 'u_lightIntensity'),
          torchRadiusScale: gl.getUniformLocation(this.voxelProgram, 'u_torchRadiusScale'),
          torchCount: gl.getUniformLocation(this.voxelProgram, 'u_torchCount'),
          torchPos: gl.getUniformLocation(this.voxelProgram, 'u_torchPos[0]'),
          torchRadius: gl.getUniformLocation(this.voxelProgram, 'u_torchRadius[0]'),
          torchIntensity: gl.getUniformLocation(this.voxelProgram, 'u_torchIntensity[0]'),
          toneShadow: gl.getUniformLocation(this.voxelProgram, 'u_toneShadow'),
          toneMid: gl.getUniformLocation(this.voxelProgram, 'u_toneMid'),
          toneHighlight: gl.getUniformLocation(this.voxelProgram, 'u_toneHighlight'),
          unlit: gl.getUniformLocation(this.voxelProgram, 'u_unlit'),
          toonSteps: gl.getUniformLocation(this.voxelProgram, 'u_toonSteps'),
        };
      } else {
        console.warn('Voxel shader compile failed; continuing without voxel meshes.');
      }

      if (!this.miniCanvas) {
        this.miniCanvas = document.createElement('canvas');
        this.miniCanvas.style.position = 'absolute';
        this.miniCanvas.style.left = '0';
        this.miniCanvas.style.top = '0';
        this.miniCanvas.style.pointerEvents = 'none';
        container.appendChild(this.miniCanvas);
        this.miniCtx = this.miniCanvas.getContext('2d');
      }

      return true;
    },

    rebuildDungeonTextures(dungeon, textures) {
      if (!dungeon || !textures || !this.gl) return;
      const key = dungeon.geoKey || dungeon._meta?.id || 'default';
      const floorReady = isTextureReady(textures.floor);
      const atlasCandidate = buildAtlas(textures);
      const atlasReady = !!(atlasCandidate && atlasCandidate.canvas);
      const atlasKey = atlasReady
        ? Object.keys(atlasCandidate.map || {}).sort().join('|')
        : 'none';
      const paletteKey = JSON.stringify(dungeon.visualStyle?.palette || {});
      if (this.dungeonKey !== key || this.voxelPaletteKey !== paletteKey) {
        this.voxelMeshes = {};
        this.voxelPaletteKey = paletteKey;
      }
      if (
        this.dungeonKey === key &&
        this.atlasReady === atlasReady &&
        this.atlasKey === atlasKey &&
        this.floorTexReady === floorReady
      ) {
        return;
      }

      const cells = dungeon.cells || {};
      let minH = Infinity;
      let maxH = -Infinity;
      for (const cell of Object.values(cells)) {
        if (!cell) continue;
        const fh = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
        const ch = typeof cell.ceilHeight === 'number' ? cell.ceilHeight : fh + 2;
        minH = Math.min(minH, fh, ch);
        maxH = Math.max(maxH, fh, ch);
      }
      if (!Number.isFinite(minH)) minH = 0;
      if (!Number.isFinite(maxH)) maxH = minH + 2;
      const range = Math.max(0.001, maxH - minH);
      this.heightMin = minH;
      this.heightRange = range;

      let layoutW = dungeon.layout?.width || 0;
      let layoutH = dungeon.layout?.height || 0;
      let maxX = -1;
      let maxY = -1;
      for (const keyStr of Object.keys(cells)) {
        const comma = keyStr.indexOf(',');
        if (comma <= 0) continue;
        const x = Number(keyStr.slice(0, comma));
        const y = Number(keyStr.slice(comma + 1));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (maxX >= 0) layoutW = Math.max(layoutW, maxX + 1);
      if (maxY >= 0) layoutH = Math.max(layoutH, maxY + 1);
      if (layoutW <= 0) layoutW = 1;
      if (layoutH <= 0) layoutH = 1;
      if (window.DEBUG_WEBGL_LAYOUT) {
        const logKey = `${key}:${layoutW}x${layoutH}:${maxX},${maxY}`;
        if (this._lastLayoutLogKey !== logKey) {
          this._lastLayoutLogKey = logKey;
          console.log('[WebGL] layout bounds', {
            key,
            layoutW,
            layoutH,
            maxCellX: maxX,
            maxCellY: maxY
          });
        }
      }
      this.gridW = layoutW;
      this.gridH = layoutH;

      const atlas = atlasCandidate || { canvas: null, cols: 1, rows: 1, map: {} };
      if (atlas && atlas.canvas) {
        this.atlasInfo = atlas;
      } else {
        this.atlasInfo = { canvas: null, cols: 1, rows: 1, map: {} };
      }
      const wallDefault = this.atlasInfo.map.wall ?? 0;
      const data = new Uint8Array(layoutW * layoutH * 4);

      for (let y = 0; y < layoutH; y++) {
        for (let x = 0; x < layoutW; x++) {
          const idx = (y * layoutW + x) * 4;
          const cell = cells[`${x},${y}`] || {};
          const tile = cell.tile || 'floor';

          // Only solid doors should block rays. If door metadata is missing, treat as OPEN.
          const isDoorClosed = (tile === 'door') && (cell?.door?.isOpen === false);

          const isSolid =
            tile === 'wall' ||
            tile === 'torch' ||
            isDoorClosed;
          const isObstacle = tile === 'pillar' || (typeof tile === 'string' && tile.startsWith('custom_'));

          // Torch uses wall art. Doors can also fall back to wall art if you don't have a door atlas entry.
          const tileName = (tile === 'torch' || tile === 'door') ? 'wall' : tile;

          const tileId = isSolid
            ? (this.atlasInfo.map[tileName] ?? wallDefault)
            : wallDefault;

          const floorH = (typeof cell.floorHeight === 'number') ? cell.floorHeight : 0;
          const ceilH  = (typeof cell.ceilHeight  === 'number') ? cell.ceilHeight  : floorH + 2;

          const fh = Math.max(0, Math.min(255, Math.round(((floorH - minH) / range) * 255)));
          const ch = Math.max(0, Math.min(255, Math.round(((ceilH  - minH) / range) * 255)));

          data[idx]     = tileId;
          data[idx + 1] = fh;
          data[idx + 2] = ch;
          let obstacleRadius = 0;
          if (isObstacle) {
            const spec = dungeon.tiles?.[tile]?.spriteSpec || {};
            const baseWidth = Number.isFinite(spec.baseWidth)
              ? spec.baseWidth
              : (Number.isFinite(spec.gridWidth) ? spec.gridWidth : 0.6);
            obstacleRadius = Math.max(0.12, Math.min(0.48, baseWidth * 0.5));
          }
          data[idx + 3] = isSolid
            ? 255
            : (isObstacle ? Math.max(1, Math.min(254, Math.round(obstacleRadius * 255))) : 0);
        }
      }

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layoutW, layoutH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

      if (this.atlasInfo.canvas) {
        gl.bindTexture(gl.TEXTURE_2D, this.wallAtlasTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasInfo.canvas);
      } else {
        const fallback = new Uint8Array([60, 45, 30, 255]);
        gl.bindTexture(gl.TEXTURE_2D, this.wallAtlasTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallback);
      }

      const floorImg = textures.floor;
      if (floorReady) {
        gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, floorImg);
      } else {
        const fallback = new Uint8Array([34, 0, 0, 255]);
        gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallback);
      }

      this.dungeonKey = key;
      this.atlasReady = atlasReady;
      this.atlasKey = atlasKey;
      this.floorTexReady = floorReady;
    },

    getSpriteTexture(img) {
      if (!img || !img.complete || img.naturalWidth === 0) return null;
      const key = img.src || img._webglKey || `${img.naturalWidth}x${img.naturalHeight}`;
      if (this.spriteTexCache[key]) return this.spriteTexCache[key];
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.spriteTexCache[key] = tex;
      return tex;
    },

    buildHaloTexture() {
      if (this.haloTex || !this.gl) return;
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(255, 210, 120, 1)');
      grad.addColorStop(0.4, 'rgba(255, 170, 60, 0.8)');
      grad.addColorStop(1, 'rgba(255, 140, 20, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      const gl = this.gl;
      this.haloTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.haloTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    },

    buildFlameTexture() {
      if (this.flameTex || !this.gl) return;
      const w = 10;
      const h = 14;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      for (let row = 0; row < h; row++) {
        const t = row / Math.max(1, h - 1);
        const rowW = Math.max(1, Math.round(w * (1 - t * 0.7)));
        const x0 = Math.floor((w - rowW) / 2);
        const r = 255;
        const g = Math.round(140 + (1 - t) * 80);
        const b = Math.round(40 + (1 - t) * 30);
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.fillRect(x0, row, rowW, 1);
      }
      const coreY = Math.max(0, Math.min(h - 2, Math.floor(h * 0.35)));
      ctx.fillStyle = 'rgba(255,245,220,0.9)';
      ctx.fillRect(Math.floor(w / 2), coreY, 1, 1);
      ctx.fillRect(Math.floor(w / 2), coreY + 1, 1, 1);

      const gl = this.gl;
      this.flameTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.flameTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    },



    ensureDebugCanvas(container, displayW, displayH) {
      if (!container) return null;
      if (!this.debugCanvas) {
        this.debugCanvas = document.createElement('canvas');
        this.debugCanvas.style.position = 'absolute';
        this.debugCanvas.style.left = '0';
        this.debugCanvas.style.top = '0';
        this.debugCanvas.style.pointerEvents = 'none';
        this.debugCanvas.style.zIndex = '5';
        this.debugCanvas.style.imageRendering = 'pixelated';
        this.debugCanvas.style.imageRendering = 'crisp-edges';
        if (!container.style.position) {
          container.style.position = 'relative';
        }
        container.appendChild(this.debugCanvas);
      }
      if (this.debugCanvas.width !== displayW || this.debugCanvas.height !== displayH) {
        this.debugCanvas.width = displayW;
        this.debugCanvas.height = displayH;
        this.debugCanvas.style.width = displayW + 'px';
        this.debugCanvas.style.height = displayH + 'px';
      }
      return this.debugCanvas.getContext('2d');
    },

    drawDebugOverlay(container, displayW, displayH, dungeon, playerX, playerY, camX, camY) {
      const ctx = this.ensureDebugCanvas(container, displayW, displayH);
      if (!ctx) return;
      ctx.clearRect(0, 0, displayW, displayH);

      const tileSize = 6;
      const radius = 6;
      const originX = 8;
      const originY = 8;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const wx = playerX + dx;
          const wy = playerY + dy;
          const cell = dungeon.cells?.[`${wx},${wy}`];
          let color = '#222222';
          if (cell) {
            const tile = cell.tile || 'floor';
            if (tile === 'wall' || tile === 'door' || tile === 'pillar' || tile === 'torch') {
              color = '#aa3030';
            } else {
              color = '#404040';
            }
          }
          const sx = originX + (dx + radius) * tileSize;
          const sy = originY + (dy + radius) * tileSize;
          ctx.fillStyle = color;
          ctx.fillRect(sx, sy, tileSize, tileSize);
        }
      }

      const pX = originX + radius * tileSize;
      const pY = originY + radius * tileSize;
      ctx.fillStyle = '#2fd14f';
      ctx.fillRect(pX + 1, pY + 1, tileSize - 2, tileSize - 2);

      const camTileX = Math.floor(camX);
      const camTileY = Math.floor(camY);
      const cdx = camTileX - playerX;
      const cdy = camTileY - playerY;
      if (Math.abs(cdx) <= radius && Math.abs(cdy) <= radius) {
        const cX = originX + (cdx + radius) * tileSize;
        const cY = originY + (cdy + radius) * tileSize;
        ctx.strokeStyle = '#3aa3ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(cX + 1, cY + 1, tileSize - 2, tileSize - 2);
      }

      ctx.fillStyle = '#cccccc';
      ctx.font = '12px monospace';
      ctx.fillText(`p:${playerX},${playerY}`, originX, originY + (radius * 2 + 2) * tileSize + 14);
      ctx.fillText(`c:${camTileX},${camTileY}`, originX, originY + (radius * 2 + 2) * tileSize + 28);
    },

    renderScene() {
      const popup = document.getElementById('dungeon-popup');
      const container = document.getElementById('dungeon-container');
      if (!popup || !container) return;
      if (popup.style.display !== 'block') {
        popup.style.display = 'block';
      }

      const displayW = 640;
      const displayH = 480;
      const pixelScale = 4;
      if (!this.gl) {
        const ok = this.init(container);
        if (!ok) {
          window.useWebGLRenderer = false;
          return;
        }
      }
      const width = this.canvas ? this.canvas.width : Math.max(1, Math.floor(displayW / pixelScale));
      const height = this.canvas ? this.canvas.height : Math.max(1, Math.floor(displayH / pixelScale));

      const dungeon = window.currentDungeon;
      const textures = window.dungeonTextures;
      if (!dungeon || !textures) return;
      this.rebuildDungeonTextures(dungeon, textures);
      const isOutdoor = dungeon.classification && dungeon.classification.indoor === false;

      const playerX = window.playerDungeonX ?? 0;
      const playerY = window.playerDungeonY ?? 0;
      const playerAngle = window.playerAngle ?? 0;
      const dirX = Math.cos(playerAngle);
      const dirY = Math.sin(playerAngle);
      const playerWorldX = Number.isFinite(window.playerPosX) ? window.playerPosX : playerX + 0.5;
      const playerWorldY = Number.isFinite(window.playerPosY) ? window.playerPosY : playerY + 0.5;
      const eyeBack = Number.isFinite(window.WEBGL_EYE_BACK) ? window.WEBGL_EYE_BACK : 0.0;
      let camX = playerWorldX - dirX * eyeBack;
      let camY = playerWorldY - dirY * eyeBack;
      //const camCell = dungeon.cells?.[`${Math.floor(camX)},${Math.floor(camY)}`];
      //const camTile = camCell?.tile;
      //const camBlocked = !camCell || camTile === 'wall' || camTile === 'door' || camTile === 'pillar' || camTile === 'torch';
      /*if (camBlocked) {
        camX = playerWorldX;
        camY = playerWorldY;
        const now = performance.now();
        if (!this._lastCamGuardLog || now - this._lastCamGuardLog > 750) {
          this._lastCamGuardLog = now;
          console.log('[WebGL] eyeBack blocked by', camTile || 'void', 'falling back to player cell');
        }
      }*/
      const playerCell = dungeon.cells?.[`${playerX},${playerY}`] || {};
      const playerFloor = typeof playerCell.floorHeight === 'number' ? playerCell.floorHeight : 0;
      const eyeZ = Number.isFinite(window.playerZ)
        ? window.playerZ
        : playerFloor + (window.PLAYER_EYE_HEIGHT || 0.5);
      // Optional: store globally for consistency
      window.playerZ = eyeZ;

      let minFloor = Infinity;
      for (const cell of Object.values(dungeon.cells || {})) {
        if (cell && typeof cell.floorHeight === 'number') {
          minFloor = Math.min(minFloor, cell.floorHeight);
        }
      }
      if (!Number.isFinite(minFloor)) minFloor = 0;

      const FOV = Math.PI / 3;
      const planeScale = Math.tan(FOV / 2);
      const planeX = -dirY * planeScale;
      const planeY = dirX * planeScale;
      const focalLength = height / (2 * Math.tan(FOV / 2));

      if (window.DEBUG_WEBGL_POS) {
        const now = performance.now();
        if (!this._lastPosLog || now - this._lastPosLog > 750) {
          this._lastPosLog = now;
          const playerKey = `${playerX},${playerY}`;
          const camKey = `${Math.floor(camX)},${Math.floor(camY)}`;
          const camDelta = {
            dx: Math.floor(camX) - playerX,
            dy: Math.floor(camY) - playerY
          };
          const playerCellDbg = dungeon.cells?.[playerKey];
          const camCellDbg = dungeon.cells?.[camKey];
          const camTile = camCellDbg?.tile;
          console.log('[WebGL] pos', {
            player: { x: playerX, y: playerY },
            cam: { x: Number(camX.toFixed(3)), y: Number(camY.toFixed(3)) },
            eyeBack,
            playerAngle,
            dir: { x: Number(dirX.toFixed(3)), y: Number(dirY.toFixed(3)) },
            camKey,
            camDelta,
            camTile: camTile || 'void',
            playerTile: playerCellDbg?.tile || 'void'
          });
        }
      }
      if (window.DEBUG_WEBGL_HIT) {
        const now = performance.now();
        if (!this._lastHitLog || now - this._lastHitLog > 750) {
          this._lastHitLog = now;
          const cameraX = 0;
          const rayDirX = dirX + planeX * cameraX;
          const rayDirY = dirY + planeY * cameraX;
          let mapX = Math.floor(camX);
          let mapY = Math.floor(camY);
          const deltaDistX = Math.abs(1 / rayDirX);
          const deltaDistY = Math.abs(1 / rayDirY);
          const stepX = rayDirX < 0 ? -1 : 1;
          const stepY = rayDirY < 0 ? -1 : 1;
          let sideDistX = (stepX === -1 ? (camX - mapX) : (mapX + 1 - camX)) * deltaDistX;
          let sideDistY = (stepY === -1 ? (camY - mapY) : (mapY + 1 - camY)) * deltaDistY;
          let hit = false;
          let side = 0;
          const maxSteps = isOutdoor ? 400 : 64;
          let cell = null;
          for (let i = 0; i < maxSteps; i++) {
            if (sideDistX < sideDistY) {
              sideDistX += deltaDistX;
              mapX += stepX;
              side = 0;
            } else {
              sideDistY += deltaDistY;
              mapY += stepY;
              side = 1;
            }
            cell = dungeon.cells?.[`${mapX},${mapY}`] || null;
            const tile = cell?.tile || 'floor';
            if (tile === 'wall' || tile === 'door' || tile === 'torch' || tile === 'pillar') {
              hit = true;
              break;
            }
          }
          console.log('[WebGL] hit', {
            cam: { x: Number(camX.toFixed(3)), y: Number(camY.toFixed(3)) },
            map: { x: mapX, y: mapY },
            hit,
            side,
            tile: cell?.tile || 'floor'
          });
        }
      }

      const lighting = normalizeLight(dungeon.lighting || dungeon.classification?.lighting);

      let skyTop = '#050012';
      let skyBot = '#050012';
      if (dungeon.skyTop) {
        skyTop = dungeon.skyTop;
        skyBot = dungeon.skyBot || dungeon.skyTop;
      } else if (dungeon.classification?.skyTop) {
        skyTop = dungeon.classification.skyTop;
        skyBot = dungeon.classification.skyBot || skyTop;
      }

      function hexToRgb(hex) {
        const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
        if (!m) return { r: 0.02, g: 0.02, b: 0.05 };
        const v = parseInt(m[1], 16);
        return {
          r: ((v >> 16) & 255) / 255,
          g: ((v >> 8) & 255) / 255,
          b: (v & 255) / 255
        };
      }
      const skyTopRgb = hexToRgb(skyTop);
      const skyBotRgb = hexToRgb(skyBot);

      const gl = this.gl;
      const layoutW = dungeon.layout?.width || 32;
      const layoutH = dungeon.layout?.height || 32;
      const maxDim = Math.max(layoutW, layoutH);
      const VIS_RADIUS = Math.max(10, Math.min(18, Math.floor(maxDim / 10)));
      const TORCH_VIS_RADIUS = Math.max(VIS_RADIUS, 64);
      const TORCH_MOUNT_HEIGHT = 0.45;
      const TORCH_MOUNT_RATIO = 0.55;
      const TORCH_WALL_OFFSET = 0.6;

      const torchLights = [];
      const now = performance.now();
      const torchOcclusion = (typeof window !== 'undefined') ? window.TORCH_OCCLUSION !== false : true;

      const isWallTile = (tile) => ['wall', 'door', 'torch'].includes(tile);
      const isSolidCell = (cell) => {
        const tile = cell?.tile || 'floor';
        if (tile === 'wall' || tile === 'torch') return true;
        if (tile === 'door') return cell?.door?.isOpen === false;
        return false;
      };
      const getTorchFacing = (wx, wy, cell) => {
        let facing = (cell?.torchFacing || '').trim().toUpperCase();
        if (['N', 'S', 'E', 'W'].includes(facing)) return facing;
        const dirs = [
          { f: 'N', ox: 0, oy: -1 },
          { f: 'S', ox: 0, oy: 1 },
          { f: 'W', ox: -1, oy: 0 },
          { f: 'E', ox: 1, oy: 0 }
        ];
        for (const d of dirs) {
          const ncell = dungeon.cells?.[`${wx + d.ox},${wy + d.oy}`];
          if (!ncell || !isWallTile(ncell.tile)) {
            return d.f;
          }
        }
        return 'N';
      };
      const hasLineOfSight = (x0, y0, x1, y1) => {
        const startX = Math.floor(x0);
        const startY = Math.floor(y0);
        const endX = Math.floor(x1);
        const endY = Math.floor(y1);
        if (startX === endX && startY === endY) return true;

        const dx = x1 - x0;
        const dy = y1 - y0;
        const stepX = dx > 0 ? 1 : -1;
        const stepY = dy > 0 ? 1 : -1;
        const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
        const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
        const fracX = dx > 0 ? (Math.floor(x0) + 1 - x0) : (x0 - Math.floor(x0));
        const fracY = dy > 0 ? (Math.floor(y0) + 1 - y0) : (y0 - Math.floor(y0));
        let tMaxX = dx !== 0 ? fracX * tDeltaX : Infinity;
        let tMaxY = dy !== 0 ? fracY * tDeltaY : Infinity;

        let x = startX;
        let y = startY;
        let steps = 0;
        while ((x !== endX || y !== endY) && steps < 512) {
          if (tMaxX < tMaxY) {
            tMaxX += tDeltaX;
            x += stepX;
          } else {
            tMaxY += tDeltaY;
            y += stepY;
          }
          if (x === endX && y === endY) break;
          const cell = dungeon.cells?.[`${x},${y}`];
          if (!cell || isSolidCell(cell)) return false;
          steps++;
        }
        return true;
      };
      const makeTorchUniformData = () => ({
        count: 0,
        posArr: new Float32Array(MAX_TORCH_LIGHTS * 3),
        radiusArr: new Float32Array(MAX_TORCH_LIGHTS),
        intensityArr: new Float32Array(MAX_TORCH_LIGHTS)
      });
      const packTorchUniforms = (list, out, wrapped = false) => {
        const count = Math.min(list.length, MAX_TORCH_LIGHTS);
        out.count = count;
        for (let i = 0; i < count; i++) {
          const t = wrapped ? list[i].t : list[i];
          const bi = i * 3;
          out.posArr[bi] = t.x;
          out.posArr[bi + 1] = t.y;
          out.posArr[bi + 2] = t.z;
          out.radiusArr[i] = t.radius;
          out.intensityArr[i] = t.intensity;
        }
        return out;
      };
      const torchUniformData = makeTorchUniformData();
      const occludedTorchUniformData = makeTorchUniformData();
      const visibleTorchScratch = [];
      const getTorchUniformData = (targetX, targetY, radiusScale) => {
        if (!torchOcclusion) return torchUniformData;
        if (!torchUniformData.count) return torchUniformData;
        visibleTorchScratch.length = 0;
        for (const t of torchLights) {
          const dx = t.x - targetX;
          const dy = t.y - targetY;
          const rad = t.radius * radiusScale;
          if (dx * dx + dy * dy > rad * rad) continue;
          if (!hasLineOfSight(t.x, t.y, targetX, targetY)) continue;
          visibleTorchScratch.push({ t, dist2: dx * dx + dy * dy });
        }
        visibleTorchScratch.sort((a, b) => a.dist2 - b.dist2);
        return packTorchUniforms(visibleTorchScratch, occludedTorchUniformData, true);
      };
      for (let dx = -TORCH_VIS_RADIUS; dx <= TORCH_VIS_RADIUS; dx++) {
        for (let dy = -TORCH_VIS_RADIUS; dy <= TORCH_VIS_RADIUS; dy++) {
          const wx = playerX + dx;
          const wy = playerY + dy;
          const cell = dungeon.cells?.[`${wx},${wy}`];
          if (!cell || cell.tile !== 'torch') continue;

          let worldX = wx + 0.5;
          let worldY = wy + 0.5;
          const facing = getTorchFacing(wx, wy, cell);
          if (facing === 'N') worldY -= TORCH_WALL_OFFSET;
          if (facing === 'S') worldY += TORCH_WALL_OFFSET;
          if (facing === 'W') worldX -= TORCH_WALL_OFFSET;
          if (facing === 'E') worldX += TORCH_WALL_OFFSET;

          const floorH = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
          const ceilH = typeof cell.ceilHeight === 'number' ? cell.ceilHeight : floorH + TORCH_MOUNT_HEIGHT;
          const wallH = Math.max(0.1, ceilH - floorH);
          const torchZ = floorH + wallH * TORCH_MOUNT_RATIO;
          const seed = ((wx * 928371 + wy * 1237) % 1000) / 1000;
          const flicker = torchFlicker(seed, now);

          const dxl = worldX - camX;
          const dyl = worldY - camY;
          torchLights.push({
            x: worldX,
            y: worldY,
            z: torchZ,
            radius: TORCH_LIGHT_RADIUS_FLOOR,
            intensity: Math.max(0.25, Math.min(1.15, flicker)),
            dist2: dxl * dxl + dyl * dyl
          });
        }
      }
      torchLights.sort((a, b) => a.dist2 - b.dist2);
      packTorchUniforms(torchLights, torchUniformData);

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);

      const posLoc = gl.getAttribLocation(this.program, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(this.uniformLocations.resolution, width, height);
      gl.uniform2f(this.uniformLocations.camPos, camX, camY);
      gl.uniform2f(this.uniformLocations.camDir, dirX, dirY);
      gl.uniform2f(this.uniformLocations.plane, planeX, planeY);
      gl.uniform1f(this.uniformLocations.focalLength, focalLength);
      gl.uniform1f(this.uniformLocations.eyeZ, eyeZ);
      gl.uniform1f(this.uniformLocations.playerFloor, playerFloor);
      gl.uniform2i(this.uniformLocations.gridSize, this.gridW, this.gridH);
      gl.uniform2i(this.uniformLocations.playerTile, playerX, playerY);
      gl.uniform1i(this.uniformLocations.skipBackCell, 1);
      gl.uniform1i(this.uniformLocations.flipY, 1);
      //gl.uniform1i(this.uniformLocations.skipBackCell, window.DEBUG_WEBGL_SKIP_BACK === false ? 0 : 1);
      gl.uniform1f(this.uniformLocations.heightMin, this.heightMin);
      gl.uniform1f(this.uniformLocations.heightRange, this.heightRange);
      gl.uniform1f(this.uniformLocations.minFloor, minFloor);
      gl.uniform1f(this.uniformLocations.wallUScale, 0.25);
      gl.uniform2f(this.uniformLocations.lightDir, lighting.dirX, lighting.dirY);
      gl.uniform1f(this.uniformLocations.lightIntensity, lighting.intensity);
      const outdoorDepthFar = 1000000.0;
      const outdoorDepthFarDepth = 300.0;
      const depthFar = isOutdoor ? outdoorDepthFar : 60.0;
      const depthFarDepth = isOutdoor ? outdoorDepthFarDepth : 60.0;
      const depthShadeScale = depthFarDepth / 10.0;
      const shadowStrength = Number.isFinite(window.SHADOW_STRENGTH) ? window.SHADOW_STRENGTH : 0.6;
      const shadowStrengthClamped = Math.max(0.0, Math.min(4.0, shadowStrength));
      const highlightBoost = Number.isFinite(window.HIGHLIGHT_BOOST) ? window.HIGHLIGHT_BOOST : 0.6;
      const highlightBoostClamped = Math.max(0.0, Math.min(4.0, highlightBoost));
      const torchLightScale = Number.isFinite(window.TORCH_LIGHT_SCALE) ? window.TORCH_LIGHT_SCALE : 0.4;
      const torchLightScaleClamped = Math.max(0.0, Math.min(2.0, torchLightScale));
      const torchRadiusVoxelScale = Number.isFinite(window.TORCH_LIGHT_RADIUS_VOXEL_SCALE)
        ? window.TORCH_LIGHT_RADIUS_VOXEL_SCALE
        : TORCH_LIGHT_RADIUS_VOXEL_SCALE;
      const torchRadiusVoxelScaleClamped = Math.max(0.0, Math.min(10.0, torchRadiusVoxelScale));
      const voxelShadeScale = 10.0;
      const maxRayDist = Math.max(
        camX,
        this.gridW - camX,
        camY,
        this.gridH - camY
      );
      const outdoorMaxSteps = Math.max(
        8,
        Math.min(Math.ceil(maxRayDist) + 2, Math.ceil(outdoorDepthFar))
      );
      gl.uniform1i(this.uniformLocations.maxSteps, isOutdoor ? outdoorMaxSteps : 64);
      gl.uniform1i(this.uniformLocations.atlasCols, this.atlasInfo?.cols || 1);
      gl.uniform1i(this.uniformLocations.atlasRows, this.atlasInfo?.rows || 1);
      gl.uniform3f(this.uniformLocations.skyTop, skyTopRgb.r, skyTopRgb.g, skyTopRgb.b);
      gl.uniform3f(this.uniformLocations.skyBot, skyBotRgb.r, skyBotRgb.g, skyBotRgb.b);
      gl.uniform1f(this.uniformLocations.depthFar, depthFar);
      gl.uniform1f(this.uniformLocations.depthFarDepth, depthFarDepth);
      if (this.uniformLocations.shadowStrength) {
        gl.uniform1f(this.uniformLocations.shadowStrength, shadowStrengthClamped);
      }
      if (this.uniformLocations.torchCount) {
        const colorArr = new Float32Array(MAX_TORCH_LIGHTS * 3);
        for (let i = 0; i < torchUniformData.count; i++) {
          const bi = i * 3;
          colorArr[bi] = TORCH_LIGHT_COLOR.r / 255;
          colorArr[bi + 1] = TORCH_LIGHT_COLOR.g / 255;
          colorArr[bi + 2] = TORCH_LIGHT_COLOR.b / 255;
        }
        gl.uniform1i(this.uniformLocations.torchCount, torchUniformData.count);
        gl.uniform3fv(this.uniformLocations.torchPos, torchUniformData.posArr);
        gl.uniform3fv(this.uniformLocations.torchColor, colorArr);
        gl.uniform1fv(this.uniformLocations.torchRadius, torchUniformData.radiusArr);
        gl.uniform1fv(this.uniformLocations.torchIntensity, torchUniformData.intensityArr);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
      gl.uniform1i(this.uniformLocations.cells, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.wallAtlasTex);
      gl.uniform1i(this.uniformLocations.wallAtlas, 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
      gl.uniform1i(this.uniformLocations.floorTex, 2);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Sprites/torches pass (billboards in screen space, depth-tested)
      const sprites = [];
      const voxelInstances = [];
      const SPRITE_WORLD_HEIGHT = 1.8;
      const SPRITE_WIDTH_RATIO = 0.7;
      // Keep these in sync with the (better) canvas sprite pass values in game.js
      const TORCH_WORLD_HEIGHT = 1.3;
      const TORCH_WIDTH_RATIO = 0.6;
      const TORCH_FLAME_RATIO = 0.4;
      const TORCH_ANCHOR_RATIO = 0.78;

      for (let dx = -TORCH_VIS_RADIUS; dx <= TORCH_VIS_RADIUS; dx++) {
        for (let dy = -TORCH_VIS_RADIUS; dy <= TORCH_VIS_RADIUS; dy++) {
          const wx = playerX + dx;
          const wy = playerY + dy;
          const cell = dungeon.cells?.[`${wx},${wy}`];
          if (!cell || !cell.tile) continue;
          const tileName = cell.tile;
          const isTorch = tileName === 'torch';
          const hasSpriteSpec = !!(dungeon.tiles && dungeon.tiles[tileName]?.spriteSpec);
          const isCustom = tileName === 'pillar'
            || (tileName.startsWith && tileName.startsWith('custom_'))
            || hasSpriteSpec;

          const floorH = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
          const ceilH = typeof cell.ceilHeight === 'number' ? cell.ceilHeight : floorH + 2;
          const meta = (window.dungeonTexturesMeta && tileName)
            ? window.dungeonTexturesMeta[tileName]
            : null;
          const heightRatio = typeof meta?.heightRatio === 'number' ? meta.heightRatio : 1.0;
          const baseWidth = typeof meta?.baseWidth === 'number' ? meta.baseWidth : SPRITE_WIDTH_RATIO;

          if (!isTorch && !isCustom) continue;

          // Base position (wall cell center)
          let renderX = wx + 0.5;
          let renderY = wy + 0.5;

          // Light position (offset forward for correct glow)
          let lightX = renderX;
          let lightY = renderY;
          if (isTorch) {
            const facing = getTorchFacing(wx, wy, cell);
            if (facing === 'N') {
              renderY -= TORCH_WALL_OFFSET;
              lightY -= TORCH_WALL_OFFSET;
            }
            if (facing === 'S') {
              renderY += TORCH_WALL_OFFSET;
              lightY += TORCH_WALL_OFFSET;
            }
            if (facing === 'W') {
              renderX -= TORCH_WALL_OFFSET;
              lightX -= TORCH_WALL_OFFSET;
            }
            if (facing === 'E') {
              renderX += TORCH_WALL_OFFSET;
              lightX += TORCH_WALL_OFFSET;
            }
          }

          if (!isTorch && isCustom && this.voxelProgram) {
            const voxelMesh = this.getVoxelMesh(tileName, dungeon);
            if (voxelMesh) {
              let voxelHeight = SPRITE_WORLD_HEIGHT;
              if (ceilH > floorH) {
                voxelHeight = Math.max(0.5, (ceilH - floorH) * heightRatio);
              }
              voxelInstances.push({
                mesh: voxelMesh,
                modelPos: {
                  x: renderX - baseWidth * 0.5,
                  y: renderY - baseWidth * 0.5,
                  z: floorH
                },
                modelScale: {
                  x: baseWidth,
                  y: baseWidth,
                  z: voxelHeight
                }
              });
              continue;
            }
          }

          const texImg = window.dungeonTextures && window.dungeonTextures[tileName];
          if (!isTorch && (!texImg || !texImg.complete)) continue;

          const dxp = renderX - camX;
          const dyp = renderY - camY;
          const distSq = dxp * dxp + dyp * dyp;
          if (!isTorch && distSq > VIS_RADIUS * VIS_RADIUS) continue;
          if (!isTorch && distSq < 0.04) continue;

          const invDet = 1.0 / (planeX * dirY - dirX * planeY);
          const transformX = invDet * (dirY * dxp - dirX * dyp);
          const transformY = invDet * (-planeY * dxp + planeX * dyp);
          if (transformY <= 0.02) continue;
          const safeTransformY = Math.max(0.02, transformY);

          const spriteScreenX = Math.floor((width / 2) * (1 + transformX / safeTransformY));

          let spriteWorldHeight = SPRITE_WORLD_HEIGHT;
          let spriteWidthRatio = SPRITE_WIDTH_RATIO;
          let spriteBaseZ = floorH; // Mount point Z
          const spriteBaseWidth = baseWidth;
          if (isTorch) {
            spriteWorldHeight = TORCH_WORLD_HEIGHT;
            spriteWidthRatio = TORCH_WIDTH_RATIO;
            spriteBaseZ = floorH + (ceilH - floorH) * TORCH_MOUNT_RATIO;
          } else if (ceilH > floorH) {
            spriteWorldHeight = Math.max(0.5, (ceilH - floorH) * heightRatio);
            spriteWidthRatio = spriteBaseWidth;
          }

          const spriteDistance = Math.max(0.1, safeTransformY);

          // Screen-space Y for the mount point Z.
          // (height/2 is our horizon in the shader path.)
          const mountScreenY = Math.floor(height / 2 + (eyeZ - spriteBaseZ) * focalLength / spriteDistance);

          let spriteScreenHeight = Math.max(2, Math.floor(spriteWorldHeight * focalLength / spriteDistance));
          const spriteScreenWidth = Math.max(isTorch ? 2 : 1, Math.floor(spriteScreenHeight * spriteWidthRatio));

          // Clamp extreme close-up to prevent overflow
          spriteScreenHeight = Math.min(spriteScreenHeight, height * 1.8);

          // IMPORTANT: match the canvas pass's anchoring.
          // - Non-torches are floor-anchored (bottom at mountScreenY)
          // - Torches are wall-anchored (mount point sits at TORCH_ANCHOR_RATIO down from top)
          let rawDrawStartY;
          let rawDrawEndY;
          if (isTorch) {
            rawDrawStartY = mountScreenY - spriteScreenHeight * TORCH_ANCHOR_RATIO;
            rawDrawEndY = rawDrawStartY + spriteScreenHeight;
          } else {
            rawDrawStartY = mountScreenY - spriteScreenHeight;
            rawDrawEndY = mountScreenY;
          }

          if (!isTorch && isCustom && texImg) {
            // Keep custom sprites grounded; avoid pushing them upward.
          }

          const drawStartY = Math.max(0, rawDrawStartY);
          const drawEndY = Math.min(height, rawDrawEndY);
          if (drawStartY >= drawEndY) continue;

          const drawLeft = Math.floor(spriteScreenX - spriteScreenWidth / 2 - 0.5);
          const drawRight = Math.ceil(spriteScreenX + spriteScreenWidth / 2 + 0.5);
          if (drawRight < 0 || drawLeft >= width) continue;

          const flickerSeed = ((wx * 928371 + wy * 1237) % 1000) / 1000;
          const depthBias = isTorch ? 0.03 : 0.0;

          sprites.push({
            type: isTorch ? 'torch' : 'custom',
            texName: tileName,
            texImg,
            lightX,
            lightY,
            screenX: spriteScreenX,
            drawLeft,
            drawRight,
            drawStartY,
            drawEndY,
            rawDrawStartY,
            rawDrawEndY,
            screenHeight: spriteScreenHeight,
            screenWidth: spriteScreenWidth,
            mountScreenY,
            depth: Math.min(1.0, Math.max(0.0, (safeTransformY - depthBias) / depthFarDepth)),
            baseZ: spriteBaseZ,
            worldHeight: spriteWorldHeight,
            flickerSeed
          });
        }
      }

      // Voxel pass for pillars/custom tiles (depth-tested against raycast walls)
      if (this.voxelProgram && voxelInstances.length > 0) {
        gl.useProgram(this.voxelProgram);
        gl.disable(gl.BLEND);

        const wasCull = gl.isEnabled(gl.CULL_FACE);
        gl.disable(gl.CULL_FACE);

        gl.uniform2f(this.voxelUniforms.resolution, width, height);
        gl.uniform2f(this.voxelUniforms.camPos, camX, camY);
        gl.uniform2f(this.voxelUniforms.camDir, dirX, dirY);
        gl.uniform2f(this.voxelUniforms.plane, planeX, planeY);
        gl.uniform1f(this.voxelUniforms.focalLength, focalLength);
        gl.uniform1f(this.voxelUniforms.eyeZ, eyeZ);
        gl.uniform1f(this.voxelUniforms.depthFarDepth, depthFarDepth);
        if (this.voxelUniforms.depthShadeScale) {
          gl.uniform1f(this.voxelUniforms.depthShadeScale, voxelShadeScale);
        }
        if (this.voxelUniforms.shadowStrength) {
          gl.uniform1f(this.voxelUniforms.shadowStrength, shadowStrengthClamped);
        }
        if (this.voxelUniforms.highlightBoost) {
          gl.uniform1f(this.voxelUniforms.highlightBoost, highlightBoostClamped);
        }
        if (this.voxelUniforms.torchLightScale) {
          gl.uniform1f(this.voxelUniforms.torchLightScale, torchLightScaleClamped);
        }
        if (this.voxelUniforms.gridSize) {
          gl.uniform2i(this.voxelUniforms.gridSize, this.gridW, this.gridH);
        }
        if (this.voxelUniforms.flipY) {
          gl.uniform1i(this.voxelUniforms.flipY, 1);
        }
        let baseVoxelDepthBias = 0.0;
        if (this.voxelUniforms.depthBias) {
          baseVoxelDepthBias = Number.isFinite(window.VOXEL_DEPTH_BIAS)
            ? window.VOXEL_DEPTH_BIAS
            : 0.0;
          gl.uniform1f(this.voxelUniforms.depthBias, baseVoxelDepthBias);
        }
        gl.uniform2f(this.voxelUniforms.lightDir, lighting.dirX, lighting.dirY);
        gl.uniform1f(this.voxelUniforms.lightElev, lighting.elevation);
        gl.uniform1f(this.voxelUniforms.lightIntensity, lighting.intensity);
        if (this.voxelUniforms.torchRadiusScale) {
          gl.uniform1f(this.voxelUniforms.torchRadiusScale, torchRadiusVoxelScaleClamped);
        }
        if (this.voxelUniforms.cells) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
          gl.uniform1i(this.voxelUniforms.cells, 0);
        }

        gl.enableVertexAttribArray(this.voxelAttribs.pos);
        gl.enableVertexAttribArray(this.voxelAttribs.norm);
        gl.enableVertexAttribArray(this.voxelAttribs.color);

        const stride = 9 * 4;
        for (const inst of voxelInstances) {
          if (this.voxelUniforms.torchCount) {
            const centerX = inst.modelPos.x + inst.modelScale.x * 0.5;
            const centerY = inst.modelPos.y + inst.modelScale.y * 0.5;
            const torchData = getTorchUniformData(centerX, centerY, torchRadiusVoxelScaleClamped);
            gl.uniform1i(this.voxelUniforms.torchCount, torchData.count);
            gl.uniform3fv(this.voxelUniforms.torchPos, torchData.posArr);
            gl.uniform1fv(this.voxelUniforms.torchRadius, torchData.radiusArr);
            gl.uniform1fv(this.voxelUniforms.torchIntensity, torchData.intensityArr);
          }
          const passes = inst.mesh.passes || [inst.mesh];
          for (const pass of passes) {
            gl.bindBuffer(gl.ARRAY_BUFFER, pass.vbo);
            gl.vertexAttribPointer(this.voxelAttribs.pos, 3, gl.FLOAT, false, stride, 0);
            gl.vertexAttribPointer(this.voxelAttribs.norm, 3, gl.FLOAT, false, stride, 12);
            gl.vertexAttribPointer(this.voxelAttribs.color, 3, gl.FLOAT, false, stride, 24);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pass.ibo);
            if (pass.depthOnly) {
              gl.colorMask(false, false, false, false);
              gl.depthMask(true);
            } else if (pass.depthTestOnly) {
              gl.colorMask(true, true, true, true);
              gl.depthMask(false);
            } else {
              gl.colorMask(true, true, true, true);
              gl.depthMask(true);
            }
            gl.depthFunc(gl.LEQUAL);
            if (this.voxelUniforms.toneShadow) {
              const shadow = pass.toneShadow || [0.2, 0.2, 0.2];
              const mid = pass.toneMid || [0.5, 0.5, 0.5];
              const high = pass.toneHighlight || [0.9, 0.9, 0.9];
              gl.uniform3f(this.voxelUniforms.toneShadow, shadow[0], shadow[1], shadow[2]);
              gl.uniform3f(this.voxelUniforms.toneMid, mid[0], mid[1], mid[2]);
              gl.uniform3f(this.voxelUniforms.toneHighlight, high[0], high[1], high[2]);
            }
            if (this.voxelUniforms.unlit) {
              gl.uniform1f(this.voxelUniforms.unlit, pass.unlit ? 1.0 : 0.0);
            }
            if (this.voxelUniforms.toonSteps) {
              gl.uniform1f(this.voxelUniforms.toonSteps, Number.isFinite(pass.toonSteps) ? pass.toonSteps : 3.0);
            }
            if (this.voxelUniforms.depthBias) {
              const bias = baseVoxelDepthBias + (Number.isFinite(pass.depthBias) ? pass.depthBias : 0.0);
              gl.uniform1f(this.voxelUniforms.depthBias, bias);
            }
            gl.uniform3f(this.voxelUniforms.modelPos, inst.modelPos.x, inst.modelPos.y, inst.modelPos.z);
            gl.uniform3f(this.voxelUniforms.modelScale, inst.modelScale.x, inst.modelScale.y, inst.modelScale.z);
            gl.drawElements(gl.TRIANGLES, pass.count, gl.UNSIGNED_SHORT, 0);
            if (pass.depthOnly || pass.depthTestOnly) {
              gl.colorMask(true, true, true, true);
              gl.depthMask(true);
            }
          }
        }

        if (wasCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      }

      // Sort by distance (farthest first for correct blending)
      sprites.sort((a, b) => b.depth - a.depth);

      this.buildHaloTexture();
      this.buildFlameTexture();

      gl.useProgram(this.spriteProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.enableVertexAttribArray(this.spriteAttribs.pos);
      gl.enableVertexAttribArray(this.spriteAttribs.uv);
      gl.enableVertexAttribArray(this.spriteAttribs.depth);

      const stride = 5 * 4;
      gl.vertexAttribPointer(this.spriteAttribs.pos, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(this.spriteAttribs.uv, 2, gl.FLOAT, false, stride, 8);
      gl.vertexAttribPointer(this.spriteAttribs.depth, 1, gl.FLOAT, false, stride, 16);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (this.spriteUniforms.shadowStrength) {
        gl.uniform1f(this.spriteUniforms.shadowStrength, shadowStrengthClamped);
      }

      for (const spr of sprites) {
        if (this.spriteUniforms.torchCount) {
          const torchData = spr.type === 'torch'
            ? torchUniformData
            : getTorchUniformData(spr.lightX, spr.lightY, 1.0);
          gl.uniform1i(this.spriteUniforms.torchCount, torchData.count);
          gl.uniform3fv(this.spriteUniforms.torchPos, torchData.posArr);
          gl.uniform1fv(this.spriteUniforms.torchRadius, torchData.radiusArr);
          gl.uniform1fv(this.spriteUniforms.torchIntensity, torchData.intensityArr);
        }
        const tex = spr.texImg ? this.getSpriteTexture(spr.texImg) : null;

        // Main sprite
        if (tex) {
          const meta = (window.dungeonTexturesMeta && spr.texName)
            ? window.dungeonTexturesMeta[spr.texName]
            : null;
          const profile = meta?.profile || (spr.texName === 'pillar' ? 'cylinder' : 'flat');
          const depthAmount = typeof meta?.depth === 'number' ? meta.depth : 0.65;

          // Avoid the "squashed" look when the sprite is clipped by the top of the screen:
          // preserve the *raw* projected bounds and crop UVs to match the visible slice.

          const rawH = Math.max(1, spr.rawDrawEndY - spr.rawDrawStartY);

          // Because getSpriteTexture() uploads with UNPACK_FLIP_Y_WEBGL = true,
          // V=0 is the *top* of the original image and V=1 is the bottom.
          const vAtY = (y) => (y - spr.rawDrawStartY) / rawH; // top=0, bottom=1

          let topV = Math.max(0, Math.min(1, vAtY(spr.drawStartY)));
          let bottomV = Math.max(0, Math.min(1, vAtY(spr.drawEndY)));
          if (spr.type === 'torch') {
            topV = 1 - topV;
            bottomV = 1 - bottomV;
          } else if (spr.texName === 'pillar' || (spr.texName && spr.texName.startsWith('custom_'))) {
            topV = 1 - topV;
            bottomV = 1 - bottomV;
          }

          //const rawH = Math.max(1, spr.rawDrawEndY - spr.rawDrawStartY);
          //const vAtY = (y) => 1 - (y - spr.rawDrawStartY) / rawH; // canvas-style: top=1, bottom=0
          //const topV = Math.max(0, Math.min(1, vAtY(spr.drawStartY)));
          //const bottomV = Math.max(0, Math.min(1, vAtY(spr.drawEndY)));
          const verts = new Float32Array([
            (spr.drawLeft / width) * 2 - 1, 1 - (spr.drawEndY / height) * 2, 0, bottomV, spr.depth,
            (spr.drawRight / width) * 2 - 1, 1 - (spr.drawEndY / height) * 2, 1, bottomV, spr.depth,
            (spr.drawLeft / width) * 2 - 1, 1 - (spr.drawStartY / height) * 2, 0, topV, spr.depth,
            (spr.drawRight / width) * 2 - 1, 1 - (spr.drawStartY / height) * 2, 1, topV, spr.depth
          ]);
          gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(this.spriteUniforms.tex, 0);
          gl.uniform2f(this.spriteUniforms.lightDir, lighting.dirX, lighting.dirY);
          gl.uniform1f(this.spriteUniforms.lightElev, lighting.elevation);
          gl.uniform1f(this.spriteUniforms.lightIntensity, lighting.intensity);
          gl.uniform1f(this.spriteUniforms.profile, (profile === 'cylinder' || profile === 'slab') ? 1.0 : 0.0);
          gl.uniform1f(this.spriteUniforms.depthAmount, depthAmount);
          gl.uniform3f(this.spriteUniforms.spritePos, spr.lightX, spr.lightY, spr.baseZ);
          gl.uniform1f(this.spriteUniforms.spriteHeight, spr.worldHeight || 1.0);
          gl.uniform1f(this.spriteUniforms.spriteVFlip, (spr.texName === 'pillar' || (spr.texName && spr.texName.startsWith('custom_'))) ? 1.0 : 0.0);
          if (this.spriteUniforms.depthShadeScale) {
            gl.uniform1f(this.spriteUniforms.depthShadeScale, spr.type === 'torch' ? 0.0 : depthShadeScale);
          }

          if (spr.type === 'torch') {
            const flicker = torchFlicker(spr.flickerSeed, now);
            gl.uniform1f(this.spriteUniforms.depthAmount, 0.0);
            gl.uniform1f(this.spriteUniforms.spriteHeight, 0.0);
            gl.uniform4f(this.spriteUniforms.tint, flicker * 1.1, flicker * 0.98, flicker * 0.85, 1.0);
          } else {
            gl.uniform4f(this.spriteUniforms.tint, 1.0, 1.0, 1.0, 1.0);
          }
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        if (spr.type !== 'torch') continue;

        const flicker = torchFlicker(spr.flickerSeed, now);
        // Use the same flame sizing math as the canvas pass so it doesn't look huge at distance.
        const rawHeight = Math.max(1, spr.rawDrawEndY - spr.rawDrawStartY);
        const flameCenterY = spr.rawDrawStartY + rawHeight * TORCH_FLAME_RATIO;
        const flameH = Math.max(3, Math.floor(rawHeight * (0.22 + 0.1 * flicker)));
        const flameW = Math.max(2, Math.floor(flameH * 0.55));
        const flameLeft = Math.floor(spr.screenX - flameW / 2);
        const flameRight = flameLeft + flameW;
        const flickerShift = Math.round((flicker - 0.8) * 2);
        const flameBottom = flameCenterY + flickerShift;
        const flameTop = flameBottom - flameH;

        if (flameRight >= 0 && flameLeft < width && flameBottom >= 0 && flameTop < height) {
          const flameDepth = spr.depth - 0.0005;
          const flameVerts = new Float32Array([
            (flameLeft / width) * 2 - 1, 1 - (flameBottom / height) * 2, 0, 1, flameDepth,
            (flameRight / width) * 2 - 1, 1 - (flameBottom / height) * 2, 1, 1, flameDepth,
            (flameLeft / width) * 2 - 1, 1 - (flameTop / height) * 2, 0, 0, flameDepth,
            (flameRight / width) * 2 - 1, 1 - (flameTop / height) * 2, 1, 0, flameDepth
          ]);
          gl.bufferData(gl.ARRAY_BUFFER, flameVerts, gl.STREAM_DRAW);
          gl.bindTexture(gl.TEXTURE_2D, this.flameTex);
          gl.uniform1i(this.spriteUniforms.tex, 0);
          if (this.spriteUniforms.depthShadeScale) {
            gl.uniform1f(this.spriteUniforms.depthShadeScale, 0.0);
          }
          gl.uniform4f(this.spriteUniforms.tint, 1.0, 0.94, 0.78, 0.85 + 0.15 * flicker);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        // Halo (additive, depth-tested)
        if (this.haloTex) {
          const glowRadius = Math.max(4, Math.floor(rawHeight * (0.55 + 0.2 * flicker)));
          const haloSize = Math.min(600, glowRadius * 2);
          const haloLeft = Math.floor(spr.screenX - haloSize / 2);
          const haloRight = haloLeft + haloSize;
          const haloCenterY = flameCenterY;
          const haloTop = haloCenterY - haloSize / 2;
          const haloBottom = haloCenterY + haloSize / 2;

          const haloVerts = new Float32Array([
            (haloLeft / width) * 2 - 1, 1 - (haloBottom / height) * 2, 0, 1, spr.depth - 0.001,
            (haloRight / width) * 2 - 1, 1 - (haloBottom / height) * 2, 1, 1, spr.depth - 0.001,
            (haloLeft / width) * 2 - 1, 1 - (haloTop / height) * 2, 0, 0, spr.depth - 0.001,
            (haloRight / width) * 2 - 1, 1 - (haloTop / height) * 2, 1, 0, spr.depth - 0.001
          ]);

          gl.bufferData(gl.ARRAY_BUFFER, haloVerts, gl.STREAM_DRAW);
          gl.bindTexture(gl.TEXTURE_2D, this.haloTex);
          gl.uniform1i(this.spriteUniforms.tex, 0);
          if (this.spriteUniforms.depthShadeScale) {
            gl.uniform1f(this.spriteUniforms.depthShadeScale, 0.0);
          }

          gl.depthMask(false);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          const glowAlpha = Math.min(0.6, 0.22 + 0.25 * flicker);
          gl.uniform4f(this.spriteUniforms.tint, 1.0, 0.9, 0.7, glowAlpha);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          gl.depthMask(true);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      }

      gl.disable(gl.BLEND);

      const wantsAnimation = torchLights.length > 0 || sprites.some((spr) => spr.type === 'torch');
      if (wantsAnimation && popup.style.display === 'block') {
        if (!window._dungeonAnimPending) {
          window._dungeonAnimPending = true;
          window.setTimeout(() => {
            window._dungeonAnimPending = false;
            if (popup.style.display === 'block' && typeof window.renderDungeonView === 'function') {
              window.renderDungeonView();
            }
          }, 90);
        }
      }

      if (this.miniCanvas && this.miniCtx) {
        this.miniCanvas.width = displayW;
        this.miniCanvas.height = displayH;
        this.miniCtx.clearRect(0, 0, displayW, displayH);

        const miniSize = 4;
        const miniScale = 2;
        const miniX0 = 8;
        const miniY0 = 8;

        for (let dy = -miniScale; dy <= miniScale; dy++) {
          for (let dx = -miniScale; dx <= miniScale; dx++) {
            const mx = playerX + dx;
            const my = playerY + dy;
            const key = `${mx},${my}`;
            const cell = dungeon.cells[key];
            if (!cell) continue;

            let fillStyle = '#003366';
            if (cell.tile === 'wall' || cell.tile === 'door') {
              fillStyle = '#880000';
            }

            const sx = miniX0 + (dx + miniScale) * miniSize;
            const sy = miniY0 + (dy + miniScale) * miniSize;
            this.miniCtx.fillStyle = fillStyle;
            this.miniCtx.fillRect(sx, sy, miniSize, miniSize);
          }
        }

        this.miniCtx.fillStyle = '#00ff00';
        this.miniCtx.fillRect(
          miniX0 + miniScale * miniSize,
          miniY0 + miniScale * miniSize,
          miniSize, miniSize
        );
      }

      if (window.DEBUG_WEBGL_GRID) {
        this.drawDebugOverlay(container, displayW, displayH, dungeon, playerX, playerY, camX, camY);
      } else if (this.debugCanvas) {
        this.debugCanvas.style.display = 'none';
      }
    }
  };

  window.webglDungeonRenderer = renderer;
  window.useWebGLRenderer = true;
  if (typeof window.renderDungeonView === 'function') {
    window.renderDungeonView();
  }
})();
})();
