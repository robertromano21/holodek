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

// EXACT MORTACIA REPLICATION (for the provided reference image #2).
// Methodology: Meticulous visual analysis of the reference (side profile facing left, small head with light top + black eye bar + skin face, dark grey costume body with mid grey belt/waist accent, skin tone thighs and arm, grey boots, light tan vertical sword held upward from rib/hand level on left with skin hand at base, complex stepped grey wing-like structure on right/back with multiple segments/prongs).
// We lock the pixel layout to exact rect clusters (base pixel positions chosen to match the ref's proportions, silhouette, attachments and "stacked" look when core body is centered at ~11-12,11-12).
// Color variations: seed-driven small palette shifts (different dark greys for body, mid/light greys for wing/boots, tans for sword/hair, skins) so every generation is structurally identical ("similar result every time") but has color variety for interest/rerolls.
// This bypasses the general prefab/draw* for Mortacia to guarantee pixel-perfect match to the ref (while other characters use the catalog system).
// Draw order: wing (back), legs, torso (costume), head, arm+hand, sword (front), details/outlines.
// All positions in base pixels; *u at draw time. Center chosen so the figure sits plumb and centered like the ref.
function drawMortaciaExact(ctx, baseX, baseY, u, seed, palette) {
  const s = seed || 0;
  const v = Math.floor(s * 1000) % 5; // 0-4 for color var

  // Color variations (greys for costume/wing/boot, light tan for sword, skin tones)
  const bodyDark = ['#1f1f1f', '#222222', '#252525', '#1c1c1c', '#282828'][v];
  const greyMid = ['#4a4a4a', '#555555', '#5a5a5a', '#454545', '#606060'][v];
  const greyLight = ['#6a6a6a', '#777777', '#808080', '#656565', '#888888'][v];
  const greyDark = ['#2a2a2a', '#333333', '#2f2f2f', '#252525', '#303030'][v];
  const swordTan = ['#d4c090', '#c8b48a', '#d0b880', '#b8a070', '#c0b080'][v];
  const skinTone = ['#e8d0b0', '#f0d8b8', '#e0c8a0', '#f5d5b5', '#d8c0a0'][v];
  const blackDetail = '#111111';
  const waistDetail = '#3a2a3a'; // small accent like in ref

  // === WING / back right structure (exact jagged grey on right of ref) ===
  // Built from overlapping rects to match the stepped, multi-prong silhouette in the image (top hook, main vertical, 3 descending right prongs). Adjusted for exact visual match to Image #2 - tall right blade-like part.
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX + 2) * u, (baseY + 0) * u, 2 * u, 2 * u); // top upper
  ctx.fillRect((baseX + 3) * u, (baseY + 1) * u, 2 * u, 2 * u);
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX + 4) * u, (baseY + 0) * u, 2 * u, 3 * u); // extension
  ctx.fillRect((baseX + 3) * u, (baseY + 3) * u, 3 * u, 5 * u); // main
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 5) * u, (baseY + 2) * u, 2 * u, 3 * u); // upper prong right
  ctx.fillRect((baseX + 5) * u, (baseY + 5) * u, 2 * u, 2 * u);
  // Tall right vertical for the wing "blade" to match ref Image #2 (thicker for presence)
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX + 6) * u, (baseY + 2) * u, 2 * u, 14 * u); // tall right part (2px for exact match)
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 5) * u, (baseY + 7) * u, 2 * u, 3 * u); // middle prong
  ctx.fillRect((baseX + 5) * u, (baseY + 9) * u, 2 * u, 3 * u);
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 4) * u, (baseY + 11) * u, 3 * u, 2 * u); // lower prong
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX + 5) * u, (baseY + 12) * u, 2 * u, 3 * u);
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX + 3) * u, (baseY + 14) * u, 2 * u, 4 * u); // bottom
  ctx.fillRect((baseX + 4) * u, (baseY + 16) * u, 2 * u, 2 * u);

  // === LEGS (skin thighs visible, grey boots together underneath, exact to ref) ===
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX + 1) * u, (baseY + 11) * u, 3 * u, 5 * u); // thighs skin (under short costume)
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX ) * u, (baseY + 16) * u, 4 * u, 5 * u); // boots
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX ) * u, (baseY + 16) * u, 1 * u, 5 * u); // left edge
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 3) * u, (baseY + 16) * u, 1 * u, 4 * u); // right volume
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX ) * u, (baseY + 19) * u, 4 * u, 2 * u); // foot bottom

  // === TORSO (dark grey costume body, exact proportions + belt/waist from ref) ===
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX ) * u, (baseY + 5) * u, 4 * u, 7 * u); // narrower for ref
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX ) * u, (baseY + 9) * u, 4 * u, 1 * u); // belt
  ctx.fillStyle = waistDetail;
  ctx.fillRect((baseX + 1) * u, (baseY + 10) * u, 2 * u, 1 * u); // small accent (purple in ref)
  ctx.fillStyle = greyLight;
  ctx.fillRect((baseX + 3) * u, (baseY + 5) * u, 1 * u, 4 * u); // edge
  ctx.fillStyle = greyMid;
  ctx.fillRect((baseX + 3) * u, (baseY + 5) * u, 1 * u, 7 * u); // side layer for grey costume depth like ref

  // === HEAD (small, light top, skin, black bar eye, exact to ref) ===
  ctx.fillStyle = swordTan;
  ctx.fillRect((baseX ) * u, (baseY + 1) * u, 4 * u, 2 * u); // light hair/cap top (narrower)
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX + 1) * u, (baseY + 3) * u, 3 * u, 3 * u); // face
  ctx.fillStyle = blackDetail;
  ctx.fillRect((baseX + 1) * u, (baseY + 4) * u, 2 * u, 1 * u); // black eye/mask bar
  ctx.fillStyle = bodyDark;
  ctx.fillRect((baseX + 1) * u, (baseY + 6) * u, 2 * u, 1 * u); // neck join

  // === ARM + HAND (skin, raised on left/front holding sword at rib level, exact) ===
  ctx.fillStyle = skinTone;
  ctx.fillRect((baseX ) * u, (baseY + 6) * u, 2 * u, 3 * u); // upper arm
  ctx.fillRect((baseX - 2) * u, (baseY + 3) * u, 2 * u, 4 * u); // forearm up
  ctx.fillRect((baseX - 2) * u, (baseY + 7) * u, 2 * u, 2 * u); // hand at sword base (rib height)

  // === SWORD (light tan vertical upward on left, thick, from high above head to hand, exact to ref) ===
  ctx.fillStyle = swordTan;
  ctx.fillRect((baseX - 3) * u, (baseY - 1) * u, 2 * u, 10 * u); // main blade (further left, starts higher)
  ctx.fillRect((baseX - 2) * u, (baseY + 0) * u, 1 * u, 8 * u); // thickness
  ctx.fillStyle = greyDark;
  ctx.fillRect((baseX - 3) * u, (baseY + 8) * u, 2 * u, 1 * u); // subtle base/hilt near hand

  // === Final retro outlines / definition (thin dark edges for readability, matching ref crispness) ===
  ctx.fillStyle = '#111';
  ctx.fillRect((baseX - 1) * u, (baseY + 2) * u, 1 * u, 6 * u); // head left
  ctx.fillRect((baseX - 1) * u, (baseY + 7) * u, 1 * u, 7 * u); // torso left
  ctx.fillRect((baseX - 1) * u, (baseY + 13) * u, 1 * u, 9 * u); // leg left
  ctx.fillRect((baseX - 4) * u, (baseY + 0) * u, 1 * u, 11 * u); // sword left edge
}

