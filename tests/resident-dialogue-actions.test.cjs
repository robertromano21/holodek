'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../retort/economy'), R = require('../assets/economyRules'), I = require('../assets/dungeonInhabitants');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const Give = require('../retort/itemTransfer');
const { createPopulationService } = require('../retort/roomPopulation');
const Puzzles = require('../assets/physicalPuzzles');
function fixture() {
  const geoKey = '1,0,0', d = { geoKey, start: { x: 4, y: 4 }, layout: { width: 16, height: 16 }, cells: {}, sceneObjects: [], tiles: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 3 };
  const row = (name, hp = 12) => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Cleric', Level: 2, AC: 10, HP: hp, MaxHP: 20 }, 6, name === 'Benedict' ? 'pc' : 'npc');
  const p = I.createPopulation(geoKey, [{ name: 'Vyth Aerir', race: 'Human', className: 'Cleric', allegiance: 'Neutral', job: 'toll-keeper', encounterId: 'keeper' }]);
  Object.assign(p.actors['Vyth Aerir'], { hp: 12, position: { x: 5, y: 4 }, home: { x: 5, y: 4 }, sheet: row('Vyth Aerir') });
  p.groups[0].site = { x: 5, y: 4 };
  let text = `Room Name: Pale Wind Approach\nCoordinates: X: 1, Y: 0, Z: 0\nSilver Pieces: 0\nCurrent Quest: None\nQuest Progress: None\nInventory: Empty\nInventory Properties: None\nObjects in Room: None\nObjects in Room Properties: None\nPC:\n${row('Benedict')}\nNPCs in Party:\n${row('Ally')}\nMonsters in Room:\n${row('Vyth Aerir').replace('State: Friendly', 'State: Neutral')}\nMonsters Equipped Properties: None\nMonsters State: Neutral\nRooms Visited: 2`;
  let wire = JSON.stringify([{ name: 'Benedict', type: 'pc', hp: 12, mazeX: 4, mazeY: 4, mazeRoomKey: geoKey },
    { name: 'Ally', type: 'npc', hp: 12, mazeX: 4, mazeY: 5, mazeRoomKey: geoKey },
    { name: 'Vyth Aerir', type: 'monster', hp: 12, state: 'Neutral', mazeX: 5, mazeY: 4, mazeRoomKey: geoKey }]);
  let db = JSON.stringify({ '0,0,0': {}, [geoKey]: { name: 'Pale Wind Approach', objects: [], inhabitants: p, monsters: { inRoom: row('Vyth Aerir') } } });
  let paused = false;
  const state = { getDungeonRunId: () => 'test-run', getLastCoords: () => ({ x: 1, y: 0, z: 0 }),
    getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => db = v,
    getCombatCharactersString: () => wire, setCombatCharactersString: v => wire = v,
    getRoomPopulation: k => k === geoKey ? p : null, setRoomPopulation: (k, value) => { if (k === geoKey && value !== p) Object.assign(p, value); },
    getRoomDungeonForSimulation: () => d, getCurrentTasks: () => [], getCurrentTaskIndex: () => 0,
    getGamePaused: () => paused };
  const service = createPopulationService(state);
  E.start(state, { Name: 'Benedict' }, [{ Name: 'Ally' }, { Name: 'Mortacia' }]);
  let seq = 0;
  const objectView = { names: [], camera: { x: 4.5, y: 4.5, eyeZ: .65, dirX: 0, dirY: 1, planeScale: .577, verticalScale: 1.73, viewShift: 0, aspect: 1.8 } };
  const action = input => E.action(state, service, { runId: 'test-run', geoKey, revision: E.project(state).revision, nonce: 'test-action:' + ++seq,
    objectView: { ...objectView, names: d.sceneObjects.map(o => o.name) }, ...input });
  const change = fn => { const data = JSON.parse(db); fn(data); db = JSON.stringify(data); };
  const inventory = (item, count = 1) => { text = E.write(E.write(text, 'Inventory', Array(count).fill(item.name).join(', ')), 'Inventory Properties', JSON.stringify(item)); };
  const business = kind => { change(data => data[geoKey].services = { shop: { id: 'shop', kind, operator: 'Vyth Aerir', originalOperator: 'Vyth Aerir', stock: [{ ...R.healingPotion(6), quantity: 2 }], stockAuthorship:{version:1,status:'ready'}, till: 12, revision: 0 } }); };
  return { state, service, action, change, inventory, business, p, d, row, book: () => E.project(state), pause: () => paused = true, db: () => JSON.parse(db) };
}

