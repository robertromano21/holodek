'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createCanvas } = require('canvas');
const Commands = require('phaser/src/gameobjects/graphics/Commands');
const render = require('phaser/src/gameobjects/graphics/GraphicsCanvasRenderer');
const Matrix = require('phaser/src/gameobjects/components/TransformMatrix');

// Use Phaser's real command builder and Canvas renderer without booting a browser/game.
const graphicsModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('phaser/src/gameobjects/graphics/Graphics'), 'utf8'), {
  module: graphicsModule, require(name) {
    if (name === '../../utils/Class') return function(definition) { return definition; };
    if (name === '../../cameras/2d/BaseCamera') return function() {};
    if (name === './Commands') return Commands;
    return {};
  }
});
const methods = graphicsModule.exports;
function graphics() {
  return Object.assign({}, methods, { commandBuffer: [], x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    alpha: 1, blendMode: 0, scrollFactorX: 1, scrollFactorY: 1,
    setPosition(x, y) { this.x = x; this.y = y; }, setRotation(r) { this.rotation = r; },
    setScale(s) { this.scaleX = this.scaleY = s; }, destroy() {} });
}

function surface(size) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d'), setTransform = ctx.setTransform.bind(ctx);
  ctx.setTransform = (...args) => {
    const m = args[0];
    return args.length === 1 ? setTransform(m.a, m.b, m.c, m.d, m.e, m.f) : setTransform(...args);
  };
  const camera = { alpha: 1, matrix: new Matrix(), scrollX: 0, scrollY: 0, addToRenderList() {} };
  return { canvas, ctx, draw(gfx) { render({ currentContext: ctx, blendModes: ['source-over'], antialias: false }, gfx, camera); } };
}

test('team borders remain visible above oversized first-round avatars without tinting their interiors', () => {
  const ground = surface(100), actors = surface(200), root = { actionDiceState:{active:{kind:'combat'}},combatCharacters: [
    { name: 'Ally', type: 'npc', hp: 10, mazeX: 4, mazeY: 4 },
    { name: 'Enemy', type: 'monster', state: 'Hostile', hp: 10, mazeX: 6, mazeY: 4 }] };
  vm.runInNewContext(fs.readFileSync('assets/combatTacticalUi.js', 'utf8'), { window: root });
  const scene = { PIXEL_SCALE: 2, make: { graphics }, renderRT: ground, actorRT: actors };
  const draw = { centerX: 30, centerY: 50, combatAngle: 0, cs: 15, pos: { x: 4.5, y: 4.5 }, dungeon: { cells: { '4,4': {}, '6,4': {} } } };
  actors.ctx.fillStyle = '#404040'; actors.ctx.fillRect(40, 80, 40, 40); actors.ctx.fillRect(100, 80, 40, 40);
  root.CombatTacticalUi.drawOverlay(scene, draw);
  const composite = surface(200); composite.ctx.drawImage(ground.canvas, 0, 0, 200, 200); composite.ctx.drawImage(actors.canvas, 0, 0);
  const pixel = (x, y) => [...composite.ctx.getImageData(x, y, 1, 1).data];
  assert.deepEqual(pixel(60, 100), [64, 64, 64, 255], 'No team tint over the face/body');
  assert.deepEqual(pixel(60, 87), [103, 213, 239, 255], 'Ally border survives the avatar layer');
  assert.deepEqual(pixel(120, 87), [239, 118, 108, 255], 'Enemy border survives the avatar layer');
});

test('real Phaser Canvas produces visible cyan and pink cells on the first combat paint', () => {
  for (const angle of [0, .7, Math.PI / 2]) {
    const canvas = createCanvas(180, 180), ctx = canvas.getContext('2d');
    const setTransform = ctx.setTransform.bind(ctx);
    ctx.setTransform = (...args) => {
      const m = args[0];
      return args.length === 1 ? setTransform(m.a, m.b, m.c, m.d, m.e, m.f) : setTransform(...args);
    };
    const root = { actionDiceState:{active:{kind:'combat'}},combatCharacters: [{ name: 'PC', type: 'pc', hp: 10, mazeX: 4, mazeY: 4 },
      { name: 'Ally', type: 'npc', hp: 10, mazeX: 4, mazeY: 5 }, { name: 'Enemy', type: 'monster', hp: 10, state: 'Hostile', mazeX: 5, mazeY: 4 }] };
    vm.runInNewContext(fs.readFileSync('assets/combatTacticalUi.js', 'utf8'), { window: root });
    const camera = { alpha: 1, matrix: new Matrix(), scrollX: 0, scrollY: 0, addToRenderList() {} };
    const scene = { make: { graphics }, renderRT: { draw(gfx) { render({ currentContext: ctx, blendModes: ['source-over'], antialias: false }, gfx, camera); } } };
    const draw = { centerX: 80, centerY: 80, combatAngle: angle, cs: 15.625, pos: { x: 4.5, y: 4.5 }, dungeon: { cells: { '4,4': {}, '4,5': {}, '5,4': {} } } };
    root.CombatTacticalUi.drawOverlay(scene, draw);
    const pixels = ctx.getImageData(0, 0, 180, 180).data;
    let cyan = 0, pink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      if (pixels[i + 1] > pixels[i] * 1.4 && pixels[i + 2] > pixels[i] * 1.4) cyan++;
      if (pixels[i] > pixels[i + 1] * 1.4 && pixels[i] > pixels[i + 2] * 1.4) pink++;
    }
    assert.ok(cyan > 30, 'Cyan pixels at rotation ' + angle + ': ' + cyan);
    assert.ok(pink > 15, 'Pink pixels at rotation ' + angle + ': ' + pink);
  }
});

test('team colors are absent during exploration and appear immediately when first-round initiative begins',()=>{
  const ground=surface(100),actors=surface(200),root={combatCharacters:[{name:'Ally',type:'npc',hp:10,mazeX:4,mazeY:4,mazeRoomKey:'X: 873, Y: 473, Z: 0'},
    {name:'Enemy',type:'monster',state:'Hostile',hp:10,mazeX:6,mazeY:4,mazeRoomKey:'X: 873, Y: 473, Z: 0'}]};
  vm.runInNewContext(fs.readFileSync('assets/combatTacticalUi.js','utf8'),{window:root});
  const scene={PIXEL_SCALE:2,make:{graphics},renderRT:ground,actorRT:actors},draw={centerX:30,centerY:50,combatAngle:0,cs:15,pos:{x:4.5,y:4.5},dungeon:{geoKey:'873,473,0',cells:{'4,4':{},'6,4':{}}}};
  root.CombatTacticalUi.drawOverlay(scene,draw);
  assert.ok(!actors.ctx.getImageData(0,0,200,200).data.some((v,i)=>i%4===3&&v>0));
  root.actionDiceState={active:{kind:'combat',phase:'initiative'}};root.CombatTacticalUi.drawOverlay(scene,draw);
  assert.deepEqual([...actors.ctx.getImageData(60,87,1,1).data],[103,213,239,255]);
  assert.deepEqual([...actors.ctx.getImageData(120,87,1,1).data],[239,118,108,255]);
  actors.ctx.clearRect(0,0,200,200);root.actionDiceState={active:null};root.CombatTacticalUi.drawOverlay(scene,draw);
  assert.ok(!actors.ctx.getImageData(0,0,200,200).data.some((v,i)=>i%4===3&&v>0));
});
