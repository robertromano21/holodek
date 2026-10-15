'use strict';
// Local analysis only; no OpenAI call and no access to the running adventure.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Speech=require('../retort/sidVoice'),Score=require('../retort/sidVoice/registerScore');
async function main(){
  const name=process.argv[2]||'Mortacia',text=process.argv[3]||'The gods sent Lanul through the ash, but grief could not break her promise.';
  if(name.length>100||text.length>2000)throw Error('Name or line too long');
  const result=await Speech.scoreFor(name,text,true,'2x',undefined,'10582',false,{detail:true});
  const info=Score.inspect(result.score),hash=crypto.createHash('sha256').update(result.score).digest('hex');
  const directory=path.resolve(__dirname,'../.retort-data/voice-scores');fs.mkdirSync(directory,{recursive:true});
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,45)||'voice',file=path.join(directory,slug+'-'+hash.slice(0,12)+'.sidvoice');
  fs.writeFileSync(file,result.score);fs.writeFileSync(file+'.json',JSON.stringify({name,text,sha256:hash,...info,articulation:result.articulation},null,2));
  console.log(JSON.stringify({file,sha256:hash,...info,articulation:result.articulation},null,2));return file;
}
if(require.main===module)main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
module.exports={main};
