'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({source='env',status='ready'}={}){
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.open=false;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    addEventListener(name,fn){this.handlers[name]=fn;}setAttribute(){}focus(){}showModal(){this.open=true;}
    close(){this.open=false;}remove(){this.removed=true;}async click(){return this.handlers.click?.();}
    querySelector(selector){return visit(this).find(e=>selector==='input:checked'&&e.tagName==='input'&&e.checked)||null;}
  }
  const visit=e=>[e,...(e.children||[]).filter(n=>n&&typeof n==='object'&&!n.removed).flatMap(visit)];
  const body=new Element('body'),head=new Element('head'),writes=[],requests=[];
  const document={body,head,createElement:t=>new Element(t),addEventListener(){},getElementById:id=>visit(body).concat(visit(head)).find(e=>e.id===id&&!e.removed)};
  const window={location:{search:'?nomodelselect'},localStorage:{setItem:(...args)=>writes.push(args)}};
  const fetch=async(url,options={})=>{requests.push({url,method:options.method||'GET'});return{ok:true,json:async()=>({current:{id:'gpt-6-luna',revision:1},
    all:[{id:'gpt-6-luna',provider:'openai',name:'Luna',status}],keys:{openai:source},storedKeys:{openai:false}})};};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/modelSelectUi'),'utf8'),{window,document,fetch});
  return{window,document,writes,requests,visit};
}
test('an available environment key can be used without saving or transmitting a credential',async()=>{
  const f=fixture();await f.window.ModelSelectUi.open();
  const pending=f.document.getElementById('model-select-continue').click();await Promise.resolve();
  const prompt=f.document.getElementById('provider-key-prompt'),input=f.document.getElementById('provider-key-input');
  const session=f.visit(prompt).find(e=>e.textContent==='Use session key');assert.ok(session);
  input.value='an unsaved draft';await session.click();await pending;
  assert.equal(input.value,'');assert.equal(prompt.removed,true);assert.equal(f.document.getElementById('model-select-screen').open,false);
  assert.ok(f.requests.every(r=>r.method==='GET'&&r.url.startsWith('/game-models')));
  assert.deepEqual(f.writes,[['holodek.gameModel','gpt-6-luna']]);
});
test('a provider that actually needs a key has no session-key bypass',async()=>{
  const f=fixture({source:'none',status:'needs key'});await f.window.ModelSelectUi.open();
  const pending=f.document.getElementById('model-select-continue').click();await Promise.resolve();
  const prompt=f.document.getElementById('provider-key-prompt');
  assert.ok(!f.visit(prompt).some(e=>e.textContent==='Use session key'));
  await f.visit(prompt).find(e=>e.textContent==='Cancel').click();await pending;
  assert.equal(f.document.getElementById('model-select-screen').open,true);assert.equal(f.writes.length,0);
});
