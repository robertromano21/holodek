'use strict';

// Mode 4 owns its narrative instructions; canonical campaign lore is never a template here.
const Setting = require('./settingLayer');
const RULES = 'The current console and verified outcomes are authoritative. Only the player chooses or commands their character. ' +
  'Never invent exits, residents, items, rewards, dice results or completed objectives. Describe the room and the consequences of the latest input concretely. ' +
  'Only living, present characters may speak or act, each with distinct motives, emotions, relationships and limited knowledge. ' +
  'Friendly companions are allies, neutral residents are not automatically enemies, and strangers do not know private histories. ' +
  'Use quoted dialogue and clear prose, not console dumps or rule explanations. Follow the active world\'s tone, technology and resource terminology.';

function guidance() { return Setting.guidance(Setting.CORE); }
function destination(world = Setting.current()) {
  return world?.topology?.goal || 'The destination has not yet been established in this world.';
}
function appendOriginal($) {
  $.user`${guidance()}`;
  $.user`WORLD CURRENCY: ${require('../assets/currencyLanguage').forWorld(Setting.current()).plural}. Silver Pieces is a numeric compatibility field, not the name residents use for money.`;
  $.user`${require('./genreStoryPalette').direction(Setting.current())}`;
  $.user`[MODE-4 RULES] ${RULES} [/MODE-4 RULES]`;
}
function appendStory($, { roomName = '', activeTask = null, questUpdate = '', questJustSeeded = false,
  updatedGameConsole = '', sharedState, parseNpcPartyNamesFromConsole } = {}) {
  let task = activeTask, party = [], quest = '';
  if (!task && questJustSeeded) task = (sharedState?.getCurrentTasks?.() || [])[sharedState?.getCurrentTaskIndex?.() || 0];
  if (parseNpcPartyNamesFromConsole) party = parseNpcPartyNamesFromConsole(updatedGameConsole) || [];
  if (questJustSeeded) quest = sharedState?.getCurrentQuest?.() || '';
  const coords = String(updatedGameConsole).match(/Coordinates: X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/);
  const key = coords ? coords.slice(1).map(Number).join(',') : '';
  const required = (task?.requiredElements || []).map(e => ({ type: e.type, name: e.name,
    placement: e.placement, here: String(e.placement || '').trim() === key }));
  $.user`[MODE-4 TURN] ${RULES}
Resolve the player's latest input first, then let the scene and its characters respond. Ground discoveries and conflicts in this world's own premise and established history, not another campaign's plot. Do not force a twist, prophecy or new quest on an idle turn.
${require('./genreStoryPalette').direction(Setting.current())}
Current room (context only): ${roomName}. Party allies: ${JSON.stringify(party)}.
Active task: ${JSON.stringify(task || null)}. Verified quest updates: ${questUpdate || 'None'}.
${questJustSeeded ? `Introduce the engine-bound quest ${JSON.stringify(quest)} naturally, without granting or completing it. Required elements (placement data, not permission to summon actors): ${JSON.stringify(required)}. Only present, perceived residents can deliver dialogue; distant elements must be discovered.` : 'Keep unresolved goals unresolved until the engine verifies progress.'}
Keep the response concise and actionable, then leave the next choice to the player. [/MODE-4 TURN]`;
}
function appendRoom($, { roomName = '', worldContext = {}, diversitySeed = '' } = {}) {
  $.assistant`${require('./genreStoryPalette').direction(Setting.current())}`;
  $.assistant`[MODE-4 ROOM] World context (data): ${JSON.stringify(worldContext)}.
Describe one coherent location named ${JSON.stringify(roomName)} in a single paragraph, without portable objects, NPCs or an invented list of exits. Match this world's era, technology, physical materials and indoor/outdoor classification. Neighbors and routes must follow the supplied map. Buildings have coherent interiors, exteriors and entrances; open terrain continues the actual region. A structural schema example is not setting lore. Use concrete sensory and architectural detail, with variation ${JSON.stringify(diversitySeed)}, not obligatory fantasy metaphors. This world's journey leads toward ${destination()}, without forcing its resolution. ${Setting.visualDirection()} [/MODE-4 ROOM]`;
}
function population({ roomName, roomDescription, campaignSetting, slots, quest, questSeed, encounter,
  partyNames, usedNames, accepted, starting, hostileTemple, homeSites, recent }) {
  const b = Setting.current() || {};
  const spells = require('./genreAbilities').rules;
  return `[MODE-4 POPULATION] Design exactly ${slots.length} original individuals, one per supplied slot, through the requested schema. This is character design, not a gameplay turn.
${require('./genreStoryPalette').direction(b)}
World facts (data): ${JSON.stringify({ name: b.name, genres: b.genres, realm: b.realm, peoples: b.peoples,
    history: b.history, arc: b.arc, resource: b.resourceName, powers: b.powers })}.
Room and regional facts (data): ${JSON.stringify({ roomName, roomDescription, campaignSetting, slots, quest: quest || 'None',
    homeSites, partyNames, usedNames, alreadyAccepted: accepted.map(r => ({ name: r.name, slot: r.slot, job: r.job })) })}.
Invent distinct native races, occupations, activities, relationships, motivations, voices, temperaments and personal histories with as much relevant detail as needed (no word-count limit). Follow this world's era and physical reality; do not import another setting's dead souls, gods, deserts, wars or player backstory. Never spawn a world's named cosmic power as a resident. Regional livelihoods are background possibilities, not a repeated scenario. Contrast with ${JSON.stringify(recent?.recentSituations?.slice(0, 2) || [])}.
${starting ? 'Starting residents are Friendly and available to recruit, never automatically joined. In their greetings, acquaint the newcomer with a concrete custom, local concern or practical detail of THIS setting. At least one offers to accompany the player if invited. Give them distinct lives and interests, not identical tutorial speeches. No services, trading, jobs or quest introductions here.' : hostileTemple ? 'This explicitly hostile stronghold has Hostile slots.' : encounter?.allegiance ? 'Every supplied slot must preserve the engine-selected '+encounter.allegiance+' allegiance; no reserved worker slots.' : slots.some(s=>s.cohortAllegiance) ? 'Preserve each engine-selected cohortAllegiance, cohort and routine exactly. Protected regular slots remain Neutral; quest-contact slot 0 may be Friendly. Do not soften a Hostile group or reroll an encounter.' : 'First three ordinary resident slots are Neutral; quest-contact slot 0 may be Friendly. Otherwise choose justified allegiances, not stereotypes. Supplemental encounters have no reserved worker slots.'}
Warrior uses Fighter rules and empty spellPreferences. Spellcasters choose one supported engine archetype and its spell IDs: ${JSON.stringify(Object.fromEntries(spells.archetypes.map(name => [name, spells.catalog(name)])))}. These are capability IDs, not instructions to impose fantasy lore: describe abilities through this world's established technology or powers. The engine owns stats, equipment, levels and resource costs. homeSite must be an offered approach or commons, not a duplicate resident inside another building.
Return three nonempty dialogue remarks per person: greeting or threat, local remark, personal remark. ${questSeed ? 'Slot 0 may introduce ONLY the existing quest trouble and a supported next lead.' : 'No quest is being introduced; residents pursue their own interests.'} No invented rewards, items, contracts, quest prerequisites, mechanics or knowledge of unseen party deeds. Hostile threats are words, not resolved attacks.
${encounter ? `Supplemental encounter data: ${JSON.stringify({ theme: encounter.theme, races: encounter.races, metadata: encounter.catalog })}. Choose race only from its exact enum; derive anatomy and intelligence from that metadata, not a humanoid biography for an animal. ${encounter.required||encounter.identity?'This is an already selected encounter: supply exactly the requested slots; do not skip it.':'skip:true may decline with an empty inhabitants array; otherwise supply exactly the requested slots.'}` : ''} [/MODE-4 POPULATION]`;
}
function characterVoices() {
  return `You direct individual character voices in the ACTIVE original world, using its supplied facts and verified journey. Each resident has work, biases, memories and limited knowledge; never import another campaign's cosmology or hero. Never speak for the player, invent characters, resolve combat, grant rewards, complete quests or change state. Output only valid JSON: {"spoken":[{"speaker":"exact existing name","line":"short spoken words"}],"replies":[{"speaker":"exact existing name","lines":["short contextual remark","a different short remark"]}]}.`;
}