const F=require('../retort/residentFavors');
const author=async()=>({title:'Study the Hollow Wind',objectiveId:'survey',focus:'the wind at the bright stones',offer:'Help me watch the wind from these stones, then report your observations. Once my work is finished, I will join you if you invite me.'});
async function offer(f,write=author){f.p.actors['Vyth Aerir'].encounteredAt=1;f.p.actors['Vyth Aerir'].job='wind observer';f.p.actors['Vyth Aerir'].activity='studies skipping pebbles and wind by the bright stones';return F.prepare(f.state,null,'ask monsters about the wind and ask how we can help',{audibleNames:['Vyth Aerir'],population:f.p,author:write});}
const mission=f=>Object.values(f.db()['1,0,0'].minorMissions||{})[0];
const tick=(f,n)=>f.change(db=>{db['0,0,0'].spellSystem={...db['0,0,0'].spellSystem,runId:'test-run',clock:n};});

function addGroupMate(f,sameGroup=true){
  const name='Calthokael Qyas',actor={...f.p.actors['Vyth Aerir'],name,encounteredAt:1,position:{x:5,y:5},sheet:f.row(name)};
  if(!sameGroup){actor.encounterId='other-group';f.p.groups.push({id:actor.encounterId,members:[name]});}
  else f.p.groups[0].members.push(name);
  f.p.actors[name]=actor;
  f.state.setCombatCharactersString(JSON.stringify([...JSON.parse(f.state.getCombatCharactersString()),{name,type:'monster',hp:12,state:'Neutral',mazeX:5,mazeY:5,mazeRoomKey:'1,0,0'}]));
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Monsters Equipped Properties:',f.row(name)+'\nMonsters Equipped Properties:'));
  f.change(db=>db['1,0,0'].inhabitants=f.p);return name;
}
test('two residents in one group expose one offer enum and cannot persist a second favor across turns',async()=>{
  const f=fixture();ready(f);const mate=addGroupMate(f),options=F.dialogueOptions(f.state,['Vyth Aerir',mate]);
  assert.equal(options.filter(o=>o.actions.includes('offer-favor')).length,1);
  const stale=F.dialogueOptions(f.state,[mate])[0];await converse(f,invited,'offer-favor');
  const second=F.dialogueOptions(f.state,[mate])[0];assert.ok(!second.actions.includes('offer-favor'));assert.equal(second.groupContract.actor,'Vyth Aerir');
  assert.throws(()=>F.applyDialogue(f.state,f.service,{speaker:mate,recipient:'PC',line:'I offer another wind job.',socialAction:'offer-favor',playerInvited:true,
    favorTitle:'Another Wind',favorFocus:'wind',conditions:[{objectiveId:'survey',observationCount:'2',observationInterval:'2'}]},stale),/not available/);
  assert.equal(Object.values(f.db()['1,0,0'].minorMissions).filter(m=>m.type==='resident-favor').length,1);
  const chat=F.applyDialogue(f.state,f.service,{speaker:mate,recipient:'PC',line:'Vyth has already told you what help we need.',socialAction:'discuss-favor',playerInvited:false},second);
  assert.match(chat.content,/Group favor with Vyth/);
});
test('help requests create one job per group while separate groups retain independent offers',async()=>{
  for(const sameGroup of [true,false]){
    const f=fixture();ready(f);const mate=addGroupMate(f,sameGroup);let authored=0;
    const offers=await F.prepare(f.state,null,'how can we help?',{audibleNames:['Vyth Aerir',mate],population:f.p,author:async()=>{authored++;return author();}});
    assert.equal(offers.length,sameGroup?1:2);assert.equal(authored,sameGroup?1:2);
  }
});
test('a two-monster live reply supplies offer-favor to only one speaker and persists one job',async()=>{
  const f=fixture();ready(f);const mate=addGroupMate(f),original=Work.request,schemas=[];
  Work.request=async(_$,component,schema,brief,validate)=>{
    let raw;if(component==='story-scene')raw={prose:'The two observers listen.',interaction:'work',speakers:['Vyth Aerir',mate]};
    else if(component==='npc-live-speech'){
      const first=!schemas.length;schemas.push(schema);assert.match(brief,/ONE JOB PER MONSTER GROUP/);
      raw={action:'nods.',line:first?'Help me observe the wind twice, then report back.':'Vyth has explained the work. I will keep listening.',remember:'',recipient:'PC',attention:'addressing',
        socialAction:first?'offer-favor':'none',playerInvited:false,conditions:first?[{objectiveId:'survey',observationCount:'2',observationInterval:'2'}]:[],favorTitle:first?'The Wind Study':'',favorFocus:first?'the wind':''};
    }else raw={lines:['The hollow still carries the wind.','The pebble has not moved.']};
    return validate?validate(raw):raw;
  };
  try{
    const result=await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:'What work needs doing here?',characters:[{name:'Vyth Aerir'},{name:mate}],
      audibleNames:['Vyth Aerir',mate],socialInteractions:F.dialogueOptions(f.state,['Vyth Aerir',mate]),onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.ok(schemas[0].socialAction.enum.includes('offer-favor'));assert.ok(!schemas[1].socialAction.enum.includes('offer-favor'));
    assert.equal(result.socialResults.length,1);assert.equal(Object.values(f.db()['1,0,0'].minorMissions).length,1);
  }finally{Work.request=original;}
});
test('legacy duplicate offers withdraw the unaccepted job and preserve accepted evidence and consent',async()=>{
  const f=fixture();ready(f);const mate=addGroupMate(f);await converse(f,invited,'offer-favor');
  F.command(f.state,f.service,'accept favor from Vyth Aerir');
  f.change(db=>{const original=Object.values(db['1,0,0'].minorMissions)[0];original.observations=[{id:'keep-proof',clock:1}];
    db['1,0,0'].minorMissions.duplicate={...structuredClone(original),id:'duplicate',recipient:mate,status:'offered',observations:[]};});
  const before=structuredClone(mission(f)),update=E.refresh(f.state);
  assert.equal(update.changed,true);assert.ok(update.notices.some(line=>line.includes('duplicate offer was withdrawn')));
  assert.deepEqual(mission(f).observations,before.observations);assert.deepEqual(mission(f).conditionalConsent,before.conditionalConsent);assert.equal(mission(f).status,'accepted');
  assert.equal(f.db()['1,0,0'].minorMissions.duplicate.status,'withdrawn');assert.equal(F.context(f.state,[mate]).length,0);
  const view=E.view(f.state,'Vyth Aerir');assert.equal(view.recruitmentCondition.missionId,before.id);
  assert.throws(()=>F.accept(f.state,{...before,id:'duplicate',recipient:mate,status:'offered'}),/already has a favor/);
});


