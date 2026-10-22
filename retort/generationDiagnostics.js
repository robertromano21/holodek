'use strict';
const Models = require('./gameModels');
const clean = (value, limit) => require('./privateDiagnostics').clean(String(value ?? '').replace(/data:(?:image|audio)\/[^\s"']+/gi, '[media omitted]'), limit);
function report(component, { status = 'fallback', reason, response, ...context } = {}) {
  const event = { component, status, model: Models.profile('gpt-4.1-mini').id };
  for (const [key, value] of Object.entries(context).slice(0, 16))
    event[key] = typeof value === 'number' || typeof value === 'boolean' || value === null ? value : clean(typeof value === 'object' ? JSON.stringify(value) : value, 400);
  if (reason) {
    event.reason = clean(reason.message || reason, 1600);
    if (reason.code) event.code = clean(reason.code, 80);
    if (reason.responseEvidence) event.responseEvidence = require('./privateDiagnostics').value(reason.responseEvidence);
  }
  if (response !== undefined) { event.responseChars = String(response).length; event.responsePreview = clean(response, 1600); }
  require('./startupTasks').report({ component, status, path: context.path });
  console[['rejected', 'fallback', 'failed'].includes(status) ? 'warn' : 'info']('[GenerationFallback]', JSON.stringify(event));
  return event;
}
module.exports = { report };
