'use strict';
// Campaign Builder core (flag CAMPAIGN_BUILDER, test servers only). Pure functions over the SAME room database and
// population records the game already uses, so hand-made rooms, objects and encounters play like generated ones.
const Flags = require('./worldFlags');
const TILES = ['floor', 'wall', 'pillar', 'water', 'pit', 'stairs', 'ramp'];
const OBJECT_TYPES = ['weapon', 'armor', 'scroll', 'book', 'key', 'potion', 'treasure', 'coins', 'quest', 'container', 'lever', 'door', 'altar', 'other'];
const clamp = (v, lo, hi, d) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d;
const text = (v, max, d = '') => String(v ?? d).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// ---- objects: the game's real schema {name, type, properties:{attack, damage, ac, magic}, ...} ----
function object(o = {}) {
  const type = OBJECT_TYPES.includes(o.type) ? o.type : 'other', name = text(o.name, 80);
  if (!name) throw Error('object needs a name');
  const p = o.properties || o;
  const out = { name, type, properties: { attack: clamp(p.attack ?? p.attack_modifier, -5, 10, 0), damage: clamp(p.damage ?? p.damage_modifier, -5, 10, 0), ac: clamp(p.ac, -5, 10, 0), magic: clamp(p.magic, 0, 10, 0) },
    value: clamp(o.value, 0, 1e6, 0), description: text(o.description, 400), builder: true };
  if (type === 'book' || type === 'scroll') out.bookLore = o.generateOnOpen === false ? { title: text(o.title, 90, name), author: text(o.author, 60, 'Anonymous'), published: text(o.published, 40),
    chapters: (o.chapters || []).slice(0, 20).map((c, i) => ({ n: i + 1, title: text(c.title, 80, `Chapter ${i + 1}`), text: text(c.text, 6000) || null })) } : { pending: true };
  if (type === 'container') out.contents = (o.contents || []).map(object);
  if (o.unlocks) out.unlocks = { coordinates: text(o.unlocks.coordinates, 20), direction: text(o.unlocks.direction, 12) };
  return out;
}
function placeObject(db, key, o, { position } = {}) {
  const room = db[key] ||= { name: 'Unnamed Room', exits: {}, objects: [] }; room.objects ||= [];
  const obj = object(o); if (position) obj.position = { x: clamp(position.x, 0, 200, 1), y: clamp(position.y, 0, 200, 1) };
  room.objects.push(obj); return obj;
}
// Inventory lives in the console's "Inventory:" line; add there so take/equip/use run the normal paths.
function giveToParty(consoleText, name) {
  const re = /^([ \t]*Inventory:[ \t]*)([^\r\n]*)$/m, m = re.exec(consoleText);
  if (!m) return consoleText + `\nInventory: ${name}`;
  const list = m[2].trim() && !/^(none|empty)$/i.test(m[2].trim()) ? m[2].split(',').map(s => s.trim()).filter(Boolean) : [];
  return consoleText.replace(re, `${m[1]}${[...list, name].join(', ')}`);
}
function duplicateObject(db, key, index) { const o = db[key]?.objects?.[index]; if (!o) throw Error('no object'); const c = JSON.parse(JSON.stringify(o)); c.name += ' (copy)'; db[key].objects.push(c); return c; }
function deleteObject(db, key, index) { const list = db[key]?.objects || []; if (!list[index]) throw Error('no object'); return list.splice(index, 1)[0]; }

