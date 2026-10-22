'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const asset=name=>fs.readFileSync(path.join(__dirname,'../assets',name),'utf8');
function ui(){
 const nodes=[],calls=[];class E{constructor(tag){this.tag=tag;this.children=[];this.style={};this.listeners={};this.offsetWidth=100;nodes.push(this);}append(...cs){this.children.push(...cs);}appendChild(c){this.children.push(c);}replaceChildren(){this.children=[];}setAttribute(k,v){this[k]=v;}addEventListener(k,f){this.listeners[k]=f;}remove(){this.removed=true;}getBoundingClientRect(){return {width:100};}}
 const body=new E('body'),document={body,createElement:tag=>new E(tag),getElementById:()=>null,addEventListener(){}};
 const data={runId:'run',casters:[{name:'Mage',hp:10,groups:[{spells:[{id:'ready',name:'Ready',casts:2,cost:1},{id:'unprepared',name:'Unprepared',casts:0,cost:1},{id:'empty',name:'Empty',casts:0,cost:5}]}]},{name:'Dead',hp:0,groups:[{spells:[{id:'dead',name:'Dead spell',casts:9,cost:1}]}]}]};
 const window={dungeonRunId:'run',innerWidth:1200,innerHeight:900,SpellUi:{openSpell:(...args)=>calls.push(args)},addEventListener(){}};
 const fetch=async()=>({ok:true,json:async()=>data});vm.runInNewContext(asset('partySpellbookUi.js'),{window,document,fetch,setTimeout,clearTimeout});return {window,document,nodes,calls,data};
}
test('quick book lists affordable spells without target choices; selection opens existing cast popup',async()=>{
 const f=ui();await f.window.PartySpellbookUi.openQuick();const buttons=f.nodes.filter(n=>n.tag==='button');const ready=buttons.find(n=>n.textContent?.includes('Mage: Ready'));
 assert.ok(ready);assert.ok(!buttons.some(n=>/Unprepared|Empty|Dead spell/.test(n.textContent)));ready.listeners.click();assert.deepEqual(f.calls,[['Mage','ready']]);
});
test('explicit full-book action remains a full book after quick list',async()=>{
 const f=ui();await f.window.PartySpellbookUi.openQuick();f.data.casters=[];await f.nodes.find(n=>n.textContent==='Full Party Spellbook').listeners.click();await new Promise(r=>setImmediate(r));assert.equal(f.nodes.filter(n=>n.tag==='section').at(-1)['aria-label'],'Party Spellbook');
});
function dock(){
 let ready,timerId=0;const timers=new Map(),calls=[],elements=new Map();for(const id of ['dungeon-map-shortcut','dungeon-spellbook-shortcut','chatbotcontainer'])elements.set(id,{offsetWidth:38,offsetHeight:40,style:{},listeners:{},addEventListener(k,f){this.listeners[k]=f;},getBoundingClientRect:()=>({width:38,right:700,top:700,bottom:800})});
 const window={innerWidth:1200,innerHeight:900,addEventListener(){},PartySpellbookUi:{open:()=>calls.push('full'),openQuick:()=>calls.push('quick')}};
 vm.runInNewContext(asset('mapShortcutUi.js'),{window,document:{getElementById:id=>elements.get(id),addEventListener:(_,f)=>ready=f},setTimeout:f=>{const id=++timerId;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});ready();return {calls,tap:()=>elements.get('dungeon-spellbook-shortcut').listeners.click(),flush:()=>{for(const [id,f]of timers){timers.delete(id);f();}}};
}
test('single tap opens quick casting; double tap opens full book once',()=>{
 const single=dock();single.tap();assert.deepEqual(single.calls,[]);single.flush();assert.deepEqual(single.calls,['quick']);
 const double=dock();double.tap();double.tap();double.flush();assert.deepEqual(double.calls,['full']);
});
