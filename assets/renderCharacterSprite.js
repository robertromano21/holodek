// assets/renderCharacterSprite.js
// RETRO PIXEL ART VIA PREFAB COMPONENT CATALOG (old-school metasprite style).
// How old-school pixel graphics were mapped: artists planned discrete components (head variants, torso armors/robes, striding leg poses, swung arm segments, weapons from hand, flowing capes) on graph paper.
// Each component is a pre-hardcoded set of rect bands/offsets/clusters/outlines/dither that guarantee strong silhouette + readability at low res (C64/Epyx Impossible Mission running figures, Mario/Mega Man side profiles).
// LLM (as artist) chooses from expanded catalog of body types + provides numeric "design" params (head_size, torso_height, leg_height, blade_size, fold_density, stride_amount etc) to actually "draw" the proportions and details.
// Renderer centers head on torso, vertically centers figure (head top, feet bottom), uses design to vary sizes (smaller torso, longer legs per feedback), dispatches to draw* with type-specific and param-modulated rects.
// The catalog + design effectively *is* our sprite editor / parts bin. createCharacterSpriteSheetCanvas + registerAnimatedCharacterSprite turn choices into real Phaser spritesheets + animations (add.sprite + .play()).
// Always produces discernible side-profile humanoid (small centered head + prominent feature on top, slightly smaller body, longer legs for bottom-heavy silhouette, fluid thin-rect folds, top-left shading + edge highlights + 1px outlines, dither on large areas).
// 24 base * UPSCALE=4 chunky retro. No grid, no ascii, no dimensions, no procedure. Pure catalog + design numbers + seed. Never blank. More body type variety via expanded catalog + seed picks. Extensible to monsters (horns/tail/claw prefabs later).

const isNode = typeof window === 'undefined' && typeof require !== 'undefined';
let createCanvas;

if (isNode) {
  try {
    const canvasPkg = require('canvas');
    createCanvas = canvasPkg.createCanvas;
  } catch (e) {
    createCanvas = null;
  }
}

if (!createCanvas) {
  createCanvas = function(w, h) {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    return { width: w, height: h, getContext: () => ({}) };
  };
}

// Generated (non-preset) characters carry an LLM trait spec (kind === 'procedural'). 2D canvases for those
// are drawn by the trait-driven catalog extension below (createTraitSpriteCanvas, original C64 style);
// the detailed 48px generator in assets/renderCharacterProcedural.js is only used for the 3D voxel actors.
function getProceduralApi() {
  if (typeof window !== 'undefined' && window.ProceduralCharacters) return window.ProceduralCharacters;
  if (isNode) {
    try { return require('./renderCharacterProcedural.js'); } catch (e) { return null; }
  }
  return null;
}
function getProceduralSpec(character, spriteSpec) {
  const spec = spriteSpec || (character && character.sprite && character.sprite.spec) || null;
  return spec && ((spec.kind === 'procedural' && spec.traits) || spec.kind === 'placeholder') ? spec : null;
}

const BASE_SIZE = 24;  // Increased for more pixels / detail (24x24 base *4 =96px canvas). Allows richer old-school pixel art without losing chunky retro feel.
const UPSCALE = 4;

function normalizePalette(p = {}) {
  return {
    primary:   p.primary   || '#4a3c2f',
    secondary: p.secondary || '#8b5a2b',
    highlight: p.highlight || '#ffdd66',
    shadow:    p.shadow    || '#22110a',
    skin:      p.skin      || '#e8c39e',
    accent:    p.accent    || '#aa3333'
  };
}

// === PREFAB DRAW FUNCTIONS ===
// These are the "old school mapped components". Each is a self-contained set of fillRect calls
// with known-good pixel clusters, offsets, folds, highlights, dither and outlines so the result
// is always a clear, readable side-profile humanoid (Epyx-style stride, small head+feature, fluid line quality).
// LLM never designs pixels; it only picks which prefab variant + pose offsets.

function drawHead(ctx, type, hx, hy, u, palette, p, isFemale, race, c, crestH = 2, crestSpikes = 3, facing = 1) {
  // Small O-ish head via stacked rect bands (round profile, C64/Mario readability)
  // LLM design controls head_size/width (already in p) + crest params
  ctx.fillStyle = palette.skin;
  const bands = Math.max(3, Math.min(5, p.headH));
  for (let b = 0; b < bands; b++) {
    const bw = Math.max(2, Math.floor(p.headW * (0.55 + 0.45 * Math.sin((b + 0.5) / bands * Math.PI))));
    ctx.fillRect((hx + Math.floor((p.headW - bw) / 2)) * u, (hy + b) * u, bw * u, u);
  }
  // Define hair more for Mortacia/female/goddess to match reference (prominent defined hair, e.g. bob style)
  // User: give her longer hair. For Mortacia tall goddess: long flowing strands past shoulders on back/sides.
  if (isFemale || c.includes('goddess') || c.includes('necromancer') || type.includes('hair')) {
    ctx.fillStyle = palette.highlight; // bright hair definition (yellowish in ref)
    // top hair mass
    ctx.fillRect((hx) * u, (hy - 2) * u, p.headW * u, 2 * u);
    // side hair for shape
    ctx.fillRect((hx - 1) * u, (hy + 1) * u, 1 * u, Math.floor(p.headH * 0.7) * u);
    ctx.fillRect((hx + p.headW) * u, (hy + 1) * u, 1 * u, Math.floor(p.headH * 0.7) * u);
    // hair detail line
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hx + 1) * u, (hy - 1) * u, (p.headW - 2) * u, 1 * u);
  }
  // Longer flowing hair for Mortacia (tall goddess) - extends well below head on the back side, slender strands for flow.
  if (c.includes('goddess') || c.includes('mortacia') || (isFemale && c.includes('necromancer'))) {
    ctx.fillStyle = palette.highlight;
    const hairBack = (facing > 0) ? (hx - 1) : (hx + p.headW);
    // long back-of-head flow (past shoulder for "longer hair")
    ctx.fillRect(hairBack * u, (hy + 2) * u, 1 * u, 7 * u);
    ctx.fillRect((hairBack + (facing > 0 ? -1 : 1)) * u, (hy + 3) * u, 1 * u, 6 * u);
    // lower volume/flow at "shoulder" level
    ctx.fillRect((hairBack - (facing > 0 ? 1 : 0)) * u, (hy + 7) * u, 2 * u, 3 * u);
    ctx.fillRect(hairBack * u, (hy + 9) * u, 1 * u, 2 * u);
    // front side long strand too for goddess volume
    const hairFront = (facing > 0) ? (hx + p.headW) : (hx - 1);
    ctx.fillRect(hairFront * u, (hy + 2) * u, 1 * u, 5 * u);
    // more defined feminine hair per ref: additional strands, volume, simple definition for "more defined feminine hair"
    ctx.fillRect((hairBack + (facing > 0 ? 1 : -2)) * u, (hy + 1) * u, 1 * u, 4 * u);
    ctx.fillRect(hairBack * u, (hy + 6) * u, 1 * u, 3 * u);
    ctx.fillRect((hairBack - 1) * u, (hy + 8) * u, 2 * u, 2 * u);
    // light detail lines for definition (simple)
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hairFront + (facing > 0 ? -1 : 1)) * u, (hy + 3) * u, 1 * u, 2 * u);
  }
  // Simple single-line cap for Mortacia (tall goddess) per latest ref [Image #2]: just a thin single line on top of the (bigger) head for a small cap/hat. Think of simple details. No complex crest/horns.
  if (c.includes('goddess') || c.includes('mortacia') || (isFemale && c.includes('necromancer'))) {
    ctx.fillStyle = palette.shadow || '#22110a'; // dark simple line for cap
    ctx.fillRect((hx - 1) * u, (hy - 3) * u, (p.headW + 2) * u, 1 * u); // just a single line cap
  }
  // Prominent distinguishing feature ON TOP of the small head (the key old-school identifier)
  // Now modulated by LLM crest_height and crest_spikes for creative control
  const ch = crestH;
  const cs = crestSpikes;
  if (type === 'skull_crest' || type === 'skull') {
    ctx.fillStyle = palette.shadow;
    // features on the front/facing side of the head (jaw, side bone on front) - toned down to avoid beak/comb look
    const frontEdge = hx + (facing > 0 ? p.headW : 0);
    ctx.fillRect(frontEdge * u, (hy - 1) * u, u, 2 * u);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hx + 1) * u, (hy + p.headH - 1) * u, (p.headW - 2) * u, u);
    // Bony crest/horns for skull - demonic ridge/horns instead of flat red rooster comb
    // Use dark bony colors, vertical horns on sides + central ridge, modulated by crest params
    ctx.fillStyle = palette.primary; // dark bone for crest
    // base ridge
    ctx.fillRect((hx + 1) * u, (hy - ch) * u, (p.headW - 2) * u, u);
    // side horns
    ctx.fillRect((hx ) * u, (hy - ch - 1) * u, u, 2 * u);
    ctx.fillRect((hx + p.headW - 1) * u, (hy - ch - 1) * u, u, 2 * u);
    // center spikes/horn, using cs for number
    const centerX = hx + Math.floor(p.headW / 2);
    for (let i = 0; i < Math.min(cs, 3); i++) {
      const sx = centerX - 1 + i;
      ctx.fillRect(sx * u, (hy - ch - 2 - i) * u, u, (2 + i) * u);
    }
    // jaw / side bone on front - small accent detail
    ctx.fillStyle = palette.accent;
    ctx.fillRect(frontEdge * u, (hy + 1) * u, u, 2 * u);
  } else if (type === 'plumed_helmet' || type === 'helmet') {
    ctx.fillStyle = palette.primary;
    ctx.fillRect((hx - 1) * u, (hy - 2) * u, (p.headW + 2) * u, 2 * u);
    ctx.fillRect((hx + p.headW - 1) * u, hy * u, 2 * u, 3 * u);
    // cool tall knight plume (saved as monster/knight NPC template from prior Suzerain shapes; now gallant_helm is fresh for Suzerain per ref image)
    ctx.fillStyle = palette.highlight;
    const ph = Math.max(3, ch + 2); // tall
    ctx.fillRect((hx + 2) * u, (hy - ph) * u, 1 * u, (ph + 2) * u); // main tall feather shaft
    ctx.fillRect((hx + 3) * u, (hy - ph + 1) * u, 1 * u, (ph) * u);
    ctx.fillRect((hx + 1) * u, (hy - ph + 2) * u, 1 * u, Math.floor(ph * 0.8) * u);
    // side feather fluff / flow (plume volume)
    ctx.fillRect((hx + 4) * u, (hy - ph + 2) * u, 1 * u, 3 * u);
    ctx.fillRect((hx ) * u, (hy - ph + 3) * u, 1 * u, 2 * u);
    // accent lines for feather texture (using shadow for definition)
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hx + 2) * u, (hy - ph + 3) * u, 1 * u, 1 * u);
    ctx.fillRect((hx + 3) * u, (hy - ph + 5) * u, 1 * u, 1 * u);
  } else if (type === 'gallant_helm' || type === 'knight_helm') {
    // Fresh gallant knight helm for Suzerain (emulate ref image knight: fuller crested helm, noble gallant look, side profile details, no dragon).
    // Crest/horns inspired by image's helm protrusions + top comb, metal shading, gallant plume.
    ctx.fillStyle = palette.primary;
    ctx.fillRect((hx - 1) * u, (hy - 2) * u, (p.headW + 2) * u, 5 * u); // fuller helm base
    // visor/face plate for gallant knight aesthetic (front edge detail)
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hx ) * u, (hy + 1) * u, p.headW * u, 1 * u);
    ctx.fillRect((hx + Math.floor(p.headW * 0.2)) * u, (hy ) * u, Math.floor(p.headW * 0.6) * u, 1 * u);
    // gallant crest: side protrusions (image horns/crest style) + center comb
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((hx - 1) * u, (hy - 3) * u, 1 * u, 3 * u); // left crest
    ctx.fillRect((hx + p.headW ) * u, (hy - 3) * u, 1 * u, 3 * u); // right crest
    ctx.fillRect((hx + 1) * u, (hy - 4) * u, (p.headW - 2) * u, 1 * u); // top comb
    // gallant plume (flowing, heroic, based on image's raised sword/crest energy)
    ctx.fillStyle = palette.highlight;
    const ph = Math.max(4, ch + 3);
    ctx.fillRect((hx + 2) * u, (hy - ph) * u, 1 * u, (ph + 1) * u); // main shaft
    ctx.fillRect((hx + 3) * u, (hy - ph + 1) * u, 1 * u, Math.floor(ph * 0.9) * u);
    ctx.fillRect((hx + 1) * u, (hy - ph + 2) * u, 1 * u, Math.floor(ph * 0.6) * u);
    // side fluff for volume (gallant cape-like flow in helm)
    ctx.fillRect((hx + 4) * u, (hy - ph + 2) * u, 1 * u, 3 * u);
    ctx.fillRect((hx ) * u, (hy - ph + 3) * u, 1 * u, 2 * u);
    // texture lines
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((hx + 2) * u, (hy - ph + 3) * u, 1 * u, 1 * u);
    ctx.fillRect((hx + 3) * u, (hy - ph + 5) * u, 1 * u, 1 * u);
  } else if (type === 'hooded' || type === 'hooded_skull') {
    ctx.fillStyle = palette.primary;
    ctx.fillRect((hx - 1) * u, (hy - 1) * u, (p.headW + 2) * u, 2 * u);
    ctx.fillRect((hx) * u, (hy - ch) * u, (p.headW) * u, u);
  } else if (type === 'crowned') {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(hx * u, (hy - ch) * u, p.headW * u, u);
    for (let i = 0; i < cs; i++) {
      const sx = hx + 1 + Math.floor(i * (p.headW - 2) / Math.max(1, cs-1));
      ctx.fillRect(sx * u, (hy - ch - 1) * u, u, u);
    }
  } else if (type === 'elf_ears' || race === 'elf') {
    ctx.fillStyle = palette.skin;
    ctx.fillRect((hx + p.headW - 1) * u, (hy + 1) * u, 2 * u, 2 * u);
    ctx.fillRect((hx - 1) * u, (hy + 1) * u, 2 * u, 2 * u);
  }
  // eye / face detail (always present for readability). Placed on the "front" / facing side of the head so face direction is clear.
  // Wings/cape always on the opposite (back) side.
  ctx.fillStyle = '#111';
  const eyeOffset = facing > 0 ? 0.7 : 0.3;
  ctx.fillRect((hx + Math.floor(p.headW * eyeOffset)) * u, (hy + 1) * u, u, u);
  // neck join (critical for hierarchical assembly look)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(hx * u, (hy + p.headH - 1) * u, (p.headW + 1) * u, u);
}

function drawTorso(ctx, type, tx, ty, u, palette, p, isRobeLike, isFemale, c, robeFlare = 2, foldDens = 3, profileDir = 1) {
  ctx.fillStyle = palette.primary;
  let drawTorsoW = p.torsoW;
  // Support more body types: tapered/cinched make upper narrower for varied silhouette
  if (type.includes('tapered') || type.includes('cinched')) {
    drawTorsoW = Math.max(3, Math.floor(p.torsoW * 0.7));
  } else if (type.includes('broad')) {
    drawTorsoW = Math.max(p.torsoW, Math.floor(p.torsoW * 1.2));
  }
  let drawTorsoH = p.torsoH;
  if ((c.includes('mortacia') || c.includes('goddess')) && (type.includes('corset') || type.includes('robe') || type.includes('flowing') || type.includes('dress'))) {
    drawTorsoH = Math.max(3, p.torsoH - 3); // shorten more to expose skin color thighs per latest ref (legs more under)
  }
  ctx.fillRect(tx * u, ty * u, drawTorsoW * u, drawTorsoH * u);
  const flare = robeFlare;
  if (isRobeLike || type.includes('robe') || type.includes('dress') || type.includes('flowing')) {
    let flareY = ty + drawTorsoH - 3;
    let flareH = 3 + flare;
    if (c.includes('mortacia') || c.includes('goddess')) {
      flareY = ty + drawTorsoH - 1;
      flareH = Math.max(1, flareH - 2);
    }
    ctx.fillRect((tx - 1) * u, flareY * u, (p.torsoW + 2) * u, flareH * u);
  }
  // edge highlight (prevents blank on dark palettes)
  ctx.fillStyle = palette.highlight;
  ctx.fillRect((tx + drawTorsoW - 1) * u, ty * u + 1, u, drawTorsoH - 2);
  // fluid folds / pleats / belt lines (painterly line-drawn quality from thin rect offsets)
  // LLM fold_density controls number and strength of details
  ctx.fillStyle = palette.shadow;
  const waist = ty + Math.floor(drawTorsoH / 2);
  ctx.fillRect((tx + 1) * u, waist * u, (p.torsoW - 2) * u, u);
  if (isRobeLike) {
    const fd = foldDens;
    ctx.fillRect((tx + 2) * u, (waist + 1) * u, 3 * u, u);
    ctx.fillRect((tx + 1) * u, (waist + 3) * u, 4 * u, u);
    // dither and extra folds scaled by fold_density for creative volume control
    for (let dy = 1; dy < drawTorsoH - 2; dy += Math.max(1, 3 - Math.floor(fd / 2))) {
      for (let dx = 1; dx < p.torsoW - 2; dx += Math.max(1, 3 - Math.floor(fd / 2))) {
        ctx.fillRect((tx + dx) * u, (ty + dy) * u, u, u);
      }
    }
  }
  if (type.includes('armor') || c.includes('knight') || type.includes('plate') || type.includes('gallant')) {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((tx - 1) * u, ty * u + 1, u, 3);
    ctx.fillRect((tx + 1) * u, (ty + Math.floor(drawTorsoH * 0.3)) * u, (p.torsoW - 2) * u, u);
    // gallant knight armor details (straps, segments emulating ref image's ornate plate + belts/straps for heroic look)
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((tx ) * u, (ty + Math.floor(drawTorsoH * 0.35)) * u, p.torsoW * u, 1 * u); // upper strap
    ctx.fillRect((tx + 1) * u, (ty + Math.floor(drawTorsoH * 0.55)) * u, (p.torsoW - 2) * u, 1 * u); // lower strap
    ctx.fillStyle = palette.accent;
    ctx.fillRect((tx + 2) * u, (ty + Math.floor(drawTorsoH * 0.45)) * u, 1 * u, 1 * u); // rivet detail
  }
  // Pulpy goddess bust/curve accent for Mortacia (cinched corset + goddess class): 1-2px skin tone suggestion on the "front"/facing side of torso at upper chest height.
  // Matches "think of what pulpy goddesses look like" (powerful feminine form per ref) while staying tiny retro pixel and not breaking silhouette or centering. Only for her corset styles.
  if ((c.includes('goddess') || c.includes('necromancer') || c.includes('mortacia')) && (type.includes('corset') || type.includes('bone') || type.includes('cinch'))) {
    ctx.fillStyle = palette.skin;
    const frontEdge = (profileDir > 0 ? (tx + drawTorsoW - 1) : tx);
    ctx.fillRect(frontEdge * u, (ty + Math.floor(drawTorsoH * 0.22)) * u, 1 * u, 2 * u); // upper chest curve hint
    if (drawTorsoH > 4) {
      ctx.fillRect(frontEdge * u, (ty + Math.floor(drawTorsoH * 0.38)) * u, 1 * u, 1 * u);
    }
  }
  // collar line
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(tx * u, (ty + 1) * u, p.torsoW * u, u);
  // side outlines for volume
  ctx.fillStyle = palette.shadow;
  ctx.fillRect((tx - 1) * u, ty * u, u, drawTorsoH * u);
  ctx.fillRect((tx + p.torsoW) * u, ty * u, u, drawTorsoH * u);
}

function drawStridingLegs(ctx, lx, ly, u, palette, p, stride, isFemale, style, isMortacia = false) {
  // Improved leg drawing for better visual appeal and Epyx-style variety while keeping assembly.
  // Upper (thigh to knee) always single/nominal at lx for "together and slender" under the hem (torso overpaints top).
  // Lower leg + boot: single for low stride; for high stride, main column + artistic "lead lower" offset to give
  // front leg extended feel and per-pose/seed/anim-frame difference (the variety the user liked in full stride prefabs).
  // Lead lower starts below knee so top connection stays centered/plumb. No full parallel legs from hip.
  // Boot always "the grey one" (secondary), positioned at lead when striding; tiny trail hint only for very high stride.
  // Form: stacked bands with slight taper, knee/ankle cuffs, right-edge highlight, left outline.
  // Coloring: thighs secondary (grey), calves same or alt for form, boots secondary. Armored adds plates on top.
  // Flowing: wider boot, calf may read under robe color.
  // "Prefab" but with dynamic stride offset + details so they don't look stiff/regular across rerolls/poses.
  // Centering: lx from body snap, upper fixed, no drift.
  const legH = p.legH, legW = p.legW;
  const s = Math.max(0, (stride || 0) * 1.3);
  const isFlowing = (style || '').includes('skirt') || (style || '').includes('flow') || (style || '').includes('dress');
  // Allow showing Mortacia's thighs (shortened robe above) by extending skin color thigh above ly per ref
  if (isFemale) {
    ctx.fillStyle = isMortacia ? palette.skin : palette.secondary;
    const thighVisH = isMortacia ? 3 : 2;
    ctx.fillRect(lx * u, (ly - thighVisH) * u, legW * u, thighVisH * u); // skin color thighs for Mortacia visible under short hem
  }
  const isArmored = (style || '').includes('greave') || (style || '').includes('armor') || (style || '').includes('stout') || (style || '').includes('plate');

  const thighH = Math.floor(legH * 0.42);
  const kneeH = Math.floor(legH * 0.18);
  const lowerH = legH - thighH - kneeH;

  // Upper thigh: single centered column at lx (guarantees assembly under torso, "legs together")
  // For Mortacia with grey costume: use skin here so the visible thighs (under short hem) are skin tone like the ref image.
  ctx.fillStyle = isMortacia ? palette.skin : palette.secondary;
  ctx.fillRect(lx * u, ly * u, legW * u, thighH * u);

  // Knee band (definition)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(lx * u, (ly + thighH) * u, legW * u, kneeH * u);

  // Lower leg / calf: base single at lx for main column. Taper slightly for form if not flowing.
  ctx.fillStyle = isArmored ? palette.highlight : palette.secondary;
  let lowerW = legW;
  let lowerX = lx;
  if (!isFlowing && legW >= 2) {
    lowerW = Math.max(1, legW - (legW > 2 ? 1 : 0));
    lowerX = lx + (legW > lowerW ? 1 : 0);
  }
  ctx.fillRect(lowerX * u, (ly + thighH + kneeH) * u, lowerW * u, lowerH * u);

  // Ankle cuff
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(lx * u, (ly + legH - 2) * u, legW * u, u);

  // Boot/foot base (the "grey one"). Positioned forward on stride for motion.
  ctx.fillStyle = palette.secondary;
  const bootExtra = isFlowing ? 2 : (isArmored ? 1 : 0);
  const bootW = legW + bootExtra;
  const bootY = ly + legH - 1;
  let bootX = lx - (isFlowing ? 1 : 0);
  if (s > 0.5) {
    const lead = Math.floor(s * 0.65);
    bootX = lx + lead - (isFlowing ? 1 : 0);
  }
  ctx.fillRect(bootX * u, bootY * u, bootW * u, u);

  // For high stride: add "lead lower leg" (from below knee) offset to give Epyx front-leg-extended separation
  // and visual variety without full second leg from the hip (upper stays single at lx for centering/assembly).
  if (s > 1.0) {
    const leadX = lx + Math.floor(s * 0.75);
    ctx.fillStyle = palette.secondary;
    const leadLowerStart = ly + thighH + Math.floor(kneeH * 0.6);
    const leadLowerH = legH - (thighH + Math.floor(kneeH * 0.6)) ;
    const leadLowerW = Math.max(1, lowerW);
    ctx.fillRect(leadX * u, leadLowerStart * u, leadLowerW * u, leadLowerH * u);
    // lead boot (overwrites/extends the base boot for the step)
    ctx.fillRect((leadX - 1) * u, bootY * u, (legW + 2) * u, u);
  }

  // Tiny trail hint only on very high stride (subtle Epyx, not second leg)
  if (s > 1.8) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((lx - 1) * u, bootY * u + 1, 2 * u, u);
  }

  // Armored greaves plates (on top of the leg form)
  if (isArmored) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((lx + 1) * u, (ly + 2) * u, u, legH - 4);
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(lx * u, (ly + Math.floor(legH * 0.28)) * u, legW * u, u);
    ctx.fillRect(lx * u, (ly + Math.floor(legH * 0.50)) * u, legW * u, u);
    ctx.fillRect(lx * u, (ly + Math.floor(legH * 0.72)) * u, legW * u, u);
  }

  // Definition: knee line, right highlight (volume), left outline (assembly)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(lx * u, (ly + thighH - 1) * u, legW * u, u); // knee
  ctx.fillRect((lx - 1) * u, ly * u, u, legH * u); // left outline

  ctx.fillStyle = palette.highlight;
  ctx.fillRect((lx + legW - 1) * u, ly * u + 1, u, legH - 2); // right volume

  // Female/flowing extra near top (mostly covered by torso hem)
  if (isFemale || isFlowing) {
    ctx.fillStyle = palette.secondary;
    ctx.fillRect((lx - 1) * u, ly * u + 4, (legW + 2 + (isFlowing ? 1 : 0)) * u, 2);
  }
}

function drawSwingArm(ctx, ax, ay, u, palette, p, armSwing, isFemale, armThick = 3) {
  // Upper + lower arm segments with swing offset (counter-pose to legs = classic Epyx/Mario)
  // LLM design.arm_thickness controls width for creative limb variation
  // Expects unscaled ax,ay (like drawStridingLegs) so all parts including swung lower+hand scale correctly.
  // (Prevents the hand/lower arm from being 4x too far and disconnected from upper body.)
  const armH = p.armH || 5;
  const armUpperH = Math.floor(armH * 0.4);
  const armLowerH = armH - armUpperH;
  const swing = (armSwing || 0) * 1.5;
  let armWidth = armThick;
  if (isFemale) armWidth = Math.max(1, Math.floor(armThick * 0.7)); // thinner arms for slender female/Mortacia look
  ctx.fillStyle = palette.secondary;
  ctx.fillRect(ax * u, ay * u, armWidth * u, armUpperH * u);
  ctx.fillRect((ax + swing) * u, (ay + armUpperH) * u, armWidth * u, armLowerH * u);
  // hand at end of lower arm (slightly larger)
  // Moved down by 1px (ay + armH) to match "moved the hands" in user's connected edit.
  ctx.fillStyle = palette.skin;
  ctx.fillRect((ax + swing + (swing > 0 ? 1 : 0)) * u, (ay + armH) * u, 2 * u, 2 * u);
  // elbow definition line (thin shadow at joint)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(ax * u, (ay + 1) * u, u, u);
}

