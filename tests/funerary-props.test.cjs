'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCanvas}=require('canvas'),R=require('../assets/readableItems'),P=require('../assets/physicalPuzzles');
const V=require('../assets/scenePropVoxels'),Props=require('../assets/renderSceneProps'),AV=require('../retort/assemblyVocab');
const {prepare}=require('../retort/readableActions');
const rows=()=>R.fixtureTypes.map((type,i)=>({type,name:['tablet of the departed','grave of the mason','tomb of the witnesses','sarcophagus of the keeper'][i],
  title:['The Law of Shelter','The Mason Remembered','The Witnesses','The Keeper'][i],backstory:'Erected by the departed beneath Mortacia\'s wings.',
  text:'The first refuge sheltered the dead when sand buried the old road.',role:i===0?'mechanism_clue':'lore',motif:i===0?'Dragon':'Skull'}));
function definition(){return P.compile({...P.fallback('funerary','Mason Crypt'),inscriptions:rows()});}
function dungeon(){
  const d={geoKey:'0,0,0',layout:{width:24,height:24},start:{x:12,y:12},cells:{},tiles:{},sceneObjects:[]};
  for(let y=0;y<24;y++)for(let x=0;x<24;x++)d.cells[`${x},${y}`]={tile:x===0||y===0||x===23||y===23?'wall':'floor',floorHeight:0,ceilHeight:3};
  return d;
}
test('funerary fixtures have distinct solid voxel and map profiles, not a generic crate',()=>{
  const voxels=new Set(),sprites=new Set();
  for(const type of R.fixtureTypes){
    assert.equal(V.select('ancient_'+type),type);assert.equal(Props.resolveLandmarkDrawer(type),type);
    assert.ok(AV.ARCH_KITS.includes(type));const grid=V.build(type,24);assert.ok(grid.some(Boolean));voxels.add(Buffer.from(grid).toString('base64'));
    const canvas=createCanvas(320,320);Props.drawLandmarkSprite(canvas.getContext('2d'),createCanvas,type,{inscription:{motif:'Dragon'}});
    sprites.add(canvas.toBuffer().toString('base64'));
  }
  assert.equal(voxels.size,4);assert.equal(sprites.size,4);
  assert.equal(V.select('inscribed stele'),'stone_tablet');assert.equal(V.select('weathered headstone'),'gravestone');
});
test('inscription records persist apart from item properties, without replacing or granting loot',()=>{
  const p=definition(),room={objects:[{name:'old sword',type:'weapon'}]},text='Objects in Room: old sword\nObjects in Room Properties: {name: "old sword", type: "weapon", magic: 1}';
  assert.equal(R.spawn(p,room,text),text);assert.equal(room.objects.length,1);assert.equal(room.inscriptions.length,4);
  const before=JSON.stringify(room);R.spawn(p,room,text);assert.equal(JSON.stringify(room),before);
  for(const patch of [{type:'unbuilt_tomb'},{name:'3'},{text:''},{motif:'unknown'},{text:'x'.repeat(651)}])assert.throws(()=>R.validateInscriptions([{...rows()[0],...patch}]));
  assert.throws(()=>R.validateInscriptions([...rows(),rows()[0]]),/four/);
  assert.throws(()=>P.compile({...p,readables:[{kind:'scroll',name:p.inscriptions[0].name,title:'Clashing Names'}]}));
});
test('new room construction places all four inscriptions and all nine portable objects on accessible separate cells',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-inscriptions-')),prior=process.env.HOLODEK_SPRITE_DIR;
  process.env.HOLODEK_SPRITE_DIR=tmp;delete require.cache[require.resolve('../retort/sceneRoomBuilder')];
  try{
    const {applySceneGraphics,placeSceneLandmarks,placeSceneObjects,applySurfaceArt}=require('../retort/sceneRoomBuilder');
    const d=dungeon(),p=definition(),spec={puzzleMechanism:p,landmarks:[],source:{description:'A burial crypt of stone tablets and graves.'},generation:{seed:'funerary'},
      props:Array.from({length:9},(_,i)=>({id:'loot_'+i,name:'loot '+i,declaredType:i<5?'weapon':'other'}))};
    P.enrichSceneSpec(spec);applySceneGraphics(d,spec,{geoKey:d.geoKey});const report=placeSceneLandmarks(d,spec);
    assert.equal(report.missing.length,0);assert.equal(report.placed.length,4);P.install(d,spec);assert.ok(P.verify(d).valid);
    placeSceneObjects(d,spec);assert.equal(d.sceneObjects.length,9);assert.equal(new Set(d.sceneObjects.map(o=>`${o.x},${o.y}`)).size,9);
    assert.ok(d.sceneObjects.every(o=>d.cells[`${o.x},${o.y}`].tile==='floor'));
    applySurfaceArt(d,spec);assert.equal(d.inscriptions.length,4);assert.equal(JSON.parse(JSON.stringify(d)).inscriptions[0].chapters[0].text,rows()[0].text);
    const room={objects:[],puzzleMechanism:p};R.spawn(p,room,'Objects in Room: None\nObjects in Room Properties: None');
    for(const lm of d.sceneLandmarks){
      const record=room.inscriptions.find(r=>r.name===lm.label),near=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:lm.x+dx,y:lm.y+dy})).find(q=>d.cells[`${q.x},${q.y}`]?.tile==='floor');
      assert.ok(near);const actor={name:'Hero',type:'pc',hp:20,mazeRoomKey:d.geoKey,mazeX:near.x,mazeY:near.y};
      const args={database:{[d.geoKey]:room},dungeon:d,consoleText:'Objects in Room: None\nInventory: Empty',geoKey:d.geoKey,actor,input:'read '+record.name};
      const plan=prepare(args);assert.ok(plan.allowed,JSON.stringify({lm,near,plan}));assert.ok(plan.message.includes(record.chapters[0].text));
      if(record.role==='mechanism_clue')assert.ok(plan.message.includes(P.clue(p)));
      assert.equal(prepare(args).message,plan.message);
      assert.equal(prepare({...args,actor:{...actor,hp:0}}).allowed,false);
      assert.equal(prepare({...args,geoKey:'0,1,0',consoleText:'Inventory: '+record.name}).allowed,false);
      const mid={x:near.x+(near.x-lm.x),y:near.y+(near.y-lm.y)};d.cells[`${near.x},${near.y}`].tile='wall';
      assert.equal(prepare({...args,actor:{...actor,mazeX:mid.x,mazeY:mid.y}}).allowed,false);d.cells[`${near.x},${near.y}`].tile='floor';
    }
  }finally{
    if(prior===undefined)delete process.env.HOLODEK_SPRITE_DIR;else process.env.HOLODEK_SPRITE_DIR=prior;
    delete require.cache[require.resolve('../retort/sceneRoomBuilder')];fs.rmSync(tmp,{recursive:true,force:true});
  }
});
