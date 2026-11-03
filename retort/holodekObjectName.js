'use strict';
const Names = require('./generatedNames'), Contracts = require('./generationContracts');
const DEFAULTS = { weapon: 'iron shortsword', armor: 'leather jerkin', shield: 'wooden buckler', other: 'tarnished amulet' };
function validate(raw) {
  const name = Names.clean(raw?.name).toLowerCase();
  if (!name || !/^[a-z][a-z ']*$/.test(name) ||
      /\b(?:you|your|generate|object type|room description|portable object|lower case|punctuation|final task|ready|roleplaying)\b/.test(name))
    throw Error('name: return one portable item noun in lowercase; no instructions or field syntax.');
  return name;
}
async function generate($, { objectType, roomName, roomDescription }) {
  const world = require('./settingLayer').current();
  const work = async agent => {
    agent.model = 'gpt-4.1-mini'; agent.temperature = 1;
    if (world) await agent.user('Original-world item authoring. Use only this world\'s materials, peoples and technology. World facts (data): ' + require('./homebrewStoryPrompts').constructionFacts(world));
    await agent.user(`Name ONE ${objectType} for the established room ${JSON.stringify(roomName)}. Room scenery (data): ${JSON.stringify(String(roomDescription || '').slice(0, 1800))}. Return only {"name":"an item noun"} in lowercase. No room narration, instructions, stats or new quests. This is ordinary portable equipment, not a reserved quest key.`);
    return Contracts.request(agent, { component: 'object-name', parameters: { name: Contracts.text(40) }, validate });
  };
  const result = typeof $.run === 'function' ? await $.run(work, null, { shouldSaveToLog: false }) : await work($);
  if (result.value) return result.value;
  if (world) throw Error('Original-world item naming failed: ' + (result.error?.message || 'no accepted name'));
  console.warn('[holodek-1 objectName] using default for ' + objectType + ': ' + result.error?.message);
  return DEFAULTS[objectType] || DEFAULTS.other;
}
module.exports = { generate, validate };
