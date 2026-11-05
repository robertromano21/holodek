'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../retort/spellSystem'), C = require('../retort/classMagic'), Q = require('../retort/questProgress');
const I = require('../assets/dungeonInhabitants'), Inventory = require('../assets/inventoryUi');
const { formatStartingCharacterSheet: sheet } = require('../retort/initialGameState');
const R = S.Rules;
function fixture(options = {}) {
  const item = { name: 'ashblade', type: 'weapon', attack_modifier: 2, damage_modifier: 1, ac: 1, magic: 1, ...options.item };
  const d = { geoKey: '1,0,0', layout: { width: 16, height: 16 }, cells: {} };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.cells[`${x},${y}`] = { tile: 'floor' };
  const actor = (name, extra = {}, type = 'pc') => sheet({ Name: name, Sex: 'Female', Race: 'Human', Class: 'Fighter', Level: 1,
    HP: 100, MaxHP: 100, AC: 10, Attack: 4, Damage: 2, Armor: 1, Magic: 0, ...extra }, 6, type);
  const className = options.className || 'Fighter', classMagic = R.classes[className]?.startingMagic ?? R.classes[className]?.pointsPerLevel ?? 0;
  let text = `Coordinates: X: 1, Y: 0, Z: 0\nInventory: ${options.inventory?.map(p => p.name).join(', ') || 'Empty'}\nInventory Properties: ${options.inventory?.map(p => JSON.stringify(p)).join(', ') || 'None'}\nPC:\n${actor('PC', { Class: className, Level: options.level || 1, Magic: classMagic + item.magic, Equipped: { Weapon: item.name } })}\nNPCs in Party:\n${actor('Ally', { HP: 50 }, 'npc')}\nMonsters in Room:\n${actor('Enemy', { Equipped: options.monsterItem ? { Other: options.monsterItem.name } : {}, Magic: options.monsterItem?.magic || 0 }, 'npc').replace('State: Friendly', 'State: Hostile')}\nMonsters Equipped Properties: ${options.monsterItem ? JSON.stringify({ ...options.monsterItem, owner: 'Enemy', slot: 'Other' }) : 'None'}\nMonsters State: Hostile\nParty Equipped Properties: ${JSON.stringify({ ...item, owner: 'PC', slot: 'Weapon' })}`;
  let database = JSON.stringify({ '0,0,0': { name: 'Entrance' }, '1,0,0': { name: 'Ash Hall', indoor: true, objects: [item] }, '2,0,0': { name: 'Boss Hall', bossGate: { status: 'locked', quest: 'Main Quest' } } });
  let roster = JSON.stringify([['PC', 'pc', 2, 2], ['Ally', 'npc', 2, 3], ['Enemy', 'monster', options.enemyX ?? (options.className ? 8 : 4), 2]].map(([name, type, mazeX, mazeY]) => ({ name, type, mazeX, mazeY, mazeRoomKey: d.geoKey, hp: 100 })));
  let tasks = [], paused = false;
  const state = { getDungeonRunId: () => 'run', getUpdatedGameConsole: () => text, setUpdatedGameConsole: v => text = v,
    getRoomNameDatabase: () => database, setRoomNameDatabase: v => database = v,
    getCombatCharactersString: () => roster, setCombatCharactersString: v => roster = v,
    getLastCoords: () => ({ x: 1, y: 0, z: 0 }), getRoomDungeonForSimulation: () => d,
    getGamePaused: () => paused, setGamePaused: v => paused = v, getCurrentTasks: () => tasks, setCurrentTasks: v => tasks = v,
    getCurrentTaskIndex: () => 0, getCurrentQuest: () => 'Main Quest' };
  const pool = () => JSON.parse(database)['0,0,0'].spellSystem;
  if (options.blankBook) {
    // Isolate scroll-learning regressions from the separate starter-formula grant.
    S.synchronize(state);
    const db = JSON.parse(database), c = db['0,0,0'].spellSystem.casters.PC;
    c.known = []; c.prepared = []; c.learned = {}; database = JSON.stringify(db);
  }
  const input = (spell = 'missile', target = 'Enemy', caster = 'PC') => {
    const v = S.view(state, caster, { monster: caster === 'Enemy' }), entry = v.casters[0].items.find(i => i.spells.some(s => s.id === spell));
    return { runId: 'run', geoKey: d.geoKey, revision: v.revision, caster, itemId: entry?.id, spellId: spell, target, nonce: require('node:crypto').randomUUID() };
  };
  return { state, item, d, input, pool, actor: name => S.allActors(text).find(a => a.name === name) };
}

const Casting = require('../retort/combatCasting'), Life = require('../retort/combatLife');

