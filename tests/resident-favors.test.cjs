'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../retort/economy'), R = require('../assets/economyRules'), I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const Give = require('../retort/itemTransfer');
const { createPopulationService } = require('../retort/roomPopulation');
const Puzzles = require('../assets/physicalPuzzles');
function fixture() {
  const geoKey = '1,0,0', d = { geoKey, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [], tiles: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  const row = (name, hp = 12) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: hp, MaxHP: 20 }, 6, name === 'Benedict' ? 'pc' : 'npc');
  const p = I.createPopulation(geoKey, [{ name: 'Vyth Aerir', race: 'Human', className: 'Cleric', allegiance: 'Neutral', job: 'toll-keeper', encounterId: 'keeper' }]);
  Object.assign(p.actors['Vyth Aerir'], { hp: 12, position: { x: 5, y: 4 }, home: { x: 5, y: 4 }, sheet: row('Vyth Aerir') });
  p.groups[0].site = { x: 5, y: 4 };
  let text = `Room Name: Pale Wind Approach\nCoordinates: X: 1, Y: 0, Z: 0\nSilver Pieces: 0\nCurrent Quest: None\nQuest Progress: None\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Benedict')}\nNPCs in Party:\n${row('Ally')}\nMonsters in Room:\n${row('Vyth Aerir').replace('State: Friendly', 'State: Neutral')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`;
  let wire = JSON.stringify([{ name: 'Benedict', type: 'pc', hp: 12, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey },
    { name: 'Ally', type: 'npc', hp: 12, mazeX: 4, mazeY: 5, mazeRoomKey: geoKey },
    { name: 'Vyth Aerir', type: 'monster', hp: 12, state: 'Neutral', mazeX: 5, mazeY: 4, mazeRoomKey: geoKey }]);
  let db = JSON.stringify({ '0,0,0': {}, [geoKey]: { name: 'Pale Wind Approach', objects: [], inhabitants: p, monsters: { inRoom: row('Vyth Aerir') } } });
  let paused = false;
  const state = { getDungeonRunId: () => 'test-run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: k => k === geoKey ? p : null, setRoomPopulation: (k, value) => { if (k === geoKey && value !== p) Object.assign(p, value); },
    getRoomDungeonForSimulation: () => d, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
    getGamePaused: () => paused };
  const service = createPopulationService(state);
  E.start(state, { Name: 'Benedict' }, [{ Name: 'Ally' }, { Name: 'Mortacia' }]);
  let seq = 0;
  const objectView = { names: [], camera: { x: 4.5, y: 4.5, eyeZ: .65, dirX: 0, dirY: 1, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } };
  const action = input => E.action(state, service, { runId: 'test-run', geoKey, revision: E.project(state).revision, nonce: 'test-action:' + ++seq,
    objectView: { ...objectView, names: d.sceneObjects.map(o => o.name) }, ...input });
  const change = fn => { const data = JSON.parse(db); fn(data); db = JSON.stringify(data); };
  const inventory = (item, count = 1) => { text = E.write(E.write(text, 'Inventory', Array(count).fill(item.name).join(', ')), 'Inventory Properties', JSON.stringify(item)); };
  const business = kind => { change(data => data[geoKey].services = { shop: { id: 'shop', kind, operator: 'Vyth Aerir', originalOperator: 'Vyth Aerir', stock: [{ ...R.healingPotion(6), quantity: 2 }], stockAuthorship:{version:1,status:'ready'}, till: 12, revision: 0 } }); };
  return { state, service, action, change, inventory, business, p, d, row, book: () => E.project(state), pause: () => paused = true, db: () => JSON.parse(db) };
}

