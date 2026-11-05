'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Rules = require('../assets/economyRules'), Inventory = require('../assets/inventoryUi');
function fixture() {
  const nodes = [], requests = [], applied = [], notices = [], events = {};
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.dataset = {}; this.children = []; this.listeners = {}; nodes.push(this); }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    after(c) { this.parent?.appendChild(c); }
    setAttribute(k, v) { this[k] = v; }
    addEventListener(k, cb) { this.listeners[k] = cb; }
    querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll()]).filter(c => c.tag === 'button'); }
    querySelector(selector) { return this.children.find(c => selector === '#equip-button' && c.id === 'equip-button') || null; }
    remove() { this.removed = true; }
    get isConnected() { return !this.removed && (!this.parent || this.parent.isConnected); }
    click() { return this.listeners.click?.(); }
  }
  const body = new Element('body'), input = new Element('textarea'); input.value = 'unfinished draft';
  const document = { body, createElement: tag => new Element(tag), addEventListener: (type, fn) => events[type] = fn,
    removeEventListener: (type, fn) => { if (events[type] === fn) delete events[type]; },
    getElementById: () => input, querySelectorAll: () => nodes.filter(n => n.className?.includes('popup-container') && !n.removed) };
  const dungeon = { geoKey: '1,0,0', sceneObjects: [] };
  const window = { dungeonRunId: 'run', currentDungeon: dungeon, EconomyRules: Rules, InventoryUi: Inventory,
    latestUpdatedData: { inventoryProperties: JSON.stringify(Rules.healingPotion(3)) },
    getDungeonLifeContext: () => ({ dungeon, player: { x: 4.5, y: 4.5 }, actors: [] }),
    prepareEconomyState: async () => {}, getPartyInfoEntries: () => [{ label: 'Benedict' }, { label: 'Ally' }],
    getEconomyResidentInfo: name => name === 'Keeper' ? { kind: 'temple' } : null,
    DungeonActionNotices: { receive: n => notices.push(n) }, applyRealtimeCombatResult: async event => applied.push(event) };
  let hook;
  const fetch = async (path, options) => {
    const request = { path, body: JSON.parse(options.body) }; requests.push(request);
    if (hook) return hook(request);
    const result = path.endsWith('view') ? { silver: 2, revision: 7, service: { name: 'Healing Shrine', kind: 'temple', stock: [
      { ...Rules.healingPotion(3), quantity: 2, price: 1 }] }, party: [{ name: 'Ally', hp: 0, maxHp: 20, resurrectPrice: 5 }], missions: [], saleItems: [] } :
      { type: 'economy_result', eventId: 'event', runId: 'run', geoKey: dungeon.geoKey, content: 'Consumed.' };
    return { ok: true, json: async () => result };
  };
  vm.runInNewContext(fs.readFileSync('assets/commerceUi.js', 'utf8'), { window, document, fetch, console });
  vm.runInNewContext(fs.readFileSync('assets/objectDiscovery.js', 'utf8'), { window, document });
  return { window, document, nodes, requests, applied, notices, input, body, events, hook: cb => hook = cb,
    button: label => nodes.find(n => n.tag === 'button' && n.textContent === label && n.isConnected) };
}

function installGate(f) {
  vm.runInNewContext(fs.readFileSync('assets/commandGate.js','utf8'), {
    window:f.window,document:{addEventListener(){},getElementById:()=>f.input},setTimeout });
  return f.window.GameCommandGate;
}

test('accepting a local job closes its popup and releases the interaction without reopening the menu',async()=>{
  const f=fixture();f.hook(async request=>({ok:true,json:async()=>request.path==='/economy/view'?{silver:2,revision:7,
    missions:[{id:'wind-job',type:'resident-favor',recipient:'Keeper',status:'offered',description:'Watch the wind, then report.',offer:'Please watch the wind.'}]}:
    {type:'economy_result',eventId:'accepted',runId:'run',geoKey:'1,0,0',content:'Favor accepted.'}}));
  await f.window.CommerceUi.open('Keeper');assert.ok(f.button('Accept Local Contract'));const before=f.requests.filter(r=>r.path==='/economy/view').length;
  await f.button('Accept Local Contract').click();
  assert.equal(f.button('Accept Local Contract'),undefined);assert.equal(f.button('Report Findings'),undefined);
  assert.equal(f.window.CommerceUi.hasInteraction(),false);assert.equal(f.requests.filter(r=>r.path==='/economy/view').length,before+1,'Only the transaction revision refresh runs; the menu does not reopen.');
  assert.equal(f.requests.filter(r=>r.path==='/economy/action').length,1);
});

