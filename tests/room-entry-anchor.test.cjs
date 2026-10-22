'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.HOLODEK_WEBSITE_SOURCE_ROOT || path.resolve(__dirname, '..');
const Arrival = require(path.join(root, 'assets/roomArrival'));
const Entry = require(path.join(root, 'retort/roomEntry'));
const I = require(path.join(root, 'assets/dungeonInhabitants'));
const Exits = require(path.join(root, 'assets/dungeonExits'));
const QuestMap = require(path.join(root, 'assets/questMap'));
const game = fs.readFileSync(path.join(root, 'assets/game.js'), 'utf8');
function dungeon(indoor = false) {
  const d = { geoKey: '0,1,0', start: { x: 24, y: 36 }, classification: { indoor },
    layout: { width: 48, height: 48 }, sceneSpec: { exits: Object.keys(Arrival.OPPOSITE) }, cells: {} };
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) d.cells[`${x},${y}`] = {
    tile: x && y && x < 47 && y < 47 ? 'floor' : 'wall', floorHeight: 0, ceilHeight: 6 };
  return d;
}
function browserEntry(d, direction) {
  const context = { window: { RoomArrival: Arrival, DungeonExits: Exits, HolodekFlags: {},
    _world1Arrival: { direction, fromKey: '0,0,0', at: Date.now() } }, Date, console };
  for (const [begin, end] of [['function world1ArrivalStart(', 'function world1ApplyDatabase('],
    ['function findNearestWalkableStart(', '// Add this helper function if not already present']]) {
    const at = game.indexOf(begin); assert.ok(at >= 0); vm.runInNewContext(game.slice(at, game.indexOf(end, at)), context);
  }
  return context.findNearestWalkableStart(d, context.world1ArrivalStart(d, d.geoKey) || d.start);
}

for (const direction of Object.keys(Arrival.OPPOSITE)) test(`server population and browser arrival agree when travelling ${direction}`, () => {
  const d = dungeon(); d.geoKey = QuestMap.neighbourKey('0,0,0', direction) || '400,300,200';
  const entry = Entry.prepare(d, { fromKey: '0,0,0', input: direction, flags: {} });
  const client = structuredClone(d), result = browserEntry(client, direction);
  assert.deepEqual(result, d.start); assert.deepEqual(entry.start, d.start);
  assert.deepEqual(d._world1Start, { x: 24, y: 36 });
  const p = I.createPopulation(d.geoKey, [{ name: 'Ilyra Voss', allegiance: 'Neutral' }], { indoor: false });
  p.questIntroduction = { status: 'pending', speaker: 'Ilyra Voss' };
  I.place(p, d); const guide = p.actors['Ilyra Voss']; assert.ok(guide.position);
  assert.ok(I.dialogueReach(d, { ...guide, type: 'monster', hp: 20, mazeX: guide.position.x, mazeY: guide.position.y,
    mazeRoomKey: d.geoKey }, { x: result.x + .5, y: result.y + .5 }).canSpeak);
});

test('an isolated generated start is resolved to the same connected terrain before the guide is placed', () => {
  const d = dungeon(); d.start = { x: 4, y: 4 };
  for (let y = 1; y < 12; y++) for (let x = 1; x < 12; x++) if (x !== 4 || y !== 4) d.cells[`${x},${y}`].tile = 'wall';
  const entry = Entry.prepare(d, { fromKey: d.geoKey, flags: { ARRIVAL_EDGES: false } });
  assert.notDeepEqual(entry.start, { x: 4, y: 4 });
  assert.deepEqual(Arrival.safeStart(structuredClone(d), entry.start), entry.start);
  const p = I.createPopulation(d.geoKey, [{ name: 'Guide', allegiance: 'Neutral' }], { indoor: false });
  p.questIntroduction = { status: 'pending', speaker: 'Guide' }; I.place(p, d);
  assert.ok(I.dialogueReach(d, { ...p.actors.Guide, type: 'monster', hp: 20, mazeX: p.actors.Guide.position.x,
    mazeY: p.actors.Guide.position.y, mazeRoomKey: d.geoKey }, { x: d.start.x + .5, y: d.start.y + .5 }).canSpeak);
});

test('a saved resident is never teleported to follow a different return-gate arrival', () => {
  const d = dungeon(), p = I.createPopulation(d.geoKey, [{ name: 'Guide', allegiance: 'Neutral' }], { indoor: false });
  Entry.prepare(d, { fromKey: '0,0,0', input: 'north', flags: {} }); I.place(p, d);
  const before = JSON.stringify(p.actors.Guide.position);
  Entry.prepare(d, { fromKey: '1,1,0', input: 'west', flags: {} }); I.place(p, d);
  assert.equal(JSON.stringify(p.actors.Guide.position), before);
});

test('all fresh and cached production entries resolve arrival before population and narration', () => {
  const source = fs.readFileSync(path.join(root, 'retort/retortWithUserInput.js'), 'utf8');
  const fresh = source.indexOf('if (enteringRoom) RoomEntry.prepare(dungeon');
  const cached = source.indexOf('RoomEntry.prepare(cached');
  const population = source.indexOf('// Narration runs only after placement');
  assert.ok(fresh >= 0 && cached > fresh && population > cached);
  assert.ok(source.indexOf('const finalDungeon = finalizeRoomDungeon', fresh) < population);
  assert.match(source, /requiresNearby: true/);
});
