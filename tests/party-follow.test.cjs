const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness(blocked = new Set()) {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  const begin = source.indexOf('function findNextPartyMazeStep('), end = source.indexOf('// ---- Monster wandering', begin);
  let queries = 0;
  const context = { playerDungeonX: 366, playerDungeonY: 387,
    canEnterTile: (_x, _y, x, y) => { queries++; return x >= 0 && y >= 0 && x < 512 && y < 512 && !blocked.has(`${x},${y}`); },
    isObstacleAtPos: () => false };
  vm.runInNewContext(source.slice(begin, end), context);
  return { context, queries: () => queries };
}
test('companions far behind the player make bounded walking progress instead of exhausting a breadth-first search', () => {
  for (const start of [{ x: 234, y: 388 }, { x: 269, y: 381 }, { x: 310, y: 373 }]) {
    const { context, queries } = harness(), goal = { x: 365, y: 387 };
    const next = context.findNextPartyMazeStep(start, goal, 'Companion', new Set());
    assert.equal(Math.abs(next.x - start.x) + Math.abs(next.y - start.y), 1);
    assert.ok(Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y) < Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y));
    assert.ok(queries() <= 2048);
    assert.equal(context.partyFollowCadence({ mazeX: start.x, mazeY: start.y }, 600), 150);
  }
});
test('follow routes respect walls, occupied tiles and sealed rooms, and never teleport', () => {
  const walls = new Set(Array.from({ length: 20 }, (_, y) => `12,${y}`));
  const { context } = harness(walls), goal = { x: 15, y: 3 };
  let current = { x: 8, y: 3 };
  for (let i = 0; i < 60 && (current.x !== goal.x || current.y !== goal.y); i++) {
    const next = context.findNextPartyMazeStep(current, goal, 'Companion', new Set());
    assert.equal(Math.abs(next.x - current.x) + Math.abs(next.y - current.y), 1);
    assert.ok(!walls.has(`${next.x},${next.y}`)); current = next;
  }
  assert.equal(current.x, goal.x); assert.equal(current.y, goal.y);
  const sealed = harness(new Set(['3,2', '1,2', '2,3', '2,1']));
  const start = { x: 2, y: 2 };
  assert.equal(sealed.context.findNextPartyMazeStep(start, goal, 'Companion', new Set()), start);
  const stationary = context.findNextPartyMazeStep(goal, goal, 'Companion', new Set());
  assert.equal(stationary, goal);
});
test('close companions retain their normal formation cadence', () => {
  const { context } = harness();
  assert.equal(context.partyFollowCadence({ mazeX: 365, mazeY: 388 }, 600), 600);
});

test('40 percent slower roaming retains full-speed catch-up with hysteresis and leaves PC speed unchanged', () => {
  const source = fs.readFileSync('assets/game.js', 'utf8');
  for (const [name, before] of [['NPC_MOVE_TWEEN_MS',420],['NPC_MOVE_STEP_MS',380],['NPC_MOVE_VARIANCE_MS',240],['MONSTER_MOVE_TWEEN_MS',640]]) {
    const value = vm.runInNewContext(source.match(new RegExp('const ' + name + ' = ([^;]+);'))[1]);
    assert.ok(Math.abs(value * .6 - before) < 1e-8);
  }
  const {context:c} = harness(), actor = {mazeX:360,mazeY:387};
  assert.equal(c.partyFollowCadence(actor,700),150);assert.equal(actor._partyCatchingUp,true);
  actor.mazeX=361.5;assert.equal(c.partyFollowCadence(actor,700),150);
  actor.mazeX=362.5;assert.equal(c.partyFollowCadence(actor,700),700);assert.equal(actor._partyCatchingUp,false);
  assert.match(source,/const PC_WALK_FRAME_MS = 220;/);
});

test('the continuous follow route prefers walking around the camera when there is room', () => {
  const {context:c} = harness();c.playerDungeonX=4;c.playerDungeonY=4;c.playerPosX=4.5;c.playerPosY=4.5;
  const next=c.findNextPartyMazeStep({x:2,y:4},{x:6,y:4},'Companion',new Set());
  assert.notEqual(next.x,3,'A direct step into the camera bubble loses to an open detour');
  assert.equal(Math.abs(next.x-2)+Math.abs(next.y-4),1);
});

