'use strict';
// Converter is bundled with the same engine used by offline WAV export.
let epoch=0,engine=null,bytes=null,options=null,position=0,total=0,audioPort=null,failedEpoch=null;
let voiceGain=1;
self.onmessage=async({data:d})=>{
  try{
    if(d.action==='connect'){audioPort=d.port;audioPort.onmessage=self.onmessage;return;}
    if(d.action==='inspect'){self.postMessage({info:Converter.inspect(d.bytes)});return;}
    if(d.action==='effect-buffer'){
      const effect=Converter.createEngine(d.bytes,{sampleRate:d.sampleRate}),info=effect.info;
      if(info.kind!=='sid-effect'||info.chips>2||info.seconds>8)throw Error('Only short one/two-chip SID effects may be cached.');
      const count=Math.round(info.seconds*d.sampleRate),samples=new Float32Array(count),fade=d.sampleRate*.005;
      for(let at=0;at<count;at+=2048){const part=effect.read(Math.min(2048,count-at));
        for(let i=0;i<part.length;i++)samples[at+i]=Math.max(-.98,Math.min(.98,part[i]))*Math.min(1,(at+i)/fade,(count-1-at-i)/fade);
      }
      self.postMessage({effectBuffer:true,id:d.id,samples:samples.buffer,sampleRate:d.sampleRate,seconds:info.seconds},[samples.buffer]);return;
    }
    if(d.action==='render'){
      const result=Converter.render(d.bytes,{...d,onProgress:progress=>self.postMessage({progress})});
      const wav=Converter.wav(result.samples,result.sampleRate);self.postMessage({wav,report:result.report},[wav]);return;
    }
    if(d.action==='open'||d.action==='seek'){
      epoch=d.epoch;failedEpoch=null;voiceGain=1;const ticket=epoch;
      if(d.action==='open'){bytes=d.bytes;options=d;}
      if(!bytes)throw Error('No SID loaded');
      engine=Converter.createEngine(bytes,options);
      const seconds=Number(options.seconds??engine.info.seconds??600);
      if(!Number.isFinite(seconds)||seconds<(engine.info.kind?0.05:1)||seconds>1200)throw Error('Duration is outside the supported SID playback range');
      total=Math.round(seconds*options.sampleRate);position=0;
      const target=Math.round(Math.max(0,Number(d.time)||0)*options.sampleRate)%total;
      while(position<target){
        for(let n=0;n<24&&position<target;n++){const count=Math.min(4096,target-position);engine.read(count);position+=count;}
        await new Promise(resolve=>setTimeout(resolve,0));if(ticket!==epoch)return;
      }
      self.postMessage({ready:true,epoch,info:engine.info,model:engine.report().model,seconds:total/options.sampleRate,position});return;
    }
    if(d.action==='pull'&&d.epoch===epoch&&failedEpoch!==epoch){
      const chunk=new Float32Array(2048);let written=0;
      while(written<chunk.length){
        if(position>=total){if(!options.loop)break;if(engine.info.kind==='sid-ambience')engine.restartLoop();else engine=Converter.createEngine(bytes,options);position=0;}
        const count=Math.min(chunk.length-written,total-position),part=engine.read(count),fade=engine.info.kind==='sid-voice'?0:options.sampleRate*.005;
        for(let i=0;i<count;i++)chunk[written+i]=(engine.info.kind==='sid-voice'?part[i]:Math.max(-.98,Math.min(.98,part[i])))*(fade?Math.min(1,(position+i)/fade,(total-1-position-i)/fade):1);
        written+=count;position+=count;
      }
      const samples=written===chunk.length?chunk:chunk.slice(0,written);
      if(engine.info.kind==='sid-voice'){
        // Peak limiting is bounded lookahead, not a full-sentence normalization pass.
        // Raw voice samples are protected before the final sample clamp below.
        let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));
        const target=peak>.9?0.9/peak:1;voiceGain=Math.min(target,voiceGain+samples.length/options.sampleRate*.25);
        for(let i=0;i<samples.length;i++)samples[i]=Math.max(-.98,Math.min(.98,samples[i]*voiceGain));
      }
      (audioPort||self).postMessage({chunk:samples,epoch,end:!options.loop&&position>=total},[samples.buffer]);
    }
  }catch(error){if(d.action==='effect-buffer'){self.postMessage({effectBuffer:true,id:d.id,error:error.message});return;}failedEpoch=d.epoch;(d.action==='pull'&&audioPort?audioPort:self).postMessage({error:error.message,epoch:d.epoch});}
};
