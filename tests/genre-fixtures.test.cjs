'use strict';
process.env.HOLODEK_GENRE_EXPANSION='1';process.env.HOLODEK_ARCHITECTURE_EXPANSION='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../assets/genreFixtures'),K=require('../assets/genreKits'),L=require('../assets/genreLights');
const Policy=require('../retort/genreAssetPolicy'),Layer=require('../retort/genreLayer'),{createCanvas}=require('canvas');

test('54 approved native fixtures have real voxel bodies, bright cores, colors and light behaviors',()=>{
  assert.equal(Object.keys(F.SHAPES).length,54);
  const images=new Set();
  for(const [id,info] of Object.entries(F.SHAPES)){
    const catalog=Policy.catalog({}, {kind:'homebrew',seed:'fixtures',genres:[info.genre]});
    assert.ok(catalog.shapes.includes(id),id);assert.ok(catalog.lights.includes(info.lightType),id);
    assert.deepEqual(K.build(id,24),F.build(id,24));assert.ok(K.emissive(id));
    let bright=0,body=0;
    const voxels=F.build(id,24);
    for(let z=0;z<24;z++)for(let y=0;y<24;y++)for(let x=0;x<24;x++)if(voxels[x+y*24+z*24*24]){
      const color=K.color(id,(x+.5)/24,(y+.5)/24,(z+.5)/24,[0,0,1]);
      if(Math.max(...color)>.65)bright++;else body++;
    }
    assert.ok(bright>10,id+' luminous core');assert.ok(body>10,id+' non-emissive frame');
    const canvas=createCanvas(96,96);assert.ok(K.paint(canvas.getContext('2d'),id,0,0,96,96));
    images.add(canvas.toDataURL());
    const light=L.light(info.lightType,1,2,1.5,.4,1234,6);
    assert.equal(light.color,info.color);assert.ok(light.intensity>.8&&light.radius>5);
    assert.equal(L.emission({voxelShape:id}).type,light.lightType);
  }
  assert.equal(images.size,54,'Not one recolored placeholder sprite');
});

test('all genres preserve mounted collision and remain idempotent; fantasy families retain native flames',()=>{
  for(const genre of Object.keys(F.THEMES)){
    const d={geoKey:'0,0,0',cells:{'1,1':{tile:'torch',blocked:true,ceilHeight:3}},tiles:{torch:{url:'old'}}};
    const before=JSON.stringify(d.cells),setting={kind:'homebrew',seed:'fixtures',genres:[genre]};
    if(['fantasy','dark-fantasy'].includes(genre)){
      const snapshot=JSON.stringify(d);assert.equal(Layer.fixtures(d,{name:'Arrival'},{setting}).changed,0);
      assert.equal(JSON.stringify(d),snapshot,'Native flame graphics and wall collision stay untouched');continue;
    }
    assert.equal(Layer.fixtures(d,{name:'Arrival'},{setting}).changed,1);
    assert.equal(Layer.fixtures(d,{name:'Arrival'},{setting}).changed,0);
    assert.equal(JSON.stringify(d.cells),before);assert.equal(d.tiles.torch.flame,false);
    assert.ok(F.has(d.tiles.torch.spriteSpec.voxelShape));
  }
});

test('RGB conversion preserves original torch default and does not reparse per pixel',()=>{
  assert.deepEqual(L.rgb({}),[1,190/255,130/255]);
  assert.deepEqual(L.rgb({color:'#00ff80'}),[0,1,128/255]);
  assert.equal(L.rgb({color:'#00ff80'}),L.rgb({color:'#00ff80'}));
});

test('WebGPU light buffer keeps each source color, not a single warm tint for every light',()=>{
  const source=fs.readFileSync(require.resolve('../assets/rendererWebGPU'),'utf8');
  const begin=source.indexOf('    updateTorchFrame(frame) {'),end=source.indexOf('      const rectCount',begin);
  const context={window:{GenreLights:L},TORCH_LIGHT_DEFAULT_COLOR:{r:255,g:190,b:130},TORCH_BUFFER_STRIDE_FLOATS:8};
  vm.runInNewContext('function pack(frame){'+source.slice(begin,end).replace('    updateTorchFrame(frame) {','')+'}',context);
  const target={_torchCapacity:4,_torchCpuData:new Float32Array(32)};
  context.pack.call(target,{lights:[{color:'#00ff00',intensity:1},{color:'#ff0000',intensity:.8}]});
  assert.deepEqual([...target._torchCpuData.slice(5,8)],[0,1,0]);
  assert.deepEqual([...target._torchCpuData.slice(13,16)],[1,0,0]);
});

