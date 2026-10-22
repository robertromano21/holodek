(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EquipmentRules = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // SRD medium damage and armor bonuses, with local silver prices and bounded ranges.
  const rows = [
    ['club', 'weapon', '1d6', 0, 1], ['dagger', 'weapon', '1d4', 0, 2],
    ['quarterstaff', 'weapon', '1d6', 0, 2], ['short sword', 'weapon', '1d6', 0, 4],
    ['longsword', 'weapon', '1d8', 0, 6], ['battleaxe', 'weapon', '1d8', 0, 5],
    ['warhammer', 'weapon', '1d8', 0, 5], ['greatsword', 'weapon', '2d6', 0, 10],
    ['sling', 'weapon', '1d4', 0, 2, 10], ['shortbow', 'weapon', '1d6', 0, 6, 12],
    ['longbow', 'weapon', '1d8', 0, 10, 20], ['light crossbow', 'weapon', '1d8', 0, 8, 16],
    ['padded armor', 'armor', null, 1, 3], ['leather armor', 'armor', null, 2, 5],
    ['studded leather armor', 'armor', null, 3, 8], ['chain shirt', 'armor', null, 4, 12],
    ['light wooden shield', 'shield', null, 1, 3], ['heavy wooden shield', 'shield', null, 2, 6]
  ];
  const catalog = Object.fromEntries(rows.map(([name, type, damage_dice, ac, price_silver, range]) => [name, {
    name, type, damage_dice, ac, price_silver, range_tiles: range || 1.5,
    attack_modifier: 0, damage_modifier: 0, magic: 0, equipment_source: 'engine-srd-basic-v1',
    description: type === 'weapon' ? `${damage_dice} weapon damage plus your Damage modifier. ` +
      (range ? `Ranged: ${range} tiles (one SRD range increment). Requires clear sight; -4 Attack when an enemy threatens you. Ammunition and reloading are abstracted into one attack per turn.` : 'Melee: adjacent target and clear sight.') :
      `Adds ${ac} to Armor and combat AC while equipped in the ${type === 'armor' ? 'Armor' : 'Shield'} slot. No damage reduction. One item per slot; armor and shield bonuses combine.`
  }]));
  const rangedRules = () => typeof module === 'object' && module.exports ? require('./rangedRules') : (typeof window === 'object' ? window.RangedRules : null);
  const rangedOn = () => { try { return typeof module === 'object' && module.exports ? require('../retort/worldFlags').on('RANGED_COMBAT') : !!window.HolodekFlags?.RANGED_COMBAT; } catch { return false; } };
  const key = value => String(value?.name || value || '').trim().toLowerCase();
  function weapon(actor) {
    const name = key(actor?.equipped?.Weapon || actor?.equipped?.weapon || actor?.Equipped?.Weapon);
    if (catalog[name]?.type === 'weapon') return catalog[name];
    const ranged = /\b(light crossbow|crossbow|longbow|shortbow|bow|sling)\b/.exec(name)?.[1];
    if (ranged) return catalog[ranged === 'crossbow' ? 'light crossbow' : ranged === 'bow' ? 'shortbow' : ranged];
    // world1 RANGED_COMBAT: genre ranged weapons (revolver, blaster, smartgun...) resolve through RangedRules.
    const R = rangedOn() && rangedRules(); const g = R && R.find(name);
    if (g && g.damage_dice) return { name: g.name, type: 'weapon', damage_dice: g.damage_dice, range_tiles: g.range_tiles, price_silver: g.price_silver, attack_modifier: 0, damage_modifier: 0, magic: 0, equipment_source: 'world1-ranged', description: R.tooltip(g) };
    return null;
  }
  function reach(actor) { return weapon(actor)?.range_tiles || (/\b(spear|pike|halberd)\b/.test(key(actor?.equipped?.Weapon)) ? 2 : 1.5); }
  function ranged(actor) { return (weapon(actor)?.range_tiles || 0) > 2; }
  function armorBonus(actor) {
    return ['Armor', 'Shield'].reduce((sum, slot) => sum + (catalog[key(actor?.equipped?.[slot])]?.ac || 0), 0);
  }
  return { catalog, weapon, reach, ranged, armorBonus, stock: (genre) => [...Object.values(catalog).map(item => ({ ...item, quantity: 2 })),
    // world1 RANGED_COMBAT: genre ranged weapons and ammo bundles (rare resource items are loot-only).
    ...(rangedOn() && rangedRules() ? rangedRules().stock(genre || 'cotg').filter(i => !catalog[i.name]) : [])] };
});
