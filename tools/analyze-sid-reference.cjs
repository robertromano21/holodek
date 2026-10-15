'use strict';
// Bounded, offline PSID register tracer. Not a C64 emulator or an audio-quality oracle.
// Rejects RSID, CIA timing, decimal arithmetic, unknown opcodes and SID readback.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const hex = n => '$' + n.toString(16).padStart(4, '0');
function header(b) {
  if(b.length<118||b.toString('ascii',0,4)!=='PSID')throw Error('Only PSID is supported; RSID needs a full C64 emulator.');
  const version=b.readUInt16BE(4),offset=b.readUInt16BE(6);
  if(![1,2].includes(version)||offset<(version===1?118:124)||offset+2>b.length)throw Error('Unsupported/truncated PSID header.');
  const flags=version>=2?b.readUInt16BE(118):0;
  if(flags&3)throw Error('External MUS/PlaySID-specific players are unsupported.');
  const load=b.readUInt16BE(8)||b.readUInt16LE(offset),prefix=b.readUInt16BE(8)?0:2;
  const data=b.subarray(offset+prefix),init=b.readUInt16BE(10)||load,play=b.readUInt16BE(12),songs=b.readUInt16BE(14),speed=b.readUInt32BE(18);
  if(!play||!songs||songs>256||load+data.length>65536||init<load||init>=load+data.length)throw Error('Invalid PSID payload or unsupported IRQ-installed player.');
  if(speed)throw Error('CIA/mixed-speed timing requires a full emulator; refusing a guessed trace.');
  const clock=['unknown','PAL','NTSC','both'][(flags>>2)&3];
  return {version,load,init,play,songs,data,clock,hz:clock==='NTSC'?60:50,
    timingAssumption:clock==='unknown'||clock==='both'?'PAL chosen for ambiguous clock':null,
    title:b.toString('latin1',22,54).split('\0')[0],author:b.toString('latin1',54,86).split('\0')[0],
    released:b.toString('latin1',86,118).split('\0')[0]};
}

const instructions = new Map();
function codes(name, entries) { for(const [code,mode] of entries)instructions.set(code,{name,mode}); }
const familyModes=['ix','zp','imm','abs','iy','zx','ay','ax'];
for(const [row,name]of ['ORA','AND','EOR','ADC','STA','LDA','CMP','SBC'].entries())
  for(const [i,col]of [1,5,9,13,17,21,25,29].entries())if(!(name==='STA'&&col===9))instructions.set(row*32+col,{name,mode:familyModes[i]});