test('dialogue acceptance closes the current offer menu; stale or unrelated job results cannot close it',async()=>{
  const f=fixture();f.hook(async()=>({ok:true,json:async()=>({silver:2,revision:7,missions:[{id:'wind-job',status:'offered',description:'Watch the wind.'}]})}));
  await f.window.CommerceUi.open('Keeper');
  const event={runId:'run',geoKey:'1,0,0',roomNameDatabaseString:JSON.stringify({'1,0,0':{minorMissions:{job:{id:'wind-job',status:'accepted'}}}})};
  f.window.CommerceUi.receiveResult({...event,runId:'old-run'});assert.ok(f.button('Accept Local Contract'));
  f.window.CommerceUi.receiveResult({...event,geoKey:'2,0,0'});assert.ok(f.button('Accept Local Contract'));
  f.window.CommerceUi.receiveResult({...event,roomNameDatabaseString:JSON.stringify({'1,0,0':{minorMissions:{job:{id:'other-job',status:'accepted'}}}})});assert.ok(f.button('Accept Local Contract'));
  f.window.CommerceUi.receiveResult(event);assert.equal(f.button('Accept Local Contract'),undefined);assert.equal(f.window.CommerceUi.hasInteraction(),false);
});

test('the first accepted service click waits for native resident work and opens once without waiting for speech',async()=>{
  const f=fixture(),gate=installGate(f);let release;
  f.window.DungeonLife={hasPendingSpeech:()=>true};
  f.window.CommerceUi.invite('Keeper');
  const native=gate.trackNative(()=>new Promise(resolve=>release=resolve));
  const button=f.button('Access Services'),opening=button.click();
  assert.equal(button.disabled,true);assert.equal(f.requests.length,0);await button.click();
  release();await native;await opening;
  assert.ok(f.button('Buy healing potion 3 hp (1 silver; 2 in stock)'));
  assert.equal(f.requests.filter(r=>r.path==='/economy/view').length,1);assert.equal(gate.busy(),false);
});

test('a service invitation can wait through a world action but cannot follow it into another room',async()=>{
  for(const travel of [false,true]){
    const f=fixture(),gate=installGate(f);f.window.CommerceUi.invite('Keeper');gate.begin();
    const opening=f.button('Access Services').click();assert.equal(f.requests.length,0);
    if(travel)f.window.currentDungeon={geoKey:'0,2,0'};
    gate.end();await opening;
    assert.equal(f.requests.length,travel?0:1);
    if(travel)assert.ok(f.nodes.some(n=>/room or game changed/.test(n.textContent||'')));
  }
});

test('a dismissed queued service invitation cannot perform its old acceptance later',async()=>{
  const f=fixture(),gate=installGate(f);let release;
  f.window.CommerceUi.invite('Keeper');
  const native=gate.trackNative(()=>new Promise(resolve=>release=resolve));
  const opening=f.button('Access Services').click();await f.button('Not Now').click();
  release();await native;await opening;assert.equal(f.requests.length,0);
});

test('world commands wait for service state application without opening an obsolete menu',async()=>{
  const f=fixture(),gate=installGate(f);let release,applied=false,calls=0;
  f.hook(async()=>{await new Promise(resolve=>release=resolve);return{ok:true,json:async()=>({silver:2,revision:1,missions:[],economyResult:{}})};});
  f.window.applyRealtimeCombatResult=async()=>{applied=true;};
  const opening=f.window.CommerceUi.open('Keeper');
  for(let i=0;i<8;i++)await Promise.resolve();
  const command=gate.wrap(async()=>{assert.equal(applied,true);calls++;})();assert.equal(calls,0);
  release();await opening;await command;assert.equal(calls,1);
  assert.equal(f.nodes.filter(n=>n.tag==='h3'&&n.textContent==='Local Contracts').length,0);
});
test('Drink offers real party targets, sends no client healing amount, and preserves the command draft', async () => {
  const f = fixture(); assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), true);
  await f.button('Drink: Ally').click();
  const request = f.requests.find(r => r.path.endsWith('action')).body;
  assert.equal(request.kind, 'drink'); assert.equal(request.item, 'healing potion 3 hp'); assert.equal(request.target, 'Ally');
  assert.equal(request.revision, 7); assert.equal(request.magic, undefined); assert.equal(request.heal_hp, undefined);
  assert.equal(f.input.value, 'unfinished draft'); assert.equal(f.applied.length, 1);
});
test('inventory actions hide Equip and expose Drink only for supported healing potions', () => {
  const f = fixture(), box = new (f.body.constructor)('div'), equip = new (f.body.constructor)('button'); equip.id = 'equip-button'; box.appendChild(equip);
  assert.ok(f.window.CommerceUi.addDrinkAction(box, 'healing potion 3 hp')); assert.equal(equip.hidden, true); assert.equal(equip.disabled, true);
  assert.equal(f.window.CommerceUi.addDrinkAction(box, 'spellbook'), null);
  f.window.latestUpdatedData.inventoryProperties = JSON.stringify({ name: 'healing potion 3 hp', type: 'other', magic: 30 });
  assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), false);
});
test('temple menu uses actual stock, exact silver prices and real resurrection targets', async () => {
  const f = fixture(); assert.equal(await f.window.CommerceUi.open('Keeper'), true);
  assert.ok(f.button('Buy healing potion 3 hp (1 silver; 2 in stock)'));
  assert.ok(f.button('Resurrect Ally (5 silver; returns at 1 HP)'));
  assert.ok(f.nodes.some(n => n.textContent === 'Silver Pieces: 2'));
  assert.equal(f.window.CommerceUi.addAction(f.body, 'Ghost'), undefined); f.window.CommerceUi.addAction(f.body, 'Keeper');
  assert.ok(f.button('Temple Services'));
});

