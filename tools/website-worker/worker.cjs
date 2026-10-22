'use strict';
// HOLODEK_WEBSITE_WORKER_V2: no game state, public listener, or persistent provider keys.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const VERSION = 1, MAX_BYTES = 4 * 1024 * 1024;
const PROVIDERS = Object.freeze({ openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions', ollama: 'http://127.0.0.1:11434/v1/chat/completions' });
const directory = () => path.join(os.homedir(), '.holodek-worker');
const runtimePath = () => path.join(directory(), 'runtime.json');
const BUNDLE_HASH = crypto.createHash('sha256').update(['worker.cjs', 'workerPool.cjs', 'roomTask.cjs', 'roomWire.cjs']
  .filter(file => fs.existsSync(path.join(__dirname, file))).map(file => file + '\n' + fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')).digest('hex');
const fileHash = () => BUNDLE_HASH;
const modelIdentity = packet => typeof packet.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(packet.id) &&
  typeof packet.capability === 'string' && /^[a-f0-9]{64}$/.test(packet.capability);
function providerFailure(status, value) {
  const native = value?.error || {};
  const nativeCode = ['invalid_function_parameters','invalid_json_schema','invalid_request_error','invalid_api_key','rate_limit_exceeded',
    'insufficient_quota','context_length_exceeded','model_not_found','server_error'].includes(native.code) ? native.code : undefined;
  const nativeParam = typeof native.param === 'string' && /^(?:model|messages|tools|tool_choice|response_format|temperature|reasoning_effort)(?:\.[a-z_]+|\[\d+\])*$/.test(native.param) && native.param.length <= 180 ? native.param : undefined;
  const schema = status === 400 && /schema|enum|parameters|anyOf|required/i.test(String(native.message || '') + native.code);
  const quota = status === 429 && /quota|billing|credit/i.test(String(native.code || '') + native.type);
  const retry = status === 0 || status === 408 || status >= 500 || status === 429 && !quota;
  const code = retry ? 'MODEL_PROVIDER_RETRY' : schema ? 'MODEL_PROVIDER_SCHEMA' : [401, 403].includes(status) ? 'MODEL_PROVIDER_AUTH' : quota ? 'MODEL_PROVIDER_QUOTA' : 'MODEL_PROVIDER_REJECTED';
  return Object.assign(Error(schema ? 'The provider rejected the structured answer schema.' : 'The selected provider request failed (HTTP ' + status + ').'),
    { code, status, recoverable: retry, responseEvidence: { providerStatus: status,
      ...(nativeCode ? { providerCode: nativeCode } : {}), ...(nativeParam ? { providerParam: nativeParam } : {}) } });
}
function failurePacket(error) {
  if (/^MODEL_PROVIDER_(RETRY|SCHEMA|AUTH|QUOTA|REJECTED)$/.test(error?.code || ''))
    return { error: error.message, code: error.code, status: error.status, recoverable: error.recoverable, responseEvidence: error.responseEvidence };
  return { error: 'The selected model request failed.', code: 'MODEL_JOB_FAILED', recoverable: false };
}
function failureFrom(value) {
  const error = Object.assign(Error(value.error || 'Website model job failed.'), { code: value.code || 'MODEL_JOB_FAILED' });
  if (value.recoverable === false) error.recoverable = false;
  if (/^MODEL_PROVIDER_(RETRY|SCHEMA|AUTH|QUOTA|REJECTED)$/.test(error.code)) {
    error.status = value.status; error.recoverable = value.recoverable; error.responseEvidence = value.responseEvidence;
  }
  return error;
}
function cloudFetch(url, options) {
  // Unlike fetch's default dispatcher, this transport has no absolute header/body timeout.
  return new Promise((resolve, reject) => {
    const request = require('node:https').request(url, { method: 'POST', agent: false, headers: options.headers, signal: options.signal }, response => {
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
        async text() {
          const chunks = []; let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > MAX_BYTES) { response.destroy(); throw Error('The model answer exceeds the worker limit.'); }
            chunks.push(chunk);
          }
          return Buffer.concat(chunks).toString('utf8');
        } });
    });
    request.on('error', reject); request.setTimeout(0); request.end(options.body);
  });
}
function modelBody(body) {
  if (!body || typeof body !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,120}$/.test(body.model || '') ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 256 ||
      body.messages.some(m => !m || !['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role) ||
        !(typeof m.content === 'string' || m.role === 'assistant' && m.content == null && Array.isArray(m.tool_calls)))) throw Error('Invalid model work order.');
  const request = { ...body, stream: false }; delete request.stream_options; return request;
}
async function readJson(stream, limit = MAX_BYTES) {
  let size = 0; const chunks = [];
  for await (const chunk of stream) { size += chunk.length; if (size > limit) throw Error('Request exceeds the worker limit.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('Invalid worker JSON.'); }
}
function completion(result) {
  if (!result || !Array.isArray(result.choices) || result.choices.length !== 1) throw Error('The selected model returned no complete choice.');
  return { choices: result.choices, usage: result.usage, model: result.model };
}
function pcCompletion(result) {
  const value = completion(result), choice = value.choices[0], message = choice?.message;
  if (value.model !== undefined && !['holodek-1', 'holodek-1:latest'].includes(value.model) ||
      !message || typeof message !== 'object' || Array.isArray(message) ||
      typeof choice.finish_reason !== 'string' || !choice.finish_reason ||
      message.content != null && typeof message.content !== 'string' ||
      message.tool_calls != null && !Array.isArray(message.tool_calls) ||
      !message.content?.trim() && !message.tool_calls?.length) throw Error('Invalid PC model completion.');
  return value;
}
async function handle(packet, { fetchImpl = globalThis.fetch, signal, pcRequest } = {}) {
  if (packet?.operation === 'status') {
    let models = [];
    try {
      const r = await fetchImpl('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (r.ok) models = (await r.json()).models.map(m => ({ name: m.name, size: m.size }));
    } catch { /* Cloud workers do not require Ollama. */ }
    return { version: VERSION, node: process.version, cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1073741824), models, bundleHash: fileHash() };
  }
  if (packet?.operation !== 'generate' || !Object.hasOwn(PROVIDERS, packet.provider)) throw Error('Unsupported worker operation.');
  const body = packet.body;
  const request = modelBody(body);
  if (Object.hasOwn(packet, 'pcSession')) {
    if (!/^[a-f0-9]{48}$/.test(packet.pcSession || '') || packet.provider !== 'ollama' || body.model !== 'holodek-1' || typeof pcRequest !== 'function')
      throw Error('Invalid PC model bridge work order.');
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_BYTES) throw Error('PC model request exceeds the worker limit.');
    return pcCompletion(await pcRequest(packet.pcSession, request, { signal, background: packet.background === true }));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (packet.provider !== 'ollama') {
    if (typeof packet.credential !== 'string' || !/^[\x21-\x7e]{20,500}$/.test(packet.credential)) throw Error('This provider needs a key from the PC.');
    headers.Authorization = 'Bearer ' + packet.credential;
  }
  let response;
  try { response = await fetchImpl(PROVIDERS[packet.provider], { method: 'POST', headers,
    body: JSON.stringify(request), signal: signal || AbortSignal.timeout(600000), redirect: 'error' }); }
  catch { throw providerFailure(0); }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error('The model answer exceeds the worker limit.');
  if (!response.ok) { let native; try { native = JSON.parse(text); } catch {} throw providerFailure(response.status, native); }
  let result; try { result = JSON.parse(text); } catch { throw Error('The selected model returned invalid JSON.'); }
  // Return only the completion contract, not arbitrary provider response fields.
  return completion(result);
}
function startServer({ port = 0, maxActive = 2, maxBackground = maxActive, runtime = runtimePath(), fetchImpl,
  log = row => console.info('[WebsiteJob]', JSON.stringify(row)),
  modelClock = { now: () => Date.now(), setTimeout, clearTimeout } } = {}) {
  const token = crypto.randomBytes(32).toString('hex'); let active = 0;
  let activeOllama = 0, activeBackground = 0, computeActive = 0; const waiting = [], computeWaiting = [], leases = new Map();
  const reserved = (kind, backgroundOnly = false) => [...leases.values()].filter(lease => lease.kind === kind && (!backgroundOnly || lease.background)).length;
  function reserve(kind, background, queue) {
    const occupied = kind === 'room' ? computeActive + computeWaiting.length + reserved(kind) : active + waiting.length + reserved(kind);
    const backgroundOccupied = activeBackground + waiting.filter(job => job.background).length + reserved('model', true);
    if (!queue && (occupied >= (kind === 'room' ? 1 : maxActive) || kind === 'model' && background && backgroundOccupied >= maxBackground)) return { available: false };
    if (reserved(kind) >= 16) throw Error('Worker reservation queue is full.');
    const id = crypto.randomBytes(24).toString('hex'), lease = { kind, background };
    lease.timer = setTimeout(() => leases.delete(id), 30000); lease.timer.unref(); leases.set(id, lease);
    return { available: true, lease: id };
  }
  function consume(id, kind, background) {
    const lease = leases.get(id);
    if (!lease || lease.kind !== kind || lease.background !== background) throw Error('Worker reservation expired or mismatched.');
    clearTimeout(lease.timer); leases.delete(id);
  }
  const jobs = new Map(), recent = [], pcSessions = new Map(); let completed = 0, failed = 0;
  const modelJobs = new Map(), modelTerminal = new Map();
  const modelError = (code, message) => Object.assign(Error(message), { code });
  function modelRecord(packet) {
    if (!modelIdentity(packet)) throw modelError('MODEL_JOB_INVALID', 'Invalid model job identity.');
    const record = modelJobs.get(packet.id);
    if (!record) throw modelError('MODEL_JOB_UNKNOWN', 'Unknown or expired model job.');
    const digest = crypto.createHash('sha256').update(packet.capability).digest();
    if (!crypto.timingSafeEqual(record.capabilityHash, digest)) throw modelError('MODEL_JOB_DENIED', 'Model job capability was rejected.');
    return record;
  }
  const modelView = record => ({ id: record.id, phase: record.phase,
    ...(record.phase === 'complete' ? { result: record.result } : {}), ...(record.error ? { error: record.error, code: record.code, ...record.failure } : {}) });
  function retainModel(record) {
    modelClock.clearTimeout(record.timer); modelTerminal.set(record.id, record);
    record.timer = modelClock.setTimeout(() => { modelJobs.delete(record.id); modelTerminal.delete(record.id); }, 600000);
    record.timer?.unref?.();
    // Keep small tombstones after result eviction so ordinary retries cannot purchase the same job twice.
    const results = [...modelTerminal.values()].filter(row => row.result !== undefined);
    while (results.length > 32) {
      const old = results.shift(); delete old.result; delete old.failure; old.phase = 'failed'; old.code = 'MODEL_JOB_EXPIRED'; old.error = 'Model job result was evicted.';
    }
    while (modelTerminal.size > 512) {
      const [id, old] = modelTerminal.entries().next().value;
      modelClock.clearTimeout(old.timer); modelTerminal.delete(id); modelJobs.delete(id);
    }
  }
  function stopModel(record, code, error) {
    if (!['queued', 'running'].includes(record.phase)) return;
    record.phase = 'failed'; record.code = code; record.error = error; record.controller.abort(); retainModel(record);
  }
  function touchModel(record) {
    if (!['queued', 'running'].includes(record.phase)) return;
    modelClock.clearTimeout(record.timer);
    record.timer = modelClock.setTimeout(() => stopModel(record, 'MODEL_JOB_ORPHANED', 'Model job stopped after its heartbeat lease expired.'), 90000);
    record.timer?.unref?.();
  }
  async function executeModel(record, work) {
    let release;
    try {
      release = await acquire(false, record.metadata.background, record.controller.signal);
      if (record.controller.signal.aborted) return;
      record.phase = 'running'; jobs.set(record.id, record.metadata); report(record.metadata, 'running');
      const value = await handle(work, { fetchImpl: fetchImpl || cloudFetch, signal: record.controller.signal });
      if (record.controller.signal.aborted) return;
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw Error('Model result exceeds limit.');
      record.result = value; record.phase = 'complete'; completed++; report(record.metadata, 'completed'); retainModel(record);
    } catch (error) {
      if (record.phase !== 'failed') {
        const safe = failurePacket(error); record.failure = safe;
        stopModel(record, safe.code, safe.error);
        log({ ...record.metadata, phase: 'provider-failed', code: safe.code, responseEvidence: safe.responseEvidence });
      }
    } finally {
      if (record.phase === 'failed') { failed++; report(record.metadata, record.code === 'MODEL_JOB_CANCELLED' ? 'cancelled' : 'failed'); }
      jobs.delete(record.id); recent.push({ ...record.metadata, ms: Date.now() - record.metadata.queuedAt });
      if (recent.length > 32) recent.shift();
      work = null; release?.();
    }
  }
  function submitModel(packet) {
    if (!modelIdentity(packet)) throw modelError('MODEL_JOB_INVALID', 'Invalid model job identity.');
    if (modelJobs.has(packet.id)) {
      const record = modelRecord(packet);
      if (packet.lease) consume(packet.lease, 'model', packet.background === true);
      touchModel(record); return { id: record.id, capability: packet.capability, phase: record.phase };
    }
    if (!['openai', 'xai', 'groq'].includes(packet.provider) || Object.hasOwn(packet, 'pcSession')) throw modelError('MODEL_JOB_INVALID', 'Async model jobs require a cloud provider.');
    const body = modelBody(packet.body);
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES || typeof packet.credential !== 'string' || !/^[\x21-\x7e]{20,500}$/.test(packet.credential) ||
        packet.credential === packet.id || packet.credential === body.model)
      throw modelError('MODEL_JOB_INVALID', 'Invalid async cloud work order.');
    if (waiting.length >= 32) throw modelError('MODEL_JOB_QUEUE_FULL', 'Worker queue is full.');
    consume(packet.lease, 'model', packet.background === true);
    const record = { id: packet.id, capabilityHash: crypto.createHash('sha256').update(packet.capability).digest(), phase: 'queued',
      controller: new AbortController(), metadata: { id: packet.id, provider: packet.provider, model: body.model,
        background: packet.background === true, queuedAt: Date.now(), phase: 'queued' } };
    modelJobs.set(record.id, record); touchModel(record); report(record.metadata, 'queued');
    void executeModel(record, { operation: 'generate', provider: packet.provider, body, credential: packet.credential });
    return { id: record.id, capability: packet.capability, phase: record.phase };
  }
  function closePcSession(id) {
    const session = pcSessions.get(id);
    if (!session) return;
    pcSessions.delete(id);
    session.signal.removeEventListener('abort', session.cancel);
    for (const controller of session.controllers) controller.abort();
    for (const request of [...session.pending.values()]) request.finish(Error('PC model session ended.'));
  }
  function openPcSession(send, signal, background) {
    if (signal.aborted) throw Error('Room stage cancelled.');
    const id = crypto.randomBytes(24).toString('hex');
    const session = { send, signal, background, pending: new Map(), controllers: new Set(), cancel: () => closePcSession(id) };
    pcSessions.set(id, session); signal.addEventListener('abort', session.cancel, { once: true });
    return { id, runtime: path.resolve(runtime) };
  }
  function pcRequest(id, body, { signal, background }) {
    const session = pcSessions.get(id);
    if (!session || session.signal.aborted || signal.aborted || session.background !== background) return Promise.reject(Error('PC model session ended.'));
    if (session.pending.size >= 8) return Promise.reject(Error('PC model pending request limit exceeded.'));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomBytes(12).toString('hex');
      const request = { finish(error, result) {
        if (!session.pending.delete(requestId)) return;
        signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(result);
      } };
      const cancel = () => request.finish(Error('PC model request cancelled.'));
      session.pending.set(requestId, request); signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted || session.signal.aborted) return cancel();
      Promise.resolve().then(() => session.send({ type: 'pc-model-request', session: id, id: requestId, body, background }))
        .catch(error => request.finish(error));
    });
  }
  function acceptPcResponse(packet) {
    if (!/^[a-f0-9]{48}$/.test(packet.session || '') || !/^[a-f0-9]{24}$/.test(packet.id || '')) throw Error('Invalid PC model response identity.');
    const request = pcSessions.get(packet.session)?.pending.get(packet.id);
    if (!request) throw Object.assign(Error('Unknown or expired PC model request.'), { code: 'PC_MODEL_UNKNOWN_REQUEST' });
    if (Object.hasOwn(packet, 'result') === Object.hasOwn(packet, 'error')) throw Error('PC model response needs exactly one result or error.');
    if (Object.hasOwn(packet, 'error')) {
      if (typeof packet.error !== 'string' || !packet.error.length || Buffer.byteLength(packet.error) > 1000) throw Error('Invalid PC model error.');
      // The PC owns detailed inference diagnostics; never echo arbitrary host errors into remote logs.
      request.finish(Error('The PC model request failed.'));
    } else {
      if (Buffer.byteLength(JSON.stringify(packet.result)) > MAX_BYTES) throw Error('PC model answer exceeds the worker limit.');
      request.finish(null, pcCompletion(packet.result));
    }
    return { accepted: true };
  }
  function report(job, phase) {
    job.phase = phase;
    const row = { ...job, ms: Date.now() - job.queuedAt };
    try { log(row); } catch { /* Diagnostics must never interrupt a room request. */ }
    return row;
  }
  function drain() {
    waiting.sort((a, b) => Number(a.background) - Number(b.background));
    while (active < maxActive) {
      const index = waiting.findIndex(job => (!job.local || activeOllama < 1) && (!job.background || activeBackground < maxBackground));
      if (index < 0) break;
      const job = waiting.splice(index, 1)[0];
      job.signal.removeEventListener('abort', job.cancel);
      active++; if (job.local) activeOllama++; if (job.background) activeBackground++;
      job.resolve(() => { active--; if (job.local) activeOllama--; if (job.background) activeBackground--; drain(); });
    }
  }
  function acquire(local, background, signal) {
    if (waiting.length >= 32) return Promise.reject(Error('Worker queue is full.'));
    return new Promise((resolve, reject) => {
      const job = { local, background, signal, resolve };
      job.cancel = () => { const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1); reject(Error('Worker request cancelled.')); };
      waiting.push(job); signal.addEventListener('abort', job.cancel, { once: true });
      if (signal.aborted) job.cancel(); else drain();
    });
  }
  function drainCompute() {
    computeWaiting.sort((a, b) => Number(a.background) - Number(b.background));
    if (computeActive || !computeWaiting.length) return;
    const job = computeWaiting.shift(); job.signal.removeEventListener('abort', job.cancel); computeActive++;
    job.resolve(() => { computeActive--; drainCompute(); });
  }
  function acquireCompute(background, signal) {
    if (computeWaiting.length >= 16) return Promise.reject(Error('Room worker queue is full.'));
    return new Promise((resolve, reject) => {
      const job = { background, signal, resolve };
      job.cancel = () => { const at = computeWaiting.indexOf(job); if (at >= 0) computeWaiting.splice(at, 1); reject(Error('Room stage cancelled.')); };
      computeWaiting.push(job); signal.addEventListener('abort', job.cancel, { once: true });
      if (signal.aborted) job.cancel(); else drainCompute();
    });
  }
  const engineHash = () => { try { const value = JSON.parse(fs.readFileSync(path.join(path.dirname(runtime), 'active-engine.json'), 'utf8'));
    return /^[a-f0-9]{64}$/.test(value.hash || '') ? value.hash : null; } catch { return null; } };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (code, value) => { if (!res.destroyed) { res.statusCode = code; res.end(JSON.stringify(value)); } };
    if (req.method !== 'POST' || req.url !== '/jobs' || req.headers.authorization !== 'Bearer ' + token) return reply(403, { error: 'Worker authorization required.' });
    let packet;
    try { packet = await readJson(req, 64 * 1024 * 1024); } catch (e) { return reply(400, { error: e.message }); }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return reply(400, { error: 'Invalid worker packet.' });
    if (['model-submit', 'model-poll', 'model-cancel'].includes(packet.operation)) {
      try {
        if (packet.operation === 'model-submit') return reply(200, { value: submitModel(packet) });
        const record = modelRecord(packet);
        if (packet.operation === 'model-cancel') stopModel(record, 'MODEL_JOB_CANCELLED', 'Model job cancelled.'); else touchModel(record);
        return reply(200, { value: modelView(record) });
      } catch (error) { return reply(error.code === 'MODEL_JOB_UNKNOWN' ? 404 : error.code === 'MODEL_JOB_DENIED' ? 403 : 400,
        { error: error.message, code: error.code || 'MODEL_JOB_INVALID' }); }
    }
    if (packet.operation === 'pc-model-response') {
      try { return reply(200, { value: acceptPcResponse(packet) }); }
      catch (error) { return reply(400, { error: error.message, ...(error.code ? { code: error.code } : {}) }); }
    }
    if (packet.operation === 'reserve') {
      if (!['room', 'model'].includes(packet.kind)) return reply(400, { error: 'Invalid worker reservation.' });
      try { return reply(200, { value: reserve(packet.kind, packet.background === true, packet.queue === true) }); }
      catch (error) { return reply(400, { error: error.message }); }
    }
    if (packet.operation === 'capacity') return reply(200, { value: { pid: process.pid, port: server.address().port,
      node: process.version, bundleHash: fileHash(), active, queued: waiting.length, computeActive, computeQueued: computeWaiting.length,
      computeReserved: reserved('room'), modelReserved: reserved('model'), maxActive, maxBackground, engineHash: engineHash() } });
    const generating = packet?.operation === 'generate', local = generating && packet.provider === 'ollama';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), packet.operation === 'room-stage' ? 1200000 : 600000);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let release, job, pcSession, pcModelSession;
    try {
      if (packet.operation === 'room-stage') {
        if (packet.pcModel !== undefined && packet.pcModel !== 'holodek-1') throw Error('Unsupported PC room model.');
        if (packet.engineHash !== engineHash()) throw Error('Room engine version mismatch; reconnect Website AI.');
        consume(packet.lease, 'room', packet.background === true);
        release = await acquireCompute(packet.background === true, controller.signal);
        res.setHeader('Content-Type', 'application/x-ndjson'); res.flushHeaders();
        const send = message => new Promise((resolve, reject) => {
          if (res.destroyed || controller.signal.aborted) return reject(Error('Room stream cancelled.'));
          const line = JSON.stringify(message) + '\n';
          if (res.write(line)) resolve(); else { res.once('drain', resolve); res.once('close', () => reject(Error('Room stream closed.'))); }
        });
        const id = crypto.randomBytes(6).toString('hex');
        log({ id, phase: 'room-running', background: packet.background === true, port: server.address().port });
        try {
          if (packet.pcModel === 'holodek-1') pcSession = openPcSession(send, controller.signal, packet.background === true);
          await require('./roomTask.cjs').run(packet, { directory: path.dirname(runtime), signal: controller.signal, send, pcSession });
          log({ id, phase: 'room-completed', port: server.address().port });
        } catch (error) { await send({ type: 'failed', reason: error.message, ...(/^MODEL_PROVIDER_/.test(error.code || '') ? failurePacket(error) : {}) }); }
        res.end(); return;
      }
      if (generating) {
        if (packet.lease) consume(packet.lease, 'model', packet.background === true);
        if (Object.hasOwn(packet, 'pcSession')) {
          pcModelSession = pcSessions.get(packet.pcSession);
          if (!pcModelSession || pcModelSession.signal.aborted || pcModelSession.background !== (packet.background === true) ||
              packet.provider !== 'ollama' || packet.body?.model !== 'holodek-1') throw Error('Invalid or expired PC model session.');
          if (pcModelSession.controllers.size >= 8) throw Error('PC model pending request limit exceeded.');
          pcModelSession.controllers.add(controller);
        }
        const model = String(packet.body?.model || '');
        job = { id: crypto.randomBytes(6).toString('hex'), provider: Object.hasOwn(PROVIDERS, packet.provider) ? packet.provider : 'invalid',
          model: /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,120}$/.test(model) && model !== packet.credential ? model : 'invalid',
          background: packet.background === true, queuedAt: Date.now(), phase: 'queued' };
        // Store only scheduling metadata, never the packet, prompts, credentials or completion text.
        report(job, 'queued');
        release = await acquire(local, packet.background === true, controller.signal);
        jobs.set(job.id, job); report(job, 'running');
      }
      const value = await handle(packet, { fetchImpl, signal: controller.signal, pcRequest });
      if (packet.operation === 'status') Object.assign(value, { active, queued: waiting.length, port: server.address().port, pid: process.pid,
        jobs: [...jobs.values()].map(row => ({ ...row, ms: Date.now() - row.queuedAt })), recent, completed, failed,
        computeActive, computeQueued: computeWaiting.length, engineHash: engineHash() });
      if (job) { completed++; report(job, 'completed'); }
      reply(200, { value });
    } catch (e) {
      if (job) { failed++; report(job, controller.signal.aborted ? 'cancelled' : 'failed'); }
      reply(400, { error: e.message });
    }
    finally {
      if (pcSession) closePcSession(pcSession.id);
      pcModelSession?.controllers.delete(controller);
      if (job) {
        jobs.delete(job.id); recent.push({ ...job, ms: Date.now() - job.queuedAt });
        if (recent.length > 32) recent.shift();
      }
      clearTimeout(timer); release?.();
    }
  });
  server.requestTimeout = 610000;
  server.on?.('close', () => {
    for (const record of modelJobs.values()) {
      stopModel(record, 'MODEL_JOB_CANCELLED', 'Worker listener closed.'); modelClock.clearTimeout(record.timer);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    fs.mkdirSync(path.dirname(runtime), { recursive: true, mode: 0o700 });
    const temporary = runtime + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ version: VERSION, pid: process.pid, port: server.address().port,
      token, bundleHash: fileHash() }), { mode: 0o600 }); fs.renameSync(temporary, runtime);
  });
  return server;
}
async function rpc(packet, options = {}) {
  const { runtime = runtimePath(), fetchImpl = globalThis.fetch } = options;
  if (!options.runtime && fs.existsSync(path.join(options.directory || directory(), 'pool.json'))) {
    const pool = require('./workerPool.cjs');
    return packet.operation === 'status' ? pool.status(options) : pool.route(packet, options);
  }
  const value = JSON.parse(fs.readFileSync(runtime, 'utf8'));
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token || '')) throw Error('Invalid private worker registry.');
  // Verify the private listener before sending a provider key to a possibly stale port.
  if (packet?.operation === 'generate' || packet?.operation === 'model-submit') {
    const status = await rpc({ operation: packet.operation === 'model-submit' || Object.hasOwn(packet, 'pcSession') ? 'capacity' : 'status' }, { runtime, fetchImpl });
    if (status?.pid !== value.pid || status?.bundleHash !== value.bundleHash) throw Error('Worker registry is stale; reconnect first.');
    if (Object.hasOwn(packet, 'pcSession') && !packet.lease) {
      const reservation = await rpc({ operation: 'reserve', kind: 'model', background: packet.background === true, queue: true }, { runtime, fetchImpl });
      if (!reservation?.available) throw Error('PC model gateway queue is full.');
      packet = { ...packet, lease: reservation.lease };
    }
  }
  const response = await fetchImpl('http://127.0.0.1:' + value.port + '/jobs', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + value.token },
    body: JSON.stringify(packet), signal: options.signal || AbortSignal.timeout(605000), redirect: 'error' });
  const result = await response.json();
    if (!response.ok) throw failureFrom(result); return result.value;
}
async function pollModelJob(packet, { call = rpc, signal, pollMs = 1500 } = {}) {
  if (!['openai', 'xai', 'groq'].includes(packet?.provider) || Object.hasOwn(packet, 'pcSession') || !Number.isFinite(pollMs) || pollMs < 0 || pollMs > 30000)
    throw Error('Invalid async cloud model client.');
  const id = crypto.randomUUID(), capability = crypto.randomBytes(32).toString('hex');
  const identity = { id, capability }; let submitted = false, terminal = false, failures = 0;
  const cancelled = () => Object.assign(Error('Website model request cancelled.'), { code: 'MODEL_JOB_CANCELLED' });
  async function control(value, parent, timeout) {
    const controller = new AbortController();
    const abort = () => controller.abort(); parent?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeout); if (parent?.aborted) abort();
    let listener;
    try {
      return await Promise.race([Promise.resolve().then(() => call(value, { signal: controller.signal })),
        new Promise((resolve, reject) => {
          listener = () => reject(parent?.aborted ? cancelled() : Error('Website model control request timed out.'));
          controller.signal.addEventListener('abort', listener, { once: true }); if (controller.signal.aborted) listener();
        })]);
    } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', listener); }
  }
  async function pause() {
    if (signal?.aborted) throw cancelled();
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(cancelled()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, pollMs);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  try {
    for (;;) {
      if (signal?.aborted) throw cancelled();
      let value;
      try {
        value = await control(submitted ? { operation: 'model-poll', ...identity } :
          { ...packet, ...identity, operation: 'model-submit' }, signal, 15000);
        if (!value || value.id !== undefined && value.id !== id || !['queued', 'running', 'complete', 'failed'].includes(value.phase) ||
            !submitted && (value.id !== id || value.capability !== capability)) throw Error('Invalid model job response.');
        failures = 0;
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (++failures >= 5) throw Object.assign(Error('Website model RPC failed after five consecutive attempts: ' + String(error.message || 'Control request failed.').slice(0, 1000)), { code: 'MODEL_JOB_RPC_FAILED' });
        await pause(); continue;
      }
      if (signal?.aborted) throw cancelled();
      if (!submitted) { submitted = true; continue; }
      if (value.phase === 'complete') { terminal = true; return completion(value.result); }
      if (value.phase === 'failed') { terminal = true; throw failureFrom(value); }
      await pause();
    }
  } finally {
    if (!terminal) try { await control({ operation: 'model-cancel', ...identity }, undefined, 3000); } catch { /* The heartbeat lease is the final cleanup fallback. */ }
  }
}
function verifyProcess(rows, script, name = 'holodek-adjacent-worker') {
  const matches = rows.filter(row => row.name === name);
  if (matches.length > 1 || matches.some(row => path.resolve(row.pm2_env?.pm_exec_path || '') !== path.resolve(script) ||
      path.resolve(row.pm2_env?.pm_cwd || '') !== path.dirname(path.resolve(script)))) throw Error('PM2 name is owned by a different application; nothing was stopped.');
  return matches[0] || null;
}
async function startPm2() {
  let cli;
  for (const candidate of [path.join(os.homedir(), '.local/bin/pm2'), '/usr/local/bin/pm2', '/usr/bin/pm2']) if (fs.existsSync(candidate)) { cli = candidate; break; }
  if (!cli) throw Error('PM2 is not installed for this account. Install it with npm install --prefix "$HOME/.local" pm2, then reconnect.');
  const run = args => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * MAX_BYTES,
    env: { ...process.env, PM2_HOME: path.join(os.homedir(), '.holodek-pm2') } });
  const raw = run(['jlist']), start = raw.indexOf('[{') >= 0 ? raw.indexOf('[{') : raw.lastIndexOf('[]');
  const script = path.resolve(__filename), rows = JSON.parse(raw.slice(start)), pool = require('./workerPool.cjs');
  for (const slot of [0, 1, 2]) {
    const name = slot ? 'holodek-adjacent-worker-' + (slot + 1) : 'holodek-adjacent-worker';
    const existing = verifyProcess(rows, script, name);
    if (!existing) run(['start', script, '--name', name, '--interpreter', process.execPath,
      '--cwd', path.dirname(script), '--', '--serve', '--slot=' + slot]);
    else if (existing.pm2_env.status !== 'online') run(['restart', String(existing.pm_id), '--interpreter', process.execPath]);
    else {
      const state = await rpc({ operation: 'status' }, { runtime: pool.runtimePath(slot) });
      if (state.bundleHash !== fileHash() || existing.pm2_env.exec_interpreter !== process.execPath) {
        if (state.active || state.queued || state.computeActive || state.computeQueued) throw Error('Worker update deferred while room jobs are active.');
        run(['restart', String(existing.pm_id), '--interpreter', process.execPath]);
      }
    }
  }
  const temporary = path.join(directory(), 'pool.' + process.pid + '.tmp');
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, slots: [0, 1, 2] }), { mode: 0o600 });
  fs.renameSync(temporary, path.join(directory(), 'pool.json'));
  run(['save']);
  for (let n = 0; n < 40; n++) {
    try { const state = await rpc({ operation: 'status' }); if (state.bundleHash === fileHash() && state.roomWorkers === 3) return state; } catch { /* Wait for this worker only. */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw Error('Worker did not become ready. Existing website services were not changed.');
}
if (require.main === module) {
  if (process.argv.includes('--serve')) {
    const slot = Number(process.argv.find(arg => /^--slot=/.test(arg))?.slice(7) || 0);
    if (![0, 1, 2].includes(slot)) throw Error('Invalid room worker slot.');
    startServer({ runtime: require('./workerPool.cjs').runtimePath(slot), maxActive: slot ? 1 : 2, maxBackground: 1 });
  }
  else (async () => {
    try {
      if (process.argv.includes('--stream')) { await require('./workerPool.cjs').stream(await readJson(process.stdin, 64 * 1024 * 1024)); return; }
      const value = process.argv.includes('--start') ? await startPm2() : await rpc(await readJson(process.stdin));
      process.stdout.write(JSON.stringify({ value }) + '\n'); }
    catch (e) { process.stdout.write(JSON.stringify(/^MODEL_PROVIDER_/.test(e.code || '') ? failurePacket(e) : { error: e.message, code: e.code }) + '\n'); process.exitCode = 1; }
  })();
}
module.exports = { VERSION, PROVIDERS, readJson, handle, startServer, rpc, verifyProcess, pollModelJob, providerFailure, failurePacket, failureFrom };
