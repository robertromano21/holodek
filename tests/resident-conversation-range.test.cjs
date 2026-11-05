'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),I=require('../assets/dungeonInhabitants');
function fixture(){
  const d={geoKey:'1,0,0',classification:{indoor:false},start:{x:4,y:4},cells:{}};
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)d.cells[`${x},${y}`]={tile:'floor',floorHeight:0,ceilHeight:6};
  const p=I.createPopulation(d.geoKey,[{name:'Vyth',allegiance:'Friendly'},{name:'Calthokael',allegiance:'Friendly'}],{indoor:false});
  const roster=[{name:'Mortacia',type:'pc',hp:20,mazeRoomKey:d.geoKey,mazeX:4,mazeY:4},
    ...['Vyth','Calthokael'].map((name,i)=>({name,type:'monster',hp:12,state:'Friendly',mazeRoomKey:d.geoKey,mazeX:28+i,mazeY:4}))];
  for(const actor of roster.slice(1)){Object.assign(p.actors[actor.name],{position:{x:actor.mazeX,y:actor.mazeY},encounteredAt:1});}
  return{d,p,roster,player:{x:4.5,y:4.5}};
}
test('visible Vyth and Calthokael remain in the room and the same player conversation at 24–25 tiles',()=>{
  const f=fixture(),view=I.perceive(f.d,f.roster,f.p,false,{conversation:true});
  assert.deepEqual(view.conversational.map(a=>a.name),['Vyth','Calthokael']);
  assert.deepEqual(I.nearbyMonsterNames(f.d,f.roster,f.p,f.player,{conversation:true}),['Vyth','Calthokael']);
  assert.equal(I.dialogueReach(f.d,f.roster[1],f.player,{conversation:true}).range,32);
  assert.equal(I.dialogueReach(f.d,f.roster[1],f.player).canSpeak,false,'Ambient chatter keeps its ten-tile boundary.');
  assert.equal(I.perceive(f.d,f.roster,f.p).conversational.length,0);
});
test('the 32-tile boundary preserves sealed walls, floors, pending discovery and combat proximity',()=>{
  const f=fixture(),actor=f.roster[1];actor.mazeX=36;
  assert.equal(I.dialogueReach(f.d,actor,f.player,{conversation:true}).canSpeak,true);
  actor.mazeX=37;assert.equal(I.dialogueReach(f.d,actor,f.player,{conversation:true}).canSpeak,false);actor.mazeX=28;
  for(let y=0;y<64;y++)f.d.cells[`16,${y}`].tile='wall';
  assert.equal(I.dialogueReach(f.d,actor,f.player,{conversation:true}).canSpeak,false);
  for(let y=0;y<64;y++)f.d.cells[`16,${y}`].tile='floor';
  for(const change of [{mazeRoomKey:'2,0,0'},{discoveryState:'pending'},{hp:0},{state:'Dead'}])
    assert.equal(I.dialogueReach(f.d,{...actor,...change},f.player,{conversation:true}).canSpeak,false);
  f.d.cells['28,4'].floorHeight=40;assert.equal(I.dialogueReach(f.d,actor,f.player,{conversation:true}).canSpeak,false);
  assert.ok(!I.nearbyMonsterNames(f.d,f.roster,f.p,f.player,{conversation:true}).includes('Vyth'));f.d.cells['28,4'].floorHeight=0;
  actor.allegiance=actor.state='Hostile';f.p.groups[0].status='engaged';
  assert.deepEqual(I.hostileEncounterNames(f.d,f.roster,f.p,f.player),[]);
  assert.equal(I.dialogueReach(f.d,{...actor,type:'npc'},f.player,{conversation:true}).range,8);
});
test('the actual Monsters in Room UI keeps the visible group listed at the expanded radius',()=>{
  const f=fixture(),blocks=['Vyth','Calthokael'].map(name=>({dataset:{monsterName:name,monsterHp:'12',monsterState:'Friendly'},hidden:true,querySelector:()=>({textContent:'State: Friendly'})})),none={hidden:false};
  const source=fs.readFileSync('assets/game.js','utf8'),window={DungeonInhabitants:I,DungeonLife:{population:()=>f.p},combatCharacters:f.roster};
  const context={window,currentDungeon:f.d,playerPosX:f.player.x,playerPosY:f.player.y,characterState:I.state,
    document:{getElementById:id=>id==='phaser-container'?{dataset:{consoleGeoKey:f.d.geoKey},querySelectorAll:()=>blocks}:id==='nearby-monsters-none'?none:null}};
  vm.runInNewContext(source.slice(source.indexOf('window.refreshDungeonConsoleStates ='),source.indexOf('window.onDungeonPause =')),context);
  window.refreshDungeonConsoleStates();assert.ok(blocks.every(b=>!b.hidden));assert.equal(none.hidden,true);
});
test('an explicit player turn can notice a visible resident at conversation range without discovering hidden group members',()=>{
  const f=fixture();delete f.p.actors.Vyth.encounteredAt;delete f.p.actors.Calthokael.encounteredAt;
  f.roster[2].discoveryState=f.p.actors.Calthokael.discoveryState='pending';
  assert.equal(I.noticeConversationResidents(f.d,f.roster,f.p),true);assert.ok(f.p.actors.Vyth.encounteredAt>0);
  assert.equal(f.p.actors.Calthokael.encounteredAt,undefined);assert.equal(f.p.groups[0].introPlayed,false);
  const version=f.p.revision;assert.equal(I.noticeConversationResidents(f.d,f.roster,f.p),false);assert.equal(f.p.revision,version);
  I.noteSpoken(f.p,[{speaker:'Vyth',line:'Yes, I heard your invitation.'}],true);assert.equal(f.p.groups[0].introPlayed,true);
});
test('committed recruitment promotes the existing world actor before presence filtering without changing art, HP or position',()=>{
  const f=fixture(),actor=f.roster[1],sprite={dataUrl:'data:approved-vyth'};actor.sprite=sprite;actor.hp=3;
  f.p.actors.Vyth.status='recruited';f.p.actors.Vyth.allegiance='Friendly';
  I.attach(f.roster,f.p);
  assert.equal(actor.type,'npc');assert.equal(I.isPresent(actor,f.p),true);assert.equal(actor.hp,3);assert.equal(actor.sprite,sprite);assert.equal(actor.mazeX,28);
  assert.equal(f.roster.filter(a=>I.isPresent(a,f.p)).length,3);I.attach(f.roster,f.p);assert.equal(f.roster.length,3);
  assert.equal(f.roster[2].type,'monster','Friendly bystanders are not recruited.');
});
test('recruitment updates neither revive incapacitated allies nor promote an actor from another room',()=>{
  const f=fixture(),actor=f.roster[1];f.p.actors.Vyth.status='recruited';actor.hp=0;actor.state='Unconscious';I.attach(f.roster,f.p);
  assert.equal(actor.type,'npc');assert.equal(actor.hp,0);assert.equal(actor.state,'Unconscious');
  const other=f.roster[2];f.p.actors.Calthokael.status='recruited';other.mazeRoomKey='2,0,0';I.attach(f.roster,f.p);assert.equal(other.type,'monster');
});
