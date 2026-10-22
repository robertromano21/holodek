'use strict';
// world1 LIBRARY_BOOKS: any book in the game (shelf, inventory, loot, quest item) is readable on demand.
// Action 1 (first open) generates ONLY the cover: title, author, Surface Reckoning date, table of contents.
// Each later "read chapter N" generates ONLY that chapter. Results are cached on the book record in the save.
// Before each generation a cheap retrieval step selects relevant canon facts (mini model, keyword fallback),
// and newly invented facts are written back to the save so later books stay consistent.
const Flags = require('./worldFlags');
const Contracts = require('./generationContracts');
const R = require('../assets/readableItems');
const Library = require('../assets/libraryBooks');
const Memory = require('./crossGameMemory');
const key = v => String(v || '').trim().toLowerCase();
const CAP = { snippets: 60, snippetChars: 320, contextChars: 2400, facts: 240, chapterMin: 900, chapterMax: 4200 };
const FACT_KEYS = /name|title|description|history|lore|story|text|label|backstory|myth|hook|summary|legend|deed|fact/i;
const RETRIEVAL_MODEL = () => process.env.HOLODEK_RETRIEVAL_MODEL || 'gpt-4.1-nano';
// ---- Intent: "read the X", "read chapter 3 of X", "I want to read chapter 3 in the X" ----
function normalize(input) {
  const s = String(input || '').trim().replace(/[.!?]+$/, '');
  const m = /\b(?:read|open|study)\b.*?\bchapter\s+(\d+)\s+(?:of|in|from)\s+(?:the\s+)?(.+)$/i.exec(s);
  if (m && !/^read\s+chapter/i.test(s)) return `read chapter ${m[1]} of ${m[2]}`;
  const o = /^(?:open|study|i (?:want|would like) to read)\s+(?:the\s+)?(.+)$/i.exec(s);
  return o ? `read ${o[1]}` : s;
}
// ---- Corpus: lore prompt + saved world state + earlier book facts ----
let loreCache = null;
function loreText() {
  if (loreCache !== null) return loreCache;
  const parts = [];
  try { const tag = (strings, ...v) => parts.push(strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i]) : ''), '')); const fake = { system: tag, user: tag, assistant: tag };
    require('./graveMasterStoryPrompts').appendOriginal(fake); } catch { /* lore prompt unavailable in this build */ }
  return (loreCache = parts.join('\n'));
}
function corpus(db) {
  const out = [];
  for (const para of loreText().split(/\n+|(?<=\.)\s{1,2}(?=[A-Z])/)) if (para.trim().length > 30) out.push({ source: 'lore', text: para.trim().slice(0, CAP.snippetChars) });
  for (const [roomKey, room] of Object.entries(db || {})) {
    let n = 0;
    const walk = (v, k, depth) => {
      if (n > 30 || depth > 5 || v == null) return;
      if (typeof v === 'string') { if (FACT_KEYS.test(k) && v.length >= 12 && v.length <= 600) { out.push({ source: roomKey, text: `${room?.name ? room.name + ': ' : ''}${v}`.slice(0, CAP.snippetChars) }); n++; } return; }
      if (Array.isArray(v)) { for (const x of v.slice(0, 20)) walk(x, k, depth + 1); return; }
      if (typeof v === 'object') for (const [kk, x] of Object.entries(v)) if (!/^(cells|tiles|layout|dungeon|illustration|plan|layers|voxels|crossGameHistory)$/.test(kk)) walk(x, kk, depth + 1);
    };
    walk(room, 'room', 0);
  }
  for (const f of db?.['0,0,0']?.bookFacts || []) out.push({ source: 'book-fact', text: String(f.text).slice(0, CAP.snippetChars) });
  return out;
}
function keywordSearch(snippets, query, limit = 10) {
  const words = [...new Set(key(query).split(/[^a-z0-9']+/).filter(w => w.length > 3))];
  return snippets.map((s, i) => ({ i, s, score: words.reduce((a, w) => a + (key(s.text).includes(w) ? 1 + (s.source === 'book-fact' ? .5 : 0) : 0), 0) }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.s);
}
function bound(facts) { const out = []; let n = 0; for (const f of facts) { const t = String(f.text || f).slice(0, CAP.snippetChars); if (n + t.length > CAP.contextChars) break; out.push(t); n += t.length; } return out; }
// Retrieval: keyword prefilter -> mini model selects/condenses relevant facts -> bounded. Falls back to keyword results.
async function retrieve(db, query, { client } = {}) {
  const pool = keywordSearch(corpus(db), query, CAP.snippets);
  const fallback = () => ({ method: 'keyword', facts: bound(pool.slice(0, 10)) });
  if (!pool.length) return { method: 'keyword', facts: [] };
  let c = client;
  if (c === undefined) try { c = require('./gameModels').getClient(); } catch { c = null; }
  if (!c) return fallback();
  try {
    const listing = pool.map((s, i) => `${i}. ${s.text}`).join('\n').slice(0, 14000);
    const r = await c.chat.completions.create({ model: RETRIEVAL_MODEL(), temperature: 0, max_tokens: 700, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'You retrieve facts from a game world memory. Return JSON {"facts":["..."]}: at most 8 short facts copied or condensed ONLY from the numbered notes that are relevant to the request. Never invent.' },
        { role: 'user', content: `Request: ${String(query).slice(0, 600)}\nNotes:\n${listing}` }] }, { timeout: 20000 });
    const facts = JSON.parse(r.choices?.[0]?.message?.content || '{}').facts;
    if (!Array.isArray(facts) || !facts.every(f => typeof f === 'string')) return fallback();
    return { method: 'mini-model', model: RETRIEVAL_MODEL(), facts: bound(facts) };
  } catch (error) { return { ...fallback(), error: String(error.message || error).slice(0, 120) }; }
}
// ---- Allowed authors: only names known in the saved world, else Anonymous/Unknown ----
function knownNames(db) {
  const names = new Set(['Anonymous', 'Unknown']);
  try { for (const n of Object.keys(require('../assets/shrineIconography').pantheon || {})) names.add(n); } catch { /* optional */ }
  for (const room of Object.values(db || {})) {
    for (const i of room?.inhabitants || room?.population?.inhabitants || []) if (typeof i?.name === 'string') names.add(i.name);
    for (const c of room?.roomCast?.members || room?.cast || []) if (typeof c?.name === 'string') names.add(c.name);
  }
  for (const n of (loreText().match(/\b[A-Z][a-z]{3,}(?: [A-Z][a-z]{3,})?\b/g) || []).slice(0, 400)) names.add(n);
  return names;
}
function storeFacts(db, facts, bookTitle) {
  const root = db['0,0,0'] ||= {};
  root.bookFacts ||= [];
  for (const t of facts || []) if (typeof t === 'string' && t.trim().length > 8) root.bookFacts.push({ text: t.trim().slice(0, 300), book: bookTitle, at: Date.now() });
  if (root.bookFacts.length > CAP.facts) root.bookFacts.splice(0, root.bookFacts.length - CAP.facts);
}
function findRecord(db, name) {
  for (const [sourceKey, room] of Object.entries(db || {})) { const r = (room?.readables || []).find(x => key(x.name) === key(name)); if (r) return { record: r, sourceKey }; }
  return null;
}
// ---- Generation (one model call per action) ----
async function coverWith($, ctx) {
  const avoid = ctx.avoid.length ? ` Avoid these titles used in earlier games: ${ctx.avoid.slice(0, 20).join('; ')}.` : '';
  await $.user(`BOOK COVER for an object in the established world. Object name: ${JSON.stringify(ctx.name)}; found in room ${JSON.stringify(ctx.roomName)}. Relevant canon (consistent, may foreshadow; never contradict): ${JSON.stringify(ctx.facts)}.
Write an original in-world title (no real books, authors, games or people), the author ONLY if a writer is established in the canon above or the setting's lore (otherwise "Anonymous" or "Unknown"), the year of writing in Surface Reckoning (an integer 1..899, before the present year), a backstory <=300 characters, and a table of contents of 4..9 chapter titles that hint at local history, rooms, cities, quests, deities (including Mortacia where fitting), artifacts and earlier histories.${avoid} Optionally up to 3 NEW facts this book establishes.`);
  const r = await Contracts.request($, { component: 'book-cover', maxTokens: 900, parameters: { title: Contracts.text(90), author: Contracts.text(60), publishedSR: { type: Number, minimum: 1, maximum: 899 },
    backstory: Contracts.text(300), contents: [{ type: String, minLength: 3, maxLength: 70 }], newFacts: [{ type: String, maxLength: 300 }] }, validate: v => validateCover(v, ctx) });
  if (!r.value) throw Error('Book cover was not generated: ' + (r.error?.message || 'invalid'));
  return r.value;
}
function validateCover(v, ctx) {
  if (!v || typeof v.title !== 'string' || !v.title.trim() || /[<>\r\n]/.test(v.title)) throw Error('Invalid book title.');
  if (!Number.isInteger(v.publishedSR) || v.publishedSR < 1 || v.publishedSR > 899) throw Error('Publication year must be an integer Surface Reckoning year 1..899.');
  if (!Array.isArray(v.contents) || v.contents.length < 4 || v.contents.length > 9 || v.contents.some(t => typeof t !== 'string' || !t.trim() || /[<>\r\n]/.test(t))) throw Error('Contents must list 4..9 chapter titles.');
  if (ctx?.avoid?.some(t => key(t) === key(v.title))) throw Error('That title was used in an earlier game; choose a new one.');
  const author = ctx?.authors?.has(String(v.author || '').trim()) ? v.author.trim() : 'Anonymous';
  return { title: v.title.trim(), author, publishedSR: v.publishedSR, backstory: String(v.backstory || '').trim().slice(0, 300), contents: v.contents.map(t => t.trim()), newFacts: (v.newFacts || []).slice(0, 3) };
}
async function chapterWith($, ctx) {
  await $.user(`BOOK CHAPTER. Book: ${JSON.stringify({ title: ctx.record.title, author: ctx.record.author, published: ctx.record.published, contents: ctx.record.chapters.map(c => c.title) })}. Write a significant part of chapter ${ctx.chapter}: ${JSON.stringify(ctx.record.chapters[ctx.chapter - 1].title)} as several paragraphs (${CAP.chapterMin}..${CAP.chapterMax} characters) in the book's voice, consistent with earlier chapters ${JSON.stringify(ctx.record.chapters.filter(c => c.text).map(c => c.text.slice(0, 200)))} and with this canon (may foreshadow, never contradict): ${JSON.stringify(ctx.facts)}. No real authors, books, games or people. Optionally up to 3 NEW facts this chapter establishes.`);
  const r = await Contracts.request($, { component: 'book-chapter', maxTokens: 1600, parameters: { text: Contracts.text(CAP.chapterMax), newFacts: [{ type: String, maxLength: 300 }] },
    validate: v => { if (typeof v?.text !== 'string' || v.text.trim().length < CAP.chapterMin) throw Error(`Chapter text must be ${CAP.chapterMin}..${CAP.chapterMax} characters of several paragraphs.`); return { text: v.text.trim(), newFacts: (v.newFacts || []).slice(0, 3) }; } });
  if (!r.value) throw Error('Book chapter was not generated: ' + (r.error?.message || 'invalid'));
  return r.value;
}
function defaultRunner(state) {
  const runtime = require('./graveMasterProtocol').runtimeFor(state);
  return work => runtime.run(runtime.retort(async $ => work($)));
}
// ---- Locate the book the input names: inventory, floor objects, existing readables or shelf books ----
function locate({ input, consoleText, db, geoKey, dungeon }) {
  const action = R.intent(normalize(input)); if (!action?.name) return null;
  const inv = String(consoleText.match(/^Inventory:[ \t]*([^\r\n]*)/m)?.[1] || '').split(',').map(key);
  const floor = String(consoleText.match(/^Objects in Room:[ \t]*([^\r\n]*)/m)?.[1] || '').split(',').map(key);
  const name = action.name.replace(/^the /, '');
  const existing = findRecord(db, name);
  if (existing && !existing.record.bookLore && R.hasContent(existing.record)) return null; // authored readables keep their own path
  const shelf = Library.find(dungeon, name);
  if (!existing && !shelf && !(Library.isBookName(name) && (inv.includes(name) || floor.includes(name)))) return null;
  return { action, name, existing, shelf, owned: inv.includes(name) };
}
async function ensure(state, input, consoleText, { run, client, now = Date.now } = {}) {
  if (!Flags.on('LIBRARY_BOOKS')) return { status: 'off' };
  const coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), dungeon = state.getRoomDungeon?.(coords);
  const hit = locate({ input, consoleText, db, geoKey, dungeon }); if (!hit) return { status: 'not-a-book' };
  const runId = state.getDungeonRunId?.() || 'run';
  const runner = run || defaultRunner(state);
  let record = hit.existing?.record, sourceKey = hit.existing?.sourceKey || geoKey, generated = null;
  if (!record) {
    const query = `${hit.name} in ${db[geoKey]?.name || geoKey}; ${db[geoKey]?.description || ''}`.slice(0, 600);
    const retrieval = await retrieve(db, query, { client });
    const ctx = { name: hit.name, roomName: db[geoKey]?.name || geoKey, facts: retrieval.facts, avoid: Memory.avoid(runId, 'bookTitles', 40), authors: knownNames(db) };
    const cover = await runner($ => coverWith($, ctx));
    const kind = /scroll/.test(hit.name) ? 'scroll' : /spellbook|grimoire/.test(hit.name) ? 'spellbook' : 'book';
    record = { id: 'lore_' + require('node:crypto').createHash('sha1').update(`${runId}:${geoKey}:${hit.name}`).digest('hex').slice(0, 10), name: hit.name, kind, title: cover.title,
      backstory: `${cover.author === 'Anonymous' || cover.author === 'Unknown' ? 'Author unknown' : 'By ' + cover.author}. Written ${cover.publishedSR} S.R. ${cover.backstory}`.trim(),
      author: cover.author, published: `${cover.publishedSR} S.R.`, publishedSR: cover.publishedSR, role: 'lore', clueChapter: 1, modifiers: { attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0 }, spellRefs: [],
      chapters: cover.contents.map(title => ({ title, text: '' })), bookLore: { version: 1, at: now(), retrieval: retrieval.method, ...(hit.shelf ? { shelf: hit.shelf.shelfKey, slot: hit.shelf.id } : {}) } };
    (db[sourceKey] ||= {}).readables ||= []; db[sourceKey].readables.push(record);
    storeFacts(db, cover.newFacts, record.title); Memory.record(runId, 'bookTitles', [record.title]);
    generated = { kind: 'cover', retrieval: retrieval.method, facts: retrieval.facts.length };
  } else if (hit.action.chapter && record.bookLore && !record.chapters[hit.action.chapter - 1]?.text && hit.action.chapter <= record.chapters.length) {
    const retrieval = await retrieve(db, `${record.title}: ${record.chapters[hit.action.chapter - 1].title}. ${record.backstory}`, { client });
    const chapter = await runner($ => chapterWith($, { record, chapter: hit.action.chapter, facts: retrieval.facts }));
    record.chapters[hit.action.chapter - 1].text = chapter.text;
    storeFacts(db, chapter.newFacts, record.title);
    generated = { kind: 'chapter', chapter: hit.action.chapter, retrieval: retrieval.method, facts: retrieval.facts.length };
  }
  if (generated) { Memory.persist(db); state.setRoomNameDatabase(JSON.stringify(db)); }
  return { status: generated ? 'generated' : 'cached', ...(generated || {}), name: hit.name, title: record.title, sourceKey };
}
module.exports = { ensure, retrieve, keywordSearch, corpus, normalize, validateCover, knownNames, storeFacts, locate, CAP, RETRIEVAL_MODEL };
