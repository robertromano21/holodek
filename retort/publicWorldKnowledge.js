'use strict';
function facts(database,room){
  const world=database['0,0,0']?.setting||require('./settingLayer').current(),local=require('./dialogueContextPolicy').compact(),limit=local?180:1200;
  const take=value=>typeof value==='string'?value.slice(0,limit):undefined;
  const region=room?.campaignSetting||{},publicFacts=world?{
    name:take(world.name),genres:world.genres,realm:take(world.realm),peoples:take(world.peoples),publicHistory:take(world.publicHistory),
    foodProduction:take(region.ecology),livelihoods:Array.isArray(region.livelihoods)?region.livelihoods.slice(0,local?3:8).map(take):take(region.livelihoods),
    ...(typeof world.culture==='string'?{culture:take(world.culture)}:{})
  }:{campaign:'Children of the Grave',realm:'An inhabited underworld with cities, travelers, shades and diverse living communities.',
    foodProduction:take(region.ecology),livelihoods:region.livelihoods};
  // Deliberately excludes objective items, final opponents, private motives, hidden rooms and quest ledgers.
  return Object.fromEntries(Object.entries(publicFacts).filter(([,value])=>value!==undefined));
}
const POLICY='WORLD-BUILDING PERMISSION: These are locals, not auditors of a database. They know ordinary life: food, ingredients, cooking, customs, work and leisure. '+
  'Use public world facts to author concrete setting-fitting dishes, tastes, traditions and practical tips even when no menu was saved. Such cultural description does not spawn or give a portable item. '+
  'If an unfamiliar dish is unknown, say so briefly and offer two plausible local alternatives, rather than ending at I do not know. Preserve earlier established cultural details. '+
  'Exact named venues, operators, prices, stock, rewards and traversable directions still require saved evidence. An unbuilt cultural possibility is not an actionable destination. '+
  'A map bearing without a route is general orientation; route.via is the verified next exit. No private quest knowledge, invented transactions, foreign campaign lore or fake completed actions.';
module.exports={facts,POLICY};
