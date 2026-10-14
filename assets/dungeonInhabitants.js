(function(root) {
  'use strict';
  const VERSION = 1;
  const DIALOGUE_REFRESH_MS = 5 * 60 * 1000;
  const MONSTER_DIALOGUE_RANGE = 10;
  const COMPANION_DIALOGUE_RANGE = 8;
  const MAX_SPEECH_LENGTH = 24000;
  const collision = typeof module !== 'undefined' && module.exports ? require('./voxelCollision') : root.VoxelCollision;
  const Profiles = typeof module !== 'undefined' && module.exports ? require('./characterProfiles') : root.CharacterProfiles;
  const SpellRules = typeof module !== 'undefined' && module.exports ? require('./spellRules') : root.SpellRules;
  const Audience = typeof module !== 'undefined' && module.exports ? require('./dialogueAudience') : root.DialogueAudience;
  const ALLEGIANCES = ['Friendly', 'Neutral', 'Hostile'];
  const STATES = [...ALLEGIANCES, 'Unconscious', 'Dying', 'Dead'];
  const ROUTINES = ['guard', 'patrol', 'work', 'forage', 'wander', 'rest'];
  const EQUIPMENT_SLOTS = ['Weapon', 'Armor', 'Shield', 'Other'];
  function equipmentName(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) value = value.name;
    if (typeof value !== 'string') return null;
    value = value.trim();
    if (/^[{\["]/.test(value)) {
      try {
        const parsed = JSON.parse(value);
        value = typeof parsed === 'string' ? parsed : parsed?.name;
      } catch { return null; }
    }
    if (typeof value !== 'string') return null;
    value = value.trim();
    // Names share a comma-delimited text field; modifiers and field syntax are never item names.
    return value.length <= 100 && /[a-z]/i.test(value) && !/[{},:\[\]"\r\n<>]/.test(value) &&
      !/^(?:none|empty|null|undefined)$/i.test(value) ? value : null;
  }
  function parseEquipment(value) {
    const equipped = Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, 'None']));
    if (value && typeof value === 'object') {
      for (const slot of EQUIPMENT_SLOTS) equipped[slot] = equipmentName(value[slot]) || 'None';
    } else if (typeof value === 'string') {
      // Split only at real slot boundaries, not at commas inside a malformed JSON item.
      for (const part of value.trim().replace(/^Equipped:[ \t]*/i, '').split(/,[ \t]*(?=(?:Weapon|Armor|Shield|Other)[ \t]*:)/i)) {
        const match = /^(Weapon|Armor|Shield|Other)[ \t]*:[ \t]*(.*)$/i.exec(part.trim());
        if (!match) continue;
        const slot = EQUIPMENT_SLOTS.find(s => s.toLowerCase() === match[1].toLowerCase());
        equipped[slot] = equipmentName(match[2]) || 'None';
      }
    }
    return equipped;
  }
  function parseEquipmentProperties(value) {
    return (String(value || '').match(/\{[^{}]*\}/g) || []).flatMap(raw => {
      let item;
      try { item = JSON.parse(raw); } catch {
        item = {};
        for (const match of raw.matchAll(/\b(name|type|attack_modifier|damage_modifier|ac|magic):\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g)) {
          try { item[match[1]] = JSON.parse(match[2]); } catch { /* Invalid fields cannot enter loot. */ }
        }
      }
      const name = equipmentName(item.name), type = String(item.type || '').toLowerCase();
      if (!name || !['weapon', 'armor', 'shield', 'other', 'key'].includes(type)) return [];
      const fields = ['attack_modifier', 'damage_modifier', 'ac', 'magic'];
      if (fields.some(field => typeof item[field] !== 'number' || !Number.isFinite(item[field]))) return [];
      const extra = ['spell_item_id', 'magic_capacity', 'quest_artifact', 'artifact_recharge_turns', 'consumable_kind', 'spell_scroll', 'spell_class', 'spell_min_level', 'class_spellbook', 'readable_kind', 'owner', 'slot', 'description'];
      return [{ name, type, ...Object.fromEntries(fields.map(field => [field, item[field]])),
        ...Object.fromEntries(extra.filter(k => ['string', 'number', 'boolean'].includes(typeof item[k])).map(k => [k, item[k]])) }];
    });
  }
  const keyOf = name => String(name || '').trim().toLowerCase();
  function roomKey(value) {
    const values = String(value || '').match(/-?\d+/g);
    return values?.length === 3 ? values.map(Number).join(',') : null;
  }
  function allegiance(actor, fallback = 'Neutral') {
    if (actor?.type === 'pc' || actor?.type === 'npc') return 'Friendly';
    const value = actor?.state ?? actor?.State ?? actor?.allegiance ?? actor?.disposition ?? actor?.attitude;
    return ALLEGIANCES.find(s => keyOf(s) === keyOf(value)) || ALLEGIANCES.find(s => keyOf(s) === keyOf(actor?.allegiance)) ||
      ALLEGIANCES.find(s => keyOf(s) === keyOf(fallback)) || 'Neutral';
  }
  function state(actor, fallback = 'Neutral') {
    const hp = actor?.hp ?? actor?.HP;
    const stored = actor?.state ?? actor?.State;
    if (Number(hp) <= 0 && /^(unconscious|dying)$/i.test(String(stored)) && actor?.status !== 'dead') return /^dying$/i.test(stored) ? 'Dying' : 'Unconscious';
    if (hp !== undefined && Number.isFinite(Number(hp)) && Number(hp) <= 0) return 'Dead';
    if (actor?.type === 'pc') return 'Alive';
    if (keyOf(actor?.state ?? actor?.State) === 'dead' || actor?.status === 'dead') return 'Dead';
    return allegiance(actor, fallback);
  }
  const isDown = actor => ['Unconscious', 'Dying'].includes(state(actor));
  const isAlive = actor => !!actor && state(actor) !== 'Dead';
  const canAct = actor => isAlive(actor) && !isDown(actor) && (actor.hp ?? actor.HP ?? 1) > 0;
  function isPresent(actor, population = null) {
    if (!actor || state(actor) === 'Dead') return false;
    const record = actor.type === 'monster' ? population?.actors?.[actor.name || actor.Name] : null;
    if (actor.type === 'monster' && population) {
      const actorRoom = roomKey(actor.mazeRoomKey);
      if (!record || actorRoom && actorRoom !== roomKey(population.geoKey)) return false;
    }
    return !record || !['dead', 'recruited', 'departed'].includes(record.status) && state(record) !== 'Dead';
  }
  function hasEncountered(actor, population) {
    if (actor?.type === 'npc') return true;
    const record = actor?.type === 'monster' && population?.actors?.[actor.name || actor.Name];
    return !!record && Number.isFinite(record.encounteredAt) && record.encounteredAt > 0;
  }
  function hash(value) {
    let h = 2166136261;
    for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const text = (value, max = 180) => String(value || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, max);
  function parseBlocks(block, type = 'monster') {
    const raw = String(block || '').split(/\r?\n/);
    const rows = raw.map((line, index) => ({ line: line.trim(), index })).filter(row => row.line);
    const lines = rows.map(row => row.line);
    const result = [];
    // Keep the fourteen legacy fields in order; State is an optional trailing field in old saves.
    for (let i = 0; i + 13 < lines.length; i++) {
      if (!/^Level:\s*\d+$/i.test(lines[i + 4]) || !/^Magic:/i.test(lines[i + 13])) continue;
      const read = n => Number(lines[i + n].split(':')[1]) || 0;
      const stateLine = /^State:\s*(\w+)\s*$/i.exec(lines[i + 14] || '');
      const storedState = (type === 'pc' ? ['Alive', 'Unconscious', 'Dying', 'Dead'] : STATES).find(s => keyOf(s) === keyOf(stateLine?.[1]));
      const length = stateLine ? 15 : 14;
      result.push({ name: lines[i].replace(/^Name:\s*/i, ''), type, sex: lines[i + 1], race: lines[i + 2], className: lines[i + 3],
        level: read(4), ac: read(5), xp: read(6), hp: read(7), maxHp: read(8), attack: read(10), damage: read(11),
        armor: read(12), magic: read(13), ...(read(7) <= 0 ? { state: ['Unconscious', 'Dying'].includes(storedState) ? storedState : 'Dead' } : storedState ? { state: storedState } : {}),
        storedState, lines: lines.slice(i, i + length), sheet: lines.slice(i, i + length).join('\n'),
        rawSheet: raw.slice(rows[i].index, rows[i + length - 1].index + 1).join(String(block).includes('\r\n') ? '\r\n' : '\n'),
        magicIndex: rows[i + 13].index, stateIndex: stateLine ? rows[i + 14].index : null });
      i += length - 1;
    }
    return result;
  }
  function sectionPattern(label) {
    const end = label === 'PC' ? 'NPCs in Party|Monsters in Room|Rooms Visited' :
      label === 'NPCs in Party' ? 'Monsters in Room|Rooms Visited' : 'Monsters Equipped Properties|Monsters State|Rooms Visited';
    return new RegExp(`(^${label}:)([\\s\\S]*?)(?=^(?:${end}):|(?![\\s\\S]))`, 'm');
  }
  function parseSheets(consoleText, label = 'Monsters in Room') {
    const block = String(consoleText || '').match(sectionPattern(label))?.[2] || '';
    return parseBlocks(block, label === 'PC' ? 'pc' : label === 'NPCs in Party' ? 'npc' : 'monster');
  }
  function withStates(consoleText, population = null) {
    let value = String(consoleText || '');
    if (population) {
      const observed = parseSheets(value), full = residentSheets(population, observed);
      if (full.map(a => keyOf(a.name)).join('|') !== observed.map(a => keyOf(a.name)).join('|')) {
        const eol = value.includes('\r\n') ? '\r\n' : '\n';
        const block = full.map(actor => actor.rawSheet || actor.sheet).join(eol) || 'None';
        value = value.replace(sectionPattern('Monsters in Room'), (_, header) => header + eol + block + eol);
        if (full.length && population.initialEquipmentProperties && /^Monsters Equipped Properties:[ \t]*None[ \t]*$/m.test(value)) {
          value = value.replace(/^Monsters Equipped Properties:[^\r\n]*/m,
            () => `Monsters Equipped Properties: ${population.initialEquipmentProperties}`);
        }
      }
    }
    if (population?.equipmentProperties !== undefined) {
      // Proximity projections may omit modifiers, but they cannot erase a resident's actual gear.
      const referenced = new Set(parseSheets(value).flatMap(a => Object.values(parseEquipment(a.lines[9]))).map(keyOf));
      const properties = new Map(parseEquipmentProperties(population.equipmentProperties).map(p => [keyOf(p.name), p]));
      for (const p of parseEquipmentProperties(value.match(/^Monsters Equipped Properties:[ \t]*([^\r\n]*)/m)?.[1])) properties.set(keyOf(p.name), p);
      const canonical = [...properties.values()].filter(p => referenced.has(keyOf(p.name))).map(p =>
        `{name: ${JSON.stringify(p.name)}, type: ${JSON.stringify(p.type)}, attack_modifier: ${p.attack_modifier}, damage_modifier: ${p.damage_modifier}, ac: ${p.ac}, magic: ${p.magic}}`).join(', ') || 'None';
      value = value.replace(/^Monsters Equipped Properties:[^\r\n]*/m, () => `Monsters Equipped Properties: ${canonical}`);
    }
    const fallback = value.match(/^Monsters State:[ \t]*(\w+)/m)?.[1] || 'Neutral';
    const records = new Map(Object.values(population?.actors || {}).map(a => [keyOf(a.name), a]));
    for (const [label, type] of [['PC', 'pc'], ['NPCs in Party', 'npc'], ['Monsters in Room', 'monster']]) {
      value = value.replace(sectionPattern(label), (match, header, block) => {
        const eol = block.includes('\r\n') ? '\r\n' : '\n', raw = block.split(/\r?\n/);
        for (const actor of parseBlocks(block, type).reverse()) {
          const record = type === 'monster' ? records.get(keyOf(actor.name)) : null;
          const next = state({ ...actor, state: isDown(actor) ? actor.state : isDown(record) ? record.state : record?.allegiance || actor.state }, fallback);
          const indent = raw[actor.magicIndex].match(/^[ \t]*/)[0] || '      ';
          if (actor.stateIndex !== null) raw[actor.stateIndex] = `${indent}State: ${next}`;
          else raw.splice(actor.magicIndex + 1, 0, `${indent}State: ${next}`);
        }
        return header + raw.join(eol);
      });
    }
    const monsterStates = new Set(parseSheets(value).map(a => state(a, fallback)));
    const summary = monsterStates.size === 0 ? 'None' : monsterStates.size === 1 ? [...monsterStates][0] : 'Mixed';
    return value.replace(/^Monsters State:[^\r\n]*/m, `Monsters State: ${summary}`);
  }
  function normalizeDescriptors(rows, { limit = 10, starting = false, excluded = [] } = {}) {
    const used = new Set(excluded.map(keyOf));
    return (Array.isArray(rows) ? rows : []).slice(0, 40).flatMap((row, index) => {
      const name = text(row?.name, 70).replace(/[:{}\[\]"]/g, '');
      if (!name || ['__proto__', 'constructor', 'prototype'].includes(keyOf(name)) || used.has(keyOf(name)) || used.size >= excluded.length + limit) return [];
      used.add(keyOf(name));
      const state = starting ? 'Friendly' : allegiance(row);
      const title = text(row.className || row.class, 80) || 'Wanderer';
      const className = !starting && SpellRules ? SpellRules.monsterClass(title, row.combatRole === 'Warrior' ? 'Fighter' : row.combatArchetype) : title;
      return [{ name, race: text(row.race, 55) || 'Restless Soul', className,
        combatRole: SpellRules?.classSettings(className, 1) ? 'Spellcaster' : 'Warrior',
        combatArchetype: SpellRules?.monsterArchetype(className, row.combatArchetype) || 'Fighter',
        spellPreferences: [...new Set(Array.isArray(row.spellPreferences) ? row.spellPreferences : [])]
          .filter(id => typeof id === 'string' && SpellRules?.catalog(className).includes(id)).slice(0, 7),
        allegiance: state, state, encounterId: text(row.encounterId || row.encounter, 40) || `group-${Math.floor(index / 3)}`,
        job: text(row.job, 70) || (state === 'Hostile' ? 'sentinel' : 'pilgrim'),
        activity: text(row.activity, 140) || (state === 'Hostile' ? 'watching the approach' : 'studying the ruins'),
        personality: text(row.personality, 220), voice: text(row.voice, 140), motivation: text(row.motivation, 180),
        history: text(row.history, 600), profile: row.profile && Profiles ? Profiles.create({ ...row, name }, '', row.profile) : undefined,
        routine: ROUTINES.includes(row.routine) ? row.routine : state === 'Hostile' ? 'patrol' : 'work',
        dialogue: (Array.isArray(row.dialogue) ? row.dialogue : []).map(line => text(line, 220)).filter(Boolean).slice(0, 3) }];
    });
  }
  function createPopulation(geoKey, rows, { indoor = true, starting = false } = {}) {
    const actors = {};
    const groups = [];
    const groupById = new Map();
    const limit = starting ? 4 : indoor ? 10 : 20;
    for (const row of normalizeDescriptors(rows, { limit, starting })) {
      // Limit each encounter to four and keep allegiances coherent within a group.
      const base = `${row.encounterId}-${row.allegiance.toLowerCase()}`;
      let group = groupById.get(base);
      if (!group || group.members.length >= 4) {
        group = { id: `${base}-${groups.length}`, members: [], status: 'unseen', introPlayed: false, site: null };
        groups.push(group); groupById.set(base, group);
      }
      group.members.push(row.name);
      const profile = Profiles?.create(row, roomKey(geoKey));
      actors[row.name] = { ...row, pursuit: pursuitPolicy(row, geoKey, starting), ...(profile ? { profile, personality: profile.personality, history: profile.history,
        motivation: profile.motivation, memory: { profile } } : {}), encounterId: group.id, status: 'present', home: null, position: null, dialogueIndex: 0 };
    }
    return { version: VERSION, geoKey: roomKey(geoKey), indoor, starting, revision: 1, actors, groups };
  }
  function pursuitPolicy(actor, geoKey, starting = false) {
    return { version: 1, willing: !starting && allegiance(actor) === 'Hostile' && hash(`${roomKey(geoKey)}:${actor.name}:pursuit`) % 4 === 0,
      active: false, remainingRooms: 2, originRoom: roomKey(geoKey) };
  }
  function attach(roster, population, fallback = 'Neutral') {
    if (population && Array.isArray(roster)) {
      const names = new Set(roster.map(actor => keyOf(actor.name || actor.Name)));
      const pc = roster.find(actor => actor.type === 'pc');
      for (const sheet of residentSheets(population)) {
        if (names.has(keyOf(sheet.name)) || state(sheet) === 'Dead' ||
            population.actors[sheet.name]?.status !== 'present') continue;
        roster.push({ ...sheet, type: 'monster', equipped: parseEquipment(sheet.lines[9]),
          x: pc?.x ?? 15, y: pc?.y ?? 15 });
        names.add(keyOf(sheet.name));
      }
    }
    const records = new Map(Object.values(population?.actors || {}).map(a => [keyOf(a.name), a]));
    for (const actor of roster || []) {
      const record = records.get(keyOf(actor.name || actor.Name));
      actor.allegiance = allegiance(actor.type === 'monster' && record ? { ...record, state: record.allegiance } : actor, fallback);
      actor.state = state({ ...actor, state: ['Dead', 'Unconscious', 'Dying'].includes(actor.state) ? actor.state : actor.allegiance,
        status: actor.type === 'monster' ? record?.status : undefined });
      if (!record || actor.type !== 'monster') continue;
      actor.encounterId = record.encounterId;
      actor.job = record.job; actor.activity = record.activity; actor.routine = record.routine;
      actor.personality=record.personality; actor.motivation=record.motivation;
      actor.originProfile = record.profile || actor.originProfile;
      actor.race ||= record.race; actor.className ||= record.className;
      actor.combatArchetype = record.combatArchetype;
      actor.combatRole = record.combatRole;
      actor.home = record.home;
      actor.discoveryState = record.discoveryState;
      actor.discoveryRevision = record.discoveryRevision;
      actor.pursuit = record.pursuit;
      actor.deityId = record.deityId;
      actor.patron = record.patron;
      actor.factionId = record.factionId;
      actor.recruitable = record.recruitable;
      if (record.deityId) actor.maxHp = record.maxHp;
      if (record.discoveryRevision && actor._discoveryRevision !== record.discoveryRevision && record.position) {
        actor.mazeX = record.position.x; actor.mazeY = record.position.y; actor.mazeRoomKey = population.geoKey;
        actor.renderMazeX = actor.mazeX; actor.renderMazeY = actor.mazeY;
        actor._renderFromMazeX = actor.mazeX; actor._renderFromMazeY = actor.mazeY;
        delete actor.mazePoint; delete actor._renderTweenToX; delete actor._renderTweenToY; delete actor._renderTweenStartedAt;
        actor._discoveryRevision = record.discoveryRevision;
      }
      if (record.position && roomKey(actor.mazeRoomKey) !== population.geoKey) {
        actor.mazeX = record.position.x; actor.mazeY = record.position.y; actor.mazeRoomKey = population.geoKey;
      }
    }
    return roster;
  }
  function ceilingHeight(dungeon, cell) {
    if (Number.isFinite(cell?.roof?.height)) return cell.roof.height;
    // Outdoor ceilHeight also stores terrain/prop height, not an invisible overhead slab.
    if (dungeon?.classification?.indoor === false || dungeon?.sceneRoof?.skyDefault) return Infinity;
    return cell?.ceilHeight ?? Infinity;
  }
  function walkable(dungeon, x, y) {
    const cell = dungeon?.cells?.[`${x},${y}`];
    if (!cell || cell.blocked || cell.obstacle || ['lava', 'water', 'hazard'].includes(cell.feature) ||
        ceilingHeight(dungeon, cell) - (cell.floorHeight || 0) <= 0.9 || cell.tile === 'door' && !cell.door?.isOpen) return false;
    if (cell.tile === 'floor' || cell.tile === 'door') return true;
    return collision?.testCell(dungeon, x, y, x + 0.5, y + 0.5)?.blocked === false;
  }
  function pointWalkable(dungeon,x,y) {
    if (!Number.isFinite(x)||!Number.isFinite(y)) return false;
    const cx=Math.floor(x),cy=Math.floor(y),cell=dungeon?.cells?.[`${cx},${cy}`];
    if (!cell || cell.blocked || cell.obstacle || ['lava','water','hazard'].includes(cell.feature) ||
        ceilingHeight(dungeon, cell)-(cell.floorHeight || 0)<=0.9 || cell.tile==='door'&&!cell.door?.isOpen) return false;
    if (!['floor','door','pillar'].includes(cell.tile) && collision?.testCell(dungeon,cx,cy,x,y)?.blocked!==false) return false;
    if (cell.tile==='pillar' && Math.hypot(x-cx-0.5,y-cy-0.5)<0.38) return false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
      if(collision?.testCell(dungeon,cx+dx,cy+dy,x,y)?.blocked) return false;
    }
    return true;
  }
  function reachable(dungeon) {
    const start = dungeon.start;
    if (!start || !walkable(dungeon, start.x, start.y)) return [];
    const queue = [{ x: start.x, y: start.y, distance: 0 }], seen = new Set([`${start.x},${start.y}`]);
    const max = Math.min(262144, (dungeon.layout?.width || 512) * (dungeon.layout?.height || 512));
    for (let i = 0; i < queue.length && i < max; i++) {
      const current = queue[i], from = dungeon.cells[`${current.x},${current.y}`];
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const x = current.x + dx, y = current.y + dy, key = `${x},${y}`;
        if (seen.has(key) || !walkable(dungeon, x, y)) continue;
        if (!canTraverse(dungeon, current, { x, y })) continue;
        seen.add(key); queue.push({ x, y, distance: current.distance + 1 });
      }
    }
    return queue;
  }
  function canTraverse(dungeon, from, to) {
    const a = dungeon.cells[`${from.x},${from.y}`], b = dungeon.cells[`${to.x},${to.y}`];
    if (!walkable(dungeon, to.x, to.y) || Math.abs((b.floorHeight || 0) - (a?.floorHeight || 0)) > 1.5) return false;
    const props = [a, b].map((cell, i) => ({ cell, point: i ? to : from })).filter(({cell}) => cell && !['floor','door'].includes(cell.tile));
    if (!props.length) return true;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, sx=from.pointX ?? from.x+0.5,sy=from.pointY ?? from.y+0.5;
      const x=sx+(to.x+0.5-sx)*t,y=sy+(to.y+0.5-sy)*t;
      const floor = (a?.floorHeight || 0) + ((b.floorHeight || 0) - (a?.floorHeight || 0))*t;
      if (!pointWalkable(dungeon,x,y) || props.some(({point}) => collision?.testCell(dungeon, point.x, point.y, x, y, 0.2, 0.65, 1.5, floor)?.blocked)) return false;
    }
    return true;
  }
  function lineClear(dungeon, a, b) {
    if (!a || !b) return false;
    const dx = b.x - a.x, dy = b.y - a.y, steps = Math.ceil(Math.hypot(dx, dy) * 4);
    if (steps > 512) return false;
    const baseA = dungeon.cells[`${Math.floor(a.x)},${Math.floor(a.y)}`]?.floorHeight || 0;
    const baseB = dungeon.cells[`${Math.floor(b.x)},${Math.floor(b.y)}`]?.floorHeight || 0;
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0, x = a.x + dx * t, y = a.y + dy * t;
      const cell = dungeon.cells[`${Math.floor(x)},${Math.floor(y)}`];
      if (!cell || cell.blocked || cell.obstacle || cell.tile === 'door' && !cell.door?.isOpen) return false;
      const z = baseA + (baseB - baseA) * t + 0.65;
      if (z < (cell.floorHeight || 0) || z >= ceilingHeight(dungeon, cell)) return false;
      if (!['floor', 'door'].includes(cell.tile) && collision?.testCell(dungeon, Math.floor(x), Math.floor(y), x, y,
          0.1, 0.65, 1.5, z - 0.65)?.blocked !== false) return false;
      // A ray grazing a corner must not see through the two walls beside it.
      if (i && Math.floor(x) !== Math.floor(a.x + dx * (i - 1) / steps) && Math.floor(y) !== Math.floor(a.y + dy * (i - 1) / steps)) {
        if (!walkable(dungeon, Math.floor(x), Math.floor(a.y + dy * (i - 1) / steps)) ||
            !walkable(dungeon, Math.floor(a.x + dx * (i - 1) / steps), Math.floor(y))) return false;
      }
    }
    return true;
  }
  function dialoguePoint(actor) {
    if (!Number.isFinite(actor?.mazeX) || !Number.isFinite(actor?.mazeY)) return null;
    const center = { x: actor.mazeX + 0.5, y: actor.mazeY + 0.5 }, point = actor.mazePoint;
    return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.hypot(point.x - center.x, point.y - center.y) <= 1.5 ?
      { x: point.x, y: point.y } : center;
  }
  function hearingClear(dungeon, a, b, range) {
    if (!a || !b || !Number.isFinite(range) || range <= 0 ||
        ![a.x, a.y, b.x, b.y].every(Number.isFinite) || Math.hypot(b.x - a.x, b.y - a.y) > range ||
        !pointWalkable(dungeon, a.x, a.y) || !pointWalkable(dungeon, b.x, b.y)) return false;
    // Sound may bend around a support, but never bypass a dividing wall or a closed door.
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const cell = dungeon.cells?.[`${Math.floor(a.x + (b.x - a.x) * t)},${Math.floor(a.y + (b.y - a.y) * t)}`];
      if (!cell || cell.blocked || cell.obstacle || cell.tile === 'wall' || cell.tile === 'door' && !cell.door?.isOpen) return false;
    }
    const limit = range + 2, queue = [{ ...a, cost: 0 }], costs = new Map();
    const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y,
      (dungeon.cells[`${Math.floor(p.x)},${Math.floor(p.y)}`]?.floorHeight || 0) -
      (dungeon.cells[`${Math.floor(q.x)},${Math.floor(q.y)}`]?.floorHeight || 0));
    costs.set(`${Math.floor(a.x)},${Math.floor(a.y)}`, 0);
    for (let visited = 0; queue.length && visited < 256; visited++) {
      queue.sort((p, q) => p.cost + distance(p, b) - q.cost - distance(q, b));
      const current = queue.shift(), remaining = distance(current, b);
      if (current.cost + remaining <= limit && lineClear(dungeon, current, b)) return true;
      const from = { x: Math.floor(current.x), y: Math.floor(current.y), pointX: current.x, pointY: current.y };
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const x = from.x + dx, y = from.y + dy, point = { x: x + 0.5, y: y + 0.5 }, key = `${x},${y}`;
        const cost = current.cost + distance(current, point);
        if (cost + distance(point, b) > limit || cost >= (costs.get(key) ?? Infinity) ||
            !pointWalkable(dungeon, point.x, point.y) || !canTraverse(dungeon, from, { x, y }) ||
            !lineClear(dungeon, current, point)) continue;
        costs.set(key, cost); queue.push({ ...point, cost });
      }
    }
    return false;
  }
  function dialogueReach(dungeon, actor, player) {
    const range = actor?.type === 'npc' ? COMPANION_DIALOGUE_RANGE : MONSTER_DIALOGUE_RANGE;
    const point = dialoguePoint(actor);
    const floorAt = p => dungeon?.cells?.[`${Math.floor(p.x)},${Math.floor(p.y)}`]?.floorHeight || 0;
    const distance = point && Number.isFinite(player?.x) && Number.isFinite(player?.y) ?
      Math.hypot(point.x - player.x, point.y - player.y, floorAt(point) - floorAt(player)) : Infinity;
    const present = !!dungeon && actor?.discoveryState !== 'pending' && (actor?.hp ?? 1) > 0 && state(actor) !== 'Dead' && actor?.type !== 'pc' &&
      roomKey(actor?.mazeRoomKey) === dungeon.geoKey && (actor?.type !== 'monster' || !['dead', 'recruited', 'departed'].includes(actor?.status));
    const lineOfSight = present && distance <= range && lineClear(dungeon, player, point);
    const canHear = !!lineOfSight || present && distance <= range && hearingClear(dungeon, player, point, range);
    return { canSpeak: !!canHear, canHear: !!canHear, distance, range, lineOfSight: !!lineOfSight };
  }
  function place(population, dungeon) {
    if (!population) return population;
    const indoor = dungeon.classification?.indoor ?? population.indoor;
    if (indoor) {
      let changed = population.indoor !== true;
      population.indoor = true;
      // Indoor residents exist at their saved sites immediately, never behind an outdoor travel counter.
      for (const group of population.groups) {
        const residents = group.members.map(name => population.actors[name]).filter(a => a?.status === 'present');
        if (group.status === 'exhausted' || !residents.length) continue;
        if (group.discoveryState !== 'fixed') { group.discoveryState = 'fixed'; changed = true; }
        for (const resident of residents) if (resident.discoveryState !== 'fixed') {
          resident.discoveryState = 'fixed'; changed = true;
        }
      }
      if (changed) population.revision++;
    }
    if (population.groups.every(g => g.site || g.status === 'exhausted')) return population;
    const stamp = dungeon._geometryStamp || `${dungeon.layout?.width}:${dungeon.layout?.height}`;
    if (population.placementStamp === stamp) return population;
    population.placementStamp = stamp;
    const tiles = reachable(dungeon);
    const available = new Map(tiles.map(t => [`${t.x},${t.y}`, t]));
    const occupied = new Set(Object.values(population.actors).filter(a => a.position).map(a => `${a.position.x},${a.position.y}`));
    const extent = Math.max(dungeon.layout?.width || 0, dungeon.layout?.height || 0);
    const gap = population.starting ? 0 : population.indoor ? 12 : Math.max(20, Math.min(60, extent / 9));
    const safeDistance = population.starting ? 2 : population.indoor ? 9 : 16;
    const smallGroups = population.groups.filter(g => !g.site && g.status !== 'exhausted' && g.members.length <= 3);
    const questGroup = !population.starting && population.questIntroduction?.status === 'pending' ?
      smallGroups.find(g => g.members.includes(population.questIntroduction.speaker) &&
        g.members.every(name => ['Neutral', 'Friendly'].includes(population.actors[name]?.allegiance))) : null;
    const arrivalSeed = hash(`${dungeon._geometryStamp || ''}:${population.geoKey}:arrival`);
    const entryGroup = questGroup || (!population.starting && arrivalSeed % 4 === 0 ? smallGroups[(arrivalSeed >>> 2) % smallGroups.length] : null);
    const candidates = tiles.filter(t => t.distance >= (entryGroup ? 2 : safeDistance) && !dungeon.cells[`${t.x},${t.y}`].object &&
      !dungeon.cells[`${t.x},${t.y}`].exitMarker);
    const sites = population.groups.map(g => g.site).filter(Boolean);
    const groups = entryGroup ? [entryGroup, ...population.groups.filter(g => g !== entryGroup)] : population.groups;
    for (const group of groups) {
      if (group.site || group.status === 'exhausted') continue;
      let site = null, best = -Infinity;
      // Sample a bounded number of sites, but across the entire reachable level.
      const pool = group === entryGroup ? candidates.filter(t => Math.hypot(t.x - dungeon.start.x, t.y - dungeon.start.y,
        (dungeon.cells[`${t.x},${t.y}`].floorHeight || 0) - (dungeon.cells[`${dungeon.start.x},${dungeon.start.y}`].floorHeight || 0)) <= MONSTER_DIALOGUE_RANGE &&
        lineClear(dungeon, { x: dungeon.start.x + .5, y: dungeon.start.y + .5 }, { x: t.x + .5, y: t.y + .5 })) : candidates;
      const stride = group === entryGroup ? 1 : Math.max(1, Math.floor(pool.length / 1400));
      const salt = hash(population.geoKey + group.id);
      for (let i = salt % stride; i < pool.length; i += stride) {
        const t = pool[i];
        if (t.distance < (group===entryGroup ? 2 : safeDistance)) continue;
        if (occupied.has(`${t.x},${t.y}`)) continue;
        const spacing = Math.min(...sites.map(p => Math.hypot(p.x - t.x, p.y - t.y)), Infinity);
        if (spacing < gap) continue;
        const floor = dungeon.cells[`${t.x},${t.y}`].floorHeight || 0;
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx,dy]) => available.has(`${t.x+dx},${t.y+dy}`) &&
          Math.abs((dungeon.cells[`${t.x+dx},${t.y+dy}`].floorHeight || 0) - floor) <= 1.5).length;
        if (neighbors < 2) continue;
        const preferred = population.starting || group===entryGroup ? -t.distance : -Math.abs(t.distance - safeDistance -
          (group.members.length + sites.length + 1) * Math.max(12, extent / (population.groups.length + 2)));
        const score = preferred + Math.min(spacing, extent) * 0.25 + hash(`${salt}:${t.x},${t.y}`) / 4294967296 * 8;
        if (score > best) { best = score; site = t; }
      }
      if (!site) continue; // Small or sealed levels never pile leftover groups at spawn.
      const cluster = [site], visited = new Set([`${site.x},${site.y}`]);
      for (let i = 0; i < cluster.length && i < 64 && cluster.length < 80; i++) {
        const t = cluster[i];
        for (const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
          const key = `${t.x+dx},${t.y+dy}`, next = available.get(key);
          if (!next || visited.has(key) || Math.hypot(next.x-site.x, next.y-site.y) > 4) continue;
          if (!canTraverse(dungeon, t, next)) continue;
          visited.add(key); cluster.push(next);
        }
      }
      const spaces = cluster.filter(t => !occupied.has(`${t.x},${t.y}`) && !dungeon.cells[`${t.x},${t.y}`].object);
      if (spaces.length < group.members.length) continue;
      group.site = { x: site.x, y: site.y }; sites.push(group.site);
      group.members.forEach((name, index) => {
        const record = population.actors[name], t = spaces[index];
        record.home = { x: t.x, y: t.y }; record.position = { ...record.home };
        occupied.add(`${t.x},${t.y}`);
      });
    }
    population.revision++;
    return population;
  }
  function sync(population, sheets, party = []) {
    if (!population) return null;
    const living = new Map((sheets || []).map(a => [keyOf(a.name || a.Name), a]));
    const allies = new Set(party.map(a => keyOf(a.name || a.Name)));
    for (const record of Object.values(population.actors)) {
      const actor = living.get(keyOf(record.name));
      if (allies.has(keyOf(record.name))) record.status = 'recruited';
      else if (actor) {
        // A partial/proximity-filtered console is an observation, not a room-wide roster.
        // Only positive evidence (a sheet, death or recruitment) changes a resident.
        if (typeof actor.sheet === 'string') record.sheet = actor.rawSheet || actor.sheet;
        if (record.status !== 'dead') record.hp = Number(actor.hp ?? actor.HP);
        if (ALLEGIANCES.includes(actor.storedState)) record.allegiance = allegiance({ state: actor.storedState });
        record.state = state(actor, record.allegiance);
        if (record.state === 'Dead') record.status = 'dead';
      }
      record.state = state({ ...record, state: isDown(record) ? record.state : record.allegiance });
    }
    for (const group of population.groups) {
      if (group.members.every(name => population.actors[name]?.status !== 'present')) group.status = 'exhausted';
    }
    return population;
  }
  function residentSheets(population, observed = []) {
    if (!population) return observed;
    const latest = new Map(observed.map(a => [keyOf(a.name), a]));
    const seeded = new Map(parseBlocks(population.initialSheets).map(a => [keyOf(a.name), a]));
    const records = Object.values(population.actors || {}), known = new Set(records.map(record => keyOf(record.name)));
    return records.flatMap(record => {
      if (!['present', 'dead'].includes(record.status)) return [];
      const current = latest.get(keyOf(record.name));
      const actor = current || parseBlocks(record.sheet)[0] || seeded.get(keyOf(record.name));
      if (!actor) return [];
      const hp = record.status === 'dead' ? Math.min(0, Number.isFinite(record.hp) ? record.hp : 0) :
        current ? actor.hp : Number.isFinite(record.hp) ? record.hp : actor.hp;
      const nextState = state({ ...record, hp, state: ['Dead', 'Unconscious', 'Dying'].includes(actor.state) ? actor.state : record.state || record.allegiance });
      const sheet = (actor.rawSheet || actor.sheet).replace(/^([ \t]*HP:[ \t]*)[^\r\n]*/m, (_, prefix) => prefix + hp)
        .replace(/^([ \t]*State:[ \t]*)[^\r\n]*/m, (_, prefix) => prefix + nextState);
      const parsed = parseBlocks(sheet)[0];
      return parsed ? [{ ...parsed, state: nextState }] : [];
    }).concat(observed.filter(actor => !known.has(keyOf(actor.name))));
  }
  function teams(combatants, population, space, input = '', fallback = 'Hostile') {
    attach(combatants, population, fallback);
    const living = combatants.filter(a => isAlive(a) && isPresent(a, population) && a.discoveryState !== 'pending'), pc = living.find(a => a.type === 'pc' && canAct(a)) || living.find(a => a.type === 'npc' && canAct(a));
    const explicit = String(input).trim().match(/^attack\s+(.+)$/i)?.[1]?.trim();
    const exact = explicit ? living.filter(a => a.type === 'monster' && keyOf(a.name) === keyOf(explicit)) : [];
    const matches = exact.length ? exact : explicit ? living.filter(a => a.type === 'monster' && keyOf(a.name).startsWith(keyOf(explicit))) : [];
    const provoking = matches.length===1 && (!population || !space || pc &&
      (space.canAttack(pc,matches[0]) || space.distance(matches[0],pc)<=(population.indoor ? 8 : 12)) && lineClear(space.dungeon,space.point(matches[0]),space.point(pc)));
    if (provoking && allegiance(matches[0]) === 'Neutral') {
      matches[0].allegiance = 'Hostile';
      matches[0].state = 'Hostile';
      const record = population?.actors?.[matches[0].name];
      if (record) record.allegiance = record.state = 'Hostile';
    }
    let hostiles = living.filter(a => allegiance(a, fallback) === 'Hostile');
    if(population && !pc)hostiles=[];
    if (explicit && (matches.length !== 1 || allegiance(matches[0]) === 'Friendly')) hostiles = [];
    if (population && space && pc) {
      const range = population.indoor ? 8 : 12;
      const target = matches[0];
      const groups = population.groups.filter(g => g.status !== 'exhausted');
      const eligible = groups.filter(g => hostiles.some(a => a.encounterId === g.id &&
        (g.status === 'engaged' && space.point(a) || space.canAttack(a, pc) || space.distance(a, pc) <= range &&
          lineClear(space.dungeon, space.point(a), space.point(pc)) || target === a && (space.canAttack(pc,a) || space.distance(a, pc) <= range) &&
          lineClear(space.dungeon, space.point(a), space.point(pc)))));
      const selected = eligible.find(g => target && g.members.includes(target.name)) || !explicit &&
        (eligible.find(g => g.status === 'engaged') || eligible.sort((a,b) =>
        Math.min(...hostiles.filter(h => h.encounterId === a.id).map(h => space.distance(h,pc))) -
        Math.min(...hostiles.filter(h => h.encounterId === b.id).map(h => space.distance(h,pc))))[0]);
      if (selected) selected.status = 'engaged';
      hostiles = hostiles.filter(a => a.encounterId === selected?.id && space.point(a));
    }
    const friends = living.filter(a => allegiance(a, fallback) === 'Friendly' &&
      (a.type !== 'monster' || !space || !pc || space.distance(a, pc) <= (population?.indoor ? 10 : 14) &&
        lineClear(space.dungeon, space.point(a), space.point(pc))));
    const allowed = new Set([...friends, ...hostiles]);
    return { friends, hostiles, combatants: [...allowed].filter(canAct), targets: actor =>
      (friends.includes(actor) ? hostiles : hostiles.includes(actor) ? friends : []).filter(a => a.hp > 0),
      spectators: living.filter(a => !allowed.has(a)) };
  }
  function filterInaudibleSpeech(prose, names, audibleNames) {
    const audible = new Set(audibleNames.map(keyOf));
    const tags = [...prose.matchAll(/\[\[SPEECH\s*:\s*("(?:[^"\\]|\\.)*"|[^\]]*)\s*\]\]([\s\S]*?)\[\[\/SPEECH\]\]/gi)].map(match => {
      let permitted = false;
      try { permitted = audible.has(keyOf(JSON.parse(match[1]))); } catch { /* Invalid identities cannot speak. */ }
      return { start: match.index, end: match.index + match[0].length, permitted };
    });
    const breaks = [...prose.matchAll(/\r?\n[ \t]*\r?\n/g)];
    const removals = tags.filter(tag => !tag.permitted).map(tag => {
      const before = breaks.filter(separator => separator.index < tag.start).at(-1);
      const after = breaks.find(separator => separator.index >= tag.end);
      let start = before ? before.index + before[0].length : 0, end = after?.index ?? prose.length;
      if (tags.some(other => other.permitted && other.start < end && other.end > start)) {
        start = tag.start; end = tag.end;
        if (prose[start - 1] === '"' && prose[end] === '"' ||
            prose[start - 1] === '\u201c' && prose[end] === '\u201d') { start--; end++; }
      }
      return { start, end };
    }).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const removal of removals) {
      const previous = merged.at(-1);
      if (previous && previous.end >= removal.start) previous.end = Math.max(previous.end, removal.end);
      else merged.push(removal);
    }
    let filtered = prose;
    for (const { start, end } of merged.reverse()) filtered = filtered.slice(0, start) + filtered.slice(end);
    filtered = filtered.split(/(\r?\n[ \t]*\r?\n)/).map(paragraph => {
      if (!/\[\[SPEECH\b/i.test(paragraph)) {
        const speech = extractAttributedSpeech(paragraph, names);
        if (speech.length && speech.every(row => !audible.has(keyOf(row.speaker)))) return '';
      }
      return paragraph;
    }).join('');
    return filtered === prose ? prose : filtered.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n').trim();
  }
  function extractDialogue(raw, names, options = {}) {
    const allowed = new Map(names.map(name => [keyOf(name), name]));
    const audible = Array.isArray(options.audibleNames) ? new Set(options.audibleNames.map(keyOf)) : null;
    const tagged = String(raw || '').match(/\[\[CHARACTER_DIALOGUE\]\]([\s\S]*?)\[\[\/CHARACTER_DIALOGUE\]\]/i);
    let parsed = [];
    if (tagged) { try { parsed = JSON.parse(tagged[1]); } catch {} }
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.spoken) ? parsed.spoken : [];
    let dialogue = rows.slice(0, 32).flatMap(row => {
      const speaker = allowed.get(keyOf(row?.speaker)), line = text(row?.line, MAX_SPEECH_LENGTH);
      return speaker && (!audible || audible.has(keyOf(speaker))) && line ? [{ speaker, line, ...(typeof row.remember === 'string' && row.remember.trim() ? { remember: text(row.remember, 180) } : {}) }] : [];
    });
    let prose=String(raw || '').replace(/\[\[CHARACTER_DIALOGUE\]\][\s\S]*?(?:\[\[\/CHARACTER_DIALOGUE\]\]|$)/ig, '').trim();
    if (audible) prose = filterInaudibleSpeech(prose, names, options.audibleNames);
    let { content, spans } = extractSpeechSpans(prose, allowed);
    if (spans.length) dialogue = dialogue.filter(row => !spans.some(span => span.line &&
      (span.line.includes(row.line) || row.line.includes(span.line))));
    const decisions = [], policy = options.responsePolicy || Audience?.currentPolicy?.();
    const gate = Audience && policy?.directed ? Audience.gate(policy, rows) : null;
    const attributed = extractAttributedSpeech(content, names, dialogue, spans, gate ? { accept(passage) {
      const accepted = gate(passage); decisions.push({ ...passage, accepted }); return accepted;
    } } : {});
    if (gate) {
      dialogue = dialogue.filter(row => policy.responders.includes(row.speaker));
      content = removeRejectedPassages(content, decisions);
    }
    dialogue = mergeAttributedSpeech(dialogue, attributed).filter(row => !audible || audible.has(keyOf(row.speaker)));
    const memories = new Map(rows.slice(0, 32).flatMap(row => {
      const speaker = allowed.get(keyOf(row?.speaker));
      return speaker && typeof row.remember === 'string' && row.remember.trim() ? [[speaker, text(row.remember, 180)]] : [];
    }));
    const recipients = new Map(rows.flatMap(row => {
      const speaker = allowed.get(keyOf(row?.speaker)), target = row?.recipient;
      const recipient = typeof target === 'string' && (/^PC$/i.test(target) ? 'PC' : allowed.get(keyOf(target)));
      return speaker && recipient && recipient !== speaker ? [[speaker, recipient]] : [];
    }));
    dialogue = dialogue.map(row => ({ ...row, ...(memories.has(row.speaker) ? { remember: memories.get(row.speaker) } : {}),
      ...(recipients.has(row.speaker) ? { recipient: recipients.get(row.speaker) } : {}) }));
    return { content, dialogue,
      replies: sanitizeReplies(parsed?.replies, names), exchanges: sanitizeExchanges(parsed?.exchanges, names) };
  }
  function extractSpeechSpans(prose, allowed) {
    const strip = value => value.replace(/\[\[\/?SPEECH(?:\s*:[\s\S]*?)?\]\]/gi, '');
    const spans = [];
    let content = '', cursor = 0;
    for (const match of prose.matchAll(/\[\[SPEECH\s*:\s*("(?:[^"\\]|\\.)*"|[^\]]*)\s*\]\]([\s\S]*?)\[\[\/SPEECH\]\]/gi)) {
      content += strip(prose.slice(cursor, match.index));
      let name;
      try { name = JSON.parse(match[1]); } catch { /* Malformed labels cannot identify a speaker. */ }
      const nested = /\[\[\/?SPEECH\b/i.test(match[2]), body = strip(match[2]);
      const speaker = !nested && typeof name === 'string' ? allowed.get(keyOf(name)) || null : null;
      const escapedBody = body.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const duplicate = speaker && escapedBody && content.match(new RegExp(`(?:"${escapedBody}"|\u201c${escapedBody}\u201d)\\s*$`));
      if (duplicate && extractAttributedSpeech(content, [...allowed.values()], [], spans).at(-1)?.speaker === speaker) {
        // Some model responses append a labelled copy instead of tagging the existing quote.
        content = content.trimEnd();
        if (!spans.some(span => span.speaker === speaker && span.start <= duplicate.index && span.end >= content.length))
          spans.push({ start: duplicate.index, end: content.length, speaker, line: text(body, MAX_SPEECH_LENGTH) });
        cursor = match.index + match[0].length;
        continue;
      }
      const start = content.length, following = prose.slice(match.index + match[0].length);
      const outsideQuotes = /"\s*$/.test(content) && /^\s*"/.test(following) ||
        /\u201c\s*$/.test(content) && /^\s*\u201d/.test(following);
      const insideQuotes = /^\s*(?:"[\s\S]*"|\u201c[\s\S]*\u201d)\s*$/.test(body);
      if (speaker && body.trim() && !outsideQuotes && !insideQuotes) {
        // Labels identify speech even when the model forgets visible dialogue formatting.
        const paragraph = content.split(/\r?\n[ \t]*\r?\n/).at(-1);
        const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const first = speaker.split(/\s+/)[0], uniqueFirst = [...allowed.values()].filter(n => n.split(/\s+/)[0] === first).length === 1;
        const reference = uniqueFirst ? `(?:${escaped}|${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})` : escaped;
        if (!new RegExp(`(?:^|[^\\w])${reference}(?=$|[^\\w])`, 'i').test(paragraph)) content += `${speaker} says, `;
        content += '"' + body.trim() + '"';
      } else content += body;
      spans.push({ start, end: content.length, speaker, line: text(insideQuotes ? body.trim().slice(1, -1) : body, MAX_SPEECH_LENGTH) });
      cursor = match.index + match[0].length;
    }
    content += strip(prose.slice(cursor));
    return { content, spans };
  }
  function mergeAttributedSpeech(explicit, attributed) {
    const speakers = new Set(attributed.map(row => row.speaker));
    const rows = attributed.map(row => {
      const metadata = explicit.find(entry => entry.speaker === row.speaker && typeof entry.line === 'string' &&
        (row.line.includes(entry.line) || entry.line.includes(row.line)));
      return { ...row, ...(metadata?.remember ? { remember: metadata.remember } : {}),
        ...(metadata?.attribution ? { attribution: metadata.attribution } : {}),
        ...(metadata?.recipient ? { recipient: metadata.recipient } : {}) };
    });
    return [...rows, ...explicit.filter(row => !speakers.has(row.speaker))].slice(0, 32);
  }
  function removeRejectedPassages(content, decisions) {
    const breaks = [...content.matchAll(/\r?\n[ \t]*\r?\n/g)], ranges = [];
    for (const row of decisions.filter(p => !p.accepted)) {
      const before = breaks.filter(b => b.index < row.start).at(-1), after = breaks.find(b => b.index >= row.end);
      let start = before ? before.index + before[0].length : 0, end = after?.index ?? content.length;
      if (decisions.some(p => p.accepted && p.start < end && p.end > start)) {
        start = row.start; end = row.end;
        if (row.labelled && (content[start - 1] === '"' && content[end] === '"' || content[start - 1] === '\u201c' && content[end] === '\u201d')) { start--; end++; }
        const escaped = row.speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), first = escaped.split(/\s+/)[0];
        const prefix = content.slice(0, start).match(new RegExp(`(?:${escaped}|${first})\\s+(?:says|said|replies|replied|adds|added|murmurs|muttered|responds|answers|whispers|warns)\\b[^.!?\\n"\\u201c]{0,50}$`, 'i'));
        if (prefix) start -= prefix[0].length;
      }
      ranges.push({ start, end });
    }
    if (!ranges.length) return content;
    const merged = [];
    for (const row of ranges.sort((a, b) => a.start - b.start)) {
      const previous = merged.at(-1);
      if (previous && previous.end >= row.start) previous.end = Math.max(previous.end, row.end); else merged.push(row);
    }
    for (const row of merged.reverse()) content = content.slice(0, row.start) + content.slice(row.end);
    return content.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n').trim();
  }
  function extractAttributedSpeech(raw, names, evidence = [], spans = [], options = {}) {
    const matches = [];
    const prose = String(raw || '');
    const verb='(?:says|said|asks|asked|warns|warned|murmurs|murmured|whispers|whispered|replies|replied|calls|called|growls|growled|mutters|muttered|shouts|shouted|adds|added|continues|continued|answers|answered|responds|responded|explains|explained|declares|declared|tells|told|hisses|hissed|sneers|sneered|booms|boomed)';
    const allowed = [...new Set(names)].slice(0, 32), escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliases = new Map();
    for (const name of allowed) {
      const first = name.split(/\s+/)[0].toLowerCase();
      aliases.set(first, (aliases.get(first) || 0) + 1);
    }
    const titles = new Map();
    for (const name of allowed) {
      const title = name.match(/\bthe\s+(.+)$/i)?.[0]?.toLowerCase();
      if (title) titles.set(title, (titles.get(title) || 0) + 1);
    }
    const patterns = new Map(allowed.map(name => {
      const first = name.split(/\s+/)[0], short = first.length >= 4 && aliases.get(first.toLowerCase()) === 1;
      const title = name.match(/\bthe\s+(.+)$/i)?.[0];
      const terms = [escape(name), ...(short && first !== name ? [escape(first)] : []),
        ...(title && titles.get(title.toLowerCase()) === 1 ? [escape(title)] : [])];
      return [name, `(?:${terms.join('|')})`];
    }));
    const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
    const witnesses = (Array.isArray(evidence) ? evidence : []).filter(row => allowed.includes(row?.speaker) && typeof row.line === 'string');
    const vocal = '\\b(?:voice|tone|gaze|eyes|lips|mouth|expression|face)\\b';
    const action = '(?:pauses?|paused|nods?|nodded|turns?|turned|smiles?|smiled|hesitates?|hesitated|leans?|leaned|stands?|stood|shifts?|shifted|looks?|looked|raises?|raised|lowers?|lowered|draws?|drew|steps?|stepped|sighs?|sighed|stills?|stilled|slows?|slowed|keeps?|kept|remains?|remained|holds?|held|rests?|rested|brushes|brushed|rubs?|rubbed|wipes?|wiped|folds?|folded|presses|pressed)';
    // Resolve the narrative subject clause by clause, rather than requiring a
    // name immediately beside every quote or possessive voice/gaze reference.
    function narrativeOwner(prefix, previous) {
      let subject = previous, framed = false, blocked = false;
      const heading = prefix.match(/(?:^|\n)\s*([A-Za-z][\w '\u2019-]{0,80}):\s*$/);
      if (heading) {
        const owners = allowed.filter(name => new RegExp(`^${patterns.get(name)}$`, 'i').test(heading[1].trim()));
        return { speaker: owners.length === 1 ? owners[0] : null, subject: owners.length === 1 ? owners[0] : null, blocked: owners.length !== 1 };
      }
      for (const clause of prefix.match(/[^.!?;\n]+[.!?;]?/g) || []) {
        if (/\b(?:inscription|engraving|plaque|written|reads|reading|carved words|thinks|thought to|wonders to|silently recalls)\b/i.test(clause)) {
          blocked = true; framed = false; continue;
        }
        if (new RegExp(`\\b(?:you|the player|the narrator)\\s+(?:${verb}|say|tell|answer|respond|reply|ask|speak)\\b|\\byour\\s+(?:voice|words)\\b`, 'i').test(clause)) {
          subject = null; blocked = true; framed = false; continue;
        }
        const references = allowed.flatMap(name => [...clause.matchAll(new RegExp(`(?:^|[^\\w])(${patterns.get(name)})(?=$|[^\\w])`, 'gi'))]
          .map(match => ({ name, start: match.index + match[0].length - match[1].length, end: match.index + match[0].length })));
        references.sort((a, b) => a.start - b.start);
        const mentioned = [...new Set(references.map(row => row.name))], agents = [];
        for (const ref of references) {
          const before = clause.slice(0, ref.start), after = clause.slice(ref.end);
          const object = /\b(?:to|toward|towards|at|with|beside|near|behind|about|from|of)\s*$/i.test(before);
          const bodyOwner = /\b(?:carapace|body|face|eyes|gaze|voice|tone|lips|mouth|hands|wings)\b[^,;.!?]{0,50}\bof\s*$/i.test(before);
          const predicate = new RegExp(`^\\s+(?:[\\w-]+\\s+){0,2}(?:${verb}|${action})\\b`, 'i').test(after);
          const possession = new RegExp(`^['\\u2019]s\\b[^,;.!?]*${vocal}`, 'i').test(after);
          if ((!object || bodyOwner) && (predicate || possession || bodyOwner)) agents.push(ref.name);
        }
        const owners = [...new Set(agents)], grouped = references.length > 1 && references.some(ref => /\b(?:and|or)\s*$/i.test(clause.slice(0, ref.start)));
        const lastSubject = subject;
        if (owners.length === 1 && !grouped) subject = owners[0];
        else if (mentioned.length > 1) subject = null;
        else if (mentioned.length === 1 && !/\b(?:to|toward|towards|at|with|beside|near|behind|about|from)\s*$/i.test(clause.slice(0, references[0].start))) subject = mentioned[0];
        if (subject !== lastSubject) framed = false;
        // Unknown named voices cannot inherit the last known character's identity.
        let unknownVoice = false;
        for (const owner of clause.matchAll(/\b([A-Za-z][\w-]*)['\u2019]s\s+(?:[\w-]+\s+){0,3}(?:voice|tone|words)\b/g)) {
          if (!allowed.some(name => name.toLowerCase().split(/\s+/).includes(owner[1].toLowerCase()))) unknownVoice = true;
        }
        for (const owner of clause.matchAll(new RegExp(`\\b([A-Z][a-z]+)\\s+${verb}\\b`, 'g'))) {
          if (!['He', 'She', 'They'].includes(owner[1]) && !allowed.some(name => name.toLowerCase().split(/\s+/).includes(owner[1].toLowerCase())))
            unknownVoice = true;
        }
        if (unknownVoice) { subject = null; blocked = true; framed = false; continue; }
        const pronoun = /\b(?:he|she|they)\s+[\w-]+|\b(?:his|her|their)\s+(?:[\w-]+\s+){0,3}(?:voice|tone|gaze|eyes|lips|mouth|expression|face|thumb|fingers?|hands?|palms?|knuckles?|claws?|talons?|paws?|arms?|shoulders?|head|chin|jaw|ears?|wings?|tail)\b/i.test(clause);
        if (subject && (new RegExp(`${vocal}|\\b${verb}\\b`, 'i').test(clause) || pronoun || owners.length === 1)) { framed = true; blocked = false; }
      }
      return { speaker: framed && !blocked ? subject : null, subject, blocked };
    }
    for (const name of allowed) {
      const escaped = patterns.get(name);
      const before=new RegExp(`(?:^|[^\\w])${escaped}(?:\\s*:|\\s+${verb}[^"\\u201c\\n]{0,50})\\s*["\\u201c]([^"\\u201d]{1,${MAX_SPEECH_LENGTH}})["\\u201d]`,'gi');
      const after=new RegExp(`["\\u201c]([^"\\u201d]{1,${MAX_SPEECH_LENGTH}})["\\u201d]\\s*[,;]?\\s*${escaped}\\s+${verb}`,'gi');
      for (const expression of [before,after]) for (const match of String(raw || '').matchAll(expression)) {
        const opening = expression === before ? match[0].length - match[1].length - 2 : 0;
        matches.push({ index: match.index + opening, speaker: name, leading: expression === before });
      }
    }
    // Explicit backend spans identify speech first; legacy untagged quotes use
    // the conservative narrative resolver without rewriting any prose.
    let previousQuoteEnd = 0, previousSpeaker = null, quoteCount = 0;
    const dialogue = [];
    const labelled = spans.map(span => ({ index: span.start, end: span.end, labelled: true, speaker: span.speaker, line: span.line }));
    const quotedEvents = [...prose.matchAll(new RegExp(`\\u201c([^\\u201d]{1,${MAX_SPEECH_LENGTH}})\\u201d|"([^"]{1,${MAX_SPEECH_LENGTH}})"`, 'g'))]
      .filter(quote => !spans.some(span => quote.index < span.end && quote.index + quote[0].length > span.start))
      .map(quote => ({ index: quote.index, end: quote.index + quote[0].length, line: quote[1] ?? quote[2] }));
    const append = (speaker, line, labelled = false) => {
      const previous = dialogue.at(-1);
      if (previous?.speaker === speaker && previous.line.length + line.length + 1 <= MAX_SPEECH_LENGTH) {
        previous.line += ' ' + line;
        if (!labelled) delete previous.attribution;
      } else dialogue.push({ speaker, line, ...(labelled ? { attribution: 'labelled' } : {}) });
    };
    for (const quote of [...quotedEvents, ...labelled].sort((a, b) => a.index - b.index)) {
      if (++quoteCount > 64) break;
      if (quote.labelled) {
        if (quote.speaker && quote.line && (!options.accept || options.accept({ speaker: quote.speaker, line: quote.line, start: quote.index, end: quote.end, labelled: true })))
          append(quote.speaker, quote.line, true);
        previousSpeaker = quote.speaker; previousQuoteEnd = quote.end;
        continue;
      }
      const quoted = quote.line;
      const prefix = prose.slice(Math.max(previousQuoteEnd, quote.index - 1200), quote.index);
      const suffix = prose.slice(quote.end, quote.end + 75);
      const candidates = matches.filter(row => row.index === quote.index), leading = candidates.filter(row => row.leading);
      const direct = [...new Set((leading.length ? leading : candidates).map(row => row.speaker))];
      let speaker = direct.length === 1 ? direct[0] : null;
      const context = narrativeOwner(prefix, previousSpeaker);
      if (!direct.length && context.blocked) speaker = null;
      if (!speaker && !direct.length && !context.blocked) {
        speaker = context.speaker;
        if (!speaker && context.subject && new RegExp(`^\\s*[,;]?\\s*(?:she|he|they)\\s+${verb}`, 'i').test(suffix)) speaker = context.subject;
        if (!speaker) {
          const line = normalized(quoted);
          const supported = [...new Set(witnesses.filter(row => {
            const words = normalized(row.line);
            return words.length >= 12 && (line.includes(words) || words.includes(line));
          }).map(row => row.speaker))];
          if (supported.length === 1) speaker = supported[0];
        }
      }
      if (speaker) {
        if (!options.accept || options.accept({ speaker, line: quoted, start: quote.index, end: quote.end, labelled: false }))
          append(speaker, text(quoted, MAX_SPEECH_LENGTH));
      }
      previousSpeaker = speaker;
      previousQuoteEnd = quote.end;
    }
    return dialogue.slice(0, 32);
  }
  function sanitizeReplies(rows, names) {
    const allowed = new Map(names.map(name => [keyOf(name), name])), seen = new Set();
    const valid = (Array.isArray(rows) ? rows : []).slice(0, 32).flatMap(row => {
      const speaker = allowed.get(keyOf(row?.speaker));
      const lines = [...new Set((Array.isArray(row?.lines) ? row.lines : []).filter(line=>typeof line==='string').map(line => text(line, 220)).filter(Boolean))].slice(0, 8);
      if (!speaker || !lines.length || seen.has(speaker)) return [];
      seen.add(speaker); return [{ speaker, lines }];
    });
    if (valid.reduce((sum, row) => sum + row.lines.length, 0) <= 64) return valid;
    const bounded = valid.map(row => ({ speaker: row.speaker, lines: row.lines.slice(0, 2) }));
    let remaining = 64 - bounded.reduce((sum, row) => sum + row.lines.length, 0);
    while (remaining > 0 && bounded.some((row, i) => row.lines.length < valid[i].lines.length)) {
      for (const [i, row] of bounded.entries()) if (remaining > 0 && row.lines.length < valid[i].lines.length) {
        row.lines.push(valid[i].lines[row.lines.length]); remaining--;
      }
    }
    return bounded;
  }
  function splitSpeech(raw, maxChars = 320, maxWords = 56) {
    maxChars = Number.isInteger(maxChars) && maxChars >= 40 ? maxChars : 320;
    maxWords = Number.isInteger(maxWords) && maxWords >= 4 ? maxWords : 56;
    const speech = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!speech) return [];
    const sentences = typeof Intl !== 'undefined' && Intl.Segmenter ?
      [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(speech)].map(row => row.segment.trim()) :
      speech.match(/[^.!?]+(?:[.!?]+["'\u201d)\]]*(?:\s+|$)|$)/g)?.map(row => row.trim()) || [speech];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      const next = current ? current + ' ' + sentence : sentence;
      if (current && (next.length > maxChars || next.split(' ').length > maxWords)) { chunks.push(current); current = ''; }
      // Character/word targets are soft for complete sentences. Only hard-wrap
      // unusually long unpunctuated fragments so malformed speech cannot overflow.
      if (!/[.!?]["'\u201d)\]]*$/.test(sentence) && sentence.length > maxChars) {
        chunks.push(...wrapSpeechFragment(sentence, maxChars, maxWords));
      } else current = current ? current + ' ' + sentence : sentence;
    }
    if (current) chunks.push(current);
    return chunks;
  }
  function wrapSpeechFragment(raw, maxChars, maxWords) {
    let remaining = String(raw || '').replace(/\s+/g, ' ').trim();
    const chunks = [];
    while (remaining) {
      if (remaining.length <= maxChars && remaining.split(' ').length <= maxWords) { chunks.push(remaining); break; }
      const window = remaining.slice(0, maxChars + 1), words = [...window.matchAll(/\S+/g)];
      let end = Math.min(maxChars, words.length > maxWords ? words[maxWords].index : maxChars);
      const space = remaining.lastIndexOf(' ', end);
      if (space > 0) end = space;
      const sentences = [...remaining.slice(0, end).matchAll(/[.!?;](?:["')\]]?)(?=\s|$)/g)];
      const sentence = sentences.at(-1);
      if (sentence && sentence.index >= end * .45) end = sentence.index + sentence[0].length;
      chunks.push(remaining.slice(0, end).trim()); remaining = remaining.slice(end).trimStart();
    }
    return chunks;
  }
  function sanitizeExchanges(rows, names) {
    const allowed = new Map(names.map(name => [keyOf(name), name]));
    return (Array.isArray(rows) ? rows : []).slice(0, 2).flatMap(exchange => {
      if (!Array.isArray(exchange?.lines) || exchange.lines.length !== 2) return [];
      const lines = exchange.lines.flatMap(row => {
        const speaker = allowed.get(keyOf(row?.speaker)), line = typeof row?.line === 'string' ? text(row.line, 220) : '';
        return speaker && line ? [{ speaker, line }] : [];
      });
      return lines.length === 2 && lines[0].speaker !== lines[1].speaker ? [{ lines }] : [];
    });
  }
  const RECENT_SPEECH_MS = 10 * 60 * 1000;
  const speechWords = value => String(value || '').toLowerCase().replace(/\bcan['\u2019]t\b/g, 'can not')
    .replace(/\bwon['\u2019]t\b/g, 'will not').replace(/n['\u2019]t\b/g, ' not').replace(/[^\p{L}\p{N}?]+/gu, ' ').trim();
  const speechFillers = new Set(('a an the i me my we us our you your he him his she her they them their it its ' +
    'is are was were be been being am do does did have has had can could will would should may might ' +
    'to of in on at by for from with and or but as that this these those then than so if not no never ' +
    'here there still same only very just say tell').split(' '));
  function speechRepeats(line, recent) {
    const candidate = speechWords(line), words = candidate.replace(/\?/g, '').trim();
    if (!words) return false;
    const tokens = new Set(words.split(' ').filter(word => !speechFillers.has(word)));
    const passages = (recent || []).flatMap(raw => {
      const sentences = String(raw || '').match(/[^.!?]+[.!?]*/g)?.slice(0, 32) || [];
      return [raw, ...sentences.flatMap((_, i) => [1, 2, 3].map(size => sentences.slice(i, i + size).join(' ')))];
    });
    return passages.some(raw => {
      const reference = speechWords(raw), referenceWords = reference.replace(/\?/g, '').trim();
      if (candidate === reference) return true;
      if (candidate.includes('?') && !reference.includes('?')) return false;
      if (words.split(' ').length >= 4 && ` ${referenceWords} `.includes(` ${words} `)) return true;
      if (tokens.size < 5 || /\b(?:not|no|never)\b/.test(candidate) !== /\b(?:not|no|never)\b/.test(reference)) return false;
      const other = new Set(referenceWords.split(' ').filter(word => !speechFillers.has(word)));
      // Only shortened lexical restatements, not general topic similarity.
      return [...tokens].every(word => other.has(word)) && tokens.size / other.size >= 0.45;
    });
  }
  function recentSpeech(record, now = Date.now()) {
    const rows = Array.isArray(record?.recentSpeech) ? record.recentSpeech :
      (record?.memory?.recent || []).map(line => ({ line, at: record.lastSpokeAt }));
    return rows.slice(-8).filter(row => typeof row?.line === 'string' && row.at <= now && now - row.at < RECENT_SPEECH_MS)
      .map(row => row.line.slice(0, 640));
  }
  function rememberSpeech(record, line, now = Date.now()) {
    if (!record) return;
    const previous = recentSpeech(record, now);
    const chunks = splitSpeech(line, 640, 112).slice(-8).map(value => value.slice(0, 640));
    record.recentSpeech = [
      ...(Array.isArray(record.recentSpeech) ? record.recentSpeech : []).filter(row => previous.includes(row?.line) && !chunks.includes(row.line)),
      ...chunks.map(value => ({ line: value, at: now }))
    ].slice(-8);
  }
  function applyReplies(population, rows, roster = [], options = {}) {
    if (!population) return 0;
    population.companions ||= {};
    let count = 0;
    for (const {speaker, lines} of sanitizeReplies(rows, roster.filter(a => a.type !== 'pc' && (a.hp ?? 1)>0 && state(a)!=='Dead').map(a=>a.name))) {
      const actor = roster.find(a=>a.name===speaker);
      if (actor.type==='npc' && !Object.hasOwn(population.companions,speaker)) {
        const source=population.actors[speaker] || actor;
        Object.defineProperty(population.companions,speaker,{value:{name:speaker,dialogue:[],dialogueIndex:0,
          job:source.job,activity:source.activity,personality:source.personality,motivation:source.motivation,
          race:source.race,className:source.className,
          ...(Array.isArray(source.recentSpeech) ? { recentSpeech: source.recentSpeech.slice(-8).map(row => ({ ...row })) } : {})},enumerable:true,configurable:true,writable:true});
      }
      const record = actor.type==='npc' ? population.companions[speaker] : population.actors[speaker];
      if (!record || actor.type==='monster' && record.status!=='present') continue;
      record.dialogue = lines.filter(line => !speechRepeats(line, recentSpeech(record)));
      record.dialogueIndex = 0; count++;
    }
    const exchanges = sanitizeExchanges(options.exchanges, roster.filter(a => a.type === 'npc' && (a.hp ?? 1)>0 && state(a)!=='Dead').map(a=>a.name))
      .filter(exchange => exchange.lines.every(row => !speechRepeats(row.line, recentSpeech(population.companions[row.speaker]))));
    if (count || exchanges.length) {
      population.dialogueQueue = exchanges;
      population.lastDialogueRefreshAt = Date.now(); population.replyRevision = (population.replyRevision || 0)+1;
    }
    if (!count && exchanges.length) count = new Set(exchanges.flatMap(exchange => exchange.lines.map(row => row.speaker))).size;
    return count;
  }
  function dialogueRecipient(row, actors = []) {
    const others = actors.filter(actor => actor.name !== row?.speaker && actor.type !== 'pc');
    const explicit = row?.recipient || row?.addressee;
    if (typeof explicit === 'string') {
      const actor = actors.find(actor => keyOf(actor.name) === keyOf(explicit));
      if (actor && actor.name !== row.speaker) return actor.name;
      if (/^PC$/i.test(explicit)) return 'PC';
    }
    const words = String(row?.line || '').trim();
    const addressed = others.filter(actor => [actor.name, actor.name.split(/\s+/)[0]].some(name =>
      new RegExp('^(?:(?:Listen|Look|Tell me|Thank you|Thanks|Please|Hey),?\\s+)?' +
        name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,!:?](?:\\s|$)', 'i').test(words)));
    return addressed.length === 1 ? addressed[0].name : 'PC';
  }
  function noteSpoken(population, rows, entry = false) {
    if (!population || !rows.length) return;
    population.lastCannedSpeechAt=Date.now();
    for (const row of rows) {
      const record=population.actors[row.speaker];
      if (entry && record && !hasEncountered({ name: row.speaker, type: 'monster' }, population)) continue;
      if (record?.status === 'present' && row.speaker === population.questIntroduction?.speaker) population.questIntroduction.status = 'introduced';
      const group=record && population.groups.find(g=>g.id===record.encounterId);
      if (entry && record?.status==='present' && group) {
        group.introPlayed=true;
      }
      const cache=population.companions?.[row.speaker] || record;
      const index=cache?.dialogue?.indexOf(row.line) ?? -1;
      if (index>=0) cache.dialogueIndex=Math.max(cache.dialogueIndex,index+1);
      if (cache) {
        rememberSpeech(cache, row.line);
        cache.lastSpokeAt = Date.now();
        const cursor = cache.dialogueIndex || 0, recent = recentSpeech(cache);
        cache.dialogue = [...(cache.dialogue || []).slice(0, cursor),
          ...(cache.dialogue || []).slice(cursor).filter(line => !speechRepeats(line, recent))];
        population.dialogueQueue = (population.dialogueQueue || []).filter(exchange =>
          exchange.lines.every(part => part.speaker !== row.speaker || !speechRepeats(part.line, recent)));
      }
    }
  }
  function perceive(dungeon, roster, population, entry = false) {
    const pc = roster.find(a=>a.type==='pc');
    const continuous=pc?.mazePoint;
    const player = !entry && roomKey(pc?.mazeRoomKey)===dungeon?.geoKey && Number.isFinite(pc?.mazeX) ?
      continuous && Math.floor(continuous.x)===pc.mazeX && Math.floor(continuous.y)===pc.mazeY ? {x:continuous.x,y:continuous.y} :
      {x:pc.mazeX+0.5,y:pc.mazeY+0.5} : dungeon?.start && {x:dungeon.start.x+0.5,y:dungeon.start.y+0.5};
    if (!dungeon || !player) return { player, nearby: [], conversational: [], distant: [] };
    const living = roster.filter(a=>a.type!=='pc' && a.discoveryState !== 'pending' && (a.hp ?? 1)>0 && state(a) !== 'Dead' &&
      (a.type==='npc' || population?.actors?.[a.name]?.status==='present'));
    const nearby = living.filter(a=>a.type==='npc' && entry || roomKey(a.mazeRoomKey)===dungeon.geoKey &&
      Math.hypot(a.mazeX+0.5-player.x,a.mazeY+0.5-player.y)<=(population?.indoor ? 8 : 12) &&
      lineClear(dungeon,player,{x:a.mazeX+0.5,y:a.mazeY+0.5}));
    const conversational = living.filter(a => a.type === 'npc' && entry || dialogueReach(dungeon, a, player).canSpeak);
    return { player, nearby, conversational, distant: living.filter(a=>!nearby.includes(a)) };
  }
  function nearbyMonsterNames(dungeon, roster, population, player) {
    if (!dungeon || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return [];
    const metadata = population?.geoKey === dungeon.geoKey ? population.actors : {};
    const records = new Map(Object.values(metadata || {}).filter(a => a.discoveryState !== 'pending' && ['present', 'dead'].includes(a.status)).map(a => [a.name, a]));
    for (const actor of roster || []) if (actor.type === 'monster' && roomKey(actor.mazeRoomKey) === dungeon.geoKey &&
        Number.isFinite(actor.mazeX) && Number.isFinite(actor.mazeY)) {
      const record = records.get(actor.name);
      if (actor.discoveryState === 'pending' || metadata?.[actor.name] && !record) continue;
      records.set(actor.name, { ...record, name: actor.name, position: { x: actor.mazeX, y: actor.mazeY } });
    }
    const engaged = new Set(population?.geoKey === dungeon.geoKey ?
      population.groups.filter(g => g.status === 'engaged').map(g => g.id) : []);
    return [...records.values()].filter(a => {
      if (!a.position) return false;
      if (engaged.has(a.encounterId)) return true;
      const point = { x: a.position.x + 0.5, y: a.position.y + 0.5 };
      if (Math.hypot(point.x - player.x, point.y - player.y) >
          ((population?.indoor ?? dungeon.classification?.indoor) ? 8 : 12)) return false;
      return lineClear(dungeon, player, point) || a.encounteredAt > 0 &&
        dialogueReach(dungeon, { ...a, type: 'monster', mazeX: a.position.x, mazeY: a.position.y,
          mazeRoomKey: dungeon.geoKey }, player).canSpeak;
    }).map(a => a.name);
  }
  function hostileEncounterNames(dungeon, roster, population, player) {
    if (!dungeon || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return [];
    const local = (roster || []).filter(a => a.type === 'monster' && (a.hp ?? 1) > 0 && state(a) !== 'Dead' &&
      a.discoveryState !== 'pending' && isPresent(a, population) && allegiance(a) === 'Hostile' &&
      roomKey(a.mazeRoomKey) === dungeon.geoKey && Number.isFinite(a.mazeX) && Number.isFinite(a.mazeY));
    const engaged = population?.geoKey === dungeon.geoKey && population.groups.find(g => g.status === 'engaged' &&
      local.some(a => a.encounterId === g.id));
    if (engaged) return local.filter(a => a.encounterId === engaged.id).map(a => a.name);
    const nearby = local.filter(a => Math.hypot(a.mazeX + 0.5 - player.x, a.mazeY + 0.5 - player.y) <=
      (population?.indoor ? 8 : 12) && lineClear(dungeon, player, { x: a.mazeX + 0.5, y: a.mazeY + 0.5 }))
      .sort((a, b) => Math.hypot(a.mazeX + 0.5 - player.x, a.mazeY + 0.5 - player.y) -
        Math.hypot(b.mazeX + 0.5 - player.x, b.mazeY + 0.5 - player.y));
    return nearby.filter(a => a.encounterId === nearby[0]?.encounterId).map(a => a.name);
  }
  function perceivedConsole(consoleText, names) {
    const visible = new Set((names || []).map(keyOf));
    const sheets = parseSheets(consoleText).filter(a => visible.has(keyOf(a.name)));
    const block = sheets.length ? '\n' + sheets.map(a => a.lines.map((line, i) => i ? '        ' + line : line).join('\n')).join('\n') + '\n' : ' None\n';
    let value = String(consoleText || '').replace(sectionPattern('Monsters in Room'), (_, header) => header + block);
    if (!sheets.length) value = value.replace(/^Monsters Equipped Properties:[^\r\n]*/m, 'Monsters Equipped Properties: None');
    const states = new Set(sheets.map(a => state(a)));
    return value.replace(/^Monsters State:[^\r\n]*/m, `Monsters State: ${states.size > 1 ? 'Mixed' : [...states][0] || 'None'}`);
  }
  function consoleView(value, previous = {}) {
    const text = String(value || ''), line = label => text.match(new RegExp(`^${label}:[ \\t]*([^\\r\\n]*)`, 'm'))?.[1]?.trim();
    return { ...previous, roomName: line('Room Name'), roomDescription: line('Room Description'), coordinates: line('Coordinates'),
      objects: line('Objects in Room') || 'None', objectsInRoomProperties: line('Objects in Room Properties') || 'None',
      exits: line('Exits') || 'None', inventory: line('Inventory') || 'Empty', inventoryProperties: line('Inventory Properties') || 'None',
      silverPieces: Math.max(0, Number(line('Silver Pieces')) || 0), region: line('Region') || 'Tartarus',
      patronage: line('Patronage') || 'None recorded',
      community: line('Community') || 'None nearby', localMissions: line('Local Missions') || 'None',
      pc: text.match(/PC:([\s\S]*?)(?=NPCs in Party:)/)?.[1]?.trim() || 'No PC data',
      npcs: text.match(/NPCs in Party:([\s\S]*?)(?=Monsters in Room:)/)?.[1]?.trim() || 'None',
      monsters: text.match(/Monsters in Room:([\s\S]*?)(?=Monsters Equipped Properties:)/)?.[1]?.trim() || 'None',
      monstersState: line('Monsters State') || 'None', puzzle: { inRoom: line('Puzzle in Room') || 'None', solution: line('Puzzle Solution') || 'None' },
      currentQuest: line('Current Quest') || 'None', questProgress: line('Quest Progress') || '',
      questRequirements: line('Quest Requirements') || '', nextArtifact: line('Next Artifact') || 'None',
      nextBoss: line('Next Boss') || 'None', nextBossRoom: line('Next Boss Room') || 'None', bossCoordinates: line('Boss Room Coordinates') || 'None',
      adjacentRooms: line('Adjacent Rooms') || 'None' };
  }
  const api = { VERSION, DIALOGUE_REFRESH_MS, MONSTER_DIALOGUE_RANGE, COMPANION_DIALOGUE_RANGE, MAX_SPEECH_LENGTH, dialoguePoint, dialogueReach, dialogueRecipient, isDown, isAlive, canAct,
    STATES, ROUTINES, EQUIPMENT_SLOTS, equipmentName, parseEquipment, parseEquipmentProperties,
    roomKey, allegiance, state, isPresent, hasEncountered, sectionPattern, parseBlocks, parseSheets, withStates, normalizeDescriptors, createPopulation,
    attach, pursuitPolicy, ceilingHeight, walkable, pointWalkable, canTraverse, reachable, lineClear, hearingClear, place, sync, residentSheets, teams, extractDialogue, extractAttributedSpeech, mergeAttributedSpeech, splitSpeech, sanitizeReplies, sanitizeExchanges, speechRepeats, recentSpeech, rememberSpeech, applyReplies, noteSpoken, perceive, nearbyMonsterNames, hostileEncounterNames, perceivedConsole, consoleView, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DungeonInhabitants = api;
})(typeof window === 'undefined' ? globalThis : window);
