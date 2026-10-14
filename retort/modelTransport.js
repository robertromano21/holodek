'use strict';
const Models = require('./gameModels');

function requestBody(input, { models = Models } = {}) {
  const profile = models.profile(input.model), body = { ...input, model: profile.id };
  // Preserve the game's original uncapped Retort behavior. Old budget hints
  // were never enforced and can be too small for full room-generation JSON.
  delete body.maxTokens; delete body.max_tokens; delete body.max_completion_tokens; delete body.max_output_tokens;
  delete body.reasoning;
  delete body.reasoning_effort; delete body.parallel_tool_calls;
  if (profile.reasoningNone) body.reasoning_effort = 'none';
  if (body.tools?.length) body.parallel_tool_calls = false;
  return body;
}
function deadline(timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('The game model timed out. Try again or choose another model.')); }, timeoutMs);
  });
  return { controller, wait: work => Promise.race([work, expired]), close: () => { clearTimeout(timer); controller.abort(); } };
}
function verifyChoice(choice, structured) {
  if (!choice) throw new Error('The game model returned no answer.');
  if (choice.refusal || choice.message?.refusal || choice.finish_reason === 'content_filter') throw new Error('The game model declined this response. Try another command or model.');
  if (choice.finish_reason === 'length') throw new Error('The game model reached the provider output limit. No partial answer was accepted.');
  if (structured && choice.finish_reason !== 'tool_calls') throw new Error('The game model did not return the requested structured answer.');
}
function matches(value, schema) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.const !== undefined && schema.const !== value) return false;
  if (type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (type === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (type === 'array' && (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems ||
      schema.items && !value.every(item => matches(item, schema.items)))) return false;
  if (type === 'object') {
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties || {}, key))) return false;
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key) && !matches(value[key], child)) return false;
  }
  return true;
}
function strictSchema(schema) {
  const out = { ...schema };
  if (schema.type === 'object') {
    if (!schema.properties) throw Error('Strict Retort objects require typed properties.');
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, strictSchema(child)]));
    const required = new Set(schema.required || []);
    for (const [key, child] of Object.entries(out.properties)) if (!required.has(key)) {
      child.type = [...new Set([...(Array.isArray(child.type) ? child.type : [child.type]), 'null'])];
      if (child.enum && !child.enum.includes(null)) child.enum = [...child.enum, null];
    }
    out.required = Object.keys(out.properties); out.additionalProperties = false;
  }
  if (schema.type === 'array') {
    if (!schema.items) throw Error('Strict Retort arrays require a typed item schema.');
    out.items = strictSchema(schema.items);
  }
  return out;
}
function mismatch(value, schema, path = '$') {
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return `${path}.${key}: required field missing`;
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key) && !matches(value[key], child)) return mismatch(value[key], child, path + '.' + key);
  }
  if (Array.isArray(value) && schema.items) for (let i = 0; i < value.length; i++) if (!matches(value[i], schema.items)) return mismatch(value[i], schema.items, `${path}[${i}]`);
  return `${path}: expected ${JSON.stringify(schema).slice(0, 300)}; received ${JSON.stringify(value)?.slice(0, 160)}`;
}
async function complete(c, input, options = {}) {
  const body = requestBody(input, options), clock = deadline(options.timeoutMs ?? 120000);
  try {
    const result = await clock.wait(c.chat.completions.create(body, { signal: clock.controller.signal, timeout: 60000, maxRetries: 0 }));
    verifyChoice(result.choices?.[0], false);
    if (!result.choices[0].message?.content?.trim()) throw new Error('The game model returned an empty answer.');
    return result;
  } catch (error) {
    require('./generationDiagnostics').report('model-transport', { status: 'rejected', model: body.model, phase: 'completion', reason: error });
    throw error;
  } finally { clock.close(); }
}
async function* stream(settings, messages, { models = Models, client, timeoutMs = 120000 } = {}) {
  const body = requestBody({ model: settings.model, messages, temperature: settings.temperature,
    top_p: settings.topP, stream: true, stream_options: { include_usage: true }, ...(settings.parameters ? {
      tools: [{ type: 'function', function: { name: settings.name || 'answer', description: settings.description,
        ...(settings.strictParameters ? { strict: true } : {}),
        parameters: (settings.strictParameters ? strictSchema : value => value)(require('retort-js/dist/tooling').retortSchemaToJsonSchema(settings.parameters)) } }],
      tool_choice: { type: 'function', function: { name: settings.name || 'answer' } }
    } : {}) }, { models });
  const c = client || models.getClient();
  if (!c) throw new Error('The server has no OpenAI API key configured.');
  const clock = deadline(timeoutMs);
  let response, content = '', finished = false, toolName = '', toolId = null;
  try {
    response = await clock.wait(c.chat.completions.create(body, { signal: clock.controller.signal, timeout: 60000, maxRetries: 0 }));
    const iterator = response[Symbol.asyncIterator]();
    while (true) {
      const next = await clock.wait(iterator.next());
      if (next.done) break;
      const raw = next.value, choice = raw.choices?.[0], delta = choice?.delta || {};
      if (delta.refusal) throw new Error('The game model declined this response. Try another command or model.');
      if (choice?.finish_reason) { verifyChoice(choice, !!settings.parameters); finished = true; }
      let contentDelta = delta.content || '';
      if (settings.parameters) {
        if (contentDelta) throw new Error('The game model returned text instead of the requested structured answer.');
        for (const call of delta.tool_calls || []) {
          if (call.index !== 0 || call.id && toolId && call.id !== toolId) throw new Error('The game model returned more than one structured answer.');
          if (call.id) toolId = call.id;
          if (call.function?.name) toolName += call.function.name;
          contentDelta += call.function?.arguments || '';
        }
      } else if (delta.tool_calls?.length) throw new Error('The game model returned an unexpected function call.');
      content += contentDelta;
      yield { contentDelta, promptTokens: raw.usage?.prompt_tokens, completionTokens: raw.usage?.completion_tokens,
        totalTokens: raw.usage?.total_tokens };
    }
    if (!finished) throw new Error('The game model stream ended before its answer was complete.');
    if (!content.trim()) throw new Error('The game model returned an empty answer.');
    if (settings.parameters) {
      if (toolName !== (settings.name || 'answer')) throw new Error('The game model returned an unexpected answer function.');
      let parsed;
      try { parsed = JSON.parse(content); } catch { throw new Error('The game model returned invalid structured JSON.'); }
      if (!matches(parsed, body.tools[0].function.parameters)) throw new Error('The game model returned JSON that does not match the requested answer schema: ' + mismatch(parsed, body.tools[0].function.parameters));
    }
  } catch (error) {
    require('./generationDiagnostics').report('model-transport', { status: 'rejected', model: body.model, phase: 'stream',
      structured: !!settings.parameters, reason: error, response: content });
    throw error;
  } finally { response?.controller?.abort(); clock.close(); }
}
module.exports = { requestBody, complete, stream, strictSchema };
