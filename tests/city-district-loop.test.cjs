'use strict';
for (const f of ['CITY_SITES', 'CITY_COMPLETE', 'ARCHITECTURE_EXPANSION', 'GENRE_EXPANSION', 'GENRE_LIGHTS', 'HOMEBREW']) process.env['HOLODEK_' + f] = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const Interiors = require('../retort/cityInteriors'), Floors = require('../retort/cityTowerFloors'), E = require('../retort/economy');
const Desks = require('../retort/cityVenueServices'), Commissions = require('../retort/cityCommissions'), Delivery = require('../retort/deliveryMissions');
const Give = require('../retort/itemTransfer'), I = require('../assets/dungeonInhabitants'), Indoor = require('../retort/indoorBlueprint');
const Setting = require('../retort/settingLayer'), Work = require('../retort/holodekRoomWork');
const sheet = require('../retort/initialGameState').formatStartingCharacterSheet;
const genres = Object.keys(require('../assets/cityEstablishments').NAMES);
const brief = { title: 'The Apprentices Exhibition', purpose: 'Carry the guild invitation to the local archive so its staff can attend the public exhibition.',
  parcelDescription: 'A sealed invitation with the guild seal and the archive clerk as addressee.' };
function fixture(genre = null) {
  const site = { id: 'district-city', name: 'Authored City', design: { verticality: {
    lowerUse: 'Lodging and guest rooms', middleUse: 'Guild training and apprentices', upperUse: 'Libraries and archive reading rooms', roofUse: 'Civic observatory'
  }, districts: { guild: { mix: ['inn', 'guild', 'library', 'home'] } } } };
  let db = { '0,0,0': { ...(genre ? { setting: Setting.validateBible(Setting.localBible('An Original World', [genre])) } : {}) },
    '1,0,0': { name: 'Exhibition Street', environmentIntent: { citySite: site }, cityRoom: {
      kind: 'street', cityId: site.id, anchorKey: '1,0,0', district: 'guild', districtName: 'Learning Quarter', cityName: site.name
    } } };
  const build = (id, type, name) => Interiors.connect(db, '1,0,0', { id, type, name, left: 12, top: 12, width: 28, depth: 26, storeys: 10 }, { site, genre: genre || 'dark-fantasy' });
  const first = build('inn-parcel', 'inn', 'Exhibition House'), second = build('archive-parcel', 'library', 'Public Archive');
  const directory = db[first.groundKey].cityRoom.vertical.directory, upper = directory[4].key, inn = first.groundKey, recipientRoom = second.groundKey;
  const pops = {}, dungeons = {}, events = [];
  const row = (name, hp = 12, type = 'npc') => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Fighter', Level: 2, AC: 10, HP: hp, MaxHP: 12, State: 'Neutral' }, 6, type);
  for (const [key, name] of [[inn, 'Host'], [upper, 'Guild Steward'], [recipientRoom, 'Archive Clerk']]) {
    const p = I.createPopulation(key, [{ name, race: 'Human', className: 'Fighter', allegiance: 'Neutral', encounterId: name,
      job: key === inn ? 'inn host' : key === upper ? 'guild steward' : 'archive clerk', venueDuty: 'public counter', routine: 'work' }]);
    Object.assign(p.actors[name], { hp: 12, maxHp: 12, position: { x: 5, y: 4 }, home: { x: 5, y: 4 }, sheet: row(name) });
    p.groups[0].site = { x: 5, y: 4 }; pops[key] = p;
    Object.assign(db[key], { populationComplete: true, visited: true, inhabitants: p, monsters: { inRoom: row(name) },
      campaignSetting: { inhabited: true, communityId: 'city:' + site.id, community: site.name, authority: 'Council',
        faction: { name: 'Local Council', allegiance: 'Neutral' } } });
    Desks.seed(db[key], p, key);
    const d = { geoKey: key, start: { x: 4, y: 4 }, layout: { width: 12, height: 12 }, cells: {}, sceneObjects: [], tiles: {} };
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
    dungeons[key] = d;
  }
  let current = inn, runId = 'district-run', paused = false, text = '', roster = [];
  const move = key => {
    current = key;
    const [x, y, z] = key.split(',');
    const inventory = E.field(text, 'Inventory') || 'Empty', props = E.field(text, 'Inventory Properties') || 'None';
    text = `Room Name: ${db[key].name}\nCoordinates: X: ${x}, Y: ${y}, Z: ${z}\nInventory: ${inventory}\nInventory Properties: ${props}\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Hero', 4, 'pc')}\nNPCs in Party: None\nMonsters in Room:\n${db[key].monsters.inRoom}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 3`;
    roster = [{ name: 'Hero', type: 'pc', hp: 4, mazeX: 4, mazeY: 4, mazeRoomKey: key },
      ...Object.values(pops[key].actors).map(a => ({ name: a.name, type: 'monster', hp: a.hp, state: a.allegiance, mazeX: 5, mazeY: 4, mazeRoomKey: key }))];
  };
  move(inn);
  const state = { getDungeonRunId: () => runId, getGamePaused: () => paused, getLastCoords: () => {
    const [x, y, z] = current.split(',').map(Number); return { x, y, z };
  }, getRoomNameDatabase: () => JSON.stringify(db), setRoomNameDatabase: t => db = JSON.parse(t),
  getUpdatedGameConsole: () => text, setUpdatedGameConsole: t => text = t, getCombatCharactersString: () => JSON.stringify(roster),
  setCombatCharactersString: t => roster = JSON.parse(t), getRoomPopulation: key => pops[key], setRoomPopulation: (key, p) => pops[key] = p,
  getRoomDungeonForSimulation: () => dungeons[current], getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
  emitter: { emit: (name, value) => events.push({ name, value }) } };
  const service = { save: p => { pops[current] = p; db[current].inhabitants = p; } };
  E.start(state, { Name: 'Hero' }, []);
  db['0,0,0'].economy.silver = 12;
  const request = (actor = 'Guild Steward') => ({ runId, geoKey: current, actor });
  const action = (kind, actor, extra = {}) => E.action(state, service, { ...request(actor), kind,
    revision: E.project(state).revision, nonce: `${kind}:district:${actor.replace(/ /g, '-')}`, ...extra });
  return { state, service, first, second, site, directory, inn, upper, recipientRoom, pops, dungeons, events, move, request, action,
    get db() { return db; }, set paused(value) { paused = value; }, set runId(value) { runId = value; } };
}
function runner(hook = () => {}) {
  let calls = 0;
  const agent = { model: 'gpt-6-luna', user: async () => {}, assistant: { generation: async () => { calls++; await hook(); return { content: JSON.stringify(brief) }; } } };
  agent.run = async work => work(agent);
  return { run: async work => work(agent), get calls() { return calls; } };
}

