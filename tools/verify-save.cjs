'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const Saves = require('../saveGames');
const slot = Saves.slotNumber(process.argv[2] || 1), store = Saves.createStore();
const envelope = store.read(slot), p = envelope.payload;
const roomKey = process.argv[3] || p.roomKey;
if (!/^\-?\d+,\-?\d+,\-?\d+$/.test(roomKey) || !p.server.roomDungeonDatabase[roomKey]) throw Error('Choose a room that exists in this save.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-save-verify-'));
process.env.HOLODEK_SPRITE_DIR = path.join(directory, 'sprites');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gameplay = dungeon => ({ ...dungeon, tiles: Object.fromEntries(Object.entries(dungeon.tiles || {}).map(([name, { url, ...definition }]) => [name, definition])) });
try {
  const Assets = require('../saveGameAssets'), { generateSpriteFromStyle } = require('../assets/renderSprite_poke');
  const next = Assets.rebuild(p.server, roomKey, { generateSprite: (style, type, name) => generateSpriteFromStyle(style, type, name, { directory: process.env.HOLODEK_SPRITE_DIR }) });
  if (digest(gameplay(next.roomDungeonDatabase[roomKey])) !== digest(gameplay(p.server.roomDungeonDatabase[roomKey]))) throw Error('Reconstruction changed gameplay.');
  for (const [key, dungeon] of Object.entries(next.roomDungeonDatabase)) if (key !== roomKey && digest(dungeon) !== digest(p.server.roomDungeonDatabase[key])) throw Error('Another room was rebuilt early.');
  const missing = Object.entries(next.roomDungeonDatabase[roomKey].tiles).filter(([name, tile]) => tile.url?.startsWith('/sid/sprites/') && !fs.existsSync(path.join(process.env.HOLODEK_SPRITE_DIR, path.basename(tile.url.split('?')[0])))).map(([name]) => name);
  if (missing.length) throw Error('Missing reconstructed textures: ' + missing.join(', '));
  const differences = [], compared = [];
  for (const [name, tile] of Object.entries(next.roomDungeonDatabase[roomKey].tiles)) {
    const prior = p.server.roomDungeonDatabase[roomKey].tiles[name]?.url;
    if (!tile.url?.startsWith('/sid/sprites/') || !prior?.startsWith('/sid/sprites/')) continue;
    const original = path.resolve(__dirname, '..', prior.slice(1).split('?')[0]), rebuilt = path.join(process.env.HOLODEK_SPRITE_DIR, path.basename(tile.url.split('?')[0]));
    if (!fs.existsSync(original)) continue;
    compared.push(name);
    if (!fs.readFileSync(original).equals(fs.readFileSync(rebuilt))) differences.push(name);
  }
  const song = p.server.roomMusicDatabase[roomKey]; let music = null;
  if (song) {
    const { renderArrangementToWav } = require('../retort/renderAudio');
    const result = renderArrangementToWav(song, { jsonPath: path.join(directory, 'room.json'), asmOut: path.join(directory, 'room.asm'),
      sidOut: path.join(directory, 'room.sid'), outBaseNoExt: path.join(directory, 'room'), clock: p.settings.sidMode,
      seconds: 60, renderJsPath: path.resolve(__dirname, '../assets/renderSid_poke.js'), cwd: path.resolve(__dirname, '..') });
    if (!fs.existsSync(result.wavPath)) throw Error('The saved song could not be rendered.');
    const wav = fs.readFileSync(result.wavPath);
    const wavHash = createHash('sha256').update(wav).digest('hex');
    const matchingCurrentFiles = ['A', 'B'].map(s => path.resolve(__dirname, '../sid/room_' + s + '.wav'))
      .filter(file => fs.existsSync(file) && createHash('sha256').update(fs.readFileSync(file)).digest('hex') === wavHash).map(file => path.basename(file));
    music = { title: song.title, bytes: wav.length, renderer: result.renderer,
      seconds: wav.readUInt32LE(40) / (wav.readUInt32LE(24) * wav.readUInt16LE(22) * wav.readUInt16LE(34) / 8), matchingCurrentFiles };
  }
  console.log(JSON.stringify({ verified: true, slot, checksum: envelope.checksum, label: p.label, room: JSON.parse(p.server.roomNameDatabaseString)[roomKey]?.name || roomKey, turns: p.turns,
    bytes: fs.statSync(store.file(slot)).size, history: p.browser.conversation.rows.length, rooms: Object.keys(p.server.roomDungeonDatabase).length,
    reconstructedOnly: roomKey, images: fs.readdirSync(process.env.HOLODEK_SPRITE_DIR).filter(f => f.endsWith('.png')).length,
    comparedImageTiles: compared.length, identicalImageTiles: compared.length - differences.length, differentImageTiles: differences,
    recoveredCharacterRecipes: Object.keys(Assets.characterTraits(p)).length, music, gameplayUnchanged: true, otherRoomsDeferred: true }));
} finally {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('holodek-save-verify-')) throw Error('Unsafe verification cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
