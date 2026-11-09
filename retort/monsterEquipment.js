'use strict';
const Items=require('./itemAuthoring'),I=require('../assets/dungeonInhabitants');
const slots={weapon:'Weapon',armor:'Armor',shield:'Shield',other:'Other'};
function loadouts(party=[],consoleText=''){
  const properties=['Inventory Properties','Party Equipped Properties','Monsters Equipped Properties'].flatMap(label=>
    I.parseEquipmentProperties(consoleText.match(new RegExp('^'+label+':[ \\t]*([^\\r\\n]*)','m'))?.[1]));
  return require('./encounterBalance').partyMembers(party,consoleText).map(actor=>{
    const equipped=actor.lines?.[9]?I.parseEquipment(actor.lines[9]):actor.Equipped||actor.equipped||I.parseEquipment(actor.sheet?.match(/Equipped:[^\r\n]*/)?.[0]||'');
    const stat=(lower,upper)=>actor.lines?actor[lower]:actor[upper]??actor[lower];
    return {name:actor.name||actor.Name,level:stat('level','Level'),
      active:(stat('hp','HP')??1)>0&&!actor.noncombatant&&actor.combatant!==false,
      totals:{attack:stat('attack','Attack'),damage:stat('damage','Damage'),armor:stat('armor','Armor'),ac:stat('ac','AC')},
      items:Object.entries(equipped).flatMap(([slot,value])=>{
      const name=typeof value==='string'?value:value?.name;
      if(!name||/^(none|null)$/i.test(name))return[];
      const held=Object.values(actor.Equipped||{}).find(item=>item?.name===name),p=held||properties.find(item=>item.name.toLowerCase()===name.toLowerCase());
      return[{slot,name,...Object.fromEntries(Object.keys(Items.MODIFIERS).filter(key=>Number.isFinite(value?.[key]??p?.[key]))
        .map(key=>[key,value?.[key]??p[key]]))}];
    })};
  });
}
function plan(actors,{party=[],consoleText='',random=Math.random}={}){
  const draw=()=>{const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('Invalid equipment roll.');return n;};
  const opponents=loadouts(party,consoleText),mortal=opponents.filter(a=>a.active&&a.name?.trim().toLowerCase()!=='mortacia');
  const minimum=Math.max(1,Math.min(3,Math.round(mortal.reduce((n,a)=>n+a.items.length,0)/(mortal.length||1))));
  const assignments=[];
  for(const actor of actors){
    const hostile=actor.State==='Hostile',count=Math.max(hostile?minimum:1,1+Math.floor(draw()*3)),pool=[...Items.TYPES];
    for(let index=0;index<count;index++){
      const type=index===0&&hostile?'weapon':pool[Math.floor(draw()*pool.length)];pool.splice(pool.indexOf(type),1);
      assignments.push({owner:actor.Name,race:actor.Race,className:actor.Class,level:actor.Level,allegiance:actor.State,type,slot:slots[type]});
    }
  }
  return{assignments,party:opponents};
}
const serialize=items=>items.map(item=>JSON.stringify(item)).join(', ')||'None';
function merge(value,items){return serialize([...I.parseEquipmentProperties(value),...items]);}
async function equip($,actors,options={}){
  const selected=plan(actors,options),items=[],excluded=[...(options.excluded||[]),...selected.party.flatMap(a=>a.items.map(i=>i.name))];
  // Author in bounded batches; commit only after every item's identity and modifiers validate.
  for(let start=0;start<selected.assignments.length;start+=8){
    const assignments=selected.assignments.slice(start,start+8);
    const batch=await Items.generate($,{...options,count:assignments.length,typePlan:assignments.map(a=>a.type),allowHealing:false,excluded,
      purpose:'personal monster equipment',equipmentContext:{assignments,party:selected.party}});
    for(const [index,item]of batch.entries())items.push({...item,owner:assignments[index].owner,slot:assignments[index].slot});
    excluded.push(...batch.map(item=>item.name));
  }
  for(const item of items){
    const actor=actors.find(a=>a.Name===item.owner);actor.Equipped[item.slot]=item;
    actor.Attack+=item.attack_modifier;actor.Damage+=item.damage_modifier;actor.Armor+=item.ac;actor.AC+=item.ac;actor.Magic+=item.magic;
  }
  return items;
}
module.exports={plan,loadouts,equip,serialize,merge};
