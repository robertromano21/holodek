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
  const temperaments = ['patient but suspicious', 'curious and mischievous', 'strict and quietly sentimental', 'proud but easily embarrassed',
    'generous and argumentative', 'watchful with a bleak sense of humor', 'restless yet deeply loyal', 'reserved and stubbornly hopeful'];
  const habits = ['asks pointed questions', 'uses vivid comparisons', 'speaks in clipped practical phrases', 'hesitates before admitting affection',
    'turns worry into jokes', 'recalls small sensory details', 'challenges easy answers', 'prefers uncomfortable honesty'];
  const origins = ['a river crossing', 'an abandoned fortress', 'a caravan road', 'a hilltop sanctuary',
    'a deep quarry', 'a forgotten harbor', 'a border woodland', 'a ruined scholarly enclave'];
  const lessons = ['learned to distrust easy promises', 'kept faith with someone everyone else abandoned', 'lost confidence in an old authority',
    'survived by noticing what others ignored', 'regretted choosing safety over loyalty', 'found purpose in protecting fragile places',
    'learned that pride can conceal grief', 'carried an unanswered question long after its witnesses vanished'];
  function hash(value) { let n = 2166136261; for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; }
  function create(actor = {}, seed = '', supplied = actor.originProfile || actor.profile || {}) {
    const name = clean(actor.name || actor.Name, 100), fixed = Object.hasOwn(canon, name.toLowerCase()) ? canon[name.toLowerCase()] : null;
    if (fixed) return { version: 1, name, canonical: true, ...fixed };
    const n = hash(`${seed}|${name}|${actor.race || actor.Race || ''}|${actor.className || actor.Class || ''}`);
    const profile = { version: 1, name, canonical: false,
      personality: clean(supplied.personality || actor.personality, 220) || `${name} is ${temperaments[n % 8]} and ${habits[(n >>> 4) % 8]}.`,
      voice: clean(supplied.voice, 140) || `Usually ${habits[(n >>> 8) % 8]}; under pressure becomes ${temperaments[(n >>> 12) % 8]}.`,
      history: clean(supplied.history || actor.history, 600) || `${name}'s past is tied to ${origins[(n >>> 16) % 8]}. There, ${name} ${lessons[(n >>> 20) % 8]}. That memory still shapes how this individual treats strangers and obligations.`,
      motivation: clean(supplied.motivation || actor.motivation, 180) || `Resolve the regret associated with ${origins[(n >>> 16) % 8]}, while avoiding another betrayal.` };
    return profile;
  }
  function compact(profile) {
    return profile ? { personality: clean(profile.personality, 140), voice: clean(profile.voice, 80),
      history: clean(profile.history, 300), motivation: clean(profile.motivation, 120) } : undefined;
  }
  return { create, compact };
});
