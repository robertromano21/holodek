'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../retort/cityBlocks'),P=require('../assets/cityParcels'),N=require('../retort/sceneArchitecture'),E=require('../assets/dungeonExits');
const genres=Object.keys(require('../assets/urbanDesigns').PROFILES);
function dungeon(size=160){
  const d={geoKey:'0,0,30',generation:{seed:'walk-in-check'},layout:{width:size,height:size},start:{x:size/2,y:size/2},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  return d;
}
const site={id:'walk-in-city',name:'Test Ward',design:{verticality:{floors:120}}};
test('parcel dimensions are physical, stable, bounded and scale-sensitive across every genre',()=>{
  for(const genre of genres){
    const args={seed:'city',cityId:'city-1',districtKey:'0,0,30',genre,x:2,y:3,scale:'metropolis',floors:120};
    const p=P.parcel(args);assert.deepEqual(p,P.parcel(args));assert.ok(p.width>=14&&p.depth>=16);
    assert.equal(p.metres.width,p.width*2.5);assert.equal(p.metres.height,p.storeys*3.4);assert.ok(p.storeys<=160);
    assert.notEqual(p.id,P.parcel({...args,x:3}).id);
    assert.ok(P.parcel({...args,scale:'village'}).storeys<=3);
  }
  assert.equal(P.district({scale:'metropolis'}).potentialParcels,1024);
  const skyscraper=P.parcel({genre:'modern',scale:'metropolis',floors:120});assert.ok(skyscraper.metres.height>180&&skyscraper.metres.width>=55);
});
test('real shells, steps, sidewalks and parks share reachable collision cells without changing protected routes',()=>{
  const d=dungeon(256);for(let y=0;y<256;y++)d.cells[`128,${y}`].navigationReserved=true;
  d.cells['12,12'].object={name:'saved item'};d.cells['13,12'].roof={height:3};
  const protectedCells=JSON.stringify([d.cells['12,12'],d.cells['13,12'],...Array.from({length:256},(_,y)=>d.cells[`128,${y}`])]);
  const r=C.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis'});
  assert.equal(r.status,'built');assert.ok(r.buildings>=8&&r.buildings<=C.MAX_BUILDINGS);assert.ok(r.parks>0);
  assert.equal(JSON.stringify([d.cells['12,12'],d.cells['13,12'],...Array.from({length:256},(_,y)=>{
    const {floorSurface,cityStreet,...cell}=d.cells[`128,${y}`];return cell;
  })]),protectedCells,'Protected cells retain geometry and objects; road paint alone is allowed');
  const nav=N.makeNavigation(d),connected=N.reachable(nav,d.start);
  for(const b of [...d.cityBlocks.buildings,...d.cityBlocks.parks]){
    assert.equal(b.doors.length,12);assert.ok(b.width>=14);
    for(const p of b.doors)assert.equal(connected.seen[p.y*256+p.x],1);
    if(b.park){assert.ok(b.railings.length);assert.ok(b.railings.every(p=>d.cells[`${p.x},${p.y}`].tile==='wall'));}
    else{
      assert.ok(b.rooms.length>=2);assert.ok(b.steps.length);assert.ok(b.steps.some(p=>p.height>.1));
      for(const room of b.rooms){
        const cells=[];for(let y=room.y;y<room.y+room.depth;y++)for(let x=room.x;x<room.x+room.width;x++)if(d.cells[`${x},${y}`]?.cityParcel===b.id&&d.cells[`${x},${y}`].tile==='floor')cells.push({x,y});
        assert.ok(cells.length,'Each fitted room has usable interior cells');
        assert.ok(cells.every(p=>connected.seen[p.y*256+p.x]),'All interior floor cells remain reachable, including wings');
      }
      for(const [key,c]of Object.entries(d.cells))if(c.cityParcel===b.id&&c.tile==='floor')assert.ok(c.roof,key);
    }
  }
  assert.ok(r.roadCells>0&&r.sidewalkCells>0);assert.ok(d.sceneStructures.some(s=>s.role==='city-park-furniture'));
  const saved=JSON.stringify(d);assert.equal(C.apply(d,{city:{}},site).status,'already-built');assert.equal(JSON.stringify(d),saved);
});
test('major doors preserve exact destinations, physical footprint, heights and locks after exit reinstallation',()=>{
  const d=dungeon(),exits={east:{status:'locked',targetCoordinates:'2,0,50'}};
  E.install(d,exits);
  const routes=[{direction:'east',name:'Public Archive',targetCoordinates:'2,0,50',footprint:{width:32,depth:32},vertical:{storeys:110},establishmentType:'library'}];
  C.apply(d,{city:{routes}},site,{genre:'modern',scale:'metropolis'});
  const b=d.cityBlocks.buildings.find(b=>b.authored);assert.ok(b);assert.equal(b.name,'Public Archive');
  assert.ok(b.left+b.width/2>d.start.x,'An east entrance remains on the east side of the street');
  assert.equal(b.metres.width,80);assert.equal(b.metres.depth,80);assert.equal(b.storeys,110);
  const bound=d.cityBuildingEntrances[0];assert.ok(bound);const expected=bound.key;
  const restored=JSON.parse(JSON.stringify(d));delete restored.roomExits;
  const installed=E.install(restored,exits),marker=installed.markers[0];
  assert.equal(marker.key,expected);assert.equal(marker.targetCoordinates,'2,0,50');assert.equal(marker.destinationName,'Public Archive');
  assert.equal(exits.east.status,'locked');assert.equal(marker.floor,d.cells[expected].floorHeight);
  assert.equal(d.services,undefined);assert.equal(d.inhabitants,undefined,'A building shell does not invent a vendor or population');
  const L=require('../retort/locationAwareness'),publicFacts=L.parcelAt(d,{x:bound.x+.5,y:bound.y+.5});
  assert.equal(publicFacts.name,'Public Archive');assert.match(publicFacts.access,/2,0,50/);assert.match(publicFacts.operator,/verified services/);
  assert.equal(L.parcelAt(d,d.start),null);
});
test('compilation is native in all genres, skips interiors and keeps reserved or roofed parcels untouched',()=>{
  for(const genre of genres){
    const d=dungeon(128),r=C.apply(d,{city:{}},site,{genre,scale:'city'});assert.ok(r.buildings>0,genre);
    for(const p of d.sceneStructures)assert.ok(!p.shape.startsWith('a_')||p.shape.startsWith(`a_${genre}_`),p.shape);
  }
  const d=dungeon();assert.equal(C.apply(d,{indoor:true},site).status,'skipped');assert.equal(d.cityBlocks,undefined);
  for(const cell of Object.values(d.cells))cell.roof={height:4};
  assert.equal(C.apply(d,{city:{}},site).buildings,0);assert.ok(Object.values(d.cells).every(c=>c.tile==='floor'));
});
test('surface upload uses unused floor bytes and both GPU paths sample the same atlas',()=>{
  const gl=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8'),gpu=fs.readFileSync(require.resolve('../assets/rendererWebGPU'),'utf8');
  assert.match(gl,/isSolid\?tileId:Number\.isInteger\(surfaceId\)&&surfaceId<254\?surfaceId\+1:0/);
  assert.match(gl,/surfaceId >= 0 && floorCell\.a < 0\.999/);assert.match(gpu,/surfaceId >= 0 && floorCell\.w < 0\.999/);
  assert.match(gpu,/surfaceId % cols/);assert.match(gl,/surfaceId % u_atlasCols/);
});
test('browser and server stamp identical cell surfaces, steps, roofs and structures',()=>{
  const vm=require('node:vm'),extract=file=>{
    const source=fs.readFileSync(require.resolve(file),'utf8').replace(/\r\n/g,'\n'),start=source.indexOf('function computeDungeonGeometryStamp('),end=source.indexOf('\n}\n',start)+2;
    return vm.runInNewContext('('+source.slice(start,end)+')',{
      window:{DungeonGeometryStamp:require('../assets/dungeonGeometryStamp')},
      require:require('node:module').createRequire(require.resolve(file))
    });
  },client=extract('../assets/game'),server=extract('../retort/retortWithUserInput'),d=dungeon(128);
  const plain=client(d,d.geoKey);assert.equal(plain,server(d,d.geoKey));
  d.cells['0,0'].floorSurface='city_road_surface';assert.notEqual(plain,client(d,d.geoKey));
  C.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis'});assert.equal(client(d,d.geoKey),server(d,d.geoKey));
});
test('gentle production urban terrain gets level foundations, but cliffs are not flattened',()=>{
  const T=require('../retort/outdoorTerrain'),d=dungeon(256),spec={indoor:false,biome:'city',city:{},generation:{seed:'urban-grade'},source:{roomName:'City Street'}};
  const plan=T.plan(spec,256,256);assert.equal(plan.profile,'urban');
  for(const [k,c]of Object.entries(d.cells)){const [x,y]=k.split(',').map(Number);c.floorHeight=T.heightAt(plan,x,y);}
  const r=C.apply(d,spec,site,{genre:'cyberpunk',scale:'metropolis'});assert.ok(r.buildings>=8,r.buildings);
  const connected=N.reachable(N.makeNavigation(d),d.start);for(const b of d.cityBlocks.buildings)for(const door of b.doors)assert.equal(connected.seen[door.y*256+door.x],1);
  const cliff=dungeon(128);for(const [k,c]of Object.entries(cliff.cells)){const [x,y]=k.split(',').map(Number);c.floorHeight=(x+y)%2*5;}
  assert.equal(C.apply(cliff,{city:{}},site).buildings,0);
});
test('disconnected empty land never acquires unreachable buildings or parks',()=>{
  const d=dungeon(256);for(let y=0;y<256;y++)d.cells[`150,${y}`].tile='wall';
  C.apply(d,{city:{}},site,{genre:'modern',scale:'metropolis'});
  assert.ok(d.cityBlocks.buildings.length>0);
  for(const b of [...d.cityBlocks.buildings,...d.cityBlocks.parks])assert.ok(b.left+b.width<150);
});
