'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../retort/economy'),V=require('../retort/cityVenueServices'),Bindings=require('../assets/cityEstablishments'),Services=require('../retort/serviceEncounters');
function fixture(){
  const file=require.resolve('./economy.test.cjs'),source=fs.readFileSync(file,'utf8');
  const f=vm.runInNewContext(source.slice(0,source.indexOf("test('initial pooled"))+'\nfixture();',
    {require:require('node:module').createRequire(file)});
  const name='Second Attendant',sheet=f.p.actors.Keeper.sheet.replaceAll('Keeper',name);
  f.p.actors[name]={...structuredClone(f.p.actors.Keeper),name,sheet,position:{x:6,y:4},home:{x:6,y:4}};
  f.state.setUpdatedGameConsole(f.state.getUpdatedGameConsole().replace('Monsters in Room:\n','Monsters in Room:\n'+sheet+'\n'));
  const roster=JSON.parse(f.state.getCombatCharactersString());roster.push({name,type:'monster',hp:12,state:'Neutral',mazeX:6,mazeY:4,mazeRoomKey:'1,0,0'});
  f.state.setCombatCharactersString(JSON.stringify(roster));return {...f,name};
}
test('two saved civic workers share one real desk and both qualify as service providers',()=>{
  const f=fixture(),db=f.db(),room=db['1,0,0'];room.inhabitants=f.p;
  const occupation={mode:'work',venueId:'same-civic-hall',venueType:'civic'};
  const first=V.bind(room,f.p.actors.Keeper,occupation,'1,0,0'),second=V.bind(room,f.p.actors[f.name],occupation,'1,0,0');
  assert.equal(second,first);assert.equal(Object.keys(room.venueDesks).length,1);
  assert.equal(V.forActor(room,f.name),first);assert.equal(V.describe(room,f.name).type,'civic');
  V.bind(room,f.p.actors[f.name],occupation,'1,0,0');assert.deepEqual(Bindings.operators(first),['Keeper',f.name]);
  assert.deepEqual(Services.providers(room,f.p,db),['Keeper',f.name]);
  f.state.setRoomNameDatabase(JSON.stringify(db));
  assert.equal(E.view(f.state,f.name).venue.type,'civic','The second worker can open a menu immediately');
});
test('multiple shop staff share depleted stock, authorship and till instead of silently losing their menus or refilling',()=>{
  const f=fixture(),db=f.db(),room=db['1,0,0'],occupation={mode:'work',venueId:'same-shop',venueType:'shop'};room.inhabitants=f.p;
  const first=E.bindVenueTrader(db,'1,0,0',f.p.actors.Keeper,occupation);
  first.stock=[{...require('../assets/economyRules').healingPotion(6),quantity:2}];first.stockAuthorship={version:1,status:'ready'};
  const second=E.bindVenueTrader(db,'1,0,0',f.p.actors[f.name],occupation);
  assert.equal(second,first);assert.equal(f.p.actors[f.name].serviceId,first.id);assert.equal(Object.keys(room.services).length,1);
  f.state.setRoomNameDatabase(JSON.stringify(db));assert.equal(E.view(f.state,f.name).service.id,first.id);
  assert.equal(f.action({kind:'buy',actor:f.name,item:first.stock[0].name}).error,undefined);
  const saved=f.db(),stock=saved['1,0,0'].services[first.id];assert.equal(stock.stock[0].quantity,1);assert.equal(f.book().silver,0);
  const till=stock.till;E.bindVenueTrader(saved,'1,0,0',f.p.actors[f.name],occupation);
  assert.equal(stock.stock[0].quantity,1);assert.equal(stock.till,till);assert.equal(E.needsStock(stock),false);
  assert.equal(E.view(f.state,'Keeper').service.stock[0].quantity,1);
});
test('claiming a service ID or occupation is not authorization to use another operator menu',()=>{
  const f=fixture();f.business('shop');f.p.actors[f.name].serviceId='shop';
  f.change(db=>db['1,0,0'].inhabitants=f.p);
  assert.match(E.view(f.state,f.name).error,/no shop/);
  assert.match(f.action({kind:'buy',actor:f.name,item:'healing potion 6 hp'}).error,/No business/);
});
test('the browser recognizes a shared desk attendant and distinguishes inquiries from services',()=>{
  const f=fixture(),db=f.db(),room=db['1,0,0'],occupation={mode:'work',venueId:'hall',venueType:'civic'};room.inhabitants=f.p;
  V.bind(room,f.p.actors.Keeper,occupation,'1,0,0');V.bind(room,f.p.actors[f.name],occupation,'1,0,0');
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8'),start=source.indexOf('window.getEconomyResidentInfo ='),end=source.indexOf('window.prepareEconomyState =',start);
  const root={CityEstablishments:Bindings,EconomyRules:require('../assets/economyRules')};vm.runInNewContext(source.slice(start,end),{window:root,roomNameDatabase:new Map(Object.entries(db)),currentDungeon:{geoKey:'1,0,0'}});
  const business=root.getEconomyResidentInfo(f.name);assert.equal(business.venue,true);assert.equal(business.inquiries,true);assert.equal(business.jobs,false);
  room.services={shop:{operator:'Keeper',attendants:[f.name],kind:'shop'}};
  assert.equal(root.getEconomyResidentInfo(f.name).kind,'shop');assert.equal(root.getEconomyResidentInfo(f.name).inquiries,false);
});
test('already promoted workers regain a shared desk without regeneration, movement or repeated repairs',()=>{
  const f=fixture(),db=f.db(),room=db['1,0,0'],occupation={mode:'work',venueId:'hall',venueType:'civic'};room.inhabitants=f.p;
  V.bind(room,f.p.actors.Keeper,occupation,'1,0,0');f.state.setRoomNameDatabase(JSON.stringify(db));
  const citizen={id:'existing',name:f.name,seed:3,status:'promoted',occupation};
  f.d.cityCrowd={actors:{existing:citizen}};f.p.actors[f.name].visualIdentity={version:1};
  const before=JSON.stringify(f.p.actors[f.name].position),Crowds=require('../retort/cityCrowds');
  Crowds.repairPromoted(f.state,f.d,'1,0,0');assert.ok(V.forActor(f.db()['1,0,0'],f.name));
  const saved=f.state.getRoomNameDatabase();Crowds.repairPromoted(f.state,f.d,'1,0,0');
  assert.equal(f.state.getRoomNameDatabase(),saved);assert.equal(JSON.stringify(f.p.actors[f.name].position),before);
  assert.equal(citizen.status,'promoted');
});
test('every advertised service materializes the same planned capability and usable stock, not merely an introduction',async()=>{
  for(const type of Bindings.TYPES){
    const plan=Bindings.servicePlan({type});if(!plan)continue;
    const f=fixture(),db=f.db(),room=db['1,0,0'],occupation={mode:'work',venueId:'venue',venueType:type};room.inhabitants=f.p;
    const service=E.bindVenueTrader(db,'1,0,0',f.p.actors[f.name],occupation),desk=V.bind(room,f.p.actors[f.name],occupation,'1,0,0');
    assert.deepEqual(desk.capabilities,plan.deskCapabilities,type);assert.equal(service?.kind||null,plan.kind,type);
    f.state.setRoomNameDatabase(JSON.stringify(db));
    if(service)await E.prepareStocks(null,f.state,'1,0,0',{serviceId:service.id,author:async(_agent,request)=>{
      assert.equal(request.healingOnly,plan.kind==='temple');return[{name:'authored local supply',type:'other',magic:4,attack_modifier:0,damage_modifier:0,ac:0,price_silver:1}];
    }});
    const menu=E.view(f.state,f.name);assert.equal(menu.error,undefined,type);
    if(plan.kind){assert.equal(menu.service.kind,plan.kind);assert.ok(menu.service.stock.length>0);assert.equal(E.needsStock(menu.service),false);}
    else {assert.equal(menu.service,null);assert.equal(Bindings.serviceNotice({type}),'Work Inquiries Inside');}
    if(plan.capabilities.includes('lodging'))assert.equal(f.action({kind:'lodge',actor:f.name}).error,undefined);
  }
});
test('stock authorship preserves items sold to a shared attendant instead of deleting their buybacks',async()=>{
  const f=fixture(),db=f.db(),room=db['1,0,0'],occupation={mode:'work',venueId:'same-shop',venueType:'shop'};room.inhabitants=f.p;
  const service=E.bindVenueTrader(db,'1,0,0',f.p.actors.Keeper,occupation);E.bindVenueTrader(db,'1,0,0',f.p.actors[f.name],occupation);
  const item=require('../assets/economyRules').healingPotion(6);service.stock=[{...item,quantity:1}];
  db['0,0,0'].economy.receipts.push({kind:'sell',actor:f.name,item:item.name});f.state.setRoomNameDatabase(JSON.stringify(db));
  await E.prepareStocks(null,f.state,'1,0,0',{serviceId:service.id,author:async()=>[{name:'new authored supply',type:'other',magic:3}]});
  assert.equal(f.db()['1,0,0'].services[service.id].stock.find(i=>i.name===item.name).quantity,1);
});
