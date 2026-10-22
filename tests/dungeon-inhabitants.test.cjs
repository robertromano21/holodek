const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const { createCombatSpace } = require('../retort/dungeonReach');
const { createPopulationService } = require('../retort/roomPopulation');
const { generateInhabitants, needsQuestIntroduction } = require('../retort/inhabitantGeneration');
const inhabitantReply = require('./fixtures/inhabitants.cjs');
const { batchRows, slotIds } = require('./fixtures/inhabitant-batch.cjs');
const { ActionDice } = require('../retort/actionDice');
const { buildInitialWorldConsole, buildInitialGameConsole, formatStartingCharacterSheet } = require('../retort/initialGameState');
function dungeon(size = 64) {
  const cells = {};
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells[`${x},${y}`] = {
    tile: x === 0 || y === 0 || x === size-1 || y === size-1 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 6 };
  return { geoKey: '1,0,0', layout: { width: size, height: size }, start: { x: 3, y: 3 }, cells };
}
const descriptor = (name, allegiance = 'Hostile', encounterId = name) => ({ name, allegiance, encounterId, job: 'grave mason', routine: 'work', dialogue: ['Keep clear of my work.'] });
const character = (name, type, x, y) => ({ name, type, hp: 100, mazeX: x, mazeY: y, mazeRoomKey: '1,0,0', x, y });
function sheet(name, hp = 100) {
  return formatStartingCharacterSheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Fighter', Level: 1,
    AC: 10, XP: 0, HP: hp, MaxHP: 100, Attack: 1, Damage: 1 });
}
function consoleText(names, hp = 100) {
  return `Coordinates: X: 1, Y: 0, Z: 0\nNPCs in Party: None\nMonsters in Room:\n${names.map(n => sheet(n, hp)).join('\n')}\nMonsters Equipped Properties: None\nMonsters State: Mixed\nRooms Visited: 1`;
}

test('population metadata keeps the original fourteen-line character sheets intact with LF or CRLF', () => {
  for (const eol of ['\n','\r\n']) {
    const text = consoleText(['Mason','Warden']).replace(/\n/g,eol), parsed = I.parseSheets(text);
    assert.deepEqual(parsed.map(a=>a.name), ['Mason','Warden']);
    assert.equal(parsed[0].sheet.split('\n').length,15);
    assert.equal(parsed[1].hp,100);
  }
});
test('individual allegiances override the shared room flag; companions are always friendly', () => {
  assert.equal(I.allegiance({ allegiance: 'Neutral' }, 'Hostile'), 'Neutral');
  assert.equal(I.allegiance({ type: 'npc', allegiance: 'Hostile' }), 'Friendly');
  assert.equal(I.allegiance({ type: 'monster', allegiance: 'Friendly' }, 'Hostile'), 'Friendly');
});
test('population limits are ten indoors, twenty outdoors, four at the starting temple; groups never exceed four', () => {
  const rows = Array.from({length:40},(_,i)=>descriptor(`Warden${i}`,'Hostile','army'));
  for (const [options, count] of [[{indoor:true},10],[{indoor:false},20],[{starting:true},4]]) {
    const population = I.createPopulation('1,0,0',rows,options);
    assert.equal(Object.keys(population.actors).length,count);
    assert.ok(population.groups.every(g=>g.members.length <=4));
    if(options.starting) assert.ok(Object.values(population.actors).every(a=>a.allegiance==='Friendly'));
  }
});
test('encounters spread across reachable sites, leave the arrival clear, and never populate sealed chambers', () => {
  const d = dungeon(96);
  for(let y=1;y<95;y++) d.cells[`80,${y}`].tile='wall';
  const p = I.createPopulation(d.geoKey,Array.from({length:10},(_,i)=>descriptor(`Warden${i}`,'Hostile',`group${Math.floor(i/2)}`)));
  I.place(p,d);
  assert.ok(p.groups.every(g=>g.site));
  for(const actor of Object.values(p.actors)) {
    assert.ok(actor.position.x<80);
    assert.ok(Math.abs(actor.position.x-d.start.x)+Math.abs(actor.position.y-d.start.y)>=9);
  }
  for(let i=0;i<p.groups.length;i++) for(let j=i+1;j<p.groups.length;j++)
    assert.ok(Math.hypot(p.groups[i].site.x-p.groups[j].site.x,p.groups[i].site.y-p.groups[j].site.y)>=12);
  const saved = JSON.stringify(p); I.place(p,d); assert.equal(JSON.stringify(p),saved);
});
test('a cramped dungeon leaves encounters unplaced instead of stacking them on the PC', () => {
  const d=dungeon(9), p=I.createPopulation(d.geoKey,Array.from({length:10},(_,i)=>descriptor(`Warden${i}`)));
  I.place(p,d); assert.ok(p.groups.some(g=>!g.site));
  assert.ok(Object.values(p.actors).every(a=>!a.position || Math.hypot(a.position.x-3,a.position.y-3)>2));
});

