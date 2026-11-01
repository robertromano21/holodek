'use strict';
// Functional ranges keep genre fidelity without seeding the same named roster into every model request.
const DIRECTIONS={
  fantasy:'Use recognizable tabletop-fantasy ancestries such as Human, Elf, Dwarf, Halfling, Gnome and Orc where this world permits, and clear adventuring classes such as Fighter, Rogue, Wizard, Cleric, Ranger, Paladin, Bard or Druid. These common labels may recur; invent the cultures, traditions and individual histories, not euphemisms that conceal every familiar ancestry.',
  'dark-fantasy':'Keep recognizable fantasy ancestries and adventuring classes (Human, Elf, Dwarf, Halfling; Fighter, Rogue, Wizard, Cleric, Ranger, Paladin) alongside fitting original options. Darkness changes societies, risks and magical traditions, not every race into an ash/bone adjective and every class into a grim job.',
  'sci-fi':'Derive origins from this world\'s actual biology, migration, planetary environments and machine personhood. Human-only worlds need human origins, not invented alien species. Where aliens or synthetics exist, give genuinely different anatomy and social history. Classes can span exploration, science, medicine, command, security, diplomacy, fabrication and ordinary civilian expertise; do not force every world into orbital maintenance or scarcity.',
  cyberpunk:'Origin is ancestry, upbringing or explicitly established embodiment, not occupation. Do not treat every implant user as a new biological species. Distinguish the world\'s actual neighborhoods, cultures and permitted modifications. Classes should span social, investigative, technical, medical, creative and martial approaches with different methods, not only hacking, courier work and corporate security.',
  mythic:'Choose mortal and other established mythic peoples, martial champions, ritual specialists, performers, hunters, seers and civic expertise without importing a foreign pantheon.',
  'post-apocalyptic':'Respect the cause and age of collapse. Survivors can have diverse cultures and professions; mutation, radiation and bunker origins are not mandatory.',
  steampunk:'Distinguish cultures from trades; mechanical embodiment must be established. Mix civic, adventurous, scientific, social and martial expertise, not only boiler repair.',
  western:'Respect the chosen frontier and its peoples. Include diverse lawful and civilian expertise as well as dangerous occupations; no obligatory magic or invented species.',
  modern:'Use human cultural or regional origins unless the premise establishes nonhumans. Professional skills are not magical species; respect the chosen country and era.',
  noir:'Use the era and actual communities, with investigative, social, artistic, medical and practical approaches. No obligatory occult species or universally corrupt professions.',
  nautical:'Respect the chosen era, ports and maritime peoples; mix shipboard, shore, scholarly, social and martial expertise. Not everyone is a pirate or sea monster.',
  'cosmic-horror':'Ordinary human communities and credible professions remain the default unless the premise establishes otherwise. Exposure to a mystery is not automatically a race.',
  'gothic-horror':'Use the established human and supernatural peoples, with ordinary professions and fantasy adventurers as appropriate. Not every origin is undead or cursed.',
  solarpunk:'Build diverse communities and scientific, ecological, medical, creative, diplomatic and adventurous roles. Cooperation does not imply identical beliefs or mandatory plant people.',
  dieselpunk:'Respect the world\'s industrial era and communities. Mix civilian, investigative, artistic, scientific and martial roles; not every class is a soldier or mechanic.',
  underwater:'Determine whether inhabitants are aquatic peoples or surface dwellers in habitats. Respect anatomy and pressure requirements; origin is not a diving occupation.',
  prehistoric:'Create sophisticated cultures, crafts, ecological knowledge, medicine, diplomacy and adventurous roles appropriate to the established technology; no caricatures or mandatory invented species.',
  'desert-fantasy':'Respect the world\'s specific peoples and magic. Include merchants, scholars, healers, warriors, travelers and ritual expertise without reducing every origin to sand or water.'
};
const ANGLES=['contrast disciplines and social backgrounds','contrast approaches to exploration, conflict and negotiation',
  'contrast training traditions and relationships to institutions','contrast environments, sensory abilities and everyday livelihoods',
  'contrast practical strengths, limitations and cultural histories','contrast established professions with unusual but plausible specialists'];
function direction(world){
  const weights=world?.genreWeights?.length?world.genreWeights:(world?.genres||[]).map(genre=>({genre,weight:1}));
  if(!weights.length)return '';
  const seed=String(world.worldSeed||world.seed||''),hash=require('../assets/cityParcels').hash(seed);
  return '[GENRE CHARACTER DIRECTION] '+weights.map(w=>`${w.genre} (weight ${w.weight}): ${DIRECTIONS[w.genre]||''}`).join(' ')+
    ' Treat these as ranges, not a fixed roster or mandatory checklist. Player instructions and the saved world take precedence. '+
    'For this world, '+ANGLES[hash%ANGLES.length]+'. Common ancestry/class labels may repeat across games; avoid repeating distinctive invented compound names and identical descriptions. '+
    'Use clear names rather than mandatory prefixes. No named characters, deities, factions or lore from another campaign. [/GENRE CHARACTER DIRECTION]';
}
module.exports={DIRECTIONS,ANGLES,direction};
