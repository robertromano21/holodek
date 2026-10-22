'use strict';
const C = require('./generationContracts');
const n = (minimum, maximum) => ({ type: Number, minimum, maximum });
async function generate($, { roomDesc, puzzleDesc, isOutdoor, requiredTypes = [] }) {
  const required = [...new Set(requiredTypes)], maximum = Math.max(4, required.length);
  const brief = `Author procedural obstacle scenery for this ${isOutdoor ? 'outdoor' : 'indoor'} room: ${roomDesc}. Puzzle context: ${puzzleDesc || 'none'}. Match the saved genre, materials and architecture. No new actors, items, exits or quest events. Required exact tile IDs: ${JSON.stringify(required)}. Other IDs are short snake_case nouns. Use supported drawing ops, normalized fractions for sizes, integer counts. A pillar uses column with solidBase:true; programs paint back to front. Preserve selected type IDs.`;
  async function request(parameters, arrays, suffix = '') {
    const result = await C.request($, { component: 'custom-tiles', parameters, localWork: { brief: brief + suffix, arrays } });
    if (!result.value) throw result.error || Error('Local tile chain failed.');
    return result.value;
  }
  const concepts = await request({ types: { type: [C.text(40)], minItems: Math.max(2, required.length), maxItems: maximum } },
    { types: { min: Math.max(2, required.length), max: maximum } });
  if (new Set(concepts.types).size !== concepts.types.length || concepts.types.some(id => !/^[a-z][a-z0-9_]{0,39}$/.test(id)) ||
      required.some(id => !concepts.types.includes(id))) throw Error('Custom tile concepts must have distinct slugs and include every required type.');
  const tiles = {};
  for (const id of concepts.types) {
    const tile = await request({ type: C.choice([id]), spriteSpec: {
      profile: C.choice(['flat', 'cylinder', 'slab', 'arch', 'block']), depth: n(0, 1), heightRatio: n(.4, 1.2),
      baseWidth: n(.2, 1), gridWidth: n(.2, 1), detail: {
        bandCount: n(0, 8), grooveCount: n(0, 12), grooveDepth: n(0, 1), taper: n(0, .3),
        baseHeight: n(0, .3), capHeight: n(0, .3), baseFlare: n(0, .3), capFlare: n(0, .3),
        wear: n(0, 1), chips: n(0, 1), cracks: n(0, 1), noise: n(0, 1),
        skin: C.choice(['none', 'mosaic', 'zigzag', 'circuit', 'marble', 'plaid', 'grid', 'banded', 'tiles']),
        skinStrength: n(0, 1), carving: C.choice(['none', 'chevrons', 'spiral', 'runes', 'glyphs', 'vines']),
        accentColor: { ...C.text(7), pattern: '^#[0-9a-fA-F]{6}$' }, accentStrength: n(0, 1) } },
      procedure: { material: C.choice(['stone', 'obsidian', 'ash', 'bone', 'rust', 'crystal', 'marble', 'metal', 'wood']),
        program: { type: C.list({ op: C.choice(['background', 'tile_grid', 'column', 'block', 'archway', 'spire', 'ruin_wall',
          'rubble', 'stairs', 'crystal_cluster', 'ribcage', 'totem', 'branches', 'mound', 'slabs', 'cracks', 'rim_light', 'vignette']),
          style: C.choice(['flat', 'dark_radial', 'horizon_glow']), width: n(.08, 1), height: n(.2, .98),
          count: n(2, 12), steps: n(3, 12), density: n(0, 1), strength: n(0, 1), solidBase: Boolean,
          side: C.choice(['left', 'right']), size: C.choice(['small', 'medium', 'large']),
          thickness: n(.08, .3), spread: n(0, 1), stagger: n(0, 1) }), minItems: 2, maxItems: 6 } }
    }, { program: { min: 2, max: 6, batch: 1 } }, '\nAuthor only type ' + id + '; all selected scenery IDs: ' + JSON.stringify(concepts.types));
    tiles['tile' + (Object.keys(tiles).length + 1)] = tile;
  }
  return { content: JSON.stringify({ tiles }) };
}
module.exports = { generate };
