'use strict';
const Spells = require('./spellSystem');
const Rules = require('../assets/spellRules');
const I = require('../assets/dungeonInhabitants');
function project(state) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), text = state.getUpdatedGameConsole();
  const pool = db['0,0,0']?.spellSystem?.runId === state.getDungeonRunId() ? db['0,0,0'].spellSystem : {};
  const casters = [];
  for (const actor of Spells.party(text)) {
    const settings = Rules.classSettings(actor.className, actor.level), c = pool.casters?.[actor.name];
    const castingLevel = Rules.casterLevel(actor.className, actor.level), entries = [];
    const bookPresent = c ? require('./classMagic').ownsBook(state, c) : !settings?.spellbook;
    if (settings) for (const id of Rules.catalog(actor.className)) {
      const template = Rules.templates[id], level = template.minLevel;
      const spell = Rules.classSpell(id, Math.max(castingLevel, level));
      if (c?.learned?.[id]?.cost) spell.cost = c.learned[id].cost;
      const known = !settings.spellbook || c?.known?.includes(id), prepared = !!c?.prepared?.includes(id);
      const cooling = spell.effect === 'turn' && pool.effects?.some(e => e.kind === 'turn-cooldown' && e.target === actor.name && e.expires > pool.clock);
      entries.push({ ...spell, level, classSource: true, memorizeCost: 0, casts: actor.hp > 0 && bookPresent && prepared && castingLevel >= level && !cooling ? Math.floor((c?.remaining || 0) / spell.cost) : 0,
        source: settings.spellbook ? 'Spellbook' : settings.tradition + ' weave',
        status: castingLevel < level ? 'Locked' : !known ? 'Scroll required' : prepared ? 'Prepared' : 'Not prepared',
        magic: c?.remaining ?? 0, preview: castingLevel < level });
    }
    for (const [slot, name] of Object.entries(I.parseEquipment(actor.lines[9]))) {
      const item = pool.items?.[pool.bindings?.[actor.name + ':' + slot]];
      if (!item || item.status === 'ash' || Rules.key(item.name) !== Rules.key(name)) continue;
      for (const base of item.spells || []) {
        const spell = Rules.levelSpell(base, castingLevel), level = base.castMinLevel || 1;
        const cooling = spell.effect === 'turn' && pool.effects?.some(e => e.kind === 'turn-cooldown' && e.target === actor.name && e.expires > pool.clock);
        entries.push({ ...spell, level, itemId: item.id, sourceCapacity: item.capacity, casts: actor.hp > 0 && castingLevel >= level && !cooling ? Math.floor(item.remaining / spell.cost) : 0,
          source: `${name} (${slot})`, magic: item.remaining,
          status: castingLevel < level ? 'Locked' : item.remaining < spell.cost ? 'Insufficient Magic' : 'Equipped',
          artifact: !!item.artifact, rechargeIn: Math.max(0, (item.rechargeAt || 0) - (pool.clock || 0)) });
      }
    }
    const levels = [...new Set(entries.map(s => s.level))].sort((a, b) => a - b);
    casters.push({ name: actor.name, type: actor.type, classCaster: !!settings, className: actor.className, level: actor.level, castingLevel, hp: actor.hp,
      magic: c?.remaining ?? 0, capacity: c?.capacity ?? settings?.capacity ?? 0, slots: settings?.slots || 0,
      prepared: c?.prepared?.slice() || [],
      rechargeEvery: settings?.rechargeEvery, rechargeAmount: settings?.rechargeAmount,
      bookRequired: !!settings?.spellbook, bookPresent,
      initialized: !!c, groups: levels.map(level => ({ level, spells: entries.filter(s => s.level === level) })) });
  }
  return { runId: state.getDungeonRunId(), revision: pool.revision ?? 0, casters };
}
module.exports = { project };
