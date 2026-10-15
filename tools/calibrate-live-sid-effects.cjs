'use strict';
// Offline library calibration only. Runtime effects compile registers, not WAVs.
const fs=require('node:fs'),path=require('node:path'),Effects=require('../retort/sidEffectsLive'),Score=require('../retort/sidVoice/registerScore');
const gains={};
for(const name of Effects.names)for(const clock of ['1x','2x','4x'])for(const chip of ['8580','10582']){
  const item=Effects.compile(name,{clock,chip,calibrate:true}),engine=Score.createEngine(item.bytes,{sampleRate:22050});let peak=0;
  for(let at=0,total=Math.round(item.duration*22050);at<total;at+=22050)for(const x of engine.read(Math.min(22050,total-at)))peak=Math.max(peak,Math.abs(x));
  if(peak<1e-8)throw Error('Silent effect '+name+' '+clock+' '+chip);
  gains[name+'|'+clock+'|'+chip]=Math.min(64,item.targetPeak/peak);
}
const file=path.resolve(__dirname,'../retort/sidEffectsGains.json');fs.writeFileSync(file,JSON.stringify(gains,null,2)+'\n');console.log(JSON.stringify({file,variants:Object.keys(gains).length}));
