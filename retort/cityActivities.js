'use strict';
const E=require('../assets/cityEstablishments');
// Functional duties only. Names, personalities, disputes and plots remain model-authored.
const DUTIES={shop:['arranging goods','checking an order','collecting supplies'],inn:['welcoming guests','preparing a chamber','checking a reservation'],
  bar:['serving refreshments','meeting a colleague','waiting to perform'],workshop:['making a commissioned piece','practicing a craft','collecting an order'],
  clinic:['preparing treatment','waiting for care','organizing supplies'],home:['preparing a meal','visiting a neighbor','resting between shifts'],
  civic:['processing a petition','waiting for an appointment','preparing a meeting'],warehouse:['sorting a shipment','checking dispatch records','collecting a consignment'],
  arena:['preparing the grounds','training for a contest','waiting to watch'],guild:['demonstrating a technique','studying a commission','seeking paid work'],
  park:['tending the garden','taking a break','practicing a performance'],library:['cataloguing a volume','researching a subject','returning a borrowed work'],
  theatre:['preparing a performance','rehearsing a part','waiting for admission'],bathhouse:['preparing the baths','resting after a shift','meeting a companion'],
  transit:['checking departures','waiting to travel','delivering a consignment'],temple:['preparing an observance','keeping a private vigil','visiting the sanctuary'],
  court:['organizing case records','waiting to petition','attending a hearing'],foodhall:['preparing food','taking a meal break','collecting provisions']};
function assignment(type,index,seed,venue={}){
  const p=E.profile(type);if(!p)return{version:1,mode:'errand',duty:'traveler',activity:'traveling between local appointments',routine:'wander'};
  const n=E.hash(seed),slot=index%3,mode=slot===0?'work':slot===1?'visit':'errand',duty=p.roles[slot%p.roles.length];
  const use=p.spaces[(n+slot)%p.spaces.length];
  return{version:1,mode,duty,activity:DUTIES[type][slot],routine:mode==='work'?'work':mode==='visit'?'rest':'wander',
    venueId:venue.id,venueName:venue.name,venueType:type,space:use,contractPolicy:'Only saved contracts have payable terms.'};
}
function work(db,key,name){
  return Object.values(db||{}).flatMap(r=>Object.values(r?.minorMissions||{})).filter(m=>m.status!=='completed'&&
    (m.patron===name&&m.originRoomKey===key||m.recipient===name&&m.roomKey===key))
    .map(m=>({id:m.id,type:m.type||'recovery',status:m.status,description:m.description}));
}
module.exports={DUTIES,assignment,work};
