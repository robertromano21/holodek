'use strict';
module.exports=genre=>({name:'Aster Treaty',tone:'Hopeful intrigue.',history:'Several mountain communities made a mutual defense pact.',
  arc:'Discover who is diverting travelers from the treaty road.',naming:'Names reflect several neighboring languages.',music:'Interwoven woodwinds.',
  realm:'A mountainous border country.',sky:'Clear skies above high ridges.',wilds:'Meadows and wooded passes.',peoples:'Several independent communities share the treaty road.',
  protagonist:'An itinerant investigator',antagonist:'An unknown saboteur',resourceName:'Resolve',currency:{singular:'mark',plural:'marks'},
  calendar:{name:'Treaty Years',abbr:'TY',now:82},opening:{name:'The Eastern Tollhouse',indoor:true,city:true},
  topology:{start:'Aster',goal:'The North Pass',layers:['Aster','The North Pass']},cities:[{name:'Aster',role:'trade center'}],
  powers:[],quests:['Investigate the missing road markers.'],factions:[{name:'Road Assembly',aim:'Keep travel safe.'}],genres:[genre],
  deathStory:{reason:'Local rescuers carry a shared beacon.',firstReturn:'A rescuer finds the beacon and brings you to shelter.',
    secondReturn:'A final rescue exhausts the beacon.',finalDeath:'The beacon can no longer summon help.'}});
