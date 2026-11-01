'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const os=require('node:os'),http=require('node:http'),{once}=require('node:events');
const {EventEmitter}=require('node:events');
const Launcher=require('../tools/runtime/start-game.cjs'),root=path.resolve(__dirname,'..');
const row=(status='online',pid=101)=>({name:'gameServer',pid,pm2_env:{status,pm_cwd:root,pm_exec_path:path.join(root,'server.js'),stop_exit_codes:[0,73],PORT:'3000'}});
const view=(pid=101,windows=0)=>({pid,port:3000,running:true,connectedWindows:windows,processOwnership:'windows-job'});

test('the double-click launcher reuses a healthy game instead of restarting an open adventure',async()=>{
  const calls=[],opened=[];
  const result=await Launcher.startGame({runPm:args=>{calls.push(args);return[row()];},getHealth:async()=>view(101,1),openWindow:async url=>opened.push(url)});
  assert.equal(result.reused,true);assert.equal(calls.length,1);assert.deepEqual(opened,['http://localhost:3000/assets/index.html']);
});
test('reopening within refresh grace preserves the contained adventure',async()=>{
  const calls=[];
  await Launcher.startGame({runPm:args=>{calls.push(args);return[row()];},getHealth:async()=>view(),openWindow:async()=>{}});
  assert.equal(calls.length,1);
});
test('a stopped game starts with the ecosystem stop codes, targets only gameServer, and waits for readiness',async()=>{
  const calls=[],opened=[];let started=false,checks=0;
  const other={name:'gameServer2',pid:202,pm2_env:{status:'online'}};
  const result=await Launcher.startGame({runPm:args=>{calls.push(args);
    if(args[0]==='startOrReload'){started=true;return '';}
    return[row(started?'online':'stopped',started?303:0),other];},
    getHealth:async()=>started&&checks++?view(303):null,openWindow:async url=>opened.push(url),delay:async()=>{}});
  assert.equal(result.pid,303);assert.equal(result.reused,false);assert.equal(opened.length,1);
  assert.deepEqual(opened,['http://localhost:3000/assets/index.html']);
  assert.deepEqual(calls.find(c=>c[0]==='startOrReload'),['startOrReload',path.join(root,'ecosystem.config.cjs'),'--only','gameServer','--update-env']);
  assert.equal(other.pid,202);assert.ok(!calls.flat().includes('gameServer2'));
});
test('a legacy idle server gets the current cleanup configuration without player commands',async()=>{
  let started=false;
  await Launcher.startGame({runPm:args=>{if(args[0]==='startOrReload'){started=true;return '';}
    return[row('online',started?303:101)];},getHealth:async()=>started?view(303):{...view(),processOwnership:undefined},openWindow:async()=>{}});
  assert.equal(started,true);
});
test('unknown ownership, an unresponsive adventure and occupied ports cannot be killed or restarted',async()=>{
  for(const [entries,health]of [[[{...row(),pm2_env:{...row().pm2_env,pm_cwd:path.dirname(root)}}],view()],
    [[row()],null], [[],view(999)], [[row(),row()],view()]]){
    const calls=[];await assert.rejects(Launcher.startGame({runPm:args=>{calls.push(args);return entries;},getHealth:async()=>health,openWindow:async()=>assert.fail('Must not open')}));
    assert.equal(calls.length,1);assert.equal(calls[0][0],'jlist');
  }
});
test('PM2 startup banners are tolerated and the launcher is hidden rather than a PowerShell task',()=>{
  assert.deepEqual(Launcher.rows('[PM2] Daemon started\n[]\n'),[]);
  const script=fs.readFileSync(path.join(root,'Start Holodek.vbs'),'utf8');
  assert.match(script,/shell\.Run\(command, 0, True\)/);assert.match(script,/start-game\.cjs/);
  assert.doesNotMatch(script,/powershell|Stop-Process|taskkill/i);
});

