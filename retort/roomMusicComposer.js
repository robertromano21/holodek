'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Composition = require('./sidComposition');
const bounded = (value, limit) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, limit);

function contextFor(state, roomKey, monsters) {
  let db = state.getRoomNameDatabase?.() || {};
  try { if (typeof db === 'string') db = JSON.parse(db); } catch { db = {}; }
  const room = db[roomKey] || {}, pc = state.getCurrentPC?.();
  return {
    roomName: room.name || room.roomName,
    setting: bounded(room.campaignSetting || room.classification || {}, 1300),
    protagonist: pc ? { name: pc.name || pc.Name, class: pc.class || pc.Class } :
      bounded(String(state.getUpdatedGameConsole?.() || '').match(/(?:^|\n)PC:\s*\n([\s\S]*?)(?:\n\s*\n|$)/)?.[1] || 'Current selected party', 400),
    aspiration: bounded(state.getCurrentQuest?.() || state.getPersonalNarrative?.() || '', 1000),
    task: bounded(state.getActiveTask?.()?.description || state.getActiveTask?.()?.objective || '', 400),
    inhabitants: monsters.map(m => typeof m === 'string' ? m : m?.name || m?.Name || m?.type).filter(Boolean).slice(0, 8)
  };
}

function logComposition(song, context, directory = path.join(__dirname, '..', 'logs', 'music')) {
  const id = createHash('sha256').update(`${song.composition.runId}|${song.composition.roomKey}`).digest('hex').slice(0, 24);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), title: song.title,
    context, composition: song.composition, arrangedPlan: song.plan, analysis: song.analysis }, null, 2));
  return file;
}

async function generate($, state, descriptionOrToken, monstersOrContext = {}, roomKey = '') {
  const input = monstersOrContext && !Array.isArray(monstersOrContext) ? monstersOrContext : {};
  const description = bounded(input.roomDescription || descriptionOrToken || '', 3500);
  const monsters = Array.isArray(monstersOrContext) ? monstersOrContext : input.monstersInRoom || [];
  const context = contextFor(state, roomKey, Array.isArray(monsters) ? monsters : []);
  const song = await Composition.generate($, { description, roomKey, context,
    runId: state.getDungeonRunId(), recent: state.getRecentRoomMusic?.(roomKey) || [] });
  try { logComposition(song, context); }
  catch (error) { console.warn('[SidCompositionLog]', JSON.stringify({ roomKey, reason: error.message })); }
  try {
    const saved=require('./sidArchive').record(song,{roomKey,runId:state.getDungeonRunId(),roomName:context.roomName});
    song.archive={id:saved.id,url:'/music-archive/'+saved.id+'/',variants:['8580.sid','10582.sid']};
  } catch(error) {
    song.archive={error:error.message};
    console.error('[SidArchiveFailure]',JSON.stringify({roomKey,reason:error.message}));
  }
  return song;
}
module.exports = { generate, contextFor, logComposition };