test('a service invitation waits for consent before any authored greeting, network or model call',async()=>{
  const f=fixture();f.window.DungeonLife={population:()=>({actors:{Keeper:{dialogue:['A saved authored welcome.']}}})};
  assert.equal(f.window.CommerceUi.invite('Keeper'),true);assert.equal(f.requests.length,0);
  assert.ok(f.nodes.some(n=>n.textContent==='Would you like to access services?'));
  assert.ok(!f.nodes.some(n=>/saved authored welcome/.test(n.textContent||'')));
  assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);assert.equal(f.window.CommerceUi.isInteracting('Other Resident'),false);
  await f.button('Not Now').click();assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);assert.equal(f.requests.length,0);
});

test('accepting an unintroduced provider runs the encounter once, then opens services directly',async()=>{
  const f=fixture();let introduced=false;
  f.window.getEconomyResidentInfo=()=>({kind:'temple',introduced});
  f.window.applyRealtimeCombatResult=async event=>{f.applied.push(event);if(event.story)introduced=true;};
  f.hook(async request=>({ok:true,json:async()=>request.path==='/city/services/encounter'?{story:{content:'An authored introduction.'}}:
    request.path==='/economy/view'?{silver:2,revision:7,service:{kind:'temple',stock:[]},party:[],missions:[],saleItems:[]}:{}}));
  f.window.CommerceUi.invite('Keeper');assert.equal(f.requests.length,0);
  await f.button('Access Services').click();
  assert.deepEqual(f.requests.map(r=>r.path),['/city/services/encounter','/economy/view']);
  await f.window.CommerceUi.open('Keeper');assert.equal(f.requests.filter(r=>r.path==='/city/services/encounter').length,1);
});

test('ambient service invitations require a saved working provider and decline without authoring',async()=>{
  const f=fixture(),actor={name:'Worker',crowdId:'one'};let accepted=0;
  f.window.currentDungeon.cityCrowd={actors:{one:{name:'Worker',status:'ambient',occupation:{mode:'work',venueType:'library'}}}};
  assert.equal(f.window.CommerceUi.inviteAmbient(actor,()=>accepted++),true);
  await f.button('Not Now').click();assert.equal(accepted,0);assert.equal(f.requests.length,0);
  f.window.CommerceUi.inviteAmbient(actor,()=>accepted++);await f.button('Access Services').click();assert.equal(accepted,1);
  f.window.currentDungeon.cityCrowd.actors.one.occupation.mode='visit';
  assert.equal(f.window.CommerceUi.inviteAmbient(actor,()=>accepted++),false);
});
test('commission-only residents advertise work inquiries, not nonexistent services or guaranteed jobs',async()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>({kind:'venue',venue:true,inquiries:true,introduced:true,jobs:false});
  f.hook(async()=>({ok:true,json:async()=>({silver:2,revision:7,venue:{name:'Civic desk',capabilities:['commission']},
    missions:[],party:[],saleItems:[]})}));
  f.window.CommerceUi.invite('Keeper');assert.ok(f.button('Work Inquiries'));assert.equal(f.button('Access Services'),undefined);
  assert.ok(f.nodes.some(n=>/jobs may not be available/.test(n.textContent||'')));
  await f.button('Work Inquiries').click();assert.ok(f.button('Ask About Local Work'));
  assert.ok(f.nodes.some(n=>/No local jobs are currently posted/.test(n.textContent||'')));
  assert.ok(f.nodes.some(n=>/no shop, treatment or lodging/.test(n.textContent||'')));
  assert.equal(f.requests.length,1,'Opening inquiries never authors a contract');
});
test('an accepted invitation remains visibly loading until its introduction finishes, then opens once',async()=>{
  const f=fixture(),actor={name:'Worker',crowdId:'one'};let release,calls=0;
  f.window.currentDungeon.cityCrowd={actors:{one:{name:'Worker',status:'ambient',occupation:{mode:'work',venueType:'shop'}}}};
  f.window.CommerceUi.inviteAmbient(actor,async()=>{calls++;await new Promise(resolve=>release=resolve);return f.window.CommerceUi.open('Keeper');});
  const button=f.button('Access Services'),opening=button.click();
  assert.ok(f.nodes.some(n=>/Preparing services and the resident introduction/.test(n.textContent||'')&&!n.parent?.removed));
  assert.equal(button.disabled,true);assert.equal(f.window.CommerceUi.isInteracting('Worker'),true);
  await button.click();assert.equal(calls,1);release();await opening;
  assert.ok(f.button('Buy healing potion 3 hp (1 silver; 2 in stock)'));assert.equal(f.requests.length,1);
});