const Work=require('../retort/holodekRoomWork'),Narration=require('../retort/holodekNarration');

const invited="tell monsters my tale and ask if they'd like to join my quest";
test('explicit invitations in a tale bind recruitment without treating ordinary lore or negated invitations as consent',()=>{
  for(const input of [invited,'tell monsters my tale and ask if they would like to join my quest','Would you accompany us?','Please join my party','Invite Vyth to our quest'])
    assert.equal(Narration.invitationHint(input),true,input);
  for(const input of ['Tell me about the quest','How can we help?','Do not ask the monsters to join my quest',"Tell Vyth I don't want them to join my party",'Can I join your guild?','Invite Vyth to dinner','Invite Vyth to dinner with us','Invite Vyth to dinner to discuss our quest'])
    assert.equal(Narration.invitationHint(input),false,input);
});
test('the logged Calthokael invitation cannot downgrade to conversation, deny residents, or silently choose none',async()=>{
  const f=fixture();ready(f);const mate=addGroupMate(f),original=Work.request,seen=[];
  Work.request=async(_$,component,schema,brief,validate)=>{
    seen.push(component);
    if(component==='story-scene'){
      assert.deepEqual(schema.interaction.enum,['recruitment']);assert.match(brief,/REQUIRED INTERACTION: recruitment/);assert.match(brief,/"nearbyResidents":\["Calthokael Qyas"\]/);
      assert.throws(()=>validate({prose:'The singer listens.',interaction:'conversation',speakers:[mate]}),/explicitly invited/);
      assert.throws(()=>validate({prose:'No monsters are present here to hear or answer you.',interaction:'recruitment',speakers:[mate]}),/supplied nearbyResidents/);
      assert.throws(()=>validate({prose:'No one joins your quest.',interaction:'recruitment',speakers:[mate]}),/before they speak/);
      return validate({prose:'Calthokael listens to the invitation, his unfinished rhythm falling quiet.',interaction:'recruitment',speakers:[mate]});
    }
    if(component==='npc-live-speech'){
      assert.ok(!schema.socialAction.enum.includes('none'));assert.ok(schema.socialAction.enum.includes('offer-favor'));assert.match(brief,/ACTUAL PLAYER INVITATION/);
      const base={action:'rests the shells against his bracer.',line:'I am not ready yet; let me finish the verse with Vyth first.',remember:'',recipient:'PC',attention:'addressing',
        socialAction:'none',playerInvited:false,conditions:[],favorTitle:'',favorFocus:''};
      assert.throws(()=>validate(base),/available social action/);
      assert.throws(()=>validate({...base,socialAction:'decline-invitation',playerInvited:true,line:'No monsters here to hear your tale.'}),/present resident/);
      assert.throws(()=>validate({...base,socialAction:'decline-invitation'}),/explicit invitation/);
      return validate({...base,socialAction:'offer-favor',playerInvited:true,line:'Help me observe the hollow wind twice, then report back; once the study is done, I will come with you.',
        conditions:[{objectiveId:'survey',observationCount:'2',observationInterval:'2'}],favorTitle:'The Unfinished Verse',favorFocus:'the hollow wind'});
    }
    return validate({lines:['The wind may give the verse its ending.','The pebble still rests in the hollow.']});
  };
  try{
    const result=await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:'tell monsters my tale and ask if they would like to join my quest',
      characters:[{name:mate,partyMember:false,allegiance:'Friendly'}],audibleNames:[mate],socialInteractions:F.dialogueOptions(f.state,[mate]),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null});
    assert.equal(mission(f).recipient,mate);assert.equal(mission(f).status,'offered');assert.equal(mission(f).invitationPending,true);
    assert.equal(result.socialResults[0].action,'offer-favor');assert.doesNotMatch(result.content,/No monsters|No one joins/);
    assert.equal(seen.filter(c=>c==='npc-live-speech').length,1);
  }finally{Work.request=original;}
});
test('the live final-story branch routes resident invitations through enums for non-local models',async()=>{
  const fs=require('fs'),vm=require('vm'),source=fs.readFileSync('retort/retortWithUserInput.js','utf8');
  const start=source.indexOf('  const socialInteractions ='),end=source.indexOf('  if(result.socialResults?.length)',start);
  const f=fixture();ready(f);let used=false;
  const sandbox={ResidentFavors:F,sharedState:f.state,audibleNames:['Vyth Aerir'],enteringRoom:false,userInput:invited,isAutoSimAdvance:false,responseAudience:null,
    isHolodek1:false,$:{assistant:{generation:()=>{throw Error('Invitation bypassed enum mechanics');}}},perceivedGameConsole:f.state.getUpdatedGameConsole(),currentSituation:'',
    dialogueRoster:JSON.parse(f.state.getCombatCharactersString()),population:f.p,describeCharacters:()=>[],initialArrival:false,activeTask:null,residentFavorContext:[],residentFavorOffers:[],
    populationService:f.service,questUpdate:'',entryQuestContact:null,physicalPuzzleResult:null,characterMemory:[],updatedGameConsole:f.state.getUpdatedGameConsole(),
    require:name=>name==='./holodekNarration'?{generate:async(_$,options)=>{used=true;assert.equal(options.socialInteractions[0].name,'Vyth Aerir');const r=await converse(f,invited,'accept-invitation');return r.result;}}:
      name==='./holodekPromptRecall'?{select:async()=>({text:''})}:require(name)};
  sandbox.sharedState.getCurrentQuest=()=>'';
  await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',sandbox);
  assert.equal(used,true);assert.ok(mission(f).recruitedAt);
});

