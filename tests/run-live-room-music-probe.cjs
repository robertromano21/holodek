'use strict';
// Isolated real-browser integration test. Never loads server.js or a player's save.
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const Archive=require('../retort/sidArchive'),Theory=require('../retort/sidMusicTheory'),Composition=require('../retort/sidComposition');
(async()=>{
  const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'live-room-sid-'));
  const song=Theory.arrangeSuite(Composition.develop(require('./fixtures/sid-leaving-threshold.json')),'temple','live-browser');
  song.voices.forEach(v=>v.order=v.order.slice(0,7));
  const archived=Archive.record(song,{clock:'2x'},path.join(profile,'archive')),bundle=Archive.workerBundle();
  const descriptor=coords=>({format:'sid',sid:'/music-archive/test/8580.sid',url:'/music-archive/test/8580.sid',
    variants:{'8580':'/music-archive/test/8580.sid','10582':'/music-archive/test/10582.sid'},seconds:archived.manifest.seconds,coords,runId:'probe-run'});
  let report,timer;const result=new Promise(resolve=>report=resolve),requests=[];
  const script=`<script>
  const errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  var currentDungeon={geoKey:'0,0,0',description:''};window.getDungeonLifeContext=()=>({actors:[],dungeon:currentDungeon});
  localStorage.setItem('holodekAudioSettings',JSON.stringify({v:4,music:.2,sfx:0,amb:0,voice:0,sidMode:'2x',compositionChip:'8580'}));
  </script><script src="/assets/sidPlayer.js"></script><script>
  const players=[],open=HolodekSidPlayer.open;HolodekSidPlayer.open=async(...args)=>{const p=await open(...args);players.push(p);return p;};
  </script><script src="/assets/sfx.js"></script><script>
  (async()=>{const checks={},sound=HolodekSfx,pause=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async(fn)=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+JSON.stringify(sound.state())+' / '+document.querySelector('.hx-palette')?.textContent);await pause(30);}};
    try{
      await pause(250);checks.waitsForRoom=players.length===0;
      sound.roomShown('0,0,0');await wait(()=>sound.state().active==='sid-room-music'&&sound.checkpoint().time>.15);
      checks.nativePlayback=sound.state().playingUrl.includes('8580.sid')&&players[0].pending+players[0].queued<=12;
      const analyser=players[0].context.createAnalyser();players[0].node.connect(analyser);await pause(200);
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);checks.audioSignal=samples.some(x=>Math.abs(x)>.001);players[0].node.disconnect(analyser);
      const beforeBlock=sound.checkpoint().time,until=performance.now()+900;while(performance.now()<until){}await pause(150);
      checks.mainThreadIndependent=sound.checkpoint().time-beforeBlock>.9;
      sound.musicPause();await pause(100);const saved=sound.checkpoint();await pause(150);checks.pause=sound.checkpoint().time===saved.time;
      const select=document.querySelector('[data-k=compositionChip]');select.value='10582';select.dispatchEvent(new Event('change'));
      await wait(()=>sound.state().playingUrl.includes('10582.sid')&&!sound.state().crossfading);
      checks.chipSwitchPaused=!!(sound.checkpoint().paused&&Math.abs(sound.checkpoint().time-saved.time)<.02&&players.at(-1).info.extension);
      sound.musicPlay();await wait(()=>sound.checkpoint().time>saved.time+.1);
      const before=sound.checkpoint().time;sound.fastForward();await wait(()=>!players.at(-1).seeking&&sound.checkpoint().time>before+9);
      checks.seek=true;
      const oldUrl=sound.state().playingUrl;currentDungeon={geoKey:'1,0,0',description:''};
      sound.onServerEvent({...${JSON.stringify(descriptor('1,0,0'))},type:'roomMusicUpdated',isNew:true,sid:'/music-archive/next/8580.sid',variants:{'8580':'/music-archive/next/8580.sid','10582':'/music-archive/next/10582.sid'}});
      await pause(100);checks.keepsOldUntilShown=sound.state().playingUrl===oldUrl;
      sound.roomShown('1,0,0');await wait(()=>sound.state().playingUrl.includes('/next/')&&!sound.state().crossfading);
      checks.crossfade=players.slice(0,-1).every(p=>p.disposed)&&!players.at(-1).disposed;
      sound.musicPause();const restore={time:5,paused:true};await sound.restoreCheckpoint(restore,sound.settings,${JSON.stringify(descriptor('0,0,0'))},'0,0,0','probe-run');
      currentDungeon={geoKey:'0,0,0',description:''};await wait(()=>!sound.state().crossfading&&Math.abs(sound.checkpoint().time-5)<.01);
      checks.restore=sound.checkpoint().paused&&sound.state().playingUrl.includes('10582.sid');
      checks.noMusicMedia=[...document.querySelectorAll('audio')].every(a=>!a.getAttribute('src'));checks.noErrors=errors.length===0;
      await fetch('/report',{method:'POST',body:JSON.stringify({pass:Object.values(checks).every(Boolean),checks,errors})});
    }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({pass:false,checks,errors,error:error.stack})});}
  })();</script>`;
  const server=http.createServer((req,res)=>{
    requests.push(req.url);const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/report'){let body='';req.on('data',x=>body+=x);req.on('end',()=>{report(JSON.parse(body));res.end('ok');});return;}
    const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if(u.pathname==='/')return res.end('<!doctype html><div id="chatlog"></div><div id="dungeon-dialogue-words"></div><div id="dungeon-dialogue-caption"></div>'+script);
    if(u.pathname==='/music/latest')return json(descriptor('0,0,0'));
    if(u.pathname==='/get-room-music')return json({music:song,runId:'probe-run'});
    if(u.pathname==='/music/sid-worker.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle);}
    if(u.pathname==='/music/palette'){let b='';req.on('data',x=>b+=x);req.on('end',()=>json(descriptor(JSON.parse(b).coords)));return;}
    if(['/sid-mode','/voice/chip','/voice/profiles','/music/now-playing'].includes(u.pathname))return json({ok:true});
    if(/^\/music-archive\/(test|next)\/(8580|10582)\.sid$/.test(u.pathname))return res.end(fs.readFileSync(path.join(archived.directory,path.basename(u.pathname))));
    if(u.pathname.startsWith('/assets/')){
      const file=path.resolve(root,'.'+u.pathname);if(file.startsWith(root+path.sep)&&fs.existsSync(file)){if(file.endsWith('.js'))res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(file));}
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-first-run','--autoplay-policy=no-user-gesture-required','--user-data-dir='+path.join(profile,'browser'),'http://127.0.0.1:'+server.address().port],{windowsHide:true});
  let stderr='';browser.stderr.on('data',x=>stderr+=x);
  const stopped=new Promise(resolve=>{browser.once('error',error=>resolve({pass:false,error:error.message}));browser.once('exit',()=>resolve({pass:false,error:'Browser exited',stderr:stderr.slice(-1500)}));});
  const timeout=new Promise(resolve=>timer=setTimeout(()=>resolve({pass:false,error:'Browser timeout',stderr:stderr.slice(-1500)}),60000));
  const answer=await Promise.race([result,stopped,timeout]);answer.noRoomWavRequests=!requests.some(u=>/room.*\.wav|\/sid\/.*\.wav|\/music-archive\/.*\.wav/.test(u));
  answer.pass=answer.pass&&answer.noRoomWavRequests;clearTimeout(timer);browser.kill();server.closeAllConnections();server.close();
  console.log(JSON.stringify(answer,null,2));process.exitCode=answer.pass?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
