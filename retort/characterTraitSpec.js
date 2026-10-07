// retort/characterTraitSpec.js
// Turns free-text character sheets (PC / NPC / monster) into a structured visual trait spec for the
// procedural sprite generator (assets/renderCharacterProcedural.js) using ONE cheap LLM call per new name.
//  - validated + clamped to the generator schema (PC.normalizeTraitSpec / validateTraitSpec)
//  - up to 3 attempts with backoff; an invalid answer is re-asked with the validation problems
//  - if all attempts fail the client shows a neutral placeholder (no fake character) and we keep retrying
//    in the background forever (20s, 1m, 3m, 10m, then every 15m; max 3 concurrent calls) and broadcast
//    the spec when it finally arrives
//  - cached by character name in memory and on disk (.retort-data/character-traits.json), together with
//    a random per-character salt + variant (uniqueness pass) so a character's look is stable forever.
const fs = require('fs');
const path = require('path');
const PC = require('../assets/renderCharacterProcedural.js');

const CACHE_FILE = process.env.HOLODEK_TRAIT_CACHE || path.join(__dirname, '..', '.retort-data', 'character-traits.json');
const MODEL = process.env.HOLODEK_TRAIT_MODEL || 'gpt-4.1-mini';
const MAX_ATTEMPTS = 3;
// Background retries after a failed round of attempts: never give up, but back off to one try per 15 min.
const RETRY_DELAYS_MS = [20000, 60000, 180000, 600000, 900000];
const MAX_CONCURRENT = 3;

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { OpenAI } = require('openai');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000 });
  } catch (e) {
    client = null;
  }
  return client;
}

let cache = null;
let saveTimer = null;
const inflight = new Map();
const retryState = new Map();
let active = 0;
const queue = [];

function loadCache() {
  if (cache) return cache;
  cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data && typeof data === 'object' && data.entries) cache = data.entries;
    }
  } catch (e) {
    console.warn('[traits] cache load failed:', e.message);
    cache = {};
  }
  return cache;
}
function saveCacheSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const tmp = CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: cache }));
      fs.renameSync(tmp, CACHE_FILE);
    } catch (e) {
      console.warn('[traits] cache save failed:', e.message);
    }
  }, 400);
}
function keyOf(name) { return String(name || '').trim().toLowerCase(); }
function sheetKeyOf(sheet) {
  const s = PC.normalizeSheet(sheet);
  return [s.race, s.class, s.sex].map((v) => String(v || '').toLowerCase().trim()).join('|');
}
function compactOne(fp) {
  if (!fp) return null;
  const r = (a) => a.map((x) => Math.round(x * 100) / 100);
  return { alpha: r(fp.alpha), lum: r(fp.lum), col: fp.col.map((x) => Math.round(x)) };
}
function compactFingerprint(fp) {
  if (!fp) return null;
  if (fp.d) return { d: compactOne(fp.d), c: compactOne(fp.c) };
  return { d: compactOne(fp), c: null };
}
function publicEntry(e) {
  if (!e) return null;
  return { name: e.name, traits: e.traits || null, salt: e.salt >>> 0, variant: e.variant | 0, source: e.source || 'pending', attempts: e.attempts || 0 };
}
function randomSalt() { return (Math.floor(Math.random() * 0xffffffff) >>> 0); }

function ensureEntry(sheet) {
  loadCache();
  const s = PC.normalizeSheet(sheet);
  const key = keyOf(s.name);
  if (!key) return null;
  let e = cache[key];
  const sk = sheetKeyOf(s);
  if (!e) {
    e = cache[key] = { name: s.name, sheetKey: sk, sheet: compactSheet(s), salt: randomSalt(), variant: 0, source: 'pending', attempts: 0, createdAt: Date.now() };
    saveCacheSoon();
  } else if (e.sheetKey !== sk && e.source !== 'llm') {
    e.sheetKey = sk; e.sheet = compactSheet(s);
  }
  return e;
}
function compactSheet(s) {
  return { name: s.name, sex: s.sex, race: s.race, class: s.class, level: s.level, equipped: s.equipped, isMonster: !!s.isMonster, role: s.role };
}

