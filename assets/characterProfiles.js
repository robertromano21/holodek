(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterProfiles = factory();
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const clean = (value, max) => typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').trim().slice(0, max) : '';
  const canon = {
    mortacia: { personality: 'Commanding, grieving and fiercely protective of the dead; compassion struggles with wounded divine pride.',
      voice: 'Direct judgments, sudden emotional reactions and reluctant admissions of doubt.',
      history: 'Mortacia is the goddess of death. Her throne in Hades was usurped, and she seeks the Sepulchra to reclaim her rule and restore the proper order of death. Her damaged dragon wings reflect her diminished condition. Arithus stands against her return.',
      motivation: 'Reclaim the Sepulchra and her throne without abandoning the souls entrusted to her.' },
    suzerain: { personality: 'Resolute, duty-bound and privately weary; courage is tempered by empathy and dry humor.',
      voice: 'Plain battlefield counsel and concise, occasionally sardonic reassurance.',
      history: 'Suzerain is a Knight of Atinus and the recurring hero of Children of the Grave. He has faced death and returned before. Now dead again, he must gather allies in the underworld to oppose Arithus before his next rebirth.',
      motivation: 'Protect his companions and fulfill his duty without treating the dead as expendable.' }
  };
  function legacyFallback(profile) {
    return !!profile && /That memory still shapes how this individual treats strangers and obligations\.$/.test(profile.history || '') &&
      /^Resolve the regret associated with .+, while avoiding another betrayal\.$/.test(profile.motivation || '');
  }
  function complete(profile) {
    return !!profile && !legacyFallback(profile) && ['personality', 'voice', 'history', 'motivation'].every(field =>
      typeof profile[field] === 'string' && !!profile[field].trim());
  }
  function create(actor = {}, seed = '', supplied = actor.originProfile || actor.profile || {}) {
    const name = clean(actor.name || actor.Name, 100), fixed = Object.hasOwn(canon, name.toLowerCase()) ? canon[name.toLowerCase()] : null;
    if (fixed) return { version: 1, name, canonical: true, ...fixed };
    const provisional = legacyFallback(supplied) || legacyFallback(actor);
    const field = (key, max) => provisional ? '' : clean(supplied[key] || actor[key], max);
    const profile = { version: 1, name, canonical: false,
      personality: field('personality', 220), voice: field('voice', 140), history: field('history', 600), motivation: field('motivation', 180) };
    profile.source = complete(profile) ? supplied.source || 'provided' : 'pending';
    return profile;
  }
  function compact(profile) {
    return profile && !legacyFallback(profile) ? { personality: clean(profile.personality, 140), voice: clean(profile.voice, 80),
      history: clean(profile.history, 300), motivation: clean(profile.motivation, 120) } : undefined;
  }
  return { create, compact, complete, legacyFallback };
});