function viewingHarness(tiles) {
  const source=fs.readFileSync('assets/game.js','utf8'),actor={name:'Mortacia',type:'npc',mazeX:1,mazeY:0};
  const context={window:{combatCharacters:[actor],DungeonInhabitants:{lineClear:()=>true,isDown:()=>false}},
    playerDungeonX:0,playerDungeonY:0,playerPosX:.5,playerPosY:.5,playerAngle:0,currentDungeon:{},
    collectNearbyWalkableTiles:()=>tiles,getCurrentCombatRoomKey:()=> '0,0,0',isCombatRoundActive:()=>false,
    deriveFacingFromDelta:()=> 'left',hashCharacterName:()=>0,
    getPartyNpcBehavior:()=>({profile:'anchor'}),getPartyNpcDesiredPoint:()=>({x:1,y:0})};
  vm.runInNewContext(source.slice(source.indexOf('function rememberCombatMovementFacing('),source.indexOf('function advanceWalkFrame(')),context);
  vm.runInNewContext(source.slice(source.indexOf('function preferPartyViewingTiles('),source.indexOf('function ensurePartyMazeAnchors(')),context);
  vm.runInNewContext(source.slice(source.indexOf('function buildPartyNpcGoalTile('),source.indexOf('function findNextPartyMazeStep(')),context);
  vm.runInNewContext(source.slice(source.indexOf('window.focusDungeonSpeaker ='),source.indexOf('window.beginEncounterCombat =')),context);
  return {context,actor};
}

test('idle companions prefer three paces from the continuous camera without changing their map coordinates',()=>{
  const tiles=[{x:1,y:0,dist:1},{x:2,y:0,dist:2},{x:3,y:0,dist:3},{x:4,y:0,dist:4}],snapshot=JSON.stringify(tiles);
  const {context:c,actor}=viewingHarness(tiles),occupied=new Set();
  assert.equal(c.buildPartyNpcGoalTile(actor,occupied,0).x,3);
  c.playerPosX=.9;
  assert.equal(c.buildPartyNpcGoalTile(actor,occupied,0).x,4,'Three cells is not three paces when the camera is at a cell edge');
  assert.equal(actor.mazeX,1,'Goal selection never teleports or visually displaces the actor');
  assert.equal(JSON.stringify(tiles),snapshot);
});

test('companion spacing respects occupied tiles and permits tight-corridor fallbacks',()=>{
  const tiles=[{x:1,y:0,dist:1},{x:2,y:0,dist:2}],{context:c,actor}=viewingHarness(tiles),occupied=new Set(['2,0']);
  assert.equal(c.buildPartyNpcGoalTile(actor,occupied,0).x,1,'A close safe tile beats an occupied distant tile');
  occupied.add('1,0');assert.equal(c.preferPartyViewingTiles(tiles,occupied).length,0);
  assert.equal(c.buildPartyNpcGoalTile(actor,occupied,0).x,actor.mazeX,'No safe tile leaves the companion where it is');
});

test('speaking companions use the same viewing spacing while combat movement remains authoritative',()=>{
  const tiles=[{x:1,y:0,dist:1},{x:2,y:0,dist:2},{x:3,y:0,dist:3},{x:4,y:0,dist:4}],{context:c,actor}=viewingHarness(tiles);
  c.playerPosX=.9;c.window.focusDungeonSpeaker(actor.name,5000);
  assert.equal(actor._conversationGoal.x,4,'A speaker must not move into an oversized one-tile close-up');
  const goal=actor._conversationGoal;c.isCombatRoundActive=()=>true;c.playerPosX=.5;
  c.window.focusDungeonSpeaker(actor.name,5000);assert.equal(actor._conversationGoal,goal,'Dialogue cannot overwrite a combat movement goal');
});

test('farther-away party spawns remain in the original floor band and reuse valid existing anchors',()=>{
  const tiles=[{x:1,y:0,dist:1},{x:2,y:0,dist:2},{x:3,y:0,dist:3}],{context:c,actor}=viewingHarness(tiles);
  const source=fs.readFileSync('assets/game.js','utf8');
  Object.assign(c,{MAX_STEP:1.5,shouldUsePartyMazeAnchors:()=>true,isDungeonActorPresent:()=>true,
    isSpawnBlockedCell:cell=>cell.tile!=='floor',ensureMonsterSpriteData(){}});
  c.currentDungeon.cells=Object.fromEntries([0,1,2,3].map(x=>[`${x},0`,{tile:'floor',floorHeight:x===2?3:x===1?1.5:0}]));
  vm.runInNewContext(source.slice(source.indexOf('function ensurePartyMazeAnchors('),source.indexOf('function syncPartyMazeToCombatPositions(')),c);
  c.ensurePartyMazeAnchors();assert.equal(actor.mazeX,3,'A distant compatible floor wins over a raised terrace');
  const original={x:actor.mazeX,y:actor.mazeY};c.playerPosX=3.4;
  c.ensurePartyMazeAnchors();assert.deepEqual({x:actor.mazeX,y:actor.mazeY},original,'Valid anchors never teleport to maintain camera spacing');
});