// ---- encounters: injected into the room's real population record (roomPopulation / hostilePursuit shape) ----
const SURPRISE = ['default', 'force', 'never'];
function monster(m = {}) {
  const name = text(m.name, 60); if (!name) throw Error('monster needs a name');
  const level = clamp(m.level, 1, 30, 1), hp = clamp(m.hp, 1, 999, 6 + level * 4), ac = clamp(m.ac, 0, 30, 10 + Math.floor(level / 3));
  return { name, race: text(m.race, 40, 'Monster'), level, hp, ac, attacks: (m.attacks || [{ name: 'Claw', damage: '1d6' }]).slice(0, 4).map(a => ({ name: text(a.name, 30), damage: text(a.damage, 12, '1d6') })),
    abilities: (m.abilities || []).slice(0, 6).map(a => text(a, 60)), loot: (m.loot || []).map(object), allegiance: ['Hostile', 'Neutral', 'Friendly'].includes(m.disposition) ? m.disposition : 'Hostile',
    spriteParts: m.spriteParts || null, weapon: text(m.weapon, 40) || null };
}
function encounter(e = {}) {
  const members = (e.monsters || []).map(monster); if (!members.length) throw Error('encounter needs monsters');
  const count = clamp(e.groupSize, 1, 12, members.length), list = Array.from({ length: count }, (_, i) => ({ ...members[i % members.length], name: count > members.length ? `${members[i % members.length].name} ${i + 1}` : members[i].name }));
  const trigger = ['enter', 'timer', 'turns', 'quest', 'interaction'].includes(e.trigger?.kind) ? e.trigger : { kind: 'enter' };
  return { id: text(e.id, 40) || `enc-${Date.now().toString(36)}`, members: list, positions: e.positions || [], trigger, surprise: SURPRISE.includes(e.surprise) ? e.surprise : 'default',
    waves: (e.waves || []).slice(0, 4).map(w => ({ after: clamp(w.after, 1, 50, 3), monsters: (w.monsters || []).map(monster) })), boss: e.boss ? monster(e.boss) : null };
}
// ambush semantics match retort/surprise.js: forced => armed party surprise (first turn only); never => non-null, no roll.
function ambushFor(mode) { return mode === 'force' ? { version: Flags.VERSION, chance: 100, roll: 1, party: true, forced: true } : mode === 'never' ? { version: Flags.VERSION, chance: 0, roll: 100, party: false, forced: true } : undefined; }
function injectEncounter(population, enc, freeTiles) {
  population.actors ||= {}; population.groups ||= [];
  enc.members.forEach((m, i) => { const pos = enc.positions[i] || freeTiles[i % Math.max(1, freeTiles.length)] || { x: 2 + i, y: 2 };
    population.actors[m.name] = { name: m.name, race: m.race, allegiance: m.allegiance, state: m.allegiance, status: 'present', position: { x: pos.x, y: pos.y }, home: { x: pos.x, y: pos.y },
      hp: m.hp, sheet: { name: m.name, hp: m.hp, maxHp: m.hp, ac: m.ac, level: m.level, attacks: m.attacks, abilities: m.abilities, ...(m.weapon ? { equipped: { Weapon: m.weapon } } : {}) }, ...(m.weapon ? { equipped: { Weapon: m.weapon } } : {}), dialogue: [], dialogueIndex: 0, encounterId: enc.id, loot: m.loot, builder: true, discoveryState: 'placed' }; });
  const group = { id: enc.id, members: enc.members.map(m => m.name), site: enc.members[0] && population.actors[enc.members[0].name].position, status: enc.trigger.kind === 'enter' ? 'unseen' : 'dormant', introPlayed: true, discoveryState: 'placed', builder: { trigger: enc.trigger, waves: enc.waves, boss: enc.boss } };
  const a = ambushFor(enc.surprise); if (a) group.ambush = a;
  population.groups = population.groups.filter(g => g.id !== enc.id).concat(group); population.revision = (population.revision || 0) + 1;
  return group;
}

// ---- hand-made rooms: grid -> the same dungeon schema the renderer and simulation read ----
function handRoom(spec = {}) {
  const w = clamp(spec.width, 5, 96, 15), h = clamp(spec.height, 5, 96, 15), cells = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = spec.cells?.[`${x},${y}`] || {}, edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    const tile = TILES.includes(c.tile) ? c.tile : edge ? 'wall' : 'floor';
    cells[`${x},${y}`] = { tile: tile === 'pillar' ? 'wall' : tile === 'water' || tile === 'pit' || tile === 'stairs' || tile === 'ramp' ? 'floor' : tile, kind: tile,
      floorHeight: clamp(c.floorHeight, -4, 8, tile === 'pit' ? -2 : 0), ceilHeight: clamp(c.ceilHeight, 1, 16, 4), material: text(c.material, 30) || undefined };
  }
  const exits = (spec.exits || []).filter(e => /^(north|south|east|west|up|down|portal)$/.test(e.direction)).map(e => ({ direction: e.direction, kind: ['door', 'gate', 'portal', 'opening'].includes(e.kind) ? e.kind : 'opening', to: text(e.to, 20) }));
  const start = spec.start && cells[`${spec.start.x},${spec.start.y}`]?.tile === 'floor' ? spec.start : { x: Math.floor(w / 2), y: h - 2 };
  return { layout: { width: w, height: h }, cells, start, roof: spec.roof !== false, lights: (spec.lights || []).slice(0, 24).map(l => ({ x: clamp(l.x, 0, w, 1), y: clamp(l.y, 0, h, 1), color: text(l.color, 9, '#ffcc77'), radius: clamp(l.radius, 1, 20, 5) })),
    walls: spec.walls || {}, exits, classification: { biome: text(spec.biome, 30, 'temple'), indoor: spec.roof !== false }, archTheme: text(spec.theme, 30) || null, builder: { mode: 'hand' } };
}
function installRoom(db, key, spec) {
  const room = db[key] ||= { exits: {}, objects: [] };
  Object.assign(room, { name: text(spec.name, 80, 'Hand-built Room'), description: text(spec.description, 2000), localHistory: text(spec.history, 2000),
    exits: Object.fromEntries(handRoom(spec).exits.map(e => [e.direction, e.to || true])), builderDungeon: handRoom(spec), builderMode: 'hand',
    murals: (spec.murals || []).map(m => ({ title: text(m.title, 80), text: text(m.text, 600) })) });
  return room;
}
function roomModes(db) { return Object.fromEntries(Object.entries(db).map(([k, r]) => [k, r.builderMode || (r.builderAssisted ? 'assisted' : 'generated')])); }

