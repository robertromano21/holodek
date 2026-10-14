const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const I = require('../assets/dungeonInhabitants');
const DialogueAudience = require('../assets/dialogueAudience');
const Memory = require('../retort/dialogueMemory');
const CampaignMemory = require('../retort/campaignMemory');
const JourneyMemory = require('../retort/journeyMemory');
const { generateCharacterDialogue, describeCharacters } = require('../retort/characterDialogue');
const {createPopulationService,prepareEntryQuestContact}=require('../retort/roomPopulation');
const {formatStartingCharacterSheet}=require('../retort/initialGameState');
const zharok = require('./fixtures/zharok-dialogue.cjs');
const source = fs.readFileSync(path.join(__dirname,'../retort/retortWithUserInput.js'),'utf8').replace(/\r\n/g,'\n');
const entryCode = 'const physicalPuzzleResult = null;\n' + source.slice(source.indexOf('// Narration runs only after placement'),source.indexOf('// Include musicArrangement here',source.indexOf('// Narration runs only after placement')));
function fixture() {
  const d={geoKey:'1,0,0',classification:{indoor:true},layout:{width:64,height:64},start:{x:4,y:4},cells:{}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:6};
  const actors=[{name:'PC',type:'pc',hp:100,mazeX:4,mazeY:4,mazeRoomKey:d.geoKey},
    {name:'Companion',type:'npc',hp:20,mazeX:4,mazeY:5,mazeRoomKey:d.geoKey},
    {name:'Near Mason',type:'monster',hp:20,mazeX:6,mazeY:4,mazeRoomKey:d.geoKey},
    {name:'Distant Guard',type:'monster',hp:20,mazeX:25,mazeY:4,mazeRoomKey:d.geoKey},
    {name:'Hidden Guard',type:'monster',hp:20,mazeX:4,mazeY:8,mazeRoomKey:d.geoKey}];
  d.cells['4,7'].tile='wall';
  const p=I.createPopulation(d.geoKey,[{name:'Near Mason',allegiance:'Neutral',job:'grave mason'},
    {name:'Distant Guard',allegiance:'Hostile'},{name:'Hidden Guard',allegiance:'Hostile'}]);
  I.attach(actors,p);
  p.actors['Near Mason'].encounteredAt = 1000;
  p.groups.find(g => g.members.includes('Near Mason')).status = 'discovered';
  const ledger={characters:{},recent:[]};
  let consoleText='Room Description: A carved hall with a garden.\nCoordinates: X: 1, Y: 0, Z: 0\nTurns: 2';
  const state={getDialogueMemory:()=>ledger,getRoomDungeonForSimulation:()=>d,getCombatCharactersString:()=>JSON.stringify(actors),
    getCurrentQuest:()=> 'Retrieve the bound seal.',getUpdatedGameConsole:()=>consoleText,setUpdatedGameConsole:value=>consoleText=value,
    getLastCoords:()=>({x:1,y:0,z:0}),getDungeonRunId:()=> 'run',getGamePaused:()=>false,
    getLiveWorldState:()=>({roomKey:d.geoKey,player:{x:4.5,y:4.5},currentConversation:'The player asked about the missing mason.'})};
  return {d,p,actors,state,ledger,setConsole:value=>consoleText=value};
}
const reply={spoken:[{speaker:'Companion',line:'Watch the cracked lintel.'},{speaker:'Distant Guard',line:'Everyone attack now!'}],
  replies:[{speaker:'Companion',lines:['These walls remember us.','Stay close to the lantern.']},
    {speaker:'Near Mason',lines:['The old mortar crumbles.','Leave my chisels where they are.']},
    {speaker:'Distant Guard',lines:['No trespassers beyond this watch.','The east parapet needs repairs.']}]};
function agent(result=reply) {
  const prompts=[],requests=[];
  const tagged=(parts,...values)=>prompts.push(typeof parts === 'string' ? parts : String.raw({raw:parts},...values));
  return {prompts,requests,system:tagged,user:tagged,assistant:{generation:async options=>{
    requests.push(options);
    const json = JSON.stringify(result);
    return {content:prompts.some(p=>p.includes('Mark EVERY actual spoken passage')) ?
      (result.spoken || []).map(row=>`${row.speaker}: "${row.line}"`).join('\n\n') + ` [[CHARACTER_DIALOGUE]]${json}[[/CHARACTER_DIALOGUE]]` : json};
  }}};
}

