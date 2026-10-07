const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../assets/rendererWebGL.js'), 'utf8');

function createRenderer() {
  const context = { window: {}, console, clearTimeout };
  vm.runInNewContext(source, context);
  const renderer = context.window.webglDungeonRenderer;
  const unpack = { flipY: false, premultiplyAlpha: false };
  renderer.gl = {
    UNPACK_FLIP_Y_WEBGL: 'flipY', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'premultiplyAlpha',
    getParameter(parameter) { return unpack[parameter] || false; },
    bindTexture() {},
    pixelStorei(parameter, value) { unpack[parameter] = value; },
    texImage2D(...args) {
      if (args.length === 9 && args[3] > 1 && args[4] > 1) {
        const width = args[3], height = args[4], data = args[8];
        renderer.uploadedCells = new Uint8Array(data.length);
        for (let row = 0; row < height; row++) {
          const sourceRow = unpack.flipY ? height - 1 - row : row;
          renderer.uploadedCells.set(data.subarray(sourceRow * width * 4, (sourceRow + 1) * width * 4), row * width * 4);
        }
      }
    }
  };
  return renderer;
}

function mockReadback(renderer, mirrorRows) {
  const bytes = renderer.sceneCellData;
  Object.assign(renderer.gl, {
    NO_ERROR: 0, FRAMEBUFFER_COMPLETE: 1,
    getUniform() { return 0; },
    createFramebuffer() { return {}; },
    bindFramebuffer() {}, framebufferTexture2D() {}, deleteFramebuffer() {},
    checkFramebufferStatus() { return 1; },
    getError() { return 0; },
    readPixels(x, y, w, h, format, type, output) {
      for (let row = 0; row < h; row++) {
        const sourceRow = mirrorRows ? h - 1 - row : row;
        output.set(bytes.subarray(sourceRow * w * 4, (sourceRow + 1) * w * 4), row * w * 4);
      }
    }
  });
}

function checkSampledCells(renderer, dungeon) {
  // Exercise the row selection configured by both production WebGL passes.
  const passes = [...renderer.renderScene.toString().matchAll(
    /gl\.uniform1i\(this\.(uniformLocations|voxelUniforms)\.flipY,\s*(\d+)\)/g
  )];
  assert.equal(passes.length, 2);
  for (const [, pass, flip] of passes) {
    for (const [key, cell] of Object.entries(dungeon.cells)) {
      const [x, y] = key.split(',').map(Number);
      const row = Number(flip) === 1 ? renderer.gridH - 1 - y : y;
      const index = (row * renderer.gridW + x) * 4;
      const solid = cell.tile === 'wall' || cell.tile === 'torch';
      assert.equal(renderer.uploadedCells[index + 3], solid ? 255 : 0, `${pass} solidity at ${key}`);
      const floor = renderer.heightMin + renderer.uploadedCells[index + 1] / 255 * renderer.heightRange;
      const ceiling = renderer.heightMin + renderer.uploadedCells[index + 2] / 255 * renderer.heightRange;
      assert.ok(Math.abs(floor - cell.floorHeight) <= renderer.heightRange / 255, `${pass} floor at ${key}`);
      assert.ok(Math.abs(ceiling - cell.ceilHeight) <= renderer.heightRange / 255, `${pass} ceiling at ${key}`);
    }
  }
  // WebGPU uploads this same row-major buffer and reads (x, y) directly.
  const snapshot = renderer.getSceneResourceSnapshot();
  assert.deepEqual(Array.from(snapshot.cellData), Array.from(renderer.uploadedCells));
}

test('asymmetric walls, torches and floor heights sample the collision coordinates', () => {
  const renderer = createRenderer();
  const dungeon = {
    geoKey: '0,0,0',
    _geometryStamp: 'first',
    layout: { width: 5, height: 4 },
    cells: {
      '1,0': { tile: 'wall', floorHeight: 0, ceilHeight: 2.5 },
      '1,3': { tile: 'floor', floorHeight: 0.5, ceilHeight: 3 },
      '3,1': { tile: 'torch', floorHeight: 0.25, ceilHeight: 2.75 },
      '3,2': { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 }
    }
  };
  renderer.rebuildDungeonTextures(dungeon, {});
  checkSampledCells(renderer, dungeon);
});

