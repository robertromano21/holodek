'use strict';
const C=require('./generationContracts'),Work=require('./holodekRoomWork'),Legacy=require('../assets/monsterRaces'),Names=require('../assets/proceduralNames');
const enabled=()=>require('./worldFlags').on('CITY_COMPLETE')&&require('./worldFlags').on('ARCHITECTURE_EXPANSION');
function percentages(rows){
  const total=rows.reduce((n,r)=>n+r.weight,0);if(!(total>0))throw Error('An encounter population needs positive total weight.');
  const result=rows.map((r,i)=>({id:r.id,percent:Math.floor(r.weight*100/total),fraction:r.weight*100/total%1,index:i}));
  let rest=100-result.reduce((n,r)=>n+r.percent,0);
  for(const r of result.slice().sort((a,b)=>b.fraction-a.fraction||a.index-b.index))if(rest-->0)r.percent++;
  return result.map(({id,percent})=>({id,percent}));
}
function validate(table,{cotg=table?.canonical===true}={}){
  if(table?.version!==1||!Array.isArray(table.entries)||table.entries.length!==8||new Set(table.entries.map(r=>r.name.toLowerCase())).size!==8)throw Error('Eight distinct authored population groups are required.');
  if(cotg?!(table.originalPercent>=5&&table.originalPercent<=95):table.originalPercent!==0)throw Error('CotG needs both encounter sources; original-world tables cannot import CotG encounters.');
  for(const e of table.entries)if(!e.name?.trim()||!e.description?.trim()||!e.habitat?.trim()||!e.society?.trim()||!Array.isArray(e.roles)||!e.roles.length||!Number.isFinite(e.weight)||e.weight<=0||!['people','animal','construct','monster'].includes(e.kind)||!['Friendly','Neutral','Hostile'].includes(e.allegiance))throw Error('Invalid authored encounter group.');
  for(const e of table.entries)if(e.nameParts!==undefined&&!Names.validProfile(e.nameParts))throw Error('Authored name parts require three distinct alphabetic syllables per field.');
  return table;
}
async function author($,{world=null,atlas=null,seed=''}={}){
  const cotg=world?.kind!=='homebrew',local=require('./graveMasterStoryPrompts').isHolodek1();
  const facts=cotg?{campaign:'Children of the Grave',regions:atlas?.regions?.map(r=>({name:r.name,ecology:r.ecology})),
    cosmology:'Tartarus is an inhabited underworld of souls, native beings and monsters. Mortacia, Arithus and the canonical deities retain their established roles; do not author new gods or named campaign bosses as encounter species.'}:
    local?{name:world.name,genres:world.genres,peoples:world.peoples,realm:world.realm,ecology:world.wilds,history:String(world.history||'').slice(0,600),powers:world.powers}:{...world};
  if(!cotg){facts.playablePeoples=world.races;facts.adventuringTraditions=world.classes;}
  const group={name:C.nonblankText(55),description:C.nonblankText(180),habitat:C.nonblankText(80),society:C.nonblankText(100),
    roles:{type:[C.nonblankText(55)],minItems:2,maxItems:3},kind:C.choice(['people','animal','construct','monster']),
    allegiance:C.choice(['Friendly','Neutral','Hostile']),weight:{type:Number,minimum:1,maximum:100},
    nameParts:Object.fromEntries(['prefixes','middles','endings'].map(field=>[field,{type:[{...C.nonblankText(10),pattern:'^[A-Za-z]{1,10}$'}],minItems:3,maxItems:3}]))};
  const brief='SETTING ECOLOGY AUTHORING, not a gameplay turn. Invent eight distinct native population/encounter groups for this particular new world. No prefab genre encounter list is supplied: you are the author. Include ordinary peoples, travelers, nonhuman beings and unusual setting-specific creatures as appropriate; not every encounter is hostile. Give each a concrete nature/anatomy/intelligence, habitat, social life or behavior, varied possible roles and a relative frequency weight. These are kinds of beings, not eight spawned named individuals or a fixed set of quests. Do not invent engine powers, items, rewards or completed events. Future scenarios may have populations of enormous scale. Preserve this world\'s era, cosmology and peoples; private plots are not universal NPC knowledge. '+
    (cotg?'CotG also retains the entire original D&D-style catalog. Set originalPercent between 5 and 95 for that catalog; the remainder samples your new groups. Do not replace or duplicate the original catalog. ':'originalPercent must be 0: this original setting does not inherit CotG monsters. ')+
    'Provide nameParts with three distinct short alphabetic syllables each for prefixes, middles and endings, fitting this group and culture; the engine combines them into suggestions for random individual names, not species names or fixed characters. '+
    (!cotg?require('./genreCharacterPalette').direction(world)+' Populate ordinary communities with the saved playable peoples where present; do not replace them all with newly invented compound-word species. Animals and unusual monsters can extend that ecology. ':'')+
    'World facts (data): '+JSON.stringify(facts)+'. Preserve already accepted group names during bounded authoring.';
  const raw=await Work.request($,'setting-ecology',{originalPercent:cotg?{type:Number,minimum:5,maximum:95,multipleOf:1}:{type:Number,enum:[0]},
    entries:{type:C.list(group),minItems:8,maxItems:8}},brief,v=>validate({version:1,canonical:cotg,...v}),
    {arrays:{entries:{count:8,max:8,batch:1}}});
  const table={version:1,source:'model-authored',seed,canonical:cotg,originalPercent:raw.originalPercent,
    entries:raw.entries.map((r,i)=>({...r,id:'ecology-'+i}))};
  table.percentages=percentages(table.entries);validate(table);
  console.info('[SettingEcology]',JSON.stringify({status:'authored',canonical:cotg,groups:table.entries.length,originalPercent:table.originalPercent}));return table;
}
function get(database){const root=database?.['0,0,0'];return root?.setting?.ecology||root?.campaignAtlas?.ecology||null;}
function choose(table,{weights,originalPercent=table?.originalPercent}={},random=Math.random){
  validate(table);const pick=random();
  if(table.canonical&&pick*100<originalPercent)return{...Legacy[Math.min(Legacy.length-1,Math.floor(random()*Legacy.length))],source:'original-cotg'};
  const rows=table.entries.map(e=>({...e,weight:weights?.find(w=>w.id===e.id)?.weight??e.weight}));
  let n=random()*rows.reduce((sum,r)=>sum+r.weight,0);let selected=rows.at(-1);
  for(const row of rows){n-=row.weight;if(n<0){selected=row;break;}}
  return{...selected,source:'authored-setting',description:selected.description+' Habitat: '+selected.habitat+'. Social life: '+selected.society+'. Possible roles: '+selected.roles.join(', ')};
}
module.exports={enabled,author,validate,percentages,get,choose};
