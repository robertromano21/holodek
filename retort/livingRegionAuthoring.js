'use strict';
// Living region authoring (v5): the model writes the society AROUND a gameplay plan the engine already supports.
//
// The contract has four separate parts, and only the first three are gameplay:
//   Player action      retrieve this real portable object through this supported obstacle (engine-assigned per resident)
//   Resident action    what the resident does with the delivered object (authored; it must produce the consequence)
//   World consequence  the exact change the engine commits (engine-assigned: rebuild this landmark, open this exit, or
//                      nothing physical)
//   Personal meaning   hopes, fears and beliefs; may name larger aspirations, never as what completion does.
// The engine picks each resident's obstacle and consequence BEFORE any model call (plan()), so the model never chooses
// an effect it then has to justify. Stage 1 authors the community as a chain the review checks:
//   problem -> the damaged landmark (its purpose and damage) -> the supported intervention -> the observable improvement.
// The landmark's PURPOSE (what it does) is authored separately from its VISUAL FORM (a neutral buildable shape chosen
// from FORMS, rendered with the active genre's own kit piece), so the shape menu never steers the fiction.
//
// Stages: 1 communities, 2 residents (against the engine slots), then one review call per community that reads its
// fields and residents against the same authoritative PERMITTED EFFECTS block, and at most one repair of only the
// fields it flags (gameplay fields are never offered for repair). The region is playable after that. Relationships,
// history and companion stakes are authored afterwards (authorSocial), so essential objectives never wait for them.
// Engine checks are structural only (names, IDs, choices, duplicates, coordinates); there is no verb blacklist.
const OBSTACLES = ['hidden-chamber', 'mechanism'];
// What the player does for each obstacle (engine facts; retort/secretDoors.js, assets/physicalPuzzles.js).
const OBSTACLE_PLAYER = {
  'hidden-chamber': 'travels to a room on the way to the community, searches its walls for a concealed panel (a dice check that can be retried), opens the panel and takes the object from the small chamber behind it',
  mechanism: 'travels to a room on the way to the community where a physical mechanism is already built, reads its clue, works out and sets its controls; when the mechanism is solved it releases the object, which the player takes' };
const GOAL_KIND = { 'hidden-chamber': 'deliver-sealed-item', mechanism: 'deliver-mechanism-item' };
const GOAL_KINDS = Object.values(GOAL_KIND);
// The existing favor task kinds (retort/residentTaskPlan.js) that verify each goal, against the goal's own targets.
const GOAL_TASKS = { 'deliver-sealed-item': ['retrieve'], 'deliver-mechanism-item': ['puzzle', 'retrieve'] };
const EFFECTS = { 'restore-fixture': 'fixture', 'earn-trust': 'standing', 'reopen-passage': 'access' };
const DEFERRED_GOAL_KINDS = ['guarded-item', 'negotiation', 'find-person', 'defend-place', 'investigate-disappearance'];
const RELATIONS = ['ally', 'rival', 'dependent', 'creditor', 'protective', 'indebted'];
const CONSEQUENCES = ['access', 'standing', 'fixture'];
const HOOK_KINDS = ['relative', 'debt', 'promise', 'fear'];
const SETTINGS = ['indoor', 'outdoor'];
// Neutral buildable shapes (retort/livingRegionFixture.js). A shape is only how the landmark LOOKS.
const FORMS = [
  { id: 'upright', looks: 'a tall freestanding structure (a post, mast, tower, stele or standing frame)' },
  { id: 'frame', looks: 'an upright frame around an opening (a doorway, arch, hatch or gate frame)' },
  { id: 'slab', looks: 'a low, flat, solid block (a plinth, platform, panel, bench or basin rim)' },
  { id: 'column', looks: 'a round upright post or support (a pillar, pipe stack, pole or trunk)' }];