test('a rejected service encounter releases its provider and never opens a transaction menu',async()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>({kind:'temple',introduced:false});
  f.hook(async()=>({ok:false,json:async()=>({error:'The encounter changed.'})}));
  f.window.CommerceUi.invite('Keeper');await f.button('Access Services').click();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/city/services/encounter');
  assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);assert.match(f.notices[0].message,/encounter changed/);
});

test('accepting services opens the real menu and successive Buy clicks need no further invitation',async()=>{
  const f=fixture();f.window.CommerceUi.invite('Keeper');await f.button('Access Services').click();
  assert.ok(f.button('Buy healing potion 3 hp (1 silver; 2 in stock)'));assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  assert.equal(f.requests.filter(r=>r.path==='/economy/action').length,1);assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);
  const current=f.nodes.filter(n=>n.tag==='button'&&n.textContent==='Buy healing potion 3 hp (1 silver; 2 in stock)'&&!n.parent?.parent?.removed).at(-1);
  await current.click();assert.equal(f.requests.filter(r=>r.path==='/economy/action').length,2);
  const close=f.nodes.filter(n=>n.tag==='button'&&n.textContent==='Close').at(-1);await close.click();
  assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);assert.equal(f.input.value,'unfinished draft');
});

test('clicking a service counter opens services directly and retains the verified counter on repeated buys',async()=>{
  const f=fixture();f.hook(async request=>({ok:true,json:async()=>request.path==='/city/services/counter'?{actor:'Keeper',counterId:'saved-counter'}:
    request.path==='/economy/view'?{silver:2,revision:7,service:{kind:'shop',stock:[{...Rules.healingPotion(3),quantity:2,price:1}]},party:[],missions:[],saleItems:[]}:{eventId:'purchase'}}));
  assert.equal(await f.window.CommerceUi.openCounter('saved-counter'),true);
  assert.equal(f.requests[0].path,'/city/services/counter');assert.equal(f.requests[0].body.counterId,'saved-counter');
  assert.ok(!f.nodes.some(n=>n.textContent==='Would you like to access services?'));
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  const actions=f.requests.filter(r=>r.path==='/economy/action');assert.equal(actions.length,1);assert.equal(actions[0].body.counterId,'saved-counter');
  assert.equal(f.requests.filter(r=>r.path==='/economy/view').at(-1).body.counterId,'saved-counter');
  assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);
});

test('clicking a procedural counter enters the existing meet pipeline with consent already given',async()=>{
  const f=fixture(),calls=[];f.window.CityCrowdUi={open:async(a,options)=>{calls.push({a,options});return true;}};
  f.hook(async()=>({ok:true,json:async()=>({citizen:{ambient:true,crowdId:'worker',name:'Saved Worker'},counterId:'saved-counter'})}));
  assert.equal(await f.window.CommerceUi.openCounter('saved-counter'),true);
  assert.equal(calls.length,1);assert.equal(calls[0].options.services,true);assert.equal(calls[0].options.counterId,'saved-counter');
  assert.equal(f.requests.length,1);
});

test('shop, temple, venue and divine invitations use verified service metadata, not a job-title guess',()=>{
  for(const kind of ['shop','temple','venue','divine']){
    const f=fixture();f.window.getEconomyResidentInfo=()=>({kind});assert.equal(f.window.CommerceUi.invite('Keeper'),true,kind);
  }
  for(const business of [null,{kind:'mission'}]){
    const f=fixture();f.window.getEconomyResidentInfo=()=>business;assert.equal(f.window.CommerceUi.invite('Keeper'),false);assert.equal(f.requests.length,0);
  }
});

test('a verified street job is offered without authoring or accepting its contract until the player chooses',async()=>{
  const f=fixture();f.window.getEconomyResidentInfo=()=>({kind:'mission',jobs:true});
  assert.equal(f.window.CommerceUi.invite('Keeper'),true);assert.ok(f.button('View Job Offers'));assert.equal(f.requests.length,0);
  await f.button('Not Now').click();assert.equal(f.requests.length,0);
  f.window.CommerceUi.invite('Keeper');await f.button('View Job Offers').click();
  assert.equal(f.requests.filter(r=>r.path==='/economy/view').length,1);assert.equal(f.requests.filter(r=>r.path==='/economy/action').length,0);
});

