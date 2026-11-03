'use strict';
const C = require('./generationContracts'), Names = require('./generatedNames');
const VERSION = 1, SOURCE = 'authored-room-object-v1';
const TYPES = ['weapon', 'armor', 'shield', 'other'];
const MODIFIERS = Object.freeze({ attack_modifier: [0, 3, 4, 5], damage_modifier: [0, 4, 5, 6], ac: [0, 1, 2], magic: [0, 1, 2, 3] });
const parameters = () => Object.fromEntries(Object.entries(MODIFIERS).map(([key, values]) => [key, { type: Number, enum: values }]));
function selectTypes(count,{types=TYPES,healingOnly=false,random=Math.random}={}){
  if(!Number.isInteger(count)||count<1||count>8)throw Error('Item authoring count must be 1-8.');
  if(!types.length||types.some(type=>!TYPES.includes(type))||new Set(types).size!==types.length)throw Error('Unsupported portable item type.');
  if(healingOnly){if(!types.includes('other'))throw Error('Healing supplies require the other item type.');return Array(count).fill('other');}
  return Array.from({length:count},()=>{
    const roll=random();if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Invalid item type roll.');
    return types[Math.floor(roll*types.length)];
  });
}
function validateModifiers(value) {
  const result = {};
  for (const [key, values] of Object.entries(MODIFIERS)) {
    if (!values.includes(value?.[key])) throw Error(key + ': choose an exact value from ' + values.join(', ') + '.');
    result[key] = value[key];
  }
  return result;
}
function facts(world) {
  return world ? require('./homebrewStoryPrompts').constructionFacts(world) : require('./graveMasterStoryPrompts').settingOnce({});
}
function validate(raw, { count, database = {}, excluded = [], healingOnly = false, types = TYPES, typePlan }) {
  if (!Array.isArray(raw?.items) || raw.items.length !== count) throw Error('items: author exactly ' + count + ' complete portable items.');
  const used = new Set(excluded.map(name => String(name).toLowerCase()));
  return raw.items.map((item,index) => {
    if (require('./bossGate').isReservedBossKeyName(database, item?.name)) throw Error('Ordinary items cannot mint a reserved quest key.');
    const name = require('./holodekObjectName').validate(item);
    if (used.has(name)) throw Error('items: names must be distinct from other items and the supplied exclusions.');
    used.add(name);
    if (!types.includes(item.type)) throw Error('type: choose ' + types.join(', ') + '.');
    if(typePlan&&item.type!==typePlan[index])throw Error('items['+index+'].type: preserve the engine-selected '+typePlan[index]+' type.');
    if (Object.keys(item).some(key => !['name', 'type', 'description', 'consumable_kind', ...Object.keys(MODIFIERS)].includes(key)))
      throw Error('Use only the existing item modifier fields; no weapon dice, range, prices or invented mechanics.');
    if (typeof item.description !== 'string' || !item.description.trim() ||
      /\b\d+d\d+\b|\b(?:attack|damage|armor|magic|tech|luck)\s*[:+]\s*\d+/i.test(item.description))
      throw Error('description: author concise physical fiction, not dice, stat bonuses or an invented effect.');
    const healing = item.consumable_kind === 'healing';
    if (!['none', 'healing'].includes(item.consumable_kind) || healingOnly && !healing) throw Error('consumable_kind: choose none or the supported healing effect.');
    let mods;
    if (healing) {
      if (item.type !== 'other' || !Number.isInteger(item.magic) || item.magic < 3 || item.magic > 10 ||
          ['attack_modifier', 'damage_modifier', 'ac'].some(key => item[key] !== 0))
        throw Error('Healing supplies must be other, restore 3-10 HP using magic, and have zero equipment modifiers.');
      mods = { attack_modifier: 0, damage_modifier: 0, ac: 0, magic: item.magic };
    } else mods = validateModifiers(item);
    return { name, type: item.type, ...mods, description: item.description.trim(), item_source: SOURCE,
      ...(healing ? { consumable_kind: 'healing' } : {}) };
  });
}
async function generate($, { count = 4, roomName, roomDescription, database = {}, excluded = [], purpose = 'room objects',
  operator, healingOnly = false, types = TYPES, world = require('./settingLayer').current(), random = Math.random } = {}) {
  // Preserve the original independent 25% category roll; retries must reuse the same slots.
  const typePlan=selectTypes(count,{types,healingOnly,random});
  const work = async agent => {
    agent.model = $.model || 'gpt-4.1-mini'; agent.temperature = 1;
    await agent.user(`Author ${count} ordinary portable ${purpose} using the SAME rules as room objects. All names and physical descriptions are yours to write from the campaign and actual location. Never select a prefab stock list or import another world's names or technology. Respect the supplied genre blend, era, materials, livelihoods and special-ability rules; nonmagical settings need plausible equipment, not fantasy reskins. No new quest, currency, stats, weapon damage dice, ranges or prices. The engine owns these mechanics. Names are lowercase item nouns. Descriptions are authored physical fiction, with no promised bonuses or unsupported effects. Ordinary equipment uses EXACT modifier enums ${JSON.stringify(MODIFIERS)}. The only consumable effect allowed here is healing: type other, magic 3-10 HP, all other modifiers zero; name its physical form appropriately for this world. ${healingOnly ? 'Every item is a distinct healing supply for this service.' : 'Include a varied, useful mix appropriate to the location, not identical maximum bonuses.'} World facts (data): ${facts(world)}. Location and purpose (data): ${JSON.stringify({ roomName, roomDescription, operator, purpose, excluded: excluded.slice(-40) })}.`);
    await agent.user('Optional catalog NAME/TYPE references only (not mandatory, never a source of mechanics): ' + JSON.stringify(references(world)) +
      '. You may use a suitable name or invent one. Translate every chosen item to the supplied game modifier schema, never copy SRD dice, bonuses or prices. Campaign facts override catalog suggestions.');
    await agent.user('Engine-selected item types in output order (data): '+JSON.stringify(typePlan)+
      '. Author exactly one item for each slot, preserving its type. Do not replace equipment with other objects. The engine rolled these independently; names, materials and physical descriptions remain yours to author for this setting.');
    const fields = { name: C.text(40), type: C.choice([...new Set(typePlan)]), ...parameters(),
      magic: { type: Number, enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      consumable_kind: C.choice(['none', 'healing']), description: C.nonblankText(320) };
    const result = await C.request(agent, { component: 'portable-items', maxTokens: 240 * count + 300,
      parameters: { items: C.list(fields) }, validate: raw => validate(raw, { count, database, excluded, healingOnly, types, typePlan }) });
    if (!result.value) throw result.error || Error('Portable item authoring failed; no stock fallback was installed.');
    return result.value;
  };
  return typeof $.run === 'function' ? $.run(work, null, { shouldSaveToLog: false }) : work($);
}
function references(world) {
  const genres = world?.genres || ['fantasy', 'dark-fantasy', 'mythic'];
  const medieval = genres.some(genre => ['fantasy', 'dark-fantasy', 'mythic'].includes(genre));
  const names = medieval ? Object.values(require('../assets/equipmentRules').catalog).map(({ name, type }) => ({ name, type })) : [];
  for (const genre of genres) for (const item of require('../assets/rangedRules').forGenre(genre))
    if (!item.rare && !item.move && !names.some(row => row.name === item.name)) names.push({ name: item.name, type: 'weapon' });
  return names;
}
async function modifiers($, item) {
  if (!item?.name || !item.type) throw Error('Item modifiers require an authored name and type.');
  const world = require('./settingLayer').current();
  return require('./holodekRoomWork').request($, 'object-modifiers', parameters(),
    `Choose the existing game modifiers for this item (data): ${JSON.stringify({ name: Names.clean(item.name), type: item.type })}. World facts (data): ${facts(world)}. Choose exact schema values. No prose, new item, dice or invented mechanic.`, validateModifiers);
}
module.exports = { VERSION, SOURCE, TYPES, MODIFIERS, parameters, selectTypes, validateModifiers, validate, generate, modifiers, references };
