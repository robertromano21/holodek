'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
const ARCHIVE_FILES = ['8580.sid', '10582.sid', 'manifest.json', 'score.json', 'song.asm', 'song_sid.asm', 'README.txt'];
async function main() {
  const { job, snapshot, flags, gateway, credential, provider, pcSession } = workerData;
  if (!['population', 'geometry', 'music', 'art'].includes(job?.stage) || !/^[a-f0-9-]{36}$/.test(job.id || '')) throw Error('Invalid remote room stage.');
  const allowedFlags = new Set(Object.keys(require('./worldFlags').DEFAULTS).map(name => 'HOLODEK_' + name));
  for (const [flag, on] of Object.entries(flags || {})) if (allowedFlags.has(flag) && ['0', '1'].includes(on)) process.env[flag] = on;
  process.env.HOLODEK_REMOTE_ENGINE = '1';
  process.env.OPENAI_API_KEY = provider === 'openai' ? credential : 'remote-worker-not-a-provider-key';
  if (provider === 'xai') process.env.XAI_API_KEY = credential;
  if (provider === 'groq') process.env.GROQ_API_KEY = credential;
  const website = require('./websiteAi');
  const proxy = require(gateway);
  if (pcSession && (workerData.pcModel !== 'holodek-1' || job.model !== 'holodek-1' || provider !== 'ollama' ||
      !/^[a-f0-9]{48}$/.test(pcSession.id || '') || typeof pcSession.runtime !== 'string' ||
      path.dirname(path.resolve(pcSession.runtime)) !== path.dirname(path.resolve(gateway)) ||
      !/^runtime(?:-[23])?\.json$/.test(path.basename(pcSession.runtime)))) throw Error('Invalid PC model stage bridge.');
  if ((workerData.pcModel !== undefined || job.model === 'holodek-1') && !pcSession) throw Error('PC model stage bridge is missing.');
  website.useRemoteTransport(async packet => {
    const request = { ...packet, background: workerData.background === true };
    if (pcSession) return proxy.rpc({ ...request, pcSession: pcSession.id }, { runtime: pcSession.runtime });
    return ['openai', 'xai', 'groq'].includes(request.provider) ? proxy.pollModelJob(request) : proxy.rpc(request);
  });
  const state = require('../sharedState'), models = require('./gameModels');
  state.importSaveState(snapshot, { graphicsReady: Object.keys(snapshot.roomDungeonDatabase) }); require('./settingLayer').attach(state); models.restore(job.model);
  await models.withSnapshot(() => require('./retortWithUserInput').retortWithUserInput('', () => {}, state.getCombatMode(), {
    prepareRoom: { ...job, baseRooms: JSON.parse(snapshot.roomNameDatabaseString) }, onBuildCheckpoint: artifact => {
      if (job.stage === 'art') {
        const record = artifact.rooms[job.key].illustration, Art = require('../assets/roomIllustration');
        const { createCanvas } = require('canvas'), canvas = createCanvas(Art.width, Art.height), ctx = canvas.getContext('2d');
        Art.paint(ctx, record.plan, record.source);
        const modern = canvas.toDataURL('image/png'), pixels = ctx.getImageData(0, 0, Art.width, Art.height);
        pixels.data.set(require('../assets/retroGraphics').palettePixels(pixels.data, Art.width, Art.height)); ctx.putImageData(pixels, 0, 0);
        record.rasters = { version: 1, source: record.source, modern, retro: canvas.toDataURL('image/png') };
      }
      let archive;
      if (job.stage === 'music' && artifact.music?.archive?.id) {
        const id = artifact.music.archive.id;
        if (!/^[a-z0-9-]{1,80}-[a-f0-9]{16}$/.test(id)) throw Error('Invalid remote music archive.');
        const directory = path.join(__dirname, '../.retort-data/room-build', job.id, 'music-archive', id);
        archive = {};
        for (const file of ARCHIVE_FILES) {
          const bytes = fs.readFileSync(path.join(directory, file));
          if (bytes.length > 4 * 1024 * 1024) throw Error('Remote music file exceeds limit.');
          archive[file] = bytes.toString('base64');
        }
      }
      parentPort.postMessage({ type: 'checkpoint', artifact, ...(archive ? { archive } : {}) });
    }
  }));
}
main().then(() => parentPort.postMessage({ type: 'done' }), error => {
  const key = workerData.credential;
  if (/^MODEL_PROVIDER_/.test(error.code || '')) {
    const safe = require(workerData.gateway).failurePacket(error);
    parentPort.postMessage({ type:'failed', ...safe, reason:safe.error });
  } else parentPort.postMessage({ type: 'failed', reason: String(error.message).split(key || '\0').join('[redacted]').slice(0, 1000) });
}).finally(() => parentPort.close());
