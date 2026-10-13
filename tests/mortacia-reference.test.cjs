'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas,Image}=require('canvas'),Sprites=require('../assets/renderCharacterSprite');

test('approved Mortacia pose has forward blonde hair, an unobscured bodice, a lower grip and sharp wing tips',()=>{
  const canvas=Sprites.createMortaciaReferenceCanvas(),ctx=canvas.getContext('2d');
  const pixel=(x,y)=>Array.from(ctx.getImageData(Math.round(x*3)+1,Math.round(y*3)+1,1,1).data);
  assert.equal(canvas.width,96);assert.equal(canvas.height,96);
  const crown=pixel(12.5,8);assert.ok(crown[0]>crown[1]+15&&crown[1]>crown[2]+30);
  assert.deepEqual(pixel(12.5,9),pixel(12.5,10),'No blonde widow\'s peak drops into the face');
  const face=pixel(12.5,10);assert.ok(face[0]>face[1]+15&&face[1]>face[2]+15,'Face projects forward of the body');
  assert.deepEqual(pixel(14,12),face,'Chin steps inward beneath the jaw');
  assert.deepEqual(pixel(14,13),face,'Neck connects the jaw and the collar');
  assert.equal(pixel(12.5,12)[3],0,'Jaw is not a featureless rectangular hair block');
  for(let x=38;x<48;x++){
    assert.deepEqual(Array.from(ctx.getImageData(x,25,1,1).data),pixel(13,8),'Crown stays flat');
    assert.equal(ctx.getImageData(x,23,1,1).data[3],0,'No domed hair cap');
  }
  for(let y=14;y<19;y++)for(let x=14;x<16;x++){
    const p=pixel(x,y);assert.equal(p[3],255);assert.ok(Math.max(...p.slice(0,3))-Math.min(...p.slice(0,3))<20,'No skin-coloured arm crosses the bodice');
  }
  const hand=pixel(9,15);assert.ok(hand[0]>hand[1]+15&&hand[1]>hand[2]+15);
  assert.deepEqual(pixel(10,16),hand,'Palm is slightly wider than draft 2');
  assert.equal(ctx.getImageData(32,49,1,1).data[3],0,'Hand remains smaller than a two-by-two block');
  assert.equal(pixel(8,13)[3],0,'Hilt no longer occupies the higher row');
  assert.deepEqual(pixel(8,14),pixel(9,14),'Guard lies directly above the hand at the approved Frame 1 spacing');
  assert.equal(pixel(12,27)[3],0,'No spur protrudes halfway down the front boot');
  assert.equal(pixel(14,28)[3],0,'Calves stay visibly separate');
  assert.equal(pixel(14,30)[3],0,'Separate feet do not merge into a horizontal bar');
  assert.equal(pixel(17,30)[3],0,'Back foot ends under the back calf, without an extra block');
  assert.equal(pixel(12,30)[3],255);assert.equal(pixel(16,30)[3],255);
  assert.equal(pixel(13,15)[3],255);assert.equal(pixel(13,16)[3],0);assert.equal(pixel(13,18)[3],255,'A small waist inset preserves chest and hips');
  for(const y of[2,3]){assert.equal(pixel(22,y)[3],255);assert.equal(pixel(21,y)[3],0);assert.equal(pixel(23,y)[3],0,'Narrow upper finger stays pointed');}
  const pixels=ctx.getImageData(0,0,96,96).data;
  assert.ok(pixels.every((v,i)=>i%4!==3||v===0||v===255),'Fractional tracing offsets still snap to hard pixel edges');
  assert.equal(pixel(0,0)[3],0,'Sprite background stays transparent');
});

