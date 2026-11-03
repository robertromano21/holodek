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
const worldOf=db=>db?.['0,0,0']?.setting||require('./settingLayer').current();
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
  const world=worldOf(db),lore=world?JSON.stringify(world):loreText();
  for (const para of lore.split(/\n+|(?<=\.)\s{1,2}(?=[A-Z])/)) if (para.trim().length > 30) out.push({ source: 'lore', text: para.trim().slice(0, CAP.snippetChars) });
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
  if(client===undefined&&require('./gameModels').current().provider==='local')return fallback();
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
  const world=worldOf(db);
  if(!world)try { for (const n of Object.keys(require('../assets/shrineIconography').pantheon || {})) names.add(n); } catch { /* optional */ }
  for (const room of Object.values(db || {})) {
    const residents=room?.inhabitants||room?.population?.inhabitants||[];
    for (const i of Array.isArray(residents)?residents:Object.values(residents.actors||{})) if (typeof i?.name === 'string') names.add(i.name);
    for (const c of room?.roomCast?.members || room?.cast || []) if (typeof c?.name === 'string') names.add(c.name);
  }
  if(!world)for (const n of (loreText().match(/\b[A-Z][a-z]{3,}(?: [A-Z][a-z]{3,})?\b/g) || []).slice(0, 400)) names.add(n);
  for(const r of Object.values(db||{}))for(const book of r?.readables||[])if(book.author)names.add(book.author);
  return names;
}
function storeFacts(db, facts, bookTitle) {
  const root = db['0,0,0'] ||= {};
  root.bookFacts ||= [];
  for (const t of facts || []) if (typeof t === 'string' && t.trim()) root.bookFacts.push({ text: t.trim(), book: bookTitle, at: Date.now() });
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
Write an original in-world title (no real books, authors, games or people), the author ONLY if a writer is established in the supplied canon (otherwise "Anonymous" or "Unknown"), ${ctx.world?'writtenYear: a year and calendar belonging to this saved world, or "Unknown" if none is established. Do not import another setting\'s calendar or gods':'publishedSR: the year of writing in Surface Reckoning (integer 1..899, before the present year)'}, an authored backstory, and ${ctx.contents?.length?`exactly these existing chapter titles, in order: ${JSON.stringify(ctx.contents)}`:'a table of contents of 4..9 original chapter titles about relevant local life, history or discoveries'}. ${ctx.world?'World: '+JSON.stringify({name:ctx.world.name,genres:ctx.world.genres,realm:ctx.world.realm}):'This is Children of the Grave; its established underworld history can inform this book.'} Different books and new games have fresh titles, voices and subjects. Seed: ${JSON.stringify(ctx.seed)}.${avoid} Optionally up to 3 NEW background facts. Never promise new exits, quest rewards, usable spells, hidden keys or engine events.`);
  const r = await Contracts.request($, { component: 'book-cover', maxTokens: 900, parameters: { title: Contracts.text(90), author: Contracts.text(60),
    ...(ctx.world?{writtenYear:Contracts.text(80)}:{publishedSR:{type:Number,minimum:1,maximum:899}}),
    backstory: Contracts.text(300), contents: {type:[{type:String,minLength:ctx.contents?.length?1:3,maxLength:70}],minItems:ctx.contents?.length||4,maxItems:ctx.contents?.length||9},
    newFacts: {type:[{type:String,maxLength:300}],maxItems:3} }, validate: v => validateCover(v, ctx) });
  if (!r.value) throw Error('Book cover was not generated: ' + (r.error?.message || 'invalid'));
  return r.value;
}
function validateCover(v, ctx) {
  if (!v || typeof v.title !== 'string' || !v.title.trim() || /[<>\r\n]/.test(v.title)) throw Error('Invalid book title.');
  if(ctx?.world){if(typeof v.writtenYear!=='string'||!v.writtenYear.trim()||/[<>\r\n]/.test(v.writtenYear)||/Surface Reckoning|\bS\.R\./i.test(v.writtenYear))throw Error('Use this world\'s own written year/calendar, or Unknown.');}
  else if (!Number.isInteger(v.publishedSR) || v.publishedSR < 1 || v.publishedSR > 899) throw Error('Publication year must be an integer Surface Reckoning year 1..899.');
  if (!Array.isArray(v.contents) || v.contents.length < (ctx?.contents?.length||4) || v.contents.length > (ctx?.contents?.length||9) || v.contents.some(t => typeof t !== 'string' || !t.trim() || /[<>\r\n]/.test(t))) throw Error('Contents must list the requested chapter titles.');
  if(ctx?.contents?.length&&JSON.stringify(v.contents)!==JSON.stringify(ctx.contents))throw Error('Preserve the existing authored chapter titles.');
  if (ctx?.avoid?.some(t => key(t) === key(v.title))) throw Error('That title was used in an earlier game; choose a new one.');
  const author = ctx?.authors?.has(String(v.author || '').trim()) ? v.author.trim() : 'Anonymous';
  return { title: v.title.trim(), author, ...(ctx?.world?{writtenYear:v.writtenYear.trim()}:{publishedSR:v.publishedSR}), backstory: String(v.backstory || '').trim(), contents: v.contents.map(t => t.trim()), newFacts: (v.newFacts || []).slice(0, 3) };
}
async function chapterWith($, ctx) {
  await $.user(`BOOK CHAPTER. Book: ${JSON.stringify({ title: ctx.record.title, author: ctx.record.author, published: ctx.record.published, contents: ctx.record.chapters.map(c => c.title) })}. Write a significant part of chapter ${ctx.chapter}: ${JSON.stringify(ctx.record.chapters[ctx.chapter - 1].title)} as several complete paragraphs in the book's voice, consistent with earlier chapters ${JSON.stringify(ctx.record.chapters.filter(c => c.text).map(c => c.text.slice(0, 200)))} and with this canon (may foreshadow, never contradict): ${JSON.stringify(ctx.facts)}. No real authors, books, games or people. Optionally up to 3 NEW facts this chapter establishes.`);
  const r = await Contracts.request($, { component: 'book-chapter', maxTokens: 1600, parameters: { text: Contracts.text(CAP.chapterMax), newFacts: [{ type: String, maxLength: 300 }] },
    validate: v => { if (typeof v?.text !== 'string' || !v.text.trim()) throw Error('Chapter text must contain authored prose.'); return { text: v.text.trim(), newFacts: (v.newFacts || []).slice(0, 3) }; } });
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
  const I=require('../assets/dungeonInhabitants');
  for(const a of [...I.parseSheets(consoleText,'PC'),...I.parseSheets(consoleText,'NPCs in Party')])if(a.hp>0&&a.equipped?.Other)inv.push(key(a.equipped.Other));
  const floor = String(consoleText.match(/^Objects in Room:[ \t]*([^\r\n]*)/m)?.[1] || '').split(',').map(key);
  const name = action.name.replace(/^the /, '');
  const existing = findRecord(db, name);
  if(existing&&!['book','spellbook'].includes(existing.record.kind)&&!existing.record.bookLore)return null;
  const shelf = Library.find(dungeon, name);
  if (!existing && !shelf && !(Library.isBookName(name) && (inv.includes(name) || floor.includes(name)))) return null;
  return { action, name, existing, shelf, owned: inv.includes(name) };
}
const pending=new WeakMap();
function ensure(state,input,consoleText,options){
  const previous=pending.get(state)||Promise.resolve(),work=previous.catch(()=>{}).then(()=>ensureUnlocked(state,input,consoleText,options));
  pending.set(state,work);const clear=()=>{if(pending.get(state)===work)pending.delete(state);};work.then(clear,clear);return work;
}
async function ensureUnlocked(state, input, consoleText, { run, client, now = Date.now } = {}) {
  if (!Flags.on('LIBRARY_BOOKS')) return { status: 'off' };
  const coords = state.getLastCoords(), geoKey = `${coords.x},${coords.y},${coords.z}`;
  const db = JSON.parse(state.getRoomNameDatabase() || '{}'), dungeon = state.getRoomDungeon?.(coords);
  const hit = locate({ input, consoleText, db, geoKey, dungeon }); if (!hit) return { status: 'not-a-book' };
  const runId = state.getDungeonRunId?.() || 'run';
  // Refuse remote reading before spending any model work. The normal reader remains the reach authority.
  const access=()=>{
    if(!state.getCombatCharactersString)return;
    const actor=JSON.parse(state.getCombatCharactersString()||'[]').find(a=>a.type==='pc');
    const stub=hit.existing?.record||{id:'cover-check',name:hit.name,kind:'book',title:hit.name,chapters:[],bookLore:{pending:true,...(hit.shelf?{shelf:hit.shelf.shelfKey}:{})}};
    const preview=structuredClone(JSON.parse(state.getRoomNameDatabase()||'{}'));
    if(!hit.existing){(preview[geoKey]||={}).readables||=[];preview[geoKey].readables.push(stub);}
    const plan=require('./readableActions').prepare({input:'inspect '+hit.name,consoleText:state.getUpdatedGameConsole?.()||consoleText,database:preview,
      dungeon:state.getRoomDungeon?.(coords),actor,geoKey});
    if(!plan?.allowed)throw Error(plan?.message||'That book is not available here.');
  };
  access();
  const runner = run || defaultRunner(state);
  let record = hit.existing?.record, sourceKey = hit.existing?.sourceKey || geoKey, generated = null;
  if (!record||record.bookLore?.pending||!record.bookLore) {
    const query = `${hit.name} in ${db[geoKey]?.name || geoKey}; ${db[geoKey]?.description || ''}`.slice(0, 600);
    const retrieval = await retrieve(db, query, { client });
    const ctx = { name: hit.name, roomName: db[geoKey]?.name || geoKey, facts: retrieval.facts, avoid: Memory.avoid(runId, 'bookTitles', 40), authors: knownNames(db),
      world:worldOf(db),seed:runId+':'+geoKey+':'+hit.name,contents:record?.chapters?.map(c=>c.title) };
    const cover = await runner($ => coverWith($, ctx));
    const kind = /scroll/.test(hit.name) ? 'scroll' : /spellbook|grimoire/.test(hit.name) ? 'spellbook' : 'book';
    record = {id:'lore_'+require('node:crypto').createHash('sha1').update(`${runId}:${geoKey}:${hit.name}`).digest('hex').slice(0,10),
      name:hit.name,kind,role:'lore',clueChapter:1,modifiers:{attack_modifier:0,damage_modifier:0,ac:0,magic:0},spellRefs:[],...record,
      title:cover.title,backstory:cover.backstory,author:cover.author,published:cover.writtenYear||`${cover.publishedSR} S.R.`,
      ...(cover.publishedSR?{publishedSR:cover.publishedSR}:{}),
      chapters:record?.chapters?.length?record.chapters:cover.contents.map(title=>({title,text:''})),
      bookLore:{version:2,at:now(),retrieval:retrieval.method,...(hit.shelf?{shelf:hit.shelf.shelfKey,slot:hit.shelf.id}:{})}};
    (db[sourceKey] ||= {}).readables ||= [];const old=db[sourceKey].readables.findIndex(b=>key(b.name)===key(record.name));
    if(old>=0)db[sourceKey].readables[old]=record;else db[sourceKey].readables.push(record);
    storeFacts(db, cover.newFacts, record.title);
    generated = { kind: 'cover', retrieval: retrieval.method, facts: retrieval.facts.length };
  }
  if (hit.action.chapter && Number.isInteger(hit.action.chapter)&&hit.action.chapter>=1&&record.bookLore && !record.chapters[hit.action.chapter - 1]?.text && hit.action.chapter <= record.chapters.length) {
    const retrieval = await retrieve(db, `${record.title}: ${record.chapters[hit.action.chapter - 1].title}. ${record.backstory}`, { client });
    const chapter = await runner($ => chapterWith($, { record, chapter: hit.action.chapter, facts: retrieval.facts }));
    record.chapters[hit.action.chapter - 1].text = chapter.text;
    storeFacts(db, chapter.newFacts, record.title);
    generated = { kind: 'chapter', chapter: hit.action.chapter, retrieval: retrieval.method, facts: retrieval.facts.length };
  }
  if (generated) {
    const current=state.getLastCoords();
    if(state.getDungeonRunId?.()!==runId||`${current.x},${current.y},${current.z}`!==geoKey)throw Error('The game changed before the reading finished.');
    access();
    // Merge just this book and new book facts into fresh state, never overwrite unrelated room work.
    const latest=JSON.parse(state.getRoomNameDatabase()||'{}');(latest[sourceKey]||={}).readables||=[];
    const index=latest[sourceKey].readables.findIndex(b=>key(b.name)===key(record.name));
    if(index>=0)latest[sourceKey].readables[index]=record;else latest[sourceKey].readables.push(record);
    const priorFacts=new Set((latest['0,0,0']?.bookFacts||[]).map(f=>f.book+':'+f.text));
    for(const f of db['0,0,0']?.bookFacts||[])if(!priorFacts.has(f.book+':'+f.text))storeFacts(latest,[f.text],f.book);
    Memory.record(runId,'bookTitles',[record.title]);Memory.persist(latest);state.setRoomNameDatabase(JSON.stringify(latest));
  }
  return { status: generated ? 'generated' : 'cached', ...(generated || {}), name: hit.name, title: record.title, sourceKey };
}
module.exports = { ensure, retrieve, keywordSearch, corpus, normalize, validateCover, knownNames, storeFacts, locate, CAP, RETRIEVAL_MODEL };
