'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('const taskRequest = {'),end=source.indexOf('\nif (completedStartResult) taskRequest.success',start);
  assert.ok(start>=0&&end>start);
  const requests=[],messages=[],timers=[],cancelled=[],root={RoomEntry:{isPending:()=>true,cancel:()=>cancelled.push(true)}};
  const context={window:root,userInput:'north',completedStartResult:false,console:{log(){},warn(){},error(){}},
    $:{ajax:request=>requests.push(request)},clearInterval:id=>{if(id)id.cancelled=true;},
    setInterval:(callback,ms)=>{const timer={callback,ms};timers.push(timer);return timer;},updateChatLog:message=>messages.push(message)};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.request=taskRequest;',context);
  context.request.success({taskId:'same-task'});
  return{context,root,requests,messages,timers,cancelled,tick:()=>timers[0].callback()};
}
test('entry polling keeps exactly one request in flight even when responses take longer than the interval',()=>{
  const f=fixture();assert.equal(f.timers[0].ms,750);
  for(let i=0;i<30;i++)f.tick();assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/poll-task2/same-task');
  f.requests[0].success({status:'processing'});f.tick();assert.equal(f.requests.length,1);
  f.requests[0].complete();f.tick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].url,'/poll-task2/same-task');
});
test('a completed response is consumed once and late errors cannot append a false server-failure message',()=>{
  const f=fixture();f.tick();const poll=f.requests[0],result={status:'complete',result:{characterGenerationPhase:true,response:'Delivered once'}};
  poll.success(result);poll.success(result);poll.error({status:404});poll.complete();f.tick();
  assert.equal(f.requests.length,1);assert.equal(f.messages.length,1);assert.match(f.messages[0],/Delivered once/);
  assert.doesNotMatch(f.messages.join(' '),/Unable to get a response/);assert.equal(f.cancelled.length,0);assert.equal(f.timers[0].cancelled,true);
});
test('real task errors remain visible once and late successful callbacks cannot apply an older result',()=>{
  const f=fixture();f.tick();const poll=f.requests[0];poll.success({status:'error',result:'A genuine generation failure'});
  poll.success({status:'complete',result:{characterGenerationPhase:true,response:'old result'}});poll.error({status:404});poll.complete();f.tick();
  assert.equal(f.messages.length,1);assert.match(f.messages[0],/genuine generation failure/);assert.equal(f.cancelled.length,1);
  assert.equal(f.requests.length,1);
});
test('a failed transport stops polling without reposting the command or swallowing the error',()=>{
  const f=fixture();f.tick();const poll=f.requests[0];poll.error({status:0});poll.error({status:0});poll.complete();f.tick();
  assert.equal(f.requests.length,1);assert.equal(f.messages.length,1);assert.match(f.messages[0],/Unable to get a response/);
  assert.equal(f.cancelled.length,1);assert.equal(f.timers[0].cancelled,true);
});
