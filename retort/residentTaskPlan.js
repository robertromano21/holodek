'use strict';
const C=require('./generationContracts');
const KINDS=['retrieve','puzzle','read','defeat','conversation'];
const EXCHANGES=['share_memory','answer_question','explain','share_information'];
const RULES='TYPED TASK PLAN: write one simple, meaningful local task using the engine-selected primary kind. Unused groups are empty arrays. Select only existing target enums. retrieve: find and give the actual item to this resident; a real book may additionally require reading one of its stored chapters before the handoff. puzzle: solve the actual mechanism. read: read the specified stored chapter. defeat: overcome the specified existing hostile. conversation: one concrete exchange judged from the actual player reply. Tie the request to this individual and the active story, not an abstract exercise or invented prerequisite. Everything must be achievable with existing room content. The engine verifies actual actions; do not add a debrief, repeated waiting, counters or extra commands. Author complete natural instructions, motives and dialogue, never stock examples.';
const RETIRED=/\b(?:observ(?:e|es|ed|ing|ation|ations)|report(?:s|ed|ing)?)\b/i;
function select(choices,{seed='',random}={}){
  const roll=random?random():require('node:crypto').createHash('sha256').update(seed).digest().readUInt32LE(0)/4294967296;
  if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Task selection needs a unit-interval roll.');
  const available=choices.filter(c=>KINDS.includes(c.kind)),physical=available.some(c=>['retrieve','puzzle'].includes(c.kind));
  const both=available.some(c=>c.kind==='retrieve')&&available.some(c=>c.kind==='puzzle');
  const weights=physical?{retrieve:both ? .45 : .9,puzzle:both ? .45 : .9,conversation:.1}:{read:.75,defeat:.15,conversation:.1};
  const rows=Object.entries(weights).filter(([kind])=>available.some(c=>c.kind===kind)),total=rows.reduce((n,[,w])=>n+w,0);
  if(!total)return {primary:null,choices:[]};
  let value=roll*total,primary=rows.at(-1)[0];for(const [kind,weight]of rows){value-=weight;if(value<0){primary=kind;break;}}
  let targets=available.filter(c=>c.kind===primary);
  if(primary==='retrieve' && targets.some(c=>c.secretDoorId))targets=targets.filter(c=>c.secretDoorId);
  const books=new Set(targets.filter(c=>c.readableId).map(c=>c.readableId));
  return {primary,choices:[...targets,...(primary==='retrieve'?available.filter(c=>c.kind==='read'&&books.has(c.readableId)):[])]};
}
function catalog(choices){
  return Object.fromEntries(KINDS.map(kind=>[kind,choices.filter(c=>c.kind===kind)]).filter(([,rows])=>rows.length));
}
function parameter(choices,{primary,optional=false}={}){
  const properties={};
  for(const [kind,options]of Object.entries(catalog(choices))){
    const fields={target:C.choice(options.map(c=>c.id)),instruction:C.nonblankText(undefined,
      'These exact words become your spoken recruitment condition. Speak naturally in your character voice to the player, naming the real target and required action. State the complete condition, not third-person notes or a hidden extra requirement.')};
    if(kind==='puzzle')fields.instruction.description+=' For recruitment, offer to accompany the player here after acceptance while they solve it; remain together permanently after all agreed group conditions, and stay behind if they leave with the work unfinished.';
    if(kind==='conversation'){fields.exchange=C.choice(EXCHANGES);fields.successCriteria=C.nonblankText();}
    properties[kind]={type:[{type:fields}],minItems:kind===primary&&!optional?1:0,maxItems:primary?1:3};
  }
  return {type:properties,description:primary?'Choose the selected primary task; only a matching book chapter may accompany a retrieval.':'Choose one to three total conditions across the available task kinds; use empty arrays for unused kinds.'};
}
function spokenRequest(conditions){
  const lines=conditions.map(condition=>condition.instruction?.trim());
  if(!lines.length||lines.some(line=>!literal(line)))throw Error('Every offered condition needs its own complete authored spoken instruction.');
  return lines.join(' ');
}
function literal(value){return typeof value==='string' && !!value.trim() && !/\[\[|\]\]/.test(value);}
function parse(plan,choices,{primary}={}){
  const available=catalog(choices),conditions=[];
  if(!plan || typeof plan!=='object' || Array.isArray(plan))throw Error('Choose a typed task plan.');
  for(const [kind,rows]of Object.entries(plan)){
    if(!Object.hasOwn(available,kind) || !Array.isArray(rows))throw Error('That task kind has no supported target here.');
    for(const row of rows){
      if(!row || typeof row!=='object')throw Error('A task condition must name its real target and instruction.');
      const target=available[kind].find(c=>c.id===row.target);
      if(!target || !literal(row.instruction))throw Error('Choose an existing target in the matching task kind and author its instruction.');
      const condition={...target,instruction:row.instruction.trim(),planVersion:1};
      if(kind==='conversation'){
        if(!EXCHANGES.includes(row.exchange)||!literal(row.successCriteria))throw Error('A spoken request needs its exchange kind and an accomplishable success criterion.');
        Object.assign(condition,{focus:condition.instruction,exchange:row.exchange,successCriteria:row.successCriteria.trim()});
      }
      conditions.push(condition);
    }
  }
  if(conditions.length<1||conditions.length>3||new Set(conditions.map(c=>c.id)).size!==conditions.length)throw Error('Choose one to three distinct supported conditions.');
  if(primary && (conditions.filter(c=>c.kind===primary).length!==1 || conditions.some(c=>c.kind!==primary && !(primary==='retrieve'&&c.kind==='read'))))throw Error('Use the selected local task kind.');
  if(primary==='retrieve' && conditions.some(c=>c.kind==='read' && !conditions.some(item=>item.kind==='retrieve'&&item.readableId===c.readableId)))throw Error('Research must use the same actual book being retrieved.');
  if(primary && conditions.some(c=>RETIRED.test(c.instruction)))throw Error('Describe only the actual local objective and its direct completion.');
  return conditions;
}
module.exports={KINDS,EXCHANGES,RULES,catalog,parameter,parse,select,spokenRequest,RETIRED};
