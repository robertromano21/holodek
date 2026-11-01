'use strict';
for(const f of ['GENRE_EXPANSION','ARCHITECTURE_EXPANSION','LIBRARY_BOOKS','CITY_COMPLETE','CITY_SITES'])process.env['HOLODEK_'+f]='1';
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../assets/genreFurnishings'),E=require('../assets/cityEstablishments'),Indoor=require('../retort/indoorBlueprint'),Setting=require('../retort/settingLayer');
const Books=require('../retort/bookLore'),R=require('../assets/readableItems'),Research=require('../retort/bookResearch'),Q=require('../retort/questProgress');
function bookFixture(world=null){
  const name='chronicle of ruined temple entrance',book=R.validate([{kind:'book',name,title:name,backstory:'An unread volume.',role:'lore',chapters:[],bookLore:{pending:true}}])[0];
  let db={'0,0,0':{...(world?{setting:world}:{})},'1,0,0':{name:'Reading Room',readables:[book],objects:[{name,type:'other'}]}};
  const dungeon={geoKey:'1,0,0',cells:{},sceneObjects:[{name,x:3,y:2}]};
  for(let y=0;y<10;y++)for(let x=0;x<10;x++)dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  let runId='books-run',actor={name:'Hero',type:'pc',hp:10,mazeRoomKey:'1,0,0',mazeX:2,mazeY:2};
  const consoleText=`Coordinates: X: 1, Y: 0, Z: 0\nInventory: Empty\nObjects in Room: ${name}\n`;
  const state={getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:t=>db=JSON.parse(t),getDungeonRunId:()=>runId,
    getLastCoords:()=>({x:1,y:0,z:0}),getRoomDungeon:()=>dungeon,getCombatCharactersString:()=>JSON.stringify([actor]),getUpdatedGameConsole:()=>consoleText};
  return{name,book,state,dungeon,actor,consoleText,get db(){return db;},set runId(v){runId=v;}};
}
const cover={title:'Witnesses Under the Dome',author:'Unknown',publishedSR:611,backstory:'A history written by an uncertain witness.',
  contents:['The Lost Assembly','The Masonry Accounts','The Empty Chair','The Returning Witness'],newFacts:[]};
function runner(replies,prompts=[],hook=()=>{}){let calls=0;return{get calls(){return calls;},run:async work=>work({user:t=>prompts.push(String(t)),assistant:{generation:async req=>{
  calls++;hook(req);return{content:JSON.stringify(replies.shift())};}}})};}

