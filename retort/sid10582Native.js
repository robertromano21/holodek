'use strict';
const Assembler=require('./sidAssembler'),Format=require('./sidExportFormat'),Extended=require('./sid10582');
function pack(assembly,reference){
  const built=Assembler.assemble(assembly),hdr=Buffer.from(reference.subarray(0,118));
  hdr.writeUInt16BE(1,4);hdr.writeUInt16BE(118,6);hdr.writeUInt16BE(0,8);
  hdr.writeUInt16BE(built.symbols.Init,10);hdr.writeUInt16BE(built.symbols.Play,12);
  const timing=reference.toString('ascii',86,118).match(/;sec=[\d.]+/)?.[0]||'';
  hdr.fill(0,86,118);hdr.write('HDK10582N'+timing,86,31,'ascii');
  const load=Buffer.alloc(2);load.writeUInt16LE(built.loadAddress);
  if(built.loadAddress+built.data.length>=0xa000)throw Error('Native 10582 program exceeds safe SID RAM');
  return Buffer.concat([hdr,load,built.data]);
}
function compile(source,reference,palette){
  Extended.validate(palette);const q=Extended.PROFILES[palette.profile];
  let asm=source.replace('  JSR DoTick','  JSR DoTick\n  JSR HdkTick')
    .replace('RealInit:\n','RealInit:\n  PHA\n  JSR HdkInit\n  PLA\n');
  // SID control/frequency registers are write-only; shadow actual driver writes
  // in RAM rather than reading the hardware back as if it were ordinary RAM.
  for(const [name,shadow]of [['V0_FHI','HdkHi'],['V0_CTRL','HdkGate']])asm=asm.replace(new RegExp('STA '+name+'\\b','g'),'STA '+name+'\n  STA '+shadow);
  const max=Math.max(1,Math.round(q.level*palette.depth)),values=Array.from({length:256},(_,n)=>Math.round(Math.max(150,Math.min(7000,n*256*985248/16777216*q.ratio+q.center))));
  const writes=entries=>entries.map(([r,v])=>'  LDA #'+v+'\n  STA $'+(0xd400+r).toString(16)).join('\n');
  asm+='\n; Native 10582 controller: real 6502 writes to the extended register bank.\nHdkInit:\n'+writes([
    [25,255],[26,255],[27,255],[28,0],[30,0],[31,palette.profile==='ember_air'?5:1],[34,Math.round(q.width/4)],[35,0],[36,0]])+
    '\n  LDA #0\n  STA HdkLevel\n  STA HdkHi\n  STA HdkGate\n  RTS\n'+`
HdkTick:
  LDX HdkHi
  LDA HdkCenterLo,x
  STA $d420
  LDA HdkCenterHi,x
  STA $d421
  LDA HdkGate
  AND #1
  BEQ HdkRelease
  LDA HdkLevel
  CMP #${max}
  BCS HdkLevelReady
  INC HdkLevel
  JMP HdkLevelReady
HdkRelease:
  LDA HdkLevel
  BEQ HdkLevelReady
  DEC HdkLevel
HdkLevelReady:
  LDA HdkLevel
  STA $d423
  RTS
HdkHi: .byte 0
HdkGate: .byte 0
HdkLevel: .byte 0
HdkCenterLo: .byte ${values.map(n=>n&255).join(',')}
HdkCenterHi: .byte ${values.map(n=>n>>8).join(',')}
`;
  if(!asm.includes('JSR HdkTick')||!asm.includes('JSR HdkInit'))throw Error('Unrecognized native SID player source');
  return{assembly:asm,sid:pack(asm,reference)};
}
function proof(reference){
  const writes=entries=>entries.map(([r,v])=>'  LDA #'+v+'\n  STA $'+(0xd400+r).toString(16)).join('\n');
  const asm='* = $1000\nInit:\n  JMP Setup\nPlay:\n  RTS\nSetup:\n'+writes([
    [0,163],[1,14],[4,32],[5,0],[6,0],[24,15],
    [25,255],[26,255],[27,255],[28,7],[31,1],[32,108],[33,7],[34,35],[35,60],[36,0]
  ])+'\n  RTS\n';
  const sid=pack(asm,reference);sid.fill(0,22,54);sid.write('10582 register-only proof',22,'ascii');sid.writeUInt16BE(1,14);
  return{assembly:asm,sid};
}
module.exports={compile,proof,pack};
