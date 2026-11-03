'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const nodes=[],requests=[],commands=[],events=new Map();
  class Element{
    constructor(tag){this.tag=tag;this.style={};this.children=[];this.listeners={};nodes.push(this);}
    append(...children){for(const child of children)this.appendChild(child);}
    appendChild(child){child.parent=this;this.children.push(child);return child;}
    after(child){this.parent?.appendChild(child);}
    setAttribute(key,value){this[key]=value;}
    addEventListener(key,fn){this.listeners[key]=fn;}
    querySelectorAll(){return this.children.flatMap(child=>[child,...child.querySelectorAll()]).filter(child=>child.tag==='button');}
    querySelector(selector){return this.querySelectorAll().find(child=>selector==='[data-recruit-action]'&&child['data-recruit-action']);}
    remove(){this.removed=true;}
    get isConnected(){return !this.removed&&(!this.parent||this.parent.isConnected);}
    click(){return this.listeners.click?.();}
  }
  const body=new Element('body'),input=new Element('textarea'),sheet=new Element('section');input.value='';body.appendChild(sheet);
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>id==='party-popup'?sheet:id==='chatuserinput'?input:null,
    querySelectorAll:()=>nodes.filter(node=>node.isConnected&&node.className?.includes('popup-container')),
    addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}};
  const actor={name:'Resident With Work',type:'monster',hp:12,state:'Neutral',allegiance:'Neutral'},dungeon={geoKey:'1,0,0'};
  let floor='floor-a',busy=false,present=true;
  const window={combatCharacters:[actor],dungeonRunId:'run-a',currentDungeon:dungeon,
    CityFloorScope:{token:()=>floor},GameCommandGate:{busy:()=>busy},isDungeonActorPresent:()=>present,
    getDungeonLifeContext:()=>({dungeon,player:{x:5,y:5},actors:[actor]}),
    getEconomyResidentInfo:()=>({kind:'mission',jobs:true,introduced:true}),prepareEconomyState:async()=>{},
    openCombatCharacterSheet:()=>{sheet.style.display='block';},centerPartySheet(){},
    chatbotprocessinput:()=>commands.push(input.value)};
  const fetch=async(path,options)=>{
    requests.push({path,body:JSON.parse(options.body)});
    const result=path==='/quest-scenes/view'?{scene:{title:'A Local Job',actor:actor.name,text:'Authored job offer.',
      description:'Authored objective.',storyId:'story',stageId:'offer',revision:3,
      options:[{id:'accept',label:'Accept Job'},{id:'reject',label:'Reject Job'}]}}:
      {silver:3,revision:1,missions:[{id:'job',status:'offered',description:'Authored job offer.'}]};
    return{ok:true,json:async()=>result};
  };
  const context={window,document,fetch,console};
  for(const file of ['combatCharacterUi','commerceUi','questSceneUi'])vm.runInNewContext(fs.readFileSync('assets/'+file+'.js','utf8'),context);
  return{window,document,actor,input,nodes,requests,commands,events,sheet,
    floor:value=>floor=value,busy:value=>busy=value,present:value=>present=value,
    buttons:label=>nodes.filter(node=>node.isConnected&&node.tag==='button'&&node.textContent===label),
    button:label=>nodes.find(node=>node.isConnected&&node.tag==='button'&&node.textContent===label)};
}

test('clicking a job-offering resident keeps recruitment next to the job invitation without accepting a job',()=>{
  const f=fixture();assert.equal(f.window.CombatCharacterUi.open(f.actor),true);
  assert.ok(f.button('View Job Offers'));assert.ok(f.button('Not Now'));assert.equal(f.buttons('Add to Party').length,1);
  assert.equal(f.requests.length,0);f.button('Add to Party').click();
  assert.deepEqual(f.commands,['add Resident With Work to party']);assert.equal(f.requests.length,0);
  assert.equal(f.window.CommerceUi.hasInteraction(),false);assert.equal(f.button('View Job Offers'),undefined);
});

test('opening a job menu retains both the contract and the independent normal recruitment command',async()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);await f.button('View Job Offers').click();
  assert.ok(f.button('Accept Local Contract'));assert.equal(f.buttons('Add to Party').length,1);
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);
  assert.ok(!f.requests.some(request=>request.path==='/economy/action'));assert.equal(f.window.CommerceUi.hasInteraction(),false);
});

test('Not Now opens the ordinary character sheet and its actions without looping back to job offers',()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);f.button('Not Now').click();
  assert.equal(f.sheet.style.display,'block');assert.equal(f.button('View Job Offers'),undefined);
  assert.ok(f.button('Add to Party'));assert.ok(f.button('Attack'));assert.ok(f.button('Give Item'));assert.ok(f.button('Local Contract'));
  assert.equal(f.window.CommerceUi.hasInteraction(),false);assert.equal(f.requests.length,0);
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);
});

