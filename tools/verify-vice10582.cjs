'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto'),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const {waveStats}=require('./analyze-room-music.cjs');
const root=path.resolve(__dirname,'..'),data=path.join(root,'.retort-data/vice10582/vice-3.1/data');
const dir=path.resolve(process.argv[2]||'.retort-data/vice10582/auditions/the-ashen-lullaby-6a0f67dcc72885a5');
const seconds=Number(process.argv[3]||5),exe=path.join(data,'vsid.exe');
if(!Number.isFinite(seconds)||seconds<2||seconds>1200)throw Error('Choose 2..1200 seconds');
const results=[];
function tailRms(bytes){
  const rate=bytes.readUInt32LE(24),channels=bytes.readUInt16LE(22),start=44+rate*channels*2;
  let energy=0,n=0;for(let at=start;at+1<bytes.length;at+=2){const x=bytes.readInt16LE(at)/32768;energy+=x*x;n++;}
  return n?Math.sqrt(energy/n):NaN;
}
for(const [name,model]of [['register-only-proof',257],['register-only-proof',261],['10582-native',261]]){
  const base=path.join(dir,name+'-vice-'+model),wav=base+'.wav',log=base+'.log';
  const duration=name==='register-only-proof'?Math.min(5,seconds):seconds;
  const args=['-default','-console','-keepenv','-sidenginemodel',String(model),'-sounddev','dummy','-soundrecdev','wav',
    '-soundrecarg',wav,'-soundrate','44100','-warp','-limitcycles',String(Math.ceil(duration*985248)),
    '-logfile',log,path.join(dir,name+'.sid')];
  const started=Date.now(),run=spawnSync(exe,args,{cwd:data,encoding:'utf8',windowsHide:true,timeout:Math.max(30000,seconds*1500)});
  const logged=fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';
  // VICE 3.1 deliberately returns 1 when -limitcycles ends a successful run.
  if(run.error||!(run.status===0||run.status===1&&logged.includes('cycle limit reached.')))throw run.error||Error('VSID failed ('+run.status+'): '+run.stderr+'\n'+logged.slice(-3000));
  if(!fs.existsSync(wav))throw Error('VSID did not record audio. '+fs.readFileSync(log,'utf8').slice(-2500));
  const bytes=fs.readFileSync(wav),stats=waveStats(bytes),result={name,model,elapsedMs:Date.now()-started,wav,requestedSeconds:duration,sidSha256:hash(path.join(dir,name+'.sid')),...stats,tailRms:tailRms(bytes)};results.push(result);console.log(JSON.stringify(result));
}
const report={pass:results[0].tailRms<.0001&&results[1].tailRms>.0001&&results[2].rms>.001&&results.every(r=>!r.clippedSamples&&r.seconds>r.requestedSeconds-.1),exeSha256:hash(exe),results};
fs.writeFileSync(path.join(dir,'vice-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({pass:report.pass,report:path.join(dir,'vice-verification.json')}));process.exitCode=report.pass?0:1;
