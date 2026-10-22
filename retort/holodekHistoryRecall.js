'use strict';
// holodek-1 only: per-turn conversation history = last KEEP exchanges verbatim + MiniLM-ranked older exchanges
// (chronological, labeled) under BUDGET_CHARS. Embeddings are cached by text hash in memorySemantic, so each turn
// is embedded once. Lexical ranking is used when the embedder errors or takes longer than TIMEOUT_MS.
const KEEP = 3, BUDGET_CHARS = 6000, TIMEOUT_MS = 2500; // ~1,500 tokens of older moments
const crypto = require('node:crypto');
function parse(narrative) {
  const msgs = []; let cur = null;
  for (const line of String(narrative || '').split('\n')) {
    const m = line.match(/^\$\.(user|assistant) `(\S.*)$/);
    if (m) { if (cur) msgs.push(cur); cur = { role: m[1], text: m[2] }; }
    else if (cur) cur.text += '\n' + line;
  }
  if (cur) msgs.push(cur);
  for (const m of msgs) m.text = m.text.replace(/`\s*$/, '').trim();
  const pairs = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') { const u = msgs[i].text; let a = ''; if (msgs[i + 1]?.role === 'assistant') { a = msgs[i + 1].text; i++; } pairs.push({ user: u, assistant: a }); }
    else pairs.push({ user: '', assistant: msgs[i].text });
  }
  return pairs;
}
const render = (label, p) => `$.user \`${label} ${p.user || '(continue)'}\`\n$.assistant \`${p.assistant || '(no reply recorded)'}\``;
async function rank(query, rows) {
  const P = require('./holodekPromptRecall');
  try {
    const records = rows.map(r => ({ id: r.id, text: r.text, kind: 'history-turn', runId: 'holodek-history', roomKey: r.id, turn: 0 }));
    let timer; const ranked = require('./memorySemantic').rank(query, records);
    const res = await Promise.race([ranked, new Promise(r => { timer = setTimeout(() => r(null), TIMEOUT_MS); })]); clearTimeout(timer);
    if (res && res.size) return { scores: res, method: 'semantic' };
  } catch {}
  return { scores: P.lexical(query, rows), method: 'lexical' };
}
async function select(narrative, { userInput = '', consoleText = '', task = null, keep = KEEP, budgetChars = BUDGET_CHARS } = {}) {
  const pairs = parse(narrative);
  if (!pairs.length) return String(narrative || '');
  const recent = pairs.slice(-keep), older = pairs.slice(0, Math.max(0, pairs.length - keep));
  let picked = [], method = 'none';
  if (older.length) {
    const rows = older.map((p, i) => ({ i, id: 'h' + crypto.createHash('sha1').update(p.user + '\n' + p.assistant).digest('hex').slice(0, 16), text: `${p.user}\n${p.assistant}`.slice(0, 1600) }));
    const query = require('./holodekPromptRecall').queryFrom({ userInput, consoleText, task });
    const r = await rank(query, rows); method = r.method;
    let used = 0;
    for (const row of [...rows].sort((a, b) => (r.scores.get(b.id) ?? -1) - (r.scores.get(a.id) ?? -1))) {
      if ((r.scores.get(row.id) ?? 0) <= 0) break;
      const len = row.text.length + 60; if (used + len > budgetChars) continue;
      picked.push(row); used += len;
    }
    picked.sort((a, b) => a.i - b.i);
  }
  const out = [...picked.map(row => render('[Earlier relevant moment]', older[row.i])), ...recent.map(p => render('[Recent turn]', p))].join('\n\n');
  console.info('[HolodekHistoryRecall]', JSON.stringify({ method, exchanges: pairs.length, recent: recent.length, older: older.length, picked: picked.map(r => r.i), inChars: String(narrative).length, outChars: out.length }));
  return out;
}
module.exports = { select, parse, KEEP, BUDGET_CHARS };