test('invitations and interaction holds expire on scope change, external dismissal and combat',async()=>{
  for(const change of [f=>f.window.dungeonRunId='other',f=>f.window.currentDungeon={geoKey:'2,0,0'},
    f=>f.window.CityFloorScope={token:()=> 'new-floor'},f=>f.window.actionDiceState={active:{kind:'combat'}}]){
    const f=fixture();f.window.CommerceUi.invite('Keeper');change(f);
    assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);await f.button('Access Services').click();assert.equal(f.requests.length,0);
  }
  const f=fixture();await f.window.CommerceUi.open('Keeper');assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);
  f.document.querySelectorAll('.popup-container').forEach(n=>n.remove());assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);
});

test('the operator is held before menu synchronization and is released after a failed or superseded opening',async()=>{
  for(const fail of [true,false]){
    const f=fixture();let release;
    f.window.prepareEconomyState=()=>new Promise((resolve,reject)=>release=()=>fail?reject(Error('Network failed')):resolve());
    const opening=f.window.CommerceUi.open('Keeper');assert.equal(f.window.CommerceUi.isInteracting('Keeper'),true);
    if(!fail)f.window.dungeonRunId='other';release();assert.equal(await opening,false);assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);
    assert.equal(f.requests.length,0);
  }
});

test('Escape releases the service operator and normal wandering continues for everyone else',()=>{
  const f=fixture();f.window.CommerceUi.invite('Keeper');
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('function updateMonsterWandering('),end=source.indexOf('\nwindow.updateMonsterWandering',start);
  f.window.DungeonInhabitants={isDown:()=>false};
  const context={window:f.window,currentDungeon:{...f.window.currentDungeon,cells:{}},isCombatRoundActive:()=>false,
    getCurrentCombatRoomKey:()=>f.window.currentDungeon.geoKey,resetWalkFrame:()=>{},getMonsterHomeAnchor:()=>({x:4,y:4}),
    hashCharacterName:()=>1,isMonsterHostile:()=>false,MONSTER_WANDER_MIN_MS:1000,MONSTER_WANDER_MAX_MS:3000,
    MONSTER_MOVE_TWEEN_MS:900,MONSTER_WALK_FRAME_MS:120,rememberCombatMovementFacing:()=>{},advanceWalkFrame:()=>{},
    chooseMonsterWanderStep:entry=>({x:entry.mazeX+1,y:entry.mazeY})};
  vm.runInNewContext(source.slice(start,end),context);
  const keeper={name:'Keeper',mazeX:4,mazeY:4,_nextWanderAt:0},visitor={name:'Visitor',mazeX:9,mazeY:4,_nextWanderAt:0};
  context.updateMonsterWandering([keeper,visitor],new Set(),10000,true);
  assert.equal(keeper.mazeX,4);assert.equal(visitor.mazeX,10,'Other residents keep moving');
  f.events.keydown({key:'Escape'});assert.equal(f.window.CommerceUi.isInteracting('Keeper'),false);
  context.updateMonsterWandering([keeper],new Set(),20000,true);assert.equal(keeper.mazeX,5);
});

test('clicking Buy performs one verified transaction and reopens refreshed stock without a model call', async () => {
  const f = fixture(); await f.window.CommerceUi.open('Keeper');
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  const actions = f.requests.filter(r => r.path === '/economy/action');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].body.kind, 'buy'); assert.equal(actions[0].body.actor, 'Keeper');
  assert.equal(actions[0].body.item, 'healing potion 3 hp'); assert.equal(actions[0].body.revision, 7);
  assert.equal(f.applied.length, 1);
  assert.equal(f.window.CommerceUi.isBusy(), false);
});

test('a busy or paused trader button explains the block instead of silently ignoring the click', async () => {
  for (const paused of [false, true]) {
    const f = fixture(); await f.window.CommerceUi.open('Keeper');
    f.window.gamePaused = paused; f.window.GameCommandGate = { busy: () => !paused };
    await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
    assert.equal(f.requests.filter(r => r.path === '/economy/action').length, 0);
    assert.ok(f.nodes.some(node => node.tag === 'p' && /Resume the game|Finish the current action/.test(node.textContent || '')));
  }
});

function realEconomy(f) {
  const file = require.resolve('./economy.test.cjs'), source = fs.readFileSync(file, 'utf8');
  const backend = vm.runInNewContext(source.slice(0, source.indexOf("test('initial pooled")) + '\nfixture();',
    { require: require('node:module').createRequire(file) });
  const Economy = require('../retort/economy'), routes = {}, warnings = [], server = fs.readFileSync('server.js', 'utf8');
  const context = vm.createContext({ sharedState: backend.state, populationService: backend.service, Economy, require,
    inputTaskInFlight: false, actionDice: { active: false }, npcAutonomyTickInFlight: false,
    console: { warn: (...args) => warnings.push(args) }, broadcast() {},
    economyStateEvent: () => ({ type: 'economy_result', updatedGameConsole: backend.state.getUpdatedGameConsole() }),
    app: { post: (path, handler) => routes[path] = handler } });
  vm.runInContext(server.slice(server.indexOf('function prepareQuestScene(req)'), server.indexOf("app.post('/journal/view'")), context);
  vm.runInContext(server.slice(server.indexOf("app.post('/economy/view'"), server.indexOf("app.post('/room-population/visit'")), context);
  f.window.dungeonRunId = 'test-run'; f.window.currentDungeon = backend.d;
  f.window.getDungeonLifeContext = () => ({ dungeon: backend.d, player: { x: 4.5, y: 4.5 },
    actors: JSON.parse(backend.state.getCombatCharactersString()).filter(actor => actor.type === 'monster') });
  f.hook(async request => {
    let status = 200, result;
    const res = { status: n => { status = n; return res; }, json: value => result = value };
    await routes[request.path]({ body: request.body }, res);
    return { ok: status === 200, json: async () => result };
  });
  return { ...backend, warnings };
}