test('all genre catalogues include the new bounded voxel silhouettes and human-scaled dimensions',()=>{
  assert.equal(Object.keys(F.SHAPES).length,468);
  for(const genre of Object.keys(F.THEMES))for(const role of F.DETAIL_ROLES){
    const id=`f_${genre}_${role}`,v=F.build(id,16);assert.ok(v.some(Boolean),id);assert.equal(v.length,16**3);
    assert.ok(F.dimensions(id).every(x=>x>0&&x<=4));
  }
  assert.deepEqual(F.dimensions('f_fantasy_seat'),[.75,.75,1.1]);
  assert.notDeepEqual(F.build('f_fantasy_bookshelf',16),F.build('f_fantasy_basin',16));
});
test('empty blueprints stay within real venue envelopes and furnish purpose-specific rooms without blocking navigation',()=>{
  Setting.setActive(null);
  for(const type of ['shop','home','temple','library','inn','workshop','arena']){
    const venue={version:1,id:'venue:'+type,type,...E.profile(type)},d={layout:{width:96,height:96},start:{x:48,y:70},cells:{},tiles:{},sceneStructures:[],
      generation:{seed:type},sceneSpec:{city:{genre:'fantasy',venue}}};
    Indoor.build(d,{},{});const b=d.cityVenueBounds;assert.equal(b.width,venue.width);assert.equal(b.depth,venue.depth);
    const nav=require('../retort/sceneArchitecture'),reach=nav.reachable(nav.makeNavigation(d),d.start);
    for(const [key,c]of Object.entries(d.cells))if(c.tile==='floor'){const [x,y]=key.split(',').map(Number);assert.ok(x>=b.left-1&&x<=b.left+b.width&&y>=b.top-1&&y<=b.top+b.depth,key);assert.ok(reach.seen[y*96+x]);}
    assert.ok(d.cityVenue.furnishings>=3,type);
    for(const part of d.sceneStructures.filter(s=>s.role==='city-venue-furniture')){
      assert.ok(F.has(part.shape));assert.deepEqual([part.size.x,part.size.y,part.size.z],F.dimensions(part.shape).map(x=>x/2.5));
      const c=d.cells[`${Math.floor(part.position.x)},${Math.floor(part.position.y)}`];assert.equal(c.tile,'floor');assert.ok(!c.navigationReserved);
    }
  }
});
test('pending chronicles have no fixed prose; first reading authors metadata and each chapter is generated once',async()=>{
  Setting.setActive(null);const f=bookFixture(),r=runner([{...cover},{text:'A witness recorded the changing customs of this particular community. '.repeat(20),newFacts:[]}]);
  assert.equal(R.hasContent(f.book),false);assert.equal(R.canOpen(f.book),true);
  await Books.ensure(f.state,'read '+f.name,f.consoleText,{run:r.run,client:null});assert.equal(r.calls,1);
  let b=f.db['1,0,0'].readables[0];assert.equal(b.title,cover.title);assert.equal(b.published,'611 S.R.');assert.ok(b.chapters.every(c=>c.text===''));
  await Books.ensure(f.state,'read chapter 2 of '+f.name,f.consoleText,{run:r.run,client:null});assert.equal(r.calls,2);
  const saved=JSON.stringify(f.db);await Books.ensure(f.state,'read chapter 2 of '+f.name,f.consoleText,{run:r.run,client:null});assert.equal(r.calls,2);assert.equal(JSON.stringify(f.db),saved);
  b=f.db['1,0,0'].readables[0];assert.ok(b.chapters[1].text.length>900);assert.equal(b.id,f.book.id);
});
test('genre book generation never imports CotG lore, authors or calendars',async()=>{
  Setting.setActive(null);const f=bookFixture({kind:'homebrew',name:'The Alloy Ring',genres:['sci-fi'],realm:'An orbital habitat.',history:'The Ring was assembled by habitat engineers.'}),prompts=[];
  const r=runner([{...cover,publishedSR:undefined,writtenYear:'118 Ring Calendar'}],prompts);
  await Books.ensure(f.state,'read '+f.name,f.consoleText,{run:r.run,client:null});
  assert.equal(f.db['1,0,0'].readables[0].published,'118 Ring Calendar');
  assert.doesNotMatch(prompts.join('\n'),/Mortacia|Tartarus|Surface Reckoning|Arithus/);
  assert.ok(!Books.knownNames(f.db).has('Mortacia'));
});
test('distant or stale reading cannot spend model calls or overwrite a new game',async()=>{
  Setting.setActive(null);const f=bookFixture(),r=runner([{...cover}]);f.actor.mazeX=9;f.actor.mazeY=9;
  await assert.rejects(Books.ensure(f.state,'read '+f.name,f.consoleText,{run:r.run,client:null}),/closer/);assert.equal(r.calls,0);
  f.actor.mazeX=2;f.actor.mazeY=2;const stale=runner([{...cover}],[],()=>f.runId='different-game');
  await assert.rejects(Books.ensure(f.state,'read '+f.name,f.consoleText,{run:stale.run,client:null}),/game changed/);
  assert.equal(f.db['1,0,0'].readables[0].bookLore.pending,true);
});
test('concurrent opens share the saved cover and never generate a second answer for the same book',async()=>{
  Setting.setActive(null);const f=bookFixture(),r=runner([{...cover}]);
  const results=await Promise.all([Books.ensure(f.state,'read '+f.name,f.consoleText,{run:r.run,client:null}),Books.ensure(f.state,'read '+f.name,f.consoleText,{run:r.run,client:null})]);
  assert.equal(r.calls,1);assert.deepEqual(results.map(r=>r.status),['generated','cached']);
});
test('saved chapters and reading evidence survive a stale model snapshot',()=>{
  Setting.setActive(null);const f=bookFixture();f.db['1,0,0'].readables[0].chapters=[{title:'Account',text:'The saved account.'}];
  f.db['0,0,0'].bookReadings=[{id:'receipt'}];f.db['0,0,0'].bookFacts=[{text:'A saved fact.'}];f.db['1,0,0'].deliveryMissionId='dispatch';
  const incoming={'0,0,0':{},'1,0,0':{name:'Reading Room',readables:[{...f.book,chapters:[{title:'Wrong',text:'A rewritten chapter.'}]}]}};
  const saved=JSON.parse(require('../retort/economy').preserve(JSON.stringify(f.db),JSON.stringify(incoming)));
  assert.equal(saved['1,0,0'].readables[0].chapters[0].text,'The saved account.');assert.equal(saved['0,0,0'].bookReadings[0].id,'receipt');
  assert.equal(saved['0,0,0'].bookFacts[0].text,'A saved fact.');assert.equal(saved['1,0,0'].deliveryMissionId,'dispatch');
});
test('local covers and chapters respect actual joint input/output context reservations without retrieval API calls',async()=>{
  const Models=require('../retort/gameModels'),Host=require('../retort/pcModelHost'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
  const previous=Models.current().id;Models.restore('holodek-1');Setting.setActive(null);let calls=0;
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body),input=Budget.tally(body.messages,[{response_format:body.response_format}]).total;calls++;
    assert.ok(input+body.max_tokens+Budget.SAFETY<=4096);assert.ok(input<=Budget.CEILING);
    const coverRequest=body.response_format.json_schema.schema.properties.title;
    return{ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(coverRequest?cover:{text:'The record describes a particular community and its public customs. '.repeat(20),newFacts:[]})}}]})};
  }});
  const app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}}),f=bookFixture();
  const run=work=>app.run(app.retort(work),null,{shouldSaveToLog:false});
  try{await Books.ensure(f.state,'read '+f.name,f.consoleText,{run,client:null});await Books.ensure(f.state,'read chapter 1 of '+f.name,f.consoleText,{run,client:null});assert.equal(calls,2);}
  finally{Models.restore(previous);}
});
test('book research compiles only real chapters and requires an actual reading receipt, not carrying or opening a book',()=>{
  Setting.setActive(null);const f=bookFixture();f.db['1,0,0'].readables[0].chapters=[{title:'The Evidence',text:'A specific saved witness account.'}];
  delete f.db['1,0,0'].readables[0].bookLore;
  const task=Q.compileGeneratedTask({type:'Research',actionKind:'read_book',requiredElements:[{type:'object',name:f.name,placement:'1,0,0'}]},f.db,'1,0,0');assert.ok(task);
  assert.ok(Q.generatedTaskTypes(task.requiredElements,f.db,'1,0,0').includes('research'));
  const assess=()=>Q.evaluateTaskRequirements(task,{database:f.db,roomKey:'1,0,0',consoleText:'Inventory: '+f.name});
  assert.equal(assess().progress.eligible,false);
  const plan={allowed:true,inspect:true,chapter:1,record:f.db['1,0,0'].readables[0],sourceKey:'1,0,0'};
  assert.equal(Research.record(f.state,plan),false);plan.inspect=false;assert.equal(Research.record(f.state,plan),true);
  assert.equal(Research.record(f.state,plan),false);assert.equal(assess().progress.eligible,true);assert.equal(Q.verifiedTaskCompletion(task,assess()),true);
  f.db['1,0,0'].readables[0].chapters[0].text='Different text';assert.equal(assess().progress.eligible,false);
  assert.ok(Research.seeds(f.db).length>0);assert.equal(Q.compileGeneratedTask({...task,requiredElements:[{type:'object',name:'invented book',placement:'1,0,0'}]},f.db,'1,0,0'),null);
});
test('ambient venue purposes cover work, visitors and errands without inventing payable contracts',()=>{
  const A=require('../retort/cityActivities');
  for(const type of E.TYPES){const rows=[0,1,2].map(i=>A.assignment(type,i,type+i,{id:'real-venue',name:'Authored Venue'}));
    assert.deepEqual(rows.map(r=>r.mode),['work','visit','errand']);assert.equal(new Set(rows.map(r=>r.activity)).size,3);
    assert.ok(rows.every(r=>r.venueId==='real-venue'&&r.activity&&!r.rewardSilver));}
});
test('research can require reading a distant book and returning to a living contact for explicit completion',()=>{
  Setting.setActive(null);const f=bookFixture(),S=require('../retort/questScenes'),I=require('../assets/dungeonInhabitants');
  const book=f.db['1,0,0'].readables[0];book.chapters=[{title:'A Witness Account',text:'An account with information for the archivist.'}];book.bookLore={version:2};
  const sheet=name=>`${name}\nFemale\nHuman\nArchivist\nLevel: 2\nAC: 10\nXP: 0\nHP: 12\nMaxHP: 12\nEquipped: Weapon: None, Armor: None, Shield: None, Other: None\nAttack: 0\nDamage: 0\nArmor: 0\nMagic: 0\nState: Neutral`;
  const p=I.createPopulation('2,0,0',[{name:'Archivist',race:'Human',className:'Archivist',allegiance:'Neutral',encounterId:'archivist'}]);
  Object.assign(p.actors.Archivist,{hp:12,position:{x:3,y:2},home:{x:3,y:2},sheet:sheet('Archivist')});p.groups[0].site={x:3,y:2};
  f.db['2,0,0']={name:'Records Office',objects:[],inhabitants:p,monsters:{inRoom:sheet('Archivist'),state:'Neutral'}};
  const base=Q.compileGeneratedTask({id:'research-return',type:'Research',actionKind:'read_book',requiredElements:[{type:'object',name:f.name,placement:'1,0,0'},
    {type:'monster',name:'Archivist',placement:'2,0,0'}]},f.db,'2,0,0');assert.ok(base);
  let tasks=[S.compile(base,f.db,'2,0,0',{hookKind:'npc'})],index=0,current='2,0,0';assert.ok(tasks[0].story);
  const s=f.state;let text;
  const roster=()=>[{...f.actor,mazeRoomKey:current},{name:'Archivist',type:'monster',hp:12,state:'Neutral',mazeRoomKey:'2,0,0',mazeX:3,mazeY:2}];
  const setPlace=k=>{current=k;text=`Current Quest: Research\nQuest Progress: Pending\nCoordinates: X: ${k[0]}, Y: 0, Z: 0\nInventory: Empty\nInventory Properties: None\nObjects in Room: ${f.name}\nPC:\n${sheet('Hero')}\nNPCs in Party: None\nMonsters in Room:\n${k==='2,0,0'?sheet('Archivist'):'None'}\nMonsters State: Neutral\nRooms Visited: 3`;};setPlace(current);
  Object.assign(s,{getLastCoords:()=>({x:Number(current[0]),y:0,z:0}),getUpdatedGameConsole:()=>text,setUpdatedGameConsole:t=>text=t,
    getCombatCharactersString:()=>JSON.stringify(roster()),setCombatCharactersString(){},getRoomDungeon:()=>({...f.dungeon,geoKey:current,start:{x:2,y:2}}),
    getRoomPopulation:k=>f.db[k]?.inhabitants,getCurrentTasks:()=>tasks,setCurrentTasks:t=>tasks=t,getCurrentTaskIndex:()=>index,setCurrentTaskIndex:i=>index=i,setQuestSeeded(){}});
  const choose=id=>{const scene=S.view(s).scene;return S.choose(s,{save(){}},{runId:s.getDungeonRunId(),geoKey:current,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId:id});};
  assert.equal(choose('accept').error,undefined);assert.equal(S.view(s).scene.stageId,'objective');
  setPlace('1,0,0');const plan=require('../retort/readableActions').prepare({input:'read chapter 1 of '+f.name,consoleText:text,database:f.db,dungeon:f.dungeon,actor:roster()[0],geoKey:current});
  assert.equal(plan.allowed,true);Research.record(s,plan);S.refresh(s);assert.equal(index,0,'Reading does not grant a completed report');
  setPlace('2,0,0');assert.equal(S.view(s).scene.stageId,'resolution');assert.equal(choose('finish').error,undefined);
  assert.equal(index,1);assert.equal(tasks[0].status,'Completed');assert.equal(S.isComplete(tasks[0],f.db),true);
});
test('outbound dispatches bind to real living recipients along usable routes and seed once without editing the destination',()=>{
  const D=require('../retort/deliveryMissions'),person=name=>({name,allegiance:'Neutral',status:'present',hp:12,dialogue:[]});
  const p={actors:{Sender:person('Sender')}},target={name:'Command Hall',populationComplete:true,campaignSetting:{communityId:'city'},inhabitants:{actors:{General:person('General')}}};
  const db={'0,0,0':{},'1,0,0':{name:'Guild Hall',campaignSetting:{inhabited:true,communityId:'city'},inhabitants:p,exits:{east:{status:'open',targetCoordinates:'2,0,0'}}},'2,0,0':target};
  const before=JSON.stringify(target),m=D.seed(db,'1,0,0',p,'run');assert.ok(m);assert.equal(m.type,'delivery');assert.equal(m.recipient,'General');assert.equal(m.patron,'Sender');
  assert.deepEqual(m.route,['east']);assert.equal(m.dispatchItem.minor_mission_id,m.id);assert.equal(JSON.stringify(target),before);
  assert.equal(D.seed(db,'1,0,0',p,'run'),null);delete db['1,0,0'].deliveryMissionId;db['1,0,0'].exits.east.status='locked';assert.equal(D.seed(db,'1,0,0',p,'other'),null);
});
