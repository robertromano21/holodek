'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fork, spawn } = require('node:child_process'), { once } = require('node:events'), http = require('node:http');
const alive = pid => { try { process.kill(pid,0); return true; } catch (error) { if(error.code==='ESRCH')return false;throw error; } };
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

for(const abrupt of [false,true])test(`Windows game containment reaps detached orphan grandchildren after ${abrupt?'an abrupt exit':'closing the last window'}`,{
  skip:process.platform!=='win32',timeout:30000},async t=>{
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>sentinel.kill());
  const child=fork(require.resolve('./fixtures/process-owner.cjs'),abrupt?['--exit-unclean']:[],{windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const ready=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(([code])=>{throw Error('Owned fixture exited before ready: '+code);})]);
  assert.equal(ready.ownership.mode,'windows-job');assert.equal(ready.ownership.ownerPid,child.pid);
  assert.ok(alive(ready.orphan));const exited=once(child,'exit');
  if(abrupt)child.send('exit-now');
  else{
    const connection=http.get(`http://127.0.0.1:${ready.port}/game/lifecycle/presence`);connection.on('error',()=>{});
    const [response]=await once(connection,'response');response.on('error',()=>{});response.resume();connection.destroy();
  }
  assert.equal((await exited)[0],abrupt?1:0);
  const deadline=Date.now()+5000;
  while(Date.now()<deadline&&(alive(ready.orphan)||alive(ready.ownership.watchdogPid)))await sleep(25);
  assert.equal(alive(ready.orphan),false,'A detached grandchild must not outlive its game');
  assert.equal(alive(ready.ownership.watchdogPid),false,'The watchdog must not leak either');
  assert.equal(alive(sentinel.pid),true,'Unrelated applications remain untouched');
});
