'use strict';
// Reference extract of the local mock responder: schema- and validator-driven replies for every call type from tools/playtest/capture.cjs (the active implementation, loaded with node -r).
// Kept as a separate readable file; capture.cjs does not require it. Contains no keys.
const fs = require('fs'), path = require('path');
const RUN = process.env.PLAYTEST_RUN || path.join(process.cwd(), 'playtest-run');
function fromSchema(s, seed, key = '') {
  if (!s || typeof s !== 'object') return null;
  if (s.enum) return s.enum[seed % s.enum.length];
  if (s.const !== undefined) return s.const;
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if (s.anyOf || s.oneOf) return fromSchema((s.anyOf || s.oneOf).find(x => x.type !== 'null') || {}, seed, key);
  if (t === 'object' || s.properties) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = fromSchema(v, seed + k.length, k); return o; }
  if (t === 'array') { const n = Math.max(s.minItems || 0, Math.min(s.maxItems ?? 1, 1)); return Array.from({ length: n }, (_, i) => fromSchema(s.items || {}, seed + i, key)); }
  if (t === 'integer' || t === 'number') { const lo = s.minimum ?? (s.exclusiveMinimum != null ? s.exclusiveMinimum + 1 : 0), hi = s.maximum ?? lo + 10; return t === 'integer' ? Math.round(lo + (seed % Math.max(1, hi - lo + 1))) : lo + (hi - lo) / 2; }
  if (t === 'boolean') return seed % 2 === 0;
  if (/color|colour/i.test(key)) return '#' + ((seed * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6);
  let v = `mock ${key || 'text'} ${seed % 97}`; if (s.minLength && v.length < s.minLength) v = v.padEnd(s.minLength, ' .'); if (s.maxLength) v = v.slice(0, s.maxLength); return v;
}
const WORDS = { place: ['ash-choked nave', 'collapsed reliquary', 'stepped causeway', 'salt-white courtyard', 'scriptorium of cinders', 'bone-lit crypt', 'wind-cut terrace'],
  deity: ['Mortacia', 'Dantuea', 'Arithus', 'Atinus'], thing: ['a bronze lantern', 'a cracked seal', 'a ledger of names', 'a chained reliquary', 'a sun-bleached banner', 'a carved key'],
  name: ['Orren Vale', 'Ilsa Marrow', 'Tavic Dusk', 'Seren Ashby', 'Bram Holloway', 'Veyra Ashenveil'], verb: ['waits', 'listens', 'smoulders', 'hums faintly', 'shifts in the wind'] };
const pick = (list, seed, k = 0) => list[Math.abs(seed + k * 7) % list.length];
function prose(seed, chars = 400) {
  const out = []; let i = 0;
  while (out.join(' ').length < chars) { out.push(`The ${pick(WORDS.place, seed, i)} ${pick(WORDS.verb, seed, i + 1)} beneath the yellow sky of Tartarus; ${pick(WORDS.name, seed, i)} once left ${pick(WORDS.thing, seed, i + 2)} here in ${pick(WORDS.deity, seed, i)}'s name.`); i++; if (i % 3 === 0) out.push('\n\n'); }
  return out.join(' ').replace(/ \n\n /g, '\n\n').trim();
}
const RICH = {
  'book-cover': seed => ({ title: `The ${['Ash', 'Salt', 'Lantern', 'Ninth', 'Hollow', 'Ember'][seed % 6]} ${['Concordance', 'Ledger', 'Vigil', 'Chronicle', 'Testament', 'Almanac'][(seed >> 3) % 6]}`,
    author: pick(['Anonymous', ...WORDS.name], seed), publishedSR: 100 + seed % 790, backstory: `Copied by keepers who feared ${pick(WORDS.deity, seed)} would forget them.`,
    contents: ['The Burning Shelves', `Before the ${pick(WORDS.place, seed, 1)}`, `A Vigil for ${pick(WORDS.deity, seed)}`, 'The Sealed Stair', 'What the Wind Kept'], newFacts: [`${pick(WORDS.name, seed)} hid ${pick(WORDS.thing, seed)} beneath the ${pick(WORDS.place, seed, 3)}.`] }),
  'book-chapter': seed => ({ text: prose(seed, 1500), newFacts: [`The ${pick(WORDS.place, seed, 2)} answers to ${pick(WORDS.deity, seed, 1)}.`] })
};
function fill(v, seed, key, schema) {
  if (typeof v !== 'string' || schema?.enum || schema?.pattern || /color|colour/i.test(key)) return v;
  const max = schema?.maxLength ?? 240, min = schema?.minLength || 0;
  if (/title|name|label/i.test(key)) return `${pick(WORDS.name, seed)} of the ${pick(WORDS.place, seed)}`.slice(0, max).padEnd(min, '.');
  return prose(seed, Math.max(min, Math.min(max, 160))).slice(0, max);
}
function richSchema(s, seed, key = '') {
  if (!s || typeof s !== 'object') return null;
  if (s.anyOf || s.oneOf) return richSchema((s.anyOf || s.oneOf).find(x => x.type !== 'null') || {}, seed, key);
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if ((t === 'object' || s.properties) && !s.enum) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = richSchema(v, seed + k.length * 13, k); return o; }
  if (t === 'array') { const slotMax = s.items?.properties?.slot?.maximum;
    if (Number.isInteger(slotMax)) return Array.from({ length: slotMax + 1 }, (_, i) => ({ ...richSchema(s.items, seed + i * 31, key), slot: i }));
    const it = s.items || {}; if ((it.type === 'string' || it === String) && !it.enum) return Array.from({ length: Math.max(s.minItems || 0, Math.min(s.maxItems ?? 3, 3)) }, (_, i) => `${pick(WORDS.name, seed, i)} says the ${pick(WORDS.place, seed, i + 1)} ${pick(WORDS.verb, seed, i)}.`);
    const n = Math.max(s.minItems || 0, Math.min(s.maxItems ?? 3, 3)); return Array.from({ length: n }, (_, i) => richSchema(s.items || {}, seed + i * 31, key)); }
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

module.exports = { mockAnswer, richSchema, prose, RICH, resizeField };
