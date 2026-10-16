const Inhabitants = require('../assets/dungeonInhabitants');
const Pantheon = require('../assets/pantheonCharacters');
const SpellRules = require('../assets/spellRules');
const GeneratedNames = require('./generatedNames');
const Contracts = require('./generationContracts');
const Lore = require('./underworldLore');

function needsQuestIntroduction(quest, rooms, geoKey, taskIndex = 0) {
  const text = String(quest || '').trim();
  if (!text || /^none$/i.test(text) || geoKey === '0,0,0' || taskIndex !== 0) return false;
  const questId = String(Inhabitants.hash(text));
  return !Object.values(rooms || {}).some(room => room?.inhabitants?.questIntroduction?.questId === questId);
}

async function generateInhabitants($, { roomName, roomDescription, geoKey, indoor, campaignSetting, partyNames = [], usedNames = [], quest = '', questSeed = false, encounter = null }, rules) {
  questSeed = questSeed && geoKey !== '0,0,0' && !!String(quest).trim() && !/^none$/i.test(String(quest).trim());
  const starting = geoKey === '0,0,0';
  const count = starting ? rules.random(1, 5) : encounter ? Math.max(1, Math.min(3, encounter.count || 1)) : indoor ? 8 : 16;
  const hostileTemple = !starting && require('./campaignSetting').hostileTemple(campaignSetting, roomName);
  const village = !!campaignSetting?.village;
  const homeSites = ['commons', ...(campaignSetting?.village?.directions || [])];
  const slots = Array.from({ length: count }, (_, i) => ({ slot: i,
    allegiance: starting ? 'Friendly' : hostileTemple ? 'Hostile' : i < 3 ? 'Neutral' : i === 6 ? 'Friendly' : campaignSetting?.inhabited ?
      campaignSetting.faction?.allegiance === 'Hostile' || i === count - 1 ? 'Hostile' : 'Neutral' : i < 6 || i < 10 && i > 6 ? 'Hostile' : 'Neutral',
    encounterId: i === 0 && questSeed ? 'quest-contact' : i < 3 ? 'workers' : i < 6 ? 'guards' : i === 6 ? 'pilgrim' : i < 10 ? 'raiders' : i < 13 ? 'wayfarers' : 'keepers' }));
  $.model = 'gpt-4.1-mini';
  $.temperature = 0.85;
  await $.user`Create the inhabitants of this ${indoor ? 'indoor dungeon complex' : 'outdoor biome'} in Children of the Grave.
${Lore.GUIDANCE}
${require('./planarPortals').describe(campaignSetting?.planarRealm)}
${encounter ? `SUPPLEMENTAL RANDOM ENCOUNTER, not the regular cast: ${encounter.theme || 'Choose a coherent local encounter theme that contrasts with the existing residents.'}. You may decline by returning skip:true and inhabitants:[]. Otherwise skip:false and exactly ${count} individuals. Choose race ONLY from the exact catalog enum. Creature metadata (data): ${JSON.stringify(encounter.catalog || [])}. Use each selected creature's description to derive suitable anatomy, intelligence, behavior, history, personality, voice, motivations and activities. A beast can express itself through calls or simple impressions, not an incongruous learned biography; an intelligent native can have culture and personal stakes. Do not assign every creature its stereotype or invent SRD special mechanics: petrification, domination, teleporting and other catalog traits are descriptive unless supported by existing engine spells. This is an extra small local encounter, never a replacement quest cast or a raid on the whole level.` : ''}
Room: ${roomName}. Description: ${roomDescription}. Current quest: ${quest || 'None'}.
These are fantasy races for an intelligent or unintelligent animal, monster, spirit or other NPC including ordinary residents from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, never gods or goddesses. The engine alone stages persistent divine visitors; do not use names or aliases from this reserved pantheon: ${Pantheon.names.join(', ')}. Arithus never appears outside the final throne-room encounter.
Regional community facts (read-only): ${JSON.stringify(campaignSetting || {})}. Fit occupations, relationships and worries to the real water source, trades, authority and guilds. Residents of a settled place are not automatically enemies; the engine's allegiance slots below are authoritative. Never invent a payable contract, money, shop inventory or quest outcome; the engine supplies these separately.
${campaignSetting?.planarRealm ? 'This plane has its own native creatures, local factions and cosmology from PLANAR-REALM. Do not turn its hostiles into automatic Arithus servants or give unaware natives knowledge of the underworld war. New local gods are background beliefs, not spawned residents. Choose individuals from this plane\'s saved population concept.' : `When the faction is explicitly Hostile, its non-service guards and cult members follow ${campaignSetting?.hostilePatron || 'Arithus'}. Use that evil patron for their oaths, symbols and loyalties, rather than making them servants of an unrelated benevolent god. The three neutral workers remain neutral independent businesses. A friendly slot in such territory may be a dissident. In peaceful communities, hostiles are outside threats, not the government. Temples follow the saved religion patron; do not invent another patron or physically summon one.`}
${hostileTemple ? 'This is an EVIL TEMPLE: every slot is Hostile, including workers and priests. Intruders face attacks from its guards and cult, not neutral shop or healing services. The neutral-worker and friendly-slot exceptions do NOT apply here.' : ''}
Return only JSON: {"inhabitants":[{"slot":0,"name":"unique exact name","race":"race","class":"custom class title","combatRole":"Warrior|Spellcaster","combatArchetype":"Fighter|Wizard|Witch|Sorcerer|Warlock|Necromancer|Cleric","spellPreferences":["preferred canonical spell id"],"job":"occupation","activity":"what this individual is doing at their own site","personality":"brief temperament and manner of speaking","voice":"distinct manner of speaking","history":"two short sentences about this individual's life or origins before meeting the party","motivation":"one personal desire or worry","routine":"guard|patrol|work|forage|wander|rest","dialogue":["first encounter greeting or threat","remark about their work or this place","another short personal remark"]}]}.
First decide per individual whether this is a Warrior or a Spellcaster. Warriors must use Fighter rules and empty spellPreferences; only Spellcasters choose a magical archetype. A Warrior never receives innate Magic, even if its flavorful title includes priestly or magical words.
Keep flavorful custom class names, but choose exactly one combatArchetype that justifies their abilities. Fighters have no innate spells (charged equipment still works). Wizards use runes and force; Witches ritual, restoration and hexes; Sorcerers light-weave healing; Warlocks destructive dark weave; Necromancers bone and death; Clerics priestly healing and sanctuary. A scholar or guard is not automatically a caster. The engine fixes Magic, spellbooks, spell lists and level requirements; do not invent class mechanics or mixed archetypes.
Choose spellPreferences individually from this archetype's catalog, suiting this character's methods, not identical choices for every caster. Fighter preferences must be empty. Unknown, cross-tradition and above-level spells are rejected by the engine; these are preferences, never a permission to bypass costs or slots. Supported catalogs: ${JSON.stringify(Object.fromEntries(SpellRules.archetypes.map(name => [name, SpellRules.catalog(name).map(id => ({ id, name: SpellRules.templates[id].name, level: SpellRules.templates[id].minLevel, cost: SpellRules.templates[id].cost, effect: SpellRules.templates[id].effect }))])))}.
Produce one individual for every slot below. Each has a distinct name, race, occupation and voice. Names must not duplicate party members ${partyNames.join(', ') || 'None'} or existing residents ${usedNames.join(', ') || 'None'}. ${GeneratedNames.instructions}
Suggested slots, NOT a fixed cast: ${JSON.stringify(slots)}.
Choose each individual's allegiance (Friendly, Neutral or Hostile), encounterId (short shared group label, at most four per group) and routine yourself. The only fixed allegiances are ALL Friendly at the starting temple, ALL Hostile in an explicitly evil temple, and the first three independent workers Neutral in the regular cast elsewhere (slot 0 may be Friendly for an explicit quest introduction). Supplemental encounters have NO reserved workers: choose any justified allegiance. All other suggested allegiances and group names above are defaults you may replace to fit the scene, not mandatory workers/guards/raiders. A hostile faction does not turn its entire civilian population hostile. Choose guards, threats, refugees, artisans and strangers according to the story, not slot number.
${village ? `This is a settled community: a majority must be Neutral, with optional individual Friendly allies and Hostile guards or threats. Follow its saved population concept: ${campaignSetting.village.population}. Choose homeSite from ${homeSites.join(', ')}: commons or the named direction's BUILDING APPROACH, not a second copy of someone inside that building. Place frightened shades, pushy demon guards or other residents where their own activities warrant, without repeating a fixed cast.` : 'Vary native beings, shades, spirits and humanoids to suit this level; not every guard is a demon and not every soul is human. Set homeSite to commons.'}
Neutrals have work or business of their own, tolerate looting and stand aside during combat. Friendlies help the party against hostiles; only recruited companions follow the player. Hostiles guard, patrol or hunt locally and threaten intruders, not the entire level at once.
Make occupations fit the described room: ferrymen, grave masons, mourners, scavengers, custodians, traders, scholars, gardeners, miners, sentries or stranger underworld professions. Use the quest as context without inventing quest completion, new keys, rewards, exits or facts the speaker cannot know.
${questSeed ? 'Slot 0 is the single NEUTRAL or FRIENDLY quest contact near the arrival path. For this slot only, you may include "allegiance":"Friendly" if their role calls for an ally; otherwise they remain Neutral. Their first greeting introduces the EXISTING quest trouble and invites the player to ask about it. Explain a useful next lead supported by the given quest; do not invent prerequisites, rewards, keys, a new boss or completed tasks.' : 'No quest is being newly introduced here. Residents continue their own activities; do not stage an automatic quest-giver welcoming committee.'}
Nearby hostiles confront intruders with threatening, scornful trash talk in their own distinct voices. A warning or taunt is dialogue, not an automatic attack or a combat outcome.
Each dialogue line is at most 24 words. No combat stats, items, geometry, markdown or extra prose.`;
  await $.user`Each individual needs a UNIQUE short history and personality that suit their race, occupation and allegiance. History <=55 words. Connect it to a personal relationship, choice, regret or achievement, not an identical death story for everyone. Native creatures need not have been human or mortal. These are character background memories, not completed campaign events, current inventory, puzzle answers or privileged knowledge about the party.`;
  let response = '', descriptors;
  console.info('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'requested', slots: count, starting }));
  try {
    const reply = await $.assistant.generation({ maxTokens: encounter ? 1800 : indoor ? 3200 : 6200, strictParameters: true,
      parameters: { ...(encounter ? { skip: Boolean } : {}), inhabitants: Contracts.list({ slot: { type: Number, minimum: 0, maximum: count - 1 }, name: Contracts.text(70),
        race: encounter ? Contracts.choice(encounter.races) : Contracts.text(55), class: Contracts.text(80), combatRole: Contracts.choice(['Warrior', 'Spellcaster']),
        combatArchetype: Contracts.choice(SpellRules.archetypes), spellPreferences: [String],
        job: Contracts.text(70), activity: Contracts.text(140), personality: Contracts.text(220), voice: Contracts.text(140),
        history: Contracts.text(600), motivation: Contracts.text(180), routine: Contracts.choice(['guard', 'patrol', 'work', 'forage', 'wander', 'rest']),
        dialogue: [String], allegiance: Contracts.choice(['Friendly', 'Neutral', 'Hostile']),
        encounterId: Contracts.text(40), homeSite: Contracts.choice(homeSites) }) } });
    response = String(reply?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
    const parsed = JSON.parse(response);
    if (encounter && parsed.skip === true) return { skipped: true };
    const rows = parsed.inhabitants;
    if (!Array.isArray(rows) || rows.length !== count) throw Error(`Expected exactly ${count} inhabitants.`);
    const used = new Set([...partyNames, ...usedNames, '__proto__', 'constructor', 'prototype'].map(name => String(name).toLowerCase()));
    const bySlot = new Map();
    for (const row of rows) {
      if (!Number.isInteger(row?.slot) || !slots[row.slot] || bySlot.has(row.slot)) throw Error('Unknown or duplicate inhabitant slot: ' + String(row?.slot));
      for (const field of ['name', 'race', 'class', 'job', 'activity', 'personality', 'voice', 'history', 'motivation'])
        if (typeof row[field] !== 'string' || !row[field].trim()) throw Error(`Slot ${row.slot}.${field} must be nonempty text.`);
      if (row.history.trim().split(/\s+/).length > 55) throw Error(`Slot ${row.slot}.history exceeds 55 words.`);
      if (!Array.isArray(row.dialogue) || row.dialogue.length !== 3 || row.dialogue.some(line =>
        typeof line !== 'string' || !line.trim() || line.trim().split(/\s+/).length > 24))
        throw Error(`Slot ${row.slot}.dialogue requires three nonempty remarks, each at most 24 words.`);
      if (!['Warrior', 'Spellcaster'].includes(row.combatRole) || !SpellRules.archetypes.includes(row.combatArchetype) || !Array.isArray(row.spellPreferences))
        throw Error(`Slot ${row.slot} has an invalid combat role or archetype.`);
      if (row.allegiance !== undefined && !['Friendly', 'Neutral', 'Hostile'].includes(row.allegiance)) throw Error(`Slot ${row.slot} has an invalid allegiance.`);
      if (row.homeSite !== undefined && !homeSites.includes(row.homeSite)) throw Error(`Slot ${row.slot} has an unknown home site.`);
      if (encounter && !encounter.races.includes(row.race)) throw Error(`Slot ${row.slot} race is outside the encounter catalog.`);
      const name = GeneratedNames.clean(row.name).slice(0, 70).trim();
      if (!name || used.has(name.toLowerCase()) || Pantheon.name(name)) throw Error(`Slot ${row.slot} has an empty, duplicate or reserved name: ${name}`);
      used.add(name.toLowerCase());
      bySlot.set(row.slot, { ...row, name });
    }
    descriptors = slots.map(slot => {
      const row = bySlot.get(slot.slot);
      const fixed = starting || hostileTemple || !encounter && slot.slot < 3;
      const allegiance = !hostileTemple && questSeed && slot.slot === 0 && row.allegiance === 'Friendly' ? 'Friendly' :
        fixed ? slot.allegiance : row.allegiance || slot.allegiance;
      return { ...row, ...slot, encounterId: row.encounterId || slot.encounterId, homeSite: row.homeSite || 'commons', allegiance, state: allegiance, profile: { name: row.name,
        personality: row.personality, voice: row.voice, history: row.history, motivation: row.motivation, source: 'llm' } };
    });
    if (village && !hostileTemple && descriptors.filter(row => row.allegiance === 'Neutral').length <= count / 2)
      throw Error('A village needs a majority of neutral residents; guards do not make all civilians hostile.');
  } catch (error) {
    console.error('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'failed', reason: error.message, response: response.slice(0, 2000) }));
    throw new Error(`Inhabitant generation failed in ${roomName}: ${error.message}`, { cause: error });
  }
  const normalized = Inhabitants.normalizeDescriptors(descriptors, { limit: starting ? 4 : indoor ? 10 : 20, starting, excluded: partyNames });
  const characters = [], equipment = [];
  for (const descriptor of normalized) {
    const level = rules.level(), hp = Array.from({ length: level }, () => rules.random(1, SpellRules.nativeHp[descriptor.combatArchetype] + 1)).reduce((a,b) => a+b, 0);
    const actor = { Name: descriptor.name, Sex: rules.sex(), Race: descriptor.race, Class: descriptor.className,
      Level: level, AC: 10 + Math.floor(level / 10), XP: rules.xp(level, descriptor.combatArchetype), HP: hp, MaxHP: hp, State: descriptor.allegiance,
      Equipped: { Weapon: null, Armor: null, Shield: null, Other: null },
      Attack: Math.floor(level / (descriptor.combatArchetype === 'Fighter' ? 2 : 4)),
      Damage: descriptor.combatArchetype === 'Fighter' ? Math.floor(level / 3) : 0, Armor: 0,
      Magic: SpellRules.classSettings(descriptor.className, level)?.capacity || 0 };
    // The larger cast shares one generation request; equipment retains the existing modifier rules.
    if (descriptor.allegiance === 'Hostile' && equipment.length < 4) {
      const item = await rules.equipment(actor);
      if (item) equipment.push(item);
    }
    characters.push(actor);
  }
  const sheets = characters.map(actor => `${actor.Name}\n      ${actor.Sex}\n      ${actor.Race}\n      ${actor.Class}\n      Level: ${actor.Level}\n      AC: ${actor.AC}\n      XP: ${actor.XP}\n      HP: ${actor.HP}\n      MaxHP: ${actor.MaxHP}\n      Equipped: ${Object.entries(actor.Equipped).map(([slot,item]) => `${slot}: ${item?.name || 'None'}`).join(', ')}\n      Attack: ${actor.Attack}\n      Damage: ${actor.Damage}\n      Armor: ${actor.Armor}\n      Magic: ${actor.Magic}\n      State: ${actor.State}`).join('\n');
  const population = Inhabitants.createPopulation(geoKey, normalized, { indoor, starting });
  if (village) population.settlement = { id: campaignSetting.village.id, hub: campaignSetting.village.venue === 'commons' };
  Inhabitants.sync(population, Inhabitants.parseBlocks(sheets));
  if (questSeed && ['Neutral', 'Friendly'].includes(normalized[0]?.allegiance)) population.questIntroduction = {
    questId: String(Inhabitants.hash(String(quest).trim())), speaker: normalized[0].name, status: 'pending',
    hook: String(normalized[0].dialogue[0] || '').slice(0, 400) };
  console.info('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'generated', names: normalized.map(actor => actor.name), starting }));
  return { population, sheets, equipment };
}

module.exports = { generateInhabitants, needsQuestIntroduction };
