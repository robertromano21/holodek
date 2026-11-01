'use strict';
const world = db => db?.['0,0,0']?.setting?.kind === 'homebrew' ? db['0,0,0'].setting : null;
function policy(b) {
  const technological = b.genres?.some(g => ['sci-fi', 'cyberpunk', 'modern', 'steampunk', 'noir'].includes(g));
  const factions = b.factions.map((f, i) => ({ id: 'world-faction-' + i, name: f.name, purpose: f.aim }));
  if (factions.length < 2) throw Error('Regional adventure requires this world’s saved factions.');
  return { templates: technological ? ['market', 'soul_registry', 'fortress', 'fortress'] : ['village', 'guildhall', 'watch_house', 'fortress'],
    factions, record: 'investigation record', testimony: 'witness statement', agreement: 'local agreement' };
}
function prompt(b, context) {
  return `[ORIGINAL-WORLD REGIONAL ADVENTURE]\n${b.masterPrompt || b.arc || b.history}\nWorld data: ${JSON.stringify(b)}. Bindings: ${JSON.stringify(context)}.
Author one connected situation arising from THIS world's premise, history, technology, peoples and factions. Do not import another campaign's burial rites, gods, water dispute or temple scenario. Choose the concrete dispute and personal stakes freely within these engine-supported stages: existing contact introduces an unverified report; inspect a record at site 2; overcome two hostile opponents at site 3 and two at site 4; escort a captive/witness to site 1 OR recover their statement; explicitly choose between two of the world's factions. The existing boss/key task follows unchanged. No new rewards, items, exits, mechanics or completed outcomes.
Four sites in order: local community or hub, record/evidence location, dangerous route or facility, hostile holding facility. Architecture must follow the genre; catalog template names are geometry, not lore. Six NEW residents in order: local representative, captive/witness, two route opponents, two holding-facility opponents. Preserve the existing firstSiteName and contact. Do not reuse party names. Invent believable individuals and a misleading report that the authored evidence can check.
Return title<=70, premise<=220, hook<=400, rumor<=220, investigation<=400, rescue<=400, conclusion<=400; sites:[{name<=80,flavor<=240}] exactly four; actors:[{name<=60,history<=220,personality<=160}] exactly six; burialText<=700 (internal field name for the investigation record), testimonyText<=700; templePatron must be one of the supplied WORLD faction names (internal compatibility field for the holding facility's affiliation, not a deity). All limits characters, single-line text, no HTML, pipes or backticks. Engine binds exact coordinates, record names and requirements. The fiction must honor those bindings. [/ORIGINAL-WORLD REGIONAL ADVENTURE]`;
}
module.exports = { world, policy, prompt };
