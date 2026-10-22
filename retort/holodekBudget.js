'use strict';
// holodek-1 only: reserve answer space inside the installed Ollama context.
// Estimate: chars / 3.5 (conservative vs o200k ~4.2 chars/token on this game's prose; JSON runs denser).
// Trim order: older retrieved history pairs, retrieved prompt sections, campaign memory, oldest recent turns (keep 1).
// System messages, the console and the latest user input are never removed.
const CONTEXT = 4096, ANSWER = 1024, SAFETY = 256;
const CEILING = CONTEXT - ANSWER - SAFETY, CHARS_PER_TOKEN = 3.5;
const est = s => Math.ceil(String(s ?? '').length / CHARS_PER_TOKEN);
const text = m => typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
const MEMORY = /\n*=== RELEVANT CAMPAIGN MEMORY \(holodek-1\) ===[\s\S]*?=== END MEMORY ===\n?/;
function kind(m) {
  const t = text(m);
  if (m.role === 'system') return 'system';
  if (m.role === 'user' && t.startsWith('[Earlier relevant moment]')) return 'earlier';
  if (m.role === 'user' && t.startsWith('[Recent turn]')) return 'recent';
  if (m.role === 'user' && t.startsWith('Reference sections (')) return 'refs';
  return 'other';
}
function tally(msgs, tools) {
  const p = { system: 0, earlier: 0, recent: 0, refs: 0, memory: 0, other: 0, tools: tools?.length ? est(JSON.stringify(tools)) : 0 };
  msgs.forEach((m, i) => {
    let k = kind(m); const prev = msgs[i - 1];
    if (m.role === 'assistant' && prev && ['earlier', 'recent'].includes(kind(prev))) k = kind(prev);
    const t = text(m), mem = t.match(MEMORY)?.[0] || '';
    p[k] += est(mem ? t.replace(mem, '') : t) + 4; p.memory += est(mem);
  });
  p.total = Object.values(p).reduce((a, b) => a + b, 0);
  return p;
}
function dropPair(msgs, label, keep) {
  const idx = msgs.map((m, i) => kind(m) === label ? i : -1).filter(i => i >= 0);
  if (idx.length <= keep) return false;
  const i = idx[0]; msgs.splice(i, msgs[i + 1]?.role === 'assistant' ? 2 : 1); return true;
}
function enforce(messages, tools, { ceiling = CEILING, log = console.info } = {}) {
  if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > CEILING) throw Error('Invalid holodek-1 input budget.');
  const msgs = messages.map(m => ({ ...m })), before = tally(msgs, tools), trimmed = [];
  const over = () => tally(msgs, tools).total > ceiling;
  while (over() && dropPair(msgs, 'earlier', 0)) trimmed.push('earlier');
  while (over()) { const i = msgs.findIndex(m => kind(m) === 'refs'); if (i < 0) break; msgs.splice(i, 1); trimmed.push('refs'); }
  if (over()) msgs.forEach((m, i) => { if (typeof m.content === 'string' && MEMORY.test(m.content)) { msgs[i] = { ...m, content: m.content.replace(MEMORY, '') }; trimmed.push('memory'); } });
  while (over() && dropPair(msgs, 'recent', 1)) trimmed.push('recent');
  // Completed work orders are history, not instructions for the next task. Keep
  // system rules, the newest console and the entire unfinished instruction tail.
  const tail = msgs.findLastIndex((m, i) => i < msgs.length - 1 && m.role === 'assistant');
  const consoleAt = msgs.findLastIndex(m => /^(?:Current Game Console:|Updated Game Console:|Room Name:)/m.test(text(m)));
  const protectedMessages = new Set(msgs.filter((m, i) => m.role === 'system' || i > tail || i === consoleAt ||
    /^(?:You are the Grave Master|\[WORLD:|\[CHILDREN-OF-THE-GRAVE\])/.test(text(m))));
  while (over()) {
    const i = msgs.findIndex(m => !protectedMessages.has(m));
    if (i < 0) break;
    msgs.splice(i, 1); trimmed.push('completed-work');
  }
  const after = tally(msgs, tools);
  const counts = trimmed.reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {});
  log('[holodek-1 budget]', JSON.stringify({ context: CONTEXT, answerReserve: ANSWER, safety: SAFETY,
    ceiling, before: before.total, after: after.total, parts: after, trimmed: counts, overCeiling: after.total > ceiling }));
  if (after.total > ceiling) throw Object.assign(Error(`holodek-1 context budget exceeded: this work order needs about ${after.total} input tokens; at most ${ceiling} fit while reserving ${ANSWER} answer tokens in the ${CONTEXT}-token context. Split the work order; no prompt was silently truncated.`), { code: 'HOLODEK_CONTEXT_BUDGET' });
  return msgs;
}
function prepare(body, options = {}) {
  const schema = body.tools?.length ? body.tools : body.response_format ? [{ response_format: body.response_format }] : undefined;
  return { ...body, max_tokens: Math.min(body.max_tokens || ANSWER, ANSWER),
    messages: enforce(body.messages, schema, options) };
}
module.exports = { enforce, prepare, tally, est, CEILING, CONTEXT, ANSWER, SAFETY };
