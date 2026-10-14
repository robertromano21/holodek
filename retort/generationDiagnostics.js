'use strict';
const Models = require('./gameModels');
const clean = (value, limit) => String(value ?? '').replace(/data:(?:image|audio)\/[^\s"']+/gi, '[media omitted]').slice(0, limit);
function report(component, { status = 'fallback', reason, response, ...context } = {}) {
  const event = { component, status, model: Models.profile('gpt-4.1-mini').id };
  for (const [key, value] of Object.entries(context).slice(0, 16))
    event[key] = typeof value === 'number' || typeof value === 'boolean' || value === null ? value : clean(typeof value === 'object' ? JSON.stringify(value) : value, 400);
  if (reason) event.reason = clean(reason.message || reason, 1600);
  if (response !== undefined) { event.responseChars = String(response).length; event.responsePreview = clean(response, 1600); }
  console[['rejected', 'fallback', 'failed'].includes(status) ? 'warn' : 'info']('[GenerationFallback]', JSON.stringify(event));
  return event;
}
module.exports = { report };
