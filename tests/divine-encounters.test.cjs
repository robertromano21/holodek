'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../retort/divineEncounters'), P = require('../assets/pantheonCharacters');
const I = require('../assets/dungeonInhabitants'), E = require('../retort/economy'), C = require('../retort/campaignSetting');
const S = require('../retort/questScenes'), Q = require('../retort/questProgress'), Give = require('../retort/itemTransfer');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const inhabitantReply = require('./fixtures/inhabitants.cjs');
const { batchRows } = require('./fixtures/inhabitant-batch.cjs');
const { createPopulationService } = require('../retort/roomPopulation');
const { formatStartingCharacterSheet } = require('../retort/initialGameState');
const row = (name, hp = 20, allegiance = 'Neutral') => formatStartingCharacterSheet({ Name: name, Race: 'Human',
  Class: 'Cleric', Sex: 'Female', Level: 2, AC: 10, HP: hp, MaxHP: 20 }, 6, 'npc').replace('State: Friendly', 'State: ' + allegiance);
function population(key, names = ['Custodian']) {
  const pop = I.createPopulation(key, names.map(name => ({ name, race: 'Human', className: 'Cleric', allegiance: 'Neutral', encounterId: name })));
  for (const a of Object.values(pop.actors)) { a.hp = 20; a.sheet = row(a.name); a.position = a.home = { x: 5, y: 4 }; }
  pop.initialSheets = Object.values(pop.actors).map(a => a.sheet).join('\n');
  pop.groups.forEach(g => g.site = { x: 5, y: 4 });
  return pop;
}
function room(key, name = 'Amber Well Guild Hall') {
  const pop = population(key);
  return { name, populationComplete: true, objects: [], inhabitants: pop, monsters: { inRoom: pop.initialSheets },
    campaignSetting: { regionId: 'test-region', communityId: 'test-community', siteKind: 'guildhall', inhabited: true,
      faction: { id: 'wellkeepers', name: 'Cistern Compact', patron: 'Dyanetzia', allegiance: 'Neutral', rival: 'tollwardens' },
      religion: { patron: 'Dyanetzia' }, hostilePatron: 'Arithus' } };
}
function fixture(name = 'Atinus', pcName = 'Suzerain') {
  const key = '1,0,0', db = { '0,0,0': { name: 'Ruined Temple Entrance' }, [key]: room(key), '2,0,0': room('2,0,0', 'Flint Well Archive') };
  let data = db, text = '', wire = '[]', sequence = 0;
  const dungeon = { geoKey: key, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [], tiles: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  const state = { getDungeonRunId: () => 'divine-test', getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getGamePaused: () => false,
    getRoomNameDatabase: () => JSON.stringify(data), setRoomNameDatabase: v => data = JSON.parse(v),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: k => data[k]?.inhabitants, setRoomPopulation: (k, p) => { if (data[k]) data[k].inhabitants = p; },
    getRoomDungeonForSimulation: () => dungeon, getRoomDungeon: () => dungeon, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0 };
  const refreshRoster = () => {
    const pop = data[key].inhabitants;
    for (const a of Object.values(pop.actors)) if (a.status === 'present') a.position = a.home = { x: 5, y: 4 };
    text = `Room Name: ${data[key].name}\nCoordinates: X: 1, Y: 0, Z: 0\nSilver Pieces: 0\nCurrent Quest: None\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row(pcName).replace('State: Neutral', 'State: Alive')}\nNPCs in Party: None\nMonsters in Room:\n${Object.values(pop.actors).filter(a => a.status === 'present').map(a => a.sheet).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 2`;
    wire = JSON.stringify([{ name: pcName, type: 'pc', hp: 20, mazeX: 4, mazeY: 4, mazeRoomKey: key },
      ...Object.values(pop.actors).filter(a => a.status === 'present').map(a => ({ name: a.name, type: 'monster', state: a.allegiance, hp: a.hp, mazeX: 5, mazeY: 4, mazeRoomKey: key }))]);
  };
  const install = god => { D.install(data, key, data[key].inhabitants, god, 'divine-test', pcName); refreshRoster(); };
  if (name) install(name); else refreshRoster();
  const service = createPopulationService(state);
  const action = input => E.action(state, service, { runId: 'divine-test', geoKey: key, revision: E.project(state).revision,
    nonce: 'divine-action:' + ++sequence, ...input });
  const carry = item => { text = E.write(E.write(text, 'Inventory', item.name), 'Inventory Properties', JSON.stringify(item)); };
  return { state, key, dungeon, service, install, action, carry, refreshRoster, db: () => data,
    mission: () => Object.values(data[key].minorMissions || {})[0] };
}

test('canonical visitors have deterministic 300-500 HP, correct allegiance, and no recruitment or purses', () => {
  assert.equal(P.name('Artihus'), 'Arithus'); assert.equal(P.name('Dantuea'), 'Dantuea');
  for (const name of P.names.filter(n => !['Arithus', 'Mortacia'].includes(n))) {
    const f = fixture(name), god = f.db()[f.key].inhabitants.actors[name];
    assert.ok(god.hp >= 300 && god.hp <= 500, name); assert.equal(god.maxHp, god.hp);
    assert.equal(god.hp, fixture(name).db()[f.key].inhabitants.actors[name].hp);
    assert.equal(god.allegiance, P.canon(name).allegiance); assert.equal(god.recruitable, false); assert.equal(god.wallet.silver, 0);
    assert.equal(P.canRecruit({ name, state: 'Friendly' }), false);
    assert.match(P.recruitmentRefusal('add ' + name + ' to party'), /will not join/);
    assert.throws(() => D.validateParty(`NPCs in Party:\n${god.sheet}\nMonsters in Room: None`), /cannot be recruited/);
    assert.throws(() => D.validateRoster(JSON.stringify([{ name, type: 'npc', state: 'Friendly' }])), /cannot be recruited/);
    assert.doesNotThrow(() => D.validateRoster(JSON.stringify([{ name, type: 'monster' }, { name: 'Mortacia', type: 'npc' }])));
  }
  assert.equal(P.canRecruit({ name: 'Mortacia' }), true); assert.equal(P.recruitmentRefusal('add Mortacia to party'), null);
  assert.equal(P.recruitmentRefusal('give archive concordance to Atinus'), null);
});

test('Dantuea is recorded as female rather than guessed from her Darkdrake epithet', () => {
  const f = fixture('Dantuea'), deity = f.db()[f.key].inhabitants.actors.Dantuea;
  assert.equal(P.canon('Dantuea (Darkdrake)').sex, 'Female');
  assert.equal(f.db()['0,0,0'].divineCourt.actors.Dantuea.birth.Sex, 'Female');
  assert.equal(I.parseBlocks(deity.sheet)[0].sex, 'Female');
});

test('divine seeding is occasional, once per room, non-root, and reuses one individual per name', () => {
  const db = { '0,0,0': room('0,0,0') };
  assert.equal(D.seedRoom(db, '0,0,0', db['0,0,0'].inhabitants, 'visits'), null);
  for (let n = 1; n <= 100; n++) {
    const key = n + ',0,0'; db[key] = room(key);
    D.seedRoom(db, key, db[key].inhabitants, 'visits');
    const count = db['0,0,0'].divineCourt.appearances.length;
    D.seedRoom(db, key, db[key].inhabitants, 'visits');
    assert.equal(db['0,0,0'].divineCourt.appearances.length, count);
  }
  const book = db['0,0,0'].divineCourt;
  assert.ok(book.appearances.length >= 5 && book.appearances.length < 40);
  assert.ok(book.appearances.some(a => a.visit > 1)); assert.equal(book.actors.Arithus, undefined); assert.equal(book.actors.Mortacia, undefined);
  for (const deity of Object.values(book.actors)) {
    const active = Object.values(db).flatMap(r => Object.values(r.inhabitants?.actors || {})).filter(a => a.name === deity.name && a.status === 'present');
    assert.equal(active.length, 1, deity.name);
  }
});

test('wounds, memory and loose gifts persist across visits; old cached populations and deaths never respawn', () => {
  const f = fixture(), db = f.db(), a = db[f.key].inhabitants.actors.Atinus;
  a.hp = 211; a.inventory = [{ name: 'iron seal', type: 'other', magic: 2 }]; a.memory = { recent: [{ fact: 'Met Suzerain at Amber Well' }] };
  D.capture(db, db[f.key].inhabitants);
  const cached = structuredClone(db[f.key].inhabitants);
  const next = D.install(db, '2,0,0', db['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain');
  assert.equal(next.hp, 211); assert.match(next.sheet, /HP: 211/); assert.equal(next.inventory[0].name, 'iron seal');
  assert.deepEqual(next.memory, a.memory); assert.equal(db[f.key].inhabitants.actors.Atinus.status, 'departed');
  D.reconcile(db, cached); assert.equal(cached.actors.Atinus.status, 'departed');
  assert.equal(cached.groups.find(g => g.members.includes('Atinus')).status, 'exhausted');
  const before = JSON.stringify(next);
  assert.equal(D.install(db, '2,0,0', db['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain'), null);
  assert.equal(JSON.stringify(next), before);
  next.hp = 0; next.status = 'dead'; D.capture(db, db['2,0,0'].inhabitants);
  assert.equal(D.install(db, f.key, db[f.key].inhabitants, 'Atinus', 'divine-test', 'Suzerain'), null);
});

test('an unresolved main quest pins its divine contact until its stored scene is complete', () => {
  const f = fixture(), db = f.db();
  db[f.key].questStories = { obligation: { id: 'obligation', stages: [{ actor: 'Atinus' }] } };
  assert.equal(D.install(db, '2,0,0', db['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain'), null);
  db[f.key].questScenes = { obligation: { completed: true } };
  assert.ok(D.install(db, '2,0,0', db['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain'));
});

test('divine commissions reference actual placed evidence and a mortal custodian, not narration or a floor drop', () => {
  const f = fixture(), mission = f.mission(), item = f.db()[mission.sourceRoomKey].objects.find(o => o.name === mission.item);
  assert.ok(item); assert.match(mission.description, /Flint Well Archive/); assert.equal(mission.recipient, 'Custodian');
  assert.equal(mission.patron, 'Atinus'); assert.equal(E.view(f.state, 'Atinus').divine.visits, 1);
  assert.ok(!f.action({ kind: 'accept-mission', actor: 'Atinus', missionId: mission.id }).error);
  E.refresh(f.state); assert.equal(f.mission().status, 'accepted');
  f.carry(item); assert.ok(!f.action({ kind: 'drop', item: item.name }).error);
  E.refresh(f.state); assert.equal(f.mission().status, 'accepted');
  f.carry(item); const result = Give.give(f.state, f.service, `give ${item.name} to Custodian`);
  assert.match(result.content, /You give/); E.refresh(f.state);
  assert.equal(f.mission().status, 'completed'); assert.ok(f.mission().deliveryReceiptId);
  assert.match(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), /healing potion/);
  const once = E.field(f.state.getUpdatedGameConsole(), 'Inventory'); E.refresh(f.state);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), once); assert.deepEqual(f.mission().escrowItems, []);
  assert.ok(f.db()['0,0,0'].divineCourt.actors.Atinus.completedCommissions.includes(mission.id));
});

test('a deity exchanges only a real stored item, with properties and wounds preserved and replay prevented', () => {
  const f = fixture(), god = f.db()[f.key].inhabitants.actors.Atinus;
  god.inventory = [{ name: 'copper tablet', type: 'other', magic: 3 }]; god.hp -= 27;
  const hp = god.hp; god.sheet = god.sheet.replace(/HP: \d+/, 'HP: ' + hp); f.refreshRoster();
  assert.ok(f.action({ kind: 'receive', actor: 'Atinus', item: 'imaginary key' }).error);
  const request = { kind: 'receive', actor: 'Atinus', item: 'copper tablet', nonce: 'divine-receive:once' };
  assert.ok(!f.action(request).error); assert.equal(f.action(request).duplicate, true);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'copper tablet');
  assert.equal(JSON.parse(E.field(f.state.getUpdatedGameConsole(), 'Inventory Properties')).magic, 3);
  assert.deepEqual(f.db()[f.key].inhabitants.actors.Atinus.inventory, []);
  assert.equal(f.db()['0,0,0'].divineCourt.actors.Atinus.hp, hp);
  assert.ok(f.action({ ...request, nonce: 'divine-receive:again' }).error);
});

test('main-quest stages use a divine contact but never offer recruitment and keep objective verification', () => {
  const f = fixture(), db = f.db(), item = { name: 'archive concordance', type: 'other' };
  db[f.key].objects.push(item);
  const base = Q.compileGeneratedTask({ id: 'divine-main', type: 'Fetch', actionKind: 'take_item',
    requiredElements: [{ type: 'other', name: item.name, placement: f.key }] }, db, f.key);
  const task = S.compile(base, db, f.key);
  assert.equal(task.story.hook.kind, 'npc'); assert.equal(task.story.stages[0].actor, 'Atinus');
  assert.ok(!task.story.stages.flatMap(stage => stage.options || []).some(o => o.action === 'recruit' || o.id === 'invite'));
  assert.ok(S.recruitmentGuard(f.state, 'add Atinus to party'));
  assert.equal(Q.evaluateTaskRequirements(task, { roomKey: f.key, consoleText: f.state.getUpdatedGameConsole(), database: db }).progress.eligible, false);
});

test('Arithus is reserved for a verified final throne-room boss stage, has 500 HP, and does not reset', () => {
  const f = fixture(null), db = f.db(); db[f.key].name = 'Throne Room of Hades';
  const final = f.state.getUpdatedGameConsole() + '\nArtifacts Found: 14/15\nQuests Achieved: 20/21\nNext Boss: Arithus\nBoss Room Coordinates: X: 1, Y: 0, Z: 0';
  for (const text of [final.replace('20/21', '1/21'), final.replace('14/15', '1/15'), final.replace('Next Boss: Arithus', 'Next Boss: Sentinel')]) {
    assert.equal(D.finalBoss(f.state, text), text); assert.equal(db['0,0,0'].divineCourt?.actors.Arithus, undefined);
  }
  db[f.key].name = 'Arithus Temple'; assert.equal(D.finalBoss(f.state, final), final);
  assert.equal(D.install(db, f.key, db[f.key].inhabitants, 'Arithus', 'divine-test', 'Suzerain', final), null);
  assert.equal(D.install(db, f.key, db[f.key].inhabitants, 'Artihus', 'divine-test', 'Suzerain', final), null);
  db[f.key].name = 'Throne Room of Hades'; const result = D.finalBoss(f.state, final);
  assert.equal(I.parseSheets(result).filter(a => a.name === 'Arithus').length, 1);
  assert.equal(I.parseSheets(result).find(a => a.name === 'Arithus').hp, 500);
  const current = f.db(); current[f.key].inhabitants.actors.Arithus.hp = 91; D.capture(current, current[f.key].inhabitants);
  const wounded = D.finalBoss(f.state, result); assert.equal(I.parseSheets(wounded).find(a => a.name === 'Arithus').hp, 91);
  assert.equal(f.db()['0,0,0'].divineCourt.actors.Arithus.visits, 1);
});

test('authoritative patronage is preserved, divine facts cannot be removed, and party sheets reject god recruitment', () => {
  const f = fixture(), incoming = structuredClone(f.db());
  delete incoming[f.key].inhabitants.actors.Atinus; incoming[f.key].inhabitants.groups = [];
  delete incoming['0,0,0'].divineCourt; incoming[f.key].campaignSetting.religion.patron = 'Rama';
  const saved = JSON.parse(E.preserve(f.state.getRoomNameDatabase(), JSON.stringify(incoming)));
  assert.ok(saved['0,0,0'].divineCourt.actors.Atinus); assert.ok(saved[f.key].inhabitants.actors.Atinus);
  assert.equal(saved[f.key].campaignSetting.religion.patron, 'Dyanetzia');
  const text = f.state.getUpdatedGameConsole().replace('NPCs in Party: None', 'NPCs in Party:\n' + row('Atinus', 20, 'Friendly'));
  assert.throws(() => E.preserveInventory(f.state.getUpdatedGameConsole(), text), /cannot be recruited/);
  E.refresh(f.state); assert.match(f.state.getUpdatedGameConsole(), /^Patronage:.*Dyanetzia/m);
});

test('Arithus temples generate hostile cults, never services; neutral temples keep neutral paid healers', async () => {
  const evil = { ...room('1,0,0').campaignSetting, siteKind: 'roman_temple', faction: { id: 'tollwardens', name: 'Occupied Wardens', rival: 'wellkeepers', allegiance: 'Hostile' }, religion: { patron: 'Arithus' } };
  const friendly = { ...evil, faction: { ...evil.faction, allegiance: 'Neutral' }, religion: { patron: 'Rama' } };
  const rules = { level: () => 2, random: () => 5, sex: () => 'Female', xp: () => 100, equipment: async () => null };
  for (const [setting, hostile] of [[evil, true], [friendly, false]]) {
    const $ = { user: async () => {}, assistant: { generation: async options => ({ content: JSON.stringify({ inhabitants:
      batchRows(inhabitantReply(8, Array.from({ length: 8 }, (_, slot) => ({ slot, name: 'Priest ' + slot, allegiance: 'Friendly' }))), options) }) }) } };
    const r = await generateInhabitants($, { geoKey: '1,0,0', roomName: 'Occupied Temple', indoor: true,
      campaignSetting: setting, quest: 'Recover a record', questSeed: true }, rules);
    assert.equal(Object.values(r.population.actors).some(a => P.name(a.name)), false);
    const db = { '0,0,0': {}, '1,0,0': { ...room('1,0,0', 'Occupied Temple'), campaignSetting: setting, inhabitants: r.population } };
    E.seedRoom(db, '1,0,0', r.population, 'temple-test');
    if (hostile) {
      assert.ok(Object.values(r.population.actors).every(a => a.allegiance === 'Hostile' && a.patron === 'Arithus'));
      assert.equal(db['1,0,0'].services, undefined); assert.equal(r.population.questIntroduction, undefined);
    } else { assert.equal(Object.values(db['1,0,0'].services)[0].kind, 'temple'); }
  }
  for (const patron of C.EVIL_PATRONS) assert.equal(C.hostileTemple({ ...evil, religion: { patron } }), true);
});

test('Atinus can commission an actual Arithus-temple raid, proved by every bound defender HP, with one escrow payment', () => {
  const f = fixture(null), temple = f.db()['2,0,0'];
  temple.name = 'Flint Well Temple of Arithus'; temple.campaignSetting.siteKind = 'roman_temple'; temple.campaignSetting.religion.patron = 'Arithus';
  temple.monsters.inRoom = row('Oath Guard', 20, 'Hostile') + '\n' + row('Cult Priest', 20, 'Hostile');
  temple.inhabitants = population('2,0,0', ['Oath Guard', 'Cult Priest']);
  for (const a of Object.values(temple.inhabitants.actors)) { a.allegiance = 'Hostile'; a.sheet = row(a.name, 20, 'Hostile'); }
  f.install('Atinus'); const mission = f.mission(); assert.equal(mission.type, 'raid');
  assert.deepEqual(mission.targets, ['Oath Guard', 'Cult Priest']); assert.equal(mission.item, undefined);
  assert.ok(require('../retort/hostilePursuit').protectedNames(f.state).has('Oath Guard'));
  assert.ok(S.recruitmentGuard(f.state, 'add Oath Guard to party'));
  assert.match(mission.description, /Flint Well Temple of Arithus/); assert.equal(f.db()['0,0,0'].divineCourt.actors.Arithus, undefined);
  assert.ok(!f.action({ kind: 'accept-mission', actor: 'Atinus', missionId: mission.id }).error);
  E.refresh(f.state); assert.equal(f.mission().status, 'accepted');
  const target = f.db()['2,0,0']; target.monsters.inRoom = target.monsters.inRoom.replace('HP: 20', 'HP: 0');
  E.refresh(f.state); assert.equal(f.mission().status, 'accepted');
  f.db()['2,0,0'].monsters.inRoom = row('Oath Guard', 0, 'Hostile') + '\n' + row('Cult Priest', -1, 'Hostile');
  E.refresh(f.state); assert.equal(f.mission().status, 'completed'); assert.equal(f.mission().completionEvidence.length, 2);
  assert.equal(f.db()['2,0,0'].templeSuppression.missionId, mission.id);
  assert.equal(require('../retort/hostilePursuit').protectedNames(f.state).has('Oath Guard'), false);
  assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'healing potion 10 hp');
  E.refresh(f.state); assert.equal(E.field(f.state.getUpdatedGameConsole(), 'Inventory'), 'healing potion 10 hp');
});

