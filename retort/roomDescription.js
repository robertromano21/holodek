'use strict';

function creationPrompt({ name, coordinates, classification = {}, room = {} }) {
  if (typeof name !== 'string' || !name.trim() || !/^-?\d+,-?\d+,-?\d+$/.test(coordinates)) {
    throw Error('Room description needs an engine-registered name and coordinates.');
  }
  const target = { name, coordinates, indoor: classification.indoor,
    biome: classification.biome, features: classification.features, setting: room.campaignSetting?.kind };
  return `ROOM DESCRIPTION CREATION WORK ORDER. Engine-registered target (data): ${JSON.stringify(target)}.
${require('./underworldLore').GUIDANCE}
${require('./planarPortals').describe(room.planarRealm)}
This room's name, coordinates and physical classification are already chosen by the engine. Describe this target now; do not verify whether its name was established earlier or substitute the previous room. An empty description, an uninhabited placeholder or an unpopulated room means its descriptive details have not been authored yet, not that the engine forbids creating them.
Create its scenery, history and purpose using the complete Grave Master lore and the preceding creative guidance. This permission concerns descriptive worldbuilding only: do not invent portable objects, characters, exits, completed actions or mechanical rewards. Honor indoor/outdoor constraints and existing physical facts. A place name may be historical or figurative; reconcile it naturally rather than rejecting it.
Return only the finished single-paragraph room prose, without a heading, menu, explanation of the generation process, coordinates, or statements about what can or cannot be established. Do not regenerate any other room or the story continuation.`;
}

function validate(content) {
  const prose = typeof content === 'string' ? content.trim() : '';
  if (!prose || /^(?:I\s+(?:can(?:not|'t|\u2019t)|am unable to|do not have|don't have)\b|As an? (?:AI|language model)\b|(?:Please\s+)?(?:choose|select)\s+(?:your|a)\s+(?:character|game mode)\b)/i.test(prose)) {
    throw Error('Room description generation returned a meta-response instead of room prose. No description was committed.');
  }
  return prose.replace(/\s+/g, ' ');
}

async function generate($, target) {
  await $.user(creationPrompt(target));
  const result = await $.assistant.generation({ maxTokens: 220 });
  try { return validate(result.content); }
  catch (error) {
    console.error('[RoomDescription]', JSON.stringify({ status: 'invalid', name: target.name,
      coordinates: target.coordinates, error: error.message, response: String(result.content || '').slice(0, 500) }));
    throw error;
  }
}
module.exports = { creationPrompt, validate, generate };
