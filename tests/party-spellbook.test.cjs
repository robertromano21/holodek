'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Book = require('../retort/partySpellbook'), S = require('../retort/spellSystem');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
function fixture() {
  const row = (Name, Class, Level, type = 'npc') => formatStartingCharacterSheet({ Name, Class, Level, Sex: 'Female', Race: Name === 'Mortacia' ? 'Goddess' : 'Human',
    HP: 30, MaxHP: 30, AC: 10, Attack: 1, Damage: 1, Magic: 2 }, 6, type);
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nInventory: Empty\nInventory Properties: None\nPC:\n${row('Wizard', 'Wizard', 3, 'pc')}\nNPCs in Party:\n${row('Mortacia', 'Assassin-Fighter-Necromancer-Goddess', 50)}\n${row('Weaver', 'Sorcerer', 4)}\n${row('Guard', 'Fighter', 1)}\nMonsters in Room: None\nMonsters Equipped Properties: None\nParty Equipped Properties: None`;
  let database = JSON.stringify({ '0,0,0': {}, '1,0,0': { name: 'Hall' } });
  const state = { getDungeonRunId: () => 'run', getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v };
  S.synchronize(state);
  const alter = fn => { const db = JSON.parse(database); fn(db['0,0,0'].spellSystem); database = JSON.stringify(db); };
  alter(pool => { const wizard = pool.casters.Wizard; wizard.known = ['missile', 'fireball']; wizard.prepared = ['missile']; wizard.remaining = 3;
    const weaver = pool.casters.Weaver; weaver.prepared = ['dawn_mending']; weaver.remaining = 5; });
  return { state, alter, snapshot: () => [text, database] };
}
test('read-only projection includes every party tab, available class spells, exact prepared counts and Mortacia recovery level', () => {
  const f = fixture(), before = f.snapshot();
  f.state.setUpdatedGameConsole = f.state.setRoomNameDatabase = () => { throw Error('Reading may not write state.'); };
  const data = Book.project(f.state); assert.equal(data.runId, 'run'); assert.equal(data.casters.length, 4);
  const wizard = data.casters[0], spells = wizard.groups.flatMap(g => g.spells);
  assert.equal(spells.find(s => s.id === 'missile').casts, 3); assert.equal(spells.find(s => s.id === 'fireball').casts, 0);
  assert.equal(wizard.groups.find(g => g.level === 3).spells[0].name, 'Fireball');
  assert.equal(spells.find(s => s.id === 'force_lance').status, 'Locked');
  const mortacia = data.casters.find(c => c.name === 'Mortacia'); assert.equal(mortacia.level, 50); assert.equal(mortacia.castingLevel, 1);
  assert.equal(data.casters.find(c => c.name === 'Weaver').groups.flatMap(g => g.spells).find(s => s.id === 'dawn_mending').casts, 2);
  assert.deepEqual(data.casters.find(c => c.name === 'Guard').groups, []);
  assert.deepEqual(f.snapshot(), before);
});
test('dead casters, missing books and unprepared entries show zero without spending turns or restoring Magic', () => {
  const f = fixture(); f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Weaver', s => S.stat(s, 'HP', 0)));
  f.state.setUpdatedGameConsole(S.write(f.state.getUpdatedGameConsole(), 'Inventory', 'Empty'));
  const before = f.snapshot(), data = Book.project(f.state);
  assert.ok(data.casters[0].groups.flatMap(g => g.spells).every(s => s.casts === 0)); assert.equal(data.casters[0].bookPresent, false);
  assert.ok(data.casters.find(c => c.name === 'Weaver').groups.flatMap(g => g.spells).every(s => s.casts === 0));
  assert.deepEqual(f.snapshot(), before);
});
test('equipped item counts use that item pool, not class Magic or another party member', () => {
  const f = fixture();
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(), 'Guard', s => s.replace('Weapon: None', 'Weapon: force wand')));
  f.alter(pool => { pool.bindings['Guard:Weapon'] = 'wand'; pool.items.wand = { id: 'wand', name: 'force wand', remaining: 2,
    spells: [S.Rules.classSpell('missile', 1)], status: 'ready' }; });
  const guard = Book.project(f.state).casters.find(c => c.name === 'Guard'), spell = guard.groups[0].spells[0];
  assert.equal(spell.casts, 2); assert.equal(spell.source, 'force wand (Weapon)');
  f.alter(pool => pool.items.wand.status = 'ash'); assert.deepEqual(Book.project(f.state).casters.find(c => c.name === 'Guard').groups, []);
});
test('the spellbook endpoint is available during combat and pause, but rejects the wrong campaign', () => {
  const f = fixture(), source = fs.readFileSync('server.js', 'utf8'); let handler;
  vm.runInNewContext(source.slice(source.indexOf("app.post('/spellbook/view',"), source.indexOf("app.post('/quest-scenes/view',")), {
    app: { post: (_url, fn) => handler = fn }, sharedState: f.state, PartySpellbook: Book, console });
  let status = 200, payload;
  const res = { status(v) { status = v; return this; }, json(v) { payload = v; } };
  handler({ body: { runId: 'old' } }, res); assert.equal(status, 409);
  status = 200; handler({ body: { runId: 'run' } }, res); assert.equal(status, 200); assert.equal(payload.casters.length, 4);
});
test('click-to-prepare uses the existing capacity and learning checks and can empty the last slot', () => {
  const f = fixture(), C = require('../retort/classMagic');
  const prepare = ids => C.action(f.state, { runId: 'run', geoKey: '1,0,0', caster: 'Wizard', kind: 'prepare',
    revision: Book.project(f.state).revision, spellIds: ids });
  assert.equal(prepare(['missile', 'rune_shell']).error !== undefined, true, 'unlearned formulas cannot bypass scroll scribing');
  assert.equal(prepare([]).error, undefined);
  assert.equal(Book.project(f.state).casters[0].prepared.length, 0);
  assert.equal(prepare(['missile', 'fireball']).error, undefined);
  assert.deepEqual(Book.project(f.state).casters[0].prepared, ['missile', 'fireball']);
});