function drawWeapon(ctx, wx, wy, u, palette, weaponH, weaponType, bladeSz = 4, wDir = 1) {
  // Weapon emerges naturally from the swung hand position (no floating)
  // Different types + design.weapon_length + blade_size produce visibly different silhouettes.
  // wDir (usually profileFacing) makes blade/protrusions extend "forward" away from body center:
  // when Mortacia faces left (wDir=-1, weapon on left side), blade extends further left so it never crosses the body column to cover wings (which are on right).
  ctx.fillStyle = palette.accent;
  ctx.fillRect(wx, wy, u, weaponH * u);
  const bs = bladeSz || 4;
  const d = wDir || 1;  // +1 or -1 to flip horizontal extensions for correct side
  if (weaponType.includes('scythe') || weaponType === 'scythe_long') {
    // LLM blade_size controls how big and prominent the scythe blade is (creative control over the "drawing" of the weapon)
    const bladeLen = 6 + bs * 1.5;
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy, Math.floor(bladeLen) * u, u);      // long top of blade (directional)
    ctx.fillRect((wx + d * 2) * u, wy + u, Math.floor(bladeLen - 1) * u, u);
    ctx.fillRect((wx + d * 3) * u, wy + 2 * u, Math.floor(bladeLen - 2) * u, u);
    ctx.fillRect((wx + d * 4) * u, wy + 3 * u, Math.max(2, bs) * u, u);
    // small back curve / hook near pole, scaled (use -d for the "inner/back" relative to blade dir)
    ctx.fillRect((wx + d * 1) * u, wy + 3 * u, 2 * u, u);
    ctx.fillRect(wx, wy + 5 * u, 2 * u, u);
  } else if (weaponType.includes('sword') || weaponType === 'sword_broad') {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy, u, (weaponH - 2) * u);  // long blade from top (tip) almost to bottom, for sword facing up with hilt at hand
    // extra width to better match ref image light vertical sword thickness (prominent on left)
    ctx.fillRect((wx + d * 2) * u, wy + 1, u, (weaponH - 4) * u);
    // small subtle guard/grip detail near hand (darker, minimal so light blade dominates like ref image)
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((wx + d * (-1)) * u, (wy + weaponH - 2) * u, 2 * u, u);
  } else if (weaponType.includes('staff') || weaponType === 'staff_crook') {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy + 1, u, 2);
    ctx.fillRect((wx + d * (-1)) * u, wy + Math.floor(weaponH * 0.6) * u, 3 * u, u);
  } else if (weaponType.includes('dagger')) {
    // short + tapered tip, small guard
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy + 1, u, Math.max(2, Math.floor(weaponH * 0.4)));
    ctx.fillRect(wx + d * (-1), wy + 3, 3, u);
  } else if (weaponType.includes('axe')) {
    // wide side blade
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy + 2, Math.max(3, bs + 1), 3);
    ctx.fillRect((wx + d * 2), wy + 1, u, 1);
  } else if (weaponType.includes('mace')) {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy + Math.floor(weaponH * 0.5), Math.max(2, bs), Math.max(2, Math.floor(bs / 2)));
  } else if (weaponType.includes('spear')) {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(wx, wy + 1, u, Math.max(2, Math.floor(weaponH * 0.25)));
  } else if (weaponType.includes('wand') || weaponType.includes('bow')) {
    ctx.fillStyle = palette.highlight;
    ctx.fillRect((wx + d * 1) * u, wy + 2, 2, 2);
  }
  // weapon surface lines (small, relative to pole at wx)
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(wx - 1, wy + 3, 3, u);
  ctx.fillRect(wx - 1, wy + 7, 3, u);
}

function drawAccessoryCape(ctx, cx, cy, u, palette, torsoH, capeType, capeW = 3, capeFlow = 2) {
  if (!capeType || capeType === 'none') return;
  const cw = capeW;
  ctx.fillStyle = palette.primary;
  ctx.fillRect(cx * u, cy * u, cw * u, (torsoH + 3) * u);
  ctx.fillStyle = palette.shadow;
  ctx.fillRect((cx + 1) * u, cy * u + 2, u, torsoH);
  // LLM cape_flow adds extra flow lines / flare for creative cape "drawing"
  for (let f = 0; f < capeFlow; f++) {
    ctx.fillRect((cx + 1 + f) * u, cy * u + 4 + f * 2, u, 2);
  }
}

function drawSkeletalWings(ctx, cx, cy, u, palette, torsoH, boneCount = 4, wingLenMod = 1, wingDir = -1) {
  // Skeletal/dragon wings for Mortacia (bone-like on back, coming out of the back on the side opposite the face direction).
  // For right-side placement: caller sets profileFacing=-1 for Mortacia (face looks left) so capeX on right of body,
  // and passes wingDir=+1 so bones fan further right, away from body column ("on the right side coming out of the back").
  // Grey dragon tones (not pure shadow) per "Mortacia is a tall goddess with grey dragon wings".
  // Emphasize clear, visible dragon wing bones (thick main arm + 3-5 long fanned finger bones with joints/knuckles).
  // boneCount and wingLenMod from design allow LLM variety (more/longer bones).
  // Grey palette for bony dragon structure; visible thickness so holds up at 25px combat scale.
  const isGreyDragon = true; // always grey dragon for skeletal_wings per Mortacia spec
  const boneShadow = isGreyDragon ? '#4a4a4a' : palette.shadow;
  const boneMid = isGreyDragon ? '#6a6a6a' : palette.primary;
  const boneLight = isGreyDragon ? '#8a8a8a' : palette.highlight;
  const clawColor = isGreyDragon ? '#3a3a3a' : palette.accent;

  ctx.fillStyle = boneShadow;
  const h = Math.floor(torsoH * (1.25 + (wingLenMod - 1) * 0.25));  // taller for pulpy large dragon wings on Mortacia (grey bones fanned)

  // Main wing arm bone (humerus/forearm) - thicker 2px for structure, offset outward from attach cx by wingDir
  const m1 = cx + wingDir * 2;
  const m2 = cx + wingDir * 3;
  ctx.fillRect(m1 * u, cy * u, 2 * u, Math.floor(h * 0.35) * u); // upper arm
  ctx.fillRect(m2 * u, (cy + Math.floor(h * 0.28)) * u, 2 * u, Math.floor(h * 0.45) * u); // forearm

  // Dragon wing finger bones - boneCount long digits fanning from "wrist" area (elongated for membrane support)
  // fanned outward in wingDir
  const wristY = cy + Math.floor(h * 0.55);
  const numFingers = Math.max(3, Math.min(5, boneCount));
  for (let i = 0; i < numFingers; i++) {
    const offset = i - Math.floor(numFingers / 2);
    const fingerX = cx + wingDir * (4 + Math.max(0, offset));
    const fingerLen = Math.floor(h * (0.55 + i * 0.08));
    const fingerY = wristY - 3 + offset * 2;
    ctx.fillRect(fingerX * u, fingerY * u, 1 * u, fingerLen * u);
  }

  // Visible joints / cross struts / knuckles (make bones read as skeletal structure)
  ctx.fillStyle = boneMid;
  ctx.fillRect((cx + wingDir * 3) * u, (cy + Math.floor(h * 0.22)) * u, 3 * u, 1 * u); // elbow joint
  ctx.fillRect((cx + wingDir * 4) * u, (wristY - 2) * u, 3 * u, 1 * u); // wrist
  ctx.fillRect((cx + wingDir * 5) * u, (wristY + Math.floor(h * 0.35)) * u, 3 * u, 1 * u); // mid finger brace
  ctx.fillRect((cx + wingDir * 6) * u, (wristY + Math.floor(h * 0.6)) * u, 2 * u, 1 * u); // lower brace

  // Leading edge claw/tip detail (small accent on front bone)
  ctx.fillStyle = clawColor;
  ctx.fillRect((cx + wingDir * 4) * u, (wristY - 5) * u, 1 * u, 2 * u);

  // Subtle bone edge highlight for volume/definition (helps at tiny scale)
  ctx.fillStyle = boneLight;
  ctx.fillRect((cx + wingDir * 2) * u, cy * u + 1, 1 * u, Math.floor(h * 0.7) * u - 2); // on main arm
}

function resolveStarterVariant(seed, spriteSpec, variantCount) {
  const explicitValue = spriteSpec && spriteSpec.design ? spriteSpec.design.starter_variant : undefined;
  const explicit = Number(explicitValue);
  if (explicitValue != null && Number.isFinite(explicit)) return Math.abs(Math.floor(explicit)) % variantCount;
  if (Number.isFinite(Number(seed))) {
    const numericSeed = Math.abs(Math.floor(Number(seed) * 1000000));
    if (numericSeed) return numericSeed % variantCount;
    const seedKey = String(seed);
    let seedHash = 0;
    for (let i = 0; i < seedKey.length; i++) seedHash = ((seedHash * 33) + seedKey.charCodeAt(i)) >>> 0;
    return seedHash % variantCount;
  }
  const poseKey = (spriteSpec && (spriteSpec.pose || (spriteSpec.design && spriteSpec.design.pose))) || '';
  if (typeof poseKey === 'string' && poseKey) {
    let hash = 0;
    for (let i = 0; i < poseKey.length; i++) hash = ((hash * 31) + poseKey.charCodeAt(i)) >>> 0;
    return hash % variantCount;
  }
  return Math.abs(Math.floor((seed || 0) * 1000)) % variantCount;
}

function getMortaciaStarterFamily(variant = 0) {
  const families = [
    {
      exact: true,
      parts: { head: 'human_hair', torso: 'bone_corset', legs: 'long_striders', weapon: 'sword_broad', accessory: 'skeletal_wings' },
      pose: 'attack_slash_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 6, leg_thickness: 2, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: -3, weapon_length: 8, blade_size: 4, wing_bone_count: 5, wing_length: 2, robe_flare: 1, fold_density: 2 }
    },
    {
      exact: true,
      parts: { head: 'human_hair', torso: 'cinched_corset', legs: 'flowing_skirt', weapon: 'sword_broad', accessory: 'skeletal_wings' },
      pose: 'attack_slash_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 6, leg_thickness: 2, leg_height: 11, stride_amount: 1, arm_length: 5, arm_swing: -3, weapon_length: 9, blade_size: 4, wing_bone_count: 5, wing_length: 2, robe_flare: 2, fold_density: 3 }
    },
    {
      exact: true,
      parts: { head: 'human_hair', torso: 'bone_corset', legs: 'striding_boots', weapon: 'sword_broad', accessory: 'skeletal_wings' },
      pose: 'attack_slash_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 6, leg_thickness: 2, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: -2, weapon_length: 8, blade_size: 3, wing_bone_count: 4, wing_length: 2, robe_flare: 1, fold_density: 2 }
    },
    {
      exact: false,
      parts: { head: 'human_hair', torso: 'dress_robe', legs: 'flowing_skirt', weapon: 'sword_broad', accessory: 'skeletal_wings' },
      pose: 'idle_stand_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 6, leg_thickness: 2, leg_height: 12, stride_amount: 1, arm_length: 5, arm_swing: -2, weapon_length: 9, blade_size: 4, wing_bone_count: 5, wing_length: 2, robe_flare: 3, fold_density: 4 }
    },
    {
      exact: false,
      parts: { head: 'human_hair', torso: 'tapered_robe', legs: 'long_striders', weapon: 'spear', accessory: 'skeletal_wings' },
      pose: 'striding_elegant_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 5, leg_thickness: 2, leg_height: 13, stride_amount: 2, arm_length: 5, arm_swing: -2, weapon_length: 11, blade_size: 3, wing_bone_count: 5, wing_length: 2, robe_flare: 2, fold_density: 3 }
    },
    {
      exact: false,
      parts: { head: 'human_hair', torso: 'cinched_corset', legs: 'striding_boots', weapon: 'mace', accessory: 'skeletal_wings' },
      pose: 'defend_dodge_female',
      design: { head_size: 3, head_width: 4, torso_width: 4, torso_height: 5, leg_thickness: 2, leg_height: 12, stride_amount: 2, arm_length: 5, arm_swing: -2, weapon_length: 8, blade_size: 4, wing_bone_count: 4, wing_length: 2, robe_flare: 1, fold_density: 2 }
    }
  ];
  return families[Math.abs(variant) % families.length];
}

function getSuzerainStarterFamily(variant = 0) {
  const families = [
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 1, weapon_length: 9, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 3, crest_spikes: 2 }
    },
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 1, weapon_length: 10, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 3, crest_spikes: 2 }
    },
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 0, weapon_length: 9, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 2, crest_spikes: 2 }
    },
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 1, weapon_length: 9, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 3, crest_spikes: 2 }
    },
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 0, weapon_length: 10, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 2, crest_spikes: 2 }
    },
    {
      exact: true,
      parts: { head: 'gallant_helm', torso: 'gallant_plate', legs: 'armored_greaves', weapon: 'sword_broad', accessory: 'flowing_cape' },
      pose: 'attack_overhead_male',
      design: { head_size: 4, head_width: 5, torso_width: 5, torso_height: 5, leg_thickness: 3, leg_height: 10, stride_amount: 1, arm_length: 5, arm_swing: 1, weapon_length: 10, blade_size: 3, cape_width: 3, cape_flow: 3, crest_height: 3, crest_spikes: 2 }
    }
  ];
  return families[Math.abs(variant) % families.length];
}

// EXACT MORTACIA REPLICATION (for the provided reference image #2).
// Methodology: Meticulous visual analysis of the reference (side profile facing left, small head with light top + black eye bar + skin face, dark grey costume body with mid grey belt/waist accent, skin tone thighs and arm, grey boots, light tan vertical sword held upward from rib/hand level on left with skin hand at base, complex stepped grey wing-like structure on right/back with multiple segments/prongs).
// We lock the pixel layout to exact rect clusters (base pixel positions chosen to match the ref's proportions, silhouette, attachments and "stacked" look when core body is centered at ~11-12,11-12).
// Color variations: seed-driven small palette shifts (different dark greys for body, mid/light greys for wing/boots, tans for sword/hair, skins) so every generation is structurally identical ("similar result every time") but has color variety for interest/rerolls.
// This bypasses the general prefab/draw* for Mortacia to guarantee pixel-perfect match to the ref (while other characters use the catalog system).
// Draw order: wing (back), legs, torso (costume), head, arm+hand, sword (front), details/outlines.
// All positions in base pixels; *u at draw time. Center chosen so the figure sits plumb and centered like the ref.
function drawMortaciaExact(ctx, baseX, baseY, u, seed, palette, variant = 0) {
  // Pixel-mock silhouette (user attachment): left-facing blocky profile, sword vertical tip-UP in front of torso,
  // wing/cape mass on the back, tan skin, dark grey garments, tall boots. Tip-up fighting-ready grip.
  const s = seed || 0;
  const v = Math.floor(s * 1000) % 5;
  const mortaciaVariants = [
    { wingShift: 4, wingLift: 0, wingExtraReach: 2, handLift: 0, swordLift: 0, swordLen: 11, thighLift: 0, bootLift: 0, hairLen: 5, hairFront: 1, stance: 0 },
    { wingShift: 5, wingLift: -1, wingExtraReach: 3, handLift: -1, swordLift: -1, swordLen: 12, thighLift: -1, bootLift: -1, hairLen: 6, hairFront: 1, stance: 1 },
    { wingShift: 4, wingLift: 1, wingExtraReach: 2, handLift: 0, swordLift: 0, swordLen: 10, thighLift: 0, bootLift: 0, hairLen: 4, hairFront: 0, stance: 0 }
  ];
  const cfg = mortaciaVariants[Math.abs(variant) % mortaciaVariants.length];
  const wingX = baseX + cfg.wingShift;
  const wingY = baseY + cfg.wingLift;
  const thighY = baseY + 11 + cfg.thighLift;
  const bootY = baseY + 16 + cfg.bootLift;
  const torsoY = baseY + 5;
  const armY = baseY + 6 + cfg.handLift;
  const forearmY = baseY + 3 + cfg.handLift;
  const handY = baseY + 7 + cfg.handLift;
  const swordY = baseY - 2 + cfg.swordLift; // tip starts above the head
  const stance = cfg.stance || 0;

  // Dark greys (armor/garments/wings), tan skin, pale sword — matching the pixel mock palette
  const bodyDark = ['#2a2a2e', '#303034', '#26262a', '#343438', '#222226'][v];
  const greyMid = ['#4a4a50', '#525258', '#44444a', '#5a5a60', '#3e3e44'][v];
  const greyLight = ['#6a6a72', '#74747c', '#606068', '#7a7a82', '#585860'][v];
  const greyDark = ['#1e1e22', '#242428', '#1a1a1e', '#2a2a2e', '#16161a'][v];
  const swordTan = ['#d8c898', '#cfc090', '#e0d0a0', '#c4b488', '#d0c090'][v];
  const skinTone = ['#e8c4a8', '#f0d0b0', '#e0b890', '#ecc8a0', '#d8b088'][v];
  const hairPale = ['#e8e4dc', '#f0ebe2', '#ddd8d0', '#f5f0e8', '#d8d4cc'][v];
  const blackDetail = '#111114';

  // === WING / CAPE MASS (back right): tall vertical + jagged trailing mass per mock ===
  ctx.fillStyle = greyDark;
  ctx.fillRect((wingX + 0) * u, (wingY + 0) * u, 2 * u, 3 * u); // top spike past head
  ctx.fillRect((wingX + 1) * u, (wingY + 1) * u, 2 * u, 2 * u);
  ctx.fillStyle = greyMid;
  ctx.fillRect((wingX + 2) * u, (wingY + 0) * u, 2 * u, 4 * u);
  ctx.fillRect((wingX + 1) * u, (wingY + 3) * u, 3 * u, 6 * u); // main mass
  ctx.fillStyle = greyLight;
  ctx.fillRect((wingX + 3) * u, (wingY + 2) * u, 2 * u, 4 * u);
  ctx.fillRect((wingX + 4) * u, (wingY + 1) * u, 1 * u, 3 * u); // thin up protrusion
  ctx.fillStyle = greyMid;
  ctx.fillRect((wingX + 4) * u, (wingY + 3) * u, 2 * u, (12 + cfg.wingExtraReach) * u); // tall trailing blade
  ctx.fillStyle = greyLight;
  ctx.fillRect((wingX + 3) * u, (wingY + 7) * u, 2 * u, 3 * u);
  ctx.fillRect((wingX + 3) * u, (wingY + 10) * u, 2 * u, 3 * u);
  ctx.fillRect((wingX + 2) * u, (wingY + 12) * u, 3 * u, 2 * u); // lower jagged cape flap
  ctx.fillStyle = greyDark;
  ctx.fillRect((wingX + 1) * u, (wingY + 14) * u, 3 * u, 4 * u);
  ctx.fillRect((wingX + 3) * u, (wingY + 16) * u, 2 * u, 2 * u);

  // === LEGS: tan thighs, tall dark boots (slight fighting stance offset) ===
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX + 1) * u, thighY * u, 3 * u, 5 * u);
  if (stance) ctx.fillRect((baseX + 4) * u, (thighY + 1) * u, 1 * u, 3 * u); // wider stance hint
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX) * u, bootY * u, 4 * u, 5 * u);
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX) * u, bootY * u, 1 * u, 5 * u);
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 3) * u, bootY * u, 1 * u, 4 * u);
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX) * u, (bootY + 3) * u, 4 * u, 2 * u);

  // === TORSO: dark grey garment covering belly (no bare midriff read at map scale) ===
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX) * u, torsoY * u, 4 * u, 7 * u);
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX) * u, (torsoY + 4) * u, 4 * u, 1 * u); // belt
  ctx.fillRect((baseX + 3) * u, torsoY * u, 1 * u, 7 * u);
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 3) * u, torsoY * u, 1 * u, 3 * u);

  // === HEAD: tan face, dark/pale hair mass on top+back ===
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX) * u, (baseY + 1) * u, 4 * u, 2 * u); // dark hair/cap top (mock)
  ctx.fillStyle = hairPale;
  ctx.fillRect((baseX + 1) * u, (baseY + 1) * u, 2 * u, 1 * u); // pale highlight
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX + 1) * u, (baseY + 3) * u, 3 * u, 3 * u);
  ctx.fillStyle = blackDetail;
  ctx.fillRect((baseX + 1) * u, (baseY + 4) * u, 2 * u, 1 * u);
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX + 1) * u, (baseY + 6) * u, 2 * u, 1 * u);
  ctx.fillStyle = hairPale;
  ctx.fillRect((baseX + 3) * u, (baseY + 2) * u, 1 * u, cfg.hairLen * u);
  ctx.fillRect((baseX + 4) * u, (baseY + 3) * u, 1 * u, Math.max(2, cfg.hairLen - 1) * u);
  if (cfg.hairFront) ctx.fillRect((baseX + 0) * u, (baseY + 2) * u, 1 * u, 3 * u);

  // === ARM + HAND: skin, grip at mid-torso holding tip-UP sword in front ===
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX) * u, armY * u, 2 * u, 3 * u);
  ctx.fillRect((baseX - 2) * u, forearmY * u, 2 * u, 4 * u);
  ctx.fillRect((baseX - 2) * u, handY * u, 2 * u, 2 * u);

  // === SWORD tip-UP: pale blade vertical in front of torso, hilt at hand ===
  ctx.fillStyle = swordTan;
  ctx.fillRect((baseX - 3) * u, swordY * u, 2 * u, cfg.swordLen * u);
  ctx.fillRect((baseX - 2) * u, (swordY + 1) * u, 1 * u, Math.max(6, cfg.swordLen - 2) * u);
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX - 3) * u, (handY + 1) * u, 2 * u, 1 * u); // hilt/guard
  ctx.fillRect((baseX - 3) * u, handY * u, 2 * u, 1 * u);

  ctx.fillStyle = '#111';
  ctx.fillRect((baseX - 1) * u, (baseY + 2) * u, 1 * u, 6 * u);
  ctx.fillRect((baseX - 1) * u, (baseY + 7) * u, 1 * u, 7 * u);
  ctx.fillRect((baseX - 1) * u, (baseY + 13) * u, 1 * u, 9 * u);
  ctx.fillRect((baseX - 4) * u, swordY * u, 1 * u, (cfg.swordLen + 1) * u);
}

function drawSuzerainExact(ctx, baseX, baseY, u, seed, palette, variant = 0) {
  const s = seed || 0;
  const v = Math.floor(s * 1000) % 4; // color variations for rerolls while keeping exact layout
  const suzerainVariants = [
    { shoulderW: 6, swordLen: 15, swordLift: 0, capeFlow: 6, capeLift: 0, crestH: 2, legLift: 0, torsoLift: 0 },
    { shoulderW: 7, swordLen: 16, swordLift: -1, capeFlow: 7, capeLift: -1, crestH: 3, legLift: -1, torsoLift: -1 },
    { shoulderW: 5, swordLen: 14, swordLift: 0, capeFlow: 8, capeLift: 0, crestH: 2, legLift: 0, torsoLift: 0 }
  ];
  const cfg = suzerainVariants[Math.abs(variant) % suzerainVariants.length];
  const headY = baseY + 3 + cfg.torsoLift;
  const neckY = baseY + 7 + cfg.torsoLift;
  const torsoY = baseY + 8 + cfg.torsoLift;
  const capeY = baseY + 5 + cfg.capeLift;
  const swordY = baseY - 2 + cfg.swordLift;
  const legY = baseY + 11 + cfg.legLift;

  // Colors matched to the reference image(s) provided for Suzerain, with slight var (v=seed%4) for "similar result every time with color variations" while layout/pose/rects 100% locked identical.
  const helmLight = ['#f5d8a8', '#e8c898', '#f0d0a0', '#d8b080'][v];
  const helmDark = ['#2a2a2a', '#222222', '#333333', '#1f1f1f'][v];
  const armorDark = ['#1a1a1a', '#222222', '#252525', '#181818'][v];
  const armorLight = ['#d0b890', '#c8a880', '#d8c0a0', '#b89870'][v]; // greaves
  const belt = '#c8b080';
  const skin = ['#e8d0b0', '#f0d8b8', '#d8c0a0', '#e0c8a8'][v];
  const capeRed = ['#aa2222', '#b83333', '#992222', '#c04040'][v]; // red cape exactly as in ref
  const swordDark = '#1a1a1a';
  const footDark = '#111111';

  // === DISTINCTIVE HELM (width reduced ~15-20% to 4px; left-biased visor/cross for facing left per image) ===
  ctx.fillStyle = helmLight;
  ctx.fillRect((baseX + 1) * u, headY * u, 4 * u, 4 * u); // head width reduced (was 5), y+2 moved down w/ body
  ctx.fillStyle = helmDark;
  ctx.fillRect((baseX + 1) * u, headY * u, 1 * u, 4 * u); // vertical left-biased (facing left)
  ctx.fillRect((baseX + 1) * u, (headY + 1) * u, 2 * u, 1 * u); // horiz crossbar left side
  ctx.fillStyle = capeRed;
  ctx.fillRect((baseX + 3) * u, (headY - cfg.crestH) * u, 1 * u, cfg.crestH * u); // knightly plume
  ctx.fillRect((baseX + 2) * u, (headY - cfg.crestH) * u, 2 * u, 1 * u);

  // === NECK / UPPER TORSO JOIN (body moved down) ===
  ctx.fillStyle = armorDark;
  ctx.fillRect((baseX + 2) * u, neckY * u, 2 * u, 1 * u);

  // === TORSO ARMOR (slightly expanded shoulder width at upper; main body wider w=5 for shoulders; y+2) ===
  ctx.fillStyle = armorDark;
  ctx.fillRect((baseX + 0) * u, torsoY * u, cfg.shoulderW * u, 3 * u); // wider shoulder silhouette for more knight presence
  ctx.fillStyle = belt;
  ctx.fillRect((baseX + 0) * u, (torsoY + 2) * u, Math.min(cfg.shoulderW, 5) * u, 1 * u); // belt
  ctx.fillStyle = armorLight;
  ctx.fillRect((baseX + 0) * u, (torsoY + 3) * u, 3 * u, 1 * u); // lower plate accent
  ctx.fillStyle = helmLight;
  ctx.fillRect((baseX + 0) * u, (torsoY + 0) * u, 1 * u, 1 * u); // left pauldron highlight
  ctx.fillRect((baseX + cfg.shoulderW - 1) * u, (torsoY + 0) * u, 1 * u, 1 * u); // right pauldron highlight

  // === RED CAPE (separated from body +1-2px gap; flows to bottom right via right-shifted lower segments; y+2 with body) ===
  ctx.fillStyle = capeRed;
  ctx.fillRect((baseX + 6) * u, capeY * u, 1 * u, 5 * u); // upper (gap from body at x+5)
  ctx.fillRect((baseX + 5) * u, (capeY + 4) * u, 2 * u, 3 * u); // mid
  ctx.fillRect((baseX + 6) * u, (capeY + 6) * u, 2 * u, cfg.capeFlow * u); // lower shifted right, longer flow to bottom right (detached)

  // === LEFT HAND/ARM (grip; y moved with body) ===
  ctx.fillStyle = skin;
  ctx.fillRect((baseX - 1) * u, torsoY * u, 1 * u, 2 * u); // arm
  ctx.fillRect((baseX - 2) * u, torsoY * u, 2 * u, 2 * u); // hand grip (right of sword)

  // === SWORD (longer/taller look: body+2 down makes it protrude more above head; h+1, start higher rel) ===
  ctx.fillStyle = swordDark;
  ctx.fillRect((baseX - 4) * u, swordY * u, 2 * u, cfg.swordLen * u); // start higher for more knightly blade presence
  ctx.fillRect((baseX - 4) * u, legY * u, 2 * u, 2 * u); // hilt (moved w/ grip hand)

  // === RIGHT HAND AT SIDE (second set; y+2, x adjusted for wider shoulder) ===
  ctx.fillStyle = skin;
  ctx.fillRect((baseX + cfg.shoulderW - 1) * u, (torsoY + 2) * u, 2 * u, 2 * u); // right hand at side (gap to cape)

  // === LEGS / GREAVES (y+2 for body down; keep taller h, shorter than Mortacia) ===
  ctx.fillStyle = armorLight;
  ctx.fillRect((baseX + 1) * u, legY * u, 3 * u, 8 * u); // greaves (y+2)
  ctx.fillStyle = helmDark;
  ctx.fillRect((baseX + 1) * u, (legY + 1) * u, 3 * u, 1 * u); // band
  ctx.fillRect((baseX + 1) * u, (legY + 5) * u, 3 * u, 1 * u); // ankle band
  ctx.fillStyle = footDark;
  ctx.fillRect((baseX + 0) * u, (legY + 7) * u, 4 * u, 2 * u); // feet (y+2)

  // === Crisp outlines (all y/x adjusted for head narrow, body down, cape separate, sword longer) ===
  ctx.fillStyle = '#111';
  ctx.fillRect((baseX - 1) * u, headY * u, 1 * u, 4 * u); // helm left
  ctx.fillRect((baseX + cfg.shoulderW) * u, torsoY * u, 1 * u, 4 * u); // torso right
  ctx.fillRect((baseX + 0) * u, legY * u, 1 * u, 10 * u); // leg/greave left
  ctx.fillRect((baseX - 4) * u, swordY * u, 1 * u, cfg.swordLen * u); // sword left
  ctx.fillRect((baseX + 7) * u, capeY * u, 1 * u, (cfg.capeFlow + 7) * u); // cape right edge (further for separation + flow)
}

