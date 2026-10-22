'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../retort/modelTransport'), S = require('../retort/structuredSchema');
const Compact = require('../retort/providerSchema'), Worker = require('../tools/website-worker/worker.cjs');
const Policy = require('../retort/generationPolicy'), Contracts = require('../retort/generationContracts');
const Puzzles = require('../assets/physicalPuzzles');
function expand(schema, definitions = schema.$defs) {
  if (schema.$ref) return expand(definitions[schema.$ref.slice('#/$defs/'.length)], definitions);
  const result = { ...schema }; delete result.$defs;
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, expand(child, definitions)]));
  if (schema.items) result.items = expand(schema.items, definitions);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(child => expand(child, definitions));
  return result;
}
function enumCount(schema) {
  if (!schema || typeof schema !== 'object') return 0;
  return (schema.enum?.length || 0) + Object.entries(schema).filter(([key]) => key !== 'enum').reduce((n, [, child]) => n +
    (Array.isArray(child) ? child.reduce((n, v) => n + enumCount(v), 0) : enumCount(child)), 0);
}
test('the exact puzzle variant/nullable-artwork contract fits the provider budget losslessly', () => {
  for (const kind of Object.keys(Puzzles.toolbox().mechanics)) {
    const brief = Puzzles.fallback('captured-luna', 'Ruined Temple Entrance'); brief.kind = kind;
    const logical = T.strictSchema(S.toJSON(require('../retort/puzzleContract').parameters(brief))), before = JSON.stringify(logical);
    const wire = Compact.compact(logical);
    assert.ok(enumCount(logical) > 1000); assert.ok(enumCount(wire) <= 1000);
    assert.deepEqual(expand(wire), logical); assert.equal(JSON.stringify(logical), before);
  }
});
test('cloud stream sends compact refs but checks the full original contract on return', async () => {
  let request;
  const client = { chat: { completions: { create: async body => { request = body; return (async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'answer', arguments: JSON.stringify({ a: 'forged', b: 'yes' }) } }] }, finish_reason: null }] };
    yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
  })(); } } } };
  const settings = { model: 'gpt-6-luna', strictParameters: true, parameters: { a: { type: String, enum: ['yes','no'] }, b: { type: String, enum: ['yes','no'] } } };
  await assert.rejects(async () => { for await (const _ of T.stream(settings, [], { client, models: { profile: () => ({ id: 'gpt-6-luna' }) } })) {} }, e => e.code === 'MODEL_SCHEMA' && e.issues[0].path === '$.a');
  assert.ok(request.tools[0].function.parameters.properties.a.$ref);
});
test('provider schema/auth/quota errors survive polling as permanent sanitized diagnostics', async () => {
  const secret = 'sk-private-test-key-' + 'K'.repeat(32);
  await assert.rejects(Worker.handle({ operation: 'generate', provider: 'openai', credential: secret,
    body: { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'private prompt' }] } }, { fetchImpl: async () =>
      Response.json({ error: { message: 'Invalid schema with ' + secret + ' at https://private.invalid', code: 'invalid_function_parameters', param: 'tools[0].function.parameters' } }, { status: 400 }) }), error => {
    const safe = Worker.failurePacket(error), restored = Worker.failureFrom(safe);
    assert.equal(restored.code, 'MODEL_PROVIDER_SCHEMA'); assert.equal(restored.status, 400); assert.equal(Policy.recoverable(restored, 'transport'), false);
    assert.equal(restored.responseEvidence.providerParam, 'tools[0].function.parameters');
    assert.ok(!JSON.stringify(safe).includes(secret)); assert.ok(!JSON.stringify(safe).includes('private.invalid')); return true;
  });
  for (const [status, code] of [[401,'invalid_api_key'],[403,'invalid_api_key'],[429,'insufficient_quota']]) {
    const error = Worker.failureFrom(Worker.failurePacket(Worker.providerFailure(status, { error: { code } })));
    assert.equal(Policy.recoverable(error, 'validation'), false);
  }
  const malicious = Worker.failurePacket(Worker.providerFailure(400, { error: { message: 'invalid schema', code: secret, param: secret } }));
  assert.ok(!JSON.stringify(malicious).includes(secret));
});
test('a permanent bridge schema error spends one shared attempt, not four nested requests', async () => {
  let calls = 0;
  const error = Worker.failureFrom(Worker.failurePacket(Worker.providerFailure(400, { error: { code: 'invalid_function_parameters', message: 'invalid schema' } })));
  const $ = { assistant: { generation: async () => { calls++; throw error; } }, user: async () => { throw Error('Permanent errors must not become correction prompts.'); } };
  const result = await Contracts.request($, { component: 'puzzle-native', parameters: { ready: Boolean } });
  assert.equal(result.error.code, error.code); assert.equal(calls, 1);
});
test('outages are typed for bounded retry and a failed async poll preserves their category', async () => {
  const failure = Worker.failurePacket(Worker.providerFailure(503)); let polls = 0;
  await assert.rejects(Worker.pollModelJob({ provider: 'openai' }, { pollMs: 0, call: async packet => {
    if (packet.operation === 'model-submit') return { id: packet.id, capability: packet.capability, phase: 'queued' };
    polls++; return { id: packet.id, phase: 'failed', ...failure };
  } }), e => e.code === 'MODEL_PROVIDER_RETRY' && e.status === 503 && Policy.recoverable(e, 'transport'));
  assert.equal(polls, 1);
});
test('a helper mismatch fails before a room-stage runner or provider can be invoked', () => {
  const assertCompatible = require('../retort/roomEngineCompatibility').assertCompatible, hash = 'a'.repeat(64);
  const value = { engineHash: hash, roomWorkers: 3, pool: [{engineHash:hash},{engineHash:hash},{engineHash:hash}] };
  assert.equal(assertCompatible(value, hash), true);
  for (const bad of [{ ...value, engineHash: 'b'.repeat(64) }, { ...value, pool: [...value.pool.slice(0,2), { engineHash: 'b'.repeat(64) }] }])
    assert.throws(() => assertCompatible(bad, hash), e => e.code === 'ROOM_ENGINE_MISMATCH' && e.recoverable === false);
});

