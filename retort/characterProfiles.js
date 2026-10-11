'use strict';
const Profiles = require('../assets/characterProfiles');
async function generateProfiles($, characters, runId) {
  const unique = [...new Map(characters.filter(actor => actor?.Name || actor?.name).slice(0, 12)
    .map(actor => [String(actor.Name || actor.name), actor])).values()];
  const missing = unique.filter(actor => !actor.originProfile && !Profiles.create(actor).canonical);
  let generated = [];
  if (missing.length) {
    $.model = 'gpt-4.1-mini'; $.temperature = .85;
    await $.user`Create compact, distinct personal backgrounds for these Children of the Grave party characters:
${JSON.stringify(missing.map(actor => ({ name: actor.Name || actor.name, race: actor.Race || actor.race, class: actor.Class || actor.className })))}.
Return ONLY {"profiles":[{"name":"exact name","personality":"individual temperament, flaw and social habits","voice":"distinct manner of speaking","history":"two short sentences about personal experiences before this adventure","motivation":"personal desire or fear"}]}.
These characters are in the underworld after death. Make each background different; use their race and class, not interchangeable tragic monologues. Do not invent completed campaign quests, current inventory, keys, puzzle solutions, a replacement boss, or knowledge of encounters they have not witnessed. Mortacia and Suzerain have established canon and must not be rewritten. No character-sheet fields or sprite changes. History <=70 words, personality <=30 words, voice <=20 words, motivation <=25 words.`;
    try {
      const result = await $.assistant.generation({ maxTokens: Math.min(4000, missing.length * 320 + 120) });
      generated = JSON.parse(String(result.content || '').replace(/^```json\s*|\s*```$/g, '')).profiles;
    } catch (error) { console.warn('[CharacterProfiles] Using stable local backgrounds:', error.message); }
  }
  return unique.map(actor => Profiles.create(actor, runId, Array.isArray(generated) ?
    generated.find(row => row.name === (actor.Name || actor.name)) || actor.originProfile : actor.originProfile));
}
module.exports = { generateProfiles };
