'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../assets/dungeonInhabitants'),corner=require('./fixtures/vyth-cliff-corner.cjs');
function fixture(){const {dungeon:d,player,target}=corner(),actor={name:'Vyth Aerir',type:'monster',race:'Ogre Barbarian',hp:20,state:'Friendly',mazeX:target.x,mazeY:target.y,mazeRoomKey:d.geoKey};
  const population=I.createPopulation(d.geoKey,[{name:actor.name,race:actor.race,allegiance:'Friendly'}],{indoor:false});
  Object.assign(population.actors[actor.name],{position:target,encounteredAt:1});population.groups[0].site=target;
  const pc={name:'Mortacia',type:'pc',hp:20,mazeX:0,mazeY:2,mazePoint:player,mazeRoomKey:d.geoKey};return{d,player,actor,population,roster:[pc,actor]};}
test('the exact Vyth cliff corner admits exposed body visibility while his centre and strict combat ray remain occluded',()=>{
  const f=fixture(),center=I.dialoguePoint(f.actor);assert.equal(I.lineClear(f.d,f.player,center),false);
  const sight=I.residentSight(f.d,f.actor,f.player);assert.equal(sight.visible,true);assert.equal(sight.centerVisible,false);
  assert.ok(I.lineClear(f.d,f.player,sight.point));assert.ok(Math.hypot(sight.point.x-center.x,sight.point.y-center.y)<=I.residentBodyRadius(f.actor)+.001);
  const reach=I.dialogueReach(f.d,f.actor,f.player,{conversation:true});assert.equal(reach.lineOfSight,true);assert.equal(reach.canSpeak,true);assert.ok(reach.distance<2.5);
  assert.deepEqual(I.nearbyMonsterNames(f.d,f.roster,f.population,f.player,{conversation:true}),[f.actor.name]);
  assert.ok(I.perceive(f.d,f.roster,f.population,false,{conversation:true}).conversational.includes(f.actor));
  assert.equal(I.lineClear(f.d,f.player,center),false,'Body visibility does not weaken the strict ray.');
});
test('Vyth remains in the room at the second reported position where human-width samples all fail',()=>{
  const f=fixture(),real=require('./fixtures/vyth-visible-ogre.cjs')();f.d=real.dungeon;f.player=real.player;
  Object.assign(f.actor,{mazeX:real.target.x,mazeY:real.target.y,sprite:{spec:{stature:{version:1,scale:1.88}}}});
  Object.assign(f.population.actors[f.actor.name],{position:real.target});
  Object.assign(f.roster[0],{mazeX:3,mazeY:4,mazePoint:f.player});
  const normal={...f.actor,sprite:{spec:{stature:{version:1,scale:1}}}};
  assert.equal(I.residentSight(f.d,normal,f.player).visible,false,'The first fixed-width fix still fails here.');
  assert.equal(I.residentBodyRadius(f.actor),.564);
  assert.equal(I.residentSight(f.d,f.actor,f.player).visible,true);
  assert.equal(I.dialogueReach(f.d,f.actor,f.player,{conversation:true}).lineOfSight,true);
  assert.deepEqual(I.nearbyMonsterNames(f.d,f.roster,f.population,f.player,{conversation:true}),[f.actor.name]);
  assert.deepEqual(I.nearbyMonsterNames(f.d,[],f.population,f.player,{conversation:true}),[f.actor.name],'Population-only records derive a consistent large creature size.');
  assert.ok(I.perceive(f.d,f.roster,f.population,false,{conversation:true}).conversational.includes(f.actor));
  for(let y=0;y<9;y++)f.d.cells[`6,${y}`]={tile:'wall',floorHeight:4.8,ceilHeight:20};
  assert.equal(I.residentSight(f.d,f.actor,f.player).visible,false,'Large size cannot see through a complete wall.');
});
test('body sampling uses saved visual stature, with a bounded deterministic fallback',()=>{
  assert.equal(I.residentBodyRadius({stature:{scale:2}}),.6);
  assert.equal(I.residentBodyRadius({sprite:{spec:{stature:{scale:100}}}}),.6);
  assert.equal(I.residentBodyRadius({name:'Human',race:'Human'}),.3);
  assert.equal(I.residentBodyRadius({name:'Guide'}),.3,'Missing appearance is not permission to invent a larger body.');
  assert.ok(I.residentBodyRadius({name:'Vyth Aerir',race:'Ogre Barbarian'})>.5);
});
test('large body probes cannot escape a blocked centre cell or closed doorway',()=>{
  for(const cell of [{tile:'wall',blocked:true},{tile:'door',door:{isOpen:false}}]){
    const f=fixture();f.d.cells['2,1']={...f.d.cells['2,1'],...cell};
    assert.equal(I.residentSight(f.d,f.actor,f.player).visible,false);
  }
});
test('a fully occluding wall or closed door still hides every body probe and blocks speech',()=>{
  for(const tile of ['wall','door']){
    const f=fixture();f.d.cells['1,2']={tile,floorHeight:4.868837398373984,ceilHeight:8.4,...(tile==='door'?{door:{isOpen:false}}:{})};
    assert.equal(I.residentSight(f.d,f.actor,f.player).visible,false,tile);assert.equal(I.dialogueReach(f.d,f.actor,f.player,{conversation:true}).canSpeak,false,tile);
    assert.deepEqual(I.nearbyMonsterNames(f.d,f.roster,f.population,f.player,{conversation:true}),[],tile);
    if(tile==='door'){f.d.cells['1,2'].door.isOpen=true;assert.equal(I.residentSight(f.d,f.actor,f.player).visible,true);}
  }
});
test('visible body parts allow a first sighting of only that resident; pending and hidden residents remain unavailable',()=>{
  const f=fixture();delete f.population.actors[f.actor.name].encounteredAt;
  assert.equal(I.noticeConversationResidents(f.d,f.roster,f.population),true);assert.ok(f.population.actors[f.actor.name].encounteredAt);
  const hidden=fixture();delete hidden.population.actors[hidden.actor.name].encounteredAt;hidden.d.cells['1,2'].tile='wall';
  assert.equal(I.noticeConversationResidents(hidden.d,hidden.roster,hidden.population),false);assert.equal(hidden.population.actors[hidden.actor.name].encounteredAt,undefined);
  const pending=fixture();pending.actor.discoveryState=pending.population.actors[pending.actor.name].discoveryState='pending';
  assert.deepEqual(I.nearbyMonsterNames(pending.d,pending.roster,pending.population,pending.player,{conversation:true}),[]);
  assert.equal(I.dialogueReach(pending.d,pending.actor,pending.player,{conversation:true}).canSpeak,false);
});
for(const replay of ['vyth-cliff-corner','vyth-visible-ogre'])test(`the actual room-list updater shows Vyth at screenshot position ${replay}`,()=>{
  const f=fixture(),real=require(`./fixtures/${replay}.cjs`)();f.d=real.dungeon;f.player=real.player;
  Object.assign(f.actor,{mazeX:real.target.x,mazeY:real.target.y,stature:{version:1,scale:1.88}});f.population.actors[f.actor.name].position=real.target;
  const block={dataset:{monsterName:f.actor.name,monsterHp:'20',monsterState:'Friendly'},hidden:true,querySelector:()=>({textContent:'State: Friendly'})},none={hidden:false};
  const source=fs.readFileSync('assets/game.js','utf8'),window={DungeonInhabitants:I,DungeonLife:{population:()=>f.population},combatCharacters:f.roster};
  vm.runInNewContext(source.slice(source.indexOf('window.refreshDungeonConsoleStates ='),source.indexOf('window.onDungeonPause =')),
    {window,currentDungeon:f.d,playerPosX:f.player.x,playerPosY:f.player.y,characterState:I.state,
      document:{getElementById:id=>id==='phaser-container'?{dataset:{consoleGeoKey:f.d.geoKey},querySelectorAll:()=>[block]}:none}});
  window.refreshDungeonConsoleStates();assert.equal(block.hidden,false);assert.equal(none.hidden,true);
});
