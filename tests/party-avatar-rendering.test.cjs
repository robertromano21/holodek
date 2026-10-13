'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createCanvas}=require('canvas'),Sprites=require('../assets/renderCharacterSprite');
const html=fs.readFileSync(path.join(__dirname,'../assets/index.html'),'utf8');
const source=html.slice(html.indexOf('    function drawPartySpriteCanvas('),html.indexOf('    function renderPartyIconDock('));
function renderer(generator=Sprites.createCharacterSpriteCanvas){
  const images=[];
  function Image(){const c=createCanvas(96,96);images.push(c);return c;}
  const context={window:{createCharacterSpriteCanvas:generator},Image};vm.runInNewContext(source,context);
  return{draw:context.drawPartySpriteCanvas,images};
}
function bladeCount(canvas){
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;
  for(let i=0;i<data.length;i+=4)if(data[i]===244&&data[i+1]===206&&data[i+2]===142&&data[i+3]===255)count++;
  return count;
}
test('lower-left Mortacia avatar fits her whole approved pose and sword before any saved sprite exists',()=>{
  const {draw}=renderer(),c=createCanvas(36,36),portrait=Sprites.createMortaciaReferenceCanvas(),expected=createCanvas(36,36);
  expected.getContext('2d').imageSmoothingEnabled=false;expected.getContext('2d').drawImage(portrait,0,0,36,36);
  draw(c,{label:'Mortacia',source:{Name:'Mortacia',HP:136,MaxHP:136}});
  assert.deepEqual(c.toBuffer(),expected.toBuffer());assert.ok(bladeCount(c)>=10,'The initial avatar must show the blade, not crop all its pixels');
  assert.equal(c.width,36);assert.equal(c.height,36);
  if(process.env.HOLODEK_ART_PREVIEW==='1'){
    const gallery=createCanvas(432,228),g=gallery.getContext('2d');g.fillStyle='#171717';g.fillRect(0,0,432,228);g.imageSmoothingEnabled=false;
    const cropped=createCanvas(36,36);cropped.getContext('2d').drawImage(portrait,-30,-30);
    g.drawImage(cropped,24,12,180,180);g.drawImage(c,228,12,180,180);g.fillStyle='#e5d9be';g.font='14px Georgia';g.fillText('Before: clipped',24,214);g.fillText('After: full sword',228,214);
    const dir=path.join(__dirname,'../logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'mortacia-avatar-fit.png'),gallery.toBuffer());
  }
});
test('Mortacia avatar is identical before/after startup, with stale cached portraits or either actor role',()=>{
  const {draw,images}=renderer(),c=createCanvas(36,36),sprite={dataUrl:'data:stale-portrait',spec:{kind:'procedural',preset:'mortacia'},artRevision:'old'};
  draw(c,{label:'Mortacia'});const approved=c.toBuffer();
  for(const type of['pc','npc'])for(const Name of['Mortacia','mortacia','Name: Mortacia']){
    const entry={label:'Mortacia',source:{Name,type,hp:136},sprite},before=JSON.stringify(entry);
    draw(c,entry);assert.deepEqual(c.toBuffer(),approved);assert.equal(JSON.stringify(entry),before);
  }
  assert.equal(images.length,0,'Do not asynchronously load stale Mortacia art over the approved avatar');
  const sheet=createCanvas(56,56);draw(sheet,{label:'Mortacia'});assert.ok(bladeCount(sheet)>10);
});
test('generated and saved non-square sprites preserve their proportions instead of being cropped or stretched',()=>{
  const tall=createCanvas(24,96),ctx=tall.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,24,96);
  for(const saved of[false,true]){
    const {draw,images}=renderer(()=>tall),c=createCanvas(36,36);
    draw(c,{label:'Knight',...(saved?{sprite:{dataUrl:'data:tall'}}:{})});
    if(saved){images[0].width=24;images[0].height=96;images[0].getContext('2d').drawImage(tall,0,0);images[0].onload();}
    const p=c.getContext('2d').getImageData(0,0,36,36).data;let occupied=0;
    for(let i=3;i<p.length;i+=4)if(p[i])occupied++;assert.equal(occupied,9*36);assert.equal(c.getContext('2d').imageSmoothingEnabled,false);
  }
});
test('late saved-image loads cannot overwrite a newer character or a cleared sheet preview',()=>{
  const {draw,images}=renderer(),c=createCanvas(36,36);
  draw(c,{label:'Old NPC',sprite:{dataUrl:'data:old-npc'}});draw(c,{label:'Mortacia'});const approved=c.toBuffer();
  const old=images[0];old.getContext('2d').fillRect(0,0,96,96);old.onload();assert.deepEqual(c.toBuffer(),approved);
  draw(c,{label:'Other NPC',sprite:{dataUrl:'data:other-npc'}});draw(c,null);images[1].onload();
  assert.equal(c.getContext('2d').getImageData(0,0,36,36).data.some(Boolean),false);
});
