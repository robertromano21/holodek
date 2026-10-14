(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./equipmentRules'));
  else root.EconomyRules = factory(root.EquipmentRules);
})(typeof window === 'object' ? window : globalThis, function(Gear) {
  'use strict';
  const PRICES = Object.freeze({ potion: 2, healingUnit: 1, healingHP: 10, resurrectionMinimum: 5 });
  const POTION = Object.freeze({ name: 'healing potion 10 hp', type: 'other', consumable_kind: 'healing',
    price_silver: PRICES.potion, attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 10,
    description: 'Drink to restore up to 10 HP to a living party member. Consumed after use; cannot resurrect the dead.' });
  const key = v => String(v || '').trim().toLowerCase();
  function healingPotion(magic = 10) {
    if (!Number.isInteger(magic) || magic < 3 || magic > 10) throw Error('Healing potion Magic must be an integer from 3 to 10.');
    return { ...POTION, name: `healing potion ${magic} hp`, magic, price_silver: Math.ceil(magic / 5),
      description: `Drink to restore up to ${magic} HP (Magic: ${magic}) to a living party member. Consumed after use; cannot resurrect the dead.` };
  }
  function isHealingPotion(item) {
    return !!item && Number.isInteger(item.magic) && item.magic >= 3 && item.magic <= 10 &&
      (item.consumable_kind === 'healing' || item.type === 'other' && /^healing potion(?: \d+ hp)?$/i.test(String(item.name)));
  }
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function startingSilver(pc, party = []) {
    const names = new Set([pc, ...party].map(a => key(a?.Name || a?.name)).filter(Boolean));
    return [...names].filter(name => name !== 'mortacia').length;
  }
  function wallet(actor, seed) {
    const race = key(actor.race || actor.Race), job = key(actor.job), n = hash(seed + ':' + actor.name);
    const beast = /\b(beast|wolf|hound|serpent|spider|rat|dragon|animal|ooze|slime|elemental)\b/.test(race);
    if (beast) return { silver: actor.coinOrigin === 'swallowed-fare' ? 1 : 0, origin: actor.coinOrigin === 'swallowed-fare' ? 'swallowed-fare' : 'no-purse' };
    if (/ferryman|toll.?keeper|toll.?collector/.test(job)) return { silver: 4 + n % 7, origin: 'collected-tolls' };
    if (/raider|bandit|robber|marauder/.test(job)) return { silver: n % 5, origin: 'plunder' };
    if (/shade|ghost|spirit|wraith|revenant|human|elf|dwarf|gnome|halfling/.test(race))
      return { silver: n % 3 === 0 ? 1 : 0, origin: n % 3 === 0 ? 'uncrossed-fare' : 'lost-or-spent-fare' };
    return { silver: 0, origin: 'no-recorded-coins' };
  }
  function price(item) {
    if (isHealingPotion(item)) return Math.ceil(item.magic / 5);
    if (item.equipment_source === 'engine-srd-basic-v1' && Object.hasOwn(Gear?.catalog || {}, item.name)) return Gear.catalog[item.name].price_silver;
    return Math.max(1, Math.min(50, ({ weapon: 4, armor: 5, shield: 3, other: 2 }[item.type] || 2) +
      ['attack_modifier', 'damage_modifier', 'ac', 'magic'].reduce((sum, field) => sum + Math.max(0, Number(item[field]) || 0), 0)));
  }
  function resurrectionPrice(level) { return Math.max(PRICES.resurrectionMinimum, Math.ceil(Math.max(1, Number(level) || 1) / 2)); }
  return { PRICES, POTION, healingPotion, isHealingPotion, key, hash, startingSilver, wallet, price, resurrectionPrice };
});