test('instant healing wakes an unconscious ally during combat and spends Magic once', () => {
  const f=fixture({item:{magic:3,type:'armor'}}); S.synchronize(f.state); Life.beginCombat(f.state); Casting.beginRound(f.state);
  const db=JSON.parse(f.state.getRoomNameDatabase());
  Life.apply(db,'run',f.actor('Ally'),0,20,{geoKey:'1,0,0',damage:50}); Life.commit(f.state,db);
  const input=f.input('mend','Ally'), before=f.pool().items[input.itemId].remaining;
  assert.equal(Casting.prepare(f.state,input,{combat:true}),null);
  const result=S.cast(f.state,null,input,{combat:true,random:()=>4});
  assert.equal(result.error,undefined); assert.ok(f.actor('Ally').hp>0);
  assert.equal(f.pool().items[input.itemId].remaining,before-1);
});

test('slower spells wait multiple rounds and release one committed spell with current resource revision', () => {
  const f=fixture({item:{magic:6}}); S.synchronize(f.state); Casting.beginRound(f.state);
  const input=f.input('fireball');
  assert.match(Casting.prepare(f.state,input,{combat:true}),/2 rounds/);
  assert.ok(Casting.take(f.state,f.actor('PC')).waiting);
  Casting.beginRound(f.state); assert.ok(Casting.take(f.state,f.actor('PC')).waiting);
  Casting.beginRound(f.state); const ready=Casting.take(f.state,f.actor('PC')).choice;
  assert.equal(ready.spellId,'fireball');
  const cast=S.cast(f.state,null,ready,{combat:true,continuing:true,random:sides=>sides});
  assert.equal(cast.error,undefined); assert.equal(cast.spell,'Fireball');
  const left=f.pool().items[input.itemId].remaining;
  assert.equal(S.cast(f.state,null,ready,{combat:true,continuing:true}).duplicate,true);
  assert.equal(f.pool().items[input.itemId].remaining,left);
  assert.equal(Casting.take(f.state,f.actor('PC')),null);
});

test('damage interrupts a pending spell, consumes its source Magic, and prevents casting until next round', () => {
  for(const item of [{magic:6},{magic:3},{magic:3,type:'artifact'}]) {
    const f=fixture({item}); S.synchronize(f.state); Casting.beginRound(f.state);
    const input=f.input('fireball'), before=f.pool().items[input.itemId].remaining;
    Casting.prepare(f.state,input,{combat:true});
    const db=JSON.parse(f.state.getRoomNameDatabase()); Life.apply(db,'run',f.actor('PC'),99,null,{geoKey:'1,0,0',damage:1}); Life.commit(f.state,db);
    assert.equal(Casting.status(f.state,f.actor('PC')).pending,undefined);
    assert.equal(f.pool().items[input.itemId].remaining,before-3);
    assert.throws(()=>S.rollPlan(f.state,input,{combat:true}),/rest of this round/);
    Life.commit(f.state,JSON.parse(f.state.getRoomNameDatabase())); assert.equal(f.pool().items[input.itemId].remaining,before-3);
    if(item.magic===3) assert.equal(f.pool().items[input.itemId].status,item.type==='artifact'?'recharging':'ash');
    Casting.beginRound(f.state); assert.equal(Casting.status(f.state,f.actor('PC')).blocked,false);
  }
});

test('a recent hit blocks even instant spells this round without consuming Magic, and next round permits them', () => {
  const f=fixture({item:{magic:1}}); S.synchronize(f.state); Casting.beginRound(f.state); const input=f.input();
  const db=JSON.parse(f.state.getRoomNameDatabase()); Life.apply(db,'run',f.actor('PC'),99,null,{geoKey:'1,0,0',damage:1}); Life.commit(f.state,db);
  assert.throws(()=>Casting.prepare(f.state,input,{combat:true}),/rest of this round/);
  assert.equal(f.pool().items[input.itemId].remaining,1);
  Casting.beginRound(f.state); assert.equal(Casting.prepare(f.state,f.input(),{combat:true}),null);
});

test('autonomous monsters and NPCs select affordable useful spells, heal allies and avoid friendly fire', () => {
  const f=fixture({enemyX:3,item:{magic:6,type:'armor'},monsterItem:{name:'enemy focus',type:'other',magic:6}});
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(),'Ally',s=>s.replace('HP: 50','HP: 10')));
  S.synchronize(f.state);
  let choice=S.aiChoice(f.state,{...f.actor('PC'),type:'npc'},['Enemy']);
  assert.equal(choice.effect,'heal'); assert.equal(choice.target,'Ally');
  choice=S.aiChoice(f.state,f.actor('Enemy'),['PC','Ally']);
  assert.ok(choice); assert.notEqual(choice.target,'Enemy');
  assert.notEqual(choice.effect,'blast','An area spell must not hit its caster');
  f.state.setUpdatedGameConsole(S.changeActor(f.state.getUpdatedGameConsole(),'PC',s=>s.replace('HP: 100','HP: 10')));
  choice=S.aiChoice(f.state,f.actor('Enemy'),['PC','Ally']);
  assert.ok(choice?.effect !== 'heal' || choice.target === 'Enemy','Hostiles cannot heal their opponents');
});

