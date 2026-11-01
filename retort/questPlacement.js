'use strict';
const Routes = require('../assets/outdoorRoutes');
function plan({ coordinates, currentRoomKey, bossKey, elementType, hasMonstersInCurrent, preferElsewhere, alreadyUsed = [] }) {
  const candidates = [...Routes.coordinateKeys(coordinates)].filter(key => key !== bossKey);
  if (!candidates.length) throw Error('Quest placement has no allowed existing room.');
  const currentAllowed = candidates.includes(currentRoomKey);
  const reuseResident = elementType === 'monster' && hasMonstersInCurrent && currentAllowed;
  // A preference must not remove a room which the same prompt asks the model to choose.
  const preference = reuseResident ? 'Prefer the current room and reuse an existing appropriate non-party inhabitant at its saved location.' :
    preferElsewhere && candidates.some(key => key !== currentRoomKey) ? 'Prefer a room away from the current room when it serves the quest; this is a preference, not an exclusion.' :
      'Choose a meaningful existing location for this quest element.';
  const data = { elementType, candidates, ...(currentAllowed ? { currentRoomKey } : {}), alreadyUsed, preference };
  return { candidates, data, instruction: preference + ' Use only the exact allowed coordinate enum; never relocate an existing inhabitant or use the boss room.',
    brief: `Choose the placement for this quest element. Read-only data: ${JSON.stringify(data)}. ${preference} Return ONLY {"placement":"x,y,z"} using one of the exact allowed coordinates. Never use the boss room.` };
}
async function request($, selection) {
  const result = await require('./generationContracts').request($, { component: 'quest-required-placement',
    parameters: { placement: { type: String, enum: selection.candidates } }, context: selection.data, maxTokens: 50,
    retryHint: selection.instruction,
    validate(value) {
      if (!selection.candidates.includes(value?.placement)) throw Error('Quest placement must be one of the exact allowed existing coordinates.');
      return value;
    } });
  if (!result.value) throw result.error || Error('No accepted quest element placement.');
  return { content: result.response };
}
module.exports = { plan, request };