// Main drawing routine that builds the sprite into a canvas using our prefab catalog.
// Returns the raw canvas (96x96). This is the best form for Phaser (addCanvas + NEAREST).
// generateCharacterSprite (below) wraps it for dataUrl compat (review menu, server, <img> tags).
function createCharacterSpriteCanvas(character, spriteSpec = null) {
  const traitSpec = getProceduralSpec(character, spriteSpec);
  if (traitSpec) return createTraitSpriteCanvas(traitSpec, 0);
  const canvas = createCanvas(BASE_SIZE * UPSCALE, BASE_SIZE * UPSCALE);
  const ctx = canvas.getContext('2d');

  const paletteBase = normalizePalette(spriteSpec?.palette);

  const name = character.name || character.Name || 'Adventurer';
  const sex = character.sex || character.Sex || 'male';
  const race = character.race || character.Race || 'human';
  const charClass = character.class || character.Class || 'fighter';

  const s = BASE_SIZE * UPSCALE;
  // Transparent background so sprite composites cleanly on Combat map bg (no dark square)
  // ctx.fillStyle = '#111'; ctx.fillRect(0, 0, s, s);  // removed per user request

  const isFemale = (sex || '').toLowerCase() === 'female';
  const u = UPSCALE;

  const seed = character._rerollSeed || (Date.now() % 98765);
  const mod = Math.floor(seed * 1000) % 7;
  const mod2 = Math.floor(seed * 1000) % 5;
  const c = charClass.toLowerCase();
  const isMortacia = (name || '').toLowerCase().includes('mortacia');
  const isSuzerain = (name || '').toLowerCase().includes('suzerain');
  const starterVariant = (isMortacia || isSuzerain) ? resolveStarterVariant(seed, spriteSpec, 6) : 0;
  const starterFamily = isMortacia ? getMortaciaStarterFamily(starterVariant) : (isSuzerain ? getSuzerainStarterFamily(starterVariant) : null);

  let palette = paletteBase;
  // Grey costume for Mortacia to match latest ref [Image #1]: dark grey body/corset (primary), medium grey for boots/trim/legs base (secondary),
  // light tan/beige for sword blade + hair definition (highlight) so the upward sword on left matches the light held item in ref,
  // skin for face/thighs/arm, grey accents. Wings already use dedicated grey bone tones.
  if (isMortacia) {
    palette = {
      primary: '#2a2a2a',   // darker grey costume (main torso, corset, robe body) to closer match solid dark grey dress in ref [Image #1]
      secondary: '#5a5a5a', // medium grey for boots, lower legs, arm base, trim
      highlight: '#c8b48a', // light tan/beige for the upward sword blade (to match ref light vertical on left) + hair strands
      shadow: '#1a1a1a',
      skin: '#e8d0b0',      // pale skin tone to better show on thighs/arms/face like ref
      accent: '#707070'     // grey metal-ish for crossguard / small accents
    };
  }

  const parts = (spriteSpec && spriteSpec.parts) || {};
  // Clone to local let so we can safely read/write design/pose numbers without ever mutating a
  // const-frozen object that may arrive from JSON.parse / server responses / after-Save pending char.
  // This prevents "Assignment to constant variable" during reroll paths after Save.
  let pose = { ...((spriteSpec && (spriteSpec.pose || spriteSpec.proportions)) || {}) };
  let design = { ...((spriteSpec && spriteSpec.design) || {}) };
  if (starterFamily && starterFamily.design) {
    design = { ...starterFamily.design, ...design };
  }

  // === Resolve to discrete catalog choices (LLM and deterministic fallback does too) ===
  let headType = parts.head || (c.includes('necromancer') || c.includes('goddess') ? 'skull_crest' : (c.includes('knight') ? (mod % 2 === 0 ? 'plumed_helmet' : 'gallant_helm') : (isFemale ? 'human_hair' : 'normal_human')));
  // legacy tolerance (LLM may still emit old keys from previous prompts)
  if (headType === 'skull') headType = 'skull_crest';
  if (headType === 'helmet') headType = 'plumed_helmet';
  // Iconic forced prefabs for starters per descriptions + user direction (read the files: Mortacia tall goddess grey dragon wings; Suzerain gallant knight per ref image). Old Suzerain knight shapes (plumed_helmet, plate_armor, armored_greaves, flowing_cape) saved as general templates for monsters/knight NPCs (extensible catalog). Suzerain now fresh gallant knight: gallant_helm (crested per image example), gallant_plate, greaves, cape, sword. 
  // Old Suzerain knight shapes (plumed_helmet, plate_armor, armored_greaves, flowing_cape) saved as general templates for monsters/knight NPCs (extensible catalog).
  // Suzerain now fresh gallant knight: gallant_helm (crested per image example), plate armor, greaves, cape, sword.
  if (isMortacia) {
    headType = 'human_hair';  // for bigger head, more defined feminine hair + simple single-line cap per ref
  }
  if ((name || '').toLowerCase().includes('suzerain')) {
    headType = starterFamily.parts.head;
  }
  if (headType === 'normal' || headType === 'human') headType = isFemale ? 'human_hair' : 'normal_human';
  if (headType === 'hood') headType = 'hooded_skull';

  let torsoType = parts.torso || parts.body || (c.includes('knight') ? (mod % 2 === 0 ? 'gallant_plate' : 'plate_armor') : 'flowing_robe');
  let legsType = parts.legs || 'striding_boots';
  let armType = parts.arm || 'swinging_upper_lower';
  let weaponType = parts.weapon || parts.item || (c.includes('necromancer') ? 'sword_broad' : (c.includes('knight') ? 'sword_broad' : 'staff_crook'));
  // Weapon variety: different every reroll/seed so it does not "throw off the generation" (user feedback).
  // Pose + design.weapon_length/blade_size will visibly change hold/length/shape.
  const weaponOptions = ['scythe_long', 'sword_broad', 'staff_crook', 'dagger', 'axe', 'mace', 'spear', 'wand'];
  if ((mod + (seed % 5)) % 3 === 0 || weaponType === 'scythe_long' && (mod % 2 === 0)) {
    weaponType = weaponOptions[(seed + mod) % weaponOptions.length];
  }
  let accType = parts.accessory || (c.includes('goddess') || c.includes('necromancer') ? 'flowing_cape' : 'none');
  // Force iconic for the two starters (do the prefabs the way the game aesthetic + descriptions + images demand)
  if (isMortacia) {
    headType = starterFamily.parts.head;
    torsoType = starterFamily.parts.torso;
    legsType = starterFamily.parts.legs;
    weaponType = starterFamily.parts.weapon;
    accType = starterFamily.parts.accessory;
  }
  if ((name || '').toLowerCase().includes('suzerain')) {
    headType = starterFamily.parts.head;
    torsoType = starterFamily.parts.torso;
    legsType = starterFamily.parts.legs;
    weaponType = starterFamily.parts.weapon;
    accType = starterFamily.parts.accessory;
  }

  // Safe number helper
  function safeNum(v, def) { if (v == null) return def; const n = Number(v); return Number.isFinite(n) ? n : def; }

  // Base dimensions now primarily driven by LLM "design" params for creative control (clamped for sanity + readability).
  // LLM controls the "drawing" via these numbers; engine still enforces structure.
  let p = {
    headH: safeNum(design.head_size, 4),
    headW: safeNum(design.head_width, 5),
    torsoH: safeNum(design.torso_height, (torsoType.includes('robe') || torsoType.includes('dress') || torsoType.includes('flowing') ? 5 : 4)), // shrunk per user feedback for better proportions
    torsoW: safeNum(design.torso_width, (torsoType.includes('armor') || torsoType.includes('plate') || torsoType.includes('gallant') ? 5 : 6)),
    legH: safeNum(design.leg_height, 11), // longer legs per user feedback
    legW: safeNum(design.leg_thickness, (isFemale ? 3 : 3)),
    armH: safeNum(design.arm_length, 5),
    wingBoneCount: safeNum(design.wing_bone_count, 4),
    wingLength: safeNum(design.wing_length, 1)
  };

  // Apply catalog type adjustments + clamps (LLM design takes precedence but we keep it humanoid)
  if (headType.includes('skull') || headType.includes('crest')) { p.headH = Math.max(p.headH, 4); p.headW = Math.max(p.headW, 5); }
  if (headType.includes('helmet') || headType.includes('gallant')) { p.headH = Math.max(p.headH, 4); p.headW = Math.max(p.headW, 6); }
  if (c.includes('dwarf')) { p.legH = Math.min(p.legH, 8); p.torsoW = Math.max(p.torsoW, 7); p.headH = Math.min(p.headH, 4); }
  if (c.includes('elf')) { p.legH = Math.max(p.legH, 11); p.torsoW = Math.min(p.torsoW, 5); p.headW = Math.min(p.headW, 4); }

  p.headH = Math.max(3, Math.min(6, p.headH));
  p.torsoH = Math.max(4, Math.min(7, p.torsoH)); // allow smaller per feedback
  p.legH = Math.max(9, Math.min(13, p.legH));
  if (p.headH + p.torsoH + p.legH > 24) p.legH = 24 - p.headH - p.torsoH;

  // Small seed-driven body variation (rerolls differ even for similar LLM design)
  const varMod = (seed % 5) - 2;
  p.legH = Math.max(8, Math.min(12, p.legH + (varMod > 1 ? 1 : 0)));
  p.torsoW = Math.max(5, Math.min(8, p.torsoW + (varMod < -1 ? 1 : 0)));
  p.headW = Math.max(4, Math.min(7, p.headW + (varMod === 0 ? 1 : 0)));

  // Pose / stride / swing from LLM design or pose (exaggerated for tiny scale readability)
  let legSpread = safeNum(design.stride_amount, safeNum(pose.legSpread, (isFemale ? 1 : 0) + (mod % 2)));
  let armSwing = safeNum(design.arm_swing, safeNum(pose.armOffsetY != null ? pose.armOffsetY : pose.armSwing, (mod % 3 - 1)));
  let weaponLen = safeNum(design.weapon_length, safeNum(pose.weaponH, (weaponType.includes('scythe') ? 11 : 9)));

  let effectiveStride = Math.max(1, Math.min(4, legSpread * 1.5));
  let effectiveArmSwing = Math.max(-3, Math.min(2, armSwing * 1.2));
  const armThick = Math.max(2, Math.min(4, safeNum(design.arm_thickness, 3)));
  const legThick = p.legW; // already set
  const bladeSz = Math.max(2, Math.min(6, safeNum(design.blade_size, 4)));
  const foldDens = Math.max(1, Math.min(5, safeNum(design.fold_density, 3)));
  const capeW = Math.max(2, Math.min(4, safeNum(design.cape_width, 3)));
  const capeFlow = Math.max(1, Math.min(3, safeNum(design.cape_flow, 2)));
  const robeFlare = Math.max(1, Math.min(3, safeNum(design.robe_flare, 2)));
  let crestH = Math.max(1, Math.min(3, safeNum(design.crest_height, 2)));
  const crestSpikes = Math.max(1, Math.min(4, safeNum(design.crest_spikes, 3)));

  const topPose = spriteSpec && spriteSpec.pose;
  let charPose = (typeof topPose === 'string' ? topPose : (design.pose || (pose && pose.pose) || 'striding'));

  // For Mortacia (pulpy goddess with sword): force a dynamic raised-sword attack pose so the blade is held up/overhead rather than sweeping horizontally across the body/wings.
  if (starterFamily && starterFamily.pose) charPose = starterFamily.pose;

  // Pose-specific adjustments for dozens of unique poses (male/female variants ensure variety, not just colors)
  let bodyLean = 0;
  let headTilt = 0;
  let extraLegOffset = 0;

  if (charPose.includes('idle') || charPose.includes('stand')) {
    effectiveStride = 0.5;
    effectiveArmSwing = 0;
  } else if (charPose.includes('run') || charPose.includes('dash')) {
    effectiveStride = Math.max(effectiveStride, 3);
    bodyLean = isFemale ? 1 : 2;
  } else if (charPose.includes('cast') || charPose.includes('spell')) {
    effectiveArmSwing = -2.5;
    headTilt = isFemale ? -1 : 0;
  } else if (charPose.includes('attack') || charPose.includes('thrust') || charPose.includes('slash')) {
    effectiveArmSwing = 1.5;
    extraLegOffset = 1;
  } else if (charPose.includes('kneel')) {
    effectiveStride = 0;
    bodyLean = 1;
  } else if (charPose.includes('bow') || charPose.includes('arch')) {
    effectiveStride = 1.5;
    effectiveArmSwing = -1;
  }

  // For Mortacia: move hands and weapon to left and higher like the ref image #2
  // negative effectiveArmSwing makes initial armBaseY higher (smaller y) and swing negative makes hand x further left (for facing left)
  if (isMortacia) {
    effectiveArmSwing = -2.5;
    effectiveStride = 0.6; // legs close together / more underneath like the latest ref image (not wide stride)
  }

  // Sex changes prefabs used: female thinner and more beautiful (narrower, graceful)
  if (isFemale) {
    p.torsoW = Math.max(3, Math.floor(p.torsoW * 0.82)); // thinner elegant
    p.legW = Math.max(2, Math.floor(p.legW * 0.88));
    p.headW = Math.max(3, Math.floor(p.headW * 0.92));
    p.armH = Math.floor(p.armH * 0.95);
    // beautiful: emphasize graceful features
    if (headType.includes('hair') || headType.includes('skull') || headType.includes('crowned')) {
      crestH = Math.max(crestH, 2);
    }
  }

  // Mortacia slender + tall goddess: per user + "Mortacia is a tall goddess with grey dragon wings"
  // "think of what pulpy goddesses look like" (ref: powerful feminine curves, long hair, large wings, sword raised).
  // Keep slender-but-with-form (not stick-thin): a bit more torso/leg width than extreme for pulpy presence + cinched corset gives waist/hip suggestion.
  if (isMortacia) {
    p.torsoW = Math.max(3, Math.floor(p.torsoW * 0.70)); // thinner per latest ref (legs more under, slender tall goddess)
    p.legW = Math.max(2, Math.floor(p.legW * 0.75));
    p.headW = Math.max(3, Math.floor(p.headW * 0.8) + 1); // reduce head by 20% per ref, then +1 wider for face visibility
    p.headH = Math.max(3, Math.floor(p.headH * 0.8) + 1); // +1 longer
    p.armH = Math.floor(p.armH * 0.92);
    p.torsoH = Math.max(4, Math.floor(p.torsoH * 0.95));
    p.legH = Math.min(13, p.legH + 2); // tall goddess: longer legs
  }

  // One more pixel for "still slender but with some form" on legs (thighs/ankles/feet have room for definition
  // without looking fat; helps the single grey leg column read as a proper humanoid limb at 25px scale).
  // For pulpy goddess Mortacia the base is already a touch wider so this gives presence + the ref curves.
  p.legW = Math.max(2, Math.min(4, p.legW + (isMortacia ? 1 : 0)));

  // Attachment points (the "mapping" from old school sprite assembly) - now modulated by LLM design
  let headX = 2;
  let headY = 1;
  let torsoX = 3;
  let torsoY = headY + p.headH - 1;
  let legX = torsoX + 1;  // will be overridden for proper centering under head
  // Move legs up (smaller added offset) so they tuck/connect under torso bottom.
  // With legs drawn before torso, this + overpaint by torso bottom makes upper+lower body connected
  // (no gap, as in user's "moved the legs" edit that produced highly discernible figure).
  let legY = torsoY + p.torsoH - 2;
  let armBaseX = torsoX + p.torsoW - 1;
  // Slight base adjust + move hand position (handEndY) to match "moved the hands" in the good edit.
  let armBaseY = torsoY + 1 + effectiveArmSwing;
  let weaponX = armBaseX + 2;
  let handEndY = armBaseY + p.armH;  // moved hand down 1 relative to arm end for better grip/attach
  let wY = handEndY - weaponLen;  // top of weapon so it extends down to hand at bottom; weapon facing up, hand at bottom of weapon
  let capeX = 1;
  let capeY = torsoY;

  // Center head horizontally on the torso (user request: head centered)
  headX = torsoX + Math.floor( (p.torsoW - p.headW) / 2 );

  // Compute true centerX based on head (user: legs centered where head is centered)
  const centerX = headX + Math.floor(p.headW / 2);

  // Place legs centered under the head/torso center
  legX = centerX - Math.floor(p.legW / 2);

  // Arm on the "forward" side (right of center for profile)
  armBaseX = centerX + Math.floor(p.torsoW / 2) - 1;

  // Weapon from arm end
  weaponX = armBaseX + 2;

  // Cape on back side (left of center)
  capeX = centerX - Math.floor(p.torsoW / 2) - 2;

  // Center the figure horizontally for better use of canvas (overall)
  const figureApproxCenter = centerX;
  const desiredCenter = 12;
  const xShift = Math.round(desiredCenter - figureApproxCenter);
  headX += xShift;
  torsoX += xShift;
  legX += xShift;
  armBaseX += xShift;
  weaponX += xShift;
  capeX += xShift;

  // Final ensure legs centered under (shifted) head (user request: legs where head is centered)
  const finalCenterX = headX + Math.floor(p.headW / 2);
  legX = finalCenterX - Math.floor(p.legW / 2);

  // Vertical centering: shrink body a bit, lengthen legs effect by positioning, center head and feet (user request)
  const totalH = p.headH + p.torsoH + p.legH;
  const idealTop = Math.max(1, Math.floor((24 - totalH) / 2));
  const yShift = idealTop - headY;
  headY += yShift;
  torsoY += yShift;
  legY += yShift;
  armBaseY += yShift;
  handEndY += yShift;
  wY += yShift;
  capeY += yShift;

  // Apply pose lean/tilt (for disassembled fix and variety)
  armBaseY += bodyLean;
  headY += headTilt;
  legY += Math.floor(bodyLean / 2);

  // Apply the extraLegOffset (computed for attack/kneel etc poses but was previously ignored).
  // Helps shift legs for those poses while keeping the connection.
  legY += extraLegOffset;
  armBaseY += Math.floor(extraLegOffset / 2);

  // Re-derive handEndY / wY from the *final* armBaseY (after yShift + all pose leans + extraLegOffset).
  // This ensures the hand (and weapon emerging from it) move together with the arm swing/lean.
  // Previously hand/weapon Y could drift, contributing to disconnected "floating hand" look.
  // Matches user's "moved the hands" adjustment for connection. Use +armH to match the moved hand draw.
  handEndY = armBaseY + p.armH;
  wY = handEndY - weaponLen;  // top of weapon (extends down to hand); hand at bottom, weapon up

  // === CENTER EVERY HORIZONTAL LINE OF PIXELS (user explicit request) ===
  // Every major mass (head bands, torso bands, leg segments, hems) must have its horizontal row
  // visually plumb under the same vertical center axis as the head. This eliminates drift from
  // attachment math, xShift, pose, stride, and makes the figure immediately recognizable as a
  // stacked humanoid instead of "disassembled".
  // We re-force the nominal X for head/torso/legs (arm/weapon/cape remain profile-asymmetric on purpose).
  const masterCenterX = headX + Math.floor(p.headW / 2);
  headX = masterCenterX - Math.floor(p.headW / 2);
  torsoX = masterCenterX - Math.floor(p.torsoW / 2);
  legX = masterCenterX - Math.floor(p.legW / 2);

  let profileFacing = isMortacia ? -1 : 1; // For Mortacia (tall goddess): face left (eye on left of head) so back is right side of image; wings come out on the right side of the back per user request + images. Suzerain/others face right (classic), wings back left.
  // Wings/cape always on the back side (opposite to facing) so face direction determines wing position.
  // Face (eye) is placed on the facing/front side of head.

  // Re-attach arm (forward on facing side), weapon (from hand), cape/wings (back on opposite side) to the *final* masterCenterX.
  // Wings always behind the face direction: if face/eye on right (facing +1), wings on left; if face on left (facing -1), wings on right.
  armBaseX = masterCenterX + profileFacing * (Math.floor(p.torsoW / 2) - 1);
  if (isMortacia) {
    armBaseX += profileFacing * 3; // move hand and weapon further to the left per ref image #2
  }
  weaponX = armBaseX + profileFacing * 2;
  capeX = masterCenterX - profileFacing * (Math.floor(p.torsoW / 2) + 2);
  if (isMortacia) capeX += 2;

  // Snap core body center (the stacked head/torso/legs column) exactly to canvas center (12,12).
  // This makes the character perfectly centered on its alpha (the drawn parts of the body).
  // We center the *body stack*, not a bbox that includes disproportionate protrusions (long weapon,
  // stride feet, arm, cape) or any background/shadow. This prevents the "head far left, legs far right"
  // placement you saw. Protrusions will extend from the centered body naturally.
  // No background fill anywhere — only the character parts + their edge outlines/highlights.
  // Critical for map: sprites appear centered on their grid positions / in RT without bg or offset.
  const bodyCenterX = legX + Math.floor(p.legW / 2);
  let targetX = 12;
  const xCorr = Math.round(targetX - bodyCenterX);
  headX += xCorr;
  torsoX += xCorr;
  legX += xCorr;
  armBaseX += xCorr;
  weaponX += xCorr;
  capeX += xCorr;

  // Vertical body center (head top to feet bottom) snapped to 12.
  const bodyCenterY = (headY + legY + p.legH) / 2;
  const yCorr = Math.round(12 - bodyCenterY);
  headY += yCorr;
  torsoY += yCorr;
  legY += yCorr;
  armBaseY += yCorr;
  handEndY += yCorr;
  wY += yCorr;
  capeY += yCorr;

  // FINAL AUTHORITATIVE CENTERING FORCE (the "one step forward" after previous centering math).
  // Previous snaps + master + xShift + pose can leave ~1px drift from floor/round/width parity.
  // Recompute actual current core mids (head + leg column), apply one last identical delta
  // to every X (and Y) attachment so the plumb stack is forced exactly to canvas (12,12).
  // This guarantees the core body column (not the stride feet or weapon) is centered on alpha
  // for perfect tile/RT placement. Relatives (head over torso, arm from side, cape back, weapon from hand)
  // are preserved because delta is uniform. Upper legs (now nominal) will land directly under.
  const finalLegMid = legX + Math.floor(p.legW / 2);
  const finalHeadMid = headX + Math.floor(p.headW / 2);
  const coreMid = Math.round((finalLegMid + finalHeadMid) / 2);
  const finalXCorr = Math.round(12 - coreMid);
  headX += finalXCorr;
  torsoX += finalXCorr;
  legX += finalXCorr;
  armBaseX += finalXCorr;
  weaponX += finalXCorr;
  capeX += finalXCorr;

  const finalBodyTop = headY;
  const finalBodyBot = legY + p.legH;
  const finalCoreY = (finalBodyTop + finalBodyBot) / 2;
  const finalYCorr = Math.round(12 - finalCoreY);
  headY += finalYCorr;
  torsoY += finalYCorr;
  legY += finalYCorr;
  armBaseY += finalYCorr;
  handEndY += finalYCorr;
  wY += finalYCorr;
  capeY += finalYCorr;

  // Mortacia latest ref: holding the sword starting at her ribs with hands and the sword upwards on the left.
  // Place hand/grip exactly at rib height (upper torso) so sword blade starts there and extends upward on left.
  // (Combined with profileFacing=-1 + weaponDir this keeps sword left, wings right, no cover.)
  if (isMortacia && starterFamily && starterFamily.exact) {
    // holding the sword starting at her ribs with hands: position the *hand* (grip) at upper-torso rib height (~torsoY+2)
    // so sword blade starts there and goes upwards on the left. (armBase higher up the torso for the raised pose)
    const ribY = torsoY + 2;
    armBaseY = ribY - p.armH;  // hand lands at rib level
    handEndY = armBaseY + p.armH; // == ribY
    wY = handEndY - weaponLen;  // top of upward sword (blade up from hand at bottom)
  }

  // wingDir: direction to fan bones outward from the capeX attach point (away from body core).
  // After all centering, if capeX is left of core use -1 (extend left), if right of core use +1 (extend right).
  // This makes wings "come out of the back" on the far side, putting the structure on the right of image when Mortacia profileFacing=-1.
  const coreMidForWing = headX + Math.floor(p.headW / 2);
  const wingDir = (capeX > coreMidForWing) ? 1 : -1;

  // weaponDir: same profileFacing so that for Mortacia (facing left, weapon attach on left) the blade extends further left (away from center).
  // This guarantees the weapon (especially long scythe or sword blade) stays on its side and never paints over the wings on the opposite (right) side.
  const weaponDir = profileFacing;

  // Re-tuck legs under torso after all pose leans, offsets, and snaps. This guarantees
  // automatic connection / no gap or floating legs: the top of the (single) leg column
  // always overlaps the torso bottom so the robe/armor hem overpaints it.
  // Mortacia: legs more underneath her (tighter tuck for the thinner tall ref look, skin thighs visible under short hem).
  let desiredLegY = torsoY + p.torsoH - 2;
  if (isMortacia && (torsoType.includes('corset') || torsoType.includes('robe') || torsoType.includes('flowing') || torsoType.includes('dress'))) {
    desiredLegY = torsoY + p.torsoH - 5; // stronger tuck: legs more underneath per latest ref
  }
  if (isMortacia) {
    legY = desiredLegY; // force legs higher under body for Mortacia
  } else if (legY > desiredLegY && (legY - desiredLegY) <= 3) {
    legY = desiredLegY;
  }

  const isRobeLike = torsoType.includes('robe') || torsoType.includes('dress') || torsoType.includes('flowing') || torsoType.includes('tunic');

  if (isMortacia) {
    // EXACT replication of the reference image [Image #2].
    // Bypasses general prefabs/poses/attachments for pixel-perfect match to the provided ref.
    // The drawMortaciaExact was meticulously built from pixel analysis of the image (exact rect positions, widths, heights, stacking, and attachments for head/arm/sword/wing/legs/torso to reproduce the silhouette, skin exposure, light sword, dark grey costume, stepped right wing, etc.).
    // baseX/baseY = 10,2 chosen so the core body column + protrusions center correctly on the 24-grid (matches how the ref figure sits when centered).
    drawMortaciaExact(ctx, 8, 2, u, seed, palette, resolveStarterVariant(seed, spriteSpec, 3)); // adjusted base for better center match; curated variants keep the same ref language while giving rerolls actual pose/look variation
  } else if (isSuzerain && starterFamily && starterFamily.exact) {
    // EXACT replication of the reference image for Suzerain ("[Image #1] no like this" + prior refs).
    // Draws pixel-for-pixel match using the same 24-grid: distinctive light helm + dark cross/visor emblem, skin hands at each side (left gripping upright sword at ~rib, right empty at side), red cape prominent flowing on back/right with stepped lower, dark upright sword vertical left from above head to hand, dark armor torso + light lower plate/belt, light greaves + dark bands + dark feet.
    // Bypasses general prefabs/poses/design for locked identical layout every time. ONLY colors vary (seed % 4) for "similar result every time with color variations".
    // baseX/baseY + internal rects meticulously adjusted to center core plumb + match latest ref grid exactly.
    drawSuzerainExact(ctx, 10, 2, u, seed, palette, resolveStarterVariant(seed, spriteSpec, 3)); // curated knight variants preserve the icon while making rerolls meaningfully distinct.
  } else {
    // Compose in classic back-to-front order using the prefab components.
    // Pass design params so LLM "drawing" controls (sizes, densities, blade, folds, flow) actually affect pixels.
    // NOTE: legs drawn BEFORE torso so that the bottom of the torso (and robe flare/hem) paints over
    // the top of the upper legs. This connects the upper body to the lower body visually with no gap
    // or floating leg look -- the torso "caps" the legs and legs only protrude from under the hem
    // for stride (exactly as user showed in the connected edit by moving legs up into body).
    // Accessory drawing - general prefab, supports variety from catalog (flowing_cape, skeletal_wings, none etc.)
    if (accType && accType !== 'none') {
      if (accType === 'skeletal_wings' || accType === 'bone_wings') {
        drawSkeletalWings(ctx, capeX, capeY, u, palette, p.torsoH, p.wingBoneCount || 4, p.wingLength || 1, wingDir);
      } else {
        drawAccessoryCape(ctx, capeX, capeY, u, palette, p.torsoH, accType, capeW, capeFlow);
      }
    }
    drawStridingLegs(ctx, legX, legY, u, palette, p, effectiveStride, isFemale, legsType, isMortacia);
    drawTorso(ctx, torsoType, torsoX, torsoY, u, palette, p, isRobeLike, isFemale, c, robeFlare, foldDens, profileFacing);
    drawHead(ctx, headType, headX, headY, u, palette, p, isFemale, race, c, crestH, crestSpikes, profileFacing);

    // Automatic connection seal at torso/leg join (hem over the single leg column).
    // Reinforces "parts connect" so no visible gap even at 25px or after minor rounding.
    // For Mortacia use higher hem (shorter drawTorso) so skin thighs show per ref.
    let sealY = torsoY + p.torsoH - 2;
    if (isMortacia && (torsoType.includes('corset') || torsoType.includes('robe') || torsoType.includes('flowing') || torsoType.includes('dress'))) {
      sealY = torsoY + p.torsoH - 5; // higher hem to match stronger leg tuck + visible skin thighs
    }
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((torsoX - 1) * u, sealY * u, (p.torsoW + 2) * u, u);

    drawSwingArm(ctx, armBaseX, armBaseY, u, palette, p, effectiveArmSwing, isFemale, armThick);
    drawWeapon(ctx, weaponX * u, wY * u, u, palette, weaponLen, weaponType, bladeSz, weaponDir);

    // Final crisp outlines + top highlights for definition at tiny scales
    ctx.fillStyle = palette.shadow;
    ctx.fillRect((headX - 1) * u, headY * u, u, p.headH * u);
    ctx.fillRect((headX + p.headW) * u, headY * u, u, p.headH * u);
    ctx.fillRect((torsoX - 1) * u, torsoY * u, u, p.torsoH * u);
    ctx.fillRect((torsoX + p.torsoW) * u, torsoY * u, u, p.torsoH * u);
    // Start leg outline a couple rows down so it doesn't draw through the torso/hem connection area
    // (torso bottom now covers upper leg; we don't want stray outline pixels inside the robe body).
    ctx.fillRect((legX - 1) * u, (legY + 2) * u, u, (p.legH - 2) * u);

    ctx.fillStyle = palette.highlight;
    ctx.fillRect((headX + 1) * u, headY * u, (p.headW - 2) * u, u);
    ctx.fillRect((torsoX + 2) * u, torsoY * u, (p.torsoW - 3) * u, u);
  }

  // class/race specific flourish (eyes, bone accents) already handled inside head/torso fns

  return canvas;
}

