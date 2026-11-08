'use strict';
function record(state,report) {
  const phases=['received','queued','waiting','shown','unavailable'];
  const coords=state.getLastCoords(),geoKey=`${coords.x},${coords.y},${coords.z}`;
  if(!report || report.runId!==state.getDungeonRunId() || report.geoKey!==geoKey || !phases.includes(report.phase))return null;
  const fields={version:60,runId:100,geoKey:50,phase:20,reason:100,actor:140,requestId:160,floor:200};
  if(Object.entries(fields).some(([key,max])=>typeof report[key]!=='string' || report[key].length>max) || !Number.isFinite(report.at))return null;
  return Object.fromEntries([...Object.keys(fields),'at'].map(key=>[key,report[key]]));
}
module.exports={record};
