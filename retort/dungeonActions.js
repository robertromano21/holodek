const { position } = require('./dungeonReach');

function doorIntent(input) {
  if (!/\bdoor\b/i.test(input)) return null;
  if (/\b(?:how|what|why|could|would|should|can)\b.*\b(?:open|unlock|force|pick|break)\b/i.test(input) || /\b(?:don't|do not|never)\b/i.test(input)) return null;
  if (/\b(force|bash|break|kick)\b/i.test(input)) return 'force';
  if (/\b(pick|lockpick)\b/i.test(input)) return 'pick';
  if (/\b(open|unlock)\b/i.test(input)) return 'open';
  return null;
}

function prepareDoorAction({ input, dungeon, actor, geoKey, inventory = '' }) {
  const kind = doorIntent(input);
  if (!kind) return null;
  const deny = message => ({ kind, allowed: false, message });
  const p = position(actor, geoKey);
  if (!p || !dungeon?.cells) return deny('Your dungeon position is not available yet. Move into the room and try again.');
  const coordinate = /\b(\d+)\s*,\s*(\d+)\b/.exec(input);
  const nearby = [];
  const ax = Math.floor(p.x), ay = Math.floor(p.y);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const key = `${ax + dx},${ay + dy}`;
    const cell = dungeon.cells[key];
    if (cell?.tile !== 'door') continue;
    if (coordinate && key !== `${Number(coordinate[1])},${Number(coordinate[2])}`) continue;
    if (Math.abs((cell.floorHeight || 0) - (dungeon.cells[`${ax},${ay}`]?.floorHeight || 0)) > 1.5) continue;
    nearby.push({ key, cell });
  }
  if (!nearby.length) return deny('Stand beside the door first. There is no reachable dungeon door next to you.');
  if (nearby.length > 1) return deny(`Which door? Specify its tile: ${nearby.map(d => d.key).join(' or ')}.`);
  const { key, cell } = nearby[0];
  const door = cell.door || {};
  if (door.isOpen) return deny('That door is already open.');
  if (door.puzzleId || door.questLocked || door.sealed || door.requiresKey || door.keyId) return deny('This door requires its key or mechanism. A generic check cannot bypass it.');
  if (kind === 'open' && (door.locked || door.isLocked || door.barred)) return deny('The door is secured. Use its key, pick its lock, or try to force it.');
  if (kind === 'pick' && door.barred) return deny('This door is barred, not just locked. Lockpicks cannot lift the bar.');
  if (kind === 'pick' && !/\b(lockpicks?|thieves[’']? tools|thief[’']? tools)\b/i.test(inventory)) return deny('Picking the lock requires lockpicks or thieves tools in your inventory.');
  if (dungeon.actionAttempts?.[`${key}:${kind}`]) return deny('That approach has already been tried on this door. Try another method.');
  const check = kind !== 'open' && !!(door.locked || door.isLocked || door.barred);
  return {
    kind, allowed: true, key, check, difficulty: kind === 'force' ? 15 : 12,
    label: kind === 'force' ? 'Force door' : kind === 'pick' ? 'Pick lock' : 'Open door',
    success: 'The door opens. The passage is now walkable in both views.',
    failure: 'The door remains shut. This approach has failed; try another method.'
  };
}

function applyDoorAction(dungeon, plan, success) {
  if (!plan?.allowed || !dungeon.cells[plan.key] || dungeon.cells[plan.key].tile !== 'door') return null;
  const next = { ...dungeon, cells: { ...dungeon.cells }, actionAttempts: { ...dungeon.actionAttempts } };
  if (plan.check) next.actionAttempts[`${plan.key}:${plan.kind}`] = true;
  if (success) {
    const cell = dungeon.cells[plan.key];
    next.cells[plan.key] = { ...cell, door: { ...cell.door, isOpen: true, locked: false, isLocked: false, barred: false } };
  }
  return next;
}

module.exports = { doorIntent, prepareDoorAction, applyDoorAction };
