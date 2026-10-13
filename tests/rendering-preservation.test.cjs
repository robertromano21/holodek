'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas}=require('canvas');
const game=fs.readFileSync(require.resolve('../assets/game'),'utf8'),source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8');
const tokenScales=Object.fromEntries([...game.matchAll(/^const (COMBAT_\w*TOKEN_SCALE) = ([\d.]+);/gm)].map(m=>[m[1],Number(m[2])]));
test('PCs NPCs and monsters use 1.35x while Mortacia uses an absolute 1.75x and the PC has one visible sprite',()=>{
  const context={...tokenScales};
  vm.runInNewContext(game.slice(game.indexOf('function combatMapActorSize('),game.indexOf('function ensureCombatTextureForCharacter(')),context);
  for(const type of['pc','npc','monster']){
    for(const name of['Mortacia','mortacia','Name: Mortacia'])assert.equal(context.combatMapActorSize({name,type},25),43.75);
    for(const name of['Benedict','Suzerain','Mortacian Guard'])assert.equal(context.combatMapActorSize({name,type},25),33.75);
  }
  for(const facing of['left','right']){
    const sprite={visible:true,setVisible(v){this.visible=v;}},label={visible:true,setVisible(v){this.visible=v;}},scene={pcName:'Benedict',characters:{Benedict:{sprite,label,facing}}};
    context.setCombatPlayerTokenOwner(scene,true);assert.equal(sprite.visible,false);assert.equal(label.visible,false);
    context.setCombatPlayerTokenOwner(scene,false);assert.equal(sprite.visible,true,'Overlay is restored if no RT player token can be drawn');
  }
});
test('PC redraws, position updates and roster recreation never duplicate the facing-correct token',()=>{
  const draws=[];
  function visual(key='pc',frame='frame0'){
    return{visible:true,x:0,y:0,texture:{key,has:()=>true},frame,
      setOrigin(){return this;},setDisplaySize(w,h){this.width=w;this.height=h;return this;},
      setVisible(v){this.visible=v;return this;},setPosition(x,y){this.x=x;this.y=y;return this;},
      setFlipX(v){this.flipX=v;return this;},setFrame(v){this.frame=v;return this;},destroy(){this.destroyed=true;}};
  }
  const gfx=()=>new Proxy({},{get:()=>()=>{}}),actor={name:'Mortacia',type:'pc',x:1,y:1,walkFrame:2,facing:'left',sprite:{dataUrl:'test'}};
  const context={window:{combatCharacters:[actor]},Phaser:{Scene:class{}},
    COMBAT_GRID_CENTER:1,COMBAT_CELL_SIZE:25,...tokenScales,
    currentDungeon:{cells:{'1,1':{tile:'floor',floorHeight:0,ceilHeight:3}}},dungeonTextures:{},
    getPlayerPosForMap:()=>({x:1.5,y:1.5}),getCombatMapRotationAngle:()=>0,
    isBlockedDungeonCell:()=>false,isDungeonCliffEdge:()=>false,isObstacleTile:()=>false,
    syncCombatActorOverlayFromMaze(){},drawDungeonExitMapMarkers(){},syncPartyMazeToCombatPositions(){},
    isDungeonActorPresent:()=>true,ensurePCSpriteInCombatList(){},ensureKnownSpritesInCombatList(){},
    copyCombatPersistentFields(){},createCombatVisual:()=>visual(),refreshCombatVisualIfStale(){},
    ensureCombatTextureForCharacter:()=> 'pc',
    moveCombatVisualTo(scene,data,entry){data.sprite.setPosition(entry.x*25+12.5,entry.y*25+12.5);},
    deriveFacingFromDelta:(x,y,facing)=>facing};
  vm.runInNewContext(game.slice(game.indexOf('function combatMapActorSize('),game.indexOf('function ensureCombatTextureForCharacter(')),context);
  vm.runInNewContext(game.slice(game.indexOf('function getCombatFrameName('),game.indexOf('function syncCombatActorOverlayFromMaze(')),context);
  vm.runInNewContext(game.slice(game.indexOf('class CombatScene extends'),game.indexOf('const gameConfig ='))+'\nthis.CombatScene=CombatScene;',context);
  const scene=new context.CombatScene();
  Object.assign(scene,{pcName:actor.name,characters:{[actor.name]:{sprite:visual(),label:visual()}},
    gridSize:3,cellSize:25,PIXEL_SCALE:2,RT_CELL:12.5,
    renderRT:{clear(){draws.length=0;},draw(s){if(s.texture?.key)draws.push({key:s.texture.key,flipX:s.flipX,frame:s.frame,width:s.width,height:s.height});}},
    textures:{exists:()=>true,get:()=>({has:()=>true})},make:{graphics:gfx,sprite:({key,frame})=>visual(key,frame)},
    add:{text:()=>visual()},sys:{game:{loop:{wake(){},sleep(){}}}},time:{delayedCall:()=>({remove(){}})}});
  for(const facing of['left','right']){
    context.window.combatCharacters[0].facing=facing;
    scene.redrawCombatRT();
    assert.equal(draws.length,1);assert.equal(draws[0].flipX,facing==='right');assert.equal(draws[0].frame,'frame2');
    assert.equal(draws[0].width,21.875);assert.equal(draws[0].height,draws[0].width);
    assert.equal(scene.characters.Mortacia.sprite.visible,false);assert.equal(scene.characters.Mortacia.label.visible,false);
    scene.updatePositions(context.window.combatCharacters);
    assert.equal(scene.characters.Mortacia.sprite.visible,false,'Position updates must not revive the overlay');
    const old=scene.characters.Mortacia.sprite;
    scene.updateCharacters(context.window.combatCharacters);
    assert.ok(old.destroyed);assert.notEqual(scene.characters.Mortacia.sprite,old);
    assert.equal(scene.characters.Mortacia.sprite.visible,false,'A recreated roster must keep the same token owner');
  }
  context.currentDungeon=null;scene.redrawCombatRT();
  assert.equal(draws.length,0);assert.equal(scene.characters.Mortacia.sprite.visible,true,'No-dungeon fallback restores the overlay');
  scene.updatePositions(context.window.combatCharacters);assert.equal(scene.characters.Mortacia.sprite.visible,true);
  context.currentDungeon={cells:{'1,1':{tile:'floor',floorHeight:0,ceilHeight:3}}};
  context.ensureCombatTextureForCharacter=(s,entry)=>entry.type==='pc'?'pc':entry.name;
  context.window.combatCharacters.push({name:'Benedict',type:'npc',mazeX:1,mazeY:2},{name:'Mortacia Companion',type:'npc',mazeX:2,mazeY:1});
  scene.redrawCombatRT();
  assert.equal(draws.find(d=>d.key==='Benedict').width*2,33.75,'NPC map tokens use the approved 1.35x scale');
  assert.equal(draws.find(d=>d.key==='Mortacia Companion').width*2,43.75,'Mortacia uses 1.75x without stacking her old five-percent bonus');
  assert.equal(draws.find(d=>d.key==='pc').width*2,43.75,'Mortacia has the same size as PC or NPC');
  context.ensureMonsterSpriteData=()=>{};
  context.window.combatCharacters.push({name:'Wraith',type:'monster',mazeX:0,mazeY:1});
  scene.redrawCombatRT();assert.equal(draws.find(d=>d.key==='Wraith').width*2,33.75,'Monsters share the approved 1.35x scale');
  scene.pcName='Suzerain';scene.characters.Suzerain={sprite:visual(),label:visual()};context.window.combatCharacters[0].name='Suzerain';
  scene.redrawCombatRT();assert.equal(draws.find(d=>d.key==='pc').width*2,33.75,'An ordinary PC also uses 1.35x');
  context.window.combatCharacters[0].name='Mortacia';
  scene.characters.Benedict={sprite:visual('Benedict'),label:visual()};scene.pcName='Benedict';
  scene.redrawCombatRT();
  assert.equal(scene.pcName,'Mortacia','A former party leader cannot override the current roster PC');
  assert.equal(draws.find(d=>d.key==='pc').width*2,43.75,'Mortacia retains 1.75x after a PC switch');
  assert.equal(scene.characters.Mortacia.sprite.visible,false,'The current PC still has only one visible token');
  const fullResolution=[];
  scene.actorRT={clear(){fullResolution.length=0;},draw(s){fullResolution.push({key:s.texture.key,width:s.width,frame:s.frame});}};
  scene.characters.Mortacia.sprite.texture.key='outdated-PC-preview';
  scene.redrawCombatRT();
  assert.equal(draws.length,0,'Actor textures no longer lose pixels in the half-resolution terrain RT');
  assert.equal(fullResolution.find(d=>d.key==='pc').width,43.75,'PC Mortacia occupies 1.75 map tiles without downsampling');
  assert.equal(fullResolution.find(d=>d.key==='Benedict').width,33.75);
  assert.ok(!fullResolution.some(d=>d.key==='outdated-PC-preview'),'Do not reuse an old selected PC texture');
  scene.redrawCombatRT();assert.equal(fullResolution.filter(d=>d.key==='pc').length,1,'Each redraw clears the full-resolution actors');
  const visualStart=game.indexOf('function createCombatVisual(');
  vm.runInNewContext(game.slice(visualStart,game.indexOf('window.updateCombatScene =',visualStart)),context);
  scene.add.sprite=(x,y,key,frame)=>visual(key,frame);scene.add.image=scene.add.sprite;
  for(const type of['pc','npc','monster'])for(const name of['Benedict','Mortacia']){
    const sprite=context.createCombatVisual(scene,{name,type,x:1,y:1});
    assert.equal(sprite.width,name==='Mortacia'?43.75:33.75,'Overlay fallback has the same size as the RT path');
  }
});

