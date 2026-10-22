const Inhabitants = require('../assets/dungeonInhabitants');
const Pantheon = require('../assets/pantheonCharacters');
const SpellRules = require('../assets/spellRules');
const GeneratedNames = require('./generatedNames');
const Contracts = require('./generationContracts');
const Lore = require('./underworldLore');
const Policy = require('./generationPolicy');
const { RetortMessage } = require('retort-js/dist/message');
const BATCH_SIZE = 4;
function transientTimeout(error) {
  const text = String(error?.message || '');
  if (/quota|rate.?limit|429|refus|declined|content.?filter|cancel|abort/i.test(text)) return false;
  return ['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'PC_MODEL_TIMEOUT'].includes(error?.code) ||
    /timed?\s*out|timeout|deadline exceeded/i.test(text);
}

function needsQuestIntroduction(quest, rooms, geoKey, taskIndex = 0) {
  const text = String(quest || '').trim();
  if (!text || /^none$/i.test(text) || geoKey === '0,0,0' || taskIndex !== 0) return false;
  const questId = String(Inhabitants.hash(text));
  return !Object.values(rooms || {}).some(room => room?.inhabitants?.questIntroduction?.questId === questId);
}

// Regular residents and supplemental encounters share this generation path.
async function generateInhabitants(...args) { return Policy.scope(() => generateInhabitantsScoped(...args)); }
async function generateInhabitantsScoped($, { roomName, roomDescription, geoKey, indoor, campaignSetting, rooms = {}, partyNames = [], usedNames = [], quest = '', questSeed = false, encounter = null }, rules) {
  questSeed = questSeed && geoKey !== '0,0,0' && !!String(quest).trim() && !/^none$/i.test(String(quest).trim());
  const starting = geoKey === '0,0,0';
  const local = require('./graveMasterStoryPrompts').isHolodek1(), batchSize = local ? 1 : BATCH_SIZE;
  const count = starting ? rules.random(1, 5) : encounter ? Math.max(1, Math.min(3, encounter.count || 1)) : indoor ? 8 : 16;
  const hostileTemple = !starting && require('./campaignSetting').hostileTemple(campaignSetting, roomName);
  const village = !!campaignSetting?.village;
  const civicMajority = !encounter && !hostileTemple && require('./worldFlags').on('CITY_COMPLETE') && campaignSetting?.city?.population?.civilianMajority;
  const homeSites = ['commons', ...(campaignSetting?.village?.directions || [])];
  const slots = Array.from({ length: count }, (_, i) => ({ slot: i,
    allegiance: starting ? 'Friendly' : hostileTemple ? 'Hostile' : i < 3 ? 'Neutral' : i === 6 ? 'Friendly' : campaignSetting?.inhabited ?
      campaignSetting.faction?.allegiance === 'Hostile' || i === count - 1 ? 'Hostile' : 'Neutral' : i < 6 || i < 10 && i > 6 ? 'Hostile' : 'Neutral',
    encounterId: i === 0 && questSeed ? 'quest-contact' : i < 3 ? 'residents' : i < 6 ? 'guards' : i === 6 ? 'pilgrim' : i < 10 ? 'raiders' : i < 13 ? 'wayfarers' : 'keepers' }));
  const accepted = [], totalCount = count, originalUsedNames = usedNames, introduceQuest = questSeed;
  const originalLore = $.messages?.find(message => message instanceof RetortMessage &&
    ['user', 'system'].includes(message.role) && message.content.startsWith('Instructions for the Grave Master:'));
  async function requestBatch(agent, batch, retryReason) {
    const $ = agent, count = batch.length, slots = batch;
    const usedNames = [...accepted.map(row => row.name), ...originalUsedNames];
    const questSeed = introduceQuest && slots.some(slot => slot.slot === 0);
    const majorityBudgets = [
      ...(village && !hostileTemple ? [{ label: 'neutral', qualifies: row => row.allegiance === 'Neutral' }] : []),
      ...(civicMajority ? [{ label: 'non-hostile (Neutral or Friendly)', qualifies: row => ['Neutral', 'Friendly'].includes(row.allegiance) }] : [])
    ].map(budget => ({ ...budget, minimum: Math.max(0, Math.floor(totalCount / 2) + 1 -
      accepted.filter(budget.qualifies).length - (totalCount - accepted.length - count)) }));
    $.model = 'gpt-4.1-mini';
    $.temperature = 0.85;
    if (local) await $.user(require('./holodekPopulationPrompt').prompt({ roomName, roomDescription, indoor, campaignSetting,
      slots, quest, questSeed, encounter, partyNames, usedNames, accepted, starting, hostileTemple, homeSites,
      recent: require('./inhabitantVariety').brief(rooms, geoKey, { includeCurrent: !!encounter }) }));
    else {
    await $.user`Create the inhabitants of this ${indoor ? 'indoor dungeon complex' : 'outdoor biome'} in Children of the Grave.
${Lore.GUIDANCE}
${require('./cityCompletion').populationGuidance(campaignSetting)}
${require('./planarPortals').describe(campaignSetting?.planarRealm)}
${encounter ? `SUPPLEMENTAL RANDOM ENCOUNTER, not the regular cast: ${encounter.theme || 'Choose a coherent local encounter theme that contrasts with the existing residents.'}. You may decline by returning skip:true and inhabitants:[]. Otherwise skip:false and exactly ${count} individuals. Choose race ONLY from the exact catalog enum. Creature metadata (data): ${JSON.stringify(encounter.catalog || [])}. Use each selected creature's description to derive suitable anatomy, intelligence, behavior, history, personality, voice, motivations and activities. A beast can express itself through calls or simple impressions, not an incongruous learned biography; an intelligent native can have culture and personal stakes. Do not assign every creature its stereotype or invent SRD special mechanics: petrification, domination, teleporting and other catalog traits are descriptive unless supported by existing engine spells. This is an extra small local encounter, never a replacement quest cast or a raid on the whole level.` : ''}
Room: ${roomName}. Description: ${roomDescription}. Current quest: ${quest || 'None'}.
These are fantasy races for an intelligent or unintelligent animal, monster, spirit or other NPC including ordinary residents from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons, never gods or goddesses. The engine alone stages persistent divine visitors; do not use names or aliases from this reserved pantheon: ${Pantheon.names.join(', ')}. Arithus never appears outside the final throne-room encounter.
Regional community facts (read-only): ${JSON.stringify(campaignSetting || {})}. These are BACKGROUND, not a script for every individual's occupation or worry. Respect actual ecology, institutions and allegiances while inventing distinct local lives and interests. Regional trades are possibilities, not a closed profession list; a regional pressure is not every room's scenario. Residents of a settled place are not automatically enemies; the engine's allegiance slots below are authoritative. Never invent a payable contract, money, shop inventory or quest outcome; the engine supplies these separately.
${campaignSetting?.planarRealm ? 'This plane has its own native creatures, local factions and cosmology from PLANAR-REALM. Do not turn its hostiles into automatic Arithus servants or give unaware natives knowledge of the underworld war. New local gods are background beliefs, not spawned residents. Choose individuals from this plane\'s saved population concept.' : `When the faction is explicitly Hostile, its non-service guards and cult members follow ${campaignSetting?.hostilePatron || 'Arithus'}. Use that evil patron for their oaths, symbols and loyalties, rather than making them servants of an unrelated benevolent god. The three neutral slots remain neutral regardless of occupation; they need not be workers or business owners. A friendly slot in such territory may be a dissident. In peaceful communities, hostiles are outside threats, not the government. Temples follow the saved religion patron; do not invent another patron or physically summon one.`}
${hostileTemple ? 'This is an EVIL TEMPLE: every slot is Hostile, including workers and priests. Intruders face attacks from its guards and cult, not neutral shop or healing services. The neutral-resident and friendly-slot exceptions do NOT apply here.' : ''}
Return only JSON: {"inhabitants":[{"slot":0,"name":"unique exact name","race":"race","class":"custom class title","combatRole":"Warrior|Spellcaster","combatArchetype":"Fighter|Wizard|Witch|Sorcerer|Warlock|Necromancer|Cleric","spellPreferences":["preferred canonical spell id"],"job":"occupation","activity":"what this individual is doing at their own site","personality":"brief temperament and manner of speaking","voice":"distinct manner of speaking","history":"two short sentences about this individual's life or origins before meeting the party","motivation":"one personal desire or worry","routine":"guard|patrol|work|forage|wander|rest","dialogue":["first encounter greeting or threat","remark about their work or this place","another short personal remark"]}]}.
First decide per individual whether this is a Warrior or a Spellcaster. Warriors must use Fighter rules and empty spellPreferences; only Spellcasters choose a magical archetype. A Warrior never receives innate Magic, even if its flavorful title includes priestly or magical words.
Keep flavorful custom class names, but choose exactly one combatArchetype that justifies their abilities. Fighters have no innate spells (charged equipment still works). Wizards use runes and force; Witches ritual, restoration and hexes; Sorcerers light-weave healing; Warlocks destructive dark weave; Necromancers bone and death; Clerics priestly healing and sanctuary. A scholar or guard is not automatically a caster. The engine fixes Magic, spellbooks, spell lists and level requirements; do not invent class mechanics or mixed archetypes.
Choose spellPreferences individually from this archetype's catalog, suiting this character's methods, not identical choices for every caster. Fighter preferences must be empty. Unknown, cross-tradition and above-level spells are rejected by the engine; these are preferences, never a permission to bypass costs or slots. Supported catalogs: ${JSON.stringify(Object.fromEntries(SpellRules.archetypes.map(name => [name, SpellRules.catalog(name).map(id => ({ id, name: SpellRules.templates[id].name, level: SpellRules.templates[id].minLevel, cost: SpellRules.templates[id].cost, effect: SpellRules.templates[id].effect }))])))}.
Produce exactly ${count} individuals, one for every slot below, using each integer slot ID exactly once. Count and slot IDs are engine constraints, not creative suggestions. Each has a distinct name, race, occupation and voice. Names must not duplicate party members ${partyNames.join(', ') || 'None'} or existing residents ${usedNames.join(', ') || 'None'}. ${GeneratedNames.instructions}
Required slot IDs with suggested roles and allegiances, NOT a fixed cast: ${JSON.stringify(slots)}.
Choose each individual's allegiance (Friendly, Neutral or Hostile), encounterId (short shared group label, at most four per group) and routine yourself. The only fixed allegiances are ALL Friendly at the starting temple, ALL Hostile in an explicitly evil temple, and the first three ordinary residents Neutral in the regular cast elsewhere (slot 0 may be Friendly for an explicit quest introduction). Neutrality does not prescribe a job, shop or activity. Supplemental encounters have NO reserved workers: choose any justified allegiance. All other suggested allegiances and group names above are defaults you may replace to fit the scene, not mandatory workers/guards/raiders. A hostile faction does not turn its entire civilian population hostile. Choose guards, threats, refugees, artisans and strangers according to the story, not slot number.
${village ? `This is a settled community: a majority must be Neutral, with optional individual Friendly allies and Hostile guards or threats. Follow its saved population concept: ${campaignSetting.village.population}. Choose homeSite from ${homeSites.join(', ')}: commons or the named direction's BUILDING APPROACH, not a second copy of someone inside that building. Place frightened shades, pushy demon guards or other residents where their own activities warrant, without repeating a fixed cast.` : 'Vary native beings, shades, spirits and humanoids to suit this level; not every guard is a demon and not every soul is human. Set homeSite to commons.'}
Neutrals have work or business of their own, tolerate looting and stand aside during combat. Friendlies help the party against hostiles; only recruited companions follow the player. Hostiles guard, patrol or hunt locally and threaten intruders, not the entire level at once.
Invent occupations and ways of life from this particular place, each individual's nature, interests, relationships and history, not a fixed list of trades. Sacred architecture does not require maintenance workers; open country does not require resource disputes. Use the quest as context without inventing quest completion, new keys, rewards, exits or facts the speaker cannot know.
${questSeed ? 'Slot 0 is the single NEUTRAL or FRIENDLY quest contact near the arrival path. For this slot only, you may include "allegiance":"Friendly" if their role calls for an ally; otherwise they remain Neutral. Their first greeting introduces the EXISTING quest trouble and invites the player to ask about it. Explain a useful next lead supported by the given quest; do not invent prerequisites, rewards, keys, a new boss or completed tasks.' : 'No quest is being newly introduced here. Residents continue their own activities; do not stage an automatic quest-giver welcoming committee.'}
Nearby hostiles confront intruders with threatening, scornful trash talk in their own distinct voices. A warning or taunt is dialogue, not an automatic attack or a combat outcome.
Provide exactly three nonempty dialogue remarks per individual. Let each remark use the words it needs to convey its greeting, threat, personal detail or existing quest lead clearly; there is no word-count limit. No combat stats, items, geometry, markdown or extra prose.`;
    await $.user`Population contract: return exactly ${count} inhabitants with slot IDs ${slots.map(s => s.slot).join(', ')}, each used once, no extra residents or duplicate slots.${encounter ? ' Only skip:true may return an empty inhabitants array.' : ''}
Each individual needs a UNIQUE short history and personality that suit their race, occupation and allegiance. History <=55 words. Connect it to a personal relationship, choice, regret or achievement, not an identical death story for everyone. Native creatures need not have been human or mortal. These are character background memories, not completed campaign events, current inventory, puzzle answers or privileged knowledge about the party.`;
    const Variety = require('./inhabitantVariety');
    await $.user`${Variety.prompt(Variety.brief(rooms, geoKey, { includeCurrent: !!encounter }), { starting, encounter: !!encounter })}`;
    }
    if (!local) await $.user`This is one bounded batch of a ${totalCount}-resident population. Return ONLY slot IDs ${slots.map(s => s.slot).join(', ')}; do not restart numbering or generate other batches. Previously accepted residents (read-only, never repeat or replace): ${JSON.stringify(accepted.map(row => ({ slot: row.slot, name: row.name, race: row.race, job: row.job, allegiance: row.allegiance, encounterId: row.encounterId })))}.`;
    if (majorityBudgets.length) await $.user`Whole-population majority budget for ONLY this batch: ${majorityBudgets.map(budget => `at least ${budget.minimum} of these ${count} residents must be ${budget.label}`).join('; ')}. This is the minimum needed to keep the original room-wide majority achievable after the remaining batches, not a new fixed role or allegiance for any slot. Keep all starting-temple, evil-temple and quest-contact protections. Previously accepted residents cannot be replaced.`;
    if (retryReason) await $.user`The previous attempt for ONLY slots ${slots.map(s => s.slot).join(', ')} timed out before a valid batch was accepted. Retry only this batch from this fresh conversation within its remaining recovery budget. Reason: ${retryReason}. Preserve every original world, race, allegiance and quest rule. Do not regenerate the ${accepted.length} already accepted residents or invent fallback NPCs.`;
    return Contracts.request($, { component: 'inhabitants', context: { geoKey, slots: count, slotIds: slots.map(s => s.slot), totalSlots: totalCount }, attempts: 2,
      strictAnswer: true,
      retryHint: 'For each resident, dialogue must be an array of exactly 3 separate, nonblank authored remarks: a greeting or threat, a local remark, and a personal remark. Do not return one combined entry, duplicate a remark, pad missing entries, or split one sentence to fake three remarks. There is no dialogue word-count limit. If a name is duplicated or reserved, invent a genuinely different identity, not a one-letter spelling variant of the rejected name.',
      maxTokens: encounter ? 1800 : 2200,
      parameters: { ...(encounter ? { skip: Boolean } : {}), inhabitants: { type: Contracts.list({ slot: { type: Number, minimum: slots[0].slot, maximum: slots.at(-1).slot, enum: slots.map(s => s.slot), multipleOf: 1 }, name: Contracts.nonblankText(70),
        race: encounter ? Contracts.choice(encounter.races) : Contracts.nonblankText(55), class: Contracts.nonblankText(80), combatRole: Contracts.choice(['Warrior', 'Spellcaster']),
        combatArchetype: Contracts.choice(SpellRules.archetypes), spellPreferences: [String],
        job: Contracts.nonblankText(70), activity: Contracts.nonblankText(140), personality: Contracts.nonblankText(220), voice: Contracts.nonblankText(140),
        history: Contracts.nonblankText(600), motivation: Contracts.nonblankText(180), routine: Contracts.choice(['guard', 'patrol', 'work', 'forage', 'wander', 'rest']),
        dialogue: { type: [Contracts.nonblankText()], minItems: 3, maxItems: 3 }, allegiance: Contracts.choice(['Friendly', 'Neutral', 'Hostile']),
        encounterId: Contracts.nonblankText(40), homeSite: Contracts.choice(homeSites) }), minItems: encounter ? 0 : count, maxItems: count } },
      validate: parsed => {
        if (encounter && parsed.skip === true) {
          if (!Array.isArray(parsed.inhabitants) || parsed.inhabitants.length) throw Error('A skipped encounter must return an empty inhabitants array.');
          return { skipped: true };
        }
        const rows = parsed.inhabitants;
        if (!Array.isArray(rows) || rows.length !== count) throw Error(`Expected exactly ${count} inhabitants.`);
        const used = new Set([...partyNames, ...usedNames, '__proto__', 'constructor', 'prototype'].map(name => String(name).toLowerCase()));
        const bySlot = new Map();
        for (const row of rows) {
          if (!Number.isInteger(row?.slot) || !slots.some(slot => slot.slot === row.slot) || bySlot.has(row.slot)) throw Error('Unknown or duplicate inhabitant slot: ' + String(row?.slot));
          for (const field of ['name', 'race', 'class', 'job', 'activity', 'personality', 'voice', 'history', 'motivation'])
            if (typeof row[field] !== 'string' || !row[field].trim()) throw Error(`Slot ${row.slot}.${field} must be nonempty text.`);
          if (row.history.trim().split(/\s+/).length > 55) throw Error(`Slot ${row.slot}.history exceeds 55 words.`);
          if (!Array.isArray(row.dialogue) || row.dialogue.length !== 3 || row.dialogue.some(line =>
            typeof line !== 'string' || !line.trim()))
            throw Error(`Slot ${row.slot}.dialogue requires three nonempty remarks; received ${Array.isArray(row.dialogue) ? row.dialogue.length + ' entries' : typeof row.dialogue}. Author 3 separate nonblank entries, not one combined remark.`);
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
        const descriptors = slots.map(slot => {
          const row = bySlot.get(slot.slot);
          const fixed = starting || hostileTemple || !encounter && slot.slot < 3;
          const allegiance = !hostileTemple && questSeed && slot.slot === 0 && row.allegiance === 'Friendly' ? 'Friendly' :
            fixed ? slot.allegiance : row.allegiance || slot.allegiance;
          return { ...row, ...slot, encounterId: row.encounterId || slot.encounterId, homeSite: row.homeSite || 'commons', allegiance, state: allegiance, profile: { name: row.name,
            personality: row.personality, voice: row.voice, history: row.history, motivation: row.motivation, source: 'llm' } };
        });
        for (const budget of majorityBudgets) if (descriptors.filter(budget.qualifies).length < budget.minimum)
          throw Error(`This batch needs at least ${budget.minimum} ${budget.label} residents to preserve a majority of ${budget.label} residents in the complete population.`);
        return { descriptors };
    } });
  }
  let response = '', descriptors;
  console.info('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'requested', slots: count, starting }));
  try {
    for (let offset = 0; offset < count; offset += batchSize) {
      const batch = slots.slice(offset, offset + batchSize);
      for (let attempt = 1, retryReason = ''; attempt <= require('./generationPolicy').ATTEMPTS; attempt++) {
        const work = async agent => {
          if (agent !== $ && originalLore && !local) await agent.user(originalLore.content);
          return requestBatch(agent, batch, retryReason);
        };
        const result = typeof $.run === 'function' ? await $.run(work, null, { shouldSaveToLog: false }) : await work($);
        response = result.response;
        if (result.value?.skipped) return result.value;
        if (result.value) { accepted.push(...result.value.descriptors); break; }
        const error = result.error || Error('No valid inhabitants returned.');
        if (attempt === require('./generationPolicy').ATTEMPTS || !transientTimeout(error)) throw error;
        retryReason = String(error.message).slice(0, 400);
        console.warn('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'retrying', slotIds: batch.map(s => s.slot),
          acceptedSlots: accepted.length, attempt: attempt + 1, reason: 'Transient timeout; retry only this batch on a fresh branch.', detail: retryReason }));
      }
    }
    descriptors = accepted;
    if (village && !hostileTemple && descriptors.filter(row => row.allegiance === 'Neutral').length <= count / 2)
      throw Error('A village needs a majority of neutral residents; guards do not make all civilians hostile.');
    if (civicMajority &&
        descriptors.filter(row => ['Neutral','Friendly'].includes(row.allegiance)).length <= count / 2)
      throw Error('A civic city district needs a majority of non-hostile residents.');
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
    // All batches have passed validation before allocating stats or equipment.
    if (descriptor.allegiance === 'Hostile' && equipment.length < 4) {
      const item = await rules.equipment(actor);
      if (item) equipment.push(item);
    }
    characters.push(actor);
  }
  const sheets = characters.map(actor => `${actor.Name}\n      ${actor.Sex}\n      ${actor.Race}\n      ${actor.Class}\n      Level: ${actor.Level}\n      AC: ${actor.AC}\n      XP: ${actor.XP}\n      HP: ${actor.HP}\n      MaxHP: ${actor.MaxHP}\n      Equipped: ${Object.entries(actor.Equipped).map(([slot,item]) => `${slot}: ${item?.name || 'None'}`).join(', ')}\n      Attack: ${actor.Attack}\n      Damage: ${actor.Damage}\n      Armor: ${actor.Armor}\n      Magic: ${actor.Magic}\n      State: ${actor.State}`).join('\n');
  const population = Inhabitants.createPopulation(geoKey, normalized, { indoor, starting });
  population.authoredAt = Date.now();
  if (village) population.settlement = { id: campaignSetting.village.id, hub: campaignSetting.village.venue === 'commons' };
  Inhabitants.sync(population, Inhabitants.parseBlocks(sheets));
  if (questSeed && ['Neutral', 'Friendly'].includes(normalized[0]?.allegiance)) population.questIntroduction = {
    questId: String(Inhabitants.hash(String(quest).trim())), speaker: normalized[0].name, status: 'pending',
    hook: String(normalized[0].dialogue[0] || '') };
  console.info('[InhabitantGeneration]', JSON.stringify({ geoKey, status: 'generated', names: normalized.map(actor => actor.name), starting }));
  return { population, sheets, equipment };
}

module.exports = { generateInhabitants, needsQuestIntroduction };