for(const stale of [false,true])test('first-approach encounter '+(stale?'discards stale favor proposals':'installs monster-initiated favor without accepting it'),async()=>{
  const f=fixture();ready(f);const original=Narration.generate;let generated=false;
  const dialogueMemory={characters:{},recent:[]};f.state.getDialogueMemory=()=>dialogueMemory;
  const runtime={retort:fn=>fn,run:async fn=>fn({})};
  Narration.generate=async(_$,options)=>{
    generated=true;assert.equal(options.encounter,true);assert.ok(options.socialInteractions[0].actions.includes('offer-favor'));
    assert.ok(!options.socialInteractions[0].actions.includes('accept-favor'));
    options.onSocialAction({speaker:'Vyth Aerir',recipient:'PC',line:'Help me watch the wind three times, then report back.',socialAction:'offer-favor',playerInvited:false,
      favorTitle:'The Hollow Wind',favorFocus:'the wind',conditions:[{objectiveId:'survey',observationCount:'3',observationInterval:'2'}]},options.socialInteractions[0]);
    assert.equal(mission(f),undefined,'Authoring cannot commit before stale checks.');
    return{content:'Vyth Aerir says, "[[SPEECH:"Vyth Aerir"]]Help me watch the wind three times, then report back.[[/SPEECH]]"'};
  };
  try{
    const result=await require('../retort/encounterNarration').narrateEncounter({state:f.state,service:f.service,runtime,isCurrent:()=>!stale,
      visit:{population:f.p,dialogue:[],encounters:[{names:['Vyth Aerir']}]}});
    assert.ok(generated);
    if(stale){assert.equal(result.stale,true);assert.equal(mission(f),undefined);}
    else{assert.equal(mission(f).status,'offered');assert.equal(mission(f).invitationPending,false);assert.match(result.story.content,/3 times/);
      const journal=require('../retort/adventureJournal').project(f.state);assert.equal(journal.contracts[0].status,'offered');}
  }finally{Narration.generate=original;}
});
function ready(f){f.p.actors['Vyth Aerir'].encounteredAt=1;f.p.actors['Vyth Aerir'].job='wind observer';}
async function converse(f,input,socialAction,extra={}) {
  ready(f);const original=Work.request,briefs=[],options=F.dialogueOptions(f.state,['Vyth Aerir']);
  Work.request=async(_$,component,_schema,brief,validate)=>{
    briefs.push({component,brief});
    const raw=component==='story-scene'?{prose:'The observer turns to listen.',interaction:'recruitment',speakers:['Vyth Aerir']}:
      component==='npc-live-speech'?{action:'lowers the pebble.',line:socialAction==='accept-invitation'?'Yes. I accept your invitation. I will travel with you.':
        socialAction==='offer-favor'?'I can come when this study is done. Help me observe the hollow wind twice, then report back.':
        socialAction==='decline-invitation'?'No. My family is still here, and I must stay with them.':
        socialAction==='report-favor'?'The observations are enough. Our bargain is fulfilled, and I will come with you.':'Agreed. Help me with the observations.',
        remember:'We discussed traveling together.',recipient:'PC',attention:'addressing',socialAction,playerInvited:true,
        favorObjectiveId:socialAction==='offer-favor'?'survey':'',favorTitle:socialAction==='offer-favor'?'The Hollow Wind':'',favorFocus:socialAction==='offer-favor'?'the hollow wind':'',...extra}:
      {lines:['The hollow has more to teach us.','Two observations are better than a guess.']};
    return validate?validate(raw):raw;
  };
  try{return{result:await Narration.generate({},{consoleText:f.state.getUpdatedGameConsole(),userInput:input,
    characters:[{name:'Vyth Aerir',job:'wind observer'}],audibleNames:['Vyth Aerir'],localFavors:F.context(f.state,['Vyth Aerir']),
    socialInteractions:options,onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null}),briefs};}
  finally{Work.request=original;}
}

