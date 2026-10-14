'use strict';

const instructions = 'For NEW character, creature and item names, separate ordinary words and epithets with spaces. Do not join a phrase into CamelCase, a hyphen chain or an underscore identifier. A single invented proper name is fine. Use readable names, not code identifiers. Copy every EXISTING canonical name exactly; never respell or rename a saved character or item.';

// Creation-time cleanup only. Never apply this to saved identity keys or lookups.
function clean(value) {
  return String(value ?? '').replace(/[-_\u2010-\u2015\u2212/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, '').replace(/\s+/g, ' ').trim();
}

module.exports = { instructions, clean };
