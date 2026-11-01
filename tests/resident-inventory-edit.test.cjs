'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Edit = require('../retort/residentInventoryEdit');
function fixture() {
  let db = { '1,-1,0': { inhabitants: { actors: { 'Tavik Edran': { name: 'Tavik Edran', status: 'present', hp: 13, position: {x:4.5,y:4.5},
    inventory: [{ name: 'gantry boltcaster' }, { name: 'personal ledger' }], receivedItems: [{ item: 'gantry boltcaster' }], sheet: 'Equipped: Weapon: None' } }, revision: 4 } } };
  let pop = structuredClone(db['1,-1,0'].inhabitants), paused = true;
  pop.travelDiscovery = { objects: { 'gantry boltcaster': { id: 'original-boltcaster', name: 'gantry boltcaster', status: 'exhausted', x: 10, y: 10 } } };
  let text = 'Coordinates: X: 1, Y: -1, Z: 0\nObjects in Room: None\nObjects in Room Properties: None';
  let dungeon = {geoKey:'1,-1,0',cells:{},sceneObjects:[]};
  for(let y=0;y<12;y++)for(let x=0;x<12;x++)dungeon.cells[x+','+y]={tile:'floor',floorHeight:0};
  const state = { getRoomDungeonForSimulation:()=>dungeon, setRoomDungeon:(_,d)=>{dungeon=d;},
    getUpdatedGameConsole:()=>text, setUpdatedGameConsole:t=>{text=t;}, getGamePaused: () => paused, getLastCoords: () => ({ x: 1, y: -1, z: 0 }),
    getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: s => { db = JSON.parse(s); },
    getRoomPopulation: () => pop, setRoomPopulation: (key, value) => { pop = value; } };
  return { state, snapshot: () => JSON.stringify({ db, pop }), pause: v => { paused = v; } };
}
const input = { key: '1,-1,0', actor: 'Tavik Edran', item: 'gantry boltcaster' };
test('admin drop places exactly one loose item on the ground and preserves history, health and equipment', () => {
  const f = fixture(), result = Edit.drop(f.state, input);
  assert.deepEqual(result.remaining, ['personal ledger']);
  assert.equal(result.dropped, 'gantry boltcaster');
  assert.equal(f.state.getRoomDungeonForSimulation().sceneObjects.filter(o=>o.name==='gantry boltcaster').length,1);
  assert.match(f.state.getUpdatedGameConsole(),/Objects in Room: gantry boltcaster/);
  const actor = JSON.parse(f.state.getRoomNameDatabase())['1,-1,0'].inhabitants.actors[input.actor];
  assert.equal(actor.hp, 13); assert.equal(actor.receivedItems.length, 1); assert.equal(actor.sheet, 'Equipped: Weapon: None');
  assert.deepEqual(f.state.getRoomPopulation().actors[input.actor], actor);
  const placement = f.state.getRoomPopulation().travelDiscovery.objects[input.item];
  assert.equal(placement.status, 'placed'); assert.deepEqual({ x: placement.x, y: placement.y }, result.position);
  const rendered = require('../assets/outdoorDiscovery').objects(f.state.getRoomDungeonForSimulation().sceneObjects, f.state.getRoomPopulation());
  assert.equal(rendered.filter(o => o.name === input.item).length, 1);
  assert.throws(() => Edit.drop(f.state, input), /exactly one/);
});

test('repairing an already dropped exhausted item restores visibility without duplicating or taking anything', () => {
  const f = fixture(); Edit.drop(f.state, input);
  f.state.getRoomPopulation().travelDiscovery.objects[input.item].status = 'exhausted';
  const first = Edit.drop(f.state, { ...input, repairGround: true });
  const second = Edit.drop(f.state, { ...input, repairGround: true });
  assert.equal(first.repaired, true); assert.deepEqual(first.position, second.position);
  assert.deepEqual(second.remaining, ['personal ledger']);
  const room = JSON.parse(f.state.getRoomNameDatabase())[input.key];
  assert.equal(room.objects.filter(o => o.name === input.item).length, 1);
  assert.equal(room.inhabitants.travelDiscovery.objects[input.item].status, 'placed');
});
test('paused-game, current-room and exact-name checks reject without changing state', () => {
  const f = fixture(), before = f.snapshot(); f.pause(false);
  assert.throws(() => Edit.drop(f.state, input), /Pause/); f.pause(true);
  assert.throws(() => Edit.drop(f.state, { ...input, key: '0,0,0' }), /room changed/);
  assert.throws(() => Edit.drop(f.state, { ...input, actor: 'Tavik' }), /not present/);
  assert.equal(f.snapshot(), before);
});
