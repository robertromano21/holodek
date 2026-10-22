'use strict';
// Reference extract of the agent-mode transport: queue <id>.req.json, wait for <id>.res.json, validate with the real contract from tools/playtest/capture.cjs (the active implementation, loaded with node -r).
// Kept as a separate readable file; capture.cjs does not require it. Contains no keys.
const fs = require('fs'), path = require('path');
const RUN = process.env.PLAYTEST_RUN || path.join(process.cwd(), 'playtest-run');
const redact = s => String(s).replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-REDACTED');
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
module.exports = { agentAnswer, MECHANICAL, QUEUE };
