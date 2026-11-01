'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  let now=1000,busy=false,calls=0,receipt={status:'busy',retryable:true};
  const d={geoKey:'0,0,0',cells:{}},item={name:'letter',x:1,y:1};for(let y=0;y<4;y++)for(let x=0;x<4;x++)d.cells[`${x},${y}`]={tile:'floor'};
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:()=>null},window={currentDungeon:d,gamePaused:false,
    GameCommandGate:{busy:()=>busy},PlayerControls:{autoTake:()=>true},ObjectDiscovery:{isVisible:()=>true},
    CommerceUi:{handleCommand(){},isBusy:()=>false,takeItem:async()=>{calls++;return receipt;}},DungeonLife:{speaking:true}};
  vm.runInNewContext(fs.readFileSync('assets/itemInteractionUi.js','utf8'),{window,document,Date:{now:()=>now}});
  return{window,d,item,tick:()=>window.ItemInteractionUi.update(d,[item],{x:1.5,y:1.5}),calls:()=>calls,
    advance:n=>now+=n,busy:v=>busy=v,result:v=>receipt=v};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('subtitles do not block pickup, but a transient action race retries without requiring the player to walk away',async()=>{
  const f=fixture();f.busy(true);f.tick();assert.equal(f.calls(),0);f.busy(false);f.tick();await flush();assert.equal(f.calls(),1);
  for(let n=0;n<50;n++)f.tick();assert.equal(f.calls(),1,'retry is throttled');
  f.advance(601);f.result({status:'taken',retryable:false});f.tick();await flush();assert.equal(f.calls(),2);
  f.advance(5000);f.tick();assert.equal(f.calls(),2,'a completed pickup is never duplicated');
});
test('hard pickup failures are not spammed, and combat and paused games still block attempts',async()=>{
  const f=fixture();f.result({status:'failed',retryable:false});f.tick();await flush();f.advance(10000);f.tick();assert.equal(f.calls(),1);
  for(const flag of ['gamePaused','_combatCommandPending']){const blocked=fixture();blocked.window[flag]=true;blocked.tick();assert.equal(blocked.calls(),0);}
});
test('commerce reports busy distinctly instead of falsely reporting a completed pickup',async()=>{
  const window={GameCommandGate:{busy:()=>true},DungeonActionNotices:{receive:()=>assert.fail('automatic retries must be quiet')}};
  vm.runInNewContext(fs.readFileSync('assets/commerceUi.js','utf8'),{window});
  const result=await window.CommerceUi.takeItem('letter');assert.equal(result.status,'busy');assert.equal(result.retryable,true);
});
