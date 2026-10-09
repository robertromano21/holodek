'use strict';

const FIRST_ROOM_DESCRIPTION = 'You find yourself standing in the first room of the afterlife at the Ruined Temple in the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons, magical beings, angels and powerful demons.';

function buildInitialWorldConsole(state = {}) {
  const database = JSON.parse(state.roomNameDatabaseString || '{}');
  if (!database || typeof database !== 'object' || Array.isArray(database)) throw new Error('Invalid starting room database.');
  let text = String(state.updatedGameConsole || '').trim();
  // The server supplies the saved PC/party sheets separately; retain all world fields.
  const pc = text.search(/^PC:/m), monsters = text.search(/^Monsters in Room:/m);
  if (pc >= 0) text = text.slice(0, pc) + (monsters > pc ? text.slice(monsters) : '');
  const coordinates = text.match(/^Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/m);
  if (coordinates && coordinates.slice(1).some(v => Number(v) !== 0)) throw new Error('A new game must start in room 0,0,0.');
  const exits = Object.keys(database['0,0,0']?.exits || {});
  const defaults = {
    'Room Name': 'Ruined Temple Entrance', 'Room Description': FIRST_ROOM_DESCRIPTION,
    Coordinates: 'X: 0, Y: 0, Z: 0', 'Objects in Room': 'None', 'Objects in Room Properties': 'None',
    Exits: exits.length ? exits.join(', ') : 'north, down', Score: '0', 'Puzzle in Room': 'None', 'Puzzle Solution': 'None',
    'Artifacts Found': '0/15', 'Quests Achieved': '0/21', 'Next Artifact': 'None', 'Next Boss': 'None', 'Next Boss Room': 'None',
    'Current Quest': 'None', Inventory: 'Empty', 'Inventory Properties': 'None', Turns: '0',
    'Monsters in Room': 'None', 'Monsters Equipped Properties': 'None', 'Monsters State': 'None', 'Rooms Visited': '1', 'Adjacent Rooms': 'None'
  };
  for (const [label, fallback] of Object.entries(defaults)) {
    const pattern = new RegExp(`^${label}:[^\\n]*`, 'm');
    const match = text.match(pattern);
    if (!match) text += `\n${label}: ${fallback}`;
    else if (label === 'Turns' || !match[0].slice(label.length + 1).trim()) text = text.replace(pattern, `${label}: ${fallback}`);
  }
  return { console: text.trim(), roomNameDatabaseString: JSON.stringify(database) };
}

function formatStartingCharacterSheet(character = {}, indentation = 6) {
  const value = (upper, lower, fallback) => character[upper] ?? character[lower] ?? fallback;
  const equipped = character.Equipped || character.equipped || {};
  const hp = value('HP', 'hp', 0);
  // Legacy console readers expect four unlabelled identity lines, then labelled stats.
  return [
    value('Name', 'name', 'Player'), value('Sex', 'sex', 'Unknown'),
    value('Race', 'race', 'Unknown'), value('Class', 'class', 'Adventurer'),
    `Level: ${value('Level', 'level', 1)}`, `AC: ${value('AC', 'ac', 10)}`,
    `XP: ${value('XP', 'xp', 0)}`, `HP: ${hp}`, `MaxHP: ${value('MaxHP', 'maxHP', hp)}`,
    `Equipped: ${['Weapon', 'Armor', 'Shield', 'Other'].map(slot => `${slot}: ${equipped[slot] || 'None'}`).join(', ')}`,
    ...['Attack', 'Damage', 'Armor', 'Magic'].map(stat => `${stat}: ${value(stat, stat.toLowerCase(), 0)}`)
  ].map((line, index) => index ? ' '.repeat(indentation) + line : line).join('\n');
}

function buildInitialGameConsole(worldConsole, character, party = []) {
  const sheets = `PC:\n${formatStartingCharacterSheet(character)}\nNPCs in Party: ${party.length
    ? party.map(member => formatStartingCharacterSheet(member, 8)).join('\n') : 'None'}\n`;
  // Keep PC -> NPCs -> monsters in the order used by the console's section parsers.
  return worldConsole.replace(/^Monsters in Room:/m, () => sheets + 'Monsters in Room:');
}

module.exports = { buildInitialWorldConsole, formatStartingCharacterSheet, buildInitialGameConsole };
