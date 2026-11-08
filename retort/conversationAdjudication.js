'use strict';
const C=require('./generationContracts');
const VERDICTS=['fulfilled','not_fulfilled','not_addressed'];
const POLICY='CONVERSATION ADJUDICATION FIRST: evaluate every conversationCheck against the actual current userInput, independently of speakers. Use the authored instruction and successCriteria, not extra requirements or the broad exchange label. If the request allows asking a sincere question, a relevant question IS performance; do not demand a memory, an answer, a conclusion or another exchange instead. Questions about how to finish the task are not performance unless the criterion actually asks for that. Distinguish doing the requested speaking act from a promise, refusal, hypothetical example or a claim about unverified physical work. For fulfilled, quote an exact nonempty passage of current userInput as excerpt. Otherwise use an empty excerpt. Explain each verdict in reason. Do not require magic commands or add steps. Your prose is a provisional setup, not the final response: the engine commits these verdicts before the response is authored. Speaker selection cannot skip a check.';
function checks(options,allowed){
  return options.filter(o=>allowed.includes(o.name)&&o.actions.includes('fulfill-conversation')).flatMap((option,i)=>
    option.conversationConditions.map((condition,j)=>({key:`request${i}_condition${j}`,option,condition})));
}
function parameter(rows){
  return {type:Object.fromEntries(rows.map(row=>[row.key,{type:{verdict:C.choice(VERDICTS),excerpt:{type:String},reason:C.nonblankText()}}]))};
}
function context(rows){return Object.fromEntries(rows.map(row=>[row.key,{actor:row.option.name,missionId:row.option.conversationMissionId,...row.condition}]));}
function parse(value,rows,userInput){
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==rows.length)throw Error('Adjudicate every supplied conversation condition.');
  const byMission=new Map();
  for(const row of rows){
    const decision=value[row.key];
    if(!decision || !VERDICTS.includes(decision.verdict) || typeof decision.excerpt!=='string' || typeof decision.reason!=='string' ||
      !decision.reason.trim() || /\[\[|\]\]/.test(decision.reason) ||
      (decision.verdict==='fulfilled'? !decision.excerpt.trim() || !String(userInput).includes(decision.excerpt):!!decision.excerpt))
      throw Error('A conversation verdict needs its exact current-player evidence and an explanation.');
    const id=row.option.conversationMissionId,group=byMission.get(id)||{option:row.option,decisions:[]};
    group.decisions.push({conditionId:row.condition.id,...decision});byMission.set(id,group);
  }
  return [...byMission.values()];
}
module.exports={VERDICTS,POLICY,checks,parameter,context,parse};
