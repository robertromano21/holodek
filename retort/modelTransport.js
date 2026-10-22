'use strict';
const Models = require('./gameModels');
const Failure = require('./generationFailure');

const GUIDES = new Map();
function guide(file) { // compact Grave Master guide for small/local models (prompts/<file>), cached
  if (!GUIDES.has(file)) { try { GUIDES.set(file, require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'prompts', file), 'utf8').trim()); } catch { GUIDES.set(file, ''); } }
  return GUIDES.get(file);
}
// gpt-oss (harmony format): keep only the final channel if raw channel markers leak into content.
function finalOnly(text) {
  const s = String(text ?? ''); if (!s.includes('<|')) return s;
  const at = s.lastIndexOf('<|channel|>final<|message|>');
  return (at >= 0 ? s.slice(at + 27) : s.replace(/<\|channel\|>analysis<\|message\|>[\s\S]*?(<\|end\|>|$)/g, '')).replace(/<\|(start|end|return|call|message|channel)\|>/g, '').replace(/^assistant/, '').trim();
}
function clientFor(profile, client, models) {
  if (profile.provider === 'groq') { const c=(models.getGroqClient||Models.getGroqClient)(); if(!c)throw new Error('Groq needs GROQ_API_KEY configured on this PC.');return c; }
  if (profile.provider === 'xai') { const x = (models.getXaiClient || Models.getXaiClient)(); if (!x) throw new Error('Grok needs XAI_API_KEY set on the server. Choose another model.'); return x; }
  if (!profile.local) return process.env.HOLODEK_REMOTE_ENGINE === '1' ? models.getClient() : client || models.getClient();
  return (models.getLocalClient || Models.getLocalClient)(profile);
}
function localError(profile, error) {
  if (!profile.local) return error;
  if (String(error?.code || '').startsWith('PC_MODEL_')) return error;
  const down = /ECONNREFUSED|fetch failed|Connection error|connect/i.test(String(error?.message || error) + String(error?.cause?.code || ''));
  if (down && profile.id === 'holodek-1') return new Error('PC Ollama holodek-1 is unavailable. Check Ollama on this PC; no other model was substituted.');
  return down ? Object.assign(new Error(`The local model ${profile.name} is unavailable. Check the configured Ollama connection or choose another model.`), { cause: error }) : error;
}
function emptyAnswer(profile) {
  return Failure.failure('MODEL_EMPTY_FINAL', profile.id === 'holodek-1' ?
    'PC Ollama holodek-1 returned no final answer. Reasoning was not used as final content. Check the PC model/template; no model was substituted.' :
    'The game model returned an empty answer.');
}
// Local chat templates (Ollama/gpt-oss harmony) reject 2+ trailing assistant messages with
// "400 Cannot have 2 or more assistant messages at the end of the list." Retort code that writes
// instructions as $.assistant`...` inside a loop produces exactly that tail. For local models only,
// re-role the last message of such a tail as a user turn (it is the newest instruction). Cloud unchanged.
function normalizeLocalTail(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages;
  const n = messages.length;
  if (messages[n - 1]?.role !== 'assistant' || messages[n - 2]?.role !== 'assistant') return messages;
  return [...messages.slice(0, -1), { ...messages[n - 1], role: 'user' }];
}
function requestBody(input, { models = Models } = {}) {
  const profile = models.profile(input.model), body = { ...input, model: profile.apiModel || profile.id };
  // Preserve the game's original uncapped Retort behavior. Old budget hints
  // were never enforced and can be too small for full room-generation JSON.
  delete body.maxTokens; delete body.max_tokens; delete body.max_completion_tokens; delete body.max_output_tokens;
  delete body.reasoning;
  delete body.reasoning_effort; delete body.parallel_tool_calls;
  if (profile.reasoningNone) body.reasoning_effort = 'none';
  if (profile.reasoningEffort) body.reasoning_effort = profile.reasoningEffort;
  if (profile.guide && guide(profile.guide) && Array.isArray(body.messages)) body.messages = [{ role: 'system', content: guide(profile.guide) }, ...body.messages];
  // PC host checks the final wire body after schema and setting instructions are added.
  if (profile.local && Array.isArray(body.messages)) body.messages = normalizeLocalTail(body.messages);
  if (body.tools?.length) body.parallel_tool_calls = false;
  return body;
}
function deadline(timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    if (timeoutMs !== null) timer = setTimeout(() => { controller.abort(); reject(new Error('The game model timed out. Try again or choose another model.')); }, timeoutMs);
  });
  return { controller, wait: work => Promise.race([work, expired]), close: () => { clearTimeout(timer); controller.abort(); } };
}
function callTimeout(profile, override) {
  if (override !== undefined) return override;
  if (profile.local) return 600000;
  // Polled website jobs own liveness and cancellation; do not cut healthy generation at 120 seconds.
  try { if (require('./websiteAi').service().useForGameModels()) return null; } catch { /* Direct-provider calls keep their existing deadline. */ }
  return 120000;
}
function verifyChoice(choice, structured) {
  if (!choice) throw new Error('The game model returned no answer.');
  if (choice.refusal || choice.message?.refusal || choice.finish_reason === 'content_filter') throw new Error('The game model declined this response. Try another command or model.');
  if (choice.finish_reason === 'length') throw Failure.failure('MODEL_OUTPUT_LIMIT', 'The game model reached the provider output limit. No partial answer was accepted.');
  if (structured && choice.finish_reason !== 'tool_calls') throw new Error('The game model did not return the requested structured answer.');
}
function matches(value, schema) {
  if (schema.anyOf && !schema.anyOf.some(branch => matches(value, branch))) return false;
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.const !== undefined && schema.const !== value) return false;
  if (type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (type === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum ||
      schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9)) return false;
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
  if (schema.anyOf) out.anyOf = schema.anyOf.map(strictSchema);
  if (schema.type === 'object') {
    if (!schema.properties) throw Error('Strict Retort objects require typed properties.');
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, strictSchema(child)]));
    const required = new Set(schema.required || []);
    for (const [key, child] of Object.entries(out.properties)) if (!required.has(key)) {
      if (child.anyOf) child.anyOf = [...child.anyOf, { type: 'null' }];
      else child.type = [...new Set([...(Array.isArray(child.type) ? child.type : [child.type]), 'null'])];
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
function decodeStrictOptionals(value,schema){
  if(schema.anyOf){const branch=schema.anyOf.find(child=>matches(value,strictSchema(child)));if(branch)decodeStrictOptionals(value,branch);return value;}
  if(Array.isArray(value)&&schema.items){for(const item of value)decodeStrictOptionals(item,schema.items);return value;}
  if(value&&typeof value==='object'&&!Array.isArray(value))for(const[key,child]of Object.entries(schema.properties||{})){
    if(value[key]===null&&!schema.required?.includes(key)&&!matches(null,child))delete value[key];
    else if(Object.hasOwn(value,key))decodeStrictOptionals(value[key],child);
  }
  return value;
}
function variantFor(value, schema) {
  const branches = schema.anyOf.filter(branch => branch.properties);
  if (branches.length === 1) return branches[0];
  const keys = [...new Set(branches.flatMap(branch => Object.keys(branch.properties)))].filter(key =>
    branches.every(branch => branch.properties[key]?.enum) &&
    new Set(branches.map(branch => JSON.stringify(branch.properties[key].enum))).size > 1);
  if (!keys.length) return branches.find(branch => Object.entries(branch.properties).some(([key, child]) =>
    child.enum?.includes(value?.[key]) && branches.some(other => !other.properties[key])));
  return branches.find(branch => keys.every(key => Object.hasOwn(value || {}, key) ?
    branch.properties?.[key]?.enum?.includes(value[key]) : !branch.required?.includes(key)));
}
function mismatch(value, schema, path = '$') {
  if (schema.anyOf) {
    if (schema.anyOf.some(branch => matches(value, branch))) return '';
    const branch = variantFor(value, schema);
    return branch ? mismatch(value, branch, path) : `${path}: no allowed contract variant matches`;
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type))
    return `${path}: expected ${[].concat(schema.type).join(' or ')}; received ${type}`;
  if (schema.enum && !schema.enum.includes(value)) return `${path}: value is not one of the allowed enum choices`;
  if (schema.const !== undefined && schema.const !== value) return `${path}: expected constant ${JSON.stringify(schema.const)}`;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path}: expected at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path}: expected at most ${schema.maxLength} characters; received ${value.length}`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      const words = schema.pattern.startsWith('^\\s*\\S+(?:\\s+\\S+)') && schema.pattern.match(/\{0,(\d+)\}/);
      if (words) return `${path}: expected 1-${Number(words[1]) + 1} words; received ${value.trim() ? value.trim().split(/\s+/).length : 0}`;
      return `${path}: text must match ${JSON.stringify(schema.pattern)}${['\\S', '[\\s\\S]*\\S[\\s\\S]*'].includes(schema.pattern) ? ' (nonblank text required)' : ''}`;
    }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${path}: a finite number is required`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path}: minimum ${schema.minimum}; received ${value}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path}: maximum ${schema.maximum}; received ${value}`;
    if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9)
      return `${path}: expected a multiple of ${schema.multipleOf}; received ${value}`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return `${path}.${key}: required field missing`;
    if (schema.additionalProperties === false) for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties, key)) return `${path}.${key}: unexpected field; use only the requested keys`;
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key) && !matches(value[key], child)) return mismatch(value[key], child, path + '.' + key);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: expected at least ${schema.minItems} items; received ${value.length}`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: expected at most ${schema.maxItems} items; received ${value.length}`;
    if (schema.items) for (let i = 0; i < value.length; i++) if (!matches(value[i], schema.items)) return mismatch(value[i], schema.items, `${path}[${i}]`);
  }
  return `${path}: expected ${JSON.stringify(schema).slice(0, 300)}; received ${JSON.stringify(value)?.slice(0, 160)}`;
}
function issues(value, schema, path = '$') {
  if (matches(value, schema)) return [];
  if (schema.anyOf) {
    const branch = variantFor(value, schema);
    if (branch) return issues(value, branch, path);
  }
  const rows = [];
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties || {}))
      if (Object.hasOwn(value, key) || schema.required?.includes(key)) rows.push(...issues(value[key], child, path + '.' + key));
    if (schema.additionalProperties === false) for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties || {}, key)) rows.push({ path: path + '.' + key, message: 'Unexpected field; use only the requested keys.' });
  } else if (schema.type === 'array' && Array.isArray(value) &&
      (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems)) {
    value.forEach((item, index) => { if (schema.items) rows.push(...issues(item, schema.items, `${path}[${index}]`)); });
  }
  return rows.length ? rows : [{ path, message: mismatch(value, schema, path).replace(/^.*?: /, '') }];
}
async function completeOnce(c, input, options = {}) {
  const body = requestBody(input, options), profile = (options.models || Models).profile(input.model), clock = deadline(callTimeout(profile, options.timeoutMs));
  if (profile.local || ['xai','groq'].includes(profile.provider) || process.env.HOLODEK_REMOTE_ENGINE === '1') c = clientFor(profile, c, options.models || Models);
  try {
    const result = await clock.wait(c.chat.completions.create(require('./settingLayer').applyBody(body), { signal: clock.controller.signal, background: options.background === true,
      timeout: profile.local ? 600000 : 60000, maxRetries: 0 }).catch(e => { throw localError(profile, e); }));
    if (profile.local && result.choices?.[0]?.message?.content) result.choices[0].message.content = finalOnly(result.choices[0].message.content);
    verifyChoice(result.choices?.[0], false);
    if (!result.choices[0].message?.content?.trim()) throw emptyAnswer(profile);
    return result;
  } catch (error) {
    require('./generationDiagnostics').report('model-transport', { status: 'rejected', model: body.model, phase: 'completion', reason: error });
    throw error;
  } finally { clock.close(); }
}
async function* streamOnce(settings, messages, { models = Models, client, timeoutMs, background = false } = {}) {
  const body = requestBody({ model: settings.model, messages, temperature: settings.temperature,
    top_p: settings.topP, stream: true, stream_options: { include_usage: true }, ...(settings.parameters ? {
      tools: [{ type: 'function', function: { name: settings.name || 'answer', description: settings.description,
        ...(settings.strictParameters ? { strict: true } : {}),
        parameters: (settings.strictParameters ? strictSchema : value => value)(require('./structuredSchema').toJSON(settings.parameters)) } }],
      tool_choice: { type: 'function', function: { name: settings.name || 'answer' } }
    } : {}) }, { models });
  const profile = models.profile(settings.model), c = clientFor(profile, client, models);
  const answerSchema = body.tools?.[0]?.function?.parameters;
  if(profile.provider==='groq'&&answerSchema){
    const originalSchema=require('./structuredSchema').toJSON(settings.parameters);
    // Groq strict JSON currently requires a non-streaming request without tools.
    const wire={...body,stream:false,response_format:{type:'json_schema',json_schema:{name:settings.name||'answer',strict:true,schema:strictSchema(originalSchema)}}};
    delete wire.tools;delete wire.tool_choice;delete wire.parallel_tool_calls;delete wire.stream_options;
    const clock=deadline(callTimeout(profile,timeoutMs));
    try{
      const result=await clock.wait(c.chat.completions.create(require('./settingLayer').applyBody(wire),{signal:clock.controller.signal,timeout:60000,maxRetries:0,background}));
      verifyChoice(result.choices?.[0],false);const content=result.choices[0].message?.content;
      if(!content?.trim())throw emptyAnswer(profile);
      let parsed;try{parsed=JSON.parse(content);}catch{throw Failure.failure('MODEL_SCHEMA','Groq returned invalid JSON.');}
      decodeStrictOptionals(parsed,originalSchema);
      if(!matches(parsed,originalSchema))throw Failure.failure('MODEL_SCHEMA','Groq returned an answer outside the requested schema: '+mismatch(parsed,originalSchema),{rejectedAnswer:parsed,issues:issues(parsed,originalSchema)});
      yield{contentDelta:JSON.stringify(parsed),promptTokens:result.usage?.prompt_tokens,completionTokens:result.usage?.completion_tokens,totalTokens:result.usage?.total_tokens};return;
    }catch(error){require('./generationDiagnostics').report('model-transport',{status:'rejected',model:body.model,phase:'completion',structured:true,reason:error});throw error;}finally{clock.close();}
  }
  if (answerSchema && !profile.local && profile.provider !== 'xai')
    body.tools[0].function.parameters = require('./providerSchema').compact(answerSchema);
  // Legacy local callers retain compatibility repairs; critical authoring opts into raw final JSON.
  const hk = profile.id === 'holodek-1' && !!settings.parameters, H = hk ? require('./holodekStructured') : null; let hkText = '', hkReason = '';
  const strictAnswer = hk && settings.strictAnswer === true;
  // Use Ollama's response grammar instead of its unreliable gpt-oss tool-call path.
  const hkSchema = hk ? body.tools[0].function.parameters : null;
  if (hk) {
    body.response_format = { type: 'json_schema', json_schema: { name: settings.name || 'answer', strict: true, schema: hkSchema } };
    delete body.tools; delete body.tool_choice; delete body.parallel_tool_calls;
  }
  if (hk && Array.isArray(body.messages)) { const at = body.messages.findIndex(m => m.role !== 'system');
    body.messages.splice(at < 0 ? body.messages.length : at, 0, { role: 'system', content: H.instruction(hkSchema) }); }
  if (!c) throw new Error('The server has no OpenAI API key configured.');
  timeoutMs = callTimeout(profile, timeoutMs);
  if (profile.local) timeoutMs = Math.max(timeoutMs, 600000); // local generation is slower than the API
  const clock = deadline(timeoutMs); let harmony = profile.local ? '' : null;
  let response, content = '', finished = false, toolName = '', toolId = null, responseEvidence = {};
  try {
    response = await clock.wait(c.chat.completions.create(require('./settingLayer').applyBody(body), { signal: clock.controller.signal, background: background === true,
      timeout: profile.local ? 600000 : 60000, maxRetries: 0 }).catch(e => { throw localError(profile, e); }));
    const iterator = response[Symbol.asyncIterator]();
    while (true) {
      const next = await clock.wait(iterator.next());
      if (next.done) break;
      const raw = next.value, choice = raw.choices?.[0], delta = choice?.delta || {};
      Object.assign(responseEvidence, Failure.evidence(raw));
      if (delta.refusal) throw new Error('The game model declined this response. Try another command or model.');
      if (hk && choice?.finish_reason === 'length') {
        hkText += delta.content || ''; hkReason += delta.reasoning || delta.reasoning_content || '';
      }
      if (choice?.finish_reason) { verifyChoice(choice, !!settings.parameters && !hk); finished = true; }
      let contentDelta = delta.content || '';
      if (harmony !== null && contentDelta) { // raw harmony markers: hold text until the final channel starts
        if (harmony || contentDelta.startsWith('<|')) { harmony += contentDelta; const at = harmony.lastIndexOf('<|channel|>final<|message|>');
          if (at < 0) contentDelta = ''; else { contentDelta = harmony.slice(at + 27).replace(/<\|(start|end|return|call|message|channel)\|>/g, ''); harmony = null; } } else harmony = null; }
      if (profile.local && contentDelta.includes('<|')) contentDelta = contentDelta.replace(/<\|(start|end|return|call|message|channel)\|>/g, '');
      if (settings.parameters) {
        if (hk) { hkText += contentDelta; hkReason += delta.reasoning || delta.reasoning_content || ''; contentDelta = ''; }
        if (contentDelta) throw new Error('The game model returned text instead of the requested structured answer.');
        for (const call of delta.tool_calls || []) {
          if (call.index !== 0 || call.id && toolId && call.id !== toolId) throw new Error('The game model returned more than one structured answer.');
          if (call.id) toolId = call.id;
          if (call.function?.name) toolName += call.function.name;
          contentDelta += call.function?.arguments || '';
        }
      } else if (delta.tool_calls?.length) throw new Error('The game model returned an unexpected function call.');
      content += contentDelta;
      if (hk) { yield { contentDelta: '', promptTokens: raw.usage?.prompt_tokens, completionTokens: raw.usage?.completion_tokens, totalTokens: raw.usage?.total_tokens }; continue; }
      yield { contentDelta, promptTokens: raw.usage?.prompt_tokens, completionTokens: raw.usage?.completion_tokens,
        totalTokens: raw.usage?.total_tokens };
    }
    if (!finished) throw new Error('The game model stream ended before its answer was complete.');
    if (hk) {
      const schema = hkSchema;
      if (strictAnswer) {
        if (!hkText.trim()) throw Failure.failure('MODEL_EMPTY_FINAL', 'The game model returned no final structured JSON. Reasoning and tool arguments were not accepted as final content.');
        content = hkText;
        try { JSON.parse(content); } catch { throw new Error('The game model returned invalid structured JSON in its final answer. No extraction or repairs were applied.'); }
        toolName = settings.name || 'answer';
      } else {
        let parsed = null; try { parsed = JSON.parse(content); } catch { parsed = H.extract(content); }
        if (!parsed || typeof parsed !== 'object') {
          parsed = H.extract(hkText);
          if (!parsed) { parsed = H.extract(hkReason); if (parsed) console.warn('[holodek-1 structured] legacy reasoning JSON fallback'); }
        }
        if (parsed && typeof parsed === 'object') { toolName = settings.name || 'answer';
          const fixed = H.repair(parsed, schema); if (fixed.length) console.warn('[holodek-1 structured] filled missing fields:', fixed.slice(0, 12).join(', '));
          content = JSON.stringify(parsed); }
        else console.warn(`[holodek-1 structured] no JSON found (tool ${content.length}, text ${hkText.length}, reasoning ${hkReason.length} chars)`);
      }
    }
    if (!content.trim()) throw emptyAnswer(profile);
    if (settings.parameters) {
      if (toolName !== (settings.name || 'answer')) throw new Error('The game model returned an unexpected answer function.');
      let parsed;
      try { parsed = JSON.parse(content); } catch { throw new Error('The game model returned invalid structured JSON.'); }
      const checkSchema = hk ? strictAnswer ? hkSchema : H.relaxed(hkSchema) : answerSchema;
      if (!matches(parsed, checkSchema)) throw Failure.failure('MODEL_SCHEMA',
        'The game model returned JSON that does not match the requested answer schema: ' + mismatch(parsed, checkSchema),
        { rejectedAnswer: parsed, issues: issues(parsed, checkSchema) });
    }
    if (hk) yield { contentDelta: content };
  } catch (error) {
    error.responseEvidence ||= responseEvidence;
    if (hk) Object.assign(error.responseEvidence, { finalChars: hkText.length, reasoningChars: hkReason.length });
    require('./generationDiagnostics').report('model-transport', { status: 'rejected', model: body.model, phase: 'stream',
      structured: !!settings.parameters, reason: error, response: content });
    throw error;
  } finally { response?.controller?.abort(); clock.close(); }
}
async function complete(c, input, options = {}) {
  const Policy = require('./generationPolicy'), limit = Policy.ownsTransport() ? 1 : Policy.ATTEMPTS;
  for (let attempt = 1; attempt <= limit; attempt++) {
    try { return await completeOnce(c, input, options); }
    catch (error) { if (attempt === limit || !Policy.providerRetry(error)) throw error;
      require('./generationDiagnostics').report('model-transport', { status:'retrying', attempt:attempt+1, phase:'completion', reason:error });
      await Policy.backoff(attempt);
    }
  }
}
async function* stream(settings, messages, options = {}) {
  const Policy = require('./generationPolicy'), limit = Policy.ownsTransport() ? 1 : Policy.ATTEMPTS;
  for (let attempt = 1; attempt <= limit; attempt++) {
    let published = false;
    try { for await (const chunk of streamOnce(settings, messages, options)) { if (chunk.contentDelta) published = true; yield chunk; } return; }
    catch (error) { if (published || attempt === limit || !Policy.providerRetry(error)) throw error;
      require('./generationDiagnostics').report('model-transport', { status:'retrying', attempt:attempt+1, phase:'stream', reason:error });
      await Policy.backoff(attempt);
    }
  }
}
module.exports = { requestBody, normalizeLocalTail, complete, stream, strictSchema, finalOnly, callTimeout, matches, issues };
