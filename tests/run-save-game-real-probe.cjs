'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), express = require('express');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), p = require('../saveGames').createStore().read(process.argv[2] || 1).payload;
const traits = require('../saveGameAssets').characterTraits(p);
const loaded = { loaded: true, browser: p.browser, runId: p.runId, roomKey: p.roomKey, dungeon: p.server.roomDungeonDatabase[p.roomKey],
  updatedGameConsole: p.server.updatedGameConsole, roomNameDatabaseString: p.server.roomNameDatabaseString, combatCharactersString: p.server.combatCharactersString,
  characterTraits: traits, population: p.server.roomPopulations[p.roomKey], audio: null };
const setup = `<script>
window.probeErrors=[];window.addEventListener('error',e=>window.probeErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.probeErrors.push(String(e.reason)));
window.EventSource=class {constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'dungeonRun',runId:${JSON.stringify(p.runId)}})}),500)}close(){}};
window.$={ajax(){return {abort(){}}}};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,opts={})=>{const u=String(url);
 if(u.startsWith('/assets/')||u.startsWith('/node_modules/')||u.startsWith('/sid/')||u.startsWith('/probe/'))return nativeFetch(url,opts);
 if(u==='/game/pause')return Response.json({runId:${JSON.stringify(p.runId)},paused:JSON.parse(opts.body).paused});
 if(u==='/game-saves/1/load')return nativeFetch('/probe/checkpoint');
 if(u==='/get-room-music'||u.startsWith('/get-room-music?'))return Response.json({runId:${JSON.stringify(p.runId)},music:null});
 if(u.startsWith('/get-room-dungeon?'))return Response.json({dungeon:null});
 if(u.startsWith('/music/latest'))return Response.json({url:null});
 return Response.json({ok:true,traits:{},records:[],dialogue:[],mode:'2x',chip:'10582'});
};
</script>`;
const exercise = `<script>document.addEventListener('DOMContentLoaded',async()=>{
 const checks={};
 try{
  for(let n=0;n<100&&(!window.combatGame?.scene.getScene('CombatScene')||typeof db==='undefined'||!db);n++)await new Promise(r=>setTimeout(r,50));
  const checkpoint=await (await nativeFetch('/probe/checkpoint')).json();
  await window.HolodekSaveGame.restoreBrowser(checkpoint);
  await new Promise(r=>setTimeout(r,700));
  const ctx=window.getDungeonLifeContext(),log=document.getElementById('game-log-container');
  checks.room=ctx.dungeon.geoKey===${JSON.stringify(p.roomKey)};
  checks.camera=Math.abs(ctx.player.x-${p.browser.position.x})<.001&&Math.abs(ctx.player.y-${p.browser.position.y})<.001;
  checks.console=document.getElementById('game-popup')?.textContent.includes(${JSON.stringify(p.roomName)});
  checks.pcSource=window._partyInfoPCString?.includes('HP:');checks.npcSource=window._partyInfoNPCString?.includes('HP:');
  checks.hpLabels=[...document.querySelectorAll('.party-icon-hp')].every(e=>!e.textContent.includes('--'));
  checks.log=!!log?.textContent.includes('You take verdant graveplate.');
  checks.paragraphs=document.getElementById('chatlog').textContent.split('\\n').length>50;
  checks.spellData=!!window.latestUpdatedData.pc;
  checks.paused=window.gamePaused;
 }catch(e){window.probeErrors.push(e.stack)}
 await nativeFetch('/probe/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:Object.values(checks).every(Boolean)&&!window.probeErrors.length,checks,errors:window.probeErrors})});
});</script>`;
(async () => {
  let receive, timer; const reported = new Promise(resolve => { receive = resolve; });
  const app = express(); app.use(express.json({ limit: '1mb' }));
  app.get('/probe/checkpoint', (req, res) => res.json(loaded));
  app.post('/probe/report', (req, res) => { receive(req.body); res.end('ok'); });
  app.use('/assets', express.static(path.join(root, 'assets'))); app.use('/node_modules', express.static(path.join(root, 'node_modules'))); app.use('/sid', express.static(path.join(root, 'sid')));
  app.get('/', (req, res) => res.type('html').send(fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8')
    .replace(/<script src="https:\/\/ajax.googleapis.com[^>]+><\/script>/, '').replace('<head>', '<head>' + setup).replace('</body>', exercise + '</body>')));
  app.use((req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-save-real-'));
  const child = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--window-size=1680,950', '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
  let stderr = ''; child.stdout.on('data', () => {}); child.stderr.on('data', data => { stderr += data; });
  const stopped = new Promise(resolve => { child.once('error', e => resolve({ pass: false, error: e.message })); child.once('close', () => resolve({ pass: false, error: 'Browser exited.', stderr: stderr.slice(-1000) })); });
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve({ pass: false, error: 'Timed out.', stderr: stderr.slice(-1000) }), 60000); });
  const report = await Promise.race([reported, stopped, expired]); clearTimeout(timer); child.kill(); server.closeAllConnections(); server.close();
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
})();
