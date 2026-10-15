'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{Worker}=require('node:worker_threads');
const Extended=require('./sid10582'),Clock=require('./sidMode'),Effects=require('./sidEffectPalette');
const DIR=path.resolve(__dirname,'../sid/palettes'),pending=new Map(),queue=[];
const busy={music:false,effect:false};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,40);
function pump(kind){
  const index=queue.findIndex(j=>j.data.kind===kind);
  if(busy[kind]||index<0)return;
  const job=queue.splice(index,1)[0];busy[kind]=true;
  let worker,settled=false;
  const finish=(error)=>{if(settled)return;settled=true;busy[kind]=false;pending.delete(job.key);error?job.reject(error):job.resolve();pump(kind);};
  try{
    worker=new Worker(path.join(__dirname,'audioPaletteWorker.js'),{workerData:job.data});
    worker.once('message',m=>finish(m.ok?null:Error(m.error)));
    worker.once('error',finish);worker.once('exit',code=>{if(!settled)finish(Error('Audio palette worker exited: '+code));});
  }catch(e){finish(e);}
}
function run(key,data){
  if(pending.has(key))return pending.get(key);
  if(queue.length>=32)return Promise.reject(Error('Audio palette render queue full; try again shortly.'));
  fs.mkdirSync(DIR,{recursive:true});
  const promise=new Promise((resolve,reject)=>queue.push({key,data,resolve,reject}));
  pending.set(key,promise);pump(data.kind);return promise;
}
function clockOf(clock){if(!Clock.norm(clock))throw Error('clock must be 1x, 2x or 4x');return Clock.norm(clock);}
function touch(file){const now=new Date();fs.utimesSync(file,now,now);}
function prune(){
  // Only this module's hash-named generated cache files can be removed.
  const groups={music:new Map(),effect:new Map()};
  for(const name of fs.readdirSync(DIR)){
    const m=name.match(/^([a-f0-9]{40})(-(?:8580|10582))?\.wav$/);if(!m)continue;
    const kind=m[2]?'music':'effect',file=path.resolve(DIR,name),time=fs.statSync(file).mtimeMs;
    const group=groups[kind].get(m[1])||{key:m[1],time:0,files:[]};group.time=Math.max(group.time,time);group.files.push(file);groups[kind].set(m[1],group);
  }
  for(const [kind,limit]of [['music',8],['effect',96]])for(const g of [...groups[kind].values()].sort((a,b)=>b.time-a.time).slice(limit)){
    if(pending.has(g.key))continue;
    for(const file of g.files)for(const target of [file,file.replace(/\.wav$/,'.10582.json')]){
      if(path.dirname(target)!==DIR)throw Error('Unsafe audio cache path');
      try{fs.unlinkSync(target);}catch(e){if(!['ENOENT','EBUSY','EPERM','EACCES'].includes(e.code))throw e;}
    }
  }
}
async function pair(song,{clock,runId,coords}){
  clock=clockOf(clock);
  const key=digest([Extended.VERSION,clock,runId,coords,song]),base=path.join(DIR,key);
  const files=['8580','10582'].map(chip=>base+'-'+chip+'.wav');
  if(!files.every(f=>fs.existsSync(f)))await run(key,{kind:'music',song,clock,base});
  files.forEach(touch);prune();
  return {variants:Object.fromEntries(['8580','10582'].map(chip=>[chip,'/sid/palettes/'+key+'-'+chip+'.wav'])),
    clock,palette:Extended.paletteFor(song),source:'same-score-pair',runId,coords};
}
async function effect(name,seconds,clock){
  if(!Effects.names.includes(name))throw Error('Unknown 10582 effect');
  clock=clockOf(clock);seconds=Math.round(Number(seconds)*1000)/1000;
  if(!Number.isFinite(seconds)||seconds<=0||seconds>30)throw Error('Effect duration must be 0..30 seconds');
  const key=digest([Extended.VERSION,name,seconds,clock]),base=path.join(DIR,key);
  if(!fs.existsSync(base+'.wav'))await run(key,{kind:'effect',name,seconds,clock,base});
  touch(base+'.wav');prune();
  return base+'.wav';
}
function install(app,state){
  app.post('/music/palette',async(req,res)=>{
    try{
      const {coords,clock,runId}=req.body||{};
      if(typeof coords!=='string'||!/^(-?\d+),(-?\d+),(-?\d+)$/.test(coords)||!Clock.norm(clock))return res.status(400).json({error:'Valid coords and clock required'});
      const current=state.getDungeonRunId();
      if(runId&&runId!==current)return res.status(409).json({error:'Adventure changed; discard the old song'});
      const [x,y,z]=coords.split(',').map(Number),song=state.getRoomMusic({x,y,z});
      if(!song)return res.status(404).json({error:'No composed song for this room yet'});
      const result=await pair(song,{clock,runId:current,coords});
      if(current!==state.getDungeonRunId())return res.status(409).json({error:'Adventure changed during rendering'});
      res.json(result);
    }catch(e){console.warn('[AudioPalette]',e.message);res.status(503).json({error:e.message});}
  });
  app.get('/audio/palette/:name.wav',async(req,res)=>{
    if(!Effects.names.includes(req.params.name)||!Clock.norm(req.query.clock)||!(Number(req.query.seconds)>0&&Number(req.query.seconds)<=30))return res.status(400).json({error:'Unknown effect, clock or duration'});
    try{const file=await effect(req.params.name,req.query.seconds,req.query.clock);res.set('Cache-Control','private, max-age=86400');res.sendFile(file);}
    catch(e){console.warn('[AudioPaletteEffect]',e.message);res.status(503).json({error:e.message});}
  });
}
module.exports={pair,effect,install,clockOf};
