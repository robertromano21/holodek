const Inhabitants = require('../assets/dungeonInhabitants');

function needsQuestIntroduction(quest, rooms, geoKey, taskIndex = 0) {
  const text = String(quest || '').trim();
  if (!text || /^none$/i.test(text) || geoKey === '0,0,0' || taskIndex !== 0) return false;
  const questId = String(Inhabitants.hash(text));
  return !Object.values(rooms || {}).some(room => room?.inhabitants?.questIntroduction?.questId === questId);
}

async function generateInhabitants($, { roomName, roomDescription, geoKey, indoor, partyNames = [], usedNames = [], quest = '', questSeed = false }, rules) {
  questSeed = questSeed && geoKey !== '0,0,0' && !!String(quest).trim() && !/^none$/i.test(String(quest).trim());
  const count = indoor ? 8 : 16;
  const slots = Array.from({ length: count }, (_, i) => ({ slot: i,
    allegiance: i < 3 ? 'Neutral' : i < 6 ? 'Hostile' : i === 6 ? 'Friendly' : i < 10 ? 'Hostile' : 'Neutral',
    encounterId: i === 0 && questSeed ? 'quest-contact' : i < 3 ? 'workers' : i < 6 ? 'guards' : i === 6 ? 'pilgrim' : i < 10 ? 'raiders' : i < 13 ? 'wayfarers' : 'keepers' }));
  $.model = 'gpt-4.1-mini';
  $.temperature = 0.85;
  await $.user`Create the inhabitants of this ${indoor ? 'indoor dungeon complex' : 'outdoor biome'} in Children of the Grave.
Room: ${roomName}. Description: ${roomDescription}. Current quest: ${quest || 'None'}.
Return only JSON: {"inhabitants":[{"slot":0,"name":"unique exact name","race":"race","class":"class","job":"occupation","activity":"what this individual is doing at their own site","personality":"brief temperament and manner of speaking","history":"two short sentences about this individual's life or origins before meeting the party","motivation":"one personal desire or worry","routine":"guard|patrol|work|forage|wander|rest","dialogue":["first encounter greeting or threat","remark about their work or this place","another short personal remark"]}]}.
Produce one individual for every slot below. Each has a distinct name, race, occupation and voice. Names must not duplicate party members ${partyNames.join(', ') || 'None'}.
The engine assigns allegiances and separate encounter groups: ${JSON.stringify(slots)}.
Neutrals have work or business of their own, tolerate looting and stand aside during combat. Friendlies help the party against hostiles; only recruited companions follow the player. Hostiles guard, patrol or hunt locally and threaten intruders, not the entire level at once.
Make occupations fit the described room: ferrymen, grave masons, mourners, scavengers, custodians, traders, scholars, gardeners, miners, sentries or stranger underworld professions. Use the quest as context without inventing quest completion, new keys, rewards, exits or facts the speaker cannot know.
${questSeed ? 'Slot 0 is the single NEUTRAL or FRIENDLY quest contact near the arrival path. For this slot only, you may include "allegiance":"Friendly" if their role calls for an ally; otherwise they remain Neutral. Their first greeting introduces the EXISTING quest trouble and invites the player to ask about it. Explain a useful next lead supported by the given quest; do not invent prerequisites, rewards, keys, a new boss or completed tasks.' : 'No quest is being newly introduced here. Residents continue their own activities; do not stage an automatic quest-giver welcoming committee.'}
Nearby hostiles confront intruders with threatening, scornful trash talk in their own distinct voices. A warning or taunt is dialogue, not an automatic attack or a combat outcome.
Each dialogue line is at most 24 words. No combat stats, items, geometry, markdown or extra prose.`;
  await $.user`Each individual needs a UNIQUE short history and personality that suit their race, occupation and allegiance. History <=55 words. Connect it to a personal relationship, choice, regret or achievement, not an identical death story for everyone. Native creatures need not have been human or mortal. These are character background memories, not completed campaign events, current inventory, puzzle answers or privileged knowledge about the party.`;
  const reply = await $.assistant.generation({ maxTokens: indoor ? 3200 : 6200 });
  let rows = [];
  try {
    const raw = String(reply?.content || '');
    rows = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).inhabitants;
  } catch { console.warn('[RoomPopulation] Invalid inhabitant response; using bounded local residents.'); }
  const used = new Set([...partyNames, ...usedNames, '__proto__', 'constructor', 'prototype'].map(name => String(name).toLowerCase()));
  const descriptors = slots.map(slot => {
    const raw = Array.isArray(rows) ? rows.find(row => Number(row?.slot) === slot.slot) : null;
    let name = String(raw?.name || '').replace(/[:{}\[\]"<>\r\n]/g, '').trim().slice(0, 70);
    if (!name || used.has(name.toLowerCase())) {
      const base = `Ash ${slot.allegiance === 'Hostile' ? 'Warden' : 'Pilgrim'} ${Inhabitants.hash(geoKey + ':' + slot.slot).toString(36)}`;
      name = base;
      for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;
    }
    used.add(name.toLowerCase());
    const allegiance = questSeed && slot.slot === 0 && raw?.allegiance === 'Friendly' ? 'Friendly' : slot.allegiance;
    return { ...raw, ...slot, name, allegiance, state: allegiance,
      dialogue: raw?.dialogue || [slot.allegiance === 'Hostile' ? 'Keep your hands away from our work, trespasser.' :
        questSeed && slot.slot === 0 ? 'There is trouble on the road ahead. Ask me before you venture farther.' : 'There is still work to do, even here.'] };
  });
  const normalized = Inhabitants.normalizeDescriptors(descriptors, { limit: indoor ? 10 : 20, excluded: partyNames });
  const characters = [], equipment = [];
  for (const descriptor of normalized) {
    const level = rules.level(), hp = Array.from({ length: level }, () => rules.random(1, 11)).reduce((a,b) => a+b, 0);
    const actor = { Name: descriptor.name, Sex: rules.sex(), Race: descriptor.race, Class: descriptor.className,
      Level: level, AC: 10 + Math.floor(level / 10), XP: rules.xp(level), HP: hp, MaxHP: hp, State: descriptor.allegiance,
      Equipped: { Weapon: null, Armor: null, Shield: null, Other: null }, Attack: 0, Damage: 0, Armor: 0, Magic: 0 };
    // The larger cast shares one generation request; equipment retains the existing modifier rules.
    if (descriptor.allegiance === 'Hostile' && equipment.length < 4) {
      const item = await rules.equipment(actor);
      if (item) equipment.push(item);
    }
    characters.push(actor);
  }
  const sheets = characters.map(actor => `${actor.Name}\n      ${actor.Sex}\n      ${actor.Race}\n      ${actor.Class}\n      Level: ${actor.Level}\n      AC: ${actor.AC}\n      XP: ${actor.XP}\n      HP: ${actor.HP}\n      MaxHP: ${actor.MaxHP}\n      Equipped: ${Object.entries(actor.Equipped).map(([slot,item]) => `${slot}: ${item?.name || 'None'}`).join(', ')}\n      Attack: ${actor.Attack}\n      Damage: ${actor.Damage}\n      Armor: ${actor.Armor}\n      Magic: ${actor.Magic}\n      State: ${actor.State}`).join('\n');
  const population = Inhabitants.createPopulation(geoKey, normalized, { indoor });
  Inhabitants.sync(population, Inhabitants.parseBlocks(sheets));
  if (questSeed && ['Neutral', 'Friendly'].includes(normalized[0]?.allegiance)) population.questIntroduction = {
    questId: String(Inhabitants.hash(String(quest).trim())), speaker: normalized[0].name, status: 'pending',
    hook: String(normalized[0].dialogue[0] || '').slice(0, 400) };
  return { population, sheets, equipment };
}

module.exports = { generateInhabitants, needsQuestIntroduction };
