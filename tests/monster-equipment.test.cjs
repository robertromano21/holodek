'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Gear=require('../retort/monsterEquipment'),Items=require('../retort/itemAuthoring'),I=require('../assets/dungeonInhabitants');
const actor=(name='Ash Warden',state='Hostile')=>({Name:name,Race:'Many-limbed revenant',Class:'Fighter',State:state,Level:4,
  HP:20,MaxHP:20,AC:10,Attack:2,Damage:1,Armor:0,Magic:0,Equipped:{Weapon:null,Armor:null,Shield:null,Other:null}});
function mock({failBatch=0}={}){
  const prompts=[],batches=[];let serial=0;
  const agent={user:async(p,...values)=>prompts.push(typeof p==='string'?p:String.raw({raw:p},...values)),assistant:{generation:async()=>{
    const types=JSON.parse(prompts.findLast(p=>p.startsWith('Engine-selected item types')).match(/\[[^\]]*\]/)[0]);
    batches.push(types);return{content:JSON.stringify({items:types.map(type=>({name:`ash ${type} ${String.fromCharCode(97+Math.floor(serial/26),97+serial++%26)}`,
      type,attack_modifier:type==='weapon'?3:0,damage_modifier:type==='weapon'?4:0,ac:['armor','shield'].includes(type)?2:0,
      magic:type==='other'?1:0,consumable_kind:'none',description:'Dark fitted equipment with reinforced seams.',
      ...(failBatch&&batches.length>=failBatch?{damage_modifier:99}:{})}))})};
  }}};return{agent,prompts,batches};
}
const fullParty=[{Name:'Companion',HP:20,Level:4,Equipped:{Weapon:{name:'bronze spear',attack_modifier:4,damage_modifier:5},
  Armor:{name:'ring coat',ac:2},Shield:{name:'round shield',ac:2}}}];
