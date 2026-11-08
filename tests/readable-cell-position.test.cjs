'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepare}=require('../retort/readableActions');
function fixture(){
 const record={id:'inscription_0',name:'tablet of the welcome rite',kind:'inscription',mechanismId:'welcome',title:'Welcome',chapters:[{title:'Inscription',text:'Remember the departed.'}]};
 const dungeon={cells:{},tiles:{custom_tablet:{spriteSpec:{inscription:{...record}}}}};
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
 dungeon.cells['3,2'].tile='custom_tablet';
 return {input:'read '+record.name,consoleText:'',database:{'0,0,0':{inscriptions:[record]}},dungeon,actor:{name:'Reader',type:'pc',hp:10,mazeRoomKey:'0,0,0',mazeX:2,mazeY:2},geoKey:'0,0,0'};
}
test('custom-cell inscription without landmark reads when adjacent',()=>assert.equal(prepare(fixture()).allowed,true));
test('custom-cell inscription still rejects distant readers',()=>{const f=fixture();f.actor.mazeX=0;assert.equal(prepare(f).allowed,false);});
test('custom-cell inscription still rejects obstructed line of sight',()=>{const f=fixture();f.actor.mazeX=1;f.dungeon.cells['2,2'].tile='wall';assert.equal(prepare(f).allowed,false);});
test('existing landmark inscription remains readable',()=>{const f=fixture();f.dungeon.sceneLandmarks=[{x:3,y:2,label:'tablet of the welcome rite'}];assert.equal(prepare(f).allowed,true);});
test('existing quest writing resolution takes precedence',()=>{const f=fixture(),record=f.database['0,0,0'].inscriptions[0];f.dungeon.cells['3,2'].tile='floor';f.dungeon.questWritings=[{id:record.id,name:record.name,position:{x:3,y:2,z:.7},size:{x:.1,y:.1,z:.8}}];assert.equal(prepare(f).allowed,true);});
test('missing dungeon or cells rejects safely',()=>{const f=fixture();f.dungeon={};assert.equal(prepare(f).allowed,false);f.dungeon=null;assert.equal(prepare(f).allowed,false);});
test('custom-cell inscription supports name fallback when id is missing',()=>{const f=fixture();delete f.dungeon.tiles.custom_tablet.spriteSpec.inscription.id;assert.equal(prepare(f).allowed,true);});
test('custom-cell inscription does not match conflicting ids or mechanisms',()=>{const f=fixture(),i=f.dungeon.tiles.custom_tablet.spriteSpec.inscription;i.id='other';assert.equal(prepare(f).allowed,false);i.id='inscription_0';i.mechanismId='other';assert.equal(prepare(f).allowed,false);});
