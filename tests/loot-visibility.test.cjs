'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Log = require('../assets/gameLogContent'), Objects = require('../assets/objectDiscovery');
const World = require('../assets/worldInteractionUi'), Items = require('../assets/renderSceneItems');
const Puzzles = require('../assets/physicalPuzzles');
function fixture() {
  const dungeon = { geoKey: '0,0,0', cells: {}, tiles: {}, sceneObjects: [{ name: 'hidden key', type: 'key', x: 4, y: 4 }] };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0 };
  const player = { x: 2.5, y: 4.5 }, item = dungeon.sceneObjects[0];
  const camera = { ...player, eyeZ: .65, dirX: 1, dirY: 0, planeScale: .577, verticalScale: 1.73, aspect: 1.8, viewShift: 0 };
  return { dungeon, player, item, camera, view: { camera, names: [item.name] } };
}
test('log projection removes loot lists and properties but keeps narration, outcomes and quest facts', () => {
  const text = 'The guard points toward the shrine.\nCoordinates: X: 0, Y: 0, Z: 0\nObjects in Room: hidden key, sword\nObjects in Room Properties: {name: "hidden key"}\nObjects in Room Remaining: 2\nExits: north\nInventory: maul\nInventory Properties: {name: "maul"}\nTurns: 4\n\nYou give the maul to Edrin.\nQuest Requirements: Retrieve hidden key from Amber Hall.';
  const projected = Log.withoutLootLists(text);
  assert.doesNotMatch(projected, /Objects in Room|Inventory|name:/);
  assert.match(projected, /guard points/); assert.match(projected, /Exits: north/); assert.match(projected, /Turns: 4/);
  assert.match(projected, /You give the maul/); assert.match(projected, /Retrieve hidden key from Amber Hall/);
  const html = text.replace(/\n/g, '<br>');
  assert.equal(Log.withoutLootLists(html), projected.replace(/\n/g, '<br>'));
  assert.equal(Log.withoutLootLists(projected), projected, 'Repeated observers must not change a clean log');
  assert.match(Log.withoutLootLists(text, { inventory: false }), /Inventory: maul/);
  assert.doesNotMatch(Log.withoutLootLists(text, { inventory: false }), /Objects in Room/);
});
test('restored formatted lists and multiline properties are removed without altering stored console data', () => {
  const text = '<b>Inventory:</b> carried sword<br>  old scroll<br>Inventory Properties: [<br>  {"name":"old scroll"}<br>]<br>Turns: 3<br><br>The guard speaks.';
  assert.equal(Log.withoutLootLists(text), 'Turns: 3<br><br>The guard speaks.');
  const html = fs.readFileSync('assets/index.html', 'utf8');
  assert.match(html, /if \(cleanLog !== chatLog.innerHTML\) chatLog.innerHTML = cleanLog/);
  const game = fs.readFileSync('assets/game.js', 'utf8');
  const labels = game.slice(game.indexOf('const includeKeywords ='), game.indexOf('function includeOnlySpecifiedLines'));
  assert.doesNotMatch(labels, /Objects in Room|Inventory/);
});
test('typed take lists are all prevalidated, Take All sees only the current view, not discovery history', () => {
  const f = fixture(), target = { type: 'item', label: f.item.name, item: f.item };
  Objects.reset();
  try {
    Objects.update(f.dungeon, [target], f.camera);
    assert.deepEqual(Objects.takeRequest(f.dungeon, ' Take HIDDEN KEY '), { names: ['hidden key'], all: false });
    assert.ok(Objects.takeRequest(f.dungeon, 'take hidden key, unshown sword').error);
    assert.deepEqual(Objects.takeRequest(f.dungeon, 'collect all').names, ['hidden key']);
    assert.deepEqual(Objects.snapshot(f.dungeon), f.view);
    assert.equal(Objects.snapshot({ geoKey: f.dungeon.geoKey }), null);
    Objects.update(f.dungeon, [], f.camera);
    assert.ok(Objects.hasDiscovered(f.dungeon, f.item.name));
    assert.ok(Objects.takeRequest(f.dungeon, 'take hidden key').error);
    assert.ok(Objects.takeRequest(f.dungeon, 'take all').error);
    assert.ok(Objects.takeRequest(f.dungeon, 'take').error);
  } finally { Objects.reset(); }
});
test('authoritative pickup rejects missing, stale, offscreen and occluded view snapshots', () => {
  const f = fixture();
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), true);
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, null), false);
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, { ...f.view, names: [] }), false);
  for (const change of [{ dirX: -1 }, { dirX: 0, dirY: 1 }, { x: 6.5 }, { eyeZ: 99 }, { planeScale: Infinity }])
    assert.equal(World.itemInView(f.dungeon, f.player, f.item, { ...f.view, camera: { ...f.camera, ...change } }), false);
  f.dungeon.cells['3,4'] = { tile: 'wall', ceilHeight: 3 };
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), false);
  f.dungeon.cells['3,4'] = { tile: 'door', ceilHeight: 3, door: { isOpen: false } };
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), false);
  f.dungeon.cells['3,4'].door.isOpen = true;
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), true);
  f.dungeon.cells['3,4'] = { tile: 'floor', floorHeight: 2 };
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), false);
});

