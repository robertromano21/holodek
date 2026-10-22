'use strict';
const Flags=require('./worldFlags'), Art=require('../assets/genreExpansion');
const VERSION='world1-city-complete-1';
const DISTRICTS=['gate','market','temple','residential','guild','harbor','undercity'];
const ROLES={gate:['watch officer','arrival clerk','traveler'],market:['merchant','supplier','customer'],temple:['caretaker','healer','visitor'],residential:['resident','neighbor','repairer'],guild:['artisan','apprentice','supplier'],harbor:['porter','transport worker','dispatcher'],undercity:['miner','maintenance worker','surveyor']};
const BUILDINGS={
  nautical:['Harbor Office','Chandlery','Mariners Chapel','Sail Loft','Ropewalk','Cargo Warehouse','Tide Gallery'],
  noir:['Station Office','Corner Diner','Memorial Hall','Walk-Up Apartment','Printworks','Dock Office','Service Gallery'],
  steampunk:['Customs Booth','Tea Exchange','Clock Chapel','Workers Terrace','Gear Workshop','Canal Warehouse','Boiler Room'],
  modern:['Transit Office','Convenience Store','Community Hall','Apartment','Repair Shop','Freight Office','Utility Access'],
  'post-apocalyptic':['Checkpoint Shelter','Barter House','Memory Hall','Patchwork Lodge','Salvage Workshop','Convoy Shed','Bunker Access'],
  'cosmic-horror':['Tide Office','Lantern Shop','Listening Hall','Shuttered House','Salt Workshop','Wharf Office','Drowned Gallery'],
  'gothic-horror':['Gate Lodge','Apothecary','Bell Chapel','Old Manor','Bell Foundry','Fog Warehouse','Burial Gallery'],
  solarpunk:['Garden Kiosk','Cooperative Store','Reflection Hall','Canopy Home','Repair Cooperative','Water Transit Hall','Rootworks Access'],
  dieselpunk:['Motor Office','Exchange','Memorial Hall','Workers Apartment','Machine Shop','Rail Depot','Engine Gallery'],
  underwater:['Lock Office','Pearl Exchange','Coral Sanctuary','Pressure Home','Current Workshop','Submersible Bay','Trench Access'],
  prehistoric:['Watch Lodge','Gathering House','Ancestor Lodge','Hearth Lodge','Flint Workshop','River Storehouse','Deep Cave'],
  'desert-fantasy':['Caravan Office','Spice House','Star Sanctuary','Courtyard Home','Tile Workshop','Canal Storehouse','Cool Cistern']
};
function vocab(genre){
  const p=Art.PROFILES[genre];if(!p)return null;
  const labels=BUILDINGS[genre];if(!labels)return null;
  return {street:['Way','Walk','Passage','Row'],districts:Object.fromEntries(DISTRICTS.map((d,i)=>[d,p.names[i]])),
    buildings:Object.fromEntries(DISTRICTS.map((d,i)=>[d,[[labels[i],d==='undercity'?'cavern':d==='temple'?'deity_temple':d==='market'?'inn':d==='guild'?'guildhall':d==='gate'?'watch_house':'house']]]))};
}
function serviceKind(room){
  if(!Flags.on('CITY_COMPLETE')||room?.cityRoom?.completion!==VERSION)return null;
  const c=room.cityRoom;
  return c.kind==='building'?(c.district==='temple'?'temple':['market','guild','harbor'].includes(c.district)?'shop':null):null;
}
function enrich(database,anchorKey){
  if(!Flags.on('CITY_COMPLETE'))return false;
  const anchor=database[anchorKey], city=anchor?.environmentIntent?.citySite;
  if(!city)return false;
  let changed=false;
  for(const [key,room]of Object.entries(database)){
    const c=room?.cityRoom;if(c?.anchorKey!==anchorKey||c.completion===VERSION)continue;
    const role=c.district||'residential';
    c.completion=VERSION;c.population={roles:ROLES[role]||ROLES.residential,civilianMajority:role!=='undercity',maxResidents:c.kind==='building'?8:16};
    c.routes=Object.entries(room.exits||{}).filter(([,e])=>e?.targetCoordinates).map(([direction,e])=>({direction,to:e.targetCoordinates}));
    const prior=room.campaignSetting||anchor.campaignSetting||{};
    room.campaignSetting={...prior,communityId:`city:${city.id}:${anchorKey}`,community:c.cityName,inhabited:true,
      siteKind:c.kind==='building'&&['market','guild','harbor'].includes(role)?'market':role==='temple'?'temple':prior.siteKind||'city',
      faction:prior.faction||{name:'Local civic council',allegiance:'Neutral'},
      city:{id:c.cityId,name:c.cityName,district:role,districtName:c.districtName,kind:c.kind,genre:c.genre,population:c.population},
      ...(anchor.planarRealm?{planarRealm:anchor.planarRealm}:{})};
    // No actor, quest, exit, inventory or existing market is replaced by this metadata upgrade.
    if(c.kind==='building'&&['market','guild','harbor','undercity'].includes(role))require('./market').seed(room,key,city.id);
    changed=true;
  }
  if(changed){anchor.citySites.completion=VERSION;for(const [key,room]of Object.entries(database))if(room.cityRoom?.anchorKey===anchorKey)require('./tradeRoutes').connect(database,key);}
  return changed;
}
function populationGuidance(setting){
  const c=setting?.city;if(!Flags.on('CITY_COMPLETE')||!c)return '';
  return `CITY POPULATION (read-only): ${JSON.stringify(c)}. Use the world's own peoples and genre, with distinct histories, voices and local relationships. Occupations are examples, not fixed names or races. ${c.population?.civilianMajority?'A majority of this civic population must be Neutral or Friendly; a few guards or criminals may be Hostile.':'Choose a local mix appropriate to the maintenance or undercity site.'} Place groups at their own sites, never a whole-city raid. Preserve starting, explicit evil-temple and quest-contact protections. Existing named residents persist; do not repopulate killed or recruited individuals.`;
}
function artContext(room){return room?.cityRoom?.completion===VERSION?{city:room.cityRoom.cityName,district:room.cityRoom.districtName,kind:room.cityRoom.kind,genre:room.cityRoom.genre,architecture:Art.PROFILES[room.cityRoom.genre]?.label}:null;}
module.exports={VERSION,vocab,enrich,serviceKind,populationGuidance,artContext};
