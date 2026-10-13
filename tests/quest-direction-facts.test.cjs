'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),F=require('../retort/questDirectionFacts');
function fixture(){
  const database={'-1,-1,0':{name:'The Stonemason\'s Bastion',exits:{west:{status:'open',targetCoordinates:'-2,-1,0'},northwest:{status:'locked',key:'bastion key',targetCoordinates:'-2,0,0'}}},
    '-2,-1,0':{name:'The Sanctuary of Shattered Vows',monsters:{inRoom:'None'}},
    '-2,0,0':{name:'The Sentinel\'s Bastion',monsters:{inRoom:'Edrin Farrows'}}};
  const tasks=[{requiredElements:[{type:'monster',name:'Edrin Farrows',placement:'-2,0,0'}]}];
  return{database,tasks,state:{getRoomNameDatabase:()=>JSON.stringify(database),getLastCoords:()=>({x:-1,y:-1,z:0}),getCurrentTasks:()=>tasks,getCurrentTaskIndex:()=>0}};
}
test('NPC answers use the bound contact and actual route, not an adjacent room mentioned in prior dialogue',()=>{
  const f=fixture(),before=JSON.stringify(f.database),rows=F.facts(f.state,'ask Elyra if she has seen Edrin');
  assert.equal(rows.length,1);assert.equal(rows[0].room,'The Sentinel\'s Bastion');assert.equal(rows[0].coordinates,'-2,0,0');
  assert.deepEqual(rows[0].route,[{direction:'northwest',room:'The Sentinel\'s Bastion',locked:true,key:'bastion key'}]);
  assert.match(rows[0].presence,/not yet observed/);assert.equal(JSON.stringify(f.database),before);
  assert.match(F.prompt(rows),/deception record/);
});
test('unknown, unassigned and unrelated NPC locations remain unknown, with no task mutation or new route',()=>{
  const f=fixture();assert.deepEqual(F.facts(f.state,'look around'),[]);assert.deepEqual(F.facts(f.state,'where is someone else'),[]);
  f.database['-2,0,0'].monsters.inRoom='None';assert.deepEqual(F.facts(f.state,'where is Edrin'),[]);
  f.database['-2,0,0'].monsters.inRoom='Edrin Farrows';delete f.database['-1,-1,0'].exits.northwest;
  assert.equal(F.facts(f.state,'where is Edrin')[0].route,null);assert.equal(f.tasks[0].requiredElements[0].placement,'-2,0,0');
});
