'use strict';

const { parseSheets } = require('../assets/partyRoster');

const MAX_CHECKS = 64;
const MAX_JSON_CHARS = 16384;
const PHASES = { hard: 'hardRequirements', action: 'actionRequirements' };
const SUPPORTED = { hard: ['at_coords', 'inventory_contains', 'monster_hp_zero'],
  action: ['exit_open', 'monster_hp_zero'] };
const SECTION = /^(?:PC|NPCs(?: in Party)?|Monsters in Room|Monsters Equipped Properties|Monsters State|Objects in Room(?: Properties)?|Rooms Visited|Inventory(?: Properties)?|Room Name|Room Description|Coordinates(?: of Connected Rooms)?|Exits|Adjacent Rooms|Score|Turns|Puzzle in Room|Puzzle Solution|Artifacts Found|Quests Achieved|Next Artifact|Next Boss(?: Room)?|Boss Room Coordinates|Current Quest|Party Status):/i;
const STAT = /^(?:Sex|Race|Class|Level|AC|XP|HP|MaxHP|Equipped|Attack|Damage|Armor|Magic):/i;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validName = value => typeof value === 'string' && value.trim().length > 0 &&
  !/[\r\n]/.test(value) && !/^(?:none|empty)$/i.test(value.trim());

// Stable, detached JSON snapshots, with explicit limits rather than silent truncation.
function snapshot(value) {
  const ancestors = new Set();
  let nodes = 0;
  function copy(v, depth) {
    if (++nodes > 1024 || depth > 12) throw new RangeError('Quest progress JSON exceeds structural limits');
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      if (v.length > MAX_JSON_CHARS) throw new RangeError('Quest progress JSON string exceeds limit');
      return v;
    }
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
    if (typeof v !== 'object' || ancestors.has(v) ||
        ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(v))) {
      throw new TypeError('Quest progress requires acyclic JSON data');
    }
    ancestors.add(v);
    const out = Array.isArray(v) ? Array.from(v, item => copy(item, depth + 1)) : {};
    if (!Array.isArray(v)) for (const key of Object.keys(v).sort()) {
      if (v[key] === undefined) continue;
      Object.defineProperty(out, key, { value: copy(v[key], depth + 1), enumerable: true,
        writable: true, configurable: true });
    }
    ancestors.delete(v);
    return out;
  }
  const out = copy(value, 0);
  if (JSON.stringify(out).length > MAX_JSON_CHARS) throw new RangeError('Quest progress JSON snapshot exceeds limit');
  return out;
}

function coordKey(value) {
  let parts;
  if (isRecord(value)) parts = [value.x, value.y, value.z];
  else if (typeof value === 'string') {
    const match = value.trim().match(/^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)$/) ||
      value.trim().match(/^(?:Coordinates:\s*)?X:\s*(-?\d+)\s*,\s*Y:\s*(-?\d+)\s*,\s*Z:\s*(-?\d+)$/i);
    if (match) parts = match.slice(1);
  }
  if (!parts || parts.some(v => !(typeof v === 'number' || typeof v === 'string' && /^-?\d+$/.test(v.trim())) ||
      !Number.isSafeInteger(Number(v)))) return null;
  return parts.map(Number).join(',');
}

function roomAt(database, key) {
  if (!isRecord(database) || !key) return null;
  const keys = Object.keys(database).filter(k => coordKey(k) === key);
  // Conflicting aliases are not a trustworthy room snapshot.
  return keys.length === 1 && isRecord(database[keys[0]]) ? database[keys[0]] : null;
}

function inventoryContains(text, item) {
  const lines = typeof text === 'string' ? [...text.matchAll(/^[ \t]*Inventory:[ \t]*([^\r\n]*)/gim)] : [];
  if (!lines.length) return { passed: null, evidence: { reason: 'missing_inventory', item } };
  const line = lines[lines.length - 1][1].trim();
  const entries = !line || /^(?:none|empty)$/i.test(line) ? [] : line.split(',').map(s => s.trim().toLowerCase());
  const present = entries.includes(item.toLowerCase());
  return { passed: present, evidence: { source: 'console.Inventory', item, present } };
}

function monsterSection(text, allowBare) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map(line => line.trim());
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/^Monsters in Room:/i.test(lines[i])) start = i;
  if (start < 0 && (!allowBare || lines.some(line => SECTION.test(line)))) return null;
  const block = start < 0 ? lines : [lines[start].replace(/^Monsters in Room:[ \t]*/i, ''), ...lines.slice(start + 1)];
  const end = block.findIndex(line => SECTION.test(line));
  return (end < 0 ? block : block.slice(0, end)).filter(Boolean);
}

