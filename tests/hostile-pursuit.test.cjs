'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants'), P = require('../retort/hostilePursuit');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture() {
  const dungeon = key => {
    const d = { geoKey: key, layout: { width: 24, height: 24 }, start: { x: 10, y: 10 }, cells: {},
      roomExits: { markers: [{ direction: 'east', x: 15, y: 10, floor: 0 }] } };
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
    return d;
  };
  const from = '1,0,0', to = '0,0,0', origin = dungeon(from), destination = dungeon(to);
  const source = I.createPopulation(from, [{ name: 'Hunter', allegiance: 'Hostile' }, { name: 'Watcher', allegiance: 'Hostile' },
    { name: 'Mason', allegiance: 'Neutral' }]);
  const target = I.createPopulation(to, [], { starting: true });
  for (const a of Object.values(source.actors)) {
    a.sheet = formatStartingCharacterSheet({ Name: a.name, Sex: 'Male', Race: 'Human', Class: 'Fighter', Level: 2,
      AC: 10, HP: 17, MaxHP: 40, Attack: 2, Damage: 3 });
    a.hp = 17; a.position = a.home = { x: 13, y: 10 };
    a.pursuit.willing = a.name === 'Hunter';
  }
  source.groups.forEach(g => g.site = { x: 13, y: 10 });
  let db = JSON.stringify({ [from]: { exits: { east: { status: 'open', targetCoordinates: to } }, inhabitants: source },
    [to]: { inhabitants: target } });
  let text = 'Coordinates: X: 0, Y: 0, Z: 0\nMonsters in Room: None\nMonsters Equipped Properties: None\nMonsters State: None\nRooms Visited: 2';
  let wire = JSON.stringify([{ name: 'PC', type: 'pc', hp: 100 }]), current = { x: 1, y: 0, z: 0 };
  const populations = new Map([[from, source], [to, target]]), now = 100000;
  const live = { roomKey: from, player: { x: 15.5, y: 10.5 }, characters: [] };
  const state = { getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getRoomPopulation: key => populations.get(key), setRoomPopulation: (key, value) => populations.set(key, value),
    getLastCoords: () => current, getLiveWorldState: () => live, getDungeonRunId: () => 'run',
    getRoomDungeonForSimulation: c => c.x === 1 ? origin : destination,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v, getCurrentTasks: () => [] };
  P.observe(source, origin, live.player, new Set(), now);
  return { source, target, origin, destination, state, live, now, arrive: () => current = { x: 0, y: 0, z: 0 },
    service: createPopulationService(state) };
}
test('only a stable subset of generated hostiles are willing pursuers; neutrals and starting companions never are', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ name: 'Guard ' + i, allegiance: 'Hostile' }));
  const population = I.createPopulation('1,0,0', rows);
  const willing = Object.values(population.actors).filter(a => a.pursuit.willing).length;
  assert.ok(willing > 0 && willing < Object.keys(population.actors).length);
  assert.deepEqual(I.createPopulation('1,0,0', rows).actors, population.actors);
  assert.equal(I.createPopulation('0,0,0', rows, { starting: true }).actors['Guard 0'].pursuit.willing, false);
});
test('a pursuer must spot the player, reach a real open threshold and have chase budget', () => {
  const f = fixture();
  assert.deepEqual(P.plan(f.state, 'east', f.now).candidates.map(a => a.name), ['Hunter']);
  f.live.player.x = 10.5; assert.equal(P.plan(f.state, 'east', f.now), null);
  f.live.player.x = 15.5; f.origin.cells['14,10'].tile = 'wall';
  f.origin.cells['13,9'].tile = f.origin.cells['13,11'].tile = f.origin.cells['12,10'].tile = 'wall';
  assert.equal(P.plan(f.state, 'east', f.now), null);
  f.origin.cells['14,10'].tile = 'floor';
  f.source.actors.Hunter.pursuit.remainingRooms = 0; assert.equal(P.plan(f.state, 'east', f.now), null);
  f.source.actors.Hunter.pursuit.remainingRooms = 2; assert.equal(P.plan(f.state, 'east', f.now + 16000), null);
});
test('explicit transfers preserve injury and identity, remove the source actor, and do not turn residents into companions', () => {
  const f = fixture(), ticket = P.plan(f.state, 'east', f.now), watcher = JSON.stringify(f.source.actors.Watcher);
  f.arrive(); assert.deepEqual(P.transfer(ticket, f.state, f.service, f.target, f.destination, f.now), ['Hunter']);
  assert.equal(f.source.actors.Hunter.status, 'departed'); assert.equal(f.target.actors.Hunter.hp, 17);
  assert.equal(f.target.actors.Hunter.pursuit.remainingRooms, 1);
  assert.equal(I.parseBlocks(f.target.actors.Hunter.sheet)[0].hp, 17);
  assert.equal(JSON.stringify(f.source.actors.Watcher), watcher);
  assert.equal(I.residentSheets(f.source).some(a => a.name === 'Hunter'), false);
  assert.deepEqual(P.transfer(ticket, f.state, f.service, f.target, f.destination, f.now), [], 'A replay cannot duplicate the hunter');
  assert.ok(f.target.actors.Hunter.position);
});
test('protected quest actors, dead actors, stale runs and impossible arrival spaces cannot transfer', () => {
  for (const scenario of ['quest', 'dead', 'run', 'sealed']) {
    const f = fixture(), ticket = P.plan(f.state, 'east', f.now); f.arrive();
    if (scenario === 'quest') f.state.getCurrentTasks = () => [{ requiredElements: [{ name: 'Hunter' }] }];
    if (scenario === 'dead') f.source.actors.Hunter.hp = 0;
    if (scenario === 'run') f.state.getDungeonRunId = () => 'new-run';
    if (scenario === 'sealed') for (const c of Object.values(f.destination.cells)) c.tile = 'wall';
    assert.deepEqual(P.transfer(ticket, f.state, f.service, f.target, f.destination, f.now), [], scenario);
    assert.equal(f.target.actors.Hunter, undefined);
  }
});