test('street tower floors retain authored band purposes, real footprints and persistent content without eager generation', () => {
  const f = fixture();
  assert.deepEqual(f.directory.map(r => f.db[r.key].cityRoom.establishmentType), ['inn', 'inn', 'inn', 'guild', 'guild', 'guild', 'guild', 'guild', 'library', 'civic']);
  for (const entry of f.directory) {
    const r = f.db[entry.key];
    assert.equal(r.cityRoom.venue.width, 28); assert.equal(r.cityRoom.venue.depth, 26);
    if (entry.floor) assert.equal(r.cityRoom.venue.programUse, entry.use);
    assert.equal(r.dungeon, undefined);
  }
  const saved = f.db[f.upper];
  saved.cityRoom.completion = 1; saved.objects = [{ name: 'saved evidence' }]; saved.inhabitants.actors['Guild Steward'].status = 'departed';
  const before = JSON.stringify(saved);
  Floors.install(f.db, '1,0,0', { groundKey: f.inn, site: f.site });
  assert.equal(JSON.stringify(f.db[f.upper]), before);
  assert.equal(Interiors.connect(f.db, '1,0,0', { id: 'inn-parcel' }, {}).groundKey, f.inn);
});

for (const genre of [null, ...genres]) test((genre || 'CotG') + ' district loop: street, upper guild, authored job, real parcel, payment once and revisit', async () => {
  Setting.setActive(null);
  const f = fixture(genre), r = runner(); f.move(f.upper);
  f.db[f.inn].populationComplete = false;
  const result = await Commissions.request(f.state, f.service, f.request(), { run: r.run });
  assert.equal(r.calls, 1); assert.equal(result.mission.authorship, 'model-authored'); assert.equal(result.mission.title, brief.title);
  const mission = result.mission, before = E.project(f.state).silver;
  assert.equal(mission.recipient, 'Archive Clerk');
  assert.deepEqual(mission.route, ['down', 'down', 'down', 'down', 'south', 'enter Public Archive']);
  assert.equal(f.action('accept-mission', 'Guild Steward', { missionId: mission.id }).error, undefined);
  assert.equal(f.action('accept-mission', 'Guild Steward', { missionId: mission.id }).duplicate, true);
  f.move(f.recipientRoom);
  assert.match(Give.give(f.state, f.service, `give ${mission.item} to Archive Clerk`).content, /You give/);
  E.refresh(f.state); E.refresh(f.state);
  assert.equal(E.project(f.state).silver, before + mission.rewardSilver);
  assert.equal(f.db[f.upper].minorMissions[mission.id].status, 'completed');
  const saved = f.state.getRoomNameDatabase(); f.move(f.upper); f.state.setRoomNameDatabase(saved);
  const revisit = await Commissions.request(f.state, f.service, f.request(), { run: r.run });
  assert.equal(revisit.duplicate, true); assert.equal(r.calls, 1); assert.equal(revisit.mission.status, 'completed');
  assert.equal(f.state.getCurrentTaskIndex(), 0);
  if (genre) assert.doesNotMatch(mission.description + mission.dispatchItem.description, /Tartarus|Mortacia|Arithus|Surface Reckoning/);
});

