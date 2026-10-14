'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../retort/campaignSetting'), Env = require('../retort/environmentIntents');
const { prepareSceneVegetation } = require('../retort/sceneVegetation');
test('regional metadata is stable locally, varied across the journey and never renames existing rooms', () => {
  const a = C.plan({ targetKey: '4,4,0', template: 'oasis', seed: 'a' });
  const b = C.plan({ targetKey: '5,4,0', template: 'inn', seed: 'a' });
  assert.equal(a.communityId, b.communityId); assert.equal(a.authority, b.authority);
  assert.equal(a.inhabited, true); assert.equal(b.building, true); assert.equal(a.building, false);
  assert.notEqual(C.plan({ targetKey: '40,4,0', template: 'castle', seed: 'a' }).region, a.region);
  const db = { '4,4,0': { name: 'Saved Oasis', description: 'Saved prose' } };
  assert.equal(C.install(db, '4,4,0', a), true); assert.equal(C.install(db, '4,4,0', b), false);
  assert.equal(db['4,4,0'].name, 'Saved Oasis'); assert.equal(db['4,4,0'].description, 'Saved prose');
});
test('the frontier includes rare inhabited sites, while root constraints and saved destinations remain authoritative', async () => {
  const seen = new Set();
  for (let x = 1; x < 80; x++) seen.add(C.frontierTemplate({ targetKey: `${x},1,0`, template: 'wasteland', sourceIndoor: false, seed: 'a' }));
  for (const kind of ['oasis', 'graveyard', 'hamlet', 'market', 'inn', 'house', 'castle', 'wizard_citadel', 'wasteland']) assert.ok(seen.has(kind), kind);
  assert.equal(C.frontierTemplate({ targetKey: '0,1,0', constraint: 'root-first-wasteland', template: 'wasteland' }), 'wasteland');
  const db = { '0,0,0': { indoor: true, exits: { north: {}, east: {} } }, '1,0,0': { name: 'Real Quest Room', bossGate: {} } };
  const before = JSON.stringify(db), plan = await Env.chooseEnvironmentIntents(null, { coords: { x: 0, y: 0, z: 0 }, directions: ['north', 'east'], database: db });
  assert.equal(plan.intents.north.template, 'wasteland'); assert.equal(plan.intents.east, undefined); assert.equal(JSON.stringify(db), before);
});
test('atlas accepts only bounded world metadata, and fixes origin, destination and the route graph', () => {
  const raw = { regions: C.REGIONS, factions: C.FACTIONS, bossKey: 'free key', silver: 9000, origin: 'Elsewhere' };
  const atlas = C.validateAtlas(raw, 'run'); assert.equal(atlas.origin, 'Tartarus'); assert.equal(atlas.destination, 'Hades');
  assert.equal(atlas.bossKey, undefined); assert.equal(atlas.silver, undefined); assert.equal(atlas.connections.length, 3);
  assert.equal(C.validateAtlas({ ...raw, regions: raw.regions.slice(0, 2) }, 'run'), null);
  assert.equal(C.validateAtlas({ ...raw, factions: Array(4).fill(raw.factions[0]) }, 'run'), null);
});
test('a planner is called once per run and saved rooms survive; failures have a usable fallback', async () => {
  let data = JSON.stringify({ '0,0,0': { name: 'Ruined Temple Entrance' }, '1,0,0': { name: 'Keep This', objects: [{ name: 'bound relic' }] } });
  let calls = 0; const $ = { user: async () => {}, assistant: { generation: async () => { calls++; return { content: JSON.stringify({ regions: C.REGIONS, factions: C.FACTIONS }) }; } } };
  const state = { getDungeonRunId: () => 'run', getRoomNameDatabase: () => data, setRoomNameDatabase: v => data = v };
  const first = await C.prepareAtlas($, state); await C.prepareAtlas($, state); assert.equal(calls, 1);
  assert.equal(first.source, 'validated-campaign-plan'); assert.equal(JSON.parse(data)['1,0,0'].name, 'Keep This');
  data = '{}'; const fallback = await C.prepareAtlas(null, state); assert.equal(fallback.regions.length, 4);
});
test('fertile oases use living voxel trees and green reeds, not renamed dead groves', () => {
  const spec = { indoor: false, source: { description: 'A fertile spring-fed oasis with green reeds and cultivated gardens.' } };
  const plan = prepareSceneVegetation(spec); assert.equal(plan.profile, 'oasis'); assert.equal(plan.enabled, true);
  assert.deepEqual(plan.species, ['willow', 'oak', 'cypress']); assert.deepEqual(plan.scrub, ['reed_tussock']);
  assert.ok(!spec.landmarks.some(l => /dead|snag|skeletal/.test(l.type)));
});