test('a second room replaces the packed layout at large world coordinates', () => {
  const renderer = createRenderer();
  renderer.rebuildDungeonTextures({
    geoKey: '0,0,0', _geometryStamp: 'first',
    layout: { width: 5, height: 4 },
    cells: { '1,0': { tile: 'wall', floorHeight: 0, ceilHeight: 2.5 } }
  }, {});
  const secondRoom = {
    geoKey: '0,0,1', _geometryStamp: 'second',
    layout: { width: 512, height: 512 },
    cells: {
      '243,369': { tile: 'wall', floorHeight: 0, ceilHeight: 2.5 },
      '243,370': { tile: 'floor', floorHeight: 0, ceilHeight: 2.5 },
      '244,369': { tile: 'torch', floorHeight: 0.5, ceilHeight: 3 },
      '243,142': { tile: 'floor', floorHeight: 1, ceilHeight: 3.5 }
    }
  };
  renderer.rebuildDungeonTextures(secondRoom, {});
  assert.equal(renderer.dungeonKey, '0,0,1');
  checkSampledCells(renderer, secondRoom);
  const version = renderer.sceneResourceVersion;
  renderer.rebuildDungeonTextures(secondRoom, {});
  assert.equal(renderer.sceneResourceVersion, version, 'unchanged frames reuse the room textures');
});

test('GPU readback diagnostics distinguish mirrored uploads from incorrect browser cells', () => {
  const renderer = createRenderer();
  const dungeon = {
    geoKey: '0,0,0', _geometryStamp: 'diagnostic', layout: { width: 3, height: 4 },
    cells: {
      '1,0': { tile: 'torch', floorHeight: 0, ceilHeight: 2.5 },
      '1,3': { tile: 'floor', floorHeight: 0.5, ceilHeight: 3 }
    }
  };
  renderer.rebuildDungeonTextures(dungeon, {});
  mockReadback(renderer, false);
  let report = renderer.getRenderingDiagnostics(dungeon);
  assert.equal(report.cpuToPackedMismatches, 0);
  assert.equal(report.gpuUploadByteMismatches, 0);
  mockReadback(renderer, true);
  report = renderer.getRenderingDiagnostics(dungeon);
  assert.ok(report.gpuUploadByteMismatches > 0);
  assert.equal(report.gpuMirroredByteMismatches, 0);
  const torch = report.samples.find(sample => sample.key === '1,0');
  assert.equal(torch.source.solid, true);
  assert.equal(torch.gpu.solid, false);
  dungeon.cells['1,0'].floorHeight = 1;
  report = renderer.getRenderingDiagnostics(dungeon);
  assert.equal(report.cpuToPackedMismatches, 1);
});

test('cell uploads reset sprite unpack state on initial rooms, transitions and dynamic updates', () => {
  const renderer = createRenderer();
  const gl = renderer.gl;
  const rooms = ['0,0,0', '0,0,1'];
  for (const geoKey of rooms) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const dungeon = {
      geoKey, _geometryStamp: geoKey, layout: { width: 3, height: 4 },
      cells: {
        '1,0': { tile: 'torch', floorHeight: 0, ceilHeight: 2.5 },
        '1,3': { tile: 'floor', floorHeight: 0.5, ceilHeight: 3 }
      }
    };
    renderer.rebuildDungeonTextures(dungeon, {});
    checkSampledCells(renderer, dungeon);
    assert.equal(renderer.cellUploadState.previousUnpackFlipY, true);
    assert.equal(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    renderer._syncActorShadowCasters([]);
    checkSampledCells(renderer, dungeon);
  }
});
