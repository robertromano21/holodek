'use strict';
function publish(state,task,broadcast){
  if(typeof broadcast!=='function'||!state.getQuestSeeded?.()||!task||task.status==='Completed')return false;
  const index=state.getCurrentTaskIndex(),tasks=state.getCurrentTasks(),saved=tasks?.[index],quest=String(state.getCurrentQuest?.()||'').trim();
  if(saved!==task||!quest||/^none$/i.test(quest)||!task.desc)return false;
  const runId=state.getDungeonRunId(),coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`;
  const id='quest-seeded:'+require('node:crypto').createHash('sha256').update(JSON.stringify([runId,quest,index,task.id||task.story?.id||task.desc])).digest('hex');
  if(task.seedNoticeId===id)return false;
  broadcast({type:'action_notice',id,runId,geoKey,kind:'quest-seeded',title:index===0?'New Quest':'New Quest Step',
    activity:'Quest Seeded',message:`${quest}\n\n${task.desc}\n\nPay attention to this quest introduction. Your journal records the objective.`});
  task.seedNoticeId=id;state.setCurrentTasks(tasks);return true;
}
module.exports={publish};