test('indoor encounters immediately occupy fixed reachable sites and retain them on revisits', () => {
  const d = dungeon(96); d.classification = { indoor: true };
  const p = I.createPopulation(d.geoKey, Array.from({ length: 8 }, (_, i) =>
    descriptor(`Resident${i}`, i < 3 ? 'Neutral' : 'Hostile', `group${Math.floor(i / 3)}`)));
  I.place(p, d);
  assert.ok(p.groups.every(g => g.site && g.discoveryState === 'fixed'));
  assert.ok(Object.values(p.actors).every(a => a.discoveryState === 'fixed' && I.walkable(d, a.position.x, a.position.y)));
  assert.equal(p.travelDiscovery, undefined);
  const saved = JSON.stringify(p), restored = JSON.parse(saved);
  I.place(restored, d); assert.equal(JSON.stringify(restored), saved);
});

test('indoor placement removes stale deferred actor flags without moving saved sites or reviving residents', () => {
  const d = dungeon(); d.classification = { indoor: true };
  const p = I.createPopulation(d.geoKey, [descriptor('Guard'), descriptor('Fallen')], { indoor: false });
  for (const [i, g] of p.groups.entries()) {
    g.site = { x: 18 + i * 14, y: 18 }; g.discoveryState = 'pending';
    Object.assign(p.actors[g.members[0]], { discoveryState: 'pending', home: { ...g.site }, position: { ...g.site }, hp: 20 });
  }
  Object.assign(p.actors.Fallen, { status: 'dead', hp: 0, state: 'Dead' }); p.groups[1].status = 'exhausted';
  const positions = JSON.stringify(Object.values(p.actors).map(a => ({ home: a.home, position: a.position })));
  I.place(p, d);
  assert.equal(p.indoor, true); assert.equal(p.actors.Guard.discoveryState, 'fixed');
  assert.equal(p.groups[0].discoveryState, 'fixed'); assert.equal(p.groups[0].status, 'unseen');
  assert.equal(p.actors.Fallen.status, 'dead'); assert.equal(p.actors.Fallen.hp, 0); assert.equal(p.groups[1].status, 'exhausted');
  assert.equal(JSON.stringify(Object.values(p.actors).map(a => ({ home: a.home, position: a.position }))), positions);
  const saved = JSON.stringify(p); I.place(p, d); assert.equal(JSON.stringify(p), saved);
});
test('walls, closed doors, corner cracks and elevation block perception', () => {
  const d=dungeon(), a={x:4.5,y:4.5},b={x:8.5,y:4.5};
  assert.ok(I.lineClear(d,a,b)); d.cells['6,4'].tile='wall'; assert.equal(I.lineClear(d,a,b),false);
  d.cells['6,4']={tile:'door',door:{isOpen:false},floorHeight:0,ceilHeight:6}; assert.equal(I.lineClear(d,a,b),false);
  d.cells['6,4'].door.isOpen=true; assert.ok(I.lineClear(d,a,b));
  d.cells['6,4'].floorHeight=4; assert.equal(I.lineClear(d,a,b),false);
  d.cells['5,4'].tile='wall'; assert.equal(I.lineClear(d,a,{x:5.5,y:5.5}),false);
});
test('combat engages one local hostile group, friendlies help, neutrals and distant hostiles watch', () => {
  const d=dungeon(), p=I.createPopulation(d.geoKey,[descriptor('Guard','Hostile','near'),descriptor('Guard2','Hostile','near'),
    descriptor('Far','Hostile','far'),descriptor('Mason','Neutral'),descriptor('Pilgrim','Friendly')]);
  const roster=[character('PC','pc',4,4),character('Companion','npc',3,4),character('Guard','monster',6,4),
    character('Guard2','monster',7,5),character('Far','monster',40,40),character('Mason','monster',4,5),character('Pilgrim','monster',4,6)];
  const teams=I.teams(roster,p,createCombatSpace(d,roster,d.geoKey),'attack Guard');
  assert.deepEqual(teams.hostiles.map(a=>a.name),['Guard','Guard2']);
  assert.deepEqual(teams.friends.map(a=>a.name),['PC','Companion','Pilgrim']);
  assert.deepEqual(teams.spectators.map(a=>a.name),['Far','Mason']);
  assert.ok(teams.targets(roster[6]).every(a=>a.name.startsWith('Guard')));
  assert.ok(teams.targets(roster[2]).every(a=>['PC','Companion','Pilgrim'].includes(a.name)));
});
test('attacking a neutral or friendly resident provokes only that individual, not another encounter', () => {
  const d=dungeon(), p=I.createPopulation(d.geoKey,[descriptor('Mason','Neutral','workers'),descriptor('Mason2','Neutral','workers'),descriptor('Pilgrim','Friendly')]);
  const r=[character('PC','pc',4,4),character('Mason','monster',5,4),character('Mason2','monster',5,5),character('Pilgrim','monster',4,5)];
  assert.deepEqual(I.teams(r,p,createCombatSpace(d,r,d.geoKey),'attack Mason2').hostiles.map(a=>a.name),['Mason2']);
  assert.equal(p.actors.Mason.allegiance,'Neutral');
  assert.deepEqual(I.teams(r,p,createCombatSpace(d,r,d.geoKey),'attack Pilgrim').hostiles.map(a=>a.name),['Pilgrim']);
  assert.equal(p.actors.Pilgrim.allegiance,'Hostile');
  assert.equal(p.actors.Mason.allegiance,'Neutral');
});
test('dead and recruited encounters stay exhausted across JSON persistence and placement', () => {
  const p=I.createPopulation('1,0,0',[descriptor('Guard'),descriptor('Pilgrim','Friendly')]);
  I.sync(p,[{name:'Guard',hp:0}],[{name:'Pilgrim'}]);
  const saved=JSON.parse(JSON.stringify(p)); I.place(saved,dungeon());
  assert.ok(saved.groups.every(g=>g.status==='exhausted'));
  assert.equal(saved.actors.Pilgrim.status,'recruited');
});
test('a named distant target never silently switches the PC to a different nearby encounter', () => {
  const d=dungeon(), p=I.createPopulation(d.geoKey,[descriptor('Near'),descriptor('Far')]);
  const r=[character('PC','pc',4,4),character('Near','monster',5,4),character('Far','monster',40,40)];
  assert.deepEqual(I.teams(r,p,createCombatSpace(d,r,d.geoKey),'attack Far').hostiles,[]);
});
test('a remote neutral cannot be provoked through walls or across the level by an unrealized attack',()=>{
  const d=dungeon(),p=I.createPopulation(d.geoKey,[descriptor('Mason','Neutral')]);
  const pc=character('PC','pc',4,4),mason=character('Mason','monster',25,4),roster=[pc,mason];
  assert.deepEqual(I.teams(roster,p,createCombatSpace(d,roster,d.geoKey),'attack Mason').hostiles,[]);
  assert.equal(p.actors.Mason.allegiance,'Neutral');
  mason.mazeX=6;d.cells['5,4'].tile='wall';
  assert.deepEqual(I.teams(roster,p,createCombatSpace(d,roster,d.geoKey),'attack Mason').hostiles,[]);
  assert.equal(p.actors.Mason.allegiance,'Neutral');
});
test('a dead PC cannot trigger a new whole-level hostile round',()=>{
  const d=dungeon(),p=I.createPopulation(d.geoKey,[descriptor('Guard'),descriptor('Far Guard')]);
  const roster=[{...character('PC','pc',4,4),hp:0},character('Guard','monster',5,4),character('Far Guard','monster',25,4)];
  assert.deepEqual(I.teams(roster,p,createCombatSpace(d,roster,d.geoKey)).hostiles,[]);
});
test('arch passages are walkable for encounter placement, perception and combat pursuit', () => {
  const d=dungeon(16);
  for(let x=1;x<15;x++) d.cells[`${x},7`].tile='wall';
  d.tiles={custom_arch:{spriteSpec:{voxelShape:'arch',baseWidth:1,heightRatio:1}}};
  d.cells['7,7']={tile:'custom_arch',floorHeight:0,ceilHeight:6,structureHeight:6};
  assert.ok(I.walkable(d,7,7));
  assert.ok(I.reachable(d).some(t=>t.y===10));
  assert.ok(I.lineClear(d,{x:7.5,y:5.5},{x:7.5,y:9.5}));
  assert.equal(I.canTraverse(d,{x:6,y:7},{x:7,y:7}),false);
  const r=[character('PC','pc',7,5),character('Guard','monster',7,9)],space=createCombatSpace(d,r,d.geoKey);
  assert.ok(space.pursuitPath(r[0],r[1]).some(p=>p.x===7&&p.y===7));
});
test('the actual player position beside a column remains valid for perception and combat pursuit',()=>{
  const d=dungeon(16);d.tiles={custom_column:{spriteSpec:{voxelShape:'doric_column',baseWidth:0.6,heightRatio:1}}};
  d.cells['4,4']={tile:'custom_column',floorHeight:0,ceilHeight:6,structureHeight:6};
  assert.equal(I.walkable(d,4,4),false);assert.ok(I.pointWalkable(d,4.95,4.5));
  assert.equal(I.pointWalkable(d,4.5,4.5),false);
  const pc={...character('PC','pc',4,4),mazePoint:{x:4.95,y:4.5}},guard=character('Guard','monster',7,4);
  const space=createCombatSpace(d,[pc,guard],d.geoKey);
  assert.equal(space.point(pc).x,4.95);const steps=space.pursuitPath(pc,guard);assert.ok(steps.length);
  for(const step of steps)space.move(pc,step);
  assert.ok(space.canAttack(pc,guard));
});
test('dialogue accepts exact existing speakers, strips machine tags, and excludes invented speakers', () => {
  const result=I.extractDialogue('A mason speaks. [[CHARACTER_DIALOGUE]][{"speaker":"Mason","line":"Hello."},{"speaker":"Hades","line":"Victory!"}][[/CHARACTER_DIALOGUE]]',['Mason']);
  assert.equal(result.content,'A mason speaks.'); assert.deepEqual(result.dialogue,[{speaker:'Mason',line:'Hello.'}]);
  assert.equal(I.extractDialogue('Story [[CHARACTER_DIALOGUE]]broken',['Mason']).content,'Story');
});
test('new indoor arrivals can occasionally meet one small coherent group, never a spawn mob',()=>{
  let meetings=0;
  for(let seed=0;seed<16;seed++){
    const d=dungeon(64);d._geometryStamp=`arrival-${seed}`;
    const p=I.createPopulation(d.geoKey,[descriptor('Mason','Neutral','workers'),descriptor('Mason2','Neutral','workers'),
      descriptor('Guard','Hostile','guards'),descriptor('Guard2','Hostile','guards'),descriptor('Pilgrim','Friendly','pilgrim')]);
    I.place(p,d);
    const close=Object.values(p.actors).filter(a=>a.position&&Math.hypot(a.position.x-d.start.x,a.position.y-d.start.y)<=8);
    if(close.length)meetings++;
    assert.ok(close.length<=3);assert.ok(new Set(close.map(a=>a.encounterId)).size<=1);
  }
  assert.ok(meetings>0&&meetings<16,'Arrival meetings vary with the new geometry seed.');
});