function generateCharacterSprite(character, spriteSpec = null) {
  const canvas = createCharacterSpriteCanvas(character, spriteSpec);
  // In browser or with real canvas, produce data URL for review menus, <img>, legacy paths, and server-side node usage.
  if (canvas && typeof canvas.toDataURL === 'function') {
    return canvas.toDataURL('image/png');
  }
  // Fallback for odd environments: return a tiny transparent placeholder (should never happen in practice)
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
}


function createCharacterSpriteSpec(character) {
  // Support both capital (from original createMortacia etc) and lowercase
  const name = character.name || character.Name || '';
  const sex = character.sex || character.Sex || 'male';
  const race = character.race || character.Race || 'human';
  const charClass = character.class || character.Class || 'fighter';

  const seed = character._rerollSeed || 0;
  const seedMod = Math.floor(seed * 1000) % 7;
  const seedMod2 = Math.floor(seed * 1000) % 5;

  const basePrimary = charClass.toLowerCase().includes('necromancer') ? '#3a2a5a' : '#4a3c2f';
  const variantAccent = (seedMod % 3 === 0) ? '#aa4422' : (charClass.toLowerCase().includes('necromancer') ? '#660000' : '#ffaa44');

  const isFemale = (sex || '').toLowerCase() === 'female';
  const c = charClass.toLowerCase();
  const isMortacia = name.toLowerCase().includes('mortacia');
  const isSuzerain = name.toLowerCase().includes('suzerain');
  const starterVariant = (isMortacia || isSuzerain) ? resolveStarterVariant(seed, null, 6) : 0;
  const starterFamily = isMortacia ? getMortaciaStarterFamily(starterVariant) : (isSuzerain ? getSuzerainStarterFamily(starterVariant) : null);

  // === NEW PREFAB CATALOG CHOICES (LLM and deterministic use exact same discrete strings) ===
  // These map 1:1 to draw* prefabs. Side-profile, small head+feature, Epyx stride, bottom-heavy silhouette.
  let head = (c.includes('necromancer') || c.includes('goddess')) ? 'skull_crest' : (c.includes('knight') ? (seedMod % 2 === 0 ? 'plumed_helmet' : 'gallant_helm') : (isFemale ? 'human_hair' : 'normal_human'));
  if (seedMod === 1 || seedMod === 4) head = (isFemale || c.includes('goddess')) ? 'skull_crest' : 'normal_human';
  if (seedMod2 === 2 && c.includes('knight')) head = (seedMod % 2 ? 'plumed_helmet' : 'gallant_helm');
  if (c.includes('elf')) head = 'elf_ears';
  // more variety in head types
  const headOptions = ['skull_crest', 'plumed_helmet', 'gallant_helm', 'hooded_skull', 'crowned', 'elf_ears', 'human_hair', 'normal_human', 'wide_helm', 'pointed_cowl', 'beaked_mask'];
  if (seedMod % 5 === 0) head = headOptions[seedMod % headOptions.length];
  // Force iconic prefabs for starters (Mortacia: tall goddess grey dragon wings right back + longer hair + slender; Suzerain: gallant knight with helm/cape/sword/armor per ref image). 
  // Previous Suzerain shapes (plumed_helmet + plate_armor + armored_greaves + flowing_cape) now saved as reusable templates for knight monsters/NPCs in catalog (see monster variety).
  if (isMortacia) {
    head = 'human_hair';  // bigger head, feminine hair, simple cap line (single line detail) per latest ref image
  }
  if (isSuzerain) {
    head = starterFamily.parts.head;
  }

  let torso = 'flowing_robe';
  if (c.includes('knight')) torso = (seedMod % 3 === 0 ? 'gallant_plate' : 'plate_armor');
  else if (c.includes('fighter') && !c.includes('necromancer') && !c.includes('goddess')) torso = (seedMod % 2 === 0 ? 'plate_armor' : 'gallant_plate');
  if (seedMod === 2) torso = 'flowing_robe';
  // more variety in body types
  const torsoOptions = ['flowing_robe', 'tapered_robe', 'broad_tunic', 'cinched_corset', 'plate_armor', 'leather_tunic', 'bone_corset', 'dress_robe', 'chain_shirt', 'gallant_plate'];
  if (seedMod % 4 === 0) torso = torsoOptions[seedMod % torsoOptions.length];

  let legs = 'striding_boots';
  if (c.includes('dwarf')) legs = 'armored_greaves';
  else if (c.includes('knight') || c.includes('fighter')) legs = (seedMod2 % 2 === 0 ? 'stout_greaves' : 'armored_greaves');
  else if ((c.includes('necromancer') || c.includes('goddess')) && seedMod2 % 2 === 0) legs = 'flowing_skirt';
  // more variety (legs catalog drives visual differences: single upper for assembly + dynamic lower stride separation when high stride for Epyx motion/variety + plates/flow/boot styles)
  // armored_greaves + knight_greaves include saved Suzerain knight shapes now available as monster templates
  const legsOptions = ['striding_boots', 'long_striders', 'stout_greaves', 'flowing_skirt', 'armored_greaves', 'bowed_legs', 'wide_pants', 'clawed_hooves', 'knight_greaves'];
  if (seedMod2 % 2 === 0) legs = legsOptions[seedMod2 % legsOptions.length];

  let weapon = c.includes('necromancer') ? 'sword_broad' : (c.includes('knight') ? 'sword_broad' : 'staff_crook');
  if (seedMod2 === 3) weapon = c.includes('necromancer') ? 'staff_crook' : 'sword_broad';
  // Force variety on rerolls so weapon is never "always the same" (user: this throws off generation)
  const weaponOptions = ['scythe_long', 'sword_broad', 'staff_crook', 'dagger', 'axe', 'mace', 'spear', 'wand'];
  if (seedMod2 % 2 === 1 || seedMod % 3 === 0) {
    weapon = weaponOptions[(seedMod + seedMod2) % weaponOptions.length];
  }

  let accessory = (c.includes('goddess') || c.includes('necromancer')) ? 'flowing_cape' : 'none';
  if (seedMod === 3 && c.includes('knight')) accessory = 'flowing_cape';
  // Force iconic for Mortacia (always grey dragon wings on right back, slender tall, long hair implied via head/hair draws) and Suzerain (cool plumed helmet + sword)
  if (isMortacia) {
    head = starterFamily.parts.head;
    torso = starterFamily.parts.torso;
    legs = starterFamily.parts.legs;
    weapon = starterFamily.parts.weapon;
    accessory = starterFamily.parts.accessory;
  }
  if (isSuzerain) {
    // fresh gallant knight per ref image (helm, cape, sword, armor) - old shapes now monster templates
    head = starterFamily.parts.head;
    torso = starterFamily.parts.torso;
    legs = starterFamily.parts.legs;
    weapon = starterFamily.parts.weapon;
    accessory = starterFamily.parts.accessory;
  }
  // ensure gallant suzerain cape is flowing
  if (name.toLowerCase().includes('suzerain') && accessory === 'flowing_cape') {
    // will use high in design below
  }

  // Pose offsets for Epyx counter-pose (arm vs legs). Seed gives reroll variety.
  let legSpread = isFemale ? 1 : 0;
  let armSwing = c.includes('knight') ? (seedMod % 3 - 1) : (seedMod % 2 ? 0 : -1);
  if (isMortacia) armSwing = -3; // bias for rib-level hand hold (higher arm, hand at ribs for upward sword)
  let weaponH = (weapon.includes('scythe') ? 11 : 9);
  if (c.includes('knight')) weaponH = 8;
  if (c.includes('necromancer') || c.includes('goddess')) weaponH = 9;  // sword for Mortacia is shorter than old scythe
  if (isMortacia) weaponH = 8; // sword mostly, raised pose
  if (starterFamily && starterFamily.design) {
    if (Number.isFinite(starterFamily.design.arm_swing)) armSwing = starterFamily.design.arm_swing;
    if (Number.isFinite(starterFamily.design.weapon_length)) weaponH = starterFamily.design.weapon_length;
    if (Number.isFinite(starterFamily.design.stride_amount)) legSpread = starterFamily.design.stride_amount;
  }

  // Dozens of poses, sex affects choice and design (female thinner/more beautiful)
  const malePoses = ['idle_stand_male', 'striding_walk_male', 'run_dash_male', 'attack_thrust_male', 'attack_overhead_male', 'kneel_ready_male', 'bow_shot_male'];
  const femalePoses = ['idle_stand_female', 'striding_elegant_female', 'run_graceful_female', 'cast_spell_female', 'attack_slash_female', 'kneel_graceful_female', 'dance_pose_female'];
  let chosenPose = isFemale ? femalePoses[seedMod % femalePoses.length] : malePoses[seedMod % malePoses.length];
  if (c.includes('necromancer') || c.includes('goddess')) chosenPose = isFemale ? 'cast_spell_female' : 'attack_overhead_male';
  // Iconic poses for starters
  if (starterFamily && starterFamily.pose) chosenPose = starterFamily.pose;

  // legacy numeric proportions (kept for any client code that reads .proportions; new code prefers .pose)
  // Adjusted per user feedback: smaller body, longer legs, for better humanoid proportions
  let pHeadH = (head.includes('skull') || head.includes('crest')) ? 3 : (head.includes('helmet') || head.includes('gallant') ? 3 : 3);
  let pHeadW = (head.includes('skull') || head.includes('helmet') || head.includes('gallant')) ? 4 : 4;
  let pTorsoH = (torso.includes('robe') || torso.includes('flowing')) ? 5 : 4; // shrunk
  let pTorsoW = (torso.includes('armor') || torso.includes('plate') || torso.includes('gallant')) ? 5 : 5;
  let pLegH = 11; // longer
  let pLegW = isFemale ? 3 : 2;
  let pArmH = 4;
  if (c.includes('dwarf')) { pLegH = 7; pTorsoW = 6; }
  if (c.includes('elf')) { pLegH = 12; pTorsoW = 4; pHeadW = 3; }
  if (isMortacia) {
    pLegH = 13; pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.70)); pLegW = Math.max(2, Math.floor(pLegW * 0.75)); pHeadW = Math.max(3, Math.floor(pHeadW * 0.8) + 1); pHeadH = Math.max(3, Math.floor(pHeadH * 0.8) + 1); // reduce 20% +1 for face wider/longer, thinner latest
  }
  if (isSuzerain) {
    pTorsoW = Math.max(4, pTorsoW + 1); // gallant sturdy
  }
  let pLegSpread = Math.min(2, legSpread + (seedMod % 2));
  let pArmOffsetY = Math.max(-1, Math.min(1, armSwing + (seedMod % 3 - 1)));

  // Female: thinner and more beautiful (changes prefabs/drawing scales)
  if (isFemale) {
    pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.82));
    pLegW = Math.max(2, Math.floor(pLegW * 0.88));
    pHeadW = Math.max(3, Math.floor(pHeadW * 0.9));
  }
  // Mortacia tall slender goddess bias in deterministic design too (pulpy form per ref)
  if (isMortacia) {
    pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.70)); // thinner per latest ref
    pLegW = Math.max(2, Math.floor(pLegW * 0.75));
    pHeadW = Math.max(3, Math.floor(pHeadW * 0.8) + 1);
    pHeadH = Math.max(3, Math.floor(pHeadH * 0.8) + 1); // reduce 20% +1 pixel wider/longer for face
    pLegH = Math.min(13, pLegH + 2);
  }
  if (isSuzerain) {
    pTorsoW = Math.max(4, pTorsoW + 1); // gallant sturdy knight build per ref
    pHeadW = Math.max(4, pHeadW );
  }

  if (starterFamily && starterFamily.design) {
    pHeadH = starterFamily.design.head_size || pHeadH;
    pHeadW = starterFamily.design.head_width || pHeadW;
    pTorsoH = starterFamily.design.torso_height || pTorsoH;
    pTorsoW = starterFamily.design.torso_width || pTorsoW;
    pLegH = starterFamily.design.leg_height || pLegH;
    pLegW = starterFamily.design.leg_thickness || pLegW;
    pArmH = starterFamily.design.arm_length || pArmH;
  }

  // For Mortacia exact ref: compute color variant in spec too so saved sprite carries the variation
  let mortPrimary = '#2a2a2a';
  let mortSecondary = '#5a5a5a';
  let mortHighlight = '#c8b48a';
  let mortSkin = '#e8d0b0';
  let mortShadow = '#1a1a1a';
  let mortAccent = '#707070';
  if (name.toLowerCase().includes('mortacia')) {
    const vv = Math.floor(seed * 1000) % 5;
    mortPrimary = ['#1f1f1f', '#222222', '#252525', '#1c1c1c', '#282828'][vv];
    mortSecondary = ['#4a4a4a', '#555555', '#5a5a5a', '#454545', '#606060'][vv];
    mortHighlight = ['#d4c090', '#c8b48a', '#d0b880', '#b8a070', '#c0b080'][vv];
    mortSkin = ['#e8d0b0', '#f0d8b8', '#e0c8a0', '#f5d5b5', '#d8c0a0'][vv];
    mortShadow = ['#1a1a1a', '#1f1f1f', '#181818', '#202020', '#151515'][vv];
    mortAccent = ['#707070', '#666666', '#777777', '#5a5a5a', '#808080'][vv];
  }

  return {
    palette: {
      primary: (isMortacia ? mortPrimary : basePrimary),
      secondary: isMortacia ? mortSecondary : (isFemale ? '#8b5a2b' : '#5c4033'),
      highlight: isMortacia ? mortHighlight : (race === 'elf' ? '#aaffcc' : (c.includes('knight') ? '#ffdd66' : '#aa3333')),
      skin: isMortacia ? mortSkin : (race === 'dwarf' ? '#d2b48c' : (race === 'elf' ? '#e8d5b7' : '#e8c39e')),
      accent: isMortacia ? mortAccent : variantAccent,
      shadow: isMortacia ? mortShadow : '#22110a'
    },
    parts: {
      head: head,
      torso: torso,
      legs: legs,
      arm: 'swinging_upper_lower',
      weapon: weapon,
      accessory: accessory
    },
    pose: chosenPose,
    // Rich design for LLM-style creative control (also used by fallback). Vary with seed for reroll difference.
    design: {
      head_size: pHeadH,
      head_width: pHeadW,
      crest_height: starterFamily?.design?.crest_height ?? ((head.includes('crest') || head.includes('skull') ? 2 : 1) + (seedMod % 2) + (isSuzerain ? 1 : 0)),
      crest_spikes: starterFamily?.design?.crest_spikes ?? (head.includes('crest') || head.includes('skull') ? 3 : 2),
      torso_width: pTorsoW,
      torso_height: pTorsoH,
      robe_flare: starterFamily?.design?.robe_flare ?? ((torso.includes('robe') || torso.includes('flowing') ? 2 : 1) + (seedMod % 2)),
      fold_density: starterFamily?.design?.fold_density ?? ((torso.includes('robe') || torso.includes('flowing') ? 3 : 2) + (seedMod % 3 > 1 ? 1 : 0)),
      leg_thickness: pLegW,
      leg_height: pLegH,
      stride_amount: legSpread,
      arm_thickness: 3,
      arm_length: pArmH,
      arm_swing: armSwing,
      weapon_length: weaponH,
      blade_size: starterFamily?.design?.blade_size ?? ((weapon.includes('scythe') ? 4 : 3) + (seedMod % 2)),
      starter_variant: starterVariant,
      cape_width: starterFamily?.design?.cape_width ?? (accessory === 'flowing_cape' ? 3 : 2),
      cape_flow: starterFamily?.design?.cape_flow ?? ((isSuzerain && accessory === 'flowing_cape' ? 3 : (accessory === 'flowing_cape' ? 2 : 1)) + (seedMod % 2)),
      wing_bone_count: starterFamily?.design?.wing_bone_count ?? ((accessory === 'skeletal_wings' ? 4 : 0) + (seedMod % 2)),
      wing_length: starterFamily?.design?.wing_length ?? ((accessory === 'skeletal_wings' ? 2 : 0) + (seedMod % 2)),
      pose: chosenPose
    },
    // kept for backward compat with any old paths that still read proportions
    proportions: {
      headH: pHeadH, headW: pHeadW,
      torsoH: pTorsoH, torsoW: pTorsoW,
      legH: pLegH, legW: pLegW,
      armH: pArmH, weaponH: weaponH,
      armOffsetY: armSwing, legSpread: legSpread
    },
    notes: `${name || 'Adventurer'} - ${race} ${sex} ${charClass}. Prefab catalog with LLM-style design params (Epyx stride + component assembly, 24-base). (variant ${seedMod})`
  };
}

/**
 * Phaser-friendly multi-frame sprite sheet generator.
 * Our "sprite editor" is the prefab catalog + pose params (LLM or deterministic picks the "parts" like choosing limbs/armor/weapon in a classic pixel art tool).
 * This produces a horizontal spritesheet canvas (one row of frames) by varying the Epyx stride/pose slightly per frame.
 * You can then feed it to Phaser via scene.textures.addCanvas(...) + manually add frames, or use as source for animations.
 * Perfect for animated tokens, walk cycles, attack poses etc. without external editors.
 *
 * Returns the sheet canvas (width = frameW * frameCount, height = frameH).
 * Also useful for review previews (draw frames in a <canvas> and cycle with requestAnimationFrame).
 */
function createCharacterSpriteSheetCanvas(character, spriteSpec = null, frameCount = 4) {
  const traitSpec = getProceduralSpec(character, spriteSpec);
  if (traitSpec) return createTraitSpriteSheetCanvas(traitSpec, frameCount);
  const frameCanvas = createCharacterSpriteCanvas(character, spriteSpec); // one frame to get size
  const frameW = frameCanvas.width;
  const frameH = frameCanvas.height;

  const sheet = createCanvas(frameW * frameCount, frameH);
  const sheetCtx = sheet.getContext('2d');

  const baseSpec = spriteSpec || createCharacterSpriteSpec(character);
  const name = (character && (character.name || character.Name || '')).toLowerCase();
  if (name.includes('suzerain')) {
    for (let f = 0; f < frameCount; f++) {
      const frameChar = Object.assign({}, character, {
        _rerollSeed: (character._rerollSeed || 0) + ((f + 1) * 0.137)
      });
      const oneFrame = createCharacterSpriteCanvas(frameChar, baseSpec);
      sheetCtx.drawImage(oneFrame, f * frameW, 0);
    }
    return sheet;
  }
  const basePose = baseSpec.pose || baseSpec.proportions || {};
  const baseDesign = baseSpec.design || {};

  for (let f = 0; f < frameCount; f++) {
    const t = frameCount > 1 ? f / (frameCount - 1) : 0;

    // Create a pose + design variant for this "frame" - simulates walk/stride + subtle creative variation
    // LLM-style design params (sizes, densities) are slightly modulated per frame for lively preview.
    const framePose = {
      legSpread: (basePose.legSpread || 1) + Math.sin(t * Math.PI * 2) * 0.8,
      armSwing: (basePose.armSwing || basePose.armOffsetY || 0) + Math.cos(t * Math.PI * 2) * 1.2,
      weaponH: basePose.weaponH || 10
    };
    const frameDesign = {
      ...baseDesign,
      stride_amount: (baseDesign.stride_amount || 1) + Math.sin(t * Math.PI * 2) * 0.6,
      arm_swing: (baseDesign.arm_swing || 0) + Math.cos(t * Math.PI * 2) * 0.8,
      blade_size: (baseDesign.blade_size || 4) + (Math.sin(t * 3) > 0 ? 1 : 0)
    };

    const framePoseStr = baseSpec.pose || 'striding';

    // Slight seed shift per frame for micro-variation (reroll within same character)
    const frameChar = Object.assign({}, character, {
      _rerollSeed: (character._rerollSeed || 0) + (f * 0.37)
    });

    const oneFrame = createCharacterSpriteCanvas(frameChar, {
      ...baseSpec,
      pose: framePoseStr,
      design: { ...frameDesign, pose: framePoseStr },
      proportions: { ...baseSpec.proportions, ...framePose }
    });

    sheetCtx.drawImage(oneFrame, f * frameW, 0);
  }

  return sheet;
}

function extractCharacterFrameCanvases(character, spriteSpec = null, frameCount = 4) {
  const sheet = createCharacterSpriteSheetCanvas(character, spriteSpec, frameCount);
  const frameW = Math.max(1, Math.floor(sheet.height || BASE_SIZE * UPSCALE));
  const frameH = Math.max(1, Math.floor(sheet.height || BASE_SIZE * UPSCALE));
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const frame = createCanvas(frameW, frameH);
    const ctx = frame.getContext('2d');
    if (ctx && typeof ctx.drawImage === 'function') {
      ctx.drawImage(sheet, i * frameW, 0, frameW, frameH, 0, 0, frameW, frameH);
    }
    frames.push(frame);
  }
  return frames;
}

function clampVoxelNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function hexToVoxelColor(value, fallback) {
  const paletteHex = String(value || fallback || '#777777');
  const m = paletteHex.match(/^#?([0-9a-fA-F]{6})$/);
  const v = m ? parseInt(m[1], 16) : 0x777777;
  return [
    ((v >> 16) & 255) / 255,
    ((v >> 8) & 255) / 255,
    (v & 255) / 255
  ];
}

function mixVoxelColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

/**
 * Map a procedural trait spec (LLM / preset) into the semantic voxel parts+design+palette
 * used by createSemanticCharacterVoxelFrame. Never extrudes canvas pixels.
 */
function proceduralTraitsToVoxelSpec(character, proceduralSpec) {
  const t = (proceduralSpec && proceduralSpec.traits) || {};
  const pal = t.palette || {};
  const outfit = t.outfit || {};
  const name = String((character && (character.name || character.Name)) || proceduralSpec.name || '').toLowerCase();
  const preset = String(proceduralSpec.preset || '').toLowerCase();
  const isMortacia = preset === 'mortacia' || name.includes('mortacia');
  const isSuzerain = preset === 'suzerain' || name.includes('suzerain');
  const female = String((character && (character.sex || character.Sex)) || proceduralSpec.sex || '').toLowerCase() === 'female'
    || isMortacia;
  const slender = !!(t.statuesque || t.build === 'slender' || t.naturalLimbs || isMortacia);
  const heavy = !!(t.build === 'heavy' || t.build === 'bulky') && !slender;
  const large = t.size === 'large' || t.size === 'huge' || isMortacia;
  const items = Array.isArray(t.items) ? t.items : [];
  const weaponItem = items.find((it) => it && (it.slot === 'weapon' || /sword|axe|spear|staff|mace|dagger|scythe|bow|wand/i.test(String(it.type || '')))) || items[0];
  const weaponTypeRaw = String((weaponItem && weaponItem.type) || '').toLowerCase();

  let head = 'human_hair';
  if (outfit.helm && outfit.helm !== 'none') {
    head = (outfit.helm === 'closed' || outfit.helm === 'full') ? 'gallant_helm' : 'plumed_helmet';
  } else if (outfit.hood) {
    head = 'pointed_cowl';
  } else if (t.head === 'skull' || t.bodyPlan === 'skeletal') {
    head = 'skull_crest';
  } else if (female || t.hair === 'long') {
    head = 'human_hair';
  }

  let torso = 'broad_tunic';
  const style = String(outfit.style || 'none').toLowerCase();
  if (style === 'plate' || style === 'mail') torso = 'gallant_plate';
  else if (style === 'robe' || style === 'cloak') torso = 'flowing_robe';
  else if (style === 'leather') torso = 'leather_tunic';
  else if (style === 'gi' || style === 'tabard') torso = 'broad_tunic';
  else if (isMortacia || t.garment) torso = 'cinched_corset';

  let legs = 'striding_boots';
  if (style === 'plate' || style === 'mail') legs = 'armored_greaves';
  else if (style === 'robe') legs = 'flowing_skirt';
  else if (isMortacia) legs = 'long_striders';

  let weapon = 'sword_broad';
  if (/spear|staff|wand|bow/.test(weaponTypeRaw)) weapon = weaponTypeRaw.includes('bow') ? 'bow' : (weaponTypeRaw.includes('wand') ? 'wand' : 'spear');
  else if (/dagger/.test(weaponTypeRaw)) weapon = 'dagger';
  else if (/axe/.test(weaponTypeRaw)) weapon = 'axe';
  else if (/mace/.test(weaponTypeRaw)) weapon = 'mace';
  else if (/scythe/.test(weaponTypeRaw)) weapon = 'scythe';
  else if (/sword|blade/.test(weaponTypeRaw) || !weaponTypeRaw) weapon = 'sword_broad';

  let accessory = 'none';
  const wings = String(t.wings || 'none').toLowerCase();
  if (wings && wings !== 'none') accessory = 'skeletal_wings';
  else if (outfit.cape || t.garment && t.garment.buttCape) accessory = 'flowing_cape';

  // Palette from trait colors (garment/cape/wing overrides applied in frame builder)
  const palette = {
    primary: pal.outfit || '#4a3c2f',
    secondary: pal.outfit2 || pal.metal || '#8b5a2b',
    highlight: pal.trim || pal.metal || '#c8ccd4',
    shadow: '#1a1410',
    skin: pal.skin || '#e8c39e',
    accent: (t.capeColor) || pal.trim || pal.glow || '#aa3333'
  };

  const design = {
    head_size: large ? 3 : 4,
    head_width: slender ? 4 : (heavy ? 6 : 5),
    torso_height: slender ? 5 : 4,
    torso_width: slender ? 4 : (heavy ? 6 : 5),
    leg_height: large || slender ? 12 : 10,
    leg_thickness: slender ? 2 : (heavy ? 3 : 2),
    arm_length: 5,
    arm_swing: (t.weaponPose === 'ready' || isMortacia || isSuzerain) ? -2 : 0,
    stride_amount: (t.weaponPose === 'ready') ? 1 : 1,
    weapon_length: t.longBlade ? 12 : 9,
    blade_size: 2,
    crest_height: head.includes('helm') ? 2 : 1,
    robe_flare: torso.includes('robe') ? 2 : 1,
    wing_length: accessory.includes('wing') ? 3 : 1,
    wing_bone_count: 3,
    cape_flow: accessory.includes('cape') || outfit.cape ? 3 : 1,
    pose: (t.weaponPose === 'ready') ? 'ready_stance' : 'idle_stand'
  };

  if (isMortacia) {
    Object.assign(palette, {
      primary: '#5a5a62',
      secondary: '#4a4a52',
      highlight: '#9a9ca4',
      shadow: '#2a2a30',
      skin: pal.skin || '#e8c4a8',
      accent: '#6a6a72'
    });
    Object.assign(design, {
      head_size: 3, head_width: 4, torso_height: 5, torso_width: 3,
      leg_height: 13, leg_thickness: 2, arm_length: 5, arm_swing: -2,
      stride_amount: 1, weapon_length: 13, blade_size: 2,
      wing_length: 4, wing_bone_count: 3, cape_flow: 2, pose: 'ready_stance'
    });
    head = 'human_hair';
    torso = 'cinched_corset';
    legs = 'long_striders';
    weapon = 'sword_broad';
    accessory = 'skeletal_wings';
  }
  if (isSuzerain) {
    Object.assign(palette, {
      primary: '#4a4e56',
      secondary: '#7a8088',
      highlight: '#b89440',
      shadow: '#1a1c20',
      skin: pal.skin || '#e0c098',
      accent: t.capeColor || '#aa2222'
    });
    Object.assign(design, {
      head_size: 4, head_width: 5, torso_height: 5, torso_width: 4,
      leg_height: 11, leg_thickness: 2, arm_length: 5, arm_swing: -2,
      stride_amount: 1, weapon_length: 12, blade_size: 2,
      crest_height: 2, cape_flow: 3, pose: 'ready_stance'
    });
    head = 'gallant_helm';
    torso = 'gallant_plate';
    legs = 'armored_greaves';
    weapon = 'sword_broad';
    accessory = 'flowing_cape';
  }

  return {
    kind: 'semantic-voxel',
    preset: isMortacia ? 'mortacia' : (isSuzerain ? 'suzerain' : null),
    palette,
    parts: { head, torso, legs, arm: 'swinging_upper_lower', weapon, accessory },
    pose: design.pose,
    design,
    traits: t,
    garment: t.garment || null,
    capeColor: t.capeColor || null,
    wingColor: t.wingColor || null,
    bootColor: t.bootColor || null,
    worldScale: proceduralSpec.worldScale
  };
}

function resolveVoxelSpriteSpec(character, spriteSpec = null) {
  const procedural = getProceduralSpec(character, spriteSpec);
  if (procedural && procedural.kind === 'placeholder') return procedural;
  if (procedural && procedural.kind === 'procedural') {
    return proceduralTraitsToVoxelSpec(character, procedural);
  }
  if (spriteSpec && spriteSpec.parts && spriteSpec.palette) {
    return spriteSpec;
  }
  return createCharacterSpriteSpec(character || {});
}

/**
 * Lean athletic body-part voxel assembly (NOT canvas extrusion / woodcut slabs).
 * Torso thicker than limbs; wings = thin membranes + bone ridges; sword = thin tip-up blade.
 * Used for ALL 3D dungeon actors (party companions, NPCs, monsters, presets).
 */
function createSemanticCharacterVoxelFrame(character, spriteSpec = null, options = {}) {
  let spec = spriteSpec;
  if (!spec || (!spec.parts && spec.kind === 'procedural')) {
    spec = resolveVoxelSpriteSpec(character, spriteSpec);
  } else if (!spec.parts) {
    spec = resolveVoxelSpriteSpec(character, spec);
  }
  const palette = normalizePalette(spec.palette || {});
  const parts = spec.parts || {};
  const design = spec.design || {};
  const poseName = String(spec.pose || design.pose || '').toLowerCase();
  const traits = spec.traits || {};
  const garment = spec.garment || traits.garment || null;
  const name = String((character && (character.name || character.Name)) || spec.preset || '').toLowerCase();
  const isMortacia = spec.preset === 'mortacia' || name.includes('mortacia');
  const isSuzerain = spec.preset === 'suzerain' || name.includes('suzerain');
  const size = Math.max(20, Math.min(36, Math.floor(options.voxelSize || 28)));
  const mirror = !!options.mirror;
  const frontDir = mirror ? 1 : -1;
  const backDir = -frontDir;
  const voxels = new Uint8Array(size * size * size);
  const colors = new Float32Array(voxels.length * 3);
  const indexOf = (x, y, z) => x + y * size + z * size * size;

  const setVoxel = (x, y, z, color) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    const zi = Math.round(z);
    if (xi < 0 || yi < 0 || zi < 0 || xi >= size || yi >= size || zi >= size) return;
    const idx = indexOf(xi, yi, zi);
    voxels[idx] = 1;
    colors[idx * 3] = color[0];
    colors[idx * 3 + 1] = color[1];
    colors[idx * 3 + 2] = color[2];
  };

  const fillBox = (x0, x1, y0, y1, z0, z1, color) => {
    const minX = Math.round(Math.min(x0, x1));
    const maxX = Math.round(Math.max(x0, x1));
    const minY = Math.round(Math.min(y0, y1));
    const maxY = Math.round(Math.max(y0, y1));
    const minZ = Math.round(Math.min(z0, z1));
    const maxZ = Math.round(Math.max(z0, z1));
    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          setVoxel(x, y, z, color);
        }
      }
    }
  };

  const drawLine = (x0, y0, z0, x1, y1, z1, thickness, color) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
    const radius = Math.max(0, Math.floor(thickness / 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      const pz = z0 + dz * t;
      fillBox(px - radius, px + radius, py - radius, py + radius, pz - radius, pz + radius, color);
    }
  };

  // Thin membrane fill between two polylines in the XZ plane at fixed Y depth
  const fillMembrane = (pts, y, color) => {
    if (!pts || pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      drawLine(a[0], y, a[1], b[0], y, b[1], 1, color);
    }
  };

  let primary = hexToVoxelColor(palette.primary, '#4a3c2f');
  let secondary = hexToVoxelColor(palette.secondary, '#8b5a2b');
  let highlight = hexToVoxelColor(palette.highlight, '#ffdd66');
  let shadow = hexToVoxelColor(palette.shadow, '#22110a');
  let skin = hexToVoxelColor(palette.skin, '#e8c39e');
  let accent = hexToVoxelColor(palette.accent, '#aa3333');
  if (spec.wingColor) accent = mixVoxelColor(hexToVoxelColor(spec.wingColor, '#6e6e76'), accent, 0.2);
  if (spec.capeColor) accent = hexToVoxelColor(spec.capeColor, palette.accent);
  const armor = mixVoxelColor(secondary, shadow, 0.1);
  const cloth = garment && garment.color ? hexToVoxelColor(garment.color, palette.primary) : mixVoxelColor(primary, accent, 0.08);
  const wingBone = mixVoxelColor(secondary, highlight, 0.12);
  const wingMem = spec.wingColor
    ? hexToVoxelColor(spec.wingColor, '#6e6e76')
    : (isMortacia ? hexToVoxelColor('#6e6e76', '#6e6e76') : mixVoxelColor(secondary, shadow, 0.2));
  const darkMetal = mixVoxelColor(shadow, secondary, 0.28);
  const hairColor = isMortacia
    ? hexToVoxelColor('#f0ebe0', '#f0ebe0')
    : mixVoxelColor(highlight, skin, 0.32);
  const bootCol = spec.bootColor
    ? hexToVoxelColor(spec.bootColor, '#3e3e46')
    : (isMortacia ? hexToVoxelColor('#3e3e46', '#3e3e46') : mixVoxelColor(secondary, shadow, 0.25));

  const headType = String(parts.head || '').toLowerCase();
  const torsoType = String(parts.torso || '').toLowerCase();
  const legsType = String(parts.legs || '').toLowerCase();
  const weaponType = String(parts.weapon || '').toLowerCase();
  const accessoryType = String(parts.accessory || '').toLowerCase();

  const armorLike = torsoType.includes('plate') || torsoType.includes('gallant') || torsoType.includes('chain') || isSuzerain;
  const robeLike = torsoType.includes('robe') || torsoType.includes('dress') || torsoType.includes('flowing') || legsType.includes('flowing');
  const corsetLike = torsoType.includes('corset') || isMortacia || !!(garment && garment.bikini);
  const helmetLike = headType.includes('helm') || headType.includes('helmet') || headType.includes('cowl') || headType.includes('mask');
  const hairLike = headType.includes('hair') || (!helmetLike && !headType.includes('skull'));
  const wingLike = accessoryType.includes('wing') || isMortacia;
  const capeLike = accessoryType.includes('cape') || isSuzerain || !!(garment && garment.buttCape);
  const buttCape = isMortacia || !!(garment && garment.buttCape);
  const readyPose = poseName.includes('ready') || poseName.includes('fight') || isMortacia || isSuzerain;

  const targetHeight = Math.floor(size * 0.88);
  const rawHeadH = clampVoxelNumber(design.head_size, 3, 5, 3);
  const rawHeadW = clampVoxelNumber(design.head_width, 3, 6, helmetLike ? 5 : 4);
  const rawTorsoH = clampVoxelNumber(design.torso_height, 4, 6, corsetLike ? 5 : 4);
  const rawTorsoW = clampVoxelNumber(design.torso_width, 3, 6, armorLike ? 4 : 3);
  const rawLegH = clampVoxelNumber(design.leg_height, 9, 14, 11);
  const rawLegW = clampVoxelNumber(design.leg_thickness, 1, 3, 2);
  const rawArmH = clampVoxelNumber(design.arm_length, 4, 7, 5);
  const rawWeaponLen = clampVoxelNumber(design.weapon_length, 6, 16, 11);
  const rawStride = clampVoxelNumber(design.stride_amount, 0, 3, readyPose ? 1 : 1);
  const rawArmSwing = clampVoxelNumber(design.arm_swing, -4, 4, readyPose ? -2 : 0);
  const rawCrestH = clampVoxelNumber(design.crest_height, 1, 3, helmetLike ? 2 : 1);
  const rawRobeFlare = clampVoxelNumber(design.robe_flare, 1, 3, robeLike ? 2 : 1);
  const rawWingLen = clampVoxelNumber(design.wing_length, 1, 5, wingLike ? 3 : 1);
  const rawWingBones = clampVoxelNumber(design.wing_bone_count, 3, 5, 3);
  const rawCapeFlow = clampVoxelNumber(design.cape_flow, 1, 4, capeLike ? 3 : 1);
  const scale = Math.min(1.2, Math.max(0.8, targetHeight / Math.max(14, rawHeadH + rawTorsoH + rawLegH + rawCrestH + 1)));
  const scaleDim = (value, min, max) => Math.max(min, Math.min(max, Math.round(value * scale)));

  let headH = scaleDim(rawHeadH, 3, 5);
  let headW = scaleDim(rawHeadW, 3, 6);
  let torsoH = scaleDim(rawTorsoH, 4, 6);
  let torsoW = scaleDim(rawTorsoW, 3, 6);
  let legH = scaleDim(rawLegH, 9, 14);
  let legW = scaleDim(rawLegW, 1, 3);
  let armH = scaleDim(rawArmH, 4, 7);
  let weaponLen = scaleDim(rawWeaponLen, 6, 16);
  let crestH = scaleDim(rawCrestH, 1, 3);
  const robeFlare = scaleDim(rawRobeFlare, 1, 3);
  const wingLen = scaleDim(rawWingLen, 1, 5);
  const wingBones = Math.max(3, Math.min(5, Math.round(rawWingBones)));
  const capeFlow = scaleDim(rawCapeFlow, 1, 4);

  if (readyPose) {
    armH = Math.max(4, armH);
  }

  const stride = Math.max(0, Math.min(2, Math.round(rawStride)));
  const armSwing = Math.max(-4, Math.min(4, Math.round(rawArmSwing)));
  // Lean depths: torso thicker than limbs (athletic, not Minecraft sticks / chunky boxes)
  const torsoDepth = Math.max(4, Math.min(6, armorLike ? 5 : 4));
  const limbDepth = 2;
  const headDepth = Math.max(3, Math.min(4, torsoDepth - 1));
  const centerX = Math.floor(size / 2);
  const centerY = Math.floor(size / 2);

  let legZ0 = 1;
  let legZ1 = legZ0 + legH - 1;
  let torsoZ0 = legZ1 - (robeLike ? 1 : 0);
  let torsoZ1 = torsoZ0 + torsoH - 1;
  let headZ0 = torsoZ1;
  let headZ1 = headZ0 + headH - 1;
  const overflow = headZ1 + crestH + 1 - (size - 2);
  if (overflow > 0) {
    legZ0 = Math.max(1, legZ0 - overflow);
    legZ1 = legZ0 + legH - 1;
    torsoZ0 = legZ1 - (robeLike ? 1 : 0);
    torsoZ1 = torsoZ0 + torsoH - 1;
    headZ0 = torsoZ1;
    headZ1 = headZ0 + headH - 1;
  }

  const torsoX0 = centerX - Math.floor(torsoW / 2);
  const torsoX1 = torsoX0 + torsoW - 1;
  const torsoY0 = centerY - Math.floor(torsoDepth / 2);
  const torsoY1 = torsoY0 + torsoDepth - 1;

  // --- TORSO ---
  if (corsetLike && !armorLike) {
    // Hourglass: wider chest, cinched waist, slight hips; bikini/sports-bra coverage
    const chestZ1 = torsoZ1;
    const chestZ0 = torsoZ0 + Math.floor(torsoH * 0.45);
    const waistZ1 = chestZ0;
    const waistZ0 = torsoZ0 + Math.floor(torsoH * 0.15);
    const hipZ1 = waistZ0;
    fillBox(torsoX0, torsoX1, torsoY0, torsoY1, chestZ0, chestZ1, cloth); // top / bra band
    fillBox(centerX - 1, centerX + 1, torsoY0, torsoY1, waistZ0, waistZ1, skin); // bare midriff
    // cups / coverage
    fillBox(torsoX0, centerX - 1, torsoY0, torsoY1, chestZ0 + 1, chestZ1, mixVoxelColor(cloth, shadow, 0.1));
    fillBox(centerX + 1, torsoX1, torsoY0, torsoY1, chestZ0 + 1, chestZ1, mixVoxelColor(cloth, shadow, 0.1));
    fillBox(centerX - 1, centerX + 1, torsoY0 + 1, torsoY1 - 1, chestZ0, chestZ0, mixVoxelColor(cloth, highlight, 0.15)); // V strap
    // high-cut bottoms
    fillBox(torsoX0, torsoX1, torsoY0, torsoY1, hipZ1 - 1, hipZ1 + 1, cloth);
    fillBox(centerX - Math.floor(torsoW / 2), centerX + Math.floor(torsoW / 2), torsoY0, torsoY1, legZ1 - 1, hipZ1, mixVoxelColor(cloth, shadow, 0.08));
  } else if (armorLike) {
    fillBox(torsoX0, torsoX1, torsoY0, torsoY1, torsoZ0, torsoZ1, armor);
    // slim spaulders (not chunky)
    fillBox(torsoX0 - 1, torsoX0, torsoY0, torsoY1, torsoZ1 - 1, torsoZ1, mixVoxelColor(armor, highlight, 0.15));
    fillBox(torsoX1, torsoX1 + 1, torsoY0, torsoY1, torsoZ1 - 1, torsoZ1, mixVoxelColor(armor, highlight, 0.15));
    fillBox(centerX - 1, centerX + 1, centerY - 1, centerY + 1, torsoZ0 + 1, torsoZ0 + 1, highlight);
  } else if (robeLike) {
    fillBox(torsoX0, torsoX1, torsoY0, torsoY1, torsoZ0, torsoZ1, cloth);
    fillBox(torsoX0 - robeFlare, torsoX1 + robeFlare, torsoY0, torsoY1, legZ0 + Math.max(1, Math.floor(legH * 0.25)), torsoZ0 + 1, cloth);
  } else {
    fillBox(torsoX0, torsoX1, torsoY0, torsoY1, torsoZ0, torsoZ1, primary);
  }

  // --- HEAD ---
  const headX0 = centerX - Math.floor(headW / 2);
  const headX1 = headX0 + headW - 1;
  const headY0 = centerY - Math.floor(headDepth / 2);
  const headY1 = headY0 + headDepth - 1;
  fillBox(headX0, headX1, headY0, headY1, headZ0, headZ1, helmetLike ? armor : skin);
  if (helmetLike) {
    // closed helm slit
    fillBox(headX0 + 1, headX1 - 1, centerY - 1, centerY + 1, headZ0 + Math.floor(headH * 0.4), headZ0 + Math.floor(headH * 0.4), shadow);
    fillBox(headX0, headX1, headY0, headY1, headZ1, headZ1, highlight);
    if (crestH > 0) {
      fillBox(centerX, centerX, centerY - 1, centerY + 1, headZ1 + 1, Math.min(size - 2, headZ1 + crestH), mixVoxelColor(accent, highlight, 0.2));
    }
  } else {
    const eyeX = frontDir < 0 ? (headX0 + 1) : (headX1 - 1);
    fillBox(eyeX, eyeX, centerY, centerY, headZ0 + Math.max(1, Math.floor(headH * 0.45)), headZ0 + Math.max(1, Math.floor(headH * 0.45)), shadow);
    if (hairLike) {
      fillBox(headX0 - (frontDir < 0 ? 1 : 0), headX1 + (frontDir > 0 ? 1 : 0), headY0, headY1, headZ0 + Math.max(1, Math.floor(headH * 0.5)), headZ1 + 1, hairColor);
      drawLine(headX0 + backDir, centerY, headZ1 - 1, headX0 + backDir * 2, centerY, Math.max(torsoZ1 - 1, headZ0 - 2), 1, hairColor);
    }
  }

  // --- LEGS (lean; thighs visible for Mortacia) ---
  const footColor = armorLike ? darkMetal : bootCol;
  const legColor = armorLike ? armor : (corsetLike ? skin : secondary);
  const bootH = isMortacia ? Math.max(3, Math.floor(legH * 0.45)) : Math.max(2, Math.floor(legH * 0.3));
  if (legsType.includes('flowing') || (robeLike && !corsetLike)) {
    fillBox(centerX - Math.floor((torsoW + robeFlare) / 2), centerX + Math.floor((torsoW + robeFlare) / 2), centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0, torsoZ0 + 1, cloth);
    fillBox(centerX - 1, centerX + 1, centerY - 1, centerY + 1, legZ0, legZ0 + 1, footColor);
  } else {
    const legGap = stride > 0 ? 1 : 0;
    const legLead = readyPose ? 1 : Math.min(1, stride);
    const frontLegX0 = centerX - legGap - legW;
    const frontLegX1 = frontLegX0 + legW - 1;
    const backLegX0 = centerX + legGap;
    const backLegX1 = backLegX0 + legW - 1;
    const fShift = frontDir < 0 ? -legLead : legLead;
    const bShift = backDir < 0 ? -Math.max(0, stride - 1) : Math.max(0, stride - 1);
    // thighs / legs
    fillBox(frontLegX0 + fShift, frontLegX1 + fShift, centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0 + bootH, legZ1, legColor);
    fillBox(backLegX0 + bShift, backLegX1 + bShift, centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0 + bootH, legZ1 - 1, mixVoxelColor(legColor, shadow, 0.12));
    // tall boots
    fillBox(frontLegX0 + fShift - (armorLike ? 0 : 0), frontLegX1 + fShift, centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0, legZ0 + bootH, footColor);
    fillBox(backLegX0 + bShift, backLegX1 + bShift, centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0, legZ0 + bootH, footColor);
    // boot cuff
    fillBox(frontLegX0 + fShift, frontLegX1 + fShift, centerY - Math.floor(limbDepth / 2), centerY + Math.floor(limbDepth / 2), legZ0 + bootH, legZ0 + bootH, mixVoxelColor(footColor, highlight, 0.1));
  }

  // --- ARMS (ready stance: bent elbows, weapon hand forward) ---
  const shoulderX = centerX + frontDir * Math.floor((torsoW + 1) / 2);
  const shoulderZ = torsoZ1 - Math.max(1, Math.floor(torsoH * 0.2));
  const elbowX = shoulderX + frontDir * (readyPose ? 2 : Math.max(1, Math.floor(Math.abs(armSwing) * 0.5)));
  const elbowZ = shoulderZ - (readyPose ? 2 : Math.max(0, armSwing));
  const handX = shoulderX + frontDir * (readyPose ? 3 : Math.max(2, Math.floor(torsoW * 0.5) + Math.max(0, stride)));
  const handZ = readyPose
    ? Math.max(legZ0 + 4, torsoZ0 + Math.floor(torsoH * 0.55))
    : Math.max(legZ0 + 3, torsoZ0 + Math.floor(torsoH * 0.42) - armSwing);
  const armColor = armorLike ? armor : (corsetLike ? skin : secondary);
  drawLine(shoulderX, centerY + 1, shoulderZ, elbowX, centerY + 1, elbowZ, 1, armColor);
  drawLine(elbowX, centerY + 1, elbowZ, handX, centerY + 1, handZ, 1, armColor);
  fillBox(handX - 1, handX, centerY, centerY + 1, handZ - 1, handZ, armorLike ? darkMetal : skin);

  const backShoulderX = centerX + backDir * Math.floor((torsoW + 1) / 2);
  drawLine(backShoulderX, centerY - 1, shoulderZ, backShoulderX + backDir, centerY - 1, shoulderZ - 3, 1, mixVoxelColor(armColor, shadow, 0.2));

  // --- CAPE / BUTT CAPE ---
  if (capeLike || buttCape) {
    const capeCol = isSuzerain
      ? hexToVoxelColor(spec.capeColor || '#aa2222', '#aa2222')
      : (buttCape ? cloth : accent);
    const capeTopX = centerX + backDir * Math.floor((torsoW + 1) / 2);
    const capeHang = buttCape
      ? legZ0 + Math.floor(legH * 0.55)
      : legZ0 + Math.floor(legH * 0.15);
    // thin cape sheet (depth 1-2), not a slab
    const capeY = centerY - Math.floor(torsoDepth / 2) - 1;
    fillBox(Math.min(capeTopX, capeTopX + backDir * (1 + capeFlow)), Math.max(capeTopX, capeTopX + backDir * (1 + capeFlow)), capeY, capeY + 1, torsoZ0 + 1, capeHang, capeCol);
    if (!buttCape) {
      // flowing lower edge
      fillBox(capeTopX + backDir * (1 + capeFlow), capeTopX + backDir * (2 + capeFlow), capeY, capeY, legZ0 + 1, capeHang - 2, mixVoxelColor(capeCol, shadow, 0.15));
    }
  }

  // --- WINGS (Mortacia: triangular pointy tops; hang to ankles then angle UP toward hands; 3 bones from peak) ---
  if (wingLike) {
    const peakX = centerX + backDir * (Math.floor(torsoW / 2) + 1);
    const peakZ = Math.min(size - 2, headZ1 + 1);
    const peakY = centerY - 1;
    const ankleZ = legZ0 + 1;
    const outerX = peakX + backDir * (3 + wingLen);
    const handReachX = handX + backDir;
    const handReachZ = Math.max(handZ, torsoZ0 + 1);
    // membrane: peak -> outer tip -> ankle flare -> up toward hands
    const memPts = [
      [peakX, peakZ],
      [outerX, peakZ - 1],
      [outerX + backDir, Math.floor((peakZ + ankleZ) * 0.55)],
      [outerX - backDir, ankleZ],
      [Math.floor((outerX + handReachX) * 0.5), Math.floor((ankleZ + handReachZ) * 0.45)],
      [handReachX, handReachZ],
      [peakX + backDir, torsoZ1]
    ];
    // fill membrane as thin sheets at peakY and peakY+1
    for (let yi = 0; yi < 2; yi++) {
      fillMembrane(memPts, peakY + yi, mixVoxelColor(wingMem, shadow, yi * 0.08));
      // denser fill: scan between peak and outer for each z
      for (let z = ankleZ; z <= peakZ; z++) {
        const tDown = (peakZ - z) / Math.max(1, peakZ - ankleZ);
        const xOuter = peakX + backDir * Math.round((2 + wingLen) * Math.min(1, tDown * 1.4));
        // after ankle hang, taper inward toward hands
        let xInner = peakX + backDir;
        if (z < torsoZ0) {
          const tUp = (torsoZ0 - z) / Math.max(1, torsoZ0 - ankleZ);
          xInner = peakX + backDir * Math.round(1 + tUp * Math.abs(handReachX - peakX) * 0.35);
        }
        const x0 = Math.min(xInner, xOuter);
        const x1 = Math.max(xInner, xOuter);
        for (let x = x0; x <= x1; x++) {
          setVoxel(x, peakY + yi, z, mixVoxelColor(wingMem, shadow, 0.05 * yi));
        }
      }
    }
    // 3 bones radiating from peak
    for (let i = 0; i < wingBones; i++) {
      const t = i / Math.max(1, wingBones - 1);
      const tipX = peakX + backDir * (2 + Math.round(wingLen * (0.55 + 0.45 * t)));
      const tipZ = i === 0 ? peakZ - 1 : (i === wingBones - 1 ? ankleZ + 1 : Math.floor(peakZ + (ankleZ - peakZ) * (0.35 + 0.4 * t)));
      drawLine(peakX, peakY, peakZ, tipX, peakY, tipZ, 1, wingBone);
    }
    // leading edge ridge
    drawLine(peakX, peakY, peakZ, outerX, peakY, peakZ - 1, 1, mixVoxelColor(wingBone, highlight, 0.15));
  }

  // --- WEAPON (thin tip-UP blade from ready hand) ---
  const bladeColor = mixVoxelColor(highlight, secondary, 0.1);
  const haftColor = mixVoxelColor(accent, shadow, 0.22);
  const tipZ = Math.min(size - 2, handZ + weaponLen);
  if (weaponType.includes('spear') || weaponType.includes('staff') || weaponType.includes('wand') || weaponType.includes('bow')) {
    drawLine(handX + frontDir, centerY, handZ - 2, handX + frontDir, centerY, tipZ, 1, haftColor);
    fillBox(handX + frontDir - 1, handX + frontDir + 1, centerY, centerY, tipZ - 1, tipZ, weaponType.includes('wand') ? highlight : bladeColor);
  } else if (weaponType.includes('dagger') || weaponType.includes('sword') || !weaponType) {
    // thin blade (1 voxel in Y), tip up
    fillBox(handX + frontDir, handX + frontDir, centerY, centerY, handZ, tipZ, bladeColor);
    // slight edge highlight along length
    if (weaponLen > 6) {
      fillBox(handX + frontDir, handX + frontDir, centerY, centerY, tipZ - 2, tipZ, mixVoxelColor(bladeColor, highlight, 0.35));
    }
    // crossguard
    fillBox(handX + frontDir - 1, handX + frontDir + 1, centerY, centerY, handZ, handZ, haftColor);
    // grip
    fillBox(handX, handX + frontDir, centerY, centerY, handZ - 2, handZ - 1, haftColor);
  } else if (weaponType.includes('axe')) {
    fillBox(handX + frontDir, handX + frontDir, centerY, centerY, handZ, tipZ - 2, haftColor);
    fillBox(handX + frontDir * 2, handX + frontDir * 3, centerY, centerY, tipZ - 3, tipZ, bladeColor);
  } else if (weaponType.includes('mace')) {
    fillBox(handX + frontDir, handX + frontDir, centerY, centerY, handZ, tipZ - 2, haftColor);
    fillBox(handX + frontDir - 1, handX + frontDir + 1, centerY, centerY, tipZ - 1, tipZ, secondary);
  } else if (weaponType.includes('scythe')) {
    fillBox(handX + frontDir, handX + frontDir, centerY, centerY, handZ, tipZ, haftColor);
    drawLine(handX + frontDir, centerY, tipZ - 1, handX + frontDir * 3, centerY, tipZ - 3, 1, bladeColor);
  }

  return { size, voxels, colors };
}

