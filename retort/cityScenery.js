'use strict';
// world1 CITY_PROPS: dress a city room (a placed campaign-map city) with the city voxel kit, district by district.
// Parts are scene structures: lit/shadowed by the normal voxel-prop path, mesh shared per tile, range/frustum culled,
// street detail additionally LOD-culled by cullDistance. Decorative parts never block movement or reserved routes.
const Flags = require('./worldFlags');
const CityKit = require('../assets/cityKit');
const sprites=new Map();
function sprite(shape){
  const Kits=require('../assets/genreKits');if(!Kits.has(shape))return null;
  if(!sprites.has(shape)){
    const canvas=require('canvas').createCanvas(96,96);
    Kits.paint(canvas.getContext('2d'),shape,0,0,96,96);sprites.set(shape,canvas.toDataURL('image/png'));
  }
  return sprites.get(shape);
}
function apply(dungeon, sceneSpec, citySite) {
  if (!Flags.on('CITY_PROPS') || !Flags.on('CAMPAIGN_MAP') || !citySite || !dungeon?.cells || !dungeon.layout) return { status: 'skipped' };
  if(sceneSpec.city?.roomKind==='city-building'||sceneSpec.roomKind==='city-building')return{status:'skipped',reason:'building-interior'};
  if (dungeon.cityScenery?.version) return { status: 'already-built', count: dungeon.cityScenery.count };
  const { width, height } = dungeon.layout;
  const resolution = require('../assets/genreKits').resolve({ genre: sceneSpec.city?.genre, planarRealm: sceneSpec.worldContext?.planarRealm }, require('./genreLayer').activeSetting());
  const expanded = Flags.on('ARCHITECTURE_EXPANSION');
  const Urban=require('../assets/urbanDesigns'), scale=Urban.scale(citySite,resolution.genre),heights=Urban.PROFILES[resolution.genre]||Urban.PROFILES.fantasy;
  const lowRise=['outpost','village','town'].includes(scale),vertical=citySite.design?.verticality;
  const authoredHeight=!lowRise&&vertical?require('./cityVerticality').validate(vertical).floors*.8:0;
  const low=lowRise?Math.min(5,heights[0]):Math.max(heights[0],authoredHeight*.4),high=lowRise?Math.min(8,heights[1]):Math.max(heights[1],authoredHeight);
  const reserved = new Set(Object.entries(dungeon.cells).filter(([, c]) => c.navigationReserved || c.exitMarker || c.object || c.feature).map(([k]) => k));
  if (dungeon.start) for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) reserved.add(`${dungeon.start.x + dx},${dungeon.start.y + dy}`);
  const blocks=expanded?require('./cityBlocks').apply(dungeon,sceneSpec,citySite,{genre:resolution.genre,scale,reserved,complete:true}):null;
  if(blocks?.status==='built')for(const [key,c]of Object.entries(dungeon.cells))if(c.cityParcel||c.cityStreet)reserved.add(key);
  const districtMap = { gate:'walls',market:'market ward',temple:'temple',residential:'tenements',guild:'guild quarter',harbor:'harbor ward',undercity:'stores' };
  const localSite = Flags.on('CITY_COMPLETE') && sceneSpec.city?.district ? { ...citySite, districts:[districtMap[sceneSpec.city.district] || 'tenements'] } : citySite;
  const plan = CityKit.planCity({ cells: dungeon.cells, width, height, city: localSite, seed: `${dungeon.geoKey}:${citySite.id}`, reserved,
    arrival:expanded?dungeon.start:null,urban:expanded?{scale,walkIn:blocks?.status==='built',heights:{midrise:low,skyline:high,terrace:low*.7}}:null });
  dungeon.tiles ||= {}; dungeon.sceneStructures ||= [];
  const frontages=require('../assets/cityEstablishments').frontages(sceneSpec.city?.fabric);
  let frontageIndex=0;
  for (const p of plan.placements) {
    let shape=p.tileShape;
    if(expanded&&!require('../assets/cityArchitectureStyles').profile(resolution.genre,resolution.locked).heritage){
      const role=p.shape==='city_gate'?'gate':/tower|lighthouse/.test(p.shape)?'tower':p.shape==='market_stall'?'stall':
        /column/.test(p.shape)?'column':/temple|basilica/.test(p.shape)?'hall':/guild|warehouse|granary|baths/.test(p.shape)?'hall':
        /townhouse|insula/.test(p.shape)?'house':/street_shrine/.test(p.shape)?'shrine':
        p.group==='utility'&&!['bridge','canal_wall','water_channel'].includes(p.shape)?'utility':
        /forum_portico/.test(p.shape)?'hall':null;
      if(role)shape=`x_${resolution.genre}_${role}`;
      if(resolution.locked&&/forum_portico/.test(p.shape))shape='x_funerary_stoa';
      if(p.urbanRole)shape=`a_${resolution.genre}_urban_${p.urbanRole}`;
    }
    const tile = `city_${shape}_${p.palette}${p.guild ? '_' + p.guild.replace(/\W+/g, '') : ''}`;
    dungeon.tiles[tile] ||= { url: sprite(shape)||dungeon.tiles.wall?.url, spriteSpec: { voxelShape: shape, material: resolution.voxel || 'stone', collisionBlocking: false,
      cityKit: { palette: p.palette, guild: p.guild || null, city: { id: citySite.id, name: citySite.name, role: citySite.role } }, profile: 'flat', heightRatio: 1, baseWidth: 1, gridWidth: 1 } };
    const floor = dungeon.cells[`${p.x},${p.y}`]?.floorHeight || 0;
    const ceiling=dungeon.cells[`${p.x},${p.y}`]?.ceilHeight;
    const height=sceneSpec.indoor&&Number.isFinite(ceiling)?Math.min(p.height,Math.max(.5,ceiling-floor-.3)):p.height;
    const frontage=!p.detail&&p.urbanRole&&frontages.length?frontages[frontageIndex++%frontages.length]:null;
    dungeon.sceneStructures.push({ tile, shape, role: `world1-city-${p.group}`, district: p.district, position: { x: p.x, y: p.y, z: floor },
      size: { x: p.footprint[0], y: p.footprint[1], z: height }, world1City: true, ...(frontage?{cityFrontage:{id:frontage.id,type:frontage.type,name:frontage.name,interactionPolicy:frontage.interactionPolicy}}:{}), ...(p.detail ? { cullDistance: p.cullDistance } : {}) });
    if (p.light) (dungeon.cityLights ||= []).push({ x: p.x + .5, y: p.y + .5, z: floor + height * .9 });
  }
  dungeon.cityScenery = { version: plan.version, palette: plan.palette, genre: resolution.genre, scale, style:heights[3], count: plan.placements.length, instancedTiles: plan.instancedTiles };
  if(expanded && sceneSpec.city?.routes?.length)for(const route of sceneSpec.city.routes){
    const marker=dungeon.roomExits?.markers?.find(m=>m.direction===route.direction);if(!marker)continue;
    const shape=`x_${resolution.genre}_gate`,tile=`city_entrance_${route.direction}`;
    dungeon.tiles[tile]={spriteSpec:{voxelShape:shape,material:resolution.voxel,collisionBlocking:false},landmark:{type:'city_entrance',label:route.name}};
    marker.destinationName=route.name;marker.targetCoordinates=route.targetCoordinates;
    dungeon.sceneStructures.push({role:'city-building-entrance',shape,tile,direction:route.direction,label:route.name,targetCoordinates:route.targetCoordinates,
      position:{x:marker.x-.05,y:marker.y-.05,z:marker.floor||0},size:{x:1.1,y:1.1,z:2.6},world1City:true});
  }
  return { status: 'built', palette: plan.palette, count: plan.placements.length, blocks, instancedTiles: plan.instancedTiles, districts: [...new Set(plan.placements.map(p => p.district))] };
}
function citySiteFor(state, geoKey) {
  try { return JSON.parse(state.getRoomNameDatabase() || '{}')[geoKey]?.environmentIntent?.citySite || null; } catch { return null; }
}
module.exports = { apply, citySiteFor };
