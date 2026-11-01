'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const requests=[],notices=[],applied=[],popups=[];
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.listeners={};}
    appendChild(child){this.children.push(child);return child;}
    setAttribute(){}
    addEventListener(type,fn){this.listeners[type]=fn;}
    remove(){this.removed=true;}
    click(){return this.listeners.click?.();}
  }
  const document={readyState:'loading',addEventListener(){},hidden:false,activeElement:{tagName:'BODY'},body:{appendChild:p=>popups.push(p)},
    createElement:t=>new Element(t),getElementById:()=>null,querySelectorAll:()=>[],
    querySelector:s=>s.includes('popup-container')?popups.find(p=>!p.removed)||null:null};
  const dungeon={geoKey:'0,0,0',_geometryStamp:'saved',cells:{},tiles:{},sceneStructures:[],
    sceneObjects:[{name:'brass key',x:5,y:4}],sceneExteriors:{buildings:[{entrance:'closed-gate',direction:'north',
      doorway:{x:10,y:10,floor:0},wallHeight:12,transverse:7,depth:7,targetKey:'0,1,0'}]}};
  for(let y=0;y<18;y++)for(let x=0;x<18;x++)dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  dungeon.cells['8,10']={tile:'wall',floorHeight:0,ceilHeight:12,exteriorRole:'shell-wall',exteriorDestination:'0,1,0'};
  const player={x:4.5,y:4.5};
  const window={document,currentDungeon:dungeon,dungeonRunId:'run',PlayerControls:{autoTake:()=>true},
    getDungeonLifeContext:()=>({dungeon:window.currentDungeon,player,actors:[]}),
    prepareEconomyState:async()=>{},DungeonActionNotices:{receive:event=>notices.push(event)},
    applyRealtimeCombatResult:async event=>{applied.push(event);if(event.type==='economy_result')dungeon.sceneObjects=[];}};
  const fetch=async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,body});
    return{ok:true,json:async()=>path==='/economy/view'?{revision:4,sceneObjects:dungeon.sceneObjects}:
      {type:'economy_result',eventId:'taken',runId:'run',geoKey:dungeon.geoKey}};};
  const context=vm.createContext({window,document,fetch,console});
  for(const file of ['sceneExteriorDetails','objectDiscovery','worldInteractionUi','commerceUi','itemInteractionUi'])
    vm.runInContext(fs.readFileSync(`assets/${file}.js`,'utf8'),context);
  const camera={...player,eyeZ:.65,dirX:1,dirY:0,planeScale:.577,verticalScale:1.73,aspect:1.8,viewShift:0,
    billboards:[{type:'item',item:dungeon.sceneObjects[0],key:'5,4',label:'brass key',distance:1,enabled:true,
      pixels:{w:4,h:4,data:new Uint8Array(64).fill(255)},screen:{left:.4,right:.6,top:.4,bottom:.6}}]};
  const canvas={style:{}};
  const source=fs.readFileSync('assets/rendererWebGL.js','utf8');
  const select=source.match(/const dungeon = window\.SceneExteriorDetails[^;]+;/)[0];
  const bridge=source.match(/window\.WorldInteractionUi\?\.updateFrame\([^;]+;/)[0];
  function frame(){context.voxelCamera=camera;context.playerWorldX=player.x;context.playerWorldY=player.y;
    vm.runInContext(`(function(){${select}${bridge}}).call({canvas:window.testCanvas})`,context);}
  window.testCanvas=canvas;
  return{window,document,dungeon,player,camera,requests,notices,applied,popups,frame};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('decorated WebGL exteriors discover loot on the authoritative room, without changing saved collision geometry',()=>{
  const f=fixture(),view=f.window.SceneExteriorDetails.forRendering(f.dungeon),cells=JSON.stringify(f.dungeon.cells);
  assert.notEqual(view,f.dungeon,'exercise the real render-only clone, not a stub');f.frame();
  assert.equal(f.window.ObjectDiscovery.isVisible(f.dungeon,'brass key'),true);
  assert.equal(f.window.ObjectDiscovery.isVisible(view,'brass key'),false);
  assert.deepEqual(Array.from(f.window.ObjectDiscovery.snapshot(f.dungeon).names),['brass key']);
  assert.deepEqual(Array.from(f.dungeon.objectDiscoveries.names),['brass key']);
  assert.equal(JSON.stringify(f.dungeon.cells),cells);assert.equal(f.dungeon._geometryStamp,'saved');
});
test('automatic pickup crosses the real render-discovery-commerce path exactly once',async()=>{
  const f=fixture();f.frame();
  f.window.ItemInteractionUi.update(f.dungeon,f.dungeon.sceneObjects,f.player);await flush();
  const actions=f.requests.filter(r=>r.path==='/economy/action');assert.equal(actions.length,1);
  assert.equal(actions[0].body.item,'brass key');assert.deepEqual(actions[0].body.objectView.names,['brass key']);
  assert.equal(actions[0].body.revision,4);assert.equal(f.applied.length,1);assert.equal(f.dungeon.sceneObjects.length,0);
  f.window.ItemInteractionUi.update(f.dungeon,[],f.player);await flush();assert.equal(f.requests.length,2);
});
test('click-to-take works on a decorated exterior but hidden loot stays unavailable',async()=>{
  const f=fixture();f.frame();assert.equal(f.window.ItemInteractionUi.prompt('brass key'),true);
  const take=f.popups.at(-1).children.find(e=>e.textContent==='Take');assert.ok(take);take.click();await flush();
  assert.equal(f.requests.filter(r=>r.path==='/economy/action').length,1);
  f.camera.billboards=[];f.frame();assert.equal(f.window.ItemInteractionUi.prompt('brass key'),false);
});
test('another floor or new dungeon object at the same host coordinates never inherits loot visibility',()=>{
  const f=fixture();f.frame();const other={...f.dungeon,cityFloorContext:{hostKey:'0,0,0',buildingId:'inn',floor:1}};
  assert.equal(f.window.ObjectDiscovery.isVisible(other,'brass key'),false);
  assert.equal(f.window.ObjectDiscovery.snapshot(other),null);
  assert.match(f.window.ObjectDiscovery.takeRequest(other,'take brass key').error,/currently shown/);
});
