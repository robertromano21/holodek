(function(root, factory) {
  const icons = typeof module === 'object' && module.exports ? require('./shrineIconography') : root.ShrineIconography;
  const api = factory(icons);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PantheonCharacters = api;
})(typeof window === 'object' ? window : globalThis, function(Icons) {
  'use strict';
  const names = Object.keys(Icons.pantheon);
  function name(value) {
    const text = String(value || '').trim();
    if (/^artihus(?:\b|$)/i.test(text)) return 'Arithus';
    return Icons.name(text) || names.find(n => text.toLowerCase().startsWith(n.toLowerCase() + ' ')) || null;
  }
  function canRecruit(actor) {
    const deity = name(actor?.name || actor?.Name);
    return actor?.recruitable !== false && (!deity || deity === 'Mortacia');
  }
  function recruitmentRefusal(input, actors = []) {
    const m = /^\s*(?:add|invite|recruit)\s+(.+?)(?:\s+to\s+(?:the\s+)?party)?\s*$/i.exec(String(input));
    if (!m) return null;
    const matches = actors.filter(a => String(a.name || a.Name).toLowerCase().startsWith(m[1].trim().toLowerCase()));
    const deity = name(m[1]) || (matches.length === 1 && !canRecruit(matches[0]) ? name(matches[0].name || matches[0].Name) : null);
    return deity && deity !== 'Mortacia' ? `${deity} will not join the party. Divine visitors pursue their own obligations; speak with them about their interest or mission instead.` : null;
  }
  const interests = {
    Atinus: ['castle', 'gatehouse', 'guildhall'], Atricles: ['market', 'hamlet', 'guildhall'],
    Dyanetzia: ['oasis', 'house', 'garden'], Leona: ['oasis', 'forest', 'hamlet'],
    Mordicar: ['castle', 'catacomb', 'quarry'], Musydius: ['inn', 'market', 'guildhall'],
    Neptar: ['oasis', 'river', 'ferry'], Poena: ['inn', 'hamlet', 'house'],
    Turthus: ['catacomb', 'guildhall', 'library'], Eredine: ['wizard_citadel', 'roman_temple', 'catacomb'],
    Llellwyth: ['guildhall', 'castle'], Rama: ['roman_temple', 'byzantine_basilica'],
    Sylanos: ['graveyard', 'roman_temple'], Syluria: ['graveyard', 'catacomb'],
    Urthur: ['castle', 'gatehouse'], Uceracea: ['oasis', 'graveyard']
  };
  const obligations = {
    Atinus: ['a broken garrison oath', 'muster record'], Atricles: ['a disputed civic judgment', 'witness register'],
    Dyanetzia: ['the upkeep of a threatened spring', 'cistern covenant'], Leona: ['a neglected burial garden', 'garden charter'],
    Mordicar: ['unpaid work on a public refuge', 'masons tally'], Musydius: ['a song erased from communal memory', 'song folio'],
    Neptar: ['the fair sharing of a waterway', 'crossing ledger'], Poena: ['a promise abandoned on the pilgrim road', 'vow ribbon'],
    Turthus: ['an archive whose witnesses are being forgotten', 'archive concordance'], Eredine: ['a ward whose maintenance was concealed', 'ward diagram'],
    Llellwyth: ['a cold forge needed by the community', 'forge commission'], Rama: ['a falsified account of an old crossing', 'solar annal'],
    Sylanos: ['the protection of graves from desecration', 'burial register'], Syluria: ['a hidden witness to a broken agreement', 'moon testimony'],
    Urthur: ['a refuge whose defenders lost their compact', 'refuge compact'], Uceracea: ['the care of a polluted sanctuary', 'sanctuary record'],
    Chaoticum: ['the price of remaking a ruined institution', 'fractured charter'], Krystalynn: ['a memory confused with a nightmare', 'dream deposition']
  };
  function canon(value) {
    const n = name(value), c = Icons.pantheon[n];
    return c ? { name: n, ...c, allegiance: /E$/.test(c.alignment) ? 'Hostile' : 'Neutral',
      interests: interests[n] || ['wasteland', 'graveyard'], obligation: obligations[n] || ['a struggle for dominion', 'sealed record'] } : null;
  }
  return { names, name, canon, canRecruit, recruitmentRefusal };
});
