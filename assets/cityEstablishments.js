(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CityEstablishments=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const TYPES=['shop','inn','bar','workshop','clinic','home','civic','warehouse',
    'arena','guild','park','library','theatre','bathhouse','transit','temple','court','foodhall'];
  const NAMES={
    fantasy:['Outfitters','Coaching Inn','Tavern','Smithy','Apothecary','Courtyard House','Guild House','Storehouse'],
    'dark-fantasy':['Candle Exchange','Mourning Lodge','Last Lantern Taproom','Bone Carver','Restoration House','Shuttered Dwelling','Bell Registry','Funerary Store'],
    mythic:['Agora Stall','Travelers Rest','Wine House','Bronze Workshop','Healing Court','Peristyle House','Civic Stoa','Amphora Store'],
    'sci-fi':['Supply Exchange','Transit Berths','Crew Lounge','Fabrication Shop','Medical Bay','Habitation Unit','Public Records Module','Cargo Lock'],
    cyberpunk:['Hardware Broker','Capsule Hotel','Noodle Bar','Implant Workshop','Street Clinic','Stack Apartment','Neighborhood Office','Freight Cage'],
    'post-apocalyptic':['Barter Counter','Convoy Lodge','Watering Hole','Salvage Shop','Patchwork Infirmary','Scrap Dwelling','Settlement Hall','Reclaimed Depot'],
    steampunk:['Instrument Shop','Travelers Hotel','Boiler Taproom','Machinists Works','Physicians Rooms','Workers Terrace','Exchange Hall','Canal Depot'],
    western:['General Store','Boarding House','Saloon','Blacksmith','Doctors Office','Homestead','Town Hall','Freight Shed'],
    modern:['Corner Shop','Guesthouse','Cafe Bar','Repair Shop','Health Clinic','Apartment','Community Center','Distribution Store'],
    noir:['Pawn Office','Residential Hotel','Late Night Diner','Print Workshop','Dispensary','Walk Up','Records Office','Bonded Warehouse'],
    nautical:['Chandlery','Sailors Lodge','Harbor Tavern','Ropewalk','Surgeons House','Quayside Home','Harbor Office','Sail Loft'],
    'cosmic-horror':['Curiosity Shop','Tide Lodge','Salt Cellar','Instrument Maker','Physicians Rooms','Shuttered House','Mariners Institute','Wharf Store'],
    'gothic-horror':['Candle Shop','Travelers Hospice','Bell Tavern','Clock Workshop','Apothecary','Old Town House','Parish Records','Fog Warehouse'],
    solarpunk:['Cooperative Store','Guest Canopy','Garden Cafe','Repair Cooperative','Care Pavilion','Canopy Home','Public Assembly','Seed Store'],
    dieselpunk:['Equipment Exchange','Rail Hotel','Shift Canteen','Motor Workshop','Workers Infirmary','Tenement','Transit Office','Freight Depot'],
    underwater:['Dive Exchange','Pressure Lodge','Observation Lounge','Current Workshop','Medical Sphere','Reef Habitat','Navigation Office','Submersible Store'],
    prehistoric:['Trading Shelter','Guest Hearth','Feasting Lodge','Flint Workshop','Healers Shelter','Family Lodge','Gathering Circle','Drying Store'],
    'desert-fantasy':['Spice Shop','Caravanserai','Tea Court','Tile Workshop','Healing Garden','Courtyard Home','Caravan Office','Cool Store']
  };
  const ADDITIONS={
    fantasy:['Tournament Grounds','Craft Fellowship','Commons Garden','Scriptorium','Players Hall','Public Baths','Carriage Station','Great Temple','Magistrates Court','Covered Food Market'],
    'dark-fantasy':['Ashen Lists','Relic Workers Hall','Remembrance Garden','Memory Archive','Shadow Playhouse','Restoration Baths','Processional Station','Funerary Sanctuary','Oath Court','Communal Hearth Hall'],
    mythic:['Contest Stadium','Artisans Stoa','Sacred Grove','Scroll Library','Open Theatre','Thermae','Wayfarers Portico','Sanctuary Precinct','Civic Tribunal','Agora Food Hall'],
    'sci-fi':['Variable Gravity Stadium','Technical Association','Biosphere Park','Knowledge Repository','Immersive Auditorium','Recovery Pools','Transit Interchange','Contemplation Dome','Civil Arbitration Module','Communal Galley'],
    cyberpunk:['Combat Sports Dome','Freelancer Exchange','Elevated Public Garden','Public Data Archive','Holographic Playhouse','Recovery Spa','Maglev Interchange','Neighborhood Sanctuary','Civic Claims Office','Night Food Arcade'],
    'post-apocalyptic':['Reclaimed Contest Yard','Salvagers Assembly','Shelter Garden','Recovered Knowledge Hall','Traveling Players Yard','Wash House','Convoy Terminal','Remembrance Shelter','Settlement Tribunal','Communal Cookhouse'],
    steampunk:['Exhibition Arena','Engineers Society','Glasshouse Park','Patent Library','Mechanical Playhouse','Steam Baths','Rail Interchange','Civic Chapel','Chancery Court','Covered Tea Market'],
    western:['Rodeo Grounds','Trades Association','Town Green','Public Reading Room','Opera House','Town Bathhouse','Stagecoach Station','Community Church','County Courthouse','Produce Hall'],
    modern:['Sports Arena','Professional Association','Public Park','Public Library','Performing Arts Center','Public Pools','Transit Station','Community Sanctuary','Courthouse','Food Hall'],
    noir:['Boxing Palace','Trade Union Hall','Municipal Garden','Newspaper Archive','Picture Palace','Municipal Baths','Central Station','Neighborhood Chapel','Civic Courthouse','Covered Lunch Market'],
    nautical:['Regatta Pavilion','Shipwrights Guild','Harbor Gardens','Navigation Library','Sailors Playhouse','Harbor Baths','Ferry Terminal','Mariners Sanctuary','Admiralty Court','Fish Market Hall'],
    'cosmic-horror':['Tidal Contest Hall','Mariners Society','Enclosed Municipal Garden','Restricted Archive','Pale Playhouse','Mineral Baths','Coastal Terminal','Silent Sanctuary','Maritime Tribunal','Covered Fish Market'],
    'gothic-horror':['Fenced Tournament Yard','Restorers Guild','Cemetery Garden','Antiquarian Library','Opera House','Thermal Baths','Carriage Terminus','Great Cathedral','Chancery Hall','Covered Provision Market'],
    solarpunk:['Community Sports Terraces','Makers Cooperative','Biodiversity Park','Open Knowledge Commons','Garden Amphitheatre','Reed Filtered Baths','Cycle Transit Hub','Reflection Pavilion','Community Mediation Hall','Harvest Hall'],
    dieselpunk:['Motor Sports Arena','Industrial Union Hall','Workers Park','Technical Archive','Newsreel Palace','Workers Baths','Rail Terminal','Memorial Sanctuary','Industrial Tribunal','Shift Food Hall'],
    underwater:['Current Racing Dome','Dive Workers Association','Reef Conservatory','Marine Knowledge Vault','Acoustic Theatre','Pressure Recovery Baths','Submersible Terminal','Ocean Sanctuary','Habitat Tribunal','Algae Food Hall'],
    prehistoric:['Contest Clearing','Makers Gathering Lodge','Communal Grove','Story Keeping Lodge','Storytelling Circle','Hot Spring Shelter','Trail Exchange','Ancestor Sanctuary','Council Circle','Communal Feast Lodge'],
    'desert-fantasy':['Festival Arena','Caravan Guild','Shaded Public Garden','Astronomers Library','Courtyard Theatre','Hammam','Caravan Terminal','Star Sanctuary','Judgment Court','Covered Spice Market']
  };
  for(const [genre,names] of Object.entries(ADDITIONS))NAMES[genre].push(...names);
  const TEMPLATES={shop:'guildhall',inn:'inn',bar:'inn',workshop:'guildhall',clinic:'house',home:'house',civic:'guildhall',warehouse:'house',
    arena:'ruined_courtyard',guild:'guildhall',park:'vent_garden',library:'guildhall',theatre:'guildhall',bathhouse:'villa',
    transit:'gatehouse',temple:'roman_temple',court:'guildhall',foodhall:'market'};
  // Cells are 2.5 metres. These are venue envelopes, not a population or a promise of simulated floors.
  const PROFILES={
    shop:{width:16,depth:20,clearance:2.4,spaces:['public counter','stock room','work area'],roles:['operator','customer','supplier'],furniture:['workstation','storage','display'],service:'shop'},
    inn:{width:24,depth:28,clearance:2.4,spaces:['reception','common room','guest chambers','kitchen'],roles:['host','guest','housekeeper'],furniture:['workstation','sleeping','food','seat'],service:'shop'},
    bar:{width:20,depth:24,clearance:2.6,spaces:['serving counter','seating room','kitchen','cellar access'],roles:['host','patron','performer'],furniture:['food','seat','storage'],service:'shop'},
    workshop:{width:24,depth:28,clearance:3.2,spaces:['work floor','materials store','customer counter'],roles:['craftsperson','apprentice','customer'],furniture:['craft','storage','workstation'],service:'shop'},
    clinic:{width:24,depth:28,clearance:2.8,spaces:['reception','treatment ward','supply room'],roles:['healer','patient','assistant'],furniture:['medical','storage','seat'],service:'temple'},
    home:{width:16,depth:18,clearance:2.4,spaces:['living room','sleeping room','kitchen'],roles:['resident','visitor','neighbor'],furniture:['sleeping','food','seat']},
    civic:{width:28,depth:32,clearance:4,spaces:['public hall','meeting rooms','records office'],roles:['clerk','petitioner','delegate'],furniture:['workstation','seat','display']},
    warehouse:{width:32,depth:36,clearance:4.8,spaces:['loading floor','storage bays','dispatch office'],roles:['porter','dispatcher','supplier'],furniture:['storage','transport','workstation']},
    arena:{width:56,depth:48,clearance:8,spaces:['competition floor','spectator galleries','contestant rooms','public entrance'],roles:['official','contestant','spectator'],furniture:['barrier','seat','display'],monumental:true},
    guild:{width:32,depth:36,clearance:4.2,spaces:['assembly hall','training rooms','members rooms','records office'],roles:['member','apprentice','visitor'],furniture:['craft','seat','communication']},
    park:{width:40,depth:40,clearance:0,spaces:['public paths','garden courts','seating terraces'],roles:['gardener','visitor','street performer'],furniture:['seat','display','barrier'],openAir:true},
    library:{width:32,depth:36,clearance:4.8,spaces:['reading hall','archive rooms','research desks'],roles:['archivist','reader','researcher'],furniture:['storage','research','seat']},
    theatre:{width:40,depth:44,clearance:6.4,spaces:['stage','auditorium','backstage rooms','foyer'],roles:['performer','stage worker','audience member'],furniture:['display','seat','storage'],monumental:true},
    bathhouse:{width:32,depth:36,clearance:4,spaces:['reception','bathing hall','changing rooms','service rooms'],roles:['attendant','visitor','caretaker'],furniture:['medical','seat','device']},
    transit:{width:36,depth:40,clearance:5,spaces:['arrival concourse','waiting hall','dispatch office'],roles:['dispatcher','traveler','porter'],furniture:['transport','communication','seat']},
    temple:{width:44,depth:52,clearance:7.2,spaces:['processional nave','sanctuary','side chapels','assembly court'],roles:['caretaker','pilgrim','celebrant'],furniture:['display','seat','communication'],service:'temple',monumental:true},
    court:{width:32,depth:36,clearance:4.8,spaces:['public hearing hall','petitioners gallery','records rooms'],roles:['adjudicator','petitioner','scribe'],furniture:['workstation','seat','storage']},
    foodhall:{width:32,depth:36,clearance:4,spaces:['food counters','communal seating','supply bays'],roles:['vendor','diner','supplier'],furniture:['food','seat','storage'],service:'shop'}
  };
  function profile(type){const p=PROFILES[type];return p?{...p,spaces:p.spaces.slice(),roles:p.roles.slice(),furniture:p.furniture.slice(),metresPerCell:2.5}:null;}
  const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
  function name(type,genre='fantasy'){return (NAMES[genre]||NAMES.fantasy)[TYPES.indexOf(type)]||'Establishment';}
  function descriptor({seed='',cityId,streetKey,genre='fantasy',scale='city',district='residential',mix=TYPES}){
    return{version:1,seed,cityId,streetKey,genre,scale,district,mix:[...new Set(mix.filter(t=>TYPES.includes(t)))],count:scale==='metropolis'?64:scale==='city'?28:8};
  }
  function frontages(d){
    if(d?.version!==1||!NAMES[d.genre])return[];
    const mix=d.mix?.filter(t=>TYPES.includes(t));if(!mix?.length)return[];
    return Array.from({length:Math.max(0,Math.min(64,d.count||0))},(_,i)=>{
      const id=`${d.cityId}:${d.streetKey}:frontage:${i}`,n=hash(`${d.seed}:${id}`),type=mix[n%mix.length];
      return{id,type,name:['Corner','Lantern','Crossing','Old','Market','Courtyard','Bridge','Evening'][n%8]+' '+name(type,d.genre),
        side:i%2?'right':'left',slot:Math.floor(i/2),seed:n,service:type==='shop'||type==='workshop'?'shop':null,
        interactionPolicy:'investigation-or-encounter-may-author-persistent-content',authored:false};
    });
  }
  function servicePlan(building){
    if(!building||building.servicesAvailable===false||!TYPES.includes(building.type)||['home','park'].includes(building.type))return null;
    const kind=PROFILES[building.type].service||null;
    return{kind,capabilities:[...(kind==='shop'?['trade']:kind==='temple'?['healing']:[]),...(building.type==='inn'?['lodging']:[])],
      deskCapabilities:['commission',...(building.type==='inn'?['lodging']:[])]};
  }
  function serviceNotice(building){
    const plan=servicePlan(building);if(!plan)return null;
    if(plan.capabilities.includes('lodging'))return 'Trade and Lodging Inside';
    return plan.kind==='shop'?'Trade Inside':plan.kind==='temple'?'Healing Services Inside':'Work Inquiries Inside';
  }
  function operators(binding){
    return [...new Set([binding?.operator,...(Array.isArray(binding?.attendants)?binding.attendants:[])])].filter(n=>typeof n==='string'&&n.trim());
  }
  return{TYPES,NAMES,TEMPLATES,PROFILES,profile,hash,name,descriptor,frontages,servicePlan,serviceNotice,operators};
});
