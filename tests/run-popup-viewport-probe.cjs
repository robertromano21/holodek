'use strict';
// Isolated browser replay of production menus. No game server, saves or model calls.
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const production = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const css = [...production.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style>' + String.raw`
<link rel="stylesheet" href="/assets/gameUiFonts.css"><link rel="stylesheet" href="/assets/gameUiPixels.css"><link rel="stylesheet" href="/assets/gameUiDialogs.css">
<div id="dungeon-popup" style="display:block"><div id="dungeon-container">World</div></div>
<div id="combat-popup" style="display:block"><div id="combat-header">Combat Mode</div><div id="combat-container">Map</div></div>
<div id="phaser-popup" style="display:block"><div id="phaser-header">Game Console</div><div id="phaser-container">Console</div></div>
<div id="game-log-popup" style="display:block"><div id="game-log-header">Game Log</div><div id="game-log-container">Log</div></div>
<div id="game-menu" style="display:none"></div>
<script>
const realFetch=window.fetch.bind(window), requests=[], checks={}, details=[];
const send=data=>realFetch('/report',{method:'POST',body:JSON.stringify(data)});
window.onerror=message=>send({pass:false,error:message});
window.fetch=async(url,options)=>{
  if(url!=='/game-saves')throw Error('Unexpected game API call: '+url);
  requests.push(url);return {ok:true,json:async()=>({canLoad:true,slots:Array.from({length:10},(_,i)=>({slot:i+1,label:'Adventure '+(i+1),occupied:true,
    roomName:'A long saved room name with detailed architectural features and a final secret chamber',turns:42,savedAt:'2026-11-07T20:00:00Z',checksum:'fixture-only'}))})};
};
window.dungeonRunId='fixture';window.currentDungeon={geoKey:'0,0,0',sceneObjects:[]};
const names=['Keeper of the Western Gate','Guardian of the Bell','Friend of the Lost','Warden of the Archive','The Patient Archivist','The Last Sentinel'];
const mission={id:'request',source:'engine-resident-favor-v1',type:'resident-favor',runId:'fixture',roomKey:'0,0,0',floor:'street',recipient:names[0],
  title:'Open the Gate',description:'Solve the existing room puzzle.',status:'offered',starterRecruitment:true,invitationPending:true,
  recruitmentGroup:{id:'group',status:'review',members:names.map((name,i)=>({name,missionId:'request-'+i,status:'offered',outcome:'conditional',
    description:('Set the existing gate levers to the positions shown by the wall relief. Find the hidden book, read its contents, and return it to its owner. ').repeat(4)}))}};
window.getDungeonLifeContext=()=>({dungeon:currentDungeon,player:{x:4.5,y:4.5},actors:names.map(name=>({name,type:'monster',hp:20,state:'Friendly',mazeRoomKey:'0,0,0'}))});
window.getEconomyResidentInfo=()=>({kind:'mission',introduced:true,starterRecruitment:true,recruitmentCondition:mission});
let holds=0;
window.DungeonLife={holdDialogue(){holds++;return()=>holds--;},releaseAttention(){}};
const frame=()=>new Promise(resolve=>setTimeout(resolve,30));
const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
const within=n=>{const r=rect(n);return r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;};
const hit=n=>{const r=rect(n),found=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return found===n||n.contains(found);};
const coreIds=['dungeon-popup','phaser-popup','game-log-popup','combat-popup'];
const core=()=>coreIds.map(id=>rect(document.getElementById(id)));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
document.addEventListener('DOMContentLoaded',async()=>{try{
  await document.fonts.ready;await frame();
  for(const scale of [1,1.3125,1.75,2.25]){
    document.body.style.setProperty('--game-ui-scale',scale);await frame();const prefix=scale+':',before=core();
    checks[prefix+'recruitment-opens']=(await CommerceUi.open(names[0]))===true;await frame();
    const popup=document.querySelector('.recruitment-dialog'),content=popup.querySelector('.commerce-dialog-content'),actions=popup.querySelector('.commerce-dialog-actions');
    checks[prefix+'recruitment-fits']=within(popup);
    checks[prefix+'request-scrollable']=content.scrollHeight>content.clientHeight&&content.clientHeight>10;
    content.focus();content.scrollBy(0,300);await frame();checks[prefix+'request-scrolls']=content.scrollTop>0;
    checks[prefix+'no-horizontal-request-scroll']=content.scrollWidth<=content.clientWidth+1;
    checks[prefix+'footer-visible']=within(actions);
    checks[prefix+'decisions-reachable']=[...actions.querySelectorAll('button')].every(b=>within(b)&&hit(b));
    checks[prefix+'close-reachable']=within(popup.querySelector('.window-menu-tab button'))&&hit(popup.querySelector('.window-menu-tab button'));
    checks[prefix+'dialogue-held']=holds===1;
    details.push({scale,viewport:[innerWidth,innerHeight],recruitment:rect(popup),content:rect(content),actions:rect(actions)});
    popup.querySelector('.window-menu-tab button').click();CommerceUi.onFrame();await frame();
    checks[prefix+'dialogue-released']=holds===0;
    await HolodekSaveGame.open();await frame();const save=document.getElementById('save-game-dialog');
    checks[prefix+'save-fits']=within(save);
    checks[prefix+'save-no-horizontal-scroll']=save.scrollWidth<=save.clientWidth+1;
    const slots=save.querySelectorAll('.save-slot'),last=slots[slots.length-1],activated=[];
    last.querySelectorAll('button').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activated.push(button.textContent);},true));
    save.scrollTop=save.scrollHeight;await frame();
    checks[prefix+'save-scrolls']=save.scrollTop>0;
    checks[prefix+'last-slot-controls-reachable']=[...last.querySelectorAll('button')].every(b=>within(b)&&hit(b));
    last.querySelectorAll('button').forEach(b=>b.click());checks[prefix+'last-slot-controls-clickable']=activated.join(',')==='Save,Load';
    checks[prefix+'save-close-reachable']=within(save.querySelector('.window-menu-tab button'))&&hit(save.querySelector('.window-menu-tab button'));
    save.querySelector('.window-menu-tab button').click();await frame();checks[prefix+'save-closes']=!save.open&&save.getClientRects().length===0;
    const generic=document.createElement('div');generic.className='popup-container';generic.setAttribute('role','dialog');generic.setAttribute('aria-label','Long action menu');
    generic.style.cssText='position:fixed;left:50%;top:50%;right:auto;transform:translate(-50%,-50%);width:900px;min-width:800px;min-height:2000px;overflow:hidden';
    generic.innerHTML='<p>'+('A long menu option with additional context. '.repeat(120))+'</p><button>Continue</button>';document.body.append(generic);await frame();
    checks[prefix+'generic-fits']=within(generic);generic.scrollTop=generic.scrollHeight;await frame();
    checks[prefix+'generic-scrolls']=generic.scrollTop>0;
    const end=generic.querySelector(':scope > button');checks[prefix+'generic-action-reachable']=within(end)&&hit(end);
    generic.querySelector('.window-menu-tab button').click();await frame();
    const exit=document.createElement('div');exit.className='popup-container';exit.dataset.dungeonExit='north';
    exit.innerHTML='<p>Go north?</p><button class="popup-button">Go</button><button class="popup-button">Cancel</button>';document.body.append(exit);await frame();
    const exitStyle=getComputedStyle(exit),exitRect=rect(exit);
    checks[prefix+'exit-keeps-original-anchor']=exitStyle.position==='absolute'&&exitStyle.transform==='none'&&parseFloat(exitStyle.top)===310&&parseFloat(exitStyle.right)===5;
    checks[prefix+'exit-stays-at-right']=Math.abs(innerWidth-exitRect.right-5*scale)<2;
    checks[prefix+'exit-stays-at-owner-height']=Math.abs(exitRect.top-310*scale)<2;
    if(scale===1&&innerWidth>=1000&&innerHeight>=900)checks[prefix+'exit-between-console-and-log']=exitRect.top>=rect(document.getElementById('phaser-popup')).bottom&&exitRect.bottom<=rect(document.getElementById('game-log-popup')).top;
    exit.querySelector('.window-menu-tab button').click();await frame();
    const anchored=document.createElement('div');anchored.className='popup-container combat-target-actions';anchored.style.cssText='position:fixed;left:20px;top:100px;right:auto;transform:none';
    anchored.innerHTML='<button>Choose target</button>';document.body.append(anchored);await frame();
    checks[prefix+'target-menu-keeps-owner-anchor']=Math.abs(rect(anchored).left-20*scale)<2&&Math.abs(rect(anchored).top-100*scale)<2&&getComputedStyle(anchored).transform==='none';
    anchored.querySelector('.window-menu-tab button').click();await frame();
    checks[prefix+'world-and-panels-unchanged']=equal(core(),before);
  }
  checks.readOnlyFixtureCalls=requests.length===4&&requests.every(p=>p==='/game-saves');
  const summary=document.createElement('output');summary.id='probe-result';summary.textContent=JSON.stringify({pass:Object.values(checks).every(Boolean),failures:Object.entries(checks).filter(([,v])=>!v).map(([k])=>k)});document.body.append(summary);
  await send({pass:Object.values(checks).every(Boolean),checks,details});
  const previews=document.createElement('nav');previews.setAttribute('aria-label','Isolated UI previews');previews.style.cssText='position:fixed;left:8px;top:60px;z-index:20000';
  for(const [label,open] of [['Preview recruitment',()=>CommerceUi.open(names[0])],['Preview saves',()=>HolodekSaveGame.open()]]){
    const button=document.createElement('button');button.textContent=label;button.onclick=()=>{document.body.style.setProperty('--game-ui-scale',1.3125);open();};previews.append(button);
  }
  document.body.append(previews);
}catch(error){await send({pass:false,error:error.stack,checks,details});}});
</script><script src="/assets/commerceUi.js"></script><script src="/assets/saveGameUi.js"></script><script src="/assets/windowUi.js"></script>`;

function fixtureServer(done,fetched=[]){
  return http.createServer((req,res)=>{
    fetched.push(req.url);
    if(req.url==='/finish'&&req.method==='POST'){res.end('Fixture stopped.');res.on('finish',()=>{res.socket?.server?.close();process.exit(0);});return;}
    if(req.url==='/report'){let data='';req.on('data',b=>data+=b);req.on('end',()=>{res.end('ok');done(JSON.parse(data));});return;}
    const url=new URL(req.url,'http://fixture');
    if(url.pathname.startsWith('/assets/')){
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep+'assets'+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
      res.end(fs.readFileSync(file));return;
    }
    res.setHeader('Content-Type','text/html');res.end(html);
  });
}
async function run(width,height){
  let done,child,timer,stderr='';const fetched=[];const answer=new Promise(resolve=>done=resolve);
  const server=fixtureServer(done,fetched);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-dialogs-'));
    child=spawn(process.env.WINDOW_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ['--headless=new','--disable-gpu','--no-first-run',
        '--window-size='+width+','+height,'--user-data-dir='+profile,'http://127.0.0.1:'+server.address().port],{windowsHide:true});
    child.stdout.on('data',()=>{});child.stderr.on('data',data=>stderr=(stderr+data).slice(-2000));
    const result=await Promise.race([answer,new Promise(resolve=>timer=setTimeout(()=>resolve({pass:false,error:'Browser timed out'}),45000)),
      new Promise(resolve=>{child.on('error',e=>resolve({pass:false,error:e.message}));child.on('exit',code=>resolve({pass:false,error:'Browser exited: '+code}));})]);
    return {size:[width,height],...result,...(result.error?{stderr,fetched}:{})};
  }finally{clearTimeout(timer);child?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function main(){
  if(process.argv.includes('--serve')){
    const reports=[];const server=fixtureServer(report=>{
      report.files=Object.fromEntries(['assets/index.html','assets/gameUiFonts.css','assets/gameUiPixels.css','assets/gameUiDialogs.css',
        'assets/commerceUi.js','assets/saveGameUi.js','assets/windowUi.js','tests/run-popup-viewport-probe.cjs'].map(file=>
        [file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
      const viewport=report.details?.[0]?.viewport?.join(',');const old=reports.findIndex(r=>r.details?.[0]?.viewport?.join(',')===viewport);
      if(old>=0)reports[old]=report;else reports.push(report);
      fs.writeFileSync(path.join(root,'.retort-data/popup-viewport/browser-iab.json'),JSON.stringify({pass:reports.every(r=>r.pass),results:reports},null,2));
      console.log(JSON.stringify({pass:report.pass,viewport:report.details?.[0]?.viewport,failures:Object.entries(report.checks||{}).filter(([,v])=>!v).map(([k])=>k),error:report.error}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log('Popup fixture: http://127.0.0.1:'+server.address().port);return;
  }
  const results=[];for(const size of process.argv.includes('--single')?[[1024,700]]:[[1680,950],[1024,700],[540,900],[640,480]])results.push(await run(...size));
  const report={pass:results.every(r=>r.pass),results};
  if(process.argv.includes('--report'))fs.writeFileSync(path.join(root,'.retort-data/popup-viewport/browser.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,results:results.map(r=>({size:r.size,pass:r.pass,error:r.error,stderr:r.stderr,fetched:r.fetched,checks:Object.keys(r.checks||{}).length,
    failures:Object.entries(r.checks||{}).filter(([,v])=>!v).map(([k])=>k)}))},null,2));
  process.exitCode=report.pass?0:1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