function monsterHp(text, name, allowBare = false) {
  const lines = monsterSection(text, allowBare);
  if (!lines) return { hp: null, reason: 'missing_monsters_section' };
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    // Legacy sheets have name/sex/race/class followed by Level; labelled names also delimit sheets.
    if (/^Name:/i.test(lines[i]) || !STAT.test(lines[i]) &&
        lines.slice(i + 1, i + 4).length === 3 && lines.slice(i + 1, i + 4).every(s => !STAT.test(s) || /^(?:Sex|Race|Class):/i.test(s)) &&
        /^Level:/i.test(lines[i + 4] || '')) starts.push(i);
  }
  const matches = starts.filter(i => lines[i].replace(/^Name:[ \t]*/i, '').trim() === name);
  if (matches.length !== 1) return { hp: null, reason: matches.length ? 'ambiguous_monster' :
    lines.some(line => line.replace(/^Name:[ \t]*/i, '').trim() === name) ? 'invalid_monster_sheet' : 'monster_not_found' };
  const start = matches[0], next = starts.find(i => i > start) ?? lines.length;
  const block = lines.slice(start, next);
  const sheets = parseSheets(block.join('\n'), 'monster');
  const hpLines = block.filter(line => /^HP:/i.test(line));
  const hpMatch = hpLines.length === 1 && hpLines[0].match(/^HP:[ \t]*(-?\d+)[ \t]*$/i);
  const body = block.slice(/^Level:/i.test(block[4] || '') ? 4 : 1);
  // After identity lines, bare text indicates an undelimited/truncated second actor.
  if (sheets.length !== 1 || sheets[0].name !== name || body.some(line => !/^[^:]+:/.test(line)) ||
      !hpMatch || !Number.isSafeInteger(Number(hpMatch[1])) || sheets[0].hp !== Number(hpMatch[1])) {
    return { hp: null, reason: 'invalid_monster_sheet' };
  }
  return { hp: Number(hpMatch[1]), reason: null };
}

function monsterBinding(task, name) {
  const elements = task.requiredElements ?? task.elements;
  if (!Array.isArray(elements)) return null;
  const targets = elements.filter(e => isRecord(e) && e.type === 'monster' &&
    typeof e.name === 'string' && e.name.trim() === name);
  const placements = targets.map(e => coordKey(e.placement));
  return placements.length && placements.every(p => p && p === placements[0]) ? placements[0] : null;
}

function checkMonster(task, name, currentRoomKey, consoleText, database) {
  const placement = monsterBinding(task, name);
  if (!placement) return { passed: false, evidence: { reason: 'missing_or_invalid_monster_binding', monster: name } };
  let result, source;
  if (placement === currentRoomKey) {
    result = monsterHp(consoleText, name);
    source = 'console.Monsters in Room';
  }
  // A malformed or ambiguous live sheet must not be overridden by a stale DB kill.
  if (!result || ['missing_monsters_section', 'monster_not_found'].includes(result.reason)) {
    result = monsterHp(roomAt(database, placement)?.monsters?.consoleBlock, name, true);
    source = 'database.monsters.consoleBlock';
  }
  return { passed: result.hp === null ? null : result.hp <= 0,
    evidence: { source, roomKey: placement, monster: name, hp: result.hp, reason: result.reason } };
}

function summarize(checks) {
  const satisfied = checks.filter(c => c.passed === true).length;
  const unknown = checks.filter(c => c.passed === null).length;
  return { satisfied, total: checks.length, unknown, eligible: satisfied === checks.length };
}

/** Read-only gates only. Eligibility is not narrative completion and never grants rewards. */
function evaluateTaskRequirements(task, { roomKey, consoleText, database } = {}) {
  const hardFails = [], actionFails = [], checks = [];
  const currentRoomKey = coordKey(roomKey);
  const validTask = isRecord(task);
  const lists = Object.entries(PHASES).map(([phase, field]) => {
    if (!validTask) return [phase, phase === 'hard' ? [null] : [], 'Invalid task'];
    const list = task[field];
    return [phase, list === undefined ? [] : Array.isArray(list) ? list : [null],
      list !== undefined && !Array.isArray(list) ? `${field} must be an array` : null];
  });
  if (lists.reduce((n, [, list]) => n + list.length, 0) > MAX_CHECKS) throw new RangeError('Quest requirements exceed 64 checks');
  for (const [phase, list, listError] of lists) for (let index = 0; index < list.length; index++) {
    let requirement, result, diagnostic;
    try { requirement = snapshot(list[index]); }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      requirement = null;
      diagnostic = 'Requirement must contain JSON data';
    }
    const r = requirement;
    const check = isRecord(r) && typeof r.check === 'string' ? r.check.toLowerCase() : '';
    if (listError || diagnostic || !check) {
      diagnostic = listError || diagnostic || 'Missing or invalid requirement check';
      result = { passed: false, evidence: { reason: 'invalid_requirement' } };
    } else if (!SUPPORTED[phase].includes(check)) {
      diagnostic = `Unknown ${phase} requirement "${r.check}"`;
      result = { passed: null, evidence: { reason: 'unsupported_requirement' } };
    } else if (check === 'at_coords') {
      const targetRoomKey = coordKey(r.value);
      diagnostic = targetRoomKey ? `Be at ${targetRoomKey}` : 'at_coords requires valid coordinates';
      result = { passed: !targetRoomKey ? false : !currentRoomKey ? null : currentRoomKey === targetRoomKey,
        evidence: { roomKey: currentRoomKey, targetRoomKey } };
    } else if (check === 'inventory_contains' || check === 'monster_hp_zero') {
      if (!validName(r.value)) {
        diagnostic = `${check} requires a nonempty name`;
        result = { passed: false, evidence: { reason: 'invalid_requirement' } };
      } else {
        const name = r.value.trim();
        diagnostic = check === 'inventory_contains' ? `Have "${name}" in Inventory` : `${name} HP must be 0`;
        result = check === 'inventory_contains' ? inventoryContains(consoleText, name) :
          checkMonster(task, name, currentRoomKey, consoleText, database);
      }
    } else if (check === 'exit_open') {
      const placement = coordKey(r.coords), direction = typeof r.direction === 'string' ? r.direction.trim() : '';
      diagnostic = `Open the ${direction} exit at ${placement}`;
      if (!placement || !validName(direction)) {
        diagnostic = 'exit_open requires valid coordinates and direction';
        result = { passed: false, evidence: { reason: 'invalid_requirement' } };
      } else {
        const exits = roomAt(database, placement)?.exits;
        const exit = isRecord(exits) && Object.hasOwn(exits, direction) ? exits[direction] : null;
        const locked = !!(exit?.locked || exit?.isLocked || exit?.door?.locked || exit?.door?.isLocked);
        result = { passed: isRecord(exit) && exit.status === 'open' && !locked,
          evidence: { source: 'database.exits', roomKey: placement, direction,
            status: typeof exit?.status === 'string' ? exit.status : null, locked } };
      }
    }
    const entry = { id: `${phase}:${index}`, phase, index, requirement, passed: result.passed, evidence: snapshot(result.evidence) };
    checks.push(entry);
    if (entry.passed !== true) (phase === 'hard' ? hardFails : actionFails).push(`${diagnostic}${entry.passed === null ? ' (unverified)' : ''}`);
  }
  return { hardFails, actionFails, checks, progress: summarize(checks) };
}

