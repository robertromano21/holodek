'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),
  Crowds=require('../retort/cityCrowds'),Ui=require('../assets/cityCrowdUi'),P=require('../assets/renderCharacterProcedural'),
  I=require('../assets/dungeonInhabitants');
const citizen={id:'visible-ooze',name:'Belet',sex:'Male',race:'Sluicewright Crews',
  appearance:'Mixed-ancestry engineers and laborers who maintain locks, lifts, and shutters; practical specialists whose disputes concern authority and safety.',
  genre:'fantasy',role:'customer',seed:3438810968};
test('promotion persists exactly the existing green ooze specification, not a freshly invented humanoid',()=>{
  const existing=Ui.specFor(citizen,{procedural:P,architecture:require('../assets/genreArchitecture')}),actor={name:citizen.name,hp:7};
  assert.equal(existing.traits.bodyPlan,'ooze');assert.equal(Crowds.preserveBody(actor,citizen),true);
  assert.deepEqual(actor.sprite.spec,existing);assert.equal(actor.sprite.appearanceLocked,true);
  const saved=JSON.parse(JSON.stringify(actor));assert.equal(Crowds.preserveBody(saved,{...citizen,role:'different'}),false);
  assert.deepEqual(saved.sprite.spec,existing);assert.equal(saved.hp,7);
});
test('normal population attachment cannot replace the resident visual identity',()=>{
  const actor={name:citizen.name,type:'monster'},record={name:citizen.name,hp:7,status:'present',allegiance:'Neutral'};
  Crowds.preserveBody(record,citizen);I.attach([actor],{geoKey:'0,0,0',actors:{[citizen.name]:record}});
  assert.deepEqual(actor.sprite,record.sprite);assert.deepEqual(actor.visualIdentity,record.visualIdentity);
});
test('the production sprite path renders the locked body and never requests new model traits on click or reload',()=>{
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('function getProceduralSpriteFor(entry)'),
    end=source.indexOf('// Returns true when the entry',start),root={createTraitSpriteCanvas:()=>({toDataURL:()=> 'same-body-pixels'})};
  const get=vm.runInNewContext(source.slice(start,end)+';getProceduralSpriteFor',{window:root});
  const actor={name:citizen.name,type:'monster'};Crowds.preserveBody(actor,citizen);
  const original=JSON.stringify(actor.sprite.spec),sprite=get(actor);
  assert.equal(sprite.dataUrl,'same-body-pixels');assert.equal(JSON.stringify(sprite.spec),original);
  assert.equal(get(actor),sprite);assert.equal(get(JSON.parse(JSON.stringify(actor))).spec.key,sprite.spec.key);
});
test('older promoted residents recover their ambient body without regeneration or changing dialogue, HP or position',()=>{
  const record={name:citizen.name,hp:5,position:{x:7,y:10},dialogue:['A saved personal remark.'],status:'present',allegiance:'Neutral'},
    p={geoKey:'0,0,0',actors:{[citizen.name]:record}},d={cityCrowd:{actors:{one:{...citizen,status:'promoted'}}}},db={'0,0,0':{inhabitants:p}};
  let roster=[{name:citizen.name,type:'monster'}],writes=0;
  const state={getRoomPopulation:()=>p,setRoomPopulation(){writes++;},getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase(){},
    getCombatCharactersString:()=>JSON.stringify(roster),setCombatCharactersString:s=>roster=JSON.parse(s)};
  Crowds.repairPromoted(state,d,'0,0,0');assert.equal(writes,1);assert.equal(roster[0].sprite.spec.traits.bodyPlan,'ooze');
  assert.equal(record.hp,5);assert.deepEqual(record.position,{x:7,y:10});assert.deepEqual(record.dialogue,['A saved personal remark.']);
  Crowds.repairPromoted(state,d,'0,0,0');assert.equal(writes,1);
});
