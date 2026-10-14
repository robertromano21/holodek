(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpellRules = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const key = s => String(s || '').trim().toLowerCase();
  const traditions = {
    Wizard: 'Study and runes: precise long-range force, broad elemental blasts and strong barriers; no class healing.',
    Witch: 'Ritual and fate: economical close-range healing, thorn magic and the strongest lasting attack hexes.',
    Sorcerer: 'Light weave: spontaneous ranged healing and protection, culminating in powerful Renewal.',
    Warlock: 'Dark weave: high-impact close-range attacks and lasting bindings; no class healing and only a fragile nearby ward.',
    Necromancer: 'Death and ancestors: bone attacks, close protective wards, Grave Mending and tightly limited control of weaker undead.',
    Cleric: 'Priestly petitions: efficient nearby healing and sanctuary wards, with modest judgment magic and limited high-level undead rebukes.'
  };
  const templates = {
    missile: { name: 'Magic Missile', effect: 'damage', cost: 1, dice: 1, sides: 4, bonus: 1, range: 8,
      description: 'A force dart hits one visible enemy without an attack roll.' },
    fireball: { name: 'Fireball', effect: 'blast', cost: 3, dice: 3, sides: 6, bonus: 0, range: 8, radius: 2, save: 14,
      description: 'A burst hits everyone within two tiles of the target, including allies. A successful save halves damage.' },
    mend: { name: 'Grave Mending', effect: 'heal', cost: 1, dice: 1, sides: 6, bonus: 1, range: 3,
      description: 'Restore vitality to a living party member, up to maximum HP. Does not resurrect.' },
    ward: { name: 'Sepulchral Ward', effect: 'ward', cost: 1, absorb: 4, range: 3, rounds: 2,
      description: 'An ancestral ward absorbs incoming damage to one ally; wards do not stack.' },
    curse: { name: 'Oathbreaker Hex', effect: 'curse', cost: 2, penalty: 2, range: 6, rounds: 2,
      description: 'A ritual hex weakens one visible enemy\'s attack rolls; hexes do not stack.' }
  };
  const classes = { Wizard: { pointsPerLevel: 2, spellbook: true, tradition: 'Wizard' }, Witch: { pointsPerLevel: 2, spellbook: true, tradition: 'Witch' },
    Necromancer: { pointsPerLevel: 2, spellbook: true, tradition: 'Necromancer' },
    'Assassin-Fighter-Necromancer-Goddess': { pointsPerLevel: 2, startingMagic: 5, startLevel: 50, diminished: true, spellbook: true, tradition: 'Necromancer' },
    Sorcerer: { pointsPerLevel: 3, spellbook: false, tradition: 'Sorcerer' }, Warlock: { pointsPerLevel: 3, spellbook: false, tradition: 'Warlock' },
    Cleric: { pointsPerLevel: 2, spellbook: false, tradition: 'Cleric' } };
  const archetypes = ['Fighter', 'Wizard', 'Witch', 'Sorcerer', 'Warlock', 'Necromancer', 'Cleric'];
  const nativeHp = { Fighter: 10, Wizard: 6, Witch: 6, Sorcerer: 4, Warlock: 4, Necromancer: 6, Cleric: 8 };
  function resolveClass(name) {
    if (classes[name] || name === 'Fighter') return name;
    return /\[rules: (Fighter|Wizard|Witch|Sorcerer|Warlock|Necromancer|Cleric)\]$/.exec(String(name))?.[1] || null;
  }
  function monsterArchetype(name, suggested) {
    const exact = resolveClass(name); if (exact) return exact === 'Assassin-Fighter-Necromancer-Goddess' ? 'Necromancer' : exact;
    if (archetypes.includes(suggested)) return suggested;
    const title = key(name);
    if (/\b(necromancer|necromancy|bone[- ]?mage|death[- ]?mage|soul[- ]?binder)\b/.test(title)) return 'Necromancer';
    if (/\b(cleric|priest|priestess|healer|hierophant|acolyte|bishop)\b/.test(title)) return 'Cleric';
    if (/\b(warlock|pact[- ]?binder|dark[- ]?weaver|hexblade)\b/.test(title)) return 'Warlock';
    if (/\b(witch|hag|hexer|shaman)\b/.test(title)) return 'Witch';
    if (/\b(sorcerer|sorceress|light[- ]?weaver)\b/.test(title)) return 'Sorcerer';
    if (/\b(wizard|mage|magus|arcanist|spellcaster|spellweaver|enchanter)\b/.test(title)) return 'Wizard';
    return 'Fighter';
  }
  function monsterClass(name, suggested) {
    if (name === 'Assassin-Fighter-Necromancer-Goddess') return name;
    const rule = archetypes.includes(suggested) ? suggested : monsterArchetype(name);
    if (classes[name]?.tradition === rule || name === 'Fighter' && rule === 'Fighter') return name;
    const title = String(name || 'Wanderer').replace(/\s*\[rules:[^\]]*\]$/, '').replace(/[\r\n<>\[\]]/g, '').trim().slice(0, 45);
    return `${title} [rules: ${rule}]`;
  }
  const progression = {
    missile: [[1, 1], [3, 2], [5, 3], [7, 4], [9, 5]],
    fireball: [[1, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10]],
    mendDice: [[1, 1], [5, 2], [9, 3], [13, 4]], mendBonus: [[1, 1], [4, 2], [7, 3], [10, 4], [13, 5]],
    ward: [[1, 4], [4, 6], [7, 8], [10, 10], [13, 12], [16, 14], [19, 16]],
    curse: [[1, 2], [6, 3], [11, 4]], duration: [[1, 2], [7, 3], [13, 4]],
    prepared: [[1, 2], [3, 3], [6, 4], [9, 5], [12, 6], [18, 7]]
  };
  const profiles = {
    missile: { dice: progression.missile, bonus: progression.missile }, fireball: { dice: progression.fireball },
    mend: { dice: progression.mendDice, bonus: progression.mendBonus },
    ward: { absorb: progression.ward, rounds: progression.duration }, curse: { penalty: progression.curse, rounds: progression.duration },
    needle: { dice: [[1, 1], [4, 2], [8, 3], [12, 4]] },
    rune: { absorb: [[1, 5], [5, 8], [9, 11], [13, 14], [17, 17]], rounds: progression.duration },
    lance: { dice: [[1, 3], [9, 4], [13, 5]], bonus: [[1, 2], [10, 4], [14, 6]] },
    fortress: { absorb: [[1, 20], [13, 25], [17, 30]], rounds: [[1, 3], [15, 4]] },
    coven: { dice: [[1, 1], [4, 2], [8, 3], [12, 4]], bonus: [[1, 2], [5, 3], [9, 4], [13, 5]] },
    hearth: { absorb: [[1, 10], [7, 14], [11, 18], [15, 22]], rounds: progression.duration },
    briar: { dice: [[1, 4], [10, 6], [14, 8]] },
    fate: { penalty: [[1, 4], [13, 5], [17, 6]], rounds: [[1, 4], [15, 5]] },
    bone: { dice: [[1, 1], [4, 2], [8, 3], [12, 4]], bonus: [[1, 1], [6, 2], [11, 3]] },
    ossuary: { absorb: [[1, 16], [10, 20], [14, 24]], rounds: [[1, 3], [12, 4]] },
    sentence: { dice: [[1, 4], [13, 5], [17, 6]], bonus: [[1, 4], [14, 6], [18, 8]] },
    aurora: { absorb: [[1, 6], [6, 10], [10, 14], [14, 18]], rounds: progression.duration },
    sunburst: { dice: [[1, 2], [5, 3], [9, 4], [13, 5]] },
    renewal: { dice: [[1, 3], [13, 4], [17, 5]], bonus: [[1, 5], [14, 7], [18, 9]] },
    cinder: { dice: [[1, 1], [6, 2], [11, 3], [16, 4]] },
    pact: { absorb: [[1, 3], [5, 6], [9, 9], [13, 12]], rounds: [[1, 3], [10, 4]] },
    oath: { penalty: [[1, 3], [10, 4], [14, 5]], rounds: [[1, 3], [12, 4]] },
    ruin: { dice: [[1, 5], [13, 6], [17, 7]] },
    turning: { maxTargets: [[1, 1], [11, 2], [15, 3]], rounds: [[1, 1], [11, 2]], save: [[1, 13], [11, 14], [15, 15]] }
  };
  function add(id, tradition, minLevel, scaling, spell) {
    templates[id] = { ...spell, tradition, minLevel, scaling };
  }
  Object.assign(templates.missile, { tradition: 'Wizard', minLevel: 1, scaling: 'missile' });
  Object.assign(templates.fireball, { tradition: 'Wizard', minLevel: 3, scaling: 'fireball' });
  Object.assign(templates.curse, { tradition: 'Witch', minLevel: 2, scaling: 'curse' });
  Object.assign(templates.mend, { tradition: 'Necromancer', minLevel: 1, scaling: 'mend' });
  Object.assign(templates.ward, { tradition: 'Necromancer', minLevel: 1, scaling: 'ward' });
  add('rune_shell', 'Wizard', 1, 'rune', { name: 'Runic Shell', effect: 'ward', cost: 1, absorb: 5, range: 3, rounds: 2,
    description: 'Inscribe a force shell around one nearby ally.' });
  add('binding_sigil', 'Wizard', 2, 'curse', { name: 'Binding Sigil', effect: 'curse', cost: 2, penalty: 2, range: 8, rounds: 2,
    description: 'A precise rune disrupts one distant enemy\'s attacks.' });
  add('force_lance', 'Wizard', 6, 'lance', { name: 'Force Lance', effect: 'damage', cost: 4, dice: 3, sides: 8, bonus: 2, range: 10,
    description: 'A long-range force lance hits one visible enemy without an attack roll.' });
  add('citadel_barrier', 'Wizard', 9, 'fortress', { name: 'Citadel Barrier', effect: 'ward', cost: 5, absorb: 20, range: 5, rounds: 3,
    description: 'Build a powerful force barrier around one ally.' });
  add('thorn_needle', 'Witch', 1, 'needle', { name: 'Thorn Needle', effect: 'damage', cost: 1, dice: 1, sides: 6, bonus: 0, range: 5,
    description: 'A ritual thorn strikes one visible enemy without an attack roll.' });
  add('coven_mending', 'Witch', 1, 'coven', { name: 'Coven Mending', effect: 'heal', cost: 1, dice: 1, sides: 4, bonus: 2, range: 4,
    description: 'Restore a living ally with hearth magic, up to maximum HP. Does not resurrect.' });
  add('hearth_circle', 'Witch', 3, 'hearth', { name: 'Hearth Circle', effect: 'ward', cost: 3, absorb: 10, range: 4, rounds: 2,
    description: 'Protect one ally with a woven circle of hearth signs.' });
  add('briar_cauldron', 'Witch', 6, 'briar', { name: 'Briar Cauldron', effect: 'blast', cost: 4, dice: 4, sides: 4, bonus: 0, range: 6, radius: 1, save: 13,
    description: 'Burst thorns within one tile of the target, including allies. A successful save halves damage.' });
  add('fate_unraveling', 'Witch', 9, 'fate', { name: 'Fate Unraveling', effect: 'curse', cost: 5, penalty: 4, range: 8, rounds: 4,
    description: 'Unravel an enemy\'s luck with a lasting attack hex.' });
  add('bone_shard', 'Necromancer', 1, 'bone', { name: 'Bone Shard', effect: 'damage', cost: 1, dice: 1, sides: 4, bonus: 1, range: 7,
    description: 'A shard of ancestral bone strikes one visible enemy without an attack roll.' });
  add('soul_burst', 'Necromancer', 3, 'fireball', { name: 'Soul Burst', effect: 'blast', cost: 3, dice: 3, sides: 4, bonus: 0, range: 6, radius: 2, save: 13,
    description: 'A soul shock hits everyone within two tiles, including allies. A successful save halves damage.' });
  add('ossuary_armor', 'Necromancer', 6, 'ossuary', { name: 'Ossuary Armor', effect: 'ward', cost: 4, absorb: 16, range: 2, rounds: 3,
    description: 'Enclose a nearby ally in a strong ancestral bone ward.' });
  add('death_sentence', 'Necromancer', 9, 'sentence', { name: 'Death Sentence', effect: 'damage', cost: 5, dice: 4, sides: 6, bonus: 4, range: 7,
    description: 'A concentrated death mark strikes one visible enemy without an attack roll.' });
  add('turn_undead', 'Necromancer', 7, 'turning', { name: 'Turn Undead', effect: 'turn', cost: 5, range: 6, radius: 2,
    castMinLevel: 7, maxTargets: 1, rounds: 1, save: 13, steps: 2, cooldown: 4,
    description: 'Turn weaker undead away, not destroy them. Only undead at least two levels below your casting level are eligible; bosses and deities are immune. Each may save to resist. Damage breaks turning. Four-round caster cooldown.' });
  add('weave_spark', 'Sorcerer', 1, 'needle', { name: 'Weave Spark', effect: 'damage', cost: 1, dice: 1, sides: 6, bonus: 0, range: 6,
    description: 'Draw a spark of light from the weave to strike one enemy without an attack roll.' });
  add('dawn_mending', 'Sorcerer', 1, 'mend', { name: 'Dawn Mending', effect: 'heal', cost: 2, dice: 1, sides: 6, bonus: 1, range: 6,
    description: 'Send restorative light to a distant living ally, up to maximum HP. Does not resurrect.' });
  add('aurora_guard', 'Sorcerer', 2, 'aurora', { name: 'Aurora Guard', effect: 'ward', cost: 2, absorb: 6, range: 5, rounds: 2,
    description: 'Wrap one ally in a distant light-weave ward.' });
  add('sunburst', 'Sorcerer', 3, 'sunburst', { name: 'Sunburst', effect: 'blast', cost: 3, dice: 2, sides: 8, bonus: 0, range: 7, radius: 1, save: 14,
    description: 'Release light within one tile of the target, including allies. A successful save halves damage.' });
  add('radiant_lance', 'Sorcerer', 6, 'lance', { name: 'Radiant Lance', effect: 'damage', cost: 4, dice: 3, sides: 6, bonus: 2, range: 9,
    description: 'A distant light-weave lance strikes one enemy without an attack roll.' });
  add('renewal', 'Sorcerer', 9, 'renewal', { name: 'Renewal', effect: 'heal', cost: 5, dice: 3, sides: 8, bonus: 5, range: 6,
    description: 'Restore a living ally with a powerful surge of light, up to maximum HP. Does not resurrect.' });
  add('cinder_bolt', 'Warlock', 1, 'cinder', { name: 'Cinder Bolt', effect: 'damage', cost: 1, dice: 1, sides: 8, bonus: 0, range: 5,
    description: 'A close-range dark-weave bolt strikes one enemy without an attack roll.' });
  add('pact_veil', 'Warlock', 1, 'pact', { name: 'Pact Veil', effect: 'ward', cost: 1, absorb: 3, range: 1, rounds: 3,
    description: 'A lasting but fragile dark-weave ward protects an adjacent ally or the caster.' });
  add('dread_binding', 'Warlock', 2, 'curse', { name: 'Dread Binding', effect: 'curse', cost: 2, penalty: 2, range: 7, rounds: 2,
    description: 'Bind one enemy\'s attacks with dark-weave dread.' });
  add('abyssal_pyre', 'Warlock', 3, 'fireball', { name: 'Abyssal Pyre', effect: 'blast', cost: 3, dice: 3, sides: 6, bonus: 0, range: 6, radius: 1, save: 13,
    description: 'Dark fire burns everyone within one tile, including allies. A successful save halves damage.' });
  add('black_oath', 'Warlock', 6, 'oath', { name: 'Black Oath', effect: 'curse', cost: 4, penalty: 3, range: 8, rounds: 3,
    description: 'Lay a stronger, longer dark-weave attack curse on one enemy.' });
  add('ruin_brand', 'Warlock', 9, 'ruin', { name: 'Ruin Brand', effect: 'damage', cost: 6, dice: 5, sides: 8, bonus: 0, range: 6,
    description: 'An expensive brand of ruin hits one enemy without an attack roll. No restorative magic accompanies the bargain.' });
  add('prayer_mending', 'Cleric', 1, 'coven', { name: 'Prayer Mending', effect: 'heal', cost: 1, dice: 1, sides: 6, bonus: 2, range: 2,
    description: 'A priestly petition heals one nearby living ally, up to maximum HP. Does not resurrect.' });
  add('sanctuary_ward', 'Cleric', 1, 'rune', { name: 'Sanctuary Ward', effect: 'ward', cost: 1, absorb: 5, range: 2, rounds: 2,
    description: 'Shield one nearby ally with a priestly sanctuary.' });
  add('judgment', 'Cleric', 2, 'bone', { name: 'Judgment', effect: 'damage', cost: 2, dice: 1, sides: 6, bonus: 1, range: 5,
    description: 'A modest divine judgment strikes one enemy without an attack roll.' });
  add('purifying_flare', 'Cleric', 3, 'sunburst', { name: 'Purifying Flare', effect: 'damage', cost: 3, dice: 2, sides: 6, bonus: 0, range: 5,
    description: 'A focused flare strikes one enemy without an attack roll; it is not an area blast.' });
  add('restoring_prayer', 'Cleric', 6, 'renewal', { name: 'Restoring Prayer', effect: 'heal', cost: 4, dice: 3, sides: 6, bonus: 5, range: 2,
    description: 'A strong petition restores a nearby living ally, up to maximum HP. Does not resurrect.' });
  add('hallowed_rebuke', 'Cleric', 7, 'turning', { ...templates.turn_undead, name: 'Hallowed Rebuke', tradition: 'Cleric' });
  const catalogVersion = 2, equipmentCatalog = ['missile', 'fireball', 'mend', 'ward', 'curse'];
  const catalog = name => Object.keys(templates).filter(id => templates[id].tradition === classes[resolveClass(name)]?.tradition)
    .sort((a, b) => templates[a].minLevel - templates[b].minLevel || ['damage', 'heal', 'ward', 'curse', 'blast'].indexOf(templates[a].effect) - ['damage', 'heal', 'ward', 'curse', 'blast'].indexOf(templates[b].effect));
  const canLearn = (name, id) => !!classes[resolveClass(name)]?.spellbook && catalog(name).includes(id);
  const scrollIds = Object.keys(templates).filter(id => canLearn(templates[id].tradition, id));
  const atLevel = (table, level) => table.reduce((value, [from, next]) => level >= from ? next : value, table[0][1]);
  function levelSpell(spell, level) {
    level = Math.max(1, Math.min(50, Number(level) || 1));
    const out = { ...spell };
    for (const [property, table] of Object.entries(profiles[templates[spell.id]?.scaling] || {})) out[property] = atLevel(table, level);
    if (out.dice) out.description = `${out.effect === 'heal' ? 'Healing' : 'Damage'}: ${out.dice}d${out.sides}${out.bonus ? '+' + out.bonus : ''}. ` + templates[out.id].description;
    if (out.effect === 'ward') out.description = `Absorb ${out.absorb} damage for ${out.rounds} rounds. Does not stack. ` + templates[out.id].description;
    if (out.effect === 'curse') out.description = `Enemy attack penalty: -${out.penalty} for ${out.rounds} rounds. Does not stack. ` + templates[out.id].description;
    if (out.effect === 'turn') out.description = `Up to ${out.maxTargets} undead within two tiles of the selected enemy; save DC ${out.save}. Each failing target withdraws up to ${out.steps} tiles instead of acting for ${out.rounds} turn${out.rounds === 1 ? '' : 's'}. ` + templates[out.id].description;
    return out;
  }
  function casterLevel(name, level) {
    const start = classes[resolveClass(name)]?.startLevel || 1;
    return Math.max(1, Math.min(50, Math.floor(Number(level) || 1) - start + 1));
  }
  function classSettings(name, level) {
    const rulesClass = resolveClass(name), c = classes[rulesClass]; if (!c) return null;
    level = Math.max(1, Math.min(1000, Math.floor(Number(level) || 1)));
    const castingLevel = casterLevel(name, level);
    return { ...c, rulesClass, catalogVersion, castingLevel, capacity: c.startLevel ? c.startingMagic + c.pointsPerLevel * Math.max(0, level - c.startLevel) : c.pointsPerLevel * Math.min(50, level),
      slots: atLevel(progression.prepared, castingLevel), scribeTurns: Math.max(1, 3 - Math.floor(castingLevel / 5)),
      rechargeEvery: Math.max(2, 6 - Math.floor(castingLevel / 4)), rechargeAmount: 1 + Math.floor(castingLevel / 5),
      available: catalog(name).filter(id => castingLevel >= templates[id].minLevel) };
  }
  function classSpell(id, level) {
    const t = templates[id]; if (!t) return null;
    return levelSpell({ id, ...t }, level);
  }
  function scroll(id, suffix) {
    const t = templates[id]; if (!t || !scrollIds.includes(id)) return null;
    return { name: `scroll of ${t.name.toLowerCase()}${suffix ? ' ' + suffix : ''}`, type: 'other', readable_kind: 'scroll',
      consumable_kind: 'spell-scroll', spell_scroll: id, spell_class: t.tradition, spell_min_level: t.minLevel,
      magic: t.cost, attack_modifier: 0, damage_modifier: 0, ac: 0,
      description: `Any class can equip to cast ${t.name} once${t.castMinLevel ? ', at casting level ' + t.castMinLevel + ' or higher' : ''}. Only a ${t.tradition} can scribe it; preparing it requires casting level ${t.minLevel}. Either use consumes the scroll.` };
  }
  function hash(s) { let n = 2166136261; for (const c of String(s)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
  function eligible(item) {
    return !!item?.name && Number.isSafeInteger(Number(item.magic)) && item.magic > 0 && item.magic <= 1000 &&
      (!item.consumable_kind || item.consumable_kind === 'spell-scroll') && !item.currency_kind && !/^healing potion(?: \d+ hp)?$/i.test(item.name);
  }
  function recipe(item) {
    if (!eligible(item)) return [];
    if (item.spell_scroll && templates[item.spell_scroll]) return [{ id: item.spell_scroll, ...templates[item.spell_scroll], cost: Number(item.magic) }];
    const capacity = Number(item.magic), first = item.type === 'shield' ? 'ward' : item.type === 'armor' ? 'mend' : capacity >= 3 ? 'fireball' : 'missile';
    const order = [first, ...equipmentCatalog.filter(id => id !== first).sort((a, b) => hash(item.name + a) - hash(item.name + b))];
    let budget = capacity;
    return order.flatMap(id => {
      const t = templates[id]; if (t.cost > budget) return [];
      budget -= t.cost; return [{ id, ...t }];
    }).slice(0, 3);
  }
  function decorate(recipe, rows) {
    const clean = (s, max) => typeof s === 'string' ? s.replace(/[\x00-\x1f<>"`{}]/g, ' ').trim().slice(0, max) : '';
    const names = new Set();
    return recipe.map(spell => {
      const matches = Array.isArray(rows) ? rows.filter(r => r?.id === spell.id) : [];
      const row = matches.length === 1 ? matches[0] : null, name = clean(row?.name, 70), lore = clean(row?.lore, 220);
      if (!name || !lore || names.has(key(name))) return spell;
      names.add(key(name)); return { ...spell, name, lore };
    });
  }
  function command(text) {
    const m = /^cast\s+(.+?)\s+from\s+(.+?)\s+(?:at|on)\s+(.+?)(?:\s+by\s+(.+))?$/i.exec(String(text).trim());
    return m ? { spellName: m[1], itemName: m[2], target: m[3], caster: m[4] || null } : null;
  }
  return { key, hash, traditions, templates, progression, profiles, archetypes, nativeHp, resolveClass, monsterArchetype, monsterClass, catalogVersion, catalog, canLearn, scrollIds, atLevel, levelSpell, casterLevel, classes, classSettings, classSpell, scroll, eligible, recipe, decorate, command, ARTIFACT_RECHARGE_TURNS: 5 };
});
