'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('../assets/landmarkCatalog');
const C = require('../assets/dungeonCartography');
const fs = require('node:fs');
const vm = require('node:vm');
function titleFixture() {
  let now = 1000;
  const elements = new Map(), children = [], style = { textContent: '' };
  const element = () => ({ hidden: false, textContent: '', classList: { add() {}, remove() {} },
    setAttribute() {}, append(...values) { children.push(...values); } });
  const root = { dungeonRunId: 'run', gamePaused: false };
  const document = { head: { appendChild() {} }, body: { appendChild(e) { elements.set(e.id, e); } },
    createElement: tag => tag === 'style' ? style : element(), addEventListener: (_name, init) => init() };
  vm.runInNewContext(fs.readFileSync('assets/areaTitleUi.js', 'utf8'), { window: root, document, Date: { now: () => now } });
  return { root, panel: elements.get('dungeon-area-title'), title: children[1], subtitle: children[0], portrait: children[2], advance: ms => { now += ms; } };
}
function dungeon() {
  const cells = {}; for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) cells[`${x},${y}`] = { tile: 'floor' };
  return { geoKey: '1,0,0', layout: { width: 64, height: 64 }, cells, sceneExteriors: { buildings: [
    { targetName: 'Ruined Temple Entrance', doorway: { x: 58, y: 58 } }] }, sceneGeography: { features: [
    { name: "Devil's Mountain", role: 'mountain', center: { x: 48, y: 48 }, approach: { x: 45, y: 45 } }] },
    sceneLandmarks: [{ type: 'altar', label: 'Altar of Lost Names', x: 20, y: 20 }] };
}
test('named major landmarks start known without revealing terrain; smaller discoveries are initially hidden', () => {
  const d = dungeon(), state = C.createAtlas().get(d, 'run'), before = state.count;
  const markers = C.landmarks(d, state);
  assert.deepEqual(markers.map(m => m.label), ['Ruined Temple Entrance', "Devil's Mountain"]);
  assert.equal(state.count, before); assert.equal(C.seen(state, 58 * 64 + 58), false);
  state.knownLandmarks.push(Catalog.catalog(d)[2].id);
  assert.equal(C.landmarks(d, state).length, 3);
  assert.ok(Catalog.catalog(d).every(m => !/\(1,0,0\)|[a-f0-9]{8}/.test(m.label)));
});
test('discovered names and first-approach announcements survive exploration-map persistence', async () => {
  const d = dungeon(), saved = new Map(), options = { save: async (key, value) => saved.set(key, value), load: async key => saved.get(key) };
  const atlas = C.createAtlas(options), state = atlas.get(d, 'run'); await state.ready;
  const id = Catalog.catalog(d)[2].id; state.knownLandmarks.push(id); state.announcedLandmarks.push(id); state.revision++;
  await atlas.flush(state);
  const restored = C.createAtlas(options).get(d, 'run'); await restored.ready;
  assert.ok(restored.loaded); assert.deepEqual(restored.announcedLandmarks, [id]);
  assert.equal(C.landmarks(d, restored).length, 3);
  assert.equal(restored.count, 0);
});
test('fallback landmark names are stable and remain separate from monster and loot identities', () => {
  const d = dungeon(); d.sceneLandmarks[0].label = '';
  const first = Catalog.catalog(d)[2].label;
  assert.equal(Catalog.catalog(JSON.parse(JSON.stringify(d)))[2].label, first);
  assert.ok(!first.includes(d.geoKey)); assert.equal(d.sceneLandmarks[0].label, '');
});

test('room entry announces once per entry, including revisits and a late-arriving room name', () => {
  const f = titleFixture(), ctx = { dungeon: dungeon(), player: { x: 4.5, y: 4.5 } };
  f.root.DungeonAreaTitles.update(ctx); assert.ok(f.panel.hidden);
  ctx.roomName = 'The Echoing Flats'; f.root.DungeonAreaTitles.update(ctx);
  assert.equal(f.title.textContent, 'The Echoing Flats'); assert.equal(f.subtitle.textContent, 'Entering');
  f.advance(5501); f.root.DungeonAreaTitles.update(ctx); assert.ok(f.panel.hidden);
  f.root.DungeonAreaTitles.update({ ...ctx, dungeon: { geoKey: '2,0,0' }, roomName: 'Ruined Temple Entrance' });
  assert.equal(f.title.textContent, 'Ruined Temple Entrance');
  f.root.DungeonAreaTitles.update(ctx); assert.equal(f.title.textContent, 'The Echoing Flats'); assert.equal(f.panel.hidden, false);
});

