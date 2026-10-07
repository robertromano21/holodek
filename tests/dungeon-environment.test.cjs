const assert = require('node:assert/strict');
const test = require('node:test');
const { buildEnvironment, observe } = require('../assets/dungeonEnvironment');

function room() {
  const cells = {};
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 };
  cells['8,7'].tile = 'custom_furnace';
  return { start: { x: 7, y: 7 }, cells, tiles: { custom_furnace: { landmark: { drawer: 'furnace' } } }, sceneSpec: { indoor: true, source: { description: 'Water drips from the ceiling.' } } };
}

test('environmental cues require actual props or indoor ceilings', () => {
  const d = room();
  const environment = buildEnvironment(d);
  assert.equal(environment.cues.filter(c => c.kind === 'heat').length, 1);
  assert.equal(environment.cues.filter(c => c.kind === 'drip').length, 3);
  d.sceneSpec.indoor = false;
  assert.equal(buildEnvironment(d).cues.filter(c => c.kind === 'drip').length, 0);
  d.cells['8,7'].tile = 'floor';
  assert.equal(buildEnvironment(d).cues.length, 0);
});

test('notices respect walls, field of view, cooldown and saved discovery state', () => {
  const d = room();
  d.sceneSpec.source.description = '';
  d.environment = buildEnvironment(d);
  const player = { x: 5.5, y: 7.5, z: 0.65, angle: 0 };
  const cue = observe(d, player, 20000).notice;
  assert.equal(cue.kind, 'heat');
  assert.equal(observe(d, player, 20000, 10000).notice, null);
  d.environmentSeen = { [cue.id]: true };
  assert.equal(observe(d, player, 40000).notice, null);
  assert.equal(observe(d, { ...player, angle: Math.PI }, 40000).active.length, 0);
  d.cells['6,7'].tile = 'wall';
  assert.equal(observe(d, player, 40000).active.length, 0);
});
