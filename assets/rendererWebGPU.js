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
  if (typeof window.WEBGPU_NATIVE_WORLD === 'undefined') {
    window.WEBGPU_NATIVE_WORLD = false;
  }

  const DISPLAY_W = 640;
  const DISPLAY_H = 480;
  const PIXEL_SCALE = 4;
  const LOW_RES_W = Math.max(1, Math.floor(DISPLAY_W / PIXEL_SCALE));
  const LOW_RES_H = Math.max(1, Math.floor(DISPLAY_H / PIXEL_SCALE));
  const TORCH_BUFFER_STRIDE_FLOATS = 8; // vec4 pos/radius + vec4 intensity/color
  const RECT_BUFFER_STRIDE_FLOATS = 4; // vec4 x0,y0,x1,y1
  const TORCH_SPRITE_BUFFER_STRIDE_FLOATS = 16; // screen/depth + params + halo center/basisU + basisV/depth
  const TORCH_FX_VERTEX_STRIDE_FLOATS = 9; // clipXY, uv, depth, rgba
  const VOXEL_VERTEX_STRIDE_FLOATS = 9; // pos3 + norm3 + color3
  const OVERLAY_SPRITE_PARAM_BYTES = 112;
  const FRAME_DEPTH_FORMAT = 'depth24plus';
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

  function isNativeWorldEnabled() {
    return window.WEBGPU_NATIVE_WORLD === true;
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

  const worldSceneWgsl = `
const MAX_WORLD_TORCH : u32 = 64u;
const TORCH_FALLOFF : f32 = 0.45;
const TORCH_WALL_BOOST : f32 = 1.3;
const TORCH_SIDE_BOOST : f32 = 1.1;
const TORCH_FLOOR_BOOST : f32 = 1.4;
const TORCH_LIGHT_SCALE : f32 = 0.7;
const TORCH_ONLY : f32 = 0.0;
const TORCH_LIGHT_FADE_START : f32 = 1.35;
const TORCH_LIGHT_FADE_END : f32 = 2.35;
const TORCH_SHADOW_FADE_START : f32 = 1.45;
const TORCH_SHADOW_FADE_END : f32 = 2.7;
const SHADOW_DDA_STEPS : i32 = 160;
const OBSTACLE_SHADOW_SOFT : f32 = 0.14;
const SHADOW_DIFFUSION : f32 = 0.022;
const SHADOW_REFRACTION : f32 = 0.0;
const SHADOW_REFRACTION_FREQ : f32 = 3.2;
const SHADOW_DARKEN : f32 = 0.75;
const SHADOW_OCCLUSION_RADIUS_SCALE : f32 = 2.4;
const STEP_SHADOW_EPS : f32 = 0.05;
const ENABLE_FLOOR_STEP_SHADOWS : bool = true;
const STEP_SHADOW_MIN_HEIGHT : f32 = 0.03;
const TORCH_COLOR : vec3<f32> = vec3<f32>(1.0, 190.0 / 255.0, 130.0 / 255.0);
const PI : f32 = 3.141592653589793;
const TAU : f32 = 6.283185307179586;

struct WorldParams {
  resolution : vec2<f32>,
  camPos : vec2<f32>,
  camDir : vec2<f32>,
  plane : vec2<f32>,
  focalEyeMinWall : vec4<f32>,       // focalLength, eyeZ, minFloor, wallUScale
  lightDirElevIntensity : vec4<f32>, // lightDir.x, lightDir.y, lightElev, lightIntensity
  skyTop : vec4<f32>,
  skyBot : vec4<f32>,
  heightShadowTorch : vec4<f32>,     // heightMin, heightRange, shadowStrength, torchRadiusScale
  depthFar : vec4<f32>,              // depthFar, padding
  playerGrid : vec4<u32>,            // playerX, playerY, gridW, gridH
  atlasCounts : vec4<u32>,           // atlasCols, atlasRows, maxSteps, torchCount
};

struct TorchLight {
  posRad : vec4<f32>,
  intensityColor : vec4<f32>,
};

struct TorchLitResult {
  lit : f32,
  shadowBlend : f32,
  primaryDir2D : vec2<f32>,
  primaryStrength : f32,
};

struct WorldVsOut {
  @builtin(position) pos : vec4<f32>,
};

struct WorldFsOut {
  @location(0) color : vec4<f32>,
  @builtin(frag_depth) depth : f32,
};

@group(0) @binding(0) var<uniform> params : WorldParams;
@group(0) @binding(1) var cellsTex : texture_2d<f32>;
@group(0) @binding(2) var wallAtlasTex : texture_2d<f32>;
@group(0) @binding(3) var floorTex : texture_2d<f32>;
@group(0) @binding(4) var wallAtlasSamp : sampler;
@group(0) @binding(5) var floorSamp : sampler;
@group(0) @binding(6) var<storage, read> torchLights : array<TorchLight>;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> WorldVsOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var out : WorldVsOut;
  out.pos = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  return out;
}

fn floatMod(x : f32, y : f32) -> f32 {
  return x - y * floor(x / y);
}

fn inBounds(x : i32, y : i32) -> bool {
  return x >= 0 && y >= 0 && x < i32(params.playerGrid.z) && y < i32(params.playerGrid.w);
}

fn fetchCell(x : i32, y : i32) -> vec4<f32> {
  if (x < 0 || y < 0 || x >= i32(params.playerGrid.z) || y >= i32(params.playerGrid.w)) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return textureLoad(cellsTex, vec2<i32>(x, y), 0);
}

fn encodeSceneDepth(dist : f32) -> f32 {
  let depthFar = max(1e-3, params.depthFar.x);
  return clamp(dist / depthFar, 0.0, 1.0);
}

fn makeWorldOut(color : vec4<f32>, dist : f32) -> WorldFsOut {
  var out : WorldFsOut;
  out.color = color;
  out.depth = encodeSceneDepth(dist);
  return out;
}

fn isObstacleCell(cell : vec4<f32>) -> bool {
  return cell.w > 0.001 && cell.w < 0.999;
}

fn isCasterCell(cell : vec4<f32>) -> bool {
  return cell.w > 0.001;
}

fn casterRadiusFromCell(cell : vec4<f32>) -> f32 {
  if (cell.w >= 0.999) {
    return 0.5;
  }
  return max(0.12, cell.w);
}

fn floorHeightFromCell(cell : vec4<f32>) -> f32 {
  return params.heightShadowTorch.x + cell.y * 255.0 * (params.heightShadowTorch.y / 255.0);
}

fn ceilHeightFromCell(cell : vec4<f32>) -> f32 {
  return params.heightShadowTorch.x + cell.z * 255.0 * (params.heightShadowTorch.y / 255.0);
}

fn casterHalfExtFromCell(cell : vec4<f32>) -> vec2<f32> {
  if (cell.w >= 0.999) {
    return vec2<f32>(0.5, 0.5);
  }
  let r = casterRadiusFromCell(cell);
  let halfExt = clamp(r * 0.6, 0.06, 0.4);
  return vec2<f32>(halfExt, halfExt);
}

fn rayIntersectsBox2D(origin : vec2<f32>, dir : vec2<f32>, center : vec2<f32>, halfExt : vec2<f32>, maxT : f32) -> bool {
  let bMin = center - halfExt;
  let bMax = center + halfExt;
  if (abs(dir.x) < 1e-5 && (origin.x < bMin.x || origin.x > bMax.x)) {
    return false;
  }
  if (abs(dir.y) < 1e-5 && (origin.y < bMin.y || origin.y > bMax.y)) {
    return false;
  }
  var tx1 = -1e9;
  var tx2 = 1e9;
  var ty1 = -1e9;
  var ty2 = 1e9;
  if (abs(dir.x) >= 1e-5) {
    tx1 = (bMin.x - origin.x) / dir.x;
    tx2 = (bMax.x - origin.x) / dir.x;
  }
  if (abs(dir.y) >= 1e-5) {
    ty1 = (bMin.y - origin.y) / dir.y;
    ty2 = (bMax.y - origin.y) / dir.y;
  }
  let tEntry = max(min(tx1, tx2), min(ty1, ty2));
  let tExit = min(max(tx1, tx2), max(ty1, ty2));
  if (tExit <= max(0.0, tEntry)) {
    return false;
  }
  if (tEntry >= maxT) {
    return false;
  }
  return tExit > 0.0;
}

fn segmentIntersectsPrism(
  startPos : vec3<f32>,
  endPos : vec3<f32>,
  center : vec2<f32>,
  halfExt : vec2<f32>,
  minZ : f32,
  maxZ : f32,
  maxT : f32
) -> bool {
  let dir = endPos - startPos;
  let bMin = vec3<f32>(center - halfExt, minZ);
  let bMax = vec3<f32>(center + halfExt, maxZ);
  var tMin = 0.0;
  var tMax = maxT;

  if (abs(dir.x) < 1e-6) {
    if (startPos.x < bMin.x || startPos.x > bMax.x) {
      return false;
    }
  } else {
    let tx1 = (bMin.x - startPos.x) / dir.x;
    let tx2 = (bMax.x - startPos.x) / dir.x;
    tMin = max(tMin, min(tx1, tx2));
    tMax = min(tMax, max(tx1, tx2));
    if (tMax <= tMin) {
      return false;
    }
  }

  if (abs(dir.y) < 1e-6) {
    if (startPos.y < bMin.y || startPos.y > bMax.y) {
      return false;
    }
  } else {
    let ty1 = (bMin.y - startPos.y) / dir.y;
    let ty2 = (bMax.y - startPos.y) / dir.y;
    tMin = max(tMin, min(ty1, ty2));
    tMax = min(tMax, max(ty1, ty2));
    if (tMax <= tMin) {
      return false;
    }
  }

  if (abs(dir.z) < 1e-6) {
    if (startPos.z < bMin.z || startPos.z > bMax.z) {
      return false;
    }
  } else {
    let tz1 = (bMin.z - startPos.z) / dir.z;
    let tz2 = (bMax.z - startPos.z) / dir.z;
    tMin = max(tMin, min(tz1, tz2));
    tMax = min(tMax, max(tz1, tz2));
    if (tMax <= tMin) {
      return false;
    }
  }

  return tMax > max(tMin, 0.0);
}

fn cellOccludesSegment(
  cell : vec4<f32>,
  cellX : i32,
  cellY : i32,
  enterNormal : vec2<f32>,
  startPos : vec3<f32>,
  endPos : vec3<f32>
) -> bool {
  if (!isCasterCell(cell)) {
    return false;
  }
  let isWall = cell.w >= 0.999;
  var center = vec2<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5);
  var halfExt = casterHalfExtFromCell(cell);
  if (isWall && (abs(enterNormal.x) > 0.5 || abs(enterNormal.y) > 0.5)) {
    let t = 0.03;
    if (abs(enterNormal.x) > 0.5) {
      halfExt.x = min(halfExt.x, t);
      center.x = center.x + enterNormal.x * (0.5 - halfExt.x);
    }
    if (abs(enterNormal.y) > 0.5) {
      halfExt.y = min(halfExt.y, t);
      center.y = center.y + enterNormal.y * (0.5 - halfExt.y);
    }
  }
  var zMin = floorHeightFromCell(cell);
  if (isWall) {
    zMin = min(zMin, params.focalEyeMinWall.z);
  }
  let zMax = ceilHeightFromCell(cell);
  if (zMax <= zMin + 0.01) {
    return false;
  }
  return segmentIntersectsPrism(startPos, endPos, center, halfExt, zMin, zMax, 0.9995);
}

fn stepBoundaryOccludesSegment(
  cellA : vec4<f32>,
  cellB : vec4<f32>,
  ax : i32,
  ay : i32,
  bx : i32,
  by : i32,
  startPos : vec3<f32>,
  endPos : vec3<f32>
) -> bool {
  if (!ENABLE_FLOOR_STEP_SHADOWS) {
    return false;
  }
  if (cellA.w >= 0.5 || cellB.w >= 0.5) {
    return false;
  }
  let hA = floorHeightFromCell(cellA);
  let hB = floorHeightFromCell(cellB);
  let dh = hB - hA;
  if (abs(dh) <= max(STEP_SHADOW_EPS, STEP_SHADOW_MIN_HEIGHT)) {
    return false;
  }
  let zMin = min(hA, hB);
  let zMax = max(hA, hB);
  if (zMax <= zMin + 0.01) {
    return false;
  }
  var center = vec2<f32>(0.0, 0.0);
  var halfExt = vec2<f32>(0.0, 0.0);
  let riserThickness = 0.03;
  if (ax != bx) {
    let edgeX = f32(max(ax, bx));
    center = vec2<f32>(edgeX, f32(ay) + 0.5);
    halfExt = vec2<f32>(riserThickness, 0.5);
  } else {
    let edgeY = f32(max(ay, by));
    center = vec2<f32>(f32(ax) + 0.5, edgeY);
    halfExt = vec2<f32>(0.5, riserThickness);
  }
  return segmentIntersectsPrism(startPos, endPos, center, halfExt, zMin, zMax, 0.9995);
}

fn wrapSignedAngle(a : f32) -> f32 {
  return floatMod(a + PI, TAU) - PI;
}

fn torchLightFalloff(normDist : f32) -> f32 {
  let body = exp(-1.35 * normDist * normDist);
  let fade = 1.0 - smoothstep(TORCH_LIGHT_FADE_START, TORCH_LIGHT_FADE_END, normDist);
  return body * fade;
}

fn torchShadowDrive(normDist : f32) -> f32 {
  let body = exp(-1.05 * normDist * normDist);
  let fade = 1.0 - smoothstep(TORCH_SHADOW_FADE_START, TORCH_SHADOW_FADE_END, normDist);
  return body * fade;
}

fn expandAngleSpan(ray : vec2<f32>, baseAngle : f32, minDeltaIn : f32, maxDeltaIn : f32) -> vec2<f32> {
  if (dot(ray, ray) < 1e-8) {
    return vec2<f32>(minDeltaIn, maxDeltaIn);
  }
  let delta = wrapSignedAngle(atan2(ray.y, ray.x) - baseAngle);
  return vec2<f32>(min(minDeltaIn, delta), max(maxDeltaIn, delta));
}

fn edgeDiffusion(proj : f32, distHit : f32, hitXY : vec2<f32>) -> f32 {
  let contact = smoothstep(0.04, 0.32, max(0.0, proj));
  let baseNear = 0.008;
  let baseFar = max(0.05, OBSTACLE_SHADOW_SOFT * 0.5);
  let diffused = mix(baseNear, baseFar, contact) + max(0.0, proj) * SHADOW_DIFFUSION;
  let ripple = 1.0 + SHADOW_REFRACTION * sin(hitXY.x * 11.73 + hitXY.y * 7.91 + distHit * SHADOW_REFRACTION_FREQ);
  return max(0.006, diffused * ripple);
}

fn shadowHeightMask(distHit : f32, distCaster : f32, torchZ : f32, hitZ : f32, casterTop : f32) -> f32 {
  if (distHit < 1e-4) {
    return 0.0;
  }
  let zAtCaster = torchZ + (hitZ - torchZ) * (distCaster / distHit);
  let soft = 0.03 + min(0.18, distCaster * 0.02);
  return 1.0 - smoothstep(casterTop - soft, casterTop + soft, zAtCaster);
}

fn shadowStrengthFromBox(
  hitXY : vec2<f32>,
  casterCenter : vec2<f32>,
  casterHalfExt : vec2<f32>,
  torchPos : vec2<f32>,
  intensity : f32
) -> f32 {
  let toHit = hitXY - torchPos;
  let distHit = length(toHit);
  if (distHit < 0.05) {
    return 0.0;
  }
  let dir = toHit / max(distHit, 1e-4);
  if (!rayIntersectsBox2D(torchPos, dir, casterCenter, casterHalfExt, distHit + 0.02)) {
    return 0.0;
  }
  let toCaster = casterCenter - torchPos;
  let casterDist = length(toCaster);
  if (casterDist < 1e-4 || casterDist >= distHit - 0.01) {
    return 0.0;
  }
  let baseAngle = atan2(toCaster.y, toCaster.x);
  var minDelta = 1e9;
  var maxDelta = -1e9;
  let span0 = expandAngleSpan(casterCenter + vec2<f32>(-casterHalfExt.x, -casterHalfExt.y) - torchPos, baseAngle, minDelta, maxDelta);
  minDelta = span0.x;
  maxDelta = span0.y;
  let span1 = expandAngleSpan(casterCenter + vec2<f32>(-casterHalfExt.x, casterHalfExt.y) - torchPos, baseAngle, minDelta, maxDelta);
  minDelta = span1.x;
  maxDelta = span1.y;
  let span2 = expandAngleSpan(casterCenter + vec2<f32>(casterHalfExt.x, -casterHalfExt.y) - torchPos, baseAngle, minDelta, maxDelta);
  minDelta = span2.x;
  maxDelta = span2.y;
  let span3 = expandAngleSpan(casterCenter + vec2<f32>(casterHalfExt.x, casterHalfExt.y) - torchPos, baseAngle, minDelta, maxDelta);
  minDelta = span3.x;
  maxDelta = span3.y;
  if (maxDelta <= minDelta) {
    return 0.0;
  }
  let hitDelta = wrapSignedAngle(atan2(toHit.y, toHit.x) - baseAngle);
  let proj = distHit - casterDist;
  if (proj <= 0.0) {
    return 0.0;
  }
  var angularSoft = edgeDiffusion(proj, distHit, hitXY) / max(distHit, 1e-4);
  angularSoft = clamp(angularSoft * 0.4, 0.0005, 0.008);
  let insideMin = smoothstep(minDelta - angularSoft, minDelta + angularSoft, hitDelta);
  let insideMax = 1.0 - smoothstep(maxDelta - angularSoft, maxDelta + angularSoft, hitDelta);
  let core = insideMin * insideMax;
  let front = smoothstep(0.0, 0.12, proj);
  let decayLen = max(2.0, distHit * 0.9);
  let back = exp(-max(0.0, proj) / decayLen);
  return core * front * back * intensity;
}

fn accumulateShadowFromCell(
  currentShadow : f32,
  cell : vec4<f32>,
  cellX : i32,
  cellY : i32,
  enterNormal : vec2<f32>,
  startPos : vec3<f32>,
  endPos : vec3<f32>,
  hitXY : vec2<f32>,
  hitZ : f32,
  torchPos : vec2<f32>,
  torchZ : f32,
  intensity : f32,
  binaryOcclusion : bool
) -> f32 {
  if (!cellOccludesSegment(cell, cellX, cellY, enterNormal, startPos, endPos)) {
    return currentShadow;
  }
  if (cell.w >= 0.999 || binaryOcclusion) {
    return 1.0;
  }
  let center = vec2<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5);
  let halfExt = casterHalfExtFromCell(cell);
  let distHit = length(hitXY - torchPos);
  let distCaster = length(center - torchPos);
  if (distHit < 0.05 || distCaster < 1e-4 || distCaster >= distHit - 0.01) {
    return currentShadow;
  }
  let shape = shadowStrengthFromBox(hitXY, center, halfExt, torchPos, intensity);
  if (shape <= 1e-4) {
    return currentShadow;
  }
  let height = shadowHeightMask(distHit, distCaster, torchZ, hitZ, ceilHeightFromCell(cell));
  let local = clamp(shape * height, 0.0, 1.0);
  return currentShadow + local * (1.0 - currentShadow);
}

fn computeShadowForTorch(
  hitXY : vec2<f32>,
  hitZ : f32,
  targetX : i32,
  targetY : i32,
  surfaceNormal2D : vec2<f32>,
  torchPos : vec2<f32>,
  torchZ : f32,
  intensity : f32
) -> f32 {
  let targetCell = fetchCell(targetX, targetY);
  let surfaceIsFloor = abs(surfaceNormal2D.x) < 0.1 && abs(surfaceNormal2D.y) < 0.1;
  let binaryOcclusion = !surfaceIsFloor;
  let allowTargetCaster = surfaceIsFloor && isObstacleCell(targetCell);
  let startPos = vec3<f32>(torchPos, torchZ);
  let endPos = vec3<f32>(hitXY, hitZ);
  let toHit = hitXY - torchPos;
  let distXY = length(toHit);
  if (distXY < 0.01) {
    return 0.0;
  }
  let dir = toHit / distXY;
  var shadow = 0.0;
  var mapX = i32(floor(torchPos.x));
  var mapY = i32(floor(torchPos.y));
  let torchCellX = mapX;
  let torchCellY = mapY;
  let endX = i32(floor(hitXY.x));
  let endY = i32(floor(hitXY.y));
  let invDx = select(abs(1.0 / dir.x), 1e4, abs(dir.x) < 1e-4);
  let invDy = select(abs(1.0 / dir.y), 1e4, abs(dir.y) < 1e-4);
  let stepX = select(1, -1, dir.x < 0.0);
  let stepY = select(1, -1, dir.y < 0.0);
  var sideDistX = select((f32(mapX + 1) - torchPos.x) * invDx, (torchPos.x - f32(mapX)) * invDx, stepX == -1);
  var sideDistY = select((f32(mapY + 1) - torchPos.y) * invDy, (torchPos.y - f32(mapY)) * invDy, stepY == -1);

  for (var s : i32 = 0; s < SHADOW_DDA_STEPS; s = s + 1) {
    if (mapX == endX && mapY == endY) {
      break;
    }
    let edgeDelta = abs(sideDistX - sideDistY);
    let cornerStep = edgeDelta <= 1e-4;
    if (sideDistX < sideDistY && !cornerStep) {
      let prevX = mapX;
      let prevY = mapY;
      mapX = mapX + stepX;
      sideDistX = sideDistX + invDx;
      if (!inBounds(mapX, mapY)) {
        break;
      }
      let prevCell = fetchCell(prevX, prevY);
      let currCell = fetchCell(mapX, mapY);
      if (stepBoundaryOccludesSegment(prevCell, currCell, prevX, prevY, mapX, mapY, startPos, endPos)) {
        return 1.0;
      }
      let isTargetCell = mapX == targetX && mapY == targetY;
      if (!(mapX == torchCellX && mapY == torchCellY) && (!isTargetCell || allowTargetCaster)) {
        shadow = accumulateShadowFromCell(shadow, currCell, mapX, mapY, vec2<f32>(-f32(stepX), 0.0), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
        if (shadow >= 0.995) {
          return shadow;
        }
      }
      if (isTargetCell) {
        break;
      }
    } else if (sideDistY < sideDistX && !cornerStep) {
      let prevX = mapX;
      let prevY = mapY;
      mapY = mapY + stepY;
      sideDistY = sideDistY + invDy;
      if (!inBounds(mapX, mapY)) {
        break;
      }
      let prevCell = fetchCell(prevX, prevY);
      let currCell = fetchCell(mapX, mapY);
      if (stepBoundaryOccludesSegment(prevCell, currCell, prevX, prevY, mapX, mapY, startPos, endPos)) {
        return 1.0;
      }
      let isTargetCell = mapX == targetX && mapY == targetY;
      if (!(mapX == torchCellX && mapY == torchCellY) && (!isTargetCell || allowTargetCaster)) {
        shadow = accumulateShadowFromCell(shadow, currCell, mapX, mapY, vec2<f32>(0.0, -f32(stepY)), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
        if (shadow >= 0.995) {
          return shadow;
        }
      }
      if (isTargetCell) {
        break;
      }
    } else {
      let prevX = mapX;
      let prevY = mapY;
      let sideAX = mapX + stepX;
      let sideAY = mapY;
      let sideBX = mapX;
      let sideBY = mapY + stepY;
      sideDistX = sideDistX + invDx;
      sideDistY = sideDistY + invDy;
      mapX = mapX + stepX;
      mapY = mapY + stepY;

      let prevCell = fetchCell(prevX, prevY);
      if (inBounds(sideAX, sideAY)) {
        let cellA = fetchCell(sideAX, sideAY);
        if (stepBoundaryOccludesSegment(prevCell, cellA, prevX, prevY, sideAX, sideAY, startPos, endPos)) {
          return 1.0;
        }
        let isTargetA = sideAX == targetX && sideAY == targetY;
        if (!(sideAX == torchCellX && sideAY == torchCellY) && (!isTargetA || allowTargetCaster)) {
          shadow = accumulateShadowFromCell(shadow, cellA, sideAX, sideAY, vec2<f32>(-f32(stepX), 0.0), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
          if (shadow >= 0.995) {
            return shadow;
          }
        }
      }
      if (inBounds(sideBX, sideBY)) {
        let cellB = fetchCell(sideBX, sideBY);
        if (stepBoundaryOccludesSegment(prevCell, cellB, prevX, prevY, sideBX, sideBY, startPos, endPos)) {
          return 1.0;
        }
        let isTargetB = sideBX == targetX && sideBY == targetY;
        if (!(sideBX == torchCellX && sideBY == torchCellY) && (!isTargetB || allowTargetCaster)) {
          shadow = accumulateShadowFromCell(shadow, cellB, sideBX, sideBY, vec2<f32>(0.0, -f32(stepY)), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
          if (shadow >= 0.995) {
            return shadow;
          }
        }
      }
      if (!inBounds(mapX, mapY)) {
        break;
      }
      let isTargetDiag = mapX == targetX && mapY == targetY;
      if (!(mapX == torchCellX && mapY == torchCellY) && (!isTargetDiag || allowTargetCaster)) {
        let cellDiag = fetchCell(mapX, mapY);
        shadow = accumulateShadowFromCell(shadow, cellDiag, mapX, mapY, vec2<f32>(0.0, 0.0), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
        if (shadow >= 0.995) {
          return shadow;
        }
      }
      if (mapX == targetX && mapY == targetY) {
        break;
      }
    }
  }

  if (allowTargetCaster && inBounds(targetX, targetY)) {
    let tCell = fetchCell(targetX, targetY);
    shadow = accumulateShadowFromCell(shadow, tCell, targetX, targetY, vec2<f32>(0.0, 0.0), startPos, endPos, hitXY, hitZ, torchPos, torchZ, intensity, binaryOcclusion);
  }

  return clamp(shadow, 0.0, 1.0);
}

fn accumulateTorchLit(
  worldPos : vec3<f32>,
  normal : vec3<f32>,
  targetX : i32,
  targetY : i32,
  surfaceNormal2D : vec2<f32>
) -> TorchLitResult {
  let surfaceIsFloor = abs(surfaceNormal2D.x) < 0.1 && abs(surfaceNormal2D.y) < 0.1;
  var total = 0.0;
  var shadowBlend = 0.0;
  var primaryStrength = -1.0;
  var primaryShadow = 0.0;
  var shadowStack = 1.0;
  var sumStrength = 0.0;
  var dirSum2D = vec2<f32>(0.0, 0.0);
  let torchAmbient = 0.5;
  var primaryDir2D = vec2<f32>(0.0, 0.0);
  var primaryStrengthOut = 0.0;
  let torchCount = min(params.atlasCounts.w, MAX_WORLD_TORCH);
  for (var i : u32 = 0u; i < MAX_WORLD_TORCH; i = i + 1u) {
    if (i >= torchCount) {
      break;
    }
    let light = torchLights[i];
    var toL = light.posRad.xyz - worldPos;
    let toLxy = light.posRad.xy - worldPos.xy;
    let distXY = length(toLxy);
    toL.z = toL.z * 0.5;
    let dist = length(toL);
    let lightRadius = light.posRad.w;
    let shadowRadiusScale = max(1.0, params.heightShadowTorch.w);
    let shadowReach = lightRadius * shadowRadiusScale * SHADOW_OCCLUSION_RADIUS_SCALE * 1.75;
    if (distXY >= shadowReach) {
      continue;
    }
    let L = normalize(toL);
    let ndotlRaw = dot(L, normal);
    if (ndotlRaw <= 0.0) {
      continue;
    }
    let ndotl = ndotlRaw * 0.5 + 0.5;
    let rawStrength = torchLightFalloff(dist / max(lightRadius, 1e-4)) * light.intensityColor.x;
    if (rawStrength <= 0.001) {
      continue;
    }
    let shadowDrive = torchShadowDrive(distXY / max(lightRadius, 1e-4)) * light.intensityColor.x;
    let shadowFactor = computeShadowForTorch(worldPos.xy, worldPos.z, targetX, targetY, surfaceNormal2D, light.posRad.xy, light.posRad.z, light.intensityColor.x);
    var shadowWeight = clamp(max(shadowDrive * 2.2, rawStrength * 1.8), 0.0, 1.0);
    if (!surfaceIsFloor) {
      shadowWeight = clamp(rawStrength * 2.0, 0.0, 1.0);
    }
    shadowStack = shadowStack * (1.0 - shadowFactor * shadowWeight);
    let shadowMul = select(1.0 - clamp(shadowFactor * SHADOW_DARKEN, 0.0, SHADOW_DARKEN), 0.0, shadowFactor > 0.98);
    let atten = rawStrength * TORCH_FALLOFF * shadowMul;
    if (rawStrength > primaryStrength) {
      primaryStrength = rawStrength;
      primaryShadow = shadowFactor * shadowWeight;
    }
    sumStrength = sumStrength + rawStrength;
    let dirLen = length(toLxy);
    if (dirLen > 1e-4) {
      dirSum2D = dirSum2D + (toLxy / dirLen) * rawStrength;
    }
    total = total + (torchAmbient + ndotl * (1.0 - torchAmbient)) * atten;
  }
  let combinedShadow = 1.0 - shadowStack;
  shadowBlend = select(primaryShadow, max(primaryShadow, combinedShadow), surfaceIsFloor);
  let shadowPresence = select(
    smoothstep(0.08, 0.35, sumStrength),
    smoothstep(0.02, 0.22, sumStrength),
    surfaceIsFloor
  );
  shadowBlend = shadowBlend * shadowPresence;
  if (sumStrength > 1e-4) {
    let dirLen = length(dirSum2D);
    primaryDir2D = select(normalize(params.lightDirElevIntensity.xy), dirSum2D / dirLen, dirLen > 1e-4);
    primaryStrengthOut = sumStrength;
  } else {
    primaryDir2D = normalize(params.lightDirElevIntensity.xy);
    primaryStrengthOut = 0.0;
  }
  return TorchLitResult(total, shadowBlend, primaryDir2D, primaryStrengthOut);
}

fn globalDirectionalShade(normal : vec3<f32>) -> f32 {
  let n = normalize(normal);
  let sun = normalize(vec3<f32>(params.lightDirElevIntensity.xy, max(0.05, params.lightDirElevIntensity.z)));
  let ndotl = max(0.0, dot(n, sun));
  let up = clamp(n.z, 0.0, 1.0);
  let ambient = mix(0.03, 0.11, up) + 0.03 * params.lightDirElevIntensity.w;
  let diffuseGain = mix(0.18, 0.5, up);
  let diffuse = ndotl * diffuseGain * (0.35 + 0.65 * params.lightDirElevIntensity.w);
  return clamp(ambient + diffuse, 0.0, 1.0);
}

fn viewShadowFade(_dist : f32) -> f32 {
  return 1.0;
}

@fragment
fn fsMain(@builtin(position) fragPos : vec4<f32>) -> WorldFsOut {
  let frag = fragPos.xy;
  let resolution = params.resolution;
  let focalLength = params.focalEyeMinWall.x;
  let eyeZ = params.focalEyeMinWall.y;
  let minFloor = params.focalEyeMinWall.z;
  let wallUScale = params.focalEyeMinWall.w;
  let heightMin = params.heightShadowTorch.x;
  let heightRange = params.heightShadowTorch.y;
  let shadowStrength = params.heightShadowTorch.z;

  let cameraX = 2.0 * frag.x / resolution.x - 1.0;
  let rayDir = params.camDir + params.plane * cameraX;
  if (abs(rayDir.x) < 1e-5 && abs(rayDir.y) < 1e-5) {
    return makeWorldOut(vec4<f32>(0.0, 0.0, 0.0, 1.0), params.depthFar.x);
  }

  let horizon = resolution.y * 0.5;
  var mapX = i32(floor(params.camPos.x));
  var mapY = i32(floor(params.camPos.y));
  let deltaDistX = abs(1.0 / rayDir.x);
  let deltaDistY = abs(1.0 / rayDir.y);
  let stepX = select(1, -1, rayDir.x < 0.0);
  let stepY = select(1, -1, rayDir.y < 0.0);
  var sideDistX = select((f32(mapX + 1) - params.camPos.x) * deltaDistX, (params.camPos.x - f32(mapX)) * deltaDistX, stepX == -1);
  var sideDistY = select((f32(mapY + 1) - params.camPos.y) * deltaDistY, (params.camPos.y - f32(mapY)) * deltaDistY, stepY == -1);
  var side = 0;

  if (mapX != i32(params.playerGrid.x) || mapY != i32(params.playerGrid.y)) {
    if (sideDistX < sideDistY) {
      sideDistX = sideDistX + deltaDistX;
      mapX = mapX + stepX;
      side = 0;
    } else {
      sideDistY = sideDistY + deltaDistY;
      mapY = mapY + stepY;
      side = 1;
    }
  }

  var wallDist = 1e9;
  var wallCol = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var wallHit = false;
  var lineTop = horizon;
  var lineBottom = horizon;
  var extendedBottom = horizon;

  var sideDistClosest = 1e9;
  var sideColClosest = vec3<f32>(0.0, 0.0, 0.0);
  var sideHit = false;

  var floorDist = 1e9;
  var floorH = 0.0;
  var floorHit = false;

  let maxSteps = i32(params.atlasCounts.z);
  for (var i : i32 = 0; i < maxSteps; i = i + 1) {
    let steppedXPreview = sideDistX < sideDistY;
    let nextDist = min(sideDistX, sideDistY);
    let nextMapX = mapX + select(0, stepX, steppedXPreview);
    let nextMapY = mapY + select(stepY, 0, steppedXPreview);
    if (!inBounds(mapX, mapY) || !inBounds(nextMapX, nextMapY)) {
      break;
    }
    let currCell = fetchCell(mapX, mapY);
    let nextCell = fetchCell(nextMapX, nextMapY);
    if (currCell.w < 0.5 && nextCell.w < 0.5) {
      let currH = heightMin + currCell.y * 255.0 * (heightRange / 255.0);
      let nextH = heightMin + nextCell.y * 255.0 * (heightRange / 255.0);
      let dh = nextH - currH;
      if (abs(dh) > 0.001) {
        let bottomZ = min(currH, nextH);
        let topZ = max(currH, nextH);
        let lineTopR = horizon - (topZ - eyeZ) * focalLength / nextDist;
        let lineBottomR = horizon - (bottomZ - eyeZ) * focalLength / nextDist;
        if (frag.y >= min(lineTopR, lineBottomR) && frag.y <= max(lineTopR, lineBottomR)) {
          let vFrac = (frag.y - lineTopR) / max(1.0, lineBottomR - lineTopR);
          let worldV = vFrac * abs(dh);
          let fracV = fract(bottomZ + worldV);
          let wallX = select(params.camPos.x + nextDist * rayDir.x, params.camPos.y + nextDist * rayDir.y, steppedXPreview);
          let fracU = fract(wallX);
          let tex = textureSampleLevel(floorTex, floorSamp, vec2<f32>(fracU, fracV), 0.0);
          let normal = select(vec3<f32>(0.0, -f32(stepY), 0.0), vec3<f32>(-f32(stepX), 0.0, 0.0), steppedXPreview);
          let normal2D = select(vec2<f32>(0.0, -f32(stepY)), vec2<f32>(-f32(stepX), 0.0), steppedXPreview);
          let worldPos = vec3<f32>(params.camPos + rayDir * nextDist, bottomZ + worldV);
          let torch = accumulateTorchLit(worldPos, normal, i32(floor(worldPos.x)), i32(floor(worldPos.y)), normal2D);
          let litSide = clamp(torch.lit * TORCH_SIDE_BOOST, 0.0, 1.5);
          let shadowFloorVal = mix(0.3, 0.12, shadowStrength);
          var shade = max(shadowFloorVal, globalDirectionalShade(normal));
          if (TORCH_ONLY > 0.5) {
            shade = 1.0;
          }
          let torchLight = litSide * TORCH_LIGHT_SCALE;
          let warmShift = 0.75 + 0.45 * torchLight;
          let torchAdd = TORCH_COLOR * vec3<f32>(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;
          var keyShadow = clamp(torch.shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
          keyShadow = keyShadow * smoothstep(0.06, 0.28, torchLight);
          keyShadow = keyShadow * viewShadowFade(nextDist);
          let col = tex.rgb * shade * (1.0 - keyShadow) + tex.rgb * torchLight + torchAdd;
          if (nextDist < sideDistClosest) {
            sideDistClosest = nextDist;
            sideColClosest = col;
            sideHit = true;
          }
        }
      }
    }

    let steppedX = sideDistX < sideDistY;
    if (steppedX) {
      sideDistX = sideDistX + deltaDistX;
      mapX = mapX + stepX;
      side = 0;
    } else {
      sideDistY = sideDistY + deltaDistY;
      mapY = mapY + stepY;
      side = 1;
    }
    if (!inBounds(mapX, mapY)) {
      break;
    }
    let cell = fetchCell(mapX, mapY);
    if (cell.w > 0.5) {
      var perpDist = select(
        (f32(mapY) - params.camPos.y + f32(1 - stepY) * 0.5) / rayDir.y,
        (f32(mapX) - params.camPos.x + f32(1 - stepX) * 0.5) / rayDir.x,
        side == 0
      );
      if (perpDist < 0.001) {
        perpDist = 0.001;
      }
      let wallFloorH = heightMin + cell.y * 255.0 * (heightRange / 255.0);
      let ceilH = heightMin + cell.z * 255.0 * (heightRange / 255.0);
      lineTop = horizon - (ceilH - eyeZ) * focalLength / perpDist;
      lineBottom = horizon - (wallFloorH - eyeZ) * focalLength / perpDist;
      extendedBottom = max(lineBottom, horizon - ((minFloor - eyeZ) * focalLength / perpDist));
      var wallX = select(params.camPos.x + perpDist * rayDir.x, params.camPos.y + perpDist * rayDir.y, side == 0);
      wallX = fract(wallX);
      let u = fract(wallX * wallUScale);
      let globalV = (frag.y - lineTop) / max(1.0, extendedBottom - lineTop);
      let worldZ = eyeZ + (horizon - frag.y) * (perpDist / focalLength);
      let tileId = i32(cell.x * 255.0 + 0.5);
      let atlasCols = i32(params.atlasCounts.x);
      let atlasRows = i32(params.atlasCounts.y);
      let atlasUV = (vec2<f32>(f32(tileId % atlasCols), f32(tileId / atlasCols)) + vec2<f32>(u, globalV)) / vec2<f32>(f32(atlasCols), f32(atlasRows));
      let tex = textureSampleLevel(wallAtlasTex, wallAtlasSamp, atlasUV, 0.0);
      if (tex.a > 0.04 && frag.y >= lineTop && frag.y <= extendedBottom) {
        let shadowFloorVal = mix(0.3, 0.12, shadowStrength);
        let sideFactor = select(0.85, 1.0, side == 0);
        let normal2D = select(vec2<f32>(0.0, f32(stepY)), vec2<f32>(f32(stepX), 0.0), side == 0);
        let grad = max(0.35, 1.0 - 0.18 * globalV);
        let wallNormalTorch = vec3<f32>(-normal2D, 0.0);
        var shade = max(shadowFloorVal, globalDirectionalShade(wallNormalTorch));
        if (TORCH_ONLY > 0.5) {
          shade = 1.0;
        }
        var planeCoord = 0.0;
        var t = 0.0;
        if (side == 0) {
          planeCoord = f32(mapX) + select(1.0, 0.0, stepX > 0);
          t = (planeCoord - params.camPos.x) / rayDir.x;
        } else {
          planeCoord = f32(mapY) + select(1.0, 0.0, stepY > 0);
          t = (planeCoord - params.camPos.y) / rayDir.y;
        }
        let hitXY = params.camPos + rayDir * t;
        let exactWorldPos = vec3<f32>(hitXY, worldZ);
        let torch = accumulateTorchLit(exactWorldPos, wallNormalTorch, mapX, mapY, normal2D);
        let litWall = clamp(torch.lit * TORCH_WALL_BOOST, 0.0, 1.5);
        let primaryDir2D = torch.primaryDir2D;
        let primaryStrength = torch.primaryStrength;
        let keyDir2D = select(normalize(params.lightDirElevIntensity.xy), normalize(primaryDir2D), primaryStrength > 0.0001);
        let dotLight = dot(normal2D, keyDir2D);
        let lightFactor = 0.6 + 0.4 * dotLight;
        let keyStrength = clamp(primaryStrength, 0.0, 1.0);
        var litShade = shade * sideFactor * (1.0 - params.lightDirElevIntensity.w + params.lightDirElevIntensity.w * lightFactor * max(0.2, keyStrength));
        if (TORCH_ONLY > 0.5) {
          litShade = shade * sideFactor;
        }
        let rowShade = litShade * grad;
        let torchLight = litWall * TORCH_LIGHT_SCALE;
        let warmShift = 0.75 + 0.45 * torchLight;
        let torchAdd = TORCH_COLOR * vec3<f32>(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;
        var keyShadow = clamp(torch.shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
        keyShadow = keyShadow * smoothstep(0.06, 0.28, torchLight);
        keyShadow = keyShadow * viewShadowFade(perpDist);
        let finalCol = tex.rgb * rowShade * (1.0 - keyShadow) + tex.rgb * torchLight + torchAdd;
        wallCol = vec4<f32>(finalCol, tex.a);
        wallDist = perpDist;
        wallHit = true;
      }
      break;
    }
  }

  let tanV = (frag.y - horizon) / focalLength;
  if (tanV > 0.0) {
    var fMapX = i32(floor(params.camPos.x));
    var fMapY = i32(floor(params.camPos.y));
    var fSideDistX = select((f32(fMapX + 1) - params.camPos.x) * deltaDistX, (params.camPos.x - f32(fMapX)) * deltaDistX, rayDir.x < 0.0);
    var fSideDistY = select((f32(fMapY + 1) - params.camPos.y) * deltaDistY, (params.camPos.y - f32(fMapY)) * deltaDistY, rayDir.y < 0.0);
    var fCurrDist = 0.0;
    if (fMapX != i32(params.playerGrid.x) || fMapY != i32(params.playerGrid.y)) {
      let firstNext = min(fSideDistX, fSideDistY);
      fCurrDist = firstNext;
      if (fSideDistX < fSideDistY) {
        fSideDistX = fSideDistX + deltaDistX;
        fMapX = fMapX + stepX;
      } else {
        fSideDistY = fSideDistY + deltaDistY;
        fMapY = fMapY + stepY;
      }
    }
    for (var i : i32 = 0; i < maxSteps; i = i + 1) {
      let fNextDist = min(fSideDistX, fSideDistY);
      if (inBounds(fMapX, fMapY)) {
        let fCell = fetchCell(fMapX, fMapY);
        if (fCell.w < 0.5) {
          let h = heightMin + fCell.y * 255.0 * (heightRange / 255.0);
          if (h < eyeZ) {
            let dPlane = (eyeZ - h) / tanV;
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
        fSideDistX = fSideDistX + deltaDistX;
        fMapX = fMapX + stepX;
      } else {
        fSideDistY = fSideDistY + deltaDistY;
        fMapY = fMapY + stepY;
      }
      if (!inBounds(fMapX, fMapY) || fetchCell(fMapX, fMapY).w >= 0.5) {
        break;
      }
    }
  }

  let wallOccludes = wallHit && frag.y >= lineTop && frag.y <= extendedBottom;
  let sideOccludes = sideHit;
  if (floorHit && (!sideOccludes || floorDist < sideDistClosest) && (!wallOccludes || floorDist < wallDist)) {
    let hitPos = vec3<f32>(params.camPos + rayDir * floorDist, floorH);
    let tex = textureSampleLevel(floorTex, floorSamp, fract(hitPos.xy), 0.0);
    let torch = accumulateTorchLit(hitPos, vec3<f32>(0.0, 0.0, 1.0), i32(floor(hitPos.x)), i32(floor(hitPos.y)), vec2<f32>(0.0, 0.0));
    let litFloor = clamp(torch.lit * TORCH_FLOOR_BOOST, 0.0, 1.5);
    let shadowFloorVal = mix(0.3, 0.12, shadowStrength);
    var shade = max(shadowFloorVal, globalDirectionalShade(vec3<f32>(0.0, 0.0, 1.0)));
    if (TORCH_ONLY > 0.5) {
      shade = 1.0;
    }
    let torchLight = litFloor * TORCH_LIGHT_SCALE;
    let warmShift = 0.75 + 0.45 * torchLight;
    let torchAdd = TORCH_COLOR * vec3<f32>(0.35, 0.25 * warmShift, 0.2 * warmShift) * torchLight;
    let primaryStrength = torch.primaryStrength;
    let lightPresence = smoothstep(0.65, 1.5, primaryStrength);
    let shadowFade = smoothstep(0.5, 1.2, torchLight);
    var keyShadow = clamp(torch.shadowBlend * SHADOW_DARKEN, 0.0, SHADOW_DARKEN);
    keyShadow = keyShadow * (1.0 - lightPresence * 0.35);
    keyShadow = keyShadow * (1.0 - shadowFade * 0.2);
    keyShadow = keyShadow * viewShadowFade(floorDist);
    let floorCol = tex.rgb * shade * (1.0 - keyShadow) + tex.rgb * torchLight + torchAdd;
    return makeWorldOut(vec4<f32>(floorCol, 1.0), floorDist);
  }

  if (frag.y < horizon && !wallHit && !sideHit) {
    let skyT = clamp((frag.y / resolution.y) * 2.0, 0.0, 1.0);
    return makeWorldOut(vec4<f32>(mix(params.skyTop.rgb, params.skyBot.rgb, skyT), 1.0), params.depthFar.x);
  }

  let nearestDist = select(1e9, wallDist, wallHit);
  if (sideHit && sideDistClosest < nearestDist) {
    return makeWorldOut(vec4<f32>(sideColClosest, 1.0), sideDistClosest);
  }
  if (wallHit) {
    return makeWorldOut(wallCol, wallDist);
  }

  return makeWorldOut(vec4<f32>(0.0, 0.0, 0.0, 1.0), params.depthFar.x);
}
`;

  const overlaySpriteWgsl = `
const MAX_SPRITE_TORCH : u32 = 512u;

struct TorchLight {
  posRad : vec4<f32>,
  intensityColor : vec4<f32>,
};

struct OverlaySpriteParams {
  ndcRect : vec4<f32>,               // left, bottom, right, top
  uvRect : vec4<f32>,                // u0, vBottom, u1, vTop
  tint : vec4<f32>,
  lightDirElevIntensity : vec4<f32>, // dirX, dirY, elev, intensity
  spritePosHeight : vec4<f32>,       // x, y, z, height
  misc0 : vec4<f32>,                 // profile, depthAmount, spriteVFlip, depthShadeScale
  misc1 : vec4<f32>,                 // depth, shadowStrength, torchCount, padding
};

struct SpriteVsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) depth : f32,
};

struct SpriteFsOut {
  @location(0) color : vec4<f32>,
  @builtin(frag_depth) depth : f32,
};

@group(0) @binding(0) var<uniform> params : OverlaySpriteParams;
@group(0) @binding(1) var spriteTex : texture_2d<f32>;
@group(0) @binding(2) var spriteSamp : sampler;
@group(0) @binding(3) var<storage, read> torchLights : array<TorchLight>;

fn torchLightFalloff(normDist : f32) -> f32 {
  let body = exp(-1.35 * normDist * normDist);
  let fade = 1.0 - smoothstep(1.35, 2.35, normDist);
  return body * fade;
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> SpriteVsOut {
  let left = params.ndcRect.x;
  let bottom = params.ndcRect.y;
  let right = params.ndcRect.z;
  let top = params.ndcRect.w;
  let u0 = params.uvRect.x;
  let vBottom = params.uvRect.y;
  let u1 = params.uvRect.z;
  let vTop = params.uvRect.w;

  var pos = array<vec2<f32>, 6>(
    vec2<f32>(left, bottom),
    vec2<f32>(right, bottom),
    vec2<f32>(left, top),
    vec2<f32>(left, top),
    vec2<f32>(right, bottom),
    vec2<f32>(right, top)
  );
  var uv = array<vec2<f32>, 6>(
    vec2<f32>(u0, vBottom),
    vec2<f32>(u1, vBottom),
    vec2<f32>(u0, vTop),
    vec2<f32>(u0, vTop),
    vec2<f32>(u1, vBottom),
    vec2<f32>(u1, vTop)
  );

  var out : SpriteVsOut;
  out.pos = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = uv[vertexIndex];
  out.depth = clamp(params.misc1.x, 0.0, 1.0);
  return out;
}

@fragment
fn fsMain(in : SpriteVsOut) -> SpriteFsOut {
  let tex = textureSampleLevel(spriteTex, spriteSamp, in.uv, 0.0);
  if (tex.a < 0.01) {
    discard;
  }

  var normal = vec3<f32>(0.0, 0.0, 1.0);
  if (params.misc0.x > 0.5) {
    let nx = (in.uv.x - 0.5) * 2.0;
    let nz = sqrt(max(0.0, 1.0 - nx * nx));
    normal = normalize(vec3<f32>(nx, 0.0, nz));
  }

  let lightDir = normalize(vec3<f32>(
    params.lightDirElevIntensity.x,
    params.lightDirElevIntensity.y,
    params.lightDirElevIntensity.z
  ));
  let ndotl = max(0.0, dot(normal, lightDir));
  let dirShade = 0.6 + 0.4 * ndotl;
  let shadeBase = 1.0 - params.lightDirElevIntensity.w * params.misc0.y
    + params.lightDirElevIntensity.w * params.misc0.y * dirShade;
  let contrast = 1.0 + 0.25 * clamp(params.misc1.y, 0.0, 1.0);
  let shade = pow(max(1e-3, shadeBase), contrast);

  let vFrac = in.uv.y * (1.0 - params.misc0.z) + (1.0 - in.uv.y) * params.misc0.z;
  let worldPos = vec3<f32>(
    params.spritePosHeight.x,
    params.spritePosHeight.y,
    params.spritePosHeight.z + vFrac * params.spritePosHeight.w
  );

  let torchCount = min(u32(max(0.0, params.misc1.z)), MAX_SPRITE_TORCH);
  var torchLit = 0.0;
  for (var i : u32 = 0u; i < MAX_SPRITE_TORCH; i = i + 1u) {
    if (i >= torchCount) {
      break;
    }
    let light = torchLights[i];
    let toL = light.posRad.xyz - worldPos;
    let dist = length(toL);
    let lightRadius = light.posRad.w;
    let lightReach = lightRadius * 1.85;
    if (dist >= lightReach) {
      continue;
    }
    let L = normalize(toL);
    let ndotlTorch = max(0.0, dot(normal, L));
    let normDist = dist / max(lightRadius, 1e-4);
    let atten = torchLightFalloff(normDist) * light.intensityColor.x;
    let torchAmbient = 0.35;
    torchLit += (torchAmbient + ndotlTorch * (1.0 - torchAmbient)) * atten;
  }

  torchLit = torchLit * 1.3;
  let torchColor = vec3<f32>(1.0, 190.0 / 255.0, 130.0 / 255.0);
  let distanceShade = max(0.3, 1.0 - in.depth * params.misc0.w);
  let torchLight = torchLit * 0.6;
  let col = (tex.rgb * (shade + torchLight) + torchColor * torchLit * 0.35) * distanceShade;

  var out : SpriteFsOut;
  out.color = vec4<f32>(col, tex.a) * params.tint;
  out.depth = in.depth;
  return out;
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

  const flameFxWgsl = `
struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
};

