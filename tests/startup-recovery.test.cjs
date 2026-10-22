'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const Startup=require('../retort/startupTasks'),Client=require('../assets/characterStartup');
const payload={character:{Name:'Tester'}};
test('terminal failed receipt permits explicit Save retry after model change; run guard remains',()=>{
 let model='old';const tasks=new Map(),r=Startup.create({tasks,scope:()=>model});const first=r.begin(payload);r.bind(first.taskId,'run');tasks.get(first.taskId).status='error';model='new';
 assert.throws(()=>r.find(payload,'other'),/earlier game/);assert.equal(r.find(payload,'run'),null);const next=r.begin(payload);assert.notEqual(first.taskId,next.taskId);
 assert.equal(r.find(payload,'run').taskId,next.taskId);assert.throws(()=>r.clear(),/still being built/);tasks.get(next.taskId).status='complete';assert.equal(r.find(payload,'run').taskId,next.taskId);model='third';assert.throws(()=>r.find(payload,'run'),/model or world/);
});
test('lost poll is bounded, actionable, and never reposts',async()=>{
 let posts=0,polls=0;await assert.rejects(Client.start(payload,{request:async url=>{
 if(url==='/startGameWithCharacter'){posts++;return {ok:true,json:async()=>({taskId:'lost'})};}polls++;return {ok:false,status:404,json:async()=>({error:'Task not found'})};
 }}),e=>e.code==='STARTUP_TASK_LOST'&&e.taskId==='lost');assert.equal(posts,1);assert.equal(polls,1);
});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function bootstrap(change=()=>{}){
 const files={'worker.cjs':'// HOLODEK_WEBSITE_WORKER_V2','workerPool.cjs':'pool','roomTask.cjs':'task','roomWire.cjs':'wire'};
 const engineHash='a'.repeat(64),bundleHash=hash(['worker.cjs','workerPool.cjs','roomTask.cjs','roomWire.cjs'].map(n=>n+'\n'+files[n]).join('\n'));
 const state={version:1,port:9001,node:'v22.23.4',bundleHash,engineHash,roomWorkers:3,active:1,pool:[9001,9002,9003].map(port=>({port,node:'v22.23.4',bundleHash,engineHash}))};
 const packet={code:files['worker.cjs'],hash:hash(files['worker.cjs']),files:Object.fromEntries(Object.entries(files).filter(([n])=>n!=='worker.cjs')),hashes:Object.fromEntries(Object.entries(files).map(([n,c])=>[n,hash(c)])),engineHash};
 const disk={...files};change({state,packet,disk});let output='',mutations=0,end;
 const process={stdin:{on:(event,cb)=>{if(event==='end')end=cb;else if(event==='data')cb(JSON.stringify(packet));}},stdout:{write:s=>output+=s},exit:()=>{throw Error('exit');}};
 const fakeFs={mkdirSync(){},lstatSync:()=>({isSymbolicLink:()=>false}),existsSync:()=>true,readFileSync:p=>p.endsWith('.installed.json')?JSON.stringify({hash:engineHash,ready:true}):disk[p.split('/').pop()],copyFileSync:()=>mutations++,writeFileSync:()=>mutations++,renameSync:()=>mutations++};
 const requireMock=n=>n==='node:fs'?fakeFs:n==='node:path'?require('node:path').posix:n==='node:os'?{homedir:()=>'/home/test'}:n==='node:crypto'?crypto:n.endsWith('worker.cjs')?{rpc:async()=>state}:n==='node:child_process'?{spawnSync:()=>{mutations++;return {stdout:'{}',status:0};}}:require(n);
 vm.runInNewContext(require('../retort/websiteWorkerBootstrap').source(),{require:requireMock,process});await end();return {value:JSON.parse(output),mutations};
}
test('exact healthy busy worker reconnects without source writes or restart',async()=>{const r=await bootstrap();assert.equal(r.value.value.active,1);assert.equal(r.mutations,0);});
for(const [name,change] of [
 ['source mismatch',({disk})=>disk['roomWire.cjs']='different'],
 ['engine mismatch',({state})=>state.pool[1].engineHash='b'.repeat(64)],
 ['runtime mismatch',({state})=>state.pool[1].node='v20.1.0'],
 ['incomplete pool',({state})=>state.pool.pop()],
 ['protocol mismatch',({state})=>state.version=2],
 ['bundle mismatch',({state})=>state.pool[1].bundleHash='b'.repeat(64)],
 ['duplicate listener',({state})=>state.pool[1].port=state.pool[0].port]
])test('busy '+name+' defers without touching jobs',async()=>{const r=await bootstrap(change);assert.match(r.value.error,/deferred/);assert.equal(r.mutations,0);});
