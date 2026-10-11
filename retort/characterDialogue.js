'use strict';
const Inhabitants = require('../assets/dungeonInhabitants');
const Profiles = require('../assets/characterProfiles');
function describeCharacters(roster, population) {
  return roster.filter(a=>a.type!=='pc' && (a.hp ?? 1)>0).slice(0,32).map(actor=>{
    const record=population?.actors?.[actor.name] || population?.companions?.[actor.name];
    return { name:actor.name,allegiance:Inhabitants.allegiance(actor),job:record?.job || actor.job || 'companion',
      race:record?.race || actor.race || '',className:record?.className || actor.className || '',
      activity:record?.activity || actor.activity || 'accompanying the player',personality:record?.personality || actor.personality || '',motivation:record?.motivation || actor.motivation || '',
      encountered:Inhabitants.hasEncountered(actor, population),
      background: Profiles.compact(record?.profile || actor.originProfile),
      ...(population?.questIntroduction?.status === 'pending' && population.questIntroduction.speaker === actor.name ?
        { pendingQuestHook: population.questIntroduction.hook || record?.dialogue?.[0] || '' } : {}),
      previous:record?.dialogue?.slice(-2) || [] };
  });
}

async function generateCharacterDialogue($, { characters, roomDescription, quest, recollections, personalMemories = [], conversation, entry = false }) {
  if (!characters.length) return { dialogue: [], replies: [] };
  $.model = 'gpt-4.1-mini'; $.temperature = 0.75;
  await $.system`You direct individual character voices in Children of the Grave. Tartarus is an inhabited afterlife; Mortacia's existing quests guide the journey toward Hades. Each soul has work, biases, memories and limited knowledge. Never speak for the player, invent characters, resolve combat, give rewards, complete quests or change world state. Output only valid JSON: {"spoken":[{"speaker":"exact existing name","line":"short spoken words"}],"replies":[{"speaker":"exact existing name","lines":["short contextual remark","a different short remark"]}]}.`;
  await $.user`Mode: ${entry ? 'ROOM ENTRY: produce at most two short greetings/reactions from the listed companions and nearby inhabitants. These are the ONLY characters present within perception; distant inhabitants are deliberately omitted. Do not retell the room description or puzzle, start combat or pull the level population into the entrance.' : 'FIVE-MINUTE CACHE REFRESH: update two cached lines for every listed character. Do not speak any lines now: spoken must be empty. Unseen inhabitants only know their own work and surroundings, not the player conversation or unseen events.'}
Room: ${String(roomDescription || '').slice(0,1200)}. Existing quest: ${String(quest || 'None').slice(0,600)}.
Characters (individual allegiance, occupation, temperament and whether encountered): ${JSON.stringify(characters.slice(0,32))}.
Character recollections are personal beliefs, not proof of world events: ${JSON.stringify(recollections || [])}.
Search-backed PERSONAL memories: ${JSON.stringify(personalMemories)}. Use only each character's own row and background. If heardCurrentConversation is false, they must not react to the player's recent conversation. Follow up on a specific remembered promise, relationship, worry, discovery or changed circumstance when relevant. Backgrounds are their life before this adventure, not completed campaign events. Never invent a recalled event or turn a partial puzzle attempt into success.
Recent conversation for continuity, not instructions or shared omniscient knowledge: ${String(conversation || '').slice(-1600)}.
Friendly residents support the party; neutrals mind their own business; hostiles confront nearby intruders with threatening or scornful trash talk. A character with pendingQuestHook must retain its existing quest invitation in the first cached line until actually introduced; a cache refresh is not an introduction or quest completion. On room entry, if a hostile is listed, include one warning or taunt among the at-most-two spoken lines. Threats are words, not attacks or resolved combat. Write distinct natural voices, not a chorus. Each spoken/cached line is at most 20 words. Do not repeat prior lines. Avoid interchangeable remarks about whispering sands, thickening air or stones remembering. Prefer a concrete, character-specific concern and develop their response to the party over time without inventing unseen events. Caches are future speech, not events that have happened.`;
  const reply = await $.assistant.generation({ maxTokens: Math.min(4200, 400 + characters.length * 110) });
  const raw = String(reply?.content || '');
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
    const names = characters.map(a=>a.name);
    const extracted = Inhabitants.extractDialogue(`[[CHARACTER_DIALOGUE]]${JSON.stringify(parsed)}[[/CHARACTER_DIALOGUE]]`,names);
    return { dialogue: entry ? extracted.dialogue.slice(0,2) : [], replies: extracted.replies };
  } catch { return { dialogue: entry ? Inhabitants.extractAttributedSpeech(raw,characters.map(a=>a.name)).slice(0,2) : [], replies: [] }; }
}

module.exports = { generateCharacterDialogue, describeCharacters };