@group(0) @binding(0) var fxTex : texture_2d<f32>;
@group(0) @binding(1) var fxSamp : sampler;

@vertex
fn vsMain(
  @location(0) clipPos : vec2<f32>,
  @location(1) uv : vec2<f32>,
  @location(2) depth : f32,
  @location(3) color : vec4<f32>
) -> VsOut {
  var out : VsOut;
  out.pos = vec4<f32>(clipPos, clamp(depth, 0.0, 1.0), 1.0);
  out.uv = uv;
  out.color = color;
  return out;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4<f32> {
  let tex = textureSampleLevel(fxTex, fxSamp, vec2<f32>(in.uv.x, 1.0 - in.uv.y), 0.0);
  let baseColor = tex * in.color;
  let edgeBand = smoothstep(0.02, 0.7, tex.a) * (1.0 - smoothstep(0.55, 0.98, tex.a));
  let warmEdge = vec3<f32>(1.0, 190.0 / 255.0, 130.0 / 255.0) * edgeBand * 0.22 * in.color.a;
  let litRgb = min(vec3<f32>(1.0), baseColor.rgb + warmEdge);
  return vec4<f32>(litRgb, baseColor.a);
}
`;

  const haloFlameWgsl = `
struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
};

@group(0) @binding(0) var fxTex : texture_2d<f32>;
@group(0) @binding(1) var fxSamp : sampler;

