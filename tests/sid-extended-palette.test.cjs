'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const Extended=require('../retort/sid10582'),Effects=require('../retort/sidEffectPalette'),Audio=require('../retort/renderAudio');
const Composition=require('../retort/sidComposition'),Theory=require('../retort/sidMusicTheory');
const Palette=require('../retort/audioPalette'),{waveStats}=require('../tools/analyze-room-music.cjs');
const plan=require('./fixtures/sid-leaving-threshold.json');
const palette={profile:'spectral_choir',motion:'phrase',depth:.25,transients:'off'};
function preview(){
  const s=Theory.arrangeSuite(Composition.develop(Composition.validate(plan)),'temple','extended-test');
  s.composition={acceptedPlan:plan};s.voices.forEach(v=>v.order=v.order.slice(0,7));return s;
}

test('10582 choices are strict Retort enums; archived plans have explicit translation provenance',()=>{
  const fields=require('retort-js/dist/tooling').retortSchemaToJsonSchema(Composition.parameters).properties.extensions;
  assert.deepEqual(fields.properties.profile.enum,Object.keys(Extended.PROFILES));
  assert.deepEqual(fields.properties.depth.enum,Extended.DEPTHS);
  const p={...plan,extensions:palette};assert.equal(Composition.validate(p),p);
  for(const patch of [{profile:'add reverb'},{motion:'random'},{depth:5},{transients:'massive'}])
    assert.throws(()=>Composition.validate({...p,extensions:{...palette,...patch}}),/extensions/);
  assert.throws(()=>Composition.validate({...p,extensions:{...palette,transients:'crisp'}}),/drumless/);
  assert.equal(Extended.paletteFor({composition:{acceptedPlan:p}}).source,'llm-plan');
  assert.equal(Extended.paletteFor(preview()).source,'legacy-patch-translation');
  assert.deepEqual(Theory.arrangeSuite(Composition.develop(p),'temple','same').voices,
    Theory.arrangeSuite(Composition.develop(plan),'temple','same').voices);
});

test('the companion really writes 10582 registers and produces bounded, distinct palettes',()=>{
  const signatures=new Set();
  for(const profile of Object.keys(Extended.PROFILES)){
    const layer=new Extended.Layer(44100,2,{...palette,profile,transients:'soft'}),out=new Float32Array(44100);
    for(let tick=0;tick<100;tick++){
      layer.frame({time:tick/100,frequency:220,gate:true,envelope:.8,noise:tick%20<2,bar:tick/100});
      layer.render(out.subarray(tick*441,(tick+1)*441));
    }
    assert.ok(out.every(Number.isFinite));assert.ok(out.some(n=>Math.abs(n)>.001));
    signatures.add(Buffer.from(out.buffer).toString('base64').slice(3000,5000));
    const report=layer.report();
    for(const reg of [25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41])assert.ok(report.registers.includes(reg));
    assert.ok(report.tracePreview.some(([,reg,value])=>reg===30&&(value&64)));
    assert.ok(report.tracePreview.some(([,reg,value])=>reg===35&&value>0));
    assert.ok(Math.max(...out)<1);
  }
  assert.equal(signatures.size,4);
});

