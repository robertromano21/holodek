'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Chip } = require('../retort/sidVoice/jsid');

function setup(model, wave, filtered = false) {
  const chip = new Chip(44100, { model, aa: true });
  for (let i=0;i<3;i++) {
    const base=i*7, freq=4000+i*1900;
    for(const [reg,value]of [[0,freq&255],[1,freq>>8],[2,0],[3,5],[5,9],[6,0x84],[4,wave|1]])chip.write(base+reg,value);
  }
  chip.write(21,0);chip.write(22,100);chip.write(23,filtered?0x67:0);chip.write(24,filtered?0x1f:15);
  return chip;
}
function render(chip) {
  const samples=new Float32Array(4410);
  for(let p=0;p<samples.length;p+=441)chip.render(samples.subarray(p,p+441),441,.25);
  return samples;
}
test('10582 preserves stock-register oscillator/filter output apart from documented mixer DC bias', () => {
  for(const wave of [0x10,0x20,0x40,0x80])for(const filtered of [false,true]) {
    const stock=setup('8580',wave,filtered),extended=setup('10582',wave,filtered);
    assert.deepEqual(Array.from(extended.r.slice(25,28)),[255,255,255]);
    const a=render(stock),b=render(extended),bias=stock.dc*.25;
    assert.ok(a.every((n,i)=>Math.abs(n-b[i]-bias)<1e-6));
  }
});
test('10582 extra voice-level and mute registers do not need changes to legacy music data', () => {
  const muted=setup('10582',0x40);muted.write(28,7);
  assert.ok(render(muted).every(n=>n===0));
  const levels=setup('10582',0x40);[25,26,27].forEach(reg=>levels.write(reg,0));
  assert.ok(render(levels).every(n=>n===0));
  const stock=setup('8580',0x40);stock.write(28,7);
  assert.ok(render(stock).some(n=>Math.abs(n)>.01));
});
