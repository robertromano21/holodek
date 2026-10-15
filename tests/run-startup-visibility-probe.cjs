'use strict';
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), index = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const css = [...index.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const toggle = index.slice(index.indexOf('function toggleDungeonPopup()'), index.indexOf('function toggleGameLogPopup()'));
const fullscreen = index.slice(index.indexOf('function setDungeonFullscreenUiState('), index.indexOf('function getCombatRosterForUi('));
const popup = index.slice(index.indexOf('<div id="dungeon-popup">'), index.indexOf('<div id="divchatbot">'));
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${popup}
<div id="chatlog-background-panel"><h1 id="opening">Children of the Grave</h1></div>
<script>window.currentDungeon=null;window.dungeonTextures={};${toggle}\n${fullscreen}</script>
<script src="/assets/rendererWebGL.js"></script><script>
(async()=>{const checks={};try{
 for(let i=0;i<12;i++){webglDungeonRenderer.renderScene();await new Promise(r=>setTimeout(r,10));}
 const popup=document.getElementById('dungeon-popup'),opening=document.getElementById('chatlog-background-panel');
 checks.noEmptyViewport=getComputedStyle(popup).display==='none';
 checks.noStrayCloseButton=document.getElementById('dungeon-header').offsetParent===null;
 checks.openingVisible=getComputedStyle(opening).display!=='none'&&!document.body.classList.contains('dungeon-fullscreen-active');
 toggleDungeonPopup();checks.noPrematureToggle=getComputedStyle(popup).display==='none';
 window.currentDungeon={cells:{}};webglDungeonRenderer.init=()=>false;webglDungeonRenderer.renderScene();
 checks.roomOpens=getComputedStyle(popup).display==='block'&&getComputedStyle(opening).display==='none';
 closeDungeonPopup();checks.closeRestoresOpening=getComputedStyle(opening).display!=='none';
 await fetch('/report',{method:'POST',body:JSON.stringify({pass:Object.values(checks).every(Boolean),checks})});
}catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({pass:false,checks,error:error.stack})});}})();
</script></body></html>`;
(async () => {
  let report, timer; const result = new Promise(resolve => { report = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report') { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { report(JSON.parse(body)); res.end('ok'); }); return; }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
    if (req.url === '/assets/rendererWebGL.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-startup-ui-'));
  const child = spawn(process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=' + (process.argv[2] || '1280,900'),
      '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
  let stderr = ''; child.stdout.on('data', () => {}); child.stderr.on('data', data => stderr += data);
  const stopped = new Promise(resolve => { child.once('error', error => resolve({ pass: false, error: error.message }));
    child.once('close', () => resolve({ pass: false, error: 'Browser exited before reporting.', stderr: stderr.slice(-1000) })); });
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ pass: false, error: 'Timed out.', stderr: stderr.slice(-1000) }), 20000); });
  const answer = await Promise.race([result, stopped, timeout]); clearTimeout(timer); child.kill(); server.closeAllConnections(); server.close();
  console.log(JSON.stringify(answer, null, 2)); process.exitCode = answer.pass ? 0 : 1;
})();
