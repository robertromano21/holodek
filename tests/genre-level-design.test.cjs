'use strict';
process.env.HOLODEK_HOMEBREW='1'; process.env.HOLODEK_GENRE_KITS='1'; process.env.HOLODEK_GENRE_ARCH='1';
process.env.HOLODEK_GENRE_EXPANSION='1'; process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const test = require('node:test'), assert = require('node:assert/strict');
const Design = require('../retort/genreLevelDesign'), Indoor = require('../retort/indoorBlueprint');
const Setting = require('../retort/settingLayer'), Policy = require('../retort/genreAssetPolicy');
const { makeNavigation, reachable } = require('../retort/sceneArchitecture');
const bible = genre => ({ kind:'homebrew', seed:'test-world', worldSeed:'test-seed', genres:[genre], genreWeights:[{ genre, weight:1 }] });

test('all 18 genres have three original spatial briefs, with reproducible room-specific variation', () => {
  assert.equal(Object.keys(Design.PROFILES).length,18);
  const ids = new Set();
  for (const genre of Object.keys(Design.PROFILES)) {
    const selected = new Set(), plans = new Set();
    for (let i=0;i<64;i++) {
      const options={ seed:'seed-'+i, geoKey:`${i},1,0`, name:'A lived-in work area' }, p=Design.select(genre,options);
      assert.deepEqual(p,Design.select(genre,options)); selected.add(p.id); ids.add(p.id);
      plans.add(JSON.stringify(Design.plan(p)));
      assert.doesNotMatch(Design.directive(p),/\b(?:Tartarus|Hades|Mortacia|Sepulchra|Arithus)\b/);
    }
    assert.equal(selected.size,3,genre); assert.ok(plans.size>12,genre+' varies proportions/elevation/orientation');
  }
  assert.equal(ids.size,54); assert.equal(Design.select('unknown'),null); assert.equal(Design.plan(null),null);
});

for (const genre of Object.keys(Design.PROFILES)) test(genre+' profiles produce connected elevations with safe headroom at both grid sizes', () => {
  const found = new Map();
  for (let i=0;found.size<3&&i<100;i++) {const p=Design.select(genre,{seed:'room-'+i});found.set(p.id,p);}
  const roof=Policy.catalog({},bible(genre)).roofs[0];
  for (const profile of found.values()) for (const size of [32,96]) {
    const plan=Design.plan(profile,{roof}), snapshot=JSON.stringify(plan);
    const dungeon={layout:{width:size,height:size},start:{x:Math.floor(size*.5),y:Math.floor(size*.75)},cells:{},generation:{seed:profile.seed}};
    const report=Indoor.build(dungeon,plan,{floor:0,ceil:6,coveredStorey:true});
    assert.equal(report.source,'genre-designed');assert.equal(report.designProfile,profile.id);
    assert.equal(report.disconnectedRooms,0,profile.id+' size '+size);
    assert.ok(new Set(dungeon.indoorHeightLevels).size>=3,profile.id+' has actual walkable elevations');
    const connected=reachable(makeNavigation(dungeon),dungeon.start);
    for (const r of dungeon.indoorRooms) {
      const x=r.x+Math.floor(r.w/2), y=r.y+Math.floor(r.h/2);
      assert.ok(connected.seen[y*size+x],profile.id+' all spaces are reachable');
      assert.notEqual(r.role,'courtyard','A covered level must never open onto sky');
    }
    for (const c of Object.values(dungeon.cells)) {
      assert.ok(Number.isFinite(c.floorHeight)&&Number.isFinite(c.ceilHeight));
      assert.ok(c.ceilHeight-c.floorHeight>=2,'No ceiling crosses a walking surface');
    }
    for (const r of plan.rooms) assert.ok(r.x>0&&r.y>0&&r.x+r.w<1&&r.y+r.h<1);
    assert.equal(JSON.stringify(plan),snapshot,'The reusable plan is never mutated by carving');
  }
});

