'use strict';
const Items = require('./itemAuthoring'), flights = new WeakMap();
const key = value => String(value || '').trim().toLowerCase();
const legacy = item => ['engine-srd-basic-v1', 'world1-ranged'].includes(item.equipment_source) ||
  ['ashroad spear', 'caravan short sword', 'pilgrims cuirass', 'wellkeepers shield'].includes(key(item.name)) ||
  /^healing potion(?: \d+ hp)?$/.test(key(item.name)) || /of the ashroad\b/.test(key(item.name));
function needed(service) {
  if (!service || !['shop', 'temple'].includes(service.kind)) return false;
  if (service.stockAuthorship?.version === Items.VERSION) return service.stockAuthorship.status !== 'ready';
  return (service.stock || []).some(legacy);
}
function pending() { return { stock: [], stockAuthorship: { version: Items.VERSION, status: 'pending' } }; }
async function prepare($, state, geoKey, { serviceId, author = Items.generate } = {}) {
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[geoKey];
  if (!room) throw Error('The shop room is unavailable.');
  if (require('../assets/economyRules').isStarterRoom(geoKey,room)) return;
  let active = flights.get(state); if (!active) flights.set(state, active = new Map());
  for (const service of Object.values(room.services || {}).filter(s => (!serviceId || s.id === serviceId) && needed(s))) {
    const runId = state.getDungeonRunId(), floor = require('./hostLocalFloors').token(state);
    const id = runId + ':' + floor + ':' + geoKey + ':' + service.id, existing = active.get(id);
    if (existing) { await existing; continue; }
    const identity = JSON.stringify(service);
    const task = (async () => {
      const world = db['0,0,0']?.setting || require('./settingLayer').current();
      const items = await author($, { count: service.kind === 'temple' ? 3 : 6, roomName: room.name,
        roomDescription: room.description || room.roomDescription || '', database: db, world, operator: service.operator,
        purpose: 'items for sale at this ' + service.kind, healingOnly: service.kind === 'temple',
        excluded: [...(room.objects || []).map(o => o.name), ...Object.values(room.services || {}).flatMap(s => (s.stock || []).filter(i => !legacy(i)).map(i => i.name))] });
      const latest = JSON.parse(state.getRoomNameDatabase() || '{}'), current = latest[geoKey]?.services?.[service.id];
      if (state.getDungeonRunId() !== runId || require('./hostLocalFloors').token(state) !== floor ||
          !current || JSON.stringify(current) !== identity || latest[geoKey].name !== room.name ||
          JSON.stringify(latest['0,0,0']?.setting) !== JSON.stringify(db['0,0,0']?.setting))
        throw Error('The campaign, floor or shop changed before its items were authored.');
      // Preserve player buybacks and non-catalog items; never reset existing
      // quantities, tills, transaction receipts or a successor's inventory.
      const sold = new Set((latest['0,0,0']?.economy?.receipts || []).filter(r => r.kind === 'sell' &&
        [...require('../assets/cityEstablishments').operators(current),current.originalOperator].includes(r.actor)).map(r => key(r.item)));
      const retained = (current.stock || []).filter(i => !legacy(i) || sold.has(key(i.name)));
      current.stock = [...retained, ...items.filter(i => !retained.some(r => key(r.name) === key(i.name))).map(i => ({ ...i, quantity: 2 }))];
      current.stockAuthorship = { version: Items.VERSION, status: 'ready', source: Items.SOURCE };
      current.revision = (current.revision || 0) + 1;
      state.setRoomNameDatabase(JSON.stringify(latest));
    })();
    active.set(id, task);
    try { await task; } finally { if (active.get(id) === task) active.delete(id); }
  }
}
module.exports = { pending, needed, prepare, legacy };
