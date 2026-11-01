'use strict';
const Life=require('./cityLife'),Programs=require('./cityFloorPrograms');

// Small saved addresses, not eager dungeons or invented people. The ordinary room chain authors each floor once.
function legacyInstall(database,anchorKey,{groundKey,site:providedSite}={}){
  const anchor=database[anchorKey],site=providedSite||anchor?.environmentIntent?.citySite;
  if(!site?.design?.verticality||!groundKey&&anchor.citySites?.floorDirectory)return{status:'unchanged',floors:0};
  const additions={},updates=[],occupied=new Set(Object.keys(database));
  const grounds=Object.entries(database).filter(([key,r])=>(groundKey?key===groundKey:r.cityRoom?.anchorKey===anchorKey)&&r.cityRoom?.vertical?.floor===0);
  for(const [groundKey,ground]of grounds){
    const c=ground.cityRoom,v={...c.vertical},base=groundKey.split(',').map(Number),directory=[];
    delete v.directory;
    const storeyHeightMetres=v.storeyHeightMetres||8,podiumHeightMetres=Math.max(8,((c.venue?.clearance||2.4)+.6)*2.5);
    const saved=new Map(Object.entries(database).filter(([,r])=>r.cityRoom?.vertical?.towerId===v.towerId).map(([key,r])=>[r.cityRoom.vertical.floor,{key,room:structuredClone(r)}]));
    for(let floor=0;floor<=v.storeys;floor++){
      const prior=saved.get(floor),program=Programs.program(c,floor,v.storeys,site.design);
      const use=prior?.room.cityRoom?.floorProgram?.use||program.use;
      let key=prior?.key;
      if(!key){
        // x/y retain the building address; z is private storage, never the physical floor number.
        for(let offset=0;offset<1999;offset++){
          const z=((base[2]+100+floor+offset+999)%1999+1999)%1999-999,candidate=`${base[0]},${base[1]},${z}`;
          if(!occupied.has(candidate)){key=candidate;occupied.add(key);break;}
        }
        if(!key)throw Error('No private address available for tower floor.');
      }
      const floorType=prior?.room.cityRoom?.establishmentType||program.type;
      const name=prior?.room.name||`${ground.name.slice(0,50)} Level ${floor}`;
      const room=prior?.room||{name,indoor:true,isIndoor:true,isOutdoor:false,complexId:`city-building:${key}`,
        classification:{...ground.classification,indoor:true},exits:{},objects:[],monsters:{inRoom:'None',state:'None',equippedProperties:'None'},
        environmentIntent:{...ground.environmentIntent,targetKey:key,indoor:true,narrativeHint:`Inside ${ground.name}, floor ${floor}; ${use}.`},
        cityRoom:{...structuredClone(c),establishmentType:floorType,venue:Life.venue(floorType,`${v.towerId}:${floor}`,name),authored:false}};
      if(!prior){delete room.cityRoom.venueId;Object.assign(room.cityRoom.venue,{width:c.footprint?.width||32,depth:c.footprint?.depth||32,programUse:use});}
      const width=c.footprint?.width||32,depth=c.footprint?.depth||32,units=Math.max(2,Math.min(10,Math.floor((width-6)*(depth-6)/100)));
      if(floor>0)room.cityRoom.venue.storeyClearance=Math.max(1.2,(storeyHeightMetres-1)/2.5);
      room.cityRoom.vertical={...room.cityRoom.vertical,...v,floor,use,groundKey,roofAccess:floor===v.storeys,storeyHeightMetres,podiumHeightMetres,
        heightMetres:podiumHeightMetres+v.storeys*storeyHeightMetres,elevationMetres:floor===0?0:podiumHeightMetres+(floor-1)*storeyHeightMetres};
      if(c.architecture){
        room.cityRoom.architecture={...c.architecture,floor};
        const record=database[c.architecture.hostKey]?.cityArchitecture?.buildings?.[c.architecture.buildingId];
        if(record){record.floors||={};record.floors[floor]||=floor<2?{plan:require('../assets/cityBuildingPlans').floor(record.plan,floor)}:{};
          record.floors[floor].legacyKey=key;}
      }
      room.cityRoom.floorProgram||={version:1,floor,units,namedResidents:8,residents:Math.max(8,Math.min(24,units*2)),use,band:program.band,
        policy:'Named residents generated once on entry; preserve defeat, departure, recruitment and inventory.'};
      directory.push({floor,key,name,units,use,type:floorType});
      updates.push([key,room,!!prior]);
      if(!prior)additions[key]=room;
    }
    for(let i=0;i<directory.length;i++){
      const entry=directory[i],room=updates.find(([key])=>key===entry.key)[1];
      if(i>0)room.exits.down={status:'open',targetCoordinates:directory[i-1].key,transport:v.transit,label:`${v.transit} to level ${i-1}`};
      if(i<directory.length-1)room.exits.up={status:'open',targetCoordinates:directory[i+1].key,transport:v.transit,label:`${v.transit} to level ${i+1}`};
      if(i===0)room.cityRoom.vertical.directory=directory;
    }
  }
  for(const [key,room]of updates)database[key]=room;
  if(!groundKey)anchor.citySites.floorDirectory={version:1,towers:grounds.length,addresses:updates.length,generatedInteriors:0};
  return{status:'installed',floors:Object.keys(additions).length,towers:grounds.length};
}
function install(database,anchorKey,options={}){
  if(!options.hostLocal)return legacyInstall(database,anchorKey,options);
  const {groundKey}=options;
  const Plans=require('../assets/cityBuildingPlans');let towers=0,floors=0;
  require('./cityArchitecture').installNamed(database,anchorKey);
  for(const [key,room]of Object.entries(database)){
    const c=room.cityRoom,ref=c?.architecture;
    if((groundKey?key!==groundKey:c?.anchorKey!==anchorKey)||!ref||c.vertical?.floor>0)continue;
    const host=database[ref.hostKey],record=host?.cityArchitecture?.buildings?.[ref.buildingId];if(!record)continue;
    host.cityFloors||={version:1,buildings:{}};host.cityFloors.buildings[ref.buildingId]||={floors:{}};
    const count=record.plan.storeys;
    for(let n=0;n<Math.min(2,count);n++)record.floors[n]||={plan:Plans.floor(record.plan,n)};
    c.vertical={...c.vertical,floor:0,storeys:count-1,groundKey:ref.hostKey,directory:Array.from({length:count},(_,floor)=>({
      floor,key:ref.hostKey,buildingId:ref.buildingId,name:floor?`${room.name.slice(0,50)} Level ${floor}`:room.name}))};
    for(const direction of ['up','down']){
      const exit=room.exits?.[direction],destination=database[exit?.targetCoordinates]?.cityRoom;
      if(destination?.architecture?.buildingId===ref.buildingId&&destination?.architecture?.hostKey===ref.hostKey)delete room.exits[direction];
    }
    if(!Object.keys(room.exits||{}).length)room.exits={south:{status:'open',targetCoordinates:ref.hostKey,label:'Return to the street'}};
    towers++;floors+=count;
  }
  if(!groundKey&&database[anchorKey]?.citySites)database[anchorKey].citySites.floorDirectory={version:2,towers,addresses:0,plannedFloors:floors,generatedInteriors:0};
  return{status:'installed',floors:0,towers,plannedFloors:floors};
}
module.exports={install,legacyInstall};
