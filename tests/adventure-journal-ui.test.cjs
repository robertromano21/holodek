'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture() {
  const elements=new Map(),nodes=[],events={};
  class Element {
    constructor(tag) {this.tag=tag;this.children=[];this.attrs={};this.hidden=false;this.textContent='';this.listeners={};this.style={};nodes.push(this);}
    appendChild(c) {this.children.push(c);return c;} append(...c) {c.forEach(n=>this.appendChild(n));}
    replaceChildren(...c) {this.children=c;} setAttribute(k,v) {this.attrs[k]=v;}
    addEventListener(k,cb) {this.listeners[k]=cb;}
  }
  for(const id of ['journal-popup','journal-content','journal-close','dungeon-journal-shortcut','open-journal-button','chatuserinput'])elements.set(id,new Element('div'));
  elements.get('journal-popup').hidden=true;elements.get('chatuserinput').value='unfinished command';
  const data={runId:'run',quest:'The Water Debt',objective:{title:'Rescue Varo',description:'Escort Varo alive.',requirements:'Go to Amber Spring Gardens.'},
    route:[{room:'Amber Spring Gardens',roomKey:'1,1,0',actor:'Senna',status:'Current'}],
    facts:[{title:'Read burial record',room:'Crown Graves',text:'The keeper refused the levy.'}],
    rumors:[{source:'Edrin',text:'The keeper sold the well.',status:'Unverified'}],factions:{factions:[{name:'Cistern Compact',standing:'Trusted',score:2}],decisions:[{summary:'Kept the well in common.'}]},contracts:[],history:[]};
  const requests=[],window={dungeonRunId:'run',gamePaused:true},document={createElement:t=>new Element(t),getElementById:id=>elements.get(id),
    addEventListener:(name,cb)=>events[name]=cb};let hook;
  vm.runInNewContext(fs.readFileSync('assets/adventureJournalUi.js','utf8'),{window,document,
    fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return hook?hook():{ok:true,json:async()=>data};}});
  events.DOMContentLoaded();
  return {window,elements,nodes,data,requests,events,hook:cb=>hook=cb};
}
test('journal is read-only, accessible while paused, and preserves the command draft',async()=>{
  const f=fixture();assert.equal(await f.window.AdventureJournalUi.toggle(),true);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/journal/view');assert.deepEqual(f.requests[0].body,{runId:'run'});
  assert.equal(f.elements.get('chatuserinput').value,'unfinished command');
  assert.ok(f.nodes.some(n=>n.textContent==='Confirmed Facts'));assert.ok(f.nodes.some(n=>n.textContent==='Rumors'));
  assert.ok(f.nodes.some(n=>n.textContent.includes('Cistern Compact: Trusted (+2)')));
  assert.equal(f.elements.get('dungeon-journal-shortcut').attrs['aria-expanded'],'true');
  f.events.keydown({key:'Escape'});assert.equal(f.elements.get('journal-popup').hidden,true);
});
test('late responses cannot reopen a closed journal or publish a previous game',async()=>{
  for(const change of ['close','run']) {
    const f=fixture();let resolve;f.hook(()=>new Promise(done=>resolve=done));
    const opened=f.window.AdventureJournalUi.toggle(true);await new Promise(done=>setImmediate(done));
    if(change==='close')await f.window.AdventureJournalUi.toggle(false);else f.window.dungeonRunId='new-run';
    resolve({ok:true,json:async()=>f.data});assert.equal(await opened,false);
    assert.ok(!f.nodes.some(n=>n.textContent==='Confirmed Facts'));
  }
});
test('journal uses plain text for authored content and reports rejected requests',async()=>{
  const f=fixture();f.data.quest='<img onerror="run()">';await f.window.AdventureJournalUi.toggle(true);
  assert.ok(f.nodes.some(n=>n.textContent===f.data.quest));assert.ok(f.nodes.every(n=>n.innerHTML===undefined));
  f.hook(async()=>({ok:false,json:async()=>({error:'That journal belongs to another game.'})}));
  assert.equal(await f.window.AdventureJournalUi.toggle(true),false);assert.match(f.elements.get('journal-content').textContent,/another game/);
});
test('journal sits between inventory and map at multiple zooms and small viewport heights',()=>{
  const source=fs.readFileSync('assets/mapShortcutUi.js','utf8');
  for(const [zoom,height] of [[1,900],[1.75,900],[2,360]]) {
    const buttons=new Map(['dungeon-map-shortcut','dungeon-journal-shortcut','dungeon-inventory-shortcut','dungeon-spellbook-shortcut'].map(id=>[id,
      {offsetHeight:40,offsetWidth:38,style:{},getBoundingClientRect:()=>({width:38*zoom}),addEventListener(){}}]));
    buttons.set('chatbotcontainer',{getBoundingClientRect:()=>({right:700,top:height-130,bottom:height-4})});
    let ready;vm.runInNewContext(source,{window:{innerWidth:1200,innerHeight:height,addEventListener(){}},
      document:{getElementById:id=>buttons.get(id),addEventListener:(_name,cb)=>ready=cb}});ready();
    const map=buttons.get('dungeon-map-shortcut'),journal=buttons.get('dungeon-journal-shortcut'),inventory=buttons.get('dungeon-inventory-shortcut');
    assert.ok(Math.abs(parseFloat(journal.style.bottom)-parseFloat(map.style.bottom)-46)<.0001);
    assert.ok(Math.abs(parseFloat(inventory.style.bottom)-parseFloat(journal.style.bottom)-46)<.0001);
    assert.ok((parseFloat(inventory.style.bottom)+40)*zoom<height);
    const book=buttons.get('dungeon-spellbook-shortcut');
    assert.equal(book.style.bottom,inventory.style.bottom);
    assert.equal(parseFloat(inventory.style.left)-parseFloat(book.style.left),44);
    assert.equal(book.offsetWidth,38);assert.equal(book.offsetHeight,40);
  }
  const html=fs.readFileSync('assets/index.html','utf8');
  assert.ok(html.indexOf('id="open-inventory-button"')<html.indexOf('id="open-journal-button"'));
  assert.ok(html.indexOf('id="open-journal-button"')<html.indexOf('id="open-exploration-map-button"'));
  assert.ok(!html.includes('id="command-library-menu"'));
  assert.match(html,/id="dungeon-spellbook-shortcut"[^>]*aria-label="Open party spellbook"/);
});
test('journal endpoint validates the run without visiting, moving, rolling or resolving a scene',()=>{
  const source=fs.readFileSync('server.js','utf8'),start=source.indexOf("app.post('/journal/view'"),end=source.indexOf("app.post('/quest-scenes/view'",start);
  let handler,reads=0;const state={getDungeonRunId:()=> 'run'};
  vm.runInNewContext(source.slice(start,end),{app:{post:(path,cb)=>{if(path==='/journal/view')handler=cb;}},sharedState:state,
    AdventureJournal:{project:s=>{assert.equal(s,state);reads++;return{quest:'The Water Debt'};}},console});
  const response=()=>({status(n){this.code=n;return this;},json(v){this.value=v;}});
  let res=response();handler({body:{runId:'old'}},res);assert.equal(res.code,409);assert.equal(reads,0);
  res=response();handler({body:{runId:'run'}},res);assert.equal(res.value.quest,'The Water Debt');assert.equal(reads,1);
});
