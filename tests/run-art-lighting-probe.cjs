'use strict';
// Read-only replay of saved wall art through the production renderScene path.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const supplied=process.argv.slice(2).find(a=>!a.startsWith('--')),legacy=process.argv.includes('--legacy-anchor');
const plaqueMode=process.argv.includes('--plaque'),stoneworkMode=process.argv.includes('--stonework'),reverse=process.argv.includes('--reverse');
const mosaicMode=process.argv.includes('--mosaic'),floorMosaicMode=process.argv.includes('--floor-mosaic'),darkControl=process.argv.includes('--dark-control');
const logs=path.join(root,'logs/dungeons');
const file=supplied?path.resolve(supplied):fs.readdirSync(logs).filter(f=>f.startsWith('0,0,0-')&&f.endsWith('.json.gz'))
  .map(f=>path.join(logs,f)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
const d=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const fixture=d.physicalPuzzle?.fixtures?.find(f=>f.id==='plaque');
const [fx,fy]=fixture?.key.split(',').map(Number)||[];
const art=plaqueMode&&fixture?{tile:fixture.tiles[0],label:'Saved engraved plaque',axis:fixture.axis,sign:reverse?1:-1,surface:'object',
  position:{x:fx+.5-fixture.width/2,y:fy+.5-fixture.width/2,z:(d.cells[fixture.key].floorHeight||0)+.42},size:{x:fixture.width,y:fixture.width,z:.48}}:
  floorMosaicMode?d.surfaceArt.find(a=>a.kind==='mosaic'&&a.surface==='floor'&&!a.puzzleClue):
  mosaicMode?(d.surfaceArt.find(a=>a.kind==='mosaic'&&a.surface==='wall'&&a.style==='byzantine')||d.surfaceArt.find(a=>a.kind==='mosaic'&&a.surface==='wall')):
  d.surfaceArt.find(a=>stoneworkMode?a.carvingStyle&&a.surface==='wall':a.kind==='fresco'&&a.axis==='y'&&a.sign===-1);
if(!art)throw Error('Saved room has no requested artwork to replay.');
const images=Object.fromEntries([...d.surfaceArt.map(a=>a.tile),'wall','floor','torch'].filter(t=>d.tiles[t]?.url?.endsWith('.png')).map(tile=>[tile,'data:image/png;base64,'+
  fs.readFileSync(path.join(root,d.tiles[tile].url.slice(1))).toString('base64')]));
const scripts=['masonryPatterns','voxelMaterials','puzzleModules','puzzleMotion','renderCharacterProcedural',
  'shrineIconography','artCharacters','sculptureAnatomy','sculptureForms','stoneCarvings','ancientScripts','frescoDesigns',
  'frescoSerpents','frescoFigures','mosaicDesigns','surfaceArt','artPresentation','scenePropVoxels','readableItems','physicalPuzzles',
  'sceneExteriorDetails','characterMotion3d','rendererWebGL'];
const page=`<!doctype html><html><meta charset="utf-8"><div id="dungeon-popup" style="display:block"><div id="dungeon-container"></div></div><pre id="results">Running</pre>
<script>async function reportReplay(result){document.getElementById('results').textContent=JSON.stringify(result);
  await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});}
window.onerror=(m,s,l)=>{reportReplay({error:m,line:l});};</script>
${scripts.map(s=>'<script src="/assets/'+s+'.js"></script>').join('')}
<script>
(async()=>{try{
  document.getElementById('results').textContent=JSON.stringify({stage:'Loading saved images'});
  const d=${JSON.stringify(d)},art=${JSON.stringify(art)},images=${JSON.stringify(images)},plaqueMode=${plaqueMode},stoneworkMode=${stoneworkMode};
  const r=webglDungeonRenderer,textures={};
  for(const [tile,url] of Object.entries(images)){document.getElementById('results').textContent=JSON.stringify({stage:'Decoding '+tile});
    const img=new Image();img.src=url;await img.decode();textures[tile]=img;}
  for(const tile of ['wall','floor','torch'])if(!textures[tile]){const c=document.createElement('canvas');c.width=c.height=8;
    c.getContext('2d').fillStyle=tile==='wall'?'#67574a':tile==='floor'?'#322d27':'#e4a642';c.getContext('2d').fillRect(0,0,8,8);
    c.complete=true;c.naturalWidth=c.naturalHeight=8;textures[tile]=c;}
  window.currentDungeon=d;window.dungeonTextures=textures;window.WEBGPU_VOXEL_PREWARM=false;
  if(${darkControl})window.ArtPresentation.lights=()=>[];
  const target={x:art.position.x+art.size.x/2,y:art.position.y+art.size.y/2},distance=${floorMosaicMode}?2.5:plaqueMode?1.3:stoneworkMode?3:6;
  window.playerPosX=target.x+(art.axis==='x'?art.sign*distance:0);window.playerPosY=target.y+(art.axis==='y'?art.sign*distance:0);
  window.playerDungeonX=Math.floor(playerPosX);window.playerDungeonY=Math.floor(playerPosY);
  window.playerAngle=Math.atan2(target.y-playerPosY,target.x-playerPosX);
  window.playerZ=art.position.z+art.size.z/2;
  if(${floorMosaicMode}){window.playerZ=art.position.z+.45;window.dungeonViewShift=-.1;}
  // Specialize only world lighting; art still uses the unchanged production voxel shader and real cell texture.
  r.canvas=document.createElement('canvas');const context=r.canvas.getContext('webgl2'),shaderSource=context.shaderSource.bind(context);
  context.shaderSource=(shader,source)=>{
    const start=source.indexOf('float accumulateTorchLit(');
    if(start>=0&&source.includes('float floorHeightFromCell')){
      const opening=source.indexOf('{',start);let depth=1,end=opening+1;
      while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
      source=source.slice(0,opening+1)+'shadowBlend=0.0;primaryDir2D=vec2(0.0);primaryStrengthOut=0.0;return 0.0;}'+source.slice(end);
    }shaderSource(shader,source);
  };
  document.getElementById('results').textContent=JSON.stringify({stage:'Initializing renderer'});
  if(!r.init(document.getElementById('dungeon-container')))throw Error('Renderer initialization failed');
  context.shaderSource=shaderSource;
  const gl=r.gl,queries=[],uniformCalls=[],original=r.getCachedTorchLights;
  r.getCachedTorchLights=function(frame,x,y,...args){const selected=original.call(this,frame,x,y,...args);
    if(Math.abs(x-target.x)<art.size.x+.3&&Math.abs(y-target.y)<art.size.y+.3)
      queries.push({x,y,count:selected.length,own:selected.filter(v=>v.t.id?.startsWith(art.tile)).length});return selected;};
  if(${legacy}){const cached=r.getCachedTorchLights;r.getCachedTorchLights=function(frame,x,y,...args){
    if(Math.abs(x-(art.position.x+art.size.x/2))<.01&&Math.abs(y-art.position.y)<.3)y=art.position.y+art.size.y/2;
    return cached.call(this,frame,x,y,...args);};}
  const uniform=gl.uniform1i.bind(gl);gl.uniform1i=(loc,value)=>{if(loc===r.voxelUniforms.torchCount)uniformCalls.push(value);uniform(loc,value);};
  const savedMesh=r.getVoxelMesh;r.getVoxelMesh=plaqueMode?(tile,dungeon)=>tile===art.tile?savedMesh.call(r,tile,dungeon):null:()=>null;
  // The replay can focus on one saved object without changing the serialized room or live storage.
  if(plaqueMode)d.surfaceArt=d.surfaceArt.filter(a=>a.puzzleClue);
  if(stoneworkMode)d.surfaceArt=d.surfaceArt.filter(a=>a.tile===art.tile);
  r.renderScene();r.getVoxelMesh=savedMesh;
  const pixels=new Uint8Array(r.canvas.width*r.canvas.height*4);gl.readPixels(0,0,r.canvas.width,r.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let sum=0,n=0,bright=0;for(let y=Math.floor(r.canvas.height*.3);y<r.canvas.height*.7;y++)for(let x=Math.floor(r.canvas.width*.25);x<r.canvas.width*.75;x++){
    const i=(x+y*r.canvas.width)*4,value=pixels[i]+pixels[i+1]+pixels[i+2];sum+=value;n+=3;if(value>200)bright++;}
  const meshes=plaqueMode?(r.voxelMeshes[art.tile]?.passes||[]):[],modules=StoneCarvings.modules(art).length;
  const png=r.canvas.toDataURL('image/png');
  await reportReplay({label:art.label,queries,mean:sum/n,bright,passes:meshes.length,modules,
    uniformCalls,stats:r.lastFrameStats,error:gl.getError(),png});
}catch(e){await reportReplay({error:e.stack});}})();
</script></html>`;
let received,child;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/report'&&req.method==='POST'){
    let body='';req.on('data',b=>body+=b);req.on('end',()=>{try{received=JSON.parse(body);res.end('ok');child?.kill();}
      catch{res.writeHead(400);res.end();}});return;
  }
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d));return;}
  if(!/^\/(assets\/[\w.-]+\.js|sid\/sprites\/[\w.-]+\.png)$/.test(url.pathname)){res.writeHead(404);res.end();return;}
  const p=path.join(root,url.pathname.slice(1));if(!fs.existsSync(p)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'image/png');fs.createReadStream(p).pipe(res);
});
server.listen(0,'127.0.0.1',()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-art-replay-'));
  const args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync',
    '--user-data-dir='+profile,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'http://127.0.0.1:'+server.address().port+'/'];
  if(process.argv.includes('--software'))args.unshift('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  child=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args,{windowsHide:true});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err=(err+b).slice(-4000));
  const timer=setTimeout(()=>child.kill(),60000);
  child.on('error',e=>{clearTimeout(timer);console.error(e);server.close();process.exitCode=1;});
  child.on('close',()=>{clearTimeout(timer);try{
    const raw=out.match(/<pre id="results">([^<]*)<\/pre>/)?.[1],report=received||JSON.parse(raw?.replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
    if(report.png){const dir=path.join(root,'logs/probes');fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,floorMosaicMode?'saved-room-floor-mosaic-'+(darkControl?'dark-control':'lighting')+'.png':mosaicMode?'saved-room-mosaic-'+(darkControl?'dark-control':'lighting')+'.png':plaqueMode?'saved-room-plaque-'+(reverse?'back':'front')+'.png':stoneworkMode?'saved-room-stonework.png':legacy?'saved-room-art-dark-control.png':'saved-room-art-lighting.png'),Buffer.from(report.png.split(',')[1],'base64'));delete report.png;}
    const pass=report.error===0&&(plaqueMode?report.passes===3&&report.queries?.some(q=>q.count>0)&&report.bright>20:
      floorMosaicMode?report.queries?.some(q=>darkControl?q.own===0:q.own>0)&&report.bright>20:
      stoneworkMode?report.modules>1&&report.mean>20:report.queries?.some(q=>q.own===(legacy||darkControl?0:2))&&(legacy||darkControl?report.mean<35:report.mean>=35));
    console.log(JSON.stringify({file,legacy,plaqueMode,stoneworkMode,mosaicMode,floorMosaicMode,darkControl,reverse,pass,...report},null,2));process.exitCode=pass?0:1;
  }catch(e){console.error('Incomplete replay:',e.message,err);process.exitCode=1;}
  server.closeAllConnections();server.close();});
});
