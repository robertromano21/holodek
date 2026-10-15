'use strict';
// Private, bounded 64-chip register score. This is not a PSID or sampled audio.
const {MultiSid}=require('./jsid');
const MAGIC='HDKSV001',REGISTER_MAGIC='HDKRG001',HEADER=80,MAX_BYTES=24*1024*1024,MAX_SECONDS=120;
function view(input){return new Uint8Array(input.buffer||input,input.byteOffset||0,input.byteLength);}
function matches(b,magic){return b.length>=8&&[...magic].every((c,i)=>b[i]===c.charCodeAt(0));}
function isScore(input){const b=view(input);return matches(b,MAGIC)||matches(b,REGISTER_MAGIC);}
class Recorder{
  constructor(info){this.info=info;this.parts=[];this.bytes=0;this.events=0;this.rawWrites=0;this.ticks=0;this.last=new Int16Array(4096).fill(-1);}
  tick(writes){
    const kept=[];this.rawWrites+=writes.length;
    for(const [chip,reg,value,cycle]of writes){
      if(!Number.isInteger(chip)||chip<0||chip>=this.info.chips||!Number.isInteger(reg)||reg<0||reg>63||!Number.isInteger(value)||value<0||value>255||cycle>0)throw Error('Unsupported SID voice register write');
      const index=chip*64+reg;
      // TEST resets phase even when unchanged; fast-envelope trigger bits are strobes.
      const strobe=(reg<21&&reg%7===4&&(value&8))||(reg===30&&(value&112));
      if(this.last[index]===value&&!strobe)continue;
      kept.push(index&255,index>>8,value);this.last[index]=reg===30?value&15:value;
    }
    const count=kept.length/3;if(count>65535)throw Error('Too many voice writes in one tick');
    this.events+=count;this.bytes+=2+kept.length;this.ticks++;
    if(this.bytes+HEADER>MAX_BYTES||this.ticks>this.info.hz*MAX_SECONDS)throw Error('SID voice score exceeds its safety budget');
    this.parts.push(Uint8Array.from([count&255,count>>8,...kept]));
  }
  finish(){
    const i=this.info;if(this.ticks!==i.nTicks)throw Error('Incomplete SID voice score');
    const b=new Uint8Array(HEADER+this.bytes),d=new DataView(b.buffer);
    const magic=i.kind?REGISTER_MAGIC:MAGIC;for(let n=0;n<magic.length;n++)b[n]=magic.charCodeAt(n);
    d.setUint16(8,HEADER,true);d.setUint16(10,Number(i.model),true);d.setUint16(12,i.chips,true);d.setUint16(14,i.exact?1:0,true);
    d.setUint32(16,i.sampleRate,true);d.setUint32(20,i.clock,true);d.setUint16(24,i.cut,true);d.setUint16(26,i.hz,true);
    d.setUint32(28,i.nTicks,true);d.setUint32(32,i.samples,true);d.setUint32(36,i.fadeSamples,true);d.setFloat64(40,1,true);d.setFloat64(48,.995,true);
    d.setUint32(56,this.events,true);d.setUint32(60,this.bytes,true);d.setUint32(64,this.rawWrites,true);
    d.setUint16(68,i.kind==='sid-ambience'?2:i.kind==='sid-effect'?1:0,true);
    let at=HEADER;for(const part of this.parts){b.set(part,at);at+=part.length;}return b;
  }
}
function inspect(input){
  const b=view(input);if(!isScore(b)||b.length<HEADER||b.length>MAX_BYTES)throw Error('Invalid SID voice score');
  const d=new DataView(b.buffer,b.byteOffset,b.byteLength),header=d.getUint16(8,true),model=String(d.getUint16(10,true)),chips=d.getUint16(12,true),flags=d.getUint16(14,true);
  const sampleRate=d.getUint32(16,true),clock=d.getUint32(20,true),cut=d.getUint16(24,true),hz=d.getUint16(26,true),nTicks=d.getUint32(28,true),samples=d.getUint32(32,true),fadeSamples=d.getUint32(36,true),gain=d.getFloat64(40,true),dc=d.getFloat64(48,true),events=d.getUint32(56,true),payload=d.getUint32(60,true);
  const role=d.getUint16(68,true),generic=matches(b,REGISTER_MAGIC),kind=generic?(role===1?'sid-effect':role===2?'sid-ambience':null):'sid-voice';
  if(!kind||!generic&&role||header!==HEADER||!['8580','10582'].includes(model)||chips<1||chips>64||flags>1||![22050,44100].includes(sampleRate)||![985248,1970496,3940992].includes(clock)||![1,2,4].includes(cut)||clock!==985248*cut||hz<50||hz>8000||!nTicks||nTicks>MAX_SECONDS*hz||samples!==(flags?Math.round(nTicks*sampleRate/hz):nTicks*Math.round(sampleRate/hz))||samples/sampleRate>MAX_SECONDS||fadeSamples>samples/4||!Number.isFinite(gain)||gain<0||gain>(generic?64:6)||dc!==.995||payload+HEADER!==b.length||b.subarray(70,HEADER).some(x=>x))throw Error('Invalid SID voice score parameters');
  return{kind,title:chips+'-chip SID '+(kind==='sid-voice'?'voice':kind==='sid-ambience'?'ambience':'effect'),model,chips,sampleRate,clock,cut,hz,nTicks,samples,fadeSamples,gain,dc,events,exact:!!flags,seconds:samples/sampleRate,bytes:b.length,rawWrites:d.getUint32(64,true)};
}
function withGain(input,gain){const b=view(input).slice();new DataView(b.buffer).setFloat64(40,gain,true);inspect(b);return b;}
function createEngine(input,{sampleRate=44100,model='auto'}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw Error('Unsupported sample rate');
  const b=view(input),info=inspect(b),selected=model==='auto'?info.model:model;
  if(!['8580','10582'].includes(selected))throw Error('Choose 8580 or 10582 playback');
  const d=new DataView(b.buffer,b.byteOffset,b.byteLength),offsets=new Uint32Array(info.nTicks+1);let at=HEADER,events=0;
  for(let tick=0;tick<info.nTicks;tick++){
    if(at+2>b.length)throw Error('Truncated SID voice tick');offsets[tick]=at;
    const count=d.getUint16(at,true);at+=2;if(at+count*3>b.length)throw Error('Truncated SID voice registers');events+=count;
    for(let n=0;n<count;n++,at+=3)if(d.getUint16(at,true)>=info.chips*64)throw Error('SID voice chip index out of range');
  }
  if(at!==b.length||events!==info.events)throw Error('SID voice event count mismatch');offsets[info.nTicks]=at;
  // Preserve the original tick-sized envelope/filter updates, independent of device chunks.
  const bank=new MultiSid(info.chips,info.sampleRate,{clk:info.clock,cut:info.cut,model:selected==='10582'?'10582':undefined});
  let tick=0,cursor=0,frame=new Float32Array(0),nativePosition=0,position=0,dx=0,dy=0;
  const edge=n=>info.exact?Math.round(n*info.sampleRate/info.hz):n*Math.round(info.sampleRate/info.hz),g=.5/Math.sqrt(info.chips);
  function nativeSample(){
    if(nativePosition>=info.samples)return 0;
    if(cursor===frame.length){
      let offset=offsets[tick],count=d.getUint16(offset,true);offset+=2;
      for(let n=0;n<count;n++,offset+=3){const index=d.getUint16(offset,true);bank.write(index>>6,index&63,b[offset+2]);}
      frame=new Float32Array(edge(tick+1)-edge(tick));for(const chip of bank.chips)chip.render(frame,frame.length,g);cursor=0;tick++;
    }
    const raw=frame[cursor++],filtered=raw-dx+info.dc*dy;dx=raw;dy=filtered;
    let value=Math.fround(filtered),fade=info.fadeSamples;
    if(fade){const k=Math.min(nativePosition,info.samples-1-nativePosition);if(k<fade)value=Math.fround(value*Math.sin(Math.PI/2*k/fade)**2);}
    nativePosition++;return value*info.gain;
  }
  const total=Math.round(info.samples*sampleRate/info.sampleRate),ratio=info.sampleRate/sampleRate,radius=16,ring=new Float32Array(512);
  let generated=-1;
  const source=index=>{if(index<0||index>=info.samples)return 0;while(generated<index){generated++;ring[generated%ring.length]=nativeSample();}return ring[index%ring.length];};
  // Windowed-sinc conversion keeps the existing synthesis rate and chip state intact.
  const phases=1024,kernels=[];
  if(sampleRate!==info.sampleRate)for(let phase=0;phase<phases;phase++){
    const f=phase/phases,kernel=new Float64Array(radius*2),cutoff=Math.min(1,sampleRate/info.sampleRate)*.96;let sum=0;
    for(let k=0;k<kernel.length;k++){const x=k-radius+1-f,z=Math.PI*x*cutoff;kernel[k]=(Math.abs(z)<1e-12?1:Math.sin(z)/z)*(.5+.5*Math.cos(Math.PI*x/radius))*cutoff;sum+=kernel[k];}
    for(let k=0;k<kernel.length;k++)kernel[k]/=sum;kernels.push(kernel);
  }
  function read(count){
    if(!Number.isInteger(count)||count<0||count>sampleRate*2)throw Error('SID voice read must be at most two seconds');
    const out=new Float32Array(count);
    for(let n=0;n<count;n++,position++){
      if(position>=total)continue;
      if(sampleRate===info.sampleRate)out[n]=nativeSample();
      else{const p=position*ratio,base=Math.floor(p),kernel=kernels[Math.min(phases-1,Math.floor((p-base)*phases))];let value=0;
        for(let k=0;k<kernel.length;k++)value+=source(base+k-radius+1)*kernel[k];out[n]=value;}
      if(!Number.isFinite(out[n]))throw Error('Non-finite SID voice output');
    }return out;
  }
  function restartLoop(){tick=cursor=nativePosition=position=0;frame=new Float32Array(0);generated=-1;ring.fill(0);}
  return{info,sampleRate,read,restartLoop,get position(){return position;},report:()=>({model:selected,synthesis:info.chips+' live SID chips; register score only',chips:info.chips,registerHz:info.hz,events:info.events,sourceAudio:false})};
}
module.exports={MAGIC,REGISTER_MAGIC,Recorder,isScore,inspect,withGain,createEngine};
