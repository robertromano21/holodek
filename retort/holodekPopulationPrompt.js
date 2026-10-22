'use strict';
const Pantheon = require('../assets/pantheonCharacters');
const SpellRules = require('../assets/spellRules');
function prompt({ roomName, roomDescription, indoor, campaignSetting: setting = {}, slots, quest, questSeed, encounter,
  partyNames, usedNames, accepted, starting, hostileTemple, homeSites, recent }) {
  const region = Object.fromEntries(['region', 'ecology', 'underground', 'authority', 'pressure', 'livelihoods', 'religion', 'faction', 'hostilePatron']
    .filter(key => setting[key] !== undefined).map(key => [key, setting[key]]));
  const spellIds = Object.fromEntries(SpellRules.archetypes.map(name => [name, SpellRules.catalog(name)]));
  return `Author exactly ONE resident for this ${indoor ? 'indoor room' : 'outdoor biome'} as JSON through the supplied schema. This is character design, not a gameplay turn.
Room data: ${JSON.stringify({ roomName, roomDescription, region, plane: setting.planarRealm,
    village: setting.village ? { population: setting.village.population } : undefined,
    slots, quest: quest || 'None', questSeed, homeSites, partyNames, usedNames,
    alreadyAccepted: accepted.map(row => ({ name: row.name, race: row.race, job: row.job, slot: row.slot })) })}.
Tartarus is the inhabited underworld under a yellow sky: ash wastes, vast mountains, hellish winds, shades, spirits, monsters, dragons, angels, demons and humanoids. A saved plane overrides its ecology and native war knowledge. Never spawn a god; reserved names: ${Pantheon.names.join(', ')}. Arithus appears only in the final throne encounter.
${starting ? 'This starting resident must be Friendly; do not introduce a quest.' : hostileTemple ? 'This evil-temple resident must be Hostile; no healing/shop services.' : 'The first three regular slots are Neutral (quest contact slot 0 may be Friendly); otherwise choose a justified allegiance. Appearance and occupation do not decide allegiance.'}
Choose a distinct race, name, job, activity, temperament, voice, personal motivation and short life history (at most 55 words). Not every temple resident repairs columns or every wasteland resident disputes water. Model chooses the situation; regional institutions are background, not a repeated cast. Contrast with: ${JSON.stringify(recent?.recentSituations?.slice(0, 2) || [])}.
Warrior means Fighter and empty spellPreferences. Spellcasters choose one supported archetype and preferences from its exact catalog: ${JSON.stringify(spellIds)}. Engine supplies stats, spells, equipment and levels; no invented mechanics. homeSite must be an offered approach or commons, never a duplicate occupant inside another building.
Supply exactly three nonempty dialogue remarks: greeting/threat, local remark, personal remark. Use clear concise sentences, not filler. A bound quest contact may introduce only the existing trouble and a supported lead. Other residents pursue their own interests. No new items, exits, rewards, payable contracts, completed actions or knowledge of unseen party deeds.
${encounter ? `Supplemental encounter: ${JSON.stringify({ theme: encounter.theme, races: encounter.races, metadata: encounter.catalog })}. Choose an exact race enum using its metadata to derive anatomy, intelligence, history and behavior, not a humanoid biography for an animal. skip:true may decline; otherwise exactly this one slot. This supplements the regular cast, not a replacement quest.` : ''}`;
}
module.exports = { prompt };
