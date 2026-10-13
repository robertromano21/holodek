'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('canvas'),C=require('../assets/renderCharacterProcedural'),Sprites=require('../assets/renderCharacterSprite');
const S=require('../assets/sculptureForms'),Figures=require('../assets/frescoFigures'),Art=require('../assets/surfaceArt');
const character={Name:'Mortacia',Sex:'Female',Race:'Goddess',Class:'Assassin-Fighter-Necromancer-Goddess',_rerollSeed:.42};
const palette=Art.frescoPalette({pigments:'vermilion'});
function image(p){const c=createCanvas(p.w,p.h),ctx=c.getContext('2d'),im=ctx.createImageData(p.w,p.h);im.data.set(p.data);ctx.putImageData(im,0,0);return c;}
test('Mortacia has filled scalloped dragon membranes in every live view and shrine figure',()=>{
  const spec=C.getPresetProceduralSpec('Mortacia'),before=JSON.stringify(spec),shape=C.mortaciaWingProfile();
  assert.equal(spec.traits.wings,'bat');assert.equal(spec.traits.wingShape,'mortacia');assert.equal(shape.ribs.length,4);
  const wing=C.renderMortaciaWingPixels(40,60),alpha=(x,y)=>wing.data[(x+y*wing.w)*4+3];
  assert.equal(alpha(23,28),255,'membrane exists between supporting fingers');assert.equal(alpha(15,52),0,'scallop is open, not a cape rectangle');
  assert.ok(new Set(Array.from(wing.data).filter((_,i)=>i%4===3)).size===2,'hard pixels, no antialias haze');
  const gallery=createCanvas(960,540),g=gallery.getContext('2d');g.fillStyle='#302c31';g.fillRect(0,0,960,540);g.imageSmoothingEnabled=false;
  const show=(c,label,i)=>{const scale=Math.min(160/c.width,240/c.height);g.drawImage(c,i%6*160+(160-c.width*scale)/2,Math.floor(i/6)*270,c.width*scale,c.height*scale);g.fillStyle='#eadbbc';g.font='13px Georgia';g.fillText(label,i%6*160+5,Math.floor(i/6)*270+258);};
  for(let i=0;i<3;i++){
    const s=Sprites.createCharacterSpriteSpec(character);s.design.starter_variant=i;
    show(Sprites.createCharacterSpriteCanvas(character,s),'2D profile '+i,i);
  }
  for(const [i,view]of['front','threeQuarter','side','back'].entries()){
    const pixels=C.renderBillboardPixels(spec,{view,frame:0});assert.ok(pixels.data.some(Boolean));show(image(pixels),'3D '+view,i+3);
  }
  const raw={subject:'Mortacia',pose:'offering',facing:'front',attribute:'sword',robe:'pleated',head:'bare',proportions:'classical'};
  show(Figures.assemble(raw,palette,'renaissance',createCanvas),'Fresco figure',7);
  const shrine=S.characterSpec({deity:'Mortacia'});assert.equal(shrine.traits.wings,'bat');assert.equal(shrine.traits.wingShape,'mortacia');
  for(const [i,workmanship]of['classic','carved'].entries()){
    const sculpture={label:'Mortacia',deity:'Mortacia',pose:'offering',head:'bare',robe:'pleated',attribute:'sword',workmanship};
    const c=createCanvas(128,160);S.paintFigure(c.getContext('2d'),sculpture,palette,{x:0,y:0,width:128,height:160});show(c,'Statue '+workmanship,i+8);
    const size=48,v=S.build(size,'42',sculpture);assert.equal(v.length,size**3);assert.ok(v.some(Boolean));
  }
  assert.equal(JSON.stringify(spec),before);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'mortacia-wings.png'),gallery.toBuffer());}
});
test('cached Mortacia portraits refresh once without rerolling specs or changing other characters',()=>{
  const spec=Sprites.createCharacterSpriteSpec(character),old={dataUrl:'data:old',spec,artRevision:'mortacia-blonde-bodice-2'},entry={...character,sprite:old};
  const snapshot=JSON.stringify(spec);assert.equal(Sprites.refreshMortaciaSpriteArt(entry),true);assert.notEqual(entry.sprite.dataUrl,old.dataUrl);
  assert.equal(JSON.stringify(entry.sprite.spec),snapshot);assert.equal(old.dataUrl,'data:old');assert.equal(Sprites.refreshMortaciaSpriteArt(entry),false);
  const other={...entry,Name:'Suzerain',sprite:old};assert.equal(Sprites.refreshMortaciaSpriteArt(other),false);assert.equal(other.sprite,old);
});

