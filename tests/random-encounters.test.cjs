'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), I = require('../assets/dungeonInhabitants'), E = require('../retort/randomEncounters');
const Catalog = require('../assets/monsterRaces'), { generateInhabitants } = require('../retort/inhabitantGeneration');
const fixtures = require('./fixtures/inhabitants.cjs'), { formatStartingCharacterSheet } = require('../retort/initialGameState');
const key = '4,4,0';
function setup(indoor = false) {
  const d = { geoKey: key, layout: { width: 96, height: 96 }, start: { x: 20, y: 20 }, classification: { indoor }, cells: {} };
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 8 };
  const p = I.createPopulation(key, [{ name: 'Existing Watch', race: 'Shade', class: 'Fighter', allegiance: 'Hostile' }], { indoor });
  Object.assign(p.actors['Existing Watch'], { hp: 40, position: { x: 80, y: 80 }, home: { x: 80, y: 80 } });
  p.groups[0].site = { x: 80, y: 80 };
  p.randomEncounters = { version: 1, count: 0, attempts: 0, distance: 150, lastAttempt: 0, recentRaces: [], heading: 0 };
  let roster = JSON.stringify([{ name: 'Mortacia', type: 'pc', state: 'Alive', hp: 120, level: 50, mazeX: 20, mazeY: 20, mazeRoomKey: key },
    { name: 'Companion', type: 'npc', state: 'Alive', hp: 20, level: 3, mazeX: 19, mazeY: 20, mazeRoomKey: key }]);
  let run = 'run', paused = false;
  const text = `Room Name: The Ash Crossing\nRoom Description: A route through the underworld.\nCoordinates: X: 4, Y: 4, Z: 0\nPC:\n${formatStartingCharacterSheet({ Name: 'Mortacia', HP: 120, MaxHP: 120, Class: 'Fighter', Level: 50 })}\nMonsters in Room: None\nTurns: 10`;
  const state = { getDungeonRunId: () => run, getRoomPopulation: () => p, getLastCoords: () => ({ x: 4, y: 4, z: 0 }),
    getRoomDungeonForSimulation: () => d, getGamePaused: () => paused, getDungeonTestingMode: () => false,
    getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v,
    getUpdatedGameConsole: () => text, getCurrentQuest: () => 'Reach Hades.',
    getRoomNameDatabase: () => JSON.stringify({ [key]: { name: 'The Ash Crossing', description: 'A dry ashland trail.', inhabitants: p } }) };
  const service = { save(population) { population.revision++; } };
  const visit = { population: p, dialogue: [], discoveries: [], encounters: [] }, player = { x: 20.5, y: 20.5 };
  return { state, service, visit, player, p, d, setRun: r => run = r, pause: () => paused = true };
}
function runtime(reply, call = () => {}) {
  const prompts = [], agent = { user(p, ...v) { prompts.push(typeof p === 'string' ? p : String.raw({ raw: p }, ...v)); },
    assistant: { async generation(options) { call(options); return { content: JSON.stringify(reply) }; } } };
  return { prompts, run: async fn => fn(agent), retort: fn => fn };
}

test('browser and server share 358 unique races, retaining metadata from all 368 original entries', () => {
  assert.equal(Catalog.length, 358); assert.equal(new Set(Catalog.map(row => row.name)).size, Catalog.length);
  assert.ok(Catalog.every(row => typeof row.description === 'string' && row.description.length));
  assert.ok(Catalog.some(row => row.name === 'Allip' && /undead/.test(row.description)));
  const source = fs.readFileSync(require.resolve('../assets/game.js'), 'utf8');
  assert.match(source, /const monsterRaces = window.MonsterRaces/);
});

test('indoors have a sparse limit; outdoors can have more, without a fixed race or allegiance', () => {
  assert.ok(E.policy(true).limit < E.policy(false).limit);
  assert.equal(E.policy(true).groupSize, 1); assert.equal(E.policy(false).groupSize, 3);
  const ctx = setup(); assert.ok(E.opportunity(ctx.state, ctx.visit, ctx.player, 200000));
  ctx.p.actors['Existing Watch'].position = { x: 25, y: 25 };
  assert.equal(E.opportunity(ctx.state, ctx.visit, ctx.player, 200000), null);
  ctx.p.actors['Existing Watch'].position = { x: 80, y: 80 };
  ctx.p.travelDiscovery = { active: { groupId: 'ordinary encounter' } };
  assert.equal(E.opportunity(ctx.state, ctx.visit, ctx.player, 200000), null);
});

test('stationary waiting and teleport-sized movement do not accrue encounter travel', () => {
  const { p, d, player } = setup(); p.randomEncounters.distance = 0;
  E.observe(p, d, player, 1000); E.observe(p, d, player, 4000);
  assert.equal(p.randomEncounters.distance, 0);
  E.observe(p, d, { x: 70, y: 70 }, 7000); assert.equal(p.randomEncounters.distance, 0);
  E.observe(p, d, { x: 73, y: 70 }, 10000); assert.equal(p.randomEncounters.distance, 3);
});

