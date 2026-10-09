'use strict';

const { parseSheets } = require('../assets/partyRoster');
const { ensureBossGate, isReservedBossKeyName, bossRoomNameForTarget } = require('./bossGate');
const directions = {
  north: [0, 1, 0], south: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0],
  northeast: [1, 1, 0], northwest: [-1, 1, 0], southeast: [1, -1, 0], southwest: [-1, -1, 0],
  up: [0, 0, 1], down: [0, 0, -1]
};
const reverse = { north: 'south', south: 'north', east: 'west', west: 'east', northeast: 'southwest',
  northwest: 'southeast', southeast: 'northwest', southwest: 'northeast', up: 'down', down: 'up' };
const escapeRe = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validName = value => typeof value === 'string' && value.trim() && !/^(none|empty|undefined|null)$/i.test(value.trim());
const field = (text, label) => text.match(new RegExp(`^${escapeRe(label)}:[ \\t]*([^\\n]*)`, 'm'))?.[1]?.trim() || '';
function setField(text, label, value) {
  const pattern = new RegExp(`^${escapeRe(label)}:[^\\n]*`, 'm');
  const line = `${label}: ${value}`;
  return pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
}
const list = text => String(text).split(',').map(s => s.trim()).filter(validName);

function parseObjectProperties(text) {
  return [...String(text).matchAll(/\{[^{}]*\}/g)].map(([block]) => {
    const result = {};
    for (const match of block.matchAll(/([\w]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))/g)) {
      const value = match[2] ?? match[3] ?? match[4].trim();
      result[match[1]] = match[2] === undefined && match[3] === undefined && Number.isFinite(Number(value)) ? Number(value) : value;
    }
    return result;
  }).filter(p => validName(p.name));
}

function selectCommandedNpcs(input, names) {
  const text = String(input).toLowerCase();
  const firstNames = names.map(name => name.toLowerCase().split(/\s+/)[0]);
  return names.filter((name, index) => {
    if (new RegExp(`\\b${escapeRe(name.toLowerCase())}\\b`).test(text)) return true;
    const first = firstNames[index];
    return first.length > 2 && firstNames.filter(n => n === first).length === 1 &&
      new RegExp(`\\b${escapeRe(first)}\\b`).test(text);
  });
}