test('background spell flavor is destination-owned, while entry adopts only engine-compatible effects once', async () => {
  const Spells = require('../retort/spellSystem'), key = '0,-1,0';
  const item = { name:'quiet staff', type:'weapon', magic:4 };
  let db = { '0,0,0': { name:'Origin', spellSystem:{ version:1,runId:'run',clock:7,recipes:{},items:{},bindings:{},receipts:[],effects:[] } },
    [key]:{ name:'Court', objects:[item] } };
  let text = 'Coordinates: X: 0, Y: -1, Z: 0\nMonsters Equipped Properties: None\nInventory Properties: None\nParty Equipped Properties: None';
  const state = { getDungeonRunId:()=> 'run', getUpdatedGameConsole:()=>text, setUpdatedGameConsole:v=>{text=v;}, getRoomNameDatabase:()=>JSON.stringify(db), setRoomNameDatabase:v=>{db=JSON.parse(v);} };
  const before = structuredClone(db['0,0,0']);
  const $ = { user:async()=>{}, assistant:{generation:async()=>({content:JSON.stringify({items:[{name:item.name,spells:Spells.Rules.recipe(item).map(s=>({id:s.id,name:'Quiet '+s.name,lore:'A remembered light steadies the hand.'}))}]})})} };
  await Spells.developRecipes($,state,{constructionKey:key});
  assert.deepEqual(db['0,0,0'],before); assert.ok(db[key].authoredSpellRecipes['quiet staff']);
  Spells.adoptRoomRecipes(db,key,state);
  assert.equal(db['0,0,0'].spellSystem.clock,7);
  assert.equal(db['0,0,0'].spellSystem.recipes['quiet staff'].capacity,4);
  const accepted = structuredClone(db['0,0,0'].spellSystem);
  Spells.adoptRoomRecipes(db,key,state); assert.deepEqual(db['0,0,0'].spellSystem,accepted);
});

test('construction complex propagation cannot repair a read-only peer or visited source', () => {
  const db={'0,0,0':{name:'Origin',indoor:true,visited:true},'0,1,0':{name:'Target',indoor:true,exits:{south:{targetCoordinates:'0,0,0'},east:{targetCoordinates:'1,1,0'}}},
    '1,1,0':{name:'Peer',indoor:true}};
  const origin=structuredClone(db['0,0,0']),peer=structuredClone(db['1,1,0']);
  require('../retort/worldContext').propagateComplexIdentity(db,{x:0,y:1,z:0},{readOnly:new Set(['0,0,0','1,1,0'])});
  assert.ok(db['0,1,0'].complexId);assert.deepEqual(db['0,0,0'],origin);assert.deepEqual(db['1,1,0'],peer);
});