test('a stale Not Now invitation cannot inspect a resident in another room',()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);f.window.currentDungeon={geoKey:'2,0,0'};
  f.button('Not Now').click();assert.equal(f.sheet.style.display,undefined);assert.equal(f.requests.length,0);
});

test('quest conversations retain accept/reject alongside recruitment without silently resolving the quest',async()=>{
  const f=fixture();assert.equal(await f.window.QuestSceneUi.open(f.actor.name),true);
  assert.ok(f.button('Accept Job'));assert.ok(f.button('Reject Job'));assert.ok(f.button('Later'));
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);
  assert.equal(f.requests.filter(request=>request.path==='/quest-scenes/choose').length,0);assert.equal(f.events.has('keydown'),false);
});

test('the quest actor is used when the scene opens without an explicit selected name',async()=>{
  const f=fixture();await f.window.QuestSceneUi.open(null,{silent:true});
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);
});

test('service providers retain direct services plus recruitment with the same menu cleanup',()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>({kind:'shop',introduced:true});
  f.window.CombatCharacterUi.open(f.actor);assert.ok(f.button('Access Services'));
  const recruit=f.button('Add to Party');recruit.click();recruit.click();
  assert.deepEqual(f.commands,['add Resident With Work to party']);assert.equal(f.window.CommerceUi.hasInteraction(),false);
});

test('ordinary monster sheets use the same recruitment action without changing identity or stats',()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>null;
  const original=JSON.stringify(f.actor);f.window.CombatCharacterUi.open(f.actor);
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);assert.equal(JSON.stringify(f.actor),original);
});

test('non-recruitable deities, existing party members and incapacitated actors do not gain recruitment via job menus',async()=>{
  for(const change of [a=>a.recruitable=false,a=>a.type='npc',a=>a.hp=0,a=>a.state='Dead',a=>a.state='Dying',a=>a.state='Unconscious',
    (_a,f)=>f.window.PantheonCharacters={canRecruit:()=>false}]){
    const f=fixture();change(f.actor,f);await f.window.CommerceUi.open(f.actor.name);assert.equal(f.button('Add to Party'),undefined);
    await f.window.QuestSceneUi.open(f.actor.name);assert.equal(f.button('Add to Party'),undefined);
  }
});

test('recruitment preserves drafts and refuses busy, combat, pause, death and stale resident actions',()=>{
  for(const change of [f=>f.input.value='unfinished command',f=>f.busy(true),f=>f.window.gamePaused=true,
    f=>f.window.actionDiceState={active:{kind:'combat'}},f=>f.window._characterStartupPending=true,
    f=>f.window._combatCommandPending=true,f=>f.window._combatRoundActiveUntil=Date.now()+60000,
    f=>f.window._gameOver=true,f=>f.window._playerUnconscious=true,f=>f.window._deathSceneActive=true,
    f=>f.window.dungeonRunId='run-b',f=>f.window.currentDungeon={geoKey:'2,0,0'},f=>f.floor('floor-b'),
    f=>f.present(false),f=>f.actor.discoveryState='pending',f=>f.actor.type='npc',f=>f.actor.recruitable=false,
    f=>f.actor.hp=0,f=>f.window.combatCharacters=[]]){
    const f=fixture();f.window.CombatCharacterUi.open(f.actor);const recruit=f.button('Add to Party');change(f);const draft=f.input.value;
    recruit.click();assert.deepEqual(f.commands,[]);assert.equal(f.input.value,draft);
  }
});

test('a recruitment click while a job acceptance is in flight cannot submit a competing party command',async()=>{
  const f=fixture();let release;
  f.window.prepareEconomyState=()=>new Promise(resolve=>release=resolve);
  f.window.CommerceUi.invite(f.actor.name);const recruit=f.button('Add to Party'),opening=f.button('View Job Offers').click();
  recruit.click();assert.deepEqual(f.commands,[]);release();await opening;
  f.button('Add to Party').click();assert.deepEqual(f.commands,['add Resident With Work to party']);
});

test('the changed browser scripts carry a matching cache version',()=>{
  const html=fs.readFileSync('assets/index.html','utf8');
  for(const file of ['combatCharacterUi','questSceneUi'])assert.ok(html.includes(file+'.js?v=resident-recruitment-1'));
  assert.ok(html.includes('commerceUi.js?v=starter-room-protection-1'));
});
