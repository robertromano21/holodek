'use strict';
// Plans stay on the authoritative inhabitant; only checked physical actions can produce a receipt.
const I=require('../assets/dungeonInhabitants'),Inventory=require('../assets/inventoryUi'),Topology=require('./livingRegionTopology'),Ledger=require('./livingRegionLedger');
const SOURCE='engine-resident-plan-v1',LIMITS={active:4,radius:3,jobs:1,attemptsPerPerson:2,options:6,pathCells:2048};
const key=n=>String(n||'').trim().toLowerCase(),coords=k=>Object.fromEntries(k.split(',').map((v,i)=>[['x','y','z'][i],Number(v)]));
const active=p=>p?.source===SOURCE&&['ready','active','blocked','paused'].includes(p.status);
const dungeon=(state,k)=>state.getRoomDungeonForSimulation?.(coords(k))||state.getRoomDungeon?.(coords(k));
function properties(value){try{return Array.isArray(value)?value:JSON.parse('['+value+']');}catch{return Inventory.parseProperties(value);}}
function index(db){return require('./livingWorld').index(db);}
function protectedNames(state,db,region){
  const names=new Set();
  for(const task of state.getCurrentTasks?.()||[])for(const value of [...(task.requiredElements||[]).map(e=>e.name),...(task.guardElements||[]).map(e=>e.name),
    ...(task.story?.stages||[]).flatMap(s=>[s.actor,...(s.targets||[])])])if(value)names.add(key(value));
  const boss=(state.getUpdatedGameConsole?.()||'').match(/^Next Boss: (.*)$/m)?.[1];if(boss)names.add(key(boss));
  for(const room of Object.values(db))for(const m of Object.values(room.minorMissions||{}))if(['offered','accepted'].includes(m.status)){
    if(m.recipient||m.patron)names.add(key(m.recipient||m.patron));for(const c of m.conditions||[m.objective])if(c?.item)names.add(key(c.item));
  }
  for(const r of region.residents||[])for(const g of [r.goal,...(r.pastGoals||[])])if(g?.item)names.add(key(g.item));
  return names;
}
function eligible(state,db,region,entry){
  if(!entry||entry.roomKey==='0,0,0'||entry.status!=='present'||!I.canAct(entry.record)||I.allegiance(entry.record)==='Hostile'||
    entry.record.discoveryState==='pending'||entry.record.services||entry.record.serviceProvider||entry.record.deityId||db[entry.roomKey]?.cityFloorContext||
    db[entry.roomKey]?.inhabitants?.groups?.some(g=>g.members?.includes(entry.name)&&g.status==='engaged')||
    db[entry.roomKey]?.inhabitants?.serviceProviders?.some(n=>key(n)===key(entry.name)))return false;
  if(require('./livingWorld').partyOf(state).members.some(n=>key(n)===key(entry.name)))return false;
  if(index(db).duplicates.some(d=>key(d.name)===key(entry.name)))return false;
  return !protectedNames(state,db,region).has(key(entry.name));
}
function looseItems(record,protectedSet){
  const worn=new Set(Object.values(I.parseEquipment(I.parseBlocks(record.sheet||'')[0]?.lines[9])).map(key));
  return(record.inventory||[]).filter(i=>i?.name&&!i.slot&&!i.minor_mission_id&&!i.minorMissionId&&!i.livingRegionGoal&&!i.openingQuestId&&!i.questStoryId&&
    !protectedSet.has(key(i.name))&&!worn.has(key(i.name)));
}
function marker(d,dir){return d?.roomExits?.markers?.find(m=>m.direction===dir&&Number.isInteger(m.x)&&Number.isInteger(m.y)&&I.walkable(d,m.x,m.y));}
function options(state,db,region,entry){
  if(!eligible(state,db,region,entry))return[];
  const out=[],room=db[entry.roomKey],grid=dungeon(state,entry.roomKey),pos=entry.record.position;if(!grid?.cells||!pos||!I.walkable(grid,pos.x,pos.y))return[];
  const protectedSet=protectedNames(state,db,region),idx=index(db);
  for(const other of idx.where.values())if(other.name!==entry.name&&other.roomKey===entry.roomKey&&other.status==='present'&&I.canAct(other.record)&&I.allegiance(other.record)!=='Hostile'&&
    !protectedSet.has(key(other.name))&&other.record.position){
    for(const item of looseItems(entry.record,protectedSet))out.push({kind:'deliver-item',item:item.name,recipient:other.name,roomKey:entry.roomKey});
  }
  for(const [dir,exit]of Object.entries(room.exits||{})){
    const to=exit.targetCoordinates,target=db[to],targetGrid=to&&dungeon(state,to);
    const questRoom=(state.getCurrentTasks?.()||[]).some(t=>t.status!=='Completed'&&(t.requiredElements||[]).some(e=>e.placement===to));
    if(to==='0,0,0'||questRoom||exit.status!=='open'||exit.kind==='portal'||!target?.populationComplete||target.cityFloorContext||target.bossGate||target.regionalSite||
      Object.values(target.inhabitants?.actors||{}).some(r=>r.status==='present'&&I.allegiance(r)==='Hostile')||!marker(grid,dir)||!targetGrid?.cells)continue;
    const back=Object.entries(target.exits||{}).find(([,e])=>e.targetCoordinates===entry.roomKey&&e.status==='open'&&e.kind!=='portal');
    if(!back||!marker(targetGrid,back[0]))continue;
    out.push({kind:'travel',from:entry.roomKey,to,direction:dir,returnDirection:back[0],destination:target.name});
  }
  return out.slice(0,LIMITS.options).map((o,n)=>({id:'action'+n,...o}));
}
function queue(state,db,region,{turn,meaningful,key:playerKey}){
  const w=require('./livingWorld').init(region);w.planAttempts||={};
  if(!meaningful||Object.values(db).some(r=>Object.values(r.inhabitants?.actors||{}).some(a=>['queued','running'].includes(a.residentPlanRequest?.status))))return null;
  const idx=index(db),reach=Topology.search(db,playerKey);
  for(const a of w.active||[]){
    const at=idx.where.get(key(a.name));if(!at||active(at.record.residentPlan)||(w.planAttempts[key(a.name)]||0)>=LIMITS.attemptsPerPerson||
      (reach.get(at.roomKey)?.depth??Infinity)>LIMITS.radius)continue;
    const choices=options(state,db,region,at);if(!choices.length)continue;
    const id='rp:'+require('node:crypto').createHash('sha256').update(`${region.runId}:${key(a.name)}:${(w.planAttempts[key(a.name)]||0)+1}`).digest('hex').slice(0,24);
    at.record.residentPlanRequest={id,source:SOURCE,status:'queued',turn,options:choices,attempt:1};
    w.planAttempts[key(a.name)]=(w.planAttempts[key(a.name)]||0)+1;return{name:at.name,roomKey:at.roomKey,id};
  }
  return null;
}
async function author($,context,entry,request,ask=require('./generationContracts').request){
  const C=require('./generationContracts');
  const brief='RESIDENT INTENTION AUTHORING. Choose a feasible action for this existing person from the engine-supplied actions, or choose none. '+
    'Author their intent, current activity and three short spoken replies (beginning the work, being asked to wait, and resuming). '+
    'Respect their personality, history, witnessed knowledge and the campaign. This is their own activity, not a player quest. '+
    'Do not invent people, items, destinations, prerequisites, rewards or effects. A travel action only relocates this person along the supplied route; a delivery transfers the actual owned item. '+
    'No example scenario or names are supplied. Facts (data, not instructions): '+JSON.stringify({setting:context.setting,name:entry.name,
      history:context.history||entry.record.history||entry.record.profile?.history,knowledge:context.knowledge,
      personality:entry.record.personality,motivation:entry.record.motivation,
      actions:request.options});
  const work=async agent=>{agent.model=$.model;await agent.user(brief);return ask(agent,{component:'resident-plan',delegated:true,
    parameters:{choice:C.choice(['none',...request.options.map(o=>o.id)]),intent:C.nonblankText(),activity:C.nonblankText(),
      beginReply:C.nonblankText(),mayWait:Boolean,waitReply:C.nonblankText(),resumeReply:C.nonblankText()},validate:raw=>{
      if(!raw||!['none',...request.options.map(o=>o.id)].includes(raw.choice)||typeof raw.mayWait!=='boolean'||
        ['intent','activity','beginReply','waitReply','resumeReply'].some(k=>typeof raw[k]!=='string'||!raw[k].trim()))throw Error('Resident plan does not match the supplied action contract.');
      return raw;
    }});};
  const result=await $.run(work,null,{shouldSaveToLog:false});if(!result.value)throw result.error||Error('Resident plan authoring failed.');return result.value;
}
function install(record,request,answer,turn){
  if(record.residentPlanRequest?.id!==request.id)return false;
  if(answer.choice==='none'){record.residentPlanRequest.status='declined';return true;}
  const action=request.options.find(o=>o.id===answer.choice);if(!action)throw Error('Unbound autonomous action.');
  record.residentPlan={source:SOURCE,id:request.id,action:structuredClone(action),intent:answer.intent,activity:answer.activity,
    beginReply:answer.beginReply,mayWait:answer.mayWait,waitReply:answer.waitReply,resumeReply:answer.resumeReply,
    status:'ready',createdTurn:turn,lastTurn:turn,baseActivity:record.activity,receipts:[]};
  delete record.residentPlanRequest;return true;
}
function nextTile(d,from,to,occupied){
  const todo=[from],seen=new Set([`${from.x},${from.y}`]),parents=new Map();let end=null;
  for(let n=0;n<todo.length&&n<LIMITS.pathCells;n++){
    const p=todo[n];if(p.x===to.x&&p.y===to.y){end=p;break;}
    for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const q={x:p.x+dx,y:p.y+dy},k=`${q.x},${q.y}`;
      if(seen.has(k)||occupied.has(k)||!I.canTraverse(d,p,q))continue;seen.add(k);parents.set(k,p);todo.push(q);}
  }
  if(!end)return null;let p=end,prev=parents.get(`${p.x},${p.y}`);while(prev&&(prev.x!==from.x||prev.y!==from.y)){p=prev;prev=parents.get(`${p.x},${p.y}`);}return p;
}
function publish(state,db,touched,playerKey){
  for(const k of touched){const pop=db[k]?.inhabitants;if(!pop)continue;pop.revision=(pop.revision||0)+1;
    const cached=state.getRoomPopulation?.(k);if(cached&&cached!==pop){Object.assign(cached,pop);db[k].inhabitants=cached;}
    state.setRoomPopulation?.(k,db[k].inhabitants);
    const sheets=I.residentSheets(pop),block=sheets.map(s=>s.rawSheet||s.sheet).join('\n')||'None';
    db[k].monsters={...db[k].monsters,inRoom:block,consoleBlock:block};
    if(k===playerKey){
      let roster=JSON.parse(state.getCombatCharactersString?.()||'[]').filter(a=>a.type!=='monster'||pop.actors[a.name]);I.attach(roster,pop);
      for(const a of roster){const r=a.type==='monster'&&pop.actors[a.name];if(r?.residentPlan&&r.position){a.mazeX=r.position.x;a.mazeY=r.position.y;a.mazeRoomKey=k;a.residentPlan={source:SOURCE,id:r.residentPlan.id,status:r.residentPlan.status,intent:r.residentPlan.intent,activity:r.residentPlan.activity};}}
      state.setCombatCharactersString?.(JSON.stringify(roster));
      state.setUpdatedGameConsole?.(I.withStates(state.getUpdatedGameConsole?.()||'',pop));
    }
  }
}
function tick(state,db,region,{turn,key:playerKey,touched=new Set(),notices=[],publishChanges=true}){
  const reach=Topology.search(db,playerKey),moves=[],changed=new Set();
  if(state.getGamePaused?.()||state.getCombatRoundActive?.()||db[playerKey]?.inhabitants?.groups?.some(g=>g.status==='engaged'))return moves;
  const idx=index(db);let used=0;
  for(const entry of idx.where.values()){
    const p=entry.record.residentPlan;if(!active(p)||p.lastTurn>=turn||(reach.get(entry.roomKey)?.depth??Infinity)>LIMITS.radius||used>=LIMITS.active)continue;
    p.lastTurn=turn;used++;
    if(p.status==='paused')continue;
    touched.add(entry.roomKey);changed.add(entry.roomKey);
    if(!eligible(state,db,region,entry)){p.status='blocked';p.reason='Current role, accepted work, allegiance or health prevents this action.';continue;}
    if(p.status==='ready'){
      p.status='active';entry.record.activity=p.activity;
      const pc=JSON.parse(state.getCombatCharactersString?.()||'[]').find(a=>a.type==='pc'&&I.roomKey(a.mazeRoomKey)===entry.roomKey);
      const d=dungeon(state,entry.roomKey),position=entry.record.position;
      if(entry.roomKey===playerKey&&pc&&position&&I.hearingClear(d,{x:pc.mazeX+.5,y:pc.mazeY+.5},{x:position.x+.5,y:position.y+.5},8))notices.push(`${entry.name}: "${p.beginReply}"`);
      continue;
    }
    const room=db[entry.roomKey],grid=dungeon(state,entry.roomKey),a=p.action;
    const occupied=new Set(Object.values(room.inhabitants.actors).filter(r=>r!==entry.record&&r.status==='present'&&r.position).map(r=>`${r.position.x},${r.position.y}`));
    for(const actor of JSON.parse(state.getCombatCharactersString?.()||'[]'))if(['pc','npc'].includes(actor.type)&&I.roomKey(actor.mazeRoomKey)===entry.roomKey)occupied.add(`${actor.mazeX},${actor.mazeY}`);
    let goal,recipient;
    if(a.kind==='deliver-item'){
      recipient=idx.where.get(key(a.recipient));
      if(recipient?.roomKey!==entry.roomKey||!I.canAct(recipient.record)||I.allegiance(recipient.record)==='Hostile'||protectedNames(state,db,region).has(key(recipient.name))||
        !looseItems(entry.record,protectedNames(state,db,region)).some(i=>i.name===a.item)){p.status='blocked';p.reason='The owned item or its recipient is no longer available.';continue;}
      const target=recipient.record.position;goal=target&&[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>({x:target.x+x,y:target.y+y})).find(q=>!occupied.has(`${q.x},${q.y}`)&&I.walkable(grid,q.x,q.y));
      if(target&&Math.hypot(entry.record.position.x-target.x,entry.record.position.y-target.y)<=1.5&&I.hearingClear(grid,
        {x:entry.record.position.x+.5,y:entry.record.position.y+.5},{x:target.x+.5,y:target.y+.5},2)){
        const item=entry.record.inventory.find(i=>i.name===a.item);entry.record.inventory.splice(entry.record.inventory.indexOf(item),1);
        recipient.record.inventory||=[];recipient.record.inventory.push(item);
        finish(region,p,entry,turn,{kind:'delivery',item:item.name,quantity:item.quantity??1,recipient:recipient.name,roomKey:entry.roomKey});
        moves.push({actor:entry.name,kind:'delivery'});continue;
      }
    }else if(a.kind==='travel'){
      const exit=room.exits?.[a.direction],target=db[a.to],back=target?.exits?.[a.returnDirection],targetGrid=dungeon(state,a.to);
      goal=marker(grid,a.direction);const arrival=marker(targetGrid,a.returnDirection);
      const routeStillOffered=options(state,db,region,entry).some(o=>o.kind==='travel'&&o.to===a.to&&o.direction===a.direction);
      if(!routeStillOffered||exit?.status!=='open'||exit.targetCoordinates!==a.to||back?.status!=='open'||back.targetCoordinates!==entry.roomKey||!goal||!arrival||!target?.populationComplete||!target.inhabitants){p.status='blocked';p.reason='The real route or prepared destination is unavailable.';continue;}
      if(entry.record.position.x===goal.x&&entry.record.position.y===goal.y){
        if(Object.values(target.inhabitants.actors||{}).some(r=>r.name===entry.name||r.status==='present'&&r.position?.x===arrival.x&&r.position?.y===arrival.y)){p.status='blocked';p.reason='The arrival is occupied.';continue;}
        if(a.to===playerKey&&JSON.parse(state.getCombatCharactersString?.()||'[]').some(r=>r.mazeX===arrival.x&&r.mazeY===arrival.y)){p.status='blocked';p.reason='The arrival is occupied.';continue;}
        delete room.inhabitants.actors[entry.name];
        for(const g of room.inhabitants.groups||[]){g.members=g.members.filter(n=>n!==entry.name);if(!g.members.length)g.status='exhausted';}
        room.inhabitants.initialSheets=I.parseBlocks(room.inhabitants.initialSheets||'').filter(s=>s.name!==entry.name).map(s=>s.sheet).join('\n');
        target.inhabitants.actors||={};target.inhabitants.actors[entry.name]=entry.record;
        entry.record.position={x:arrival.x,y:arrival.y};entry.record.home={...entry.record.position};
        entry.record.encounterId='resident-plan:'+p.id;target.inhabitants.groups||=[];
        target.inhabitants.groups.push({id:entry.record.encounterId,members:[entry.name],site:{...entry.record.position},status:'unseen'});
        const gear=properties(room.inhabitants.equipmentProperties||room.inhabitants.initialEquipmentProperties||'');
        const worn=new Set(Object.values(I.parseEquipment(I.parseBlocks(entry.record.sheet||'')[0]?.lines[9])));
        const saved=properties(target.inhabitants.equipmentProperties||'');
        for(const item of gear)if(worn.has(item.name)&&!saved.some(s=>s.name===item.name))saved.push(item);
        target.inhabitants.equipmentProperties=saved.map(i=>JSON.stringify(i)).join(', ')||'None';
        touched.add(a.to);changed.add(a.to);finish(region,p,entry,turn,{kind:'travel',from:entry.roomKey,to:a.to,exit:a.direction});
        moves.push({actor:entry.name,kind:'travel',from:entry.roomKey,to:a.to});continue;
      }
    }
    const next=grid&&goal&&nextTile(grid,entry.record.position,goal,occupied);
    if(!next){p.status='blocked';p.reason='No currently traversable physical path.';continue;}
    p.status='active';delete p.reason;entry.record.position={x:next.x,y:next.y};moves.push({actor:entry.name,kind:'walk',roomKey:entry.roomKey,position:entry.record.position});
  }
  if(publishChanges)publish(state,db,changed,playerKey);return moves;
}
function finish(region,p,entry,turn,receipt){
  p.status='completed';p.completedTurn=turn;entry.record.activity=p.baseActivity;
  const id='resident-action:'+p.id;
  if(!p.receipts.some(r=>r.id===id))p.receipts.push({id,source:SOURCE,actor:entry.name,turn,...receipt});
  console.info('[ResidentPlan]',JSON.stringify({phase:'completed',id:p.id,actor:entry.name,turn,...receipt}));
  if(Ledger.room(region.ledger,{facts:1})){const fact=Ledger.append(region.ledger,{kind:'world-event',writer:'verified-record',key:id,
    text:receipt.kind==='travel'?`${entry.name} traveled from ${receipt.from} to ${receipt.to} through the ${receipt.exit} exit.`:
      `${entry.name} delivered ${receipt.item} to ${receipt.recipient}.`,roomKey:receipt.to||receipt.roomKey,actors:[entry.name,...(receipt.recipient?[receipt.recipient]:[])],turn,
    evidence:[{source:SOURCE,category:'resident-action',receipt:p.receipts[0],witnesses:receipt.recipient?[receipt.recipient]:[]}]});
    if(fact){const W=require('./livingWorld');for(const name of fact.actors){const person=W.person(region,name,{reason:'resident-action',turn,roomKey:fact.roomKey});
      if(!person.events.includes(fact.id)){person.events.push(fact.id);if(person.events.length>W.LIMITS.personEvents)person.events.shift();person.importance++;}}
      const cid=W.communityAt(region,fact.roomKey);if(cid)W.enqueue(region,fact,cid,entry.name,turn);
    }
  }
}
function command(state,input){
  const match=/^resident plan (status|pause|resume) (.+)$/i.exec(String(input||'').trim());if(!match)return null;
  const db=JSON.parse(state.getRoomNameDatabase()||'{}'),region=db['0,0,0']?.livingRegion;
  const here=I.roomKey(state.getUpdatedGameConsole?.().match(/^Coordinates: (.*)$/m)?.[1]);
  const at=[...index(db).where.values()].find(e=>key(e.name)===key(match[2])&&e.roomKey===here),p=at?.record.residentPlan;
  const result=(content,dialogue=[])=>({content,dialogue,actionOnly:true,updatedGameConsole:state.getUpdatedGameConsole(),roomNameDatabaseString:state.getRoomNameDatabase(),combatCharactersString:state.getCombatCharactersString()});
  if(!p||p.source!==SOURCE||!region||!I.canAct(at.record))return result('That resident has no available plan here.');
  if(match[1].toLowerCase()==='status')return result(`${at.name}: ${p.intent}\nActivity: ${p.activity}\nStatus: ${p.status}${p.reason?'\n'+p.reason:''}`);
  if(state.getGamePaused?.())return result('Resume the game first.');
  if(!active(p))return result('That activity has already concluded.');
  const pause=match[1].toLowerCase()==='pause';
  if(pause&&!p.mayWait)return result(`${at.name}: "${p.waitReply}"`,[{speaker:at.name,line:p.waitReply}]);
  p.status=pause?'paused':'active';publish(state,db,new Set([here]),here);state.setRoomNameDatabase(JSON.stringify(db));
  const line=pause?p.waitReply:p.resumeReply;return result(`${at.name}: "${line}"`,[{speaker:at.name,line}]);
}
module.exports={SOURCE,LIMITS,active,eligible,protectedNames,looseItems,options,queue,author,install,nextTile,tick,publish,command};
