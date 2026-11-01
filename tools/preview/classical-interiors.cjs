'use strict';
for(const f of ['ARCHITECTURE_EXPANSION','GENRE_EXPANSION','CITY_SITES','CITY_COMPLETE','GENRE_KITS'])process.env['HOLODEK_'+f]='1';
const fs=require('node:fs'),{createCanvas}=require('canvas'),A=require('../../assets/cityArchitectureStyles'),
  Sky=require('../../assets/citySkyline'),K=require('../../assets/cityKit'),V=require('../../assets/scenePropVoxels'),
  Details=require('../../retort/cityClassicalDetails'),Plans=require('../../assets/cityBuildingPlans'),H=require('../../retort/hostLocalFloors');
const canvas=createCanvas(1500,1000),ctx=canvas.getContext('2d');
ctx.fillStyle='#29343a';ctx.fillRect(0,0,1500,1000);ctx.fillStyle='#f0dfbd';ctx.font='26px Georgia';
ctx.fillText('Native Classical Fantasy Architecture | production geometry',28,36);
ctx.font='16px Georgia';ctx.fillText('CPU inspection, not a live game screenshot. Columns, pediments, coffers and vaults are original native meshes.',28,63);
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
function native(part,spec){
  const n=16,g=V.build(part.shape,n,0,spec),out=[];if(!g)return out;
  const at=(x,y,z)=>x>=0&&y>=0&&z>=0&&x<n&&y<n&&z<n&&g[x+y*n+z*n*n];
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(at(x,y,z))for(const axis of [0,1,2]){
    const p=[x,y,z],q=p.slice();q[axis]++;if(at(...q))continue;
    const u=(axis+1)%3,v=(axis+2)%3,normal=[0,0,0];normal[axis]=1;
    out.push({normal,color:rgb(spec.palette?.primary||'#d6b688'),points:[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{
      const r=p.slice();r[axis]++;r[u]+=a;r[v]+=b;return r.map((t,i)=>part.position[['x','y','z'][i]]+t/n*part.size[['x','y','z'][i]]);
    })});
  }
  return out;
}
function draw(quads,cx,cy,scale){
  const project=p=>[cx+(p[0]-p[1])*scale,cy+(p[0]+p[1])*scale*.38-p[2]*scale*1.15];
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),depths=new Float32Array(canvas.width*canvas.height).fill(-Infinity);
  for(const q of quads.filter(q=>q.normal.some(v=>v>0))){
    const shade=q.role?.includes('pane')?1:q.normal[2]>.5?.95:q.normal[0]>.5?.83:.65;
    const color=q.color.map(v=>Math.round(Math.min(255,v*shade*255))),v=q.points.map(p=>[...project(p),p[0]+p[1]+p[2]*.661]);
    for(const ids of [[0,1,2],[0,2,3]]){
      const [a,b,c]=ids.map(i=>v[i]),area=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(area)<1e-8)continue;
      for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<=Math.min(canvas.height-1,Math.ceil(Math.max(a[1],b[1],c[1])));y++)
        for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<=Math.min(canvas.width-1,Math.ceil(Math.max(a[0],b[0],c[0])));x++){
          const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/area,
            w=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/area,t=1-u-w;
          if(Math.min(u,w,t)<-1e-6)continue;const z=u*a[2]+w*b[2]+t*c[2],i=x+y*canvas.width;
          if(z<depths[i])continue;depths[i]=z;for(let k=0;k<3;k++)pixels.data[i*4+k]=color[k];pixels.data[i*4+3]=255;
        }
    }
  }
  ctx.putImageData(pixels,0,0);
}
for(const [i,[genre,type,tradition]]of [['fantasy','guild','roman'],['fantasy','temple','greek'],['dark-fantasy','bathhouse','byzantine']].entries()){
  const b={id:'preview-'+i,seed:3,type,left:0,top:0,base:0,width:24,depth:24,clearance:type==='temple'?7.2:4.2,
    storeys:3,storeyHeightMetres:type==='temple'?19:11.5,entrySides:['south'],metres:{height:type==='temple'?58:35}},
    a=A.envelope(A.choose(genre,b,{tradition,cotg:i===1}),b),p=K.PALETTES[a.paletteName],
    part={cityArchitecture:a,position:{x:0,y:0,z:b.clearance+.4},size:{x:24,y:24,z:a.height}},
    surface=Sky.faces(`a_${genre}_urban_skyline`,{version:1,kind:'rectangle'},a),
    quads=surface.map(f=>({normal:f.normal,color:A.color(a,...f.points[0],f.normal),points:f.points.map(q=>q.map((t,i)=>t*part.size[['x','y','z'][i]]+part.position[['x','y','z'][i]]))})),
    detail=A.facade(part,b,surface,['#ffd598','#eab96d'],'preview'),d={sceneStructures:[],tiles:{}};
  b.visualStyle={architecture:a};Details.frontage(d,b);
  quads.push(...detail.walls,...detail.windows,...d.sceneStructures.flatMap(part=>native(part,d.tiles[part.tile].spriteSpec)));
  draw(quads,250+i*500,345,7.4);ctx.fillStyle='#f0dfbd';ctx.font='19px Georgia';ctx.fillText((i===1?'CotG':'')+' '+genre+' '+type,55+i*500,462);
  ctx.font='14px Georgia';ctx.fillText(tradition+' | original '+a.shape+' crown',55+i*500,485);
}
for(const [i,[type,tradition]]of [['guild','roman'],['temple','greek'],['bathhouse','byzantine']].entries()){
  const style=A.choose('fantasy',{type,seed:3},{tradition}),p=Plans.create({hostKey:'0,0,0',id:'hall',type,genre:'fantasy',width:28,depth:30,storeys:4,visualStyle:{architecture:style}}),
    ref={hostKey:p.hostKey,buildingId:p.id,floor:1},db={[p.hostKey]:{cityArchitecture:{buildings:{[p.id]:{plan:p,floors:{}}}},cityFloors:{buildings:{[p.id]:{floors:{}}}}}};
  db[p.hostKey].cityFloors.buildings[p.id].floors[1]={room:H.floorRoom(db,ref)};
  const d=H.geometry(db,ref),quads=[],bounds=d.cityVenueBounds;
  for(const [key,c]of Object.entries(d.cells)){
    const [x,y]=key.split(',').map(Number);if(c.tile==='floor')quads.push({normal:[0,0,1],color:rgb('#ab916a'),points:[[x,y,c.floorHeight],[x+1,y,c.floorHeight],[x+1,y+1,c.floorHeight],[x,y+1,c.floorHeight]]});
    if(c.feature==='pillar')quads.push(...native({shape:d.tiles[c.tile].spriteSpec.voxelShape,position:{x,y,z:c.floorHeight},size:{x:.8,y:.8,z:c.structureHeight}},d.tiles[c.tile].spriteSpec));
  }
  for(const part of d.sceneStructures.filter(p=>p.role==='city-classical-vault'))quads.push(...native(part,d.tiles[part.tile].spriteSpec));
  for(const q of quads)q.points=q.points.map(p=>[p[0]-bounds.left,p[1]-bounds.top,p[2]]);
  draw(quads,250+i*500,680,6);ctx.fillStyle='#f0dfbd';ctx.font='18px Georgia';ctx.fillText(type+' upper floor: section with flat coffers lifted',35+i*500,902);
  ctx.font='14px Georgia';ctx.fillText(`${d.classicalInterior.columns} native columns, ${d.classicalInterior.vaults} vault bays; ceiling ${Plans.floor(p,1).clearance.toFixed(1)} units`,35+i*500,929);
}
const file='.retort-data/classical-interiors/geometry-sheet.png';fs.mkdirSync('.retort-data/classical-interiors',{recursive:true});fs.writeFileSync(file,canvas.toBuffer('image/png'));
console.log(JSON.stringify({file}));
