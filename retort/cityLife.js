'use strict';
const E=require('../assets/cityEstablishments');
const REQUIRED={gate:['inn','transit','court'],market:['shop','bar','foodhall'],temple:['temple','clinic','bathhouse'],
  residential:['home','park','civic'],guild:['guild','arena','library'],harbor:['workshop','warehouse'],undercity:['theatre','workshop']};
const THEMES={
  fantasy:'Trade halls, coaching yards, baths, tournament crowds, civic petitions, workshops and ordinary households; vary wealth, ancestry and neighborhood customs.',
  'dark-fantasy':'Layered, oppressive capitals can have memorial gardens, festivals, contests, arts, trade, friendship and domestic lives. Follow this world\'s actual inhabitants and powers; do not assume everyone is dead or that the city is an underworld.',
  mythic:'Processional streets, stoas, amphitheatres, public baths, household courts, civic debate and ceremonial gardens; citizens have ordinary lives beyond temples.',
  'sci-fi':'Habitation, food production, life support, medicine, cargo, research, education and recreation form an inhabited system. Distinguish station decks from planetary cities and workers from visitors.',
  cyberpunk:'Corporate towers and private plazas contrast with dense housing, independent clinics, worker associations, nightlife, markets, public transit and neglected infrastructure; not everyone is a criminal or fixer.',
  'post-apocalyptic':'Reused civic buildings, salvage trades, mutual aid, cultivation, storytelling, markets and contested institutions; scarcity is background, not the same water dispute in every room.',
  steampunk:'Passenger terminals, exhibition halls, engineering societies, courts, factories, canal commerce, greenhouses and domestic terraces; machinery supports urban life, not perpetual breakdowns.',
  western:'Courthouses, depots, boarding houses, trades, bathhouses, theaters, diverse households and boomtown businesses; distinguish a city from a frontier camp.',
  modern:'Dense mixed-use blocks, civic institutions, libraries, sports, schools, hospitals, workplaces, entertainment and public transit; include quiet residential lives and varied social groups.',
  noir:'Hotels, diners, theaters, unions, municipal services, courts, archives, night work and domestic neighborhoods; mysteries are possible, not a compulsory crime in every venue.',
  nautical:'Shipyards, chandlers, bonded storage, customs, pilots, maritime courts, ferry landings, provisioning, dockside lodging and civic gardens; the port connects to a real inland city.',
  'cosmic-horror':'A functioning coastal or scholarly city with archives, medical institutions, civic clubs, households and theaters; hidden unease contrasts with ordinary routines rather than universal cult membership.',
  'gothic-horror':'Layered old streets, schools, opera, courts, workshops, hospitals, memorial gardens and residences; keep personal stories distinct from aristocratic and religious power.',
  solarpunk:'Ecological corridors, cooperative workplaces, shared food systems, biodiversity gardens, public learning, sports, mediation and accessible transit; optimism still permits personal tensions and difficult choices.',
  dieselpunk:'Rail hubs, factories, offices, union halls, public baths, sports, newsreel theaters, civic parks and mixed residential blocks; not every resident is a soldier.',
  underwater:'Pressure transitions, buoyancy-aware structures, current routes, marine cultivation, oxygen infrastructure, medicine, knowledge vaults and acoustic performance; dry interiors remain physically coherent.',
  prehistoric:'A large settlement of this world\'s capabilities: gathering grounds, seasonal trade, craft lodges, story keepers, feasting places, hot springs and kin households; do not introduce modern industry.',
  'desert-fantasy':'Shaded souks, caravan courts, hammams, scholarly institutions, gardens, civic hearings, festival grounds and domestic courtyards; livelihoods and scenarios extend beyond water rights.'
};
function required(district,scale='city'){return (REQUIRED[district]||[]).slice(0,['city','metropolis'].includes(scale)?3:2);}
function brief(genre,canonical=false){
  return (THEMES[genre]||THEMES.fantasy)+(canonical?' This is Children of the Grave: retain its original underworld lore and cultivated cast; do not import another campaign\'s named cities, factions or gods.':' All names, institutions and scenarios belong solely to the saved original world and its established history and powers.')+
    ' These are functional possibilities, never prefab scenarios. Author original venue names and local activities. Streets, foundations, access, freight and public spaces must support the buildings\' actual uses. '+
    (['fantasy','dark-fantasy','mythic','desert-fantasy','gothic-horror'].includes(genre)?
      'Use grounded plinths, retaining terraces, supported arches and vaults, processional avenues, smaller lanes, drainage, raised walkways and bridge abutments where the setting calls for them.':
      'Use grounded structural cores and podiums, service access, human-scale active frontages and pedestrian routes below the skyline. Modern/future capitals can have enormous towers, transit concourses, public terraces and supported elevated links; do not enlarge every shop into a tower. Only saved connected floors and routes are accessible.');
}
function venue(type,id,name){const p=E.profile(type);return p?{version:1,id,type,name,...p}:null;}
function guidance(v){return v?`VENUE FUNCTION (read-only): ${JSON.stringify({name:v.name,type:v.type,spaces:v.spaces,roles:v.roles,programUse:v.programUse,
  widthMetres:v.width*2.5,depthMetres:v.depth*2.5,clearanceMetres:v.clearance*2.5})}. Keep entrances and public circulation usable. Activities and inhabitants fit these spaces, not a generic repair crew. Give each person a reason for this visit: working, running an errand, meeting someone, resting, researching or seeking a commission. Their activity should use an actual room and appropriate furniture. Do not invent completed transactions or payable work; only saved contracts have terms. An arena is not an automatic death match, a guild is not an automatic quest, and a park is not wilderness.`:'';}
module.exports={REQUIRED,THEMES,required,brief,venue,guidance};