test('the actual Buy click and server routes charge once, add inventory and reduce shop or temple stock', async () => {
  for (const kind of ['shop', 'temple']) {
    const f = fixture(), backend = realEconomy(f); backend.business(kind);
    assert.equal(await f.window.CommerceUi.open('Keeper'), true);
    const buy = f.nodes.find(node => node.tag === 'button' && /^Buy healing potion 6 hp/.test(node.textContent || ''));
    assert.ok(buy, JSON.stringify(f.notices)); await buy.click();
    assert.equal(backend.warnings.length, 0, JSON.stringify(backend.warnings));
    assert.equal(f.requests.filter(request => request.path === '/economy/action').length, 1);
    assert.equal(backend.book().silver, 0);
    assert.equal(EconomyField(backend, 'Inventory'), 'healing potion 6 hp');
    assert.equal(backend.db()['1,0,0'].services.shop.stock[0].quantity, 1);
    assert.equal(f.applied.filter(event => event.content?.startsWith('You buy')).length, 1);
    assert.equal(f.window.CommerceUi.isBusy(), false);
  }
});

function EconomyField(backend, field) { return require('../retort/economy').field(backend.state.getUpdatedGameConsole(), field); }

test('a real rejected Buy click shows the server error and preserves money, inventory and stock', async () => {
  const f = fixture(), backend = realEconomy(f); backend.business('shop');
  assert.ok(!backend.action({ kind: 'buy', actor: 'Keeper', item: 'healing potion 6 hp' }).error);
  const before = backend.state.getUpdatedGameConsole();
  assert.equal(await f.window.CommerceUi.open('Keeper'), true);
  const buy = f.nodes.find(node => node.tag === 'button' && /^Buy healing potion 6 hp/.test(node.textContent || ''));
  await buy.click();
  assert.ok(f.nodes.some(node => node.textContent === 'Not enough silver pieces.'));
  assert.equal(backend.state.getUpdatedGameConsole(), before);
  assert.equal(backend.db()['1,0,0'].services.shop.stock[0].quantity, 1);
  assert.equal(backend.book().silver, 0);
  assert.equal(f.window.CommerceUi.isBusy(), false);
});

test('trade synchronization prefers the acknowledged current-room console over stale conversation history', async () => {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  const code = source.slice(source.indexOf('window.prepareEconomyState = async () => {'), source.indexOf('window.persistDungeonPopulation ='));
  for (const floor of [false, true]) {
    const old = 'Coordinates: X: 1, Y: 0, Z: 0\nInventory: Empty', fresh = old.replace('Empty', 'purchased item');
    const sent = [], window = { lastServerGameConsole: fresh, DungeonInhabitants: require('../assets/dungeonInhabitants'), combatCharacters: [] };
    vm.runInNewContext(code, { window, currentDungeon: { geoKey: '1,0,0', ...(floor ? { cityFloorContext: {} } : {}) },
      roomNameDatabase: new Map(), localStorage: { getItem: () => 'conversation' },
      getPromptsAndResponsesForConversation: async () => [{ gameConsole: old }], syncGameStateBeforeCommand: async value => sent.push(value) });
    await window.prepareEconomyState(); assert.equal(sent[0].updatedGameConsole, fresh);
  }
});

test('typed purchases and sales use canonical trader identity and the same economy transaction path', async () => {
  for (const [command, kind] of [['buy healing potion 3 hp from keeper', 'buy'], ['sell iron knife to Keeper', 'sell'], ['buy iron knife', 'buy']]) {
    const f = fixture(), ctx = f.window.getDungeonLifeContext();
    f.window.getDungeonLifeContext = () => ({ ...ctx, actors: [{ name: 'Keeper', type: 'monster', hp: 4 }] });
    f.window.DungeonInhabitants = { dialogueReach: () => ({ canSpeak: true, lineOfSight: true, distance: 2 }) };
    assert.equal(await f.window.CommerceUi.handleCommand(command), true);
    const actions = f.requests.filter(r => r.path === '/economy/action'); assert.equal(actions.length, 1);
    assert.equal(actions[0].body.kind, kind); assert.equal(actions[0].body.actor, 'Keeper');
    assert.equal(actions[0].body.revision, 7);
    assert.ok(f.requests.every(r => r.path.startsWith('/economy/')));
  }
});

