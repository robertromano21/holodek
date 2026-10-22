'use strict';
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Build = require('./roomBuildState');
const ARCHIVE_FILES = ['8580.sid', '10582.sid', 'manifest.json', 'score.json', 'song.asm', 'song_sid.asm', 'README.txt'];
function constructionSnapshot(state, job, consoleText = state.getUpdatedGameConsole()) {
  const snapshot = state.exportSaveState();
  snapshot.updatedGameConsole = consoleText;
  const match = consoleText.match(/^Coordinates:\s*X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)/m);
  if (!match) throw Error('Room build needs authoritative coordinates.');
  const key = match.slice(1).map(Number).join(',');
  snapshot.lastCoords = Object.fromEntries(['x', 'y', 'z'].map((name, i) => [name, Number(match[i + 1])]));
  snapshot.roomDungeonDatabase = Object.fromEntries(Object.entries(snapshot.roomDungeonDatabase).filter(([k]) => k === key || k === job.key));
  // Construction can begin before the first dungeon exists; this scratch record never becomes an artifact.
  snapshot.roomDungeonDatabase[key] ||= {};
  snapshot.characterGenerationInProgress = false;
  return snapshot;
}
function acceptArchive(job, music, files) {
  if (!files) return;
  const id = music?.archive?.id;
  if (!/^[a-f0-9-]{36}$/.test(job.id) || !/^[a-z0-9-]{1,80}-[a-f0-9]{16}$/.test(id || '') ||
      Object.keys(files).sort().join('|') !== [...ARCHIVE_FILES].sort().join('|')) throw Error('Invalid remote archive identity.');
  const decoded = {};
  for (const file of ARCHIVE_FILES) {
    if (typeof files[file] !== 'string' || files[file].length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(files[file])) throw Error('Invalid remote archive file.');
    decoded[file] = Buffer.from(files[file], 'base64');
  }
  const manifest = JSON.parse(decoded['manifest.json'].toString('utf8')), { archive, ...score } = music;
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (manifest.version !== 2 || manifest.id !== id || manifest.scoreHash !== digest(JSON.stringify(score))) throw Error('Remote music score checksum mismatch.');
  for (const name of ['8580.sid', '10582.sid']) if (digest(decoded[name]) !== manifest.checksums?.[name]) throw Error('Remote SID checksum mismatch.');
  const directory = path.join(__dirname, '../.retort-data/room-build', job.id, 'music-archive', id);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ARCHIVE_FILES) {
    const temporary = path.join(directory, file + '.tmp');
    fs.writeFileSync(temporary, decoded[file]); fs.renameSync(temporary, path.join(directory, file));
  }
}
function spawnBuild(job, snapshot, { runStage, background = true, skipPopulation = false } = {}) {
  const emitter = new EventEmitter(), controller = new AbortController();
  emitter.terminate = async () => controller.abort();
  setImmediate(async () => {
    try {
      let combined;
      const send = artifact => emitter.emit('message', { type: 'checkpoint', artifact: structuredClone(artifact) });
      const stage = async (name, source) => {
        if (controller.signal.aborted) throw Error('Remote room build cancelled.');
        let result;
        const order = Object.fromEntries(['id', 'key', 'name', 'coords', 'runId', 'model', 'modelRevision', 'assignment'].filter(key => job[key] !== undefined).map(key => [key, job[key]]));
        await runStage({ ...order, stage: name }, source, { signal: controller.signal, background,
          onCheckpoint: message => { if (result) throw Error('Duplicate remote stage artifact.'); result = message; } });
        if (controller.signal.aborted) throw Error('Remote room build cancelled.');
        if (result?.artifact?.key !== job.key || result.artifact.runId !== job.runId || result.artifact.stage !== name) throw Error('Remote stage identity mismatch.');
        if (job.assignment && (result.artifact.jobId !== job.id || result.artifact.leaseId !== job.assignment.leaseId)) throw Error('Remote stage lease mismatch.');
        acceptArchive(job, result.artifact.music, result.archive);
        return result.artifact;
      };
      if (!skipPopulation) {
        combined = await stage('population', snapshot); combined.completedStages = ['population']; send(combined);
        if (controller.signal.aborted) throw Error('Remote room build cancelled.');
        snapshot = structuredClone(snapshot); snapshot.roomNameDatabaseString = JSON.stringify(combined.rooms);
        if (combined.dungeon) snapshot.roomDungeonDatabase[job.key] = combined.dungeon;
      } else combined = { key: job.key, runId: job.runId, stage: 'population', rooms: JSON.parse(snapshot.roomNameDatabaseString), dungeon: null,
        music: null, completedStages: ['population'] };
      combined.jobId = job.id; combined.leaseId = job.assignment?.leaseId;
      const base = structuredClone(combined.rooms);
      await Promise.all(['geometry', 'music', 'art'].map(async name => {
        const artifact = await stage(name, snapshot);
        for (const key of Object.keys(artifact.rooms)) {
          if (!Build.coordinate.test(key)) throw Error('Invalid remote coordinate.');
          if (!Build.equal(base[key], artifact.rooms[key])) combined.rooms[key] = Build.merge(base[key], artifact.rooms[key], combined.rooms[key], key);
        }
        if (artifact.sharedHistory) combined.sharedHistory = [...(combined.sharedHistory || []), ...artifact.sharedHistory];
        if (artifact.readOnlyNormalizations) combined.readOnlyNormalizations = [...new Set([...(combined.readOnlyNormalizations || []), ...artifact.readOnlyNormalizations])];
        if (name === 'geometry') combined.dungeon = artifact.dungeon;
        if (name === 'music') combined.music = artifact.music;
        combined.stage = name; combined.completedStages.push(name); send(combined);
      }));
      combined.stage = 'complete'; send(combined); emitter.emit('message', { type: 'done' });
    } catch (error) { controller.abort(); emitter.emit('message', { type: 'failed', reason: String(error.message).slice(0, 1000),
      ...(/^MODEL_PROVIDER_/.test(error.code || '') ? require('../tools/website-worker/worker.cjs').failurePacket(error) : {}) }); }
  });
  return emitter;
}
module.exports = { spawnBuild, constructionSnapshot, acceptArchive };
