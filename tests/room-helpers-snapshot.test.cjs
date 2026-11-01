'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const tile='custom_structure_v7_g_sci-fi_support_metal';
function fixture(){
  const file=require.resolve('../sharedState'),native=createRequire(file),module={exports:{}},repaints=[];
  const fake=name=>name==='node:worker_threads'?{isMainThread:false}:name==='./saveGameAssets'?{
    rebuildRoom(dungeon,key){repaints.push(key);return native('./saveGameAssets').rebuildRoom(dungeon,key,{
      generateSprite(){throw Error('Unexpected repaint');},sceneGraphics(){throw Error('Unexpected scene rebuild');}});}
  }:native(name);
  vm.compileFunction(fs.readFileSync(file,'utf8'),['require','module','exports','__dirname','console'],{filename:file})(
    fake,module,module.exports,path.dirname(file),{log(){},info(){},warn(){}});
  const state=module.exports,snapshot=state.exportSaveState();
  snapshot.combatCharactersString='[]';snapshot.lastCoords={x:0,y:0,z:0};
  snapshot.updatedGameConsole='Room: Live city\nCoordinates: X: 0, Y: 0, Z: 0';
  snapshot.roomNameDatabaseString=JSON.stringify({'0,0,0':{name:'Live city'},'0,1,0':{name:'Adjacent room'}});
  snapshot.roomDungeonDatabase={'0,0,0':{geoKey:'0,0,0',layout:{width:2,height:2},cells:{'0,0':{tile}},customTiles:[],
    visualStyle:{palette:['#222222','#999999']},tiles:{[tile]:{url:'/sid/sprites/existing-support.png',
      spriteSpec:{width:8,height:8,voxels:[{x:0,y:0,z:0,color:'#555555'}]}}}},
    '0,1,0':{geoKey:'0,1,0',layout:{width:2,height:2},cells:{'0,0':{tile:'floor'}},tiles:{},customTiles:[]}};
  return {state,snapshot,repaints};
}
for(const stage of ['all','quest'])test(`local ${stage} worker imports live structural graphics without repaint or recipe failure`,async()=>{
  const f=fixture(),before=JSON.stringify(f.snapshot),messages=[],website={},restored=[],calls=[];
  const file=require.resolve('../retort/roomBuildWorker'),native=createRequire(file),job={id:'offline-'+stage,stage,model:'selected-model'};
  let close;const closed=new Promise(resolve=>close=resolve);
  const modules={
    'node:worker_threads':{workerData:{snapshot:f.snapshot,job},parentPort:{postMessage:m=>messages.push(m),close}},
    '../sharedState':f.state,'./settingLayer':{attach(){}},'./websiteAi':{service:()=>website},
    './gameModels':{restore:m=>restored.push(m),withSnapshot:cb=>cb()},
    './retortWithUserInput':{async retortWithUserInput(input,broadcast,combat,options){
      calls.push(options);
      assert.deepEqual(f.state.getRoomDungeon({x:0,y:0,z:0}),f.snapshot.roomDungeonDatabase['0,0,0']);
      assert.deepEqual(f.state.getRoomDungeonForSimulation({x:0,y:1,z:0}),f.snapshot.roomDungeonDatabase['0,1,0']);
      assert.equal(website.useForGameModels(),false);
      options.onBuildCheckpoint({stage:stage==='quest'?'quest':'population'});
    }}
  };
  vm.compileFunction(fs.readFileSync(file,'utf8'),['require'],{filename:file})(name=>Object.hasOwn(modules,name)?modules[name]:native(name));
  await closed;
  assert.deepEqual(messages,[{type:'checkpoint',artifact:{stage:stage==='quest'?'quest':'population'}},{type:'done'}]);
  assert.deepEqual(f.repaints,[]);assert.equal(JSON.stringify(f.snapshot),before,'The host snapshot stays untouched');
  assert.deepEqual(restored,['selected-model']);assert.equal(calls.length,1);
  assert.equal(calls[0][stage==='quest'?'prepareOpeningQuest':'prepareRoom'].id,job.id);
});
test('normal disk imports still require drawing recipes instead of trusting copied URLs',()=>{
  const f=fixture();f.state.importSaveState(f.snapshot);
  assert.throws(()=>f.state.getRoomDungeon({x:0,y:0,z:0}),new RegExp('Saved custom tile lacks a drawing recipe: 0,0,0/'+tile));
  assert.deepEqual(f.repaints,['0,0,0']);
});
