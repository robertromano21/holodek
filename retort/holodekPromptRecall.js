'use strict';
// holodek-1 only: retrieval over the long Grave Master prompt texts. Other models never call this.
// The long texts (lore, world guidance, story rules, local guide) are chunked once into labeled sections,
// embedded with the game's existing local MiniLM service (memorySemantic) and cached on disk by that service.
// Per request the top sections for the player input, room and active task are injected under a fixed budget.
// A lexical ranking is used whenever the embedder is missing, errors or is slower than TIMEOUT_MS.
const fs = require('node:fs'), path = require('node:path');
const BUDGET_CHARS = 6000;   // ~1,500 tokens (o200k averages ~4 chars/token on this text)
const SIDE_BUDGET_CHARS = 2400; // ~600 tokens for isolated side tasks
const TIMEOUT_MS = 2500;
const COTG = /Children of the Grave|Mortacia|Tartarus|Sepulchra|Hades|underworld/i;
let chunks = null, warming = null;

function render(strings, values) {
  if (!Array.isArray(strings) || !strings.raw) return String(strings ?? '');
  return strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ''), '');
}
function capture(fill) {
  const parts = [];
  const $ = { user: (s, ...v) => { parts.push(render(s, v)); return Promise.resolve(); } };
  try { fill($); } catch { /* partial capture is still useful */ }
  return parts;
}
function split(source, text) {
  const out = [];
  let buf = '';
  const flush = () => { const t = buf.trim(); if (t.length > 40) out.push(t); buf = ''; };
  for (const para of String(text).replace(/\r/g, '').split(/\n\s*\n|\n(?=#+ )|\n(?=[A-Z][A-Za-z ]{2,40}:\s*\n)/)) {
    const p = para.replace(/[ \t]+/g, ' ').trim();
    if (!p) continue;
    if (buf && buf.length + p.length > 900) flush();
    if (p.length > 1100) { // long paragraphs: pack whole sentences into ~900-char sections
      flush();
      for (const sentence of p.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [p]) { if (buf.length + sentence.length > 900) flush(); buf += sentence; }
      flush(); continue;
    }
    buf += (buf ? '\n' : '') + p;
  }
  flush();
  return out.map((text, i) => ({ id: `${source}#${i + 1}`, source, text, cotg: source !== 'guide' && COTG.test(text) }));
}
function build() {
  if (chunks) return chunks;
  const Prompts = require('./graveMasterStoryPrompts');
  const list = [];
  const lore = capture($ => Prompts.appendOriginal($, { full: true }));
  // lore[0] is the world guidance, which varies by setting; it is not cached here.
  list.push(...split('lore', lore.slice(1).join('\n\n')));
  const stub = { getRoomNameDatabase: () => '{}', getCurrentQuest: () => '', getCurrentTasks: () => [], getCurrentTaskIndex: () => 0 };
  const story = capture($ => Prompts.appendStory($, { roomName: 'the current room', currentSituation: 'x', updatedGameConsole: '',
    sharedState: stub, parseNpcPartyNamesFromConsole: () => [], full: true }));
  list.push(...split('story', story.join('\n\n')));
  try { list.push(...split('guide', fs.readFileSync(path.join(__dirname, '..', 'prompts', 'grave-master-local.md'), 'utf8'))); } catch {}
  const seen = new Set();
  chunks = list.filter(c => !seen.has(c.text) && seen.add(c.text));
  return chunks;
}
function cotgPlay() { try { return require('./settingLayer').isCotGPlay() === true; } catch { return false; } }
function pool() { const cotg = cotgPlay(); return build().filter(c => cotg || (c.source !== 'lore' && !c.cotg)); } // outside CotG: no lore at all
const STOP = new Set('the and for with that this from your you are was not but any all its into has have will can may must only each their them they who what when where how about also than then there these those our out one per room player'.split(' '));
const words = s => (String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOP.has(w));
function lexical(query, rows) {
  const q = new Set(words(query)), df = new Map();
  for (const r of rows) for (const w of new Set(words(r.text))) df.set(w, (df.get(w) || 0) + 1);
  const scores = new Map();
  for (const r of rows) {
    let s = 0; for (const w of new Set(words(r.text))) if (q.has(w)) s += Math.log(1 + rows.length / df.get(w));
    scores.set(r.id, s / Math.sqrt(1 + r.text.length / 400));
  }
  return scores;
}
async function semantic(query, rows) {
  const records = rows.map(r => ({ id: r.id, text: r.text, speaker: r.id, kind: 'prompt-section', runId: 'holodek-prompts', roomKey: r.id, turn: 0 }));
  const ranked = require('./memorySemantic').rank(query, records);
  let timer;
  const result = await Promise.race([ranked, new Promise(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); })]);
  clearTimeout(timer);
  if (!result && !warming) warming = ranked.finally(() => { warming = null; }); // keep embedding in the background
  return result && result.size ? result : null;
}
function queryFrom({ userInput = '', consoleText = '', task = null, focus = '' } = {}) {
  const c = String(consoleText || '');
  const room = (c.match(/^Room Name:[ \t]*(.*)$/m) || [])[1] || '';
  const desc = ((c.match(/^Room Description:[ \t]*(.*)$/m) || [])[1] || '').slice(0, 400);
  const t = task ? `${task.type || ''} ${task.desc || ''}` : '';
  return [focus, userInput, room, desc, t].filter(Boolean).join('\n').slice(0, 1200);
}
async function select(opts = {}) {
  const budget = opts.budget || BUDGET_CHARS, rows = pool(), query = queryFrom(opts);
  if (!rows.length || !query.trim()) return { text: '', ids: [], method: 'none' };
  let scores = null, method = 'semantic';
  try { scores = await semantic(query, rows); } catch { scores = null; }
  if (!scores) { scores = lexical(query, rows); method = 'lexical'; }
  const picked = []; let used = 0;
  for (const r of [...rows].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1))) {
    if ((scores.get(r.id) ?? 0) <= 0) break;
    if (used + r.text.length > budget) continue;
    picked.push(r); used += r.text.length;
  }
  const text = picked.length ? 'Reference sections (use only if relevant; the rules above and the Current Game Console take priority):\n' +
    picked.map(r => `[${r.id}]\n${r.text}`).join('\n\n') : '';
  console.info('[HolodekPromptRecall]', JSON.stringify({ method, chunks: rows.length, picked: picked.map(r => r.id), chars: text.length }));
  return { text, ids: picked.map(r => r.id), method };
}
async function inject($, opts = {}) {
  try { const { text } = await select(opts); if (text) await $.user(text); } catch (e) { console.warn('[HolodekPromptRecall] skipped:', e.message); }
}
module.exports = { build, pool, select, inject, lexical, queryFrom, BUDGET_CHARS, SIDE_BUDGET_CHARS };
