'use strict';
// Isolated production-map replay. No live server, save loading, model calls or campaign writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), game = fs.readFileSync(path.join(root, 'assets/game.js'), 'utf8');
const scales = [...game.matchAll(/^const (COMBAT_\w*TOKEN_SCALE) = ([\d.]+);/gm)].map(m => `const ${m[1]}=${m[2]};`).join('\n');
const helpers = game.slice(game.indexOf('function fitCombatNpcSpriteSheet('), game.indexOf('function syncCombatActorOverlayFromMaze('));
const keyFunction = game.slice(game.indexOf('function getCombatTextureKey('), game.indexOf('// Re-create a combat-map visual when'));
const facing = game.slice(game.indexOf('function deriveFacingFromDelta('), game.indexOf('function advanceWalkFrame('));
const combatScene = game.slice(game.indexOf('class CombatScene extends'), game.indexOf('const gameConfig ='));
const pointerHandler = game.slice(game.indexOf("        this.input.on('pointerup', pointer => {"), game.indexOf('        // Camera shows only the RT'));
const index = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const popupCss = [...index.matchAll(/  \.combat-target-actions[^\n]+/g)].map(m => m[0]).join('\n');
const html = `<!doctype html><html><meta charset="utf-8"><style>
body{margin:0;background:#181715;color:#eee;font:16px Georgia}#combat-popup{width:480px;height:420px}#combat-header{height:40px}
#combat-container{width:480px;height:380px;overflow:auto}#combat-map-status{pointer-events:none}button{font:12px monospace}
.popup-container{position:absolute;top:310px;right:5px;width:200px;background-color:rgba(0,0,0,.9);border:1px solid white;border-radius:8px;padding:0;box-sizing:border-box;color:white;font:14px Arial,sans-serif;text-align:center}
${popupCss}
</style><div id="combat-popup"><div id="combat-header"><span>Combat Mode</span><button>X</button></div><div id="combat-container"></div></div>
<div id="phaser-popup" style="position:fixed;right:5px;top:5px;width:200px;height:240px">Game Console</div>
<script>window.onerror=(message,source,line)=>fetch('/report',{method:'POST',body:JSON.stringify({pass:false,error:message,line})});</script>
<script src="/node_modules/phaser/dist/phaser.min.js"></script><script src="/assets/renderCharacterProcedural.js"></script>
<script src="/assets/renderCharacterSprite.js"></script><script src="/assets/combatCharacterUi.js"></script><script src="/assets/combatFootprint.js"></script><script src="/assets/combatTurnUi.js"></script><script src="/assets/combatTacticalUi.js"></script><script>
const checks={},errors=[],requests=[],submissions=[],realFetch=fetch.bind(window);let sheetCalls=0;
const currentDungeon={geoKey:'1,0,0',cells:{},tiles:{}},dungeonTextures={},applyProceduralSpriteToEntry=()=>false;
for(let y=0;y<12;y++)for(let x=0;x<12;x++)currentDungeon.cells[x+','+y]={tile:x===0||y===0||x===11||y===11?'wall':'floor'};
currentDungeon.cells['7,4'].tile='pillar';
const getPlayerPosForMap=()=>({x:4.5,y:4.5}),getCombatMapRotationAngle=()=>.35;
const isBlockedDungeonCell=c=>c.tile==='wall',isDungeonCliffEdge=()=>false,isObstacleTile=t=>t==='pillar';
const syncCombatActorOverlayFromMaze=()=>{},drawDungeonExitMapMarkers=()=>{};
const ensureMonsterSpriteData=()=>{},isDungeonActorPresent=a=>a.discoveryState!=='pending';
window.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({})};};
window.openCombatCharacterSheet=()=>sheetCalls++;
const giantSpec=ProceduralCharacters.buildProceduralSpriteSpec({name:'Temple Guardian',race:'Giant',class:'Warrior'});
window.combatCharacters=[{name:'Mortacia',type:'pc',hp:138,mazeX:4,mazeY:4,sprite:{spec:ProceduralCharacters.getPresetProceduralSpec('Mortacia'),dataUrl:'data:preset'}},
{name:'Temple Guardian',type:'monster',hp:100,mazeX:5,mazeY:4,sprite:{spec:giantSpec,dataUrl:'data:generated'}},
{name:'Companion',type:'npc',hp:20,mazeX:4,mazeY:6,sprite:{spec:ProceduralCharacters.buildProceduralSpriteSpec({name:'Companion',race:'Elf',class:'Wizard'}),dataUrl:'data:generated'}}];
${scales}
const COMBAT_CELL_SIZE=25,COMBAT_GRID_CENTER=15;
${facing}
${keyFunction}
${helpers}
${combatScene}
class Probe extends CombatScene {
create(){this.run().catch(e=>{errors.push(e.stack);this.report();});}
async run(){
window.combatGame=this.game;this.PIXEL_SCALE=2;this.gridSize=31;this.cellSize=25;this.RT_CELL=12.5;this.worldW=this.worldH=775;
this.characters={};this.pcName='';this.domContainer=document.getElementById('combat-container');
this.renderRT=this.add.renderTexture(0,0,388,388).setOrigin(0).setScale(2);this.actorRT=this.add.renderTexture(0,0,775,775).setOrigin(0);
this.renderRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);this.actorRT.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
this.cameras.main.setBounds(0,0,775,775);this.cameras.main.centerOn(387.5,387.5);
${pointerHandler}
CombatTacticalUi.bind(this);
checks.explorationStartsAtNormalZoom=this.cameras.main.zoom===1;
this.redrawCombatRT();const normalCellSize=this._lastDungeonDraw.cs;
const normalTokenSizes=new Map(this.combatActorHitTargets.map(t=>[t.character.name,t.size]));
window.actionDiceState={active:{kind:'combat',turn:{tactical:true,allowRetreat:true,round:1,turnId:'test-turn',combatant:'Mortacia',targets:['Temple Guardian'],attackTargets:['Temple Guardian'],
movement:{revision:0,remaining:6,total:6,position:{x:4.5,y:4.5},tiles:[{x:3,y:4,cost:1},{x:3,y:3,cost:2},{x:4,y:3,cost:1},{x:5,y:3,cost:2},{x:6,y:3,cost:3}]}}}};
CombatTacticalUi.receive(actionDiceState);
CombatTurnUi.receive(actionDiceState.active.turn);
checks.combatStartsAt175=this.cameras.main.zoom===1.75;
this.cameras.main.centerOn(387.5,387.5);this.redrawCombatRT();await new Promise(resolve=>setTimeout(resolve,400));
checks.onlyTilesGrow=this._lastDungeonDraw.cs===normalCellSize*1.25&&this.combatActorHitTargets.every(t=>t.size===normalTokenSizes.get(t.character.name));
checks.avatarsCenteredOnTheirFootprints=this.combatActorHitTargets.every(t=>{
  const actor=t.character,d=this._lastDungeonDraw,at=actor.type==='pc'?d.pos:{x:actor.mazeX,y:actor.mazeY},center=CombatTacticalUi.actorPoint(actor,at);
  const dx=(center.x-d.pos.x)*d.cs,dy=(center.y-d.pos.y)*d.cs;
  const x=(d.centerX+dx*Math.cos(d.combatAngle)-dy*Math.sin(d.combatAngle))*2,y=(d.centerY+dx*Math.sin(d.combatAngle)+dy*Math.cos(d.combatAngle))*2;
  return Math.abs(t.x+t.size/2-x)<=1&&Math.abs(t.y+t.size/2-y)<=1;
});
const keyMoveCount=requests.filter(r=>r.url==='/combat/move').length;
this.game.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await this.wait();
checks.keyboardMovesThroughTacticalEndpoint=requests.filter(r=>r.url==='/combat/move').length===keyMoveCount+1&&requests.at(-1)?.body.x===4&&requests.at(-1)?.body.y===3;
this.game.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await this.wait();
checks.keyboardBumpOpensMonsterWithoutAttacking=!!document.querySelector('.combat-target-actions')&&requests.filter(r=>r.url==='/submit-target2').length===0;
document.querySelector('.combat-target-actions button:last-child')?.click();
const pictures=[];
for(const zoom of[1.25,1.5,1.75]){
CombatTacticalUi.setMapZoom(zoom);await this.wait();
const d=this._lastDungeonDraw;
checks['pcInCenterCell-'+zoom]=CombatTacticalUi.tileAt(d,387.5,387.5,2).x===4&&CombatTacticalUi.tileAt(d,387.5,387.5,2).y===4;
for(const uiScale of[1,1.3125,1.75,2]){
document.body.style.zoom=uiScale;this.scale.refresh();await this.wait();
const screen=this.screenPoint(5,4),rect=this.game.canvas.getBoundingClientRect();
const clientX=rect.left+screen.x*rect.width/this.scale.width,clientY=rect.top+screen.y*rect.height/this.scale.height;
this.game.canvas.dispatchEvent(new PointerEvent('pointermove',{clientX,clientY,bubbles:true,pointerId:1,pointerType:'mouse'}));await this.wait();
checks['hover-'+zoom+'-'+uiScale]=document.getElementById('combat-map-status').textContent.includes('Square 5, 4: Temple Guardian (attack available)');
const count=requests.filter(r=>r.url==='/submit-target2').length;
this.game.canvas.dispatchEvent(new MouseEvent('mousedown',{clientX,clientY,bubbles:true,button:0,buttons:1}));await this.wait();
this.game.canvas.dispatchEvent(new MouseEvent('mouseup',{clientX,clientY,bubbles:true,button:0}));await this.wait();
checks['clickOpensOnly-'+zoom+'-'+uiScale]=!!document.querySelector('.combat-character-actions')&&requests.filter(r=>r.url==='/submit-target2').length===count;
checks['noSheet-'+zoom+'-'+uiScale]=sheetCalls===0&&!document.getElementById('party-popup');
const popupRect=document.querySelector('.combat-target-actions').getBoundingClientRect(),consoleRect=document.getElementById('phaser-popup').getBoundingClientRect();
checks['belowConsole-'+zoom+'-'+uiScale]=Math.abs(popupRect.top-consoleRect.bottom-5*uiScale)<2&&Math.abs(popupRect.left-consoleRect.left)<2;
checks['pointer-'+zoom+'-'+uiScale]=this.game.canvas.style.cursor==='pointer';
const attack=[...document.querySelectorAll('.combat-character-actions button')].find(b=>b.textContent==='Attack Temple Guardian');
attack?.click();await this.wait();checks['attackChosen-'+zoom+'-'+uiScale]=requests.filter(r=>r.url==='/submit-target2').length===count+1&&requests.at(-1)?.body.target==='Temple Guardian';
document.getElementById('party-popup')?.remove();CombatTurnUi.receive(actionDiceState.active.turn);
}
document.body.style.zoom=1;this.scale.refresh();await this.wait();
const snapshot=await new Promise(resolve=>this.game.renderer.snapshot(resolve));pictures.push({zoom,png:snapshot.src});
this.game.canvas.dispatchEvent(new PointerEvent('pointerleave'));await this.wait();
checks['leave-'+zoom]=!this.combatHoverPoint;
checks['noPermanentLegend-'+zoom]=document.getElementById('combat-map-status').hidden;
}
CombatTacticalUi.receive({active:null});checks.combatEndsAtNormalZoom=this.cameras.main.zoom===1;
checks.normalTileSpacingRestored=this._lastDungeonDraw.cs===normalCellSize;
CombatTacticalUi.receive(actionDiceState);checks.secondCombatStartsAt175=this.cameras.main.zoom===1.75;
CombatTacticalUi.setMapZoom(1.25);CombatTacticalUi.receive({active:null});checks.customCombatZoomAlsoRestores=this.cameras.main.zoom===1;
await this.report(pictures);
}
screenPoint(x,y){const d=this._lastDungeonDraw,dx=(x+.5-d.pos.x)*d.cs*2,dy=(y+.5-d.pos.y)*d.cs*2;
return this.cameras.main.matrix.transformPoint(d.centerX*2+dx*Math.cos(d.combatAngle)-dy*Math.sin(d.combatAngle)-this.cameras.main.scrollX,
d.centerY*2+dx*Math.sin(d.combatAngle)+dy*Math.cos(d.combatAngle)-this.cameras.main.scrollY);}
wait(){return new Promise(resolve=>setTimeout(resolve,60));}
async report(pictures=[]){await realFetch('/report',{method:'POST',body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!errors.length,checks,errors,pictures,submissions:submissions.length})});}
}
new Phaser.Game({type:Phaser.${process.argv.includes('--canvas') ? 'CANVAS' : 'WEBGL'},parent:'combat-container',width:480,height:380,pixelArt:true,antialias:false,scene:[Probe],audio:{noAudio:true}});
</script></html>`;
async function main() {
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new (require('node:vm').Script)(script);
  let finish, child;
  const answer = new Promise(resolve => { finish = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report') { let body = ''; req.on('data', b => body += b); req.on('end', () => { res.end('ok'); finish(JSON.parse(body)); }); return; }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (!/^\/(assets\/[\w.-]+\.js|node_modules\/phaser\/dist\/phaser.min.js)$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(path.join(root, req.url.slice(1))).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-combat-map-'));
  let timer;
  try {
    child = spawn(process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
        '--window-size=1680,950', '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ pass: false, error: 'Browser timed out' }), 30000); });
    const failure = new Promise(resolve => { child.on('error', e => resolve({ pass: false, error: e.message })); child.on('exit', () => resolve({ pass: false, error: 'Browser exited' })); });
    const report = await Promise.race([answer, timeout, failure]);
    const out = path.join(root, 'logs/probes'); fs.mkdirSync(out, { recursive: true });
    const { createCanvas, loadImage } = require('canvas'), gallery = createCanvas(1488, 446), g = gallery.getContext('2d');
    g.fillStyle = '#181715'; g.fillRect(0, 0, gallery.width, gallery.height); g.font = '22px Georgia'; g.textBaseline = 'top';
    for (const [i, picture] of (report.pictures || []).entries()) {
      g.fillStyle = '#e5bd72'; g.fillText(`${picture.zoom * 100}%: ${picture.zoom === 1.25 ? 'Modest' : picture.zoom === 1.5 ? 'Close' : 'Extra-Close'}`, i * 496 + 8, 12);
      g.drawImage(await loadImage(picture.png), i * 496 + 8, 48);
      fs.writeFileSync(path.join(out, `combat-map-${picture.zoom * 100}.png`), Buffer.from(picture.png.split(',')[1], 'base64'));
    }
    if (report.pictures?.length) { fs.writeFileSync(path.join(out, 'combat-map-zoom-options.png'), gallery.toBuffer()); report.preview = path.join(out, 'combat-map-zoom-options.png'); }
    delete report.pictures; console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
  } finally { clearTimeout(timer); child?.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
