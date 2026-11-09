'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const H = require('../retort/roomHazards'), V = require('../assets/scenePropVoxels'), I = require('../assets/dungeonInhabitants');
const Ui = require('../assets/roomHazardsUi');
const { ActionDice } = require('../retort/actionDice');
function room(seed = 'hz', size = 40) {
  const d = { layout: { width: size, height: size }, geoKey: '0,0,0', generation: { seed }, start: { x: 5, y: 20 }, cells: {}, tiles: {}, sceneObjects: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d.cells[`${x},${y}`] = { tile: x < 2 || y < 2 || x >= size - 2 || y >= size - 2 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
  return d;
}
const TEXT = {
  collapsing_bridge: 'A rickety rope bridge spans a deep chasm in the middle of the cavern.',
  gas_vent: 'Sulfurous gas vents hiss between the broken columns.',
  unstable_floor: 'The cracked flagstones sag toward the centre of the hall.',
  ward_stone: 'A ward stone carved with glowing runes stands near the far wall.'
};
const tileShape = (d, k) => d.tiles[d.cells[k].tile]?.spriteSpec?.voxelShape;
const EXPANDED={
  burning_ground:'Burning debris covers a section of the trail.',flame_jet:'Flame jets erupt from a fissure.',
  falling_debris:'Falling masonry rains down from the roof.',extreme_heat:'Searing heat rolls from the furnace.',
  freezing_cold:'Freezing winds scour the pass.',lightning_zone:'Electrical arcs leap between damaged conduits.',
  quicksand:'Quicksand fills a low hollow.',slick_ice:'Slick ice covers the paving.',acid_pool:'Acid pools collect beside the vats.',
  geyser:'Boiling geysers erupt beyond the trail.',dense_fog:'Dense fog obscures the broken trail.',
  moving_machinery:'Crushing pistons cross the maintenance lane.',radiation_zone:'A radiation leak contaminates the corridor.',
  volatile_leak:'A flammable gas leak hisses from a ruptured valve.'
};
test('all expanded hazards have visible voxel geometry, viable bypasses and executable crossing checks',()=>{
  for(const[kind,text]of Object.entries(EXPANDED)){
    const d=room(kind),before=H.reach(d,d.start),report=H.install(d,{text,genre:kind==='radiation_zone'?'sci-fi':'fantasy'});
    assert.equal(report.hazards.length,1,kind);const h=report.hazards[0],entry=H.CATALOG[kind];assert.equal(h.kind,kind);
    for(const k of h.keys){assert.equal(tileShape(d,k),entry.shape);assert.ok(V.shapes.includes(entry.shape));assert.ok(V.build(entry.shape,16).some(Boolean));}
    assert.deepEqual([...H.reach(d,d.start)].sort(),[...before].sort(),kind+' blocked a route');
    const [x,y]=h.zone[0].split(',').map(Number),point={x:x+.5,y:y+.5};
    const plan=H.planEnter(d,h.id,'Player',point);assert.equal(plan.check.difficulty,12);
    assert.equal(H.planEnter(d,h.id,'Player',point,point),null,'No repeated damage while staying inside');
    const carefully=H.planAction(d,h.id,'Player','careful',point);H.outcome(d,carefully,null);
    assert.equal(H.planEnter(d,h.id,'Player',point).check.difficulty,8);
    const result=H.outcome(d,H.planEnter(d,h.id,'Player',point),false,{rng:()=>1});
    if(kind==='dense_fog')assert.deepEqual(result.damage,{});else assert.ok(result.damage.Player>0,kind);
    if(entry.rebound)assert.ok(result.relocate.Player,kind+' should force a safe retreat');
    assert.equal(H.planEnter(d,h.id,'Player',point)?.careful||false,false,'Care is consumed by one crossing');
    if(entry.oneShot){assert.equal(h.state,'cleared');assert.equal(Ui.entries(d,[{name:'Player',...point}],new Map()).length,0);}
  }
});
test('optional neutralization clears new hazards persistently; all UI commands resolve to the intended action',()=>{
  for(const[kind,text]of Object.entries(EXPANDED)){
    if(!H.CATALOG[kind].disarmVerb)continue;
    const d=room(kind);H.install(d,{text,genre:kind==='radiation_zone'?'sci-fi':'fantasy'});const h=d.roomHazards.hazards[0];
    const [x,y]=h.keys[0].split(',').map(Number),p={x:x+.5,y:y+.5};
    const candidate=Ui.candidates(d,p)[0];assert.deepEqual(H.intent(candidate.command,d),{hazardId:h.id,kind:'disarm'});
    const plan=H.planAction(d,h.id,'Player','disarm',p);assert.ok(plan.check.difficulty>=14);
    const r=H.outcome(d,plan,true);assert.equal(h.state,'cleared');assert.deepEqual(r.damage,{});
    for(const k of h.keys)assert.equal(d.cells[k].tile,'floor');
    const saved=JSON.parse(JSON.stringify(d));assert.equal(H.install(saved,{text}).hazards[0].state,'cleared');
    assert.match(Ui.candidates(saved,p)[0].command,/^inspect/);
  }
});
test('negative descriptions and incompatible radiation settings do not manufacture dangers',()=>{
  for(const text of['There is no acid pool here.','The room is without dense fog.','There are no longer flame jets along this path.'])
    assert.deepEqual(H.evidence(text),[],text);
  const d=room();assert.equal(H.install(d,{text:EXPANDED.radiation_zone,genre:'fantasy'}).hazards.length,0);
});
test('saved expanded hazard graphics rebuild without generated image recipes or a model call',()=>{
  const d=room('reload');H.install(d,{text:EXPANDED.acid_pool});const before=JSON.stringify(d);
  require('../saveGameAssets').rebuildRoom(d,d.geoKey,{generateSprite:()=>assert.fail('Inline hazard tiles need no image generation'),sceneGraphics:()=>{}});
  assert.equal(JSON.stringify(d),before);
});
test('expanded hazard footprint never occupies a quest item, stair, service counter or secret-room reward',()=>{
  const d=room('protected');
  for(let x=5;x<30;x++){d.cells[`${x},12`].exit='north';d.cells[`${x},13`].puzzleFixture={};d.cells[`${x},14`].secretChamber=true;
    d.sceneObjects.push({x,y:15,name:'quest object'});d.cells[`${x},16`].interactable=true;}
  const before=JSON.parse(JSON.stringify(d.cells));H.install(d,{text:EXPANDED.acid_pool});
  for(const h of d.roomHazards.hazards)for(const k of h.keys){assert.ok(!before[k].exit&&!before[k].puzzleFixture&&!before[k].secretChamber&&!before[k].interactable);
    assert.ok(!d.sceneObjects.some(o=>`${o.x},${o.y}`===k));}
  assert.equal(d.roomHazards.hazards.length,1);
});
test('description evidence selects only supported hazards; plain rooms still meet the indoor quota', () => {
  for (const [kind, text] of Object.entries(TEXT)) assert.deepEqual(H.evidence(text).map(e => e.kind), [kind], text);
  assert.deepEqual(H.evidence('A quiet library of oak shelves and reading desks.'), []);
  assert.deepEqual(H.evidence('A narrow bridge of memories crosses a chasm of despair.'), [], 'figurative chasm is not a ravine');
  // Spawning is quota driven: no evidence still yields at least one plausible hazard indoors.
  const d = room('plain'); d.geoKey = '4,1,0'; d.classification = { indoor: true, biome: 'temple' };
  d.sceneSpec = { indoor: true, source: { roomName: 'Hall', description: 'A quiet hall with tapestries.' } };
  const draft = H.requiredDraft(d).roomHazards;
  assert.ok(draft.hazards.length >= 1, 'indoor rooms carry at least one hazard'); assert.equal(draft.quota.indoor, true);
  assert.deepEqual(H.requiredDraft(structuredClone(d)).roomHazards.hazards.map(h => h.keys), draft.hazards.map(h => h.keys), 'stable per seed');
});
test('each hazard compiles into real voxel cells that keep every route open', () => {
  for (const [kind, text] of Object.entries(TEXT)) {
    const d = room(kind), before = H.reach(d, d.start), report = H.install(d, { text });
    assert.equal(report.hazards.length, 1, kind); const h = report.hazards[0];
    assert.equal(h.kind, kind); assert.ok(h.evidence.length > 3);
    for (const k of h.keys) {
      const shape = tileShape(d, k); assert.equal(kind === 'collapsing_bridge' && h.axis === 'y' ? shape.replace(/_y$/, '') : shape, H.SHAPES[kind], `${kind} voxel at ${k}`);
      assert.ok(V.shapes.includes(shape)); assert.ok(V.build(shape, 16).some(Boolean), 'shape has voxels');
      assert.equal(d.cells[k].hazardId, h.id);
      assert.ok(d.tiles[d.cells[k].tile].url.startsWith('data:image/svg+xml'), '2D map sprite');
    }
    if (kind === 'collapsing_bridge') {
      // Indoors the chasm is a rift spanning the whole room; the long bridge is the only way across.
      assert.ok(h.rift, 'room-wide rift'); assert.ok(h.keys.length >= 4, 'long bridge'); assert.ok(h.gap.length >= 100, 'rift spans the room');
      assert.equal(tileShape(d, h.keys[0]), h.axis === 'y' ? 'hazard_bridge_y' : 'hazard_bridge');
      for (const k of h.gap) { assert.ok(d.cells[k].floorHeight <= -12, 'deep chasm'); assert.equal(I.walkable(d, ...k.split(',').map(Number)), false); }
      for (const k of h.keys) assert.ok(I.walkable(d, ...k.split(',').map(Number)), 'bridge planks are walkable');
      const cut = structuredClone(d); for (const k of h.keys) cut.cells[k] = { ...cut.cells[k], feature: 'hazard' };
      const [fx, fy] = h.ends[1].split(',').map(Number), far = H.reach(d, d.start);
      assert.ok(far.has(h.ends[1]) && far.has(h.ends[0]), 'both rims reachable over the bridge');
      assert.ok(!H.reach(cut, d.start).has(h.ends[1]) || !H.reach(cut, d.start).has(h.ends[0]), 'without the bridge the room is split in half');
      assert.ok(Number.isFinite(fx + fy));
    }
    if (kind === 'ward_stone') { const [x, y] = h.keys[0].split(',').map(Number); assert.equal(I.walkable(d, x, y), false, 'standing stone blocks'); }
    const after = H.reach(d, d.start), lost = [...before].filter(k => !after.has(k) && !h.gap.includes(k) && !(h.rift?.decor || []).includes(k) && !(kind === 'ward_stone' && h.keys.includes(k)));
    assert.deepEqual(lost, [], kind + ' cut a route');
  }
});
test('placement is capped per room and deterministic', () => {
  const text = Object.values(TEXT).join(' ');
  const a = room('cap'), b = room('cap');
  assert.equal(H.install(a, { text }).hazards.length, H.MAX_PER_ROOM);
  H.install(b, { text });
  assert.deepEqual(a.roomHazards.hazards.map(h => h.keys), b.roomHazards.hazards.map(h => h.keys));
});
test('per-genre flavour stays in genre', () => {
  const d = room('tech'); H.install(d, { text: 'Plasma vents leak across the buckled deck plating.', genre: 'sci-fi' });
  const labels = d.roomHazards.hazards.map(h => h.label);
  assert.ok(labels.includes('ruptured plasma vent') && labels.includes('buckled deck plating'), labels.join());
  assert.equal(d.tiles.custom_hazard_vent.spriteSpec.material, 'metal');
  const f = room('fan'); H.install(f, { text: TEXT.gas_vent, genre: 'fantasy' });
  assert.equal(f.roomHazards.hazards[0].label, 'sulfur gas vent');
});
test('failed footing collapses the floor voxels into a real pit, adds debris and persists', () => {
  const d = room('floor'); H.install(d, { text: TEXT.unstable_floor });
  const h = d.roomHazards.hazards[0], k = h.keys[0], [x, y] = k.split(',').map(Number);
  const plan = H.planEnter(d, h.id, 'Benedict', { x: x + .5, y: y + .5 }, { x: x - 1, y });
  assert.equal(plan.check.label, 'Keep Footing'); assert.equal(plan.check.difficulty, 12);
  const result = H.outcome(d, plan, false, { rng: () => 3 });
  assert.equal(result.damage.Benedict, 4, '1d6+1 falling damage');
  for (const key of h.keys) {
    assert.equal(d.cells[key].floorHeight, -H.PIT_DEPTH); assert.equal(d.cells[key].hazardGap, true);
    assert.equal(tileShape(d, key), 'hazard_debris', 'debris voxels in the pit');
    assert.equal(I.walkable(d, ...key.split(',').map(Number)), false, 'pathing and collision respect the hole');
  }
  assert.equal(h.state, 'collapsed'); assert.ok(result.relocate.Benedict, 'actor climbs out at a safe tile');
  assert.ok(I.walkable(d, result.relocate.Benedict.x, result.relocate.Benedict.y));
  assert.equal(H.hazardAt(d, x + .5, y + .5).length, 0, 'collapsed hazard no longer triggers');
  const db = { '0,0,0': { name: 'Hall' } }; let s = JSON.stringify(db);
  H.persist({ getRoomNameDatabase: () => s, setRoomNameDatabase: v => s = v }, d);
  assert.equal(JSON.parse(s)['0,0,0'].roomHazards.hazards[0].state, 'collapsed');
  assert.equal(JSON.parse(H.preserve(s, JSON.stringify(db)))['0,0,0'].roomHazards.hazards[0].state, 'collapsed');
});
test('a failed balance check snaps a plank, drops the crosser deep into the rift and hauls them back without a softlock', () => {
  const d = room('bridge'); H.install(d, { text: TEXT.collapsing_bridge });
  const h = d.roomHazards.hazards[0], k = h.keys[1], [x, y] = k.split(',').map(Number), shape = tileShape(d, k), dc = h.check.dc;
  const result = H.outcome(d, H.planEnter(d, h.id, 'Iris', { x: x + .5, y: y + .5 }), false, { rng: () => 2 });
  assert.equal(result.damage.Iris, 4, '2d6 fall');
  assert.equal(tileShape(d, k), shape.replace('hazard_bridge', 'hazard_bridge_broken'), 'broken plank voxels');
  assert.ok(I.walkable(d, x, y), 'ropes and stringer still carry a careful crosser: the only path never closes');
  const fall = result.effects.find(e => e.type === 'fall'); assert.ok(fall.depth >= 12 && fall.landing <= -12, 'deep fall for the camera');
  assert.equal(fall.pulledUp, true); assert.ok(h.ends.includes(`${result.relocate.Iris.x},${result.relocate.Iris.y}`), 'back on a rim');
  assert.ok(h.check.dc > dc, 'the broken span is harder');
  const ok = room('bridge'); H.install(ok, { text: TEXT.collapsing_bridge });
  const s = H.outcome(ok, H.planEnter(ok, ok.roomHazards.hazards[0].id, 'Iris', { x: x + .5, y: y + .5 }), true);
  assert.deepEqual(s.damage, {}); assert.equal(tileShape(ok, k), shape);
});
test('rope rails run along the span axis in voxels and 2D tiles for both orientations', () => {
  const rails = shape => { const g = V.build(shape, 16), n = 16, out = { x: 0, y: 0 };
    // Rails are the high voxel runs; measure how far they stretch along each axis.
    let xs = new Set(), ys = new Set();
    for (let z = Math.floor(n * .6); z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[x + y * n + z * n * n]) { xs.add(x); ys.add(y); }
    out.x = xs.size; out.y = ys.size; return out; };
  const ax = rails('hazard_bridge'), ay = rails('hazard_bridge_y');
  assert.ok(ax.x > ax.y, 'x-span rails run along x: ' + JSON.stringify(ax));
  assert.ok(ay.y > ay.x, 'y-span rails run along y: ' + JSON.stringify(ay));
  const seen = new Set();
  for (const [w, hh, sx, sy] of [[60, 30, 5, 15], [30, 60, 15, 5], [40, 40, 5, 20], [40, 40, 20, 5]]) {
    const d = room('orient'); d.layout = { width: w, height: hh }; d.start = { x: sx, y: sy }; d.cells = {};
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) d.cells[`${x},${y}`] = { tile: x < 2 || y < 2 || x >= w - 2 || y >= hh - 2 ? 'wall' : 'floor', floorHeight: 0, ceilHeight: 3 };
    H.install(d, { text: TEXT.collapsing_bridge }); const h = d.roomHazards.hazards[0];
    const pts = h.keys.map(k => k.split(',').map(Number)), along = new Set(pts.map(p => p[0])).size > 1 ? 'x' : 'y';
    assert.equal(h.axis, along, 'axis matches the span'); seen.add(along);
    for (const k of h.keys) assert.equal(tileShape(d, k), along === 'x' ? 'hazard_bridge' : 'hazard_bridge_y');
    const svg = decodeURIComponent(d.tiles[d.cells[h.keys[0]].tile].url.replace(/^data:image\/svg\+xml[^,]*,/, ''));
    const rects = [...svg.matchAll(/<rect x='([\d.]+)' y='([\d.]+)' width='([\d.]+)' height='([\d.]+)'/g)].map(m => m.slice(1).map(Number));
    const rails = rects.filter(([, , w, hgt]) => (w >= 60 && hgt <= 4) || (hgt >= 60 && w <= 4));
    assert.equal(rails.length, 2, 'two rope rails in the 2D tile');
    for (const [, , rw, rh] of rails) assert.equal(rw > rh, along === 'x', '2D rails follow the span');
  }
  assert.deepEqual([...seen].sort(), ['x', 'y'], 'both span orientations covered');
});
test('gas and ward hazards apply automatic damage without a check; careful/dispel are optional clicks', () => {
  const d = room('gas'); H.install(d, { text: TEXT.gas_vent });
  const h = d.roomHazards.hazards[0], [x, y] = h.zone[0].split(',').map(Number);
  const plan = H.planEnter(d, h.id, 'Benedict', { x: x + .5, y: y + .5 });
  assert.equal(plan.check, null, 'no roll for walking through active fumes');
  assert.equal(H.outcome(d, plan, null, { rng: () => 4 }).damage.Benedict, 4);
  const near = { x: x + .5, y: y + .5 };
  H.outcome(d, H.planAction(d, h.id, 'Benedict', 'careful', near), null);
  assert.deepEqual(H.outcome(d, H.planEnter(d, h.id, 'Benedict', near), null).damage, {}, 'held breath');
  const seal = H.planAction(d, h.id, 'Benedict', 'disarm', near);
  assert.equal(seal.check.difficulty, 13);
  H.outcome(d, seal, true); assert.equal(h.state, 'sealed'); assert.equal(tileShape(d, h.keys[0]), 'hazard_vent_sealed');
  const w = room('ward'); H.install(w, { text: TEXT.ward_stone });
  const ward = w.roomHazards.hazards[0], [wx, wy] = ward.zone[0].split(',').map(Number);
  const pulse = H.outcome(w, H.planEnter(w, ward.id, 'Iris', { x: wx + .5, y: wy + .5 }), null, { rng: () => 5 });
  assert.equal(pulse.damage.Iris, 5); assert.equal(w.roomHazards.alarm, true);
  assert.equal(H.planAction(w, ward.id, 'Iris', 'disarm', { x: 30, y: 30 }).error.startsWith('Walk closer'), true);
  assert.deepEqual(H.intent('dispel the ward stone', w), { hazardId: ward.id, kind: 'disarm' });
  assert.deepEqual(H.intent('test the cracked flagstones', w), null);
});
test('walking in triggers once on entry for the player and party NPCs; staying inside does not retrigger', () => {
  const d = room('ui'); H.install(d, { text: TEXT.unstable_floor });
  const h = d.roomHazards.hazards[0], [x, y] = h.keys[0].split(',').map(Number), mem = new Map();
  assert.deepEqual(Ui.entries(d, [{ name: 'Benedict', x: x - .5, y: y + .5 }, { name: 'Iris', x: x - .5, y: y + 1.5 }], mem), []);
  const hits = Ui.entries(d, [{ name: 'Benedict', x: x + .5, y: y + .5 }, { name: 'Iris', x: x + .5, y: y + 1.5 }], mem);
  assert.deepEqual(hits.map(h => h.actor), ['Benedict', 'Iris']);
  assert.deepEqual(Ui.entries(d, [{ name: 'Benedict', x: x + 1.5, y: y + .5 }], mem), [], 'moving within the patch is not a new entry');
  const click = Ui.candidates(d, { x: x - .5, y: y + .5 })[0];
  assert.equal(click.command, 'test the cracked flagstones'); assert.equal(click.enabled, true);
  assert.deepEqual(H.intent(click.command, d), { hazardId: h.id, kind: 'careful' });
});
function outdoor(profile, seed = 'canyon', size = 72) {
  const d = room(seed, size); d.geoKey = '3,2,0'; d.start = { x: 6, y: size / 2 }; d.classification = { indoor: false, biome: profile };
  d.sceneSpec = { indoor: false, source: { roomName: 'Pass', description: 'A rope bridge spans a deep canyon.' } }; d.outdoorTerrain = { profile };
  for (const c of Object.values(d.cells)) if (c.tile === 'wall') c.tile = 'floor';
  for (let y = 0; y < size; y++) for (const x of [0, size - 1]) d.cells[`${x},${y}`].tile = 'wall';
  for (let x = 0; x < size; x++) for (const y of [0, size - 1]) d.cells[`${x},${y}`].tile = 'wall';
  return d;
}
test('outdoor canyons and bridges take their materials from the current biome and genre', () => {
  const seen = {};
  for (const [profile, genre, style, floor] of [['forest', 'fantasy', 'rope', 'river'], ['badlands', 'fantasy', 'bleached', 'scree'],
    ['glacial', 'fantasy', 'iced', 'ice'], ['volcanic', 'fantasy', 'charred', 'lava'], ['badlands', 'sci-fi', 'gantry', 'scree']]) {
    const d = outdoor(profile); H.install(d, { text: 'A rope bridge spans a deep canyon.', genre });
    const h = d.roomHazards.hazards.find(z => z.kind === 'collapsing_bridge'); assert.ok(h?.rift, profile + ' canyon');
    assert.equal(h.rift.bridgeStyle, style, profile + '/' + genre); assert.equal(h.rift.floor, floor); assert.equal(h.rift.outdoor, true);
    assert.ok(h.rift.width >= 8 && h.rift.depth >= 30, 'vast and deep'); assert.ok(h.gap.every(k => d.cells[k].floorHeight <= -30));
    const bridge = d.tiles[d.cells[h.keys[0]].tile].spriteSpec, cliffKey = h.gap.find(k => d.cells[k].tile === 'custom_hazard_cliff');
    assert.ok(cliffKey, 'cliff walls'); const cliff = d.tiles.custom_hazard_cliff.spriteSpec;
    assert.equal(bridge.material, style === 'gantry' ? 'metal' : 'wood');
    seen[profile + genre] = JSON.stringify([bridge.palette, cliff.palette]);
    const sag = h.keys.map(k => d.cells[k].floorHeight); assert.ok(Math.min(...sag) < 0, 'suspension bridge sags');
    assert.ok(H.reach(d, d.start).has(h.ends[1]), 'far rim reachable across the bridge');
  }
  assert.equal(new Set(Object.values(seen)).size, 5, 'each biome/genre has its own canyon and bridge materials');
  const flat = outdoor('flat'); H.install(flat, { text: 'A rope bridge spans a deep canyon.' });
  assert.ok(!flat.roomHazards.hazards.some(z => z.rift), 'flat terrain has no relief for a canyon');
  const plain = outdoor('flat'); plain.sceneSpec.source.description = 'Open grassland under a wide sky.';
  assert.ok(!H.eligibleKinds(plain, 'fantasy').includes('collapsing_bridge'), 'no canyon hazard drafted on flat ground');
  const hills = outdoor('badlands'); hills.sceneSpec.source.description = 'Open scrub under a wide sky.';
  assert.ok(H.eligibleKinds(hills, 'fantasy').includes('collapsing_bridge'), 'relief terrain can draft a canyon without evidence');
});
test('quota hazards keep exits reachable and never land on exits; finalized rooms (where combat happens) get no new hazards', async () => {
  const A = require('../retort/roomHazardAuthoring');
  for (const [indoor, n] of [[true, 0], [true, 1], [false, 2], [false, 3]]) {
    const d = indoor ? room('exits-' + n) : outdoor('badlands', 'exits-' + n, 48); d.geoKey = '5,' + n + ',0';
    if (indoor) { d.classification = { indoor: true, biome: 'ruins' }; d.sceneSpec = { indoor: true, source: { roomName: 'Hall', description: 'An old hall.' } }; }
    const exits = indoor ? ['20,2', '37,20'] : ['24,1', '46,24'];
    for (const k of exits) { d.cells[k] = { ...d.cells[k], tile: 'door', exit: 'north', door: { isOpen: true } }; }
    const draft = H.requiredDraft(d), r = draft.roomHazards, reach = H.reach(draft, draft.start);
    assert.ok(indoor ? r.hazards.length >= 1 : r.hazards.length >= 2 && r.hazards.length <= 5, 'quota');
    for (const h of r.hazards) for (const k of [...h.keys, ...h.zone, ...h.gap]) assert.ok(!exits.includes(k), 'hazard on an exit');
    const near = k => { const [x, y] = k.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${x + dx},${y + dy}`)); };
    for (const k of exits) assert.ok(reach.has(k) || near(k), 'exit ' + k + ' still reachable');
  }
  const busy = room('combat-room'); busy.geoKey = '7,7,0'; busy._geometryStamp = 'finalized';
  await A.prepare(null, busy, { author: () => assert.fail('No hazard authoring for a finalized room') });
  assert.equal(busy.roomHazards, undefined, 'no hazards appear in a room already in play');
});
test('client: the auto-roll spins on the portrait first, then the world change lands and the first-person fall plays', () => {
  const g = globalThis, saved = ['receiveDiceState', 'actionDiceState', 'applyLivingEnvironmentDelta', 'combatCharacters', 'applyHazardRelocate', 'playerZ'].map(k => [k, g[k]]);
  try {
    const states = [], applied = [], moved = [];
    g.actionDiceState = { revision: 4, results: [] }; g.receiveDiceState = next => { states.push(next); g.actionDiceState = next; };
    g.applyLivingEnvironmentDelta = data => applied.push(data); g.applyHazardRelocate = r => moved.push(r);
    g.combatCharacters = [{ name: 'Iris', type: 'pc' }, { name: 'Orren', type: 'npc' }]; g.playerZ = .65;
    const d = room('client'); H.install(d, { text: TEXT.collapsing_bridge }); const h = d.roomHazards.hazards[0], k = h.keys[1];
    const dice = { id: 'roll-1', actor: 'Iris', label: 'Keep Balance', sides: 20, natural: 2, modifier: 0, total: 2, difficulty: 11, success: false };
    const data = { geoKey: d.geoKey, hazardEvent: { dice, relocate: { Iris: { x: 1, y: 1 }, Orren: { x: 2, y: 2 } },
      effects: [{ type: 'collapse', keys: [k], keep: true }, { type: 'fall', actor: 'Iris', key: k, depth: 14, landing: -14, fog: '#07080a' }] } };
    assert.equal(Ui.hold(d, data), true, 'world change waits for the die');
    assert.equal(states.length, 1); assert.equal(states[0].type, 'dice_state'); assert.equal(states[0].revision, 4);
    assert.deepEqual(states[0].results.at(-1), dice, 'portrait slot gets the roll to animate');
    assert.equal(applied.length, 0); Ui.flush(); assert.equal(applied.length, 1); assert.equal(applied[0]._hazardReleased, true);
    assert.equal(Ui.hold(d, applied[0]), false, 'released change applies normally');
    Ui.begin(d, data); assert.equal(Ui.falling(), true); assert.equal(Ui.active(d), true);
    assert.deepEqual(Ui.relocateNow(d, data), { Orren: { x: 2, y: 2 } }, 'the crosser moves only after the fall');
    const t0 = Date.now(), z = [0, .25, .5, .75, .99].map(q => Ui.camera(t0 + q * Ui.DROP_MS).eyeZ);
    for (let i = 1; i < z.length; i++) assert.ok(z[i] < z[i - 1], 'eye keeps dropping');
    assert.ok(z[1] - z[2] < z[3] - z[4], 'the drop accelerates'); assert.ok(z[4] < -12, 'deep into the chasm');
    const land = Ui.camera(t0 + Ui.DROP_MS + 40); assert.ok(Math.abs(land.dx) + Math.abs(land.dy) > .5, 'tumbled off the side of the span');
    assert.equal(Ui.camera(t0 + Ui.DROP_MS + Ui.LAND_MS + Ui.RISE_MS + 10), null, 'fall ends');
    assert.equal(Ui.falling(), false); assert.deepEqual(moved, [{ Iris: { x: 1, y: 1 } }], 'hauled back to the rim');
  } finally { for (const [k, v] of saved) g[k] = v; }
});
// The server orchestration from retortWithUserInput.js, run against the real ActionDice.
function server(dungeon, { natural = 3, pause = false } = {}) {
  const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('// Environmental hazards (exploration only'), end = source.indexOf('let combatSpace = null;', start);
  assert.ok(start > 0 && end > start);
  assert.ok(!source.slice(start, end).includes('combatSpace') && !source.slice(start, end).includes('applyCombatDamage'), 'hazard code never touches combat');
  let stored = JSON.parse(JSON.stringify(dungeon)), roster = JSON.stringify([{ name: 'Benedict', type: 'pc' }, { name: 'Iris', type: 'npc' }]);
  let db = JSON.stringify({ '0,0,0': { name: 'Hall' } }), console_ = 'HP: 10';
  const events = [], damage = [], publishes = [];
  const dice = new ActionDice({ random: () => natural, animationMs: 0 });
  const realPublish = dice.publish.bind(dice); dice.publish = () => { publishes.push(dice.pending ? 'pending' : dice.active ? 'active' : 'idle'); realPublish();
    if (dice.pending) { const q = dice.pending.request; setImmediate(() => { if (dice.pending?.request.id === q.id) dice.submit(q.id, q.actionId, q.geoKey); }); } };
  const sharedState = { getLastCoords: () => ({ x: 0, y: 0, z: 0 }), getRoomDungeon: () => JSON.parse(JSON.stringify(stored)),
    setRoomDungeon: (_, d) => { stored = d; }, getCombatCharactersString: () => roster, setCombatCharactersString: v => { roster = v; },
    getRoomNameDatabase: () => db, setRoomNameDatabase: v => { db = v; }, getUpdatedGameConsole: () => console_, getDungeonRunId: () => 'run' };
  H.settings.pauseRolls = pause;
  const ctx = { roomHazardResolver: null, roomHazardQueue: Promise.resolve(), sharedState, actionDice: dice, RoomHazards: H, broadcast: e => events.push(e), JSON, Object, Promise, Math, console: { info() {}, warn() {} },
    ActionFeedback: { publish: (b, s, n) => events.push({ type: 'action_notice', ...n }) },
    require: m => m === './dungeonReach' ? { position: a => a.at || null } : require(m),
    finalizeRoomDungeon: (k, d) => ({ ...d, _geometryStamp: 'stamp:' + (d.roomHazards?.revision ?? 0) }),
    prepareEnvironmentalSurvival: async () => {}, processGameUpdate: (o, text) => { damage.push(o.trap_damage); return text; },
    updatedGameConsole: console_, CombatLife: undefined };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.resolveRoomHazard = resolveRoomHazardLocal; this.tryRoomHazardAction = tryRoomHazardAction;', ctx);
  return { ctx, dice, events, damage, publishes, stored: () => stored };
}
const toasts = s => s.events.filter(e => e.type === 'action_notice' && e.kind === 'hazard-roll');
test('auto-trigger without a check applies damage immediately with no dice pause', async () => {
  const d = room('srv-gas'); H.install(d, { text: TEXT.gas_vent });
  const h = d.roomHazards.hazards[0], [x, y] = h.zone[0].split(',').map(Number);
  const s = server(d);
  const r = await s.ctx.resolveRoomHazard({ kind: 'enter', hazardId: h.id, actor: 'Benedict', to: { x: x + .5, y: y + .5 } });
  assert.equal(r.rolled, false); assert.equal(s.publishes.length, 0, 'the dice UI never opened'); assert.equal(toasts(s).length, 0);
  assert.equal(s.dice.active, null); assert.ok(s.damage[0].Benedict >= 1 && s.damage[0].Benedict <= 4, 'trap damage path');
});
test('default: a hazard check auto-rolls with a dice toast and no pause, then mutates voxels on failure', async () => {
  const d = room('srv-floor'); H.install(d, { text: TEXT.unstable_floor });
  const h = d.roomHazards.hazards[0], [x, y] = h.keys[0].split(',').map(Number);
  const s = server(d, { natural: 2 });
  const r = await s.ctx.resolveRoomHazard({ kind: 'enter', hazardId: h.id, actor: 'Benedict', to: { x: x + .5, y: y + .5 }, from: { x: x - 1, y } });
  assert.equal(r.rolled, true); assert.equal(r.paused, false); assert.match(r.content, /Keep Footing: d20 2 vs DC 12/);
  assert.equal(s.publishes.length, 0, 'no dice prompt, travel never paused'); assert.equal(s.dice.active, null);
  const t = toasts(s); assert.equal(t.length, 1); assert.match(t[0].message, /d20 2 = 2 vs DC 12: fail/); assert.equal(t[0].dice.success, false);
  const update = s.events.find(e => e.type === 'dungeonCellUpdate');
  for (const k of h.keys) { assert.equal(update.cells[k].floorHeight, -H.PIT_DEPTH); assert.equal(s.stored().cells[k].tile, 'custom_hazard_debris'); }
  assert.ok(s.damage[0].Benedict > 0); assert.ok(update.hazardEvent.relocate.Benedict);
  assert.ok(JSON.parse(s.ctx.sharedState.getRoomNameDatabase())['0,0,0'].roomHazards, 'persisted to room state');
});
test('with "Pause on hazard rolls" on, the PC check pauses once in the shared dice prompt', async () => {
  const d = room('srv-ward'); H.install(d, { text: TEXT.ward_stone });
  const h = d.roomHazards.hazards[0], [x, y] = h.zone[0].split(',').map(Number);
  const s = server(d, { natural: 18, pause: true });
  s.ctx.sharedState.setCombatCharactersString(JSON.stringify([{ name: 'Benedict', type: 'pc', at: { x: x + .5, y: y + .5 } }]));
  const r = await s.ctx.tryRoomHazardAction('dispel the ward stone');
  assert.match(r.content, /Dispel Ward: d20 18 vs DC 14/); assert.equal(r.paused, true);
  assert.equal(s.publishes.filter(p => p === 'pending').length, 1, 'the PC roll opened the dice prompt once');
  assert.equal(toasts(s).length, 0); assert.equal(s.dice.active, null, 'play resumes after the roll');
  assert.equal(s.stored().cells[h.keys[0]].tile, 'custom_hazard_ward_stone_dormant');
  assert.equal(await s.ctx.resolveRoomHazard({ kind: 'enter', hazardId: h.id, actor: 'Benedict', to: { x: x + .5, y: y + .5 } }), null, 'a dormant ward no longer pulses');
  H.settings.pauseRolls = false;
});
test('a successful bridge roll keeps every bridge voxel intact and the crosser unharmed', async () => {
  const d = room('srv-bridge'); H.install(d, { text: TEXT.collapsing_bridge });
  const h = d.roomHazards.hazards.find(z => z.kind === 'collapsing_bridge'), before = JSON.stringify(h.keys.map(k => d.cells[k]));
  const [x, y] = h.keys[0].split(',').map(Number);
  const s = server(d, { natural: 15 });
  const r = await s.ctx.resolveRoomHazard({ kind: 'enter', hazardId: h.id, actor: 'Benedict', to: { x: x + .5, y: y + .5 } });
  assert.match(r.content, /crosses safely/); assert.deepEqual(r.damage, {}); assert.deepEqual(r.relocate, {}); assert.equal(s.damage.length, 0);
  assert.equal(JSON.stringify(h.keys.map(k => s.stored().cells[k])), before, 'bridge voxels unchanged');
  assert.ok(s.stored().roomHazards.hazards.find(z => z.id === h.id).check.dc > h.check.dc, 'bridge grows more fragile');
});
test('hazards are ignored while combat is active', async () => {
  const d = room('srv-combat'); H.install(d, { text: TEXT.unstable_floor });
  const h = d.roomHazards.hazards[0], [x, y] = h.keys[0].split(',').map(Number);
  const s = server(d, { natural: 1 }); s.dice.begin('combat', '0,0,0');
  assert.equal(await s.ctx.resolveRoomHazard({ kind: 'enter', hazardId: h.id, actor: 'Benedict', to: { x: x + .5, y: y + .5 } }), null);
  assert.equal(await s.ctx.tryRoomHazardAction('test the cracked floor'), null);
  assert.equal(s.events.length, 0); assert.equal(s.damage.length, 0); assert.equal(s.dice.active.kind, 'combat');
});
