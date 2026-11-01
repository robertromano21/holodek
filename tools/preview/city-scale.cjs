'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Blocks=require('../../retort/cityBlocks'),Exits=require('../../assets/dungeonExits'),Nav=require('../../retort/sceneArchitecture');
const target=Number(process.argv[process.argv.indexOf('--buildings')+1]||750),genre=process.argv.includes('--genre')?process.argv[process.argv.indexOf('--genre')+1]:'cyberpunk';
if(!Number.isInteger(target)||target<1||target>5000)throw Error('Use --buildings 1..5000.');
const out=path.resolve(__dirname,'../../.retort-data/city-streaming'),wards=[],identities=new Set(),started=Date.now();fs.mkdirSync(out,{recursive:true});
const site={id:'city-scale',name:'Scale Test City',scale:'metropolis',design:{verticality:{floors:120}}};
let total=0,parks=0;
for(let ward=0;total<target&&ward<24;ward++){
  const size=512,key=`${ward},0,30`,d={geoKey:key,generation:{seed:'scale-test'},layout:{width:size,height:size},start:{x:256,y:256},cells:{},tiles:{},sceneStructures:[]};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const exits={...(ward?{west:{status:'open',targetCoordinates:`${ward-1},0,30`}}:{}),east:{status:'open',targetCoordinates:`${ward+1},0,30`}};
  Exits.install(d,exits);const options={genre,scale:'metropolis'};Blocks.apply(d,{city:{}},site,options);
  search:for(let y=56;y<size;y+=80)for(let x=56;x<size;x+=80)for(let pass=0;pass<3;pass++){
    if(total+d.cityBlocks.buildings.length>=target)break search;
    Blocks.apply(d,{city:{}},site,{...options,stream:true,observer:{x,y},limit:Math.min(4,target-total-d.cityBlocks.buildings.length)});
  }
  const connected=Nav.reachable(Nav.makeNavigation(d),d.start);
  for(const b of [...d.cityBlocks.buildings,...d.cityBlocks.parks])for(const door of b.doors)if(!connected.seen[door.y*size+door.x])throw Error('Unreachable building: '+b.id);
  for(const marker of d.roomExits.markers)if(!connected.seen[marker.y*size+marker.x])throw Error('Disconnected ward: '+key);
  for(const b of d.cityBlocks.buildings){if(identities.has(b.id))throw Error('Duplicate building identity');identities.add(b.id);}
  const record={key,buildings:d.cityBlocks.buildings.length,parks:d.cityBlocks.parks.length,metresWide:size*2.5,
    collisionCells:Object.values(d.cells).filter(c=>c.cityParcel).length,allDoorsReachable:true,
    exits,geometryHash:crypto.createHash('sha256').update(JSON.stringify(d.cells)).digest('hex')};
  wards.push(record);total+=record.buildings;parks+=record.parks;console.log(JSON.stringify({ward:key,buildings:record.buildings,total,target}));
}
// The last constructed ward is a terminus, not a promised route to an unbuilt test sector.
if(wards.length)delete wards.at(-1).exits.east;
const report={at:new Date().toISOString(),pass:total>=target,genre,target,buildings:total,uniqueBuildings:identities.size,parks,
  wards,elapsedMs:Date.now()-started,kind:'production collision geometry stress test; not a live gameplay or GPU frame-rate result',apiCalls:0,savesModified:false};
fs.writeFileSync(path.join(out,`scale-${genre}-${target}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,wards:wards.length},null,2));
process.exitCode=report.pass?0:1;