codes('ASL',[[6,'zp'],[10,'acc'],[14,'abs'],[22,'zx'],[30,'ax']]);
codes('ROL',[[38,'zp'],[42,'acc'],[46,'abs'],[54,'zx'],[62,'ax']]);
codes('LSR',[[70,'zp'],[74,'acc'],[78,'abs'],[86,'zx'],[94,'ax']]);
codes('ROR',[[102,'zp'],[106,'acc'],[110,'abs'],[118,'zx'],[126,'ax']]);
codes('STX',[[134,'zp'],[142,'abs'],[150,'zy']]);codes('STY',[[132,'zp'],[140,'abs'],[148,'zx']]);
codes('LDX',[[162,'imm'],[166,'zp'],[174,'abs'],[182,'zy'],[190,'ay']]);
codes('LDY',[[160,'imm'],[164,'zp'],[172,'abs'],[180,'zx'],[188,'ax']]);
codes('CPX',[[224,'imm'],[228,'zp'],[236,'abs']]);codes('CPY',[[192,'imm'],[196,'zp'],[204,'abs']]);
codes('DEC',[[198,'zp'],[206,'abs'],[214,'zx'],[222,'ax']]);codes('INC',[[230,'zp'],[238,'abs'],[246,'zx'],[254,'ax']]);
codes('BIT',[[36,'zp'],[44,'abs']]);
class Cpu {
  constructor() { this.mem=new Uint8Array(65536);this.mem[0]=0x2f;this.mem[1]=0x37;this.a=this.x=this.y=0;this.p=0x24;this.sp=255;this.pc=0;this.onWrite=()=>{}; }
  read(a) {
    a&=65535;
    if(a>=0xd41b&&a<=0xd41c)throw Error('SID oscillator/envelope readback needs a full emulator.');
    return this.mem[a];
  }
  write(a,v) {a&=65535;v&=255;this.mem[a]=v;this.onWrite(a,v);}
  byte(){const n=this.read(this.pc);this.pc=(this.pc+1)&65535;return n;}
  word(){const lo=this.byte();return lo|(this.byte()<<8);}
  nz(v){v&=255;this.p=(this.p&~130)|(v===0?2:0)|(v&128);return v;}
  flag(bit,set){this.p=set?this.p|bit:this.p&~bit;}
  push(v){this.write(256+this.sp,v);this.sp=(this.sp-1)&255;}
  pop(){this.sp=(this.sp+1)&255;return this.read(256+this.sp);}
  address(mode){
    let n;
    switch(mode){
      case'imm':return this.pc++;
      case'zp':return this.byte();case'zx':return(this.byte()+this.x)&255;case'zy':return(this.byte()+this.y)&255;
      case'abs':return this.word();case'ax':return(this.word()+this.x)&65535;case'ay':return(this.word()+this.y)&65535;
      case'ix':n=(this.byte()+this.x)&255;return this.read(n)|(this.read((n+1)&255)<<8);
      case'iy':n=this.byte();return((this.read(n)|(this.read((n+1)&255)<<8))+this.y)&65535;
      default:throw Error('Unknown addressing mode.');
    }
  }
  compare(a,b){this.flag(1,a>=b);this.nz(a-b);}
  add(v,subtract=false){
    if(this.p&8)throw Error('Decimal ADC/SBC is intentionally unsupported.');
    const b=subtract?v^255:v,a=this.a,n=a+b+(this.p&1);
    this.flag(64,(~(a^b)&(a^n)&128)!==0);this.flag(1,n>255);this.a=this.nz(n);
  }
  step(){
    const at=this.pc,op=this.byte();
    if((op&31)===16){const bits=[128,64,1,2],bit=bits[op>>6],want=!!(op&32),n=this.byte();if(!!(this.p&bit)===want)this.pc=(this.pc+(n<128?n:n-256))&65535;return;}
    switch(op){
      case 0x20:{const target=this.word(),ret=(this.pc-1)&65535;this.push(ret>>8);this.push(ret);this.pc=target;return;}
      case 0x60:{const lo=this.pop();this.pc=((lo|(this.pop()<<8))+1)&65535;return;}
      case 0x4c:this.pc=this.word();return;
      case 0x6c:{const a=this.word();this.pc=this.read(a)|(this.read((a&0xff00)|((a+1)&255))<<8);return;}
      case 0x48:this.push(this.a);return;case 0x68:this.a=this.nz(this.pop());return;
      case 0x08:this.push(this.p|0x30);return;case 0x28:this.p=(this.pop()&~16)|32;return;
      case 0x18:this.flag(1,false);return;case 0x38:this.flag(1,true);return;
      case 0x58:this.flag(4,false);return;case 0x78:this.flag(4,true);return;
      case 0xb8:this.flag(64,false);return;case 0xd8:this.flag(8,false);return;case 0xf8:this.flag(8,true);return;
      case 0xaa:this.x=this.nz(this.a);return;case 0xa8:this.y=this.nz(this.a);return;
      case 0x8a:this.a=this.nz(this.x);return;case 0x98:this.a=this.nz(this.y);return;
      case 0xba:this.x=this.nz(this.sp);return;case 0x9a:this.sp=this.x;return;
      case 0xe8:this.x=this.nz(this.x+1);return;case 0xc8:this.y=this.nz(this.y+1);return;
      case 0xca:this.x=this.nz(this.x-1);return;case 0x88:this.y=this.nz(this.y-1);return;
      case 0xea:return;
    }
    const instruction=instructions.get(op);if(!instruction)throw Error('Unsupported opcode '+hex(op)+' at '+hex(at));
    const {name,mode}=instruction,a=mode==='acc'?null:this.address(mode),v=mode==='acc'?this.a:name.startsWith('ST')?0:this.read(a);
    const put=n=>{const value=this.nz(n);if(a===null)this.a=value;else this.write(a,value);};
    switch(name){
      case'LDA':this.a=this.nz(v);break;case'LDX':this.x=this.nz(v);break;case'LDY':this.y=this.nz(v);break;
      case'STA':this.write(a,this.a);break;case'STX':this.write(a,this.x);break;case'STY':this.write(a,this.y);break;
      case'ORA':this.a=this.nz(this.a|v);break;case'AND':this.a=this.nz(this.a&v);break;case'EOR':this.a=this.nz(this.a^v);break;
      case'ADC':this.add(v);break;case'SBC':this.add(v,true);break;
      case'CMP':this.compare(this.a,v);break;case'CPX':this.compare(this.x,v);break;case'CPY':this.compare(this.y,v);break;
      case'BIT':this.p=(this.p&~194)|(v&192)|((this.a&v)?0:2);break;
      case'INC':put(v+1);break;case'DEC':put(v-1);break;
      case'ASL':this.flag(1,v&128);put(v<<1);break;case'LSR':this.flag(1,v&1);put(v>>1);break;
      case'ROL':{const c=this.p&1;this.flag(1,v&128);put((v<<1)|c);break;}
      case'ROR':{const c=this.p&1;this.flag(1,v&1);put((v>>1)|(c<<7));break;}
    }
  }
  call(address,limit=100000){
    this.push(2);this.push(254);this.pc=address;
    let count=0;while(this.pc!==0x2ff){if(++count>limit)throw Error('Instruction budget exceeded.');this.step();}
    return count;
  }
}