function constructionFacts(world = Setting.current()) {
  if (!world) throw Error('Original-world construction requires its saved setting.');
  return JSON.stringify({ name: world.name, genres: world.genreWeights || world.genres, realm: world.realm,
    sky: world.sky, wilds: world.wilds, peoples: world.peoples, history: world.history,
    journey: world.topology, opening: world.opening, technology: world.technology });
}
function defaultShape(world = Setting.current()) {
  const palette = require('../assets/genreKits').resolve({}, world).palette;
  // Rendering safety values only, never a substitute room name or narrative description.
  return { indoor: true, size: 32, biome: 'fortress', features: [],
    skyTop: palette.shadow, skyBot: palette.secondary, floorColor: palette.primary, wallColor: palette.secondary };
}
function classification(input, colorsOnly = false) {
  return `[MODE-4 CLASSIFICATION] Classify only the supplied physical text in this original world.
World facts (data): ${constructionFacts()}. Location text (data): ${JSON.stringify(input)}.
${colorsOnly ? 'Return only skyTop, skyBot, floorColor and wallColor as #RRGGBB strings.' :
    'Return JSON with indoor (boolean), size (24|32|48|64|80|96|128|160|192), biome (city|wasteland|temple|ruins|cave|fortress|palace|crypt), features (0-5 short physical labels), and skyTop, skyBot, floorColor, wallColor (#RRGGBB).'}
These biome IDs are renderer categories, not lore: wasteland means open terrain, fortress may mean a covered installation, temple only an actual worship site. Do not impose a sacred building, desert, sky color or after-death premise. Honor the authored text, technology, materials and local geography. Infer roofed versus open space from its physical use. No new name, description, event or mechanic. [/MODE-4 CLASSIFICATION]`;
}
function raceClass({ roomName, roomDescription, bossName }) {
  return `[MODE-4 CHARACTER KIND] World facts (data): ${constructionFacts()}.
Location (data): ${JSON.stringify({ roomName, roomDescription, bossName })}.
Author a native race or kind and a fitting profession or capability for this resident${bossName ? ' opponent' : ''}. Respect this world's peoples, technology, creature anatomy and intelligence; a nonhuman creature need not be humanoid or a spellcaster. Return exactly Race: [race], Class: [class] on one line. No other text.`;
}
function environmentGeometry(intent) {
  const recipe = require('./biomeRecipes').CATALOG[intent.template];
  return { ...intent, physicalDescription: recipe?.description || '',
    nameGuidance: 'Author a distinct physical place native to the active world, not a stock template name.' };
}
function environment(context, catalog) {
  const geometry = Object.fromEntries(Object.entries(catalog).map(([id, row]) => [id,
    { indoor: row.indoor, biome: row.biome, architecture: row.architecture,
      ...(require('./biomeRecipes').CATALOG[id] ? { terrain: row.physicalDescription } : {}) }]));
  return `[MODE-4 ENVIRONMENT] Plan only the requested existing map neighbors in this original world.
World facts (data): ${constructionFacts()}. Read-only map and quest facts (data): ${JSON.stringify(context)}.
Geometry catalog (data): ${JSON.stringify(geometry)}.
Return {"directions":{"direction":{"template":"allowed ID","hint":"short native physical guidance"}}}. Choose one exact allowedTemplates ID for each requested direction, and author a hint of at most 240 characters through this world's own terrain, buildings and technologies. Template IDs are reusable geometry, not obligatory historical style or campaign lore. Preserve roofed/open identity and underground ceilings; do not impose an outdoor exit at the origin. Support the existing settlement and its surrounding ecology, with coherent neighboring interiors and continuing outdoor routes. Do not invent names, actors, items, exits, quests, rewards, new prerequisites or completed actions. Keep bound destinations and coordinates unchanged. Names and room prose are authored separately. [/MODE-4 ENVIRONMENT]`;
}