for (const kind of Puzzles.KINDS) test(`${kind}: headless pickup visibility works alongside puzzle controls and plaques`, () => {
  const f = fixture(), suffix = Puzzles.toolbox().mechanics[kind].suffix;
  const definition = Puzzles.compile({ kind, title: 'The Pickup Archive', context: 'A mechanism stands beside the scroll.',
    lore: 'The keeper recorded the old route.',
    controls: ['west', 'east'].map((id, i) => ({ id, label: `${id} ${suffix}`, mark: ['Crown', 'Star'][i],
      options: ['Sun', 'Moon', 'Wave'], initial: 0, goal: i + 1 === 2 ? 0 : 1 })),
    order: ['east', 'west'], ...(kind === 'interlock' ? { couplings: [['west'], ['east']] } : {}) });
  f.dungeon.physicalPuzzle = JSON.parse(JSON.stringify({ definition, state: Puzzles.initialState(definition),
    fixtures: [...definition.controls.map((c, i) => ({ id: c.id, label: c.label, key: `6,${i + 1}`, width: .5, height: .5 })),
      { id: 'plaque', label: 'instruction plaque', key: '6,3', width: .5, height: .5 },
      { id: 'receiver', label: 'receiver', key: '6,4', width: .5, height: .5 }] }));
  const before = JSON.stringify(f.dungeon.physicalPuzzle);
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), true);
  f.dungeon.cells['3,4'] = { tile: 'wall', ceilHeight: 3 };
  assert.equal(World.itemInView(f.dungeon, f.player, f.item, f.view), false);
  assert.equal(JSON.stringify(f.dungeon.physicalPuzzle), before, 'Pickup validation must not advance or alter the puzzle');
});
test('legacy narrative endpoint rejects pickup before starting any generation', async () => {
  const source = fs.readFileSync('server.js', 'utf8'), start = source.indexOf("app.post('/processInput7'");
  const end = source.indexOf('  const taskId = Date.now().toString();', source.indexOf('  const taskId = Date.now().toString();', start) + 1);
  let handler, generationChecks = 0;
  vm.runInNewContext(source.slice(start, end) + '\n});', {
    app: { post: (_path, cb) => handler = cb }, sharedState: { getGamePaused: () => false,
      isCharacterGenerationInProgress: () => { generationChecks++; return false; } }, inputTaskInFlight: false
  });
  for (const userInput of ['take hidden key', 'TAKE ALL', 'pick up hidden key', 'collect all']) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ body: { userInput } }, res);
    assert.equal(res.code, 409); assert.match(res.body.error, /currently shown/);
  }
  assert.equal(generationChecks, 0);
});
test('3D-only item rims increase contrast and size without changing inventory pixels or ground inset', () => {
  for (const name of ['shadow dagger', 'bronze sword', 'old scroll', 'healing potion 3 hp']) {
    const item = { name, type: 'other', magic: 0 }, normal = Items.renderItemPixels(item, { scale: 1 });
    const world = Items.renderItemPixels(item, { scale: 1, world: true });
    assert.equal(world.footInset, normal.footInset);
    let highlights = 0;
    for (let i = 0; i < normal.data.length; i += 4) {
      assert.equal(world.data[i + 3], normal.data[i + 3]);
      if (world.data[i] > normal.data[i] + 100 && world.data[i + 3] === 255) highlights++;
    }
    assert.ok(highlights > 0, name);
    assert.deepEqual(Items.renderItemPixels(item, { scale: 1 }).data, normal.data);
  }
  assert.equal(Items.worldHeight(2), .55); assert.ok(Items.worldHeight(12) > .8); assert.equal(Items.worldHeight(100), .9);
});
