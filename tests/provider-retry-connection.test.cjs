'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Policy=require('../retort/generationPolicy'),C=require('../retort/generationContracts'),T=require('../retort/modelTransport'),Website=require('../retort/websiteAi');
const originalBackoff=Policy.backoff;test.before(()=>{Policy.backoff=async()=>{};});test.after(()=>{Policy.backoff=originalBackoff;});
const temporary=(t,prefix)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
function transport(id,outcome){let calls=0;const bodies=[];const client={chat:{completions:{create:async body=>{bodies.push(structuredClone(body));return outcome(++calls,body);}}}};
  const models={profile:()=>({id,...(id==='xai-fixture'?{provider:'xai'}:{})}),getClient:()=>client,getXaiClient:()=>client,withSnapshot:fn=>fn()};
  return{client,models,bodies,get calls(){return calls;}};
}
const error=status=>Object.assign(Error('Provider transport failure'),{status});
test('transient HTTP errors are distinct from schema, authentication, quota and cancellation failures',()=>{
  for(const status of [408,429,500,502,503,504])assert.equal(Policy.providerRetry(error(status)),true,status);
  for(const e of [error(400),error(401),error(403),Object.assign(error(429),{code:'insufficient_quota'}),Object.assign(error(429),{error:{code:'credit_balance_exhausted'}}),
    Object.assign(error(500),{name:'AbortError'}),Object.assign(error(503),{recoverable:false}),Object.assign(error(429),{message:'quota'})])assert.equal(Policy.providerRetry(e),false);
  assert.equal(Policy.RETRIES,3);assert.equal(Policy.ATTEMPTS,4);
});
for(const id of ['gpt-6-luna','xai-fixture'])test(id+': plain completions recover on the fourth same-model call and never exceed three retries',async()=>{
  const f=transport(id,n=>{if(n<4)throw error(n===1?500:429);return{choices:[{finish_reason:'stop',message:{content:'Accepted authored answer.'}}]};});
  const value=await T.complete(f.client,{model:id,messages:[{role:'user',content:'Original request'}]},{models:f.models});
  assert.equal(value.choices[0].message.content,'Accepted authored answer.');assert.equal(f.calls,4);assert.ok(f.bodies.every(b=>b.model===id));
  const failed=transport(id,()=>{throw error(503);});await assert.rejects(T.complete(failed.client,{model:id,messages:[]},{models:failed.models}),e=>e.status===503);assert.equal(failed.calls,4);
});
test('streams retry before published content, but never replay text already delivered',async()=>{
  const f=transport('xai-fixture',n=>{if(n<4)throw error(500);return(async function*(){yield{choices:[{delta:{content:'One answer'},finish_reason:'stop'}]};})();});
  let content='';for await(const c of T.stream({model:'xai-fixture'},[],{models:f.models,client:f.client}))content+=c.contentDelta;
  assert.equal(f.calls,4);assert.equal(content,'One answer');
  const partial=transport('xai-fixture',()=> (async function*(){yield{choices:[{delta:{content:'Already visible'}}]};throw error(500);})());
  let visible='';await assert.rejects(async()=>{for await(const c of T.stream({model:'xai-fixture'},[],{models:partial.models,client:partial.client}))visible+=c.contentDelta;},e=>e.status===500);
  assert.equal(partial.calls,1);assert.equal(visible,'Already visible');
});
test('structured Retort ownership shares four attempts, not sixteen nested retries or outage correction prompts',async()=>{
  const f=transport('xai-fixture',()=>{throw error(500);});
  const runtime=require('../retort/gameRetort').createRuntime({models:f.models,client:f.client,log(){}});
  let prompts=0;
  const result=await runtime.run(async agent=>{
    const user=agent.user;agent.user=(...args)=>{prompts++;return user(...args);};
    return C.request(agent,{component:'provider-ownership',parameters:{ready:Boolean}});
  });
  assert.equal(f.calls,4);assert.equal(result.value,null);assert.equal(result.error.status,500);assert.equal(prompts,0);
});
test('schema errors and quota failures are not blindly replayed by plain transport',async()=>{
  for(const failure of [Object.assign(error(400),{code:'invalid_json_schema'}),Object.assign(error(429),{code:'insufficient_quota'})]){
    const f=transport('xai-fixture',()=>{throw failure;});await assert.rejects(T.complete(f.client,{model:'xai-fixture',messages:[]},{models:f.models}),e=>e===failure);assert.equal(f.calls,1);
  }
});
function connection(t,{busy=true,compatible=true,race=false,permanent=false}={}){
  const directory=temporary(t,'website-busy-'),source=path.join(directory,'source');fs.mkdirSync(source);
  const filenames=['worker.cjs','workerPool.cjs','roomTask.cjs','roomWire.cjs'];for(const name of filenames)fs.writeFileSync(path.join(source,name),'// fixture '+name);
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const bundleHash=hash(filenames.map(name=>name+'\n'+fs.readFileSync(path.join(source,name),'utf8')).join('\n'));
  const engineRoot=path.resolve(__dirname,'..'),engineHash=require('../retort/websiteEngineBundle').build(engineRoot).hash;
  const bytes=Buffer.from('offline trusted host'),pin='SHA256:'+crypto.createHash('sha256').update(bytes).digest('base64').replace(/=+$/,'');
  const config={enabled:true,host:'worker.example.invalid',username:'holodek-agent',sshPort:22,fingerprint:pin,background:true,useForGameModels:true,remoteBuild:true};
  fs.writeFileSync(path.join(directory,'identity_ed25519'),'offline fixture');fs.writeFileSync(path.join(directory,'identity_ed25519.pub'),'ssh-ed25519 fixture');
  fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify(config));
  let time=0,statusCalls=0,installs=0,bootstraps=0;const logs=[];
  const status=(active,match)=>({version:1,port:45678,roomWorkers:3,bundleHash,engineHash:match?engineHash:'b'.repeat(64),active:0,queued:0,
    pool:[0,1,2].map(slot=>({slot,node:'v24.0.0',bundleHash,engineHash:match?engineHash:'b'.repeat(64),computeActive:slot===2&&active?1:0,computeQueued:0,active:0,queued:0}))});
  const run=async(exe,args,options={})=>{
    if(exe.includes('ssh-keyscan'))return'worker.example.invalid ssh-ed25519 '+bytes.toString('base64');
    if(args.at(-1).includes('--rpc')){statusCalls++;return JSON.stringify({value:status(busy&&(permanent||time===0),compatible)});}
    const packet=JSON.parse(options.input);
    if(packet.archive){installs++;return JSON.stringify({value:{hash:packet.hash,ready:true}});}
    bootstraps++;if(race&&bootstraps===1)return JSON.stringify({error:'Worker deployment deferred until current jobs finish.'});
    return JSON.stringify({value:status(false,true)});
  };
  const service=Website.createService({directory,source:path.join(source,'worker.cjs'),engineRoot,run,connectionWaitMs:2000,now:()=>time,
    delay:async ms=>{time+=ms;},logger:{info:(...row)=>logs.push(row)}});
  return{config,service,logs,get statusCalls(){return statusCalls;},get installs(){return installs;},get bootstraps(){return bootstraps;},get elapsed(){return time;}};
}
test('a pinned compatible three-worker pool is reused while busy, without any installation or restart',async t=>{
  const f=connection(t);const result=await f.service.connect(f.config,{deploy:true});
  assert.equal(result.connected,true);assert.equal(f.statusCalls,1);assert.equal(f.installs,0);assert.equal(f.bootstraps,0);assert.equal(f.elapsed,0);
  assert.ok(JSON.stringify(f.logs).includes('reused-compatible'));
});
test('concurrent startup calls join one connection verification instead of deploying twice',async t=>{
  const f=connection(t);await Promise.all([f.service.ensureConnected(),f.service.ensureConnected()]);
  assert.equal(f.statusCalls,1);assert.equal(f.installs,0);assert.equal(f.bootstraps,0);
});
test('incompatible busy helpers are left untouched until idle, then deployed with matching versions',async t=>{
  const f=connection(t,{compatible:false});const result=await f.service.connect(f.config,{deploy:true});
  assert.equal(result.connected,true);assert.equal(f.elapsed,1000);assert.equal(f.installs,1);assert.equal(f.bootstraps,1);assert.equal(f.statusCalls,2);
  assert.ok(JSON.stringify(f.logs).includes('waiting-idle'));
});
test('persistent busy mismatch ends with an explicit bounded deferred result, never worker replacement',async t=>{
  const f=connection(t,{compatible:false,permanent:true});await assert.rejects(f.service.connect(f.config,{deploy:true}),e=>e.code==='WEBSITE_DEPLOY_BUSY'&&e.recoverable===false);
  assert.equal(f.elapsed,2000);assert.equal(f.installs,0);assert.equal(f.bootstraps,0);assert.equal(f.service.view().connecting,false);
});
test('a status-only cache cannot bypass connection source compatibility checks',async t=>{
  const f=connection(t,{compatible:false,permanent:true});
  await f.service.connect(f.config);assert.equal((await f.service.status()).connected,true);
  await assert.rejects(f.service.ensureConnected(),e=>e.code==='ROOM_ENGINE_MISMATCH');assert.equal(f.installs,0);assert.equal(f.bootstraps,0);
});
test('a job starting between idle check and bootstrap is deferred and rechecked, not interrupted',async t=>{
  const f=connection(t,{busy:false,compatible:false,race:true});const result=await f.service.connect(f.config,{deploy:true});
  assert.equal(result.connected,true);assert.equal(f.bootstraps,2);assert.equal(f.elapsed,1000);
});
