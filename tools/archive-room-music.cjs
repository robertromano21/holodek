'use strict';
// Read-only source import. Archives existing arrangements; never restores a save.
const fs=require('node:fs'),Archive=require('../retort/sidArchive');
try{
  const args=process.argv.slice(2);
  if(args[0]==='--save'){
    const payload=require('../saveGames').createStore().read(Number(args[1]||1)).payload;
    for(const [roomKey,song]of Object.entries(payload.server.roomMusicDatabase||{}))
      console.log(Archive.record(song,{roomKey,runId:payload.runId,source:'saved-composition-import'}).directory);
  }else{
    for(const file of args.length?args:['retort/current_room.json'])
      console.log(Archive.record(JSON.parse(fs.readFileSync(file,'utf8')),{source:'existing-score-import'}).directory);
  }
  console.log('Standalone converter: '+Archive.installTool());
}catch(error){console.error(error.stack);process.exitCode=1;}
