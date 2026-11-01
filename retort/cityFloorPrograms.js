'use strict';
const E = require('../assets/cityEstablishments');

// These classify physical uses, not stories. The model's saved use remains the authoring brief.
const USES = [
  ['library', /\b(librar\w*|archive\w*|research|reading|scholar\w*)\b/i],
  ['clinic', /\b(clinic\w*|hospital\w*|medical|infirmar\w*)\b/i],
  ['temple', /\b(temple\w*|shrine\w*|sanctuar\w*|worship)\b/i],
  ['inn', /\b(guest\w*|lodging|hotel\w*|inns?)\b/i],
  ['home', /\b(home\w*|residen\w*|apartment\w*|housing|habitat\w*|dormitor\w*)\b/i],
  ['foodhall', /\b(food\w*|dining|canteen\w*|kitchen\w*|restaurant\w*)\b/i],
  ['bar', /\b(tavern\w*|bars?|pubs?)\b/i],
  ['workshop', /\b(workshop\w*|fabricat\w*|manufactur\w*|artisan\w*|forge\w*)\b/i],
  ['warehouse', /\b(warehous\w*|storage|logistic\w*|freight)\b/i],
  ['guild', /\b(guild\w*|union\w*|training|apprentic\w*)\b/i],
  ['shop', /\b(shop\w*|retail|market\w*|trading)\b/i],
  ['transit', /\b(transit|station\w*|terminal\w*|transport)\b/i],
  ['civic', /\b(office\w*|administrat\w*|council\w*|observator\w*|civic|utilit\w*)\b/i]
];
function program(city, floor, storeys, design = {}) {
  const band = floor === 0 ? 'lowerUse' : floor === storeys ? 'roofUse' :
    floor < storeys / 3 ? 'lowerUse' : floor < storeys * .8 ? 'middleUse' : 'upperUse';
  const use = design.verticality?.[band];
  const mix = (design.districts?.[city.district]?.mix || []).filter(type => E.TYPES.includes(type));
  let type = floor === 0 ? city.establishmentType : USES.find(([, pattern]) => pattern.test(use || ''))?.[0] ||
    mix[floor % Math.max(1, mix.length)] || city.establishmentType || 'civic';
  if (floor > 0 && (E.profile(type)?.openAir || E.profile(type)?.monumental)) type = 'civic';
  return { band, type, use: use || E.profile(type).spaces.join(', ') };
}
module.exports = { program };