test('a seeded quest contact is neutral, conversationally close and persistent, not a room-wide welcoming mob', () => {
  for (const indoor of [true, false]) {
    const d = dungeon(indoor ? 64 : 160), p = I.createPopulation(d.geoKey, [descriptor('Guide', 'Neutral', 'contact'),
      descriptor('Raider', 'Hostile', 'guards'), descriptor('Raider 2', 'Hostile', 'guards'), descriptor('Far Mason', 'Neutral', 'workers')], { indoor });
    p.questIntroduction = { questId: 'quest-1', speaker: 'Guide', status: 'pending' };
    I.place(p, d);
    const guide = p.actors.Guide;
    assert.ok(I.dialogueReach(d, { ...guide, type: 'monster', hp: 10, mazeRoomKey: d.geoKey,
      mazeX: guide.position.x, mazeY: guide.position.y }, { x: d.start.x + .5, y: d.start.y + .5 }).canSpeak);
    assert.ok(Object.values(p.actors).filter(a => a.allegiance === 'Hostile').every(a =>
      Math.hypot(a.position.x - d.start.x, a.position.y - d.start.y) > 8));
    guide.encounteredAt = Date.now();
    I.noteSpoken(p, [{ speaker: 'Guide', line: 'Keep clear of my work.' }], true);
    assert.equal(p.questIntroduction.status, 'introduced');
    const saved = JSON.parse(JSON.stringify(p)), before = JSON.stringify(saved); I.place(saved, d);
    assert.equal(JSON.stringify(saved), before);
  }
});

