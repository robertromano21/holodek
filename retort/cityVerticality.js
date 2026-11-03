'use strict';
const Flags=require('./worldFlags');
const TRANSIT=['stairs','lift','ramps'];
function schema(C){return{floors:{type:Number,minimum:1,maximum:160,multipleOf:1},transit:C.choice(TRANSIT),bridges:Boolean,
  lowerUse:C.nonblankText(90),middleUse:C.nonblankText(90),upperUse:C.nonblankText(90),roofUse:C.nonblankText(90)};}
function validate(p){
  if(!Number.isInteger(p?.floors)||p.floors<1||p.floors>160||!TRANSIT.includes(p.transit)||typeof p.bridges!=='boolean'||
    ['lowerUse','middleUse','upperUse','roofUse'].some(k=>typeof p[k]!=='string'||!p[k].trim()))throw Error('Invalid authored city verticality.');
  return p;
}
function profile(city,underground=false){
  const p=city?.design?.verticality;
  if(!Flags.on('ARCHITECTURE_EXPANSION')||underground||!p)return null;
  validate(p);return p.floors>=4?p:null;
}
function reserve(city,underground=false){return profile(city,underground)?6:0;}
function add(rooms,city,{underground=false}={}){
  const p=profile(city,underground);if(!p)return;
  const ranked=['residential','guild','temple','market','harbor','gate'];
  const candidates=rooms.filter(r=>r.kind==='building'&&!r.entrance&&!r.venue?.openAir&&!r.venue?.monumental).sort((a,b)=>ranked.indexOf(a.district)-ranked.indexOf(b.district)||a.key.localeCompare(b.key));
  const chosen=[],streets=new Set();
  for(const room of candidates)if(!streets.has(room.streetKey)){chosen.push(room);streets.add(room.streetKey);if(chosen.length===2)break;}
  const crowns=[],names=new Set(rooms.map(r=>r.name));
  for(const ground of chosen){
    const [x,y,z]=ground.key.split(',').map(Number),towerId='tower:'+ground.key;
    ground.vertical={towerId,floor:0,storeys:p.floors,transit:p.transit,use:p.lowerUse};
    const levels=[Math.ceil(p.floors/2),p.floors-1,p.floors],uses=[p.middleUse,p.upperUse,p.roofUse];
    let previous=ground;
    for(let i=0;i<levels.length;i++){
      // Storage layers identify landmark stops, not physical floor numbers. Other floors remain lazy.
      const key=`${x},${y},${z+i+1}`;
      if(rooms.some(r=>r.key===key))throw Error('City vertical layer collision: '+key);
      const floor=levels[i],base=ground.name.slice(0,55)+(i===2?' Crown Access':` Level ${floor}`);
      let name=base,suffix=2;while(names.has(name))name=base+' '+suffix++;names.add(name);
      const next={...ground,key,name,label:name,establishmentType:'civic',authored:false,venueId:undefined,
        ...(ground.venue?{venue:{...require('./cityLife').venue('civic',towerId+':'+floor,name),width:ground.venue.width,depth:ground.venue.depth}}:{}),atmosphere:uses[i],exits:{},
        vertical:{towerId,floor,storeys:p.floors,transit:p.transit,use:uses[i],roofAccess:i===2}};
      previous.exits.up={status:'open',targetCoordinates:key,transport:p.transit,label:`${p.transit} to level ${floor}`};
      next.exits.down={status:'open',targetCoordinates:previous.key,transport:p.transit,label:`${p.transit} to level ${previous.vertical.floor}`};
      rooms.push(next);previous=next;
    }
    crowns.push(previous);
  }
  if(p.bridges&&crowns.length===2){
    const [a,b]=crowns,dx=Number(b.key.split(',')[0])-Number(a.key.split(',')[0]),dy=Number(b.key.split(',')[1])-Number(a.key.split(',')[1]);
    const direction=Math.abs(dx)>=Math.abs(dy)?dx>=0?'east':'west':dy>=0?'north':'south';
    const reverse={east:'west',west:'east',north:'south',south:'north'}[direction];
    a.exits[direction]={status:'open',targetCoordinates:b.key,transport:'covered-skybridge',label:'Covered crown skybridge'};
    b.exits[reverse]={status:'open',targetCoordinates:a.key,transport:'covered-skybridge',label:'Covered crown skybridge'};
  }
}
module.exports={TRANSIT,schema,validate,profile,reserve,add};
