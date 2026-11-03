'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../assets/cityEstablishments'),Catalog=require('../assets/landmarkCatalog');
const building=(id,type)=>({id,type,name:'Authored '+id,left:20,top:20,width:12,depth:14,doors:[{x:26,y:20}]});
test('venue notices distinguish actual trading, healing and lodging from work inquiries',()=>{
  for(const type of E.TYPES){
    const expected=['home','park'].includes(type)?null:type==='inn'?'Trade and Lodging Inside':
      ['shop','bar','workshop','foodhall'].includes(type)?'Trade Inside':['clinic','temple'].includes(type)?'Healing Services Inside':'Work Inquiries Inside';
    assert.equal(E.serviceNotice(building(type,type)),expected,type);
  }
  assert.equal(E.serviceNotice({type:'shop',servicesAvailable:false}),null);
  assert.equal(E.serviceNotice({name:'An unverified shop',type:'unknown'}),null);
});
test('service buildings become stable discoverable landmarks at saved entrances without generating prose',()=>{
  const b=building('library-1','library'),d={geoKey:'1,0,0',cityBlocks:{buildings:[b,building('house','home'),building('park','park')]}};
  const markers=Catalog.catalog(d);assert.equal(markers.length,1);
  assert.equal(markers[0].id,'city-service:library-1');assert.equal(markers[0].x,26.5);assert.equal(markers[0].y,20.5);
  assert.equal(markers[0].label,'Authored library-1 - Work Inquiries Inside');assert.equal(markers[0].glyph,'W');
  assert.equal(markers[0].knownOnArrival,false,'Do not reveal unexplored service buildings');
  assert.equal(Catalog.catalog(d),markers,'Reuse cached catalog while walking');
  assert.equal(b.serviceNotice,undefined,'Discovery must not mutate saved architecture');
});
test('service landmarks do not consume existing landmark slots or appear on a different building floor',()=>{
  const d={geoKey:'1,0,0',sceneLandmarks:Array.from({length:60},(_,i)=>({type:'arch',name:'Authored arch '+i,x:i,y:3})),
    cityBlocks:{buildings:Array.from({length:80},(_,i)=>building('venue'+i,'shop'))}};
  const markers=Catalog.catalog(d);assert.equal(markers.filter(m=>m.kind==='arch').length,48);
  assert.equal(markers.filter(m=>m.notice).length,80);
  assert.equal(Catalog.catalog({...d,cityFloorContext:{hostKey:d.geoKey,buildingId:'venue0',floor:2}}).filter(m=>m.notice).length,0);
  d.cityBlocks.buildings=[...d.cityBlocks.buildings,building('new','temple')];assert.equal(Catalog.catalog(d).length,129);
});
test('service landmark preview and discovery banners show their actual capability notice',()=>{
  const nodes=[];
  const element=tag=>{const n={tag,children:[],classList:{remove(){},add(){}},append(...c){this.children.push(...c);},appendChild(c){this.children.push(c);},setAttribute(){}};nodes.push(n);return n;};
  const document={createElement:element,head:element('head'),body:element('body'),addEventListener:(_event,fn)=>fn()};
  const marker=Catalog.catalog({cityBlocks:{buildings:[building('inn','inn')]}})[0];
  const root={dungeonRunId:'run'};let now=1000;
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/areaTitleUi'),'utf8'),{window:root,document,Date:{now:()=>now}});
  root.DungeonAreaTitles.preview(marker);
  assert.ok(nodes.some(n=>n.tag==='small'&&n.textContent==='Trade and Lodging Inside'));
  assert.ok(nodes.some(n=>n.tag==='strong'&&n.textContent==='Authored inn'));
  const announced=new Set();root.DungeonExplorationMap={ready:()=>true,wasAnnounced:id=>announced.has(id),markLandmark:id=>announced.add(id)};
  root.LandmarkCatalog={catalog:()=>[marker]};root.DungeonCartography={visible:()=>true};
  const ctx={dungeon:{geoKey:'0,0,0'},player:{x:26.5,y:20.5}};
  root.DungeonAreaTitles.update(ctx);assert.ok(announced.has(marker.id));
  now+=6000;root.DungeonAreaTitles.update(ctx);assert.ok(nodes.some(n=>n.tag==='small'&&n.textContent==='Trade and Lodging Inside'));
  const html=fs.readFileSync('assets/index.html','utf8');assert.ok(html.indexOf('/assets/cityEstablishments.js')<html.indexOf('/assets/landmarkCatalog.js'));
});