function sampleCanvasToGrid(canvas, gridW, gridH, mirror) {
  const sourceW = Math.max(1, canvas && canvas.width ? canvas.width : gridW);
  const sourceH = Math.max(1, canvas && canvas.height ? canvas.height : gridH);
  const sampleW = sourceW / gridW;
  const sampleH = sourceH / gridH;
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  const imageData = (ctx && typeof ctx.getImageData === 'function')
    ? ctx.getImageData(0, 0, sourceW, sourceH).data
    : null;
  const grid = new Uint8Array(gridW * gridH);
  const colors = new Float32Array(gridW * gridH * 3);
  if (!imageData) return { grid, colors, gridW, gridH };
  for (let sy = 0; sy < gridH; sy++) {
    for (let sx = 0; sx < gridW; sx++) {
      const srcSX = mirror ? (gridW - 1 - sx) : sx;
      const x0 = Math.floor(srcSX * sampleW);
      const x1 = Math.max(x0 + 1, Math.floor((srcSX + 1) * sampleW));
      const y0 = Math.floor(sy * sampleH);
      const y1 = Math.max(y0 + 1, Math.floor((sy + 1) * sampleH));
      let alphaSum = 0, sampleCount = 0, rSum = 0, gSum = 0, bSum = 0, opaqueCount = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const x = Math.max(0, Math.min(sourceW - 1, px));
          const y = Math.max(0, Math.min(sourceH - 1, py));
          const idx = (y * sourceW + x) * 4;
          const a = imageData[idx + 3];
          alphaSum += a; sampleCount++;
          if (a > 24) {
            rSum += imageData[idx]; gSum += imageData[idx + 1]; bSum += imageData[idx + 2]; opaqueCount++;
          }
        }
      }
      if (!sampleCount || !opaqueCount) continue;
      if (alphaSum / sampleCount <= 24) continue;
      const cellIndex = sx + sy * gridW;
      grid[cellIndex] = 1;
      colors[cellIndex * 3] = Math.min(1, Math.max(0, (rSum / opaqueCount) / 255));
      colors[cellIndex * 3 + 1] = Math.min(1, Math.max(0, (gSum / opaqueCount) / 255));
      colors[cellIndex * 3 + 2] = Math.min(1, Math.max(0, (bSum / opaqueCount) / 255));
    }
  }
  return { grid, colors, gridW, gridH };
}

function voxelizeCharacterFrameCanvas(canvas, options = {}) {
  // Single-view shallow extrusion (fallback). Prefer voxelizeMultiViewSolid for 3D actors.
  const voxelSize = Math.max(12, Math.min(options.allowLargeVoxelGrid ? 64 : 32, Math.floor(options.voxelSize || 48)));
  const baseDepth = Math.max(2, Math.min(16, Math.floor(options.depth || 5)));
  const taper = options.taper !== false;
  const mirror = !!options.mirror;
  const sourcePixelGridW = Math.max(1, Math.min(64, Math.floor(options.sourcePixelGridW || BASE_SIZE)));
  const sourcePixelGridH = Math.max(1, Math.min(64, Math.floor(options.sourcePixelGridH || BASE_SIZE)));
  const sampled = sampleCanvasToGrid(canvas, sourcePixelGridW, sourcePixelGridH, mirror);
  const voxels = new Uint8Array(voxelSize * voxelSize * voxelSize);
  const colors = new Float32Array(voxels.length * 3);
  const indexOf = (x, y, z) => x + y * voxelSize + z * voxelSize * voxelSize;
  const neighborCount = (sx, sy) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= sourcePixelGridW || y >= sourcePixelGridH) continue;
      if (sampled.grid[x + y * sourcePixelGridW]) n++;
    }
    return n;
  };
  for (let gz = 0; gz < voxelSize; gz++) {
    const sy = Math.max(0, Math.min(sourcePixelGridH - 1, Math.floor((gz / voxelSize) * sourcePixelGridH)));
    for (let gx = 0; gx < voxelSize; gx++) {
      const sx = Math.max(0, Math.min(sourcePixelGridW - 1, Math.floor((gx / voxelSize) * sourcePixelGridW)));
      const cellIndex = sx + sy * sourcePixelGridW;
      if (!sampled.grid[cellIndex]) continue;
      const baseColor = [sampled.colors[cellIndex * 3], sampled.colors[cellIndex * 3 + 1], sampled.colors[cellIndex * 3 + 2]];
      const z = voxelSize - 1 - gz;
      let localDepth = baseDepth;
      if (taper) {
        const n = neighborCount(sx, sy);
        const edge = 1 - Math.min(1, n / 8);
        localDepth = Math.max(2, Math.round(baseDepth * (1 - 0.45 * edge)));
      }
      const localStart = Math.max(0, Math.floor((voxelSize - localDepth) * 0.5));
      const localEnd = Math.min(voxelSize, localStart + localDepth);
      for (let gy = localStart; gy < localEnd; gy++) {
        const voxelIndex = indexOf(gx, gy, z);
        voxels[voxelIndex] = 1;
        const depthT = localDepth > 1 ? (gy - localStart) / (localDepth - 1) : 0.5;
        const shade = 0.94 + 0.12 * (1 - Math.abs(depthT - 0.35));
        colors[voxelIndex * 3] = Math.min(1, baseColor[0] * shade);
        colors[voxelIndex * 3 + 1] = Math.min(1, baseColor[1] * shade);
        colors[voxelIndex * 3 + 2] = Math.min(1, baseColor[2] * shade);
      }
    }
  }
  return { size: voxelSize, voxels, colors };
}

/**
 * Solid-ish volume from front + side + three-quarter billboard views of the SAME approved sprite art.
 * Visual-hull carve: voxel exists where front(x,z) AND side(y,z) agree (¾ softens). Colors from front (fallback side/¾).
 */
function voxelizeMultiViewSolid(viewCanvases, options = {}) {
  const voxelSize = Math.max(16, Math.min(options.allowLargeVoxelGrid ? 64 : 48, Math.floor(options.voxelSize || 48)));
  const gridN = Math.max(16, Math.min(64, Math.floor(options.sourcePixelGridW || options.voxelSize || 48)));
  const mirror = !!options.mirror;
  const front = sampleCanvasToGrid(viewCanvases.front, gridN, gridN, mirror);
  const side = sampleCanvasToGrid(viewCanvases.side || viewCanvases.front, gridN, gridN, false);
  const tq = sampleCanvasToGrid(viewCanvases.threeQuarter || viewCanvases.front, gridN, gridN, mirror);
  const voxels = new Uint8Array(voxelSize * voxelSize * voxelSize);
  const colors = new Float32Array(voxels.length * 3);
  const indexOf = (x, y, z) => x + y * voxelSize + z * voxelSize * voxelSize;

  // Map voxel coords → sprite grids
  const toGrid = (v) => Math.max(0, Math.min(gridN - 1, Math.floor((v / voxelSize) * gridN)));

  for (let vz = 0; vz < voxelSize; vz++) {
    const gzFront = toGrid(voxelSize - 1 - vz); // y-down in sprite → z-up in voxels
    for (let vx = 0; vx < voxelSize; vx++) {
      const gx = toGrid(vx);
      const frontIdx = gx + gzFront * gridN;
      if (!front.grid[frontIdx]) continue;
      for (let vy = 0; vy < voxelSize; vy++) {
        const gy = toGrid(vy);
        const sideIdx = gy + gzFront * gridN;
        // Visual hull: need front + side. Three-quarter softens edges (prefer, don't require).
        if (!side.grid[sideIdx]) continue;
        const tqIdx = gx + gzFront * gridN;
        // Optional: discard corners far from ¾ silhouette to round the volume
        const tqHit = tq.grid[tqIdx];
        // Interior bias: if only barely on side edge and missing ¾, skip (reduces slabs)
        let sideN = 0;
        for (let d = -1; d <= 1; d++) {
          const yy = gy + d;
          if (yy >= 0 && yy < gridN && side.grid[yy + gzFront * gridN]) sideN++;
        }
        if (!tqHit && sideN <= 1) continue;

        const vi = indexOf(vx, vy, vz);
        voxels[vi] = 1;
        // Color priority: front → threeQuarter → side (sprite pixels, not redesign)
        let r, g, b;
        if (front.grid[frontIdx]) {
          r = front.colors[frontIdx * 3]; g = front.colors[frontIdx * 3 + 1]; b = front.colors[frontIdx * 3 + 2];
        } else if (tqHit) {
          r = tq.colors[tqIdx * 3]; g = tq.colors[tqIdx * 3 + 1]; b = tq.colors[tqIdx * 3 + 2];
        } else {
          r = side.colors[sideIdx * 3]; g = side.colors[sideIdx * 3 + 1]; b = side.colors[sideIdx * 3 + 2];
        }
        // Mild depth shade so faces read in torch light
        const depthT = voxelSize > 1 ? vy / (voxelSize - 1) : 0.5;
        const shade = 0.93 + 0.12 * (1 - Math.abs(depthT - 0.45));
        colors[vi * 3] = Math.min(1, r * shade);
        colors[vi * 3 + 1] = Math.min(1, g * shade);
        colors[vi * 3 + 2] = Math.min(1, b * shade);
      }
    }
  }
  return { size: voxelSize, voxels, colors };
}

function createCharacterVoxelFrames(character, spriteSpec = null, options = {}) {
  const frameCount = Math.max(1, Math.min(8, Math.floor(options.frameCount || 4)));
  const mode = String(options.mode || 'sprite').toLowerCase();
  const view = String(options.view || 'front').toLowerCase() === 'back' ? 'back' : 'front';
  const solid = options.solid !== false; // default solid multi-view for 3D actors
  const proceduralSpec = getProceduralSpec(character, spriteSpec);
  if (proceduralSpec && proceduralSpec.kind === 'placeholder') {
    const size = 12;
    return Array.from({ length: frameCount }, () => ({
      size,
      voxels: new Uint8Array(size * size * size),
      colors: new Float32Array(size * size * size * 3),
      empty: true
    }));
  }

  if (mode === 'semantic') {
    const baseSpec = (typeof resolveVoxelSpriteSpec === 'function')
      ? resolveVoxelSpriteSpec(character, spriteSpec || proceduralSpec)
      : (spriteSpec || createCharacterSpriteSpec(character || {}));
    return Array.from({ length: frameCount }, () => createSemanticCharacterVoxelFrame(character, baseSpec, options));
  }

  const proceduralApi = proceduralSpec ? getProceduralApi() : null;
  if (proceduralSpec && proceduralApi && typeof proceduralApi.createBillboardCanvas === 'function') {
    const grid = Math.min(64, proceduralSpec.grid || 64);
    const make = (f, v) => proceduralApi.createBillboardCanvas(proceduralSpec, { frame: f % 4, view: v });
    return Array.from({ length: frameCount }, (_, f) => {
      if (solid) {
        const views = {
          front: make(f, view === 'back' ? 'back' : 'front'),
          side: make(f, 'side'),
          threeQuarter: make(f, 'threeQuarter')
        };
        return voxelizeMultiViewSolid(views, Object.assign({}, options, {
          voxelSize: options.voxelSize || grid,
          allowLargeVoxelGrid: true,
          sourcePixelGridW: grid,
          sourcePixelGridH: grid,
          mirror: !!options.mirror
        }));
      }
      const canvas = make(f, view);
      return voxelizeCharacterFrameCanvas(canvas, Object.assign({}, options, {
        voxelSize: options.voxelSize || grid,
        allowLargeVoxelGrid: true,
        sourcePixelGridW: grid,
        sourcePixelGridH: grid,
        depth: Math.max(3, Math.min(8, Math.floor(options.depth || 5))),
        taper: options.taper !== false,
        mirror: !!options.mirror
      }));
    });
  }

  const frames = extractCharacterFrameCanvases(character, spriteSpec, frameCount);
  return frames.map((frameCanvas) => voxelizeCharacterFrameCanvas(frameCanvas, Object.assign({}, options, {
    depth: Math.max(3, Math.min(8, Math.floor(options.depth || 5))),
    taper: options.taper !== false
  })));
}


/**
 * Helper for Phaser scenes: registers a generated character as a proper spritesheet texture
 * with named frames + a basic looping animation.
 *
 * Returns { textureKey, animKey, sprite? } so you can do scene.add.sprite(x,y, textureKey).play(animKey)
 * or draw specific frames into RenderTextures (this.renderRT.draw(texKey, 'frame0', x, y, w, h))
 *
 * This is the bridge from our Retort-driven catalog "sprite editor" to real Phaser Sprite + Animation system.
 */
function registerAnimatedCharacterSprite(scene, character, options = {}) {
  if (typeof scene === 'undefined' || !scene.textures || !scene.anims) {
    throw new Error('registerAnimatedCharacterSprite requires a Phaser Scene with textures and anims');
  }

  const keyBase = (options.keyPrefix || 'char') + '-' + String(character.Name || character.name || 'pc').replace(/\s+/g, '_').toLowerCase();
  const texKey = keyBase + '-sheet';
  const animKey = keyBase + '-anim';

  const frameCount = options.frameCount || 4;
  const sheetCanvas = createCharacterSpriteSheetCanvas(character, character.sprite && character.sprite.spec, frameCount);
  const frameW = sheetCanvas.height; // assume square frames
  const frameH = frameW;

  if (!scene.textures.exists(texKey)) {
    scene.textures.addCanvas(texKey, sheetCanvas);

    const tex = scene.textures.get(texKey);
    // Define frames manually (like a sprite sheet with no JSON)
    for (let i = 0; i < frameCount; i++) {
      tex.add('frame' + i, 0, i * frameW, 0, frameW, frameH);
    }
    // Make sure WebGL buffers are happy
    if (tex.update) tex.update();
    if (tex.refresh) tex.refresh();

    // Force NEAREST for that true pixel art look (matches our combat RT settings)
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  // Create (or reuse) a simple cycle animation
  if (!scene.anims.exists(animKey)) {
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push({ key: texKey, frame: 'frame' + i });
    }
    scene.anims.create({
      key: animKey,
      frames: frames,
      frameRate: options.frameRate || 4,
      repeat: -1
    });
  }

  // Optional: immediately create a sprite at given position
  let sprite = null;
  if (options.createSprite !== false) {
    const x = options.x || 0;
    const y = options.y || 0;
    sprite = scene.add.sprite(x, y, texKey, 'frame0');
    if (options.play !== false) {
      sprite.play(animKey);
    }
    sprite.setOrigin(0.5, 0.5);
    // If you want it crisp
    if (sprite.texture && sprite.texture.setFilter) sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  return {
    textureKey: texKey,
    animKey,
    frameCount,
    sprite
  };
}

// =====================================================================================================
// TRAIT-DRIVEN CATALOG EXTENSION (C64 style)
// Every generated (non-preset) character arrives with an LLM trait spec (spec.kind === 'procedural',
// spec.traits from retort/characterTraitSpec.js). The 2D sprite (combat map token, party panel, 'Your
// Sprite') is drawn here in the SAME style as the original catalog above: 24x24 grid x4, side profile
// facing right, chunky stacked bands, few colours, shadow sides + top highlight. The humanoid body reuses
// the original prefabs (drawHead / drawTorso / drawStridingLegs / drawSwingArm / drawWeapon /
// drawAccessoryCape / drawSkeletalWings); the trait spec only picks prefabs, palette and add-on parts:
// body-plan silhouettes (beast, draconic, serpent, spider, ooze / floating eye, elemental, spectral),
// horns, wings, tails, hood vs helm, robe vs armour, held weapon / shield / orb in its own colour,
// glow eyes, plus a 1-cell outline so the silhouette reads at 32px. Presets (Mortacia / Suzerain) never
// come through here: they keep their hand-made art. The detailed 48px renderer
// (renderCharacterProcedural.js) is used for the 3D world actors only.
// =====================================================================================================
const C64_GRID = BASE_SIZE;      // 24
const C64_U = UPSCALE;           // 4

function c64Rgb(hex) {
  const s = String(hex || '#000000').replace('#', '');
  const v = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s.padEnd(6, '0').slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function c64Hex(rgb) {
  return '#' + rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function c64Mix(a, b, t) {
  const A = c64Rgb(a), B = c64Rgb(b);
  return c64Hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
function c64Dark(hex, t) { return c64Mix(hex, '#000000', t); }
function c64Light(hex, t) { return c64Mix(hex, '#ffffff', t); }
function c64Lum(hex) { const c = c64Rgb(hex); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
// Push a colour away from very dark / muddy values so it survives the few-colour look on dark maps.
function c64Readable(hex, minLum = 46) {
  let h = hex;
  for (let i = 0; i < 6 && c64Lum(h) < minLum; i++) h = c64Light(h, 0.18);
  return h;
}
function c64HashRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

function isTraitSpriteSpec(spec) {
  return !!(spec && spec.kind === 'procedural' && spec.traits && spec.traits.palette);
}
function isPlaceholderSpriteSpec(spec) {
  return !!(spec && spec.kind === 'placeholder');
}

// Build the few-colour palette (original normalizePalette fields + glow/eye/metal) from the trait palette.
function c64PaletteFromTraits(t, rng) {
  const P = t.palette || {};
  const style = (t.outfit && t.outfit.style) || 'none';
  const bare = style === 'none' || ['beast', 'serpent', 'spider', 'ooze', 'elemental', 'draconic'].includes(t.bodyPlan);
  let skin = c64Readable(P.skin || '#d69e78', bare ? 60 : 88);
  if (t.bodyPlan === 'skeletal' || t.covering === 'bone') skin = c64Readable(P.skin && c64Lum(P.skin) > 120 ? P.skin : '#d8d0b4', 120);
  let outfit = c64Readable(bare ? (P.skin2 || P.skin || '#806040') : (P.outfit || '#5a4a3a'), 40);
  // the face must stand out from the clothes / hair
  if (!bare && Math.abs(c64Lum(skin) - c64Lum(outfit)) < 35) skin = c64Lum(outfit) < 128 ? c64Light(skin, 0.35) : c64Dark(skin, 0.35);
  let outfit2 = c64Readable(bare ? c64Dark(skin, 0.3) : (P.outfit2 || c64Dark(outfit, 0.3)), 34);
  const metal = c64Readable(P.metal || '#9aa3ad', 90);
  let trim = c64Readable(P.trim || '#c9a64a', 70);
  if (Math.abs(c64Lum(trim) - c64Lum(outfit)) < 30) trim = c64Lum(outfit) > 120 ? c64Dark(trim, 0.45) : c64Light(trim, 0.4);
  const glow = P.glow || '#ffe8a0';
  const eye = (t.eyes && (t.eyes.glow || t.eyes.style === 'glowing')) ? c64Light(glow, 0.1) : '#111111';
  const hair = c64Readable(P.hair || '#3a2618', 36);
  const shadow = c64Dark(outfit2, 0.55);
  const isPlate = style === 'plate' || style === 'mail';
  return {
    primary: isPlate ? metal : outfit,
    secondary: bare ? c64Dark(skin, 0.18) : (isPlate ? c64Dark(metal, 0.28) : outfit2),
    highlight: isPlate ? c64Light(metal, 0.35) : trim,
    shadow,
    skin,
    accent: trim,
    hair,
    glow,
    eye,
    metal,
    outfit,
    outfit2,
    trim,
    horn: c64Lum(skin) > 150 ? c64Dark(skin, 0.35) : '#d9cfb0',
    outline: '#0d0b12',
    aura: (t.aura && t.aura.strength >= 0.5) ? (t.aura.color || glow) : null
  };
}

// --- cell-unit drawing helpers (1 cell = 4 canvas px) ----------------------------------------------
function c64R(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  if (!color) { ctx.clearRect(Math.round(x * C64_U), Math.round(y * C64_U), Math.round(w * C64_U), Math.round(h * C64_U)); return; }
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * C64_U), Math.round(y * C64_U), Math.round(w * C64_U), Math.round(h * C64_U));
}
function c64Dither(ctx, x, y, w, h, color, phase = 0) {
  ctx.fillStyle = color;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (((xx + yy + phase) & 1) === 0) ctx.fillRect((x + xx) * C64_U, (y + yy) * C64_U, C64_U, C64_U);
  }
}
function c64Line(ctx, x0, y0, x1, y1, color, w = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n);
    const y = Math.round(y0 + (y1 - y0) * i / n);
    c64R(ctx, x, y, w, w, color);
  }
}
function c64Disc(ctx, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= r * r + r * 0.6) c64R(ctx, cx + x, cy + y, 1, 1, color);
  }
}
function c64Oval(ctx, cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    if ((x * x) / (rx * rx + 0.3) + (y * y) / (ry * ry + 0.3) <= 1.0) c64R(ctx, cx + x, cy + y, 1, 1, color);
  }
}

// --- add-on prefabs ---------------------------------------------------------------------------------
function c64Poly(ctx, pts, color) {
  let minY = Infinity, maxY = -Infinity;
  pts.forEach(([, y]) => { minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y + 0.5 && y1 > y + 0.5) || (y1 <= y + 0.5 && y0 > y + 0.5)) xs.push(x0 + (y + 0.5 - y0) * (x1 - x0) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.round(xs[k]), b = Math.round(xs[k + 1]);
      if (b > a) c64R(ctx, a, y, b - a, 1, color);
    }
  }
}
function c64Wings(ctx, kind, sx, sy, span, pal, frame) {
  // sx,sy = shoulder (back side). Profile: the far wing spreads up/back to the left, the near wing tip
  // shows over the front shoulder. Flaps between frames.
  if (!kind || kind === 'none') return;
  const flap = (frame === 1 || frame === 3) ? 1 : 0;
  if (kind === 'bone') {
    drawSkeletalWings(ctx, sx - 2, sy - 3, C64_U, { ...pal }, 6, 4, 1.2, -1);
    return;
  }
  const base = pal.wing || pal.secondary;
  const memb = kind === 'insect' ? c64Light(pal.glow, 0.55) : (kind === 'flame' ? pal.glow : (kind === 'spectral' ? c64Light(pal.glow, 0.3) : base));
  const bone = kind === 'feather' ? c64Light(memb, 0.45) : c64Dark(memb, 0.5);
  const E = [sx - 2, sy - span + 1 + flap];
  const T = [sx - span, sy - span + 3 + flap * 2];
  const F1 = [sx - span + 1, sy + 1];
  const F2 = [sx - 3, sy + 2];
  if (kind === 'insect' || kind === 'spectral' || kind === 'flame') {
    // two long thin dithered blades
    for (let i = 0; i <= span; i++) {
      const x = Math.round(sx - 1 - i * 0.9), y = Math.round(sy - i * 0.8 + flap);
      c64Dither(ctx, x - 1, y, 3, 2, memb, i + frame);
      c64Dither(ctx, x - 1, y + 3, 2, 1, memb, i + frame + 1);
    }
    c64Line(ctx, sx, sy, Math.round(sx - span * 0.9), Math.round(sy - span * 0.8 + flap), bone);
    return;
  }
  c64Poly(ctx, [[sx, sy], E, T, F1, F2], memb);
  // scalloped trailing edge between finger tips
  if (kind === 'bat') {
    const mx = Math.round((F1[0] + F2[0]) / 2), my = Math.round((F1[1] + F2[1]) / 2);
    c64R(ctx, mx, my - 1, 1, 1, null); c64R(ctx, mx - 1, my, 3, 1, null);
    const mx2 = Math.round((T[0] + F1[0]) / 2) + 1, my2 = Math.round((T[1] + F1[1]) / 2);
    c64R(ctx, mx2, my2, 1, 1, null);
  }
  c64Line(ctx, sx, sy, E[0], E[1], bone);
  c64Line(ctx, E[0], E[1], T[0], T[1], bone);
  if (kind === 'bat') { c64Line(ctx, E[0], E[1], F1[0], F1[1], bone); c64Line(ctx, E[0], E[1], F2[0], F2[1], bone); c64R(ctx, E[0], E[1] - 1, 1, 1, pal.horn || bone); }
  else for (let r = 2; r < span; r += 2) c64Line(ctx, E[0] - 1, E[1] + r, Math.round(T[0] + r * 0.4), Math.round(T[1] + r), bone);
  // near wing tip over the front shoulder
  c64Poly(ctx, [[sx + 2, sy], [sx + 3, sy - 3 + flap], [sx + 5, sy - 2 + flap], [sx + 4, sy + 1]], memb);
  c64R(ctx, sx + 3, sy - 3 + flap, 1, 1, bone);
}

function c64Tail(ctx, kind, x, y, pal, frame) {
  // x,y = base at lower back (tail extends to the left / behind)
  if (!kind || kind === 'none') return;
  const sway = (frame === 1) ? -1 : (frame === 3 ? 1 : 0);
  const col = kind === 'flame' ? pal.glow : (kind === 'wisp' ? c64Light(pal.glow, 0.3) : (pal.tail || pal.secondary));
  const dark = c64Dark(col, 0.35);
  if (kind === 'thick' || kind === 'scaled') {
    // U-shaped tail: down and back from the lower back, then up to a raised tip (reads as a tail, not a limb)
    const pts = [[x - 1, y], [x - 2, y + 1], [x - 3, y + 2], [x - 4, y + 3], [x - 5, y + 3 + sway], [x - 6, y + 2 + sway], [x - 7, y + 1 + sway], [x - 7, y + sway]];
    pts.forEach(([px, py], i) => c64R(ctx, px, py, 1, i < 4 ? 2 : 1, i < 4 ? col : dark));
    c64R(ctx, x - 8, y - 1 + sway, 1, 1, kind === 'scaled' ? pal.horn || dark : dark);
    if (kind === 'scaled') { c64R(ctx, x - 2, y, 1, 1, dark); c64R(ctx, x - 4, y + 2, 1, 1, dark); }
    return;
  }
  if (kind === 'tentacle') {
    for (let i = 0; i < 7; i++) c64R(ctx, x - 1 - i, y + 1 + Math.round(Math.sin(i * 0.9 + sway) * 1.2), 1, 1, col);
    return;
  }
  if (kind === 'stinger') {
    c64Line(ctx, x - 1, y, x - 4, y - 3, col);
    c64Line(ctx, x - 4, y - 3, x - 3, y - 6 + sway, col);
    c64R(ctx, x - 2, y - 7 + sway, 2, 1, pal.glow);
    return;
  }
  if (kind === 'flame' || kind === 'wisp') {
    c64Dither(ctx, x - 5, y, 5, 2, col, frame);
    c64R(ctx, x - 6, y - 1 + sway, 1, 1, col);
    return;
  }
  // thin
  c64Line(ctx, x - 1, y + 1, x - 4, y + 3 + sway, col);
  c64Line(ctx, x - 4, y + 3 + sway, x - 6, y + 1 + sway, col);
  c64R(ctx, x - 7, y + sway, 1, 1, dark);
}

function c64Horns(ctx, kind, hx, hy, hw, pal) {
  if (!kind || kind === 'none') return;
  const c = pal.horn;
  const d = c64Dark(c, 0.35);
  if (kind === 'nubs') { c64R(ctx, hx + 1, hy - 1, 1, 1, c); c64R(ctx, hx + hw - 2, hy - 1, 1, 1, c); return; }
  if (kind === 'crown') { for (let i = 0; i < hw; i += 2) c64R(ctx, hx + i, hy - 2, 1, 2, c); c64R(ctx, hx, hy - 1, hw, 1, d); return; }
  if (kind === 'antlers') {
    c64Line(ctx, hx + 1, hy - 1, hx - 1, hy - 4, c); c64R(ctx, hx - 2, hy - 4, 1, 1, c); c64R(ctx, hx, hy - 3, 1, 1, c);
    c64Line(ctx, hx + hw - 2, hy - 1, hx + hw, hy - 4, c); c64R(ctx, hx + hw + 1, hy - 4, 1, 1, c); c64R(ctx, hx + hw - 1, hy - 3, 1, 1, c);
    return;
  }
  if (kind === 'ram') {
    // curl on the side of the head (profile: visible on back side)
    c64R(ctx, hx - 1, hy - 1, 3, 1, c); c64R(ctx, hx - 2, hy, 1, 3, c); c64R(ctx, hx - 1, hy + 3, 2, 1, c); c64R(ctx, hx - 1, hy + 1, 1, 1, d);
    c64R(ctx, hx + hw - 1, hy - 1, 2, 1, c);
    return;
  }
  if (kind === 'long') {
    c64Line(ctx, hx + 1, hy - 1, hx - 1, hy - 5, c); c64Line(ctx, hx + hw - 2, hy - 1, hx + hw - 1, hy - 5, c);
    return;
  }
  // curved (default demon horns): up then sweeping back
  c64R(ctx, hx, hy - 2, 1, 2, c); c64R(ctx, hx - 1, hy - 3, 1, 1, c); c64R(ctx, hx - 2, hy - 3, 1, 1, d);
  c64R(ctx, hx + hw - 1, hy - 2, 1, 2, c); c64R(ctx, hx + hw - 1, hy - 3, 1, 1, c); c64R(ctx, hx + hw - 2, hy - 4, 1, 1, d);
}

function c64ItemPalette(item, pal) {
  const color = c64Readable(item && item.color ? item.color : pal.metal, 70);
  return {
    ...pal,
    highlight: color,
    accent: item && item.accent ? c64Readable(c64Dark(item.accent, 0.1), 40) : c64Dark(color, 0.45),
    shadow: c64Dark(color, 0.6)
  };
}
const C64_WEAPON_MAP = {
  sword: 'sword_broad', greatsword: 'sword_broad', scimitar: 'sword_broad', axe: 'axe', staff: 'staff_crook', dagger: 'dagger',
  mace: 'mace', hammer: 'mace', flail: 'mace', spear: 'spear', trident: 'spear', scythe: 'scythe_long', sickle: 'scythe_long',
  wand: 'wand', banner: 'spear'
};