test('the exact logged invitation needs no help keyword: live consent immediately recruits without a click',async()=>{
  const f=fixture();assert.equal(F.helpIntent(invited),false);const stale=f.state.getUpdatedGameConsole(),staleRoster=f.state.getCombatCharactersString();
  const {result,briefs}=await converse(f,invited,'accept-invitation');
  assert.equal(result.socialResults[0].action,'accept-invitation');assert.match(result.content,/joins the party/);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').filter(a=>a.name==='Vyth Aerir').length,1);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'npc');
  const receipt=mission(f);assert.equal(receipt.type,'resident-consent');assert.equal(receipt.consent.source,'engine-live-dialogue-v1');assert.ok(receipt.recruitedAt);
  assert.match(briefs.find(b=>b.component==='npc-live-speech').brief,/accept-invitation/);
  assert.equal(I.parseSheets(E.preserveInventory(f.state.getUpdatedGameConsole(),stale,f.state.getRoomNameDatabase())).some(a=>a.name==='Vyth Aerir'),false);
  assert.equal(JSON.parse(F.preserveRoster(f.state,staleRoster)).find(a=>a.name==='Vyth Aerir').type,'npc');
});
test('an encountered visible resident beyond ten tiles can accept the original invitation without moving closer',async()=>{
  const f=fixture();ready(f);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)f.d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  const roster=JSON.parse(f.state.getCombatCharactersString());Object.assign(roster.find(a=>a.name==='Vyth Aerir'),{mazeX:28,mazeY:4});
  Object.assign(f.p.actors['Vyth Aerir'].position,{x:28,y:4});f.state.setCombatCharactersString(JSON.stringify(roster));f.change(db=>db['1,0,0'].inhabitants=f.p);
  const view=I.perceive(f.d,roster,f.p,false,{conversation:true});assert.ok(view.conversational.some(a=>a.name==='Vyth Aerir'));
  const {result}=await converse(f,invited,'accept-invitation');assert.match(result.content,/joins the party/);
  const joined=JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir');assert.equal(joined.type,'npc');assert.equal(joined.mazeX,28);
});
for(const replay of ['vyth-cliff-corner','vyth-visible-ogre'])test(`Vyth can accept at the actual cliff position ${replay} where his exposed body is visible but his centre is hidden`,async()=>{
  const f=fixture();ready(f);const real=require(`./fixtures/${replay}.cjs`)();f.d.cells=real.dungeon.cells;f.d.start=real.dungeon.start;
  const roster=JSON.parse(f.state.getCombatCharactersString()),pc=roster.find(a=>a.type==='pc'),vyth=roster.find(a=>a.name==='Vyth Aerir');
  Object.assign(pc,{mazeX:real.dungeon.start.x,mazeY:real.dungeon.start.y,mazePoint:real.player});Object.assign(vyth,{race:'Ogre Barbarian',mazeX:real.target.x,mazeY:real.target.y,stature:{version:1,scale:1.88}});f.state.setCombatCharactersString(JSON.stringify(roster));
  Object.assign(f.p.actors['Vyth Aerir'],{race:vyth.race,position:real.target});f.change(db=>db['1,0,0'].inhabitants=f.p);
  assert.equal(I.lineClear(f.d,real.player,I.dialoguePoint(vyth)),false);assert.ok(F.dialogueOptions(f.state,['Vyth Aerir'])[0].actions.includes('accept-invitation'));
  const {result}=await converse(f,invited,'accept-invitation');assert.match(result.content,/joins the party/);
  assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'npc');
});

