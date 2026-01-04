(function () {
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

  const MAX_TORCH_LIGHTS = 32;
  const TORCH_LIGHT_RADIUS = 6.0;
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
    haloTex: null,
    flameTex: null,
    customPadCache: {},

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
uniform int u_torchCount;
uniform vec3 u_torchPos[32];
uniform float u_torchRadius[32];
uniform float u_torchIntensity[32];

const int MAX_STEPS = 400;
const int MAX_TORCH = 32;
const float TORCH_FALLOFF = 0.6;
const vec3 TORCH_COLOR = vec3(1.0, 190.0 / 255.0, 130.0 / 255.0);
// Per-surface torch tuning knobs (1.0 = default).
const float TORCH_WALL_BOOST = 1.0;
const float TORCH_SIDE_BOOST = 1.0;
const float TORCH_FLOOR_BOOST = 1.0;

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

// Normal-aware torch lighting (half-Lambert for better wall self-illumination)
float accumulateTorchLit(vec3 worldPos, vec3 normal) {
  float total = 0.0;
  for (int i = 0; i < MAX_TORCH; i++) {
    if (i >= u_torchCount) break;
    vec3 toL = u_torchPos[i] - worldPos;
    float dist = length(toL);
    if (dist >= u_torchRadius[i]) continue;
    vec3 L = normalize(toL);
    float ndotl_raw = dot(L, normal);
    float ndotl = ndotl_raw * 0.5 + 0.5;  // half-Lambert
    ndotl = max(0.0, ndotl);             // prevent lighting if far behind
    float falloff = 1.0 - dist / u_torchRadius[i];
    total += ndotl * falloff * falloff * u_torchIntensity[i] * TORCH_FALLOFF;
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

          vec3 worldPos = vec3(u_camPos + rayDir * nextDist, bottomZ + world_v);
          float lit = clamp(accumulateTorchLit(worldPos, normal), 0.0, 1.0);
          float litSide = clamp(lit * TORCH_SIDE_BOOST, 0.0, 1.5);

          float shade = max(0.3, 1.0 - nextDist / 10.0);
          float base = shade + litSide * 0.6;
          float warmShift = 0.75 + 0.45 * litSide;
          vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * litSide;
          vec3 col = tex.rgb * base + torchAdd;

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
        float shade = max(0.3, 1.0 - perpDist / 10.0);
        float sideFactor = (side == 0) ? 1.0 : 0.85;
        vec2 normal2D = (side == 0) ? vec2(float(stepX), 0.0) : vec2(0.0, float(stepY));
        float dotLight = dot(normal2D, u_lightDir);
        float lightFactor = 0.6 + 0.4 * dotLight;
        float litShade = shade * sideFactor * (1.0 - u_lightIntensity + u_lightIntensity * lightFactor);
        float grad = max(0.35, 1.0 - 0.18 * globalV);
        float rowShade = litShade * grad;

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
        float lit = clamp(accumulateTorchLit(exactWorldPos, wallNormalTorch), 0.0, 1.0);
        float litWall = clamp(lit * TORCH_WALL_BOOST, 0.0, 1.5);

        // rest unchanged
        float base = rowShade + litWall * 0.6;
        float warmShift = 0.75 + 0.45 * litWall;
        vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * litWall;

        vec3 finalCol = tex.rgb * base + torchAdd;

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
    float lit = clamp(accumulateTorchLit(hitPos, normal), 0.0, 1.0);
    float litFloor = clamp(lit * TORCH_FLOOR_BOOST, 0.0, 1.5);

    float shade = max(0.3, 1.0 - floorDist / 10.0);
    float base = shade + litFloor * 0.6;
    float warmShift = 0.75 + 0.45 * litFloor;
    vec3 torchAdd = TORCH_COLOR * vec3(0.35, 0.25 * warmShift, 0.2 * warmShift) * litFloor;

    outColor = vec4(tex.rgb * base + torchAdd, 1.0);
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
        'out vec4 outColor;',
        'void main() {',
        '  vec4 tex = texture(u_tex, v_uv);',
        '  if (tex.a < 0.01) discard;',
        '  outColor = tex * u_tint;',
        '  gl_FragDepth = v_depth;',
        '}'
      ].join('\n');

      this.spriteProgram = createProgram(gl, spriteVs, spriteFs);
      if (!this.spriteProgram) return false;
      this.spriteAttribs = {
        pos: gl.getAttribLocation(this.spriteProgram, 'a_pos'),
        uv: gl.getAttribLocation(this.spriteProgram, 'a_uv'),
        depth: gl.getAttribLocation(this.spriteProgram, 'a_depth')
      };
      this.spriteUniforms = {
        tex: gl.getUniformLocation(this.spriteProgram, 'u_tex'),
        tint: gl.getUniformLocation(this.spriteProgram, 'u_tint')
      };
      this.spriteBuffer = gl.createBuffer();

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
            tile === 'pillar' ||
            isDoorClosed;

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
          data[idx + 3] = isSolid ? 255 : 0;
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

      const isWallTile = (tile) => ['wall', 'door', 'pillar', 'torch'].includes(tile);
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
            radius: TORCH_LIGHT_RADIUS,
            intensity: Math.max(0.25, Math.min(1.15, flicker)),
            dist2: dxl * dxl + dyl * dyl
          });
        }
      }

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
      if (this.uniformLocations.torchCount) {
        torchLights.sort((a, b) => a.dist2 - b.dist2);
        const count = Math.min(torchLights.length, MAX_TORCH_LIGHTS);
        const posArr = new Float32Array(MAX_TORCH_LIGHTS * 3);
        const colorArr = new Float32Array(MAX_TORCH_LIGHTS * 3);
        const radiusArr = new Float32Array(MAX_TORCH_LIGHTS);
        const intensityArr = new Float32Array(MAX_TORCH_LIGHTS);
        for (let i = 0; i < count; i++) {
          const t = torchLights[i];
          const bi = i * 3;
          posArr[bi] = t.x;
          posArr[bi + 1] = t.y;
          posArr[bi + 2] = t.z;
          colorArr[bi] = TORCH_LIGHT_COLOR.r / 255;
          colorArr[bi + 1] = TORCH_LIGHT_COLOR.g / 255;
          colorArr[bi + 2] = TORCH_LIGHT_COLOR.b / 255;
          radiusArr[i] = t.radius;
          intensityArr[i] = t.intensity;
        }
        gl.uniform1i(this.uniformLocations.torchCount, count);
        gl.uniform3fv(this.uniformLocations.torchPos, posArr);
        gl.uniform3fv(this.uniformLocations.torchColor, colorArr);
        gl.uniform1fv(this.uniformLocations.torchRadius, radiusArr);
        gl.uniform1fv(this.uniformLocations.torchIntensity, intensityArr);
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
          const isTorch = cell.tile === 'torch';
          const isCustom = cell.tile.startsWith && cell.tile.startsWith('custom_');
          if (!isTorch && !isCustom) continue;

          const tileName = cell.tile;
          const texImg = window.dungeonTextures && window.dungeonTextures[tileName];
          if (!isTorch && (!texImg || !texImg.complete)) continue;

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

          const floorH = typeof cell.floorHeight === 'number' ? cell.floorHeight : 0;
          const ceilH = typeof cell.ceilHeight === 'number' ? cell.ceilHeight : floorH + 2;
          let spriteWorldHeight = SPRITE_WORLD_HEIGHT;
          let spriteWidthRatio = SPRITE_WIDTH_RATIO;
          let spriteBaseZ = floorH; // Mount point Z
          if (isTorch) {
            spriteWorldHeight = TORCH_WORLD_HEIGHT;
            spriteWidthRatio = TORCH_WIDTH_RATIO;
            spriteBaseZ = floorH + (ceilH - floorH) * TORCH_MOUNT_RATIO;
          } else if (ceilH > floorH) {
            spriteWorldHeight = Math.max(0.5, ceilH - floorH);
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
            const padRatio = this.getBottomPadRatio(texImg);
            const padPx = Math.floor(spriteScreenHeight * padRatio);
            rawDrawStartY += padPx;
            rawDrawEndY += padPx;
          }

          const drawStartY = Math.max(0, rawDrawStartY);
          const drawEndY = Math.min(height, rawDrawEndY);
          if (drawStartY >= drawEndY) continue;

          const drawLeft = Math.floor(spriteScreenX - spriteScreenWidth / 2);
          const drawRight = Math.floor(spriteScreenX + spriteScreenWidth / 2);
          if (drawRight < 0 || drawLeft >= width) continue;

          const flickerSeed = ((wx * 928371 + wy * 1237) % 1000) / 1000;
          const depthBias = isTorch ? 0.03 : 0.0;

          sprites.push({
            type: isTorch ? 'torch' : 'custom',
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
            flickerSeed
          });
        }
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

      for (const spr of sprites) {
        const tex = spr.texImg ? this.getSpriteTexture(spr.texImg) : null;

        // Main sprite
        if (tex) {
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

          if (spr.type === 'torch') {
            const flicker = torchFlicker(spr.flickerSeed, now);
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