// One-handed weapons are held raised forward (diagonal), so the face stays clear at 24px.
const C64_ONE_HANDED = ['sword', 'scimitar', 'axe', 'mace', 'hammer', 'flail', 'dagger', 'sickle', 'wand'];
function c64OneHandedWeapon(ctx, item, gx, gy, pal, frame) {
  const ip = c64ItemPalette(item, pal);
  const type = item.type;
  const blade = ip.highlight, grip = ip.accent;
  const L = type === 'dagger' || type === 'wand' ? 4 : 7;
  const pt = (i) => [gx + Math.floor((i + 1) / 2), gy - i];
  const isBlade = type === 'sword' || type === 'scimitar' || type === 'dagger';
  for (let i = 0; i <= L; i++) {
    const [x, y] = pt(i);
    let col = isBlade ? (i <= 1 ? grip : blade) : (i >= L - 1 && type !== 'wand' && type !== 'flail' && type !== 'sickle' ? blade : grip);
    if (type === 'scimitar' && i > L - 3) c64R(ctx, x + 1, y, 1, 1, blade);
    c64R(ctx, x, y, 1, 1, col);
  }
  const [tx, ty] = pt(L);
  if (isBlade) { c64R(ctx, gx - 1, gy - 2, 3, 1, c64Dark(blade, 0.35)); c64R(ctx, tx, ty - 1, 1, 1, c64Light(blade, 0.35)); }
  else if (type === 'axe') { c64R(ctx, tx + 1, ty, 2, 3, blade); c64R(ctx, tx + 2, ty - 1, 1, 1, blade); c64R(ctx, tx + 2, ty + 3, 1, 1, blade); }
  else if (type === 'mace') { c64R(ctx, tx - 1, ty - 1, 3, 3, blade); c64R(ctx, tx, ty - 2, 1, 1, blade); c64R(ctx, tx + 2, ty, 1, 1, c64Dark(blade, 0.3)); }
  else if (type === 'hammer') { c64R(ctx, tx - 1, ty - 1, 4, 2, blade); c64R(ctx, tx - 1, ty, 4, 1, c64Dark(blade, 0.3)); }
  else if (type === 'flail') { c64R(ctx, tx + 1, ty + 1, 1, 2, grip); c64R(ctx, tx + 1, ty + 3 - (frame & 1), 2, 2, blade); }
  else if (type === 'sickle') { c64R(ctx, tx, ty - 1, 2, 1, blade); c64R(ctx, tx + 2, ty, 1, 2, blade); c64R(ctx, tx + 1, ty + 2, 1, 1, blade); }
  else if (type === 'wand') c64R(ctx, tx, ty - 1, 1, 1, c64Light(pal.glow, 0.3));
  if (item.glow) c64R(ctx, tx + 1, ty - 1 - (frame & 1), 1, 1, c64Light(pal.glow, 0.35));
}

// Draws a held weapon/item at hand (hx,hy = hand cell). Returns true when something was drawn.
function c64HeldItem(ctx, item, hx, hy, pal, frame, facing = 1) {
  if (!item) return false;
  const type = item.type;
  const ip = c64ItemPalette(item, pal);
  if (C64_ONE_HANDED.includes(type)) { c64OneHandedWeapon(ctx, item, hx, hy, pal, frame); return true; }
  if (C64_WEAPON_MAP[type]) {
    const len = type === 'greatsword' || type === 'scythe' || type === 'staff' || type === 'spear' || type === 'trident' || type === 'banner' ? 12
      : (type === 'dagger' || type === 'wand' || type === 'sickle' ? 5 : 8);
    const wy = hy + 1 - len;
    drawWeapon(ctx, (hx + 1) * C64_U, wy * C64_U, C64_U, ip, len, C64_WEAPON_MAP[type], type === 'greatsword' ? 5 : 4, facing);
    if (type === 'trident') { c64R(ctx, hx, wy, 1, 2, ip.highlight); c64R(ctx, hx + 2, wy, 1, 2, ip.highlight); c64R(ctx, hx, wy + 2, 3, 1, ip.highlight); }
    if (type === 'hammer') c64R(ctx, hx, wy, 3, 2, ip.highlight);
    if (type === 'banner') { c64R(ctx, hx + 2, wy, 3, 4, ip.accent); c64R(ctx, hx + 3, wy + 1, 1, 1, ip.highlight); }
    if (item.glow) { c64R(ctx, hx + 1, wy - 1, 1, 1, c64Light(pal.glow, 0.3)); }
    return true;
  }
  if (type === 'bow' || type === 'crossbow') {
    const c = ip.accent;
    c64Line(ctx, hx + 1, hy - 5, hx + 3, hy - 3, c); c64R(ctx, hx + 3, hy - 3, 1, 5, c); c64Line(ctx, hx + 3, hy + 2, hx + 1, hy + 4, c);
    c64R(ctx, hx + 1, hy - 4, 1, 8, c64Light(ip.highlight, 0.4));
    return true;
  }
  if (type === 'whip') {
    c64R(ctx, hx + 1, hy, 1, 1, ip.accent);
    for (let i = 0; i < 6; i++) c64R(ctx, hx + 2 + Math.floor(i / 2), hy + 1 + i, 1, 1, ip.highlight);
    return true;
  }
  if (type === 'claws') {
    c64R(ctx, hx + 2, hy, 1, 1, ip.highlight); c64R(ctx, hx + 2, hy + 2, 1, 1, ip.highlight); c64R(ctx, hx + 3, hy + 1, 1, 1, ip.highlight);
    return true;
  }
  if (type === 'orb' || type === 'crystal' || type === 'skull' || type === 'lantern' || type === 'tome' || type === 'horn' || type === 'amulet' || type === 'ring' || type === 'crown') {
    const ox = hx + 2;
    const oy = hy - 2;
    const glowC = item.glow ? c64Light(item.accent || pal.glow, 0.35) : null;
    if (glowC) { c64R(ctx, ox - 1, oy + 1, 1, 1, glowC); c64R(ctx, ox + 3, oy + 1 - (frame & 1), 1, 1, glowC); c64R(ctx, ox + 1, oy - 2 + (frame & 1), 1, 1, glowC); }
    if (type === 'orb' || type === 'amulet' || type === 'ring') {
      c64Disc(ctx, ox + 1, oy + 1, 1, ip.highlight);
      c64R(ctx, ox + 1, oy, 1, 1, glowC || c64Light(ip.highlight, 0.6));
      if (c64Lum(ip.highlight) < 50) c64R(ctx, ox, oy, 1, 1, c64Light(ip.accent, 0.4));
    } else if (type === 'crystal') {
      c64R(ctx, ox + 1, oy - 1, 1, 4, ip.highlight); c64R(ctx, ox, oy, 3, 2, ip.highlight); c64R(ctx, ox + 1, oy, 1, 1, c64Light(ip.highlight, 0.6));
    } else if (type === 'skull') {
      c64R(ctx, ox, oy, 3, 2, '#e0dcc8'); c64R(ctx, ox, oy + 2, 2, 1, '#e0dcc8'); c64R(ctx, ox, oy + 1, 1, 1, '#111'); c64R(ctx, ox + 2, oy + 1, 1, 1, '#111');
    } else if (type === 'lantern') {
      c64R(ctx, ox + 1, oy - 1, 1, 1, ip.accent); c64R(ctx, ox, oy, 3, 3, ip.accent); c64R(ctx, ox + 1, oy + 1, 1, 1, c64Light(pal.glow, 0.2));
    } else if (type === 'tome') {
      c64R(ctx, ox, oy, 3, 3, ip.highlight); c64R(ctx, ox, oy, 1, 3, ip.accent);
    } else {
      c64R(ctx, ox, oy, 2, 2, ip.highlight);
    }
    return true;
  }
  return false;
}

function c64Shield(ctx, item, x, y, pal) {
  if (!item) return;
  const ip = c64ItemPalette(item, pal);
  const face = ip.highlight;
  const rim = c64Dark(face, 0.5);
  const emb = item.accent ? c64Light(item.accent, c64Lum(item.accent) < 70 ? 0.45 : 0) : c64Light(face, 0.5);
  const shape = item.shape || 'heater';
  if (shape === 'round' || shape === 'buckler') {
    const r = shape === 'buckler' ? 1 : 2;
    c64Disc(ctx, x + 2, y + 2, r + 1, rim);
    c64Disc(ctx, x + 2, y + 2, r, face);
    c64R(ctx, x + 2, y + 2, 1, 1, emb);
    return;
  }
  const h = shape === 'tower' ? 6 : 5;
  c64R(ctx, x, y, 3, h - 1, face);
  c64R(ctx, x + 1, y + h - 1, 1, 1, face);
  c64R(ctx, x, y, 3, 1, c64Light(face, 0.3));
  c64R(ctx, x + 2, y + 1, 1, h - 2, rim);
  c64R(ctx, x + 1, y + 1, 1, 2, emb);
  if (item.glow) c64R(ctx, x + 1, y + 1, 1, 1, c64Light(pal.glow, 0.4));
  if (shape === 'spiked') c64R(ctx, x + 3, y + 2, 1, 1, rim);
}

function c64Eyes(ctx, t, hx, hy, hw, hh, pal, facing = 1) {
  const glow = t.eyes && (t.eyes.glow || t.eyes.style === 'glowing');
  const col = glow ? pal.eye : '#111111';
  const ey = hy + 1 + (hh >= 5 ? 1 : 0);
  if (t.eyes && t.eyes.style === 'cyclops') { c64R(ctx, hx + Math.floor(hw / 2), ey, 1, 1, glow ? col : '#ffffff'); c64R(ctx, hx + Math.floor(hw / 2), ey, 0.5, 0.5, '#111'); return; }
  if (t.eyes && t.eyes.style === 'compound') { c64R(ctx, hx + hw - 2, ey, 2, 2, '#7a1020'); c64R(ctx, hx + hw - 2, ey, 1, 1, '#ff6070'); return; }
  if (t.eyes && t.eyes.style === 'hollow') { c64R(ctx, hx + hw - 2, ey, 1, 1, '#000000'); c64R(ctx, hx + hw - 4, ey, 1, 1, '#000000'); if (glow) c64R(ctx, hx + hw - 2, ey, 0.5, 0.5, col); return; }
  const front = facing > 0 ? hx + hw - 2 : hx + 1;
  c64R(ctx, front, ey, 1, 1, col);
  if (glow) { c64R(ctx, front - 2 * facing, ey, 1, 1, col); c64R(ctx, front + facing, ey, 1, 1, c64Dark(col, 0.25)); }
}

// --- body plans ------------------------------------------------------------------------------------
function c64Proportions(t, rng) {
  const sz = t.size || 'medium';
  const base = { tiny: [3, 3, 6], small: [3, 4, 8], medium: [4, 5, 10], large: [4, 6, 11], huge: [5, 6, 12] }[sz] || [4, 5, 10];
  const build = t.build || 'average';
  let torsoW = build === 'slender' ? 4 : (build === 'heavy' ? 6 : 5);
  if (sz === 'large' || sz === 'huge' || t.bodyPlan === 'giant') torsoW += 1;
  if (sz === 'tiny' || sz === 'small') torsoW = Math.max(4, torsoW - 1);
  let headW = Math.max(4, Math.min(6, torsoW - (rng() < 0.5 ? 0 : 1)));
  return { headH: base[0], torsoH: base[1] + (rng() < 0.3 ? 1 : 0) - (rng() < 0.2 ? 1 : 0), legH: base[2] + (rng() < 0.35 ? 1 : 0), torsoW, headW, legW: build === 'heavy' ? 4 : (build === 'slender' ? 2 : 3), armH: base[1] };
}

function c64Humanoid(ctx, spec, t, pal, frame, rng) {
  // Clean side-profile figure in the catalog's visual language: small round head with the face on the
  // right, stacked torso bands (shadow back edge, highlight front edge, belt), striding legs, front arm
  // swinging with the held item, back arm behind. Every add-on comes from the trait spec.
  const sex = String(spec.sex || '').toLowerCase();
  const isFemale = /^f/.test(sex);
  const style = (t.outfit && t.outfit.style) || 'none';
  const helm = (t.outfit && t.outfit.helm) || 'none';
  const hooded = !!(t.outfit && t.outfit.hood) || helm === 'hood' || helm === 'cowl';
  const spectral = t.bodyPlan === 'spectral' || (t.translucency >= 0.45 && (t.tattered || t.floating));
  const naga = !!t.nagaTorso || t.bodyPlan === 'serpent';
  const skeletal = t.bodyPlan === 'skeletal';
  const insect = t.bodyPlan === 'insectoid';
  const p = c64Proportions(t, rng);
  const robe = ['robe', 'dress', 'cloak', 'rags'].includes(style);
  const armour = style === 'plate' || style === 'mail';
  const step = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  const bob = frame === 2 ? -1 : 0;
  const lift = (t.floating || spectral) ? (-1 - (frame & 1)) : 0;
  const cx = 11;
  const tw = p.torsoW, hw = Math.max(4, Math.min(5, p.headW)), hh = Math.max(4, Math.min(5, p.headH));
  const legH = naga ? 0 : p.legH;
  const ground = 22;
  const torsoBottom = naga ? 16 : ground - legH + 1;
  const torsoY = torsoBottom - p.torsoH + bob + lift;
  const headY = torsoY - hh;
  const tx = cx - Math.floor(tw / 2);
  const hx = cx - Math.floor(hw / 2) + 1;

  const skin = pal.skin, skinD = c64Dark(pal.skin, 0.28);
  let body = style === 'none' || skeletal ? skin : (armour ? pal.metal : pal.outfit);
  let bodyD = style === 'none' || skeletal ? skinD : (armour ? c64Dark(pal.metal, 0.35) : c64Dark(pal.outfit, 0.3));
  let bodyL = style === 'none' || skeletal ? c64Light(skin, 0.25) : (armour ? c64Light(pal.metal, 0.4) : c64Light(pal.outfit, 0.22));
  const trim = pal.trim;
  const legC = robe ? body : (armour ? c64Dark(pal.metal, 0.15) : (style === 'none' || skeletal ? skin : pal.outfit2));
  const legD = c64Dark(legC, 0.3);
  const boot = armour ? c64Dark(pal.metal, 0.45) : c64Dark(pal.outfit2, 0.45);

  const items = Array.isArray(t.items) ? t.items : [];
  const weapon = items.find((i) => i.slot === 'weapon' && i.type !== 'shield') || items.find((i) => C64_WEAPON_MAP[i.type] || ['bow', 'crossbow', 'whip', 'claws'].includes(i.type));
  const shield = items.find((i) => i.type === 'shield' || i.slot === 'shield');
  const handItem = items.find((i) => i !== weapon && i !== shield && ['orb', 'crystal', 'skull', 'lantern', 'tome', 'horn', 'amulet'].includes(i.type));

  // --- behind: wings, cape, tail, back arm / extra arms, back weapon
  if (t.wings && t.wings !== 'none') {
    let wingCol = t.wings === 'bone' ? pal.horn : (t.wings === 'feather' ? c64Light(pal.hair, 0.5) : c64Dark(skin, 0.4));
    if (Math.abs(c64Lum(wingCol) - c64Lum(body)) < 28) wingCol = c64Lum(body) < 110 ? c64Light(wingCol, 0.35) : c64Dark(wingCol, 0.35);
    c64Wings(ctx, t.wings, tx + 1, torsoY + 1, Math.max(6, p.torsoH + 2), { ...pal, wing: wingCol, secondary: wingCol }, frame);
  }
  if (t.outfit && t.outfit.cape) {
    const auraC = t.aura && t.aura.color ? c64Readable(t.aura.color, 50) : null;
    const capeCol = auraC && Math.abs(c64Lum(auraC) - c64Lum(body)) > 18 ? auraC
      : (c64Lum(trim) > 60 && c64Lum(trim) < 210 && Math.abs(c64Lum(trim) - c64Lum(body)) > 25 ? trim : c64Light(pal.outfit2, 0.25));
    const ch = p.torsoH + Math.floor(legH * 0.7);
    c64R(ctx, tx - 2, torsoY + 1, 3, ch, capeCol);
    c64R(ctx, tx - 3 - (frame & 1), torsoY + 3, 1, ch - 3, capeCol);
    c64R(ctx, tx - 1, torsoY + 2, 1, ch - 2, c64Dark(capeCol, 0.35));
  }
  if (t.tail && t.tail !== 'none' && !naga) c64Tail(ctx, t.tail, tx + 1, torsoBottom - 1 + bob + lift, { ...pal, tail: c64Dark(skin, 0.08) }, frame);
  if (t.spikes) for (let i = 0; i < p.torsoH; i += 2) c64R(ctx, tx - 1, torsoY + i, 1, 1, pal.horn);
  // back arm (darker, mostly hidden)
  const backArmC = robe || armour ? bodyD : skinD;
  c64R(ctx, tx, torsoY + 1, 1, p.armH, backArmC);
  if (t.extraArms > 0 || insect) {
    c64R(ctx, tx - 1, torsoY + 2, 1, p.armH - 1, backArmC);
    c64R(ctx, tx - 2, torsoY + 1 + p.armH, 2, 1, skinD);
  }

  // --- lower body
  if (naga) {
    // serpent tail: from the hips down to the ground, then coiled back to the left
    const sc = skin, scD = skinD;
    c64R(ctx, tx, torsoBottom, tw, 3, sc);
    c64R(ctx, tx + 1, torsoBottom + 3, tw, 2, sc);
    c64Oval(ctx, cx - 1, 20, 7, 2, sc);
    c64R(ctx, cx - 7, 21, 13, 1, scD);
    c64R(ctx, tx + tw - 1, torsoBottom, 1, 5, c64Light(sc, 0.25));
    c64R(ctx, cx - 9 - step, 19, 2, 1, sc); c64R(ctx, cx - 10 - step, 18, 1, 1, sc);
  } else if (spectral) {
    for (let i = 0; i < legH; i++) {
      const w = Math.max(1, tw + 1 - Math.floor(i * (tw + 1) / legH));
      const x = tx - 1 + Math.floor((tw + 2 - w) / 2) - Math.floor(i / 3) + ((frame & 1) && i % 3 === 0 ? 1 : 0);
      if (i >= Math.floor(legH * 0.45)) c64Dither(ctx, x, torsoBottom + i + lift, w, 1, body, i + frame);
      else c64R(ctx, x, torsoBottom + i + lift, w, 1, body);
    }
  } else if (robe) {
    // robe flares to the ground, feet step out underneath
    for (let i = 0; i < legH - 1; i++) {
      const flare = Math.min(2, Math.floor(i / 3));
      c64R(ctx, tx - flare, torsoBottom + i + bob, tw + flare * 2 - (i === legH - 2 ? 0 : 0), 1, body);
      c64R(ctx, tx - flare, torsoBottom + i + bob, 1, 1, bodyD);
      c64R(ctx, tx + tw + flare - 1, torsoBottom + i + bob, 1, 1, bodyL);
    }
    c64R(ctx, tx - 2, ground - 1 + bob, tw + 4, 1, trim);
    c64R(ctx, cx + step, ground, 2, 1, boot);
    c64R(ctx, cx - 2 - step, ground, 2, 1, c64Dark(boot, 0.3));
  } else {
    // two legs: back leg darker; stride swaps per frame
    const lx = cx - 2, rx = cx;
    const backOff = -step, frontOff = step;
    const legW = skeletal ? 1 : 2;
    c64R(ctx, lx + backOff, torsoBottom, legW, legH - 1, skeletal ? skinD : legD);
    c64R(ctx, lx + backOff, ground, legW + 1, 1, skeletal ? skinD : c64Dark(boot, 0.3));
    c64R(ctx, rx + frontOff, torsoBottom, legW, legH - 1, legC);
    c64R(ctx, rx + frontOff, ground, legW + 1, 1, skeletal ? skin : boot);
    if (!skeletal) {
      c64R(ctx, rx + frontOff, ground - 3, legW, 2, boot);
      c64R(ctx, lx + backOff, ground - 3, legW, 2, c64Dark(boot, 0.3));
      if (armour) c64R(ctx, rx + frontOff, torsoBottom + Math.floor(legH / 2) - 1, legW, 1, c64Light(pal.metal, 0.35));
    }
    if (t.claws) c64R(ctx, rx + frontOff + legW + 1, ground, 1, 1, pal.horn);
  }

  // --- torso
  c64R(ctx, tx, torsoY, tw, p.torsoH, body);
  c64R(ctx, tx, torsoY, 1, p.torsoH, bodyD);
  c64R(ctx, tx + tw - 1, torsoY + 1, 1, p.torsoH - 1, bodyL);
  c64R(ctx, tx + 1, torsoY, tw - 2, 1, bodyL);
  if (armour) {
    c64R(ctx, tx - 1, torsoY, tw + 2, 2, c64Light(pal.metal, 0.2));        // pauldrons
    c64R(ctx, tx - 1, torsoY + 1, tw + 2, 1, c64Dark(pal.metal, 0.2));
    if (style === 'mail') for (let y = 2; y < p.torsoH - 1; y++) c64Dither(ctx, tx + 1, torsoY + y, tw - 2, 1, c64Dark(pal.metal, 0.25), y);
  }
  if (skeletal && (style === 'none' || style === 'rags')) for (let y = 1; y < p.torsoH - 1; y += 2) c64R(ctx, tx + 1, torsoY + y, tw - 2, 1, c64Dark(skin, 0.6));
  if (style !== 'none' && !skeletal) c64R(ctx, tx, torsoY + p.torsoH - 2, tw, 1, robe ? trim : c64Dark(trim, 0.1)); // belt
  if (style === 'tabard') c64R(ctx, cx, torsoY + 1, 2, p.torsoH, trim);
  if (isFemale && !armour && style !== 'none') c64R(ctx, tx + tw - 1, torsoY + 1, 1, 1, c64Light(body, 0.35));
  if (t.outfit && t.outfit.symbol && t.outfit.symbol !== 'none' && style !== 'none') {
    const sc = t.outfit.symbol === 'holy' || t.outfit.symbol === 'sun' ? '#f2d64a' : (t.outfit.symbol === 'skull' ? '#e0dcc8' : c64Light(pal.glow, 0.15));
    c64R(ctx, cx, torsoY + 2, 1, 1, sc);
  }
  if (t.markings === 'runes' || t.markings === 'veins' || t.markings === 'cracks') c64R(ctx, cx - 1, torsoY + 2, 1, 2, c64Light(pal.glow, 0.1));

  // --- head (a dark rim first, so the head reads cleanly over wings / horns / cape behind it)
  const headC = skeletal || t.head === 'skull' ? pal.skin : skin;
  if ((t.wings && t.wings !== 'none') || (t.outfit && t.outfit.cape)) {
    c64R(ctx, hx, headY - 1, hw - 1, 1, pal.outline);
    c64R(ctx, hx - 1, headY, 1, hh, pal.outline);
    c64R(ctx, tx - 1, torsoY, 1, p.torsoH, pal.outline);
  }
  c64R(ctx, hx + 1, headY, hw - 2, 1, headC);
  c64R(ctx, hx, headY + 1, hw, hh - 2, headC);
  c64R(ctx, hx + 1, headY + hh - 1, hw - 1, 1, headC);
  c64R(ctx, hx, headY + 1, 1, hh - 2, c64Dark(headC, 0.18));
  c64R(ctx, cx, headY + hh, 2, 1, skinD); // neck
  const snout = t.head === 'beast' || t.head === 'reptile' || t.head === 'demon' || t.head === 'bird' || insect;
  if (snout) {
    const sc = t.head === 'bird' ? '#e0a030' : (insect ? pal.horn : headC);
    c64R(ctx, hx + hw, headY + 2, 2, 2, sc);
    c64R(ctx, hx + hw + 1, headY + 3, 1, 1, c64Dark(sc, 0.35));
  } else {
    c64R(ctx, hx + hw, headY + 2, 1, 1, headC); // nose
  }
  if (t.head === 'skull' || skeletal) { c64R(ctx, hx + hw - 2, headY + 1, 1, 2, '#000000'); c64R(ctx, hx + 1, headY + hh - 1, hw - 2, 1, c64Dark(headC, 0.45)); }
  if (t.tusks || t.fangs) c64R(ctx, hx + hw - 1, headY + hh - 1, 1, 1, '#f4f0e0');
  if (t.beard && !hooded) c64R(ctx, hx + 1, headY + hh - 1, hw - 1, 2, pal.hair);
  // ears
  if (t.ears === 'pointed' || t.ears === 'long') { c64R(ctx, hx + 1, headY + 1, 1, 2, c64Dark(headC, 0.1)); c64R(ctx, hx, headY - (t.ears === 'long' ? 1 : 0), 1, 2, c64Dark(headC, 0.1)); }
  if (t.ears === 'animal') { c64R(ctx, hx + 1, headY - 1, 1, 1, headC); c64R(ctx, hx + hw - 2, headY - 1, 1, 1, headC); }
  if (t.ears === 'fin') c64R(ctx, hx, headY, 1, 3, pal.glow);
  // hair (cap + back), long hair falls down the back
  const showHair = t.hair && t.hair !== 'none' && !hooded && !['closed', 'horned'].includes(helm);
  if (showHair) {
    const hc = pal.hair;
    if (t.hair === 'mohawk') { c64R(ctx, hx + 1, headY - 1, hw - 2, 1, hc); c64R(ctx, hx + 2, headY - 2, 1, 1, hc); }
    else if (t.hair === 'snakes') { for (let i = 0; i < hw; i += 2) c64R(ctx, hx + i, headY - 1 - (i % 4 ? 0 : 1), 1, 2, '#4f8a3a'); }
    else if (t.hair === 'flame') { c64R(ctx, hx, headY, hw - 1, 1, pal.glow); c64R(ctx, hx + 1, headY - 1, hw - 2, 1, pal.glow); c64R(ctx, hx + 2, headY - 2 - (frame & 1), 1, 1, c64Light(pal.glow, 0.4)); }
    else {
      c64R(ctx, hx, headY, hw - 1, 1, hc);
      c64R(ctx, hx + 1, headY - 1, hw - 2, 1, hc);
      c64R(ctx, hx, headY + 1, 2, 2, hc);
      if (t.hair === 'topknot') c64R(ctx, hx + 1, headY - 2, 2, 1, hc);
      if (t.hair === 'long' || t.hair === 'flowing' || t.hair === 'braid' || (isFemale && t.hair !== 'short')) {
        c64R(ctx, hx - 1, headY + 1, 2, hh + 1, hc);
        if (t.hair === 'flowing') c64R(ctx, hx - 2, headY + 3 + (frame & 1), 1, hh, hc);
        if (t.hair === 'braid') c64R(ctx, hx - 1, headY + hh + 2, 1, 3, c64Dark(hc, 0.2));
      }
    }
  }
  if (t.mane) c64R(ctx, hx - 2, headY + 1, 2, hh + 2, pal.hair);
  // helm / crown / hood
  if (hooded) {
    const hc = robe ? body : pal.outfit2 && c64Lum(pal.outfit2) > 40 ? pal.outfit2 : pal.outfit;
    c64R(ctx, hx - 1, headY - 1, hw + 1, 2, hc);
    c64R(ctx, hx - 1, headY + 1, 2, hh + 1, hc);
    c64R(ctx, hx + hw - 1, headY, 1, 2, c64Dark(hc, 0.2));
    c64R(ctx, hx + 1, headY - 2, hw - 2, 1, hc);
    c64R(ctx, hx, headY - 1, hw - 1, 1, c64Light(hc, 0.2));
    // face in shadow
    c64R(ctx, hx + 1, headY + 1, hw - 1, hh - 2, c64Mix(headC, '#000000', spectral || t.translucency > 0.35 ? 0.8 : 0.4));
  } else if (helm === 'closed' || helm === 'horned' || helm === 'open') {
    const m = pal.metal, mD = c64Dark(m, 0.35);
    c64R(ctx, hx - 1, headY - 1, hw + 1, 2, m);
    c64R(ctx, hx - 1, headY + 1, 2, hh - 1, m);
    c64R(ctx, hx, headY - 1, hw - 1, 1, c64Light(m, 0.35));
    if (helm !== 'open') {
      c64R(ctx, hx + 1, headY + 1, hw - 1, hh - 2, m);
      c64R(ctx, hx + 2, headY + 2, hw - 1, 1, '#101010'); // visor slit
    }
    if (helm === 'horned') c64Horns(ctx, 'long', hx, headY, hw, { ...pal, horn: c64Light(m, 0.45) });
    else if (rng() < 0.6) { c64R(ctx, hx + 1, headY - 3, 1, 2, trim); c64R(ctx, hx, headY - 2, 1, 1, trim); } // plume
    c64R(ctx, hx - 1, headY + 1, 1, hh - 1, mD);
  } else if (helm === 'crown' || helm === 'circlet') {
    const cc = helm === 'crown' ? '#f2c94a' : pal.metal;
    c64R(ctx, hx, headY, hw - 1, 1, cc);
    if (helm === 'crown') for (let i = 0; i < hw - 1; i += 2) c64R(ctx, hx + i, headY - 1, 1, 1, cc);
    else c64R(ctx, hx + hw - 2, headY, 1, 1, c64Light(pal.glow, 0.2));
  }
  if (t.horns && t.horns !== 'none' && helm !== 'horned') c64Horns(ctx, t.horns, hx, headY - (hooded ? 1 : 0), hw, pal);
  if (insect) { c64Line(ctx, hx + 2, headY - 1, hx + 4, headY - 3, pal.horn); c64R(ctx, hx + 5, headY - 4, 1, 1, pal.horn); }
  // eyes (skip when a closed helm covers the face; glow eyes still show through the slit)
  const glowEyes = t.eyes && (t.eyes.glow || t.eyes.style === 'glowing');
  if (!(helm === 'closed' || helm === 'horned') || glowEyes) {
    const ey = headY + 2;
    const ec = glowEyes ? pal.eye : (hooded ? '#000000' : '#101010');
    if (t.eyes && t.eyes.style === 'cyclops') c64R(ctx, hx + hw - 2, ey - 1, 1, 1, glowEyes ? ec : '#f0f0f0');
    else if (t.eyes && t.eyes.style === 'compound') c64R(ctx, hx + hw - 2, ey - 1, 2, 2, '#c02030');
    else {
      c64R(ctx, hx + hw - 2, ey - 1, 1, 1, ec);
      if (glowEyes) c64R(ctx, hx + hw - 4, ey - 1, 1, 1, c64Dark(ec, 0.2));
    }
  }
  if (t.halo) c64R(ctx, hx, headY - 3, hw - 1, 1, '#ffe680');

  // --- shield on the body, front arm + held items
  if (shield) c64Shield(ctx, shield, tx + tw, torsoY + 2, pal);
  const swing = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  const ax = tx + tw - 1;
  const armC = robe || armour || style === 'gi' ? body : (style === 'leather' || style === 'furs' ? c64Dark(pal.outfit, 0.1) : skin);
  const handY = torsoY + p.armH;
  const handX = ax + 1 + Math.max(0, swing);
  if (!shield) {
    c64R(ctx, ax, torsoY + 1, 2, 2, armC);
    c64R(ctx, ax + Math.max(0, swing), torsoY + 3, 2, p.armH - 3, armC);
    c64R(ctx, ax + Math.max(0, swing), torsoY + 3, 1, p.armH - 3, c64Dark(armC, 0.2));
  } else {
    c64R(ctx, ax, torsoY + 1, 1, 2, armC); // shoulder; the arm is behind the shield
  }
  c64R(ctx, handX, handY, 2, 1, skeletal ? pal.skin : skin);
  const front = weapon || handItem;
  if (front) c64HeldItem(ctx, front, weapon ? (C64_ONE_HANDED.includes(weapon.type) ? handX + 1 : handX + 1) : handX - 1, weapon && C64_ONE_HANDED.includes(weapon.type) ? handY : handY, pal, frame, 1);
  if (weapon && handItem) {
    if (handItem.type === 'amulet') c64R(ctx, cx, torsoY + 1, 1, 1, c64Readable(handItem.color || pal.glow, 90));
    else c64HeldItem(ctx, handItem, tx - 4, torsoY + p.armH - 1, pal, frame, 1);
  }
  if (t.handGlow) c64Dither(ctx, handX, handY - 1, 3, 3, c64Light(pal.glow, 0.25), frame & 1);
  return { hx, headY, tx, torsoY };
}