const FIXTURE_FORMS = FORMS.map(f => f.id);
// The milestone scope is guaranteed end to end; the schema accepts up to MAX for later expansion.
const SCOPE = { communities: 1, residentsPerCommunity: 2, factsMin: 2, factsMax: 6 };
const MAX = { communities: 3, residents: 10, facts: 8, beliefsPerFact: 3, relationshipsPerResident: 2, reviewIssues: 12 };
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const lower = s => String(s ?? '').trim().toLowerCase();
// Whitespace is normalized; content is never shortened. Markup characters are rejected, not stripped.
function prose(value) { return typeof value === 'string' && value.trim() && !/[<>`]/.test(value) ? value.replace(/\s+/g, ' ').trim() : null; }
// Prompt-only excerpt. Never used for stored content.
function excerpt(value, max = 240) { const s = String(value ?? ''); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
// The resident action follows "so they can". A repeated lead-in, a leading "to", the resident's own name with a modal
// and a third-person first verb are normalized ("replaces" -> "replace") so the composed sentence reads correctly.
const BASE = { has: 'have', does: 'do', is: 'be', goes: 'go' };
function baseVerb(word) {
  const w = word.toLowerCase();
  if (BASE[w]) return BASE[w];
  if (/[^aeiou]ies$/.test(w)) return word.slice(0, -3) + 'y';
  if (/(?:sses|shes|ches|xes|zes)$/.test(w)) return word.slice(0, -2);
  if (/(?:[^su]s|uses)$/.test(w) && w.length > 3) return word.slice(0, -1);
  return word;
}
function verbPhrase(value, name = '') {
  let v = prose(value); if (!v) return v;
  const who = name ? String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  for (let i = 0; i < 3; i++) {
    const before = v;
    v = v.replace(/^(?:so(?:\s+that)?\s+)?(?:they|he|she|i|we|you)\s+(?:can|could|may|will|would)\s+/i, '');
    if (who) v = v.replace(new RegExp('^' + who + '\\s+(?:can|could|may|will|would|wants? to|plans? to|hopes? to)\\s+', 'i'), '');
    v = v.replace(/^(?:in order\s+)?to\s+/i, '');
    if (v === before) break;
  }
  if (!/^(?:they|he|she)\b/i.test(v)) v = v.replace(/^([A-Za-z]+)/, w => baseVerb(w));
  return v.replace(/[.!]+$/, '');
}

// ---------- The supported gameplay plan (engine-side, before any model call) ----------
// Each resident slot fixes the player action and the world consequence. At least one slot uses the always-constructible
// hidden chamber and repairs the landmark; the second uses the mechanism obstacle and earns trust.
function plan(scope = SCOPE) {
  const n = Math.max(1, Math.min(MAX.communities, scope.communities)), per = Math.max(1, scope.residentsPerCommunity), slots = [];
  for (let c = 0; c < n; c++) for (let k = 0; k < per && slots.length < MAX.residents; k++)
    slots.push({ id: 'r' + (slots.length + 1), community: 'c' + (c + 1), obstacle: k % 2 === 0 ? 'hidden-chamber' : 'mechanism', effect: k === 0 ? 'restore-fixture' : 'earn-trust' });
  return { version: 1, communities: n, slots };
}
function consequenceText(effect, landmark = 'the community landmark') {
  return effect === 'restore-fixture' ? `the engine rebuilds ${landmark} in the community room; it is shown whole where it was damaged` :
    effect === 'reopen-passage' ? 'the engine opens the community\'s closed exit to the next room, which can then be walked through' :
      'nothing physical changes; the community trusts the party more (no object, payment, map, access or other reward is given)';
}
// The one authoritative list every stage receives (authoring, review, repair, social, successor).
function permittedEffects() {
  return ['PERMITTED EFFECTS (authoritative; these are the only things the game makes happen in this region):',
    `- Player action: retrieve one real portable object and give it to the resident. Obstacles: hidden-chamber (the player ${OBSTACLE_PLAYER['hidden-chamber']}); mechanism (the player ${OBSTACLE_PLAYER.mechanism}). The engine chooses the rooms.`,
    `- World consequence restore-fixture: ${consequenceText('restore-fixture')}.`,
    `- World consequence reopen-passage: ${consequenceText('reopen-passage')}.`,
    `- World consequence earn-trust: ${consequenceText('earn-trust')}.`,
    '- Resident action: what the resident does with the delivered object, told in-world; it is the story\'s account of the world consequence. For restore-fixture the resident uses the object to rebuild the landmark; for reopen-passage the resident uses it to open the closed way onward; for earn-trust it is something personal that changes nothing physical. A resident action that tells its own consequence this way is correct, not a claim.',
    '- Nothing else happens through these goals: no one is revived, healed, found, rescued, protected, blessed, warded, defeated or paid; no soul, spirit or body is recovered; no lock, code, riddle or guard exists beyond the listed obstacles; no map, access, payment or reward is granted.',
    '- Personal meaning may hold larger hopes, fears or beliefs, but no field may claim them as what retrieving or delivering the object does.'].join('\n');
}

// ---------- Stage definitions ----------
// field kinds: text | name | choice(list) | bool | ids(list, max) | beliefs
const COMMUNITY_TEXT = ['landmarkPurpose', 'landmarkDamage', 'problem', 'improvement', 'passageMatters', 'dangerMatters'];
const RESIDENT_TEXT = ['residentAction', 'whyHidden', 'meaning', 'history'];
function stages(ctx, scope = SCOPE, gameplay = plan(scope)) {
  const n = gameplay.communities, residents = gameplay.slots.length;
  const communityIds = Array.from({ length: n }, (_, i) => 'c' + (i + 1));
  return [
    { id: 'communities', collections: { communities: { count: [n, n], fields: {
        name: { kind: 'name' }, setting: { kind: 'choice', list: SETTINGS }, landmarkName: { kind: 'text' }, landmarkPurpose: { kind: 'text' },
        landmarkDamage: { kind: 'text' }, landmarkForm: { kind: 'choice', list: FIXTURE_FORMS }, problem: { kind: 'text' }, improvement: { kind: 'text' },
        passageMatters: { kind: 'text' }, dangerMatters: { kind: 'text' },
        ...(n > 1 ? { disagreementWith: { kind: 'choice', list: communityIds }, disagreement: { kind: 'text' } } : {}) } } } },
    { id: 'residents', slots: gameplay.slots, collections: { residents: { count: [residents, residents], fields: {
        name: { kind: 'name' }, goalItem: { kind: 'name' }, residentAction: { kind: 'text' }, whyHidden: { kind: 'text' },
        meaning: { kind: 'text' }, history: { kind: 'text' }, willingTraveler: { kind: 'bool' } } } } },
    { id: 'relations', social: true, collections: {
        relationships: { count: [residents, residents * MAX.relationshipsPerResident], fields: {
          from: { kind: 'choice', list: residentIds(residents) }, kind: { kind: 'choice', list: RELATIONS }, to: { kind: 'choice', list: residentIds(residents) } } },
        facts: { count: [scope.factsMin, Math.min(MAX.facts, scope.factsMax)], fields: {
          text: { kind: 'text' }, community: { kind: 'choice', list: [...communityIds, 'region'] },
          involves: { kind: 'ids', list: residentIds(residents), max: 4 }, beliefs: { kind: 'beliefs', list: residentIds(residents), max: MAX.beliefsPerFact } } },
        ...(ctx.companions.length ? { companionHooks: { count: [0, ctx.companions.length], fields: {
          companion: { kind: 'choice', list: ctx.companions }, kind: { kind: 'choice', list: HOOK_KINDS }, stake: { kind: 'text' },
          community: { kind: 'choice', list: communityIds } } } } : {}) } }
  ];
}
function residentIds(n) { return Array.from({ length: n }, (_, i) => 'r' + (i + 1)); }
function contractType(field, C) {
  if (field.kind === 'text' || field.kind === 'name') return C.text();
  if (field.kind === 'choice') return C.choice(field.list);
  if (field.kind === 'bool') return Boolean;
  if (field.kind === 'ids') return { type: [C.choice(field.list)], minItems: 0, maxItems: field.max };
  if (field.kind === 'beliefs') return { type: C.list({ holder: C.choice(field.list), account: C.text() }), minItems: 0, maxItems: field.max };
  throw Error('Unknown field kind ' + field.kind);
}
function parameters(stage, { repair = null } = {}) {
  const C = require('./generationContracts'), out = {};
  for (const [name, coll] of Object.entries(stage.collections)) {
    const fields = Object.fromEntries(Object.entries(coll.fields).map(([k, f]) => [k, contractType(f, C)]));
    if (repair) {
      const wanted = repair.filter(i => i.collection === name);
      if (!wanted.length) continue;
      out[name] = { type: C.list({ index: { type: Number, minimum: 0, maximum: coll.count[1], multipleOf: 1 }, remove: Boolean, ...fields }), minItems: 1, maxItems: wanted.length + 2 };
    } else out[name] = { type: C.list(fields), minItems: coll.count[0], maxItems: coll.count[1] };
  }
  return out;
}

// ---------- Structural checks (engine facts only) ----------
function checkField(field, value, label) {
  if (field.kind === 'text') return prose(value) ? null : `${label}: required plain text (no < > or backticks).`;
  if (field.kind === 'name') {
    const n = prose(value); if (!n) return `${label}: required name.`;
    if (/[,":{}\[\]]/.test(n) || RESERVED.has(lower(n))) return `${label}: name contains reserved characters.`;
    return null;
  }
  if (field.kind === 'choice') return field.list.includes(value) ? null : `${label}: must be one of ${field.list.join(', ')}.`;
  if (field.kind === 'bool') return typeof value === 'boolean' ? null : `${label}: must be true or false.`;
  if (field.kind === 'ids') {
    if (!Array.isArray(value) || value.length > field.max) return `${label}: up to ${field.max} resident IDs.`;
    const bad = value.filter(v => !field.list.includes(v)); return bad.length ? `${label}: unknown resident ID ${JSON.stringify(bad[0])}; use only ${field.list.join(', ')}.` : null;
  }
  if (field.kind === 'beliefs') {
    if (!Array.isArray(value) || value.length > field.max) return `${label}: up to ${field.max} beliefs.`;
    for (const b of value) {
      if (!field.list.includes(b?.holder)) return `${label}: belief holder must be one of ${field.list.join(', ')}.`;
      if (!prose(b?.account)) return `${label}: each belief needs an account.`;
    }
    return null;
  }
  if (field.kind === 'issues') {
    if (!Array.isArray(value) || value.length > MAX.reviewIssues) return `${label}: a list of up to ${MAX.reviewIssues} {path, problem} entries.`;
    return value.some(v => !field.list.includes(v?.path) || !prose(v?.problem)) ? `${label}: each entry needs an exact listed path and a problem.` : null;
  }
  return `${label}: unknown field.`;
}
// Returns issues [{collection, index, field, problem}] where index is a number, 'new' (missing item) or '*' (any item).
function check(stage, raw, ctx, accepted) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [{ collection: Object.keys(stage.collections)[0], index: '*', field: null, problem: 'Expected one JSON object.' }];
  for (const [name, coll] of Object.entries(stage.collections)) {
    const items = Array.isArray(raw[name]) ? raw[name] : null;
    if (!items) { issues.push({ collection: name, index: 'new', field: null, problem: `${name}: missing list.` }); continue; }
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object') { issues.push({ collection: name, index: i, field: null, problem: `${name}[${i}]: must be an object.` }); return; }
      for (const [f, spec] of Object.entries(coll.fields)) {
        const problem = checkField(spec, item[f], `${name}[${i}].${f}`); if (problem) issues.push({ collection: name, index: i, field: f, problem });
      }
    });
    if (items.length < coll.count[0]) for (let i = items.length; i < coll.count[0]; i++) issues.push({ collection: name, index: 'new', field: null, problem: `${name}: expected at least ${coll.count[0]} items, got ${items.length}; author item ${i}.` });
    if (items.length > coll.count[1]) for (let i = coll.count[1]; i < items.length; i++) issues.push({ collection: name, index: i, field: null, excess: true, problem: `${name}: at most ${coll.count[1]} items; remove one item (set remove:true) or merge it.` });
  }
  issues.push(...(stage.semantic ? stage.semantic(raw, ctx, accepted) : semantic(stage, raw, ctx, accepted)));
  return issues;
}
function semantic(stage, raw, ctx, accepted) {
  const issues = [], taken = new Set([...ctx.party, ...ctx.existingNames].map(lower));
  const deity = n => { if (ctx.homebrew) return false; try { return !!require('../assets/pantheonCharacters').canon(n); } catch { return false; } };
  const coordinates = /\b-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\b/;
  if (coordinates.test(JSON.stringify(raw))) issues.push({ collection: Object.keys(stage.collections)[0], index: '*', field: null, problem: 'Do not include coordinates; the engine places everything.' });
  if (stage.id === 'communities') {
    const rows = Array.isArray(raw.communities) ? raw.communities : [];
    rows.forEach((c, i) => {
      if (c?.disagreementWith && c.disagreementWith === 'c' + (i + 1)) issues.push({ collection: 'communities', index: i, field: 'disagreementWith', problem: `communities[${i}].disagreementWith: must name a different community.` });
      if (prose(c?.name) && taken.has(lower(c.name))) issues.push({ collection: 'communities', index: i, field: 'name', problem: `communities[${i}].name: ${JSON.stringify(c.name)} already exists in this world; choose another name.` });
    });
    dupes(rows.map(c => c?.name)).forEach(i => issues.push({ collection: 'communities', index: i, field: 'name', problem: `communities[${i}].name: duplicates another community name.` }));
  }
  if (stage.id === 'residents') {
    const rows = Array.isArray(raw.residents) ? raw.residents : [], communityNames = new Set(accepted.communities.map(c => lower(c.name)));
    rows.forEach((r, i) => {
      const n = prose(r?.name); if (!n) return;
      if (taken.has(lower(n))) issues.push({ collection: 'residents', index: i, field: 'name', problem: `residents[${i}].name: ${JSON.stringify(n)} is already in the party or the world; author a different new resident name.` });
      else if (communityNames.has(lower(n))) issues.push({ collection: 'residents', index: i, field: 'name', problem: `residents[${i}].name: must differ from the community names.` });
      else if (deity(n)) issues.push({ collection: 'residents', index: i, field: 'name', problem: `residents[${i}].name: deities cannot be residents.` });
    });
    dupes(rows.map(r => r?.name)).forEach(i => issues.push({ collection: 'residents', index: i, field: 'name', problem: `residents[${i}].name: duplicates another resident; give this person their own name.` }));
    const people = new Set([...taken, ...communityNames, ...rows.map(r => lower(r?.name))]);
    rows.forEach((r, i) => { if (prose(r?.goalItem) && people.has(lower(r.goalItem))) issues.push({ collection: 'residents', index: i, field: 'goalItem', problem: `residents[${i}].goalItem: must be an object, not a person or community name.` }); });
    dupes(rows.map(r => r?.goalItem)).forEach(i => issues.push({ collection: 'residents', index: i, field: 'goalItem', problem: `residents[${i}].goalItem: each resident needs their own distinct goal object.` }));
  }
  if (stage.id === 'relations') {
    const rels = Array.isArray(raw.relationships) ? raw.relationships : [];
    rels.forEach((x, i) => { if (x?.from && x.from === x.to) issues.push({ collection: 'relationships', index: i, field: 'to', problem: `relationships[${i}].to: a resident cannot be related to themselves; use another resident ID.` }); });
    for (const r of accepted.residents) {
      const own = rels.filter(x => x?.from === r.id).length;
      if (!own) issues.push({ collection: 'relationships', index: 'new', field: null, problem: `Resident ${r.id} (${r.name}) needs one relationship with from:"${r.id}".` });
      if (own > MAX.relationshipsPerResident) issues.push({ collection: 'relationships', index: '*', field: null, problem: `Resident ${r.id} has more than ${MAX.relationshipsPerResident} relationships; remove one (remove:true).` });
    }
    const hooks = Array.isArray(raw.companionHooks) ? raw.companionHooks : [];
    dupes(hooks.map(h => h?.companion)).forEach(i => issues.push({ collection: 'companionHooks', index: i, field: null, excess: true, problem: `companionHooks[${i}]: one stake per companion; remove this duplicate (remove:true).` }));
    const facts = Array.isArray(raw.facts) ? raw.facts : [];
    facts.forEach((f, i) => { if (prose(f?.text) && !require('../assets/campaignMemory').clean(f.text)) issues.push({ collection: 'facts', index: i, field: 'text', problem: `facts[${i}].text: not storable as campaign memory.` }); });
  }
  if (ctx.homebrew) { try { const leaks = require('./campaignBuilder').lintGenerated(raw); if (leaks?.length) issues.push({ collection: Object.keys(stage.collections)[0], index: '*', field: null, problem: 'Original-world content leaked another campaign: ' + leaks.slice(0, 3).join(', ') }); } catch {} }
  return issues;
}
function dupes(list) { const seen = new Map(), out = []; list.forEach((v, i) => { const k = lower(v); if (!k) return; if (seen.has(k)) out.push(i); else seen.set(k, i); }); return out; }

// ---------- Repair ----------
// Copies back only the listed invalid fields (or whole missing/invalid items). Everything else stays as accepted.
function applyRepair(stage, raw, issues, fixes) {
  const next = structuredClone(raw), applied = [];
  for (const [name, coll] of Object.entries(stage.collections)) {
    next[name] = Array.isArray(next[name]) ? next[name] : [];
    const mine = issues.filter(i => i.collection === name), rows = Array.isArray(fixes?.[name]) ? fixes[name] : [];
    const removals = new Set();
    for (const fix of rows) {
      if (!fix || typeof fix !== 'object' || !Number.isInteger(fix.index)) continue;
      const at = fix.index, item = Object.fromEntries(Object.keys(coll.fields).filter(k => k in fix).map(k => [k, fix[k]]));
      const exact = mine.filter(i => i.index === at), anyItem = mine.filter(i => i.index === '*'), adding = mine.some(i => i.index === 'new');
      if (fix.remove === true) { if (exact.some(i => i.excess) || anyItem.some(i => /remove/.test(i.problem))) { removals.add(at); applied.push({ collection: name, index: at, removed: true }); } continue; }
      if (at >= next[name].length) { if (adding) { next[name].push(item); applied.push({ collection: name, index: next[name].length - 1, added: true }); } continue; }
      const fields = new Set([...exact, ...anyItem].map(i => i.field));
      if (!fields.size) continue; // valid accepted items are never edited
      if (fields.has(null)) { next[name][at] = item; applied.push({ collection: name, index: at, fields: Object.keys(item) }); continue; }
      const changed = [];
      for (const f of fields) if (f in item) { next[name][at][f] = item[f]; changed.push(f); }
      if (changed.length) applied.push({ collection: name, index: at, fields: changed });
    }
    if (removals.size) next[name] = next[name].filter((_, i) => !removals.has(i));
  }
  return { raw: next, applied };
}

// ---------- Prompts (abstract slots only: no sample names, needs or events) ----------
function settingLine(ctx) {
  const s = ctx.setting || {};
  return `Setting: ${JSON.stringify({ kind: s.kind, name: s.name || undefined, genres: s.genres?.length ? s.genres : undefined, premise: excerpt(s.premise, 1400) })}.`;
}
function acceptedBrief(accepted) {
  return JSON.stringify({
    communities: accepted.communities?.map(c => ({ id: c.id, name: c.name, setting: c.setting, landmark: c.fixtureName, purpose: excerpt(c.purpose, 160), damage: excerpt(c.damage, 160), problem: excerpt(c.need, 200), improvement: excerpt(c.improvement, 160) })),
    residents: accepted.residents?.map(r => ({ id: r.id, name: r.name, community: r.community, object: r.goalItem, obstacle: r.obstacle, consequence: r.effect, residentAction: excerpt(r.itemUse, 160) }))
  });
}
function slotLine(slot, accepted) {
  const c = accepted.communities?.find(x => x.id === slot.community);
  return `${slot.id} (lives in ${slot.community}${c ? ' ' + c.name : ''}): player action = the player ${OBSTACLE_PLAYER[slot.obstacle]}; world consequence = ${consequenceText(slot.effect, c ? JSON.stringify(c.fixtureName) : 'the landmark')}.`;
}
function prompt(stage, ctx, accepted, scope = SCOPE) {
  const head = ['LIVING REGION (additive; keep the tone, genre and constraints of the campaign setting).',
    `Author part of a small living region for this new campaign from scratch. Campaign seed: ${JSON.stringify(ctx.runId)}. ${settingLine(ctx)}`, permittedEffects()];
  const rules = ['Invent every name, need and event fresh for this campaign, in its own genre. Do not invent rooms, coordinates, exits, geometry, rewards or combat outcomes; the only objects you name are the residents\' goal objects and the landmark. Do not resolve the adventure or any goal.',
    `Do not reuse these names: ${JSON.stringify([...ctx.party, ...ctx.existingNames.slice(-40)])}. Do not create characters who are already in the party.`,
    'Output only the JSON object.'];
  if (stage.id === 'communities') {
    const n = stage.collections.communities.count[0];
    return [...head, `STAGE 1 of 2 — communities. Return {"communities":[...]} with exactly ${n} item(s). Author each community as one connected chain: its problem comes from its damaged landmark, a resident repairs that landmark with a delivered object, and the improvement is what people can observe or do again once it is rebuilt.`,
      `Fields, in this order: name; setting (indoor|outdoor: where this community lives); landmarkName (one physical, built object of this community: something people can see and touch, not an event, idea, record, person or season); landmarkPurpose (what the landmark does for the community when it works); landmarkDamage (what is physically wrong with it now); landmarkForm (how the landmark looks, choose the shape that honestly depicts it: ${FORMS.map(f => `${f.id} = ${f.looks}`).join('; ')}); problem (the community's own concrete problem now, caused by that damage); improvement (what people can observably do or have again once the landmark is rebuilt; it must answer the problem); passageMatters (one sentence: why a closed way leading on from the community matters to its people); dangerMatters (one sentence: why danger on the way to the community matters to its people)${n > 1 ? '; disagreementWith (the ID of a different community, c1..c' + n + ', in list order); disagreement (one concrete dispute with it)' : ''}.`, ...rules].join('\n');
  }
  if (stage.id === 'residents') {
    const n = stage.collections.residents.count[0];
    return [...head, `ACCEPTED (read-only, exact IDs): ${acceptedBrief(accepted)}.`,
      `STAGE 2 of 2 — residents. Return {"residents":[...]} with exactly ${n} new named individuals, in this order. The engine has already fixed each one's player action and world consequence:`,
      ...stage.slots.map(s => '- ' + slotLine(s, accepted)),
      'Fields, in this order: name; goalObject is "goalItem" (the exact name of the one portable object, a short noun phrase that fits the genre); residentAction (a verb phrase that follows the words "so they can", starting with a plain verb: what the resident does with the delivered object, producing exactly their world consequence and nothing more); whyHidden (one or two sentences: how the object came to be where its obstacle keeps it, in a room on the way to the community); meaning (their hopes, fears or beliefs about it; larger hopes are allowed as hopes only); history (who they are, consistent with the setting and the community chain); willingTraveler (true or false).', ...rules].join('\n');
  }
  const ids = accepted.residents.map(r => r.id);
  return [...head, `ACCEPTED (read-only, exact IDs): ${acceptedBrief(accepted)}.`,
    `SOCIAL DETAIL — relationships and history. Return {"relationships":[...],"facts":[...]${ctx.companions.length ? ',"companionHooks":[...]' : ''}}.`,
    `relationships: each resident (${ids.join(', ')}) has 1-${MAX.relationshipsPerResident} entries {from: their own ID, kind: ${RELATIONS.join('|')}, to: a different resident ID}. Use only these resident IDs.`,
    `facts: ${stage.collections.facts.count[0]}-${stage.collections.facts.count[1]} facts that already happened before the player arrived. Each: text; community (an accepted community ID or "region"); involves (resident IDs, may be empty); beliefs (0-${MAX.beliefsPerFact} entries {holder: resident ID, account: what they believe, which may be partial or mistaken}). Facts are true; uncertainty belongs only in beliefs. No fact may claim an effect outside PERMITTED EFFECTS.`,
    ctx.companions.length ? `companionHooks: at most one per existing companion (${JSON.stringify(ctx.companions)}): {companion (exact name), kind (${HOOK_KINDS.join('|')}), stake (a personal stake satisfiable here), community (accepted ID)}.` : '',
    ...rules].filter(Boolean).join('\n');
}
function repairPrompt(stage, ctx, accepted, raw, issues) {
  const list = issues.map(i => ({ collection: i.collection, index: i.index === 'new' ? 'next free index' : i.index === '*' ? 'any item you choose' : i.index, field: i.field || 'whole item', problem: i.problem }));
  return ['LIVING REGION REPAIR (keep every accepted value; change nothing else).', settingLine(ctx), permittedEffects(),
    accepted.communities?.length ? `ACCEPTED EARLIER STAGES (read-only): ${acceptedBrief(accepted)}.` : '',
    `THIS STAGE'S ANSWER (accepted except the problems listed): ${JSON.stringify(raw)}.`,
    `PROBLEMS TO FIX: ${JSON.stringify(list)}.`,
    `Return {${[...new Set(issues.map(i => '"' + i.collection + '":[...]'))].join(',')}} where each entry is a complete item with its "index" and "remove":false (or "remove":true only where a problem asks to remove an item).`,
    'Only the listed fields of the listed items will be read; all other values stay exactly as accepted. Do not rename people or change anything that was not listed.',
    'Output only the JSON object.'].filter(Boolean).join('\n');
}

// ---------- Second line: one review of every player-facing field against PERMITTED EFFECTS ----------
// Input: [{path, label, text}]. The model returns the paths whose text contradicts the plan (over-promising, a
// consequence that does not answer the stated problem, a landmark form that cannot depict its purpose). Only those
// text paths are then rewritten, once; gameplay (obstacles, consequences, objects, people) is never offered.
const VOICE = 'Player-facing text is in-world prose: it never mentions the engine, the game, rules, mechanics or PERMITTED EFFECTS. A residentAction is a verb phrase that follows the words "so they can": what the resident then does with the object, not the act of delivering it or asking for it.';
function reviewStage(paths, { chain = true } = {}) {
  return { id: 'review', chain, collections: { review: { count: [1, 1], fields: {
    ...(chain ? { chainHolds: { kind: 'bool' }, chainProblem: { kind: 'text' } } : {}),
    issues: { kind: 'issues', list: paths } } } }, semantic: () => [] };
}
function reviewPrompt(ctx, planText, fields, { chain = true } = {}) {
  return ['LIVING REGION REVIEW. You are checking authored text against the game\'s real behaviour. Do not rewrite anything.', settingLine(ctx), permittedEffects(),
    `GAMEPLAY PLAN (fixed, engine-owned): ${planText}`,
    `PLAYER-FACING TEXT: ${JSON.stringify(fields.map(f => ({ path: f.path, text: f.text })))}.`,
    chain ? 'Return {"review":[{"chainHolds":true|false,"chainProblem":"...","issues":[{"path":"...","problem":"..."}]}]}.' : 'Return {"review":[{"issues":[{"path":"...","problem":"..."}]}]}.',
    chain ? 'chainHolds: true when the community problem is caused by the damaged landmark, the repair resident\'s action rebuilds that landmark, and the stated improvement is what rebuilding it would give people. The improvement may describe, in-world, what people can do again because the landmark works; that is narrative and allowed when it follows from the landmark being whole. chainProblem: one sentence naming the broken link, or "none".' : '', VOICE + ' Flag text that breaks this.',
    'issues: only text that claims something outside PERMITTED EFFECTS as the result of retrieving or delivering an object, describes an obstacle that does not exist, says a resident action does more or less than its world consequence, or picks a landmark form that cannot depict the landmark\'s purpose. Hopes and fears that are clearly only hopes are fine. Use the exact paths given. Return an empty issues list when nothing is wrong.',
    'Output only the JSON object.'].filter(Boolean).join('\n');
}
function rewritePrompt(ctx, planText, fields, problems) {
  return ['LIVING REGION TEXT REPAIR (rewrite only the listed text fields; the gameplay plan is fixed).', settingLine(ctx), permittedEffects(),
    `GAMEPLAY PLAN (fixed, engine-owned): ${planText}`,
    `ALL TEXT (read-only except the listed paths): ${JSON.stringify(fields.map(f => ({ path: f.path, text: f.text })))}.`,
    `REWRITE THESE: ${JSON.stringify(problems)}.`, VOICE,
    'Return {"fixes":[{"path":"<exact listed path>","text":"<replacement text>"}]} with one entry per listed path. Keep names, objects and the plan exactly as they are.',
    'Output only the JSON object.'].join('\n');
}
// One review pass. The text is reviewed by community, including its residents, so each call has a coherent chain
// without repeating the same permitted-effects instructions for each person. Only flagged paths
// are rewritten (one call per part with problems). A part whose review fails is recorded and leaves its text unchanged.
async function review($, request, ctx, { planText, fields, trace = [], parts = null }) {
  const all = parts || [{ id: 'all', planText, paths: fields.map(f => f.path), chain: fields.some(f => /\.(problem|improvement)$/.test(f.path)) }];
  const problems = [], fixes = [], failed = [];
  for (const part of all) {
    const own = fields.filter(f => part.paths.includes(f.path)); if (!own.length) continue;
    const out = await reviewPart($, request, ctx, part, own, trace);
    if (!out.reviewed) failed.push(part.id);
    problems.push(...(out.problems || [])); fixes.push(...out.fixes);
  }
  return { reviewed: failed.length < all.length, failed, problems, fixes };
}
async function reviewPart($, request, ctx, part, fields, trace) {
  const paths = fields.map(f => f.path), stage = reviewStage(paths, { chain: part.chain }), t = { stage: 'review', part: part.id };
  const result = await call($, request, { stage, text: reviewPrompt(ctx, part.planText, fields, { chain: part.chain }), ctx, attempt: 'review' });
  const row = Array.isArray(result?.value?.review) ? result.value.review[0] : null;
  if (!row || typeof row !== 'object') { trace.push({ ...t, attempt: 'review', ok: false, error: String(result?.error?.message || result?.error || 'No review returned.') }); return { reviewed: false, fixes: [] }; }
  const problems = (Array.isArray(row.issues) ? row.issues : []).filter(i => paths.includes(i?.path) && prose(i?.problem)).slice(0, paths.length)
    .map(i => ({ path: i.path, problem: prose(i.problem) }));
  // When the chain holds, the reviewer has confirmed the repair resident's action rebuilds the landmark; a flag on that
  // same action contradicts it and is not acted on (recorded as dismissed).
  const dismissed = part.chain && row.chainHolds !== false ? problems.filter(p => (part.repairPaths || []).includes(p.path)).map(p => p.path) : [];
  if (dismissed.length) problems.splice(0, problems.length, ...problems.filter(p => !dismissed.includes(p.path)));
  if (part.chain && row.chainHolds === false) for (const p of paths.filter(p => /\.(problem|improvement)$/.test(p)))
    if (!problems.some(x => x.path === p)) problems.push({ path: p, problem: `The chain is broken: ${prose(row.chainProblem) || 'the improvement does not answer the problem'}. Make the problem come from the landmark's damage and the improvement what rebuilding it gives people.` });
  trace.push({ ...t, attempt: 'review', ok: !problems.length, ...(part.chain ? { chainHolds: row.chainHolds !== false } : {}), ...(dismissed.length ? { dismissed } : {}), issues: problems });
  if (!problems.length) return { reviewed: true, problems, fixes: [] };
  const fixStage = { id: 'review-repair', collections: { fixes: { count: [1, problems.length + 2], fields: { path: { kind: 'choice', list: problems.map(p => p.path) }, text: { kind: 'text' } } } }, semantic: () => [] };
  const fixed = await call($, request, { stage: fixStage, text: rewritePrompt(ctx, part.planText, fields, problems), ctx, attempt: 'review-repair' });
  const fixes = (Array.isArray(fixed?.value?.fixes) ? fixed.value.fixes : []).filter(f => problems.some(p => p.path === f?.path) && prose(f?.text))
    .filter((f, i, a) => a.findIndex(x => x.path === f.path) === i).map(f => ({ path: f.path, text: prose(f.text) }));
  // A rewrite that talks about the game instead of the world is not applied; the original text stays (recorded).
  const meta = fixes.filter(f => /\b(engine|PERMITTED EFFECTS)\b/i.test(f.text)).map(f => f.path);
  if (meta.length) fixes.splice(0, fixes.length, ...fixes.filter(f => !meta.includes(f.path)));
  trace.push({ ...t, attempt: 'review-repair', ...(meta.length ? { notApplied: meta } : {}), ok: fixes.length === problems.length, applied: fixes.map(f => f.path), missing: problems.filter(p => !fixes.some(f => f.path === p.path)).map(p => p.path) });
  return { reviewed: true, problems, fixes };
}

// ---------- Compile accepted stage values ----------
// Resident names use the population pipeline's own name normalization (generatedNames.clean, which turns hyphens and
// slashes into spaces), so the reserved identity is exactly the name the generated record will carry.
function residentName(value) { return require('./generatedNames').clean(prose(value)); }
function accept(stage, raw, accepted) {
  if (stage.id === 'communities') return { ...accepted, communities: raw.communities.map((c, i) => ({ id: 'c' + (i + 1), name: prose(c.name), setting: c.setting,
    fixtureName: prose(c.landmarkName), fixtureForm: c.landmarkForm, purpose: prose(c.landmarkPurpose), damage: prose(c.landmarkDamage),
    need: prose(c.problem), improvement: prose(c.improvement), passageMatters: prose(c.passageMatters), dangerMatters: prose(c.dangerMatters),
    disagreementWith: c.disagreementWith || null, disagreement: c.disagreement ? prose(c.disagreement) : null })) };
  if (stage.id === 'residents') return { ...accepted, plan: accepted.plan, residents: raw.residents.map((r, i) => { const slot = stage.slots[i];
    return { id: slot.id, name: residentName(r.name), community: slot.community, goalItem: prose(r.goalItem), obstacle: slot.obstacle, effect: slot.effect,
      whyHidden: prose(r.whyHidden), itemUse: verbPhrase(r.residentAction, r.name), meaning: prose(r.meaning), history: prose(r.history), willingTraveler: r.willingTraveler === true }; }) };
  return { ...accepted, relationships: raw.relationships.map(x => ({ from: x.from, kind: x.kind, to: x.to })),
    facts: raw.facts.map(f => ({ text: prose(f.text), community: f.community === 'region' ? null : f.community, involves: [...new Set(f.involves)],
      beliefs: f.beliefs.map(b => ({ holder: b.holder, account: prose(b.account) })) })),
    companionHooks: (raw.companionHooks || []).map(h => ({ companion: h.companion, kind: h.kind, stake: prose(h.stake), community: h.community })) };
}
// Player-facing text of the playable plan, by path, for the review.
function planFields(accepted) {
  const out = [];
  accepted.communities.forEach((c, i) => { for (const [f, k] of [['landmarkPurpose', 'purpose'], ['landmarkDamage', 'damage'], ['problem', 'need'], ['improvement', 'improvement'], ['passageMatters', 'passageMatters'], ['dangerMatters', 'dangerMatters']])
    if (c[k]) out.push({ path: `communities[${i}].${f}`, text: c[k], set: v => { c[k] = v; } }); });
  accepted.residents.forEach((r, i) => { for (const [f, k] of [['residentAction', 'itemUse'], ['whyHidden', 'whyHidden'], ['meaning', 'meaning'], ['history', 'history']])
    if (r[k]) out.push({ path: `residents[${i}].${f}`, text: r[k], set: v => { r[k] = f === 'residentAction' ? verbPhrase(v, r.name) : v; } }); });
  return out;
}
function residentPlan(accepted, r) {
  return { id: r.id, name: r.name, object: r.goalItem, playerAction: `the player ${OBSTACLE_PLAYER[r.obstacle]}, then gives ${r.goalItem} to ${r.name}`,
    worldConsequence: consequenceText(r.effect, JSON.stringify(accepted.communities.find(c => c.id === r.community)?.fixtureName)) };
}
function planBrief(accepted) {
  return JSON.stringify({ communities: accepted.communities.map(c => ({ id: c.id, name: c.name, landmark: c.fixtureName, form: c.fixtureForm, looks: FORMS.find(f => f.id === c.fixtureForm)?.looks })),
    residents: accepted.residents.map(r => residentPlan(accepted, r)) });
}
// Review parts: each community with its chain and all of its residents' player-facing text.
function reviewParts(accepted) {
  const parts = [];
  accepted.communities.forEach((c, i) => {
    const own = accepted.residents.map((r, j) => [r, j]).filter(([r]) => r.community === c.id);
    parts.push({ id: c.id, chain: true, planText: JSON.stringify({ community: { id: c.id, name: c.name, landmark: c.fixtureName, form: c.fixtureForm, looks: FORMS.find(f => f.id === c.fixtureForm)?.looks },
      residents: own.map(([r]) => residentPlan(accepted, r)) }),
      paths: [...['landmarkPurpose', 'landmarkDamage', 'problem', 'improvement', 'passageMatters', 'dangerMatters'].map(f => `communities[${i}].${f}`),
        ...own.flatMap(([, j]) => ['residentAction', 'whyHidden', 'meaning', 'history'].map(f => `residents[${j}].${f}`))],
      repairPaths: own.filter(([r]) => r.effect === 'restore-fixture').map(([, j]) => `residents[${j}].residentAction`) });
  });
  return parts;
}

// ---------- Model calls ----------
function localArrays(stage, { repair = null } = {}) {
  const arrays = {};
  for (const [name, coll] of Object.entries(stage.collections)) {
    if (repair) { const n = repair.filter(i => i.collection === name).length; if (n) arrays[name] = { count: Math.min(n, coll.count[1]), max: n + 2, batch: 1 }; }
    else arrays[name] = { count: coll.count[0], max: coll.count[1], batch: 1 };
  }
  return arrays;
}
function stageParameters(stage, opts) {
  if (stage.id === 'review') { const C = require('./generationContracts'), paths = stage.collections.review.fields.issues.list;
    const chain = stage.chain !== false;
    return { review: { type: C.list({ ...(chain ? { chainHolds: Boolean, chainProblem: C.text() } : {}), issues: { type: C.list({ path: C.choice(paths), problem: C.text() }), minItems: 0, maxItems: paths.length } }), minItems: 1, maxItems: 1 } }; }
  return parameters(stage, opts);
}
async function call($, request, { stage, text, ctx, attempt, repair }) {
  const shape = raw => { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(Error('Expected one JSON object.'), { issues: ['Expected one JSON object.'] }); return raw; };
  const work = async agent => {
    agent.model = $?.model || 'gpt-4.1-mini';
    if (typeof agent.user === 'function') await agent.user(text);
    return request(agent, { component: 'living-region', context: { runId: ctx.runId, stage: stage.id, attempt, repair: !!repair }, delegated: true,
      localWork: { brief: text, leading: Object.keys(localArrays(stage, { repair })), arrays: localArrays(stage, { repair }),
        specific: (path, prior) => `Author only item #${(prior.nextIndex || 0) + 1} of ${path}; use exact accepted IDs.` },
      parameters: stageParameters(stage, { repair }), validate: shape });
  };
  try { return typeof $?.run === 'function' ? await $.run(work, null, { shouldSaveToLog: false }) : await work($); }
  catch (error) { return { value: null, error }; }
}
// One stage: one authoring call (plus one more full call only when no JSON object came back at all), the structural
// checks, and at most one targeted repair. Returns { ok, raw, trace, reason }.
async function runStage($, request, stage, ctx, current, { text, trace = [] } = {}) {
  const Diagnostics = require('./generationDiagnostics');
  let raw = null, issues = [], error = null;
  for (let attempt = 1; attempt <= 2 && !raw; attempt++) {
    const result = await call($, request, { stage, text, ctx, attempt });
    if (result?.value && typeof result.value === 'object') raw = result.value;
    else { error = result?.error || Error('No JSON object returned.'); trace.push({ stage: stage.id, attempt, ok: false, error: String(error.message || error) }); }
  }
  if (!raw) return { ok: false, trace, reason: `Stage ${stage.id}: ${String(error?.message || error)}` };
  issues = check(stage, raw, ctx, current);
  trace.push({ stage: stage.id, attempt: 'author', ok: !issues.length, issues: issues.map(i => i.problem) });
  if (issues.length) {
    Diagnostics.report('living-region', { runId: ctx.runId, stage: stage.id, status: 'rejected', attempt: 1, reason: Error(issues.map(i => i.problem).join(' ')) });
    const result = await call($, request, { stage, text: repairPrompt(stage, ctx, current, raw, issues), ctx, attempt: 'repair', repair: issues });
    if (result?.value && typeof result.value === 'object') {
      const repaired = applyRepair(stage, raw, issues, result.value);
      raw = repaired.raw; issues = check(stage, raw, ctx, current);
      trace.push({ stage: stage.id, attempt: 'repair', ok: !issues.length, applied: repaired.applied, issues: issues.map(i => i.problem) });
    } else trace.push({ stage: stage.id, attempt: 'repair', ok: false, error: String(result?.error?.message || result?.error || 'No repair returned.') });
    if (issues.length) return { ok: false, raw, trace, reason: `Stage ${stage.id} still invalid after one repair: ${issues.map(i => i.problem).join(' ')}` };
  }
  return { ok: true, raw, trace };
}
// The playable part: communities, residents against the engine plan, then the review. Stages already accepted (from
// an earlier failed attempt) are reused unchanged. The social stage is NOT run here (authorSocial).
async function author($, ctx, { request = require('./generationContracts').request, accepted = {}, scope = SCOPE, log = () => {}, timing = null } = {}) {
  const trace = [], clock = (id, t0) => { if (timing) timing[id] = (timing[id] || 0) + (Date.now() - t0); };
  let current = structuredClone(accepted || {});
  current.plan ||= plan(scope);
  for (const stage of stages(ctx, scope, current.plan).filter(s => !s.social)) {
    if (stage.id === 'communities' && current.communities) continue;
    if (stage.id === 'residents' && current.residents) continue;
    const t0 = Date.now(), out = await runStage($, request, stage, ctx, current, { text: prompt(stage, ctx, current, scope), trace }); clock(stage.id, t0);
    if (!out.ok) return { ok: false, stage: stage.id, accepted: current, ...(out.raw ? { rejected: out.raw } : {}), trace, reason: out.reason };
    current = accept(stage, out.raw, current);
    log({ stage: stage.id, accepted: true });
  }
  if (!current.reviewed) {
    const t0 = Date.now(), fields = planFields(current), result = await review($, request, ctx, { planText: planBrief(current), fields, trace, parts: reviewParts(current) }); clock('review', t0);
    for (const f of result.fixes) fields.find(x => x.path === f.path)?.set(f.text);
    current.reviewed = { at: Date.now(), ran: result.reviewed, failedParts: result.failed, flagged: (result.problems || []).map(p => p.path), rewritten: result.fixes.map(f => f.path) };
  }
  return { ok: true, accepted: current, trace };
}
// Optional social detail, after the region is playable.
async function authorSocial($, ctx, accepted, { request = require('./generationContracts').request, scope = SCOPE } = {}) {
  const trace = [], stage = stages(ctx, scope, accepted.plan || plan(scope)).find(s => s.social);
  const out = await runStage($, request, stage, ctx, accepted, { text: prompt(stage, ctx, accepted, scope), trace });
  return out.ok ? { ok: true, accepted: accept(stage, out.raw, accepted), trace } : { ok: false, trace, reason: out.reason };
}

// ---------- Successor intention (after a committed change) ----------
// The engine fixes the next player action and consequence (a different obstacle than the resident's last goal) and
// passes the committed facts; the model authors only the object and why it matters now. Same PERMITTED EFFECTS.
function successorStage() {
  return { id: 'successor', collections: { successor: { count: [1, 1], fields: { goalItem: { kind: 'name' }, residentAction: { kind: 'text' }, whyHidden: { kind: 'text' }, meaning: { kind: 'text' } } } },
    semantic: (raw, ctx, input) => { const r = raw.successor?.[0]; const used = new Set((input.usedItems || []).map(lower));
      return r && prose(r.goalItem) && used.has(lower(r.goalItem)) ? [{ collection: 'successor', index: 0, field: 'goalItem', problem: 'successor[0].goalItem: must be a new object, not one already used in this region.' }] : []; } };
}
function successorPrompt(ctx, input) {
  return ['LIVING REGION — NEXT INTENTION (one bounded next goal for one resident, caused by a change the engine has committed).', settingLine(ctx), permittedEffects(),
    `COMMITTED FACTS (engine state, already true): ${JSON.stringify(input.facts)}.`,
    `RESIDENT: ${JSON.stringify({ name: input.resident.name, community: input.community.name, history: excerpt(input.resident.history, 300), previousGoal: excerpt(input.previous, 200) })}.`,
    `FIXED NEXT STEP (engine-owned): player action = the player ${OBSTACLE_PLAYER[input.slot.obstacle]}; world consequence = ${consequenceText(input.slot.effect, JSON.stringify(input.community.fixtureName))}.`,
    'Return {"successor":[{"goalItem":"...","residentAction":"...","whyHidden":"...","meaning":"..."}]}: goalItem (a new portable object that fits the genre); residentAction (a verb phrase after "so they can": the resident uses goalItem, not an earlier object, to bring about exactly that world consequence); whyHidden (how the object came to be where its obstacle keeps it); meaning (why this matters to them now BECAUSE of the committed change).',
    'Output only the JSON object.'].join('\n');
}
async function authorSuccessor($, ctx, input, { request = require('./generationContracts').request } = {}) {
  const trace = [], stage = successorStage();
  const out = await runStage($, request, stage, ctx, input, { text: successorPrompt(ctx, input), trace });
  if (!out.ok) return { ok: false, trace, reason: out.reason };
  const r = out.raw.successor[0];
  const goal = { goalItem: prose(r.goalItem), itemUse: verbPhrase(r.residentAction, input.resident.name), whyHidden: prose(r.whyHidden), meaning: prose(r.meaning) };
  const fields = [{ path: 'successor.residentAction', text: goal.itemUse, set: v => { goal.itemUse = verbPhrase(v, input.resident.name); } },
    { path: 'successor.whyHidden', text: goal.whyHidden, set: v => { goal.whyHidden = v; } }, { path: 'successor.meaning', text: goal.meaning, set: v => { goal.meaning = v; } }];
  const result = await review($, request, ctx, { planText: JSON.stringify({ resident: input.resident.name, object: goal.goalItem, playerAction: `the player ${OBSTACLE_PLAYER[input.slot.obstacle]}`, worldConsequence: consequenceText(input.slot.effect, JSON.stringify(input.community.fixtureName)), committed: input.facts }), fields, trace });
  for (const f of result.fixes) fields.find(x => x.path === f.path)?.set(f.text);
  return { ok: true, goal, trace };
}
module.exports = { residentName, GOAL_KINDS, GOAL_KIND, OBSTACLES, OBSTACLE_PLAYER, EFFECTS, DEFERRED_GOAL_KINDS, RELATIONS, CONSEQUENCES, HOOK_KINDS, SETTINGS, FORMS, FIXTURE_FORMS, GOAL_TASKS, SCOPE, MAX,
  plan, permittedEffects, consequenceText, stages, parameters, check, applyRepair, prompt, repairPrompt, accept, author, authorSocial, authorSuccessor, runStage, review, reviewPrompt, planFields,
  settingLine, prose, excerpt, verbPhrase };