test('reluctance in actual dialogue makes a concrete offered favor, never an autoaccepted job',async()=>{
  const f=fixture();const {result}=await converse(f,invited,'offer-favor');
  assert.equal(mission(f).status,'offered');assert.equal(mission(f).objective.kind,'survey');assert.equal(mission(f).invitationPending,true);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').length,1);
  assert.match(result.content,/Local favor \(offered\)/);assert.match(result.content,/Observe the hollow wind/);
});

test('dialogue can accept work and report verified work; the standing conditional invitation recruits on completion',async()=>{
  const f=fixture();await converse(f,invited,'offer-favor');
  await converse(f,"Yes, we'll help with that",'accept-favor');assert.equal(mission(f).status,'accepted');
  tick(f,1);F.command(f.state,f.service,'observe for Vyth Aerir');tick(f,3);F.command(f.state,f.service,'observe for Vyth Aerir');
  const {result}=await converse(f,'Here are our findings','report-favor');
  assert.equal(mission(f).status,'completed');assert.ok(mission(f).recruitedAt);assert.match(result.content,/joins the party/);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').filter(a=>a.name==='Vyth Aerir').length,1);
});

test('a menu report also fulfills prior conditional consent without requiring another Add to Party click',async()=>{
  const f=fixture();await converse(f,invited,'offer-favor');F.command(f.state,f.service,'accept favor from Vyth Aerir');
  tick(f,1);F.command(f.state,f.service,'observe for Vyth Aerir');tick(f,3);F.command(f.state,f.service,'observe for Vyth Aerir');
  const request={kind:'report-favor',actor:'Vyth Aerir',missionId:mission(f).id};
  const response=f.action(request);assert.match(response.content,/joins the party/);assert.ok(mission(f).recruitedAt);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').filter(a=>a.name==='Vyth Aerir').length,1);
});

test('a refusal is a clear personal choice, and dialogue cannot grant a pending favor without evidence',async()=>{
  const f=fixture();const {result}=await converse(f,invited,'decline-invitation');assert.match(result.content,/declines the invitation/);assert.equal(mission(f),undefined);
  await converse(f,invited,'offer-favor');await converse(f,"We'll do the study",'accept-favor');
  ready(f);const option=F.dialogueOptions(f.state,['Vyth Aerir'])[0];
  assert.ok(!option.actions.includes('accept-invitation'));assert.ok(!option.actions.includes('report-favor'));
  assert.throws(()=>F.applyDialogue(f.state,f.service,{speaker:'Vyth Aerir',recipient:'PC',line:'I join.',socialAction:'accept-invitation',playerInvited:true},option),/not available/);
  assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').length,1);
});

test('no invitation, an invented objective, or an empty hedge cannot silently become a recruitment result',async()=>{
  for(const [action,extra]of [['accept-invitation',{playerInvited:false}],['offer-favor',{favorObjectiveId:'imaginary-artifact'}],['none',{}]]){
    const f=fixture();await assert.rejects(converse(f,invited,action,extra));assert.equal(mission(f),undefined);
    assert.equal(I.parseSheets(f.state.getUpdatedGameConsole(),'NPCs in Party').length,1);
  }
});

