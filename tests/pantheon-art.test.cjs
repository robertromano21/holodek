const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('canvas'),Icons=require('../assets/shrineIconography'),People=require('../assets/artCharacters');
const Art=require('../assets/surfaceArt'),Designs=require('../assets/frescoDesigns'),Figures=require('../assets/frescoFigures'),S=require('../assets/sculptureForms');
const P=require('../assets/physicalPuzzles'),V=require('../assets/scenePropVoxels'),C=require('../assets/renderCharacterProcedural');
const pal=Art.frescoPalette({pigments:'lapis'});
const art=figures=>({kind:'fresco',surface:'wall',label:'The Peoples of Danae',description:'A history of the underworld.',
  motifs:['Mortacia','Human'],style:'renaissance',scene:'ancestral_court',figures});
const raw=patch=>({subject:'mortal',race:'Human',pose:'standing',facing:'front',attribute:'none',robe:'class',head:'class',...patch});
function save(name,canvas){if(process.env.HOLODEK_ART_PREVIEW==='1'){
  const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.png'),canvas.toBuffer());
}}
test('all 23 canonical gods have usable emblems, names, portfolios and favored-weapon motifs',()=>{
  assert.equal(Object.keys(Icons.pantheon).length,23);
  const weapons={Mortacia:'scythe',Atinus:'sword',Arithus:'dagger',Atricles:'sword',Chaoticum:'catapult',Dantuea:'gauntlet',Dyanetzia:'staff',
    Eredine:'staff',Krystalynn:'club',Leona:'net',Llellwyth:'spear',Mordicar:'pick',Musydius:'sling',Neptar:'harpoon',Poena:'bow',
    Rama:'lance',Sharlynn:'whip',Sylanos:'sickle',Syluria:'staff',Turthus:'mace',Uceracea:'lance',Urthur:'halberd','Nameless Drake':'chain'};
  const hashes=new Set(),gallery=createCanvas(192*6,170*4),ctx=gallery.getContext('2d');ctx.fillStyle='#201e21';ctx.fillRect(0,0,gallery.width,gallery.height);
  Object.entries(Icons.pantheon).forEach(([name,canon],i)=>{
    assert.equal(canon.attribute,weapons[name]);assert.ok(canon.weapon&&canon.epithets&&canon.alignment&&canon.symbolDescription);
    assert.equal(canon.form,name==='Mortacia'?'human':'dragon');
    const grid=Icons.bitmap(name);assert.equal(grid.length,25);assert.ok(grid.every(r=>/^[01]{25}$/.test(r)));assert.ok(grid.some(r=>r.includes('1')));
    const image=createCanvas(144,96),f=Designs.validate(art([{subject:name,pose:'offering'}])).figures[0];
    Figures.paint(image.getContext('2d'),f,pal,{x:1,y:1,width:140,height:94},'renaissance',createCanvas);
    hashes.add(image.toBuffer().toString('base64'));const x=i%6*192,y=Math.floor(i/6)*170;
    ctx.drawImage(image,x+20,y+4);Icons.paint(ctx,name,x+70,y+103,38,canon.color);
    ctx.fillStyle='#ecdabb';ctx.font='13px Georgia';ctx.fillText(name,x+7,y+160);
  });
  assert.equal(hashes.size,23);save('pantheon-gallery',gallery);
  assert.equal(Icons.name('Bonedrake'),'Mortacia');assert.equal(Icons.name('Rama\'san'),'Rama');assert.equal(Icons.name('Dyana'),'Dyanetzia');
  assert.equal(Icons.name('The All'),'Rama');assert.equal(Icons.find('All the artisans make an ordinary bowl.'),null);
  assert.match(Icons.pantheon.Mortacia.symbolDescription,/female.*skeletal/);assert.match(Icons.pantheon.Rama.symbolDescription,/heart.*flame/);
  assert.deepEqual(Icons.bitmap('Sylanos'),Icons.bitmap('Syluria'));assert.notEqual(Icons.pantheon.Sylanos.color,Icons.pantheon.Syluria.color);
});
test('depicted core races and classes mirror the actual starting-character tables',()=>{
  const game=fs.readFileSync(require.resolve('../retort/retortWithUserInput'),'utf8');
  const block=game.slice(game.indexOf('const baseRaceModifiers = {')).split('};')[0];
  const races=[...block.matchAll(/'([^']+)'\s*:/g)].map(m=>m[1]);assert.deepEqual(People.races,races);
  const classes=game.slice(game.indexOf('const characterClasses = [')).split('];')[0];
  assert.deepEqual(Object.keys(People.classes),[...classes.matchAll(/name: '([^']+)'/g)].map(m=>m[1]));
});
test('draconic effigies differ in silhouette, not only color, without changing any deity body plan',()=>{
  const silhouettes=new Set();
  for(const name of Object.keys(Icons.pantheon).filter(n=>n!=='Mortacia')){
    const s=S.characterSpec({deity:name});assert.equal(s.traits.bodyPlan,'draconic');
    const p=C.renderAssemblyPixels(s);silhouettes.add(Array.from(p.data.filter((v,i)=>i%4===3),v=>v?1:0).join(''));
  }
  assert.ok(silhouettes.size>=12,'Too many gods are still the same dragon silhouette');
});
test('all nine core races have different painted bodies without mutating live traits or presets',()=>{
  const gallery=createCanvas(128*3,172*3),g=gallery.getContext('2d'),hashes=new Set();
  People.races.forEach((race,i)=>{
    const f=Designs.validate(art([raw({race,className:'Wizard',attribute:'book'})])).figures[0],spec=People.characterSpec(f,pal),snapshot=JSON.stringify(spec);
    const c=createCanvas(128,148);Figures.paint(c.getContext('2d'),f,pal,{x:0,y:0,width:128,height:144},'renaissance',createCanvas);
    hashes.add(c.toBuffer().toString('base64'));assert.equal(JSON.stringify(spec),snapshot);
    g.drawImage(c,i%3*128,Math.floor(i/3)*172);g.fillStyle='#ead8af';g.font='13px Georgia';g.fillText(race,i%3*128+5,Math.floor(i/3)*172+166);
  });
  assert.equal(hashes.size,9);save('race-gallery',gallery);
  const dwarf=People.characterSpec({race:'Dwarf',className:'Wizard'}).traits,elf=People.characterSpec({race:'High Elf',className:'Wizard'}).traits;
  assert.equal(dwarf.build,'heavy');assert.equal(dwarf.size,'small');assert.equal(elf.build,'slender');assert.equal(elf.ears,'pointed');
  assert.equal(People.characterSpec({race:'Fey'}).traits.wings,'insect');assert.equal(People.characterSpec({race:'Raakshasa'}).traits.bodyPlan,'humanoid');
});
test('all eleven core classes produce actual costume/tool differences and optional patrons are preserved',()=>{
  const gallery=createCanvas(160*4,184*3),g=gallery.getContext('2d'),hashes=new Set();
  Object.keys(People.classes).forEach((className,i)=>{
    const f=Designs.validate(art([{subject:'mortal',race:'Human',className,pose:'offering'}])).figures[0];
    assert.equal(f.robe,'class');assert.equal(f.attribute,People.classes[className].attribute);
    const c=createCanvas(160,154);Figures.paint(c.getContext('2d'),f,pal,{x:2,y:2,width:156,height:150},'renaissance',createCanvas);
    hashes.add(c.toBuffer().toString('base64'));g.drawImage(c,i%4*160,Math.floor(i/4)*184);g.fillStyle='#ead8af';g.font='11px Georgia';
    g.fillText(className==='Assassin-Fighter-Necromancer-Goddess'?'Mortacia\'s composite class':className,i%4*160+3,Math.floor(i/4)*184+177,154);
  });
  assert.equal(hashes.size,11);save('class-gallery',gallery);
  assert.equal(People.characterSpec({className:'Knight of Atinus'}).traits.outfit.style,'plate');
  assert.equal(People.characterSpec({className:'Wizard'}).traits.outfit.style,'robe');
  assert.equal(People.characterSpec({className:'Assassin'}).traits.outfit.hood,true);
  assert.equal(People.defaults({className:'Necromancer',patron:'Dantuea'}).patron,'Dantuea');
});
test('creature art retains nonhuman anatomy and depicted bodies cannot override canon gods',()=>{
  const preset=JSON.stringify(C.getPresetProceduralSpec('Mortacia'));
  for(const [race,plan]of [['Dragon','draconic'],['Skeleton','skeletal'],['Wraith','spectral'],['Naga','serpent']])
    assert.equal(People.characterSpec({race,className:'Wizard'}).traits.bodyPlan,plan);
  for(const f of [raw({race:'Spaceman'}),raw({className:'Laser Knight'}),raw({patron:'Zeus'}),raw({sex:'exploit'}),
    {subject:'Atinus',pose:'standing',race:'Human'},{subject:'Mortacia',pose:'standing',className:'Wizard'}])assert.throws(()=>Art.validate([art([f])]),/Invalid/);
  assert.equal(JSON.stringify(C.getPresetProceduralSpec('Mortacia')),preset);
});
test('sculptures support race and class anatomy, without confusing a knight with its god',()=>{
  const rows=People.races.map(race=>({label:race+' knight of Atinus',race,className:'Knight of Atinus',pose:'guardian',head:'class',robe:'class',attribute:'sword'}));
  const images=new Set();for(const row of rows){
    const s=S.validate([row])[0];assert.equal(s.form,'human');assert.equal(s.deity,undefined);assert.equal(s.patron,'Atinus');assert.equal(s.robe,'armor');
    const voxels=S.build(28,'portrait',s);assert.equal(voxels.length,28**3);assert.ok(voxels.some(Boolean));images.add(Buffer.from(voxels).toString('base64'));
    assert.deepEqual(S.validate(JSON.parse(JSON.stringify([s]))),[s]);
  }
  assert.ok(images.size>=6);assert.throws(()=>S.validate([{...rows[0],deity:'Atinus'}]),/Invalid/);
});
test('room-derived artwork includes relevant peoples and guilds rather than generic repeats',()=>{
  const rows=Art.plan({indoor:true,source:{roomName:'Mordicar Hall',description:'Mordicar guards a hall of dwarf masons and the forge.'}});
  assert.equal(rows.length,4);assert.ok(rows.every(r=>r.figures.some(f=>f.subject==='Mordicar')));
  assert.ok(rows.some(r=>r.figures.some(f=>f.race==='Dwarf')));assert.ok(rows.some(r=>r.figures.some(f=>f.className==='Mason')));
  const spec=P.compile({...P.fallback('art-meta','Hall'),roomArt:[art([raw({race:'High Elf',className:'Wizard',sex:'Female',patron:'Eredine'})])],
    sculptures:[{label:'An elven mage',race:'High Elf',className:'Wizard',patron:'Eredine',pose:'contemplative',head:'class',robe:'class',attribute:'book'}]});
  assert.equal(P.compile(JSON.parse(JSON.stringify(spec))).id,spec.id);assert.equal(spec.roomArt[0].figures[0].race,'High Elf');
});
test('altar and statue plinths use canonical emblems, but puzzle controls keep their own glyphs',()=>{
  const hashes=new Set();for(const name of Object.keys(Icons.pantheon)){
    const colors=[];for(let y=0;y<25;y++)for(let x=0;x<25;x++)colors.push(V.color('horned_altar',.3+(x+.5)/25*.4,.1,.43-(y+.5)/25*.17,
      [0,-1,0],[.2,.2,.2],'stone',{textures:false,palette:{highlight:[.8,.8,.8]},shrine:{deity:name,candles:0}}));
    hashes.add(JSON.stringify(colors));
  }assert.equal(hashes.size,23);
  const c=createCanvas(144,96),ctx=c.getContext('2d'),diagram={kind:'relief',surface:'wall',label:'Control reference',description:'A verified mark.',motifs:['Mortacia'],puzzleClue:true};
  Art.paint(ctx,createCanvas,diagram,pal);const before=c.toBuffer().toString('base64'),paint=Icons.paint;
  try{Icons.paint=()=>{throw Error('Decorative canon leaked into puzzle glyphs');};Art.paint(ctx,createCanvas,diagram,pal);assert.equal(c.toBuffer().toString('base64'),before);}
  finally{Icons.paint=paint;}
});
test('the art prompt exposes the complete compact canon and people choices in the existing bounded request',()=>{
  const prompt=require('../retort/physicalPuzzleDesign').designPrompt({roomName:'Library',description:'A hall of Eredine.',seed:'test'});
  for(const name of [...Object.keys(Icons.pantheon),...People.races,...Object.keys(People.classes)])assert.ok(prompt.includes(name),name);
  assert.ok(prompt.length<35000);assert.match(prompt,/A knight serving Atinus is not Atinus/);
  assert.match(prompt,/no extra API call/);
});
