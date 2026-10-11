'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('canvas'),Art=require('../assets/surfaceArt'),Designs=require('../assets/frescoDesigns'),Figures=require('../assets/frescoFigures');
const C=require('../assets/renderCharacterProcedural'),S=require('../assets/sculptureForms'),P=require('../assets/physicalPuzzles');
const pal=Art.frescoPalette({pigments:'vermilion'});
const row=(style='renaissance',scene='ancestral_court',figures)=>({kind:'fresco',surface:'wall',label:'The White Lady receives the departed',
  description:'Mortacia shelters souls beneath skeletal wings.',motifs:['Mortacia','skeleton','wraith'],composition:'judgment',style,scene,...(figures?{figures}: {})});
test('all ten traditions change actual pixels, not just captions or pigment names',()=>{
  const hashes=new Set(),gallery=createCanvas(288*2,212*5),g=gallery.getContext('2d');
  Object.keys(Designs.styles).forEach((style,i)=>{
    const art=Art.validate([row(style)])[0],canvas=createCanvas(288,192),ctx=canvas.getContext('2d');Art.paint(ctx,createCanvas,art);
    hashes.add(canvas.toBuffer().toString('base64'));const mesh=Art.mesh(ctx.getImageData(0,0,144,96));assert.ok(mesh.vertices.length/9<65536);
    g.drawImage(canvas,(i%2)*288,Math.floor(i/2)*212);g.fillStyle='#e8d3a1';g.font='12px Georgia';g.fillText(style.replace(/_/g,' '),(i%2)*288+7,Math.floor(i/2)*212+205);
  });
  assert.equal(hashes.size,10);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'fresco-traditions.png'),gallery.toBuffer());
  }
});
test('twelve poses and three facings produce distinct articulated figures without changing preset sprites',()=>{
  const preset=C.getPresetProceduralSpec('Mortacia'),snapshot=JSON.stringify(preset),before=new Uint8ClampedArray(C.renderProceduralPixels(JSON.parse(snapshot),0,'billboard').data);
  const hashes=new Set(),gallery=createCanvas(96*4,124*3),g=gallery.getContext('2d');
  Designs.poses.forEach((pose,i)=>{
    const raw={subject:'Mortacia',pose,facing:'front',attribute:'none',robe:'pleated',head:'bare'},canvas=createCanvas(96,112);
    Figures.paint(canvas.getContext('2d'),raw,pal,{x:0,y:0,width:96,height:112},'renaissance',createCanvas);
    hashes.add(canvas.toBuffer().toString('base64'));assert.ok(canvas.getContext('2d').getImageData(0,0,96,112).data.some(Boolean));
    g.drawImage(canvas,(i%4)*96,Math.floor(i/4)*124);g.fillStyle='#e8d3a1';g.font='10px Georgia';g.fillText(pose,(i%4)*96+2,Math.floor(i/4)*124+121);
  });
  assert.equal(hashes.size,12);assert.equal(JSON.stringify(preset),snapshot);assert.deepEqual(C.renderProceduralPixels(JSON.parse(snapshot),0,'billboard').data,before);
  const facings=new Set();for(const facing of ['front','left','right'])facings.add(Figures.assemble({subject:'human',pose:'pointing',facing,attribute:'staff',robe:'toga',head:'bare'},pal,'egyptian',createCanvas).toBuffer().toString('base64'));
  assert.equal(facings.size,3);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'fresco-poses.png'),gallery.toBuffer());
  }
});
test('scene subjects, costumes and held attributes have real visual consequences',()=>{
  const scenes=new Set();for(const scene of Designs.scenes){const c=createCanvas(144,96);Art.paint(c.getContext('2d'),createCanvas,row('renaissance',scene));scenes.add(c.toBuffer().toString('base64'));}
  assert.equal(scenes.size,10);
  const images=new Set();for(const subject of ['Mortacia','Atinus','Poena','Dyanetzia','human','skeleton','wraith','angel','demon']){
    const c=Figures.assemble({subject,pose:'offering',facing:'front',attribute:'scroll',robe:'mantle',head:'bare'},pal,'renaissance',createCanvas);images.add(c.toBuffer().toString('base64'));
  }assert.equal(images.size,9);
  const attributes=new Set();for(const attribute of Designs.attributes)attributes.add(Figures.assemble({subject:'human',pose:'offering',facing:'front',attribute,robe:'pleated',head:'bare'},pal,'renaissance',createCanvas).toBuffer().toString('base64'));
  assert.equal(attributes.size,Designs.attributes.length);
});
test('assembly metadata is optional, isolated and does not alter ordinary character raster output',()=>{
  const spec=S.characterSpec({label:'Mortacia fresco',deity:'Mortacia',form:'human'},pal),before=C.renderProceduralPixels(spec,0,false),clone=new Uint8ClampedArray(before.data);
  const assembly=C.renderAssemblyPixels(spec);assert.deepEqual(assembly.data,clone);assert.ok(assembly.parts.some(id=>id===C.assemblyParts.HEAD));
  assert.equal(before.parts,undefined);assert.equal(spec.traits.wings,'bone');
  const dragon=C.renderAssemblyPixels(S.characterSpec({deity:'Atinus',form:'dragon'},pal));assert.ok(dragon.parts.some(id=>id===C.assemblyParts.WING_L));
  const metadata=new Uint8Array(assembly.parts);Figures.assemble({subject:'Mortacia',pose:'mourning',facing:'front',attribute:'none',robe:'pleated',head:'bare'},pal,'renaissance',createCanvas);
  assert.deepEqual(assembly.parts,metadata);assert.deepEqual(C.renderProceduralPixels(spec,0,false).data,clone);
});
test('the design schema rejects unimplemented poses, unknown deities, excessive figures and false traditions',()=>{
  for(const patch of [{style:'space age'},{scene:'new quest victory'},{figures:Array(7).fill({subject:'Mortacia',pose:'offering'})},
    {figures:[{subject:'Zeus',pose:'offering'}]},{figures:[{subject:'Mortacia',pose:'teleporting'}]},
    {figures:[{subject:'Mortacia',pose:'standing',attribute:'laser'}]}])assert.throws(()=>Art.validate([{...row(),...patch}]),/Invalid/);
  const p=P.compile({...P.fallback('art-meta','Mortacia shrine'),roomArt:[row('egyptian','burial_rites',[{subject:'Bonedrake',pose:'mourning',facing:'left',attribute:'hourglass',robe:'shroud',head:'bare'}])]});
  assert.equal(p.roomArt[0].figures[0].subject,'Mortacia');assert.equal(p.roomArt[0].style,'egyptian');assert.equal(P.compile(p).id,p.id);
});
test('room architecture chooses a coherent visual tradition and replay retains full art metadata',()=>{
  for(const[description,style]of [['A Byzantine pendentive dome.','byzantine'],['A Gothic hall with pointed arches.','medieval_gothic'],
    ['An Egyptian hypostyle sanctuary.','egyptian'],['A Roman atrium.','classical_roman'],['A manuscript scriptorium.','medieval_illuminated']]){
    const spec={indoor:true,source:{roomName:'Mortacia Temple',description}},rows=Art.plan(spec).filter(r=>r.kind==='fresco');assert.equal(rows.length,4);
    assert.ok(rows.every(r=>r.style===style));assert.ok(rows.every(r=>r.figures.length>0));assert.deepEqual(JSON.parse(JSON.stringify(rows)),rows);
  }
});
