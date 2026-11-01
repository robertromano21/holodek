'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const Balance = require('../retort/encounterBalance'), Generation = require('../retort/inhabitantGeneration');
const I = require('../assets/dungeonInhabitants'), Story = require('../retort/graveMasterStoryPrompts');
const rowsFor = require('./fixtures/inhabitants.cjs'), { batchRows } = require('./fixtures/inhabitant-batch.cjs');
const party = size => Array.from({ length: size }, (_, i) => ({ name: 'Party ' + i, type: i ? 'npc' : 'pc', hp: 20, level: 4, state: 'Alive' }));

test('routine numbers scale to living combatants, excluding monsters, downed members and noncombatants', () => {
  assert.deepEqual(Balance.partySummary([...party(3), {type:'monster',hp:99,level:50}, {type:'npc',hp:0,level:40},
    {type:'npc',hp:9,state:'Unconscious',level:20}, {type:'npc',hp:20,noncombatant:true,level:20}]), {size:3,level:4});
  assert.deepEqual(Balance.partySummary([{Name:'Mortacia',HP:100,Level:50}, {Name:'Ally',HP:12,Level:2}]), {size:2,level:2});
  for (let size = 1; size <= 12; size++) for (const roll of [0,.24,.5,.75,.999]) {
    const count = Balance.groupSize(size,roll); assert.ok(count >= 2 && count <= 6);
    if (size >= 6) assert.ok(count >= 5);
  }
});

test('cohort partitioning never leaves an ordinary solo hostile or loses a member', () => {
  for (let total = 2; total <= 24; total++) for (let target = 2; target <= 6; target++) {
    const sizes = Balance.partition(total,target);
    assert.equal(sizes.reduce((a,b)=>a+b,0),total);
    assert.ok(sizes.every(n=>n>=2&&n<=6));
  }
});

test('safe openings, existing citizen identity and scripted cast are not routine rebalance targets', () => {
  for (const options of [{starting:true}, {encounter:{identity:{name:'Existing Citizen'}}}, {party:[]}]) {
    const slots = [{slot:0,allegiance:'Hostile',encounterId:'authored'}], before = JSON.stringify(slots);
    Balance.plan(slots,{party:party(6),...options}); assert.equal(JSON.stringify(slots),before);
  }
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const start = source.indexOf('async function generateRoomInhabitantPopulation('), end = source.indexOf('RegionalAdventure.bindPopulation',start);
  const body = source.slice(start,end);
  assert.ok(body.indexOf('if (seeded?.initialSheets)') < body.indexOf('await generateInhabitants('));
  assert.match(body,/partyNames: party\.map\(a => a\.Name\), party,/);
});

async function generate({size=6,local=true,settled=false,encounter=null,starting=false,genre=false,corrupt=false}={}) {
  const prompts=[],calls=[],original=Story.isHolodek1,Setting=require('../retort/settingLayer');
  Story.isHolodek1=()=>local;
  if(genre)Setting.setActive(Setting.validateBible(Setting.localBible('The Offline World',['cyberpunk'])));
  try {
    const count=starting?2:encounter?encounter.count:settled?8:Math.max(8,Math.min(16,size+4));
    const rows=rowsFor(count,Array.from({length:count},(_,slot)=>({slot,encounterId:'unrelated-'+slot,
      ...(encounter?{allegiance:'Hostile'}:settled?slot>=3&&slot<=5?{allegiance:'Hostile'}:{allegiance:'Neutral'}:{}),
      ...(corrupt&&slot===4?{allegiance:'Neutral'}:{})})));
    const $={user:(p,...v)=>prompts.push(typeof p==='string'?p:String.raw({raw:p},...v)),assistant:{generation:async request=>{
      calls.push(request);return{content:JSON.stringify({inhabitants:batchRows(rows,request)})};
    }}};
    const result=await Generation.generateInhabitants($,{geoKey:starting?'0,0,0':'2,3,0',roomName:'The Offline Site',indoor:true,
      roomDescription:'An authored location.',party:party(size),partyNames:party(size).map(a=>a.name),
      ...(settled?{campaignSetting:{inhabited:true,city:{population:{civilianMajority:true}}}}:{}),encounter},
      {random:min=>min,level:()=>4,sex:()=>'Female',xp:()=>0,equipment:async()=>null});
    return{...result,prompts,calls,count};
  } finally {Story.isHolodek1=original;if(genre)Setting.setActive(null);}
}

