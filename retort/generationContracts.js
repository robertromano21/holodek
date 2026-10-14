'use strict';
const Diagnostics = require('./generationDiagnostics');
const text = (maxLength, description) => ({ type: String, minLength: 1, ...(maxLength ? { maxLength } : {}), ...(description ? { description } : {}) });
const choice = values => ({ type: String, enum: values });
const object = properties => ({ type: properties });
const list = properties => [{ type: properties }];
function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, compact(v)]));
  return value;
}
async function request($, { component, parameters, validate = value => value, context = {}, maxTokens, attempts = 2 }) {
  let error, response = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let phase = 'transport';
    try {
      const reply = await $.assistant.generation({ maxTokens, parameters, strictParameters: true });
      response = String(reply?.content || ''); phase = 'json';
      const parsed = compact(JSON.parse(response)); phase = 'validation';
      const value = validate(parsed);
      if (value === null || value === undefined) throw Error('Validation returned no accepted result.');
      Diagnostics.report(component, { ...context, status: attempt === 1 ? 'generated' : 'recovered', attempt });
      return { value, response, attempt };
    } catch (caught) {
      error = caught;
      Diagnostics.report(component, { ...context, status: 'rejected', attempt, phase, reason: error, response });
      // Retry a malformed answer, not an unavailable provider, refusal or exhausted quota.
      if (phase === 'transport' && !/structured|schema|function call|returned text/i.test(error.message)) break;
      if (attempt < attempts) await $.user`The previous structured answer failed validation: ${String(error.message).slice(0, 1600)}. Return a corrected complete answer through the requested Retort answer function. Preserve the existing names, world bindings and all original creative instructions; change only invalid fields. Respect character limits, exact enum choices and required fields. No prose outside the structured answer.`;
    }
  }
  return { value: null, response, error };
}
module.exports = { text, choice, object, list, compact, request };
