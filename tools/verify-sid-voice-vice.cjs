'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const Score=require('../retort/sidVoice/registerScore'),Converter=require('../retort/sidToWav'),{waveStats}=require('./analyze-room-music.cjs');
const root=path.resolve(__dirname,'..'),data=path.join(root,'.retort-data/vice10582/vice-3.1/data');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function carrier(){
  const b=Buffer.alloc(122);b.write('PSID');b.writeUInt16BE(1,4);b.writeUInt16BE(118,6);b.writeUInt16BE(0x1000,10);b.writeUInt16BE(0x1001,12);b.writeUInt16BE(1,14);b.writeUInt16BE(1,16);
  b.write('Silent carrier - NOT the speech',22,'ascii');b.writeUInt16LE(0x1000,118);b[120]=b[121]=0x60;return b;
}
function main(){
  const file=path.resolve(process.argv[2]||''),bytes=fs.readFileSync(file),info=Score.inspect(bytes);Score.createEngine(bytes);
  const dir=file+'.vice';fs.mkdirSync(dir,{recursive:true});const sid=path.join(dir,'silent-carrier.sid');fs.writeFileSync(sid,carrier());
  const results=[],exe=path.join(data,'vsid.exe');
  for(const enabled of [false,true]){
    const base=path.join(dir,enabled?'native-10582-bank':'carrier-without-bank'),wav=base+'.wav',log=base+'.log';
    const env={...process.env};delete env.HOLODEK_SIDVOICE_SCORE;if(enabled)env.HOLODEK_SIDVOICE_SCORE=file;
    const seconds=info.seconds+.25,args=['-default','-console','-keepenv','-sidenginemodel','10582','-sounddev','dummy','-soundrecdev','wav','-soundrecarg',wav,'-soundrate',String(info.sampleRate),'-warp','-limitcycles',String(Math.ceil(seconds*985248)),'-logfile',log,sid];
    const run=spawnSync(exe,args,{cwd:data,env,windowsHide:true,encoding:'utf8',timeout:60000}),logged=fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';
    if(run.error||!(run.status===0||run.status===1&&logged.includes('cycle limit reached.')))throw run.error||Error('Native voice run failed: '+logged.slice(-2500));
    if(enabled&&!logged.includes('64 native 10582 chips'))throw Error('VSID did not activate the voice register bank');
    const audio=fs.readFileSync(wav),stats=waveStats(audio),result={enabled,wav,...stats};results.push(result);console.log(JSON.stringify(result));
  }
  const browser=Converter.render(bytes,{seconds:info.seconds,sampleRate:info.sampleRate});fs.writeFileSync(path.join(dir,'browser-reference.wav'),Buffer.from(Converter.wav(browser.samples,info.sampleRate)));
  const pass=results[0].rms<.00001&&results[1].rms>.001&&!results[1].clippedSamples;
  const report={pass,scoreSha256:hash(bytes),exeSha256:hash(fs.readFileSync(exe)),info,results,
    note:'VSID replays a private 64-chip register score, not a PSID speech driver. Signal checks do not establish intelligibility or naturalness. Browser and native chip implementations are not bit-identical.'};
  fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass,report:path.join(dir,'verification.json')}));process.exitCode=pass?0:1;
}
if(require.main===module)try{main();}catch(error){console.error(error);process.exitCode=1;}
module.exports={carrier};