test('prepared community effects run exactly once on entry, never during construction', () => {
  const Economy = require('../retort/economy'), Entry = require('../retort/preparedRoomEntry'), key='-1,0,0';
  let db = { '0,0,0':{name:'Origin',visited:true,objects:[]}, [key]:{name:'Crypt',indoor:true,objects:[],populationComplete:true,description:'A quiet crypt beyond the old threshold.',inhabitants:{geoKey:key,actors:{},groups:[]}} };
  const origin = structuredClone(db['0,0,0']), text='Coordinates: X: -1, Y: 0, Z: 0\nMonsters in Room: None\nMonsters Equipped Properties: None';
  Economy.seedRoom(db,key,db[key].inhabitants,'run',text,{deferCommunity:true});
  assert.deepEqual(db['0,0,0'],origin);
  const state = {getDungeonRunId:()=> 'run',getRoomNameDatabase:()=>JSON.stringify(db),setRoomNameDatabase:v=>{db=JSON.parse(v);},setUpdatedGameConsole(){},setRoomPopulation(){}};
  assert.equal(Entry.activate(state,key,text).changed,true);
  assert.ok(db['0,0,0'].divineCourt.rooms.includes(key)); const once=structuredClone(db);
  assert.equal(Entry.activate(state,key,text).changed,false); assert.deepEqual(db,once);
});