test('loadouts are per monster, never capped at four items for the room',async()=>{
  const actors=Array.from({length:9},(_,i)=>actor('Ash Warden '+i)),rt=mock();
  const gear=await Gear.equip(rt.agent,actors,{party:fullParty,random:()=>0});
  assert.equal(gear.length,27);assert.deepEqual(rt.batches.map(b=>b.length),[8,8,8,3]);
  for(const a of actors){assert.equal(Object.values(a.Equipped).filter(Boolean).length,3);assert.ok(a.Equipped.Weapon&&a.Equipped.Armor&&a.Equipped.Shield);
    assert.equal(a.Attack,5);assert.equal(a.Damage,5);assert.equal(a.Armor,4);assert.equal(a.AC,14);}
  assert.equal(new Set(gear.map(i=>i.name)).size,gear.length);
});
test('party equipment is authoring context, not just party level; Mortacia does not force the loadout floor',()=>{
  const rt=Gear.plan([actor()],{party:fullParty,random:()=>0});
  assert.equal(rt.assignments.length,3);assert.equal(rt.party[0].items[0].damage_modifier,5);
  assert.equal(Gear.plan([actor()],{party:[{...fullParty[0],Name:'Mortacia'}],random:()=>0}).assignments.length,1);
  assert.throws(()=>Gear.plan([actor()],{random:()=>NaN}),/roll/);
  const [party]=Gear.loadouts([{name:'Traveller',HP:10,Attack:8,equipped:{Shield:'round shield'}}],
    'Inventory Properties: {"name":"round shield","type":"shield","attack_modifier":0,"damage_modifier":0,"ac":2,"magic":0}');
  assert.equal(party.items[0].ac,2);assert.equal(party.totals.attack,8);
  const sheet='Traveller\nFemale\nHuman\nFighter\nLevel: 4\nAC: 12\nXP: 0\nHP: 0\nMaxHP: 20\nEquipped: Weapon: None, Armor: None, Shield: new shield, Other: None\nAttack: 3\nDamage: 4\nArmor: 2\nMagic: 0\nState: Unconscious';
  const [fresh]=Gear.loadouts([{name:'Traveller',HP:20,equipped:{Weapon:'old spear'}}],'PC:\n'+sheet+'\nMonsters in Room: None');
  assert.equal(fresh.active,false);assert.deepEqual(fresh.items.map(i=>i.name),['new shield']);
});
test('the original one-to-three loadouts include peaceful monsters and all four distinct slots',()=>{
  const types=new Set();
  for(const value of[0,.3,.6,.99]){
    const p=Gear.plan([actor('Keeper','Friendly'),actor('Resident','Neutral')],{random:()=>value});
    for(const type of p.assignments.map(a=>a.type))types.add(type);
    for(const owner of['Keeper','Resident']){const items=p.assignments.filter(a=>a.owner===owner);assert.ok(items.length>=1&&items.length<=3);
      assert.equal(new Set(items.map(a=>a.slot)).size,items.length);}
  }
  assert.deepEqual([...types].sort(),[...Items.TYPES].sort());
});
test('personal equipment uses the room-item schema, owner anatomy and current setting without consumable substitutions',async()=>{
  const rt=mock(),a=actor();await Gear.equip(rt.agent,[a],{party:fullParty,random:()=>0});
  const text=rt.prompts.join('\n');assert.match(text,/Many-limbed revenant/);assert.match(text,/bronze spear/);
  assert.match(text,/wearable or mounted/);assert.match(text,/consumable_kind must be none/);
  assert.throws(()=>Items.validate({items:[{name:'healing vial',type:'other',attack_modifier:0,damage_modifier:0,ac:0,magic:4,
    consumable_kind:'healing',description:'A sealed vial.'}]},{count:1,allowHealing:false}),/reusable/);
});
test('a later authoring failure never partially equips actors',async()=>{
  const rt=mock({failBatch:2}),actors=Array.from({length:4},(_,i)=>actor('Warden '+i)),before=JSON.stringify(actors);
  await assert.rejects(Gear.equip(rt.agent,actors,{party:fullParty,random:()=>0}),/damage_modifier/);
  assert.equal(JSON.stringify(actors),before);
});
test('equipment modifiers, shield type, owner and physical description survive console normalization and persistence',async()=>{
  const rt=mock(),a=actor(),items=await Gear.equip(rt.agent,[a],{party:fullParty,random:()=>0});
  const sheet=`${a.Name}\nFemale\n${a.Race}\n${a.Class}\nLevel: 4\nAC: ${a.AC}\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: ${Object.entries(a.Equipped).map(([k,v])=>k+': '+(v?.name||'None')).join(', ')}\nAttack: ${a.Attack}\nDamage: ${a.Damage}\nArmor: ${a.Armor}\nMagic: ${a.Magic}\nState: Hostile`;
  const population=I.createPopulation('1,0,0',[{name:a.Name,race:a.Race,class:a.Class,allegiance:'Hostile'}]);
  population.initialSheets=sheet;population.equipmentProperties=Gear.serialize(items);
  const value=I.withStates('Monsters in Room:\n'+sheet+'\nMonsters Equipped Properties: None\nMonsters State: Hostile\n',population);
  const parsed=I.parseEquipmentProperties(value.match(/^Monsters Equipped Properties: (.*)$/m)[1]);
  assert.equal(parsed.length,3);const shield=parsed.find(p=>p.type==='shield');assert.equal(shield.ac,2);
  assert.equal(shield.owner,a.Name);assert.equal(shield.slot,'Shield');assert.match(shield.description,/reinforced/);
  assert.equal(I.parseSheets(value)[0].armor,4);
  assert.deepEqual(I.parseEquipmentProperties(Gear.merge(Gear.serialize(items.slice(0,1)),items.slice(1))),parsed);
});
test('normal and supplemental production paths both equip through the shared service after validation',()=>{
  const normal=fs.readFileSync('retort/retortWithUserInput.js','utf8'),random=fs.readFileSync('retort/randomEncounters.js','utf8');
  for(const source of[normal,random])assert.match(source,/equipPopulation: actors => require\('\.\/monsterEquipment'\)\.equip/);
  assert.doesNotMatch(fs.readFileSync('retort/inhabitantGeneration.js','utf8'),/equipment\.length < 4/);
  assert.match(random,/p\.equipmentProperties=gear\.merge/);
});
