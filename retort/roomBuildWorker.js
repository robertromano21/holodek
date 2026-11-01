'use strict';
const { parentPort, workerData } = require('node:worker_threads');
async function main() {
  const state = require('../sharedState'), models = require('./gameModels'), website = require('./websiteAi').service();
  // These graphics belong to the running game, not a disk save needing repaint.
  state.importSaveState(workerData.snapshot, { graphicsReady: Object.keys(workerData.snapshot.roomDungeonDatabase) });
  require('./settingLayer').attach(state);
  models.restore(workerData.job.model);
  // Local helpers call the selected provider directly; website credentials/SSH are optional.
  website.withSnapshot = callback => callback();
  website.useForGameModels = () => false;
  return models.withSnapshot(() =>
    require('./retortWithUserInput').retortWithUserInput('', () => {}, state.getCombatMode(), {
      [workerData.job.stage === 'quest' ? 'prepareOpeningQuest' : 'prepareRoom']: {
        ...workerData.job, baseRooms: JSON.parse(workerData.snapshot.roomNameDatabaseString) },
      onBuildCheckpoint: artifact => parentPort.postMessage({ type: 'checkpoint', artifact })
    }));
}
main().then(() => parentPort.postMessage({ type: 'done' }), error => {
  parentPort.postMessage({ type: 'failed', reason: String(error.message).slice(0, 1000) });
}).finally(() => parentPort.close());
