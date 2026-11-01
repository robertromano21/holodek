'use strict';
const I = require('../assets/dungeonInhabitants');
const key = value => String(value || '').trim().toLowerCase();
const SOURCE = 'engine-combat-defeat-v1';
function remember(life, name, roomKey, at = life.clock) {
  roomKey = I.roomKey(roomKey);
  if (life.source !== 'engine-combat-life-v1' || !life.runId || !name || !roomKey || !Number.isSafeInteger(at) || at < 0) return;
  life.defeats ||= [];
  if (!Array.isArray(life.defeats)) return;
  if (!life.defeats.some(row => row.source === SOURCE && row.runId === life.runId && row.roomKey === roomKey && key(row.name) === key(name)))
    life.defeats.push({ source: SOURCE, runId: life.runId, name, roomKey, at });
}
function evidence(database, roomKey, name) {
  roomKey = I.roomKey(roomKey);
  if (!roomKey || !name) return null;
  if (Object.keys(database || {}).filter(k => I.roomKey(k) === roomKey).length !== 1) return null;
  const home = database?.['0,0,0'], life = home?.combatLife;
  if (life?.source === 'engine-combat-life-v1' && life.runId) {
    const row = Array.isArray(life.defeats) && life.defeats.find(row => row?.source === SOURCE && row.runId === life.runId &&
      row.roomKey === roomKey && key(row.name) === key(name) && Number.isSafeInteger(row.at) && row.at >= 0);
    if (row) return { ...row };
    // Old saves already retain the survival save made only when HP reached zero.
    const actor = life.actors?.[key(name)], save = actor?.save;
    if (actor?.type === 'monster' && key(actor.name) === key(name) && I.roomKey(actor.geoKey) === roomKey &&
        Number.isSafeInteger(actor.at) && actor.at >= 0 && Number.isInteger(save?.natural) && save.natural >= 1 && save.natural <= 20 &&
        Number.isInteger(save.total) && save.total >= save.natural && save.total <= save.natural + 5 && save.difficulty === 12 &&
        save.passed === (save.natural === 20 || save.natural !== 1 && save.total >= save.difficulty))
      return { source: 'engine-combat-life-v1', runId: life.runId, name: actor.name, roomKey, at: actor.at };
  }
  const economy = home?.economy, actor = database?.[roomKey]?.inhabitants?.actors?.[name];
  if (economy?.source !== 'engine-economy-v1' || !economy.runId || life?.runId && life.runId !== economy.runId) return null;
  const receipt = economy.receipts?.find(row => row?.source === 'engine-economy-v1' && row.kind === 'defeat-drop' &&
    key(row.actor) === key(name) && I.roomKey(row.roomKey) === roomKey && row.id);
  if (receipt || actor?.corpseInventoryDropped === true)
    return { source: 'engine-economy-v1', runId: economy.runId, name, roomKey, receiptId: receipt?.id || null };
  return null;
}
module.exports = { remember, evidence };
