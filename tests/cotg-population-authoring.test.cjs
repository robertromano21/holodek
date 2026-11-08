'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Policy=require('../retort/cotgPopulationAuthoring'),Ec=require('../retort/settingEcology');
const Setting=require('../retort/settingLayer'),Models=require('../retort/gameModels');
const {generateInhabitants}=require('../retort/inhabitantGeneration');
const fixtures=require('./fixtures/inhabitants.cjs'),{batchRows}=require('./fixtures/inhabitant-batch.cjs');
function table(canonical=true){return{version:1,canonical,originalPercent:canonical?40:0,seed:'reference-world',
  entries:Array.from({length:8},(_,i)=>({id:'ecology-'+i,name:'Reference Species '+i,description:'A specific native being.',
    habitat:'The region',society:'Independent communities',roles:['traveler','sentinel'],kind:'people',allegiance:'Neutral',weight:1}))};}
const rules={random:min=>min,level:()=>4,sex:()=>'Female',xp:()=>0,equipment:async()=>null};
function agent(rows,failFirst=false){const calls=[],prompts=[];
  const $={user:(p,...v)=>prompts.push(typeof p==='string'?p:String.raw({raw:p},...v)),assistant:{generation:async options=>{
    calls.push(options);return{content:failFirst&&calls.length===1?'invalid':JSON.stringify({inhabitants:batchRows(rows,options)})};}}};
  return{$,calls,prompts};
}

test('the original CotG race/class paragraph is retained verbatim ahead of reference policy',()=>{
  const text='Generate a fantasy race and class for an intelligent or unintelligent animal, monster, spirit or other NPC in The Ash Court from the underworld plane, Tartarus, a vast wasteland with a yellowish sky and vast mountains, consumed by hellish sandstorms and other winds, dark magics, ferocious monsters, dragons (celestial and otherwise) high magical beings and other entities of pure energy and form, angels, powerful demons.';
  assert.ok(Policy.foundation('The Ash Court').includes(text));
});

test('CotG source selection has exact 65/35 thresholds and no reference lookup on unrestricted draws',t=>{
  assert.equal(Policy.UNRESTRICTED,.65);assert.equal(Policy.INFORMED,.35);
  const choose=t.mock.method(Ec,'choose',()=>assert.fail('Unrestricted groups must not sample a reference.'));
  for(const roll of [0,.3,.64999999])assert.equal(Policy.select({seed:'test',group:'group',table:table(),roll}).mode,'unrestricted');
  assert.equal(choose.mock.callCount(),0);choose.mock.restore();
  for(const roll of [.65,.9,.999999])assert.equal(Policy.select({seed:'test',group:'group',table:table(),roll}).mode,'informed');
  const counts={unrestricted:0,informed:0};
  for(let i=0;i<10000;i++)counts[Policy.select({seed:'test',group:'group',roll:(i+.5)/10000}).mode]++;
  assert.deepEqual(counts,{unrestricted:6500,informed:3500});
});

test('one stable choice is shared by a cohort, with protected roles exempt and no state or allegiance changes',()=>{
  const make=()=>Array.from({length:8},(_,slot)=>({slot,allegiance:'Hostile',cohort:slot<4?'first':'second',encounterId:'test'}));
  const slots=make();slots[0].serviceRole='shop';slots[1].encounterId='quest-contact';
  Policy.apply(slots,{seed:'stable',table:table(),questSeed:false});
  assert.equal(slots[0].cotgAuthorship.mode,'protected');assert.equal(slots[1].cotgAuthorship.mode,'protected');
  assert.equal(slots[2].cotgAuthorship,slots[3].cotgAuthorship);
  for(const row of slots.slice(4))assert.equal(row.cotgAuthorship,slots[4].cotgAuthorship);
  assert.ok(slots.every(slot=>slot.allegiance==='Hostile'));
  const retry=make();Policy.apply(retry,{seed:'stable',table:table()});
  assert.deepEqual(retry[2].cotgAuthorship,slots[2].cotgAuthorship);
  for(const room of [{bossGate:{}},{regionalSite:{actors:['Fixed Cast']}},{builder:{mode:'hand'}},{campaignSetting:{planarRealm:{name:'Saved plane'}}}]){
    const rows=make();Policy.apply(rows,{seed:'protected',table:table(),room});assert.ok(rows.every(s=>s.cotgAuthorship.mode==='protected'));
  }
});

