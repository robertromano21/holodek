'use strict';
const Q = require('./questProgress');
const Factions = require('./factionMemory');
const Scenes = () => require('./questScenes');
function factsFor(task, database, history) {
  return history.flatMap(h => {
    const stage=task.story?.stages?.find(s=>s.id===h.from);if(!stage)return [];
    const document=stage.kind==='read'&&[...(database[stage.roomKey]?.inscriptions||[]),...(database[stage.roomKey]?.readables||[])].find(d=>d.id===stage.readableId);
    return [{title:stage.kind==='read'?'Read: '+stage.name:stage.id,
      text:stage.kind==='read'?document?.chapters?.[0]?.text||stage.text:h.evidence?.action==='recruit'?stage.actor+' joined for the escort.':
        stage.kind==='encounter'?'Verified encounter resolved: '+stage.targets.join(', '):stage.kind==='escort'?
          h.evidence.source==='engine-escort-arrival-v1'?stage.actor+' arrived alive.':'The escort could not be completed; recover the prison testimony.':
          'Recorded quest conversation with '+(stage.actor||'the covenant writing')+'.',
      room:database[stage.roomKey]?.name,roomKey:stage.roomKey}];
  });
}
function archive(database, task) {
  database['0,0,0'] ||= {};
  const records = database['0,0,0'].adventureJournal ||= [];
  const id = task.id || Q.taskBinding(task);
  const runtime=task.story&&Scenes().runtime(task,database), history=runtime?.history||[];
  if (!records.some(r => r.id === id)) records.push({ id, title: task.story?.title || task.type, description: task.desc,
    status: 'Completed', at: Date.now(), source: 'engine-journal-v1',facts:factsFor(task,database,history),
    rumors:task.story?.rumor?[{text:task.story.rumor.text,source:task.story.rumor.source,status:'Checked against the records'}]:[],
    outcome:task.story?.family==='regional-v1'?(history.some(h=>h.evidence.source==='engine-escort-arrival-v1')?
      'Rescued and escorted alive':'Recovered prison testimony; rescue not completed'):null });
  if (records.length > 64) records.shift();
}
function project(state) {
  const database = JSON.parse(state.getRoomNameDatabase() || '{}'), tasks = state.getCurrentTasks?.() || [], index = state.getCurrentTaskIndex?.() || 0;
  const task = tasks[index], root = database['0,0,0'] || {}, record = task?.story && Scenes().runtime(task, database);
  const history = record?.history || [], visited = new Set(history.flatMap(h => [h.from, h.to]));
  const known = history.length > 0;
  const archive=(root.adventureJournal||[]).filter(r=>r.source==='engine-journal-v1').slice(-32);
  const facts=[...archive.flatMap(r=>r.facts||[]),...factsFor(task,database,history)].slice(-64);
  const rumor = task?.story?.rumor;
  return { runId: state.getDungeonRunId(), quest: state.getCurrentQuest?.() || 'No main quest yet.', step: index + 1,
    objective: task ? { title: task.story?.title || task.type, description: task.desc, requirements: Q.describeQuestRequirements(task, database),
      status: task.status || 'Pending', verified: task.progress?.satisfied || 0 } : null,
    route: known ? (task.story?.stages || []).filter(s => s.kind !== 'complete').map(s => ({ stage: s.id,
      room: database[s.roomKey]?.name, roomKey: s.roomKey, actor: s.actor || null,
      status: s.id === record.stage ? 'Current' : visited.has(s.id) ? 'Visited' : 'Planned' })) : [],
    facts, rumors: [...archive.flatMap(r=>r.rumors||[]),...(known && rumor ? [{ text: rumor.text, source: rumor.source,
      status: history.some(h => h.from === rumor.resolvedBy) ? 'Checked against the records' : 'Unverified; not a completion requirement' }] : [])].slice(-24),
    factions: Factions.project(database), history: archive,
    contracts: Object.values(database).flatMap(r => Object.values(r?.minorMissions || {}))
      .filter(m => ['accepted', 'completed'].includes(m.status)).slice(-32)
      .map(m => ({ description: m.description, status: m.status, recipient: m.recipient, room: database[m.roomKey]?.name })) };
}
module.exports = { archive, project };
