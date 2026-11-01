'use strict';
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto');
const directory = () => process.env.HOLODEK_SPRITE_DIR || path.join(__dirname, '../sid/sprites');
const localName = url => typeof url === 'string' ? url.match(/^\/sid\/sprites\/([A-Za-z0-9_,.-]+\.png)(?:\?[^#]*)?$/)?.[1] : null;
function spriteName(identity) {
  // Authored tile labels are not filesystem paths. Keep safe legacy names stable.
  if (typeof identity !== 'string' || !identity) throw Error('A sprite identity is required.');
  if (identity.length <= 180 && /^[a-z0-9_,.-]+$/i.test(identity) && !identity.includes('..')) return identity;
  return 'asset_' + crypto.createHash('sha256').update(identity).digest('hex');
}
function spriteFile(url, root = directory()) {
  const name = localName(url);
  if (!name) return null;
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || path.dirname(fs.realpathSync(file)) !== fs.realpathSync(root)) throw Error('Unsafe room sprite path.');
  return file;
}
function missing(dungeon, root = directory()) {
  return Object.entries(dungeon?.tiles || {}).filter(([, tile]) => localName(tile?.url) && !spriteFile(tile.url, root)).map(([name]) => name);
}
function inline(dungeon, root = directory()) {
  const replacements = [], cache = new Map();
  let total = 0;
  for (const tile of Object.values(dungeon?.tiles || {})) {
    if (!localName(tile?.url)) continue;
    if (!cache.has(tile.url)) {
      const file = spriteFile(tile.url, root);
      if (!file) throw Error('Generated room sprite is missing before transfer.');
      const bytes = fs.readFileSync(file);
      total += bytes.length;
      if (bytes.length > 2 * 1024 * 1024 || total > 16 * 1024 * 1024 ||
          bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid or oversized room sprite.');
      cache.set(tile.url, 'data:image/png;base64,' + bytes.toString('base64'));
    }
    replacements.push([tile, cache.get(tile.url)]);
  }
  for (const [tile, url] of replacements) tile.url = url;
  if (dungeon) stamp(dungeon);
  return { inlined: replacements.length, bytes: total };
}
function repair(dungeon, geoKey) {
  const names = missing(dungeon);
  const staleCeiling = !!require('./settingLayer').current() && dungeon?.tiles?.ceiling && dungeon.genreCeiling?.version !== 1;
  if ((!names.length && !staleCeiling) || !dungeon.sceneSpec) return { changed: 0 };
  const before = Object.fromEntries(names.map(name => [name, dungeon.tiles[name].url]));
  require('./sceneRoomBuilder').rebuildSceneGraphics(dungeon, geoKey);
  return { changed: Number(!!staleCeiling) + names.filter(name => before[name] !== dungeon.tiles[name]?.url || !!spriteFile(dungeon.tiles[name]?.url)).length,
    missing: missing(dungeon) };
}
function stamp(dungeon) {
  const descriptors = Object.entries(dungeon.tiles || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, t]) => [key, t?.url, t?.lightType, t?.spriteSpec]);
  dungeon.visualAssetStamp = crypto.createHash('sha256').update(JSON.stringify(descriptors)).digest('hex').slice(0, 16);
  return dungeon.visualAssetStamp;
}
module.exports = { inline, missing, repair, spriteFile, spriteName, stamp };
