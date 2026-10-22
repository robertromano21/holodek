// Playtest server preload (node -r). Records every model call, and in mock/hybrid mode answers calls locally.
//   PLAYTEST_MODEL_MODE = mock (default: zero live calls) | hybrid (only HOLODEK_LIVE_CALLS / live-budget go live) | live
//   HOLODEK_LIVE_CALLS  = comma list of components allowed to go live in hybrid mode (e.g. "pass,book-cover,book-chapter")
//   <run>/live-budget.json {"calls": N, "components": [...]} = extra live calls marked by the scenario/player (decremented)
// Real responses are cached by prompt hash in <run>/cache/ and replayed; every prompt is saved to <run>/prompts/<hash>.json.
// A hand-written reply in <run>/prompts/replies/<hash>.json (raw text, or {"content":..} / {"arguments":{..}}) is used first.
// The key is never written: key-shaped text and the exact key value are redacted.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const RUN = process.env.PLAYTEST_RUN || path.join(process.cwd(), 'playtest-run');
const FILE = process.env.PLAYTEST_CAPTURE || path.join(RUN, 'model-calls.jsonl');
const MODE = (process.env.HOLODEK_MODEL_MODE === 'agent' ? 'agent' : null) || process.env.PLAYTEST_MODEL_MODE || (process.env.HOLODEK_LIVE_CALLS ? 'hybrid' : 'mock');
const LIVE = new Set(String(process.env.HOLODEK_LIVE_CALLS || '').split(',').map(s => s.trim()).filter(Boolean));
for (const d of ['cache', 'prompts', 'prompts/replies']) fs.mkdirSync(path.join(RUN, d), { recursive: true });
const KEY = process.env.OPENAI_API_KEY || '';
const redact = s => { let t = String(s).replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-<redacted>'); if (KEY.length > 8) t = t.split(KEY).join('<redacted-key>'); return t; };
const write = row => fs.appendFileSync(FILE, redact(JSON.stringify(row)) + '\n');
const tokens = s => Math.ceil(String(s || '').length / 4);
const stats = { live: 0, cached: 0, mocked: 0, handwritten: 0, liveTokens: 0, localTokens: 0, byComponent: {} };
const saveStats = () => { const total = stats.live + stats.cached + stats.mocked + stats.handwritten;
  fs.writeFileSync(path.join(RUN, 'model-stats.json'), JSON.stringify({ mode: MODE, total, localPercent: total ? +(100 * (total - stats.live) / total).toFixed(2) : 100, ...stats }, null, 1)); };
// ---- component tagging: generationContracts.request($, {component}) runs inside this context ----
const als = new AsyncLocalStorage();
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const m = origLoad.apply(this, arguments);
  if (/generationContracts(\.js)?$/.test(request) && m && typeof m.request === 'function' && !m.__playtest) {
    const inner = m.request; m.request = function($, opts) { return als.run({ component: opts?.component || 'contract', validate: opts?.validate, context: opts?.context }, () => inner.apply(this, arguments)); }; m.__playtest = true;
  }
  return m;
};
// ---- deterministic schema-valid generator ----
function fromSchema(s, seed, key = '') {
  if (!s || typeof s !== 'object') return null;
  if (s.enum) return s.enum[seed % s.enum.length];
  if (s.const !== undefined) return s.const;
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if (s.anyOf || s.oneOf) return fromSchema((s.anyOf || s.oneOf).find(x => x.type !== 'null') || {}, seed, key);
  if (t === 'object' || s.properties) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = fromSchema(v, seed + k.length, k); return o; }
  if (t === 'array') { const n = Math.max(s.minItems || 0, Math.min(s.maxItems ?? 1, 1), key === 'layers' ? 8 : 0); /* room art needs 6..36 layers */ return Array.from({ length: n }, (_, i) => fromSchema(s.items || {}, seed + i, key)); }
  if (t === 'integer' || t === 'number') { const lo = s.minimum ?? (s.exclusiveMinimum != null ? s.exclusiveMinimum + 1 : 0), hi = s.maximum ?? lo + 10; return (t === 'integer' || (Number.isInteger(lo) && Number.isInteger(hi))) ? Math.round(lo + (seed % Math.max(1, hi - lo + 1))) : lo + (hi - lo) / 2; }
  if (t === 'boolean') return seed % 2 === 0;
  if (/color|colour|^(sky|ground|shadow|stone|accent|light|shade|detail)$/i.test(key)) { let h = seed >>> 0; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0; return '#' + (h >>> 8).toString(16).padStart(6, '0').slice(0, 6); } // per-key hash: equal-length keys (ground/shadow) no longer get the same color
  let v = `mock ${key || 'text'} ${seed % 97}`; if (s.minLength && v.length < s.minLength) v = v.padEnd(s.minLength, ' .'); if (s.maxLength) v = v.slice(0, s.maxLength); return v;
}
const WORDS_COTG = { place: ['ash-choked nave', 'collapsed reliquary', 'stepped causeway', 'salt-white courtyard', 'scriptorium of cinders', 'bone-lit crypt', 'wind-cut terrace'],
  deity: ['Mortacia', 'Dantuea', 'Arithus', 'Atinus'], thing: ['a bronze lantern', 'a cracked seal', 'a ledger of names', 'a chained reliquary', 'a sun-bleached banner', 'a carved key'],
  name: ['Orren Vale', 'Ilsa Marrow', 'Tavic Dusk', 'Seren Ashby', 'Bram Holloway', 'Veyra Ashenveil'], verb: ['waits', 'listens', 'smoulders', 'hums faintly', 'shifts in the wind'] };
