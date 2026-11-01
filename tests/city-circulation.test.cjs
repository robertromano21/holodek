'use strict';
for(const flag of ['CITY_SITES','ARCHITECTURE_EXPANSION','GENRE_EXPANSION'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../retort/cityCirculation'),I=require('../assets/dungeonInhabitants'),P=require('../assets/cityParcels');
function geometry(key='0,0,0'){
  const d={geoKey:key,_geometryStamp:'saved:'+key,layout:{width:80,height:80},start:{x:40,y:70},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<80;y++)for(let x=0;x<80;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};return d;
}
function fixture(genre='cyberpunk'){
  const host=geometry(),b={id:'parcel:testing',name:'Local House',type:'home',left:10,top:10,width:32,depth:36,storeys:8,
    rooms:[{x:11,y:11,width:30,depth:34,use:'public-lobby'}]};
  host.cityBlocks={buildings:[b],streaming:{genre}};
  for(let y=b.top;y<b.top+b.depth;y++)for(let x=b.left;x<b.left+b.width;x++)host.cells[`${x},${y}`].cityParcel=b.id;
  C.install(host);
  let key=host.geoKey,db={[key]:{name:'Ward',environmentIntent:{citySite:{id:'city',name:'City'}}}},paused=false;
  const dungeons={[key]:host},state={getGamePaused:()=>paused,getLastCoords:()=>Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,Number(key.split(',')[i])])),
    getDungeonRunId:()=> 'run',getRoomDungeonForSimulation:c=>dungeons[`${c.x},${c.y},${c.z}`],
    getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:text=>db=JSON.parse(text)};
  function request(control,extra={}){return{runId:'run',geoKey:key,geometryStamp:dungeons[key]._geometryStamp,controlId:control.id,player:{...control.point},...extra};}
  function enter(next){
    key=next;const room=db[key];if(dungeons[key])return dungeons[key];
    const d=geometry(key);d.sceneSpec={city:require('../retort/citySites').sceneKind(room,db)};
    d.indoorRooms=[{x:12,y:12,w:48,h:48}];C.install(d);dungeons[key]=d;return d;
  }
  return{host,b,state,request,enter,dungeons,get db(){return db;},set paused(v){paused=v;}};
}
test('every genre has visible usable stairs; only appropriate settings install lifts',()=>{
  for(const genre of Object.keys(require('../assets/genreFixtures').THEMES)){
    const f=fixture(genre),before=JSON.stringify(f.host),controls=f.host.cityCirculation.controls;
    assert.ok(controls.some(c=>c.mode==='stairs'&&c.direction==='up'),genre);
    assert.equal(controls.some(c=>c.mode==='lift'),P.highRise(genre)||genre==='steampunk',genre);
    assert.ok(f.host.sceneStructures.some(p=>p.role==='city-stair-tread'));
    for(const c of controls){assert.ok(I.pointWalkable(f.host,c.point.x,c.point.y));assert.ok(I.pointWalkable(f.host,c.arrival.x,c.arrival.y));}
    assert.equal(C.install(f.host).changed,false);assert.equal(JSON.stringify(f.host),before,'Reload never duplicates a core');
  }
});
test('stairs connect street -> first floor -> second floor -> first floor -> the original street landing',()=>{
  const f=fixture(),source=f.host.cityCirculation.controls.find(c=>c.mode==='stairs');
  const first=C.travel(f.state,f.request(source)),level1=f.enter(first.targetKey),ground=f.db[first.targetKey].cityRoom.vertical.groundKey;
  assert.equal(f.db[first.targetKey].cityRoom.vertical.floor,1);assert.equal(first.direction,'up');
  f.db[first.targetKey].inhabitants={actors:{Saved:{status:'defeated',inventory:['Quest token']}}};
  const saved=JSON.stringify(f.db[first.targetKey].inhabitants),up=level1.cityCirculation.controls.find(c=>c.direction==='up');
  const second=C.travel(f.state,f.request(up)),level2=f.enter(second.targetKey);assert.equal(f.db[second.targetKey].cityRoom.vertical.floor,2);
  const down2=level2.cityCirculation.controls.find(c=>c.direction==='down'),back1=C.travel(f.state,f.request(down2));
  assert.equal(back1.targetKey,first.targetKey);f.enter(back1.targetKey);
  const down1=level1.cityCirculation.controls.find(c=>c.direction==='down'),street=C.travel(f.state,f.request(down1));
  assert.equal(street.targetKey,f.host.geoKey);assert.deepEqual(street.arrival,source.arrival);
  assert.equal(JSON.stringify(f.db[first.targetKey].inhabitants),saved);assert.ok(f.db[ground],'Compatibility lobby remains saved');
});
test('lift directory visits any saved floor and returns to its own street entrance without duplicating addresses',()=>{
  const f=fixture(),lift=f.host.cityCirculation.controls.find(c=>c.mode==='lift');
  const top=C.travel(f.state,f.request(lift,{floor:7})),level7=f.enter(top.targetKey),count=Object.keys(f.db).length;
  assert.equal(f.db[top.targetKey].cityRoom.vertical.floor,7);assert.ok(!level7.cityCirculation.controls.some(c=>c.direction==='up'));
  const down=level7.cityCirculation.controls.find(c=>c.mode==='lift'),street=C.travel(f.state,f.request(down,{floor:0}));
  assert.equal(street.targetKey,f.host.geoKey);assert.deepEqual(street.arrival,lift.arrival);f.enter(street.targetKey);
  assert.equal(C.travel(f.state,f.request(lift,{floor:7})).targetKey,top.targetKey);assert.equal(Object.keys(f.db).length,count);
});
test('invalid, remote, occluded, stale, paused and out-of-range floor travel does not change saved data',()=>{
  const f=fixture(),lift=f.host.cityCirculation.controls.find(c=>c.mode==='lift'),before=JSON.stringify(f.db),request=f.request(lift);
  for(const change of [{runId:'old'},{geoKey:'1,0,0'},{geometryStamp:'old'},{controlId:'fake'},{player:{x:2,y:2}},{floor:1000},{floor:0},{floor:1.2}])
    assert.throws(()=>C.travel(f.state,{...request,floor:1,...change}));
  f.paused=true;assert.throws(()=>C.travel(f.state,{...request,floor:1}));f.paused=false;
  assert.equal(JSON.stringify(f.db),before);
});
test('saved narrow-ceiling floors retain walkable headroom in their stairwell',()=>{
  const d=geometry('3,4,101');for(const c of Object.values(d.cells)){c.ceilHeight=1.2;c.roof={height:1.2};}
  d.indoorRooms=[{x:15,y:15,w:35,h:38}];d.sceneSpec={city:{genre:'sci-fi',vertical:{floor:1,storeys:8}}};C.install(d);
  assert.ok(d.cityCirculation.controls.some(c=>c.direction==='up'));assert.ok(d.cityCirculation.controls.some(c=>c.direction==='down'));
  for(const c of d.cityCirculation.controls)if(c.trigger)assert.ok(I.pointWalkable(d,c.trigger.x,c.trigger.y));
});
test('street lobbies with usable circulation no longer dispatch a separate full-room entry at the front door',()=>{
  const f=fixture(),root={CityParcels:P,DungeonInhabitants:I};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityBuildingUi'),'utf8'),{window:root});
  assert.equal(root.CityBuildingUi.nearby(f.host,P.entrance(f.b)),null);
});
test('clicking stairs submits one validated passage through the existing room chain',async()=>{
  const f=fixture(),control=f.host.cityCirculation.controls.find(c=>c.mode==='stairs'),entries=[];let busy=false;
  const root={dungeonRunId:'run',currentDungeon:f.host,DungeonInhabitants:I,HolodekFlags:{ARCHITECTURE_EXPANSION:true},
    document:{querySelector:()=>null,activeElement:{tagName:'BODY'}},getDungeonLifeContext:()=>({dungeon:f.host,player:control.point}),
    GameCommandGate:{busy:()=>busy,begin:()=>busy=true,end:()=>busy=false},enterCityBuilding:async p=>{assert.equal(busy,false);entries.push(p);},
    fetch:async(_url,init)=>({ok:true,json:async()=>C.travel(f.state,JSON.parse(init.body))})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/cityCirculationUi'),'utf8'),{window:root});
  assert.equal(await root.CityCirculationUi.travel(control),true);assert.equal(entries.length,1);assert.equal(entries[0].direction,'up');assert.equal(busy,false);
});
