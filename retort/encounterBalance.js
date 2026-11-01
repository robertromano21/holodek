'use strict';

function partySummary(roster = []) {
  const active = roster.filter(actor => {
    const type = actor.type;
    return (!type || type === 'pc' || type === 'npc') && actor.combatant !== false && !actor.noncombatant &&
      Number(actor.hp ?? actor.HP ?? 0) > 0 && !/^(dead|dying|unconscious)$/i.test(actor.state ?? actor.State ?? '');
  });
  // Retain the existing exceptional-premade level exemption, not a difficulty cap on bosses.
  const mortal = active.filter(actor => (actor.name ?? actor.Name) !== 'Mortacia');
  const average = mortal.length ? mortal.reduce((sum, actor) => sum + Math.max(1, Number(actor.level ?? actor.Level) || 1), 0) / mortal.length : 3;
  return { size: Math.max(1, active.length), level: Math.max(1, Math.min(12, Math.floor(average))) };
}

function groupSize(size = 1, roll = .5) {
  const variation = roll < .25 ? -1 : roll >= .75 ? 1 : 0;
  return Math.max(2, Math.min(6, Math.max(2, size) + variation));
}

function settlement(setting, room = {}) {
  return !!(setting?.inhabited || setting?.city || setting?.village || room.cityRoom?.venue);
}

function partition(total, target) {
  if (total < 2) return [];
  const groups = Math.max(Math.ceil(total / 6), Math.min(Math.floor(total / 2), Math.round(total / target)));
  return Array.from({ length: groups }, (_, index) => Math.floor(total / groups) + (index < total % groups ? 1 : 0));
}

function plan(slots, { party, starting, encounter, hostileTemple, settled, roll = .5 } = {}) {
  if (starting || encounter?.identity || !party?.length) return;
  const target = groupSize(partySummary(party).size, roll);
  const eligible = slots.filter(slot => !slot.serviceRole && slot.encounterId !== 'quest-contact' &&
    (encounter || hostileTemple || slot.slot >= 3));
  const combatSlots = encounter || hostileTemple ? eligible : settled ? eligible.slice(0, Math.min(6, Math.floor((slots.length - 1) / 2))) :
    eligible.filter(slot => slot.allegiance === 'Hostile');
  const counts = encounter ? [combatSlots.length] : partition(combatSlots.length, target);
  let offset = 0;
  for (const [index, count] of counts.entries()) {
    if (count < 2) continue;
    const cohort = combatSlots.slice(offset, offset += count), unitId = cohort[0].unitId;
    for (const slot of cohort) Object.assign(slot, { cohort: `routine-${index + 1}`, cohortSize: count,
      cohortAllegiance: encounter || settled && !hostileTemple ? null : 'Hostile', ...(unitId ? { unitId } : {}) });
  }
  // Settlement threats remain an optional minority, not scattered solo attackers.
  if (settled && !encounter && !hostileTemple) for (const slot of eligible) if (!slot.cohort) slot.peaceful = true;
}

function constraint(slot, accepted) {
  const anchor = slot.cohort && accepted.find(row => row.cohort === slot.cohort);
  return { anchor, allegiance: slot.cohortAllegiance || anchor?.allegiance,
    encounterId: anchor?.encounterId, homeSite: anchor?.homeSite };
}

function guidance(slots, accepted) {
  const planned = slots.filter(slot => slot.cohort || slot.peaceful);
  if (!planned.length) return '';
  return 'ROUTINE ENCOUNTER PLAN (engine constraints, overrides suggested groups/allegiances): ' + JSON.stringify(planned.map(slot => {
    const { anchor, allegiance, encounterId, homeSite } = constraint(slot, accepted);
    return { slot: slot.slot, cohort: slot.cohort, members: slot.cohortSize, allegiance: allegiance || (slot.peaceful ? 'Friendly or Neutral' : 'choose for the entire cohort'),
      encounterId, homeSite, existingMember: anchor && { name: anchor.name, race: anchor.race, job: anchor.job, activity: anchor.activity, motivation: anchor.motivation } };
  })) + '. Members of a cohort share allegiance, encounterId and homeSite; author distinct individuals with a coherent shared situation, not unrelated solo threats. The first member chooses the group label and, when not fixed, its allegiance. Preserve this across subsequent single-slot requests. Peaceful slots cannot be Hostile. These are ordinary encounters, not authored bosses; never substitute a named cosmic power. No resolved attacks or invented quests.';
}

module.exports = { partySummary, groupSize, settlement, partition, plan, constraint, guidance };
