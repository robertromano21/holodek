'use strict';
const { parentPort, workerData:job } = require('node:worker_threads');
const fs = require('node:fs');
const Audio = require('./renderAudio');
try {
  if(job.kind==='music'){
    const variants={};
    for(const chip of ['8580','10582']){
      const base=job.base+'-'+chip;
      if(!fs.existsSync(base+'.wav')){
        const temp=base+'.rendering';
        Audio.renderArrangementToWav(job.song,{outBaseNoExt:temp,clock:job.clock,chip});
        fs.renameSync(temp+'.wav',base+'.wav');
        if(fs.existsSync(temp+'.10582.json'))fs.renameSync(temp+'.10582.json',base+'.10582.json');
      }
      variants[chip]=base+'.wav';
    }
    parentPort.postMessage({ok:true,variants});
  }else{
    const {samples,sampleRate,report}=require('./sidEffectPalette').render(job.name,job.seconds,job.clock);
    Audio.writeMono16Wav(job.base+'.rendering.wav',samples,sampleRate);
    fs.renameSync(job.base+'.rendering.wav',job.base+'.wav');
    fs.writeFileSync(job.base+'.10582.json',JSON.stringify(report));
    parentPort.postMessage({ok:true});
  }
} catch(error){ parentPort.postMessage({ok:false,error:error.message}); }
