'use strict';
const {designs,names}=require('./sidEffectPalette'),Extended=require('./sid10582'),Score=require('./sidVoice/registerScore'),Clock=require('./sidMode');
const cache=new Map();let gains=null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function compile(name,{chip='8580',clock='2x',calibrate=false}={}){
  if(!names.includes(name)||!['8580','10582'].includes(chip)||!Clock.norm(clock))throw Error('Unknown SID effect, chip or clock');
  const key=name+'|'+clock+'|'+chip;if(!calibrate&&cache.has(key))return cache.get(key);
  const design=designs().get(name),mult=Clock.mult(clock),rate=mult>1?44100:22050,hz=100;
  const seconds=design.loop?design.length:(design.length+1)/50+(design.options.tail??.6),nTicks=Math.ceil(seconds*hz),samples=Math.round(nTicks*rate/hz);
  const recorder=new Score.Recorder({kind:design.loop?'sid-ambience':'sid-effect',chips:chip==='10582'?2:1,model:chip,sampleRate:rate,clock:985248*mult,cut:mult,hz,nTicks,samples,exact:true,fadeSamples:Math.min(samples>>2,Math.round(rate*.003))});
  let pending=[];const profile=/chant|drone|howl/.test(name)?'spectral_choir':/drip|coin|pickup|heal|quest|notice/.test(name)?'glass_halo':'ember_air';
  let layer=null;
  if(chip==='10582'){
    layer=new Extended.Layer(rate,mult,{profile,depth:.25,motion:design.loop?'breath':'still',transients:design.loop?'soft':'crisp'});
    for(const [,reg,value]of layer.trace)pending.push([1,reg,value]);
    const write=layer.write.bind(layer);layer.write=(reg,value,time,strobe=false)=>{const before=layer.last.get(reg);write(reg,value,time,strobe);if(strobe||before!==layer.last.get(reg))pending.push([1,reg,layer.last.get(reg)]);};
  }
  let row={};
  for(let tick=0;tick<nTicks;tick++){
    const t=tick/hz,frame=Math.floor(t*50),writes=[];
    if(!(tick%2)){
      row=design.loop||frame<design.length?design.fn(frame,Math.round(seconds*50)):{v:[{gate:false},{gate:false},{gate:false}],f:{vol:15}};
      const v=row.v||[],f=row.f||{},wave={tri:16,saw:32,pulse:64,noise:128};
      for(let c=0;c<3;c++){
        const voice=v[c]||{},base=c*7,freq=clamp(Math.round((voice.hz||0)*16777216/(985248*mult)),0,65535),pw=clamp(Math.round(voice.pw??2048),0,4095);
        writes.push([0,base,freq&255],[0,base+1,freq>>8],[0,base+2,pw&255],[0,base+3,pw>>8],[0,base+4,(wave[voice.wave]||0)|(voice.gate?1:0)|(voice.sync?2:0)|(voice.ring?4:0)|(voice.test?8:0)],[0,base+5,voice.ad??0],[0,base+6,voice.sr??0]);
      }
      const cut=clamp(Math.round(f.cut??2047),0,2047),mode={lp:1,bp:2,hp:4,lb:3,notch:5}[f.mode]||0;
      writes.push([0,21,cut&7],[0,22,cut>>3],[0,23,(f.res??0)<<4|(f.route??0)],[0,24,mode<<4|(f.vol??15)]);
    }
    if(layer){const v=row.v?.[0]||{};layer.frame({time:t,frequency:v.hz||0,gate:!!v.gate,envelope:v.gate?1:0,noise:v.wave==='noise',bar:t/4});
      for(const event of pending)if(event[1]===35||event[1]===27)event[2]=Math.round(event[2]*.5);
      writes.push(...pending);pending=[];
    }recorder.tick(writes);
  }
  let bytes=recorder.finish();
  if(!calibrate){gains=gains||require('./sidEffectsGains.json');if(!Number.isFinite(gains[key]))throw Error('Missing calibrated SID effect gain: '+key);bytes=Score.withGain(bytes,gains[key]);}
  const result={bytes,duration:samples/rate,loop:design.loop,kind:design.loop?'sid-ambience':'sid-effect',targetPeak:(design.loop?0.355:0.631)*(design.options.gain??1)};
  if(!calibrate){cache.set(key,result);while(cache.size>128)cache.delete(cache.keys().next().value);}return result;
}
module.exports={compile,names};