test('delivery routes include real street doorways but reject forged, locked and hidden destinations', () => {
  const f = fixture();
  assert.deepEqual(Delivery.route(f.db, f.inn, f.recipientRoom), ['south', 'enter Public Archive']);
  f.db[f.recipientRoom].hidden = true; assert.equal(Delivery.route(f.db, f.inn, f.recipientRoom), null);
  delete f.db[f.recipientRoom].hidden;
  f.db[f.recipientRoom].cityRoom.frontage.buildingId = 'not-this-building';
  assert.equal(Delivery.route(f.db, f.inn, f.recipientRoom), null);
  f.db[f.inn].exits.south.status = 'locked'; assert.equal(Delivery.route(f.db, f.inn, '1,0,0'), null);
});

test('inn rest is a receipted party service, not resurrection or a free ability/equipment refill', () => {
  const f = fixture('sci-fi'), before = E.project(f.state).silver;
  assert.ok(E.view(f.state, 'Host').venue.capabilities.includes('lodging'));
  const result = f.action('lodge', 'Host'); assert.equal(result.error, undefined); assert.match(result.content, /2 credits/);
  assert.equal(E.project(f.state).silver, before - 2);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(), 'PC')[0].hp, 12);
  assert.equal(JSON.parse(f.state.getCombatCharactersString())[0].hp, 12);
  assert.equal(f.action('lodge', 'Host').duplicate, true); assert.equal(f.db[f.inn].venueDesk.stays.length, 1);
  assert.match(f.action('lodge', 'Host', { nonce: 'different:lodging' }).error, /No conscious/);
  f.move(f.upper); assert.match(f.action('lodge', 'Guild Steward').error, /does not operate lodging/);
});