test('the game opens in a new Chrome Incognito window at its actual HTML entry point, without waiting for Chrome to exit',async()=>{
  const child=new EventEmitter(),calls=[];let unreferenced=false;
  child.unref=()=>{unreferenced=true;};
  await Launcher.openIncognito(Launcher.GAME_URL,{env:{PROGRAMFILES:'C:/Program Files'},exists:()=>true,
    spawnProcess:(file,args,options)=>{calls.push({file,args,options});queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.deepEqual(calls,[{file:path.join('C:/Program Files','Google/Chrome/Application/chrome.exe'),
    args:['--incognito','--new-window','http://localhost:3000/assets/index.html'],
    options:{windowsHide:true,detached:true,stdio:'ignore'}}]);
  assert.equal(unreferenced,true);assert.equal(child.listenerCount('exit'),0);
});

test('Chrome discovery supports explicit and per-user installs without a normal-browser fallback',async()=>{
  const custom=path.resolve('custom-chrome.exe'),local=path.resolve('local-app-data');
  assert.equal(Launcher.chromePath({env:{CHROME:custom},exists:()=>true}),custom);
  assert.equal(Launcher.chromePath({env:{PROGRAMFILES:path.resolve('missing'),LOCALAPPDATA:local},
    exists:file=>file.startsWith(local)}),path.join(local,'Google/Chrome/Application/chrome.exe'));
  await assert.rejects(Launcher.openIncognito(Launcher.GAME_URL,{env:{},exists:()=>false,
    spawnProcess:()=>assert.fail('Must not open')}),/No regular browser window/);
  await assert.rejects(Launcher.openIncognito('http://localhost:3000'),/only opens/);
});

test('Chrome launch failures are reported instead of silently opening a non-private window',async()=>{
  const child=new EventEmitter();child.unref=()=>assert.fail('Must not detach failed launch');
  await assert.rejects(Launcher.openIncognito(Launcher.GAME_URL,{env:{CHROME:path.resolve('chrome.exe')},exists:()=>true,
    spawnProcess:()=>{queueMicrotask(()=>child.emit('error',Error('Chrome launch denied')));return child;}}),/Chrome launch denied/);
});

test('a zero-PID stale PM2 entry is stopped before the verified leftover quits and the replacement starts',async()=>{
  const calls=[];let stopped=false,closed=false,started=false;
  const other={name:'gameServer2',pid:202,pm2_env:{status:'stopped'}};
  const result=await Launcher.startGame({runPm:args=>{
    calls.push(args);
    if(args[0]==='stop'){assert.deepEqual(args,['stop','gameServer']);stopped=true;return '';}
    if(args[0]==='startOrReload'){assert.equal(closed,true);started=true;return '';}
    return[row(started?'online':stopped?'stopped':'online',started?303:0),other];
  },getHealth:async()=>started?view(303):{...view(101),canQuit:true},
  closeLeftover:async options=>{assert.equal(options.view.pid,101);await options.beforeQuit();assert.equal(stopped,true);closed=true;},
  openWindow:async()=>{assert.equal(started,true);}});
  assert.equal(result.pid,303);assert.ok(!calls.flat().includes('gameServer2'));assert.equal(other.pid,202);
});

test('changed PM2 ownership aborts leftover recovery without stopping or starting anything',async()=>{
  const calls=[];
  await assert.rejects(Launcher.startGame({runPm:args=>{calls.push(args);return[row('online',calls.length===1?0:202)];},
    getHealth:async()=>({...view(),canQuit:true}),closeLeftover:options=>options.beforeQuit(),
    openWindow:async()=>assert.fail('Must not open')}),/ownership changed/);
  assert.ok(calls.every(args=>args[0]==='jlist'));
});

async function leftover(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-launch-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let closed=false,stops=0,requests=[],streamClosed=false;
  const response={...view(),canQuit:true};
  const server=http.createServer((req,res)=>{
    requests.push(req.url);
    if(req.url.startsWith('/assets/debug/')){
      const file=path.join(directory,'assets/debug',path.basename(req.url));
      res.end(options.badProof?'unrelated listener':fs.readFileSync(file));return;
    }
    if(req.url==='/combat-updates2'){
      res.setHeader('Content-Type','text/event-stream');
      res.write('data: connected\n\ndata: '+JSON.stringify({type:'dungeonRun',runId:'test-run'})+'\n\n');
      res.on('close',()=>{streamClosed=true;});return;
    }
    if(req.url==='/game/quit'){
      assert.equal(stops,1);let body='';req.on('data',chunk=>body+=chunk);
      req.on('end',()=>{
        assert.deepEqual(JSON.parse(body),{runId:'test-run',confirm:true,expectedPid:101,requireNoWindows:true});
        res.setHeader('Content-Type','application/json');
        if(options.busy){res.statusCode=409;res.end(JSON.stringify({error:'Finish the current command before quitting.'}));}
        else{closed=true;res.end(JSON.stringify({quitting:true}));}
      });return;
    }
    res.statusCode=404;res.end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const config={root:directory,url:'http://127.0.0.1:'+server.address().port,view:response,
    getHealth:async()=>closed?null:response,beforeQuit:async()=>{stops++;}};
  return{config,response,requests,stops:()=>stops,closed:()=>closed,streamClosed:()=>streamClosed,
    proofs:()=>fs.existsSync(path.join(directory,'assets/debug'))?fs.readdirSync(path.join(directory,'assets/debug')):[]};
}

test('a real leftover listener proves project ownership and quits through the current adventure, not an OS kill',async t=>{
  const f=await leftover(t);await Launcher.quitIdleGame(f.config);
  assert.equal(f.closed(),true);assert.equal(f.stops(),1);assert.deepEqual(f.proofs(),[]);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.streamClosed(),true);
});

test('a different listener cannot trigger PM2 stop or Quit and the ownership proof is removed',async t=>{
  const f=await leftover(t,{badProof:true});await assert.rejects(Launcher.quitIdleGame(f.config),/prove/);
  assert.equal(f.closed(),false);assert.equal(f.stops(),0);assert.equal(f.requests.length,1);assert.deepEqual(f.proofs(),[]);
});

test('open windows, refused local Quit and invalid process identities block leftover recovery before any network work',async t=>{
  const f=await leftover(t);
  for(const change of [{connectedWindows:1},{canQuit:false},{pid:0},{pid:-1}]){
    await assert.rejects(Launcher.quitIdleGame({...f.config,view:{...f.response,...change}}),/safely/);
  }
  assert.equal(f.requests.length,0);assert.equal(f.stops(),0);
});

test('a changed server or newly opened window during ownership checks is not closed',async t=>{
  const f=await leftover(t);
  for(const change of [{connectedWindows:1},{pid:202}]){
    await assert.rejects(Launcher.quitIdleGame({...f.config,getHealth:async()=>({...f.response,...change})}),/changed/);
  }
  assert.equal(f.closed(),false);assert.equal(f.stops(),0);assert.ok(!f.requests.includes('/game/quit'));assert.deepEqual(f.proofs(),[]);
});

test('window changes after PM2 scheduling stops are rechecked before Quit',async t=>{
  const f=await leftover(t);let checks=0;
  await assert.rejects(Launcher.quitIdleGame({...f.config,getHealth:async()=>({...f.response,connectedWindows:checks++?1:0})}),/changed/);
  assert.equal(f.stops(),1);assert.equal(f.closed(),false);assert.ok(!f.requests.includes('/game/quit'));
});

test('a busy game refuses recovery without a forced process stop',async t=>{
  const f=await leftover(t,{busy:true});await assert.rejects(Launcher.quitIdleGame(f.config),/Finish/);
  assert.equal(f.closed(),false);assert.deepEqual(f.proofs(),[]);
});

test('the adventure stream must identify a run and is bounded rather than read indefinitely',async()=>{
  for(const body of ['data: not a run\n\n','data: '+JSON.stringify({type:'dungeonRun',runId:''})+'\n\n','x'.repeat(262145)]){
    await assert.rejects(Launcher.runIdFromStream(new Response(body,{headers:{'Content-Type':'text/event-stream'}})),/identify/);
  }
  await assert.rejects(Launcher.runIdFromStream(new Response('not Holodek')),/identify/);
});