test('small hostile encounters may occasionally guard arrivals, and confrontations remain local', () => {
  let near = 0, quiet = 0;
  for (let seed = 0; seed < 20; seed++) {
    const d = dungeon(); d._geometryStamp = `hostile-arrival-${seed}`;
    const p = I.createPopulation(d.geoKey, [descriptor('Guard', 'Hostile', 'guards'), descriptor('Guard 2', 'Hostile', 'guards')]);
    I.place(p, d);
    const close = Object.values(p.actors).filter(a => Math.hypot(a.position.x - d.start.x, a.position.y - d.start.y) <= 3);
    if (close.length) near++; else quiet++;
    assert.ok(close.length <= 2);
  }
  assert.ok(near > 0 && quiet > 0);
});

test('a quest introduction is claimed once outside the starting temple, not on every active-quest room entry', () => {
  const quest = 'Recover the forgotten seal before facing the Wyrm.';
  assert.equal(needsQuestIntroduction(quest, {}, '0,0,0'), false);
  assert.equal(needsQuestIntroduction('', {}, '1,0,0'), false);
  assert.equal(needsQuestIntroduction('None', {}, '1,0,0'), false);
  assert.equal(needsQuestIntroduction(quest, {}, '1,0,0'), true);
  const saved = { '1,0,0': { inhabitants: { questIntroduction: { questId: String(I.hash(quest)), speaker: 'Guide', status: 'pending' } } } };
  assert.equal(needsQuestIntroduction(quest, saved, '2,0,0'), false);
  assert.equal(needsQuestIntroduction(quest, {}, '2,0,0', 1), false);
  assert.equal(needsQuestIntroduction('A new quest after the Wyrm.', saved, '2,0,0'), true);
});

test('cast generation reserves one neutral quest contact only for an explicit introduction', async () => {
  const prompts = [], agent = { user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); },
    assistant: { generation: async options => ({ content: JSON.stringify({ inhabitants: batchRows(inhabitantReply(16), options) }) }) } };
  const rules = { level: () => 1, random: () => 5, sex: () => 'Female', xp: () => 0, equipment: async () => null };
  const context = { roomName: 'Ash Crossing', roomDescription: 'An open trail.', geoKey: '1,0,0', indoor: false,
    quest: 'Find the seal before entering the Wyrm lair.' };
  const seeded = await generateInhabitants(agent, { ...context, questSeed: true }, rules);
  const guide = seeded.population.actors[seeded.population.questIntroduction.speaker];
  assert.equal(guide.allegiance, 'Neutral');
  assert.equal(seeded.population.groups.find(g => g.members.includes(guide.name)).members.length, 1);
  assert.match(prompts[0], /single NEUTRAL or FRIENDLY quest contact/);
  assert.match(prompts[0], /trash talk/);
  const ordinary = await generateInhabitants(agent, context, rules);
  assert.equal(ordinary.population.questIntroduction, undefined);
});

