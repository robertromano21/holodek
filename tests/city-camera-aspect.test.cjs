'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../assets/rendererWebGL'),'utf8');
const start=source.indexOf('      const FOV = Math.PI / 3;',source.indexOf('const frameStartedAt = performance.now();'));
const end=source.indexOf('      if (window.DEBUG_WEBGL_POS)',start);
assert.ok(start>0&&end>start,'Use the production camera projection block');
function camera(retro,displayW,displayH,width=160,height=120){
  const context={window:{RetroGraphics:{fullbright:()=>retro}},container:{clientWidth:displayW,clientHeight:displayH},
    width,height,dirX:1,dirY:0,camX:0,camY:0,eyeZ:.65,dungeon:{},renderer:{_getRenderedFloorHeight:()=>0}};
  return vm.runInNewContext(`(function(){${source.slice(start,end)}return {planeScale,planeX,planeY,focalLength,horizon,voxelCamera};}).call(renderer)`,context);
}
for(const [w,h]of [[1920,1080],[2560,1080],[1024,768],[900,900],[390,844]]){
  test(`Modern and Retro use identical undistorted world projection at ${w}x${h}`,()=>{
    const regular=camera(false,w,h),retro=camera(true,w,h,1280,720),distance=8;
    // Project equal world-space edges into CSS pixels after the buffer is stretched to its container.
    for(const [c,bw,bh]of [[regular,160,120],[retro,1280,720]]){
      const horizontal=bw/(2*c.planeScale*distance)*w/bw;
      const vertical=c.focalLength/distance*h/bh;
      assert.ok(Math.abs(horizontal-vertical)<1e-9,'Square world edges must have square displayed dimensions');
    }
    assert.equal(regular.planeScale,retro.planeScale);
    assert.equal(regular.planeX,retro.planeX);assert.equal(regular.planeY,retro.planeY);
    assert.equal(regular.voxelCamera.verticalScale,retro.voxelCamera.verticalScale);
  });
}
test('Modern sharpness changes pixel density without changing framing',()=>{
  const low=camera(false,1920,1080),high=camera(false,1920,1080,640,480);
  assert.equal(low.planeScale,high.planeScale);
  assert.equal(low.voxelCamera.verticalScale,high.voxelCamera.verticalScale);
  assert.equal(low.focalLength/120,high.focalLength/480);
});
test('a hidden or unmeasured container falls back to the buffer aspect without invalid projection',()=>{
  for(const [w,h]of [[0,0],[1920,0],[0,1080]]){
    const c=camera(false,w,h);assert.ok(Number.isFinite(c.planeScale)&&c.planeScale>0);
    assert.equal(c.planeScale,Math.tan(Math.PI/6)*160/120);
  }
});
