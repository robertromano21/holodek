'use strict';
const Plans = require('../assets/cityBuildingPlans'), Programs = require('./cityFloorPrograms'), Flags = require('./worldFlags'), E = require('../assets/cityEstablishments');
function programs(city, count, design) {
  city={...city,establishmentType:E.TYPES.includes(city?.establishmentType)?city.establishmentType:
    E.TYPES.includes(city?.venue?.type)?city.venue.type:city?.district==='temple'?'temple':'civic'};
  return Object.fromEntries([['lowerUse', 0], ['middleUse', Math.max(1, Math.floor((count - 1) * .5))],
    ['upperUse', Math.max(1, Math.floor((count - 1) * .9))], ['roofUse', count - 1]].map(([band, n]) =>
    [band, Programs.program(city, n, count - 1, design)]));
}
function installNamed(database, anchorKey) {
  if (!Flags.on('ARCHITECTURE_EXPANSION')) return 0;
  const site = database[anchorKey]?.environmentIntent?.citySite;
  if (!site) return 0;
  let count = 0;
  for (const [key, room] of Object.entries(database)) {
    const c = room.cityRoom;
    if (c?.anchorKey !== anchorKey || c.kind !== 'building' || c.vertical?.floor > 0 || !database[c.streetKey]) continue;
    const host = database[c.streetKey], id = `landmark:${key}`, storeys = (c.vertical?.storeys || 0) + 1;
    host.cityArchitecture ||= { version: 1, cityId: site.id, hostKey: c.streetKey, seed: site.id, genre: c.genre, buildings: {} };
    const buildings = host.cityArchitecture.buildings;
    if (!buildings[id]) {
      const plan = Plans.create({ seed: site.id, hostKey: c.streetKey, id, name: room.name, genre: c.genre,
        type: c.establishmentType, width: c.footprint?.width || c.venue?.width, depth: c.footprint?.depth || c.venue?.depth,
        storeys,storeyHeightMetres:c.vertical?.storeyHeightMetres, authored: true, programs: programs(c, storeys, site.design) });
      buildings[id] = { plan, status: 'planned', floors: {} }; count++;
    }
    const existingFloors=c.vertical?.towerId?Object.entries(database).filter(([,r])=>r.cityRoom?.vertical?.towerId===c.vertical.towerId)
      .map(([key,r])=>({key,floor:r.cityRoom.vertical.floor})):[];
    for (const row of c.vertical?.directory || (existingFloors.length?existingFloors:[{ floor: 0, key }])) {
      const target = database[row.key]; if (!target?.cityRoom || row.floor >= buildings[id].plan.storeys) continue;
      target.cityRoom.architecture = { hostKey: c.streetKey, buildingId: id, floor: row.floor };
      buildings[id].floors[row.floor] ||= { legacyKey: row.key };
    }
  }
  return count;
}
function forRoom(room, database) {
  const ref = room?.cityRoom?.architecture;
  const record = ref && database[ref.hostKey]?.cityArchitecture?.buildings?.[ref.buildingId];
  return record ? { ...ref, name: record.plan.name, lobby:record.plan.lobby,circulation:record.plan.circulation,
    plan: record.floors[ref.floor]?.plan || Plans.floor(record.plan, ref.floor), authored: record.plan.authored } : null;
}
function persist(database, key, dungeon) {
  if (!dungeon?.cityArchitecture || !database[key]) return false;
  const old = database[key].cityArchitecture;
  const incoming = structuredClone(dungeon.cityArchitecture);
  for (const [id, record] of Object.entries(old?.buildings || {})) {
    if (!incoming.buildings[id]) incoming.buildings[id] = record;
    else {
      const next=incoming.buildings[id];
      for(const [n,floor]of Object.entries(record.floors||{}))next.floors[n]={...next.floors[n],...floor};
      if(record.status==='built')next.plan=record.plan;
    }
  }
  database[key].cityArchitecture = incoming;
  return true;
}
function cacheLayer(database, dungeons, key, dungeon) {
  const ref=dungeon.sceneSpec?.city?.architecture||database[key]?.cityRoom?.architecture;
  const host=ref&&dungeons[ref.hostKey];
  if(!host||ref.hostKey===key)return false;
  host.cityInteriorLayers||={version:1,buildings:{}};
  const building=host.cityInteriorLayers.buildings[ref.buildingId]||={floors:{}};
  building.floors[ref.floor]={legacyKey:key,dungeon};
  return true;
}
function cachedLayer(database,dungeons,key){
  const ref=database[key]?.cityRoom?.architecture;
  return ref&&dungeons[ref.hostKey]?.cityInteriorLayers?.buildings?.[ref.buildingId]?.floors?.[ref.floor]?.dungeon||null;
}
module.exports = { programs, installNamed, forRoom, persist, cacheLayer, cachedLayer };
