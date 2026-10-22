'use strict';
// world1 CITY_PROPS: dress a city room (a placed campaign-map city) with the city voxel kit, district by district.
// Parts are scene structures: lit/shadowed by the normal voxel-prop path, mesh shared per tile, range/frustum culled,
// street detail additionally LOD-culled by cullDistance. Decorative parts never block movement or reserved routes.
const Flags = require('./worldFlags');
const CityKit = require('../assets/cityKit');
function apply(dungeon, sceneSpec, citySite) {
  if (!Flags.on('CITY_PROPS') || !Flags.on('CAMPAIGN_MAP') || !citySite || !dungeon?.cells || !dungeon.layout) return { status: 'skipped' };
  if (dungeon.cityScenery?.version) return { status: 'already-built', count: dungeon.cityScenery.count };
  const { width, height } = dungeon.layout;
  const resolution = require('../assets/genreKits').resolve({ genre: sceneSpec.city?.genre, planarRealm: sceneSpec.worldContext?.planarRealm }, require('./genreLayer').activeSetting());
  const expanded = Flags.on('ARCHITECTURE_EXPANSION');
  const reserved = new Set(Object.entries(dungeon.cells).filter(([, c]) => c.navigationReserved || c.exitMarker || c.object || c.feature).map(([k]) => k));
  if (dungeon.start) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) reserved.add(`${dungeon.start.x + dx},${dungeon.start.y + dy}`);
  const districtMap = { gate:'walls',market:'market ward',temple:'temple',residential:'tenements',guild:'guild quarter',harbor:'harbor ward',undercity:'stores' };
  const localSite = Flags.on('CITY_COMPLETE') && sceneSpec.city?.district ? { ...citySite, districts:[districtMap[sceneSpec.city.district] || 'tenements'] } : citySite;
  const plan = CityKit.planCity({ cells: dungeon.cells, width, height, city: localSite, seed: `${dungeon.geoKey}:${citySite.id}`, reserved });
  dungeon.tiles ||= {}; dungeon.sceneStructures ||= [];
  for (const p of plan.placements) {
    let shape=p.tileShape;
    if(expanded){
      const role=p.shape==='city_gate'?'gate':/tower|lighthouse/.test(p.shape)?'tower':p.shape==='market_stall'?'stall':
        /column/.test(p.shape)?'column':/temple|basilica/.test(p.shape)?'hall':/guild|warehouse|granary|baths/.test(p.shape)?'hall':
        /townhouse|insula/.test(p.shape)?'house':/street_shrine/.test(p.shape)?'shrine':
        p.group==='utility'&&!['bridge','canal_wall','water_channel'].includes(p.shape)?'utility':
        /forum_portico/.test(p.shape)?'hall':null;
      if(role)shape=`x_${resolution.genre}_${role}`;
      if(resolution.locked&&/forum_portico/.test(p.shape))shape='x_funerary_stoa';
    }
    const tile = `city_${shape}_${p.palette}${p.guild ? '_' + p.guild.replace(/\W+/g, '') : ''}`;
    dungeon.tiles[tile] ||= { url: dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: resolution.voxel || 'stone', collisionBlocking: false,
      cityKit: { palette: p.palette, guild: p.guild || null, city: { id: citySite.id, name: citySite.name, role: citySite.role } }, profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
    const floor = dungeon.cells[`${p.x},${p.y}`]?.floorHeight || 0;
    dungeon.sceneStructures.push({ tile, shape, role: `world1-city-${p.group}`, district: p.district, position: { x: p.x, y: p.y, z: floor },
      size: { x: p.footprint[0], y: p.footprint[1], z: p.height }, world1City: true, ...(p.detail ? { cullDistance: p.cullDistance } : {}) });
    if (p.light) (dungeon.cityLights ||= []).push({ x: p.x + .5, y: p.y + .5, z: floor + p.height * .9 });
  }
  dungeon.cityScenery = { version: plan.version, palette: plan.palette, genre: resolution.genre, count: plan.placements.length, instancedTiles: plan.instancedTiles };
  if(expanded && sceneSpec.city?.routes?.length)for(const route of sceneSpec.city.routes){
    const marker=dungeon.roomExits?.markers?.find(m=>m.direction===route.direction);if(!marker)continue;
    const shape=`x_${resolution.genre}_gate`,tile=`city_entrance_${route.direction}`;
    dungeon.tiles[tile]={spriteSpec:{voxelShape:shape,material:resolution.voxel,collisionBlocking:false},landmark:{type:'city_entrance',label:route.name}};
    marker.destinationName=route.name;marker.targetCoordinates=route.targetCoordinates;
    dungeon.sceneStructures.push({role:'city-building-entrance',shape,tile,direction:route.direction,label:route.name,targetCoordinates:route.targetCoordinates,
      position:{x:marker.x-.05,y:marker.y-.05,z:marker.floor||0},size:{x:1.1,y:1.1,z:2.6},world1City:true});
  }
  return { status: 'built', palette: plan.palette, count: plan.placements.length, instancedTiles: plan.instancedTiles, districts: [...new Set(plan.placements.map(p => p.district))] };
}
function citySiteFor(state, geoKey) {
  try { return JSON.parse(state.getRoomNameDatabase() || '{}')[geoKey]?.environmentIntent?.citySite || null; } catch { return null; }
}
module.exports = { apply, citySiteFor };