test('missing traders and rejected purchases never fall through to narration or change the inventory', async () => {
  const f = fixture(), before = JSON.stringify(f.window.latestUpdatedData);
  assert.equal(await f.window.CommerceUi.handleCommand('buy a thing'), true);
  assert.equal(f.requests.length, 0); assert.match(f.notices.at(-1).message, /Move close/);
  await f.window.CommerceUi.open('Keeper');
  f.hook(async request => ({ ok: request.path.endsWith('view'), json: async () => request.path.endsWith('view') ? { revision: 7 } : { error: 'Not enough silver pieces.' } }));
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  assert.ok(f.nodes.some(n => n.textContent === 'Not enough silver pieces.'));
  assert.equal(JSON.stringify(f.window.latestUpdatedData), before); assert.equal(f.applied.length, 0);
});

test('a divine audience shows real gifts and sends handoff choices to the custodian, while raids have no Give button', async () => {
  const f = fixture(), given = [];
  f.window.ItemGiveUi = { open: name => given.push(name) };
  f.window.getEconomyResidentInfo = () => ({ kind: 'divine' });
  f.hook(async () => ({ ok: true, json: async () => ({ silver: 0, revision: 1,
    divine: { name: 'Atinus', domain: 'Duty', interest: 'Protect the wounded', visits: 2, possessions: [{ name: 'copper tablet' }] },
    missions: [{ id: 'delivery', status: 'accepted', recipient: 'Custodian', item: 'muster record', description: 'Give the record to Custodian.' },
      { id: 'raid', type: 'raid', status: 'accepted', recipient: 'Custodian', description: 'Defeat the named temple defenders.' }] }) }));
  assert.equal(await f.window.CommerceUi.open('Atinus'), true);
  assert.ok(f.button('Receive copper tablet')); assert.ok(f.nodes.some(n => n.textContent === 'Divine Audience: Atinus'));
  assert.equal(f.nodes.filter(n => n.textContent === 'Give Requested Item to Custodian').length, 1);
  await f.button('Give Requested Item to Custodian').click(); assert.deepEqual(given, ['Custodian']);
  f.window.CommerceUi.addAction(f.body, 'Atinus'); assert.ok(f.button('Divine Audience'));
});
test('busy games cannot transact and potion equip commands do not fall through to legacy equipment code', async () => {
  const f = fixture(); assert.equal(await f.window.CommerceUi.handleCommand('equip healing potion 3 hp to Ally'), true);
  assert.equal(f.requests.length, 0); assert.match(f.notices[0].message, /cannot be equipped/);
  f.window.gamePaused = true; assert.equal(f.window.CommerceUi.drink('healing potion 3 hp'), false);
  assert.equal(await f.window.CommerceUi.open('Keeper'), false);
});

test('typed and popup-style equipment commands use verified transactions without browser-side item removal', async () => {
  for (const [command, kind, item, target] of [
    ['equip shadowbone spear', 'equip', 'shadowbone spear', undefined],
    ['equip veilbreaker aegis to Ally', 'equip', 'veilbreaker aegis', 'Ally'],
    ['unequip veilbreaker aegis from Ally', 'unequip', 'veilbreaker aegis', 'Ally']]) {
    const f = fixture(), before = JSON.stringify(f.window.latestUpdatedData);
    assert.equal(await f.window.CommerceUi.handleCommand(command), true);
    const request = f.requests.find(r => r.path === '/economy/action').body;
    assert.equal(request.kind, kind); assert.equal(request.item, item); assert.equal(request.target, target);
    assert.equal(request.revision, 7); assert.equal(request.magic, undefined);
    assert.equal(JSON.stringify(f.window.latestUpdatedData), before, 'Only the acknowledged server result changes the inventory');
    assert.equal(f.applied.length, 1);
  }
});