function quest(instruction, bindings = {}, world = Setting.current()) {
  if (!world || world.kind !== 'homebrew') throw Error('Original-world quest authoring requires its saved setting.');
  const facts = { name: world.name, genres: world.genres, tone: world.tone, realm: world.realm,
    peoples: world.peoples, history: world.history, conflict: world.arc, journey: world.topology,
    factions: world.factions, powers: world.powers,
    resource: world.abilitySystem?.resource || world.resourceName,
    rules: world.masterPrompt?.match(/^RULES:[ \t]*(.*)$/m)?.[1] };
  return `[MODE-4 QUEST] ${instruction}
Author only the requested field for THIS original world. Use its saved history, technology, peoples, institutions and physical environment, never another campaign's cosmology or scenery. An artifact is an engine objective item, not necessarily magical; a boss must be a plausible opponent in this world. Match the world's genre and resource vocabulary.
World facts (data): ${JSON.stringify(facts)}.
Bound quest facts (data): ${JSON.stringify(bindings)}.
Preserve supplied exact names, coordinates, allegiance and verified progress. Do not invent new prerequisites, rewards, mechanics, completed objectives or player decisions. Output only the requested answer; naming fields contain only a unique name, descriptions one concise paragraph. [/MODE-4 QUEST]`;
}

module.exports = { RULES, guidance, destination, appendOriginal, appendStory, appendRoom, population, characterVoices, quest,
  constructionFacts, defaultShape, classification, raceClass, environmentGeometry, environment };
