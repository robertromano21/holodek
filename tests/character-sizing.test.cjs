'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../assets/renderCharacterProcedural'),Sprite=require('../assets/renderCharacterSprite');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('generated size metadata is bounded, stable, persistent and independent of party membership',()=>{
  for(const size of['tiny','small','medium','large','huge'])for(let i=0;i<20;i++){
    const base=C.buildProceduralSpriteSpec({name:'Creature '+size+i,race:'Unknown',isMonster:true});
    const spec=C.buildProceduralSpriteSpec({name:base.name,race:'Unknown',isMonster:true},{...base.traits,size},{salt:7});
    const big=['large','huge'].includes(size),s=spec.stature.scale;
    assert.ok(s>=(big?1.5:.8)&&s<=(big?2:1.1));
    assert.deepEqual(C.characterStature(JSON.parse(JSON.stringify({...spec,isMonster:false,role:'npc'}))),spec.stature);
    assert.deepEqual(C.withVariant(spec,4).stature,spec.stature);
  }
});
test('combat-map readable body targets are independent of role and preserve world stature',()=>{
  const game=fs.readFileSync('assets/game.js','utf8'),ctx={window:{ProceduralCharacters:C},document:{createElement:()=>require('canvas').createCanvas(1,1)},COMBAT_ACTOR_TOKEN_SCALE:1.35,COMBAT_MORTACIA_TOKEN_SCALE:1.75,COMBAT_HUMANOID_TOKEN_SCALE:1.4,COMBAT_MIN_BODY_TOKEN_SCALE:1.28};
  vm.runInNewContext(game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function setCombatPlayerTokenOwner(')),ctx);
  for(const [race,expected]of[['Human',35],['Elf',35],['Dwarf',32],['Gnome',32],['Halfling',32],['Mortacia',40.5]]){
    const spec=race==='Mortacia'?C.getPresetProceduralSpec(race):C.buildProceduralSpriteSpec({name:'Map '+race,race,class:'Fighter'});
    const before=JSON.stringify(spec),worldHeight=C.humanoidWorldStature(spec);
    let bodySize;
    for(const type of['pc','npc','monster']){
      const actor={name:spec.name,type,sprite:{spec}},sheet=Sprite.createCharacterSpriteSheetCanvas(actor,spec);
      ctx.fitCombatNpcSpriteSheet(sheet,actor);
      const size=ctx.combatMapActorSize(actor,25)*actor._combatBodyFraction;
      close(size,expected);bodySize??=size;close(size,bodySize);
    }
    assert.equal(JSON.stringify(spec),before);assert.equal(C.humanoidWorldStature(spec),worldHeight);
  }
});
test('camera distance never reduces world stature and existing size-based movement distances do not change combat reach',()=>{
  for(const height of[1.65,1.98,2.475,3.3])for(const depth of[.3,1,2,5]){
    const framed=C.frameBillboardHeight(height,.65,depth,Math.sqrt(3),0,.04);
    assert.equal(framed,height);
  }
  const giant=C.buildProceduralSpriteSpec({name:'Enormous Golem',race:'Giant',isMonster:true});
  assert.ok(C.characterViewingDistance(giant)>3);
  const combat=fs.readFileSync('retort/dungeonReach.js','utf8');
  assert.doesNotMatch(combat,/characterViewingDistance|frameBillboardHeight/);
});

function pixelHeight(canvas){
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let top=canvas.height,bottom=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.height;x++)if(pixels[(x+y*canvas.width)*4+3]){
    top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  return bottom-top+1;
}
function combatContext(){
  const game=fs.readFileSync('assets/game.js','utf8'),ctx={window:{ProceduralCharacters:C,createCharacterSpriteSheetCanvas:Sprite.createCharacterSpriteSheetCanvas,createCombatSpriteSheetCanvas:Sprite.createCombatSpriteSheetCanvas},
    document:{createElement:()=>require('canvas').createCanvas(1,1)},COMBAT_ACTOR_TOKEN_SCALE:1.35,COMBAT_MORTACIA_TOKEN_SCALE:1.75,COMBAT_HUMANOID_TOKEN_SCALE:1.4,COMBAT_MIN_BODY_TOKEN_SCALE:1.28,
    Phaser:{Textures:{FilterMode:{NEAREST:'nearest'}}},applyProceduralSpriteToEntry:()=>false,console};
  vm.runInNewContext(game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function getCombatFacingFlip(')),ctx);
  vm.runInNewContext(game.slice(game.indexOf('function getCombatTextureKey('),game.indexOf('// Re-create a combat-map visual when')),ctx);
  return ctx;
}
function humanoid(size,robe='robe',name='Benedict'){
  const sheet={name,race:'High Elf',sex:'Male',class:'Sorcerer',role:'pc'};
  const traits=C.deriveFallbackTraits(sheet);
  Object.assign(traits,{size,bodyPlan:'humanoid',build:'slender',hair:'long',wings:'none',tail:'none',horns:'none',
    spikes:false,mane:false,halo:false,floating:false,extraArms:0,handGlow:false,items:[],translucency:0,tattered:false,
    outfit:{style:robe,helm:'open',hood:false,cape:false,symbol:'none'}});
  return C.buildProceduralSpriteSpec(sheet,traits,{salt:32478075,signature:false});
}

test('a tiny-layout elf with headgear is not visually magnified over a medium-layout neighbor on the map',()=>{
  const ctx=combatContext(),sizes=[];
  for(const layout of['tiny','small','medium'])for(const type of['pc','npc','monster']){
    const spec=humanoid(layout),actor={name:spec.name,type,sprite:{spec}},before=JSON.stringify(spec);
    const idle=Sprite.createTraitSpriteCanvas(spec),sheet=Sprite.createCharacterSpriteSheetCanvas(actor,spec);
    assert.equal(sheet._combatBodyHeight,pixelHeight(idle),'Use the drawn headgear and outline, not nominal limb heights');
    const fitted=ctx.fitCombatNpcSpriteSheet(sheet,actor),visible=pixelHeight(fitted)*ctx.combatMapActorSize(actor,25)/fitted.height;
    assert.ok(Math.abs(visible-35)<.8,`${layout}/${type}: actual visible body ${visible}`);sizes.push(visible);
    assert.equal(JSON.stringify(spec),before);
  }
  assert.ok(Math.max(...sizes)-Math.min(...sizes)<.8,'Layout size cannot introduce a PC-only or tiny-layout enlargement');
});

test('other small creatures also receive the 32-pixel map body floor without enlarging large monsters',()=>{
  const ctx=combatContext();
  for(const scale of[.8,.87,.88,.94,1.02,1.5,2])for(const type of['pc','npc','monster']){
    const spec=largeSpec('beast',scale),actor={name:spec.name,type,sprite:{spec}},before=JSON.stringify(spec);
    const sheet=Sprite.createCombatSpriteSheetCanvas(actor,spec);ctx.fitCombatNpcSpriteSheet(sheet,actor);
    close(ctx.combatMapActorSize(actor,25)*actor._combatBodyFraction,Math.max(32,33.75*scale));
    assert.equal(JSON.stringify(spec),before);
  }
  close(ctx.combatMapActorSize({name:'Legacy compact',race:'Dwarf',type:'npc'},25),32);
});

test('weapon, wing, halo and magical extensions cannot change body calibration or alter the original avatar pixels',()=>{
  for(const layout of['tiny','small','medium']){
    const spec=humanoid(layout),plain=Sprite.createTraitSpriteCanvas(spec),before=JSON.stringify(spec);
    const equipped={...spec,traits:{...spec.traits,wings:'bat',tail:'scaled',horns:'long',halo:true,handGlow:true,
      items:[{slot:'weapon',type:'spear',color:'#b8ab8d',accent:'#655030'}]}};
    const fancy=Sprite.createTraitSpriteCanvas(equipped);
    assert.equal(fancy._combatBodyHeight,plain._combatBodyHeight,'Measure the body, not an oversized weapon or wings');
    assert.notDeepEqual(fancy.toBuffer(),plain.toBuffer(),'Keep the equipped appearance');
    for(let frame=0;frame<4;frame++)assert.deepEqual(Sprite.createTraitSpriteCanvas(spec,frame).toBuffer(),
      Sprite.createTraitSpriteCanvas(spec,frame,{measureBody:true}).toBuffer(),'Measurement must not change avatar artwork');
    assert.equal(JSON.stringify(spec),before);
  }
});

test('existing generated textures get new body metrics, and warm cache/role changes preserve those metrics',()=>{
  const ctx=combatContext(),spec=humanoid('tiny'),actor={name:spec.name,type:'pc',sprite:{spec,dataUrl:'data:existing-art'}},cache=new Map();
  const key=ctx.getCombatTextureKey(actor),oldKey=key.replace('-combat-fit-2','');cache.set(oldKey,{_combatBodyFraction:.6});
  let registrations=0;
  const scene={textures:{exists:k=>cache.has(k),get:k=>cache.get(k),addCanvas(k,canvas){registrations++;
    cache.set(k,{canvas,add(){},has:()=>true,setFilter(){}});}}};
  const source=JSON.stringify(actor.sprite);
  assert.equal(ctx.ensureCombatTextureForCharacter(scene,actor),key);assert.notEqual(key,oldKey);
  const size=ctx.combatMapActorSize(actor,25),fraction=actor._combatBodyFraction;
  for(const type of['pc','npc','monster','npc']){
    const rebuilt={name:actor.name,type,sprite:actor.sprite};
    assert.equal(ctx.ensureCombatTextureForCharacter(scene,rebuilt),key);close(rebuilt._combatBodyFraction,fraction);
    close(ctx.combatMapActorSize(rebuilt,25),size);
  }
  assert.equal(registrations,1);assert.equal(JSON.stringify(actor.sprite),source,'Do not reroll, change stature or replace the saved avatar');
});

function largeSpec(plan,scale=2,build='heavy'){
  const source=humanoid('medium','robe','Grand '+plan);
  return C.buildProceduralSpriteSpec({...source,race:'Unknown',isMonster:true},
    {...source.traits,size:'huge',bodyPlan:plan,build,outfit:{...source.traits.outfit,helm:'none'}},
    {salt:32478075,signature:false,stature:{version:1,category:'large',scale}});
}
function bounds(canvas){
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let left=canvas.width,top=canvas.height,right=-1,bottom=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(x+y*canvas.width)*4+3]){
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
  }
  return{left,top,right,bottom,width:right-left+1,height:bottom-top+1};
}

test('large creatures are composed on larger native grids, with new details and uncropped body-type silhouettes',()=>{
  const {createCanvas}=require('canvas'),ctx=combatContext(),previews=[];
  for(const plan of['giant','beast','draconic','serpent','spider','ooze','elemental']){
    const spec=largeSpec(plan),before=JSON.stringify(spec),actor={name:spec.name,type:'monster',sprite:{spec}},sheet=Sprite.createCombatSpriteSheetCanvas(actor,spec);
    assert.ok(sheet.height>96&&sheet.height<=384);assert.equal(sheet.width,sheet.height*4);assert.ok(sheet._combatNativeScale>1);
    assert.ok(sheet._combatBodyHeight/C64_UNIT>24,'A large body contains more native logical pixels');
    const one=createCanvas(sheet.height,sheet.height);one.getContext('2d').drawImage(sheet,0,0,sheet.height,sheet.height,0,0,sheet.height,sheet.height);
    const b=bounds(one);assert.ok(b.left>0&&b.top>0&&b.right<one.width-1&&b.bottom<one.height-1,plan+': no clipped extremities');
    const baseline=Sprite.createTraitSpriteCanvas(spec,0,{nativeScale:1}),enlarged=createCanvas(one.width,one.height),g=enlarged.getContext('2d');
    g.imageSmoothingEnabled=false;g.drawImage(baseline,0,0,baseline.width*sheet._combatNativeScale,baseline.height*sheet._combatNativeScale);
    assert.notDeepEqual(one.toBuffer(),enlarged.toBuffer(),plan+': rerasterized outlines, curves and details are not nearest-neighbor magnification');
    const old=Sprite.createCharacterSpriteCanvas(actor,spec);assert.equal(old.width,96,'Avatar source stays unchanged');
    assert.deepEqual(old.toBuffer(),Sprite.createTraitSpriteCanvas(spec,0,{measureBody:true}).toBuffer());
    ctx.fitCombatNpcSpriteSheet(sheet,actor);close(ctx.combatMapActorSize(actor,25)*actor._combatBodyFraction,67.5);
    assert.equal(JSON.stringify(spec),before);previews.push({plan,spec,one,enlarged});
  }
  if(process.env.HOLODEK_ART_PREVIEW){
    const gallery=createCanvas(576,previews.length*180+44),g=gallery.getContext('2d');g.fillStyle='#252627';g.fillRect(0,0,gallery.width,gallery.height);
    g.fillStyle='#eadac0';g.font='16px Georgia';g.fillText('Enlarged Old Pixels',16,26);g.fillText('Native Drawing',308,26);g.imageSmoothingEnabled=false;
    previews.forEach(({plan,one,enlarged},i)=>{
      for(const [col,canvas]of[enlarged,one].entries()){
        const b=bounds(canvas),scale=Math.min(248/b.width,144/b.height),x=col*288+20,y=44+i*180;
        g.drawImage(canvas,b.left,b.top,b.width,b.height,x,y,b.width*scale,b.height*scale);g.fillStyle='#eadac0';g.font='14px Georgia';g.fillText(plan,x,y+162);
      }
    });fs.mkdirSync('logs/probes',{recursive:true});fs.writeFileSync('logs/probes/native-large-combat-sprites.png',gallery.toBuffer());
  }
});
const C64_UNIT=4;

test('native body proportions can be broad or slender, and registry frames/cache scale consistently across roles',()=>{
  const ctx=combatContext();
  for(const scale of[1.5,2]){
    const spec=largeSpec('giant',scale),actor={name:spec.name,type:'monster',sprite:{spec,dataUrl:'data:existing-art'}},cache=new Map();
    const scene={textures:{exists:k=>cache.has(k),get:k=>cache.get(k),addCanvas(k,canvas){cache.set(k,{canvas,add(){},setFilter(){}});}}};
    const key=ctx.ensureCombatTextureForCharacter(scene,actor),frameSize=cache.get(key).canvas.height;
    assert.ok(frameSize>96);const size=ctx.combatMapActorSize(actor,25);
    for(const type of['npc','pc','monster']){
      actor.type=type;assert.equal(ctx.ensureCombatTextureForCharacter(scene,actor),key);close(ctx.combatMapActorSize(actor,25),size);
    }
    ctx.window.NATIVE_COMBAT_SPRITES=false;const fallback=ctx.ensureCombatTextureForCharacter(scene,actor);
    assert.notEqual(fallback,key);assert.equal(cache.get(fallback).canvas.height,96);ctx.window.NATIVE_COMBAT_SPRITES=true;
    assert.equal(ctx.ensureCombatTextureForCharacter(scene,actor),key);
  }
  const proportions=[];
  for(const build of['slender','heavy']){
    const spec=largeSpec('giant',2,build),sheet=Sprite.createCombatSpriteSheetCanvas({name:spec.name},spec),canvas=require('canvas').createCanvas(sheet.height,sheet.height);
    canvas.getContext('2d').drawImage(sheet,0,0,sheet.height,sheet.height,0,0,sheet.height,sheet.height);const b=bounds(canvas);proportions.push(b.width/b.height);
  }
  assert.ok(proportions[1]>proportions[0],'Body type and build determine width, not a forced independent axis stretch');
  for(const name of['Mortacia','Benedict']){
    const spec=name==='Mortacia'?C.getPresetProceduralSpec(name):humanoid('tiny');
    assert.deepEqual(Sprite.createCombatSpriteSheetCanvas({name},spec).toBuffer(),Sprite.createCharacterSpriteSheetCanvas({name},spec).toBuffer());
  }
});
