'use strict';
// End to end through the real Retort hazard route: real sharedState, ActionDice, CombatLife and processGameUpdate.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const root = path.resolve(__dirname, '..');
test('a failed bridge crossing through the real route lowers party HP and returns a result the client applies', async t => {
  const worker = new Worker(`
    const {parentPort}=require('node:worker_threads'),path=require('node:path');
    process.env.OPENAI_API_KEY='offline-test-not-a-credential';
    const root=${JSON.stringify(root)};
    const transport=require(path.join(root,'retort/modelTransport'));
    transport.complete=async()=>{throw Error('offline');};transport.stream=async function*(){throw Error('offline');};
    const state=require(path.join(root,'sharedState'));
    const H=require(path.join(root,'retort/roomHazards')),I=require(path.join(root,'assets/dungeonInhabitants'));
    const {formatStartingCharacterSheet:sheet}=require(path.join(root,'retort/initialGameState'));
    const {actionDice}=require(path.join(root,'retort/actionDice'));
    const geoKey='0,1,0',size=40,d={geoKey,layout:{width:size,height:size},generation:{seed:'route'},start:{x:5,y:20},cells:{},tiles:{},sceneObjects:[],
      classification:{indoor:true},_geometryStamp:'s0',sceneSpec:{indoor:true,source:{roomName:'Court',description:'A narrow plank bridge spans a chasm.'}}};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[x+','+y]={tile:x<2||y<2||x>=size-2||y>=size-2?'wall':'floor',floorHeight:0,ceilHeight:4};
    H.install(d,{text:d.sceneSpec.source.description});
    const h=d.roomHazards.hazards[0],k=h.keys[0],[x,y]=k.split(',').map(Number),end=h.ends[0].split(',').map(Number);
    const text='Room Name: Court\\nCoordinates: X: 0, Y: 1, Z: 0\\nInventory: Empty\\nInventory Properties: None\\nPC:\\n'+
      sheet({Name:'Mortacia',Class:'Necromancer',Level:5,HP:139,MaxHP:139,AC:12},6,'pc')+'\\nNPCs in Party:\\n'+
      sheet({Name:'Orren',Class:'Fighter',Level:2,HP:40,MaxHP:40,AC:12},6,'npc')+'\\nMonsters in Room: None\\nMonsters Equipped Properties: None';
    state.setLastCoords({x:0,y:1,z:0});state.setUpdatedGameConsole(text);
    state.setRoomNameDatabase(JSON.stringify({[geoKey]:{name:'Court',objects:[],exits:{}}}));
    state.setCombatCharactersString(JSON.stringify([{name:'Mortacia',type:'pc',hp:139,maxHp:139,mazeX:x,mazeY:y,mazeRoomKey:geoKey,mazePoint:{x:x+.5,y:y+.5}},
      {name:'Orren',type:'npc',hp:40,maxHp:40,mazeX:5,mazeY:20,mazeRoomKey:geoKey}]));
    state.setRoomDungeon({x:0,y:1,z:0},d,[]);
    actionDice.random=()=>2;
    const R=require(path.join(root,'retort/retortWithUserInput'));
    const events=[];
    // Any live call registers the walking route; this one stops offline right away.
    R.retortWithUserInput('look',e=>events.push(e),false,{}).catch(()=>{});
    R.resolveRoomHazard({kind:'enter',hazardId:h.id,actor:'Mortacia',to:{x:x+.5,y:y+.5},from:{x:end[0],y:end[1]}}).then(result=>{
      parentPort.postMessage({result:{...result,updatedGameConsole:result.updatedGameConsole},console:state.getUpdatedGameConsole(),run:state.getDungeonRunId(),
        roster:JSON.parse(state.getCombatCharactersString()),roomKey:I.roomKey(result.updatedGameConsole.match(/^Coordinates:\\s*(.*)$/m)?.[1]),
        cells:events.filter(e=>e.type==='dungeonCellUpdate').map(e=>({dice:e.hazardEvent.dice,effects:e.hazardEvent.effects}))});
    },e=>parentPort.postMessage({error:e.stack}));
  `, { eval: true, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume(); t.after(() => worker.terminate());
  const out = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    const timer = setTimeout(() => reject(Error('hazard route timed out')), 20000); timer.unref();
  });
  assert.equal(out.error, undefined, out.error);
  const r = out.result, dmg = r.damage.Mortacia;
  assert.ok(dmg >= 2 && dmg <= 12, '2d6 fall damage');
  assert.match(out.console, new RegExp(`HP: ${139 - dmg}\\b`), 'the live console sheet lost the fall damage');
  assert.equal(out.roster.find(a => a.name === 'Mortacia').hp, 139 - dmg, 'portrait roster HP matches');
  // The client accepts realtime results only with these fields (applyRealtimeCombatResult in game.js).
  assert.equal(typeof r.eventId, 'string'); assert.equal(r.runId, out.run); assert.equal(r.geoKey, '0,1,0'); assert.equal(out.roomKey, '0,1,0');
  assert.equal(r.type, 'hazard_result'); assert.equal(r.passive, true); assert.match(r.content, /plunges/);
  assert.equal(r.dice.natural, 2); assert.equal(r.dice.success, false); assert.equal(r.dice.actor, 'Mortacia');
  assert.ok(out.cells[0]?.effects?.some(e => e.type === 'fall' && e.depth >= 12), 'deep fall effect for the camera');
  assert.ok(r.relocate.Mortacia, 'climbs back to the rim');
});
