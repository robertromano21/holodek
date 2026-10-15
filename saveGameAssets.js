'use strict';
const Shape = require('./saveGameState');

// Repaint graphics, never regenerate a layout, repopulate a room, or call the LLM.
// All doors, loot, actor positions and puzzle state remain in the checkpoint.
function rebuildRoom(dungeon, geoKey, options = {}) {
  const generateSpriteFromStyle = options.generateSprite || require('./assets/renderSprite_poke').generateSpriteFromStyle;
  const rebuildSceneGraphics = options.sceneGraphics || require('./retort/sceneRoomBuilder').rebuildSceneGraphics;
  const aliases = new Map(), first = new Map();
  for (const [name, tile] of Object.entries(dungeon.tiles || {})) if (tile.url?.startsWith('/sid/sprites/')) {
    const url = tile.url.split('?')[0];
    if (first.has(url)) aliases.set(name, first.get(url)); else first.set(url, name);
  }
  const style = dungeon.visualStyle;
  for (const [name, tile] of Object.entries(dungeon.tiles || {})) {
      if (!tile.url?.startsWith('/sid/sprites/')) continue;
      if (aliases.has(name)) continue;
      if (!style) throw Error('Saved graphics lack a drawing recipe: ' + geoKey + '/' + name);
      if (['floor', 'wall', 'door', 'torch', 'pillar'].includes(name)) {
        tile.url = generateSpriteFromStyle(name === 'floor' && style.floorPalette ? { ...style, palette: style.floorPalette } : style, name, `${geoKey}_${name}`);
      } else if (name.startsWith('custom_')) {
        const custom = dungeon.customTiles?.find((t, i) => (t.name || `custom_${t.type}_${i}`) === name);
        if (!custom) throw Error('Saved custom tile lacks a drawing recipe: ' + geoKey + '/' + name);
        tile.url = generateSpriteFromStyle({ palette: style.palette, procedure: custom.procedure || {}, spriteSpec: custom.spriteSpec }, `custom_${custom.type}`, `${geoKey}_${name}`);
      }
  }
  rebuildSceneGraphics(dungeon, geoKey);
  // Structural/carved variants often share the wall or pillar PNG but retain
  // their own voxel recipe. Repoint the image without replacing that recipe.
  for (const [name, source] of aliases) dungeon.tiles[name].url = dungeon.tiles[source].url;
  return dungeon;
}
function rebuild(server, roomKey, options) {
  const next = Shape.clone(server);
  if (!next.roomDungeonDatabase[roomKey]) throw Error('Saved room is missing.');
  rebuildRoom(next.roomDungeonDatabase[roomKey], roomKey, options);
  return next;
}
function characterTraits(payload) {
  const out = {}, seen = new Set();
  function scan(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.kind === 'procedural' && value.source === 'llm' && value.name && value.traits) {
      out[value.name.toLowerCase().trim()] = { name: value.name, traits: value.traits, stature: value.stature,
        salt: value.salt, variant: value.variant, source: 'llm', appearance: { name: value.name, sex: value.sex,
          race: value.race, class: value.class, level: value.level, isMonster: value.isMonster, role: value.role } };
      return;
    }
    for (const [key, v] of Object.entries(value)) if (!['cells', 'tiles'].includes(key)) scan(v);
  }
  // Early live-bridge saves already contain these complete recipes in their
  // actor sprites, even before the explicit trait-library field was added.
  scan(payload.server.roomPopulations); scan(payload.browser.data);
  scan(JSON.parse(payload.server.combatCharactersString));
  return { ...out, ...(payload.characterTraits || {}), ...(payload.browser.data.characterTraits || {}) };
}
module.exports = { rebuild, rebuildRoom, characterTraits };
