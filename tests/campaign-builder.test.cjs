'use strict';
const assert = require('assert');
const B = require('../retort/campaignBuilder');
const Surprise = require('../retort/surprise');
let n = 0, fail = 0; const t = (name, fn) => { n++; try { fn(); console.log(`ok ${n} - ${name}`); } catch (e) { fail++; console.log(`not ok ${n} - ${name}\n  ${e.message}`); } };

t('placed object uses the real room-object schema and lands in the room database', () => {
  const db = {}; const o = B.placeObject(db, '0,1,0', { name: 'Ash-forged Blade', type: 'weapon', attack: 2, damage: 3, value: 40 }, { position: { x: 4, y: 5 } });
  assert.deepStrictEqual(o.properties, { attack: 2, damage: 3, ac: 0, magic: 0 }); assert.equal(db['0,1,0'].objects[0].name, 'Ash-forged Blade'); assert.deepStrictEqual(o.position, { x: 4, y: 5 });
});
t('give to party edits the console Inventory line (take/equip then use the normal paths)', () => {
  assert.match(B.giveToParty('Coordinates: 0,0,0\nInventory: None\nExits: north', 'Lantern'), /^Inventory: Lantern$/m);
  assert.match(B.giveToParty('Inventory: Rope, Torch', 'Ash-forged Blade'), /^Inventory: Rope, Torch, Ash-forged Blade$/m);
});
t('books: hand-written chapters or generate-on-open; containers hold real objects; duplicate/delete', () => {
  const db = {}; B.placeObject(db, 'k', { name: 'Ledger of Cinders', type: 'book', generateOnOpen: false, author: 'Ilsa Marrow', chapters: [{ title: 'The Gate', text: 'It was shut.' }] });
  assert.equal(db.k.objects[0].bookLore.chapters[0].text, 'It was shut.');
  B.placeObject(db, 'k', { name: 'Tome', type: 'book' }); assert.equal(db.k.objects[1].bookLore.pending, true);
  B.placeObject(db, 'k', { name: 'Iron Chest', type: 'container', contents: [{ name: 'Silver', type: 'coins', value: 30 }] }); assert.equal(db.k.objects[2].contents[0].type, 'coins');
  B.duplicateObject(db, 'k', 2); assert.equal(db.k.objects[3].name, 'Iron Chest (copy)'); B.deleteObject(db, 'k', 3); assert.equal(db.k.objects.length, 3);
});
t('forced surprise: armed ambush gives the monsters ONLY the first turn (surprise.js order + one-shot consume)', () => {
  const enc = B.encounter({ id: 'e1', surprise: 'force', monsters: [{ name: 'Ash Ghoul', level: 2 }], groupSize: 2 });
  const pop = {}; const g = B.injectEncounter(pop, enc, [{ x: 3, y: 3 }, { x: 4, y: 3 }]);
  assert.equal(g.ambush.party, true); assert.equal(pop.actors['Ash Ghoul 1'].status, 'present'); assert.equal(pop.actors['Ash Ghoul 2'].allegiance, 'Hostile');
  Surprise.arm('9,9,9', g.ambush); const info = Surprise.consume('9,9,9'); assert.equal(info.party, true); assert.equal(Surprise.consume('9,9,9'), null, 'one-shot: round 2 rolls normal initiative');
  const order = Surprise.order(['Hero', 'Ash Ghoul 1', 'Mage', 'Ash Ghoul 2'], a => /Ghoul/.test(a)); assert.deepStrictEqual(order, ['Ash Ghoul 1', 'Ash Ghoul 2', 'Hero', 'Mage']);
});
t('surprise never: group carries a non-party ambush so the 60% roll is skipped; default leaves the normal roll', () => {
  const p = {}; assert.equal(B.injectEncounter(p, B.encounter({ id: 'n', surprise: 'never', monsters: [{ name: 'Rat' }] }), []).ambush.party, false);
  assert.equal(B.injectEncounter(p, B.encounter({ id: 'd', monsters: [{ name: 'Bat' }] }), []).ambush, undefined);
});
t('hand-made room: painted grid -> dungeon schema (walls on edges, pillars block, pits sink, exits, lights)', () => {
  const r = B.handRoom({ width: 9, height: 7, cells: { '4,3': { tile: 'pillar' }, '2,2': { tile: 'pit' } }, exits: [{ direction: 'north', kind: 'gate', to: '0,1,0' }], lights: [{ x: 4, y: 2 }] });
  assert.equal(r.cells['0,0'].tile, 'wall'); assert.equal(r.cells['4,3'].tile, 'wall'); assert.equal(r.cells['2,2'].floorHeight, -2); assert.equal(r.exits[0].kind, 'gate'); assert.equal(r.lights.length, 1);
});
t('world JSON round-trip; Play this world installs built rooms and leaves the rest for AI', () => {
  const w = { name: 'Salt Reach', rooms: { '0,0,0': { name: 'Hand Gate', width: 9, height: 9, exits: [{ direction: 'north', to: '0,1,0' }] } }, cities: [{ name: 'Brine', site: '2,3,0' }] };
  const back = B.load(B.save(w)); assert.equal(back.name, 'Salt Reach'); assert.deepStrictEqual(back.rooms, B.world(w).rooms);
  const db = B.seedCampaign({}, back); assert.equal(B.isBuilt(db, '0,0,0'), true); assert.equal(B.isBuilt(db, '0,1,0'), false);
  assert.equal(B.roomModes(db)['0,0,0'], 'hand'); assert.equal(db['0,0,0'].exits.north, '0,1,0');
});
t('undo / redo', () => { const h = B.history(); let s = { a: 1 }; h.push(s); s = { a: 2 }; s = h.undo(s); assert.equal(s.a, 1); s = h.redo(s); assert.equal(s.a, 2); });
t('homebrew lint flags leaked Children of the Grave terms', () => {
  assert.deepStrictEqual(B.lint('Deck 7 of the orbital station hums.'), []);
  assert.deepStrictEqual(B.lint({ t: 'A shrine to Mortacia under the yellow sky of Tartarus, dated 412 S.R.' }).sort(), ['Mortacia', 'Tartarus', '\\bS\\.R\\.'].sort());
});
console.log(`# ${n - fail}/${n} passed`); process.exitCode = fail ? 1 : 0;