test('NPC map frames fill the normal token while PC art and world sprites remain intact',()=>{
  const context={document:{createElement:()=>createCanvas(1,1)}};
  vm.runInNewContext(game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function ensureCombatTextureForCharacter(')),context);
  const sheet=createCanvas(96*4,96),g=sheet.getContext('2d');g.fillStyle='#c78452';
  for(let f=0;f<4;f++)g.fillRect(f*96+36+f,20,24,72);
  const original=sheet.toBuffer(),pc=context.fitCombatNpcSpriteSheet(sheet,{type:'pc'});
  assert.equal(pc,sheet);assert.equal(context.fitCombatNpcSpriteSheet(sheet,{type:'npc',sprite:{spec:{kind:'placeholder'}}}),sheet);
  for(const name of['Mortacia','mortacia','Name: Mortacia'])assert.equal(context.fitCombatNpcSpriteSheet(sheet,{name,type:'npc'}),sheet,
    'Mortacia keeps identical sheet padding as a PC or companion');
  const fit=context.fitCombatNpcSpriteSheet(sheet,{type:'npc'});assert.notEqual(fit,sheet);
  assert.equal(fit.width,384);assert.equal(fit.height,96);assert.deepEqual(sheet.toBuffer(),original);
  const pixels=fit.getContext('2d').getImageData(0,0,384,96).data;
  for(let f=0;f<4;f++){
    let low=96,high=-1;for(let y=0;y<96;y++)for(let x=f*96;x<(f+1)*96;x++)if(pixels[(x+y*384)*4+3]){low=Math.min(low,y);high=Math.max(high,y);}
    assert.equal(high-low+1,96,'All animation frames retain a stable readable map footprint');
  }
});

function scene(artEnabled,kind='fresco'){
  const worldCalls=[],draws=[],state={},gl=new Proxy({getParameter:()=>false,isEnabled:()=>false,
    uniform1i:(name,v)=>{state[name]=v;},uniform1f:(name,v)=>{state[name]=v;},
    bindBuffer:(kind,b)=>{if(kind==='ARRAY_BUFFER')state.buffer=b;},
    drawArrays:()=>worldCalls.push({...state}),drawElements:()=>draws.push({...state})},
    {get:(o,k)=>k in o?o[k]:/^[A-Z_0-9]+$/.test(k)?k:()=>{}});
  const context={window:{WEBGPU_VOXEL_PREWARM:false,setTimeout(){}},document:{getElementById:id=>id==='dungeon-popup'?{style:{display:'block'}}:{},
    createElement:()=>({getContext:()=>({drawImage(){}})})},console,performance,clearTimeout};
  vm.runInNewContext(source,context);
  const r=context.window.webglDungeonRenderer,cells={};
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  cells['3,3']={tile:'pillar',floorHeight:0,ceilHeight:3};cells['4,2']={tile:'torch',floorHeight:0,ceilHeight:3};
  const art={tile:'painting',kind,surface:'wall',axis:'x',sign:-1,position:{x:6,y:3,z:.4},size:{x:.02,y:1,z:1}};
  const d={geoKey:'0,0,0',_geometryStamp:'stable',layout:{width:8,height:8},cells,
    tiles:{pillar:{spriteSpec:{baseWidth:.6}}},surfaceArt:artEnabled?[art]:[]};
  Object.assign(context.window,{currentDungeon:d,dungeonTextures:{},dungeonTexturesMeta:{pillar:{baseWidth:.6}},
    playerDungeonX:1,playerDungeonY:3,playerPosX:1.5,playerPosY:3.5,playerZ:.65,playerAngle:0,
    ArtPresentation:{lights:()=>artEnabled?[{id:'painting:lamp:0',x:5.7,y:3.5,z:1.5,radius:4,intensity:.85,dist2:17.64,position:{x:5.7,y:3.5,z:1},size:{x:.2,y:.2,z:.4}}]:[],
      lightAnchor:()=>({x:5.92,y:3.5}),flamePose:l=>l}});
  r.gl=gl;r.canvas={width:160,height:120};r.cellTex={};r.roofCellsTex={};r.voxelProgram={};
  r.voxelUniforms=Object.fromEntries(['torchCount','torchRadiusScale','shadowStrength'].map(s=>[s,s]));
  r.uniformLocations.torchCount='worldTorchCount';
  const selectedArtLights=[],select=r.getCachedTorchLights;
  r.getCachedTorchLights=function(frame,...args){const result=select.call(this,frame,...args);
    if(frame.scope==='art')selectedArtLights.push(...result.map(v=>v.t.id));return result;};
  r.getVoxelMesh=()=>({vbo:'pillar',ibo:'pillar-ix',count:6});
  r.getSurfaceArtMesh=()=>({vbo:'painting',ibo:'painting-ix',count:6,lightingScope:'art',torchRadiusScale:1.5,shadowStrength:.2});
  r.getArtLampMesh=()=>null;r.buildHaloTexture=r.buildBlobShadowTexture=r.buildFlameTexture=()=>{};
  r.renderScene();
  return{world:worldCalls,pillars:draws.filter(x=>x.buffer==='pillar'),paintings:draws.filter(x=>x.buffer==='painting'),selectedArtLights};
}
test('artwork lamps illuminate paintings without changing world torches or pillar lighting',()=>{
  const oldDate=Date.now;Date.now=()=>123450;
  try{
    const plain=scene(false);
    assert.ok(plain.pillars.length>0);
    assert.equal(plain.world[0].worldTorchCount,1,'Only the original room torch reaches the world shader');
    for(const kind of['fresco','mosaic']){
      const withArt=scene(true,kind);
      assert.equal(withArt.pillars.length,plain.pillars.length);
      assert.equal(withArt.world[0].worldTorchCount,plain.world[0].worldTorchCount);
      for(let i=0;i<plain.pillars.length;i++)for(const field of['torchCount','torchRadiusScale','shadowStrength'])
        assert.equal(withArt.pillars[i][field],plain.pillars[i][field],field);
      assert.ok(withArt.paintings[0].torchCount>0);assert.ok(withArt.selectedArtLights.includes('painting:lamp:0'),'The '+kind+' selects its separate local sconce');
    }
  }finally{Date.now=oldDate;}
});
