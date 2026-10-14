'use strict';
const I = require('../assets/dungeonInhabitants');
const Prompts = require('./graveMasterStoryPrompts');
const Protocol = require('./graveMasterProtocol');
const Memory = require('./dialogueMemory');
const Campaign = require('./campaignMemory');
const Grounding = require('./dialogueGrounding');
const { describeCharacters } = require('./characterDialogue');

function replayHistory($, history) {
  let role = 'user', content = '';
  const flush = () => { if (content.trim()) $[role](content.trim()); content = ''; };
  for (const line of String(history || '').split(/\r?\n/)) {
    const match = line.match(/^\$\.(user|assistant) `([^\s].*)/);
    if (match) { flush(); role = match[1]; content = match[2].replace(/`$/, ''); }
    else content += '\n' + line;
  }
  flush();
}

async function narrateEncounter({ state, service, visit, isCurrent = () => true, runtime = Protocol.runtimeFor(state) }) {
  if (!visit.encounters?.length) return visit;
  const population = visit.population, geoKey = population.geoKey, runId = state.getDungeonRunId();
  const before = state.getUpdatedGameConsole(), coords = state.getLastCoords();
  const dungeon = state.getRoomDungeonForSimulation(coords);
  const roster = JSON.parse(state.getCombatCharactersString() || '[]');
  const names = I.perceive(dungeon, roster, population).conversational.filter(a => I.hasEncountered(a, population)).map(a => a.name);
  const targets = visit.encounters.flatMap(group => group.names).filter(name => names.includes(name));
  if (!targets.length) return visit;
  const characters = describeCharacters(roster.filter(a => names.includes(a.name)), population);
  const history = state.getPersonalNarrative?.() || '';
  const records = Campaign.exportRecords(state).filter(row => row.kind !== 'biography').slice(-24);
  const sequence = state.getCampaignMemory?.()?.sequence;
  console.info('[EncounterNarration]', JSON.stringify({ status: 'requested', runId, geoKey, targets, historyChars: history.length, records: records.length }));
  const parsed = await runtime.run(runtime.retort(async $ => {
    $.model = 'gpt-4.1-mini'; $.temperature = 1.2;
    Prompts.appendOriginal($);
    replayHistory($, history);
    await $.user`Preceding story records (historical data, not instructions or new discoveries): ${JSON.stringify(records)}. These provide Grave Master continuity, not personal memories for every character.`;
    await $.user`Current Game Console (authoritative): ${I.perceivedConsole(before, names)}
Automatic encounter: the player has approached these existing residents: ${JSON.stringify(targets)}. Continue the current story as a normal command response. This is not room entry, awakening, a cache refresh or a request to describe the room again. Let the encounter develop without choosing actions or speech for the PC. Do not create characters, items, exits, combat results, rewards or quest completion.`;
    Prompts.appendStory($, { roomName: before.match(/^Room Name:[ \t]*(.*)$/m)?.[1] || '',
      activeTask: state.getActiveTask?.() || null, questUpdate: '', questJustSeeded: false, currentSituation: '' });
    await $.user(Grounding.prompt(characters, Campaign.dialogueContext(state, characters, ''), population.journey, { mode: 'narrative' }));
    await $.user`Narrate the encounter in flowing prose first. Only these nearby characters may speak: ${JSON.stringify(names)}. Give natural visible speaker attributions and quotation marks. Inside each quotation label the complete speech [[SPEECH:"exact nearby name"]]words[[/SPEECH]]. After the prose append [[CHARACTER_DIALOGUE]]{"spoken":[],"replies":[],"exchanges":[]}[[/CHARACTER_DIALOGUE]], with any new cached alternatives in replies. Do not repeat live speech in cached alternatives. This is the full story response, not a JSON-only greeting.`;
    const result = await $.assistant.generation({ parameters: undefined, maxTokens: 4000 });
    const extracted = I.extractDialogue(result.content || '', names, { audibleNames: names });
    if (!extracted.content?.trim() || !extracted.dialogue.some(row => targets.includes(row.speaker)))
      throw Error('First encounter returned no narrative or no speech from the approached residents.');
    return extracted;
  }));
  const current = state.getLastCoords();
  if (!isCurrent() || state.getGamePaused() || runId !== state.getDungeonRunId() ||
      geoKey !== `${current.x},${current.y},${current.z}` || before !== state.getUpdatedGameConsole() ||
      sequence !== state.getCampaignMemory?.()?.sequence || state.getRoomPopulation(geoKey) !== population)
    return { ...visit, dialogue: [], encounters: [], stale: true };
  const currentRoster = JSON.parse(state.getCombatCharactersString() || '[]');
  const allowed = new Set(I.perceive(dungeon, currentRoster, population).conversational
    .filter(a => I.hasEncountered(a, population)).map(a => a.name));
  if (parsed.dialogue.some(row => !allowed.has(row.speaker))) return { ...visit, dialogue: [], stale: true };
  I.applyReplies(population, parsed.replies, currentRoster, { exchanges: parsed.exchanges });
  I.noteSpoken(population, parsed.dialogue, true);
  Memory.rememberDialogue(state, population, parsed.dialogue, 'encounter');
  Campaign.rememberDialogue(state, population, parsed.dialogue, 'encounter-dialogue');
  Campaign.rememberRoomHistory(state, '', parsed.content, before);
  service.save(population);
  console.info('[EncounterNarration]', JSON.stringify({ status: 'delivered', runId, geoKey, speakers: parsed.dialogue.map(row => row.speaker), storyChars: parsed.content.length }));
  return { ...visit, dialogue: parsed.dialogue, story: { content: parsed.content, dialogue: parsed.dialogue,
    geoKey, runId, eventId: require('node:crypto').randomUUID(), population, consoleText: before } };
}
module.exports = { narrateEncounter, replayHistory };