test('the LLM picks individual custom native archetypes and spell preferences, but the engine supplies birth stats', async () => {
  const Rules = require('../assets/spellRules'), prompts = [], rolls = [];
  const rows = [
    { slot: 0, name: 'Keeper One', race: 'Elf', class: 'Vow Reader', combatArchetype: 'Cleric', spellPreferences: ['prayer_mending', 'fireball'], magic: 999 },
    { slot: 1, name: 'Keeper Two', race: 'Human', class: 'Sun Seer', combatArchetype: 'Sorcerer', spellPreferences: ['dawn_mending'] },
    { slot: 2, name: 'Keeper Three', race: 'Human', class: 'Warrior Priest', combatRole: 'Warrior', combatArchetype: 'Cleric', spellPreferences: ['prayer_mending'] },
    { slot: 3, name: 'Keeper Four', race: 'Human', class: 'Ash Ritualist', combatArchetype: 'Witch', spellPreferences: ['curse', 'invented', 'curse'] }
  ];
  const agent = { user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); }, assistant: { generation: async options => ({ content: JSON.stringify({ inhabitants: batchRows(inhabitantReply(8, rows), options) }) }) } };
  const result = await generateInhabitants(agent, { roomName: 'Market', geoKey: '1,0,0', indoor: true },
    { level: () => 3, random: (min, max) => { rolls.push(max); return min; }, sex: () => 'Female', xp: () => 6000, equipment: async () => null });
  const actors = I.parseBlocks(result.sheets);
  for (const [name, archetype, magic, die] of [['Keeper One', 'Cleric', 6, 8], ['Keeper Two', 'Sorcerer', 9, 4], ['Keeper Three', 'Fighter', 0, 10], ['Keeper Four', 'Witch', 6, 6]]) {
    const actor = actors.find(a => a.name === name);
    assert.equal(actor.magic, magic); assert.equal(Rules.resolveClass(actor.className), archetype);
    assert.equal(result.population.actors[name].combatArchetype, archetype); assert.equal(actor.hp, 3);
    assert.equal(result.population.actors[name].combatRole, archetype === 'Fighter' ? 'Warrior' : 'Spellcaster');
    assert.ok(rolls.includes(die + 1));
  }
  assert.deepEqual(result.population.actors['Keeper One'].spellPreferences, ['prayer_mending']);
  assert.deepEqual(result.population.actors['Keeper Three'].spellPreferences, []);
  assert.deepEqual(result.population.actors['Keeper Four'].spellPreferences, ['curse']);
  assert.match(prompts[0], /choose exactly one combatArchetype/); assert.match(prompts[0], /Choose spellPreferences individually/);
});

for(const indoor of [true,false]) test(`batched ${indoor?'indoor':'outdoor'} generation creates diverse groups using bounded cast requests`,async()=>{
  const prompts=[],requests=[],agent={user(parts,...values){prompts.push(String.raw({raw:parts},...values));},assistant:{generation:async options=>{requests.push(options);return {content:JSON.stringify({inhabitants:batchRows(inhabitantReply(indoor?8:16),options)})}}}};
  const result=await generateInhabitants(agent,{roomName:'Grave Market',roomDescription:'A vaulted market.',geoKey:'1,0,0',indoor,partyNames:['Mortacia']},
    {level:()=>2,random:()=>5,sex:()=> 'Female',xp:()=>2000,equipment:async()=>null});
  assert.equal(requests.length,indoor?2:4);assert.deepEqual(requests.flatMap(slotIds),Array.from({length:indoor?8:16},(_,slot)=>slot));
  assert.ok(requests.every(request=>request.parameters.inhabitants.minItems===4&&request.parameters.inhabitants.maxItems===4));
  assert.equal(I.parseSheets(`Monsters in Room:\n${result.sheets}\nMonsters Equipped Properties: None`).length,indoor?8:16);
  const states=Object.values(result.population.actors).map(a=>a.allegiance);
  assert.ok(states.includes('Hostile')&&states.includes('Friendly')&&states.includes('Neutral'));
  assert.ok(prompts[0].includes('not a fixed list of trades'));
  assert.ok(prompts.some(p=>p.includes('ROOM-SPECIFIC SCENARIO VARIETY')));
  assert.ok(!prompts[0].includes('ferrymen, grave masons, mourners'));
});

test('discovery requires local line of sight and only plays an introduction once; pause/stale games reject it',()=>{
  const d=dungeon(), map=new Map(), p=I.createPopulation(d.geoKey,[descriptor('Mason','Neutral')]);
  p.groups[0].site={x:6,y:4};p.actors.Mason.position={x:6,y:4};p.actors.Mason.home={x:6,y:4};map.set(d.geoKey,p);
  let roster=JSON.stringify([character('PC','pc',4,4),character('Mason','monster',6,4)]),db='{}',paused=false;
  const state={getDungeonRunId:()=> 'run',getLastCoords:()=>({x:1,y:0,z:0}),getGamePaused:()=>paused,getRoomDungeon:()=>d,
    getRoomPopulation:k=>map.get(k),setRoomPopulation:(k,v)=>map.set(k,v),getUpdatedGameConsole:()=>consoleText(['Mason']),
    getRoomNameDatabase:()=>db,setRoomNameDatabase:v=>db=v,getCombatCharactersString:()=>roster,setCombatCharactersString:v=>roster=v};
  const service=createPopulationService(state), body={geoKey:d.geoKey,runId:'run',player:{x:4.5,y:4.5}};
  d.cells['5,4'].tile='wall';assert.equal(service.visit(body).dialogue.length,0);
  d.cells['5,4'].tile='floor';assert.equal(service.visit(body).dialogue.length,1);assert.equal(service.visit(body).dialogue.length,0);
  assert.equal(service.visit({...body,runId:'old'}).status,409);paused=true;assert.equal(service.visit(body).status,409);
  assert.equal(JSON.parse(db)[d.geoKey].inhabitants.groups[0].introPlayed,true);
});