test('rejected equipment commands keep the visible inventory and report the server error', async () => {
  const f = fixture(), before = JSON.stringify(f.window.latestUpdatedData);
  f.hook(async request => ({ ok: request.path.endsWith('view'), json: async () => request.path.endsWith('view') ? { revision: 7 } : { error: 'Unequip the current weapon first.' } }));
  assert.equal(await f.window.CommerceUi.handleCommand('equip shadowbone spear'), true);
  assert.equal(f.applied.length, 0); assert.equal(JSON.stringify(f.window.latestUpdatedData), before);
  assert.match(f.notices.at(-1).message, /Unequip the current weapon/);
});
test('a stale room response cannot apply a purchase to a newly entered room', async () => {
  const f = fixture(); let resolve;
  f.hook(() => new Promise(done => resolve = done));
  const result = f.window.CommerceUi.open('Keeper'); await new Promise(done => setImmediate(done));
  f.window.currentDungeon = { geoKey: '2,0,0' };
  resolve({ ok: true, json: async () => ({ service: { name: 'Old Shop' } }) });
  assert.equal(await result, false); assert.equal(f.applied.length, 0); assert.ok(!f.nodes.some(n => n.textContent === 'Old Shop'));
});
test('a menu left open from another room cannot send a transaction there', async () => {
  const f = fixture(); await f.window.CommerceUi.open('Keeper');
  f.window.currentDungeon = { geoKey: '2,0,0' };
  await f.button('Buy healing potion 3 hp (1 silver; 2 in stock)').click();
  assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 0);
  assert.match(f.notices[0].message, /another room or game/);
});
test('the page loads economy modules before game and displays silver separately from item properties', () => {
  const html = fs.readFileSync('assets/index.html', 'utf8'), game = fs.readFileSync('assets/game.js', 'utf8');
  for (const name of ['economyRules', 'commerceUi']) assert.ok(html.indexOf(`/assets/${name}.js`) < html.indexOf('/assets/game.js'));
  assert.match(html, /id="inventory-silver"/); assert.match(game, /Silver Pieces: \$\{silverPieces\}/);
});

function show(f, names) {
  const { dungeon, player } = f.window.getDungeonLifeContext();
  const camera = { ...player, eyeZ: .65, dirX: 1, dirY: 0, planeScale: .577, verticalScale: 1.73, aspect: 1.8, viewShift: 0 };
  f.window.ObjectDiscovery.update(dungeon, names.map(name => ({ type: 'item', label: name })), camera);
}
test('typed hidden objects, mixed lists and missing visibility support cannot invoke any pickup', async () => {
  const f = fixture(); show(f, ['shown sword']);
  for (const command of ['take hidden key', 'take shown sword, hidden key', 'collect hidden key', 'take']) {
    assert.equal(await f.window.CommerceUi.handleCommand(command), true);
    assert.equal(f.requests.length, 0);
  }
  f.window.ObjectDiscovery = undefined;
  assert.equal(await f.window.CommerceUi.handleCommand('take shown sword'), true);
  assert.equal(f.requests.length, 0);
});
test('Take All sends only currently visible names and includes the rendered camera snapshot', async () => {
  const f = fixture(); f.window.currentDungeon.sceneObjects = [{ name: 'shown sword' }, { name: 'hidden key' }];
  show(f, ['shown sword']);
  assert.equal(await f.window.CommerceUi.handleCommand(' TAKE ALL '), true);
  const actions = f.requests.filter(r => r.path.endsWith('action'));
  assert.equal(actions.length, 1); assert.equal(actions[0].body.item, 'shown sword');
  assert.deepEqual(actions[0].body.objectView.names, ['shown sword']);
  assert.equal(actions[0].body.objectView.camera.dirX, 1);
});
test('turning away during state preparation or balance lookup preserves the original valid pickup snapshot', async () => {
  for (const stage of ['prepare', 'view']) {
    const f = fixture(); show(f, ['shown sword']);
    if (stage === 'prepare') f.window.prepareEconomyState = async () => show(f, []);
    else f.hook(async () => { show(f, []); return { ok: true, json: async () => ({ revision: 7 }) }; });
    assert.equal(await f.window.CommerceUi.handleCommand('take shown sword'), true);
    assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 1);
    assert.deepEqual(f.requests.find(r => r.path.endsWith('action')).body.objectView.names, ['shown sword']);
  }
});

test('pickup reconciles authoritative corpse loot positions before taking a fresh camera snapshot', async () => {
  for (const stillVisible of [true, false]) {
    const f = fixture(), item = { name: 'shown sword', x: 8, y: 7 };
    show(f, [item.name]); f.window.currentDungeon.sceneObjects = [{ ...item, x: 5, y: 4 }];
    let renders = 0;
    f.window.renderDungeonView = () => { renders++; assert.equal(f.window.currentDungeon.sceneObjects[0].x, 8); show(f, stillVisible ? [item.name] : []); };
    f.hook(async request => ({ ok: true, json: async () => request.path.endsWith('view') ? { revision: 7, sceneObjects: [item] } : { eventId: 'taken' } }));
    await f.window.CommerceUi.handleCommand('take shown sword'); assert.equal(renders, 1);
    assert.equal(f.requests.filter(r => r.path.endsWith('action')).length, 0);
    assert.match(f.notices.at(-1).message, /object moved/);
  }
});

test('pickup retains its browser position when the player moves during persistence',async()=>{const f=fixture(),player={x:4.5,y:4.5};show(f,['shown sword']);f.window.getDungeonLifeContext=()=>({dungeon:f.window.currentDungeon,player,actors:[]});f.window.prepareEconomyState=async()=>{player.x=5.5;show(f,[]);};await f.window.CommerceUi.handleCommand('take shown sword');const action=f.requests.find(r=>r.path.endsWith('action'));assert.equal(action.body.player.x,4.5);assert.deepEqual(action.body.objectView.names,['shown sword']);});
