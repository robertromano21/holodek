'use strict';

const Inhabitants = require('../assets/dungeonInhabitants');

function monsterBody(value) {
  const text = String(value || '');
  const section = text.match(Inhabitants.sectionPattern('Monsters in Room'));
  return (section ? section[2] : text).trim() || 'None';
}

function uniqueMonsterBlock(value) {
  const block = monsterBody(value), sheets = Inhabitants.parseBlocks(block);
  const names = new Set();
  const unique = sheets.filter(actor => {
    const name = actor.name.trim().toLowerCase();
    if (names.has(name)) return false;
    names.add(name);
    return true;
  });
  if (unique.length === sheets.length) return block;
  const eol = block.includes('\r\n') ? '\r\n' : '\n', lines = block.split(/\r?\n/);
  return unique.map(actor => {
    // Keep the first (newly synchronized) sheet, including its original legacy field spacing.
    let first = actor.magicIndex, remaining = 13;
    while (first > 0 && remaining) if (lines[--first].trim()) remaining--;
    return lines.slice(first, (actor.stateIndex ?? actor.magicIndex) + 1).join(eol);
  }).join(eol);
}

function dedupeConsole(value) {
  return String(value || '').replace(Inhabitants.sectionPattern('Monsters in Room'), (match, header, block) => {
    const unique = uniqueMonsterBlock(block);
    if (unique === block.trim()) return match;
    const eol = block.includes('\r\n') ? '\r\n' : '\n';
    return header + (block.startsWith(eol) ? eol : ' ') + unique + (block.endsWith(eol) ? eol : '');
  });
}

function syncConsole(value, monsters) {
  const source = String(value || '');
  if (!monsters || typeof monsters.inRoom !== 'string') return { consoleText: dedupeConsole(source), monsters };
  const stored = monsterBody(monsters.inRoom);
  const fullBlock = !/^none$/i.test(stored) && !Inhabitants.parseBlocks(stored).length &&
    Inhabitants.parseBlocks(monsterBody(monsters.consoleBlock)).length ? monsters.consoleBlock : stored;
  const block = uniqueMonsterBlock(fullBlock), eol = source.includes('\r\n') ? '\r\n' : '\n';
  const formatted = block.replace(/\r?\n/g, eol);
  // Replace the complete multiline section, not just its header/name line.
  let consoleText = source.replace(Inhabitants.sectionPattern('Monsters in Room'), (match, header, old) =>
    header + (old.startsWith(eol) ? eol : ' ') + formatted + (old.endsWith(eol) ? eol : ''));
  const next = { ...monsters, inRoom: block, consoleBlock: block };
  for (const [label, field] of [['Monsters Equipped Properties', 'equippedProperties'], ['Monsters State', 'state']]) {
    if (typeof next[field] !== 'string') continue;
    consoleText = consoleText.replace(new RegExp(`^${label}:[^\\r\\n]*`, 'm'), () => `${label}: ${next[field]}`);
  }
  return { consoleText, monsters: next };
}

module.exports = { uniqueMonsterBlock, dedupeConsole, syncConsole };
