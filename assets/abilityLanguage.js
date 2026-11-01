(function(root) {
  'use strict';
  function text(value, system) {
    if (!system || typeof value !== 'string') return value;
    const terms = { 'Party Spellbook': system.book, 'Full Party Spellbook': system.book,
      'spellbook': system.book, 'spells': system.plural, 'spell': system.ability,
      'Magic': system.resource, 'magical': 'specialized', 'scrolls': system.scroll + 's', 'scroll': system.scroll,
      'Casting': 'Activation', 'casting': 'activation', 'casts': 'uses', 'cast': system.activate,
      'Scribe': 'Learn', 'scribe': 'learn', 'Memorized': 'Loaded', 'memorized': 'loaded', 'weave': 'loadout' };
    return value.replace(/Full Party Spellbook|Party Spellbook|\b(?:spellbook|spells|spell|Magic|magical|scrolls|scroll|Casting|casting|casts|cast|Scribe|scribe|Memorized|memorized|weave)\b/gi,
      word => terms[word] || terms[word.toLowerCase()] || (word.toLowerCase() === 'magic' ? system.resource : word));
  }
  function apply(node, system) {
    if (!node || !system) return;
    const walk = current => {
      if (current.nodeType === 3) current.nodeValue = text(current.nodeValue, system);
      else { for (const attr of ['title', 'aria-label']) if (current.hasAttribute?.(attr)) current.setAttribute(attr, text(current.getAttribute(attr), system));
        for (const child of current.childNodes || []) walk(child); }
    };
    walk(node);
  }
  function command(value, system) {
    if (!system || typeof value !== 'string') return value;
    const verb = system.activate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return value.replace(new RegExp('^\\s*(?:' + verb + '|activate)\\s+', 'i'), 'cast ');
  }
  const api = { text, apply, command };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbilityLanguage = api;
})(typeof window === 'object' ? window : globalThis);
