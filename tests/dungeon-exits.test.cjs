const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../assets/dungeonExits');
const Compass = require('../assets/compassUi');
function room() {
  const d = { layout: { width: 32, height: 32 }, start: { x: 16, y: 16 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) d.cells[`${x},${y}`] = { tile: x === 0 || y === 0 || x === 31 || y === 31 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  return d;
}
test('all console directions have reachable distinct markers without carving geometry or inventing exits', () => {
  const d = room(), old = JSON.stringify(Object.entries(d.cells).map(([k, c]) => [k, c.tile, c.floorHeight, c.ceilHeight]));
  const directions = Object.keys(E.LABELS), result = E.install(d, directions);
  assert.equal(result.status, 'built'); assert.equal(result.markers.length, 10);
  assert.equal(new Set(result.markers.map(m => m.key)).size, 10);
  for (const m of result.markers) {
    assert.equal(d.cells[m.key].tile, 'floor');
    assert.equal(E.nearby(d, { x: m.x + 0.5, y: m.y + 0.5 }).direction, m.direction);
  }
  assert.equal(JSON.stringify(Object.entries(d.cells).map(([k, c]) => [k, c.tile, c.floorHeight, c.ceilHeight])), old);
  assert.equal(E.install(d, directions), result);
  assert.deepEqual(E.normalize('n, east, SW, up, None, nonsense, n'), ['north', 'east', 'southwest', 'up']);
});
test('architectural doorway and elevated stair endpoint are reused; nearby checks reject walls and wrong elevations', () => {
  const d = room(); d.cells['22,16'].complexExit = 'east';
  for (let x = 17; x <= 22; x++) d.cells[`${x},20`].floorHeight = (x - 16) * 0.5;
  d.cells['22,20'].complexExit = 'up';
  const result = E.install(d, ['east', 'up']);
  assert.equal(result.markers.find(m => m.direction === 'east').key, '22,16');
  assert.equal(result.markers.find(m => m.direction === 'up').key, '22,20');
  assert.equal(E.nearby(d, { x: 22.5, y: 19.5 }), null, 'Do not prompt from below the landing');
  d.cells['21,16'].tile = 'wall';
  assert.equal(E.nearby(d, { x: 21.2, y: 16.5 }), null, 'Do not prompt through a wall');
});
test('newly revealed or removed exits update markers without accumulating structural parts', () => {
  const d = room(); E.install(d, ['north']);
  E.install(d, ['north', 'east']); assert.equal(d.roomExits.markers.length, 2);
  E.install(d, ['east']); assert.equal(d.sceneStructures.filter(p => p.role === 'journey-exit-marker').length, 1);
  assert.equal(d.roomExits.markers[0].direction, 'east');
});
test('compass matches engine coordinates and arbitrary multi-turn facing angles', () => {
  assert.equal(Compass.heading(-Math.PI / 2).label, 'N');
  assert.equal(Compass.heading(0).label, 'E');
  assert.equal(Compass.heading(Math.PI / 2).label, 'S');
  assert.equal(Compass.heading(Math.PI).label, 'W');
  assert.equal(Compass.heading(-Math.PI / 4).label, 'NE');
  assert.ok(Math.abs(Compass.heading(10 * Math.PI).degrees - 90) < 0.0001);
});
test('production proximity UI reuses the original exit handler and suppresses duplicate listeners/prompts', () => {
  const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  assert.match(source, /contentDiv\.removeEventListener\('click', contentDiv\._exitClickHandler\)/);
  assert.match(source, /link\.click\(\)/);
  assert.match(source, /dungeonExitPromptKey = key/);
  assert.match(source, /drawDungeonExitMapMarkers\(this, this\._lastDungeonDraw\)/);
  assert.match(source, /window\.DungeonCompass\?\.update\(playerAngle\)/);
});
