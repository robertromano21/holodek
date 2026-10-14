'use strict';
const Contracts = require('./generationContracts');
const Diagnostics = require('./generationDiagnostics');
const { randomUUID, randomInt } = require('node:crypto');
const I = require('../assets/dungeonInhabitants'), Inventory = require('../assets/inventoryUi');
const Rules = require('../assets/spellRules'), Reach = require('./dungeonReach');
const Pantheon = require('../assets/pantheonCharacters');
const Life = require('./combatLife');
const field = (s, k) => String(s || '').match(new RegExp('^' + k + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
const write = (s, k, v) => new RegExp('^' + k + ':', 'm').test(s) ? s.replace(new RegExp('^' + k + ':[^\\r\\n]*', 'm'), () => k + ': ' + v) : k + ': ' + v + '\n' + s;
const party = text => [...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')];
const allActors = text => [...party(text), ...I.parseSheets(text)];
const dbOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
function book(db, state) {
  db['0,0,0'] ||= {};
  if (db['0,0,0'].spellSystem?.runId !== state.getDungeonRunId()) db['0,0,0'].spellSystem = {
    version: 1, source: 'engine-item-spells-v1', runId: state.getDungeonRunId(), clock: 0, revision: 0, items: {}, bindings: {}, recipes: {}, receipts: [], effects: [] };
  return db['0,0,0'].spellSystem;
}
function artifact(db, item) {
  return item.type === 'artifact' || item.quest_artifact === true || item.quest_artifact === 'true' || Object.values(db).some(r =>
    Rules.key(r?.bossGate?.artifactName) === Rules.key(item.name) || r?.objects?.some(o => Rules.key(o.name) === Rules.key(item.name) && o.quest_artifact));
}
function metadata(text) { return Inventory.parseProperties(field(text, 'Party Equipped Properties')); }
function changeActor(text, name, fn) {
  for (const label of ['PC', 'NPCs in Party', 'Monsters in Room']) text = text.replace(I.sectionPattern(label), (whole, head, body) => {
    const a = I.parseBlocks(body).find(a => a.name === name); return a ? head + body.replace(a.rawSheet, () => fn(a.rawSheet, a)) : whole;
  });
  return text;
}
function stat(sheet, name, n) { return sheet.replace(new RegExp('^([ \\t]*' + name + ':)[^\\r\\n]*', 'm'), (_, h) => h + ' ' + n); }
function paint(text, pool) {
  const props = [], monsterProps = [], existing = [...metadata(text), ...Inventory.parseProperties(field(text, 'Monsters Equipped Properties'))];
  for (const a of allActors(text)) for (const [slot, name] of Object.entries(I.parseEquipment(a.lines[9]))) {
    if (!name || /^none$/i.test(name)) continue;
    const out = a.type === 'monster' ? monsterProps : props;
    const entry = pool.items[pool.bindings[a.name + ':' + slot]];
    if (entry && entry.status !== 'ash' && Rules.key(entry.name) === Rules.key(name)) out.push({ ...entry.properties,
      name, magic: entry.remaining, spell_item_id: entry.id, magic_capacity: entry.capacity,
      owner: a.name, slot, quest_artifact: entry.artifact, artifact_recharge_turns: entry.artifact ? Rules.ARTIFACT_RECHARGE_TURNS : 0 });
    else {
      const p = existing.find(p => Rules.key(p.name) === Rules.key(name) && (!p.owner || p.owner === a.name));
      if (p) out.push({ ...p, owner: a.name, slot });
    }
  }
  text = write(text, 'Monsters Equipped Properties', monsterProps.map(p => JSON.stringify(p)).join(', ') || 'None');
  text = write(text, 'Party Equipped Properties', props.map(p => JSON.stringify(p)).join(', ') || 'None');
  for (const a of allActors(text)) if (Number.isFinite(pool.baseMagic?.[a.name])) {
    const worn = [...props, ...monsterProps].filter(p => p.owner === a.name).reduce((n, p) => n + Number(p.magic || 0), 0);
    text = changeActor(text, a.name, sheet => stat(sheet, 'Magic', pool.baseMagic[a.name] + (pool.casters?.[a.name]?.remaining || 0) + worn));
  }
  return text;
}
function synchronize(state) {
  const classChanged = require('./classMagic').sync(state);
  const db = dbOf(state), pool = book(db, state), text = state.getUpdatedGameConsole() || '';
  const props = [...metadata(text), ...Inventory.parseProperties(field(text, 'Monsters Equipped Properties'))], loose = Inventory.parseProperties(field(text, 'Inventory Properties'));
  let changed = classChanged; const bindings = {};
  for (const a of allActors(text)) for (const [slot, name] of Object.entries(I.parseEquipment(a.lines[9]))) {
    if (!name || /^none$/i.test(name)) continue;
    const item = props.find(p => (!p.owner || p.owner === a.name) && (!p.slot || p.slot === slot) && Rules.key(p.name) === Rules.key(name)) ||
      loose.find(p => Rules.key(p.name) === Rules.key(name)) || Object.values(db).flatMap(r => r?.objects || []).find(p => Rules.key(p.name) === Rules.key(name));
    let entry = item?.spell_item_id && pool.items[item.spell_item_id] || pool.items[pool.bindings[a.name + ':' + slot]];
    if (entry && Rules.key(entry.name) !== Rules.key(name)) entry = null;
    if (!entry && Rules.eligible(item)) {
      const id = randomUUID(), recipe = pool.recipes[Rules.key(item.name)];
      entry = pool.items[id] = { id, name, capacity: Number(item.magic), remaining: Number(item.magic), status: 'ready', artifact: artifact(db, item),
        properties: { ...item, owner: undefined, slot: undefined }, spells: recipe?.capacity === Number(item.magic) ? recipe.spells : Rules.recipe(item) };
      changed = true;
    }
    if (entry && entry.status !== 'ash') { bindings[a.name + ':' + slot] = entry.id; entry.owner = a.name; entry.slot = slot; }
  }
  pool.bindings = bindings;
  pool.baseMagic ||= {};
  for (const a of allActors(text)) if (pool.baseMagic[a.name] === undefined) {
    const worn = Object.entries(I.parseEquipment(a.lines[9])).filter(([, name]) => name !== 'None');
    const info = worn.map(([slot, name]) => props.find(p => p.name === name && (!p.owner || p.owner === a.name) && (!p.slot || p.slot === slot)));
    if (info.every(Boolean)) pool.baseMagic[a.name] = Math.max(0, a.magic - (pool.casters?.[a.name]?.remaining || 0) - info.reduce((n, p) => n + Number(p.magic || 0), 0));
  }
  if (changed) pool.revision++;
  const next = paint(text, pool);
  if (next !== text) changed = true;
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(next);
  return { changed, pool, db };
}
async function developRecipes($, state) {
  const db = dbOf(state), pool = book(db, state), text = state.getUpdatedGameConsole(), key = I.roomKey(field(text, 'Coordinates'));
  const candidates = [...(db[key]?.objects || []), ...Inventory.parseProperties(field(text, 'Monsters Equipped Properties')),
    ...Inventory.parseProperties(field(text, 'Inventory Properties')), ...metadata(text)].filter(Rules.eligible);
  const pending = [...new Map(candidates.filter(o => !pool.recipes[Rules.key(o.name)]).map(o => [Rules.key(o.name), o])).values()].slice(0, 16);
  if (!pending.length) return;
  let rows = [];
    $.model = 'gpt-4.1-mini'; $.temperature = .9;
    await $.user`Invent original underworld spell names and brief lore for the magical equipment below, consistent with the Children of the Grave system prompt. Return JSON only: {"items":[{"name":"exact item name","spells":[{"id":"exact supplied effect id","name":"short spell name","lore":"<=35 words"}]}]}. Mechanics, charge costs, ranges, targets and dice are FIXED by the engine. Name and describe only the supplied effects; no summons, resurrection, teleportation, new items, quest completion or arbitrary mechanics. Do not use a name shared by another spell on the same item. Equipment and effects: ${JSON.stringify(pending.map(o => ({ name: o.name, magic: o.magic, spells: Rules.recipe(o) })))}`;
    const effects = [...new Set(pending.flatMap(item => Rules.recipe(item).map(spell => spell.id)))];
    const result = await Contracts.request($, { component: 'spell-flavor', context: { runId: pool.runId, geoKey: key }, maxTokens: Math.min(3000, 200 * pending.length),
      parameters: { items: Contracts.list({ name: Contracts.choice(pending.map(o => o.name)), spells: Contracts.list({
        id: Contracts.choice(effects), name: Contracts.text(70), lore: Contracts.text(220, 'At most 35 words; flavor only, no new mechanical effects.') }) }) },
      validate(parsed) {
        if (!Array.isArray(parsed?.items) || parsed.items.length !== pending.length) throw Error(`items: expected ${pending.length} equipment rows.`);
        const seen = new Set();
        for (const row of parsed.items) {
          const item = pending.find(o => o.name === row?.name);
          if (!item || seen.has(row.name)) throw Error('items.name: unknown or duplicate equipment name.');
          seen.add(row.name);
          const expected = Rules.recipe(item).map(s => s.id), ids = new Set(), names = new Set();
          if (!Array.isArray(row.spells) || row.spells.length !== expected.length) throw Error(`${row.name}.spells: expected ${expected.length} fixed effects.`);
          for (const spell of row.spells) {
            if (!expected.includes(spell?.id) || ids.has(spell.id)) throw Error(`${row.name}.spells.id: unknown or duplicate effect.`);
            ids.add(spell.id);
            if (typeof spell.name !== 'string' || !spell.name.trim() || spell.name.length > 70 || names.has(Rules.key(spell.name)))
              throw Error(`${row.name}.${spell.id}.name: unique text, max 70 characters.`);
            names.add(Rules.key(spell.name));
            if (typeof spell.lore !== 'string' || !spell.lore.trim() || spell.lore.length > 220 || spell.lore.trim().split(/\s+/).length > 35)
              throw Error(`${row.name}.${spell.id}.lore: required, max 220 characters and 35 words.`);
          }
        }
        return parsed.items;
      } });
    rows = result.value || [];
  if (state.getDungeonRunId() !== pool.runId) return;
  const latest = dbOf(state), saved = book(latest, state);
  for (const item of pending) if (!saved.recipes[Rules.key(item.name)]) {
    const matches = Array.isArray(rows) ? rows.filter(r => r?.name === item.name) : [];
    if (matches.length !== 1) Diagnostics.report('spell-flavor', { status: 'fallback', runId: pool.runId, geoKey: key,
      item: item.name, replacement: 'engine-spell-template', reason: 'No validated equipment flavor; preserving fixed spell names and mechanics.' });
    saved.recipes[Rules.key(item.name)] = { capacity: Number(item.magic), spells: Rules.decorate(Rules.recipe(item), matches.length === 1 ? matches[0].spells : []) };
  }
  state.setRoomNameDatabase(JSON.stringify(latest));
}
function advance(state) {
  const db = dbOf(state), pool = book(db, state); pool.clock++;
  pool.effects = pool.effects.filter(e => e.expires > pool.clock && e.remaining !== 0);
  let text = state.getUpdatedGameConsole();
  for (const entry of Object.values(pool.items)) if (entry.artifact && entry.remaining === 0 && entry.rechargeAt <= pool.clock) {
    entry.remaining = entry.capacity; entry.status = 'ready'; delete entry.rechargeAt; pool.revision++;
    for (const a of allActors(text)) if (Object.values(I.parseEquipment(a.lines[9])).some(n => Rules.key(n) === Rules.key(entry.name)) &&
        Object.entries(pool.bindings).some(([binding, id]) => binding.startsWith(a.name + ':') && id === entry.id))
      text = changeActor(text, a.name, (sheet, actor) => stat(sheet, 'Magic', actor.magic + entry.capacity));
    const props = Inventory.parseProperties(field(text, 'Inventory Properties'));
    for (const p of props) if (p.spell_item_id === entry.id) p.magic = entry.capacity;
    text = write(text, 'Inventory Properties', props.map(p => JSON.stringify(p)).join(', ') || 'None');
    for (const room of Object.values(db)) for (const p of [...(room.objects || []), ...Object.values(room.inhabitants?.actors || {}).flatMap(a => a.inventory || [])])
      if (p.spell_item_id === entry.id) p.magic = entry.capacity;
  }
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(paint(text, pool));
  require('./classMagic').advance(state);
  Life.advance(state);
  return pool.clock;
}
function view(state, casterName, options = {}) {
  const { pool } = synchronize(state), actors = (options.monster ? allActors(state.getUpdatedGameConsole()) : party(state.getUpdatedGameConsole())).filter(a => a.hp > 0 && (!casterName || a.name === casterName));
  return { revision: pool.revision, clock: pool.clock, casters: actors.map(a => ({ name: a.name, type: a.type, items:
    Object.entries(I.parseEquipment(a.lines[9])).flatMap(([slot, name]) => {
      const entry = pool.items[pool.bindings[a.name + ':' + slot]];
      return entry && entry.status !== 'ash' && Rules.key(name) === Rules.key(entry.name) ? [{ id: entry.id, name, slot,
        magic: entry.remaining, capacity: entry.capacity, artifact: entry.artifact, rechargeIn: Math.max(0, (entry.rechargeAt || 0) - pool.clock),
        spells: entry.spells.map(s => ({ ...Rules.levelSpell(s, Rules.casterLevel(a.className, a.level)), affordable: s.cost <= entry.remaining, destroysItem: !entry.artifact && s.cost === entry.remaining })) }] : [];
    }).concat(require('./classMagic').summary(state, a.name) || []) })) };
}
function context(state, input, options = {}) {
  const text = state.getUpdatedGameConsole(), db = dbOf(state), pool = book(db, state), geoKey = I.roomKey(field(text, 'Coordinates'));
  if (input.runId !== pool.runId || input.geoKey !== geoKey) throw Error('That spell belongs to another room or game.');
  if (state.getGamePaused?.()) throw Error('Resume the game before casting.');
  const caster = (options.monster ? allActors(text) : party(text)).find(a => a.name === input.caster && a.hp > 0);
  if (!caster) throw Error('Only a living equipped party member can cast.');
  if (turned(state, caster)) throw Error('A turned character must withdraw before acting again.');
  const innate = pool.casters?.[caster.name];
  const entry = pool.items[input.itemId] || (innate?.id === input.itemId ? innate : null), slot = entry?.classSource ?
    require('./classMagic').ownsBook(state, entry) ? 'Class Magic' : null : entry && Object.keys(I.parseEquipment(caster.lines[9])).find(s => pool.bindings[caster.name + ':' + s] === entry.id &&
    Rules.key(I.parseEquipment(caster.lines[9])[s]) === Rules.key(entry.name));
  const baseSpell = entry?.spells?.find(s => s.id === input.spellId), spell = baseSpell && Rules.levelSpell(baseSpell, Rules.casterLevel(caster.className, caster.level));
  if (!entry || !slot || !spell || entry.status === 'ash') throw Error('That spell is not on an item equipped by this caster.');
  if (spell.castMinLevel && Rules.casterLevel(caster.className, caster.level) < spell.castMinLevel) throw Error(`This spell requires casting level ${spell.castMinLevel}, even from a scroll.`);
  if (spell.effect === 'turn' && pool.effects.some(e => e.kind === 'turn-cooldown' && e.target === caster.name && e.expires > pool.clock)) throw Error('Turn Undead is still on its four-round cooldown.');
  if (entry.remaining < spell.cost) throw Error(entry.artifact ? 'The artifact needs to recharge.' : 'Not enough Magic remaining.');
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), dungeon = state.getRoomDungeonForSimulation?.(state.getLastCoords());
  const actors = allActors(text), target = actors.find(a => a.name === input.target && (I.canAct(a) || spell.effect === 'heal' && I.isDown(a)));
  const a = roster.find(a => a.name === caster.name), t = roster.find(a => a.name === target?.name);
  const from = Reach.position(a, geoKey), to = Reach.position(t, geoKey);
  if (!target || !dungeon || !from || !to || Math.hypot(from.x - to.x, from.y - to.y) > spell.range || !Reach.lineClear(dungeon, from, to)) throw Error('Choose a living target in spell range with a clear line of sight.');
  const friendly = ['heal', 'ward'].includes(spell.effect);
  const team = a => ['pc', 'npc'].includes(a.type) ? 'Friendly' : I.allegiance(a);
  if (friendly ? team(target) !== team(caster) : team(target) === team(caster) || !options.monster && I.allegiance(target) !== 'Hostile') throw Error(friendly ? 'Choose a living ally.' : 'Choose an enemy.');
  if (!friendly && (t.discoveryState === 'pending' || !options.combat)) throw Error('Offensive spells must be cast during an initiative turn.');
  if (options.allowedTargets && !friendly && !options.allowedTargets.includes(target.name)) throw Error('That enemy is not in this encounter.');
  if (spell.effect === 'heal' && target.hp >= target.maxHp) throw Error('That character is already at full health.');
  if (spell.effect === 'turn' && !turnEligible({ db, geoKey, caster, text, pool }, target)) throw Error('Choose a weaker undead enemy. Bosses and deities cannot be turned.');
  return { text, db, pool, geoKey, caster, target, entry, spell, slot, roster, dungeon, to, actors };
}
function choices(state, casterName, targets, options = {}) {
  const v = view(state, casterName, options), geoKey = I.roomKey(field(state.getUpdatedGameConsole(), 'Coordinates')), choices = [];
  for (const item of v.casters[0]?.items || []) for (const spell of item.spells) if (spell.affordable) {
    const candidates = ['heal', 'ward'].includes(spell.effect) ? allActors(state.getUpdatedGameConsole()) : allActors(state.getUpdatedGameConsole()).filter(a => targets.includes(a.name));
    for (const a of candidates) {
      const input = { runId: state.getDungeonRunId(), geoKey, caster: casterName, itemId: item.id, spellId: spell.id, target: a.name };
      try { context(state, input, { ...options, combat: true, allowedTargets: targets }); choices.push({ ...input, revision: v.revision, name: spell.name, itemName: item.name,
        cost: spell.cost, magic: item.magic, effect: spell.effect, destroysItem: spell.destroysItem, description: spell.description }); } catch {}
    }
  }
  return choices;
}
function affectedActors(c) {
  if (c.spell.effect === 'turn') return [c.target, ...c.actors.filter(a => a.name !== c.target.name).sort((a, b) => {
    const distance = actor => { const p = Reach.position(c.roster.find(r => r.name === actor.name), c.geoKey); return p ? Math.hypot(p.x - c.to.x, p.y - c.to.y) : Infinity; };
    return distance(a) - distance(b) || a.name.localeCompare(b.name);
  })].filter(a => {
    const row = c.roster.find(r => r.name === a.name), p = Reach.position(row, c.geoKey);
    return a.hp > 0 && I.allegiance(a) === I.allegiance(c.target) && turnEligible(c, a) && p && row.discoveryState !== 'pending' &&
      Math.hypot(p.x - c.to.x, p.y - c.to.y) <= c.spell.radius && Reach.lineClear(c.dungeon, c.to, p);
  }).slice(0, c.spell.maxTargets);
  return c.spell.effect === 'blast' ? c.actors.filter(a => {
    const row = c.roster.find(r => r.name === a.name), p = Reach.position(row, c.geoKey);
    return I.isAlive(a) && p && row.discoveryState !== 'pending' && Math.hypot(p.x - c.to.x, p.y - c.to.y) <= c.spell.radius && Reach.lineClear(c.dungeon, c.to, p);
  }) : [c.target];
}
function rollPlan(state, input, options) {
  const c = context(state, input, options);
  return [...Array.from({ length: c.spell.dice || 0 }, () => ({ actor: c.caster.name, target: c.target.name, label: c.spell.effect === 'heal' ? 'Spell Healing' : 'Spell Damage', sides: c.spell.sides })),
    ...(['damage', 'blast', 'curse', 'turn'].includes(c.spell.effect) ? affectedActors(c).map(a => ({ actor: a.name, player: false, label: 'Spell Save', target: c.caster.name, sides: 20, modifier: Life.saveBonus(a), difficulty: saveDC(c.spell) })) : [])];
}
const saveDC = spell => spell.save || Math.min(22, 12 + spell.cost);
const saved = (natural, actor, spell) => natural === 20 || natural !== 1 && natural + Life.saveBonus(actor) >= saveDC(spell);
function survivalPlan(state, input, rolls, options = {}) {
  const c = context(state, input, options);
  if (!['damage', 'blast'].includes(c.spell.effect)) return [];
  const total = rolls.slice(0, c.spell.dice || 0).reduce((n, r) => n + r, c.spell.bonus || 0);
  return affectedActors(c).filter((a, index) => {
    const amount = saved(rolls[(c.spell.dice || 0) + index], a, c.spell) ? Math.floor(total / 2) : total;
    const ward = c.pool.effects.find(e => e.kind === 'ward' && e.target === a.name && e.remaining > 0 && e.expires > c.pool.clock);
    return a.hp > 0 && a.hp - Math.max(0, amount - (ward?.remaining || 0)) <= 0;
  }).map(Life.survivalPlan);
}
function turnEligible(c, actor) {
  const record = c.db[c.geoKey]?.inhabitants?.actors?.[actor.name];
  return /\b(undead|shade|wraith|ghost|specter|spectre|revenant|skeleton|skeletal|zombie|lich|mummy|vampire|ghoul|wight|banshee|spirit|apparition)\b/i.test(actor.race) &&
    actor.level <= Rules.casterLevel(c.caster.className, c.caster.level) - 2 && !record?.deityId && !Pantheon.canon(actor.name) &&
    Rules.key(field(c.text, 'Next Boss')) !== Rules.key(actor.name) && !Object.values(c.db).some(r => r?.bossGate?.bossName === actor.name) &&
    !c.pool.effects.some(e => e.kind === 'turn' && e.target === actor.name && e.expires > c.pool.clock);
}
function turned(state, actor) {
  if (!state.getRoomNameDatabase) return null;
  const pool = dbOf(state)['0,0,0']?.spellSystem, geoKey = I.roomKey(field(state.getUpdatedGameConsole(), 'Coordinates'));
  return pool?.effects.find(e => e.kind === 'turn' && e.target === actor.name && e.geoKey === geoKey && e.expires > pool.clock) || null;
}
function consumeTurn(state, actor) {
  const db = dbOf(state), pool = db['0,0,0']?.spellSystem;
  const effect = pool?.effects.find(e => e.kind === 'turn' && e.target === actor.name && e.expires > pool.clock && e.remainingTurns > 0);
  if (effect) { effect.remainingTurns--; if (effect.remainingTurns === 0) effect.expires = pool.clock + 1; pool.revision++; state.setRoomNameDatabase(JSON.stringify(db)); }
}
function absorb(state, target, damage) {
  if (!state.getRoomNameDatabase) return damage;
  const db = dbOf(state), pool = db['0,0,0']?.spellSystem;
  if (!pool) return damage;
  const ward = pool.effects.find(e => e.kind === 'ward' && e.target === target.name && e.remaining > 0 && e.expires > pool.clock);
  const fear = pool.effects.some(e => e.kind === 'turn' && e.target === target.name && e.expires > pool.clock);
  if (!ward && !fear) return damage;
  const soaked = ward ? Math.min(Math.max(0, damage), ward.remaining) : 0;
  if (ward) ward.remaining -= soaked;
  if (damage - soaked > 0 && fear) { pool.effects = pool.effects.filter(e => e.kind !== 'turn' || e.target !== target.name); pool.revision++; }
  state.setRoomNameDatabase(JSON.stringify(db)); return damage - soaked;
}
function penalty(state, actor) {
  if (!state.getRoomNameDatabase) return 0;
  const pool = dbOf(state)['0,0,0']?.spellSystem;
  return pool?.effects.find(e => e.kind === 'curse' && e.target === actor.name && e.expires > pool.clock)?.penalty || 0;
}
function cast(state, service, input, options = {}) {
  try {
    const previous = dbOf(state)['0,0,0']?.spellSystem?.receipts.find(r => r.nonce === input.nonce);
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify([input.runId, input.geoKey, input.caster, input.itemId, input.spellId, input.target])) throw Error('That spell transaction was already used.');
      return { ...previous.result, duplicate: true };
    }
    const c = context(state, input, options), { db, pool, caster, target, entry, spell, geoKey } = c;
    if (!/^[\w:-]{8,100}$/.test(input.nonce || '') || input.revision !== pool.revision) throw Error('That spell choice is stale. Reopen the spell menu.');
    const generate = options.random || (sides => randomInt(1, sides + 1)), rolls = [], changes = [];
    const random = sides => { const n = generate(sides); if (!Number.isInteger(n) || n < 1 || n > sides) throw Error('Invalid spell die result.'); return n; };
    const total = Array.from({ length: spell.dice || 0 }, () => { const n = random(spell.sides); rolls.push({ sides: spell.sides, roll: n }); return n; }).reduce((n, v) => n + v, spell.bonus || 0);
    if (spell.effect === 'turn') {
      for (const a of affectedActors(c)) {
        const natural = random(20), save = natural + Life.saveBonus(a), passed = saved(natural, a, spell);
        rolls.push({ actor: a.name, sides: 20, natural, roll: save, label: 'Spell Save', difficulty: saveDC(spell), passed });
        if (!passed) pool.effects.push({ kind: 'turn', target: a.name, source: caster.name, geoKey,
          expires: pool.clock + spell.rounds + 1, remainingTurns: spell.rounds, steps: spell.steps });
        changes.push({ name: a.name, hp: a.hp, effect: passed ? 'resisted turning' : 'turn' });
      }
      pool.effects.push({ kind: 'turn-cooldown', target: caster.name, expires: pool.clock + spell.cooldown });
    } else if (spell.effect === 'ward' || spell.effect === 'curse') {
      let resisted = false;
      if (spell.effect === 'curse') {
        const natural = random(20); resisted = saved(natural, target, spell);
        rolls.push({ actor: target.name, sides: 20, natural, roll: natural + Life.saveBonus(target), label: 'Spell Save', difficulty: saveDC(spell), passed: resisted });
      }
      if (!resisted) {
        pool.effects = pool.effects.filter(e => !(e.target === target.name && e.kind === spell.effect));
        pool.effects.push({ kind: spell.effect, target: target.name, geoKey, expires: pool.clock + spell.rounds + (options.combat ? 0 : 1), remaining: spell.absorb, penalty: spell.penalty });
      }
      changes.push({ name: target.name, hp: target.hp, effect: resisted ? 'resisted curse' : spell.effect });
    } else {
      const affected = affectedActors(c);
      for (const a of affected) {
        let amount = total;
        if (spell.effect === 'blast' || spell.effect === 'damage') {
          const natural = random(20), passed = saved(natural, a, spell);
          rolls.push({ actor: a.name, sides: 20, natural, roll: natural + Life.saveBonus(a), label: 'Spell Save', difficulty: saveDC(spell), passed });
          if (passed) amount = Math.floor(amount / 2);
        }
        if (spell.effect === 'heal') amount = Math.min(amount, a.maxHp - a.hp);
        else {
          const ward = pool.effects.find(e => e.kind === 'ward' && e.target === a.name && e.remaining > 0 && e.expires > pool.clock);
          if (ward) { const soaked = Math.min(ward.remaining, amount); ward.remaining -= soaked; amount -= soaked; }
        }
        if (spell.effect !== 'heal' && amount > 0) pool.effects = pool.effects.filter(e => e.kind !== 'turn' || e.target !== a.name);
        changes.push({ name: a.name, type: a.type, hp: a.hp + (spell.effect === 'heal' ? amount : -amount), amount, effect: spell.effect });
      }
    }
    if (entry.classSource && entry.remaining === entry.capacity) entry.nextRecharge = pool.clock + entry.settings.rechargeEvery;
    entry.remaining -= spell.cost; pool.revision++;
    const ash = entry.remaining === 0 && !entry.artifact && !entry.classSource;
    if (ash) { entry.status = 'ash'; delete pool.bindings[caster.name + ':' + c.slot]; }
    else if (entry.remaining === 0 && entry.artifact) { entry.status = 'recharging'; entry.rechargeAt = pool.clock + Rules.ARTIFACT_RECHARGE_TURNS; }
    let text = c.text;
    for (const change of changes) {
      const original = c.actors.find(a => a.name === change.name);
      if (change.amount !== undefined) {
        const natural = original.hp > 0 && change.hp <= 0 ? random(20) : null;
        const injury = Life.apply(db, state.getDungeonRunId(), { ...original }, change.hp, natural, { geoKey, damage: spell.effect === 'heal' ? 0 : change.amount });
        change.hp = injury.hp; change.state = injury.state;
        if (injury.save) rolls.push({ actor: original.name, sides: 20, label: 'Survival Save', ...injury.save });
      }
      text = changeActor(text, change.name, sheet => stat(sheet, 'HP', change.hp));
      const actor = c.roster.find(a => a.name === change.name); if (actor) { actor.hp = change.hp; actor.state = change.state || I.state({ ...original, hp: change.hp }); }
    }
    text = changeActor(text, caster.name, (sheet, a) => {
      sheet = stat(sheet, 'Magic', a.magic - spell.cost);
      if (ash) {
        const eq = I.parseEquipment(a.lines[9]); eq[c.slot] = 'None';
        sheet = sheet.replace(/^([ \t]*Equipped:)[^\r\n]*/m, (_, h) => h + ' ' + Object.entries(eq).map(([s, n]) => s + ': ' + n).join(', '));
        for (const [fieldName, value] of [['Attack', 'attack_modifier'], ['Damage', 'damage_modifier'], ['Armor', 'ac'], ['AC', 'ac']]) sheet = stat(sheet, fieldName, (a[fieldName.toLowerCase()] || 0) - (Number(entry.properties[value]) || 0));
      }
      return sheet;
    });
    Life.commit(state, db, paint(text, pool), c.roster);
    const committedActors = Life.actors(state.getUpdatedGameConsole());
    for (const change of changes) {
      const actual = committedActors.find(a => a.name === change.name);
      if (actual) { change.hp = actual.hp; change.state = actual.state; }
    }
    const result = { content: `${caster.name} casts ${spell.name} from ${entry.name} on ${target.name}. ` +
      changes.map(a => `${a.name}: ${a.effect === 'heal' ? '+' : a.amount === undefined ? '' : '-'}${a.amount ?? a.effect} (${a.hp} HP${I.isDown(a) ? '; ' + a.state : ''})`).join('; ') +
      `\n${entry.remaining}/${entry.capacity} Magic remaining.` + (ash ? ` ${entry.name} turns to ash.` : entry.remaining === 0 && entry.artifact ? ` Artifact recharges in ${Rules.ARTIFACT_RECHARGE_TURNS} turns.` : ''),
      caster: caster.name, target: target.name, spell: spell.name, item: entry.name, ash, artifact: entry.artifact, changes, rolls };
    pool.receipts.push({ nonce: input.nonce, request: [input.runId, input.geoKey, input.caster, input.itemId, input.spellId, input.target], result }); if (pool.receipts.length > 512) pool.receipts.shift();
    state.setRoomNameDatabase(JSON.stringify(db));
    if (service) { const population = service.get(geoKey, state.getUpdatedGameConsole()); I.sync(population, I.parseSheets(state.getUpdatedGameConsole())); service.save(population); }
    if (ash) require('./questFailure').itemDestroyed(state, entry.name);
    return result;
  } catch (error) { return { error: error.message }; }
}
function preserve(state, incomingText, incomingDB) {
  const db = dbOf(state), pool = db['0,0,0']?.spellSystem;
  if (!pool) return { text: incomingText, database: incomingDB };
  if (incomingDB) { const next = JSON.parse(incomingDB); next['0,0,0'] ||= {}; next['0,0,0'].spellSystem = pool; incomingDB = JSON.stringify(next); }
  let text = incomingText;
  if (typeof text === 'string') {
    const old = state.getUpdatedGameConsole(), oldActors = allActors(old), incomingProps = [...metadata(text), ...Inventory.parseProperties(field(text, 'Monsters Equipped Properties'))];
    const oldNames = field(old, 'Inventory').split(/,\s*/).map(Rules.key);
    const loose = Inventory.parseProperties(field(text, 'Inventory Properties'));
    for (const actor of allActors(text)) {
      const previous = oldActors.find(a => a.name === actor.name); if (!previous) continue;
      text = changeActor(text, actor.name, sheet => {
        let difference = 0, restoredAsh = false;
        const before = I.parseEquipment(previous.lines[9]), after = I.parseEquipment(actor.lines[9]);
        for (const [slot, name] of Object.entries(after)) {
          if (name === before[slot]) continue;
          const info = incomingProps.find(p => p.owner === actor.name && p.slot === slot && Rules.key(p.name) === Rules.key(name)) || loose.find(p => Rules.key(p.name) === Rules.key(name));
          const entry = pool.items[info?.spell_item_id];
          const ash = entry?.status === 'ash' || !info?.spell_item_id && !oldNames.includes(Rules.key(name)) && Object.values(pool.items).some(e => e.status === 'ash' && e.owner === actor.name && e.slot === slot && e.name === name);
          if (ash) { after[slot] = before[slot]; restoredAsh = true; continue; }
          const oldEntry = pool.items[pool.bindings[actor.name + ':' + slot]];
          const oldInfo = [...metadata(old), ...Inventory.parseProperties(field(old, 'Monsters Equipped Properties'))].find(p => p.owner === actor.name && p.slot === slot);
          difference += Number(entry?.remaining ?? info?.magic ?? 0) - Number(oldEntry?.remaining ?? oldInfo?.magic ?? 0);
        }
        sheet = stat(sheet, 'Magic', Math.max(0, previous.magic + difference));
        const className = pool.combatProfiles?.[actor.name]?.className || pool.casters?.[actor.name]?.className;
        if (className) { const lines = sheet.split(/\r?\n/); lines[3] = lines[3].replace(/\S.*$/, className); sheet = lines.join('\n'); }
        if (restoredAsh) {
          sheet = sheet.replace(/^([ \t]*Equipped:)[^\r\n]*/m, (_, h) => h + ' ' + Object.entries(after).map(([s, n]) => s + ': ' + n).join(', '));
          for (const [label, value] of [['Attack', previous.attack], ['Damage', previous.damage], ['Armor', previous.armor], ['AC', previous.ac]]) sheet = stat(sheet, label, value);
        }
        return sheet;
      });
    }
    const props = Inventory.parseProperties(field(text, 'Inventory Properties'));
    for (const p of props) { const e = pool.items[p.spell_item_id]; if (e) p.magic = e.remaining; }
    text = write(text, 'Inventory Properties', props.filter(p => pool.items[p.spell_item_id]?.status !== 'ash').map(p => JSON.stringify(p)).join(', ') || 'None');
    const burned = props.filter(p => pool.items[p.spell_item_id]?.status === 'ash').map(p => Rules.key(p.name)), consumed = new Set();
    for (const p of props) if (!p.spell_item_id && !oldNames.includes(Rules.key(p.name)) && Object.values(pool.items).some(e => e.status === 'ash' && Rules.key(e.name) === Rules.key(p.name))) consumed.add(Rules.key(p.name));
    for (const c of Object.values(pool.casters || {})) for (const receipt of c.scribingReceipts || []) if (receipt.item && !oldNames.includes(Rules.key(receipt.item))) consumed.add(Rules.key(receipt.item));
    burned.push(...consumed);
    text = write(text, 'Inventory Properties', props.filter(p => !consumed.has(Rules.key(p.name)) && pool.items[p.spell_item_id]?.status !== 'ash').map(p => JSON.stringify(p)).join(', ') || 'None');
    const names = field(text, 'Inventory').split(/,\s*/).filter(n => { const i = burned.indexOf(Rules.key(n)); if (i < 0) return !!n; burned.splice(i, 1); return false; });
    text = write(text, 'Inventory', names.join(', ') || 'Empty');
    text = paint(text, pool);
  }
  return { text, database: incomingDB };
}
const opening = new WeakMap();
function queue(state, input) { opening.set(state, input); }
function takeOpening(state, caster) { const input = opening.get(state); if (input?.caster !== caster) return null; opening.delete(state); return input; }
function clearOpening(state) { opening.delete(state); }
function aiChoice(state, caster, targets) {
  const choicesNow = choices(state, caster.name, targets, { monster: true }), pool = dbOf(state)['0,0,0']?.spellSystem;
  const hurt = choicesNow.find(c => c.effect === 'heal' && allActors(state.getUpdatedGameConsole()).some(a => a.name === c.target && a.hp < a.maxHp / 2));
  if (hurt) return hurt;
  return choicesNow.find(c => c.effect === 'turn') || choicesNow.find(c => ['damage', 'curse', 'blast'].includes(c.effect) && (c.effect !== 'blast' ||
    !allActors(state.getUpdatedGameConsole()).some(a => I.allegiance(a) === I.allegiance(caster) && a.hp > 0 && a.name !== c.target && (() => {
      const roster = JSON.parse(state.getCombatCharactersString()), key = c.geoKey, p = Reach.position(roster.find(r => r.name === a.name), key), q = Reach.position(roster.find(r => r.name === c.target), key);
      return p && q && Math.hypot(p.x - q.x, p.y - q.y) <= 2;
    })()))) || choicesNow.find(c => c.effect === 'ward' && !pool.effects.some(e => e.target === c.target && e.kind === 'ward' && e.expires > pool.clock && e.remaining > 0));
}
module.exports = { Rules, field, write, party, allActors, changeActor, stat, book, metadata, synchronize, developRecipes, advance, view, context, choices, cast, rollPlan, survivalPlan, absorb, penalty, turned, consumeTurn, preserve, artifact,
  queue, takeOpening, clearOpening, aiChoice };
