'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Work=require('../retort/holodekRoomWork');
const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
const start=source.indexOf('    if (alreadyPopulated) {',source.indexOf('const missingAdjacentRooms ='));
const end=source.indexOf('    // Mode 4 starts',start);
const branch=source.slice(start,end);
function fixture({profile=null,local=false,known=false,fail=false}={}){
  const current={name:'Eredine Colonnade',populationComplete:true,description:'A colonnade with existing people and objects.',
    objects:[{name:'old token'}],monsters:{inRoom:'Existing Cast'},
    exits:{up:{status:'locked',targetCoordinates:'1,0,1',key:'gallery key',attempts:2}}};
  const neighbor={name:known?'The Veiled Star Gallery':'None',objects:[{name:'protected book'}],
    monsters:{inRoom:'Saved Guardian'},description:'An existing description.',classification:{indoor:true,biome:'temple'}};
  const db={'1,0,0':current,...(known?{'1,0,1':neighbor}:{})},calls=[];
  const assistant=()=>assert.fail('The legacy free-form generation path must not run.');assistant.generation=assistant;
  const agent={assistant};
  const context={alreadyPopulated:true,currentRoomData:current,coordKey:'1,0,0',startKey:'0,0,0',roomName:current.name,
    roomDescription:current.description,currentCoordinates:{x:1,y:0,z:0},missingAdjacentRooms:['up'],roomExitsArray:['up'],
    existingAdjacentRooms:[],adjacentRooms:'up: None',updatedGameConsole:'Exits: up\nAdjacent Rooms: up: None',needsUpdate:false,
    roomNameDatabasePlain:db,WorldSetting:{current:()=>profile},StoryPrompts:{isHolodek1:()=>local},
    coordinatesToString:p=>`${p.x},${p.y},${p.z}`,normalizeCoordKeyLocal:key=>key,constructionReadOnly:()=>false,
    getRoomSafeLocal:(rooms,key)=>rooms[key],setRoomSafeLocal:(rooms,key,value)=>{rooms[key]=value;},
    classifyDungeon:async()=>({indoor:true,biome:'temple'}),persistRoomDb:rooms=>{context.published=JSON.stringify(rooms);},
    require:id=>{assert.equal(id,'./holodekRoomWork');return{roomName:async(a,options)=>{
      assert.equal(a,agent);calls.push(options);if(fail)throw Error('Structured name generation failed.');return 'The Veiled Star Gallery';
    }};},console:{info(){}},$:agent};
  return{context,calls,current,neighbor,db,run:()=>vm.runInNewContext('(async()=>{'+branch+'})()',context)};
}

for(const mode of ['cotg-normal-model','cotg-holodek1','genre'])test('missing-neighbor repair uses the isolated naming helper in '+mode,async()=>{
  const f=fixture({local:mode==='cotg-holodek1',profile:mode==='genre'?{genre:'cyberpunk'}:null}),before=JSON.stringify(f.current);
  await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].sourceKey,'1,0,0');assert.equal(f.calls[0].direction,'up');
  assert.equal(f.calls[0].database,f.db);assert.equal(f.db['1,0,1'].name,'The Veiled Star Gallery');
  assert.equal(JSON.stringify(f.current),before);assert.match(f.context.updatedGameConsole,/up: The Veiled Star Gallery \(locked\)/);
  assert.ok(!('roomDescription'in f.calls[0]),'The old parent description is not copied into a free-form naming prompt.');
});

test('repair reuses an authored adjacent name without generation or changes to saved contents',async()=>{
  const f=fixture({known:true}),before=JSON.stringify(f.neighbor);await f.run();
  assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.neighbor),before);
  assert.match(f.context.updatedGameConsole,/up: The Veiled Star Gallery \(locked\)/);
});

test('a naming failure cannot publish a prose name or an unfinished neighbor',async()=>{
  const f=fixture({fail:true});await assert.rejects(f.run(),/Structured name generation failed/);
  assert.equal(f.db['1,0,1'],undefined);assert.equal(f.context.published,undefined);
  assert.equal(f.context.updatedGameConsole,'Exits: up\nAdjacent Rooms: up: None');
});

test('the production repair branch contains no model gate or raw-response fallback',()=>{
  assert.match(branch,/holodekRoomWork'\)\.roomName/);
  assert.doesNotMatch(branch,/\.assistant\.generation|response\.content|StoryPrompts\.isHolodek1/);
});

test('the existing helper isolates naming and rejects unstructured room prose before accepting a structured name',async()=>{
  const requests=[],prompts=[],runs=[];
  const prose='The Veiled Star Gallery lies above the colonnade, a narrow observatory of dark glass.';
  const agent={model:'test',temperature:.7,assistant:{generation(){assert.fail('Parent generation must never run.');}},
    run:async(work,state,options)=>{
      runs.push({state,options});return work({user:async text=>prompts.push(String(text)),assistant:{generation:async options=>{
        requests.push(options);return{content:requests.length===1?prose:JSON.stringify({name:'The Veiled Star Gallery'})};
      }}});
    }};
  const result=await Work.roomName(agent,{database:{'1,0,0':{name:'Eredine Colonnade',indoor:true,
    description:'PARENT DESCRIPTION MUST NOT LEAK',exits:{up:{targetCoordinates:'1,0,1'}}}},sourceKey:'1,0,0',direction:'up'});
  assert.equal(result,'The Veiled Star Gallery');assert.equal(requests.length,2);assert.equal(runs.length,1);
  assert.equal(runs[0].state,null);assert.equal(runs[0].options.shouldSaveToLog,false);
  assert.equal(requests[0].parameters.name.type,String);assert.equal(requests[0].strictParameters,true);
  assert.equal(requests[0].parameters.name.maxLength,undefined,'No authored character limit is restored.');
  assert.match(prompts[0],/NAME AUTHORING ONLY/);assert.match(prompts[0],/No sentences/);
  assert.match(prompts[0],/1,0,1/);assert.doesNotMatch(prompts.join('\n'),/PARENT DESCRIPTION MUST NOT LEAK/);
});
