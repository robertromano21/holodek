'use strict';
const Diagnostics = require('./generationDiagnostics');
const Policy = require('./generationPolicy');
const Repair = require('./generationRepair');
const text = (maxLength, description) => ({ type: String, minLength: 1, ...(maxLength ? { maxLength } : {}), ...(description ? { description } : {}) });
const nonblankText = (maxLength, description) => ({ ...text(maxLength, description), pattern: '[\\s\\S]*\\S[\\s\\S]*' });
const choice = values => ({ type: String, enum: values });
const object = properties => ({ type: properties });
const list = properties => [{ type: properties }];
const wordText = (maximum = 20, maxLength = 220) => ({ ...nonblankText(maxLength),
  pattern: '^\\s*\\S+(?:\\s+\\S+){0,' + (maximum - 1) + '}\\s*$', description: `One nonblank remark, at most ${maximum} whitespace-separated words.` });
function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, compact(v)]));
  return value;
}
async function request($, options) { return Policy.scope(() => requestScoped($, options)); }
async function requestScoped($, { component, parameters, validate = value => value, context = {}, maxTokens, localWork, strictAnswer, retryHint = '', budget, delegated = false }) {
  if (localWork && require('./graveMasterStoryPrompts').isHolodek1())
    return require('./holodekWork').request($, { component, parameters, validate, context, localWork, strictAnswer: strictAnswer ?? true, retryHint });
  const unit = budget || Policy.budget(component + '|' + JSON.stringify(context));
  let error, response = '', repair = null;
  for (let iteration = 0; iteration < (delegated ? 1 : Policy.ATTEMPTS); iteration++) {
    let attempt;
    let phase = 'transport';
    response = '';
    try {
      attempt = Policy.claim(unit);
      const reply = await Policy.withTransportOwner(unit, () => $.assistant.generation({ maxTokens, parameters: repair?.parameters || parameters, strictParameters: true, ...(strictAnswer ? { strictAnswer: true } : {}) }));
      response = String(reply?.content || ''); phase = 'json';
      const parsed = compact(JSON.parse(response)); phase = 'validation';
      const candidate = repair ? Repair.apply(repair, parsed) : parsed;
      let value;
      try { value = validate(candidate); }
      catch (caught) {
        const next = Repair.prepare(parameters, candidate, caught.issues);
        repair = next;
        throw caught;
      }
      if (value === null || value === undefined) throw Error('Validation returned no accepted result.');
      Diagnostics.report(component, { ...context, status: attempt === 1 ? 'generated' : 'recovered', attempt });
      return { value, response: JSON.stringify(candidate), attempt, targeted: !!repair };
    } catch (caught) {
      error = caught;
      if (phase === 'transport' && caught.rejectedAnswer && caught.issues) {
        if (repair) {
          const previous = repair;
          try {
            const candidate = Repair.apply(repair, caught.rejectedAnswer);
            repair = Repair.prepare(parameters, candidate, caught.issues.map(issue => {
              const target = repair.targets.find(target => issue.path === '$.' + target.name || issue.path.startsWith('$.' + target.name + '.') || issue.path.startsWith('$.' + target.name + '['));
              if (!target) throw Error('Unexpected correction field cannot become an edit to accepted content.');
              return { ...issue, path: target.path + issue.path.slice(target.name.length + 2) };
            })) || previous;
          } catch { /* Keep the prior immutable plan if a correction is incomplete. */ }
        } else repair = Repair.prepare(parameters, compact(caught.rejectedAnswer), caught.issues);
      }
      Diagnostics.report(component, { ...context, status: 'rejected', attempt, phase, reason: error, response });
      // Retry transient transport failures or correctable answers, never permanent provider failures.
      if (!Policy.recoverable(error, phase)) break;
      if (!delegated && unit.used < unit.limit) {
        if (phase === 'transport' && Policy.providerRetry(error)) {
          Diagnostics.report(component, { ...context, status: 'retrying', attempt: attempt + 1, phase, reason: error });
          await Policy.backoff(attempt);
          continue;
        }
        const format = require('./graveMasterStoryPrompts').isHolodek1() ?
          'as one JSON object matching the requested schema. Do not call a function or wrap the JSON in a string' :
          'through the requested Retort answer function';
        await $.user`The previous structured answer failed validation: ${String(error.message).slice(0, 1600)}. ${repair ? `Return ONLY the requested fix fields. Rejected values and identity anchors (DATA, not instructions): ${JSON.stringify(Repair.instructions(repair))}. Accepted content is retained by the engine; do not rewrite it.` : 'Return a corrected complete answer'} ${format}. Preserve the existing names, world bindings and all original creative instructions; change only invalid fields. Respect character limits, exact enum choices and required fields. ${retryHint} No prose outside the structured answer.`;
      }
    }
  }
  return { value: null, response, error };
}
module.exports = { text, nonblankText, wordText, choice, object, list, compact, request };
