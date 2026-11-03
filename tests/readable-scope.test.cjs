'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{prepare}=require('../retort/readableActions');
const record=(text='Original saved inscription.')=>({id:'inscription_0',mechanismId:'puzzle',name:'witness tablet',kind:'inscription',title:'Witnesses',role:'lore',chapters:[{title:'Inscription',text}]});
function fixture(){
  const r=record(),d={geoKey:'1,0,0',layout:{width:5,height:5},cells:{},tiles:{floor:{}},questWritings:[{id:r.id,name:r.name,x:2,y:2}]};
  for(let y=0;y<5;y++)for(let x=0;x<5;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  return{input:'read witness tablet',consoleText:'Coordinates: X: 1, Y: 0, Z: 0\nInventory: Empty\nObjects in Room: None',
    geoKey:'1,0,0',actor:{name:'Hero',type:'pc',hp:5,mazeX:2,mazeY:1,mazeRoomKey:'1,0,0'},dungeon:d,
    database:{'1,0,0':{inscriptions:[r]},'2,0,0':{inscriptions:[record('Unvisited text must not replace this inscription.')]}}};
}
test('a named inscription in this room is not ambiguous with an identically named prefetched room inscription',()=>{
  const f=fixture(),before=JSON.stringify(f.database),p=prepare(f);assert.equal(p.allowed,true);assert.equal(p.sourceKey,'1,0,0');
  assert.match(p.message,/Original saved inscription/);assert.doesNotMatch(p.message,/Unvisited text/);assert.equal(JSON.stringify(f.database),before);
});
test('a repeated record alias in readables and inscriptions is one fixture, not two choices',()=>{
  const f=fixture();f.database['1,0,0'].readables=[structuredClone(f.database['1,0,0'].inscriptions[0])];assert.equal(prepare(f).allowed,true);
});
test('different fixtures with the same local name still require clarification and never bypass reach checks',()=>{
  const f=fixture();f.database['1,0,0'].inscriptions.push({...record('Another distinct fixture.'),id:'inscription_1'});
  assert.equal(prepare(f).allowed,false);assert.match(prepare(f).message,/more than one/);
  const far=fixture();far.actor.mazeX=0;far.actor.mazeY=0;assert.equal(prepare(far).allowed,false);assert.match(prepare(far).message,/Walk closer/);
});
