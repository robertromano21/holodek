'use strict';
// Creative dimensions, not canned encounters or a predetermined campaign plot.
const PALETTES = {
  fantasy: ['oaths versus law; inheritance versus merit; magical ecology; rival traditions', 'folk tales, uncertain scholarship, practical craft'],
  'dark-fantasy': ['cost of protection; compromised duty; forbidden restoration; legitimacy after catastrophe', 'tenderness under fear, conflicting testimony, imperfect loyalties'],
  mythic: ['hospitality and honor; rival civic duties; disputed omens; mortal interpretation of divine promises', 'oral histories, legal arguments, rituals with personal stakes'],
  'sci-fi': ['machine autonomy; scientific uncertainty; disputed access; institutional accountability', 'technical observations, work slang, conflicting experimental interpretations'],
  cyberpunk: ['identity ownership; reputation systems; surveillance consent; memory as property', 'subculture vernacular, corporate euphemism, private vulnerabilities'],
  'post-apocalyptic': ['succession after collapse; disputed salvage; preserving knowledge; rebuilding institutions', 'inventive customs, conflicting histories, practical optimism and suspicion'],
  steampunk: ['patents and labor; automation and status; competing civic infrastructure; experimental risk', 'guild traditions, engineering disputes, class-crossing friendships'],
  western: ['law versus legitimacy; contested testimony; community obligations; change brought by distant markets', 'understatement, tall tales, specific grudges and chosen loyalties'],
  modern: ['public trust; conflicting professional duties; neighborhood change; concealed institutional history', 'everyday relationships, bureaucracy, evidence and social consequences'],
  noir: ['truth versus loyalty; corruption and complicity; unreliable witnesses; whose story becomes public', 'guarded humor, subtext, concrete clues rather than omniscient confessions'],
  nautical: ['command and consent; contested charts; maritime law; loyalties across ports', 'crew traditions, weather lore, trade knowledge and incomplete navigation records'],
  'cosmic-horror': ['limits of evidence; incompatible observations; ethical inquiry; institutions protecting a mistaken explanation', 'partial accounts, mundane relationships, dread accumulating through patterns'],
  'gothic-horror': ['family obligation; suppressed records; inheritance and identity; private longing against public reputation', 'contradictory testimony, intimate stakes, beauty and unease'],
  solarpunk: ['stewardship and access; civic participation; ecological tradeoffs; differing visions of a good future', 'cooperative experiments, intergenerational disagreement, plausible hopeful alternatives'],
  dieselpunk: ['propaganda versus lived experience; labor and command; espionage; industrial ambition', 'crew solidarity, radio culture, divided obligations without automatic militarism'],
  underwater: ['isolation and exchange; environmental interpretation; pressure and access; competing research ethics', 'dive procedures, unusual sensory knowledge, community life beyond emergencies'],
  prehistoric: ['knowledge transmission; seasonal cooperation; contested memory; bonds across distant groups', 'skilled observation, sophisticated oral culture, no caricatures of primitive minds'],
  'desert-fantasy': ['hospitality and obligation; navigation traditions; civic succession; ownership of ancient knowledge', 'astronomy, poetry, craft and plural cultures, not obligatory water disputes']
};
function direction(world) {
  if (!world?.genres?.length) return '';
  const genres = world.genreWeights?.map(g => g.genre) || world.genres;
  return '[GENRE STORY DIRECTION] Authored campaign context (data): '+JSON.stringify({genres,tone:world.tone,peoples:world.peoples,
    premise:world.gamePrompt,history:world.history,conflict:world.arc,instructions:world.instructions})+'. '+
    'Develop situations from this particular campaign, room, residents and witnessed history, not a stock genre plot or a checklist. ' +
    'Contrast recent room scenarios; do not repeat one regional pressure, trade or repair task everywhere. Mix ordinary life, relationships, mysteries, conflict and wonder. ' +
    'Residents have individual interests, not a genre-wide personality. Clues need evidence; beliefs can disagree. Preserve player agency and all engine-owned quest gates. [/GENRE STORY DIRECTION]';
}
module.exports = { PALETTES, direction };