function trace(b, song=1, seconds=600){
  const h=header(b);if(!Number.isInteger(song)||song<1||song>h.songs||!Number.isFinite(seconds)||seconds<1||seconds>600)throw Error('Invalid subtune/duration.');
  const started=Date.now(),cpu=new Cpu();cpu.mem.set(h.data,h.load);cpu.a=song-1;cpu.call(h.init);
  const regs=cpu.mem.slice(0xd400,0xd419),writes=new Uint32Array(25),states=new Map();
  const voices=Array.from({length:3},()=>({gateOns:0,lastOn:null,intervals:new Map(),waveforms:new Set(),adsr:new Set(),pulseChanges:0,pitchChanges:0,gateFrames:0,
    pitches:new Set(),pitchClasses:Array(12).fill(0),lastAttackPitch:null,attackIntervals:[]}));
  let frame=0,loop=null,maxInstructions=0,last=new Uint8Array(25),filterChanges=0,lastVoiceChange=0,stationary=null;
  const sections=[];
  cpu.onWrite=(a,v)=>{if(a>=0xd400&&a<=0xd418){regs[a-0xd400]=v;writes[a-0xd400]++;}};
  for(;frame<seconds*h.hz;frame++){
    if(frame%64===0&&Date.now()-started>15000)throw Error('Reference trace time budget exceeded; use a full SID player.');
    const ons=[false,false,false];
    cpu.onWrite=(a,v)=>{if(a<0xd400||a>0xd418)return;const r=a-0xd400,vi=(r/7)|0;
      if(vi<3&&r%7===4&&(v&1)&&!(regs[r]&1))ons[vi]=true;
      regs[r]=v;writes[r]++;
    };
    maxInstructions=Math.max(maxInstructions,cpu.call(h.play));
    let activity=0;
    voices.forEach((voice,i)=>{
      const r=i*7,wave=regs[r+4]&0xf0,gate=regs[r+4]&1;
      if(wave&&gate){voice.waveforms.add(hex(wave));voice.adsr.add(hex((regs[r+5]<<8)|regs[r+6]));}
      if(gate&&wave){voice.gateFrames++;activity++;}
      const word=regs[r]|(regs[r+1]<<8),hz=word*(h.clock==='NTSC'?1022727:985248)/16777216;
      const pitch=hz>20&&hz<12000?Math.round(69+12*Math.log2(hz/440)):null;
      if(gate&&wave&&!(wave&128)&&pitch!==null){voice.pitches.add(pitch);voice.pitchClasses[((pitch%12)+12)%12]++;
        if(ons[i]){if(voice.lastAttackPitch!==null)voice.attackIntervals.push(Math.abs(pitch-voice.lastAttackPitch));voice.lastAttackPitch=pitch;}}
      if(regs[r]!==last[r]||regs[r+1]!==last[r+1])voice.pitchChanges++;
      if(regs[r+2]!==last[r+2]||regs[r+3]!==last[r+3])voice.pulseChanges++;
      if(ons[i]){voice.gateOns++;if(voice.lastOn!==null){const n=frame-voice.lastOn;voice.intervals.set(n,(voice.intervals.get(n)||0)+1);}voice.lastOn=frame;}
    });
    if([21,22,23,24].some(r=>regs[r]!==last[r]))filterChanges++;
    if(ons.some(Boolean)||[...regs.subarray(0,21)].some((v,r)=>v!==last[r]))lastVoiceChange=frame;
    const block=Math.floor(frame/h.hz/10);sections[block]??={fromSeconds:block*10,gateFrames:0,attacks:0};
    sections[block].gateFrames+=activity;sections[block].attacks+=ons.filter(Boolean).length;
    last.set(regs);
    const key=createHash('sha256').update(cpu.mem).update(Buffer.from([cpu.a,cpu.x,cpu.y,cpu.p,cpu.sp])).digest('hex');
    const before=states.get(key);
    if(before!==undefined&&(lastVoiceChange>before&&frame-before>=h.hz/4||frame-before>=h.hz*5)){
      if(lastVoiceChange<=before)stationary={sinceSeconds:(before+1)/h.hz,allGatesOff:[4,11,18].every(r=>!(regs[r]&1)),
        evidence:'unchanging traced RAM/CPU and voice registers for five seconds; not a five-second musical loop'};
      else loop={startsAtSeconds:(before+1)/h.hz,periodSeconds:(frame-before)/h.hz,evidence:'repeated complete traced RAM/CPU state, excluding SID oscillator/envelope state'};
      break;
    }
    if(before===undefined)states.set(key,frame);
  }
  const count=frame<seconds*h.hz?frame+1:frame;
  return {subtune:song,secondsTraced:count/h.hz,loop,stationary,maxInstructionsPerPlayCall:maxInstructions,
    voices:voices.map(v=>({gateOns:v.gateOns,gateDutyFraction:v.gateFrames/count,pitchChangeFrames:v.pitchChanges,pulseChangeFrames:v.pulseChanges,
      waveforms:[...v.waveforms],adsrPairs:[...v.adsr],commonGateIntervalsFrames:[...v.intervals].sort((a,b)=>b[1]-a[1]).slice(0,8),
      estimatedPitchRangeMidi:v.pitches.size?[Math.min(...v.pitches),Math.max(...v.pitches)]:null,
      pitchClassGateFrames:v.pitchClasses,
      stepwiseAttackFraction:v.attackIntervals.length?v.attackIntervals.filter(n=>n<=2).length/v.attackIntervals.length:null})),
    filterChangeFrames:filterChanges,registerWrites:[...writes],tenSecondActivity:sections};
}
function analyze(file, seconds=600){
  const b=fs.readFileSync(file),{data,...h}=header(b);
  return {file,sha256:createHash('sha256').update(b).digest('hex'),...h,
    subtunes:Array.from({length:h.songs},(_,i)=>trace(b,i+1,seconds)),
    limitations:'Offline instruction/register trace, not cycle-exact emulation or listening. No ROM/CIA/VIC emulation; unsupported operations fail. Gate attacks and pitch changes are not necessarily musical notes. Loop evidence describes the driver, not analog phase.'};
}
if(require.main===module)for(const file of process.argv.slice(2))console.log(JSON.stringify(analyze(file),null,2));
module.exports={header,Cpu,trace,analyze};
