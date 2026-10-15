'use strict';
// Isolated real browser; no live server, saves, API calls or player history.
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const Voc=require('../retort/sidVoice/voc64'),Score=require('../retort/sidVoice/registerScore'),Archive=require('../retort/sidArchive');
(async()=>{
  const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'sid-voice-live-'));
  const bytes=process.argv[2]?fs.readFileSync(process.argv[2]):Buffer.from(Score.withGain(Voc.compile(require('./fixtures/sid-voice-input.cjs').fixture('10582','2x','lj',500)).registerScore,1.5));
  const info=Score.inspect(bytes),cry=require('../retort/sidVoice/cries').compile({f0:205,fs:1},'pain').score,bundle=Archive.workerBundle(),requests=[];
  let finish,timer;const result=new Promise(resolve=>finish=resolve);
  const script=`<script>
  const errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  var currentDungeon={geoKey:'0,0,0'};window.getDungeonLifeContext=()=>({actors:[{name:'Mortacia',type:'pc',voiceSpec:{v:2,f0:205}}],dungeon:currentDungeon});
  localStorage.setItem('holodekAudioSettings',JSON.stringify({v:4,music:0,sfx:0,amb:0,voice:.8,voiceChip:'10582',sidMode:'2x'}));
  </script><script src="/assets/sidPlayer.js"></script><script>
  const players=[],open=HolodekSidPlayer.open;HolodekSidPlayer.open=async(...args)=>{const p=await open(...args);players.push(p);return p;};
  </script><script src="/assets/sfx.js"></script><script>
  (async()=>{const checks={},sound=HolodekSfx,pause=ms=>new Promise(r=>setTimeout(r,ms)),schedules=[];
    const wait=async(fn)=>{const end=Date.now()+20000;while(!fn()){if(Date.now()>end)throw Error('Timed out');await pause(25);}};
    try{
      const answer=await sound.speakLine('Mortacia','First sentence. Second sentence. Third sentence.',{onSchedule:(ms,more)=>schedules.push({ms,more})});
      const first=players[0];await wait(()=>first.currentTime>.1);
      checks.nativeBank=first.info.kind==='sid-voice'&&first.info.chips===64&&Math.abs(answer.dur-${info.seconds})<.001;
      const analyser=first.context.createAnalyser();first.node.connect(analyser);await pause(100);const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);checks.signal=data.some(x=>Math.abs(x)>.001);first.node.disconnect(analyser);
      const before=first.currentTime,until=performance.now()+650;while(performance.now()<until){}await pause(100);checks.mainThreadIndependent=first.currentTime-before>.65;
      await wait(()=>players.filter(p=>p.info.chips===64).length===3);checks.sentences=true;
      checks.subtitleScheduling=schedules.length>=3&&schedules.some(s=>s.more)&&schedules.at(-1).more===false;
      checks.boundedQueue=players.every(p=>(p.pending||0)+(p.queued||0)<=12);
      sound.stopSpeech();await pause(150);checks.stopped=players.every(p=>p.disposed);
      let wanted=true;const late=sound.speakLine('Mortacia','Delayed sentence.',{stillWanted:()=>wanted});wanted=false;
      checks.stale=await late.then(()=>false,error=>error.message==='stale');
      await sound.voiceSound('Mortacia','pain');await wait(()=>players.some(p=>p.info.chips===3&&p.currentTime>.05));checks.cry=players.at(-1).info.chips===3;
      checks.noErrors=errors.length===0;await fetch('/report',{method:'POST',body:JSON.stringify({pass:Object.values(checks).every(Boolean),checks,errors})});
    }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({pass:false,checks,errors,error:error.stack})});}
  })();</script>`;
  const server=http.createServer((req,res)=>{
    requests.push(req.url);const u=new URL(req.url,'http://localhost'),json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
    if(u.pathname==='/report'){let body='';req.on('data',x=>body+=x);req.on('end',()=>{finish(JSON.parse(body));res.end('ok');});return;}
    if(u.pathname==='/')return res.end('<!doctype html><div id="chatlog"></div>'+script);
    if(['/voice/line.sidvoice','/voice/cry.sidvoice'].includes(u.pathname)){let body='';req.on('data',x=>body+=x);req.on('end',()=>{
      const voice=u.pathname.includes('cry.')?cry:bytes;res.setHeader('X-Voice-Dur',String(Score.inspect(voice).seconds));res.setHeader('Content-Type','application/x-holodek-sid-voice');res.end(voice);});return;}
    if(u.pathname==='/music/sid-worker.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle);}
    if(['/sid-mode','/voice/chip','/voice/profiles'].includes(u.pathname))return json({ok:true});
    if(u.pathname==='/music/latest')return json({});if(u.pathname==='/get-room-music')return json({music:null});
    if(u.pathname.startsWith('/assets/')){const file=path.resolve(root,'.'+u.pathname);if(file.startsWith(root+path.sep)&&fs.existsSync(file)){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(file));}}
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--autoplay-policy=no-user-gesture-required','--user-data-dir='+path.join(profile,'browser'),'http://127.0.0.1:'+server.address().port],{windowsHide:true});
  let stderr='';browser.stderr.on('data',x=>stderr+=x);const stopped=new Promise(resolve=>{browser.once('error',error=>resolve({pass:false,error:error.message}));browser.once('exit',()=>resolve({pass:false,error:'Browser exited',stderr:stderr.slice(-1500)}));});
  const timeout=new Promise(resolve=>timer=setTimeout(()=>resolve({pass:false,error:'Browser timeout',stderr:stderr.slice(-1500)}),60000));
  const answer=await Promise.race([result,stopped,timeout]);answer.noVoiceWavRequests=!requests.some(u=>/\/voice\/.*\.wav/.test(u));answer.pass=answer.pass&&answer.noVoiceWavRequests;
  clearTimeout(timer);browser.kill();server.closeAllConnections();server.close();console.log(JSON.stringify(answer,null,2));process.exitCode=answer.pass?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
