'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const game=fs.readFileSync(require.resolve('../assets/game'),'utf8'),life=fs.readFileSync(require.resolve('../assets/combatLifeUi'),'utf8');
const startup=require('../retort/startupTasks');
function fixture({session=new Map(),local=new Map([['conversationId','old-history'],['save-label','checkpoint']]),homebrew=true}={}){
  const messages=[],command={value:'',focus(){command.focused=true;}},calls={reload:0,remove:0};
  const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
  const document={activeElement:{tagName:'BODY'},hidden:false,addEventListener(){},querySelectorAll:()=>[],getElementById:id=>id==='chatuserinput'?command:null,
    createElement:()=>({listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}})};
  const root={document,dungeonRunId:'ended-run',_gameOver:true,_deathSceneActive:true,gamePaused:true,
    HolodekFlags:{HOMEBREW_ACTIVE:homebrew,CAMPAIGN_BUILDER:true},sessionStorage:storage(session),localStorage:storage(local),
    crypto:{randomUUID:()=> 'new-conversation'},location:{reload:()=>calls.reload++},displayMessage:text=>messages.push(text),
    fetch:()=>{throw Error('Menu navigation must not call the model or alter server gameplay.');}};
  const context=vm.createContext({window:root,document,Event,clearInterval(){}});
  for(const name of ['gameOverStartUi','combatLifeUi','playerControls'])vm.runInContext(fs.readFileSync(require.resolve('../assets/'+name),'utf8'),context);
  const status={runId:'ended-run',gameOver:{reason:'Third death is permanent.'},rescuesUsed:2,messageRevision:11};
  return{root,document,context,status,session,local,messages,command,calls};
}
test('returning after the third death opens a fresh menu conversation without resetting the ended run or deleting saves',()=>{
  const f=fixture();assert.equal(f.root.GameOverStartUi.returnToMenu('ended-run'),true);
  assert.equal(f.calls.reload,1);assert.equal(f.session.get('holodek-ended-run-menu'),'ended-run');
  assert.equal(f.local.get('conversationId'),'new-conversation');assert.equal(f.local.get('save-label'),'checkpoint');
  assert.equal(f.root._gameOver,true);assert.equal(f.root.gamePaused,true);assert.equal(f.root.dungeonRunId,'ended-run');
  f.root.GameOverStartUi.returnToMenu('ended-run');assert.equal(f.calls.reload,1);
});
test('reloaded game-over status shows the correct start menu once and keeps the dead adventure locked',()=>{
  const f=fixture({session:new Map([['holodek-ended-run-menu','ended-run']])});
  assert.equal(f.root.GameOverStartUi.restore(f.status),true);assert.equal(f.root.GameOverStartUi.active(),true);
  assert.match(f.messages[0],/Start Menu/);assert.match(f.messages[0],/Create a new character in this world/);
  assert.match(f.messages[0],/Campaign Builder/);assert.match(f.messages[0],/Save \/ Load Game/);assert.doesNotMatch(f.messages[0],/Mortacia|Suzerain/);
  assert.equal(f.command.focused,true);assert.equal(f.root.PlayerControls.blocked(true),true);
  assert.equal(f.root._gameOver,true);assert.equal(f.root._deathSceneActive,false);assert.equal(f.status.rescuesUsed,2);
  f.root.GameOverStartUi.restore(f.status);assert.equal(f.messages.length,1);
});
test('canonical start choices remain available for a new canonical adventure',()=>{
  const f=fixture({homebrew:false,session:new Map([['holodek-ended-run-menu','ended-run']])});
  f.root.GameOverStartUi.restore(f.status);assert.match(f.messages[0],/Mortacia/);assert.match(f.messages[0],/Suzerain/);
});
test('menu acknowledgement is scoped to the ended run and cannot suppress another game-over screen',()=>{
  const f=fixture({session:new Map([['holodek-ended-run-menu','different-run']])});
  assert.equal(f.root.GameOverStartUi.restore(f.status),false);assert.equal(f.messages.length,0);
  assert.equal(f.root.GameOverStartUi.returnToMenu('different-run'),false);assert.equal(f.calls.reload,0);
});
test('the actual Game Over button requests the start menu rather than merely hiding the panel',()=>{
  const f=fixture(),start=life.indexOf("        const close = document.createElement('button');",life.indexOf("heading.textContent = 'Game Over'"));
  const end=life.indexOf(' box.append(heading, seen, who, text, close);',start);assert.ok(start>0&&end>start);
  const box={remove:()=> f.calls.remove++},text={textContent:f.status.gameOver.reason};
  const close=vm.runInNewContext(`(function(){${life.slice(start,end)}return close;})()`,{root:f.root,document:f.document,box,text,data:f.status});
  assert.equal(close.textContent,'Return to Start Menu');close.listeners.click();assert.equal(f.calls.reload,1);assert.equal(f.calls.remove,1);
  assert.equal(f.root._gameOver,true,'Closing the panel cannot revive the character');
});
test('storage failure leaves the game-over screen available with an actionable error',()=>{
  const f=fixture();f.root.localStorage.setItem=()=>{throw Error('Storage unavailable');};
  assert.throws(()=>f.root.GameOverStartUi.returnToMenu('ended-run'),/Could not open a fresh start menu/);
  assert.equal(f.calls.reload,0);assert.equal(f.session.has('holodek-ended-run-menu'),false);assert.equal(f.root._gameOver,true);
});
test('the original command entry permits only startup choices and character-creation input while in the ended-run menu',()=>{
  const f=fixture({session:new Map([['holodek-ended-run-menu','ended-run']])});f.root.GameOverStartUi.restore(f.status);
  const start=game.indexOf('async function chatbotprocessinput(textin) {')+'async function chatbotprocessinput(textin) {'.length;
  const end=game.indexOf('  const completedStartResult = textin?.completedStartResult;',start);assert.ok(start>0&&end>start);
  let creating=false;const notices=[];
  const submit=vm.runInNewContext(`(function(textin){${game.slice(start,end)}return 'startup';})`,{
    window:f.root,document:f.document,displayMessage:f.root.displayMessage,updateChatLog:text=>notices.push(text),isCharacterCreationInProgress:()=>creating});
  f.command.value='attack guard';assert.equal(submit(),undefined);assert.equal(notices.length,0);
  for(const option of ['start','1','2','3','4']){f.command.value=option;assert.equal(submit(),'startup');}
  creating=true;f.command.value='A new character name';assert.equal(submit(),'startup');
  f.root.GameOverStartUi.beginRun('new-run');creating=false;f.command.value='3';assert.equal(submit(),undefined);
  assert.match(notices.at(-1),/This adventure has ended/);
});
test('an authoritative new run clears fatal UI state and leaves the old run acknowledgement behind',()=>{
  const f=fixture({session:new Map([['holodek-ended-run-menu','ended-run']])});f.root.GameOverStartUi.restore(f.status);
  f.root.CombatLifeUi.beginRun('new-run');f.root.dungeonRunId='new-run';
  assert.equal(f.root._gameOver,false);assert.equal(f.root._deathSceneActive,false);assert.equal(f.root._playerUnconscious,false);
  assert.equal(f.root.GameOverStartUi.active(),false);assert.equal(f.root.GameOverStartUi.restore({...f.status,runId:'new-run'}),false);
  assert.match(game,/window\.dungeonRunId = data\.runId;\s*window\.CombatLifeUi\?\.beginRun\(data\.runId\)/);
});
test('new character confirmation after permanent death does not join the old startup receipt; active retries remain idempotent',()=>{
  const server=fs.readFileSync(require.resolve('../server'),'utf8'),at=server.indexOf("app.post('/startGameWithCharacter'");
  const start=server.indexOf('  try {',at),end=server.indexOf('  // world1 HOMEBREW:',start);assert.ok(start>0&&end>start);
  for(const ended of [true,false])for(const inFlight of [true,false]){
    const tasks=new Map(),receipt=startup.create({tasks}),payload={character:{Name:'Benedict'}},old=receipt.begin(payload);
    receipt.bind(old.taskId,'ended-run');tasks.get(old.taskId).status=inFlight?'processing':'complete';let result;
    const res={status(){return res;},json(value){result=value;return value;}};
    vm.runInNewContext(`(function(){${server.slice(start,end)}})()`,{req:{body:payload},res,startupTasks:receipt,inputTaskInFlight:inFlight,
      CombatLife:{status:()=>({gameOver:ended?{}:null})},sharedState:{getDungeonRunId:()=> 'ended-run'}});
    if(ended&&!inFlight){assert.equal(result,undefined);assert.equal(receipt.find(payload,'ended-run'),null);}
    else{assert.equal(result.joined,true);assert.equal(result.taskId,old.taskId);}
  }
});
test('startup menu support loads before the life UI and main command parser',()=>{
  const html=fs.readFileSync(require.resolve('../assets/index.html'),'utf8');
  assert.ok(html.indexOf('/assets/gameOverStartUi.js')<html.indexOf('/assets/combatLifeUi.js'));
  assert.ok(html.indexOf('/assets/combatLifeUi.js')<html.indexOf('/assets/game.js'));
});
test('the full startup endpoint creates a new run after game over instead of replaying completed startup data',async()=>{
  const server=fs.readFileSync(require.resolve('../server'),'utf8'),tasks=new Map(),routes=new Map(),registry=startup.create({tasks});
  const payload={character:{Name:'Benedict',HP:14}},old=registry.begin(payload);registry.bind(old.taskId,'ended-run');
  tasks.get(old.taskId).status='complete';tasks.get(old.taskId).result={updatedGameConsole:'Old completed room'};
  let ended=true,starts=0,result;
  const sharedState={getDungeonRunId:()=>starts?'new-run':'ended-run',getCombatMode:()=> 'Combat Map-Based',
    beginDungeonRun(){starts++;ended=false;return 'new-run';},setCurrentPC(){},setCharacterGenerationInProgress(){},setPendingCharacterForReview(){},
    setCombatCharactersString(){},setRoomNameDatabase(){},setPersonalNarrative(){},setUpdatedGameConsole(){}};
  const context={app:{post:(url,handler)=>routes.set(url,handler)},startupTasks:registry,tasks,inputTaskInFlight:false,sharedState,
    CombatLife:{status:()=>({gameOver:ended?{}:null})},console:{log(){},error(){}},broadcast(){},roomDatabaseReceiver:{reset(){}},
    actionDice:{setPaused(){},end(){}},Economy:{start(){}},buildInitialWorldConsole:()=>({console:'New room',roomNameDatabaseString:'{}'}),
    buildInitialGameConsole:()=> 'New character',retortWithUserInput:async()=>{throw Error('Stop before any paid world construction');}};
  const start=server.indexOf("app.post('/startGameWithCharacter'"),end=server.indexOf('// Dedicated endpoint to begin',start);
  vm.runInNewContext(server.slice(start,end),context);
  const res={status(code){assert.equal(code,202);return res;},json(value){result=value;}};
  await routes.get('/startGameWithCharacter')({body:payload},res);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts,1);assert.equal(ended,false);assert.notEqual(result.taskId,old.taskId);assert.equal(result.joined,undefined);
  assert.equal(tasks.has(old.taskId),false);assert.equal(tasks.get(result.taskId).runId,'new-run');
  assert.match(tasks.get(result.taskId).result,/Stop before any paid/);assert.equal(context.inputTaskInFlight,false);
});
