'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), Items = require('../retort/itemAuthoring');
const item = changes => ({ name: 'bronze knife', type: 'weapon', attack_modifier: 3, damage_modifier: 4, ac: 0, magic: 0,
  description: 'A short bronze blade with a woven grip.', consumable_kind: 'none', ...changes });
test('portable items use the same exact modifier enums as generated room objects, not SRD mechanics', () => {
  const value = Items.validate({ items: [item()] }, { count: 1 })[0]; assert.equal(value.item_source, Items.SOURCE);
  for (const changes of [{ damage_modifier: 2 }, { attack_modifier: 1 }, { ac: 4 }, { damage_dice: '1d6' },
    { price_silver: 10 }, { description: 'Deals 1d6 damage.' }]) assert.throws(() => Items.validate({ items: [item(changes)] }, { count: 1 }));
});
test('names remain unique within an item request, and ordinary items cannot mint a reserved boss key', () => {
  assert.throws(() => Items.validate({ items: [item(), item()] }, { count: 2 }), /distinct/);
  assert.throws(() => Items.validate({ items: [item({ name: 'vault seal key abcdefabcdef' })] }, { count: 1 }), /reserved/);
});
test('genre-appropriate medicine shares the engine healing rules without a compulsory potion name', () => {
  const value = Items.validate({ items: [item({ name: 'sterile repair ampoule', type: 'other', attack_modifier: 0,
    damage_modifier: 0, magic: 7, consumable_kind: 'healing', description: 'A sealed ampoule of clotting gel.' })] }, { count: 1, healingOnly: true })[0];
  assert.equal(value.magic, 7); assert.equal(value.consumable_kind, 'healing');
});
test('catalog suggestions contain names and types only, never damage dice, prices or imported modifiers', () => {
  for (const genre of ['fantasy', 'dark-fantasy', 'cyberpunk', 'sci-fi']) for (const row of Items.references({ genres: [genre] }))
    assert.deepEqual(Object.keys(row).sort(), ['name', 'type']);
});
test('one item batch writes its own descriptions and receives the supplied genre rather than canonical campaign lore', async () => {
  const messages = []; let calls = 0;
  const agent = { user: async text => messages.push(text), assistant: { generation: async () => { calls++; return { content: JSON.stringify({ items: [item()] }) }; } } };
  const world = require('./fixtures/authored-world.cjs')('cyberpunk'); world.kind = 'homebrew';
  const result = await Items.generate(agent, { count: 1, roomName: 'Supply Counter', roomDescription: 'A clinic supply counter.', world, random:()=>0 });
  assert.equal(calls, 1); assert.equal(result[0].description, item().description);
  assert.doesNotMatch(messages.join('\n'), /Tartarus|Mortacia|Arithus/);
});

test('ordinary item categories restore the original independent equal 25 percent odds',()=>{
  const totals={weapon:0,armor:0,shield:0,other:0};
  for(let i=0;i<10000;i++)totals[Items.selectTypes(1,{random:()=>(i+.5)/10000})[0]]++;
  assert.deepEqual(totals,{weapon:2500,armor:2500,shield:2500,other:2500});
  let i=0;assert.deepEqual(Items.selectTypes(4,{random:()=>[0,.25,.5,.75][i++]}),Items.TYPES);
  assert.deepEqual(Items.selectTypes(3,{random:()=>.9}),['other','other','other'],'Independent rolls do not promise one of each category');
});

test('special healing and explicitly restricted equipment keep their required types',()=>{
  assert.deepEqual(Items.selectTypes(4,{healingOnly:true,random:()=>assert.fail('Healing stock must not roll weapon types')}),Array(4).fill('other'));
  assert.deepEqual(Items.selectTypes(3,{types:['weapon'],random:()=>.9}),Array(3).fill('weapon'));
  assert.throws(()=>Items.selectTypes(1,{types:['weapon'],healingOnly:true}),/other/);
});

test('the model cannot turn a selected weapon, armor or shield into an other object',()=>{
  for(const type of ['weapon','armor','shield'])assert.throws(()=>Items.validate({items:[item({type:'other'})]},
    {count:1,typePlan:[type]}),/engine-selected/);
});

test('a mixed batch authors all four rolled types in one call using the same game modifier rules',async()=>{
  let slot=0,calls=0;const messages=[];
  const agent={user:async text=>messages.push(text),assistant:{generation:async()=>{calls++;return{content:JSON.stringify({items:Items.TYPES.map((type,i)=>
    item({name:['bronze knife','leather coat','wooden shield','glass charm'][i],type}))})};}}};
  const result=await Items.generate(agent,{count:4,roomName:'Hall',random:()=>slot++/4});
  assert.equal(calls,1);assert.equal(slot,4);assert.deepEqual(result.map(item=>item.type),Items.TYPES);
  assert.ok(messages.some(text=>text.includes('Engine-selected item types')&&text.includes(JSON.stringify(Items.TYPES))));
});

test('generation retries cannot reroll equipment slots or silently accept an all-other response',async()=>{
  let calls=0,rolls=0;
  const agent={user:async()=>{},assistant:{generation:async()=>{calls++;return{content:JSON.stringify({items:[item({type:'other'})]})};}}};
  await assert.rejects(Items.generate(agent,{count:1,random:()=>{rolls++;return 0;}}),/engine-selected/);
  assert.ok(calls>1);assert.equal(rolls,1);
});
