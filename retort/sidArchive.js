'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const Extended=require('./sid10582'),Format=require('./sidExportFormat');
const ROOT=path.resolve(__dirname,'..'),DIRECTORY=path.join(ROOT,'.retort-data/music-archive');
const digest=value=>createHash('sha256').update(value).digest('hex');
function workerBundle(){
  const analyzer=fs.readFileSync(path.join(ROOT,'tools/analyze-sid-reference.cjs'),'utf8');
  const a=analyzer.indexOf('const hex ='),b=analyzer.indexOf('function trace(');
  if(a<0||b<=a)throw Error('SID tracer source boundaries changed; converter bundle not built');
  const core='(()=>{'+analyzer.slice(a,b)+';return {header,Cpu};})()';
  const moduleSource=(file,imports='')=>'(()=>{const module={exports:{}};'+imports+fs.readFileSync(path.join(ROOT,file),'utf8')+';return module.exports;})()';
  return 'const __bundleCore='+core+';const __bundleSid='+moduleSource('retort/sidVoice/jsid.js')+';const __bundleExtended='+
    moduleSource('retort/sid10582.js',"const require=id=>{if(id==='./sidVoice/jsid')return __bundleSid;throw Error('Unknown bundled import');};")+
    ';const __bundleFormat='+moduleSource('retort/sidExportFormat.js')+';const __bundleVoice='+moduleSource('retort/sidVoice/registerScore.js',"const require=id=>{if(id==='./jsid')return __bundleSid;throw Error('Unknown bundled import');};")+';const Converter='+moduleSource('retort/sidToWav.js',
      "const require=id=>{if(id==='../tools/analyze-sid-reference.cjs')return __bundleCore;if(id==='./sidVoice/jsid')return __bundleSid;if(id==='./sidVoice/registerScore')return __bundleVoice;if(id==='./sid10582')return __bundleExtended;if(id==='./sidExportFormat')return __bundleFormat;throw Error('Unknown bundled import');};")+
    ';'+fs.readFileSync(path.join(ROOT,'assets/sidLiveWorker.js'),'utf8');
}
function installTool(directory=ROOT){
  fs.mkdirSync(directory,{recursive:true});
  const template=fs.readFileSync(path.join(ROOT,'assets/sid-to-wav.html'),'utf8'),html=template
    .replace('/*SID_WORKER_BUNDLE*/',()=>workerBundle().replace(/<\/script/gi,'<\\/script'))
    .replace('/*SID_PLAYER_CLIENT*/',()=>fs.readFileSync(path.join(ROOT,'assets/sidPlayer.js'),'utf8').replace(/<\/script/gi,'<\\/script'));
  const file=path.join(directory,'sid-to-wav.html');
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==html)fs.writeFileSync(file,html);
  if(directory===ROOT){
    const old=path.join(DIRECTORY,'sid-to-wav.html');
    if(fs.existsSync(old))fs.writeFileSync(old,'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../../sid-to-wav.html"><a href="../../sid-to-wav.html">Open SID Workshop in the project root</a>');
  }
  return file;
}
function atomic(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
function record(song,context={},directory=DIRECTORY){
  if(!song||song.voices?.length!==3)throw Error('A complete three-voice score is required for archiving');
  installTool();fs.mkdirSync(directory,{recursive:true});
  if(!fs.existsSync(path.join(directory,'catalog.json')))fs.writeFileSync(path.join(directory,'catalog.json'),'[]');
  const {archive:previousArchive,...stored}=song;
  const score=JSON.stringify(stored),hash=digest(score),slug=String(song.title||'room-music').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'room-music';
  const id=slug+'-'+hash.slice(0,16),dir=path.join(directory,id),manifestFile=path.join(dir,'manifest.json');
  if(fs.existsSync(manifestFile)){
    const old=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(old.version===2&&old.scoreHash===hash&&['8580.sid','10582.sid','score.json','song.asm','song_sid.asm'].every(f=>fs.existsSync(path.join(dir,f))))return{id,directory:dir,manifest:old};
  }
  fs.mkdirSync(dir,{recursive:true});const scoreFile=path.join(dir,'score.json'),asm=path.join(dir,'song.asm');
  fs.writeFileSync(scoreFile,score);
  const built=spawnSync(process.execPath,[path.join(ROOT,'assets/renderSid_poke.js'),scoreFile,asm],{cwd:ROOT,encoding:'utf8',timeout:30000});
  if(built.error||built.status!==0)throw built.error||Error('SID archive compilation failed: '+built.stderr.slice(0,1600));
  const core=fs.readFileSync(path.join(dir,'song.sid'));require('../tools/analyze-sid-reference.cjs').header(core);
  const units=song.voices[0].order.flatMap(i=>song.voices[0].patterns[i]).filter(s=>!s.cmd).reduce((n,s)=>n+16/s.duration,0);
  const ticks=Math.max(2,Math.round(Math.round(3000/song.bpm)/4)),seconds=units*ticks/50;
  const timing=';sec='+seconds.toFixed(2),credit=String(song.released||'Holodek').slice(0,31-timing.length)+timing;
  core.fill(0,86,118);core.write(credit,86,31,'ascii');
  const clock=context.clock||require('./sidMode').get(),palette=Extended.paletteFor(song);
  const enhanced=Buffer.from(Format.attach(core,{palette,clock,seconds,nativeBpm:750/ticks,scoreHash:hash}));
  const h=require('../tools/analyze-sid-reference.cjs').header(enhanced);
  if(h.load+h.data.length>0xa000)throw Error('10582 metadata would exceed safe SID payload RAM');
  fs.writeFileSync(path.join(dir,'8580.sid'),core);fs.writeFileSync(path.join(dir,'10582.sid'),enhanced);
  const manifest={version:2,id,title:song.title,createdAt:new Date().toISOString(),scoreHash:hash,context,seconds,clock,
    source:song.composition?.source||context.source||'existing-arrangement',palette,
    files:{classic:'8580.sid',extended:'10582.sid',score:'score.json',assembly:'song.asm',sidAssembly:'song_sid.asm'},
    checksums:{'8580.sid':digest(core),'10582.sid':digest(enhanced)},
    compatibility:'8580 is standard PSID. 10582 adds private metadata in unused payload RAM; conventional players play its classic core only. The bundled converter executes the 10582 register layer. Native SID timing is frame-quantized, not guaranteed identical to the nominal-tempo in-game WAV.'};
  atomic(manifestFile,manifest);
  fs.writeFileSync(path.join(dir,'README.txt'),song.title+'\n\n'+manifest.compatibility+'\n\nOpen sid-to-wav.html in the project root to render either SID locally. You can share that self-contained HTML alongside a SID file; your save game is not needed. score.json may contain room description and composition provenance.\n');
  const catalogFile=path.join(directory,'catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  atomic(catalogFile,[{id,title:song.title,createdAt:manifest.createdAt},...catalog.filter(r=>r.id!==id)]);
  console.info('[SidArchive]',JSON.stringify({id,title:song.title,variants:['8580','10582'],seconds}));
  return{id,directory:dir,manifest};
}
function install(app,express){installTool();fs.mkdirSync(DIRECTORY,{recursive:true});
  app.get('/music/sid-worker.js',(req,res)=>res.type('application/javascript').send(workerBundle()));
  app.get('/sid-to-wav.html',(req,res)=>res.sendFile(path.join(ROOT,'sid-to-wav.html')));
  app.get('/music-archive/sid-to-wav.html',(req,res)=>res.redirect('/sid-to-wav.html'));
  app.use('/music-archive',express.static(DIRECTORY,{dotfiles:'deny',index:false,fallthrough:false}));}
module.exports={DIRECTORY,record,installTool,workerBundle,install};
