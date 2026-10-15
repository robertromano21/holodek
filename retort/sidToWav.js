'use strict';
const {header,Cpu}=require('../tools/analyze-sid-reference.cjs');
const {Chip,CLK}=require('./sidVoice/jsid');
const Extended=require('./sid10582'),Format=require('./sidExportFormat');
const VoiceScore=require('./sidVoice/registerScore');
function binaryView(input){
  const bytes=new Uint8Array(input.buffer||input,input.byteOffset||0,input.byteLength),d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.readUInt16BE=n=>d.getUint16(n,false);bytes.readUInt16LE=n=>d.getUint16(n,true);bytes.readUInt32BE=n=>d.getUint32(n,false);
  bytes.toString=(encoding,start=0,end=bytes.length)=>new TextDecoder(encoding==='latin1'?'windows-1252':'utf-8').decode(bytes.subarray(start,end));
  return bytes;
}
function inspect(input){
  if(VoiceScore.isScore(input))return VoiceScore.inspect(input);
  const {core,extension}=Format.split(input),{data,...info}=header(binaryView(core));
  if(info.version===2){const b=binaryView(core);if(b[122]||b[123])throw Error('Multi-SID files require a full SID player.');}
  if(extension){Extended.validate(extension.palette);if(!['1x','2x','4x'].includes(extension.clock)||
    !Number.isFinite(extension.nativeBpm)||extension.nativeBpm<40||extension.nativeBpm>240)throw Error('Unsupported 10582 timing');}
  const seconds=extension?.seconds??Number(info.released.match(/;sec=([\d.]+)/)?.[1]);
  return{...info,extension,registerDriver:info.released.startsWith('HDK10582N'),seconds:Number.isFinite(seconds)&&seconds>0?seconds:null,bytes:core.length};
}
function createEngine(input,{sampleRate=44100,subtune=1,clock:clockOverride,model='auto'}={}){
  if(VoiceScore.isScore(input))return VoiceScore.createEngine(input,{sampleRate,model});
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw Error('Unsupported sample rate');
  if(clockOverride&&!['1x','2x','4x'].includes(clockOverride))throw Error('Unsupported SID clock');
  if(!['auto','8580','10582'].includes(model))throw Error('Choose 8580 or 10582 playback');
  const info=inspect(input),{core,extension}=Format.split(input),h=header(binaryView(core));
  if(!Number.isInteger(subtune)||subtune<1||subtune>h.songs)throw Error('Invalid subtune');
  const clock=h.clock==='NTSC'?1022727:CLK;
  const selected=model==='auto'?(extension||info.registerDriver?'10582':'8580'):model;
  const cpu=new Cpu(),chip=new Chip(sampleRate,{model:selected,clk:clock,aa:true}),regs=new Uint8Array(64),used=new Set();
  const layer=extension&&selected==='10582'?new Extended.Layer(sampleRate,Number((clockOverride||extension.clock)[0]),extension.palette):null;
  cpu.mem.set(h.data,h.load);cpu.onWrite=(address,value)=>{
    if(address>=0xd400&&address<=(info.registerDriver?0xd43f:0xd418)){
      const raw=address-0xd400,r=selected==='8580'?raw&31:raw;
      regs[r]=value;chip.write(r,value);used.add(raw);
    }
    else if(address>=0xd000&&address<=0xdfff)throw Error('This SID needs hardware outside the supported single-chip player.');
  };
  cpu.a=subtune-1;cpu.call(h.init,20000);
  let frame=0,position=0,cursor=0,buffer=new Float32Array(0),dx=0,dy=0;
  const dcR=Math.exp(-2*Math.PI*18/sampleRate);
  function nextFrame(){
    cpu.call(h.play,20000);
    const a=Math.round(frame*sampleRate/h.hz),b=Math.round((frame+1)*sampleRate/h.hz);
    buffer=new Float32Array(b-a);cursor=0;
    for(let part=0;part<2;part++){
      const begin=Math.round((b-a)*part/2),end=Math.round((b-a)*(part+1)/2),buf=buffer.subarray(begin,end);
      chip.render(buf,buf.length,.22);
      if(layer){
        const time=(a+begin)/sampleRate,frequency=(regs[0]|regs[1]<<8)*clock/16777216;
        layer.frame({time,frequency,gate:!!(regs[4]&1),envelope:chip.v[0].env,
          noise:!!(regs[18]&0x80)&&!!(regs[18]&1),bar:time*(extension.nativeBpm||120)/240});
        const wet=new Float32Array(buf.length);layer.render(wet);for(let j=0;j<buf.length;j++)buf[j]+=wet[j];
      }
      for(let i=begin;i<end;i++){
        const x=buffer[i],y=x-dx+dcR*dy;dx=x;dy=y;buffer[i]=y;
        if(!Number.isFinite(y))throw Error('Non-finite SID output');
      }
    }
    frame++;
  }
  // Keep native frame boundaries independent of browser/render chunk sizes.
  function read(count){
    if(!Number.isInteger(count)||count<0||count>sampleRate*2)throw Error('SID read must be at most two seconds');
    const out=new Float32Array(count);
    for(let at=0;at<count;){
      if(cursor===buffer.length)nextFrame();
      const n=Math.min(count-at,buffer.length-cursor);out.set(buffer.subarray(cursor,cursor+n),at);cursor+=n;at+=n;
    }
    position+=count;return out;
  }
  return{info,sampleRate,read,get position(){return position;},report:()=>({
    model:selected,synthesis:info.registerDriver&&selected==='10582'?'native 6502-driven 10582':layer?'native SID core + custom 10582 register layer':selected==='10582'?'10582 (traditional three-voice score)':'8580 native three-voice SID',extendedRegisters:layer?.report().registers||[...used].filter(r=>r>=25)})};
}
function render(input,{seconds=600,sampleRate=44100,subtune=1,model='auto',onProgress=()=>{}}={}){
  if(!Number.isFinite(seconds)||seconds<(VoiceScore.isScore(input)?0.05:1)||seconds>1200||![22050,44100].includes(sampleRate))throw Error('Choose a supported duration in seconds and sample rate.');
  const engine=createEngine(input,{sampleRate,subtune,model}),info=engine.info,out=new Float32Array(Math.round(seconds*sampleRate));
  let peak=0,energy=0;
  for(let at=0;at<out.length;at+=sampleRate){
    const buf=engine.read(Math.min(sampleRate,out.length-at));out.set(buf,at);
    for(const y of buf){peak=Math.max(peak,Math.abs(y));energy+=y*y;}
    onProgress(at/out.length);
  }
  if(peak<1e-6)throw Error('The SID rendered silence. No WAV was exported.');
  const gain=Math.min(1,.9/peak),fade=Math.min(Math.round(sampleRate*.005),out.length/2);
  for(let i=0;i<out.length;i++)out[i]*=gain*Math.min(1,i/fade,(out.length-1-i)/fade);
  onProgress(1);
  return{samples:out,sampleRate,info,report:{seconds,sampleRate,peak:peak*gain,rms:Math.sqrt(energy/out.length)*gain,gain,
    ...engine.report()}};
}
function wav(samples,sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer),text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,36+samples.length*2,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return buffer;
}
module.exports={inspect,createEngine,render,wav};