const F=require('../retort/residentFavors');
const author=async()=>({title:'Study the Hollow Wind',objectiveId:'survey',focus:'the wind at the bright stones',offer:'Help me watch the wind from these stones, then report your observations. Once my work is finished, I will join you if you invite me.'});
async function offer(f,write=author){f.p.actors['Vyth Aerir'].encounteredAt=1;f.p.actors['Vyth Aerir'].job='wind observer';f.p.actors['Vyth Aerir'].activity='studies skipping pebbles and wind by the bright stones';return F.prepare(f.state,null,'ask monsters about the wind and ask how we can help',{audibleNames:['Vyth Aerir'],population:f.p,author:write});}
const mission=f=>Object.values(f.db()['1,0,0'].minorMissions||{})[0];
const tick=(f,n)=>f.change(db=>{db['0,0,0'].spellSystem={...db['0,0,0'].spellSystem,runId:'test-run',clock:n};});

test('the logged wind/help conversation creates an offered favor tied to the resident, not main-quest progress',async()=>{
  const f=fixture(),before=f.state.getCurrentTasks();
  const offers=await offer(f,async(brief,choices)=>{assert.match(brief,/wind observer/);assert.equal(choices[0].kind,'survey');return author();});
  assert.equal(offers.length,1);assert.equal(mission(f).status,'offered');assert.equal(mission(f).reward.actor,'Vyth Aerir');
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').length,1);
  assert.deepEqual(f.state.getCurrentTasks(),before);
  assert.match(mission(f).description,/observe for Vyth Aerir/);
  assert.equal(E.view(f.state,'Vyth Aerir').missions[0].id,mission(f).id);
  await offer(f);assert.equal(Object.values(f.db()['1,0,0'].minorMissions).length,1,'Repeated help reopens the existing contract');
});

test('accept -> spaced observations -> report -> explicit recruitment preserves the real character and awards once',async()=>{
  const f=fixture();await offer(f);const silver=f.book().silver,sheet=I.parseSheets(f.state.getUpdatedGameConsole())[0];
  assert.match(F.command(f.state,f.service,'add Vyth Aerir to party').content,/conditional/);
  assert.match(F.command(f.state,f.service,'accept favor from Vyth Aerir').content,/accepted/);
  assert.equal(mission(f).status,'accepted');
  assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/not verified/);
  tick(f,1);assert.match(F.command(f.state,f.service,'observe for Vyth Aerir').content,/1\/2/);
  assert.match(F.command(f.state,f.service,'observe for Vyth Aerir').content,/2 more game action/);
  assert.equal(mission(f).observations.length,1);
  tick(f,3);assert.match(F.command(f.state,f.service,'observe for Vyth Aerir').content,/2\/2/);
  assert.equal(mission(f).readyToReport,true);assert.equal(mission(f).status,'accepted');
  assert.match(F.command(f.state,f.service,'report findings to Vyth Aerir').content,/agrees to join/);
  const receipt=mission(f).rewardReceiptId;assert.equal(mission(f).status,'completed');
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').length,1,'Completion never silently recruits');
  const journal=require('../retort/adventureJournal').project(f.state);assert.ok(journal.contracts.some(m=>m.recipient==='Vyth Aerir'&&m.status==='completed'));
  assert.match(F.command(f.state,f.service,'add Vyth Aerir to party').content,/joins the party/);
  const recruited=I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').find(a=>a.name==='Vyth Aerir');
  assert.ok(recruited);for(const property of ['race','className','level','hp','xp'])assert.equal(recruited[property],sheet[property]);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'npc');
  assert.match(F.command(f.state,f.service,'add Vyth Aerir to party').content,/already joined/);
  assert.equal(mission(f).rewardReceiptId,receipt);assert.equal(f.book().silver,silver);
});

test('declining is independent of acceptance and renewed help reoffers the same task',async()=>{
  const f=fixture();await offer(f);const id=mission(f).id;
  assert.match(F.command(f.state,f.service,'decline favor from Vyth Aerir').content,/decline/);
  assert.equal(mission(f).status,'declined');assert.equal(mission(f).acceptedAt,undefined);
  await offer(f);assert.equal(mission(f).status,'offered');assert.equal(mission(f).id,id);
});

