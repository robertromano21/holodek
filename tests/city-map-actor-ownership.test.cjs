'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
function harness() {
  const actors = [{ name: 'Player', type: 'pc' }, { name: 'Ally', type: 'npc' }, { name: 'Resident', type: 'monster' }];
  const visual = () => ({ sprite: { visible: true, setVisible(value) { this.visible = value; } }, label: { setVisible() {} } });
  const scene = { renderRT: {}, _pcTokenComposited: true, pcName: 'Player', characters: Object.fromEntries(actors.map(a => [a.name, visual()])),
    updatePositions() {} };
  const window = { combatCharacters: actors, combatGame: { scene: { getScene: () => scene } } };
  const context = vm.createContext({ window, currentDungeon: { geoKey: 'city', cells: {} }, syncPartyMazeToCombatPositions() {} });
  for (const [start, end] of [['function setCombatPlayerTokenOwner(', 'function ensureCombatTextureForCharacter('],
    ['function setCombatVisualOverlayVisible(', 'function syncCombatActorOverlayFromMaze('],
    ['window.applyOutdoorDiscoveries = ', 'window.refreshDungeonConsoleStates = ']]) {
    vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context);
  }
  return { context, window, scene };
}
test('outdoor discovery cannot re-enable duplicate Phaser actors over the composited maze map', () => {
  const { window, scene } = harness();
  for (let i = 0; i < 4; i++) {
    window.applyOutdoorDiscoveries({ geoKey: 'city', travelDiscovery: true, actors: { Resident: { discoveryState: 'known' } } });
    for (const [name, visual] of Object.entries(scene.characters)) assert.equal(visual.sprite.visible, false, name);
  }
});
test('roster visibility updates keep the texture as sole owner even before a deferred map redraw', () => {
  const { context, scene } = harness();
  context.scene = scene; context.visual = scene.characters.Resident;
  vm.runInContext('setCombatVisualOverlayVisible(visual, true, scene)', context);
  assert.equal(context.visual.sprite.visible, false);
  vm.runInContext('setCombatVisualOverlayVisible(visual, false, scene)', context);
  assert.equal(context.visual.sprite.visible, false);
});
test('non-maze fallback sprites remain usable and pending discoveries stay hidden', () => {
  const { context, scene } = harness(); context.scene = scene; context.visual = scene.characters.Resident;
  vm.runInContext('currentDungeon = null; setCombatVisualOverlayVisible(visual, true, scene)', context);
  assert.equal(context.visual.sprite.visible, true);
  vm.runInContext('setCombatVisualOverlayVisible(visual, false, scene)', context);
  assert.equal(context.visual.sprite.visible, false);
});
test('the PC fallback token stays visible until it has actually been composited', () => {
  const { window, scene } = harness(); scene._pcTokenComposited = false;
  window.applyOutdoorDiscoveries({ geoKey: 'city', travelDiscovery: true, actors: {} });
  assert.equal(scene.characters.Player.sprite.visible, true);
  assert.equal(scene.characters.Ally.sprite.visible, false);
});
test('every roster and discovery visibility path uses the shared owner, not direct sprite re-enabling', () => {
  assert.match(source, /setCombatVisualOverlayVisible\(this\.characters\[character\.name\], character\.discoveryState !== 'pending', this\)/);
  assert.match(source, /setCombatVisualOverlayVisible\(charData, character\.discoveryState !== 'pending', this\)/);
  const discoveries = source.slice(source.indexOf('window.applyOutdoorDiscoveries = '), source.indexOf('window.refreshDungeonConsoleStates = '));
  assert.doesNotMatch(discoveries, /visual\.sprite\?\.setVisible/);
});
