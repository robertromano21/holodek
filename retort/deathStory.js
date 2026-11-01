'use strict';
const FIELDS = ['reason', 'firstReturn', 'secondReturn', 'finalDeath'];
const SCENE_FIELDS = ['reviver', 'scene', 'firstMeeting', 'secondMeeting'];
const hasScene = value => SCENE_FIELDS.every(k => typeof value?.[k] === 'string' && !!value[k].trim());
const INSTRUCTIONS = 'Author the reason this world can bring the player back exactly twice, with permanent game over on the third death. Match its genres, tone, technology and established powers. This is fiction explaining engine rules, not new mechanics: confirmed death triggers a brief blackout and a separate between-lives scene, then returns the player alone to the current level’s original spawn point at half maximum HP. Former companions remain where they were, friendly, with their memories intact. This is not time reversal: no new items, costs, quests, restored consumables or changed inventory. Unconsciousness is not death and spends no life. Explain why only two returns are possible. Write concise second-person prose for each return and final death. Do not claim survival after the final death. Also author reviver (the person, spirit, AI or embodied agent met in person), scene (what the player sees in this separate liminal scene), firstMeeting and secondMeeting (the reviver speaking directly to the player, explaining why they intervened, remaining chances and return alone). Preserve any existing saved reason for revival; embody its mechanism consistently with this world, without adding a resident, quest or gameplay resource. Keep all eight fields consistent.';
function validate(value) {
  if (!value || FIELDS.some(k => typeof value[k] !== 'string' || !value[k].trim() || value[k].length > 600))
    throw Error('This world needs a complete authored three-life explanation.');
  if (SCENE_FIELDS.some(k => value[k] !== undefined) && (!hasScene(value) || SCENE_FIELDS.some(k => value[k].length > 600))) throw Error('The revival scene must be complete.');
  return Object.fromEntries([...FIELDS, ...(hasScene(value) ? SCENE_FIELDS : [])].map(k => [k, value[k].trim()]));
}
function parameters(Contracts) { return Contracts.object(Object.fromEntries([...FIELDS, ...SCENE_FIELDS].map(k => [k, Contracts.text(600)]))); }
async function generate(bible, runner) {
  if (typeof runner !== 'function') throw Error('A model is required to author this world’s recovery explanation.');
  const C = require('./generationContracts');
  const value = await runner(async $ => {
    await $.user(INSTRUCTIONS + '\nWorld bible (saved data): ' + JSON.stringify(bible));
    const result = await C.request($, { component: 'world-death-story', maxTokens: 2400,
      parameters: parameters(C).type, validate });
    if (!result.value) throw Error(result.error?.message || 'The recovery explanation could not be authored.');
    return result.value;
  });
  return validate(value);
}
function policy(bible) {
  const cotg = !bible || bible.kind !== 'homebrew';
  return { cotg, title: cotg ? 'Divine Intervention' : 'Second Chance',
    counter: cotg ? 'Divine Rescues' : 'Recoveries', story: cotg ? null : bible.deathStory };
}
module.exports = { FIELDS, SCENE_FIELDS, hasScene, INSTRUCTIONS, validate, parameters, generate, policy };
