'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{createHash}=require('node:crypto');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function prefix(file,marker,names){
  const native=createRequire(file),code=fs.readFileSync(file,'utf8');
  return vm.runInNewContext(code.slice(0,code.indexOf(marker))+'\n({'+names.join(',')+'});',{
    require:native,__dirname:path.dirname(file),console,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,structuredClone,process,Buffer,
    fetch,Response,AbortController,AbortSignal,URL});
}
function load(file,overrides={}){
  const native=createRequire(file),module={exports:{}};
  vm.runInThisContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(
    name=>Object.hasOwn(overrides,name)?overrides[name]:native(name),module,module.exports,path.dirname(file));
  return module.exports;
}

test('closing adjacent construction cancels running and queued rooms and prevents redispatch',async t=>{
  const {setup,wait}=prefix(require.resolve('./room-build-pool.test.cjs'),"test('remote pool",['setup','wait']);
  const f=setup(t);f.queue(['north','east','south','west']);await wait(()=>f.workers.length===3);
  const joined=f.service.join('0,1,0');await f.service.close();await joined;await tick();
  assert.ok(f.workers.every(w=>w.terminated===1));assert.ok(f.service.status().every(j=>j.phase==='cancelled'));
  assert.equal(f.queue(['north','east']).length,0);f.service._reset();await tick();assert.equal(f.workers.length,3);
});

test('PC model shutdown aborts the active request and rejects queued/new requests without stopping Ollama',async()=>{
  let calls=0,activeSignal;
  const host=require('../retort/pcModelHost').createHost({fetchImpl:async(_url,options)=>{
    calls++;activeSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  }});
  const request={model:'holodek-1',messages:[{role:'user',content:'Offline test'}]};
  const a=host.complete(request).catch(error=>error),b=host.complete(request).catch(error=>error);
  await tick();await host.close();assert.equal(calls,1);assert.equal(activeSignal.aborted,true);
  assert.match((await a).message,/cancelled/);assert.match((await b).message,/cancelled/);
  await assert.rejects(host.complete(request),/cancelled/);assert.equal(calls,1);
});

test('website shutdown cancels owned cloud jobs and leaves saved helper connection settings enabled',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-shutdown-web-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const W=require('../retort/websiteAi'),bytes=Buffer.from('offline shutdown host pin'),fingerprint='SHA256:'+createHash('sha256').update(bytes).digest('base64').replace(/=+$/,'');
  const packets=[];let submitted;
  const submittedPromise=new Promise(resolve=>{submitted=resolve;});
  const run=async(exe,args,options={})=>{
    if(exe.includes('ssh-keygen')){const file=args[args.indexOf('-f')+1];fs.writeFileSync(file,'offline');fs.writeFileSync(file+'.pub','ssh-ed25519 offline');return '';}
    if(exe.includes('ssh-keyscan'))return 'worker.example.invalid ssh-ed25519 '+bytes.toString('base64');
    if(args.at(-1).includes('node -e'))return JSON.stringify({value:{version:1,port:45678}});
    const packet=JSON.parse(options.input);packets.push(packet.operation);
    if(packet.operation==='status')return JSON.stringify({value:{version:1,port:45678}});
    if(packet.operation==='model-submit'){submitted();return JSON.stringify({value:{id:packet.id,capability:packet.capability,phase:'queued'}});}
    if(packet.operation==='model-poll')return JSON.stringify({value:{phase:'running'}});
    assert.equal(packet.operation,'model-cancel');assert.equal(options.signal.aborted,false,'Cleanup RPC must survive lifetime cancellation');
    return JSON.stringify({value:{accepted:true}});
  };
  const service=W.createService({directory,run,env:{OPENAI_API_KEY:'offline-not-a-real-key'}});
  await service.connect({enabled:true,background:true,useForGameModels:true,host:'worker.example.invalid',username:'holodek-agent',fingerprint},{deploy:true});
  const saved=fs.readFileSync(path.join(directory,'connection.json'),'utf8');
  const job=service.generate({provider:'openai',body:{model:'offline',messages:[{role:'user',content:'Offline'}]}}).catch(error=>error);
  await submittedPromise;await tick();await service.close();assert.match((await job).message,/cancelled|stopped/);
  assert.equal(packets.filter(p=>p==='model-cancel').length,1);
  assert.equal(fs.readFileSync(path.join(directory,'connection.json'),'utf8'),saved);
  assert.equal(service.backgroundEnabled(),false);await assert.rejects(service.generate({provider:'openai',body:{}}),/stopped/);
});