// Neutral, setting-free words for homebrew / Campaign Builder worlds (no Children of the Grave names); chosen per request.
const WORDS_NEUTRAL = { place: ['dusty main street', 'shuttered assay office', 'flooded mine adit', 'bell tower stair', 'boarded chapel', 'dry wash', 'lantern-lit saloon', 'rail siding'],
  deity: ['the old powers', 'the Quiet Choir', 'the founders', 'the deep thing'], thing: ['a tin star', 'a cracked lantern', 'a ledger of claims', 'a rusted bell clapper', 'a sealed letter', 'a brass key'],
  name: ['Wade Corrigan', 'Abigail Tusk', 'Elias Penhale', 'Nell Varga', 'Joaquin Reyes', 'Hattie Quill', 'Silas Brandt', 'Marisol Ortega'], verb: ['waits', 'creaks', 'settles', 'hums faintly', 'shifts in the wind'], sky: 'a white-hot sky' };
WORDS_COTG.sky = 'the yellow sky of Tartarus';
let WORDS = WORDS_COTG;
const pick = (list, seed, k = 0) => list[Math.abs(seed + k * 7) % list.length];
function prose(seed, chars = 400) {
  const out = []; let i = 0;
  while (out.join(' ').length < chars) { out.push(`The ${pick(WORDS.place, seed, i)} ${pick(WORDS.verb, seed, i + 1)} beneath ${WORDS.sky}; ${pick(WORDS.name, seed, i)} once left ${pick(WORDS.thing, seed, i + 2)} here in ${pick(WORDS.deity, seed, i)}'s name.`); i++; if (i % 3 === 0) out.push('\n\n'); }
  return out.join(' ').replace(/ \n\n /g, '\n\n').trim();
}
const RICH = {
  // World classes/races: distinct, setting-free names that vary by seed (each new world differs).
  'world-roster': seed => { const adj = ['Dust', 'Iron', 'Lonesome', 'Ember', 'Sundown', 'Brass', 'Hollow', 'Starless', 'Rattler', 'Pale', 'Bitter', 'Copper'], role = ['Gunhand', 'Lawkeeper', 'Card Sharp', 'Prospector', 'Circuit Preacher', 'Trail Scout', 'Lamp Warden', 'Tide Listener', 'Bone Reader'], kin = ['Frontier-born', 'Hill folk', 'Marked', 'Rail-camp kin', 'Deep-touched'];
    const sh = (a, k) => [...a].sort((x, y) => ((seed * 31 + x.length * 7 + x.charCodeAt(0) * k) % 97) - ((seed * 31 + y.length * 7 + y.charCodeAt(0) * k) % 97));
    const A = sh(adj, 3), R = sh(role, 5), K = sh(kin, 7);
    return { classes: R.slice(0, 6).map((r, i) => ({ name: `${A[i]} ${r}`, description: `A ${r.toLowerCase()} of the frontier.`, hitDie: ['6', '8', '10', '12'][(seed + i) % 4], stats: { Attack: (seed + i) % 3, Damage: i % 2, Armor: (i + 1) % 2, Magic: (seed + 2 * i) % 3 },
        abilities: [{ name: `${r.split(' ')[0]} Gambit`, cost: 1 + i % 3, effect: 'Spend the resource for a heroic edge.' }], gear: ['Bedroll', 'Canteen'], ammo: i % 2 ? 'bullets' : 'none', bodyPlan: 'humanoid' })),
      races: K.slice(0, 3).map((k, i) => ({ name: `${A[6 + i]} ${k}`, description: `${k} of the frontier.`, stats: { Attack: 0, Damage: 0, Armor: i % 2, Magic: i ? 1 : 0 }, hpBonus: i, bodyPlan: 'humanoid' })) }; },
  'book-cover': seed => ({ title: `The ${['Ash', 'Salt', 'Lantern', 'Ninth', 'Hollow', 'Ember'][seed % 6]} ${['Concordance', 'Ledger', 'Vigil', 'Chronicle', 'Testament', 'Almanac'][(seed >> 3) % 6]}`,
    author: pick(['Anonymous', ...WORDS.name], seed), publishedSR: 100 + seed % 790, backstory: `Copied by keepers who feared ${pick(WORDS.deity, seed)} would forget them.`,
    contents: ['The Burning Shelves', `Before the ${pick(WORDS.place, seed, 1)}`, `A Vigil for ${pick(WORDS.deity, seed)}`, 'The Sealed Stair', 'What the Wind Kept'], newFacts: [`${pick(WORDS.name, seed)} hid ${pick(WORDS.thing, seed)} beneath the ${pick(WORDS.place, seed, 3)}.`] }),
  'book-chapter': seed => ({ text: prose(seed, 1500), newFacts: [`The ${pick(WORDS.place, seed, 2)} answers to ${pick(WORDS.deity, seed, 1)}.`] })
};
function fill(v, seed, key, schema) {
  if (typeof v === 'string' && schema?.maxLength === 7 && !schema?.enum) { let h = seed >>> 0; for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0; return '#' + (h >>> 8).toString(16).padStart(6, '0').slice(0, 6); } // Contracts.text(7) colour slots
  if (typeof v !== 'string' || schema?.enum || schema?.pattern || /color|colour/i.test(key)) return v;
  const max = schema?.maxLength ?? 240, min = schema?.minLength || 0;
  if (key === 'gmName') return `${pick(['Marshal', 'Warden', 'Keeper', 'Archivist', 'Herald'], seed)} ${pick(WORDS.name, seed, 3).split(' ')[1]}`;
  if (/title|name|label/i.test(key)) return `${pick(WORDS.name, seed)} of the ${pick(WORDS.place, seed)}`.slice(0, max).padEnd(min, '.');
  return prose(seed, Math.max(min, Math.min(max, 110))).split(' ').slice(0, 14).join(' ').slice(0, max);
}
function richSchema(s, seed, key = '') {
  if (!s || typeof s !== 'object') return null;
  if (s.anyOf || s.oneOf) return richSchema((s.anyOf || s.oneOf).find(x => x.type !== 'null') || {}, seed, key);
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if ((t === 'object' || s.properties) && !s.enum) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = richSchema(v, seed + k.length * 13, k); return o; }
  if (t === 'array') { const slotMax = s.items?.properties?.slot?.maximum;
    const enumKey = ['name', 'id', 'actor', 'target'].find(k => Array.isArray(s.items?.properties?.[k]?.enum) && s.items.properties[k].enum.length >= 1); /* >=1: a solo party has one actor */
    if (enumKey) return s.items.properties[enumKey].enum.map((val, i) => ({ ...richSchema(s.items, seed + i * 31, key), [enumKey]: val })); // one row per named actor
    if (Number.isInteger(slotMax)) return Array.from({ length: slotMax + 1 }, (_, i) => ({ ...richSchema(s.items, seed + i * 31, key), slot: i }));
    const it = s.items || {}; if ((it.type === 'string' || it === String) && !it.enum) return Array.from({ length: Math.max(s.minItems || 0, Math.min(s.maxItems ?? 3, 3)) }, (_, i) => `${pick(WORDS.name, seed, i)} says the ${pick(WORDS.place, seed, i + 1)} ${pick(WORDS.verb, seed, i)}.`).map(t => it.maxLength ? t.slice(0, it.maxLength) : t);
    const n = Math.max(s.minItems || 0, Math.min(s.maxItems ?? 3, 3), key === 'layers' ? 8 : 0); return Array.from({ length: n }, (_, i) => richSchema(s.items || {}, seed + i * 31, key)); }
  return fill(fromSchema({ ...s, type: t }, Math.abs(seed), key), Math.abs(seed), key, s);
}
function resizeField(value, field, n, schema, seed) {
  // find the array property whose name matches (singular/plural tolerant), at any depth
  const want = field.toLowerCase().replace(/s$/, '');
  const walk = (v, sch) => { if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    for (const [k, x] of Object.entries(v)) { const sub = sch?.properties?.[k];
      if (Array.isArray(x) && k.toLowerCase().replace(/s$/, '') === want) v[k] = Array.from({ length: n }, (_, i) => x[i] ?? richSchema(sub?.items || {}, seed + i * 31, k));
      else if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, sub); }
    return v; };
  return walk(value, schema);
}
const VALIDATION_LOG = path.join(RUN, 'mock-validation.jsonl');
function mockAnswer(body, seed, component, store) {
  const all = JSON.stringify(body.messages || []); WORDS = /Tartarus|Children of the Grave|Grave Master|Mortacia/.test(all) && !/\bORIGINAL\b|homebrew/.test(all) ? WORDS_COTG : WORDS_NEUTRAL;
  const tool = body.tools?.[0]?.function;
  if (tool) {
    // Run candidates through the call's OWN validator first, so the game accepts the mock on its first parse.
    let last = null; const lengths = {};
    for (let k = 0; k < 16; k++) {
      let value = RICH[component] ? RICH[component](seed + k * 977) : richSchema(tool.parameters, seed + k * 977);
      // Learn from the validator: "<field>: expected N ..." / "Expected exactly N <field>" fixes that array's length.
      for (const [field, n] of Object.entries(lengths)) value = resizeField(value, field, n, tool.parameters, seed + k);
      if (typeof store?.validate !== 'function') return { arguments: JSON.stringify(value), name: tool.name };
      try { const r = store.validate(value); if (r && typeof r.then === 'function') return { arguments: JSON.stringify(value), name: tool.name };
        if (k) fs.appendFileSync(VALIDATION_LOG, JSON.stringify({ component, acceptedOnAttempt: k + 1 }) + '\n'); return { arguments: JSON.stringify(value), name: tool.name }; }
      catch (e) { last = { value, error: String(e.message || e).slice(0, 300) };
        const msg = last.error, m = /^([\w.\[\]]+): expected (?:exactly )?(\d+)/i.exec(msg) || /expected exactly (\d+) (\w+)/i.exec(msg);
        if (m) { const [field, n] = /^\d+$/.test(m[1]) ? [m[2], Number(m[1])] : [m[1], Number(m[2])]; lengths[field.replace(/\[.*$/, '')] = n; } }
    }
    fs.appendFileSync(VALIDATION_LOG, JSON.stringify({ component, failedAllAttempts: true, error: last?.error }) + '\n');
    return { arguments: JSON.stringify(last.value), name: tool.name };
  }
  // Character trait spec (json_object, no tool): answer with the game's own derived traits so the validator accepts it first time.
  if (body.response_format?.type === 'json_object' && /Character sheet:/.test(JSON.stringify(body.messages?.at(-1) || ''))) {
    try { const PCR = require(path.join(process.cwd(), 'assets/renderCharacterProcedural.js')); const sheet = JSON.parse(String(body.messages.find(m => /^Character sheet:/.test(m.content || ''))?.content || '').replace(/^Character sheet:\n/, ''));
      const t = PCR.deriveFallbackTraits ? PCR.deriveFallbackTraits(sheet) : PCR.baseTraits(); const pal = {}; for (const [k, v] of Object.entries(t.palette || {})) if (/^#?[0-9a-f]{6}$/i.test(String(v))) pal[k] = v; if (!pal.skin) pal.skin = '#c89870';
      return { content: JSON.stringify({ ...t, palette: pal }) }; } catch (e) { console.error('[mock] traits answer failed:', e.message); throw e; } }
  // Generic json_object contract ("Respond with ONE JSON object with exactly these keys: {...}"): answer with that example object.
  if (body.response_format?.type === 'json_object') { const sys = (body.messages || []).map(m => String(m.content || '')).join('\n'), at = sys.search(/exactly these keys:\s*\{/);
    if (at >= 0) { const start = sys.indexOf('{', at); let depth = 0, end = start; for (; end < sys.length; end++) { if (sys[end] === '{') depth++; else if (sys[end] === '}' && --depth === 0) break; }
      const conc = (v, k = 0) => typeof v === 'string' ? (/^#rrggbb$/i.test(v) ? '#' + (((seed + k) * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6) : v.includes('|') ? v.split('|')[Math.abs(seed + k) % v.split('|').length] : v)
        : Array.isArray(v) ? v.map((x, i) => conc(x, k + i)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x], i) => [kk, conc(x, k + i * 3)])) : v;
      try { return { content: JSON.stringify(conc(JSON.parse(sys.slice(start, end + 1)))) }; } catch {} } }
  const text = JSON.stringify(body.messages || []);
  if (/"facts"/.test(JSON.stringify(body.messages?.[0] || ''))) return { content: JSON.stringify({ facts: [prose(seed, 120)] }) };
  // Text-mode JSON contracts ("Return ONLY JSON with these keys: - name: ..."), answered as JSON from the listed keys.
  const ask = (body.messages || []).map(m => String(m.content || '')).join('\n');
  const keyBlock = /Return ONLY (?:valid )?JSON[^\n]*\n((?:\s*-\s*\w+:[^\n]*\n?)+)/i.exec(ask);
  if (keyBlock) { const o = {}; for (const [, k, spec] of keyBlock[1].matchAll(/-\s*(\w+):\s*([^\n]*)/g)) {
      const choices = [...spec.matchAll(/"([^"#]+)"/g)].map(x => x[1]);
      o[k] = /#RRGGBB/i.test(spec) ? '#' + (((seed * 2654435761) >>> 0) ^ (k.length * 0x3a5f1)).toString(16).padStart(6, '0').slice(-6)
        : /true|false|boolean/i.test(spec) ? false : /number|integer|\d+-\d+/i.test(spec) ? 1 : choices.length ? pick(choices, seed, k.length) : prose(seed + k.length, 60).slice(0, 80); }
    return { content: JSON.stringify(o) }; }
  const exits = /exits?[^.]{0,40}?:\s*([a-z ,]+)/i.exec(text)?.[1]?.trim();
  const cmd = String(body.messages?.at(-1)?.content || '').replace(/\s+/g, ' ').slice(0, 80);
  return { content: `${prose(seed, 520)}${exits ? `\n\nPassages lead ${exits}.` : ''}\n\n(Local retort mock; command: ${cmd})` };
}
// ---- build SDK-shaped results ----
function completion(body, r) {
  const msg = r.name ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_mock', type: 'function', function: { name: r.name, arguments: r.arguments } }] } : { role: 'assistant', content: r.content };
  return { id: 'chatcmpl-local', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, message: msg, finish_reason: r.name ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}
function stream(body, r) {
  const chunks = [], base = { id: 'chatcmpl-local', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model };
  if (r.name) { chunks.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_mock', type: 'function', function: { name: r.name, arguments: '' } }] } }] });
    for (let i = 0; i < r.arguments.length; i += 400) chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: r.arguments.slice(i, i + 400) } }] } }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }); }
  else { const t = r.content || ''; chunks.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }); for (let i = 0; i < t.length; i += 200) chunks.push({ ...base, choices: [{ index: 0, delta: { content: t.slice(i, i + 200) } }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }); }
  const { Stream } = require(require.resolve('openai/streaming', { paths: [process.cwd()] }));
  const sse = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return Stream.fromSSEResponse(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), new AbortController());
}
function liveAllowed(component) {
  if (MODE === 'live') return true;
  if (MODE === 'mock') return false;
  if (LIVE.has(component)) return true;
  const f = path.join(RUN, 'live-budget.json');
  try { const b = JSON.parse(fs.readFileSync(f, 'utf8')); if ((b.calls || 0) > 0 && (!b.components?.length || b.components.includes(component))) { b.calls--; fs.writeFileSync(f, JSON.stringify(b)); return true; } } catch {}
  return false;
}
// ---- patch the SDK ----
const { OpenAI } = require(require.resolve('openai', { paths: [process.cwd()] }));
const probe = new OpenAI({ apiKey: 'probe' }), Completions = Object.getPrototypeOf(probe.chat.completions), original = Completions.create;
// ---- agent mode: an agent authors each narrative reply by hand ----
// HOLODEK_MODEL_MODE=agent: every non-mechanical call is written to <run>/agent-queue/<id>.req.json; the server waits
// (HOLODEK_AGENT_TIMEOUT_MS, default 10 min) for <id>.res.json = {"content": "..."} or {"arguments": {...}}.
// Tool replies are run through the call's real validator; a rejected reply produces <id>.err.json and the wait continues.
const MECHANICAL = new RegExp(process.env.HOLODEK_AGENT_LOCAL || '^(retrieval|book-retrieval|facts|keyword|campaign-atlas|campaign-cities|environment-intent|classify|colors|art|room-illustration|surface-art|physical-puzzle|sid|music|sprite)', 'i');
const QUEUE = path.join(RUN, 'agent-queue'); fs.mkdirSync(QUEUE, { recursive: true });
async function agentAnswer({ id, hash, component, body, store }) {
  const base = path.join(QUEUE, String(id).padStart(4, '0')), tool = body.tools?.[0]?.function;
  fs.writeFileSync(base + '.req.json', redact(JSON.stringify({ id, hash, component, stream: !!body.stream, tool: tool ? { name: tool.name, parameters: tool.parameters } : null,
    validator: typeof store?.validate === 'function', messages: body.messages }, null, 1)));
  const until = Date.now() + Number(process.env.HOLODEK_AGENT_TIMEOUT_MS || 600000);
  while (Date.now() < until) {
    if (fs.existsSync(base + '.res.json')) {
      const raw = fs.readFileSync(base + '.res.json', 'utf8'); let r;
      try { const j = JSON.parse(raw); r = j.arguments != null ? { name: tool?.name, arguments: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments) } : { content: String(j.content ?? '') }; }
      catch (e) { r = tool ? null : { content: raw }; if (!r) { fs.writeFileSync(base + '.err.json', JSON.stringify({ error: 'not JSON: ' + e.message })); fs.renameSync(base + '.res.json', base + `.rejected-${Date.now()}.json`); continue; } }
      if (tool && typeof store?.validate === 'function') try { const v = store.validate(JSON.parse(r.arguments)); if (v?.then) await v; }
        catch (e) { fs.writeFileSync(base + '.err.json', JSON.stringify({ error: String(e.message || e).slice(0, 600) })); fs.renameSync(base + '.res.json', base + `.rejected-${Date.now()}.json`); continue; }
      fs.writeFileSync(base + '.done', ''); return r;
    }
    await new Promise(res => setTimeout(res, 400));
  }
  fs.writeFileSync(base + '.timeout', ''); return null;
}
let n = 0;
Completions.create = function(body, options) {
  const id = ++n, at = new Date().toISOString(), started = Date.now();
  const component = als.getStore()?.component || (body?.tools ? 'tool:' + body.tools.map(t => t.function?.name).join('+') : body?.stream ? 'pass' : 'text');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ m: body?.model, msg: body?.messages, tools: body?.tools })).digest('hex').slice(0, 24);
  const promptChars = JSON.stringify(body?.messages || '').length;
  fs.writeFileSync(path.join(RUN, 'prompts', hash + '.json'), redact(JSON.stringify({ id, at, component, model: body?.model, stream: !!body?.stream, body }, null, 1)));
  const c = stats.byComponent[component] ||= { live: 0, local: 0 };
  const local = (r, source) => { stats[source]++; c.local++; stats.localTokens += tokens(promptChars * 1) / 1 + tokens(r.content || r.arguments);
    write({ id, at, kind: 'request', source, component, hash, model: body?.model, stream: !!body?.stream, body }); write({ id, kind: 'response', source, component, ms: Date.now() - started, content: r.content || '', toolArguments: r.arguments || '' }); saveStats();
    return Promise.resolve(body?.stream ? stream(body, r) : completion(body, r)); };
  if (MODE !== 'live') {
    const hw = path.join(RUN, 'prompts', 'replies', hash + '.json');
    if (fs.existsSync(hw)) { const raw = fs.readFileSync(hw, 'utf8'); let r; try { const j = JSON.parse(raw); r = j.arguments ? { name: body.tools?.[0]?.function?.name, arguments: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments) } : { content: j.content ?? raw }; } catch { r = { content: raw }; } return local(r, 'handwritten'); }
    const cf = path.join(RUN, 'cache', hash + '.json');
    if (fs.existsSync(cf)) return local(JSON.parse(fs.readFileSync(cf, 'utf8')), 'cached');
    if (MODE === 'agent' && !MECHANICAL.test(component)) return agentAnswer({ id, hash, component, body, store: als.getStore() }).then(r => r ? local(r, 'handwritten') : local(mockAnswer(body, parseInt(hash.slice(0, 6), 16), component, als.getStore()), 'mocked'));
    if (!liveAllowed(component)) return local(mockAnswer(body, parseInt(hash.slice(0, 6), 16), component, als.getStore()), 'mocked');
  }
  stats.live++; c.live++; stats.liveTokens += Math.ceil(promptChars / 4); saveStats();
  write({ id, at, kind: 'request', source: 'live', component, hash, model: body?.model, stream: !!body?.stream, body });
  const toCache = r => { if (MODE !== 'live') try { fs.writeFileSync(path.join(RUN, 'cache', hash + '.json'), redact(JSON.stringify(r))); } catch {} };
  const result = original.call(this, body, options);
  return result.then(value => {
    if (!body?.stream || !value || typeof value[Symbol.asyncIterator] !== 'function') {
      const m = value?.choices?.[0]?.message || {}, tc = m.tool_calls?.[0]?.function;
      toCache(tc ? { name: tc.name, arguments: tc.arguments } : { content: m.content || '' }); stats.liveTokens += value?.usage?.completion_tokens || 0; saveStats();
      write({ id, kind: 'response', source: 'live', component, ms: Date.now() - started, raw: value }); return value; }
    const iterator = value[Symbol.asyncIterator].bind(value);
    let text = '', args = '', name = null, usage = null, chunks = 0;
    value[Symbol.asyncIterator] = async function* () {
      try {
        for await (const chunk of { [Symbol.asyncIterator]: iterator }) { chunks++; const d = chunk?.choices?.[0]?.delta || {};
          text += d.content || ''; for (const t of d.tool_calls || []) { args += t.function?.arguments || ''; name ||= t.function?.name; } if (chunk.usage) usage = chunk.usage; yield chunk; }
        toCache(name ? { name, arguments: args } : { content: text }); stats.liveTokens += usage?.completion_tokens || tokens(text + args); saveStats();
        write({ id, kind: 'response', source: 'live', component, ms: Date.now() - started, chunks, content: text, toolArguments: args, usage });
      } catch (error) { write({ id, kind: 'stream-error', component, ms: Date.now() - started, chunks, partial: text || args, error: String(error?.message || error), code: error?.code }); throw error; }
    };
    return value;
  }, error => { write({ id, kind: 'error', component, ms: Date.now() - started, error: String(error?.message || error), status: error?.status }); throw error; });
};
process.on('exit', saveStats);