function buildMessages(sheet, problems) {
  const s = PC.normalizeSheet(sheet);
  const schema = PC.traitSchemaDescription();
  const sys = [
    'You are the art director for a dark-fantasy pixel-art RPG. Convert a free-text character sheet into a JSON visual trait spec',
    'for a 48x48 front-facing procedural sprite. Races and classes are often invented compound words: interpret their parts',
    '(e.g. "Sandwraith Drakespawn" = sand-coloured, wraith-like translucent tattered lower body, with drake horns, scales, tail and wings;',
    '"-kin/-spawn/-born" usually means a humanoid with the creature\'s traits). Pick the bodyPlan that best fits the creature:',
    'humanoid, beast (quadruped), serpent, insectoid, spider, ooze (amorphous blob / floating eye), elemental, spectral (floating ghost),',
    'skeletal (undead bones), draconic (full dragon), giant. Choose strong, readable, distinctive hex colours that match the words',
    '(materials like shadow, glass, storm, blood, bone, gold, frost, flame, void, abyss). Outfit should match the class',
    '(casters/seers: robe, knights/warriors: plate or mail + helm, rogues/assassins: leather, clerics: tabard + holy symbol).',
    'The sprite is tiny (shown as a 24x24 C64-style token), so make the SILHOUETTE distinctive: prefer the creature features the words imply',
    '(horns, wings, tail, ears, mane, spikes, extra arms, beast head) and keep the face visible. Use a hood ONLY when the class or race',
    'explicitly suggests one (hooded, cowled, veiled, shrouded, assassin, wraith); otherwise show hair, horns or a helm. Monsters that are',
    'animals, spiders, oozes, elementals, wolves, wyrms or serpents must use that non-humanoid bodyPlan.',
    'items: exactly one entry per equipped slot that is not "None" (slot weapon/shield/armor/other), with type from the list and colours',
    'from the item name; set glow true for magical/elemental items. Do not invent weapons that are not equipped.',
    'Respond with ONE JSON object only, using exactly these keys and allowed values:',
    JSON.stringify(schema)
  ].join(' ');
  const user = {
    name: s.name, sex: s.sex, race: s.race, class: s.class, level: s.level,
    equipped: s.equipped, kind: s.isMonster ? 'monster' : (s.role === 'pc' ? 'player character' : 'npc')
  };
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: 'Character sheet:\n' + JSON.stringify(user) }];
  if (problems && problems.length) messages.push({ role: 'user', content: 'Your previous answer failed validation: ' + problems.join('; ') + '. Return a corrected JSON object.' });
  return messages;
}

async function callModelOnce(sheet, problems) {
  const c = getClient();
  if (!c) { const err = new Error('no OpenAI client / API key'); err.fatal = true; throw err; }
  const response = await c.chat.completions.create({
    model: MODEL,
    messages: buildMessages(sheet, problems),
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: 900
  });
  const text = response && response.choices && response.choices[0] && response.choices[0].message ? response.choices[0].message.content : '';
  let raw;
  try { raw = JSON.parse(text); } catch (e) { const err = new Error('invalid JSON'); err.problems = ['response was not valid JSON']; throw err; }
  const found = PC.validateTraitSpec(raw);
  if (found.length) { const err = new Error('validation failed'); err.problems = found; throw err; }
  return PC.normalizeTraitSpec(raw, sheet);
}

