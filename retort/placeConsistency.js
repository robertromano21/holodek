'use strict';
// Read-only diagnostics for generated room checkpoints and archived builder-state snapshots.
function audit(database={}){
  const db=typeof database==='string'?JSON.parse(database):database,world=db['0,0,0']?.setting,findings=[];
  for(const [key,r]of Object.entries(db)){
    if(!r||typeof r!=='object')continue;
    const spec=r.sceneSpec,city=r.cityRoom||r.citySites&&r.environmentIntent?.citySite;
    const add=(code,evidence)=>findings.push({key,room:r.name,code,evidence});
    if(city&&spec&&spec.biome!=='city')add('CITY_BIOME_MISMATCH',{savedCity:city.cityName||city.name,renderBiome:spec.biome});
    if(city&&spec?.biomePropsPlan?.profiles?.includes('badlands'))add('URBAN_BADLANDS_DRESSING',{profiles:spec.biomePropsPlan.profiles});
    if(city&&spec?.vegetationPlan?.enabled&&['wasteland','scorched'].includes(spec.vegetationPlan.profile))add('URBAN_DEFAULT_DEAD_FOREST',{profile:spec.vegetationPlan.profile});
    if(world?.kind==='homebrew'&&/Tartarus|Throne Room of Hades/.test(JSON.stringify(spec?.worldContext?.campaign||{})))add('FOREIGN_CAMPAIGN_CONTEXT',{campaign:spec.worldContext.campaign});
    if(r.populationComplete&&require('./serviceRoles').market(r,r.campaignSetting)&&!Object.values(r.services||{}).some(s=>s.kind==='shop'))add('MARKET_WITHOUT_BOUND_SERVICE',{actors:Object.keys(r.inhabitants?.actors||{})});
    // Scenery alone cannot establish a settlement; flag a named starting city that was never bound.
    if(key==='0,0,0'&&world?.cities?.some(c=>c.name===world.topology?.start)&&!r.environmentIntent?.citySite)add('STARTING_CITY_UNBOUND',{startingPlace:world.topology.start});
  }
  return{version:1,rooms:Object.keys(db).length,findings};
}
module.exports={audit};