test('regular inhabitants retain Tartarus race notes and free-form races', async () => {
  let schema;
  const rt = runtime({ inhabitants: fixtures(8) }, options => { schema = options.parameters.inhabitants[0].type; });
  await rt.run($ => generateInhabitants($, { roomName: 'The Ash Crossing', roomDescription: 'A route through Tartarus.',
    geoKey: key, indoor: true },
    { level: () => 1, random: () => 2, sex: () => 'Female', xp: () => 0, equipment: async () => null }));
  assert.equal(schema.race.enum, undefined);
  const prompt = rt.prompts.join('\n');
  assert.match(prompt, /These are fantasy races for an intelligent or unintelligent animal, monster, spirit/);
  assert.match(prompt, /dragons \(celestial and otherwise\) high magical beings and other entities of pure energy and form, angels, powerful demons, never gods or goddesses/);
  assert.match(prompt, /the engine's allegiance slots below are authoritative/);
  assert.match(prompt, /All other suggested allegiances and group names above are defaults you may replace/);
  assert.match(prompt, /Arithus never appears outside the final throne-room encounter/);
});

for (const indoor of [true, false]) test(`on-the-fly ${indoor ? 'indoor' : 'outdoor'} additions preserve the regular cast, use enums and send creature metadata`, async () => {
  const ctx = setup(indoor), count = E.policy(indoor).groupSize, names = Catalog.map(r => r.name);
  const rows = fixtures(count, Array.from({ length: count }, (_, slot) => ({ slot, name: `Unfamiliar Soul ${slot}`, race: 'Allip',
    allegiance: 'Hostile', encounterId: 'lost-caravan', history: 'Haunts a forgotten caravan route. Its tormented murmurs preserve one broken memory.' })));
  const rt = runtime({ skip: false, inhabitants: rows }, options => assert.deepEqual(options.parameters.inhabitants[0].type.race.enum, names));
  const old = JSON.stringify(ctx.p.actors['Existing Watch']);
  const result = await E.maybeGenerate({ ...ctx, runtime: rt, now: 200000 });
  assert.equal(ctx.p.randomEncounters.count, 1); assert.equal(Object.keys(ctx.p.actors).length, count + 1);
  assert.equal(JSON.stringify(ctx.p.actors['Existing Watch']), old);
  assert.ok(result.discoveries.some(row => row.kind === 'people'));
  for (const actor of Object.values(ctx.p.actors).filter(a => a.supplemental)) {
    assert.equal(actor.race, 'Allip'); assert.equal(actor.allegiance, 'Hostile'); assert.ok(actor.position);
    assert.ok(Math.hypot(actor.position.x + .5 - ctx.player.x, actor.position.y + .5 - ctx.player.y) >= 12);
    assert.ok(I.parseBlocks(actor.sheet)[0].level <= 3);
  }
  assert.ok(rt.prompts.some(p => p.includes('Tormented, babbling undead') && /derive suitable anatomy, intelligence, behavior, history, personality/.test(p)));
  assert.ok(rt.prompts.some(p => p.includes('These are fantasy races for an intelligent or unintelligent animal, monster, spirit') &&
    p.includes('Supplemental encounters have NO reserved workers') && p.includes('never gods or goddesses')));
});

test('unsupported races are rejected, while a model-declined encounter adds no manufactured fallback', async () => {
  const ctx = setup(true), rules = { level: () => 1, random: () => 2, sex: () => 'Female', xp: () => 0, equipment: async () => null };
  const bad = runtime({ inhabitants: fixtures(1, [{ slot: 0, race: 'Not In The Enum' }]) });
  await assert.rejects(bad.run($ => generateInhabitants($, { roomName: 'Crossing', geoKey: key, indoor: true,
    encounter: { count: 1, races: Catalog.map(r => r.name), catalog: Catalog } }, rules)), /outside the encounter catalog/);
  const result = await E.maybeGenerate({ ...ctx, runtime: runtime({ skip: true, inhabitants: [] }), now: 200000 });
  assert.equal(result, ctx.visit); assert.equal(Object.keys(ctx.p.actors).length, 1); assert.equal(ctx.p.randomEncounters.attempts, 1);
});

test('stale generation, pause, per-room caps and live-action guards cannot install new creatures', async () => {
  const ctx = setup(true), reply = { inhabitants: fixtures(1, [{ slot: 0, race: 'Imp', name: 'New Imp', allegiance: 'Neutral' }]) };
  const rt = runtime(reply, () => ctx.setRun('new-run'));
  await E.maybeGenerate({ ...ctx, runtime: rt, now: 200000 });
  assert.equal(Object.keys(ctx.p.actors).length, 1);
  const capped = setup(); capped.p.randomEncounters.count = E.policy(false).limit;
  assert.equal(E.opportunity(capped.state, capped.visit, capped.player, 200000), null);
  const paused = setup(); paused.pause(); assert.equal(E.opportunity(paused.state, paused.visit, paused.player, 200000), null);
  const busy = setup(); await E.maybeGenerate({ ...busy, runtime: runtime(reply, () => { throw Error('Must not call'); }), isCurrent: () => false, now: 200000 });
  assert.equal(busy.p.randomEncounters.attempts, 0);
});
