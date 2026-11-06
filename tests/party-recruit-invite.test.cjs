'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const { createPopulationService } = require('../retort/roomPopulation');
const E = require('../retort/economy');
const Invite = require('../retort/partyRecruitInvite');

function fixture(allegiance = 'Neutral') {
  const geoKey = '1,0,0', d = { geoKey, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [], tiles: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  const row = (name, hp = 12) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: hp, MaxHP: 20 }, 6, name === 'Benedict' ? 'pc' : 'npc');
  const p = I.createPopulation(geoKey, [{ name: 'Vyth Aerir', race: 'Human', className: 'Cleric', allegiance, job: 'toll-keeper', encounterId: 'keeper' }]);
  Object.assign(p.actors['Vyth Aerir'], {
    hp: 12, position: { x: 5, y: 4 }, home: { x: 5, y: 4 }, sheet: row('Vyth Aerir'),
    encounteredAt: 1, status: 'present', allegiance, state: allegiance
  });
  p.groups[0].site = { x: 5, y: 4 };
  const monsterState = allegiance === 'Friendly' ? 'Friendly' : allegiance;
  let text = `Room Name: Pale Wind Approach\nCoordinates: X: 1, Y: 0, Z: 0\nSilver Pieces: 0\nCurrent Quest: None\nQuest Progress: None\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Benedict')}\nNPCs in Party:\n${row('Ally')}\nMonsters in Room:\n${row('Vyth Aerir').replace('State: Friendly', 'State: ' + monsterState)}\nMonsters Equipped Properties: None\nMonsters State: ${monsterState}\nRooms Visited: 2`;
  let wire = JSON.stringify([
    { name: 'Benedict', type: 'pc', hp: 12, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey },
    { name: 'Ally', type: 'npc', hp: 12, mazeX: 4, mazeY: 5, mazeRoomKey: geoKey },
    { name: 'Vyth Aerir', type: 'monster', hp: 12, state: monsterState, allegiance, mazeX: 5, mazeY: 4, mazeRoomKey: geoKey }
  ]);
  let db = JSON.stringify({ '0,0,0': {}, [geoKey]: { name: 'Pale Wind Approach', objects: [], inhabitants: p, monsters: { inRoom: row('Vyth Aerir') } } });
  const state = {
    getDungeonRunId: () => 'test-run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: k => k === geoKey ? p : null, setRoomPopulation: (k, value) => { if (k === geoKey && value !== p) Object.assign(p, value); },
    getRoomDungeonForSimulation: () => d, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
    getGamePaused: () => false
  };
  const service = createPopulationService(state);
  E.start(state, { Name: 'Benedict' }, [{ Name: 'Ally' }, { Name: 'Mortacia' }]);
  return { state, service, p, db: () => JSON.parse(db), wire: () => JSON.parse(wire) };
}


for(const disposition of ['Friendly','Neutral'])test(disposition+' click compatibility endpoint requires live dialogue; disposition never manufactures consent',()=>{
  const f=fixture(disposition),before=[f.state.getUpdatedGameConsole(),f.state.getCombatCharactersString(),f.state.getRoomNameDatabase()];
  const result=Invite.invite(f.state,f.service,'Vyth Aerir',{random:()=>{throw Error('No reroll');}});
  assert.equal(result.dialogueRequired,true);assert.equal(result.command,'Ask Vyth Aerir to join my party.');assert.equal(result.joined,undefined);assert.equal(result.attack,undefined);
  assert.deepEqual([f.state.getUpdatedGameConsole(),f.state.getCombatCharactersString(),f.state.getRoomNameDatabase()],before);
});
test('a hostile invitation immediately selects enemy-initiated combat; friendly and neutral invitations do not',()=>{
  for(const disposition of ['Friendly','Neutral','Hostile']){
    const f=fixture(disposition),actor=Invite.hostileInvitation(f.state,'Ask Vyth Aerir to join my party.');
    assert.equal(actor?.name || null,disposition==='Hostile'?'Vyth Aerir':null);
    if(disposition==='Hostile')assert.equal(Invite.invite(f.state,f.service,'Vyth Aerir').attack,true);
  }
  const f=fixture('Hostile');assert.equal(Invite.hostileInvitation(f.state,'Ask Ally to join my party.'),null);
  assert.equal(Invite.hostileInvitation(f.state,'Do not ask Vyth Aerir to join my party.'),null);
  const fs=require('fs'),vm=require('vm'),source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),start=source.indexOf('  const hostileInvitation ='),end=source.indexOf("  let personalNarrative =",start);
  const sandbox={dungeonTestingMode:false,options:{},sharedState:f.state,userInput:'Ask Vyth Aerir to join my party.',console,require:name=>name==='./partyRecruitInvite'?Invite:require(name)};
  vm.runInNewContext(source.slice(start,end),sandbox);assert.equal(sandbox.options.realtimeEncounter,'Vyth Aerir');
  assert.ok(source.includes("handleCombatRound({}, '__ENCOUNTER_DEFENCE__', combatMode)"));
});
test('a saved dialogue refusal blocks the old click endpoint even for a friendly resident',()=>{
  const f=fixture('Friendly'),F=require('../retort/residentFavors'),option=F.dialogueOptions(f.state,['Vyth Aerir'])[0];
  F.applyDialogue(f.state,f.service,{speaker:'Vyth Aerir',recipient:'PC',line:'No. I am staying here.',socialAction:'decline-invitation',playerInvited:true},option);
  const result=Invite.invite(f.state,f.service,'Vyth Aerir');assert.equal(result.rejected,true);assert.match(result.content,/already declined/);
  assert.equal(f.wire().find(a=>a.name==='Vyth Aerir').type,'monster');
});
test('the compatibility route rejects stale runs, rooms and floors before recruitment',()=>{
  const f=fixture('Friendly');let route;Invite.install({post:(url,fn)=>route=fn},f.state,{populationService:f.service});
  for(const body of [{runId:'old',geoKey:'1,0,0'},{runId:'test-run',geoKey:'2,0,0'},{runId:'test-run',geoKey:'1,0,0',floorToken:'old'}]){
    let status=200,result;const res={status:n=>{status=n;return res;},json:x=>result=x};route({body:{name:'Vyth Aerir',...body}},res);
    assert.equal(status,409);assert.match(result.error,/different room or game/);
  }
  assert.equal(f.wire().find(a=>a.name==='Vyth Aerir').type,'monster');
});
