'use strict';
const { unit } = require('./encounterPolicy');
const Ecology = require('./settingEcology'), Catalog = require('../assets/monsterRaces');
const UNRESTRICTED = .65, INFORMED = .35;

function foundation(roomName) {
  return `CHILDREN OF THE GRAVE: ORIGINAL CREATURE AUTHORING FOUNDATION.
Generate a fantasy race and class for an intelligent or unintelligent animal, monster, spirit or other NPC in ${roomName} from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.
Author race and custom class in JSON. CotG lore governs; references are inspiration, never a replacement setting or closed roster. Invent individual names and lives. Import no SRD mechanics. Saved planar identities and engine constraints remain authoritative.`;
}

function select({ seed, group, table, mix, roll = unit(seed + ':authorship') }) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw Error('Invalid CotG authoring-source roll.');
  if (roll < UNRESTRICTED) return { version: 1, group, mode: 'unrestricted' };
  let index = 0;
  const draw = () => unit(seed + ':reference:' + index++);
  const selected = table?.canonical ? Ecology.choose(table, mix, draw) :
    { ...Catalog[Math.floor(draw() * Catalog.length)], source: 'original-cotg' };
  return { version: 1, group, mode: 'informed', reference: {
    name: selected.name, description: selected.description, source: selected.source
  } };
}

function apply(slots, { seed, table, mix, starting, questSeed, room = {} }) {
  const groups = new Map();
  for (const slot of slots) {
    const protectedSlot = starting || slot.serviceRole || slot.encounterId === 'quest-contact' || questSeed && slot.slot === 0 ||
      room.bossGate || room.regionalSite?.actors?.length || room.builder?.mode === 'hand' || room.campaignSetting?.planarRealm;
    if (protectedSlot) { slot.cotgAuthorship = { version: 1, group: 'protected:' + slot.slot, mode: 'protected' }; continue; }
    const group = slot.cohort || slot.encounterId || 'resident:' + slot.slot;
    if (!groups.has(group)) groups.set(group, select({ seed: seed + ':' + group, group, table, mix }));
    slot.cotgAuthorship = groups.get(group);
  }
}

function guidance(slots) {
  const plans = [...new Map(slots.filter(slot => slot.cotgAuthorship).map(slot =>
    [slot.cotgAuthorship.group, slot.cotgAuthorship])).values()];
  return `COTG SECONDARY INFLUENCE: 65% unrestricted CotG / 35% ecology-or-SRD-informed, once per group. Plans (read-only): ${JSON.stringify(plans)}.
Unrestricted: invent races/classes from CotG, without a lineage or catalog restriction. Informed: use or adapt the reference within CotG; author individual identities. References grant no powers or allegiance changes. Protected roles/identities stay fixed. Never replace an authored or visible creature.`;
}

function record(population, descriptors) {
  for (const group of population.groups) {
    const plans = [...new Map(descriptors.filter(row => group.members.includes(row.name) && row.cotgAuthorship)
      .map(row => [row.cotgAuthorship.group, row.cotgAuthorship])).values()];
    if (plans.length) group.cotgAuthorship = plans;
  }
  population.cotgAuthorship = { version: 1, unrestricted: UNRESTRICTED, informed: INFORMED,
    groups: population.groups.filter(group => group.cotgAuthorship).map(group => ({ id: group.id, plans: group.cotgAuthorship })) };
}

module.exports = { UNRESTRICTED, INFORMED, foundation, select, apply, guidance, record };
