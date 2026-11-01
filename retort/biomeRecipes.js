'use strict';
// Approved combinations reuse real terrain and prop drawers, never model-invented assets.
const rows=[
  ['mistwood_terraces','fantasy','forest',['terraces','hill'],['buttress_roots','shelf_fungi','stone_cairn'],'living','Mistwood terraces: a living upland forest on broad walkable shelves, root hollows and mossy cairns.'],
  ['mourning_orchard','dark-fantasy','forest',['ridge','terraces'],['hollow_log','uprooted_rootball','toadstool_ring'],'dead','A mourning orchard of hollow trees, sunken garden terraces and empty fruit niches.'],
  ['alabaster_barrens','mythic','badlands',['mesa','terraces'],['layered_outcrop','wind_carved_arch','stone_cairn'],'none','Alabaster barrens: pale wind-cut mesas, ceremonial cairns and broad mineral terraces beneath open sky.'],
  ['basalt_glass_fields','sci-fi','volcanic',['caldera','ridge'],['basalt_columns','lava_spatter','fumarole_vent'],'none','Basalt glass fields: an exposed planetary survey zone of cooling lava shelves, dark columns and steam vents.'],
  ['reclamation_marsh','cyberpunk','wetland',['basin'],['driftwood_tangle','reed_tussock','layered_outcrop'],'reeds','Reclamation marsh beyond the built city: flooded retention ground, reed islands, silt ridges and runoff channels.'],
  ['saltwind_pan','post-apocalyptic','flat',[],['layered_outcrop','glacial_erratic','stone_cairn'],'none','Saltwind pan: an exposed dry lake bed, low scattered erratics and caravan cairns, not a city district.'],
  ['mineral_fen','steampunk','geothermal',['thermal_basin','terraces'],['mineral_cone','fumarole_vent','reed_tussock'],'reeds','Mineral fen: warm spring terraces and reed pools, with dry raised paths between mineral cones.'],
  ['painted_gulch','western','badlands',['canyon','butte','hoodoo'],['eroded_hoodoo','mushroom_rock','talus_fan'],'arid','Painted gulch: striped canyon walls, narrow buttes, eroded hoodoos and a broad traversable wash.'],
  ['coastal_heath','modern','forest',['hill','ridge'],['stone_cairn','layered_outcrop','reed_tussock'],'reeds','Coastal heath outside the town: low windswept ridges, marsh pockets and stony walking paths.'],
  ['estuary_mudbanks','noir','wetland',['basin'],['driftwood_tangle','hollow_log','reed_tussock'],'reeds','Estuary mudbanks beyond the docks: tidal shallows, driftwood and low reed banks, distinct from the city waterfront.'],
  ['mangrove_reach','nautical','wetland',['basin'],['buttress_roots','driftwood_tangle','reed_tussock'],'living','Mangrove reach: living tidal woodland, exposed roots and navigable dry banks above the channels.'],
  ['listening_karst','cosmic-horror','badlands',['canyon','hoodoo'],['wind_carved_arch','layered_outcrop','stone_cairn'],'none','Listening karst: an exposed tidal limestone maze with wind-hollowed arches and a broad channel floor.'],
  ['yew_moor','gothic-horror','forest',['ridge','hill'],['uprooted_rootball','hollow_log','stone_cairn'],'dead','Yew moor: wind-bent dark woodland on misty ridges, root hollows and paths between old cairns.'],
  ['canopy_reservoir','solarpunk','wetland',['basin'],['reed_tussock','buttress_roots','shelf_fungi'],'living','Canopy reservoir: a living water-retention woodland with planted banks, roots and clear community footpaths.'],
  ['slag_escarpment','dieselpunk','volcanic',['cliff','terraces'],['basalt_columns','talus_fan','lava_spatter'],'none','Slag escarpment outside the industrial city: cooled clinker shelves, dark rock faces and broad ramps.'],
  ['vent_garden','underwater','geothermal',['thermal_basin','terraces'],['mineral_cone','fumarole_vent','basalt_columns'],'none','Submerged vent garden: mineral chimneys and broad seafloor terraces outside the pressure habitat. No open-air trees.'],
  ['fern_basin','prehistoric','forest',['basin','terraces','hill'],['buttress_roots','shelf_fungi','uprooted_rootball'],'living','Fern basin: a lush primeval woodland with large roots, fungi, walkable basin shelves and shallow hollows.'],
  ['gypsum_wadi','desert-fantasy','badlands',['canyon','mesa','terraces'],['wind_carved_arch','eroded_hoodoo','layered_outcrop'],'arid','Gypsum wadi: pale mineral cliffs and wind-carved arches framing a broad dry riverbed with terraced banks.'],
  ['ashen_bonewood',null,'forest',['hill','terraces'],['hollow_log','uprooted_rootball','stone_cairn'],'dead','Ashen bonewood in Tartarus: pale hollow trees and exposed roots on ash terraces beneath the yellow sky.'],
  ['cinder_delta',null,'volcanic',['caldera','terraces'],['basalt_columns','sulfur_crust','fumarole_vent'],'none','A cinder delta of cooled basalt fans, sulfur crusts and smoking fissures beyond the underworld settlements.'],
  ['glass_desert',null,'badlands',['mesa','hoodoo','canyon'],['wind_carved_arch','eroded_hoodoo','talus_fan'],'none','A glass desert in Tartarus: wind-polished hoodoos and split rock arches above broad ash-filled canyon paths.']
];
const CATALOG=Object.freeze(Object.fromEntries(rows.map(([id,genre,terrain,relief,props,vegetation,description])=>[id,Object.freeze({id,genre,terrain,relief,props,vegetation,description})])));
function eligible(id,world){const recipe=CATALOG[id];return !recipe || (recipe.genre===null?!world:!!world?.genres?.includes(recipe.genre));}
function resolve(spec={},world=require('./settingLayer').current()){
  if(spec.indoor!==false||spec.city||spec.biome==='city')return null;
  const id=spec.biomeRecipe?.id||spec.source?.environmentIntent?.template;
  return CATALOG[id]&&eligible(id,world)?CATALOG[id]:null;
}
const TEMPLATES=rows.map(([id,,,,,,description])=>[id,false,'wasteland','natural',description,'Name this physical biome distinctly; preserve its ecology and traversable routes.']);
module.exports={CATALOG,TEMPLATES,eligible,resolve};
