'use strict';

// Keep campaign choices on the renderer's existing cave/crypt biome IDs.
const TEMPLATES = [
  ['cavern', true, 'cave', 'cave', 'Inside a natural cavern, an unbroken rock ceiling covers irregular chambers, stalagmites and dry winding passages.', 'Name a cavern or grotto, not an open canyon.'],
  ['mine', true, 'cave', 'mine', 'Inside a worked mine, a rock ceiling covers timber-braced galleries, cut rock faces, ore seams and connected haulage passages.', 'Name a mine or mining gallery; shafts are entrances, not unsupported drops.'],
  ['lava_tube', true, 'cave', 'cave', 'Inside a volcanic lava tube, a solid basalt ceiling covers cooled lava shelves and branching passages. Any molten pools lie beside a continuous dry route.', 'Name a lava tube or basalt tunnel, not an open volcanic caldera.'],
  ['fungal_cavern', true, 'cave', 'cave', 'Inside a damp fungal cavern, a rock ceiling covers mushroom clusters and root-fed growth beside clear dry paths.', 'Name a fungal cavern or mushroom grotto; this is underground, not a forest beneath the sky.'],
  ['crystal_cavern', true, 'cave', 'cave', 'Inside a crystal cavern, quartz clusters and mineral seams line irregular stone chambers beneath a continuous rock ceiling.', 'Name a crystal cavern or geode grotto, not a crystal palace.'],
  ['underground_river', true, 'cave', 'cave', 'Inside a river cavern, a rock ceiling covers an underground stream with continuous dry bank paths between the entrances. Pools and water props stay off the required route.', 'Name a river cavern or subterranean watercourse, not an outdoor riverbank.'],
  ['ice_cave', true, 'cave', 'ice_cave', 'Inside an ice cave, a frozen rock ceiling covers frost-rimmed chambers, ice formations and connected firm walking ledges.', 'Name an ice cave or frozen grotto, not an open glacier.'],
  ['crypt', true, 'crypt', 'crypt', 'Inside an enclosed crypt, stone vaults cover sarcophagi, burial niches and connected caretaker passages.', 'Name a crypt, tomb or ossuary, distinct from an outdoor graveyard.']
];
const ids = new Set([...TEMPLATES.map(row => row[0]), 'catacomb']);
const REGIONAL_LAYERS = [
  'Basalt lava tubes and mineral caverns underlie the ash wastes; braced mines supply stone and ore, while spring caves and burial crypts draw caretakers and scavenging packs.',
  'Worked mines and limestone caverns run beneath caravan passes; miners trade at surface wells, and fungal grottos and crypt galleries branch away from the haulage routes.',
  'River caverns, damp fungal chambers and crystal grottoes drain toward the ferries; dry bank paths connect pump keepers, burial vaults and surface cisterns.',
  'Quarries, deep crypts and older volcanic tubes underlie the citadel approaches; mining guilds and tomb custodians contest routes, with occasional frozen caves in cold uplands.'
];
const PLANNING_GUIDANCE = 'Plan a connected underground layer as well as surface ecology: natural caverns, worked mines, volcanic lava tubes, crypts/catacombs, fungal and crystal grottoes, underground rivers and occasional ice caves. Vary them by local geology, moisture and heat; not every region needs every kind. Explain resources, miners or tomb custodians, unaligned cave beasts and links to surface wells, quarries, burial grounds or volcanic slopes. Underground interiors have solid rock/ice ceilings (crypts have stone vaults), no sky courtyards or outdoor forests. Keep reachable dry routes beside water/lava, use supported stairs or ramps for changes in elevation, and never promise stacked walkable floors, swimming, mining mechanics or fluid physics.';

function isUndergroundTemplate(template) { return ids.has(template); }
function isNaturalUnderground(spec = {}) {
  if (spec.indoor === false) return false;
  return spec.architecture ? ['cave', 'mine', 'ice_cave'].includes(spec.architecture) : spec.biome === 'cave';
}

function appearanceKind(spec = {}) {
  if (spec.indoor === false) return null;
  const planned = spec.source?.environmentIntent?.template || spec.worldContext?.environmentIntent?.template;
  if (ids.has(planned)) return planned === 'catacomb' ? 'crypt' : planned;
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  if (spec.architecture === 'crypt' || spec.architecture === 'catacomb' || spec.biome === 'crypt') return 'crypt';
  if (!isNaturalUnderground(spec)) return null;
  if (spec.architecture === 'mine' || /\bmines?\b|mining gallery/.test(text)) return 'mine';
  if (spec.architecture === 'ice_cave' || /ice cave|frozen (?:cave|grotto)/.test(text)) return 'ice_cave';
  if (/(?:lava|volcanic) tubes?|basalt tunnel/.test(text)) return 'lava_tube';
  if (/fungal|mushrooms?/.test(text)) return 'fungal_cavern';
  if (/crystal|quartz|geode/.test(text)) return 'crystal_cavern';
  if (/underground (?:river|stream)|river cavern|subterranean watercourse/.test(text)) return 'underground_river';
  return 'cavern';
}

module.exports = { TEMPLATES, REGIONAL_LAYERS, PLANNING_GUIDANCE, isUndergroundTemplate, isNaturalUnderground, appearanceKind };
