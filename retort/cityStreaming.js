'use strict';
const Flags=require('./worldFlags'),I=require('../assets/dungeonInhabitants');

// Visits reconcile a missed snapshot only. Architecture is saved during room preparation,
// never grown behind a walking player (including in legacy, partially built cities).
function advance(state,request){
  if(!Flags.on('ARCHITECTURE_EXPANSION')||!Flags.on('CITY_PROPS')||state.getGamePaused())return null;
  const coords=state.getLastCoords(),key=`${coords.x},${coords.y},${coords.z}`;
  if(request.runId!==state.getDungeonRunId()||request.geoKey!==key)return null;
  const source=state.getRoomDungeonForSimulation(coords),stream=source?.cityBlocks?.streaming;
  if(!stream||!request.geometryStamp||request.geometryStamp===source._geometryStamp||
    !I.pointWalkable(source,request.player?.x,request.player?.y))return null;
  return{
    type:'dungeonCellUpdate',runId:request.runId,geoKey:key,previousStamp:request.geometryStamp,geometryStamp:source._geometryStamp,cells:source.cells,
    cityStream:{version:1,revision:stream.revision,snapshot:source}};
}
module.exports={advance};