test('unseen, distant, hostile and divine residents cannot create recruitment favors',async()=>{
  for(const change of [f=>f.p.actors['Vyth Aerir'].encounteredAt=0,
    f=>{const r=JSON.parse(f.state.getCombatCharactersString());r.find(a=>a.name==='Vyth Aerir').mazeX=I.RESIDENT_CONVERSATION_RANGE+5;f.state.setCombatCharactersString(JSON.stringify(r));},
    f=>{const r=JSON.parse(f.state.getCombatCharactersString());r.find(a=>a.name==='Vyth Aerir').state='Hostile';f.state.setCombatCharactersString(JSON.stringify(r));},
    f=>f.p.actors['Vyth Aerir'].allegiance='Hostile',f=>f.p.actors['Vyth Aerir'].hp=0,
    f=>f.p.actors['Vyth Aerir'].deityId='some-deity',f=>f.p.actors['Vyth Aerir'].recruitable=false]) {
    const f=fixture();f.p.actors['Vyth Aerir'].encounteredAt=1;change(f);let calls=0;
    const offers=await F.prepare(f.state,null,'How can we help?',{audibleNames:['Vyth Aerir'],population:f.p,author:async()=>{calls++;return author();}});
    assert.equal(offers.length,0);assert.equal(calls,0);assert.equal(mission(f),undefined);
  }
});

test('authoring failures and stale generation cannot mint an unverified objective or promise',async()=>{
  const f=fixture();const failed=await offer(f,async()=>({...await author(),objectiveId:'invent a new artifact'}));
  assert.equal(failed.length,0);assert.ok(failed.errors.length);assert.equal(mission(f),undefined);
  const original=f.state.getDungeonRunId;let run='test-run';f.state.getDungeonRunId=()=>run;
  assert.equal((await offer(f,async()=>{run='new-run';return author();})).length,0);
  f.state.getDungeonRunId=original;assert.equal(mission(f),undefined);
});

test('retrieval uses a real unprotected item and an actual handoff after acceptance, not claims or old receipts',async()=>{
  const f=fixture();f.change(db=>db['1,0,0'].objects=[{name:'wind measuring ribbon',type:'other',magic:0},{name:'quest key',type:'key'}]);
  const offers=await offer(f,async(brief,choices)=>{assert.ok(!choices.some(c=>c.item==='quest key'));return{...await author(),objectiveId:choices.find(c=>c.item==='wind measuring ribbon').id};});
  assert.equal(offers[0].objective.item,'wind measuring ribbon');F.command(f.state,f.service,'accept favor from Vyth Aerir');
  f.change(db=>{db['1,0,0'].itemTransfers=[{source:'engine-give-item-v1',id:'old',item:'wind measuring ribbon',recipient:'Vyth Aerir',at:1}];});
  assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/not verified/);
  f.inventory({name:'wind measuring ribbon',type:'other',magic:0});
  const handoff=Give.give(f.state,f.service,'give wind measuring ribbon to Vyth Aerir');assert.match(handoff.content,/You give/);
  E.refresh(f.state);assert.equal(mission(f).readyToReport,true);
  assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/completed/);
  assert.equal(mission(f).completionEvidence[0].source,'engine-give-item-v1');
});

test('saved favor progress is preserved against stale client snapshots, and runtime epoch changes do not erase it',async()=>{
  const f=fixture();await offer(f);F.command(f.state,f.service,'accept favor from Vyth Aerir');
  tick(f,1);F.command(f.state,f.service,'observe for Vyth Aerir');const saved=f.state.getRoomNameDatabase();
  const stale=JSON.parse(saved);delete stale['1,0,0'].minorMissions;
  f.state.setRoomNameDatabase(E.preserve(saved,JSON.stringify(stale)));
  assert.equal(mission(f).observations.length,1);
  f.state.getCityFloorEpoch=()=>randomUUID();tick(f,3);
  F.command(f.state,f.service,'observe for Vyth Aerir');assert.equal(mission(f).observations.length,2);
  f.state.getGamePaused=()=>true;assert.match(F.command(f.state,f.service,'report to Vyth Aerir').content,/Resume/);
  assert.equal(mission(f).status,'accepted');
});