test('pause freezes title expiry and reset starts a fresh room announcement', () => {
  const f = titleFixture(), ctx = { dungeon: dungeon(), roomName: 'The Echoing Flats', player: { x: 4.5, y: 4.5 } };
  f.root.DungeonAreaTitles.update(ctx); f.advance(2000);
  f.root.gamePaused = true; f.root.DungeonAreaTitles.update(ctx); f.advance(60000); f.root.DungeonAreaTitles.update(ctx);
  assert.equal(f.panel.hidden, false);
  f.root.gamePaused = false; f.root.DungeonAreaTitles.update(ctx); f.advance(3501); f.root.DungeonAreaTitles.update(ctx);
  assert.ok(f.panel.hidden);
  f.root.DungeonAreaTitles.reset(); f.root.DungeonAreaTitles.update(ctx); assert.equal(f.panel.hidden, false);
});

test('first approaches announce a named landmark only once while hover previews remain available', () => {
  const f = titleFixture(), d = dungeon(), announced = new Set(), player = { x: 20.5, y: 20.5 };
  f.root.LandmarkCatalog = Catalog; f.root.DungeonCartography = C;
  f.root.DungeonExplorationMap = { ready: () => true, wasAnnounced: id => announced.has(id),
    markLandmark: (id, first) => { if (first) announced.add(id); } };
  const ctx = { dungeon: d, roomName: 'The Echoing Flats', player };
  f.root.DungeonAreaTitles.update(ctx); f.advance(5501); f.root.DungeonAreaTitles.update(ctx);
  assert.equal(f.title.textContent, 'Altar of Lost Names'); assert.equal(announced.size, 1);
  f.advance(5001); f.root.DungeonAreaTitles.update(ctx); assert.ok(f.panel.hidden);
  f.root.DungeonAreaTitles.preview(Catalog.catalog(d)[0]); assert.equal(f.title.textContent, 'Ruined Temple Entrance');
});

test('encounter discovery uses the exact character name, state and portrait after the entry title', () => {
  const f = titleFixture(), ctx = { dungeon: dungeon(), roomName: 'The Echoing Flats', player: { x: 4.5, y: 4.5 } };
  f.root.DungeonAreaTitles.update(ctx);
  f.root.DungeonAreaTitles.encounter({ name: 'Seer of the Ashes', allegiance: 'Friendly', sprite: { dataUrl: 'data:image/png;base64,portrait' } });
  f.advance(5501); f.root.DungeonAreaTitles.update(ctx);
  assert.equal(f.title.textContent, 'Seer of the Ashes'); assert.equal(f.subtitle.textContent, 'Encounter Discovered - Friendly');
  assert.equal(f.panel.hidden, false);
  assert.equal(f.portrait.src, 'data:image/png;base64,portrait'); assert.equal(f.portrait.hidden, false);
});

test('nearby landmarks cannot crowd an encountered character out of the notice queue', () => {
  const f = titleFixture(), d = dungeon(), announced = new Set();
  f.root.LandmarkCatalog = { catalog: () => Array.from({ length: 6 }, (_, i) => ({ id: `landmark-${i}`, label: `Landmark ${i}`, x: 4.5, y: 4.5 })) };
  f.root.DungeonCartography = C;
  f.root.DungeonExplorationMap = { ready: () => true, wasAnnounced: id => announced.has(id), markLandmark: id => announced.add(id) };
  const ctx = { dungeon: d, roomName: 'The Echoing Flats', player: { x: 4.5, y: 4.5 } };
  f.root.DungeonAreaTitles.update(ctx);
  f.root.DungeonAreaTitles.encounter({ name: 'Seer of the Ashes', state: 'Neutral' });
  f.advance(5501); f.root.DungeonAreaTitles.update(ctx);
  for (let i = 0; i < 6; i++) { f.advance(5001); f.root.DungeonAreaTitles.update(ctx); }
  assert.equal(f.title.textContent, 'Seer of the Ashes'); assert.equal(f.portrait.hidden, false);
  assert.ok(f.portrait.src.startsWith('data:image/svg+xml,'));
});
