'use strict';
const Archive=require('./sidArchive'),Slots=require('./musicSlots'),Clock=require('./sidMode');
function describe(song,{coords,runId,clock=Clock.get()}={}){
  if(!Clock.norm(clock))throw Error('clock must be 1x, 2x or 4x');
  const archive=Archive.record(song,{roomKey:coords,runId,clock});
  const base='/music-archive/'+archive.id+'/',variants={'8580':base+'8580.sid','10582':base+'10582.sid'};
  return{format:'sid',renderer:'live-sid',sid:variants['8580'],url:variants['8580'],variants,
    seconds:archive.manifest.seconds,clock,coords,runId,archiveId:archive.id};
}
function prepare(song,context={}){
  const result=describe(song,context),slot=Slots.find(context.coords)||Slots.nextSlot();
  Slots.publishSid(slot,context.coords,result);return{...Slots.latest(),...result};
}
module.exports={describe,prepare};
