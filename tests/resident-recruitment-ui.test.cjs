'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const nodes=[],requests=[],commands=[],applied=[],attacks=[],events=new Map();
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
  const request={id:'job',source:'engine-resident-favor-v1',type:'resident-favor',runId:'run-a',roomKey:'1,0,0',floor:'street',
    recipient:actor.name,status:'offered',description:'Return the existing ring before I join your party.',invitationPending:true};
  let floor='floor-a',busy=false,present=true,conditional=false;
  const window={combatCharacters:[actor],dungeonRunId:'run-a',currentDungeon:dungeon,
    CityFloorScope:{token:()=>floor},GameCommandGate:{busy:()=>busy},isDungeonActorPresent:()=>present,
    getDungeonLifeContext:()=>({dungeon,player:{x:5,y:5},actors:[actor]}),
    getEconomyResidentInfo:()=>({kind:'mission',jobs:true,introduced:true,recruitmentCondition:conditional?request:null}),prepareEconomyState:async()=>{},
    openCombatCharacterSheet:()=>{sheet.style.display='block';},centerPartySheet(){},
    chatbotprocessinput:()=>commands.push(input.value)};
  window.applyRealtimeCombatResult=async event=>applied.push(event);
  window.beginEncounterCombat=name=>attacks.push(name);
  const fetch=async(path,options)=>{
    requests.push({path,body:JSON.parse(options.body)});
    const result=path==='/quest-scenes/view'?{scene:{title:'A Local Job',actor:actor.name,text:'Authored job offer.',
      description:'Authored objective.',storyId:'story',stageId:'offer',revision:3,
      options:[{id:'accept',label:'Accept Job'},{id:'reject',label:'Reject Job'}]}}:
      path==='/recruit/invite'?{type:'economy_result',passive:true,eventId:'invite-1',runId:'run-a',geoKey:'1,0,0',disposition:'Neutral',rejected:true,
        content:actor.name+' declines your invitation.',updatedGameConsole:'Coordinates: X: 1, Y: 0, Z: 0'}:
      {silver:3,revision:1,recruitmentCondition:conditional?{missionId:'job'}:null,missions:[{id:'job',recipient:actor.name,type:conditional?'resident-favor':'ordinary',status:'offered',description:'Authored job offer.'}]};
    return{ok:true,json:async()=>result};
  };
  const context={window,document,fetch,console};
  for(const file of ['combatCharacterUi','commerceUi','questSceneUi'])vm.runInNewContext(fs.readFileSync('assets/'+file+'.js','utf8'),context);
  return{window,document,actor,input,nodes,requests,commands,applied,attacks,events,sheet,
    floor:value=>floor=value,busy:value=>busy=value,present:value=>present=value,conditional:value=>conditional=value,
    buttons:label=>nodes.filter(node=>node.isConnected&&node.tag==='button'&&node.textContent===label),
    button:label=>nodes.find(node=>node.isConnected&&node.tag==='button'&&node.textContent===label)};
}

test('clicking a job-offering resident keeps recruitment next to the job invitation without accepting a job',async()=>{
  const f=fixture();assert.equal(f.window.CombatCharacterUi.open(f.actor),true);
  assert.ok(f.button('View Job Offers'));assert.ok(f.button('Not Now'));assert.equal(f.buttons('Add to Party').length,1);
  assert.equal(f.requests.length,0);f.button('Add to Party').click();
  await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);assert.equal(f.requests.filter(r=>r.path==='/recruit/invite').length,0);
  assert.equal(f.window.CommerceUi.hasInteraction(),false);assert.equal(f.button('View Job Offers'),undefined);
});

test('opening a job menu retains both the contract and the shared dialogue recruitment adjudication',async()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);await f.button('View Job Offers').click();
  assert.ok(f.button('Accept Local Contract'));assert.equal(f.buttons('Add to Party').length,1);
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);
  assert.equal(f.requests.filter(request=>request.path==='/recruit/invite').length,0);assert.ok(!f.requests.some(request=>request.path==='/economy/action'));assert.equal(f.window.CommerceUi.hasInteraction(),false);
});