test('approved portraits refresh saved art once and invalidate only their old map texture',()=>{
  const game=fs.readFileSync(path.join(__dirname,'../assets/game.js'),'utf8'),context={};
  vm.runInNewContext(game.slice(game.indexOf('function getCombatTextureKey('),game.indexOf('// Re-create a combat-map visual when')),context);
  const character={name:'Mortacia',type:'npc',hp:120,state:'Friendly',sprite:{dataUrl:'data:old',spec:{seed:1},artRevision:'mortacia-reference-walk-5'}};
  const oldKey=context.getCombatTextureKey(character),spec=character.sprite.spec;
  assert.equal(Sprites.refreshMortaciaSpriteArt(character),true);
  assert.notEqual(context.getCombatTextureKey(character),oldKey);assert.match(context.getCombatTextureKey(character),/mortacia-reference-walk-6/);
  assert.equal(character.sprite.spec,spec);assert.equal(character.hp,120);assert.equal(character.state,'Friendly');
  assert.equal(Sprites.refreshMortaciaSpriteArt(character),false);
  assert.equal(context.getCombatTextureKey({name:'Benedict',sprite:{spec:{kind:'procedural',key:'original'}}}),'char-sprite-Benedict-sheet-original');
});

test('approved portrait stays unchanged and the combat-map walk frames retain her outfit and grip',()=>{
  const character={Name:'Mortacia',Sex:'Female',Race:'Goddess',Class:'Assassin-Fighter-Necromancer-Goddess',_rerollSeed:.42};
  const spec=Sprites.createCharacterSpriteSpec(character),live=Sprites.createCharacterSpriteCanvas(character,spec);
  const draft=Sprites.createMortaciaReferenceCanvas(),approved=draft.toBuffer();
  assert.deepEqual(live.toBuffer(),approved);
  const procedural=require('../assets/renderCharacterProcedural').getPresetProceduralSpec('Mortacia'),snapshot=JSON.stringify(procedural);
  for(const actor of[character,{name:'Mortacia',type:'npc'},{Name:'Name: Mortacia',type:'pc'}])for(const payload of[spec,procedural]){
    assert.deepEqual(Sprites.createCharacterSpriteCanvas(actor,payload).toBuffer(),approved);
    const sheet=Sprites.createCharacterSpriteSheetCanvas(actor,payload,4);
    assert.equal(sheet.width,384);assert.equal(sheet.height,96);
    const unique=new Set();
    for(let f=0;f<4;f++){
      const frame=createCanvas(96,96);frame.getContext('2d').drawImage(sheet,f*96,0,96,96,0,0,96,96);
      assert.deepEqual(frame.toBuffer(),Sprites.createMortaciaReferenceCanvas(f).toBuffer());
      if(!f)assert.deepEqual(frame.toBuffer(),approved,'Idle remains the exact approved reference');
      else assert.notDeepEqual(frame.toBuffer(),approved,'Walking must not repeat the idle artwork');
      for(const region of[[38,24,13,18],[42,39,6,21]])assert.deepEqual(frame.getContext('2d').getImageData(...region).data,draft.getContext('2d').getImageData(...region).data,
        'Keep the face, flat blonde crown and covered bodice');
      const pixels=frame.getContext('2d').getImageData(0,0,96,96).data;
      assert.ok(pixels.every((v,i)=>i%4!==3||v===0||v===255),'Walk frames keep hard pixel edges');
      unique.add(frame.toBuffer().toString('base64'));
    }
    assert.equal(unique.size,4,'Four distinct walking poses, not copies');
  }
  assert.equal(JSON.stringify(procedural),snapshot,'The 3D preset remains untouched');
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const out=createCanvas(900,520),ctx=out.getContext('2d');ctx.fillStyle='#252627';ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=false;
    const previous=path.join(__dirname,'../logs/probes/mortacia-reference-draft-2.png');
    ctx.fillStyle='#ede1cb';ctx.font='20px Georgia';ctx.fillText(fs.existsSync(previous)?'Previous draft':'Current 2D sprite',30,32);
    ctx.fillText('Approved in-game pose',330,32);ctx.fillText('NPC map scale',650,32);
    if(fs.existsSync(previous)){const img=new Image();img.src=fs.readFileSync(previous);ctx.drawImage(img,330,60,288,288,30,60,288,288);}
    else ctx.drawImage(live,30,60,288,288);
    ctx.drawImage(draft,330,60,288,288);
    const npcSize=25*1.75;
    ctx.drawImage(draft,680,70,npcSize,npcSize);ctx.drawImage(draft,740,70,64,64);
    ctx.fillStyle='#a9abad';ctx.font='16px Georgia';ctx.fillText('Lower hilt, slightly fuller hand.',330,388);
    ctx.fillText('Flat hairline, restored chin and neck.',330,416);ctx.fillText('Straight calves, separate feet.',330,444);
    ctx.fillText('PCs, NPCs, monsters 1.35x; Mortacia 1.75x; 3D unchanged.',30,490);
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'mortacia-approved-profile.png'),out.toBuffer());
    const gallery=createCanvas(960,430),g=gallery.getContext('2d');g.fillStyle='#252627';g.fillRect(0,0,960,430);g.imageSmoothingEnabled=false;
    for(let f=0;f<4;f++){
      const frame=Sprites.createMortaciaReferenceCanvas(f),x=f*240;
      g.drawImage(frame,x,30,240,240);g.fillStyle='#ede1cb';g.font='18px Georgia';g.fillText(['Approved idle','Stride A','Passing step','Stride B'][f],x+24,290);
      g.drawImage(frame,x+56,320,43.75,43.75);g.save();g.translate(x+160,320);g.scale(-1,1);g.drawImage(frame,0,0,43.75,43.75);g.restore();
    }
    g.fillStyle='#a9abad';g.font='16px Georgia';g.fillText('Combat-map size: Mortacia 1.75x. Left and right facings shown below each frame.',24,406);
    fs.writeFileSync(path.join(dir,'mortacia-walk-vertical-frames.png'),gallery.toBuffer());
  }
});

