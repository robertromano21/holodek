'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('canvas'),Icons=require('../assets/shrineIconography'),Art=require('../assets/surfaceArt');
const Figures=require('../assets/frescoFigures'),Designs=require('../assets/frescoDesigns'),S=require('../assets/sculptureForms');
const C=require('../assets/renderCharacterProcedural'),P=require('../assets/physicalPuzzles'),{designPrompt}=require('../retort/physicalPuzzleDesign');
const palette=Art.frescoPalette({pigments:'vermilion'}),snapshot=()=>JSON.stringify(['Mortacia','Suzerain'].map(n=>C.getPresetProceduralSpec(n)));
const save=(name,c)=>{if(process.env.HOLODEK_ART_PREVIEW==='1'){const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.png'),c.toBuffer());}};
test('reference deities retain distinct anatomy in both old and new art metadata',()=>{
  const before=snapshot(),gallery=createCanvas(960,450),g=gallery.getContext('2d'),images=new Set();
  g.fillStyle='#29262b';g.fillRect(0,0,gallery.width,gallery.height);g.imageSmoothingEnabled=false;
  for(const [i,subject]of['Mortacia','Atinus','Atricles','Dantuea','Turthus'].entries()){
    const raw={subject,pose:'standing',facing:'front',attribute:'none',head:'bare',robe:'pleated',anatomy:'serpentine',proportions:'classical'};
    Figures.paint(g,raw,palette,{x:i*192,y:0,width:192,height:192},'renaissance',createCanvas);
    const sculpture={deity:subject,pose:'offering',head:'bare',robe:'toga',attribute:'none',workmanship:'carved'};
    S.paintFigure(g,sculpture,palette,{x:i*192,y:196,width:192,height:224});
    const v=S.build(48,'canon',sculpture);assert.equal(v.length,48**3);images.add(Buffer.from(v).toString('base64'));
    g.fillStyle='#eadbbc';g.font='15px Georgia';g.fillText(subject,i*192+12,439);
    const traits=S.characterSpec({deity:subject}).traits;
    if(subject==='Turthus'){
      assert.equal(traits.carapace,true);assert.equal(traits.wings,'none');
      assert.deepEqual(S.build(48,'canon',{...sculpture,workmanship:'classic'}),v);
    }
    if(subject==='Dantuea'){assert.equal(traits.covering,'bone');assert.equal(traits.wings,'bone');}
    if(subject==='Atricles'){assert.equal(traits.ringdrake,true);assert.equal(traits.markings,'stripes');}
    if(['Turthus','Dantuea'].includes(subject))assert.deepEqual(
      Figures.assemble(raw,palette,'renaissance',createCanvas).toBuffer(),
      Figures.assemble({...raw,anatomy:'classic'},palette,'renaissance',createCanvas).toBuffer());
  }
  assert.equal(images.size,5);assert.equal(snapshot(),before);save('divine-reference-art',gallery);
});
test('Suzerain helmet and emblem are decorative hero art, not an additional deity or changed live sprite',()=>{
  const before=snapshot(),f=Designs.validate({figures:[{subject:'Suzerain',pose:'guarding',proportions:'classical'}]}).figures[0];
  assert.equal(f.head,'class');assert.equal(f.robe,'class');assert.equal(f.attribute,'sword');assert.equal(Icons.name('Suzerain'),null);
  assert.equal(Object.keys(Icons.pantheon).length,23);assert.ok(Icons.bitmap('Suzerain').some(row=>row.includes('1')));
  assert.notDeepEqual(Icons.bitmap('Suzerain'),Icons.bitmap('Atinus'));
  assert.throws(()=>Designs.validate({figures:[{...f,race:'Dragon'}]}),/Invalid/);
  const gallery=createCanvas(768,320),g=gallery.getContext('2d');g.fillStyle='#29262b';g.fillRect(0,0,768,320);g.imageSmoothingEnabled=false;
  const helmet=createCanvas(64,80);Icons.paintSuzerainHelmet(helmet.getContext('2d'),0,0,64,80);g.drawImage(helmet,0,0,256,320);
  const motif=createCanvas(80,80),mc=motif.getContext('2d');assert.equal(Icons.paint(mc,'Suzerain helmet',0,0,80,'#dddddd','painted'),true);
  const colors=new Set(),data=mc.getImageData(0,0,80,80).data;for(let i=0;i<data.length;i+=4)if(data[i+3])colors.add(Array.from(data.subarray(i,i+3)).join(','));
  assert.ok(colors.size>4,'Painted helmet keeps the reference metal and red-gold trim, unlike a monochrome engraving');
  const hero=createCanvas(128,160);Figures.paint(hero.getContext('2d'),f,palette,{x:0,y:0,width:128,height:160},'renaissance',createCanvas);g.drawImage(hero,256,0,256,320);
  Icons.paint(g,'Suzerain emblem',546,12,180);Icons.paint(g,'Atinus',526,205,100,undefined,'painted');Icons.paint(g,'Atinus',656,205,100,'#d4bb91');
  const art={kind:'fresco',surface:'wall',label:'Suzerain the Knight',description:'A historical portrait.',motifs:['Suzerain'],figures:[f]};
  const p=P.compile({...P.fallback('suzerain-art','Hall'),roomArt:[art]});assert.equal(P.compile(JSON.parse(JSON.stringify(p))).id,p.id);
  const automatic=Designs.figures({motifs:['Suzerain'],scene:'gatekeepers'});assert.equal(automatic[0].subject,'Suzerain');assert.equal(automatic[0].head,'class');
  assert.equal(snapshot(),before);save('suzerain-helmet-art',gallery);
});
test('the Sepulchra is a green image in the art plan, not awarded equipment or a new quest',()=>{
  const spec={indoor:true,source:{roomName:'Ruined Temple Entrance',description:'The temple of Mortacia.'},puzzleMechanism:P.fallback('emerald','Ruined Temple Entrance')};
  const before=JSON.stringify(spec),rows=Art.plan(spec),gem=rows.find(r=>r.scene==='throne_of_hades');assert.ok(gem);assert.equal(JSON.stringify(spec),before);
  assert.equal(rows.filter(r=>r.kind==='fresco').length,4);assert.match(gem.description,/image|depict/i);
  const c=createCanvas(64,96),g=c.getContext('2d');Icons.paintSepulchra(g,0,0,64,96);
  const d=g.getImageData(0,0,64,96).data;let green=0;for(let i=0;i<d.length;i+=4)if(d[i+3]&&d[i+1]>d[i]*1.5&&d[i+1]>d[i+2]*1.15)green++;
  assert.ok(green>1000);assert.equal(Icons.name('Sepulchra'),null);
  const prompt=designPrompt({roomName:'Temple',description:'',seed:'atlas'});assert.match(prompt,/NOT a physical relic/);assert.match(prompt,/Suzerain.*HERO/);assert.match(prompt,/Fiorenan Peninsula/);assert.match(prompt,/NOT the generated Tartarus room map/);
  for(const scene of['sepulchra_vigil','throne_of_hades'])for(let count=1;count<=6;count++)for(const width of[96,128,160]){
    const boxes=Designs.layout({scene},Array.from({length:count},()=>({subject:'human'})),width).map(f=>f.box).sort((a,b)=>a.x-b.x);
    boxes.forEach((b,i)=>{assert.ok(b.width>0&&b.x>=0&&b.x+b.width<=width);if(i)assert.ok(boxes[i-1].x+boxes[i-1].width<=b.x);});
  }
});
