'use strict';
// Mechanics only. Hazards require literal evidence in the authored room; this never writes room prose.
const terrain=(evidence,label,shape,palette,check,damage,damageType,extra={})=>({
  evidence:[evidence],flavor:{fantasy:label,tech:label},shape,palette,height:.12,
  check:{label:check,dc:12,carefulDc:8},enterCheck:true,damage,damageType,trigger:'enter',
  choices:['cross (check)','cross carefully (lower DC)','inspect','go around'],actions:['careful'],
  outcome:{success:'crosses safely',failure:'cannot cross safely'},...extra
});
const hot=['#943c20','#51271e','#ffb54d','#291b19'],cold=['#6d9da7','#416873','#c3e5e7','#263e49'];
const acid=['#779241','#3f5229','#c3d35c','#26351c'],sand=['#aa8b55','#715c3c','#d4b779','#443723'];
const metal=['#777e82','#454c51','#dfa25a','#22282d'],mist=['#89999b','#5a6f74','#c7d4ce','#35464d'];
const spark=['#687e97','#354258','#a6dcf0','#212b3e'];
const CATALOG={
  burning_ground:terrain(/\b(?:wildfires?|burning (?:ground|debris|brush|oil|timbers?)|flaming (?:rubble|pools?))\b/i,
    'burning ground','hazard_flames',hot,'Avoid Flames','1d6','fire',{height:.8,
      actions:['careful','disarm'],disarmVerb:'extinguish',disarmLabel:'Extinguish Fire',disarmDc:14,
      choices:['cross (avoid flames check)','cross carefully (lower DC)','extinguish (check)','inspect','go around']}),
  flame_jet:terrain(/\b(?:flame (?:spouts?|jets?)|fire jets?|jets? of flame)\b/i,
    'flame spout','hazard_flames',hot,'Time the Flames','2d4','fire',{height:1,
      actions:['careful','disarm'],disarmVerb:'seal',disarmLabel:'Seal Flame Spout',disarmDc:14}),
  falling_debris:terrain(/\b(?:avalanches?|cave[ -]?ins?|falling (?:rocks?|masonry|debris|icicles)|unstable (?:ceiling|cliff))\b/i,
    'falling debris','hazard_debris',metal,'Dodge Debris','2d6','impact',{height:.5,oneShot:true,rebound:true}),
  extreme_heat:terrain(/\b(?:searing heat|scorching heat|extreme heat|superheated (?:air|chamber|ground))\b/i,
    'searing heat','hazard_heat',hot,'Endure Heat','1d4','heat',{endurance:true}),
  freezing_cold:terrain(/\b(?:extreme cold|freezing winds?|bitter cold|subzero (?:air|chamber|temperatures?))\b/i,
    'freezing cold','hazard_ice',cold,'Endure Cold','1d4','cold',{endurance:true}),
  lightning_zone:terrain(/\b(?:lightning (?:strikes?|storm|field)|electrical arcs?|arcing (?:cables?|wires?|conduits?))\b/i,
    'lightning field','hazard_sparks',spark,'Avoid the Discharge','1d6','electrical',{height:.8,
      actions:['careful','disarm'],disarmVerb:'ground',disarmLabel:'Ground the Discharge',disarmDc:15}),
  quicksand:terrain(/\b(?:quicksand|sinking sand|sucking mud|deep sucking bog)\b/i,
    'sinking ground','hazard_sand',sand,'Keep Above the Mire','1d4','strain',{rebound:true}),
  slick_ice:terrain(/\b(?:slick ice|icy (?:floor|surface|ground|paving)|black ice|deep snow|slippery (?:ice|frost))\b/i,
    'icy ground','hazard_ice',cold,'Keep Balance','1d3','bruising',{rebound:true}),
  acid_pool:terrain(/\b(?:acid (?:pools?|puddles?|spill)|corrosive (?:pools?|liquid|runoff))\b/i,
    'corrosive pool','hazard_pool',acid,'Avoid the Acid','1d6','acid',{
      actions:['careful','disarm'],disarmVerb:'neutralize',disarmLabel:'Neutralize the Spill',disarmDc:14}),
  geyser:terrain(/\b(?:boiling (?:geysers?|springs?)|scalding (?:geysers?|water jets?)|erupting geysers?)\b/i,
    'boiling geyser','hazard_geyser',cold,'Time the Geyser','2d4','scalding',{height:.8,
      actions:['careful','disarm'],disarmVerb:'seal',disarmLabel:'Seal the Geyser',disarmDc:15}),
  dense_fog:terrain(/\b(?:dense fog|thick fog|blinding (?:smoke|dust|sandstorm)|dense smoke)\b/i,
    'blinding cloud','hazard_mist',mist,'Find a Safe Path','0','none',{height:1.6,rebound:true}),
  moving_machinery:terrain(/\b(?:moving machinery|swinging (?:crane|containers?|loads?)|crushing pistons?|whirling blades?|exposed gears?)\b/i,
    'moving machinery','hazard_machinery',metal,'Time the Machinery','2d6','crushing',{height:1.1,rebound:true,
      actions:['careful','disarm'],disarmVerb:'stop',disarmLabel:'Stop the Mechanism',disarmDc:14}),
  radiation_zone:terrain(/\b(?:radiation (?:leak|hotspot|zone)|radioactive (?:debris|spill|pool)|solar flare exposure)\b/i,
    'radiation hotspot','hazard_sparks',['#647b43','#3e4d2a','#cedc73','#242e1c'],'Cross the Hotspot','1d6','radiation',{
      endurance:true,actions:['careful','disarm'],disarmVerb:'contain',disarmLabel:'Contain the Source',disarmDc:15,
      genres:['sci-fi','cyberpunk','modern','dieselpunk','steampunk','underwater','post-apocalyptic']}),
  volatile_leak:terrain(/\b(?:flammable gas leak|fuel (?:leak|vapou?rs?)|explosive gas|backdraft)\b/i,
    'volatile leak','hazard_mist',hot,'Avoid Ignition','2d6','fire',{height:1,oneShot:true,rebound:true,
      actions:['careful','disarm'],disarmVerb:'seal',disarmLabel:'Seal the Leak',disarmDc:14})
};
for(const entry of Object.values(CATALOG)){
  entry.choices=['cross ('+entry.check.label.toLowerCase()+' check)','cross carefully (lower DC)',
    ...(entry.disarmVerb?[entry.disarmVerb+' (check)']:[]),'inspect','go around'];
}
module.exports={CATALOG};
