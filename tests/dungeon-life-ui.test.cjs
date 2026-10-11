const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const I=require('../assets/dungeonInhabitants');
const source=fs.readFileSync(path.join(__dirname,'../assets/dungeonLifeUi.js'),'utf8');
function fixture() {
  let wall=1000;
  const d={geoKey:'1,0,0',start:{x:4,y:4},cells:{},layout:{width:64,height:64}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0};
  const ctx={dungeon:d,player:{x:4.5,y:4.5},actors:[{name:'PC',type:'pc',hp:100,mazeX:4,mazeY:4,mazeRoomKey:d.geoKey}],busy:false};
  const calls=[],encounters=[];
  const root={DungeonInhabitants:I,dungeonRunId:'run',getDungeonLifeContext:()=>ctx,beginEncounterCombat:name=>encounters.push(name)};
  const context={window:root,document:{addEventListener(){},getElementById:()=>null,querySelector:()=>null},Date:{now:()=>wall},console,
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({})};}};
  vm.runInNewContext(source,context);
  root.DungeonLife.tick();
  return {root,ctx,calls,encounters,advance:ms=>wall+=ms,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('dialogue refresh runs once per five active minutes, never once per animation/discovery tick',async()=>{
  const f=fixture();
  for(const delta of [3000,30000,90000,176999]){f.advance(delta);f.root.DungeonLife.tick();await f.flush();}
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,0);
  f.advance(1);f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,1);
  f.advance(500);f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,1);
});
test('pause stops discovery and refresh timers and resumes the remaining active-time interval',async()=>{
  const f=fixture();f.advance(120000);f.root.DungeonLife.tick();await f.flush();
  f.root.DungeonLife.setPaused({paused:true,runId:'run'});
  const count=f.calls.length;f.advance(600000);f.root.DungeonLife.tick();await f.flush();assert.equal(f.calls.length,count);
  f.root.DungeonLife.setPaused({paused:false,runId:'run'});f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,0);
  f.advance(180000);f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,1);
});
test('a command-supplied cache refresh restarts the timer without an extra immediate model request',async()=>{
  const f=fixture();f.advance(290000);
  const p=I.createPopulation(f.ctx.dungeon.geoKey,[]);p.lastDialogueRefreshAt=Date.now();
  f.root.DungeonLife.receivePopulation({population:p,runId:'run'});
  f.advance(10000);f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,0);
  f.advance(290000);f.root.DungeonLife.tick();await f.flush();
  assert.equal(f.calls.filter(a=>a.url==='/room-population/autonomy').length,1);
});
test('only a nearby discovered hostile encounter engages; neutrals and remote guards do not',async()=>{
  const f=fixture(),p=I.createPopulation(f.ctx.dungeon.geoKey,[{name:'Mason',allegiance:'Neutral'},
    {name:'Far Guard',allegiance:'Hostile'},{name:'Near Guard',allegiance:'Hostile'}]);
  for(const [name,x] of [['Mason',5],['Far Guard',25],['Near Guard',6]]){
    const actor={name,type:'monster',hp:20,mazeX:x,mazeY:4,mazeRoomKey:p.geoKey};f.ctx.actors.push(actor);
    p.actors[name].position={x,y:4};p.groups.find(g=>g.members.includes(name)).status='discovered';
  }
  f.root.DungeonLife.receivePopulation({population:p,runId:'run'});f.advance(7000);f.root.DungeonLife.tick();await f.flush();
  assert.deepEqual(f.encounters,['Near Guard']);
  p.groups.find(g=>g.members.includes('Near Guard')).status='engaged';
  f.advance(7000);f.root.DungeonLife.tick();await f.flush();assert.deepEqual(f.encounters,['Near Guard']);
});
