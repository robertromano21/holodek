'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
for(const [file,count,stdio]of [
  ['retort/sidArchive.js',1,undefined],['assets/renderSid_poke.js',3,['ignore','ignore','inherit']],
  ['retort/renderAudio.js',5,['ignore','ignore','inherit','inherit','inherit']],['retort/sidParallelRender.js',1,['ignore']],
  ['retort/websiteWorkerBootstrap.js',1,undefined],['retort/websiteEngineBundle.js',1,undefined]
])test(file+' hides every runtime child window while retaining its existing output policy',()=>{
  const source=fs.readFileSync(file,'utf8');
  const calls=[...source.matchAll(/\bspawn(?:Sync)?\([^\n]+,\s*(\{[^\n]*\})\)/g)];
  assert.equal(calls.length,count,'Every spawn must have an explicit options object');
  const options=calls.map(match=>vm.runInNewContext('('+match[1]+')',{ROOT:'.',directory:'.',cwd:'.',env:{},timeout:100}));
  for(const option of options)assert.equal(option.windowsHide,true);
  if(stdio)assert.deepEqual(options.map(o=>o.stdio),stdio);
  else for(const option of options)assert.equal(option.encoding,'utf8','Captured compiler/bootstrap diagnostics remain available');
  assert.doesNotMatch(source,/shell\s*:\s*true/);
});
test('the hidden parallel renderer still resolves files and reports launch and exit errors',async()=>{
  const source=fs.readFileSync('retort/sidParallelRender.js','utf8'),start=source.indexOf('function renderOne('),end=source.indexOf('(async () =>',start);
  for(const outcome of ['success','exit','launch']){
    let options;
    const context={Promise,path:require('node:path'),tmpDir:'test-sid',freq:44100,job:{sid:'song.sid'},
      findWav:()=>outcome==='success'?'part.wav':null,
      spawn:(_exe,_args,opts)=>{options=opts;const child=new EventEmitter();queueMicrotask(()=>outcome==='launch'?
        child.emit('error',Error('sidplayfp missing')):child.emit('close',outcome==='success'?0:3));return child;}};
    vm.runInNewContext(source.slice(start,end)+';globalThis.render=renderOne;',context);
    const result=context.render({track:1,seconds:3},0);
    if(outcome==='success')assert.equal(await result,'part.wav');
    else await assert.rejects(result,outcome==='exit'?/failed \(3\)/:/sidplayfp missing/);
    assert.equal(options.windowsHide,true);assert.equal(options.stdio,'ignore');
  }
});
test('legacy gameplay subprocesses also stay hidden without losing Python output capture',()=>{
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  assert.match(source,/exec\('pm2 restart gameServer4', \{ windowsHide: true \},/);
  assert.match(source,/spawn\('python3', \['-c', cleanedCode\], \{ stdio: 'pipe', windowsHide: true \}\)/);
  assert.match(source,/process\.stdout\.on\('data'/);assert.match(source,/process\.stderr\.on\('data'/);
});