test('pause suspends a player roll deadline and resumes it without rolling automatically',async()=>{
  const dice=new ActionDice({timeoutMs:50,animationMs:0,random:()=>12});dice.begin('combat','1,0,0');
  const result=dice.roll({actor:'PC',player:true,label:'Attack'});await new Promise(r=>setImmediate(r));
  const request={...dice.pending.request};dice.setPaused(true);
  await new Promise(r=>setTimeout(r,80));assert.ok(dice.pending);assert.equal(dice.pending.request.expiresAt,null);
  assert.throws(()=>dice.submit(request.id,request.actionId,request.geoKey),/Resume/);
  dice.setPaused(false);assert.equal(dice.submit(request.id,request.actionId,request.geoKey).natural,12);
  assert.equal((await result).natural,12);dice.end();
});
test('pausing target selection stops its deadline and ignores responses until resume',async()=>{
  const helper=source.slice(source.indexOf('async function chooseDefenceTarget('),source.indexOf('function selectCombatTeams('));
  const emitter=new(require('node:events').EventEmitter)();let now=1000,tick,cleared=false;
  const actionDice={active:{id:'round'},paused:false};
  const context={sharedState:{emitter},actionDice,combatSpace:null,combatTurnFlow:null,broadcast(){},Date:{now:()=>now},
    setInterval:fn=>{tick=fn;return{};},clearInterval:()=>cleared=true};
  vm.runInNewContext(helper,context);
  let resolved=false;const waiting=context.chooseDefenceTarget({name:'PC',x:1,y:1},[{name:'Guard',hp:20,x:2,y:1}]).then(v=>{resolved=true;return v;});
  actionDice.paused=true;now+=240000;tick();emitter.emit('target_response_PC',{actionId:'round',target:'Guard'});
  await Promise.resolve();assert.equal(resolved,false);
  actionDice.paused=false;now++;tick();emitter.emit('target_response_PC',{actionId:'old',target:'Guard'});
  await Promise.resolve();assert.equal(resolved,false);
  emitter.emit('target_response_PC',{actionId:'round',target:'guard'});
  assert.equal((await waiting).name,'Guard');assert.ok(cleared);assert.equal(emitter.listenerCount('target_response_PC'),0);
});

