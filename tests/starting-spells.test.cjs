'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../retort/spellSystem'), C = require('../retort/classMagic'), Book = require('../retort/partySpellbook');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
function fixture(className, level = 1) {
  let text = `Coordinates: X: 0, Y: 0, Z: 0\nInventory: Empty\nInventory Properties: None\nMonsters Equipped Properties: None\nParty Equipped Properties: None\nPC:\n${sheet({ Name: 'Caster', Class: className, Level: level, HP: 20, MaxHP: 20, Magic: className.includes('Goddess') ? 5 : S.Rules.classes[className].pointsPerLevel }, 6, 'pc')}\nNPCs in Party: None\nMonsters in Room: None`;
  let db = JSON.stringify({ '0,0,0': {} }), roster = JSON.stringify([{ name: 'Caster', type: 'pc', mazeX: 1, mazeY: 1, mazeRoomKey: '0,0,0', hp: 20 }]);
  const dungeon = { geoKey: '0,0,0', cells: {} }; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor' };
  const state = { getDungeonRunId: () => 'starter-run', getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v, getLastCoords: () => ({ x: 0, y: 0, z: 0 }),
    getRoomDungeonForSimulation: () => dungeon, getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v };
  const pool = () => JSON.parse(db)['0,0,0'].spellSystem;
  return { state, pool, alter(fn) { const data = JSON.parse(db); fn(data['0,0,0'].spellSystem); db = JSON.stringify(data); } };
}
for (const className of Object.keys(S.Rules.classes)) test(`${className} can choose basic spells immediately without consuming any scroll`, () => {
  const f = fixture(className, className.includes('Goddess') ? 50 : 1);
  S.synchronize(f.state); const c = f.pool().casters.Caster;
  const choices = Book.project(f.state).casters[0].groups.filter(g => g.level === 1).flatMap(g => g.spells);
  assert.ok(choices.length >= 2); assert.ok(choices.every(s => s.status === 'Not prepared'));
  const ids = choices.slice(0, c.settings.slots).map(s => s.id);
  assert.equal(C.action(f.state, { runId: 'starter-run', geoKey: '0,0,0', caster: 'Caster', kind: 'prepare', spellIds: ids, revision: f.pool().revision }).error, undefined);
  const ready = Book.project(f.state).casters[0].groups.flatMap(g => g.spells).filter(s => s.status === 'Prepared');
  assert.equal(ready.length, ids.length); assert.ok(ready.every(s => s.casts >= 1));
  assert.equal(f.pool().casters.Caster.remaining, c.remaining, 'Choosing spells does not spend class Magic');
  assert.equal(S.Rules.casterLevel(className, c.level), 1);
  if (c.settings.spellbook) {
    assert.ok(S.field(f.state.getUpdatedGameConsole(), 'Inventory').includes(c.bookName));
    assert.deepEqual(f.pool().casters.Caster.known, C.starterSpells(c.settings));
  } else assert.equal(S.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
});
test('empty legacy books receive starter formulas once, without refilling Magic or respawning a discarded book', () => {
  const f = fixture('Assassin-Fighter-Necromancer-Goddess', 50); S.synchronize(f.state);
  f.alter(pool => { const c = pool.casters.Caster; delete c.starterSpellsVersion; c.known = []; c.learned = {}; c.remaining = 1; });
  S.synchronize(f.state); assert.deepEqual(f.pool().casters.Caster.known, ['bone_shard', 'mend', 'ward']);
  assert.equal(f.pool().casters.Caster.remaining, 1);
  f.state.setUpdatedGameConsole(S.write(S.write(f.state.getUpdatedGameConsole(), 'Inventory', 'Empty'), 'Inventory Properties', 'None'));
  S.synchronize(f.state); assert.equal(Book.project(f.state).casters[0].bookPresent, false);
  assert.equal(f.pool().casters.Caster.remaining, 1); assert.equal(S.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'Empty');
  assert.equal(f.pool().casters.Caster.known.length, 3);
});
