'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const Wire = require('./roomWire.cjs');
function forwardLog(stream, { job, credential, session, channel, write }) {
  if (!stream?.on) { stream?.resume(); return; }
  const decoder = new (require('node:string_decoder').StringDecoder)('utf8');
  let pending = '', dropping = false;
  const emit = line => {
    let text = line.replace(/\r$/, '');
    for (const secret of [credential, session]) if (secret) text = text.split(secret).join('[redacted]');
    text = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/\b(?:sk-|xai-)[A-Za-z0-9_-]{16,}\b/g,'[redacted]');
    if (text) write(`[RemoteRetort ${job.id} ${job.key} ${job.stage} ${channel}] ${text}\n`);
  };
  stream.on('data', chunk => {
    const parts = (pending + decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).split('\n'); pending = parts.pop();
    for (const line of parts) { if (!dropping) emit(line.length > 65536 ? '[oversized log line omitted]' : line); dropping = false; }
    if (pending.length > 65536) { pending = ''; if (!dropping) emit('[oversized log line omitted]'); dropping = true; }
  });
  stream.on('end', () => { pending += decoder.end(); if (!dropping && pending) emit(pending); pending = ''; });
}
function engine(directory, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw Error('Invalid room engine version.');
  const root = path.join(directory, 'engines', hash);
  if (!fs.existsSync(path.join(root, 'retort/remoteRoomWorker.js')) || !fs.existsSync(path.join(root, '.installed.json'))) throw Error('The matching room engine is not installed.');
  for (const file of [path.join(directory, 'engines'), root, path.join(root, '.installed.json'), path.join(root, 'retort'), path.join(root, 'retort/remoteRoomWorker.js')])
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Unsafe room engine path.');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, '.installed.json'), 'utf8'));
  if (receipt.hash !== hash || receipt.ready !== true || !/^[a-f0-9]{64}$/.test(receipt.manifestHash || '')) throw Error('Room engine receipt does not match its generation.');
  return root;
}
async function run(packet, { directory, signal, send, pcSession, log = line => process.stderr.write(line), spawn = (file, options) => new Worker(file, options) }) {
  const root = engine(directory, packet.engineHash), payload = Wire.unpack(packet.payload), { job } = payload;
  if (!/^[a-f0-9-]{36}$/.test(job?.id || '') || !/^[-\d]+,[-\d]+,[-\d]+$/.test(job.key || '') ||
      !['population', 'geometry', 'music', 'art'].includes(job.stage) || !['openai', 'xai', 'ollama'].includes(payload.provider)) throw Error('Invalid remote stage identity.');
  if (payload.provider !== 'ollama' && !/^[\x21-\x7e]{20,500}$/.test(payload.credential || '')) throw Error('The room stage needs a provider key from the PC.');
  const bridge = packet.pcModel !== undefined || payload.pcModel !== undefined || job.model === 'holodek-1' || pcSession !== undefined;
  if (bridge && (packet.pcModel !== 'holodek-1' || payload.pcModel !== 'holodek-1' || job.model !== 'holodek-1' || payload.provider !== 'ollama' ||
      !/^[a-f0-9]{48}$/.test(pcSession?.id || '') || typeof pcSession?.runtime !== 'string' ||
      path.dirname(path.resolve(pcSession.runtime)) !== path.resolve(directory) || !/^runtime(?:-[23])?\.json$/.test(path.basename(pcSession.runtime))))
    throw Error('Invalid PC model stage bridge.');
  const { pcSession: untrustedSession, ...data } = payload;
  const worker = spawn(path.join(root, 'retort/remoteRoomWorker.js'), {
    workerData: { ...data, ...(bridge ? { pcSession: { id: pcSession.id, runtime: pcSession.runtime } } : {}),
      gateway: path.join(directory, 'worker.cjs'), background: packet.background === true },
    stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 1024 }
  });
  for (const channel of ['stdout','stderr']) forwardLog(worker[channel], { job, credential: payload.credential, session: pcSession?.id, channel, write: log });
  let done = false, pending = Promise.resolve();
  const abort = () => worker.terminate().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      worker.on('message', message => {
        if (message.type === 'checkpoint') pending = pending.then(() => send({ type: 'checkpoint', value: Wire.pack(message) })).catch(reject);
        else if (message.type === 'done') { done = true; pending.then(resolve, reject); }
        else if (message.type === 'failed') { done = true; reject(require('./worker.cjs').failureFrom({ ...message,error:message.reason })); }
      });
      worker.once('error', reject);
      worker.once('exit', code => { if (!done) reject(Error(signal?.aborted ? 'Room stage cancelled.' : 'Room engine exited before completion (' + code + ').')); });
      if (signal?.aborted) abort();
    });
    await send({ type: 'done' });
  } finally { signal?.removeEventListener('abort', abort); await worker.terminate(); }
}
module.exports = { engine, run, forwardLog };
