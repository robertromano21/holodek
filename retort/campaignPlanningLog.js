'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
const pretty = value => JSON.stringify(value, null, 2);
const defaultDirectory = path.join(__dirname, '..', 'logs');
function filename(runId) {
  const id = String(runId);
  const safe = /^[a-z0-9_-]{1,100}$/i.test(id) ? id : digest(id).slice(0, 24);
  return `campaign-planning-${safe}.txt`;
}
function snapshot(state) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), root = db['0,0,0'] || {};
  const consoleText = state.getUpdatedGameConsole?.() || '';
  const line = label => consoleText.match(new RegExp('^' + label + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
  const tasks = structuredClone(state.getCurrentTasks?.() || []).filter(t => t && typeof t === 'object');
  return { runId: state.getDungeonRunId(), atlas: root.campaignAtlas, attempt: root.regionalAdventureAttempt,
    quest: state.getCurrentQuest?.() || line('Current Quest'), tasks,
    nextBoss: line('Next Boss'), bossRoom: line('Next Boss Room'), bossCoordinates: line('Boss Room Coordinates'), artifact: line('Next Artifact'),
    progress: line('Quests Achieved'), questLog: structuredClone(state.getQuestLog?.() || []),
    localMissions: Object.entries(db).flatMap(([key, room]) => Object.values(room?.minorMissions || {}).map(m => ({ ...m, roomKey: key, roomName: room.name }))),
    fortifiedSites: Object.values(db).filter(r => r?.fortifiedSite).map(r => ({ ...r.fortifiedSite,
      floors: r.fortifiedSite.rooms.map(key => ({ coordinates: key, name: db[key]?.name, plan: db[key]?.fortifiedFloor, exits: db[key]?.exits })) })),
    villages: Object.entries(db).filter(([, r]) => r?.villagePlan).map(([key, r]) => ({ coordinates: key, ...r.villagePlan })),
    portals: Object.entries(db).filter(([, r]) => r?.exits?.portal).map(([key, r]) => ({ coordinates: key, exit: r.exits.portal, realm: r.planarRealm })),
    regional: root.regionalAdventure && { ...root.regionalAdventure, sites: (root.regionalAdventure.rooms || []).map(key => {
      const room = db[key] || {};
      return { coordinates: key, name: room.name, description: room.description, setting: room.campaignSetting,
        plannedActors: room.regionalSite?.actors, inscriptions: room.inscriptions };
    }) },
    stories: tasks.filter(t => t.story).map(t => ({ id: t.story.id, story: t.story,
      runtime: Object.values(db).map(r => r?.questScenes?.[t.story.id]).find(Boolean) })) };
}
function createLogger({ directory = defaultDirectory, files = fs, now = () => new Date(), warn = message => console.warn(message) } = {}) {
  const pending = new Map(), seen = new Map();
  function writeSnapshot(state, reason) {
    let data;
    try { data = snapshot(state); } catch (error) { warn('[CampaignPlanning] Cannot read planning state: ' + error.message); return Promise.resolve(null); }
    if (!data.runId) return Promise.resolve(null);
    const file = path.join(directory, filename(data.runId)), prior = seen.get(file) || new Map(), sections = [];
    const changed = (id, value) => {
      if (value === undefined || value === null) return false;
      const hash = digest(value); if (prior.get(id) === hash) return false;
      prior.set(id, hash); return true;
    };
    if (changed('atlas', data.atlas)) sections.push('CAMPAIGN GEOGRAPHY AND FACTIONS\n' + pretty(data.atlas));
    if (changed('attempt', data.attempt)) sections.push('FIRST CONNECTED ADVENTURE GENERATION\n' + pretty(data.attempt));
    if (changed('regional', data.regional)) sections.push('FIRST CONNECTED ADVENTURE: ACCEPTED ROOM PLAN\n' + pretty(data.regional));
    for (const site of data.fortifiedSites) if (changed('fortified:' + site.id, site)) sections.push('MULTI-STOREY SITE: ACCEPTED ROOM AND STAIR PLAN\n' + pretty(site));
    for (const village of data.villages) if (changed('village:' + village.id, village)) sections.push('VILLAGE: ACCEPTED BUILDINGS AND LOCAL PRESSURES\n' + pretty(village));
    for (const portal of data.portals) if (changed('portal:' + portal.coordinates, portal)) sections.push('PLANAR PORTAL: SAVED DESTINATION AND COSMOLOGY\n' + pretty(portal));
    for (const task of data.tasks) {
      const id = task.id || task.story?.id || digest([data.quest, task.type, task.desc]);
      if (!changed('task:' + id, task)) continue;
      sections.push(`QUEST TASK ${/completed/i.test(task.status || '') ? 'COMPLETED' : /failed/i.test(task.status || '') ? 'FAILED' : 'PLAN / UPDATE'}\n` +
        `Campaign quest: ${text(data.quest)}\nStatus: ${text(task.status || 'Pending')}\n` + pretty(task));
    }
    for (const story of data.stories) if (changed('story:' + story.id, story)) sections.push('STAGED QUEST PLAN AND VERIFIED SCENE PROGRESS\n' + pretty(story));
    for (const entry of data.questLog) {
      if (changed('quest-log:' + digest(entry), entry)) sections.push('QUEST HISTORY\n' + pretty(entry));
    }
    for (const mission of data.localMissions) if (changed('local:' + mission.id, mission))
      sections.push(`LOCAL MISSION ${mission.status === 'completed' ? 'COMPLETED' : 'PLAN / UPDATE'}\n` + pretty(mission));
    const binding = { quest: data.quest, nextBoss: data.nextBoss, bossRoom: data.bossRoom, coordinates: data.bossCoordinates,
      artifact: data.artifact, questsAchieved: data.progress };
    if (changed('binding', binding)) sections.push('CURRENT CAMPAIGN BINDINGS\n' + pretty(binding));
    if (!sections.length) return pending.get(file) || Promise.resolve(file);
    seen.set(file, prior);
    const timestamp = now().toISOString();
    const block = `\n${'='.repeat(76)}\n${timestamp} | ${text(reason)}\n${'='.repeat(76)}\n\n${sections.join('\n\n')}\n`;
    const job = (pending.get(file) || Promise.resolve()).then(async () => {
      try {
        await files.mkdir(directory, { recursive: true });
        try {
          await files.writeFile(file, `CHILDREN OF THE GRAVE - CAMPAIGN PLANNING\nGame run: ${text(data.runId)}\nCreated (UTC): ${timestamp}\n\n` +
            'Append-only developer diagnostic. Contains quest spoilers. Not loaded as game state.\n' +
            'Only accepted engine plans and recorded quest changes appear here; an LLM suggestion is not completion.\n', { encoding: 'utf8', flag: 'wx' });
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
        await files.appendFile(file, block, 'utf8'); return file;
      } catch (error) {
        seen.delete(file); warn('[CampaignPlanning] Could not write ' + file + ': ' + error.message); return null;
      }
    });
    pending.set(file, job);
    job.finally(() => { if (pending.get(file) === job) pending.delete(file); });
    return job;
  }
  function capture(state, reason = 'campaign update') {
    try { return writeSnapshot(state, reason); }
    catch (error) { warn('[CampaignPlanning] Cannot record planning update: ' + error.message); return Promise.resolve(null); }
  }
  function watch(state) {
    if (!state.emitter) return () => {};
    const events = ['quest:currentQuest', 'quest:tasks', 'quest:taskIndex', 'quest:log', 'quest:lastUpdate', 'quest:minorMission'];
    const listeners = events.map(event => [event, () => { void capture(state, event); }]);
    for (const [event, listener] of listeners) state.emitter.on(event, listener);
    return () => { for (const [event, listener] of listeners) state.emitter.off(event, listener); };
  }
  return { capture, watch, flush: () => Promise.all([...pending.values()]) };
}
const logger = createLogger();
module.exports = { ...logger, createLogger, snapshot, filename };