test('rest rejects hostile rooms, distant/dead operators, stale/paused games and insufficient funds without charging', () => {
  const cases = [
    f => { const roster = JSON.parse(f.state.getCombatCharactersString()); roster[1].state = 'Hostile'; f.state.setCombatCharactersString(JSON.stringify(roster)); },
    f => { const roster = JSON.parse(f.state.getCombatCharactersString()); roster[1].mazeX = 11; f.state.setCombatCharactersString(JSON.stringify(roster)); },
    f => { f.db[f.inn].inhabitants.actors.Host.status = 'dead'; },
    f => { f.paused = true; },
    f => { f.db['0,0,0'].economy.silver = 0; }
  ];
  for (const change of cases) {
    const f = fixture(); change(f); const before = f.state.getRoomNameDatabase(), text = f.state.getUpdatedGameConsole();
    const result = E.action(f.state, f.service, { ...f.request('Host'), kind: 'lodge', revision: f.db['0,0,0'].economy.revision, nonce: 'invalid:lodging' });
    assert.ok(result.error); assert.equal(f.state.getRoomNameDatabase(), before); assert.equal(f.state.getUpdatedGameConsole(), text);
  }
  const f = fixture(); const text = f.state.getUpdatedGameConsole().replace('HP: 4', 'HP: 0').replace('State: Alive', 'State: Dying');
  f.state.setUpdatedGameConsole(text); assert.match(f.action('lodge', 'Host').error, /No conscious|closer/);
});

test('commission requests coalesce and merge only fresh state; no calls for unavailable or distant work', async () => {
  const f = fixture(), r = runner(() => { f.db['0,0,0'].newIndependentField = 'retained'; }); f.move(f.upper);
  const input = f.request(), first = Commissions.request(f.state, f.service, input, { run: r.run });
  const second = Commissions.request(f.state, f.service, input, { run: r.run }); assert.equal(first, second);
  await first; assert.equal(r.calls, 1); assert.equal(f.db['0,0,0'].newIndependentField, 'retained');
  const unavailable = fixture(); unavailable.move(unavailable.upper);
  for (const [key, room] of Object.entries(unavailable.db)) if (key !== unavailable.upper) room.populationComplete = false;
  await assert.rejects(Commissions.request(unavailable.state, unavailable.service, unavailable.request(), { run: r.run }), /No known/);
  assert.equal(r.calls, 1);
  const roster = JSON.parse(f.state.getCombatCharactersString()); roster[1].mazeX = 11; f.state.setCombatCharactersString(JSON.stringify(roster));
  await assert.rejects(Commissions.request(f.state, f.service, f.request(), { run: r.run }), /closer/); assert.equal(r.calls, 1);
});

test('interrupted generation, changed recipient and malformed prose never install or pay a commission', async () => {
  for (const change of [f => { f.runId = 'new-game'; }, f => { f.paused = true; }, f => { f.db[f.inn].inhabitants.actors.Host.status = 'dead'; }]) {
    const f = fixture(); f.move(f.upper); const r = runner(() => change(f));
    await assert.rejects(Commissions.request(f.state, f.service, f.request(), { run: r.run }), /changed/);
    assert.equal(f.db[f.upper].deliveryMissionId, undefined);
  }
  const f = fixture(); f.move(f.upper);
  await assert.rejects(Commissions.request(f.state, f.service, f.request(), { run: async () => { throw Error('generation interrupted'); } }), /interrupted/);
  assert.equal(f.db[f.upper].minorMissions, undefined);
  assert.throws(() => Commissions.validate({ ...brief, title: '<script>' }), /plain-text/);
  assert.throws(() => Commissions.validate({ ...brief, purpose: 'x'.repeat(301) }), /300/);
});

test('a save restore or setting edit during authorship invalidates the offer even at the same room and run ID', async () => {
  for (const change of [f => { f.state.getRestoreRevision = () => 2; }, f => { f.db['0,0,0'].setting = { kind: 'homebrew', name: 'A different world' }; }]) {
    const f = fixture(); f.move(f.upper); f.state.getRestoreRevision = () => 1;
    await assert.rejects(Commissions.request(f.state, f.service, f.request(), { run: runner(() => change(f)).run }), /changed/);
    assert.equal(f.db[f.upper].deliveryMissionId, undefined);
  }
});

test('desks, stays and authored job receipts survive stale browser snapshots and cannot be invented by the browser', async () => {
  const f = fixture(), before = f.state.getRoomNameDatabase();
  assert.equal(f.action('lodge', 'Host').error, undefined);
  f.move(f.upper); await Commissions.request(f.state, f.service, f.request(), { run: runner().run });
  const protectedState = JSON.parse(E.preserve(f.state.getRoomNameDatabase(), before));
  assert.equal(protectedState[f.inn].venueDesk.stays.length, 1);
  assert.equal(protectedState[f.upper].minorMissions[protectedState[f.upper].deliveryMissionId].authorship, 'model-authored');
  const forged = JSON.parse(before); forged['0,0,0'].venueDesk = { capabilities: ['lodging'], lodgingPrice: -100 };
  assert.equal(JSON.parse(E.preserve(before, JSON.stringify(forged)))['0,0,0'].venueDesk, undefined);
});

