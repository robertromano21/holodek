'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const directory = () => path.join(os.homedir(), '.holodek-worker');
const runtimePath = slot => path.join(directory(), slot ? `runtime-${slot + 1}.json` : 'runtime.json');
const modelIdentity = packet => typeof packet.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(packet.id) &&
  typeof packet.capability === 'string' && /^[a-f0-9]{64}$/.test(packet.capability);
async function submissionLock(options, callback) {
  const dir = path.resolve(options.directory || directory()), file = path.join(dir, '.model-submit.lock');
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Unsafe model submission directory.');
  const until = Date.now() + 10000; let descriptor;
  for (;;) {
    if (options.signal?.aborted) throw Error('Model submission cancelled.');
    try { descriptor = fs.openSync(file, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stat;
      try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) throw Error('Unsafe model submission lock.');
      let reader;
      try {
        reader = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const opened = fs.fstatSync(reader), bytes = Buffer.alloc(1025);
        if (opened.ino !== stat.ino || opened.dev !== stat.dev || !opened.isFile() || opened.nlink !== 1) continue;
        const length = fs.readSync(reader, bytes, 0, bytes.length, 0); let owner;
        // A newly created lock can briefly be empty before its owner writes metadata.
        if (length === 0 && Date.now() - opened.ctimeMs < 1000) owner = null;
        else {
          try { owner = JSON.parse(bytes.subarray(0, length).toString('utf8')); } catch { throw Error('Invalid model submission lock metadata.'); }
          if (length > 1024 || !owner || Array.isArray(owner) || Object.keys(owner).sort().join('|') !== 'at|pid' ||
              !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 2147483647 ||
              !Number.isSafeInteger(owner.at) || owner.at < 1 || owner.at > Date.now() + 1000) throw Error('Invalid model submission lock metadata.');
        }
        if (owner && Date.now() - owner.at > 90000) {
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
          if (dead) {
            const current = fs.lstatSync(file);
            if (current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && current.ino === opened.ino && current.dev === opened.dev) {
              fs.unlinkSync(file); continue;
            }
          }
        }
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      finally { if (reader !== undefined) fs.closeSync(reader); }
      if (Date.now() >= until) throw Error('Model submission lock is busy or abandoned; no inference was submitted.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: Date.now() }));
    return await callback();
  } finally {
    try {
      const held = fs.fstatSync(descriptor), current = fs.lstatSync(file);
      if (current.isFile() && !current.isSymbolicLink() && current.ino === held.ino && current.dev === held.dev) fs.unlinkSync(file);
    } finally { fs.closeSync(descriptor); }
  }
}
async function modelLookup(nodes, packet, options) {
  for (const node of nodes) {
    const response = await call(node.registry, packet, { ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
    const result = await response.json();
    if (response.ok) return result.value;
    if (result.code !== 'MODEL_JOB_UNKNOWN') throw Object.assign(Error(result.error || 'Model job control request failed.'), { code: result.code });
  }
}
function registry(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token || '') ||
      !/^[a-f0-9]{64}$/.test(value.bundleHash || '') || !Number.isInteger(value.pid)) throw Error('Invalid private worker registry.');
  return value;
}
async function call(value, packet, { fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${value.port}/jobs`, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + value.token }, body: JSON.stringify(packet) });
  return response;
}
async function inspect({ directory: dir = directory(), fetchImpl = globalThis.fetch } = {}) {
  const poolFile = path.join(dir, 'pool.json');
  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  if (pool.version !== 1 || !Array.isArray(pool.slots) || pool.slots.length !== 3 || pool.slots.some((slot, i) => slot !== i)) throw Error('Invalid worker pool.');
  const nodes = [], ports = new Set();
  for (const slot of pool.slots) {
    const file = path.join(dir, slot ? `runtime-${slot + 1}.json` : 'runtime.json');
    try {
      const value = registry(file);
      if (ports.has(value.port)) throw Object.assign(Error('Duplicate worker listener in pool registry.'), { duplicate: true });
      ports.add(value.port);
      const response = await call(value, { operation: 'capacity' }, { fetchImpl, signal: AbortSignal.timeout(3000) });
      const result = await response.json();
      if (!response.ok || result.value?.pid !== value.pid || result.value?.bundleHash !== value.bundleHash) throw Error('Worker registry is stale.');
      nodes.push({ ...result.value, slot, registry: value });
    } catch (error) { if (error.duplicate) throw error; /* A stopped node is excluded, never sent credentials. */ }
  }
  if (!nodes.length) throw Error('No verified website worker is available.');
  return nodes;
}
async function route(packet, options = {}) {
  if (['model-submit', 'model-poll', 'model-cancel'].includes(packet.operation)) {
    if (!modelIdentity(packet)) throw Error('Invalid model job identity.');
    if (packet.operation === 'model-submit' && (!['openai', 'xai', 'groq'].includes(packet.provider) || Object.hasOwn(packet, 'pcSession'))) throw Error('Async model jobs require a cloud provider.');
    if (packet.operation === 'model-submit' && !options.submissionLocked) {
      const found = await modelLookup(await inspect(options), { operation: 'model-poll', id: packet.id, capability: packet.capability }, options);
      if (found) return { id: packet.id, capability: packet.capability, phase: found.phase };
      return submissionLock(options, () => route(packet, { ...options, submissionLocked: true }));
    }
    const nodes = await inspect(options);
    const existing = await modelLookup(nodes, { operation: packet.operation === 'model-submit' ? 'model-poll' : packet.operation,
      id: packet.id, capability: packet.capability }, options);
    if (existing) return packet.operation === 'model-submit' ? { id: packet.id, capability: packet.capability, phase: existing.phase } : existing;
    if (packet.operation !== 'model-submit') return { id: packet.id, phase: 'failed', code: 'MODEL_JOB_UNKNOWN', error: 'Unknown or expired model job.' };
    if (nodes.length !== 3) throw Error('All three model listeners must be verified before a new submission.');
    return routeReserved(packet, options, nodes);
  }
  let nodes = await inspect(options); const compute = packet.operation === 'room-stage';
  if (packet.operation === 'pc-model-response') {
    if (!/^[a-f0-9]{48}$/.test(packet.session || '') || !/^[a-f0-9]{24}$/.test(packet.id || '') ||
        Object.hasOwn(packet, 'result') === Object.hasOwn(packet, 'error') || Buffer.byteLength(JSON.stringify(packet)) > 4 * 1024 * 1024 + 4096)
      throw Error('Invalid PC model response.');
    for (const node of nodes) {
      let response, result;
      try {
        response = await call(node.registry, packet, { ...options,
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
        result = await response.json();
      } catch (error) { if (options.signal?.aborted) throw error; continue; }
      if (response.ok && result.value?.accepted === true) return result.value;
      if (result.code !== 'PC_MODEL_UNKNOWN_REQUEST') throw Error(result.error || 'PC model response was rejected.');
    }
    throw Error('No active PC model request matches this response.');
  }
  if (packet.operation === 'generate' && packet.provider === 'ollama') {
    nodes = nodes.filter(node => node.slot === 0);
    if (!nodes.length) throw Error('The serialized Ollama gateway is unavailable.');
  }
  return routeReserved(packet, options, nodes);
}
async function routeReserved(packet, options, nodes) {
  const compute = packet.operation === 'room-stage';
  const score = node => compute ? node.computeActive + node.computeQueued + (node.computeReserved || 0) : node.active + node.queued + (node.modelReserved || 0);
  nodes.sort((a, b) => score(a) - score(b) || a.slot - b.slot);
  let target, lease;
  for (const node of nodes) {
    const response = await call(node.registry, { operation: 'reserve', kind: compute ? 'room' : 'model', background: packet.background === true }, options);
    const result = await response.json();
    if (response.ok && result.value?.available) { target = node; lease = result.value.lease; break; }
  }
  if (!target) {
    target = nodes[0];
    const response = await call(target.registry, { operation: 'reserve', kind: compute ? 'room' : 'model', background: packet.background === true, queue: true }, options);
    const result = await response.json();
    if (!response.ok || !result.value?.available) throw Error(result.error || 'Website worker queue is full.');
    lease = result.value.lease;
  }
  const response = await call(target.registry, { ...packet, lease }, { ...options,
    signal: options.signal || AbortSignal.timeout(packet.operation === 'model-submit' ? 15000 : compute ? 1205000 : 605000) });
  if (compute) return response;
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || 'Website worker failed.'), { code: result.code });
  return result.value;
}
async function status(options = {}) {
  const nodes = await inspect(options), response = await call(nodes[0].registry, { operation: 'status' }, options);
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Website status failed.');
  const clean = nodes.map(({ registry, ...node }) => node);
  return { ...result.value, pool: clean, roomWorkers: clean.length,
    active: clean.reduce((n, node) => n + node.active, 0), queued: clean.reduce((n, node) => n + node.queued, 0),
    computeActive: clean.reduce((n, node) => n + node.computeActive, 0), computeQueued: clean.reduce((n, node) => n + node.computeQueued, 0) };
}
async function stream(packet, options = {}) {
  const response = await route(packet, options);
  if (!response.ok || !response.headers.get('content-type')?.includes('ndjson')) {
    const result = await response.json(); throw Error(result.error || 'Website room stage failed.');
  }
  for await (const chunk of response.body) {
    if (options.write) await options.write(Buffer.from(chunk)); else process.stdout.write(Buffer.from(chunk));
  }
}
module.exports = { directory, runtimePath, registry, call, inspect, route, status, stream };
