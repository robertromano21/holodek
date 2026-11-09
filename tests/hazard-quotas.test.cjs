'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const H=require('../retort/roomHazards'),A=require('../retort/roomHazardAuthoring'),Ui=require('../assets/roomHazardsUi');
function room(seed='quota',indoor=true,size=40){
  const d={geoKey:'2,3,0',layout:{width:size,height:size},classification:{indoor,biome:indoor?'temple':'wasteland'},
    generation:{seed},start:{x:5,y:20},cells:{},tiles:{},sceneObjects:[],sceneSpec:{indoor,
      source:{roomName:'Existing Place',description:'A quiet passage passes between old stone walls.'}}};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[x+','+y]={tile:x<2||y<2||x>=size-2||y>=size-2?'wall':'floor',floorHeight:0,ceilHeight:3};
  return d;
}
function authored({data}){return{hazards:data.hazards.map((h,i)=>({id:h.id,name:'Bound Danger '+(i+1),
  description:'A visible warning marks this local '+h.kind.replace(/_/g,' ')+', with clear ground around it.'}))};}
test('starter rooms stay hazard-free in every genre, without an authoring call or geometry changes',async()=>{
  for(const indoor of[true,false]){
    const d=room('starter',indoor);d.geoKey='0,0,0';d.sceneSpec.source.description='Gas vents and cracked flagstones line the chamber.';
    const before=JSON.stringify(d.cells);await A.prepare(null,d,{author:()=>assert.fail('Starter hazards are forbidden')});
    assert.equal(d.roomHazards.hazards.length,0);assert.equal(d.roomHazards.quota.starter,true);assert.equal(JSON.stringify(d.cells),before);
  }
  const upstairs=room();upstairs.geoKey='0,0,0';upstairs.cityFloorContext={hostKey:'0,0,0',buildingId:'inn',floor:2};
  await A.prepare(null,upstairs,{author:authored});assert.ok(upstairs.roomHazards.hazards.length>=1,'Private upper floors are not the starting street');
});
test('plain indoor rooms receive at least one hazard without incidental danger wording',async()=>{
  const d=room();assert.deepEqual(H.evidence(d.sceneSpec.source.description),[]);
  let calls=0;await A.prepare(null,d,{author:args=>{calls++;return authored(args);}});
  assert.equal(calls,1);assert.equal(d.roomHazards.hazards.length,1);assert.equal(d.roomHazards.quota.indoor,true);
  for(const h of d.roomHazards.hazards){assert.equal(h.authorship,'model');assert.match(h.label,/Bound Danger/);
    assert.equal(h.evidence,h.description);for(const key of h.keys)assert.equal(d.cells[key].hazardId,h.id);}
});
test('outdoor quotas cover two through five and remain stable across reloads and clones',async()=>{
  const counts=new Set();
  for(let n=0;n<8;n++){
    const d=room('quota-'+n,false),copy=structuredClone(d);counts.add(H.requiredQuota(d).count);
    await A.prepare(null,d,{author:authored});await A.prepare(null,copy,{author:authored});
    assert.ok(d.roomHazards.hazards.length>=2&&d.roomHazards.hazards.length<=5);
    assert.equal(d.roomHazards.hazards.length,d.roomHazards.quota.count);
    assert.deepEqual(d.roomHazards,copy.roomHazards);assert.deepEqual(d.cells,copy.cells);
    const saved=JSON.parse(JSON.stringify(d));
    await A.prepare(null,saved,{author:()=>assert.fail('Saved hazards must not be authored again')});
    assert.deepEqual(saved.roomHazards,d.roomHazards);
  }
  assert.deepEqual([...counts].sort(),[2,3,4,5]);
});
test('hazard selection respects genre and local climate without stock proper names',()=>{
  const d=room();
  assert.ok(!H.eligibleKinds(d,'fantasy').includes('radiation_zone'));
  assert.ok(!H.eligibleKinds(d,'fantasy').includes('moving_machinery'));
  assert.ok(!H.eligibleKinds(d,'fantasy').includes('slick_ice'));
  d.sceneSpec.source.description='Many voices describe the choice of a solemn sacrifice.';
  assert.ok(!H.eligibleKinds(d,'fantasy').includes('slick_ice'),'Words containing ice do not mean a cold climate');
  assert.ok(H.eligibleKinds(d,'sci-fi').includes('radiation_zone'));
  assert.ok(H.eligibleKinds(d,'cyberpunk').includes('moving_machinery'));
  d.classification.biome='frozen tundra';
  assert.ok(H.eligibleKinds(d,'fantasy').includes('slick_ice'));
  assert.ok(!H.eligibleKinds(d,'fantasy').includes('extreme_heat'));
});
test('quota construction keeps bypasses open and protects items, exits, puzzles and secret rewards',async()=>{
  for(let n=0;n<8;n++){
    const d=room('protected-'+n,false);
    d.cells['10,10'].exit='north';d.cells['11,10'].puzzleFixture={id:'lever'};
    d.cells['12,10'].secretChamber=true;d.cells['13,10'].interactable=true;
    d.sceneObjects.push({name:'quest book',x:14,y:10});
    const before=structuredClone(d),reachable=H.reach(d,d.start);
    await A.prepare(null,d,{author:authored});
    for(const key of ['10,10','11,10','12,10','13,10','14,10'])assert.deepEqual(d.cells[key],before.cells[key]);
    const after=H.reach(d,d.start),allowed=new Set(d.roomHazards.hazards.flatMap(h=>h.kind==='ward_stone'?[...h.keys,...h.gap]:[...h.gap,...(h.rift?.decor||[])]));
    assert.deepEqual([...reachable].filter(k=>!after.has(k)&&!allowed.has(k)),[]);
    const zones=new Set();for(const h of d.roomHazards.hazards)for(const key of h.zone){assert.ok(!zones.has(key),'Overlapping hazard zones');zones.add(key);}
    assert.deepEqual(d.sceneObjects,before.sceneObjects);
  }
});
test('failed authorship never commits geometry, labels or a partial quota',async()=>{
  for(const failure of [()=>{throw Error('provider unavailable');},()=>({hazards:[]}),args=>({hazards:args.data.hazards.map(h=>({id:h.id,name:'None',description:'None'}))})]){
    const d=room('failed',false),before=JSON.stringify(d);
    await assert.rejects(A.prepare(null,d,{author:failure}));assert.equal(JSON.stringify(d),before);
  }
});
test('unplaceable geometry fails explicitly without damaging the room or silently delivering zero hazards',()=>{
  const d=room();for(const cell of Object.values(d.cells))cell.navigationReserved=true;
  const before=JSON.stringify(d);assert.throws(()=>H.requiredDraft(d),/cannot safely fit/);assert.equal(JSON.stringify(d),before);
});
test('saved empty, cleared and legacy hazard decisions are not silently changed by a catalog upgrade',async()=>{
  for(const report of [{version:1,hazards:[]},{version:1,hazards:[{id:'old',state:'cleared'}]}]){
    const d=room();d.roomHazards=report;const before=JSON.stringify(d);
    await A.prepare(null,d,{author:()=>assert.fail('Saved hazard state is authoritative')});assert.equal(JSON.stringify(d),before);
  }
  const d=room();d._geometryStamp='already-finalized';await A.prepare(null,d,{author:()=>assert.fail('No walking-time retrofit')});
  assert.equal(d.roomHazards,undefined);
});
test('authored descriptions are not character-capped and multiline prose is normalized instead of retried',async()=>{
  const d=room(),long='The authored warning remains complete. '.repeat(120);
  await A.prepare(null,d,{author:args=>({hazards:args.data.hazards.map(h=>({id:h.id,name:'Long Warning',description:long+'\nA final sentence.'}))})});
  assert.ok(d.roomHazards.hazards[0].description.length>4000);assert.ok(!d.roomHazards.hazards[0].description.includes('\n'));
});
test('multiple hazards of the same kind resolve their exact authored labels, never the first generic noun',()=>{
  const d={roomHazards:{hazards:[{id:'first',kind:'gas_vent',label:'Amber Vent'},{id:'second',kind:'gas_vent',label:'Blue Vent'}]}};
  assert.deepEqual(H.intent('seal the Blue Vent',d),{hazardId:'second',kind:'disarm'});
  assert.deepEqual(H.intent('seal the Amber Vent',d),{hazardId:'first',kind:'disarm'});
  assert.equal(H.intent('seal vent',d),null);
});
test('nearby inspection and narration use actual authored dangers, without revealing distant hazards',async()=>{
  const d=room();await A.prepare(null,d,{author:authored});const h=d.roomHazards.hazards[0],[x,y]=h.keys[0].split(',').map(Number);
  const point={x:x+.5,y:y+.5},candidate=Ui.candidates(d,point)[0];assert.equal(candidate.detail,h.description);
  const plan=H.planAction(d,h.id,'Player','inspect',point);assert.ok(!plan.error);
  assert.ok(H.outcome(d,plan,null).message.startsWith(h.description));
  const zone=h.zone.find(k=>d.cells[k].tile==='floor')||h.zone[0],[zx,zy]=zone.split(',').map(Number);
  assert.ok(A.context(d,{x:zx+.5,y:zy+.5}).some(row=>row.name===h.label));
  assert.deepEqual(A.context(d,{x:-100,y:-100}),[]);
});
test('new normal and testing-room builds await authored quotas before finalization and delivery',()=>{
  const source=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const marker="await require('./roomHazardAuthoring').prepare($, dungeon, { runId: sharedState.getDungeonRunId() });";
  assert.equal(source.split(marker).length-1,2);
  for(const part of source.split(marker).slice(1))assert.ok(part.indexOf('finalizeRoomDungeon(')<part.indexOf("broadcast({ type: 'dungeonLoaded'"));
  const narrator=require('../retort/holodekNarration');
  assert.ok(narrator.facts('Environmental Hazards: authored warning')['Environmental Hazards']==='authored warning');
});
test('new procedural city floors author their hazards before delivery, including a starter-city upper floor',async()=>{
  const Work=require('../retort/holodekRoomWork'),Descriptions=require('../retort/roomDescription'),F=require('../retort/hostLocalFloors');
  const original={request:Work.request,generate:Descriptions.generate};let calls=0;
  const ref={hostKey:'0,0,0',buildingId:'tower',floor:1},local={name:'Upper Chapel',description:'',classification:{indoor:true},cityRoom:{establishmentType:'temple'}};
  const database={'0,0,0':{name:'Starting City',cityArchitecture:{buildings:{tower:{plan:{authored:false,footprint:{width:32,depth:32}},floors:{1:{plan:{}}}}}},
    cityFloors:{buildings:{tower:{floors:{1:{room:local}}}}}}};
  const d=room();d.geoKey=ref.hostKey;d.cityFloorContext=ref;d._geometryStamp='initial-floor-layout';
  const before=JSON.stringify(d);
  try{
    Descriptions.generate=async()=> 'A vaulted chapel occupies this saved upper floor.';
    Work.request=async(_$,component,parameters,_brief,validate)=>{
      calls++;assert.equal(component,'room-hazards');assert.equal(parameters.hazards.minItems,1);
      return validate({hazards:parameters.hazards.type[0].type.id.enum.map(id=>({id,name:'The Split Tread',description:'A split tread yields under a careless step.'}))});
    };
    const result=await require('../retort/cityFloorTravel').authorContent({getDungeonRunId:()=> 'floor-test'},database,ref,d,
      {newRoom:true,runner:fn=>fn({user:()=>{}})});
    assert.equal(calls,1);assert.equal(result.hazardDraft.roomHazards.hazards.length,1);
    assert.equal(result.hazardDraft.cityFloorContext.floor,1);assert.equal(JSON.stringify(d),before,'No mutation of the saved geometry before handoff');
    assert.ok(F.LOCAL.has('roomHazards'),'Floor hazard state must not bleed into the host street');
  }finally{Work.request=original.request;Descriptions.generate=original.generate;}
});
test('the real local Retort transport authors a five-hazard quota in bounded batches without a count-selection call',async()=>{
  const vm=require('node:vm'),fixturePath=require.resolve('./holodek-work.test.cjs');
  const prefix=fs.readFileSync(fixturePath,'utf8').split('\ntest(')[0];
  const run=vm.runInNewContext(prefix+'\nruntime;',{require:require('node:module').createRequire(fixturePath),console});
  const d=room('quota-2',false),ids=H.requiredDraft(d).roomHazards.hazards.map(h=>h.id);let offset=0;
  const {result,requests}=await run($=>A.prepare($,d),body=>{
    const schema=body.response_format.json_schema.schema;
    assert.ok(schema.properties.rows,'A fixed quota needs no count choice');
    const rows=Array.from({length:schema.properties.rows.minItems},()=>{
      const index=offset++;return{id:ids[index],name:'Local Hazard '+index,description:'An authored physical warning identifies the danger and its safe bypass.'};
    });return{rows};
  });
  assert.equal(result.roomHazards.hazards.length,5);assert.equal(requests.length,2);assert.equal(offset,5);
  const Budget=require('../retort/holodekBudget');
  for(const body of requests)assert.ok(Budget.tally(body.messages,[{response_format:body.response_format}]).total<=Budget.CEILING);
});
module.exports={room,authored};
