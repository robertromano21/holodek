const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const C=require('../assets/renderCharacterProcedural'),S=require('../assets/renderCharacterSprite'),M=require('../assets/characterMotion3d');
const source=fs.readFileSync(path.join(__dirname,'../assets/game.js'),'utf8');
function fixture(){
  const root={combatCharacters:[{name:'Attacker',mazeX:1,mazeY:1,walkFrame:3},{name:'Target',mazeX:3,mazeY:1}],CharacterMotion3D:M,performance:{now:()=>100}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/combatMapPoses.js'),'utf8'),{window:root});return root;
}
test('attack frames use the shared timing then return to the untouched walk state',()=>{
  const root=fixture(),P=root.CombatMapPoses,a=root.combatCharacters[0],saved=JSON.stringify(a);
  assert.equal(P.observe('Attacker hits Target for 5 damage',['Attacker','Target'],100),true);
  for(const [dt,f]of [[0,0],[229,0],[230,1],[299,1],[300,2],[449,2],[450,3],[639,3]])assert.equal(P.frameFor(a,100+dt),'attack'+f);
  assert.equal(P.frameFor(a,740),null);assert.equal(JSON.stringify(a),saved);
});
test('misses, kills, casting and named attack cues animate the correct actor, not unrelated narrative',()=>{
  for(const line of ['Attacker misses Target','Attacker attacks Target','Attacker swings at Target','Attacker lunges at Target','Attacker casts at Target']){
    const root=fixture();assert.equal(root.CombatMapPoses.observe(line,['Attacker','Target'],100),true);assert.equal(root.CombatMapPoses.frameFor(root.combatCharacters[0],100),'attack0');
  }
  const root=fixture(),P=root.CombatMapPoses;
  assert.equal(P.observe('Target is killed by Attacker',['Target','Attacker'],100),true);
  assert.equal(P.frameFor(root.combatCharacters[0],100),'attack0');assert.equal(P.frameFor(root.combatCharacters[1],100),null);
  P.clear();assert.equal(P.observe('Attacker looks at Target',['Attacker','Target']),false);
});
test('attack faces the target after map rotation, preserving the selected profile convention',()=>{
  const root=fixture(),P=root.CombatMapPoses,a=root.combatCharacters[0];P.cue('Attacker','Target',100);
  assert.equal(P.facingFlip(a,0,100),false);assert.equal(P.facingFlip(a,Math.PI,100),true);
  assert.equal(P.facingFlip(a,Math.PI/2,100),null);
});
test('scene redraw advances all attack stages and draws the restored walk once at completion',()=>{
  const root=fixture(),P=root.CombatMapPoses;let redraws=0,applied=0;
  root.applyCombatVisualFrame=()=>applied++;const scene={characters:{Attacker:{sprite:{}}},redrawCombatRT(){redraws++;}};
  P.cue('Attacker','Target',100);for(const t of [100,101,330,400,550,740,800])P.tick(scene,t);
  assert.equal(redraws,5);assert.ok(applied>=5);
});
const families=[['humanoid','human'],['robe','lich'],['spectral','wraith'],['beast','wolf'],['winged','dragon'],['serpent','serpent'],['spider','spider'],['ooze','slime'],['elemental','fire elemental'],['eye','beholder'],['chest','mimic']];
for(const [label,race]of families)test('native attack atlas retains every walk pixel and stature: '+label,()=>{
  const spec=C.buildProceduralSpriteSpec({name:'Pose '+label,race,class:label==='robe'?'Mage':'Fighter',level:3,isMonster:true});
  const actor={name:spec.name,sprite:{spec}},walk=S.createCombatSpriteSheetCanvas(actor,spec,4),atlas=S.createCombatPoseSheetCanvas(actor,spec,walk),size=walk.height;
  assert.equal(atlas.width,size*8);assert.equal(atlas.height,size);assert.equal(atlas._combatBodyHeight,walk._combatBodyHeight);
  assert.deepEqual(atlas.getContext('2d').getImageData(0,0,walk.width,size).data,walk.getContext('2d').getImageData(0,0,walk.width,size).data);
  const frames=[];for(let f=0;f<4;f++){
    const d=atlas.getContext('2d').getImageData((f+4)*size,0,size,size).data;
    assert.ok(d.some((v,i)=>i%4===3&&v>0));frames.push(Buffer.from(d));
  }
  assert.ok(!frames[0].equals(frames[1]));assert.ok(!frames[1].equals(frames[2]));
});
test('approved preset attack keeps the original reference and portrait sizing metadata',()=>{
  const actor={name:'Mortacia'},walk=S.createCombatSpriteSheetCanvas(actor,null,4),atlas=S.createCombatPoseSheetCanvas(actor,null,walk);
  assert.equal(atlas._combatBodyHeight,walk._combatBodyHeight);assert.deepEqual(atlas._retroColorRoles,walk._retroColorRoles);
  assert.deepEqual(atlas.getContext('2d').getImageData(0,0,walk.width,walk.height).data,walk.getContext('2d').getImageData(0,0,walk.width,walk.height).data);
});
test('PC and other map actors select attack atlas frames; dice, map effects and actual-size portraits remain separate',()=>{
  assert.match(source,/frameName = getCombatFrameName\(pcAnimState\)/);
  assert.match(source,/tex.add\('attack'\+i/);assert.match(source,/CombatMapPoses\?\.tick\(this\)/);
  assert.match(source,/const tokenSize = combatMapActorSize\(entry/);assert.match(source,/const pcSize = combatMapActorSize\(fullChar/);
  assert.match(source,/CombatTacticalUi\?\.drawOverlay/);
});

test('walk-derived fitting preserves original walk pixels and body fraction exactly',()=>{
  const {createCanvas}=require('canvas'),crypto=require('node:crypto');
  // Golden walk pixels were captured before adding the attack atlas.
  const golden={"humanoid":{"hash":"04ba93f0886f8b35d3bbc2f780ee1962dee20fed15783a680eefc3cf4bebdf19","fraction":1},"robe":{"hash":"b8c9d1483eb9bed4b4020d523edde65da05492dd94f68d0f2b19e821093640a5","fraction":0.9583333333333334},"spectral":{"hash":"a57681b0d443f8540ba4ee9be3950c1a16902fb9733e3eef7ebdb6ff664c2e42","fraction":1},"beast":{"hash":"89926df42a32c3597b3efd2dae110c330afe29dc2b03c442cc8133c3d65afdd8","fraction":0.7619047619047619},"winged":{"hash":"c696f8f9fa052699bfc0effd67b8705171a5cfd70990e7d01e15b085c402f475","fraction":0.92},"serpent":{"hash":"55038da0461e9dd2fdc6a721bc3d692a4868ea6d6b2e55b9e5186a8b950a4918","fraction":0.9047619047619047},"spider":{"hash":"6db6d7bebd64e35a79ce69548804070ff3f6c78839eabdd993332bd4cc5da76b","fraction":0.7391304347826088},"ooze":{"hash":"59d48d2c03d3d551f35039b9a82dac9c8c2ef4929cbc0e4b50ec70ae8688db6f","fraction":0.7894736842105262},"elemental":{"hash":"5bd5f0b9a00e2d78508ba6e049b891d52ea4d363b9bf2f2f8241b8bae66b95da","fraction":1},"eye":{"hash":"29ee5ae358abb3ac0d421ad7a7937c8fe1fcfff7622ade802d33b63ff327bbb3","fraction":1},"chest":{"hash":"7b5c29d73a50515023b6f676fb4785e4411c2f46dbbde2607de7cb5d0ceafba2","fraction":0.7894736842105262}};
  const box={document:{createElement:()=>createCanvas(1,1)}};vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('function fitCombatNpcSpriteSheet'),source.indexOf('function combatMapActorSize')),box);
  for(const [label,race]of families){
    const spec=C.buildProceduralSpriteSpec({name:'Fit '+label,race,class:'Fighter',level:3,isMonster:true});
    const actor={name:spec.name,type:'monster',sprite:{spec}},walk=S.createCombatSpriteSheetCanvas(actor,spec,4);
    const sheet=box.fitCombatNpcSpriteSheet(S.createCombatPoseSheetCanvas(actor,spec,walk),actor,4);
    const data=sheet.getContext('2d').getImageData(0,0,walk.width,walk.height).data;
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),golden[label].hash,label);
    assert.equal(actor._combatBodyFraction,golden[label].fraction,label);
  }
});

test('armored preset attacks keep his hand-made knight art instead of switching render styles',()=>{
  // Suzerain's approved token draws its own attack poses: same palette, size and rigid helm as his walk.
  const actor={name:'Suzerain',_rerollSeed:.4},walk=S.createCombatSpriteSheetCanvas(actor,null,4),sheet=S.createCombatPoseSheetCanvas(actor,null,walk),size=walk.height;
  const colors=(ctx,x0)=>{const d=ctx.getImageData(x0,0,size,size).data,c=new Set();for(let i=0;i<d.length;i+=4)if(d[i+3])c.add(d[i]+','+d[i+1]+','+d[i+2]);return c;};
  const base=colors(walk.getContext('2d'),0);
  for(let f=0;f<4;f++)for(const c of colors(sheet.getContext('2d'),(4+f)*size))assert.ok(base.has(c),'attack frame '+f+' introduces '+c);
  assert.deepEqual(sheet.getContext('2d').getImageData(0,0,size*4,size).data,walk.getContext('2d').getImageData(0,0,size*4,size).data);
});

require('./sprite-expansion-cases.cjs')('combat');
