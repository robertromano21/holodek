'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture() {
  const nodes=[],requests=[],applied=[],commands=[];
  class Element {
    constructor(tag){this.tag=tag;this.style={};this.children=[];this.listeners={};nodes.push(this);}
    append(...children){children.forEach(c=>this.appendChild(c));}
    appendChild(c){c.parent=this;this.children.push(c);return c;}
    setAttribute(k,v){this[k]=v;}
    addEventListener(k,cb){this.listeners[k]=cb;}
    remove(){this.removed=true;}
    click(){return this.listeners.click?.();}
  }
  const body=new Element('body'),input=new Element('textarea');input.value='unfinished draft';
  const document={body,createElement:t=>new Element(t),getElementById:()=>input,
    querySelectorAll:()=>nodes.filter(n=>n.className?.includes('popup-container')&&!n.removed)};
  const dungeon={geoKey:'1,0,0'},window={dungeonRunId:'run',currentDungeon:dungeon,
    getDungeonLifeContext:()=>({dungeon,player:{x:2.5,y:2.5},actors:[{name:'Edrin',mazeX:3,mazeY:2}]}),
    getQuestSceneParticipants:()=>['Edrin'],applyRealtimeCombatResult:async e=>applied.push(e),chatbotprocessinput:()=>commands.push(input.value)};
  let fetchHook;
  const fetch=async(path,options)=> {
    const request={path,body:JSON.parse(options.body)};requests.push(request);
    if(fetchHook)return fetchHook(request);
    const result=path.endsWith('view')?{scene:{storyId:'s1',stageId:'hook',revision:0,title:'A debt',description:'Real requirements',
      text:'Edrin asks for the iron sigil.',options:[{id:'accept',label:'Accept the obligation',action:'continue'}]}}:
      {type:'quest_scene_result',eventId:'e1',runId:'run',geoKey:dungeon.geoKey,content:'Accepted.'};
    return{ok:true,json:async()=>result};
  };
  vm.runInNewContext(fs.readFileSync('assets/questSceneUi.js','utf8'),{window,document,fetch,console});
  return {window,input,requests,applied,commands,body,nodes,hook:v=>fetchHook=v,
    popup:()=>document.querySelectorAll()[0],button:()=>document.querySelectorAll()[0].children.find(n=>n.textContent==='Accept the obligation')};
}
test('quest popups use stored text, centered positioning and exact revision tokens while preserving a command draft',async()=>{
  const f=fixture();assert.equal(await f.window.QuestSceneUi.open('Edrin'),true);
  assert.equal(f.popup().style.cssText.includes('left:50%;top:50%'),true);
  await f.button().click();
  const request=f.requests.find(r=>r.path.endsWith('choose')).body;
  assert.equal(request.storyId,'s1');assert.equal(request.optionId,'accept');assert.equal(request.revision,0);
  assert.equal(request.actor,undefined);assert.equal(request.effect,undefined);
  assert.equal(f.input.value,'unfinished draft');assert.equal(f.applied.length,1);assert.deepEqual(f.commands,[]);
});
test('busy or paused games cannot open dialogues and only participating characters get the extra action',async()=>{
  const f=fixture();f.window.gamePaused=true;assert.equal(await f.window.QuestSceneUi.open('Edrin'),false);
  f.window.gamePaused=false;f.window.actionDiceState={active:true};assert.equal(await f.window.QuestSceneUi.open('Edrin'),false);
  f.window.actionDiceState=null;assert.equal(f.window.QuestSceneUi.addAction(f.body,'Ghost'),null);
  assert.ok(f.window.QuestSceneUi.addAction(f.body,'Edrin'));assert.equal(f.requests.length,0);
});
test('double clicks cannot duplicate a handoff and stale server choices retain the popup without applying state',async()=>{
  const f=fixture();await f.window.QuestSceneUi.open('Edrin');
  let resolve;f.hook(()=>new Promise(r=>resolve=r));
  const first=f.button().click();await f.button().click();assert.equal(f.requests.filter(r=>r.path.endsWith('choose')).length,1);
  resolve({ok:false,json:async()=>({error:'That choice is stale.'})});await first;
  assert.equal(f.applied.length,0);assert.ok(f.popup());assert.ok(f.popup().children.some(n=>n.textContent==='That choice is stale.'));
});
test('an old room response cannot open a dialogue over a newly entered room',async()=>{
  const f=fixture();let resolve;f.hook(()=>new Promise(r=>resolve=r));
  const opening=f.window.QuestSceneUi.open('Edrin');f.window.currentDungeon={geoKey:'2,0,0'};
  resolve({ok:true,json:async()=>({scene:{title:'Old room'}})});assert.equal(await opening,false);assert.equal(f.popup(),undefined);
});