test('Not Now opens the ordinary character sheet and its actions without looping back to job offers',async()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);f.button('Not Now').click();
  assert.equal(f.sheet.style.display,'block');assert.equal(f.button('View Job Offers'),undefined);
  assert.ok(f.button('Add to Party'));assert.ok(f.button('Attack'));assert.ok(f.button('Give Item'));assert.ok(f.button('Local Contract'));
  assert.equal(f.window.CommerceUi.hasInteraction(),false);assert.equal(f.requests.length,0);
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);
});

test('a stale Not Now invitation cannot inspect a resident in another room',()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);f.window.currentDungeon={geoKey:'2,0,0'};
  f.button('Not Now').click();assert.equal(f.sheet.style.display,undefined);assert.equal(f.requests.length,0);
});

test('quest conversations retain accept/reject alongside recruitment without silently resolving the quest',async()=>{
  const f=fixture();assert.equal(await f.window.QuestSceneUi.open(f.actor.name),true);
  assert.ok(f.button('Accept Job'));assert.ok(f.button('Reject Job'));assert.ok(f.button('Later'));
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);
  assert.equal(f.requests.filter(request=>request.path==='/quest-scenes/choose').length,0);assert.equal(f.events.has('keydown'),false);
});

test('the quest actor is used when the scene opens without an explicit selected name',async()=>{
  const f=fixture();await f.window.QuestSceneUi.open(null,{silent:true});
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);
});

test('service providers retain direct services plus recruitment with the same menu cleanup',async()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>({kind:'shop',introduced:true});
  f.window.CombatCharacterUi.open(f.actor);assert.ok(f.button('Access Services'));
  const recruit=f.button('Add to Party');recruit.click();recruit.click();await Promise.resolve();
  assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);assert.equal(f.window.CommerceUi.hasInteraction(),false);
});

test('ordinary monster sheets use the same recruitment action without changing identity or stats',async()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>null;
  const original=JSON.stringify(f.actor);f.window.CombatCharacterUi.open(f.actor);
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);assert.equal(JSON.stringify(f.actor),original);
});

test('non-recruitable deities, existing party members and incapacitated actors do not gain recruitment via job menus',async()=>{
  for(const change of [a=>a.recruitable=false,a=>a.type='npc',a=>a.hp=0,a=>a.state='Dead',a=>a.state='Dying',a=>a.state='Unconscious',
    (_a,f)=>f.window.PantheonCharacters={canRecruit:()=>false}]){
    const f=fixture();change(f.actor,f);await f.window.CommerceUi.open(f.actor.name);assert.equal(f.button('Add to Party'),undefined);
    await f.window.QuestSceneUi.open(f.actor.name);assert.equal(f.button('Add to Party'),undefined);
  }
});

test('recruitment preserves drafts and refuses busy, combat, pause, death and stale resident actions',async()=>{
  for(const change of [f=>f.input.value='unfinished command',f=>f.busy(true),f=>f.window.gamePaused=true,
    f=>f.window.actionDiceState={active:{kind:'combat'}},f=>f.window._characterStartupPending=true,
    f=>f.window._combatCommandPending=true,f=>f.window._combatRoundActiveUntil=Date.now()+60000,
    f=>f.window._gameOver=true,f=>f.window._playerUnconscious=true,f=>f.window._deathSceneActive=true,
    f=>f.window.dungeonRunId='run-b',f=>f.window.currentDungeon={geoKey:'2,0,0'},f=>f.floor('floor-b'),
    f=>f.present(false),f=>f.actor.discoveryState='pending',f=>f.actor.type='npc',f=>f.actor.recruitable=false,
    f=>f.actor.hp=0,f=>f.window.combatCharacters=[]]){
    const f=fixture();f.window.CombatCharacterUi.open(f.actor);const recruit=f.button('Add to Party');change(f);const draft=f.input.value;
    recruit.click();await Promise.resolve();assert.deepEqual(f.commands,[]);assert.equal(f.requests.filter(r=>r.path==='/recruit/invite').length,0);assert.equal(f.input.value,draft);
  }
});

test('a recruitment click while a job acceptance is in flight cannot submit a competing party command',async()=>{
  const f=fixture();let release;
  f.window.prepareEconomyState=()=>new Promise(resolve=>release=resolve);
  f.window.CommerceUi.invite(f.actor.name);const recruit=f.button('Add to Party'),opening=f.button('View Job Offers').click();
  recruit.click();await Promise.resolve();assert.deepEqual(f.commands,[]);assert.equal(f.requests.filter(r=>r.path==='/recruit/invite').length,0);release();await opening;
  f.button('Add to Party').click();await Promise.resolve();assert.deepEqual(f.commands,['Ask Resident With Work to join my party.']);
});