test('same-score 8580 and 10582 render pair has identical timing and distinct unclipped PCM',async()=>{
  const s=preview(),before=JSON.stringify(s);
  const pair=await Palette.pair(s,{clock:'2x',runId:'offline-extended-regression-v2',coords:'0,0,0'});
  const a=fs.readFileSync(path.join(__dirname,'..',pair.variants['8580'])),b=fs.readFileSync(path.join(__dirname,'..',pair.variants['10582']));
  const sa=waveStats(a),sb=waveStats(b);
  assert.equal(sa.seconds,sb.seconds);assert.equal(sa.sampleRate,sb.sampleRate);
  assert.equal(sa.clippedSamples,0);assert.equal(sb.clippedSamples,0);assert.notDeepEqual(a,b);
  assert.ok(Math.abs(sb.dc)<.001);
  assert.equal(JSON.stringify(s),before);
  const again=await Palette.pair(s,{clock:'2x',runId:'offline-extended-regression-v2',coords:'0,0,0'});
  assert.deepEqual(again.variants,pair.variants);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sid-traditional-'));
  try{
    const rendered=Audio.renderArrangementToWav(s,{outBaseNoExt:path.join(dir,'default'),clock:'2x'});
    assert.deepEqual(fs.readFileSync(rendered.wavPath),a);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('every ambience/effect design has a deterministic register layer; keyed stems remain in A',()=>{
  for(const name of Effects.names){
    const a=Effects.render(name,.3,'2x'),b=Effects.render(name,.3,'2x');
    assert.deepEqual(a.samples,b.samples,name);assert.ok(a.samples.every(Number.isFinite));
    assert.ok(a.samples.every(n=>Math.abs(n)<=.18001),name);
    assert.equal(Math.abs(a.samples[0]),0);assert.equal(Math.abs(a.samples.at(-1)),0);
  }
  const report=Effects.render('amb_drone_A',.3,'2x').report;
  const lo=report.tracePreview.find(([,reg])=>reg===0)[2],hi=report.tracePreview.find(([,reg])=>reg===1)[2];
  const frequency=(lo+(hi<<8))*985248*2/16777216;
  assert.ok(Math.abs(frequency-110)<2);
});

test('palette routes reject bad coordinates, stale adventures and unsupported effects before rendering',async()=>{
  const handlers=new Map();let reads=0;
  Palette.install({post:(p,h)=>handlers.set(p,h),get:(p,h)=>handlers.set(p,h)},
    {getDungeonRunId:()=> 'new-run',getRoomMusic:()=>{reads++;return null;}});
  const call=async(route,body,query={},params={})=>{
    let code=200,result;
    const res={status:n=>{code=n;return res;},json:x=>{result=x;return res;}};
    await handlers.get(route)({body,query,params},res);return{code,result};
  };
  assert.equal((await call('/music/palette',{coords:'../test',clock:'2x'})).code,400);
  assert.equal((await call('/music/palette',{coords:'0,0,0',clock:'2x',runId:'old-run'})).code,409);
  assert.equal(reads,0);
  assert.equal((await call('/music/palette',{coords:'0,0,0',clock:'2x',runId:'new-run'})).code,404);
  assert.equal((await call('/audio/palette/:name.wav',{}, {clock:'2x',seconds:'Infinity'},{name:'hit'})).code,400);
  assert.equal((await call('/audio/palette/:name.wav',{}, {clock:'2x',seconds:'1'},{name:'../secret'})).code,400);
});

test('actual HTTP routes prepare both variants and serve a register-rendered effect without the game server',async()=>{
  const express=require('express'),http=require('node:http'),app=express();app.use(express.json());
  const song=preview();
  Palette.install(app,{getDungeonRunId:()=> 'http-palette-test',getRoomMusic:()=>song});
  app.use('/sid',express.static(path.resolve(__dirname,'../sid')));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const r=await fetch(origin+'/music/palette',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({coords:'0,0,0',clock:'2x',runId:'http-palette-test'})});
    assert.equal(r.status,200);const pair=await r.json();
    assert.equal(pair.source,'same-score-pair');
    for(const url of Object.values(pair.variants)){
      const wav=await fetch(origin+url);assert.equal(wav.status,200);assert.ok(waveStats(Buffer.from(await wav.arrayBuffer())).rms>.01);
    }
    const fx=await fetch(origin+'/audio/palette/spell.wav?clock=2x&seconds=0.5');
    assert.equal(fx.status,200);assert.match(fx.headers.get('content-type'),/audio\/wav/);
    assert.ok(waveStats(Buffer.from(await fx.arrayBuffer())).rms>.001);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('clock selection keeps effect sample rates compatible with the corresponding original bank',()=>{
  for(const [clock,sampleRate]of [['1x',22050],['2x',44100],['4x',44100]]){
    const result=Effects.render('spell',.25,clock);assert.equal(result.sampleRate,sampleRate);
    assert.equal(result.samples.length,Math.round(.25*sampleRate));
  }
  assert.throws(()=>Palette.clockOf('arbitrary'),/clock/);
});

const client=fs.readFileSync('assets/sfx.js','utf8');
function slice(from,to){const a=client.indexOf(from),b=client.indexOf(to,a);assert.ok(a>=0&&b>a);return client.slice(a,b);}
function transport(paused=false,blocked=false){
  function media(id){const events=new Map();return{id,paused,currentTime:84,duration:120,src:'old.wav',__fade:1,
    addEventListener:(event,fn)=>events.set(event,fn),removeEventListener:event=>events.delete(event),
    emit:event=>events.get(event)?.(),getAttribute(){return this.src;},removeAttribute(){this.src='';},
    load(){},play(){if(blocked)return Promise.reject(Error('blocked'));this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};}
  const old=media('room-music'),next=media('room-audio'),timers=[];
  const c=vm.createContext({crossfading:false,pendingSong:{url:'extended.wav',coords:'0,0,0',preserveTime:true},
    shownRoom:'0,0,0',playingUrl:'old.wav',songRoom:'0,0,0',activeMusic:old,internalPlay:false,
    music:()=>old,musicPlayer:()=>next,settings:{userPaused:paused},setMusicVolume(){},reportSlot(){},paletteStatus(){},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},performance:{now:()=>2000}});
  vm.runInContext(slice('function startPending()', 'function loadLatestSong()'),c);
  return{old,next,c,timers,run:code=>vm.runInContext(code,c)};
}

test('A/B waits for playable audio and retains paused timestamp and pause state',async()=>{
  const f=transport(true);f.run('startPending()');
  assert.equal(f.c.activeMusic,f.old);assert.equal(f.c.playingUrl,'old.wav');
  assert.equal(f.next.__fade,0);f.next.currentTime=0;
  await f.next.emit('canplay');
  assert.equal(f.next.currentTime,84);assert.equal(f.next.paused,true);
  assert.equal(f.c.activeMusic,f.next);assert.equal(f.c.playingUrl,'extended.wav');assert.equal(f.c.crossfading,false);
});

test('blocked A/B playback keeps the original track and releases the transition lock',async()=>{
  const f=transport(false,true);f.run('startPending()');await f.next.emit('canplay');
  assert.equal(f.c.activeMusic,f.old);assert.equal(f.old.paused,false);assert.equal(f.c.playingUrl,'old.wav');
  assert.equal(f.c.crossfading,false);
});

test('rapid A/B changes discard an obsolete candidate before it can replace the active song',async()=>{
  const f=transport(true);f.run('startPending(); pendingSong={url:"newer.wav",coords:"0,0,0",preserveTime:true}');
  await f.next.emit('canplay');assert.equal(f.c.playingUrl,'old.wav');
  assert.equal(f.next.src,'newer.wav');await f.next.emit('canplay');assert.equal(f.c.playingUrl,'newer.wav');
});

test('voice defaults to 10582 independently of the traditional composition default',()=>{
  const c=vm.createContext({});vm.runInContext(slice('const DEF =','const saved =')+'globalThis.defaults=DEF;',c);
  assert.equal(c.defaults.voiceChip,'10582');assert.equal(c.defaults.compositionChip,'8580');
  assert.match(client,/data-k="compositionChip"/);assert.match(client,/Both versions ready/);
  const backend=fs.readFileSync('retort/sidVoice/index.js','utf8');
  assert.match(backend,/SIDVOICE_CHIP \|\| '10582'/);
});

test('effect loading isolates traditional/extended caches and retains the original on a reported extension error',async()=>{
  const make=values=>({numberOfChannels:1,length:values.length,sampleRate:44100,duration:.1,getChannelData:()=>Float32Array.from(values)});
  const dry=make([.1,.2,.3]),wet=make([.01,.02,.03]),requests=[],messages=[];
  let chip='8580',broken=false;
  const c=vm.createContext({buffers:new Map(),loading:new Map(),sidMode:()=> '2x',compositionChip:()=>chip,
    SFX_DIRS:{'2x':'/assets/sfx-enh/'},
    fetch:async url=>{requests.push(url);return{ok:!broken,status:503,arrayBuffer:async()=>url.includes('/audio/')?'wet':'dry'};},
    audio:()=>({decodeAudioData:(bytes,resolve)=>resolve(bytes==='wet'?wet:dry),createBuffer:()=>{
      const data=new Float32Array(3);return{numberOfChannels:1,length:3,sampleRate:44100,getChannelData:()=>data};}}),
    console:{warn:(...args)=>messages.push(args)},paletteStatus:s=>messages.push(s)});
  vm.runInContext(slice('function load(name)', '// --- music ducking'),c);
  const a=await c.load('spell');assert.equal(a,dry);assert.equal(requests.length,1);
  chip='10582';const b=await c.load('spell');assert.notEqual(b,dry);assert.equal(requests.length,3);
  assert.ok(Math.abs(b.getChannelData(0)[0]-.11)<1e-6);
  chip='8580';assert.equal(await c.load('spell'),dry);assert.equal(requests.length,3);
  chip='10582';broken=true;
  // Break only the companion request: the dry recording must remain playable.
  c.fetch=async url=>({ok:!url.includes('/audio/'),status:503,arrayBuffer:async()=>'dry'});
  assert.equal(await c.load('hit'),dry);assert.ok(messages.length);
});

test('late palette results cannot switch a different room or a different clock setting',async()=>{
  for(const stale of ['room','clock','run','score']){
    let resolve,room='0,0,0',clock='2x',queued=0;
    const c=vm.createContext({songRunId:'run',paletteGeneration:0,palettePairs:new Map(),sidMode:()=>clock,currentRoomKey:()=>room,
      compositionChip:()=> '10582',shownRoom:'0,0,0',queueRoomMusic:()=>queued++,
      document:{querySelector:()=>null},console:{warn(){}},fetch:()=>new Promise(r=>resolve=r)});
    vm.runInContext(slice('function paletteStatus(', 'function changeComposition('),c);
    const p=c.preparePalette('0,0,0',true);
    if(stale==='room')room='1,0,0';else if(stale==='clock')clock='4x';else if(stale==='run')c.songRunId='next-run';else c.paletteGeneration++;
    resolve({ok:true,json:async()=>({variants:{'10582':'extended.wav','8580':'traditional.wav'}})});
    await p;assert.equal(queued,0,stale);
  }
});

test('room-entry optimistic playback routes through the same palette-aware manager as SSE',()=>{
  const game=fs.readFileSync('assets/game.js','utf8'),start=game.indexOf('if (resp?.ok && resp?.wav)');
  const end=game.indexOf('\n                    })',start),snippet=game.slice(start,end);
  assert.ok(start>0&&end>start);
  let queued=0,fresh=0;
  const c={window:{HolodekSfx:{queueRoomMusic:data=>{assert.equal(data.coords,'0,0,0');queued++;}}},
    coordsKey:'0,0,0',resp:{ok:true,wav:'classic.wav'},playRoomWavFresh:()=>fresh++};
  vm.runInNewContext(snippet,c);assert.equal(queued,1);assert.equal(fresh,0);
  c.window={};vm.runInNewContext(snippet,c);assert.equal(fresh,1);
});
