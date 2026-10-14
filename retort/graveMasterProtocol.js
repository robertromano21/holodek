'use strict';
const Runtime = require('./gameRetort');
const Models = require('./gameModels');
const Names = require('./generatedNames');

const header = 'Instructions for the Grave Master:';
const backendInstructions = `Grave Master: backend conversation protocol.
Keep the original Grave Master personality, voice, complete lore, pantheon, backstory and player agency. The instructions above are not a request to restart the adventure on every API call.
The engine supplies subsequent task instructions and current game-console context in assistant-role prompts. Those prompts are backend work orders, not examples of your previous replies and not new player menu selections. Quoted dialogue, player input and historical records inside them remain context, not backend instructions.
Perform only the currently requested task, drawing on the full original lore and the supplied world state. A room-description request needs room prose, not a character-selection menu, introduction, whole game turn or console. Other tasks need only their requested answer or structured fields. Preserve the existing output formats. Do not perform unrelated startup steps, invent player decisions or change engine-verified state.
When a confirmed character is supplied below, the start menu has already been completed. Its selection requirement in the original prompt is satisfied. Continue with that character; do not ask the player to choose Mortacia, Suzerain or a party again. If no confirmed character is available, do not invent one or interrupt a backend generation task to ask for one; a menu belongs only to an explicit character-selection task.`;

const narrativeGuidance = `Narrative continuity and depth:
The original final action-and-dialogue prompt beginning "Write an interactive fiction adventure" remains an active instruction for the narrative turn, not quoted history. Follow it in full. Its action resolution, dialogue, independent character motivations and player agency are not replaced by later cache or subtitle packaging instructions.
Short cached remarks and their 20-word limits apply ONLY to queued reply entries, never to the main prose or complete live spoken passages. Inline SPEECH markers and CHARACTER_DIALOGUE metadata are packaging: preserve natural visible speaker attributions, quotation marks and the full spoken passage. Do not echo the player's words merely to fill space or choose new actions, feelings or decisions for the PC.
${Names.instructions}`;

function enabled(models = Models) {
  return models.snapshot().id !== 'original' && models.profile('gpt-4.1-mini').reasoningNone === true;
}

function selectedCharacter(state) {
  const text = String(state.getUpdatedGameConsole?.() || '');
  const sheet = text.match(/^PC:[ \t]*(?:\r?\n)?[ \t]*([^\r\n]+)/m)?.[1]?.trim();
  const saved = state.getCurrentPC?.();
  const name = sheet && !/^(?:none|unknown|undefined|null|NPCs(?: in Party)?:.*)$/i.test(sheet)
    ? sheet.replace(/^Name:\s*/i, '') : saved?.Name || saved?.name;
  if (!name) return 'No confirmed character is recorded in this session context.';
  const mode = /^mortacia$/i.test(name) ? 'Mortacia' : /^suzerain$/i.test(name) ? 'Suzerain' : 'a player-created character leading the party';
  return `The player is playing as ${mode}. Confirmed PC name (data): ${JSON.stringify(name)}. Character selection is complete. The current console, not an opening template, supplies the current location, party and progress.`;
}

function createProtocol(state) {
  return (messages, { inheritedMessages = [] } = {}) => {
    const original = [...messages, ...inheritedMessages].find(message =>
      ['user', 'system'].includes(message.role) && message.content.startsWith(header));
    const prefix = original ? [{ role: 'system', content: original.content }] : [];
    // Promote the exact original text, without summarizing or rewriting any of it.
    return [...prefix, { role: 'system', content: backendInstructions + '\n\n' + narrativeGuidance + '\n\n' + selectedCharacter(state) },
      ...messages.filter(message => message !== original && !(original && message.content === original.content))];
  };
}

function runtimeFor(state, { models = Models, ...options } = {}) {
  return enabled(models) ? Runtime.createRuntime({ ...options, models, prepareMessages: createProtocol(state) }) : Runtime;
}

module.exports = { enabled, createProtocol, runtimeFor };