function drawSuzerainExact(ctx, baseX, baseY, u, seed, palette) {
  const s = seed || 0;
  const v = Math.floor(s * 1000) % 4; // color variations for rerolls while keeping exact layout

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
  ctx.fillRect((baseX + 1) * u, (baseY + 3) * u, 4 * u, 4 * u); // head width reduced (was 5), y+2 moved down w/ body
  ctx.fillStyle = helmDark;
  ctx.fillRect((baseX + 1) * u, (baseY + 3) * u, 1 * u, 4 * u); // vertical left-biased (facing left)
  ctx.fillRect((baseX + 1) * u, (baseY + 4) * u, 2 * u, 1 * u); // horiz crossbar left side

  // === NECK / UPPER TORSO JOIN (body moved down) ===
  ctx.fillStyle = armorDark;
  ctx.fillRect((baseX + 2) * u, (baseY + 7) * u, 2 * u, 1 * u);

  // === TORSO ARMOR (slightly expanded shoulder width at upper; main body wider w=5 for shoulders; y+2) ===
  ctx.fillStyle = armorDark;
  ctx.fillRect((baseX + 0) * u, (baseY + 8) * u, 5 * u, 3 * u); // w=5 for expanded shoulder width (was 4), start shifted for center
  ctx.fillStyle = belt;
  ctx.fillRect((baseX + 0) * u, (baseY + 10) * u, 5 * u, 1 * u); // belt (wider)
  ctx.fillStyle = armorLight;
  ctx.fillRect((baseX + 0) * u, (baseY + 11) * u, 3 * u, 1 * u); // lower plate accent

  // === RED CAPE (separated from body +1-2px gap; flows to bottom right via right-shifted lower segments; y+2 with body) ===
  ctx.fillStyle = capeRed;
  ctx.fillRect((baseX + 6) * u, (baseY + 5) * u, 1 * u, 5 * u); // upper (gap from body at x+5)
  ctx.fillRect((baseX + 5) * u, (baseY + 9) * u, 2 * u, 3 * u); // mid
  ctx.fillRect((baseX + 6) * u, (baseY + 11) * u, 2 * u, 6 * u); // lower shifted right, longer flow to bottom right (detached)

  // === LEFT HAND/ARM (grip; y moved with body) ===
  ctx.fillStyle = skin;
  ctx.fillRect((baseX - 1) * u, (baseY + 8) * u, 1 * u, 2 * u); // arm
  ctx.fillRect((baseX - 2) * u, (baseY + 8) * u, 2 * u, 2 * u); // hand grip (right of sword)

  // === SWORD (longer/taller look: body+2 down makes it protrude more above head; h+1, start higher rel) ===
  ctx.fillStyle = swordDark;
  ctx.fillRect((baseX - 4) * u, (baseY - 2) * u, 2 * u, 15 * u); // start higher (y-2), h=15 for longer sword
  ctx.fillRect((baseX - 4) * u, (baseY + 11) * u, 2 * u, 2 * u); // hilt (moved w/ grip hand)

  // === RIGHT HAND AT SIDE (second set; y+2, x adjusted for wider shoulder) ===
  ctx.fillStyle = skin;
  ctx.fillRect((baseX + 4) * u, (baseY + 10) * u, 2 * u, 2 * u); // right hand at side (gap to cape)

  // === LEGS / GREAVES (y+2 for body down; keep taller h, shorter than Mortacia) ===
  ctx.fillStyle = armorLight;
  ctx.fillRect((baseX + 1) * u, (baseY + 11) * u, 3 * u, 8 * u); // greaves (y+2)
  ctx.fillStyle = helmDark;
  ctx.fillRect((baseX + 1) * u, (baseY + 12) * u, 3 * u, 1 * u); // band
  ctx.fillRect((baseX + 1) * u, (baseY + 16) * u, 3 * u, 1 * u); // ankle band
  ctx.fillStyle = footDark;
  ctx.fillRect((baseX + 0) * u, (baseY + 18) * u, 4 * u, 2 * u); // feet (y+2)

  // === Crisp outlines (all y/x adjusted for head narrow, body down, cape separate, sword longer) ===
  ctx.fillStyle = '#111';
  ctx.fillRect((baseX - 1) * u, (baseY + 3) * u, 1 * u, 4 * u); // helm left
  ctx.fillRect((baseX + 5) * u, (baseY + 8) * u, 1 * u, 4 * u); // torso right (w=5)
  ctx.fillRect((baseX + 0) * u, (baseY + 11) * u, 1 * u, 10 * u); // leg/greave left
  ctx.fillRect((baseX - 4) * u, (baseY - 2) * u, 1 * u, 15 * u); // sword left
  ctx.fillRect((baseX + 7) * u, (baseY + 5) * u, 1 * u, 13 * u); // cape right edge (further for separation + flow)
}