test('voice shutdown cancels warmup, rejects queued synthesis, terminates the worker and cannot restart it',async()=>{
  const workers=[];
  class Worker extends EventEmitter{constructor(){super();workers.push(this);this.terminated=0;}postMessage(){}terminate(){this.terminated++;return Promise.resolve(0);}}
  const voice=load(require.resolve('../retort/sidVoice'),{'worker_threads':{Worker}});
  voice.setProfiles([]);assert.equal(workers.length,1);
  const waiting=voice.scoreFor('Offline Speaker','A sentence.',true).catch(error=>error);
  await voice.close();await waiting;assert.equal(workers[0].terminated,1);
  voice.setProfiles([]);await assert.rejects(voice.scoreFor('Offline Speaker','Another sentence.',true),/stopped/);
  assert.equal(workers.length,1);
});

test('audio shutdown rejects pending renders and does not start another worker',async()=>{
  const workers=[];
  class Worker extends EventEmitter{constructor(){super();workers.push(this);this.terminated=0;}terminate(){this.terminated++;this.emit('exit',1);return Promise.resolve(1);}}
  const audio=load(require.resolve('../retort/audioPalette'),{'node:worker_threads':{Worker},'node:fs':{...fs,existsSync:()=>false,mkdirSync(){}}});
  const [a,b]=require('../retort/sidEffectPalette').names;
  const first=audio.effect(a,1,'1x').catch(e=>e),second=audio.effect(b,1,'1x').catch(e=>e);
  assert.equal(workers.length,1);await audio.close();
  assert.match((await first).message,/stopped/);assert.match((await second).message,/stopped/);
  assert.equal(workers[0].terminated,1);await assert.rejects(audio.effect(a,2,'1x'),/stopped/);assert.equal(workers.length,1);
});

test('an SSH stream output closing aborts its room HTTP request without affecting another stream',async()=>{
  const source=fs.readFileSync(require.resolve('../tools/website-worker/workerPool.cjs'),'utf8');
  const start=source.indexOf('async function stream('),end=source.indexOf('\nmodule.exports',start),signals=[];
  const stream=vm.runInNewContext(source.slice(start,end)+'\nstream;',{
    AbortController,AbortSignal,Buffer,process,route:async(_packet,options)=>{
      signals.push(options.signal);return {ok:true,headers:{get:()=> 'application/x-ndjson'},body:{async *[Symbol.asyncIterator](){
        await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('channel closed')),{once:true}));
      }}};
    }});
  const first=new EventEmitter(),second=new EventEmitter();
  const a=stream({}, {output:first}).catch(error=>error),b=stream({}, {output:second}).catch(error=>error);
  await tick();first.emit('close');assert.match((await a).message,/closed/);
  assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);
  second.emit('error',Error('closed'));await b;
  assert.equal(first.listenerCount('close'),0);assert.equal(second.listenerCount('error'),0);
});

test('real remote room heartbeats make channel closure release only the owned worker slot',{timeout:12000},async t=>{
  const {fixture,write,Wire,ENGINE_HASH,waitFor}=prefix(require.resolve('./website-pool-http.test.cjs'),"test('real three-port",['fixture','write','Wire','ENGINE_HASH','waitFor']);
  const f=await fixture(t),engine=path.join(f.directory,'engines',ENGINE_HASH),Pool=require('../tools/website-worker/workerPool.cjs');
  write(engine,'.installed.json',{hash:ENGINE_HASH,manifestHash:'f'.repeat(64),ready:true});
  write(engine,'retort/remoteRoomWorker.js',"'use strict';setInterval(()=>{},1000);");
  const output=()=>{const stream=new EventEmitter();stream.frames=[];stream.write=bytes=>{stream.frames.push(Buffer.from(bytes).toString('utf8'));return true;};return stream;};
  const a=output(),b=output(),packet=()=>({operation:'room-stage',engineHash:ENGINE_HASH,background:true,
    payload:Wire.pack({job:{id:require('node:crypto').randomUUID(),key:'1,0,0',stage:'geometry'},provider:'ollama',snapshot:{}})});
  const first=f.track(Pool.stream(packet(),{...f.options,output:a})).catch(error=>error);
  const second=f.track(Pool.stream(packet(),{...f.options,output:b})).catch(error=>error);
  await waitFor(()=>a.frames.join('').includes('heartbeat')&&b.frames.join('').includes('heartbeat'),'both SSH streams to receive heartbeats');
  assert.equal((await f.nodes()).reduce((n,node)=>n+node.computeActive,0),2);
  a.emit('close');await first;
  await waitFor(async()=>(await f.nodes()).reduce((n,node)=>n+node.computeActive,0)===1,'only the disconnected room worker to stop');
  assert.equal(f.started.length,0,'No real provider request is needed to test cancellation');
  b.emit('close');await second;
  await waitFor(async()=>(await f.nodes()).every(node=>node.computeActive===0&&node.computeQueued===0),'all owned work to stop');
});