// ---- worlds: save/load JSON; "Play this world" seeds a normal campaign and AI fills only unbuilt rooms ----
function world(spec = {}) { return { version: 1, name: text(spec.name, 80, 'Untitled World'), extent: { depth: clamp(spec.extent?.depth, 1, 20, 6), width: clamp(spec.extent?.width, 3, 40, 9) },
  start: spec.start || '0,0,0', cities: (spec.cities || []).map(c => ({ name: text(c.name, 60), site: text(c.site, 20), role: text(c.role, 20, 'market') })), biomes: spec.biomes || {}, rooms: spec.rooms || {}, setting: spec.setting || null }; }
const save = w => JSON.stringify(world(w));
const load = json => world(JSON.parse(json));
function seedCampaign(db, w) { for (const [k, spec] of Object.entries(w.rooms)) installRoom(db, k, spec); db['0,0,0'] ||= {}; db['0,0,0'].builderWorld = { name: w.name, start: w.start, cities: w.cities, built: Object.keys(w.rooms) }; return db; }
const isBuilt = (db, key) => !!db[key]?.builderMode;

// ---- undo/redo over JSON snapshots ----
function history(limit = 50) { const past = [], future = []; return { push: s => { past.push(JSON.stringify(s)); if (past.length > limit) past.shift(); future.length = 0; },
  undo: cur => past.length ? (future.push(JSON.stringify(cur)), JSON.parse(past.pop())) : cur, redo: cur => future.length ? (past.push(JSON.stringify(cur)), JSON.parse(future.pop())) : cur, size: () => [past.length, future.length] }; }

// ---- homebrew settings: Children of the Grave terms must not leak into a homebrew world ----
const COTG_TERMS = ['Mortacia', 'Suzerain', 'Tartarus', 'Hades', 'Children of the Grave', 'Dantuea', 'Arithus', 'Atinus', 'Dyanetzia', 'Ronalde', 'Earthdragon', 'Surface Reckoning', '\\bS\\.R\\.'];
// Player-provided text (main character, party names, character-creation names, the player's own prompt/instructions) is NEVER linted:
// the player may call their character anything, including a Children of the Grave name. Only AI-generated homebrew content is checked.
const PLAYER_KEYS = new Set(['mainCharacter', 'seed', 'prompt', 'gamePrompt', 'instructions', 'party', 'partyNames', 'playerNames', 'customNames', 'pc', 'character', 'npcs']);
function lintGenerated(obj) { if (!obj || typeof obj !== 'object') return lint(obj); return lint(JSON.stringify(obj, (k, v) => PLAYER_KEYS.has(k) ? undefined : v)); }
// Terms the player has used in their own names: these are exempt from translation/renaming in model requests.
const playerSources = new Map();
function setPlayerText(source, text) { const s = (Array.isArray(text) ? text : [text]).filter(Boolean).map(String).join(' '); if (s) playerSources.set(source, s); else playerSources.delete(source); }
function playerTerms() { return lint([...playerSources.values()].join(' ')); }
function lint(textOrObj) { const s = typeof textOrObj === 'string' ? textOrObj : JSON.stringify(textOrObj); return COTG_TERMS.filter(t => new RegExp(t.startsWith('\\') ? t : `\\b${t}\\b`, 'i').test(s)); }

module.exports = { TILES, OBJECT_TYPES, object, placeObject, giveToParty, duplicateObject, deleteObject, monster, encounter, ambushFor, injectEncounter,
  handRoom, installRoom, roomModes, world, save, load, seedCampaign, isBuilt, history, lint, lintGenerated, setPlayerText, playerTerms, PLAYER_KEYS, COTG_TERMS };