async function generateTraitsWithRetry(sheet) {
  let problems = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callModelOnce(sheet, problems);
    } catch (e) {
      if (e.fatal) return null;
      problems = e.problems || null;
      console.warn(`[traits] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${PC.normalizeSheet(sheet).name}: ${e.message}${problems ? ' (' + problems.join('; ') + ')' : ''}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt - 1)));
    }
  }
  return null;
}

function runQueued(fn) {
  return new Promise((resolve) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { resolve(null); } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENT) run(); else queue.push(run);
  });
}

// Uniqueness: both looks must be distinct - the detailed 3D sprite (PC fingerprint) AND the C64 2D token
// (renderCharacterSprite.traitSpriteFingerprint). Distances are normalised by their thresholds; the variant
// is re-rolled (up to 6x) until the closest cached character is >= 1 on both.
const DETAIL_THRESHOLD = 0.17;
const C64_THRESHOLD = 0.2;
let spriteLib = null;
function getSpriteLib() {
  if (spriteLib !== null) return spriteLib;
  try { spriteLib = require('../assets/renderCharacterSprite.js'); } catch (e) { spriteLib = false; }
  return spriteLib;
}
function c64Fingerprint(spec) {
  const lib = getSpriteLib();
  try { return lib && lib.traitSpriteFingerprint ? lib.traitSpriteFingerprint(spec) : null; } catch (e) { return null; }
}
function combinedFingerprint(spec) {
  return { d: PC.spriteFingerprint(spec), c: c64Fingerprint(spec) };
}
function closeness(fp, others) {
  let worst = Infinity;
  for (const o of others) {
    const od = o && o.d ? o.d : o;
    const dd = PC.fingerprintDistance(fp.d, od) / DETAIL_THRESHOLD;
    const dc = fp.c && o && o.c ? PC.fingerprintDistance(fp.c, o.c) / C64_THRESHOLD : Infinity;
    worst = Math.min(worst, dd, dc);
  }
  return worst;
}
function uniqueAgainstCache(entry, spec) {
  const others = Object.keys(cache)
    .filter((k) => k !== keyOf(entry.name) && cache[k].fingerprint)
    .slice(-200)
    .map((k) => cache[k].fingerprint);
  let best = spec, bestFp = combinedFingerprint(spec), bestD = others.length ? closeness(bestFp, others) : Infinity, rerolls = 0;
  for (let k = 1; k <= 6 && bestD < 1; k++) {
    const cand = PC.withVariant(spec, (spec.variant | 0) + k);
    const fp = combinedFingerprint(cand);
    const d = closeness(fp, others);
    rerolls = k;
    if (d > bestD) { best = cand; bestFp = fp; bestD = d; }
  }
  return { spec: best, fingerprint: bestFp, distance: bestD, rerolls };
}

function ensureTraitSpec(sheet, options) {
  const opts = options || {};
  const entry = ensureEntry(sheet);
  if (!entry) return Promise.resolve(null);
  const key = keyOf(entry.name);
  if (entry.source === 'llm' && entry.traits && entry.sheetKey === sheetKeyOf(sheet)) return Promise.resolve(entry);
  if (inflight.has(key)) return inflight.get(key);
  const p = runQueued(async () => {
    const traits = await generateTraitsWithRetry(sheet);
    if (!traits) {
      // No fallback look: the client keeps its placeholder until a real spec arrives.
      entry.attempts = (entry.attempts || 0) + MAX_ATTEMPTS;
      saveCacheSoon();
      scheduleBackgroundRetry(sheet, opts);
      return entry;
    }
    const spec = PC.buildProceduralSpriteSpec(sheet, traits, { salt: entry.salt, variant: 0, source: 'llm' });
    const r = uniqueAgainstCache(entry, spec);
    Object.assign(entry, {
      traits, variant: r.spec.variant, source: 'llm', sheetKey: sheetKeyOf(sheet), sheet: compactSheet(PC.normalizeSheet(sheet)),
      fingerprint: compactFingerprint(r.fingerprint), updatedAt: Date.now(), rerolls: r.rerolls
    });
    retryState.delete(key);
    saveCacheSoon();
    if (typeof opts.broadcast === 'function') {
      try { opts.broadcast({ type: 'characterTraits', traits: { [entry.name]: publicEntry(entry) } }); } catch (e) { /* ignore */ }
    }
    return entry;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function scheduleBackgroundRetry(sheet, opts) {
  const key = keyOf(PC.normalizeSheet(sheet).name);
  const st = retryState.get(key) || { n: 0, timer: null };
  if (st.timer) return;
  const delay = RETRY_DELAYS_MS[Math.min(st.n, RETRY_DELAYS_MS.length - 1)];
  st.n++;
  st.timer = setTimeout(() => {
    st.timer = null;
    ensureTraitSpec(sheet, opts);
  }, delay);
  if (st.timer.unref) st.timer.unref();
  retryState.set(key, st);
}

function getCachedTraitSpecs(names) {
  loadCache();
  const out = {};
  const keys = Array.isArray(names) && names.length ? names.map(keyOf) : Object.keys(cache);
  keys.forEach((k) => { if (cache[k]) out[cache[k].name] = publicEntry(cache[k]); });
  return out;
}

// Request specs for a batch of sheets: returns cached/pending entries immediately (salt is always assigned),
// kicks off generation for the rest. With wait=true resolves once generation finished (tests / previews).
async function requestTraitSpecs(sheets, options) {
  const opts = options || {};
  const list = (Array.isArray(sheets) ? sheets : []).filter((s) => s && (s.name || s.Name)).slice(0, 24);
  const promises = list.map((s) => {
    const e = ensureEntry(s);
    // reroll (character-creation 'Reroll Sprite'): same stats, new salt + a fresh LLM spec
    if (opts.reroll && e && !inflight.has(keyOf(e.name))) {
      Object.assign(e, { salt: randomSalt(), variant: 0, traits: null, source: 'pending', sheetKey: null, attempts: 0 });
    }
    return ensureTraitSpec(s, opts);
  });
  if (opts.wait) await Promise.all(promises);
  return getCachedTraitSpecs(list.map((s) => s.name || s.Name));
}

function ensureTraitSpecsForConsole(consoleText, broadcast) {
  try {
    const parsed = PC.parseConsoleCharacterSheets(consoleText);
    const fresh = parsed.all.filter((s) => {
      const e = loadCache()[keyOf(s.name)];
      return !(e && e.source === 'llm' && e.sheetKey === sheetKeyOf(s));
    });
    if (fresh.length) requestTraitSpecs(fresh, { broadcast });
    return fresh.length;
  } catch (e) {
    console.warn('[traits] console scan failed:', e.message);
    return 0;
  }
}

module.exports = { ensureTraitSpec, requestTraitSpecs, getCachedTraitSpecs, ensureTraitSpecsForConsole, buildMessages, CACHE_FILE };
