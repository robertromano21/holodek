(function () {
  const legacyRenderer = window.webglDungeonRenderer;
  if (!legacyRenderer || typeof legacyRenderer.init !== 'function' || typeof legacyRenderer.renderScene !== 'function') {
    return;
  }
  if (typeof window.WEBGPU_DRIVE_SPRITE_VOXEL_TORCH === 'undefined') {
    window.WEBGPU_DRIVE_SPRITE_VOXEL_TORCH = true;
  }
  if (typeof window.WEBGPU_DRIVE_VOXEL_TORCH === 'undefined') {
    window.WEBGPU_DRIVE_VOXEL_TORCH = true;
  }
  if (typeof window.WEBGPU_BLOOM === 'undefined') {
    window.WEBGPU_BLOOM = true;
  }
  if (typeof window.WEBGPU_POST_TORCH_MASK === 'undefined') {
    window.WEBGPU_POST_TORCH_MASK = false;
  }
  if (typeof window.WEBGPU_GPU_HALO_FLAME === 'undefined') {
    window.WEBGPU_GPU_HALO_FLAME = false;
  }
  if (typeof window.WEBGPU_GPU_HALO_FLAME_INTENSITY === 'undefined') {
    window.WEBGPU_GPU_HALO_FLAME_INTENSITY = 1.0;
  }
  if (typeof window.WEBGPU_GPU_VOXEL_MESHING === 'undefined') {
    window.WEBGPU_GPU_VOXEL_MESHING = true;
  }

  const DISPLAY_W = 640;
  const DISPLAY_H = 480;
  const PIXEL_SCALE = 4;
  const LOW_RES_W = Math.max(1, Math.floor(DISPLAY_W / PIXEL_SCALE));
  const LOW_RES_H = Math.max(1, Math.floor(DISPLAY_H / PIXEL_SCALE));
  const TORCH_BUFFER_STRIDE_FLOATS = 8; // vec4 pos/radius + vec4 intensity/color
  const RECT_BUFFER_STRIDE_FLOATS = 4; // vec4 x0,y0,x1,y1
  const TORCH_SPRITE_BUFFER_STRIDE_FLOATS = 8; // vec4 screen/depth + vec4 view/flicker/facing/pad
  const VOXEL_VERTEX_STRIDE_FLOATS = 9; // pos3 + norm3 + color3
  const TORCH_LIGHT_DEFAULT_COLOR = { r: 255, g: 190, b: 130 };

  function getTorchBufferCapacity() {
    const raw = Number(window.WEBGPU_MAX_TORCH_LIGHTS);
    if (!Number.isFinite(raw)) return 4096;
    return Math.max(64, Math.min(8192, Math.floor(raw)));
  }

  function getTorchBlend() {
    const raw = Number(window.WEBGPU_TORCH_BLEND);
    if (!Number.isFinite(raw)) return 0.0;
    return Math.max(0.0, Math.min(2.0, raw));
  }

  function getSpriteVoxelRectCapacity() {
    const raw = Number(window.WEBGPU_MAX_SPRITE_VOXEL_RECTS);
    if (!Number.isFinite(raw)) return 4096;
    return Math.max(256, Math.min(16384, Math.floor(raw)));
  }

  function getSpriteVoxelTorchBlend() {
    const raw = Number(window.WEBGPU_SPRITE_VOXEL_TORCH_BLEND);
    if (!Number.isFinite(raw)) return 0.12;
    return Math.max(0.0, Math.min(2.0, raw));
  }

  function isPostTorchMaskEnabled() {
    return window.WEBGPU_POST_TORCH_MASK === true;
  }

  function isBloomEnabled() {
    return window.WEBGPU_BLOOM !== false;
  }

  function getBloomIntensity() {
    const raw = Number(window.WEBGPU_BLOOM_INTENSITY);
    if (!Number.isFinite(raw)) return 0.1;
    return Math.max(0.0, Math.min(3.0, raw));
  }

  function getBloomThreshold() {
    const raw = Number(window.WEBGPU_BLOOM_THRESHOLD);
    if (!Number.isFinite(raw)) return 0.77;
    return Math.max(0.0, Math.min(1.0, raw));
  }

  function getBloomDownsample() {
    const raw = Number(window.WEBGPU_BLOOM_DOWNSAMPLE);
    if (!Number.isFinite(raw)) return 3;
    return Math.max(1, Math.min(4, Math.floor(raw)));
  }

  function getBloomWarmBoost() {
    const raw = Number(window.WEBGPU_BLOOM_WARM_BOOST);
    if (!Number.isFinite(raw)) return 0.18;
    return Math.max(0.0, Math.min(2.0, raw));
  }

  function isGpuHaloFlameEnabled() {
    return window.WEBGPU_GPU_HALO_FLAME === true;
  }

  function getGpuHaloFlameIntensity() {
    const raw = Number(window.WEBGPU_GPU_HALO_FLAME_INTENSITY);
    if (!Number.isFinite(raw)) return 1.0;
    return Math.max(0.0, Math.min(2.0, raw));
  }

  function isGpuVoxelMeshingEnabled() {
    return window.WEBGPU_GPU_VOXEL_MESHING !== false;
  }

  const fullscreenWgsl = `
const MAX_SHADER_TORCH : u32 = 512u;
const MAX_SHADER_RECTS : u32 = 768u;

struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

struct TorchParams {
  resolution : vec2<f32>,
  camPos : vec2<f32>,
  camDir : vec2<f32>,
  plane : vec2<f32>,
  focalLength : f32,
  eyeZ : f32,
  torchBlend : f32,
  torchCount : u32,
  spriteVoxelBlend : f32,
  rectCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct TorchLight {
  posRad : vec4<f32>,         // xyz + radius
  intensityColor : vec4<f32>, // intensity + rgb
};

struct ProjectedTorch {
  screenRad : vec4<f32>,      // x, y, depth, radialNorm
  intensityColor : vec4<f32>, // intensity + rgb
};

struct ScreenRect {
  bounds : vec4<f32>, // x0,y0,x1,y1 in normalized uv space
};

struct PostParams {
  bloomIntensity : f32,
  bloomEnabled : f32,
  _pad0 : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var frameTex : texture_2d<f32>;
@group(0) @binding(1) var frameSamp : sampler;
@group(0) @binding(2) var<uniform> params : TorchParams;
@group(0) @binding(3) var<storage, read> torchLights : array<TorchLight>;
@group(0) @binding(4) var<storage, read> spriteVoxelRects : array<ScreenRect>;
@group(0) @binding(5) var bloomTex : texture_2d<f32>;
@group(0) @binding(6) var bloomSamp : sampler;
@group(0) @binding(7) var<uniform> postParams : PostParams;
@group(0) @binding(8) var<storage, read> projectedTorches : array<ProjectedTorch>;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var out : VsOut;
  out.pos = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = uv[vertexIndex];
  return out;
}

fn projectTorch(torchPos : vec3<f32>) -> vec3<f32> {
  let rel = torchPos.xy - params.camPos;
  let invDet = 1.0 / max(1e-6, params.plane.x * params.camDir.y - params.camDir.x * params.plane.y);
  let transformX = invDet * (params.camDir.y * rel.x - params.camDir.x * rel.y);
  let transformY = invDet * (-params.plane.y * rel.x + params.plane.x * rel.y);
  if (transformY <= 0.05) {
    return vec3<f32>(-10.0, -10.0, transformY);
  }
  let screenX = 0.5 * (1.0 + transformX / transformY);
  let screenY = 0.5 - ((torchPos.z - params.eyeZ) * params.focalLength / transformY) / params.resolution.y;
  return vec3<f32>(screenX, screenY, transformY);
}

fn spriteVoxelMask(uv : vec2<f32>) -> f32 {
  let rectCount = min(params.rectCount, MAX_SHADER_RECTS);
  if (rectCount == 0u) {
    return 0.0;
  }
  var mask = 0.0;
  for (var i : u32 = 0u; i < MAX_SHADER_RECTS; i = i + 1u) {
    if (i >= rectCount) {
      break;
    }
    let b = spriteVoxelRects[i].bounds;
    if (uv.x < b.x || uv.x > b.z || uv.y < b.y || uv.y > b.w) {
      continue;
    }
    let center = vec2<f32>(0.5 * (b.x + b.z), 0.5 * (b.y + b.w));
    let halfSize = vec2<f32>(max(0.0005, 0.5 * (b.z - b.x)), max(0.0005, 0.5 * (b.w - b.y)));
    let radius = max(0.0005, min(halfSize.x, halfSize.y) * 0.32);
    let inner = max(halfSize - vec2<f32>(radius, radius), vec2<f32>(0.0001, 0.0001));
    let d = abs(uv - center) - inner;
    let outside = length(max(d, vec2<f32>(0.0, 0.0))) - radius;
    let inside = min(max(d.x, d.y), 0.0);
    let sdf = outside + inside;
    let feather = max(0.002, min(halfSize.x, halfSize.y) * 0.22);
    let localMask = 1.0 - smoothstep(0.0, feather, sdf);
    mask = max(mask, localMask);
  }
  return mask;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4<f32> {
  let base = textureSample(frameTex, frameSamp, in.uv);
  let torchCount = min(params.torchCount, MAX_SHADER_TORCH);
  var mixedRgb = base.rgb;
  if (torchCount > 0u && (params.torchBlend > 0.0001 || params.spriteVoxelBlend > 0.0001)) {
    let spriteMask = spriteVoxelMask(in.uv);
    let blend = params.torchBlend + params.spriteVoxelBlend * spriteMask;
    if (blend > 0.0001) {
      let aspect = max(0.25, params.resolution.x / max(1.0, params.resolution.y));
      var torchAdd = vec3<f32>(0.0, 0.0, 0.0);
      for (var i : u32 = 0u; i < MAX_SHADER_TORCH; i = i + 1u) {
        if (i >= torchCount) {
          break;
        }
        let t = projectedTorches[i];
        let p = t.screenRad.xyz;
        if (p.z <= 0.05) {
          continue;
        }
        let radialNorm = max(0.002, t.screenRad.w);
        let toFrag = in.uv - p.xy;
        let d = vec2<f32>(toFrag.x / (radialNorm / aspect), toFrag.y / radialNorm);
        let dist = length(d);
        let soft = max(0.0, 1.0 - dist);
        let glow = soft * soft * (0.65 + 0.35 * soft);
        let intensity = max(0.0, t.intensityColor.x);
        let warm = t.intensityColor.yzw;
        torchAdd += warm * glow * intensity;
      }
      mixedRgb = clamp(mixedRgb + torchAdd * blend, vec3<f32>(0.0), vec3<f32>(1.0));
    }
  }
  if (postParams.bloomEnabled > 0.5 && postParams.bloomIntensity > 0.0001) {
    let bloom = textureSampleLevel(bloomTex, bloomSamp, in.uv, 0.0).rgb;
    mixedRgb = clamp(mixedRgb + bloom * postParams.bloomIntensity, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(mixedRgb, base.a);
}
`;

  const torchProjectWgsl = `
const MAX_SHADER_TORCH : u32 = 512u;

struct TorchParams {
  resolution : vec2<f32>,
  camPos : vec2<f32>,
  camDir : vec2<f32>,
  plane : vec2<f32>,
  focalLength : f32,
  eyeZ : f32,
  torchBlend : f32,
  torchCount : u32,
  spriteVoxelBlend : f32,
  rectCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct TorchLight {
  posRad : vec4<f32>,         // xyz + radius
  intensityColor : vec4<f32>, // intensity + rgb
};

struct ProjectedTorch {
  screenRad : vec4<f32>,      // x, y, depth, radialNorm
  intensityColor : vec4<f32>, // intensity + rgb
};

@group(0) @binding(0) var<uniform> params : TorchParams;
@group(0) @binding(1) var<storage, read> torchLights : array<TorchLight>;
@group(0) @binding(2) var<storage, read_write> projectedTorches : array<ProjectedTorch>;

fn projectTorch(torchPos : vec3<f32>) -> vec3<f32> {
  let rel = torchPos.xy - params.camPos;
  let invDet = 1.0 / max(1e-6, params.plane.x * params.camDir.y - params.camDir.x * params.plane.y);
  let transformX = invDet * (params.camDir.y * rel.x - params.camDir.x * rel.y);
  let transformY = invDet * (-params.plane.y * rel.x + params.plane.x * rel.y);
  if (transformY <= 0.05) {
    return vec3<f32>(-10.0, -10.0, transformY);
  }
  let screenX = 0.5 * (1.0 + transformX / transformY);
  let screenY = 0.5 - ((torchPos.z - params.eyeZ) * params.focalLength / transformY) / params.resolution.y;
  return vec3<f32>(screenX, screenY, transformY);
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= MAX_SHADER_TORCH) {
    return;
  }
  var outProj : ProjectedTorch;
  outProj.screenRad = vec4<f32>(-10.0, -10.0, -1.0, 0.0);
  outProj.intensityColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  if (i < params.torchCount) {
    let t = torchLights[i];
    let p = projectTorch(t.posRad.xyz);
    let radialNorm = max(0.002, (t.posRad.w / max(0.1, p.z)) * (params.focalLength / params.resolution.y));
    outProj.screenRad = vec4<f32>(p, radialNorm);
    outProj.intensityColor = t.intensityColor;
  }
  projectedTorches[i] = outProj;
}
`;

  const haloFlameWgsl = `
const TORCH_FLAME_RATIO : f32 = 0.4;
const TORCH_HALO_DEPTH_PUSH : f32 = 0.00035;
const TORCH_FLAME_DEPTH_BIAS : f32 = 0.00025;

struct HaloParams {
  resolution : vec2<f32>,
  timeSec : f32,
  passKind : f32,  // 0 = flame, 1 = halo
  intensity : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

struct TorchSprite {
  screenDepth : vec4<f32>, // screenX, rawStartY, rawEndY, depth
  params : vec4<f32>,      // viewDist, flickerSeed, wallFacing(0/1), pad
};

struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) flicker : f32,
  @location(2) wallFacing : f32,
  @location(3) viewDist : f32,
};

@group(0) @binding(0) var<uniform> halo : HaloParams;
@group(0) @binding(1) var<storage, read> torchSprites : array<TorchSprite>;

fn torchFlicker(seed : f32, timeSec : f32) -> f32 {
  let t = timeSec * 0.6;
  let speedMod = 0.65
    + 0.25 * sin(t * (0.35 + seed * 0.12) + seed * 5.1)
    + 0.1 * sin(t * (0.07 + seed * 0.03) + seed * 17.3);
  let tt = t * speedMod;
  let base = 0.72 + 0.08 * sin(tt * (1.1 + seed * 0.4) + seed * 9.7);
  let pulse = pow(max(0.0, sin(tt * (3.6 + seed * 1.4) + seed * 13.3)), 2.0) * 0.22;
  let crackle = pow(max(0.0, sin(tt * (9.5 + seed * 3.1) + seed * 27.1)), 3.0) * 0.12;
  let jitter = sin(tt * (17.0 + seed * 5.7) + seed * 41.0) * 0.04;
  return base + pulse + crackle + jitter;
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>( 1.0, -1.0)
  );
  let uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0)
  );

  let spr = torchSprites[instanceIndex];
  let screenX = spr.screenDepth.x;
  let rawStartY = spr.screenDepth.y;
  let rawEndY = spr.screenDepth.z;
  let baseDepth = spr.screenDepth.w;
  let viewDist = spr.params.x;
  let flickerSeed = spr.params.y;
  let wallFacing = spr.params.z;

  let rawHeight = max(1.0, rawEndY - rawStartY);
  let flicker = torchFlicker(flickerSeed, halo.timeSec);
  let flameCenterY = rawStartY + rawHeight * TORCH_FLAME_RATIO;

  var centerY = flameCenterY;
  var halfW : f32;
  var halfH : f32;
  var depth = baseDepth;
  if (halo.passKind > 0.5) {
    let glowRadius = max(4.0, floor(rawHeight * (0.55 + 0.2 * flicker)));
    let haloSize = min(600.0, glowRadius * 2.0);
    halfW = haloSize * 0.5;
    halfH = haloSize * 0.5;
    depth = min(1.0, baseDepth + TORCH_HALO_DEPTH_PUSH);
  } else {
    let flameH = max(3.0, floor(rawHeight * (0.22 + 0.1 * flicker)));
    let flameW = max(2.0, floor(flameH * 0.55));
    let flickerShift = round((flicker - 0.8) * 2.0);
    let flameBottom = flameCenterY + flickerShift;
    let flameTop = flameBottom - flameH;
    centerY = 0.5 * (flameBottom + flameTop);
    halfW = flameW * 0.5;
    halfH = flameH * 0.5;
    depth = max(0.0, baseDepth - TORCH_FLAME_DEPTH_BIAS);
  }

  let corner = corners[vertexIndex];
  let px = screenX + corner.x * halfW;
  let py = centerY + corner.y * halfH;
  let ndcX = (px / max(1.0, halo.resolution.x)) * 2.0 - 1.0;
  let ndcY = 1.0 - (py / max(1.0, halo.resolution.y)) * 2.0;

  var out : VsOut;
  out.pos = vec4<f32>(ndcX, ndcY, depth * 2.0 - 1.0, 1.0);
  out.uv = uvs[vertexIndex];
  out.flicker = flicker;
  out.wallFacing = wallFacing;
  out.viewDist = viewDist;
  return out;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4<f32> {
  if (halo.passKind > 0.5) {
    let p = in.uv * 2.0 - vec2<f32>(1.0, 1.0);
    let dist = length(p);
    let soft = max(0.0, 1.0 - dist);
    let glow = soft * soft * (0.65 + 0.35 * soft);
    let wallScale = mix(0.92, 1.0, clamp(in.wallFacing, 0.0, 1.0));
    let depthScale = clamp(1.3 - in.viewDist * 0.025, 0.45, 1.0);
    let alpha = clamp((0.22 + 0.25 * in.flicker) * glow * wallScale * depthScale * halo.intensity, 0.0, 1.0);
    return vec4<f32>(vec3<f32>(1.0, 0.9, 0.7) * alpha, alpha);
  }

  let x = (in.uv.x - 0.5) / 0.52;
  let y = in.uv.y;
  let core = 1.0 - smoothstep(0.0, 1.0, length(vec2<f32>(x * 1.15, (y - 0.55) / 0.6)));
  let tip = 1.0 - smoothstep(0.0, 1.0, length(vec2<f32>(x * 1.7, (y - 0.08) / 0.36)));
  let shape = max(core, tip * 0.95);
  let alpha = clamp(shape * (0.85 + 0.15 * in.flicker) * halo.intensity, 0.0, 1.0);
  let warm = mix(vec3<f32>(1.0, 0.45, 0.08), vec3<f32>(1.0, 0.94, 0.78), clamp(1.0 - y, 0.0, 1.0));
  return vec4<f32>(warm * alpha, alpha);
}
`;

  const bloomBlurWgsl = `
struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

struct BlurParams {
  texelSize : vec2<f32>,
  direction : vec2<f32>,
  threshold : f32,
  applyThreshold : f32,
  warmBoost : f32,
  _pad0 : f32,
};

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var srcSamp : sampler;
@group(0) @binding(2) var<uniform> blur : BlurParams;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  var out : VsOut;
  out.pos = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = uv[vertexIndex];
  return out;
}

fn thresholdColor(c : vec3<f32>) -> vec3<f32> {
  if (blur.applyThreshold > 0.5) {
    let bright = max(c.r, max(c.g, c.b));
    let extracted = max(bright - blur.threshold, 0.0);
    if (extracted <= 0.00001) {
      return vec3<f32>(0.0);
    }
    let rgWarm = smoothstep(0.02, 0.22, c.r - c.g);
    let gbWarm = smoothstep(0.01, 0.25, c.g - c.b);
    let torchHue = rgWarm * gbWarm;
    let hueGate = 0.3 + 0.7 * torchHue;
    let norm = extracted / max(bright, 0.0001);
    let warmBoost = 1.0 + torchHue * blur.warmBoost;
    return c * norm * hueGate * warmBoost;
  }
  return c;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4<f32> {
  let step = blur.direction * blur.texelSize;
  let w0 = 0.22702703;
  let w1 = 0.19459459;
  let w2 = 0.12162162;
  let w3 = 0.05405405;
  let w4 = 0.01621622;
  var sum = thresholdColor(textureSample(srcTex, srcSamp, in.uv).rgb) * w0;

  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv + step * 1.0).rgb) * w1;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv - step * 1.0).rgb) * w1;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv + step * 2.0).rgb) * w2;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv - step * 2.0).rgb) * w2;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv + step * 3.0).rgb) * w3;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv - step * 3.0).rgb) * w3;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv + step * 4.0).rgb) * w4;
  sum += thresholdColor(textureSample(srcTex, srcSamp, in.uv - step * 4.0).rgb) * w4;

  return vec4<f32>(sum, 1.0);
}
`;

  const voxelSimpleMeshWgsl = `
struct MeshParams {
  size : u32,
  maxFaces : u32,
  seamPad : f32,
  cylStrength : f32,
  color : vec4<f32>,
};

struct FaceCounter {
  count : atomic<u32>,
};

@group(0) @binding(0) var<uniform> params : MeshParams;
@group(0) @binding(1) var<storage, read> voxels : array<u32>;
@group(0) @binding(2) var<storage, read_write> vertexOut : array<f32>;
@group(0) @binding(3) var<storage, read_write> indexOut : array<u32>;
@group(0) @binding(4) var<storage, read_write> faceCounter : FaceCounter;

fn voxelIndex(x : i32, y : i32, z : i32, size : i32) -> u32 {
  return u32(x + y * size + z * size * size);
}

fn getVoxel(x : i32, y : i32, z : i32, size : i32) -> u32 {
  if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) {
    return 0u;
  }
  return voxels[voxelIndex(x, y, z, size)];
}

fn applySeam(coord : f32, axisIsNormal : bool, sizeF : f32) -> f32 {
  if (axisIsNormal || params.seamPad <= 0.000001) {
    return coord;
  }
  let isIntegral = abs(coord - floor(coord)) <= 0.000001;
  let delta = select(params.seamPad, -params.seamPad, isIntegral);
  return clamp(coord + delta, 0.0, sizeF);
}

fn blendCylindricalNormal(pos : vec3<f32>, normal : vec3<f32>, sizeF : f32) -> vec3<f32> {
  let strength = clamp(params.cylStrength, 0.0, 1.0);
  if (strength <= 0.0001 || abs(normal.z) > 0.5) {
    return normal;
  }
  let center = vec2<f32>(0.5 * sizeF, 0.5 * sizeF);
  let delta = pos.xy - center;
  let r2 = dot(delta, delta);
  if (r2 <= 1e-6) {
    return normal;
  }
  let radial = normalize(vec3<f32>(delta.x, delta.y, 0.0));
  return normalize(normal * (1.0 - strength) + radial * strength);
}

fn writeVertex(vertexIndex : u32, pos : vec3<f32>, normal : vec3<f32>, sizeF : f32) {
  let base = vertexIndex * 9u;
  let blendedNormal = blendCylindricalNormal(pos, normal, sizeF);
  vertexOut[base + 0u] = pos.x / sizeF;
  vertexOut[base + 1u] = pos.y / sizeF;
  vertexOut[base + 2u] = pos.z / sizeF;
  vertexOut[base + 3u] = blendedNormal.x;
  vertexOut[base + 4u] = blendedNormal.y;
  vertexOut[base + 5u] = blendedNormal.z;
  vertexOut[base + 6u] = params.color.x;
  vertexOut[base + 7u] = params.color.y;
  vertexOut[base + 8u] = params.color.z;
}

fn emitFace(x : i32, y : i32, z : i32, dir : u32, sizeF : f32) {
  let faceIndex = atomicAdd(&faceCounter.count, 1u);
  if (faceIndex >= params.maxFaces) {
    return;
  }

  var p0 = vec3<f32>(0.0);
  var p1 = vec3<f32>(0.0);
  var p2 = vec3<f32>(0.0);
  var p3 = vec3<f32>(0.0);
  var normal = vec3<f32>(0.0);

  if (dir == 0u) {
    normal = vec3<f32>(1.0, 0.0, 0.0);
    p0 = vec3<f32>(f32(x + 1), f32(y), f32(z));
    p1 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z));
    p2 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z + 1));
    p3 = vec3<f32>(f32(x + 1), f32(y), f32(z + 1));
  } else if (dir == 1u) {
    normal = vec3<f32>(-1.0, 0.0, 0.0);
    p0 = vec3<f32>(f32(x), f32(y), f32(z + 1));
    p1 = vec3<f32>(f32(x), f32(y + 1), f32(z + 1));
    p2 = vec3<f32>(f32(x), f32(y + 1), f32(z));
    p3 = vec3<f32>(f32(x), f32(y), f32(z));
  } else if (dir == 2u) {
    normal = vec3<f32>(0.0, 1.0, 0.0);
    p0 = vec3<f32>(f32(x), f32(y + 1), f32(z));
    p1 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z));
    p2 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z + 1));
    p3 = vec3<f32>(f32(x), f32(y + 1), f32(z + 1));
  } else if (dir == 3u) {
    normal = vec3<f32>(0.0, -1.0, 0.0);
    p0 = vec3<f32>(f32(x), f32(y), f32(z + 1));
    p1 = vec3<f32>(f32(x + 1), f32(y), f32(z + 1));
    p2 = vec3<f32>(f32(x + 1), f32(y), f32(z));
    p3 = vec3<f32>(f32(x), f32(y), f32(z));
  } else if (dir == 4u) {
    normal = vec3<f32>(0.0, 0.0, 1.0);
    p0 = vec3<f32>(f32(x), f32(y), f32(z + 1));
    p1 = vec3<f32>(f32(x + 1), f32(y), f32(z + 1));
    p2 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z + 1));
    p3 = vec3<f32>(f32(x), f32(y + 1), f32(z + 1));
  } else {
    normal = vec3<f32>(0.0, 0.0, -1.0);
    p0 = vec3<f32>(f32(x), f32(y + 1), f32(z));
    p1 = vec3<f32>(f32(x + 1), f32(y + 1), f32(z));
    p2 = vec3<f32>(f32(x + 1), f32(y), f32(z));
    p3 = vec3<f32>(f32(x), f32(y), f32(z));
  }

  let axisX = abs(normal.x) > 0.5;
  let axisY = abs(normal.y) > 0.5;
  let axisZ = abs(normal.z) > 0.5;
  p0 = vec3<f32>(
    applySeam(p0.x, axisX, sizeF),
    applySeam(p0.y, axisY, sizeF),
    applySeam(p0.z, axisZ, sizeF)
  );
  p1 = vec3<f32>(
    applySeam(p1.x, axisX, sizeF),
    applySeam(p1.y, axisY, sizeF),
    applySeam(p1.z, axisZ, sizeF)
  );
  p2 = vec3<f32>(
    applySeam(p2.x, axisX, sizeF),
    applySeam(p2.y, axisY, sizeF),
    applySeam(p2.z, axisZ, sizeF)
  );
  p3 = vec3<f32>(
    applySeam(p3.x, axisX, sizeF),
    applySeam(p3.y, axisY, sizeF),
    applySeam(p3.z, axisZ, sizeF)
  );

  let baseVertex = faceIndex * 4u;
  let baseIndex = faceIndex * 6u;
  writeVertex(baseVertex + 0u, p0, normal, sizeF);
  writeVertex(baseVertex + 1u, p1, normal, sizeF);
  writeVertex(baseVertex + 2u, p2, normal, sizeF);
  writeVertex(baseVertex + 3u, p3, normal, sizeF);

  indexOut[baseIndex + 0u] = baseVertex + 0u;
  indexOut[baseIndex + 1u] = baseVertex + 1u;
  indexOut[baseIndex + 2u] = baseVertex + 2u;
  indexOut[baseIndex + 3u] = baseVertex + 0u;
  indexOut[baseIndex + 4u] = baseVertex + 2u;
  indexOut[baseIndex + 5u] = baseVertex + 3u;
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = i32(params.size);
  let voxelCount = params.size * params.size * params.size;
  if (gid.x >= voxelCount || size <= 0) {
    return;
  }
  if (voxels[gid.x] == 0u) {
    return;
  }

  let layer = size * size;
  let linear = i32(gid.x);
  let z = linear / layer;
  let rem = linear - z * layer;
  let y = rem / size;
  let x = rem - y * size;
  let sizeF = f32(size);

  if (getVoxel(x + 1, y, z, size) == 0u) { emitFace(x, y, z, 0u, sizeF); }
  if (getVoxel(x - 1, y, z, size) == 0u) { emitFace(x, y, z, 1u, sizeF); }
  if (getVoxel(x, y + 1, z, size) == 0u) { emitFace(x, y, z, 2u, sizeF); }
  if (getVoxel(x, y - 1, z, size) == 0u) { emitFace(x, y, z, 3u, sizeF); }
  if (getVoxel(x, y, z + 1, size) == 0u) { emitFace(x, y, z, 4u, sizeF); }
  if (getVoxel(x, y, z - 1, size) == 0u) { emitFace(x, y, z, 5u, sizeF); }
}
`;

  const renderer = {
    gl: null,
    canvas: null,
    legacyRenderer,
    mode: 'legacy',
    _container: null,
    _initPromise: null,
    _hiddenHost: null,
    _sourceCanvas: null,
    _gpuCanvasContext: null,
    _adapter: null,
    _device: null,
    _pipeline: null,
    _torchProjectPipeline: null,
    _torchProjectBindGroupLayout: null,
    _haloFlamePipelineAlpha: null,
    _haloFlamePipelineAdd: null,
    _haloFlameBindGroupLayout: null,
    _sampler: null,
    _bloomSampler: null,
    _bloomPipeline: null,
    _bloomBindGroupLayout: null,
    _frameTexture: null,
    _frameTextureView: null,
    _bloomPingTexture: null,
    _bloomPingView: null,
    _bloomPongTexture: null,
    _bloomPongView: null,
    _bindGroupLayout: null,
    _bindGroup: null,
    _torchProjectBindGroup: null,
    _haloFlameBindGroup: null,
    _bloomBindGroupH: null,
    _bloomBindGroupV: null,
    _frameWidth: 0,
    _frameHeight: 0,
    _bloomWidth: 0,
    _bloomHeight: 0,
    _bloomDownsample: 0,
    _reportedNoWebGPU: false,
    _presentedAtLeastOnce: false,
    _isDeviceLost: false,
    _lastFallbackReason: '',
    _lastErrorMessage: '',
    _lastModeChangeAt: 0,
    _torchCapacity: getTorchBufferCapacity(),
    _torchCpuData: new Float32Array(getTorchBufferCapacity() * TORCH_BUFFER_STRIDE_FLOATS),
    _torchCount: 0,
    _torchDataDirty: false,
    _torchParamsDirty: false,
    _torchParamsFrame: null,
    _torchParamsBuffer: null,
    _torchStorageBuffer: null,
    _projectedTorchBuffer: null,
    _postParamsBuffer: null,
    _postParamArrayBuffer: new ArrayBuffer(16),
    _postParamsDirty: false,
    _bloomParamsBuffer: null,
    _bloomParamArrayBuffer: new ArrayBuffer(32),
    _rectCapacity: getSpriteVoxelRectCapacity(),
    _rectCpuData: new Float32Array(getSpriteVoxelRectCapacity() * RECT_BUFFER_STRIDE_FLOATS),
    _rectCount: 0,
    _rectDataDirty: false,
    _rectStorageBuffer: null,
    _torchSpriteCpuData: new Float32Array(getTorchBufferCapacity() * TORCH_SPRITE_BUFFER_STRIDE_FLOATS),
    _torchSpriteCount: 0,
    _torchSpriteDataDirty: false,
    _torchSpriteStorageBuffer: null,
    _haloParamsBuffer: null,
    _haloParamArrayBuffer: new ArrayBuffer(32),
    _torchParamArrayBuffer: new ArrayBuffer(64),
    _lastTorchFrameAt: 0,
    _lastTorchUploadAt: 0,
    _lastTorchProjectAt: 0,
    _lastHaloFlameDrawAt: 0,
    _lastTorchBlend: 0,
    _lastSpriteVoxelBlend: 0,
    _lastRectCountUploaded: 0,
    _lastBloomIntensity: 0,
    _lastBloomThreshold: 0,
    _lastBloomEnabled: false,
    _voxelMeshingPipeline: null,
    _voxelMeshingBindGroupLayout: null,
    _voxelMeshingInitTried: false,
    _voxelMeshingUnavailableReason: '',
    _voxelMeshingJobs: new Map(),
    _lastVoxelMeshBuildAt: 0,

    _ensureHiddenHost() {
      if (this._hiddenHost) return this._hiddenHost;
      const host = document.createElement('div');
      host.style.display = 'none';
      this._hiddenHost = host;
      if (document.body) {
        document.body.appendChild(host);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (!host.parentNode) document.body.appendChild(host);
        }, { once: true });
      }
      return host;
    },

    _createPresentationCanvas() {
      if (this.canvas) return this.canvas;
      const canvas = document.createElement('canvas');
      canvas.width = LOW_RES_W;
      canvas.height = LOW_RES_H;
      canvas.style.width = `${DISPLAY_W}px`;
      canvas.style.height = `${DISPLAY_H}px`;
      canvas.style.imageRendering = 'pixelated';
      canvas.style.imageRendering = 'crisp-edges';
      this.canvas = canvas;
      return canvas;
    },

    _resetFrameResources() {
      if (this._frameTexture) {
        this._frameTexture.destroy();
      }
      if (this._bloomPingTexture) {
        this._bloomPingTexture.destroy();
      }
      if (this._bloomPongTexture) {
        this._bloomPongTexture.destroy();
      }
      this._frameTexture = null;
      this._frameTextureView = null;
      this._bloomPingTexture = null;
      this._bloomPingView = null;
      this._bloomPongTexture = null;
      this._bloomPongView = null;
      this._bindGroup = null;
      this._torchProjectBindGroup = null;
      this._haloFlameBindGroup = null;
      this._bloomBindGroupH = null;
      this._bloomBindGroupV = null;
      this._frameWidth = 0;
      this._frameHeight = 0;
      this._bloomWidth = 0;
      this._bloomHeight = 0;
      this._bloomDownsample = 0;
    },

    _ensureTorchBuffers() {
      if (!this._device) return false;
      const requiredCapacity = getTorchBufferCapacity();
      const requiredRectCapacity = getSpriteVoxelRectCapacity();
      if (requiredCapacity !== this._torchCapacity) {
        this._torchCapacity = requiredCapacity;
        this._torchCpuData = new Float32Array(this._torchCapacity * TORCH_BUFFER_STRIDE_FLOATS);
        this._torchSpriteCpuData = new Float32Array(this._torchCapacity * TORCH_SPRITE_BUFFER_STRIDE_FLOATS);
        this._torchCount = 0;
        this._torchSpriteCount = 0;
        this._torchDataDirty = true;
        this._torchSpriteDataDirty = true;
        this._bindGroup = null;
        if (this._torchStorageBuffer) {
          this._torchStorageBuffer.destroy();
          this._torchStorageBuffer = null;
        }
        if (this._projectedTorchBuffer) {
          this._projectedTorchBuffer.destroy();
          this._projectedTorchBuffer = null;
        }
        this._torchProjectBindGroup = null;
        if (this._torchSpriteStorageBuffer) {
          this._torchSpriteStorageBuffer.destroy();
          this._torchSpriteStorageBuffer = null;
        }
        this._haloFlameBindGroup = null;
      }
      if (requiredRectCapacity !== this._rectCapacity) {
        this._rectCapacity = requiredRectCapacity;
        this._rectCpuData = new Float32Array(this._rectCapacity * RECT_BUFFER_STRIDE_FLOATS);
        this._rectCount = 0;
        this._rectDataDirty = true;
        this._bindGroup = null;
        if (this._rectStorageBuffer) {
          this._rectStorageBuffer.destroy();
          this._rectStorageBuffer = null;
        }
      }
      if (!this._torchParamsBuffer) {
        this._torchParamsBuffer = this._device.createBuffer({
          size: 64,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._bindGroup = null;
      }
      if (!this._torchStorageBuffer) {
        this._torchStorageBuffer = this._device.createBuffer({
          size: this._torchCapacity * TORCH_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this._torchDataDirty = true;
        this._bindGroup = null;
        this._torchProjectBindGroup = null;
      }
      if (!this._projectedTorchBuffer) {
        this._projectedTorchBuffer = this._device.createBuffer({
          size: this._torchCapacity * TORCH_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE
        });
        this._bindGroup = null;
        this._torchProjectBindGroup = null;
      }
      if (!this._torchSpriteStorageBuffer) {
        this._torchSpriteStorageBuffer = this._device.createBuffer({
          size: this._torchCapacity * TORCH_SPRITE_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this._torchSpriteDataDirty = true;
        this._haloFlameBindGroup = null;
      }
      if (!this._rectStorageBuffer) {
        this._rectStorageBuffer = this._device.createBuffer({
          size: this._rectCapacity * RECT_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this._rectDataDirty = true;
        this._bindGroup = null;
      }
      if (!this._postParamsBuffer) {
        this._postParamsBuffer = this._device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._postParamsDirty = true;
        this._bindGroup = null;
      }
      if (!this._bloomParamsBuffer) {
        this._bloomParamsBuffer = this._device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._bindGroup = null;
      }
      if (!this._haloParamsBuffer) {
        this._haloParamsBuffer = this._device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._haloFlameBindGroup = null;
      }
      return true;
    },

    clearVoxelMeshCache() {
      this._voxelMeshingJobs.clear();
    },

    _pruneVoxelMeshCache(maxEntries = 256) {
      if (this._voxelMeshingJobs.size <= maxEntries) return;
      const removable = [];
      for (const [key, job] of this._voxelMeshingJobs.entries()) {
        if (job && job.status === 'pending') continue;
        removable.push({
          key,
          updatedAt: Number.isFinite(job?.updatedAt) ? job.updatedAt : 0
        });
      }
      removable.sort((a, b) => a.updatedAt - b.updatedAt);
      while (this._voxelMeshingJobs.size > maxEntries && removable.length > 0) {
        const next = removable.shift();
        this._voxelMeshingJobs.delete(next.key);
      }
    },

    _ensureVoxelMeshingPipeline() {
      if (this._voxelMeshingPipeline && this._voxelMeshingBindGroupLayout) return true;
      if (!isGpuVoxelMeshingEnabled() || !this._device) return false;
      if (this._voxelMeshingInitTried && (!this._voxelMeshingPipeline || !this._voxelMeshingBindGroupLayout)) {
        return false;
      }
      this._voxelMeshingInitTried = true;
      try {
        const module = this._device.createShaderModule({ code: voxelSimpleMeshWgsl });
        const bindGroupLayout = this._device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'uniform' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'read-only-storage' }
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' }
            },
            {
              binding: 3,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' }
            },
            {
              binding: 4,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' }
            }
          ]
        });
        const pipelineLayout = this._device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout]
        });
        const pipeline = this._device.createComputePipeline({
          layout: pipelineLayout,
          compute: { module, entryPoint: 'csMain' }
        });
        this._voxelMeshingBindGroupLayout = bindGroupLayout;
        this._voxelMeshingPipeline = pipeline;
        this._voxelMeshingUnavailableReason = '';
        return true;
      } catch (err) {
        this._voxelMeshingUnavailableReason = err && err.message
          ? String(err.message)
          : 'Voxel meshing compute pipeline creation failed';
        console.warn('[WebGPU] GPU voxel meshing unavailable:', this._voxelMeshingUnavailableReason);
        return false;
      }
    },

    requestSimpleVoxelMesh(request) {
      if (!isGpuVoxelMeshingEnabled()) {
        return { status: 'disabled' };
      }
      if (!request || typeof request !== 'object') {
        return { status: 'invalid' };
      }
      const cacheKey = typeof request.cacheKey === 'string' ? request.cacheKey : '';
      if (!cacheKey) {
        return { status: 'invalid' };
      }
      const sizeRaw = Number.isFinite(request.size) ? Math.floor(request.size) : 16;
      const size = Math.max(2, Math.min(32, sizeRaw));
      const voxels = request.voxels;
      const voxelCount = size * size * size;
      if (!voxels || typeof voxels.length !== 'number' || voxels.length < voxelCount) {
        return { status: 'invalid' };
      }
      if (this.mode !== 'webgpu' || !this._device) {
        return { status: 'unavailable' };
      }
      if (!this._ensureVoxelMeshingPipeline()) {
        return { status: 'unavailable', reason: this._voxelMeshingUnavailableReason || 'pipeline unavailable' };
      }

      const existing = this._voxelMeshingJobs.get(cacheKey);
      if (existing) {
        existing.updatedAt = Date.now();
        if (existing.status === 'ready' && existing.mesh) {
          return { status: 'ready', mesh: existing.mesh };
        }
        if (existing.status === 'error') {
          return { status: 'error', reason: existing.error || 'mesh build failed' };
        }
        return { status: 'pending' };
      }

      const colorIn = Array.isArray(request.color) ? request.color : [1, 1, 1];
      const color = [
        Number.isFinite(colorIn[0]) ? colorIn[0] : 1.0,
        Number.isFinite(colorIn[1]) ? colorIn[1] : 1.0,
        Number.isFinite(colorIn[2]) ? colorIn[2] : 1.0
      ];
      const cylindricalStrengthRaw = Number.isFinite(request.cylindricalStrength)
        ? Number(request.cylindricalStrength)
        : 0.0;
      const cylindricalStrength = Math.max(0.0, Math.min(1.0, cylindricalStrengthRaw));
      const seamPad = Number.isFinite(request.seamPad) ? request.seamPad : 0.0;
      const job = {
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mesh: null,
        error: null
      };
      this._voxelMeshingJobs.set(cacheKey, job);
      this._pruneVoxelMeshCache();
      this._startSimpleVoxelMeshBuild(cacheKey, {
        size,
        voxels,
        seamPad,
        cylindricalStrength,
        color
      }, job);
      return { status: 'pending' };
    },

    _startSimpleVoxelMeshBuild(cacheKey, request, job) {
      const device = this._device;
      const pipeline = this._voxelMeshingPipeline;
      const bindGroupLayout = this._voxelMeshingBindGroupLayout;
      if (!device || !pipeline || !bindGroupLayout) {
        job.status = 'error';
        job.error = 'GPU meshing pipeline unavailable';
        job.updatedAt = Date.now();
        return;
      }

      const size = request.size | 0;
      const voxelCount = size * size * size;
      const maxFaces = voxelCount * 6;
      const maxVertices = maxFaces * 4;
      const maxIndices = maxFaces * 6;
      const voxelData = new Uint32Array(voxelCount);
      for (let i = 0; i < voxelCount; i++) {
        voxelData[i] = request.voxels[i] ? 1 : 0;
      }
      const paramsArrayBuffer = new ArrayBuffer(32);
      const paramsView = new DataView(paramsArrayBuffer);
      paramsView.setUint32(0, size >>> 0, true);
      paramsView.setUint32(4, maxFaces >>> 0, true);
      paramsView.setFloat32(8, request.seamPad, true);
      paramsView.setFloat32(12, request.cylindricalStrength || 0.0, true);
      paramsView.setFloat32(16, request.color[0], true);
      paramsView.setFloat32(20, request.color[1], true);
      paramsView.setFloat32(24, request.color[2], true);
      paramsView.setFloat32(28, 0.0, true);

      let voxelBuffer = null;
      let paramsBuffer = null;
      let vertexBuffer = null;
      let indexBuffer = null;
      let counterBuffer = null;
      let counterReadBuffer = null;
      let vertexReadBuffer = null;
      let indexReadBuffer = null;

      const safeUnmap = (buffer) => {
        if (!buffer) return;
        try {
          buffer.unmap();
        } catch (_) {}
      };
      const safeDestroy = (buffer) => {
        if (!buffer) return;
        try {
          buffer.destroy();
        } catch (_) {}
      };

      (async () => {
        voxelBuffer = device.createBuffer({
          size: voxelCount * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        paramsBuffer = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        vertexBuffer = device.createBuffer({
          size: maxVertices * VOXEL_VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        indexBuffer = device.createBuffer({
          size: maxIndices * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        counterBuffer = device.createBuffer({
          size: Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        counterReadBuffer = device.createBuffer({
          size: Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        vertexReadBuffer = device.createBuffer({
          size: maxVertices * VOXEL_VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        indexReadBuffer = device.createBuffer({
          size: maxIndices * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        device.queue.writeBuffer(voxelBuffer, 0, voxelData);
        device.queue.writeBuffer(paramsBuffer, 0, paramsArrayBuffer);
        device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: voxelBuffer } },
            { binding: 2, resource: { buffer: vertexBuffer } },
            { binding: 3, resource: { buffer: indexBuffer } },
            { binding: 4, resource: { buffer: counterBuffer } }
          ]
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(voxelCount / 64));
        pass.end();
        encoder.copyBufferToBuffer(counterBuffer, 0, counterReadBuffer, 0, Uint32Array.BYTES_PER_ELEMENT);
        encoder.copyBufferToBuffer(
          vertexBuffer,
          0,
          vertexReadBuffer,
          0,
          maxVertices * VOXEL_VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT
        );
        encoder.copyBufferToBuffer(
          indexBuffer,
          0,
          indexReadBuffer,
          0,
          maxIndices * Uint32Array.BYTES_PER_ELEMENT
        );
        device.queue.submit([encoder.finish()]);

        await Promise.all([
          counterReadBuffer.mapAsync(GPUMapMode.READ),
          vertexReadBuffer.mapAsync(GPUMapMode.READ),
          indexReadBuffer.mapAsync(GPUMapMode.READ)
        ]);

        const counterData = new Uint32Array(counterReadBuffer.getMappedRange());
        const faceCount = counterData[0] >>> 0;
        const vertexCount = faceCount * 4;
        const indexCount = faceCount * 6;
        if (vertexCount > 65535) {
          throw new Error(`GPU voxel mesh exceeds Uint16 index limit (${vertexCount} vertices)`);
        }

        const vertexValueCount = vertexCount * VOXEL_VERTEX_STRIDE_FLOATS;
        const vertexSource = new Float32Array(vertexReadBuffer.getMappedRange());
        const vertices = new Float32Array(vertexValueCount);
        if (vertexValueCount > 0) {
          vertices.set(vertexSource.subarray(0, vertexValueCount));
        }

        const indexSource = new Uint32Array(indexReadBuffer.getMappedRange());
        const indices = new Uint16Array(indexCount);
        for (let i = 0; i < indexCount; i++) {
          indices[i] = indexSource[i] & 0xffff;
        }

        const current = this._voxelMeshingJobs.get(cacheKey);
        if (!current || current !== job) {
          return;
        }
        current.status = 'ready';
        current.mesh = { vertices, indices };
        current.faceCount = faceCount;
        current.updatedAt = Date.now();
        this._lastVoxelMeshBuildAt = current.updatedAt;
      })().catch((err) => {
        const current = this._voxelMeshingJobs.get(cacheKey);
        if (!current || current !== job) return;
        current.status = 'error';
        current.error = err && err.message ? String(err.message) : 'GPU voxel meshing failed';
        current.updatedAt = Date.now();
      }).finally(() => {
        safeUnmap(counterReadBuffer);
        safeUnmap(vertexReadBuffer);
        safeUnmap(indexReadBuffer);
        safeDestroy(voxelBuffer);
        safeDestroy(paramsBuffer);
        safeDestroy(vertexBuffer);
        safeDestroy(indexBuffer);
        safeDestroy(counterBuffer);
        safeDestroy(counterReadBuffer);
        safeDestroy(vertexReadBuffer);
        safeDestroy(indexReadBuffer);
      });
    },

    _restoreLegacyViewport(reason) {
      if (this.mode === 'legacy') return;
      this.mode = 'legacy';
      this._lastModeChangeAt = Date.now();
      this._lastFallbackReason = reason ? String(reason) : 'Unknown fallback reason';
      this._presentedAtLeastOnce = false;
      this.clearVoxelMeshCache();
      this._voxelMeshingPipeline = null;
      this._voxelMeshingBindGroupLayout = null;
      this._voxelMeshingInitTried = false;
      this._voxelMeshingUnavailableReason = '';
      this._resetFrameResources();
      const container = this._container || document.getElementById('dungeon-container');
      if (container && this.legacyRenderer.canvas) {
        container.innerHTML = '';
        container.appendChild(this.legacyRenderer.canvas);
      }
      console.warn('[WebGPU] Falling back to legacy WebGL viewport.', reason || '');
    },

    _attachWebGPUViewport() {
      const container = this._container || document.getElementById('dungeon-container');
      if (!container || !this.canvas) return false;
      if (this.canvas.parentNode === container) return true;
      const host = this._ensureHiddenHost();
      if (this.legacyRenderer.canvas && this.legacyRenderer.canvas.parentNode === container) {
        host.appendChild(this.legacyRenderer.canvas);
      }
      container.innerHTML = '';
      container.appendChild(this.canvas);
      return true;
    },

    _ensureBloomResources(frameW, frameH) {
      if (!this._device || !this._bloomBindGroupLayout || !this._bloomSampler || !this._bloomParamsBuffer || !this._frameTextureView) {
        return false;
      }
      const downsample = getBloomDownsample();
      const bw = Math.max(1, Math.floor(frameW / downsample));
      const bh = Math.max(1, Math.floor(frameH / downsample));
      const sameSize = (
        this._bloomPingTexture &&
        this._bloomPongTexture &&
        this._bloomWidth === bw &&
        this._bloomHeight === bh &&
        this._bloomDownsample === downsample
      );
      if (!sameSize) {
        if (this._bloomPingTexture) this._bloomPingTexture.destroy();
        if (this._bloomPongTexture) this._bloomPongTexture.destroy();
        this._bloomPingTexture = this._device.createTexture({
          size: { width: bw, height: bh, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this._bloomPongTexture = this._device.createTexture({
          size: { width: bw, height: bh, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this._bloomPingView = this._bloomPingTexture.createView();
        this._bloomPongView = this._bloomPongTexture.createView();
        this._bloomWidth = bw;
        this._bloomHeight = bh;
        this._bloomDownsample = downsample;
        this._bindGroup = null;
        this._bloomBindGroupH = null;
        this._bloomBindGroupV = null;
      }

      if (!this._bloomBindGroupH) {
        this._bloomBindGroupH = this._device.createBindGroup({
          layout: this._bloomBindGroupLayout,
          entries: [
            { binding: 0, resource: this._frameTextureView },
            { binding: 1, resource: this._bloomSampler },
            { binding: 2, resource: { buffer: this._bloomParamsBuffer } }
          ]
        });
      }
      if (!this._bloomBindGroupV) {
        this._bloomBindGroupV = this._device.createBindGroup({
          layout: this._bloomBindGroupLayout,
          entries: [
            { binding: 0, resource: this._bloomPingView },
            { binding: 1, resource: this._bloomSampler },
            { binding: 2, resource: { buffer: this._bloomParamsBuffer } }
          ]
        });
      }
      return true;
    },

    _ensureFrameResources() {
      const src = this._sourceCanvas;
      if (
        !src ||
        !this._device ||
        !this._bindGroupLayout ||
        !this._torchProjectBindGroupLayout ||
        !this._haloFlameBindGroupLayout ||
        !this._ensureTorchBuffers()
      ) return false;
      const w = Math.max(1, src.width | 0);
      const h = Math.max(1, src.height | 0);
      const sizeChanged = !(w === this._frameWidth && h === this._frameHeight && this._frameTexture && this._frameTextureView);
      if (sizeChanged) {
        if (this._frameTexture) this._frameTexture.destroy();
        this._frameTexture = this._device.createTexture({
          size: { width: w, height: h, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._frameTextureView = this._frameTexture.createView();
        this._frameWidth = w;
        this._frameHeight = h;
        this._bindGroup = null;
        this._bloomBindGroupH = null;
      }
      if (this.canvas && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      if (!this._ensureBloomResources(w, h)) return false;
      if (!this._bindGroup) {
        this._bindGroup = this._device.createBindGroup({
          layout: this._bindGroupLayout,
          entries: [
            { binding: 0, resource: this._frameTextureView },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: { buffer: this._torchParamsBuffer } },
            { binding: 3, resource: { buffer: this._torchStorageBuffer } },
            { binding: 4, resource: { buffer: this._rectStorageBuffer } },
            { binding: 5, resource: this._bloomPongView },
            { binding: 6, resource: this._bloomSampler },
            { binding: 7, resource: { buffer: this._postParamsBuffer } },
            { binding: 8, resource: { buffer: this._projectedTorchBuffer } }
          ]
        });
      }
      if (!this._torchProjectBindGroup) {
        this._torchProjectBindGroup = this._device.createBindGroup({
          layout: this._torchProjectBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this._torchParamsBuffer } },
            { binding: 1, resource: { buffer: this._torchStorageBuffer } },
            { binding: 2, resource: { buffer: this._projectedTorchBuffer } }
          ]
        });
      }
      if (!this._haloFlameBindGroup) {
        this._haloFlameBindGroup = this._device.createBindGroup({
          layout: this._haloFlameBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this._haloParamsBuffer } },
            { binding: 1, resource: { buffer: this._torchSpriteStorageBuffer } }
          ]
        });
      }
      return true;
    },

    _uploadTorchData() {
      if (
        !this._device ||
        !this._torchParamsBuffer ||
        !this._torchStorageBuffer ||
        !this._rectStorageBuffer ||
        !this._torchSpriteStorageBuffer
      ) return;

      const frame = this._torchParamsFrame || {};
      const blend = this.shouldApplyPostTorchOverlay() ? getTorchBlend() : 0.0;
      const driveSpriteVoxel = this.shouldDriveSpriteTorch();
      const spriteVoxelBlend = (driveSpriteVoxel && this.shouldApplyPostTorchOverlay())
        ? getSpriteVoxelTorchBlend()
        : 0.0;
      const width = Number.isFinite(frame.width) ? frame.width : Math.max(1, this._frameWidth || LOW_RES_W);
      const height = Number.isFinite(frame.height) ? frame.height : Math.max(1, this._frameHeight || LOW_RES_H);
      const focalLength = Number.isFinite(frame.focalLength) ? frame.focalLength : (height / (2 * Math.tan(Math.PI / 6)));
      const camX = Number.isFinite(frame.camX) ? frame.camX : 0.0;
      const camY = Number.isFinite(frame.camY) ? frame.camY : 0.0;
      const dirX = Number.isFinite(frame.dirX) ? frame.dirX : 1.0;
      const dirY = Number.isFinite(frame.dirY) ? frame.dirY : 0.0;
      const planeX = Number.isFinite(frame.planeX) ? frame.planeX : 0.0;
      const planeY = Number.isFinite(frame.planeY) ? frame.planeY : 0.57735;
      const eyeZ = Number.isFinite(frame.eyeZ) ? frame.eyeZ : 0.5;

      if (this._torchDataDirty && this._torchCount > 0) {
        const bytes = this._torchCount * TORCH_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        this._device.queue.writeBuffer(this._torchStorageBuffer, 0, this._torchCpuData.buffer, 0, bytes);
        this._torchDataDirty = false;
      } else if (this._torchDataDirty && this._torchCount === 0) {
        const zeros = new Float32Array(TORCH_BUFFER_STRIDE_FLOATS);
        this._device.queue.writeBuffer(this._torchStorageBuffer, 0, zeros);
        this._torchDataDirty = false;
      }

      if (this._rectDataDirty && this._rectCount > 0) {
        const rectBytes = this._rectCount * RECT_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        this._device.queue.writeBuffer(this._rectStorageBuffer, 0, this._rectCpuData.buffer, 0, rectBytes);
        this._rectDataDirty = false;
      } else if (this._rectDataDirty && this._rectCount === 0) {
        const zeros = new Float32Array(RECT_BUFFER_STRIDE_FLOATS);
        this._device.queue.writeBuffer(this._rectStorageBuffer, 0, zeros);
        this._rectDataDirty = false;
      }

      if (this._torchSpriteDataDirty && this._torchSpriteCount > 0) {
        const spriteBytes = this._torchSpriteCount * TORCH_SPRITE_BUFFER_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        this._device.queue.writeBuffer(this._torchSpriteStorageBuffer, 0, this._torchSpriteCpuData.buffer, 0, spriteBytes);
        this._torchSpriteDataDirty = false;
      } else if (this._torchSpriteDataDirty && this._torchSpriteCount === 0) {
        const zeros = new Float32Array(TORCH_SPRITE_BUFFER_STRIDE_FLOATS);
        this._device.queue.writeBuffer(this._torchSpriteStorageBuffer, 0, zeros);
        this._torchSpriteDataDirty = false;
      }

      if (
        this._torchParamsDirty ||
        Math.abs(this._lastTorchBlend - blend) > 1e-6 ||
        Math.abs(this._lastSpriteVoxelBlend - spriteVoxelBlend) > 1e-6 ||
        this._lastRectCountUploaded !== this._rectCount
      ) {
        const dv = new DataView(this._torchParamArrayBuffer);
        dv.setFloat32(0, width, true);
        dv.setFloat32(4, height, true);
        dv.setFloat32(8, camX, true);
        dv.setFloat32(12, camY, true);
        dv.setFloat32(16, dirX, true);
        dv.setFloat32(20, dirY, true);
        dv.setFloat32(24, planeX, true);
        dv.setFloat32(28, planeY, true);
        dv.setFloat32(32, focalLength, true);
        dv.setFloat32(36, eyeZ, true);
        dv.setFloat32(40, blend, true);
        dv.setUint32(44, this._torchCount >>> 0, true);
        dv.setFloat32(48, spriteVoxelBlend, true);
        dv.setUint32(52, this._rectCount >>> 0, true);
        dv.setUint32(56, 0, true);
        dv.setUint32(60, 0, true);
        this._device.queue.writeBuffer(this._torchParamsBuffer, 0, this._torchParamArrayBuffer);
        this._torchParamsDirty = false;
        this._lastTorchBlend = blend;
        this._lastSpriteVoxelBlend = spriteVoxelBlend;
        this._lastRectCountUploaded = this._rectCount;
      }
      this._lastTorchUploadAt = Date.now();
    },

    _uploadPostData() {
      if (!this._device || !this._postParamsBuffer) return;
      const bloomEnabled = isBloomEnabled() ? 1.0 : 0.0;
      const bloomIntensity = bloomEnabled > 0.5 ? getBloomIntensity() : 0.0;
      if (
        !this._postParamsDirty &&
        Math.abs(this._lastBloomIntensity - bloomIntensity) <= 1e-6 &&
        ((bloomEnabled > 0.5 ? 1 : 0) === (this._lastBloomEnabled ? 1 : 0))
      ) {
        return;
      }
      const dv = new DataView(this._postParamArrayBuffer);
      dv.setFloat32(0, bloomIntensity, true);
      dv.setFloat32(4, bloomEnabled, true);
      dv.setFloat32(8, 0.0, true);
      dv.setFloat32(12, 0.0, true);
      this._device.queue.writeBuffer(this._postParamsBuffer, 0, this._postParamArrayBuffer);
      this._postParamsDirty = false;
      this._lastBloomIntensity = bloomIntensity;
      this._lastBloomEnabled = bloomEnabled > 0.5;
    },

    _writeBloomBlurParams(directionX, directionY, applyThreshold) {
      if (!this._device || !this._bloomParamsBuffer || this._bloomWidth < 1 || this._bloomHeight < 1) return;
      const dv = new DataView(this._bloomParamArrayBuffer);
      dv.setFloat32(0, 1.0 / this._bloomWidth, true);
      dv.setFloat32(4, 1.0 / this._bloomHeight, true);
      dv.setFloat32(8, directionX, true);
      dv.setFloat32(12, directionY, true);
      dv.setFloat32(16, getBloomThreshold(), true);
      dv.setFloat32(20, applyThreshold ? 1.0 : 0.0, true);
      dv.setFloat32(24, getBloomWarmBoost(), true);
      dv.setFloat32(28, 0.0, true);
      this._device.queue.writeBuffer(this._bloomParamsBuffer, 0, this._bloomParamArrayBuffer);
      this._lastBloomThreshold = getBloomThreshold();
    },

    _runBloomPasses(encoder) {
      if (!encoder || !this._bloomPipeline || !this._bloomBindGroupH || !this._bloomBindGroupV || !this._bloomPingView || !this._bloomPongView) {
        return;
      }
      if (!isBloomEnabled() || getBloomIntensity() <= 0.0001) {
        const clearPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: this._bloomPongView,
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        clearPass.end();
        return;
      }

      this._writeBloomBlurParams(1.0, 0.0, true);
      const passH = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this._bloomPingView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
          }
        ]
      });
      passH.setPipeline(this._bloomPipeline);
      passH.setBindGroup(0, this._bloomBindGroupH);
      passH.draw(6, 1, 0, 0);
      passH.end();

      this._writeBloomBlurParams(0.0, 1.0, false);
      const passV = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this._bloomPongView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
          }
        ]
      });
      passV.setPipeline(this._bloomPipeline);
      passV.setBindGroup(0, this._bloomBindGroupV);
      passV.draw(6, 1, 0, 0);
      passV.end();
    },

    _runTorchProjectPass(encoder) {
      if (!encoder || !this._torchProjectPipeline || !this._torchProjectBindGroup) return;
      if (this._lastTorchBlend <= 0.0001 && this._lastSpriteVoxelBlend <= 0.0001) return;
      const count = Math.min(512, this._torchCount >>> 0);
      if (count < 1) return;
      const pass = encoder.beginComputePass();
      pass.setPipeline(this._torchProjectPipeline);
      pass.setBindGroup(0, this._torchProjectBindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / 64));
      pass.end();
      this._lastTorchProjectAt = Date.now();
    },

    _writeHaloFlameParams(passKind) {
      if (!this._device || !this._haloParamsBuffer) return;
      const dv = new DataView(this._haloParamArrayBuffer);
      dv.setFloat32(0, Math.max(1, this._frameWidth || LOW_RES_W), true);
      dv.setFloat32(4, Math.max(1, this._frameHeight || LOW_RES_H), true);
      dv.setFloat32(8, performance.now() * 0.001, true);
      dv.setFloat32(12, passKind, true);
      dv.setFloat32(16, getGpuHaloFlameIntensity(), true);
      dv.setFloat32(20, 0.0, true);
      dv.setFloat32(24, 0.0, true);
      dv.setFloat32(28, 0.0, true);
      this._device.queue.writeBuffer(this._haloParamsBuffer, 0, this._haloParamArrayBuffer);
    },

    _runHaloFlamePass(pass) {
      if (!pass || !this._haloFlameBindGroup || !this.shouldDriveHaloFlame()) return;
      if (this._torchSpriteCount < 1) return;
      if (!this._haloFlamePipelineAlpha || !this._haloFlamePipelineAdd) return;

      this._writeHaloFlameParams(0.0);
      pass.setPipeline(this._haloFlamePipelineAlpha);
      pass.setBindGroup(0, this._haloFlameBindGroup);
      pass.draw(6, this._torchSpriteCount, 0, 0);

      this._writeHaloFlameParams(1.0);
      pass.setPipeline(this._haloFlamePipelineAdd);
      pass.setBindGroup(0, this._haloFlameBindGroup);
      pass.draw(6, this._torchSpriteCount, 0, 0);
      this._lastHaloFlameDrawAt = Date.now();
    },

    async _upgradeToWebGPU() {
      if (!navigator.gpu || window.forceWebGPURenderer === false) {
        this.mode = 'legacy';
        this._lastModeChangeAt = Date.now();
        this._lastFallbackReason = !navigator.gpu
          ? 'navigator.gpu unavailable'
          : 'window.forceWebGPURenderer disabled';
        if (!navigator.gpu && !this._reportedNoWebGPU) {
          this._reportedNoWebGPU = true;
          console.info('[WebGPU] navigator.gpu unavailable. Staying on WebGL renderer.');
        }
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          this.mode = 'legacy';
          this._lastModeChangeAt = Date.now();
          this._lastFallbackReason = 'No WebGPU adapter returned by navigator.gpu.requestAdapter()';
          console.warn('[WebGPU] No adapter available. Staying on WebGL renderer.');
          return;
        }
        const device = await adapter.requestDevice();
        const canvas = this._createPresentationCanvas();
        const context = canvas.getContext('webgpu');
        if (!context) {
          this.mode = 'legacy';
          this._lastModeChangeAt = Date.now();
          this._lastFallbackReason = 'Could not acquire webgpu context from canvas.getContext("webgpu")';
          console.warn('[WebGPU] Could not acquire webgpu context. Staying on WebGL renderer.');
          return;
        }
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format: presentationFormat,
          alphaMode: 'opaque'
        });

        device.lost.then((info) => {
          this._isDeviceLost = true;
          this._restoreLegacyViewport(info && info.message ? info.message : 'WebGPU device lost');
        }).catch(() => {
          this._restoreLegacyViewport('WebGPU device lost');
        });

        if (typeof device.addEventListener === 'function') {
          device.addEventListener('uncapturederror', (event) => {
            const message = event && event.error && event.error.message ? event.error.message : 'Uncaptured WebGPU error';
            this._restoreLegacyViewport(message);
          });
        }

        const shaderModule = device.createShaderModule({ code: fullscreenWgsl });
        const torchProjectModule = device.createShaderModule({ code: torchProjectWgsl });
        const haloFlameModule = device.createShaderModule({ code: haloFlameWgsl });
        const bloomShaderModule = device.createShaderModule({ code: bloomBlurWgsl });
        const sampler = device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipmapFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        });
        const bloomSampler = device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
          mipmapFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        });
        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: 'float' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' }
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            },
            {
              binding: 3,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' }
            },
            {
              binding: 4,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' }
            },
            {
              binding: 5,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: 'float' }
            },
            {
              binding: 6,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' }
            },
            {
              binding: 7,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            },
            {
              binding: 8,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' }
            }
          ]
        });
        const torchProjectBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'uniform' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'read-only-storage' }
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' }
            }
          ]
        });
        const haloFlameBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' }
            }
          ]
        });
        const bloomBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: 'float' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' }
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            }
          ]
        });
        const pipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout]
        });
        const bloomPipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [bloomBindGroupLayout]
        });
        const torchProjectPipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [torchProjectBindGroupLayout]
        });
        const haloFlamePipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [haloFlameBindGroupLayout]
        });
        const pipeline = device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vsMain' },
          fragment: { module: shaderModule, entryPoint: 'fsMain', targets: [{ format: presentationFormat }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' }
        });
        const bloomPipeline = device.createRenderPipeline({
          layout: bloomPipelineLayout,
          vertex: { module: bloomShaderModule, entryPoint: 'vsMain' },
          fragment: { module: bloomShaderModule, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' }
        });
        const torchProjectPipeline = device.createComputePipeline({
          layout: torchProjectPipelineLayout,
          compute: { module: torchProjectModule, entryPoint: 'csMain' }
        });
        const haloFlamePipelineAlpha = device.createRenderPipeline({
          layout: haloFlamePipelineLayout,
          vertex: { module: haloFlameModule, entryPoint: 'vsMain' },
          fragment: {
            module: haloFlameModule,
            entryPoint: 'fsMain',
            targets: [{
              format: presentationFormat,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' }
        });
        const haloFlamePipelineAdd = device.createRenderPipeline({
          layout: haloFlamePipelineLayout,
          vertex: { module: haloFlameModule, entryPoint: 'vsMain' },
          fragment: {
            module: haloFlameModule,
            entryPoint: 'fsMain',
            targets: [{
              format: presentationFormat,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' }
        });

        this._adapter = adapter;
        this._device = device;
        this._gpuCanvasContext = context;
        this._pipeline = pipeline;
        this._torchProjectPipeline = torchProjectPipeline;
        this._torchProjectBindGroupLayout = torchProjectBindGroupLayout;
        this._haloFlamePipelineAlpha = haloFlamePipelineAlpha;
        this._haloFlamePipelineAdd = haloFlamePipelineAdd;
        this._haloFlameBindGroupLayout = haloFlameBindGroupLayout;
        this._sampler = sampler;
        this._bloomSampler = bloomSampler;
        this._bloomPipeline = bloomPipeline;
        this._bindGroupLayout = bindGroupLayout;
        this._bloomBindGroupLayout = bloomBindGroupLayout;
        this._voxelMeshingPipeline = null;
        this._voxelMeshingBindGroupLayout = null;
        this._voxelMeshingInitTried = false;
        this._voxelMeshingUnavailableReason = '';
        this.clearVoxelMeshCache();
        this._ensureTorchBuffers();
        this.mode = 'webgpu';
        this._lastModeChangeAt = Date.now();
        this._lastFallbackReason = '';

        console.info('[WebGPU] Presentation path armed (torch storage-buffer pipeline enabled).');
        if (typeof window.requestAnimationFrame === 'function' && typeof window.renderDungeonView === 'function') {
          window.requestAnimationFrame(() => window.renderDungeonView());
        }
      } catch (err) {
        this._lastErrorMessage = err && err.message ? String(err.message) : String(err || 'WebGPU init failed');
        this._restoreLegacyViewport(err && err.message ? err.message : 'WebGPU init failed');
      }
    },

    init(container) {
      if (!container) return false;
      this._container = container;

      if (!this.legacyRenderer.gl) {
        const ok = this.legacyRenderer.init(container);
        if (!ok) {
          this.gl = null;
          return false;
        }
      }

      this.gl = this.legacyRenderer.gl || { backend: 'webgpu-compat' };
      this._sourceCanvas = this.legacyRenderer.canvas || null;
      if (!this._sourceCanvas) return false;

      if (!this._initPromise && this.mode !== 'webgpu' && !this._isDeviceLost) {
        this.mode = 'upgrading';
        this._lastModeChangeAt = Date.now();
        this._initPromise = this._upgradeToWebGPU().finally(() => {
          this._initPromise = null;
        });
      }
      return true;
    },

    updateTorchFrame(frame) {
      const lights = Array.isArray(frame?.lights) ? frame.lights : [];
      const rects = Array.isArray(frame?.spriteVoxelRects) ? frame.spriteVoxelRects : [];
      const torchSprites = Array.isArray(frame?.torchSprites) ? frame.torchSprites : [];
      const torchColor = frame?.torchColor || TORCH_LIGHT_DEFAULT_COLOR;
      const r = (Number.isFinite(torchColor.r) ? torchColor.r : TORCH_LIGHT_DEFAULT_COLOR.r) / 255;
      const g = (Number.isFinite(torchColor.g) ? torchColor.g : TORCH_LIGHT_DEFAULT_COLOR.g) / 255;
      const b = (Number.isFinite(torchColor.b) ? torchColor.b : TORCH_LIGHT_DEFAULT_COLOR.b) / 255;
      const count = Math.min(lights.length, this._torchCapacity);
      this._torchCount = count;
      const out = this._torchCpuData;
      for (let i = 0; i < count; i++) {
        const t = lights[i] || {};
        const base = i * TORCH_BUFFER_STRIDE_FLOATS;
        out[base] = Number.isFinite(t.x) ? t.x : 0.0;
        out[base + 1] = Number.isFinite(t.y) ? t.y : 0.0;
        out[base + 2] = Number.isFinite(t.z) ? t.z : 0.0;
        out[base + 3] = Number.isFinite(t.radius) ? t.radius : 0.0;
        out[base + 4] = Number.isFinite(t.intensity) ? t.intensity : 0.0;
        out[base + 5] = r;
        out[base + 6] = g;
        out[base + 7] = b;
      }
      const rectCount = Math.min(rects.length, this._rectCapacity);
      this._rectCount = rectCount;
      const rectOut = this._rectCpuData;
      for (let i = 0; i < rectCount; i++) {
        const rect = rects[i] || {};
        const base = i * RECT_BUFFER_STRIDE_FLOATS;
        rectOut[base] = Number.isFinite(rect.x0) ? rect.x0 : 0.0;
        rectOut[base + 1] = Number.isFinite(rect.y0) ? rect.y0 : 0.0;
        rectOut[base + 2] = Number.isFinite(rect.x1) ? rect.x1 : 0.0;
        rectOut[base + 3] = Number.isFinite(rect.y1) ? rect.y1 : 0.0;
      }
      const spriteCount = Math.min(torchSprites.length, this._torchCapacity);
      this._torchSpriteCount = spriteCount;
      const spriteOut = this._torchSpriteCpuData;
      for (let i = 0; i < spriteCount; i++) {
        const spr = torchSprites[i] || {};
        const base = i * TORCH_SPRITE_BUFFER_STRIDE_FLOATS;
        spriteOut[base] = Number.isFinite(spr.screenX) ? spr.screenX : 0.0;
        spriteOut[base + 1] = Number.isFinite(spr.rawDrawStartY) ? spr.rawDrawStartY : 0.0;
        spriteOut[base + 2] = Number.isFinite(spr.rawDrawEndY) ? spr.rawDrawEndY : 0.0;
        spriteOut[base + 3] = Number.isFinite(spr.depth) ? spr.depth : 1.0;
        spriteOut[base + 4] = Number.isFinite(spr.viewDist) ? spr.viewDist : 0.0;
        spriteOut[base + 5] = Number.isFinite(spr.flickerSeed) ? spr.flickerSeed : 0.0;
        spriteOut[base + 6] = spr.wallFacing ? 1.0 : 0.0;
        spriteOut[base + 7] = 0.0;
      }
      this._torchDataDirty = true;
      this._rectDataDirty = true;
      this._torchSpriteDataDirty = true;
      this._torchParamsDirty = true;
      this._torchParamsFrame = {
        width: frame?.width,
        height: frame?.height,
        focalLength: frame?.focalLength,
        camX: frame?.camX,
        camY: frame?.camY,
        dirX: frame?.dirX,
        dirY: frame?.dirY,
        planeX: frame?.planeX,
        planeY: frame?.planeY,
        eyeZ: frame?.eyeZ
      };
      this._lastTorchFrameAt = Date.now();
    },

    _presentSourceToWebGPU() {
      if (this.mode !== 'webgpu') return;
      if (!this._device || !this._gpuCanvasContext || !this._sourceCanvas || !this._pipeline) return;
      if (!this._ensureFrameResources() || !this._bindGroup) return;

      try {
        this._uploadTorchData();
        this._uploadPostData();
        this._device.queue.copyExternalImageToTexture(
          { source: this._sourceCanvas },
          { texture: this._frameTexture },
          { width: this._frameWidth, height: this._frameHeight, depthOrArrayLayers: 1 }
        );

        const encoder = this._device.createCommandEncoder();
        this._runTorchProjectPass(encoder);
        this._runBloomPasses(encoder);
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: this._gpuCanvasContext.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, this._bindGroup);
        pass.draw(6, 1, 0, 0);
        this._runHaloFlamePass(pass);
        pass.end();
        this._device.queue.submit([encoder.finish()]);

        if (!this._presentedAtLeastOnce) {
          this._presentedAtLeastOnce = true;
          this._attachWebGPUViewport();
        }
      } catch (err) {
        this._lastErrorMessage = err && err.message ? String(err.message) : String(err || 'WebGPU present failed');
        this._restoreLegacyViewport(err && err.message ? err.message : 'WebGPU present failed');
      }
    },

    renderScene() {
      if (!this.legacyRenderer) return;
      this.legacyRenderer.renderScene();
      this._sourceCanvas = this.legacyRenderer.canvas || this._sourceCanvas;
      this._presentSourceToWebGPU();
    },

    render(rasterCanvas) {
      if (rasterCanvas && typeof rasterCanvas.width === 'number' && typeof rasterCanvas.height === 'number') {
        this._sourceCanvas = rasterCanvas;
      } else if (this.legacyRenderer && typeof this.legacyRenderer.render === 'function') {
        this.legacyRenderer.render(rasterCanvas);
        this._sourceCanvas = this.legacyRenderer.canvas || this._sourceCanvas;
      }
      this._presentSourceToWebGPU();
    },

    shouldDriveSpriteVoxelTorch() {
      return this.shouldDriveSpriteTorch();
    },

    shouldDriveSpriteTorch() {
      return this.mode === 'webgpu'
        && isPostTorchMaskEnabled()
        && window.WEBGPU_DRIVE_SPRITE_VOXEL_TORCH !== false;
    },

    shouldDriveVoxelTorch() {
      return this.shouldDriveSpriteTorch() && window.WEBGPU_DRIVE_VOXEL_TORCH !== false;
    },

    shouldDriveHaloFlame() {
      return this.mode === 'webgpu' && isGpuHaloFlameEnabled();
    },

    shouldApplyPostTorchOverlay() {
      return this.mode === 'webgpu'
        && this.shouldDriveSpriteTorch()
        && getSpriteVoxelTorchBlend() > 0.0001;
    },

    getDebugState() {
      let voxelMeshPending = 0;
      let voxelMeshReady = 0;
      let voxelMeshError = 0;
      for (const job of this._voxelMeshingJobs.values()) {
        if (!job) continue;
        if (job.status === 'ready') voxelMeshReady++;
        else if (job.status === 'error') voxelMeshError++;
        else voxelMeshPending++;
      }
      return {
        gpuAvailable: !!navigator.gpu,
        mode: this.mode,
        presentedAtLeastOnce: !!this._presentedAtLeastOnce,
        webgpuCanvasVisible: !!(this.canvas && this.canvas.parentElement && this.canvas.parentElement.id === 'dungeon-container'),
        forceWebGPURenderer: window.forceWebGPURenderer !== false,
        lastFallbackReason: this._lastFallbackReason || null,
        lastErrorMessage: this._lastErrorMessage || null,
        lastModeChangeAt: this._lastModeChangeAt || null,
        torchBufferCapacity: this._torchCapacity,
        torchCount: this._torchCount,
        torchBlend: this._lastTorchBlend,
        driveSpriteTorch: this.shouldDriveSpriteTorch(),
        driveVoxelTorch: this.shouldDriveVoxelTorch(),
        driveHaloFlame: this.shouldDriveHaloFlame(),
        postTorchOverlay: this.shouldApplyPostTorchOverlay(),
        spriteVoxelTorchBlend: this._lastSpriteVoxelBlend,
        rectBufferCapacity: this._rectCapacity,
        rectCount: this._rectCount,
        torchSpriteCount: this._torchSpriteCount,
        bloomEnabled: isBloomEnabled(),
        bloomIntensity: this._lastBloomIntensity,
        bloomThreshold: this._lastBloomThreshold,
        bloomWarmBoost: getBloomWarmBoost(),
        bloomDownsample: this._bloomDownsample || getBloomDownsample(),
        bloomSize: this._bloomWidth > 0 && this._bloomHeight > 0 ? `${this._bloomWidth}x${this._bloomHeight}` : null,
        lastTorchFrameAt: this._lastTorchFrameAt || null,
        lastTorchUploadAt: this._lastTorchUploadAt || null,
        lastTorchProjectAt: this._lastTorchProjectAt || null,
        lastHaloFlameDrawAt: this._lastHaloFlameDrawAt || null,
        gpuHaloFlameIntensity: getGpuHaloFlameIntensity(),
        gpuVoxelMeshingEnabled: isGpuVoxelMeshingEnabled(),
        gpuVoxelMeshingReady: voxelMeshReady,
        gpuVoxelMeshingPending: voxelMeshPending,
        gpuVoxelMeshingErrors: voxelMeshError,
        gpuVoxelMeshingLastBuildAt: this._lastVoxelMeshBuildAt || null,
        gpuVoxelMeshingUnavailableReason: this._voxelMeshingUnavailableReason || null
      };
    }
  };

  window.webglDungeonRendererLegacy = legacyRenderer;
  window.webgpuDungeonRenderer = renderer;
  window.webglDungeonRenderer = renderer;
  window.useWebGLRenderer = true;

  if (typeof window.renderDungeonView === 'function') {
    window.renderDungeonView();
  }
})();