test('the changed browser scripts carry a matching cache version',()=>{
  const html=fs.readFileSync('assets/index.html','utf8');
  assert.ok(html.includes('combatCharacterUi.js?v=recruitment-local-tasks-1'));
  assert.ok(html.includes('questSceneUi.js?v=resident-recruitment-1'));
  assert.ok(html.includes('commerceUi.js?v=recruitment-local-tasks-1'));
  assert.ok(html.includes('dungeonLifeUi.js?v=group-recruitment-1'));
  assert.ok(html.includes('game.js?v=quest-handoff-recovery-1'));
});
test('typed Add-to-Party commands become dialogue invitations and the legacy party mutations are absent',()=>{
  const source=fs.readFileSync('assets/game.js','utf8'),start=source.indexOf('  // Legacy typed/menu commands share the dialogue invitation path.');
  const code=source.slice(start,source.indexOf('  let userWords =',start));assert.ok(start>0);
  for(const name of ['Vyth Aerir',"O'Ruun the Watcher"]){const context={userInput:`add ${name} to party`};vm.runInNewContext(code,context);
    assert.equal(context.userInput,`Ask ${name} to join my party.`);
    assert.equal(require('../retort/holodekNarration').invitationHint(context.userInput),true);
  }
  assert.ok(!source.includes('const addMonsterToPartyPattern'));
  assert.ok(!source.includes('// Process adding a monster to the party'));
});

test('clicking a conditional recruitment contact opens the character sheet with a separate request action',async()=>{
  const f=fixture();f.conditional(true);
  f.window.CombatCharacterUi.open(f.actor);assert.equal(f.sheet.style.display,'block');assert.ok(f.button('Recruitment Invitation'));
  assert.equal(f.button('Accept Request'),undefined);assert.equal(f.button('Decline Request'),undefined);
  assert.equal(f.button('View Job Offers'),undefined);assert.equal(f.button('Accept Local Contract'),undefined);assert.equal(f.button('Add to Party'),undefined);
  await f.button('Recruitment Invitation').click();assert.ok(f.button('Accept Request'));assert.ok(f.button('Decline Request'));
  f.window.CombatCharacterUi.open(f.actor,{services:false});assert.equal(f.button('Add to Party'),undefined);
  assert.deepEqual(f.commands,[]);assert.equal(f.requests.length,0);
});
test('a previously rendered recruitment button cannot bypass a newly created favor condition',()=>{
  const f=fixture();f.window.CombatCharacterUi.open(f.actor);const add=f.button('Add to Party');f.conditional(true);add.click();assert.deepEqual(f.commands,[]);
});
test('the real browser metadata derives conditional recruitment from current saved job status',()=>{
  const f=fixture(),source=fs.readFileSync('assets/game.js','utf8');
  const room={name:'Pale Wind Approach',inhabitants:{actors:{}},minorMissions:{job:{source:'engine-resident-favor-v1',type:'resident-favor',recipient:f.actor.name,
    roomKey:'1,0,0',runId:'run-a',status:'offered'}}};
  f.window.EconomyRules=require('../assets/economyRules');
  vm.runInNewContext(source.slice(source.indexOf('window.getEconomyResidentInfo ='),source.indexOf('window.commitLocalPartyChange =')),
    {window:f.window,currentDungeon:f.window.currentDungeon,roomNameDatabase:new Map([['1,0,0',room]])});
  for(const status of ['offered','accepted']){room.minorMissions.job.status=status;assert.ok(f.window.getEconomyResidentInfo(f.actor.name).recruitmentCondition);}
  for(const status of ['completed','withdrawn']){room.minorMissions.job.status=status;assert.equal(f.window.getEconomyResidentInfo(f.actor.name),null);}
});
test('accepting a quest job closes the popup without opening the follow-up scene automatically',async()=>{
  const f=fixture();await f.window.QuestSceneUi.open(f.actor.name);await f.button('Accept Job').click();
  assert.equal(f.button('Accept Job'),undefined);assert.equal(f.button('Later'),undefined);
  assert.equal(f.requests.filter(r=>r.path==='/quest-scenes/view').length,1);
});
