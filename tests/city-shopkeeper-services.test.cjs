'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Economy=require('../retort/economy');
test('a promoted shop worker owns persistent stock; customers and other venues cannot become equipment shops',()=>{
  const db={'1,0,0':{}},actor={name:'Keeper',status:'present',hp:7,allegiance:'Neutral'},job={mode:'work',venueId:'shop-one',venueType:'shop'};
  const first=Economy.bindVenueTrader(db,'1,0,0',actor,job);assert.equal(first.operator,actor.name);assert.equal(first.stock.length,0);
  assert.equal(first.stockAuthorship.status,'pending');first.stock=[{name:'authored blade',quantity:2}];first.stockAuthorship.status='ready';
  first.stock[0].quantity=0;assert.equal(Economy.bindVenueTrader(db,'1,0,0',actor,job),first);assert.equal(first.stock[0].quantity,0);
  assert.equal(Economy.bindVenueTrader(db,'1,0,0',{...actor,name:'Customer'},{...job,mode:'visit'}),null);
  assert.equal(Economy.bindVenueTrader(db,'1,0,0',{...actor,name:'Librarian'},{...job,venueType:'library'}),null);
  assert.equal(Object.keys(db['1,0,0'].services).length,1);
});
test('different shops keep separate inventories at shared city coordinates',()=>{
  const db={'1,0,0':{}};
  for(const id of ['north','south'])Economy.bindVenueTrader(db,'1,0,0',{name:id,allegiance:'Neutral'}, {mode:'work',venueId:id,venueType:'shop'});
  const [a,b]=Object.values(db['1,0,0'].services);assert.notEqual(a.id,b.id);
  a.stock=[{name:'north blade',quantity:2}];b.stock=[{name:'south blade',quantity:2}];a.stock[0].quantity=0;assert.ok(b.stock[0].quantity>0);
});