function c64Beast(ctx, spec, t, pal, frame, rng, draconic) {
  const body = draconic ? pal.skin : pal.skin;
  const dark = c64Dark(body, 0.3);
  const light = c64Light(body, 0.25);
  const big = t.size === 'large' || t.size === 'huge' || draconic;
  const bx = draconic ? 6 : 5, by = draconic ? 12 : 13, bw = big ? 11 : 10, bh = big ? 5 : 4;
  const step = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  if (t.wings && t.wings !== 'none') c64Wings(ctx, t.wings, bx + 6, by + 1, draconic ? 9 : 6, { ...pal, wing: c64Lum(body) < 70 ? c64Mix(c64Light(body, 0.45), pal.eye && pal.eye !== '#111111' ? pal.eye : body, 0.25) : c64Mix(body, pal.outfit2 || dark, 0.4) }, frame);
  c64Tail(ctx, t.tail && t.tail !== 'none' ? t.tail : (draconic ? 'thick' : 'thin'), bx + 1, by + 1, { ...pal, tail: body }, frame);
  // legs (back pair darker)
  const legH = 22 - (by + bh) + 1;
  [[bx + 1, -step, dark], [bx + bw - 3, step, dark], [bx + 2, step, body], [bx + bw - 2, -step, body]].forEach(([lx, s, col]) => {
    c64R(ctx, lx + (s > 0 ? 1 : 0), by + bh, 2, legH, col);
    c64R(ctx, lx + (s > 0 ? 1 : 0) + 1, 22, 2, 1, t.claws ? pal.horn : c64Dark(col, 0.3));
  });
  // body
  c64R(ctx, bx, by, bw, bh, body);
  c64R(ctx, bx + 1, by - 1, bw - 2, 1, body);
  c64R(ctx, bx + 1, by + bh - 1, bw - 2, 1, light);
  c64R(ctx, bx + 1, by - 1, bw - 3, 1, c64Light(body, 0.15));
  if (t.markings === 'stripes') for (let i = 2; i < bw - 1; i += 3) c64R(ctx, bx + i, by, 1, bh - 1, dark);
  if (t.markings === 'spots') for (let i = 2; i < bw - 1; i += 3) c64R(ctx, bx + i, by + 1 + (i % 2), 1, 1, dark);
  if (t.spikes || draconic) for (let i = 1; i < bw - 1; i += 2) c64R(ctx, bx + i, by - 2, 1, 1, pal.horn);
  // neck + head
  let hx, hy;
  if (draconic) {
    c64Line(ctx, bx + bw - 1, by, bx + bw + 2, by - 4, body, 2);
    hx = bx + bw + 1; hy = by - 7;
    c64R(ctx, hx, hy, 4, 3, body); c64R(ctx, hx + 4, hy + 1, 2, 2, body); c64R(ctx, hx + 4, hy + 2, 2, 1, dark);
    c64R(ctx, hx + 2, hy + 1, 1, 1, pal.eye !== '#111111' ? pal.eye : '#ffd040');
    c64Horns(ctx, t.horns && t.horns !== 'none' ? t.horns : 'long', hx, hy, 4, pal);
    if (t.element === 'fire' && frame === 1) c64Dither(ctx, hx + 6, hy + 1, 2, 2, pal.glow, 0);
  } else {
    hx = bx + bw - 1; hy = by - 3;
    c64R(ctx, hx, hy, 4, 4, body);
    c64R(ctx, hx + 4, hy + 2, 2, 2, t.head === 'bird' ? '#e0a030' : body);
    c64R(ctx, hx + 5, hy + 3, 1, 1, dark);
    if (t.ears !== 'none') c64R(ctx, hx, hy - 1, 1, 1, body), c64R(ctx, hx + 2, hy - 1, 1, 1, body);
    c64R(ctx, hx + 2, hy + 1, 1, 1, pal.eye);
    if (t.horns && t.horns !== 'none') c64Horns(ctx, t.horns, hx, hy, 4, pal);
    if (t.mane) c64R(ctx, hx - 2, hy, 2, 5, pal.hair);
    if (t.tusks || t.fangs) c64R(ctx, hx + 4, hy + 4, 1, 1, '#f4f0e0');
  }
}

function c64Serpent(ctx, spec, t, pal, frame, rng) {
  const body = pal.skin, dark = c64Dark(body, 0.3), belly = c64Light(body, 0.35);
  const sway = (frame === 1) ? 1 : (frame === 3 ? -1 : 0);
  // coils
  c64Oval(ctx, 11, 20, 7, 2, body);
  c64R(ctx, 5, 21, 12, 1, dark);
  c64Oval(ctx, 9 + sway, 17, 5, 1, body);
  c64R(ctx, 6 + sway, 17, 7, 1, belly);
  c64Tail(ctx, t.tail === 'stinger' ? 'stinger' : 'thin', 5, 19, { ...pal, tail: body }, frame);
  if (t.nagaTorso) {
    // humanoid upper body rising from the coils
    const fake = { ...t, bodyPlan: 'humanoid', size: 'small', tail: 'none' };
    ctx.save();
    ctx.translate(2 * C64_U, -6 * C64_U);
    const pal2 = { ...pal };
    const hp = c64Proportions(fake, rng);
    const torsoX = 11 - Math.floor(hp.torsoW / 2) - 1, torsoY = 16 - hp.torsoH;
    drawTorso(ctx, t.outfit && t.outfit.style === 'plate' ? 'plate_armor' : 'jerkin', torsoX, torsoY, C64_U, { ...pal2, primary: t.outfit && t.outfit.style !== 'none' ? pal.outfit : body }, hp, false, false, '', 2, 2, 1);
    const headX = torsoX + Math.floor((hp.torsoW - hp.headW) / 2) + 1, headY = torsoY - hp.headH + 1;
    drawHead(ctx, t.hair && t.hair !== 'none' ? 'human_hair' : 'normal_human', headX, headY, C64_U, { ...pal2, highlight: pal.hair }, hp, /^f/i.test(spec.sex || ''), '', '', 2, 3, 1);
    c64Eyes(ctx, t, headX, headY, hp.headW, hp.headH, pal, 1);
    if (t.horns && t.horns !== 'none') c64Horns(ctx, t.horns, headX, headY, hp.headW, pal);
    const items = Array.isArray(t.items) ? t.items : [];
    drawSwingArm(ctx, torsoX + hp.torsoW - 1, torsoY + 1, C64_U, { ...pal2, secondary: body }, { armH: 4 }, 0, false, 2);
    c64HeldItem(ctx, items.find((i) => i.slot === 'weapon') || items[0], torsoX + hp.torsoW, torsoY + 5, pal, frame, 1);
    ctx.restore();
    return;
  }
  // raised neck + head (cobra-like)
  c64R(ctx, 13 + sway, 9, 2, 8, body);
  c64R(ctx, 14 + sway, 10, 1, 7, belly);
  c64R(ctx, 12 + sway, 6, 5, 3, body);
  c64R(ctx, 17 + sway, 7, 1, 2, dark);
  c64R(ctx, 15 + sway, 7, 1, 1, pal.eye !== '#111111' ? pal.eye : '#ffd040');
  if (t.horns && t.horns !== 'none') c64Horns(ctx, t.horns, 12 + sway, 6, 5, pal);
  if (t.fangs) c64R(ctx, 16 + sway, 9, 1, 1, '#f4f0e0');
  if (frame === 1 || frame === 3) c64R(ctx, 18 + sway, 8, 1, 1, '#d02030');
}

function c64Spider(ctx, spec, t, pal, frame, rng) {
  const body = c64Readable(pal.skin, 50), dark = c64Dark(body, 0.45), light = c64Light(body, 0.3);
  const eye = pal.eye !== '#111111' ? pal.eye : '#ff3040';
  const step = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  // 4 legs per side as high arches (far side darker, offset); knees above the body = spider silhouette
  const legs = [[-7, -2], [-3, -4], [2, -4], [6, -2]];
  legs.forEach(([dx, kyOff], i) => {
    const s = (i % 2 ? step : -step);
    const hipX = 11 + Math.round(dx * 0.3), hipY = 15;
    const kneeX = 11 + Math.round(dx * 0.75), kneeY = 9 + kyOff + 4 + (s > 0 ? -1 : 0);
    const footX = 11 + Math.round(dx * 1.45) + s, footY = 22;
    c64Line(ctx, hipX - 1, hipY, kneeX - 1, kneeY + 1, dark);
    c64Line(ctx, kneeX - 1, kneeY + 1, footX - 1, footY, dark);
    c64Line(ctx, hipX, hipY, kneeX, kneeY, body);
    c64Line(ctx, kneeX, kneeY, footX, footY, body);
  });
  // abdomen (rear, big) + cephalothorax (front)
  c64Oval(ctx, 7, 14, 4, 3, body);
  c64R(ctx, 5, 11, 4, 1, light);
  c64R(ctx, 4, 12, 1, 2, light);
  if (t.markings && t.markings !== 'none') { c64R(ctx, 6, 13, 3, 1, c64Readable(pal.glow, 90)); c64R(ctx, 7, 12, 1, 3, c64Readable(pal.glow, 90)); }
  else c64R(ctx, 6, 14, 2, 1, dark);
  c64Oval(ctx, 13, 15, 2, 2, body);
  c64R(ctx, 13, 13, 2, 1, light);
  c64R(ctx, 14, 14, 2, 1, eye);
  c64R(ctx, 13, 14, 1, 1, c64Dark(eye, 0.3));
  c64R(ctx, 15, 16, 1, 2, pal.horn); // fangs
  if (t.tail === 'stinger') c64Tail(ctx, 'stinger', 5, 12, { ...pal, tail: body }, frame);
}

function c64Ooze(ctx, spec, t, pal, frame, rng) {
  const body = pal.skin, dark = c64Dark(body, 0.35), light = c64Light(body, 0.4);
  const floatingEye = (t.eyes && t.eyes.style === 'cyclops') || t.head === 'eyeless' || t.floating;
  if (floatingEye) {
    const y = 10 + (frame === 2 ? -1 : 0);
    for (let i = 0; i < Math.max(3, t.tentacles || 4); i++) {
      const x = 8 + i * 2;
      for (let k = 0; k < 6; k++) c64R(ctx, x + Math.round(Math.sin(k * 0.8 + i + frame) * 0.8), y + 4 + k, 1, 1, k > 3 ? dark : body);
    }
    c64Disc(ctx, 12, y, 5, body);
    c64R(ctx, 9, y - 4, 4, 1, light);
    c64Disc(ctx, 13, y, 2, '#f2f0e8');
    c64R(ctx, 13, y, 2, 1, pal.eye !== '#111111' ? pal.eye : '#c02020');
    c64R(ctx, 14, y, 1, 1, '#000000');
    return;
  }
  const squash = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  const rx = 7 + squash, ry = 5 - squash;
  c64Oval(ctx, 11, 22 - ry, rx, ry, body);
  c64R(ctx, 4 - squash, 21, 15 + squash * 2, 1, body);
  c64R(ctx, 4 - squash, 22, 15 + squash * 2, 1, dark);
  c64Dither(ctx, 8, 22 - ry * 2 + 2, 4, 2, light, frame);
  c64R(ctx, 9, 22 - ry * 2 + 1, 3, 1, light);
  c64R(ctx, 6, 22, 1, 1, null);
  // eyes / bones floating inside
  c64R(ctx, 12, 22 - ry - 1, 1, 1, pal.eye !== '#111111' ? pal.eye : '#101010');
  c64R(ctx, 15, 22 - ry - 1, 1, 1, pal.eye !== '#111111' ? pal.eye : '#101010');
  const item = (t.items || [])[0];
  if (item) c64R(ctx, 9, 20, 2, 1, c64Readable(item.color || pal.metal, 70));
}

function c64Elemental(ctx, spec, t, pal, frame, rng) {
  const stony = t.covering === 'stone' || t.element === 'earth' || t.covering === 'crystal' || t.covering === 'bark' || t.covering === 'metal';
  const core = pal.skin, glow = pal.glow;
  if (stony) {
    const dark = c64Dark(core, 0.35), light = c64Light(core, 0.25);
    const bob = frame === 2 ? -1 : 0;
    c64R(ctx, 8, 7 + bob, 7, 7, core); c64R(ctx, 9, 6 + bob, 5, 1, light);
    c64R(ctx, 10, 3 + bob, 4, 4, core); c64R(ctx, 12, 4 + bob, 1, 1, glow);
    c64R(ctx, 5, 8 + bob, 3, 6, dark); c64R(ctx, 15, 8 + bob, 3, 6, core); c64R(ctx, 15, 14 + bob, 3, 2, dark);
    c64R(ctx, 8, 14 + bob, 3, 8 - bob, dark); c64R(ctx, 12, 14 + bob, 3, 8 - bob, core);
    c64R(ctx, 10, 9 + bob, 1, 3, dark); c64R(ctx, 13, 11 + bob, 1, 1, glow);
    if (t.markings === 'cracks' || t.markings === 'runes' || t.markings === 'veins') { c64R(ctx, 11, 8 + bob, 1, 2, glow); c64R(ctx, 9, 16 + bob, 1, 2, glow); }
    return;
  }
  // flame / storm / water / frost / shadow figure: flickering tapered column with arms
  const hot = c64Light(glow, 0.35);
  for (let y = 4; y <= 21; y++) {
    const tY = (y - 4) / 17;
    let w = Math.round(2 + Math.sin(tY * Math.PI) * 4 + (y > 15 ? (21 - y) * -0.2 : 0));
    const jitter = ((y + frame) % 3 === 0) ? 1 : 0;
    const x = 11 - Math.floor(w / 2) + jitter;
    if (y > 18) c64Dither(ctx, x, y, w, 1, core, y + frame);
    else c64R(ctx, x, y, w, 1, core);
    if (y > 6 && y < 16 && w > 3) c64R(ctx, x + 1, y, Math.max(1, w - 3), 1, glow);
  }
  // flame tips on the head
  c64R(ctx, 10, 2 + (frame & 1), 1, 2, glow); c64R(ctx, 12, 1 + ((frame + 1) & 1), 1, 3, hot); c64R(ctx, 14, 3, 1, 1, glow);
  // arms
  const sw = frame === 1 ? 1 : (frame === 3 ? -1 : 0);
  c64Line(ctx, 8, 9, 5, 12 + sw, core, 1); c64Line(ctx, 14, 9, 17, 11 - sw, core, 1);
  c64R(ctx, 4, 12 + sw, 2, 2, glow); c64R(ctx, 17, 10 - sw, 2, 2, glow);
  // eyes
  c64R(ctx, 11, 6, 1, 1, '#ffffff'); c64R(ctx, 13, 6, 1, 1, '#ffffff');
}

// Placeholder while the LLM spec is pending: a neutral shimmering mote (not a character).
function drawPlaceholderShimmer(ctx, frame, seed) {
  const rng = c64HashRng((seed >>> 0) + frame * 7919);
  const cols = ['#5a6478', '#8a94aa', '#c8d0e0'];
  c64Dither(ctx, 9, 12, 6, 8, '#3a4050', frame);
  for (let i = 0; i < 7; i++) {
    const x = 8 + Math.floor(rng() * 8), y = 9 + Math.floor(rng() * 12);
    c64R(ctx, x, y, 1, 1, cols[Math.floor(rng() * cols.length)]);
  }
  c64R(ctx, 11, 8 + (frame & 1), 2, 1, '#c8d0e0');
}

// 1-cell outline around the silhouette (cells with >= 3 opaque px count as filled). Aura characters get a
// coloured outline instead of black (C64-style glow).
function c64OutlinePass(ctx, color, fill) {
  if (typeof ctx.getImageData !== 'function') return;
  const S = C64_GRID * C64_U;
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const occ = new Uint8Array(C64_GRID * C64_GRID);
  for (let cy = 0; cy < C64_GRID; cy++) for (let cx = 0; cx < C64_GRID; cx++) {
    let n = 0;
    for (let y = 0; y < C64_U; y++) for (let x = 0; x < C64_U; x++) if (d[((cy * C64_U + y) * S + cx * C64_U + x) * 4 + 3] > 40) n++;
    occ[cy * C64_GRID + cx] = n >= 3 ? 1 : 0;
  }
  const rgb = c64Rgb(color);
  for (let cy = 0; cy < C64_GRID; cy++) for (let cx = 0; cx < C64_GRID; cx++) {
    if (occ[cy * C64_GRID + cx]) continue;
    const nb = (cx > 0 && occ[cy * C64_GRID + cx - 1]) || (cx < C64_GRID - 1 && occ[cy * C64_GRID + cx + 1])
      || (cy > 0 && occ[(cy - 1) * C64_GRID + cx]) || (cy < C64_GRID - 1 && occ[(cy + 1) * C64_GRID + cx]);
    if (!nb) continue;
    for (let y = 0; y < C64_U; y++) for (let x = 0; x < C64_U; x++) {
      const i = ((cy * C64_U + y) * S + cx * C64_U + x) * 4;
      if (d[i + 3] > 40 && !fill) continue;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Snap every pixel to the nearest of the sprite's own few palette colours (keeps the C64 look tight
// even where prefabs mix shades) - max ~12 colours.
function c64LimitColours(ctx, pal) {
  if (typeof ctx.getImageData !== 'function') return;
  const S = C64_GRID * C64_U;
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) { d[i + 3] = 0; continue; }
    d[i + 3] = 255;
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const keep = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let best = keep[0], bd = Infinity;
    for (const c of keep) {
      const dd = (c[0] - d[i]) ** 2 + (c[1] - d[i + 1]) ** 2 + (c[2] - d[i + 2]) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
  }
  ctx.putImageData(img, 0, 0);
}

// Seeded variation so two similar specs still differ (hue nudge of outfit/trim, proportions via rng).
function c64HueRotate(hex, deg) {
  const [r, g, b] = c64Rgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.04) return hex; // greys stay grey
  const sat = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + deg) % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return c64Hex([(rr + m) * 255, (gg + m) * 255, (bb + m) * 255]);
}

// Uniqueness rerolls (spec.variant > 0, chosen server-side) must change the 2D token visibly too: rotate the
// outfit/trim hues (less when the LLM gave a signature palette).
function c64VariantPalette(pal, variant, signature, plan) {
  const v = variant | 0;
  if (v <= 0) return pal;
  const deg = (signature ? 29 : 53) * v;
  const tintHue = (97 * v) % 360;
  const tint = c64HueRotate('#c04040', tintHue);
  // grey/black colours have no hue to rotate: tint them toward a per-variant hue instead
  const shift = (hex, d) => { const r = c64HueRotate(hex, d); return r === hex ? c64Mix(hex, tint, 0.3) : r; };
  const out = { ...pal };
  ['outfit', 'primary', 'secondary', 'highlight', 'accent', 'trim'].forEach((k, i) => { if (out[k]) out[k] = shift(out[k], i % 2 ? -deg : deg); });
  // creatures are mostly 'skin' (hide, scales, slime, flame): shift that too
  if (plan && plan !== 'humanoid' && plan !== 'skeletal' && out.skin) {
    out.skin = shift(out.skin, deg);
    if (out.skin2) out.skin2 = shift(out.skin2, deg);
  }
  return out;
}

function c64VaryPalette(pal, rng, signature) {
  if (signature) return pal;
  const nudge = (hex, amt) => {
    const c = c64Rgb(hex);
    const r = rng();
    const k = (r - 0.5) * amt;
    return c64Hex([c[0] * (1 + k), c[1] * (1 - k * 0.5), c[2] * (1 + k * 0.7)]);
  };
  return { ...pal, outfit: nudge(pal.outfit, 0.35), primary: nudge(pal.primary, 0.3), trim: nudge(pal.trim, 0.3), highlight: nudge(pal.highlight, 0.25) };
}

function createTraitSpriteCanvas(spec, frame = 0, options = {}) {
  const canvas = createCanvas(C64_GRID * C64_U, C64_GRID * C64_U);
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.fillRect !== 'function') return canvas;
  if (isPlaceholderSpriteSpec(spec)) {
    drawPlaceholderShimmer(ctx, frame, spec.seed || 1);
    return canvas;
  }
  const t = spec.traits;
  const rng = c64HashRng((spec.seed >>> 0) ^ 0x9e3779b9);
  const pal = c64VariantPalette(c64VaryPalette(c64PaletteFromTraits(t, rng), rng, !!t.signature), spec.variant, !!t.signature, t.bodyPlan || 'humanoid');
  const plan = t.bodyPlan || 'humanoid';
  const fr = frame | 0;
  if (plan === 'beast') c64Beast(ctx, spec, t, pal, fr, rng, false);
  else if (plan === 'draconic') c64Beast(ctx, spec, t, pal, fr, rng, true);
  else if (plan === 'serpent' && !t.nagaTorso) c64Serpent(ctx, spec, t, pal, fr, rng);
  else if (plan === 'spider') c64Spider(ctx, spec, t, pal, fr, rng);
  else if (plan === 'ooze') c64Ooze(ctx, spec, t, pal, fr, rng);
  else if (plan === 'elemental') c64Elemental(ctx, spec, t, pal, fr, rng);
  else c64Humanoid(ctx, spec, t, pal, fr, rng);
  if (options.outline !== false) c64OutlinePass(ctx, pal.outline, true);
  c64LimitColours(ctx, pal);
  return canvas;
}

function createTraitSpriteSheetCanvas(spec, frameCount = 4) {
  const n = Math.max(1, Math.min(8, frameCount | 0 || 4));
  const S = C64_GRID * C64_U;
  const sheet = createCanvas(S * n, S);
  const ctx = sheet.getContext('2d');
  for (let f = 0; f < n; f++) ctx.drawImage(createTraitSpriteCanvas(spec, f % 4), f * S, 0);
  return sheet;
}

// 12x12 fingerprint of the 2D sprite (used together with the detailed one in the uniqueness check).
function traitSpriteFingerprint(spec) {
  const cv = createTraitSpriteCanvas(spec, 0);
  const ctx = cv.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  const S = C64_GRID * C64_U;
  const d = ctx.getImageData(0, 0, S, S).data;
  const N = 12, cell = S / N;
  const alpha = [], lum = [];
  let r = 0, g = 0, b = 0, w = 0;
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    let a = 0, l = 0;
    for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) {
      const i = (y * S + x) * 4;
      const pa = d[i + 3] / 255;
      a += pa; l += pa * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      r += d[i] * pa; g += d[i + 1] * pa; b += d[i + 2] * pa; w += pa;
    }
    alpha.push(a / (cell * cell)); lum.push(a > 0 ? l / a / 255 : 0);
  }
  return { alpha, lum, col: w ? [r / w, g / w, b / w] : [0, 0, 0] };
}

// Safe export
if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = {
    generateCharacterSprite,
    createCharacterSpriteCanvas,
    createCharacterSpriteSheetCanvas,
    extractCharacterFrameCanvases,
    createCharacterVoxelFrames,
    createSemanticCharacterVoxelFrame,
    voxelizeMultiViewSolid,
    voxelizeCharacterFrameCanvas,
    resolveVoxelSpriteSpec,
    proceduralTraitsToVoxelSpec,
    registerAnimatedCharacterSprite,
    createCharacterSpriteSpec,
    createTraitSpriteCanvas,
    createTraitSpriteSheetCanvas,
    traitSpriteFingerprint,
    _createCanvas: createCanvas
  };
}

if (typeof window !== 'undefined') {
  window.generateCharacterSprite = generateCharacterSprite;
  window.createCharacterSpriteCanvas = createCharacterSpriteCanvas;
  window.createCharacterSpriteSheetCanvas = createCharacterSpriteSheetCanvas;
  window.extractCharacterFrameCanvases = extractCharacterFrameCanvases;
  window.createCharacterVoxelFrames = createCharacterVoxelFrames;
  window.createSemanticCharacterVoxelFrame = createSemanticCharacterVoxelFrame;
  window.resolveVoxelSpriteSpec = resolveVoxelSpriteSpec;
  window.registerAnimatedCharacterSprite = registerAnimatedCharacterSprite;
  window.createCharacterSpriteSpec = createCharacterSpriteSpec;
  window.createTraitSpriteCanvas = createTraitSpriteCanvas;
  window.createTraitSpriteSheetCanvas = createTraitSpriteSheetCanvas;
  window.traitSpriteFingerprint = traitSpriteFingerprint;
}