for(const model of ['gpt-6-luna','holodek-1'])test(model+': CotG foundation precedes secondary influence and free authored races survive retries and ecology tables',async()=>{
  const prior=Models.current().id,old=Setting.current();Setting.setActive(null);Models.restore(model);
  try{
    const rows=fixtures(8).map(row=>({...row,race:'Original Ashen Being '+row.slot,class:'Keeper of Unfinished Echoes',
      allegiance:row.slot<3?'Neutral':'Hostile',encounterId:'original-group'}));
    const f=agent(rows,true),source=table(),before=JSON.stringify(source);
    const result=await generateInhabitants(f.$,{roomName:'Ashen Threshold',roomDescription:'An inhabited underworld court.',geoKey:'2,0,0',indoor:true,
      rooms:{'0,0,0':{campaignAtlas:{ecology:source}}}},rules);
    const text=f.prompts.join('\n');
    assert.ok(text.indexOf('ORIGINAL CREATURE AUTHORING FOUNDATION')<text.indexOf('COTG SECONDARY INFLUENCE'));
    assert.match(text,/Generate a fantasy race and class for an intelligent or unintelligent animal, monster, spirit/);
    assert.doesNotMatch(text,/SAVED WORLD POPULATION SAMPLE|OPTIONAL PROCEDURAL NAME SUGGESTIONS|slot\.nameSuggestion/);
    assert.ok(f.calls.every(call=>call.parameters.inhabitants.type[0].type.race.enum===undefined));
    assert.ok(Object.values(result.population.actors).every(actor=>actor.race.startsWith('Original Ashen Being')));
    assert.equal(result.population.cotgAuthorship.unrestricted,.65);assert.equal(result.population.cotgAuthorship.informed,.35);
    assert.equal(JSON.stringify(source),before);
  }finally{Models.restore(prior);Setting.setActive(old);}
});

test('genre populations retain exact ecology lineages, existing prompts and existing optional name suggestions',async()=>{
  const old=Setting.current(),world={kind:'homebrew',...require('./fixtures/authored-world.cjs')('cyberpunk')},source=table(false);
  Setting.setActive(world);
  try{
    const I=require('../assets/dungeonInhabitants');
    const rows=fixtures(8).map(row=>{const h=I.hash(`${source.seed}:2,0,0:population:${row.slot}`);let n=0;
      return{...row,race:Ec.choose(source,{},()=>((h+Math.imul(++n,2654435761))>>>0)/4294967296).name};});
    const f=agent(rows),result=await generateInhabitants(f.$,{roomName:'Relay Annex',geoKey:'2,0,0',indoor:true,
      rooms:{'0,0,0':{setting:{...world,ecology:source}}}},rules);
    assert.match(f.prompts.join('\n'),/SAVED WORLD POPULATION SAMPLE/);
    assert.match(f.prompts.join('\n'),/OPTIONAL PROCEDURAL NAME SUGGESTIONS/);
    assert.doesNotMatch(f.prompts.join('\n'),/ORIGINAL CREATURE AUTHORING FOUNDATION|COTG SECONDARY INFLUENCE/);
    assert.equal(result.population.cotgAuthorship,undefined);
    assert.ok(Object.values(result.population.actors).every(actor=>actor.race.startsWith('Reference Species')));
  }finally{Setting.setActive(old);}
});

test('existing named citizens retain their exact race and name with no secondary influence roll',async()=>{
  const old=Setting.current();Setting.setActive(null);
  try{
    const f=agent(fixtures(1,[{slot:0,name:'Saved Citizen',race:'Saved Form'}]));
    const result=await generateInhabitants(f.$,{roomName:'Court',geoKey:'2,0,0',indoor:true,
      encounter:{count:1,identity:{name:'Saved Citizen',race:'Saved Form'},races:['Saved Form'],catalog:[]}},rules);
    assert.deepEqual(f.calls[0].parameters.inhabitants.type[0].type.race.enum,['Saved Form']);
    assert.equal(result.population.actors['Saved Citizen'].race,'Saved Form');assert.equal(result.population.cotgAuthorship,undefined);
  }finally{Setting.setActive(old);}
});