test('captured Names Beneath Ash contour keeps its authored peak rather than flattening on the nearest chord tone', () => {
  const C = require('../retort/sidComposition'), Theory = require('../retort/sidMusicTheory');
  const fixture = require('./fixtures/luna-names-beneath-ash.json'), raw = { ...fixture.plan, motifContour:fixture.rejectedContours[1] };
  const before = structuredClone(raw), developed = C.develop(C.validate(raw));
  const old = { ...developed }; delete old.preserveContourExtrema;
  assert.throws(() => C.assertScore(Theory.arrangeSuite(old,'Quiet temple','captured-luna')), /flattened/);
  const actual = C.assertScore(Theory.arrangeSuite(developed,'Quiet temple','captured-luna'));
  assert.equal(actual.voices.length,3); assert.deepEqual(raw,before);
});
test('a truly too-narrow captured motif reports realized notes and repairs only its contour', () => {
  const C = require('../retort/sidComposition'), Theory = require('../retort/sidMusicTheory');
  const fixture = require('./fixtures/luna-names-beneath-ash.json'), raw = { ...fixture.plan, motifContour:fixture.rejectedContours[0] };
  assert.throws(() => C.assertScore(Theory.arrangeSuite(C.develop(raw),'Quiet temple','captured-luna')), error => {
    assert.equal(error.issues[0].path,'$.motifContour'); assert.match(error.message,/pitches \[/); assert.match(error.message,/intervals \[/);
    const repair = require('../retort/generationRepair').prepare(C.parameters,raw,error.issues);
    assert.deepEqual(repair.targets.map(t=>t.path),['$.motifContour']);
    const corrected = require('../retort/generationRepair').apply(repair,{fix_0:fixture.plan.motifContour});
    assert.deepEqual(corrected,{...raw,motifContour:fixture.plan.motifContour}); return true;
  });
});

test('a login-entered key can be remembered locally without replacing the active environment key', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Models=require('../retort/gameModels');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'luna-local-key-'));
  const previous={directory:process.env.HOLODEK_KEY_DIR,key:process.env.OPENAI_API_KEY};
  try {
    process.env.HOLODEK_KEY_DIR=directory;process.env.OPENAI_API_KEY='sk-environment-'+'E'.repeat(32);Models.loadSavedKeys();
    const entered='sk-remembered-'+'L'.repeat(32);
    assert.equal(Models.storedKeys().openai,false);
    Models.saveKey('openai',entered,{persistOnly:true});
    assert.equal(Models.keys().openai,'env');assert.equal(process.env.OPENAI_API_KEY,'sk-environment-'+'E'.repeat(32));
    assert.equal(fs.readFileSync(path.join(directory,'openai.key'),'utf8').trim(),entered);
    assert.deepEqual(fs.readdirSync(directory),['openai.key']);assert.equal(Models.storedKeys().openai,true);
    assert.ok(!JSON.stringify(Models.storedKeys()).includes(entered));
    delete process.env.OPENAI_API_KEY;Models.loadSavedKeys();
    assert.equal(process.env.OPENAI_API_KEY,entered);assert.equal(Models.keys().openai,'file');
  } finally {
    if(previous.directory===undefined)delete process.env.HOLODEK_KEY_DIR;else process.env.HOLODEK_KEY_DIR=previous.directory;
    if(previous.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.key;
    Models.loadSavedKeys();fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('startup prompts for an unremembered paid-provider key and never stores its value in the browser', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.open=false;this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(){} focus(){} showModal(){this.open=true;} close(){this.open=false;} remove(){this.removed=true;}
    async click(){await this.handlers.click?.();}
    querySelector(selector){return visit(this).find(e=>selector==='input:checked'&&e.tagName==='input'&&e.checked)||null;}
  }
  const visit=e=>[e,...(e.children||[]).filter(x=>x&&typeof x==='object'&&!x.removed).flatMap(visit)];
  const body=new Element('body'),head=new Element('head'),stored=[],requests=[];
  const document={body,head,createElement:t=>new Element(t),addEventListener(){},getElementById:id=>visit(body).concat(visit(head)).find(e=>e.id===id&&!e.removed)};
  const window={location:{search:'?nomodelselect'},localStorage:{getItem:()=>null,setItem:(k,v)=>stored.push([k,v])}};
  let remembered=false;
  const fetch=async(url,options)=>{
    if(url==='/provider-key'){const value=JSON.parse(options.body);requests.push(value);remembered=true;return{ok:true,json:async()=>({storedKeys:{openai:true}})};}
    return{ok:true,json:async()=>({current:{id:'gpt-6-luna',revision:1},all:[{id:'gpt-6-luna',name:'Luna',provider:'openai',status:'ready'}],keys:{openai:'env'},storedKeys:{openai:remembered}})};
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/modelSelectUi'),'utf8'),{window,document,fetch});
  await window.ModelSelectUi.open();
  const choosing=document.getElementById('model-select-continue').click();await Promise.resolve();
  const input=document.getElementById('provider-key-input');assert.equal(input.type,'password');
  input.value='sk-browser-test-'+'B'.repeat(32);const secret=input.value;
  const dialog=document.getElementById('provider-key-prompt'),save=visit(dialog).find(e=>e.textContent==='Save key');
  await save.click();await choosing;
  assert.equal(requests.length,1);assert.equal(requests[0].key,secret);assert.equal(requests[0].persistOnly,true);
  assert.equal(input.value,'');assert.equal(dialog.removed,true);
  assert.deepEqual(stored,[['holodek.gameModel','gpt-6-luna']]);assert.ok(!JSON.stringify(stored).includes(secret));
});

test('private diagnostics remove configured addresses and credentials without losing safe evidence', t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'private-diagnostics-')),old=process.env.HOLODEK_WEBSITE_AI_DIR;
  t.after(()=>{if(old===undefined)delete process.env.HOLODEK_WEBSITE_AI_DIR;else process.env.HOLODEK_WEBSITE_AI_DIR=old;fs.rmSync(folder,{recursive:true,force:true});});
  process.env.HOLODEK_WEBSITE_AI_DIR=folder;
  const host='private-worker.example.invalid',fingerprint='SHA256:'+'K'.repeat(43);
  fs.writeFileSync(path.join(folder,'connection.json'),JSON.stringify({host,fingerprint,identityFile:'/private/identity'}));
  const secret='sk-proj-'+'S'.repeat(40),D=require('../retort/privateDiagnostics');
  const data=D.value({status:400,reason:`${host} ${fingerprint} /private/identity ${secret} Authorization: Bearer other-secret`,nested:{reason:'safe'}});
  for(const value of [host,fingerprint,'/private/identity',secret,'other-secret'])assert.ok(!JSON.stringify(data).includes(value));
  assert.equal(data.status,400);assert.equal(data.nested.reason,'safe');
});

test('public peers cannot read website configuration or submit provider keys', async () => {
  const routes=[],app={get:(p,...h)=>routes.push([p,h]),post:(p,...h)=>routes.push([p,h]),use(){}};
  require('../retort/websiteAi').install(app);
  require('../retort/gameModels').install(app,{view:async()=>({keys:{openai:'none'}}),withSnapshot:fn=>fn()});
  for(const [route,handlers]of routes.filter(([p])=>p.startsWith('/website-ai')||p==='/provider-key')){
    let status=200,payload,continued=false;
    const res={setHeader(){},status:n=>{status=n;return res;},json:v=>{payload=v;}};
    await handlers[0]({socket:{remoteAddress:'203.0.113.8'},headers:{host:'localhost:3000'},body:{provider:'openai',key:'not-accepted'}},res,()=>{continued=true;});
    assert.equal(status,403,route);assert.equal(continued,false,route);
    assert.deepEqual(Object.keys(payload),['error']);assert.ok(!JSON.stringify(payload).includes('not-accepted'));
  }
});
