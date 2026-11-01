'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(storage=new Map()){
  const timers=[];let mutation;
  function node(tag='DIV'){
    const listeners={},attrs={},n={tagName:tag,children:[],hidden:false,className:'',style:{setProperty(){},getPropertyValue:()=>''},
      setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],addEventListener(type,fn){(listeners[type]||=[]).push(fn);},
      dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);return !event.defaultPrevented;},
      append(...children){for(const c of children){c.remove();n.children.push(c);c.parentNode=n;}},appendChild(c){n.append(c);return c;},
      prepend(c){c.remove();n.children.unshift(c);c.parentNode=n;},
      remove(){if(n.parentNode){const a=n.parentNode.children;a.splice(a.indexOf(n),1);n.parentNode=null;}},
      replaceChildren(...children){for(const c of n.children)c.parentNode=null;n.children=[];n.append(...children);},
      all(){return n.children.flatMap(c=>[c,...c.all()]);},
      matches(s){return s.includes('[role="dialog"]')&&attrs.role==='dialog'||s.includes('dialog')&&tag==='DIALOG'||
        s.includes('.popup-container')&&n.classList.contains('popup-container');},
      querySelectorAll(s){return n.all().filter(c=>c.matches(s));},
      querySelector(s){if(s.startsWith(':scope >'))return n.children.find(c=>c.tagName==='HEADER'||c.className==='window-menu-tab')||null;
        if(s==='h1, h2')return n.all().find(c=>['H1','H2'].includes(c.tagName))||null;
        if(s==='.graphics-close')return null;return null;},
      getClientRects(){return n.hidden?[]:[{}];}};
    n.classList={contains:c=>n.className.split(/\s+/).includes(c),add:c=>n.className+=' '+c};return n;
  }
  const document={head:node('HEAD'),body:node('BODY'),hidden:false,addEventListener(){},createElement:tag=>node(tag.toUpperCase()),
    getElementById:id=>document.body.all().find(n=>n.id===id)||null,querySelectorAll:s=>document.body.querySelectorAll(s)};
  document.activeElement=document.body;
  const root={document,dungeonRunId:'run',gamePaused:false,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    getComputedStyle:()=>({position:'fixed',getPropertyValue:()=> '0px'})};
  const context=vm.createContext({window:root,document,Event,setTimeout:fn=>timers.push(fn),setInterval:()=>1,clearInterval(){},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}});
  for(const file of ['windowUi','combatLifeUi','playerControls'])vm.runInContext(fs.readFileSync(require.resolve('../assets/'+file),'utf8'),context);
  root.WindowUi.init();
  const status={runId:'run',messageRevision:4,rescuesUsed:1,recovery:null,gameOver:null,message:'You return with 7 HP.',
    deathScene:{reviver:'The Listener',description:'The Listener waits beside a narrow stair.',words:'Go back.'}};
  function flush(){mutation([{target:document.body,addedNodes:[...document.body.children]}]);}
  function reveal(){while(timers.length)timers.shift()();flush();}
  function headerClose(){const box=document.getElementById('revival-popup');return box.children.find(n=>n.className==='window-menu-tab').children.at(-1);}
  function click(n){n.dispatchEvent(new Event('click',{cancelable:true}));}
  return{root,document,status,storage,flush,reveal,headerClose,click};
}
test('the grey Listener window X acknowledges revival and releases the actual movement gate',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.reveal();
  assert.equal(f.root.PlayerControls.blocked(true),true);f.click(f.headerClose());
  assert.equal(f.root._deathSceneActive,false);assert.equal(f.root.PlayerControls.blocked(true),false);
  assert.equal(f.document.getElementById('revival-popup'),null);assert.equal(f.storage.get('holodek-recovery-read'),'run:4');
  assert.equal(f.status.rescuesUsed,1,'Dismissing a dialog must not spend another life');
});
test('the Return button performs the same cleanup as the window X',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.reveal();
  const box=f.document.getElementById('revival-popup'),button=box.children.find(n=>n.tagName==='BUTTON');
  assert.equal(button.textContent,'Return to the level entrance');f.click(button);
  assert.equal(f.root.PlayerControls.blocked(true),false);assert.equal(f.storage.get('holodek-recovery-read'),'run:4');
});
test('closing during the blackout cannot let the delayed reveal recreate a movement lock',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.flush();f.click(f.headerClose());f.reveal();
  assert.equal(f.document.getElementById('revival-popup'),null);assert.equal(f.root.PlayerControls.blocked(true),false);
});
test('repeated status and reconnect after acknowledgement do not replay or relock the same revival',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.reveal();f.click(f.headerClose());
  f.root.CombatLifeUi.receive(f.status);assert.equal(f.root.PlayerControls.blocked(true),false);
  const next=fixture(f.storage);next.root.CombatLifeUi.receive(next.status);next.reveal();
  assert.equal(next.document.getElementById('revival-popup'),null);assert.equal(next.root.PlayerControls.blocked(true),false);
});
test('a stale close button cannot dismiss a newer revival or another game',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.reveal();const stale=f.headerClose();
  f.root.CombatLifeUi.receive({...f.status,messageRevision:5,rescuesUsed:2});f.reveal();f.click(stale);
  assert.equal(f.root._deathSceneActive,true);assert.ok(f.document.getElementById('revival-popup'));
  const newer=f.headerClose();f.root.dungeonRunId='different-game';f.click(newer);assert.equal(f.root._deathSceneActive,true);
});
test('a stale revival close cannot unlock third-death game over',()=>{
  const f=fixture();f.root.CombatLifeUi.receive(f.status);f.reveal();const stale=f.headerClose();
  f.root.CombatLifeUi.receive({...f.status,messageRevision:6,rescuesUsed:2,gameOver:{reason:'No impressions remain.'}});
  f.reveal();f.click(stale);assert.equal(f.root._gameOver,true);assert.equal(f.root.PlayerControls.blocked(true),true);
});