test('Canvas area lighting honors source radius and colors using the production function',()=>{
  const source=fs.readFileSync(require.resolve('../assets/game'),'utf8');
  const begin=source.indexOf('  function applyTorchLight('),end=source.indexOf('  if (!fullbright) torchLights.push',begin);
  const context={window:{GenreLights:L},fullbright:false,TORCH_LIGHT_RADIUS:6,TORCH_LIGHT_FALLOFF:1,
    TORCH_LIGHT_COLOR:{r:255,g:190,b:130},torchLights:[{x:0,y:0,z:0,radius:3,intensity:1,color:'#00ffff'}]};
  vm.runInNewContext(source.slice(begin,end),context);
  const sample={r:30,g:30,b:30},near=context.applyTorchLight(sample,.1,.5,0,0,{}),far=context.applyTorchLight(sample,.1,4,0,0,{});
  assert.ok(near.g>near.r*2&&near.b>near.r*2);assert.deepEqual({...far},{r:3,g:3,b:3});
});

function webglFrameFixture(lightType) {
  const lights = [], worldPass = new Error('Reached world draw pass');
  const dungeon = { geoKey: '0,0,0', layout: { width: 8, height: 8 },
    classification: { indoor: true }, tiles: { torch: { lightType } },
    cells: { '3,3': { tile: 'floor', floorHeight: 0, ceilHeight: 4 },
      '3,2': { tile: 'torch', floorHeight: 0, ceilHeight: 4, torchFacing: 'N' } } };
  const window = { currentDungeon: dungeon, dungeonTextures: {},
    playerDungeonX: 3, playerDungeonY: 3, playerPosX: 3.5, playerPosY: 3.5,
    playerAngle: -Math.PI / 2, playerZ: .65,
    GenreLights: { ...L, light(...args) { const light = L.light(...args); lights.push(light); return light; } } };
  const popup = { style: { display: 'block' } }, container = { clientWidth: 640, clientHeight: 480 };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/rendererWebGL'), 'utf8'), {
    window, performance: { now: () => 1234 },
    document: { getElementById: id => id === 'dungeon-popup' ? popup : id === 'dungeon-container' ? container : null }
  });
  const renderer = window.webglDungeonRenderer;
  Object.assign(renderer, {
    gl: { bindFramebuffer() { throw worldPass; } }, canvas: { width: 160, height: 120 },
    rebuildDungeonTextures() {}, reportStartupStage() {}, _getVisibleCharacterVoxelActors: () => []
  });
  return { window, dungeon, renderer, lights, worldPass };
}

test('production WebGL reaches the first world draw with every mounted genre fixture', () => {
  for (const [id, info] of Object.entries(F.SHAPES)) {
    const f = webglFrameFixture(info.lightType), before = JSON.stringify(f.dungeon);
    assert.throws(() => f.renderer.renderScene(), error => error === f.worldPass, id);
    assert.equal(f.lights.length, 1, id);
    assert.equal(f.lights[0].color, info.color, id);
    assert.equal(f.lights[0].z, 4 * .55 + (.78 - .5) * 1.3, id + ' light matches sprite mount');
    assert.equal(f.window.playerPosX, 3.5); assert.equal(f.window.playerPosY, 3.5);
    assert.equal(f.window.playerZ, .65); assert.equal(JSON.stringify(f.dungeon), before);
  }
});

test('production WebGL still reaches the first world draw with original fantasy torches', () => {
  const f = webglFrameFixture();
  assert.throws(() => f.renderer.renderScene(), error => error === f.worldPass);
  assert.equal(f.lights.length, 0, 'Original torch flicker uses the existing renderer path');
});