test('Mortacia keeps her grey bodice and reads as blonde in every 2D starter variant',()=>{
  for(let variant=0;variant<3;variant++){
    const spec=Sprites.createCharacterSpriteSpec(character);spec.design.starter_variant=variant;
    const canvas=Sprites.createCharacterSpriteCanvas(character,spec),ctx=canvas.getContext('2d');
    const pixel=(x,y)=>Array.from(ctx.getImageData(x*3+1,y*3+1,1,1).data);
    const crown=pixel(13,8),waist=pixel(14,16);
    assert.equal(crown[3],255);assert.ok(crown[0]>crown[1]+15&&crown[1]>crown[2]+30,'Warm gold hair, not a grey cap');
    assert.equal(waist[3],255);assert.ok(Math.max(...waist.slice(0,3))-Math.min(...waist.slice(0,3))<20,'Grey garment covers the waist');
    assert.equal(canvas.width,96);assert.equal(canvas.height,96,'Artwork changes must not change the combat-map canvas sizing');
  }
});

test('Mortacia bodice covers the previously bare waist without changing wing pixels or her stature',()=>{
  const spec=C.getPresetProceduralSpec('Mortacia'),bare=structuredClone(spec);
  bare.key+='-bare-waist-reference';bare.traits.garment.coverMidriff=false;
  assert.equal(spec.traits.garment.coverMidriff,true);assert.equal(spec.worldScale,bare.worldScale);
  const covered=C.renderAssemblyPixels(spec),original=C.renderAssemblyPixels(bare);
  let waistPixels=0,wingPixels=0;
  for(let i=0;i<covered.parts.length;i++){
    const now=Array.from(covered.data.slice(i*4,i*4+4)),old=Array.from(original.data.slice(i*4,i*4+4));
    if(original.parts[i]===C.assemblyParts.TORSO&&old[0]>old[2]+30&&now.some((v,k)=>v!==old[k])){
      waistPixels++;assert.ok(now[2]>=now[0]&&Math.abs(now[0]-now[1])<10,'Previously bare abdomen is grey fabric');
    }
    if([C.assemblyParts.WING_L,C.assemblyParts.WING_R].includes(original.parts[i])){
      wingPixels++;assert.deepEqual(now,old,'Approved wing artwork remains unchanged');
    }
  }
  assert.ok(waistPixels>=15);assert.ok(wingPixels>100);
  const [r,g,b]=spec.traits.palette.hair.match(/[0-9a-f]{2}/gi).map(s=>parseInt(s,16));
  assert.ok(r>g+15&&g>b+30);
  for(const view of['front','threeQuarter','side','back'])for(let frame=0;frame<4;frame++){
    const pixels=C.renderBillboardPixels(spec,{view,frame});assert.ok(pixels.bounds);
    assert.ok(pixels.data.every((v,i)=>i%4!==3||v===0||v===255),'All live views retain hard-edged sprite transparency');
  }
});
test('painted proportion adjustments retain compact races and original character artwork',()=>{
  const raw={subject:'human',pose:'standing',facing:'front',attribute:'none',robe:'pleated',head:'bare'},snapshot=JSON.stringify(C.getPresetProceduralSpec('Suzerain'));
  const classic=Figures.assemble(raw,palette,'renaissance',createCanvas),explicit=Figures.assemble({...raw,proportions:'classic'},palette,'renaissance',createCanvas);
  assert.deepEqual(classic.toBuffer(),explicit.toBuffer());
  const improved=Figures.assemble({...raw,proportions:'classical'},palette,'renaissance',createCanvas);assert.notDeepEqual(improved.toBuffer(),classic.toBuffer());
  const human=Figures.proportions({proportions:'classical'}),dwarf=Figures.proportions({proportions:'classical'},{size:'small',build:'heavy'});
  assert.ok(human.head<1&&human.leg>1);assert.equal(dwarf.body,1);assert.ok(dwarf.leg<human.leg);assert.equal(JSON.stringify(C.getPresetProceduralSpec('Suzerain')),snapshot);
});
