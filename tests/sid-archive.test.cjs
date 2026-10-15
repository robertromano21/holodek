'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const Archive=require('../retort/sidArchive'),Assembler=require('../retort/sidAssembler'),Converter=require('../retort/sidToWav'),Format=require('../retort/sidExportFormat');
const {header,trace}=require('../tools/analyze-sid-reference.cjs'),{waveStats}=require('../tools/analyze-room-music.cjs');
const Composition=require('../retort/sidComposition'),Theory=require('../retort/sidMusicTheory'),plan=require('./fixtures/sid-leaving-threshold.json');
const score=()=>Theory.arrangeSuite(Composition.develop(plan),'test','archive-fixture');
test('bundled assembler emits known 6502 bytes, resolves labels, and rejects invalid source',()=>{
  const a=Assembler.assemble('* = $1000\nptr=$f1\nInit: LDA #<target\nSTA ptr\nLDA (ptr),Y\nBNE target\ntarget: RTS');
  assert.deepEqual([...a.data],[0xa9,0x08,0x85,0xf1,0xb1,0xf1,0xd0,0,0x60]);
  for(const source of ['* = $1000\nFOO #1','* = $1000\nLDA #missing','* = $1000\n.byte $100','* = $1000\nJMP x\n* = $1001\nx: RTS'])assert.throws(()=>Assembler.assemble(source));
});
test('archive keeps two real SID files, source, standalone converter, checksums and stable identity',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sid-archive-'));
  try{
    const song=score(),before=JSON.stringify(song),a=Archive.record(song,{roomKey:'0,0,0'},dir);
    for(const file of ['8580.sid','10582.sid','score.json','song.asm','song_sid.asm','manifest.json','README.txt'])assert.ok(fs.existsSync(path.join(a.directory,file)));
    const classic=fs.readFileSync(path.join(a.directory,'8580.sid')),extended=fs.readFileSync(path.join(a.directory,'10582.sid'));
    assert.ok(classic.length>500);assert.notDeepEqual(classic,extended);assert.deepEqual(Buffer.from(Format.split(extended).core),classic);
    assert.equal(header(classic).title,song.title);assert.equal(trace(classic,1,2).secondsTraced,2);
    const again=Archive.record({...song,archive:{id:a.id}}, {},dir);assert.equal(again.id,a.id);
    assert.equal(JSON.stringify(song),before);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'))).length,1);
    const different=Archive.record({...song,title:'A different composition'}, {},dir);assert.notEqual(a.id,different.id);
    const html=fs.readFileSync(Archive.installTool(dir),'utf8');assert.ok(!html.includes('/*SID_WORKER_BUNDLE*/'));assert.ok(!/<script[^>]+src=/.test(html));
    const outputs=[],context={TextDecoder,TextEncoder,DataView,Uint8Array,Float32Array,Float64Array,Uint32Array,ArrayBuffer,Map,Set,Math,Date,Object,JSON,
      self:{postMessage:value=>outputs.push(value)}};
    vm.runInNewContext(Archive.workerBundle(),context);
    context.self.onmessage({data:{action:'inspect',bytes:extended}});assert.equal(outputs.at(-1).info.extension.format,'holodek-10582');
    context.self.onmessage({data:{action:'render',bytes:extended,seconds:1,sampleRate:22050,subtune:1}});
    assert.ok(outputs.at(-1).wav);assert.equal(waveStats(Buffer.from(outputs.at(-1).wav)).clippedSamples,0);
    const x=Converter.render(classic,{seconds:12,sampleRate:22050}),y=Converter.render(extended,{seconds:12,sampleRate:22050});
    assert.equal(x.samples.length,y.samples.length);assert.ok(y.report.extendedRegisters.includes(35));assert.notDeepEqual(x.samples,y.samples);
    assert.equal(waveStats(Buffer.from(Converter.wav(y.samples,y.sampleRate))).clippedSamples,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('converter rejects bad files, unsupported durations and malformed extension metadata',()=>{
  assert.throws(()=>Converter.inspect(new Uint8Array(200)),/PSID/);
  assert.throws(()=>Converter.render(new Uint8Array(),{seconds:Infinity}),/seconds/);
  assert.throws(()=>Format.split(new TextEncoder().encode('bad payloadHDK10582')),/length/);
});