test('new venue work and purposes fit the local input/output budget without leaking a foreign campaign', async () => {
  const old = Work.request, captured = [];
  Work.request = async (_$, component, parameters, prompt, validate, local) => { captured.push({ component, parameters, prompt, local }); return validate(brief); };
  try {
    await Commissions.author({}, { sender: 'Local Host', recipient: 'Local Clerk', publicWorld: 'x'.repeat(1700) });
    const call = captured[0], size = require('../retort/holodekWork').estimate(call.parameters, call.prompt), budget = require('../retort/holodekBudget');
    assert.ok(size.input < budget.CEILING); assert.ok(size.output < budget.ANSWER);
    assert.deepEqual(call.local, {}); assert.doesNotMatch(call.prompt, /Tartarus|Mortacia|Grave Master/);
  } finally { Work.request = old; }
});

test('the ordinary economy seeder binds venue staff without authoring an eager job or converting guilds to shops', () => {
  const f = fixture(); f.move(f.upper);
  delete f.db[f.upper].venueDesk;
  E.seedRoom(f.db, f.upper, f.pops[f.upper], 'district', f.state.getUpdatedGameConsole(), { deferCommunity: true });
  assert.equal(f.db[f.upper].venueDesk.operator, 'Guild Steward');
  assert.equal(f.db[f.upper].services, undefined);
  assert.equal(f.db[f.upper].deliveryMissionId, undefined);
  for (let seed = 0; seed < 20; seed++) {
    E.activateRoom(f.db, f.upper, f.pops[f.upper], String(seed), f.state.getUpdatedGameConsole());
    assert.equal(f.db[f.upper].deliveryMissionId, undefined);
    assert.equal(f.db[f.upper].minorMissions, undefined);
  }
});

test('venue controls use the existing guarded transaction popup and asynchronous route without changing window geometry', () => {
  const fs = require('node:fs'), ui = fs.readFileSync('assets/commerceUi.js', 'utf8'), server = fs.readFileSync('server.js', 'utf8');
  assert.match(ui, /Ask About Local Work/); assert.match(ui, /Rest Party/);
  assert.match(ui, /post\('\/city\/commissions\/request'/);
  assert.match(ui, /request\.kind === 'request-commission'/);
  assert.match(server, /app\.post\('\/city\/commissions\/request',async/);
  const route = server.slice(server.indexOf("app.post('/city/commissions/request'"), server.indexOf("app.post('/city/residents/meet'"));
  assert.match(route, /prepareQuestScene\(req\)/); assert.match(route, /inputTaskInFlight=true/); assert.match(route, /finally\{inputTaskInFlight=false/);
  assert.match(route, /passive:true/);
});

test('purpose-specific upper floors use existing furniture, bounded navigation and visible native lights', () => {
  const f = fixture(); Setting.setActive(null);
  for (const floor of [1, 4, 8, 9]) {
    const room = f.db[f.directory[floor].key], venue = room.cityRoom.venue;
    const d = { geoKey: f.directory[floor].key, layout: { width: 96, height: 96 }, start: { x: 48, y: 70 }, cells: {}, tiles: {}, sceneStructures: [],
      generation: { seed: 'district:' + floor }, sceneSpec: { city: { genre: 'dark-fantasy', venue, floorProgram: room.cityRoom.floorProgram } } };
    Indoor.build(d, {}, {});
    assert.ok(d.cityVenue.furnishings > 0); assert.equal(d.cityVenue.type, room.cityRoom.establishmentType);
    assert.ok(d.sceneStructures.some(s => /^city-venue-light/.test(s.role)));
    assert.ok(d.cityVenue.units.length > 0);
    assert.ok(d.indoorRooms.every(r => r.venueUse));
  }
});