test('genre plans supplement new omissions, never saved geometry or authored floorplans', () => {
  Setting.setActive(bible('sci-fi'));
  try {
    const Enrich=require('../retort/blueprintDesign'), options={classification:{indoor:true,biome:'fortress'},size:96,generation:{seed:'station'},sceneSpec:{architecture:'other'}};
    const original={base:{floor:0,ceil:5}}, snapshot=JSON.stringify(original), enriched=Enrich.enrich(original,options);
    assert.equal(JSON.stringify(original),snapshot);assert.ok(enriched.indoorPlan.designProfile.startsWith('sci-fi:'));
    assert.ok(enriched.designContract.added.some(row=>row.kind==='genre-floorplan'));
    assert.equal(Enrich.enrich(enriched,options),enriched,'Saved/enriched plans retain their identity');
    const authored={indoorPlan:{rooms:[{x:.1,y:.1,w:.3,h:.3,role:'entrance',floor:0,roofStyle:'panel',columnOrder:'plain'}],corridors:[]}};
    const result=Enrich.enrich(authored,options);
    assert.deepEqual(result.indoorPlan.rooms,authored.indoorPlan.rooms);
    const cave=Enrich.enrich(original,{...options,sceneSpec:{architecture:'cave'},classification:{indoor:true,biome:'cave'}});
    assert.equal(cave.indoorPlan,undefined,'A natural cave is not converted to a constructed station');
    const outdoors=Enrich.enrich(original,{...options,classification:{indoor:false,biome:'forest'}});
    assert.equal(outdoors.indoorPlan,undefined,'Outdoor terrain is never changed into an indoor maze');
  } finally {Setting.setActive(null);}
});

test('canonical worlds and disabled flags do not acquire genre floorplans', () => {
  assert.equal(Design.forRoom({}, {setting:null}),null);
  const prior=process.env.HOLODEK_ARCHITECTURE_EXPANSION;
  process.env.HOLODEK_ARCHITECTURE_EXPANSION='0';
  try {assert.equal(Design.forRoom({}, {setting:bible('sci-fi')}),null);}
  finally {process.env.HOLODEK_ARCHITECTURE_EXPANSION=prior;}
});

test('actual genre blueprint work orders include spatial direction and fit the 4096-token local model budget', async () => {
  const Models=require('../retort/gameModels'), Host=require('../retort/pcModelHost'), Runtime=require('../retort/gameRetort');
  const Budget=require('../retort/holodekBudget');
  const value=(s,key='')=>{
    if(s.enum)return s.enum[0];
    const type=[].concat(s.type||[]).find(t=>t!=='null');
    if(type==='object')return Object.fromEntries(Object.entries(s.properties||{}).map(([k,v])=>[k,value(v,k)]));
    if(type==='array')return Array.from({length:s.minItems??1},()=>value(s.items,key));
    if(type==='boolean')return false;
    if(type==='number')return key==='ceil'?5:s.minimum??0;
    return 'Authored '+key;
  };
  const previous=Setting.current(), model=Models.current().id;
  try {
    Models.restore('holodek-1');
    for(const genre of ['sci-fi','underwater','desert-fantasy']) {
      Setting.setActive({...Setting.localBible(genre,[genre]),...bible(genre)}); const requests=[];
      const host=Host.createHost({fetchImpl:async(_url,init)=>{
        const body=JSON.parse(init.body); requests.push(body);
        assert.ok(Budget.tally(body.messages,[{response_format:body.response_format}]).total<=Budget.CEILING);
        return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value(body.response_format.json_schema.schema))}}]})};
      }});
      const app=Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});
      const result=await app.run(app.retort($=>require('../retort/holodekBlueprint').generate($,{
        roomDescription:'A connected working interior with an observation gallery.',classification:{indoor:true},size:96,
        customTiles:[],generation:{seed:'budget-'+genre},sceneSpec:{architecture:'other',roomName:'Work Hall'}
      })),null,{shouldSaveToLog:false});
      assert.ok(result.indoorPlan.rooms.length>=6);assert.ok(requests.length>4);
      assert.ok(requests.some(r=>JSON.stringify(r.messages).includes('LEVEL DESIGN '+genre+':')));
    }
  } finally {Models.restore(model);Setting.setActive(previous);}
});
