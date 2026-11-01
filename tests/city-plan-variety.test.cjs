'use strict';
for(const flag of ['ARCHITECTURE_EXPANSION','CITY_SITES','CITY_COMPLETE','GENRE_EXPANSION'])process.env['HOLODEK_'+flag]='1';
const test=require('node:test'),assert=require('node:assert/strict'),Plans=require('../assets/cityBuildingPlans'),
  H=require('../retort/hostLocalFloors'),Nav=require('../retort/sceneArchitecture');
test('same-purpose neighboring buildings have genuinely distinct saved spatial compositions, not only palettes',()=>{
  for(const genre of ['fantasy','dark-fantasy','modern','sci-fi','cyberpunk']){
    const compositions=new Set(),shapes=new Set();
    for(let i=0;i<24;i++){
      const p=Plans.create({id:'parcel:'+i,seed:'one-city',hostKey:'0,0,0',genre,type:'shop',width:28,depth:32,storeys:4}),r=Plans.floor(p,1);
      compositions.add(r.composition);shapes.add(JSON.stringify([r.rooms,r.corridors]));assert.deepEqual(r,Plans.floor(p,1));
      assert.ok(r.corridors.length);for(const room of r.rooms){assert.ok(room.width>=3&&room.depth>=3);assert.ok(room.x+room.width<=r.width-1);assert.ok(room.y+room.depth<=r.depth-1);}
    }
    assert.equal(compositions.size,6,genre);assert.ok(shapes.size>=6,genre);
  }
});
test('every native composition fits its saved footprint and connects original CotG modules, furnishings and both stairs',()=>{
  const seen=new Set();let modules=0;
  for(let i=0;i<60&&seen.size<6;i++){
    const p=Plans.create({id:'parcel:'+i,seed:'one-city',hostKey:'0,0,0',genre:'fantasy',type:'temple',width:44,depth:52,storeys:4}),r=Plans.floor(p,1);
    if(seen.has(r.composition))continue;seen.add(r.composition);
    const ref={hostKey:p.hostKey,buildingId:p.id,floor:1},db={[p.hostKey]:{cityArchitecture:{buildings:{[p.id]:{plan:p,floors:{1:{plan:r}}}}},cityFloors:{buildings:{[p.id]:{floors:{}}}}}};
    db[p.hostKey].cityFloors.buildings[p.id].floors[1]={room:H.floorRoom(db,ref)};
    const d=H.geometry(db,ref),nav=Nav.makeNavigation(d),reach=Nav.reachable(nav,d.start);
    for(let n=0;n<nav.passable.length;n++)if(nav.passable[n])assert.ok(reach.seen[n],r.composition+' disconnected '+n);
    modules+=(d.sceneArchitecture?.modules||[]).filter(m=>m.status==='built').length;
    assert.ok(d.cityVenue.furnishings);assert.ok(d.cityCirculation.controls.some(c=>c.direction==='up'));
    assert.ok(d.cityCirculation.controls.some(c=>c.direction==='down'));
  }
  assert.equal(seen.size,6);assert.ok(modules>0,'Original CotG architecture modules must really be built, not discarded during fitting');
});
test('an existing version-one recipe retains its historical corridor layout instead of being rebuilt',()=>{
  const p=Plans.create({id:'legacy',hostKey:'0,0,0',genre:'fantasy',width:24,depth:28,storeys:4});delete p.layoutVersion;
  const r=Plans.floor(p,1);assert.equal(r.layoutVersion,1);assert.equal(r.composition,'concourse');assert.deepEqual(r.modules,[]);
});
