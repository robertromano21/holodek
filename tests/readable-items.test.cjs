'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../assets/readableItems'),P=require('../assets/physicalPuzzles'),I=require('../assets/dungeonInhabitants');
const {prepare}=require('../retort/readableActions');
const Memory=require('../retort/campaignMemory'),Feedback=require('../assets/actionFeedback'),Items=require('../assets/renderSceneItems');
function raw(kind='book'){
  return{kind,name:kind==='book'?'chronicle of the pale court':kind==='spellbook'?'grimoire of the white lady':kind+' of the pale court',
    title:'History of the Pale Court',backstory:'A mason wrote this after the first sandstorm, preserving Mortacia\'s refuge.',role:'mechanism_clue',clueChapter:2,
    chapters:[{title:'The Refuge',text:'The departed built a refuge in the mountain, beneath Mortacia\'s wings.'},
      {title:'The Witnesses',text:'The mason preserved the crests beside each control.'}],
    modifiers:{attack_modifier:0,damage_modifier:0,ac:1,magic:2},spellRefs:kind==='spellbook'?['grave_light']:[]};
}
function fixture(){
  let p;for(let i=0;i<100;i++){const f=P.fallback('reading-'+i,'Pale Court');if(f.kind==='alignment'){p=P.compile({...f,readables:[raw()]});break;}}
  const room={name:'Pale Court',objects:[],puzzleMechanism:p},database={'0,0,0':room},
    text=R.spawn(p,room,'Room Name: Pale Court\nCoordinates: X: 0, Y: 0, Z: 0\nObjects in Room: None\nObjects in Room Properties: None\nInventory: Empty\nTurns: 1');
  const dungeon={geoKey:'0,0,0',cells:{},sceneObjects:[{name:p.readables[0].name,type:'other',x:3,y:2}]};
  for(let y=0;y<10;y++)for(let x=0;x<10;x++)dungeon.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:3};
  const actor={name:'Hero',type:'pc',hp:20,mazeRoomKey:'0,0,0',mazeX:2,mazeY:2};
  const args={database,consoleText:text,dungeon,actor,geoKey:'0,0,0'};
  return{p,room,database,text,dungeon,actor,args};
}
for(const kind of ['book','scroll','map','spellbook'])test(`${kind}: stored chapters, background, ordinary modifiers and a distinct item sprite`,()=>{
  const r=R.validate([raw(kind)])[0];assert.equal(r.kind,kind);assert.equal(r.modifiers.magic,2);assert.equal(r.chapters.length,2);
  assert.equal(Items.itemKind({name:r.name,type:'other'}),kind==='spellbook'?'book':kind);
  const pixels=Items.renderItemPixels({name:r.name,type:'other',magic:r.modifiers.magic},{scale:1});assert.ok(pixels.data.some(Boolean));
  assert.equal(R.passage(r,R.intent('read chapter 1 of '+r.name)),R.passage(JSON.parse(JSON.stringify(r)),R.intent('read chapter 1 of '+r.name)));
});
test('readable spawn removes None and retains flat item properties without leaking prose or replacing loot',()=>{
  const f=fixture(),r=f.p.readables[0];assert.doesNotMatch(f.text,/Objects in Room: None,/);
  assert.match(f.text,/type: "other", attack_modifier: 0, damage_modifier: 0, ac: 1, magic: 2/);
  assert.equal(I.parseEquipmentProperties(f.text.match(/^Objects in Room Properties: (.*)$/m)[1])[0].magic,2);
  assert.ok(f.room.objects[0].puzzlePiece);assert.equal(f.room.objects[0].properties.ac,1);
  assert.doesNotMatch(f.text,/backstory|chapters|The departed|The mason/);
  const snapshot=JSON.stringify(f.room);assert.equal(R.spawn(f.p,f.room,f.text),f.text);assert.equal(JSON.stringify(f.room),snapshot);
  f.room.objects.push({name:'old sword',type:'weapon',properties:{damage_modifier:3}});
  assert.equal(R.spawn(f.p,f.room,f.text),f.text);assert.equal(f.room.objects.at(-1).properties.damage_modifier,3);
  const conflict={objects:[{name:r.name,type:'weapon'}]};assert.throws(()=>R.spawn(f.p,conflict,f.text),/replace existing/);
});
test('search and chapter reads return stable authored contents; only the bound chapter has the exact mechanism facts',()=>{
  const f=fixture(),name=f.p.readables[0].name,before=JSON.stringify(f.database);
  const search=prepare({...f.args,input:'search '+name}),first=prepare({...f.args,input:'read chapter 1 of '+name}),second=prepare({...f.args,input:'read '+name+' chapter 2'});
  assert.ok(search.allowed);assert.match(search.message,/A mason wrote this/);assert.match(search.message,/Chapter 2: The Witnesses/);
  assert.match(first.message,/The departed built a refuge/);assert.doesNotMatch(first.message,/accompanying diagram/);
  assert.ok(second.message.includes(P.clue(f.p)));assert.equal(second.record.mechanismId,f.p.id);
  assert.equal(prepare({...f.args,input:'read '+name+' chapter 2'}).message,second.message);
  assert.equal(JSON.stringify(f.database),before);assert.equal(second.metadata.result,'observed');
  assert.equal(prepare({...f.args,input:'read chapter 99 of '+name}).allowed,false);
});
test('dead remote obscured taken and unowned documents cannot reveal their contents',()=>{
  const f=fixture(),input='read '+f.p.readables[0].name;
  assert.equal(prepare({...f.args,input,actor:{...f.actor,hp:0}}).allowed,false);
  assert.equal(prepare({...f.args,input,actor:{...f.actor,mazeX:8}}).allowed,false);
  f.dungeon.cells['3,2'].tile='wall';assert.equal(prepare({...f.args,input}).allowed,false);f.dungeon.cells['3,2'].tile='floor';
  assert.equal(prepare({...f.args,input,consoleText:f.text.replace(/^Objects in Room:.*$/m,'Objects in Room: None')}).allowed,false);
  assert.equal(prepare({...f.args,input,geoKey:'0,1,0'}).allowed,false);
});
test('taking a document preserves its original text in other rooms without respawning it',()=>{
  const f=fixture(),name=f.p.readables[0].name,input='read chapter 2 of '+name;
  const text=f.text.replace('Inventory: Empty','Inventory: '+name).replace(/^Objects in Room:.*$/m,'Objects in Room: None');
  f.room.objects=[];
  assert.ok(prepare({...f.args,input,consoleText:text,geoKey:'0,1,0',dungeon:null}).allowed);
  assert.equal(f.room.objects.length,0);assert.equal(f.room.readables[0].chapters[1].text,raw().chapters[1].text);
});
test('generic chapter commands follow the explicit last-read focus and otherwise refuse ambiguous choices',()=>{
  const f=fixture(),other={...f.room.readables[0],id:'other',name:'book of the wandering dead'};f.room.readables.push(other);
  const text=f.text.replace('Inventory: Empty','Inventory: '+f.room.readables.map(r=>r.name).join(', '));
  assert.equal(prepare({...f.args,input:'read chapter 1',consoleText:text}).allowed,false);
  f.room.readableFocus={Hero:f.p.id+':text_0'};
  assert.ok(prepare({...f.args,input:'read chapter 1',consoleText:text}).message.includes(raw().chapters[0].text));
});
test('readable validation prevents blank objects, invalid chapters, huge text and unbounded item modifiers',()=>{
  for(const patch of [{name:'None'},{name:'3'},{chapters:[]},{backstory:'x'.repeat(351)},{clueChapter:9},{modifiers:{magic:900}},{spellRefs:['bad id']}])
    assert.throws(()=>R.validate([{...raw(),...patch}]));
  assert.equal(R.intent('say "read the book"'),null);assert.equal(R.intent('read chapter 2 of the chronicle of the pale court').chapter,2);
});
test('document subjects do not turn books into the weapons named on their covers',()=>{
  for(const name of ['book of the sword','scroll of the broken shield','map of the spear hills']){
    const expected=name.startsWith('book')?'book':name.startsWith('scroll')?'scroll':'map';
    const item={name,type:'other',magic:1,assembly:require('../retort/assemblyVocab').normalizeItemAssembly(null,{name,type:'other'})};
    assert.equal(item.assembly.kind,expected);assert.equal(Items.itemKind(item),expected);assert.equal(Items.itemLook(item).kind,expected);
  }
});
test('four additional document kinds preserve all five ordinary loot entries and their stats',()=>{
  const ordinary=['old sword','oak shield','iron armor','silver amulet','bronze dagger'].map((name,i)=>({name,type:i===1?'shield':i===2?'armor':i===3?'other':'weapon',properties:{attack_modifier:i,damage_modifier:2,ac:3,magic:1}}));
  const properties=ordinary.map(o=>`{name: "${o.name}", type: "${o.type}", attack_modifier: ${o.properties.attack_modifier}, damage_modifier: 2, ac: 3, magic: 1}`).join(', ');
  const room={objects:JSON.parse(JSON.stringify(ordinary))},before=JSON.stringify(room.objects),definition={id:'reading-test',readables:R.validate(['book','spellbook','scroll','map'].map(raw))};
  const text=R.spawn(definition,room,`Objects in Room: ${ordinary.map(o=>o.name).join(', ')}\nObjects in Room Properties: ${properties}`);
  assert.equal(room.objects.length,9);assert.equal(JSON.stringify(room.objects.slice(0,5)),before);
  assert.equal(I.parseEquipmentProperties(text.match(/^Objects in Room Properties: (.*)$/m)[1]).length,9);
  assert.throws(()=>R.validate([...definition.readables,raw()]),/four/);
});
test('a late document collision refuses the batch before touching any loot or metadata',()=>{
  const rows=R.validate([raw('scroll'),raw('map')]),room={objects:[{name:rows[1].name,type:'weapon',properties:{damage_modifier:4}}]},before=JSON.stringify(room);
  assert.throws(()=>R.spawn({id:'conflict',readables:rows},room,'Objects in Room: None\nObjects in Room Properties: None'),/replace existing/);
  assert.equal(JSON.stringify(room),before);
});
test('the real server read path publishes stored text and witnessed memory without changing puzzle, XP or inventory',async()=>{
  const f=fixture(),source=fs.readFileSync('retort/retortWithUserInput.js','utf8'),
    helper=source.slice(source.indexOf('async function tryReadableItemAction('),source.indexOf('async function tryPhysicalPuzzleAction('));
  const events=[],ledger={runId:'reading-run',records:[]};
  const state={getLastCoords:()=>({x:0,y:0,z:0}),getDungeonRunId:()=>ledger.runId,getCampaignMemory:()=>ledger,
    getRoomNameDatabase:()=>JSON.stringify(f.database),setRoomNameDatabase:value=>Object.assign(f.database,JSON.parse(value)),
    getRoomDungeon:()=>f.dungeon,getCombatCharactersString:()=>JSON.stringify([f.actor]),getUpdatedGameConsole:()=>f.text};
  const context={sharedState:state,ReadableItems:R,prepareReadableAction:prepare,Inhabitants:I,CampaignMemory:Memory,ActionFeedback:Feedback,broadcast:e=>events.push(e),console:{info(){}},updatedGameConsole:f.text};
  const call=vm.compileFunction(helper+';return tryReadableItemAction(input);',[...Object.keys(context),'input']);
  const puzzle=JSON.stringify(f.p),items=JSON.stringify(f.room.objects);
  const result=await call(...Object.values(context),'read chapter 2 of '+f.p.readables[0].name);
  assert.equal(result.actionOnly,true);assert.equal(result.readableItem,true);assert.ok(result.content.includes(P.clue(f.p)));
  assert.ok(events.some(e=>e.type==='action_notice'));assert.ok(events.some(e=>e.type==='campaign_memory'));
  assert.ok(ledger.records.some(r=>r.source==='stored-readable-metadata'&&r.witnesses.includes('Hero')));
  assert.equal(state.getUpdatedGameConsole(),f.text);assert.equal(JSON.stringify(f.p),puzzle);assert.equal(JSON.stringify(f.room.objects),items);
  assert.equal(ledger.records.some(r=>r.text.includes('learns spell')),false);
});
