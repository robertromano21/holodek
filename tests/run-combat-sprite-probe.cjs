'use strict';
// Isolated Phaser replay of production sprite registration/compositing; no live session or server state.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),game=fs.readFileSync(path.join(root,'assets/game.js'),'utf8');
const scales=[...game.matchAll(/^const (COMBAT_\w*TOKEN_SCALE) = ([\d.]+);/gm)].map(m=>'const '+m[1]+'='+m[2]+';').join('\n');
const helpers=game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function syncCombatActorOverlayFromMaze('));
const keyFunction=game.slice(game.indexOf('function getCombatTextureKey('),game.indexOf('// Re-create a combat-map visual when'));
const facingFunction=game.slice(game.indexOf('function deriveFacingFromDelta('),game.indexOf('function advanceWalkFrame('));
const partySpecs=[];
const nativeSpecs=[];
if(process.argv.includes('--native-large')){
  const C=require('../assets/renderCharacterProcedural');
  for(const plan of['giant','beast','spider'])for(const scale of[1.5,2]){
    const sheet={name:'Native '+plan+' '+scale,race:'Unknown',isMonster:true,class:'Monster'},traits=C.deriveFallbackTraits(sheet);
    Object.assign(traits,{bodyPlan:plan,size:'huge',build:'heavy',hair:'short',wings:'none',tail:'none',horns:'none',halo:false,
      floating:false,tattered:false,translucency:0,handGlow:false,extraArms:0,items:[],outfit:{style:plan==='giant'?'robe':'none',helm:'none',hood:false,cape:false,symbol:'none'}});
    nativeSpecs.push(C.buildProceduralSpriteSpec(sheet,traits,{salt:71,signature:false,stature:{version:1,category:'large',scale}}));
  }
}
if(process.argv.includes('--party-sizing')){
  const C=require('../assets/renderCharacterProcedural'),entries=JSON.parse(fs.readFileSync(path.join(root,'.retort-data/character-traits.json'),'utf8')).entries;
  for(const name of['Benedict','Xarius','Qiai Draclug Xarus','Yelaraia','Ragok Mikragina','Xaren']){
    const entry=entries[name.toLowerCase()];if(!entry?.traits)throw Error('Missing saved replay traits: '+name);
    partySpecs.push(C.buildProceduralSpriteSpec(entry.sheet,entry.traits,{salt:entry.salt,variant:entry.variant,stature:entry.stature}));
  }
}
const page=`<!doctype html><html><meta charset="utf-8"><div id="map"></div><pre id="results">Running</pre>
<script src="/node_modules/phaser/dist/phaser.min.js"></script>
<script src="/assets/renderCharacterProcedural.js"></script><script src="/assets/renderCharacterSprite.js"></script>
<script>
async function report(result){document.getElementById('results').textContent=JSON.stringify(result);await fetch('/report',{method:'POST',body:JSON.stringify(result)});}
window.onerror=(error,source,line)=>report({error,line});
const applyProceduralSpriteToEntry=()=>false;
const partySpecs=${JSON.stringify(partySpecs)};
const nativeSpecs=${JSON.stringify(nativeSpecs)};
${scales}
${facingFunction}
${keyFunction}
${helpers}
class Probe extends Phaser.Scene{
  create(){this.run().catch(error=>report({error:error.stack}));}
  async run(){
    this.PIXEL_SCALE=2;
    this.renderRT=this.add.renderTexture(0,0,32,32).setOrigin(0).setScale(2);
    const actors=this.add.renderTexture(72,0,64,64).setOrigin(0);
    this.renderRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);actors.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const rows=[],legacy=[],pictures=[],size=25*1.75;
    for(const type of['pc','npc']){
      const actor={name:'Mortacia',type,sprite:{dataUrl:'data:old',artRevision:'mortacia-reference-walk-5'}};
      const key=ensureCombatTextureForCharacter(this,actor);
      if(!key||!key.includes('mortacia-reference-walk-6'))throw Error('Stale Mortacia sheet');
      for(const facing of['left','right'])for(let walkFrame=0;walkFrame<4;walkFrame++){
        actor.facing=facing;actor.walkFrame=walkFrame;
        for(const full of[false,true])for(const offset of[0,.25,.5,.75]){
          this.actorRT=full?actors:null;const target=full?actors:this.renderRT;target.clear();
          drawCombatTextureOnRT(this,key,getCombatFrameName(actor),(32-size/2)/2+offset,(32-size/2)/2,size/2,actor);
          const image=await new Promise(resolve=>target.snapshot(resolve));
          const canvas=document.createElement('canvas');canvas.width=canvas.height=full?64:32;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let blade=0,x0=canvas.width,y0=canvas.height,x1=-1,y1=-1,hash=2166136261;const bladeColumns=new Set();
          for(let i=0;i<pixels.length;i+=4){
            if(pixels[i]===244&&pixels[i+1]===206&&pixels[i+2]===142&&pixels[i+3]){blade++;bladeColumns.add(i/4%canvas.width);}
            if(pixels[i+3]){const x=i/4%canvas.width,y=Math.floor(i/4/canvas.width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
            for(let j=0;j<4;j++)hash=Math.imul(hash^pixels[i+j],16777619);
          }
          const row={type,facing,walkFrame,offset,blade,bladeWidth:bladeColumns.size,width:x1-x0+1,height:y1-y0+1,hash:hash>>>0};
          (full?rows:legacy).push(row);
          if(full&&facing==='left'&&offset===0)pictures.push({type,walkFrame,canvas});
        }
      }
    }
    const consistent=rows.filter(r=>r.type==='pc').every(pc=>{
      const npc=rows.find(r=>r.type==='npc'&&r.facing===pc.facing&&r.walkFrame===pc.walkFrame&&r.offset===pc.offset);
      return npc.hash===pc.hash&&npc.height===pc.height;
    });
    const preview=document.createElement('canvas');preview.width=512;preview.height=350;const g=preview.getContext('2d');
    g.fillStyle='#252627';g.fillRect(0,0,512,350);g.imageSmoothingEnabled=false;
    for(const picture of pictures){const x=picture.walkFrame*128,y=picture.type==='pc'?24:188;
      g.drawImage(picture.canvas,x,y,128,128);g.fillStyle='#ede1cb';g.font='15px Georgia';g.fillText(picture.type.toUpperCase()+' frame '+picture.walkFrame,x+12,y+148);}
    const stableBlade=rows.every(r=>r.bladeWidth===rows.find(s=>s.type===r.type&&s.facing===r.facing&&s.offset===r.offset&&s.walkFrame===0).bladeWidth);
    const preferredThickness=rows.filter(r=>r.offset===0).every(r=>r.bladeWidth===2);
    const partyRows=[],partyPictures=[];
    for(const spec of partySpecs){
      let originalKey;
      for(const type of['pc','npc','monster']){
        const actor={name:spec.name,type,sprite:{spec,dataUrl:'data:existing-art'}};
        const key=ensureCombatTextureForCharacter(this,actor);originalKey??=key;
        if(originalKey!==key)throw Error('Role-dependent texture for '+actor.name);
        const tokenSize=combatMapActorSize(actor,25),expected=Math.max(32,25*(/\\b(human|elf|elves|half-elf)\\b/i.test(spec.race||'')?1.4:1.35)*spec.stature.scale);
        const measured=createCharacterSpriteCanvas(actor,spec)._combatBodyHeight;
        const nominal=createTraitSpriteCanvas(spec,0,{measureBody:true})._combatBodyHeight;
        for(const facing of['left','right'])for(let walkFrame=0;walkFrame<4;walkFrame++){
          actor.facing=facing;actor.walkFrame=walkFrame;this.actorRT=actors;
          for(const before of type==='pc'&&facing==='left'&&walkFrame===0?[true,false]:[false]){
            const size=tokenSize*(before?measured/nominal:1);actors.clear();
            drawCombatTextureOnRT(this,key,getCombatFrameName(actor),(64-size)/4,(64-size)/4,size/2,actor);
            const image=await new Promise(resolve=>actors.snapshot(resolve));
            const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d');c.drawImage(image,0,0);
            const data=c.getImageData(0,0,64,64).data;let low=64,high=-1,hash=2166136261;
            for(let i=0;i<data.length;i+=4){if(data[i+3]){const y=Math.floor(i/4/64);low=Math.min(low,y);high=Math.max(high,y);}
              for(let j=0;j<4;j++)hash=Math.imul(hash^data[i+j],16777619);}
            if(!before)partyRows.push({name:spec.name,type,facing,walkFrame,height:high-low+1,expected,tokenSize,hash:hash>>>0});
            if(type==='pc'&&facing==='left'&&walkFrame===0)partyPictures.push({name:spec.name,before,canvas,height:high-low+1});
          }
        }
      }
    }
    const partyRoleParity=partyRows.filter(r=>r.type==='pc').every(pc=>partyRows.filter(r=>r.name===pc.name&&r.facing===pc.facing&&r.walkFrame===pc.walkFrame).every(r=>r.hash===pc.hash));
    const partySizingPass=partyRoleParity&&partyRows.every(r=>Math.abs(r.height-r.expected)<(r.walkFrame===0?1.5:3.5));
    const nativeRows=[],nativeRT=this.add.renderTexture(0,0,256,256).setOrigin(0);
    nativeRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for(const spec of nativeSpecs)for(const type of['pc','npc','monster']){
      const actor={name:spec.name,type,sprite:{spec,dataUrl:'data:native-replay'}};
      const key=ensureCombatTextureForCharacter(this,actor),texture=this.textures.get(key),sourceSize=texture.get('frame0').width;
      if(sourceSize<=96)throw Error('Large creature is still using a small source frame');
      const size=combatMapActorSize(actor,25),expected=25*1.35*spec.stature.scale;
      const source=createCombatSpriteSheetCanvas(actor,spec),poseBounds=[];
      for(let frame=0;frame<4;frame++){
        const data=source.getContext('2d').getImageData(frame*source.height,0,source.height,source.height).data;
        let left=source.height,right=-1,low=source.height,high=-1;
        for(let i=0;i<data.length;i+=4)if(data[i+3]){const x=i/4%source.height,y=Math.floor(i/4/source.height);left=Math.min(left,x);right=Math.max(right,x);low=Math.min(low,y);high=Math.max(high,y);}
        poseBounds.push({width:expected*(right-left+1)/source._combatBodyHeight,height:expected*(high-low+1)/source._combatBodyHeight});
      }
      for(const facing of['left','right'])for(let walkFrame=0;walkFrame<4;walkFrame++){
        actor.facing=facing;actor.walkFrame=walkFrame;this.actorRT=nativeRT;nativeRT.clear();
        drawCombatTextureOnRT(this,key,getCombatFrameName(actor),(256-size)/4,(256-size)/4,size/2,actor);
        const image=await new Promise(resolve=>nativeRT.snapshot(resolve));
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');c.drawImage(image,0,0);
        const pixels=c.getImageData(0,0,256,256).data;let left=256,right=-1,low=256,high=-1,hash=2166136261;
        for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]){const x=i/4%256,y=Math.floor(i/4/256);left=Math.min(left,x);right=Math.max(right,x);low=Math.min(low,y);high=Math.max(high,y);}
          for(let j=0;j<4;j++)hash=Math.imul(hash^pixels[i+j],16777619);}
        nativeRows.push({name:spec.name,type,facing,walkFrame,sourceSize,width:right-left+1,height:high-low+1,expected,
          expectedPose:poseBounds[walkFrame].height,expectedWidth:poseBounds[walkFrame].width,
          uncut:left>0&&right<255&&low>0&&high<255,hash:hash>>>0});
      }
    }
    const nativeRoleParity=nativeRows.filter(r=>r.type==='pc').every(pc=>nativeRows.filter(r=>r.name===pc.name&&r.facing===pc.facing&&r.walkFrame===pc.walkFrame).every(r=>r.hash===pc.hash));
    const nativeSizingPass=nativeRoleParity&&nativeRows.every(r=>r.uncut&&Math.abs(r.height-r.expectedPose)<2&&Math.abs(r.width-r.expectedWidth)<2&&
      (r.walkFrame!==0||Math.abs(r.height-r.expected)<2));
    let partyPng;
    if(partySpecs.length){
      const gallery=document.createElement('canvas');gallery.width=448;gallery.height=52+partySpecs.length*164;const g=gallery.getContext('2d');
      g.fillStyle='#252627';g.fillRect(0,0,gallery.width,gallery.height);g.imageSmoothingEnabled=false;g.fillStyle='#eadac0';g.font='18px Georgia';
      g.fillText('Before',28,28);g.fillText('Shared Body Sizing',236,28);
      for(const [row,spec]of partySpecs.entries())for(const before of[true,false]){
        const p=partyPictures.find(p=>p.name===spec.name&&p.before===before),x=before?24:240,y=52+row*164;
        g.drawImage(p.canvas,x,y,128,128);g.fillStyle='#eadac0';g.font='12px Georgia';g.fillText(p.name,x,y+144);g.fillText(p.height+' pixels tall',x,y+160);
      }
      partyPng=gallery.toDataURL('image/png');
    }
    const pass=consistent&&stableBlade&&preferredThickness&&rows.every(r=>r.blade>0&&r.height>=38)&&legacy.some(r=>r.blade===0)&&partySizingPass&&nativeSizingPass;
    await report({pass,consistent,stableBlade,preferredThickness,fullResolutionCases:rows.length,legacyMissingSword:legacy.filter(r=>!r.blade).length,
      minimumSwordPixels:Math.min(...rows.map(r=>r.blade)),heights:[...new Set(rows.map(r=>r.height))],partySizingPass,partyRoleParity,partyRows,nativeSizingPass,nativeRoleParity,nativeRows,partyPng,png:preview.toDataURL('image/png')});
  }
}
new Phaser.Game({type:Phaser.WEBGL,parent:'map',width:144,height:72,pixelArt:true,antialias:false,scene:[Probe],audio:{noAudio:true}});
</script></html>`;
let received,child;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/report'&&req.method==='POST'){
    let body='';req.on('data',b=>body+=b);req.on('end',()=>{try{received=JSON.parse(body);res.end('ok');child?.kill();}catch{res.writeHead(400);res.end();}});return;
  }
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
  if(!/^\/(assets\/[\w.-]+\.js|node_modules\/phaser\/dist\/phaser.min.js)$/.test(url.pathname)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(root,url.pathname.slice(1))).pipe(res);
});
server.listen(0,'127.0.0.1',()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-combat-sprites-'));
  const args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync',
    '--user-data-dir='+profile,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','http://127.0.0.1:'+server.address().port+'/'];
  if(process.argv.includes('--software'))args.unshift('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  child=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args,{windowsHide:true});
  let err='';child.stderr.on('data',b=>err=(err+b).slice(-3000));const timer=setTimeout(()=>child.kill(),60000);
  child.on('error',error=>{clearTimeout(timer);console.error(error);server.close();process.exitCode=1;});
  child.on('close',()=>{clearTimeout(timer);
    if(received?.png){const dir=path.join(root,'logs/probes');fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'mortacia-combat-vertical-grip.png'),Buffer.from(received.png.split(',')[1],'base64'));delete received.png;}
    if(received?.partyPng){fs.writeFileSync(path.join(root,'logs/probes/combat-party-size-comparison.png'),Buffer.from(received.partyPng.split(',')[1],'base64'));delete received.partyPng;}
    console.log(JSON.stringify(received||{error:'No browser report',stderr:err},null,2));process.exitCode=received?.pass?0:1;
    server.closeAllConnections();server.close();
  });
});
