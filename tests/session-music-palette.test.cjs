'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Music=require('../assets/sessionMusicPalette');
const pair={runId:'run-1',scoreSignature:'score-1',coords:'0,0,0',clock:'2x',variants:{
  '8580':'/sid/palettes/'+'a'.repeat(40)+'-8580.wav','10582':'/sid/palettes/'+'a'.repeat(40)+'-10582.wav'}};
function fixture({paused=false,failDownload=false,stale=false}={}){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.listeners=new Map();this.hidden=true;}
    appendChild(child){child.parent=this;this.children.push(child);return child;}
    setAttribute(k,v){this[k]=v;}getAttribute(k){return this[k]||null;}
    addEventListener(k,fn,options){this.listeners.set(k,{fn,options});}removeEventListener(k){this.listeners.delete(k);}
    async emit(k){const row=this.listeners.get(k);if(row){if(row.options?.once)this.listeners.delete(k);await row.fn();}}
    querySelector(){return null;}focus(){}remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
  }
  const panel=new Node('panel'),menu=new Node('menu'),audio=new Node('audio');panel.appendChild(menu);
  panel.querySelector=q=>q==='div'?menu:null;
  Object.assign(audio,{id:'room-music',src:'original.wav',currentTime:87.5,duration:590.769,paused,autoplay:true,
    load(){queueMicrotask(()=>this.emit('canplay'));},pause(){this.paused=true;},async play(){this.paused=false;}});
  const requests=[],settings={sidMode:'2x',music:.2,amb:.1,userPaused:paused},live={runId:stale?'different-run':'run-1',music:{composition:{scoreSignature:'score-1'}}};
  const dungeon=Object.freeze({geoKey:'0,0,0'}),sound={settings,state:()=>({active:'room-music'}),applyVolumes(){},roomShown(){}};
  let blobs=0;
  const root={HolodekSfx:sound,currentDungeon:dungeon,URL:{createObjectURL:()=> 'blob:comparison-'+ ++blobs,revokeObjectURL(){}},setTimeout,clearTimeout,
    document:{getElementById:id=>id==='holodek-audio-panel'?panel:id==='room-music'?audio:null,createElement:tag=>new Node(tag),createTextNode:text=>({textContent:text})},
    fetch:async(url,options)=>{requests.push({url,options});return url.startsWith('/sid/current-audition-pair')?{ok:true,json:async()=>structuredClone(pair)}:
      url.startsWith('/get-room-music')?{ok:true,json:async()=>structuredClone(live)}:{ok:!failDownload,status:503,blob:async()=>({})};}};
  return{root,panel,menu,audio,requests,settings,live};
}

test('manifest only permits the matching local traditional and extended WAVs',()=>{
  assert.equal(Music.validatePair(pair),pair);
  for(const url of ['javascript:bad','https://other.example/test.wav','/sid/../bad.wav',pair.variants['8580']]){
    assert.throws(()=>Music.validatePair({...pair,variants:{...pair.variants,'10582':url}}),/path/);
  }
  assert.throws(()=>Music.assertSession(pair,{runId:'other'},'0,0,0','2x'),/adventure/);
  assert.throws(()=>Music.assertSession(pair,{runId:'run-1',music:{composition:{scoreSignature:'score-1'}}},'0,0,0','4x'),/clock/);
});

test('live control installs once, preserves game state and switches at the current song position',async()=>{
  const f=fixture(),before=JSON.stringify(f.settings),originalRoomShown=f.root.HolodekSfx.roomShown;
  try{
    const a=await Music.install(f.root),b=await Music.install(f.root);
    assert.equal(a,b);assert.equal(f.menu.children.length,2);assert.equal(f.menu.hidden,false);
    const result=await Music.switchTo('10582');
    assert.equal(result.chip,'10582');assert.equal(result.seconds,87.5);assert.equal(result.paused,false);
    assert.equal(f.audio.src,'blob:comparison-1');
    assert.equal(JSON.stringify(f.settings),before);assert.equal(f.root.currentDungeon.geoKey,'0,0,0');
    const reverse=await Music.switchTo('8580');assert.equal(reverse.seconds,87.5);
    await Music.switchTo('10582');assert.equal(f.requests.filter(r=>r.url===pair.variants['10582']).length,1);
    assert.ok(f.requests.every(r=>!r.options?.method||r.options.method==='GET'));
  }finally{Music.dispose();}
  assert.equal(f.root.HolodekSfx.roomShown,originalRoomShown);assert.equal(f.menu.children.length,0);
});

test('switching the paused soundtrack does not resume it',async()=>{
  const f=fixture({paused:true});
  try{await Music.install(f.root);const r=await Music.switchTo('10582');assert.equal(r.paused,true);assert.equal(r.seconds,87.5);}
  finally{Music.dispose();}
});

test('failed download leaves the existing player and soundtrack untouched',async()=>{
  const f=fixture({failDownload:true});
  try{
    await Music.install(f.root);await assert.rejects(Music.switchTo('10582'),/unavailable/);
    assert.equal(f.audio.src,'original.wav');assert.equal(f.audio.currentTime,87.5);assert.equal(f.audio.paused,false);
    assert.equal(Music.state().chip,'8580');
  }finally{Music.dispose();}
});

test('another adventure cannot receive the old room comparison',async()=>{
  const f=fixture({stale:true});await assert.rejects(Music.install(f.root),/adventure/);
  assert.equal(f.menu.children.length,0);assert.equal(f.audio.src,'original.wav');
});

test('leaving the room disables the comparison without interfering with room notifications',async()=>{
  const f=fixture();
  try{
    await Music.install(f.root);f.root.HolodekSfx.roomShown('1,0,0');
    const select=f.menu.children[0].children[1];assert.equal(select.disabled,true);
    f.live.runId='new-run';await assert.rejects(Music.switchTo('10582'),/adventure/);
    assert.equal(f.audio.src,'original.wav');
  }finally{Music.dispose();}
});
