'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants'),Repair=require('../retort/partyCheckpoint');
const sheet=(name,hp=15)=>`${name}\nFemale\nHuman\nFighter\nLevel: 3\nAC: 12\nXP: 4000\nHP: ${hp}\nMaxHP: 18\nEquipped: Weapon: named sword, Armor: None, Shield: None, Other: None\nAttack: 3\nDamage: 2\nArmor: 0\nMagic: 0\nState: ${hp>0?'Friendly':'Dead'}`;
function fixture(){
  const names=['Ally One','Ally Two','Ally Three'],population=I.createPopulation('0,0,0',names.map(name=>({name,allegiance:'Friendly',race:'Human'})));
  for(const name of names)population.actors[name].sheet=sheet(name);
  const room={name:'Opening',inhabitants:structuredClone(population),objects:[{name:'kept weapon',type:'weapon'}]},text=`Room Name: Opening\nCoordinates: X: 0, Y: 0, Z: 0\nInventory: kept shield\nSilver Pieces: 9\nCurrent Quest: Saved Quest\nPC:\n${sheet('Player')}\nNPCs in Party: None\nMonsters in Room:\n${names.map(name=>sheet(name)).join('\n')}\nMonsters Equipped Properties: None\nRooms Visited: 1`;
  return{names,server:{dungeonRunId:'run',lastCoords:{x:0,y:0,z:0},updatedGameConsole:text,roomNameDatabaseString:JSON.stringify({'0,0,0':room}),
    roomPopulations:{'0,0,0':population},combatCharactersString:JSON.stringify([{name:'Player',type:'pc',hp:15},...names.map(name=>({name,type:'npc',hp:15,sprite:{spec:{seed:7}},mazeX:4,mazeY:5}))])},
    browser:{data:{npcs:names.map(Name=>({Name}))}}};
}
test('old saves recover all doubly confirmed companions before console/dock rendering, without changing the checkpoint',()=>{
  const f=fixture(),before=JSON.stringify(f.server),result=Repair.reconcile(f.server,f.browser);
  assert.deepEqual(result.recovered,f.names);assert.deepEqual(I.parseSheets(result.server.updatedGameConsole,'NPCs in Party').map(a=>a.name),f.names);
  assert.equal(I.parseSheets(result.server.updatedGameConsole).length,0);assert.equal(JSON.stringify(f.server),before);
  assert.equal(result.server.combatCharactersString,f.server.combatCharactersString);
  for(const p of [result.server.roomPopulations['0,0,0'],JSON.parse(result.server.roomNameDatabaseString)['0,0,0'].inhabitants])
    assert.ok(Object.values(p.actors).every(a=>a.status==='recruited'));
  assert.match(result.server.updatedGameConsole,/Inventory: kept shield/);assert.match(result.server.updatedGameConsole,/Silver Pieces: 9/);
  assert.match(result.server.updatedGameConsole,/Current Quest: Saved Quest/);assert.match(result.server.updatedGameConsole,/Weapon: named sword/);
  assert.deepEqual(JSON.parse(result.server.roomNameDatabaseString)['0,0,0'].objects,[{name:'kept weapon',type:'weapon'}]);
  const again=Repair.reconcile(result.server,f.browser);assert.equal(again.changed,false);assert.deepEqual(again.server,result.server);
});
test('browser party cache alone, stale roster alone and friendly residents never authorize recovery',()=>{
  for(const mode of ['no-browser','no-roster','bystander']){
    const f=fixture();
    if(mode==='no-browser')f.browser.data.npcs=[];
    else f.server.combatCharactersString=JSON.stringify(JSON.parse(f.server.combatCharactersString).map(a=>a.type==='npc'?{...a,type:'monster'}:a));
    const result=Repair.reconcile(f.server,f.browser);assert.deepEqual(result.recovered,[]);assert.equal(result.changed,false);
  }
});
test('recovery preserves dead companions and refuses missing saved sheets instead of inventing stats',()=>{
  const f=fixture();f.server.updatedGameConsole=f.server.updatedGameConsole.replace(sheet(f.names[0]),sheet(f.names[0],0));
  const roster=JSON.parse(f.server.combatCharactersString);roster[1].hp=0;roster[1].state='Dead';f.server.combatCharactersString=JSON.stringify(roster);
  let result=Repair.reconcile(f.server,f.browser);assert.equal(I.parseSheets(result.server.updatedGameConsole,'NPCs in Party')[0].hp,0);
  const broken=fixture();broken.server.updatedGameConsole=broken.server.updatedGameConsole.replace(sheet(broken.names[0]),'');
  delete broken.server.roomPopulations['0,0,0'].actors[broken.names[0]].sheet;
  const db=JSON.parse(broken.server.roomNameDatabaseString);delete db['0,0,0'].inhabitants.actors[broken.names[0]].sheet;broken.server.roomNameDatabaseString=JSON.stringify(db);
  const before=JSON.stringify(broken.server);assert.throws(()=>Repair.reconcile(broken.server,broken.browser),/no complete character sheet/);
  assert.equal(JSON.stringify(broken.server),before);
});
test('a complete saved browser sheet can recover a companion whose origin room is no longer active',()=>{
  const f=fixture(),name=f.names[0];f.server.updatedGameConsole=f.server.updatedGameConsole.replace(sheet(name),'');
  delete f.server.roomPopulations['0,0,0'].actors[name].sheet;
  const db=JSON.parse(f.server.roomNameDatabaseString);delete db['0,0,0'].inhabitants.actors[name].sheet;f.server.roomNameDatabaseString=JSON.stringify(db);
  Object.assign(f.browser.data.npcs[0],{Sex:'Female',Race:'Human',Class:'Fighter',Level:3,AC:12,XP:4000,HP:15,MaxHP:18,Attack:3,Damage:2,Armor:0,Magic:0,
    Equipped:{Weapon:{name:'named sword'}}});
  const result=Repair.reconcile(f.server,f.browser),member=I.parseSheets(result.server.updatedGameConsole,'NPCs in Party').find(a=>a.name===name);
  assert.equal(member.hp,15);assert.match(member.rawSheet,/Weapon: named sword/);
});
test('host-local floor population is reconciled without turning street residents into party members',()=>{
  const f=fixture(),db=JSON.parse(f.server.roomNameDatabaseString),floor={room:db['0,0,0'],population:f.server.roomPopulations['0,0,0']};
  f.server.activeCityFloor={hostKey:'0,0,0',buildingId:'inn',floor:2};
  db['0,0,0']={name:'Street',inhabitants:{actors:{Stranger:{name:'Stranger',status:'present'}}},cityFloors:{buildings:{inn:{floors:{2:floor}}}}};
  f.server.roomNameDatabaseString=JSON.stringify(db);const result=Repair.reconcile(f.server,f.browser),saved=JSON.parse(result.server.roomNameDatabaseString)['0,0,0'];
  assert.equal(saved.inhabitants.actors.Stranger.status,'present');
  assert.ok(Object.values(saved.cityFloors.buildings.inn.floors[2].population.actors).every(a=>a.status==='recruited'));
});
function client(){
  const f=fixture(),db=new Map(Object.entries(JSON.parse(f.server.roomNameDatabaseString))),sent=[],window={DungeonInhabitants:I,
    combatCharacters:JSON.parse(f.server.combatCharactersString).map(a=>a.type==='npc'?{...a,type:'monster'}:a),GameCommandGate:{end(){}},renderPartyIconDock(){}};
  const source=fs.readFileSync('assets/game.js','utf8'),start=source.indexOf('window.commitLocalPartyChange ='),end=source.indexOf('window.prepareEconomyState =',start);
  const context={window,roomNameDatabase:db,currentDungeon:{geoKey:'0,0,0'},syncGameStateBeforeCommand:async body=>sent.push(body)};
  vm.runInNewContext(source.slice(start,end),context);return{f,window,sent,db,context};
}
test('local party change synchronizes full membership once, preserves appearance and marks resident records recruited',async()=>{
  const c=client(),fixed=Repair.reconcile(c.f.server,c.f.browser).server.updatedGameConsole,sprite=c.window.combatCharacters[1].sprite;
  await c.window.commitLocalPartyChange(fixed);assert.equal(c.sent.length,1);
  assert.deepEqual(I.parseSheets(c.sent[0].updatedGameConsole,'NPCs in Party').map(a=>a.name),c.f.names);
  assert.ok(c.window.combatCharacters.filter(a=>a.name!=='Player').every(a=>a.type==='npc'));
  assert.equal(c.window.combatCharacters[1].sprite,sprite);assert.equal(c.window.lastServerGameConsole,fixed);
  assert.equal(c.window._partyChangeSyncPending,false);assert.ok(c.window._partyInfoNPCString.includes('Ally Three'));
  assert.ok(Object.values(c.db.get('0,0,0').inhabitants.actors).every(a=>a.status==='recruited'));
});
test('removing a companion persists the smaller party and does not resurrect dismissed membership',async()=>{
  const c=client(),p=c.db.get('0,0,0').inhabitants;
  for(const record of Object.values(p.actors))record.status='recruited';
  c.window.combatCharacters.forEach(a=>{if(a.type==='monster')a.type='npc';});
  const text=c.f.server.updatedGameConsole.replace('NPCs in Party: None','NPCs in Party: '+sheet('Ally Two')+'\n'+sheet('Ally Three'))
    .replace(sheet('Ally Two')+'\n'+sheet('Ally Three')+'\nMonsters Equipped Properties: None','Monsters Equipped Properties: None');
  await c.window.commitLocalPartyChange(text);assert.equal(p.actors['Ally One'].status,'present');
  assert.equal(c.window.combatCharacters.find(a=>a.name==='Ally One').type,'monster');
  assert.equal(c.window.combatCharacters.find(a=>a.name==='Ally Two').type,'npc');
});
test('a failed synchronization remains marked pending so Save cannot silently checkpoint a partial party change',async()=>{
  const c=client();c.context.syncGameStateBeforeCommand=async()=>{throw Error('offline');};
  await assert.rejects(c.window.commitLocalPartyChange(c.f.server.updatedGameConsole),/offline/);
  assert.equal(c.window._partyChangeSyncPending,true);
  assert.match(fs.readFileSync('assets/saveGameUi.js','utf8'),/if \(root\._partyChangeSyncPending\) throw Error/);
});
test('Save retries a pending party synchronization before capturing any checkpoint',async()=>{
  const source=fs.readFileSync('assets/saveGameUi.js','utf8'),a=source.indexOf('  async function save('),b=source.indexOf('  function assignObject',a),events=[];
  const root={_partyChangeSyncPending:true,prepareEconomyState:async()=>{events.push('sync');root._partyChangeSyncPending=false;}};
  const end=source.indexOf('  function ',a+20),next=source.indexOf('  async function ',a+20);
  const stop=Math.min(...[b,end,next].filter(n=>n>a));
  const ctx={root,working:false,idle:()=>{events.push('capture-guard');throw Error('stop before checkpoint');}};
  vm.runInNewContext(source.slice(a,stop),ctx);
  await assert.rejects(ctx.save(3,'Retry'),/stop before checkpoint/);assert.deepEqual(events,['sync','capture-guard']);
});
test('both local recruit and remove returns synchronize their console before returning',()=>{
  const source=fs.readFileSync('assets/game.js','utf8');
  for(const [from,to] of [['// Process adding a monster to the party','// Process removing an NPC from the party'],
    ['// Process removing an NPC from the party','// Update the game console based on user inputs and get the updated game console']]){
    const a=source.indexOf(from);assert.ok(source.slice(a,source.indexOf(to,a+from.length)).includes('await window.commitLocalPartyChange(updatedGameConsole)'));
  }
});
