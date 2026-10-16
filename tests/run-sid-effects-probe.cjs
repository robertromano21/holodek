'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process');
const Archive=require('../retort/sidArchive'),Effects=require('../retort/sidEffectsLive'),Voc=require('../retort/sidVoice/voc64'),{page}=require('../tools/audition-sid-voices.cjs');
(async()=>{
  const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'sid-all-audio-')),requests=[],bundle=Archive.workerBundle();
  const voice=Voc.compile(require('./fixtures/sid-voice-input.cjs').fixture('10582','2x','lj',500)).registerScore;
  let finish,timer;const result=new Promise(resolve=>finish=resolve);
  const reportScript=`const checks={},errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async fn=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('Timed out');await sleep(25);}};`;
  const effects=`<script>var currentDungeon={geoKey:'0,0,0'};window.getDungeonLifeContext=()=>({actors:[],dungeon:currentDungeon});localStorage.setItem('holodekAudioSettings',JSON.stringify({v:4,music:0,sfx:.8,amb:.1,voice:.85,compositionChip:'10582',sidMode:'2x'}));</script><script src="/assets/sidPlayer.js"></script><script>const players=[],original=HolodekSidPlayer.open;HolodekSidPlayer.open=async(...args)=>{const p=await original(...args);players.push(p);return p;};</script><script src="/assets/sfx.js"></script><script>(async()=>{${reportScript}
  try{const sound=HolodekSfx;await wait(()=>sound.songKeyNow());
    document.dispatchEvent(new Event('pointerdown'));await wait(()=>sound.state().effectCache?.entries===20);
    await sound.play('door',{rate:1.2,delay:.1});checks.cachedSidEffect=sound.effectsLog().some(e=>e.name==='door'&&e.transport==='cached-sid-frames');
    checks.rate=Math.abs(sound.effectsLog().find(e=>e.name==='door').rate-1.2)<.001;
    const builds=sound.state().effectCache.builds;
    for(let i=0;i<6;i++){await sound.play(i%2?'step2':'step1');await sleep(180);}
    const steps=sound.effectsLog().filter(e=>/^step/.test(e.name));checks.footstepsImmediate=steps.length===6&&steps.every(e=>e.transport==='cached-sid-frames'&&e.waitMs<40);
    checks.noFootstepRebuilds=sound.state().effectCache.builds===builds;
    checks.boundedEffectCache=sound.state().effectCache.bytes<=12*1024*1024;
    await sound.setAmbience([{tag:'chant',level:.5},{tag:'drips',level:.5},{tag:'howls',level:.4}],'0,0,0');
    await wait(()=>sound.ambLayersInfo().some(l=>l.keyed==='drone'));checks.keyed=sound.ambLayersInfo().filter(l=>l.keyed).length===3;
    await wait(()=>players.some(p=>p.info.kind==='sid-ambience'&&!p.disposed));const drone=players.filter(p=>p.info.kind==='sid-ambience'&&!p.disposed).at(-1);
    const analyser=drone.context.createAnalyser();drone.node.connect(analyser);await sleep(350);const signal=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(signal);checks.signal=signal.some(x=>Math.abs(x)>.0001);drone.node.disconnect(analyser);
    await wait(()=>players.filter(p=>p.info.kind==='sid-effect').length>=2);checks.scheduledNotes=true;
    const now=drone.context.currentTime;drone.playbackRate.cancelScheduledValues(now);drone.playbackRate.setValueAtTime(1,now);drone.playbackRate.linearRampToValueAtTime(1.3,now+.2);await sleep(300);checks.rateAutomation=Math.abs(drone.playbackRate.value-1.3)<.001;
    await drone.seek(drone.duration-.05);await sleep(300);checks.loop=!drone.disposed&&drone.currentTime<1;
    sound.settings.amb=0;sound.applyVolumes();checks.separateVolume=sound.state().ambGain===0&&Math.abs(sound.state().sfxGain-.8)<.00001;
    checks.noErrors=errors.length===0;await fetch('/report',{method:'POST',body:JSON.stringify({phase:'effects',pass:Object.values(checks).every(Boolean),checks,footstepWaitMs:steps.map(e=>e.waitMs),errors})});
  }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({phase:'effects',pass:false,checks,errors,error:error.stack})});}})();</script>`;
  const audition=page({text:'Register test.',characters:[{name:'Mortacia',guide:'lj',profile:{f0:205,fs:1},variants:{detail:{file:'comparison.wav',liveFile:'probe.sidvoice'}}}]});
  const auditionTest=`<script>(async()=>{${reportScript}const players=[],open=HolodekSidPlayer.open;HolodekSidPlayer.open=async(...a)=>{const p=await open(...a);players.push(p);return p;};try{
    document.querySelector('[data-sid-play]').click();await wait(()=>players[0]?.currentTime>.1);checks.live=players[0].info.chips===64;
    document.querySelector('[data-sid-pause]').click();await sleep(100);const t=players[0].currentTime;await sleep(100);checks.pause=players[0].currentTime===t;
    document.querySelector('[data-sid-play]').click();await wait(()=>players[0].currentTime>t+.1);checks.resume=true;
    document.querySelector('[data-sid-stop]').click();checks.stop=players[0].disposed;checks.noErrors=errors.length===0;
    await fetch('/report',{method:'POST',body:JSON.stringify({phase:'audition',pass:Object.values(checks).every(Boolean),checks,errors})});
  }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({phase:'audition',pass:false,checks,errors,error:error.stack})});}})();</script>`;
  const reports=[];const server=http.createServer((req,res)=>{
    requests.push(req.url);const u=new URL(req.url,'http://localhost'),json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
    if(u.pathname==='/report'){let body='';req.on('data',x=>body+=x);req.on('end',()=>{reports.push(JSON.parse(body));res.end('ok');finish(reports.at(-1));});return;}
    if(u.pathname==='/effects')return res.end('<!doctype html><div id="chatlog"></div>'+effects);
    if(u.pathname==='/auditions')return res.end(audition.replace('</html>',auditionTest+'</html>'));
    if(u.pathname==='/probe.sidvoice')return res.end(Buffer.from(voice));
    const name=u.pathname.match(/^\/audio\/registers\/([a-zA-Z0-9_]+)\.sidregs$/)?.[1];
    if(name){try{const item=Effects.compile(name,{chip:u.searchParams.get('chip'),clock:u.searchParams.get('clock')});res.setHeader('X-SID-Duration',String(item.duration));res.setHeader('X-SID-Loop',String(item.loop));return res.end(Buffer.from(item.bytes));}catch(e){res.writeHead(400);return res.end(e.message);}}
    if(u.pathname==='/music/sid-worker.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle);}
    if(['/sid-mode','/voice/chip','/voice/profiles'].includes(u.pathname))return json({ok:true});
    if(u.pathname==='/music/latest')return json({});if(u.pathname==='/get-room-music')return json({music:{title:'Keyed probe',key:'D',scale:'minor',plan:{seconds:100,bars:20}},runId:'probe'});
    if(u.pathname.startsWith('/assets/')){const file=path.resolve(root,'.'+u.pathname);if(file.startsWith(root+path.sep)&&fs.existsSync(file)){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(file));}}
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let pass=true;
  for(const phase of ['effects','auditions']){
    const browser=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--autoplay-policy=no-user-gesture-required','--user-data-dir='+path.join(profile,phase),'http://127.0.0.1:'+server.address().port+'/'+phase],{windowsHide:true});
    let stderr='';browser.stderr.on('data',x=>stderr+=x);const stopped=new Promise(resolve=>{browser.once('error',error=>resolve({pass:false,error:error.message}));browser.once('exit',()=>resolve({pass:false,error:'Browser exited',stderr:stderr.slice(-1000)}));});
    const timeout=new Promise(resolve=>timer=setTimeout(()=>resolve({pass:false,error:'Browser timeout',stderr:stderr.slice(-1000)}),45000));
    const answer=await Promise.race([new Promise(resolve=>finish=resolve),stopped,timeout]);clearTimeout(timer);browser.kill();pass=pass&&answer.pass;console.log(JSON.stringify(answer,null,2));
  }
  const noRecordings=!requests.some(u=>/\.(ogg|wav)(?:\?|$)/.test(u));pass=pass&&noRecordings;console.log(JSON.stringify({pass,noRecordings}));server.closeAllConnections();server.close();process.exitCode=pass?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