function validateId(id) {
  const match = typeof id === 'string' && id.match(/^(hard|action):(0|[1-9]\d?)$/);
  return !!match && Number(match[2]) < MAX_CHECKS;
}

function verifiedChecks(value) {
  if (!Array.isArray(value)) throw new TypeError('Quest progress checks must be an array');
  if (value.length > MAX_CHECKS) throw new RangeError('Quest progress exceeds 64 checks');
  const seen = new Set();
  return Array.from(value, c => {
    if (!isRecord(c) || !validateId(c.id) || c.id !== `${c.phase}:${c.index}` || !Number.isInteger(c.index) ||
        seen.has(c.id) || ![true, false, null].includes(c.passed) || !Object.hasOwn(c, 'requirement') || !isRecord(c.evidence)) {
      throw new TypeError('Invalid quest progress check');
    }
    seen.add(c.id);
    return { id: c.id, phase: c.phase, index: c.index, requirement: snapshot(c.requirement),
      passed: c.passed, evidence: snapshot(c.evidence) };
  }).sort((a, b) => (a.phase === b.phase ? a.index - b.index : a.phase === 'hard' ? -1 : 1));
}

/** Per-task persisted progress: current counters/checks plus monotonic earnedCheckpointIds. */
function mergeTaskProgress(previous, assessment) {
  if (!isRecord(assessment)) throw new TypeError('Quest progress requires an assessment');
  const checks = verifiedChecks(assessment.checks);
  const earned = new Set();
  let prior, revision = 0;
  if (previous !== null && previous !== undefined) {
    if (!isRecord(previous) || !Number.isSafeInteger(previous.revision) || previous.revision < 0 ||
        !Array.isArray(previous.earnedCheckpointIds)) throw new TypeError('Invalid previous quest progress');
    if (previous.earnedCheckpointIds.length > MAX_CHECKS) throw new RangeError('Quest history exceeds 64 checkpoints');
    for (const id of previous.earnedCheckpointIds) {
      if (!validateId(id)) throw new TypeError('Invalid earned checkpoint ID');
      earned.add(id);
    }
    const priorChecks = verifiedChecks(previous.checks);
    for (const c of priorChecks) if (c.passed === true) earned.add(c.id);
    prior = { ...summarize(priorChecks), checks: priorChecks, earnedCheckpointIds: [...earned].sort() };
    revision = previous.revision;
  }
  for (const c of checks) if (c.passed === true) earned.add(c.id);
  if (earned.size > MAX_CHECKS) throw new RangeError('Quest history exceeds 64 checkpoints');
  const current = { ...summarize(checks), checks, earnedCheckpointIds: [...earned].sort() };
  if (!prior || JSON.stringify(prior) !== JSON.stringify(current)) {
    if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Quest progress revision exceeds safe integer limit');
    revision++;
  }
  return { revision, ...current };
}

function taskBinding(task) {
  if (!task) return null;
  // A success belongs to the entire immutable task, not just its prose or gates.
  const identity = Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'status' && key !== 'progress'));
  return JSON.stringify(snapshot(identity));
}
module.exports = { evaluateTaskRequirements, mergeTaskProgress, taskBinding };