test('a main quest-bound resident keeps its original staged recruitment guard',async()=>{
  const f=fixture(),Scenes=require('../retort/questScenes'),original=Scenes.recruitmentGuard;
  Scenes.recruitmentGuard=()=>({actionOnly:true,content:'Existing main quest bargain.'});
  try{assert.equal((await offer(f)).length,0);assert.equal(mission(f),undefined);}finally{Scenes.recruitmentGuard=original;}
});

test('an earned recruit cannot be removed or duplicated by a stale console, population or roster sync',async()=>{
  const f=fixture();await offer(f);F.command(f.state,f.service,'accept favor from Vyth Aerir');
  const staleText=f.state.getUpdatedGameConsole(),staleRoster=f.state.getCombatCharactersString(),staleDB=f.state.getRoomNameDatabase();
  tick(f,1);F.command(f.state,f.service,'observe for Vyth Aerir');tick(f,3);F.command(f.state,f.service,'observe for Vyth Aerir');
  F.command(f.state,f.service,'report to Vyth Aerir');F.command(f.state,f.service,'add Vyth Aerir to party');
  const protectedText=E.preserveInventory(f.state.getUpdatedGameConsole(),staleText,f.state.getRoomNameDatabase());
  assert.equal(I.parseSheets(protectedText).some(a=>a.name==='Vyth Aerir'),false);
  assert.equal(I.parseSheets(protectedText,'NPCs in Party').filter(a=>a.name==='Vyth Aerir').length,1);
  const protectedDB=JSON.parse(E.preserve(f.state.getRoomNameDatabase(),staleDB));assert.equal(protectedDB['1,0,0'].inhabitants.actors['Vyth Aerir'].status,'recruited');
  const roster=JSON.parse(E.preserveFavorRoster(f.state,staleRoster));assert.equal(roster.find(a=>a.name==='Vyth Aerir').type,'npc');
});

test('a dead favor giver fails their own bargain without inventing a replacement recruit',async()=>{
  const f=fixture();await offer(f);F.command(f.state,f.service,'accept favor from Vyth Aerir');
  Object.assign(f.p.actors['Vyth Aerir'],{status:'dead',state:'Dead',hp:0});f.change(db=>db['1,0,0'].inhabitants=f.p);
  const refreshed=E.refresh(f.state);assert.ok(refreshed.notices.some(n=>/has died/.test(n)));
  assert.equal(mission(f).status,'failed');assert.equal(mission(f).recipient,'Vyth Aerir');
  assert.equal(Object.values(f.db()['1,0,0'].inhabitants.actors).length,1);
});

test('the story and live speech receive the same verified contract and cannot replace it with an untracked errand',async()=>{
  const f=fixture();await offer(f);const Work=require('../retort/holodekRoomWork'),Narration=require('../retort/holodekNarration'),original=Work.request,briefs=[];
  Work.request=async(_$,component,_schema,brief)=>{briefs.push({component,brief});return component==='story-scene'?{prose:'The wind combs the bright stones.',speakers:['Vyth Aerir']}:
    component==='npc-live-speech'?{action:'watches a pebble.',line:'Help me make the observations, then report. I will join you when the favor is done and you invite me.',remember:'I offered an observation favor.',recipient:'PC',attention:'addressing'}:{lines:['The wind deserves a second observation.','We have not finished the study yet.']};};
  try{
    await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:'How can we help?',characters:[{name:'Vyth Aerir',job:'wind observer'}],audibleNames:['Vyth Aerir'],requiredSpeakers:['Vyth Aerir'],localFavors:F.context(f.state,['Vyth Aerir']),location:null});
    for(const component of ['story-scene','npc-live-speech'])assert.match(briefs.find(b=>b.component===component).brief,/Study the Hollow Wind/);
    assert.equal(mission(f).status,'offered');
  }finally{Work.request=original;}
});
