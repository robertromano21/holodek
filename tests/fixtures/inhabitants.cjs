'use strict';
// Complete offline model replies; production must never manufacture missing residents.
module.exports = function inhabitants(count = 8, overrides = []) {
  return Array.from({ length: count }, (_, slot) => {
    const row = overrides.find(value => value.slot === slot) || {};
    const dialogue = row.dialogue || ['Welcome to the workshop.'];
    return { slot, name: `Resident ${slot}`, race: 'Human', class: 'Grave Mason',
      combatRole: row.combatArchetype && row.combatArchetype !== 'Fighter' ? 'Spellcaster' : 'Warrior',
      combatArchetype: 'Fighter', spellPreferences: [], job: 'grave mason', activity: 'repairing a lintel',
      personality: 'Patient and curious.', voice: 'Warm, practical observations.',
      history: `Restored the bridge at crossing ${slot}. Taught apprentices to carve memorials.`,
      motivation: 'Finish the memorial bridge.', routine: 'work',
      ...row, dialogue: [...dialogue, 'The bridge needs repairs.', 'I taught the apprentices.'].slice(0, 3) };
  });
};