for (const invalid of [false, true]) test(`actual story pipeline ${invalid ? 'stops on malformed biography JSON' : 'authors missing residents before their first dialogue'}`, async () => {
  const f = fixture(), a = agent(), names = f.actors.filter(actor => actor.type !== 'pc').map(actor => actor.name);
  const biographyPrompts = []; let biographies = 0, saves = 0;
  const bio = { user: (parts, ...values) => biographyPrompts.push(typeof parts === 'string' ? parts : String.raw({ raw: parts }, ...values)),
    assistant: { generation: async () => { biographies++; return { content: invalid ? '{broken' : JSON.stringify({ profiles: names.map(name => ({ name,
      personality: 'Patient and curious.', voice: 'Warm practical observations.', history: `Repaired the memorial at ${name}'s crossing. Taught apprentices.`, motivation: 'Rebuild the bridge.' })) }) }; } } };
  a.run = work => work(bio);
  f.state.setCombatCharactersString = value => f.actors.splice(0, f.actors.length, ...JSON.parse(value));
  const sandbox = { CharacterAuthorship: require('../retort/characterProfiles'), Inhabitants: I, DialogueMemory: Memory, JourneyMemory,
    generateCharacterDialogue, describeCharacters, sharedState: f.state, $: a, enteringRoom: true,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, updatedGameConsole: f.state.getUpdatedGameConsole(),
    roomName: 'Hall of Bells', roomDescription: 'A carved hall.', autoMax: 850, spoken: { dialogue: [], replies: [] },
    populationService: { prepare: () => f.p, save: () => saves++ }, console: { info() {}, warn() {} } };
  const run = () => vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response};})()`, sandbox);
  if (invalid) {
    await assert.rejects(run(), /Character history generation failed/);
    assert.equal(a.requests.length, 0); assert.equal(saves, 0); assert.equal(f.p.actors['Near Mason'].profile.history, '');
  } else {
    await run();
    assert.equal(a.requests.length, 1); assert.equal(saves, 1);
    assert.match(f.p.actors['Near Mason'].profile.history, /memorial/);
    assert.match(f.actors.find(row => row.name === 'Near Mason').originProfile.history, /memorial/);
    await run();
    assert.equal(biographies, 1, 'Revisits do not invent a new past.');
  }
  assert.equal(biographies, 1);
});
test('entry perception includes companions and genuinely nearby residents, not distant or occluded guards',()=>{
  const f=fixture(),v=I.perceive(f.d,f.actors,f.p,true);
  assert.deepEqual(v.nearby.map(a=>a.name),['Companion','Near Mason']);
  assert.deepEqual(v.distant.map(a=>a.name),['Distant Guard','Hidden Guard']);
  assert.equal(I.DIALOGUE_REFRESH_MS,300000);
});

for (const entry of [true, false]) test(`${entry ? 'entry' : 'ordinary turn'} keeps visible but nonconversational residents out of spoken dialogue`, async () => {
  const f = fixture(), a = agent({ spoken: [{ speaker: 'Near Mason', line: 'A whisper from several paces away.' }], replies: [] });
  f.d.classification.indoor = f.p.indoor = false;
  f.actors.find(a => a.name === 'Near Mason').mazeX = 15;
  const perception = I.perceive(f.d, f.actors, f.p, entry);
  assert.ok(perception.nearby.some(a => a.name === 'Near Mason'), 'Visible outdoors at eleven tiles, outside the ten-tile dialogue range');
  assert.ok(!perception.conversational.some(a => a.name === 'Near Mason'));
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters, sharedState: f.state,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: entry, updatedGameConsole: f.state.getUpdatedGameConsole(),
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, autoMax: 850,
    populationService: { prepare: () => f.p }, run: async work => work(a), retort: work => work,
    $: a, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(result.spoken.dialogue.length, 0);
  assert.doesNotMatch(result.response, /A whisper from several paces away/);
  assert.doesNotMatch(a.prompts.find(p=>p.startsWith('Perception is authoritative.')), /Near Mason/);
});
test('actual room entry finishes the main Retort narrative while rejecting remote speech',async()=>{
  const f=fixture(),a=agent(),worldBefore=JSON.stringify(f.d),stateBefore=f.state.getUpdatedGameConsole();
  const context={Inhabitants:I,DialogueMemory:Memory,JourneyMemory,generateCharacterDialogue,describeCharacters,sharedState:f.state,
    geoCoords:{x:1,y:0,z:0},geoKey:f.d.geoKey,enteringRoom:true,updatedGameConsole:stateBefore,
    roomDescription:'A carved hall with a garden.',personalNarrative:'A missing mason needs help.',spoken:{dialogue:[],replies:[]},autoMax:850,
    populationService:{prepare:()=>f.p},run:async()=>{throw Error('Entry must stay in the main Retort context.');},retort:work=>work,
    $:a,console:{info(){},warn(){}}};
  const result=await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken,population};})()`,context);
  assert.equal(a.requests.length,1);
  assert.deepEqual(result.spoken.dialogue.map(row=>row.speaker),['Companion']);
  assert.doesNotMatch(result.response,/Distant Guard|Everyone attack/);
  assert.match(a.prompts.join('\n'),/ROOM ENTRY/);
  assert.doesNotMatch(a.prompts.find(p=>p.startsWith('Perception is authoritative.')),/Distant Guard|Hidden Guard/);
  assert.equal(JSON.stringify(f.d),worldBefore);assert.equal(f.state.getUpdatedGameConsole(),stateBefore);
  assert.equal(f.p.actors['Distant Guard'].dialogue.length,2,'Future caches are still refreshed in the existing narrative request.');
  assert.equal(f.p.companions.Companion.dialogue.length,2);
});
test('normal command narration supplies subtitles and refreshes all caches in that same model request',async()=>{
  const f=fixture(),prompts=[],requests=[];
  const context={Inhabitants:I,DialogueMemory:Memory,JourneyMemory,generateCharacterDialogue,describeCharacters,sharedState:f.state,
    geoCoords:{x:1,y:0,z:0},geoKey:f.d.geoKey,enteringRoom:false,updatedGameConsole:f.state.getUpdatedGameConsole(),autoMax:850,
    roomDescription:'A carved hall.',personalNarrative:'',spoken:{dialogue:[],replies:[]},populationService:{prepare:()=>f.p},
    $:{user:(parts,...values)=>prompts.push(String.raw({raw:parts},...values)),assistant:{generation:async options=>{
      requests.push(options);return {content:`The mason nods. [[CHARACTER_DIALOGUE]]${JSON.stringify(reply)}[[/CHARACTER_DIALOGUE]]`};}}},
    console:{info(){},warn(){}}};
  const result=await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken,population};})()`,context);
  assert.equal(requests.length,1);assert.ok(requests[0].maxTokens<=4200);
  assert.equal(result.response,'The mason nods.');
  assert.equal(result.spoken.dialogue.length,1);
  assert.equal(f.p.actors['Distant Guard'].dialogue.length,2);
  assert.equal(f.p.actors['Distant Guard'].allegiance,'Hostile');
  assert.ok(prompts.some(p=>p.includes('Only these characters are nearby')&&p.includes('Near Mason')&&!p.includes('Distant Guard')));
  assert.equal(f.ledger.recent.length,0,'Generated future replies are not remembered as already spoken.');
});

test('the actual directed Retort turn permits a monster answer and one grounded companion follow-up, not a chorus', async () => {
  const f = fixture(), prompts = []; let requests = 0;
  const trigger = 'Martellius kept the seal beneath the northern stair.';
  const raw = `Near Mason says, "[[SPEECH:"Near Mason"]]${trigger}[[/SPEECH]]"\n\n` +
    'Companion asks, "[[SPEECH:"Companion"]]Mason, is that stair still guarded?[[/SPEECH]]"\n\n' +
    'Distant Guard says, "[[SPEECH:"Distant Guard"]]I know the answer too.[[/SPEECH]]"' +
    ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [{ speaker: 'Companion', replyTo: 'Near Mason', reactsTo: trigger }],
      replies: [{ speaker: 'Distant Guard', lines: ['Future watch duty.', 'Another future remark.'] }] }) + '[[/CHARACTER_DIALOGUE]]';
  const before = JSON.stringify(f.d), consoleBefore = f.state.getUpdatedGameConsole();
  const context = { Inhabitants: I, DialogueAudience, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters,
    sharedState: f.state, geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: false,
    userInput: 'ask Near Mason about Martellius', updatedGameConsole: consoleBefore, autoMax: 850,
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, populationService: { prepare: () => f.p },
    $: { user: (parts, ...values) => prompts.push(typeof parts === 'string' ? parts : String.raw({ raw: parts }, ...values)),
      assistant: { generation: async () => { requests++; return { content: raw }; } } }, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(requests, 1); assert.equal(JSON.stringify(f.d), before); assert.equal(f.state.getUpdatedGameConsole(), consoleBefore);
  assert.deepEqual(result.spoken.dialogue.map(row => row.speaker), ['Near Mason', 'Companion']);
  assert.match(result.response, /is that stair still guarded/); assert.doesNotMatch(result.response, /Distant Guard|SPEECH|CHARACTER_DIALOGUE/);
  assert.ok(prompts.some(prompt => prompt.startsWith('Dialogue recipient rule:') && prompt.includes('replyTo')));
  assert.equal(f.p.actors['Distant Guard'].dialogue[0], 'Future watch duty.');
  assert.ok(f.p.dialogueFocus.until > Date.now()); assert.equal(f.p.dialogueFocus.responders[0], 'Near Mason');
});

test('directed exchanges defer ambient cached remarks without consuming them or preventing discovery', () => {
  const f = fixture(), sheet = name => formatStartingCharacterSheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Fighter',
    Level: 1, AC: 10, HP: 40, MaxHP: 40 });
  f.state.getUpdatedGameConsole = () => `Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party:\n${sheet('Companion')}\nMonsters in Room:\n${sheet('Near Mason')}\nMonsters Equipped Properties: None\nRooms Visited: 1`;
  let db = '{}'; Object.assign(f.state, { getRoomPopulation: () => f.p, setRoomPopulation() {}, getRoomNameDatabase: () => db,
    setRoomNameDatabase: value => db = value, setCombatCharactersString() {} });
  for (const actor of f.actors.filter(a => a.type === 'monster')) {
    const record = f.p.actors[actor.name], group = f.p.groups.find(g => g.members.includes(actor.name));
    record.position = { x: actor.mazeX, y: actor.mazeY }; group.site = { ...record.position }; group.status = 'discovered'; group.introPlayed = true;
  }
  I.applyReplies(f.p, [{ speaker: 'Companion', lines: ['An ambient remark.'] }], f.actors);
  f.p.dialogueFocus = { responders: ['Near Mason'], until: Date.now() + 60000 };
  const service = createPopulationService(f.state), visit = () => service.visit({ geoKey: f.d.geoKey, runId: 'run', player: { x: 4.5, y: 4.5 } });
  assert.deepEqual(visit().dialogue, []); assert.equal(f.p.companions.Companion.dialogueIndex, 0);
  const group = f.p.groups.find(g => g.members.includes('Near Mason')); group.introPlayed = false;
  I.applyReplies(f.p, [{ speaker: 'Near Mason', lines: ['A genuine encounter greeting.'] }], f.actors);
  assert.equal(visit().dialogue[0].kind, 'encounter');
  f.p.dialogueFocus.until = Date.now() - 1; f.p.lastCannedSpeechAt = 0;
  assert.equal(visit().dialogue[0].line, 'An ambient remark.');
});

test('the actual ordinary Retort branch extracts Zharok\'s whole logged monologue in its existing single request', async () => {
  const f = fixture(); f.actors.find(actor => actor.name === 'Near Mason').name = zharok.speaker;
  f.p.actors[zharok.speaker] = { ...f.p.actors['Near Mason'], name: zharok.speaker };
  delete f.p.actors['Near Mason'];
  for (const group of f.p.groups) group.members = group.members.map(name => name === 'Near Mason' ? zharok.speaker : name);
  let requests = 0;
  const before = JSON.stringify(f.d), raw = zharok.prose + ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [
    { speaker: zharok.speaker, line: zharok.fragment }
  ], replies: [] }) + '[[/CHARACTER_DIALOGUE]]';
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters, sharedState: f.state,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: false, updatedGameConsole: f.state.getUpdatedGameConsole(), autoMax: 850,
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, populationService: { prepare: () => f.p },
    $: { user() {}, assistant: { generation: async () => { requests++; return { content: raw }; } } }, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(requests, 1); assert.equal(result.response, zharok.prose); assert.equal(JSON.stringify(f.d), before);
  assert.deepEqual(result.spoken.dialogue, [{ speaker: zharok.speaker, line: zharok.speech }]);
});

test('ordinary narration requests invisible backend speaker labels, strips them from the Game Log and keeps adjudication untouched', async () => {
  const f = fixture(), prompts = []; let requests = 0;
  const plain = 'A claw taps the gate.\n\n"The passage is safe."\n\nThe lantern gutters.';
  const raw = plain.replace('The passage is safe.', '[[SPEECH:"Near Mason"]]The passage is safe.[[/SPEECH]]') +
    ' [[CHARACTER_DIALOGUE]]' + JSON.stringify({ spoken: [{ speaker: 'Near Mason', remember: 'The passage is safe.' }], replies: [] }) + '[[/CHARACTER_DIALOGUE]]';
  const before = JSON.stringify(f.d), consoleBefore = f.state.getUpdatedGameConsole();
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters, sharedState: f.state,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: false, updatedGameConsole: consoleBefore, autoMax: 850,
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, populationService: { prepare: () => f.p },
    $: { user: (parts, ...values) => prompts.push(String.raw({ raw: parts }, ...values)),
      assistant: { generation: async () => { requests++; return { content: raw }; } } }, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(requests, 1); assert.equal(result.response, plain); assert.equal(JSON.stringify(f.d), before);
  assert.equal(f.state.getUpdatedGameConsole(), consoleBefore); assert.equal(f.state.getCurrentQuest(), 'Retrieve the bound seal.');
  assert.deepEqual(result.spoken.dialogue, [{ speaker: 'Near Mason', line: 'The passage is safe.', attribution: 'labelled', remember: 'The passage is safe.' }]);
  const instruction = prompts.find(value => value.includes('[[SPEECH:'));
  assert.ok(instruction.includes('Mark EVERY actual spoken passage') && instruction.includes('quotation marks and paragraph breaks stay natural'));
  assert.ok(instruction.includes('all words spoken in this quote') && !instruction.includes('40 words each'));
  assert.ok(instruction.includes('Near Mason') && instruction.includes('Companion') && !instruction.slice(0, instruction.indexOf('Replies:')).includes('Distant Guard'));
});
const tickCode=source.slice(source.indexOf('async function runNpcAutonomyTick('),source.indexOf('async function runLegacyNpcAutonomyTick('));

function personalFixture() {
  const f = fixture(), archive = { runId: 'run', records: [] };
  f.state.getCampaignMemory = () => archive;
  f.state.getRoomPopulation = () => f.p;
  CampaignMemory.add(f.state, [{ id: 'mason-promise', runId: 'run', roomKey: '1,0,0', kind: 'dialogue', authority: 'statement',
    source: 'turn-dialogue', text: 'The missing mason is my brother. I promised to search for him by the bound seal.',
    speaker: 'Near Mason', actors: ['Near Mason'], witnesses: ['Near Mason', 'Companion'] }]);
  return f;
}

for (const enteringRoom of [true, false]) test(`${enteringRoom ? 'entry' : 'ordinary command'} carries owner-filtered memories into its existing single dialogue request`, async () => {
  const f = personalFixture(), a = agent(), captured = [];
  const memory = { ...CampaignMemory, dialogueContext: (...args) => { const rows = CampaignMemory.dialogueContext(...args); captured.push(rows); return rows; } };
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, CampaignMemory: memory, generateCharacterDialogue, describeCharacters,
    sharedState: f.state, geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom,
    updatedGameConsole: f.state.getUpdatedGameConsole(), autoMax: 850, roomDescription: 'A carved hall.',
    userInput: 'What about the missing mason?', personalNarrative: '', spoken: { dialogue: [], replies: [] },
    populationService: { prepare: () => f.p }, run: async work => work(a), retort: work => work,
    $: a, console: { info() {}, warn() {} } };
  await vm.runInNewContext(`(async()=>{${entryCode}})()`, context);
  assert.equal(a.requests.length, 1); assert.match(a.prompts.join('\n'), /promised to search for him/);
  const rows = captured.flat(); assert.ok(rows.some(row => row.name === 'Near Mason' && row.memories.some(r => r.id === 'mason-promise')));
  assert.ok(rows.filter(row => row.name === 'Distant Guard').every(row => !row.heardCurrentConversation && !row.memories.some(r => r.id === 'mason-promise')));
});

test('the actual five-minute cache pipeline retrieves specific witnessed exchanges without another model call', async () => {
  const f = personalFixture(), a = agent(), captured = [];
  const memory = { ...CampaignMemory, dialogueContext: (...args) => { const rows = CampaignMemory.dialogueContext(...args); captured.push(rows); return rows; } };
  const context = { Inhabitants: I, DialogueMemory: Memory, CampaignMemory: memory, describeCharacters, generateCharacterDialogue, sharedState: f.state,
    populationService: { get: () => f.p, save() {} }, sanitizeLiveWorldStateForPrompt: v => v,
    run: async work => work(a), retort: work => work, console: { warn() {}, info() {} } };
  vm.runInNewContext(tickCode, context);
  const result = await context.runNpcAutonomyTick();
  assert.equal(result.refreshed, true); assert.equal(a.requests.length, 1); assert.equal(result.dialogue.length, 0);
  assert.match(a.prompts.join('\n'), /missing mason is my brother/);
  assert.ok(captured[0].find(row => row.name === 'Near Mason').memories.some(row => row.id === 'mason-promise'));
  assert.deepEqual(captured[0].find(row => row.name === 'Distant Guard').memories, []);
});
test('five-minute refresh batches all living characters once, speaks nothing immediately and respects its cooldown',async()=>{
  const f=fixture(),a=agent(),before=f.state.getUpdatedGameConsole();let saves=0;
  const context={Inhabitants:I,DialogueMemory:Memory,describeCharacters,generateCharacterDialogue,sharedState:f.state,
    populationService:{get:()=>f.p,save:()=>saves++},sanitizeLiveWorldStateForPrompt:v=>v,
    run:async work=>work(a),retort:work=>work,console:{warn(){},info(){}}};
  vm.runInNewContext(tickCode,context);
  const first=await context.runNpcAutonomyTick();
  assert.ok(first.refreshed);assert.equal(first.dialogue.length,0);assert.equal(a.requests.length,1);assert.equal(saves,1);
  assert.equal(f.p.actors['Distant Guard'].dialogue[0],'No trespassers beyond this watch.');
  assert.equal(f.state.getUpdatedGameConsole(),before);assert.equal(f.ledger.recent.length,0);
  const second=await context.runNpcAutonomyTick();assert.ok(second.cached);assert.equal(a.requests.length,1);
});
for(const change of ['run','room','pause','command','newer-cache'])test(`a pending cache refresh is discarded after a ${change} change`,async()=>{
  const f=fixture(),a=agent();let saves=0;
  const context={Inhabitants:I,DialogueMemory:Memory,describeCharacters,generateCharacterDialogue,sharedState:f.state,
    populationService:{get:()=>f.p,save:()=>saves++},sanitizeLiveWorldStateForPrompt:v=>v,
    run:async work=>{
      const result=await work(a);
      if(change==='run')f.state.getDungeonRunId=()=> 'new-run';
      if(change==='room')f.state.getLastCoords=()=>({x:2,y:0,z:0});
      if(change==='pause')f.state.getGamePaused=()=>true;
      if(change==='command')f.setConsole('A different authoritative console.');
      if(change==='newer-cache')f.p.lastDialogueRefreshAt=Date.now();
      return result;
    },retort:work=>work,console:{warn(){},info(){}}};
  vm.runInNewContext(tickCode,context);
  const result=await context.runNpcAutonomyTick();assert.equal(result.refreshed,undefined);assert.equal(saves,0);
  assert.equal(f.p.actors['Near Mason'].dialogue.length,0);
});
test('invalid cache output and fabricated speakers cannot overwrite existing lines or character identities',async()=>{
  const f=fixture(),a=agent({spoken:[],replies:[{speaker:'Hades',lines:['You win.']},{speaker:'Near Mason',lines:[{},null,3]}]});
  const result=await generateCharacterDialogue(a,{characters:describeCharacters(f.actors,f.p)});
  assert.deepEqual(result.replies,[]);assert.equal(I.applyReplies(f.p,result.replies,f.actors),0);
  assert.equal(f.p.actors.Hades,undefined);
});
test('ordinary attributed prose becomes subtitles when the model omits its structured speech block',()=>{
  const raw='Near Mason says, "Leave my chisels alone." "We should keep moving," Companion murmurs.\nDistant Guard: "Not for you."';
  const result=I.extractDialogue(raw,['Near Mason','Companion']);
  assert.deepEqual(result.dialogue,[{speaker:'Near Mason',line:'Leave my chisels alone.'},{speaker:'Companion',line:'We should keep moving,'}]);
  assert.equal(result.content,raw);assert.deepEqual(result.replies,[]);
});
test('entry speech for an already encountered resident cannot replay its initial cached line',()=>{
  const f=fixture();
  I.applyReplies(f.p,[{speaker:'Near Mason',lines:['Leave my chisels alone.','The old mortar crumbles.']}],f.actors);
  I.noteSpoken(f.p,[{speaker:'Near Mason',line:'Leave my chisels alone.'}],true);
  assert.equal(f.p.groups.find(g=>g.members.includes('Near Mason')).introPlayed,true);
  assert.equal(f.p.actors['Near Mason'].dialogueIndex,1);
  assert.equal(f.p.groups.find(g=>g.members.includes('Distant Guard')).status,'unseen');
});

test('fresh nearby room residents produce no entry speech, Game Log dialogue, or false discovery', async () => {
  const f = fixture();
  delete f.p.actors['Near Mason'].encounteredAt;
  f.p.groups.find(g => g.members.includes('Near Mason')).status = 'unseen';
  f.actors = f.actors.filter(actor => actor.type !== 'npc');
  f.state.getCombatCharactersString = () => JSON.stringify(f.actors);
  const a = agent({ spoken: [{ speaker: 'Near Mason', line: 'I have not met the player.' }], replies: [] });
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters, sharedState: f.state,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: true, updatedGameConsole: f.state.getUpdatedGameConsole(),
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, autoMax: 850,
    populationService: { prepare: () => f.p }, run: async work => work(a), retort: work => work,
    $: a, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(result.response, '');
  assert.equal(result.spoken.dialogue.length, 0);
  assert.equal(a.requests.length, 1, 'Retort still finishes environmental and quest narration even without an available speaker.');
  assert.equal(f.p.groups.find(g => g.members.includes('Near Mason')).status, 'unseen');
  assert.equal(f.p.groups.find(g => g.members.includes('Near Mason')).introPlayed, false);
  assert.equal(f.p.actors['Near Mason'].dialogueIndex, 0);
});

test('generating entry words cannot itself establish an encounter or consume its introduction', () => {
  const f = fixture(); delete f.p.actors['Near Mason'].encounteredAt;
  const group = f.p.groups.find(g => g.members.includes('Near Mason')); group.status = 'unseen';
  I.applyReplies(f.p, [{ speaker: 'Near Mason', lines: ['Mind the cracked arch.'] }], f.actors);
  I.noteSpoken(f.p, [{ speaker: 'Near Mason', line: 'Mind the cracked arch.' }], true);
  assert.equal(group.status, 'unseen'); assert.equal(group.introPlayed, false);
  assert.equal(f.p.actors['Near Mason'].dialogueIndex, 0);
});

test('an unbound quest-contact claim does not allow a nearby undiscovered resident to speak on entry', async () => {
  const f = fixture(); delete f.p.actors['Near Mason'].encounteredAt;
  const group = f.p.groups.find(g => g.members.includes('Near Mason')); group.status = 'unseen';
  f.p.questIntroduction = { speaker: 'Near Mason', status: 'pending', questId: 'bound-seal' };
  const a = agent({ spoken: [{ speaker: 'Companion', line: 'Watch the cracked lintel.' },
    { speaker: 'Near Mason', line: 'My quest introduction is premature.' }], replies: [] });
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, generateCharacterDialogue, describeCharacters, sharedState: f.state,
    geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: true, updatedGameConsole: f.state.getUpdatedGameConsole(),
    roomDescription: 'A carved hall.', personalNarrative: '', spoken: { dialogue: [], replies: [] }, autoMax: 850,
    populationService: { prepare: () => f.p }, run: async work => work(a), retort: work => work,
    $: a, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(result.response, 'Companion: "Watch the cracked lintel."');
  assert.equal(result.spoken.dialogue.length, 1);
  assert.doesNotMatch(a.prompts.find(p=>p.startsWith('Perception is authoritative.')), /Near Mason/);
  assert.equal(f.p.questIntroduction.status, 'pending');
  assert.equal(group.introPlayed, false); assert.equal(group.status, 'unseen');
});

for (const state of ['Neutral', 'Friendly']) test(`entry connects the existing quest hook to its actual nearby ${state} contact in the main Retort`, async () => {
  const f = fixture(), record = f.p.actors['Near Mason'], group = f.p.groups.find(g => g.members.includes(record.name));
  delete record.encounteredAt; group.status = 'unseen'; record.allegiance = state;
  const actor = f.actors.find(a => a.name === record.name); actor.state = state;
  f.p.questIntroduction = { speaker: record.name, status: 'pending', questId: String(I.hash(f.state.getCurrentQuest())),
    hook: 'My brother vanished near the bound seal. Will you help?' };
  const a = agent({ spoken: [{ speaker: record.name, line: 'My brother vanished near the bound seal. Will you help?' },
    { speaker: 'Distant Guard', line: 'I heard everything and am attacking.' }], replies: [] });
  const before = JSON.stringify(f.d), consoleBefore = f.state.getUpdatedGameConsole();
  const context = { Inhabitants: I, DialogueMemory: Memory, JourneyMemory, prepareEntryQuestContact, describeCharacters,
    sharedState: f.state, geoCoords: { x: 1, y: 0, z: 0 }, geoKey: f.d.geoKey, enteringRoom: true, isFirstTurn: false,
    updatedGameConsole: consoleBefore, userInput: 'north', roomDescription: 'A carved hall.', personalNarrative: '',
    spoken: { dialogue: [], replies: [] }, autoMax: 850, populationService: { prepare: () => f.p }, $: a,
    run: async () => { throw Error('Keep the quest-seeding context from the main Retort.'); }, console: { info() {}, warn() {} } };
  const result = await vm.runInNewContext(`(async()=>{${entryCode}\nreturn {response,spoken};})()`, context);
  assert.equal(a.requests.length, 1); assert.match(result.response, /brother vanished/);
  assert.doesNotMatch(result.response, /Distant Guard|attacking/);
  assert.deepEqual(result.spoken.dialogue.map(row => row.speaker), [record.name]);
  assert.ok(a.prompts.some(prompt => prompt.includes(`visibly encountered ${state} contact`)));
  assert.ok(a.prompts.some(prompt => prompt.includes('EXISTING quest') && prompt.includes('bound seal')));
  assert.equal(f.p.questIntroduction.status, 'introduced'); assert.ok(record.encounteredAt > 0);
  assert.equal(group.status, 'discovered'); assert.equal(group.introPlayed, true);
  assert.equal(f.p.actors['Distant Guard'].encounteredAt, undefined);
  assert.equal(f.state.getUpdatedGameConsole(), consoleBefore); assert.equal(JSON.stringify(f.d), before);
  assert.equal(f.state.getCurrentQuest(), 'Retrieve the bound seal.');
});
test('cached speech rotates fairly between nearby workers and companions, including across refreshes',()=>{
  const f=fixture();f.actors.push({name:'Second Companion',type:'npc',hp:20,mazeX:5,mazeY:5,mazeRoomKey:f.d.geoKey});
  const sheet=name=>formatStartingCharacterSheet({Name:name,Sex:'Female',Race:'Human',Class:'Fighter',Level:1,AC:10,HP:40,MaxHP:40});
  f.state.getUpdatedGameConsole=()=>`Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party:\n${sheet('Companion')}\n${sheet('Second Companion')}\nMonsters in Room:\n${['Near Mason','Distant Guard','Hidden Guard'].map(sheet).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 1`;
  for(const actor of f.actors.filter(a=>a.type==='monster')){
    f.p.actors[actor.name].position={x:actor.mazeX,y:actor.mazeY};
    const group=f.p.groups.find(g=>g.members.includes(actor.name));group.site={...f.p.actors[actor.name].position};group.introPlayed=true;group.status='discovered';
  }
  let db='{}';Object.assign(f.state,{getRoomPopulation:()=>f.p,setRoomPopulation(){},getRoomNameDatabase:()=>db,setRoomNameDatabase:value=>db=value,setCombatCharactersString(){}});
  const replies=['Near Mason','Companion','Second Companion'].map(speaker=>({speaker,lines:['First remark.','Second remark.']}));
  I.applyReplies(f.p,replies,f.actors);const service=createPopulationService(f.state),heard=[];
  for(let i=0;i<3;i++){
    f.p.lastCannedSpeechAt=0;
    heard.push(service.visit({geoKey:f.d.geoKey,runId:'run',player:{x:4.5,y:4.5}}).dialogue[0].speaker);
  }
  assert.deepEqual(new Set(heard),new Set(['Near Mason','Companion','Second Companion']));
  f.p.companions.Companion.lastSpokeAt=300;f.p.companions['Second Companion'].lastSpokeAt=100;f.p.actors['Near Mason'].lastSpokeAt=200;
  I.applyReplies(f.p,replies,f.actors);f.p.lastCannedSpeechAt=0;
  assert.equal(service.visit({geoKey:f.d.geoKey,runId:'run',player:{x:4.5,y:4.5}}).dialogue[0].speaker,'Second Companion');
});
