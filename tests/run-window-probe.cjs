'use strict';
// Standalone UI replay: no running game, saves, world generation or model calls.
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), production = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const css = [...production.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const html = '<!doctype html><meta charset="utf-8"><style>' + css + '</style>' + String.raw`
<div id="dungeon-popup" style="display:block"><div id="dungeon-container">World view</div></div>
<div id="combat-popup" style="display:block"><div id="combat-header">Combat Mode<button>X</button></div><div id="combat-container">Map</div></div>
<div id="phaser-popup" style="display:block"><div id="phaser-header">Game Console<button>X</button></div><div id="phaser-container">Console</div></div>
<div id="game-log-popup" style="display:block"><div id="game-log-header">Game Log<button>X</button></div><div id="game-log-container">Log</div></div>
<dialog id="save-game-dialog" aria-label="Save and load adventure" style="width:min(850px,80vw);padding:22px;max-height:70vh;overflow:auto;box-sizing:border-box">
<h2>Your Adventures</h2><div style="height:1600px">Save slots</div></dialog>
<dialog id="graphics-settings" style="width:520px;padding:20px;max-height:70vh;overflow:auto;box-sizing:border-box">
<form method="dialog" style="display:grid;gap:16px"><button class="graphics-close" style="position:absolute;right:0;top:0" aria-label="Close graphics settings">X</button><h2 id="graphics-settings-title">Graphics settings</h2><div style="height:1000px">Graphics controls</div></form></dialog>
<script>
window.onerror=message=>fetch('/report',{method:'POST',body:JSON.stringify({pass:false,error:message})});
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))), checks={};
const ids=['dungeon-popup','phaser-popup','game-log-popup','combat-popup'], cores=ids.slice(1), panel=id=>document.getElementById(id);
const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
const equal=(a,b)=>Object.keys(a).every(k=>Math.abs(a[k]-b[k])<1);
const snapshot=()=>Object.fromEntries(ids.map(id=>[id,rect(panel(id))]));
const flushHeader=node=>{const p=node.getBoundingClientRect(),h=node.querySelector('.window-menu-tab').getBoundingClientRect(),s=getComputedStyle(node),zoom=p.width/node.offsetWidth;
return Math.abs(h.top-p.top-parseFloat(s.borderTopWidth)*zoom)<2&&Math.abs(h.left-p.left-parseFloat(s.borderLeftWidth)*zoom)<2&&Math.abs(h.right-p.left-(node.clientLeft+node.clientWidth)*zoom)<2;};
const resize=(node,edge,dx,dy)=>{const grip=node.querySelector('.window-resize-'+edge);
grip.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:7,bubbles:true,clientX:200,clientY:100}));
document.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,bubbles:true,clientX:200+dx,clientY:100+dy}));
document.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,bubbles:true}));};
document.addEventListener('DOMContentLoaded',async()=>{try{
await frame();const original=snapshot();
for(const src of ['/combatTacticalUi.js','/windowUi.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});WindowUi.init();await frame();
for(const id of ids)checks[id+'-initial-layout-untouched']=equal(rect(panel(id)),original[id]);
checks.worldHasNoWindowHandles=panel('dungeon-popup').querySelectorAll('.window-resize-grip,.window-menu-tab').length===0;
for(const scale of [1,1.75,2.25]){
document.body.style.setProperty('--game-ui-scale',scale);await frame();const before=snapshot();
const content=document.createElement('p');content.textContent='Another log update';panel('game-log-container').append(content);await frame();
for(const id of ids)checks[id+'-content-does-not-reposition-'+scale]=equal(rect(panel(id)),before[id]);
for(const id of cores)for(const edge of ['n','ne','e','se','s','sw','w','nw']){
const node=panel(id),saved=node.style.cssText,others=snapshot();resize(node,edge,-10,-10);await frame();const settled=rect(node);
if(id==='combat-popup'){
const map=panel('combat-container'),zoom=node.getBoundingClientRect().width/node.offsetWidth;
checks['compact-map-fills-height-'+edge+'-'+scale]=Math.abs(map.getBoundingClientRect().height/zoom-(node.clientHeight-40))<2;
checks['compact-map-no-ledger-split-'+edge+'-'+scale]=!node.classList.contains('combat-stacked');
}
await new Promise(r=>setTimeout(r,30));checks[id+'-resize-stable-'+edge+'-'+scale]=equal(rect(node),settled);
for(const other of ids.filter(v=>v!==id))checks[id+'-resize-preserves-'+other+'-'+edge+'-'+scale]=equal(rect(panel(other)),others[other]);
node.style.cssText=saved;await frame();
}
const menu=panel('save-game-dialog');menu.showModal();await frame();menu.scrollTop=0;await frame();
checks['menu-full-width-tab-'+scale]=flushHeader(menu);
menu.scrollTop=500;await frame();checks['menu-scrolled-tab-'+scale]=flushHeader(menu);menu.close();
const graphics=panel('graphics-settings');graphics.showModal();await frame();
checks['graphics-single-title-'+scale]=graphics.querySelectorAll('h2').length===1&&graphics.querySelector('h2').parentNode.classList.contains('window-menu-tab');
checks['graphics-single-close-'+scale]=graphics.querySelectorAll('button').length===1;
checks['graphics-flush-tab-'+scale]=flushHeader(graphics);
graphics.querySelector('.graphics-close').click();checks['graphics-close-works-'+scale]=!graphics.open;
for(const id of ids)checks[id+'-after-menus-'+scale]=equal(rect(panel(id)),before[id]);
}
await fetch('/report',{method:'POST',body:JSON.stringify({pass:Object.values(checks).every(Boolean),checks})});
}catch(e){await fetch('/report',{method:'POST',body:JSON.stringify({pass:false,error:e.stack,checks})});}});
</script>`;
async function main() {
  let done, child, timer; const answer = new Promise(resolve => done = resolve);
  const server = http.createServer((req, res) => {
    if (req.url === '/report') { let data = ''; req.on('data', b => data += b); req.on('end', () => { res.end('ok'); done(JSON.parse(data)); }); }
    else if (req.url === '/windowUi.js' || req.url === '/combatTacticalUi.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'assets', req.url.slice(1)))); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-windows-'));
    child = spawn(process.env.WINDOW_PROBE_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run',
      '--window-size=' + (process.argv.includes('--mobile') ? '540,950' : '1680,950'), '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
    const result = await Promise.race([answer, new Promise(resolve => timer = setTimeout(() => resolve({ pass: false, error: 'Browser timed out' }), 30000)),
      new Promise(resolve => { child.on('error', e => resolve({ pass: false, error: e.message })); child.on('exit', code => resolve({ pass: false, error: 'Browser exited: ' + code })); })]);
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.pass ? 0 : 1;
  } finally { clearTimeout(timer); child?.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
