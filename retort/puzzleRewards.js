'use strict';
const { createHash } = require('node:crypto');
const field = (text, label) => String(text || '').match(new RegExp(`^${label}:[ \\t]*([^\\r\\n]*)`, 'm'))?.[1]?.trim() || '';
function identity(consoleText) {
  const description = field(consoleText, 'Puzzle in Room'), solution = field(consoleText, 'Puzzle Solution');
  if (![description, solution].every(value => value && !/^(?:none|null|undefined)$/i.test(value))) return null;
  return createHash('sha256').update(JSON.stringify([description, solution])).digest('hex');
}
function completed(room, id) { return !!id && Object.hasOwn(room?.puzzleCompletions || {}, id); }
function awards(proposed, contributors) {
  const names = [...new Set(contributors)].slice(0, 32), rows = proposed && typeof proposed === 'object' && !Array.isArray(proposed) ? proposed : {};
  return Object.fromEntries(names.map(name => {
    const value = rows[name];
    // A malformed or zero XP response must not erase a verified first-completion reward.
    return [name, Number.isInteger(value) && value > 0 ? Math.min(500, value) : 250];
  }));
}
module.exports = { identity, completed, awards };
