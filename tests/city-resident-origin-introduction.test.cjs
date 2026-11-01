'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),G=require('../retort/inhabitantGeneration');
test('clicking an existing citizen in the first city authors one identity, never a starting-room population of identical names',async()=>{
  const name='Vannaraen Ilya',race='Stillwater Attendants',row=require('./fixtures/inhabitants.cjs')(1,[{slot:0,name,race,allegiance:'Neutral'}])[0];
  let calls=0;
  const $={user(){},system(){},messages:[],assistant:{generation:async request=>{
    calls++;assert.equal(request.parameters.inhabitants.maxItems,1);
    return{content:JSON.stringify({skip:false,inhabitants:[row]})};}}};
  const result=await G.generateInhabitants($,{roomName:'The First City',geoKey:'0,0,0',indoor:false,roomDescription:'A market square.',
    rooms:{'0,0,0':{name:'The First City'}},encounter:{count:1,races:[race],identity:{name,race}}},
    {random:()=>3,level:()=>1,sex:()=> 'Female',xp:()=>0,equipment:async()=>null});
  assert.equal(calls,1);assert.deepEqual(Object.keys(result.population.actors),[name]);assert.equal(result.population.starting,false);
});
