'use strict';
const MODEL = 'holodek-1', REQUEST_BYTES = 4 * 1024 * 1024, RESPONSE_BYTES = 8 * 1024 * 1024;
const safeErrors = new WeakSet();
const problem = (code, message, status = 502) => {
  const error = Object.assign(new Error(message), { code: 'PC_MODEL_' + code, status });
  safeErrors.add(error); return error;
};
const cancelled = () => problem('CANCELLED', 'PC holodek-1 inference was cancelled.', 499);
function localOllamaURL(env = process.env) {
  let url;
  try { url = new URL(env.HOLODEK_OLLAMA_URL || 'http://127.0.0.1:11434/v1'); }
  catch { throw problem('URL', 'PC Ollama needs a valid loopback HOLODEK_OLLAMA_URL.', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !['', '/v1'].includes(url.pathname.replace(/\/+$/, '')))
    throw problem('URL', 'PC Ollama must use a loopback URL with no credentials, query or fragment.', 400);
  url.pathname = '/v1'; return url.href.replace(/\/+$/, '');
}
function request(body) {
  if (!body || body.model !== MODEL) throw problem('MODEL', 'The PC model host accepts only the exact model holodek-1. No model was substituted.', 400);
  if (!Array.isArray(body.messages) || !body.messages.length) throw problem('REQUEST', 'PC holodek-1 needs a nonempty messages array.', 400);
  try {
    let clean = { ...body, stream: false };
    for (const key of ['stream_options', 'api_key', 'apiKey', 'credential', 'authorization', 'headers', 'toJSON']) delete clean[key];
    const text = JSON.stringify(clean);
    if (Buffer.byteLength(text) > REQUEST_BYTES) throw problem('REQUEST_SIZE', 'PC holodek-1 request exceeds the size limit.', 413);
    clean = require('./holodekBudget').prepare(clean);
    return JSON.stringify(clean);
  } catch (error) {
    if (safeErrors.has(error)) throw error;
    if (error?.code === 'HOLODEK_CONTEXT_BUDGET') throw problem('CONTEXT_BUDGET', error.message, 422);
    throw problem('REQUEST', 'PC holodek-1 request is not serializable JSON.', 400);
  }
}
function normalize(value) {
  if (!value || !Array.isArray(value.choices) || value.choices.length !== 1) throw problem('RESPONSE', 'PC holodek-1 returned an invalid completion.');
  if (value.model !== undefined && ![MODEL, MODEL + ':latest'].includes(value.model))
    throw problem('MODEL_MISMATCH', 'PC Ollama returned a different model. No substitute answer was accepted.');
  const choice = value.choices[0], message = choice?.message;
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof choice.finish_reason !== 'string' || !choice.finish_reason ||
      (message.content != null && typeof message.content !== 'string') || (message.tool_calls != null && !Array.isArray(message.tool_calls)) ||
      ['reasoning', 'reasoning_content'].some(key => message[key] != null && typeof message[key] !== 'string'))
    throw problem('RESPONSE', 'PC holodek-1 returned an invalid completion.');
  // Structured Retort callers validate JSON in reasoning separately; never promote it to content here.
  if (choice.finish_reason === 'content_filter' || message.refusal)
    throw Object.assign(problem('REFUSAL', 'PC holodek-1 declined this response. No substitute answer was accepted.'),
      { responseEvidence: require('./generationFailure').evidence(value) });
  if (!message.content?.trim() && !message.tool_calls?.length && !message.reasoning?.trim() && !message.reasoning_content?.trim())
    throw Object.assign(problem(choice.finish_reason === 'length' ? 'OUTPUT_LIMIT' : 'EMPTY',
      choice.finish_reason === 'length' ? 'PC holodek-1 reached its output limit without a final answer.' :
        'PC holodek-1 returned no final content, tool calls or reasoning. Check the PC Ollama model/template; no model was substituted.'),
    { responseEvidence: require('./generationFailure').evidence(value) });
  return { ...(typeof value.id === 'string' ? { id: value.id } : {}), object: 'chat.completion', model: MODEL,
    ...(typeof value.created === 'number' ? { created: value.created } : {}),
    choices: [{ ...choice, index: 0, message: { ...message, role: message.role || 'assistant', content: message.content ?? null } }],
    ...(value.usage && typeof value.usage === 'object' ? { usage: value.usage } : {}) };
}
async function readCompletion(response, controller) {
  let text;
  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > RESPONSE_BYTES) { controller.abort(); throw problem('RESPONSE_SIZE', 'PC holodek-1 completion exceeds the size limit.'); }
      chunks.push(bytes);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > RESPONSE_BYTES) throw problem('RESPONSE_SIZE', 'PC holodek-1 completion exceeds the size limit.');
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw problem('RESPONSE', 'PC holodek-1 returned invalid completion JSON.'); }
  return normalize(parsed);
}
function createHost({ fetchImpl = (...args) => globalThis.fetch(...args), url = localOllamaURL, maxQueued = 32, timeoutMs = 600000 } = {}) {
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || !Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw problem('CONFIG', 'Invalid PC inference queue bounds.', 400);
  const waiting = []; let active = null;
  function settle(job, error, value) {
    if (job.finished) return;
    job.finished = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else job.resolve(value);
  }
  function cancel(job, error) {
    if (job.finished) return;
    const index = waiting.indexOf(job); if (index !== -1) waiting.splice(index, 1);
    job.controller.abort(); settle(job, error); pump();
  }
  async function run(job) {
    try {
      if (job.finished) return;
      const response = await fetchImpl(job.url + '/chat/completions', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: job.body,
        signal: job.controller.signal, redirect: 'error' });
      if (job.finished) return;
      if (!response.ok) {
        const status = Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : 502;
        throw problem('HTTP', 'PC Ollama holodek-1 returned HTTP ' + status + '. No model was substituted.', status);
      }
      settle(job, null, await readCompletion(response, job.controller));
    } catch (error) {
      settle(job, safeErrors.has(error) ? error : problem('UNAVAILABLE',
        'PC Ollama holodek-1 inference failed. Check Ollama on this PC; no model was substituted.', 503));
    } finally {
      // Keep the single slot until the aborted fetch/body has actually unwound.
      active = null; pump();
    }
  }
  function pump() {
    if (active || !waiting.length) return;
    const foreground = waiting.findIndex(job => !job.background);
    active = waiting.splice(foreground < 0 ? 0 : foreground, 1)[0]; void run(active);
  }
  async function complete(body, { signal, background = false } = {}) {
    const serialized = request(body);
    const endpoint = localOllamaURL({ HOLODEK_OLLAMA_URL: typeof url === 'function' ? url() : url });
    if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
      throw problem('REQUEST', 'PC holodek-1 needs a valid cancellation signal.', 400);
    if (signal?.aborted) throw cancelled();
    if (active && waiting.length >= maxQueued) throw problem('QUEUE_FULL', 'PC holodek-1 inference queue is full. Retry explicitly later.', 429);
    return new Promise((resolve, reject) => {
      const job = { body: serialized, url: endpoint, signal, background: background === true, resolve, reject, controller: new AbortController() };
      job.abort = () => cancel(job, cancelled());
      job.timer = setTimeout(() => cancel(job, problem('TIMEOUT', 'PC holodek-1 inference timed out while waiting or generating.', 504)), timeoutMs);
      waiting.push(job); signal?.addEventListener('abort', job.abort, { once: true });
      if (signal?.aborted) job.abort(); else pump();
    });
  }
  return { complete };
}
function modelClient(host = service) {
  return { chat: { completions: { create: async (body, options = {}) => {
    const result = await host.complete(body, { signal: options.signal, background: options.background === true });
    if (!body.stream) return result;
    return (async function* () {
      if (options.signal?.aborted) throw cancelled();
      for (const choice of result.choices) {
        const message = choice.message;
        yield { ...result, object: 'chat.completion.chunk', choices: [{ index: choice.index, delta: { ...message,
          ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) } : {}) },
          finish_reason: choice.finish_reason }] };
      }
    })();
  } } } };
}
const service = createHost();
module.exports = { complete: service.complete, createHost, modelClient, localOllamaURL, MODEL };
