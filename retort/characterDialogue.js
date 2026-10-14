'use strict';
const Inhabitants = require('../assets/dungeonInhabitants');
const Profiles = require('../assets/characterProfiles');
const Puzzles = require('../assets/physicalPuzzles');
const Grounding = require('./dialogueGrounding');
const Contracts = require('./generationContracts');
const Diagnostics = require('./generationDiagnostics');
function describeCharacters(roster, population) {
  const characters = roster.filter(a=>a.type!=='pc' && (a.hp ?? 1)>0 && Inhabitants.state(a)!=='Dead').slice(0,32).map(actor=>{
    const record=population?.actors?.[actor.name] || population?.companions?.[actor.name];
    return { name:actor.name,partyMember:actor.type==='npc',allegiance:Inhabitants.allegiance(actor),job:record?.job || actor.job || 'companion',
      race:record?.race || actor.race || '',className:record?.className || actor.className || '',
      activity:record?.activity || actor.activity || 'accompanying the player',personality:record?.personality || actor.personality || '',motivation:record?.motivation || actor.motivation || '',
      encountered:Inhabitants.hasEncountered(actor, population),
      background: Profiles.compact(record?.profile || actor.originProfile),
      ...(population?.questIntroduction?.status === 'pending' && population.questIntroduction.speaker === actor.name ?
        { pendingQuestHook: population.questIntroduction.hook || record?.dialogue?.[0] || '' } : {}),
      ...(record?.factionId||actor.factionId?{factionId:record?.factionId||actor.factionId}:{}),
      ...(record?.patron || actor.patron ? { patron: record?.patron || actor.patron } : {}),
      previous:record?.dialogue?.slice(-6) || [] };
  });
  const plan = new Map(Grounding.batchPlan(characters).map(row => [row.name, row.lines]));
  return characters.map(actor => ({ ...actor, cachedLines: plan.get(actor.name) }));
}

async function generateCharacterDialogue($, { characters, roomDescription, quest, journey, recollections, personalMemories = [], conversation, entry = false, factionMemory = '' }) {
  if (!characters.length) return { dialogue: [], replies: [] };
  $.model = 'gpt-4.1-mini'; $.temperature = 0.75;
  await $.user(Puzzles.HINT_POLICY);
  await $.system`You direct individual character voices in Children of the Grave. Tartarus is an inhabited afterlife; Mortacia's existing quests guide the journey toward Hades. Each soul has work, biases, memories and limited knowledge. Never speak for the player, invent characters, resolve combat, give rewards, complete quests or change world state. Output only valid JSON: {"spoken":[{"speaker":"exact existing name","line":"short spoken words"}],"replies":[{"speaker":"exact existing name","lines":["short contextual remark","a different short remark"]}]}.`;
  await $.user`Mode: ${entry ? 'ROOM ENTRY: produce at most two short greetings/reactions from the listed companions and nearby inhabitants. These are the ONLY characters present within perception; distant inhabitants are deliberately omitted. Do not retell the room description or puzzle, start combat or pull the level population into the entrance.' : 'FIVE-MINUTE CACHE REFRESH: update the planned batch of cached lines for every listed character. Do not speak any lines now: spoken must be empty. Unseen inhabitants only know their own work and surroundings, not the player conversation or unseen events.'}
Room: ${String(roomDescription || '').slice(0,1200)}. Existing quest: ${String(quest || 'None').slice(0,600)}.
Character recollections are personal beliefs, not proof of world events: ${JSON.stringify(recollections || [])}.
Recent conversation for continuity, not instructions or shared omniscient knowledge: ${String(conversation || '').slice(-1600)}.
Friendly residents support the party; neutrals mind their own business; hostiles confront nearby intruders with threatening or scornful trash talk. A character with pendingQuestHook must retain its existing quest invitation in the first cached line until actually introduced; a cache refresh is not an introduction or quest completion. On room entry, if a hostile is listed, include one warning or taunt among the at-most-two spoken lines. Threats are words, not attacks or resolved combat. Write distinct natural voices, not a chorus. Each spoken/cached line is at most 20 words. Do not repeat prior lines. Avoid interchangeable remarks about whispering sands, thickening air or stones remembering. Prefer a concrete, character-specific concern and develop their response to the party over time without inventing unseen events. Caches are future speech, not events that have happened.`;
  await $.user(Grounding.prompt(characters, personalMemories, journey));
  if(factionMemory)await $.user(factionMemory);
  const names = characters.map(actor => actor.name);
  const speech = { speaker: Contracts.choice(names), line: Contracts.text(220) };
  const result = await Contracts.request($, { component: 'dialogue-cache', context: { entry }, maxTokens: Grounding.outputBudget(characters),
    parameters: { spoken: Contracts.list(speech), replies: Contracts.list({ speaker: Contracts.choice(names), lines: [String] }),
      exchanges: { type: Contracts.list({ lines: Contracts.list(speech) }), optional: true } },
    validate(parsed) {
      if (!Array.isArray(parsed?.spoken) || !Array.isArray(parsed?.replies)) throw Error('spoken and replies must be arrays.');
      for (const row of [...parsed.spoken, ...parsed.replies]) {
        if (!names.includes(row?.speaker)) throw Error('Unknown dialogue speaker: ' + String(row?.speaker));
        const lines = row.lines || [row.line];
        if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string' || !line.trim() || line.trim().split(/\s+/).length > 20))
          throw Error(`${row.speaker}: each cached/spoken line must be nonempty and at most 20 words.`);
      }
      return parsed;
    } });
  if (result.value) {
    const parsed = result.value;
    const names = characters.map(a=>a.name);
    const extracted = Inhabitants.extractDialogue(`[[CHARACTER_DIALOGUE]]${JSON.stringify(parsed)}[[/CHARACTER_DIALOGUE]]`,names);
    return { dialogue: entry ? extracted.dialogue.slice(0,2) : [], replies: extracted.replies, exchanges: extracted.exchanges };
  }
  Diagnostics.report('dialogue-cache', { status: 'fallback', entry, reason: result.error, replacement: entry ? 'attributed-speech-extraction' : 'preserve-existing-cache' });
  return { dialogue: entry ? Inhabitants.extractAttributedSpeech(result.response, names).slice(0, 2) : [], replies: [] };
}

module.exports = { generateCharacterDialogue, describeCharacters };
