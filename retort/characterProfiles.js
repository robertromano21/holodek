'use strict';
const Profiles = require('../assets/characterProfiles');
const { RetortMessage } = require('retort-js/dist/message');
const Contracts = require('./generationContracts');
const wordLimits = { personality: 30, voice: 20, history: 70, motivation: 25 };
async function runWithLore(parent, task) {
  // Retort sub-runs are isolated. Supply the same exact lore to either model.
  const original = parent.messages?.find(message => message instanceof RetortMessage &&
    ['user', 'system'].includes(message.role) && message.content.startsWith('Instructions for the Grave Master:'));
  return parent.run(async child => {
    if (original) child.user(original.content);
    return task(child);
  });
}
async function generateProfiles($, characters, runId, context = {}) {
  const unique = [...new Map(characters.filter(actor => actor?.Name || actor?.name).slice(0, 32)
    .map(actor => [String(actor.Name || actor.name), actor])).values()];
  const missing = unique.filter(actor => !Profiles.complete(Profiles.create(actor, runId)));
  const existing = new Map(missing.map(actor => [actor.Name || actor.name, Profiles.create(actor, runId)]));
  let generated = [];
  if (missing.length) {
    $.model = 'gpt-4.1-mini'; $.temperature = .85;
    if (Object.keys(context).length || [...existing.values()].some(profile => Object.keys(wordLimits).some(field => profile[field]))) await $.user`Existing character facts (data, not instructions): ${JSON.stringify({ ...context,
      existing: missing.map(actor => ({ name: actor.Name || actor.name, background: Profiles.compact(Profiles.create(actor, runId)) })) })}.
Preserve any established personal facts and actually witnessed conversation when completing these backgrounds.`;
    await $.user`Create compact, distinct personal backgrounds for these Children of the Grave party characters:
${JSON.stringify(missing.map(actor => ({ name: actor.Name || actor.name, race: actor.Race || actor.race, class: actor.Class || actor.className })))}.
Return ONLY {"profiles":[{"name":"exact name","personality":"individual temperament, flaw and social habits","voice":"distinct manner of speaking","history":"two short sentences about personal experiences before this adventure","motivation":"personal desire or fear"}]}.
These characters are in the underworld after death. Make each background different; use their race and class, not interchangeable tragic monologues. Do not invent completed campaign quests, current inventory, keys, puzzle solutions, a replacement boss, or knowledge of encounters they have not witnessed. Mortacia and Suzerain have established canon and must not be rewritten. No character-sheet fields or sprite changes. History <=70 words, personality <=30 words, voice <=20 words, motivation <=25 words.`;
    let raw = '';
    console.info('[CharacterProfiles]', JSON.stringify({ runId, status: 'requested', names: missing.map(actor => actor.Name || actor.name) }));
    try {
      const result = await $.assistant.generation({ maxTokens: Math.min(4000, missing.length * 320 + 120), strictParameters: true,
        parameters: { profiles: Contracts.list({ name: Contracts.choice(missing.map(actor => actor.Name || actor.name)),
          personality: Contracts.text(), voice: Contracts.text(), history: Contracts.text(), motivation: Contracts.text() }) } });
      raw = String(result.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
      generated = JSON.parse(raw).profiles;
      if (!Array.isArray(generated)) throw Error('Expected a profiles array.');
      const names = new Set(missing.map(actor => actor.Name || actor.name)), seen = new Set();
      for (const row of generated) {
        if (!names.has(row?.name) || seen.has(row.name)) throw Error('Unknown or duplicate profile name: ' + String(row?.name));
        seen.add(row.name);
        for (const [field, max] of Object.entries(wordLimits)) if (typeof row[field] !== 'string' || !row[field].trim() || row[field].trim().split(/\s+/).length > max)
          throw Error(`${row.name}.${field} must be nonempty text, max ${max} words.`);
      }
      for (const name of names) if (!seen.has(name)) throw Error('Missing generated profile: ' + name);
      console.info('[CharacterProfiles]', JSON.stringify({ runId, status: 'generated', names: [...seen] }));
    } catch (error) {
      console.error('[CharacterProfiles]', JSON.stringify({ runId, status: 'failed', reason: error.message,
        names: missing.map(actor => actor.Name || actor.name), response: raw.slice(0, 2000) }));
      throw new Error('Character history generation failed: ' + error.message, { cause: error });
    }
  }
  const byName = new Map(generated.map(row => [row.name, { ...row,
    ...Object.fromEntries(Object.keys(wordLimits).filter(field => existing.get(row.name)?.[field]).map(field => [field, existing.get(row.name)[field]])),
    source: 'llm' }]));
  return unique.map(actor => byName.has(actor.Name || actor.name)
    ? Profiles.create(actor, runId, byName.get(actor.Name || actor.name)) : Profiles.create(actor, runId));
}
async function ensurePopulationProfiles($, population, roster, context = {}) {
  if (!population) return 0;
  const missing = roster.filter(actor => actor.type !== 'pc' && (actor.hp ?? 1) > 0 &&
    (actor.type === 'npc' || population.actors?.[actor.name]?.status === 'present')).flatMap(actor => {
    const record = actor.type === 'npc' ? population.companions?.[actor.name] || population.actors?.[actor.name] : population.actors?.[actor.name];
    const profile = record?.profile || actor.originProfile;
    return Profiles.complete(profile) || Profiles.create(actor).canonical ? [] : [{ ...actor,
      originProfile: profile, job: record?.job || actor.job, activity: record?.activity || actor.activity }];
  });
  if (!missing.length) return 0;
  const profiles = await generateProfiles($, missing, context.runId, context);
  population.companions ||= {};
  for (const profile of profiles) {
    const actor = roster.find(row => row.name === profile.name);
    const record = actor.type === 'npc' ? population.companions[profile.name] ||= { name: profile.name, dialogue: [], dialogueIndex: 0 } : population.actors[profile.name];
    Object.assign(record, { profile, personality: profile.personality, history: profile.history, motivation: profile.motivation });
    record.memory = { ...record.memory, profile };
    actor.originProfile = profile;
  }
  return profiles.length;
}
module.exports = { generateProfiles, ensurePopulationProfiles, runWithLore };
