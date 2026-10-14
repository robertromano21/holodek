'use strict';
const { randomUUID } = require('node:crypto');
const Rules = require('../assets/spellRules'), I = require('../assets/dungeonInhabitants'), Inventory = require('../assets/inventoryUi');
const Reach = require('./dungeonReach');
const Pantheon = require('../assets/pantheonCharacters');
const spells = () => require('./spellSystem');
const learnedSpell = (c, id) => Rules.levelSpell({ id, ...Rules.templates[id],
  ...(c.settings.spellbook && c.learned?.[id] ? { cost: c.learned[id].cost } : {}) }, Rules.casterLevel(c.className, c.level));
const starterSpells = settings => Rules.catalog(settings.tradition).filter(id => Rules.templates[id].minLevel === 1);
function restSafe(state, caster) {
  const S = spells(), key = I.roomKey(S.field(state.getUpdatedGameConsole(), 'Coordinates'));
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), dungeon = state.getRoomDungeonForSimulation?.(state.getLastCoords());
  const from = Reach.position(roster.find(a => a.name === caster), key);
  if (!dungeon || !from) return false;
  return !S.allActors(state.getUpdatedGameConsole()).some(a => a.hp > 0 && I.allegiance(a) === 'Hostile' && (() => {
    const at = Reach.position(roster.find(r => r.name === a.name), key);
    return at && Math.hypot(from.x - at.x, from.y - at.y) <= 3.5 && Reach.lineClear(dungeon, from, at);
  })());
}
function ownsBook(state, caster) {
  if (!caster.settings.spellbook) return true;
  const text = state.getUpdatedGameConsole(), actor = spells().allActors(text).find(a => a.name === caster.owner);
  if (Object.values(I.parseEquipment(actor?.lines[9])).some(n => n === caster.bookName)) return true;
  if (actor?.type !== 'monster') return spells().field(text, 'Inventory').split(/,\s*/).includes(caster.bookName);
  const db = JSON.parse(state.getRoomNameDatabase());
  return Object.values(db).some(r => r?.inhabitants?.actors?.[caster.owner]?.inventory?.some(o => o.name === caster.bookName));
}
function sync(state) {
  const S = spells(), db = JSON.parse(state.getRoomNameDatabase() || '{}'), pool = S.book(db, state); pool.casters ||= {};
  pool.combatProfiles ||= {};
  let text = state.getUpdatedGameConsole(), changed = false;
  for (const actor of S.allActors(text)) {
    const savedClass = pool.combatProfiles[actor.name]?.className || pool.casters[actor.name]?.className;
    if (savedClass && actor.className !== savedClass) {
      text = S.changeActor(text, actor.name, sheet => { const lines = sheet.split(/\r?\n/); lines[3] = lines[3].replace(/\S.*$/, savedClass); return lines.join('\n'); });
      actor.className = savedClass; changed = true;
    }
    if (actor.type === 'monster' && !Rules.resolveClass(actor.className) && !Pantheon.canon(actor.name)) {
      const roomKey = I.roomKey(S.field(text, 'Coordinates')), pop = state.getRoomPopulation?.(roomKey) || db[roomKey]?.inhabitants;
      const className = Rules.monsterClass(actor.className, pop?.actors?.[actor.name]?.combatArchetype);
      text = S.changeActor(text, actor.name, sheet => {
        const lines = sheet.split(/\r?\n/); lines[3] = lines[3].replace(/\S.*$/, className); return lines.join('\n');
      });
      actor.className = className;
      if (pop?.actors?.[actor.name]) {
        pop.actors[actor.name].className = className; pop.actors[actor.name].combatArchetype = Rules.resolveClass(className);
        pop.actors[actor.name].combatRole = Rules.classSettings(className, actor.level) ? 'Spellcaster' : 'Warrior';
        I.sync(pop, I.parseSheets(text)); db[roomKey].inhabitants = pop;
        state.setRoomPopulation?.(roomKey, pop);
      }
      changed = true;
    }
    if (actor.type === 'monster' && !pool.combatProfiles[actor.name]) {
      pool.combatProfiles[actor.name] = { className: actor.className, rulesClass: Rules.resolveClass(actor.className), source: 'engine-native-class-v1' }; changed = true;
    }
    const settings = Rules.classSettings(actor.className, actor.level); if (!settings) continue;
    const record = db[I.roomKey(S.field(text, 'Coordinates'))]?.inhabitants?.actors?.[actor.name];
    const initial = [...new Set([...(record?.spellPreferences || []), ...settings.available])].filter(id => settings.available.includes(id)).slice(0, settings.slots);
    let c = pool.casters[actor.name];
    if (!c) {
      c = pool.casters[actor.name] = { id: 'class:' + actor.name, owner: actor.name, name: settings.spellbook ? 'spellbook of ' + actor.name.toLowerCase() : actor.className + ' weave',
        bookName: 'spellbook of ' + actor.name.toLowerCase(), classSource: true, className: actor.className, level: actor.level, capacity: settings.capacity,
        remaining: settings.capacity, settings, properties: {}, known: [], learned: {}, prepared: [], status: 'ready', nextRecharge: pool.clock + settings.rechargeEvery };
      if (settings.diminished || actor.type === 'monster') {
        pool.baseMagic ||= {}; pool.baseMagic[actor.name] = 0;
        const props = [...S.metadata(text), ...Inventory.parseProperties(S.field(text, 'Monsters Equipped Properties'))];
        const worn = Object.entries(I.parseEquipment(actor.lines[9])).reduce((sum, [slot, name]) => sum + Number(props.find(p => p.name === name && (!p.owner || p.owner === actor.name) && (!p.slot || p.slot === slot))?.magic || 0), 0);
        text = S.changeActor(text, actor.name, sheet => S.stat(sheet, 'Magic', settings.capacity + worn));
      } else text = S.changeActor(text, actor.name, (sheet, a) => S.stat(sheet, 'Magic', a.magic + settings.capacity - settings.pointsPerLevel));
      if (settings.spellbook) {
        const book = { name: c.bookName, type: 'other', magic: 0, attack_modifier: 0, damage_modifier: 0, ac: 0,
          readable_kind: 'spellbook', class_spellbook: actor.name, description: `Contains basic ${settings.tradition} formulas. Choose starting spells in the Spellbook menu; scribe real scrolls to learn additional formulas.` };
        if (actor.type === 'monster') {
          const key = I.roomKey(S.field(text, 'Coordinates')), pop = state.getRoomPopulation?.(key) || db[key]?.inhabitants;
          if (pop?.actors[actor.name]) { pop.actors[actor.name].inventory ||= []; pop.actors[actor.name].inventory.push(book); db[key].inhabitants = pop; }
          // Native casters learned from actual birth-scrolls, which are consumed into their book.
          c.known = initial; c.prepared = c.known.slice();
          c.scribingReceipts = c.known.map(id => ({ id: randomUUID(), source: 'engine-birth-scroll-v1', scroll: Rules.scroll(id, actor.name), consumed: true }));
          for (const id of c.known) c.learned[id] = Rules.recipe(Rules.scroll(id, actor.name))[0];
        } else {
          const names = S.field(text, 'Inventory').split(/,\s*/).filter(n => n && !/^(None|Empty)$/i.test(n));
          const props = Inventory.parseProperties(S.field(text, 'Inventory Properties'));
          names.push(book.name); props.push(book);
          text = S.write(S.write(text, 'Inventory', names.join(', ')), 'Inventory Properties', props.map(o => JSON.stringify(o)).join(', '));
        }
        const key = I.roomKey(S.field(text, 'Coordinates'));
        if (db[key]) { db[key].readables ||= []; db[key].readables.push({ id: 'class-book:' + actor.name, name: book.name, kind: 'spellbook', title: actor.name + "'s Spellbook",
          chapters: [{ title: 'Scribing and preparation', text: `Basic ${settings.tradition} formulas are already known. Choose spells for your available slots in the Spellbook menu. To learn additional formulas, consume a real matching spell scroll during a short rest, then prepare it when your casting level reaches its requirement. Casting uses class Magic; the book itself is not a charge reservoir.` }] }); }
      } else if (actor.type === 'monster') c.prepared = initial;
      changed = true;
    } else if (settings.diminished && !c.settings?.diminished) {
      // Correct the previous 5 * divine-level grant, retaining expenditure and learned spells.
      const oldRemaining = c.remaining, spent = Math.max(0, c.capacity - c.remaining);
      c.remaining = Math.max(0, settings.capacity - spent); c.capacity = settings.capacity; c.level = actor.level; c.settings = settings;
      c.prepared = c.prepared.filter(id => settings.available.includes(id)).slice(0, settings.slots);
      c.nextRecharge = pool.clock + settings.rechargeEvery;
      pool.baseMagic ||= {}; pool.baseMagic[actor.name] = 0;
      text = S.changeActor(text, actor.name, (sheet, a) => S.stat(sheet, 'Magic', Math.max(0, a.magic + c.remaining - oldRemaining))); changed = true;
    } else if (c.level !== actor.level) {
      const oldRemaining = c.remaining, delta = Math.max(0, settings.capacity - c.capacity);
      c.remaining = Math.min(settings.capacity, c.remaining + delta); c.capacity = settings.capacity; c.level = actor.level; c.settings = settings;
      text = S.changeActor(text, actor.name, (sheet, a) => S.stat(sheet, 'Magic', a.magic + c.remaining - oldRemaining)); changed = true;
    }
    if (c.settings?.catalogVersion !== Rules.catalogVersion || c.className !== actor.className) {
      // Catalog changes never refund spent Magic or resurrect consumed scrolls.
      c.settings = settings; c.className = actor.className; changed = true;
    }
    if (c.starterSpellsVersion !== 1) {
      // A one-time starter grant fixes empty legacy books without refilling Magic or respawning a lost book.
      if (settings.spellbook && actor.type !== 'monster' && !pool.combatProfiles[actor.name]) {
        for (const id of starterSpells(settings)) if (!c.known.includes(id)) {
          c.known.push(id); c.learned[id] = Rules.classSpell(id, 1);
        }
      }
      c.starterSpellsVersion = 1; changed = true;
    }
    const prepared = c.prepared.filter(id => settings.available.includes(id) && (!settings.spellbook || c.known.includes(id))).slice(0, settings.slots);
    if (JSON.stringify(prepared) !== JSON.stringify(c.prepared)) { c.prepared = prepared; changed = true; }
    c.spells = prepared.map(id => learnedSpell(c, id));
  }
  if (changed) pool.revision++;
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(text);
  return changed;
}
function summary(state, name) {
  const db = JSON.parse(state.getRoomNameDatabase()), pool = db['0,0,0']?.spellSystem, c = pool?.casters?.[name];
  if (!c) return null;
  return { name: c.name, id: c.id, magic: c.remaining, capacity: c.capacity, slots: c.settings.slots, classSource: true, artifact: false,
    className: c.className, rulesClass: c.settings.rulesClass, tradition: c.settings.tradition,
    bookRequired: c.settings.spellbook, bookPresent: ownsBook(state, c), known: c.known, prepared: c.prepared,
    rechargeEvery: c.settings.rechargeEvery, rechargeAmount: c.settings.rechargeAmount, scribeTurns: c.settings.scribeTurns, restSafe: restSafe(state, name),
    diminished: !!c.settings.diminished, divineLevel: c.settings.diminished ? c.level : null, castingLevel: Rules.casterLevel(c.className, c.level),
    learnable: (c.settings.spellbook ? c.known : Rules.catalog(c.className)).filter(id => Rules.templates[id]).map(id => ({ ...learnedSpell(c, id), available: c.settings.available.includes(id),
      unavailableReason: Rules.templates[id].tradition !== c.settings.tradition ? 'Different spell tradition' : `Requires casting level ${Rules.templates[id].minLevel}` })),
    spells: ownsBook(state, c) ? c.spells.map(s => ({ ...s, affordable: s.cost <= c.remaining, destroysItem: false })) : [] };
}
function advance(state) {
  const S = spells(), db = JSON.parse(state.getRoomNameDatabase()), pool = db['0,0,0']?.spellSystem; if (!pool) return;
  let text = state.getUpdatedGameConsole();
  for (const c of Object.values(pool.casters || {})) if (pool.clock >= c.nextRecharge) {
    c.nextRecharge = pool.clock + c.settings.rechargeEvery;
    const actor = S.allActors(text).find(a => a.name === c.owner);
    if (actor?.hp <= 0) continue;
    const amount = Math.min(c.settings.rechargeAmount, c.capacity - c.remaining);
    if (amount > 0) {
      c.remaining += amount; c.status = 'ready'; pool.revision++;
      if (actor) text = S.changeActor(text, c.owner, (sheet, a) => S.stat(sheet, 'Magic', a.magic + amount));
    }
  }
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(text);
}
function action(state, input) {
  const S = spells(); sync(state);
  const db = JSON.parse(state.getRoomNameDatabase()), pool = db['0,0,0'].spellSystem, c = pool.casters?.[input.caster];
  const request = JSON.stringify([input.runId, input.geoKey, input.caster, input.kind, input.item, input.spellIds]);
  const previous = pool.preparationReceipts?.find(r => r.nonce === input.nonce);
  if (previous && input.nonce) return previous.request === request ? { ...previous.result, duplicate: true } : { error: 'That spell preparation transaction was already used.' };
  if (input.runId !== state.getDungeonRunId() || input.geoKey !== I.roomKey(S.field(state.getUpdatedGameConsole(), 'Coordinates')) ||
      input.revision !== pool.revision || !c || !S.party(state.getUpdatedGameConsole()).some(a => a.name === c.owner && a.hp > 0) || state.getGamePaused?.()) return { error: 'That spell preparation is stale or unavailable.' };
  if (!ownsBook(state, c)) return { error: 'Obtain your spellbook before preparing or learning spells.' };
  if (input.kind === 'prepare') {
    const ids = input.spellIds, permitted = c.settings.spellbook ? c.known : c.settings.available;
    if (!Array.isArray(ids) || ids.length > c.settings.slots || new Set(ids).size !== ids.length ||
        ids.some(id => !permitted.includes(id) || !c.settings.available.includes(id))) return { error: 'Choose supported, learned spells within your preparation limit and level.' };
    c.prepared = ids.slice(); c.spells = ids.map(id => learnedSpell(c, id)); pool.revision++;
  } else if (input.kind === 'scribe') {
    if (!c.settings.spellbook) return { error: 'Only Wizards, Witches and Necromancers scribe scrolls into a spellbook.' };
    if (!restSafe(state, c.owner)) return { error: 'A nearby hostile prevents the short rest needed for scribing.' };
    let text = state.getUpdatedGameConsole();
    const props = Inventory.parseProperties(S.field(text, 'Inventory Properties')), item = props.find(o => o.name === input.item && Rules.templates[o.spell_scroll] && Rules.eligible(o));
    const names = S.field(text, 'Inventory').split(/,\s*/); const index = names.indexOf(item?.name);
    if (!item || index < 0 || c.known.includes(item.spell_scroll)) return { error: 'Obtain an unspent spell scroll for a spell not already learned.' };
    if (!Rules.canLearn(c.className, item.spell_scroll)) return { error: `Only ${Rules.templates[item.spell_scroll].tradition} spellcasters can learn that formula. ${c.owner} uses the ${c.settings.tradition} tradition. Any class may still equip and cast the scroll once.` };
    names.splice(index, 1); props.splice(props.indexOf(item), 1); c.known.push(item.spell_scroll);
    c.learned ||= {}; c.learned[item.spell_scroll] = Rules.recipe(item)[0];
    c.scribingReceipts ||= []; c.scribingReceipts.push({ id: randomUUID(), source: 'engine-scroll-scribing-v1', item: item.name, spell: item.spell_scroll });
    text = S.write(S.write(text, 'Inventory', names.join(', ') || 'Empty'), 'Inventory Properties', props.map(p => JSON.stringify(p)).join(', ') || 'None');
    state.setUpdatedGameConsole(text); pool.revision++;
  } else return { error: 'Unsupported spell preparation.' };
  const turns = input.kind === 'scribe' ? c.settings.scribeTurns : 1;
  const result = { turns, content: input.kind === 'scribe' ? `${input.caster} rests for ${turns} turn${turns === 1 ? '' : 's'} to scribe ${input.item}; the scroll is consumed and its spell and Magic cost are learned.` : `${input.caster} prepares the selected spells.` };
  if (input.nonce) { pool.preparationReceipts ||= []; pool.preparationReceipts.push({ nonce: input.nonce, request, result }); if (pool.preparationReceipts.length > 512) pool.preparationReceipts.shift(); }
  state.setRoomNameDatabase(JSON.stringify(db));
  state.setUpdatedGameConsole(S.write(state.getUpdatedGameConsole(), 'Turns', (Number(S.field(state.getUpdatedGameConsole(), 'Turns')) || 0) + turns));
  for (let i = 0; i < turns; i++) S.advance(state);
  return result;
}
module.exports = { sync, summary, ownsBook, advance, action, restSafe, starterSpells };