test('room-spawn biographies develop only narrative fields through the existing session and persist on later visits', async () => {
  const f = fixture(), history = 'Atinus refused tribute from a victorious garrison after its captain abandoned the wounded. He still weighs duty against obedience.';
  const messages = []; let requests = 0;
  const $ = { user: async (parts, ...values) => messages.push(Array.isArray(parts) ? parts.reduce((s, part, i) => s + part + (values[i] ?? ''), '') : parts), assistant: { generation: async () => {
    requests++; return { content: JSON.stringify({ deities: [{ name: 'Atinus', history, personality: 'Exacting, impatient with cheap bravery.',
      voice: 'Short battlefield questions.', motivation: 'Test whether Suzerain protects those who cannot fight.',
      dialogue: ['Duty has brought you far. What has it cost?', 'An old captain taught me to distrust easy victories.', 'Who will guard the wounded while you advance?'],
      hp: 1, allegiance: 'Friendly', inventory: [{ name: 'free boss key' }] }] }) };
  } } };
  const hp = f.db()[f.key].inhabitants.actors.Atinus.hp;
  await D.developBiographies($, f.state, f.key);
  const book = f.db()['0,0,0'].divineCourt.actors.Atinus, actor = f.db()[f.key].inhabitants.actors.Atinus;
  assert.match(messages[0], /system prompt is authoritative canon/); assert.equal(requests, 1);
  assert.equal(actor.history, history); assert.equal(actor.profile.history, history); assert.equal(actor.memory.profile.history, history);
  assert.equal(actor.hp, hp); assert.equal(actor.allegiance, 'Neutral'); assert.equal(actor.inventory, undefined);
  const forged = structuredClone(f.db()); forged[f.key].inhabitants.actors.Atinus.history = 'A rewritten identity';
  assert.equal(JSON.parse(E.preserve(f.state.getRoomNameDatabase(), JSON.stringify(forged)))[f.key].inhabitants.actors.Atinus.history, history);
  assert.equal(book.biography.source, 'llm-divine-biography-v1'); assert.match(D.prompt(f.state, ['Atinus']), /refused tribute/);
  actor.memory.recent = [{ fact: 'Suzerain returned the muster record' }]; D.capture(f.db(), f.db()[f.key].inhabitants);
  await D.developBiographies($, f.state, f.key); assert.equal(requests, 1);
  const moved = D.install(f.db(), '2,0,0', f.db()['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain');
  await D.developBiographies($, f.state, '2,0,0'); assert.equal(requests, 1);
  assert.equal(moved.history, history); assert.deepEqual(moved.memory.recent, actor.memory.recent);
  assert.doesNotMatch(D.prompt(f.state, []), /refused tribute/);
});

test('invalid biographies keep canonical fallback and cannot consume stats, duplicate names or forged inventory', async () => {
  for (const response of ['not JSON', JSON.stringify({ deities: [{ name: 'Different God', history: 'Forged' }] }),
    JSON.stringify({ deities: [{ name: 'Atinus', history: 'One' }, { name: 'Atinus', history: 'Two' }] })]) {
    const f = fixture(), before = f.db()[f.key].inhabitants.actors.Atinus.history;
    await D.developBiographies({ user: async () => {}, assistant: { generation: async () => ({ content: response }) } }, f.state, f.key);
    assert.equal(f.db()[f.key].inhabitants.actors.Atinus.history, before);
    assert.equal(f.db()['0,0,0'].divineCourt.actors.Atinus.biography.source, 'canonical-divine-fallback-v1');
  }
});

test('a returning patron can accept an earlier room commission without moving its custodian or escrow', () => {
  const f = fixture(), mission = f.mission();
  D.install(f.db(), '2,0,0', f.db()['2,0,0'].inhabitants, 'Atinus', 'divine-test', 'Suzerain');
  f.dungeon.geoKey = '2,0,0';
  f.state.getLastCoords = () => ({ x: 2, y: 0, z: 0 });
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Coordinates: X: 1', 'Coordinates: X: 2'));
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster.forEach(a => a.mazeRoomKey = '2,0,0');
  f.state.setCombatCharactersString(JSON.stringify(roster));
  const view = E.view(f.state, 'Atinus'); assert.equal(view.error, undefined); assert.equal(view.missions[0].id, mission.id);
  const result = E.action(f.state, f.service, { kind: 'accept-mission', actor: 'Atinus', missionId: mission.id,
    runId: 'divine-test', geoKey: '2,0,0', revision: E.project(f.state).revision, nonce: 'returning-patron:accept' });
  assert.equal(result.error, undefined); assert.equal(f.db()['1,0,0'].minorMissions[mission.id].status, 'accepted');
  assert.equal(f.db()['1,0,0'].minorMissions[mission.id].recipient, 'Custodian');
  assert.equal(f.db()['2,0,0'].minorMissions, undefined);
});

test('Atinus offers distinct Arithus and Dantuea raids to Mortacia, Suzerain and mortal PCs, without summoning their patrons', () => {
  for (const pcName of ['Mortacia', 'Suzerain', 'Benedict']) {
    const f = fixture(null, pcName);
    for (const [key, patron] of [['2,0,0', 'Arithus'], ['3,0,0', 'Dantuea']]) {
      const temple = f.db()[key] ||= room(key); temple.name = 'Occupied Temple of ' + patron;
      temple.campaignSetting.siteKind = 'roman_temple'; temple.campaignSetting.religion.patron = patron;
      temple.monsters.inRoom = row('Cult priest of ' + patron, 20, 'Hostile');
    }
    f.install('Atinus');
    const missions = Object.values(f.db()[f.key].minorMissions);
    assert.equal(missions.length, 2, pcName); assert.deepEqual(missions.map(m => m.enemyPatron), ['Arithus', 'Dantuea']);
    assert.equal(new Set(missions.map(m => m.id)).size, 2); assert.ok(missions.every(m => m.type === 'raid'));
    for (const mission of missions) assert.ok(!f.action({ kind: 'accept-mission', actor: 'Atinus', missionId: mission.id }).error);
    assert.ok(Object.values(f.db()[f.key].minorMissions).every(m => m.status === 'accepted'));
    assert.equal(f.db()['0,0,0'].divineCourt.actors.Arithus, undefined);
    assert.equal(f.db()['0,0,0'].divineCourt.actors.Dantuea, undefined);
    assert.match(D.prompt(f.state, ['Atinus']), /Occupied Temple of Arithus/);
    assert.match(D.prompt(f.state, ['Atinus']), /Occupied Temple of Dantuea/);
  }
});
