'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Native=require('../retort/sid10582Native'),Archive=require('../retort/sidArchive'),{header,Cpu}=require('../tools/analyze-sid-reference.cjs');
const Theory=require('../retort/sidMusicTheory'),Composition=require('../retort/sidComposition');
function writes(bytes,frames){
  const h=header(bytes),cpu=new Cpu(),events=[],perFrame=[];cpu.mem.set(h.data,h.load);
  cpu.onWrite=(address,value)=>{if(address>=0xd400&&address<0xd440)events.push([address,value]);};
  cpu.call(h.init,20000);perFrame.push(events.splice(0));
  for(let i=0;i<frames;i++){cpu.call(h.play,20000);perFrame.push(events.splice(0));}return perFrame;
}
test('native room export executes extended writes in 6502 and preserves the classic driver register sequence',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sid-native-'));
  try{
    const song=Theory.arrangeSuite(Composition.develop(require('./fixtures/sid-leaving-threshold.json')),'temple','native-assert');
    const archive=Archive.record(song,{},directory),core=fs.readFileSync(path.join(archive.directory,'8580.sid'));
    const result=Native.compile(fs.readFileSync(path.join(archive.directory,'song_sid.asm'),'utf8').replace(/\r\n/g,'\n'),core,archive.manifest.palette);
    const old=writes(core,500),enhanced=writes(result.sid,500);
    assert.deepEqual(enhanced.map(frame=>frame.filter(([r])=>r<=0xd418)),old.map(frame=>frame.filter(([r])=>r<=0xd418)));
    assert.ok(enhanced.flat().some(([r,v])=>r===0xd423&&v>0));
    assert.ok(new Set(enhanced.flat().filter(([r])=>r===0xd420).map(([,v])=>v)).size>3);
    assert.ok(!result.sid.includes(Buffer.from('"palette"')));assert.ok(!result.sid.includes(Buffer.from('RIFF')));
    assert.match(result.assembly,/STA HdkHi/);assert.ok(!/LDA \$d40[014]/i.test(result.assembly));
    const proof=Native.proof(core),proofWrites=writes(proof.sid,2).flat();
    for(const address of [0xd41c,0xd41f,0xd420,0xd421,0xd422,0xd423])assert.ok(proofWrites.some(([r])=>r===address));
    const converted=require('../retort/sidToWav').render(proof.sid,{seconds:2,sampleRate:44100});
    assert.match(converted.report.synthesis,/6502-driven/);assert.ok(converted.report.rms>.001);assert.ok(converted.report.extendedRegisters.includes(35));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
