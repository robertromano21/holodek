'use strict';
// Read-only save replay through the production Phaser texture/compositing path.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),C=require('../assets/renderCharacterProcedural');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function savedRosters(directory=path.join(root,'.retort-data/saves')){
  return ['01','02'].map(slot=>{
    const file=path.join(directory,'slot-'+slot+'.json.gz'),bytes=fs.readFileSync(file);
    const payload=JSON.parse(zlib.gunzipSync(bytes)).payload,browser=payload.browser.data;
    const canonical=JSON.parse(payload.server.combatCharactersString),old=browser.combatCharacters||[];
    const actors=canonical.map(a=>{
      const previous=old.find(o=>o.name===a.name)||{},sprite=previous.sprite||a.sprite;
      if(!sprite?.dataUrl)throw Error('Missing saved sprite: '+slot+'/'+a.name);
      return{name:a.name,type:a.type||previous.type,savedBodyFraction:previous._combatBodyFraction,
        discoveryState:previous.discoveryState,sprite:{...sprite,dataUrl:'data:saved-replay'}};
    });
    return{slot,file,sha256:hash(bytes),room:payload.roomName,pc:payload.pc,actors};
  });
}
function page(saves){
  const game=fs.readFileSync(path.join(root,'assets/game.js'),'utf8');
  const scales=[...game.matchAll(/^const (COMBAT_\w*TOKEN_SCALE) = ([\d.]+);/gm)].map(m=>'const '+m[1]+'='+m[2]+';').join('\n');
  const helpers=game.slice(game.indexOf('function fitCombatNpcSpriteSheet('),game.indexOf('function syncCombatActorOverlayFromMaze('));
  const key=game.slice(game.indexOf('function getCombatTextureKey('),game.indexOf('// Re-create a combat-map visual when'));
  const facing=game.slice(game.indexOf('function deriveFacingFromDelta('),game.indexOf('function advanceWalkFrame('));
  const knight={name:'Suzerain',type:'pc',sprite:{spec:C.getPresetProceduralSpec('Suzerain'),dataUrl:'data:preset-replay'}};
  return `<!doctype html><html><meta charset="utf-8"><div id="map"></div>
<script src="/node_modules/phaser/dist/phaser.min.js"></script><script src="/assets/renderCharacterProcedural.js"></script><script src="/assets/renderCharacterSprite.js"></script><script>
const saves=${JSON.stringify(saves).replace(/</g,'\\u003c')},knight=${JSON.stringify(knight)};
const applyProceduralSpriteToEntry=()=>false;
${scales}\n${facing}\n${key}\n${helpers}
async function report(result){await fetch('/report',{method:'POST',body:JSON.stringify(result)});}
function bounds(canvas){const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let left=canvas.width,top=canvas.height,right=-1,bottom=-1,h=2166136261;
  for(let i=0;i<p.length;i+=4){if(p[i+3]){const x=i/4%canvas.width,y=Math.floor(i/4/canvas.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    for(let k=0;k<4;k++)h=Math.imul(h^p[i+k],16777619);}
  return{left,top,right,bottom,width:right-left+1,height:bottom-top+1,hash:h>>>0};}
class Probe extends Phaser.Scene{
  create(){this.run().catch(error=>report({pass:false,error:error.stack}));}
  async run(){this.PIXEL_SCALE=2;this.renderRT=this.add.renderTexture(0,0,256,256).setOrigin(0);this.actorRT=this.renderRT;
    this.actorRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);const rows=[],pictures=[];
    for(const save of [...saves,{slot:'preset',room:'start-mode comparison',actors:[knight]}])for(const saved of save.actors){
      const source=createCombatSpriteSheetCanvas(saved,saved.sprite.spec),sourcePoses=[];
      for(let f=0;f<4;f++){const c=document.createElement('canvas');c.width=c.height=source.height;
        c.getContext('2d').drawImage(source,f*source.height,0,source.height,source.height,0,0,source.height,source.height);sourcePoses.push(bounds(c));}
      for(const type of ['pc','npc','monster']){
        const actor={...saved,type,sprite:{...saved.sprite}},key=ensureCombatTextureForCharacter(this,actor),size=combatMapActorSize(actor,25);
        const effectiveSpec=ProceduralCharacters.getPresetProceduralSpec(actor.name)||actor.sprite.spec,stature=ProceduralCharacters.characterStature(effectiveSpec);
        const humanElf=/\\b(human|elf|elves|half-elf)\\b/i.test(effectiveSpec.race||'');
        const bodyTarget=Math.max(32,25*(humanElf?1.4:1.35)*stature.scale),bodyPixels=size*actor._combatBodyFraction;
        for(const facing of ['left','right'])for(let walkFrame=0;walkFrame<4;walkFrame++){
          Object.assign(actor,{facing,walkFrame});this.actorRT.clear();
          drawCombatTextureOnRT(this,key,getCombatFrameName(actor),(256-size)/4,(256-size)/4,size/2,actor);
          const img=await new Promise(resolve=>this.actorRT.snapshot(resolve)),canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').drawImage(img,0,0);
          const ink=bounds(canvas),pose=sourcePoses[walkFrame];
          const expectedHeight=bodyTarget*pose.height/source._combatBodyHeight,expectedWidth=bodyTarget*pose.width/source._combatBodyHeight;
          rows.push({slot:save.slot,room:save.room,name:actor.name,savedRole:saved.type,type,facing,walkFrame,stature:stature.scale,
            bodyTarget,bodyPixels,bodyFraction:actor._combatBodyFraction,tokenSize:size,height:ink.height,width:ink.width,expectedHeight,expectedWidth,
            uncut:ink.left>0&&ink.top>0&&ink.right<255&&ink.bottom<255,hash:ink.hash});
          if(type===saved.type&&facing==='left'&&walkFrame===0)pictures.push({slot:save.slot,name:actor.name,canvas,ink,bodyTarget});
        }
      }
    }
    const roleParity=rows.filter(r=>r.type==='pc').every(pc=>rows.filter(r=>r.slot===pc.slot&&r.name===pc.name&&r.facing===pc.facing&&r.walkFrame===pc.walkFrame).every(r=>r.hash===pc.hash&&r.tokenSize===pc.tokenSize));
    const failures=rows.filter(r=>!r.uncut||Math.abs(r.bodyPixels-r.bodyTarget)>1e-6||Math.abs(r.height-r.expectedHeight)>2||Math.abs(r.width-r.expectedWidth)>2);
    const galleries=[];
    for(const save of saves){const items=pictures.filter(p=>p.slot===save.slot),canvas=document.createElement('canvas');canvas.width=800;canvas.height=46+Math.ceil(items.length/4)*190;
      const g=canvas.getContext('2d');g.fillStyle='#252627';g.fillRect(0,0,canvas.width,canvas.height);g.fillStyle='#eadac0';g.font='18px Georgia';g.fillText('Slot '+save.slot+': '+save.room,14,28);g.imageSmoothingEnabled=false;
      for(let i=0;i<items.length;i++){const p=items[i],x=i%4*200,y=46+Math.floor(i/4)*190,scale=2;
        g.drawImage(p.canvas,p.ink.left,p.ink.top,p.ink.width,p.ink.height,x+(200-p.ink.width*scale)/2,y+146-p.ink.height*scale,p.ink.width*scale,p.ink.height*scale);
        g.fillStyle='#eadac0';g.font='13px Georgia';g.fillText(p.name,x+8,y+166);g.fillText(p.bodyTarget.toFixed(2)+' body px',x+8,y+184);}
      galleries.push({slot:save.slot,png:canvas.toDataURL('image/png')});}
    await report({pass:roleParity&&failures.length===0,roleParity,cases:rows.length,failures,rows,galleries,
      scope:'Saved artwork replayed as PC/NPC/monster, covering the shared size path used by Mortacia, Suzerain and Party starts. No campaign generation or live save load.'});
  }
}
new Phaser.Game({type:Phaser.WEBGL,parent:'map',width:256,height:256,pixelArt:true,antialias:false,scene:[Probe],audio:{noAudio:true}});
</script></html>`;
}
async function main(){
  const saves=savedRosters(),html=page(saves),profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-save-sizing-'));
  let finish,child;const answer=new Promise(resolve=>finish=resolve);
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    if(u.pathname==='/report'&&req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{try{const result=JSON.parse(body);res.end('ok');finish(result);}catch(error){res.writeHead(400);res.end();finish({pass:false,error:error.message});}});return;}
    if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(!/^\/(assets\/[\w.-]+\.js|node_modules\/phaser\/dist\/phaser.min.js)$/.test(u.pathname)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(root,u.pathname.slice(1))).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--user-data-dir='+profile,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'];
    if(process.argv.includes('--software'))args.push('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
    args.push('http://127.0.0.1:'+server.address().port+'/');
    child=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args,{windowsHide:true});
    let stderr='',timer;child.stderr.on('data',b=>stderr=(stderr+b).slice(-3000));
    const stopped=new Promise(resolve=>{child.once('error',e=>resolve({pass:false,error:e.message}));child.once('exit',()=>resolve({pass:false,error:'Browser exited',stderr}));});
    const timeout=new Promise(resolve=>timer=setTimeout(()=>resolve({pass:false,error:'Browser timeout',stderr}),90000));
    const result=await Promise.race([answer,stopped,timeout]);clearTimeout(timer);
    result.savesUnchanged=saves.every(s=>hash(fs.readFileSync(s.file))===s.sha256);result.pass=result.pass&&result.savesUnchanged;
    const out=path.join(root,'logs/probes');fs.mkdirSync(out,{recursive:true});
    for(const gallery of result.galleries||[])fs.writeFileSync(path.join(out,'save-'+gallery.slot+'-combat-sizing.png'),Buffer.from(gallery.png.split(',')[1],'base64'));
    delete result.galleries;
    const report=path.join(out,'saved-combat-sizing.json');fs.writeFileSync(report,JSON.stringify(result,null,2));
    const idle=result.rows?.filter(r=>r.type===r.savedRole&&r.facing==='left'&&r.walkFrame===0);
    console.log(JSON.stringify({...result,rows:idle,report},null,2));process.exitCode=result.pass?0:1;
  }finally{child?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={savedRosters};