function applyAdditionalOutcomes(outcomes, consoleText, database = {}) {
  if (!outcomes || typeof outcomes !== 'object' || typeof consoleText !== 'string' || !consoleText) throw Error('Invalid adjudication state.');
  // Work on copies; validation failures must not partially mutate the active room.
  const db = JSON.parse(JSON.stringify(database));
  let text = consoleText;
  const coords = field(text, 'Coordinates').match(/^X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)$/);
  if (!coords) throw Error('Adjudication requires valid room coordinates.');
  const xyz = coords.slice(1).map(Number), key = xyz.join(',');
  const current = db[key] && typeof db[key] === 'object' ? db[key] : { name: field(text, 'Room Name'), exits: {}, objects: [] };
  db[key] = current;
  if (outcomes.new_objects !== undefined && !Array.isArray(outcomes.new_objects)) throw Error('Discovered objects must be a list.');
  const objects = list(field(text, 'Objects in Room'));
  const properties = parseObjectProperties(field(text, 'Objects in Room Properties'));
  const discoveries = [];
  for (const raw of outcomes.new_objects || []) {
    if (!validName(raw) || /[\r\n,{}]/.test(raw)) throw Error('Invalid discovered object name.');
    const name = raw.trim().toLowerCase();
    if (isReservedBossKeyName(db, name)) continue;
    if (objects.some(o => o.toLowerCase() === name)) continue;
    const source = outcomes.object_modifiers?.[raw] || outcomes.object_modifiers?.[name] || {};
    const props = { name, type: source.type || 'other' };
    if (!['weapon', 'armor', 'shield', 'other'].includes(props.type)) throw Error('Invalid discovered object type.');
    for (const stat of ['attack_modifier', 'damage_modifier', 'ac', 'magic']) {
      const number = Number(source[stat] ?? 0);
      if (!Number.isFinite(number)) throw Error('Invalid object modifier.');
      props[stat] = number;
    }
    objects.push(name); properties.push(props); discoveries.push(name);
  }
  text = setField(text, 'Objects in Room', objects.join(', ') || 'None');
  text = setField(text, 'Objects in Room Properties', properties.map(p =>
    `{name: ${JSON.stringify(p.name)}, type: ${JSON.stringify(p.type || 'other')}, attack_modifier: ${p.attack_modifier ?? 0}, damage_modifier: ${p.damage_modifier ?? 0}, ac: ${p.ac ?? 0}, magic: ${p.magic ?? 0}}`).join(', ') || 'None');
  const oldObjects = Array.isArray(current.objects) ? current.objects : [];
  current.objects = objects.map(name => {
    const old = oldObjects.find(o => String(o.name).toLowerCase() === name.toLowerCase()) || {};
    const props = properties.find(p => p.name.toLowerCase() === name.toLowerCase());
    return { ...old, name, ...(props ? { type: props.type, properties: { ...old.properties,
      attack: props.attack_modifier ?? 0, damage: props.damage_modifier ?? 0, ac: props.ac ?? 0, magic: props.magic ?? 0 } } : {}) };
  });

  const exit = String(outcomes.new_exit || '').trim().toLowerCase();
  let revealedExit = '';
  if (exit) {
    if (!Object.hasOwn(directions, exit)) throw Error('Invalid discovered exit direction.');
    const targetCoords = xyz.map((n, i) => n + directions[exit][i]), targetKey = targetCoords.join(',');
    const supplied = outcomes.coordinates_of_connected_rooms || {};
    if (['x', 'y', 'z'].some((axis, i) => supplied[axis] !== undefined && Number(supplied[axis]) !== targetCoords[i])) {
      throw Error('Discovered exit coordinates do not match its direction.');
    }
    const target = db[targetKey] && typeof db[targetKey] === 'object' ? db[targetKey] : {};
    const boundName = bossRoomNameForTarget(text, targetKey);
    const name = validName(target.name) ? target.name : boundName || (validName(outcomes.new_adjacent_room?.name)
      ? outcomes.new_adjacent_room.name.trim() : `Room ${targetKey}`);
    db[targetKey] = { ...target, name, objects: target.objects || [], exits: { ...target.exits } };
    current.exits = { ...current.exits };
    // Revealing an exit must not silently unlock an existing locked exit.
    current.exits[exit] = current.exits[exit] || { status: 'open', targetCoordinates: targetKey, key: null };
    db[targetKey].exits[reverse[exit]] = db[targetKey].exits[reverse[exit]] || { status: 'open', targetCoordinates: key, key: null };
    const exits = list(field(text, 'Exits'));
    if (!exits.includes(exit)) { exits.push(exit); revealedExit = exit; }
    text = setField(text, 'Exits', exits.join(', '));
    const adjacent = list(field(text, 'Adjacent Rooms')).filter(entry => !entry.startsWith(`${exit}:`));
    adjacent.push(`${exit}: ${name}`);
    text = setField(text, 'Adjacent Rooms', adjacent.join(', '));
    const connected = field(text, 'Coordinates of Connected Rooms').split(';').map(s => s.trim()).filter(validName);
    if (!connected.includes(targetKey)) connected.push(targetKey);
    text = setField(text, 'Coordinates of Connected Rooms', connected.join('; '));
  }

  // Newly revealed boss approaches must use the same locks as all existing entries.
  ensureBossGate(db, text);

  const appliedXp = {}, appliedDamage = {};
  const sheets = [...parseSheets(text.match(/PC:([\s\S]*?)(?=NPCs in Party:|$)/)?.[1], 'pc'),
    ...parseSheets(text.match(/NPCs in Party:([\s\S]*?)(?=Monsters in Room:|$)/)?.[1], 'npc')];
  const eligible = new Set(sheets.filter(s => s.hp > 0).map(s => s.name.toLowerCase()));
  for (const [property, stat, operation, applied] of [
    ['xp_awarded', 'XP', (a, b) => a + b, appliedXp], ['trap_damage', 'HP', (a, b) => Math.max(0, a - b), appliedDamage]
  ]) {
    for (const [name, raw] of Object.entries(outcomes[property] || {})) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) throw Error(`Invalid ${property} amount.`);
      if (!eligible.has(name.toLowerCase())) continue;
      // Names can also occur in prose/items. Only character-sheet identity lines may receive stats.
      const pattern = new RegExp(`(^[ \\t]*(?:PC:[ \\t]*|NPCs in Party:[ \\t]*|Name:[ \\t]*)?${escapeRe(name)}[ \\t]*\\r?\\n[\\s\\S]*?\\n[ \\t]*${stat}:[ \\t]*)(-?\\d+)`, 'mi');
      text = text.replace(pattern, (match, prefix, value) => {
        applied[name] = amount;
        return prefix + operation(Number(value), amount);
      });
    }
  }
  return { console: text, database: db, roomKey: key, discoveries, exit: revealedExit, xp: appliedXp, damage: appliedDamage };
}

module.exports = { applyAdditionalOutcomes, parseObjectProperties, selectCommandedNpcs };
