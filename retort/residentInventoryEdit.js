'use strict';
function drop(state, input) {
  if (!state.getGamePaused()) throw Error('Pause the game before editing resident inventory.');
  const coords = state.getLastCoords(), key = `${coords.x},${coords.y},${coords.z}`;
  if (input?.key !== key) throw Error('The room changed. Inspect the resident again.');
  if (typeof input.actor !== 'string' || typeof input.item !== 'string') throw Error('Exact resident and item names are required.');
  const db = JSON.parse(state.getRoomNameDatabase()), room = db[key];
  const population = state.getRoomPopulation?.(key) || room?.inhabitants;
  const actor = population?.actors?.[input.actor];
  if (!actor || actor.name !== input.actor || actor.status !== 'present') throw Error('That resident is not present.');
  const matches = (actor.inventory || []).map((o, i) => o.name === input.item ? i : -1).filter(i => i >= 0);
  const ground = (room.objects || []).filter(o => o.name === input.item);
  const repair = input.repairGround === true;
  if (repair ? matches.length !== 0 || ground.length !== 1 : matches.length !== 1)
    throw Error('Expected exactly one matching item in the requested location; no changes made.');
  if (!repair && ground.length) throw Error('An item with that name is already on the ground; no changes made.');
  const dungeon = state.getRoomDungeonForSimulation?.(coords);
  if (!dungeon || !actor.position) throw Error('The resident’s room and position must be loaded before dropping an item.');
  // Operate on a copy so a failed validation never changes the live population.
  const next = structuredClone(population), resident = next.actors[input.actor];
  const item = repair ? ground[0] : resident.inventory.splice(matches[0], 1)[0];
  const groundItem = { ...item, economyItemId: item.economyItemId || 'resident-drop:' + require('node:crypto').randomUUID() };
  if (!repair) room.objects = [...(room.objects || []), groundItem];
  room.groundInventoryVersion = 1;
  const text = require('./economy').syncGround(state.getUpdatedGameConsole(), room);
  const nextDungeon = { ...dungeon, sceneObjects: structuredClone(dungeon.sceneObjects || []) };
  require('../assets/sceneObjectSync').sync(nextDungeon, text, { player: actor.position });
  const placed = nextDungeon.sceneObjects.find(o => o.name === item.name);
  if (!placed) throw Error('No reachable ground position was available; the item remains in the resident’s inventory.');
  const discovery = next.travelDiscovery?.objects;
  if (discovery) {
    const name = item.name.trim().toLowerCase();
    discovery[name] = { ...discovery[name], name: item.name, status: 'placed', x: placed.x, y: placed.y };
  }
  next.revision = (next.revision || 0) + 1;
  room.inhabitants = next;
  state.setRoomNameDatabase(JSON.stringify(db));
  state.setRoomPopulation(key, next);
  state.setUpdatedGameConsole(text);
  state.setRoomDungeon(coords, nextDungeon, dungeon.customTiles || []);
  return { ok: true, actor: actor.name, dropped: item.name, repaired: repair, position: { x: placed.x, y: placed.y }, remaining: resident.inventory.map(o => o.name) };
}
module.exports = { drop };
