'use strict';
// Saved world fiction over the existing, authoritative effect/dice engine.
const Base = require('../assets/spellRules');
const flights = new WeakMap();
const bible = () => require('./settingLayer').current();
function validate(value, world) {
  const text = (s, max) => typeof s === 'string' && s.trim() && s.length <= max;
  for (const key of ['name', 'ability', 'plural', 'resource', 'book', 'scroll', 'activate', 'explanation'])
    if (!text(value?.[key], key === 'explanation' ? 700 : 70)) throw Error('Ability system requires ' + key + '.');
  const ids = Object.keys(Base.templates), seen = new Set();
  if (!Array.isArray(value.effects) || value.effects.length !== ids.length) throw Error('Ability system must describe every supported effect.');
  for (const row of value.effects) {
    if (!ids.includes(row.id) || seen.has(row.id) || !text(row.name, 70) || !text(row.description, 400)) throw Error('Invalid or duplicate world ability.');
    seen.add(row.id);
  }
  const classes = world.classes || [], mapped = new Set();
  if (!Array.isArray(value.classes) || value.classes.length !== classes.length) throw Error('Ability system must map every world class.');
  for (const row of value.classes) {
    if (!classes.some(c => c.name === row.name) || mapped.has(row.name) || !['Fighter', ...Object.keys(Base.classes)].includes(row.rulesClass)) throw Error('Invalid world ability class.');
    mapped.add(row.name);
  }
  const leaks = require('./campaignBuilder').lintGenerated(value);
  if (leaks.length) throw Error('Ability system imports another setting: ' + leaks.join(', '));
  return { ...value, version: 1 };
}
async function ensure(state, { runner = require('./settingLayer').defaultRunner } = {}) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), world = db['0,0,0']?.setting;
  if (world?.kind !== 'homebrew') return null;
  require('./settingLayer').attach(state);
  if (world.abilitySystem) return validate(world.abilitySystem, world);
  if (flights.has(state)) return flights.get(state);
  const runId = state.getDungeonRunId(), identity = JSON.stringify(world);
  const task = (async () => {
    const C = require('./generationContracts');
    const value = await runner(async $ => {
      await $.user(`Author this world's special-ability system, consistent with its genre, technology, master rules and class descriptions. Sci-fi can use modules, cyberpunk programs; a mundane world uses training and equipment, not compulsory supernatural magic. Mixed genres follow the actual world. Invent names and explanations, not new mechanics. Map each world class to an existing engine progression (Fighter means no innate ability pool; equipment abilities remain usable). Never rename the world's classes. No Children of the Grave names or lore. Each supplied effect ID retains its EXACT targeting, costs, scaling, duration and limitations; describe a setting-appropriate mechanism without promising extra effects. In particular undead-only effects still affect only undead, never arbitrary robots or humans. Return all effect IDs once, all class names once, and singular/plural ability terms, resource label, manual/book term, consumable formula/module term, activation verb and explanation. World: ${JSON.stringify(world)}. Effect contracts: ${JSON.stringify(Base.templates)}. Progressions: ${JSON.stringify(Base.classes)}.`);
      const r = await C.request($, { component: 'world-abilities', maxTokens: 9000, parameters: {
        name: C.nonblankText(70), ability: C.nonblankText(70), plural: C.nonblankText(70), resource: C.nonblankText(70), book: C.nonblankText(70), scroll: C.nonblankText(70), activate: C.nonblankText(70), explanation: C.nonblankText(700),
        effects: C.list({ id: C.choice(Object.keys(Base.templates)), name: C.nonblankText(70), description: C.nonblankText(400) }),
        classes: C.list({ name: C.choice((world.classes || []).map(c => c.name)), rulesClass: C.choice(['Fighter', ...Object.keys(Base.classes)]) })
      }, validate: v => validate(v, world) });
      if (!r.value) throw Error(r.error?.message || 'World ability authoring failed.');
      return r.value;
    });
    const next = JSON.parse(state.getRoomNameDatabase() || '{}');
    if (state.getDungeonRunId() !== runId || JSON.stringify(next['0,0,0']?.setting) !== identity) throw Error('World changed while authoring abilities.');
    next['0,0,0'].setting.abilitySystem = validate(value, world);
    state.setRoomNameDatabase(JSON.stringify(next)); require('./settingLayer').attach(state);
    return next['0,0,0'].setting.abilitySystem;
  })();
  flights.set(state, task); try { return await task; } finally { flights.delete(state); }
}
function language(world = bible()) { return world?.abilitySystem || null; }
function forWorld(world) {
  const system = language(world); if (!system) return Base;
  const mapping = name => system.classes.find(c => c.name === name)?.rulesClass || name;
  const flavor = s => { const own = system.effects.find(e => e.id === s?.id); return s && own ? { ...s, name: own.name, description: own.description } : s; };
  const templates = Object.fromEntries(Object.entries(Base.templates).map(([id, s]) => [id, flavor({ id, ...s })]));
  const rules = { ...Base, templates, catalogVersion: Base.catalogVersion + ':world:' + Base.hash(JSON.stringify(system)),
    resolveClass: name => Base.resolveClass(mapping(name)),
    classSettings: (name, level) => Base.classSettings(mapping(name), level),
    casterLevel: (name, level) => Base.casterLevel(mapping(name), level),
    catalog: name => Base.catalog(mapping(name)), canLearn: (name, id) => Base.canLearn(mapping(name), id),
    classSpell: (id, level) => flavor(Base.classSpell(id, level)),
    levelSpell: (s, level) => flavor(Base.levelSpell(s, level)),
    recipe: item => Base.recipe(item).map(flavor),
    command: value => Base.command(require('../assets/abilityLanguage').command(value, system)),
    scroll: (id, suffix) => { const item = Base.scroll(id, suffix), s = templates[id]; return item && { ...item,
      name: `${system.scroll} of ${s.name.toLowerCase()}${suffix ? ' ' + suffix.replace(/of the ashroad/gi, 'local issue') : ''}`,
      description: `${s.description} Single use; consumes this ${system.scroll}. Costs ${item.magic} ${system.resource}. Learning follows the mapped class progression.` }; }
  };
  rules.classSettings = (name, level) => { const s = Base.classSettings(mapping(name), level); return s && { ...s, catalogVersion: rules.catalogVersion, tradition: name }; };
  return rules;
}
// Resolve through settingLayer on every call; never mutate the shared browser/CotG catalog.
const rules = new Proxy(Base, { get(_target, key) { return forWorld(bible())[key]; } });
function region(db, key) {
  const world = db['0,0,0']?.setting;
  if (world?.kind !== 'homebrew') return db[key]?.campaignSetting;
  return require('./settingLayer').campaignCommunity({ targetKey: key, sourceKey: key, database: db, seed: world.seed }, world);
}
module.exports = { ensure, validate, language, forWorld, rules, region };