for(const local of [true,false]) test(`coherent party-sized dungeon groups survive ${local?'single-slot':'multi-slot'} requests with unique names and authored profiles`,async()=>{
  const f=await generate({local});
  assert.equal(Object.keys(f.population.actors).length,10);
  const hostiles=f.population.groups.filter(g=>f.population.actors[g.members[0]].allegiance==='Hostile');
  assert.deepEqual(hostiles.map(g=>g.members.length),[6]);
  assert.equal(new Set(Object.keys(f.population.actors)).size,10);
  assert.ok(Object.values(f.population.actors).every(a=>a.history&&a.profile));
  assert.equal(f.calls.length,local?10:3,'No extra encounter planning model calls');
  if(local)assert.ok(f.prompts.some(p=>/existingMember/.test(p)&&/Resident 3/.test(p)&&/routine-1:unrelated-3/.test(p)));
  assert.ok(I.parseBlocks(f.sheets).every(a=>a.level===4),'Existing stat rules remain authoritative');
});

test('small parties get separate coherent packs, never one leftover solo',async()=>{
  const f=await generate({size:1});
  const groups=f.population.groups.filter(g=>f.population.actors[g.members[0]].allegiance==='Hostile');
  assert.deepEqual(groups.map(g=>g.members.length),[2,2]);
});

test('city threats stay optional coherent minorities; civilians and service slots are not converted',async()=>{
  const f=await generate({settled:true});
  const hostiles=Object.values(f.population.actors).filter(a=>a.allegiance==='Hostile');
  assert.equal(hostiles.length,3);assert.equal(new Set(hostiles.map(a=>a.encounterId)).size,1);
  assert.equal(f.population.encounterBalance.settled,true);
  const slots=Array.from({length:8},(_,slot)=>({slot,allegiance:'Neutral',encounterId:slot===0?'quest-contact':'visitors',
    ...(slot===1?{serviceRole:'shop'}:{}),unitId:'unit-'+slot}));
  Balance.plan(slots,{party:party(6),settled:true});
  assert.equal(slots[0].cohort,undefined);assert.equal(slots[1].cohort,undefined);
  assert.equal(new Set(slots.filter(s=>s.cohort).map(s=>s.unitId)).size,1,'A shared patrol must not be split by floor unit IDs');
  const peaceful=slots.find(s=>s.peaceful);assert.ok(peaceful);assert.equal(peaceful.allegiance,'Neutral');
});

test('genre-authored packs use their own setting and the same mechanical group plan',async()=>{
  const f=await generate({genre:true});
  assert.ok(f.prompts.some(p=>p.includes('[MODE-4 POPULATION]')));
  assert.ok(!f.prompts.some(p=>/Tartarus|Dantuea|Arithus/.test(p)));
  assert.ok(f.population.groups.some(g=>g.members.length===6&&f.population.actors[g.members[0]].allegiance==='Hostile'));
});

test('supplemental hostiles remain one group even when the model gives each member a different group label',async()=>{
  const f=await generate({encounter:{count:6,races:['Human'],catalog:[]}});
  assert.equal(f.population.groups.length,1);assert.equal(f.population.groups[0].members.length,6);
  assert.ok(Object.values(f.population.actors).every(a=>a.allegiance==='Hostile'));
});

test('contradictory cohort allegiance is rejected instead of silently turning a civilian hostile',async()=>{
  await assert.rejects(generate({corrupt:true}),/must preserve its routine cohort allegiance/);
});

test('starting residents remain friendly and do not grow to combat-party size',async()=>{
  const f=await generate({starting:true,genre:true});
  assert.equal(Object.keys(f.population.actors).length,2);
  assert.ok(Object.values(f.population.actors).every(a=>a.allegiance==='Friendly'));
});
