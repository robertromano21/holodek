'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/sidPlayer.js','utf8');
function processor(){
  let Type;const messages=[],pulls=[],synthesis={postMessage:d=>pulls.push(d),close(){this.closed=true;}};
  const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:d=>messages.push(d)};}},
    registerProcessor:(_name,type)=>Type=type,currentFrame:48000,sampleRate:48000};
  vm.runInNewContext(source.slice(source.indexOf('  function processorModule()'),source.indexOf('  // The processor class'))+'processorModule();',context);
  const p=new Type(),send=data=>p.port.onmessage({data});
  send({action:'connect',port:synthesis});send({action:'reset',epoch:1});send({action:'start',epoch:1});
  return{p,context,messages,pulls,synthesis,send,render:()=>p.process([],[ [new Float32Array(128)] ])};
}
test('permanent close retires the worklet rather than accumulating disconnected live processors',()=>{
  const f=processor();assert.equal(f.render(),true);assert.equal(f.pulls.length,12);
  f.send({action:'close'});assert.equal(f.render(),false);assert.equal(f.synthesis.closed,true);
  assert.equal(f.p.queue.length,0);assert.equal(f.p.pending,0);assert.equal(f.messages.at(-1).closed,true);
  f.send({action:'reset',epoch:2});f.send({action:'start',epoch:2});assert.equal(f.render(),false);
  f.p.receive({epoch:1,chunk:new Float32Array(2048)});assert.equal(f.p.queue.length,0);
});
test('pause remains resumable and underflow diagnostics count starvation episodes, not every quantum',()=>{
  const f=processor();f.send({action:'pause',value:false});f.render();f.context.currentFrame+=128;f.render();
  assert.equal(f.p.underruns,1);assert.equal(f.p.missing,256);
  f.p.receive({epoch:1,chunk:new Float32Array(2048),end:false});f.render();assert.equal(f.p.starved,false);
  f.send({action:'pause',value:true});const played=f.p.played;assert.equal(f.render(),true);assert.equal(f.p.played,played);
  f.send({action:'reset',epoch:2});assert.equal(f.p.underruns,0);assert.equal(f.p.missing,0);
});
function client(){
  class Node{constructor(){this.messages=[];this.port={postMessage:d=>this.messages.push(d),close:()=>this.port.closed=true};}connect(){}disconnect(){this.disconnected=true;}}
  class Worker{postMessage(){}terminate(){this.terminated=true;}}
  const context={AudioWorkletNode:Node,Worker,MessageChannel,URL,Blob,DOMException,setTimeout,clearTimeout};
  vm.runInNewContext(source,context);
  const audio={currentTime:0,sampleRate:48000,destination:{},createGain:()=>({connect(){},disconnect(){},gain:{setTargetAtTime(){}}})};
  return{api:context.HolodekSidPlayer,audio};
}
test('disposing each client sends permanent close, terminates workers and removes active diagnostics once',()=>{
  const f=client(),p=new f.api.Player(f.audio,{},'',()=>{});assert.equal(f.api.stats().active,1);
  p.dispose();p.dispose();assert.equal(p.worker.terminated,true);assert.equal(p.node.messages.at(-1).action,'close');
  assert.equal(f.api.stats().active,0);assert.equal(f.api.stats().disposed,1);
  p.node.port.onmessage({data:{closed:true}});assert.equal(p.processorClosed,true);assert.equal(p.node.port.closed,true);assert.equal(f.api.stats().retired,1);
});
test('a failed player also retires instead of leaving a paused processor on the audio thread',()=>{
  const f=client(),errors=[],p=new f.api.Player(f.audio,{},'',e=>errors.push(e.message));
  p.fail(Error('Broken synthesis'));p.fail(Error('Again'));
  assert.equal(p.disposed,true);assert.equal(f.api.stats().active,0);assert.equal(f.api.stats().failed,1);
  assert.equal(p.node.messages.at(-1).action,'close');assert.deepEqual(errors,['Broken synthesis']);
});