const source=fs.readFileSync(require('node:path').join(__dirname,'../retort/retortWithUserInput.js'),'utf8').replace(/\r\n/g,'\n');
for(const local of [true,false])test(`ordinary monster dialogue uses ${local?'one local':'no distant'} attack-decision request, not a request per room inhabitant`,async()=>{
  const start=source.indexOf('// Handle Monsters in Room'),end=source.indexOf('let response = "";',start);
  let block=source.slice(start,end);block=block.slice(0,block.lastIndexOf('\n}'));
  const requests=[],prompts=[],names=Array.from({length:20},(_,i)=>`Guard ${i}`);
  const context={monstersInRoom:'A populated room.',roomName:'Chapel',roomDescription:'A great vaulted nave.',
    updatedGameConsole:'Monsters State: Mixed\nRooms Visited: 1',extractNames:()=>names,nearbyHostileNames:()=>local?names.slice(0,3):[],attackDecision:'',
    console:{log(){},error(){}},$:{user:(parts,...values)=>prompts.push(String.raw({raw:parts},...values)),
      assistant:{generation:async options=>{requests.push(options);return{content:JSON.stringify({attack_decision:"Doesn't Attack Yet"})};}}}};
  await vm.runInNewContext(`(async()=>{${block}})()`,context);
  assert.equal(requests.length,local?1:0);
  assert.equal(prompts.filter(p=>p.includes('A great vaulted nave.')).length,local?1:0);
  if(local)assert.equal(requests[0].maxTokens,40);
});
const combat=source.slice(source.indexOf('let combatSpace = null;'),source.indexOf('// Global variable to hold the current situation'));
for(const mode of ['Combat Map-Based','Interactive Map-Based','No Combat Map']) test(`${mode}: actual rounds preserve neutral/distant residents and friendly monsters attack enemies`,async()=>{
  const d=dungeon(),p=I.createPopulation(d.geoKey,[descriptor('Guard','Hostile','guards'),descriptor('Guard2','Hostile','guards'),descriptor('Far','Hostile'),descriptor('Mason','Neutral'),descriptor('Pilgrim','Friendly')]);
  const roster=[character('PC','pc',4,4),character('Companion','npc',3,4),character('Guard','monster',6,4),
    character('Guard2','monster',7,5),character('Far','monster',40,40),character('Mason','monster',4,5),character('Pilgrim','monster',4,6)];
  let wire=JSON.stringify(roster),text=buildInitialGameConsole(buildInitialWorldConsole().console,{Name:'PC',Sex:'Female',Race:'Human',Class:'Fighter',Level:1,AC:10,HP:100,MaxHP:100,Attack:1,Damage:1},[])
    .replace('Coordinates: X: 0, Y: 0, Z: 0','Coordinates: X: 1, Y: 0, Z: 0').replace('NPCs in Party: None',`NPCs in Party:\n${sheet('Companion')}`)
    .replace('Monsters in Room: None',`Monsters in Room:\n${['Guard','Guard2','Far','Mason','Pilgrim'].map(n=>sheet(n)).join('\n')}`)
    .replace('Monsters State: None','Monsters State: Mixed');
  const emitter=new(require('node:events').EventEmitter)(),dice=new ActionDice({animationMs:0,random:s=>s}),events=[];
  const state={emitter,getLastCoords:()=>({x:1,y:0,z:0}),getRoomDungeon:()=>d,getUpdatedGameConsole:()=>text,
    getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,setUpdatedGameConsole:v=>text=v,
    getRoomPopulation:()=>p,getDungeonRunId:()=> 'run'};
  const context={Inhabitants:I,createCombatSpace,actionDice:dice,sharedState:state,populationService:{get:()=>p,recordPositions(){},save(){}},
    console:{log(){},info(){},warn(){},error(){}},updatedGameConsole:text,roll1d20:()=>10,characterClasses:[{name:'Fighter',baseHP:10}],
    ensureSelectedPCSprite(){},allocateXP(){},dropMonsterItemsToRoom(){},getRandomInt:()=>1000,updateCombatMap(){},
    getDelayedUpdatedGameConsole:async()=>text,setTimeout:(fn,ms)=>setTimeout(fn,ms===200?0:ms),clearTimeout,setInterval,clearInterval,
    broadcast:event=>{events.push(event);if(event.type==='dice_state'&&event.pending)setImmediate(()=>dice.submit(event.pending.id,event.pending.actionId,event.pending.geoKey));
      if(event.type==='target_prompt')setImmediate(()=>emitter.emit(`target_response_${event.combatant}`,{actionId:event.actionId,target:'Guard'}));}};
  vm.runInNewContext(combat,context);const result=await context.handleCombatRound({},'attack Guard',mode);
  assert.doesNotMatch(result.combatLog,/Far targets|Mason targets|Pilgrim targets PC|Companion targets Pilgrim/);
  assert.match(result.combatLog,/Pilgrim (targets|rolls)/);
  assert.ok(dice.snapshot().results.every(r=>!['Far','Mason'].includes(r.actor)));
  assert.equal(JSON.parse(wire).find(a=>a.name==='Mason').hp,100);assert.equal(JSON.parse(wire).find(a=>a.name==='Far').hp,100);
});
const fullRetort = source.slice(source.indexOf('async function retortWithUserInput('), source.indexOf('// Focused, lightweight Retort helper'));
test('quest cast seeding uses its target room without changing the current console or starting party',async()=>{
  const helper=source.slice(source.indexOf('async function generateMonstersBlockIsolated('),source.indexOf('async function generateMonstersForRoomUsingGPT('));
  const original=consoleText(['Starting Friend']).replace('X: 1, Y: 0, Z: 0','X: 0, Y: 0, Z: 0');
  const context={Inhabitants:I,updatedGameConsole:original,generateMonstersForRoomUsingGPT:async()=>{
    assert.match(context.updatedGameConsole,/^Coordinates: X: 2, Y: -1, Z: 0$/m);
    context.updatedGameConsole=context.updatedGameConsole.replace('Monsters in Room: None',`Monsters in Room:\n${sheet('Bound Guard')}`);
  }};
  vm.runInNewContext(helper,context);
  const result=await context.generateMonstersBlockIsolated({},'Crypt','A crypt.','2,-1,0');
  assert.deepEqual(I.parseSheets(result).map(a=>a.name),['Bound Guard']);assert.equal(context.updatedGameConsole,original);
});
test('first-time construction reuses a quest-seeded cast without rerolling names, roles, stats or equipment',async()=>{
  const helper=source.slice(source.indexOf('async function generateRoomInhabitantPopulation('),source.indexOf('async function generateRoomObjects('));
  const p=I.createPopulation('2,0,0',[descriptor('Bound Guard'),descriptor('Mason','Neutral')]);
  p.initialSheets=sheet('Bound Guard',40)+'\n'+sheet('Mason',30);p.initialEquipmentProperties='{name: "guard blade", type: "weapon", damage_modifier: 2}';
  const text=consoleText([]).replace('X: 1, Y: 0, Z: 0','X: 2, Y: 0, Z: 0').replace('Monsters in Room:\n\n','Monsters in Room: None\n');
  let saves=0;
  const context={Inhabitants:I,updatedGameConsole:text,extractCharactersAndNpcs:()=>({characters:[{Name:'PC',Level:1}],npcs:[]}),
    sharedState:{getRoomPopulation:()=>p,getRoomNameDatabase:()=>JSON.stringify({'2,0,0':{inhabitants:p}})},
    populationService:{save:()=>saves++},generateInhabitants:()=>{throw Error('Must reuse the bound cast.');},console:{info(){}}};
  vm.runInNewContext(helper,context);await context.generateRoomInhabitantPopulation({},'Crypt','A crypt.','2,0,0');
  assert.deepEqual(I.parseSheets(context.updatedGameConsole).map(a=>[a.name,a.hp]),[['Bound Guard',40],['Mason',30]]);
  assert.match(context.updatedGameConsole,/guard blade/);assert.equal(saves,1);assert.equal(p.actors.Mason.allegiance,'Neutral');
  const previous=context.updatedGameConsole;await context.generateRoomInhabitantPopulation({},'Crypt','A crypt.','2,0,0');
  assert.equal(context.updatedGameConsole,previous);assert.equal(saves,1);
});
for(const mode of ['Combat Map-Based','Interactive Map-Based','No Combat Map']) test(`${mode}: a discovered encounter runs the original round without LLM or generation calls`, async()=>{
  const d=dungeon(),p=I.createPopulation(d.geoKey,[descriptor('Guard'),descriptor('Mason','Neutral')]);
  let text=buildInitialGameConsole(buildInitialWorldConsole().console,{Name:'PC',Sex:'Female',Race:'Human',Class:'Fighter',Level:1,AC:10,HP:100,MaxHP:100,Attack:1,Damage:1},[])
    .replace('Coordinates: X: 0, Y: 0, Z: 0','Coordinates: X: 1, Y: 0, Z: 0')
    .replace('Monsters in Room: None',`Monsters in Room:\n${sheet('Guard')}\n${sheet('Mason')}`).replace('Monsters State: None','Monsters State: Mixed');
  let wire=JSON.stringify([character('PC','pc',4,4),character('Guard','monster',6,4),character('Mason','monster',5,5)]);
  const emitter=new(require('node:events').EventEmitter)(),events=[],dice=new ActionDice({animationMs:0,random:s=>s});
  const s={emitter,getGamePaused:()=>false,getDungeonTestingMode:()=>false,getLiveWorldState:()=>null,getLastCoords:()=>({x:1,y:0,z:0}),
    getRoomDungeon:()=>d,getUpdatedGameConsole:()=>text,setUpdatedGameConsole:v=>text=v,
    getCombatCharactersString:()=>wire,setCombatCharactersString:v=>wire=v,getRoomPopulation:()=>p,getRoomNameDatabase:()=> '{}',getDungeonRunId:()=> 'run'};
  const fail=()=>{throw Error('Realtime combat must not call an LLM or regenerate a room.');};
  const context={require:require('node:module').createRequire(require.resolve('../retort/retortWithUserInput')),Inhabitants:I,MonsterConsoleSync:require('../retort/monsterConsoleSync'),createCombatSpace,actionDice:dice,sharedState:s,populationService:{get:()=>p,recordPositions(){},save(){}},
    console:{log(){},info(){},warn(){},error(){}},roll1d20:()=>10,characterClasses:[{name:'Fighter',baseHP:10}],
    ensureSelectedPCSprite(){},getDelayedPersonalNarrative:fail,getDelayedUpdatedGameConsole:async()=>text,getDelayedRoomNameDatabase:async()=> '{}',
    sanitizeLiveWorldStateForPrompt:()=>null,retort:fail,run:fail,setTimeout:(fn,ms)=>setTimeout(fn,ms===200?0:ms),clearTimeout,setInterval,clearInterval};
  vm.runInNewContext(fullRetort,context);
  const broadcast=event=>{events.push(event);
    if(event.type==='target_prompt')setImmediate(()=>emitter.emit(`target_response_${event.combatant}`,{actionId:event.actionId,target:'Guard'}));
    if(event.type==='dice_state'&&event.pending)setImmediate(()=>dice.submit(event.pending.id,event.pending.actionId,event.pending.geoKey));};
  const result=await context.retortWithUserInput('',broadcast,mode,{realtimeEncounter:'Guard'});
  assert.ok(result.combatRoundOnly);
  assert.equal(result.updatedGameConsole,text);
  assert.equal(I.parseSheets(text).find(a=>a.name==='Mason').hp,100);
  assert.ok(events.some(e=>e.type==='target_prompt'&&e.combatant==='PC'));
  assert.ok(events.some(e=>e.type==='dice_state'&&e.pending?.label==='Attack'));
  assert.match(result.content,/Guard confronts the party/);
  const after = JSON.parse(wire), pc = after.find(a => a.type === 'pc'), guard = after.find(a => a.name === 'Guard');
  assert.ok(guard.hp > 0);
  Object.assign(pc, { mazeX: 4, mazeY: 4 }); delete pc.mazePoint;
  Object.assign(guard, { mazeX: 6, mazeY: 4 }); delete guard.mazePoint;
  d.tiles = { custom_column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: .6, heightRatio: 1 } } };
  d.cells['5,4'] = { tile: 'custom_column', floorHeight: 0, ceilHeight: 6, structureHeight: 6 };
  wire = JSON.stringify(after); events.length = 0;
  const continued = await context.retortWithUserInput('', broadcast, mode, { realtimeEncounter: 'Guard' });
  assert.ok(continued.combatRoundOnly);
  assert.doesNotMatch(continued.content, /There are no hostile opponents/);
  assert.ok(events.some(e => e.type === 'target_prompt' && e.combatant === 'PC'));
  assert.equal(I.parseSheets(text).find(a => a.name === 'Mason').hp, 100);
});