test('Mortacia walk sheets are bounded, repeat deterministically and use the existing movement clock',()=>{
  const actor={name:'Mortacia',type:'npc'},frames=Sprites.extractCharacterFrameCanvases(actor,null,8);
  assert.equal(frames.length,8);
  for(let i=0;i<8;i++)assert.deepEqual(frames[i].toBuffer(),frames[i%4].toBuffer());
  const still=Sprites.createCharacterSpriteSheetCanvas(actor,null,1);assert.deepEqual(still.toBuffer(),Sprites.createMortaciaReferenceCanvas().toBuffer());
  const game=fs.readFileSync(path.join(__dirname,'../assets/game.js'),'utf8'),context={PC_WALK_FRAME_MS:180};
  vm.runInNewContext(game.slice(game.indexOf('function advanceWalkFrame('),game.indexOf('function isObstacleTile(')),context);
  vm.runInNewContext(game.slice(game.indexOf('function getCombatFrameName('),game.indexOf('function getCombatFacingFlip(')),context);
  const seen=[];
  for(let tick=1;tick<=4;tick++){
    assert.equal(context.advanceWalkFrame(actor,tick*180),true);seen.push(context.getCombatFrameName(actor));
    assert.equal(context.advanceWalkFrame(actor,tick*180+50),false,'Do not speed up the existing cadence');
  }
  assert.deepEqual(seen,['frame1','frame2','frame3','frame0']);
  context.resetWalkFrame(actor);assert.equal(context.getCombatFrameName(actor),'frame0','Standing still returns to her approved pose');
});