test('the real turn resolver starts, continues and completes a slow spell without an LLM call', async () => {
  const fs=require('node:fs'), vm=require('node:vm'), f=fixture({item:{magic:6}});
  S.synchronize(f.state); Casting.beginRound(f.state);
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'), log=[], rolls=[];
  const ctx={require,SpellSystem:S,CombatCasting:Casting,CombatLife:Life,sharedState:f.state,Inhabitants:I,
    console:{info(){}},populationService:null,updatedGameConsole:f.state.getUpdatedGameConsole(),broadcast(){},
    actionDice:{active:{id:'action',geoKey:'1,0,0'},recordCombat(){},roll:async spec=>{rolls.push(spec);return{natural:spec.sides,total:spec.sides};}},
    commitCombatHealth(){},ActionFeedback:{publish(){}},dropMonsterItemsToRoom(){}};
  vm.runInNewContext(source.slice(source.indexOf('function automaticCombatSpell('),source.indexOf('async function resolveCombatRound(')),ctx);
  const pc=f.actor('PC'), allies=[f.actor('Ally')], enemies=[f.actor('Enemy')], killed=new Set();
  assert.equal(await ctx.resolveCombatSpell({...f.input('fireball'),name:'Fireball',castingRounds:2},pc,pc,allies,enemies,killed,log,enemies),true);
  assert.equal(rolls.length,0); assert.match(log[0],/begins casting/);
  Casting.beginRound(f.state); assert.equal(await ctx.continueCombatCasting(pc,pc,allies,enemies,killed,log,enemies),true);
  assert.equal(rolls.length,0);
  Casting.beginRound(f.state); assert.equal(await ctx.continueCombatCasting(pc,pc,allies,enemies,killed,log,enemies),true);
  assert.ok(rolls.length>0); assert.match(log.at(-1),/casts Fireball/);
});

test('the real NPC turn selector uses owned spells without a queued player command', () => {
  const fs=require('node:fs'),vm=require('node:vm'),f=fixture({item:{magic:1}});
  let text=S.changeActor(f.state.getUpdatedGameConsole(),'PC',s=>s.replace('Weapon: ashblade','Weapon: None'));
  text=S.changeActor(text,'Ally',s=>s.replace('Weapon: None','Weapon: ashblade').replace('Magic: 0','Magic: 1'));
  f.state.setUpdatedGameConsole(text.replace('"owner":"PC"','"owner":"Ally"')); S.synchronize(f.state);
  const source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),ctx={require,SpellSystem:S,sharedState:f.state};
  vm.runInNewContext(source.slice(source.indexOf('function automaticCombatSpell('),source.indexOf('async function continueCombatCasting(')),ctx);
  const result=ctx.automaticCombatSpell(f.actor('Ally'),[f.actor('Enemy')]);
  assert.equal(result.cast.caster,'Ally'); assert.equal(result.cast.effect,'damage'); assert.equal(result.cast.target,'Enemy');
});

test('spellbook shows temporary casting unavailability and restores counts next round', () => {
  const Book=require('../retort/partySpellbook'),f=fixture({item:{magic:1}});
  S.synchronize(f.state); Casting.beginRound(f.state);
  const db=JSON.parse(f.state.getRoomNameDatabase());
  Life.apply(db,'run',f.actor('PC'),99,null,{geoKey:'1,0,0',damage:1}); Life.commit(f.state,db);
  let spells=Book.project(f.state).casters[0].groups.flatMap(g=>g.spells);
  assert.ok(spells.length); assert.ok(spells.every(s=>s.casts===0 && /concentration/.test(s.status)));
  Casting.beginRound(f.state); spells=Book.project(f.state).casters[0].groups.flatMap(g=>g.spells);
  assert.ok(spells.some(s=>s.casts>0));
});

test('hostile healers recognize their unconscious allies instead of losing team identity', () => {
  const f=fixture({monsterItem:{name:'healing robe',type:'armor',magic:3}});
  let text=f.state.getUpdatedGameConsole(),ally=f.actor('Ally');
  text=text.replace(ally.rawSheet,'None').replace('Monsters in Room:', 'Monsters in Room:\n'+ally.rawSheet.replace('State: Friendly','State: Hostile')+'\n');
  f.state.setUpdatedGameConsole(text); S.synchronize(f.state); Life.beginCombat(f.state); Casting.beginRound(f.state);
  const db=JSON.parse(f.state.getRoomNameDatabase()); Life.apply(db,'run',f.actor('Ally'),0,20,{geoKey:'1,0,0',damage:50}); Life.commit(f.state,db);
  const choice=S.aiChoice(f.state,f.actor('Enemy'),['PC']);
  assert.equal(choice.effect,'heal'); assert.equal(choice.target,'Ally');
  const cast=S.cast(f.state,null,{...choice,nonce:'hostile-heal:123'},{combat:true,monster:true,random:sides=>sides});
  assert.equal(cast.error,undefined); assert.ok(f.actor('Ally').hp>0); assert.equal(f.actor('Ally').state,'Hostile');
});
