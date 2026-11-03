'use strict';
const Secrets=require('./secretDoors'),Items=require('./itemAuthoring'),Economy=require('./economy');
const clone=value=>JSON.parse(JSON.stringify(value));
async function prepare($,state,dungeon,consoleText,{author=Items.generate}={}){
  if(!dungeon?.cells||!dungeon.geoKey)return consoleText;
  if(!dungeon.secretDoors&&!dungeon._geometryStamp&&!dungeon._meta?.geometryStamp)Secrets.install(dungeon);
  const doors=dungeon.secretDoors?.doors||[];
  if(!doors.length)return consoleText;
  const key=dungeon.geoKey,runId=state.getDungeonRunId(),database=JSON.parse(state.getRoomNameDatabase()||'{}'),room=database[key];
  if(!room)return consoleText;
  const stored=new Map((room.secretDoors?.doors||[]).map(door=>[door.id,door]));
  const occupied=new Set((dungeon.sceneObjects||[]).map(item=>`${item.x},${item.y}`));
  const plans=doors.map(door=>{
    const reward=door.reward||stored.get(door.id)?.reward;
    const existing=reward&&(room.objects||[]).find(item=>item.economyItemId===reward.itemId);
    const placed=existing&&(dungeon.sceneObjects||[]).find(item=>item.name===existing.name);
    if(reward&&!existing||placed)return{door,reward};
    const cell=(door.chamber||[]).find(key=>dungeon.cells[key]?.tile==='floor'&&!occupied.has(key)&&
      !dungeon.cells[key].blocked&&!dungeon.cells[key].obstacle&&!dungeon.cells[key].feature&&!dungeon.cells[key].interactable);
    if(!cell)throw Error('A secret chamber has no safe reward placement: '+door.id);
    occupied.add(cell);const [x,y]=cell.split(',').map(Number);
    return{door,reward,existing,x,y};
  });
  const missing=plans.filter(plan=>!plan.reward);
  const authored=missing.length?await author($,{count:missing.length,roomName:room.name,roomDescription:room.description,
    database,world:database['0,0,0']?.setting||require('./settingLayer').current(),
    excluded:[...Object.values(database).flatMap(room=>(room?.objects||[]).map(item=>item.name)).slice(-40),...(room.objects||[]).map(item=>item.name)],
    purpose:'bonus rewards for sealed secret chambers, one useful portable item per chamber IN ADDITION to the ordinary room objects'}):[];
  if(authored.length!==missing.length)throw Error('Each secret chamber needs its own authored bonus object.');
  if(runId!==state.getDungeonRunId())throw Error('The game changed while preparing secret chamber rewards.');
  const current=JSON.parse(state.getRoomNameDatabase()||'{}'),target=current[key];
  if(!target)throw Error('The secret chamber room is no longer available.');
  const names=new Set((target.objects||[]).map(item=>String(item.name).toLowerCase()));
  for(const item of authored){
    if(!item?.name||names.has(item.name.toLowerCase()))throw Error('Secret chamber rewards must have distinct authored names.');
    names.add(item.name.toLowerCase());
  }
  let index=0,changed=false;
  for(const plan of plans){
    if(!plan.reward){
      const item={...authored[index++],economyItemId:`secret-loot:${key}:${plan.door.id}`,secretDoorId:plan.door.id};
      (target.objects||=[]).push(item);plan.existing=item;
      plan.reward={version:1,itemId:item.economyItemId,name:item.name};changed=true;
    }
    if(plan.reward&&!plan.door.reward){plan.door.reward=clone(plan.reward);changed=true;}
    if(plan.existing&&Number.isFinite(plan.x)){
      (dungeon.sceneObjects||=[]).push({id:plan.reward.itemId,name:plan.existing.name,type:plan.existing.type,
        magic:plan.existing.magic||0,x:plan.x,y:plan.y,secretDoorId:plan.door.id,fixed:true});changed=true;
    }
  }
  if(!changed)return consoleText;
  target.secretDoors=clone(dungeon.secretDoors);
  state.setRoomNameDatabase(JSON.stringify(current));
  const text=Economy.syncGround(consoleText,target);
  state.setUpdatedGameConsole(text);
  if(missing.length)console.info('[SecretRoomLoot]',JSON.stringify({runId,geoKey:key,chambers:doors.length,added:missing.length}));
  return text;
}
module.exports={prepare};