// Main drawing routine that builds the sprite into a canvas using our prefab catalog.
// Returns the raw canvas (96x96). This is the best form for Phaser (addCanvas + NEAREST).
// generateCharacterSprite (below) wraps it for dataUrl compat (review menu, server, <img> tags).
function createCharacterSpriteCanvas(character, spriteSpec = null) {
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
  const isMortacia = (name || '').toLowerCase().includes('mortacia') || c.includes('goddess') || c.includes('necromancer');
  const isSuzerain = (name || '').toLowerCase().includes('suzerain');

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
    headType = 'gallant_helm';
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
    torsoType = (mod2 % 2 === 0 ? 'bone_corset' : 'cinched_corset');
    legsType = (mod % 2 === 0 ? 'long_striders' : 'flowing_skirt');
    weaponType = 'sword_broad';  // she uses a sword mostly (per latest ref image + "Mortacia ... she uses a sword mostly")
    accType = 'skeletal_wings';
  }
  if ((name || '').toLowerCase().includes('suzerain')) {
    torsoType = 'gallant_plate';  // fresh gallant full plate per ref image (straps/segments for heroic knight armor)
    legsType = 'armored_greaves';
    weaponType = 'sword_broad';
    accType = 'flowing_cape';
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
  if (isMortacia) {
    charPose = 'attack_slash_female';
  }

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
  if (isMortacia) {
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
    drawMortaciaExact(ctx, 8, 2, u, seed, palette); // adjusted base for better center match to how ref sits when body column plumb at canvas center, room for right wing
  } else if (isSuzerain) {
    // EXACT replication of the reference image for Suzerain ("[Image #1] no like this" + prior refs).
    // Draws pixel-for-pixel match using the same 24-grid: distinctive light helm + dark cross/visor emblem, skin hands at each side (left gripping upright sword at ~rib, right empty at side), red cape prominent flowing on back/right with stepped lower, dark upright sword vertical left from above head to hand, dark armor torso + light lower plate/belt, light greaves + dark bands + dark feet.
    // Bypasses general prefabs/poses/design for locked identical layout every time. ONLY colors vary (seed % 4) for "similar result every time with color variations".
    // baseX/baseY + internal rects meticulously adjusted to center core plumb + match latest ref grid exactly.
    drawSuzerainExact(ctx, 10, 2, u, seed, palette); // head w-15% (4px), shoulder expanded w=5, body y+2 (sword protrudes longer/taller above), cape separated + flows bottom-right; core ~13 centered; left visor; left sword/right cape; 2 hands; still slightly shorter than Mortacia.
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
  if (name.toLowerCase().includes('mortacia')) {
    head = 'human_hair';  // bigger head, feminine hair, simple cap line (single line detail) per latest ref image
  }
  if (name.toLowerCase().includes('suzerain')) {
    head = 'gallant_helm';
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
  // occasional skeletal wings for variety on rerolls for goddess/necromancer (Mortacia)
  if ((c.includes('necromancer') || c.includes('goddess')) && seedMod2 === 0) accessory = 'skeletal_wings';
  // Force iconic for Mortacia (always grey dragon wings on right back, slender tall, long hair implied via head/hair draws) and Suzerain (cool plumed helmet + sword)
  if (name.toLowerCase().includes('mortacia')) {
    head = 'human_hair';  // bigger head, feminine hair, simple cap line (single line detail) per latest ref image
    torso = (seedMod2 % 2 === 0 ? 'bone_corset' : 'cinched_corset');
    legs = (seedMod % 2 === 0 ? 'long_striders' : 'flowing_skirt');
    weapon = 'sword_broad';  // she uses a sword mostly
    accessory = 'skeletal_wings';
  }
  if (name.toLowerCase().includes('suzerain')) {
    // fresh gallant knight per ref image (helm, cape, sword, armor) - old shapes now monster templates
    head = 'gallant_helm';
    torso = 'gallant_plate';
    legs = 'armored_greaves';
    weapon = 'sword_broad';
    accessory = 'flowing_cape';
  }
  // ensure gallant suzerain cape is flowing
  if (name.toLowerCase().includes('suzerain') && accessory === 'flowing_cape') {
    // will use high in design below
  }

  // Pose offsets for Epyx counter-pose (arm vs legs). Seed gives reroll variety.
  let legSpread = isFemale ? 1 : 0;
  let armSwing = c.includes('knight') ? (seedMod % 3 - 1) : (seedMod % 2 ? 0 : -1);
  if (name.toLowerCase().includes('mortacia')) armSwing = -3; // bias for rib-level hand hold (higher arm, hand at ribs for upward sword)
  let weaponH = (weapon.includes('scythe') ? 11 : 9);
  if (c.includes('knight')) weaponH = 8;
  if (c.includes('necromancer') || c.includes('goddess')) weaponH = 9;  // sword for Mortacia is shorter than old scythe
  if (name.toLowerCase().includes('mortacia')) weaponH = 8; // sword mostly, raised pose

  // Dozens of poses, sex affects choice and design (female thinner/more beautiful)
  const malePoses = ['idle_stand_male', 'striding_walk_male', 'run_dash_male', 'attack_thrust_male', 'attack_overhead_male', 'kneel_ready_male', 'bow_shot_male'];
  const femalePoses = ['idle_stand_female', 'striding_elegant_female', 'run_graceful_female', 'cast_spell_female', 'attack_slash_female', 'kneel_graceful_female', 'dance_pose_female'];
  let chosenPose = isFemale ? femalePoses[seedMod % femalePoses.length] : malePoses[seedMod % malePoses.length];
  if (c.includes('necromancer') || c.includes('goddess')) chosenPose = isFemale ? 'cast_spell_female' : 'attack_overhead_male';
  // Iconic poses for starters
  if (name.toLowerCase().includes('mortacia')) chosenPose = 'attack_slash_female';  // dynamic raised sword for pulpy goddess look (sword mostly)
  if (name.toLowerCase().includes('suzerain')) chosenPose = 'attack_overhead_male'; // gallant raised sword pose emulating ref image knight (heroic, not just walk)

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
  if (name.toLowerCase().includes('mortacia')) {
    pLegH = 13; pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.70)); pLegW = Math.max(2, Math.floor(pLegW * 0.75)); pHeadW = Math.max(3, Math.floor(pHeadW * 0.8) + 1); pHeadH = Math.max(3, Math.floor(pHeadH * 0.8) + 1); // reduce 20% +1 for face wider/longer, thinner latest
  }
  if (name.toLowerCase().includes('suzerain')) {
    pTorsoW = Math.max(4, pTorsoW + 1); // gallant sturdy
  }
  pLegSpread = Math.min(2, legSpread + (seedMod % 2));
  pArmOffsetY = Math.max(-1, Math.min(1, armSwing + (seedMod % 3 - 1)));

  // Female: thinner and more beautiful (changes prefabs/drawing scales)
  if (isFemale) {
    pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.82));
    pLegW = Math.max(2, Math.floor(pLegW * 0.88));
    pHeadW = Math.max(3, Math.floor(pHeadW * 0.9));
  }
  // Mortacia tall slender goddess bias in deterministic design too (pulpy form per ref)
  if (name.toLowerCase().includes('mortacia')) {
    pTorsoW = Math.max(3, Math.floor(pTorsoW * 0.70)); // thinner per latest ref
    pLegW = Math.max(2, Math.floor(pLegW * 0.75));
    pHeadW = Math.max(3, Math.floor(pHeadW * 0.8) + 1);
    pHeadH = Math.max(3, Math.floor(pHeadH * 0.8) + 1); // reduce 20% +1 pixel wider/longer for face
    pLegH = Math.min(13, pLegH + 2);
  }
  if (name.toLowerCase().includes('suzerain')) {
    pTorsoW = Math.max(4, pTorsoW + 1); // gallant sturdy knight build per ref
    pHeadW = Math.max(4, pHeadW );
  }

  // For Mortacia: lock design numbers to the exact proportions that replicate the reference image [Image #2]
  // (small head, narrow torso to expose thighs, specific leg/arm heights, low stride for legs together, rib-level sword).
  // Combined with the exact draw path this guarantees similar result every time (shape fixed).
  if (name.toLowerCase().includes('mortacia')) {
    pHeadH = 3; pHeadW = 4;
    pTorsoH = 6; pTorsoW = 4;
    pLegH = 10; pLegW = 2;
    pArmH = 5;
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
      primary: (name.toLowerCase().includes('mortacia') ? mortPrimary : basePrimary),
      secondary: name.toLowerCase().includes('mortacia') ? mortSecondary : (isFemale ? '#8b5a2b' : '#5c4033'),
      highlight: name.toLowerCase().includes('mortacia') ? mortHighlight : (race === 'elf' ? '#aaffcc' : (c.includes('knight') ? '#ffdd66' : '#aa3333')),
      skin: name.toLowerCase().includes('mortacia') ? mortSkin : (race === 'dwarf' ? '#d2b48c' : (race === 'elf' ? '#e8d5b7' : '#e8c39e')),
      accent: name.toLowerCase().includes('mortacia') ? mortAccent : variantAccent,
      shadow: name.toLowerCase().includes('mortacia') ? mortShadow : '#22110a'
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
      crest_height: (head.includes('crest') || head.includes('skull') ? 2 : 1) + (seedMod % 2) + (name.toLowerCase().includes('suzerain') ? 1 : 0),
      crest_spikes: (head.includes('crest') || head.includes('skull') ? 3 : 2),
      torso_width: pTorsoW,
      torso_height: pTorsoH,
      robe_flare: (torso.includes('robe') || torso.includes('flowing') ? 2 : 1) + (seedMod % 2),
      fold_density: (torso.includes('robe') || torso.includes('flowing') ? 3 : 2) + (seedMod % 3 > 1 ? 1 : 0),
      leg_thickness: pLegW,
      leg_height: pLegH,
      stride_amount: legSpread,
      arm_thickness: 3,
      arm_length: pArmH,
      arm_swing: armSwing,
      weapon_length: weaponH,
      blade_size: (weapon.includes('scythe') ? 4 : 3) + (seedMod % 2),
      cape_width: (accessory === 'flowing_cape' ? 3 : 2),
      cape_flow: (name.toLowerCase().includes('suzerain') && accessory === 'flowing_cape' ? 3 : (accessory === 'flowing_cape' ? 2 : 1)) + (seedMod % 2),
      wing_bone_count: (accessory === 'skeletal_wings' ? 4 : 0) + (seedMod % 2),
      wing_length: (accessory === 'skeletal_wings' ? 2 : 0) + (seedMod % 2),
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
  const frameCanvas = createCharacterSpriteCanvas(character, spriteSpec); // one frame to get size
  const frameW = frameCanvas.width;
  const frameH = frameCanvas.height;

  const sheet = createCanvas(frameW * frameCount, frameH);
  const sheetCtx = sheet.getContext('2d');

  const baseSpec = spriteSpec || createCharacterSpriteSpec(character);
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

// Safe export
if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = {
    generateCharacterSprite,
    createCharacterSpriteCanvas,
    createCharacterSpriteSheetCanvas,
    registerAnimatedCharacterSprite,
    createCharacterSpriteSpec,
    _createCanvas: createCanvas
  };
}

if (typeof window !== 'undefined') {
  window.generateCharacterSprite = generateCharacterSprite;
  window.createCharacterSpriteCanvas = createCharacterSpriteCanvas;
  window.createCharacterSpriteSheetCanvas = createCharacterSpriteSheetCanvas;
  window.registerAnimatedCharacterSprite = registerAnimatedCharacterSprite;
  window.createCharacterSpriteSpec = createCharacterSpriteSpec;
}
