'use strict';
const Profile=require('../../retort/sidVoice/profile');
function fixture(chip='10582',mode='2x',guide='lj',length=80){
  const frames=Array.from({length},(_,i)=>[i>8&&i<length*.75?205:0,Array.from({length:128},(_,k)=>Math.log(.001+.2*Math.exp(-(((k*11025/127-900)/1000)**2)))),Array.from({length:13},()=>i>8&&i<length*.75?0.05:0.9)]);
  return{P:{...Profile.normalize({name:'Mortacia',f0:205}),guide},frames,chip,mode,final:'.',captureRegisters:true};
}
module.exports={fixture};
