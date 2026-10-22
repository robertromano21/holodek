'use strict';
const { parentPort, workerData } = require('node:worker_threads');
async function main() {
  const state = require('../sharedState'), models = require('./gameModels'), website = require('./websiteAi').service();
  state.importSaveState(workerData.snapshot);
  require('./settingLayer').attach(state);
  models.restore(workerData.job.model);
  await website.ensureConnected();
  if (!website.backgroundEnabled()) throw Error('Website background work is disabled.');
  return website.withBackground(() => models.withSnapshot(() =>
    require('./retortWithUserInput').retortWithUserInput('', () => {}, state.getCombatMode(), {
      prepareRoom: { ...workerData.job, baseRooms: JSON.parse(workerData.snapshot.roomNameDatabaseString) },
      onBuildCheckpoint: artifact => parentPort.postMessage({ type: 'checkpoint', artifact })
    })));
}
main().then(() => parentPort.postMessage({ type: 'done' }), error => {
  parentPort.postMessage({ type: 'failed', reason: String(error.message).slice(0, 1000) });
}).finally(() => parentPort.close());
