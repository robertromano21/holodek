'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const UI=require('../assets/combatCharacterUi'),game=fs.readFileSync(require.resolve('../assets/game'),'utf8');
test('map picking follows actual token footprints, respects transparent pixels, mirrors and topmost actors',()=>{
  const pc={name:'Mortacia',type:'pc'},npc={name:'Ally',type:'npc'};
  const targets=[{character:npc,x:10,y:20,size:43.75},{character:pc,x:10,y:20,size:43.75,flipped:true}];
  assert.equal(UI.pick(targets,31.875,41.875),pc);
  assert.equal(UI.pick(targets,31.875,41.875,t=>t.character===pc?0:255),npc);
  let sample;UI.pick(targets,10,20,(_t,u,v)=>{sample=[u,v];return 255;});assert.deepEqual(sample,[1,0]);
  assert.equal(UI.pick(targets,54,20),null);assert.equal(UI.pick(targets,NaN,20),null);
});

test('console, map and world selections share healing actions outside combat and initiative actions inside it',()=>{
  const heals=[],turns=[],nodes=[];
  const element=()=>({style:{},children:[],appendChild(c){this.children.push(c);},setAttribute(){},addEventListener(){},remove(){},querySelector(){return null;}});
  const sheet=element(),document={body:element(),querySelectorAll:()=>[],getElementById:id=>id==='party-popup'?sheet:null,createElement:()=>{const e=element();nodes.push(e);return e;}};
  const window={combatCharacters:[{name:'PC',type:'pc'},{name:'Ally',type:'npc'},{name:'Resident',type:'monster',hp:0,state:'Unconscious'}],
    openCombatCharacterSheet(){},SpellUi:{addTargetAction:(_box,name)=>heals.push(name)},CombatTurnUi:{addCharacterActions:(_box,actor)=>{
      if(window.actionDiceState?.active?.kind!=='combat')return false;turns.push(actor.name);return true;
    }}};
  vm.runInNewContext(fs.readFileSync('assets/combatCharacterUi.js','utf8'),{window,document});
  for(const actor of window.combatCharacters){
    const link={getAttribute:key=>key==='data-'+actor.type?actor.name:null};
    assert.equal(window.CombatCharacterUi.openConsoleTarget({closest:()=>link}),true);
  }
  assert.deepEqual(heals,['PC','Ally','Resident']);
  window.CombatCharacterUi.open({name:'Resident'});assert.equal(heals.at(-1),'Resident','Map/world use the same opener');
  window.actionDiceState={active:{kind:'combat'}};
  window.CombatCharacterUi.positionActions=()=>{};
  for(const actor of window.combatCharacters){
    const popup=element();popup.getBoundingClientRect=()=>({width:200});
    document.createElement=()=>popup;
    window.innerWidth=1000;window.innerHeight=800;
    assert.equal(window.CombatCharacterUi.open(actor),true);
  }
  assert.deepEqual(turns,['PC','Ally','Resident']);assert.equal(heals.length,4,'Combat never bypasses initiative with exploration casting');
});
test('PC controls and autonomous movement use screen-relative facing at every cardinal camera heading',()=>{
  const c={angle:0};vm.runInNewContext(game.slice(game.indexOf('function deriveFacingFromDelta('),game.indexOf('function advanceWalkFrame(')),c);
  vm.runInNewContext(game.slice(game.indexOf('function getCombatFacingFlip('),game.indexOf('function applyCombatVisualFrame(')),c);
  c.getCombatMapRotationAngle=()=>c.angle;
  for(const angle of[0,Math.PI/2,Math.PI,Math.PI*1.5]){
    c.angle=angle;
    for(const [key,want]of[['right','right'],['backward','right'],['strafeRight','right'],['left','left'],['forward','left'],['strafeLeft','left']]){
      assert.equal(c.combatFacingFromControls({[key]:true},'opposite'),want);
      assert.equal(c.getCombatFacingFlip({name:'Mortacia',type:'pc',facing:want}),want==='right');
      assert.equal(c.getCombatFacingFlip({name:'Benedict',type:'pc',facing:want}),want==='left','Catalog sprites start facing right');
    }
    for(const type of['npc','monster'])for(const [dx,dy,want]of[[1,0,'right'],[-1,0,'left'],[0,1,'right'],[0,-1,'left']]){
      const actor={name:'Mortacia',type};
      c.rememberCombatMovementFacing(actor,dx*Math.cos(angle)+dy*Math.sin(angle),-dx*Math.sin(angle)+dy*Math.cos(angle));
      assert.equal(c.getCombatFacingFlip(actor),want==='right');
    }
  }
  assert.equal(c.combatFacingFromControls({},'right'),'right');
});

test('clicking a living service resident offers services directly, while party, ordinary and downed actors retain their sheets',()=>{
  const invitations=[],sheets=[],element=()=>({style:{},appendChild(){},addEventListener(){},remove(){},setAttribute(){}}),sheet=element();
  const document={body:element(),querySelectorAll:()=>[],createElement:element,getElementById:()=>sheet};
  const window={combatCharacters:[{name:'Keeper',type:'monster',hp:7,state:'Neutral'},{name:'Visitor',type:'monster',hp:7,state:'Neutral'},
    {name:'Down',type:'monster',hp:0,state:'Unconscious'},{name:'Ally',type:'npc',hp:7,state:'Friendly'}],
    CommerceUi:{addAction(){},invite:name=>{invitations.push(name);return name==='Keeper';}},openCombatCharacterSheet:actor=>sheets.push(actor.name)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/combatCharacterUi'),'utf8'),{window,document});
  for(const actor of window.combatCharacters)assert.equal(window.CombatCharacterUi.open(actor),true);
  assert.deepEqual(invitations,['Keeper','Visitor']);assert.deepEqual(sheets,['Visitor','Down','Ally']);
});