test('a response from another room, floor, run or speaker cannot commit the original conversation',()=>{
  const f=fixture();ready(f);const option=F.dialogueOptions(f.state,['Vyth Aerir'])[0];
  const event={speaker:'Vyth Aerir',recipient:'PC',line:'I will travel with you.',socialAction:'accept-invitation',playerInvited:true};
  assert.throws(()=>F.applyDialogue(f.state,f.service,{...event,speaker:'Ally'},option),/actual resident/);
  f.state.getDungeonRunId=()=> 'new-run';assert.throws(()=>F.applyDialogue(f.state,f.service,event,option),/conversation changed/);
});

test('the real response reconciliation keeps the joined actor in the party instead of restoring the stale monster roster',async()=>{
  const fs=require('fs'),vm=require('vm'),f=fixture();ready(f);const dialogueRoster=JSON.parse(f.state.getCombatCharactersString());
  const {result}=await converse(f,invited,'accept-invitation');
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),start=source.indexOf('  if(result.socialResults?.length)'),end=source.indexOf('  spoken = Inhabitants.extractDialogue',start);
  const ctx={result,sharedState:f.state,dialogueRoster,Inhabitants:I,population:f.p,require:name=>name==='./economy'?E:require(name),updatedGameConsole:''};
  vm.runInNewContext(source.slice(start,end),ctx);
  assert.equal(dialogueRoster.find(a=>a.name==='Vyth Aerir').type,'npc');assert.match(ctx.updatedGameConsole,/NPCs in Party:[\s\S]*Vyth Aerir/);
});

test('a full party keeps fulfilled conditional consent available instead of losing the completed favor',async()=>{
  const f=fixture();await converse(f,invited,'offer-favor');F.command(f.state,f.service,'accept favor from Vyth Aerir');
  tick(f,1);F.command(f.state,f.service,'observe for Vyth Aerir');tick(f,3);F.command(f.state,f.service,'observe for Vyth Aerir');
  let text=f.state.getUpdatedGameConsole();text=text.replace(I.sectionPattern('NPCs in Party'),(_,head,body)=>head+body+'\n'+Array.from({length:11},(_,i)=>f.row('Reserve '+i)).join('\n')+'\n');f.state.setUpdatedGameConsole(text);
  const response=f.action({kind:'report-favor',actor:'Vyth Aerir',missionId:mission(f).id});
  assert.equal(response.error,undefined);assert.match(response.content,/party is full/);assert.equal(mission(f).status,'completed');assert.equal(mission(f).recruitedAt,undefined);
});

test('starting-room work restrictions do not block a resident consenting to ordinary recruitment',()=>{
  const f=fixture();ready(f);f.state.getLastCoords=()=>({x:0,y:0,z:0});f.d.geoKey='0,0,0';f.p.geoKey='0,0,0';
  f.state.getRoomPopulation=k=>k==='0,0,0'?f.p:null;
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Coordinates: X: 1','Coordinates: X: 0'));
  f.state.setCombatCharactersString(JSON.stringify(JSON.parse(f.state.getCombatCharactersString()).map(a=>({...a,mazeRoomKey:'0,0,0'}))));
  f.change(db=>{db['0,0,0']={...db['0,0,0'],...db['1,0,0']};delete db['1,0,0'];});
  const option=F.dialogueOptions(f.state,['Vyth Aerir'])[0];assert.ok(option.actions.includes('accept-invitation'));assert.ok(!option.actions.includes('offer-favor'));
  const result=F.applyDialogue(f.state,f.service,{speaker:'Vyth Aerir',recipient:'PC',line:'Yes. I will come with you.',socialAction:'accept-invitation',playerInvited:true},option);
  assert.match(result.content,/joins the party/);
});