@vertex
fn vsMain(
  @location(0) clipPos : vec2<f32>,
  @location(1) uv : vec2<f32>,
  @location(2) depth : f32,
  @location(3) color : vec4<f32>
) -> VsOut {
  var out : VsOut;
  out.pos = vec4<f32>(clipPos, clamp(depth, 0.0, 1.0), 1.0);
  out.uv = uv;
  out.color = color;
  return out;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4<f32> {
  let tex = textureSampleLevel(fxTex, fxSamp, vec2<f32>(in.uv.x, 1.0 - in.uv.y), 0.0);
  return tex * in.color;
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
    _worldPipeline: null,
    _overlaySpritePipeline: null,
    _overlaySpriteNoDepthWritePipeline: null,
    _torchProjectPipeline: null,
    _torchProjectBindGroupLayout: null,
    _worldBindGroupLayout: null,
    _overlaySpriteBindGroupLayout: null,
    _overlaySpriteParamBuffers: [],
    _haloFlamePipelineAlpha: null,
    _haloFlamePipelineAdd: null,
    _haloFlameBindGroupLayout: null,
    _haloFlameBindGroupFlame: null,
    _haloFlameBindGroupHalo: null,
    _sampler: null,
    _floorSampler: null,
    _bloomSampler: null,
    _bloomPipeline: null,
    _bloomBindGroupLayout: null,
    _frameTexture: null,
    _frameTextureView: null,
    _frameDepthTexture: null,
    _frameDepthView: null,
    _sceneCellTexture: null,
    _sceneCellView: null,
    _sceneCellSizeKey: '',
    _sceneWallTexture: null,
    _sceneWallView: null,
    _sceneWallSizeKey: '',
    _sceneFloorTexture: null,
    _sceneFloorView: null,
    _sceneFloorSizeKey: '',
    _haloFxTexture: null,
    _haloFxView: null,
    _haloFxSizeKey: '',
    _flameFxTexture: null,
    _flameFxView: null,
    _flameFxSizeKey: '',
    _bloomPingTexture: null,
    _bloomPingView: null,
    _bloomPongTexture: null,
    _bloomPongView: null,
    _bindGroupLayout: null,
    _bindGroup: null,
    _worldBindGroup: null,
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
    _worldParamsBuffer: null,
    _worldParamArrayBuffer: new ArrayBuffer(192),
    _worldParamsDirty: false,
    _overlaySpriteParamsBuffer: null,
    _overlaySpriteParamArrayBuffer: new ArrayBuffer(OVERLAY_SPRITE_PARAM_BYTES),
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
    _torchFlameFxCpuData: new Float32Array(0),
    _torchHaloFxCpuData: new Float32Array(0),
    _torchFlameFxVertexCount: 0,
    _torchHaloFxVertexCount: 0,
    _torchFlameFxVertexCapacity: 0,
    _torchHaloFxVertexCapacity: 0,
    _torchFlameFxVertexBuffer: null,
    _torchHaloFxVertexBuffer: null,
    _torchFlameFxDirty: false,
    _torchHaloFxDirty: false,
    _haloParamsBuffer: null,
    _haloParamArrayBuffer: new ArrayBuffer(32),
    _torchParamArrayBuffer: new ArrayBuffer(64),
    _overlaySprites: [],
    _torchFlameSprites: [],
    _spriteTextureCache: new Map(),
    _lastTorchFrameAt: 0,
    _lastTorchUploadAt: 0,
    _lastTorchProjectAt: 0,
    _lastHaloFlameDrawAt: 0,
    _lastNativeWorldDrawAt: 0,
    _lastOverlaySpriteDrawAt: 0,
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
    _sceneResourceVersion: '',

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
      if (this._frameDepthTexture) {
        this._frameDepthTexture.destroy();
      }
      if (this._bloomPingTexture) {
        this._bloomPingTexture.destroy();
      }
      if (this._bloomPongTexture) {
        this._bloomPongTexture.destroy();
      }
      this._frameTexture = null;
      this._frameTextureView = null;
      this._frameDepthTexture = null;
      this._frameDepthView = null;
      this._bloomPingTexture = null;
      this._bloomPingView = null;
      this._bloomPongTexture = null;
      this._bloomPongView = null;
      this._bindGroup = null;
      this._torchProjectBindGroup = null;
      this._haloFlameBindGroup = null;
      this._haloFlameBindGroupFlame = null;
      this._haloFlameBindGroupHalo = null;
      this._bloomBindGroupH = null;
      this._bloomBindGroupV = null;
      this._frameWidth = 0;
      this._frameHeight = 0;
      this._bloomWidth = 0;
      this._bloomHeight = 0;
      this._bloomDownsample = 0;
      if (this._haloFxTexture) this._haloFxTexture.destroy();
      if (this._flameFxTexture) this._flameFxTexture.destroy();
      this._haloFxTexture = null;
      this._haloFxView = null;
      this._haloFxSizeKey = '';
      this._flameFxTexture = null;
      this._flameFxView = null;
      this._flameFxSizeKey = '';
      this._clearOverlaySpriteParamBuffers();
      this._haloFlameBindGroup = null;
      this._haloFlameBindGroupFlame = null;
      this._haloFlameBindGroupHalo = null;
    },

    _clearOverlaySpriteTextureCache() {
      for (const entry of this._spriteTextureCache.values()) {
        if (entry && entry.texture) {
          try {
            entry.texture.destroy();
          } catch (_) {}
        }
      }
      this._spriteTextureCache.clear();
    },

    _clearOverlaySpriteParamBuffers() {
      for (const buffer of this._overlaySpriteParamBuffers) {
        if (!buffer) continue;
        try {
          buffer.destroy();
        } catch (_) {}
      }
      this._overlaySpriteParamBuffers = [];
    },

    _resetSceneResources() {
      if (this._sceneCellTexture) this._sceneCellTexture.destroy();
      if (this._sceneWallTexture) this._sceneWallTexture.destroy();
      if (this._sceneFloorTexture) this._sceneFloorTexture.destroy();
      this._sceneCellTexture = null;
      this._sceneCellView = null;
      this._sceneCellSizeKey = '';
      this._sceneWallTexture = null;
      this._sceneWallView = null;
      this._sceneWallSizeKey = '';
      this._sceneFloorTexture = null;
      this._sceneFloorView = null;
      this._sceneFloorSizeKey = '';
      this._sceneResourceVersion = '';
      this._worldBindGroup = null;
    },

    shouldUseNativeWorld() {
      return this.mode === 'webgpu' && isNativeWorldEnabled();
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
        this._worldBindGroup = null;
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
        this._worldBindGroup = null;
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
      if (!this._worldParamsBuffer) {
        this._worldParamsBuffer = this._device.createBuffer({
          size: 192,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._worldParamsDirty = true;
        this._worldBindGroup = null;
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

    _ensureTorchFxVertexBuffer(bufferProp, capacityProp, floatCount) {
      if (!this._device) return null;
      const needed = Math.max(0, floatCount | 0);
      if (needed < 1) return this[bufferProp];
      if (this[bufferProp] && this[capacityProp] >= needed) {
        return this[bufferProp];
      }
      if (this[bufferProp]) {
        this[bufferProp].destroy();
      }
      this[bufferProp] = this._device.createBuffer({
        size: needed * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this[capacityProp] = needed;
      return this[bufferProp];
    },

    _ensureOverlaySpriteParamBuffer(index) {
      if (!this._device || index < 0) return null;
      if (this._overlaySpriteParamBuffers[index]) {
        return this._overlaySpriteParamBuffers[index];
      }
      const buffer = this._device.createBuffer({
        size: OVERLAY_SPRITE_PARAM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this._overlaySpriteParamBuffers[index] = buffer;
      return buffer;
    },

    _ensureSceneTexture(textureProp, sizeKeyProp, width, height) {
      if (!this._device) return null;
      const w = Math.max(1, width | 0);
      const h = Math.max(1, height | 0);
      const sizeKey = `${w}x${h}`;
      const currentTex = this[textureProp];
      if (currentTex && this[sizeKeyProp] === sizeKey) {
        return currentTex;
      }
      if (currentTex) currentTex.destroy();
      const tex = this._device.createTexture({
        size: { width: w, height: h, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      this[sizeKeyProp] = sizeKey;
      this[textureProp] = tex;
      return tex;
    },

    _ensureStaticEffectTexture(textureProp, viewProp, sizeKeyProp, source) {
      if (!this._device || !source) return null;
      const width = source.width || source.naturalWidth || 0;
      const height = source.height || source.naturalHeight || 0;
      if (width < 1 || height < 1) return null;
      const texture = this._ensureSceneTexture(textureProp, sizeKeyProp, width, height);
      if (!texture) return null;
      this._device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        { width, height, depthOrArrayLayers: 1 }
      );
      this[viewProp] = texture.createView();
      return this[viewProp];
    },

    _uploadSolidPixel(texture, rgba) {
      if (!this._device || !texture || !rgba) return;
      const pixel = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
      this._device.queue.writeTexture(
        { texture },
        pixel,
        { bytesPerRow: 4 },
        { width: 1, height: 1, depthOrArrayLayers: 1 }
      );
    },

    _ensureNativeWorldSceneResources() {
      if (!this._device) return false;
      const snapshot = this.getLegacySceneSnapshot();
      if (!snapshot || !snapshot.cellData) return false;
      if (this._sceneResourceVersion === snapshot.version && this._sceneCellView && this._sceneWallView && this._sceneFloorView) {
        return true;
      }

      this._sceneCellTexture = this._ensureSceneTexture('_sceneCellTexture', '_sceneCellSizeKey', snapshot.gridW, snapshot.gridH);
      if (!this._sceneCellTexture) return false;
      this._device.queue.writeTexture(
        { texture: this._sceneCellTexture },
        snapshot.cellData,
        { bytesPerRow: snapshot.gridW * 4 },
        { width: snapshot.gridW, height: snapshot.gridH, depthOrArrayLayers: 1 }
      );
      this._sceneCellView = this._sceneCellTexture.createView();

      const wallSource = snapshot.wallAtlasSource || null;
      const wallFallback = snapshot.wallFallback || new Uint8Array([60, 45, 30, 255]);
      const wallW = wallSource ? (wallSource.width || wallSource.naturalWidth || 1) : 1;
      const wallH = wallSource ? (wallSource.height || wallSource.naturalHeight || 1) : 1;
      this._sceneWallTexture = this._ensureSceneTexture('_sceneWallTexture', '_sceneWallSizeKey', wallW, wallH);
      if (!this._sceneWallTexture) return false;
      if (wallSource) {
        this._device.queue.copyExternalImageToTexture(
          { source: wallSource },
          { texture: this._sceneWallTexture },
          { width: wallW, height: wallH, depthOrArrayLayers: 1 }
        );
      } else {
        this._uploadSolidPixel(this._sceneWallTexture, wallFallback);
      }
      this._sceneWallView = this._sceneWallTexture.createView();

      const floorSource = snapshot.floorSource || null;
      const floorFallback = snapshot.floorFallback || new Uint8Array([34, 0, 0, 255]);
      const floorW = floorSource ? (floorSource.width || floorSource.naturalWidth || 1) : 1;
      const floorH = floorSource ? (floorSource.height || floorSource.naturalHeight || 1) : 1;
      this._sceneFloorTexture = this._ensureSceneTexture('_sceneFloorTexture', '_sceneFloorSizeKey', floorW, floorH);
      if (!this._sceneFloorTexture) return false;
      if (floorSource) {
        this._device.queue.copyExternalImageToTexture(
          { source: floorSource },
          { texture: this._sceneFloorTexture },
          { width: floorW, height: floorH, depthOrArrayLayers: 1 }
        );
      } else {
        this._uploadSolidPixel(this._sceneFloorTexture, floorFallback);
      }
      this._sceneFloorView = this._sceneFloorTexture.createView();

      this._sceneResourceVersion = snapshot.version || '';
      this._worldBindGroup = null;
      this._worldParamsDirty = true;
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
      this._clearOverlaySpriteTextureCache();
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

    _ensureNativeWorldResources() {
      if (
        !this._device ||
        !this._worldBindGroupLayout ||
        !this._worldPipeline ||
        !this._ensureTorchBuffers() ||
        !this._ensureNativeWorldSceneResources() ||
        !this._worldParamsBuffer ||
        !this._sceneCellView ||
        !this._sceneWallView ||
        !this._sceneFloorView ||
        !this._sampler ||
        !this._floorSampler ||
        !this._torchStorageBuffer
      ) {
        return false;
      }
      if (!this._worldBindGroup) {
        this._worldBindGroup = this._device.createBindGroup({
          layout: this._worldBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this._worldParamsBuffer } },
            { binding: 1, resource: this._sceneCellView },
            { binding: 2, resource: this._sceneWallView },
            { binding: 3, resource: this._sceneFloorView },
            { binding: 4, resource: this._sampler },
            { binding: 5, resource: this._floorSampler },
            { binding: 6, resource: { buffer: this._torchStorageBuffer } }
          ]
        });
      }
      return true;
    },

    _ensureHaloFlameTextures() {
      if (!this._device || !this.legacyRenderer) return false;
      if (typeof this.legacyRenderer.buildHaloTexture === 'function') {
        this.legacyRenderer.buildHaloTexture();
      }
      if (typeof this.legacyRenderer.buildFlameTexture === 'function') {
        this.legacyRenderer.buildFlameTexture();
      }
      const haloSource = this.legacyRenderer.haloTexSource || null;
      const flameSource = this.legacyRenderer.flameTexSource || null;
      if (!haloSource || !flameSource) return false;
      const haloView = this._ensureStaticEffectTexture('_haloFxTexture', '_haloFxView', '_haloFxSizeKey', haloSource);
      const flameView = this._ensureStaticEffectTexture('_flameFxTexture', '_flameFxView', '_flameFxSizeKey', flameSource);
      if (!haloView || !flameView) return false;
      this._haloFlameBindGroup = null;
      this._haloFlameBindGroupFlame = null;
      this._haloFlameBindGroupHalo = null;
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
        if (this._frameDepthTexture) this._frameDepthTexture.destroy();
        this._frameTexture = this._device.createTexture({
          size: { width: w, height: h, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._frameDepthTexture = this._device.createTexture({
          size: { width: w, height: h, depthOrArrayLayers: 1 },
          format: FRAME_DEPTH_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._frameTextureView = this._frameTexture.createView();
        this._frameDepthView = this._frameDepthTexture.createView();
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
      if (!this._ensureHaloFlameTextures()) return false;
      if (!this._haloFlameBindGroupFlame) {
        this._haloFlameBindGroupFlame = this._device.createBindGroup({
          layout: this._haloFlameBindGroupLayout,
          entries: [
            { binding: 0, resource: this._flameFxView },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: { buffer: this._torchParamsBuffer } },
            { binding: 3, resource: { buffer: this._torchStorageBuffer } }
          ]
        });
      }
      if (!this._haloFlameBindGroupHalo) {
        this._haloFlameBindGroupHalo = this._device.createBindGroup({
          layout: this._haloFlameBindGroupLayout,
          entries: [
            { binding: 0, resource: this._haloFxView },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: { buffer: this._torchParamsBuffer } },
            { binding: 3, resource: { buffer: this._torchStorageBuffer } }
          ]
        });
      }
      return true;
    },

    _uploadWorldParams() {
      if (!this._device || !this._worldParamsBuffer) return;
      const frame = this._torchParamsFrame || {};
      const snapshot = this.getLegacySceneSnapshot();
      if (!snapshot) return;
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
      const minFloor = Number.isFinite(frame.minFloor) ? frame.minFloor : 0.0;
      const wallUScale = Number.isFinite(frame.wallUScale) ? frame.wallUScale : 0.25;
      const lightDirX = Number.isFinite(frame.lightDirX) ? frame.lightDirX : -0.7;
      const lightDirY = Number.isFinite(frame.lightDirY) ? frame.lightDirY : -0.7;
      const lightElev = Number.isFinite(frame.lightElev) ? frame.lightElev : 0.6;
      const lightIntensity = Number.isFinite(frame.lightIntensity) ? frame.lightIntensity : 0.6;
      const skyTop = Array.isArray(frame.skyTopRgb) ? frame.skyTopRgb : [0.02, 0.02, 0.05];
      const skyBot = Array.isArray(frame.skyBotRgb) ? frame.skyBotRgb : [0.02, 0.02, 0.05];
      const shadowStrength = Number.isFinite(frame.shadowStrength) ? frame.shadowStrength : 0.6;
      const torchRadiusScale = Number.isFinite(frame.torchRadiusScale) ? frame.torchRadiusScale : 1.0;
      const depthFar = Number.isFinite(frame.depthFar) ? frame.depthFar : 64.0;
      const playerTileX = Number.isFinite(frame.playerTileX) ? Math.max(0, Math.floor(frame.playerTileX)) : 0;
      const playerTileY = Number.isFinite(frame.playerTileY) ? Math.max(0, Math.floor(frame.playerTileY)) : 0;
      const maxSteps = Number.isFinite(frame.maxSteps) ? Math.max(1, Math.floor(frame.maxSteps)) : 64;
      const dv = new DataView(this._worldParamArrayBuffer);
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
      dv.setFloat32(40, minFloor, true);
      dv.setFloat32(44, wallUScale, true);
      dv.setFloat32(48, lightDirX, true);
      dv.setFloat32(52, lightDirY, true);
      dv.setFloat32(56, lightElev, true);
      dv.setFloat32(60, lightIntensity, true);
      dv.setFloat32(64, Number.isFinite(skyTop[0]) ? skyTop[0] : 0.02, true);
      dv.setFloat32(68, Number.isFinite(skyTop[1]) ? skyTop[1] : 0.02, true);
      dv.setFloat32(72, Number.isFinite(skyTop[2]) ? skyTop[2] : 0.05, true);
      dv.setFloat32(76, 0.0, true);
      dv.setFloat32(80, Number.isFinite(skyBot[0]) ? skyBot[0] : 0.02, true);
      dv.setFloat32(84, Number.isFinite(skyBot[1]) ? skyBot[1] : 0.02, true);
      dv.setFloat32(88, Number.isFinite(skyBot[2]) ? skyBot[2] : 0.05, true);
      dv.setFloat32(92, 0.0, true);
      dv.setFloat32(96, Number.isFinite(snapshot.heightMin) ? snapshot.heightMin : 0.0, true);
      dv.setFloat32(100, Number.isFinite(snapshot.heightRange) ? snapshot.heightRange : 1.0, true);
      dv.setFloat32(104, shadowStrength, true);
      dv.setFloat32(108, torchRadiusScale, true);
      dv.setFloat32(112, depthFar, true);
      dv.setFloat32(116, 0.0, true);
      dv.setFloat32(120, 0.0, true);
      dv.setFloat32(124, 0.0, true);
      dv.setUint32(128, playerTileX >>> 0, true);
      dv.setUint32(132, playerTileY >>> 0, true);
      dv.setUint32(136, Math.max(1, snapshot.gridW | 0) >>> 0, true);
      dv.setUint32(140, Math.max(1, snapshot.gridH | 0) >>> 0, true);
      dv.setUint32(144, Math.max(1, snapshot.atlasCols | 0) >>> 0, true);
      dv.setUint32(148, Math.max(1, snapshot.atlasRows | 0) >>> 0, true);
      dv.setUint32(152, maxSteps >>> 0, true);
      dv.setUint32(156, this._torchCount >>> 0, true);
      for (let offset = 160; offset < 192; offset += 4) {
        dv.setUint32(offset, 0, true);
      }
      this._device.queue.writeBuffer(this._worldParamsBuffer, 0, this._worldParamArrayBuffer);
      this._worldParamsDirty = false;
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

      if (this._torchFlameFxDirty && this._torchFlameFxVertexCount > 0) {
        const flameFloatCount = this._torchFlameFxVertexCount * TORCH_FX_VERTEX_STRIDE_FLOATS;
        const flameBuffer = this._ensureTorchFxVertexBuffer('_torchFlameFxVertexBuffer', '_torchFlameFxVertexCapacity', flameFloatCount);
        if (flameBuffer) {
          this._device.queue.writeBuffer(
            flameBuffer,
            0,
            this._torchFlameFxCpuData.buffer,
            0,
            flameFloatCount * Float32Array.BYTES_PER_ELEMENT
          );
        }
        this._torchFlameFxDirty = false;
      } else if (this._torchFlameFxDirty) {
        this._torchFlameFxDirty = false;
      }

      if (this._torchHaloFxDirty && this._torchHaloFxVertexCount > 0) {
        const haloFloatCount = this._torchHaloFxVertexCount * TORCH_FX_VERTEX_STRIDE_FLOATS;
        const haloBuffer = this._ensureTorchFxVertexBuffer('_torchHaloFxVertexBuffer', '_torchHaloFxVertexCapacity', haloFloatCount);
        if (haloBuffer) {
          this._device.queue.writeBuffer(
            haloBuffer,
            0,
            this._torchHaloFxCpuData.buffer,
            0,
            haloFloatCount * Float32Array.BYTES_PER_ELEMENT
          );
        }
        this._torchHaloFxDirty = false;
      } else if (this._torchHaloFxDirty) {
        this._torchHaloFxDirty = false;
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

    _runNativeWorldPass(encoder) {
      if (!encoder || !this._worldPipeline || !this._frameTextureView || !this._frameDepthView || !this._worldBindGroup) return;
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this._frameTextureView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
          }
        ],
        depthStencilAttachment: {
          view: this._frameDepthView,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1.0
        }
      });
      pass.setPipeline(this._worldPipeline);
      pass.setBindGroup(0, this._worldBindGroup);
      pass.draw(6, 1, 0, 0);
      pass.end();
      this._lastNativeWorldDrawAt = Date.now();
    },

    _getOverlaySpriteSourceKey(source) {
      if (!source) return '';
      return source.src || source.currentSrc || source._webglKey || `${source.naturalWidth || source.width || 1}x${source.naturalHeight || source.height || 1}`;
    },

    _ensureOverlaySpriteTexture(source) {
      if (!this._device || !source) return null;
      const width = source.naturalWidth || source.width || 0;
      const height = source.naturalHeight || source.height || 0;
      if (width < 1 || height < 1) return null;
      const key = this._getOverlaySpriteSourceKey(source);
      if (!key) return null;
      const existing = this._spriteTextureCache.get(key);
      if (existing && existing.width === width && existing.height === height) {
        return existing;
      }
      if (existing && existing.texture) {
        try {
          existing.texture.destroy();
        } catch (_) {}
      }
      const texture = this._device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      this._device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        { width, height, depthOrArrayLayers: 1 }
      );
      const entry = {
        texture,
        view: texture.createView(),
        width,
        height
      };
      this._spriteTextureCache.set(key, entry);
      return entry;
    },

    _runOverlaySpritePass(encoder, sprites, forceNoDepthWrite = false) {
      if (
        !encoder ||
        !this._overlaySpritePipeline ||
        !this._overlaySpriteNoDepthWritePipeline ||
        !this._overlaySpriteBindGroupLayout ||
        !this._frameTextureView ||
        !this._frameDepthView ||
        !this._sampler ||
        !this._torchStorageBuffer
      ) {
        return;
      }
      const spriteList = Array.isArray(sprites) ? sprites : [];
      if (spriteList.length < 1) return;

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this._frameTextureView,
            loadOp: 'load',
            storeOp: 'store'
          }
        ],
        depthStencilAttachment: {
          view: this._frameDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store'
        }
      });

      const dv = new DataView(this._overlaySpriteParamArrayBuffer);
      const width = Math.max(1, this._frameWidth || LOW_RES_W);
      const height = Math.max(1, this._frameHeight || LOW_RES_H);
      let drew = false;
      let spriteIndex = 0;
      for (const sprite of spriteList) {
        if (!sprite || !sprite.texImg) continue;
        const textureEntry = this._ensureOverlaySpriteTexture(sprite.texImg);
        if (!textureEntry || !textureEntry.view) continue;
        const paramsBuffer = this._ensureOverlaySpriteParamBuffer(spriteIndex++);
        if (!paramsBuffer) continue;
        const left = (Number(sprite.drawLeft) / width) * 2 - 1;
        const right = (Number(sprite.drawRight) / width) * 2 - 1;
        const top = 1 - (Number(sprite.drawStartY) / height) * 2;
        const bottom = 1 - (Number(sprite.drawEndY) / height) * 2;
        if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        if (right <= left || top <= bottom) continue;

        dv.setFloat32(0, left, true);
        dv.setFloat32(4, bottom, true);
        dv.setFloat32(8, right, true);
        dv.setFloat32(12, top, true);
        dv.setFloat32(16, 0.0, true);
        dv.setFloat32(20, Number.isFinite(sprite.bottomV) ? sprite.bottomV : 1.0, true);
        dv.setFloat32(24, 1.0, true);
        dv.setFloat32(28, Number.isFinite(sprite.topV) ? sprite.topV : 0.0, true);
        dv.setFloat32(32, Number.isFinite(sprite.tintR) ? sprite.tintR : 1.0, true);
        dv.setFloat32(36, Number.isFinite(sprite.tintG) ? sprite.tintG : 1.0, true);
        dv.setFloat32(40, Number.isFinite(sprite.tintB) ? sprite.tintB : 1.0, true);
        dv.setFloat32(44, Number.isFinite(sprite.tintA) ? sprite.tintA : 1.0, true);

        const frame = this._torchParamsFrame || {};
        dv.setFloat32(48, Number.isFinite(frame.lightDirX) ? frame.lightDirX : -0.7, true);
        dv.setFloat32(52, Number.isFinite(frame.lightDirY) ? frame.lightDirY : -0.7, true);
        dv.setFloat32(56, Number.isFinite(frame.lightElev) ? frame.lightElev : 0.6, true);
        dv.setFloat32(60, Number.isFinite(frame.lightIntensity) ? frame.lightIntensity : 0.6, true);

        dv.setFloat32(64, Number.isFinite(sprite.lightX) ? sprite.lightX : 0.0, true);
        dv.setFloat32(68, Number.isFinite(sprite.lightY) ? sprite.lightY : 0.0, true);
        dv.setFloat32(72, Number.isFinite(sprite.baseZ) ? sprite.baseZ : 0.0, true);
        dv.setFloat32(76, Number.isFinite(sprite.worldHeight) ? sprite.worldHeight : 0.0, true);

        dv.setFloat32(80, Number.isFinite(sprite.profile) ? sprite.profile : 0.0, true);
        dv.setFloat32(84, Number.isFinite(sprite.depthAmount) ? sprite.depthAmount : 0.0, true);
        dv.setFloat32(88, Number.isFinite(sprite.spriteVFlip) ? sprite.spriteVFlip : 0.0, true);
        dv.setFloat32(92, Number.isFinite(sprite.depthShadeScale) ? sprite.depthShadeScale : 0.0, true);

        dv.setFloat32(96, Number.isFinite(sprite.depth) ? sprite.depth : 1.0, true);
        dv.setFloat32(100, Number.isFinite(frame.shadowStrength) ? frame.shadowStrength : 0.6, true);
        dv.setFloat32(104, this._torchCount >>> 0, true);
        dv.setFloat32(108, 0.0, true);

        this._device.queue.writeBuffer(paramsBuffer, 0, this._overlaySpriteParamArrayBuffer);
        const useNoDepthWrite = forceNoDepthWrite || !!sprite.noDepthWrite;
        pass.setPipeline(useNoDepthWrite ? this._overlaySpriteNoDepthWritePipeline : this._overlaySpritePipeline);
        const bindGroup = this._device.createBindGroup({
          layout: this._overlaySpriteBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: textureEntry.view },
            { binding: 2, resource: this._sampler },
            { binding: 3, resource: { buffer: this._torchStorageBuffer } }
          ]
        });
        pass.setBindGroup(0, bindGroup);
        pass.draw(6, 1, 0, 0);
        drew = true;
      }
      pass.end();
      if (drew) {
        this._lastOverlaySpriteDrawAt = Date.now();
      }
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

    _runHaloFlamePass(encoder) {
      if (!encoder || !this.shouldDriveHaloFlame()) return;
      if (!this.shouldUseNativeWorld()) return;
      if (this._torchFlameFxVertexCount < 1 && this._torchHaloFxVertexCount < 1) return;
      if (!this._haloFlamePipelineAlpha || !this._haloFlamePipelineAdd) return;
      if (!this._frameTextureView || !this._frameDepthView) return;

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this._frameTextureView,
            loadOp: 'load',
            storeOp: 'store'
          }
        ],
        depthStencilAttachment: {
          view: this._frameDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store'
        }
      });

      if (this._torchFlameFxVertexCount > 0 && this._torchFlameFxVertexBuffer && this._haloFlameBindGroupFlame) {
        pass.setPipeline(this._haloFlamePipelineAlpha);
        pass.setBindGroup(0, this._haloFlameBindGroupFlame);
        pass.setVertexBuffer(0, this._torchFlameFxVertexBuffer);
        pass.draw(this._torchFlameFxVertexCount, 1, 0, 0);
      }

      if (this._torchHaloFxVertexCount > 0 && this._torchHaloFxVertexBuffer && this._haloFlameBindGroupHalo) {
        pass.setPipeline(this._haloFlamePipelineAdd);
        pass.setBindGroup(0, this._haloFlameBindGroupHalo);
        pass.setVertexBuffer(0, this._torchHaloFxVertexBuffer);
        pass.draw(this._torchHaloFxVertexCount, 1, 0, 0);
      }
      pass.end();
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
        const worldShaderModule = device.createShaderModule({ code: worldSceneWgsl });
        const overlaySpriteModule = device.createShaderModule({ code: overlaySpriteWgsl });
        const torchProjectModule = device.createShaderModule({ code: torchProjectWgsl });
        const flameFxModule = device.createShaderModule({ code: flameFxWgsl });
        const haloFlameModule = device.createShaderModule({ code: haloFlameWgsl });
        const bloomShaderModule = device.createShaderModule({ code: bloomBlurWgsl });
        const sampler = device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipmapFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        });
        const floorSampler = device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
          mipmapFilter: 'linear',
          addressModeU: 'repeat',
          addressModeV: 'repeat'
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
        let worldBindGroupLayout = null;
        const overlaySpriteBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: 'float' }
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' }
            },
            {
              binding: 3,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' }
            }
          ]
        });
        const haloFlameBindGroupLayout = device.createBindGroupLayout({
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
        let worldPipelineLayout = null;
        const overlaySpritePipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [overlaySpriteBindGroupLayout]
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
        let worldPipeline = null;
        try {
          worldBindGroupLayout = device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
              },
              {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' }
              },
              {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' }
              },
              {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float' }
              },
              {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'filtering' }
              },
              {
                binding: 5,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'filtering' }
              },
              {
                binding: 6,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'read-only-storage' }
              }
            ]
          });
          worldPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [worldBindGroupLayout]
          });
          worldPipeline = device.createRenderPipeline({
            layout: worldPipelineLayout,
            vertex: { module: worldShaderModule, entryPoint: 'vsMain' },
            fragment: { module: worldShaderModule, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: {
              format: FRAME_DEPTH_FORMAT,
              depthWriteEnabled: true,
              depthCompare: 'less-equal'
            }
          });
        } catch (err) {
          console.warn('[WebGPU] Native world pipeline unavailable:', err && err.message ? err.message : err);
          worldBindGroupLayout = null;
          worldPipeline = null;
        }
        const overlaySpritePipeline = device.createRenderPipeline({
          layout: overlaySpritePipelineLayout,
          vertex: { module: overlaySpriteModule, entryPoint: 'vsMain' },
          fragment: {
            module: overlaySpriteModule,
            entryPoint: 'fsMain',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: FRAME_DEPTH_FORMAT,
            depthWriteEnabled: true,
            depthCompare: 'less-equal'
          }
        });
        const overlaySpriteNoDepthWritePipeline = device.createRenderPipeline({
          layout: overlaySpritePipelineLayout,
          vertex: { module: overlaySpriteModule, entryPoint: 'vsMain' },
          fragment: {
            module: overlaySpriteModule,
            entryPoint: 'fsMain',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: FRAME_DEPTH_FORMAT,
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
          }
        });
        const haloFlamePipelineAlpha = device.createRenderPipeline({
          layout: haloFlamePipelineLayout,
          vertex: {
            module: flameFxModule,
            entryPoint: 'vsMain',
            buffers: [{
              arrayStride: TORCH_FX_VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },
                { shaderLocation: 1, offset: 2 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
                { shaderLocation: 2, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
                { shaderLocation: 3, offset: 5 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' }
              ]
            }]
          },
          fragment: {
            module: flameFxModule,
            entryPoint: 'fsMain',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: FRAME_DEPTH_FORMAT,
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
          }
        });
        const haloFlamePipelineAdd = device.createRenderPipeline({
          layout: haloFlamePipelineLayout,
          vertex: {
            module: haloFlameModule,
            entryPoint: 'vsMain',
            buffers: [{
              arrayStride: TORCH_FX_VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },
                { shaderLocation: 1, offset: 2 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
                { shaderLocation: 2, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
                { shaderLocation: 3, offset: 5 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' }
              ]
            }]
          },
          fragment: {
            module: haloFlameModule,
            entryPoint: 'fsMain',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: FRAME_DEPTH_FORMAT,
            depthWriteEnabled: false,
            depthCompare: 'less-equal'
          }
        });

        this._adapter = adapter;
        this._device = device;
        this._gpuCanvasContext = context;
        this._pipeline = pipeline;
        this._worldPipeline = worldPipeline;
        this._overlaySpritePipeline = overlaySpritePipeline;
        this._overlaySpriteNoDepthWritePipeline = overlaySpriteNoDepthWritePipeline;
        this._torchProjectPipeline = torchProjectPipeline;
        this._torchProjectBindGroupLayout = torchProjectBindGroupLayout;
        this._worldBindGroupLayout = worldBindGroupLayout;
        this._overlaySpriteBindGroupLayout = overlaySpriteBindGroupLayout;
        this._haloFlamePipelineAlpha = haloFlamePipelineAlpha;
        this._haloFlamePipelineAdd = haloFlamePipelineAdd;
        this._haloFlameBindGroupLayout = haloFlameBindGroupLayout;
        this._sampler = sampler;
        this._floorSampler = floorSampler;
        this._bloomSampler = bloomSampler;
        this._bloomPipeline = bloomPipeline;
        this._bindGroupLayout = bindGroupLayout;
        this._bloomBindGroupLayout = bloomBindGroupLayout;
        this._overlaySpriteParamsBuffer = device.createBuffer({
          size: OVERLAY_SPRITE_PARAM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this._resetSceneResources();
        this._clearOverlaySpriteTextureCache();
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
      const torchFlameVerts = Array.isArray(frame?.torchFlameVerts) ? frame.torchFlameVerts : [];
      const torchHaloVerts = Array.isArray(frame?.torchHaloVerts) ? frame.torchHaloVerts : [];
      const overlaySprites = Array.isArray(frame?.overlaySprites) ? frame.overlaySprites : [];
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
        spriteOut[base + 6] = Number.isFinite(spr.wallFacingCode) ? spr.wallFacingCode : 0.0;
        spriteOut[base + 7] = spr.wallFacing ? 1.0 : 0.0;
        spriteOut[base + 8] = Number.isFinite(spr.haloCenterX) ? spr.haloCenterX : spriteOut[base];
        spriteOut[base + 9] = Number.isFinite(spr.haloCenterY)
          ? spr.haloCenterY
          : (spriteOut[base + 1] + spriteOut[base + 2]) * 0.5;
        spriteOut[base + 10] = Number.isFinite(spr.haloBasisUX) ? spr.haloBasisUX : 0.0;
        spriteOut[base + 11] = Number.isFinite(spr.haloBasisUY) ? spr.haloBasisUY : 0.0;
        spriteOut[base + 12] = Number.isFinite(spr.haloBasisVX) ? spr.haloBasisVX : 0.0;
        spriteOut[base + 13] = Number.isFinite(spr.haloBasisVY) ? spr.haloBasisVY : 0.0;
        spriteOut[base + 14] = Number.isFinite(spr.haloDepth) ? spr.haloDepth : spriteOut[base + 3];
        spriteOut[base + 15] = 0.0;
      }
      this._torchFlameFxCpuData = torchFlameVerts.length > 0 ? Float32Array.from(torchFlameVerts) : new Float32Array(0);
      this._torchHaloFxCpuData = torchHaloVerts.length > 0 ? Float32Array.from(torchHaloVerts) : new Float32Array(0);
      this._torchFlameFxVertexCount = Math.floor(this._torchFlameFxCpuData.length / TORCH_FX_VERTEX_STRIDE_FLOATS);
      this._torchHaloFxVertexCount = Math.floor(this._torchHaloFxCpuData.length / TORCH_FX_VERTEX_STRIDE_FLOATS);
      this._torchFlameFxDirty = true;
      this._torchHaloFxDirty = true;
      this._torchDataDirty = true;
      this._rectDataDirty = true;
      this._torchSpriteDataDirty = true;
      this._torchParamsDirty = true;
      this._worldParamsDirty = true;
      this._overlaySprites = overlaySprites.slice();
      this._torchFlameSprites = [];
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
        eyeZ: frame?.eyeZ,
        depthFar: frame?.depthFar,
        minFloor: frame?.minFloor,
        wallUScale: frame?.wallUScale,
        lightDirX: frame?.lightDirX,
        lightDirY: frame?.lightDirY,
        lightElev: frame?.lightElev,
        lightIntensity: frame?.lightIntensity,
        skyTopRgb: frame?.skyTopRgb,
        skyBotRgb: frame?.skyBotRgb,
        shadowStrength: frame?.shadowStrength,
        torchRadiusScale: frame?.torchRadiusScale,
        playerTileX: frame?.playerTileX,
        playerTileY: frame?.playerTileY,
        maxSteps: frame?.maxSteps
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
        const encoder = this._device.createCommandEncoder();
        const useNativeWorld = this.shouldUseNativeWorld() && this._ensureNativeWorldResources();
        if (useNativeWorld) {
          this._uploadWorldParams();
          this._runNativeWorldPass(encoder);
          this._runOverlaySpritePass(encoder, this._overlaySprites, false);
          this._runOverlaySpritePass(encoder, this._torchFlameSprites, true);
          this._runHaloFlamePass(encoder);
        } else {
          this._device.queue.copyExternalImageToTexture(
            { source: this._sourceCanvas },
            { texture: this._frameTexture },
            { width: this._frameWidth, height: this._frameHeight, depthOrArrayLayers: 1 }
          );
        }
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
      return this.mode === 'webgpu'
        && (isGpuHaloFlameEnabled() || this.shouldUseNativeWorld());
    },

    shouldApplyPostTorchOverlay() {
      return this.mode === 'webgpu'
        && this.shouldDriveSpriteTorch()
        && getSpriteVoxelTorchBlend() > 0.0001;
    },

    getLegacySceneSnapshot() {
      if (!this.legacyRenderer || typeof this.legacyRenderer.getSceneResourceSnapshot !== 'function') {
        return null;
      }
      return this.legacyRenderer.getSceneResourceSnapshot();
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
        legacySceneSnapshotReady: !!this.getLegacySceneSnapshot(),
        nativeWorldEnabled: this.shouldUseNativeWorld(),
        nativeWorldDrawAt: this._lastNativeWorldDrawAt || 0,
        overlaySpriteCount: Array.isArray(this._overlaySprites) ? this._overlaySprites.length : 0,
        overlaySpriteDrawAt: this._lastOverlaySpriteDrawAt || 0,
        torchSpriteCount: this._torchSpriteCount,
        torchFlameVertexCount: this._torchFlameFxVertexCount,
        torchHaloVertexCount: this._torchHaloFxVertexCount,
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
