'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/characterMotion3d');
const C = require('../assets/renderCharacterProcedural');
function sampleTravel(angle, bearing) {
  const c = M.createController(); let pose;
  for (let t = 0; t <= 2400; t += 20) {
    const x = Math.cos(angle) * t / 1200, y = Math.sin(angle) * t / 1200;
    pose = c.sample('Traveller', {scope:'direction-regression', x, y, camX:x+8*Math.cos(bearing), camY:y+8*Math.sin(bearing), now:t});
  }
  return pose;
}
for (let sector=0; sector<8; sector++) test('travel projects to the correct billboard direction in sector '+sector, () => {
  for (const bearing of [0, .73, 2.1, -2.4]) {
    const angle = bearing + sector*Math.PI/4, p=sampleTravel(angle,bearing);
    // Use the actual renderer camera-right basis, independent of the controller's angle convention.
    const cameraAngle=bearing+Math.PI;
    const right=-Math.sin(cameraAngle)*Math.cos(angle)+Math.cos(cameraAngle)*Math.sin(angle);
    const towards=Math.cos(angle-bearing);
    assert.equal(p.view, Math.abs(towards)>.99 ? (towards>0?'front':'back') : Math.abs(towards)<.01 ? 'side' : towards>0?'threeQuarter':'backQuarter');
    if (Math.abs(right)>.01) {
      assert.equal(p.facing,Math.sign(right),'sprite nose must point along projected travel');
      assert.equal(Math.sign(p.upperShift),Math.sign(right),'body lean follows travel, not its opposite');
    }
    assert.ok(p.moving);
  }
});
test('planted humanoid foot sweeps backward relative to the body during its contact phase', () => {
  const spec=C.buildProceduralSpriteSpec({name:'Stride Guard',race:'Human',class:'Fighter',isMonster:true});
  const P=C.assemblyParts;
  for (const bearing of [-Math.PI/2,Math.PI/2]) {
    const p=sampleTravel(0,bearing), xs=[];
    for (const frame of [3,0,1]) {
      const pix=C.renderProceduralPixels(spec,frame,'billboard','turn:side:'+p.facing+':walk',true);
      const points=[];
      for(let i=0;i<pix.parts.length;i++) if(pix.parts[i]===P.BOOT_R&&pix.data[i*4+3]) points.push(i%pix.w);
      // At the centred pose the near boot covers the planted boot at the same location.
      if (!points.length && frame===0) for(let i=0;i<pix.parts.length;i++) if(pix.parts[i]===P.BOOT_L&&pix.data[i*4+3]) points.push(i%pix.w);
      assert.ok(points.length,'planted boot remains visible or coincides with the near boot');
      xs.push(points.reduce((a,b)=>a+b,0)/points.length);
    }
    assert.ok((xs[1]-xs[0])*p.facing<0,'contact to centre goes opposite facing');
    assert.ok((xs[2]-xs[1])*p.facing<0,'centre to trailing contact goes opposite facing');
  }
});
const families=[['Mortacia'],['Guard','Human'],['Robe','Lich'],['Spirit','Wraith'],['Beast','Wolf'],['Winged beast','Dragon'],['Serpent','Serpent'],['Spider','Spider'],['Ooze','Slime'],['Elemental','Fire elemental'],['Floating eye','Beholder'],['Chest','Mimic']];
for (const [name,race] of families) test(name+' retains all eight forward-facing directional walk sets',()=>{
 const spec=race?C.buildProceduralSpriteSpec({name:'Directional '+name,race,class:'Fighter',isMonster:true}):C.getPresetProceduralSpec(name);
 const original=JSON.stringify(spec);
 for(let sector=0;sector<8;sector++) {
  const angle=sector*Math.PI/4,p=sampleTravel(angle,0);
  if(Math.abs(Math.sin(angle))>.01) assert.equal(p.facing,-Math.sign(Math.sin(angle)));
  for(let frame=0;frame<4;frame++) {
   const pix=C.renderBillboardPixels(spec,{view:p.view,facing:p.facing,frame,action:'walk'});
   assert.ok(pix.bounds,name+' '+sector+' '+frame);
   assert.ok(pix.data.every((v,i)=>i%4!==3||v===0||v===255));
  }
 }
 assert.equal(JSON.stringify(spec),original,'direction sampling must not mutate art or weapon handedness');
});

require('./sprite-expansion-cases.cjs')('facing');