test('dialogue constructs compound side missions through enums and every condition needs real evidence',async()=>{
  const f=fixture();ready(f);f.change(db=>db['1,0,0'].objects=[{name:'wind ribbon',type:'other',magic:0}]);
  const retrieval=F.dialogueOptions(f.state,['Vyth Aerir'])[0].candidates.find(c=>c.item==='wind ribbon').id;
  await converse(f,invited,'offer-favor',{favorTitle:'The Wind Ribbon Study',conditions:[
    {objectiveId:'survey',observationCount:'3',observationInterval:'1'},
    {objectiveId:retrieval,observationCount:'',observationInterval:''}]});
  assert.equal(mission(f).conditions.length,2);assert.equal(mission(f).objective.observations,3);assert.equal(mission(f).objective.interval,1);
  F.command(f.state,f.service,'accept favor from Vyth Aerir');
  for(let i=1;i<=3;i++){tick(f,i);F.command(f.state,f.service,'observe for Vyth Aerir');}
  assert.equal(mission(f).readyToReport,false);assert.match(mission(f).progress,/1\/2 conditions/);
  assert.ok(!F.dialogueOptions(f.state,['Vyth Aerir'])[0].actions.includes('report-favor'));
  f.inventory({name:'wind ribbon',type:'other',magic:0});Give.give(f.state,f.service,'give wind ribbon to Vyth Aerir');E.refresh(f.state);
  assert.equal(mission(f).readyToReport,true);await converse(f,'Here are our findings and the ribbon','report-favor');
  assert.ok(mission(f).recruitedAt);assert.ok(mission(f).completionEvidence.some(r=>r.source==='engine-give-item-v1'));
});

test('condition enums reject invented targets, unsupported counts and duplicate requirements',()=>{
  const f=fixture();ready(f);const option=F.dialogueOptions(f.state,['Vyth Aerir'])[0],row={objectiveId:'survey',observationCount:'2',observationInterval:'2'};
  for(const conditions of [[{...row,objectiveId:'invented'}],[{...row,observationCount:'99'}],[row,row]])
    assert.throws(()=>F.authoredConditions({conditions,favorFocus:'wind'},option));
});

test('a favor accepted in the reply cannot be displayed afterward as an unaccepted offer',async()=>{
  const fs=require('fs'),vm=require('vm'),f=fixture();await converse(f,invited,'offer-favor');
  const residentFavorOffers=[structuredClone(mission(f))],dialogueRoster=JSON.parse(f.state.getCombatCharactersString());
  const {result}=await converse(f,"Yes, we'll help with that",'accept-favor');
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),start=source.indexOf('  if(result.socialResults?.length)'),end=source.indexOf('  spoken = Inhabitants.extractDialogue',start);
  vm.runInNewContext(source.slice(start,end),{result,sharedState:f.state,dialogueRoster,residentFavorOffers,Inhabitants:I,population:f.p,
    require:name=>name==='./economy'?E:require(name),updatedGameConsole:''});
  assert.equal(residentFavorOffers[0].status,'accepted');
});

test('real Retort JSON-schema transport carries dialogue enums and accepts unused empty fields before committing consent',async()=>{
  const Host=require('../retort/pcModelHost'),Models=require('../retort/gameModels'),Runtime=require('../retort/gameRetort'),Budget=require('../retort/holodekBudget');
  const f=fixture();ready(f);const previous=Models.current().id,requests=[];
  const host=Host.createHost({fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);assert.ok(Budget.tally(body.messages,[{response_format:body.response_format}]).total<=Budget.CEILING);
    const fields=body.response_format.json_schema.schema.properties;
    const raw=fields.prose?{prose:'The observer listens to your invitation.',interaction:'recruitment',speakers:['Vyth Aerir']}:
      fields.line?{action:'nods.',line:'Yes. I accept your invitation and will travel with you.',remember:'I agreed to travel with the party.',recipient:'PC',attention:'addressing',
        socialAction:'accept-invitation',playerInvited:true,conditions:[],favorTitle:'',favorFocus:''}:
      {lines:Array(fields.lines.minItems).fill('I will keep watching the hollow wind as we travel.')};
    return{ok:true,text:async()=>JSON.stringify({model:'holodek-1',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]})};
  }});
  const app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});Models.restore('holodek-1');
  try{
    const result=await app.run(app.retort($=>Narration.generate($,{consoleText:f.state.getUpdatedGameConsole(),userInput:invited,
      characters:[{name:'Vyth Aerir',job:'wind observer'}],audibleNames:['Vyth Aerir'],socialInteractions:F.dialogueOptions(f.state,['Vyth Aerir']),
      onSocialAction:(event,option)=>F.applyDialogue(f.state,f.service,event,option),location:null})),null,{shouldSaveToLog:false});
    assert.match(result.content,/joins the party/);assert.equal(requests.length,3);
    const schema=requests.find(r=>r.response_format.json_schema.schema.properties.line).response_format.json_schema.schema;
    assert.ok(schema.properties.socialAction.enum.includes('accept-invitation'));assert.equal(schema.properties.conditions.maxItems,3);
    assert.equal(JSON.parse(f.state.getCombatCharactersString()).find(a=>a.name==='Vyth Aerir').type,'npc');
  }finally{Models.restore(previous);}
});