test('the live combat texture path replaces cached still sheets with distinct PC and NPC walk frames',()=>{
  const game=fs.readFileSync(path.join(__dirname,'../assets/game.js'),'utf8');
  const context={window:{createCharacterSpriteSheetCanvas:Sprites.createCharacterSpriteSheetCanvas},
    document:{createElement:()=>createCanvas(1,1)},Phaser:{Textures:{FilterMode:{NEAREST:'nearest'}}},
    applyProceduralSpriteToEntry:Sprites.refreshMortaciaSpriteArt,console:{warn:message=>assert.fail(message)}};
  vm.runInNewContext(game.slice(game.indexOf('function getCombatTextureKey('),game.indexOf('// Re-create a combat-map visual when')),context);
  vm.runInNewContext(game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function getCombatFacingFlip(')),context);
  for(const type of['pc','npc']){
    const actor={name:'Mortacia',type,sprite:{dataUrl:'data:approved',artRevision:'mortacia-reference-walk-5'}},cache=new Map();
    const oldKey=context.getCombatTextureKey(actor);cache.set(oldKey,{old:true});
    const scene={textures:{exists:key=>cache.has(key),get:key=>cache.get(key),addCanvas(key,canvas){
      const frames=new Map();cache.set(key,{canvas,frames,add(name,_source,x,y,w,h){frames.set(name,{x,y,w,h});},setFilter(filter){this.filter=filter;}});
    }}};
    const key=context.ensureCombatTextureForCharacter(scene,actor),texture=cache.get(key);
    assert.notEqual(key,oldKey);assert.equal(texture.frames.size,4);assert.equal(texture.filter,'nearest');
    const pixels=new Set();
    for(let walkFrame=0;walkFrame<4;walkFrame++){
      actor.walkFrame=walkFrame;const f=texture.frames.get(context.getCombatFrameName(actor));
      assert.equal(f.w,96);assert.equal(f.h,96);
      pixels.add(Buffer.from(texture.canvas.getContext('2d').getImageData(f.x,f.y,f.w,f.h).data).toString('base64'));
    }
    assert.equal(pixels.size,4,'Registered '+type+' textures must actually animate');
    assert.equal(context.ensureCombatTextureForCharacter(scene,actor),key);assert.equal(cache.size,2,'Reuse the new sheet on later redraws');
  }
});

test('Mortacia sword stays at Frame 1 spacing and thickness, moves only vertically, and retains the narrow stride',()=>{
  const idle=Sprites.createMortaciaReferenceCanvas().getContext('2d');
  const grip=idle.getImageData(24,3,9,54).data;
  for(const [phase,dy]of[0,1,0,-1].entries()){
    const frame=Sprites.createMortaciaReferenceCanvas(phase),ctx=frame.getContext('2d');
    const moved=ctx.getImageData(24,3+dy*3,9,54).data;
    for(let i=0;i<grip.length;i+=4)if(grip[i+3])assert.deepEqual(moved.slice(i,i+4),grip.slice(i,i+4),
      'The blade, hilt and hand translate together without changing shape or length');
    const pixels=ctx.getImageData(0,0,96,96).data;let bladePixels=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]===244&&pixels[i+1]===206&&pixels[i+2]===142&&pixels[i+3])bladePixels++;
    assert.equal(bladePixels,99,'The moving blade stays entirely inside the canvas');
    const pixel=(x,y)=>Array.from(ctx.getImageData(x*3+1,y*3+1,1,1).data);
    assert.deepEqual(pixel(13,14),[113,115,114,255],'Sleeve remains attached to the shoulder');
    assert.deepEqual(pixel(11,15+dy),[113,115,114,255],'Sleeve reaches the moving hand');
    assert.deepEqual(pixel(9,15+dy),[213,183,156,255],'Hand remains directly below the hilt');
    assert.equal(frame.width,96);assert.equal(frame.height,96);
  }
  const stride=Sprites.createMortaciaReferenceCanvas(1).getContext('2d'),skin=[];
  const colors=new Set(['207,179,149','170,148,126','216,189,161']);
  for(let y=20;y<31;y++)for(let x=0;x<32;x++){
    const p=Array.from(stride.getImageData(x*3+1,y*3+1,1,1).data);
    if(p[3]&&colors.has(p.slice(0,3).join(',')))skin.push(x);
  }
  assert.equal(Math.min(...skin),12);assert.equal(Math.max(...skin),17,'Both knees are one pixel inward');
  assert.equal(stride.getImageData(9*3+1,30*3+1,1,1).data[3],0,'Front foot no longer reaches the old wide stride');
  assert.equal(stride.getImageData(10*3+1,30*3+1,1,1).data[3],255);
});
