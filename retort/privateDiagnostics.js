'use strict';
function clean(value, limit = 1600) {
  let text = String(value ?? '');
  for (const name of ['OPENAI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'HOLODEK_OLLAMA_URL', 'HOLODEK_XAI_URL'])
    if (process.env[name]) text = text.split(process.env[name]).join('[redacted]');
  try {
    const fs = require('node:fs'), path = require('node:path');
    const file = path.join(process.env.HOLODEK_WEBSITE_AI_DIR || path.join(__dirname, '../.retort-data/website-ai'), 'connection.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const name of ['host', 'identityFile', 'fingerprint']) if (config[name]) text = text.split(config[name]).join('[redacted]');
  } catch { /* No private website configuration in isolated engines. */ }
  return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/\b(?:sk-|xai-|gsk_|npm_|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|token|access_token|password)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/(\b(?:authorization|(?:openai|xai|groq)_api_key|api[_-]?key|password)\b\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]').slice(0, limit);
}
function value(input, depth = 0) {
  if (depth > 6) return '[omitted]';
  if (typeof input === 'string') return clean(input, 1600);
  if (Array.isArray(input)) return input.slice(0, 32).map(v => value(v, depth + 1));
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).slice(0, 32).map(([k,v]) => [clean(k, 100), value(v, depth + 1)]));
  return input;
}
module.exports = { clean, value };
