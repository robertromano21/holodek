'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Cpu,header,trace}=require('../tools/analyze-sid-reference.cjs');
function fixture(play=[0x60]) {
  const b=Buffer.alloc(124+2+512);b.write('PSID');b.writeUInt16BE(2,4);b.writeUInt16BE(124,6);
  b.writeUInt16BE(0x1000,10);b.writeUInt16BE(0x1010,12);b.writeUInt16BE(1,14);b.writeUInt16BE(1,16);
  b.writeUInt16BE(8,118);b.writeUInt16LE(0x1000,124);b[126]=0x60;Buffer.from(play).copy(b,126+16);return b;
}
test('PSID parsing respects embedded load address, NTSC and zero-based initialization',()=>{
  const h=header(fixture());assert.equal(h.load,0x1000);assert.equal(h.hz,60);assert.equal(h.clock,'NTSC');
  const b=fixture();b.write('RSID');assert.throws(()=>header(b),/Only PSID/);
  const cia=fixture();cia.writeUInt32BE(1,18);assert.throws(()=>header(cia),/CIA/);
  assert.throws(()=>trace(fixture(),2),/subtune/);
});
test('bounded CPU supports self-modification, carry/overflow, branches, shifts and nested calls',()=>{
  const cpu=new Cpu();cpu.mem.set([0xa9,0x7f,0x18,0x69,1,0x30,2,0xa9,0,0x20,0x20,0x10,0x60],0x1000);
  cpu.mem.set([0x48,0xa9,0x60,0x8d,0x30,0x10,0x68,0x60],0x1020);
  cpu.call(0x1000);assert.equal(cpu.a,128);assert.ok(cpu.p&64);assert.equal(cpu.mem[0x1030],0x60);
  cpu.mem.set([0xa9,0x80,0x18,0x2a,0x6a,0x60],0x1040);cpu.call(0x1040);assert.equal(cpu.a,128);
});
test('tracer distinguishes a stopped cue from a repeating musical driver',()=>{
  const idle=trace(fixture(),1,10);assert.equal(idle.loop,null);assert.ok(idle.stationary.allGatesOff);
  const b=fixture([0xee,0,0x11,0xad,0,0x11,0x8d,0,0xd4,0xa9,0x41,0x8d,4,0xd4,0x60]);
  const moving=trace(b,1,10);assert.equal(moving.stationary,null);assert.ok(moving.loop);
  assert.equal(moving.loop.periodSeconds,256/60);
  assert.ok(moving.voices[0].pitchChangeFrames>250);
});
test('unsupported hardware, decimal operations, opcodes and runaway routines fail explicitly',()=>{
  for(const bytes of [[0xad,0x1b,0xd4,0x60],[0xf8,0x69,1,0x60],[0x02],[0x4c,0,0x10]]) {
    const c=new Cpu();c.mem.set(bytes,0x1000);assert.throws(()=>c.call(0x1000,1000));
  }
});
