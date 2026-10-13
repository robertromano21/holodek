'use strict';

const { randomUUID } = require('node:crypto');
const { parseSheets } = require('../assets/partyRoster');
const Inhabitants = require('../assets/dungeonInhabitants');
const PhysicalPuzzles = require('../assets/physicalPuzzles');
const { isReservedBossKeyName } = require('./bossGate');

const MAX_CHECKS = 64;
const MAX_JSON_CHARS = 16384;
const PHASES = { hard: 'hardRequirements', action: 'actionRequirements' };
const SUPPORTED = { hard: ['at_coords', 'inventory_contains', 'monster_hp_zero'],
  action: ['exit_open', 'monster_hp_zero', 'puzzle_solved', 'item_delivered'] };
const SECTION = /^(?:PC|NPCs(?: in Party)?|Monsters in Room|Monsters Equipped Properties|Monsters State|Objects in Room(?: Properties)?|Rooms Visited|Inventory(?: Properties)?|Room Name|Room Description|Coordinates(?: of Connected Rooms)?|Exits|Adjacent Rooms|Score|Turns|Puzzle in Room|Puzzle Solution|Artifacts Found|Quests Achieved|Next Artifact|Next Boss(?: Room)?|Boss Room Coordinates|Current Quest|Quest Progress|Quest Requirements|Party Status):/i;
const STAT = /^(?:Sex|Race|Class|Level|AC|XP|HP|MaxHP|Equipped|Attack|Damage|Armor|Magic|State):/i;
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
    const monsters = roomAt(database, placement)?.monsters;
    const hasCurrentSheets = typeof monsters?.inRoom === 'string' && /(?:^|\n)\s*(?:Level|HP|Magic):/m.test(monsters.inRoom);
    result = monsterHp(hasCurrentSheets ? monsters.inRoom : monsters?.consoleBlock, name, true);
    source = hasCurrentSheets ? 'database.monsters.inRoom' : 'database.monsters.consoleBlock';
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
    } else if (check === 'item_delivered') {
      const target = coordKey(r.coords), item = r.item, recipient = r.recipient;
      const bound = deliveryBindings(task).find(b => b.item === item && b.recipient === recipient && b.coords === target);
      const valid = target && validName(item) && validName(recipient) && !!bound;
      const destination = roomAt(database, target);
      const receipt = valid && destination?.itemTransfers?.find(row => row.source === 'engine-give-item-v1' &&
        row.item === item && row.recipient === recipient && coordKey(row.roomKey) === target && row.taskBinding === taskBinding(task) &&
        (!row.acceptedBy && !row.successorId || destination.deliverySuccessors?.some(delegate => delegate.source === 'engine-delivery-successor-v1' &&
          delegate.id === row.successorId && delegate.name === row.acceptedBy && delegate.recipient === recipient &&
          delegate.taskBinding === row.taskBinding && coordKey(delegate.roomKey) === target &&
          destination.inhabitants?.actors?.[row.acceptedBy]?.deliverySuccessorId === row.successorId)));
      diagnostic = `Give "${item}" to ${recipient} at ${target}`;
      result = { passed: !!receipt, evidence: { source: 'database.itemTransfers', roomKey: target, item: item || null,
        recipient: recipient || null, receiptId: receipt?.id || null } };
    } else if (check === 'puzzle_solved') {
      const target = coordKey(r.value), room = roomAt(database, target), p = room?.puzzleMechanism;
      diagnostic = `Solve the physical mechanism at ${target || 'its bound room'}`;
      result = { passed: !!p && (!r.mechanismId || r.mechanismId === p.id) && PhysicalPuzzles.validState(p, p.state) && p.state.status === 'complete',
        evidence: { source: 'database.puzzleMechanism', roomKey: target, mechanismId: p?.id || null, status: p?.state?.status || 'missing' } };
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
/** Completion is an engine decision; eligibility alone only proves prerequisites. */
function verifiedTaskCompletion(task, assessment) {
  const checks = assessment?.checks;
  if (!isRecord(task) || !Array.isArray(checks) || !checks.length || checks.some(c => c.passed !== true)) return false;
  const has = (check, value) => checks.some(c => c.requirement?.check === check &&
    (value === undefined || c.requirement.value === value));
  const kind = String(task.actionKind || '').toLowerCase(), type = String(task.type || '').toLowerCase();
  if (kind === 'deliver_item' || type === 'deliver') {
    const bindings = deliveryBindings(task);
    return bindings.length > 0 && bindings.every(b => checks.some(c => c.phase === 'action' &&
      c.requirement?.check === 'item_delivered' && c.requirement.item === b.item &&
      c.requirement.recipient === b.recipient && coordKey(c.requirement.coords) === b.coords));
  }
  if (kind === 'solve_puzzle' || type === 'puzzle') return has('puzzle_solved');
  const elements = task.requiredElements ?? task.elements;
  if (!Array.isArray(elements) && (kind === 'defeat_monster' || type === 'defeat' || type === 'fetch')) return false;
  if (kind === 'defeat_monster' || type === 'defeat') {
    const monsters = elements.filter(e => e?.type === 'monster');
    return monsters.length > 0 && monsters.every(e => validName(e.name) && has('monster_hp_zero', e.name.trim()));
  }
  if (kind === 'unlock_exit') return has('exit_open');
  if (type === 'fetch' && ['take_item', 'fetch_object', 'other', ''].includes(kind)) {
    const items = elements.filter(e => e?.type !== 'monster');
    return items.length > 0 && items.length === elements.length &&
      items.every(e => validName(e.name) && has('inventory_contains', e.name.trim()));
  }
  // Unimplemented investigate/negotiate/protect actions cannot be completed by prose.
  return false;
}
function normalizeDefeatTask(task) {
  if (!isRecord(task) || task.status === 'Completed' || String(task.type).toLowerCase() !== 'defeat' ||
      task.actionKind !== 'defeat_monster' || !Array.isArray(task.requiredElements) || !task.requiredElements.length ||
      !task.requiredElements.every(e => e?.type === 'monster' && validName(e.name) && coordKey(e.placement))) return task;
  if (task.hardRequirements !== undefined && !Array.isArray(task.hardRequirements) ||
      task.actionRequirements !== undefined && !Array.isArray(task.actionRequirements)) return task;
  const names = [...new Set(task.requiredElements.map(e => e.name.trim()))];
  if (names.some(name => !monsterBinding(task, name))) return task;
  const checks = [...(task.hardRequirements || []), ...(task.actionRequirements || [])];
  if (checks.some(r => !['at_coords', 'monster_hp_zero'].includes(r?.check))) return task;
  if (checks.some(r => r.check === 'monster_hp_zero' ? !validName(r.value) || !names.includes(r.value.trim()) :
      !task.requiredElements.some(e => coordKey(e.placement) === coordKey(r.value)))) return task;
  const hardRequirements = names.map(value => ({ check: 'monster_hp_zero', value }));
  if (JSON.stringify(task.hardRequirements) === JSON.stringify(hardRequirements) && !task.actionRequirements?.length) return task;
  const next = { ...task, hardRequirements, actionRequirements: [] };
  // Legacy coordinate/duplicate check IDs cannot be reused for the new per-target counters.
  delete next.progress;
  return next;
}
function buildDeliveryBindings(elements) {
  const itemTypes = ['object', 'key', 'weapon', 'armor', 'shield', 'other', 'artifact', 'book', 'scroll', 'spellbook', 'map'];
  if (!Array.isArray(elements) || elements.length < 2 || elements.length > MAX_CHECKS ||
      elements.some(e => !isRecord(e) || !validName(e.name) || !coordKey(e.placement) ||
        e.type !== 'monster' && !itemTypes.includes(e.type))) return [];
  const recipients = elements.filter(e => e.type === 'monster'), items = elements.filter(e => e.type !== 'monster');
  if (recipients.length !== 1 || !items.length || /^hostile$/i.test(recipients[0].allegiance || recipients[0].state || '') ||
      new Set(items.map(e => e.name.trim().toLowerCase())).size !== items.length) return [];
  return items.map(e => ({ item: e.name.trim(), recipient: recipients[0].name.trim(), coords: coordKey(recipients[0].placement) }));
}
function deliveryBindings(task) {
  const expected = buildDeliveryBindings(task?.requiredElements);
  if (!expected.length || (task.delivery && task.deliveries)) return [];
  const stored = task.deliveries ?? (task.delivery ? [task.delivery] : []);
  if (!Array.isArray(stored) || stored.length !== expected.length || stored.some(b => !isRecord(b))) return [];
  return expected.every(b => stored.filter(s => s.item === b.item && s.recipient === b.recipient &&
    coordKey(s.coords) === b.coords).length === 1) ? expected : [];
}
function deliveryRecipient(task, database, binding) {
  const room = roomAt(database, binding.coords), identity = taskBinding(task);
  const successors = (room?.deliverySuccessors || []).filter(row => row?.source === 'engine-delivery-successor-v1' &&
    row.taskBinding === identity && row.recipient === binding.recipient && coordKey(row.roomKey) === binding.coords);
  const latest = successors.at(-1), actor = room?.inhabitants?.actors?.[latest?.name];
  return latest && actor?.deliverySuccessorId === latest.id ? { name: latest.name, predecessor: binding.recipient, id: latest.id } :
    { name: binding.recipient, predecessor: null, id: null };
}
function normalizeDeliveryTask(task) {
  if (!isRecord(task) || task.status === 'Completed' || !['fetch', 'deliver'].includes(String(task.type).toLowerCase()) ||
      !Array.isArray(task.requiredElements)) return task;
  const text = String(task.desc || '').toLowerCase();
  const explicit = task.actionKind === 'deliver_item' || String(task.type).toLowerCase() === 'deliver';
  if ((!explicit && !/\b(deliver|give|bring|present|return|hand)\b/.test(text)) || /\b(solve|align|rotate|activate|balance|unlock)\b/.test(text) ||
      task.requiredElements.some(e => e?.type === 'puzzle')) return task;
  const bindings = buildDeliveryBindings(task.requiredElements);
  if (!bindings.length || (!explicit && (!text.includes(bindings[0].recipient.toLowerCase()) ||
      bindings.some(b => !text.includes(b.item.toLowerCase()))))) return task;
  const hardRequirements = [{ check: 'at_coords', value: bindings[0].coords }];
  const actionRequirements = bindings.map(b => ({ check: 'item_delivered', ...b }));
  const bindingFields = bindings.length === 1 ? { delivery: bindings[0] } : { deliveries: bindings };
  if (task.actionKind === 'deliver_item' && deliveryBindings(task).length === bindings.length &&
      JSON.stringify(task.hardRequirements) === JSON.stringify(hardRequirements) && JSON.stringify(task.actionRequirements) === JSON.stringify(actionRequirements)) return task;
  const next = { ...task, type: 'Deliver', actionKind: 'deliver_item', hardRequirements, actionRequirements,
    metrics: bindings.map(b => `${b.item} handed to ${b.recipient} at ${b.coords}, verified by an engine item-transfer receipt.`).join(' ') };
  delete next.delivery; delete next.deliveries;
  Object.assign(next, bindingFields);
  delete next.progress; delete next.physicalPuzzleRoom;
  return next;
}
function compileGeneratedDeliveryTask(task, database) {
  const normalized = normalizeDeliveryTask(task), bindings = deliveryBindings(normalized);
  const deliveryIntent = task?.actionKind === 'deliver_item' || String(task?.type).toLowerCase() === 'deliver' ||
    /\b(deliver|give|present|hand)\b[\s\S]*\b(to|both|them)\b/i.test(String(task?.desc || ''));
  if (!bindings.length) return deliveryIntent ? null : task;
  const items = normalized.requiredElements.filter(e => e.type !== 'monster');
  const first = bindings[0], destination = roomAt(database, first.coords);
  if (!destination || items.some(e => {
    const objects = roomAt(database, coordKey(e.placement))?.objects;
    return !Array.isArray(objects) || !objects.some(o => validName(o?.name) && o.name.trim().toLowerCase() === e.name.trim().toLowerCase());
  })) return null;
  const record = destination.inhabitants?.actors?.[first.recipient];
  const sheets = Inhabitants.parseBlocks(destination.monsters?.inRoom || '').concat(Inhabitants.parseBlocks(destination.monsters?.consoleBlock || ''));
  const recipient = sheets.find(a => a.name === first.recipient);
  const named = String(destination.monsters?.inRoom || '').split(',').some(n => n.trim() === first.recipient);
  if ((!record && !recipient && !named) || (record && ['dead', 'departed', 'recruited'].includes(record.status)) ||
      ['Dead', 'Hostile'].includes(Inhabitants.state(record || recipient, destination.monsters?.state))) return null;
  const source = e => `${e.name} from ${roomAt(database, coordKey(e.placement)).name || 'the room'} (${coordKey(e.placement)})`;
  const desc = `Retrieve ${items.map(source).join(' and ')}, then give ${items.length === 1 ? 'it' : 'each item'} to ${first.recipient} in ${destination.name || 'the room'} (${first.coords}).`;
  return { ...normalized, id: normalized.id || `delivery:${randomUUID()}`, desc };
}

/** Compile new objectives from existing world records, never model-supplied gates. */
function compileGeneratedTask(task, database, roomKey) {
  if (!isRecord(task) || !['fetch', 'defeat', 'deliver', 'puzzle'].includes(String(task.type).toLowerCase()) ||
      !Array.isArray(task.requiredElements) || task.requiredElements.length > MAX_CHECKS) return null;
  const elements = [], seen = new Set();
  for (const e of task.requiredElements) {
    const placement = coordKey(e?.placement), room = roomAt(database, placement);
    if (!validName(e?.name) || !room || !validName(room.name) || seen.has(e.name.trim().toLowerCase())) return null;
    seen.add(e.name.trim().toLowerCase());
    if (e.type === 'monster') {
      const record = room.inhabitants?.actors?.[e.name], sheets = Inhabitants.parseBlocks(room.monsters?.inRoom || '')
        .concat(Inhabitants.parseBlocks(room.monsters?.consoleBlock || ''));
      const actor = record || sheets.find(a => a.name === e.name);
      const named = String(room.monsters?.inRoom || '').split(',').some(n => n.trim() === e.name);
      if (!actor && !named || actor && (['dead', 'departed', 'recruited'].includes(actor.status) || Inhabitants.state(actor) === 'Dead')) return null;
      elements.push({ ...e, name: e.name.trim(), placement, allegiance: Inhabitants.allegiance(actor, room.monsters?.state) });
    } else {
      if (!['object', 'key', 'weapon', 'armor', 'shield', 'other', 'artifact', 'book', 'scroll', 'spellbook', 'map'].includes(e.type) ||
          /,/.test(e.name) || isReservedBossKeyName(database, e.name)) return null;
      const matches = Array.isArray(room.objects) ? room.objects.filter(o => validName(o?.name) &&
        o.name.trim().toLowerCase() === e.name.trim().toLowerCase()) : [];
      if (matches.length !== 1) return null;
      const item = matches[0];
      elements.push({ ...e, name: item.name.trim(), placement, unlocks: item.unlocks || undefined });
    }
  }
  const type = String(task.type).toLowerCase(), kind = String(task.actionKind || '').toLowerCase();
  const items = elements.filter(e => e.type !== 'monster'), monsters = elements.filter(e => e.type === 'monster');
  const place = key => `${roomAt(database, key).name} (${key})`, sources = items.map(e => `${e.name} from ${place(e.placement)}`).join(' and ');
  let next = { ...task, requiredElements: elements, hardRequirements: [], actionRequirements: [], status: 'Pending' };
  delete next.progress;
  if (kind === 'deliver_item' || type === 'deliver') {
    if (!['fetch', 'deliver'].includes(type)) return null;
    next = compileGeneratedDeliveryTask(next, database);
    if (!next) return null;
  } else if (type === 'defeat') {
    if (kind !== 'defeat_monster' || !monsters.length || items.length || monsters.some(e => e.allegiance !== 'Hostile')) return null;
    next.hardRequirements = monsters.map(e => ({ check: 'monster_hp_zero', value: e.name }));
    next.desc = `Defeat ${monsters.map(e => `${e.name} in ${place(e.placement)}`).join(' and ')}.`;
  } else if (type === 'puzzle') {
    if (kind !== 'solve_puzzle' || elements.length) return null;
    const key = coordKey(roomKey), room = roomAt(database, key), mechanism = room?.puzzleMechanism;
    if (!room || !validName(room.name) || !mechanism || mechanism.state?.status === 'complete' || !PhysicalPuzzles.validState(mechanism, mechanism.state)) return null;
    next.hardRequirements = [{ check: 'at_coords', value: key }];
    next.actionRequirements = [{ check: 'puzzle_solved', value: key, mechanismId: mechanism.id }];
    next.physicalPuzzleRoom = key;
    next.desc = `Solve ${validName(mechanism.title) ? mechanism.title : 'the physical mechanism'} in ${place(key)}.`;
  } else if (type === 'fetch') {
    if (!items.length || monsters.length || !['other', 'take_item', 'fetch_object', 'unlock_exit', ''].includes(kind)) return null;
    next.hardRequirements = items.map(e => ({ check: 'inventory_contains', value: e.name }));
    next.desc = `Retrieve ${sources}.`;
    if (kind === 'unlock_exit') {
      const keys = items.filter(e => e.type === 'key' && e.unlocks);
      if (!keys.length) return null;
      for (const e of keys) {
        const coords = coordKey(e.unlocks.coordinates), direction = e.unlocks.direction, exit = roomAt(database, coords)?.exits?.[direction];
        if (!exit || !validName(roomAt(database, coords)?.name) || exit.key !== e.name) return null;
        next.actionRequirements.push({ check: 'exit_open', coords, direction });
      }
      next.desc += ` Then ${next.actionRequirements.map(r => `open the ${r.direction} exit in ${place(r.coords)}`).join(' and ')}.`;
    } else next.hardRequirements.unshift({ check: 'at_coords', value: items[0].placement });
  } else return null;
  const assessment = evaluateTaskRequirements(next, { roomKey, consoleText: 'Inventory: Empty', database });
  if (assessment.checks.some(c => c.evidence.reason === 'unsupported_requirement' || c.evidence.reason === 'invalid_requirement') ||
      !verifiedTaskCompletion(next, { checks: assessment.checks.map(c => ({ ...c, passed: true })) })) return null;
  next.id ||= `task:${randomUUID()}`;
  next.metrics = describeQuestRequirements(next, database) + (deliveryBindings(next).length ? ' Verified by engine item-transfer receipts.' : '');
  return next;
}

function generatedTaskTypes(elements, database, roomKey) {
  return [['fetch', 'other'], ['defeat', 'defeat_monster'], ['deliver', 'deliver_item'], ['puzzle', 'solve_puzzle']]
    .filter(([type, actionKind]) => compileGeneratedTask({ id: 'candidate', type, actionKind, requiredElements: elements }, database, roomKey))
    .map(([type]) => type);
}

function selectGeneratedElements(elements, database, roomKey, excludedRooms = []) {
  const excluded = new Set(excludedRooms.map(coordKey).filter(Boolean));
  const supported = rows => (rows.length || !excluded.has(coordKey(roomKey))) &&
    rows.every(e => !excluded.has(coordKey(e.placement))) && generatedTaskTypes(rows, database, roomKey).length > 0;
  const items = elements.filter(e => e?.type !== 'monster'), monsters = elements.filter(e => e?.type === 'monster');
  for (const rows of [elements, items, monsters]) if ((rows.length || !elements.length) && supported(rows)) return rows;
  const existing = Object.entries(database || {}).flatMap(([placement, room]) => !excluded.has(coordKey(placement)) && Array.isArray(room?.objects) ?
    room.objects.filter(o => validName(o?.name)).map(o => ({ type: o.type === 'key' ? 'key' : 'object', name: o.name, placement: coordKey(placement) })) : []);
  // Keep a selected non-hostile contact useful by pairing it with real existing loot.
  for (const recipient of monsters) for (const item of existing) if (supported([item, recipient])) return [item, recipient];
  for (const item of existing) if (supported([item])) return [item];
  if (!excluded.has(coordKey(roomKey)) && supported([])) return [];
  return elements;
}

/** Player-facing instructions come from the gates, never abbreviated model prose. */
function describeQuestRequirements(task, database) {
  if (!isRecord(task)) return 'Awaiting the next step\'s verified requirements.';
  if (task.status === 'Completed') return 'Step completed. The next step\'s requirements will appear when it is prepared.';
  const place = value => {
    const key = coordKey(value);
    if (!key) return 'an unverified room';
    const name = roomAt(database, key)?.name;
    return `${validName(name) ? name.trim() : 'Room'} (${key})`;
  };
  const elements = Array.isArray(task.requiredElements ?? task.elements) ? (task.requiredElements ?? task.elements) : [];
  const source = name => {
    const rooms = [...new Set(elements.filter(e => e?.type !== 'monster' && validName(e?.name) && e.name.trim() === name)
      .map(e => coordKey(e.placement)))];
    return rooms.length === 1 && rooms[0] ? ` Item source: ${place(rooms[0])}.` : '';
  };
  const instructions = [], checks = [], referencedItems = new Set();
  for (const [phase, field] of Object.entries(PHASES)) {
    const list = task[field] === undefined ? [] : Array.isArray(task[field]) ? task[field] : [null];
    for (const raw of list) {
      if (checks.length >= MAX_CHECKS) throw new RangeError('Quest requirements exceed 64 checks');
      const r = snapshot(raw), check = typeof r?.check === 'string' ? r.check.toLowerCase() : '';
      checks.push({ phase, requirement: r, passed: true });
      let text;
      if (!SUPPORTED[phase].includes(check)) {
        text = `Unverified requirement: ${check || field + ' is invalid'}. Engine verification is not yet bound.`;
      } else if (check === 'at_coords') {
        text = `Be in ${place(r.value)}.`;
      } else if (check === 'inventory_contains') {
        const name = validName(r.value) ? r.value.trim() : '[unverified item]';
        referencedItems.add(name);
        text = `Have "${name}" in your inventory.${source(name)}`;
      } else if (check === 'item_delivered') {
        const name = validName(r.item) ? r.item.trim() : '[unverified item]';
        referencedItems.add(name);
        const binding = { item: r.item, recipient: r.recipient, coords: coordKey(r.coords) }, recipient = deliveryRecipient(task, database, binding);
        text = `Give "${name}" to ${validName(recipient.name) ? recipient.name.trim() : '[unverified recipient]'}${recipient.predecessor ? ` (taking over for ${recipient.predecessor})` : ''} in ${place(r.coords)}.${source(name)} Dropping it or mentioning it does not count.`;
      } else if (check === 'monster_hp_zero') {
        const name = validName(r.value) ? r.value.trim() : '[unverified target]';
        text = `Defeat ${name} in ${place(monsterBinding(task, name))} (HP must be 0 or below).`;
      } else if (check === 'puzzle_solved') {
        const mechanism = roomAt(database, coordKey(r.value))?.puzzleMechanism;
        const title = mechanism && (!r.mechanismId || r.mechanismId === mechanism.id) && validName(mechanism.title) ? ` "${mechanism.title.trim()}"` : '';
        text = `Solve the physical puzzle${title} in ${place(r.value)}.`;
      } else if (check === 'exit_open') {
        const direction = validName(r.direction) ? r.direction.trim() : '[unverified direction]';
        text = `Open the ${direction} exit in ${place(r.coords)} (it must be unlocked).`;
      }
      instructions.push(text);
    }
  }
  // Keep named objectives visible even if an old task lacks a complete gate binding.
  for (const e of elements) if (e?.type !== 'monster' && validName(e?.name) && !referencedItems.has(e.name.trim())) {
    const name = e.name.trim();
    instructions.push(`Task item: "${name}".${source(name)}`);
    referencedItems.add(name);
  }
  if (!verifiedTaskCompletion(task, { checks })) instructions.push('Completion is not yet fully bound to engine-verifiable actions.');
  return [...new Set(instructions)].map((text, i) => `${i + 1}. ${text}`).join(' ');
}

function writeQuestRequirements(consoleText, task, database) {
  const text = String(consoleText || '').replace(/^Quest Requirements:[^\r\n]*(?:\r?\n|$)/gm, '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `Quest Requirements: ${describeQuestRequirements(task, database)}`;
  const anchor = /^Quest Progress:/m.test(text) ? /^Quest Progress:[^\r\n]*/m : /^Current Quest:[^\r\n]*/m;
  return anchor.test(text) ? text.replace(anchor, match => `${match}${newline}${line}`) : `${text}${newline}${line}`;
}

function refreshCombatQuestProgress(state, consoleText) {
  // The successor module depends on this evaluator; load it only at the commit boundary.
  const recovery = require('./questDeliverySuccessors').ensure(state, consoleText);
  if (recovery.changed) consoleText = recovery.consoleText;
  const storedTasks = state.getCurrentTasks?.(), index = state.getCurrentTaskIndex?.() ?? 0;
  if (!Array.isArray(storedTasks) || !Number.isInteger(index) || index < 0 || index > 2 || !storedTasks[index] ||
      typeof consoleText !== 'string') return consoleText;
  const tasks = storedTasks.slice();
  const task = { ...(index < 2 ? normalizeDefeatTask(tasks[index]) : tasks[index]) };
  let database;
  try { database = JSON.parse(state.getRoomNameDatabase?.() || '{}'); } catch { return consoleText; }
  const roomKey = consoleText.match(/^Coordinates:[ \t]*([^\r\n]*)/m)?.[1];
  const assessment = evaluateTaskRequirements(task, { roomKey, consoleText, database });
  task.progress = mergeTaskProgress(task.progress, assessment);
  const pureDefeat = index < 2 && String(task.type).toLowerCase() === 'defeat' && task.actionKind === 'defeat_monster' &&
    task.progress.total > 0 && Array.isArray(task.requiredElements) &&
    task.requiredElements.every(e => e?.type === 'monster' && validName(e.name) && monsterBinding(task, e.name.trim())) &&
    assessment.checks.every(c => c.requirement?.check === 'monster_hp_zero');
  if (pureDefeat && task.progress.eligible && task.status !== 'Completed') {
    task.status = 'Completed';
    state.setCurrentTaskIndex(index + 1);
    state.setQuestSeeded(false);
    state.setLastQuestUpdate?.(`Task completed: ${task.desc}`);
    state.appendQuestLog?.({ update: `Task completed: ${task.desc}`, currentTaskIndex: index + 1 });
  } else if (task.status !== 'Completed') task.status = 'In Progress';
  tasks[index] = task;
  state.setCurrentTasks(tasks);
  const text = `Step ${index + 1}/3: ${task.status}; ${task.progress.satisfied}/${task.progress.total} requirements verified. ${task.desc || ''}`;
  const progressText = /^Quest Progress:/m.test(consoleText) ? consoleText.replace(/^Quest Progress:[^\r\n]*/m, () => `Quest Progress: ${text}`) :
    consoleText.replace(/^Current Quest:[^\r\n]*/m, line => `${line}\nQuest Progress: ${text}`);
  const next = writeQuestRequirements(progressText, task, database);
  state.setUpdatedGameConsole(next);
  return next;
}
module.exports = { evaluateTaskRequirements, mergeTaskProgress, taskBinding, verifiedTaskCompletion,
  normalizeDefeatTask, buildDeliveryBindings, deliveryBindings, deliveryRecipient, normalizeDeliveryTask, compileGeneratedDeliveryTask,
  compileGeneratedTask, generatedTaskTypes, selectGeneratedElements, describeQuestRequirements, writeQuestRequirements, refreshCombatQuestProgress };
